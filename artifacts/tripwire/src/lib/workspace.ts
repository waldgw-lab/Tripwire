import { useQueryClient } from '@tanstack/react-query';
import {
  getGetWorkspaceQueryKey,
  useDeleteRecord,
  useGetWorkspace,
  useRefreshFeeds,
  useSaveRecord,
  type RecordInput,
  type TrackedRecord,
} from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

export function useWorkspace() {
  return useGetWorkspace({
    query: { queryKey: getGetWorkspaceQueryKey(), staleTime: 60_000, gcTime: 10 * 60_000, refetchInterval: 60_000, refetchOnWindowFocus: true },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
}

export function useSave() {
  const invalidate = useInvalidate();
  const { toast } = useToast();
  return useSaveRecord({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (e: unknown) => toast({ title: 'Save failed', description: errText(e), variant: 'destructive' }),
    },
  });
}

export function useRemove() {
  const invalidate = useInvalidate();
  const { toast } = useToast();
  return useDeleteRecord({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (e: unknown) => toast({ title: 'Delete failed', description: errText(e), variant: 'destructive' }),
    },
  });
}

export function useRefresh() {
  const invalidate = useInvalidate();
  const { toast } = useToast();
  return useRefreshFeeds({
    mutation: {
      onSuccess: (r) => {
        invalidate();
        toast({
          title: `${r.added} new · ${r.checked} feeds checked`,
          description: r.failures.length ? `Failed: ${r.failures.join(', ')}` : undefined,
        });
      },
      onError: (e: unknown) => toast({ title: 'Refresh failed', description: errText(e), variant: 'destructive' }),
    },
  });
}

export function errText(e: unknown) {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Request failed';
}

export function toInput(r: TrackedRecord): RecordInput {
  const { createdAt: _c, updatedAt: _u, ...rest } = r;
  void _c; void _u;
  return rest;
}

export const byKind = (records: TrackedRecord[] | undefined, kind: TrackedRecord['kind']) =>
  (records ?? []).filter((r) => r.kind === kind);

export function fmtDate(s?: string | null, withTime = false) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, withTime
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function toLocalInput(s?: string) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
export function fromLocalInput(s: string) {
  return s ? new Date(s).toISOString() : undefined;
}
export const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export const REPORTING = ['unassessed', 'original', 'independent', 'republication', 'commentary', 'official-response'] as const;
export const SENTIMENT = ['unassessed', 'negative', 'neutral', 'positive'] as const;
export const FOCUS = ['blame', 'performance', 'replacement', 'decision-making', 'institutional', 'other'] as const;
export const STAGES = ['origin', 'sourcing', 'addition', 'republication'] as const;
export const WATCH_TYPES = ['person', 'organization', 'x-account', 'attribution', 'topic'] as const;

export const reportingTone: Record<string, string> = {
  original: 'bg-accent text-accent-foreground',
  independent: 'bg-[hsl(0_0%_32%)] text-white',
  republication: 'bg-secondary text-secondary-foreground',
  commentary: 'bg-[hsl(0_0%_88%)] text-[hsl(0_0%_25%)]',
  'official-response': 'bg-primary text-primary-foreground',
  unassessed: 'border border-dashed border-input text-muted-foreground',
};
export const sentimentTone: Record<string, string> = {
  negative: 'text-[hsl(0_62%_42%)]',
  positive: 'text-[hsl(152_30%_32%)]',
  neutral: 'text-muted-foreground',
  unassessed: 'text-muted-foreground/60',
};
