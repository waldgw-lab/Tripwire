import type { ReactNode } from 'react';
import type { TrackedRecord } from '@workspace/api-client-react';
import { ArticleHeading } from '@/components/article-heading';
import { Disclosure } from './provenance-panel';
import { FocusContext } from './focus-context';
import { fmtDate } from '@/lib/workspace';
import type { ClaimSummary } from '@/lib/claim-groups';
import { feedByline } from '@/lib/feed-format';
import { articleCredits } from '@/lib/media-coverage';

export function FocusOverview({ title, category, topic, articles, unattributed, totalArticles, complete, summaries, articleById, loading, error, onRetry, onClaim, stats, range }: {
  stats?: ReactNode; range?: ReactNode;
  title: string; category: string; topic: string;
  articles: { articleId: string; claims: TrackedRecord[] }[]; unattributed: TrackedRecord[];
  totalArticles: number; complete: boolean; summaries: Map<string, ClaimSummary>;
  articleById: Map<string, TrackedRecord>; loading: boolean; error: boolean; onRetry: () => void;
  onClaim: (claim: TrackedRecord, summary?: ClaimSummary) => void;
}) {
  const claimButton = (c: TrackedRecord, articleId: string) => <li key={c.id}>
    <button onClick={() => onClaim(c, summaries.get(c.id))} data-testid={`button-focus-claim-${articleId}-${c.id}`}
      className="w-full rounded-md px-2 py-2 text-left text-sm leading-snug hover:bg-muted focus-visible:outline-2">{c.title}</button>
  </li>;
  return <section className="min-w-0 px-5 py-6 md:max-h-[calc(100dvh-205px)] md:overflow-y-auto md:px-10" data-testid={`detail-focus-${topic}`}>
    <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{category} · Focus overview</p>
    <h2 className="font-serif text-2xl leading-tight">{title}</h2>
    {(stats || range) && <p className="mt-1 font-mono text-[10px] text-muted-foreground" data-testid="text-focus-header-counts">{stats}{stats && range ? ' · ' : ''}{range}</p>}
    <FocusContext summaries={[...summaries.values()]} />
    {loading ? <p className="mt-5 text-sm text-muted-foreground" aria-busy>Loading article coverage…</p>
      : error ? <p className="mt-5 text-sm text-muted-foreground">Article links could not be loaded. <button className="underline" onClick={onRetry} data-testid="button-focus-retry">Retry</button></p>
      : <>
        <p className="mt-4 text-sm font-medium" data-testid="text-focus-article-count">
          {articles.length === totalArticles ? `${articles.length}${complete ? '' : '+'} reporting article${articles.length === 1 ? '' : 's'}`
            : `${articles.length} of ${totalArticles} reporting articles match the current filters`}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground" data-testid="text-focus-scope">Shared focus, not one claim · counts are not independent confirmation.</p>
        <ol className="mt-4 space-y-3" data-testid="list-focus-coverage">
          {articles.map(({ articleId, claims }) => {
            const a = articleById.get(articleId);
            const byline = a ? feedByline(articleCredits(a)) : '';
            return <li key={articleId} className="tw-feed-item rounded-xl px-3 py-3.5 sm:px-4" data-testid={`card-focus-article-${articleId}`}>
              <ArticleHeading outlet={a?.outlet ?? 'Outlet unknown'} title={a?.title ?? `Article unavailable (${articleId})`}
                date={a?.publishedAt ? fmtDate(a.publishedAt, true) : 'Date unknown'}
                href={`/feed?article=${encodeURIComponent(articleId)}`} url={a?.url} sourceTestId={`link-focus-source-${articleId}`}>
                {!!byline && <><span aria-hidden>·</span><span className="font-sans">{byline}</span></>}
              </ArticleHeading>
              <Disclosure label="Claims in this article" count={claims.length} testId={`details-focus-article-${articleId}`} className="mt-3">
                <ul className="divide-y divide-border/60">{claims.map(c => claimButton(c, articleId))}</ul>
              </Disclosure>
            </li>;
          })}
        </ol>
        {unattributed.length > 0 && <Disclosure label={complete ? 'Claims without article attribution' : 'Claims with unavailable article links'} count={unattributed.length} testId="details-focus-unattributed" className="mt-4">
          <ul>{unattributed.map(c => claimButton(c, 'unattributed'))}</ul>
        </Disclosure>}
      </>}
  </section>;
}
