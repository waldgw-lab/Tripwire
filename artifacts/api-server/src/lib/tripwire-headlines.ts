import type { RecordData } from "./tripwire-store";
import type { Capture } from "./tripwire-content";
import { publisherUrl } from "./tripwire-intake";
import { xStatusId } from "./tripwire-x-api";

export function canonicalUrl(raw?: string) {
  if (!raw?.trim()) return undefined;
  const url = new URL(raw.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an http or https source URL");
  const postId = xStatusId(raw);
  if (postId) return `https://x.com/i/web/status/${postId}`;
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  url.hash = ""; url.hostname = url.hostname.replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href;
}

export const headlineKey = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
type Observation = NonNullable<RecordData["verifiedHeadlines"]>[number];
type Identity = Pick<RecordData, "url" | "outlet" | "verifiedHeadlines">;

/** Only called with fetched publisher metadata, never pasted text or analyst titles. */
export function observeHeadline(candidate: Pick<RecordData, "title" | "url" | "outlet">, capture: Capture, source: Observation["source"], sourceUrl = capture.sourceUrl): Observation[] {
  if (!candidate.title.trim() || !candidate.url || !candidate.outlet || !sourceUrl ||
      !publisherUrl(candidate.url, candidate.outlet) || !publisherUrl(sourceUrl, candidate.outlet)) return [];
  return [{ title: candidate.title, outlet: candidate.outlet, articleUrl: canonicalUrl(candidate.url)!,
    sourceUrl, observedAt: capture.capturedAt, source, captureId: capture.id }];
}

/** Bind every observation to this article's canonical identity and publisher. */
export function mergeHeadlines(identity: Identity, ...groups: (Observation[] | undefined)[]) {
  const merged = new Map<string, Observation>();
  for (const group of groups) for (const observation of group ?? []) {
    try {
      if (!identity.url || !identity.outlet || canonicalUrl(observation.articleUrl) !== canonicalUrl(identity.url) ||
          observation.outlet.toLowerCase() !== identity.outlet.toLowerCase() ||
          !publisherUrl(observation.sourceUrl, observation.outlet) || !publisherUrl(observation.articleUrl, observation.outlet)) continue;
      const key = JSON.stringify([observation.title, observation.articleUrl, observation.sourceUrl, observation.source, observation.captureId]);
      if (!merged.has(key)) merged.set(key, observation);
    } catch { /* Invalid legacy identity is not match evidence. */ }
  }
  return [...merged.values()];
}

/** Resolve discovery promotion before binding observations to the article identity. */
export function publisherIdentityUpdate(current: RecordData, shared?: RecordData) {
  const promotion = current.discoveryOnly && shared?.discoveryOnly === false ? {
    discoveryOnly: false, url: shared.url, intakeMethod: shared.intakeMethod, intakeUrl: shared.intakeUrl,
    byline: current.byline ?? shared.byline, credits: current.credits ?? shared.credits,
    journalists: current.journalists?.length ? current.journalists : shared.journalists,
  } : {};
  return { ...promotion, verifiedHeadlines: mergeHeadlines({ ...current, ...promotion }, shared?.verifiedHeadlines, current.verifiedHeadlines) };
}
