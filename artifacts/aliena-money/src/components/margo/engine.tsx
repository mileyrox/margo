import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Search, ThumbsDown, ThumbsUp } from 'lucide-react';
import { ProductArt } from './art';
import { artFor, bandFor } from '@/lib/swap-catalog';
import { cents, messageOf } from '@/lib/format';

export type EngineSuggestion = {
  index: number; name: string; brand: string; retailer: string; matchType: 'Dupe' | 'Cheaper option'; sizeText: string;
  typicalPrice: number | null; whySimilar: string[]; differences: string; confidence: 'high' | 'medium' | 'low'; url: string;
  upVotes: number; downVotes: number;
};
export type EngineLookup = {
  id: string; productName: string; brand: string; category: string; sizeText: string; retailer: string; price: number | null;
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

export function EngineResult({ lookup }: { lookup: EngineLookup }) {
  const qc = useQueryClient();
  const [data, setData] = useState(lookup);
  const [voted, setVoted] = useState<Record<number, 1 | -1>>({});
  const art = artFor(`${data.category} ${data.productName}`);
  const title = `${data.brand ? `${data.brand} ` : ''}${data.productName}`;
  const vote = async (index: number, value: 1 | -1) => {
    setVoted((current) => ({ ...current, [index]: value }));
    try {
      const response = await fetch(`/api/swaps/lookups/${encodeURIComponent(data.id)}/vote`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index, vote: value }) });
      if (response.ok) { setData(await response.json()); void qc.invalidateQueries({ queryKey: ['my-swaps'] }); }
    } catch { /* a missed vote is fine */ }
  };
  return <article className="m-card m-engine">
    <div className="m-engine-head">
      <ProductArt art={art} band={bandFor(data.productName)} width={44} label={title} />
      <span><small className="m-muted">You buy</small><strong>{title}</strong>{(data.sizeText || data.price) && <small className="m-muted">{[data.sizeText, data.price ? cents(data.price) : ''].filter(Boolean).join(' · ')}</small>}</span>
    </div>
    {data.suggestions.length === 0 ? <p className="m-muted small">{data.status === 'error' ? "I couldn't check this one right now. Try again later." : "I didn't find a swap I'm confident in for this one. It may already be a good deal."}</p>
      : data.suggestions.map((item) => {
        const amazon = /amazon/i.test(item.retailer);
        return <div className="m-engine-swap" key={item.index}>
          <div className="m-engine-top">
            <ProductArt art={art} band={bandFor(item.name, true)} width={44} label={item.name} />
            <span>
              <span className="m-engine-label"><b>{item.matchType}</b>{item.retailer && <span className="m-muted"> · {item.retailer}</span>}</span>
              <strong>{item.brand ? `${item.brand} ` : ''}{item.name}</strong>
              <small className="m-muted">{[item.sizeText, item.typicalPrice != null ? `usually about ${cents(item.typicalPrice)}` : ''].filter(Boolean).join(' · ')}</small>
            </span>
          </div>
          <ul className="m-why">{item.whySimilar.map((line) => <li key={line}>{line}</li>)}</ul>
          {item.differences && <small className="m-muted">Difference: {item.differences}</small>}
          <div className="m-engine-actions">
            <a className="m-btn burgundy small" href={item.url} target="_blank" rel="noreferrer sponsored">{amazon ? 'Check price on Amazon' : `Find it${item.retailer ? ` at ${item.retailer}` : ''}`}<ArrowUpRight aria-hidden="true" /></a>
            <button type="button" className={`m-icon-button ${voted[item.index] === 1 ? 'on' : ''}`} aria-label="Good swap" aria-pressed={voted[item.index] === 1} disabled={Boolean(voted[item.index])} onClick={() => void vote(item.index, 1)}><ThumbsUp aria-hidden="true" /></button>
            <button type="button" className={`m-icon-button ${voted[item.index] === -1 ? 'on' : ''}`} aria-label="Not a good swap" aria-pressed={voted[item.index] === -1} disabled={Boolean(voted[item.index])} onClick={() => void vote(item.index, -1)}><ThumbsDown aria-hidden="true" /></button>
          </div>
          {amazon && <small className="m-muted">As an Amazon Associate I earn from qualifying purchases.</small>}
        </div>;
      })}
  </article>;
}
