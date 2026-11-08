import { db, tripwireRecords } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { RecordData } from "./tripwire-store";
import { archiveArticle } from "./tripwire-content-storage";
import { mergeArticleContent } from "./tripwire-content";
import { publicationUpdate } from "./tripwire-publication";
import { publisherIdentityUpdate } from "./tripwire-headlines";

export type FeedbackTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const CORRECTION_REASONS = ["Overrated", "Underrated", "Wrong topic", "Incidental mention", "Incorrect entity match", "Other"];
export const DELETION_REASONS = ["Duplicate item", "Irrelevant item", "Incorrect content", "Other"];
export class FeedbackError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function articleLock(tx: FeedbackTx, owner: string) {
  // All workspace article mutations share this lock, including first shadows.
  // Identity checks must run AFTER this lock and use this same transaction,
  // through the final article/draft write. Never borrow another pool connection.
  // Serializing the short writes also protects canonical-URL dismissal checks.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`articles:${owner}`}))`);
}
export async function currentArticle(tx: FeedbackTx, owner: string, id: string) {
  const rows = await tx.select().from(tripwireRecords).where(and(
    inArray(tripwireRecords.id, [id, `${owner}:${id}`]), inArray(tripwireRecords.owner, ["public", owner]), eq(tripwireRecords.kind, "article")));
  const shared = rows.find(r => r.owner === "public");
  const privateRow = rows.find(r => r.owner === owner);
  const row = privateRow ?? shared;
  if (!row) throw new FeedbackError(404, "Article not found");
  const own = row.data as RecordData;
  const base = shared?.data as RecordData | undefined;
  const data = { ...own, ...mergeArticleContent(own, base ?? {}, { background: true }),
    ...publisherIdentityUpdate(own, base),
    ...publicationUpdate(own, base ?? {}), id, kind: "article" as const };
  return { data, hidden: row.data.hidden === true, createdAt: (shared ?? row).createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
export function classificationSnapshot(data: RecordData, field: "impact" | "topic") {
  return { raw: data[field], effective: data[field] ?? data.automaticAssessment?.[field] ?? (field === "impact" ? "low" : "Unclassified"),
    mode: data[`${field}Mode`] ?? (field === "impact" && data.impact ? "manual" : "auto"),
    origin: data[`${field}Mode`] === "auto" || field === "impact" && !data.impact ? "automatic" : data[`${field}OverrideOrigin`] ?? "legacy-unknown",
    automatic: data.automaticAssessment };
}
export function feedbackSnapshot(data: RecordData) {
  const { fullText: _body, classificationReason: _reason, classificationNotes: _notes, expectedClassificationRevision: _revision, ...snapshot } = data;
  return { ...snapshot, retainedContent: snapshot.retainedContent?.map(({ text: _text, raw: _raw, ...capture }) => capture) };
}
export async function appendFeedback(tx: FeedbackTx, owner: string, articleId: string, data: RecordData,
  event: { action: string; reason: string; notes?: string; field?: string; before?: unknown; after?: unknown; duplicateOf?: string; requestId: string; actor?: string }) {
  const id = `feedback:${owner}:${articleId}:${event.requestId}`;
  const timestamp = new Date().toISOString();
  await tx.insert(tripwireRecords).values({ id, owner, kind: "feedback", data: {
    id, articleId, headline: data.title, outlet: data.outlet, publishedAt: data.publishedAt,
    timestamp, actor: event.actor ?? "Workspace analyst", ...event, snapshot: feedbackSnapshot(data),
  } }).onConflictDoNothing();
}
function validateReason(reason: string, notes: string | undefined, choices: string[]) {
  if (!choices.includes(reason) || reason === "Other" && !notes?.trim()) throw new FeedbackError(400, "Choose a reason; Other requires a note.");
}
export async function saveArticleState(tx: FeedbackTx, owner: string, id: string, data: RecordData, hidden: boolean) {
  const now = new Date();
  const archived = await archiveArticle(data, tx);
  await tx.insert(tripwireRecords).values({ id: `${owner}:${id}`, owner, kind: "article", data: { ...archived, baseId: id, hidden }, updatedAt: now })
    .onConflictDoUpdate({ target: tripwireRecords.id, set: { data: { ...archived, baseId: id, hidden }, updatedAt: now } });
  return { ...archived, id, updatedAt: now.toISOString() };
}
export async function correctArticle(owner: string, id: string, input: {
  field: "impact" | "topic"; mode: "auto" | "manual"; value?: string; reason: string; notes?: string; requestId: string; expectedRevision: number;
}) {
  validateReason(input.reason, input.notes, CORRECTION_REASONS);
  if (input.mode === "manual" && (!input.value?.trim() || input.field === "impact" && !["critical", "high", "low"].includes(input.value))) {
    throw new FeedbackError(400, "Select a valid classification value.");
  }
  return db.transaction(async tx => {
    await articleLock(tx, owner);
    const current = await currentArticle(tx, owner, id);
    if (current.hidden) throw new FeedbackError(409, "Restore this article before correcting it.");
    const [retry] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, `feedback:${owner}:${id}:${input.requestId}`));
    if (retry) {
      if (retry.data.action !== "correction" || retry.data.field !== input.field || retry.data.mode !== input.mode ||
        retry.data.value !== input.value || retry.data.reason !== input.reason || retry.data.notes !== input.notes) {
        throw new FeedbackError(409, "This request identifier was used for a different decision. Review and decide again.");
      }
      return { ...current.data, createdAt: current.createdAt, updatedAt: current.updatedAt };
    }
    if ((current.data.classificationRevision ?? 0) !== input.expectedRevision) throw new FeedbackError(409, "Classifications changed. Refresh and make a new decision.");
    const before = classificationSnapshot(current.data, input.field);
    const assessed = await archiveArticle(current.data, tx);
    const value = input.mode === "auto" ? assessed.automaticAssessment![input.field] : input.value!.trim();
    if (before.mode === input.mode && before.raw === value) return { ...current.data, createdAt: current.createdAt, updatedAt: current.updatedAt };
    const next = { ...assessed, [input.field]: value, [`${input.field}Mode`]: input.mode,
      [`${input.field}OverrideOrigin`]: input.mode === "manual" ? "analyst" : undefined, classificationRevision: (current.data.classificationRevision ?? 0) + 1 };
    const saved = await saveArticleState(tx, owner, id, next, false);
    await appendFeedback(tx, owner, id, current.data, { ...input, action: "correction", before, after: classificationSnapshot(saved, input.field) });
    return { ...saved, createdAt: current.createdAt };
  });
}
export async function dismissArticle(owner: string, id: string, input: { reason: string; notes?: string; duplicateOf?: string; requestId: string }) {
  validateReason(input.reason, input.notes, DELETION_REASONS);
  return db.transaction(async tx => {
    await articleLock(tx, owner);
    const current = await currentArticle(tx, owner, id);
    const [retry] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, `feedback:${owner}:${id}:${input.requestId}`));
    if (retry) return;
    if (current.hidden) return;
    if (input.duplicateOf) {
      if (input.reason !== "Duplicate item" || input.duplicateOf === id) throw new FeedbackError(400, "Duplicate link must reference another article.");
      await currentArticle(tx, owner, input.duplicateOf);
    }
    await saveArticleState(tx, owner, id, current.data, true);
    await appendFeedback(tx, owner, id, current.data, { ...input, action: "deletion" });
  });
}
export async function restoreArticleState(owner: string, id: string) {
  return db.transaction(async tx => {
    await articleLock(tx, owner);
    const current = await currentArticle(tx, owner, id);
    if (!current.hidden) return { ...current.data, createdAt: current.createdAt, updatedAt: current.updatedAt };
    // Unknown legacy hides are retained honestly rather than inventing deletion history.
    const saved = await saveArticleState(tx, owner, id, current.data, false);
    await appendFeedback(tx, owner, id, current.data, { action: "restoration", reason: "Restored to active workspace", requestId: crypto.randomUUID() });
    return { ...saved, createdAt: current.createdAt };
  });
}
export function canonicalArticleUrl(raw?: string) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    url.hash = ""; url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href.replace(/\/(?=\?|$)/, "");
  } catch { return undefined; }
}
