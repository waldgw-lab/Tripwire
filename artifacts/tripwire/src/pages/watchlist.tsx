import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { TrackedRecord } from '@workspace/api-client-react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Empty, ErrorState, PageHead, RowsSkeleton } from '@/components/bits';
import { ConfirmDelete, WatchEditor } from '@/components/editors';
import { WATCH_TYPES, byKind, useWorkspace } from '@/lib/workspace';

export default function WatchlistPage() {
  const { isSignedIn } = useAuth();
  const { data, isLoading, isError, refetch } = useWorkspace();
  const [type, setType] = useState('all');
  const [editing, setEditing] = useState<TrackedRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TrackedRecord | null>(null);
  const items = useMemo(() => byKind(data?.records, 'watch'), [data]);
  const matches = (w: TrackedRecord) => type === 'all' || (w.watchType === 'person' ? 'position' : w.watchType) === type;
  const organizations = items.filter(w => w.watchType === 'organization');
  const orgNames = new Set(organizations.map(w => w.title));
  const order = (a: TrackedRecord, b: TrackedRecord) => (a.tier ?? 3) - (b.tier ?? 3) || a.title.localeCompare(b.title);

  function actions(w: TrackedRecord) {
    return isSignedIn && <div className="flex shrink-0">
      <button aria-label={`Edit ${w.position || w.title}`} onClick={() => setEditing(w)} className="p-1 text-muted-foreground hover:text-foreground" data-testid={`button-edit-watch-${w.id}`}><Pencil className="h-3.5 w-3.5" /></button>
      <button aria-label={`Delete ${w.position || w.title}`} onClick={() => setDeleting(w)} className="p-1 text-muted-foreground hover:text-destructive" data-testid={`button-delete-watch-${w.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
    </div>;
  }

  function card(w: TrackedRecord) {
    const position = w.watchType === 'position' || w.watchType === 'person';
    return <li key={w.id} className={cn('rounded-md border border-border bg-card px-3 py-3', w.enabled === false && 'opacity-50')} data-testid={`card-watch-${w.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{position ? 'Position' : w.watchType} · Tier {w.tier ?? 3}</p>
          <h3 className="mt-1 text-sm font-semibold">{position ? w.position || 'Position not specified' : w.title}</h3>
          {w.watchType === 'journalist' && w.outlet && <p className="mt-1 text-xs text-muted-foreground">{w.outlet}</p>}
          {position && <p className="mt-1 text-sm">{w.individual || (w.watchType === 'person' ? w.title : 'Individual not specified')}</p>}
        </div>
        {actions(w)}
      </div>
      {w.summary && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{w.summary}</p>}
      {!!w.aliases?.length && <p className="mt-2 font-mono text-[10px] text-muted-foreground">{w.aliases.join(' · ')}</p>}
    </li>;
  }

  const visibleGroup = (w: TrackedRecord, seen = new Set<string>()): boolean => {
    if (seen.has(w.title)) return false;
    const next = new Set(seen).add(w.title);
    return matches(w) || items.some(child => child.organization === w.title && (child.watchType === 'organization' ? visibleGroup(child, next) : matches(child)));
  };

  function group(w: TrackedRecord, ancestors: string[] = []) {
    if (ancestors.includes(w.title) || !visibleGroup(w)) return null;
    const path = [...ancestors, w.title];
    const children = items.filter(child => child.organization === w.title && child.id !== w.id).sort(order);
    return <section key={w.id} className={cn('space-y-3', ancestors.length ? 'ml-2 border-l border-border pl-4' : 'rounded-md border border-border bg-background p-4 md:p-5', w.enabled === false && 'opacity-50')} data-testid={`group-watch-${w.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Organization · Tier {w.tier ?? 3}</p>
          <h2 className="font-display text-2xl font-semibold leading-tight">{w.title}</h2>
        </div>
        {actions(w)}
      </div>
      {w.summary && <p className="text-xs leading-relaxed text-muted-foreground">{w.summary}</p>}
      <ul className="space-y-2">{children.filter(child => child.watchType !== 'organization' && matches(child)).map(card)}</ul>
      {children.filter(child => child.watchType === 'organization').map(child => group(child, path))}
    </section>;
  }

  // Break malformed/cyclic parent links into roots rather than hiding records.
  const roots = organizations.filter(w => {
    const seen = new Set([w.title]);
    let parent = w.organization;
    while (parent && orgNames.has(parent)) {
      if (seen.has(parent)) return true;
      seen.add(parent);
      parent = organizations.find(org => org.title === parent)?.organization;
    }
    return !w.organization || !orgNames.has(w.organization);
  }).sort(order);
  const ungrouped = items.filter(w => w.watchType !== 'organization' && (!w.organization || !orgNames.has(w.organization)) && matches(w)).sort(order);
  const otherTypes = ['position', 'journalist', 'x-account', 'attribution', 'topic'];
  return <div className="tw-rise">
    <PageHead title="Watchlist" count={items.length}>
      {isSignedIn && <button onClick={() => setCreating(true)} data-testid="button-add-watch" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> Watch</button>}
    </PageHead>
    <div className="flex flex-wrap gap-1 border-b border-border px-5 py-2.5 md:px-8">
      {['all', ...WATCH_TYPES].map(t => <button key={t} onClick={() => setType(t)} data-testid={`filter-watch-${t}`} className={cn('h-7 rounded-md px-2.5 font-mono text-[11px] uppercase tracking-wider', type === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}>
        {t} <span className="opacity-60">{t === 'all' ? items.length : items.filter(w => (w.watchType === 'person' ? 'position' : w.watchType) === t).length}</span>
      </button>)}
    </div>
    {isLoading ? <RowsSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} /> : !items.length ? <Empty title="Watchlist is empty" /> : <div className="space-y-6 px-5 py-5 md:px-8">
      <div className="grid items-start gap-4 xl:grid-cols-2">{roots.map(w => group(w))}</div>
      {otherTypes.map(t => {
        const records = ungrouped.filter(w => (w.watchType === 'person' ? 'position' : w.watchType) === t);
        return records.length ? <section key={t}>
          <h2 className="mb-3 font-display text-2xl font-semibold">{t === 'position' ? 'Other positions' : t === 'journalist' ? 'Journalists' : t === 'x-account' ? 'X accounts' : t === 'attribution' ? 'Source attributions' : 'Topics'}</h2>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{records.map(card)}</ul>
        </section> : null;
      })}
      {!items.some(matches) && <Empty title="No matching watches" />}
    </div>}
    <WatchEditor open={creating || !!editing} onOpenChange={o => { if (!o) { setCreating(false); setEditing(null); } }} record={editing} />
    <ConfirmDelete target={deleting} onClose={() => setDeleting(null)} />
  </div>;
}
