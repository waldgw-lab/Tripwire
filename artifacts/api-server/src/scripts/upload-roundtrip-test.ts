// Exercises a temporary upload/preview only. Never commits an article or calls AI.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db, pool, tripwireRecords } from "@workspace/db";
import { privateFile } from "../lib/tripwire-files";
import { z } from "zod";

const root = `https://${process.env.REPLIT_DEV_DOMAIN}/api/tripwire`;
let uploadId: string | undefined;
let draftId: string | undefined;
async function json(path: string, body: unknown) {
  const response = await fetch(`${root}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}
try {
  const bytes = await readFile("/tmp/tripwire-upload-check.docx");
  const upload = z.object({ uploadId: z.string(), uploadUrl: z.string() }).parse(await json("/imports/uploads", {
    name: "tripwire-upload-verification.docx", size: bytes.length,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }));
  uploadId = upload.uploadId;
  const put = await fetch(upload.uploadUrl, {
    method: "PUT", headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    body: new Uint8Array(bytes).buffer,
  });
  assert.ok(put.ok, `Object upload: HTTP ${put.status}`);
  const preview = z.object({ draftId: z.string() }).parse(await json("/imports/analyze", { uploadId }));
  draftId = preview.draftId;
  assert.ok(draftId, "Upload must produce a reviewable draft");
  const original = await fetch(`${root}/imports/uploads/${uploadId}/file`);
  assert.ok(original.ok, `Original file: HTTP ${original.status}`);
  assert.ok(bytes.equals(Buffer.from(await original.arrayBuffer())), "Retained original must match uploaded bytes exactly");
  console.log("PASS live DOCX upload, document parsing, preview and byte-identical original download; no article commit");
} finally {
  if (draftId) await db.delete(tripwireRecords).where(and(eq(tripwireRecords.id, `draft:${draftId}`), eq(tripwireRecords.owner, "workspace"), eq(tripwireRecords.kind, "import-draft")));
  if (uploadId) {
    const [row] = await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, `upload:${uploadId}`), eq(tripwireRecords.owner, "workspace"), eq(tripwireRecords.kind, "upload")));
    if (row) {
      for (const id of new Set([row.data.objectId, row.data.archiveId].filter((v): v is string => typeof v === "string")))
        await privateFile(id).delete({ ignoreNotFound: true });
      await db.delete(tripwireRecords).where(and(eq(tripwireRecords.id, row.id), eq(tripwireRecords.owner, "workspace"), eq(tripwireRecords.kind, "upload")));
    }
  }
  await pool.end();
}
