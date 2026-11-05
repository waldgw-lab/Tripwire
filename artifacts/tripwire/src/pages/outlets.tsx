import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { TrackedRecord } from '@workspace/api-client-react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Empty, ErrorState, PageHead, RowsSkeleton, SignInAction } from '@/components/bits';
import { ConfirmDelete, OutletEditor } from '@/components/editors';
import { byKind, fmtDate, toInput, useSave, useWorkspace } from '@/lib/workspace';

export default function OutletsPage() {
  const { isSignedIn } = useAuth();
  const { data, isLoading, isError, refetch } = useWorkspace();
  const save = useSave();
  const [editing, setEditing] = useState<TrackedRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TrackedRecord | null>(null);
  const outlets = useMemo(() => byKind(data?.records, 'outlet').sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9) || a.title.localeCompare(b.title)), [data]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of byKind(data?.records, 'article')) if (a.outlet) m.set(a.outlet, (m.get(a.outlet) ?? 0) + 1);
    return m;
  }, [data]);

  return (
    <div className="tw-rise">
      <PageHead title="Outlets" count={outlets.length}>
        {isSignedIn
          ? <button onClick={() => setCreating(true)} data-testid="button-add-outlet" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> Outlet</button>
          : <SignInAction />}
      </PageHead>
      {isLoading ? <RowsSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} /> : outlets.length === 0 ? <Empty title="No outlets configured" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2 font-normal md:px-8">Outlet</th>
                <th className="px-3 py-2 font-normal">Tier</th>
                <th className="px-3 py-2 font-normal">Feed</th>
                <th className="px-3 py-2 font-normal">Status</th>
                <th className="px-3 py-2 font-normal">Checked</th>
                <th className="px-3 py-2 text-right font-normal">Items</th>
                <th className="px-3 py-2 font-normal">On</th>
                <th className="w-20 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {outlets.map((o) => {
                const failed = o.feedStatus && /fail|error/i.test(o.feedStatus);
                return (
                  <tr key={o.id} className={cn('group hover:bg-card', o.enabled === false && 'text-muted-foreground')} data-testid={`row-outlet-${o.id}`}>
                    <td className="px-5 py-2.5 font-medium md:px-8">{o.url ? <a href={o.url} target="_blank" rel="noreferrer" className="hover:text-accent">{o.title}</a> : o.title}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{o.tier ?? '—'}</td>
                    <td className="max-w-[260px] truncate px-3 py-2.5 font-mono text-[11px] text-muted-foreground" title={o.feedUrl}>{o.feedUrl || '—'}</td>
                    <td className={cn('px-3 py-2.5 font-mono text-[11px]', failed ? 'text-destructive' : 'text-muted-foreground')}>{o.feedStatus || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">{fmtDate(o.lastChecked, true)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{counts.get(o.title) ?? 0}</td>
                    <td className="px-3 py-2.5">
                      <Switch checked={o.enabled !== false} disabled={!isSignedIn || save.isPending}
                        onCheckedChange={(v) => save.mutate({ data: { ...toInput(o), enabled: v } })} data-testid={`switch-outlet-${o.id}`} />
                    </td>
                    <td className="px-3 py-2.5">
                      {isSignedIn && (
                        <div className="flex justify-end opacity-100 md:opacity-0 md:group-hover:opacity-100">
                          <button onClick={() => setEditing(o)} className="p-1.5 text-muted-foreground hover:text-foreground" data-testid={`button-edit-outlet-${o.id}`}><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setDeleting(o)} className="p-1.5 text-muted-foreground hover:text-destructive" data-testid={`button-delete-outlet-${o.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <OutletEditor open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }} record={editing} />
      <ConfirmDelete target={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
