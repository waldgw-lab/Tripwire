import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkspaceAccess } from '@/lib/workspace-access';
import { useSearchArticleContent, type TrackedRecord } from '@workspace/api-client-react';
import { ExternalLink, Flag, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { FeedFilterMenu } from '@/components/feed/feed-filters';
import { defaultFeedFilters, filterSelectionCount, matchesFeedFilters } from '@/lib/feed-filters';
import { Empty, ErrorState, PageHead, RowsSkeleton } from '@/components/bits';
import { impactRating } from '@/lib/article-signals';
import { FeedMeta } from '@/components/feed/feed-meta';
import { FittedHeadline } from '@/components/feed/fitted-headline';
import { DevelopmentsPanel } from '@/components/feed/developments';
import { ArticleReader } from '@/components/feed/article-reader';
import { GroupedFeed, type GroupLayout } from '@/components/feed/grouped-feed';
import { groupFeedArticles, type FeedGroupOrder } from '@/lib/feed-development-groups';
import type { ClaimSummary } from '@/lib/claim-group-core';
import { useSearch } from 'wouter';
import { ArticleEditor, ConfirmDelete } from '@/components/editors';
import { Importer } from '@/components/importer';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { OutletBrand } from '@/components/outlet-brand';
import { claimFilterCount, defaultClaimFeedFilter, matchesClaimFilter, useClaimLinkage } from '@/lib/claim-groups';
import { articleCredits } from '@/lib/media-coverage';
import { FOCUS, REPORTING, SENTIMENT, byKind, isFlagged, useFlag, useRefresh, useWorkspace } from '@/lib/workspace';

const readParam = () => new URLSearchParams(window.location.search).get('article');
const readFlagged = () => new URLSearchParams(window.location.search).get('flagged') === '1';
function writeFlagged(on: boolean) {
  const url = new URL(window.location.href);
  if (on) url.searchParams.set('flagged', '1'); else url.searchParams.delete('flagged');
  window.history.replaceState(window.history.state, '', url);
}
function writeParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('article', id); else url.searchParams.delete('article');
  window.history.replaceState(window.history.state, '', url);
}

type ViewState = { grouped: boolean; layout: GroupLayout };
function readView(): ViewState {
  const p = new URLSearchParams(window.location.search);
  const l = p.get('layout');
  return { grouped: p.get('view') === 'grouped', layout: l === 'compare' || l === 'board' ? l : 'briefing' };
}
function writeView(v: ViewState) {
  const url = new URL(window.location.href);
  if (v.grouped) { url.searchParams.set('view', 'grouped'); url.searchParams.set('layout', v.layout); }
  else { url.searchParams.delete('view'); url.searchParams.delete('layout'); }
  window.history.replaceState(window.history.state, '', url);
}

export default function FeedPage({ mode }: { mode: 'public' | 'feed' | 'saved' }) {
  const { canEdit: isSignedIn } = useWorkspaceAccess();
  const { data, isLoading, isError, refetch } = useWorkspace();
  const flag = useFlag();
  const refresh = useRefresh();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => { const t = window.setTimeout(() => setDebouncedQ(q.trim()), 250); return () => window.clearTimeout(t); }, [q]);
  const contentSearch = useSearchArticleContent({ q: debouncedQ }, { query: { enabled: debouncedQ.length > 0, staleTime: 60_000 } });
  const bodyHits = useMemo(() => new Set(debouncedQ && debouncedQ === q.trim() ? contentSearch.data?.articleIds ?? [] : []), [contentSearch.data, debouncedQ, q]);
  const [filters, setFilters] = useState(defaultFeedFilters);
  const linkage = useClaimLinkage();
  const [claimFilter, setClaimFilter] = useState(defaultClaimFeedFilter);
  const claimStatus: 'off' | 'ok' | 'stale' | 'loading' | 'error' | 'unavailable' = claimFilterCount(claimFilter) === 0 ? 'off'
    : linkage.summaries.data && linkage.linkageKnown ? (linkage.summaries.isError ? 'stale' : 'ok')
    : linkage.summaries.isLoading ? 'loading' : linkage.summaries.isError ? 'error' : 'unavailable';
  const claimFilterLive = claimStatus === 'ok' || claimStatus === 'stale';
  const claimBlocked = claimStatus === 'loading' || claimStatus === 'error' || claimStatus === 'unavailable';
  const [flaggedOnly, setFlaggedOnlyState] = useState(() => mode === 'saved' || readFlagged());
  const setFlaggedOnly = useCallback((v: boolean) => { setFlaggedOnlyState(v); writeFlagged(v); }, []);
  const [flaggedFirst, setFlaggedFirst] = useState(false);
  const [open, setOpenState] = useState<string | null>(() => readParam());
  const setOpen = useCallback((id: string | null) => { setOpenState(id); writeParam(id); }, []);
  const [view, setViewState] = useState<ViewState>(readView);
  const setView = useCallback((v: ViewState) => { setViewState(v); writeView(v); }, []);
  const search = useSearch();
  useEffect(() => { setViewState(prev => { const n = readView(); return n.grouped === prev.grouped && n.layout === prev.layout ? prev : n; }); }, [search]);
  useEffect(() => { const on = () => { setViewState(readView()); setOpenState(readParam()); }; window.addEventListener('popstate', on); return () => window.removeEventListener('popstate', on); }, []);
  const [order, setOrder] = useState<FeedGroupOrder>('relevant');
  const [editing, setEditing] = useState<TrackedRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TrackedRecord | null>(null);

  const articles = useMemo(() => {
    const a = byKind(data?.records, 'article');
    return a.sort((x, y) => (y.publishedAt ?? y.createdAt).localeCompare(x.publishedAt ?? x.createdAt));
  }, [data]);
  const watches = useMemo(() => byKind(data?.records, 'watch'), [data]);
  const impacts = useMemo(() => new Map(articles.map((a) => [a.id, impactRating(a, watches)])), [articles, watches]);
  const topics = useMemo(() => [...new Set(articles.map((a) => a.topic).filter(Boolean) as string[])].sort(), [articles]);
  const outlets = useMemo(() => [...new Set(articles.map((a) => a.outlet).filter(Boolean) as string[])].sort(), [articles]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = articles.filter((a) => {
      if (flaggedOnly && !isFlagged(a)) return false;
      if (!matchesFeedFilters(a, impacts.get(a.id)?.value, filters)) return false;
      if (claimFilterLive && !matchesClaimFilter(a.id, claimFilter, linkage.claimsByArticle, linkage.summaryById)) return false;
      if (!needle) return true;
      if (bodyHits.has(a.id)) return true;
      return [a.title, a.summary, a.fullText, a.outlet, a.contentType, a.contentFormat, a.topic, a.byline, ...articleCredits(a).map(c => c.name), ...(a.entities ?? [])]
        .some((s) => s?.toLowerCase().includes(needle));
    });
    if (claimBlocked) return [];
    return flaggedFirst ? out.sort((x, y) => Number(isFlagged(y)) - Number(isFlagged(x))) : out;
  }, [articles, impacts, q, bodyHits, filters, flaggedOnly, flaggedFirst, claimFilter, claimFilterLive, claimBlocked, linkage.claimsByArticle, linkage.summaryById]);

  const groups = useMemo(() => view.grouped ? groupFeedArticles(rows, { impacts, summaries: (linkage.summaries.data ?? []) as ClaimSummary[], order, flaggedFirst }) : [],
    [view.grouped, rows, impacts, linkage.summaries.data, order, flaggedFirst]);
  const selected = useMemo(() => (open ? articles.find((a) => a.id === open) ?? null : null), [articles, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"][data-state="open"]')) setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    if (!selected || !narrow) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || document.querySelector('[role="dialog"][data-state="open"]')) return;
      const pane = document.getElementById('article-reader');
      const targets = [...(pane?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]') ?? [])].filter(el => el.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (!first || !last) return;
      if (!pane?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', trapTab);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', trapTab); };
  }, [selected, narrow]);

  const filtered = q || flaggedOnly || filterSelectionCount(filters) > 0 || claimFilterCount(claimFilter) > 0;
  const clear = () => { setQ(''); setFilters(defaultFeedFilters()); setFlaggedOnly(false); setClaimFilter(defaultClaimFeedFilter()); };
  const toggleFlag = (a: TrackedRecord) => flag.mutate({ id: a.id, data: { flagged: !isFlagged(a) } });

  return (
    <div className="tw-rise">
      <PageHead title={flaggedOnly ? 'Feed · Flagged' : 'Feed'} count={rows.length}>
        {isSignedIn ? (
          <button onClick={() => setCreating(true)} data-testid="button-intake" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
            <Plus className="h-3.5 w-3.5" /> Intake
          </button>
        ) : null}
      </PageHead>

      <div className="tw-glass sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5 backdrop-blur md:px-8">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search headline, text, journalist, entity" className="h-8 bg-card pl-8 text-sm" data-testid="input-search" />
        </div>
        <div role="radiogroup" aria-label="Feed view" className="inline-flex h-8 items-center rounded-md border border-border bg-card p-0.5" title={view.grouped ? 'Grouped: related headlines bundled by development' : 'Chronological: every article, newest first'}>
          {([['chronological', false], ['grouped', true]] as const).map(([k, g]) => (
            <button key={k} role="radio" aria-checked={view.grouped === g} onClick={() => setView({ ...view, grouped: g })}
              className={cn('h-full rounded px-2.5 text-xs font-medium capitalize', view.grouped === g ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')} data-testid={`button-view-${k}`}>{k}</button>
          ))}
        </div>
        <FeedFilterMenu value={filters} onChange={setFilters} topics={topics} outlets={outlets} reporting={REPORTING} sentiment={SENTIMENT} focus={FOCUS}
          flagged={flaggedOnly} onFlaggedChange={setFlaggedOnly} flaggedFirst={flaggedFirst} onFlaggedFirstChange={setFlaggedFirst}
          claimFilter={claimFilter} onClaimFilterChange={setClaimFilter} linkage={linkage} />
      </div>

      <div className={cn(selected && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(380px,46%)]')}>
      <div className="min-w-0">
      <DevelopmentsPanel />
      {claimStatus !== 'off' && claimStatus !== 'ok' && (
        <div role="status" className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs md:mx-5" data-testid={`notice-claim-filter-${claimStatus}`}>
          <span className="text-muted-foreground">
            {claimStatus === 'loading' ? 'Loading claim links; claim filters will apply once loaded.'
              : claimStatus === 'error' ? 'Claim links could not be loaded, so claim filters cannot be applied. No results are shown.'
              : claimStatus === 'unavailable' ? 'Claim linkage is not available yet, so claim filters cannot be applied. No results are shown.'
              : 'Claim links failed to refresh; filtering with the last loaded links, which may be stale.'}
          </span>
          <span className="flex items-center gap-3">
            {claimStatus !== 'loading' && <button onClick={() => linkage.summaries.refetch()} className="underline underline-offset-4" data-testid="button-claim-filter-notice-retry">Retry</button>}
            <button onClick={() => setClaimFilter(defaultClaimFeedFilter())} className="underline underline-offset-4" data-testid="button-claim-filter-notice-clear">Clear claim filters</button>
          </span>
        </div>
      )}
      {isLoading || claimStatus === 'loading' ? <RowsSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} /> : claimBlocked ? null : rows.length === 0 ? (
        filtered ? <Empty title="No matches"><button onClick={clear} className="text-xs text-accent underline" data-testid="button-empty-clear">Clear filters</button></Empty>
          : <Empty title="No articles yet">
              <button onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="button-empty-refresh" className="rounded-md bg-accent px-3 py-1.5 text-xs text-accent-foreground disabled:opacity-60">
                {refresh.isPending ? 'Checking feeds' : 'Refresh feeds'}
              </button>
            </Empty>
      ) : view.grouped ? (
        <GroupedFeed groups={groups} layout={view.layout} order={order} onLayout={(layout) => setView({ grouped: true, layout })} onOrder={setOrder}
          impactOf={(a) => impacts.get(a.id) ?? impactRating(a, watches)} open={open} setOpen={setOpen} signedIn={!!isSignedIn}
          onToggleFlag={toggleFlag} flagPending={flag.isPending} onEdit={setEditing} onDelete={setDeleting} />
      ) : (
        <ol className="tw-feed-list space-y-2.5 px-3 py-3 md:px-5 md:py-4">
          {rows.map((a) => {
            const active = open === a.id;
            const imp = impacts.get(a.id) ?? impactRating(a, watches);
            return (
              <li key={a.id} onClick={() => setOpen(a.id)} className={cn('tw-feed-item group relative h-[144px] cursor-pointer rounded-xl px-3 py-3.5 transition-colors sm:h-[96px] md:px-5', active && 'tw-feed-item-active')} data-testid={`row-article-${a.id}`}>
                <div className="flex h-full items-start gap-3 sm:gap-4">
                  <OutletBrand name={a.sourceType === 'x' ? 'X' : (a.outlet ?? '—')} variant="square" className="mt-0.5 h-14 w-14 rounded-xl shadow-sm sm:h-16 sm:w-16" />
                  <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
                    <div className="max-h-[50%] shrink-0 overflow-hidden"><FeedMeta article={a} impact={imp} /></div>
                    <button onClick={(e) => { e.stopPropagation(); setOpen(a.id); }} aria-expanded={active} aria-controls="article-reader" title={a.title} className="flex min-h-0 w-full flex-1 items-start overflow-hidden text-left focus-visible:outline-2 focus-visible:outline-offset-2" data-testid={`button-expand-${a.id}`}>
                      <FittedHeadline text={a.title} />
                    </button>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5" onClick={event => event.stopPropagation()}>
                    {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground" data-testid={`link-source-${a.id}`}><ExternalLink className="h-4 w-4" /></a>}
                    {isSignedIn && (
                      <>
                        <button onClick={() => toggleFlag(a)} disabled={flag.isPending} aria-pressed={isFlagged(a)} aria-label={isFlagged(a) ? 'Unflag article' : 'Flag article'} title={isFlagged(a) ? 'Unflag' : 'Flag'} className={cn('flex h-8 w-8 items-center justify-center rounded-md', isFlagged(a) ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')} data-testid={`button-flag-${a.id}`}>
                          <Flag className={cn('h-4 w-4', isFlagged(a) && 'fill-current')} />
                        </button>
                        <button onClick={() => setEditing(a)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-100 hover:text-foreground md:opacity-0 md:group-hover:opacity-100" data-testid={`button-edit-${a.id}`}><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => setDeleting(a)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-100 hover:text-destructive md:opacity-0 md:group-hover:opacity-100" data-testid={`button-delete-${a.id}`}><Trash2 className="h-4 w-4" /></button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      </div>
      {selected && (
        <>
          <div className="fixed inset-0 z-40 bg-foreground/30 lg:hidden" onClick={() => setOpen(null)} aria-hidden />
          <aside id="article-reader" role={narrow ? 'dialog' : 'region'} aria-modal={narrow || undefined} aria-label={selected.title}
            className="tw-rise fixed inset-0 z-50 bg-card lg:static lg:z-auto lg:border-l lg:border-border lg:bg-card/85 lg:backdrop-blur-sm"
          >
            <div className="h-full lg:sticky lg:top-0 lg:h-[100dvh]">
              <ArticleReader article={selected} impact={impacts.get(selected.id) ?? impactRating(selected, watches)} onClose={() => setOpen(null)} onOpenArticle={setOpen}
                signedIn={!!isSignedIn} onToggleFlag={() => toggleFlag(selected)} flagPending={flag.isPending} />
            </div>
          </aside>
        </>
      )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogTitle>Add / update content</DialogTitle>
          <Importer onCommitted={article => { setCreating(false); setOpen(article.id); }} />
        </DialogContent>
      </Dialog>
      <ArticleEditor open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }} record={editing} />
      <ConfirmDelete target={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
