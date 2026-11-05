import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Show, UserButton } from '@clerk/react';
import { Bookmark, Crosshair, GitBranch, Newspaper, RefreshCw, Rss } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDate, useRefresh, useWorkspace } from '@/lib/workspace';

const NAV = [
  { href: '/feed', label: 'Feed', icon: Newspaper, publicHref: '/' },
  { href: '/claims', label: 'Claims', icon: GitBranch },
  { href: '/watchlist', label: 'Watchlist', icon: Crosshair },
  { href: '/outlets', label: 'News Media', icon: Rss },
  { href: '/saved', label: 'Saved', icon: Bookmark },
];

function Mark() {
  return (
    <svg viewBox="0 0 64 64" className="h-7 w-7 shrink-0" aria-hidden>
      <rect width="64" height="64" rx="10" fill="hsl(0 0% 16%)" />
      <path d="M8 40h14l6-16 8 26 6-14h14" fill="none" stroke="hsl(0 0% 94%)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="42" cy="36" r="4.5" fill="white" />
    </svg>
  );
}

export function Shell({ children, signedIn }: { children: ReactNode; signedIn: boolean }) {
  const [loc] = useLocation();
  const { data } = useWorkspace();
  const refresh = useRefresh();
  const stats = data?.stats;

  return (
    <div className="flex min-h-[100dvh] flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-[100dvh] md:w-56">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <Mark />
          <span className="font-display text-2xl font-semibold uppercase tracking-widest text-sidebar-accent-foreground">Tripwire</span>
        </div>
        <nav className="flex gap-0.5 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {NAV.map(({ href, label, icon: Icon, publicHref }) => {
            const target = !signedIn && publicHref ? publicHref : href;
            const active = loc === href || (publicHref && loc === publicHref);
            return (
              <Link
                key={href}
                href={target}
                data-testid={`link-nav-${label.toLowerCase()}`}
                className={cn(
                  'group flex items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                )}
              >
                <Icon className={cn('h-4 w-4', active ? 'text-sidebar-primary' : 'opacity-60')} />
                {label}
              </Link>
            );
          })}
        </nav>
        {stats && (
          <dl className="mx-4 mt-4 hidden grid-cols-2 gap-x-3 gap-y-2 border-t border-sidebar-border pt-4 font-mono text-[11px] md:grid">
            {([['articles', stats.articles], ['claims', stats.claims], ['original', stats.original], ['journalists', stats.journalists], ['negative', stats.negative], ['positive', stats.positive]] as const).map(([k, v]) => (
              <div key={k} data-testid={`stat-${k}`}>
                <dt className="uppercase tracking-wider opacity-50">{k}</dt>
                <dd className="text-sm text-sidebar-accent-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="mt-auto hidden border-t border-sidebar-border p-4 md:block">
          <button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            data-testid="button-refresh-feeds"
            className="flex w-full items-center justify-center gap-2 rounded-md bg-sidebar-primary px-3 py-2 text-xs font-medium text-sidebar-primary-foreground transition-opacity disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refresh.isPending && 'animate-spin')} />
            {refresh.isPending ? 'Checking feeds' : 'Refresh feeds'}
          </button>
          <p className="mt-2 text-center font-mono text-[10px] opacity-50" data-testid="text-last-refreshed">
            {data?.lastRefreshed ? fmtDate(data.lastRefreshed, true) : 'Never refreshed'}
          </p>
          <div className="mt-3 flex items-center justify-between">
            <Show when="signed-in">
              <UserButton />
            </Show>
          </div>
        </div>
      </aside>
      <main className="tw-waves min-w-0 flex-1" style={{ ['--tw-waves-url' as string]: `url(${import.meta.env.BASE_URL}workspace-waves.webp)` }}>
        <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-2 md:hidden">
          <button onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="button-refresh-mobile" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs text-accent-foreground">
            <RefreshCw className={cn('h-3.5 w-3.5', refresh.isPending && 'animate-spin')} /> Refresh
          </button>
          <Show when="signed-in"><UserButton /></Show>
        </div>
        {children}
      </main>
    </div>
  );
}
