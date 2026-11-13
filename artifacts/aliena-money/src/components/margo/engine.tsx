import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Search } from 'lucide-react';
import { cents, messageOf, money } from '@/lib/format';

export type EngineSuggestion = {
  index: number; name: string; brand: string; retailer: string; matchType: 'Dupe' | 'Cheaper option'; sizeText: string;
  typicalPrice: number | null; whySimilar: string[]; shortReason?: string; differences: string; confidence: 'high' | 'medium' | 'low'; url: string;
  imageUrl?: string | null; upVotes: number; downVotes: number;
  linkKind?: 'amazon-page' | 'store-page' | 'search'; check?: string;
  evidence?: { url: string; site: string; quote: string } | null; traits?: string[];
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

/** The real product photo, or the brand name on a white tile when there's no photo. */
/** "reddit.com" -> "Reddit", "allure.com" -> "Allure", "tiktok.com" -> "TikTok". */
function siteName(site: string) {
  const known: Record<string, string> = { 'reddit.com': 'Reddit', 'tiktok.com': 'TikTok', 'youtube.com': 'YouTube', 'instagram.com': 'Instagram', 'allure.com': 'Allure', 'byrdie.com': 'Byrdie', 'cosmopolitan.com': 'Cosmopolitan', 'glamour.com': 'Glamour', 'refinery29.com': 'Refinery29', 'buzzfeed.com': 'BuzzFeed', 'nytimes.com': 'Wirecutter (NYT)', 'goodhousekeeping.com': 'Good Housekeeping' };
  const bare = site.replace(/^www\./, '').replace(/^(m|old)\./, '');
  return known[bare] || bare.replace(/\.(com|net|org|co)$/, '').replace(/^(.)/, (c) => c.toUpperCase());
}

function Photo({ imageUrl, brand, label, swap }: { imageUrl?: string | null; brand: string; label: string; swap?: boolean }) {
  const [failed, setFailed] = useState(false);
  // Without a photo: the brand in whole words (never cut mid-word), smaller when it's long.
  const words = brand.trim().split(/\s+/).slice(0, 3).join(' ');
  const longest = Math.max(...words.split(' ').map((word) => word.length));
  const size = longest > 11 ? 'xs' : longest > 8 || words.length > 16 ? 'sm' : '';
  return <span className={`m-plinth-photo ${swap ? 'swap' : ''}`}>
    {imageUrl && !failed ? <img src={imageUrl} alt={label} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className={`m-plinth-brand ${size}`} role="img" aria-label={label}><i aria-hidden="true">{(words[0] || '?').toUpperCase()}</i><b>{words}</b></span>}
  </span>;
}

/** One swap on two display stands: what you buy on the left, the swap on the right with its price on the stand. */
export function EngineResult({ lookup, onRemove }: { lookup: EngineLookup; onRemove?: () => void }) {
  const qc = useQueryClient();
  const [data, setData] = useState(lookup);
  const [voted, setVoted] = useState<1 | -1 | null>(null);
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
  if (!item) return <p className="m-muted small" role="status">{data.status === 'error' ? "I couldn't check that one right now. Try again later." : `I couldn't find a real dupe for ${data.brand ? `${data.brand} ` : ''}${fromName} yet. I only show swaps that people actually call a dupe for it.`}</p>;
  const amazon = /amazon/i.test(item.retailer) || /amazon\./i.test(item.url);
  const toName = `${item.name}${item.sizeText ? `, ${item.sizeText}` : ''}`;
  const savings = data.price && item.typicalPrice != null ? data.price - item.typicalPrice : null;
  const reason = item.shortReason || (item.matchType === 'Dupe' ? 'dupe' : 'cheaper option');
  const fromBrand = data.brand || data.productName;
  const toBrand = item.brand || item.name;
  const store = amazon ? 'Amazon' : item.retailer || 'the store';
  return <article className="m-plinth-swap">
    <div className="m-plinth-row">
      <div className="m-plinth">
        <Photo imageUrl={data.imageUrl} brand={fromBrand} label={`${fromBrand} ${fromName}`} />
        <span className="m-plinth-top" aria-hidden="true" />
        <span className="m-plinth-base">{data.price ? <s>{cents(data.price)}</s> : <small>You buy</small>}</span>
      </div>
      {savings != null && savings > 0.25
        ? <span className="m-plinth-save"><small>Save</small><b>{money(savings)}</b></span>
        : <span className="m-plinth-save word"><b>{item.matchType === 'Dupe' ? 'Dupe' : 'Costs less'}</b></span>}
      <a className="m-plinth swap" href={item.url} target="_blank" rel="noreferrer sponsored" aria-label={`Shop ${toBrand} ${toName} on ${store}`}>
        <Photo imageUrl={item.imageUrl} brand={toBrand} label={`${toBrand} ${toName}`} swap />
        <span className="m-plinth-top" aria-hidden="true" />
        <span className="m-plinth-base">{item.typicalPrice != null ? <b>{amazon ? '~' : ''}{cents(item.typicalPrice)}</b> : <small>See price</small>}</span>
      </a>
    </div>
    <p className="m-plinth-line"><strong>{fromBrand}</strong> to <strong>{toBrand}</strong><span> · {reason}</span><br /><span>{toName}</span></p>
    <section className="m-dupe-why" aria-label="Why this is a good swap">
      <h3>{item.evidence ? "Why it's a real dupe" : "Why it's a good swap"}</h3>
      {item.evidence ? <a className="m-proof" href={item.evidence.url} target="_blank" rel="noreferrer">
        <span>Where we heard it: <b>{siteName(item.evidence.site)}</b></span>
        {item.evidence.quote && <small>“{item.evidence.quote}”</small>}
      </a> : item.matchType === 'Cheaper option' && <p className="m-muted small">A store-brand or lower-priced version of the same product, not a named dupe.</p>}
      {item.traits && item.traits.length > 0 && <div className="m-traits" aria-label="What both have">{item.traits.map((trait) => <span key={trait}>✓ {trait}</span>)}</div>}
      {item.whySimilar.length > 0 && <ul className="m-why">{item.whySimilar.map((line) => <li key={line}>{line}</li>)}</ul>}
      {item.differences && <small className="m-muted">The difference: {item.differences}</small>}
    </section>
    <a className="m-plinth-shop" href={item.url} target="_blank" rel="noreferrer sponsored">Shop {toBrand} on {store}<ArrowUpRight aria-hidden="true" /></a>
    <div className="m-shelf-more">

      {voted === null ? <button type="button" className="m-link-button small-link" onClick={() => void vote(-1)}>Not a match</button> : null}
    </div>
  </article>;
}
