/* board/recent.json, the server's own touch stamp: the files a
 * record's opener actually opened. It is not a record, so the CLI never reads it
 * and no store lock is taken; every reader re-resolves before it renders. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RECENT_MAX, RECENT_MENU, RECENT_NAME_MAX,
  keepResolved, loadRecent, mergeRecent, noteOpen, recentPath,
} from '../lib/recent-opens.mjs';
import { isFullStamp, stampNow } from '../lib/stamps.mjs';
import { tempDir } from './helpers/sandbox.mjs';

function root() {
  const dir = tempDir('nd-recent-');
  mkdirSync(join(dir, 'board'), { recursive: true });
  return dir;
}

function entry(n, over) {
  return {
    id: 'T-86', index: n, path: 'C:/x/a' + n + '.md', kind: 'open', at: '2026-09-13 09:00 +02:00', ...over,
  };
}

function stored(dir) {
  return JSON.parse(readFileSync(recentPath(dir), 'utf8')).opens;
}

test('the two caps are the file and the menu, and the name bound is the wire one', () => {
  assert.equal(RECENT_MAX, 20);
  assert.equal(RECENT_MENU, 5);
  /* the same bound the tray object keeps for a question name, so a name cut for
     the menu is cut once and in one place */
  assert.equal(RECENT_NAME_MAX, 120);
  assert.equal(recentPath('/store'), join('/store', 'board', 'recent.json'));
});

test('an absent, malformed or wrongly shaped file reads as empty and never throws', () => {
  const dir = root();
  assert.equal(existsSync(recentPath(dir)), false);
  assert.deepEqual(loadRecent(dir), [], 'the empty list IS its contents until it exists');
  for (const text of ['{ not json\n', '[]\n', 'null\n', '"opens"\n',
    JSON.stringify({ opens: 'a.md' }) + '\n', JSON.stringify({}) + '\n']) {
    writeFileSync(recentPath(dir), text);
    assert.deepEqual(loadRecent(dir), [], text.trim());
  }
  /* a row that could never become a URL is dropped and the rows beside it still
     read: the id, the index and the path are what the click and the sweep use */
  writeFileSync(recentPath(dir), JSON.stringify({
    opens: [
      { id: '', index: 0, path: 'C:/x/a.md' },
      { id: 'T-86', path: 'C:/x/a.md' },
      { id: 'T-86', index: -1, path: 'C:/x/a.md' },
      { id: 'T-86', index: 1.5, path: 'C:/x/a.md' },
      { id: 'T-86', index: 10000, path: 'C:/x/a.md' },
      { id: 'T-86', index: '2', path: 'C:/x/a.md' },
      { id: 'T-86', index: 2, path: '' },
      'not an entry',
      { id: 'T-86', index: 2, path: 'C:/x/a.md' },
    ],
  }) + '\n');
  assert.deepEqual(loadRecent(dir), [
    { id: 'T-86', index: 2, path: 'C:/x/a.md', kind: '', at: '' },
  ]);
});

test('twenty are stored, newest first, and a repeat moves to the top', () => {
  const dir = root();
  for (let n = 0; n < 25; n++) noteOpen(dir, entry(n));
  const on = stored(dir);
  assert.equal(on.length, RECENT_MAX);
  /* newest first, so the last open is row one and the five oldest are gone */
  assert.deepEqual(on.map((e) => e.index), [24, 23, 22, 21, 20, 19, 18, 17, 16, 15,
    14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  /* THE ONE IDENTITY IS THE ID PLUS THE INDEX: a second open of a file already
     in the list moves it rather than adding a row */
  noteOpen(dir, entry(10, { kind: 'editor' }));
  const after = stored(dir);
  assert.equal(after.length, RECENT_MAX);
  assert.equal(after[0].index, 10);
  assert.equal(after[0].kind, 'editor');
  assert.equal(after.filter((e) => e.index === 10).length, 1);
  /* the same index under another record is another file and takes its own row */
  noteOpen(dir, entry(10, { id: 'Q113', path: 'C:/x/q.md' }));
  assert.equal(stored(dir).filter((e) => e.index === 10).length, 2);
});

test('the stamp is the store own format and a malformed entry adds no row', () => {
  const dir = root();
  noteOpen(dir, { id: 'T-86', index: 2, path: 'C:/x/a.md', kind: 'open', at: stampNow(new Date()) });
  const [row] = stored(dir);
  assert.equal(isFullStamp(row.at), true, 'the stamp was ' + row.at);
  assert.deepEqual(Object.keys(row), ['id', 'index', 'path', 'kind', 'at']);
  /* AN ENTRY THAT IS NOT ONE IS A NO-OP ON THE LIST, never a throw and never a
     half row: the route writes only what it resolved */
  for (const bad of [null, undefined, [], 'T-86', { id: 'T-86', index: 2 },
    { id: '', index: 0, path: 'C:/x/b.md' }, { id: 'T-86', index: -1, path: 'C:/x/b.md' }]) {
    assert.deepEqual(mergeRecent(stored(dir), bad).map((e) => e.path), ['C:/x/a.md']);
    noteOpen(dir, bad);
  }
  assert.deepEqual(stored(dir).map((e) => e.path), ['C:/x/a.md']);
});

test('an entry the record no longer names is dropped from the view and swept on the next write', () => {
  const dir = root();
  noteOpen(dir, entry(0));
  noteOpen(dir, entry(1));
  noteOpen(dir, entry(2));
  const on = loadRecent(dir);
  /* THE RESOLVER ANSWERS THE PATH THE RECORD NAMES NOW, and the entry is kept
     only while that answer equals the path stored beside it */
  const moved = (e) => (e.index === 1 ? 'C:/x/somewhere-else.md' : e.path);
  assert.deepEqual(keepResolved(on, moved).map((e) => e.index), [2, 0]);
  /* a resolver that answers nothing at all, and one that throws, both drop the
     entry rather than keeping a path the record has stopped naming */
  assert.deepEqual(keepResolved(on, () => ''), []);
  assert.deepEqual(keepResolved(on, () => { throw new Error('unreadable'); }), []);
  /* THE SWEEP IS THE NEXT WRITE'S: the dropped entry leaves the file when the
     next open is noted, and nothing else moves */
  noteOpen(dir, entry(3), moved);
  assert.deepEqual(stored(dir).map((e) => e.index), [3, 2, 0]);
});

test('the write is atomic, at 0600, and takes no store lock', () => {
  const dir = root();
  /* THE LOCK THE CLI TAKES OVER A RECORD, held for the whole of this write: this
     file is not a record, so a held lock is not this writer's business. */
  mkdirSync(join(dir, '.lock'), { recursive: true });
  noteOpen(dir, entry(0));
  assert.deepEqual(stored(dir).map((e) => e.index), [0]);
  /* the mode notify.json and view.json are written with. Windows reports 0666
     for every file it owns, so the check is what the platform can answer. */
  const mode = statSync(recentPath(dir)).mode & 0o777;
  assert.ok(process.platform === 'win32' || mode === 0o600, 'mode was ' + mode.toString(8));
  assert.equal(readFileSync(recentPath(dir), 'utf8').endsWith('\n'), true);
  /* ATOMIC: the rename consumes the temp file, so the board directory holds the
     one file and no debris beside it */
  noteOpen(dir, entry(1));
  assert.deepEqual(readdirSync(join(dir, 'board')), ['recent.json']);
  /* MERGED OVER WHAT IS ON DISK NOW rather than over anything a process
     remembered, so a hand edit between two writes is never silently reverted */
  writeFileSync(recentPath(dir), JSON.stringify({
    opens: [{ id: 'Q113', index: 0, path: 'C:/x/q.md', kind: 'open', at: '' }],
  }) + '\n');
  noteOpen(dir, entry(2));
  assert.deepEqual(stored(dir).map((e) => e.id), ['T-86', 'Q113']);
});

test('the module reads the store with node builtins alone and names no lock', () => {
  const src = readFileSync(new URL('../lib/recent-opens.mjs', import.meta.url), 'utf8');
  /* NO STORE LOCK AND NO RECORD READ: a second spelling of either would make
     this file a record, which is the one thing it is not. */
  for (const name of ['withLock', '.lock']) {
    assert.equal(src.includes(name), false, 'the module names ' + name);
  }
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['node:fs', 'node:path', './store-io.mjs']);
});
