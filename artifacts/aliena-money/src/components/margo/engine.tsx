import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Search, ThumbsDown, ThumbsUp } from 'lucide-react';
import { ProductArt } from './art';
import { artFor, bandFor } from '@/lib/swap-catalog';
import { cents, messageOf } from '@/lib/format';

export type EngineSuggestion = {
  index: number; name: string; brand: string; retailer: string; matchType: 'Dupe' | 'Cheaper option'; sizeText: string;
  typicalPrice: number | null; whySimilar: string[]; shortReason?: string; differences: string; confidence: 'high' | 'medium' | 'low'; url: string;
  imageUrl?: string | null; upVotes: number; downVotes: number;
};
export type EngineLookup = {
  id: string; productName: string; brand: string; category: string; sizeText: string; retailer: string; price: number | null; imageUrl?: string | null; source?: 'receipt' | 'barcode' | 'search';
  status: 'ready' | 'none' | 'error'; suggestions: EngineSuggestion[]; updatedAt: string;
};

export async function findSwap(body: { query?: string; barcode?: string; retailer?: string; price?: number }): Promise<EngineLookup> {
  return customFetch<EngineLookup>('/api/swaps/find', { method: 'POST', body: JSON.stringify(body) });
}

export async function fetchMySwaps(): Promise<EngineLookup[]> {
  return customFetch<EngineLookup[]>('/api/swaps/mine');
}

export function SwapSearch() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<EngineLookup | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 3) { setError('Type the product, like "Olaplex No. 4 shampoo".'); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      const found = await findSwap({ query: query.trim() });
      if (found.suggestions.length) { setQuery(''); await qc.invalidateQueries({ queryKey: ['my-swaps'] }); }
      else setResult(found);
    } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  };
  return <section className="m-stack">
    <form className="m-search" onSubmit={submit} role="search">
      <Search aria-hidden="true" />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a cheaper swap for…" aria-label="Product to find a swap for" maxLength={200} />
      <button className="m-btn navy small" disabled={busy}>{busy ? 'Looking…' : 'Find'}</button>
    </form>
    {busy && <div className="m-card m-muted" role="status">Checking store brands and dupes. This takes a few seconds the first time.</div>}
    {error && <div className="m-error" role="alert">{error}</div>}
    {result && <EngineResult lookup={result} />}
  </section>;
}

/** A product photo on white with the white blended away, or the drawn cut-out when there's no photo yet. */
function Cutout({ imageUrl, art, band, label }: { imageUrl?: string | null; art: ReturnType<typeof artFor>; band: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (imageUrl && !failed) return <img className="m-cutout" src={imageUrl} alt={label} loading="lazy" onError={() => setFailed(true)} />;
  return <ProductArt art={art} band={band} width={96} label={label} />;
}

/** One swap on a wooden shelf: what you buy on the left, the swap on the right (tap it to open the store). */
export function EngineResult({ lookup, onRemove }: { lookup: EngineLookup; onRemove?: () => void }) {
  const qc = useQueryClient();
  const [data, setData] = useState(lookup);
  const [voted, setVoted] = useState<1 | -1 | null>(null);
  const art = artFor(`${data.category} ${data.productName}`);
  const item = data.suggestions[0];
  const vote = async (value: 1 | -1) => {
    if (!item) return;
    setVoted(value);
    try {
      const updated = await customFetch<EngineLookup>(`/api/swaps/lookups/${encodeURIComponent(data.id)}/vote`, { method: 'POST', body: JSON.stringify({ index: item.index, vote: value }) });
      setData(updated);
      if (value === -1) onRemove?.();
      void qc.invalidateQueries({ queryKey: ['my-swaps'] });
    } catch { /* a missed vote is fine */ }
  };
  const fromName = `${data.productName}${data.sizeText ? `, ${data.sizeText}` : ''}`;
  if (!item) return <p className="m-muted small" role="status">{data.status === 'error' ? "I couldn't check that one right now. Try again later." : `I didn't find a swap I'm confident in for ${data.brand ? `${data.brand} ` : ''}${fromName}. It may already be a good deal.`}</p>;
  const amazon = /amazon/i.test(item.retailer);
  const toName = `${item.name}${item.sizeText ? `, ${item.sizeText}` : ''}`;
  const savings = data.price && item.typicalPrice != null ? data.price - item.typicalPrice : null;
  const reason = item.shortReason || (item.matchType === 'Dupe' ? 'dupe' : 'cheaper option');
  const storeLabel = `${item.brand || item.name}${item.retailer ? ` at ${item.retailer}` : ''}`;
  return <article className="m-shelf-swap">
    <div className="m-shelf-row">
      <div className="m-shelf-item">
        <span className="m-shelf-brand">{data.brand || data.productName}</span>
        <Cutout imageUrl={data.imageUrl} art={art} band={bandFor(data.productName)} label={`${data.brand} ${fromName}`} />
      </div>
      <div className="m-shelf-mid">
        {savings != null && savings > 0.25 ? <span className="m-shelf-save">Save {cents(savings)}</span> : <span className="m-shelf-save">{item.matchType}</span>}
        <svg aria-hidden="true" width="100" height="22" viewBox="0 0 108 24"><path d="M4 13 C 30 8, 60 16, 94 11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><path d="M84 3 L 100 11 L 86 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="m-shelf-why">{reason}</span>
      </div>
      <a className="m-shelf-item link" href={item.url} target="_blank" rel="noreferrer sponsored" aria-label={`Open ${storeLabel}`}>
        <span className="m-shelf-brand"><u>{item.brand || item.name}</u> ↗</span>
        <Cutout imageUrl={item.imageUrl} art={art} band={bandFor(item.name, true)} label={`${item.brand} ${toName}`} />
      </a>
    </div>
    <div className="m-wood" aria-hidden="true"><i /><b /><s /></div>
    <div className="m-shelf-prices">
      <div>
        {data.price ? <s className="m-shelf-old">{cents(data.price)}</s> : <span className="m-shelf-old none">You buy</span>}
        <small>{fromName}</small>
      </div>
      <a href={item.url} target="_blank" rel="noreferrer sponsored" aria-label={`Open ${storeLabel}`}>
        {!amazon && item.typicalPrice != null ? <strong className="m-shelf-new">{cents(item.typicalPrice)}</strong> : <strong className="m-shelf-new small">Check price</strong>}
        <small>{toName}</small>
      </a>
    </div>
    <div className="m-shelf-more">
      <details>
        <summary>Why it's similar</summary>
        <ul className="m-why">{item.whySimilar.map((line) => <li key={line}>{line}</li>)}</ul>
        {item.differences && <small className="m-muted">Difference: {item.differences}</small>}
      </details>
      {voted === null ? <button type="button" className="m-link-button small-link" onClick={() => void vote(-1)}>Not a match</button> : null}
    </div>
    {amazon && <small className="m-muted">As an Amazon Associate I earn from qualifying purchases.</small>}
  </article>;
}
