import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Plus, Trash2 } from 'lucide-react';
import { PageTitle, Skeleton } from '@/components/margo/chrome';
import { MargoSays } from '@/components/margo/characters';
import { monthLabel, payoffPlan, type Debt, type Strategy } from '@/lib/debt-plan';
import { useDebts, useSaveAccount, type ManualDebt } from '@/lib/accounts';
import { messageOf, money } from '@/lib/format';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const duration = (months: number) => months < 12 ? plural(months, 'month') : `${plural(Math.floor(months / 12), 'year')}${months % 12 ? `, ${plural(months % 12, 'month')}` : ''}`;

/** The debt payoff plan: every debt, a strategy, an extra amount, and exactly what to pay this month. */
export function DebtPage() {
  const { debts, manual, saveManual, answers, patch, loading, bankLoading, bankError, hasBankDebts } = useDebts();
  const saveAccount = useSaveAccount();
  const [strategy, setStrategy] = useState<Strategy>(answers.debtStrategy === 'snowball' ? 'snowball' : 'avalanche');
  const [extra, setExtra] = useState(Number(answers.debtExtra || 0));
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  // Recalculate only when the debts themselves change, not on every redraw.
  const debtKey = JSON.stringify(debts);
  const plans = useMemo(() => ({
    avalanche: payoffPlan(debts, extra, 'avalanche'), snowball: payoffPlan(debts, extra, 'snowball'),
    base: payoffPlan(debts, 0, strategy),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [debtKey, extra, strategy]);
  const plan = plans[strategy];
  const total = debts.reduce((sum, debt) => sum + debt.balance, 0);
  const minimums = debts.reduce((sum, debt) => sum + debt.minPayment, 0);
  const remember = (changes: Record<string, string>) => { void patch(changes).catch(() => undefined); };

  const saveDebt = async (debt: Debt, changes: { apr?: number | null; minPayment?: number | null; balance?: number }) => {
    setError('');
    try {
      if (debt.source === 'bank') await saveAccount(debt.id, changes);
      else if (debt.id === 'setup') await saveManual([{ id: crypto.randomUUID(), name: 'My debt', balance: changes.balance ?? debt.balance, apr: changes.apr ?? null, minPayment: changes.minPayment ?? debt.minPayment }]);
      else await saveManual(manual.map((item) => item.id === debt.id ? { ...item, ...changes } : item));
    } catch (reason) { setError(messageOf(reason)); }
  };
  const removeDebt = async (id: string) => { setError(''); try { await saveManual(manual.filter((item) => item.id !== id)); } catch (reason) { setError(messageOf(reason)); } };

  if (loading) return <main className="m-page"><PageTitle title="Debt payoff" /><Skeleton lines={5} /></main>;

  return <main className="m-page m-stack m-debt">
    <PageTitle title="Debt payoff" subtitle={debts.length ? `${money(total)} across ${plural(debts.length, 'debt')}` : undefined} />
    {bankLoading && <p className="m-muted small" role="status">Checking your bank for cards and loans…</p>}
    {bankError && <p className="m-muted small" role="status">I couldn't reach your bank just now, so this plan only uses debts you added. It'll update next time.</p>}

    {!debts.length ? bankLoading ? <Skeleton lines={3} /> : <MargoSays>
      <strong>No debts here yet.</strong> {hasBankDebts ? '' : 'Connect your bank in Settings and I\'ll bring in your cards and loans, or add one by hand below.'}
    </MargoSays> : plan.payable ? <MargoSays>
      Paying <b>{money(minimums + extra)}</b> a month, you could be <b>debt-free around {monthLabel(plan.months)}</b> ({duration(plan.months)}) and pay about <b>{money(plan.totalInterest)}</b> in interest.
      {extra > 0 && plans.base.payable && <> That's <b>{duration(Math.max(0, plans.base.months - plan.months))} sooner</b> and <b>{money(Math.max(0, plans.base.totalInterest - plan.totalInterest))} less interest</b> than with no extra.</>}
    </MargoSays> : <MargoSays>
      <strong>At this pace the debt won't go down.</strong> The payments don't cover the interest. Try adding a little extra below, even $25 helps.
    </MargoSays>}

    {debts.length > 0 && <>
      <section className="m-card m-stack">
        <h2 className="m-h2">How to pay it off</h2>
        <div className="m-plan-pick" role="radiogroup" aria-label="Payoff strategy">
          {(['avalanche', 'snowball'] as const).map((key) => <button key={key} type="button" role="radio" aria-checked={strategy === key} className={strategy === key ? 'on' : ''} onClick={() => { setStrategy(key); remember({ debtStrategy: key }); }}>
            <strong>{key === 'avalanche' ? 'Avalanche' : 'Snowball'}</strong>
            <small>{key === 'avalanche' ? 'Highest interest first. Usually costs the least interest.' : 'Smallest balance first. Quick wins keep you going.'}</small>
            <span>{plans[key].payable ? <>{monthLabel(plans[key].months)} · {money(plans[key].totalInterest)} interest</> : 'Not paid off at this pace'}</span>
          </button>)}
        </div>
        <label className="m-extra">
          <span className="m-line"><span>Extra each month, on top of minimums</span><strong>{money(extra)}</strong></span>
          <input type="range" min={0} max={1000} step={10} value={extra} aria-label="Extra payment each month" onChange={(event) => setExtra(Number(event.target.value))} onPointerUp={() => remember({ debtExtra: String(extra) })} onKeyUp={() => remember({ debtExtra: String(extra) })} />
        </label>
        <div className="m-chips">{[0, 25, 50, 100, 200].map((amount) => <button key={amount} type="button" className={`m-chip square ${extra === amount ? 'on' : ''}`} aria-pressed={extra === amount} onClick={() => { setExtra(amount); remember({ debtExtra: String(amount) }); }}>{amount ? `+${money(amount)}` : 'No extra'}</button>)}</div>
      </section>

      {plan.firstMonth.length > 0 && <section className="m-card m-stack">
        <h2 className="m-h2">This month, pay</h2>
        {plan.firstMonth.map((row) => <div key={row.id} className={`m-line m-pay ${row.isTarget ? 'target' : ''}`}><span>{row.name}{row.isTarget && <small>Put the extra here</small>}</span><strong>{money(row.payment)}</strong></div>)}
        <div className="m-line m-pay-total"><span>Total</span><strong>{money(plan.firstMonth.reduce((sum, row) => sum + row.payment, 0))}</strong></div>
      </section>}

      {plan.payable && plan.order.length > 1 && <section className="m-card m-stack">
        <h2 className="m-h2">The order</h2>
        <ol className="m-payoff-order">{plan.order.map((row) => <li key={row.id}><span>{row.name}</span><small>Paid off {monthLabel(row.paidOffMonth)}</small></li>)}</ol>
      </section>}
    </>}

    <section className="m-card m-stack">
      <h2 className="m-h2">Your debts</h2>
      {error && <div className="m-error" role="alert">{error}</div>}
      {debts.map((debt) => <DebtRow key={debt.id} debt={debt} onSave={(changes) => void saveDebt(debt, changes)} onRemove={debt.source === 'manual' && debt.id !== 'setup' ? () => void removeDebt(debt.id) : undefined} />)}
      {adding ? <AddDebt onCancel={() => setAdding(false)} onAdd={async (item) => { await saveManual([...manual, item]); setAdding(false); }} />
        : <button type="button" className="m-btn outline" onClick={() => setAdding(true)}><Plus aria-hidden="true" />Add a debt</button>}
      <small className="m-muted">These are estimates, not financial advice. They leave out fees, new charges and rate changes. Banks don't share interest rates, so rates marked "estimate" are typical ones. Check your statement and tap to fix them. {hasBankDebts ? '' : <Link href="/settings" className="m-link">Connect a bank</Link>}</small>
    </section>
  </main>;
}

function NumberField({ label, value, suffix, prefix, estimated, onCommit }: { label: string; value: number; suffix?: string; prefix?: string; estimated?: boolean; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(Math.round(value * 100) / 100));
  const commit = () => { const n = Number(text.replace(/[^0-9.]/g, '')); if (Number.isFinite(n) && n !== value) onCommit(n); };
  return <label className="m-debt-field">
    <small>{label}{estimated && <em>estimate</em>}</small>
    <span>{prefix}<input inputMode="decimal" value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} aria-label={label} />{suffix}</span>
  </label>;
}

function DebtRow({ debt, onSave, onRemove }: { debt: Debt; onSave: (changes: { apr?: number; minPayment?: number; balance?: number }) => void; onRemove?: () => void }) {
  return <div className="m-debt-row">
    <div className="m-line"><strong>{debt.name}</strong><span>{money(debt.balance)}</span></div>
    <small className="m-muted">{debt.source === 'bank' ? 'From your bank, updated automatically' : 'Added by you'}</small>
    <div className="m-debt-fields">
      <NumberField label="Interest rate" value={debt.apr} suffix="%" estimated={debt.aprEstimated} onCommit={(apr) => onSave({ apr })} />
      <NumberField label="Minimum / month" value={debt.minPayment} prefix="$" estimated={debt.minEstimated} onCommit={(minPayment) => onSave({ minPayment })} />
      {debt.source === 'manual' && <NumberField label="Balance" value={debt.balance} prefix="$" onCommit={(balance) => onSave({ balance })} />}
    </div>
    {onRemove && <button type="button" className="m-link-button small-link" onClick={onRemove}><Trash2 aria-hidden="true" />Remove</button>}
  </div>;
}

function AddDebt({ onAdd, onCancel }: { onAdd: (item: ManualDebt) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(''), [balance, setBalance] = useState(''), [apr, setApr] = useState(''), [min, setMin] = useState('');
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const add = async () => {
    const b = Number(balance.replace(/[^0-9.]/g, ''));
    if (!name.trim() || !(b > 0)) { setError('Add a name and a balance.'); return; }
    setSaving(true); setError('');
    try {
      await onAdd({ id: crypto.randomUUID(), name: name.trim().slice(0, 60), balance: b, apr: apr ? Number(apr.replace(/[^0-9.]/g, '')) : null, minPayment: min ? Number(min.replace(/[^0-9.]/g, '')) : null });
    } catch (reason) { setError(messageOf(reason)); setSaving(false); }
  };
  return <div className="m-debt-add m-stack">
    <label className="m-field"><span>What is it?</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Student loan, Discover card…" /></label>
    <div className="m-debt-fields">
      <label className="m-field"><span>Balance</span><input inputMode="decimal" value={balance} onChange={(event) => setBalance(event.target.value)} placeholder="$2,400" /></label>
      <label className="m-field"><span>Interest rate (%)</span><input inputMode="decimal" value={apr} onChange={(event) => setApr(event.target.value)} placeholder="22.9" /></label>
      <label className="m-field"><span>Minimum / month</span><input inputMode="decimal" value={min} onChange={(event) => setMin(event.target.value)} placeholder="$60" /></label>
    </div>
    {error && <div className="m-error" role="alert">{error}</div>}
    <div className="m-today-actions"><button type="button" className="m-btn navy" disabled={saving} onClick={() => void add()}>Add debt</button><button type="button" className="m-btn outline" onClick={onCancel}>Cancel</button></div>
  </div>;
}
