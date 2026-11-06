import { useQueryClient } from '@tanstack/react-query';
import {
  getGetEntityAutomationQueryKey,
  getHealthCheckQueryKey,
  getListDevelopmentsQueryKey,
  getListEntitiesQueryKey,
  getListEntityCapturesQueryKey,
} from '@workspace/api-client-react';

export const POLL_MS = 20_000;
export const ENTITY_STATES = ['Discovered', 'Active', 'Watch', 'Archived'] as const;
export const ENTITY_TYPES = ['person', 'position', 'organization', 'company', 'capability', 'issue', 'event'] as const;
export const CLASSIFICATIONS = ['structural', 'strategic', 'contextual'] as const;
export const DISPOSITIONS = ['Immediate', 'Review', 'Collection'] as const;
/** Five factor dimensions recorded with every decision. */
export const DIMENSIONS = ['authority', 'relationship', 'involvement', 'significance', 'continuing'] as const;

export function errorText(e: unknown): string {
  if (!e) return '';
  const data = (e as { data?: unknown }).data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const m = d.error ?? d.message ?? d.detail;
    if (typeof m === 'string') return m;
  }
  return e instanceof Error ? e.message : 'Request failed';
}

/** Invalidate every list/detail/developments/health query an entity decision can touch. */
export function useInvalidateEntities() {
  const qc = useQueryClient();
  return (entityId?: string) => Promise.all([
    qc.invalidateQueries({ queryKey: getListEntitiesQueryKey() }),
    qc.invalidateQueries({ queryKey: getListDevelopmentsQueryKey() }),
    qc.invalidateQueries({ queryKey: getListEntityCapturesQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetEntityAutomationQueryKey() }),
    qc.invalidateQueries({ queryKey: getHealthCheckQueryKey() }),
    entityId ? qc.invalidateQueries({ queryKey: [`/api/tripwire/entities/${entityId}`] }) : qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('/api/tripwire/entities/') }),
  ]);
}

export const fmtWhen = (v?: string | null) => v ? new Date(v).toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
export const shortHash = (h?: string) => h ? h.slice(0, 12) : '—';
export const micros = (n?: number) => `$${((n ?? 0) / 1_000_000).toFixed(2)}`;
