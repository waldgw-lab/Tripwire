import { useState } from 'react';
import { getGetEntityQueryKey, useGetEntity, type EntityEvidence } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, Pin, PinOff, Plus } from 'lucide-react';
import { POLL_MS, fmtWhen, shortHash } from '@/lib/entities';
import { EntityActionDialog, EvidenceDialog, type ActionPreset } from './dialogs';
import { Mono, Section, Tag, btnCls } from './ui';

function EvidenceCard({ v }: { v: EntityEvidence }) {
  const c = v.capture;
  return <li className="rounded-md border border-border bg-background/70 p-3" data-testid={`card-evidence-${v.id}`}>
    {/* React escapes text content; passage is rendered verbatim */}
    <blockquote className="whitespace-pre-wrap border-l-2 border-foreground pl-3 font-serif text-sm">{v.excerpt}</blockquote>
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-3">
      <div><Mono>Attribution</Mono><dd>{v.attribution}</dd></div>
      <div><Mono>Certainty</Mono><dd>{v.certainty}</dd></div>
      <div><Mono>Scope</Mono><dd>{v.scope}</dd></div>
      <div><Mono>Offsets</Mono><dd className="font-mono">{v.start}-{v.end}</dd></div>
      {c && <>
        <div><Mono>Publisher</Mono><dd>{c.publisher ?? c.source}</dd></div>
        <div><Mono>Byline</Mono><dd>{c.byline ?? '—'}</dd></div>
        <div><Mono>Published</Mono><dd>{fmtWhen(c.publishedAt)}</dd></div>
        <div><Mono>Observed</Mono><dd>{fmtWhen(c.capturedAt)}</dd></div>
        <div><Mono>Capture</Mono><dd className="font-mono" title={c.hash}>{shortHash(c.hash)}{c.complete ? '' : ' partial'}</dd></div>
      </>}
      <div><Mono>Version</Mono><dd className="font-mono">x{v.extractorVersion} / p{v.policyVersion}</dd></div>
      {v.lineage && <div className="col-span-2 sm:col-span-3"><Mono>Lineage</Mono><dd>{v.lineage.relation}{v.lineage.originKey ? ` · origin ${v.lineage.originKey}` : ''} · {v.lineage.independentlyReported ? 'independently reported' : 'not independent'} · {v.lineage.rationale}</dd></div>}
    </dl>
    {c?.url && <a href={c.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] underline underline-offset-2">Source</a>}
  </li>;
}

const HISTORY_PAGE = 100;

export function EntityDetailPane({ id, onClose }: { id: string; onClose: () => void }) {
  const [offset, setOffset] = useState(0);
  const params = { offset };
  const q = useGetEntity(id, params, { query: { queryKey: getGetEntityQueryKey(id, params), refetchInterval: POLL_MS, placeholderData: p => p } });
  const [preset, setPreset] = useState<ActionPreset | null>(null);
  const [addEv, setAddEv] = useState(false);
  if (q.isLoading) return <div className="space-y-3 p-5">{[60, 90, 75, 40].map((w, i) => <div key={i} className="h-4 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />)}</div>;
  if (q.isError || !q.data) return <div className="p-5 text-sm">Entity could not be loaded. <button className="underline" onClick={() => q.refetch()}>Retry</button></div>;
  const d = q.data; const e = d.entity;
  const evById = new Map(d.evidence.map(v => [v.id, v]));
  const act = (p: ActionPreset) => () => setPreset(p);
  return <article className="flex h-full flex-col" data-testid={`detail-entity-${e.id}`}>
    <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5"><Tag value={e.state} /><Tag value={e.classification} /><Mono>P{e.priority}</Mono>{e.unresolved && <Mono className="text-red-700">identity unresolved</Mono>}</div>
      <button onClick={onClose} aria-label="Close entity" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" data-testid="button-entity-close"><ChevronRight className="h-4 w-4" /></button>
    </div>
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <Mono>{e.type}</Mono>
      <h2 className="font-display text-3xl font-semibold leading-tight" data-testid="text-entity-name">{e.name}</h2>
      {e.aliases.length > 0 && <p className="font-mono text-[11px] text-muted-foreground">{e.aliases.join(' · ')}</p>}
      {!!e.facets?.length && <p className="mt-1 text-xs">{e.facets.join(' · ')}</p>}
      <p className="mt-2 text-xs text-muted-foreground">{e.rationale}</p>
      {e.redirectId && <p className="mt-2 text-xs">Merged into <span className="font-mono">{e.redirectId}</span></p>}
      <Mono className="mt-2 block">Last development {fmtWhen(e.lastDevelopment)} · next review {fmtWhen(e.nextReview)}</Mono>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <button className={btnCls} onClick={act({ action: 'monitor', state: 'Watch' })} data-testid="button-entity-monitor">Monitor</button>
        {e.state === 'Archived' ? <button className={btnCls} onClick={act({ action: 'reactivate' })} data-testid="button-entity-reactivate">Reactivate</button>
          : <button className={btnCls} onClick={act({ action: 'archive' })} data-testid="button-entity-archive">Archive</button>}
        <button className={btnCls} onClick={act({ action: e.pinned ? 'unpin' : 'pin' })} data-testid="button-entity-pin">{e.pinned ? <><PinOff className="h-3 w-3" /> Unpin</> : <><Pin className="h-3 w-3" /> Pin</>}</button>
        <button className={btnCls} onClick={act({ action: 'rename' })} data-testid="button-entity-rename">Rename</button>
        <button className={btnCls} onClick={act({ action: 'reassess' })} data-testid="button-entity-reassess">Reassess</button>
        <button className={btnCls} onClick={act({ action: 'merge' })} data-testid="button-entity-merge">Merge</button>
        {e.redirectId && <button className={btnCls} onClick={act({ action: 'unmerge', targetId: e.redirectId })} data-testid="button-entity-unmerge">Unmerge</button>}
      </div>

      <Section title="Roles and assertions" count={d.assertions.length}>
        {d.assertions.length ? <ol className="space-y-2">{d.assertions.map(a => {
          const v = evById.get(a.evidenceId);
          return <li key={a.id} className="rounded-md border border-border p-2.5 text-sm" data-testid={`row-assertion-${a.id}`}>
            <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-semibold">{a.subjectName ?? e.name}</span><span className="font-mono text-xs">{a.predicate}</span><span>{a.objectName ?? a.value ?? a.objectId ?? ''}</span><Tag value={a.status} className="ml-auto" /></div>
            <Mono>{a.certainty}{a.tenure ? ` · ${a.tenure}` : ''} · {a.validFrom ?? '?'} to {a.validTo ?? 'present'}{a.supersedesId ? ' · supersedes' : ''}{a.disputesId ? ' · disputes' : ''}</Mono>
            {v && <p className="mt-1 line-clamp-2 border-l border-border pl-2 font-serif text-xs text-muted-foreground">{v.excerpt}</p>}
            <button className="mt-1 text-[11px] underline" onClick={act({ action: 'correct', assertionId: a.id })} data-testid={`button-correct-${a.id}`}>Correct</button>
          </li>;
        })}</ol> : <p className="text-xs text-muted-foreground">No sourced assertions.</p>}
      </Section>

      <Section title="Evidence" count={d.evidence.length} action={<button className={btnCls} onClick={() => setAddEv(true)} data-testid="button-add-evidence"><Plus className="h-3 w-3" /> Evidence</button>}>
        {d.evidence.length ? <ul className="space-y-2">{d.evidence.map(v => <EvidenceCard key={v.id} v={v} />)}</ul> : <p className="text-xs text-muted-foreground">No evidence. Select a passage from a retained capture.</p>}
      </Section>

      <Section title="Candidate matches" count={d.candidates.length}>
        {d.candidates.length ? <ul className="space-y-2">{d.candidates.map(c => <li key={c.id} className="rounded-md border border-border p-2.5 text-xs" data-testid={`row-candidate-${c.id}`}>
          <p>{c.reason}</p><Mono>{c.resolution} · identity {c.identityConfidence}{c.matchId ? ` · match ${c.matchId}` : ''}</Mono>
          {c.resolution === 'pending' && <div className="mt-1.5 flex gap-1.5">
            <button className={btnCls} onClick={act({ action: 'resolve', candidateId: c.id })} data-testid={`button-resolve-${c.id}`}>Distinct</button>
            <button className={btnCls} onClick={act({ action: 'reject', candidateId: c.id })} data-testid={`button-reject-${c.id}`}>Reject</button>
            {c.matchId && <button className={btnCls} onClick={act({ action: 'merge', targetId: c.matchId })} data-testid={`button-merge-${c.id}`}>Merge</button>}
          </div>}
        </li>)}</ul> : <p className="text-xs text-muted-foreground">No candidate matches.</p>}
      </Section>

      <Section title="Decisions" count={d.decisions.length}>
        <ol className="space-y-2">{d.decisions.map(x => <li key={x.id} className="border-l-2 border-border pl-3 text-xs" data-testid={`row-decision-${x.id}`}>
          <div className="flex flex-wrap gap-x-2"><span className="font-mono uppercase">{x.action}</span><Mono>{x.origin} · {fmtWhen(x.createdAt)} · p{x.policyVersion}</Mono></div>
          <p className="mt-0.5">{x.rationale}</p>
          {Object.keys(x.dimensions).length > 0 && <div className="mt-1 flex flex-wrap gap-2">{Object.entries(x.dimensions).map(([k, n]) => <span key={k} className="font-mono text-[10px]">{k} <b>{n}</b></span>)}</div>}
          {x.evidenceIds.length > 0 && <Mono>{x.evidenceIds.length} evidence cited</Mono>}
        </li>)}</ol>
        {(offset > 0 || d.historyTruncated) && <div className="mt-3 flex items-center justify-end gap-2">
          <Mono>History rows {offset + 1}-{offset + HISTORY_PAGE}</Mono>
          <button className={btnCls} disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - HISTORY_PAGE))} data-testid="button-history-newer"><ChevronLeft className="h-3 w-3" /> Newer</button>
          <button className={btnCls} disabled={!d.historyTruncated} onClick={() => setOffset(o => o + HISTORY_PAGE)} data-testid="button-history-earlier">Earlier <ChevronRight className="h-3 w-3" /></button>
        </div>}
      </Section>
    </div>
    <EntityActionDialog preset={preset} detail={d} onClose={() => setPreset(null)} />
    <EvidenceDialog open={addEv} onOpenChange={setAddEv} entity={e} />
  </article>;
}
