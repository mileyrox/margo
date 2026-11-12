import { InstallTip } from '@/components/margo/install-tip';
import { MARGO_KINDS, MargoFace, MargoSays, useMargoKind } from '@/components/margo/characters';
import { useProfileAnswers } from '@/lib/profile';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMySwaps } from '@/components/margo/engine';
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
import { dateLabel, messageOf, money, parseList, shortDate } from '@/lib/format';
import { spendCategories } from './spending';

export const swapCategoryOptions = [['groceries', 'Groceries'], ['household', 'Household'], ['beauty', 'Personal care'], ['clothes', 'Clothing'], ['subscriptions', 'Subscriptions'], ['travel', 'Travel']] as const;
export const keepOptions = ['Morning coffee', 'Name-brand favorites', 'Organic produce', 'My gym', 'Streaming', 'Takeout night', 'Direct flights'];

type BudgetCategory = BudgetPlanInput['categoryBudgets'][number]['category'];

const OAUTH_TOKEN_KEY = 'margo-plaid-link-token';
const OAUTH_RETURN_KEY = 'margo-plaid-return-to';
const saveForOAuth = (token: string) => { try { window.localStorage.setItem(OAUTH_TOKEN_KEY, token); window.localStorage.setItem(OAUTH_RETURN_KEY, window.location.pathname); } catch { /* fine */ } };
const clearOAuth = () => { try { window.localStorage.removeItem(OAUTH_TOKEN_KEY); } catch { /* fine */ } };

async function finishBankConnection(publicToken: string | null, institution: { institution_id?: string | null; name?: string | null } | null | undefined) {
  const linked = await customFetch<{ itemId: string }>('/api/plaid/exchange', { method: 'POST', body: JSON.stringify({ publicToken, institutionId: institution?.institution_id, institutionName: institution?.name }) });
  if (!linked.itemId) throw new Error('Could not connect that bank.');
  await customFetch('/api/plaid/sync', { method: 'POST', body: JSON.stringify({ itemId: linked.itemId }) });
}

/** Big banks send people here after they sign in on the bank's own site. Link picks up where it left off. */
export function PlaidOAuthPage() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [message, setMessage] = useState('Finishing your bank connection…');
  const token = (() => { try { return window.localStorage.getItem(OAUTH_TOKEN_KEY); } catch { return null; } })();
  const returnTo = (() => { try { return window.localStorage.getItem(OAUTH_RETURN_KEY) || '/settings'; } catch { return '/settings'; } })();
  const { open, ready } = usePlaidLink({
    token,
    receivedRedirectUri: window.location.href,
    onSuccess: async (publicToken, metadata) => {
      try {
        await finishBankConnection(publicToken, metadata.institution);
        clearOAuth();
        await Promise.all([qc.invalidateQueries({ queryKey: ['plaid-items'] }), qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() }), qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() })]);
        setLocation(returnTo);
      } catch (error) { setMessage(messageOf(error)); }
    },
    onExit: () => { clearOAuth(); setLocation(returnTo); },
  });
  useEffect(() => { if (token && ready) open(); }, [token, ready, open]);
  return <div className="m-page"><PageTitle title="Connecting your bank" /><div className="m-card">{token ? message : <>That connection expired. <Link href="/settings">Try again from Settings</Link>.</>}</div></div>;
}

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
        await finishBankConnection(publicToken, metadata.institution);
        clearOAuth();
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
      saveForOAuth(result.linkToken);
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
    {banks.isLoading ? <Skeleton lines={1} /> : banks.isError ? <ErrorState error={banks.error} retry={() => banks.refetch()} /> : banks.data?.map((bank) => <div className="m-line m-bank-row" key={bank.id}>
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

type ExtensionToken = { id: string; label: string; createdAt: string; expiresAt: string; lastUsedAt?: string | null };

/** Connects the Margo Chrome extension: makes a one-time code the person pastes into the extension. */
type ReceiptInbox = { address: string | null; gmailCode: string | null; lastReceivedAt: string | null; lastResult: string | null };

/** Receipts by email: a private address to forward order emails to. */
function EmailReceipts() {
  const qc = useQueryClient();
  const inbox = useQuery({ queryKey: ['receipt-inbox'], queryFn: () => customFetch<ReceiptInbox>('/api/receipts/inbox') });
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<'gmail' | 'outlook' | null>(null);
  const address = inbox.data?.address;
  const copy = async () => { if (!address) return; try { await navigator.clipboard.writeText(address); setCopied(true); } catch { setCopied(false); } };
  const reset = async () => {
    const updated = await customFetch<ReceiptInbox>('/api/receipts/inbox/reset', { method: 'POST' });
    qc.setQueryData(['receipt-inbox'], updated); setCopied(false);
  };
  if (inbox.isLoading) return <Skeleton lines={2} />;
  if (inbox.isError) return <ErrorState error={inbox.error} retry={() => inbox.refetch()} />;
  if (!address) return <span className="m-muted small">Receipts by email are almost ready. Check back soon.</span>;
  return <div className="m-stack">
    <span className="m-muted small">Forward an order email (Amazon, Target, Sephora, DoorDash…) to your private Margo address. Margo reads the items, adds the receipt and looks for cheaper swaps.</span>
    <div className="m-inbox-address"><code>{address}</code><button type="button" className="m-btn navy small" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button></div>
    {inbox.data?.gmailCode && <div className="m-inbox-code" role="status"><strong>Gmail confirmation code: {inbox.data.gmailCode}</strong><span className="m-muted small">Paste this in Gmail's forwarding settings to finish turning on automatic forwarding.</span></div>}
    <div className="m-stack tight">
      <button type="button" className="m-link-button bold left" aria-expanded={open === 'gmail'} onClick={() => setOpen(open === 'gmail' ? null : 'gmail')}>Forward receipts automatically from Gmail</button>
      {open === 'gmail' && <ol className="m-steps">
        <li>On a computer, open Gmail, click the gear, then <b>See all settings</b>, then <b>Forwarding and POP/IMAP</b>.</li>
        <li>Click <b>Add a forwarding address</b> and paste your Margo address. Gmail sends a code, and it shows up right here in a minute.</li>
        <li>Paste the code in Gmail. Don't turn on forwarding for everything.</li>
        <li>Make a filter instead: search for <code>subject:(receipt OR order OR "your order")</code>, click <b>Create filter</b>, check <b>Forward it to</b> your Margo address.</li>
      </ol>}
      <button type="button" className="m-link-button bold left" aria-expanded={open === 'outlook'} onClick={() => setOpen(open === 'outlook' ? null : 'outlook')}>Forward receipts automatically from Outlook or iCloud</button>
      {open === 'outlook' && <ol className="m-steps">
        <li><b>Outlook:</b> Settings, then Mail, then Rules. Add a rule: subject includes "order" or "receipt", then Forward to your Margo address.</li>
        <li><b>iCloud Mail:</b> on icloud.com, Settings, then Rules. If a message is from a store, forward to your Margo address.</li>
      </ol>}
    </div>
    {inbox.data?.lastReceivedAt && <span className="m-muted small">Last email {shortDate(inbox.data.lastReceivedAt)}: {inbox.data.lastResult}</span>}
    <span className="m-muted small">Margo only reads emails sent to this address and doesn't keep the email, just the receipt. If someone else gets your address, <button type="button" className="m-link-button inline" onClick={() => void reset()}>make a new one</button>.</span>
  </div>;
}

function ExtensionConnect() {
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: ['extension-tokens'], queryFn: () => customFetch<ExtensionToken[]>('/api/extension/tokens') });
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const makeCode = async () => {
    setError(''); setBusy(true); setCopied(false);
    try {
      const created = await customFetch<ExtensionToken & { token: string }>('/api/extension/tokens', { method: 'POST', body: JSON.stringify({ label: 'Chrome extension' }) });
      // The code carries this app's address and the token, so the extension knows where to ask.
      setCode(btoa(JSON.stringify({ u: window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, ''), t: created.token })).replace(/=+$/, ''));
      void qc.invalidateQueries({ queryKey: ['extension-tokens'] });
    } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    try { await customFetch(`/api/extension/tokens/${encodeURIComponent(id)}`, { method: 'DELETE', responseType: 'text' }); void qc.invalidateQueries({ queryKey: ['extension-tokens'] }); } catch (reason) { setError(messageOf(reason)); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); } };
  return <div className="m-stack">
    <span className="m-muted small">On a product page, click the Margo icon in Chrome and it finds a cheaper swap. To connect it, make a code here and paste it into the extension.</span>
    {code ? <div className="m-stack">
      <textarea className="m-input m-code" readOnly value={code} rows={3} aria-label="Connection code" onFocus={(event) => event.currentTarget.select()} />
      <button type="button" className="m-btn navy" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy code'}</button>
      <span className="m-muted small">Keep this code private. It lets the extension find swaps for your account for 90 days. You can remove it anytime below.</span>
    </div> : <button type="button" className="m-btn navy" disabled={busy} onClick={() => void makeCode()}>{busy ? 'Making a code…' : 'Get a connection code'}</button>}
    {error && <p className="m-error" role="alert">{error}</p>}
    {(tokens.data || []).map((token) => <div key={token.id} className="m-line"><span>{token.label} <small className="m-muted">· {token.lastUsedAt ? `used ${shortDate(token.lastUsedAt)}` : 'not used yet'}</small></span><button type="button" className="m-link-button" onClick={() => void remove(token.id)}>Remove</button></div>)}
  </div>;
}

export function SettingsPage() {
  const margoKind = useMargoKind();
  const { patch } = useProfileAnswers();
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
      return customFetch<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> }>('/api/admin/swap-engine-status');
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
  const mySwapsForExport = useQuery({ queryKey: ['my-swaps'], queryFn: fetchMySwaps });
  const plaidItemsForExport = useQuery({ queryKey: ['plaid-items'], queryFn: () => customFetch<Array<{ institutionName: string | null; createdAt?: string }>>('/api/plaid/items') });
  const exportData = () => {
    const data = { swaps: mySwapsForExport.data || [], connectedBanks: (plaidItemsForExport.data || []).map((item) => ({ institutionName: item.institutionName, connectedAt: item.createdAt })), transactions: transactions.data || [], receipts: receipts.data || [], purchaseHistory: purchaseHistory.data || [], budget: plan.data || null, shoppingPreferences: profileQuery.data || null, financeSettings: settings.data || null, dashboard: dashboard.data || null };
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
    <section className="m-group">
      <h2>Your Margo</h2>
      <div className="m-card m-stack">
        <MargoSays size={40}>Pick how I look. I'll show up like this all over the app.</MargoSays>
        <div className="m-margo-pick" role="radiogroup" aria-label="Choose your Margo">
          {MARGO_KINDS.map((item) => <button type="button" key={item.kind} role="radio" aria-checked={margoKind === item.kind} className={margoKind === item.kind ? 'on' : ''} onClick={() => void patch({ margo: item.kind })}>
            <MargoFace kind={item.kind} size={56} label="" /><span>{item.name}</span>
          </button>)}
        </div>
      </div>
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
      <h2>Margo on your phone</h2>
      <div className="m-card"><InstallTip always /></div>
    </section>

    <section className="m-group">
      <h2>Receipts by email</h2>
      <div className="m-card"><EmailReceipts /></div>
    </section>

    <section className="m-group">
      <h2>Chrome extension</h2>
      <div className="m-card"><ExtensionConnect /></div>
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
      <Link href="/admin/swap-test" className="m-card m-line"><span><strong>Swap test bench</strong><small className="m-muted block">Run a list of products and grade the swaps</small></span><ChevronRight aria-hidden="true" /></Link>
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
