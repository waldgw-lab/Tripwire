import { useEffect, useState } from 'react';
import { getListEntitiesQueryKey, useListEntities, type ListEntitiesParams, type RegistryEntity } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, Pin, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Empty, ErrorState, RowsSkeleton } from '@/components/bits';
import { CLASSIFICATIONS, ENTITY_STATES, ENTITY_TYPES, POLL_MS, fmtWhen } from '@/lib/entities';
import { CreateEntityDialog } from './dialogs';
import { EntityDetailPane } from './entity-detail';
import { AutomationPanel } from './automation-panel';
import { Mono, Tag, inputCls, primaryCls } from './ui';

const LIMIT = 50;
const readId = () => new URLSearchParams(window.location.search).get('entity');
function writeId(id: string | null) { const u = new URL(window.location.href); if (id) u.searchParams.set('entity', id); else u.searchParams.delete('entity'); window.history.replaceState(window.history.state, '', u); }

export function EntityRegistry() {
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  useEffect(() => { const t = window.setTimeout(() => setDq(q.trim()), 250); return () => window.clearTimeout(t); }, [q]);
  const [state, setState] = useState(''); const [type, setType] = useState(''); const [cls, setCls] = useState(''); const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [dq, state, type, cls]);
  const params: ListEntitiesParams = { ...(dq && { q: dq }), ...(state && { state: state as ListEntitiesParams['state'] }), ...(type && { type: type as ListEntitiesParams['type'] }), ...(cls && { classification: cls as ListEntitiesParams['classification'] }), offset, limit: LIMIT };
  const list = useListEntities(params, { query: { queryKey: getListEntitiesQueryKey(params), refetchInterval: POLL_MS, placeholderData: p => p } });
  const orgs = useListEntities({ type: 'organization', limit: 100 }, { query: { queryKey: getListEntitiesQueryKey({ type: 'organization', limit: 100 }), staleTime: 60_000 } });
  const [open, setOpenState] = useState<string | null>(readId);
  const setOpen = (id: string | null) => { setOpenState(id); writeId(id); };
  const [creating, setCreating] = useState(false);
  const items = list.data?.items ?? []; const total = list.data?.total ?? 0;
  const sel = (v: string, set: (s: string) => void, opts: readonly string[], label: string) =>
    <select value={v} onChange={e => set(e.target.value)} aria-label={label} className={cn(inputCls, 'w-auto text-xs')} data-testid={`select-filter-${label}`}><option value="">{label}</option>{opts.map(o => <option key={o}>{o}</option>)}</select>;

  return <div className={cn(open && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(400px,48%)]')}>
    <div className="min-w-0 space-y-3 px-5 py-4 md:px-8">
      <AutomationPanel />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={e => setQ(e.target.value)} maxLength={200} placeholder="Search registry" className={cn(inputCls, 'pl-8')} data-testid="input-entity-search" /></div>
        {sel(state, setState, ENTITY_STATES, 'state')}{sel(type, setType, ENTITY_TYPES, 'type')}{sel(cls, setCls, CLASSIFICATIONS, 'class')}
        <button onClick={() => setCreating(true)} className={primaryCls} data-testid="button-add-entity"><Plus className="h-3.5 w-3.5" /> Entity</button>
      </div>
      {list.isLoading ? <RowsSkeleton /> : list.isError ? <ErrorState onRetry={() => list.refetch()} /> : !items.length ? <Empty title={dq || state || type || cls ? 'No matching entities' : 'Registry is empty'} /> :
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card" data-testid="list-entities">
          {items.map((e: RegistryEntity) => <li key={e.id}>
            <button onClick={() => setOpen(e.id)} aria-pressed={open === e.id} className={cn('grid w-full grid-cols-[1fr_auto] items-center gap-2 px-3 py-2 text-left hover:bg-muted/60', open === e.id && 'bg-muted shadow-[inset_3px_0_0_hsl(var(--foreground))]')} data-testid={`row-entity-${e.id}`}>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{e.name}</span>{e.pinned && <Pin className="h-3 w-3 shrink-0" />}{e.unresolved && <span className="font-mono text-[10px] text-red-700">UNRESOLVED</span>}</span>
                <Mono>{e.type} · {e.classification} · P{e.priority} · {e.lastDevelopment ? `dev ${fmtWhen(e.lastDevelopment)}` : 'no developments'}</Mono>
              </span>
              <Tag value={e.state} />
            </button>
          </li>)}
        </ul>}
      {total > LIMIT && <div className="flex items-center justify-end gap-2 text-xs">
        <Mono>{offset + 1}-{Math.min(offset + LIMIT, total)} of {total}</Mono>
        <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - LIMIT))} className="rounded p-1 disabled:opacity-30" aria-label="Previous page" data-testid="button-entities-prev"><ChevronLeft className="h-4 w-4" /></button>
        <button disabled={offset + LIMIT >= total} onClick={() => setOffset(o => o + LIMIT)} className="rounded p-1 disabled:opacity-30" aria-label="Next page" data-testid="button-entities-next"><ChevronRight className="h-4 w-4" /></button>
      </div>}
    </div>
    {open && <>
      <div className="fixed inset-0 z-40 bg-foreground/30 lg:hidden" onClick={() => setOpen(null)} aria-hidden />
      <aside className="tw-rise fixed inset-0 z-50 bg-card lg:static lg:z-auto lg:border-l lg:border-border lg:bg-card/85"><div className="h-full lg:sticky lg:top-0 lg:h-[100dvh]"><EntityDetailPane key={open} id={open} onClose={() => setOpen(null)} /></div></aside>
    </>}
    <CreateEntityDialog open={creating} onOpenChange={setCreating} organizations={orgs.data?.items ?? []} onCreated={setOpen} />
  </div>;
}
