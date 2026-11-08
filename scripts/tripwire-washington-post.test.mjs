import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textCandidate, documentCandidate } from '../artifacts/api-server/src/lib/tripwire-import.ts';
import { reviewedContributors } from '../artifacts/api-server/src/lib/tripwire-bylines.ts';
import { prefersIncomingContent, mergeArticleContent, captureContent } from '../artifacts/api-server/src/lib/tripwire-content.ts';

const raw = readFileSync(new URL('../attached_assets/Pasted-Trump-s-foes-abroad-question-whether-midterm-loss-will-_1793976276415.txt', import.meta.url), 'utf8');
const article = textCandidate(raw);
const names = ['Steve Hendrix', 'Natalia Abbakumova', 'Suzan Haidamous', 'Mohamad El Chamaa', 'Rudy Lu', 'Greg Miller'];
test('Washington Post paste identifies publisher, complete byline and original EST time', () => {
  assert.equal(article.outlet, 'The Washington Post');
  assert.deepEqual(article.journalists, ['Mary Ilyushina', 'Gerry Shih']);
  assert.equal(article.publishedAt, '2026-11-04T15:27:00.000Z');
  assert.equal(article.contentNormalization.method, 'publisher-copy:washington-post');
  assert.match(article.summary, /^As other nations wonder/);
});
test('all six contributors are separate article credits with original wording', () => {
  assert.deepEqual(article.credits.filter(c => c.role === 'contributor').map(c => c.name), names);
  assert.ok(article.credits.filter(c => c.role === 'contributor').every(c => c.attribution.endsWith('contributed to this report.')));
  assert.doesNotMatch(article.fullText, /contributed to this report/);
});
test('page controls, AI prompts, recommendations and duplicated header leave the article body', () => {
  assert.ok(article.fullText.startsWith('Capitals from Kyiv to Tehran'));
  assert.ok(article.fullText.endsWith('a more stable relationship.'));
  assert.doesNotMatch(article.fullText, /Most Read|Dive deeper|Ask The Post AI|More article actions|Chevron right|Corporate America courted|George F\. Will|Jay Rockefeller|9 min|November 6, 2026|By Mary Ilyushina/);
  for (const heading of ['Implications for war in the Middle East', 'Europe considers a weakened Trump', 'Measured reactions in Asia']) assert.ok(article.fullText.includes(`\n\n${heading}\n\n`));
  assert.match(article.fullText, /Those differences have come into starker relief/);
  assert.match(article.fullText, /That’s not up for debate/);
});
test('unknown recommendation boundaries are retained rather than clipping following reporting', () => {
  const copy = textCandidate(raw.replace('Most Read', 'A different feature'));
  assert.match(copy.fullText, /Corporate America courted/);
  assert.match(copy.fullText, /Those differences have come/);
});
test('struck-up DOCX uses the same analyzer and produces the same article paragraphs', async () => {
  const doc = await documentCandidate(readFileSync(new URL('../attached_assets/Text_to_clean_up_1793976735748.docx', import.meta.url)), 'cleanup.docx');
  assert.equal(doc.candidate.fullText, article.fullText);
  assert.deepEqual(doc.candidate.credits, article.credits);
});
test('print PDF retains paragraph layout, separates credits and omits reader-comment summaries', async () => {
  const doc = await documentCandidate(readFileSync(new URL('../attached_assets/Trump’s_foes_abroad_question_if_midterm_loss_will_weaken_or_em_1793976867271.pdf', import.meta.url)), 'article.pdf');
  assert.equal(doc.candidate.outlet, 'The Washington Post');
  assert.equal(doc.candidate.title, article.title);
  assert.deepEqual(doc.candidate.journalists, article.journalists);
  assert.deepEqual(doc.candidate.credits.filter(c => c.role === 'contributor').map(c => c.name), names);
  assert.doesNotMatch(doc.candidate.fullText, /What readers are saying|AI-generated|comments reflect/);
  const normalized = s => s.replace(/\s+/g, ' ').trim();
  assert.equal(normalized(doc.candidate.fullText), normalized(article.fullText));
  // A print date without a clock is not a precise publication timestamp.
  assert.equal(doc.candidate.publishedAt, undefined);
});
test('contributor review supports keeping, adding and clearing names without changing primary authors', () => {
  assert.deepEqual(reviewedContributors(article.credits), article.credits);
  const kept = reviewedContributors(article.credits, names.join(', '));
  assert.deepEqual(kept, article.credits);
  const cleared = reviewedContributors(article.credits, '');
  assert.equal(cleared.length, 2);
  assert.ok(cleared.every(c => c.role === 'author'));
  const changed = reviewedContributors(article.credits, 'Steve Hendrix, New Reporter');
  assert.deepEqual(changed.filter(c => c.role === 'contributor').map(c => c.name), ['Steve Hendrix', 'New Reporter']);
});
test('bounded cleanup repairs a confirmed unclean copy while preserving raw source history', () => {
  const original = captureContent(raw, 'paste');
  const old = { fullText: raw, fullTextComplete: true, retainedContent: [original] };
  assert.ok(prefersIncomingContent(old, article));
  const merged = mergeArticleContent(old, { ...article, retainedContent: [captureContent(article.fullText, 'paste:cleaned', { raw })] });
  assert.equal(merged.fullText, article.fullText);
  assert.equal(merged.retainedContent[0].raw, undefined);
  assert.equal(merged.retainedContent[0].text, raw);
  assert.equal(merged.retainedContent[1].raw, raw);
  assert.equal(merged.fullTextComplete, false);
});
test('section-specific Most Read widgets are bounded; the Hegseth PDF keeps every reporting paragraph and contributor', async () => {
  const pdf = await documentCandidate(readFileSync(new URL('../attached_assets/Hegseth_draws_fire_after_government_resources_used_for_partisa_1794148608665.pdf', import.meta.url)), 'hegseth.pdf');
  const original = pdf.candidate;
  assert.equal(original.title, 'Hegseth draws fire after using government resources for partisan video');
  assert.deepEqual(original.journalists, ['Tara Copp']);
  assert.deepEqual(original.credits.filter(c => c.role === 'contributor').map(c => c.name), ['Noah Robertson']);
  const paragraphs = original.fullText.split('\n\n');
  assert.ok(paragraphs.length > 12);
  const cards = [
    'Next',
    'Potential Vance challengers smell blood in the water after brutal GOP losses',
    'Potential Vance challengers smell blood in the water after brutal GOP losse...',
    'November 8, 2026',
    'Column', 'Carolyn Hax',
    'Carolyn Hax: She says no to angry in-law at holidays. Her husband is distraught.',
    'Carolyn Hax: She says no to angry in-law at holidays. Her husband is distra...',
    'November 8, 2026',
  ];
  for (const heading of ['Most Read', 'Most Read in Military', 'Most Read in National Security']) {
    const raw = [original.title, original.summary, 'November 6, 2026 at 6:50 p.m. ESTNovember 6, 2026',
      '5 min', 'Summary', 'Military', 'Chevron right', 'More article actions', 'By Tara  Copp', ...paragraphs.slice(0, 8), heading, ...cards,
      ...paragraphs.slice(8), 'Noah Robertson contributed to this report.'].join('\n\n');
    const cleaned = textCandidate(raw, undefined, 'The Washington Post');
    assert.equal(cleaned.fullText, original.fullText, heading);
    assert.deepEqual(cleaned.journalists, ['Tara Copp']);
    assert.deepEqual(cleaned.credits.filter(c => c.role === 'contributor').map(c => c.name), ['Noah Robertson']);
    assert.match(cleaned.fullText, /Hegseth has used the Pentagon’s resources before/);
    assert.match(cleaned.fullText, /what the strategy is moving forward/);
    const dashboard = textCandidate(raw);
    assert.equal(dashboard.outlet, 'The Washington Post');
    assert.equal(dashboard.fullText, cleaned.fullText);
    const incompleteHeader = textCandidate(raw.replace('More article actions', 'Other controls'));
    assert.equal(incompleteHeader.contentNormalization, undefined);
    assert.match(incompleteHeader.fullText, /Most Read/);
    const otherPublisher = textCandidate(raw, 'https://www.reuters.com/world/example/');
    assert.equal(otherPublisher.contentNormalization, undefined);
    assert.equal(otherPublisher.outlet, 'Reuters');
    assert.match(otherPublisher.fullText, /Most Read/);
    const incomplete = textCandidate(raw.replace(cards.slice(4).join('\n\n'), ''), undefined, 'The Washington Post');
    assert.match(incomplete.fullText, /Most Read/); // One card alone cannot establish a safe boundary.
    assert.match(incomplete.fullText, /what the strategy is moving forward/);
  }
});
