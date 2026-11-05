import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { TrackedRecord } from '@workspace/api-client-react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Empty, ErrorState, PageHead, RowsSkeleton, SignInAction } from '@/components/bits';
import { ConfirmDelete, WatchEditor } from '@/components/editors';
import { WATCH_TYPES, byKind, useWorkspace } from '@/lib/workspace';

const TIERS = [
  { n: 1, label: 'Tier 1' },
  { n: 2, label: 'Tier 2' },
  { n: 3, label: 'Tier 3' },
];

export default function WatchlistPage() {
  const { isSignedIn } = useAuth();
  const { data, isLoading, isError, refetch } = useWorkspace();
  const [type, setType] = useState<string>('all');
  const [editing, setEditing] = useState<TrackedRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TrackedRecord | null>(null);
  const items = useMemo(() => byKind(data?.records, 'watch'), [data]);
  const shown = items.filter((w) => type === 'all' || w.watchType === type);

  return (
    <div className="tw-rise">
      <PageHead title="Watchlist" count={items.length}>
        {isSignedIn
          ? <button onClick={() => setCreating(true)} data-testid="button-add-watch" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> Watch</button>
          : <SignInAction />}
      </PageHead>
      <div className="flex flex-wrap gap-1 border-b border-border px-5 py-2.5 md:px-8">
        {['all', ...WATCH_TYPES].map((t) => (
          <button key={t} onClick={() => setType(t)} data-testid={`filter-watch-${t}`}
            className={cn('h-7 rounded-md px-2.5 font-mono text-[11px] uppercase tracking-wider', type === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}>
            {t} <span className="opacity-60">{t === 'all' ? items.length : items.filter((w) => w.watchType === t).length}</span>
          </button>
        ))}
      </div>
      {isLoading ? <RowsSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} /> : items.length === 0 ? <Empty title="Watchlist is empty" /> : (
        <div className="grid gap-px bg-border lg:grid-cols-3">
          {TIERS.map(({ n, label }) => {
            const tier = shown.filter((w) => (w.tier ?? 3) === n).sort((a, b) => a.title.localeCompare(b.title));
            return (
              <section key={n} className="bg-background px-5 py-5 md:px-6">
                <h2 className="mb-3 flex items-baseline gap-2">
                  <span className={cn('font-serif text-xl', n === 1 && 'text-accent')}>{label}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{tier.length}</span>
                </h2>
                <ul className="space-y-1.5">
                  {tier.map((w) => (
                    <li key={w.id} className={cn('group rounded-md border border-border bg-card px-3 py-2', w.enabled === false && 'opacity-50')} data-testid={`card-watch-${w.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{w.title}</p>
                          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{w.watchType}</p>
                        </div>
                        {isSignedIn && (
                          <div className="flex opacity-100 md:opacity-0 md:group-hover:opacity-100">
                            <button onClick={() => setEditing(w)} className="p-1 text-muted-foreground hover:text-foreground" data-testid={`button-edit-watch-${w.id}`}><Pencil className="h-3.5 w-3.5" /></button>
                            <button onClick={() => setDeleting(w)} className="p-1 text-muted-foreground hover:text-destructive" data-testid={`button-delete-watch-${w.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        )}
                      </div>
                      {w.summary && <p className="mt-1 text-xs text-muted-foreground">{w.summary}</p>}
                      {(w.aliases ?? []).length > 0 && <p className="mt-1 font-mono text-[10px] text-muted-foreground">{w.aliases!.join(' · ')}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <WatchEditor open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }} record={editing} />
      <ConfirmDelete target={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
