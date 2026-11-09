import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CLAIM_POLICY, claimDirection, extractLocalClaims, extractClaimChunk } from '../artifacts/api-server/src/lib/live-claim-rules.ts';

export function compatibilityOutput() {
  const passages = [
    '😀 Officials said the regional commanders strengthened air defenses after the attack.',
    'Officials denied that the regional commanders endangered troops during the attack.',
    'According to two officials, regional commanders strengthened air defenses after the attack.',
    'Subscribe to our newsletter for the latest articles and daily news.',
    'Commanders may have strengthened defenses after the attack.',
    'Commanders did not endanger their troops during the attack.',
    'The new defenses improved protection but weakened the reserve force.',
    'Officials alleged that the regional commanders endangered troops during the attack.',
    'The commanders failed to protect the northern supply route during the attack.',
  ];
  const body = Array.from({ length: 600 }, (_, i) => `Unit ${i} strengthened defensive positions along the northern border after the attack.`).join('\n');
  const chunks = [];
  let cursor = 0;
  while (cursor < body.length) {
    const chunk = extractClaimChunk(body, cursor);
    assert.ok(chunk.nextCursor > cursor);
    chunks.push(chunk);
    cursor = chunk.nextCursor;
  }
  return { extracted: extractLocalClaims(passages.join('\n')), directions: passages.map(claimDirection), chunks };
}

test('persisted extraction policy matches its fixed rule and chunk compatibility baseline', () => {
  // A rule-output change requires a NEW policy and baseline, never silently
  // replacing the fingerprint for a policy already used by persisted chunks.
  const baselines = { 'local-reporting-v1': 'b25b7ad47836b07b47bdc0c2e085c3a65d985184400335998addf181e40ca761' };
  assert.ok(baselines[CLAIM_POLICY], 'Add a compatibility baseline for the new extraction policy');
  const actual = createHash('sha256').update(JSON.stringify(compatibilityOutput())).digest('hex');
  assert.equal(actual, baselines[CLAIM_POLICY], 'Extraction changed: bump CLAIM_POLICY and record the new policy baseline before reusing persisted chunks');
});
