import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useGetTransactions } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ErrorState, Skeleton } from '@/components/margo/chrome';
import { MargoMascot } from '@/components/margo/mascot';
import { fetchMySwaps } from '@/components/margo/engine';
import { dayKey, money, shortDate } from '@/lib/format';

type Period = 'week' | 'month' | 'year';
type Range = { start: string; end: string; label: string; phrase: string; compare: string };
const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return dayKey(d); };
const monthName = (d: Date) => new Intl.DateTimeFormat('en-US', { month: 'long' }).format(d);

/** The stretch of time a recap covers, plus the stretch just before it to compare against. */
function rangeFor(period: Period, last: boolean): [Range, Range | null] {
  const now = new Date();
  const none = { label: '', phrase: '', compare: '' };
  if (period === 'week') {
    const sinceMonday = (now.getDay() + 6) % 7;
    if (!last) return [{ start: shift(-sinceMonday), end: shift(0), label: 'This week so far', phrase: 'So far this week', compare: '' }, null];
    const start = shift(-sinceMonday - 7), end = shift(-sinceMonday - 1);
    return [{ start, end, label: `${shortDate(start)} to ${shortDate(end)}`, phrase: 'Last week', compare: 'the week before' }, { start: shift(-sinceMonday - 14), end: shift(-sinceMonday - 8), ...none }];
  }
  if (period === 'month') {
    if (!last) return [{ start: dayKey(new Date(now.getFullYear(), now.getMonth(), 1)), end: dayKey(now), label: `${monthName(now)} so far`, phrase: 'This month', compare: '' }, null];
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return [
      { start: dayKey(first), end: dayKey(new Date(now.getFullYear(), now.getMonth(), 0)), label: `${monthName(first)} ${first.getFullYear()}`, phrase: `In ${monthName(first)}`, compare: 'the month before' },
      { start: dayKey(new Date(now.getFullYear(), now.getMonth() - 2, 1)), end: dayKey(new Date(now.getFullYear(), now.getMonth() - 1, 0)), ...none },
    ];
  }
  const year = now.getFullYear() - (last ? 1 : 0);
  return [{ start: `${year}-01-01`, end: last ? `${year}-12-31` : dayKey(now), label: last ? `${year}` : `${year} so far`, phrase: last ? `In ${year}` : 'This year', compare: last ? 'the year before' : '' },
    last ? { start: `${year - 1}-01-01`, end: `${year - 1}-12-31`, ...none } : null];
}

type Row = { name: string; total: number; count: number };
type Stats = { total: number; count: number; previous: number; change: number | null; categories: Row[]; places: Row[]; biggest: { label: string; amount: number; date: string; category: string }; income: number; perTrip: number };

/** The weekly recap: three quick slides with Margo, then everything on one page. */
export function RecapPage() {
  const params = new URLSearchParams(window.location.search);
  const [period, setPeriod] = useState<Period>(() => (['week', 'month', 'year'] as const).find((value) => value === params.get('period')) || 'week');
  const [last, setLast] = useState(() => params.get('last') === '1' || params.get('week') === 'last');
  const [view, setView] = useState<'slides' | 'full'>(() => params.get('view') === 'full' ? 'full' : 'slides');
  const [index, setIndex] = useState(0);
  const transactions = useGetTransactions();
  const swaps = useQuery({ queryKey: ['my-swaps'], queryFn: fetchMySwaps });
  const [range, before] = rangeFor(period, last);

  const stats = useMemo<Stats | null>(() => {
    const inRange = (r: Range) => (transactions.data || []).filter((item) => item.date.slice(0, 10) >= r.start && item.date.slice(0, 10) <= r.end);
    const spent = inRange(range).filter((item) => item.type === 'expense');
    if (!spent.length) return null;
    const total = spent.reduce((sum, item) => sum + Number(item.amount), 0);
    const previous = !before ? 0 : inRange(before).filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
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
  }, [transactions.data, swaps.data, range.start, range.end, before?.start, before?.end]);

  if (transactions.isLoading) return <div className="m-page"><Skeleton /></div>;
  if (transactions.isError) return <div className="m-page"><ErrorState error={transactions.error} retry={() => void transactions.refetch()} /></div>;

  const pick = (value: Period) => { setPeriod(value); setLast(false); setIndex(0); };
  const toggle = <div className="m-segment wide" role="group" aria-label="Time period">
    {(['week', 'month', 'year'] as const).map((value) => <button key={value} type="button" className={period === value ? 'on' : ''} aria-pressed={period === value} onClick={() => pick(value)}>{value === 'week' ? 'Week' : value === 'month' ? 'Month' : 'Year'}</button>)}
  </div>;
  const title = period === 'week' ? 'Your week in money' : period === 'month' ? 'Your month in money' : 'Your year in money';

  if (!stats) return <div className="m-page m-stack">
    <div className="m-title"><div><h1>{title}</h1></div></div>
    {toggle}
    <div className="m-card m-stack"><strong>Nothing to recap yet</strong><span className="m-muted">No spending shows up for {range.label.toLowerCase()}. Connect a bank or add a purchase and your recap fills in.</span>{!last && <button type="button" className="m-btn navy" onClick={() => { setLast(true); setIndex(0); }}>See last {period}</button>}<Link className="m-btn outline" href="/transactions">Go to Spending</Link></div>
  </div>;

  const changeLine = stats.change == null || !range.compare ? '' : stats.change === 0 ? `About the same as ${range.compare}.` : `${Math.abs(stats.change)}% ${stats.change > 0 ? 'more' : 'less'} than ${range.compare}.`;
  const [topCategory] = stats.categories;
  const [topPlace] = stats.places;

  if (view === 'slides') {
    const slides = [
      { tone: 'navy', pose: 'receipt' as const, kicker: `${range.phrase} you spent`, big: money(stats.total), line: `across ${stats.count} ${stats.count === 1 ? 'purchase' : 'purchases'}. ${changeLine}` },
      { tone: 'green', pose: 'bags' as const, kicker: 'Most of it went to', big: topCategory.name, line: `${money(topCategory.total)}, which is ${Math.round(topCategory.total / stats.total * 100)}% of what you spent.` },
      { tone: 'burgundy', pose: 'pin' as const, kicker: 'Your top spot was', big: topPlace.name, line: `${money(topPlace.total)} over ${topPlace.count} ${topPlace.count === 1 ? 'visit' : 'visits'}.` },
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
      <div className="m-guide"><MargoMascot pose={slide.pose} /></div>
      <div className="m-recap-nav">
        <button type="button" className="m-recap-step" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0} aria-label="Back"><ChevronLeft aria-hidden="true" /></button>
        {last
          ? <button type="button" className="m-recap-step done" onClick={() => setView('full')}>See my full recap</button>
          : <button type="button" className="m-recap-step done" onClick={() => setIndex(index + 1)}>Next<ChevronRight aria-hidden="true" /></button>}
      </div>
    </div>;
  }

  return <div className="m-page m-stack">
    <div className="m-title"><div><h1>{title}</h1><p>{range.label}</p></div></div>
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
