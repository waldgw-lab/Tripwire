import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedPublication, feedByline, impactTextColor } from '../artifacts/tripwire/src/lib/feed-format.ts';

const now = new Date('2026-11-05T15:00:00Z');
test('current-year feed date omits year and clock is colonless Eastern time', () => {
  assert.deepEqual(feedPublication('2026-11-05T14:18:33Z', now), { date: '05 NOV', time: '0918', label: '05 NOV · 0918' });
});
test('older feed date includes year', () => {
  assert.equal(feedPublication('2025-12-05T14:18:00Z', now).label, '05 DEC 2025 · 0918');
});
test('Eastern year comparison works across UTC New Year', () => {
  const newYearUTC = new Date('2027-01-01T02:00:00Z');
  assert.equal(feedPublication('2027-01-01T01:30:00Z', newYearUTC).label, '31 DEC · 2030');
  assert.equal(feedPublication('2026-01-01T05:30:00Z', newYearUTC).label, '01 JAN · 0030');
});
test('daylight time and midnight use correct four-digit clock', () => {
  assert.equal(feedPublication('2026-07-05T14:18:00Z', now).time, '1018');
  assert.equal(feedPublication('2026-11-05T05:00:00Z', now).time, '0000');
});
test('unknown publication remains unknown rather than substituting intake time', () => {
  assert.equal(feedPublication(undefined, now).label, 'Publication time unknown');
});
test('single author retains middle initials and suffix', () => {
  assert.equal(feedByline([{ name: 'Jane A. Doe', role: 'author' }]), 'Jane A. Doe');
  assert.equal(feedByline([{ name: 'Martin Luther King, Jr.', role: 'author' }]), 'Martin Luther King, Jr.');
});
test('multiple credits use comma-separated surnames, preserving compound surnames', () => {
  assert.equal(feedByline([{ name: 'Jane A. Doe', role: 'author' }, { name: 'John Smith III', role: 'author' }, { name: 'Maria de la Cruz', role: 'contributor' }]), 'Doe, Smith, de la Cruz');
});
test('multiple roles for one person do not duplicate the compact byline', () => {
  assert.equal(feedByline([{ name: 'Jane Doe', role: 'author' }, { name: 'Jane Doe', role: 'reporting' }]), 'Jane Doe');
  assert.equal(feedByline([]), '');
});
test('impact uses dark text colors without chip backgrounds', () => {
  assert.deepEqual(impactTextColor, { critical: 'text-[#8b1e22]', high: 'text-[#98410f]', low: 'text-[#806400]' });
});
