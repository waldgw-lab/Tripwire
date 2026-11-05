import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import { Link } from 'wouter';
import type { TrackedRecord } from '@workspace/api-client-react';
import { ArrowUpRight, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Empty, ErrorState, PageHead, RowsSkeleton } from '@/components/bits';
import { ConfirmDelete, OutletEditor, WatchEditor } from '@/components/editors';
import { OutletBrand } from '@/components/outlet-brand';
import { byKind, fmtDate, toInput, useSave, useWorkspace } from '@/lib/workspace';

type Journo = { key: string; name: string; outlet?: string; watch?: TrackedRecord; articles: number };
type Tab = 'all' | 'outlets' | 'journalists';
const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();

export default function OutletsPage() {
  const { isSignedIn } = useAuth();
  const { data, isLoading, isError, refetch } = useWorkspace();
  const save = useSave();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<TrackedRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [watchEditing, setWatchEditing] = useState<TrackedRecord | null>(null);
  const [watchCreating, setWatchCreating] = useState(false);
  const [deleting, setDeleting] = useState<TrackedRecord | null>(null);

  const outlets = useMemo(() => byKind(data?.records, 'outlet').sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9) || a.title.localeCompare(b.title)), [data]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of byKind(data?.records, 'article')) if (a.outlet) m.set(norm(a.outlet), (m.get(norm(a.outlet)) ?? 0) + 1);
    return m;
  }, [data]);

  const journalists = useMemo(() => {
    const watches = byKind(data?.records, 'watch').filter(w => w.watchType === 'journalist');
    const alias = new Map<string, string>();
    const map = new Map<string, Journo>();
    for (const w of watches) {
      const k = norm(w.title);
      for (const n of [w.title, ...(w.aliases ?? [])]) alias.set(norm(n), k);
      map.set(k, { key: k, name: w.title, outlet: w.outlet || undefined, watch: w, articles: 0 });
    }
    const outletTally = new Map<string, Map<string, number>>();
    for (const a of byKind(data?.records, 'article')) {
      if (a.sourceType === 'x') continue;
      const seen = new Set<string>();
      for (const raw of a.journalists ?? []) {
        if (!raw.trim()) continue;
        const k = alias.get(norm(raw)) ?? norm(raw);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!map.has(k)) map.set(k, { key: k, name: raw.trim(), articles: 0 });
        map.get(k)!.articles++;
        if (a.outlet) {
          const t = outletTally.get(k) ?? new Map<string, number>();
          t.set(a.outlet, (t.get(a.outlet) ?? 0) + 1);
          outletTally.set(k, t);
        }
      }
    }
    for (const j of map.values()) if (!j.outlet) {
      const t = outletTally.get(j.key);
      if (t) j.outlet = [...t].sort((a, b) => b[1] - a[1])[0][0];
    }
    return [...map.values()].sort((a, b) => Number(!!b.watch) - Number(!!a.watch) || b.articles - a.articles || a.name.localeCompare(b.name));
  }, [data]);

  const ql = norm(q);
  const jMatch = (j: Journo) => !ql || [j.name, ...(j.watch?.aliases ?? []), j.outlet ?? ''].some(v => norm(v).includes(ql));
  const oMatch = (o: TrackedRecord) => !ql || norm(o.title).includes(ql) || norm(o.feedUrl).includes(ql);
  const outletKeys = new Set(outlets.map(o => norm(o.title)));
  const byOutlet = (o: TrackedRecord) => journalists.filter(j => norm(j.outlet) === norm(o.title));
  const unlinked = journalists.filter(j => !j.outlet || !outletKeys.has(norm(j.outlet)));
  const tracked = journalists.filter(j => j.watch).length;

  const iconBtn = 'p-1.5 text-muted-foreground hover:text-foreground';
  const outletActions = (o: TrackedRecord) => isSignedIn && <div className="flex justify-end opacity-100 md:opacity-0 md:group-hover:opacity-100">
    <button aria-label={`Edit ${o.title}`} onClick={() => setEditing(o)} className={iconBtn} data-testid={`button-edit-outlet-${o.id}`}><Pencil className="h-3.5 w-3.5" /></button>
    <button aria-label={`Delete ${o.title}`} onClick={() => setDeleting(o)} className="p-1.5 text-muted-foreground hover:text-destructive" data-testid={`button-delete-outlet-${o.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
  </div>;
  const outletSwitch = (o: TrackedRecord) => <Switch checked={o.enabled !== false} disabled={!isSignedIn || save.isPending}
    onCheckedChange={(v) => save.mutate({ data: { ...toInput(o), enabled: v } })} data-testid={`switch-outlet-${o.id}`} />;
  const brand = (o: TrackedRecord) => o.url ? <a href={o.url} target="_blank" rel="noreferrer" className="inline-flex"><OutletBrand name={o.title} variant="wordmark" /></a> : <OutletBrand name={o.title} variant="wordmark" />;
  const status = (o: TrackedRecord) => {
    const failed = o.feedStatus && /fail|error/i.test(o.feedStatus);
    return <span className={cn('font-mono text-[11px]', failed ? 'text-destructive' : 'text-muted-foreground')}>{o.feedStatus || '—'}</span>;
  };

  function journoRow(j: Journo, showOutlet: boolean) {
    const w = j.watch;
    const profileUrl = `/journalists?name=${encodeURIComponent(j.name)}${w ? '' : '&scope=all'}`;
    return <li key={j.key} className={cn('group flex items-center gap-3 px-3 py-2 text-sm', w?.enabled === false && 'opacity-50')} data-testid={`row-journalist-${j.key}`}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', w ? 'bg-foreground' : 'border border-muted-foreground')} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={profileUrl} className={cn('truncate hover:underline', w ? 'font-medium' : 'text-muted-foreground')} data-testid={`link-journalist-${j.key}`}>{j.name}</Link>
          {!w && <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">byline</span>}
        </div>
        {!!w?.aliases?.length && <p className="truncate font-mono text-[10px] text-muted-foreground">{w.aliases.join(' · ')}</p>}
      </div>
      {showOutlet && <span className="hidden max-w-[180px] truncate text-xs text-muted-foreground sm:inline">{j.outlet ? <OutletBrand name={j.outlet} /> : '—'}</span>}
      <span className="w-10 text-right font-mono text-xs">{j.articles}</span>
      <div className="flex w-16 justify-end">
        {isSignedIn && w && <div className="flex opacity-100 md:opacity-0 md:group-hover:opacity-100">
          <button aria-label={`Edit ${j.name}`} onClick={() => setWatchEditing(w)} className="p-1 text-muted-foreground hover:text-foreground" data-testid={`button-edit-watch-${w.id}`}><Pencil className="h-3.5 w-3.5" /></button>
          <button aria-label={`Delete ${j.name}`} onClick={() => setDeleting(w)} className="p-1 text-muted-foreground hover:text-destructive" data-testid={`button-delete-watch-${w.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>}
        {!w && <Link href={profileUrl} aria-label={`Open ${j.name}`} className="p-1 text-muted-foreground hover:text-foreground"><ArrowUpRight className="h-3.5 w-3.5" /></Link>}
      </div>
    </li>;
  }

  function allView() {
    const shown = outlets.filter(o => oMatch(o) || byOutlet(o).some(jMatch));
    const loose = unlinked.filter(jMatch);
    if (!shown.length && !loose.length) return <Empty title="No matches" />;
    return <div className="space-y-3 px-5 py-5 md:px-8">
      {shown.map(o => {
        const js = byOutlet(o).filter(j => oMatch(o) || jMatch(j));
        return <section key={o.id} className={cn('group rounded-md border border-border bg-card', o.enabled === false && 'opacity-60')} data-testid={`group-outlet-${o.id}`}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
            {brand(o)}
            <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
              {o.tier && <span>Tier {o.tier}</span>}{status(o)}<span>{fmtDate(o.lastChecked, true)}</span>
              <span className="text-foreground">{counts.get(norm(o.title)) ?? 0} items</span>
              <span>{js.filter(j => j.watch).length} tracked</span>
            </div>
            {outletSwitch(o)}
            <div className="w-16">{outletActions(o)}</div>
          </div>
          {js.length > 0 && <ul className="divide-y divide-border border-t border-border">{js.map(j => journoRow(j, false))}</ul>}
        </section>;
      })}
      {loose.length > 0 && <section className="rounded-md border border-dashed border-border">
        <h2 className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">No configured outlet · {loose.length}</h2>
        <ul className="divide-y divide-border border-t border-border">{loose.map(j => journoRow(j, true))}</ul>
      </section>}
    </div>;
  }

  function outletsView() {
    const shown = outlets.filter(oMatch);
    if (!shown.length) return <Empty title={outlets.length ? 'No matches' : 'No outlets configured'} />;
    return <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-5 py-2 font-normal md:px-8">Outlet</th><th className="px-3 py-2 font-normal">Tier</th><th className="px-3 py-2 font-normal">Feed</th>
            <th className="px-3 py-2 font-normal">Status</th><th className="px-3 py-2 font-normal">Checked</th><th className="px-3 py-2 text-right font-normal">Items</th>
            <th className="px-3 py-2 text-right font-normal">Journalists</th><th className="px-3 py-2 font-normal">On</th><th className="w-20 px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {shown.map(o => <tr key={o.id} className={cn('group hover:bg-card', o.enabled === false && 'text-muted-foreground')} data-testid={`row-outlet-${o.id}`}>
            <td className="px-5 py-2.5 md:px-8">{brand(o)}</td>
            <td className="px-3 py-2.5 font-mono text-xs">{o.tier ?? '—'}</td>
            <td className="max-w-[240px] truncate px-3 py-2.5 font-mono text-[11px] text-muted-foreground" title={o.feedUrl}>{o.feedUrl || '—'}</td>
            <td className="px-3 py-2.5">{status(o)}</td>
            <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">{fmtDate(o.lastChecked, true)}</td>
            <td className="px-3 py-2.5 text-right font-mono text-xs">{counts.get(norm(o.title)) ?? 0}</td>
            <td className="px-3 py-2.5 text-right font-mono text-xs">{byOutlet(o).length}</td>
            <td className="px-3 py-2.5">{outletSwitch(o)}</td>
            <td className="px-3 py-2.5">{outletActions(o)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>;
  }

  function journalistsView() {
    const shown = journalists.filter(jMatch);
    if (!shown.length) return <Empty title={journalists.length ? 'No matches' : 'No journalists recorded'} />;
    return <div className="px-5 py-5 md:px-8">
      <div className="flex items-center gap-3 px-3 pb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="w-1.5" /><span className="flex-1">Name</span><span className="hidden sm:inline">Outlet</span><span className="w-10 text-right">Items</span><span className="w-16" />
      </div>
      <ul className="divide-y divide-border rounded-md border border-border bg-card">{shown.map(j => journoRow(j, true))}</ul>
    </div>;
  }

  const tabs: [Tab, string, number][] = [['all', 'All', outlets.length + journalists.length], ['outlets', 'Outlets', outlets.length], ['journalists', 'Journalists', journalists.length]];

  return (
    <div className="tw-rise">
      <PageHead title="News Media" count={outlets.length}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter" className="h-8 w-40 bg-card pl-8 text-sm" data-testid="input-media-search" />
        </div>
        {isSignedIn && <>
          <button onClick={() => setWatchCreating(true)} data-testid="button-add-journalist" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-secondary"><Plus className="h-3.5 w-3.5" /> Journalist</button>
          <button onClick={() => setCreating(true)} data-testid="button-add-outlet" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> Outlet</button>
        </>}
      </PageHead>
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-5 py-2.5 md:px-8">
        {tabs.map(([t, label, n]) => <button key={t} onClick={() => setTab(t)} data-testid={`tab-media-${t}`} className={cn('h-7 rounded-md px-2.5 font-mono text-[11px] uppercase tracking-wider', tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}>
          {label} <span className="opacity-60">{n}</span>
        </button>)}
        {tab !== 'outlets' && <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{tracked} tracked · {journalists.length - tracked} bylines</span>}
      </div>
      {isLoading ? <RowsSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} /> : tab === 'all' ? (outlets.length || journalists.length ? allView() : <Empty title="No outlets configured" />) : tab === 'outlets' ? outletsView() : journalistsView()}
      <OutletEditor open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }} record={editing} />
      <WatchEditor open={watchCreating || !!watchEditing} onOpenChange={(o) => { if (!o) { setWatchCreating(false); setWatchEditing(null); } }} record={watchEditing} initialWatchType="journalist" />
      <ConfirmDelete target={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
