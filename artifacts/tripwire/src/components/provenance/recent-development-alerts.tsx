import { useMemo } from 'react';
import { Link } from 'wouter';
import type { TrackedRecord } from '@workspace/api-client-react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDate } from '@/lib/workspace';
import type { ClaimSummary } from '@/lib/claim-groups';
import { useNow } from '@/components/feed/development-overview';
import { recentDevelopmentAlerts } from '@/lib/recent-development-alerts';
import { TONE } from './provenance-panel';

const VISIBLE = 3;

function focusHref(categoryId: string, topicId: string) {
  const p = new URLSearchParams({ category: categoryId, topic: topicId, focus: `${categoryId}::${topicId}` });
  return `/claims?${p.toString()}`;
}

/** Recent noteworthy developments (last 12 hours) above the Claims filters.
 * Shows original source headlines only; signals are navigation aids, not confirmation. */
export function RecentDevelopmentAlerts({ articles, summaries, loading, error, onRetry, summariesLoading, summariesError }: {
  articles: TrackedRecord[]; summaries?: ClaimSummary[]; loading: boolean; error: boolean; onRetry: () => void;
  summariesLoading?: boolean; summariesError?: boolean;
}) {
  const now = useNow(60_000);
  const groups = useMemo(() => recentDevelopmentAlerts(articles, summaries ?? [], now), [articles, summaries, now]);

  if (loading) return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-2 md:px-8" data-testid="alerts-recent-loading">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Last 12 hours</span>
      <span className="inline-block h-2.5 w-40 animate-pulse rounded bg-muted" />
    </div>
  );
  if (error) return (
    <p className="flex items-center gap-2 border-b border-border px-5 py-2 text-[11px] text-muted-foreground md:px-8" data-testid="alerts-recent-error">
      <span className="font-mono text-[10px] uppercase tracking-wider">Last 12 hours</span> Recent developments could not be checked.
      <button className="underline" onClick={onRetry} data-testid="button-alerts-retry">Retry</button>
    </p>
  );
  if (!groups.length) return null;

  const row = (g: (typeof groups)[number]) => {
    const latest = [...g.articles].sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0))[0];
    const indicator = g.kind === 'development';
    const prominent = g.highestImpact === 'high' || g.highestImpact === 'critical';
    return (
      <li key={g.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-1.5" data-testid={`row-recent-alert-${g.id}`}>
        <time className="w-[118px] shrink-0 font-mono text-[10px] text-muted-foreground" dateTime={latest?.publishedAt}>{latest?.publishedAt ? fmtDate(latest.publishedAt, true) : ''}</time>
        <div className="min-w-0 flex-1">
          <Link href={`/feed?article=${encodeURIComponent(latest.id)}`} className="group inline-flex max-w-full items-start gap-1 text-[13px] leading-snug hover:underline" data-testid={`link-recent-alert-${latest.id}`}>
            <span className="line-clamp-2">{latest.title}</span><ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <span>{latest.outlet ?? 'Outlet unknown'}</span>
            {g.articles.length > 1 && <span>· {g.articles.length} articles · {g.outlets.length} outlet{g.outlets.length === 1 ? '' : 's'}</span>}
            {indicator && <span className={cn('rounded-sm px-1', TONE.slate)} title={g.basis}>Headline indicator: {g.title}</span>}
            {prominent && <span className={cn('rounded-sm px-1', TONE.clay)}>Prominence: {g.highestImpact}</span>}
            {g.claimLinks.map(l => (
              <Link key={`${l.categoryId}::${l.topicId}`} href={focusHref(l.categoryId, l.topicId)} className="underline underline-offset-2 hover:text-foreground" data-testid={`link-recent-focus-${l.categoryId}-${l.topicId}`}>Focus: {l.title}</Link>
            ))}
          </div>
        </div>
      </li>
    );
  };

  return (
    <section className="border-b border-border bg-card/60 px-5 py-2 md:px-8" aria-label="Recent developments, last 12 hours" data-testid="panel-recent-alerts">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-mono text-[10px] uppercase tracking-wider">Recent developments · Last 12 hours · {groups.length}</h2>
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">How these are selected</summary>
          <p className="max-w-2xl py-1">Articles published in the last 12 hours that match a feed headline indicator or carry high/critical prominence. Headlines are the original source wording. Repeated reporting is not independent confirmation.{(summariesLoading || summariesError) && ' Claim focus links appear once coverage summaries load.'}</p>
        </details>
      </div>
      <ul className="divide-y divide-border/60">{groups.slice(0, VISIBLE).map(row)}</ul>
      {groups.length > VISIBLE && <details data-testid="details-recent-alerts-more">
        <summary className="cursor-pointer py-1 text-[11px] text-muted-foreground">{groups.length - VISIBLE} more</summary>
        <ul className="max-h-[240px] divide-y divide-border/60 overflow-y-auto">{groups.slice(VISIBLE).map(row)}</ul>
      </details>}
    </section>
  );
}
