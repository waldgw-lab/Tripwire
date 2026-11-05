import type { TrackedRecord } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { contentStatus, type Impact } from '@/lib/article-signals';
import { feedByline, feedPublication, impactTextColor } from '@/lib/feed-format';
import { articleCredits } from '@/lib/media-coverage';

export function articleTags(a: TrackedRecord) {
  return [
    a.reportingType && a.reportingType !== 'unassessed' ? a.reportingType : null,
    a.sentiment && a.sentiment !== 'unassessed' ? a.sentiment : null,
    a.focus ?? null,
    a.topic ?? null,
  ].filter(Boolean) as string[];
}

export function ImpactWord({ value, reason, id }: { value: Impact; reason: string; id: string }) {
  return (
    <span title={reason} className={cn('font-mono text-[10.5px] font-semibold uppercase tracking-wider', impactTextColor[value])} data-testid={`status-impact-${id}`}>
      {value}
    </span>
  );
}

export function ContentDot({ article }: { article: TrackedRecord }) {
  const status = contentStatus(article);
  return <span role="img" aria-label={status.label} title={status.label} className={cn('inline-block h-2 w-2 shrink-0 rounded-full', status.color)} data-testid={`status-content-${article.id}`} />;
}

const Sep = () => <span aria-hidden className="text-muted-foreground/50">·</span>;

export function FeedMeta({ article: a, impact }: { article: TrackedRecord; impact: { value: Impact; reason: string } }) {
  const pub = feedPublication(a.publishedAt ?? undefined);
  const byline = feedByline(articleCredits(a));
  const outlet = a.sourceType === 'x' ? (a.outlet ?? 'X') : (a.outlet ?? '—');
  const tags = articleTags(a);
  return (
    <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
      <time dateTime={a.publishedAt ?? undefined} title={`${pub.label} ET`} className="font-mono text-[11px] text-neutral-600" data-testid={`text-published-${a.id}`}>{pub.date}</time>
      <Sep />
      <span className="font-mono text-[11px] text-neutral-600">{pub.time}</span>
      <Sep />
      <span className="font-semibold uppercase tracking-wide" data-testid={`text-outlet-${a.id}`}>{outlet}</span>
      {byline && <><Sep /><span className="text-neutral-600" title={a.byline} data-testid={`text-byline-${a.id}`}>{byline}</span></>}
      <Sep />
      <ImpactWord value={impact.value} reason={impact.reason} id={a.id} />
      {tags.length > 0 && <><Sep /><span className="font-mono text-[10.5px] text-neutral-600" data-testid={`text-tags-${a.id}`}>{tags.join(' · ')}</span></>}
      <Sep />
      <ContentDot article={a} />
    </div>
  );
}
