import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrganizationParent } from '../artifacts/api-server/src/lib/entity-organization.ts';
const org = organizationId => ({ type: 'organization', redirectId: null, organizationId });
test('organization context accepts a valid chain and explicit clearing', async () => {
  const rows = { a: org('b'), b: org(null) };
  const load = async id => { if (!rows[id]) throw new Error('Outside workspace or missing'); return rows[id]; };
  await validateOrganizationParent('subject', 'a', load);
  await validateOrganizationParent('subject', null, () => assert.fail('Clear must not look up a parent'));
  await assert.rejects(validateOrganizationParent('subject', 'missing', load), /Outside workspace/);
});
test('organization context rejects self, indirect and pre-existing cycles', async () => {
  const rows = { a: org('b'), b: org('a'), child: org('subject') };
  const load = async id => rows[id];
  for (const parent of ['subject', 'a', 'child'])
    await assert.rejects(validateOrganizationParent('subject', parent, load), /cycle/);
});
test('organization context cannot point to a person or redirected identity', async () => {
  await assert.rejects(validateOrganizationParent('subject', 'person', async () => ({ ...org(null), type: 'person' })), /unredirected organization/);
  await assert.rejects(validateOrganizationParent('subject', 'old', async () => ({ ...org(null), redirectId: 'new' })), /unredirected organization/);
});
