import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetXFeedsQueryKey, useGetXFeeds, useRefreshXFeeds, useUpdateXFeed, type TrackedRecord, type XAccount } from '@workspace/api-client-react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Empty, RowsSkeleton } from '@/components/bits';
import { OutletBrand } from '@/components/outlet-brand';
import { Disclosure } from '@/components/news-media/coverage';
import { XAccountAvatar } from '@/components/news-media/x-account-avatar';
import { byKind, errText, fmtDate, useInvalidateWorkspace } from '@/lib/workspace';
import { useToast } from '@/hooks/use-toast';

const norm = (h?: string) => (h ?? '').trim().toLowerCase().replace(/^@/, '');
const handleFromUrl = (u?: string) => norm(u?.match(/(?:x|twitter)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})/i)?.[1]);
const postTime = (p: TrackedRecord) => Date.parse(p.publishedAt ?? p.xPost?.capturedAt ?? p.createdAt) || 0;

export function XFeedsView({ outlets, records, q, signedIn }: { outlets: TrackedRecord[]; records: TrackedRecord[]; q: string; signedIn: boolean }) {
  const { data, isLoading, isError, error, refetch } = useGetXFeeds({ query: { queryKey: getGetXFeedsQueryKey(), refetchInterval: 60_000 } });
  const qc = useQueryClient();
  const invalidateWs = useInvalidateWorkspace();
  const { toast } = useToast();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = (k: string) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const done = () => Promise.all([invalidateWs(), qc.invalidateQueries({ queryKey: getGetXFeedsQueryKey() })]);
  const refresh = useRefreshXFeeds({ mutation: {
    onSuccess: (result) => { done(); toast({ title: result.status === 'ready' ? 'X check finished' : 'X collection deferred', description: result.message }); },
    onError: (e: unknown) => toast({ title: 'X refresh failed', description: errText(e), variant: 'destructive' }),
    onSettled: () => setBusy(null),
  } });
  const update = useUpdateXFeed({ mutation: {
    onSuccess: () => { done(); },
    onError: (e: unknown) => toast({ title: 'X account update failed', description: errText(e), variant: 'destructive' }),
  } });

  const accounts = data?.accounts ?? [];
  const posts = useMemo(() => byKind(records, 'article').filter(r => r.xPost || r.sourceType === 'x'), [records]);
  const postsFor = useMemo(() => {
    const m = new Map<string, TrackedRecord[]>();
    for (const a of accounts) {
      const h = norm(a.handle) || handleFromUrl(a.url);
      m.set(a.id, posts.filter(p => p.xPost?.watchId === a.id || (!!h && (norm(p.xPost?.handle) === h || handleFromUrl(p.url) === h)))
        .sort((x, y) => postTime(y) - postTime(x)));
    }
    return m;
  }, [accounts, posts]);

  if (isLoading) return <RowsSkeleton />;
  if (isError || !data) return <Empty title="X feeds could not load">
    <p className="font-mono text-[11px] text-muted-foreground">{errText(error)}</p>
    <button onClick={() => refetch()} data-testid="button-retry-x" className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">Retry</button>
  </Empty>;

  const ql = q.trim().toLowerCase();
  const setupRequired = ['setup-required', 'trial-ended', 'trial-budget-limited'].includes(data.status);
  const doRefresh = (id: string) => { setBusy(id); refresh.mutate(); };
  const groups = outlets.map(o => ({ o, list: accounts.filter(a => a.outletId === o.id || (!a.outletId && a.outlet === o.title)) })).filter(g => g.list.length);
  const orphans = accounts.filter(a => !outlets.some(o => o.id === a.outletId || o.title === a.outlet));
  const acctMatch = (a: XAccount, oTitle: string) => !ql || [oTitle, a.handle, a.outlet, a.name ?? ''].some(v => v.toLowerCase().includes(ql));
  const postMatch = (p: TrackedRecord) => !ql || [p.title, p.summary ?? '', p.fullText ?? '', p.xPost?.handle ?? ''].some(v => v.toLowerCase().includes(ql));

  function accountRow(a: XAccount, oTitle: string) {
    const all = postsFor.get(a.id) ?? [];
    const shown = acctMatch(a, oTitle) ? all : all.filter(postMatch);
    if (ql && !acctMatch(a, oTitle) && !shown.length) return null;
    const key = `x:${a.id}`; const isO = open.has(key) || (!!ql && shown.length > 0);
    const failed = ['unavailable', 'access-denied', 'invalid-response', 'account-unavailable', 'catch-up-limited', 'public-blocked', 'public-unreadable'].includes(a.status);
    return <li key={a.id} className={cn(!a.enabled && 'opacity-60')} data-testid={`row-x-account-${a.id}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
        <Disclosure open={isO} onToggle={() => toggle(key)} label={a.accountType === 'reporter' && a.name ? `${a.name} @${a.handle}` : `@${a.handle}`} id={`nm-x-${a.id}`} className="min-w-[160px] flex-1">
          <XAccountAvatar account={a} />
          <span className="min-w-0">
            {a.accountType === 'reporter' && a.name && <span className="block truncate font-medium" data-testid={`text-x-name-${a.id}`}>{a.name}</span>}
            <span className={cn('block truncate', a.accountType === 'reporter' ? 'font-mono text-[10px] text-muted-foreground' : 'font-medium')} data-testid={`text-x-handle-${a.id}`}>@{a.handle}</span>
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">{all.length} posts</span>
        </Disclosure>
        <div className="flex flex-wrap items-center gap-x-3 font-mono text-[11px] text-muted-foreground">
          {a.accountType === 'reporter' && a.name && <Link href={`/outlets?tab=journalists&name=${encodeURIComponent(a.name)}`} className="underline" data-testid={`link-x-profile-${a.id}`}>Journalist profile</Link>}
          <span className={failed ? 'text-destructive' : ''} data-testid={`status-x-${a.id}`} title={a.message}>{a.status === 'outside-trial' ? 'paused for trial' : a.status === 'outside-scope' ? 'paused' : a.enabled ? a.status : 'paused'}</span>
          <span title="Last checked">checked {fmtDate(a.lastChecked, true)}</span>
          {a.lastSuccess && <span title="Last successful collection">success {fmtDate(a.lastSuccess, true)}</span>}
          {a.enabled && a.nextCheck && <span className="hidden md:inline">next {fmtDate(a.nextCheck, true)}</span>}
          <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:underline" data-testid={`link-x-account-${a.id}`}>x.com <ArrowUpRight className="h-3 w-3" /></a>
        </div>
        <Switch aria-label={`${a.enabled ? 'Pause' : 'Resume'} @${a.handle}`} checked={a.enabled} disabled={!signedIn || update.isPending || ['outside-trial', 'outside-scope'].includes(a.status)}
          onCheckedChange={v => update.mutate({ id: a.id, data: { enabled: v } })} data-testid={`switch-x-${a.id}`} />
      </div>
      {a.message && failed && <p className="px-8 pb-1.5 font-mono text-[10px] text-destructive">{a.message}</p>}
      {isO && <div id={`nm-x-${a.id}`} className="border-t border-border bg-background/40 pl-6">
        {shown.length ? <ul className="divide-y divide-border">{shown.map(p => <li key={p.id} className="px-3 py-2" data-testid={`row-x-post-${p.id}`}>
          <p className="line-clamp-3 text-sm leading-snug">{p.summary?.trim() || p.fullText?.trim() || p.title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="normal-case tracking-normal text-foreground">@{p.xPost?.handle ?? a.handle}</span>
            <span>{p.publishedAt ? fmtDate(p.publishedAt, true) : 'Publication unknown'}</span>
            {!!p.xPost?.references.length && <span>{p.xPost.references.map(r => r.type).join(' / ')}</span>}
            {!p.xPost && <span>manual import</span>}
            <Link href={`/?article=${encodeURIComponent(p.id)}`} className="normal-case tracking-normal underline" data-testid={`link-x-reader-${p.id}`}>Reader</Link>
            {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 normal-case tracking-normal hover:underline" data-testid={`link-x-post-${p.id}`}>On X <ArrowUpRight className="h-3 w-3" /></a>}
          </div>
        </li>)}</ul> : <p className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">No posts captured.</p>}
      </div>}
    </li>;
  }

  function group(key: string, title: string, list: XAccount[], brand: boolean) {
    const rows = list.map(a => accountRow(a, title)).filter(Boolean);
    if (ql && !rows.length && !title.toLowerCase().includes(ql)) return null;
    return <section key={key} className="rounded-md border border-border bg-card" data-testid={`group-x-${key}`}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Disclosure open={!closedGroups.has(key) || !!ql} onToggle={() => setClosedGroups(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; })} label={title} id={`x-group-${key}`}>
        {brand ? <OutletBrand name={title} variant="wordmark" /> : <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{title}</span>}
        </Disclosure>
        <span className="font-mono text-[11px] text-muted-foreground">{list.length} accounts</span>
      </div>
      {(!closedGroups.has(key) || !!ql) && <div id={`x-group-${key}`}>{rows.length ? <ul className="divide-y divide-border border-t border-border">{rows}</ul>
        : <p className="border-t border-border px-4 py-2.5 font-mono text-[11px] text-muted-foreground">No X accounts configured.</p>}</div>}
    </section>;
  }

  const rendered = [...groups.map(({ o, list }) => group(o.id, o.title, list, true)), orphans.length ? group('none', 'No configured outlet', orphans, false) : null].filter(Boolean);

  return <div className="space-y-3 px-5 py-5 md:px-8">
    {data.mode === 'public-page' && <section className="space-y-1 rounded-md border border-border bg-card px-4 py-3 text-xs" data-testid="panel-x-public">
      <h2 className="font-medium">Public X collection · no paid X API</h2>
      <p className="text-muted-foreground">28 reporter accounts · outlet accounts paused · checks every {data.intervalMinutes} minutes while this server runs.</p>
      <p className="text-muted-foreground">Best-effort samples of up to 20 visible posts per account, not complete timeline coverage. X may omit posts, require a login or change its page format. Blocked or unreadable pages are reported; no login bypass is used.</p>
    </section>}
    {data.trial && <section className="space-y-2 rounded-md border border-border bg-card px-4 py-3 text-xs" data-testid="panel-x-trial">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2 className="font-medium">{data.trial.days}-day reporter trial · ${data.trial.budgetUsd.toFixed(2)} maximum</h2>
        <span className="font-mono text-[10px] uppercase text-muted-foreground">{data.trial.phase}</span>
      </div>
      <p className="text-muted-foreground">Up to 28 reporter accounts · outlet accounts paused · at least 30 minutes between checks · no automatic renewal.</p>
      {data.trial.endsAt
        ? <p>Automatic stop: {fmtDate(data.trial.endsAt, true)}. The deadline and allowance survive server restarts.</p>
        : <p>The seven-day clock starts with the first authorized API request, not while setup is pending.</p>}
      {(!data.trial.credentialsConfigured || !data.trial.providerLimitConfirmed) && <p className="text-muted-foreground">
        Setup pending: {!data.trial.credentialsConfigured && 'server-side X bearer token'}
        {!data.trial.credentialsConfigured && !data.trial.providerLimitConfirmed && ' and '}
        {!data.trial.providerLimitConfirmed && 'confirmation of the $25 X billing-cycle limit with auto-recharge off'}.
        {' '}<a href="https://console.x.com" target="_blank" rel="noreferrer" className="underline">X Developer Console</a>
      </p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
        <span>{data.trial.postsReturned} post resources returned</span>
        <span>{data.trial.usersReturned} user resources returned</span>
        <span>${data.trial.estimatedUsd.toFixed(2)} estimated returned usage</span>
        <span>${data.trial.reservedUsd.toFixed(2)} committed incl. uncertainty</span>
        <span>{data.trial.unreconciledRequests} unreconciled requests</span>
      </div>
      <p className="text-[11px] text-muted-foreground">Estimates include expanded resources and do not assume billing deduplication. Empty successful checks release unused reservations; failures retain them. X’s console is the billing authority. Hosting is separate; collection only runs while this server runs.</p>
    </section>}
    <div className={cn('rounded-md border px-4 py-2.5 font-mono text-[11px]', setupRequired ? 'border-dashed border-input' : 'border-border bg-card')} data-testid="status-x-feeds">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className={cn('uppercase tracking-wider', setupRequired ? 'text-destructive' : 'text-foreground')}>{data.status}</span>
        <span className="text-muted-foreground">every {data.intervalMinutes} min</span>
        <span className="text-muted-foreground">{data.requestsUsed}{data.requestLimit != null && ` / ${data.requestLimit}`} requests</span>
        <span className="text-muted-foreground">{data.postsReserved}{data.postLimit != null && ` / ${data.postLimit}`} daily {data.mode === 'public-page' ? 'post samples incl. pending requests' : 'post units incl. unsettled reservations'}</span>
        <button disabled={!signedIn || refresh.isPending || setupRequired} onClick={() => doRefresh('all')} data-testid="button-refresh-x-all"
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[11px] hover:bg-secondary disabled:opacity-40">
          <RefreshCw className={cn('h-3 w-3', busy === 'all' && 'animate-spin')} /> Check now
        </button>
      </div>
      {data.message && <p className="mt-1 text-muted-foreground">{data.message}</p>}
    </div>
    {rendered.length ? rendered : <Empty title={ql ? 'No matches' : 'No outlets configured'} />}
  </div>;
}
