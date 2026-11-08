import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impactRating, contentStatus, publicationET } from '../artifacts/tripwire/src/lib/article-signals.ts';

const primary = { title: 'Donald Trump', individual: 'Donald Trump', aliases: ['Trump'], watchType: 'position', tier: 1, enabled: true };
const secondary = { title: 'Marco Rubio', aliases: ['Rubio'], watchType: 'position', tier: 2, enabled: true };
test('publication uses Eastern standard time and 24-hour hours', () => {
  assert.equal(publicationET('2026-11-05T14:18:33Z', new Date('2026-11-08T15:00:00Z')).label, '5 NOV · 09:18 ET');
});
test('publication follows Eastern daylight saving time', () => {
  assert.equal(publicationET('2026-07-05T14:18:00Z').time, '10:18 ET');
});
test('midnight and previous-day conversion are correct', () => {
  assert.equal(publicationET('2026-11-05T05:00:00Z').time, '00:00 ET');
  assert.equal(publicationET('2026-11-05T02:30:00Z', new Date('2026-11-08T15:00:00Z')).label, '4 NOV · 21:30 ET');
});
test('unknown publication time does not invent an intake timestamp', () => {
  assert.equal(publicationET().label, 'Publication time unknown');
  assert.equal(publicationET('invalid').label, 'Publication time unknown');
});
test('green requires headline, retained text and explicit completeness', () => {
  assert.equal(contentStatus({ title: 'Headline', fullText: 'Article', fullTextComplete: true }).value, 'complete');
  assert.equal(contentStatus({ title: 'Headline', fullText: 'Excerpt' }).value, 'partial');
  assert.equal(contentStatus({ title: '', fullText: 'Article', fullTextComplete: true }).value, 'partial');
});
test('yellow for summaries or incomplete text; red for metadata only', () => {
  assert.equal(contentStatus({ title: 'Headline', summary: 'Summary' }).value, 'partial');
  assert.equal(contentStatus({ title: 'Headline', fullText: 'Excerpt', fullTextComplete: false }).value, 'partial');
  assert.equal(contentStatus({ title: 'Headline', summary: ' ', fullTextComplete: true }).value, 'minimal');
});
test('names and originality cannot promote impact in the browser', () => {
  assert.equal(impactRating({ title: 'Trump reviews military advice' }, [primary]).value, 'low');
  assert.equal(impactRating({ title: 'New investigation', reportingType: 'original' }, []).value, 'low');
});
test('feed consumes server assessment, not body-only or secondary name matches', () => {
  assert.equal(impactRating({ title: 'Rubio discusses negotiations' }, [secondary]).value, 'low');
  assert.equal(impactRating({ title: 'Negotiations continue', summary: 'Trump met advisers.', automaticAssessment: { impact: 'high', explanation: 'Retained substantive consultation' } }, [primary]).value, 'high');
});
test('disabled watches, unrelated entities and substring matches do not inflate impact', () => {
  assert.equal(impactRating({ title: 'Trump reviews advice' }, [{ ...primary, enabled: false }]).value, 'low');
  assert.equal(impactRating({ title: 'Trumpeter performs', entities: ['Politics'] }, [primary]).value, 'low');
});
test('independent reporting and focus labels do not substitute for consequence evidence', () => {
  assert.equal(impactRating({ title: 'New investigation', reportingType: 'independent' }, []).value, 'low');
  assert.equal(impactRating({ title: 'Leader replaced', focus: 'replacement' }, []).value, 'low');
});
test('analyst overrides take precedence and auto mode recalculates', () => {
  assert.deepEqual(impactRating({ title: 'Trump', impact: 'low' }, [primary]), { value: 'low', reason: 'Analyst-selected impact', manual: true });
  assert.equal(impactRating({ title: 'Trump', impact: undefined, impactMode: 'auto', automaticAssessment: { impact: 'high', explanation: 'Policy assessment' } }, [primary]).value, 'high');
});
