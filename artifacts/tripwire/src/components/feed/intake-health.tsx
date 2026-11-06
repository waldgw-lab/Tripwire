import { useRefresh, useWorkspace } from '@/lib/workspace';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export function IntakeHealth() {
  const workspace = useWorkspace();
  const refresh = useRefresh();
  const outlets = (workspace.data?.records ?? []).filter(r => r.kind === 'outlet' && r.enabled !== false)
    .sort((a, b) => a.title.localeCompare(b.title));
  return (
    <section className="tw-glass mt-6 overflow-hidden rounded-xl border border-border" data-testid="section-intake-health">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Feed intake</h2>
        <button onClick={() => refresh.mutate()} disabled={refresh.isPending} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs disabled:opacity-60">
          <RefreshCw className={cn('h-3 w-3', refresh.isPending && 'animate-spin')} /> Check feeds
        </button>
      </div>
      {workspace.isLoading && <p className="p-4 text-xs text-muted-foreground">Loading feeds…</p>}
      {workspace.isError && <button onClick={() => workspace.refetch()} className="p-4 text-xs underline">Retry loading feeds</button>}
      {outlets.map(outlet => (
        <details key={outlet.id} className="group border-b border-border/60 last:border-0" data-testid={`intake-${outlet.title}`}>
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-xs [&::-webkit-details-marker]:hidden">
            <span className="font-mono transition-transform group-open:rotate-90" aria-hidden="true">{'>'}</span>
            <span className="min-w-0 flex-1 font-medium uppercase tracking-wide">{outlet.title}</span>
            <span className={cn('text-right text-[11px]', outlet.feedStatus?.startsWith('Connected') ? 'text-muted-foreground' : 'text-amber-800')}>{outlet.feedStatus ?? 'Not checked'}</span>
          </summary>
          <div className="space-y-3 px-4 pb-4 pl-9">
            {(outlet.feedHealth ?? []).map(source => (
              <div key={source.url} className="text-[11px]">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono uppercase">{source.role} · {source.kind === 'google-news' ? 'Google News discovery' : source.kind}</span>
                  <span className={cn('font-mono', source.status === 'connected' ? 'text-green-800' : source.status === 'standby' ? 'text-muted-foreground' : 'text-amber-800')}>{source.status}</span>
                  <span className="text-muted-foreground">{source.message}</span>
                </div>
                <a href={source.url} target="_blank" rel="noreferrer" className="mt-0.5 block break-all font-mono text-[10px] text-muted-foreground underline underline-offset-2">{source.url}</a>
                {source.nextAttemptAt && <span className="mt-0.5 block text-muted-foreground">Retry {new Date(source.nextAttemptAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} ET</span>}
              </div>
            ))}
            {outlet.title === 'Reuters' && <p className="text-xs text-muted-foreground">No working publisher RSS verified. Paste or upload publisher content to enrich a discovered item.</p>}
          </div>
        </details>
      ))}
    </section>
  );
}
