import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Shell } from '@/components/shell';
import FeedPage from '@/pages/feed';
import ClaimsPage from '@/pages/claims';
import JournalistsPage from '@/pages/journalists';
import WatchlistPage from '@/pages/watchlist';
import OutletsPage from '@/pages/outlets';
import DashboardPage from '@/pages/dashboard';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function WorkspaceRoutes() {
  const [location] = useLocation();
  return (
    <Shell signedIn>
      <ErrorBoundary resetKey={location}>
        <Switch>
          <Route path="/">{() => <FeedPage mode="feed" />}</Route>
          <Route path="/feed">{() => <FeedPage mode="feed" />}</Route>
          <Route path="/claims" component={ClaimsPage} />
          <Route path="/journalists" component={JournalistsPage} />
          <Route path="/watchlist" component={WatchlistPage} />
          <Route path="/outlets" component={OutletsPage} />
          <Route path="/dashboard" component={DashboardPage} />
          <Route path="/saved"><Redirect to="/?flagged=1" /></Route>
          <Route path="/sign-in/*?"><Redirect to="/" /></Route>
          <Route path="/sign-up/*?"><Redirect to="/" /></Route>
          <Route component={NotFound} />
        </Switch>
      </ErrorBoundary>
    </Shell>
  );
}
export default function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider><WorkspaceRoutes /><Toaster /></TooltipProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}
