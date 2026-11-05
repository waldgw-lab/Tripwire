import test from "node:test";
import assert from "node:assert/strict";
import { classifyContent, mergeClassification } from "../artifacts/api-server/src/lib/tripwire-classification.ts";
import { captureContent, mergeArticleContent } from "../artifacts/api-server/src/lib/tripwire-content.ts";

for (const [schema, expected] of [["NewsArticle","news"], ["OpinionNewsArticle","opinion"], ["AnalysisNewsArticle","analysis"], ["BackgroundNewsArticle","explainer"], ["ReviewNewsArticle","review"]]) {
  test(`publisher schema ${schema}`, () => assert.equal(classifyContent({schemaTypes:[schema]}).contentType, expected));
}
for (const [segment, expected] of [["opinion","opinion"],["editorials","editorial"],["analysis","analysis"],["interview","interview"],["commentary","commentary"],["fact-check","fact-check"],["breakingviews","opinion"]]) {
  test(`exact URL section ${segment}`, () => assert.equal(classifyContent({url:`https://example.org/${segment}/story`}).contentType,expected));
}
test("no genre guess from tone, names, slug keywords, or URL query", () => {
  assert.equal(classifyContent({url:"https://example.org/news/opinion-about-policy?section=opinion",title:"An angry opinion about an editorial decision"}).contentType,"unclassified");
});
test("specific section outranks generic NewsArticle schema", () => {
  const c=classifyContent({url:"https://example.org/opinion/story",schemaTypes:["NewsArticle"]});
  assert.equal(c.contentType,"opinion"); assert.equal(c.classificationEvidence.length,2);
});
test("editorial board label outranks Opinion section", () => assert.equal(classifyContent({labels:["Editorial Board"],url:"https://example.org/opinion/item"}).contentType,"editorial"));
test("live updates are a format separate from genre", () => {
  const c=classifyContent({schemaTypes:["LiveBlogPosting","NewsArticle"]});
  assert.equal(c.contentFormat,"live-updates"); assert.equal(c.contentType,"news");
});
test("video and audio routes are formats, not opinions or original-reporting claims", () => {
  assert.equal(classifyContent({url:"https://example.org/video/item"}).contentFormat,"video");
  assert.equal(classifyContent({url:"https://example.org/podcasts/item"}).contentFormat,"audio");
});
test("plain publisher Article schema is insufficient to claim News", () => assert.equal(classifyContent({schemaTypes:["Article"]}).contentType,"unclassified"));
test("publisher headline prefix, not any headline keyword", () => {
  assert.equal(classifyContent({title:"Analysis: A policy changes"}).contentType,"analysis");
  assert.equal(classifyContent({title:"A new analysis of policy"}).contentType,"unclassified");
});
test("merging generic later evidence cannot downgrade reliable genre", () => {
  const existing=classifyContent({labels:["Editorial Board"]});
  assert.equal(mergeClassification(existing,classifyContent({schemaTypes:["NewsArticle"]})).contentType,"editorial");
});
test("RSS category XML objects are normalized without crashing or coercing unknown objects", () => {
  assert.equal(classifyContent({labels:[{_:"Opinion",$:{domain:"publisher"}},null,42,{}]}).contentType,"opinion");
  assert.equal(classifyContent({labels:[{term:"Analysis"}]}).contentType,"analysis");
});
test("immutable manifests preserve longer canonical body without inline strings", () => {
  const old={fullTextHash:"long-hash",fullTextLength:8809,retainedContent:[{id:"a",source:"rss",capturedAt:"now",bodyHash:"long-hash",textLength:8809}]};
  const merged=mergeArticleContent(old,{fullText:"short",retainedContent:[captureContent("short","page")]});
  assert.equal(merged.fullTextHash,"long-hash"); assert.equal(merged.fullTextLength,8809); assert.equal(merged.retainedContent.length,2);
});
test("longer enrichment replaces partial canonical but keeps older capture", () => {
  const merged=mergeArticleContent({fullTextHash:"old",fullTextLength:5},{fullText:"a much longer fetched passage"});
  assert.equal(merged.fullText,"a much longer fetched passage"); assert.equal(merged.fullTextHash,undefined);
});
test("confirmed complete replacement can update previously complete text", () => {
  const merged=mergeArticleContent({fullText:"old complete text",fullTextComplete:true},{fullText:"new text",fullTextComplete:true});
  assert.equal(merged.fullText,"new text");
});
