import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceVersion, claimEvidenceScope } from '../artifacts/api-server/src/lib/reporting-versions.ts';

test('version context preserves exact original wording and distinguishes retained copies conservatively', () => {
  const excerpt = '😀 Officials said the decision might change.';
  const old = `Old heading\n${excerpt}\nOld sidebar`;
  const selected = `New heading\n${excerpt}`;
  const bodies = new Map([['old', old], ['selected', selected], ['short', 'A shorter excerpt.']]);
  const e = { id: 'e', excerpt, start: old.indexOf(excerpt), end: old.indexOf(excerpt) + excerpt.length };
  const cap = { id: 'c', hash: 'old', source: 'paste', captured_at: '2026-11-08T12:00:00Z' };
  const article = { fullTextHash: 'selected', fullTextComplete: false };
  const current = evidenceVersion(e, cap, article, bodies);
  assert.equal(current.scope, 'selected', 'exact wording can remain in selected text at different offsets');
  assert.equal(current.excerpt, excerpt);
  assert.equal(current.start, e.start, 'never rewrite historical offsets');
  assert.equal(current.bodyHash, 'old');
  assert.equal(evidenceVersion(e, cap, { fullTextHash: 'short' }, bodies).scope, 'superseded');
  for (const source of ['url', 'file', 'page:article']) {
    assert.equal(evidenceVersion(e, { ...cap, source }, { fullTextHash: 'short' }, bodies).scope, 'superseded');
  }
  for (const source of ['rss:content', 'discovery:publisher-sitemap', 'source-search:user-supplied-archive', 'provided excerpt']) {
    assert.equal(evidenceVersion(e, { ...cap, source }, { fullTextHash: 'short' }, bodies).scope, 'retained-excerpt');
  }
  assert.equal(evidenceVersion(e, cap, {}, bodies).scope, 'unknown', 'no selected body is not proof of absence');
  assert.equal(evidenceVersion({ ...e, start: 0 }, cap, article, bodies).scope, 'unknown', 'invalid offsets are not validated');
  assert.equal(evidenceVersion(undefined, undefined, article, bodies).scope, 'unknown', 'unmatched imported/legacy claims remain explicit');
  assert.equal(claimEvidenceScope([{ scope: 'superseded' }, { scope: 'selected' }]), 'selected');
  assert.equal(claimEvidenceScope([]), 'unknown');
});
