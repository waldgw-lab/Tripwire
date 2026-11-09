import { db, tripwireRecords } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { ArticleFocus, ArticleFocusInput, FocusGroupArticlesInput, FocusGroupArticlesResult } from "@workspace/api-zod";
import { articleFocus } from "./article-focus";
import { correctFocusLocked, resolveFocus } from "./article-focus-feedback";
import { groupDetail, focusById, searchFocusGroups } from "./focus-catalog";
import { articleLock, currentArticle, FeedbackError } from "./tripwire-feedback";

/** One transaction and one lock: never leave a partially corrected selection. */
export async function correctGroupArticles(owner: string, sourceTopic: string, input: FocusGroupArticlesInput): Promise<FocusGroupArticlesResult> {
  if (!input.articleIds.length || input.articleIds.length > 100 || new Set(input.articleIds).size !== input.articleIds.length)
    throw new FeedbackError(400, "Choose between 1 and 100 different articles.");
  if (input.reason.trim().length < 5) throw new FeedbackError(400, "Explain the selected-article correction.");
  return db.transaction(async tx => {
    await articleLock(tx, owner);
    const id = `focus-batch:${owner}:${input.requestId}`;
    const decision = JSON.stringify([sourceTopic, [...input.articleIds].sort(), input.mode, input.categoryId,
      input.topicId, input.topicTitle?.trim(), input.reason.trim(), input.expectedToken]);
    const [retry] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, id));
    if (retry) {
      if (retry.data.decision !== decision) throw new FeedbackError(409, "Request identifier already used for another selection.");
      return retry.data.result as FocusGroupArticlesResult;
    }
    const source = await groupDetail(owner, sourceTopic, tx);
    if (source.token !== input.expectedToken) throw new FeedbackError(409, "Group membership or article placement changed. Refresh the selection; nothing was saved.");
    const articles = [];
    for (const articleId of input.articleIds) {
      const current = await currentArticle(tx, owner, articleId);
      if (current.hidden || articleFocus({ ...current.data, sharedFocus: undefined }, articleId).topicId !== sourceTopic)
        throw new FeedbackError(409, "An article is no longer in this group. Refresh the selection; nothing was saved.");
      articles.push({ id: articleId, current });
    }
    const correction: ArticleFocusInput = { ...input, expectedRevision: 0 };
    const choices = input.mode === "auto" ? [] : input.topicId ?
      [await focusById(owner, input.topicId, tx)].filter((g): g is ArticleFocus => !!g) :
      (await searchFocusGroups(owner, input.topicTitle ?? "", 0, tx)).groups;
    const focus = resolveFocus(correction, choices);
    for (const article of articles) {
      await correctFocusLocked(tx, owner, article.id, {
        ...correction, expectedRevision: article.current.data.focusRevision ?? 0,
      }, { value: focus, reason: input.reason.trim() });
    }
    const result = { updated: articles.length, articleIds: articles.map(a => a.id), focus };
    await tx.insert(tripwireRecords).values({ id, owner, kind: "focus-batch-event", data: {
      sourceTopic, decision, result, reason: input.reason.trim(), timestamp: new Date().toISOString(),
    } });
    return result;
  });
}
