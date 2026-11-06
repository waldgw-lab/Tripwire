import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { entities, legacy, assertions, key, W, scoped } from "./entity-db";
import type { RecordData } from "./tripwire-store";
import type { CoverageRoleLink } from "@workspace/api-zod";

/** Read-only projection: expose original analyst context without asserting a
 * verified appointment or mutating the canonical entity registry. */
export async function coverageEntities(rows: (typeof entities.$inferSelect)[]) {
  if (!rows.length) return [];
  const originals = await db.select().from(legacy).where(scoped(legacy));
  const roles = await db.select({ role: assertions }).from(assertions)
    .innerJoin(entities, and(eq(entities.id, assertions.objectId), eq(entities.workspace, W), eq(entities.type, "position")))
    .where(and(scoped(assertions), eq(assertions.predicate, "occupies"),
      inArray(assertions.subjectId, rows.filter(row => row.type === "person").map(row => row.id))));
  return projectCoverageRows(rows, originals, roles.map(row => row.role));
}

export function projectCoverageRows(rows: (typeof entities.$inferSelect)[],
  originals: (typeof legacy.$inferSelect)[], roles: (typeof assertions.$inferSelect)[]) {
  const byEntity = new Map(originals.map(row => [row.entityId, row]));
  const holders = new Map(originals.flatMap(row => {
    const original = row.original as RecordData;
    return original.individual?.trim() ? [[key(W, "legacy-holder", row.watchId), row] as const] : [];
  }));
  return rows.map(row => {
    const originalRow = byEntity.get(row.id);
    const original = originalRow?.original as RecordData | undefined;
    const holder = holders.get(row.id);
    const roleLinks: CoverageRoleLink[] = roles.filter(role => role.subjectId === row.id && role.objectId).map(role => ({
      positionId: role.objectId!, source: "sourced-assertion" as const, assertionId: role.id,
      certainty: role.certainty, status: role.status, tenure: role.tenure,
      validFrom: role.validFrom?.toISOString() ?? null, validTo: role.validTo?.toISOString() ?? null,
    }));
    // Keep unverified legacy holder context distinct from source assertions.
    if (holder && !roleLinks.some(link => link.positionId === holder.entityId)) {
      roleLinks.push({ positionId: holder.entityId, source: "legacy-context",
        certainty: "unverified", status: "context-only",
        tenure: null, validFrom: null, validTo: null });
    }
    return { ...row, ...(original && originalRow ? { coverageContext: {
      watchId: originalRow.watchId, title: original.title, summary: original.summary,
      position: original.position, individual: original.individual, tier: original.tier,
      organization: original.organization,
    } } : {}), roleLinks };
  });
}
