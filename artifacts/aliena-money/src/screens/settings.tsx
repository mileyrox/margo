import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser, useClerk } from '@clerk/react';
import {
  customFetch, getGetBudgetPlanQueryKey, getGetFinanceDashboardQueryKey, getGetFinanceSettingsQueryKey, getGetSwapProfileQueryKey, getGetTransactionsQueryKey,
  useDeleteMyData, useGetBudgetPlan, useGetFinanceDashboard, useGetFinanceSettings, useGetPurchaseHistory, useGetReceipts,
  useGetSwapProfile, useGetTransactions, useUpdateBudgetPlan, useUpdateFinanceSettings, useUpdateSwapProfile,
} from '@workspace/api-client-react';
import type { BudgetPlanInput, SwapProfileInput } from '@workspace/api-client-react';
import { usePlaidLink } from 'react-plaid-link';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { ErrorState, PageTitle, Skeleton } from '@/components/margo/chrome';
import { CoinAvatar, parseLook } from '@/components/margo/art';
import { blankProfile } from '@/lib/profile';
import { fetchSwapCatalog } from '@/lib/swap-catalog';
import { isLive } from './swaps';
import { dateLabel, messageOf, money, parseList } from '@/lib/format';
import { spendCategories } from './spending';

export const swapCategoryOptions = [['groceries', 'Groceries'], ['household', 'Household'], ['beauty', 'Personal care'], ['clothes', 'Clothing'], ['subscriptions', 'Subscriptions'], ['travel', 'Travel']] as const;
export const keepOptions = ['Morning coffee', 'Name-brand favorites', 'Organic produce', 'My gym', 'Streaming', 'Takeout night', 'Direct flights'];

type BudgetCategory = BudgetPlanInput['categoryBudgets'][number]['category'];

export function BankConnect({ onConnected, compact = false }: { onConnected?: () => void; compact?: boolean }) {
  const qc = useQueryClient();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState('');
  const [message, setMessage] = useState('');
  const banks = useQuery({
    queryKey: ['plaid-items'],
    queryFn: async () => {
      return customFetch<Array<{ id: string; institutionName: string | null; lastSyncAt: string | null }>>('/api/plaid/items');
    },
  });
  const invalidateMoney = () => Promise.all([qc.invalidateQueries({ queryKey: ['plaid-items'] }), qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() }), qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }), qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() })]);
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken, metadata) => {
      setBusy(true); setMessage('');
      try {
        const linked = await customFetch<{ itemId: string }>('/api/plaid/exchange', { method: 'POST', body: JSON.stringify({ publicToken, institutionId: metadata.institution?.institution_id, institutionName: metadata.institution?.name }) });
        if (!linked.itemId) throw new Error('Could not connect that bank.');
        await customFetch('/api/plaid/sync', { method: 'POST', body: JSON.stringify({ itemId: linked.itemId }) });
        await invalidateMoney();
        setMessage('Your bank is connected.');
        onConnected?.();
      } catch (error) { setMessage(messageOf(error)); } finally { setBusy(false); setLinkToken(null); }
    },
    onExit: () => { setBusy(false); setLinkToken(null); },
  });
  useEffect(() => { if (linkToken && ready) open(); }, [linkToken, ready, open]);
  const connect = async () => {
    setBusy(true); setMessage('');
    try {
      const result = await customFetch<{ linkToken: string }>('/api/plaid/link-token', { method: 'POST' });
      if (!result.linkToken) throw new Error('Could not start a bank connection.');
      setLinkToken(result.linkToken);
    } catch (error) { setMessage(messageOf(error)); setBusy(false); }
  };
  const sync = async (id: string) => {
    setSyncing(id); setMessage('');
    try {
      await customFetch('/api/plaid/sync', { method: 'POST', body: JSON.stringify({ itemId: id }) });
      await Promise.all([banks.refetch(), invalidateMoney()]);
      setMessage('Your spending is up to date.');
    } catch (error) { setMessage(messageOf(error)); } finally { setSyncing(''); }
  };
  const disconnect = async (id: string) => {
    if (!window.confirm('Disconnect this bank? Your saved spending stays in Margo.')) return;
    try {
      await customFetch(`/api/plaid/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await banks.refetch(); setMessage('Bank disconnected. Your saved spending stays in Margo.');
    } catch (error) { setMessage(messageOf(error)); }
  };
  const button = <button className={`m-btn ${compact ? 'navy' : 'outline'}`} onClick={() => void connect()} disabled={busy || Boolean(linkToken && !ready)}>{busy ? 'Connecting…' : banks.data?.length ? 'Add another bank or card' : 'Connect my bank'}</button>;
  if (compact) return <div className="m-stack">{button}{message && <small className="m-muted" role="status">{message}</small>}</div>;
  return <div className="m-stack">
    {banks.isLoading ? <Skeleton lines={1} /> : banks.isError ? <ErrorState error={banks.error} retry={() => banks.refetch()} /> : banks.data?.map((bank) => <div className="m-line" key={bank.id}>
      <span><strong>{bank.institutionName || 'Connected bank'}</strong><small className="m-muted block">{bank.lastSyncAt ? `Updated ${dateLabel(bank.lastSyncAt)}` : 'Connected, not updated yet'}</small></span>
      <span className="m-actions"><button className="m-link-button bold" disabled={syncing === bank.id} onClick={() => void sync(bank.id)}>{syncing === bank.id ? 'Updating…' : 'Refresh'}</button><button className="m-link-button" onClick={() => void disconnect(bank.id)}>Disconnect</button></span>
    </div>)}
    {button}
    <span className="m-muted small">Add every checking account and credit card you use. You sign in with your bank through Plaid, so Margo never sees your password, and it can't move your money.</span>
    {message && <small className="m-muted" role="status">{message}</small>}
  </div>;
}

function Row({ label, value, children, danger = false }: { label: string; value?: string; children: ReactNode; danger?: boolean }) {
  return <details className="m-row">
    <summary><span className={danger ? 'burgundy' : ''}>{label}</span><span className="m-muted">{value}<ChevronRight aria-hidden="true" /></span></summary>
    <div className="m-row-body">{children}</div>
  </details>;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { user } = useUser();
  const { signOut } = useClerk();
  const logout = () => signOut({ redirectUrl: import.meta.env.BASE_URL });
  const settings = useGetFinanceSettings();
  const plan = useGetBudgetPlan();
  const profileQuery = useGetSwapProfile();
  const transactions = useGetTransactions();
  const receipts = useGetReceipts();
  const purchaseHistory = useGetPurchaseHistory();
  const dashboard = useGetFinanceDashboard();
  const updateRate = useUpdateFinanceSettings();
  const deleteMyData = useDeleteMyData();
  const updatePlan = useUpdateBudgetPlan();
  const saveProfile = useUpdateSwapProfile();
  const [rate, setRate] = useState<number | null>(null);
  const [goal, setGoal] = useState('');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [draftProfile, setDraftProfile] = useState<SwapProfileInput>(blankProfile);
  const [budgets, setBudgets] = useState<Array<{ category: string; monthlyTarget: number }>>([]);
  const [addCategory, setAddCategory] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const loadedProfile = useRef(false);
  // Only accounts listed in SWAP_CATALOG_ADMIN_EMAILS get a 200 here, so the admin row stays hidden for everyone else.
  const adminCatalog = useQuery({ queryKey: ['admin-swap-catalog'], queryFn: () => fetchSwapCatalog(true), retry: false });
  const engineStatus = useQuery({
    queryKey: ['swap-engine-status'], enabled: Boolean(adminCatalog.data), retry: false, staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch('/api/admin/swap-engine-status', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not check the swap engine.');
      return response.json() as Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> }>;
    },
  });

  useEffect(() => { if (settings.data && rate === null) setRate(settings.data.taxReserveRate); }, [settings.data, rate]);
  useEffect(() => {
    if (!plan.data) return;
    setGoal(String(Math.round(plan.data.annualSavingsGoal / 12) || 0));
    setMonthlyIncome(String(Math.round(plan.data.annualIncome / 12) || 0));
    setMonthlyRent(String(plan.data.monthlyRent || 0));
    setBudgets(plan.data.categories.map(({ category, monthlyTarget }) => ({ category, monthlyTarget: Number(monthlyTarget) || 0 })));
  }, [plan.data]);
  useEffect(() => {
    if (profileQuery.data && !loadedProfile.current) { loadedProfile.current = true; setDraftProfile({ ...blankProfile, ...profileQuery.data }); }
  }, [profileQuery.data]);

  const answers = draftProfile.onboardingAnswers || {};
  const setAnswer = (key: string, value: string) => setDraftProfile((current) => ({ ...current, onboardingAnswers: { ...(current.onboardingAnswers || {}), [key]: value } }));
  const toggle = (key: 'nonNegotiables' | 'swapCategories', value: string) => setDraftProfile((current) => {
    const values = current[key] as string[];
    const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
    return { ...current, [key]: next } as SwapProfileInput;
  });
  const done = (text: string) => { setError(''); setMessage(text); };
  const fail = (reason: unknown) => { setMessage(''); setError(messageOf(reason)); };
  const budgetPayload = (overrides: Partial<BudgetPlanInput> = {}): BudgetPlanInput => ({
    annualIncome: Math.max(0, Number(monthlyIncome) || 0) * 12,
    annualSavingsGoal: Math.max(0, Number(goal) || 0) * 12,
    monthlyRent: Math.max(0, Number(monthlyRent) || 0),
    priorityCategories: [],
    categoryBudgets: budgets.map((item) => ({ category: item.category as BudgetCategory, monthlyTarget: Math.max(0, Number(item.monthlyTarget) || 0) })),
    ...overrides,
  });
  const invalidateAll = () => Promise.all([qc.invalidateQueries({ queryKey: getGetSwapProfileQueryKey() }), qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() }), qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() })]);
  const saveAbout = async () => {
    try {
      await saveProfile.mutateAsync({ data: { ...draftProfile, monthlySavingsGoal: Math.max(0, Number(goal) || 0), onboardingAnswers: { ...(profileQuery.data?.onboardingAnswers || {}), debtBalance: answers.debtBalance || '', debtPayment: answers.debtPayment || '', savingsGoal: goal, savingsGoalPeriod: 'month', takeHome: monthlyIncome, takeHomePeriod: 'month', rent: monthlyRent, savingFor: draftProfile.savingFor } } });
      if (plan.data) await updatePlan.mutateAsync({ data: budgetPayload() });
      await invalidateAll(); done('Saved.');
    } catch (reason) { fail(reason); }
  };
  const saveBudgets = async () => {
    try { await updatePlan.mutateAsync({ data: budgetPayload() }); await invalidateAll(); done('Your budgets are saved.'); } catch (reason) { fail(reason); }
  };
  const saveTax = () => {
    if (rate === null) return;
    updateRate.mutate({ data: { taxReserveRate: rate } }, { onSuccess: () => { done('Tax set-aside saved.'); void qc.invalidateQueries({ queryKey: getGetFinanceSettingsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }); }, onError: fail });
  };
  const exportData = () => {
    const data = { transactions: transactions.data || [], receipts: receipts.data || [], purchaseHistory: purchaseHistory.data || [], budget: plan.data || null, shoppingPreferences: profileQuery.data || null, financeSettings: settings.data || null, dashboard: dashboard.data || null };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'margo-my-data.json'; anchor.click(); URL.revokeObjectURL(url);
  };
  const eraseData = async () => {
    if (!window.confirm('This permanently removes your spending, receipts, budgets, preferences, and bank connections from Margo. Your sign-in stays. This cannot be undone. Continue?')) return;
    try { await deleteMyData.mutateAsync(); await logout(); } catch (reason) { fail(reason); }
  };
  const look = parseLook(profileQuery.data?.onboardingAnswers?.avatar);
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Your Margo account';
  const totalBudget = budgets.reduce((sum, item) => sum + Number(item.monthlyTarget || 0), 0);
  const saving = saveProfile.isPending || updatePlan.isPending;
  const debtTypes = parseList(answers.debtTypes);

  return <div className="m-page">
    <PageTitle title="Settings" />
    <section className="m-profile">
      {look ? <CoinAvatar look={look} size={56} /> : <span className="m-profile-initial">{(user?.firstName?.[0] || user?.primaryEmailAddress?.emailAddress?.[0] || 'M').toUpperCase()}</span>}
      <span><strong>{name}</strong><small className="m-muted">{user?.primaryEmailAddress?.emailAddress || 'Private to you'}</small></span>
      <Link href="/avatar" className="m-link">{look ? 'Edit avatar' : 'Make your avatar'}</Link>
    </section>
    {error && <div className="m-error" role="alert">{error}</div>}
    {message && <div className="m-success" role="status">{message}</div>}

    {profileQuery.isLoading || plan.isLoading ? <div className="m-card"><Skeleton lines={4} /></div> : profileQuery.isError ? <ErrorState error={profileQuery.error} retry={() => profileQuery.refetch()} /> : <>
      <section className="m-group">
        <h2>About you</h2>
        <div className="m-card m-rows">
          <Row label="Take-home pay" value={`${money(monthlyIncome)}/mo`}><label className="m-field-label">Per month, after taxes<input className="m-input" type="number" min="0" step="50" value={monthlyIncome} onChange={(event) => setMonthlyIncome(event.target.value)} /></label><button className="m-btn navy small" disabled={saving} onClick={() => void saveAbout()}>Save</button></Row>
          <Row label="Savings goal" value={`${money(goal)}/mo`}><label className="m-field-label">Per month<input className="m-input" type="number" min="0" step="25" value={goal} onChange={(event) => setGoal(event.target.value)} /></label><button className="m-btn navy small" disabled={saving} onClick={() => void saveAbout()}>Save</button></Row>
          <Row label="Biggest goal" value={draftProfile.savingFor || 'Not set'}><label className="m-field-label">What you're saving for<input className="m-input" value={draftProfile.savingFor} maxLength={160} onChange={(event) => setDraftProfile((current) => ({ ...current, savingFor: event.target.value }))} placeholder="An emergency fund, a trip…" /></label><button className="m-btn navy small" disabled={saving} onClick={() => void saveAbout()}>Save</button></Row>
          <Row label="Never swap these" value={draftProfile.nonNegotiables.length ? `${draftProfile.nonNegotiables.length} picked` : 'None'}><div className="m-chips">{Array.from(new Set([...keepOptions, ...draftProfile.nonNegotiables])).map((item) => <button key={item} type="button" className={`m-chip ${draftProfile.nonNegotiables.includes(item) ? 'on' : ''}`} aria-pressed={draftProfile.nonNegotiables.includes(item)} onClick={() => toggle('nonNegotiables', item)}>{item}</button>)}</div><button className="m-btn navy small" disabled={saving} onClick={() => void saveAbout()}>Save</button></Row>
          <Row label="Open to swaps" value={draftProfile.swapCategories.length ? `${draftProfile.swapCategories.length} areas` : 'None'}><div className="m-chips">{swapCategoryOptions.map(([value, label]) => <button key={value} type="button" className={`m-chip ${draftProfile.swapCategories.includes(value) ? 'on' : ''}`} aria-pressed={draftProfile.swapCategories.includes(value)} onClick={() => toggle('swapCategories', value)}>{label}</button>)}</div><button className="m-btn navy small" disabled={saving} onClick={() => void saveAbout()}>Save</button></Row>
        </div>
      </section>

      <section className="m-group">
        <h2>Your money</h2>
        <div className="m-card m-rows">
          <Row label="Monthly budgets" value={money(totalBudget)}>
            {budgets.map((item) => <div className="m-budget-edit" key={item.category}><span>{item.category}</span><label className="m-money-input"><span>$</span><input aria-label={`${item.category} monthly budget`} type="number" min="0" step="25" value={item.monthlyTarget} onChange={(event) => setBudgets((rows) => rows.map((row) => row.category === item.category ? { ...row, monthlyTarget: Number(event.target.value) || 0 } : row))} /></label><button className="m-icon-button" aria-label={`Remove ${item.category}`} onClick={() => setBudgets((rows) => rows.filter((row) => row.category !== item.category))}><Trash2 aria-hidden="true" /></button></div>)}
            <div className="m-actions"><select className="m-input" value={addCategory} onChange={(event) => setAddCategory(event.target.value)}><option value="">Add a category</option>{spendCategories.filter((item) => !budgets.some((row) => row.category === item)).map((item) => <option key={item}>{item}</option>)}</select><button className="m-btn outline small" disabled={!addCategory} onClick={() => { setBudgets((rows) => [...rows, { category: addCategory, monthlyTarget: 0 }]); setAddCategory(''); }}><Plus aria-hidden="true" />Add</button></div>
            <button className="m-btn navy small" disabled={updatePlan.isPending} onClick={() => void saveBudgets()}>{updatePlan.isPending ? 'Saving…' : 'Save budgets'}</button>
          </Row>
          <Row label="Rent" value={`${money(monthlyRent)}/mo`}><label className="m-field-label">Per month<input className="m-input" type="number" min="0" step="25" value={monthlyRent} onChange={(event) => setMonthlyRent(event.target.value)} /></label><button className="m-btn navy small" disabled={saving} onClick={() => void saveAbout()}>Save</button></Row>
          <Row label="Tax set-aside" value={`${rate ?? settings.data?.taxReserveRate ?? 25}%`}>
            <label className="m-field-label">Share of side income to set aside <strong>{rate ?? settings.data?.taxReserveRate ?? 25}%</strong><input type="range" min="0" max="60" step="1" value={rate ?? settings.data?.taxReserveRate ?? 25} onChange={(event) => setRate(Number(event.target.value))} /></label>
            <span className="m-muted small">A personal estimate, not tax advice.</span>
            <button className="m-btn navy small" disabled={updateRate.isPending} onClick={saveTax}>Save</button>
          </Row>
          <Row label="Debt" value={answers.debtBalance ? `${money(answers.debtBalance)} left` : debtTypes.length ? debtTypes.join(', ') : 'None'}>
            <label className="m-field-label">Total left to pay<input className="m-input" type="number" min="0" step="50" value={answers.debtBalance || ''} onChange={(event) => setAnswer('debtBalance', event.target.value)} placeholder="0" data-testid="input-debt-balance" /></label>
            <label className="m-field-label">Paid each month<input className="m-input" type="number" min="0" step="25" value={answers.debtPayment || ''} onChange={(event) => setAnswer('debtPayment', event.target.value)} placeholder="0" data-testid="input-debt-payment" /></label>
            <button className="m-btn navy small" disabled={saving} onClick={() => void saveAbout()}>Save</button>
          </Row>
        </div>
      </section>
    </>}

    <section className="m-group">
      <h2>Banks</h2>
      <div className="m-card"><BankConnect /></div>
    </section>

    <section className="m-group">
      <h2>Your data</h2>
      <div className="m-card m-rows">
        <Row label="Download my data" value="JSON"><span className="m-muted small">Everything Margo has saved for you, in one file.</span><button className="m-btn outline small" onClick={exportData}>Download</button></Row>
        <Row label="Delete my data" danger><span className="m-muted small">Removes your money and shopping data from Margo. Your sign-in stays.</span><button className="m-btn burgundy small" onClick={() => void eraseData()} disabled={deleteMyData.isPending}>{deleteMyData.isPending ? 'Deleting…' : 'Delete everything'}</button></Row>
      </div>
    </section>

    {adminCatalog.data && <section className="m-group">
      <h2>Admin</h2>
      <Link href="/admin/swaps" className="m-card m-line"><span><strong>Swap catalog</strong><small className="m-muted block">{adminCatalog.data.length ? `${adminCatalog.data.filter(isLive).length} of ${adminCatalog.data.length} swaps showing to users` : 'Import your swaps CSV to get started'}</small></span><ChevronRight aria-hidden="true" /></Link>
      <div className="m-card m-stack" data-testid="swap-engine-status">
        <div className="m-line"><strong>Swap engine</strong><button className="m-link-button small-link" onClick={() => void engineStatus.refetch()} disabled={engineStatus.isFetching}>{engineStatus.isFetching ? 'Checking…' : 'Check again'}</button></div>
        {engineStatus.isLoading ? <Skeleton lines={2} /> : engineStatus.isError ? <span className="m-muted small">{messageOf(engineStatus.error)}</span>
          : engineStatus.data?.checks.map((check) => <div key={check.name} className="m-status-row"><span className={`m-status-dot ${check.ok ? 'ok' : check.name === 'Affiliate links' ? 'warn' : 'bad'}`} aria-hidden="true" /><span><strong>{check.name}</strong><small className="m-muted block">{check.detail}</small></span></div>)}
      </div>
    </section>}

    <section className="m-group">
      <h2>Legal</h2>
      <div className="m-card m-rows">
        {([['/privacy', 'Privacy Policy'], ['/terms', 'Terms of Use'], ['/disclosures', 'Affiliate Disclosure']] as const).map(([href, label]) => <Link key={href} href={href} className="m-legal-row"><span>{label}</span><ChevronRight aria-hidden="true" /></Link>)}
      </div>
    </section>

    <button className="m-btn outline" onClick={logout}>Sign out</button>
  </div>;
}
