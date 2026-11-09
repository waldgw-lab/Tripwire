import { db, pool, tripwireRecords } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { WORKSPACE_OWNER } from "./tripwire-access";
import { recordsFor, writeRecord, type RecordData } from "./tripwire-store";
import { articleLock } from "./tripwire-feedback";
import { X_ACCOUNTS, XApi, XFailure, nextXCursor, xAccess, xHandle, xMode, xProfileImage, xStatusId, type XCursor, type XPage } from "./tripwire-x-api";
import { XPublicPage } from "./tripwire-x-public";
import { X_REPORTERS, REPORTER_PORTRAITS, REPORTER_ALIASES } from "./tripwire-x-reporters";
import { logger } from "./logger";
import { captureContent, mergeCaptures } from "./tripwire-content";
import { storeContent } from "./tripwire-content-storage";
import { xControl as control, xControlId, xTrial, xInterval, trialState, trialView, reservePublicX, reserveX as reserve } from "./tripwire-x-budget";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Watch = XCursor & { id: string; outletId: string; outlet: string; handle: string; watchId?: string;
  name?: string; accountType?: "outlet" | "reporter"; profileImageUrl?: string;
  publicNewest?: string;
  enabled: boolean; removed?: boolean; userId?: string; status: string; lastChecked?: string; lastSuccess?: string; nextCheck?: string; message?: string };
const messages: Record<string, string> = {
  "setup-required": "Setup required: authorized X API access and approved daily usage limits.",
  ready: "Checks every 10 minutes while the server runs; no collection while it is stopped.",
  "rate-limited": "X rate limit reached; waiting before retrying.",
  "budget-limited": "Approved daily usage limit reached. Resumes after midnight UTC.",
  "access-denied": "X access was denied. Check API credentials and timeline permissions.",
  unavailable: "X is temporarily unavailable. The checkpoint is unchanged.",
  "invalid-response": "X returned an incomplete response. The checkpoint is unchanged.",
  "account-unavailable": "Account lookup is unavailable. No checkpoint was advanced.",
  "catch-up": "More pages remain; collection resumes at the next bounded check.",
  "catch-up-limited": "Catch-up limit reached. Operator review required; checkpoint retained.",
  "trial-ended": "Seven-day X trial ended. Collection is stopped; a new approval is required.",
  "trial-budget-limited": "X trial spending allowance reached, or insufficient headroom remains for the next bounded request. Collection is stopped.",
  "public-blocked": "X blocked this public page or requires a login. No bypass is attempted; collection will retry later.",
  "public-unreadable": "The public page has no readable timeline or its format changed. It is not treated as an empty feed.",
  sampled: "Limited public-page sample; posts may be omitted or out of order. This is not complete timeline coverage.",
};
async function put(tx: Tx, id: string, kind: string, data: object) {
  await tx.insert(tripwireRecords).values({ id, owner: WORKSPACE_OWNER, kind, data: { ...data }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: tripwireRecords.id, set: { data: { ...data }, updatedAt: new Date() } });
}
async function watches(tx: Tx | typeof db = db) {
  return (await tx.select().from(tripwireRecords).where(and(eq(tripwireRecords.owner, WORKSPACE_OWNER), eq(tripwireRecords.kind, "x-watch")))).map(r => r.data as Watch);
}
/** A seed marker per identity is also its tombstone: never resurrect removed watches. */
export async function seedXAccounts() {
  const records = await recordsFor(WORKSPACE_OWNER, false);
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tripwire:x:seed'))`);
    const seeds = [
      ...X_ACCOUNTS.map(([outlet, handle]) => ({ outlet, handle, name: outlet, accountType: "outlet" as const })),
      ...X_REPORTERS.map(([outlet, handle, name]) => ({ outlet, handle, name, accountType: "reporter" as const })),
    ];
    for (const { outlet: outletName, handle, name, accountType } of seeds) {
      const outlet = records.find(r => r.kind === "outlet" && r.title === outletName);
      if (!outlet) continue; // Never create or rename an outlet to satisfy a mapping.
      const id = `x:watch:${xHandle(handle)}`;
      const [existing] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, id));
      if (existing) {
        // Add display metadata to old seeds without overwriting tracking decisions,
        // tombstones, provider identity, health or pagination.
        if (existing.data.name === undefined || existing.data.accountType === undefined) {
          await tx.update(tripwireRecords).set({ data: { ...existing.data,
            name: existing.data.name ?? name, accountType: existing.data.accountType ?? accountType } })
            .where(and(eq(tripwireRecords.id, id), sql`${tripwireRecords.data} = ${JSON.stringify(existing.data)}::jsonb`));
        }
        continue;
      }
      // Include hidden shadows so deletion of an existing manual watch remains respected.
      const candidates = await tx.select().from(tripwireRecords).where(and(inArray(tripwireRecords.owner, ["public", WORKSPACE_OWNER]), eq(tripwireRecords.kind, "watch")));
      const matching = candidates.filter(r => r.data.watchType === "x-account" && [r.data.title, r.data.url].some(v => typeof v === "string" && xHandle(v) === xHandle(handle)));
      const match = matching.sort((a, b) => Number(b.owner === WORKSPACE_OWNER) - Number(a.owner === WORKSPACE_OWNER))[0];
      await put(tx, id, "x-watch", { id, outletId: outlet.id, outlet: outlet.title, handle, name, accountType,
        watchId: match ? String(match.data.baseId ?? match.id.replace(`${WORKSPACE_OWNER}:`, "")) : undefined,
        enabled: match?.data.enabled !== false, removed: match?.data.hidden === true, status: "not-checked" });
    }
  });
}
async function effective(w: Watch, tx: Tx | typeof db = db): Promise<Watch> {
  if (!w.watchId) return w;
  const rows = await tx.select().from(tripwireRecords).where(inArray(tripwireRecords.id, [w.watchId, `${WORKSPACE_OWNER}:${w.watchId}`]));
  const r = rows.find(r => r.owner === WORKSPACE_OWNER) ?? rows.find(r => r.owner === "public");
  return { ...w, removed: w.removed || !r || r.data.hidden === true, enabled: w.enabled && r?.data.enabled !== false };
}
export async function getXFeeds() {
  const publicPage = xMode() === "public-page";
  const access = xAccess(), c = await control(), trial = publicPage ? undefined : await xTrial();
  const status = trialState(trial) ?? (!access.ready ? "setup-required" : c.status && c.retryAt && Date.parse(c.retryAt) > Date.now() ? c.status : "ready");
  const accounts = await Promise.all((await watches()).map(w => effective(w)));
  return { status, mode: xMode(), message: status === "ready"
    ? `${publicPage ? "Public-page samples may omit posts. " : ""}Checks every ${xInterval(trial)} minutes while the server runs; no collection while it is stopped.`
    : publicPage && status === "budget-limited" ? "Daily public-page request/sample limit reached. Resumes after midnight UTC." : messages[status] ?? messages.unavailable!,
    intervalMinutes: xInterval(trial), trial: trial ? trialView(trial, status) : undefined,
    requestsUsed: c.requests, postsReserved: c.posts, requestLimit: access.requestLimit, postLimit: access.postLimit,
    accounts: accounts.filter(w => !w.removed).map(w => {
      const portrait = REPORTER_PORTRAITS[xHandle(w.handle) ?? ""];
      const providerPhoto = xProfileImage(w.profileImageUrl);
      return { id: w.id, handle: w.handle, name: w.name, accountType: w.accountType ?? "outlet",
      aliases: w.accountType === "reporter" ? REPORTER_ALIASES[xHandle(w.handle) ?? ""] ?? [] : [],
      profileImageUrl: providerPhoto ?? portrait?.url,
      profileImageSourceUrl: providerPhoto ? `https://x.com/${w.handle}` : portrait?.source,
      url: `https://x.com/${w.handle}`,
      outletId: w.outletId, outlet: w.outlet, enabled: (trial || publicPage) && w.accountType !== "reporter" ? false : w.enabled,
      status: (trial || publicPage) && w.accountType !== "reporter" ? publicPage ? "outside-scope" : "outside-trial" : !w.enabled ? "paused" : status !== "ready" ? status : w.status,
      lastChecked: w.lastChecked, lastSuccess: w.lastSuccess,
      nextCheck: c.retryAt && Date.parse(c.retryAt) > Date.parse(w.nextCheck ?? "1970-01-01") ? c.retryAt : w.nextCheck,
      message: status !== "ready" ? messages[status] : w.message }; }) };
}
export async function updateXWatch(id: string, enabled?: boolean) {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, id), eq(tripwireRecords.kind, "x-watch"), eq(tripwireRecords.owner, WORKSPACE_OWNER))).for("update");
    if (!row || row.data.removed) return false;
    const w = row.data as Watch;
    await put(tx, id, "x-watch", { ...w, ...(enabled === undefined ? { removed: true, enabled: false } : { enabled }) });
    if (w.watchId && enabled !== undefined) {
      // Keep reconciled legacy configuration in sync, including its hidden state.
      const rows = await tx.select().from(tripwireRecords).where(inArray(tripwireRecords.id, [w.watchId, `${WORKSPACE_OWNER}:${w.watchId}`]));
      const r = rows.find(r => r.owner === WORKSPACE_OWNER) ?? rows.find(r => r.owner === "public");
      if (r) await put(tx, `${WORKSPACE_OWNER}:${w.watchId}`, "watch", { ...r.data, baseId: w.watchId, enabled });
    }
    return true;
  });
}
async function persistPage(w: Watch, page: XPage, publicPage = false) {
  await db.transaction(async tx => {
    // Shares the manual-import lock; status identity matching and inserts are atomic.
    await articleLock(tx, WORKSPACE_OWNER);
    const [row] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, w.id)).for("update");
    if (!row) return;
    const current = await effective(row.data as Watch, tx);
    if (!current.enabled || current.removed) return;
    for (const t of page.data ?? []) {
      const existing = (await tx.select().from(tripwireRecords).where(and(inArray(tripwireRecords.owner, ["public", WORKSPACE_OWNER]), eq(tripwireRecords.kind, "article"))))
        .find(r => xStatusId(String(r.data.url ?? "")) === t.id);
      const users = page.includes?.users ?? [];
      const references = (t.referenced_tweets ?? []).map(ref => {
        const original = page.includes?.tweets?.find(t => t.id === ref.id);
        return { ...ref, authorId: original?.author_id, handle: users.find(u => u.id === original?.author_id)?.username, text: original?.note_tweet?.text ?? original?.text };
      });
      const text = t.note_tweet?.text ?? t.text;
      const xPost = { postId: t.id, authorId: t.author_id, handle: w.handle, watchId: w.id,
        accountName: w.name, accountType: w.accountType,
        textTruncated: t.text_truncated === true || (!t.note_tweet && /(?:…|\.{3})(?:\s+https:\/\/t\.co\/\S+)?\s*$/.test(text)),
        capturedAt: new Date().toISOString(), origin: publicPage ? "x-public-page" : "x-timeline", references };
      const capture = captureContent(text, publicPage ? "x:public-page" : "x:timeline", {
        sourceUrl: publicPage ? `https://x.com/${w.handle}` : `https://x.com/${w.handle}/status/${t.id}`,
        capturedAt: xPost.capturedAt, raw: JSON.stringify({ post: t, includes: page.includes,
          ...(publicPage ? { sampledFrom: `https://x.com/${w.handle}` } : {}) }) });
      if (existing) {
        // Enrich provenance only. Never overwrite manual text, edits or dismissals.
        // Attach to all shadows as well, but leave the original capture immutable.
        const baseId = String(existing.data.baseId ?? (existing.owner === WORKSPACE_OWNER ? existing.id.replace(`${WORKSPACE_OWNER}:`, "") : existing.id));
        const copies = await tx.select().from(tripwireRecords).where(inArray(tripwireRecords.id, [baseId, `${WORKSPACE_OWNER}:${baseId}`]));
        const bodyHash = await storeContent(text, capture.raw, tx);
        const { text: _text, raw: _raw, ...meta } = capture;
        const retained = { ...meta, bodyHash, textLength: text.length, rawLength: capture.raw!.length };
        for (const copy of copies) {
          const previous = copy.data.xPost as Partial<typeof xPost> | undefined;
          await tx.update(tripwireRecords).set({ data: { ...copy.data,
            xPost: previous ? { ...previous,
              accountName: previous.accountName ?? xPost.accountName,
              accountType: previous.accountType ?? xPost.accountType,
              textTruncated: previous.textTruncated ?? xPost.textTruncated } : xPost,
            retainedContent: mergeCaptures((copy.data as RecordData).retainedContent, [retained]) } }).where(eq(tripwireRecords.id, copy.id));
        }
        continue;
      }
      const data: RecordData = { id: `x-post-${t.id}`, kind: "article", sourceType: "x", title: text,
        url: `https://x.com/${w.handle}/status/${t.id}`, outlet: w.outlet, publishedAt: t.created_at,
        publicationSource: "publisher", publicationSourceUrl: `https://x.com/${w.handle}/status/${t.id}`,
        fullText: text, fullTextComplete: false, summary: text, journalists: [], credits: [],
        reportingType: "unassessed", sentiment: "unassessed",
        retainedContent: [capture] };
      await writeRecord(WORKSPACE_OWNER, data, false, false, false, tx);
      const id = `${WORKSPACE_OWNER}:${data.id}`;
      const [saved] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, id));
      await tx.update(tripwireRecords).set({ data: { ...saved!.data, xPost } }).where(eq(tripwireRecords.id, id));
    }
    const cursor: XCursor = publicPage ? {} : nextXCursor(current, page);
    const publicNewest = (page.data ?? []).reduce((max, t) => !max || BigInt(t.id) > BigInt(max) ? t.id : max, current.publicNewest);
    // Public samples never advance/clear the official API checkpoint. If access
    // changes later, missing posts are not silently skipped using a sample's ID.
    await put(tx, w.id, "x-watch", { ...current,
      ...(publicPage ? { publicNewest } : { since: undefined, token: undefined, newest: undefined, pages: undefined, ...cursor }),
      lastSuccess: new Date().toISOString(), status: cursor.token ? "catch-up" : page.data?.length ? "ok" : "empty",
      ...(publicPage ? { status: page.data?.length ? "sampled" : "sampled-empty" } : {}),
      message: publicPage ? messages.sampled : cursor.token ? messages["catch-up"] : !current.since ? "Initial sample: up to 20 recent posts; older posts were not requested." : undefined });
  });
}
const sharedXFailure = (failure: XFailure) =>
  ["rate-limited", "budget-limited", "access-denied", "setup-required", "trial-ended", "trial-budget-limited", "public-blocked"].includes(failure.status);
async function failWatch(w: Watch, failure: XFailure) {
  await db.transaction(async tx => {
    const [row] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, w.id)).for("update");
    if (row) await put(tx, w.id, "x-watch", { ...row.data, status: failure.status,
      message: messages[failure.status] ?? messages.unavailable,
      lastChecked: new Date().toISOString(), nextCheck: failure.retryAt ?? new Date(Date.now() + xInterval(await xTrial(tx)) * 60_000).toISOString() });
  });
}
export async function refreshXFeeds() {
  if (!xAccess().ready) return getXFeeds();
  const publicPage = xMode() === "public-page";
  const trial = publicPage ? undefined : await xTrial();
  if (trialState(trial)) return getXFeeds();
  // A session-scoped database lock survives async page commits but releases on connection loss/restart.
  const lock = await pool.connect();
  let acquired = false;
  try {
    acquired = (await lock.query("select pg_try_advisory_lock(hashtext('tripwire:x:collector')) as locked")).rows[0].locked;
    if (!acquired) return getXFeeds();
    const api = publicPage ? undefined : new XApi(process.env.X_API_BEARER_TOKEN!, reserve);
    const scraper = publicPage ? new XPublicPage(reservePublicX) : undefined;
    const list = await Promise.all((await watches()).map(w => effective(w)));
    const due = list.filter(w => w.enabled && !w.removed && (!(trial || publicPage) || w.accountType === "reporter") && (!w.nextCheck || Date.parse(w.nextCheck) <= Date.now()))
      .sort((a, b) => (a.lastChecked ?? "").localeCompare(b.lastChecked ?? "")).slice(0, 5);
    if (!due.length) return getXFeeds();
    try {
      const unresolved = publicPage ? [] : due.filter(w => !w.userId);
      if (unresolved.length) {
        let users: Awaited<ReturnType<XApi["users"]>> = [];
        let lookupFailure: XFailure | undefined;
        try { users = await api!.users(unresolved.map(w => w.handle)); }
        catch (error) {
          lookupFailure = error instanceof XFailure ? error : new XFailure("unavailable");
          if (sharedXFailure(lookupFailure)) throw lookupFailure;
        }
        for (const w of unresolved) {
          const u = users.find(u => xHandle(u.username) === xHandle(w.handle));
          if (!u) { await failWatch(w, lookupFailure ?? new XFailure("account-unavailable")); continue; }
          await db.transaction(async tx => {
            const [row] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, w.id)).for("update");
            if (row) await put(tx, w.id, "x-watch", { ...row.data, userId: u.id,
              profileImageUrl: xProfileImage(u.profile_image_url) ?? row.data.profileImageUrl });
          });
          w.userId = u.id;
        }
      }
      for (const w of due.filter(w => publicPage || w.userId)) {
        if (!publicPage && (w.pages ?? 0) >= 100) {
          await db.transaction(async tx => {
            const [row] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, w.id)).for("update");
            if (row) await put(tx, w.id, "x-watch", { ...row.data, status: "catch-up-limited", message: messages["catch-up-limited"], nextCheck: "9999-01-01T00:00:00Z" });
          });
          continue;
        }
        // Re-read effective settings immediately before each network request.
        const fresh = (await watches()).find(x => x.id === w.id);
        if (!fresh || !(await effective(fresh)).enabled || (await effective(fresh)).removed) continue;
        await db.transaction(async tx => {
          const [row] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, w.id)).for("update");
          if (row) await put(tx, w.id, "x-watch", { ...row.data, lastChecked: new Date().toISOString(), nextCheck: new Date(Date.now() + xInterval(trial) * 60_000).toISOString() });
        });
        try {
          if (scraper) {
            const result = await scraper.profile(w.handle);
            if (w.userId && result.user.id !== w.userId) throw new XFailure("account-unavailable");
            await db.transaction(async tx => {
              const [row] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, w.id)).for("update");
              if (row) await put(tx, w.id, "x-watch", { ...row.data, userId: result.user.id,
                profileImageUrl: xProfileImage(result.user.profile_image_url) ?? row.data.profileImageUrl });
            });
            await persistPage(w, result.page, true);
          } else await persistPage(w, await api!.timeline(w.userId!, w.since, w.token));
        }
        catch (error) {
          const failure = error instanceof XFailure ? error : new XFailure("unavailable");
          await failWatch(w, failure);
          if (sharedXFailure(failure)) throw failure;
        }
      }
    } catch (error) {
      const failure = error instanceof XFailure ? error : new XFailure("unavailable");
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tripwire:x:budget'))`);
        await put(tx, xControlId(), "x-control", { ...await control(tx), status: failure.status,
          retryAt: failure.retryAt ?? new Date(Date.now() + 600_000).toISOString() });
      });
      logger.warn({ status: failure.status }, "X collection deferred");
    }
  } finally {
    if (acquired) await lock.query("select pg_advisory_unlock(hashtext('tripwire:x:collector'))");
    lock.release();
  }
  return getXFeeds();
}
export function startXMonitoring() {
  const tick = () => void refreshXFeeds().catch(() => logger.error("X collector failed; collection will retry"));
  tick();
  setInterval(tick, 60_000).unref(); // Scheduled and manual checks share the durable configured interval.
}
