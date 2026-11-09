import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { browserBoundary } from '../artifacts/api-server/src/lib/tripwire-browser-boundary.ts';
import { refreshXFeeds } from '../lib/api-client-react/src/generated/api.ts';
import { setBaseUrl } from '../lib/api-client-react/src/custom-fetch.ts';

// Use the backend's actual Express dependency, without adding a second copy.
const express = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url))('express');

test('generated bodyless X refresh crosses the real HTTP browser boundary without allowing cross-origin or nonempty text actions', async () => {
  const app = express();
  let calls = 0;
  app.use(express.json());
  app.use('/api/tripwire', browserBoundary);
  app.post('/api/tripwire/x-feeds/refresh', (_req, res) => {
    calls++;
    // Exercise only the request contract, never collection or shared persistence.
    res.json({ accounts: [], status: 'setup-required', message: 'Isolated HTTP fixture',
      intervalMinutes: 10, requestsUsed: 0, postsReserved: 0 });
  });
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  setBaseUrl(base);
  try {
    const result = await refreshXFeeds({ headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(result.status, 'setup-required');
    assert.equal(calls, 1);
    await assert.rejects(refreshXFeeds({ headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } }),
      error => error.status === 403);
    await assert.rejects(refreshXFeeds({ headers: { Origin: base, 'Sec-Fetch-Site': 'cross-site' } }),
      error => error.status === 403);
    const notBodyless = await fetch(`${base}/api/tripwire/x-feeds/refresh`, {
      method: 'POST', headers: { Origin: base, 'Content-Type': 'text/plain' }, body: 'not an empty action',
    });
    assert.equal(notBodyless.status, 415);
    const otherAction = await fetch(`${base}/api/tripwire/unknown-action`, {
      method: 'POST', headers: { Origin: base },
    });
    assert.equal(otherAction.status, 415);
    assert.equal(calls, 1, 'only the valid same-origin bodyless refresh reached its route');
  } finally {
    setBaseUrl('');
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
