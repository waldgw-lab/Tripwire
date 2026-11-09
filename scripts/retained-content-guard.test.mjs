import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pool } from '@workspace/db';

test('retained byte protection rejects edits but permits metadata and explicit retention', async () => {
  const schema = `content_guard_${randomUUID().replaceAll('-', '')}`;
  const client = await pool.connect();
  try {
    await client.query(`create schema "${schema}"`);
    await client.query(`set search_path to "${schema}"`);
    await client.query('create table tripwire_content(hash text primary key, text text not null, raw text, note text)');
    const migration = await readFile(new URL('../lib/db/migrations/entities/0007_retained_content_immutable.sql', import.meta.url), 'utf8');
    await client.query(migration);
    await client.query("insert into tripwire_content values('first','😀 Original quotation','raw original',null)");
    for (const sql of [
      "update tripwire_content set text='Changed quotation'",
      "update tripwire_content set raw='changed raw'",
      "update tripwire_content set raw=null",
      "update tripwire_content set hash='renamed'",
    ]) await assert.rejects(client.query(sql), error => error.code === '23514');
    await client.query("update tripwire_content set text=text,raw=raw,note='metadata maintenance'");
    assert.equal((await client.query('select text from tripwire_content')).rows[0].text, '😀 Original quotation');
    await client.query("insert into tripwire_content values('new','Improved extraction','raw original',null)");
    assert.equal((await client.query('select count(*)::int n from tripwire_content')).rows[0].n, 2);
    await client.query("delete from tripwire_content where hash='new'");
    assert.equal((await client.query('select count(*)::int n from tripwire_content')).rows[0].n, 1);
  } finally {
    await client.query('set search_path to public');
    await client.query(`drop schema if exists "${schema}" cascade`);
    client.release();
    await pool.end();
  }
});
