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
  ArrowDownLeft, ArrowRightLeft, ArrowUpRight, BarChart3, Check, ChevronLeft, ChevronRight, CircleHelp, FileImage,
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
type SwapCatalogRow = {
  id: string; groupName: string; category: string; originalBrand: string; originalProduct: string; originalRetailer: string;
  originalPrice: number | null; swapBrand: string; swapProduct: string; swapRetailer: string; swapPrice: number | null;
  originalPricePerOz: number | null; swapPricePerOz: number | null; savingsPerOzPct: number | null;
  matchType: string; similarity: number | null; confidence: string; whySimilar: string; differences: string; status: string; flags: string;
};
const productMoney = (value: number | null) => value == null ? 'Price unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
async function fetchSwapCatalog(admin = false): Promise<SwapCatalogRow[]> {
  const response = await fetch(admin ? '/api/admin/swap-catalog' : '/api/swap-catalog', { credentials: 'include' });
  if (!response.ok) throw new Error(response.status === 403 ? 'This account is not authorized to manage the swap catalog.' : 'Could not load the swap catalog.');
  return response.json();
}

function Header() {
  const [path] = useLocation();
  const { user } = useAuth();
  const [plusOpen, setPlusOpen] = useState(false);
  const first = user?.firstName?.[0] || user?.email?.[0] || 'M';
  const last = user?.lastName?.[0] || '';
  const tabs = [{ href: '/', label: 'Home', icon: Home }, { href: '/transactions', label: 'Spending', icon: BarChart3 }, { href: '/swaps', label: 'Swaps', icon: ArrowRightLeft }, { href: '/earn-save', label: 'Gigs', icon: HandCoins }];
  return <>
    <header className="top-nav">
      <Link href="/" className="brand-link" aria-label="Margo home"><img src={`${import.meta.env.BASE_URL}margo-seal.svg`} alt="" /><span>Margo</span></Link>
      <div className="nav-actions"><Link className="avatar" href="/profile" aria-label="Open settings" data-testid="link-profile-avatar">{first}{last}</Link></div>
    </header>
    <nav className="bottom-nav" aria-label="Main navigation">
      {tabs.slice(0, 2).map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`bottom-nav-link ${path === href ? 'active' : ''}`} aria-current={path === href ? 'page' : undefined}><Icon /><span>{label}</span></Link>)}
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
      {tabs.slice(2).map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`bottom-nav-link ${path === href ? 'active' : ''}`} aria-current={path === href ? 'page' : undefined}><Icon /><span>{label}</span></Link>)}
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

function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="page-title"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
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
  const profile = useGetSwapProfile();
  const firstName = user?.firstName?.trim();
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 18 ? 'Good afternoon' : 'Good evening';
  const spent = Number(dashboard.data?.monthlySpending || 0);
  const cap = Number(plan.data?.monthlySpendingTarget || 0);
  const left = Math.max(0, cap - spent);
  const overBudgetCategory = plan.data?.categories?.find((item) => Number(item.monthlyTarget || 0) > 0 && Number(item.spentThisMonth || 0) > Number(item.monthlyTarget || 0));
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date());
  const daysRemaining = Math.max(1, new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate() + 1);
  const dailyAvailable = cap ? left / daysRemaining : 0;
  const debtBalance = Number(profile.data?.onboardingAnswers?.debtBalance || 0);
  const debtPayment = Number(profile.data?.onboardingAnswers?.debtPayment || 0);
  const debtFreeDate = debtBalance > 0 && debtPayment > 0 ? new Date(new Date().getFullYear(), new Date().getMonth() + Math.ceil(debtBalance / debtPayment), 1) : null;
  if (dashboard.isLoading || plan.isLoading || transactions.isLoading) return <div className="page"><PageTitle title={`${greeting}${firstName ? `, ${firstName}` : ''}`} subtitle="A little more room for the things you love." /><Skeleton lines={6} /></div>;
  if (dashboard.isError) return <div className="page"><PageTitle title={`${greeting}${firstName ? `, ${firstName}` : ''}`} subtitle="A little more room for the things you love." /><ErrorState error={dashboard.error} retry={() => dashboard.refetch()} /></div>;
  const progress = cap > 0 ? Math.min(100, spent / cap * 100) : 0;
  return <div className="page">
    <PageTitle title={`${greeting}${firstName ? `, ${firstName}` : ''}`} />
    <section className="home-summary">
      <div className="summary-top"><div><span className="summary-kicker">{cap ? `Left to spend in ${monthName}` : 'Set a monthly budget to get started'}</span><div className="summary-amount">{money(cap ? left : spent)}</div></div><div className="summary-budget"><span>Monthly budget</span><strong>{cap ? money(cap) : 'Not set yet'}</strong></div></div>
      <div className="summary-track"><span style={{ width: `${progress}%` }} /></div>
      <div className="summary-bottom"><span>{cap ? `${money(spent)} of ${money(cap)} spent` : 'Your spending plan is ready when you are'}</span><span>{cap ? `About ${money(dailyAvailable)} a day` : 'Edit in Settings'}</span></div>
    </section>
    <div className="home-metrics">
      <div><span>Saved with swaps</span><strong>{money(dashboard.data?.annualSavings)}</strong><small>Based on your saved purchases</small></div>
      <div><span>Tax set-aside</span><strong>{money(dashboard.data?.taxSetAside)}</strong><small>Personal estimate</small></div>
      <div><span>Savings goal</span><strong>{plan.data?.annualIncome ? `${Math.round(Number(plan.data.annualSavingsGoal || 0) / Number(plan.data.annualIncome) * 100)}%` : 'Not set'}</strong><small>{plan.data?.annualSavingsGoal ? 'Of take-home pay' : 'Choose what matters to you'}</small></div>
    </div>
    {overBudgetCategory && <Link href="/swaps" className="budget-alert"><span><CircleHelp /></span><strong>{overBudgetCategory.category} is {money(Number(overBudgetCategory.spentThisMonth) - Number(overBudgetCategory.monthlyTarget))} over its plan · See swaps</strong><ChevronRight /></Link>}
    {comparisons.data?.length ? <Link href="/swaps" className="home-swap-callout"><span className="seal-mark">M</span><span><strong>Your money has a little more room.</strong><small>{comparisons.data.length} saved {comparisons.data.length === 1 ? 'swap' : 'swaps'} to explore</small></span><ChevronRight /></Link> : null}
    <div className="home-columns">
      <section className="surface budget-surface"><div className="section-heading"><div><h2>Your monthly categories</h2><p>A flexible guide, never a rule.</p></div><Link href="/settings" className="quiet-link">Edit</Link></div>
        {plan.data?.categories?.length ? <BudgetList categories={plan.data.categories} compact /> : <EmptyState title="Your budget, your way" body="Add a few monthly categories when you’re ready." action={<Link className="button secondary" href="/settings">Set budgets</Link>} />}
      </section>
    </div>
    {debtFreeDate && <section className="surface debt-payoff"><div><h2>Debt payoff</h2><p>{money(debtBalance)} left · At your current payments, before interest</p></div><strong>Debt-free by {new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(debtFreeDate)}</strong></section>}
    {dashboard.data?.recentTransactions?.length ? <section className="surface recent-surface"><div className="section-heading"><div><h2>Latest spending</h2><p>Your recent activity.</p></div><Link href="/transactions" className="quiet-link">See all</Link></div><TransactionRows items={dashboard.data.recentTransactions.slice(0, 4)} /></section> : null}
  </div>;
}

function BudgetList({ categories: items, compact = false }: { categories: Array<{ category: string; monthlyTarget: number; spentThisMonth: number }>; compact?: boolean }) {
  return <div className={`budget-list ${compact ? 'compact' : ''}`}>{items.map((item) => {
    const target = Number(item.monthlyTarget || 0);
    const amount = Number(item.spentThisMonth || 0);
    const pct = target > 0 ? Math.min(100, amount / target * 100) : 0;
    const remaining = target - amount;
    return <div className={`budget-row ${remaining < 0 ? 'over' : ''}`} key={item.category}><div className="budget-row-top"><strong>{item.category}</strong><span>{target > 0 ? remaining < 0 ? `${money(Math.abs(remaining))} over` : `${money(remaining)} left` : 'No limit'}</span></div><div className="budget-meter"><i style={{ width: `${pct}%` }} /></div></div>;
  })}</div>;
}

function TransactionRows({ items, onDelete, showDate = true }: { items: Transaction[]; onDelete?: (id: string) => void; showDate?: boolean }) {
  return <div className="transaction-rows">{items.map((item) => <div className="activity-row" key={item.id}><span className={`activity-icon ${item.type}`}>{item.type === 'income' ? <ArrowDownLeft /> : <ArrowUpRight />}</span><div className="activity-copy"><strong>{item.label}</strong><small>{item.category}{showDate ? ` · ${dateLabel(item.date)}` : item.source ? ` · ${item.source}` : ''}</small></div><strong className={`activity-amount ${item.type}`}>{item.type === 'income' ? '+' : '−'}{money(item.amount)}</strong>{onDelete && <button className="text-icon" onClick={() => onDelete(item.id)} aria-label={`Delete ${item.label}`}><Trash2 /></button>}</div>)}</div>;
}

function SpendingPage() {
  const qc = useQueryClient();
  const query = useGetTransactions();
  const create = useCreateTransaction();
  const remove = useDeleteTransaction();
  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [formOpen, setFormOpen] = useState(() => new URLSearchParams(window.location.search).has('add'));
  const [kind, setKind] = useState<'expense' | 'income'>(() => new URLSearchParams(window.location.search).get('kind') === 'income' ? 'income' : 'expense');
  const [error, setError] = useState('');
  const monthRows = useMemo(() => (query.data || []).filter((item) => item.date.slice(0, 7) === selectedMonth).sort((a, b) => b.date.localeCompare(a.date)), [query.data, selectedMonth]);
  const list = useMemo(() => monthRows.filter((item) => filter === 'all' || item.type === filter), [monthRows, filter]);
  const groups = useMemo(() => {
    const grouped = new Map<string, Transaction[]>();
    list.forEach((item) => grouped.set(item.date, [...(grouped.get(item.date) || []), item]));
    const now = new Date();
    const currentDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    const previousDay = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    return Array.from(grouped.entries()).map(([date, items]) => ({
      date,
      label: date === currentDay ? 'Today' : date === previousDay ? 'Yesterday' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`)),
      items,
    }));
  }, [list]);
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(`${selectedMonth}-01T12:00:00`));
  const moveMonth = (offset: number) => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const next = new Date(year, month - 1 + offset, 1, 12);
    setSelectedMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
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
  return <div className="page">
    <PageTitle title="Spending" action={<div className="month-selector"><button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)} data-testid="button-previous-month"><ChevronLeft /></button><strong>{monthLabel}</strong><button type="button" aria-label="Next month" onClick={() => moveMonth(1)} data-testid="button-next-month"><ChevronRight /></button></div>} />
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
        const total = monthRows.filter((item) => item.type === type).reduce((sum, item) => sum + Number(item.amount || 0), 0);
        return <div className={type === 'expense' ? 'expense-total' : 'income-total'} key={type}><span>{type === 'expense' ? 'Money out' : 'Money in'}</span><strong>{money(total)}</strong></div>;
      })}
    </section>
    <div className="spending-filter-row" role="group" aria-label="Filter spending">
      {(['all', 'expense', 'income'] as const).map((value) => <button key={value} className={`filter-button ${filter === value ? 'selected' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'expense' ? 'Money out' : 'Money in'}</button>)}
    </div>
    {query.isLoading ? <section className="surface spending-empty"><Skeleton /></section> : query.isError ? <section className="surface spending-empty"><ErrorState error={query.error} retry={() => query.refetch()} /></section> : groups.length ? <div className="spending-day-list">{groups.map((group) => <section className="surface day-group" key={group.date}><h3>{group.label}</h3><TransactionRows items={group.items} onDelete={deleteOne} showDate={false} /></section>)}</div> : <section className="surface spending-empty"><EmptyState title="Nothing here yet" body={`No entries for ${monthLabel}. Add one whenever you want to keep track.`} action={<button className="button primary" onClick={() => setFormOpen(true)}><Plus />Add transaction</button>} /></section>}
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
    {comparisons.data?.length ? <section className="surface saved-receipts"><div className="section-heading"><div><h2>Receipt comparisons</h2><p>Real alternatives from your saved purchases.</p></div></div><div className="swap-card-list">{comparisons.data.map((item, index) => <article className="swap-product-card" key={`${item.productName}-${index}`}><div className="swap-product-pair"><div><small>You bought</small><strong>{item.productName}</strong><span>{money(item.unitPrice)}</span></div><ArrowRightLeft aria-hidden="true" /><div><small>Possible swap</small><strong>{item.alternativeName}</strong><span>{money(item.alternativePrice)}</span></div></div><div className="swap-product-footer"><span>{item.category}</span><strong>Save {money(item.annualSavings)} / year</strong></div></article>)}</div></section> : null}
  </div>;
}

function SwapVoteCard({ productId, name, brand, category }: { productId: string; name: string; brand: string; category: string }) {
  const qc = useQueryClient();
  const query = useGetProductAlternatives(productId, { query: { queryKey: getGetProductAlternativesQueryKey(productId), enabled: Boolean(productId) } });
  const vote = useVoteOnProductAlternative();
  return <div className="alternative-list">{query.isLoading ? <Skeleton lines={2} /> : query.isError ? <ErrorState error={query.error} retry={() => query.refetch()} /> : query.data?.map((item) => <div className="alternative-card" key={item.id}><div><small>{category}</small><strong>{item.name}</strong><span>{item.brand || 'A lower-cost option'} · {item.savingsScore} match</span></div><div className="vote-actions"><button disabled={vote.isPending} onClick={() => vote.mutate({ alternativeId: item.id, data: { vote: 1 } }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetProductAlternativesQueryKey(productId) }); void qc.invalidateQueries({ queryKey: getGetProductComparisonsQueryKey() }); } })} aria-label={`Like ${item.name}`}><Check /></button><button disabled={vote.isPending} onClick={() => vote.mutate({ alternativeId: item.id, data: { vote: -1 } }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetProductAlternativesQueryKey(productId) }); void qc.invalidateQueries({ queryKey: getGetProductComparisonsQueryKey() }); } })} aria-label={`Not for me: ${item.name}`}><X /></button></div></div>)}</div>;
}

function SwapsPage() {
  const catalog = useQuery({ queryKey: ['swap-catalog'], queryFn: () => fetchSwapCatalog() });
  return <div className="page">
    <PageTitle title="Swaps" subtitle="Cheaper finds for the things you already buy." />
    {catalog.isLoading ? <Skeleton lines={5} /> : catalog.isError ? <ErrorState error={catalog.error} retry={() => catalog.refetch()} /> : catalog.data?.length ? <div className="swap-card-list">{catalog.data.map((row) => <Link className="swap-product-card surface catalog-swap-card" key={row.id} href={`/swaps/${encodeURIComponent(row.id)}`}>
      <div className="swap-product-pair"><div><small>{row.groupName} · {row.category} · {row.matchType}</small><strong>{row.originalBrand ? `${row.originalBrand} ` : ''}{row.originalProduct}</strong><span>{productMoney(row.originalPrice)}{row.originalRetailer ? ` · ${row.originalRetailer}` : ''}</span></div><ArrowRightLeft aria-hidden="true" /><div><small>{row.similarity == null ? 'Match' : `${row.similarity}% match`}</small><strong>{row.swapBrand ? `${row.swapBrand} ` : ''}{row.swapProduct}</strong><span>{productMoney(row.swapPrice)}{row.swapRetailer ? ` · ${row.swapRetailer}` : ''}</span></div></div>
      {row.originalPricePerOz != null && row.swapPricePerOz != null && <div className="catalog-unit-savings">Per ounce: {productMoney(row.originalPricePerOz)} → {productMoney(row.swapPricePerOz)}{row.savingsPerOzPct != null ? ` · ${Math.round(row.savingsPerOzPct)}% less` : ''}</div>}
    </Link>)}</div> : <section className="surface"><EmptyState title="No priced swaps are ready yet" body="We’ll show catalog matches here once both products have prices." action={<Link className="button primary" href="/receipts?scan=receipt">Scan a receipt</Link>} /></section>}
    <p className="legal-line">Prices may change. Similarity notes describe product attributes; check current packaging and pricing.</p>
  </div>;
}

function SwapDetailPage({ id }: { id: string }) {
  const catalog = useQuery({ queryKey: ['swap-catalog'], queryFn: () => fetchSwapCatalog() });
  const row = catalog.data?.find((item) => item.id === id);
  if (catalog.isLoading) return <div className="page"><Skeleton lines={4} /></div>;
  if (catalog.isError) return <div className="page"><ErrorState error={catalog.error} retry={() => catalog.refetch()} /></div>;
  if (!row) return <div className="page"><PageTitle title="Swap not available" /><Link className="quiet-link" href="/swaps">Back to swaps</Link></div>;
  return <div className="page swap-detail-page"><Link className="quiet-link" href="/swaps"><ChevronLeft />All swaps</Link><PageTitle title={row.swapProduct} subtitle={`${row.swapBrand || row.groupName} · ${row.category}`} />
    <section className="surface detail-price-pair"><div><small>Original</small><h2>{row.originalBrand} {row.originalProduct}</h2><strong>{productMoney(row.originalPrice)}</strong><span>{row.originalRetailer}</span></div><ArrowRightLeft /><div><small>{row.matchType} · {row.similarity ?? '—'}% similarity</small><h2>{row.swapBrand} {row.swapProduct}</h2><strong>{productMoney(row.swapPrice)}</strong><span>{row.swapRetailer}</span></div></section>
    {row.originalPricePerOz != null && row.swapPricePerOz != null && <section className="surface"><h2>Price per ounce</h2><p>{productMoney(row.originalPricePerOz)} original · {productMoney(row.swapPricePerOz)} swap{row.savingsPerOzPct != null ? ` · ${Math.round(row.savingsPerOzPct)}% less per ounce` : ''}</p></section>}
    <section className="surface swap-reason"><h2>Why it’s similar</h2><p>{row.whySimilar || 'No similarity notes provided.'}</p>{row.differences && <div className="swap-differences"><h3>Differences</h3><p>{row.differences}</p></div>}</section>
    <p className="legal-line">Prices may change. Review current product details before purchasing.</p>
  </div>;
}

const adminFields: Array<{ key: keyof SwapCatalogRow; label: string; kind?: 'number' | 'long' }> = [
  { key: 'groupName', label: 'Group' }, { key: 'category', label: 'Category' },
  { key: 'originalBrand', label: 'Original brand' }, { key: 'originalProduct', label: 'Original product' },
  { key: 'originalRetailer', label: 'Original retailer' }, { key: 'originalPrice', label: 'Original price', kind: 'number' },
  { key: 'swapBrand', label: 'Swap brand' }, { key: 'swapProduct', label: 'Swap product' },
  { key: 'swapRetailer', label: 'Swap retailer' }, { key: 'swapPrice', label: 'Swap price', kind: 'number' },
  { key: 'originalPricePerOz', label: 'Original price per oz', kind: 'number' }, { key: 'swapPricePerOz', label: 'Swap price per oz', kind: 'number' },
  { key: 'savingsPerOzPct', label: 'Savings per oz %', kind: 'number' }, { key: 'matchType', label: 'Match type' },
  { key: 'similarity', label: 'Similarity', kind: 'number' }, { key: 'confidence', label: 'Confidence' },
  { key: 'whySimilar', label: 'Why it’s similar', kind: 'long' }, { key: 'differences', label: 'Differences', kind: 'long' },
  { key: 'status', label: 'Status' }, { key: 'flags', label: 'Flags', kind: 'long' },
];
function AdminSwapsPage() {
  const query = useQuery({ queryKey: ['admin-swap-catalog'], queryFn: () => fetchSwapCatalog(true) });
  const [rows, setRows] = useState<SwapCatalogRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (query.data) setRows(query.data); }, [query.data]);
  const refresh = async () => { await query.refetch(); };
  const update = (id: string, key: keyof SwapCatalogRow, value: string) => setRows((current) => current.map((row) => row.id === id ? { ...row, [key]: key === 'originalPrice' || key === 'swapPrice' || key === 'originalPricePerOz' || key === 'swapPricePerOz' || key === 'savingsPerOzPct' || key === 'similarity' ? value === '' ? null : Number(value) : value } : row));
  const payloadFor = (row: SwapCatalogRow) => ({
    group: row.groupName, category: row.category, original_brand: row.originalBrand, original_product: row.originalProduct,
    original_retailer: row.originalRetailer, original_price: row.originalPrice, swap_brand: row.swapBrand,
    swap_product: row.swapProduct, swap_retailer: row.swapRetailer, swap_price: row.swapPrice,
    original_price_per_oz: row.originalPricePerOz, swap_price_per_oz: row.swapPricePerOz,
    savings_per_oz_pct: row.savingsPerOzPct, match_type: row.matchType, similarity: row.similarity,
    confidence: row.confidence, why_similar: row.whySimilar, differences: row.differences, status: row.status, flags: row.flags,
  });
  const save = async (row: SwapCatalogRow) => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/admin/swap-catalog/${encodeURIComponent(row.id)}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadFor(row)) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not save this swap.');
      setMessage(`${row.id} saved.`); await refresh();
    } catch (error) { setMessage(messageOf(error)); } finally { setBusy(false); }
  };
  const approve = async (row: SwapCatalogRow) => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/admin/swap-catalog/${encodeURIComponent(row.id)}/approve`, { method: 'POST', credentials: 'include' });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not approve this swap.');
      setMessage(`${row.id} approved. It appears to users only after both prices are filled in.`); await refresh();
    } catch (error) { setMessage(messageOf(error)); } finally { setBusy(false); }
  };
  const importCsv = async () => {
    if (!file) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/swap-catalog/import', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: await file.text() }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not import CSV.');
      setMessage(body.message); setFile(null); await refresh();
    } catch (error) { setMessage(messageOf(error)); } finally { setBusy(false); }
  };
  return <div className="page admin-swaps-page"><PageTitle title="Swap catalog" subtitle="Review, edit, approve, and re-import catalog rows by ID." />
    <section className="surface catalog-import"><label>Import updated CSV<input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><button className="button primary" disabled={!file || busy} onClick={() => void importCsv()}><Upload />Import / update</button><p>Existing IDs are updated; new IDs are added. Rows without both prices stay hidden from users.</p></section>
    {message && <p className="inline-success" role="status">{message}</p>}
    {query.isLoading ? <Skeleton lines={5} /> : query.isError ? <ErrorState error={query.error} retry={() => query.refetch()} /> : rows.map((row) => <article className="surface admin-swap-row" key={row.id}>
      <div className="admin-row-heading"><div><strong>{row.id}</strong><span>{row.status}</span></div><div>{row.status.startsWith('Review first') && <button className="button secondary" disabled={busy} onClick={() => void approve(row)}>Approve</button>}<button className="button primary" disabled={busy} onClick={() => void save(row)}>Save changes</button></div></div>
      <div className="admin-swap-fields">{adminFields.map(({ key, label, kind }) => <label key={key}>{label}{kind === 'long' ? <textarea rows={key === 'flags' ? 3 : 4} value={String(row[key] ?? '')} onChange={(event) => update(row.id, key, event.target.value)} /> : <input type={kind === 'number' ? 'number' : 'text'} step={kind === 'number' ? 'any' : undefined} value={String(row[key] ?? '')} onChange={(event) => update(row.id, key, event.target.value)} />}</label>)}</div>
    </article>)}
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

function BankConnect({ onConnected }: { onConnected?: () => void } = {}) {
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
      onConnected?.();
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
      const updated = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
      const answerValues = key === 'swapCategories' ? updated.map((item) => swapCategories.find(([categoryKey]) => categoryKey === item)?.[1] || item) : updated;
      return { ...current, [key]: updated, onboardingAnswers: { ...(current.onboardingAnswers || {}), [key]: JSON.stringify(answerValues) } };
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
      await saveProfile.mutateAsync({ data: { ...profileDraft, savingFor: savingFor.trim(), monthlySavingsGoal: Math.max(0, Number(goal) || 0), onboardingAnswers: { ...(profileDraft.onboardingAnswers || {}), savingFor: savingFor.trim(), savingsGoal: goal, savingsGoalPeriod: 'month', takeHome: monthlyIncome, takeHomePeriod: 'month', rent: monthlyRent } } });
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
  const answerLabels: Record<string, string> = {
    takeHome: 'Take-home pay', takeHomePeriod: 'Take-home pay frequency', sideGig: 'Side gig income',
    savingsGoal: 'Savings goal', savingsGoalPeriod: 'Savings goal frequency', savingFor: 'Biggest goal',
    nonNegotiables: 'Non-negotiables', swapCategories: 'Open to swaps', rent: 'Rent', carPayment: 'Car payment',
    phoneBill: 'Phone bill', pets: 'Pets', petCosts: 'Pet costs', otherBills: 'Other monthly bills',
    hasDebt: 'Debt', debtTypes: 'Debt types', debtBalance: 'Debt balance', debtPayment: 'Monthly debt payment', connect: 'Bank connection choice',
  };
  const listAnswerKeys = new Set(['nonNegotiables', 'swapCategories', 'debtTypes']);
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
    <section className="surface settings-section"><div className="section-heading"><div><h2>About you</h2><p>Keep the plan close to your real life.</p></div></div>
      {profileQuery.isLoading ? <Skeleton lines={2} /> : profileQuery.isError ? <ErrorState error={profileQuery.error} retry={() => profileQuery.refetch()} /> : <div className="settings-fields"><label>Saving for<input className="field-input" value={savingFor} onChange={(event) => setSavingFor(event.target.value)} placeholder="A trip, more breathing room…" /></label><label>Monthly savings goal<input className="field-input" type="number" min="0" step="25" value={goal} onChange={(event) => setGoal(event.target.value)} /></label><label>Monthly take-home pay<input className="field-input" type="number" min="0" step="50" value={monthlyIncome} onChange={(event) => setMonthlyIncome(event.target.value)} /></label><label>Monthly rent<input className="field-input" type="number" min="0" step="25" value={monthlyRent} onChange={(event) => setMonthlyRent(event.target.value)} /></label><div className="settings-choice-group"><strong>Non-negotiables</strong><div className="settings-chips">{nonNegotiables.map((item) => <button key={item} className={`choice-chip ${profileDraft.nonNegotiables.includes(item) ? 'selected' : ''}`} aria-pressed={profileDraft.nonNegotiables.includes(item)} onClick={() => toggleSettingChoice('nonNegotiables', item)}>{item}</button>)}</div></div><div className="settings-choice-group"><strong>Open to swaps</strong><div className="settings-chips">{swapCategories.map(([value, label]) => <button key={value} className={`choice-chip ${profileDraft.swapCategories.includes(value) ? 'selected' : ''}`} aria-pressed={profileDraft.swapCategories.includes(value)} onClick={() => toggleSettingChoice('swapCategories', value)}>{label}</button>)}</div></div>{Object.entries(profileDraft.onboardingAnswers || {}).filter(([key]) => answerLabels[key] && key !== 'savingFor' && key !== 'takeHome' && key !== 'savingsGoal' && key !== 'rent' && key !== 'nonNegotiables' && key !== 'swapCategories').length > 0 && <details className="onboarding-answer-details"><summary>Other setup answers</summary><div className="onboarding-answer-grid">{Object.entries(profileDraft.onboardingAnswers || {}).filter(([key]) => answerLabels[key] && key !== 'savingFor' && key !== 'takeHome' && key !== 'savingsGoal' && key !== 'rent' && key !== 'nonNegotiables' && key !== 'swapCategories').map(([key, value]) => { let shown = value; if (listAnswerKeys.has(key)) { try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) shown = parsed.join(', '); } catch { /* Keep editable text as entered. */ } } return <label key={key}>{answerLabels[key]}<input className="field-input" value={shown} onChange={(event) => { const next = event.target.value; setProfileDraft((current) => ({ ...current, onboardingAnswers: { ...(current.onboardingAnswers || {}), [key]: listAnswerKeys.has(key) ? JSON.stringify(next.split(',').map((item) => item.trim()).filter(Boolean)) : next } })); }} /></label>; })}</div></details>}<button className="button secondary" onClick={() => void savePreferences()} disabled={saveProfile.isPending || updatePlan.isPending}>{saveProfile.isPending || updatePlan.isPending ? 'Saving…' : 'Save preferences'}</button></div>}
    </section>
    <section className="surface settings-section"><div className="section-heading"><div><h2>Your money</h2><p>Monthly category budgets.</p></div></div>
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
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState('');
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const prompts: Array<{ key: string; text: string; kind: 'amount' | 'text' | 'single' | 'multi' | 'budget' | 'connect' | 'done'; choices?: string[]; periodKey?: string; skip?: string }> = [
    { key: 'takeHome', text: 'What is your take-home pay?', kind: 'amount' as const, periodKey: 'takeHomePeriod' },
    { key: 'sideGig', text: 'Do you earn money from side gigs?', kind: 'single' as const, choices: ['Yes', 'No'] },
    { key: 'savingsGoal', text: 'How much would you like to save?', kind: 'amount' as const, periodKey: 'savingsGoalPeriod' },
    { key: 'savingFor', text: 'What is your biggest goal?', kind: 'text' as const },
    { key: 'nonNegotiables', text: 'What should never be part of a swap?', kind: 'multi' as const, choices: nonNegotiables },
    { key: 'swapCategories', text: 'Where are you open to cheaper alternatives?', kind: 'multi' as const, choices: swapCategories.map(([, label]) => label) },
    { key: 'rent', text: 'What do you pay for rent each month?', kind: 'amount' as const },
    { key: 'carPayment', text: 'Do you have a monthly car payment?', kind: 'amount' as const, skip: 'No car payment' },
    { key: 'phoneBill', text: 'What is your monthly phone bill?', kind: 'amount' as const },
    { key: 'pets', text: 'Do you have pets?', kind: 'single' as const, choices: ['Yes', 'No'] },
    ...(answers.pets === 'Yes' ? [{ key: 'petCosts', text: 'About how much do pet costs add up to each month?', kind: 'amount' as const }] : []),
    { key: 'otherBills', text: 'Any other monthly bills to include?', kind: 'amount' as const },
    { key: 'hasDebt', text: 'Are you paying down any debt?', kind: 'single' as const, choices: ['Yes', 'No'] },
    ...(answers.hasDebt === 'Yes' ? [
      { key: 'debtTypes', text: 'What kinds of debt are you paying down?', kind: 'multi' as const, choices: ['Credit cards', 'Student loans', 'Auto loan', 'Medical bills', 'Other'] },
      { key: 'debtBalance', text: 'About how much debt do you have left in total?', kind: 'amount' as const },
      { key: 'debtPayment', text: 'How much do you pay toward debt each month?', kind: 'amount' as const },
    ] : []),
    { key: 'budget', text: 'Here is a starting budget based on what you shared.', kind: 'budget' as const },
    { key: 'connect', text: 'Want to connect a bank so spending can stay up to date?', kind: 'connect' as const },
    { key: 'done', text: 'You’re all set. Your plan can change whenever life does.', kind: 'done' as const },
  ];
  const current = prompts[Math.min(step, prompts.length - 1)];
  const monthlyValue = (key: string) => {
    const amount = Math.max(0, Number(answers[key]) || 0);
    return answers[`${key}Period`] === 'year' ? amount / 12 : amount;
  };
  const monthlyIncome = monthlyValue('takeHome');
  const monthlySavings = monthlyValue('savingsGoal');
  const bills = ['rent', 'carPayment', 'phoneBill', 'petCosts', 'otherBills', 'debtPayment'].reduce((sum, key) => sum + (key === 'petCosts' && answers.pets !== 'Yes' || key === 'debtPayment' && answers.hasDebt !== 'Yes' ? 0 : Number(answers[key]) || 0), 0);
  const budgetPool = Math.max(0, monthlyIncome - monthlySavings - bills);
  const budgetRows = [
    ['Groceries', .40], ['Transportation', .20], ['Dining out', .15],
    ['Shopping', .12], ['Beauty', .08], ['Subscriptions', .05],
  ] as const;
  const selectedText = (value: string) => {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.join(', ') : value; } catch { return value; }
  };
  useEffect(() => {
    if (initialized.current || profileQuery.isLoading || planQuery.isLoading || profileQuery.isError || planQuery.isError) return;
    initialized.current = true;
    if (profileQuery.data?.onboardingAnswers) setAnswers(profileQuery.data.onboardingAnswers);
  }, [profileQuery.data, profileQuery.isLoading, profileQuery.isError, planQuery.data, planQuery.isLoading, planQuery.isError]);
  useEffect(() => {
    setDraft(answers[current.key] || '');
    setPeriod(answers[`${current.key}Period`] === 'year' ? 'year' : 'month');
    try { const parsed = JSON.parse(answers[current.key] || '[]'); setSelected(Array.isArray(parsed) ? parsed : []); } catch { setSelected([]); }
    setError('');
  }, [current.key]);
  const saveAnswer = (key: string, value: string) => {
    setAnswers((previous) => ({ ...previous, [key]: value }));
    setStep((previous) => previous + 1);
    setError('');
  };
  const submitDraft = () => {
    if (current.kind === 'amount' && (!draft.trim() || !Number.isFinite(Number(draft)) || Number(draft) < 0)) { setError('Enter an amount of zero or more.'); return; }
    if (current.kind === 'text' && !draft.trim()) { setError('Add a goal, even if it is just a first idea.'); return; }
    const nextAnswers = { ...answers, [current.key]: draft.trim() };
    if ('periodKey' in current && current.periodKey) nextAnswers[current.periodKey] = period;
    setAnswers(nextAnswers);
    setStep((previous) => previous + 1);
    setError('');
  };
  const finish = async () => {
    setBusy(true); setError('');
    const categoriesChosen = (() => { try { return JSON.parse(answers.swapCategories || '[]') as string[]; } catch { return []; } })();
    const nonnegotiablesChosen = (() => { try { return JSON.parse(answers.nonNegotiables || '[]') as string[]; } catch { return []; } })();
    const categoryValues = new Map<string, SwapProfileInput['swapCategories'][number]>(swapCategories.map(([key, label]) => [label, key]));
    const profile: SwapProfileInput = {
      ...blankProfile,
      savingFor: answers.savingFor || '',
      monthlySavingsGoal: monthlySavings,
      nonNegotiables: nonnegotiablesChosen,
      swapCategories: categoriesChosen.flatMap((label) => { const value = categoryValues.get(label); return value ? [value] : []; }),
      onboardingAnswers: answers,
    };
    const budget: BudgetPlanInput = {
      annualIncome: monthlyIncome * 12,
      annualSavingsGoal: monthlySavings * 12,
      monthlyRent: Number(answers.rent) || 0,
      priorityCategories: [],
      categoryBudgets: budgetRows.map(([category, ratio]) => ({ category: category as BudgetPlanInput['categoryBudgets'][number]['category'], monthlyTarget: Math.round(budgetPool * ratio) })),
    };
    try {
      await saveProfile.mutateAsync({ data: profile });
      await savePlan.mutateAsync({ data: budget });
      await Promise.all([qc.invalidateQueries({ queryKey: getGetSwapProfileQueryKey() }), qc.invalidateQueries({ queryKey: getGetBudgetPlanQueryKey() })]);
      setLocation('/');
    } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  };
  if (profileQuery.isLoading || planQuery.isLoading) return <main className="onboarding"><Skeleton lines={5} /></main>;
  if (profileQuery.isError) return <main className="onboarding"><ErrorState error={profileQuery.error} retry={() => profileQuery.refetch()} /></main>;
  const setChoice = (value: string) => saveAnswer(current.key, value);
  const toggleSelected = (value: string) => setSelected((existing) => existing.includes(value) ? existing.filter((item) => item !== value) : [...existing, value]);
  return <main className="onboarding onboarding-chat-shell">
    <div className="onboarding-brand"><img src={`${import.meta.env.BASE_URL}margo-logo.png`} alt="Margo" /><button className="start-over" onClick={() => { setAnswers({}); setStep(0); }}>Start over</button></div>
    <div className="onboarding-progress"><span style={{ transform: `scaleX(${Math.min(1, step / (prompts.length - 1))})` }} /></div>
    <div className="conversation-scroll">
      <div className="chat-message from-margo"><span className="chat-seal">M</span><p>Hi, I’m Margo. Let’s make a money plan that keeps the things you love.</p></div>
      {prompts.slice(0, step).map((prompt) => <div className="chat-exchange" key={prompt.key}>
        <div className="chat-message from-margo"><span className="chat-seal">M</span><p>{prompt.text}</p></div>
        {prompt.kind === 'budget' ? <div className="chat-budget-card"><strong>Your starting monthly budget</strong><span>Take-home {money(monthlyIncome)} · bills {money(bills)} · savings {money(monthlySavings)}</span>{budgetRows.map(([category, ratio]) => <div key={category}><span>{category}</span><b>{money(Math.round(budgetPool * ratio))}</b></div>)}</div> : <><div className="chat-message from-user"><p>{prompt.kind === 'multi' ? selectedText(answers[prompt.key] || '[]') : prompt.kind === 'amount' ? `${money(answers[prompt.key])} / ${answers[`${prompt.key}Period`] || 'month'}` : answers[prompt.key]}</p></div><div className="chat-message from-margo"><span className="chat-seal">M</span><p>{prompt.kind === 'amount' ? `Got it, about ${money(monthlyValue(prompt.key))} a month.` : 'Got it. I’ll keep that in mind.'}</p></div></>}
      </div>)}
      {step < prompts.length && current.kind !== 'done' && <div className="chat-message from-margo"><span className="chat-seal">M</span><p>{current.text}</p></div>}
      {current.kind === 'budget' && <div className="chat-budget-card"><strong>Your starting monthly budget</strong><span>Take-home {money(monthlyIncome)} · bills {money(bills)} · savings {money(monthlySavings)}</span>{budgetRows.map(([category, ratio]) => <div key={category}><span>{category}</span><b>{money(Math.round(budgetPool * ratio))}</b></div>)}</div>}
      {current.kind === 'done' && <div className="chat-message from-margo"><span className="chat-seal">M</span><p>{current.text}</p></div>}
    </div>
    <div className="answer-dock">
      {error && <div className="inline-error" role="alert">{error}</div>}
      {current.kind === 'amount' && <>{current.periodKey && <div className="period-toggle"><button className={period === 'month' ? 'selected' : ''} onClick={() => setPeriod('month')}>Per month</button><button className={period === 'year' ? 'selected' : ''} onClick={() => setPeriod('year')}>Per year</button></div>}<div className="chat-answer-row"><label className="chat-amount"><span>$</span><input autoFocus type="number" min="0" step="25" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="0" onKeyDown={(event) => { if (event.key === 'Enter') submitDraft(); }} /></label><button className="button primary chat-send" onClick={submitDraft} aria-label="Send answer"><ArrowUpRight /></button></div>{current.skip && <button className="skip-link" onClick={() => saveAnswer(current.key, '0')}>{current.skip}</button>}</>}
      {current.kind === 'text' && <div className="chat-answer-row"><input className="field-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="A trip, a cushion, more breathing room" onKeyDown={(event) => { if (event.key === 'Enter') submitDraft(); }} /><button className="button primary chat-send" onClick={submitDraft} aria-label="Send answer"><ArrowUpRight /></button></div>}
      {current.kind === 'single' && <div className="chat-choice-row">{(current.choices || []).map((choice) => <button key={choice} className="choice-chip" onClick={() => setChoice(choice)}>{choice}</button>)}</div>}
      {current.kind === 'multi' && <><div className="chat-choice-row">{(current.choices || []).map((choice) => <button key={choice} className={`choice-chip ${selected.includes(choice) ? 'selected' : ''}`} aria-pressed={selected.includes(choice)} onClick={() => toggleSelected(choice)}>{selected.includes(choice) && <Check />}{choice}</button>)}</div><button className="button primary chat-done" onClick={() => saveAnswer(current.key, JSON.stringify(selected))}>Done</button></>}
      {current.kind === 'budget' && <button className="button primary chat-done" onClick={() => setStep((value) => value + 1)}>Continue</button>}
      {current.kind === 'connect' && <><BankConnect onConnected={() => saveAnswer('connect', 'Connected')} /><button className="button secondary chat-done" onClick={() => saveAnswer('connect', 'Not now')}>Not now</button></>}
      {current.kind === 'done' && <button className="button primary chat-done" disabled={busy} onClick={() => void finish()}>{busy ? 'Saving your plan…' : 'Go to my home'}</button>}
    </div>
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
    <Route path="/swaps/:id">{(params) => <SwapDetailPage id={params.id} />}</Route>
    <Route path="/admin/swaps" component={AdminSwapsPage} />
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
