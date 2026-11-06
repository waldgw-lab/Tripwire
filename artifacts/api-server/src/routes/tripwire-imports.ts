import { Router, type IRouter } from "express";
import { workspaceIdentity } from "../lib/tripwire-access";
import { db, tripwireRecords } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { AnalyzeImportBody, AnalyzeImportResponse, CommitImportBody, CommitImportResponse, RequestImportUploadBody } from "@workspace/api-zod";
import { recordsFor, writeRecord, type RecordData } from "../lib/tripwire-store";
import { privateFile, uploadUrl } from "../lib/tripwire-files";
import { fetchPublicDocument } from "../lib/tripwire-fetch";
import { canonicalUrl, documentText, htmlCandidate, importCapture, matchImport, textCandidate } from "../lib/tripwire-import";
import { publisherUrl } from "../lib/tripwire-intake";
import { publicationUpdate } from "../lib/tripwire-publication";
import { mergeCaptures, captureContent, prefersIncomingContent, type Capture } from "../lib/tripwire-content";
import { parseByline } from "../lib/tripwire-bylines";
import { archiveArticle, hydrateArticles } from "../lib/tripwire-content-storage";
import { mergeClassification } from "../lib/tripwire-classification";
import { reconcileCredits } from "../lib/tripwire-paste";
import { mentionedEntities } from "../lib/tripwire-signals";

const router: IRouter = Router();
const inFlight = new Set<string>();
const rate = new Map<string, { count: number; expires: number }>();
class IntakeError extends Error { constructor(message: string, public status = 400) { super(message); } }
router.use("/tripwire/imports", (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

router.post("/tripwire/imports/uploads", async (req, res) => {
  try {
    const body = RequestImportUploadBody.parse(req.body);
    const name = body.name.replace(/[\\/]/g, "_").slice(0, 180);
    if (!/\.(pdf|doc|docx)$/i.test(name)) throw new IntakeError("Choose a PDF, DOC or DOCX file");
    const uploadId = crypto.randomUUID();
    const url = await uploadUrl(uploadId);
    await db.insert(tripwireRecords).values({ id: `upload:${uploadId}`, owner: workspaceIdentity(req).userId, kind: "upload", data: { name, size: body.size, contentType: body.contentType, objectId: uploadId } });
    res.json({ uploadId, uploadUrl: url });
  } catch (error) {
    req.log.warn({ err: error instanceof Error ? error.message : "Upload error" }, "Import upload failed");
    res.status(error instanceof IntakeError ? error.status : 400).json({ error: error instanceof IntakeError ? error.message : "Could not prepare upload. Check the file type and size." });
  }
});

router.post("/tripwire/imports/analyze", async (req, res) => {
  const userId = workspaceIdentity(req).userId;
  if (inFlight.has(userId)) { res.status(429).json({ error: "An import is already being analyzed" }); return; }
  const prior = rate.get(userId);
  const bucket = prior && prior.expires > Date.now() ? prior : { count: 0, expires: Date.now() + 60000 };
  rate.set(userId, bucket);
  if (++bucket.count > 12) { res.status(429).json({ error: "Please wait a minute before analyzing more imports" }); return; }
  inFlight.add(userId);
  try {
    const body = AnalyzeImportBody.parse(req.body);
    let text = body.text?.trim() ?? "";
    let sourceUrl = body.url?.trim();
    if (!sourceUrl && /^https?:\/\/\S+$/i.test(text)) { sourceUrl = text; text = ""; }
    if ([!!text, !!sourceUrl, !!body.uploadId].filter(Boolean).length !== 1) throw new IntakeError("Provide text, a URL, or one document");
    const records = await recordsFor(userId);
    const target = body.targetId ? records.find(r => r.id === body.targetId && r.kind === "article") : undefined;
    if (body.targetId && !target) throw new IntakeError("Article not found in this workspace", 404);
    let candidate: RecordData;
    let capture: Capture;
    const warnings: string[] = [];
    let source: string;
    if (body.uploadId) {
      const [upload] = await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, `upload:${body.uploadId}`), eq(tripwireRecords.owner, userId), eq(tripwireRecords.kind, "upload")));
      if (!upload) throw new IntakeError("Upload not found in this workspace", 404);
      const object = privateFile(String(upload.data.archiveId ?? upload.data.objectId));
      let bytes: Buffer;
      try {
        const [metadata] = await object.getMetadata();
        if (Number(metadata.size) > 10485760 || Number(metadata.size) !== Number(upload.data.size)) throw new IntakeError("Uploaded file size does not match the selected file");
        [bytes] = await object.download();
      } catch (error) { if (error instanceof IntakeError) throw error; throw new IntakeError("The upload is not available yet. Select the file and try again."); }
      const extracted = await documentText(bytes, String(upload.data.name));
      // The upload URL can still be used until it expires. Archive an immutable copy
      // at an unshared object key so later PUTs cannot change the retained original.
      if (!upload.data.archiveId) {
        const archiveId = crypto.randomUUID();
        await privateFile(archiveId).save(bytes, { resumable: false, contentType: String(upload.data.contentType) || "application/octet-stream" });
        await db.update(tripwireRecords).set({ data: { ...upload.data, archiveId } }).where(and(eq(tripwireRecords.id, upload.id), eq(tripwireRecords.owner, userId)));
      }
      candidate = textCandidate(extracted);
      source = "file";
      capture = importCapture(candidate, source, { raw: extracted, fileName: String(upload.data.name), uploadId: body.uploadId });
    } else if (sourceUrl) {
      const response = await fetchPublicDocument(sourceUrl);
      source = "url";
      if (/pdf|msword|officedocument/i.test(response.contentType) || /\.(pdf|doc|docx)$/i.test(new URL(response.url).pathname)) {
        const filename = new URL(response.url).pathname.split("/").pop() ?? "document.pdf";
        const extracted = await documentText(response.bytes, filename);
        candidate = textCandidate(extracted, response.url);
        // Retain the original fetched document just as with uploaded documents.
        const id = crypto.randomUUID();
        await privateFile(id).save(response.bytes, { resumable: false, contentType: response.contentType });
        await db.insert(tripwireRecords).values({ id: `upload:${id}`, owner: userId, kind: "upload", data: { name: filename, size: response.bytes.length, contentType: response.contentType, objectId: id, archiveId: id } });
        capture = importCapture(candidate, source, { raw: extracted, fileName: filename, uploadId: id });
      } else {
        const raw = response.bytes.toString("utf8");
        candidate = /html/i.test(response.contentType) || /<!doctype html|<html[\s>]/i.test(raw) ? htmlCandidate(raw, response.url) : textCandidate(raw, response.url);
        capture = importCapture(candidate, source, { raw });
      }
    } else {
      source = "paste";
      candidate = textCandidate(body.text ?? text);
      capture = importCapture(candidate, source, { raw: body.text ?? text });
    }
    if (candidate.publishedAt) candidate = { ...candidate, publicationSource: source === "url" ? "publisher" : "manual", publicationSourceUrl: candidate.url };
    const matched = matchImport(candidate, records);
    if (matched.ambiguous && !target) throw new IntakeError("More than one existing item matches. Open the intended article and enrich it there.");
    if (target && matched.record && matched.record.id !== target.id) throw new IntakeError("This content matches a different article. Import it from the Dashboard rather than overwriting this item.");
    const existing = target ?? matched.record;
    if (existing) {
      // Keep curated metadata and article-specific credit roles unless a source supplies
      // missing information. Content imports must not silently rewrite attribution.
      candidate = { ...candidate, ...reconcileCredits(existing, candidate), title: existing.title, url: candidate.url ?? existing.url, outlet: existing.outlet ?? candidate.outlet,
        publishedAt: existing.publishedAt, publicationSource: existing.publicationSource, publicationSourceUrl: existing.publicationSourceUrl,
        ...publicationUpdate(existing, candidate), sourceType: existing.sourceType ?? candidate.sourceType };
    }
    candidate.entities = mentionedEntities(`${candidate.title}\n${candidate.fullText ?? ""}`, records.filter(r => r.kind === "watch"));
    if (!candidate.outlet) warnings.push("Publisher was not identified; set it before saving.");
    if (!candidate.byline) warnings.push("No byline identified.");
    if ((candidate.fullText?.length ?? 0) < 250) warnings.push("Only a short passage was available.");
    if (/subscribe to continue|sign in to continue|enable javascript/i.test(candidate.fullText ?? "")) warnings.push("The source may have returned an access page rather than the full article.");
    if (existing?.fullText && existing.fullText.length > (candidate.fullText?.length ?? 0) && !prefersIncomingContent(existing, candidate)) warnings.push("Existing longer article text will be kept unless you confirm this replacement is complete. This import is retained as a separate capture.");
    const draftId = crypto.randomUUID();
    const articleId = existing?.id ?? crypto.randomUUID();
    candidate.retainedContent = [capture];
    const archivedCandidate = await archiveArticle(candidate);
    await db.insert(tripwireRecords).values({ id: `draft:${draftId}`, owner: userId, kind: "import-draft", data: { candidate: archivedCandidate, articleId, matchedId: existing?.id, capture: archivedCandidate.retainedContent?.[0], source } });
    res.json(AnalyzeImportResponse.parse({ draftId, candidate, matchedId: existing?.id, matchReason: target ? "Selected article" : matched.reason, warnings, characterCount: candidate.fullText?.length ?? 0, source }));
  } catch (error) {
    req.log.warn({ err: error instanceof Error ? error.message : "Intake error" }, "Import analysis failed");
    res.status(error instanceof IntakeError ? error.status : 400).json({ error: error instanceof Error ? error.message : "Could not analyze this content" });
  } finally { inFlight.delete(userId); }
});

router.post("/tripwire/imports/commit", async (req, res) => {
  try {
    const userId = workspaceIdentity(req).userId;
    const body = CommitImportBody.parse(req.body);
    if (!body.title.trim()) throw new IntakeError("A headline is required");
    const url = body.url?.trim() ? canonicalUrl(body.url) : undefined;
    if (body.publishedAt && isNaN(Date.parse(body.publishedAt))) throw new IntakeError("Enter a valid publication date");
    const record = await db.transaction(async tx => {
      const [draft] = await tx.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, `draft:${body.draftId}`), eq(tripwireRecords.owner, userId), eq(tripwireRecords.kind, "import-draft"))).for("update");
      if (!draft) throw new IntakeError("Import preview not found", 404);
      const records = await recordsFor(userId);
      const previous = draft.data.committedId ? records.find(r => r.id === draft.data.committedId) : undefined;
      if (previous) return previous;
      if (draft.data.committedId) throw new IntakeError("This import was already saved and its article has since been removed", 409);
      if (Date.now() - draft.createdAt.getTime() > 24 * 3600000) throw new IntakeError("This preview has expired. Analyze the content again.", 409);
      const [candidate] = await hydrateArticles([draft.data.candidate as RecordData]);
      let existing = draft.data.matchedId ? records.find(r => r.id === draft.data.matchedId && r.kind === "article") : undefined;
      if (draft.data.matchedId && !existing) throw new IntakeError("The matching article was removed. Analyze again.", 409);
      const finalMetadata = { title: body.title.trim(), outlet: body.outlet?.trim() || undefined, url };
      const match = matchImport(finalMetadata, records);
      if (match.ambiguous) throw new IntakeError("Multiple articles match these details. Open the intended item and enrich it there.", 409);
      if (existing && match.record && match.record.id !== existing.id) throw new IntakeError("These details identify another article. Analyze it separately.", 409);
      existing ??= match.record;
      const keepBody = !!existing?.fullText && !prefersIncomingContent(existing, { ...candidate, fullTextComplete: body.fullTextComplete ?? false });
      const oldCapture = existing?.fullText ? [captureContent(existing.fullText, "previous article text")] : [];
      const retainedContent = mergeCaptures(existing?.retainedContent, oldCapture, candidate.retainedContent);
      const byline = body.byline?.trim() || undefined;
      const bylineChanged = byline !== existing?.byline;
      const reviewed = byline ? parseByline(byline) : [];
      const matchesSource = byline === candidate.byline;
      const credits = matchesSource ? candidate.credits ?? reviewed : bylineChanged
        ? [...reviewed, ...(candidate.credits ?? existing?.credits ?? []).filter(c => c.role !== "author" && !reviewed.some(r => r.name === c.name))]
        : existing?.credits ?? candidate.credits;
      const data: RecordData = { ...candidate, ...existing, ...mergeClassification(existing ?? {}, candidate), id: existing?.id ?? String(draft.data.articleId), kind: "article", ...finalMetadata,
        discoveryOnly: existing?.discoveryOnly ? !url || !publisherUrl(url, finalMetadata.outlet ?? "") : false,
        byline, credits, journalists: credits?.filter(c => c.role === "author").map(c => c.name) ?? [],
        publishedAt: body.publishedAt || undefined,
        publicationSource: body.publishedAt ? (Date.parse(body.publishedAt) === Date.parse(candidate.publishedAt ?? "") ? candidate.publicationSource ?? "manual" : "manual") : undefined,
        publicationSourceUrl: body.publishedAt && Date.parse(body.publishedAt) === Date.parse(candidate.publishedAt ?? "") ? candidate.publicationSourceUrl : undefined,
        sourceType: body.sourceType ?? candidate.sourceType,
        fullText: keepBody ? existing?.fullText : candidate.fullText, fullTextComplete: keepBody ? existing?.fullTextComplete : body.fullTextComplete ?? false,
        contentNormalization: keepBody ? existing?.contentNormalization : candidate.contentNormalization,
        summary: keepBody ? existing?.summary : candidate.summary ?? existing?.summary,
        topic: keepBody ? existing?.topic : candidate.topic ?? existing?.topic,
        entities: keepBody ? existing?.entities : candidate.entities ?? existing?.entities,
        retainedContent, contentRetained: true, retainedCharacters: Math.max(...retainedContent.map(c => c.text?.length ?? c.textLength ?? 0)) };
      const saved = await writeRecord(userId, data);
      await tx.update(tripwireRecords).set({ data: { ...draft.data, committedId: saved.id }, updatedAt: new Date() }).where(and(eq(tripwireRecords.id, draft.id), eq(tripwireRecords.owner, userId)));
      return saved;
    });
    res.json(CommitImportResponse.parse(record));
  } catch (error) {
    req.log.warn({ err: error instanceof Error ? error.message : "Commit error" }, "Import save failed");
    res.status(error instanceof IntakeError ? error.status : 400).json({ error: error instanceof Error ? error.message : "Could not save this import" });
  }
});

router.get("/tripwire/imports/uploads/:id/file", async (req, res) => {
  const userId = workspaceIdentity(req).userId;
  const [upload] = await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, `upload:${req.params.id}`), eq(tripwireRecords.owner, userId), eq(tripwireRecords.kind, "upload")));
  if (!upload?.data.archiveId) { res.status(404).json({ error: "Original document not found" }); return; }
  const file = privateFile(String(upload.data.archiveId));
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(String(upload.data.name))}`);
  res.type("application/octet-stream");
  file.createReadStream().on("error", () => { if (!res.headersSent) res.status(404).json({ error: "Original document is unavailable" }); else res.destroy(); }).pipe(res);
});
export default router;
