import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useGetTransactions } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ErrorState, Skeleton } from '@/components/margo/chrome';
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

type Slide = { key: string; tone: 'navy' | 'burgundy' | 'green' | 'blush'; kicker: string; big: string; line: string; detail?: string };

/** A tap-through weekly recap: where the money went, in a few big slides. */
export function RecapPage() {
  const [which, setWhich] = useState<'last' | 'now'>(() => new URLSearchParams(window.location.search).get('week') === 'last' ? 'last' : 'now');
  const [index, setIndex] = useState(0);
  const transactions = useGetTransactions();
  const swaps = useQuery({ queryKey: ['my-swaps'], queryFn: fetchMySwaps });
  const [range, before] = rangeFor(which);

  const slides = useMemo<Slide[]>(() => {
    const inRange = (r: Range) => (transactions.data || []).filter((item) => item.date.slice(0, 10) >= r.start && item.date.slice(0, 10) <= r.end);
    const spentIn = (r: Range) => inRange(r).filter((item) => item.type === 'expense');
    const spent = spentIn(range);
    const total = spent.reduce((sum, item) => sum + Number(item.amount), 0);
    const previous = spentIn(before).reduce((sum, item) => sum + Number(item.amount), 0);
    if (!spent.length) return [];
    const group = (key: (item: (typeof spent)[number]) => string) => {
      const map = new Map<string, { total: number; count: number }>();
      spent.forEach((item) => { const k = key(item) || 'Other'; const row = map.get(k) || { total: 0, count: 0 }; row.total += Number(item.amount); row.count += 1; map.set(k, row); });
      return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
    };
    const categories = group((item) => item.category);
    const places = group((item) => item.label);
    const biggest = [...spent].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
    const income = inRange(range).filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount), 0);
    const perTrip = (swaps.data || []).reduce((sum, lookup) => { const best = lookup.suggestions[0]; return sum + (lookup.price && best?.typicalPrice != null ? Math.max(0, lookup.price - best.typicalPrice) : 0); }, 0);
    const change = previous > 0 ? Math.round((total - previous) / previous * 100) : null;
    const list: Slide[] = [{
      key: 'total', tone: 'navy', kicker: range.label, big: money(total),
      line: `spent across ${spent.length} ${spent.length === 1 ? 'purchase' : 'purchases'}`,
      detail: change == null ? undefined : change === 0 ? 'About the same as the week before.' : `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than the week before (${money(previous)}).`,
    }];
    const [topCategory, topCategoryRow] = categories[0];
    list.push({ key: 'category', tone: 'burgundy', kicker: 'Most of it went to', big: topCategory, line: `${money(topCategoryRow.total)} · ${Math.round(topCategoryRow.total / total * 100)}% of what you spent`, detail: categories[1] ? `Next: ${categories.slice(1, 3).map(([name, row]) => `${name} ${money(row.total)}`).join(', ')}.` : undefined });
    const [topPlace, topPlaceRow] = places[0];
    list.push({ key: 'place', tone: 'green', kicker: 'Your top spot', big: topPlace, line: `${money(topPlaceRow.total)} over ${topPlaceRow.count} ${topPlaceRow.count === 1 ? 'visit' : 'visits'}`, detail: places[1] ? `Then ${places.slice(1, 3).map(([name, row]) => `${name} (${money(row.total)})`).join(' and ')}.` : undefined });
    list.push({ key: 'biggest', tone: 'blush', kicker: 'Biggest single purchase', big: money(biggest.amount), line: `${biggest.label} on ${shortDate(biggest.date)}`, detail: biggest.category });
    if (income > 0) list.push({ key: 'income', tone: 'navy', kicker: 'Money in', big: money(income), line: income >= total ? `${money(income - total)} more came in than went out` : `${money(total - income)} more went out than came in` });
    if (perTrip > 0.5) list.push({ key: 'swaps', tone: 'burgundy', kicker: 'Your swaps', big: money(perTrip), line: 'less per trip if you make every swap', detail: 'Open the Swaps tab to see them.' });
    return list;
  }, [transactions.data, swaps.data, range.start, range.end, range.label, before.start, before.end]);

  if (transactions.isLoading) return <div className="m-page"><Skeleton /></div>;
  if (transactions.isError) return <div className="m-page"><ErrorState error={transactions.error} retry={() => void transactions.refetch()} /></div>;

  const pick = (value: 'last' | 'now') => { setWhich(value); setIndex(0); };
  const toggle = <div className="m-segment wide" role="group" aria-label="Which week">
    <button type="button" className={which === 'now' ? 'on' : ''} aria-pressed={which === 'now'} onClick={() => pick('now')}>Past 7 days</button>
    <button type="button" className={which === 'last' ? 'on' : ''} aria-pressed={which === 'last'} onClick={() => pick('last')}>Last week</button>
  </div>;

  if (!slides.length) return <div className="m-page m-stack">
    <h1 className="m-title">Your week in money</h1>
    {toggle}
    <div className="m-card m-stack"><strong>Nothing to recap yet</strong><span className="m-muted">No spending shows up for {which === 'last' ? 'last week' : 'the past 7 days'}. Connect a bank or add a purchase and your recap fills in.</span><Link className="m-btn navy" href="/transactions">Go to Spending</Link></div>
  </div>;

  const slide = slides[Math.min(index, slides.length - 1)];
  const last = index >= slides.length - 1;
  return <div className={`m-recap ${slide.tone}`}>
    <div className="m-recap-bars" aria-hidden="true">{slides.map((item, i) => <i key={item.key} className={i <= index ? 'on' : ''} />)}</div>
    <div className="m-recap-top">
      <span>Your week in money</span>
      <Link href="/" aria-label="Close recap" className="m-recap-close"><X aria-hidden="true" /></Link>
    </div>
    <div className="m-recap-body" aria-live="polite">
      <span className="m-recap-ring" aria-hidden="true" /><span className="m-recap-ring two" aria-hidden="true" />
      <p className="m-recap-kicker">{slide.kicker}</p>
      <p className={`m-recap-big ${slide.big.length > 13 ? 'long' : slide.big.length > 7 ? 'mid' : ''}`}>{slide.big}</p>
      <p className="m-recap-line">{slide.line}</p>
      {slide.detail && <p className="m-recap-detail">{slide.detail}</p>}
    </div>
    <div className="m-recap-nav">
      <button type="button" className="m-recap-step" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0} aria-label="Back"><ChevronLeft aria-hidden="true" /></button>
      <span>{index + 1} of {slides.length}</span>
      {last ? <Link className="m-recap-step done" href="/">Done</Link> : <button type="button" className="m-recap-step" onClick={() => setIndex(index + 1)} aria-label="Next"><ChevronRight aria-hidden="true" /></button>}
    </div>
    <div className="m-recap-toggle">{toggle}</div>
  </div>;
}
