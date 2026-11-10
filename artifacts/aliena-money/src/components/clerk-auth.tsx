import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, Link } from 'wouter';

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#5A0F1A', colorForeground: '#0B1F4B',
    colorMutedForeground: '#4A5578', colorDanger: '#5A0F1A',
    colorBackground: '#FFFFFF', colorInput: '#FBF6E4',
    colorInputForeground: '#0B1F4B', colorNeutral: '#0B1F4B',
    fontFamily: '"DM Sans", sans-serif', borderRadius: '16px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: { color: '#0B1F4B', fontFamily: 'Fraunces, serif' },
    headerSubtitle: { color: '#4A5578' },
    socialButtonsBlockButtonText: { color: '#0B1F4B' },
    formFieldLabel: { color: '#0B1F4B' },
    footerActionLink: { color: '#5A0F1A' },
    footerActionText: { color: '#4A5578' },
    dividerText: { color: '#4A5578' },
    identityPreviewEditButton: { color: '#5A0F1A' },
    formFieldSuccessText: { color: '#6D712E' },
    alertText: { color: '#5A0F1A' },
    logoBox: { justifyContent: 'center' },
    logoImage: { height: '56px' },
    socialButtonsBlockButton: { borderColor: '#E8DFC4', background: '#FFFFFF' },
    formButtonPrimary: { background: '#5A0F1A', color: '#FFFFFF' },
    formFieldInput: { background: '#FBF6E4', color: '#0B1F4B' },
    footerAction: { background: '#FBF6E4' },
    dividerLine: { background: '#E8DFC4' },
    alert: { background: '#FBF6E4' },
    otpCodeFieldInput: { color: '#0B1F4B' },
    formFieldRow: { marginBottom: '16px' },
    main: { gap: '20px' },
  },
};

export function ClerkProviderWithRoutes({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    signInFallbackRedirectUrl={basePath || '/'}
    signUpFallbackRedirectUrl={basePath || '/'}
    localization={{
      signIn: { start: { title: 'Welcome back to Margo', subtitle: 'Sign in to your money plan' } },
      signUp: { start: { title: 'Make yourself at home', subtitle: 'Create your Margo account' } },
    }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >{children}</ClerkProvider>;
}

export function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) queryClient.clear();
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);
  return null;
}

export function SignInPage() {
  return <main className="m-auth"><Link href="/" className="m-link-button">Back to Margo</Link><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></main>;
}
export function SignUpPage() {
  return <main className="m-auth"><Link href="/" className="m-link-button">Back to Margo</Link><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></main>;
}
