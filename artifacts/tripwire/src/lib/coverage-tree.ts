import { useQuery } from '@tanstack/react-query';
import { getListEntitiesQueryKey, listEntities, type CoverageRoleLink, type RegistryEntity } from '@workspace/api-client-react';
import { POLL_MS } from '@/lib/entities';

const PAGE = 100;
const MAX_PAGES = 200;

/** Loads every registry page; fails loudly on inconsistent paging instead of silently truncating. */
export async function fetchAllEntities(signal?: AbortSignal, load = listEntities): Promise<RegistryEntity[]> {
  const byId = new Map<string, RegistryEntity>();
  let offset = 0; let total = Infinity; let pages = 0;
  while (offset < total) {
    if (++pages > MAX_PAGES) throw new Error(`Registry paging exceeded ${MAX_PAGES} pages`);
    const page = await load({ offset, limit: PAGE }, { signal });
    total = page.total;
    for (const e of page.items) byId.set(e.id, e);
    if (!page.items.length) break;
    offset += page.items.length;
  }
  if (byId.size !== total) throw new Error(`Registry returned ${byId.size} of ${total} entities; records shifted during paging. Retry.`);
  return [...byId.values()];
}

export const ALL_ENTITIES_KEY = [...getListEntitiesQueryKey(), 'coverage-all'] as const;

export function useAllEntities() {
  const query = useQuery({ queryKey: ALL_ENTITIES_KEY, queryFn: ({ signal }) => fetchAllEntities(signal), refetchInterval: POLL_MS, placeholderData: p => p });
  // Track successful polls even when the data is unchanged: effective role
  // dates still need reevaluating as time passes.
  void query.dataUpdatedAt;
  return query;
}

const CURRENT_TENURE = new Set(['current', 'acting', 'interim', 'concurrent']);

export type LinkStanding = { verified: boolean; label: string; tone: 'legacy' | 'current' | 'caution' };

/** Only sourced, un-retracted, unexpired, current-tenure links count as verified current holders. */
export function linkStanding(l: CoverageRoleLink, today = new Date().toISOString()): LinkStanding {
  if (l.source === 'legacy-context') return { verified: false, label: 'Original named person · role unverified', tone: 'legacy' };
  const parts = [l.certainty, l.status, l.tenure, l.validFrom || l.validTo ? `${l.validFrom ?? '?'} to ${l.validTo ?? 'present'}` : null].filter(Boolean).join(' · ');
  const now = Date.parse(today);
  const end = l.validTo ? Date.parse(l.validTo) : undefined;
  const start = l.validFrom ? Date.parse(l.validFrom) : undefined;
  const expired = end !== undefined && end <= now;
  const ok = l.status === 'analyst-assessed' && l.certainty === 'confirmed'
    && start !== undefined && Number.isFinite(start) && start <= now
    && (end === undefined || Number.isFinite(end) && end > now)
    && CURRENT_TENURE.has(l.tenure ?? '');
  return ok ? { verified: true, label: `Sourced · ${parts}`, tone: 'current' } : { verified: false, label: `Sourced, not current holder · ${parts || 'unspecified'}${expired ? ' · expired' : ''}`, tone: 'caution' };
}

export type Node = { e: RegistryEntity; link?: CoverageRoleLink; children: Node[] };

export function haystack(e: RegistryEntity) {
  const c = e.coverageContext;
  return [e.name, ...e.aliases, ...(e.facets ?? []), e.rationale, c?.title, c?.summary, c?.position, c?.individual, c?.organization].filter(Boolean).join(' ').toLowerCase();
}

/** Builds org → (sub-org | position → person) with cycle and orphan safety. Every entity appears somewhere. */
export function buildCoverage(all: RegistryEntity[]) {
  const byId = new Map(all.map(e => [e.id, e]));
  const orgs = all.filter(e => e.type === 'organization');
  const positions = all.filter(e => e.type === 'position');
  const people = all.filter(e => e.type === 'person');
  const placed = new Set<string>();
  const peopleByPos = new Map<string, { e: RegistryEntity; link: CoverageRoleLink }[]>();
  for (const p of people) for (const l of p.roleLinks ?? []) {
    if (byId.get(l.positionId)?.type !== 'position') continue;
    const arr = peopleByPos.get(l.positionId) ?? []; arr.push({ e: p, link: l }); peopleByPos.set(l.positionId, arr); placed.add(p.id);
  }
  const parentOf = (e: RegistryEntity) => { const p = e.organizationId && byId.get(e.organizationId); return p && p.type === 'organization' && p.id !== e.id ? p.id : undefined; };
  const cyclic = (o: RegistryEntity) => { const seen = new Set([o.id]); let cur = parentOf(o); while (cur) { if (seen.has(cur)) return true; seen.add(cur); cur = parentOf(byId.get(cur)!); } return false; };
  const order = (a: Node, b: Node) => Number(b.e.pinned) - Number(a.e.pinned) || a.e.priority - b.e.priority || a.e.name.localeCompare(b.e.name);
  const posNode = (p: RegistryEntity): Node => ({ e: p, children: (peopleByPos.get(p.id) ?? []).map(x => ({ e: x.e, link: x.link, children: [] })).sort(order) });
  const orgNode = (o: RegistryEntity, path: Set<string>): Node => {
    const next = new Set(path).add(o.id);
    const subs = orgs.filter(c => parentOf(c) === o.id && !next.has(c.id) && !cyclic(c)).map(c => orgNode(c, next));
    const pos = positions.filter(p => parentOf(p) === o.id).map(posNode);
    const attached = all.filter(e => !['organization', 'position'].includes(e.type) &&
      parentOf(e) === o.id && !placed.has(e.id)).map(e => ({ e, children: [] })).sort(order);
    return { e: o, children: [...pos.sort(order), ...subs.sort(order), ...attached] };
  };
  const roots = orgs.filter(o => !parentOf(o) || cyclic(o)).map(o => orgNode(o, new Set())).sort(order);
  const loosePositions = positions.filter(p => !parentOf(p)).map(posNode).sort(order);
  const unplacedPeople = people.filter(p => !placed.has(p.id) && !parentOf(p)).map(e => ({ e, children: [] })).sort(order);
  const other = all.filter(e => !['organization', 'position', 'person'].includes(e.type) && !parentOf(e)).map(e => ({ e, children: [] })).sort(order);
  return { roots, loosePositions, unplacedPeople, other, byId };
}

/** Prunes to matches; ancestors of matches are kept for context, matched nodes keep their full subtree. */
export function filterTree(nodes: Node[], match: (e: RegistryEntity) => boolean): { nodes: Node[]; hits: Set<string> } {
  const hits = new Set<string>();
  const walk = (n: Node): Node | null => {
    if (match(n.e)) { hits.add(n.e.id); n.children.forEach(walk); return n; }
    const kids = n.children.map(walk).filter((x): x is Node => !!x);
    return kids.length ? { ...n, children: kids } : null;
  };
  return { nodes: nodes.map(walk).filter((x): x is Node => !!x), hits };
}
