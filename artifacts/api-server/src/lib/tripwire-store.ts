import { db, tripwireRecords } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";
import { outlets, people, organizations, attributions, topics, stableId } from "./tripwire-config";
import { SaveRecordBody } from "@workspace/api-zod";
import { scopeDefaults, unassignedPositions } from "./tripwire-scope";

export type RecordData = typeof SaveRecordBody._output;
export async function seedConfig() {
  const rows: RecordData[] = [
    ...outlets.map(([title, feedUrl]) => ({kind: "outlet" as const, title, feedUrl, enabled: true, feedStatus: feedUrl ? "Not checked" : "Manual intake"})),
    ...people.map(([title, tier, aliases]) => ({kind: "watch" as const, title, tier, ...scopeDefaults(title), aliases: aliases.split("|"), enabled: true})),
    ...organizations.map(([title, tier, aliases]) => ({kind: "watch" as const, title, tier, watchType: "organization" as const, ...scopeDefaults(title), aliases: aliases.split("|"), enabled: true})),
    ...unassignedPositions.map(([organization, position, summary, tier]) => ({kind: "watch" as const, title: position, organization, position, individual: "", summary, tier, watchType: "position" as const, enabled: true})),
    ...attributions.map(title => ({kind: "watch" as const, title, tier: 3, watchType: "attribution" as const, enabled: true})),
    ...topics.map(title => ({kind: "watch" as const, title, tier: 3, watchType: "topic" as const, enabled: true})),
  ];
  await db.insert(tripwireRecords).values(rows.map(data => ({
    id: stableId(`${data.kind}:${data.title}`), owner: "public", kind: data.kind, data,
  }))).onConflictDoNothing();
}

export async function recordsFor(userId?: string | null) {
  const rows = await db.select().from(tripwireRecords).where(inArray(tripwireRecords.owner, userId ? ["public", userId] : ["public"]));
  const privateIds = new Set(rows.filter(r => r.owner !== "public").map(r => String(r.data.baseId ?? r.id)));
  return rows.filter(r => (r.owner !== "public" || !privateIds.has(r.id)) && r.data.hidden !== true).map(r => ({
    ...(r.kind === "watch" ? scopeDefaults(String(r.data.title)) : {}), ...r.data,
    ...(r.kind === "watch" && r.data.watchType === "person" ? {watchType: "position", ...Object.fromEntries(Object.entries(scopeDefaults(String(r.data.title))).filter(([key]) => r.data[key] === undefined))} : {}),
    id: String(r.data.baseId ?? r.id), kind: r.kind, title: String(r.data.title),
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  })) as (RecordData & {id: string; createdAt: string; updatedAt: string})[];
}

export async function writeRecord(userId: string, data: RecordData) {
  const baseId = data.id ?? crypto.randomUUID();
  // Per-user shadow copies allow edits/bookmarks without mutating shared feed metadata.
  const id = `${userId}:${baseId}`;
  const now = new Date();
  const [row] = await db.insert(tripwireRecords).values({id, owner: userId, kind: data.kind, data: {...data, baseId}, updatedAt: now})
    .onConflictDoUpdate({target: tripwireRecords.id, set: {data: {...data, baseId}, kind: data.kind, updatedAt: now}}).returning();
  return {...data, id: baseId, createdAt: row!.createdAt.toISOString(), updatedAt: now.toISOString()};
}

export async function removeRecord(userId: string, id: string) {
  const privateId = `${userId}:${id}`;
  const [shared] = await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, id), eq(tripwireRecords.owner, "public")));
  if (shared) {
    const data = {...shared.data, baseId: id, hidden: true};
    await db.insert(tripwireRecords).values({id: privateId, owner: userId, kind: shared.kind, data})
      .onConflictDoUpdate({target: tripwireRecords.id, set: {data, updatedAt: new Date()}});
    return true;
  }
  const rows = await db.delete(tripwireRecords).where(and(eq(tripwireRecords.id, privateId), eq(tripwireRecords.owner, userId))).returning();
  return rows.length > 0;
}
