import test from "node:test";
import assert from "node:assert/strict";
import {htmlCandidate,htmlClassification,inferOutlet} from "../artifacts/api-server/src/lib/tripwire-import.ts";

test("Mail US and UK domains share publisher identity",()=>{
  assert.equal(inferOutlet("https://www.dailymail.com/news/article-123/sample.html"),"Daily Mail");
  assert.equal(inferOutlet("https://www.dailymail.co.uk/news/article-123/sample.html"),"Daily Mail");
});
test("Mail article paragraph adapter keeps body instead of structured teaser or related links",()=>{
  const paragraphs=["First retained paragraph. ".repeat(15),"Second retained paragraph. ".repeat(12),"Final marker from the actual article body."];
  const html=`<html><head><title>Verification article</title><script type="application/ld+json">${JSON.stringify({"@type":"NewsArticle",headline:"Verification article",articleBody:"Only a short publisher teaser."})}</script></head><body><div id="js-article-text"><div itemprop="articleBody">${paragraphs.map(t=>`<p class="mol-para-with-font">${t}</p>`).join("")}</div><aside>Unrelated recommendation</aside></div></body></html>`;
  const a=htmlCandidate(html,"https://www.dailymail.com/news/article-123/sample.html");
  assert.equal(a.fullText,paragraphs.map(s=>s.trim()).join("\n\n"));
  assert.equal(a.extractionMethod,"publisher article paragraphs");
  assert.equal(a.contentType,"news");
  assert.ok(!a.fullText.includes("Unrelated recommendation"));
});
test("embedded video does not mislabel written news as Video",()=>{
  const html=`<script type="application/ld+json">${JSON.stringify({"@graph":[{"@type":"NewsArticle"},{"@type":"VideoObject"}]})}</script>`;
  assert.equal(htmlClassification(html,"https://example.org/news/item").contentFormat,"text");
});
test("standalone video schema is primary format",()=>{
  assert.equal(htmlClassification('<script type="application/ld+json">{"@type":"VideoObject"}</script>',"https://example.org/item").contentFormat,"video");
});
test("publisher section outranks generic schema and malformed other scripts do not erase it",()=>{
  const html='<meta property="article:section" content="Editorial Board"><script type="application/ld+json">bad-json</script><script type="application/ld+json">{"@type":"NewsArticle"}</script>';
  const c=htmlClassification(html,"https://example.org/opinion/item");
  assert.equal(c.contentType,"editorial");
  assert.ok(c.classificationEvidence.some(e=>e.value==="Editorial Board"));
});
