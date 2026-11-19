/* Inbox lines and tray alerts from the board's activity rows: who hears
   each row, the gate holders included, and the tray's alerts. Each line carries its
   row's sequence, so a replay never tells twice. */
/* Also the inbox's own file names, the line a drain injects and the root's .lock,
   so the local server and a spawned mod-inbox take the same lock. */
import {
  appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync,
} from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { answerToken } from './answer-token.mjs';
import { senderWords } from './sender-words.mjs';
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

/* a session run's line reads in the hand's words ("taken in hand", "let go", "taken over") */
function handDetail(ev) {
  const words = ev.verb === 'run' ? runHand(ev.changes) : null;
  if (!words) return null;
  const bySession = sessionAuthored(ev.by) || (typeof ev.for === 'string' && ev.for);
  /* the app's close names the app as who acted, so no session is named beside it */
  return words + (bySession && !/by the app$/.test(words) ? ' by another session' : '');
}

/* A session run's line (the board's runs) as a hand move: its open a take, its end handed on a let go */
function runHand(ch) {
  const worker = ch && Array.isArray(ch.worker) ? ch.worker[0] || ch.worker[1] : null;
  if (!ch || !Array.isArray(ch.run) || worker !== 'session') return null;
  if (ch.run[1]) return 'taken in hand';
  const how = Array.isArray(ch.how) ? ch.how[1] : null;
  /* the app closed the session, for a cause it never tells; the task reads ready to continue */
  return how === 'taken_over' ? 'taken over' : how === 'handed_on' ? 'let go' : how === 'closed_idle' ? 'let go, closed by the app' : null;
}

/* the kind prefix per work kind ('task-edit', 'ws-close') */
const WORK_PREFIX = { task: 'task', workstream: 'ws' };

/* What one activity row tells: [{ session, line }] for the inboxes and the alert
   events. `ctx` answers lookups from the cache: question(ev) for a question's
   record (subscribers, gates, track, answer), holder(trackLabel), task(label), tracksOf(ws). */
export async function tellingsOf(ev, ctx) {
  const h = ev.head || {};
  /* pc: the device the row came from, so the band can say an update came from another PC */
  const base = { at: ev.at, id: h.label || ev.id, key: h.key || undefined, name: h.title ?? '', by: ev.by, seq: ev.seq, ...(typeof ev.pc === 'string' && ev.pc ? { pc: ev.pc } : {}) };
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
    const { subs, own, holder, presser } = audienceOf(q, h.session, ev.by, ctx);
    /* the user's press in a session on this PC draws no tray popup; the mod toasted it there */
    const pressedHere = !!presser && typeof ctx.here === 'function' && ctx.here(presser, ev.pc);
    if (ev.verb === 'answer' || ev.verb === 'amend') {
      tell([...subs, own, holder], { kind: 'answer', pick: to(ev.changes, 'chosen') ?? null, note: noteOf(ev, q), ...(ev.verb === 'amend' ? { amended: true } : {}), ...placedOf(ev, q) });
      /* snoozed to answered is not an event for the tray */
      if (ev.verb === 'answer' && from(ev.changes, 'status') !== 'snoozed' && !pressedHere) out.questions.push({ kind: 'closed', status: 'answered' });
    } else if (ev.verb === 'drop') {
      tell([...subs, own, holder], { kind: 'drop', note: ev.note || null, ...placedOf(ev, q) });
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
      /* gates added to an open blocker reach those tasks' holders, as at registration;
         a reword that makes it blocking reaches the holders of every task it gates */
      const made = Array.isArray(ev.changes) ? ev.changes.includes('blocking') : from(ev.changes, 'blocking') !== true && to(ev.changes, 'blocking') === true;
      const told = made ? (q && q.gates) || [] : addedGates(ev.changes, q);
      if (told.length && q.blocking === true && q.status === 'open') {
        tell(await holdersOf(told, ctx), { kind: 'question-edit', detail: (made ? 'made a blocker on ' : 'asked as a blocker on ') + told.join(', ') });
      }
    }
    return out;
  }
  /* the user's press reaches the session that asked the override, wherever pressed */
  if (ev.kind === 'override' && ev.verb === 'override') {
    const decided = to(ev.changes, 'decided');
    const act = to(ev.changes, 'act') || '';
    if (decided) tell([to(ev.changes, 'asker')], { kind: 'override', request: ev.id, decided, act, records: to(ev.changes, 'records') || [] });
    /* a press refused as changed since asked: the asking session asks again */
    else if (to(ev.changes, 'changed') !== undefined) tell([to(ev.changes, 'asker')], { kind: 'override', request: ev.id, decided: 'changed', act, records: to(ev.changes, 'changed') || [] });
    /* expired or replaced unanswered: closed with nothing applied, so its card stops waiting */
    else if (to(ev.changes, 'dropped')) tell([to(ev.changes, 'asker')], { kind: 'override', request: ev.id, decided: 'dropped', why: to(ev.changes, 'dropped'), records: to(ev.changes, 'records') || [] });
    return out;
  }
  /* a new decision tells the sessions holding a task or track it links, never its author */
  /* and an amend tells them the clause it adds, read from the record's body */
  /* only a later stamp is an amend: an undo moves it back to an earlier amend, or to none */
  const stamps = (ev.changes || {}).amended;
  const later = Array.isArray(stamps) && !!stamps[1] && (!stamps[0] || Date.parse(stamps[1]) > Date.parse(stamps[0]));
  const amend = ev.kind === 'knowledge' && ev.verb === 'edit' && (Array.isArray(ev.changes) ? ev.changes.includes('amended') : later);
  if (ev.kind === 'knowledge' && (ev.verb === 'create' || amend)) {
    /* a row cut for size carries only its keys: the record names the links (ctx.question reads any record by key) */
    const r = Array.isArray(ev.changes) || amend ? await ctx.question(ev, amend) : null;
    if (amend && !r) return out;
    const got = (k) => { const v = r ? r[k] : to(ev.changes, k); return Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []; };
    if (got('type')[0] !== 'decision') return out;
    /* an imported row (legacy) is history, not a ruling made now: its holders hear nothing */
    if (got('legacy').length) return out;
    const tasks = got('tasks');
    const tracks = got('tracks');
    if (!tasks.length && !tracks.length) return out;
    if (amend) {
      const paras = String((r.sections && r.sections.Body) || '').split(/\n\s*\n/).map(flat).filter((p) => /^Amended \d{4}-\d{2}-\d{2} by /.test(p));
      tell([...(await holdersOf(tasks, ctx)), ...tracks.map((t) => ctx.holder(t))], { kind: 'decision-amend', detail: paras.at(-1) || null });
      return out;
    }
    tell([...(await holdersOf(tasks, ctx)), ...tracks.map((t) => ctx.holder(t))], { kind: 'decision-create', detail: 'a ruling on ' + tasks.concat(tracks).join(', ') });
    return out;
  }
  const prefix = WORK_PREFIX[ev.kind];
  if (prefix) {
    /* a task taken over: the session that had it in hand hears it, as a track's holder does */
    const was = ev.kind === 'task' && ev.verb === 'run' && to(ev.changes, 'how') === 'taken_over' ? from(ev.changes, 'session') : null;
    /* a take that continues the old id is the same session after a /clear: nobody is told */
    if (ev.kind === 'task' && ev.verb === 'run' && to(ev.changes, 'continues')) return out;
    if (was) tell([was], { kind: 'task-edit', detail: 'taken over by another session' });
    /* a note on a task reaches its holder and its track's holder as a track note does, whoever wrote it */
    if (ev.kind === 'task' && ev.verb === 'note') {
      /* a gate's answer or drop the board wrote on the task: whoever the answer itself reached heard it there */
      const gate = ev.note ? /^(Q\d+) \(.*\) was (?:answered|dropped)\b/.exec(ev.note) : null;
      const q = gate ? await ctx.question({ id: gate[1] }) : null;
      const a = q ? audienceOf(q, q.session || null, ev.by, ctx) : null;
      const heard = a ? [...a.subs, a.own, a.holder].filter(Boolean).map(inboxName) : [];
      if (ev.note) tell([h.inHand, h.track ? ctx.holder(h.track) : null].filter((s) => s && !heard.includes(inboxName(s))), { kind: 'task-note', detail: await wholeNote(ev.note, h.key || h.label || ev.id, h.label || ev.id, ctx) });
      return out;
    }
    /* a session run's open or end tells the task's holders a take or a let go, whoever wrote it */
    if (ev.kind === 'task' && ev.verb === 'run') {
      const detail = handDetail(ev);
      if (detail) tell([h.inHand, ctx.holder(h.track)].filter((s) => s !== was), { kind: 'task-edit', detail });
      return out;
    }
    const status = to(ev.changes, 'status');
    /* the tray channel's polarity (spec section 8): a session's ending alerts */
    if (actor) {
      if (ev.kind === 'task' && ev.verb === 'edit' && (status === 'done' || status === 'dropped')) out.work.push({ ending: status });
      if (ev.kind === 'workstream' && ev.verb === 'close') out.work.push({ ending: 'closed', outcome: to(ev.changes, 'outcome') ?? null });
      return out;
    }
    const who = ev.kind === 'task' ? [h.inHand, ctx.holder(h.track)] : ctx.tracksOf(h.label).map((t) => ctx.holder(t));
    const keys = Object.keys(ev.changes || {});
    let kind = prefix + '-' + ev.verb;
    let detail = null;
    if (ev.verb === 'create') detail = h.workstream && ev.kind === 'task' ? 'under ' + h.workstream : null;
    else if (ev.verb === 'edit' && keys.length === 1 && keys[0] === 'priority') { kind = 'task-priority'; detail = to(ev.changes, 'priority'); }
    /* the line's note says why (migration 015's blocked line names where to read on what) */
    else if (ev.verb === 'edit') detail = [detailOf(ev.changes), ev.note ? flat(ev.note) : null].filter(Boolean).join(': ') || null;
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
    if (holder && holder !== actor && holder !== cause) tell([holder], { kind: 'track-note', detail: await wholeNote(ev.note, h.key || id, id, ctx) });
  }
  /* a take-over: the session that held the track hears it at its next prompt */
  if (ev.kind === 'track' && ev.verb === 'edit') {
    const was = from(ev.changes, 'session');
    const now = to(ev.changes, 'session');
    /* a take that continues the old id is the same session after a /clear, not another */
    if (was && now && was !== now && !to(ev.changes, 'continues')) tell([was], { kind: 'track-edit', detail: 'taken over by another session' });
  }
  return out;
}

/* Who a question's answer or drop is told to: its subscribers (else the asker), the owner's own
   press, and the session holding its track. */
function audienceOf(q, asker, by, ctx) {
  const subs0 = (q && q.subscribers) || (asker ? [asker] : []);
  const presser = userAuthored(by) ? sessionOfBy(by) : null;
  /* the session holding the question's track hears it, a resumed leg included */
  const holder = q && q.track ? ctx.holder(q.track) : null;
  /* a press in a session that does not own the question
     (the track's holder, else the asker) is told to the owner only, never back to it */
  const owner = holder || (q && q.session) || asker || null;
  const subs = presser && presser !== owner ? subs0.filter((s) => inboxName(s) !== inboxName(presser)) : subs0;
  const own = presser && presser === owner ? presser : null;
  return { subs, own, holder, presser };
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

/* A note row's text whole: a cut row read from the record's journal, else it says where to read it. */
async function wholeNote(note, ref, id, ctx) {
  const cut = note.length >= 200 && note.endsWith('...');
  const whole = cut ? await journalNote(note, ref, ctx) : null;
  return whole || note + (cut ? ' (cut; show ' + id + ' --journal-tail 1 reads it whole)' : '');
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

/* A placement question's answer: the task it created, else its outcome;
   a row cut for size reads them from the question's record. */
function placedOf(ev, q) {
  const cut = Array.isArray(ev.changes);
  const outcome = cut ? q && q.placement && q.placement.outcome : to(ev.changes, 'outcome');
  if (!outcome) return {};
  const created = cut ? null : to(ev.changes, 'created');
  const why = cut ? null : to(ev.changes, 'why');
  /* an existing task moved, or a step added onto another track's task, is no new task */
  const p = (q && q.placement) || {};
  const how = p.task ? 'moved' : outcome === 'asked' && p.asked && p.asked.onto ? 'step' : null;
  return { outcome, ...(created ? { created } : cut && q.placement.created ? { created: { id: q.placement.created } } : {}), ...(why ? { why } : {}), ...(how ? { how } : {}) };
}

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

/* One key per event, so a leftover read twice is told once; a board line keys by its sequence */
export const keyOf = (ev) => (Number.isInteger(ev.seq) ? 'seq:' + ev.seq
  : [ev.at, ev.kind, ev.id, ev.pick || '', ev.amended ? 'amended' : '', ev.by || ''].join('|'));

const parseLines = (text) => String(text).split('\n').filter((raw) => raw.trim()).flatMap((raw) => { try { return [JSON.parse(raw)]; } catch { return []; } });

/* The boxes' lines as mod-inbox peek tells them, each box's kept and leftover lines before its
   fresh ones; read off the loop under the lock, so a band's peek holds no other call. */
export async function peekInbox(root, boxes, here) {
  const dir = join(root, 'inbox');
  let names;
  try { names = await readdir(dir); } catch { return []; }
  const has = (s) => names.some((n) => n === inboxName(s) + '.jsonl' || (n.startsWith(inboxName(s) + '.processing-') && n.endsWith('.jsonl')));
  if (!boxes.some(has)) return [];
  return withLock(root, {}, async () => {
    const all = [];
    for (const box of boxes) {
      const inbox = inboxFile(root, box);
      const prefix = processingPrefix(inbox);
      const kept = join(dir, prefix + 'mod.jsonl');
      const listed = (await readdir(dir)).filter((n) => n.startsWith(prefix) && n.endsWith('.jsonl')).sort().map((n) => join(dir, n));
      let text = '';
      for (const f of [...listed.filter((f) => f === kept), ...listed.filter((f) => f !== kept)]) { try { text += (await readFile(f, 'utf8')) + '\n'; } catch {} }
      try { text += await readFile(inbox, 'utf8'); } catch {}
      const seen = new Set();
      for (const ev of parseLines(text)) {
        const e = { key: keyOf(ev), line: lineFor(ev, here), raw: ev, box };
        if (e.line && !seen.has(e.key)) { seen.add(e.key); all.push(e); }
      }
    }
    return all;
  });
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
  'task-note': 'given a note',
  'ws-close': 'closed', 'plan-close': 'closed',
  'ws-reopen': 'reopened', 'plan-reopen': 'reopened',
  /* a ruling on work this session holds */
  'decision-create': 'recorded',
  'decision-amend': 'amended',
};

/* An event's inbox line: every injected field flattens, so an event never shears its line. */
/* here: this PC's name, so a line carrying its sender's PC names it as the band does */
export function lineFor(ev, here) {
  if (!ev || typeof ev !== 'object' || typeof ev.id !== 'string' || typeof ev.name !== 'string') return null;
  const flat = (s) => String(s).replace(/\s*\r?\n\s*/g, ' ');
  const label = flat(ev.id) + ' (' + flat(ev.name) + ')';
  /* `user:<session>` is the user's own press in a session; `board:<what>` the board's own act */
  const by = String(ev.by || '');
  const where = typeof ev.pc === 'string' && ev.pc ? flat(senderWords(ev, here, false, 'the user'))
    : /^user:/.test(by) ? 'by the user' : /^board:/.test(by) ? 'by the board' : by ? 'in another session' : 'on the board';
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
    const act = { withdraw: ['Withdraw', 'withdrawn'], fix: ['Fix', 'fixed'], scrub: ['Scrub', 'scrubbed'] }[ev.act] || ['Allow', 'allowed'];
    if (ev.decided === 'changed') return 'Override ' + flat(ev.request || ev.id) + recs + ' changed since asked: ' + act[0] + ' was refused ' + where + ', so nothing was applied; ask again from the text as it stands.';
    if (ev.decided === 'dropped') return 'Override ' + flat(ev.request || ev.id) + recs + ' closed with nothing applied (' + flat(ev.why || 'expired') + '); ask again if it is still needed.';
    return 'Override ' + flat(ev.request || ev.id) + recs + (ev.decided === 'allow' ? ' was ' + act[1] + ' ' + where + ': the change is applied.'
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
    if (ev.kind === 'track-note' || ev.kind === 'task-note') return line;
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
      await mkdir(dir);
      /* the owner token proves release is this acquire's; the declared hold keeps a
         long holder from a taker with a shorter one; best effort */
      try { await writeFile(join(dir, 'owner'), token + '\nhold=' + staleMs + '\n'); } catch {}
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
async function releaseLock(root, token) {
  const dir = lockPath(root);
  try {
    if ((await readFile(join(dir, 'owner'), 'utf8')).split('\n')[0] !== token) return;
  } catch { return; }
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

/* The lock's file work is async, so a holder never stalls the process's loop; takers in one
   process wait their turn here rather than in the 40 ms retry. A nested take waits forever. */
const queued = new Map();

export async function withLock(root, opts, fn) {
  const before = queued.get(root) || Promise.resolve();
  let done;
  const mine = new Promise((r) => { done = r; });
  const tail = before.then(() => mine);
  queued.set(root, tail);
  await before;
  try {
    const token = await acquireLock(root, opts || {});
    try {
      return await fn();
    } finally {
      await releaseLock(root, token);
    }
  } finally {
    done();
    if (queued.get(root) === tail) queued.delete(root);
  }
}
