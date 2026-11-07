import { useAuth } from '@workspace/replit-auth-web';
import { ArrowLeftRight, BarChart3, PiggyBank } from 'lucide-react';
import { Seal } from '@/components/margo/art';

export function WelcomePage() {
  const { login } = useAuth();
  const benefits = [
    { icon: BarChart3, text: 'See where your money actually goes' },
    { icon: ArrowLeftRight, text: 'Get cheaper swaps for things you already buy' },
    { icon: PiggyBank, text: 'Know what to set aside from side gigs' },
  ];
  return <main className="m-welcome">
    <div className="m-welcome-brand"><Seal size={72} /><span>Margo</span></div>
    <h1>Keep what you love. Spend less on it.</h1>
    <div className="m-welcome-list">{benefits.map(({ icon: Icon, text }) => <div key={text}><span><Icon aria-hidden="true" /></span><p>{text}</p></div>)}</div>
    <div className="m-welcome-actions">
      <button className="m-btn burgundy pill big" onClick={login} data-testid="button-get-started">Get started</button>
      <button className="m-link-button" onClick={login} data-testid="button-existing-account">I already have an account</button>
    </div>
  </main>;
}
