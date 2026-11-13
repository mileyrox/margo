import { useUser } from '@clerk/react';
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

/** Same payee matching as the server, so one answer covers every payment to that person. */
export const payeeKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/** Margo asks what a transaction was when she can't tell. The answer is remembered for that payee. */
export function SortQuestion({ tx, count, index, others = 0 }: { tx: Transaction; count?: number; index?: number; others?: number }) {
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
    <p><b>{money(tx.amount)} to {who}</b> on {shortDate(tx.date)}{others > 0 && <> (and {others} more {others === 1 ? 'payment' : 'payments'} to them)</>}. I'm not sure what {others > 0 ? 'these were' : 'this was'}. Was it…</p>
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

/**
 * Margo only asks about payments made since the person joined (older history isn't worth a pile of questions),
 * and only once per payee: one answer sorts every payment to that person.
 * One question at a time on Home, all of them on Spending.
 */
export function SortQuestions({ items, all = false }: { items: Transaction[]; all?: boolean }) {
  const { user } = useUser();
  const joined = user?.createdAt ? new Date(user.createdAt).toISOString().slice(0, 10) : null;
  const recent = items.filter((tx) => !joined || String(tx.date).slice(0, 10) >= joined);
  if (!recent.length) return null;
  const groups = new Map<string, Transaction[]>();
  for (const tx of [...recent].sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
    const key = payeeKey(tx.label);
    groups.set(key, [...(groups.get(key) || []), tx]);
  }
  const questions = [...groups.values()];
  const shown = questions.slice(0, all ? 5 : 1);
  return <section className="m-section m-stack" aria-label="Margo has a question">
    {shown.map((group, i) => <SortQuestion key={group[0].id} tx={group[0]} others={group.length - 1} count={questions.length} index={i + 1} />)}
    {all && questions.length > shown.length && <p className="m-muted small">{questions.length - shown.length} more after these.</p>}
  </section>;
}
