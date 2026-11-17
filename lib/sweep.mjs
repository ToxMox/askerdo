/* The on-demand session sweep: this PC's transcripts for a scope digested, the lines that
   name something left filtered out, the board read for closed tasks whose last note names
   something left and inbox tasks woken with no home, and a brief for one reader agent.
   It writes only under this PC's data folder; transcripts and the board are read only. */
import { closeSync, createReadStream, mkdirSync, openSync, readSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pluginRoot } from './node-helpers.mjs';
import { checkoutOf, sharedName } from './project-id.mjs';
import { parseStamp, stampNow } from './stamps.mjs';
import { writeAtomic } from './store-io.mjs';
import { leftUndone } from './left-undone.mjs';
import { LEFT_AT_CLOSE } from '../server/handoff-text.mjs';

export const SWEEPS = 'sweeps';
const KEEP = 5;
const LAST = 'last.json';
const ENDED = ['done', 'dropped'];
const FOLDER_RE = /^\d{4}-\d{2}-\d{2}-\d{6}-/;

const pad = (n) => String(n).padStart(2, '0');
const cut = (s, n) => (s.length > n ? s.slice(0, n) + ' [...' + (s.length - n) + ' more chars]' : s);
const one = (s, n) => cut(String(s ?? '').replace(/\s+/g, ' ').trim(), n);
const clock = (ms) => { const d = new Date(ms); return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dayOf = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const list = (dir) => { try { return readdirSync(dir); } catch { return []; } };
const statOf = (p) => { try { return statSync(p); } catch { return null; } };
const kb = (n) => (n < 1024 ? n + ' B' : Math.round(n / 1024) + ' KB');

/* The app's own transcripts folder; a sandbox has no sessions of its own, so it reads the
   real one, which the sweep never writes. */
export function transcriptsDir(env = process.env) {
  const cfg = String(env.CLAUDE_CONFIG_DIR ?? '').trim();
  return join(cfg && isAbsolute(cfg) ? cfg : join(homedir(), '.claude'), 'projects');
}

function headOf(file, bytes) {
  const fd = openSync(file, 'r');
  try {
    const b = Buffer.alloc(bytes);
    return b.subarray(0, readSync(fd, b, 0, bytes, 0)).toString('utf8');
  } finally { closeSync(fd); }
}

/* A transcript's first cwd and first time, from its head alone (a first line can hold images). */
export function probe(file) {
  let cwd = '';
  let first = null;
  for (const bytes of [262144, 4194304]) {
    const head = headOf(file, bytes);
    for (const line of head.split('\n')) {
      if (!line.includes('"cwd"') && !line.includes('"timestamp"')) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (!cwd && typeof o.cwd === 'string') cwd = o.cwd;
      if (first === null && o.timestamp) first = Date.parse(o.timestamp) || null;
      if (cwd && first !== null) return { cwd, first };
    }
    if (Buffer.byteLength(head) < bytes) break;
  }
  return { cwd, first };
}

/* The project's sessions: every transcript in a folder whose sessions ran in a checkout of
   the project, touched at or after `sinceMs`. */
export function projectSessions(dir, name, sinceMs) {
  const names = new Map();
  const out = [];
  for (const folder of list(dir)) {
    const path = join(dir, folder);
    const files = list(path).filter((f) => f.endsWith('.jsonl'));
    let cwd = '';
    for (const f of files) { cwd = probe(join(path, f)).cwd; if (cwd) break; }
    if (!cwd) continue;
    if (!names.has(cwd)) names.set(cwd, sharedName(cwd));
    if (names.get(cwd) !== name) continue;
    for (const f of files) {
      const st = statOf(join(path, f));
      if (st && (sinceMs === null || st.mtimeMs >= sinceMs)) out.push({ id: f.slice(0, -6), file: join(path, f), bytes: st.size });
    }
  }
  return out;
}

/* Each named session's transcript on this PC, in whichever project folder it ran. */
export function sessionFiles(dir, ids) {
  const found = new Map();
  const folders = list(dir);
  for (const id of ids) {
    for (const folder of folders) {
      const file = join(dir, folder, id + '.jsonl');
      const st = statOf(file);
      if (st && st.isFile()) { found.set(id, { id, file, bytes: st.size }); break; }
    }
  }
  return found;
}

/* The sessions a track's board lines name, each with the span it worked the track: from its
   first line there to its lease's end, open while it still holds the track. */
export function trackWindows(lines, handoffs = []) {
  const w = new Map();
  const touch = (id, t) => {
    const x = w.get(id) || { from: t, to: t, holds: false };
    x.from = Math.min(x.from, t);
    x.to = Math.max(x.to, t);
    w.set(id, x);
    return x;
  };
  for (const l of [...lines].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    const t = Date.parse(l.ts);
    if (!Number.isFinite(t)) continue;
    const s = l.changes && l.changes.session;
    if (Array.isArray(s)) {
      if (s[0]) touch(s[0], t).holds = false;
      if (s[1]) touch(s[1], t).holds = true;
    }
    const by = /^session:(.+)$/.exec(String(l.by || ''));
    if (by) touch(by[1], t);
  }
  for (const h of handoffs) {
    const t = Date.parse(h.created);
    if (h.fromSession && Number.isFinite(t)) touch(h.fromSession, t);
  }
  return [...w].map(([id, x]) => ({ id, from: x.from, to: x.holds ? null : x.to }));
}

/* ---- the digest ---------------------------------------------------------- */

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
/* a slash command the user typed, as they typed it */
const COMMAND = /<command-name>([\s\S]*?)<\/command-name>\s*(?:<command-message>[\s\S]*?<\/command-message>\s*)?(?:<command-args>([\s\S]*?)<\/command-args>)?/g;

function userText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some((b) => b && b.type === 'tool_result')) return null;
  return content.map((b) => (b.type === 'text' ? b.text : b.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n');
}

/* A user-side line's kind: what the user typed, a kickoff or plugin note, an agent's or
   side session's report, a task notification, or another event. */
function userKind(o, text) {
  const k = o.origin && o.origin.kind;
  if (k === 'human') return 'USER';
  if (k === 'task-notification') return 'TASK';
  if (k === 'peer' || /<agent-message|Another Claude session sent a message/.test(text)) return 'REPORT';
  if (o.isMeta) return null;
  if (k === 'plugin') return /\bFocus: /.test(text) ? 'KICKOFF' : 'PLUGIN';
  return 'EVENT';
}
const LIMIT = { USER: 6000, KICKOFF: 3500, REPORT: 1800 };
const PROMPTS = ['USER', 'KICKOFF'];

const BOARD_WRITE = /\b(task create|task edit|task update|note|decide|track (?:capture|layout|finish|drop|park|new|splinter)|knowledge (?:new|supersede|amend)|register|answer|drop|snooze|profile rule-(?:add|drop)|edge add|check add|handoff (?:write|update))\b/;

/* One line for what a tool call filed, committed or dispatched; null for the rest. */
function toolLine(t) {
  const i = t.input || {};
  const n = String(t.name || '');
  if (n === 'Agent' || n === 'Task') return 'AGENT DISPATCH: ' + one(i.name || '', 60) + ' "' + one(i.description || '', 120) + '" model=' + (i.model || i.subagent_type || 'session');
  const board = /^mcp__.*askerdo.*?__([a-z_]+)$/.exec(n);
  if (board) {
    const v = board[1];
    if (v === 'ask') return 'ASK: ' + one(i.name || '', 120) + ' :: ' + one(i.ask || '', 400) + (i.edits ? ' (edits ' + i.edits + ')' : '');
    if (v === 'answer') return 'ANSWER RECORDED: ' + [i.id, i.pick, i.drop ? 'drop' : '', one(i.note || '', 200)].filter(Boolean).join(' ');
    if (v === 'decide') return 'DECIDE: ' + one(i.title || '', 300) + ' :: words ' + one(i.words || '', 300);
    if (v === 'task_update') return 'TASK UPDATE: ' + [i.id, i.status, i.name ? 'name=' + one(i.name, 150) : '', i.note ? 'note=' + one(i.note, 300) : ''].filter(Boolean).join(' ');
    if (v === 'note') return 'NOTE on ' + i.id + ': ' + one(i.body || '', 300);
    if (v === 'handoff_write') {
      return 'HANDOFF WRITE: focus=' + one(i.focus || '', 300) + ' leftovers=' + JSON.stringify((i.leftovers || []).map((l) => l.name || l.task))
        + ' waitingOnUser=' + JSON.stringify(i.waitingOnUser || []);
    }
    if (v === 'handoff_update') return 'HANDOFF UPDATE: ' + one(JSON.stringify(i.ops || []), 400);
    if (['depth', 'coverage'].includes(v)) return null;
    return 'ASKERDO ' + v + ': ' + one(JSON.stringify(i), 200);
  }
  if (n === 'Bash' || n === 'PowerShell') {
    const c = String(i.command || '');
    if (/(?:cli|askerdo)\.mjs/.test(c) && BOARD_WRITE.test(c)) return 'BOARD CMD: ' + one(c, 500);
    if (/\bgit\b[^\n]*\b(?:commit|push|merge|worktree (?:add|remove))\b/.test(c)) return 'GIT: ' + one(c, 250);
    return null;
  }
  if (/__start_session$/.test(n)) return 'START SESSION: ' + one(i.title || '', 150);
  if (/__wrap_up$/.test(n)) return 'NEXT-STEP BOX: recap=' + one(i.recap || '', 300) + (i.ask ? ' ask=' + one(i.ask, 150) : '');
  return null;
}

/* Lines worth parsing: a prompt, an assistant turn or the title; the rest is skipped on its head. */
function worthParsing(line) {
  const head = line.slice(0, 400);
  if (head.startsWith('{"type":"')) return head.startsWith('{"type":"custom-title"');
  if (head.includes('"isSidechain":true') || head.includes('"attachment":{') || head.includes('"type":"system"')) return false;
  return !head.includes('"content":[{"tool_use_id"');
}

/* One session's digest: its own turns inside the window, as text, plus the items the
   filters read. `seen` holds the message ids of sessions digested before, so a turn
   copied from one (a fork, a side question) is left out; a copy also keeps its origin's
   session id. From a window's start the turn's prompt is kept; past its end, the rest of
   that turn. */
export async function digestSession({ id, file, from = null, to = null, seen = new Set() }) {
  const out = [];
  const items = [];
  let title = '';
  let cwd = '';
  let first = null;
  let last = null;
  let copied = 0;
  let state = from === null ? 'in' : 'before';
  let pending = null;
  const emit = (e) => {
    out.push(e.tool ? '[' + clock(e.ts) + '] ' + e.text : '\n[' + clock(e.ts) + '] ' + e.kind + ':\n' + e.text);
    if (!e.tool) items.push(e);
    if (first === null) first = e.ts;
    last = e.ts;
  };
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line || !worthParsing(line)) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'custom-title') { if (o.customTitle) title = o.customTitle; continue; }
      if (!o.message || o.isSidechain) continue;
      if ((o.sessionId && o.sessionId !== id) || (o.uuid && seen.has(o.uuid))) { copied++; continue; }
      if (o.uuid) seen.add(o.uuid);
      if (!cwd && typeof o.cwd === 'string') cwd = o.cwd;
      const ts = Date.parse(o.timestamp);
      if (!Number.isFinite(ts)) continue;
      const entries = [];
      if (o.type === 'user') {
        const raw = userText(o.message.content);
        if (raw === null) continue;
        const kind = userKind(o, raw);
        const text = raw.replace(REMINDER, '').replace(COMMAND, (m, name, args) => (name + ' ' + (args || '')).trim()).trim();
        if (!kind || !text) continue;
        if (kind === 'TASK') {
          const s = (text.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1];
          if (s) entries.push({ ts, kind, tool: true, text: 'TASK NOTIFICATION: ' + one(s, 200) });
        } else entries.push({ ts, kind, text: cut(text, LIMIT[kind] || 600) });
      } else if (o.type === 'assistant' && Array.isArray(o.message.content)) {
        for (const b of o.message.content) {
          if (b.type === 'text' && b.text && b.text.trim()) entries.push({ ts, kind: 'CLAUDE', text: b.text.trim() });
          else if (b.type === 'tool_use') { const t = toolLine(b); if (t) entries.push({ ts, kind: 'TOOL', tool: true, text: t }); }
        }
      }
      for (const e of entries) {
        const prompt = PROMPTS.includes(e.kind);
        if (state === 'before') {
          if (ts < from) { if (prompt) pending = e; continue; }
          state = 'in';
          if (pending && !prompt) emit(pending);
        }
        if (state === 'in' && to !== null && ts > to) state = 'after';
        if (state === 'after' && prompt) { state = 'done'; break; }
        emit(e);
      }
      if (state === 'done') break;
    }
  } finally {
    rl.close();
  }
  const day = first === null ? 'none' : dayOf(first);
  const head = '# Session ' + id + '\ncwd: ' + cwd + '\ntitle: ' + title + '\nspan: ' + (first === null ? 'nothing in the window'
    : new Date(first).toISOString() + ' to ' + new Date(last).toISOString()) + (copied ? '\ncopied from another session and left out: ' + copied + ' lines' : '') + '\n';
  return { id, title, cwd, first, last, copied, name: day + '_' + id.slice(0, 8) + '.md', text: head + out.join('\n') + '\n', items };
}

/* ---- the filters ---------------------------------------------------------- */

const USER_CUT = 1500;
const LINE_CUT = 500;

/* Every message the user typed, and each reply, report or kickoff line that names something left. */
export function candidatesOf(digests) {
  const user = [];
  const lines = [];
  for (const d of digests) {
    const said = new Set();
    for (const e of d.items) {
      if (e.kind === 'USER') { user.push({ digest: d.name, title: d.title, ts: e.ts, text: one(e.text, USER_CUT) }); continue; }
      if (!['CLAUDE', 'REPORT', 'KICKOFF'].includes(e.kind)) continue;
      for (const raw of e.text.split('\n')) {
        const l = raw.trim();
        const hit = l && leftUndone(l);
        if (!hit || said.has(l)) continue;
        said.add(l);
        lines.push({ digest: d.name, title: d.title, ts: e.ts, kind: e.kind, hit, text: one(l, LINE_CUT) });
      }
    }
  }
  return { user, lines };
}

function grouped(rows, line) {
  const out = [];
  let at = null;
  for (const r of rows) {
    if (r.digest !== at) { at = r.digest; out.push('', '### ' + r.digest + (r.title ? ' (' + one(r.title, 80) + ')' : '')); }
    out.push(line(r));
  }
  return out;
}

export function candidatesText(c, scope) {
  return ['# What the sessions said (sweep of ' + scope + ')', '',
    'The user\'s words: every message the user typed, cut at ' + USER_CUT + ' characters (' + c.user.length + '). Then each reply, report or kickoff line that names something left, with the words that matched (' + c.lines.length + ').',
    '', '## The user\'s words', ...grouped(c.user, (r) => '- [' + clock(r.ts) + '] ' + r.text),
    '', '## Lines that name something left', ...grouped(c.lines, (r) => '- [' + clock(r.ts) + '] ' + r.kind + ' ("' + r.hit + '"): ' + r.text), ''].join('\n');
}

/* ---- the board scan ------------------------------------------------------- */

const isClose = (l) => l && l.changes && Array.isArray(l.changes.status) && ENDED.includes(l.changes.status[1]);
const inside = (t, w) => (w.from === null || t >= w.from) && (w.to === null || t <= w.to);
const notesOf = (journal) => String(journal || '').trim().split(/\n\n(?=\d{4}-\d{2}-\d{2}(?:T[\d:+-]+)?: )/);
const lastNote = (journal) => notesOf(journal).pop() || '';
/* the board notes a close's leftovers with the close; one from a close before a reopen does not count */
const filedAtClose = (journal, closed) => notesOf(journal).some((n) => {
  const at = Date.parse((/^(\S+): /.exec(n) || [])[1]);
  return LEFT_AT_CLOSE.test(n) && !(Date.parse(closed) - at > 60e3);
});

function monthsSince(ms, now) {
  const out = [];
  const d = new Date(ms);
  for (let y = d.getFullYear(), m = d.getMonth(); y * 12 + m <= new Date(now).getFullYear() * 12 + new Date(now).getMonth(); m++) {
    if (m === 12) { m = 0; y++; }
    out.push(y + '-' + pad(m + 1));
  }
  return out;
}

/* Closed tasks in scope whose closing note or last journal note names something left, and
   inbox tasks whose wake has come with no new home. A track's scope is the tasks its
   sessions closed while on it, and its own; a project's, the tasks closed there since. */
export async function boardScan(call, { track = null, sessions = [], since = null, project = '', now = Date.now() }) {
  const closes = new Map();
  const keep = (l) => { if (!closes.has(l.id)) closes.set(l.id, { id: l.id, name: l.name, status: l.changes.status[1], at: l.ts, note: l.note || '' }); };
  if (track) {
    for (const s of sessions) {
      const r = await call('activity', { kind: 'task', search: 'session:' + s.id, limit: 0 });
      for (const l of r.lines || []) if (isClose(l) && inside(Date.parse(l.ts), s)) keep(l);
    }
    const f = await call('trackFound', { track });
    for (const t of f.tasks || []) if (ENDED.includes(t.status) && !closes.has(t.id)) closes.set(t.id, { id: t.id, name: t.name, status: t.status, at: '', note: '' });
  } else {
    for (const month of monthsSince(since, now)) {
      const r = await call('activity', { kind: 'task', month, limit: 0, projectRepo: project });
      for (const l of r.lines || []) if (isClose(l) && Date.parse(l.ts) >= since) keep(l);
    }
  }
  const closed = [];
  for (const c of closes.values()) {
    const rec = await call('readRecord', { id: c.id });
    if (!ENDED.includes(rec.status) || filedAtClose(rec.journal, rec.closed)) continue;
    const last = lastNote(rec.journal);
    const hit = leftUndone(c.note) || leftUndone(last);
    if (hit) closed.push({ ...c, name: rec.name || c.name, status: rec.status, at: c.at || rec.closed || '', hit, note: leftUndone(c.note) ? c.note : last });
  }
  const inbox = [];
  if (track) {
    const k = await call('trackKickoff', { track });
    for (const t of k.inbox || []) if (t.due && !t.asked) inbox.push({ id: t.id, name: t.name, workstream: t.workstream && t.workstream.id, wake: t.wake });
  } else {
    const ws = (await call('listWork', { kind: 'workstream' })).filter((w) => (w.projectRepos || []).includes(project));
    for (const w of ws) {
      const v = await call('workstreamView', { workstream: w.id });
      for (const t of v.inboxList || []) {
        if (!t.due) continue;
        const asked = await call('waitsOn', t.id);
        if (!asked.length) inbox.push({ id: t.id, name: t.name, workstream: w.id, wake: t.wake && (t.wake.id || t.wake.date) });
      }
    }
  }
  return { checked: closes.size, closed, inbox };
}

export function boardScanText(s, scope) {
  return ['# The board scan (sweep of ' + scope + ')', '',
    '## Closed tasks whose last note names something left (' + s.closed.length + ' of ' + s.checked + ' closed in scope)', '',
    ...(s.closed.length ? s.closed.map((t) => '- ' + t.id + ' ' + one(t.name, 120) + ' (' + t.status + (t.at ? ' ' + String(t.at).slice(0, 10) : '') + ', "' + t.hit + '"): ' + one(t.note, 600)) : ['None.']),
    '', '## Inbox tasks whose wake has come with no new home (' + s.inbox.length + ')', '',
    ...(s.inbox.length ? s.inbox.map((t) => '- ' + t.id + ' ' + one(t.name, 120) + (t.workstream ? ' (' + t.workstream + ')' : '') + (t.wake ? ', wake ' + one(typeof t.wake === 'string' ? t.wake : JSON.stringify(t.wake), 80) : '')) : ['None.']), ''].join('\n');
}

/* ---- the run --------------------------------------------------------------- */

function readLast(root) {
  try { const j = JSON.parse(readFileSync(join(root, LAST), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}

/* The newest few sweep folders stay; older ones this verb made go. */
function prune(root) {
  const gone = [];
  for (const f of list(root).filter((n) => FOLDER_RE.test(n)).sort().reverse().slice(KEEP)) {
    try { rmSync(join(root, f), { recursive: true, force: true }); gone.push(f); } catch {}
  }
  return gone;
}

function briefText(vars) {
  const template = readFileSync(join(pluginRoot, 'skills', 'sweep', 'reader.md'), 'utf8');
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}

/* scope: { track } or { since: 'YYYY-MM-DD' } or { sinceLast: true }. `call` reads the board;
   `data` is this PC's data folder and `transcripts` the app's transcripts folder. */
export async function runSweep({ scope, call, cwd, data, transcripts, now = Date.now() }) {
  const t0 = Date.now();
  const root = join(data, SWEEPS);
  const project = sharedName(cwd);
  const repo = checkoutOf(cwd);
  let label;
  let slug;
  let wanted;
  let missing = [];
  let since = null;
  let trackName = '';
  let held = [];
  if (scope.track) {
    const track = String(scope.track).toUpperCase();
    const act = await call('activity', { id: track, kind: 'track', limit: 0 });
    const hs = await call('trackHandoffs', { track });
    trackName = ((act.lines || [])[0] || {}).name || '';
    const windows = trackWindows(act.lines || [], hs.handoffs || []);
    /* the board scan reads every session's closes, on this PC or not */
    held = windows;
    const found = sessionFiles(transcripts, windows.map((w) => w.id));
    wanted = windows.filter((w) => found.has(w.id)).map((w) => ({ ...found.get(w.id), from: w.from, to: w.to }));
    missing = windows.filter((w) => !found.has(w.id)).map((w) => w.id);
    label = hs.track || track;
    slug = label.toLowerCase();
  } else {
    if (!project) throw Object.assign(new Error('this folder is no project the sweep can name: ' + cwd), { usage: true });
    if (scope.sinceLast) {
      const last = readLast(root)[project];
      if (!last) throw Object.assign(new Error('this PC has no sweep of ' + project + ' yet: name a day with --since YYYY-MM-DD'), { usage: true });
      since = parseStamp(last).ms;
      label = 'the project since the last sweep (' + last + ')';
      slug = 'since-last';
    } else {
      const p = parseStamp(scope.since);
      if (!p) throw Object.assign(new Error('--since takes YYYY-MM-DD or a full stamp: ' + scope.since), { usage: true });
      since = p.ms;
      label = 'the project since ' + scope.since;
      slug = 'since-' + p.day;
    }
    wanted = projectSessions(transcripts, project, since).map((s) => ({ ...s, from: since, to: null }));
  }
  for (const s of wanted) s.first = probe(s.file).first ?? 0;
  wanted.sort((a, b) => a.first - b.first || a.id.localeCompare(b.id));

  const d = new Date(now);
  const folder = join(root, dayOf(now) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '-' + slug);
  const digestDir = join(folder, 'digests');
  mkdirSync(digestDir, { recursive: true });
  const seen = new Set();
  const digests = [];
  let digestBytes = 0;
  for (const s of wanted) {
    const g = await digestSession({ id: s.id, file: s.file, from: s.from, to: s.to, seen });
    if (!g.items.length) continue;
    writeFileSync(join(digestDir, g.name), g.text);
    digestBytes += Buffer.byteLength(g.text);
    digests.push({ name: g.name, title: g.title, items: g.items });
  }
  const scopeWords = scope.track ? label + (trackName ? ' (' + trackName + ')' : '') : label;
  const c = candidatesOf(digests);
  const candidates = candidatesText(c, scopeWords);
  writeFileSync(join(folder, 'candidates.md'), candidates);
  const scan = await boardScan(call, { track: scope.track ? label : null, sessions: held, since, project, now });
  const scanText = boardScanText(scan, scopeWords);
  writeFileSync(join(folder, 'board-scan.md'), scanText);
  const span = wanted.length ? dayOf(wanted[0].from ?? wanted[0].first) + ' to ' + dayOf(now) : 'no sessions';
  const brief = briefText({
    scope: scopeWords, sessions: digests.length, span, folder: folder.replace(/\\/g, '/'), repo,
    candidates: join(folder, 'candidates.md').replace(/\\/g, '/'), boardScan: join(folder, 'board-scan.md').replace(/\\/g, '/'),
    digests: digestDir.replace(/\\/g, '/'), transcripts: transcripts.replace(/\\/g, '/'),
  });
  writeFileSync(join(folder, 'brief.md'), brief);

  /* a sweep of the project leaves no gap behind the last one, so the next --since-last starts here */
  let recorded = false;
  if (!scope.track) {
    const all = readLast(root);
    const prev = all[project] ? parseStamp(all[project]) : null;
    if (!prev || since <= prev.ms) {
      writeAtomic(join(root, LAST), JSON.stringify({ ...all, [project]: stampNow(new Date(t0)) }, null, 2) + '\n');
      recorded = true;
    }
  }
  const pruned = prune(root);
  return {
    scope: scopeWords, folder, project, recorded, pruned, took: Date.now() - t0,
    sessions: { digested: digests.length, quiet: wanted.length - digests.length, elsewhere: missing.length, missing },
    files: [
      { name: 'digests', count: digests.length, bytes: digestBytes },
      { name: 'candidates.md', user: c.user.length, lines: c.lines.length, bytes: Buffer.byteLength(candidates) },
      { name: 'board-scan.md', checked: scan.checked, closed: scan.closed.length, inbox: scan.inbox.length, bytes: Buffer.byteLength(scanText) },
      { name: 'brief.md', bytes: Buffer.byteLength(brief) },
    ],
  };
}

export function sweepText(r) {
  const [dg, cand, scan, brief] = r.files;
  const s = r.sessions;
  return ['Swept ' + r.scope + ': ' + s.digested + (s.digested === 1 ? ' session' : ' sessions') + ' digested'
    + (s.quiet ? ', ' + s.quiet + ' with nothing in the window' : '')
    + (s.elsewhere ? ', ' + s.elsewhere + ' the board names not on this PC' : '') + ' (' + Math.round(r.took / 1000) + ' s)',
  'Folder: ' + r.folder,
  '  digests/       ' + dg.count + ' files, ' + kb(dg.bytes),
  '  candidates.md  ' + cand.user + ' user messages, ' + cand.lines + ' lines naming something left, ' + kb(cand.bytes),
  '  board-scan.md  ' + scan.closed + ' of ' + scan.checked + ' closed tasks with a last note naming something left, ' + scan.inbox + ' inbox tasks woken with no home, ' + kb(scan.bytes),
  '  brief.md       the reader\'s brief, ' + kb(brief.bytes),
  'Next: give brief.md to one reader agent (opus, read only; its report is its final response), then home each LOST and FILED-STALE finding: /askerdo:sweep does both.'].join('\n');
}
