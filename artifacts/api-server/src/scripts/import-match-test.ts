// Integration regression in a private, isolated owner. Never seed the shared
// feed or call a model. All test records and drafts are removed in finally.
import assert from "node:assert/strict";
import { db, tripwireRecords } from "@workspace/db";
import { eq } from "drizzle-orm";
import { analyzeImport, commitImport } from "../routes/tripwire-imports";
import { recordsFor, writeRecord } from "../lib/tripwire-store";
const owner = `isolated-import-test-${crypto.randomUUID()}`;
const title = `Isolated article ${crypto.randomUUID()}`;
const firstUrl = `https://example.com/${crypto.randomUUID()}/first`;
const body = `${title}\n${firstUrl}\nBy Mira Vale\n\n${"This isolated fixture checks retained article content and explicit destination choices without changing shared news records. ".repeat(8)}`;
try {
  const first = await writeRecord(owner, { id: crypto.randomUUID(), kind: "article", title, url: firstUrl, outlet: "Isolated test", fullText: body });
  const draft = await analyzeImport(owner, { text: body, targetId: first.id });
  assert.equal(draft.matchedId, first.id);
  const updated = await commitImport(owner, { draftId: draft.draftId, title, url: firstUrl, matchAction: "update" });
  assert.equal(updated.id, first.id);
  const separate = await analyzeImport(owner, { text: body, targetId: first.id });
  await assert.rejects(commitImport(owner, { draftId: separate.draftId, title, url: firstUrl, matchAction: "create" }), /source URL already belongs/);
  const secondUrl = `https://example.com/${crypto.randomUUID()}/second`;
  const created = await commitImport(owner, { draftId: separate.draftId, title: `${title} distinct`, url: secondUrl, matchAction: "create" });
  assert.notEqual(created.id, first.id, "Create must never reuse the matched article ID");
  assert.equal(created.url, secondUrl);
  const rows = await recordsFor(owner);
  assert.equal(rows.find(r => r.id === first.id)?.url, firstUrl, "Creating must leave the original untouched");
  const shared = await recordsFor("workspace");
  assert.ok(!shared.some(r => r.id === first.id || r.id === created.id), "Fixtures cannot leak into the shared feed");
  console.log("PASS: explicit update, same-URL duplicate rejection, distinct creation, original preserved, shared-feed isolation");
} finally {
  await db.delete(tripwireRecords).where(eq(tripwireRecords.owner, owner));
}
process.exit(0);
