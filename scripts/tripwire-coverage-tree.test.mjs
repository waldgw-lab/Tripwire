import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverage, filterTree, linkStanding, fetchAllEntities } from '../artifacts/tripwire/src/lib/coverage-tree.ts';

const row = (id, type, extra = {}) => ({ id, type, name: id, aliases: [], rationale: 'Fixture', priority: 2,
  pinned: false, classification: 'contextual', state: 'Watch', createdAt: '2026-01-01Z', ...extra });
const flattened = nodes => nodes.flatMap(n => [n.e.id, ...flattened(n.children)]);

test('organizations, positions and legacy people share one canonical hierarchy', () => {
  const org = row('org', 'organization');
  const sub = row('sub', 'organization', { organizationId: 'org' });
  const position = row('role', 'position', { organizationId: 'sub' });
  const person = row('person', 'person', { roleLinks: [{ positionId: 'role', source: 'legacy-context' }] });
  const graph = buildCoverage([person, org, position, sub]);
  assert.deepEqual(flattened(graph.roots), ['org', 'sub', 'role', 'person']);
  assert.equal(graph.unplacedPeople.length, 0);
  assert.equal(graph.loosePositions.length, 0);
});

test('cycles, missing parents and invalid parent types never hide subjects', () => {
  const rows = [row('a', 'organization', { organizationId: 'b' }), row('b', 'organization', { organizationId: 'a' }),
    row('orphan', 'position', { organizationId: 'missing' }), row('issue', 'issue', { organizationId: 'orphan' }),
    row('person', 'person', { roleLinks: [{ positionId: 'missing', source: 'legacy-context' }] })];
  const g = buildCoverage(rows);
  const ids = new Set(flattened([...g.roots, ...g.loosePositions, ...g.unplacedPeople, ...g.other]));
  assert.deepEqual(ids, new Set(rows.map(r => r.id)));
});

test('explicit organization links retain attached issues and unplaced people', () => {
  const g = buildCoverage([row('org', 'organization'), row('issue', 'issue', { organizationId: 'org' }),
    row('person', 'person', { organizationId: 'org' })]);
  assert.equal(g.other.length, 0);
  assert.equal(g.unplacedPeople.length, 0);
  assert.deepEqual(new Set(flattened(g.roots)), new Set(['org', 'issue', 'person']));
});

test('person matches keep organizational and position ancestors', () => {
  const g = buildCoverage([row('org', 'organization'), row('role', 'position', { organizationId: 'org' }),
    row('person', 'person', { roleLinks: [{ positionId: 'role', source: 'legacy-context' }] })]);
  const filtered = filterTree(g.roots, e => e.id === 'person');
  assert.deepEqual(flattened(filtered.nodes), ['org', 'role', 'person']);
  assert.deepEqual([...filtered.hits], ['person']);
});

test('only explicitly confirmed, assessed, effective current roles get current standing', () => {
  const now = '2026-11-06T12:00:00Z';
  const current = { positionId: 'role', source: 'sourced-assertion', certainty: 'confirmed',
    status: 'analyst-assessed', tenure: 'current', validFrom: '2026-01-01T00:00:00Z' };
  assert.equal(linkStanding(current, now).verified, true);
  for (const change of [{ source: 'legacy-context' }, { certainty: 'asserted' }, { certainty: 'attributed' },
    { certainty: 'alleged' }, { certainty: 'disputed' }, { status: 'candidate' }, { status: 'retracted' },
    { tenure: 'nominated' }, { tenure: 'former' }, { validFrom: null }, { validFrom: '2027-01-01T00:00:00Z' },
    { validTo: '2026-11-06T11:59:59Z' }, { validTo: 'invalid' }]) {
    assert.equal(linkStanding({ ...current, ...change }, now).verified, false, JSON.stringify(change));
  }
});

test('all pages are loaded, including organizations beyond the first hundred', async () => {
  const rows = Array.from({ length: 145 }, (_, i) => row(`subject-${i}`, i === 144 ? 'organization' : 'position'));
  const offsets = [];
  const loaded = await fetchAllEntities(undefined, async ({ offset, limit }) => {
    offsets.push(offset); return { items: rows.slice(offset, offset + limit), total: rows.length };
  });
  assert.equal(loaded.length, 145);
  assert.equal(loaded.at(-1).type, 'organization');
  assert.deepEqual(offsets, [0, 100]);
});

test('shifted, duplicate or incomplete pages fail explicitly rather than hide records', async () => {
  await assert.rejects(fetchAllEntities(undefined, async ({ offset }) => ({
    items: offset === 0 ? [row('same', 'organization')] : [], total: 2,
  })), /returned 1 of 2/);
});
