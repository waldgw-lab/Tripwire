import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getQuickEnrichmentText, getGetQuickEnrichmentQueryKey, useGetQuickEnrichment, useQueueQuickEnrichment, useRetryQuickEnrichment,
  type QuickEnrichmentQueue,
  type QuickEnrichmentJob, type TrackedRecord,
} from '@workspace/api-client-react';
import { ChevronDown, ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/bits';
import { errText, fmtDate, useInvalidateWorkspace, useWorkspace } from '@/lib/workspace';

const MIN = 250;
const MAX = 1_000_000;
const draftKey = (id: string) => `tw-qe-draft:${id}`;
const readDraft = (id: string) => { try { return sessionStorage.getItem(draftKey(id)) ?? ''; } catch { return ''; } };
const writeDraft = (id: string, v: string) => { try { if (v) sessionStorage.setItem(draftKey(id), v); else sessionStorage.removeItem(draftKey(id)); } catch { /* storage unavailable */ } };

type Row = { articleId: string; title: string; url?: string | null; outlet?: string; ingestedAt?: string; summary?: string; job?: QuickEnrichmentJob };

const statusTone: Record<string, string> = {
  queued: 'border-border text-muted-foreground',
  running: 'border-foreground/40 text-foreground',
  saved: 'border-[hsl(152_30%_32%)]/50 text-[hsl(152_30%_32%)]',
  failed: 'border-destructive/50 text-destructive',
};

function QueueRow({ row }: { row: Row }) {
  const { articleId, job } = row;
  const [open, setOpen] = useState(false);
  const [text, setTextState] = useState(() => readDraft(articleId));
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useQueueQuickEnrichment();
  const retry = useRetryQuickEnrichment();
  const qc = useQueryClient();
  const request = useRef<{ text: string; id: string } | null>(null);
  const accepted = (next: QuickEnrichmentJob) => {
    qc.setQueryData<QuickEnrichmentQueue>(getGetQuickEnrichmentQueryKey(), previous => previous && ({
      ...previous, jobs: [next, ...previous.jobs.filter(j => j.id !== next.id)],
    }));
    void qc.invalidateQueries({ queryKey: getGetQuickEnrichmentQueryKey() });
  };
  const typed = useRef(false);
  const restoredFor = useRef<string | null>(null);
  const setText = (v: string) => { typed.current = true; setTextState(v); writeDraft(articleId, v); };

  const failed = job?.status === 'failed';
  const active = job?.status === 'queued' || job?.status === 'running';

  useEffect(() => {
    if (!open || !failed || !job || restoredFor.current === job.id || text) return;
    restoredFor.current = job.id;
    typed.current = false;
    setRestoring(true);
    getQuickEnrichmentText(job.id)
      .then(r => { if (!typed.current) { setTextState(r.text); writeDraft(articleId, r.text); } })
      .catch(e => setError(`Could not restore pasted text: ${errText(e)}`))
      .finally(() => setRestoring(false));
  }, [open, failed, job, text, articleId]);

  const len = text.length;
  const valid = len >= MIN && len <= MAX;

  const submit = async () => {
    if (!valid || busy) return;
    setError(null); setBusy(true);
    try {
      if (request.current?.text !== text) request.current = { text, id: crypto.randomUUID() };
      const result = await queue.mutateAsync({ data: { articleId, text, requestId: request.current!.id } });
      accepted(result);
      request.current = null;
      setTextState(''); writeDraft(articleId, ''); setOpen(false);
    } catch (e) {
      setError(`Queue failed: ${errText(e)}`);
    } finally { setBusy(false); }
  };

  const requeue = async () => {
    if (!job) return;
    setError(null); setBusy(true);
    try { accepted(await retry.mutateAsync({ id: job.id })); }
    catch (e) { setError(`Retry failed: ${errText(e)}`); }
    finally { setBusy(false); }
  };

  const panelId = `qe-panel-${articleId}`;
  const articleUrl = row.url && /^https?:\/\//i.test(row.url) ? row.url : undefined;
  return (
    <li className="border-t border-border/60 first:border-t-0" data-testid={`row-quick-enrich-${articleId}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={panelId}
          aria-label={`${open ? 'Collapse' : 'Expand'} editor for ${row.title}`}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          data-testid={`button-toggle-quick-enrich-${articleId}`}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          {articleUrl ? (
            <a href={articleUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium hover:underline underline-offset-4" data-testid={`link-quick-enrich-article-${articleId}`}>{row.title}</a>
          ) : <span className="block truncate text-sm font-medium">{row.title}</span>}
          <div className="truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {[row.outlet, row.ingestedAt ? fmtDate(row.ingestedAt, true) : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        {busy && !open && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Submitting" />}
        {job && (
          <span title={job.error} className={cn('inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider', statusTone[job.status])} data-testid={`status-quick-enrich-${articleId}`}>
            {job.status === 'running' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}{job.status}
          </span>
        )}
        {failed && (
          <button onClick={requeue} disabled={busy} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[11px] hover:border-foreground disabled:opacity-50" data-testid={`button-retry-quick-enrich-${articleId}`}>
            <RotateCcw className="h-3 w-3" /> Retry
          </button>
        )}
      </div>
      {failed && job?.error && <p className="px-11 pb-1.5 text-[11px] text-destructive" data-testid={`text-quick-enrich-job-error-${articleId}`}>{job.error}</p>}
      {open && (
        <div id={panelId} className="space-y-2 px-3 pb-3 pl-11">
          {row.summary && <p className="line-clamp-2 text-xs text-muted-foreground" data-testid={`text-quick-enrich-summary-${articleId}`}>{row.summary}</p>}
          <label htmlFor={`qe-text-${articleId}`} className="sr-only">Article text for {row.title}</label>
          <div className="rounded-lg border border-input bg-background focus-within:border-foreground">
            <textarea id={`qe-text-${articleId}`} value={text} onChange={e => setText(e.target.value)} rows={6} disabled={busy}
              placeholder={restoring ? 'Restoring pasted text' : 'Paste article text'}
              className="block w-full resize-y rounded-t-lg bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-60"
              data-testid={`input-quick-enrich-text-${articleId}`} />
            <div className="flex items-center gap-2 border-t border-border px-2 py-1.5">
              <span className={cn('font-mono text-[10px] tabular-nums', len && !valid ? 'text-destructive' : 'text-muted-foreground')} data-testid={`text-quick-enrich-count-${articleId}`}>
                {len.toLocaleString()} chars{len > 0 && len < MIN ? ` · min ${MIN}` : len > MAX ? ' · over limit' : ''}
              </span>
              {active && <span className="font-mono text-[10px] text-muted-foreground">job {job?.status}</span>}
              <button onClick={submit} disabled={!valid || busy || restoring || active}
                className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                data-testid={`button-quick-enrich-save-${articleId}`}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {busy ? 'Queueing' : 'Queue save'}
              </button>
            </div>
          </div>
        </div>
      )}
      {error && <p role="alert" className="px-11 pb-2 text-xs text-destructive" data-testid={`text-quick-enrich-error-${articleId}`}>{error}</p>}
    </li>
  );
}

export function CriticalEnrichmentQueue() {
  const { data: workspace } = useWorkspace();
  const { data, isLoading, isError, refetch, isFetching } = useGetQuickEnrichment({
    query: {
      refetchInterval: (q) => (q.state.data?.jobs ?? []).some(j => j.status === 'queued' || j.status === 'running') ? 2_000 : 15_000,
      refetchOnWindowFocus: true,
    },
  });
  const invalidate = useInvalidateWorkspace();
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  const seenSaved = useRef(new Set<string>());

  const savedKey = (data?.jobs ?? []).filter(j => j.status === 'saved').map(j => `${j.id}@${j.updatedAt}`).sort().join('|');
  useEffect(() => {
    if (!savedKey) return;
    let fresh = false;
    for (const k of savedKey.split('|')) if (!seenSaved.current.has(k)) { seenSaved.current.add(k); fresh = true; }
    if (fresh) invalidateRef.current();
  }, [savedKey]);

  const rows = useMemo<Row[]>(() => {
    const articles = new Map((workspace?.records ?? []).map(r => [r.id, r]));
    const latest = new Map<string, QuickEnrichmentJob>();
    for (const j of data?.jobs ?? []) {
      const cur = latest.get(j.articleId);
      if (!cur || j.updatedAt > cur.updatedAt) latest.set(j.articleId, j);
    }
    const out: Row[] = (data?.items ?? []).map((r: TrackedRecord) => ({
      articleId: r.id, title: r.title, url: r.url, outlet: r.outlet, ingestedAt: r.discoveredAt ?? r.createdAt, summary: r.summary, job: latest.get(r.id),
    }));
    const have = new Set(out.map(r => r.articleId));
    for (const j of latest.values()) if (!have.has(j.articleId)) out.push({ articleId: j.articleId, title: j.title, url: articles.get(j.articleId)?.url, outlet: j.outlet, job: j });
    return out;
  }, [data, workspace]);

  const counts = rows.reduce((c, r) => { const s = r.job?.status; if (s) c[s] = (c[s] ?? 0) + 1; return c; }, {} as Record<string, number>);

  return (
    <section className="tw-glass mt-6 rounded-xl border border-border" data-testid="section-quick-enrichment">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Critical · needs text</h2>
          {data && (
            <span className="font-mono text-[11px] text-muted-foreground" data-testid="text-quick-enrichment-count">
              {data.items.length} eligible · last 12h
              {['queued', 'running', 'failed', 'saved'].filter(s => counts[s]).map(s => ` · ${counts[s]} ${s}`).join('')}
            </span>
          )}
          {isFetching && !isLoading && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60" aria-label="Updating" />}
        </div>
      </div>
      <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">Critical impact · first ingested in the last 12 hours · still missing article text. RSS summaries alone do not count as enrichment.</p>
      {isLoading ? (
        <div className="space-y-2 p-4">{[0, 1, 2].map(i => <div key={i} className="h-6 animate-pulse rounded bg-muted" />)}</div>
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground" data-testid="text-quick-enrichment-empty">No critical articles missing text in the last 12 hours.</p>
      ) : (
        <ul className="max-h-[520px] overflow-auto" data-testid="list-quick-enrichment">
          {rows.map(r => <QueueRow key={r.articleId} row={r} />)}
        </ul>
      )}
    </section>
  );
}
