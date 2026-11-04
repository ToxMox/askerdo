/* Inbox lines and tray alerts from the board's activity rows: who hears
   each row, the gate holders included, and the tray's alerts. Each line carries its
   row's sequence, so a replay never tells twice. */
/* Also the inbox's own file names, the line a drain injects and the root's .lock,
   so the local server and a spawned mod-inbox take the same lock. */
import {
  appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { answerToken } from './answer-token.mjs';
import { appendLog } from './store-io.mjs';

/* ids are the filename, so hostile values are sanitized to stay inside inbox/;
   the sanitized stem IS the identity, or a colliding id would be delivered twice */
export const inboxName = (session) => String(session).replace(/[^A-Za-z0-9._-]/g, '-');

export function inboxFile(root, session) {
  return join(root, 'inbox', inboxName(session) + '.jsonl');
}

/* Both drains derive the pattern from the same inbox path, which is what makes
   them one protocol; crash leftovers drain in filename order. */
export function processingPrefix(inbox) {
  return basename(inbox, '.jsonl') + '.processing-';
}

const sessionOfBy = (by) => {
  const m = /^(?:session|user):(.+)$/.exec(String(by || ''));
  return m ? m[1] : null;
};
const sessionAuthored = (by) => /^session:/.test(String(by || ''));
const userAuthored = (by) => /^user(?::|$)/.test(String(by || ''));
const to = (changes, k) => (changes && Array.isArray(changes[k]) ? changes[k][1] : undefined);
const from = (changes, k) => (changes && Array.isArray(changes[k]) ? changes[k][0] : undefined);
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/* An edit's tail: what moved, never a payload. */
function detailOf(changes) {
  const parts = [];
  for (const [k, v] of Object.entries(changes || {})) {
    const now = Array.isArray(v) ? v[1] : v;
    if (Array.isArray(now)) parts.push(k);
    else parts.push(now === null || now === undefined || now === '' ? k + ' cleared' : k + ' ' + flat(now));
  }
  return parts.join(', ') || null;
}

/* a task edit that moves the hand, its own row or the board's status following
   it, reads in the hand's words ("taken in hand", "let go", "taken over"); the status that
   followed is left out, any other change kept after it. */
function handDetail(ev) {
  const ch = ev.changes;
  const st = ch && Array.isArray(ch.status) ? ch.status : null;
  const follows = (s) => s === 'open' || s === 'in_progress';
  if (st && !follows(st[1])) return null;
  let words = null;
  if (ch && Array.isArray(ch.inHand)) words = ch.inHand[0] && ch.inHand[1] ? 'taken over' : ch.inHand[1] ? 'taken in hand' : 'let go';
  else if (ev.by === 'board:upkeep' && st && Object.keys(ch).length === 1) words = st[1] === 'in_progress' ? 'taken in hand' : 'let go';
  if (!words) return null;
  const bySession = sessionAuthored(ev.by) || (typeof ev.for === 'string' && ev.for);
  const rest = detailOf(Object.fromEntries(Object.entries(ch).filter(([k]) => k !== 'inHand' && k !== 'status')));
  return words + (bySession ? ' by another session' : '') + (rest ? ', ' + rest : '');
}

/* the kind prefix per work kind ('task-edit', 'ws-close') */
const WORK_PREFIX = { task: 'task', workstream: 'ws' };

/* What one activity row tells: [{ session, line }] for the inboxes and the alert
   events. `ctx` answers lookups from the cache: question(ev) for a question's
   record (subscribers, gates, track, answer), holder(trackLabel), task(label), tracksOf(ws). */
export async function tellingsOf(ev, ctx) {
  const h = ev.head || {};
  const base = { at: ev.at, id: h.label || ev.id, key: h.key || undefined, name: h.title ?? '', by: ev.by, seq: ev.seq };
  const actor = sessionAuthored(ev.by) ? sessionOfBy(ev.by) : null;
  /* a row the board wrote for a session's own act (its task taken in hand) is not news to it */
  const cause = typeof ev.for === 'string' && ev.for ? ev.for : null;
  const out = { lines: [], questions: [], work: [] };
  const tell = (sessions, line) => {
    const seen = new Set();
    for (const s of sessions) {
      if (!s || s === actor || s === cause || seen.has(inboxName(s))) continue;
      seen.add(inboxName(s));
      out.lines.push({ session: s, line: { ...base, ...line } });
    }
  };
  if (ev.kind === 'question') {
    const needQ = ['answer', 'amend', 'drop', 'wake', 'snooze', 'edit', 'create'].includes(ev.verb);
    const q = needQ ? await ctx.question(ev) : null;
    const subs0 = (q && q.subscribers) || (h.session ? [h.session] : []);
    const presser = userAuthored(ev.by) ? sessionOfBy(ev.by) : null;
    /* the session holding the question's track hears it, a resumed leg included */
    const holder = q && q.track ? ctx.holder(q.track) : null;
    /* a press in a session that does not own the question
       (the track's holder, else the asker) is told to the owner only, never back to it */
    const owner = holder || (q && q.session) || h.session || null;
    const subs = presser && presser !== owner ? subs0.filter((s) => inboxName(s) !== inboxName(presser)) : subs0;
    const own = presser && presser === owner ? presser : null;
    /* the user's press in a session on this PC draws no tray popup; the mod toasted it there */
    const pressedHere = !!presser && typeof ctx.here === 'function' && ctx.here(presser, ev.pc);
    if (ev.verb === 'answer' || ev.verb === 'amend') {
      tell([...subs, own, holder], { kind: 'answer', pick: to(ev.changes, 'chosen') ?? null, note: noteOf(ev, q), ...(ev.verb === 'amend' ? { amended: true } : {}) });
      /* snoozed to answered is not an event for the tray */
      if (ev.verb === 'answer' && from(ev.changes, 'status') !== 'snoozed' && !pressedHere) out.questions.push({ kind: 'closed', status: 'answered' });
    } else if (ev.verb === 'drop') {
      tell([...subs, own, holder], { kind: 'drop', note: ev.note || null });
      if (!pressedHere) out.questions.push({ kind: 'closed', status: 'dropped' });
    } else if (ev.verb === 'snooze') {
      /* only the user's snooze from a card mints one */
      if (userAuthored(ev.by)) tell([...subs, own], { kind: 'snooze', detail: to(ev.changes, 'snooze') ?? null });
    } else if (ev.verb === 'wake') {
      /* the linked and the dated wake tell; the hand wake stays silent */
      if (ev.note) tell([...subs, holder], { kind: 'wake', note: ev.note });
      const by = /^woken by (.+)$/.exec(String(ev.note || ''));
      const dated = !by && /snooze date/.test(String(ev.note || ''));
      out.questions.push({ kind: 'open', status: 'open', woken: true, ...(by ? { wokeBy: by[1] } : {}), ...(dated ? { wokeOnDate: true } : {}) });
    } else if (ev.verb === 'create') {
      out.questions.push({ kind: 'open', status: 'open' });
      const gates = (q && q.gates) || [];
      if (h.blocking === true && gates.length) tell(await holdersOf(gates, ctx), { kind: 'question-edit', detail: 'asked as a blocker on ' + gates.join(', ') });
    } else if (ev.verb === 'edit') {
      if (!actor && Object.keys(ev.changes || {}).length) tell(subs, { kind: 'question-edit', detail: detailOf(ev.changes) });
      /* gates added to an open blocker reach those tasks' holders, as at registration */
      const added = addedGates(ev.changes, q);
      if (added.length && q.blocking === true && q.status === 'open') {
        tell(await holdersOf(added, ctx), { kind: 'question-edit', detail: 'asked as a blocker on ' + added.join(', ') });
      }
    }
    return out;
  }
  /* the user's Allow or Keep reaches the session that asked the override, wherever pressed */
  if (ev.kind === 'override' && ev.verb === 'override') {
    const decided = to(ev.changes, 'decided');
    if (decided) tell([to(ev.changes, 'asker')], { kind: 'override', request: ev.id, decided, records: to(ev.changes, 'records') || [] });
    /* an Allow refused as changed since asked: the asking session asks again */
    else if (to(ev.changes, 'changed') !== undefined) tell([to(ev.changes, 'asker')], { kind: 'override', request: ev.id, decided: 'changed', records: to(ev.changes, 'changed') || [] });
    /* expired or replaced unanswered: closed with nothing applied, so its card stops waiting */
    else if (to(ev.changes, 'dropped')) tell([to(ev.changes, 'asker')], { kind: 'override', request: ev.id, decided: 'dropped', why: to(ev.changes, 'dropped'), records: to(ev.changes, 'records') || [] });
    return out;
  }
  /* a new decision tells the sessions holding a task or track it links, never its author */
  if (ev.kind === 'knowledge' && ev.verb === 'create') {
    /* a row cut for size carries only its keys: the record names the links (ctx.question reads any record by key) */
    const r = Array.isArray(ev.changes) ? await ctx.question(ev) : null;
    const got = (k) => { const v = r ? r[k] : to(ev.changes, k); return Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []; };
    if (got('type')[0] !== 'decision') return out;
    /* an imported row (legacy) is history, not a ruling made now: its holders hear nothing */
    if (got('legacy').length) return out;
    const tasks = got('tasks');
    const tracks = got('tracks');
    if (!tasks.length && !tracks.length) return out;
    tell([...(await holdersOf(tasks, ctx)), ...tracks.map((t) => ctx.holder(t))], { kind: 'decision-create', detail: 'a ruling on ' + tasks.concat(tracks).join(', ') });
    return out;
  }
  const prefix = WORK_PREFIX[ev.kind];
  if (prefix) {
    /* a task taken over: the session that had it in hand hears it, as a track's holder does */
    const was = ev.kind === 'task' ? from(ev.changes, 'inHand') : null;
    if (was && to(ev.changes, 'inHand') && was !== to(ev.changes, 'inHand')) tell([was], { kind: 'task-edit', detail: 'taken over by another session' });
    const status = to(ev.changes, 'status');
    /* the tray channel's polarity (spec section 8): a session's ending alerts */
    if (actor) {
      if (ev.kind === 'task' && ev.verb === 'edit' && (status === 'completed' || status === 'dropped')) out.work.push({ ending: status });
      if (ev.kind === 'workstream' && ev.verb === 'close') out.work.push({ ending: 'closed', outcome: to(ev.changes, 'outcome') ?? null });
      return out;
    }
    const who = ev.kind === 'task' ? [h.inHand, ctx.holder(h.track)] : ctx.tracksOf(h.label).map((t) => ctx.holder(t));
    const keys = Object.keys(ev.changes || {});
    let kind = prefix + '-' + ev.verb;
    let detail = null;
    if (ev.verb === 'create') detail = h.workstream && ev.kind === 'task' ? 'under ' + h.workstream : null;
    else if (ev.verb === 'edit' && keys.length === 1 && keys[0] === 'priority') { kind = 'task-priority'; detail = to(ev.changes, 'priority'); }
    else if (ev.verb === 'edit') detail = (ev.kind === 'task' && handDetail(ev)) || detailOf(ev.changes);
    else if (ev.verb === 'close') detail = to(ev.changes, 'outcome') ?? null;
    else if (ev.verb !== 'reopen') return out;
    tell(who, { kind, detail });
    return out;
  }
  /* a note on a track reaches the session holding it, as an answer
     does; whole, a cut row read from the track's journal, else it says where to read it */
  if (ev.kind === 'track' && ev.verb === 'note' && ev.note) {
    const id = h.label || ev.id;
    const holder = ctx.holder(id);
    if (holder && holder !== actor && holder !== cause) {
      const cut = ev.note.length >= 200 && ev.note.endsWith('...');
      const whole = cut ? await journalNote(ev.note, h.key || id, ctx) : null;
      tell([holder], { kind: 'track-note', detail: whole || ev.note + (cut ? ' (cut; show ' + id + ' --journal-tail 1 reads it whole)' : '') });
    }
  }
  /* a take-over: the session that held the track hears it at its next prompt */
  if (ev.kind === 'track' && ev.verb === 'edit') {
    const was = from(ev.changes, 'session');
    const now = to(ev.changes, 'session');
    if (was && now && was !== now) tell([was], { kind: 'track-edit', detail: 'taken over by another session' });
  }
  return out;
}

async function holdersOf(gates, ctx) {
  const out = [];
  for (const g of gates) {
    const t = ctx.task(g);
    if (t) out.push(t.inHand, ctx.holder(t.track));
  }
  return out;
}

/* The row's gates are keys and the record shows labels in the same order; when
   the record has moved on since, every gate it shows counts as added. */
function addedGates(changes, q) {
  if (!q || !Array.isArray(q.gates) || !q.gates.length) return [];
  if (Array.isArray(changes)) return changes.includes('gates') ? q.gates.slice() : [];
  const was = from(changes, 'gates');
  const now = to(changes, 'gates');
  const before = Array.isArray(was) ? was : [];
  if (!Array.isArray(now) || !now.some((k) => !before.includes(k))) return [];
  if (now.length !== q.gates.length) return q.gates.slice();
  return q.gates.filter((_, i) => !before.includes(now[i]));
}

/* The newest journal note the cut row starts, stamp left off; null when none matches or the read fails. */
async function journalNote(cut, ref, ctx) {
  if (typeof ctx.journal !== 'function') return null;
  let text = '';
  try { text = String((await ctx.journal(ref)) || ''); } catch { return null; }
  const head = cut.slice(0, -3);
  const lines = text.split('\n');
  const notes = [];
  /* a note starts with its stamp on a line after a blank one, as the CLI splits a journal */
  lines.forEach((l, i) => {
    if ((i === 0 || lines[i - 1].trim() === '') && NOTE_STAMP.test(l)) notes.push([l.replace(NOTE_STAMP, '')]);
    else if (notes.length) notes.at(-1).push(l);
  });
  for (const n of notes.reverse()) {
    const body = n.join('\n').trim();
    if (flat(body).startsWith(head)) return body;
  }
  return null;
}
const NOTE_STAMP = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})?: /;

/* The activity note is cut at 200 characters; a cut answer reads its record. */
function noteOf(ev, q) {
  const n = ev.note || null;
  if (!n || n.length < 200 || !q || typeof q.answer !== 'string') return n;
  const first = q.answer.split('\n\n')[0];
  const i = first.indexOf('. Why: ');
  return to(ev.changes, 'chosen') ? (i >= 0 ? first.slice(i + 7) : n) : first;
}

/* The sequences a session's inbox already holds, fresh and crash leftovers both:
   a restart that replays a row it had written before its cursor moved skips it. */
export function seqsIn(dir, session) {
  const name = inboxName(session);
  const out = new Set();
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n !== name + '.jsonl' && !(n.startsWith(name + '.processing-') && n.endsWith('.jsonl'))) continue;
    let text = '';
    try { text = readFileSync(join(dir, n), 'utf8'); } catch { continue; }
    for (const raw of text.split('\n')) {
      if (!raw.trim()) continue;
      try { const s = JSON.parse(raw).seq; if (Number.isInteger(s)) out.add(s); } catch {}
    }
  }
  return out;
}

export function appendInbox(dir, session, line) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, inboxName(session) + '.jsonl'), JSON.stringify(line) + '\n');
}

/* ---- the line a drain injects ------------------------------------------------ */

/* Bounded whatever the record is named: a 10KB rename must arrive as one
   readable line. The cap includes the ellipsis. */
const WORK_LINE_MAX = 500;

/* The kind names the event, so an envelope with none, or one this drain never
   heard of, falls through to skip-and-log instead of rendering half a sentence. */
const WORK_PHRASE = {
  'ws-create': 'created', 'plan-create': 'created', 'task-create': 'created',
  'ws-edit': 'edited', 'plan-edit': 'edited', 'task-edit': 'edited',
  'question-edit': 'edited',
  'task-priority': 'reprioritized',
  /* a take-over of a held track: its detail names it */
  'track-edit': 'edited',
  'track-note': 'given a note',
  'ws-close': 'closed', 'plan-close': 'closed',
  'ws-reopen': 'reopened', 'plan-reopen': 'reopened',
  /* a ruling on work this session holds */
  'decision-create': 'recorded',
};

/* An event's inbox line: every injected field flattens, so an event never shears its line. */
export function lineFor(ev) {
  if (!ev || typeof ev !== 'object' || typeof ev.id !== 'string' || typeof ev.name !== 'string') return null;
  const flat = (s) => String(s).replace(/\s*\r?\n\s*/g, ' ');
  const label = flat(ev.id) + ' (' + flat(ev.name) + ')';
  /* `user:<session>` is the user's own press in a session */
  const where = /^user:/.test(String(ev.by || '')) ? 'by the user' : ev.by ? 'in another session' : 'on the board';
  if (ev.kind === 'drop') {
    return label + ' was dropped ' + where + '.' + (ev.note ? ' Note: ' + flat(ev.note) : '');
  }
  /* only the user's snooze from a card mints one */
  if (ev.kind === 'snooze') {
    return label + ' was snoozed ' + where + (ev.detail ? ': ' + flat(ev.detail) : '') + '.';
  }
  if (ev.kind === 'answer') {
    /* the pick is the stored type and the line shows the composed token, as the card does */
    const tok = flat(answerToken(ev.id, ev.pick));
    /* a correction rides this kind with one flag */
    const said = ev.amended === true ? ' had its answer corrected ' : ' was answered ';
    if (ev.pick && ev.note) return label + said + where + ': ' + tok + '. Why: ' + flat(ev.note);
    if (ev.pick) return label + said + where + ': ' + tok + '.';
    if (ev.note) return label + said + where + '. Why: ' + flat(ev.note);
    return null;
  }
  /* an override decided: the session that asked reads what the user did */
  if (ev.kind === 'override') {
    const recs = Array.isArray(ev.records) && ev.records.length ? ' (' + ev.records.map(flat).join(', ') + ')' : '';
    if (ev.decided === 'changed') return 'Override ' + flat(ev.request || ev.id) + recs + ' changed since asked: Allow was refused ' + where + ', so nothing was applied; ask again from the text as it stands.';
    if (ev.decided === 'dropped') return 'Override ' + flat(ev.request || ev.id) + recs + ' closed with nothing applied (' + flat(ev.why || 'expired') + '); ask again if it is still needed.';
    return 'Override ' + flat(ev.request || ev.id) + recs + (ev.decided === 'allow' ? ' was allowed ' + where + ': the change is applied.'
      : ' was kept as written ' + where + ': nothing was changed, and the same ask is refused.');
  }
  /* hasOwn: 'toString' and '__proto__' are inherited and would render garbage */
  if (Object.hasOwn(WORK_PHRASE, ev.kind)) {
    /* a lone carriage return and the two unicode separators break a line too */
    const oneLine = (s) => flat(s).replace(/[\r\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ');
    const detail = ev.detail === undefined || ev.detail === null ? '' : oneLine(ev.detail).trim();
    const line = oneLine(label) + ' was ' + WORK_PHRASE[ev.kind] + ' ' + where
      + (detail ? ': ' + detail : '.');
    /* a track note is addressed to its holder and arrives whole */
    if (ev.kind === 'track-note') return line;
    return line.length > WORK_LINE_MAX ? line.slice(0, WORK_LINE_MAX - 3) + '...' : line;
  }
  /* the linked wake and the date auto-wake; the hand wake is silent */
  if (ev.kind === 'wake') {
    if (!ev.note) return null;
    const line = label + ' woke ' + where + ': ' + flat(ev.note).trim() + '.';
    return line.length > WORK_LINE_MAX ? line.slice(0, WORK_LINE_MAX - 3) + '...' : line;
  }
  return null;
}

/* ---- the root's lock, its .lock directory ---------- */

export class LockError extends Error {}

/* the wait outlasts the stale window, so the first take after a crashed holder
   takes the lock over instead of failing */
const DEFAULT_LOCK_WAIT_MS = 12000;
const DEFAULT_LOCK_STALE_MS = 10000;
const lockPath = (root) => join(root, '.lock');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquireLock(root, opts = {}) {
  const dir = lockPath(root);
  const waitMs = opts.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
  const staleMs = opts.lockStaleMs ?? DEFAULT_LOCK_STALE_MS;
  const deadline = Date.now() + waitMs;
  const token = process.pid + '-' + randomBytes(8).toString('hex');
  for (;;) {
    try {
      mkdirSync(dir);
      /* the owner token proves release is this acquire's; the declared hold keeps a
         long holder from a taker with a shorter one; best effort */
      try { writeFileSync(join(dir, 'owner'), token + '\nhold=' + staleMs + '\n'); } catch {}
      return token;
    } catch (e) {
      /* EEXIST is the lock held; Windows surfaces transient sharing violations as
         EPERM or EACCES under contention, and the deadline bounds the retry */
      const code = e && e.code;
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') {
        throw new LockError('could not take the store lock: ' + (e && e.message));
      }
    }
    /* stale takeover by rename: only one contender's rename succeeds, and only a
       successful one skips the deadline check, or a failing rename would spin */
    let tookOver = false;
    try {
      const st = statSync(dir);
      if (Date.now() - st.mtimeMs > Math.max(staleMs, declaredHold(dir))) {
        const discard = dir + '-stale-' + randomBytes(4).toString('hex');
        renameSync(dir, discard);
        tookOver = true;
        appendLog(root, 'stale lock taken over (renamed to ' + discard + ')');
        try { rmSync(discard, { recursive: true, force: true }); } catch {}
      }
    } catch {}
    if (tookOver) continue;
    if (Date.now() >= deadline) {
      /* fail closed: no lock means no write */
      throw new LockError('store lock still held after ' + waitMs + 'ms; nothing was written');
    }
    await sleep(40 + Math.floor(Math.random() * 20));
  }
}

/* the hold window the holder declared, 0 when missing, unreadable or undeclared */
function declaredHold(dir) {
  try {
    const m = /^hold=(\d+)$/m.exec(readFileSync(join(dir, 'owner'), 'utf8'));
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}

/* only while the owner token still matches, so a holder judged stale and taken
   over cannot delete the new holder's lock; best effort */
function releaseLock(root, token) {
  const dir = lockPath(root);
  try {
    if (readFileSync(join(dir, 'owner'), 'utf8').split('\n')[0] !== token) return;
  } catch { return; }
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

export async function withLock(root, opts, fn) {
  const token = await acquireLock(root, opts || {});
  try {
    return await fn();
  } finally {
    releaseLock(root, token);
  }
}
