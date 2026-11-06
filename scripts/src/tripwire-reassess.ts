import { pool } from "@workspace/db";
const modulePath = "../../artifacts/api-server/src/lib/tripwire-reassessment.ts";
const { reassessArchiveBatch } = await import(modulePath);
try {
  let state;
  do {
    state = await reassessArchiveBatch();
    console.log(JSON.stringify(state));
  } while (!state.done);
} finally { await pool.end(); }
