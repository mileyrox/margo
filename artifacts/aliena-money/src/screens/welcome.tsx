import { MargoMascot } from '@/components/margo/mascot';
import { Link } from 'wouter';
import { useLocation } from 'wouter';
import { ArrowLeftRight, BarChart3, PiggyBank } from 'lucide-react';

export function WelcomePage() {
  const [, navigate] = useLocation();
  const benefits = [
    { icon: BarChart3, text: 'See where your money actually goes' },
    { icon: ArrowLeftRight, text: 'Get cheaper swaps for things you already buy' },
    { icon: PiggyBank, text: 'Know what to set aside from side gigs' },
  ];
  return <main className="m-welcome">
    <div className="m-welcome-brand"><MargoMascot pose="wave" className="m-welcome-mascot" label="Margo waving hello" /><span>Margo</span></div>
    <h1>Keep what you love. Spend less on it.</h1>
    <div className="m-welcome-list">{benefits.map(({ icon: Icon, text }) => <div key={text}><span><Icon aria-hidden="true" /></span><p>{text}</p></div>)}</div>
    <div className="m-welcome-actions">
      <button className="m-btn burgundy pill big" onClick={() => navigate('/sign-up')} data-testid="button-get-started">Get started</button>
      <button className="m-link-button" onClick={() => navigate('/sign-in')} data-testid="button-existing-account">I already have an account</button>
      <p className="m-fine">By continuing, you agree to Margo's <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>. Margo is for people 18 and older.</p>
    </div>
  </main>;
}
