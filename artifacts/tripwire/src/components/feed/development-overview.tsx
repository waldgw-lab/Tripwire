import { useEffect, useState } from 'react';
import type { TrackedRecord } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { developmentSnapshot } from '@/lib/feed-snapshot';
import { feedPublication } from '@/lib/feed-format';

/** Wall clock that ticks on a modest interval so publication windows stay honest. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

const STATUS: Record<ReturnType<typeof developmentSnapshot>['status'], string> = {
  current: 'Reporting in last 6h',
  recent: 'Reporting in last 24h',
  earlier: 'Earlier reporting',
  undated: 'Undated reporting',
  'future-dated': 'Future-dated only',
};

export function DevelopmentOverview({ id, articles, now, open, onOpen, variant = 'side' }: {
  id: string; articles: TrackedRecord[]; now: number; open: string | null;
  onOpen: (id: string) => void; variant?: 'side' | 'band';
}) {
  const s = developmentSnapshot(articles, now);
  const src = s.source;
  const pub = src?.publishedAt ? feedPublication(src.publishedAt) : null;
  const cells: [string, number, string][] = [
    ['6h', s.last6h, 'last6h'], ['6–24h', s.previous18h, 'previous18h'], ['Earlier', s.earlier, 'earlier'],
  ];
  if (s.undated) cells.push(['Undated', s.undated, 'undated']);
  if (s.future) cells.push(['Future', s.future, 'future']);
  const live = s.status === 'current' || s.status === 'recent';
  return (
    <aside className={cn('tw-overview rounded-lg border border-border/70 p-3', variant === 'band' && 'tw-overview-band')} aria-label="Development overview" data-testid={`overview-group-${id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={cn('font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em]', live ? 'text-foreground' : 'text-muted-foreground')} data-testid={`status-overview-${id}`}>
          {live && <span aria-hidden className="tw-overview-pulse mr-1.5 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-current" />}
          {STATUS[s.status]}
        </span>
        <span className="font-mono text-[10.5px] text-muted-foreground" data-testid={`text-overview-24h-${id}`}>{s.last24h} in 24h</span>
      </div>
      <dl className={cn('mt-2 grid gap-1.5', cells.length > 3 ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-3')}>
        {cells.map(([label, n, key]) => (
          <div key={key} className={cn('rounded-md border border-border/60 px-2 py-1.5', n > 0 ? 'bg-background/60' : 'opacity-55')} data-testid={`count-overview-${key}-${id}`}>
            <dt className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">{label}</dt>
            <dd className="font-display text-[22px] font-semibold leading-none tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      {src && s.excerpt && (
        <figure className="mt-3 border-l-2 border-foreground/25 pl-3">
          <figcaption className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Latest {s.excerptKind === 'summary' ? 'source summary' : 'source headline'}
          </figcaption>
          <blockquote className="text-[13.5px] leading-relaxed text-foreground/90" data-testid={`text-overview-excerpt-${id}`}>{s.excerpt}</blockquote>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] text-muted-foreground">
            <span className="font-semibold uppercase text-foreground/80">{src.sourceType === 'x' ? (src.outlet ?? 'X') : (src.outlet ?? 'Unknown outlet')}</span>
            <time dateTime={src.publishedAt ?? undefined}>{pub ? `${pub.date} ${pub.time}` : 'Undated'}</time>
            <button onClick={(e) => { e.stopPropagation(); onOpen(src.id); }} aria-expanded={open === src.id} aria-controls="article-reader"
              className="ml-auto rounded px-1.5 py-0.5 font-sans text-[11px] font-medium text-foreground underline-offset-2 hover:underline" data-testid={`button-overview-open-${id}`}>
              Open in reader
            </button>
          </div>
        </figure>
      )}
    </aside>
  );
}
