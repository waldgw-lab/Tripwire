import { backfillMain } from '../artifacts/api-server/src/lib/source-search-backfill.ts';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
await backfillMain(process.argv.slice(2));
