import { db, tripwireRecords } from "@workspace/db";
import { eq, inArray, and, sql } from "drizzle-orm";
import { outlets, people, organizations, attributions, topics, stableId, journalistRoster } from "./tripwire-config";
import { SaveRecordBody } from "@workspace/api-zod";
import { scopeDefaults, unassignedPositions } from "./tripwire-scope";
import { mergeArticleContent, type Capture } from "./tripwire-content";
import { archiveArticle, hydrateArticles } from "./tripwire-content-storage";
import { mergeClassification } from "./tripwire-classification";
import { publicationUpdate } from "./tripwire-publication";
import { articleLock, currentArticle, FeedbackError, canonicalArticleUrl, classificationSnapshot, appendFeedback, CORRECTION_REASONS } from "./tripwire-feedback";
import { mergeHeadlines, publisherIdentityUpdate } from "./tripwire-headlines";

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

export async function recordsFor(userId?: string | null, includeContent = true, database: Pick<typeof db, "select"> = db) {
  const rows = await database.select().from(tripwireRecords).where(inArray(tripwireRecords.owner, userId ? ["public", userId] : ["public"]));
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
      Object.assign(data, publisherIdentityUpdate(data as RecordData, base?.data as RecordData | undefined));
      const content = mergeArticleContent((r.owner !== "public" ? data : base?.data ?? {}) as { fullText?: string; retainedContent?: Capture[]; fullTextComplete?: boolean },
        (r.owner !== "public" ? base?.data ?? {} : data) as { fullText?: string; retainedContent?: Capture[]; fullTextComplete?: boolean }, { background: true });
      Object.assign(data, content, { flagged: data.flagged ?? data.saved ?? false });
      // Raw publisher content and complete article bodies are never returned anonymously.
      if (!userId) { delete data.fullText; delete data.retainedContent; data.fullTextComplete = false; }
    }
    return ({
    ...(r.kind === "watch" ? scopeDefaults(String(r.data.title)) : {}),
    ...data,
    ...(r.kind === "watch" && r.data.watchType === "person" ? {watchType: "position", ...Object.fromEntries(Object.entries(scopeDefaults(String(r.data.title))).filter(([key]) => r.data[key] === undefined))} : {}),
    id: String(r.data.baseId ?? r.id), kind: r.kind, title: String(r.data.title),
    createdAt: (r.kind === "article" ? base?.createdAt ?? r.createdAt : r.createdAt).toISOString(), updatedAt: r.updatedAt.toISOString(),
  }); }) as (RecordData & {id: string; createdAt: string; updatedAt: string})[];
  return includeContent ? hydrateArticles(records, database) : records;
}

type WriteTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function writeRecord(userId: string, data: RecordData, protectMetadata = false, analystEdit = false, trustedHeadlines = false, transaction?: WriteTransaction) {
  const baseId = data.id ?? crypto.randomUUID();
  // Per-user shadow copies allow edits/bookmarks without mutating shared feed metadata.
  const id = `${userId}:${baseId}`;
  const write = async (tx: WriteTransaction) => {
  await articleLock(tx, userId);
  const correctionEvents: { field: "impact" | "topic"; before: ReturnType<typeof classificationSnapshot> }[] = [];
  let original: RecordData | undefined;
  if (data.kind === "article") {
    const incomingHeadlines = trustedHeadlines ? data.verifiedHeadlines : undefined;
    const canonical = canonicalArticleUrl(data.url);
    const hiddenRows = await tx.select().from(tripwireRecords).where(and(eq(tripwireRecords.owner, userId), eq(tripwireRecords.kind, "article"), sql`${tripwireRecords.data}->>'hidden' = 'true'`));
    if (hiddenRows.some(row => row.id === id || canonical && canonicalArticleUrl(String(row.data.url ?? "")) === canonical)) {
      throw new FeedbackError(409, "This article is dismissed. Restore it from Dashboard feedback before updating it.");
    }
    try { original = (await currentArticle(tx, userId, baseId)).data; } catch (error) { if (!(error instanceof FeedbackError && error.status === 404)) throw error; }
    data = { ...data, verifiedHeadlines: mergeHeadlines(data, original?.verifiedHeadlines, incomingHeadlines) };
    if (original) {
      const incoming = data;
      data = { ...original, ...data, ...mergeArticleContent(original, data, { background: protectMetadata || analystEdit }), automaticAssessment: original.automaticAssessment, impact: original.impact, topic: original.topic,
        impactMode: original.impactMode, topicMode: original.topicMode, impactOverrideOrigin: original.impactOverrideOrigin,
        topicOverrideOrigin: original.topicOverrideOrigin, classificationRevision: original.classificationRevision };
      if (analystEdit) {
        for (const field of ["impact", "topic"] as const) {
          const before = classificationSnapshot(original, field);
          const mode = incoming[`${field}Mode`] ?? (field === "impact" && !incoming.impact ? "auto" : before.mode);
          const desired = mode === "auto" ? original.automaticAssessment?.[field] ?? incoming[field] : incoming[field];
          if (mode === "manual" && (!desired?.trim() || field === "impact" && !["critical", "high", "low"].includes(desired))) {
            throw new FeedbackError(400, "Select a valid classification value.");
          }
          if (desired === before.raw && mode === before.mode) continue;
          if (!incoming.classificationReason || !CORRECTION_REASONS.includes(incoming.classificationReason) || incoming.classificationReason === "Other" && !incoming.classificationNotes?.trim()) {
            throw new FeedbackError(400, "Classification changes require a reason; Other requires a note.");
          }
          if (incoming.expectedClassificationRevision !== (original.classificationRevision ?? 0)) throw new FeedbackError(409, "Classifications changed. Refresh and make a new decision.");
          Object.assign(data, { [field]: desired, [`${field}Mode`]: mode, [`${field}OverrideOrigin`]: mode === "manual" ? "analyst" : undefined });
          correctionEvents.push({ field, before });
        }
        if (correctionEvents.length) data.classificationRevision = (original.classificationRevision ?? 0) + 1;
      }
    } else {
      // Ignore client-supplied automatic suggestions and revisions.
      data = { ...data, automaticAssessment: undefined, classificationRevision: 0,
        impactMode: data.impact ? "manual" : "auto", topicMode: analystEdit && data.topic ? "manual" : "auto",
        impactOverrideOrigin: data.impact && analystEdit ? "analyst" : undefined,
        topicOverrideOrigin: data.topic && analystEdit ? "analyst" : undefined };
    }
    const [existing] = await tx.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, id), eq(tripwireRecords.owner, userId)));
    if (existing) {
      if (protectMetadata) {
        // Use the current shared projection, not the pre-promotion raw shadow.
        const current = original ?? existing.data as RecordData;
        const incoming = data;
        data = { ...incoming, ...current, ...mergeArticleContent(current, incoming, { background: true }), ...mergeClassification(current, incoming), retrieval: incoming.retrieval,
          ...(current.summary || !incoming.summary ? {} : { summary: incoming.summary }),
          ...(current.byline || !incoming.byline ? {} : { byline: incoming.byline, credits: incoming.credits, journalists: incoming.journalists }),
          ...publicationUpdate(current, incoming) };
      }
      const preserved = mergeArticleContent(existing.data as { fullText?: string; fullTextComplete?: boolean; retainedContent?: Capture[] }, data, { background: protectMetadata || analystEdit });
      // Editing metadata or flagging must not erase already retained source captures.
      data = { ...data, ...preserved, ...mergeClassification(existing.data, data) };
      if (!protectMetadata && existing.data.retrieval) data.retrieval = existing.data.retrieval as RecordData["retrieval"];
    }
    data.verifiedHeadlines = mergeHeadlines(data, original?.verifiedHeadlines, incomingHeadlines);
  }
  data = await archiveArticle(data, tx);
  for (const event of correctionEvents) {
    await appendFeedback(tx, userId, baseId, original!, { ...event, action: "correction", after: classificationSnapshot(data, event.field),
      reason: data.classificationReason!, notes: data.classificationNotes, requestId: `editor:${data.classificationRevision}:${event.field}` });
  }
  if (original?.automaticAssessment && JSON.stringify(original.automaticAssessment) !== JSON.stringify(data.automaticAssessment)) {
    await appendFeedback(tx, userId, baseId, original, { action: "system-correction", field: "impact",
      reason: "Retained content or automatic policy reassessment", actor: "System",
      before: classificationSnapshot(original, "impact"), after: classificationSnapshot(data, "impact"), requestId: crypto.randomUUID() });
    data.classificationRevision = Math.max(data.classificationRevision ?? 0, (original.classificationRevision ?? 0) + 1);
  }
  delete data.classificationReason; delete data.classificationNotes; delete data.expectedClassificationRevision;
  const now = new Date();
  const [row] = await tx.insert(tripwireRecords).values({id, owner: userId, kind: data.kind, data: {...data, baseId}, updatedAt: now})
    .onConflictDoUpdate({target: tripwireRecords.id, set: {data: {...data, baseId}, kind: data.kind, updatedAt: now}}).returning();
  return {...data, id: baseId, createdAt: row!.createdAt.toISOString(), updatedAt: now.toISOString()};
  };
  return transaction ? write(transaction) : db.transaction(write);
}

export async function removeRecord(userId: string, id: string) {
  const privateId = `${userId}:${id}`;
  const [shared] = await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, id), eq(tripwireRecords.owner, "public")));
  const [owned] = await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, privateId), eq(tripwireRecords.owner, userId)));
  if (shared?.kind === "article" || owned?.kind === "article") throw new FeedbackError(400, "Article deletion requires a reason.");
  if (shared) {
    const data = {...shared.data, baseId: id, hidden: true};
    await db.insert(tripwireRecords).values({id: privateId, owner: userId, kind: shared.kind, data})
      .onConflictDoUpdate({target: tripwireRecords.id, set: {data, updatedAt: new Date()}});
    return true;
  }
  const rows = await db.delete(tripwireRecords).where(and(eq(tripwireRecords.id, privateId), eq(tripwireRecords.owner, userId))).returning();
  return rows.length > 0;
}
