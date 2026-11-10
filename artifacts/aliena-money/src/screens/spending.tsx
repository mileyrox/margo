import { useEffect, useMemo, useState } from 'react';
import { useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBudgetPlanQueryKey, getGetFinanceDashboardQueryKey, getGetTransactionsQueryKey,
  useCreateTransaction, useDeleteTransaction, useGetFinanceSettings, useGetProductComparisons, useGetReceipts, useGetTransactions,
} from '@workspace/api-client-react';
import type { Transaction } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { EmptyState, ErrorState, PageTitle, Skeleton } from '@/components/margo/chrome';
import { IncomeReviewCards, TransactionRows } from './home';
import { dayKey, messageOf, money, today, withinDays } from '@/lib/format';

export const spendCategories = ['Rent', 'Groceries', 'Dining out', 'Shopping', 'Personal care', 'Beauty', 'Transportation', 'Subscriptions', 'Utilities'] as const;

export function SpendingPage() {
  const qc = useQueryClient();
  const query = useGetTransactions();
  const receipts = useGetReceipts();
  const comparisons = useGetProductComparisons();
  const financeSettings = useGetFinanceSettings();
  const create = useCreateTransaction();
  const remove = useDeleteTransaction();
  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [selectedMonth, setSelectedMonth] = useState(() => dayKey(new Date()).slice(0, 7));
  const [formOpen, setFormOpen] = useState(() => new URLSearchParams(window.location.search).has('add'));
  const [kind, setKind] = useState<'expense' | 'income'>(() => new URLSearchParams(window.location.search).get('kind') === 'income' ? 'income' : 'expense');
  const [error, setError] = useState('');
  const search = useSearch();
  useEffect(() => { if (new URLSearchParams(search).has('add')) setFormOpen(true); }, [search]);
  const taxRate = Number(financeSettings.data?.taxReserveRate ?? 25);
  const monthRows = useMemo(() => (query.data || []).filter((item) => item.date.slice(0, 7) === selectedMonth).sort((a, b) => b.date.localeCompare(a.date)), [query.data, selectedMonth]);
  // Only ask about income from the past week, so older deposits don't pile up as notifications.
  const pendingIncome = (query.data || []).filter((item) => item.type === 'income' && item.incomeReviewStatus === 'pending' && withinDays(item.date, 7));
  const list = useMemo(() => monthRows.filter((item) => filter === 'all' || item.type === filter), [monthRows, filter]);
  const groups = useMemo(() => {
    const grouped = new Map<string, Transaction[]>();
    list.forEach((item) => grouped.set(item.date.slice(0, 10), [...(grouped.get(item.date.slice(0, 10)) || []), item]));
    const now = new Date();
    const currentDay = dayKey(now);
    const previousDay = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12));
    return Array.from(grouped.entries()).map(([date, items]) => ({
      date,
      label: date === currentDay ? 'Today' : date === previousDay ? 'Yesterday' : new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`)),
      items,
    }));
  }, [list]);
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(`${selectedMonth}-01T12:00:00`));
  const contextNotes = Object.fromEntries(monthRows.flatMap((item) => {
    if (item.type === 'income' && item.incomeReviewStatus === 'set-aside' && item.isTaxable) {
      return [[item.id, `Set aside ${money(Number(item.amount) * taxRate / 100)} for taxes`]];
    }
    const receipt = receipts.data?.find((candidate) => candidate.purchasedAt.slice(0, 10) === item.date.slice(0, 10)
      && candidate.merchant.trim().toLowerCase() === item.label.trim().toLowerCase());
    if (receipt || (item.source && /receipt|scan/i.test(item.source))) {
      const names = new Set((receipt?.items || []).map((line) => line.productName.trim().toLowerCase()));
      const count = receipt
        ? (comparisons.data || []).filter((comparison) => names.has(comparison.productName.trim().toLowerCase())).length
        : comparisons.data?.filter((comparison) => comparison.category.toLowerCase() === item.category.toLowerCase()).length || 0;
      return [[item.id, `Receipt scanned · ${count} ${count === 1 ? 'swap' : 'swaps'} found`]];
    }
    return [];
  }));
  const moveMonth = (offset: number) => {
    const [year, month] = selectedMonth.split('-').map(Number);
    setSelectedMonth(dayKey(new Date(year, month - 1 + offset, 1, 12)).slice(0, 7));
  };
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() }), qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }), qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() })]);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = Number(data.get('amount'));
    if (!(amount > 0)) { setError('Add an amount greater than zero.'); return; }
    create.mutate({ data: { type: kind, label: String(data.get('label')).trim(), amount, category: String(data.get('category')), date: String(data.get('date')), isTaxable: kind === 'income' && data.get('taxable') === 'on', source: String(data.get('source') || '').trim() || null } }, {
      onSuccess: () => { void refresh(); form.reset(); setFormOpen(false); },
      onError: (reason) => setError(messageOf(reason)),
    });
  };
  const deleteOne = (id: string) => {
    if (!window.confirm('Delete this entry?')) return;
    remove.mutate({ id }, { onSuccess: () => { void refresh(); }, onError: (reason) => setError(messageOf(reason)) });
  };
  const totalOf = (type: 'expense' | 'income') => monthRows.filter((item) => item.type === type).reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return <div className="m-page">
    <PageTitle title="Spending" action={<button className="m-btn outline small" onClick={() => setFormOpen(true)}><Plus aria-hidden="true" />Add</button>} />
    <div className="m-month">
      <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)} data-testid="button-previous-month"><ChevronLeft aria-hidden="true" /></button>
      <strong data-testid="text-selected-month">{monthLabel}</strong>
      <button type="button" aria-label="Next month" onClick={() => moveMonth(1)} data-testid="button-next-month"><ChevronRight aria-hidden="true" /></button>
    </div>
    {error && <div className="m-error" role="alert"><span>{error}</span><button className="m-icon-button" onClick={() => setError('')} aria-label="Dismiss"><X aria-hidden="true" /></button></div>}

    {formOpen && <form className="m-card m-form" onSubmit={submit}>
      <div className="m-section-head"><h2>Add a purchase</h2><button type="button" className="m-icon-button" onClick={() => setFormOpen(false)} aria-label="Close"><X aria-hidden="true" /></button></div>
      <div className="m-segment wide" role="group" aria-label="Entry type">
        <button type="button" className={kind === 'expense' ? 'on' : ''} onClick={() => setKind('expense')}>Money out</button>
        <button type="button" className={kind === 'income' ? 'on' : ''} onClick={() => setKind('income')}>Money in</button>
      </div>
      <div className="m-fields">
        <label>What was it?<input className="m-input" name="label" placeholder={kind === 'expense' ? 'Weekly groceries' : 'Freelance project'} required maxLength={120} /></label>
        <label>Amount<input className="m-input" name="amount" type="number" min=".01" step=".01" placeholder="0.00" required inputMode="decimal" /></label>
        <label>Category<select className="m-input" name="category" required><option value="">Choose one</option>{(kind === 'expense' ? spendCategories : ['Paycheck', 'Freelance', 'Interest', 'Gift', 'Other']).map((category) => <option key={category}>{category}</option>)}</select></label>
        <label>Date<input className="m-input" name="date" type="date" defaultValue={today()} required /></label>
        <label className="full">Note <span className="m-muted">(optional)</span><input className="m-input" name="source" placeholder="Cash, Venmo, a note for later" /></label>
      </div>
      {kind === 'income' && <label className="m-check"><input type="checkbox" name="taxable" defaultChecked />Include in my tax set-aside</label>}
      <button className="m-btn navy" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Save'}</button>
    </form>}

    <IncomeReviewCards items={pendingIncome} taxRate={taxRate} />

    <div className="m-tiles two">
      <div className="m-tile" data-testid="total-expense"><span>Money out</span><strong>{money(totalOf('expense'))}</strong></div>
      <div className="m-tile" data-testid="total-income"><span>Money in</span><strong>{money(totalOf('income'))}</strong></div>
    </div>

    <div className="m-chips" role="group" aria-label="Filter spending">
      {(['all', 'expense', 'income'] as const).map((value) => <button key={value} className={`m-chip ${filter === value ? 'on' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)} data-testid={`button-filter-${value}`}>{value === 'all' ? 'All' : value === 'expense' ? 'Money out' : 'Money in'}</button>)}
    </div>

    {query.isLoading ? <div className="m-card"><Skeleton /></div>
      : query.isError ? <ErrorState error={query.error} retry={() => query.refetch()} />
      : groups.length ? groups.map((group) => <section className="m-section tight" key={group.date} data-testid={`day-group-${group.date}`}>
        <h3 className="m-day">{group.label}</h3>
        <div className="m-card m-list"><TransactionRows items={group.items} onDelete={deleteOne} showDate={false} contextNotes={contextNotes} /></div>
      </section>)
      : <div className="m-card"><EmptyState title="Nothing here yet" body={`No entries for ${monthLabel}. Connect a bank in Settings, or add one yourself.`} action={<button className="m-btn navy" onClick={() => setFormOpen(true)}><Plus aria-hidden="true" />Add a purchase</button>} /></div>}
  </div>;
}
