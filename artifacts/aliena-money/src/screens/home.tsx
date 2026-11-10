import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
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
import { artFor, bandFor, fetchSwapCatalog, rowArt, rowSavings } from '@/lib/swap-catalog';
import { cents, dayKey, greeting, messageOf, money, shortDate } from '@/lib/format';

export function HomePage() {
  const { user } = useUser();
  const dashboard = useGetFinanceDashboard();
  const plan = useGetBudgetPlan();
  const transactions = useGetTransactions();
  const comparisons = useGetProductComparisons();
  const profile = useGetSwapProfile();
  const financeSettings = useGetFinanceSettings();
  const catalog = useQuery({ queryKey: ['swap-catalog'], queryFn: () => fetchSwapCatalog() });
  const qc = useQueryClient();
  const [period, setPeriod] = useState<'month' | 'week'>('month');
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const firstName = user?.firstName?.trim();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const scale = period === 'month' ? 1 : 7 / Math.max(1, monthDays);
  const inPeriod = (date: string) => {
    const day = date.slice(0, 10);
    return day >= dayKey(period === 'month' ? monthStart : weekStart) && day <= dayKey(now);
  };
  const periodTransactions = (transactions.data || []).filter((item) => inPeriod(item.date));
  const expenses = periodTransactions.filter((item) => item.type === 'expense');
  const spent = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const monthlyBudget = (plan.data?.categories || []).reduce((sum, item) => sum + Number(item.monthlyTarget || 0), 0);
  const cap = monthlyBudget * scale;
  const left = Math.max(0, cap - spent);
  const daysRemaining = period === 'month' ? Math.max(1, monthDays - now.getDate() + 1) : 7;
  const taxRate = Number(financeSettings.data?.taxReserveRate ?? 25);
  const periodTaxableIncome = periodTransactions
    .filter((item) => item.type === 'income' && item.isTaxable && item.incomeReviewStatus !== 'not-taxable')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const taxSetAside = periodTaxableIncome * taxRate / 100;
  const savedWithSwaps = Number(dashboard.data?.annualSavings || 0) / (period === 'month' ? 12 : 52);
  const savingsPct = plan.data?.annualIncome ? Math.round(Number(plan.data.annualSavingsGoal || 0) / Number(plan.data.annualIncome) * 100) : 0;
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now);
  const pendingIncome = (transactions.data || []).filter((item) => item.type === 'income' && item.incomeReviewStatus === 'pending');
  const answers = profile.data?.onboardingAnswers || {};
  const debtBalance = Number(answers.debtBalance || 0);
  const debtPayment = Number(answers.debtPayment || 0);
  const progress = cap > 0 ? Math.min(100, spent / cap * 100) : 0;

  const rows = useMemo(() => {
    const planned = plan.data?.categories?.length
      ? plan.data.categories
      : ['Groceries', 'Transportation', 'Dining out', 'Shopping', 'Personal care', 'Subscriptions'].map((category) => ({ category, monthlyTarget: 0 }));
    const seen = new Set(planned.map((item) => item.category.toLowerCase()));
    const extra = Array.from(new Set((transactions.data || []).filter((item) => item.type === 'expense').map((item) => item.category)))
      .filter((category) => !seen.has(category.toLowerCase()))
      .map((category) => ({ category, monthlyTarget: 0 }));
    return [...planned, ...extra];
  }, [plan.data?.categories, transactions.data]);

  const topComparison = comparisons.data?.slice().sort((a, b) => b.annualSavings - a.annualSavings)[0];
  const topCatalog = catalog.data?.filter((row) => rowSavings(row) != null).sort((a, b) => (rowSavings(b) || 0) - (rowSavings(a) || 0))[0];

  return <div className="m-page">
    <div className="m-title-row">
      <h1 className="m-h1-sm">{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
      <div className="m-segment" role="group" aria-label="Budget period">
        {(['month', 'week'] as const).map((value) => <button type="button" key={value} className={period === value ? 'on' : ''} aria-pressed={period === value} onClick={() => setPeriod(value)} data-testid={`button-period-${value}`}>{value === 'month' ? 'Month' : 'Week'}</button>)}
      </div>
    </div>

    {(dashboard.isError || plan.isError || transactions.isError) && <ErrorState error={dashboard.error || plan.error || transactions.error} retry={() => { void Promise.all([dashboard.refetch(), plan.refetch(), transactions.refetch()]); }} />}

    <section className="m-hero" aria-label="Left to spend">
      <span className="m-hero-label">Left to spend {period === 'month' ? `in ${monthName}` : 'this week'}</span>
      <span className="m-hero-amount" data-testid="text-left-to-spend">{plan.isLoading || transactions.isLoading ? '…' : money(left)}</span>
      <div className="m-bar on-navy"><i style={{ width: `${progress}%` }} /></div>
      <div className="m-hero-foot"><span>{money(spent)} spent of {money(cap)}</span><span>About {money(left / daysRemaining)} a day</span></div>
    </section>

    <div className="m-tiles">
      <Link href="/swaps" className="m-tile" data-testid="metric-saved-with-swaps"><span>Saved with swaps</span><strong>{money(savedWithSwaps)}</strong><small>{period === 'month' ? 'This month' : 'This week'}</small></Link>
      <Link href="/settings" className="m-tile" data-testid="metric-tax-set-aside"><span>Tax set-aside</span><strong>{money(taxSetAside)}</strong><small>At {taxRate}%</small></Link>
      <Link href="/settings" className="m-tile" data-testid="metric-savings-goal"><span>Savings goal</span><strong>{savingsPct}%</strong><small>Of take-home</small></Link>
    </div>

    <IncomeReviewCards items={pendingIncome} taxRate={taxRate} />

    <section className="m-section">
      <div className="m-section-head"><h2>Budget</h2><span>Tap a category</span></div>
      {plan.isLoading ? <div className="m-card"><Skeleton lines={4} /></div> : <div className="m-card m-list">
        {rows.map((row) => {
          const items = expenses.filter((tx) => tx.category.toLowerCase() === row.category.toLowerCase()).sort((a, b) => b.date.localeCompare(a.date));
          const amount = items.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
          const target = Number(row.monthlyTarget || 0) * scale;
          const over = target > 0 && amount > target;
          const pct = target > 0 ? Math.min(100, amount / target * 100) : 0;
          const open = expanded === row.category;
          const match = comparisons.data?.find((item) => item.category.toLowerCase() === row.category.toLowerCase());
          const slug = row.category.toLowerCase().replaceAll(' ', '-');
          return <div className="m-budget-row" key={row.category} data-testid={`category-${slug}`}>
            <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? null : row.category)}>
              <span className="m-budget-top">
                <strong>{row.category}</strong>
                <span className="m-muted">{target > 0 ? <><b className={over ? 'over' : ''}>{money(Math.abs(target - amount))}</b> {over ? 'over' : 'left'}</> : 'No budget yet'}<ChevronDown className={open ? 'turned' : ''} aria-hidden="true" /></span>
              </span>
              <span className="m-bar"><i className={over ? 'over' : pct > 85 ? 'warn' : ''} style={{ width: `${over ? 100 : pct}%` }} /></span>
            </button>
            {open && <div className="m-budget-detail">
              <span className="m-muted">{money(amount)} spent{target > 0 ? ` of ${money(target)}` : ''}</span>
              {items.length ? items.slice(0, 3).map((tx) => <div className="m-line" key={tx.id}><span>{tx.label} <span className="m-muted">· {shortDate(tx.date)}</span></span><strong>{money(tx.amount)}</strong></div>) : <span className="m-muted">No purchases here yet this {period}.</span>}
              {match && <Link href="/swaps" className="m-tip"><span>Try {match.alternativeName} instead of {match.productName}. About {money(match.annualSavings)} a year back.</span><ChevronRight aria-hidden="true" /></Link>}
            </div>}
          </div>;
        })}
        {!plan.data?.categories?.length && <Link href="/settings" className="m-tip">Set your category budgets<ChevronRight aria-hidden="true" /></Link>}
      </div>}
    </section>

    <section className="m-section">
      <h2>Swap of the week</h2>
      {topComparison ? <Link href="/swaps" className="m-card m-sotw">
        <div className="m-pair-art"><ProductArt art={artFor(`${topComparison.category} ${topComparison.productName}`)} band={bandFor(topComparison.productName)} label={topComparison.productName} /><ProductArt art={artFor(`${topComparison.category} ${topComparison.productName}`)} band={bandFor(topComparison.alternativeName, true)} label={topComparison.alternativeName} /></div>
        <div className="m-sotw-foot"><span><strong>{topComparison.productName}</strong><small>{cents(topComparison.unitPrice)} → {cents(topComparison.alternativePrice)}</small></span><span className="m-save-tag">Save {money(topComparison.annualSavings)}/yr</span></div>
      </Link> : topCatalog ? <Link href={`/swaps/${encodeURIComponent(topCatalog.id)}`} className="m-card m-sotw">
        <div className="m-pair-art"><ProductArt art={rowArt(topCatalog)} band={bandFor(topCatalog.originalProduct)} label={topCatalog.originalProduct} /><ProductArt art={rowArt(topCatalog)} band={bandFor(topCatalog.swapProduct, true)} label={topCatalog.swapProduct} /></div>
        <div className="m-sotw-foot"><span><strong>{topCatalog.originalProduct}</strong><small>{cents(topCatalog.originalPrice)} → {cents(topCatalog.swapPrice)}{topCatalog.swapRetailer ? ` at ${topCatalog.swapRetailer}` : ''}</small></span><span className="m-save-tag">Save {cents(rowSavings(topCatalog))}</span></div>
      </Link> : <div className="m-card m-muted">Scan a receipt and I'll find a swap worth making.</div>}
    </section>

    {(debtBalance > 0 || answers.hasDebt === 'Yes') && <DebtPayoffCard balance={debtBalance} monthlyPayment={debtPayment} startBalance={Number(answers.debtStartBalance || debtBalance)} />}

    {dashboard.data?.recentTransactions?.length ? <section className="m-section">
      <div className="m-section-head"><h2>Latest spending</h2><Link href="/transactions" className="m-link">See all</Link></div>
      <div className="m-card m-list"><TransactionRows items={dashboard.data.recentTransactions.slice(0, 4)} /></div>
    </section> : null}
  </div>;
}

function DebtPayoffCard({ balance, monthlyPayment, startBalance }: { balance: number; monthlyPayment: number; startBalance: number }) {
  const [extra, setExtra] = useState(0);
  const now = new Date();
  const payment = monthlyPayment + extra;
  const date = balance > 0 && payment > 0 ? new Date(now.getFullYear(), now.getMonth() + Math.ceil(balance / payment), 1) : null;
  const paidPct = startBalance > 0 ? Math.min(100, Math.max(4, (1 - balance / startBalance) * 100)) : 4;
  return <section className="m-section" data-testid="card-debt-payoff">
    <h2>Debt payoff</h2>
    <div className="m-card m-stack">
      <div className="m-line"><strong>Debt</strong><span className="m-muted">{money(balance)} left</span></div>
      <div className="m-bar"><i className="olive" style={{ width: `${paidPct}%` }} /></div>
      <span data-testid="text-debt-free-date">{date ? <>Debt-free by <strong>{new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date)}</strong></> : !balance ? 'Add your debt balance in Settings to see a date.' : 'Add a monthly payment in Settings to see a date.'}</span>
      <div className="m-chips" role="group" aria-label="Monthly payoff pace">
        {[0, 50, 100].map((amount) => <button type="button" key={amount} className={`m-chip square ${extra === amount ? 'on' : ''}`} aria-pressed={extra === amount} onClick={() => setExtra(amount)} data-testid={`button-debt-extra-${amount}`}>{amount === 0 ? 'Current pace' : `+$${amount}/mo`}</button>)}
      </div>
      <span className="m-muted small">Try paying a little extra each month to see your new date. Estimates leave out interest.</span>
    </div>
  </section>;
}

export function TransactionRows({ items, onDelete, showDate = true, contextNotes = {} }: { items: Transaction[]; onDelete?: (id: string) => void; showDate?: boolean; contextNotes?: Record<string, string> }) {
  return <>{items.map((item) => <div className="m-tx" key={item.id} data-testid={`transaction-${item.id}`}>
    <span className={`m-tx-icon ${item.type}`}>{item.type === 'income' ? <ArrowDownLeft aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}</span>
    <span className="m-tx-copy">
      <strong>{item.label}</strong>
      <small>{item.type === 'income' && item.incomeReviewStatus === 'pending' ? 'Income · not your usual paycheck' : item.category}{showDate ? ` · ${shortDate(item.date)}` : item.source ? ` · ${item.source}` : ''}</small>
      {contextNotes[item.id] && <small className="m-tx-note">{contextNotes[item.id]}</small>}
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
