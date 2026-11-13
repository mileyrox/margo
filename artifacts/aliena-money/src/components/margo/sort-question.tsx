import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { customFetch, getGetTransactionsQueryKey, getGetFinanceDashboardQueryKey } from '@workspace/api-client-react';
import type { Transaction } from '@workspace/api-client-react';
import { MargoSays } from '@/components/margo/characters';
import { messageOf, money, shortDate } from '@/lib/format';

const MAIN = [
  { label: 'Rent', category: 'Rent' },
  { label: 'Paying off a card or loan', category: 'Debt payment' },
  { label: 'Putting money in savings', category: 'Savings' },
  { label: 'Moving my own money', category: 'Transfer' },
];
const SPENDING = ['Groceries', 'Dining out', 'Shopping', 'Personal care', 'Transportation', 'Subscriptions', 'Utilities', 'Gifts', 'Other spending'];

/** Who the money went to, in plain words: "Zelle to Jane Doe" -> "Jane Doe". */
const payee = (label: string) => label.replace(/^(zelle|venmo|cash ?app|paypal)( payment)?( to| -)?\s*/i, '').trim() || label;

/** Margo asks what a transaction was when she can't tell. The answer is remembered for that payee. */
export function SortQuestion({ tx, count, index }: { tx: Transaction; count?: number; index?: number }) {
  const qc = useQueryClient();
  const [spending, setSpending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const who = payee(tx.label);
  const answer = async (category: string) => {
    setSaving(true); setError('');
    try {
      await customFetch(`/api/transactions/${encodeURIComponent(tx.id)}/sort`, { method: 'POST', body: JSON.stringify({ category, remember: true }) });
      await Promise.all([qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() }), qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() })]);
    } catch (reason) { setError(messageOf(reason)); setSaving(false); }
  };
  return <MargoSays className="m-sort-q">
    {count && count > 1 && <span className="m-today-tag">Quick question {index ?? 1} of {count}</span>}
    <p><b>{money(tx.amount)} to {who}</b> on {shortDate(tx.date)}. I'm not sure what this was. Was it…</p>
    {!spending ? <div className="m-sort-choices">
      {MAIN.map((choice) => <button key={choice.category} type="button" className="m-chip square" disabled={saving} onClick={() => void answer(choice.category)}>{choice.label}</button>)}
      <button type="button" className="m-chip square" disabled={saving} onClick={() => setSpending(true)}>Spending…</button>
    </div> : <div className="m-sort-choices">
      {SPENDING.map((category) => <button key={category} type="button" className="m-chip square" disabled={saving} onClick={() => void answer(category)}>{category}</button>)}
      <button type="button" className="m-link-button small-link" onClick={() => setSpending(false)}>Back</button>
    </div>}
    <small className="m-muted">I'll remember this for {who} next time.</small>
    {error && <div className="m-error" role="alert">{error}</div>}
  </MargoSays>;
}

/** One question at a time (Home) or all of them (Spending). */
export function SortQuestions({ items, all = false }: { items: Transaction[]; all?: boolean }) {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const shown = all ? sorted : sorted.slice(0, 1);
  return <section className="m-section m-stack" aria-label="Margo has a question">
    {shown.map((tx, i) => <SortQuestion key={tx.id} tx={tx} count={sorted.length} index={i + 1} />)}
  </section>;
}
