/* The task block: what a task holds now, for whoever takes it, starts it, gets
   it back at a resume or is dispatched on it. Built here once; the board's take, start
   and resume return its text, and the read verb (task block) prints it for any task. */
import { readTx } from '../db.mjs';
import { UsageError, labelGates, resolveRecord } from './labels.mjs';
import { itemsOf, loadRecord, wordsOf } from './graph.mjs';
import { decisionsFor } from './decisions.mjs';
import { shownSectionsOf } from './work.mjs';
import { unguardHeadings } from '../records.mjs';
import { isReview } from './found.mjs';
import { reviewReads } from './coverage.mjs';
import { CLI, aimLines, bodyLines, decisionWords } from '../handoff-text.mjs';
import { wordLine } from '../web/feed.mjs';

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const ms = (s) => { const n = Date.parse(String(s || '')); return Number.isFinite(n) ? n : null; };
const stampWords = (at) => String(at || '').slice(0, 16).replace('T', ' ');

/* the newest notes since the last rewrite, the rest counted, so the block stays a read */
const NOTES_MAX = 5;
const NOTE_MAX = 600;

/* The answered questions that gate the task, each with its answer's first paragraph. */
function answeredGates(db, key) {
  return db.stmt(`SELECT q.key, q.label, q.title FROM records q WHERE q.kind = 'question' AND q.status = 'answered'
    AND (EXISTS (SELECT 1 FROM links l WHERE l."from" = q.key AND l.type = 'gates' AND l."to" = ?) OR q.key IN (SELECT value FROM json_each(?)))
    ORDER BY q.id`).all(key, JSON.stringify(labelGates(db, [key]).map((x) => x.from)))
    .map((q) => {
      const n = db.stmt('SELECT body FROM notes WHERE record = ? ORDER BY position LIMIT 1').get(q.key);
      return { id: q.label, name: q.title, answer: n ? one(n.body) : '' };
    });
}

/* The board's and the mod's own lines, by each writer's fixed lead; anything else a session
   or the user typed, progress lines and done claims included, is a note the block prints. */
const BOARD_LEADS = [
  /^Lane size: \d+k tokens of context \(agent /, // laneNote, lib/mod-core.mjs
  /^Q\d+ \(.*\) was answered\b/, // noteGated, questions.mjs; the block prints the gate's answer
  /^Left T-\d+\b[^\n]* as it closed\.$/, // leftAtClose, handoff-text.mjs
  /^Board picture, /, // applyPicture, picture.mjs
];
export function isBoardLine(body, actor) {
  const b = String(body ?? '').trim();
  return String(actor || '').startsWith('board:') || BOARD_LEADS.some((re) => re.test(b));
}

/* The typed notes since the description or intent was last set (all of them when never),
   newest kept; the board's own lines are counted, never printed. */
function notesSince(db, key) {
  const last = db.stmt(`SELECT max(at) AS at FROM history WHERE record = ? AND field IN ('description', 'intent')`).get(key);
  const since = last && last.at ? ms(last.at) : null;
  const all = db.stmt('SELECT at, actor, body FROM notes WHERE record = ? ORDER BY position').all(key);
  const typed = all.filter((n) => !isBoardLine(n.body, n.actor));
  const recent = since === null ? typed : typed.filter((n) => (ms(n.at) ?? -Infinity) >= since);
  const shown = recent.slice(-NOTES_MAX).map(({ at, body }) => ({ at, body: unguardHeadings(body) }));
  return { rewritten: since !== null, ...(since !== null ? { rewrittenAt: last.at } : {}), notes: shown, earlier: typed.length - shown.length, boardLines: all.length - typed.length };
}

/* The newest scope line since the description or intent was last set: a session's note,
   never the board's own (its review and upkeep lines, or a gate's answer, which the block shows). */
export function scopeNote(db, key) {
  const last = db.stmt(`SELECT max(at) AS at FROM history WHERE record = ? AND field IN ('description', 'intent')`).get(key);
  const since = last && last.at ? ms(last.at) : null;
  for (const n of db.stmt('SELECT at, actor, body FROM notes WHERE record = ? ORDER BY position DESC').all(key)) {
    if (since !== null && (ms(n.at) ?? -Infinity) < since) return null;
    if (isBoardLine(n.body, n.actor)) continue;
    return unguardHeadings(n.body);
  }
  return null;
}

/* taskBlock(db, { id }): the block's parts and its text. A review adds what it reads. */
export function taskBlock(db, input = {}) {
  const raw = String((typeof input === 'string' ? input : input && input.id) ?? '').trim();
  return readTx(db, () => {
    const e = raw ? resolveRecord(db, raw, { kinds: ['task'] }) : null;
    if (!e) throw new UsageError('task block names a T-n');
    return blockOf(db, e.key, { reader: (input && typeof input === 'object' && typeof input.session === 'string' && input.session) || null });
  });
}

/* Inside a caller's transaction: the block of the task at `key`; `reader` the session reading it,
   so its own run reads "this session". */
export function blockOf(db, key, { now = Date.now(), reader = null } = {}) {
  const rec = loadRecord(db, key);
  const f = rec.fields;
  const secs = shownSectionsOf(rec.body || '');
  const steps = itemsOf(db, key);
  /* its track, so a reader of many blocks (the doctor) needs no read per track */
  const on = db.stmt(`SELECT t.label AS id, t.title AS name FROM track_items i JOIN records t ON t.key = i.track WHERE i.task = ?`).get(key);
  const b = {
    id: f.id, key, name: f.name, status: f.status || 'open', word: wordsOf(db, [key], now).get(key) || null, track: on ? { id: on.id, name: on.name } : null,
    /* a dispatch on the task plays each label as a role */
    labels: Array.isArray(f.labels) ? f.labels.map(String) : [],
    intent: one(secs.Intent) || null, description: (secs.Description || '').trim() || null,
    /* its filer's line on why the track that session held does not cover it */
    ...(one(f.whyElsewhere) ? { whyElsewhere: one(f.whyElsewhere) } : {}),
    /* why nothing on its track needed it sooner, when it was filed last */
    ...(one(f.filedLast) ? { filedLast: one(f.filedLast) } : {}),
    /* each by its own number, as check done takes them */
    steps: steps.filter((s) => !s.done).map(({ n, text }) => ({ n, text })), stepsTotal: steps.length,
    ...(steps.some((s) => s.struck) ? { struck: steps.filter((s) => s.struck).map(({ n, text, struck }) => ({ n, text, why: struck })) } : {}),
    gates: answeredGates(db, key),
    decisions: decisionsOn(db, key),
    ...notesSince(db, key),
  };
  /* a review judges each task it reads against what that task was for */
  if (isReview(f)) {
    const r = reviewReads(db, key);
    b.covers = { listed: r.listed, tasks: r.keys.map((k) => aimOf(db, k)) };
  }
  /* the head says the task's word as track show does, never the stored status */
  b.said = wordLine(b.word, now, reader) || b.status;
  b.text = blockText(b);
  return b;
}

const decisionsOn = (db, key) => decisionsFor(db, { task: key }).map((d) => ({ id: d.id, name: d.name, ...(d.words ? { words: d.words } : {}), ...(d.confirmed ? { confirmed: true } : {}),
  ...(d.gist ? { gist: d.gist } : {}), ...(d.amends ? { amends: d.amends } : {}) }));

/* A task's intent and its decisions in force: what coverage and a review read per task. */
export function aimOf(db, key) {
  const rec = loadRecord(db, key);
  return { id: rec.fields.id, name: rec.fields.name, intent: one(shownSectionsOf(rec.body || '').Intent) || null, decisions: decisionsOn(db, key) };
}


export function blockText(b) {
  const lines = ['Task ' + b.id + ' ' + one(b.name) + ' (' + (b.said || b.status) + ')'];
  if (b.intent) lines.push('Intent: ' + b.intent);
  if (b.description) lines.push('Description: ' + b.description);
  if (b.whyElsewhere) lines.push('Filed past the held track: ' + b.whyElsewhere);
  if (b.filedLast) lines.push('Filed last: ' + b.filedLast);
  if (b.steps.length) lines.push('Open steps (' + b.steps.length + ' of ' + b.stepsTotal + '): ' + b.steps.map((s) => s.n + '. ' + one(s.text)).join('; '));
  if (b.struck && b.struck.length) lines.push('Struck steps: ' + b.struck.map((s) => s.n + '. ' + one(s.text) + ' (struck: ' + one(s.why) + ')').join('; '));
  if (b.gates.length) lines.push('Answered gates: ' + b.gates.map((g) => g.id + ' (' + one(g.name) + '): ' + (g.answer || 'answered')).join('; '));
  if (b.decisions.length) {
    lines.push('Decisions in force (hold to them; `' + CLI + ' show K-n` reads one whole):');
    for (const d of b.decisions) lines.push('- ' + decisionWords(d), ...bodyLines(d));
  }
  if (b.covers) {
    lines.push('It reviews (' + (b.covers.listed ? 'its covers list' : 'the default its completion would take') + ')' + (b.covers.tasks.length ? ':' : ': nothing yet'));
    for (const a of b.covers.tasks) lines.push('- ' + a.id + ' ' + one(a.name), ...aimLines(a));
  }
  if (b.notes.length) {
    lines.push((b.rewritten ? 'Notes since the description was last set' : 'Notes') + ' (' + b.notes.length + '):');
    for (const n of b.notes) {
      const body = one(n.body);
      lines.push('- ' + (n.at ? stampWords(n.at) + ': ' : '') + (body.length > NOTE_MAX ? body.slice(0, NOTE_MAX - 3) + '... (cut)' : body));
    }
  }
  const out = [b.earlier ? b.earlier + ' earlier ' + (b.earlier === 1 ? 'note' : 'notes') : '',
    b.boardLines ? b.boardLines + ' board ' + (b.boardLines === 1 ? 'line' : 'lines') + ' (lane sizes, answers, closes, reopens, picture stamps)' : ''].filter(Boolean);
  if (out.length) lines.push(out.join(' and ') + ' left out: `' + CLI + ' show ' + b.id + ' --journal` reads them.');
  return lines.join('\n');
}
