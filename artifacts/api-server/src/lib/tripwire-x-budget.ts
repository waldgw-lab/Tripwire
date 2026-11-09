import { db, tripwireRecords } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { XFailure, xAccess, xMode, type XSettlement } from "./tripwire-x-api";
import { WORKSPACE_OWNER } from "./tripwire-access";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Control = { day: string; requests: number; posts: number; postsReturned?: number; usersReturned?: number; status?: string; retryAt?: string };
type Trial = { budgetUnits: number; days: number; startedAt?: string; endsAt?: string;
  reservedUnits: number; observedUnits: number; postsReturned: number; usersReturned: number; requests: number; settled: number };
const CONTROL = "x:collector", TRIAL = "x:trial:reporters";
// Integer half-cents: one Post read = 1; one User read = 2. Do not rely on
// provider deduplication, free credits, or unconfirmed expansion discounts.
const dollars = (units: number) => units / 200;
async function put(tx: Tx, id: string, kind: string, data: object) {
  await tx.insert(tripwireRecords).values({ id, owner: WORKSPACE_OWNER, kind, data: { ...data } })
    .onConflictDoUpdate({ target: tripwireRecords.id, set: { data: { ...data }, updatedAt: new Date() } });
}
export async function xTrial(tx: Tx | typeof db = db): Promise<Trial | undefined> {
  const [row] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, TRIAL));
  return row?.data as Trial | undefined;
}
export function xInterval(trial?: Trial, env: NodeJS.ProcessEnv = process.env) {
  const n = Number(env.X_POLL_INTERVAL_MINUTES);
  const bounded = !!trial || xMode(env) === "public-page";
  const configured = Number.isInteger(n) && n >= 5 && n <= 1440 ? n : bounded ? 30 : 10;
  return bounded ? Math.max(30, configured) : configured;
}
export function trialState(trial?: Trial, now = Date.now()) {
  if (!trial) return undefined;
  if (trial.startedAt && (!trial.endsAt || !Number.isFinite(Date.parse(trial.endsAt)) || now >= Date.parse(trial.endsAt))) return "trial-ended";
  if (trial.reservedUnits >= trial.budgetUnits) return "trial-budget-limited";
  if (process.env.X_PROVIDER_LIMIT_CONFIRMED !== "true") return "setup-required";
  return undefined;
}
export function trialView(trial: Trial, status?: string) {
  return { days: trial.days, budgetUsd: dollars(trial.budgetUnits),
    phase: trialState(trial) === "trial-ended" ? "ended" : status === "trial-budget-limited" || trialState(trial) === "trial-budget-limited" ? "budget-limited" : trial.startedAt ? "active" : "prepared",
    startedAt: trial.startedAt, endsAt: trial.endsAt,
    providerLimitConfirmed: process.env.X_PROVIDER_LIMIT_CONFIRMED === "true",
    credentialsConfigured: !!process.env.X_API_BEARER_TOKEN,
    postsReturned: trial.postsReturned, usersReturned: trial.usersReturned,
    estimatedUsd: dollars(trial.observedUnits), reservedUsd: dollars(trial.reservedUnits),
    unreconciledRequests: trial.requests - trial.settled };
}
/** One-time preparation, not activation. Restarts never reset time/budget or
 * re-enable user pauses/removals. Outlet watches remain outside this trial. */
export async function prepareXTrial() {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tripwire:x:budget'))`);
    if (await xTrial(tx)) return;
    await put(tx, TRIAL, "x-trial", { budgetUnits: 5000, days: 7, reservedUnits: 0, observedUnits: 0,
      postsReturned: 0, usersReturned: 0, requests: 0, settled: 0 } satisfies Trial);
    await tx.execute(sql`update tripwire_records set data=jsonb_set(data,'{enabled}','false'::jsonb),updated_at=now()
      where owner=${WORKSPACE_OWNER} and kind='x-watch' and data->>'accountType'='outlet'`);
  });
}
export async function xControl(tx: Tx | typeof db = db): Promise<Control> {
  const [row] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, xControlId()));
  const c = row?.data as Control | undefined;
  const day = new Date().toISOString().slice(0, 10);
  return c?.day === day ? c : { day, requests: 0, posts: 0, postsReturned: 0, usersReturned: 0,
    ...(c?.status !== "budget-limited" ? { status: c?.status, retryAt: c?.retryAt } : {}) };
}
export const xControlId = () => xMode() === "public-page" ? "x:public:collector" : CONTROL;
/** Free public reads have separate durable request/sample caps, not paid API
 * reservations. They must never consume or start the unused API trial. */
export async function reservePublicX() {
  const day = new Date().toISOString().slice(0, 10);
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tripwire:x:budget'))`);
    const a = xAccess(), c = await xControl(tx);
    if (xMode() !== "public-page" || !a.ready) throw new XFailure("setup-required");
    if (c.retryAt && Date.parse(c.retryAt) > Date.now()) throw new XFailure(c.status ?? "unavailable", c.retryAt);
    if (c.requests + 1 > a.requestLimit! || c.posts + 20 > a.postLimit!) throw new XFailure("budget-limited",
      new Date(Date.parse(`${c.day}T00:00:00Z`) + 86_400_000).toISOString());
    await put(tx, xControlId(), "x-control", { ...c, requests: c.requests + 1, posts: c.posts + 20, status: undefined, retryAt: undefined });
  });
  let settled = false;
  return async (posts: number) => {
    if (settled || !Number.isInteger(posts) || posts < 0 || posts > 20) return;
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tripwire:x:budget'))`);
      const c = await xControl(tx);
      if (c.day === day) await put(tx, xControlId(), "x-control", { ...c, posts: c.posts - 20 + posts });
    });
    settled = true;
  };
}
export async function reserveX(posts: number, users = 0): Promise<XSettlement> {
  if (xMode() !== "api") throw new XFailure("setup-required"); // Public mode can never authorize a paid API request.
  const units = posts + users * 2;
  const day = new Date().toISOString().slice(0, 10);
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tripwire:x:budget'))`);
    const a = xAccess(), c = await xControl(tx), trial = await xTrial(tx);
    if (!a.ready) throw new XFailure("setup-required");
    const state = trialState(trial);
    if (state) throw new XFailure(state, trial?.endsAt);
    if (c.retryAt && Date.parse(c.retryAt) > Date.now()) throw new XFailure(c.status ?? "unavailable", c.retryAt);
    if (trial && trial.reservedUnits + units > trial.budgetUnits) throw new XFailure("trial-budget-limited", trial.endsAt);
    if (c.requests + 1 > a.requestLimit! || c.posts + posts > a.postLimit!) throw new XFailure("budget-limited",
      new Date(Date.parse(`${c.day}T00:00:00Z`) + 86_400_000).toISOString());
    if (trial) {
      const startedAt = trial.startedAt ?? new Date().toISOString();
      const endsAt = trial.endsAt ?? new Date(Date.parse(startedAt) + trial.days * 86_400_000).toISOString();
      await put(tx, TRIAL, "x-trial", { ...trial, startedAt, endsAt, requests: trial.requests + 1, reservedUnits: trial.reservedUnits + units });
    }
    await put(tx, CONTROL, "x-control", { ...c, requests: c.requests + 1, posts: c.posts + posts, status: undefined, retryAt: undefined });
  });
  let settled = false;
  return async (actualPosts, actualUsers) => {
    if (settled) return;
    if (!Number.isInteger(actualPosts) || !Number.isInteger(actualUsers) || actualPosts < 0 || actualUsers < 0 ||
        actualPosts > posts || actualUsers > users) return; // Uncertain response: retain full reservation.
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tripwire:x:budget'))`);
      const c = await xControl(tx), trial = await xTrial(tx);
      if (c.day === day) await put(tx, CONTROL, "x-control", { ...c, posts: c.posts - posts + actualPosts,
        postsReturned: (c.postsReturned ?? 0) + actualPosts, usersReturned: (c.usersReturned ?? 0) + actualUsers });
      if (trial) await put(tx, TRIAL, "x-trial", { ...trial,
        reservedUnits: trial.reservedUnits - units + actualPosts + actualUsers * 2,
        observedUnits: trial.observedUnits + actualPosts + actualUsers * 2,
        postsReturned: trial.postsReturned + actualPosts, usersReturned: trial.usersReturned + actualUsers, settled: trial.settled + 1 });
    });
    settled = true;
  };
}
