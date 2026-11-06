import { useGetRetrievalReport } from '@workspace/api-client-react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState, PageHead } from '@/components/bits';
import { Importer } from '@/components/importer';
import { useEnrich } from '@/lib/workspace';
import { IntakeHealth } from '@/components/feed/intake-health';

const n = (v: number) => v.toLocaleString('en-US');

function RetrievalTable() {
  const { data, isLoading, isError, refetch, isFetching } = useGetRetrievalReport({ query: { refetchInterval: 15_000 } });
  const enrich = useEnrich();
  const outlets = [...(data?.outlets ?? [])].sort((a, b) => b.articles - a.articles);
  const total = outlets.reduce((t, o) => ({ articles: t.articles + o.articles, retrieved: t.retrieved + o.retrieved, blocked: t.blocked + o.blocked, failed: t.failed + o.failed, pending: t.pending + o.pending }), { articles: 0, retrieved: 0, blocked: 0, failed: 0, pending: 0 });
  return (
    <section className="tw-glass mt-6 rounded-xl border border-border" data-testid="section-retrieval">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Retrieval</h2>
          {data && <span className="font-mono text-[11px] text-muted-foreground" data-testid="text-retrieval-storage">{n(data.storage.blobs)} stored · {n(data.storage.characters)} chars</span>}
          {isFetching && !isLoading && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60" aria-label="Updating" />}
        </div>
        <button onClick={() => enrich.mutate({ data: {} })} disabled={enrich.isPending}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs hover:border-foreground disabled:opacity-60" data-testid="button-enrich-all">
          <RefreshCw className={cn('h-3 w-3', enrich.isPending && 'animate-spin')} /> Enrich available content
        </button>
      </div>
      {isLoading ? (
        <div className="space-y-2 p-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-5 animate-pulse rounded bg-muted" />)}</div>
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : outlets.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">No articles tracked yet.</p>
      ) : (
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full text-xs" data-testid="table-retrieval">
            <thead className="sticky top-0 bg-card/95 backdrop-blur">
              <tr className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 text-left font-normal">Outlet</th>
                {['Articles', 'Retrieved', 'Blocked', 'Failed', 'Pending', 'Chars'].map(h => <th key={h} className="px-2 py-2 text-right font-normal">{h}</th>)}
                <th className="hidden px-4 py-2 text-left font-normal md:table-cell">Last result</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {outlets.map(o => (
                <tr key={o.outlet} className="border-t border-border/60" data-testid={`row-retrieval-${o.outlet}`}>
                  <td className="max-w-[180px] truncate px-4 py-1.5 font-sans font-medium uppercase tracking-wide">{o.outlet}</td>
                  <td className="px-2 py-1.5 text-right">{n(o.articles)}</td>
                  <td className="px-2 py-1.5 text-right">{n(o.retrieved)}</td>
                  <td className={cn('px-2 py-1.5 text-right', o.blocked ? 'text-foreground' : 'text-muted-foreground')}>{n(o.blocked)}</td>
                  <td className={cn('px-2 py-1.5 text-right', o.failed ? 'text-destructive' : 'text-muted-foreground')}>{n(o.failed)}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">{n(o.pending)}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">{n(o.characters)}</td>
                  <td className="hidden max-w-[220px] truncate px-4 py-1.5 font-sans text-muted-foreground md:table-cell" title={o.lastResult}>{o.lastResult ?? ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="font-mono tabular-nums">
              <tr className="border-t border-border font-semibold">
                <td className="px-4 py-1.5 font-sans text-[10px] uppercase tracking-wider">Total</td>
                <td className="px-2 py-1.5 text-right">{n(total.articles)}</td>
                <td className="px-2 py-1.5 text-right">{n(total.retrieved)}</td>
                <td className="px-2 py-1.5 text-right">{n(total.blocked)}</td>
                <td className="px-2 py-1.5 text-right">{n(total.failed)}</td>
                <td className="px-2 py-1.5 text-right">{n(total.pending)}</td>
                <td className="px-2 py-1.5 text-right">{n(outlets.reduce((s, o) => s + o.characters, 0))}</td>
                <td className="hidden md:table-cell" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

export default function DashboardPage() {
  return (
    <div className="tw-rise">
      <PageHead title="Dashboard" />
      <div className="mx-auto w-full max-w-[1000px] px-5 py-6 md:px-8">
        <Importer />
        <IntakeHealth />
        <RetrievalTable />
      </div>
    </div>
  );
}
