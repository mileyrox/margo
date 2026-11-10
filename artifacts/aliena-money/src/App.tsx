import { type ComponentType, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';
import { getGetBudgetPlanQueryKey, useGetBudgetPlan } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EmptyState, Shell, Skeleton } from '@/components/margo/chrome';
import { HomePage } from '@/screens/home';
import { SpendingPage } from '@/screens/spending';
import { ReceiptPage } from '@/screens/receipts';
import { AdminSwapsPage, SwapDetailPage, SwapsPage } from '@/screens/swaps';
import { MoneyAppsPage } from '@/screens/money-apps';
import { SettingsPage } from '@/screens/settings';
import { OnboardingPage } from '@/screens/onboarding';
import { AvatarPage } from '@/screens/avatar';
import { WelcomePage } from '@/screens/welcome';
import { DisclosuresPage, PrivacyPage, TermsPage } from '@/screens/legal';

const publicPages: Record<string, ComponentType> = { '/privacy': PrivacyPage, '/terms': TermsPage, '/disclosures': DisclosuresPage };

const client = new QueryClient();

function NotFound() {
  return <div className="m-page"><EmptyState title="That page wandered off" body="Let's head back home." action={<a className="m-btn navy" href={import.meta.env.BASE_URL}>Go home</a>} /></div>;
}

function AppRoutes() {
  const auth = useAuth();
  const [path, setLocation] = useLocation();
  const plan = useGetBudgetPlan({ query: { enabled: auth.isAuthenticated, queryKey: getGetBudgetPlanQueryKey() } });
  useEffect(() => {
    if (!auth.isAuthenticated || plan.isLoading || plan.isError) return;
    if (publicPages[path]) return;
    if (!plan.data?.setupComplete && path !== '/onboarding') setLocation('/onboarding');
    if (plan.data?.setupComplete && path === '/onboarding') setLocation('/');
  }, [auth.isAuthenticated, plan.isLoading, plan.isError, plan.data, path, setLocation]);
  useEffect(() => { window.scrollTo(0, 0); }, [path]);
  // Legal pages are public so anyone (including Plaid and affiliate reviewers) can read them without signing in.
  const PublicPage = publicPages[path];
  if (PublicPage) return <PublicPage />;
  if (auth.isLoading) return <main className="m-loading"><Skeleton /></main>;
  if (!auth.isAuthenticated) return <WelcomePage />;
  return <Shell><ErrorBoundary resetKey={path}><Switch>
    <Route path="/" component={HomePage} />
    <Route path="/transactions" component={SpendingPage} />
    <Route path="/swaps" component={SwapsPage} />
    <Route path="/swaps/:id">{(params) => <SwapDetailPage id={decodeURIComponent(params.id)} />}</Route>
    <Route path="/admin/swaps" component={AdminSwapsPage} />
    <Route path="/earn-save" component={MoneyAppsPage} />
    <Route path="/onboarding" component={OnboardingPage} />
    <Route path="/receipts" component={ReceiptPage} />
    <Route path="/avatar" component={AvatarPage} />
    <Route path="/profile" component={SettingsPage} />
    <Route path="/settings" component={SettingsPage} />
    <Route component={NotFound} />
  </Switch></ErrorBoundary></Shell>;
}

export default function App() {
  return <QueryClientProvider client={client}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppRoutes /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
