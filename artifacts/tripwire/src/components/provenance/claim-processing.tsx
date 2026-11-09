import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { getGetClaimProcessingQueryKey, useGetClaimProcessing, useProcessArticleClaims } from '@workspace/api-client-react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { errText, fmtDate, useInvalidateClaims } from '@/lib/workspace';
import { Disclosure, TONE } from './provenance-panel';

const STATUS_TONE: Record<string, string> = { pending: TONE.slate, complete: TONE.sage, 'no-claims': 'bg-muted text-muted-foreground', failed: TONE.clay, superseded: 'bg-muted text-muted-foreground line-through' };
const STATUS_LABEL: Record<string, string> = { pending: 'queued', complete: 'processed', 'no-claims': 'no matching statements', failed: 'failed', superseded: 'superseded', 'not-processed': 'not processed' };

/** Compact local-processing status, shown in Dashboard Operations under Claims processing. Polls every 10s; invalidates claim data only when recent activity changes. */
export function ClaimProcessingStatus({ canRetry }: { canRetry: boolean }) {
  const q = useGetClaimProcessing({ query: { queryKey: getGetClaimProcessingQueryKey(), refetchInterval: 10_000, staleTime: 5_000, retry: 1 } });
  const invalidate = useInvalidateClaims();
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  const signature = useMemo(() => q.data ? q.data.recent.flatMap(r => [r, ...(r.history ?? [])]).map(r => `${r.jobId ?? r.articleId}:${r.status}:${r.updatedAt}`).join('|') : null, [q.data]);
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (signature == null) return;
    if (lastSig.current !== signature && (lastSig.current != null || q.data?.recent.some(r => r.status === 'complete' || r.status === 'no-claims'))) void invalidateRef.current();
    lastSig.current = signature;
  }, [signature, q.data]);
  const retry = useProcessArticleClaims();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string>();
  const doRetry = async (articleId: string) => {
    setRetrying(articleId); setRetryError(undefined);
    try { await retry.mutateAsync({ articleId }); await q.refetch(); }
    catch (e) { setRetryError(errText(e)); }
    finally { setRetrying(null); }
  };
  const d = q.data;
  return (
    <div className="px-4 py-2.5 text-xs" data-testid="panel-claim-processing">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground">New retained articles are read locally into passage-backed claims. No model or publisher requests.</span>
        {q.isLoading ? <span className="inline-block h-2.5 w-24 animate-pulse rounded bg-muted" />
          : q.isError ? <span className="text-muted-foreground" data-testid="text-processing-error">Status unavailable <button className="underline" onClick={() => q.refetch()}>Retry</button></span>
          : d && <span className="flex items-center gap-1.5 font-mono text-[10px]">
            <span className={cn('rounded-sm px-1.5 py-0.5', TONE.slate)} data-testid="text-processing-pending">{d.pending} pending versions</span>
            <span className={cn('rounded-sm px-1.5 py-0.5', d.failed ? TONE.clay : 'bg-muted text-muted-foreground')} data-testid="text-processing-failed">{d.failed} failed versions</span>
          </span>}
      </div>
      {d && d.recent.length > 0 && <Disclosure label="Recent processing" count={d.recent.length} testId="details-processing-recent" className="max-w-3xl">
        <ul className="space-y-1">
          {d.recent.filter((r, i, all) => all.findIndex(x => x.articleId === r.articleId) === i).map(r => <li key={r.articleId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5" data-testid={`row-processing-${r.articleId}`}>
            <span className={cn('rounded-sm px-1.5 py-0.5 font-mono text-[10px]', STATUS_TONE[r.status] ?? 'bg-muted')}>{STATUS_LABEL[r.status] ?? r.status}</span>
            <span className="min-w-0 flex-1 truncate">{r.title}</span>
            {r.status === 'complete' && <span className="font-mono text-[10px] text-muted-foreground">{r.claims} claim{r.claims === 1 ? '' : 's'} in {r.current ? 'current text' : 'this version'}</span>}
            {r.bodyCharacters != null && <span className="font-mono text-[10px] text-muted-foreground">{r.bodyCharacters.toLocaleString()} chars</span>}
            <time className="font-mono text-[10px] text-muted-foreground">{fmtDate(r.updatedAt, true)}</time>
            {r.status === 'failed' && canRetry && <button className="inline-flex items-center gap-1 underline" disabled={retrying === r.articleId} onClick={() => doRetry(r.articleId)} data-testid={`button-retry-processing-${r.articleId}`}>
              <RefreshCw className={cn('h-3 w-3', retrying === r.articleId && 'animate-spin')} /> Retry</button>}
            {r.error && <p className="w-full pl-1 text-[11px] text-[hsl(18_30%_34%)]">{r.error}</p>}
            {(r.history?.length ?? 0) > 0 && <details className="w-full border-l border-border pl-3 text-muted-foreground" data-testid={`history-processing-${r.articleId}`}>
              <summary className="cursor-pointer py-1 text-[11px]">Other retained versions · {r.history?.length}</summary>
              <ul className="space-y-1 pb-1">
                {r.history?.map(h => <li key={h.jobId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5" data-testid={`row-processing-version-${h.jobId}`}>
                  <span className={cn('rounded-sm px-1.5 py-0.5 font-mono text-[10px]', STATUS_TONE[h.status] ?? 'bg-muted')}>{STATUS_LABEL[h.status] ?? h.status}</span>
                  <span className="font-mono text-[10px]">{h.bodyCharacters === null ? 'Text size unknown' : `${h.bodyCharacters.toLocaleString()} chars`}</span>
                  {h.status === 'complete' && <span className="font-mono text-[10px]">{h.claims} claims in this version</span>}
                  <time className="font-mono text-[10px]">{fmtDate(h.updatedAt, true)}</time>
                  {h.error && <p className="w-full text-[11px]">{h.error}</p>}
                </li>)}
              </ul>
            </details>}
          </li>)}
        </ul>
        {retryError && <p className="mt-1 text-[11px] text-[hsl(18_30%_34%)]" data-testid="text-retry-error">{retryError}</p>}
        <p className="mt-1.5 text-[11px] text-muted-foreground">One row per article, showing its selected text. Counts are per version—not additional articles or counts to add together. Local rules may not find every claim. Policy {d.policy}</p>
      </Disclosure>}
    </div>
  );
}

/** Explicit, analyst-triggered queueing of retained text. Never runs on mount. */
export function ProcessArticleButton({ articleId }: { articleId: string }) {
  const m = useProcessArticleClaims();
  const invalidate = useInvalidateClaims();
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'queued'; fresh: boolean } | { kind: 'error'; msg: string }>({ kind: 'idle' });
  const run = async () => {
    setState({ kind: 'idle' });
    try { const r = await m.mutateAsync({ articleId }); setState({ kind: 'queued', fresh: r.queued }); void invalidate(); }
    catch (e) { setState({ kind: 'error', msg: errText(e) }); }
  };
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <button type="button" onClick={run} disabled={m.isPending} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs hover:border-foreground disabled:opacity-50" data-testid="button-process-claims">
        <RefreshCw className={cn('h-3.5 w-3.5', m.isPending && 'animate-spin')} /> {m.isPending ? 'Queueing…' : 'Process retained text into claims'}
      </button>
      {state.kind === 'queued' && <span className="text-muted-foreground" data-testid="text-process-queued">{state.fresh ? 'Queued for local processing.' : 'Already processed or queued.'} <Link href="/claims" className="underline" data-testid="link-process-claims">View in Claims</Link></span>}
      {state.kind === 'error' && <span className="text-[hsl(18_30%_34%)]" data-testid="text-process-error">{state.msg}</span>}
    </div>
  );
}
