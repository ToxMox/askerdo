/* the conversion map as onboard and the doctor read it. The board keeps one row per
   source (a repo file, a folder with its trailing slash, call:<id>, run:<id>); these helpers mark each
   against the repo now, so a second run reads only what changed and asks no answered call again. Pure,
   blobsOf aside. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { OWN_ONLY, ownOnly } from './coverage.mjs';

export const RUN = 'run:';
export const CALL = 'call:';
export const isFolder = (s) => String(s).endsWith('/');
export const NONE = 'none';
const slashed = (p) => String(p).replace(/\\/g, '/');

/* A folder's state for the next run: its tree at HEAD, plus its uncommitted files' count and newest mtime. */
export const folderSig = (tree, dirty = 0, newestMs = 0) => (tree || '') + (dirty ? '+' + dirty + '@' + Math.round(newestMs || 0) : '');

/* path -> the blob id git would give each file's text now: a source with no clean blob at HEAD (untracked,
   ignored, modified) keeps one hash while its text stays, on the write's side and the survey's alike */
const LF = String.fromCharCode(10);
export function blobsOf(dir, paths) {
  const m = new Map();
  const list = [...new Set(paths)].filter(Boolean);
  if (!list.length) return m;
  const r = spawnSync('git', ['hash-object', '--stdin-paths'], { cwd: dir, input: list.join(LF) + LF, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
  const out = r.status === 0 ? String(r.stdout).trim().split(/\s+/) : [];
  if (out.length === list.length) list.forEach((p, i) => m.set(p, out[i]));
  return m;
}

/* `git ls-tree -r -t -z HEAD` to path -> hash, blobs and trees alike. */
export function parseTree(out) {
  const m = new Map();
  for (const e of String(out || '').split('\0')) {
    const tab = e.indexOf('\t');
    if (tab < 0) continue;
    const [, , hash] = e.slice(0, tab).split(' ');
    m.set(slashed(e.slice(tab + 1)), hash);
  }
  return m;
}

/* An earlier import's records seen without this build's label (Tidewatch's handoff import): label imported or a
   handoff-import: ref. Their refs naming a path inside the project seed the map. */
export const earlierImport = (r, label) => (r.labels || []).includes(label) || (r.labels || []).includes('imported')
  || (r.refs || []).some((x) => /^handoff-import:/.test(String(x)));
export function seedPath(ref, root, has) {
  const s = slashed(String(ref || '').trim()).replace(/^\.\//, '');
  if (!s || /^[a-z][a-z0-9+.-]+:(?!\/)/i.test(s)) return null;
  const r = slashed(root).replace(/\/+$/, '');
  const found = (rel) => { if (!rel) return null; if (has(rel)) return rel; const dir = rel.replace(/\/+$/, ''); return dir && has(dir + '/') ? dir + '/' : null; };
  if (!/^[A-Za-z]:\/|^\//.test(s)) return found(s);
  if (s.toLowerCase().startsWith(r.toLowerCase() + '/')) return found(s.slice(r.length + 1));
  /* a path under another checkout of the project (another PC's, a copy): the part after the project's folder name */
  const name = r.split('/').pop().toLowerCase();
  const parts = s.split('/');
  for (let i = 1; i < parts.length - 1; i++) if (parts[i].toLowerCase() === name) { const hit = found(parts.slice(i + 1).join('/')); if (hit) return hit; }
  return null;
}
export function seedsOf(imported, root, has) {
  const out = new Map();
  for (const r of imported || []) {
    for (const ref of r.refs || []) {
      const p = seedPath(ref, root, has);
      if (!p) continue;
      if (!out.has(p)) out.set(p, { source: p, records: [], kinds: [], state: 'seeded' });
      const s = out.get(p);
      s.records.push(r.id);
      if (r.kind && !s.kinds.includes(r.kind)) s.kinds.push(r.kind);
    }
  }
  return [...out.values()];
}
/* A ref only says a record names the file: a track holds the work in flight there (its tasks and handoff), never
   the rulings or facts the file may also hold, so a seed covers only the item kinds its records are. */
const HOLDS = { track: ['track', 'task', 'handoff'] };
export const seedCovers = (row, kind) => row.state !== 'seeded' || !row.kinds || row.kinds.some((k) => (HOLDS[k] || [k]).includes(kind));
/* a file row holds only the lines its run's coverage passed ([from, to, kind], to null for a whole-file item,
   which holds the kinds its kind does), so an item added for a gap is written; a row from before them holds its file */
export function linesHold(row, [from, to], kind) {
  if (!row || !Array.isArray(row.lines)) return true;
  for (let at = from; ;) {
    const ends = row.lines.filter(([a, b, k]) => a <= at && (b == null ? (HOLDS[k] || [k]).includes(kind) : at <= b)).map(([, b]) => (b == null ? Infinity : b));
    if (!ends.length) return false;
    at = Math.max(...ends) + 1;
    if (!Number.isFinite(at) || at > to) return true;
  }
}

/* a judgment (a keep, a drop, a kept or dropped clause) carries the evidence it rests on: readers
   (files that read or name its subject; a folder's code readers and live cites count), cites (paths that must still
   resolve), gone (paths that must stay gone), until (an event: a task done, a track's next handoff, a question
   answered, a date) and call (a user's answer). Only these are checked; the reason's words and shape ride along. */
const listOf = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
/* a clause's key in its file, by its words: a rewrite that moves its line keeps it */
export const clauseId = (file, text) => 'clause:' + slashed(file) + '#' + createHash('sha1').update(String(text || '').replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex').slice(0, 12);
const bare = (r) => slashed(r).replace(/:\d+$/, '');
/* paths only: a facts block copied whole ({ files: n, from: [...] }) gives its from, a count gives none */
const pathsOf = (v) => listOf(v && typeof v === 'object' && !Array.isArray(v) ? v.from : v).filter((x) => typeof x === 'string' && x.trim());
export function evidenceOf(ev) {
  const e = ev && typeof ev === 'object' ? ev : {};
  const out = {};
  const readers = [...new Set([...pathsOf(e.readers), ...pathsOf(e.codeReaders), ...pathsOf(e.liveCites)].map(bare).filter(Boolean))];
  if (readers.length) out.readers = readers;
  for (const k of ['cites', 'gone']) { const xs = [...new Set(pathsOf(e[k]).map(bare))]; if (xs.length) out[k] = xs; }
  if (e.until && typeof e.until === 'object' && Object.keys(e.until).length) out.until = e.until;
  if (e.call) out.call = String(e.call);
  const records = [...new Set(listOf(e.records).map((x) => String(x).trim()).filter(Boolean))];
  if (records.length) out.records = records;
  return out;
}
const DONE = ['done', 'dropped'];
const TRACK_ENDED = ['finished', 'dropped', 'done', 'folded'];
/* null while the event has not come, else why it has (or why it cannot be watched) */
export function eventCame(until, { tasks = new Map(), tracks = new Map(), answered = new Set(), today = new Date().toISOString().slice(0, 10) } = {}) {
  if (until.task) { const st = tasks.get(until.task); return st && !DONE.includes(st) ? null : until.task + (st ? ' is ' + st : ' is not open'); }
  if (until.track) {
    const t = tracks.get(until.track);
    if (!t) return until.track + ' is not on the board';
    if (TRACK_ENDED.includes(t.state)) return until.track + ' is ' + t.state;
    return (t.handoff || null) !== (until.seen || null) ? until.track + ' has had its next handoff (' + t.handoff + ')' : null;
  }
  if (until.question) return answered.has(until.question) ? until.question + ' is answered' : null;
  if (until.date) return today >= String(until.date) ? 'its date ' + until.date + ' has come' : null;
  return 'its event names nothing the board can watch';
}

/* the survey's board records as a lookup, so a rehearsal on a scratch board reads the statuses the live
   board had, with no call: a task closed, a decision or fact in force, a question answered holds. A ref is an id or
   id@key; records(ref) says why it holds, or null */
export function boardRecords(board) {
  const b = board || {};
  const all = [...[...(b.openTasks || []), ...(b.closedTasks || [])].map((t) => ({ ...t, kind: 'task' })),
    ...(b.decisions || []).map((d) => ({ ...d, kind: 'decision', status: 'in force' })),
    ...(b.knowledge || []).map((k) => ({ ...k, kind: 'knowledge', status: k.status || 'active' })), ...(b.questions || []).map((q) => ({ ...q, kind: 'question', status: 'answered' }))];
  return (ref) => {
    const m = /^([A-Z]{1,3}-\d+|Q\d+)(?:@([0-9a-z]{8}))?$/.exec(String(ref || '').trim());
    if (!m) return null;
    /* a key names its one record; an id alone, or a key no listed record carries, names the record by its id */
    const rec = (m[2] && all.find((x) => x.key === m[2])) || all.find((x) => x.id === m[1] && !(m[2] && x.key));
    if (!rec || !(rec.kind === 'task' ? DONE.includes(rec.status) : rec.kind === 'knowledge' ? rec.status === 'active' : true)) return null;
    return m[0] + ' is ' + rec.status;
  };
}

/* The map read against the repo now: { last, sources, folders, calls, judgments, markOf, counts }. hashOf(path) is a
   file's blob (its text's hash when HEAD holds no clean one); sigOf(folder/) a folder's sig; lastFolders the last run's
   sigs. reads(reader, path) says whether a reader is gone or still names a path; clauseHere(clauseId) whether a
   clause still stands in its file; board the tasks, tracks and answered questions an event is checked against.
   judge: false (the survey's default) leaves the earlier keeps and drops unchecked and unlisted. */
export const ENDED = ['delete', 'move'];
export function markMap(map, { hashOf, sigOf, exists, seeds = [], reads = () => true, clauseHere = () => true, board = {}, judge: rejudge = true }) {
  const rows = (map && map.rows) || [];
  const last = (map && map.last) || null;
  /* a path a run's handover retired (its folder or itself deleted or moved) and still not back is settled */
  const ends = rows.filter((r) => ENDED.includes(r.fate));
  const there = (p) => (isFolder(p) ? Boolean(sigOf(p)) : exists(p) || Boolean(sigOf(p + '/')));
  const retired = (p) => !there(p) && ends.some((e) => (isFolder(e.source) ? p.startsWith(e.source) : p === e.source));
  /* a call's subject that is not in the repo was written as none, and stays unchanged while it is still not there */
  const subjectOf = (p) => (isFolder(p) ? sigOf(p) || NONE : exists(p) ? hashOf(p) : NONE);
  const sources = [];
  const folders = [];
  const calls = [];
  for (const r of rows) {
    /* a row whose source is a ref outside the repo (github:owner/repo/issues/1) has nothing on disk to re-read: it stays converted */
    if (r.kind === 'file' && /^[a-z][a-z0-9+.-]+:/i.test(String(r.source || ''))) { sources.push({ source: r.source, records: r.records, state: 'outside', ...(r.gone ? { gone: r.gone } : {}), ...(r.detail && Array.isArray(r.detail.lines) ? { lines: r.detail.lines } : {}) }); continue; }
    /* a file row with a keep (a kept file that is also a source) lists its end as well as its source */
    if (r.kind === 'file' && (ENDED.includes(r.fate) || r.fate === 'keep')) folders.push({ folder: r.source, fate: r.fate, ...(r.why ? { why: r.why } : {}), ...(r.sha ? { at: r.sha } : {}), ...(r.detail && r.detail.to ? { to: r.detail.to } : {}) });
    if (r.kind === 'file' && retired(r.source)) {
      sources.push({ source: r.source, records: r.records, state: 'retired' });
    } else if (r.kind === 'file') {
      /* a file row naming a whole folder reads its tree's hash, as the write and the handover stamp it */
      const now = there(r.source) ? hashOf(r.source) : undefined;
      const state = now === undefined ? 'removed' : now && r.hash && now === r.hash ? 'unchanged' : 'changed';
      sources.push({ source: r.source, records: r.records, state, ...(r.gone ? { gone: r.gone } : {}), ...(r.detail && Array.isArray(r.detail.lines) ? { lines: r.detail.lines } : {}) });
    } else if (r.kind === 'folder' && !r.fate && (r.records || []).length) {
      /* a whole folder an earlier import's ref named, converted as one source */
      const now = sigOf(r.source);
      sources.push({ source: r.source, records: r.records, state: now == null ? 'removed' : now && now === r.hash ? 'unchanged' : 'changed', ...(r.gone ? { gone: r.gone } : {}) });
    } else if (r.kind === 'folder') {
      folders.push({ folder: r.source, fate: r.fate || null, ...(r.why ? { why: r.why } : {}), ...(r.sha ? { at: r.sha } : {}), ...(r.detail && r.detail.to ? { to: r.detail.to } : {}) });
    } else if (r.kind === 'call') {
      const subjects = (r.detail && r.detail.subjects) || {};
      const moved = Object.entries(subjects).filter(([p, h]) => !retired(p) && (!h || subjectOf(p) !== h)).map(([p]) => p);
      calls.push({ call: r.source.slice(CALL.length), ...(r.detail && r.detail.ask ? { ask: r.detail.ask } : {}), answer: r.answer, state: moved.length ? 'changed' : 'unchanged',
        ...(moved.length ? { changed: moved } : {}), subjects: Object.keys(subjects) });
    }
  }
  const mapped = new Set(sources.map((s) => s.source));
  for (const s of seeds) if (!mapped.has(s.source)) sources.push({ ...s, via: 'an earlier import' });
  const lastFolders = (last && last.detail && last.detail.folders) || null;
  const markOf = (folder) => (!lastFolders ? null : !(folder in lastFolders) ? 'new' : lastFolders[folder] === sigOf(folder) ? 'unchanged' : 'changed');
  const counts = {};
  for (const s of sources) counts[s.state] = (counts[s.state] || 0) + 1;
  for (const c of calls) counts['calls ' + c.state] = (counts['calls ' + c.state] || 0) + 1;
  /* what each run left out, counted per group answer; a row from before the counts names items, read as none */
  const left = [];
  for (const r of rows.filter((x) => x.kind === 'run')) for (const l of (r.detail && r.detail.left) || []) {
    if (Number.isInteger(l.count)) left.push({ ...(l.call ? { call: l.call } : {}), count: l.count, run: r.source.slice(RUN.length) });
  }
  const judgments = rejudge ? judge(rows, { there, hashOf, reads, clauseHere, board, calls }) : null;
  for (const j of judgments || []) counts['judgments ' + j.state] = (counts['judgments ' + j.state] || 0) + 1;
  /* the instruction files the newest run saw, so the doctor tells a switched setting */
  const saw = rows.filter((x) => x.kind === 'run' && x.detail && x.detail.instructions).sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0)).pop();
  return { last: last ? { run: last.source.slice(RUN.length), at: last.at, ...(last.sha ? { head: last.sha } : {}) } : null, sources, folders, calls, left, ...(judgments ? { judgments } : {}),
    ...(saw ? { instructions: { ...saw.detail.instructions, run: saw.source.slice(RUN.length) } } : {}), markOf, counts };
}

/* Each judgment the runs recorded, the newest run's per subject, re-checked: holds while it has evidence and every
   piece still stands, else rejudge with why. A folder or file kept with no judgment (a gate's hold, a keep from
   before judgments were recorded) is judged again; one whose subject left the repo is settled and not listed. */
function judge(rows, { there, hashOf, reads, clauseHere, board, calls }) {
  const runs = rows.filter((r) => r.kind === 'run').sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  const all = new Map();
  for (const r of runs) for (const j of (r.detail && r.detail.judged) || []) if (j && j.key) all.set(j.key, { ...j, run: r.source.slice(RUN.length) });
  for (const r of rows) {
    if (!(r.kind === 'folder' || r.kind === 'file') || r.fate !== 'keep') continue;
    const key = (isFolder(r.source) ? 'folder:' : 'file:') + r.source;
    if (!all.has(key)) all.set(key, { key, kind: isFolder(r.source) ? 'folder' : 'file', subject: r.source, fate: 'keep', why: r.why || null, run: r.run || null });
  }
  const callState = new Map((calls || []).map((c) => [c.call, c.state]));
  const out = [];
  for (const j of all.values()) {
    const subject = j.subject;
    const ev = evidenceOf(j.evidence);
    /* a dropped clause leaves its file with the rewrite, and its evidence is still re-checked */
    const left = j.kind === 'clause' && !clauseHere(j.key) && !(j.fate === 'drop' && Object.keys(ev).length);
    if (j.kind === 'clause' ? !there(subject) || left : !subject || !there(subject)) continue;
    const because = [];
    if (!Object.keys(ev).length) because.push('no evidence recorded');
    const named = subject.replace(/\/+$/, '');
    for (const r of ev.readers || []) {
      const seen = reads(r, named);
      if (seen === 'gone') because.push('its reader ' + r + ' is gone');
      else if (seen === false && j.kind !== 'clause') because.push(r + ' no longer names ' + named);
    }
    /* a stale or superseded cut whose evidence is only its own file, as coverage refuses it */
    if (j.kind === 'item' && ownOnly(j, subject)) because.push(OWN_ONLY);
    for (const p of ev.cites || []) if (!there(p)) because.push('its cite ' + p + ' no longer resolves');
    for (const p of ev.gone || []) if (there(p)) because.push(p + ' is in the tree');
    if (ev.until) { const came = eventCame(ev.until, board); if (came) because.push(came); }
    for (const id of board.records ? ev.records || [] : []) if (!board.records(id)) because.push(id + ' no longer holds');
    if (ev.call && callState.get(ev.call) !== 'unchanged') because.push('the call ' + ev.call + (callState.has(ev.call) ? '\'s subjects changed' : ' is not on the map'));
    if ((j.kind === 'item' || j.kind === 'file') && j.hash && hashOf(subject) !== j.hash) because.push(subject + ' changed since');
    out.push({ key: j.key, kind: j.kind, subject, ...(j.clause ? { clause: j.clause } : {}), fate: j.fate, ...(j.why ? { why: j.why } : {}), ...(j.shape ? { shape: j.shape } : {}),
      ...(Object.keys(ev).length ? { evidence: ev } : {}), run: j.run, state: because.length ? 'rejudge' : 'holds', ...(because.length ? { because } : {}) });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/* What the plan's rerun skip reads: a source the map holds, unchanged since or outside the repo, or seeded by an earlier import. */
export function coveredBy(conversion) {
  const m = new Map();
  for (const s of (conversion && conversion.sources) || []) if (s.state === 'unchanged' || s.state === 'outside' || s.state === 'seeded') m.set(s.source, s);
  return m;
}
