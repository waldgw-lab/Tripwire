import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchImport, resolveImportMatch } from '../artifacts/api-server/src/lib/tripwire-import.ts';

const selected = { id: 'selected', kind: 'article', title: 'Earlier publisher headline', outlet: 'CNN', url: 'https://www.cnn.com/2026/11/05/politics/video/earlier-clip' };
const other = { id: 'other', kind: 'article', title: 'A different headline for a later video', outlet: 'CNN', url: 'https://www.cnn.com/2026/11/06/politics/video/later-clip' };
const records = [selected, other];
test('verified source URL takes precedence over a headline matching another record', () => {
  const result = resolveImportMatch({ title: other.title, url: selected.url + '/?utm_source=clipboard#player', outlet: 'CNN' }, records, selected, true);
  assert.equal(result.existing.id, selected.id);
  assert.equal(result.conflict, false);
  assert.equal(result.reason, 'Matching source URL');
});
test('www, tracking parameters and headline changes do not defeat URL identity', () => {
  assert.equal(matchImport({ title: 'Entirely revised headline', url: selected.url.replace('www.', '') + '?utm_campaign=updated', outlet: 'CNN' }, records).record.id, selected.id);
});
test('interactive mismatch produces a preview bound to the exact matching record, not the selected one', () => {
  const result = resolveImportMatch({ title: other.title, outlet: 'CNN' }, records, selected, true);
  assert.equal(result.conflict, true);
  assert.equal(result.existing.id, other.id);
});
test('unattended enrichment retains strict mismatch protection and cannot silently retarget', () => {
  const result = resolveImportMatch({ title: other.title, outlet: 'CNN' }, records, selected);
  assert.equal(result.conflict, true);
  assert.equal(result.existing.id, selected.id);
});
test('similar subjects are not sufficient to merge two distinct URLs or headlines', () => {
  assert.equal(matchImport({ title: 'A later headline covering similar events', outlet: 'CNN' }, records).record, undefined);
});
test('duplicate title matches stay ambiguous instead of selecting an arbitrary record', () => {
  const result = resolveImportMatch({ title: other.title, outlet: 'CNN' }, [...records, { ...other, id: 'duplicate' }]);
  assert.equal(result.ambiguous, true);
  assert.equal(result.existing, undefined);
});
