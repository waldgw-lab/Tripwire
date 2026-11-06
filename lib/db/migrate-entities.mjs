import pg from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("select pg_advisory_xact_lock(hashtext('tripwire-entity-schema'))");
  await client.query("create table if not exists tripwire_entity_schema_migrations (name text primary key, hash text not null, applied_at timestamptz not null default now())");
  const journal = JSON.parse(await readFile(new URL("./migrations/entities/meta/_journal.json", import.meta.url), "utf8"));
  for (const entry of journal.entries) {
    const source = await readFile(new URL(`./migrations/entities/${entry.tag}.sql`, import.meta.url), "utf8");
    const hash = createHash("sha256").update(source).digest("hex");
    const prior = await client.query("select hash from tripwire_entity_schema_migrations where name=$1", [entry.tag]);
    if (prior.rowCount) {
      if (prior.rows[0].hash !== hash) throw new Error("Applied entity migration was modified; add a new migration instead");
      continue;
    }
    // Initial additive baseline can encounter development tables already present.
    // Named constraints are skipped only when that exact name already exists.
    for (const statement of source.split("--> statement-breakpoint")) {
      const sql = statement.trim();
      if (!sql) continue;
      const constraint = sql.match(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/);
      if (constraint) {
        const found = await client.query("select 1 from pg_constraint where conrelid=to_regclass($1) and conname=$2", [constraint[1], constraint[2]]);
        if (found.rowCount) continue;
      }
      await client.query(sql.replace(/^CREATE TABLE /, "CREATE TABLE IF NOT EXISTS ").replace(/^CREATE UNIQUE INDEX /, "CREATE UNIQUE INDEX IF NOT EXISTS ").replace(/^CREATE INDEX /, "CREATE INDEX IF NOT EXISTS "));
    }
    await client.query("insert into tripwire_entity_schema_migrations(name,hash) values($1,$2)", [entry.tag, hash]);
  }
  await client.query("COMMIT");
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }
