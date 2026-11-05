import { createHash } from "node:crypto";
import { db, tripwireContent, tripwireRecords } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { RecordData } from "./tripwire-store";
import type { Capture } from "./tripwire-content";

export async function storeContent(text: string, raw?: string) {
  const actualRaw = raw ?? text;
  const hash = createHash("sha256").update(JSON.stringify([text, actualRaw])).digest("hex");
  await db.insert(tripwireContent).values({ hash, text, raw: actualRaw === text ? null : actualRaw }).onConflictDoNothing();
  return hash;
}
export async function readContent(hash: string) {
  const [body] = await db.select({ text: tripwireContent.text, raw: tripwireContent.raw }).from(tripwireContent).where(eq(tripwireContent.hash, hash));
  if (!body) throw new Error("Retained content is missing from storage");
  return { text: body.text, raw: body.raw ?? body.text, characters: body.text.length, rawCharacters: (body.raw ?? body.text).length };
}
export async function archiveArticle<T extends RecordData>(article: T): Promise<T> {
  if (article.kind !== "article") return article;
  const retainedContent: Capture[] = [];
  let fullTextHash = article.fullText ? undefined : article.fullTextHash;
  for (const capture of article.retainedContent ?? []) {
    if (capture.text === undefined) { retainedContent.push(capture); continue; }
    const { text, raw, ...meta } = capture;
    const bodyHash = await storeContent(text, raw);
    retainedContent.push({ ...meta, bodyHash, textLength: text.length, rawLength: (raw ?? text).length });
    if (text === article.fullText) fullTextHash = bodyHash;
  }
  if (article.fullText && !fullTextHash) {
    fullTextHash = await storeContent(article.fullText);
  }
  const { fullText, ...metadata } = article;
  return { ...metadata, retainedContent, fullTextHash, fullTextLength: fullText?.length ?? article.fullTextLength ?? article.retainedCharacters ?? 0 } as T;
}
export async function hydrateArticles<T extends RecordData>(records: T[]): Promise<T[]> {
  const hashes = [...new Set(records.flatMap(r => [r.fullTextHash, ...r.retainedContent?.map(c => c.bodyHash) ?? []]).filter((h): h is string => !!h))];
  if (!hashes.length) return records;
  const bodies = await db.select({ hash: tripwireContent.hash, text: tripwireContent.text, raw: tripwireContent.raw }).from(tripwireContent).where(inArray(tripwireContent.hash, hashes));
  const map = new Map(bodies.map(b => [b.hash, b]));
  return records.map(r => ({
    ...r,
    fullText: r.fullText ?? (r.fullTextHash ? map.get(r.fullTextHash)?.text : undefined),
    retainedContent: r.retainedContent?.map(c => {
      const body = c.bodyHash ? map.get(c.bodyHash) : undefined;
      return body ? { ...c, text: body.text, raw: body.raw ?? body.text } : c;
    }),
  }));
}
export async function migrateRetainedContent() {
  const rows = await db.select().from(tripwireRecords).where(eq(tripwireRecords.kind, "article"));
  for (const row of rows) {
    const data = row.data as RecordData;
    if (!data.fullText && !data.retainedContent?.some(c => c.text !== undefined)) continue;
    const archived = await archiveArticle(data);
    // Compare the whole old value: never overwrite a concurrent editor or refresh.
    await db.update(tripwireRecords).set({ data: archived }).where(and(eq(tripwireRecords.id, row.id), sql`${tripwireRecords.data} = ${JSON.stringify(row.data)}::jsonb`));
  }
}
