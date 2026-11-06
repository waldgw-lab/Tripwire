import { db, tripwireRecords } from "@workspace/db";
import { eq, inArray, and, sql } from "drizzle-orm";
import { outlets, people, organizations, attributions, topics, stableId, journalistRoster } from "./tripwire-config";
import { SaveRecordBody } from "@workspace/api-zod";
import { scopeDefaults, unassignedPositions } from "./tripwire-scope";
import { mergeArticleContent, type Capture } from "./tripwire-content";
import { archiveArticle, hydrateArticles } from "./tripwire-content-storage";
import { mergeClassification } from "./tripwire-classification";
import { publicationUpdate } from "./tripwire-publication";

export type RecordData = typeof SaveRecordBody._output;
export async function seedConfig() {
  const rows: RecordData[] = [
    ...outlets.map(([title, feedUrl]) => ({kind: "outlet" as const, title, feedUrl, enabled: true, feedStatus: feedUrl ? "Not checked" : "Manual intake"})),
    ...journalistRoster.flatMap(([outlet, names]) => names.map(title => ({kind: "watch" as const, watchType: "journalist" as const, title, outlet, enabled: true,
      aliases: title === "Alex Ward" ? ["Alexander Ward"] : [],
    }))),
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

export async function recordsFor(userId?: string | null, includeContent = true) {
  const rows = await db.select().from(tripwireRecords).where(inArray(tripwireRecords.owner, userId ? ["public", userId] : ["public"]));
  const privateIds = new Set(rows.filter(r => r.owner !== "public").map(r => String(r.data.baseId ?? r.id)));
  const publicRows = new Map(rows.filter(r => r.owner === "public").map(r => [r.id, r]));
  const records = rows.filter(r => ["article", "claim", "watch", "outlet"].includes(r.kind) && (r.owner !== "public" || !privateIds.has(r.id)) && r.data.hidden !== true).map(r => {
    const base = publicRows.get(String(r.data.baseId ?? r.id));
    const data = { ...r.data };
    if (r.kind === "outlet" && base && r.owner !== "public") {
      // User configuration is editable, but monitoring health belongs to the
      // shared collector and must not freeze when an outlet has a shadow copy.
      for (const key of ["feedStatus", "feedHealth", "lastChecked", "pageBackoffUntil", "pageLastResult"]) {
        if (base.data[key] !== undefined) data[key] = base.data[key];
      }
    }
    if (r.kind === "article") {
      if (base && r.owner !== "public") Object.assign(data, publicationUpdate(data, base.data));
      if (data.discoveryOnly && base?.data.discoveryOnly === false) {
        Object.assign(data, { discoveryOnly: false, url: base.data.url, intakeMethod: base.data.intakeMethod,
          intakeUrl: base.data.intakeUrl,
          byline: data.byline ?? base.data.byline, credits: data.credits ?? base.data.credits,
          journalists: (data.journalists as unknown[] | undefined)?.length ? data.journalists : base.data.journalists });
      }
      const content = mergeArticleContent((r.owner !== "public" ? data : base?.data ?? {}) as { fullText?: string; retainedContent?: Capture[]; fullTextComplete?: boolean },
        (r.owner !== "public" ? base?.data ?? {} : data) as { fullText?: string; retainedContent?: Capture[]; fullTextComplete?: boolean });
      Object.assign(data, content, { flagged: data.flagged ?? data.saved ?? false });
      // Raw publisher content and complete article bodies are never returned anonymously.
      if (!userId) { delete data.fullText; delete data.retainedContent; data.fullTextComplete = false; }
    }
    return ({
    ...(r.kind === "watch" ? scopeDefaults(String(r.data.title)) : {}),
    ...data,
    ...(r.kind === "watch" && r.data.watchType === "person" ? {watchType: "position", ...Object.fromEntries(Object.entries(scopeDefaults(String(r.data.title))).filter(([key]) => r.data[key] === undefined))} : {}),
    id: String(r.data.baseId ?? r.id), kind: r.kind, title: String(r.data.title),
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  }); }) as (RecordData & {id: string; createdAt: string; updatedAt: string})[];
  return includeContent ? hydrateArticles(records) : records;
}

export async function writeRecord(userId: string, data: RecordData, protectMetadata = false) {
  const baseId = data.id ?? crypto.randomUUID();
  // Per-user shadow copies allow edits/bookmarks without mutating shared feed metadata.
  const id = `${userId}:${baseId}`;
  return db.transaction(async tx => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${id}))`);
  if (data.kind === "article") {
    const [existing] = await tx.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, id), eq(tripwireRecords.owner, userId)));
    if (existing) {
      if (protectMetadata) {
        const current = existing.data as RecordData;
        const incoming = data;
        data = { ...incoming, ...current, ...mergeArticleContent(current, incoming), ...mergeClassification(current, incoming), retrieval: incoming.retrieval,
          ...(current.byline || !incoming.byline ? {} : { byline: incoming.byline, credits: incoming.credits, journalists: incoming.journalists }),
          ...publicationUpdate(current, incoming) };
      }
      const preserved = mergeArticleContent(existing.data as { fullText?: string; fullTextComplete?: boolean; retainedContent?: Capture[] }, data);
      // Editing metadata or flagging must not erase already retained source captures.
      data = { ...data, ...preserved, ...mergeClassification(existing.data, data) };
      if (!protectMetadata && existing.data.retrieval) data.retrieval = existing.data.retrieval as RecordData["retrieval"];
    }
  }
  data = await archiveArticle(data);
  const now = new Date();
  const [row] = await tx.insert(tripwireRecords).values({id, owner: userId, kind: data.kind, data: {...data, baseId}, updatedAt: now})
    .onConflictDoUpdate({target: tripwireRecords.id, set: {data: {...data, baseId}, kind: data.kind, updatedAt: now}}).returning();
  return {...data, id: baseId, createdAt: row!.createdAt.toISOString(), updatedAt: now.toISOString()};
  });
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
