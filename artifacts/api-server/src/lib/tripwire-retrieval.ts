import { db, tripwireRecords } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { recordsFor, writeRecord, type RecordData } from "./tripwire-store";
import { WORKSPACE_OWNER } from "./tripwire-access";
import { fetchPublicDocument } from "./tripwire-fetch";
import { htmlCandidate, htmlClassification, inferOutlet } from "./tripwire-import";
import { mergeHeadlines, observeHeadline } from "./tripwire-headlines";
import { captureContent, mergeArticleContent } from "./tripwire-content";
import { classifyContent, mergeClassification } from "./tripwire-classification";
import { logger } from "./logger";
import { readContent } from "./tripwire-content-storage";
import { publicationUpdate } from "./tripwire-publication";
import { automaticRetrievalAllowed, compareRetrievalPriority } from "./tripwire-priority";

const active = new Set<string>();
const hostNext = new Map<string, number>();
const robotsCache = new Map<string, { until: number; text: string }>();
const DAY = 86_400_000;
type Item = RecordData & { id: string };

export function robotsAllows(text: string, path: string) {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let group: typeof groups[number] | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = line.replace(/#.*$/, "").trim().match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!.toLowerCase(), value = match[2]!.trim();
    if (key === "user-agent") {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); }
      group.agents.push(value.toLowerCase());
    } else if (group && (key === "allow" || key === "disallow") && value) group.rules.push({ allow: key === "allow", path: value });
  }
  const specific = groups.filter(g => g.agents.some(a => a !== "*" && "tripwire".includes(a)));
  const applicable = specific.length ? specific : groups.filter(g => g.agents.includes("*"));
  const rules = applicable.flatMap(g => g.rules).filter(rule => {
    const ending = rule.path.endsWith("$") ? "$" : "";
    const pattern = rule.path.replace(/\$$/, "").split("*").map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${pattern}${ending}`).test(path);
  }).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return rules[0]?.allow ?? true;
}
export async function checkRobots(url: URL) {
  let entry = robotsCache.get(url.origin);
  if (!entry || entry.until < Date.now()) {
    try {
      const response = await fetchPublicDocument(`${url.origin}/robots.txt`);
      entry = { until: Date.now() + DAY, text: response.bytes.toString("utf8") };
    } catch (error) {
      // Missing robots permits fetching; denial, rate limits and outages do not.
      if (!/HTTP 404|HTTP 410/.test(String(error))) throw new Error(`Robots check unavailable: ${error instanceof Error ? error.message : "request failed"}`);
      entry = { until: Date.now() + DAY, text: "" };
    }
    robotsCache.set(url.origin, entry);
  }
  if (!robotsAllows(entry.text, `${url.pathname}${url.search}`)) throw new Error("Publisher robots rules do not allow automated retrieval of this item");
}
async function setHostBackoff(outlet: string | undefined, until: string, message: string) {
  if (!outlet) return;
  await db.update(tripwireRecords).set({
    data: sql`${tripwireRecords.data} || ${JSON.stringify({ pageBackoffUntil: until, pageLastResult: message })}::jsonb`,
  }).where(and(eq(tripwireRecords.kind, "outlet"), sql`${tripwireRecords.data}->>'title' = ${outlet}`));
}
export async function classifyExistingArticles() {
  const rows = await db.select().from(tripwireRecords).where(eq(tripwireRecords.kind, "article"));
  for (const row of rows) {
    const data = row.data as RecordData;
    const classification = classifyContent({ url: data.url, title: data.title, evidence: data.classificationEvidence });
    if (JSON.stringify([data.contentType, data.contentFormat, data.classificationEvidence]) === JSON.stringify([classification.contentType, classification.contentFormat, classification.classificationEvidence])) continue;
    await db.update(tripwireRecords).set({ data: { ...data, ...classification } }).where(and(eq(tripwireRecords.id, row.id), sql`${tripwireRecords.data} = ${JSON.stringify(row.data)}::jsonb`));
  }
}
export async function retrieveItem(article: Item, cachedPage?: { raw: string; url: string; capturedAt: string }) {
  const now = new Date().toISOString();
  const attempts = (article.retrieval?.attempts ?? 0) + 1;
  let raw: string | undefined;
  let classification = classifyContent({ url: article.url, title: article.title, evidence: article.classificationEvidence });
  try {
    const url = new URL(article.url!);
    if (!cachedPage) await checkRobots(url);
    const fetched = cachedPage ? { bytes: Buffer.from(cachedPage.raw), url: cachedPage.url, contentType: "text/html" } : await fetchPublicDocument(url.href, 0, { maxBytes: 8_000_000 });
    if (!/html|text\//i.test(fetched.contentType)) throw new Error(`Source returned ${fetched.contentType || "an unsupported format"}; upload the document to retain it`);
    raw = fetched.bytes.toString("utf8");
    classification = htmlClassification(raw, fetched.url, article.title);
    if (/\/(?:login|signin|subscribe|auth)(?:\/|\?|$)/i.test(fetched.url)) throw new Error("Publisher returned an account or subscription page");
    const candidate = htmlCandidate(raw, fetched.url);
    if (/^(?:.{0,120})(?:access denied|just a moment|enable javascript|verify.{0,20}human|subscribe to continue)/i.test(candidate.fullText ?? "")) throw new Error("Publisher returned an access page, not article text");
    if (article.outlet && inferOutlet(fetched.url) && inferOutlet(fetched.url) !== article.outlet) throw new Error("Publisher redirected to a different outlet; response retained without attributing its text to this article");
    const method = candidate.extractionMethod;
    const capture = captureContent(candidate.fullText ?? "", `page:${method}`, { raw, sourceUrl: fetched.url, capturedAt: cachedPage?.capturedAt ?? now });
    const existing = (await recordsFor(WORKSPACE_OWNER, false)).find(a => a.id === article.id);
    if (!existing) return;
    const content = mergeArticleContent(existing, { ...candidate, retainedContent: [capture], fullTextComplete: false });
    const mergedClassification = mergeClassification(existing, classification);
    const next = new Date(Date.now() + (mergedClassification.contentFormat === "live-updates" ? 15 * 60_000 : 7 * DAY)).toISOString();
    await writeRecord(WORKSPACE_OWNER, {
      ...existing, ...content, ...mergedClassification,
      verifiedHeadlines: mergeHeadlines(existing, existing.verifiedHeadlines,
        candidate.publisherHeadline ? observeHeadline({ ...candidate, title: candidate.publisherHeadline }, capture, "publisher-page") : []),
      ...(!existing.summary && candidate.summary ? { summary: candidate.summary } : {}),
      ...(existing.byline || !candidate.byline ? {} : { byline: candidate.byline, credits: candidate.credits, journalists: candidate.journalists }),
      ...publicationUpdate(existing, { publishedAt: candidate.publishedAt, publicationSource: "publisher", publicationSourceUrl: fetched.url }),
      retrieval: { status: "retrieved", method, lastAttempt: now, nextAttemptAt: next, characters: candidate.fullText?.length ?? 0, rawCharacters: raw.length,
        attempts, message: `${cachedPage ? "Re-extracted" : "Retained"} ${(candidate.fullText?.length ?? 0).toLocaleString()} text characters and ${raw.length.toLocaleString()} source characters` },
    }, true, false, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retrieval failed";
    const blocked = /HTTP (401|402|403|429)|robots|access page|subscription|account/.test(message);
    const next = new Date(Date.now() + (blocked ? DAY : Math.min(DAY, 30 * 60_000 * 2 ** Math.min(attempts - 1, 5)))).toISOString();
    const existing = (await recordsFor(WORKSPACE_OWNER, false)).find(a => a.id === article.id);
    if (!existing) return;
    const retained = raw === undefined ? {} : mergeArticleContent(existing, { retainedContent: [captureContent("", "page:response", { raw, sourceUrl: article.url })] });
    await writeRecord(WORKSPACE_OWNER, { ...existing, ...retained, ...mergeClassification(existing, classification),
      retrieval: { status: blocked ? "blocked" : "failed", method: raw ? "page response" : "HTTP request", lastAttempt: now, nextAttemptAt: next, attempts,
        message, characters: 0, rawCharacters: raw?.length ?? 0 } }, true);
    if (blocked) await setHostBackoff(article.outlet, next, message);
  }
}
export async function reprocessSavedPages() {
  // New extraction rules reuse the immutable response; no extra publisher hit.
  const records = await recordsFor(WORKSPACE_OWNER, false);
  for (const article of records.filter(a => a.kind === "article" && a.outlet === "Daily Mail" && a.retrieval?.method !== "publisher article paragraphs")) {
    const capture = [...article.retainedContent ?? []].reverse().find(c => c.source.startsWith("page:") && c.bodyHash && (c.rawLength ?? 0) > 0);
    if (!capture?.bodyHash) continue;
    const body = await readContent(capture.bodyHash);
    await retrieveItem(article, { raw: body.raw, url: capture.sourceUrl ?? article.url!, capturedAt: capture.capturedAt });
  }
}
let running = false;
export async function runRetrievalTick() {
  if (running) return;
  running = true;
  try {
    const records = await recordsFor(WORKSPACE_OWNER, false);
    const outlets = records.filter(r => r.kind === "outlet");
    const watches = records.filter(r => r.kind === "watch");
    const attempts = new Map<string, number>();
    for (const a of records.filter(r => r.kind === "article" && r.retrieval?.lastAttempt)) attempts.set(a.outlet ?? "", (attempts.get(a.outlet ?? "") ?? 0) + 1);
    const due = records.filter(a => {
      if (a.kind !== "article" || !a.url || a.discoveryOnly || a.sourceType === "x" || active.has(a.id)) return false;
      if (!automaticRetrievalAllowed(a, watches)) return false;
      const outlet = outlets.find(o => o.title === a.outlet) as (Item & { pageBackoffUntil?: string }) | undefined;
      if (outlet?.enabled === false || Date.parse(outlet?.pageBackoffUntil ?? "") > Date.now()) return false;
      if (Date.parse(a.retrieval?.nextAttemptAt ?? "") > Date.now()) return false;
      try { return (hostNext.get(new URL(a.url).host) ?? 0) <= Date.now(); } catch { return false; }
    }).sort((a, b) => compareRetrievalPriority(a, b, watches, attempts));
    const selected: typeof due = [];
    const hosts = new Set<string>();
    for (const item of due) {
      const host = new URL(item.url!).host;
      if (hosts.has(host)) continue;
      hosts.add(host); selected.push(item);
      if (selected.length === 2) break;
    }
    await Promise.all(selected.map(async item => {
      active.add(item.id);
      const host = new URL(item.url!).host;
      hostNext.set(host, Date.now() + 15_000);
      try { await retrieveItem(item); } finally { active.delete(item.id); }
    }));
  } finally { running = false; }
}
export function startRetrieval() {
  const run = () => void runRetrievalTick().catch(err => logger.error({ err: err instanceof Error ? err.message : "Retrieval failed" }, "Article retrieval"));
  run(); setInterval(run, 3000).unref();
  // Reuters has no configured publisher RSS. Probe its official source rather
  // than silently substituting a third-party republication or inventing items.
  void (async () => {
    const records = await recordsFor(WORKSPACE_OWNER, false);
    const reuters = records.find(r => r.kind === "outlet" && r.title === "Reuters" && r.enabled !== false && !r.feedUrl);
    if (!reuters || records.some(r => r.kind === "article" && r.outlet === "Reuters")) return;
    let message: string;
    try {
      const url = new URL("https://www.reuters.com/world/us/");
      await checkRobots(url);
      const response = await fetchPublicDocument(url.href);
      message = `Official source responded with ${response.bytes.length.toLocaleString()} bytes; no publisher feed configured. Individual URLs can be imported.`;
    } catch (error) {
      message = error instanceof Error ? error.message : "Official source unavailable";
    }
    await db.update(tripwireRecords).set({ data: sql`${tripwireRecords.data} || ${JSON.stringify({ pageLastResult: message })}::jsonb` })
      .where(and(eq(tripwireRecords.kind, "outlet"), sql`${tripwireRecords.data}->>'title' = 'Reuters'`));
  })().catch(err => logger.warn({ err: String(err) }, "Reuters source probe"));
}
