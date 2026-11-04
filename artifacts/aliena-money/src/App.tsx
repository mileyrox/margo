import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAuth } from '@workspace/replit-auth-web';
import {
  getGetFinanceDashboardQueryKey, getGetTransactionsQueryKey, getGetFinanceSettingsQueryKey,
  getGetReceiptsQueryKey, getGetProductComparisonsQueryKey, useGetFinanceDashboard,
  useGetTransactions, useCreateTransaction, useDeleteTransaction, useGetFinanceSettings,
  useUpdateFinanceSettings, useGetReceipts, useCreateReceipt, useDeleteReceipt,
  useGetProductComparisons, useRequestUploadUrl, useGetBudgetPlan, useUpdateBudgetPlan,
  getGetBudgetPlanQueryKey, useGetSwapProfile, useUpdateSwapProfile,
  getGetSwapProfileQueryKey, useGetPurchaseHistory, getGetPurchaseHistoryQueryKey,
  useGetProductAlternatives, getGetProductAlternativesQueryKey, useVoteOnProductAlternative,
  useGetExtensionTokens, useCreateExtensionToken, useRevokeExtensionToken, getGetExtensionTokensQueryKey,
} from '@workspace/api-client-react';
import type { BudgetPlanInput, PurchaseHistoryItem, ReceiptLineItem, SwapProfileInput, Transaction } from '@workspace/api-client-react';
import {
  ArrowDownLeft, ArrowRightLeft, ArrowUpRight, BadgeDollarSign, Banknote, Check,
  ChevronRight, FileImage, FilePlus2, FileText, HandCoins, Info, Leaf,
  LoaderCircle, LogOut, Plus, ReceiptText, Settings as SettingsIcon, MessageCircle, ExternalLink,
  ShieldCheck, ShoppingBag, Trash2, Upload, Wallet, X, Landmark, Sparkles,
} from 'lucide-react';
import { Route, Switch, Link, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';
import { demoBankActivity } from '@/data/demo-bank';
import { usePlaidLink } from 'react-plaid-link';

const queryClient = new QueryClient();

const routeItems = [
  { href: '/', label: 'My plan', icon: Sparkles },
  { href: '/transactions', label: 'Transactions', icon: ArrowRightLeft },
  { href: '/swaps', label: 'Better buys', icon: Leaf },
  { href: '/earn-save', label: 'Earn & save', icon: HandCoins },
  { href: '/accounts', label: 'Sample accounts', icon: Landmark },
];
const money = (amount: number | undefined | null) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount || 0));
const niceDate = (value: string) => {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};
const today = () => new Date().toISOString().slice(0, 10);
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"' && quoted) { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { cells.push(cell.trim()); cell = ''; }
    else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}
function normalizeCsvDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : null;
}
const spendingCategories = [
  'Rent', 'Groceries', 'Dining out', 'Shopping', 'Beauty', 'Transportation', 'Subscriptions', 'Utilities',
] as const;
type PriorityCategory = typeof spendingCategories[number];
type CategoryBudgetDraft = { category: PriorityCategory; monthlyTarget: number };

function Shell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const { user, logout } = useAuth();
  const initials = `${user?.firstName?.[0] || user?.email?.[0] || 'A'}${user?.lastName?.[0] || ''}`.toUpperCase();
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Your account';
  const primaryNav = routeItems.filter(({ href }) => ['/', '/transactions', '/swaps', '/earn-save'].includes(href));
  const moreNav = routeItems.filter(({ href }) => !primaryNav.some((item) => item.href === href));
  const navLink = ({ href, label, icon: Icon }: typeof routeItems[number], compact = false) => (
    <Link key={href} href={href} aria-current={path === href ? 'page' : undefined} className={`nav-link ${path === href ? 'active' : ''}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <Icon aria-hidden="true" /><span>{compact && label === 'My plan' ? 'Home' : label}</span>
    </Link>
  );
  return <div className="app-frame">
    <header className="app-header">
      <Link href="/" className="app-brand" aria-label="Margo home"><img className="margo-logo-header" src={`${import.meta.env.BASE_URL}margo-logo.png`} alt="Margo — xo, your money friend" /></Link>
      <nav className="desktop-nav" aria-label="Main navigation">{routeItems.map((item) => navLink(item))}</nav>
      <div className="account-actions"><div className="account-greeting"><strong>{displayName}</strong><span>{user?.email || 'Your personal money space'}</span></div><Link href="/profile" className="avatar profile-avatar" aria-label="Open your profile and update your plan" data-testid="link-account-profile">{initials}</Link><button className="icon-button" aria-label="Log out" data-testid="button-log-out" onClick={logout}><LogOut size={16} /></button></div>
    </header>
    <main className="workspace"><div className="app-page">{children}</div></main>
    <nav className="mobile-bottom-nav" aria-label="Main navigation">
      {primaryNav.map((item) => navLink(item, true))}
      <details className="mobile-more"><summary><SettingsIcon aria-hidden="true" /><span>More</span></summary><div className="mobile-more-menu">{moreNav.map((item) => navLink(item))}</div></details>
    </nav>
  </div>;
}

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-heading"><span className="paper-pin" aria-hidden="true" /><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="page-subtitle">{subtitle}</p></div>{action}</div>;
}
function LoadingPanel({ rows = 4 }: { rows?: number }) { return <div className="panel" aria-label="Loading"><div style={{ padding: '16px 22px' }}>{Array.from({ length: rows }, (_, i) => <div className="skeleton" key={i} />)}</div></div>; }
function ErrorPanel({ error, retry }: { error: unknown; retry: () => void }) { return <div className="error-box" role="alert"><span>{messageOf(error)}</span><button onClick={retry} data-testid="button-retry">Try again</button></div>; }

type PlaidItemView = { id: string; institutionName: string | null; lastSyncAt: string | null };
function PlaidConnectCard() {
  const qc = useQueryClient();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncingId, setSyncingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const items = useQuery({
    queryKey: ['plaid-items'],
    queryFn: async () => {
      const response = await fetch('/api/plaid/items', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load connected banks.');
      return response.json() as Promise<PlaidItemView[]>;
    },
  });
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken, metadata) => {
      setBusy(true); setError(''); setNotice('');
      try {
        const exchange = await fetch('/api/plaid/exchange', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicToken, institutionId: metadata.institution?.institution_id, institutionName: metadata.institution?.name }),
        });
        const linked = await exchange.json();
        if (!exchange.ok || !linked.itemId) throw new Error(linked.error || 'Could not finish the bank connection.');
        const sync = await fetch('/api/plaid/sync', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: linked.itemId }),
        });
        const synced = await sync.json();
        if (!sync.ok) throw new Error(synced.error || 'Bank connected, but transactions could not be synced.');
        setNotice('Sandbox bank connected. Transactions are now in your activity.');
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['plaid-items'] }),
          qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() }),
        ]);
      } catch (e) { setError(messageOf(e)); }
      finally { setBusy(false); setLinkToken(null); }
    },
    onExit: () => { setLinkToken(null); setBusy(false); },
  });
  useEffect(() => { if (linkToken && ready) open(); }, [linkToken, ready, open]);
  const connect = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/plaid/link-token', { method: 'POST', credentials: 'include' });
      const result = await response.json();
      if (!response.ok || !result.linkToken) throw new Error(result.error || 'Could not start a Sandbox connection.');
      setLinkToken(result.linkToken);
    } catch (e) { setError(messageOf(e)); setBusy(false); }
  };
  const syncItem = async (id: string) => {
    setSyncingId(id); setError(''); setNotice('');
    try {
      const response = await fetch('/api/plaid/sync', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not sync transactions.');
      setNotice(`Synced ${result.imported} Sandbox transactions.`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['plaid-items'] }),
        qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() }),
      ]);
    } catch (e) { setError(messageOf(e)); }
    finally { setSyncingId(''); }
  };
  const disconnect = async (id: string) => {
    setError(''); setNotice('');
    const response = await fetch(`/api/plaid/items/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) { setError('Could not disconnect this bank. Try again.'); return; }
    await qc.invalidateQueries({ queryKey: ['plaid-items'] });
    setNotice('Bank disconnected. Previously imported transactions remain in your activity.');
  };
  return <section className="panel plaid-connect-card">
    <div className="plaid-connect-copy"><div className="eyebrow">Optional connection · Sandbox</div><h2 className="panel-title">Connect your bank</h2><p className="panel-caption">Import test transactions into your activity. Manual entry remains available.</p></div>
    <button className="btn btn-primary" onClick={connect} disabled={busy || !ready && Boolean(linkToken)} data-testid="button-connect-bank">{busy ? 'Connecting…' : 'Connect a test bank'}</button>
    {items.isError && <p className="profile-error" role="alert">Could not load connected banks.</p>}
    {items.data?.map((item) => <div className="plaid-connected-item" key={item.id}><span><strong>{item.institutionName || 'Sandbox bank'}</strong><small>{item.lastSyncAt ? `Last synced ${niceDate(item.lastSyncAt)}` : 'Not synced yet'}</small></span><div className="plaid-item-actions"><button type="button" className="text-link" disabled={syncingId === item.id} onClick={() => void syncItem(item.id)}>{syncingId === item.id ? 'Syncing…' : 'Sync now'}</button><button type="button" className="text-link" onClick={() => void disconnect(item.id)}>Disconnect</button></div></div>)}
    {error && <p className="profile-error" role="alert">{error}</p>}
    {notice && <p className="profile-saved" role="status">{notice}</p>}
  </section>;
}
function EmptyState({ icon: Icon, title, body, action }: { icon: typeof Wallet; title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-mark"><Icon /></div><h3>{title}</h3><p>{body}</p>{action}</div>;
}

function TransactionList({ items, limit, onDelete }: { items: Transaction[]; limit?: number; onDelete?: (id: string) => void }) {
  const list = limit ? items.slice(0, limit) : items;
  if (!list.length) return <EmptyState icon={ArrowRightLeft} title="A clean slate" body="Add your first income or expense and your picture will start to take shape." />;
  return <div className="table-wrap"><table className="table"><thead><tr><th>Activity</th><th>Category</th><th>Date</th><th>Type</th><th style={{ textAlign: 'right' }}>Amount</th>{onDelete && <th aria-label="Actions" />}</tr></thead><tbody>
    {list.map((t) => <tr key={t.id} data-testid={`row-transaction-${t.id}`}><td><strong>{t.label}</strong>{t.source && <div className="row-meta">{t.source}</div>}</td><td>{t.category}</td><td>{niceDate(t.date)}</td><td><span className={`badge ${t.type === 'income' ? 'badge-income' : 'badge-expense'}`}>{t.type}</span>{t.isTaxable && <span className="badge badge-tax" style={{ marginLeft: 5 }}>taxable</span>}</td><td style={{ textAlign: 'right', fontWeight: 700, color: t.type === 'income' ? '#3c785a' : undefined }}>{t.type === 'income' ? '+' : '−'}{money(t.amount)}</td>{onDelete && <td><button className="icon-button" aria-label={`Delete ${t.label}`} data-testid={`button-delete-transaction-${t.id}`} onClick={() => onDelete(t.id)}><Trash2 /></button></td>}</tr>)}
  </tbody></table></div>;
}

function Overview() {
  const dashboard = useGetFinanceDashboard();
  const queryClient = useQueryClient();
  const data = dashboard.data;
  const monthBars = [28, 40, 34, 58, 45, 62, 50, 76, 55, 67, 47, 83];
  return <div className="content">
    <PageHeading eyebrow="Your overview" title="Money, made a little simpler." subtitle="A thoughtful snapshot of what’s coming in, going out, and being set aside." action={<Link href="/transactions" className="btn btn-primary"><Plus />Add activity</Link>} />
    {dashboard.isLoading ? <div className="metric-grid">{[0,1,2,3].map((n) => <div className="panel metric-card" key={n}><div className="skeleton" /><div className="skeleton" /></div>)}</div> : dashboard.isError ? <ErrorPanel error={dashboard.error} retry={() => dashboard.refetch()} /> : <>
      <div className="metric-grid">
        <div className="panel metric-card" style={{ '--bubble': '#dce9dd' } as React.CSSProperties}><div className="metric-label"><ShoppingBag />Spent this month</div><div className="metric-value" data-testid="value-monthly-spending">{money(data?.monthlySpending)}</div><div className="metric-note">Your manually recorded expenses</div></div>
        <div className="panel metric-card" style={{ '--bubble': '#f1e2b6' } as React.CSSProperties}><div className="metric-label"><HandCoins />Side income this year</div><div className="metric-value" data-testid="value-taxable-income">{money(data?.taxableIncomeThisYear)}</div><div className="metric-note">Taxable non-W-2 income logged</div></div>
        <div className="panel metric-card" style={{ '--bubble': '#e9d9d6' } as React.CSSProperties}><div className="metric-label"><BadgeDollarSign />Set-aside estimate</div><div className="metric-value" data-testid="value-tax-reserve">{money(data?.taxSetAside)}</div><div className="metric-note">Based on your chosen estimate</div></div>
        <div className="panel metric-card" style={{ '--bubble': '#dbe8ef' } as React.CSSProperties}><div className="metric-label"><Leaf />Yearly swap savings</div><div className="metric-value" data-testid="value-annual-savings">{money(data?.annualSavings)}</div><div className="metric-note">Estimated from comparable items</div></div>
      </div>
      <div className="overview-grid">
        <section className="panel"><div className="panel-head"><div><h2 className="panel-title">Recent activity</h2><p className="panel-caption">Entries you’ve added by hand</p></div><Link href="/transactions" className="text-link">See all <ChevronRight size={13} style={{ verticalAlign: 'middle' }} /></Link></div>
          {data?.recentTransactions?.length ? <div className="transaction-list">{data.recentTransactions.slice(0, 5).map((t) => <div className="transaction-row" key={t.id} data-testid={`recent-transaction-${t.id}`}><div className={`row-icon ${t.type}`} >{t.type === 'income' ? <ArrowDownLeft /> : <ArrowUpRight />}</div><div><div className="row-title">{t.label}</div><div className="row-meta">{t.category} · {niceDate(t.date)}</div></div><div className={`row-amount ${t.type}`}>{t.type === 'income' ? '+' : '−'}{money(t.amount)}</div></div>)}</div> : <EmptyState icon={ArrowRightLeft} title="Nothing recorded yet" body="Once you add a few transactions, recent activity will live here." action={<Link className="btn btn-soft" href="/transactions">Add a transaction</Link>} />}
        </section>
        <div className="side-stack">
           <section className="panel reserve-card"><div className="eyebrow">A small cushion</div><div className="reserve-amount">{money(data?.taxSetAside)}</div><div className="reserve-sub">Your current estimate for taxable side income. This is a planning number you control, not tax advice.</div><div className="reserve-bar"><span style={{ width: data?.taxableIncomeThisYear ? `${Math.min(100, Math.max(12, (data.taxSetAside / data.taxableIncomeThisYear) * 100))}%` : '12%' }} /></div><div className="reserve-foot">Open your tax view to adjust the rate</div><Link href="/taxes" className="text-link" style={{ color: 'var(--folder-cream)', display: 'inline-block', marginTop: 13 }}>Review estimate <ChevronRight size={12} style={{ verticalAlign: 'middle' }} /></Link></section>
          <section className="panel"><div className="savings-card"><div className="saving-icon"><Leaf /></div><div><div className="saving-value">{money(data?.annualSavings)}</div><div className="saving-copy">estimated yearly savings from lower-cost comparable products</div></div></div><div className="mini-bars" aria-label="Illustrative annual savings trend">{monthBars.map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}</div></section>
           <div className="notice"><Info /><span>Sample account activity is only a preview. Real bank accounts are not linked, and demo entries never affect your totals.</span></div>
        </div>
      </div>
    </>}
  </div>;
}

function TransactionsPage() {
  const queryClient = useQueryClient();
  const transactions = useGetTransactions();
  const create = useCreateTransaction();
  const remove = useDeleteTransaction();
  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [error, setError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [csvImporting, setCsvImporting] = useState(false);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetTransactionsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() });
  };
  const list = useMemo(() => (transactions.data || []).filter((t) => filter === 'all' || t.type === filter), [transactions.data, filter]);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    const form = event.currentTarget;
    const fd = new FormData(form);
    const amount = Number(fd.get('amount'));
    if (!(amount > 0)) { setError('Enter an amount greater than zero.'); return; }
    create.mutate({ data: {
      type, label: String(fd.get('label')).trim(), amount, category: String(fd.get('category')).trim(),
      date: String(fd.get('date')), isTaxable: type === 'income' && fd.get('taxable') === 'on',
      source: String(fd.get('source') || '').trim() || null,
    } }, { onSuccess: () => { refresh(); setFormOpen(false); form.reset(); }, onError: (e) => setError(messageOf(e)) });
  };
  const importCsv = async (file?: File) => {
    if (!file) return;
    setError(''); setImportNotice(''); setCsvImporting(true);
    let imported = 0;
    try {
      const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) throw new Error('The CSV needs a header row and at least one transaction.');
      const headers = parseCsvRow(lines[0]!).map((value) => value.toLowerCase().replace(/[\s_-]+/g, ''));
      const find = (...names: string[]) => headers.findIndex((header) => names.includes(header));
      const dateIndex = find('date', 'transactiondate');
      const labelIndex = find('description', 'name', 'merchant', 'label');
      const amountIndex = find('amount', 'transactionamount');
      const categoryIndex = find('category');
      const typeIndex = find('type');
      if ([dateIndex, labelIndex, amountIndex, categoryIndex].some((index) => index < 0)) {
        throw new Error('CSV headers must include date, description, amount, and category. Type is optional.');
      }
      for (const line of lines.slice(1)) {
        const cells = parseCsvRow(line);
        const date = normalizeCsvDate(cells[dateIndex] || '');
        const label = (cells[labelIndex] || '').trim();
        const amountText = (cells[amountIndex] || '').replace(/[$,\s]/g, '');
        const rawAmount = Number(amountText);
        if (!date || !label || !Number.isFinite(rawAmount) || rawAmount === 0) continue;
        const rawType = typeIndex >= 0 ? (cells[typeIndex] || '').toLowerCase() : '';
        const transactionType = rawType === 'income' || (rawType !== 'expense' && rawAmount < 0) ? 'income' : 'expense';
        const category = cells[categoryIndex]?.trim() || '';
        if (!category) continue;
        await create.mutateAsync({ data: {
          type: transactionType, label: label.slice(0, 120), amount: Math.abs(rawAmount), category: category.slice(0, 60),
          date, isTaxable: false, source: 'CSV upload',
        } });
        imported += 1;
      }
      if (!imported) throw new Error('No valid rows were found. Check dates and non-zero amounts.');
      refresh();
      setImportNotice(`Imported ${imported} transaction${imported === 1 ? '' : 's'}.`);
    } catch (e) { setError(imported ? `Imported ${imported} rows before stopping: ${messageOf(e)}` : messageOf(e)); if (imported) refresh(); }
    finally { setCsvImporting(false); }
  };
  const deleteOne = (id: string) => {
    if (!window.confirm('Delete this transaction? This cannot be undone.')) return;
    remove.mutate({ id }, { onSuccess: refresh, onError: (e) => setError(messageOf(e)) });
  };
  return <div className="content">
    <PageHeading eyebrow="The everyday" title="Transactions" subtitle="Keep a clear record of spending and income. Saved entries stay separate from sample account activity." action={<div className="transaction-actions"><label className="btn btn-soft">{csvImporting ? 'Importing…' : 'Upload CSV'}<input type="file" accept=".csv,text/csv" disabled={csvImporting} onChange={(event) => { void importCsv(event.target.files?.[0]); event.currentTarget.value = ''; }} hidden /></label><button className="btn btn-primary" onClick={() => setFormOpen(!formOpen)} data-testid="button-add-transaction"><Plus />{formOpen ? 'Close form' : 'Add transaction'}</button></div>} />
    {error && <div className="error-box" role="alert" style={{ marginBottom: 15 }}><span>{error}</span><button onClick={() => setError('')}><X size={13} /></button></div>}
    {importNotice && <div className="notice" role="status" style={{ marginBottom: 15 }}>{importNotice}</div>}
    {formOpen && <section className="panel form-panel"><div className="panel-head" style={{ padding: '0 0 16px' }}><div><h2 className="panel-title">Add something to your ledger</h2><p className="panel-caption">Just the details you want to remember.</p></div></div>
      <form onSubmit={submit}><div className="form-grid">
        <div className="field"><label htmlFor="transaction-type">Type</label><select id="transaction-type" className="input" value={type} onChange={(e) => setType(e.target.value as 'income' | 'expense')} data-testid="select-transaction-type"><option value="expense">Expense</option><option value="income">Income</option></select></div>
        <div className="field"><label htmlFor="transaction-date">Date</label><input id="transaction-date" name="date" className="input" type="date" defaultValue={today()} required data-testid="input-transaction-date" /></div>
        <div className="field"><label htmlFor="transaction-label">What was it?</label><input id="transaction-label" name="label" className="input" placeholder={type === 'income' ? 'Project payment' : 'Weekly groceries'} maxLength={120} required data-testid="input-transaction-label" /></div>
        <div className="field"><label htmlFor="transaction-amount">Amount</label><input id="transaction-amount" name="amount" className="input" type="number" min="0.01" step="0.01" placeholder="0.00" required data-testid="input-transaction-amount" /></div>
        <div className="field"><label htmlFor="transaction-category">Category</label><select id="transaction-category" name="category" className="input" required data-testid="input-transaction-category"><option value="">Choose a category</option>{(type === 'expense' ? spendingCategories : ['Paycheck', 'Freelance', 'Interest', 'Gift', 'Other']).map((category) => <option key={category} value={category}>{category}</option>)}</select></div>
        <div className="field"><label htmlFor="transaction-source">Source or note <span style={{ fontWeight: 400 }}>(optional)</span></label><input id="transaction-source" name="source" className="input" placeholder={type === 'income' ? 'Client or platform' : 'A note for later'} maxLength={120} data-testid="input-transaction-source" /></div>
      </div>
        {type === 'income' && <label className="toggle-row"><input type="checkbox" name="taxable" defaultChecked data-testid="checkbox-income-taxable" /><span>Count this as taxable non-W-2 income<small>Choose this for side income you want included in your set-aside estimate.</small></span></label>}
        <div className="form-actions"><button type="button" className="btn btn-soft" onClick={() => setFormOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={create.isPending} data-testid="button-save-transaction">{create.isPending ? 'Saving…' : 'Save transaction'}</button></div>
      </form>
    </section>}
     <section className="panel"><div className="panel-head"><div><h2 className="panel-title">Your activity</h2><p className="panel-caption">Only real entries saved to your private ledger.</p></div><div className="filters">{(['all','income','expense'] as const).map((f) => <button key={f} className={`filter-chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)} data-testid={`filter-transactions-${f}`}>{f === 'all' ? 'Everything' : f === 'income' ? 'Income' : 'Spending'}</button>)}</div></div>
      {transactions.isLoading ? <div style={{ padding: '0 20px 20px' }}>{[0,1,2,3].map((i) => <div className="skeleton" key={i} />)}</div> : transactions.isError ? <div style={{ padding: 18 }}><ErrorPanel error={transactions.error} retry={() => transactions.refetch()} /></div> : list.length ? <TransactionList items={list} onDelete={deleteOne} /> : <EmptyState icon={Banknote} title={filter === 'all' ? 'No entries yet' : `No ${filter} entries`} body="Your ledger is yours to build. Add income or expenses when you’re ready." action={<button className="btn btn-primary" onClick={() => setFormOpen(true)}><Plus />Add transaction</button>} />}
    </section>
  </div>;
}

function PlanPage({ allowEdit = false }: { allowEdit?: boolean }) {
  const qc = useQueryClient();
  const plan = useGetBudgetPlan();
  const transactions = useGetTransactions();
  const receipts = useGetReceipts();
  const dashboard = useGetFinanceDashboard();
  const update = useUpdateBudgetPlan();
  const [annualIncome, setAnnualIncome] = useState('');
  const [annualSavingsGoal, setAnnualSavingsGoal] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [priorities, setPriorities] = useState<PriorityCategory[]>([]);
  const [categoryBudgets, setCategoryBudgets] = useState<CategoryBudgetDraft[]>([]);
  const [newBudgetCategory, setNewBudgetCategory] = useState<PriorityCategory | ''>('');
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState('');
  useEffect(() => {
    if (!plan.data) return;
    setAnnualIncome(String(plan.data.annualIncome ?? 0));
    setAnnualSavingsGoal(String(plan.data.annualSavingsGoal ?? 0));
    setMonthlyRent(String(plan.data.monthlyRent ?? 0));
    setPriorities((plan.data.priorityCategories || []).filter((item): item is PriorityCategory => spendingCategories.includes(item as PriorityCategory)));
    setCategoryBudgets(plan.data.categories.filter((item) => spendingCategories.includes(item.category as PriorityCategory)).map((item) => ({
      category: item.category as PriorityCategory,
      monthlyTarget: Number(item.monthlyTarget) || 0,
    })));
  }, [plan.data]);
  const configured = Boolean(plan.data?.setupComplete);
  const canEdit = allowEdit;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthSpend = useMemo(() => {
    const amounts = new Map<string, number>();
    (transactions.data || []).filter((item) => item.type === 'expense' && item.date.slice(0, 7) === thisMonth)
      .forEach((item) => amounts.set(item.category, (amounts.get(item.category) || 0) + Number(item.amount)));
    return amounts;
  }, [transactions.data, thisMonth]);
  const togglePriority = (category: PriorityCategory) => {
    setSaved(false);
    setPriorities((current) => current.includes(category)
      ? current.filter((item) => item !== category)
      : current.length < 3 ? [...current, category] : current);
  };
  const addBudgetCategory = () => {
    if (!newBudgetCategory || categoryBudgets.some((item) => item.category === newBudgetCategory)) return;
    setCategoryBudgets((current) => [...current, { category: newBudgetCategory, monthlyTarget: 0 }]);
    setNewBudgetCategory('');
    setSaved(false);
  };
  const savePlan = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    const income = Number(annualIncome);
    const savings = Number(annualSavingsGoal);
    const rent = Number(monthlyRent);
    if (!Number.isFinite(income) || income < 0 || !Number.isFinite(savings) || savings < 0 || !Number.isFinite(rent) || rent < 0) {
      setFormError('Enter valid income, rent, and savings amounts of zero or more.');
      return;
    }
    if (categoryBudgets.some((item) => !Number.isFinite(item.monthlyTarget) || item.monthlyTarget < 0)) {
      setFormError('Category budgets must be zero or more.');
      return;
    }
    const payload: BudgetPlanInput = { annualIncome: income, annualSavingsGoal: savings, monthlyRent: rent, priorityCategories: priorities, categoryBudgets };
    update.mutate({ data: payload }, {
      onSuccess: () => {
        setSaved(true);
        qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() });
        qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() });
      },
      onError: (error) => setFormError(messageOf(error)),
    });
  };
  return <div className="content">
    <PageHeading eyebrow="Your money, at a glance" title="My plan" subtitle="A clear view of what’s coming in, what matters most, and what you’re setting aside." action={<Link href="/transactions" className="btn btn-primary"><Plus />Add activity</Link>} />
    {!dashboard.isLoading && !dashboard.isError && <div className="metric-grid plan-dashboard-metrics">
      <div className="panel metric-card"><div className="metric-label"><ShoppingBag />Spent this month</div><div className="metric-value">{money(dashboard.data?.monthlySpending)}</div><div className="metric-note">From your saved expenses</div></div>
      <div className="panel metric-card"><div className="metric-label"><HandCoins />Side income this year</div><div className="metric-value">{money(dashboard.data?.taxableIncomeThisYear)}</div><div className="metric-note">Taxable income you recorded</div></div>
      <Link href="/profile" className="panel metric-card plan-tax-tile"><div className="metric-label"><BadgeDollarSign />Tax set-aside</div><div className="metric-value">{money(dashboard.data?.taxSetAside)}</div><div className="metric-note">Your estimate · update in profile</div></Link>
      <div className="panel metric-card"><div className="metric-label"><Leaf />Potential yearly savings</div><div className="metric-value">{money(dashboard.data?.annualSavings)}</div><div className="metric-note">From Better Buys comparisons</div></div>
    </div>}
    {dashboard.isError && <ErrorPanel error={dashboard.error} retry={() => dashboard.refetch()} />}
    <PlaidConnectCard />
    {plan.isLoading ? <LoadingPanel rows={3} /> : plan.isError ? <ErrorPanel error={plan.error} retry={() => plan.refetch()} /> : <>
      {!configured && <div className="plan-welcome" data-testid="status-plan-unconfigured"><div className="plan-welcome-mark"><Sparkles /></div><div><strong>Your first plan starts with a few essentials.</strong><p>Set your take-home income, monthly rent, savings goal, and priorities in account setup.</p><Link href="/profile" className="text-link" style={{ display: 'inline-block', marginTop: 8 }}>Start setup <ChevronRight size={13} /></Link></div></div>}
      {configured && (!transactions.data?.length || !receipts.data?.length) && <section className="panel getting-started-panel">
        <div><div className="eyebrow">A simple start</div><h2 className="panel-title">Make Margo useful, one step at a time</h2><p className="panel-caption">Your plan is ready. Add a little real activity to see your money picture and shopping opportunities take shape.</p></div>
        <div className="getting-started-grid">
          <Link href="/transactions" className="getting-started-card"><span className="getting-started-number">01</span><div><strong>Record income or spending</strong><span>{transactions.data?.length ? 'Your ledger has entries.' : 'Start your private money picture.'}</span></div><span className="getting-started-state">{transactions.data?.length ? 'Started' : 'Add activity'} <ChevronRight /></span></Link>
          <Link href="/receipts?scan=receipt" className="getting-started-card"><span className="getting-started-number">02</span><div><strong>Save a receipt</strong><span>{receipts.data?.length ? 'Your purchase history is growing.' : 'Add product details for Better Buys.'}</span></div><span className="getting-started-state">{receipts.data?.length ? 'Started' : 'Add receipt'} <ChevronRight /></span></Link>
          <Link href="/swaps" className="getting-started-card"><span className="getting-started-number">03</span><div><strong>Explore Better Buys</strong><span>Review lower-cost options when they’re available.</span></div><span className="getting-started-state">Explore <ChevronRight /></span></Link>
        </div>
      </section>}
      {plan.data?.goalFeasible === false && configured && <div className="plan-warning" role="status" data-testid="status-plan-infeasible"><Info /><span>Your rent and savings goal are higher than the take-home amount available for this plan. Adjust the amounts to make the plan workable.</span></div>}
      {formError && <div className="error-box" role="alert" style={{ marginBottom: 16 }}><span>{formError}</span><button type="button" onClick={() => setFormError('')} aria-label="Dismiss error" data-testid="button-dismiss-plan-error"><X /></button></div>}
      {configured && !canEdit && <div className="plan-lock-notice"><span>Your income, rent, savings goal, and priorities are saved. To update your plan, open your profile from the top-right corner.</span><Link href="/profile" className="btn btn-soft">Open profile <ChevronRight /></Link></div>}
      <div className="plan-layout">
        {canEdit && <section className="panel form-panel plan-form-panel">
          <div className="panel-head" style={{ padding: '0 0 18px' }}><div><div className="eyebrow">Your starting point</div><h2 className="panel-title">What should your money make possible?</h2><p className="panel-caption">Income and savings are annual; rent is monthly, in USD.</p></div></div>
          <form onSubmit={savePlan}>
            <div className="field"><label htmlFor="plan-income">Annual take-home income</label><div className="money-input"><span>$</span><input id="plan-income" className="input" type="number" min="0" step="100" value={annualIncome} onChange={(event) => { setAnnualIncome(event.target.value); setSaved(false); }} placeholder="72,000" required data-testid="input-plan-income" /></div><div className="field-help">Use after-tax money you actually have available for this plan.</div></div>
            <div className="field" style={{ marginTop: 17 }}><label htmlFor="plan-rent">Monthly rent</label><div className="money-input"><span>$</span><input id="plan-rent" className="input" type="number" min="0" step="25" value={monthlyRent} onChange={(event) => { setMonthlyRent(event.target.value); setSaved(false); }} placeholder="1,500" required data-testid="input-plan-rent" /></div><div className="field-help">Rent is set aside before the rest of your monthly spending guide.</div></div>
            <div className="field" style={{ marginTop: 17 }}><label htmlFor="plan-savings">Annual savings goal</label><div className="money-input"><span>$</span><input id="plan-savings" className="input" type="number" min="0" step="100" value={annualSavingsGoal} onChange={(event) => { setAnnualSavingsGoal(event.target.value); setSaved(false); }} placeholder="6,000" required data-testid="input-plan-savings" /></div><div className="field-help">A goal you can revisit whenever life changes.</div></div>
            <div className="field" style={{ marginTop: 22 }}>
              <label>Up to three priority categories <span className="priority-count" data-testid="text-priority-count">{priorities.length} of 3 selected</span></label>
              <div className="priority-picker">{spendingCategories.map((category) => <button type="button" key={category} className={`priority-chip ${priorities.includes(category) ? 'selected' : ''}`} aria-pressed={priorities.includes(category)} disabled={!priorities.includes(category) && priorities.length >= 3} onClick={() => togglePriority(category)} data-testid={`button-priority-${category.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`}>{category}{priorities.includes(category) && <Check aria-hidden="true" />}</button>)}</div>
              <div className="field-help">These are the things you want the plan to protect first.</div>
            </div>
            <div className="field category-budget-editor" style={{ marginTop: 22 }}>
              <label>Monthly category budgets</label>
              <div className="field-help">Keep, remove, or add categories, then set the monthly amount that works for you.</div>
              <div className="budget-category-list">{categoryBudgets.map((item) => <div className="budget-category-edit-row" key={item.category}>
                <strong>{item.category}</strong>
                <div className="money-input"><span>$</span><input className="input" type="number" min="0" step="25" value={item.monthlyTarget} aria-label={`${item.category} monthly budget`} onChange={(event) => { const amount = Number(event.target.value); setCategoryBudgets((current) => current.map((row) => row.category === item.category ? { ...row, monthlyTarget: amount } : row)); setSaved(false); }} data-testid={`input-budget-${item.category.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`} /></div>
                <button type="button" className="icon-button" disabled={categoryBudgets.length <= 1} aria-label={`Remove ${item.category} budget`} onClick={() => { setCategoryBudgets((current) => current.filter((row) => row.category !== item.category)); setSaved(false); }}><Trash2 /></button>
              </div>)}</div>
              <div className="budget-category-add"><select className="input" aria-label="Category to add" value={newBudgetCategory} onChange={(event) => setNewBudgetCategory(event.target.value as PriorityCategory | '')}><option value="">Add a category…</option>{spendingCategories.filter((category) => !categoryBudgets.some((item) => item.category === category)).map((category) => <option key={category} value={category}>{category}</option>)}</select><button type="button" className="btn btn-soft" disabled={!newBudgetCategory} onClick={addBudgetCategory}><Plus />Add category</button></div>
              <div className="field-help">Your category targets total {money(categoryBudgets.reduce((sum, item) => sum + (Number(item.monthlyTarget) || 0), 0))} per month. The available amount is {money(plan.data?.monthlySpendingTarget)}.</div>
            </div>
            <div className="plan-disclaimer"><Info /><span>Recommendations are adjustable starting points, not financial advice.</span></div>
            <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={update.isPending} data-testid="button-save-plan">{update.isPending ? 'Saving your plan…' : saved ? <><Check />Plan saved</> : 'Save my plan'}</button></div>
          </form>
        </section>}
        {configured && plan.data && <div className="plan-results">
          <section className="plan-summary" data-testid="section-plan-recommendations">
            <div className="eyebrow">Your monthly plan</div>
            <h2>Your money, in a rhythm.</h2>
            <p className="plan-summary-intro">Based on {money(plan.data.annualIncome)} take-home income per year.</p>
            <div className="plan-total-row"><span>Monthly take-home</span><strong data-testid="value-plan-monthly-income">{money(plan.data.monthlyIncomeTarget)}</strong></div>
            <div className="plan-total-row"><span>Monthly rent</span><strong data-testid="value-plan-monthly-rent">{money(plan.data.monthlyRent)}</strong></div>
            <div className="plan-total-row savings-target"><span>Monthly savings goal</span><strong data-testid="value-plan-monthly-savings">{money(plan.data.monthlySavingsTarget)}</strong></div>
            <div className="plan-total-row spend-target"><span>Available for monthly spending</span><strong data-testid="value-plan-monthly-spending">{money(plan.data.monthlySpendingTarget)}</strong></div>
          </section>
          <section className="panel plan-categories">
            <div className="panel-head"><div><h2 className="panel-title">Your category guide</h2><p className="panel-caption">Targets beside real spending from your manual ledger this month.</p></div></div>
            {plan.data.categories.length ? <div className="plan-category-list">{plan.data.categories.map((category) => {
              const spent = monthSpend.get(category.category) ?? Number(category.spentThisMonth || 0);
              const target = Number(category.monthlyTarget || 0);
              const progress = target > 0 ? Math.min(100, spent / target * 100) : spent > 0 ? 100 : 0;
              return <div className="plan-category-row" key={category.category} data-testid={`row-plan-category-${category.category.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`}>
                <div className="plan-category-top"><div><strong>{category.category}</strong>{(category.priority || priorities.some((item) => item === category.category)) && <span className="priority-label">Priority</span>}</div><span className="plan-category-spend">{money(spent)} <small>spent</small></span></div>
                <div className="plan-meter"><span style={{ width: `${progress}%` }} /></div>
                <div className="plan-category-bottom"><span>{Math.round(category.sharePercent)}% of spending plan</span><strong>{money(target)} <small>monthly guide</small></strong></div>
              </div>;
            })}</div> : <EmptyState icon={Wallet} title="Your category guide is taking shape" body="Save this plan to see monthly category recommendations next to real ledger spending." />}
            <div className="ledger-caption" data-testid="text-plan-ledger-source">Real ledger only · manual entries · {niceDate(`${thisMonth}-01`).replace(/, \d{4}$/, '')} to date</div>
          </section>
        </div>}
      </div>
      {dashboard.data?.recentTransactions?.length ? <section className="panel home-activity"><div className="panel-head"><div><h2 className="panel-title">Recent activity</h2><p className="panel-caption">Your latest saved transactions</p></div><Link href="/transactions" className="text-link">See all <ChevronRight size={13} /></Link></div><div className="transaction-list">{dashboard.data.recentTransactions.slice(0, 4).map((t) => <div className="transaction-row" key={t.id}><div className={`row-icon ${t.type}`}>{t.type === 'income' ? <ArrowDownLeft /> : <ArrowUpRight />}</div><div><div className="row-title">{t.label}</div><div className="row-meta">{t.category} · {niceDate(t.date)}</div></div><div className={`row-amount ${t.type}`}>{t.type === 'income' ? '+' : '−'}{money(t.amount)}</div></div>)}</div></section> : null}
      {transactions.isError && <div style={{ marginTop: 16 }}><ErrorPanel error={transactions.error} retry={() => transactions.refetch()} /></div>}
    </>}
  </div>;
}

function AccountsPage() {
  return <div className="content">
    <PageHeading eyebrow="Product preview" title="A little look at accounts." subtitle="Explore how an account view could feel. These examples are entirely made up." />
    <div className="demo-banner" role="note" data-testid="notice-demo-data"><div className="demo-stamp">SAMPLE ONLY</div><div><strong>No real bank is linked.</strong><p>This is synthetic demo data for preview only. It is not connected to Plaid and never enters your saved transactions or real totals.</p></div></div>
    <section className="account-grid" aria-label="Sample accounts">
      {demoBankActivity.accounts.map((account, index) => <article className={`account-card ${index === 1 ? 'account-card-blue' : ''}`} key={account.id} data-testid={`card-demo-account-${account.id}`}>
        <div className="account-card-top"><span className="account-mark"><Landmark /></span><span className="sample-tag">DEMO</span></div>
        <div className="account-kind">{account.kind} · SAMPLE ACCOUNT</div><h2>{account.name}</h2>
        <div className="account-mask">•••• {account.mask}</div><div className="account-balance-label">Illustrative balance</div><div className="account-balance" data-testid={`value-demo-balance-${account.id}`}>{money(account.balance)}</div>
      </article>)}
    </section>
    <section className="panel demo-activity-panel">
      <div className="panel-head"><div><div className="eyebrow">Synthetic preview activity</div><h2 className="panel-title">An example account rhythm</h2><p className="panel-caption">Every item below is fictional and separate from your personal ledger.</p></div><span className="badge badge-demo">DEMO DATA</span></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Example activity</th><th>Category</th><th>Date</th><th>Account</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead><tbody>
        {demoBankActivity.transactions.map((item) => {
          const account = demoBankActivity.accounts.find((entry) => entry.id === item.accountId);
          return <tr key={item.id} data-testid={`row-demo-activity-${item.id}`}><td><strong>{item.merchant}</strong><div className="row-meta">Synthetic example</div></td><td>{item.category}</td><td>{niceDate(item.date)}</td><td>{account?.name || 'Sample account'}</td><td className="demo-amount" style={{ textAlign: 'right' }}>{item.amount >= 0 ? '+' : '−'}{money(Math.abs(item.amount))}</td></tr>;
        })}
      </tbody></table></div>
      <div className="demo-footnote"><Info /><span>Preview only. Nothing here is connected, imported, or included in the overview, plan, or transaction ledger.</span></div>
    </section>
  </div>;
}

function TaxesPage() {
  const qc = useQueryClient();
  const settings = useGetFinanceSettings();
  const transactions = useGetTransactions({ type: 'income' });
  const dashboard = useGetFinanceDashboard();
  const update = useUpdateFinanceSettings();
  const [rate, setRate] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (settings.data && rate === null) setRate(settings.data.taxReserveRate); }, [settings.data, rate]);
  const taxable = useMemo(() => (transactions.data || []).filter((t) => t.isTaxable), [transactions.data]);
  const thisYear = new Date().getFullYear();
  const annualIncome = taxable.filter((t) => new Date(`${t.date.slice(0, 10)}T12:00:00`).getFullYear() === thisYear).reduce((sum, t) => sum + Number(t.amount), 0);
  const estimate = annualIncome * (rate ?? settings.data?.taxReserveRate ?? 0) / 100;
  const save = () => {
    if (rate === null) return;
    setError(''); setSaved(false);
    update.mutate({ data: { taxReserveRate: rate } }, { onSuccess: () => { setSaved(true); qc.invalidateQueries({ queryKey: getGetFinanceSettingsQueryKey() }); qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }); }, onError: (e) => setError(messageOf(e)) });
  };
  return <div className="content">
    <PageHeading eyebrow="A planning number" title="Your tax set-aside" subtitle="See taxable side income and choose a rate for your own estimate. Nothing here is tax advice." />
    {settings.isError && <ErrorPanel error={settings.error} retry={() => settings.refetch()} />}
    <div className="split-layout">
      <div>
        <section className="panel" style={{ marginBottom: 16 }}><div className="panel-head"><div><h2 className="panel-title">Taxable non-W-2 income</h2><p className="panel-caption">Only income entries marked taxable are included.</p></div><span className="badge badge-tax">{thisYear}</span></div>
          {transactions.isLoading ? <div style={{ padding: '0 20px' }}><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : transactions.isError ? <div style={{ padding: 18 }}><ErrorPanel error={transactions.error} retry={() => transactions.refetch()} /></div> : taxable.length ? <TransactionList items={taxable} /> : <EmptyState icon={HandCoins} title="No taxable income recorded" body="When you add non-W-2 income, mark it taxable and it will appear here." action={<Link href="/transactions" className="btn btn-soft">Add income</Link>} />}
        </section>
        <div className="notice"><Info /><span>Margo’s estimate is for personal planning only. Your tax situation may be different; consider checking with a qualified tax professional.</span></div>
      </div>
      <div>
        <section className="panel info-panel" style={{ marginBottom: 14 }}>
          <div className="eyebrow">Your estimate</div><h3>Set aside what feels right.</h3><p>Pick a percentage to apply to taxable non-W-2 income you’ve logged this year.</p>
          {dashboard.isLoading || settings.isLoading ? <div className="skeleton" style={{ marginTop: 18 }} /> : <>
            <div className="tax-summary" style={{ marginTop: 19 }}><div className="label">Estimated set-aside · {thisYear}</div><div className="amount" data-testid="value-tax-estimate">{money(estimate)}</div><div className="tiny">{money(annualIncome)} taxable income × {rate ?? settings.data?.taxReserveRate ?? 0}% user-selected rate</div></div>
            <div className="field"><label htmlFor="reserve-rate">Your set-aside rate</label><div className="rate-control"><input id="reserve-rate" type="range" min="0" max="60" step="1" value={rate ?? settings.data?.taxReserveRate ?? 0} onChange={(e) => { setRate(Number(e.target.value)); setSaved(false); }} data-testid="input-tax-rate" /><span className="rate-number">{rate ?? settings.data?.taxReserveRate ?? 0}%</span></div><div className="field-help">Adjustable from 0% to 60%. This is your estimate, not a recommended rate.</div></div>
            {error && <p style={{ color: '#a44', fontSize: 10, margin: '10px 0 0' }}>{error}</p>}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 15 }} onClick={save} disabled={update.isPending || rate === null} data-testid="button-save-tax-rate">{update.isPending ? 'Saving…' : saved ? <><Check />Saved</> : 'Save my rate'}</button>
          </>}
        </section>
      </div>
    </div>
  </div>;
}

type DraftItem = { productName: string; brand: string; category: string; unitPrice: string; unitsPerYear: string };
const blankItem = (): DraftItem => ({ productName: '', brand: '', category: '', unitPrice: '', unitsPerYear: '12' });
function ReceiptsPage() {
  const qc = useQueryClient();
  const receipts = useGetReceipts();
  const create = useCreateReceipt();
  const deleteReceipt = useDeleteReceipt();
  const getUploadUrl = useRequestUploadUrl();
  const [open, setOpen] = useState(() => Boolean(new URLSearchParams(window.location.search).get('scan')));
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [items, setItems] = useState<DraftItem[]>([blankItem()]);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [scanNotice, setScanNotice] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanMode = new URLSearchParams(window.location.search).get('scan');
  useEffect(() => {
    if (!cameraActive) return;
    type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
    type DetectorConstructor = new (options?: { formats: string[] }) => Detector;
    const DetectorApi = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    let stream: MediaStream | undefined;
    let frame = 0;
    let stopped = false;
    if (!DetectorApi) {
      setScanNotice('Barcode camera scanning is not supported in this browser. You can still add the product details manually.');
      setCameraActive(false);
      return;
    }
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        if (stopped) { stream.getTracks().forEach((track) => track.stop()); return; }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const detector = new DetectorApi({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
        const scan = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const [result] = await detector.detect(videoRef.current);
            if (result?.rawValue) {
              setItems((current) => current.map((item, index) => index === 0 ? { ...item, productName: result.rawValue } : item));
              setScanNotice(`Barcode ${result.rawValue} captured. Add the product name, price, and category to continue.`);
              setCameraActive(false);
              return;
            }
          } catch { /* Wait for the next camera frame. */ }
          frame = requestAnimationFrame(scan);
        };
        frame = requestAnimationFrame(scan);
      } catch (error) {
        setScanNotice(error instanceof Error ? error.message : 'Camera access was unavailable. You can add the product details manually.');
        setCameraActive(false);
      }
    };
    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [cameraActive]);
  useEffect(() => {
    if (!selectedFile) { setPreview(''); return; }
    if (selectedFile.type.startsWith('image/')) { const url = URL.createObjectURL(selectedFile); setPreview(url); return () => URL.revokeObjectURL(url); }
    setPreview('');
    return undefined;
  }, [selectedFile]);
  const refresh = () => { qc.invalidateQueries({ queryKey: getGetReceiptsQueryKey() }); qc.invalidateQueries({ queryKey: getGetPurchaseHistoryQueryKey() }); qc.invalidateQueries({ queryKey: getGetProductComparisonsQueryKey() }); qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }); };
  const chooseFile = (file?: File) => {
    setError('');
    if (!file) { setSelectedFile(null); return; }
    const validType = ['image/jpeg', 'image/png', 'application/pdf'].includes(file.type);
    if (!validType) { setError('Choose a JPG, PNG, or PDF file.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('This file is over 10 MB. Choose a smaller receipt.'); return; }
    setSelectedFile(file);
  };
  const updateItem = (index: number, key: keyof DraftItem, value: string) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, [key]: value } : item));
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    const form = event.currentTarget;
    const fd = new FormData(form);
    const merchant = String(fd.get('merchant') || '').trim();
    const total = Number(fd.get('total'));
    if (!merchant || !(total >= 0)) { setError('Add a merchant and a valid total.'); return; }
    const cleaned: ReceiptLineItem[] = items.filter((item) => item.productName.trim() && Number(item.unitPrice) > 0).map((item) => ({
      productName: item.productName.trim(), brand: item.brand.trim() || null, category: item.category.trim() || 'Other',
      unitPrice: Number(item.unitPrice), unitsPerYear: Math.max(1, Math.min(1000, Number(item.unitsPerYear) || 1)),
    }));
    if (!cleaned.length) { setError('Add at least one product line item with a price.'); return; }
    setUploading(true);
    try {
      let objectPath: string | null = null;
      if (selectedFile) {
        const response = await getUploadUrl.mutateAsync({ data: { name: selectedFile.name, size: selectedFile.size, contentType: selectedFile.type } });
        const upload = await fetch(response.uploadURL, { method: 'PUT', headers: { 'Content-Type': selectedFile.type }, body: selectedFile });
        if (!upload.ok) throw new Error('The receipt file could not be uploaded. Please try again.');
        objectPath = response.objectPath;
      }
      await create.mutateAsync({ data: { merchant, purchasedAt: String(fd.get('purchasedAt')), total, objectPath, items: cleaned } });
      refresh(); form.reset(); setSelectedFile(null); setItems([blankItem()]); setOpen(false);
    } catch (e) { setError(messageOf(e)); } finally { setUploading(false); }
  };
  const remove = (id: string) => {
    if (!window.confirm('Delete this saved receipt?')) return;
    deleteReceipt.mutate({ id }, { onSuccess: refresh, onError: (e) => setError(messageOf(e)) });
  };
  return <div className="content">
    <PageHeading eyebrow="Keep the details" title="Receipts" subtitle="Upload a receipt and enter its products. Barcode scans can prefill a code; product details are still entered manually." action={<button className="btn btn-primary" onClick={() => { setOpen(!open); setError(''); }} data-testid="button-add-receipt"><FilePlus2 />{open ? 'Close form' : 'Add receipt'}</button>} />
    {error && <div className="error-box" role="alert" style={{ marginBottom: 14 }}><span>{error}</span><button onClick={() => setError('')}><X size={13} /></button></div>}
    {open && <section className="panel form-panel">
      <div className="panel-head" style={{ padding: '0 0 15px' }}><div><h2 className="panel-title">Save a receipt</h2><p className="panel-caption">Upload an image or PDF, then enter the details and products.</p></div></div>
      <form onSubmit={submit}>
        {(scanMode === 'barcode' || cameraActive || scanNotice) && <div className="barcode-scan-panel">
          <div><strong>Scan a product barcode</strong><p>We’ll add the barcode to the first product row. Enter the product name and price for comparisons.</p></div>
          {!cameraActive && <button type="button" className="btn btn-soft" onClick={() => { setScanNotice(''); setCameraActive(true); }}>Open camera</button>}
          {cameraActive && <button type="button" className="btn btn-soft" onClick={() => setCameraActive(false)}>Stop camera</button>}
          {cameraActive && <video ref={videoRef} className="barcode-video" muted playsInline aria-label="Barcode scanner camera" />}
          {scanNotice && <p className="barcode-scan-status" role="status">{scanNotice}</p>}
        </div>}
        <div className="form-grid">
          <div className="field"><label htmlFor="receipt-merchant">Merchant</label><input id="receipt-merchant" name="merchant" className="input" placeholder="Corner market" maxLength={120} required data-testid="input-receipt-merchant" /></div>
          <div className="field"><label htmlFor="receipt-date">Purchase date</label><input id="receipt-date" name="purchasedAt" type="date" defaultValue={today()} className="input" required data-testid="input-receipt-date" /></div>
          <div className="field"><label htmlFor="receipt-total">Receipt total</label><input id="receipt-total" name="total" type="number" min="0" step="0.01" className="input" placeholder="0.00" required data-testid="input-receipt-total" /></div>
          <div className="field"><label>Receipt file <span style={{ fontWeight: 400 }}>(optional)</span></label><div className="upload-box"><input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" capture="environment" onChange={(e) => chooseFile(e.target.files?.[0])} data-testid="input-receipt-file" /><Upload /><strong>{selectedFile ? selectedFile.name : 'Take a photo or choose a receipt'}</strong><span>JPG, PNG, or PDF · up to 10 MB</span>{preview && <img className="upload-preview" src={preview} alt="Selected receipt preview" />}</div></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 0 9px' }}><div><h3 className="panel-title" style={{ fontSize: 16 }}>Product line items</h3><p className="panel-caption">Enter items manually; these details power product comparisons.</p></div><button type="button" className="btn btn-soft" onClick={() => setItems((old) => [...old, blankItem()])} data-testid="button-add-line-item"><Plus />Add item</button></div>
        {items.map((item, index) => <div className="receipt-item" key={index}>
          <div className="field"><label>Product</label><input className="input" value={item.productName} onChange={(e) => updateItem(index, 'productName', e.target.value)} placeholder="Oat milk" maxLength={120} required data-testid={`input-product-name-${index}`} /></div>
          <div className="field"><label>Brand</label><input className="input" value={item.brand} onChange={(e) => updateItem(index, 'brand', e.target.value)} placeholder="Optional" maxLength={80} data-testid={`input-product-brand-${index}`} /></div>
          <div className="field"><label>Category</label><input className="input" value={item.category} onChange={(e) => updateItem(index, 'category', e.target.value)} placeholder="Pantry" maxLength={60} required data-testid={`input-product-category-${index}`} /></div>
          <div className="field"><label>Unit price · bought yearly</label><div style={{ display:'flex', gap:5 }}><input className="input" type="number" min="0.01" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(index, 'unitPrice', e.target.value)} placeholder="$0.00" required data-testid={`input-product-price-${index}`} /><input className="input" type="number" min="1" max="1000" value={item.unitsPerYear} onChange={(e) => updateItem(index, 'unitsPerYear', e.target.value)} aria-label="Units per year" title="Units per year" required data-testid={`input-product-units-${index}`} /></div></div>
          <button type="button" className="icon-button" aria-label={`Remove line item ${index + 1}`} disabled={items.length === 1} onClick={() => setItems((old) => old.filter((_, i) => i !== index))} data-testid={`button-remove-line-item-${index}`}><Trash2 /></button>
        </div>)}
        <div className="form-actions"><button type="button" className="btn btn-soft" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={uploading || create.isPending || getUploadUrl.isPending} data-testid="button-save-receipt">{uploading ? <><LoaderCircle className="animate-spin" />Saving…</> : 'Save receipt'}</button></div>
      </form>
    </section>}
    <section className="panel"><div className="panel-head"><div><h2 className="panel-title">Saved receipts</h2><p className="panel-caption">Your receipt archive and manually entered items.</p></div><span className="badge badge-muted">{receipts.data?.length || 0} saved</span></div>
      {receipts.isLoading ? <div style={{ padding: '0 20px 18px' }}>{[0,1,2].map((i) => <div className="skeleton" key={i} />)}</div> : receipts.isError ? <div style={{ padding: 18 }}><ErrorPanel error={receipts.error} retry={() => receipts.refetch()} /></div> : receipts.data?.length ? <div style={{ padding: '0 18px 12px' }}>{receipts.data.map((receipt) => <div className="panel receipt-card" key={receipt.id} style={{ boxShadow: 'none' }} data-testid={`card-receipt-${receipt.id}`}><div className="receipt-icon">{receipt.objectPath ? <FileImage /> : <FileText />}</div><div className="receipt-content"><div className="receipt-title">{receipt.merchant}</div><div className="receipt-sub">{niceDate(receipt.purchasedAt)} · {receipt.items.length} manually entered {receipt.items.length === 1 ? 'item' : 'items'}</div>{expanded === receipt.id && <div className="receipt-detail"><span>Receipt total<strong>{money(receipt.total)}</strong></span><span>Products<strong>{receipt.items.map((i) => i.productName).join(', ') || 'None'}</strong></span><span>File<strong>{receipt.objectPath ? 'Uploaded' : 'No file attached'}</strong></span></div>}</div><div className="receipt-total">{money(receipt.total)}</div><button className="icon-button" onClick={() => setExpanded(expanded === receipt.id ? null : receipt.id)} aria-label="Toggle receipt details" data-testid={`button-expand-receipt-${receipt.id}`}><ChevronRight style={{ transform: expanded === receipt.id ? 'rotate(90deg)' : undefined }} /></button><button className="icon-button" onClick={() => remove(receipt.id)} aria-label="Delete receipt" data-testid={`button-delete-receipt-${receipt.id}`}><Trash2 /></button></div>)}</div> : <EmptyState icon={ReceiptText} title="Your receipt shelf is empty" body="Add a receipt to keep its total, merchant, and product details together." action={<button className="btn btn-primary" onClick={() => setOpen(true)}><Plus />Add receipt</button>} />}
    </section>
  </div>;
}

function SwapsPage() {
  const comparisons = useGetProductComparisons();
  const dashboard = useGetFinanceDashboard();
  const profile = useGetSwapProfile();
  const purchaseHistory = useGetPurchaseHistory();
  const grouped = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof comparisons.data>>();
    (comparisons.data || []).forEach((item) => groups.set(item.category, [...(groups.get(item.category) || []), item]));
    return Array.from(groups.entries());
  }, [comparisons.data]);
  const needsVerifiedProductDetails = Boolean(profile.data && (
    profile.data.values.length || profile.data.dietaryNeeds.trim() || profile.data.productPreferences.trim()
  ));
  return <div className="content">
    <PageHeading eyebrow="Small changes add up" title="Better buys" subtitle="Compare products you’ve entered with lower-cost alternatives in the same category." />
    <section className="panel" style={{ background: '#e7eef0', borderColor: '#d5e1e3', padding: '19px 22px', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 15 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}><div className="saving-icon" style={{ background: '#d3e3e8' }}><Leaf /></div><div><div className="eyebrow" style={{ marginBottom: 3 }}>Potential yearly difference</div><div style={{ font: '600 24px var(--app-font-serif)' }} data-testid="value-swap-total">{money(dashboard.data?.annualSavings)}</div></div></div><div className="better-buy-actions"><Link href="/receipts?scan=receipt" className="btn btn-soft"><ReceiptText />Scan receipt</Link><Link href="/receipts?scan=barcode" className="btn btn-soft"><ShoppingBag />Scan barcode</Link></div>
    </section>
    <section className="panel purchase-history-panel">
      <div className="panel-head"><div><h2 className="panel-title">Your purchase history</h2><p className="panel-caption">Products entered from saved receipt items.</p></div><span className="badge badge-muted">{purchaseHistory.data?.length || 0} products</span></div>
      {purchaseHistory.isLoading ? <div style={{ padding: '0 20px 18px' }}><div className="skeleton" /><div className="skeleton" /></div> : purchaseHistory.isError ? <div style={{ padding: 18 }}><ErrorPanel error={purchaseHistory.error} retry={() => purchaseHistory.refetch()} /></div> : purchaseHistory.data?.length ? <div className="purchase-history-list">{purchaseHistory.data.map((item) => <PurchaseHistoryCard key={item.id} item={item} />)}</div> : <EmptyState icon={ShoppingBag} title="Your product history is taking shape" body="Save receipt products to build a private purchase history and see verified alternatives here." action={<Link href="/receipts" className="btn btn-soft">Add receipt items <ChevronRight /></Link>} />}
    </section>
    {comparisons.isLoading ? <LoadingPanel rows={5} /> : comparisons.isError ? <ErrorPanel error={comparisons.error} retry={() => comparisons.refetch()} /> : grouped.length ? <div className="panel">{grouped.map(([category, entries]) => <div key={category}><div className="category-heading">{category}</div>{entries.map((item, i) => <div className="comparison-row" key={`${item.productName}-${i}`} data-testid={`comparison-${i}-${category.toLowerCase().replaceAll(' ', '-')}`}><div className="product"><div className="product-name">{item.productName}</div><div className="product-brand">{item.brand || 'Current choice'} · {item.unitsPerYear} / year</div><div className="product-price">{money(item.unitPrice)} <small>each</small></div></div><div className="swap-arrow"><ArrowRightLeft /></div><div className="product"><div className="product-name">{item.alternativeName}</div><div className="product-brand">{item.alternativeBrand || 'Alternative'}</div><div className="product-price">{money(item.alternativePrice)} <small>each</small></div></div><div className="save-amount"><strong>{money(item.annualSavings)}</strong><span>per year</span></div></div>)}</div>)}</div> : <div className="panel"><EmptyState icon={Leaf} title={needsVerifiedProductDetails ? 'Waiting on verified product details' : profile.data?.swapCategories.length ? 'No comparisons just yet' : 'Choose what you’re open to'} body={needsVerifiedProductDetails ? 'You added product requirements we cannot verify from receipt names alone, so Margo is holding suggestions instead of guessing.' : profile.data?.swapCategories.length ? 'Add product line items to your receipts. Comparable products and their estimated yearly savings will show up here.' : 'Pick the areas where you’re willing to consider a swap. Your non-negotiables stay out of the suggestions.'} action={<Link href={needsVerifiedProductDetails ? '/onboarding' : profile.data?.swapCategories.length ? '/receipts' : '/onboarding'} className="btn btn-primary"><Plus />{needsVerifiedProductDetails ? 'Review my preferences' : profile.data?.swapCategories.length ? 'Add a receipt' : 'Set my preferences'}</Link>} /></div>}
    <p style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))', marginTop: 13, lineHeight: 1.5 }}>Savings are estimates based on product prices and annual usage you entered. Availability and prices may change.</p>
  </div>;
}

function PurchaseHistoryCard({ item }: { item: PurchaseHistoryItem }) {
  const productId = item.productId || '';
  const alternatives = useGetProductAlternatives(productId, { query: { queryKey: getGetProductAlternativesQueryKey(productId), enabled: Boolean(productId) } });
  const vote = useVoteOnProductAlternative();
  const qc = useQueryClient();
  return <article className="purchase-history-row">
    <div className="purchase-history-product"><strong>{item.productName}</strong><span>{item.brand || 'Brand not recorded'} · {item.category} · {money(item.unitPrice)}</span><small>{niceDate(item.purchasedAt)} · {item.source}</small></div>
    {alternatives.data?.map((option) => <div className="purchase-alternative" key={option.id}>
      <div><strong>{option.name}</strong><span>{option.brand} · {option.similarityScore}% similarity · {option.savingsScore}% savings score</span></div>
      <div className="purchase-vote-actions">
        {option.affiliateUrl && <a href={option.affiliateUrl} target="_blank" rel="noreferrer sponsored" className="text-link">View offer <ChevronRight size={12} /></a>}
        <button className="btn btn-soft" onClick={() => vote.mutate({ alternativeId: option.id, data: { vote: 1 } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetProductAlternativesQueryKey(item.productId || '') }) })} disabled={vote.isPending}>Helpful · {option.positiveVotes}</button>
        <button className="btn btn-soft" onClick={() => vote.mutate({ alternativeId: option.id, data: { vote: -1 } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetProductAlternativesQueryKey(item.productId || '') }) })} disabled={vote.isPending}>Not a match · {option.negativeVotes}</button>
      </div>
    </div>)}
    {alternatives.isError && <span className="row-meta">Alternatives are temporarily unavailable.</span>}
  </article>;
}

const profileCategoryOptions = [
  ['beauty', 'Beauty'], ['groceries', 'Groceries'], ['clothes', 'Clothes'],
  ['household', 'Household'], ['travel', 'Travel'], ['subscriptions', 'Subscriptions'],
] as const;
const profileValueOptions = [
  ['clean-beauty', 'Clean beauty'], ['organic', 'Organic'], ['vegan', 'Vegan'],
  ['cruelty-free', 'Cruelty-free'], ['local', 'Local'], ['budget-first', 'Budget first'],
] as const;
const blankProfile: SwapProfileInput = {
  savingFor: '', monthlySavingsGoal: 0, nonNegotiables: [], swapCategories: [],
  favoriteBrands: [], values: [], dietaryNeeds: '', productPreferences: '',
};

const nonNegotiableSuggestions = ['Morning latte', 'Cruelty-free makeup', 'Organic produce', 'Name-brand cereal', 'My running shoes', 'Direct flights', 'Streaming'];

function OnboardingPage() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const profileQuery = useGetSwapProfile();
  const planQuery = useGetBudgetPlan();
  const saveProfile = useUpdateSwapProfile();
  const savePlan = useUpdateBudgetPlan();
  const [profile, setProfile] = useState<SwapProfileInput>(blankProfile);
  const [annualIncome, setAnnualIncome] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [step, setStep] = useState(0);
  const [customNonNegotiable, setCustomNonNegotiable] = useState('');
  const [error, setError] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const steps = [
    { prompt: 'What are you saving for?', hint: 'A little context helps us keep the plan pointed at what matters to you.' },
    { prompt: 'What feels right to save each month?', hint: 'Choose a starting goal. You can always change it later.' },
    { prompt: 'What is your annual take-home income?', hint: 'The amount you actually receive after taxes, before monthly expenses.' },
    { prompt: 'What do you pay for rent each month?', hint: 'If rent does not apply, enter zero.' },
    { prompt: 'What is absolutely staying?', hint: 'Pick your non-negotiables, then add anything we missed.' },
    { prompt: 'Where are you open to a different pick?', hint: 'Only choose categories where a thoughtful alternative could work.' },
  ];
  useEffect(() => {
    if (initialized || profileQuery.isLoading || planQuery.isLoading || profileQuery.isError || planQuery.isError) return;
    if (profileQuery.data) setProfile(profileQuery.data);
    if (planQuery.data) {
      setAnnualIncome(String(planQuery.data.annualIncome ?? ''));
      setMonthlyRent(String(planQuery.data.monthlyRent ?? ''));
    }
    setInitialized(true);
  }, [initialized, profileQuery.data, profileQuery.isLoading, profileQuery.isError, planQuery.data, planQuery.isLoading, planQuery.isError]);
  const toggleProfileList = (key: 'nonNegotiables' | 'swapCategories', value: string) => {
    setProfile((current) => {
      const values = current[key] as string[];
      return { ...current, [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] };
    });
  };
  const addCustomNonNegotiable = () => {
    const value = customNonNegotiable.trim();
    if (!value || profile.nonNegotiables.includes(value) || profile.nonNegotiables.length >= 40) return;
    setProfile((current) => ({ ...current, nonNegotiables: [...current.nonNegotiables, value] }));
    setCustomNonNegotiable('');
  };
  const completeSetup = async () => {
    setSaving(true); setError('');
    const profilePayload: SwapProfileInput = { ...profile, savingFor: profile.savingFor.trim(), monthlySavingsGoal: Number(profile.monthlySavingsGoal) || 0 };
    const planPayload: BudgetPlanInput = {
      annualIncome: Number(annualIncome) || 0,
      annualSavingsGoal: (Number(profile.monthlySavingsGoal) || 0) * 12,
      monthlyRent: Number(monthlyRent) || 0,
      priorityCategories: [],
      categoryBudgets: [],
    };
    try {
      await saveProfile.mutateAsync({ data: profilePayload });
      await savePlan.mutateAsync({ data: planPayload });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetSwapProfileQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() }),
      ]);
      setLocation('/');
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setSaving(false);
    }
  };
  const next = () => {
    setError('');
    if (step === 0 && !profile.savingFor.trim()) { setError('Tell me what you’re saving for, even if it is just a first idea.'); return; }
    if (step === 1 && (!Number.isFinite(profile.monthlySavingsGoal) || profile.monthlySavingsGoal < 0)) { setError('Add a monthly goal of zero or more.'); return; }
    if (step === 2 && (annualIncome === '' || !Number.isFinite(Number(annualIncome)) || Number(annualIncome) < 0)) { setError('Add your annual take-home amount, or enter zero.'); return; }
    if (step === 3 && (monthlyRent === '' || !Number.isFinite(Number(monthlyRent)) || Number(monthlyRent) < 0)) { setError('Add your monthly rent, or enter zero.'); return; }
    if (step < steps.length - 1) setStep((current) => current + 1);
    else void completeSetup();
  };
  if (profileQuery.isLoading || planQuery.isLoading || !initialized) {
    return <div className="content onboarding-content"><PageHeading eyebrow="A quick hello" title="Let’s make room for what matters." subtitle="Just a few thoughtful questions, one at a time." /><div className="conversation-skeleton panel"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div></div>;
  }
  if (profileQuery.isError || planQuery.isError) return <div className="content onboarding-content"><PageHeading eyebrow="A quick hello" title="Let’s get you settled." subtitle="We couldn’t load your saved details just now." />{profileQuery.isError && <ErrorPanel error={profileQuery.error} retry={() => profileQuery.refetch()} />}{planQuery.isError && <ErrorPanel error={planQuery.error} retry={() => planQuery.refetch()} />}</div>;
  const current = steps[step];
  return <div className="content onboarding-content">
    <div className="onboarding-intro"><div className="eyebrow">A first conversation with Margo</div><h1>Keep what you love.<br /><span>Make room to save.</span></h1><p>We’ll shape a starting point around your real life, not a set of rules.</p></div>
    <section className="conversation-card panel" aria-label={`Setup question ${step + 1} of ${steps.length}`} data-testid="panel-onboarding-conversation">
      <div className="conversation-topline"><span className="conversation-avatar"><MessageCircle size={17} /></span><span>Margo <small>your money friend</small></span><div className="conversation-progress" aria-label={`Question ${step + 1} of ${steps.length}`}><span style={{ transform: `scaleX(${(step + 1) / steps.length})` }} /></div><span className="conversation-count">{step + 1} / {steps.length}</span></div>
      <div className="chat-thread" key={step}>
        <div className="chat-bubble margo-bubble"><p>{current.prompt}</p><small>{current.hint}</small></div>
        <div className={`chat-answer ${step === 4 || step === 5 ? 'answer-wide' : ''}`}>
          {step === 0 && <input autoFocus className="conversation-input" value={profile.savingFor} maxLength={160} onChange={(event) => setProfile({ ...profile, savingFor: event.target.value })} placeholder="A rainy-day fund, a trip, more breathing room…" aria-label="What are you saving for" data-testid="input-onboarding-saving-for" />}
          {step === 1 && <div className="conversation-money"><span>$</span><input autoFocus className="conversation-input" type="number" min="0" max="1000000" step="25" value={profile.monthlySavingsGoal} onChange={(event) => setProfile({ ...profile, monthlySavingsGoal: Number(event.target.value) || 0 })} aria-label="Monthly savings goal" data-testid="input-onboarding-monthly-goal" /><small>per month</small></div>}
          {step === 2 && <div className="conversation-money"><span>$</span><input autoFocus className="conversation-input" type="number" min="0" step="100" value={annualIncome} onChange={(event) => setAnnualIncome(event.target.value)} placeholder="68,000" aria-label="Annual take-home income" data-testid="input-onboarding-income" /><small>per year</small></div>}
          {step === 3 && <div className="conversation-money"><span>$</span><input autoFocus className="conversation-input" type="number" min="0" step="25" value={monthlyRent} onChange={(event) => setMonthlyRent(event.target.value)} placeholder="1,450" aria-label="Monthly rent" data-testid="input-onboarding-rent" /><small>per month</small></div>}
          {step === 4 && <div className="onboarding-chip-area"><div className="onboarding-chip-list">{nonNegotiableSuggestions.map((item) => <button type="button" key={item} className={`conversation-chip ${profile.nonNegotiables.includes(item) ? 'selected' : ''}`} aria-pressed={profile.nonNegotiables.includes(item)} onClick={() => toggleProfileList('nonNegotiables', item)} data-testid={`chip-nonnegotiable-${item.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`}>{item}{profile.nonNegotiables.includes(item) && <Check size={13} />}</button>)}</div><div className="conversation-custom"><input className="conversation-input" value={customNonNegotiable} onChange={(event) => setCustomNonNegotiable(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomNonNegotiable(); } }} placeholder="Add your own, in your words" aria-label="Add a non-negotiable" data-testid="input-onboarding-custom-nonnegotiable" /><button type="button" className="btn btn-soft" onClick={addCustomNonNegotiable} data-testid="button-add-nonnegotiable"><Plus />Add</button></div>{profile.nonNegotiables.filter((item) => !nonNegotiableSuggestions.includes(item)).map((item) => <button type="button" className="conversation-custom-chip" key={item} onClick={() => toggleProfileList('nonNegotiables', item)} aria-label={`Remove ${item}`} data-testid={`button-remove-nonnegotiable-${item.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`}>{item}<X size={13} /></button>)}</div>}
          {step === 5 && <div className="onboarding-chip-list category-chips">{profileCategoryOptions.map(([value, label]) => <button type="button" key={value} className={`conversation-chip category-chip ${profile.swapCategories.includes(value) ? 'selected' : ''}`} aria-pressed={profile.swapCategories.includes(value)} onClick={() => toggleProfileList('swapCategories', value)} data-testid={`chip-swap-category-${value}`}><span className="category-chip-mark">{profile.swapCategories.includes(value) ? <Check size={14} /> : <Plus size={14} />}</span>{label}</button>)}</div>}
        </div>
      </div>
      {error && <div className="conversation-error" role="alert" data-testid="status-onboarding-error">{error}</div>}
      <div className="conversation-actions"><span className="conversation-save-note">Your answers stay yours. Edit them anytime in Profile.</span><div>{step > 0 && <button type="button" className="btn btn-soft" onClick={() => { setError(''); setStep((value) => value - 1); }} disabled={saving} data-testid="button-onboarding-back">Back</button>}<button type="button" className="btn btn-primary" onClick={next} disabled={saving} data-testid="button-onboarding-continue">{saving ? 'Saving your plan…' : step === steps.length - 1 ? 'Finish setup' : 'Continue'}{saving ? <LoaderCircle className="animate-spin" /> : <ChevronRight />}</button></div></div>
    </section>
    <p className="conversation-footnote">No perfect answers needed. This is a starting point, not a test.</p>
  </div>;
}

function ProfilePreferencesPage() {
  const qc = useQueryClient();
  const query = useGetSwapProfile();
  const saveProfile = useUpdateSwapProfile();
  const [draft, setDraft] = useState<SwapProfileInput>(blankProfile);
  const [initialized, setInitialized] = useState(false);
  const [step, setStep] = useState(0);
  const [tag, setTag] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (query.data && !initialized) {
      setDraft(query.data);
      setInitialized(true);
    }
  }, [query.data, initialized]);
  const setList = (key: 'nonNegotiables' | 'favoriteBrands' | 'swapCategories' | 'values', value: string) => {
    setDraft((current) => {
      const list = current[key] as string[];
      return { ...current, [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value] };
    });
    setSaved(false);
  };
  const addTag = (key: 'nonNegotiables' | 'favoriteBrands') => {
    const value = tag.trim();
    if (!value) return;
    setDraft((current) => ({ ...current, [key]: Array.from(new Set([...current[key], value])).slice(0, 40) }));
    setTag('');
    setSaved(false);
  };
  const persist = () => {
    setError('');
    saveProfile.mutate({ data: draft }, {
      onSuccess: () => {
        setSaved(true);
        qc.invalidateQueries({ queryKey: getGetSwapProfileQueryKey() });
        qc.invalidateQueries({ queryKey: getGetProductComparisonsQueryKey() });
      },
      onError: (e) => setError(messageOf(e)),
    });
  };
  const stepTitles = ['What are you saving for?', 'What will you not give up?', 'What are you open to swapping?', 'What should we keep in mind?'];
  return <div className="content">
    <PageHeading eyebrow="Get to know you" title="Your money, your rules." subtitle="A short profile helps Margo keep suggestions focused on what matters to you." />
    {query.isLoading && <LoadingPanel rows={2} />}
    {query.isError && <ErrorPanel error={query.error} retry={() => query.refetch()} />}
    {!query.isLoading && !query.isError && <section className="panel profile-wizard">
      <div className="profile-progress"><span>QUESTION {step + 1} OF 4</span><div className="profile-progress-segments" aria-label={`Step ${step + 1} of 4`}>{[0, 1, 2, 3].map((index) => <i className={index <= step ? 'complete' : ''} key={index} />)}</div></div>
      <div className="profile-step-content">
        <div className="eyebrow">A little about you</div><h2>{stepTitles[step]}</h2>
        {step === 0 && <div className="profile-fields">
          <div className="field"><label htmlFor="saving-for">What would you like to save for?</label><input id="saving-for" className="input" value={draft.savingFor} maxLength={160} onChange={(e) => setDraft({ ...draft, savingFor: e.target.value })} placeholder="A trip, an emergency cushion, a home…" /></div>
          <div className="field"><label htmlFor="monthly-savings">How much do you want to save each month?</label><div className="money-input"><span>$</span><input id="monthly-savings" className="input" type="number" min="0" max="1000000" step="25" value={draft.monthlySavingsGoal} onChange={(e) => setDraft({ ...draft, monthlySavingsGoal: Number(e.target.value) || 0 })} /></div></div>
        </div>}
        {step === 1 && <div className="profile-nonnegotiables">
          <div className="profile-chat"><p>Okay, real talk. What will you never give up, no matter how much we could save?</p><p>I’ll never suggest swapping these. Promise.</p></div>
          <h3>Your non-negotiables</h3>
          <div className="profile-tags profile-suggested-chips">{[...new Set(['Morning latte', 'Cruelty-free makeup', 'Organic produce', 'Name-brand cereal', 'My running shoes', 'Direct flights', 'Streaming', ...draft.nonNegotiables])].map((item) => <button type="button" key={item} aria-pressed={draft.nonNegotiables.includes(item)} className={`profile-tag ${draft.nonNegotiables.includes(item) ? 'selected' : ''}`} onClick={() => setList('nonNegotiables', item)}>{draft.nonNegotiables.includes(item) && <Check size={13} />}{item}</button>)}</div>
          <div className="field profile-free-text"><label htmlFor="non-negotiable-custom">Something else?</label><div className="profile-tag-entry"><input id="non-negotiable-custom" className="input" value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag('nonNegotiables'); } }} placeholder="Type it like you’d text a friend" /><button className="btn btn-soft" onClick={() => addTag('nonNegotiables')}><Plus />Add</button></div></div>
        </div>}
        {step === 2 && <><p className="panel-caption">Pick only the areas where you would actually consider a different product.</p><div className="profile-choice-grid">{profileCategoryOptions.map(([value, label]) => <button type="button" aria-pressed={draft.swapCategories.includes(value)} className={`profile-choice ${draft.swapCategories.includes(value) ? 'selected' : ''}`} key={value} onClick={() => setList('swapCategories', value)}><span className="profile-check">{draft.swapCategories.includes(value) ? '✓' : '+'}</span>{label}</button>)}</div></>}
        {step === 3 && <div className="profile-fields">
          <div className="field"><label>Favorite brands</label><div className="profile-tag-entry"><input className="input" value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag('favoriteBrands'); } }} placeholder="Add a brand" /><button className="btn btn-soft" onClick={() => addTag('favoriteBrands')}><Plus />Add</button></div><div className="profile-tags">{draft.favoriteBrands.map((item) => <button key={item} className="profile-tag" onClick={() => setList('favoriteBrands', item)}>{item}<X size={13} /></button>)}</div></div>
          <div className="field"><label>Values and dealbreakers</label><div className="profile-choice-grid compact">{profileValueOptions.map(([value, label]) => <button type="button" aria-pressed={draft.values.includes(value)} className={`profile-choice ${draft.values.includes(value) ? 'selected' : ''}`} key={value} onClick={() => setList('values', value)}>{label}</button>)}</div></div>
          <div className="field"><label htmlFor="dietary-needs">Dietary needs</label><input id="dietary-needs" className="input" value={draft.dietaryNeeds} maxLength={500} onChange={(e) => setDraft({ ...draft, dietaryNeeds: e.target.value })} placeholder="Allergies, dietary preferences…" /></div>
          <div className="field"><label htmlFor="product-preferences">Sizes, shades, or other preferences</label><input id="product-preferences" className="input" value={draft.productPreferences} maxLength={500} onChange={(e) => setDraft({ ...draft, productPreferences: e.target.value })} placeholder="Anything that helps us avoid the wrong fit" /></div>
        </div>}
      </div>
      <div className="profile-actions">{step > 0 ? <button className="btn btn-soft" onClick={() => setStep((value) => value - 1)}>Back</button> : <span /> }<span>{error && <span role="alert" className="profile-error">{error}</span>}{saved && <span className="profile-saved"><Check size={14} />Saved</span>}</span>{step < 3 ? <button className="btn btn-primary" onClick={() => { setStep((value) => value + 1); setTag(''); }}>{step === 1 ? 'Next: what are you open to?' : 'Continue'} <ChevronRight /></button> : <button className="btn btn-primary" onClick={persist} disabled={saveProfile.isPending}>{saveProfile.isPending ? 'Saving…' : saved ? 'Save changes' : 'Save my profile'}</button>}</div>
    </section>}
  </div>;
}

function SettingsPage() {
  const qc = useQueryClient();
  const settings = useGetFinanceSettings();
  const update = useUpdateFinanceSettings();
  const [rate, setRate] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (settings.data && rate === null) setRate(settings.data.taxReserveRate); }, [settings.data, rate]);
  const save = () => { if (rate === null) return; setError(''); update.mutate({ data: { taxReserveRate: rate } }, { onSuccess: () => { setSaved(true); qc.invalidateQueries({ queryKey: getGetFinanceSettingsQueryKey() }); qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }); }, onError: (e) => setError(messageOf(e)) }); };
  return <div className="content">
    <PageHeading eyebrow="Your preferences" title="Settings" subtitle="A few simple controls for how Margo keeps your personal picture." />
    {settings.isError && <ErrorPanel error={settings.error} retry={() => settings.refetch()} />}
     <section className="panel settings-section"><div className="eyebrow">Getting to know you</div><h2 className="panel-title">Your shopping and savings profile</h2><p className="panel-caption">Update what you’re saving for, what’s non-negotiable, and which swaps you’re open to.</p><Link className="btn btn-soft" href="/profile">Edit my profile <ChevronRight /></Link></section>
     <section className="panel settings-section"><div className="eyebrow">Planning</div><h2 className="panel-title">Tax set-aside estimate</h2><p className="panel-caption">Choose a personal rate for your planning estimate. It starts at 0% until you set one; there is no universal rate.</p>
      {settings.isLoading ? <div className="skeleton" style={{ marginTop: 18 }} /> : <div className="settings-row"><div style={{ flex: 1 }}><div className="settings-label">Personal estimate rate</div><div className="settings-description">Choose 0% to 60%. This is user-configured for planning and is not tax advice.</div><div className="rate-control"><input aria-label="Tax reserve rate" type="range" min="0" max="60" step="1" value={rate ?? settings.data?.taxReserveRate ?? 0} onChange={(e) => { setRate(Number(e.target.value)); setSaved(false); }} data-testid="input-settings-tax-rate" /><span className="rate-number">{rate ?? settings.data?.taxReserveRate ?? 0}%</span></div></div><button className="btn btn-primary" onClick={save} disabled={update.isPending || rate === null} data-testid="button-settings-save">{update.isPending ? 'Saving…' : saved ? <><Check />Saved</> : 'Save rate'}</button></div>}
      {error && <p style={{ color: '#a44', fontSize: 10 }}>{error}</p>}
      <div className="tax-factors">
        <h3>What can affect your tax bill?</h3>
        <p>There isn’t one set-aside rate that fits everyone. General factors include:</p>
        <ul>
          <li>Federal income tax and whether self-employment tax applies</li>
          <li>Your state and local tax rules</li>
          <li>Business expenses, deductions, credits, and other income</li>
          <li>Tax already withheld or paid through estimated payments</li>
        </ul>
        <p>Use this estimate as a planning aid, not tax advice. Check current IRS guidance or ask a qualified tax professional about your situation.</p>
      </div>
    </section>
     <section className="panel settings-section"><div className="eyebrow">Connections</div><h2 className="panel-title">Bank accounts</h2><p className="panel-caption">A sample bank view is available for preview.</p>
       <div className="settings-row"><div><div className="settings-label">Real bank linking</div><div className="settings-description">No real bank is linked. The sample accounts are fictional and are not part of your ledger or totals.</div><Link href="/accounts" className="text-link" style={{ display: 'inline-block', marginTop: 8 }}>Open sample accounts <ChevronRight size={12} style={{ verticalAlign: 'middle' }} /></Link></div><span className="connection-pill"><span style={{ width: 6, height: 6, background: '#9a8060', borderRadius: '50%', display: 'inline-block', marginRight: 6 }} />Demo only</span></div>
    </section>
    <ExtensionTokensPanel />
    <section className="panel settings-section"><div className="eyebrow">About your data</div><h2 className="panel-title">Only what you choose to add</h2><p className="panel-caption">Transactions, receipt totals, and product details in Margo come from your manual entries.</p><div className="notice" style={{ marginTop: 16 }}><ShieldCheck /><span>Receipt images are uploaded only when you choose a JPG, PNG, or PDF file. You can save receipt details without attaching a file.</span></div></section>
  </div>;
}

function ExtensionTokensPanel() {
  const qc = useQueryClient();
  const tokens = useGetExtensionTokens();
  const createToken = useCreateExtensionToken();
  const revokeToken = useRevokeExtensionToken();
  const [label, setLabel] = useState('My browser');
  const [newToken, setNewToken] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: getGetExtensionTokensQueryKey() });
  const create = () => {
    setError(''); setNotice('');
    createToken.mutate({ data: { label: label.trim() || 'My browser' } }, {
      onSuccess: (result) => { setNewToken(result.token); refresh(); },
      onError: (reason) => setError(messageOf(reason)),
    });
  };
  return <section className="panel settings-section">
    <div className="eyebrow">Shopping tools</div>
    <h2 className="panel-title">Browser extension</h2>
    <p className="panel-caption">Create a private token for product lookups. The token is shown once, expires after 90 days, and can be revoked here.</p>
    <div className="extension-token-create">
      <input className="input" value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} aria-label="Extension token label" />
      <button className="btn btn-primary" onClick={create} disabled={createToken.isPending || (tokens.data?.length ?? 0) >= 5}>{createToken.isPending ? 'Creating…' : 'Create token'}</button>
    </div>
    {error && <p className="profile-error" role="alert">{error}</p>}
    {newToken && <div className="extension-token-secret" role="status">
      <strong>Copy this token now. It won’t be shown again.</strong>
      <code>{newToken}</code>
      <button className="btn btn-soft" onClick={() => { if (!navigator.clipboard) { setError('Clipboard access is unavailable. Select and copy the token manually.'); return; } void navigator.clipboard.writeText(newToken).then(() => setNotice('Copied to clipboard.')).catch(() => setError('Could not copy. Select and copy the token manually.')); }}>Copy token</button>
      {notice && <span className="profile-saved">{notice}</span>}
    </div>}
    {tokens.isLoading ? <div className="skeleton" /> : tokens.isError ? <ErrorPanel error={tokens.error} retry={() => tokens.refetch()} /> : tokens.data?.length ? (
      <div className="extension-token-list">{tokens.data.map((token) => (
        <div className="settings-row" key={token.id}>
          <div>
            <div className="settings-label">{token.label}</div>
            <div className="settings-description">Expires {niceDate(token.expiresAt)}{token.lastUsedAt ? ` · Last used ${niceDate(token.lastUsedAt)}` : ' · Not used yet'}</div>
          </div>
          <button className="btn btn-soft" onClick={() => revokeToken.mutate({ tokenId: token.id }, { onSuccess: refresh, onError: (reason) => setError(messageOf(reason)) })} disabled={revokeToken.isPending}>Revoke</button>
        </div>
      ))}</div>
    ) : <p className="panel-caption" style={{ marginTop: 14 }}>No extension tokens created. You can keep using Margo without installing an extension.</p>}
  </section>;
}

function ProfilePage() {
  return <div className="content">
    <PageHeading eyebrow="Your account" title="Profile & plan settings" subtitle="Your plan details and shopping preferences can be updated here whenever life changes." />
    <PlanPage allowEdit />
    <ProfilePreferencesPage />
    <SettingsPage />
  </div>;
}

function AccountSetupPage() {
  return <OnboardingPage />;
}

const opportunities = [
  {
    name: 'Instawork',
    category: 'Flexible shifts',
    mark: 'I',
    tone: 'instawork',
    description: 'Browse hourly shifts across roles such as hospitality, events, and warehouse work. Available shifts and eligibility depend on your location and experience.',
    range: 'Pay varies by role, shift, and location; review each shift listing.',
    requirements: 'Apply and complete any screening or onboarding required for shifts in your area.',
    pros: 'Choose from available shifts that fit your schedule.',
    cons: 'Work and shift availability can change by location and date.',
    take: 'Worth exploring if short, in-person shifts fit your schedule and commute.',
    url: 'https://app.instawork.com/worker/signup',
  },
  {
    name: 'Instacart Shopper',
    category: 'Grocery shopping',
    mark: 'C',
    tone: 'instacart',
    description: 'Shop and deliver grocery orders through the shopper platform. You can review the sign-up requirements and how the work operates in your area.',
    range: 'Earnings vary by order, tips, and market; include your own costs when estimating take-home pay.',
    requirements: 'Age, work eligibility, and vehicle requirements depend on shopper role and location.',
    pros: 'Order-based work can offer flexibility around when you shop.',
    cons: 'Demand, driving, and vehicle costs can affect what you keep.',
    take: 'Compare expected order pay with travel time and expenses before signing up.',
    url: 'https://shoppers.instacart.com/',
  },
  {
    name: 'Sago',
    category: 'Paid user interviews',
    mark: 'S',
    tone: 'sago',
    description: 'Join Sago’s research panel to be considered for surveys, focus groups, and interviews about products and services.',
    range: 'Each study sets its own incentive; the amount and format vary.',
    requirements: 'Create a panel profile and qualify for individual studies. Screening does not guarantee selection.',
    pros: 'Some research can be done remotely and may fit around other plans.',
    cons: 'Invitations are not guaranteed, so this is not predictable income.',
    take: 'Treat it as occasional extra income, not money to count on each month.',
    url: 'https://sago.com/en/get-in-touch/join-our-panel',
  },
  {
    name: 'Lemonade',
    category: 'Pet insurance',
    mark: 'L',
    tone: 'lemonade',
    description: 'Explore pet insurance coverage options and request a quote for your pet.',
    range: 'Not an earning opportunity. Premiums are quote-specific and vary with coverage and pet details.',
    requirements: 'Review eligibility and policy terms for your pet and location before applying.',
    pros: 'A quote can help you compare pet-care costs and coverage options.',
    cons: 'Exclusions, waiting periods, deductibles, and reimbursement rules matter.',
    take: 'Compare the full policy with your current costs; a lower premium alone is not enough.',
    url: 'https://www.lemonade.com/pet',
  },
];

function EarnSavePage() {
  return <div className="content earn-save-content">
    <div className="earn-save-hero">
      <div className="eyebrow">A little more breathing room</div>
      <h1>Earn & save</h1>
      <p>Practical places to explore when you want to bring in extra income or compare a recurring cost. Take a look, then decide if it fits your life.</p>
      <div className="earn-save-caption"><ShieldCheck size={16} />Independent research first. Nothing here is a promise or endorsement.</div>
    </div>
    <div className="opportunities-list">
      {opportunities.map((opportunity, index) => <article className={`opportunity-card panel ${opportunity.tone}`} key={opportunity.name} data-testid={`card-opportunity-${opportunity.tone}`}>
        <div className="opportunity-index">0{index + 1}</div>
        <div className="opportunity-mark" aria-hidden="true">{opportunity.mark}</div>
        <div className="opportunity-copy">
          <div className="opportunity-category">{opportunity.category}</div>
          <h2>{opportunity.name}</h2>
          <p>{opportunity.description}</p>
          <div className="opportunity-details">
            <div><strong>{opportunity.category === 'Pet insurance' ? 'Cost' : 'Pay range'}</strong><span>{opportunity.range}</span></div>
            <div><strong>Requirements</strong><span>{opportunity.requirements}</span></div>
            <div><strong>Pros</strong><span>{opportunity.pros}</span></div>
            <div><strong>Cons</strong><span>{opportunity.cons}</span></div>
          </div>
          <div className="opportunity-caveat"><strong>My take:</strong> {opportunity.take}</div>
        </div>
        <a className="btn btn-soft opportunity-link" href={opportunity.url} target="_blank" rel="noopener noreferrer" data-testid={`link-official-${opportunity.tone}`}>Visit official site <ExternalLink size={14} /></a>
      </article>)}
    </div>
    <div className="earn-save-footer"><div className="earn-save-footer-mark"><Info size={17} /></div><p>Use your own judgment before sharing personal information, accepting work, or choosing insurance. Margo does not verify availability, compensation, or policy fit.</p></div>
  </div>;
}

function HomePlanRoute() {
  const plan = useGetBudgetPlan();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (plan.data && !plan.data.setupComplete) setLocation('/onboarding');
  }, [plan.data, setLocation]);
  if (plan.data && !plan.data.setupComplete) return <div className="content"><LoadingPanel rows={2} /></div>;
  return <PlanPage />;
}

function LoginScreen() {
  const { login } = useAuth();
  return <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--app-bg)' }}><section className="panel login-file" style={{ maxWidth: 430, width: '100%', padding: '38px 36px', textAlign: 'center' }}><div className="login-file-tab">YOUR PERSONAL MONEY SPACE</div><img className="margo-logo-login" src={`${import.meta.env.BASE_URL}margo-logo.png`} alt="Margo — xo, your money friend" /><div className="eyebrow">A little clarity, your way</div><h1 style={{ fontSize: 34 }}>Keep what you love. Spend less on it.</h1><p className="page-subtitle" style={{ marginBottom: 24 }}>Track your money, save the products you buy, and find lower-cost alternatives that fit your life.</p><button className="btn btn-primary" style={{ width: '100%', padding: 13 }} onClick={login} data-testid="button-login">Continue to Margo <ArrowRightLeft /></button><div className="notice" style={{ textAlign: 'left', marginTop: 18 }}><Info /><span>No bank connection required. Your entries are added by you, not imported.</span></div></section></main>;
}

function AuthenticatedApp() {
  const auth = useAuth();
  if (auth.isLoading) return <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--app-bg)' }}><div style={{ width: 280 }}><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div></main>;
  if (!auth.isAuthenticated) return <LoginScreen />;
  return <Shell><RoutedErrorBoundary><Switch>
    <Route path="/" component={HomePlanRoute} />
    <Route path="/transactions" component={TransactionsPage} />
    <Route path="/plan" component={HomePlanRoute} />
    <Route path="/accounts" component={AccountsPage} />
    <Route path="/receipts" component={ReceiptsPage} />
    <Route path="/swaps" component={SwapsPage} />
    <Route path="/earn-save" component={EarnSavePage} />
    <Route path="/profile" component={ProfilePage} />
    <Route path="/taxes" component={ProfilePage} />
    <Route path="/onboarding" component={AccountSetupPage} />
    <Route path="/settings" component={ProfilePage} />
    <Route component={NotFound} />
  </Switch></RoutedErrorBoundary></Shell>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AuthenticatedApp /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
