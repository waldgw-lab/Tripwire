import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCoverageRows } from '../artifacts/api-server/src/lib/entity-coverage.ts';
import { key, W } from '../artifacts/api-server/src/lib/entity-db.ts';

const context = (watchId, entityId, individual = 'Fictional Analyst') => ({
  watchId, entityId, original: { title: 'Original position', position: 'Director',
    individual, summary: 'Retain leadership accountability and original relevance context.',
    tier: 2, organization: 'Original organization' },
});
const person = watchId => ({ id: key(W, 'legacy-holder', watchId), type: 'person', name: 'Fictional Analyst' });

test('original relevance survives on canonical positions without overwriting current registry data', () => {
  const original = context('watch-a', 'position-a');
  const row = { id: 'position-a', type: 'position', name: 'Renamed director', organizationId: 'canonical-org',
    rationale: 'Current analyst rationale', priority: 1 };
  const before = structuredClone(row);
  const [projected] = projectCoverageRows([row], [original], []);
  assert.equal(projected.coverageContext.individual, 'Fictional Analyst');
  assert.equal(projected.coverageContext.summary, original.original.summary);
  assert.equal(projected.name, row.name);
  assert.equal(projected.organizationId, 'canonical-org');
  assert.equal(projected.priority, 1);
  assert.deepEqual(row, before);
});

test('a legacy holder remains unverified context, not a sourced appointment', () => {
  const [projected] = projectCoverageRows([person('watch-a')], [context('watch-a', 'position-a')], []);
  assert.deepEqual(projected.roleLinks, [{ positionId: 'position-a', source: 'legacy-context',
    certainty: 'unverified', status: 'context-only', tenure: null, validFrom: null, validTo: null }]);
});

test('same-named people from distinct original positions are never merged by name', () => {
  const projected = projectCoverageRows([person('watch-a'), person('watch-b')], [
    context('watch-a', 'position-a'), context('watch-b', 'position-b'),
  ], []);
  assert.notEqual(projected[0].id, projected[1].id);
  assert.equal(projected[0].roleLinks[0].positionId, 'position-a');
  assert.equal(projected[1].roleLinks[0].positionId, 'position-b');
});

test('assertion certainty, retraction, former tenure and validity dates remain explicit', () => {
  const actor = person('watch-a');
  const role = { id: 'assertion-a', subjectId: actor.id, objectId: 'position-a', predicate: 'occupies',
    certainty: 'disputed', status: 'retracted', tenure: 'former',
    validFrom: new Date('2024-01-01Z'), validTo: new Date('2025-01-01Z') };
  const [projected] = projectCoverageRows([actor], [context('watch-a', 'position-a')], [role]);
  assert.equal(projected.roleLinks.length, 1);
  assert.equal(projected.roleLinks[0].source, 'sourced-assertion');
  assert.equal(projected.roleLinks[0].status, 'retracted');
  assert.equal(projected.roleLinks[0].certainty, 'disputed');
  assert.equal(projected.roleLinks[0].tenure, 'former');
  assert.equal(projected.roleLinks[0].validTo, '2025-01-01T00:00:00.000Z');
});

test('an equal display name alone does not attach an unrelated actor to a role', () => {
  const [projected] = projectCoverageRows([{ id: 'unrelated-person', name: 'Fictional Analyst', type: 'person' }],
    [context('watch-a', 'position-a')], []);
  assert.deepEqual(projected.roleLinks, []);
  assert.equal(projected.coverageContext, undefined);
});
