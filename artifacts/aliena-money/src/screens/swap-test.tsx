import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { customFetch } from '@workspace/api-client-react';
import { ChevronLeft } from 'lucide-react';
import { EngineResult, type EngineLookup } from '@/components/margo/engine';
import { messageOf } from '@/lib/format';

type TestRow = { query: string; ms?: number; lookup?: EngineLookup; product?: { name: string; brand: string }; error?: string; mark?: 'good' | 'bad'; running?: boolean };

const SAMPLE = `Native deodorant coconut vanilla $13
Olaplex No. 4 Bond Maintenance Shampoo $30
Bounty Select-A-Size paper towels 6 double rolls $12.99
Tide Original liquid detergent 92 oz $15.99
Cetaphil Gentle Skin Cleanser 16 oz $14.99
Advil ibuprofen 200mg 100 tablets $12.49
Dawn Ultra dish soap 19.4 oz $4.29
Clorox disinfecting wipes 75 count $6.49
Kind dark chocolate nuts and sea salt bars 12 pack $16.99
Starbucks Pike Place K-Cups 22 count $17.99`;

const STORE_KEY = 'margo-swap-test';
const load = (): { text: string; rows: TestRow[] } => { try { return JSON.parse(window.localStorage.getItem(STORE_KEY) || '') as { text: string; rows: TestRow[] }; } catch { return { text: SAMPLE, rows: [] }; } };

const linkLabel = { 'amazon-page': 'Exact Amazon page', 'store-page': 'Exact store page', search: 'Amazon search' } as const;

/** Admin swap test bench: run a list of real products and see how good the swaps are. */
export function SwapTestPage() {
  const saved = useRef(load());
  const [text, setText] = useState(saved.current.text || SAMPLE);
  const [rows, setRows] = useState<TestRow[]>(saved.current.rows || []);
  const [fresh, setFresh] = useState(true);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  useEffect(() => { try { window.localStorage.setItem(STORE_KEY, JSON.stringify({ text, rows: rows.map((row) => ({ ...row, running: false })) })); } catch { /* fine */ } }, [text, rows]);

  const run = async () => {
    const queries = text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 25);
    stop.current = false;
    setRunning(true);
    setRows(queries.map((query) => ({ query, running: true })));
    for (let i = 0; i < queries.length; i += 1) {
      if (stop.current) { setRows((current) => current.map((row) => row.running ? { ...row, running: false, error: 'Stopped' } : row)); break; }
      let row: TestRow;
      try { row = await customFetch<TestRow>('/api/admin/swap-test', { method: 'POST', body: JSON.stringify({ query: queries[i], fresh }) }); }
      catch (reason) { row = { query: queries[i], error: messageOf(reason) }; }
      setRows((current) => current.map((item, index) => index === i ? { ...row, running: false } : item));
    }
    setRunning(false);
  };

  const mark = (index: number, value: 'good' | 'bad') => setRows((current) => current.map((row, i) => i === index ? { ...row, mark: row.mark === value ? undefined : value } : row));
  const done = rows.filter((row) => !row.running);
  const withSwap = done.filter((row) => row.lookup?.suggestions[0]);
  const pct = (n: number, d: number) => d ? `${Math.round(n / d * 100)}%` : '–';
  const exact = withSwap.filter((row) => row.lookup!.suggestions[0].linkKind && row.lookup!.suggestions[0].linkKind !== 'search').length;
  const photos = withSwap.filter((row) => row.lookup!.suggestions[0].imageUrl).length;
  const marked = done.filter((row) => row.mark);
  const good = marked.filter((row) => row.mark === 'good').length;
  const avg = done.length ? Math.round(done.reduce((sum, row) => sum + (row.ms || 0), 0) / done.length / 100) / 10 : 0;

  return <div className="m-page m-stack">
    <Link href="/settings" className="m-back"><ChevronLeft aria-hidden="true" />Settings</Link>
    <div className="m-title"><div><h1>Swap test bench</h1><p>One product per line. Add the price you paid at the end, like "$13", so savings show. A line of only numbers is treated as a barcode.</p></div></div>
    <textarea className="m-input m-test-input" rows={8} value={text} onChange={(event) => setText(event.target.value)} aria-label="Products to test" disabled={running} />
    <label className="m-test-fresh"><input type="checkbox" checked={fresh} onChange={(event) => setFresh(event.target.checked)} disabled={running} />Ask again from scratch (ignore saved answers)</label>
    <div className="m-row-2">
      {running ? <button type="button" className="m-btn outline" onClick={() => { stop.current = true; }}>Stop after this one</button>
        : <button type="button" className="m-btn navy" onClick={() => void run()}>Run {Math.min(25, text.split('\n').filter((line) => line.trim()).length)} products</button>}
      <button type="button" className="m-btn outline" disabled={running} onClick={() => setText(SAMPLE)}>Use sample list</button>
    </div>
    <p className="m-muted small">Each product is a fresh AI search with web search, about 3 to 5 cents and 20 to 60 seconds each.</p>

    {done.length > 0 && <section className="m-test-score" aria-label="Scorecard">
      <div><strong>{pct(withSwap.length, done.length)}</strong><span>found a swap ({withSwap.length} of {done.length})</span></div>
      <div><strong>{pct(exact, withSwap.length)}</strong><span>exact product link</span></div>
      <div><strong>{pct(photos, withSwap.length)}</strong><span>swap has a photo</span></div>
      <div><strong>{marked.length ? pct(good, marked.length) : '–'}</strong><span>you marked good ({good} of {marked.length})</span></div>
      <div><strong>{avg}s</strong><span>average time</span></div>
    </section>}

    {rows.map((row, index) => <article key={`${row.query}-${index}`} className="m-card m-test-row">
      <div className="m-line"><strong>{row.query}</strong>{row.ms != null && <small className="m-muted">{Math.round(row.ms / 1000)}s</small>}</div>
      {row.running ? <p className="m-muted small">Waiting…</p>
        : row.error ? <p className="m-error">{row.error}</p>
        : row.lookup && <>
          {row.product && row.product.name !== row.query && <small className="m-muted">Read as: {row.product.brand} {row.product.name}</small>}
          <div className="m-test-tags">
            {row.lookup.suggestions[0] ? <>
              <span className={`m-test-tag ${row.lookup.suggestions[0].linkKind === 'search' ? 'warn' : 'ok'}`}>{linkLabel[row.lookup.suggestions[0].linkKind || 'search']}</span>
              <span className={`m-test-tag ${row.lookup.suggestions[0].imageUrl ? 'ok' : 'warn'}`}>{row.lookup.suggestions[0].imageUrl ? 'Swap photo' : 'No swap photo'}</span>
              <span className={`m-test-tag ${row.lookup.imageUrl ? 'ok' : 'warn'}`}>{row.lookup.imageUrl ? 'Original photo' : 'No original photo'}</span>
              <span className="m-test-tag">{row.lookup.suggestions[0].confidence} confidence</span>
            </> : <span className="m-test-tag warn">No swap: {row.lookup.status}</span>}
          </div>
          {row.lookup.suggestions[0]?.check && <p className="small"><strong>Second check:</strong> {row.lookup.suggestions[0].check}</p>}
          <EngineResult lookup={row.lookup} />
          {row.lookup.suggestions[0] && <a className="m-test-url" href={row.lookup.suggestions[0].url} target="_blank" rel="noreferrer">{row.lookup.suggestions[0].url}</a>}
          <div className="m-row-2">
            <button type="button" className={`m-btn small ${row.mark === 'good' ? 'navy' : 'outline'}`} aria-pressed={row.mark === 'good'} onClick={() => mark(index, 'good')}>Good swap</button>
            <button type="button" className={`m-btn small ${row.mark === 'bad' ? 'burgundy' : 'outline'}`} aria-pressed={row.mark === 'bad'} onClick={() => mark(index, 'bad')}>Bad swap</button>
          </div>
        </>}
    </article>)}
  </div>;
}
