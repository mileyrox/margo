import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useGetTransactions } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ErrorState, Skeleton } from '@/components/margo/chrome';
import { CoinAvatar, type AvatarLook } from '@/components/margo/art';
import { fetchMySwaps } from '@/components/margo/engine';
import { dayKey, money, shortDate } from '@/lib/format';

type Range = { start: string; end: string; label: string };
const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return dayKey(d); };
/** Last week runs Monday to Sunday; "past 7 days" ends today. */
function rangeFor(which: 'last' | 'now'): [Range, Range] {
  if (which === 'now') return [{ start: shift(-6), end: shift(0), label: 'The past 7 days' }, { start: shift(-13), end: shift(-7), label: '' }];
  const sinceMonday = (new Date().getDay() + 6) % 7;
  const start = shift(-sinceMonday - 7), end = shift(-sinceMonday - 1);
  return [{ start, end, label: `${shortDate(start)} to ${shortDate(end)}` }, { start: shift(-sinceMonday - 14), end: shift(-sinceMonday - 8), label: '' }];
}

const margoLook: AvatarLook = { coin: 'gold', eyes: 'dots', brows: 'none', mouth: 'smile', hair: 'bangs', glasses: 'round', extra: 'none', bg: 'transparent' };

/** Margo the coin (bangs, glasses, eyelashes), pointing up at the number on the slide. */
function MargoPointing() {
  return <div className="m-guide" aria-hidden="true">
    <svg className="m-guide-arm" width="120" height="96" viewBox="0 0 120 96">
      <path d="M18 92C26 66 46 46 80 30" fill="none" stroke="#111111" strokeWidth="9" strokeLinecap="round" />
      <path d="M18 92C26 66 46 46 80 30" fill="none" stroke="#FFF1C7" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="84" cy="28" r="10" fill="#FFF1C7" stroke="#111111" strokeWidth="2.6" />
      <path d="M90 21L108 8" fill="none" stroke="#111111" strokeWidth="9" strokeLinecap="round" />
      <path d="M90 21L108 8" fill="none" stroke="#FFF1C7" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
    <div className="m-guide-coin">
      <CoinAvatar look={margoLook} size={132} label="Margo" />
      <svg width="132" height="132" viewBox="0 0 120 120"><path d="M45.5 60.5l-2.6-3M48 59l-1-3.6M51.5 59l.6-3.6M74.5 60.5l2.6-3M72 59l1-3.6M68.5 59l-.6-3.6" fill="none" stroke="#111111" strokeWidth="1.5" strokeLinecap="round" /></svg>
    </div>
  </div>;
}

type Row = { name: string; total: number; count: number };
type Stats = { total: number; count: number; previous: number; change: number | null; categories: Row[]; places: Row[]; biggest: { label: string; amount: number; date: string; category: string }; income: number; perTrip: number };

/** The weekly recap: three quick slides with Margo, then everything on one page. */
export function RecapPage() {
  const params = new URLSearchParams(window.location.search);
  const [which, setWhich] = useState<'last' | 'now'>(() => params.get('week') === 'last' ? 'last' : 'now');
  const [view, setView] = useState<'slides' | 'full'>(() => params.get('view') === 'full' ? 'full' : 'slides');
  const [index, setIndex] = useState(0);
  const transactions = useGetTransactions();
  const swaps = useQuery({ queryKey: ['my-swaps'], queryFn: fetchMySwaps });
  const [range, before] = rangeFor(which);

  const stats = useMemo<Stats | null>(() => {
    const inRange = (r: Range) => (transactions.data || []).filter((item) => item.date.slice(0, 10) >= r.start && item.date.slice(0, 10) <= r.end);
    const spent = inRange(range).filter((item) => item.type === 'expense');
    if (!spent.length) return null;
    const total = spent.reduce((sum, item) => sum + Number(item.amount), 0);
    const previous = inRange(before).filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
    const group = (key: (item: (typeof spent)[number]) => string): Row[] => {
      const map = new Map<string, Row>();
      spent.forEach((item) => { const name = key(item) || 'Other'; const row = map.get(name) || { name, total: 0, count: 0 }; row.total += Number(item.amount); row.count += 1; map.set(name, row); });
      return [...map.values()].sort((a, b) => b.total - a.total);
    };
    const top = [...spent].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
    return {
      total, count: spent.length, previous, change: previous > 0 ? Math.round((total - previous) / previous * 100) : null,
      categories: group((item) => item.category), places: group((item) => item.label),
      biggest: { label: top.label, amount: Number(top.amount), date: top.date, category: top.category },
      income: inRange(range).filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount), 0),
      perTrip: (swaps.data || []).reduce((sum, lookup) => { const best = lookup.suggestions[0]; return sum + (lookup.price && best?.typicalPrice != null ? Math.max(0, lookup.price - best.typicalPrice) : 0); }, 0),
    };
  }, [transactions.data, swaps.data, range.start, range.end, before.start, before.end]);

  if (transactions.isLoading) return <div className="m-page"><Skeleton /></div>;
  if (transactions.isError) return <div className="m-page"><ErrorState error={transactions.error} retry={() => void transactions.refetch()} /></div>;

  const pick = (value: 'last' | 'now') => { setWhich(value); setIndex(0); };
  const toggle = <div className="m-segment wide" role="group" aria-label="Which week">
    <button type="button" className={which === 'now' ? 'on' : ''} aria-pressed={which === 'now'} onClick={() => pick('now')}>Past 7 days</button>
    <button type="button" className={which === 'last' ? 'on' : ''} aria-pressed={which === 'last'} onClick={() => pick('last')}>Last week</button>
  </div>;

  if (!stats) return <div className="m-page m-stack">
    <div className="m-title"><div><h1>Your week in money</h1></div></div>
    {toggle}
    <div className="m-card m-stack"><strong>Nothing to recap yet</strong><span className="m-muted">No spending shows up for {which === 'last' ? 'last week' : 'the past 7 days'}. Connect a bank or add a purchase and your recap fills in.</span><Link className="m-btn navy" href="/transactions">Go to Spending</Link></div>
  </div>;

  const changeLine = stats.change == null ? '' : stats.change === 0 ? 'About the same as the week before.' : `${Math.abs(stats.change)}% ${stats.change > 0 ? 'more' : 'less'} than the week before.`;
  const [topCategory] = stats.categories;
  const [topPlace] = stats.places;

  if (view === 'slides') {
    const slides = [
      { tone: 'navy', kicker: 'This week you spent', big: money(stats.total), line: `across ${stats.count} ${stats.count === 1 ? 'purchase' : 'purchases'}. ${changeLine}` },
      { tone: 'burgundy', kicker: 'Most of it went to', big: topCategory.name, line: `${money(topCategory.total)}, which is ${Math.round(topCategory.total / stats.total * 100)}% of what you spent.` },
      { tone: 'green', kicker: 'Your top spot was', big: topPlace.name, line: `${money(topPlace.total)} over ${topPlace.count} ${topPlace.count === 1 ? 'visit' : 'visits'}.` },
    ];
    const slide = slides[Math.min(index, slides.length - 1)];
    const last = index >= slides.length - 1;
    return <div className={`m-recap ${slide.tone}`}>
      <div className="m-recap-bars" aria-hidden="true">{slides.map((item, i) => <i key={item.tone} className={i <= index ? 'on' : ''} />)}</div>
      <div className="m-recap-top"><span>{range.label}</span><Link href="/" aria-label="Close recap" className="m-recap-close"><X aria-hidden="true" /></Link></div>
      <div className="m-recap-body" aria-live="polite">
        <p className="m-recap-kicker">{slide.kicker}</p>
        <p className={`m-recap-big ${slide.big.length > 13 ? 'long' : slide.big.length > 7 ? 'mid' : ''}`}>{slide.big}</p>
        <p className="m-recap-line">{slide.line}</p>
      </div>
      <MargoPointing />
      <div className="m-recap-nav">
        <button type="button" className="m-recap-step" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0} aria-label="Back"><ChevronLeft aria-hidden="true" /></button>
        {last
          ? <button type="button" className="m-recap-step done" onClick={() => setView('full')}>See my full recap</button>
          : <button type="button" className="m-recap-step done" onClick={() => setIndex(index + 1)}>Next<ChevronRight aria-hidden="true" /></button>}
      </div>
    </div>;
  }

  return <div className="m-page m-stack">
    <div className="m-title"><div><h1>Your week in money</h1><p>{range.label}</p></div></div>
    {toggle}
    <section className="m-card m-recap-card">
      <span>You spent</span>
      <strong className="m-recap-total">{money(stats.total)}</strong>
      <small>{stats.count} {stats.count === 1 ? 'purchase' : 'purchases'}{changeLine ? ` · ${changeLine}` : ''}</small>
    </section>
    <section className="m-card m-stack">
      <h2 className="m-h2">Where it went</h2>
      {stats.categories.slice(0, 6).map((row) => <div key={row.name} className="m-recap-row">
        <div className="m-line"><span>{row.name}</span><strong>{money(row.total)}</strong></div>
        <div className="m-bar"><i style={{ width: `${Math.max(3, row.total / stats.categories[0].total * 100)}%` }} /></div>
      </div>)}
    </section>
    <section className="m-card m-stack">
      <h2 className="m-h2">Your top spots</h2>
      {stats.places.slice(0, 5).map((row, i) => <div key={row.name} className="m-line"><span><b className="m-recap-rank">{i + 1}</b>{row.name} <small className="m-muted">· {row.count} {row.count === 1 ? 'visit' : 'visits'}</small></span><strong>{money(row.total)}</strong></div>)}
    </section>
    <section className="m-card m-stack">
      <h2 className="m-h2">Biggest single purchase</h2>
      <div className="m-line"><span>{stats.biggest.label} <small className="m-muted">· {shortDate(stats.biggest.date)} · {stats.biggest.category}</small></span><strong>{money(stats.biggest.amount)}</strong></div>
    </section>
    {(stats.income > 0 || stats.perTrip > 0.5) && <section className="m-card m-stack">
      {stats.income > 0 && <div className="m-line"><span>Money in</span><strong>{money(stats.income)}</strong></div>}
      {stats.income > 0 && <small className="m-muted">{stats.income >= stats.total ? `${money(stats.income - stats.total)} more came in than went out.` : `${money(stats.total - stats.income)} more went out than came in.`}</small>}
      {stats.perTrip > 0.5 && <div className="m-line"><span>Your swaps could save</span><strong>{money(stats.perTrip)} per trip</strong></div>}
    </section>}
    <button type="button" className="m-btn outline" onClick={() => { setIndex(0); setView('slides'); }}>Play the 3 slides</button>
  </div>;
}
