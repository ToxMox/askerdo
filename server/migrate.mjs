/* Numbered migrations: server/migrations/NNN-name.sql, applied in order inside
   one transaction after a backup. A database newer than this build is refused. */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx } from './db.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export class SchemaError extends Error {}

export function migrations(dir = DIR) {
  return readdirSync(dir).map((f) => /^(\d{3})-[a-z0-9-]+\.sql$/.exec(f)).filter(Boolean)
    .map((m) => ({ n: Number(m[1]), file: join(dir, m[0]) })).sort((a, b) => a.n - b.n);
}

export function schemaVersion(db) {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  if (!has) return 0;
  const row = db.prepare("SELECT value FROM meta WHERE name = 'schema'").get();
  return row ? Number(row.value) : 0;
}

/* `backup(n)` runs before the first pending file when the database already has
   a schema; the CLI passes one that writes a dated copy beside the file. */
export function migrate(db, { dir = DIR, backup } = {}) {
  const list = migrations(dir);
  const top = list.length ? list[list.length - 1].n : 0;
  const at = schemaVersion(db);
  if (at > top) throw new SchemaError('the database is at schema ' + at + ', newer than this server (' + top + '); update the server');
  const pending = list.filter((m) => m.n > at);
  if (!pending.length) return { from: at, to: at, applied: [] };
  if (at > 0 && backup) backup(at);
  tx(db, () => {
    for (const m of pending) db.exec(readFileSync(m.file, 'utf8'));
    db.prepare("INSERT INTO meta (name, value) VALUES ('schema', ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value")
      .run(String(pending[pending.length - 1].n));
  });
  return { from: at, to: pending[pending.length - 1].n, applied: pending.map((m) => m.n) };
}

