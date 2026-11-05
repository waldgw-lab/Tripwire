import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { TrackedRecord } from '@workspace/api-client-react';
import { BadgeCheck, CircleDashed, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Empty, ErrorState, PageHead, RowsSkeleton, SignInAction } from '@/components/bits';
import { ClaimEditor, ConfirmDelete } from '@/components/editors';
import { STAGES, byKind, fmtDate, useWorkspace } from '@/lib/workspace';

const stageColor: Record<string, string> = {
  origin: 'bg-accent', sourcing: 'bg-[hsl(0_0%_35%)]', addition: 'bg-[hsl(0_0%_55%)]', republication: 'bg-muted-foreground/50',
};

export default function ClaimsPage() {
  const { isSignedIn } = useAuth();
  const { data, isLoading, isError, refetch } = useWorkspace();
  const claims = useMemo(() => byKind(data?.records, 'claim').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [data]);
  const articles = useMemo(() => byKind(data?.records, 'article'), [data]);
  const articleById = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<TrackedRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TrackedRecord | null>(null);
  const current = claims.find((c) => c.id === sel) ?? claims[0];

  return (
    <div className="tw-rise flex min-h-[100dvh] flex-col">
      <PageHead title="Claims" count={claims.length}>
        {isSignedIn
          ? <button onClick={() => setCreating(true)} data-testid="button-new-claim" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> Claim</button>
          : <SignInAction />}
      </PageHead>
      {isLoading ? <RowsSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} /> : claims.length === 0 ? (
        <Empty title="No claim histories">{!isSignedIn && <SignInAction />}</Empty>
      ) : (
        <div className="grid flex-1 md:grid-cols-[320px_1fr]">
          <ul className="border-b border-border md:border-b-0 md:border-r">
            {claims.map((c) => {
              const obs = c.observations ?? [];
              return (
                <li key={c.id}>
                  <button onClick={() => setSel(c.id)} data-testid={`button-claim-${c.id}`}
                    className={cn('w-full border-l-2 px-5 py-3 text-left transition-colors', current?.id === c.id ? 'border-accent bg-card' : 'border-transparent hover:bg-card/60')}>
                    <p className="line-clamp-2 font-serif text-[15px] leading-snug">{c.title}</p>
                    <div className="mt-1.5 flex items-center gap-1">
                      {STAGES.map((s) => <span key={s} className={cn('h-1.5 flex-1 rounded-full', obs.some((o) => o.stage === s) ? stageColor[s] : 'bg-border')} />)}
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">{obs.filter((o) => o.verified).length}/{obs.length}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {current && (
            <section className="px-5 py-6 md:px-10" data-testid={`detail-claim-${current.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  {current.topic && <p className="font-mono text-[11px] uppercase tracking-wider text-accent">{current.topic}</p>}
                  <h2 className="mt-1 max-w-3xl font-serif text-2xl leading-tight">{current.title}</h2>
                  {current.summary && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{current.summary}</p>}
                  {(current.entities ?? []).length > 0 && <div className="mt-2 flex flex-wrap gap-1">{current.entities!.map((e) => <span key={e} className="rounded-sm bg-secondary px-1.5 py-0.5 text-[11px]">{e}</span>)}</div>}
                </div>
                {isSignedIn && (
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => setEditing(current)} className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground" data-testid="button-edit-claim"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => setDeleting(current)} className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-destructive" data-testid="button-delete-claim"><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
              </div>

              <div className="mt-8 space-y-8">
                {STAGES.map((stage) => {
                  const obs = (current.observations ?? []).filter((o) => o.stage === stage).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
                  return (
                    <div key={stage} className="grid gap-3 md:grid-cols-[120px_1fr]">
                      <div className="flex items-center gap-2 md:items-start md:pt-1">
                        <span className={cn('h-2.5 w-2.5 rounded-full', stageColor[stage])} />
                        <span className="font-mono text-[11px] uppercase tracking-wider">{stage}</span>
                      </div>
                      {obs.length === 0 ? <div className="h-px self-center bg-border" /> : (
                        <ol className="space-y-3 border-l border-border pl-5">
                          {obs.map((o) => {
                            const art = articleById.get(o.articleId);
                            return (
                              <li key={o.id} className="relative" data-testid={`observation-${o.id}`}>
                                <span className={cn('absolute -left-[25px] top-1.5 h-2 w-2 rounded-full ring-4 ring-background', stageColor[stage])} />
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                                  <time className="font-mono text-muted-foreground">{fmtDate(o.observedAt, true)}</time>
                                  <span className="font-semibold">{o.journalist || '—'}</span>
                                  {art?.outlet && <span className="text-muted-foreground">{art.outlet}</span>}
                                  {o.verified
                                    ? <span className="inline-flex items-center gap-1 text-[hsl(152_30%_32%)]"><BadgeCheck className="h-3.5 w-3.5" />verified</span>
                                    : <span className="inline-flex items-center gap-1 text-muted-foreground"><CircleDashed className="h-3.5 w-3.5" />unverified</span>}
                                  {(o.url || art?.url) && <a href={o.url || art?.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /></a>}
                                </div>
                                {art && <p className="mt-0.5 text-sm">{art.title}</p>}
                                {o.attribution && <blockquote className="mt-1 font-serif text-[15px] italic">“{o.attribution}”</blockquote>}
                                {o.evidence && <p className="mt-1 text-sm text-muted-foreground">{o.evidence}</p>}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
      <ClaimEditor open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }} record={editing} articles={articles} />
      <ConfirmDelete target={deleting} onClose={() => { setDeleting(null); setSel(null); }} />
    </div>
  );
}
