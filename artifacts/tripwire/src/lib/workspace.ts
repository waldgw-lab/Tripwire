import { useQueryClient } from '@tanstack/react-query';
import {
  getGetRetrievalReportQueryKey,
  getGetWorkspaceQueryKey,
  useEnqueueEnrichment,
  useCorrectArticleClassification,
  useRestoreArticle,
  useDeleteRecord,
  useFlagArticle,
  useGetWorkspace,
  useRefreshFeeds,
  useSaveRecord,
  type RecordInput,
  type TrackedRecord,
} from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

export function useWorkspace() {
  return useGetWorkspace({
    query: { queryKey: getGetWorkspaceQueryKey(), staleTime: 60_000, gcTime: 10 * 60_000, refetchInterval: (query) => (query.state.data?.records ?? []).some(r => ACTIVE_RETRIEVAL.has(r.retrieval?.status ?? '')) ? 15_000 : 60_000, refetchOnWindowFocus: true },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetRetrievalReportQueryKey() }),
    qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (/^\/api\/tripwire\/records\/[^/]+\/content$/.test(q.queryKey[0]) || q.queryKey[0] === '/api/tripwire/content-search' || q.queryKey[0].startsWith('/api/tripwire/feedback') || q.queryKey[0] === 'retained-content') }),
  ]);
}

export const ACTIVE_RETRIEVAL = new Set(['pending', 'queued', 'running', 'retrying', 'fetching']);

export function useEnrich() {
  const invalidate = useInvalidate();
  const { toast } = useToast();
  return useEnqueueEnrichment({
    mutation: {
      onSuccess: (r) => { invalidate(); toast({ title: r.queued ? `${r.queued} queued for retrieval` : 'Nothing new to queue' }); },
      onError: (e: unknown) => toast({ title: 'Queue failed', description: errText(e), variant: 'destructive' }),
    },
  });
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

export { formatDate as fmtDate } from './date-format';

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
export const WATCH_TYPES = ['position', 'organization', 'journalist', 'x-account', 'attribution', 'topic'] as const;

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

export const isFlagged = (r: Pick<RecordInput, 'flagged' | 'saved'>) => r.flagged ?? r.saved ?? false;

export function useFlag() {
  const invalidate = useInvalidate();
  const { toast } = useToast();
  return useFlagArticle({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (e: unknown) => toast({ title: 'Flag update failed', description: errText(e), variant: 'destructive' }),
    },
  });
}

export function useInvalidateWorkspace() { return useInvalidate(); }

export const newRequestId = () => crypto.randomUUID();
export const isConflict = (e: unknown) => !!e && typeof e === 'object' && 'status' in e && (e as { status: unknown }).status === 409;

export function useCorrect() {
  const invalidate = useInvalidate();
  return useCorrectArticleClassification({ mutation: { onSettled: () => invalidate() } });
}

export function useRestore() {
  const invalidate = useInvalidate();
  const { toast } = useToast();
  return useRestoreArticle({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: 'Article restored' }); },
      onError: (e: unknown) => { invalidate(); toast({ title: isConflict(e) ? 'Already restored or changed' : 'Restore failed', description: errText(e), variant: 'destructive' }); },
    },
  });
}

/** Invalidates workspace, claim coverage summaries, provenance and entity queries after claim changes. */
export function useInvalidateClaims() {
  const qc = useQueryClient();
  const ws = useInvalidate();
  return () => Promise.all([
    qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0].startsWith('/api/tripwire/provenance') || q.queryKey[0].startsWith('/api/tripwire/focus-groups') || /\/records\/[^/]+\/focus$/.test(q.queryKey[0]) || q.queryKey[0].startsWith('/api/tripwire/entit') || q.queryKey[0].startsWith('/api/tripwire/claims/processing')) }),
    ws(),
  ]);
}
