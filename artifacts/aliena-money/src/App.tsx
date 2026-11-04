import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAuth } from '@workspace/replit-auth-web';
import {
  getGetBudgetPlanQueryKey, getGetFinanceDashboardQueryKey, getGetFinanceSettingsQueryKey,
  getGetProductComparisonsQueryKey, getGetPurchaseHistoryQueryKey, getGetReceiptsQueryKey,
  getGetSwapProfileQueryKey, getGetTransactionsQueryKey, getGetProductAlternativesQueryKey,
  useCreateReceipt, useCreateTransaction, useDeleteReceipt, useDeleteTransaction,
  useDeleteMyData,
  useGetBudgetPlan, useGetFinanceDashboard, useGetFinanceSettings, useGetProductAlternatives,
  useGetProductComparisons, useGetPurchaseHistory, useGetReceipts, useGetSwapProfile,
  useGetTransactions, useRequestUploadUrl, useScanReceiptImage, useUpdateBudgetPlan, useUpdateFinanceSettings,
  useUpdateSwapProfile, useVoteOnProductAlternative,
} from '@workspace/api-client-react';
import type { BudgetPlanInput, ReceiptInput, ReceiptScanResult, SwapProfileInput, Transaction } from '@workspace/api-client-react';
import {
  ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Check, ChevronRight, CircleHelp, FileImage,
  HandCoins, Home, Leaf, LogOut, Plus, ReceiptText, ScanLine, ShieldCheck,
  ShoppingBag, Trash2, Upload, X,
} from 'lucide-react';
import { Route, Switch, Link, useLocation, Router as WouterRouter } from 'wouter';
import { usePlaidLink } from 'react-plaid-link';
import NotFound from '@/pages/not-found';

const client = new QueryClient();
const categories = ['Rent', 'Groceries', 'Dining out', 'Shopping', 'Beauty', 'Transportation', 'Subscriptions', 'Utilities'] as const;
const swapCategories = [['beauty', 'Beauty'], ['groceries', 'Groceries'], ['clothes', 'Clothing'], ['household', 'Household'], ['travel', 'Travel'], ['subscriptions', 'Subscriptions']] as const;
const nonNegotiables = ['My morning coffee', 'Cruelty-free products', 'Organic produce', 'Name-brand favorites', 'My weekend treats', 'Local shops'];
const blankProfile: SwapProfileInput = { savingFor: '', monthlySavingsGoal: 0, nonNegotiables: [], swapCategories: [], favoriteBrands: [], values: [], dietaryNeeds: '', productPreferences: '' };
const money = (value: number | string | null | undefined) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0));
const dateLabel = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};
const today = () => new Date().toISOString().slice(0, 10);
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.';
const disclosure = 'Listings link to each platform. Availability, pay, and requirements vary by location and role.';

function Header() {
  const [path] = useLocation();
  const { user } = useAuth();
  const [plusOpen, setPlusOpen] = useState(false);
  const first = user?.firstName?.[0] || user?.email?.[0] || 'M';
  const last = user?.lastName?.[0] || '';
  const tabs = [{ href: '/', label: 'Home', icon: Home }, { href: '/transactions', label: 'Spending', icon: ArrowRightLeft }, { href: '/swaps', label: 'Swaps', icon: Leaf }, { href: '/earn-save', label: 'Gigs', icon: HandCoins }];
  return <>
    <header className="top-nav">
      <Link href="/" className="brand-link"><img src={`${import.meta.env.BASE_URL}margo-logo.png`} alt="Margo, your money friend" /></Link>
      <nav className="desktop-tabs" aria-label="Main navigation">
        {tabs.slice(0, 2).map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`tab-link ${path === href ? 'active' : ''}`} aria-current={path === href ? 'page' : undefined}><Icon />{label}</Link>)}
        <div className="desktop-plus">
          <button className="desktop-plus-button" aria-label="Create or scan" aria-expanded={plusOpen} onClick={() => setPlusOpen((open) => !open)}><Plus /></button>
          {plusOpen && <div className="plus-menu desktop-plus-menu" role="menu">
            <Link href="/receipts?scan=receipt" onClick={() => setPlusOpen(false)}><ScanLine />Scan receipt</Link>
            <Link href="/receipts?scan=barcode" onClick={() => setPlusOpen(false)}><ShoppingBag />Scan barcode</Link>
            <Link href="/transactions?add=1" onClick={() => setPlusOpen(false)}><Plus />Add transaction</Link>
          </div>}
        </div>
        {tabs.slice(2).map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`tab-link ${path === href ? 'active' : ''}`} aria-current={path === href ? 'page' : undefined}><Icon />{label}</Link>)}
      </nav>
      <div className="nav-actions"><Link className="avatar" href="/profile" aria-label="Open settings" data-testid="link-profile-avatar">{first}{last}</Link></div>
    </header>
    <nav className="mobile-tabs" aria-label="Main navigation">
      {tabs.slice(0, 2).map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`tab-link ${path === href ? 'active' : ''}`}><Icon />{label}</Link>)}
      <div className="plus-wrap">
        <button className="center-plus" aria-label="Create or scan" aria-expanded={plusOpen} onClick={() => setPlusOpen((open) => !open)} data-testid="button-open-create-menu">{plusOpen ? <X /> : <Plus />}</button>
        {plusOpen && <div className="plus-menu" role="menu">
          <div className="plus-menu-heading"><strong>What are we adding?</strong><button type="button" onClick={() => setPlusOpen(false)} aria-label="Close create menu"><X /></button></div>
          <Link href="/receipts?scan=receipt" onClick={() => setPlusOpen(false)}><span className="create-menu-icon burgundy"><ReceiptText /></span><span><strong>Scan a receipt</strong><small>I’ll read it and look for cheaper swaps</small></span></Link>
          <Link href="/receipts?scan=barcode" onClick={() => setPlusOpen(false)}><span className="create-menu-icon blue"><ScanLine /></span><span><strong>Scan a barcode</strong><small>Check one product before you buy</small></span></Link>
          <Link href="/transactions?add=1" onClick={() => setPlusOpen(false)}><span className="create-menu-icon cream"><ShoppingBag /></span><span><strong>Add a purchase</strong><small>Cash, Venmo, or anything I missed</small></span></Link>
          <Link href="/transactions?add=1&kind=income" onClick={() => setPlusOpen(false)}><span className="create-menu-icon cream"><HandCoins /></span><span><strong>Log gig income</strong><small>Keep your income in one place</small></span></Link>
          <button className="create-menu-cancel" onClick={() => setPlusOpen(false)}>Never mind</button>
        </div>}
      </div>
      {tabs.slice(2).map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`tab-link ${path === href ? 'active' : ''}`}><Icon />{label}</Link>)}
    </nav>
  </>;
}

function Shell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const fullscreen = path === '/onboarding';
  return <div className={`app-frame ${fullscreen ? 'full-flow' : ''}`}>
    {!fullscreen && <Header />}
    <main className="workspace">{children}</main>
  </div>;
}

function PageTitle({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-title"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}
function Skeleton({ lines = 3 }: { lines?: number }) { return <div className="skeleton-stack" aria-label="Loading">{Array.from({ length: lines }, (_, i) => <i key={i} />)}</div>; }
function ErrorState({ error, retry }: { error: unknown; retry: () => void }) { return <div className="error-state" role="alert"><span>{messageOf(error)}</span><button className="button secondary" onClick={retry}>Try again</button></div>; }
function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) { return <div className="empty-state"><span className="empty-icon"><CircleHelp /></span><h2>{title}</h2><p>{body}</p>{action}</div>; }

function HomePage() {
  const { user } = useAuth();
  const dashboard = useGetFinanceDashboard();
  const plan = useGetBudgetPlan();
  const transactions = useGetTransactions();
  const comparisons = useGetProductComparisons();
  const firstName = user?.firstName?.trim();
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 18 ? 'Good afternoon' : 'Good evening';
  const hasRealActivity = Boolean(transactions.data?.length);
  const spent = Number(dashboard.data?.monthlySpending || 0);
  const cap = Number(plan.data?.monthlySpendingTarget || 0);
  const left = Math.max(0, cap - spent);
  if (dashboard.isLoading || plan.isLoading || transactions.isLoading) return <div className="page"><PageTitle title={`${greeting}${firstName ? `, ${firstName}` : ''}`} subtitle="A little more room for the things you love." /><Skeleton lines={6} /></div>;
  if (dashboard.isError) return <div className="page"><PageTitle title={`${greeting}${firstName ? `, ${firstName}` : ''}`} subtitle="A little more room for the things you love." /><ErrorState error={dashboard.error} retry={() => dashboard.refetch()} /></div>;
  if (!hasRealActivity && !comparisons.data?.length) return <div className="page">
    <PageTitle title={`${greeting}${firstName ? `, ${firstName}` : ''}`} subtitle="A little more room for the things you love." />
    <section className="welcome-card">
      <div className="welcome-art"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="welcome-spark"><Leaf /></span></div>
      <div><span className="note-label">A good place to start</span><h2>Keep your life. Spend a little less.</h2><p>Snap a receipt and I’ll help you spot lower-cost versions of the things you already love.</p><Link className="button primary" href="/receipts?scan=receipt"><ScanLine />Scan your first receipt</Link></div>
    </section>
  </div>;
  const progress = cap > 0 ? Math.min(100, spent / cap * 100) : 0;
  return <div className="page">
    <PageTitle title={`${greeting}${firstName ? `, ${firstName}` : ''}`} subtitle="Here’s where things stand this month." />
    <section className="home-summary">
      <div className="summary-top"><div><span className="summary-kicker">{cap ? 'Left to spend this month' : 'Spent this month'}</span><div className="summary-amount">{money(cap ? left : spent)}</div></div><div className="summary-budget"><span>{cap ? 'Monthly spending plan' : 'Monthly budget'}</span><strong>{cap ? money(cap) : 'Not set yet'}</strong></div></div>
      <div className="summary-track"><span style={{ width: `${progress}%` }} /></div>
      <div className="summary-bottom"><span>{cap ? `${money(spent)} spent so far` : 'Set a monthly plan whenever you’re ready'}</span><span>{cap ? 'Spent so far' : 'Saved with swaps'} <b>{cap ? money(spent) : money(dashboard.data?.annualSavings)}</b></span></div>
    </section>
    <div className="home-metrics">
      <div><span>Saved with swaps</span><strong>{money(dashboard.data?.annualSavings)}</strong><small>Based on your saved purchases</small></div>
      <div><span>Tax set-aside</span><strong>{money(dashboard.data?.taxSetAside)}</strong><small>Personal estimate</small></div>
      <div><span>Savings goal</span><strong>{plan.data?.annualSavingsGoal ? `${money(plan.data.annualSavingsGoal / 12)} / mo` : 'Not set'}</strong><small>{plan.data?.annualSavingsGoal ? 'Your monthly target' : 'Choose what matters to you'}</small></div>
    </div>
    {comparisons.data?.length ? <Link href="/swaps" className="home-swap-callout"><span className="seal-mark">M</span><span><strong>Your money has a little more room.</strong><small>{comparisons.data.length} saved {comparisons.data.length === 1 ? 'swap' : 'swaps'} to explore</small></span><ChevronRight /></Link> : null}
    <div className="home-columns">
      <section className="surface budget-surface"><div className="section-heading"><div><h2>Your monthly categories</h2><p>A flexible guide, never a rule.</p></div><Link href="/settings" className="quiet-link">Edit</Link></div>
        {plan.data?.categories?.length ? <BudgetList categories={plan.data.categories} compact /> : <EmptyState title="Your budget, your way" body="Add a few monthly categories when you’re ready." action={<Link className="button secondary" href="/settings">Set budgets</Link>} />}
      </section>
      <div className="home-aside">
        <section className="tip-card"><span className="tip-label">A small thought</span><h2>You don’t have to give up the good stuff.</h2><p>Swaps are about finding a better price for the things already in your routine.</p><Link href="/swaps" className="quiet-link">See your swaps <ChevronRight /></Link></section>
        <section className="mini-card"><span>Saving for</span><strong>{plan.data?.annualSavingsGoal ? money(plan.data.annualSavingsGoal / 12) : 'Your next goal'}</strong><small>{plan.data?.annualSavingsGoal ? 'each month' : 'Add a goal in settings'}</small></section>
        <Link href="/settings" className="mini-card mini-card-tax"><span>Tax set-aside</span><strong>{money(dashboard.data?.taxSetAside)}</strong><small>Personal estimate · edit settings</small></Link>
      </div>
    </div>
    {dashboard.data?.recentTransactions?.length ? <section className="surface recent-surface"><div className="section-heading"><div><h2>Latest spending</h2><p>Your recent activity.</p></div><Link href="/transactions" className="quiet-link">See all</Link></div><TransactionRows items={dashboard.data.recentTransactions.slice(0, 4)} /></section> : null}
  </div>;
}

function BudgetList({ categories: items, compact = false }: { categories: Array<{ category: string; monthlyTarget: number; spentThisMonth: number }>; compact?: boolean }) {
  return <div className={`budget-list ${compact ? 'compact' : ''}`}>{items.map((item) => {
    const target = Number(item.monthlyTarget || 0);
    const amount = Number(item.spentThisMonth || 0);
    const pct = target > 0 ? Math.min(100, amount / target * 100) : 0;
    return <div className="budget-row" key={item.category}><div className="budget-row-top"><strong>{item.category}</strong><span>{money(amount)} <small>of {money(target)}</small></span></div><div className="budget-meter"><i style={{ width: `${pct}%` }} /></div></div>;
  })}</div>;
}

function TransactionRows({ items, onDelete }: { items: Transaction[]; onDelete?: (id: string) => void }) {
  return <div className="transaction-rows">{items.map((item) => <div className="activity-row" key={item.id}><span className={`activity-icon ${item.type}`}>{item.type === 'income' ? <ArrowDownLeft /> : <ArrowUpRight />}</span><div className="activity-copy"><strong>{item.label}</strong><small>{item.category} · {dateLabel(item.date)}</small></div><strong className={`activity-amount ${item.type}`}>{item.type === 'income' ? '+' : '−'}{money(item.amount)}</strong>{onDelete && <button className="text-icon" onClick={() => onDelete(item.id)} aria-label={`Delete ${item.label}`}><Trash2 /></button>}</div>)}</div>;
}

function SpendingPage() {
  const qc = useQueryClient();
  const query = useGetTransactions();
  const create = useCreateTransaction();
  const remove = useDeleteTransaction();
  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [formOpen, setFormOpen] = useState(() => new URLSearchParams(window.location.search).has('add'));
  const [kind, setKind] = useState<'expense' | 'income'>(() => new URLSearchParams(window.location.search).get('kind') === 'income' ? 'income' : 'expense');
  const [error, setError] = useState('');
  const list = useMemo(() => (query.data || []).filter((item) => filter === 'all' || item.type === filter), [query.data, filter]);
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
  return <div className="page">
    <PageTitle title="Spending" subtitle={new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date())} action={<button className="button primary" onClick={() => setFormOpen((open) => !open)}><Plus />{formOpen ? 'Close' : 'Add transaction'}</button>} />
    {error && <div className="error-state">{error}<button onClick={() => setError('')} aria-label="Dismiss"><X /></button></div>}
    {formOpen && <form className="surface entry-form" onSubmit={submit}><div className="form-heading"><h2>Add an entry</h2><p>Just the details you want to remember.</p></div>
      <div className="form-grid">
        <label>Type<select className="field-input" value={kind} onChange={(event) => setKind(event.target.value as 'expense' | 'income')}><option value="expense">Spending</option><option value="income">Income</option></select></label>
        <label>Date<input className="field-input" name="date" type="date" defaultValue={today()} required /></label>
        <label>What was it?<input className="field-input" name="label" placeholder="Weekly groceries" required maxLength={120} /></label>
        <label>Amount<input className="field-input" name="amount" type="number" min=".01" step=".01" placeholder="0.00" required /></label>
        <label>Category<select className="field-input" name="category" required><option value="">Choose one</option>{(kind === 'expense' ? categories : ['Paycheck', 'Freelance', 'Interest', 'Gift', 'Other']).map((category) => <option key={category}>{category}</option>)}</select></label>
        <label>Note <span className="optional">(optional)</span><input className="field-input" name="source" placeholder="A note for later" /></label>
      </div>
      {kind === 'income' && <label className="check-line"><input type="checkbox" name="taxable" defaultChecked />Include in my tax estimate</label>}
      <div className="form-footer"><button className="button secondary" type="button" onClick={() => setFormOpen(false)}>Cancel</button><button className="button primary" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Save entry'}</button></div>
    </form>}
    <section className="spending-totals">
      {(['expense', 'income'] as const).map((type) => {
        const total = (query.data || []).filter((item) => item.type === type && item.date.slice(0, 7) === today().slice(0, 7)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
        return <div className={type === 'expense' ? 'expense-total' : 'income-total'} key={type}><span>{type === 'expense' ? 'Money out' : 'Money in'}</span><strong>{money(total)}</strong></div>;
      })}
    </section>
    <section className="surface spending-surface"><div className="section-heading"><div><h2>Your activity</h2><p>Only entries saved to your private ledger.</p></div><div className="filter-row">{(['all', 'expense', 'income'] as const).map((value) => <button key={value} className={`filter-button ${filter === value ? 'selected' : ''}`} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'expense' ? 'Money out' : 'Money in'}</button>)}</div></div>
      {query.isLoading ? <Skeleton /> : query.isError ? <ErrorState error={query.error} retry={() => query.refetch()} /> : list.length ? <TransactionRows items={list} onDelete={deleteOne} /> : <EmptyState title="Nothing here yet" body="Add an entry when you want to keep track." action={<button className="button primary" onClick={() => setFormOpen(true)}><Plus />Add transaction</button>} />}
    </section>
  </div>;
}

function ReceiptPage() {
  const qc = useQueryClient();
  const query = useGetReceipts();
  const comparisons = useGetProductComparisons();
  const create = useCreateReceipt();
  const remove = useDeleteReceipt();
  const uploadUrl = useRequestUploadUrl();
  const scanImage = useScanReceiptImage();
  const [file, setFile] = useState<File | null>(null);
  const [scanResult, setScanResult] = useState<ReceiptScanResult | null>(null);
  const [objectPath, setObjectPath] = useState<string | null>(null);
  const [fixItems, setFixItems] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [cameraMessage, setCameraMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const barcodeMode = new URLSearchParams(window.location.search).get('scan') === 'barcode';
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    if (!file.type.startsWith('image/')) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!cameraActive) return;
    type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
    type DetectorConstructor = new (options?: { formats: string[] }) => Detector;
    const DetectorApi = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    let stream: MediaStream | undefined;
    let frame = 0;
    let stopped = false;
    if (!DetectorApi) {
      setCameraMessage('Barcode scanning is not supported in this browser. You can still save a receipt photo.');
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
              setBarcode(result.rawValue);
              setCameraMessage('Barcode captured. Product matching is not available for this code yet.');
              setCameraActive(false);
              return;
            }
          } catch { /* Continue with the next camera frame. */ }
          frame = requestAnimationFrame(scan);
        };
        frame = requestAnimationFrame(scan);
      } catch (reason) {
        setCameraMessage(messageOf(reason));
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
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: getGetReceiptsQueryKey() }), qc.invalidateQueries({ queryKey: getGetProductComparisonsQueryKey() }), qc.invalidateQueries({ queryKey: getGetPurchaseHistoryQueryKey() }), qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() })]);
  const choose = (selected?: File) => {
    setError(''); setNotice('');
    if (!selected) return;
    if (!['image/jpeg', 'image/png'].includes(selected.type)) { setError('Choose a JPG or PNG photo.'); return; }
    if (selected.size > 10 * 1024 * 1024) { setError('Choose a file under 10 MB.'); return; }
    setFile(selected); setScanResult(null); setObjectPath(null); setFixItems(false);
  };
  const saveReceipt = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setNotice('');
    if (!file) { setError('Choose or take a receipt photo first.'); return; }
    try {
      if (!scanResult || !objectPath) {
        const requested = await uploadUrl.mutateAsync({ data: { name: file.name, size: file.size, contentType: file.type } });
        const uploaded = await fetch(requested.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!uploaded.ok) throw new Error('The receipt photo did not upload. Try again.');
        const result = await scanImage.mutateAsync({ data: { objectPath: requested.objectPath } });
        setObjectPath(requested.objectPath); setScanResult(result);
        if (!result.merchant || !result.items.length) setNotice('I couldn’t read every detail. Use “Fix an item” to correct anything I missed.');
        return;
      }
      const form = new FormData(event.currentTarget);
      const merchant = String(form.get('merchant') || '').trim();
      const purchasedAt = String(form.get('purchasedAt') || '');
      const total = Number(form.get('total'));
      if (!merchant || !purchasedAt || !Number.isFinite(total) || total < 0) { setError('Check the store, date, and total.'); return; }
      const input: ReceiptInput = {
        merchant, purchasedAt, total, objectPath,
        items: scanResult.items.filter((item) => item.productName.trim() && item.unitPrice > 0),
      };
      await create.mutateAsync({ data: input });
      await refresh();
      setFile(null); setScanResult(null); setObjectPath(null); if (fileInput.current) fileInput.current.value = '';
      setNotice('Receipt saved. Your swaps are ready to review.');
    } catch (reason) { setError(messageOf(reason)); }
  };
  const deleteOne = (id: string) => {
    if (!window.confirm('Delete this receipt?')) return;
    remove.mutate({ id }, { onSuccess: () => { void refresh(); }, onError: (reason) => setError(messageOf(reason)) });
  };
  return <div className="page">
    <PageTitle title="Receipts" subtitle="Keep a photo and the details you want to remember." />
    <section className="scan-card surface">
      <div className="scan-icon"><ScanLine /></div><h2>{scanResult ? 'Check what I found' : 'Start with a photo'}</h2><p>{scanResult ? 'Make any quick fixes, then save your receipt.' : 'Snap a photo and I’ll read the store, date, and items.'}</p>
      {barcodeMode && <div className="barcode-tool"><strong>Scan a product barcode</strong><p>Hold the barcode in the camera frame.</p>{cameraActive ? <><video ref={videoRef} muted playsInline aria-label="Barcode scanner camera" /><button className="button secondary" type="button" onClick={() => setCameraActive(false)}>Stop camera</button></> : <button className="button secondary" type="button" onClick={() => { setCameraMessage(''); setBarcode(''); setCameraActive(true); }}>Open camera</button>}{barcode && <code>{barcode}</code>}{cameraMessage && <small role="status">{cameraMessage}</small>}</div>}
      <form onSubmit={saveReceipt}>
        <label className="photo-picker" htmlFor="receipt-photo"><input ref={fileInput} id="receipt-photo" type="file" accept="image/jpeg,image/png" capture="environment" onChange={(event) => choose(event.target.files?.[0])} /><span className="photo-picker-icon">{preview ? <FileImage /> : <Upload />}</span><strong>{file?.name || 'Take a photo or upload'}</strong><small>JPG or PNG · up to 10 MB</small>{preview && <img src={preview} alt="Receipt preview" />}</label>
        {scanResult && <><div className="scan-meta"><label>Store<input className="field-input" name="merchant" defaultValue={scanResult.merchant} placeholder="Store name" required maxLength={120} /></label><label>Date<input className="field-input" name="purchasedAt" type="date" defaultValue={scanResult.purchasedAt || ''} required /></label><label>Total<input className="field-input" name="total" type="number" min="0" step=".01" defaultValue={scanResult.total || ''} required /></label></div><div className="receipt-review-list">{scanResult.items.map((item, index) => <div className="receipt-review-item" key={`${item.productName}-${index}`}><span>{item.productName || 'Unclear item'}</span><strong>{money(item.unitPrice)}</strong>{fixItems && <><input aria-label={`Fix item ${index + 1}`} className="field-input" defaultValue={item.productName} onChange={(event) => setScanResult((current) => current && ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, productName: event.target.value } : row) }))} /><input aria-label={`Fix price ${index + 1}`} className="field-input" type="number" min="0" step=".01" value={item.unitPrice} onChange={(event) => setScanResult((current) => current && ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, unitPrice: Number(event.target.value) || 0 } : row) }))} /></>}</div>)}</div></>}
        {error && <div className="inline-error" role="alert">{error}</div>}{notice && <div className="inline-success" role="status">{notice}</div>}
        <div className="scan-actions"><button className="button primary" disabled={create.isPending || uploadUrl.isPending || scanImage.isPending}>{create.isPending || uploadUrl.isPending || scanImage.isPending ? 'Reading…' : scanResult ? 'Looks right · save receipt' : 'Read receipt'}</button>{scanResult && <button className="small-link fix-item-link" type="button" onClick={() => setFixItems((value) => !value)}>Fix an item</button>}</div>
      </form>
    </section>
    <section className="surface saved-receipts"><div className="section-heading"><div><h2>Your saved receipts</h2><p>Photos and comparisons you’ve saved.</p></div><span className="count-pill">{query.data?.length || 0}</span></div>
      {query.isLoading ? <Skeleton /> : query.isError ? <ErrorState error={query.error} retry={() => query.refetch()} /> : query.data?.length ? query.data.map((receipt) => <article className="receipt-row" key={receipt.id}><button className="receipt-details-toggle" onClick={() => setExpanded(expanded === receipt.id ? null : receipt.id)}><span className="receipt-thumb">{receipt.objectPath ? <FileImage /> : <ReceiptText />}</span><span className="receipt-info"><strong>{receipt.merchant}</strong><small>{dateLabel(receipt.purchasedAt)} · {receipt.items.length} items</small></span><strong className="receipt-price">{money(receipt.total)}</strong><ChevronRight className={expanded === receipt.id ? 'turned' : ''} /></button>{expanded === receipt.id && <div className="receipt-expanded"><div>{receipt.items.length ? receipt.items.map((item, index) => <p key={`${item.productName}-${index}`}>{item.productName} <span>{money(item.unitPrice)}</span></p>) : <p>Product details haven’t been added to this receipt.</p>}</div><button className="small-link" onClick={() => deleteOne(receipt.id)}>Delete receipt</button></div>}</article>) : <EmptyState title="Your receipts will live here" body="Saved photos and product comparisons stay together." />}
    </section>
    {comparisons.data?.length ? <section className="surface saved-receipts"><div className="section-heading"><div><h2>Receipt comparisons</h2><p>Real alternatives from your saved purchases.</p></div></div>{comparisons.data.map((item, index) => <div className="comparison-line" key={`${item.productName}-${index}`}><div><small>You bought</small><strong>{item.productName}</strong><span>{money(item.unitPrice)}</span></div><ArrowRightLeft /><div><small>Try instead</small><strong>{item.alternativeName}</strong><span>{money(item.alternativePrice)}</span></div><b>{money(item.annualSavings)} saved / year</b></div>)}</section> : null}
  </div>;
}

function SwapVoteCard({ productId, name, brand, category }: { productId: string; name: string; brand: string; category: string }) {
  const qc = useQueryClient();
  const query = useGetProductAlternatives(productId, { query: { queryKey: getGetProductAlternativesQueryKey(productId), enabled: Boolean(productId) } });
  const vote = useVoteOnProductAlternative();
  return <div className="alternative-list">{query.isLoading ? <Skeleton lines={2} /> : query.isError ? <ErrorState error={query.error} retry={() => query.refetch()} /> : query.data?.map((item) => <div className="alternative-card" key={item.id}><div><small>{category}</small><strong>{item.name}</strong><span>{item.brand || 'A lower-cost option'} · {item.savingsScore} match</span></div><div className="vote-actions"><button disabled={vote.isPending} onClick={() => vote.mutate({ alternativeId: item.id, data: { vote: 1 } }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetProductAlternativesQueryKey(productId) }); void qc.invalidateQueries({ queryKey: getGetProductComparisonsQueryKey() }); } })} aria-label={`Like ${item.name}`}><Check /></button><button disabled={vote.isPending} onClick={() => vote.mutate({ alternativeId: item.id, data: { vote: -1 } }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetProductAlternativesQueryKey(productId) }); void qc.invalidateQueries({ queryKey: getGetProductComparisonsQueryKey() }); } })} aria-label={`Not for me: ${item.name}`}><X /></button></div></div>)}</div>;
}

function SwapsPage() {
  const profile = useGetSwapProfile();
  const history = useGetPurchaseHistory();
  const comparisons = useGetProductComparisons();
  const dashboard = useGetFinanceDashboard();
  return <div className="page">
    <PageTitle title="Swaps" subtitle="Cheaper finds for the things you already buy." />
    <section className="swap-banner"><div><span>Potential yearly savings</span><strong>{money(dashboard.data?.annualSavings)}</strong></div><Link className="button light" href="/receipts?scan=receipt"><ScanLine />Scan a receipt</Link></section>
    {comparisons.isLoading || history.isLoading ? <Skeleton lines={5} /> : comparisons.isError ? <ErrorState error={comparisons.error} retry={() => comparisons.refetch()} /> : comparisons.data?.length ? <section className="surface comparison-surface"><div className="section-heading"><div><h2>Your side-by-side swaps</h2><p>Keep the one you love, or try the alternative.</p></div></div>{comparisons.data.map((item, i) => <div className="comparison-line" key={`${item.productName}-${i}`}><div><small>{item.category} · Your pick</small><strong>{item.productName}</strong><span>{money(item.unitPrice)} each</span></div><ArrowRightLeft /><div><small>Possible swap</small><strong>{item.alternativeName}</strong><span>{money(item.alternativePrice)} each</span></div><b>{money(item.annualSavings)} / year</b></div>)}</section> : <section className="surface"><EmptyState title={profile.data?.swapCategories.length ? 'Your first swap is one receipt away' : 'What are you open to swapping?'} body={profile.data?.swapCategories.length ? 'Save a receipt and we’ll only show alternatives when product details are available.' : 'Pick the categories that could use a lower price. Your favorites stay yours.'} action={<Link className="button primary" href={profile.data?.swapCategories.length ? '/receipts?scan=receipt' : '/profile'}>{profile.data?.swapCategories.length ? 'Scan a receipt' : 'Set my preferences'}</Link>} /></section>}
    {history.data?.length ? <section className="surface history-surface"><div className="section-heading"><div><h2>Products you’ve bought</h2><p>Alternatives are based on saved receipt details.</p></div></div>{history.data.map((item) => <div className="history-item" key={item.id}><div><strong>{item.productName}</strong><small>{item.brand} · {item.category} · {money(item.unitPrice)}</small></div>{item.productId ? <SwapVoteCard productId={item.productId} name={item.productName} brand={item.brand} category={item.category} /> : null}</div>)}</section> : null}
    <p className="legal-line">Prices and availability can change. Savings are estimates based on your saved purchase details.</p>
  </div>;
}

const gigs = [
  { title: 'Instawork', kind: 'Flexible shifts', summary: 'Pick up local shifts in hospitality, events, and more.', url: 'https://app.instawork.com/worker/signup', mark: 'I' },
  { title: 'Qwick', kind: 'Hospitality shifts', summary: 'Find hospitality work that fits your schedule and location.', url: 'https://www.qwick.com/', mark: 'Q' },
  { title: 'Instacart Shopper', kind: 'Shop and deliver', summary: 'Shop grocery orders. Earnings and availability vary by market.', url: 'https://shoppers.instacart.com/', mark: 'C' },
];
function GigsPage() {
  return <div className="page"><PageTitle title="Gigs" subtitle="A few ways to bring in a little extra." />
    <div className="gig-list">{gigs.map((gig, index) => <article className="gig-card surface" key={gig.title}><span className="gig-number">0{index + 1}</span><span className={`gig-mark mark-${index}`}>{gig.mark}</span><div className="gig-copy"><small>{gig.kind}</small><h2>{gig.title}</h2><p>{gig.summary}</p></div><a className="button secondary" href={gig.url} target="_blank" rel="noreferrer">Visit site <ChevronRight /></a></article>)}</div>
    <p className="legal-line gig-disclosure">{disclosure}</p>
  </div>;
}

function BankConnect() {
  const qc = useQueryClient();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState('');
  const [message, setMessage] = useState('');
  const banks = useQuery({
    queryKey: ['plaid-items'],
    queryFn: async () => {
      const response = await fetch('/api/plaid/items', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load connected banks.');
      return response.json() as Promise<Array<{ id: string; institutionName: string | null; lastSyncAt: string | null }>>;
    },
  });
  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess: async (publicToken, metadata) => {
    setBusy(true); setMessage('');
    try {
      const exchange = await fetch('/api/plaid/exchange', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicToken, institutionId: metadata.institution?.institution_id, institutionName: metadata.institution?.name }) });
      const linked = await exchange.json(); if (!exchange.ok || !linked.itemId) throw new Error(linked.error || 'Could not connect that bank.');
      const synced = await fetch('/api/plaid/sync', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: linked.itemId }) });
      if (!synced.ok) throw new Error('Bank connected, but activity could not be refreshed.');
      await Promise.all([qc.invalidateQueries({ queryKey: ['plaid-items'] }), qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() }), qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }), qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() })]);
      setMessage('Your bank is connected.');
    } catch (error) { setMessage(messageOf(error)); } finally { setBusy(false); setLinkToken(null); }
  }, onExit: () => { setBusy(false); setLinkToken(null); } });
  useEffect(() => { if (linkToken && ready) open(); }, [linkToken, ready, open]);
  const connect = async () => {
    setBusy(true); setMessage('');
    try { const response = await fetch('/api/plaid/link-token', { method: 'POST', credentials: 'include' }); const result = await response.json(); if (!response.ok || !result.linkToken) throw new Error(result.error || 'Could not start a bank connection.'); setLinkToken(result.linkToken); }
    catch (error) { setMessage(messageOf(error)); setBusy(false); }
  };
  const sync = async (id: string) => {
    setSyncing(id); setMessage('');
    try {
      const response = await fetch('/api/plaid/sync', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not refresh bank activity.');
      await Promise.all([banks.refetch(), qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() }), qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }), qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() })]);
      setMessage('Your spending activity is up to date.');
    } catch (error) { setMessage(messageOf(error)); } finally { setSyncing(''); }
  };
  const disconnect = async (id: string) => {
    if (!window.confirm('Disconnect this bank? Saved spending will stay in Margo.')) return;
    try {
      const response = await fetch(`/api/plaid/items/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error('Could not disconnect this bank.');
      await banks.refetch(); setMessage('Bank disconnected. Saved spending stays in Margo.');
    } catch (error) { setMessage(messageOf(error)); }
  };
  return <div className="bank-settings">
    <div className="bank-row"><div><strong>Connect a bank</strong><p>Bring your recent activity into your spending picture.</p>{message && <small role="status">{message}</small>}</div><button className="button secondary" onClick={() => void connect()} disabled={busy || Boolean(linkToken && !ready)}>{busy ? 'Connecting…' : 'Connect bank'}</button></div>
    {banks.isLoading ? <Skeleton lines={1} /> : banks.isError ? <ErrorState error={banks.error} retry={() => banks.refetch()} /> : banks.data?.map((bank) => <div className="linked-bank" key={bank.id}><span className="bank-status-dot" /><div><strong>{bank.institutionName || 'Connected bank'}</strong><small>{bank.lastSyncAt ? `Last updated ${dateLabel(bank.lastSyncAt)}` : 'Connected, not updated yet'}</small></div><button className="small-link" disabled={syncing === bank.id} onClick={() => void sync(bank.id)}>{syncing === bank.id ? 'Updating…' : 'Refresh'}</button><button className="small-link" onClick={() => void disconnect(bank.id)}>Disconnect</button></div>)}
  </div>;
}

function SettingsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
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
  const { logout } = useAuth();
  const [rate, setRate] = useState<number | null>(null);
  const [goal, setGoal] = useState('');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [savingFor, setSavingFor] = useState('');
  const [profileDraft, setProfileDraft] = useState<SwapProfileInput>(blankProfile);
  const [draft, setDraft] = useState<Array<{ category: string; monthlyTarget: number }>>([]);
  const [addCategory, setAddCategory] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const initializedFor = useRef('');
  useEffect(() => {
    if (settings.data && rate === null) setRate(settings.data.taxReserveRate);
  }, [settings.data, rate]);
  useEffect(() => {
    if (!plan.data) return;
    setGoal(String(plan.data.annualSavingsGoal / 12 || 0));
    setMonthlyIncome(String(plan.data.annualIncome / 12 || 0));
    setMonthlyRent(String(plan.data.monthlyRent || 0));
    setDraft(plan.data.categories.map(({ category, monthlyTarget }) => ({ category, monthlyTarget: Number(monthlyTarget) || 0 })));
  }, [plan.data]);
  useEffect(() => {
    if (profileQuery.data && initializedFor.current !== 'profile') {
      initializedFor.current = 'profile'; setProfileDraft(profileQuery.data); setSavingFor(profileQuery.data.savingFor); setGoal((current) => current || String(profileQuery.data.monthlySavingsGoal));
    }
  }, [profileQuery.data]);
  const toggleSettingChoice = (key: 'nonNegotiables' | 'swapCategories', value: string) => {
    setProfileDraft((current) => {
      const values = current[key] as string[];
      return { ...current, [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] };
    });
  };
  const saveBudget = async () => {
    if (!plan.data) return;
    setError(''); setMessage('');
    const payload: BudgetPlanInput = { annualIncome: plan.data.annualIncome, annualSavingsGoal: Math.max(0, Number(goal) || 0) * 12, monthlyRent: plan.data.monthlyRent, priorityCategories: [], categoryBudgets: draft.map((item) => ({ category: item.category as BudgetPlanInput['categoryBudgets'][number]['category'], monthlyTarget: Math.max(0, Number(item.monthlyTarget) || 0) })) };
    try { await updatePlan.mutateAsync({ data: payload }); await Promise.all([qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() }), qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() })]); setMessage('Your monthly budgets are saved.'); }
    catch (reason) { setError(messageOf(reason)); }
  };
  const savePreferences = async () => {
    if (!profileQuery.data) return;
    try {
      await saveProfile.mutateAsync({ data: { ...profileDraft, savingFor: savingFor.trim(), monthlySavingsGoal: Math.max(0, Number(goal) || 0) } });
      if (plan.data) await updatePlan.mutateAsync({ data: { annualIncome: Math.max(0, Number(monthlyIncome) || 0) * 12, annualSavingsGoal: Math.max(0, Number(goal) || 0) * 12, monthlyRent: Math.max(0, Number(monthlyRent) || 0), priorityCategories: [], categoryBudgets: draft.map((item) => ({ category: item.category as BudgetPlanInput['categoryBudgets'][number]['category'], monthlyTarget: Number(item.monthlyTarget) || 0 })) } });
      await Promise.all([qc.invalidateQueries({ queryKey: getGetSwapProfileQueryKey() }), qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() }), qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() })]); setMessage('Your preferences are saved.');
    } catch (reason) { setError(messageOf(reason)); }
  };
  const saveTax = () => {
    if (rate === null) return;
    updateRate.mutate({ data: { taxReserveRate: rate } }, { onSuccess: () => { setMessage('Tax estimate saved.'); void qc.invalidateQueries({ queryKey: getGetFinanceSettingsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() }); }, onError: (reason) => setError(messageOf(reason)) });
  };
  const addBudget = () => {
    if (!addCategory || draft.some((item) => item.category === addCategory)) return;
    setDraft((items) => [...items, { category: addCategory, monthlyTarget: 0 }]); setAddCategory('');
  };
  const exportData = () => {
    const data = { transactions: transactions.data || [], receipts: receipts.data || [], purchaseHistory: purchaseHistory.data || [], budget: plan.data || null, shoppingPreferences: profileQuery.data || null, financeSettings: settings.data || null, dashboard: dashboard.data || null };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'margo-my-data.json'; anchor.click(); URL.revokeObjectURL(url);
  };
  const eraseData = async () => {
    const confirmed = window.confirm('This permanently removes your spending, receipts, budgets, shopping preferences, and bank connections from Margo. Your sign-in account stays. Continue?');
    if (!confirmed) return;
    try { await deleteMyData.mutateAsync(); await logout(); }
    catch (reason) { setError(messageOf(reason)); }
  };
  return <div className="page">
    <PageTitle title="Settings" subtitle="Your preferences, budgets, and account." />
    <section className="account-card"><span className="account-avatar">{user?.firstName?.[0] || user?.email?.[0] || 'M'}</span><span><strong>{[user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Your Margo account'}</strong><small>{user?.email || 'Private to you'}</small></span></section>
    {error && <div className="inline-error" role="alert">{error}</div>}{message && <div className="inline-success" role="status">{message}</div>}
    <section className="surface settings-section"><div className="section-heading"><div><h2>What matters to you</h2><p>Keep the plan close to your real life.</p></div></div>
      {profileQuery.isLoading ? <Skeleton lines={2} /> : profileQuery.isError ? <ErrorState error={profileQuery.error} retry={() => profileQuery.refetch()} /> : <div className="settings-fields"><label>Saving for<input className="field-input" value={savingFor} onChange={(event) => setSavingFor(event.target.value)} placeholder="A trip, more breathing room…" /></label><label>Monthly savings goal<input className="field-input" type="number" min="0" step="25" value={goal} onChange={(event) => setGoal(event.target.value)} /></label><label>Monthly take-home pay<input className="field-input" type="number" min="0" step="50" value={monthlyIncome} onChange={(event) => setMonthlyIncome(event.target.value)} /></label><label>Monthly rent<input className="field-input" type="number" min="0" step="25" value={monthlyRent} onChange={(event) => setMonthlyRent(event.target.value)} /></label><div className="settings-choice-group"><strong>Non-negotiables</strong><div className="settings-chips">{nonNegotiables.map((item) => <button key={item} className={`choice-chip ${profileDraft.nonNegotiables.includes(item) ? 'selected' : ''}`} aria-pressed={profileDraft.nonNegotiables.includes(item)} onClick={() => toggleSettingChoice('nonNegotiables', item)}>{item}</button>)}</div></div><div className="settings-choice-group"><strong>Open to swaps</strong><div className="settings-chips">{swapCategories.map(([value, label]) => <button key={value} className={`choice-chip ${profileDraft.swapCategories.includes(value) ? 'selected' : ''}`} aria-pressed={profileDraft.swapCategories.includes(value)} onClick={() => toggleSettingChoice('swapCategories', value)}>{label}</button>)}</div></div><button className="button secondary" onClick={() => void savePreferences()} disabled={saveProfile.isPending || updatePlan.isPending}>{saveProfile.isPending || updatePlan.isPending ? 'Saving…' : 'Save preferences'}</button></div>}
    </section>
    <section className="surface settings-section"><div className="section-heading"><div><h2>Monthly category budgets</h2><p>Change, add, or remove any category whenever life shifts.</p></div></div>
      {plan.isLoading ? <Skeleton /> : plan.isError ? <ErrorState error={plan.error} retry={() => plan.refetch()} /> : <div className="settings-budgets">{draft.map((item) => <div className="budget-edit" key={item.category}><strong>{item.category}</strong><label className="money-field"><span>$</span><input aria-label={`${item.category} monthly budget`} type="number" min="0" step="25" value={item.monthlyTarget} onChange={(event) => setDraft((rows) => rows.map((row) => row.category === item.category ? { ...row, monthlyTarget: Number(event.target.value) || 0 } : row))} /></label><button className="text-icon" aria-label={`Remove ${item.category}`} onClick={() => setDraft((rows) => rows.filter((row) => row.category !== item.category))}><Trash2 /></button></div>)}
        <div className="add-budget"><select className="field-input" value={addCategory} onChange={(event) => setAddCategory(event.target.value)}><option value="">Add a category</option>{categories.filter((item) => !draft.some((row) => row.category === item)).map((item) => <option key={item}>{item}</option>)}</select><button className="button secondary" disabled={!addCategory} onClick={addBudget}><Plus />Add</button></div><button className="button primary" onClick={() => void saveBudget()} disabled={updatePlan.isPending}>{updatePlan.isPending ? 'Saving…' : 'Save budgets'}</button>
      </div>}
    </section>
    <section className="surface settings-section"><div className="section-heading"><div><h2>Tax set-aside</h2><p>A personal estimate. Not tax advice.</p></div></div>
      {settings.isLoading ? <Skeleton lines={1} /> : settings.isError ? <ErrorState error={settings.error} retry={() => settings.refetch()} /> : <div className="rate-setting"><label htmlFor="tax-rate">Set-aside rate <strong>{rate ?? settings.data?.taxReserveRate ?? 25}%</strong></label><input id="tax-rate" type="range" min="0" max="60" step="1" value={rate ?? settings.data?.taxReserveRate ?? 25} onChange={(event) => setRate(Number(event.target.value))} /><button className="button secondary" onClick={saveTax} disabled={updateRate.isPending}>{updateRate.isPending ? 'Saving…' : 'Save rate'}</button></div>}
    </section>
    <section className="surface settings-section"><div className="section-heading"><div><h2>Connected banks</h2><p>Link a bank or keep adding things yourself.</p></div></div><BankConnect /></section>
    <section className="surface settings-section"><div className="section-heading"><div><h2>Your data</h2><p>Keep a copy or clear the information saved in Margo.</p></div></div><div className="data-actions"><button className="button secondary" onClick={exportData}>Download my data</button><button className="button danger" onClick={() => void eraseData()} disabled={deleteMyData.isPending}>{deleteMyData.isPending ? 'Deleting…' : 'Delete my data'}</button></div><p className="api-note">Deleting removes saved money and shopping data; your sign-in account remains.</p></section>
    <button className="signout-link" onClick={logout}><LogOut />Sign out</button>
  </div>;
}

function OnboardingPage() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const profileQuery = useGetSwapProfile();
  const planQuery = useGetBudgetPlan();
  const saveProfile = useUpdateSwapProfile();
  const savePlan = useUpdateBudgetPlan();
  const [profile, setProfile] = useState<SwapProfileInput>(blankProfile);
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [step, setStep] = useState(0);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const steps = [
    { title: 'What are you saving for?', note: 'And what feels doable to put away each month?' },
    { title: 'What’s your monthly take-home pay?', note: 'A ballpark is fine. This stays private.' },
    { title: 'What’s non-negotiable?', note: 'The things you love are off-limits for swaps.' },
    { title: 'Where are you open to swaps?', note: 'Only choose categories where you’d consider a different pick.' },
    { title: 'Connect your bank', note: 'See spending in one place, or skip and add things yourself.' },
  ];
  useEffect(() => {
    if (initialized.current || profileQuery.isLoading || planQuery.isLoading || profileQuery.isError || planQuery.isError) return;
    initialized.current = true;
    if (profileQuery.data) setProfile(profileQuery.data);
    if (planQuery.data?.annualIncome) setMonthlyIncome(String(planQuery.data.annualIncome / 12));
  }, [profileQuery.data, profileQuery.isLoading, profileQuery.isError, planQuery.data, planQuery.isLoading, planQuery.isError]);
  const toggle = (key: 'nonNegotiables' | 'swapCategories', value: string) => setProfile((current) => {
    const values = current[key] as string[];
    return { ...current, [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] };
  });
  const finish = async (connect: boolean) => {
    setBusy(true); setError('');
    const income = Math.max(0, Number(monthlyIncome) || 0);
    const available = Math.max(0, income - Number(profile.monthlySavingsGoal || 0));
    const draft: BudgetPlanInput = { annualIncome: income * 12, annualSavingsGoal: Number(profile.monthlySavingsGoal || 0) * 12, monthlyRent: Number(planQuery.data?.monthlyRent || 0), priorityCategories: [], categoryBudgets: categories.map((category) => ({ category: category as BudgetPlanInput['categoryBudgets'][number]['category'], monthlyTarget: Math.round(available * (category === 'Rent' ? .3 : category === 'Groceries' ? .2 : category === 'Transportation' ? .12 : category === 'Utilities' ? .1 : category === 'Shopping' ? .1 : category === 'Dining out' ? .08 : category === 'Beauty' ? .05 : .05)) })) };
    try {
      await saveProfile.mutateAsync({ data: { ...profile, savingFor: profile.savingFor.trim() } });
      await savePlan.mutateAsync({ data: draft });
      await Promise.all([qc.invalidateQueries({ queryKey: getGetSwapProfileQueryKey() }), qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() })]);
      if (connect) { setLocation('/settings'); return; }
      setLocation('/');
    } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  };
  const next = () => {
    setError('');
    if (step === 0 && !profile.savingFor.trim()) { setError('Add a goal, even if it’s just a first idea.'); return; }
    if (step === 1 && (!monthlyIncome || Number(monthlyIncome) < 0)) { setError('Add your monthly take-home amount.'); return; }
    if (step < 4) setStep((current) => current + 1);
    else void finish(false);
  };
  if (profileQuery.isLoading || planQuery.isLoading) return <main className="onboarding"><Skeleton lines={5} /></main>;
  if (profileQuery.isError) return <main className="onboarding"><ErrorState error={profileQuery.error} retry={() => profileQuery.refetch()} /></main>;
  return <main className="onboarding">
    <div className="onboarding-brand"><img src={`${import.meta.env.BASE_URL}margo-logo.png`} alt="Margo" /><Link href="/">Exit setup</Link></div>
    <div className="onboarding-progress"><span style={{ transform: `scaleX(${(step + 1) / steps.length})` }} /></div>
    <section className="onboarding-question" key={step}>
      <span className="question-count">A quick hello · {step + 1} of {steps.length}</span><h1>{steps[step].title}</h1><p>{steps[step].note}</p>
      {step === 0 && <div className="onboarding-fields"><label>My goal<input className="field-input" autoFocus value={profile.savingFor} maxLength={160} onChange={(event) => setProfile({ ...profile, savingFor: event.target.value })} placeholder="A trip, a cushion, more breathing room" /></label><label>Monthly goal<div className="currency-input"><span>$</span><input type="number" min="0" step="25" value={profile.monthlySavingsGoal} onChange={(event) => setProfile({ ...profile, monthlySavingsGoal: Number(event.target.value) || 0 })} /></div></label></div>}
      {step === 1 && <label className="onboarding-income">Monthly take-home pay<div className="currency-input"><span>$</span><input autoFocus type="number" min="0" step="50" value={monthlyIncome} onChange={(event) => setMonthlyIncome(event.target.value)} placeholder="4,500" /></div></label>}
      {step === 2 && <div className="chip-grid">{nonNegotiables.map((item) => <button key={item} className={`choice-chip ${profile.nonNegotiables.includes(item) ? 'selected' : ''}`} aria-pressed={profile.nonNegotiables.includes(item)} onClick={() => toggle('nonNegotiables', item)}>{profile.nonNegotiables.includes(item) && <Check />}{item}</button>)}<div className="custom-chip"><input className="field-input" value={custom} onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && custom.trim()) { event.preventDefault(); toggle('nonNegotiables', custom.trim()); setCustom(''); } }} placeholder="Add your own" /><button className="button secondary" onClick={() => { if (custom.trim()) toggle('nonNegotiables', custom.trim()); setCustom(''); }}>Add</button></div>{profile.nonNegotiables.filter((item) => !nonNegotiables.includes(item)).map((item) => <button className="choice-chip selected" key={item} onClick={() => toggle('nonNegotiables', item)}>{item}<X /></button>)}</div>}
      {step === 3 && <div className="chip-grid category-choices">{swapCategories.map(([key, label]) => <button key={key} className={`choice-chip ${profile.swapCategories.includes(key) ? 'selected' : ''}`} aria-pressed={profile.swapCategories.includes(key)} onClick={() => toggle('swapCategories', key)}>{profile.swapCategories.includes(key) ? <Check /> : <Plus />}{label}</button>)}</div>}
      {step === 4 && <div className="connect-step"><span className="connect-illustration"><ShieldCheck /></span><strong>Your money stays yours.</strong><p>Bank connection is optional. You can also skip it and enter spending yourself.</p><BankConnect /></div>}
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="onboarding-buttons">{step > 0 && <button className="button secondary" onClick={() => { setError(''); setStep((current) => current - 1); }} disabled={busy}>Back</button>}{step === 4 && <button className="skip-link" onClick={() => void finish(false)} disabled={busy}>Skip, I’ll add things myself</button>}<button className="button primary" onClick={next} disabled={busy}>{busy ? 'Saving…' : step === 4 ? 'Finish setup' : 'Continue'}{!busy && <ChevronRight />}</button></div>
    </section>
    <p className="onboarding-footnote">No perfect answers needed. We can change everything later.</p>
  </main>;
}

function LoginPage() {
  const { login } = useAuth();
  const benefits = [
    { icon: <ArrowRightLeft />, text: 'See where your money actually goes' },
    { icon: <ScanLine />, text: 'Get cheaper swaps for things you already buy' },
    { icon: <HandCoins />, text: 'Tips on how to make extra money' },
  ];
  return <main className="login-page">
    <section className="login-card">
      <div className="login-brand"><img src={`${import.meta.env.BASE_URL}margo-welcome.png`} alt="Margo, xo your money friend" /></div>
      <h1>Keep what you<br />love. Spend less<br />on it.</h1>
      <div className="login-benefits">{benefits.map(({ icon, text }, index) => <div className="login-benefit" key={text}><span>{icon}</span><p>{text}</p></div>)}</div>
      <div className="login-actions"><button className="button primary" onClick={login} data-testid="button-get-started">Get started</button><button className="login-existing" onClick={login} data-testid="button-existing-account">I already have an account</button></div>
    </section>
  </main>;
}

function AppRoutes() {
  const auth = useAuth();
  const [path, setLocation] = useLocation();
  const plan = useGetBudgetPlan({ query: { enabled: auth.isAuthenticated, queryKey: getGetBudgetPlanQueryKey() } });
  useEffect(() => {
    if (!auth.isAuthenticated || plan.isLoading || plan.isError) return;
    if (!plan.data?.setupComplete && path !== '/onboarding') setLocation('/onboarding');
    if (plan.data?.setupComplete && path === '/onboarding') setLocation('/');
  }, [auth.isAuthenticated, plan.isLoading, plan.isError, plan.data, path, setLocation]);
  if (auth.isLoading) return <main className="loading-page"><Skeleton /></main>;
  if (!auth.isAuthenticated) return <LoginPage />;
  return <Shell><ErrorBoundary resetKey={path}><Switch>
    <Route path="/" component={HomePage} />
    <Route path="/transactions" component={SpendingPage} />
    <Route path="/swaps" component={SwapsPage} />
    <Route path="/earn-save" component={GigsPage} />
    <Route path="/onboarding" component={OnboardingPage} />
    <Route path="/receipts" component={ReceiptPage} />
    <Route path="/profile" component={SettingsPage} />
    <Route path="/settings" component={SettingsPage} />
    <Route component={NotFound} />
  </Switch></ErrorBoundary></Shell>;
}

function App() {
  return <QueryClientProvider client={client}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppRoutes /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
