import { useEffect, useMemo, useState } from 'react';
import {
  ArticleCorrectionInputReason, ArticleDismissalInputReason, GetArticleFeedbackAction, getGetArticleFeedbackQueryKey, getGetFeedbackArticleQueryKey,
  useGetArticleFeedback, useGetFeedbackArticle, type ArticleFeedback, type ClassificationSnapshot, type GetArticleFeedbackParams,
} from '@workspace/api-client-react';
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, RotateCcw, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/bits';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ArticleReader } from '@/components/feed/article-reader';
import { impactRating } from '@/lib/article-signals';
import { byKind, fmtDate, useRestore, useWorkspace } from '@/lib/workspace';

const REASONS = [...new Set([...Object.values(ArticleCorrectionInputReason), ...Object.values(ArticleDismissalInputReason)])];
const ctl = 'h-7 rounded-md border border-input bg-background px-2 text-xs';
const actionTone: Record<string, string> = { deletion: 'text-destructive', restoration: 'text-[hsl(152_30%_32%)]', correction: 'text-foreground', 'system-correction': 'text-muted-foreground' };

function Snap({ s, field }: { s?: ClassificationSnapshot; field?: string }) {
  if (!s) return <span className="text-muted-foreground">—</span>;
  const v = field === 'impact' ? s.effective.toUpperCase() : s.effective || '—';
  return (
    <span title={s.automatic ? `Auto: ${field === 'impact' ? s.automatic.impact : s.automatic.topic} · ${s.automatic.explanation}` : undefined}>
      {v} <span className="text-muted-foreground">{s.mode}{s.origin === 'legacy-unknown' ? ' · origin unknown' : ''}{s.raw && s.raw !== s.effective ? ` · raw ${s.raw}` : ''}</span>
    </span>
  );
}

function Retained({ event, onClose }: { event: ArticleFeedback; onClose: () => void }) {
  const { data: ws } = useWorkspace();
  const watches = useMemo(() => byKind(ws?.records, 'watch'), [ws]);
  const q = useGetFeedbackArticle(event.id, { query: { queryKey: getGetFeedbackArticleQueryKey(event.id), retry: 1 } });
  const snap = event.snapshot;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="h-[92dvh] max-w-3xl overflow-hidden p-0">
        <DialogTitle className="sr-only">{event.headline}</DialogTitle>
        {q.isLoading ? (
          <div className="space-y-2 p-6">{[70, 100, 90, 60].map((w, i) => <div key={i} className="h-4 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />)}</div>
        ) : q.data ? (
          <ArticleReader article={q.data} impact={impactRating(q.data, watches)} onClose={onClose} signedIn={false} onToggleFlag={() => {}} flagPending={false} feedbackId={event.id} />
        ) : (
          <div className="space-y-3 overflow-y-auto p-6" data-testid="feedback-snapshot">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Snapshot at event · retained article unavailable</p>
            <h2 className="font-serif text-xl font-semibold">{snap.title}</h2>
            <p className="font-mono text-[11px] text-muted-foreground">{[snap.outlet, fmtDate(snap.publishedAt, true), snap.byline].filter(Boolean).join(' · ')}</p>
            {snap.summary && <p className="text-sm">{snap.summary}</p>}
            {snap.fullText && <div className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed">{snap.fullText}</div>}
            {snap.url && <a href={snap.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline underline-offset-4"><ExternalLink className="h-3 w-3" /> Open source</a>}
            <button type="button" onClick={() => q.refetch()} className="block text-xs underline underline-offset-4">Retry retained article</button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function FeedbackLog() {
  const [expanded, setExpanded] = useState(false);
  const [scope, setScope] = useState<'analyst' | 'all'>('analyst');
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [reason, setReason] = useState('');
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<ArticleFeedback | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const restore = useRestore();
  useEffect(() => { const t = setTimeout(() => { setQ(input.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [input]);
  const params: GetArticleFeedbackParams = { scope, q: q || undefined, action: (action || undefined) as GetArticleFeedbackParams['action'], reason: reason || undefined, page };
  const { data, isLoading, isError, refetch, isFetching } = useGetArticleFeedback(params, { query: { enabled: expanded, queryKey: getGetArticleFeedbackQueryKey(params), placeholderData: p => p, refetchInterval: expanded ? 30000 : false } });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = !!(q || action || reason);

  return (
    <section className="tw-glass mt-6 rounded-xl border border-border" data-testid="section-feedback">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <button onClick={() => setExpanded(v => !v)} aria-expanded={expanded} className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground" data-testid="button-toggle-feedback">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Correction history
          </button>
          {data && <span className="font-mono text-[11px] text-muted-foreground" data-testid="text-feedback-total">{data.total.toLocaleString('en-US')} {scope === 'analyst' ? 'analyst actions' : 'meaningful changes'}</span>}
          {isFetching && !isLoading && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60" aria-label="Updating" />}
        </div>
        {expanded && <div className="flex flex-wrap items-center gap-1.5">
          <select aria-label="History scope" value={scope} onChange={e => { setScope(e.target.value as typeof scope); setAction(''); setReason(''); setPage(1); }} className={ctl} data-testid="select-feedback-scope">
            <option value="analyst">Analyst actions</option><option value="all">All meaningful changes</option>
          </select>
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <input value={input} maxLength={300} onChange={e => setInput(e.target.value)} placeholder="Headline, outlet, note" aria-label="Search feedback" className={cn(ctl, 'w-48 pl-6')} data-testid="input-feedback-search" />
          </label>
          <select aria-label="Action" value={action} onChange={e => { setAction(e.target.value); setPage(1); }} className={ctl} data-testid="select-feedback-action">
            <option value="">Action</option>
            {Object.values(GetArticleFeedbackAction).filter(a => scope === 'all' || a !== 'system-correction').map(a => <option key={a} value={a}>{a.replace('-', ' ')}</option>)}
          </select>
          <select aria-label="Reason" value={reason} onChange={e => { setReason(e.target.value); setPage(1); }} className={ctl} data-testid="select-feedback-reason">
            <option value="">Reason</option>
            {[...new Set([...REASONS, ...(data?.reasons ?? [])])].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {filtered && <button type="button" onClick={() => { setInput(''); setQ(''); setAction(''); setReason(''); setPage(1); }} className="h-7 px-1.5 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" data-testid="button-feedback-reset">Reset</button>}
        </div>}
      </div>
      {expanded && <>
      <p className="px-4 py-2 text-xs text-muted-foreground">Audit history, not a task queue. Review changes with View, or Restore a dismissed article. Automatic updates do not change monitoring policy.</p>
      {isLoading ? (
        <div className="space-y-2 p-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-5 animate-pulse rounded bg-muted" />)}</div>
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : data.events.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">{filtered ? 'No events match these filters.' : 'No corrections or deletions recorded.'}</p>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs" data-testid="table-feedback">
            <thead className="sticky top-0 bg-card/95 backdrop-blur">
              <tr className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {['When', 'Action', 'Article', 'Change', 'Reason', ''].map((h, i) => <th key={i} className="px-3 py-2 text-left font-normal">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.events.map(e => (
                <tr key={e.id} className="border-t border-border/60 align-top" data-testid={`row-feedback-${e.id}`}>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-muted-foreground" title={e.actor}>{fmtDate(e.timestamp, true)}</td>
                  <td className={cn('whitespace-nowrap px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider', actionTone[e.action])}>{e.action.replace('-', ' ')}</td>
                  <td className="max-w-[260px] px-3 py-1.5">
                    <button type="button" onClick={() => setViewing(e)} className="block w-full truncate text-left font-medium hover:underline" title={e.headline} data-testid={`button-feedback-open-${e.id}`}>{e.headline}</button>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{[e.outlet, e.publishedAt && fmtDate(e.publishedAt)].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">
                    {e.field ? <><span className="uppercase text-muted-foreground">{e.field}</span>{' '}<Snap s={e.before} field={e.field} /> {'->'} <Snap s={e.after} field={e.field} /></>
                      : <span className="text-muted-foreground" title={e.snapshot.automaticAssessment?.explanation ?? 'Legacy automatic explanation unavailable'}>
                          {e.snapshot.impact?.toUpperCase() ?? 'Unassessed'} · {e.snapshot.impactMode ?? 'origin unknown'}<br />
                          {e.snapshot.topic ?? 'Unclassified'} · {e.snapshot.topicMode ?? 'origin unknown'}
                          {e.duplicateOf && <span className="block">dup of {e.duplicateOf}</span>}
                        </span>}
                  </td>
                  <td className="max-w-[200px] px-3 py-1.5">{e.reason}{e.notes && <p className="truncate text-muted-foreground" title={e.notes}>{e.notes}</p>}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <button type="button" onClick={() => setViewing(e)} className="mr-2 underline underline-offset-4" data-testid={`button-feedback-view-${e.id}`}>View</button>
                    {(e.action === 'deletion' || e.action === 'system-correction' && e.field === 'dismissal') && (
                      <button type="button" disabled={restore.isPending} onClick={() => { setRestoringId(e.id); restore.mutate({ id: e.articleId }, { onSettled: () => setRestoringId(null) }); }}
                        className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:border-foreground disabled:opacity-50" data-testid={`button-feedback-restore-${e.id}`}>
                        <RotateCcw className={cn('h-3 w-3', restoringId === e.id && 'animate-spin')} /> Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-1.5 font-mono text-[11px] text-muted-foreground">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40" data-testid="button-feedback-prev"><ChevronLeft className="h-3.5 w-3.5" /></button>
          {page} / {pages}
          <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40" data-testid="button-feedback-next"><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {viewing && <Retained event={viewing} onClose={() => setViewing(null)} />}
      </>}
    </section>
  );
}
