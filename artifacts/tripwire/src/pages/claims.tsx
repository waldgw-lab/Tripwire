import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearch } from 'wouter';
import { useWorkspaceAccess } from '@/lib/workspace-access';
import { type TrackedRecord } from '@workspace/api-client-react';
import { ChevronDown, ChevronRight, ExternalLink, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Empty, ErrorState, PageHead, RowsSkeleton } from '@/components/bits';
import { ClaimEditor, ConfirmDelete } from '@/components/editors';
import { Disclosure, ProvenancePanel, TONE } from '@/components/provenance/provenance-panel';
import { OutletBrand } from '@/components/outlet-brand';
import { RecentDevelopmentAlerts } from '@/components/provenance/recent-development-alerts';
import { FocusContext } from '@/components/provenance/focus-context';
import { FocusOverview } from '@/components/provenance/focus-overview';
import { STAGES, byKind, fmtDate, useWorkspace } from '@/lib/workspace';
import {
  UNCATEGORIZED, categoryKey, groupClaimsByArticle, categoryLabel, compareClaims, groupKey, reportTime, topicKey, topicLabel, summariesForClaim, useClaimLinkage, type ClaimSummary,
} from '@/lib/claim-groups';

import { FocusCorrection } from '@/components/feed/focus-correction';

import { FocusGroupEditor } from '@/components/feed/focus-group-editor';

const isImportNote = (s?: string) => !!s && /supplied analysis|unreviewed claim-family/i.test(s);

function dateRange(first: string | null | undefined, last: string | null | undefined) {
  if (!first && !last) return 'Date unknown';
  if (!first || !last || fmtDate(first) === fmtDate(last)) return fmtDate((first ?? last)!);
  return `${fmtDate(first)} – ${fmtDate(last)}`;
}

type Sort = 'newest' | 'oldest' | 'linked';
type Recency = 'ongoing' | 'all';
type UrlState = { claim: string | null; focus: string | null; category: string; topic: string; q: string; recency: Recency; sort: Sort };

function readUrl(): UrlState {
  const p = new URLSearchParams(window.location.search);
  const sort = p.get('sort');
  return {
    claim: p.get('claim'), focus: p.get('focus'), category: p.get('category') ?? '', topic: p.get('topic') ?? '', q: p.get('q') ?? '',
    recency: p.get('recency') === 'ongoing' ? 'ongoing' : 'all',
    sort: sort === 'oldest' || sort === 'linked' ? sort : 'newest',
  };
}
function writeUrl(s: UrlState, push: boolean) {
  const url = new URL(window.location.href);
  const set = (k: string, v: string | null, def = '') => { if (v && v !== def) url.searchParams.set(k, v); else url.searchParams.delete(k); };
  set('claim', s.claim); set('focus', s.focus); set('category', s.category); set('topic', s.topic); set('q', s.q); set('recency', s.recency, 'all'); set('sort', s.sort, 'newest');
  if (url.href === window.location.href) return;
  if (push) window.history.pushState(window.history.state, '', url); else window.history.replaceState(window.history.state, '', url);
}

const selectCls = 'h-8 rounded-md border border-input bg-card px-2 text-xs';

type Grouping = ReturnType<typeof groupClaimsByArticle<TrackedRecord>>;
type Group = { key: string; cat: string; topic: string; title: string; claims: TrackedRecord[]; summaries: Map<string, ClaimSummary>; developments: string[]; first: string | null; last: string | null; ongoing: number; latest: number; byArticle: Grouping; total: Grouping };
const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;

export default function ClaimsPage() {
  const { canEdit: isSignedIn } = useWorkspaceAccess();
  const { data, isLoading, isError, refetch } = useWorkspace();
  const { summaries: sumQ, categories: catQ, summaryById, categoryById } = useClaimLinkage();
  const claims = useMemo(() => byKind(data?.records, 'claim'), [data]);
  const articles = useMemo(() => byKind(data?.records, 'article'), [data]);
  const articleById = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  const [st, setSt] = useState<UrlState>(readUrl);
  const update = useCallback((patch: Partial<UrlState>, push = false) => {
    setSt(prev => {
      const resetFocus = patch.focus === undefined && ['category', 'topic', 'q', 'recency'].some(key => key in patch);
      const next = { ...prev, ...(resetFocus ? { focus: null } : {}), ...patch };
      writeUrl(next, push); return next;
    });
  }, []);
  // Wouter navigations (e.g. Link to /claims?claim=…) change the search without remount; resync from URL.
  const search = useSearch();
  useEffect(() => { setSt(prev => { const next = readUrl(); return JSON.stringify(prev) === JSON.stringify(next) ? prev : next; }); }, [search]);
  useEffect(() => {
    const on = () => setSt(readUrl());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  const [editing, setEditing] = useState<TrackedRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TrackedRecord | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [openArticles, setOpenArticles] = useState<Record<string, boolean>>({});
  const views = useMemo(() => claims.flatMap(claim =>
    summariesForClaim(summaryById.get(claim.id)).map(summary => ({ claim, summary }))), [claims, summaryById]);


  // Category options in catalog order, plus any unknown ids from data, Uncategorized last.
  const categoryOptions = useMemo(() => {
    const ids = (catQ.data ?? []).map(c => c.id);
    for (const c of claims) { const k = categoryKey(summaryById.get(c.id)); if (!ids.includes(k)) ids.push(k); }
    return [...ids.filter(i => i !== UNCATEGORIZED), ...(ids.includes(UNCATEGORIZED) || claims.some(c => categoryKey(summaryById.get(c.id)) === UNCATEGORIZED) ? [UNCATEGORIZED] : [])];
  }, [catQ.data, claims, summaryById]);
  const catOrder = useMemo(() => new Map(categoryOptions.map((c, i) => [c, i])), [categoryOptions]);

  const topicOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const { summary: s } of views) {
      if (st.category && categoryKey(s) !== st.category) continue;
      if (s?.topicId) m.set(s.topicId, topicLabel(s));
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [views, st.category]);

  const filtered = useMemo(() => {
    const needle = st.q.trim().toLowerCase();
    return views.filter(({ claim: c, summary: s }) => {
      if (st.recency === 'ongoing' && !s?.ongoing) return false;
      if (st.category && categoryKey(s) !== st.category) return false;
      if (st.topic && s?.topicId !== st.topic) return false;
      if (!needle) return true;
      return [c.title, c.summary, c.topic, s?.topicTitle, s?.primaryCategory, ...(s?.developments ?? []), ...(s?.articleIds ?? []).map(id => articleById.get(id)?.title), ...(c.entities ?? [])].some(v => v?.toLowerCase().includes(needle));
    });
  }, [views, articleById, st]);


  const wholeByGroup = useMemo(() => {
    const m = new Map<string, typeof views>();
    for (const v of views) { const k = groupKey(v.summary); const l = m.get(k) ?? []; l.push(v); m.set(k, l); }
    return new Map([...m.entries()].map(([k, l]) => [k, groupClaimsByArticle(l.map(v => v.claim),
      new Map(l.filter(v => !!v.summary).map(v => [v.claim.id, v.summary!])))]));
  }, [views]);

  const tree = useMemo(() => {
    const groups = new Map<string, Group>();
    for (const { claim: c, summary: s } of filtered) {
      const key = groupKey(s);
      let g = groups.get(key);
      if (!g) { g = { key, cat: categoryKey(s), topic: topicKey(s), title: topicLabel(s), claims: [], summaries: new Map(), developments: s?.developments ?? [], first: null, last: null, ongoing: 0, latest: -Infinity, byArticle: null as unknown as Grouping, total: null as unknown as Grouping }; groups.set(key, g); }
      g.claims.push(c);
      if (s) g.summaries.set(c.id, s);
      if (s?.ongoing) g.ongoing++;
      if (s?.firstDate && (!g.first || s.firstDate < g.first)) g.first = s.firstDate;
      const l = s?.lastDate ?? s?.latestReportAt;
      if (l && (!g.last || l > g.last)) g.last = l;
      g.latest = Math.max(g.latest, reportTime(s));
    }
    const gs = [...groups.values()];
    gs.forEach(g => {
      g.claims.sort((a, b) => compareClaims(a, b, st.sort, g.summaries));
      g.byArticle = groupClaimsByArticle(g.claims, g.summaries);
      g.total = wholeByGroup.get(g.key) ?? g.byArticle;
      const t = (id: string) => { const a = articleById.get(id); return a?.publishedAt ? Date.parse(a.publishedAt) || -Infinity : -Infinity; };
      g.byArticle.articles.sort((a, b) => st.sort === 'oldest' ? (t(a.articleId) === t(b.articleId) ? 0 : t(a.articleId) === -Infinity ? 1 : t(b.articleId) === -Infinity ? -1 : t(a.articleId) - t(b.articleId)) : st.sort === 'linked' ? b.claims.length - a.claims.length : (t(b.articleId) - t(a.articleId)) || 0);
    });
    const gcmp = (a: Group, b: Group) => {
      if (st.sort === 'newest' && !!b.ongoing !== !!a.ongoing) return Number(!!b.ongoing) - Number(!!a.ongoing);
      if (st.sort === 'oldest') return (a.first ?? '9').localeCompare(b.first ?? '9') || a.title.localeCompare(b.title);
      if (st.sort === 'linked') return b.byArticle.articleCount - a.byArticle.articleCount || a.title.localeCompare(b.title);
      return (b.latest - a.latest) || a.title.localeCompare(b.title);
    };
    const cats = new Map<string, Group[]>();
    for (const g of gs) { const l = cats.get(g.cat) ?? []; l.push(g); cats.set(g.cat, l); }
    return [...cats.entries()]
      .map(([cat, list]) => ({ cat, groups: list.sort(gcmp), count: new Set(list.flatMap(g => g.claims.map(c => c.id))).size, articles: new Set(list.flatMap(g => g.byArticle.articles.map(a => a.articleId))).size, complete: list.every(g => g.byArticle.complete), ongoing: list.reduce((n, g) => n + g.ongoing, 0) }))
      .sort((a, b) => (catOrder.get(a.cat) ?? 999) - (catOrder.get(b.cat) ?? 999));
  }, [filtered, catOrder, st.sort, wholeByGroup, articleById]);

  const selectedClaim = st.claim ? claims.find(c => c.id === st.claim) ?? null : null;
  useEffect(() => {
    const s = st.claim ? summaryById.get(st.claim) : undefined;
    if (!s?.topicId || !s.categoryId || !st.topic) return;
    const movedCategory = s.topicId === st.topic && s.secondaryCategories?.some(c => c.id === st.category);
    const scopedLegacyTopic = s.topicId.startsWith(`${st.topic}--`);
    if ((movedCategory || scopedLegacyTopic) && (s.categoryId !== st.category || s.topicId !== st.topic))
      update({ category: s.categoryId, topic: s.topicId });
  }, [st.claim, st.category, st.topic, summaryById, update]);
  const orderedGroups = tree.flatMap(c => c.groups);
  const defaultGroup = orderedGroups.find(g => g.ongoing > 0) ?? orderedGroups[0];
  const selectedFocus = st.focus ? orderedGroups.find(g => g.key === st.focus) : defaultGroup;
  const current = selectedClaim;
  const currentSummary = current ? (filtered.find(v => v.claim.id === current.id)?.summary ?? summaryById.get(current.id)) : undefined;
  const hiddenByFilters = !!selectedClaim && !filtered.some(v => v.claim.id === selectedClaim.id);
  const currentGroup = current ? groupKey(currentSummary) : selectedFocus?.key ?? null;
  // Keep the overview compact; expand only a deliberately selected claim/topic.
  const isOpen = (g: Group) => openGroups[g.key] ?? Boolean(st.claim && g.key === currentGroup || st.topic && g.topic === st.topic);
  const currentArticleIds = currentSummary?.articleIds ?? [];
  const isArticleOpen = (g: Group, aid: string) => openArticles[`${g.key}::${aid}`] ?? Boolean(st.claim && g.key === currentGroup && currentArticleIds.includes(aid));
  const legacy = current?.observations ?? [];
  const active = !!(st.q || st.category || st.topic || st.recency !== 'all' || st.sort !== 'newest');
  const reset = () => update({ q: '', category: '', topic: '', recency: 'all', sort: 'newest' });
  const ongoingTotal = claims.filter(c => summaryById.get(c.id)?.ongoing).length;

  const claimRow = (c: TrackedRecord, extra?: string, nested = false, scope?: ClaimSummary) => {
    const sm = scope ?? summaryById.get(c.id);
    const on = current?.id === c.id && (!scope || groupKey(scope) === currentGroup);
    return (
      <li key={c.id}>
        <button onClick={() => update({ claim: c.id, focus: null, ...(scope ? { category: scope.categoryId ?? '', topic: scope.topicId ?? '' } : {}) }, true)} data-testid={`button-claim-${c.id}`} aria-current={on || undefined}
          className={cn('w-full border-l-2 py-2.5 pr-4', nested ? 'pl-14' : 'pl-9', ' text-left transition-colors', on ? 'border-[hsl(212_24%_42%)] bg-[hsl(212_20%_96%)]' : 'border-transparent hover:bg-card/60')}>
          {extra && <span className="mb-1 block font-mono text-[9px] uppercase text-muted-foreground">{extra}</span>}
          {sm?.ongoing && <span className="mb-1 block font-mono text-[9px] uppercase text-muted-foreground" title={sm.developmentReason ?? undefined}>{sm.developmentType ?? 'Ongoing'}</span>}
          <p className="line-clamp-2 font-serif text-[15px] leading-snug">{c.title}</p>
          {!nested && <p className="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-muted-foreground" data-testid={`text-claim-coverage-${c.id}`}>
            {sumQ.isLoading ? <span className="inline-block h-2.5 w-28 animate-pulse rounded bg-muted" />
              : sumQ.isError ? <span>Coverage unknown</span>
              : !sm ? <span>No article attributions</span>
              : <><span>{dateRange(sm.firstDate, sm.lastDate)}</span><span aria-hidden>·</span>
                  <span className={cn('rounded-sm px-1', on ? TONE.slate : '')}>{sm.attributions.toLocaleString('en-US')} attribution{sm.attributions === 1 ? '' : 's'}</span>
                  {sm.articleIds && <><span aria-hidden>·</span><span>{sm.articleIds.length} article{sm.articleIds.length === 1 ? '' : 's'}</span></>}</>}
          </p>}
        </button>
      </li>
    );
  };

  const topicStats = (g: Group) => {
    if (sumQ.isLoading) return <span className="inline-block h-2.5 w-24 animate-pulse rounded bg-muted align-middle" />;
    if (sumQ.isError) return <>Articles unknown · {plural(g.claims.length, 'claim')}</>;
    const a = g.byArticle, t = g.total, plus = (x: Grouping) => x.complete ? '' : '+';
    const narrowed = a.articleCount !== t.articleCount || g.claims.length !== t.unattributed.length + new Set(t.articles.flatMap(r => r.claims.map(c => c.id))).size;
    if (!narrowed) return <><span className="font-semibold text-foreground">{plural(a.articleCount, 'article')}{plus(a)}</span> · {plural(g.claims.length, 'claim')}</>;
    const totalClaims = new Set([...t.unattributed, ...t.articles.flatMap(r => r.claims)].map(c => c.id)).size;
    return <><span className="font-semibold text-foreground">{a.articleCount}{plus(a)} of {t.articleCount}{plus(t)} articles matching</span> · {g.claims.length} of {plural(totalClaims, 'claim')}</>;
  };

  const articleList = (g: Group) => {
    const known = g.byArticle.unattributed.filter(c => Array.isArray(summaryById.get(c.id)?.articleIds));
    const unknown = g.byArticle.unattributed.filter(c => !Array.isArray(summaryById.get(c.id)?.articleIds));
    const sub = (key: string, label: string, list: TrackedRecord[], testId: string) => list.length > 0 && (
      <li key={key}>
        <button onClick={() => setOpenArticles(o => ({ ...o, [`${g.key}::${key}`]: !(o[`${g.key}::${key}`] ?? list.some(c => c.id === current?.id && !!st.claim)) }))} data-testid={testId}
          aria-expanded={openArticles[`${g.key}::${key}`] ?? list.some(c => c.id === current?.id && !!st.claim)}
          className="flex w-full items-start gap-2 py-2 pl-8 pr-4 text-left hover:bg-card/60">
          {(openArticles[`${g.key}::${key}`] ?? list.some(c => c.id === current?.id && !!st.claim)) ? <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />}
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label} · {plural(list.length, 'claim')}</span>
        </button>
        {(openArticles[`${g.key}::${key}`] ?? list.some(c => c.id === current?.id && !!st.claim)) && <ul>{list.map(c => claimRow(c, undefined, true))}</ul>}
      </li>
    );
    return (
      <ul data-testid={`list-topic-articles-${g.cat}-${g.topic}`}>
        {g.byArticle.articles.map(({ articleId, claims: cs }) => {
          const art = articleById.get(articleId);
          const aopen = isArticleOpen(g, articleId);
          const k = `${g.key}::${articleId}`;
          return (
            <li key={articleId} data-testid={`row-article-${g.topic}-${articleId}`}>
              <div className="flex items-start gap-1 pr-3 hover:bg-card/60">
                <button onClick={() => setOpenArticles(o => ({ ...o, [k]: !aopen }))} aria-expanded={aopen} data-testid={`button-article-${g.topic}-${articleId}`}
                  className="flex min-w-0 flex-1 items-start gap-2 py-2 pl-8 text-left">
                  {aopen ? <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0">
                    <span className="line-clamp-2 block text-[13px] leading-snug">{art?.title ?? <span className="text-muted-foreground">Article not in workspace ({articleId})</span>}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                      {art?.outlet ?? 'Outlet unknown'} · {art?.publishedAt ? fmtDate(art.publishedAt) : 'Date unknown'} · {plural(cs.length, 'claim')}
                    </span>
                  </span>
                </button>
                {art && isSignedIn && <div className="mt-2 shrink-0"><FocusCorrection article={art} compact /></div>}
                <Link href={`/feed?article=${encodeURIComponent(articleId)}`} title="Open article in feed" aria-label="Open article in feed" data-testid={`link-article-feed-${articleId}`}
                  className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground">
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
              {aopen && <ul>{cs.map(c => claimRow(c, undefined, true, g.summaries.get(c.id)))}</ul>}
            </li>
          );
        })}
        {sub('_none', 'No article attribution', known, `button-unattributed-${g.topic}`)}
        {sub('_unknown', 'Attribution linkage unknown', unknown, `button-linkage-unknown-${g.topic}`)}
      </ul>
    );
  };

  return (
    <div className="tw-rise flex min-h-[100dvh] flex-col">
      <PageHead title="Claims" count={claims.length}>
        {isSignedIn
          ? <button onClick={() => setCreating(true)} data-testid="button-new-claim" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> Claim</button>
          : null}
      </PageHead>
      <RecentDevelopmentAlerts articles={articles} summaries={sumQ.data as ClaimSummary[] | undefined} loading={isLoading} error={isError} onRetry={() => refetch()}
        summariesLoading={sumQ.isLoading} summariesError={sumQ.isError} />

      <div className="tw-glass sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5 backdrop-blur md:px-8" data-testid="bar-claim-filters">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={st.q} onChange={e => update({ q: e.target.value })} placeholder="Search claims, topics, entities" className="h-8 bg-card pl-8 text-sm" data-testid="input-claim-search" />
        </div>
        <select value={st.category} onChange={e => update({ category: e.target.value, topic: '' })} aria-label="Primary category" className={selectCls} data-testid="select-claim-category">
          <option value="">All categories</option>
          {categoryOptions.map(id => <option key={id} value={id}>{categoryLabel(id, categoryById)}</option>)}
        </select>
        <select value={st.topic} onChange={e => update({ topic: e.target.value })} aria-label="Topic" className={cn(selectCls, 'max-w-[220px]')} data-testid="select-claim-topic">
          <option value="">All topics</option>
          {topicOptions.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
        </select>
        <div className="inline-flex h-8 overflow-hidden rounded-md border border-input text-xs" role="group" aria-label="Recency">
          {(['ongoing', 'all'] as const).map(r => (
            <button key={r} onClick={() => update({ recency: r })} aria-pressed={st.recency === r} data-testid={`button-recency-${r}`}
              className={cn('px-3', st.recency === r ? 'bg-foreground text-background' : 'bg-card hover:bg-muted')}>{r === 'ongoing' ? `Ongoing · ${ongoingTotal}` : 'All'}</button>
          ))}
        </div>
        <select value={st.sort} onChange={e => update({ sort: e.target.value as Sort })} aria-label="Sort" className={selectCls} data-testid="select-claim-sort">
          <option value="newest">Newest reporting</option>
          <option value="oldest">Oldest first</option>
          <option value="linked">Most linked articles</option>
        </select>
        <button onClick={reset} disabled={!active} className="text-xs underline underline-offset-4 disabled:opacity-40" data-testid="button-reset-claim-filters">Reset</button>
      </div>

      {catQ.isError && <p className="flex items-center gap-2 border-b border-border px-5 py-1.5 text-[11px] text-muted-foreground md:px-8" data-testid="text-categories-error">Category catalog unavailable; showing raw category ids. <button className="underline" onClick={() => catQ.refetch()}>Retry</button></p>}

      {isLoading ? <RowsSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} /> : claims.length === 0 ? (
        <Empty title="No claim histories" />
      ) : (
        <div className="grid flex-1 md:grid-cols-[340px_minmax(0,1fr)]">
          <div className="max-h-[50dvh] overflow-y-auto border-b border-border md:max-h-[calc(100dvh-205px)] md:border-b-0 md:border-r">
            {sumQ.isError && <p className="flex items-center justify-between px-5 py-2 text-[11px] text-muted-foreground" data-testid="text-summary-error">Coverage summaries unavailable; grouping falls back to Uncategorized <button className="underline" onClick={() => sumQ.refetch()}>Retry</button></p>}
            {hiddenByFilters && selectedClaim && (
              <ul className="border-b border-border" data-testid="section-pinned-claim">{claimRow(selectedClaim, 'Linked claim · outside current filters')}</ul>
            )}
            {tree.length === 0 ? (
              <Empty title="No claims match"><button onClick={reset} className="text-xs text-accent underline" data-testid="button-claims-empty-clear">Reset filters</button></Empty>
            ) : tree.map(cat => (
              <section key={cat.cat} data-testid={`category-${cat.cat}`}>
                <h3 className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-b border-border bg-background/60 px-5 py-2 font-mono text-[10px] uppercase tracking-wide">
                  <span title={categoryById.get(cat.cat)?.description}>{categoryLabel(cat.cat, categoryById, summaryById.get(cat.groups[0]?.claims[0]?.id ?? ''))}</span>
                  <span className="text-muted-foreground" data-testid={`text-category-counts-${cat.cat}`}>{sumQ.isLoading ? '…' : sumQ.isError ? 'Articles unknown' : `${cat.articles}${cat.complete ? '' : '+'} article${cat.articles === 1 ? '' : 's'}`} · {plural(cat.count, 'claim')}</span>
                </h3>
                <ul>
                  {cat.groups.map(g => {
                    const open = isOpen(g);
                    return (
                      <li key={g.key} className="border-b border-border/60">
                        <button onClick={() => { setOpenGroups(o => ({ ...o, [g.key]: !open })); update({ claim: null, focus: g.key }, true); }}
                          aria-expanded={open} aria-current={!st.claim && g.key === currentGroup || undefined} data-testid={`button-topic-${g.cat}-${g.topic}`}
                          className={cn("flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-card/60", g.key === currentGroup && "bg-card/60")}>
                          {open ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium leading-snug">{g.title}</span>
                            {!!g.developments.length && <span className="mt-1 block text-[11px] leading-snug text-muted-foreground" data-testid={`text-developments-${g.topic}`}>Developments: {g.developments.slice(0, 3).join(' · ')}{g.developments.length > 3 ? ` · +${g.developments.length - 3} more in details` : ''}</span>}
                            <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground" data-testid={`text-topic-counts-${g.cat}-${g.topic}`}>
                              {topicStats(g)} · {sumQ.isLoading ? '…' : dateRange(g.first, g.last)}
                            </span>
                          </span>
                        </button>
                        {isSignedIn && g.topic !== '_unassigned' && g.total.articleCount > 0 && <div className="px-6"><FocusGroupEditor topicId={g.topic}
                          onSaved={d => { if (st.topic === g.topic || st.focus === g.key || (!st.claim && !st.focus && currentGroup === g.key)) update({ category: st.category ? d.effective.categoryId : '', topic: st.topic ? d.effective.topicId : '', focus: `${d.effective.categoryId}::${d.effective.topicId}` }); }}
                          onArticlesSaved={r => r.focus ? update({ claim: null, focus: `${r.focus.categoryId}::${r.focus.topicId}`, category: r.focus.categoryId, topic: r.focus.topicId, q: '', recency: 'all' }, true)
                            : update({ claim: null, focus: null, category: '', topic: '', q: '', recency: 'all' }, true)} /></div>}
                        {open && <div className="pb-1">{articleList(g)}</div>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          {current ? (
            <ClaimDetail current={current} summary={currentSummary} catLabel={categoryLabel(categoryKey(currentSummary), categoryById, currentSummary)}
              isSignedIn={isSignedIn} onEdit={() => setEditing(current)} onDelete={() => setDeleting(current)}
              onTopic={() => update({ category: categoryKey(currentSummary), topic: currentSummary?.topicId ?? '' })}
              focusArticleCount={wholeByGroup.get(groupKey(currentSummary))?.articleCount}
              claimArticleCount={summaryById.get(current.id)?.articleIds?.length}
              onFocusOverview={() => update({ claim: null, focus: groupKey(currentSummary), category: categoryKey(currentSummary), topic: topicKey(currentSummary), q: '', recency: 'all' }, true)}
              scopeLine={<span data-testid="text-claim-scope-counts">{sumQ.isLoading ? <span className="inline-block h-2.5 w-28 animate-pulse rounded bg-muted align-middle" />
                : sumQ.isError ? 'Articles unknown' : !currentSummary ? 'No article attributions'
                : <>{currentSummary.articleIds ? plural(new Set(currentSummary.articleIds).size, 'article') : 'Articles unknown'} in this focus · {plural(currentSummary.attributions, 'attribution')} · {dateRange(currentSummary.firstDate, currentSummary.lastDate)}</>}</span>}
              legacy={legacy} articleById={articleById} />
          ) : st.claim ? (
            <Empty title="Claim not found"><button onClick={() => update({ claim: null })} className="text-xs text-accent underline" data-testid="button-claim-missing-clear">Show claims</button></Empty>
          ) : selectedFocus ? <FocusOverview key={selectedFocus.key} title={selectedFocus.title} category={categoryLabel(selectedFocus.cat, categoryById)} topic={selectedFocus.topic}
              articles={selectedFocus.byArticle.articles} unattributed={selectedFocus.byArticle.unattributed} totalArticles={selectedFocus.total.articleCount}
              complete={selectedFocus.byArticle.complete} summaries={selectedFocus.summaries} articleById={articleById}
              stats={topicStats(selectedFocus)} range={sumQ.isLoading ? '…' : sumQ.isError ? 'Date unknown' : dateRange(selectedFocus.first, selectedFocus.last)}
              loading={sumQ.isLoading} error={sumQ.isError} onRetry={() => sumQ.refetch()}
              onClaim={(c, scope) => update({ claim: c.id, focus: null, category: categoryKey(scope), topic: topicKey(scope) }, true)} />
            : st.focus ? <Empty title="Focus group not available with these filters"><button className="text-xs underline" data-testid="button-clear-focus" onClick={() => update({ focus: null })}>Show matching groups</button></Empty> : null}
        </div>
      )}
      {(creating || !!editing) && <ClaimEditor open onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }} record={editing} articles={articles} />}
      <ConfirmDelete target={deleting} onClose={() => { setDeleting(null); update({ claim: null }); }} />
    </div>
  );
}

function ClaimDetail({ current, summary, catLabel, isSignedIn, onEdit, onDelete, onTopic, onFocusOverview, focusArticleCount, claimArticleCount, legacy, articleById, scopeLine }: {
  scopeLine?: ReactNode;
  current: TrackedRecord; summary?: ClaimSummary; catLabel: string; isSignedIn: boolean; onEdit: () => void; onDelete: () => void; onTopic: () => void;
  onFocusOverview: () => void; focusArticleCount?: number; claimArticleCount?: number;
  legacy: NonNullable<TrackedRecord['observations']>; articleById: Map<string, TrackedRecord>;
}) {
  return (
    <section className="min-w-0 px-5 py-6 md:max-h-[calc(100dvh-205px)] md:overflow-y-auto md:px-10" data-testid={`detail-claim-${current.id}`}>
      <nav className="mb-2 flex flex-wrap items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground" aria-label="Claim location" data-testid="text-claim-breadcrumb">
        <span className="text-muted-foreground">Primary category:</span><span>{catLabel}</span><ChevronRight className="h-3 w-3" />
        <button onClick={onTopic} className="uppercase hover:text-foreground hover:underline" data-testid="button-claim-topic-filter">{topicLabel(summary)}</button>
      </nav>
      {scopeLine && <p className="mb-1 font-mono text-[10px] text-muted-foreground">{scopeLine}</p>}
      <FocusContext summary={summary} />
      {summary?.classificationReason && <Disclosure label="Why this category" testId="details-category-assignment" className="mb-2 max-w-3xl">
        <p className="text-[11px] text-muted-foreground" data-testid="text-classification-reason">{summary.classificationReason}</p>
      </Disclosure>}
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
            <button onClick={onEdit} aria-label="Edit claim wording and notes" title="Edit claim wording and notes" className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground" data-testid="button-edit-claim"><Pencil className="h-4 w-4" /></button>
            <button onClick={onDelete} aria-label="Remove claim from workspace" title="Remove claim from workspace" className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-destructive" data-testid="button-delete-claim"><Trash2 className="h-4 w-4" /></button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>This individual claim · {claimArticleCount == null ? 'article links unknown' : `${claimArticleCount} linked article${claimArticleCount === 1 ? '' : 's'}`}</span>
        <button onClick={onFocusOverview} className="font-medium text-foreground underline underline-offset-2" data-testid="button-view-focus-coverage">
          View {focusArticleCount == null ? 'all' : focusArticleCount} article{focusArticleCount === 1 ? '' : 's'} in this focus
        </button>
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
  );
}
