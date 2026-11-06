import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronLeft, ChevronRight, Network, Flag, GitBranch, LayoutDashboard, Newspaper, RefreshCw, Rss } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDate, useRefresh, useWorkspace } from '@/lib/workspace';

const NAV = [
  { href: '/feed', label: 'Feed', icon: Newspaper, publicHref: '/' },
  { href: '/claims', label: 'Claims', icon: GitBranch },
  { href: '/watchlist', label: 'Coverage', icon: Network },
  { href: '/outlets', label: 'News Media', icon: Rss },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
];

export function Shell({ children, signedIn }: { children: ReactNode; signedIn: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [loc] = useLocation();
  const { data } = useWorkspace();
  const refresh = useRefresh();
  const stats = data?.stats;

  return (
    <div className="flex min-h-[100dvh] flex-col md:flex-row">
      <aside className={cn('relative flex shrink-0 flex-col bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-[100dvh] md:transition-[width] md:duration-200', collapsed ? 'md:w-[72px]' : 'md:w-56')}>
        <div className={cn('flex h-20 items-center gap-2 px-3 py-4', collapsed && 'md:h-auto md:flex-col md:justify-center md:px-2')}>
          <img src={`${import.meta.env.BASE_URL}tripwire-wordmark-white.png`} alt="Tripwire" className={cn('h-12 w-[156px] max-w-full object-contain object-left', collapsed && 'md:hidden')} />
          {collapsed && <img src={`${import.meta.env.BASE_URL}tripwire-mark-white.png`} alt="Tripwire" className="hidden h-11 w-11 object-contain md:block" />}
          <button onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed} aria-controls="primary-navigation" data-testid="button-toggle-sidebar"
            className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md border border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 md:flex">
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        </div>
        <nav id="primary-navigation" aria-label="Main navigation" className="flex gap-0.5 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {NAV.map(({ href, label, icon: Icon, publicHref }) => {
            const target = !signedIn && publicHref ? publicHref : href;
            const active = loc === href || (publicHref && loc === publicHref);
            return (
              <Link
                key={href}
                href={target}
                title={label}
                data-testid={`link-nav-${label.toLowerCase()}`}
                className={cn(
                  'group flex items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  collapsed && 'md:justify-center md:py-2.5',
                  active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                )}
              >
                <Icon className={cn('h-4 w-4', active ? 'text-sidebar-primary' : 'opacity-60')} />
                <span className={cn(collapsed && 'md:sr-only')}>{label}</span>
              </Link>
            );
          })}
        </nav>
        {stats && collapsed && (
          <Link href="/?flagged=1" title={`${stats.flagged ?? 0} flagged`} aria-label={`${stats.flagged ?? 0} flagged articles`} data-testid="stat-flagged-collapsed"
            className="mx-auto mt-3 hidden flex-col items-center gap-0.5 rounded-md px-2 py-1.5 font-mono text-[11px] hover:bg-sidebar-accent/60 md:flex">
            <Flag className="h-4 w-4 opacity-70" /><span>{stats.flagged ?? 0}</span>
          </Link>
        )}
        {stats && !collapsed && (
          <dl className="mx-4 mt-4 hidden grid-cols-2 gap-x-3 gap-y-2 border-t border-sidebar-border pt-4 font-mono text-[11px] md:grid">
            {([['articles', stats.articles], ['claims', stats.claims], ['original', stats.original], ['journalists', stats.journalists], ['negative', stats.negative], ['positive', stats.positive], ['flagged', stats.flagged ?? 0]] as const).map(([k, v]) => (
              <div key={k} data-testid={`stat-${k}`}>
                <dt className="uppercase tracking-wider opacity-50">{k}</dt>
                <dd className="text-sm text-sidebar-accent-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className={cn('mt-auto hidden border-t border-sidebar-border p-4 md:block', collapsed && 'md:p-3')}>
          <button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            data-testid="button-refresh-feeds"
            aria-label={refresh.isPending ? 'Checking feeds' : 'Refresh feeds'}
            title={refresh.isPending ? 'Checking feeds' : 'Refresh feeds'}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-sidebar-primary px-3 py-2 text-xs font-medium text-sidebar-primary-foreground transition-opacity disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refresh.isPending && 'animate-spin')} />
            <span className={cn(collapsed && 'md:sr-only')}>{refresh.isPending ? 'Checking feeds' : 'Refresh feeds'}</span>
          </button>
          <p className={cn('mt-2 text-center font-mono text-[10px] opacity-50', collapsed && 'md:hidden')} data-testid="text-last-refreshed">
            {data?.lastRefreshed ? fmtDate(data.lastRefreshed, true) : 'Never refreshed'}
          </p>
        </div>
      </aside>
      <main className="tw-waves min-w-0 flex-1" style={{ ['--tw-waves-url' as string]: `url(${import.meta.env.BASE_URL}workspace-waves.webp)` }}>
        <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-2 md:hidden">
          <button onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="button-refresh-mobile" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs text-accent-foreground">
            <RefreshCw className={cn('h-3.5 w-3.5', refresh.isPending && 'animate-spin')} /> Refresh
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}
