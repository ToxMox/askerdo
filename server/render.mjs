/* The record renderer: every row back to today's file text, byte for byte, and
   the export that writes a whole store tree from the database. The same render
   proves the import, makes the weekly export, and is the rollback. */
import { mkdirSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { frontText } from './frontmatter.mjs';
import { readTx } from './db.mjs';

/* plans and threads: the raw import's folders, rendered for its byte proof until the merge */
export const RECORD_DIRS = Object.freeze({
  question: 'questions', workstream: 'workstreams', plan: 'plans', task: 'tasks',
  thread: 'threads', knowledge: 'knowledge', procedure: 'procedures', track: 'tracks',
});
export const ANSWER_PLACEHOLDER = '(filled at close: the choice and its why)';
export const WHERE_HEAD = '## Where we were';
export const ITEMS_HEAD = '## Items';
/* tasks on no track keep their edges and checklists here */
export const INBOX_FILE = 'tracks/inbox.json';
/* each record's old texts, and the read log with the day it began (a meta row) */
export const HISTORY_DIR = 'history';
export const READS_FILE = 'reads/reads.json';
export const READS_SINCE = 'reads.since';
/* the override requests waiting at the export, one per line; a scrub's seal never leaves the database */
export const OVERRIDES_FILE = 'overrides/pending.jsonl';
/* the board's settings (meta rows), so automatic upkeep stays on through an export and import */
export const SETTINGS_FILE = 'board/settings.json';
export const SETTINGS = Object.freeze(['upkeep', 'tracks.stallDays', 'tracks.quietHours', 'tracks.foldMax']);

/* One row per line inside a JSON object, so a diff of two exports reads by row. */
export const readsText = (since, rows) => '{"since":' + JSON.stringify(since ?? null) + ',"rows":['
  + (rows.length ? '\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n' : '') + ']}\n';

export const historyLine = (h) => JSON.stringify({ id: h.id, at: h.at, actor: h.actor, field: h.field, old: h.old, new: h.new, why: h.why });

const fileName = (key, slug) => key + '-' + slug + '.md';

/* A track's tasks, edges, checklists and junctions as one JSON block above
   its Journal, so the export and the rollback carry them (leases stay out). */
export const itemsText = (graph) => ITEMS_HEAD + '\n\n```json\n' + JSON.stringify(graph || {}, null, 2) + '\n```\n\n';

/* What a track file carries beside its record; keys, so it reads back exactly. */
export function trackGraphOf(db, key) {
  const mine = 'SELECT task FROM track_items WHERE track = ?';
  return graphRows(db, db.prepare('SELECT task, position FROM track_items WHERE track = ? ORDER BY position, task').all(key), mine, [key], {
    junctions: db.prepare(`SELECT "to", type, added FROM links WHERE "from" = ? AND type NOT IN ('gates', 'cites', 'revisits') ORDER BY type, "to"`).all(key),
  });
}

function graphRows(db, items, taskSql, args, extra) {
  return {
    ...(items ? { items } : {}),
    depends: db.prepare(`SELECT task, "on", reason, added, actor FROM depends WHERE task IN (${taskSql}) ORDER BY task, "on"`).all(...args),
    checklist: db.prepare(`SELECT task, position, text, done, done_at AS doneAt FROM checklist WHERE task IN (${taskSql}) ORDER BY task, position`).all(...args)
      .map((c) => ({ ...c, done: c.done === 1 })),
    ...extra,
  };
}

/* A question ends in its Answer section; every other kind in its Journal, a
   workstream's optional until its first note; a track carries its items above. */
export function renderRecord(rec, notes = [], graph) {
  const head = '---\n' + frontText(rec.fields) + '---\n' + rec.body + (rec.kind === 'track' ? itemsText(graph) : '');
  if (rec.kind === 'question') {
    return head + '## Answer\n' + (notes.length ? notes.map((n) => n.body).join('\n\n') : ANSWER_PLACEHOLDER) + '\n';
  }
  if (rec.layout && rec.layout.journal === false && !notes.length) return head;
  const paras = notes.map((n) => (n.at ? n.at + ': ' : '') + n.body);
  return head + '## Journal\n' + (paras.length ? '\n' + paras.join('\n\n') + '\n' : '');
}

export function renderHandoff(h) {
  const where = h.whereWeWere || h.where_we_were;
  return '---\n' + frontText(h.fields) + '---\n\n## State\n\n' + h.state.replace(/\s+$/, '')
    + (where ? '\n\n' + WHERE_HEAD + '\n\n' + where.replace(/\s+$/, '') : '') + '\n\n## Verify first\n\n```json\n'
    + JSON.stringify(h.verify, null, 2) + '\n```\n';
}

const parse = (s) => (s === null || s === undefined ? null : JSON.parse(s));

/* Every file the database holds, as { path, text } relative to a store root. */
export function* storeFiles(db) {
  const notes = new Map();
  for (const n of db.prepare('SELECT record, at, actor, body FROM notes ORDER BY record, position').all()) {
    if (!notes.has(n.record)) notes.set(n.record, []);
    notes.get(n.record).push(n);
  }
  const named = [];
  for (const r of db.prepare('SELECT key, kind, slug, fields, body, layout FROM records ORDER BY id').all()) {
    const rec = { ...r, fields: parse(r.fields), layout: parse(r.layout) };
    if (rec.kind === 'profile') { named.push([rec.fields.name, rec.fields.profile]); continue; }
    const dir = RECORD_DIRS[rec.kind];
    if (!dir) continue;
    const graph = rec.kind === 'track' ? trackGraphOf(db, rec.key) : undefined;
    yield { path: dir + '/' + fileName(rec.key, rec.slug), text: renderRecord(rec, notes.get(rec.key) || [], graph) };
  }
  const loose = graphRows(db, null, `SELECT key FROM records WHERE kind = 'task' AND key NOT IN (SELECT task FROM track_items)`, [], {});
  if (loose.depends.length || loose.checklist.length) yield { path: INBOX_FILE, text: JSON.stringify(loose, null, 2) + '\n' };
  /* today's writer sorts profiles by name */
  const profiles = Object.fromEntries(named.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
  const anyProfile = named.length > 0;
  for (const h of db.prepare('SELECT key, slug, fields, state, where_we_were, verify FROM handoffs ORDER BY id').all()) {
    yield { path: 'handoffs/' + fileName(h.key, h.slug), text: renderHandoff({ ...h, fields: parse(h.fields), verify: parse(h.verify) }) };
  }
  const subs = db.prepare("SELECT value FROM meta WHERE name = 'profile.subscriptions'").get();
  if (anyProfile || subs) {
    yield { path: 'profiles/profiles.json', text: JSON.stringify({ profiles, subscriptions: subs ? JSON.parse(subs.value) : {} }, null, 2) + '\n' };
  }
  const idMap = db.prepare("SELECT extra FROM labels WHERE origin = 'id-map' ORDER BY position").all();
  if (idMap.length) yield { path: 'legacy/id-map.jsonl', text: idMap.map((r) => r.extra).join('\n') + '\n' };
  const brain = db.prepare("SELECT value FROM meta WHERE name = 'legacy.brain'").get();
  if (brain) {
    const ids = {};
    for (const r of db.prepare("SELECT label, extra FROM labels WHERE origin = 'brain' ORDER BY position").all()) ids[r.label] = JSON.parse(r.extra);
    yield { path: 'legacy/brain-map.json', text: JSON.stringify({ ...JSON.parse(brain.value), ids }, null, 2) + '\n' };
  }
  /* a month's file holds its lines in sequence order, wherever the clock put them */
  const inMonth = db.prepare("SELECT line FROM activity WHERE at >= ? || '-' AND at < ? || '.' ORDER BY seq");
  for (const { m } of db.prepare('SELECT DISTINCT substr(at, 1, 7) AS m FROM activity ORDER BY m').all()) {
    yield { path: 'activity/' + m + '.jsonl', text: inMonth.all(m, m).map((r) => r.line).join('\n') + '\n' };
  }
  const hist = new Map();
  for (const h of db.prepare('SELECT id, record, at, actor, field, old, new, why FROM history ORDER BY record, id').all()) {
    if (!hist.has(h.record)) hist.set(h.record, []);
    hist.get(h.record).push(historyLine(h));
  }
  for (const [key, lines] of hist) yield { path: HISTORY_DIR + '/' + key + '.jsonl', text: lines.join('\n') + '\n' };
  /* always written, so an import tells a board's export from a store that predates the log */
  const since = db.prepare('SELECT value FROM meta WHERE name = ?').get(READS_SINCE);
  const reads = db.prepare('SELECT record, session, site, at FROM reads ORDER BY record, session').all().map((r) => ({ ...r }));
  yield { path: READS_FILE, text: readsText(since ? since.value : null, reads) };
  const set = db.prepare(`SELECT name, value FROM meta WHERE name IN (${SETTINGS.map(() => '?').join(', ')}) ORDER BY name`).all(...SETTINGS);
  if (set.length) yield { path: SETTINGS_FILE, text: JSON.stringify(Object.fromEntries(set.map((r) => [r.name, r.value])), null, 2) + '\n' };
  const reqs = db.prepare('SELECT id, kind, summary, reason, session, at, reversal, measure, changed FROM overrides ORDER BY id').all();
  if (reqs.length) {
    const items = db.prepare('SELECT record, proposed, hash FROM override_items WHERE request = ? ORDER BY position');
    yield {
      path: OVERRIDES_FILE,
      /* a scrub's text is the secret: it never rides an export, so it moves as changed since asked
         (stamped with its ask, so two exports agree) and the session asks again */
      text: reqs.map((r) => JSON.stringify({ ...r, ...(r.kind === 'scrub' ? { changed: r.changed ?? r.at } : {}), measure: JSON.parse(r.measure),
        items: items.all(r.id).map((i) => ({ record: i.record, proposed: r.kind === 'scrub' ? {} : JSON.parse(i.proposed), hash: i.hash })) })).join('\n') + '\n',
    };
  }
}

/* Written beside `dir` and swapped in, so a reader never sees half an export.
   One read transaction: a write landing mid-export cannot split the snapshot. */
export function exportStore(db, dir) {
  const tmp = dir + '.tmp-' + process.pid;
  const old = dir + '.old-' + process.pid;
  rmSync(tmp, { recursive: true, force: true });
  const counts = readTx(db, () => {
    const n = {};
    for (const f of storeFiles(db)) {
      const path = join(tmp, f.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, f.text);
      const kind = f.path.split('/')[0];
      n[kind] = (n[kind] || 0) + 1;
    }
    return n;
  });
  mkdirSync(tmp, { recursive: true });
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(tmp, dir);
  rmSync(old, { recursive: true, force: true });
  return counts;
}
