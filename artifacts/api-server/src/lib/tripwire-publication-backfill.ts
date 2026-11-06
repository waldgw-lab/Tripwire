import { db, tripwireRecords } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { readContent } from "./tripwire-content-storage";
import { discoveryPublication } from "./tripwire-publication";
import type { RecordData } from "./tripwire-store";

export async function backfillDiscoveryDates() {
  const rows = await db.select().from(tripwireRecords).where(eq(tripwireRecords.kind, "article"));
  const rawCache = new Map<string, string>();
  for (const row of rows) {
    const data = row.data as RecordData;
    if (data.publishedAt || !(data.discoveryOnly || data.intakeMethod === "google-news")) continue;
    for (const capture of data.retainedContent ?? []) {
      if (capture.source !== "discovery:google-news") continue;
      let raw = capture.raw;
      if (raw === undefined && capture.bodyHash) {
        if (!rawCache.has(capture.bodyHash)) rawCache.set(capture.bodyHash, (await readContent(capture.bodyHash)).raw);
        raw = rawCache.get(capture.bodyHash);
      }
      const publication = discoveryPublication(raw ?? "", capture.sourceUrl ?? data.intakeUrl);
      if (!publication.publishedAt) continue;
      // Preserve concurrent flags, imports and all original content versions.
      await db.update(tripwireRecords).set({ data: { ...data, ...publication }, updatedAt: new Date() })
        .where(and(eq(tripwireRecords.id, row.id), sql`${tripwireRecords.data} = ${JSON.stringify(row.data)}::jsonb`));
      break;
    }
  }
}
