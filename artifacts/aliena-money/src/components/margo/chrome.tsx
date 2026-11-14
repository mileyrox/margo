import { openReceiptCamera, ReceiptCameraInput } from '@/components/margo/receipt-camera';
import { type ReactNode, useEffect, useState } from 'react';
import { MargoMascot, type MascotPose } from '@/components/margo/mascot';
import { Link, useLocation } from 'wouter';
import { useUser } from '@clerk/react';
import { BarChart3, ChevronLeft, Home, LayoutGrid, Plus, ReceiptText, ScanBarcode, ShoppingBag, ArrowLeftRight } from 'lucide-react';
import { CoinAvatar, Seal, parseLook } from './art';
import { useProfileAnswers } from '@/lib/profile';
import { messageOf } from '@/lib/format';

function Header() {
  const { user } = useUser();
  const { answers } = useProfileAnswers();
  const look = parseLook(answers.avatar);
  const initial = (user?.firstName?.[0] || user?.primaryEmailAddress?.emailAddress?.[0] || 'M').toUpperCase();
  return <header className="m-header">
    <Link href="/" className="m-brand" aria-label="Margo home"><Seal size={34} /><span>Margo</span></Link>
    <Link href="/settings" className="m-avatar-button" aria-label="Open settings" data-testid="link-profile-avatar">
      {look ? <CoinAvatar look={look} size={44} label="Your avatar. Open settings" /> : initial}
    </Link>
  </header>;
}

const tabs = [
  { href: '/', label: 'Home', icon: Home, match: (p: string) => p === '/' },
  { href: '/transactions', label: 'Spending', icon: BarChart3, match: (p: string) => p.startsWith('/transactions') },
  { href: '/swaps', label: 'Swaps', icon: ArrowLeftRight, match: (p: string) => p.startsWith('/swaps') },
  { href: '/earn-save', label: 'Apps', icon: LayoutGrid, match: (p: string) => p.startsWith('/earn-save') },
];

function BottomNav({ onPlus }: { onPlus: () => void }) {
  const [path] = useLocation();
  const link = ({ href, label, icon: Icon, match }: typeof tabs[number]) => {
    const active = match(path);
    return <Link key={href} href={href} className={`m-tab ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}><Icon aria-hidden="true" /><span>{label}</span></Link>;
  };
  return <nav className="m-nav" aria-label="Main navigation">
    {tabs.slice(0, 2).map(link)}
    <button type="button" className="m-plus" aria-label="Add or scan" onClick={onPlus} data-testid="button-open-create-menu"><Plus aria-hidden="true" /></button>
    {tabs.slice(2).map(link)}
  </nav>;
}

export function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const [, setLocation] = useLocation();
  if (!open) return null;
  const options = [
    { href: '/receipts?scan=receipt', title: 'Scan a receipt', sub: "I'll read it and look for cheaper swaps", icon: ReceiptText, tone: 'burgundy' },
    { href: '/receipts?scan=barcode', title: 'Scan a barcode', sub: 'Check one product before you buy', icon: ScanBarcode, tone: 'blue' },
    { href: '/transactions?add=1', title: 'Add a purchase', sub: 'Cash, Venmo, or anything I missed', icon: ShoppingBag, tone: 'cream' },
  ];
  return <div className="m-sheet-backdrop" onClick={onClose}>
    <div className="m-sheet" role="dialog" aria-modal="true" aria-label="What are we adding?" onClick={(event) => event.stopPropagation()}>
      <span className="m-sheet-handle" aria-hidden="true" />
      <h2>What are we adding?</h2>
      {options.map(({ href, title, sub, icon: Icon, tone }) => <Link key={href} href={href} className="m-sheet-option" onClick={(event) => {
        // Receipts: open the camera straight from this tap.
        if (href === '/receipts?scan=receipt') { event.preventDefault(); onClose(); openReceiptCamera(() => setLocation(href)); return; }
        onClose();
      }}>
        <span className={`m-sheet-icon ${tone}`}><Icon aria-hidden="true" /></span>
        <span><strong>{title}</strong><small>{sub}</small></span>
      </Link>)}
      <button type="button" className="m-link-button" onClick={onClose}>Never mind</button>
    </div>
  </div>;
}

export function Shell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const [sheet, setSheet] = useState(false);
  const fullscreen = path === '/onboarding';
  useEffect(() => { setSheet(false); }, [path]);
  if (fullscreen) return <div className="m-app m-fullscreen">{children}</div>;
  return <div className="m-app">
    <ReceiptCameraInput />
    <Header />
    <main className="m-main">{children}</main>
    <BottomNav onPlus={() => setSheet(true)} />
    <AddSheet open={sheet} onClose={() => setSheet(false)} />
  </div>;
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="m-title"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link className="m-back" href={href}><ChevronLeft aria-hidden="true" />{children}</Link>;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="m-skeleton" aria-label="Loading">{Array.from({ length: lines }, (_, i) => <i key={i} />)}</div>;
}

export function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="m-error" role="alert"><span>{messageOf(error)}</span><button className="m-btn outline small" onClick={retry}>Try again</button></div>;
}

export function EmptyState({ title, body, action, pose = 'snooze' }: { title: string; body: string; action?: ReactNode; pose?: MascotPose }) {
  return <div className="m-empty"><MargoMascot pose={pose} className="m-empty-mascot" label="" /><h2>{title}</h2><p>{body}</p>{action}</div>;
}
