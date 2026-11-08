import { useMemo, useState } from 'react';
import { FocusContext } from '@/components/provenance/focus-context';
import { Link } from 'wouter';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { byKind, fmtDate, useWorkspace } from '@/lib/workspace';
import { categoryKey, categoryLabel, groupKey, topicLabel, summaryForArticle, useClaimLinkage } from '@/lib/claim-groups';

/** Claims explicitly attributed to this article, grouped by category -> topic. Navigational only. */
export function ArticleClaims({ articleId }: { articleId: string }) {
  const { summaries, summaryById: allSummaries, categoryById, claimsByArticle, linkageKnown } = useClaimLinkage();
  const summaryById = useMemo(() => new Map([...allSummaries].map(([id, s]) =>
    [id, summaryForArticle(s, articleId) ?? s])), [allSummaries, articleId]);
  const { data } = useWorkspace();
  const claimById = useMemo(() => new Map(byKind(data?.records, 'claim').map(c => [c.id, c])), [data]);
  const ids = claimsByArticle.get(articleId) ?? [];
  const [open, setOpen] = useState(false);
  const [openTopics, setOpenTopics] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const cats = new Map<string, { label: string; topics: Map<string, { title: string; ids: string[] }> }>();
    for (const id of ids) {
      const s = summaryById.get(id);
      const ck = categoryKey(s);
      const cat = cats.get(ck) ?? { label: categoryLabel(ck, categoryById, s), topics: new Map() };
      const t = cat.topics.get(groupKey(s)) ?? { title: topicLabel(s), ids: [] };
      t.ids.push(id); cat.topics.set(groupKey(s), t); cats.set(ck, cat);
    }
    return [...cats.entries()];
  }, [ids, summaryById, categoryById]);

  const head = <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Linked claims{ids.length ? ` · ${ids.length}` : ''}</h3>;

  if (summaries.isLoading) return <section className="mt-4" data-testid="section-article-claims">{head}<div className="space-y-1.5" aria-busy>{[70, 52].map(w => <div key={w} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />)}</div></section>;
  if (summaries.isError) return (
    <section className="mt-4" data-testid="section-article-claims">{head}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-xs" data-testid="article-claims-error">
        <span className="text-muted-foreground">Claim links could not be loaded.</span>
        <button type="button" onClick={() => summaries.refetch()} className="inline-flex items-center gap-1 underline underline-offset-4" data-testid="button-article-claims-retry"><RefreshCw className="h-3 w-3" /> Retry</button>
      </div>
    </section>
  );
  if (!linkageKnown) return <section className="mt-4" data-testid="section-article-claims">{head}<p className="text-xs text-muted-foreground" data-testid="text-article-claims-unknown">Claim linkage not yet available for this workspace.</p></section>;
  if (!ids.length) return <section className="mt-4" data-testid="section-article-claims">{head}<p className="text-xs text-muted-foreground" data-testid="text-article-claims-none">No claim attributions recorded for this article. Unprocessed articles may still gain links.</p></section>;

  const topicCount = groups.reduce((n, [, c]) => n + c.topics.size, 0);
  const topicNames = groups.flatMap(([, c]) => [...c.topics.values()].map(t => t.title));
  return (
    <section className="mt-4 rounded-md border border-border/70 bg-background/70" data-testid="section-article-claims">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls={`article-claims-${articleId}`}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/50" data-testid="button-toggle-article-claims">
        {open ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10px] uppercase tracking-wider" data-testid="text-article-claims-count">Linked claims · {ids.length} in {topicCount} topic{topicCount === 1 ? '' : 's'}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{topicNames.slice(0, 3).join(' · ')}{topicNames.length > 3 ? ` · +${topicNames.length - 3} more` : ''}</span>
        </span>
      </button>
      {open && <div id={`article-claims-${articleId}`} className="max-h-72 space-y-2 overflow-y-auto border-t border-border/70 px-3 py-2">
        {groups.map(([ck, cat]) => (
          <div key={ck}>
            <p className="font-mono text-[10px] uppercase tracking-wide">{cat.label}</p>
            {[...cat.topics.entries()].map(([tk, t]) => {
              const to = !!openTopics[tk];
              return (
              <div key={tk} className="mt-1 border-l border-border pl-2">
                <button type="button" onClick={() => setOpenTopics(o => ({ ...o, [tk]: !to }))} aria-expanded={to} className="flex w-full items-center gap-1 text-left text-xs font-medium hover:text-foreground" data-testid={`button-article-claim-topic-${tk}`}>
                  {to ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">{t.title}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{t.ids.length}</span>
                </button>
                <FocusContext summary={summaryById.get(t.ids[0] ?? '')} />
                {to && <ul className="mt-0.5">
                  {t.ids.map(id => {
                    const s = summaryById.get(id);
                    const c = claimById.get(id);
                    const qs = new URLSearchParams({ claim: id, ...(s?.categoryId ? { category: s.categoryId } : {}), ...(s?.topicId ? { topic: s.topicId } : {}) });
                    return (
                      <li key={id}>
                        <Link href={`/claims?${qs}`} className="group flex items-start gap-1 py-1 text-sm hover:underline" data-testid={`link-article-claim-${id}`}>
                          <ChevronRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 font-serif leading-snug">{c?.title ?? 'Claim record unavailable'}</span>
                          {s?.lastDate && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{fmtDate(s.lastDate)}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>}
              </div>
              );
            })}
          </div>
        ))}
      </div>}
    </section>
  );
}
