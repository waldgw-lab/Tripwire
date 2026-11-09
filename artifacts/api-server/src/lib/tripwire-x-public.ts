/** Public HTML only: no cookies, login, guest tokens, hidden API calls or proxies.
 * X currently embeds a small profile sample as JSON strings in streamed scripts.
 * Parse those strings as data, never execute JavaScript from a remote page.
 */
import { XFailure, xHandle, xProfileImage, type XPage, type XTweet, type XUser } from "./tripwire-x-api";

type Obj = Record<string, any>;
const numeric = (v: unknown): v is string => typeof v === "string" && /^\d{1,25}$/.test(v);
const LIMIT = 2_000_000;
const unwrap = (v: Obj | undefined): Obj | undefined => v?.tweet ?? v;
function person(v?: Obj): XUser | undefined {
  const username = v?.core?.screen_name ?? v?.legacy?.screen_name;
  if (!numeric(v?.rest_id) || typeof username !== "string" || !xHandle(username)) return;
  return { id: v!.rest_id, username, name: v?.core?.name ?? v?.legacy?.name,
    profile_image_url: xProfileImage(v?.avatar?.image_url ?? v?.legacy?.profile_image_url_https) };
}
function post(v: Obj, users: Map<string, XUser>, expanded: Map<string, XTweet>, depth = 0): XTweet {
  const author = person(v.core?.user_results?.result);
  const details = v.details ?? v.legacy;
  const stamp = details?.created_at_ms ?? details?.created_at;
  const ms = typeof stamp === "number" ? stamp : typeof stamp === "string" ? Date.parse(stamp) : NaN;
  if (!numeric(v.rest_id) || !author || !Number.isFinite(ms) || typeof details?.full_text !== "string" ||
      details.full_text.length > 100_000) throw new XFailure("invalid-response");
  users.set(author.id, author);
  const note = v.note_tweet?.note_tweet_results?.result?.text;
  const t: XTweet = { id: v.rest_id, author_id: author.id, text: details.full_text,
    created_at: new Date(ms).toISOString(),
    ...(typeof note === "string" && note.length <= 100_000 ? { note_tweet: { text: note } } : {}),
    text_truncated: v.legacy?.truncated === true || (!note && v.note_tweet?.is_expandable === true) };
  const refs: { id: string; type: string }[] = [];
  const reply = details.in_reply_to_status_id_str ?? details.in_reply_to_status_id ?? v.legacy?.in_reply_to_status_id_str;
  if (numeric(reply)) refs.push({ id: reply, type: "replied_to" });
  for (const [type, result, fallback] of [
    ["quoted", v.quoted_tweet_results ?? v.quoted_status_result, v.legacy?.quoted_status_id_str],
    ["retweeted", v.retweeted_status_result ?? v.legacy?.retweeted_status_result, undefined],
  ] as const) {
    const original = unwrap(result?.result);
    const id = original?.rest_id ?? result?.rest_id ?? fallback;
    if (!numeric(id)) continue;
    refs.push({ id, type });
    if (original && depth < 2) {
      try {
        const nested = post(original, users, expanded, depth + 1);
        expanded.set(nested.id, nested);
      } catch { /* Unavailable quoted text stays a relationship, never fabricated. */ }
    }
  }
  if (refs.length) t.referenced_tweets = refs;
  return t;
}
export function parsePublicX(html: string, handle: string): { user: XUser; page: XPage } {
  const expected = xHandle(handle);
  if (!expected || Buffer.byteLength(html) > LIMIT) throw new XFailure("invalid-response");
  let user: XUser | undefined, timeline: Obj | undefined;
  // Only decode literal JSON strings. No eval, VM, script execution or fetching
  // the site's private GraphQL endpoints to continue its cursor.
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const match of script[1]!.matchAll(/\bvalue:("(?:[^"\\]|\\.)*")/g)) {
      let data: Obj;
      try { data = JSON.parse(JSON.parse(match[1]!)); } catch { continue; }
      const root = data?.data?.user_result_by_screen_name?.result;
      if (!root) continue;
      const p = person(root);
      if (p) {
        if (xHandle(p.username) !== expected || (user && p.id !== user.id)) throw new XFailure("account-unavailable");
        if (root.privacy?.protected === true) throw new XFailure("account-unavailable");
        user = { ...user, ...p, profile_image_url: p.profile_image_url ?? user?.profile_image_url };
      }
      const candidate = root.profile_user_originals_timeline?.timeline;
      if (candidate) {
        // Timeline-only chunks use a base64 identity instead of rest_id.
        // Require the same user as the separately identified public profile.
        if (!user || root.id !== Buffer.from(`User:${user.id}`).toString("base64")) throw new XFailure("account-unavailable");
        timeline = candidate;
      }
    }
  }
  if (!user || !Array.isArray(timeline?.instructions)) throw new XFailure("public-unreadable");
  const users = new Map<string, XUser>([[user.id, user]]);
  const expanded = new Map<string, XTweet>(), tweets = new Map<string, XTweet>();
  let entriesKnown = false;
  for (const instruction of timeline.instructions) {
    const entries = instruction.__typename === "TimelineAddEntries" && Array.isArray(instruction.entries)
      ? instruction.entries : []; // An old pinned post is not a new timeline post.
    if (instruction.__typename === "TimelineAddEntries" && Array.isArray(instruction.entries)) entriesKnown = true;
    for (const entry of entries) {
      if (!/^tweet-\d+$/.test(entry.entry_id ?? "")) continue; // Exclude ads, cursors and recommendations.
      const result = entry.content?.content?.tweet_results?.result;
      const v = unwrap(result);
      if (v?.__typename === "TweetUnavailable" || v?.__typename === "TweetTombstone") continue;
      if (!v) throw new XFailure("invalid-response");
      const author = person(v.core?.user_results?.result);
      if (!author) throw new XFailure("invalid-response");
      if (author.id !== user.id) continue; // Do not credit someone else's post to this profile.
      const t = post(v, users, expanded);
      if (entry.entry_id !== `tweet-${t.id}`) throw new XFailure("invalid-response");
      tweets.set(t.id, t);
    }
  }
  if (!entriesKnown) throw new XFailure("public-unreadable"); // Login shell is NOT an empty successful timeline.
  const data = [...tweets.values()].sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1).slice(0, 20);
  return { user, page: { data, meta: { result_count: data.length },
    includes: { users: [...users.values()], tweets: [...expanded.values()] } } };
}
export class XPublicPage {
  constructor(private reserve: () => Promise<(posts: number) => Promise<void>>, private fetcher: typeof fetch = fetch) {}
  async profile(handle: string) {
    const h = xHandle(handle);
    if (!h) throw new XFailure("account-unavailable");
    const settle = await this.reserve();
    let response: Response, html: string;
    try {
      response = await this.fetcher(`https://x.com/${h}`, {
        headers: { "User-Agent": "Tripwire/1.0 (public profile monitoring)", Accept: "text/html" },
        signal: AbortSignal.timeout(12_000), redirect: "manual",
      });
      if (!response.ok) {
        await response.body?.cancel();
        const retry = Number(response.headers.get("retry-after"));
        throw new XFailure(response.status === 429 ? "rate-limited" : response.status === 404 ? "account-unavailable" : "public-blocked",
          new Date(Date.now() + Math.max(1_800_000, Number.isFinite(retry) ? Math.min(retry, 86400) * 1000 : 0)).toISOString());
      }
      if (!response.headers.get("content-type")?.includes("text/html") || Number(response.headers.get("content-length")) > LIMIT) {
        await response.body?.cancel();
        throw new XFailure("public-unreadable");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new XFailure("public-unreadable");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > LIMIT) { await reader.cancel(); throw new XFailure("public-unreadable"); }
        chunks.push(chunk.value);
      }
      html = Buffer.concat(chunks).toString("utf8");
    } catch (error) { throw error instanceof XFailure ? error : new XFailure("unavailable"); }
    const result = parsePublicX(html, h);
    await settle(result.page.data?.length ?? 0);
    return result;
  }
}
