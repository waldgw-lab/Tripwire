import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { TrackedRecord } from '@workspace/api-client-react';
import { ChevronDown, ChevronRight, ExternalLink, Flag, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Impact } from '@/lib/article-signals';
import type { FeedDevelopmentGroup, FeedGroupOrder } from '@/lib/feed-development-groups';
import { feedPublication, impactTextColor } from '@/lib/feed-format';
import { FeedMeta } from '@/components/feed/feed-meta';
import { OutletBrand } from '@/components/outlet-brand';
import { isFlagged } from '@/lib/workspace';
import { DevelopmentOverview, useNow } from '@/components/feed/development-overview';

export type GroupLayout = 'briefing' | 'compare' | 'board';
type ImpactInfo = { value: Impact; reason: string };

export type GroupedFeedProps = {
  groups: FeedDevelopmentGroup[];
  layout: GroupLayout;
  order: FeedGroupOrder;
  onLayout: (l: GroupLayout) => void;
  onOrder: (o: FeedGroupOrder) => void;
  impactOf: (a: TrackedRecord) => ImpactInfo;
  open: string | null;
  setOpen: (id: string | null) => void;
  signedIn: boolean;
  onToggleFlag: (a: TrackedRecord) => void;
  flagPending: boolean;
  onEdit: (a: TrackedRecord) => void;
  onDelete: (a: TrackedRecord) => void;
};

export const LAYOUTS: { id: GroupLayout; label: string }[] = [
  { id: 'briefing', label: 'Briefing' }, { id: 'compare', label: 'Compare' }, { id: 'board', label: 'Board' },
];
const ORDERS: { id: FeedGroupOrder; label: string }[] = [
  { id: 'relevant', label: 'Relevant' }, { id: 'newest', label: 'Newest' }, { id: 'coverage', label: 'Coverage' },
];
const PAGE = 30;
const outletName = (a: TrackedRecord) => (a.sourceType === 'x' ? (a.outlet ?? 'X') : (a.outlet ?? 'Unknown outlet'));
const brandName = (a: TrackedRecord) => (a.sourceType === 'x' ? 'X' : (a.outlet ?? '—'));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function span(g: FeedDevelopmentGroup) {
  if (!g.latestAt) return 'Undated';
  const l = feedPublication(g.latestAt);
  if (!g.earliestAt || g.earliestAt === g.latestAt) return `${l.date} ${l.time}`;
  const e = feedPublication(g.earliestAt);
  return e.date === l.date ? `${l.date} ${e.time}–${l.time}` : `${e.date} ${e.time} – ${l.date} ${l.time}`;
}
const KIND: Record<FeedDevelopmentGroup['kind'], string> = { development: 'Development', 'similar-headlines': 'Similar headlines', single: 'Single article' };

/* ---------- shared pieces ---------- */

function Actions({ a, p, compact }: { a: TrackedRecord; p: GroupedFeedProps; compact?: boolean }) {
  const s = compact ? 'h-7 w-7' : 'h-8 w-8';
  return (
    <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {a.url && <a href={a.url} target="_blank" rel="noreferrer" aria-label="Open publisher article in a new tab" className={cn('flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground', s)} data-testid={`link-group-source-${a.id}`}><ExternalLink className="h-4 w-4" /></a>}
      {p.signedIn && (
        <>
          <button onClick={() => p.onToggleFlag(a)} disabled={p.flagPending} aria-pressed={isFlagged(a)} aria-label={isFlagged(a) ? 'Unflag article' : 'Flag article'} title={isFlagged(a) ? 'Unflag' : 'Flag'}
            className={cn('flex items-center justify-center rounded-md', s, isFlagged(a) ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')} data-testid={`button-group-flag-${a.id}`}>
            <Flag className={cn('h-4 w-4', isFlagged(a) && 'fill-current')} />
          </button>
          <button onClick={() => p.onEdit(a)} aria-label="Edit article" className={cn('flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground', s)} data-testid={`button-group-edit-${a.id}`}><Pencil className="h-4 w-4" /></button>
          <button onClick={() => p.onDelete(a)} aria-label="Delete article" className={cn('flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive', s)} data-testid={`button-group-delete-${a.id}`}><Trash2 className="h-4 w-4" /></button>
        </>
      )}
    </div>
  );
}

/** Metadata wraps freely; actions sit top-right; headline below keeps full width. */
function MetaRow({ a, p, children }: { a: TrackedRecord; p: GroupedFeedProps; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-2">
      <div className="min-w-[110px] flex-1">{children ?? <FeedMeta article={a} impact={p.impactOf(a)} />}</div>
      <div className="-mr-1 -mt-1.5 ml-auto"><Actions a={a} p={p} compact /></div>
    </div>
  );
}

/** Feed-faithful row: large outlet icon, metadata above the original headline. */
function ArticleRow({ a, p, size = 'md' }: { a: TrackedRecord; p: GroupedFeedProps; size?: 'md' | 'sm' }) {
  const active = p.open === a.id;
  return (
    <li onClick={() => p.setOpen(a.id)} className={cn('tw-group-row group relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 sm:gap-x-4', active && 'tw-group-row-active')} data-testid={`row-group-article-${a.id}`}>
      <OutletBrand name={brandName(a)} variant="square" className={cn('mt-0.5 shrink-0 rounded-xl shadow-sm', size === 'md' ? 'h-12 w-12 sm:h-14 sm:w-14' : 'h-10 w-10')} />
      <div className="min-w-0 flex-1">
        <MetaRow a={a} p={p} />
        <button onClick={(e) => { e.stopPropagation(); p.setOpen(a.id); }} aria-expanded={active} aria-controls="article-reader" title={a.title}
          className="block w-full text-left text-[16px] font-medium leading-snug hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 sm:text-[17px]" data-testid={`button-group-open-${a.id}`}>
          {a.title}
        </button>
      </div>
    </li>
  );
}

function Tones({ g }: { g: FeedDevelopmentGroup }) {
  const t = g.tones;
  const parts = (['positive', 'negative', 'neutral', 'mixed'] as const).filter((k) => t[k] > 0).map((k) => `${t[k]} ${k}`);
  if (!parts.length && !t.unassessed) return null;
  return (
    <span className="font-mono text-[10.5px] text-muted-foreground" data-testid={`text-group-tone-${g.id}`}>
      Recorded tone: {parts.length ? parts.join(' · ') : 'none'}{t.unassessed ? ` · ${t.unassessed} unassessed` : ''}
    </span>
  );
}

function ClaimLinks({ g }: { g: FeedDevelopmentGroup }) {
  if (!g.claimLinks.length) return null;
  const link = (l: FeedDevelopmentGroup['claimLinks'][number]) => (
    <Link key={`${l.categoryId}:${l.topicId}`} href={`/claims?${new URLSearchParams({ category: l.categoryId, topic: l.topicId, focus: `${l.categoryId}::${l.topicId}` })}`}
      title={`${l.title} (${plural(l.articleCount, 'article')} here)`}
      className="inline-flex max-w-[240px] items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] hover:border-foreground/40"
      data-testid={`link-group-claim-${g.id}-${l.topicId}`}>
      <span className="min-w-0 truncate">{l.title}</span><span className="shrink-0 font-mono text-muted-foreground">{l.articleCount}</span>
    </Link>
  );
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5" data-testid={`claims-group-${g.id}`}>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Claims</span>
      {g.claimLinks.slice(0, 2).map(link)}
      {g.claimLinks.length > 2 && (
        <details className="relative">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] hover:border-foreground/40 [&::-webkit-details-marker]:hidden"
            aria-label={`Show ${g.claimLinks.length - 2} more Claims links`}>
            +{g.claimLinks.length - 2} more <ChevronDown className="h-3 w-3" />
          </summary>
          <div className="absolute right-0 top-full z-30 mt-2 flex max-h-64 w-[280px] max-w-[calc(100vw-3rem)] flex-col items-start gap-1.5 overflow-auto rounded-lg border border-border bg-popover p-3 shadow-lg">
            {g.claimLinks.slice(2).map(link)}
          </div>
        </details>
      )}
    </div>
  );
}

function Counts({ g }: { g: FeedDevelopmentGroup }) {
  return (
    <span className="font-mono text-[11px] text-muted-foreground" data-testid={`text-group-counts-${g.id}`}>
      {plural(g.articles.length, 'article')} · {plural(g.outlets.length, 'outlet')} · {span(g)}
    </span>
  );
}

function GroupHeader({ g, as = 'h3' }: { g: FeedDevelopmentGroup; as?: 'h3' | 'h4' }) {
  const H = as;
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
    <div className="min-w-0 flex-1 basis-[18rem] space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/70">{KIND[g.kind]}</span>
        {g.highestImpact && <span className={cn('font-mono text-[10.5px] font-semibold uppercase tracking-wider', impactTextColor[g.highestImpact])}>{g.highestImpact}</span>}
        <Counts g={g} />
      </div>
      <H className="font-display text-[19px] font-semibold leading-tight tracking-tight sm:text-[21px]" data-testid={`text-group-title-${g.id}`}>{g.title}</H>
    </div>
    {g.claimLinks.length > 0 && <div className="max-w-full sm:max-w-[50%]"><ClaimLinks g={g} /></div>}
    </div>
  );
}

function ShowAll({ g, shown, open, onToggle }: { g: FeedDevelopmentGroup; shown: number; open: boolean; onToggle: () => void }) {
  if (g.articles.length <= shown && !open) return null;
  return (
    <button onClick={onToggle} aria-expanded={open} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-muted" data-testid={`button-group-showall-${g.id}`}>
      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      {open ? 'Show fewer' : `Show all ${plural(g.articles.length, 'article')} from ${plural(g.outlets.length, 'outlet')}`}
    </button>
  );
}

function useExpanded() {
  const [s, set] = useState<Record<string, boolean>>({});
  return [s, (id: string) => set((p) => ({ ...p, [id]: !p[id] }))] as const;
}
/** Keeps the selected article visible even when it sits beyond the preview. */
const previewOf = (g: FeedDevelopmentGroup, n: number, all: boolean, open: string | null) => {
  if (all) return g.articles;
  const head = g.articles.slice(0, n);
  const sel = open ? g.articles.find((a, i) => i >= n && a.id === open) : undefined;
  return sel ? [...head, sel] : head;
};

type ViewProps = { groups: FeedDevelopmentGroup[]; p: GroupedFeedProps; now: number };

/* ---------- Briefing ---------- */

function Briefing({ groups, p, now }: ViewProps) {
  const [exp, toggle] = useExpanded();
  return (
    <ol className="space-y-2.5">
      {groups.map((g) => {
        if (g.kind === 'single') {
          return <li key={g.id} className="tw-feed-item rounded-xl px-1.5 py-1 md:px-3" data-testid={`group-${g.id}`}><ol><ArticleRow a={g.articles[0]} p={p} /></ol></li>;
        }
        const list = previewOf(g, 3, !!exp[g.id], p.open);
        return (
          <li key={g.id} className="tw-feed-item tw-group-bundle rounded-xl px-3 py-3 md:px-5" data-testid={`group-${g.id}`}>
            <GroupHeader g={g} />
            <div className="tw-brief-split mt-2 grid gap-3">
              <div className="tw-brief-overview min-w-0"><DevelopmentOverview id={g.id} articles={g.articles} now={now} open={p.open} onOpen={p.setOpen} /></div>
              <div className="tw-brief-reporting min-w-0">
                <ol className="divide-y divide-border/60 border-l-2 border-foreground/15 pl-2">{list.map((a) => <ArticleRow key={a.id} a={a} p={p} />)}</ol>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <ShowAll g={g} shown={3} open={!!exp[g.id]} onToggle={() => toggle(g.id)} />
                  <Tones g={g} />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Compare ---------- */

function Compare({ groups, p, now }: ViewProps) {
  const [exp, toggle] = useExpanded();
  return (
    <ol className="space-y-4">
      {groups.map((g) => {
        if (g.kind === 'single') {
          return <li key={g.id} className="tw-feed-item rounded-xl px-1.5 py-1 md:px-3" data-testid={`group-${g.id}`}><ol><ArticleRow a={g.articles[0]} p={p} /></ol></li>;
        }
        const byOutlet = new Map<string, TrackedRecord[]>();
        for (const a of g.articles) { const k = outletName(a); byOutlet.set(k, [...(byOutlet.get(k) ?? []), a]); }
        const all = !!exp[g.id];
        const cols = [...byOutlet.entries()];
        const hidden = cols.reduce((n, [, arts]) => n + Math.max(0, arts.length - 2), 0);
        return (
          <li key={g.id} className="tw-feed-item tw-group-bundle rounded-xl px-3 py-3 md:px-5" data-testid={`group-${g.id}`}>
            <GroupHeader g={g} />
            <div className="mt-1"><Tones g={g} /></div>
            <div className="mt-2.5"><DevelopmentOverview id={g.id} articles={g.articles} now={now} open={p.open} onOpen={p.setOpen} variant="band" /></div>
            <div className="tw-compare-grid mt-3 grid gap-2.5">
              {cols.map(([outlet, arts]) => {
                const list = all ? arts : arts.slice(0, 2).concat(arts.slice(2).filter((a) => a.id === p.open));
                return (
                  <section key={outlet} className="rounded-lg border border-border/70 bg-card/70 p-2.5" data-testid={`column-outlet-${g.id}-${outlet}`}>
                    <div className="mb-2 flex items-center gap-2.5 border-b border-border/60 pb-2">
                      <OutletBrand name={brandName(arts[0])} variant="square" className="h-11 w-11 shrink-0 rounded-xl shadow-sm" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold uppercase tracking-wide">{outlet}</p>
                        <p className="font-mono text-[10.5px] text-muted-foreground">{plural(arts.length, 'article')}</p>
                      </div>
                    </div>
                    <ol className="space-y-2">
                      {list.map((a) => {
                        const pub = feedPublication(a.publishedAt ?? undefined);
                        const active = p.open === a.id;
                        const imp = p.impactOf(a);
                        return (
                          <li key={a.id} onClick={() => p.setOpen(a.id)} className={cn('tw-group-row cursor-pointer rounded-md px-1.5 py-1.5', active && 'tw-group-row-active')} data-testid={`row-group-article-${a.id}`}>
                            <MetaRow a={a} p={p}>
                              <div className="mb-0.5 flex flex-wrap items-center gap-x-1.5 pt-1 font-mono text-[10.5px] text-neutral-600">
                                <time dateTime={a.publishedAt ?? undefined}>{a.publishedAt ? `${pub.date} ${pub.time}` : 'Undated'}</time>
                                <span aria-hidden className="text-muted-foreground/50">·</span>
                                <span title={imp.reason} className={cn('font-semibold uppercase tracking-wider', impactTextColor[imp.value])}>{imp.value}</span>
                              </div>
                            </MetaRow>
                            <button onClick={(e) => { e.stopPropagation(); p.setOpen(a.id); }} aria-expanded={active} aria-controls="article-reader" className="block w-full text-left text-[16px] font-medium leading-snug hover:underline sm:text-[17px]" data-testid={`button-group-open-${a.id}`}>{a.title}</button>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {(hidden > 0 || all) && (
                <button onClick={() => toggle(g.id)} aria-expanded={all} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-muted" data-testid={`button-group-showall-${g.id}`}>
                  {all ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {all ? 'Show fewer' : `Show all ${plural(g.articles.length, 'article')} (${hidden} more)`}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Board ---------- */

function Board({ groups, p }: ViewProps) {
  const [exp, toggle] = useExpanded();
  return (
    <ol className="tw-board-grid grid gap-3">
      {groups.map((g) => {
        const lead = g.articles[0];
        const all = !!exp[g.id];
        const rest = previewOf(g, 3, all, p.open).slice(1);
        const leadActive = p.open === lead.id;
        return (
          <li key={g.id} className={cn('tw-feed-item flex flex-col rounded-xl p-3', g.articles.length > 1 && 'tw-board-multi', all && 'tw-board-open')} data-testid={`group-${g.id}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex -space-x-2">
                {g.articles.filter((a, i, arr) => arr.findIndex((b) => outletName(b) === outletName(a)) === i).slice(0, 5).map((a) => (
                  <OutletBrand key={a.id} name={brandName(a)} variant="square" className="h-10 w-10 rounded-lg ring-2 ring-card" />
                ))}
                {g.outlets.length > 5 && <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted font-mono text-[11px] ring-2 ring-card">+{g.outlets.length - 5}</span>}
              </div>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/60">{KIND[g.kind]}</span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2">
              {g.highestImpact && <span className={cn('font-mono text-[10.5px] font-semibold uppercase tracking-wider', impactTextColor[g.highestImpact])}>{g.highestImpact}</span>}
              <Counts g={g} />
            </div>
            {g.kind !== 'single' && <h3 className="mt-1 font-display text-[18px] font-semibold leading-tight" data-testid={`text-group-title-${g.id}`}>{g.title}</h3>}
            <div onClick={() => p.setOpen(lead.id)} className={cn('tw-group-row mt-2 cursor-pointer rounded-md px-1.5 py-1.5', leadActive && 'tw-group-row-active')} data-testid={`row-group-article-${lead.id}`}>
              <MetaRow a={lead} p={p} />
              <div>
                <button onClick={(e) => { e.stopPropagation(); p.setOpen(lead.id); }} aria-expanded={leadActive} aria-controls="article-reader"
                  className="block w-full text-left text-[16px] font-medium leading-snug hover:underline sm:text-[17px]" data-testid={`button-group-open-${lead.id}`}>{lead.title}</button>
              </div>
            </div>
            {rest.length > 0 && <ol className="mt-1 divide-y divide-border/60">{rest.map((a) => <ArticleRow key={a.id} a={a} p={p} size="sm" />)}</ol>}
            <div className="mt-auto space-y-1.5 pt-2">
              <ShowAll g={g} shown={3} open={all} onToggle={() => toggle(g.id)} />
              {g.kind !== 'single' && <><Tones g={g} /><div className="[&>div]:justify-start"><ClaimLinks g={g} /></div></>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Shell ---------- */

export function GroupedFeed(p: GroupedFeedProps) {
  const [limit, setLimit] = useState(PAGE);
  const shown = useMemo(() => {
    const base = p.groups.slice(0, limit);
    // never hide the group holding the selected article behind pagination
    const sel = p.open ? p.groups.findIndex((g, i) => i >= limit && g.articles.some((a) => a.id === p.open)) : -1;
    return sel >= 0 ? [...base, p.groups[sel]] : base;
  }, [p.groups, limit, p.open]);
  const clusters = p.groups.filter((g) => g.kind !== 'single').length;
  const remaining = p.groups.length - limit;
  const now = useNow(60_000);
  const View = p.layout === 'compare' ? Compare : p.layout === 'board' ? Board : Briefing;
  return (
    <div className="px-3 py-3 md:px-5 md:py-4" data-testid={`grouped-feed-${p.layout}`}>
      <div className="mb-3 rounded-xl border border-border/70 bg-card/70 px-3 py-2.5 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div role="radiogroup" aria-label="Grouped layout" className="inline-flex rounded-md border border-border bg-background p-0.5">
            {LAYOUTS.map((l) => (
              <button key={l.id} role="radio" aria-checked={p.layout === l.id} onClick={() => p.onLayout(l.id)}
                className={cn('rounded px-2.5 py-1 text-xs font-medium', p.layout === l.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')} data-testid={`button-layout-${l.id}`}>
                {l.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Rank
            <select value={p.order} onChange={(e) => p.onOrder(e.target.value as FeedGroupOrder)} className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground" data-testid="select-group-order">
              {ORDERS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <span className="font-mono text-[11px] text-muted-foreground" data-testid="text-group-summary">
            {plural(p.groups.reduce((n, g) => n + g.articles.length, 0), 'article')} · {plural(clusters, 'grouped development')} · {plural(p.groups.length - clusters, 'single article')}
          </span>
        </div>
      </div>
      <View groups={shown} p={p} now={now} />
      {remaining > 0 && (
        <div className="mt-4 flex justify-center">
          <button onClick={() => setLimit((l) => l + PAGE)} className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted" data-testid="button-groups-more">
            Show {Math.min(PAGE, remaining)} more groups ({remaining} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
