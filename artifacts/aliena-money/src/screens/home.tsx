import { isIncome, isSpending, needsALook } from '@/lib/money-kinds';
import { SortQuestions } from '@/components/margo/sort-question';
import { useAccounts, useDebts } from '@/lib/accounts';
import { monthLabel, payoffPlan } from '@/lib/debt-plan';
import { BubblePit } from '@/components/margo/bubble-pit';
import { InstallTip } from '@/components/margo/install-tip';
import { MargoSays } from '@/components/margo/characters';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  customFetch, getGetBudgetPlanQueryKey, getGetFinanceDashboardQueryKey, getGetTransactionsQueryKey,
  useGetBudgetPlan, useGetFinanceDashboard, useGetFinanceSettings, useGetProductComparisons,
  useGetSwapProfile, useGetTransactions, useReviewIncome,
} from '@workspace/api-client-react';
import type { Transaction } from '@workspace/api-client-react';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { ErrorState, Skeleton } from '@/components/margo/chrome';
import { ProductArt } from '@/components/margo/art';
import { artFor, bandFor } from '@/lib/swap-catalog';
import { fetchMySwaps } from '@/components/margo/engine';
import { cents, dayKey, greeting, messageOf, money, shortDate, withinDays } from '@/lib/format';

type TodayCard = {
  key: string; tag: string; title: string; body: string;
  yes?: { label: string; run: () => Promise<void> | void }; no?: { label: string; run: () => Promise<void> | void };
  done?: string;
};

/** Monday of last week, as YYYY-MM-DD. */
const lastWeekStart = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); return dayKey(d); };
const weekSeen = (key: string) => { try { return window.localStorage.getItem(`margo-${key}`) === '1'; } catch { return false; } };
const dismissWeek = (key: string) => { try { window.localStorage.setItem(`margo-${key}`, '1'); } catch { /* fine without storage */ } };

const todayKey = () => `margo-today-${dayKey(new Date())}`;
const readDismissed = (): string[] => { try { return JSON.parse(window.localStorage.getItem(todayKey()) || '[]'); } catch { return []; } };
const writeDismissed = (keys: string[]) => { try { window.localStorage.setItem(todayKey(), JSON.stringify(keys)); } catch { /* fine without storage */ } };

/** Army green that only gets darker as a budget fills up. It never turns red. */
function bubbleShade(used: number): [string, string] {
  // A smooth army green: every percent gets its own shade, light when barely used, deepest when over. Never red.
  const t = Math.min(1, Math.max(0, used / 1.2));
  const light = [223, 227, 200], dark = [51, 54, 15];
  const mix = light.map((value, i) => Math.round(value + (dark[i] - value) * t));
  return [`rgb(${mix.join(', ')})`, t > 0.48 ? '#FFFFFF' : '#0B1F4B'];
}

export function HomePage() {
  const { user } = useUser();
  const dashboard = useGetFinanceDashboard();
  const plan = useGetBudgetPlan();
  const transactions = useGetTransactions();
  const profile = useGetSwapProfile();
  const financeSettings = useGetFinanceSettings();
  const mySwaps = useQuery({ queryKey: ['my-swaps'], queryFn: fetchMySwaps });
  const review = useReviewIncome();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [period, setPeriod] = useState<'month' | 'week'>('month');
  const [selected, setSelected] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [confirmation, setConfirmation] = useState<TodayCard | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    // Pull new bank activity when Home opens. The server skips banks refreshed in the last few hours.
    let cancelled = false;
    customFetch<{ imported?: number }>('/api/plaid/sync-all', { method: 'POST' })
      .then((result: { imported?: number } | null) => {
        if (cancelled || !result?.imported) return;
        void Promise.all([
          qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() }),
          qc.invalidateQueries({ queryKey: ['plaid-items'] }),
        ]);
      })
      .catch(() => { /* Bank refresh is best-effort; manual Refresh lives in Settings. */ });
    return () => { cancelled = true; };
  }, [qc]);

  // Their first name: from sign-in, else their full name or username, else the start of their email ("miley.w@..." -> "Miley").
  const emailName = (user?.primaryEmailAddress?.emailAddress || '').split('@')[0].split(/[._+\-0-9]/)[0];
  const rawName = user?.firstName?.trim() || user?.fullName?.trim().split(/\s+/)[0] || user?.username?.trim() || (emailName.length >= 2 ? emailName : '');
  const firstName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : '';
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const scale = period === 'month' ? 1 : 7 / monthDays;
  const from = dayKey(period === 'month' ? monthStart : weekStart);
  const inPeriod = (date: string) => date.slice(0, 10) >= from && date.slice(0, 10) <= dayKey(now);
  const periodTx = (transactions.data || []).filter((item) => inPeriod(item.date));
  // Only real spending: rent, card payments, savings and transfers don't eat into what's left to spend.
  const expenses = periodTx.filter(isSpending);
  const spent = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const income = periodTx.filter(isIncome).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const categories = plan.data?.categories || [];
  const budget = categories.reduce((sum, item) => sum + Number(item.monthlyTarget || 0), 0) * scale;
  const left = Math.max(0, budget - spent);
  const savingsGoal = Number(plan.data?.annualSavingsGoal || 0) / 12 * scale;
  const savedSoFar = Math.max(0, Math.min(savingsGoal, income - spent));
  // With a savings account connected, "saved" is money that actually moved into savings, not just what's left over.
  const realSavings = useAccounts().data?.savings ?? null;
  const taxRate = Number(financeSettings.data?.taxReserveRate ?? 25);
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now);
  const answers = profile.data?.onboardingAnswers || {};
  const debtBalance = Number(answers.debtBalance || 0);

  const rows = useMemo(() => categories.map((item) => {
    const target = Number(item.monthlyTarget || 0) * scale;
    const items = expenses.filter((tx) => tx.category.toLowerCase() === item.category.toLowerCase()).sort((a, b) => b.date.localeCompare(a.date));
    const used = items.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    return { name: item.category, target, used, items, monthly: Number(item.monthlyTarget || 0) };
  }), [categories, expenses, scale]);

  /* ---------- For you today ---------- */
  const dismiss = (key: string) => { const next = [...dismissed, key]; setDismissed(next); writeDismissed(next); };
  const refreshMoney = () => Promise.all([
    qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }),
  ]);
  const cards: TodayCard[] = [];
  (transactions.data || []).filter((item) => item.type === 'income' && item.incomeReviewStatus === 'pending' && withinDays(item.date, 7)).slice(0, 2).forEach((item) => {
    const amount = Number(item.amount) * taxRate / 100;
    cards.push({
      key: `income-${item.id}`, tag: 'New income', title: `${money(item.amount)} from ${item.label}`,
      body: `Not your usual paycheck. Many people set aside 25 to 30% of side income for taxes. Want to plan for ${money(amount)}?`,
      yes: { label: `Plan ${money(amount)}`, run: async () => {
        await review.mutateAsync({ id: item.id, data: { decision: 'set-aside' } }); await refreshMoney();
        setConfirmation({ key: `income-${item.id}`, tag: 'Tax set-aside', title: `${money(amount)} planned for taxes`, body: "It's in your tax set-aside now, so it won't count as money to spend. Move it to savings whenever you're ready.", done: 'Got it' });
      } },
      no: { label: 'Not taxable', run: async () => { await review.mutateAsync({ id: item.id, data: { decision: 'not-taxable' } }); await refreshMoney(); } },
    });
  });
  // Once a week, and around the end of each month: an invitation to the recap.
  const nowDate = new Date();
  const monthEnd = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
  const recapMonth = nowDate.getDate() <= 5 ? new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1) : nowDate.getDate() >= monthEnd - 1 ? nowDate : null;
  if (recapMonth) {
    const key = `recap-month-${dayKey(recapMonth).slice(0, 7)}`;
    const name = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(recapMonth);
    cards.push({
      key, tag: 'Your month in money', title: `Your ${name} recap is ready`,
      body: `See where your money went in ${name}: your top category, your top spot and how it compares.`,
      yes: { label: `See ${name}`, run: () => { dismissWeek(key); setLocation(`/recap?period=month${recapMonth === nowDate ? '' : '&last=1'}`); } }, no: { label: 'Later', run: () => dismissWeek(key) },
    });
  }
  cards.push({
    key: `recap-${lastWeekStart()}`, tag: 'Your week in money', title: 'Your weekly recap is ready',
    body: 'See where your money went last week: your top category, your top spot and your biggest purchase.',
    yes: { label: 'See my week', run: () => { dismissWeek(`recap-${lastWeekStart()}`); setLocation('/recap?period=week&last=1'); } }, no: { label: 'Later', run: () => dismissWeek(`recap-${lastWeekStart()}`) },
  });
  const swap = mySwaps.data?.find((lookup) => lookup.suggestions[0] && !dismissed.includes(`swap-${lookup.id}`));
  if (swap) {
    const best = swap.suggestions[0];
    const save = swap.price && best.typicalPrice != null ? swap.price - best.typicalPrice : 0;
    cards.push({
      key: `swap-${swap.id}`, tag: 'Swap found', title: `${swap.brand || swap.productName} to ${best.brand || best.name}`,
      body: `${best.whySimilar[0] || best.matchType}.${save > 0.25 ? ` About ${cents(save)} less.` : ''}`,
      yes: { label: 'See swap', run: () => setLocation('/swaps') }, no: { label: 'Skip', run: () => undefined },
    });
  }
  const close = rows.filter((row) => row.target > 0 && row.used / row.target >= 0.8).sort((a, b) => b.used / b.target - a.used / a.target)[0];
  if (close) {
    const over = close.used > close.target;
    cards.push({
      key: `budget-${close.name}-${period}`, tag: over ? 'Over budget' : 'Heads up',
      title: over ? `${close.name} is ${money(close.used - close.target)} over` : `${close.name} is at ${Math.round(close.used / close.target * 100)}%`,
      body: over ? 'Want to cover it from a category with room left? You can move budgets in Settings.' : `You have ${money(close.target - close.used)} left ${period === 'month' ? 'this month' : 'this week'}.`,
      yes: { label: over ? 'Adjust budgets' : 'Got it', run: () => { if (over) setLocation('/settings'); } }, no: { label: 'Not now', run: () => undefined },
    });
  }
  const queue = cards.filter((card) => !dismissed.includes(card.key) && !(card.key.startsWith('recap-') && weekSeen(card.key)));
  const current = confirmation || queue[0];
  const act = async (card: TodayCard, choice: 'yes' | 'no' | 'done') => {
    setError('');
    try {
      if (choice === 'done') { setConfirmation(null); return; }
      const handler = choice === 'yes' ? card.yes : card.no;
      await handler?.run();
      dismiss(card.key);
    } catch (reason) { setError(messageOf(reason)); }
  };

  /* ---------- Hero ---------- */
  const spentShare = budget > 0 ? Math.min(1, Math.max(0, (budget - left) / budget)) : 0;
  const periodEnd = period === 'month' ? new Date(now.getFullYear(), now.getMonth() + 1, 0) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - ((now.getDay() + 6) % 7)) - 1);
  const daysLeft = Math.max(1, Math.round((periodEnd.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000) + 1);
  const sel = rows.find((row) => row.name === selected) || rows[0];
  const loading = plan.isLoading || transactions.isLoading;

  return <div className="m-page">
    <div className="m-title-row">
      <div><small className="m-muted block">{new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(now)}</small><h1 className="m-h1-sm">{greeting()}{firstName ? `, ${firstName}` : ''}</h1></div>
    </div>

    {(plan.isError || transactions.isError) && <ErrorState error={plan.error || transactions.error} retry={() => { void Promise.all([plan.refetch(), transactions.refetch()]); }} />}

    <section className="m-hero2" aria-label="Left to spend">
      <div className="m-hero2-top">
        <div className="m-segment on-navy" role="group" aria-label="Budget period">
          {(['week', 'month'] as const).map((value) => <button type="button" key={value} className={period === value ? 'on' : ''} aria-pressed={period === value} onClick={() => setPeriod(value)} data-testid={`button-period-${value}`}>{value === 'month' ? 'Month' : 'Week'}</button>)}
        </div>
      </div>
      <span className="m-hero2-label">Left to spend {period === 'month' ? `in ${monthName}` : 'this week'}</span>
      <strong className="m-hero2-amount" data-testid="text-left-to-spend">{loading ? '…' : money(left)}</strong>
      <span className="m-hero2-label">of {money(budget)}, with {daysLeft} {daysLeft === 1 ? 'day' : 'days'} to go</span>
      <div className="m-hero2-bar" role="img" aria-label={`${Math.round(spentShare * 100)}% of your budget spent`}><i style={{ width: `${Math.round(spentShare * 100)}%` }} /></div>
      <div className="m-hero2-stats">
        <span>Spent <b>{money(Math.max(0, budget - left))}</b></span>
        {realSavings && period === 'month' ? <span>Moved to savings <b>{money(Math.max(0, realSavings.changeThisMonth))}{savingsGoal > 0 ? ` of ${money(savingsGoal)}` : ''}</b></span>
          : savingsGoal > 0 && <span>Left over <b>{money(savedSoFar)} of {money(savingsGoal)}</b></span>}
        <Link href={`/recap?view=full&period=${period}`} className="m-hero2-link" data-testid="link-ring-recap">Recap</Link>
      </div>
    </section>

    <MoneyTiles />

    <SortQuestions items={(transactions.data || []).filter(needsALook)} />
    <InstallTip />

    <section className="m-section">
      <div className="m-section-head"><h2>For you today</h2><span>{current ? `${Math.min(cards.length, dismissed.filter((key) => cards.some((card) => card.key === key)).length + 1)} of ${cards.length}` : ''}</span></div>
      {current ? <MargoSays className="m-today-say">
        <div aria-live="polite" className="m-stack tight">
          <span className="m-today-tag">{current.tag}</span>
          <strong className="m-today-title">{current.title}</strong>
          <span>{current.body}</span>
        </div>
        {error && <div className="m-error" role="alert">{error}</div>}
        {current.done ? <button className="m-btn navy" onClick={() => void act(current, 'done')}>{current.done}</button>
          : <div className="m-today-actions">
            {current.yes && <button className="m-btn navy" disabled={review.isPending} onClick={() => void act(current, 'yes')}>{current.yes.label}</button>}
            {current.no && <button className="m-btn outline" disabled={review.isPending} onClick={() => void act(current, 'no')}>{current.no.label}</button>}
          </div>}
      </MargoSays> : <MargoSays>
        <strong>You're all caught up.</strong> Scan a receipt and I'll look for cheaper swaps. <Link href="/receipts?scan=receipt" className="m-link">Scan a receipt</Link>
      </MargoSays>}
    </section>

    <section className="m-section">
      <h2 className="m-left-title">You have <span>{money(left)}</span> left to spend</h2>
      {!categories.length ? <Link href="/settings" className="m-card m-tip">Set your category budgets<ChevronRight aria-hidden="true" /></Link> : <div className="m-bubble-area m-stack">
        <BubblePit selected={sel?.name} onSelect={setSelected} items={rows.map((row) => {
          const used = row.target > 0 ? row.used / row.target : 0;
          const [bg, color] = bubbleShade(used);
          // Bigger (and darker) the closer the budget is to its limit; a nearly untouched budget stays small.
          // Grows with every percent spent. Past the limit it keeps growing, more slowly, so no two different amounts match.
          const pct = Math.max(0, used);
          const size = 84 + 70 * Math.min(1, pct) + (pct > 1 ? 36 * (1 - Math.exp(-(pct - 1) * 2)) : 0);
          return {
            key: row.name, size, style: { background: bg, color }, label: `${row.name}, ${Math.round(used * 100)}% of budget used`,
            testId: `category-${row.name.toLowerCase().replaceAll(' ', '-')}`,
            children: <><strong style={{ fontSize: size >= 120 ? 15 : size >= 95 ? 13 : 11 }}>{row.name}</strong><small>{Math.round(used * 100)}% used</small></>,
          };
        })} />
        {sel && <div className="m-bubble-detail">
          <div className="m-line"><strong>{sel.name}</strong><strong className={sel.used > sel.target ? 'burgundy' : ''}>{sel.used > sel.target ? `${money(sel.used - sel.target)} over` : `${money(sel.target - sel.used)} left`}</strong></div>
          <div className="m-bar"><i className={sel.used > sel.target ? 'over' : ''} style={{ width: `${sel.target > 0 ? Math.min(100, sel.used / sel.target * 100) : 0}%` }} /></div>
          {sel.items.length > 0 && <span className="m-muted small">{sel.items.length} {sel.items.length === 1 ? 'purchase' : 'purchases'} {period === 'month' ? 'this month' : 'this week'}, newest first</span>}
          {sel.items.length ? [...sel.items].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((tx) => <div className="m-line" key={tx.id}><span>{tx.label} <span className="m-muted">· {shortDate(tx.date)}</span></span><strong>{money(tx.amount)}</strong></div>)
            : <span className="m-muted small">No purchases here yet this {period}.</span>}
        </div>}
        <span className="m-muted small m-bubble-hint">Tap a circle to see what you bought. Drag or flick them for fun.</span>
        <button type="button" className="m-link-button small-link" aria-expanded={showKey} onClick={() => setShowKey((value) => !value)}>{showKey ? 'Hide key' : 'What do the sizes and colors mean?'}</button>
        {showKey && <div className="m-key"><span><i style={{ background: '#DFE3C8' }} />Small and light: plenty left</span><span><i style={{ background: '#4F5320' }} />Big and dark: close to the limit</span><span><i style={{ background: '#33360F' }} />Biggest and darkest: over</span></div>}
      </div>}
    </section>

    <DebtSummaryCard />
  </div>;
}

/** Home summary of the debt plan; the full plan lives on /debt. */
function DebtSummaryCard() {
  const { debts, answers, loading } = useDebts();
  if (loading || !debts.length) return null;
  const strategy = answers.debtStrategy === 'snowball' ? 'snowball' : 'avalanche';
  const extra = Number(answers.debtExtra || 0);
  const plan = payoffPlan(debts, extra, strategy);
  const total = debts.reduce((sum, debt) => sum + debt.balance, 0);
  const target = plan.firstMonth.find((row) => row.isTarget);
  return <section className="m-section" data-testid="card-debt-payoff">
    <h2>Debt payoff</h2>
    <Link href="/debt" className="m-card m-stack m-debt-summary">
      <div className="m-line"><strong>{money(total)}</strong><span className="m-muted">{debts.length} {debts.length === 1 ? 'debt' : 'debts'}</span></div>
      <span data-testid="text-debt-free-date">{plan.payable ? <>Debt-free by <strong>{monthLabel(plan.months)}</strong>, about {money(plan.totalInterest)} in interest</> : <strong>At this pace the debt won't go down. Let's fix the plan.</strong>}</span>
      {target && <span className="m-muted small">This month: put the extra on {target.name}.</span>}
      <span className="m-link">See your plan<ChevronRight aria-hidden="true" /></span>
    </Link>
  </section>;
}

/** Cash, savings and debt at a glance, from connected banks. */
function MoneyTiles() {
  const accounts = useAccounts();
  const list = accounts.data?.accounts ?? [];
  if (!list.length) return null;
  const cash = list.filter((a) => a.type === 'depository' && !a.isSavings).reduce((sum, a) => sum + (a.available ?? a.current ?? 0), 0);
  const savings = accounts.data?.savings;
  const debt = list.filter((a) => a.isDebt).reduce((sum, a) => sum + Math.max(0, a.current ?? 0), 0);
  return <section className="m-money-tiles" aria-label="Your money">
    <div><small>Cash</small><strong>{money(cash)}</strong><span>checking</span></div>
    <div><small>Savings</small><strong>{savings ? money(savings.total) : '—'}</strong><span className={savings && savings.changeThisMonth > 0 ? 'up' : ''}>{savings ? `${savings.changeThisMonth >= 0 ? '+' : '−'}${money(Math.abs(savings.changeThisMonth))} ${savings.sinceConnected ? 'since connected' : 'this month'}` : 'no savings account'}</span></div>
    <Link href="/debt"><small>Debt</small><strong>{money(debt)}</strong><span>see plan</span></Link>
  </section>;
}

export function TransactionRows({ items, onDelete, showDate = true, contextNotes = {} }: { items: Transaction[]; onDelete?: (id: string) => void; showDate?: boolean; contextNotes?: Record<string, string> }) {
  return <>{items.map((item) => <div className="m-tx" key={item.id} data-testid={`transaction-${item.id}`}>
    <span className={`m-tx-icon ${item.type}`}>{item.type === 'income' ? <ArrowDownLeft aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}</span>
    <span className="m-tx-copy">
      <strong>{item.label}</strong>
      <small>{item.type === 'income' && item.incomeReviewStatus === 'pending' ? 'Income · not your usual paycheck' : item.category}{showDate ? ` · ${shortDate(item.date)}` : item.source ? ` · ${item.source}` : ''}</small>
      {contextNotes[item.id] && <small className={`m-tx-note ${/found/.test(contextNotes[item.id]) ? "" : "quiet"}`}>{contextNotes[item.id]}</small>}
    </span>
    <strong className={`m-tx-amount ${item.type}`}>{item.type === 'income' ? '+' : '−'}{money(item.amount)}</strong>
    {onDelete && <button className="m-icon-button" onClick={() => onDelete(item.id)} aria-label={`Delete ${item.label}`} data-testid={`button-delete-transaction-${item.id}`}><Trash2 aria-hidden="true" /></button>}
  </div>)}</>;
}

export function IncomeReviewCards({ items, taxRate }: { items: Transaction[]; taxRate: number }) {
  const qc = useQueryClient();
  const review = useReviewIncome();
  const [notice, setNotice] = useState<{ item: Transaction; text: string; undoUntil: number; canUndo: boolean } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!notice?.undoUntil) return;
    const timer = window.setTimeout(() => setNotice(null), Math.max(0, notice.undoUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [notice]);
  const invalidate = () => Promise.all([
    qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() }),
  ]);
  const decide = async (item: Transaction, decision: 'set-aside' | 'not-taxable' | 'later' | 'undo') => {
    setError('');
    if (decision === 'undo') setNotice(null);
    else setNotice({ item, text: decision === 'set-aside' ? 'Setting aside your tax reserve…' : 'Saving your choice…', undoUntil: Date.now() + 8000, canUndo: false });
    try {
      await review.mutateAsync({ id: item.id, data: { decision } });
      if (decision === 'set-aside') setNotice({ item, text: `${money(Number(item.amount) * taxRate / 100)} set aside for taxes. I'll remember this for ${item.label}.`, undoUntil: Date.now() + 8000, canUndo: true });
      else if (decision === 'undo') setNotice({ item, text: 'Set-aside undone.', undoUntil: Date.now() + 2500, canUndo: false });
      else setNotice({ item, text: decision === 'not-taxable' ? `Got it, ${item.label} isn't taxable. I'll remember that.` : "No rush. I'll ask again later.", undoUntil: Date.now() + 3000, canUndo: false });
      await invalidate();
    } catch (reason) { setNotice(null); setError(messageOf(reason)); }
  };
  if (!items.length && !notice && !error) return null;
  return <div className="m-stack" data-testid="income-review-cards">
    {items.map((item) => <article className="m-income" key={item.id} data-testid={`income-review-${item.id}`}>
      <div className="m-income-top">
        <span className="m-income-icon"><ArrowDownLeft aria-hidden="true" /></span>
        <span><strong>New income: {money(item.amount)} from {item.label}</strong><small>This isn't your usual paycheck. Want to set aside money for taxes?</small></span>
      </div>
      <div className="m-income-actions">
        <button className="m-btn navy small" type="button" disabled={review.isPending} onClick={() => void decide(item, 'set-aside')} data-testid={`button-review-set-aside-${item.id}`}>Set aside {money(Number(item.amount) * taxRate / 100)} ({taxRate}%)</button>
        <button className="m-btn outline small" type="button" disabled={review.isPending} onClick={() => void decide(item, 'not-taxable')} data-testid={`button-review-not-taxable-${item.id}`}>Not taxable</button>
        <button className="m-link-button" type="button" disabled={review.isPending} onClick={() => void decide(item, 'later')} data-testid={`button-review-later-${item.id}`}>Later</button>
      </div>
    </article>)}
    {notice && <div className="m-card m-notice" role="status" data-testid="status-income-review"><span>{notice.text}</span>{notice.canUndo && <button type="button" className="m-link-button bold" onClick={() => void decide(notice.item, 'undo')} data-testid="button-undo-income-review">Undo</button>}</div>}
    {error && <div className="m-error" role="alert">{error}</div>}
  </div>;
}
