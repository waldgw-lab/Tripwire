import Parser from "rss-parser";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { db, tripwireRecords } from "@workspace/db";
import { recordsFor } from "./tripwire-store";
import { stableId } from "./tripwire-config";
import { logger } from "./logger";

const parser = new Parser({customFields: {item: [["dc:creator", "creator"]]}});
const locks = new Set<string>();
const cooldown = new Map<string, number>();
const strip = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
const relevant = /\b(politic|trump|vance|rubio|hegseth|caine|cooper|pentagon|defen[sc]e|military|intelligence|iran|israel|ukraine|russia|china|foreign policy|state department|white house|congress|senate|war|diploma|nato|munitions|geopolitic)/i;
function publicAddress(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && b === 168 || a === 100 && b! >= 64 && b! <= 127 || a! >= 224);
  }
  return !ip.includes(".") && !/^(::|fc|fd|fe[89ab])/i.test(ip);
}
export async function fetchFeed(url: string, depth = 0): Promise<string> {
  const target = new URL(url);
  if (!["https:", "http:"].includes(target.protocol) || target.username || target.password || target.port && !["80", "443"].includes(target.port)) throw new Error("Invalid public feed URL");
  const addresses = await lookup(target.hostname, {all: true});
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error("Feed must use a public host");
  const response = await fetch(target, {redirect: "manual", signal: AbortSignal.timeout(12000), headers: {"User-Agent": "Tripwire/1.0 RSS monitoring", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml"}});
  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
    if (depth >= 3) throw new Error("Too many redirects");
    return fetchFeed(new URL(response.headers.get("location")!, target).href, depth + 1);
  }
  if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty feed response");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > 3_000_000) { await reader.cancel(); throw new Error("Feed exceeds size limit"); }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function refreshFeeds(userId?: string | null) {
  const owner = userId || "public";
  if (locks.has(owner) || Date.now() - (cooldown.get(owner) ?? 0) < 60000) {
    return {added: 0, checked: 0, failures: ["Feed refresh is already running or was checked in the last minute."], refreshedAt: new Date().toISOString()};
  }
  locks.add(owner);
  cooldown.set(owner, Date.now());
  let added = 0, checked = 0;
  const failures: string[] = [];
  const refreshedAt = new Date().toISOString();
  try {
    const records = await recordsFor(userId);
    const outlets = records.filter(r => r.kind === "outlet" && r.enabled !== false && r.feedUrl);
    const watches = records.filter(r => r.kind === "watch" && r.enabled !== false);
    // Limit concurrent external requests to avoid overwhelming feed servers.
    for (let i = 0; i < outlets.length; i += 4) {
      await Promise.all(outlets.slice(i, i + 4).map(async outlet => {
        checked++;
        let feedStatus = "Connected";
        try {
          const feed = await parser.parseString(await fetchFeed(outlet.feedUrl!));
          for (const item of feed.items.slice(0, 60)) {
            if (!item.title || !item.link || !/^https?:\/\//i.test(item.link)) continue;
            const title = strip(item.title);
            const text = `${title} ${strip(item.contentSnippet ?? item.content ?? "")}`;
            if (!relevant.test(text)) continue;
            const url = new URL(item.link);
            for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/.test(key)) url.searchParams.delete(key);
            url.hash = "";
            const id = stableId(`article:${url.href}`);
            const entities = watches.filter(w => [w.title, w.position ?? "", w.individual ?? "", ...(w.aliases ?? [])].some(a => a.length > 2 && text.toLowerCase().includes(a.toLowerCase()))).map(w => w.title);
            const published = item.isoDate ?? item.pubDate;
            const publishedAt = published && !isNaN(Date.parse(published)) ? new Date(published).toISOString() : undefined;
            const creator = strip(item.creator ?? "");
            const journalists = creator ? creator.replace(/^By\s+/i, "").split(/\s+and\s+|,\s*/).filter(Boolean) : [];
            const topic = /intelligence|cia|spy|classified/i.test(text) ? "Intelligence" : /military|operation|strike|troops/i.test(text) ? "Military Operations" : /diploma|foreign|state department/i.test(text) ? "Foreign Policy" : /pentagon|defense|munitions/i.test(text) ? "Defense" : /iran|israel|ukraine|russia|china|nato/i.test(text) ? "Geopolitics" : "Politics";
            const data = {kind: "article", title, url: url.href, outlet: outlet.title, journalists, publishedAt, summary: strip(item.contentSnippet ?? "").slice(0, 450), entities, topic, sentiment: "unassessed", reportingType: "unassessed", sourceType: "article", saved: false};
            const result = await db.insert(tripwireRecords).values({id: owner === "public" ? id : `${owner}:${id}`, owner, kind: "article", data: owner === "public" ? data : {...data, baseId: id}}).onConflictDoNothing().returning({id: tripwireRecords.id});
            added += result.length;
          }
        } catch (err) {
          feedStatus = err instanceof Error ? err.message : "Feed unavailable";
          failures.push(`${outlet.title}: ${feedStatus}`);
          logger.warn({outlet: outlet.title, error: feedStatus}, "Feed refresh failed");
        }
        // A user's custom configuration must never change another user's outlets.
        const statusId = owner === "public" ? outlet.id : `${owner}:${outlet.id}`;
        const data = {...outlet, lastChecked: refreshedAt, feedStatus, ...(owner === "public" ? {} : {baseId: outlet.id})};
        await db.insert(tripwireRecords).values({id: statusId, owner, kind: "outlet", data}).onConflictDoUpdate({target: tripwireRecords.id, set: {data, updatedAt: new Date()}});
      }));
    }
  } finally { locks.delete(owner); }
  return {added, checked, failures, refreshedAt};
}

export function startMonitoring() {
  const run = () => refreshFeeds().catch(err => logger.error({err}, "Monitoring refresh failed"));
  void run();
  setInterval(run, 10 * 60_000).unref();
}
