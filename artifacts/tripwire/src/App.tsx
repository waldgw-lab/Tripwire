import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Shell } from '@/components/shell';
import FeedPage from '@/pages/feed';
import ClaimsPage from '@/pages/claims';
import JournalistsPage from '@/pages/journalists';
import WatchlistPage from '@/pages/watchlist';
import OutletsPage from '@/pages/outlets';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(0 0% 9%)',
    colorForeground: 'hsl(0 0% 8%)',
    colorMutedForeground: 'hsl(0 0% 40%)',
    colorDanger: 'hsl(0 62% 42%)',
    colorBackground: 'hsl(0 0% 100%)',
    colorInput: 'hsl(0 0% 100%)',
    colorInputForeground: 'hsl(0 0% 8%)',
    colorNeutral: 'hsl(0 0% 8%)',
    fontFamily: "'Inter', sans-serif",
    borderRadius: '0.375rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-lg w-[420px] max-w-full overflow-hidden border border-neutral-200 shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: "text-neutral-950 font-['Rajdhani'] text-3xl font-semibold",
    headerSubtitle: 'text-neutral-600',
    socialButtonsBlockButtonText: 'text-neutral-950',
    formFieldLabel: 'text-neutral-950 text-xs',
    footerActionLink: 'text-neutral-950 font-medium underline',
    footerActionText: 'text-neutral-600',
    dividerText: 'text-neutral-600',
    identityPreviewEditButton: 'text-neutral-950',
    formFieldSuccessText: 'text-[hsl(152_30%_30%)]',
    alertText: 'text-neutral-950',
    logoBox: 'h-10',
    logoImage: 'h-10 w-10',
    socialButtonsBlockButton: 'border border-neutral-300 bg-white',
    formButtonPrimary: 'bg-neutral-950 text-white',
    formFieldInput: 'border border-neutral-300 bg-white',
    footerAction: 'bg-transparent',
    dividerLine: 'bg-neutral-200',
    alert: 'border border-neutral-200 bg-neutral-100',
    otpCodeFieldInput: 'border border-neutral-300',
    formFieldRow: 'gap-3',
    main: 'gap-5',
  },
};

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="tw-grid-bg flex min-h-[100dvh] flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      {children}
    </div>
  );
}

function SignInPage() {
  return (
    <AuthFrame>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthFrame>
  );
}

function SignUpPage() {
  return (
    <AuthFrame>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthFrame>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/feed" /></Show>
      <Show when="signed-out"><FeedPage mode="public" /></Show>
    </>
  );
}

function SignedFeed() {
  return (
    <>
      <Show when="signed-in"><FeedPage mode="feed" /></Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAuth();
  const [location] = useLocation();
  return (
    <Shell signedIn={!!isSignedIn}>
      <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>
    </Shell>
  );
}

function Router() {
  const [location] = useLocation();
  if (location.startsWith('/sign-in') || location.startsWith('/sign-up')) {
    return (
      <Switch>
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
      </Switch>
    );
  }
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/feed" component={SignedFeed} />
        <Route path="/claims" component={ClaimsPage} />
        <Route path="/journalists" component={JournalistsPage} />
        <Route path="/watchlist" component={WatchlistPage} />
        <Route path="/outlets" component={OutletsPage} />
        <Route path="/saved">{() => <FeedPage mode="saved" />}</Route>
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Tripwire', subtitle: 'Sign in to your workbench' } },
        signUp: { start: { title: 'Tripwire', subtitle: 'Create your workbench account' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
