import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useLocation, useSearch } from 'wouter';
import type { TrackedRecord } from '@workspace/api-client-react';
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Empty, ErrorState, PageHead, RowsSkeleton } from '@/components/bits';
import { ConfirmDelete, OutletEditor, WatchEditor } from '@/components/editors';
import { OutletBrand } from '@/components/outlet-brand';
import { Disclosure, JournalistRow } from '@/components/news-media/coverage';
import { byKind, fmtDate, toInput, useSave, useWorkspace } from '@/lib/workspace';
import { buildMediaCoverage, coverageAtOutlet, nameKey, sortJournalists, type JournalistCoverage, type JournalistSort } from '@/lib/media-coverage';

type Tab = 'all' | 'outlets' | 'journalists';
const TABS: Tab[] = ['all', 'outlets', 'journalists'];
const SORTS: [JournalistSort, string][] = [['last-name', 'Last name A–Z'], ['recent', 'Newest coverage'], ['items', 'Most items']];

export default function OutletsPage() {
  const { isSignedIn } = useAuth();
  const { data, isLoading, isError, refetch } = useWorkspace();
  const save = useSave();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? params.get('tab') as Tab : params.get('name') ? 'journalists' : 'all';
  const nameParam = params.get('name')?.trim() || '';
  const setParams = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) v === null ? p.delete(k) : p.set(k, v);
    const s = p.toString();
    navigate(`/outlets${s ? `?${s}` : ''}`, { replace: true });
  };

  const [q, setQ] = useState('');
  const [sort, setSort] = useState<JournalistSort>('last-name');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TrackedRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [watchEditing, setWatchEditing] = useState<TrackedRecord | null>(null);
  const [watchCreating, setWatchCreating] = useState(false);
  const [deleting, setDeleting] = useState<TrackedRecord | null>(null);
  const isOpen = (k: string) => open.has(k);
  const toggle = (k: string) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const outlets = useMemo(() => byKind(data?.records, 'outlet').sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9) || a.title.localeCompare(b.title)), [data]);
  const profiles = useMemo(() => buildMediaCoverage(data?.records ?? []), [data]);
  const sorted = useMemo(() => sortJournalists(profiles, sort), [profiles, sort]);
  const articleCount = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of byKind(data?.records, 'article')) if (a.outlet) {
      const k = nameKey(a.outlet); const s = m.get(k) ?? new Set<string>(); s.add(a.id); m.set(k, s);
    }
    return m;
  }, [data]);

  const nameMatches = (p: JournalistCoverage, n: string) => [p.name, p.watch?.title ?? '', ...p.aliases].some(v => v && nameKey(v) === nameKey(n));
  const focused = useMemo(() => nameParam ? profiles.find(p => nameMatches(p, nameParam))
    ?? profiles.find(p => [p.name, ...p.aliases].some(v => nameKey(v).includes(nameKey(nameParam)))) : undefined, [profiles, nameParam]);
  const autoOpened = useRef('');
  useEffect(() => {
    if (!nameParam) { autoOpened.current = ''; return; }
    if (focused && autoOpened.current !== focused.key) {
      autoOpened.current = focused.key;
      setOpen(s => new Set(s).add(`jt|j:${focused.key}`));
    }
  }, [focused, nameParam]);

  const ql = nameKey(q);
  const jMatch = (p: JournalistCoverage) => !ql || [p.name, p.watch?.title ?? '', ...p.aliases].some(v => nameKey(v).includes(ql));
  const oMatch = (o: TrackedRecord) => !ql || nameKey(o.title).includes(ql) || nameKey(o.feedUrl ?? '').includes(ql);
  const atOutlet = (o: TrackedRecord) => sortJournalists(profiles.filter(p => p.outlets.some(x => nameKey(x) === nameKey(o.title))).map(p => {
    const coverage = coverageAtOutlet(p, o.title);
    return { ...p, coverage, latest: Math.max(0, ...coverage.map(item => Date.parse(item.article.publishedAt ?? '') || 0)) };
  }), sort);
  const outletKeys = new Set(outlets.map(o => nameKey(o.title)));
  const unlinked = sorted.filter(p => !p.outlets.some(o => outletKeys.has(nameKey(o))));
  const tracked = profiles.filter(p => p.watch).length;
  const items = (o: TrackedRecord) => articleCount.get(nameKey(o.title))?.size ?? 0;

  const rowProps = { isOpen, toggle, signedIn: !!isSignedIn, onEdit: setWatchEditing, onDelete: setDeleting };
  const iconBtn = 'p-1.5 text-muted-foreground hover:text-foreground';
  const outletActions = (o: TrackedRecord) => isSignedIn && <div className="flex justify-end opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
    <button aria-label={`Edit ${o.title}`} onClick={() => setEditing(o)} className={iconBtn} data-testid={`button-edit-outlet-${o.id}`}><Pencil className="h-3.5 w-3.5" /></button>
    <button aria-label={`Delete ${o.title}`} onClick={() => setDeleting(o)} className="p-1.5 text-muted-foreground hover:text-destructive" data-testid={`button-delete-outlet-${o.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
  </div>;
  const outletSwitch = (o: TrackedRecord) => <Switch aria-label={`Polling ${o.title}`} checked={o.enabled !== false} disabled={!isSignedIn || save.isPending}
    onCheckedChange={(v) => save.mutate({ data: { ...toInput(o), enabled: v } })} data-testid={`switch-outlet-${o.id}`} />;
  const status = (o: TrackedRecord) => {
    const failed = o.feedStatus && /fail|error/i.test(o.feedStatus);
    return <span className={cn('font-mono text-[11px]', failed ? 'text-destructive' : 'text-muted-foreground')}>{o.feedStatus || '—'}</span>;
  };
  const siteLink = (o: TrackedRecord) => o.url && <a href={o.url} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-muted-foreground hover:underline">site</a>;

  function journalistList(list: JournalistCoverage[], scope: string, outlet?: string) {
    if (!list.length) return <p className="border-t border-border px-4 py-2.5 font-mono text-[11px] text-muted-foreground">No journalists recorded.</p>;
    return <ul className="divide-y divide-border border-t border-border">{list.map(p => <JournalistRow key={p.key} profile={p} outlet={outlet} scope={scope} showOutlets={!outlet} {...rowProps} />)}</ul>;
  }

  function outletGroup(o: TrackedRecord, scope: string) {
    const js = atOutlet(o).filter(p => oMatch(o) || jMatch(p));
    const key = `${scope}|o:${o.id}`;
    const isO = isOpen(key);
    return <section key={o.id} className={cn('group rounded-md border border-border bg-card', o.enabled === false && 'opacity-60')} data-testid={`group-outlet-${o.id}`}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <Disclosure open={isO} onToggle={() => toggle(key)} label={o.title} id={`nm-${key.replace(/[^a-z0-9]+/gi, '-')}`}>
          <OutletBrand name={o.title} variant="wordmark" />
        </Disclosure>
        <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
          {o.tier && <span>Tier {o.tier}</span>}{status(o)}<span>{fmtDate(o.lastChecked, true)}</span>
          <span className="text-foreground" data-testid={`text-outlet-items-${o.id}`}>{items(o)} items</span>
          <span>{js.length} journalists · {js.filter(p => p.watch).length} tracked</span>
          {scope === 'ot' && o.feedUrl && <span className="max-w-[260px] truncate" title={o.feedUrl}>{o.feedUrl}</span>}
          {siteLink(o)}
        </div>
        {outletSwitch(o)}
        <div className="w-16">{outletActions(o)}</div>
      </div>
      {isO && <div id={`nm-${key.replace(/[^a-z0-9]+/gi, '-')}`}>
        {journalistList(js.filter(p => coverageAtOutlet(p, o.title).length || p.watch), key, o.title)}
      </div>}
    </section>;
  }

  function allView() {
    const shown = outlets.filter(o => oMatch(o) || atOutlet(o).some(jMatch));
    const loose = unlinked.filter(jMatch);
    if (!shown.length && !loose.length) return <Empty title="No matches" />;
    const lk = 'at|o:none';
    return <div className="space-y-3 px-5 py-5 md:px-8">
      {shown.map(o => outletGroup(o, 'at'))}
      {loose.length > 0 && <section className="rounded-md border border-dashed border-border">
        <div className="px-4 py-2.5">
          <Disclosure open={isOpen(lk)} onToggle={() => toggle(lk)} label="No configured outlet" id="nm-at-o-none">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">No configured outlet · {loose.length}</span>
          </Disclosure>
        </div>
        {isOpen(lk) && <div id="nm-at-o-none">{journalistList(loose, lk)}</div>}
      </section>}
    </div>;
  }

  function outletsView() {
    const shown = outlets.filter(o => oMatch(o) || atOutlet(o).some(jMatch));
    if (!shown.length) return <Empty title={outlets.length ? 'No matches' : 'No outlets configured'} />;
    return <div className="space-y-3 px-5 py-5 md:px-8">{shown.map(o => outletGroup(o, 'ot'))}</div>;
  }

  function journalistsView() {
    const shown = focused ? [focused] : sorted.filter(jMatch);
    if (nameParam && !focused) return <Empty title={`No profile for “${nameParam}”`} />;
    if (!shown.length) return <Empty title={profiles.length ? 'No matches' : 'No journalists recorded'} />;
    return <div className="px-5 py-5 md:px-8">
      <div className="flex items-center gap-3 px-3 pb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="flex-1 pl-5">Name</span><span className="hidden sm:inline">Outlets</span><span className="w-10 text-right">Items</span><span className="w-14" />
      </div>
      <ul className="divide-y divide-border rounded-md border border-border bg-card">
        {shown.map(p => <JournalistRow key={p.key} profile={p} scope="jt" showOutlets {...rowProps} />)}
      </ul>
    </div>;
  }

  const tabs: [Tab, string, number][] = [['all', 'All', outlets.length + profiles.length], ['outlets', 'Outlets', outlets.length], ['journalists', 'Journalists', profiles.length]];

  return (
    <div className="tw-rise">
      <PageHead title="News Media" count={outlets.length}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter" aria-label="Filter outlets and journalists" className="h-8 w-40 bg-card pl-8 text-sm" data-testid="input-media-search" />
        </div>
        {isSignedIn && <>
          <button onClick={() => setWatchCreating(true)} data-testid="button-add-journalist" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-secondary"><Plus className="h-3.5 w-3.5" /> Journalist</button>
          <button onClick={() => setCreating(true)} data-testid="button-add-outlet" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> Outlet</button>
        </>}
      </PageHead>
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-5 py-2.5 md:px-8">
        {tabs.map(([t, label, n]) => <button key={t} onClick={() => setParams({ tab: t, name: null })} aria-pressed={tab === t} data-testid={`tab-media-${t}`} className={cn('h-7 rounded-md px-2.5 font-mono text-[11px] uppercase tracking-wider', tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}>
          {label} <span className="opacity-60">{n}</span>
        </button>)}
        {nameParam && <button onClick={() => setParams({ name: null })} data-testid="button-clear-name" className="ml-2 inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-mono text-[11px]">
          {focused?.name ?? nameParam} <X className="h-3 w-3" aria-label="Clear profile filter" />
        </button>}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {tab !== 'outlets' && <div className="flex items-center gap-1" role="group" aria-label="Sort journalists">
            {SORTS.map(([s, l]) => <button key={s} onClick={() => setSort(s)} aria-pressed={sort === s} data-testid={`button-sort-${s}`}
              className={cn('h-6 rounded px-1.5 font-mono text-[10px] uppercase tracking-wider', sort === s ? 'text-foreground underline underline-offset-4' : 'text-muted-foreground hover:text-foreground')}>{l}</button>)}
          </div>}
          {open.size > 0 && <button onClick={() => setOpen(new Set())} data-testid="button-collapse-all" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground">Collapse all</button>}
          {tab !== 'outlets' && <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{tracked} tracked · {profiles.length - tracked} bylines</span>}
        </div>
      </div>
      {isLoading ? <RowsSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} /> : tab === 'all' ? (outlets.length || profiles.length ? allView() : <Empty title="No outlets configured" />) : tab === 'outlets' ? outletsView() : journalistsView()}
      <OutletEditor open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }} record={editing} />
      <WatchEditor open={watchCreating || !!watchEditing} onOpenChange={(o) => { if (!o) { setWatchCreating(false); setWatchEditing(null); } }} record={watchEditing} initialWatchType="journalist" />
      <ConfirmDelete target={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
