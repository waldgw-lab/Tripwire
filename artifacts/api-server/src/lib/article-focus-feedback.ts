import { createHash } from "node:crypto";
import { db, tripwireContent, tripwireRecords } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { ArticleFocus, ArticleFocusInput } from "@workspace/api-zod";
import { articleFocus, automaticArticleFocus } from "./article-focus";
import { CLAIM_CATEGORIES } from "./claim-taxonomy";
import { articleLock, currentArticle, appendFeedback, FeedbackError } from "./tripwire-feedback";
import type { RecordData } from "./tripwire-store";
import { focusById, searchFocusGroups } from "./focus-catalog";

export async function focusState(owner: string, id: string) {
  const current = await db.transaction(tx => currentArticle(tx, owner, id));
  const article = { ...current.data };
  if (article.fullTextHash) {
    const [body] = await db.select({ lead: sql<string>`left(${tripwireContent.text},2400)` }).from(tripwireContent).where(eq(tripwireContent.hash, article.fullTextHash));
    Object.assign(article, { focusLead: body?.lead });
  }
  const base = articleFocus({ ...article, sharedFocus: undefined }, id);
  const effective = await focusById(owner, base.topicId) ?? base;
  const auto = automaticArticleFocus(article, id);
  const automatic = await focusById(owner, auto.topicId) ?? auto;
  return {
    effective, automatic,
    mode: article.focusOverride ? "manual" : "auto",
    revision: article.focusRevision ?? 0, groups: [],
  };
}

export function resolveFocus(input: ArticleFocusInput, groups: ArticleFocus[]) {
  if (input.mode === "auto") return null;
  const title = input.topicTitle?.trim();
  if (!title || !CLAIM_CATEGORIES.some(c => c.id === input.categoryId))
    throw new FeedbackError(400, "Choose a category and a nonblank focus label.");
  if (input.topicId) {
    const group = groups.find(g => g.topicId === input.topicId && g.categoryId === input.categoryId && g.topicTitle === title);
    if (!group) throw new FeedbackError(409, "That focus group changed. Refresh and choose again.");
    return { categoryId: group.categoryId, topicId: group.topicId, topicTitle: group.topicTitle };
  }
  const labelKey = (label: string) => label.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const match = groups.find(g => g.categoryId === input.categoryId && labelKey(g.topicTitle) === labelKey(title));
  return { categoryId: input.categoryId!, topicId: match?.topicId ??
    `analyst-${createHash("sha256").update(`${input.categoryId}:${labelKey(title)}`).digest("hex").slice(0, 32)}`,
    topicTitle: match?.topicTitle ?? title };
}

type FocusTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Caller holds the workspace lock; batch corrections must reuse this connection. */
export async function correctFocusLocked(tx: FocusTx, owner: string, id: string, input: ArticleFocusInput,
  resolved?: { value: ArticleFocus | null; reason: string }) {
    const current = await currentArticle(tx, owner, id);
    if (current.hidden) throw new FeedbackError(409, "Restore this article before correcting it.");
    const [retry] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, `feedback:${owner}:${id}:${input.requestId}`));
    const decision = JSON.stringify([input.mode, input.categoryId, input.topicId, input.topicTitle]);
    if (retry) {
      if (retry.data.field !== "focus" || retry.data.focusDecision !== decision)
        throw new FeedbackError(409, "This request identifier was used for a different decision.");
      return { ...current.data, createdAt: current.createdAt, updatedAt: current.updatedAt };
    }
    if ((current.data.focusRevision ?? 0) !== input.expectedRevision)
      throw new FeedbackError(409, "Article focus changed. Refresh and decide again.");
    const choices = resolved ? [] : input.topicId ? [await focusById(owner, input.topicId, tx)].filter((g): g is ArticleFocus => !!g) :
      (await searchFocusGroups(owner, input.topicTitle ?? "", 0, tx)).groups;
    const override = resolved ? resolved.value : resolveFocus(input, choices);
    if (JSON.stringify(current.data.focusOverride ?? null) === JSON.stringify(override))
      return { ...current.data, createdAt: current.createdAt, updatedAt: current.updatedAt };
    const data = { ...current.data, focusOverride: override, focusRevision: input.expectedRevision + 1 };
    // Metadata-only write: no extraction, source capture mutation or model calls.
    const now = new Date();
    await tx.insert(tripwireRecords).values({ id: `${owner}:${id}`, owner, kind: "article",
      data: { ...data, baseId: id }, updatedAt: now }).onConflictDoUpdate({
      target: tripwireRecords.id, set: { data: { ...data, baseId: id }, updatedAt: now },
    });
    const snapshot = (d: RecordData) => {
      const f = articleFocus(d, id);
      return { effective: `${f.topicTitle} (${f.categoryId})`, mode: d.focusOverride ? "manual" : "auto", origin: d.focusOverride ? "analyst" : "automatic" };
    };
    await appendFeedback(tx, owner, id, current.data, { action: "correction", field: "focus", reason: "Wrong topic",
      notes: resolved ? `${resolved.reason}\nApplied to explicitly selected articles only; shared group labels are unchanged.` :
        input.mode === "auto" ? "Returned this article to automatic placement." : "Changed this article only; shared group labels are unchanged.",
      focusDecision: decision, requestId: input.requestId, before: snapshot(current.data), after: snapshot(data) });
    return { ...data, createdAt: current.createdAt, updatedAt: now.toISOString() };
}

export async function correctFocus(owner: string, id: string, input: ArticleFocusInput) {
  return db.transaction(async tx => {
    await articleLock(tx, owner);
    return correctFocusLocked(tx, owner, id, input);
  });
}
