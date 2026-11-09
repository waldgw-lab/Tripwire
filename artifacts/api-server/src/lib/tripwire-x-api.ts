/** Official read-only API adapter; public-page collection is a separate adapter. */
export const X_ACCOUNTS = [
  ["Axios", "axios"], ["The Washington Post", "washingtonpost"],
  ["The Atlantic", "TheAtlantic"], ["CNN", "CNN"], ["CNN", "cnnbrk"],
  ["The Wall Street Journal", "WSJ"], ["The Wall Street Journal", "WSJopinion"],
  ["The New York Times", "nytimes"], ["Reuters", "Reuters"], ["CBS", "CBSNews"],
] as const;
export function xHandle(value: string): string | undefined {
  const raw = value.trim();
  let handle = raw.replace(/^@/, "");
  if (/^https?:/i.test(raw)) {
    try {
      const u = new URL(raw);
      if (!/^(www\.)?(x|twitter)\.com$/i.test(u.hostname) || u.username || u.password || u.port) return;
      handle = u.pathname.split("/")[1] ?? "";
    } catch { return; }
  }
  return /^[a-z0-9_]{1,15}$/i.test(handle) ? handle.toLowerCase() : undefined;
}
export function xStatusId(value?: string): string | undefined {
  try {
    const u = new URL(value ?? "");
    if (!/^(www\.)?(x|twitter)\.com$/i.test(u.hostname) || u.username || u.password || u.port) return;
    return /^\/(?:[a-z0-9_]+|i\/web)\/status\/(\d+)\/?$/i.exec(u.pathname)?.[1];
  } catch { return; }
}
export type XUser = { id: string; username: string; name?: string; profile_image_url?: string };
export function xProfileImage(value?: string): string | undefined {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com" || url.username || url.password || url.port ||
        !url.pathname.startsWith("/profile_images/")) return;
    return url.href;
  } catch { return; }
}
export type XTweet = {
  id: string; text: string; author_id: string; created_at: string;
  text_truncated?: boolean;
  note_tweet?: { text: string }; referenced_tweets?: { id: string; type: string }[];
};
export type XPage = {
  data?: XTweet[]; meta?: { next_token?: string; result_count?: number };
  includes?: { users?: XUser[]; tweets?: XTweet[] }; errors?: unknown[];
};
export class XFailure extends Error {
  constructor(public status: string, public retryAt?: string) { super(status); }
}
export type XSettlement = (posts: number, users: number) => Promise<void>;
export function xMode(env: NodeJS.ProcessEnv = process.env): "api" | "public-page" {
  return env.X_COLLECTION_MODE === "public-page" ? "public-page" : "api";
}
export function xAccess(env: NodeJS.ProcessEnv = process.env) {
  const requests = Number(env.X_DAILY_REQUEST_LIMIT);
  const posts = Number(env.X_DAILY_POST_LIMIT);
  const approved = env.X_COLLECTION_APPROVED === "true" && Number.isSafeInteger(requests) && requests > 0 &&
    Number.isSafeInteger(posts) && posts >= 80;
  const publicPage = xMode(env) === "public-page";
  return { ready: approved && (publicPage || !!env.X_API_BEARER_TOKEN), approved,
    requestLimit: approved ? publicPage ? Math.min(1500, requests) : requests : undefined,
    postLimit: approved ? publicPage ? Math.min(10000, posts) : posts : undefined };
}
export class XApi {
  constructor(private token: string, private reserve: (posts: number, users?: number) => Promise<void | XSettlement>, private fetcher: typeof fetch = fetch) {}
  private async get(path: string, query: Record<string, string>, posts = 0, users = 0): Promise<unknown> {
    const settle = await this.reserve(posts, users); // Failed/uncertain calls retain the worst-case reservation.
    let response: Response;
    try {
      response = await this.fetcher(`https://api.x.com/2/${path}?${new URLSearchParams(query)}`, {
        headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(12_000),
      });
    } catch { throw new XFailure("unavailable"); }
    if (!response.ok) {
      const reset = Number(response.headers.get("x-rate-limit-reset"));
      const retry = Number(response.headers.get("retry-after"));
      const retryAt = new Date(Math.max(Date.now() + 600_000,
        Number.isFinite(reset) ? reset * 1000 : 0, Number.isFinite(retry) ? Date.now() + retry * 1000 : 0)).toISOString();
      throw new XFailure(response.status === 429 ? "rate-limited" :
        response.status === 401 || response.status === 403 ? "access-denied" : "unavailable", retryAt);
    }
    let result: Record<string, any>;
    try { result = await response.json() as Record<string, any>; } catch { throw new XFailure("invalid-response"); }
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new XFailure("invalid-response");
    const data = result?.data ?? (Array.isArray(result?.errors) || result?.meta?.result_count === 0 ? [] : undefined);
    const tweets = result?.includes?.tweets ?? [], people = result?.includes?.users ?? [];
    if (settle && Array.isArray(data) && Array.isArray(tweets) && Array.isArray(people)) {
      await settle(posts ? data.length + tweets.length : 0, posts ? people.length : data.length);
    }
    return result;
  }
  async users(handles: string[]): Promise<XUser[]> {
    if (!handles.length || handles.length > 5) throw new XFailure("invalid-response");
    const result = await this.get("users/by", { usernames: handles.join(","), "user.fields": "profile_image_url" }, 0, handles.length) as { data?: XUser[]; errors?: unknown[] };
    // A successful batch may contain data for valid handles AND per-user errors.
    // Missing users are handled on their own watches, never as a global outage.
    const users = result.data ?? (result.errors?.length ? [] : undefined);
    const requested = new Set(handles.map(xHandle));
    if (!Array.isArray(users) || users.length > handles.length ||
        users.some(u => !u || !/^\d+$/.test(u.id) || !requested.has(xHandle(u.username))) ||
        new Set(users.map(u => xHandle(u.username))).size !== users.length) throw new XFailure("invalid-response");
    return users;
  }
  async timeline(userId: string, since?: string, token?: string): Promise<XPage> {
    const page = await this.get(`users/${userId}/tweets`, {
      max_results: "20", "tweet.fields": "created_at,author_id,referenced_tweets,note_tweet",
      expansions: "author_id,referenced_tweets.id,referenced_tweets.id.author_id", "user.fields": "username",
      ...(since ? { since_id: since } : {}), ...(token ? { pagination_token: token } : {}),
    }, 80, 80) as XPage; // At most 80 post resources and 80 expanded author resources.
    if (page.errors?.length || !page.meta || (!Array.isArray(page.data) && page.meta.result_count !== 0) ||
      (page.data?.length ?? 0) > 20 || page.data?.some(t => !/^\d+$/.test(t.id) || t.author_id !== userId || typeof t.text !== "string" ||
        !t.created_at || !Number.isFinite(Date.parse(t.created_at)))) throw new XFailure("invalid-response");
    return page;
  }
}
export type XCursor = { since?: string; token?: string; newest?: string; pages?: number };
export function nextXCursor(current: XCursor, page: XPage): XCursor {
  const newest = (page.data ?? []).reduce((max, t) => !max || BigInt(t.id) > BigInt(max) ? t.id : max, current.newest ?? current.since);
  // Initial collection is a bounded sample, not a historical backfill.
  return current.since && page.meta?.next_token
    ? { ...current, newest, token: page.meta.next_token, pages: (current.pages ?? 0) + 1 }
    : { since: newest };
}
