import { useEffect, useMemo, useState } from 'react';
import type { RegistryEntity, TrackedRecord } from '@workspace/api-client-react';
import { ChevronDown, ChevronRight, Pin, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Empty, ErrorState, PageHead, RowsSkeleton } from '@/components/bits';
import { byKind, useWorkspace } from '@/lib/workspace';
import { ENTITY_STATES, errorText } from '@/lib/entities';
import { buildCoverage, filterTree, haystack, linkStanding, useAllEntities, type Node } from '@/lib/coverage-tree';
import { CreateEntityDialog } from '@/components/entities/dialogs';
import { EntityDetailPane } from '@/components/entities/entity-detail';
import { AutomationPanel } from '@/components/entities/automation-panel';
import { WatchEditor } from '@/components/editors';
import { toneCls } from '@/components/entities/coverage-context';
import { Mono, Tag, inputCls, primaryCls } from '@/components/entities/ui';

const readId = () => new URLSearchParams(window.location.search).get('entity');
function writeId(id: string | null) { const u = new URL(window.location.href); if (id) u.searchParams.set('entity', id); else u.searchParams.delete('entity'); window.history.replaceState(window.history.state, '', u); }
const TYPES = ['all', 'organization', 'position', 'person', 'issue', 'other'] as const;
const REF_TYPES = ['attribution', 'x-account'];
const typeKey = (e: RegistryEntity) => (['organization', 'position', 'person', 'issue'].includes(e.type) ? e.type : 'other');

function collectIds(nodes: Node[], out = new Set<string>()) { for (const n of nodes) { if (n.children.length) out.add(n.e.id); collectIds(n.children, out); } return out; }
function countNodes(nodes: Node[], hits?: Set<string>, seen = new Set<string>()): number {
  return nodes.reduce((sum, node) => {
    const count = !seen.has(node.e.id) && (!hits || hits.has(node.e.id)) ? 1 : 0;
    seen.add(node.e.id);
    return sum + count + countNodes(node.children, hits, seen);
  }, 0);
}

export default function WatchlistPage() {
  const all = useAllEntities();
  const ws = useWorkspace();
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  useEffect(() => { const t = window.setTimeout(() => setDq(q.trim().toLowerCase()), 200); return () => window.clearTimeout(t); }, [q]);
  const [state, setState] = useState(''); const [type, setType] = useState<(typeof TYPES)[number]>('all');
  const [open, setOpenState] = useState<string | null>(readId);
  const setOpen = (id: string | null) => { setOpenState(id); writeId(id); };
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [refOpen, setRefOpen] = useState(false); const [opsOpen, setOpsOpen] = useState(false);
  const [reference, setReference] = useState<TrackedRecord | null>(null);
  const [referenceOpen, setReferenceOpen] = useState(false);

  useEffect(() => { const h = () => setOpenState(readId()); window.addEventListener('popstate', h); return () => window.removeEventListener('popstate', h); }, []);

  const entities = all.data;
  const cov = useMemo(() => buildCoverage(entities ?? []), [entities]);
  const filtering = !!dq || !!state || type !== 'all';
  useEffect(() => { if (filtering) setCollapsed(new Set()); }, [dq, state, type]); // reveal matching descendants
  const match = (e: RegistryEntity) => (!dq || haystack(e).includes(dq)) && (!state || e.state === state) && (type === 'all' || typeKey(e) === type);
  const groups = useMemo(() => {
    const g = [
      { key: 'orgs', title: 'Organizations', note: 'Nested by parent organization; positions and named people underneath.', nodes: cov.roots },
      { key: 'positions', title: 'Positions without organization', note: 'Canonical positions not linked to an organization.', nodes: cov.loosePositions },
      { key: 'people', title: 'People not placed in a position', note: 'No legacy or sourced role link. Ties are never inferred from matching names.', nodes: cov.unplacedPeople },
      { key: 'other', title: 'Issues and other subjects', note: 'Issue subjects, companies, capabilities and events.', nodes: cov.other },
    ];
    return g.map(x => { if (!filtering) return { ...x, hits: undefined as Set<string> | undefined }; const f = filterTree(x.nodes, match); return { ...x, nodes: f.nodes, hits: f.hits }; });
  }, [cov, dq, state, type]); // eslint-disable-line react-hooks/exhaustive-deps
  const matched = groups.reduce((s, g) => s + (g.hits?.size ?? 0), 0);
  const refs = useMemo(() => byKind(ws.data?.records, 'watch').filter(w => REF_TYPES.includes(w.watchType ?? '')), [ws.data]);
  const visibleRefs = refs.filter(w => !dq || [w.title, w.summary, ...(w.aliases ?? [])].join(' ').toLowerCase().includes(dq));
  const counts = useMemo(() => { const c: Record<string, number> = { all: entities?.length ?? 0 }; for (const e of entities ?? []) c[typeKey(e)] = (c[typeKey(e)] ?? 0) + 1; return c; }, [entities]);
  const orgOptions = useMemo(() => (entities ?? []).filter(e => e.type === 'organization').sort((a, b) => a.name.localeCompare(b.name)), [entities]);

  const toggle = (id: string) => setCollapsed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allIds = () => { const s = new Set<string>(); groups.forEach(g => collectIds(g.nodes, s)); return s; };

  function row(n: Node, depth: number, hits?: Set<string>, keyPath = ''): React.ReactNode {
    const e = n.e; const key = `${keyPath}/${e.id}`; const isOpen = !collapsed.has(e.id); const has = n.children.length > 0;
    const s = n.link && linkStanding(n.link); const c = e.coverageContext;
    const dim = hits && !hits.has(e.id);
    return <li key={key} data-testid={`tree-node-${e.id}`}>
      <div className={cn('group flex items-start gap-1 rounded-md pr-2 hover:bg-muted/60', open === e.id && 'bg-muted shadow-[inset_3px_0_0_hsl(var(--foreground))]')} style={{ paddingLeft: depth * 18 }}>
        <button onClick={() => has && toggle(e.id)} disabled={!has} aria-label={has ? (isOpen ? `Collapse ${e.name}` : `Expand ${e.name}`) : undefined} aria-expanded={has ? isOpen : undefined} className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-0" data-testid={`button-toggle-${e.id}`}>
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <button onClick={() => setOpen(e.id)} aria-pressed={open === e.id} className={cn('min-w-0 flex-1 py-1.5 text-left', dim && 'opacity-55')} data-testid={`row-entity-${e.id}`}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{e.type}</span>
            <span className={cn('truncate', e.type === 'organization' && depth === 0 ? 'font-display text-lg font-semibold leading-tight' : 'text-sm font-semibold')}>{e.name}</span>
            {e.pinned && <Pin className="h-3 w-3 shrink-0" />}
            {e.unresolved && <span className="font-mono text-[10px] text-red-700">UNRESOLVED</span>}
            {has && !isOpen && <Mono>{n.children.length} inside</Mono>}
            <span className="ml-auto flex items-center gap-1.5"><Mono>P{e.priority}{c?.tier ? ` · T${c.tier}` : ''}</Mono><Tag value={e.state} /></span>
          </span>
          {s && <span className={cn('mt-0.5 inline-block rounded-sm border px-1.5 font-mono text-[10px] uppercase', toneCls[s.tone])} data-testid={`text-link-standing-${e.id}`}>{s.label}</span>}
          {!!e.aliases.length && <span className="block truncate font-mono text-[10px] text-muted-foreground">{e.aliases.join(' · ')}</span>}
          {(c?.summary || e.rationale) && <span className="block line-clamp-1 text-xs text-muted-foreground">{c?.summary || e.rationale}</span>}
        </button>
      </div>
      {has && isOpen && <ul className="ml-[9px] border-l border-border" style={{ marginLeft: depth * 18 + 9 }}>{n.children.map(ch => row(ch, 0, hits, key))}</ul>}
    </li>;
  }

  const body = all.isLoading ? <RowsSkeleton /> : all.isError ? <div className="space-y-2"><p className="text-xs text-red-800" data-testid="text-coverage-error">{errorText(all.error)}</p><ErrorState onRetry={() => all.refetch()} /></div>
    : !entities?.length ? <Empty title="Coverage is empty"><button onClick={() => setCreating(true)} className={primaryCls}>Add first subject</button></Empty>
    : <div className="space-y-5">
      {filtering && <p className="font-mono text-[11px] text-muted-foreground" data-testid="text-match-count">{matched} of {entities.length} subjects match · ancestors shown for context</p>}
      {groups.map(g => g.nodes.length ? <section key={g.key} data-testid={`section-coverage-${g.key}`}>
        <div className="mb-1.5 flex items-baseline gap-2 border-b border-border pb-1"><h2 className="font-display text-xl font-semibold uppercase tracking-wide">{g.title}</h2><Mono>{g.hits ? `${g.hits.size} match` : `${countNodes(g.nodes)} subjects`}</Mono></div>
        <p className="mb-2 text-[11px] text-muted-foreground">{g.note}</p>
        <ul className="rounded-md border border-border bg-card p-1.5">{g.nodes.map(n => row(n, 0, g.hits))}</ul>
      </section> : null)}
      {filtering && matched === 0 && <Empty title="No matching subjects" />}
    </div>;

  return <div className="tw-rise">
    <PageHead title="Coverage" count={entities?.length}>
      <button onClick={() => setCreating(true)} className={primaryCls} data-testid="button-add-entity"><Plus className="h-3.5 w-3.5" /> Subject</button>
    </PageHead>
    <div className={cn(open && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(400px,46%)]')}>
      <div className="min-w-0 space-y-4 px-5 py-4 md:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} maxLength={200} placeholder="Search names, aliases, roles, original context" className={cn(inputCls, 'pl-8')} data-testid="input-coverage-search" /></div>
          <select value={state} onChange={e => setState(e.target.value)} aria-label="state" className={cn(inputCls, 'w-auto text-xs')} data-testid="select-filter-state"><option value="">Any state</option>{ENTITY_STATES.map(s => <option key={s}>{s}</option>)}</select>
          <button onClick={() => setCollapsed(new Set())} className="font-mono text-[11px] uppercase text-muted-foreground hover:text-foreground" data-testid="button-expand-all">Expand all</button>
          <button onClick={() => setCollapsed(allIds())} className="font-mono text-[11px] uppercase text-muted-foreground hover:text-foreground" data-testid="button-collapse-all">Collapse all</button>
        </div>
        <div className="flex flex-wrap gap-1">{TYPES.map(t => <button key={t} onClick={() => setType(t)} data-testid={`filter-type-${t}`} className={cn('h-7 rounded-md px-2.5 font-mono text-[11px] uppercase tracking-wider', type === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}>{t} <span className="opacity-60">{counts[t] ?? 0}</span></button>)}</div>
        {body}

        <section className="rounded-md border border-border" data-testid="section-source-patterns">
          <button onClick={() => setRefOpen(v => !v)} aria-expanded={refOpen} className="flex w-full items-center gap-2 px-3 py-2 text-left" data-testid="button-toggle-source-patterns">
            {refOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="font-display text-base font-semibold uppercase tracking-wide">Source patterns and reference watches</span>
            <Mono>{dq ? `${visibleRefs.length} of ${refs.length}` : refs.length} · not participants</Mono>
          </button>
          {refOpen && <div className="border-t border-border px-3 py-3">
            <button className={`${primaryCls} mb-3`} onClick={() => { setReference(null); setReferenceOpen(true); }} data-testid="button-add-source-pattern">Add source pattern</button>
            {ws.isLoading ? <RowsSkeleton n={3} /> : ws.isError ? <ErrorState onRetry={() => ws.refetch()} /> : !visibleRefs.length ? <p className="text-xs text-muted-foreground">No reference watches{dq ? ' match' : ''}.</p> :
              <ul className="grid gap-2 md:grid-cols-2">{visibleRefs.map((w: TrackedRecord) => <li key={w.id} className={cn('rounded-md border border-border bg-card px-3 py-2', w.enabled === false && 'opacity-50')} data-testid={`card-reference-${w.id}`}>
                <Mono>{w.watchType} · tier {w.tier ?? 3}{w.enabled === false ? ' · disabled' : ''}</Mono>
                <p className="text-sm font-semibold">{w.title}</p>
                {w.organization && <p className="text-xs">{w.organization}</p>}
                {w.summary && <p className="mt-1 text-xs text-muted-foreground">{w.summary}</p>}
                {!!w.aliases?.length && <p className="mt-1 font-mono text-[10px] text-muted-foreground">{w.aliases.join(' · ')}</p>}
                <button className="mt-2 text-xs underline" onClick={() => { setReference(w); setReferenceOpen(true); }} data-testid={`button-edit-source-pattern-${w.id}`}>Edit pattern</button>
              </li>)}</ul>}
          </div>}
        </section>

        <section className="rounded-md border border-dashed border-border" data-testid="section-operations">
          <button onClick={() => setOpsOpen(v => !v)} aria-expanded={opsOpen} className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground" data-testid="button-toggle-operations">
            {opsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<span className="font-mono text-[11px] uppercase tracking-wider">Advanced · automation operations</span>
          </button>
          {opsOpen && <div className="border-t border-border p-2"><AutomationPanel /></div>}
        </section>
      </div>
      {open && <>
        <div className="fixed inset-0 z-40 bg-foreground/30 lg:hidden" onClick={() => setOpen(null)} aria-hidden />
        <aside className="tw-rise fixed inset-0 z-50 bg-card lg:static lg:z-auto lg:border-l lg:border-border lg:bg-card/85"><div className="h-full lg:sticky lg:top-0 lg:h-[100dvh]"><EntityDetailPane key={open} id={open} onClose={() => setOpen(null)} /></div></aside>
      </>}
    </div>
    <CreateEntityDialog open={creating} onOpenChange={setCreating} organizations={orgOptions} onCreated={setOpen} />
    <WatchEditor open={referenceOpen} onOpenChange={setReferenceOpen} record={reference} initialWatchType="attribution" allowedTypes={REF_TYPES} />
  </div>;
}
