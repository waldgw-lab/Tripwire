import type { ReactNode } from 'react';
import { RetainedCopyComparison } from './retained-copy-comparison';
import { useMemo, useRef, useState } from 'react';
import {
  getGetArticleContentQueryKey,
  getGetReportingProvenanceQueryKey,
  getListEntityCapturesQueryKey,
  useConnectReportingPassage,
  useGetArticleContent,
  useGetReportingProvenance,
  useListEntityCaptures,
  useReviewReportingLineage,
  type GetReportingProvenanceParams,
  type ReportingClaim,
  type ReportingContext,
  type ReportingMatch,
  type ReportingReview,
  type ReportingReviewInputRelation,
  type ReportingSource,
  type ReportingEvidenceVersion,
} from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { byKind, errText, fmtDate, useInvalidateClaims, useWorkspace } from '@/lib/workspace';
import { ErrorLine, Mono, btnCls, inputCls, primaryCls } from '@/components/entities/ui';
import { ArticleHeading } from '@/components/article-heading';
import { ClaimDirection } from './claim-direction';

/** Muted complementary tones for compact statuses and disclosures. */
export const TONE = { sage: 'bg-[hsl(150_18%_92%)] text-[hsl(150_22%_28%)]', slate: 'bg-[hsl(212_20%_93%)] text-[hsl(212_24%_32%)]', clay: 'bg-[hsl(20_28%_92%)] text-[hsl(18_30%_34%)]' };
export function Disclosure({ label, count, children, testId, className }: { label: string; count?: number; children: ReactNode; testId?: string; className?: string }) {
  return <details className={cn('group mt-1.5 rounded-md border border-[hsl(212_14%_88%)] bg-[hsl(212_20%_97%)] text-xs', className)} data-testid={testId}>
    <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 text-[11px] text-[hsl(212_18%_36%)] hover:text-foreground"><ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />{label}{count != null && <span className="font-mono text-[10px] opacity-70">{count}</span>}</summary>
    <div className="border-t border-[hsl(212_14%_88%)] px-2 py-2">{children}</div>
  </details>;
}

const PAGE = 30;
const CONTEXT_LIMIT = 100;

export const CLAIM_RELATIONS = ['new-reporting', 'added-evidence', 'derivative', 'opinion-propagation', 'disputes', 'unknown'] as const;
export const MATCH_RELATIONS = ['same-environment', 'distinct-environments', 'unresolved'] as const;

const RELATION_LABEL: Record<string, string> = {
  'new-reporting': 'New reporting',
  'added-evidence': 'Added evidence',
  derivative: 'Derivative',
  'opinion-propagation': 'Opinion propagation',
  disputes: 'Disputes',
  unknown: 'Unknown',
  'same-environment': 'Same source environment',
  'distinct-environments': 'Distinct environments',
  unresolved: 'Unresolved',
};
const RELATION_TONE: Record<string, string> = {
  'new-reporting': 'bg-primary text-primary-foreground',
  'added-evidence': 'border border-foreground text-foreground',
  derivative: 'bg-muted text-muted-foreground',
  'opinion-propagation': 'border border-dashed border-muted-foreground text-muted-foreground',
  disputes: 'border border-red-700 text-red-800',
  unknown: 'bg-secondary text-secondary-foreground',
  'same-environment': 'bg-muted text-muted-foreground',
  'distinct-environments': 'border border-foreground text-foreground',
  unresolved: 'bg-secondary text-secondary-foreground',
};

export function RelationTag({ value }: { value: string }) {
  return <span className={cn('inline-flex h-5 items-center rounded-sm px-1.5 font-mono text-[10px] uppercase tracking-wider', RELATION_TONE[value] ?? 'bg-secondary')} data-testid={`tag-relation-${value}`}>{RELATION_LABEL[value] ?? value}</span>;
}

const unknownN = (v: number | null | undefined) => (v == null ? 'unknown' : v.toLocaleString('en-US'));
const coverageDate = (o: ReportingClaim) => o.publishedAt ? fmtDate(o.publishedAt) : o.suppliedDate ? fmtDate(o.suppliedDate) : 'date unknown';
const VERSION_LABEL = {
  selected: 'Evidence in selected text',
  'retained-excerpt': 'Other retained excerpt only',
  superseded: 'Superseded page copy only',
  unknown: 'Source version unclear',
};
function VersionContext({ version }: { version?: ReportingEvidenceVersion }) {
  if (!version) return null;
  return <p className="mt-1 text-[11px] text-muted-foreground" data-testid="evidence-version-context">
    {VERSION_LABEL[version.scope]}{version.source ? ` · ${version.source}` : ''}
    {version.capturedAt ? ` · captured ${fmtDate(version.capturedAt, true)}` : ''}
  </p>;
}

const useInvalidateProvenance = useInvalidateClaims;

/** Current (not superseded) review is the latest one not referenced by another review's supersedesId. */
function currentReview(reviews: ReportingReview[]) {
  const superseded = new Set(reviews.map(r => r.supersedesId).filter(Boolean) as string[]);
  return [...reviews].filter(r => !superseded.has(r.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function ReviewHistory({ reviews, onCorrect }: { reviews: ReportingReview[]; onCorrect?: (r: ReportingReview) => void }) {
  if (!reviews.length) return null;
  const superseded = new Set(reviews.map(r => r.supersedesId).filter(Boolean) as string[]);
  const sorted = [...reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <ol className="mt-1.5 space-y-1.5 border-l border-border pl-3">
    {sorted.map(r => <li key={r.id} className={cn('text-xs', superseded.has(r.id) && 'opacity-60')} data-testid={`row-review-${r.id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <RelationTag value={r.relation} />
        <Mono>{fmtDate(r.createdAt, true)} · workspace review</Mono>
        {superseded.has(r.id) && <Mono className="line-through">superseded</Mono>}
        {r.supersedesId && <Mono>corrects {r.supersedesId.slice(0, 8)}</Mono>}
        {onCorrect && !superseded.has(r.id) && <button className="text-[11px] underline" onClick={() => onCorrect(r)} data-testid={`button-correct-review-${r.id}`}>Correct</button>}
      </div>
      <p className="mt-0.5">{r.rationale}</p>
      {(r.pathKey || r.evidenceId) && <Mono>{r.pathKey ? `independent path ${r.pathKey}` : ''}{r.pathKey && r.evidenceId ? ' · ' : ''}{r.evidenceId ? `evidence ${r.evidenceId}` : ''}</Mono>}
      {r.targetClaimId && <Mono className="block">related observation {r.targetClaimId.slice(0, 8)}</Mono>}
    </li>)}
  </ol>;
}

type ReviewTarget =
  | { kind: 'claim'; observation: ReportingClaim; supersedes?: ReportingReview }
  | { kind: 'match'; match: ReportingMatch; supersedes?: ReportingReview };

function ReviewForm({ target, related, onDone }: { target: ReviewTarget; related: ReportingClaim[]; onDone: () => void }) {
  const isClaim = target.kind === 'claim';
  const [relation, setRelation] = useState<string>(target.supersedes?.relation ?? (isClaim ? 'unknown' : 'unresolved'));
  const [rationale, setRationale] = useState('');
  const [evidenceId, setEvidenceId] = useState(isClaim ? (target.observation.evidenceId ?? '') : '');
  const [independent, setIndependent] = useState(false);
  const [pathKey, setPathKey] = useState('');
  const [targetClaimId, setTargetClaimId] = useState('');
  const relatedChoices = isClaim ? related.filter(o => o.familyId === target.observation.familyId && o.id !== target.observation.id) : [];
  const [error, setError] = useState<string>();
  const review = useReviewReportingLineage();
  const invalidate = useInvalidateProvenance();
  const relations = isClaim ? CLAIM_RELATIONS : MATCH_RELATIONS;

  const submit = async () => {
    setError(undefined);
    if (rationale.trim().length < 5) return setError('Rationale must be at least 5 characters.');
    if (independent && (!evidenceId.trim() || pathKey.trim().length < 3)) return setError('An independent path needs an evidence ID and a path key (3+ characters).');
    try {
      await review.mutateAsync({ data: {
        ...(isClaim ? { claimObservationId: target.observation.id, targetClaimId: targetClaimId || null } : { sourceMatchId: target.match.id }),
        relation: relation as ReportingReviewInputRelation,
        rationale: rationale.trim(),
        supersedesId: target.supersedes?.id ?? null,
        evidenceId: isClaim && evidenceId.trim() ? evidenceId.trim() : null,
        pathKey: isClaim && independent ? pathKey.trim() : null,
      } });
      await invalidate();
      onDone();
    } catch (e) { setError(errText(e)); }
  };

  return <div className="mt-2 space-y-2 rounded-md border border-foreground/30 bg-background p-3" data-testid="form-lineage-review">
    <div className="flex items-center justify-between">
      <Mono>{target.supersedes ? `Correct review ${target.supersedes.id.slice(0, 8)}` : isClaim ? 'Review coverage relation' : 'Review source environment match'}</Mono>
      <button onClick={onDone} aria-label="Cancel review" className="text-muted-foreground hover:text-foreground" data-testid="button-cancel-review"><X className="h-3.5 w-3.5" /></button>
    </div>
    <div className="flex flex-wrap gap-1">
      {relations.map(r => <button key={r} type="button" onClick={() => setRelation(r)} aria-pressed={relation === r}
        className={cn('h-7 rounded-md border px-2 text-[11px]', relation === r ? 'border-foreground bg-foreground text-background' : 'border-border hover:border-foreground')} data-testid={`button-relation-${r}`}>{RELATION_LABEL[r]}</button>)}
    </div>
    {!isClaim && <p className="text-[11px] text-muted-foreground">This records whether two source descriptions share a reporting environment. It does not identify a person.</p>}
    {isClaim && <>
      {relatedChoices.length > 0 && <label className="block text-xs">Related observation in this proposition (optional)
        <select value={targetClaimId} onChange={e => setTargetClaimId(e.target.value)} className={cn(inputCls, 'mt-1 text-xs')} data-testid="select-review-target-observation">
          <option value="">None</option>
          {relatedChoices.map(o => <option key={o.id} value={o.id}>{o.outlet ?? '—'} · {coverageDate(o)} · {o.title}</option>)}
        </select>
      </label>}
      <label className="block text-xs">Retained quote evidence ID
        <input value={evidenceId} onChange={e => setEvidenceId(e.target.value)} placeholder="Links imported quote evidence to this claim" className={cn(inputCls, 'mt-1 font-mono text-xs')} data-testid="input-review-evidence" />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={independent} onChange={e => setIndependent(e.target.checked)} data-testid="checkbox-independent-path" />
        Record as an independent evidentiary path (requires evidence ID, path key and rationale)
      </label>
      {independent && <input value={pathKey} onChange={e => setPathKey(e.target.value)} placeholder="Path key, e.g. court-filing-0412" className={cn(inputCls, 'font-mono text-xs')} data-testid="input-review-pathkey" />}
    </>}
    <textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={3} placeholder="Why this relation holds, citing the passage." className="w-full rounded-md border border-input bg-background p-2 text-sm" data-testid="input-review-rationale" />
    <ErrorLine error={error} />
    <div className="flex justify-end gap-1.5">
      <button className={btnCls} onClick={onDone}>Cancel</button>
      <button className={primaryCls} onClick={submit} disabled={review.isPending} data-testid="button-submit-review">{review.isPending ? 'Saving…' : 'Record review'}</button>
    </div>
  </div>;
}

function SourceRow({ s }: { s: ReportingSource }) {
  return <li className="rounded-md border border-border p-2 text-xs" data-testid={`row-source-${s.id}`}>
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-semibold">{s.descriptor}</span>
      <Mono>{s.anonymity} · {s.sourceType}</Mono>
      <Mono>min. humans {unknownN(s.minimumHumans)}</Mono>
    </div>
    {s.excerpt && <blockquote className="mt-1 border-l-2 border-[hsl(212_20%_70%)] pl-2 font-serif">{s.excerpt}</blockquote>}
    <VersionContext version={s.evidenceVersion} />
    {(s.evidenceId || s.captureId || s.externalId || s.familyHypothesis || s.supplied) && <Disclosure label="Source record details" testId={`details-source-${s.id}`}>
      {s.supplied && <p className="text-muted-foreground">Imported with supplied analysis.</p>}
      {s.familyHypothesis && <p className="text-muted-foreground">Family hypothesis: {s.familyHypothesis}</p>}
      <Mono className="block break-all">{[s.evidenceId && `evidence ${s.evidenceId}`, s.captureId && `capture ${s.captureId}`, s.externalId && `external ${s.externalId}`].filter(Boolean).join(' · ')}</Mono>
    </Disclosure>}
  </li>;
}

const CONTEXT_KIND: Record<string, { label: string; cls: string }> = {
  Institutional_Responses: { label: 'Response / no comment', cls: 'border-dashed border-foreground/50' },
  Reporting_Evidence: { label: 'Reporting evidence', cls: 'border-border' },
  Source_Quotes: { label: 'Source quote', cls: 'border-l-2 border-l-foreground border-border' },
};
const contextKind = (c: ReportingContext) => CONTEXT_KIND[c.sheet] ?? { label: `Other · ${c.sheet}`, cls: 'border-border' };
/** Uses only explicit backend fields; no wording heuristics. */
function isUnmatched(c: ReportingContext) {
  const r = c.resolution ?? {};
  return r.status === 'unresolved-document' || (c.sheet === 'Source_Quotes' && r.excerptValidated === false);
}
const show = (v: unknown) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function ContextRowInner({ c }: { c: ReportingContext }) {
  const kind = contextKind(c);
  const r = c.resolution ?? {};
  return <li className={cn('rounded-md border p-2 text-xs', kind.cls)} data-testid={`row-context-${c.sheet}-${c.row}`}>
    <div className="flex flex-wrap items-center gap-1.5">
      <Mono className="text-foreground">{kind.label}</Mono>
      <Mono>supplied interpretation · {c.sheet} row {c.row}</Mono>
      {r.status === 'unresolved-document' ? <Mono className="text-red-800">article not resolved</Mono>
        : isUnmatched(c) ? <Mono className="text-red-800">quote unmatched in retained text</Mono>
        : typeof r.evidenceId === 'string' && r.evidenceId ? <Mono>excerpt validated · evidence {r.evidenceId}</Mono> : null}
    </div>
    <dl className="mt-1 grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
      {Object.entries(c.data).slice(0, 12).map(([k, v]) => <div key={k} className="min-w-0"><dt className="inline font-mono text-[10px] uppercase text-muted-foreground">{k} </dt><dd className="inline break-words">{show(v)}</dd></div>)}
    </dl>
    {Object.keys(c.resolution).length > 0 && <p className="mt-1 break-words font-mono text-[10px] text-muted-foreground">resolution {show(c.resolution)}</p>}
  </li>;
}

function ClaimObservation({ o, editable, onReview, onFocusEvent, highlight, sourceById }: { o: ReportingClaim; editable: boolean; onReview: (t: ReviewTarget) => void; onFocusEvent: (id: string) => void; highlight?: boolean; sourceById: Map<string, ReportingSource> }) {
  const cur = currentReview(o.reviews);
  const own = o.sourceIds.map(id => sourceById.get(id)).filter(Boolean) as ReportingSource[];
  return <li className={cn('tw-feed-item relative rounded-xl px-3 py-3.5 sm:px-4', highlight && 'bg-[hsl(150_18%_94%)]')} data-testid={`row-coverage-${o.id}`}>
        <ArticleHeading outlet={o.outlet ?? 'Unknown outlet'} title={o.title} date={coverageDate(o)}
          url={o.url ?? undefined} href={`/feed?article=${encodeURIComponent(o.articleId)}`} sourceTestId={`link-source-${o.id}`}>
          {cur ? <RelationTag value={cur.relation} /> : <span className={cn('rounded-sm px-1.5 py-0.5 text-[10px]', TONE.sage)} data-testid={`status-attribution-${o.id}`}>Article attribution</span>}
        </ArticleHeading>
      <div className="mt-3 min-w-0 sm:pl-20">
        <ClaimDirection o={o} editable={editable} />
        <p className="mt-1 text-[11px] font-medium" data-testid={`claim-evidence-scope-${o.id}`}>{VERSION_LABEL[o.evidenceScope ?? 'unknown']}</p>
        {o.excerpt && <blockquote className="mt-1 border-l-2 border-[hsl(212_20%_70%)] pl-2 font-serif text-sm">{o.excerpt}</blockquote>}
        <VersionContext version={o.displayedEvidenceVersion} />
        <Disclosure label="Retained evidence versions" count={o.evidenceVersions?.length} testId={`details-evidence-versions-${o.id}`}>
          <p className="text-[11px] text-muted-foreground">The quote above retains its original or reviewed evidence link. A matching passage may also occur in selected text; versions are not independent reporting.</p>
          {(o.evidenceVersions ?? []).map(v => <div key={v.evidenceId ?? v.captureId} className="mt-2">
            <VersionContext version={v} />
            {v.excerpt && <blockquote className="mt-1 border-l-2 border-border pl-2 font-serif text-sm">{v.excerpt}</blockquote>}
            <Mono className="block">capture {v.captureId ?? 'unknown'} · evidence {v.evidenceId ?? 'unknown'} · offsets {v.start ?? '?'}-{v.end ?? '?'}</Mono>
            <Mono className="block">body {v.bodyHash ?? 'unknown'} · selected {v.selectedBodyHash ?? 'unknown'}</Mono>
            <RetainedCopyComparison articleId={o.articleId} version={v} />
          </div>)}
        </Disclosure>
        {own.length > 0 && <Disclosure label="Supporting sources" count={own.length} testId={`details-sources-${o.id}`}>
          <ul className="space-y-1.5">{own.map(s => <SourceRow key={s.id} s={s} />)}</ul>
        </Disclosure>}
        <Disclosure label="Record identifiers" testId={`details-ids-${o.id}`}>
          <div className="space-y-0.5 break-all">
            {o.supplied && <p className="text-muted-foreground">Imported from supplied analysis workbook.</p>}
            {o.eventId && <p><button className="font-mono text-[10px] underline" onClick={() => onFocusEvent(o.eventId!)} data-testid={`button-event-${o.id}`}>Show all coverage for event {o.eventId}</button></p>}
            <Mono className="block">observation {o.id} · family {o.familyId}</Mono>
            {o.start != null && o.end != null && <Mono className="block">offsets {o.start}-{o.end}</Mono>}
            {o.captureId && <Mono className="block">capture {o.captureId}</Mono>}
            {o.evidenceId && <Mono className="block">evidence {o.evidenceId}</Mono>}
            {o.externalId && <Mono className="block">external {o.externalId}</Mono>}
            {(o.evidenceVersions ?? []).length > 0 && <div data-testid={`text-evidence-versions-${o.id}`}>
              <Mono className="block">{o.evidenceVersions!.length} evidence version{o.evidenceVersions!.length === 1 ? '' : 's'}</Mono>
              {o.evidenceVersions!.map(v => <Mono key={`${v.captureId}-${v.evidenceId}`} className="block">capture {v.captureId} · evidence {v.evidenceId}</Mono>)}
            </div>}
          </div>
        </Disclosure>
        {(editable || o.reviews.length > 0) && <Disclosure label="Advanced: relation and independence" count={o.reviews.length || undefined} testId={`details-review-${o.id}`}>
          <p className="text-[11px] text-muted-foreground">Optional. Records how this coverage relates to others; nothing is marked verified automatically.</p>
          <ReviewHistory reviews={o.reviews} onCorrect={editable ? (r) => onReview({ kind: 'claim', observation: o, supersedes: r }) : undefined} />
          {editable && !cur && <button className="mt-1 text-[11px] underline" onClick={() => onReview({ kind: 'claim', observation: o })} data-testid={`button-review-coverage-${o.id}`}>Record relation</button>}
        </Disclosure>}
      </div>
  </li>;
}

export function ProvenancePanel({ params, editable, heading = 'Source lineage', connect }: {
  params: Omit<GetReportingProvenanceParams, 'offset'>; editable: boolean; heading?: string;
  connect?: { articleId: string; evidenceId?: string; developmentId?: string };
}) {
  const [offset, setOffset] = useState(0);
  const [eventFocus, setEventFocus] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<ReviewTarget | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [evidenceScope, setEvidenceScope] = useState<NonNullable<GetReportingProvenanceParams['evidenceScope']>>('all');
  const base = eventFocus ? { eventId: eventFocus } : params;
  const p: GetReportingProvenanceParams = { ...base, evidenceScope, offset };
  const q = useGetReportingProvenance(p, { query: { queryKey: getGetReportingProvenanceQueryKey(p), staleTime: 30_000, gcTime: 5 * 60_000, refetchInterval: 120_000, retry: 1 } });
  const ws = useWorkspace();
  const claimRecords = useMemo(() => byKind(ws.data?.records, 'claim').map(c => ({ id: c.id, title: c.title })), [ws.data]);
  const reviewAnchor = useRef<HTMLDivElement>(null);

  const d = q.data;
  const families = useMemo(() => {
    const m = new Map<string, ReportingClaim[]>();
    for (const c of d?.claims ?? []) m.set(c.familyId, [...(m.get(c.familyId) ?? []), c]);
    return [...m.values()].map(list => list.sort((a, b) => (a.publishedAt ?? a.suppliedDate ?? '9').localeCompare(b.publishedAt ?? b.suppliedDate ?? '9')));
  }, [d]);
  const sourceById = useMemo(() => new Map((d?.sources ?? []).map(s => [s.id, s])), [d]);
  const otherSources = useMemo(() => { const used = new Set((d?.claims ?? []).flatMap(c => c.sourceIds)); return (d?.sources ?? []).filter(s => !used.has(s.id)); }, [d]);

  const startReview = (t: ReviewTarget) => { setReviewing(t); requestAnimationFrame(() => reviewAnchor.current?.scrollIntoView({ block: 'nearest' })); };

  return <section className="mt-6 min-w-0 max-w-full [overflow-wrap:anywhere]" data-testid="panel-provenance">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1">
      <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{heading}{eventFocus && <> · event {eventFocus}</>}</h3>
      <div className="flex items-center gap-1.5">
        {eventFocus && <button className="text-[11px] underline" onClick={() => { setEventFocus(null); setOffset(0); }} data-testid="button-clear-event">Back to selection</button>}
        {editable && connect && <button className={btnCls} onClick={() => setConnecting(v => !v)} data-testid="button-connect-passage">{connecting ? 'Close' : 'Connect passage to claim'}</button>}
        <button onClick={() => q.refetch()} aria-label="Refresh lineage" className="text-muted-foreground hover:text-foreground" data-testid="button-refresh-provenance"><RefreshCw className={cn('h-3.5 w-3.5', q.isFetching && 'animate-spin')} /></button>
      </div>
    </div>
    <label className="block text-xs">Claim evidence scope
      <select value={evidenceScope} onChange={e => { setEvidenceScope(e.target.value as typeof evidenceScope); setOffset(0); setReviewing(null); }}
        className={cn(inputCls, 'mt-1 text-xs')} data-testid="select-evidence-scope">
        <option value="all">All retained history</option>
        {Object.entries(VERSION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <p className="mt-1 text-[11px] text-muted-foreground">Selected text is not necessarily complete. Absence from it does not make an older claim false. Filters change the claim list, not retained evidence, reviews, or article-wide source counts.</p>

    {connecting && connect && <ConnectPassage {...connect} claims={claimRecords} sources={(d?.sources ?? []).filter(s => s.articleId === connect.articleId)} onDone={() => setConnecting(false)} />}

    {q.isLoading ? <div className="space-y-2" aria-busy data-testid="provenance-loading">{[80, 95, 60].map((w, i) => <div key={i} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />)}</div>
      : q.isError || !d ? <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs" data-testid="provenance-error"><span className="text-muted-foreground">Lineage could not be loaded. {errText(q.error)}</span><button className="underline" onClick={() => q.refetch()}>Retry</button></div>
      : <>
        <Disclosure label="Lineage counts across all retained history" testId="details-provenance-counts">
        <dl className="grid grid-cols-2 gap-2" data-testid="provenance-counts">
          {([['Articles', d.counts.articles], ['Occurrences', d.counts.occurrences], ['Min. anonymous humans', d.counts.minimumAnonymousHumans], ['Supplied provisional records', d.counts.provisionalSourceRecords], ['Reviewed independent paths', d.counts.independentPaths]] as const).map(([k, v]) =>
            <div key={k} className="rounded-md border border-border px-2 py-1.5"><dt><Mono>{k}</Mono></dt><dd className={cn('font-mono text-sm', v == null && 'text-muted-foreground')}>{unknownN(v)}</dd></div>)}
        </dl>
        <p className="mt-1 text-[11px] text-muted-foreground">Repeated coverage is not counted as independent. Independent paths come only from recorded reviews with evidence and a path key.</p>
        {d.counts.suppliedMinimumAnonymousHumans != null && <p className="mt-1 text-[11px] text-muted-foreground">Supplied, unreviewed minimum anonymous humans: {d.counts.suppliedMinimumAnonymousHumans}. Group overlaps are not summed.</p>}

        </Disclosure>

        <div ref={reviewAnchor}>{reviewing && <ReviewForm key={`${reviewing.kind}-${reviewing.kind === 'claim' ? reviewing.observation.id : reviewing.match.id}-${reviewing.supersedes?.id ?? ''}`} target={reviewing} related={d.claims} onDone={() => setReviewing(null)} />}</div>

        <h4 className="mt-4 mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Reported in provided articles</h4>
        {families.length === 0 ? <p className="text-xs text-muted-foreground" data-testid="text-no-coverage">{evidenceScope === 'all' ? 'No passages connected yet. Open an article and connect an exact passage to this claim.' : 'No claims match this evidence scope. Choose all retained history to see other attributions.'}</p>
          : families.map(list => <div key={list[0].familyId} className="mb-4" data-testid={`family-${list[0].familyId}`}>
            <p className="font-serif text-[15px] leading-snug">{list[0].proposition}</p>
            <ol className="mt-1.5 space-y-1">
              {list.map(o => <ClaimObservation key={o.id} o={o} sourceById={sourceById} editable={editable} onReview={startReview} onFocusEvent={(id) => { setEventFocus(id); setOffset(0); }} highlight={!!params.evidenceId && o.evidenceId === params.evidenceId} />)}
            </ol>
          </div>)}
        {d.total > PAGE && <div className="flex items-center justify-end gap-2">
          <Mono>{offset + 1}-{Math.min(offset + PAGE, d.total)} of {d.total}</Mono>
          <button className={btnCls} disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE))} data-testid="button-provenance-prev"><ChevronLeft className="h-3 w-3" /></button>
          <button className={btnCls} disabled={offset + PAGE >= d.total} onClick={() => setOffset(o => o + PAGE)} data-testid="button-provenance-next"><ChevronRight className="h-3 w-3" /></button>
        </div>}

        {otherSources.length > 0 && <Disclosure label={families.length ? 'Other sources in these articles' : 'Sources'} count={otherSources.length} testId="details-article-sources" className="mt-4">
          <ul className="space-y-1.5">{otherSources.map(s => <SourceRow key={s.id} s={s} />)}</ul>
        </Disclosure>}

        {d.matches.length > 0 && <Disclosure label="Advanced: source environment matches" count={d.matches.length} testId="details-matches">
          <ul className="space-y-1.5">{d.matches.map(m => <li key={m.id} className="rounded-md border border-border p-2 text-xs" data-testid={`row-match-${m.id}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">{sourceById.get(m.sourceA)?.descriptor ?? m.sourceA}</span><Mono>and</Mono><span className="font-semibold">{sourceById.get(m.sourceB)?.descriptor ?? m.sourceB}</span>
              {currentReview(m.reviews) ? <RelationTag value={currentReview(m.reviews)!.relation} /> : <Mono>unreviewed</Mono>}
              {m.supplied && <Mono className="border border-dashed border-muted-foreground px-1">supplied</Mono>}
            </div>
            <p className="mt-0.5">Hypothesis: {m.hypothesis}</p>
            {m.rationale && <p className="text-muted-foreground">{m.rationale}</p>}
            {m.conflicts && <p className="text-red-800">Conflicts: {m.conflicts}</p>}
            <ReviewHistory reviews={m.reviews} onCorrect={editable ? (r) => startReview({ kind: 'match', match: m, supersedes: r }) : undefined} />
            {editable && !currentReview(m.reviews) && <button className="mt-1 text-[11px] underline" onClick={() => startReview({ kind: 'match', match: m })} data-testid={`button-review-match-${m.id}`}>Review match</button>}
          </li>)}</ul>
        </Disclosure>}

        {d.context.length > 0 && <Disclosure label={`Original workbook context${d.context.length >= CONTEXT_LIMIT ? ' (first 100 shown)' : ''}`} count={d.context.length} testId="details-context">
          <ul className="space-y-1.5">{d.context.map(c => <ContextRowInner key={`${c.sheet}-${c.row}`} c={c} />)}</ul>
        </Disclosure>}
      </>}
  </section>;
}

function ConnectPassage({ articleId, evidenceId, developmentId, claims, sources, onDone }: { articleId: string; evidenceId?: string; developmentId?: string; claims: { id: string; title: string }[]; sources: ReportingSource[]; onDone: () => void }) {
  const capsQ = useListEntityCaptures({ articleId }, { query: { queryKey: getListEntityCapturesQueryKey({ articleId }), staleTime: 60_000 } });
  const [claimId, setClaimId] = useState('');
  const [captureId, setCaptureId] = useState('');
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [descriptor, setDescriptor] = useState('');
  const [proposition, setProposition] = useState('');
  const [anonymity, setAnonymity] = useState<'Named' | 'Unnamed' | 'Unknown'>('Unknown');
  const [eventId, setEventId] = useState('');
  const [entityEventId, setEntityEventId] = useState('');
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const connectM = useConnectReportingPassage();
  const invalidate = useInvalidateProvenance();
  const selectedCapture = capsQ.data?.items.find(c => c.id === captureId);
  const cp = selectedCapture ? { capture: selectedCapture.captureId } : undefined;
  const textQ = useGetArticleContent(articleId, cp, { query: { queryKey: getGetArticleContentQueryKey(articleId, cp), enabled: !!selectedCapture, staleTime: 5 * 60_000 } });
  const text = textQ.data?.text ?? '';
  const excerpt = sel ? text.slice(sel.start, sel.end) : '';
  const descriptorOk = descriptor.trim().length > 0 && text.includes(descriptor.trim());

  const submit = async () => {
    setError(undefined);
    if (!claimId) return setError('Choose an existing Claims record.');
    if (!captureId || !sel || !excerpt.trim()) return setError('Select an exact passage in the retained text.');
    if (!descriptorOk) return setError('Source descriptor must appear verbatim in this capture.');
    if (proposition.trim().length < 3) return setError('State the proposition the passage supports.');
    try {
      await connectM.mutateAsync({ data: {
        articleId, claimId, captureId, excerpt, start: sel.start, end: sel.end,
        ...(evidenceId ? { evidenceId } : {}), ...(developmentId ? { developmentId } : {}),
        descriptor: descriptor.trim(), proposition: proposition.trim(), anonymity,
        eventId: eventId.trim() || null, entityEventId: entityEventId.trim() || null,
        ...(sourceIds.length ? { sourceIds } : {}),
      } });
      await invalidate();
      onDone();
    } catch (e) { setError(errText(e)); }
  };

  const captures = capsQ.data?.items ?? [];
  return <div className="mb-4 space-y-2 rounded-md border border-foreground/30 bg-background p-3 text-xs" data-testid="form-connect-passage">
    <label className="block">Claims record
      <select value={claimId} onChange={e => setClaimId(e.target.value)} className={cn(inputCls, 'mt-1 text-xs')} data-testid="select-connect-claim">
        <option value="">Choose a claim</option>
        {claims.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>
    </label>
    <label className="block">Immutable capture
      {capsQ.isLoading ? <div className="mt-1 h-8 animate-pulse rounded bg-muted" /> : capsQ.isError ? <p className="mt-1 text-red-800">Captures could not be loaded. <button className="underline" onClick={() => capsQ.refetch()}>Retry</button></p>
        : captures.length === 0 ? <p className="mt-1 text-muted-foreground">No immutable captures for this article yet.</p>
        : <select value={captureId} onChange={e => { setCaptureId(e.target.value); setSel(null); }} className={cn(inputCls, 'mt-1 text-xs')} data-testid="select-connect-capture">
          <option value="">Choose a capture</option>
          {captures.map(c => <option key={c.id} value={c.id}>{c.publisher ?? c.source} · {fmtDate(c.capturedAt, true)}{c.complete ? '' : ' · partial'}</option>)}
        </select>}
    </label>
    {captureId && (textQ.isLoading ? <div className="h-24 animate-pulse rounded bg-muted" />
      : textQ.isError ? <p className="text-red-800">Retained text could not be loaded. <button className="underline" onClick={() => textQ.refetch()}>Retry</button></p>
      : <div>
        <Mono>Select the exact passage below</Mono>
        <textarea readOnly value={text} rows={8} onSelect={e => { const t = e.currentTarget; setSel(t.selectionEnd > t.selectionStart ? { start: t.selectionStart, end: t.selectionEnd } : null); }}
          className="mt-1 w-full rounded-md border border-input bg-card p-2 font-serif text-[13px] leading-relaxed" data-testid="textarea-connect-text" />
        {sel ? <blockquote className="mt-1 border-l-2 border-foreground pl-2 font-serif" data-testid="text-connect-excerpt">{excerpt}<Mono className="ml-2">{sel.start}-{sel.end}</Mono></blockquote> : <p className="text-muted-foreground">No passage selected.</p>}
      </div>)}
    <label className="block">Source descriptor (verbatim in capture)
      <input value={descriptor} onChange={e => setDescriptor(e.target.value)} placeholder="e.g. two officials familiar with the talks" className={cn(inputCls, 'mt-1 text-xs')} data-testid="input-connect-descriptor" />
      {descriptor.trim() && captureId && !textQ.isLoading && <span className={cn('mt-0.5 block text-[11px]', descriptorOk ? 'text-muted-foreground' : 'text-red-800')}>{descriptorOk ? 'Found in capture.' : 'Not found verbatim in this capture.'}</span>}
    </label>
    <div className="flex flex-wrap gap-1">{(['Named', 'Unnamed', 'Unknown'] as const).map(a => <button key={a} type="button" onClick={() => setAnonymity(a)} aria-pressed={anonymity === a} className={cn('h-7 rounded-md border px-2 text-[11px]', anonymity === a ? 'border-foreground bg-foreground text-background' : 'border-border')} data-testid={`button-anonymity-${a}`}>{a}</button>)}</div>
    <label className="block">Proposition
      <textarea value={proposition} onChange={e => setProposition(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm" data-testid="input-connect-proposition" />
    </label>
    <div className="grid gap-2 sm:grid-cols-2">
      <input value={eventId} onChange={e => setEventId(e.target.value)} placeholder="Event ID (optional)" className={cn(inputCls, 'font-mono text-xs')} data-testid="input-connect-event" />
      <input value={entityEventId} onChange={e => setEntityEventId(e.target.value)} placeholder="Event entity ID (optional)" className={cn(inputCls, 'font-mono text-xs')} data-testid="input-connect-entity-event" />
    </div>
    {sources.length > 0 && <fieldset><Mono>Joint attribution to existing source records (optional)</Mono>
      <div className="mt-1 space-y-0.5">{sources.map(s => <label key={s.id} className="flex items-center gap-2">
        <input type="checkbox" checked={sourceIds.includes(s.id)} onChange={e => setSourceIds(v => e.target.checked ? [...v, s.id].slice(0, 20) : v.filter(x => x !== s.id))} data-testid={`checkbox-source-${s.id}`} />{s.descriptor}
      </label>)}</div>
    </fieldset>}
    <ErrorLine error={error} />
    <div className="flex justify-end gap-1.5">
      <button className={btnCls} onClick={onDone}>Cancel</button>
      <button className={primaryCls} onClick={submit} disabled={connectM.isPending} data-testid="button-submit-connect">{connectM.isPending ? 'Connecting…' : 'Connect passage'}</button>
    </div>
  </div>;
}
