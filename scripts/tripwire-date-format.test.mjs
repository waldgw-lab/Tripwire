import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate } from '../artifacts/tripwire/src/lib/date-format.ts';
const now = new Date('2026-11-08T15:00:00Z');
test('dates use unpadded days, uppercase short months, and only non-current years', () => {
  assert.equal(formatDate('2026-11-08', false, now), '8 NOV');
  assert.equal(formatDate('2025-11-08', false, now), '8 NOV 2025');
  assert.equal(formatDate('2027-11-08', false, now), '8 NOV 2027');
  assert.equal(formatDate('2026-11-18', false, now), '18 NOV');
});
test('calendar dates do not move backward or invent a time', () => {
  assert.equal(formatDate('2026-11-08', true, now), '8 NOV');
  assert.equal(formatDate('November 8, 2026', false, now), '8 NOV');
  assert.equal(formatDate('8 November 2025', false, now), '8 NOV 2025');
});
test('timestamps preserve Eastern dates, DST and midnight', () => {
  assert.equal(formatDate('2026-11-08T02:30:00Z', true, now), '7 NOV · 21:30 ET');
  assert.equal(formatDate('2026-11-08T05:00:00Z', true, now), '8 NOV · 00:00 ET');
  assert.equal(formatDate('2026-07-08T14:00:00Z', true, now), '8 JUL · 10:00 ET');
});
test('current year follows Eastern time across New Year', () => {
  const rollover = new Date('2027-01-01T02:00:00Z');
  assert.equal(formatDate('2027-01-01T01:00:00Z', false, rollover), '31 DEC');
  assert.equal(formatDate('2027-01-01T05:00:00Z', false, rollover), '1 JAN 2027');
});
test('missing, unknown and incomplete dates do not invent a date', () => {
  assert.equal(formatDate(null, false, now), '—');
  assert.equal(formatDate('date unknown', false, now), 'date unknown');
  assert.equal(formatDate('2026-11', false, now), '2026-11');
});
