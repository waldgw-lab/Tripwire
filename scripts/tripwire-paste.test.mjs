import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePublisherCopy, pasteSourceUrl, publicationFromCopy, reconcileCredits } from "../artifacts/api-server/src/lib/tripwire-paste.ts";
import { mentionsTerm, mentionedEntities, inferArticleTopic } from "../artifacts/api-server/src/lib/tripwire-signals.ts";
import { mergeArticleContent, captureContent, prefersIncomingContent } from "../artifacts/api-server/src/lib/tripwire-content.ts";

const raw = readFileSync("attached_assets/Pasted--Vance-takes-a-step-toward-2028-in-MAGA-power-play-http_1793898898748.txt", "utf8");
const parsed = parsePublisherCopy(raw);
test("Axios paste: exact headline, canonical source and all three primary bylines", () => {
  assert.equal(parsed.title, "Vance takes a step toward 2028 in MAGA power play");
  assert.equal(pasteSourceUrl(raw), "https://www.axios.com/2026/11/05/vance-maga-power-play-2028");
  assert.deepEqual(parsed.credits.filter(c => c.role === "author").map(c => c.name), ["Zachary Basu", "Marc Caputo", "Alex Isenstadt"]);
  assert.equal(parsed.publishedAt, "2026-11-05T10:31:00.000Z");
  assert.equal(parsed.section, "Politics & Policy");
});
test("Axios paste: article boundaries exclude masthead, navigation, promo and footer", () => {
  assert.ok(parsed.text.startsWith("Vice President Vance stepped"));
  assert.ok(parsed.text.endsWith('the state of Florida."'));
  assert.doesNotMatch(parsed.text, /opens in new window|Add Axios|What to read next|Photo illustration:|Getty Images|https:\/\//);
  for (const section of ["Why it matters:", "Zoom in:", "What they're saying:", "Behind the scenes:", "Zoom out:", "By the numbers:", "The intrigue:", "Between the lines:", "What to watch:"])
    assert.ok(parsed.text.includes(`\n\n${section}`), section);
  assert.ok(parsed.text.includes("💯 💯 💯"));
  assert.ok(parsed.text.length > 5000);
  assert.equal(parsed.contentNormalization.sourceCharacters, raw.length);
  assert.equal(parsed.contentNormalization.articleCharacters, parsed.text.length);
});
test("Photo/illustration credits remain separate from the three authors", () => {
  assert.deepEqual(parsed.credits.filter(c => c.role !== "author").map(c => [c.name, c.role]), [["Aïda Amer", "other"], ["Tom Brenner", "photography"]]);
  assert.match(parsed.credits.find(c => c.name === "Tom Brenner").attribution, /Getty Images/);
});
test("Ambiguous publisher copy does not guess article boundaries or harvest names from prose", () => {
  const text = "[Example](https://axios.com/example)\nA story mentioned Marc Caputo and Alex Isenstadt.";
  const p = parsePublisherCopy(text);
  assert.equal(p.text, text);
  assert.equal(p.credits, undefined);
  assert.equal(p.contentNormalization, undefined);
});
test("Unsupported photo boundaries keep original source rather than clipping unknown prose", () => {
  const text = raw.replace("Getty Images", "Unrecognized Provider");
  assert.equal(parsePublisherCopy(text).text, text);
});
test("ET publication times follow DST; explicit EST/EDT offsets stay explicit", () => {
  assert.equal(publicationFromCopy("Axios · Jul 5, 2026, 5:31 AM ET"), "2026-07-05T09:31:00.000Z");
  assert.equal(publicationFromCopy("Axios · Jul 5, 2026, 5:31 AM EST"), "2026-07-05T10:31:00.000Z");
  assert.equal(publicationFromCopy("Published: 2026-11-05T10:31:00Z"), "2026-11-05T10:31:00.000Z");
});
test("A more complete observed byline augments RSS attribution without dropping separate reporting credits", () => {
  const result = reconcileCredits({ byline: "Zachary Basu", credits: [{ name: "Zachary Basu", role: "author" }, { name: "Example Reporter", role: "reporting", attribution: "Additional reporting by Example Reporter" }] }, parsed);
  assert.equal(result.byline, parsed.byline);
  assert.deepEqual(result.journalists, ["Zachary Basu", "Marc Caputo", "Alex Isenstadt"]);
  assert.ok(result.credits.some(c => c.name === "Example Reporter" && c.role === "reporting"));
  assert.equal(result.credits.filter(c => c.name === "Zachary Basu").length, 1);
});
test("Incomplete byline does not erase existing coauthors", () => {
  const result = reconcileCredits(parsed, { byline: "Zachary Basu", credits: [{ name: "Zachary Basu", role: "author" }] });
  assert.equal(result.journalists.length, 3);
});
test("Clean article replaces a longer dirty copy without claiming completeness; all raw captures survive", () => {
  const original = captureContent(raw, "paste");
  const cleaned = captureContent(parsed.text, "paste", { raw });
  const merged = mergeArticleContent({ fullText: raw, retainedContent: [original] }, { fullText: parsed.text, contentNormalization: parsed.contentNormalization, retainedContent: [cleaned], fullTextComplete: false });
  assert.equal(merged.fullText, parsed.text);
  assert.equal(merged.fullTextComplete, false);
  assert.ok(merged.retainedContent.some(c => c.raw === raw));
  assert.equal(merged.retainedContent.length, 2);
  assert.equal(mergeArticleContent(merged, { fullText: raw }).fullText, parsed.text);
});
test("An ordinary short partial paste cannot displace a longer article", () => {
  assert.equal(prefersIncomingContent({ fullText: raw }, { fullText: "Only a brief excerpt" }), false);
  assert.equal(prefersIncomingContent({ fullText: raw, fullTextComplete: true }, { fullText: "Only a brief excerpt" }), false);
  assert.equal(prefersIncomingContent({ fullTextHash: "stored", fullTextLength: 100 }, { fullTextHash: "stored", fullTextLength: 100, fullTextComplete: true }), true);
});
test("Bounded publisher cleanup can repair a confirmed copy containing page controls", () => {
  assert.equal(prefersIncomingContent({ fullText: raw, fullTextComplete: true }, { fullText: parsed.text, contentNormalization: parsed.contentNormalization }), true);
});
test("Agency aliases require word boundaries, not substrings inside officials/social/special", () => {
  for (const text of ["officials", "social", "special", "judicial"]) assert.equal(mentionsTerm(text, "CIA"), false, text);
  assert.equal(mentionsTerm("The CIA said", "CIA"), true);
  assert.equal(mentionsTerm("The C.I.A. said", "C.I.A."), true);
  assert.deepEqual(mentionedEntities(parsed.text, [{title:"Intelligence Community", aliases:["CIA"]}]), []);
  assert.equal(inferArticleTopic(parsed.title, parsed.text, parsed.section), "Politics");
  assert.equal(inferArticleTopic("Officials discuss elections", "A special social event"), "Politics");
});
