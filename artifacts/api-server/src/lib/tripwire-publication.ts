export type Publication = {
  publishedAt?: string;
  publicationSource?: "publisher" | "google-news" | "manual";
  publicationSourceUrl?: string;
};
export function publicationUpdate(existing: Publication, incoming: Publication): Publication {
  if (typeof incoming.publishedAt !== "string" || !Number.isFinite(Date.parse(incoming.publishedAt))) return {};
  const hasDate = !!existing.publishedAt && Number.isFinite(Date.parse(existing.publishedAt));
  // A publisher or explicit imported date may replace a provisional index date.
  // Ordinary feed refreshes must not overwrite established or manually set dates.
  if (hasDate && !(existing.publicationSource === "google-news" && incoming.publicationSource && incoming.publicationSource !== "google-news")) return {};
  return { publishedAt: new Date(incoming.publishedAt).toISOString(),
    publicationSource: incoming.publicationSource ?? "publisher",
    publicationSourceUrl: incoming.publicationSourceUrl };
}
export function discoveryPublication(raw: string, sourceUrl?: string): Publication {
  try {
    const item = JSON.parse(raw);
    for (const publishedAt of [item.isoDate, item.pubDate]) {
      const publication = publicationUpdate({}, { publishedAt, publicationSource: "google-news", publicationSourceUrl: sourceUrl });
      if (publication.publishedAt) return publication;
    }
    return {};
  } catch { return {}; }
}
