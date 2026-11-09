import { createHash } from "node:crypto";
import { db, tripwireRecords } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { ArticleFocus, FocusGroupInput } from "@workspace/api-zod";
import { automaticArticleFocus, FOCUS_POLICY } from "./article-focus";
import { CLAIM_CATEGORIES } from "./claim-taxonomy";
import { articleLock, FeedbackError } from "./tripwire-feedback";

type Reader = Pick<typeof db, "execute" | "update">;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Populate only missing deterministic metadata, in bounded batches. Subsequent
 * searches never load retained bodies or transfer the archive to the client. */
export async function ensureFocusProjection(owner: string, database: Reader = db) {
  for (;;) {
    const { rows } = await database.execute<{ id: string; data: any; lead: string; stamp: string }>(sql`
      select r.id,r.data,r.updated_at::text stamp,left(c.text,2400) lead from tripwire_records r
      left join tripwire_content c on c.hash=r.data->>'fullTextHash'
      where r.kind='article' and r.owner in ('public',${owner})
      and coalesce(r.data->>'focusPolicy','')<>${FOCUS_POLICY} order by r.id limit 100`);
    if (!rows.length) return;
    for (const row of rows) {
      const auto = automaticArticleFocus({ ...row.data, focusLead: row.lead }, row.data.baseId || row.id);
      await database.update(tripwireRecords).set({ data: sql`${tripwireRecords.data} ||
        ${JSON.stringify({ automaticFocus: auto, focusPolicy: FOCUS_POLICY })}::jsonb` })
        .where(and(eq(tripwireRecords.id, row.id), sql`${tripwireRecords.updatedAt}::text=${row.stamp}`));
    }
  }
}

/** Resolve workspace shadows before hiding records; never resurrect a base. */
function selected(owner: string) {
  return sql`with selected as (
    select distinct on(coalesce(data->>'baseId',id)) id,data
    from tripwire_records where kind='article' and owner in ('public',${owner})
    order by coalesce(data->>'baseId',id),(owner=${owner}) desc),
    homes as (select coalesce(data->>'baseId',id) article_id,data,
      coalesce(nullif(data->'focusOverride','null'::jsonb),data->'automaticFocus') home
      from selected where coalesce(data->>'hidden','false')<>'true'),
    effective as (select h.*,coalesce(nullif(g.data->'override','null'::jsonb),h.home) focus from homes h
      left join tripwire_records g on g.id='focus-group:'||${owner}||':'||(h.home->>'topicId') and g.owner=${owner} and g.kind='focus-group')`;
}

export async function searchFocusGroups(owner: string, q = "", offset = 0, database: Reader = db) {
  await ensureFocusProjection(owner, database);
  const { rows } = await database.execute<{ focus: ArticleFocus }>(sql`${selected(owner)}
    select distinct focus from effective
    where strpos(lower(focus->>'topicTitle'),lower(${q.trim()}))>0
    order by focus limit 26 offset ${offset}`);
  return { groups: rows.slice(0, 25).map(r => r.focus), hasMore: rows.length > 25, offset };
}

export async function focusById(owner: string, topicId: string, database: Reader = db) {
  await ensureFocusProjection(owner, database);
  const { rows } = await database.execute<{ focus: ArticleFocus }>(sql`${selected(owner)}
    select focus from effective where home->>'topicId'=${topicId} order by article_id limit 1`);
  return rows[0]?.focus;
}

export async function groupDetail(owner: string, topicId: string, database: Reader = db, articleOffset = 0) {
  await ensureFocusProjection(owner, database);
  const { rows } = await database.execute<{ article_id: string; data: any; home: ArticleFocus; focus: ArticleFocus }>(sql`${selected(owner)}
    select * from effective where home->>'topicId'=${topicId} order by article_id`);
  if (!rows.length) throw new FeedbackError(404, "Focus group not found.");
  const groupId = `focus-group:${owner}:${topicId}`;
  const result = await database.execute<{ data: any }>(sql`select data from tripwire_records where id=${groupId} and owner=${owner}`);
  const group = result.rows[0]?.data;
  const history = (await database.execute<{ data: any }>(sql`select data from tripwire_records where owner=${owner}
    and kind='focus-group-event' and data->>'topicId'=${topicId} order by created_at desc,id desc limit 20`)).rows.map(r => r.data);
  const token = createHash("sha256").update(JSON.stringify([group?.revision ?? 0,
    rows.map(r => [r.article_id, r.data.focusRevision ?? 0, r.home])])).digest("hex");
  return { effective: rows[0].focus, automatic: rows[0].home, mode: group?.override ? "manual" as const : "auto" as const,
    token, count: rows.length, articles: rows.slice(articleOffset, articleOffset + 50).map(r => ({ id: r.article_id, title: String(r.data.title) })), history };
}

export async function groupArticlesPage(owner: string, topicId: string, offset = 0) {
  const d = await groupDetail(owner, topicId, db, offset);
  return { token: d.token, count: d.count, articles: d.articles, offset, hasMore: offset + d.articles.length < d.count };
}

export async function editGroup(owner: string, topicId: string, input: FocusGroupInput) {
  if (!input.confirmed) throw new FeedbackError(400, "Confirm the affected articles before saving.");
  if (input.reason.trim().length < 5) throw new FeedbackError(400, "Explain the shared-group correction.");
  if (input.mode === "manual" && (!input.topicTitle?.trim() || !CLAIM_CATEGORIES.some(c => c.id === input.categoryId)))
    throw new FeedbackError(400, "Choose a category and readable label.");
  return db.transaction(async (tx: Tx) => {
    await articleLock(tx, owner);
    const eventId = `focus-group-event:${owner}:${input.requestId}`;
    const [retry] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, eventId));
    const decision = JSON.stringify([topicId, input.mode, input.categoryId, input.topicTitle?.trim(), input.reason]);
    if (retry) {
      if (retry.data.decision !== decision) throw new FeedbackError(409, "Request identifier already used for another group correction.");
      return groupDetail(owner, topicId, tx);
    }
    const before = await groupDetail(owner, topicId, tx);
    if (before.token !== input.expectedToken) throw new FeedbackError(409, "Group membership or labels changed. Refresh the preview and confirm again.");
    const override = input.mode === "manual" ? { categoryId: input.categoryId!, topicId, topicTitle: input.topicTitle!.trim() } : null;
    const id = `focus-group:${owner}:${topicId}`;
    const [prior] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, id));
    await tx.insert(tripwireRecords).values({ id, owner, kind: "focus-group", data: { kind: "focus-group", topicId, override, revision: Number(prior?.data.revision ?? 0) + 1 } })
      .onConflictDoUpdate({ target: tripwireRecords.id, set: { data: { kind: "focus-group", topicId, override, revision: Number(prior?.data.revision ?? 0) + 1 }, updatedAt: new Date() } });
    await tx.insert(tripwireRecords).values({ id: eventId, owner, kind: "focus-group-event", data: {
      id: eventId, topicId, timestamp: new Date().toISOString(), reason: input.reason.trim(), mode: input.mode, decision,
      before: before.effective, after: override ?? before.automatic,
    } });
    return groupDetail(owner, topicId, tx);
  });
}
