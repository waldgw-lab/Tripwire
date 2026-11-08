import { useMemo, useState } from 'react';
import { useWorkspaceAccess } from '@/lib/workspace-access';
import { getGetClaimCoverageSummariesQueryKey, useGetClaimCoverageSummaries, type TrackedRecord } from '@workspace/api-client-react';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Empty, ErrorState, PageHead, RowsSkeleton } from '@/components/bits';
import { ClaimEditor, ConfirmDelete } from '@/components/editors';
import { Disclosure, ProvenancePanel, TONE } from '@/components/provenance/provenance-panel';
import { OutletBrand } from '@/components/outlet-brand';
import { ClaimProcessingStatus } from '@/components/provenance/claim-processing';
import { STAGES, byKind, fmtDate, useWorkspace } from '@/lib/workspace';
import { orderClaims } from '@/lib/claim-order';

const isImportNote = (s?: string) => !!s && /supplied analysis|unreviewed claim-family/i.test(s);

function shortDate(s: string) {
  return fmtDate(s);
}
function dateRange(first: string | null, last: string | null) {
  if (!first && !last) return 'Date unknown';
  if (!first || !last || shortDate(first) === shortDate(last)) return shortDate((first ?? last)!);
  return `${shortDate(first)} – ${shortDate(last)}`;
}

export default function ClaimsPage() {
  const { canEdit: isSignedIn } = useWorkspaceAccess();
  const { data, isLoading, isError, refetch } = useWorkspace();
  const sumQ = useGetClaimCoverageSummaries({ query: { queryKey: getGetClaimCoverageSummariesQueryKey(), staleTime: 15_000, refetchInterval: 30_000, retry: 1 } });
  const summaryById = useMemo(() => new Map((sumQ.data ?? []).map((s) => [s.claimId, s])), [sumQ.data]);
  const claims = useMemo(() => orderClaims(byKind(data?.records, 'claim'), summaryById), [data, summaryById]);
  const ongoingCount = claims.filter(c => summaryById.get(c.id)?.ongoing).length;
  const articles = useMemo(() => byKind(data?.records, 'article'), [data]);
  const articleById = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<TrackedRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TrackedRecord | null>(null);
  const current = claims.find((c) => c.id === sel) ?? claims[0];
  const legacy = current?.observations ?? [];

  return (
    <div className="tw-rise flex min-h-[100dvh] flex-col">
      <PageHead title="Claims" count={claims.length}>
        {isSignedIn
          ? <button onClick={() => setCreating(true)} data-testid="button-new-claim" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> Claim</button>
          : null}
      </PageHead>
      <ClaimProcessingStatus canRetry={isSignedIn} />
      {isLoading ? <RowsSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} /> : claims.length === 0 ? (
        <Empty title="No claim histories" />
      ) : (
        <div className="grid flex-1 md:grid-cols-[320px_minmax(0,1fr)]">
          <ul className="border-b border-border md:border-b-0 md:border-r">
            {sumQ.isError && <li className="flex items-center justify-between px-5 py-2 text-[11px] text-muted-foreground" data-testid="text-summary-error">Coverage summaries unavailable <button className="underline" onClick={() => sumQ.refetch()}>Retry</button></li>}
            {claims.map((c, index) => {
              const sm = summaryById.get(c.id);
              const active = current?.id === c.id;
              return (
                <li key={c.id}>
                  {index === 0 && ongoingCount > 0 && <div className="border-b border-border px-5 py-2 font-mono text-[10px] uppercase tracking-wide" data-testid="heading-ongoing-claims">Ongoing developments · {ongoingCount}<p className="mt-1 normal-case tracking-normal text-muted-foreground">Leadership first · latest reporting within each topic</p></div>}
                  {index === ongoingCount && ongoingCount > 0 && <div className="border-y border-border px-5 py-2 font-mono text-[10px] uppercase tracking-wide" data-testid="heading-other-claims">Other claims · latest reporting first</div>}
                  <button onClick={() => setSel(c.id)} data-testid={`button-claim-${c.id}`}
                    className={cn('w-full border-l-2 px-5 py-3 text-left transition-colors', active ? 'border-[hsl(212_24%_42%)] bg-[hsl(212_20%_96%)]' : 'border-transparent hover:bg-card/60')}>
                    {sm?.ongoing && <span className="mb-1 block font-mono text-[9px] uppercase text-muted-foreground" title={sm.developmentReason ?? undefined}>{sm.developmentType}</span>}
                    <p className="line-clamp-2 font-serif text-[15px] leading-snug">{c.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-muted-foreground" data-testid={`text-claim-coverage-${c.id}`}>
                      {sumQ.isLoading ? <span className="inline-block h-2.5 w-28 animate-pulse rounded bg-muted" />
                        : sumQ.isError ? <span>Coverage unknown</span>
                        : !sm ? <span>No article attributions</span>
                        : <><span>{dateRange(sm.firstDate, sm.lastDate)}</span><span aria-hidden>·</span><span className={cn('rounded-sm px-1', active ? TONE.slate : '')}>{sm.attributions.toLocaleString('en-US')} attribution{sm.attributions === 1 ? '' : 's'}</span></>}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
          {current && (
            <section className="min-w-0 px-5 py-6 md:px-10" data-testid={`detail-claim-${current.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  {current.topic && <p className="font-mono text-[11px] uppercase tracking-wider text-[hsl(212_24%_38%)]">{current.topic}</p>}
                  <h2 className="mt-1 max-w-3xl font-serif text-2xl leading-tight">{current.title}</h2>
                  {current.summary && !isImportNote(current.summary) && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{current.summary}</p>}
                  {(current.entities ?? []).length > 0 && <div className="mt-2 flex flex-wrap gap-1">{current.entities!.map((e) => <span key={e} className={cn('rounded-sm px-1.5 py-0.5 text-[11px]', TONE.slate)}>{e}</span>)}</div>}
                  {isImportNote(current.summary) && <Disclosure label="Import provenance" testId="details-import-provenance" className="max-w-3xl"><p className="text-muted-foreground">{current.summary}</p></Disclosure>}
                </div>
                {isSignedIn && (
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => setEditing(current)} className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground" data-testid="button-edit-claim"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => setDeleting(current)} className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-destructive" data-testid="button-delete-claim"><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
              </div>

              <ProvenancePanel key={current.id} params={{ claimId: current.id }} editable={isSignedIn} heading="Coverage" />

              {legacy.length > 0 && (
                <div className="mt-8" data-testid="section-legacy-observations">
                  <p className="mb-2 border-b border-border pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground" data-testid="text-legacy-note">Manual timeline · legacy assessments</p>
                  <div className="space-y-5">
                    {STAGES.map((stage) => {
                      const obs = legacy.filter((o) => o.stage === stage).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
                      if (!obs.length) return null;
                      return (
                        <div key={stage} className="grid gap-2 md:grid-cols-[110px_1fr]">
                          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground md:pt-2">{stage}</span>
                          <ol className="space-y-2">
                            {obs.map((o) => {
                              const art = articleById.get(o.articleId);
                              return (
                                <li key={o.id} className="flex items-start gap-3" data-testid={`observation-${o.id}`}>
                                  <OutletBrand name={art?.outlet ?? '?'} variant="square" className="h-9 w-9 border border-border" />
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                                      <time className="font-mono text-[11px] text-muted-foreground">{fmtDate(o.observedAt)}</time>
                                      {art?.outlet && <span className="font-semibold">{art.outlet}</span>}
                                      {o.journalist && <span className="text-muted-foreground">{o.journalist}</span>}
                                      <span className={cn('rounded-sm px-1.5 py-0.5 text-[10px]', o.verified ? TONE.sage : TONE.clay)}>{o.verified ? 'legacy verified' : 'legacy unverified'}</span>
                                      {(o.url || art?.url) && <a href={o.url || art?.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /></a>}
                                    </div>
                                    {art && <p className="mt-0.5 text-sm">{art.title}</p>}
                                    {o.attribution && <blockquote className="mt-1 font-serif text-[15px] italic">“{o.attribution}”</blockquote>}
                                    {o.evidence && <p className="mt-1 text-sm text-muted-foreground">{o.evidence}</p>}
                                  </div>
                                </li>
                              );
                            })}
                          </ol>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
      <ClaimEditor open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }} record={editing} articles={articles} />
      <ConfirmDelete target={deleting} onClose={() => { setDeleting(null); setSel(null); }} />
    </div>
  );
}
