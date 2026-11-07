import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePublisherCopy } from '../artifacts/api-server/src/lib/tripwire-paste.ts';
import { prefersIncomingContent } from '../artifacts/api-server/src/lib/tripwire-content.ts';

const cnn = fs.readFileSync(new URL('../attached_assets/Pasted-US-attorney-overseeing-Trump-s-grand-conspiracy-probe-i_1793980740124.txt', import.meta.url), 'utf8');
const nyt = fs.readFileSync(new URL('../attached_assets/Pasted-U-S-Attorney-Who-Oversaw-Centerpiece-of-Trump-s-Revenge_1793980693108.txt', import.meta.url), 'utf8');

test('CNN linked byline names are deduplicated and photography stays separate', () => {
  const copy = parsePublisherCopy(cnn);
  assert.equal(copy.outlet, 'CNN');
  assert.deepEqual(copy.credits.filter(c => c.role === 'author').map(c => c.name), ['Hannah Rabinowitz', 'Evan Perez']);
  assert.deepEqual(copy.credits.filter(c => c.role === 'photography').map(c => c.name), ['Brendan McDermid']);
  assert.equal(copy.contentNormalization.method, 'publisher-copy:cnn');
  assert.equal(copy.contentNormalization.sourceCharacters, cnn.length);
});
test('CNN removes duplicate captions and the linked recommendation, but preserves following reporting', () => {
  const copy = parsePublisherCopy(cnn);
  assert.ok(copy.text.startsWith('Jason Reding Quiñones, the senior federal prosecutor'));
  assert.ok(copy.text.endsWith('according to people familiar with matter.'));
  for (const unwanted of ['35 min ago', 'Related article', '9 min read', 'Alex Wong', 'Brendan McDermid/Reuters/FILE', 'House Permanent Select Committee']) {
    assert.equal(copy.text.includes(unwanted), false, unwanted);
  }
  assert.ok(copy.text.includes('a sprawling investigation into President Donald Trump'));
  assert.ok(copy.text.includes('Attorney General Todd Blanche announced'));
  assert.ok(copy.text.includes('a social media post Friday'));
  assert.ok(copy.text.includes('\n\n'));
  assert.equal(copy.text.includes('](https://'), false);
});
const paragraphs = ['The prosecutor resigned after department leaders expressed frustration with the investigation and its lack of progress.',
  'Officials said the departure surprised colleagues in the office, who had expected the prosecutor to remain in his position.'];
const plain = [
  'Federal prosecutor resigns after a contentious investigation',
  'By', 'Hannah Rabinowitz', 'Hannah Rabinowitz', ',', 'Evan Perez', 'Evan Perez', '35 min ago',
  'The prosecutor at a news conference.', 'The prosecutor at a news conference. Brendan McDermid/Reuters/FILE',
  paragraphs[0], 'Related article', 'A separate image caption.', 'Another article about an investigation', '9 min read', paragraphs[1],
].join('\n\n');
test('plain clipboard copies remove bounded related cards without losing the next paragraph', () => {
  const copy = parsePublisherCopy(plain, undefined, 'CNN');
  assert.deepEqual(copy.credits.filter(c => c.role === 'author').map(c => c.name), ['Hannah Rabinowitz', 'Evan Perez']);
  assert.equal(copy.text, paragraphs.join('\n\n'));
});
test('an ambiguous related block never truncates the rest of a story', () => {
  const copy = parsePublisherCopy(plain.replace('9 min read', 'An unfamiliar recommendation layout'), undefined, 'CNN');
  assert.ok(copy.text.includes('Related article'));
  assert.ok(copy.text.endsWith(paragraphs[1]));
});
test('NYT copied metadata is removed while all three explicit authors and reporting remain', () => {
  const copy = parsePublisherCopy(nyt);
  assert.equal(copy.outlet, 'The New York Times');
  assert.deepEqual(copy.credits.map(c => c.name), ['Devlin Barrett', 'Glenn Thrush', 'Alan Feuer']);
  assert.equal(copy.contentNormalization.method, 'publisher-copy:nytimes');
  assert.ok(copy.text.startsWith('WASHINGTON — The U.S. attorney'));
  assert.ok(copy.text.endsWith('is seeking to have the case dismissed.'));
  assert.equal(copy.text.includes('Nov 6 • 10:34 AM'), false);
  assert.equal(copy.text.includes('nytimes.com/'), false);
  assert.ok(copy.text.includes('John O. Brennan, the former C.I.A. director'));
  assert.ok(copy.text.includes('he left under pressure in September.'));
});
test('relative CNN times and yearless/zoneless NYT display times do not invent publication dates', () => {
  assert.equal(parsePublisherCopy(cnn).publishedAt, undefined);
  assert.equal(parsePublisherCopy(nyt).publishedAt, undefined);
});
test('unrecognized layouts remain untouched', () => {
  const unrecognized = 'An article without an identifiable byline\n\n' + paragraphs.join('\n\n');
  assert.equal(parsePublisherCopy(unrecognized, undefined, 'CNN').text, unrecognized);
  assert.equal(parsePublisherCopy(unrecognized, undefined, 'The New York Times').contentNormalization, undefined);
});
test('a bounded cleaner can replace a longer unnormalized copy without losing confirmed completeness', () => {
  for (const raw of [cnn, nyt]) {
    const copy = parsePublisherCopy(raw);
    assert.equal(prefersIncomingContent({ fullText: raw, fullTextComplete: true }, {
      fullText: copy.text, fullTextComplete: true, contentNormalization: copy.contentNormalization,
    }), true);
  }
});
