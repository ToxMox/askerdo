/* The question verbs over the board database: today's question
   rules from the old store, each write one synchronous transaction holding
   its activity rows. No files, inbox lines or board URLs: the API and the PC
   side own those. */
import { tx } from '../db.mjs';
import { WEB } from '../paths.mjs';
import {
  DAY_RE, KEY_ORDERS, addNote, byOf, changesOf, clockOf, dayOf, guardHeadings, isFullStamp, isKey, kebab, labelOf, logVerb,
  mintKey, pcOfCall, putNotes, putRecord, snoozeFlat, stampNow, unguardHeadings,
} from '../records.mjs';
import { ENDED, UsageError, canonLabel, pickLabel, refsFor, resolveRecord, shownFront, strList } from './labels.mjs';
import { noteRead } from './history.mjs';
import { onEnding } from './upkeep.mjs';
import { isRelease, releaseLine } from './found.mjs';
import { endSessionRuns, openRunSql } from './runs.mjs';
import { isPlacement, placementAnswered } from './placement-answer.mjs';
import { BOARD_ASKS, PLACEMENT_LABEL } from './placement-seam.mjs';

export { UsageError, byOf, canonLabel, snoozeFlat };

export const ANSWER_PLACEHOLDER = '(filled at close: the choice and its why)';
export const INBOX_LABEL = 'inbox';
const ASK_MAX = 400;
const ASK_SHAPE = 'one plain question ending in "?" that names the options inline by letter'
  + ' with the pick marked, like "(a, my pick)" and "(b)"; the hub adds the question number at registration';

/* ---- the clock and the actor ---- */

/* `opts.now` is the questions' clock seam, as in today's store (records.mjs clockOf). */
const clockNow = (opts) => clockOf(null, opts);
const stamp = (opts) => stampNow(clockNow(opts));
const today = (opts) => dayOf(clockNow(opts));

/* A caller that names no actor acts as today's CLI did, off the input's own session or chip. */
const actingAs = (actor, input) => actor || { session: input && input.session, user: input && input.user };

const sessionOfBy = (by) => (typeof by === 'string' && by.startsWith('session:') ? by.slice(8) : null);

function log(db, actor, { at, verb, kind = 'question', front, changes, note }) {
  return logVerb(db, {
    ts: at, verb, kind, id: front.id || '', key: front.key, name: front.name || '',
    changes: changes || {}, by: byOf(actor), pc: actor && actor.pc, note,
  });
}

function snapFront(front) {
  const out = {};
  for (const [k, v] of Object.entries(front || {})) out[k] = Array.isArray(v) ? v.slice() : (v && typeof v === 'object' ? { ...v } : v);
  return out;
}

const listOf = (front, key) => (Array.isArray(front[key]) ? front[key].slice() : []);

/* ---- the front in today's key order (the old store's serializeFront) ---- */

export const KEY_ORDER = KEY_ORDERS.question;
const FRONT_LISTS = ['subscribers', 'evidence', 'gates', 'revisits', 'cites', 'labels', 'refs', 'labelHistory'];
const SNOOZE_KEYS = ['until', 'trigger', 'wakeOn', 'wakeStatus'];

/* Known keys first, an empty list or value left out as today's writer leaves it
   out, then any key this build does not know, in the order it came. */
function ordered(front) {
  const out = {};
  for (const key of KEY_ORDER) {
    const v = front[key];
    if (v === undefined || v === null || v === '') continue;
    if (FRONT_LISTS.includes(key)) {
      if (Array.isArray(v) && v.length) out[key] = v.slice();
    } else if (key === 'snooze') {
      const m = {};
      for (const s of SNOOZE_KEYS) if (v[s] !== undefined) m[s] = v[s];
      out.snooze = m;
    } else out[key] = v;
  }
  for (const [key, v] of Object.entries(front)) if (!KEY_ORDER.includes(key) && v !== undefined) out[key] = v;
  return out;
}

/* ---- the body (the old store's renderBody and parseQuestionFile) ---- */

const cell = (v) => String(v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
const oneLineOf = (v) => String(v).replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ').trim();

export const OPTION_SLOTS = Object.freeze([
  ['headline', 'headline'], ['whyPick', 'why pick it'], ['whyNot', 'why not'], ['undo', 'undo'],
]);

/* The text above `## Answer`, which the record stores as its body. */
function renderBody(front, p) {
  const lines = ['[all open questions](index.md)', ''];
  lines.push('# ' + front.id + ' ' + String(front.name).replace(/\s*\r?\n\s*/g, ' '), '');
  lines.push(guardHeadings(p.gist), '');
  if (p.reverses) lines.push('## Reverses', p.reverses, '');
  if (p.reversal) lines.push('## Reversal', guardHeadings(p.reversal), '');
  lines.push('## Options');
  const slots = OPTION_SLOTS.filter(([k]) => p.options.some((o) => o[k]));
  lines.push('| type | option | gets you | costs you |' + slots.map(([, h]) => ' ' + h + ' |').join(''));
  lines.push('|-|-|-|-|' + slots.map(() => '-|').join(''));
  for (const o of p.options) {
    lines.push('| ' + cell(o.type) + ' | ' + cell(o.option) + ' | ' + cell(o.getsYou) + ' | ' + cell(o.costsYou) + ' |'
      + slots.map(([k]) => ' ' + cell(o[k]) + ' |').join(''));
  }
  lines.push('');
  for (const [heading, text] of [['## Stakes', p.stakes], ['## While this waits', p.whileThisWaits], ['## Context', p.context]]) {
    lines.push(heading);
    if (text) lines.push(guardHeadings(text));
    lines.push('');
  }
  return '\n' + lines.join('\n') + '\n';
}

/* The gist and sections of a stored question, its Answer section included. */
export function questionSections(body, answer) {
  const lines = (body + '## Answer\n' + answer).split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].startsWith('# ')) i++;
  i++;
  const gist = [];
  while (i < lines.length && !lines[i].startsWith('## ')) gist.push(lines[i++]);
  const sections = {};
  while (i < lines.length) {
    const heading = lines[i++].slice(3).trim();
    const content = [];
    while (i < lines.length && !lines[i].startsWith('## ')) content.push(lines[i++]);
    sections[heading] = content.join('\n').trim();
  }
  return { gist: gist.join('\n').trim(), sections };
}

export function parseOptions(sectionText) {
  const rows = [];
  let slotAt = [];
  for (const line of String(sectionText || '').split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (cells[0] === 'type') {
      slotAt = [];
      cells.forEach((h, i) => {
        const s = i >= 4 && OPTION_SLOTS.find(([, head]) => head === h.toLowerCase());
        if (s) slotAt.push([i, s[0]]);
      });
      continue;
    }
    if (cells.length < 4) continue;
    const row = { type: cells[0], option: cells[1], getsYou: cells[2], costsYou: cells[3] };
    for (const [i, k] of slotAt) if (cells[i]) row[k] = cells[i];
    rows.push(row);
  }
  return rows;
}

/* The ## Reverses text back as [{ id, name, quote, declined }] for the cards. */
export function parseReverses(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || '').split('\n')) {
    const head = /^(Q[1-9]\d*) \((.*)\):$/.exec(line);
    if (head) out.push(cur = { id: head[1], name: head[2], quote: '', declined: [] });
    else if (cur && line.startsWith('>')) cur.quote = (cur.quote + ' ' + line.slice(1).trim()).trim();
    else if (cur && line.startsWith('- ')) cur.declined.push(line.slice(2).trim());
  }
  return out;
}

/* ---- answer tokens (lib/answer-token.mjs) ---- */

const isLetterType = (t) => /^[a-z]$/.test(String(t ?? '').trim());
const fold = (s) => String(s ?? '').trim().toLowerCase();
const numberOf = (id) => { const m = /^[Qq]?(\d+)$/.exec(String(id ?? '').trim()); return m ? m[1] : null; };

function parseComposed(token) {
  const m = /^(\d+)([a-z])$/.exec(fold(token));
  return m ? { number: m[1], letter: m[2] } : null;
}

function answerToken(id, type) {
  const t = String(type ?? '').trim();
  if (!isLetterType(t)) return t;
  const n = numberOf(id);
  return n === null ? t : n + t;
}

function matchesToken(id, type, typed) {
  const t = fold(typed);
  const stored = fold(type);
  if (!t || !stored) return false;
  if (t === stored) return true;
  if (!isLetterType(stored)) return false;
  const parsed = parseComposed(t);
  if (!parsed || parsed.letter !== stored) return false;
  const n = numberOf(id);
  return n === null || n === parsed.number;
}

export function answeredPick(q) {
  const m = /^\s*([A-Za-z0-9][\w-]*)\s*[.:,]/.exec(String(q.answer || ''));
  if (!m) return null;
  const num = String(q.id).replace(/^Q/i, '');
  const tok = m[1].toLowerCase();
  const hit = (q.options || []).find((o) => {
    const t = String(o.type || '').toLowerCase();
    return t && (tok === t || tok === num + t || tok === 'q' + num + t);
  });
  return hit ? String(hit.type).toLowerCase() : null;
}

const isEarlierAnswer = (p) => /^Earlier answer, given /.test(String(p ?? ''));

/* ---- labels, keys and references ---- */

export const isQuestionToken = (id) => /^[Qq]\d{1,15}$/.test(String(id).trim());

function idNum(id) {
  const m = /^[Qq]?(\d+)$/.exec(String(id).trim());
  if (!m) throw new UsageError('bad question id: ' + id);
  return Number(m[1]);
}

/* an old plan or thread id names the track it became */
const PREFIX_KIND = { WS: 'workstream', P: 'track', T: 'task', TR: 'track', TH: 'track', K: 'knowledge', PR: 'procedure' };

function parseWorkToken(id) {
  const raw = String(id).trim();
  const m = /^(ws|pr|p|th|tr|t|k)-([1-9]\d{0,14})$/i.exec(raw);
  if (!m) {
    if (isQuestionToken(raw)) throw new UsageError(raw.toUpperCase() + ' is a question id; this verb takes a work record id (WS-n, P-n, T-n, TR-n, TH-n, or K-n)');
    throw new UsageError('bad record id: ' + id + ' (expected WS-n, P-n, T-n, TR-n, TH-n, or K-n)');
  }
  const prefix = m[1].toUpperCase();
  return { kind: PREFIX_KIND[prefix], prefix, id: prefix + '-' + Number(m[2]) };
}

function refTokenOf(value, key, prefix) {
  if (value === undefined) return undefined;
  const prefixes = [].concat(prefix);
  const want = key + ' must be a ' + prefixes[0] + '-n id';
  if (typeof value !== 'string') throw new UsageError(want);
  if (isKey(value.trim())) return value.trim();
  let t;
  try { t = parseWorkToken(value); } catch { throw new UsageError(want + ': ' + value); }
  if (!prefixes.includes(t.prefix)) throw new UsageError(want + ': ' + value);
  return t.id;
}

/* A track, or an old plan or thread id, which resolves to the track it became. */
const TRACK_IDS = ['TR', 'P', 'TH'];

const entryOf = (r) => { const front = JSON.parse(r.fields); return { key: r.key, kind: r.kind, front, label: String(front.id || '') }; };

/* labels.mjs resolveRecord on the questions' day. */
export const resolve = (db, token, kinds, d = dayOf()) => resolveRecord(db, token, { kinds: kinds || undefined, day: d });

/* A scoping reference to the key it stores; one no record holds is refused by name. */
function refFor(db, token, kind, d) {
  const raw = String(token).trim();
  const e = resolve(db, raw, [kind], d);
  if (e) return e.key;
  throw new UsageError(isKey(raw) ? 'unknown record key: ' + raw : 'unknown ' + kind + ' id: ' + raw);
}

function filterRef(db, token, d) {
  const e = resolve(db, token, null, d);
  return e ? e.key : token;
}

/* ---- records ---- */

function readRec(db, key) {
  const r = db.stmt('SELECT key, kind, slug, fields, body, layout, track, version FROM records WHERE key = ?').get(key);
  return r ? { ...r, fields: JSON.parse(r.fields), layout: r.layout ? JSON.parse(r.layout) : null } : null;
}

function answerOf(db, key) {
  const notes = db.stmt('SELECT body FROM notes WHERE record = ? ORDER BY position').all(key);
  return notes.length ? notes.map((n) => unguardHeadings(n.body)).join('\n\n') : ANSWER_PLACEHOLDER;
}

function withSections(db, rec) {
  const answer = answerOf(db, rec.key);
  return { ...rec, front: rec.fields, ...questionSections(rec.body, answer) };
}

/* `answer`, when given, replaces the Answer section, split as the import splits it. */
function saveQ(db, q, answer) {
  const fields = ordered(q.front || q.fields);
  putRecord(db, { key: q.key, kind: 'question', slug: q.slug, fields, body: q.body, layout: q.layout, track: q.track });
  if (answer !== undefined) {
    /* stored guarded as every note is, since answerOf reads it back unguarded */
    putNotes(db, q.key, String(answer).split('\n\n').map((body, i) => ({ at: i === 0 ? (fields.answered || fields.updated || null) : null, body: guardHeadings(body) })));
  }
}

function loadQuestion(db, id, d) {
  const t = String(id ?? '').trim();
  const label = isKey(t) ? t : 'Q' + idNum(t);
  const e = resolve(db, t, ['question'], d);
  if (!e) throw new UsageError('unknown question id: ' + label);
  return withSections(db, readRec(db, e.key));
}

/* A read-compare-write caller hands in the version it saw. */
const movedSince = (rec, version) => version !== undefined && version !== null && Number(version) !== rec.version;

/* a question belongs to the session holding its track's lease, else its
   asker; `memo` (track to holder) keeps a listing to one read per track. */
function ownerOf(db, front, memo) {
  const t = front && front.track;
  if (t) {
    const held = memo && memo.has(t) ? memo.get(t) : (db.stmt('SELECT session FROM leases WHERE track = ?').get(t) || {}).session;
    if (memo) memo.set(t, held);
    if (held) return held;
  }
  return front ? front.session : undefined;
}

/* Subscriptions are derived: an imported record's own list,
   the asking session, the track's holder, then every session that surfaced it. */
function subscribersOf(db, front) {
  const out = [];
  const add = (s) => { if (typeof s === 'string' && s && !out.includes(s)) out.push(s); };
  listOf(front, 'subscribers').forEach(add);
  add(front.session);
  add(ownerOf(db, front));
  if (isKey(front.key)) {
    for (const r of db.stmt("SELECT actor FROM activity WHERE record = ? AND verb IN ('surface', 'subscribe') ORDER BY seq").all(front.key)) add(sessionOfBy(r.actor));
  }
  return out;
}

function reversalFields(f, sections) {
  return {
    ...(listOf(f, 'revisits').length ? { revisits: listOf(f, 'revisits') } : {}),
    ...(listOf(f, 'cites').length ? { cites: listOf(f, 'cites') } : {}),
    ...(sections['Reverses'] ? { reverses: parseReverses(sections['Reverses']) } : {}),
    ...(sections['Reversal'] ? { reversal: sections['Reversal'] } : {}),
  };
}

function payloadOf(db, q) {
  const f = shownFront(db, q.front);
  return {
    ...f,
    subscribers: subscribersOf(db, q.front),
    ...reversalFields(f, q.sections),
    gist: q.gist,
    options: parseOptions(q.sections['Options']),
    stakes: q.sections['Stakes'] ?? '',
    whileThisWaits: q.sections['While this waits'] ?? '',
    context: q.sections['Context'] ?? '',
    answer: q.sections['Answer'] ?? '',
    version: q.version,
  };
}

/* ---- projects (a shared name, the PC's normalised remote) ---- */

const normDir = (d) => String(d || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');

/* The name a filter matches: the remote the PC handed in, else the folder's own path. */
function scopeOf(project, projectRepo) {
  const name = typeof projectRepo === 'string' && projectRepo ? projectRepo : normDir(project);
  return name || null;
}

/* a record written before the map keeps its folder, which names it the same way */
const nameOf = (repo, dir) => (typeof repo === 'string' && repo) || normDir(dir);

function inProject(scope, dir, repo) {
  return !scope || nameOf(repo, dir) === scope;
}

function wsInProject(front, scope) {
  return listOf(front, 'projectRepos').includes(scope) || listOf(front, 'projects').some((d) => normDir(d) === scope);
}

/* two workstreams share a project when a shared name or a folder of one is the other's */
export function sharesProject(a, b) {
  return [...listOf(a, 'projectRepos'), ...listOf(a, 'projects').map(normDir)].some((s) => s && wsInProject(b, s));
}

/* ---- register ---- */

function gateList(v, key) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new UsageError(key + ' must be an array of T-n ids');
  return [...new Set(v.map((x) => refTokenOf(x, key, 'T')))];
}

function questionList(v, key) {
  if (v === undefined || v === null) return [];
  const bad = (x) => typeof x !== 'string' || !(isQuestionToken(x) || isKey(x.trim()));
  if (!Array.isArray(v) || v.some(bad)) throw new UsageError(key + ' must be a list of question labels, like ["Q512"]');
  return [...new Set(v.map((x) => (isKey(x.trim()) ? x.trim() : canonLabel(x))))];
}


function validatePayload(raw, strict) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError('register payload must be a JSON object');
  const need = (k) => {
    if (typeof raw[k] !== 'string' || !raw[k].trim()) throw new UsageError('register payload needs a non-empty ' + k + ' string');
    return raw[k].trim();
  };
  const optStr = (k) => {
    if (raw[k] === undefined) return undefined;
    if (typeof raw[k] !== 'string') throw new UsageError(k + ' must be a string');
    return raw[k];
  };
  const p = { name: need('name'), gist: need('gist'), session: need('session') };
  /* the shared name; a caller that sends only a folder has it named by its path */
  const dir = optStr('projectDir') || '';
  p.projectRepo = (optStr('projectRepo') || '').trim() || normDir(dir);
  if (!p.projectRepo) throw new UsageError("register payload needs a non-empty projectRepo (the project's shared name) or projectDir string");
  if (typeof raw.blocking !== 'boolean') throw new UsageError('register payload needs a blocking boolean');
  p.blocking = raw.blocking;
  p.topic = optStr('topic');
  p.mission = optStr('mission');
  p.pickless = raw.pick === null;
  p.pick = p.pickless ? undefined : optStr('pick');
  if (raw.created !== undefined) {
    if (typeof raw.created !== 'string' || !(DAY_RE.test(raw.created) || isFullStamp(raw.created))) {
      throw new UsageError('created must be YYYY-MM-DD or a full local timestamp (YYYY-MM-DDTHH:MM:SS+HH:MM)');
    }
    p.created = raw.created;
  }
  p.workstream = refTokenOf(optStr('workstream'), 'workstream', 'WS');
  for (const k of ['plan', 'thread']) {
    if (raw[k] !== undefined) throw new UsageError('register takes no ' + k + ': plans and threads are tracks now, so name it in "track" (TR-n)');
  }
  /* null says no track, so the session's held one is not filled in (an import places its own) */
  p.trackless = raw.track === null;
  p.track = p.trackless ? undefined : refTokenOf(optStr('track'), 'track', TRACK_IDS);
  p.gates = gateList(raw.gates, 'gates');
  p.revisits = questionList(raw.revisits, 'revisits');
  p.cites = questionList(raw.cites, 'cites');
  p.reversal = (optStr('reversal') || '').trim();
  if (p.revisits.length && !p.reversal) {
    throw new UsageError('revisits needs a reversal: what changed since the ruling, in short lines;'
      + ' the hub quotes the ruling and the costs it turned down');
  }
  if (p.reversal && !p.revisits.length) throw new UsageError('a reversal names the ruling it reopens in revisits');
  p.project = optStr('project') || dir.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p.projectRepo.split('/').filter(Boolean).pop();
  p.asked = raw.asked === undefined ? 1 : raw.asked;
  if (p.asked !== 0 && p.asked !== 1) throw new UsageError('asked must be 0 or 1');
  p.stakes = optStr('stakes') || '';
  p.whileThisWaits = optStr('whileThisWaits') || '';
  p.context = optStr('context') || '';
  p.options = raw.options === undefined ? [] : raw.options;
  if (!Array.isArray(p.options)) throw new UsageError('options must be an array');
  for (const o of p.options) {
    if (!o || typeof o !== 'object') throw new UsageError('each option must be an object');
    for (const k of ['type', 'option']) if (typeof o[k] !== 'string') throw new UsageError('option field ' + k + ' must be a string');
    /* a row without its second or third column goes in with it empty */
    for (const k of ['getsYou', 'costsYou', ...OPTION_SLOTS.map(([s]) => s)]) {
      if (o[k] !== undefined && o[k] !== null && typeof o[k] !== 'string') throw new UsageError('option field ' + k + ' must be a string');
    }
  }
  p.options = p.options.map((o) => {
    const out = { ...o, getsYou: o.getsYou ?? '', costsYou: o.costsYou ?? '' };
    for (const [k] of OPTION_SLOTS) {
      const v = typeof o[k] === 'string' ? oneLineOf(o[k]) : '';
      if (v) out[k] = v; else delete out[k];
    }
    return out;
  });
  if (raw.crux !== undefined && raw.crux !== null && typeof raw.crux !== 'string') throw new UsageError('crux must be a string');
  p.crux = (typeof raw.crux === 'string' && oneLineOf(raw.crux)) || undefined;
  if (raw.ask !== undefined && raw.ask !== null) {
    const ask = typeof raw.ask === 'string' ? oneLineOf(raw.ask) : '';
    if (!ask.endsWith('?') || ask.length > ASK_MAX) throw new UsageError('ask must be ' + ASK_SHAPE + ', at most ' + ASK_MAX + ' characters');
    p.ask = ask;
  } else if (strict) {
    throw new UsageError('register payload needs an ask: ' + ASK_SHAPE);
  }
  /* a stored type is one lowercase letter, unique within the question */
  const seenType = new Set();
  for (const o of p.options) {
    const t = o.type.trim();
    if (!t) continue;
    if (!isLetterType(t)) {
      throw new UsageError('option type "' + t + '" ' + (parseComposed(t) ? 'is the old reply-ordinal form; an' : 'is not one letter; an')
        + " option type is one letter, a to z, and the answer token 106a is composed from the question's number");
    }
    if (seenType.has(t)) throw new UsageError('option type "' + t + '" appears twice; an option type is unique within the question');
    seenType.add(t);
  }
  if (p.pick) {
    const typed = p.options.filter((o) => o.type.trim());
    if (typed.length) {
      const hit = typed.find((o) => matchesToken(null, o.type.trim(), p.pick));
      if (!hit) throw new UsageError('pick "' + p.pick + '" names no option; the options are ' + typed.map((o) => o.type.trim()).join(', '));
      p.pick = hit.type.trim();
    }
  }
  p.evidence = raw.evidence === undefined ? [] : raw.evidence;
  if (!Array.isArray(p.evidence) || p.evidence.some((e) => typeof e !== 'string')) throw new UsageError('evidence must be an array of strings');
  /* an import's label and row ref, at birth only (question edit changes neither) */
  p.labels = strList(raw.labels, 'labels');
  p.refs = strList(raw.refs, 'refs');
  /* a placement question's press creates a task, so only the board's own filing asks one (askPlacement) */
  const placing = raw.placement !== undefined || p.labels.some((l) => l.trim().toLowerCase() === PLACEMENT_LABEL);
  if (placing && !raw[BOARD_ASKS]) {
    throw new UsageError('a placement question is asked by the board from the filing call itself, never registered: file the work with place (or task create, track capture, task update leftovers) and the board asks the user where it goes');
  }
  if (raw.placement !== undefined && (!raw.placement || typeof raw.placement !== 'object' || Array.isArray(raw.placement))) {
    throw new UsageError('placement must be an object: the filing its answer creates');
  }
  p.placement = raw.placement;
  return p;
}

function headlineWarnings(id, p) {
  const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const out = [];
  p.options.forEach((o, i) => {
    if (!o.headline) return;
    const h = norm(o.headline);
    const which = h === norm(o.getsYou) ? 'what happens' : h === norm(o.costsYou) ? 'catch' : '';
    if (!which) return;
    const name = o.type.trim() ? answerToken(id, o.type.trim()) : 'option ' + (i + 1);
    out.push(id + ' ' + name + ': the headline repeats its ' + which + ' cell; a headline says one plain thing the row does not');
  });
  return out;
}

function pickWarning(id, p) {
  if (p.pick || p.pickless || !p.options.some((o) => o.type.trim())) return null;
  return id + ' has options but no pick: set it with question edit ' + id
    + ' --pick <letter>, or register "pick": null when there is no recommendation';
}

/* "(a" naming an option becomes "(25a" once the number is known. */
function askWithTokens(id, ask, options) {
  if (!ask) return ask;
  const types = new Set(options.map((o) => o.type.trim()).filter(isLetterType));
  return ask.replace(/\(([a-z])(?=[,)])/g, (m, l) => (types.has(l) ? '(' + answerToken(id, l) : m));
}

/* One ruling's ## Reverses text, frozen at registration: its label and name, its
   Answer's first paragraph verbatim, and each option the answer turned down with its catch. */
function reversesBlock(q) {
  const options = parseOptions(q.sections['Options']);
  const answer = String(q.sections['Answer'] || '').trim();
  const chose = answeredPick({ id: q.front.id, answer, options });
  const lines = [q.front.id + ' (' + oneLineOf(q.front.name) + '):', ''];
  lines.push(...(answer.split(/\n\s*\n/)[0] || '').split('\n').map((l) => '> ' + l), '');
  const declined = options.filter((o) => !chose || o.type.trim().toLowerCase() !== chose);
  if (declined.length) lines.push('Turned down:', '');
  for (const o of declined) {
    const t = o.type.trim();
    const costs = oneLineOf(o.costsYou || '');
    lines.push('- ' + (t ? answerToken(q.front.id, t) + ', ' : '') + oneLineOf(o.option) + (costs ? ': ' + costs : ''));
  }
  return lines.join('\n').trim();
}

/* A label inside a file name or path (an old queue's `.claude/questions/Q1-take.md`) names no board record. */
function inPath(text, at, len) {
  return /[\\/.]/.test(text[at - 1] || '') || /^(-[a-z]|\.[A-Za-z0-9])/.test(text.slice(at + len, at + len + 2));
}

/* The first answered question a strict payload names by label and does not list. */
function unlistedRuling(db, p, d) {
  const listed = new Set([...p.revisits, ...p.cites]);
  const texts = [p.ask, p.crux, p.gist, p.stakes];
  for (const o of p.options) texts.push(o.option, o.getsYou, o.costsYou, ...OPTION_SLOTS.map(([k]) => o[k]));
  const seen = new Set();
  for (const t of texts) {
    const text = String(t || '');
    for (const m of text.matchAll(/\bQ\d+\b/g)) {
      if (seen.has(m[0]) || inPath(text, m.index, m[0].length)) continue;
      seen.add(m[0]);
      const e = resolve(db, m[0], ['question'], d);
      if (e && e.front.status === 'answered' && !listed.has(e.key)) return m[0];
    }
  }
  return null;
}

/* Revisits must name rulings (answered questions); both lists store keys. */
function rulingChecks(db, p, strict, d) {
  const entry = (token, key) => {
    const e = resolve(db, token, ['question'], d);
    if (!e) throw new UsageError(key + ' names ' + token + ', and no question holds it');
    return e;
  };
  const rulings = p.revisits.map((r) => {
    const q = withSections(db, readRec(db, entry(r, 'revisits').key));
    if (q.front.status !== 'answered') throw new UsageError(q.front.id + ' is ' + q.front.status + ': revisits names an answered question, a ruling');
    return q;
  });
  p.revisits = [...new Set(rulings.map((q) => q.key))];
  p.cites = [...new Set(p.cites.map((c) => entry(c, 'cites').key))];
  if (strict) {
    const named = unlistedRuling(db, p, d);
    if (named) {
      throw new UsageError(named + ' is answered, a ruling: list it in cites when this question only mentions it,'
        + " or in revisits with a reversal when this question reopens it; an old queue's question is named by its title instead");
    }
  }
  return { rulings };
}

/* ---- inherited scope ---- */

const rowsOf = (db, sql, ...args) => db.stmt(sql).all(...args).map(entryOf);

/* A record's workstream and track: a task's track is where it sits. */
function scopeOfRecord(db, ref, d) {
  const e = resolve(db, ref, null, d);
  if (!e) return { workstream: '', track: '' };
  const f = e.front;
  if (e.kind === 'workstream') return { workstream: e.key, track: '' };
  if (e.kind === 'track') return { workstream: f.workstream || '', track: e.key };
  if (e.kind === 'task') {
    const on = db.stmt('SELECT ti.track, r.workstream FROM track_items ti JOIN records r ON r.key = ti.track WHERE ti.task = ?').get(e.key);
    return { workstream: f.workstream || (on && on.workstream) || '', track: on ? on.track : '' };
  }
  return { workstream: '', track: '' };
}

const heldTrack = (db, session) => rowsOf(db, 'SELECT r.key, r.kind, r.fields FROM leases l JOIN records r ON r.key = l.track WHERE l.session = ?', session)[0];

/* The project's open inbox workstream, minted on first use with today's front. */
export function inboxOf(db, p, at, d, actor) {
  const scope = scopeOf('', p.projectRepo);
  for (const e of rowsOf(db, `SELECT key, kind, fields FROM records WHERE kind = 'workstream' AND status = 'open'
    AND EXISTS (SELECT 1 FROM json_each(fields, '$.labels') WHERE value = ?) ORDER BY id`, INBOX_LABEL)) {
    if (wsInProject(e.front, scope)) return { id: e.label, ref: e.key, created: false };
  }
  const key = mintKey(db);
  const id = pickLabel(db, 'workstream', d);
  const name = p.project + ': inbox';
  const fields = {
    id, key, name, status: 'open', outcome: '', projectRepos: [p.projectRepo],
    created: at, updated: at, closed: '', labels: [INBOX_LABEL], refs: [], labelHistory: [id + ' ' + d],
  };
  const description = 'Questions registered in ' + p.project + ' with no workstream land here; move one out with question edit --workstream.';
  putRecord(db, { key, kind: 'workstream', slug: kebab(name, 'workstream'), fields, body: '\n## Description\n\n' + guardHeadings(description) + '\n\n' });
  log(db, actor, { at, verb: 'create', kind: 'workstream', front: fields, changes: changesOf({}, fields) });
  return { id, ref: key, created: true };
}

/* Fills the track and workstream the payload left out: the track the session
   holds (when its workstream fits and the payload's track is not null), then the workstream from the track, its
   tasks in hand, the tasks its agents run (its open agent runs), the subscribed
   workstreams; several workstreams refuse, none files in the project inbox. */
function inheritScope(db, p, at, d, actor) {
  const notes = [];
  const held = heldTrack(db, p.session);
  if (!p.track && !p.trackless && held && (!p.workstream || p.workstream === held.front.workstream)) {
    p.track = held.key;
    notes.push('track ' + held.label + ' (held by this session)');
  }
  if (p.workstream) return notes;
  const steps = [];
  const track = p.track ? readRec(db, p.track).fields : null;
  if (track && track.workstream) steps.push({ from: 'track ' + track.id, scopes: [{ workstream: track.workstream }] });
  /* several tasks in hand, so the refusal names each */
  const hand = rowsOf(db, `SELECT key, kind, fields FROM records WHERE kind = 'task' AND status NOT IN ('done', 'dropped')
    AND ${openRunSql('key', { session: true, worker: 'session' })} ORDER BY id`, p.session);
  if (hand.length) steps.push({ from: 'in hand ' + hand.map((e) => e.label).join(', '), scopes: hand.map((e) => scopeOfRecord(db, e.key, d)) });
  const working = rowsOf(db, `SELECT key, kind, fields FROM records WHERE kind = 'task' AND status NOT IN ('done', 'dropped')
    AND NOT ${openRunSql('key', { session: true, worker: 'session' })} AND ${openRunSql('key', { session: true, worker: 'agent' })} ORDER BY id`, p.session, p.session);
  if (working.length) steps.push({ from: 'its agents run ' + working.map((e) => e.label).join(', '), scopes: working.map((e) => scopeOfRecord(db, e.key, d)) });
  const subscribed = rowsOf(db, `SELECT key, kind, fields FROM records WHERE kind = 'workstream' AND status = 'open'
    AND EXISTS (SELECT 1 FROM json_each(fields, '$.subscribers') WHERE value = ?) ORDER BY id`, p.session);
  if (subscribed.length) steps.push({ from: 'subscribed to ' + subscribed.map((e) => e.label).join(', '), scopes: subscribed.map((e) => ({ workstream: e.key })) });
  let cands = null;
  const used = [];
  for (const st of steps) {
    const set = new Set(st.scopes.map((x) => x.workstream).filter(Boolean));
    if (!set.size) continue;
    const next = cands ? [...cands].filter((w) => set.has(w)) : [...set];
    if (!next.length) continue;
    cands = new Set(next);
    used.push(st);
    if (cands.size === 1) break;
  }
  if (cands && cands.size > 1) {
    throw new UsageError('this session spans ' + [...cands].map((w) => labelOf(db, w)).sort().join(', ') + ' ('
      + used.map((st) => st.from).join('; ') + '); name one with "workstream" in the register payload');
  }
  if (cands) {
    const ws = [...cands][0];
    p.workstream = ws;
    notes.push(labelOf(db, ws) + ' (from ' + used.map((st) => st.from).join(' and ') + ')');
    return notes;
  }
  const inbox = inboxOf(db, p, at, d, actor);
  p.workstream = inbox.ref;
  notes.push(inbox.id + ', the ' + p.project + ' inbox' + (inbox.created ? ' (created now)' : '')
    + ': this session names no workstream; move it with question edit --workstream');
  return notes;
}

/* register(db, payload, actor, { strict, inherit, now }): today's payload and result, less the file and URL. */
export function register(db, payload, actor, opts = {}) {
  const strict = opts.strict === true;
  const p = validatePayload(payload, strict);
  const who = actor || { session: p.session };
  return tx(db, () => {
    const d = today(opts);
    if (p.workstream) p.workstream = refFor(db, p.workstream, 'workstream', d);
    if (p.track) p.track = refFor(db, p.track, 'track', d);
    p.gates = [...new Set(p.gates.map((g) => refFor(db, g, 'task', d)))];
    const at = stamp(opts);
    const { rulings } = rulingChecks(db, p, strict, d);
    const forced = rulings.length > 0 && !p.blocking;
    if (rulings.length) p.blocking = true;
    const inherited = opts.inherit ? inheritScope(db, p, at, d, who) : [];
    /* a question gating a release says what the arc found, on the card the user answers from */
    const rel = p.gates.map((k) => db.stmt("SELECT key, fields FROM records WHERE key = ? AND kind = 'task'").get(k)).filter(Boolean)
      .map((r) => ({ key: r.key, fields: JSON.parse(r.fields) })).find((t) => isRelease(t.fields));
    const relTrack = rel ? (db.stmt('SELECT track FROM track_items WHERE task = ?').get(rel.key) || {}).track || p.track : null;
    if (relTrack) p.gist = [p.gist.trimEnd(), releaseLine(db, rel, relTrack)].join('\n');
    const key = mintKey(db);
    const id = pickLabel(db, 'question', d);
    p.ask = askWithTokens(id, p.ask, p.options);
    /* no subscribers list: the asking session is `session`, the rest derived */
    const front = ordered({
      id, key, name: p.name, ask: p.ask, topic: p.topic, status: 'open', blocking: p.blocking,
      created: p.created || at, asked: p.asked, pick: p.pick, crux: p.crux, project: p.project,
      projectRepo: p.projectRepo, workstream: p.workstream, track: p.track,
      gates: p.gates, revisits: p.revisits, cites: p.cites, labels: p.labels, refs: refsFor(db, p.refs, d), mission: p.mission, session: p.session,
      pc: pcOfCall(payload, actor), placement: p.placement,
      evidence: p.evidence, labelHistory: [id + ' ' + d],
    });
    p.reverses = rulings.map(reversesBlock).join('\n\n');
    putRecord(db, { key, kind: 'question', slug: kebab(p.name, 'question'), fields: front, body: renderBody(front, p) });
    log(db, who, { at, verb: 'create', front, changes: changesOf({}, front) });
    /* a look ends in its question, so the asking session's run on it ends (a run outranks a gate in the word) */
    const looks = p.gates.filter(isLook(db));
    if (looks.length) endSessionRuns(db, { session: p.session, tasks: looks, note: 'the look asked the user ' + id + ', which gates it' }, { ...(typeof who === 'object' ? who : { by: who }), now: clockNow(opts) });
    const warnings = inherited.map((t) => id + ' filed under ' + t);
    if (forced) warnings.push(id + ' reverses a ruling, so it is stored blocking');
    const pw = pickWarning(id, p);
    if (pw) warnings.push(pw);
    warnings.push(...headlineWarnings(id, p));
    const shown = shownFront(db, { workstream: p.workstream, track: p.track, gates: p.gates, revisits: p.revisits, cites: p.cites });
    return {
      id, key, name: p.name, ask: p.ask,
      ...(p.workstream ? { workstream: shown.workstream } : {}),
      ...(p.track ? { track: shown.track } : {}),
      ...(p.gates.length ? { gates: shown.gates } : {}),
      ...(p.revisits.length ? { revisits: shown.revisits, reverses: parseReverses(p.reverses) } : {}),
      ...(p.cites.length ? { cites: shown.cites } : {}),
      ...(warnings.length ? { warnings } : {}),
    };
  });
}

/* ---- answer, amend, drop ---- */

function answerLine(id, pick, note, options) {
  let head = '';
  if (pick) {
    const hit = (options || []).find((o) => o.type === pick);
    const token = hit ? answerToken(id, hit.type) : pick;
    head = hit && hit.option ? token + ', ' + hit.option : token;
  }
  if (head && note) return head + '. Why: ' + note;
  if (head) return head + '.';
  return note;
}

function resolvePick(qid, pick, options) {
  if (!pick) return pick;
  const hit = (options || []).find((o) => matchesToken(qid, o.type, pick));
  if (hit) return String(hit.type ?? '').trim();
  const composable = (options || []).some((o) => isLetterType(o && o.type));
  const parsed = parseComposed(pick);
  if (composable && parsed && 'Q' + parsed.number !== String(qid)) throw new UsageError(pick + ' names Q' + parsed.number + ', not ' + qid);
  return pick;
}

const answerParas = (text) => String(text ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
const earlierAnswer = (gaveAt, at, text) => 'Earlier answer, given ' + gaveAt + ' and replaced by the answer above on ' + at + ': ' + text;

function recordedPick(qid, answerText, options) {
  const m = /^\s*([A-Za-z0-9][\w-]*)\s*[.:,]/.exec(String(answerText || ''));
  if (!m) return null;
  const hit = (options || []).find((o) => matchesToken(qid, o.type, m[1]));
  return hit ? String(hit.type ?? '').trim() : null;
}

/* a journal paragraph on each task an ended question gates. */
function noteGated(db, front, words, at, actor, d) {
  for (const g of listOf(front, 'gates')) {
    const e = resolve(db, g, ['task'], d);
    if (!e) continue;
    const rec = readRec(db, e.key);
    if (Object.hasOwn(rec.fields, 'updated')) rec.fields.updated = at;
    else rec.fields = Object.fromEntries(Object.entries(rec.fields).flatMap(([k, v]) => (k === 'created' ? [[k, v], ['updated', at]] : [[k, v]])));
    putRecord(db, rec);
    addNote(db, rec.key, { at, actor: byOf(actor), body: guardHeadings(words) });
    log(db, actor, { at, verb: 'note', kind: rec.kind, front: rec.fields, note: words });
  }
}

const WAKE_ENDINGS = { workstream: ENDED.workstream, task: ENDED.task, track: ENDED.track, question: ENDED.question };

/* any ending wakes the questions snoozed on it, one level
   deep, in the ending's own transaction, after the ending's own row. Every
   ending calls this one: answer and drop here, the work and track endings.
   `ctx` is the ending's { at, by, pc } (records.mjs actorOf). */
export function wakeLinked(db, ended, ending, ctx) {
  const { at } = ctx;
  const actor = { by: ctx.by, pc: ctx.pc };
  const phrase = ended.id + ' ' + ending;
  const ref = isKey(ended.key) ? ended.key : String(ended.id || '');
  const woke = [];
  for (const r of db.stmt("SELECT key FROM records WHERE kind = 'question' AND status = 'snoozed' AND json_extract(fields, '$.snooze.wakeOn') = ?").all(ref)) {
    const rec = readRec(db, r.key);
    const was = snapFront(rec.fields);
    rec.fields.status = 'open';
    delete rec.fields.snooze;
    rec.fields.wokeBy = phrase;
    saveQ(db, rec);
    log(db, actor, { at, verb: 'wake', front: rec.fields, changes: changesOf(was, rec.fields), note: 'woken by ' + phrase });
    woke.push(rec.fields.id);
  }
  /* the same ending unparks the lines and closes the tasks waiting on it */
  onEnding(db, ended, ending, ctx);
  return woke;
}

/* answer(db, { id, pick, note, amend, version, shown }, actor): an answer to a question
   that moved since `version` and now stands answered amends it by today's rules;
   one read before a rewording is refused. `shown`, the version a card showed,
   only refuses that: it never amends, so a stale press finds the answer that stands. */
export function answer(db, input = {}, actor, opts = {}) {
  const { id, pick, note } = input;
  if (!pick && !note) throw new UsageError('answer needs --pick or --note');
  const who = actingAs(actor, input);
  const read = input.version ?? input.shown;
  return tx(db, () => {
    const d = today(opts);
    const q = loadQuestion(db, id, d);
    const owner = ownerReport(db, q.front);
    if (q.front.status !== 'dropped' && beforeReword(q, read)) {
      throw new UsageError(q.front.id + ' was reworded after version ' + read + ', the one this answer was read from;'
        + ' read it again and answer its current wording');
    }
    const options = parseOptions(q.sections['Options']);
    const amend = input.amend || (movedSince(q, input.version) && q.front.status === 'answered');
    if (amend) {
      if (q.front.status !== 'answered') {
        throw new UsageError(q.front.status === 'dropped'
          ? q.front.id + ' is dropped, not answered; --amend corrects an answered question'
          : q.front.id + ' is not answered yet; answer it without --amend');
      }
      const chosen = resolvePick(q.front.id, pick, options);
      const line = answerLine(q.front.id, chosen, note, options);
      const paras = answerParas(q.sections['Answer']);
      let cut = paras.findIndex(isEarlierAnswer);
      if (cut < 0) cut = paras.length;
      const current = paras.slice(0, cut).join(' ').trim();
      const kept = paras.slice(cut);
      if (answerParas(line).join(' ').trim() === current) return { id: q.front.id, key: q.key, name: q.front.name, status: 'answered', amended: false, owner };
      const at = stamp(opts);
      const gaveAt = (kept.length ? q.front.updated || q.front.answered : q.front.answered) || at;
      const was = snapFront(q.front);
      const wasChosen = recordedPick(q.front.id, current, options);
      q.front.updated = at;
      const placed = placementAnswered(db, q, { pick: chosen, note, line, amend: true }, { at, actor: who, pc: who && who.pc, now: clockNow(opts) });
      saveQ(db, q, (current ? [line, earlierAnswer(gaveAt, at, current), ...kept] : [line, ...kept]).join('\n\n'));
      const changes = { ...changesOf(was, q.front), ...(placed ? placed.changes : {}) };
      if (wasChosen || chosen) changes.chosen = [wasChosen, chosen || null];
      log(db, who, { at, verb: 'amend', front: q.front, changes, note });
      return { id: q.front.id, key: q.key, name: q.front.name, status: 'answered', amended: true, owner, ...placedOf(placed) };
    }
    /* a pressed answer run again with the pick it stored stands, named; another pick still refuses */
    if (q.front.status === 'answered' && pick) {
      const chosen = resolvePick(q.front.id, pick, options);
      const paras = answerParas(q.sections['Answer']);
      const cut = paras.findIndex(isEarlierAnswer);
      const current = paras.slice(0, cut < 0 ? paras.length : cut).join(' ').trim();
      const same = chosen && recordedPick(q.front.id, current, options) === chosen
        && (!note || answerParas(answerLine(q.front.id, chosen, note, options)).join(' ').trim() === current);
      if (same) return { id: q.front.id, key: q.key, name: q.front.name, status: 'answered', pick: answerToken(q.front.id, chosen), already: true, owner };
    }
    if (q.front.status !== 'open' && q.front.status !== 'snoozed') throw new UsageError(q.front.id + ' is already ' + q.front.status);
    const chosen = resolvePick(q.front.id, pick, options);
    const at = stamp(opts);
    const was = snapFront(q.front);
    q.front.status = 'answered';
    q.front.answered = at;
    delete q.front.snooze;
    delete q.front.wokeBy;
    const line = answerLine(q.front.id, chosen, note, options);
    /* a placement question's press creates the task before the answer's row, which says so */
    const placed = placementAnswered(db, q, { pick: chosen, note, line }, { at, actor: who, pc: who && who.pc, now: clockNow(opts) });
    saveQ(db, q, line);
    const changes = { ...changesOf(was, q.front), ...(placed ? placed.changes : {}) };
    if (chosen) changes.chosen = [null, chosen];
    log(db, who, { at, verb: 'answer', front: q.front, changes, note });
    wakeLinked(db, q.front, 'answered', { at, by: byOf(who), pc: who && who.pc });
    noteGated(db, q.front, q.front.id + ' (' + q.front.name + ') was answered'
      + (chosen ? ': ' + answerToken(q.front.id, chosen) : '') + (note ? (chosen ? '. ' : ': ') + note : '.'), at, who, d);
    return { id: q.front.id, key: q.key, name: q.front.name, status: 'answered', owner, ...placedOf(placed) };
  });
}

/* what an answer's caller hears of a placement: the task it created, else the outcome */
const placedOf = (placed) => (placed ? { placement: { outcome: placed.outcome, ...(placed.created ? { created: placed.created } : {}), ...(placed.why ? { why: placed.why } : {}) } } : {});

export function drop(db, input = {}, actor, opts = {}) {
  const { id, note } = input;
  const who = actingAs(actor, input);
  return tx(db, () => {
    const d = today(opts);
    const q = loadQuestion(db, id, d);
    if (q.front.status !== 'open' && q.front.status !== 'snoozed') throw new UsageError(q.front.id + ' is already ' + q.front.status);
    const at = stamp(opts);
    const was = snapFront(q.front);
    q.front.status = 'dropped';
    q.front.answered = at;
    delete q.front.snooze;
    delete q.front.wokeBy;
    const placed = placementAnswered(db, q, { drop: true, note }, { at, actor: who, pc: who && who.pc, now: clockNow(opts) });
    saveQ(db, q, 'Dropped.' + (note ? ' ' + note : ''));
    log(db, who, { at, verb: 'drop', front: q.front, changes: { ...changesOf(was, q.front), ...(placed ? placed.changes : {}) }, note });
    wakeLinked(db, q.front, 'dropped', { at, by: byOf(who), pc: who && who.pc });
    noteGated(db, q.front, q.front.id + ' (' + q.front.name + ') was dropped' + (note ? ': ' + note : '.'), at, who, d);
    return { id: q.front.id, name: q.front.name, status: 'dropped', owner: ownerReport(db, q.front) };
  });
}

/* ---- snooze and wake (no timer: a due date wakes when read) ---- */

function wakeStatusFits(kind, statusText) {
  if (!WAKE_ENDINGS[kind]) throw new UsageError('--wake-on takes a question, task, track or workstream, not a ' + kind);
  if (statusText && !WAKE_ENDINGS[kind].includes(statusText)) {
    throw new UsageError('--wake-on names ' + statusText + ', which is not an ending of a ' + kind
      + '; the endings are ' + WAKE_ENDINGS[kind].join(' and '));
  }
}

function parseWakeOn(value) {
  if (typeof value !== 'string' || !value.trim()) throw new UsageError('--wake-on needs a record id');
  const raw = value.trim();
  const cut = raw.indexOf(':');
  const refText = cut < 0 ? raw : raw.slice(0, cut).trim();
  const statusText = cut < 0 ? '' : raw.slice(cut + 1).trim();
  if (cut >= 0 && !statusText) throw new UsageError('--wake-on names no status after the colon: ' + raw);
  if (isKey(refText)) return { wakeOn: refText, ...(statusText ? { wakeStatus: statusText } : {}) };
  const work = isQuestionToken(refText) ? null : parseWorkToken(refText);
  const kind = work ? work.kind : 'question';
  wakeStatusFits(kind, statusText);
  return { wakeOn: work ? work.id : 'Q' + idNum(refText), ...(statusText ? { wakeStatus: statusText } : {}) };
}

function endingOf(db, link, d) {
  const e = resolve(db, link.wakeOn, isQuestionToken(link.wakeOn) ? ['question'] : null, d);
  if (!e) throw new UsageError('--wake-on names ' + link.wakeOn + ', which no record holds');
  wakeStatusFits(e.kind, link.wakeStatus);
  const status = String(e.front.status || '');
  return { ending: WAKE_ENDINGS[e.kind].includes(status) ? status : '', ref: e.key, label: e.label };
}

/* --until, --trigger and --wake-on, read before the store is; null when none is given */
function wakeInput({ until, trigger, wakeOn }) {
  if (until === undefined && trigger === undefined && wakeOn === undefined) return null;
  if (until !== undefined && !DAY_RE.test(until)) throw new UsageError('--until must be YYYY-MM-DD');
  if (trigger !== undefined && !String(trigger).trim()) throw new UsageError('--trigger needs text');
  return { until, trigger, link: wakeOn === undefined ? null : parseWakeOn(wakeOn) };
}

/* the snooze a question stores, its link checked against the board */
function snoozeOf(db, q, w, d) {
  const link = w.link && { ...w.link };
  if (link) {
    const end = endingOf(db, link, d);
    if (end.ref === q.key) throw new UsageError('--wake-on names ' + q.front.id + ' itself; a question cannot wait on its own ending');
    if (end.ending) throw new UsageError(end.label + ' is already ' + end.ending + '; a wake trigger names an ending that has not happened yet');
    link.wakeOn = end.ref;
  }
  return { ...(w.until !== undefined ? { until: w.until } : {}), ...(w.trigger !== undefined ? { trigger: String(w.trigger).trim() } : {}), ...(link || {}) };
}

/* snooze(db, { id, until, trigger, wakeOn }, actor): the three conditions combine. */
export function snooze(db, input = {}, actor, opts = {}) {
  const w = wakeInput(input);
  if (!w) throw new UsageError('snooze needs at least one of --until, --trigger or --wake-on');
  const who = actor || (input.user ? { user: input.user } : {});
  return tx(db, () => {
    const d = today(opts);
    const q = loadQuestion(db, input.id, d);
    if (q.front.status !== 'open' && q.front.status !== 'snoozed') throw new UsageError(q.front.id + ' is ' + q.front.status + '; only open questions snooze');
    const snoozed = snoozeOf(db, q, w, d);
    const was = snapFront(q.front);
    q.front.status = 'snoozed';
    q.front.snooze = snoozed;
    delete q.front.wokeBy;
    saveQ(db, q);
    log(db, who, { at: stamp(opts), verb: 'snooze', front: q.front, changes: changesOf(was, q.front) });
    return { id: q.front.id, status: 'snoozed', snooze: shownFront(db, q.front).snooze, owner: ownerReport(db, q.front) };
  });
}

export function wake(db, input = {}, actor, opts = {}) {
  return tx(db, () => {
    const q = loadQuestion(db, input.id, today(opts));
    if (q.front.status !== 'snoozed') throw new UsageError(q.front.id + ' is ' + q.front.status + ', not snoozed');
    const was = snapFront(q.front);
    q.front.status = 'open';
    delete q.front.snooze;
    delete q.front.wokeBy;
    saveQ(db, q);
    log(db, actor, { at: stamp(opts), verb: 'wake', front: q.front, changes: changesOf(was, q.front) });
    return { id: q.front.id, status: 'open' };
  });
}

/* A dropped question back to open, or to snoozed with the wake conditions given (the doctor's undo of a drop) */
export function reopenQuestion(db, input = {}, actor, opts = {}) {
  const w = wakeInput(input);
  return tx(db, () => {
    const d = today(opts);
    const q = loadQuestion(db, input.id, d);
    if (q.front.status !== 'dropped') throw new UsageError(q.front.id + ' is ' + q.front.status + ', not dropped; only a dropped question reopens');
    const snoozed = w ? snoozeOf(db, q, w, d) : null;
    const stands = dropStands(db, q);
    const was = snapFront(q.front);
    q.front.status = snoozed ? 'snoozed' : 'open';
    if (snoozed) q.front.snooze = snoozed;
    delete q.front.answered;
    if (isPlacement(q.front) && q.front.placement.outcome) {
      const { outcome, ...rest } = q.front.placement;
      q.front.placement = rest;
    }
    saveQ(db, q);
    putNotes(db, q.key, []);
    log(db, actor, { at: stamp(opts), verb: 'reopen', front: q.front, changes: changesOf(was, q.front) });
    return { id: q.front.id, status: q.front.status, ...(snoozed ? { snooze: shownFront(db, q.front).snooze } : {}), ...(stands ? { stands } : {}) };
  });
}

/* What the drop's own transaction did to other records, which a reopen leaves standing:
   the questions it woke, the lines it unparked, the tasks it gated that got its note. */
function dropStands(db, q) {
  const drop = db.stmt("SELECT seq, at FROM activity WHERE record = ? AND verb = 'drop' ORDER BY seq DESC LIMIT 1").get(q.key);
  if (!drop) return null;
  const cause = q.front.id + ' dropped';
  const rows = db.stmt("SELECT label, kind, verb, json_extract(line, '$.note') AS note FROM activity WHERE seq > ? AND at = ? ORDER BY seq").all(drop.seq, drop.at);
  const pick = (hit) => [...new Set(rows.filter(hit).map((r) => r.label))];
  const out = {
    woken: pick((r) => r.verb === 'wake' && r.note === 'woken by ' + cause),
    unparked: pick((r) => r.kind === 'track' && r.note === 'unparked: ' + cause),
    noted: pick((r) => r.verb === 'note' && r.kind === 'task' && String(r.note).startsWith(q.front.id + ' (') && String(r.note).includes(') was dropped')),
  };
  return Object.values(out).some((l) => l.length) ? out : null;
}

/* Every read wakes the date snoozes now due, one row each at one instant, by the
   reader: computed when read, so no timer runs. */
export function wakeDue(db, actor, opts = {}) {
  const d = today(opts);
  const due = () => db.stmt(`SELECT key FROM records WHERE kind = 'question' AND status = 'snoozed'
    AND json_type(fields, '$.snooze.until') = 'text' AND json_extract(fields, '$.snooze.until') <= ? ORDER BY id`).all(d);
  if (!due().length) return [];
  return tx(db, () => {
    const at = stamp(opts);
    const woke = [];
    for (const r of due()) {
      const rec = readRec(db, r.key);
      const was = snapFront(rec.fields);
      rec.fields.status = 'open';
      delete rec.fields.snooze;
      delete rec.fields.wokeBy;
      saveQ(db, rec);
      log(db, actor, { at, verb: 'wake', front: rec.fields, changes: changesOf(was, rec.fields), note: 'its snooze date came' });
      woke.push(rec.fields.id);
    }
    return woke;
  });
}

/* ---- reads ---- */

/* surface(db, { id, session }): asked goes up; the session's subscription is the activity row itself. */
export function surface(db, input = {}, actor, opts = {}) {
  const session = typeof input.session === 'string' ? input.session.trim() : '';
  if (!session) throw new UsageError('surface needs --session');
  wakeDue(db, actor, opts);
  return tx(db, () => {
    const q = loadQuestion(db, input.id, today(opts));
    const was = snapFront(q.front);
    q.front.asked = (typeof q.front.asked === 'number' ? q.front.asked : 0) + 1;
    /* a count, not an edit: the version stays, so a pick the user makes from a card read before it still lands */
    db.stmt('UPDATE records SET fields = ? WHERE key = ?').run(JSON.stringify(ordered(q.front)), q.key);
    log(db, { ...(actor || {}), user: undefined, session }, { at: stamp(opts), verb: 'surface', front: q.front, changes: changesOf(was, q.front) });
    return payloadOf(db, q);
  });
}

/* subscribe(db, { id, session }): the session hears the question's answer; as with
   surface, the activity row is the subscription and the record does not change. */
export function subscribe(db, input = {}, actor, opts = {}) {
  const session = typeof input.session === 'string' ? input.session.trim() : '';
  if (!session) throw new UsageError('subscribe needs --session <own-id>');
  return tx(db, () => {
    const q = loadQuestion(db, input.id, today(opts));
    const out = { id: q.front.id, kind: 'question', name: q.front.name, session };
    if (subscribersOf(db, q.front).includes(session)) return { ...out, added: false };
    log(db, { ...(actor || {}), user: undefined, session }, { at: stamp(opts), verb: 'subscribe', front: q.front, changes: {} });
    return { ...out, added: true };
  });
}

export function show(db, input = {}, actor, opts = {}) {
  wakeDue(db, actor, opts);
  const q = loadQuestion(db, typeof input === 'string' ? input : input.id, today(opts));
  /* a session's read, logged outside the activity feed */
  const reader = (input && typeof input === 'object' && typeof input.session === 'string' && input.session.trim()) || (actor && actor.session);
  if (reader) noteRead(db, q, reader, 'show', stamp(opts));
  return payloadOf(db, q);
}

/* show's payload with no wake, for a reader that just woke the set (the working set) */
export const shownByKey = (db, key, opts = {}) => payloadOf(db, loadQuestion(db, key, today(opts)));

/* Blockers first, then oldest; the label breaks a tie (labels are reused). */
const ageOf = (x) => { const ms = Date.parse(x.created); return Number.isFinite(ms) ? ms : 0; };
const blockersThenOldest = (a, b) => (a.blocking ? 0 : 1) - (b.blocking ? 0 : 1) || ageOf(a) - ageOf(b) || idNum(a.id) - idNum(b.id);

/* list(db, { project, projectRepo, workstream, track, session, blocking, snoozed, all }). */
export function list(db, filters = {}, actor, opts = {}) {
  wakeDue(db, actor, opts);
  const d = today(opts);
  const scope = scopeOf(filters.project, filters.projectRepo);
  let wantWs = refTokenOf(filters.workstream, '--workstream', 'WS');
  let wantTrack = refTokenOf(filters.track, '--track', TRACK_IDS);
  if (wantWs !== undefined) wantWs = filterRef(db, wantWs, d);
  if (wantTrack !== undefined) wantTrack = filterRef(db, wantTrack, d);
  const rows = filters.all
    ? db.stmt("SELECT key, kind, slug, fields, body, layout, track, version FROM records WHERE kind = 'question' ORDER BY id").all()
    : db.stmt("SELECT key, kind, slug, fields, body, layout, track, version FROM records WHERE kind = 'question' AND status = ? ORDER BY id")
      .all(filters.snoozed ? 'snoozed' : 'open');
  const out = [];
  for (const r of rows) {
    const raw = JSON.parse(r.fields);
    if (wantWs !== undefined && raw.workstream !== wantWs) continue;
    if (wantTrack !== undefined && raw.track !== wantTrack) continue;
    if (!inProject(scope, raw.projectDir, raw.projectRepo)) continue;
    if (filters.blocking && raw.blocking !== true) continue;
    if (filters.session && !subscribersOf(db, raw).includes(filters.session)) continue;
    const e = withSections(db, { ...r, fields: raw });
    const f = shownFront(db, raw);
    out.push({
      id: f.id, key: f.key, name: f.name, project: f.project, projectDir: f.projectDir,
      ...(f.projectRepo ? { projectRepo: f.projectRepo } : {}),
      status: f.status, blocking: f.blocking === true, topic: f.topic,
      created: f.created, asked: f.asked, snooze: f.snooze, gist: e.gist,
      ...(f.ask ? { ask: f.ask } : {}),
      ...(f.crux ? { crux: f.crux } : {}),
      options: parseOptions(e.sections['Options']),
      ...(f.workstream ? { workstream: f.workstream } : {}),
      ...(f.track ? { track: f.track } : {}),
      ...(f.pc ? { pc: f.pc } : {}),
      ...(listOf(f, 'gates').length ? { gates: listOf(f, 'gates') } : {}),
      ...(listOf(f, 'labels').length ? { labels: listOf(f, 'labels') } : {}),
      ...(listOf(f, 'refs').length ? { refs: listOf(f, 'refs') } : {}),
      ...reversalFields(f, e.sections),
      version: r.version,
      ...(f.reworded ? { reworded: f.reworded } : {}),
    });
  }
  return out.sort(blockersThenOldest);
}

/* A track key as shown: its label and its name, one read per track with `memo`. */
function trackOf(db, key, memo) {
  if (memo && memo.has(key)) return memo.get(key);
  const r = isKey(key) ? db.stmt('SELECT label, title FROM records WHERE key = ?').get(key) : null;
  const out = { track: (r && r.label) || key, ...(r && r.title ? { trackName: r.title } : {}) };
  if (memo) memo.set(key, out);
  return out;
}

/* A row's track (label and name) and asking PC, each only when set (the band, the mark's hover, the Questions tab). */
const whereFrom = (db, f, memo) => ({ ...(f.track ? trackOf(db, f.track, memo) : {}), ...(f.pc ? { pc: f.pc } : {}) });

/* whose an answer reaches, for the presser's toast: the track's lease holder on
   its PC, else the asker on the PC it asked from. */
function ownerReport(db, front) {
  const lease = front.track ? db.stmt('SELECT session, pc FROM leases WHERE track = ?').get(front.track) : null;
  const pc = lease ? lease.pc : front.pc;
  return { session: lease ? lease.session : front.session, ...(front.track ? trackOf(db, front.track) : {}), ...(pc ? { pc } : {}) };
}

/* The open set for an advisory reader: no wake, no write. */
export function peekOpenQuestions(db, { project, projectRepo } = {}) {
  const scope = scopeOf(project, projectRepo);
  const out = [];
  const memo = new Map();
  for (const r of db.stmt("SELECT fields FROM records WHERE kind = 'question' AND status = 'open'").all()) {
    const f = JSON.parse(r.fields);
    if (!inProject(scope, f.projectDir, f.projectRepo)) continue;
    out.push({ id: f.id, name: f.name, blocking: f.blocking === true, projectDir: f.projectDir, session: f.session, ...whereFrom(db, f, memo), created: f.created });
  }
  return out.sort(blockersThenOldest).map(({ created, ...x }) => x);
}

/* a session's own open questions (asked or surfaced), plus the blockers of
   what it engaged: its questions' workstreams and tracks, its subscribed or
   in-hand work, the track it holds. No write. */
export function peekSessionScope(db, { project, projectRepo, session } = {}, opts = {}) {
  if (!session) return [];
  const scope = scopeOf(project, projectRepo);
  const d = today(opts);
  const track = heldTrack(db, session);
  /* a question on the held track is the session's whichever repo asked it; the rest keep to the project */
  const open = db.stmt("SELECT fields FROM records WHERE kind = 'question' AND status = 'open'").all()
    .map((r) => JSON.parse(r.fields)).filter((f) => inProject(scope, f.projectDir, f.projectRepo) || (!!track && f.track === track.key));
  if (!open.length) return [];
  const surfaced = new Set(db.stmt("SELECT DISTINCT record FROM activity WHERE verb IN ('surface', 'subscribe') AND actor = ? AND kind = 'question'")
    .all('session:' + session).map((r) => r.record));
  const holders = new Map();
  const mine = (f) => ownerOf(db, f, holders) === session || listOf(f, 'subscribers').includes(session) || surfaced.has(f.key);
  const near = new Set();
  const take = (sc) => { if (sc.workstream) near.add(sc.workstream); if (sc.track) near.add(sc.track); };
  let engaged = false;
  /* every question it asked, surfaced or (imported) subscribed to, whatever its status */
  const scoped = `SELECT json_extract(fields, '$.workstream') AS workstream, json_extract(fields, '$.track') AS track FROM records WHERE kind = 'question'`;
  for (const r of db.stmt(scoped + " AND (json_extract(fields, '$.session') = ? OR EXISTS (SELECT 1 FROM json_each(fields, '$.subscribers') WHERE value = ?))")
    .all(session, session).concat(db.stmt(scoped + ' AND key IN (SELECT value FROM json_each(?))').all(JSON.stringify([...surfaced])))) {
    engaged = true;
    take(r);
  }
  for (const e of rowsOf(db, `SELECT key, kind, fields FROM records WHERE kind IN ('workstream', 'task')
    AND (EXISTS (SELECT 1 FROM json_each(fields, '$.subscribers') WHERE value = ?)
      OR (kind = 'task' AND ${openRunSql('key', { session: true, worker: 'session' })}))`, session, session)) {
    engaged = true;
    take(scopeOfRecord(db, e.key, d));
  }
  if (track) { engaged = true; take({ workstream: track.front.workstream, track: track.key }); }
  const inScope = (f) => engaged && f.blocking === true && (!near.size
    || (f.workstream && near.has(f.workstream)) || (f.track && near.has(f.track)) || (!f.workstream && !f.track));
  const out = [];
  const memo = new Map();
  for (const f of open) {
    const own = mine(f);
    if (!own && !inScope(f)) continue;
    out.push({ id: f.id, name: f.name, blocking: f.blocking === true, projectDir: f.projectDir, session: f.session, ...whereFrom(db, f, memo), own, created: f.created });
  }
  return out.sort(blockersThenOldest).map(({ created, ...x }) => x);
}

/* the reply's names line for the open set, or '' when nothing is open.
   With a session it names only the questions that session owns, never counting the rest;
   '' when it owns none open. `urls` ({ record(key), open(projectName) }) is the API's. */
export function namesLine(db, input = {}, actor, opts = {}) {
  const { project, projectRepo, session, blocking } = input;
  /* over the wire `urls` is { base }, the board's web address */
  const base = input.urls && typeof input.urls.base === 'string' ? input.urls.base.replace(/\/+$/, '') : '';
  const urls = base ? { record: (k) => base + WEB.record(k), open: (p) => base + WEB.needsYou(p) } : input.urls;
  /* a session's own set holds its held track's questions from other repos, so its list is not cut by project */
  let open = list(db, session ? { blocking } : { project, projectRepo, blocking }, actor, opts);
  if (session) {
    const keep = new Set(peekSessionScope(db, { project, projectRepo, session }, opts).filter((q) => q.own).map((q) => q.id));
    open = open.filter((e) => keep.has(e.id));
  }
  if (!open.length) return '';
  /* the set link names the project by its shared name, as the needs-you page filters */
  const named = new Set(open.map((e) => nameOf(e.projectRepo, e.projectDir)));
  const setUrl = urls && urls.open ? urls.open(named.size === 1 ? [...named][0] : null) : '';
  const link = (text, url) => (url ? '[' + text + '](' + url + ')' : text);
  const n = open.length;
  const label = (e) => (e.id + ' ' + String(e.name || '')).replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
  const names = open.slice(0, 3).map((e) => link(label(e), urls && urls.record ? urls.record(e.key) : ''));
  return '\u2753 **' + link(n + ' open question' + (n === 1 ? '' : 's'), setUrl) + '**: '
    + names.join(' \u00b7 ') + (n > 3 ? ' and ' + link((n - 3) + ' more', setUrl) : '');
}

/* ---- the question's own edit ---- */

/* A question edit may move its workstream and plan (its track now);
   the refusals below are the scope: labels and refs come at register only. */
function refuseQuestionFlag(c) {
  if (c.status !== undefined) throw new UsageError('a question changes state through answer, drop, snooze and wake, not --status');
  if (c.name !== undefined) throw new UsageError('a question is renamed by rewording it (a reworded payload on stdin), not --name');
  if (c.priority !== undefined) throw new UsageError('a question carries no priority');
  if (c.ordinal !== undefined) throw new UsageError('a question carries no ordinal');
  for (const [key, add, remove] of [['labels', c.addLabel, c.removeLabel], ['refs', c.addRef, c.removeRef]]) {
    if (add?.length || remove?.length) throw new UsageError("a question's " + key + ' are set when it registers; question edit does not change them');
  }
  if (c.addProject?.length || c.removeProject?.length) throw new UsageError('a question carries no projects');
}

/* What a rewording may change on the front; the body is re-rendered whole. */
const WORDING = ['name', 'ask', 'topic', 'blocking', 'pick', 'crux', 'revisits', 'cites', 'mission', 'evidence'];
const SECTION_PARTS = [['options', 'Options'], ['stakes', 'Stakes'], ['whileThisWaits', 'While this waits'], ['context', 'Context'], ['reversal', 'Reversal']];
const blankOf = (v) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? null : v);
const sameJson = (a, b) => JSON.stringify(blankOf(a)) === JSON.stringify(blankOf(b));

/* a press on a card drawn before the rewording names options the question may no longer have. */
const beforeReword = (q, version) => version !== undefined && version !== null && !!q.front.reworded
  && Number(version) < Number(q.front.reworded.version);

/* The payload's scope a rewording does not apply: the question keeps its own. */
function scopeKept(db, p, front, d) {
  const keyOf = (t) => filterRef(db, t, d);
  const gates = listOf(front, 'gates');
  return [
    p.workstream && keyOf(p.workstream) !== (front.workstream || '') ? 'workstream' : '',
    p.track && keyOf(p.track) !== (front.track || '') ? 'track' : '',
    p.gates.length && (p.gates.length !== gates.length || p.gates.some((g) => !gates.includes(keyOf(g)))) ? 'gates' : '',
  ].filter(Boolean);
}

/* a whole ask payload rewords an open question in place, checked as a
   strict registration; the id, key, session, project, gates and track stay. */
function reword(db, q, raw, at, d, warnings) {
  if (!['open', 'snoozed'].includes(q.front.status)) {
    throw new UsageError(q.front.id + ' is ' + q.front.status + '; only an open or snoozed question is reworded, so ask a new one');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError('the reworded payload must be a JSON object');
  const f = q.front;
  let p;
  try {
    p = validatePayload({ ...raw, session: f.session || raw.session, projectRepo: f.projectRepo || raw.projectRepo, projectDir: f.projectDir || raw.projectDir }, true);
  } catch (e) {
    throw e instanceof UsageError ? new UsageError(e.message.replace(/^register payload/, 'the reworded payload')) : e;
  }
  const { rulings } = rulingChecks(db, p, true, d);
  if (rulings.length && !p.blocking) warnings.push(f.id + ' reverses a ruling, so it is stored blocking');
  if (rulings.length) p.blocking = true;
  /* a ruling's quote is frozen at registration: the same rulings keep it */
  p.reverses = sameJson(p.revisits, listOf(f, 'revisits')) ? (q.sections['Reverses'] || '') : rulings.map(reversesBlock).join('\n\n');
  p.ask = askWithTokens(f.id, p.ask, p.options);
  const next = { ...f, name: p.name, ask: p.ask, blocking: p.blocking, crux: p.crux, revisits: p.revisits, cites: p.cites, evidence: p.evidence };
  if (p.pick) next.pick = p.pick; else delete next.pick;
  if (p.topic !== undefined) next.topic = p.topic;
  if (p.mission !== undefined) next.mission = p.mission;
  const body = renderBody(next, p);
  const now = questionSections(body, '');
  const parts = WORDING.filter((k) => !sameJson(f[k], next[k]));
  if (q.gist !== now.gist) parts.push('gist');
  for (const [part, heading] of SECTION_PARTS) if ((q.sections[heading] || '') !== (now.sections[heading] || '')) parts.push(part);
  const pw = pickWarning(f.id, p);
  if (pw) warnings.push(pw);
  warnings.push(...headlineWarnings(f.id, p));
  if (!parts.length) return { parts, p };
  /* saveQ moves the version once, so this is the reworded record's own version */
  next.reworded = { at, version: q.version + 1 };
  q.front = next;
  q.body = body;
  return { parts, p };
}

const isLook = (db) => (k) => Boolean(db.stmt("SELECT 1 FROM records WHERE key = ? AND EXISTS (SELECT 1 FROM json_each(fields, '$.labels') WHERE value = 'look')").get(k));

/* editQuestion(db, { id, payload, workstream, track, clearWorkstream, clearTrack, pick, clearPick, addGate, removeGate, version }, actor):
   today's `question edit`, and with `payload` a rewording; a stale version is refused plainly. */
export function editQuestion(db, input = {}, actor, opts = {}) {
  const c = { ...input };
  refuseQuestionFlag(c);
  const rewording = c.payload !== undefined && c.payload !== null;
  if (rewording && (c.pick !== undefined || c.clearPick)) throw new UsageError('the reworded payload carries the pick; leave out --pick and --clear-pick');
  if (c.clearWorkstream && c.workstream !== undefined) throw new UsageError('pick one of --workstream and --clear-workstream');
  if (c.clearTrack && c.track !== undefined) throw new UsageError('pick one of --track and --clear-track');
  c.workstream = refTokenOf(c.workstream, 'workstream', 'WS');
  c.track = refTokenOf(c.track, 'track', TRACK_IDS);
  if (c.pick !== undefined && c.clearPick) throw new UsageError('pick one of --pick and --clear-pick');
  if (c.pick !== undefined && (typeof c.pick !== 'string' || !c.pick.trim())) throw new UsageError('--pick needs an option letter');
  const addGate = gateList(c.addGate, '--add-gate');
  const removeGate = gateList(c.removeGate, '--remove-gate');
  if (!rewording && c.workstream === undefined && c.track === undefined && !c.clearWorkstream && !c.clearTrack
    && c.pick === undefined && !c.clearPick && !addGate.length && !removeGate.length) {
    throw new UsageError('question edit needs at least one field flag, or a reworded payload as JSON on stdin');
  }
  const who = actingAs(actor, input);
  return tx(db, () => {
    const d = today(opts);
    const at = stamp(opts);
    if (c.workstream) c.workstream = refFor(db, c.workstream, 'workstream', d);
    if (c.track) c.track = refFor(db, c.track, 'track', d);
    const addRefs = addGate.map((g) => refFor(db, g, 'task', d));
    const removeRefs = removeGate.map((g) => filterRef(db, g, d));
    const q = loadQuestion(db, c.id, d);
    if (movedSince(q, c.version)) throw new UsageError(q.front.id + ' moved since version ' + c.version + ' (now ' + q.version + '); read it again');
    /* the board words a placement question and its track stops the finish, so no edit changes either */
    if (isPlacement(q.front)) throw new UsageError(q.front.id + ' is a placement question the board asked; it changes only by its answer or drop');
    const before = snapFront(q.front);
    const warnings = [];
    const worded = rewording ? reword(db, q, c.payload, at, d, warnings) : { parts: [] };
    const changed = [];
    const setScalar = (key, value) => { if (String(q.front[key] ?? '') !== String(value)) { q.front[key] = value; changed.push(key); } };
    const clearScalar = (key) => { if (q.front[key] !== undefined && q.front[key] !== '') { delete q.front[key]; changed.push(key); } };
    if (c.clearWorkstream) clearScalar('workstream'); else if (c.workstream !== undefined) setScalar('workstream', c.workstream);
    if (c.clearTrack) clearScalar('track'); else if (c.track !== undefined) setScalar('track', c.track);
    if (c.pick !== undefined || c.clearPick) {
      if (!['open', 'snoozed'].includes(q.front.status)) throw new UsageError(q.front.id + ' is ' + q.front.status + '; a pick is set on an open or snoozed question');
      let next;
      if (c.pick !== undefined) {
        const typed = parseOptions(q.sections['Options']).filter((o) => String(o.type || '').trim());
        const hit = typed.find((o) => matchesToken(q.front.id, o.type.trim(), c.pick.trim()));
        if (!hit) {
          throw new UsageError('pick "' + c.pick + '" names no option of ' + q.front.id
            + (typed.length ? '; the options are ' + typed.map((o) => o.type.trim()).join(', ') : '; it has no typed options'));
        }
        next = hit.type.trim();
      }
      if ((q.front.pick ?? '') !== (next ?? '')) {
        if (next === undefined) delete q.front.pick; else q.front.pick = next;
        changed.push('pick');
      }
    }
    let gained = [];
    if (addRefs.length || removeRefs.length) {
      const cur = listOf(q.front, 'gates');
      gained = addRefs.filter((g) => !cur.includes(g) && !removeRefs.includes(g));
      const next = cur.concat(addRefs.filter((g) => !cur.includes(g))).filter((g) => !removeRefs.includes(g));
      if (next.length !== cur.length || next.some((g, i) => g !== cur[i])) { q.front.gates = next; changed.push('gates'); }
    }
    if (rewording) {
      const kept = scopeKept(db, worded.p, q.front, d);
      if (kept.length) {
        warnings.push(q.front.id + ' keeps its ' + kept.join(' and ') + ': a rewording changes the wording only;'
          + ' move them with question edit ' + q.front.id + ' --workstream, --track, --add-gate or --remove-gate');
      }
    }
    /* a rewording answers as register does, so the mod's card reads the numbered ask */
    const said = rewording ? { key: q.key, ask: q.front.ask, ...(worded.p.revisits.length ? { reverses: parseReverses(worded.p.reverses) } : {}) } : {};
    const out = { id: q.front.id, kind: 'question', name: q.front.name, changed, ...(rewording ? { reworded: worded.parts, ...said } : {}) };
    if (warnings.length) out.warnings = warnings;
    if (!changed.length && !worded.parts.length) return { ...out, version: q.version };
    q.front.updated = at;
    saveQ(db, q);
    const note = worded.parts.length ? 'reworded: ' + worded.parts.join(', ') : undefined;
    log(db, who, { at, verb: 'edit', front: q.front, changes: changesOf(before, q.front), note });
    /* a gate added after registration ends the asker's run on a look task as register does */
    const looks = q.front.session && ['open', 'snoozed'].includes(q.front.status) ? gained.filter(isLook(db)) : [];
    if (looks.length) endSessionRuns(db, { session: q.front.session, tasks: looks, note: 'the look asked the user ' + q.front.id + ', which gates it' }, { ...(typeof who === 'object' ? who : { by: who }), now: clockNow(opts) });
    return { ...out, version: q.version + 1 };
  });
}

