import { type ComponentType, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useAuth, useClerk } from '@clerk/react';
import { ClerkProviderWithRoutes, ClerkQueryClientCacheInvalidator, SignInPage, SignUpPage } from '@/components/clerk-auth';
import { getGetBudgetPlanQueryKey, getGetSwapProfileQueryKey, useGetBudgetPlan, useGetSwapProfile } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EmptyState, Shell, Skeleton } from '@/components/margo/chrome';
import { HomePage } from '@/screens/home';
import { SpendingPage } from '@/screens/spending';
import { ReceiptPage } from '@/screens/receipts';
import { AdminSwapsPage, SwapDetailPage, SwapsPage } from '@/screens/swaps';
import { MoneyAppsPage } from '@/screens/money-apps';
import { PlaidOAuthPage, SettingsPage } from '@/screens/settings';
import { OnboardingPage } from '@/screens/onboarding';
import { AvatarPage } from '@/screens/avatar';
import { WelcomePage } from '@/screens/welcome';
import { RecapPage } from '@/screens/recap';
import { AGREEMENT_VERSION, AgreementPage } from '@/screens/agreement';
import { DisclosuresPage, PrivacyPage, TermsPage } from '@/screens/legal';

const publicPages: Record<string, ComponentType> = { '/privacy': PrivacyPage, '/terms': TermsPage, '/disclosures': DisclosuresPage };

const client = new QueryClient();

function NotFound() {
  return <div className="m-page"><EmptyState title="That page wandered off" body="Let's head back home." action={<a className="m-btn navy" href={import.meta.env.BASE_URL}>Go home</a>} /></div>;
}

function AppRoutes() {
  return <Switch>
    <Route path="/sign-in/*?" component={SignInPage} />
    <Route path="/sign-up/*?" component={SignUpPage} />
    <Route component={AuthenticatedRoutes} />
  </Switch>;
}

function AuthenticatedRoutes() {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const [path, setLocation] = useLocation();
  const plan = useGetBudgetPlan({ query: { enabled: isLoaded && isSignedIn, queryKey: getGetBudgetPlanQueryKey(), retry: false } });
  const profile = useGetSwapProfile({ query: { enabled: isLoaded && isSignedIn, queryKey: getGetSwapProfileQueryKey(), retry: false } });
  useEffect(() => {
    if (!isLoaded || !isSignedIn || plan.isLoading || plan.isError) return;
    if (publicPages[path] || path === '/plaid-oauth') return;
    if (!plan.data?.setupComplete && path !== '/onboarding') setLocation('/onboarding');
    if (plan.data?.setupComplete && path === '/onboarding') setLocation('/');
  }, [isLoaded, isSignedIn, plan.isLoading, plan.isError, plan.data, path, setLocation]);
  useEffect(() => { window.scrollTo(0, 0); }, [path]);
  // Legal pages are public so anyone (including Plaid and affiliate reviewers) can read them without signing in.
  const PublicPage = publicPages[path];
  if (PublicPage) return <PublicPage />;
  if (!isLoaded) return <main className="m-loading"><Skeleton /></main>;
  if (!isSignedIn) return <WelcomePage />;
  if (plan.isLoading) return <main className="m-loading"><Skeleton /></main>;
  if (plan.isError) return <main className="m-page"><EmptyState title="We couldn't open your account" body="Your sign-in worked, but your saved plan isn't available right now." action={<div className="m-stack"><button className="m-btn navy" onClick={() => void plan.refetch()}>Try again</button><button className="m-btn outline" onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })}>Sign out</button></div>} /></main>;
  // Everyone agrees to the basics once (and again if the agreement changes) before using the app.
  if (profile.data && profile.data.onboardingAnswers?.agreedVersion !== AGREEMENT_VERSION) return <AgreementPage profile={profile.data} />;
  return <Shell><ErrorBoundary resetKey={path}><Switch>
    <Route path="/" component={HomePage} />
    <Route path="/transactions" component={SpendingPage} />
    <Route path="/swaps" component={SwapsPage} />
    <Route path="/swaps/:id">{(params) => <SwapDetailPage id={decodeURIComponent(params.id)} />}</Route>
    <Route path="/admin/swaps" component={AdminSwapsPage} />
    <Route path="/earn-save" component={MoneyAppsPage} />
    <Route path="/onboarding" component={OnboardingPage} />
    <Route path="/receipts" component={ReceiptPage} />
    <Route path="/recap" component={RecapPage} />
    <Route path="/avatar" component={AvatarPage} />
    <Route path="/profile" component={SettingsPage} />
    <Route path="/settings" component={SettingsPage} />
    <Route path="/plaid-oauth" component={PlaidOAuthPage} />
    <Route component={NotFound} />
  </Switch></ErrorBoundary></Shell>;
}

export default function App() {
  return <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><ClerkProviderWithRoutes><QueryClientProvider client={client}><ClerkQueryClientCacheInvalidator /><TooltipProvider><AppRoutes /><Toaster /></TooltipProvider></QueryClientProvider></ClerkProviderWithRoutes></WouterRouter>;
}
