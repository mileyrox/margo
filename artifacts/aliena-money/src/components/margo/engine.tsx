import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Search, ThumbsDown, ThumbsUp } from 'lucide-react';
import { ProductArt } from './art';
import { artFor, bandFor } from '@/lib/swap-catalog';
import { cents, messageOf } from '@/lib/format';

export type EngineSuggestion = {
  index: number; name: string; brand: string; retailer: string; matchType: 'Dupe' | 'Cheaper option'; sizeText: string;
  typicalPrice: number | null; whySimilar: string[]; differences: string; confidence: 'high' | 'medium' | 'low'; url: string;
  imageUrl?: string | null; upVotes: number; downVotes: number;
};
export type EngineLookup = {
  id: string; productName: string; brand: string; category: string; sizeText: string; retailer: string; price: number | null; imageUrl?: string | null;
  status: 'ready' | 'none' | 'error'; suggestions: EngineSuggestion[]; updatedAt: string;
};

export async function findSwap(body: { query?: string; barcode?: string; retailer?: string; price?: number }): Promise<EngineLookup> {
  const response = await fetch('/api/swaps/find', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Swap search had a hiccup. Try again.');
  return result as EngineLookup;
}

export async function fetchMySwaps(): Promise<EngineLookup[]> {
  const response = await fetch('/api/swaps/mine', { credentials: 'include' });
  if (!response.ok) throw new Error('Could not load your swaps.');
  return response.json();
}

export function SwapSearch() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<EngineLookup | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 3) { setError('Type the product, like "Olaplex No. 4 shampoo".'); return; }
    setBusy(true); setError(''); setResult(null);
    try { setResult(await findSwap({ query: query.trim() })); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
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

export function EngineResult({ lookup }: { lookup: EngineLookup }) {
  const qc = useQueryClient();
  const [data, setData] = useState(lookup);
  const [voted, setVoted] = useState<1 | -1 | null>(null);
  const art = artFor(`${data.category} ${data.productName}`);
  const title = `${data.brand ? `${data.brand} ` : ''}${data.productName}`;
  const item = data.suggestions[0];
  const vote = async (value: 1 | -1) => {
    if (!item) return;
    setVoted(value);
    try {
      const response = await fetch(`/api/swaps/lookups/${encodeURIComponent(data.id)}/vote`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index: item.index, vote: value }) });
      if (response.ok) { setData(await response.json()); void qc.invalidateQueries({ queryKey: ['my-swaps'] }); }
    } catch { /* a missed vote is fine */ }
  };
  if (!item) return <article className="m-card m-engine">
    <div className="m-line"><span><small className="m-muted block">You buy</small><strong>{title}</strong></span>{data.price ? <strong>{cents(data.price)}</strong> : null}</div>
    <p className="m-muted small">{data.status === 'error' ? "I couldn't check this one right now. Try again later." : "I didn't find a swap I'm confident in for this one. It may already be a good deal."}</p>
  </article>;
  const amazon = /amazon/i.test(item.retailer);
  const swapTitle = `${item.brand ? `${item.brand} ` : ''}${item.name}`;
  const savings = data.price && item.typicalPrice != null ? data.price - item.typicalPrice : null;
  return <article className="m-card m-engine">
    <div className="m-mini-shelf">
      <div className="m-mini-products">
        <Cutout imageUrl={data.imageUrl} art={art} band={bandFor(data.productName)} label={title} />
        <Cutout imageUrl={item.imageUrl} art={art} band={bandFor(item.name, true)} label={swapTitle} />
      </div>
      <div className="m-mini-board" aria-hidden="true" />
      <div className="m-mini-tags">
        <div className="m-tag">
          <small>You buy</small>
          <strong>{title}</strong>
          {data.sizeText && <span className="m-muted">{data.sizeText}</span>}
          {data.price ? <span className="m-tag-price old small">{cents(data.price)}</span> : null}
        </div>
        <div className="m-tag best">
          <small>{item.matchType}{item.retailer ? ` · ${item.retailer}` : ''}</small>
          <strong>{swapTitle}</strong>
          {item.sizeText && <span className="m-muted">{item.sizeText}</span>}
          {!amazon && item.typicalPrice != null && <span className="m-tag-price small">~{cents(item.typicalPrice)}</span>}
        </div>
      </div>
    </div>
    {savings != null && savings > 0.25 && <span className="m-save-tag self-start">About {cents(savings)} less each time</span>}
    <ul className="m-why">{item.whySimilar.map((line) => <li key={line}>{line}</li>)}</ul>
    {item.differences && <small className="m-muted">Difference: {item.differences}</small>}
    <div className="m-engine-actions">
      <a className="m-btn burgundy small" href={item.url} target="_blank" rel="noreferrer sponsored">{amazon ? 'Check price on Amazon' : `Find it${item.retailer ? ` at ${item.retailer}` : ''}`}<ArrowUpRight aria-hidden="true" /></a>
      <button type="button" className={`m-icon-button ${voted === 1 ? 'on' : ''}`} aria-label="Good swap" aria-pressed={voted === 1} disabled={voted !== null} onClick={() => void vote(1)}><ThumbsUp aria-hidden="true" /></button>
      <button type="button" className={`m-icon-button ${voted === -1 ? 'on' : ''}`} aria-label="Not a good swap" aria-pressed={voted === -1} disabled={voted !== null} onClick={() => void vote(-1)}><ThumbsDown aria-hidden="true" /></button>
    </div>
    {amazon && <small className="m-muted">As an Amazon Associate I earn from qualifying purchases.</small>}
  </article>;
}
