import { gunzipSync } from "node:zlib";
import { db, tripwireRecords } from "@workspace/db";
import { recordsFor } from "./tripwire-store";
import { stableId } from "./tripwire-config";
import { logger } from "./logger";
import { and, eq, sql } from "drizzle-orm";
import { parseByline } from "./tripwire-bylines";
import { archiveArticle } from "./tripwire-content-storage";
import { classifyContent, mergeClassification } from "./tripwire-classification";
import type { RecordData } from "./tripwire-store";
import { mentionedEntities, inferArticleTopic } from "./tripwire-signals";
import { rssContent, mergeArticleContent, captureContent, type Capture } from "./tripwire-content";
import { fetchPublicDocument } from "./tripwire-fetch";
import { intakeSources, publisherUrl, sitemapItems, feedFreshness, retryAfter, discoveryTitle, titleKey, parseRssItems, type IntakeItem, type IntakeSource, type FeedHealth } from "./tripwire-intake";
import { checkRobots } from "./tripwire-retrieval";
import { publicationUpdate } from "./tripwire-publication";

const locks = new Set<string>();
const cooldown = new Map<string, number>();
const strip = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
const relevant = /\b(politic|trump|vance|rubio|hegseth|caine|cooper|pentagon|defen[sc]e|military|intelligence|iran|israel|ukraine|russia|china|foreign policy|state department|white house|congress|senate|war|diploma|nato|munitions|geopolitic)/i;
export async function fetchFeed(url: string): Promise<string> {
  const result = await fetchPublicDocument(url, 0, { httpsOnly: true, accept: "application/rss+xml,application/atom+xml,application/xml,text/xml" });
  const bytes = result.bytes[0] === 0x1f && result.bytes[1] === 0x8b
    ? gunzipSync(result.bytes, { maxOutputLength: 3_000_000 }) : result.bytes;
  const xml = bytes.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Document type declarations are not accepted");
  return xml;
}
async function sourceItems(source: IntakeSource, outlet: string): Promise<IntakeItem[]> {
  if (source.kind === "sitemap") await checkRobots(new URL(source.url));
  const xml = await fetchFeed(source.url);
  if (source.kind === "sitemap") return sitemapItems(xml, outlet);
  return parseRssItems(xml);
}

export async function refreshFeeds(_userId?: string | null) {
  // Manual refresh and background monitoring share one intake and lock. Creating
  // per-user copies here would duplicate articles and leave stale status shadows.
  const owner = "public";
  if (locks.has(owner) || Date.now() - (cooldown.get(owner) ?? 0) < 60000) {
    return {added: 0, checked: 0, failures: ["Feed refresh is already running or was checked in the last minute."], refreshedAt: new Date().toISOString()};
  }
  locks.add(owner);
  cooldown.set(owner, Date.now());
  let added = 0, checked = 0;
  const failures: string[] = [];
  const refreshedAt = new Date().toISOString();
  try {
    const records = await recordsFor("workspace", false);
    const outlets = records.filter(r => r.kind === "outlet" && r.enabled !== false);
    const watches = records.filter(r => r.kind === "watch" && r.enabled !== false);
    // Limit concurrent external requests to avoid overwhelming feed servers.
    for (let i = 0; i < outlets.length; i += 4) {
      await Promise.all(outlets.slice(i, i + 4).map(async outlet => {
        checked++;
        const health: FeedHealth[] = [];
        let primaryConnected = false;
        const sources = intakeSources(outlet.title, outlet.feedUrl);
        try {
          for (const source of sources) {
          const savedHealth = outlet.feedHealth?.find(h => h.url === source.url);
          const previous = savedHealth ? { ...savedHealth, role: source.role } : undefined;
          if (source.role === "fallback" && primaryConnected) {
            health.push({ ...previous, ...source, status: "standby", items: previous?.items ?? 0, message: "Reserved for publisher intake failure" });
            continue;
          }
          if (previous?.nextAttemptAt && Date.parse(previous.nextAttemptAt) > Date.now()) { health.push(previous); continue; }
          let items: IntakeItem[];
          try {
            items = await sourceItems(source, outlet.title);
            const freshness = feedFreshness(items.map(item => item.isoDate ?? item.pubDate));
            const status = !items.length ? "empty" : freshness.stale ? "stale" : "connected";
            const ok = status === "connected";
            health.push({ ...source, status, checkedAt: refreshedAt, items: items.length, ...freshness,
              message: ok ? `${source.kind === "google-news" ? "Google News discovery" : source.kind === "sitemap" ? "Publisher news sitemap" : "Publisher RSS/Atom"}: ${items.length} items`
                : items.length ? "Feed has no verified publication within seven days" : "Feed is empty",
              ...(!ok ? { nextAttemptAt: retryAfter((previous?.failures ?? 0) + 1), failures: (previous?.failures ?? 0) + 1 } : { failures: 0 }) });
            if (!ok) continue;
            if (source.role !== "fallback" || source.kind !== "google-news") primaryConnected = true;
          } catch (error) {
            const message = error instanceof Error ? error.message : "Source unavailable";
            health.push({ ...source, status: "failed", checkedAt: refreshedAt, items: 0, message, failures: (previous?.failures ?? 0) + 1, nextAttemptAt: retryAfter((previous?.failures ?? 0) + 1) });
            logger.warn({ outlet: outlet.title, url: source.url, error: message }, "Intake source failed");
            continue;
          }
          // Bound ingestion, newest first (some publishers don't order feeds).
          items.sort((a, b) => Date.parse(b.isoDate ?? b.pubDate ?? "") - Date.parse(a.isoDate ?? a.pubDate ?? ""));
          for (const item of items.slice(0, 150)) {
            if (!item.title || !item.link || !/^https?:\/\//i.test(item.link)) continue;
            const discovery = source.kind === "google-news";
            const publisher = item.publisherSource?.[0];
            if (discovery ? !publisher?.$?.url || !publisherUrl(publisher.$.url, outlet.title) || new URL(item.link).hostname !== "news.google.com" || new URL(item.link).protocol !== "https:" : !publisherUrl(item.link, outlet.title)) continue;
            const title = strip(discovery ? discoveryTitle(item.title, publisher?._ ?? "") : item.title);
            const retained = source.kind === "rss" ? rssContent(item, item.link) : {
              retainedContent: [captureContent("", discovery ? "discovery:google-news" : "discovery:publisher-sitemap",
                { raw: item.raw ?? JSON.stringify(item), sourceUrl: source.url })],
              fullText: undefined, contentRetained: true, retainedCharacters: 0,
            };
            const text = `${title} ${retained.fullText ?? ""}`;
            if (!relevant.test(text)) continue;
            const url = new URL(item.link);
            for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/.test(key)) url.searchParams.delete(key);
            url.hash = "";
            const discovered = records.filter(r => r.kind === "article" && r.outlet === outlet.title && titleKey(r.title) === titleKey(title));
            const existingDiscovery = discovered.length === 1 ? discovered[0] : undefined;
            // Don't create a Google duplicate of an already-known publisher item.
            if (discovery && existingDiscovery && !existingDiscovery.discoveryOnly) continue;
            const id = existingDiscovery?.discoveryOnly ? existingDiscovery.id : stableId(discovery ? `discovery:${outlet.title}:${titleKey(title)}` : `article:${url.href}`);
            const entities = mentionedEntities(text, watches);
            const published = item.isoDate ?? item.pubDate;
            const publication = publicationUpdate({}, { publishedAt: published, publicationSource: discovery ? "google-news" : "publisher", publicationSourceUrl: source.url });
            const creator = !discovery ? strip(item.creator ?? "") : "";
            const credits = parseByline(creator);
            const journalists = credits.filter(c => c.role === "author").map(c => c.name);
            const topic = inferArticleTopic(title, retained.fullText ?? "");
            const classification = classifyContent({ url: url.href, title, labels: item.categories ?? [] });
            const data = await archiveArticle({kind: "article", title, url: url.href, outlet: outlet.title, journalists, ...(creator ? {byline: creator, credits} : {}), ...publication, summary: discovery ? undefined : strip(item.contentSnippet ?? "").slice(0, 450), entities, topic, sentiment: "unassessed", reportingType: "unassessed", sourceType: "article", saved: false,
              intakeMethod: source.kind, intakeUrl: source.url, discoveryOnly: discovery, discoveredAt: refreshedAt,
              ...retained, fullTextComplete: false, ...classification} as RecordData);
            const result = await db.insert(tripwireRecords).values({id: owner === "public" ? id : `${owner}:${id}`, owner, kind: "article", data: owner === "public" ? data : {...data, baseId: id}}).onConflictDoNothing().returning({id: tripwireRecords.id});
            added += result.length;
            // Existing feed items also receive retained content; no excerpt-only cache remains
            // simply because its canonical URL was seen on an earlier refresh.
            if (!result.length && retained.retainedContent.length) {
              const recordId = owner === "public" ? id : `${owner}:${id}`;
              await db.transaction(async tx => {
                const [current] = await tx.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, recordId), eq(tripwireRecords.owner, owner))).for("update");
                if (!current) return;
                const currentData = current.data as RecordData;
                const merged = mergeArticleContent(current.data as { fullText?: string; fullTextComplete?: boolean; retainedContent?: Capture[] }, retained);
                const promotion = current.data.discoveryOnly && !discovery ? { ...data, saved: current.data.saved, flagged: current.data.flagged } : {};
                const archived = await archiveArticle({ ...currentData, ...promotion, ...merged,
                  publishedAt: currentData.publishedAt, publicationSource: currentData.publicationSource, publicationSourceUrl: currentData.publicationSourceUrl,
                  ...publicationUpdate(currentData, data), ...mergeClassification(currentData, classification) } as RecordData);
                await tx.update(tripwireRecords).set({ data: archived, updatedAt: new Date() }).where(and(eq(tripwireRecords.id, recordId), eq(tripwireRecords.owner, owner)));
              });
            }
            // Repair cached RSS bylines once, without touching private edits or existing structured credits.
            if (!result.length && owner === "public" && credits.length) {
              await db.update(tripwireRecords).set({
                data: sql`${tripwireRecords.data} || ${JSON.stringify({byline: creator, credits, journalists})}::jsonb`,
              }).where(and(eq(tripwireRecords.id, id), eq(tripwireRecords.owner, "public"), sql`NOT (${tripwireRecords.data} ? 'credits')`));
            }
          }
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : "Feed unavailable";
          failures.push(`${outlet.title}: ${error}`);
          logger.warn({outlet: outlet.title, error}, "Feed refresh failed");
        }
        const connected = health.filter(h => h.status === "connected");
        const active = connected.filter(h => h.kind !== "google-news");
        const feedStatus = active.length ? `Connected: ${active.length} publisher source${active.length === 1 ? "" : "s"}`
          : connected.length ? "Fallback: Google News headline discovery only"
          : health[0]?.message ?? "Manual intake";
        if (!connected.length) failures.push(`${outlet.title}: ${feedStatus}`);
        // Health is shared; configuration overrides remain in the workspace.
        const statusId = owner === "public" ? outlet.id : `${owner}:${outlet.id}`;
        const prior = outlet.feedHealth?.filter(h => !health.some(next => next.url === h.url)) ?? [];
        const data = {...outlet, feedUrl: sources.find(s => s.role === "primary")?.url ?? outlet.feedUrl,
          lastChecked: refreshedAt, feedStatus, feedHealth: [...health, ...prior], ...(owner === "public" ? {} : {baseId: outlet.id})};
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
