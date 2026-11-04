/* The board server's storage core: the write transaction, the migration
   runner, and the import-export round trip against a store the old writers made. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tempDir } from './helpers/sandbox.mjs';
import { oldStore } from './helpers/old-store.mjs';

process.removeAllListeners('warning');
const { openDb, tx, TxError } = await import('../server/db.mjs');
const { migrate, migrations, SchemaError } = await import('../server/migrate.mjs');
const { handoffTextAsKept, importStore } = await import('../server/import.mjs');
const { READS_FILE, exportStore } = await import('../server/render.mjs');
const { editKnowledge } = await import('../server/verbs/work.mjs');
const { putHandoff } = await import('../server/records.mjs');
const { newTrack, trackSummary } = await import('../server/verbs/tracks.mjs');
const { procedureCards, recordRun } = await import('../server/verbs/procedures.mjs');

function board() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

test('a write transaction refuses to await and leaves nothing written', () => {
  const db = board();
  const n = () => db.prepare('SELECT count(*) AS n FROM meta').get().n;
  const before = n();
  assert.throws(() => tx(db, async () => { db.prepare("INSERT INTO meta VALUES ('a', '1')").run(); }), TxError);
  assert.throws(() => tx(db, () => { db.prepare("INSERT INTO meta VALUES ('b', '1')").run(); return Promise.resolve(); }), TxError);
  assert.equal(n(), before);
  assert.equal(db.isTransaction, false);
});

test('the migration runner refuses a database newer than itself', () => {
  const db = board();
  const top = migrations().at(-1).n;
  db.prepare("UPDATE meta SET value = ? WHERE name = 'schema'").run(String(top + 1));
  assert.throws(() => migrate(db), SchemaError);

});

const walk = (dir, rel = '') => (existsSync(join(dir, rel)) ? readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? walk(dir, rel + e.name + '/') : [rel + e.name])) : []);

/* the old writers made the store (test/fixtures/old-store/make.mjs) */
test('every kind today\'s writers made imports and exports back byte for byte', () => {
  const base = tempDir('askerdo-store-');
  const root = oldStore('kinds', base);

  const db = board();
  importStore(db, root);
  const out = join(base, 'export');
  exportStore(db, out);
  const RECORDS = /^(questions|workstreams|plans|tasks|threads|knowledge|procedures|handoffs|activity|profiles|legacy)\//;
  const theirs = walk(root).filter((p) => RECORDS.test(p) && p !== 'questions/index.md');
  for (const dir of ['questions', 'workstreams', 'plans', 'tasks', 'threads', 'knowledge', 'procedures', 'handoffs', 'activity', 'profiles', 'legacy']) {
    assert.ok(theirs.some((p) => p.startsWith(dir + '/')), 'the writers made no ' + dir);
  }
  assert.deepEqual(walk(out).filter((p) => p !== READS_FILE).sort(), theirs.sort());
  /* a handoff's waitingOnUser comes back as waitingOnUser */
  const kept = (p, t) => (p.startsWith('handoffs/') ? handoffTextAsKept(t) : t);
  for (const p of theirs) assert.equal(readFileSync(join(out, p), 'utf8'), kept(p, readFileSync(join(root, p), 'utf8')), p);
  /* a store from before the read log counts every record used, so its rulings are amend-only */
  assert.throws(() => editKnowledge(db, { id: 'K-1', name: 'renamed' }, 'cli'), /in use \(it was made before/);

  /* the board's own writes come back too: a handoff's track and PC, a cleared flag */
  const tr = newTrack(db, { name: 'the board', workstream: 'WS-1' }, 'cli');
  const key = 'h0000001';
  putHandoff(db, { key, slug: 'the-board', fields: { id: tr.id + '.1', key, track: tr.key, pc: 'pc-a', status: 'waiting', focus: 'Pick up the board.' },
    state: 'Mid build.', verify: [] });
  recordRun(db, { name: 'demo', result: 'clean' }, 'cli');
  const again = join(base, 'again');
  exportStore(db, again);
  const back = board();
  importStore(back, again);
  assert.deepEqual({ ...back.prepare('SELECT track, pc FROM handoffs WHERE key = ?').get(key) }, { track: tr.key, pc: 'pc-a' });
  assert.equal(trackSummary(back, { track: tr.id }).state, 'waiting', 'the track still has its handoff');
  assert.deepEqual(procedureCards(back).map((c) => c.badge), procedureCards(db).map((c) => c.badge));
});
