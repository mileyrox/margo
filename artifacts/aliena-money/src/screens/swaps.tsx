import { customFetch } from '@workspace/api-client-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useGetProductComparisons } from '@workspace/api-client-react';
import { ArrowRight, Bookmark, BookmarkCheck, Check, ScanBarcode, Upload } from 'lucide-react';
import { BackLink, EmptyState, ErrorState, PageTitle, Skeleton } from '@/components/margo/chrome';
import { ProductArt } from '@/components/margo/art';
import { bandFor, fetchSwapCatalog, rowArt, rowLabel, rowSavings, type SwapCatalogRow } from '@/lib/swap-catalog';
import { useProfileAnswers } from '@/lib/profile';
import { EngineResult, SwapSearch, fetchMySwaps } from '@/components/margo/engine';
import { cents, messageOf, money, parseList } from '@/lib/format';

const productName = (brand: string, product: string) => (brand ? `${brand} ${product}` : product);

function useSwapLists() {
  const { answers, patch } = useProfileAnswers();
  const saved = parseList(answers.savedSwaps);
  const switched = parseList(answers.switchedSwaps);
  const toggle = (key: 'savedSwaps' | 'switchedSwaps', id: string) => {
    const list = key === 'savedSwaps' ? saved : switched;
    const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
    return patch({ [key]: JSON.stringify(next) });
  };
  return { saved, switched, toggle };
}

export function SwapsPage() {
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ['my-swaps'], queryFn: fetchMySwaps, refetchInterval: 30_000 });
  const swaps = mine.data || [];
  const perShop = swaps.reduce((sum, lookup) => {
    const best = lookup.suggestions[0];
    return sum + (lookup.price && best?.typicalPrice != null ? Math.max(0, lookup.price - best.typicalPrice) : 0);
  }, 0);
  const remove = async (id: string) => {
    await fetch(`/api/swaps/mine/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
    await qc.invalidateQueries({ queryKey: ['my-swaps'] });
  };
  return <div className="m-page">
    <PageTitle title="Your swaps" subtitle={swaps.length ? `${swaps.length} ${swaps.length === 1 ? 'swap' : 'swaps'}${perShop > 0 ? ` · about ${cents(perShop)} less per trip` : ''}` : undefined} />
    <SwapSearch />
    {mine.isLoading ? <div className="m-card"><Skeleton lines={4} /></div>
      : mine.isError ? <ErrorState error={mine.error} retry={() => mine.refetch()} />
      : swaps.length ? swaps.map((lookup) => <EngineResult key={lookup.id} lookup={lookup} onRemove={() => void remove(lookup.id)} />)
      : <div className="m-card m-empty-swaps">
        <div className="m-pair-art"><ProductArt art="towels" band="#1E4E9E" width={56} label="A product you buy" /><ArrowRight className="m-swap-arrow" aria-hidden="true" /><ProductArt art="towels" band="#6D712E" width={56} label="A cheaper swap" /></div>
        <h2>Your swaps show up here</h2>
        <p className="m-muted">Scan a receipt or a barcode and I'll find a cheaper version of what you bought.</p>
        <Link href="/receipts?scan=receipt" className="m-btn burgundy"><Upload aria-hidden="true" />Scan a receipt</Link>
        <Link href="/receipts?scan=barcode" className="m-btn outline"><ScanBarcode aria-hidden="true" />Scan a barcode</Link>
      </div>}
    <p className="m-fine">Tap the swap to open the store. Swaps come from product facts; prices change, so check the label and price. Some links earn us a commission. <Link href="/disclosures">Learn more</Link></p>
  </div>;
}

function SwapListCard({ row }: { row: SwapCatalogRow }) {
  const art = rowArt(row);
  const savings = rowSavings(row);
  return <Link className="m-card m-swap-card" href={`/swaps/${encodeURIComponent(row.id)}`}>
    <div className="m-swap-pair">
      <div><ProductArt art={art} band={bandFor(row.originalProduct)} width={46} label="Product you bought" /><span><strong>{productName(row.originalBrand, row.originalProduct)}</strong><s>{cents(row.originalPrice)}</s></span></div>
      <ArrowRight className="m-swap-arrow" aria-hidden="true" />
      <div><ProductArt art={art} band={bandFor(row.swapProduct, true)} width={46} label={rowLabel(row)} /><span><strong>{productName(row.swapBrand, row.swapProduct)}</strong><b>{cents(row.swapPrice)}</b></span></div>
    </div>
    <div className="m-line"><span className="m-muted">{rowLabel(row)} · {row.category}</span>{savings != null && savings > 0 && <span className="m-save-tag">Save {cents(savings)}</span>}</div>
  </Link>;
}

export function SwapDetailPage({ id }: { id: string }) {
  const catalog = useQuery({ queryKey: ['swap-catalog'], queryFn: () => fetchSwapCatalog() });
  const { saved, switched, toggle } = useSwapLists();
  const [error, setError] = useState('');
  const row = catalog.data?.find((item) => item.id === id);
  if (catalog.isLoading) return <div className="m-page"><Skeleton lines={4} /></div>;
  if (catalog.isError) return <div className="m-page"><ErrorState error={catalog.error} retry={() => catalog.refetch()} /></div>;
  if (!row) return <div className="m-page"><BackLink href="/swaps">All swaps</BackLink><EmptyState title="This swap isn't available" body="It may have been updated or removed." /></div>;
  const art = rowArt(row);
  const savings = rowSavings(row);
  const label = rowLabel(row);
  const reasons = (row.whySimilar || '').split(/(?<=[.;])\s+|\n+/).map((item) => item.replace(/[.;]\s*$/, '').trim()).filter(Boolean);
  const isSaved = saved.includes(row.id);
  const isSwitched = switched.includes(row.id);
  const run = (key: 'savedSwaps' | 'switchedSwaps') => { setError(''); toggle(key, row.id).catch((reason) => setError(messageOf(reason))); };
  return <div className="m-page">
    <BackLink href="/swaps">All swaps</BackLink>
    <h1 className="m-h1-sm">{row.groupName || row.category}</h1>

    <div className="m-shelf">
      <div className="m-shelf-products">
        <ProductArt art={art} band={bandFor(row.originalProduct)} width={132} label={`${productName(row.originalBrand, row.originalProduct)}, background removed`} />
        <ProductArt art={art} band={bandFor(row.swapProduct, true)} width={132} label={`${productName(row.swapBrand, row.swapProduct)}, background removed`} />
      </div>
      <div className="m-shelf-board" aria-hidden="true" />
      <div className="m-shelf-tags">
        <div className="m-tag">
          <small>You bought</small>
          <strong>{row.originalProduct}</strong>
          <span className="m-muted">{row.originalBrand || 'Name brand'}{row.originalRetailer ? ` · ${row.originalRetailer}` : ''}</span>
          <span className="m-tag-price old">{cents(row.originalPrice)}</span>
          {row.originalPricePerOz != null && <span className="m-muted">{cents(row.originalPricePerOz)} per oz</span>}
        </div>
        <div className="m-tag best">
          <small>{label}</small>
          <strong>{row.swapProduct}</strong>
          <span className="m-muted">{row.swapBrand || 'Store brand'}{row.swapRetailer ? ` · ${row.swapRetailer}` : ''}</span>
          <span className="m-tag-price">{cents(row.swapPrice)}</span>
          {row.swapPricePerOz != null && <span className="m-muted">{cents(row.swapPricePerOz)} per oz</span>}
        </div>
      </div>
    </div>

    <div className="m-navy-strip">
      <div><span>Per purchase</span><strong>{savings != null ? cents(savings) : '—'}</strong></div>
      <div><span>Per ounce</span><strong>{row.savingsPerOzPct != null ? `${Math.round(row.savingsPerOzPct)}% less` : '—'}</strong></div>
      <div><span>Match</span><strong>{row.similarity != null ? `${row.similarity}%` : label}</strong></div>
    </div>

    <section className="m-card m-stack">
      <h2 className="m-h3">Why it's similar</h2>
      {reasons.length ? reasons.map((reason) => <div className="m-check-line" key={reason}><Check aria-hidden="true" /><span>{reason}</span></div>) : <span className="m-muted">No notes yet.</span>}
      {row.differences && <span className="m-muted">Differences: {row.differences}</span>}
    </section>

    {error && <div className="m-error" role="alert">{error}</div>}
    <div className="m-actions">
      <button className={`m-btn ${isSwitched ? 'outline' : 'burgundy'} grow`} onClick={() => run('switchedSwaps')}>{isSwitched ? <><Check aria-hidden="true" />Switched</> : 'I switched'}</button>
      <button className="m-btn outline square" aria-label={isSaved ? 'Remove from saved' : 'Save for later'} aria-pressed={isSaved} onClick={() => run('savedSwaps')}>{isSaved ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}</button>
    </div>
    <p className="m-fine">Prices change. Check the package and price before you buy.</p>
  </div>;
}

const adminFields: Array<{ key: keyof SwapCatalogRow; label: string; kind?: 'number' | 'long' }> = [
  { key: 'groupName', label: 'Group' }, { key: 'category', label: 'Category' },
  { key: 'originalBrand', label: 'Original brand' }, { key: 'originalProduct', label: 'Original product' },
  { key: 'originalRetailer', label: 'Original retailer' }, { key: 'originalPrice', label: 'Original price', kind: 'number' },
  { key: 'swapBrand', label: 'Swap brand' }, { key: 'swapProduct', label: 'Swap product' },
  { key: 'swapRetailer', label: 'Swap retailer' }, { key: 'swapPrice', label: 'Swap price', kind: 'number' },
  { key: 'originalPricePerOz', label: 'Original price per oz', kind: 'number' }, { key: 'swapPricePerOz', label: 'Swap price per oz', kind: 'number' },
  { key: 'savingsPerOzPct', label: 'Savings per oz %', kind: 'number' }, { key: 'matchType', label: 'Match type' },
  { key: 'similarity', label: 'Similarity', kind: 'number' }, { key: 'confidence', label: 'Confidence' },
  { key: 'whySimilar', label: 'Why it’s similar', kind: 'long' }, { key: 'differences', label: 'Differences', kind: 'long' },
  { key: 'status', label: 'Status' }, { key: 'flags', label: 'Flags', kind: 'long' },
];
const numericKeys = new Set<keyof SwapCatalogRow>(['originalPrice', 'swapPrice', 'originalPricePerOz', 'swapPricePerOz', 'savingsPerOzPct', 'similarity']);

export const isLive = (row: SwapCatalogRow) => row.status.startsWith('Ready') && (row.originalPrice || 0) > 0 && (row.swapPrice || 0) > 0;
const blocker = (row: SwapCatalogRow) => {
  if (row.status === "Don't show as a dupe") return 'Hidden on purpose';
  const missing = [!(row.originalPrice && row.originalPrice > 0) && 'original price', !(row.swapPrice && row.swapPrice > 0) && 'swap price'].filter(Boolean);
  if (!row.status.startsWith('Ready')) return missing.length ? `Needs approval and ${missing.join(' and ')}` : 'Needs your approval';
  return missing.length ? `Needs ${missing.join(' and ')}` : 'Showing to users';
};

export function AdminSwapsPage() {
  const query = useQuery({ queryKey: ['admin-swap-catalog'], queryFn: () => fetchSwapCatalog(true) });
  const [rows, setRows] = useState<SwapCatalogRow[]>([]);
  const [view, setView] = useState<'all' | 'live' | 'prices' | 'review'>('prices');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (query.data) setRows(query.data); }, [query.data]);
  const refresh = async () => { await query.refetch(); };
  const update = (id: string, key: keyof SwapCatalogRow, value: string) => setRows((current) => current.map((row) => row.id === id ? { ...row, [key]: numericKeys.has(key) ? value === '' ? null : Number(value) : value } : row));
  const payloadFor = (row: SwapCatalogRow) => ({
    group: row.groupName, category: row.category, original_brand: row.originalBrand, original_product: row.originalProduct,
    original_retailer: row.originalRetailer, original_price: row.originalPrice, swap_brand: row.swapBrand,
    swap_product: row.swapProduct, swap_retailer: row.swapRetailer, swap_price: row.swapPrice,
    original_price_per_oz: row.originalPricePerOz, swap_price_per_oz: row.swapPricePerOz,
    savings_per_oz_pct: row.savingsPerOzPct, match_type: row.matchType, similarity: row.similarity,
    confidence: row.confidence, why_similar: row.whySimilar, differences: row.differences, status: row.status, flags: row.flags,
  });
  const call = async (url: string, init: RequestInit, fallback: string, success: (body: { message?: string }) => string) => {
    setBusy(true); setMessage('');
    try {
      const body = await customFetch<{ message?: string }>(url, init);
      setMessage(success(body)); await refresh();
      return true;
    } catch (error) { setMessage(messageOf(error)); return false; } finally { setBusy(false); }
  };
  const save = (row: SwapCatalogRow) => call(`/api/admin/swap-catalog/${encodeURIComponent(row.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadFor(row)) }, 'Could not save this swap.', () => `${row.id} saved.`);
  const approve = (row: SwapCatalogRow) => call(`/api/admin/swap-catalog/${encodeURIComponent(row.id)}/approve`, { method: 'POST' }, 'Could not approve this swap.', () => `${row.id} approved. It shows to users once both prices are filled in.`);
  const importCsv = async () => {
    if (!file) return;
    const ok = await call('/api/admin/swap-catalog/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: await file.text() }) }, 'Could not import CSV.', (body) => body.message || 'Imported.');
    if (ok) setFile(null);
  };
  const live = rows.filter(isLive).length;
  const needsPrices = rows.filter((row) => row.status.startsWith('Ready') && !isLive(row)).length;
  const needsReview = rows.filter((row) => !row.status.startsWith('Ready') && row.status !== "Don't show as a dupe").length;
  const shown = rows.filter((row) => view === 'all' ? true : view === 'live' ? isLive(row) : view === 'prices' ? row.status.startsWith('Ready') && !isLive(row) : !row.status.startsWith('Ready') && row.status !== "Don't show as a dupe");
  return <div className="m-page wide">
    <PageTitle title="Swap catalog" subtitle="A swap shows to users once it's approved and both prices are filled in." />
    {rows.length > 0 && <div className="m-tiles">
      <div className="m-tile"><span>Showing to users</span><strong>{live}</strong></div>
      <div className="m-tile"><span>Need prices</span><strong>{needsPrices}</strong></div>
      <div className="m-tile"><span>Need review</span><strong>{needsReview}</strong></div>
    </div>}
    {rows.length > 0 && <div className="m-chips">{([['prices', 'Needs prices'], ['review', 'Needs review'], ['live', 'Showing'], ['all', 'All']] as const).map(([value, label]) => <button key={value} className={`m-chip ${view === value ? 'on' : ''}`} onClick={() => setView(value)}>{label}</button>)}</div>}
    <section className="m-card m-stack">
      <label className="m-field-label">Import an updated CSV<input className="m-input" type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      <button className="m-btn navy" disabled={!file || busy} onClick={() => void importCsv()}><Upload aria-hidden="true" />Import or update</button>
      <span className="m-muted small">Existing IDs are updated and new IDs are added. Rows missing either price stay hidden from users.</span>
    </section>
    {message && <div className="m-success" role="status">{message}</div>}
    {query.isLoading ? <Skeleton lines={5} /> : query.isError ? <ErrorState error={query.error} retry={() => query.refetch()} /> : shown.map((row) => <article className="m-card m-stack" key={row.id}>
      <div className="m-line"><span><strong>{row.id}</strong> <span className="m-muted">{row.status} · </span><span className={isLive(row) ? 'olive' : 'burgundy'}>{blocker(row)}</span></span><span className="m-actions">{row.status.startsWith('Review first') && <button className="m-btn outline small" disabled={busy} onClick={() => void approve(row)}>Approve</button>}<button className="m-btn navy small" disabled={busy} onClick={() => void save(row)}>Save</button></span></div>
      <div className="m-fields">{adminFields.map(({ key, label, kind }) => <label key={key} className={kind === 'long' ? 'full' : ''}>{label}{kind === 'long'
        ? <textarea className="m-input" rows={key === 'flags' ? 3 : 4} value={String(row[key] ?? '')} onChange={(event) => update(row.id, key, event.target.value)} />
        : <input className="m-input" type={kind === 'number' ? 'number' : 'text'} step={kind === 'number' ? 'any' : undefined} value={String(row[key] ?? '')} onChange={(event) => update(row.id, key, event.target.value)} />}</label>)}</div>
    </article>)}
  </div>;
}
