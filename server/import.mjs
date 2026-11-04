/* The raw import: today's store folder into an empty database, every kind as it
   is (threads and plans stay their own kinds until the track merge). Not carried:
   the loose-file lists inside handoffs, and the per-PC folders (inbox, board,
   kept, the counters and caches). Any file that does not fit stops the import. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { splitFile } from './frontmatter.mjs';
import { tx } from './db.mjs';
import {
  RECORD_DIRS, ANSWER_PLACEHOLDER, WHERE_HEAD, ITEMS_HEAD, INBOX_FILE, HISTORY_DIR, READS_FILE, READS_SINCE, OVERRIDES_FILE, SETTINGS, SETTINGS_FILE, COMMITS_FILE, COVERS_FILE,
} from './render.mjs';
import { KEY_LISTS, KEY_MAPS, KEY_ORDERS, addActivity, isKey, labelTops, putHandoff, putNotes, putRecord, setMeta, stampNow } from './records.mjs';
import { createHash } from 'node:crypto';

const STAMP = '\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}[+-]\\d{2}:\\d{2})?';
const ENTRY_RE = new RegExp('^(' + STAMP + '): ([\\s\\S]*)$');
const ENTRY_SPLIT = new RegExp('\\n\\n(?=' + STAMP + ': )');
const KEY_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export class ImportError extends Error {}

/* Where the files come from: a store folder, or a map of path to text (the
   rendered export, so the rehearsal reads its own output back without disk). */
function dirSource(root) {
  return {
    has: (rel) => existsSync(join(root, rel)),
    list: (rel) => (existsSync(join(root, rel)) ? readdirSync(join(root, rel)) : []),
    read: (rel) => readFileSync(join(root, rel), 'utf8'),
  };
}

function mapSource(files) {
  const names = (rel) => [...new Set([...files.keys()].filter((p) => p.startsWith(rel + '/')).map((p) => p.slice(rel.length + 1).split('/')[0]))];
  return {
    has: (rel) => files.has(rel) || names(rel).length > 0,
    list: names,
    read: (rel) => {
      if (!files.has(rel)) throw new Error('no file ' + rel);
      return files.get(rel);
    },
  };
}

const listMd = (src, dir) => src.list(dir).filter((n) => n.endsWith('.md') && n !== 'index.md' && !n.includes('.tmp-')).sort();

function slugOf(file, key) {
  if (!isKey(key)) throw new Error('no 8-character key in its frontmatter');
  if (!file.startsWith(key + '-')) throw new Error('the file name does not start with its key ' + key);
  return file.slice(key.length + 1, -3);
}

/* The body above the last anchor line, and the text below it. */
function cutAt(rest, anchor) {
  const lines = rest.split('\n');
  const at = lines.lastIndexOf(anchor);
  if (at < 0) return null;
  return { body: at ? lines.slice(0, at).join('\n') + '\n' : '', tail: lines.slice(at + 1).join('\n') };
}

/* A journal is '\n' + stamped paragraphs joined by a blank line + '\n'. */
function journalNotes(tail) {
  if (tail === '') return [];
  if (!tail.startsWith('\n') || !tail.endsWith('\n') || tail.endsWith('\n\n')) throw new Error('the journal is not stamped paragraphs');
  return tail.slice(1, -1).split(ENTRY_SPLIT).map((p) => {
    const m = ENTRY_RE.exec(p);
    if (!m) throw new Error('a journal paragraph has no stamp: ' + p.slice(0, 60));
    return { at: m[1], body: m[2] };
  });
}

/* A bare `key:` reads as []; on a known key that is not a list it is the empty
   value it was written from, as today's reader has it. */
function bareKeys(kind, fields) {
  const lists = KEY_LISTS[kind] || [];
  const maps = KEY_MAPS[kind] || [];
  for (const k of KEY_ORDERS[kind] || []) {
    if (!Array.isArray(fields[k]) || fields[k].length || lists.includes(k)) continue;
    fields[k] = maps.includes(k) ? {} : '';
  }
}

/* A track's items block, cut from the end of its body. */
const ITEMS_RE = new RegExp('^([\\s\\S]*\\n)' + ITEMS_HEAD + '\\n\\n```json\\n([\\s\\S]*)\\n```\\n\\n$');
function withItems(out) {
  if (out.rec.kind !== 'track') return out;
  const m = ITEMS_RE.exec(out.rec.body);
  if (!m) throw new Error('a track ends its body with one ' + ITEMS_HEAD + ' JSON block');
  return { ...out, rec: { ...out.rec, body: m[1] }, graph: JSON.parse(m[2]) };
}

export function readRecordFile(kind, file, text) {
  const { fields, rest } = splitFile(text);
  bareKeys(kind, fields);
  const slug = slugOf(file, fields.key);
  if (kind === 'question') {
    const cut = cutAt(rest, '## Answer');
    if (!cut || !cut.tail.endsWith('\n')) throw new Error('no ## Answer section at the end');
    const answer = cut.tail.slice(0, -1);
    const notes = answer === ANSWER_PLACEHOLDER ? [] : answer.split('\n\n').map((body, i) => ({
      at: i === 0 ? (fields.answered || fields.updated || null) : null, body,
    }));
    return { rec: { key: fields.key, kind, slug, fields, body: cut.body }, notes };
  }
  const cut = cutAt(rest, '## Journal');
  if (!cut) return withItems({ rec: { key: fields.key, kind, slug, fields, body: rest, layout: { journal: false } }, notes: [] });
  return withItems({ rec: { key: fields.key, kind, slug, fields, body: cut.body }, notes: journalNotes(cut.tail) });
}

/* The graph rows a track file (or the inbox file) carries, once every record is in. */
function putGraph(db, track, g) {
  const item = db.prepare('INSERT INTO track_items (track, task, position) VALUES (?, ?, ?)');
  const dep = db.prepare('INSERT INTO depends (task, "on", reason, added, actor) VALUES (?, ?, ?, ?, ?)');
  const step = db.prepare('INSERT INTO checklist (task, position, text, done, done_at) VALUES (?, ?, ?, ?, ?)');
  const link = db.prepare('INSERT INTO links ("from", "to", type, added) VALUES (?, ?, ?, ?)');
  for (const i of g.items || []) item.run(track, i.task, i.position);
  for (const d of g.depends || []) dep.run(d.task, d.on, d.reason, d.added, d.actor ?? null);
  for (const c of g.checklist || []) step.run(c.task, c.position, c.text, c.done ? 1 : 0, c.doneAt ?? null);
  for (const j of g.junctions || []) link.run(track, j.to, j.type, j.added ?? null);
}

/* A handoff's verify-first entries keep their summary; the loose-file lists
   (`files`, and the snapshot's dirty and untracked lists) stay on the PC. */
export function verifySummary(list) {
  return list.map((e) => {
    const { files, ...rest } = e;
    if (rest.snapshot && typeof rest.snapshot === 'object') rest.snapshot = rest.snapshot.commit ? { commit: rest.snapshot.commit } : {};
    return rest;
  });
}

function handoffParts(text) {
  const { fields, rest } = splitFile(text);
  const lines = rest.split('\n');
  const first = lines.indexOf('## State');
  const last = lines.lastIndexOf('## Verify first');
  if (first < 0 || last < first) throw new Error('a handoff body is ## State then ## Verify first');
  const m = /^```json\n([\s\S]*)\n```$/.exec(lines.slice(last + 1).join('\n').trim());
  if (!m) throw new Error('## Verify first holds one ```json block');
  const verify = JSON.parse(m[1]);
  if (!Array.isArray(verify)) throw new Error('## Verify first must be a JSON list');
  return { fields, mid: lines.slice(first + 1, last), verify };
}

/* A handoff file's verify-first entries whole, the loose-file lists included:
   what the PC keeps for a handoff still live at the import. */
export const fullVerify = (text) => handoffParts(text).verify;

/* an old store's handoff names its waiting lines waitingOnUser; the board
   keeps them as waitingOnUser, in the same place in the front. */
const renamed = (fields) => (Object.hasOwn(fields, 'waitingOnUser') && !Object.hasOwn(fields, 'waitingOnUser')
  ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [k === 'waitingOnUser' ? 'waitingOnUser' : k, v])) : fields);

/* An old store's handoff file as the board renders it back: the one renamed front key. */
export function handoffTextAsKept(text) {
  const end = text.indexOf('\n---\n');
  return end < 0 ? text : text.slice(0, end).replace(/^waitingOnUser:/m, 'waitingOnUser:') + text.slice(end);
}

export function readHandoffFile(file, text) {
  const parts = handoffParts(text);
  const { mid, verify } = parts;
  const fields = renamed(parts.fields);
  const slug = slugOf(file, fields.key);
  const cut = mid.lastIndexOf(WHERE_HEAD);
  const state = (cut < 0 ? mid : mid.slice(0, cut)).join('\n').trim();
  const whereWeWere = cut < 0 ? '' : mid.slice(cut + 1).join('\n').trim();
  return { key: fields.key, slug, fields, state, whereWeWere, verify: verifySummary(verify) };
}

/* the old record-ids profileKey: one key per profile name on every machine */
export function profileKey(name) {
  const h = createHash('sha1').update('askerdo profile ' + name).digest();
  let out = '';
  for (let i = 0; i < 8; i++) out += KEY_ALPHABET[h[i] & 31];
  return out;
}

export function importStore(db, root) {
  if (!existsSync(root)) throw new ImportError('no store at ' + root);
  return importFrom(db, dirSource(root));
}

/* The same import from a map of store-relative path to text. */
export const importFiles = (db, files) => importFrom(db, mapSource(files instanceof Map ? files : new Map(Object.entries(files))));

function importFrom(db, src) {
  const busy = db.prepare('SELECT (SELECT count(*) FROM records) + (SELECT count(*) FROM handoffs) + (SELECT count(*) FROM activity) AS n').get();
  if (busy.n) throw new ImportError('the database already holds records; import into a fresh one');
  const problems = [];
  const counts = {};
  const count = (k) => { counts[k] = (counts[k] || 0) + 1; };
  const read = src.read;
  tx(db, () => {
    const graphs = [];
    for (const [kind, dir] of Object.entries(RECORD_DIRS)) {
      for (const file of listMd(src, dir)) {
        try {
          const { rec, notes, graph } = readRecordFile(kind, file, read(dir + '/' + file));
          putRecord(db, rec);
          putNotes(db, rec.key, notes);
          if (graph) graphs.push([dir + '/' + file, rec.key, graph]);
          count(kind);
        } catch (e) { problems.push(dir + '/' + file + ': ' + e.message); }
      }
    }
    if (src.has(INBOX_FILE)) graphs.push([INBOX_FILE, null, JSON.parse(read(INBOX_FILE))]);
    for (const [path, track, g] of graphs) {
      try { putGraph(db, track, g); } catch (e) { problems.push(path + ': ' + e.message); }
    }
    for (const file of listMd(src, 'handoffs')) {
      try { putHandoff(db, readHandoffFile(file, read('handoffs/' + file))); count('handoff'); } catch (e) { problems.push('handoffs/' + file + ': ' + e.message); }
    }
    if (src.has('profiles/profiles.json')) {
      const p = JSON.parse(read('profiles/profiles.json'));
      for (const [name, profile] of Object.entries(p.profiles || {})) {
        putRecord(db, { key: profileKey(name), kind: 'profile', fields: { name, profile }, body: '' });
        count('profile');
      }
      setMeta(db, 'profile.subscriptions', JSON.stringify(p.subscriptions || {}));
    }
    const label = db.prepare('INSERT INTO labels (label, key, kind, "from", "to", origin, position, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    if (src.has('legacy/id-map.jsonl')) {
      read('legacy/id-map.jsonl').split('\n').filter(Boolean).forEach((line, i) => {
        const o = JSON.parse(line);
        label.run(o.old, o.key || null, o.kind || null, null, o.at || null, 'id-map', i, line);
        count('id-map');
      });
    }
    if (src.has('legacy/brain-map.json')) {
      const { ids, ...head } = JSON.parse(read('legacy/brain-map.json'));
      setMeta(db, 'legacy.brain', JSON.stringify(head));
      Object.entries(ids || {}).forEach(([id, e], i) => {
        label.run(id, isKey(e.to) ? e.to : null, null, null, null, 'brain', i, JSON.stringify(e));
        count('brain');
      });
    }
    const months = src.list('activity').filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n)).sort();
    for (const m of months) {
      read('activity/' + m).split('\n').forEach((line, i) => {
        if (!line) return;
        try { addActivity(db, JSON.parse(line), line); count('activity'); } catch (e) { problems.push('activity/' + m + ' line ' + (i + 1) + ': ' + e.message); }
      });
    }
    /* history rows keep their ids, which activity lines name */
    const hist = db.prepare('INSERT INTO history (id, record, at, actor, field, old, new, why) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const file of src.list(HISTORY_DIR).filter((n) => /^[0-9a-z]{8}\.jsonl$/.test(n)).sort()) {
      try {
        for (const line of read(HISTORY_DIR + '/' + file).split('\n').filter(Boolean)) {
          const h = JSON.parse(line);
          hist.run(h.id, file.slice(0, 8), h.at, h.actor ?? null, h.field, h.old ?? null, h.new ?? null, h.why ?? null);
        }
        count('history');
      } catch (e) { problems.push(HISTORY_DIR + '/' + file + ': ' + e.message); }
    }
    /* a store with no read log predates it: every record it holds counts as used */
    if (src.has(READS_FILE)) {
      try {
        const r = JSON.parse(read(READS_FILE));
        if (r.since) setMeta(db, READS_SINCE, r.since);
        const add = db.prepare('INSERT INTO reads (record, session, site, at) VALUES (?, ?, ?, ?)');
        for (const x of r.rows || []) add.run(x.record, x.session, x.site, x.at);
      } catch (e) { problems.push(READS_FILE + ': ' + e.message); }
    } else if (db.prepare('SELECT 1 FROM records LIMIT 1').get()) setMeta(db, READS_SINCE, stampNow());
    /* every commit link and cover comes back as it was */
    const rows = (file, sql, args) => {
      if (!src.has(file)) return;
      const put = db.prepare(sql);
      read(file).split('\n').forEach((text, i) => {
        if (!text) return;
        try { put.run(...args(JSON.parse(text))); count('coverage'); } catch (e) { problems.push(file + ' line ' + (i + 1) + ': ' + e.message); }
      });
    };
    rows(COMMITS_FILE, 'INSERT INTO commits (repo, sha, task, at, via, session, agent_job, files, added, removed, linked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      (r) => [r.repo, r.sha, r.task ?? '', r.at, r.via, r.session ?? null, r.agent_job ?? null, JSON.stringify(r.files || []), r.added ?? 0, r.removed ?? 0, r.linked]);
    rows(COVERS_FILE, 'INSERT INTO covers (review, task, at, through, through_at) VALUES (?, ?, ?, ?, ?)',
      (r) => [r.review, r.task, r.at, r.through ?? null, r.through_at ?? null]);
    if (src.has(SETTINGS_FILE)) {
      try {
        const set = JSON.parse(read(SETTINGS_FILE));
        for (const name of SETTINGS) if (typeof set[name] === 'string') setMeta(db, name, set[name]);
      } catch (e) { problems.push(SETTINGS_FILE + ': ' + e.message); }
    }
    /* a request waiting at the import still waits after it, under its own number */
    if (src.has(OVERRIDES_FILE)) {
      const req = db.prepare('INSERT INTO overrides (id, kind, summary, reason, session, at, reversal, measure, changed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const item = db.prepare('INSERT INTO override_items (record, request, position, proposed, hash) VALUES (?, ?, ?, ?, ?)');
      read(OVERRIDES_FILE).split('\n').forEach((text, i) => {
        if (!text) return;
        try {
          const r = JSON.parse(text);
          /* a scrub came without its text: changed since asked, so Keep clears it and the session asks again */
          const textless = r.kind === 'scrub' && r.items.some((x) => !x.proposed || typeof x.proposed.text !== 'string');
          req.run(r.id, r.kind, r.summary, r.reason, r.session, r.at, r.reversal, JSON.stringify(r.measure), r.changed ?? (textless ? stampNow() : null));
          r.items.forEach((x, n) => item.run(x.record, r.id, n, JSON.stringify(x.proposed), x.hash));
          count('override');
        } catch (e) { problems.push(OVERRIDES_FILE + ' line ' + (i + 1) + ': ' + e.message); }
      });
    }
    /* a decided request's number is never handed out again (the log names it) */
    const top = db.prepare("SELECT max(CAST(substr(label, 2) AS INTEGER)) AS n FROM activity WHERE kind = 'override'").get();
    if (top && top.n) {
      if (!db.prepare("UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = 'overrides'").run(top.n).changes) {
        db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('overrides', ?)").run(top.n);
      }
    }
    /* the old counter files are a floor nothing reads today; the top keeps the higher */
    const tops = labelTops(db);
    for (const [file, prefix] of [['counter', 'Q'], ['counter-p', 'P'], ['counter-t', 'T'], ['counter-ws', 'WS']]) {
      const n = src.has(file) ? Number(read(file).trim()) : NaN;
      if (Number.isSafeInteger(n) && n > (tops[prefix === 'Q' ? 'Q' : prefix + '-'] || 0)) setMeta(db, 'label.top.' + prefix, String(n));
    }
    if (problems.length) throw new ImportError(problems.length + ' files did not import, nothing was written:\n' + problems.join('\n'));
  });
  return counts;
}
