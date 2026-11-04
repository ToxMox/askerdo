/* the user's override of a record in use that an amend cannot carry (a bug's
   text, a ruling never made, a secret). A session asks once; the user's Allow applies
   it with no model turn, and Keep leaves the record as written. */
import { createHash, scryptSync } from 'node:crypto';
import { readTx, tx } from '../db.mjs';
import { actorOf, addNote, guardHeadings, labelOf, logRow, logVerb, putRecord, sessionWords, stampNow } from '../records.mjs';
import { WEB } from '../paths.mjs';
import { UsageError, loadEntry, resolveRecord } from './labels.mjs';
import { WORK_KINDS, normalize, orderFront, sectionsOf, startedBy, withSection } from './work.mjs';
import { addHistory, historyRef, usedBy } from './history.mjs';
import { closeOf, closeText, inScope } from './upkeep.mjs';

export const OVERRIDE_KINDS = Object.freeze(['fix', 'withdraw', 'scrub']);
const SUMMARY_MAX = 200;
export const SEAL_DAYS = 7;
/* an undecided request stops holding its records after this, judged when read (no timers) */
export const EXPIRE_DAYS = 30;
export const REMOVED = '[removed]';
const SECRET_MIN = 4;
const DAY = 86400000;
const FIX_FIELDS = { task: ['name', 'description', 'intent', 'close'], knowledge: ['name', 'body'] };
const SECTION = { description: 'Description', intent: 'Intent', body: 'Body' };
/* a decision's quoted words (the user's ruling) are fixable too; a gotcha has none */
const fixFields = (e) => (e.kind === 'knowledge' && e.front.type === 'decision' ? [...FIX_FIELDS.knowledge, 'words'] : FIX_FIELDS[e.kind]);
/* a fixable field as the record holds it now: the front's name, close and words, else its section */
const fieldNow = (e, secs, f) => (f === 'name' || f === 'words' ? e.front[f] ?? '' : f === 'close' ? e.front.close ?? null : secs[SECTION[f]] ?? '');

/* What a scrub cannot reach, told to the user so a secret gets rotated. */
export const UNREACHED = Object.freeze([
  'the nightly backups and weekly exports made before the scrub',
  "other records' own text that quotes it (scrub each of them too)",
  "each PC's local caches and inbox files",
  'the transcripts of the sessions that saw it',
]);

const hashOf = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
/* a scrub's proposal is the secret: a slow hash keyed by the record, so a Keep note never walks back to it */
const proposalOf = (kind, p, key) => (kind === 'scrub'
  ? scryptSync(String(p.text), 'askerdo-scrub:' + key, 8, { N: 16384 }).toString('hex') : hashOf({ kind, p }));
/* the user's act */
const isUserAct = (by) => /^user(:|$)/.test(String(by || ''));
const isRuling = (e) => e.kind === 'knowledge' && e.front.type === 'decision';
const textOf = (s) => String(s ?? '').replace(/\r\n/g, '\n').trim();
const flatOf = (s) => String(s).replace(/\s+/g, ' ').trim();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const escOf = (s) => JSON.stringify(s).slice(1, -1);
/* a refusal a script can sort by: data rides the API's error */
const refuse = (msg, data) => Object.assign(new UsageError(msg), { data });

/* The scrub's cutter: the text as written and as excerpt() flattens it into a line, and
   a line's note cut at 200 characters that ends on the text half written. */
function cutterOf(text) {
  const flat = flatOf(text);
  const forms = [...new Set([text, flat])].filter((t) => t.trim().length >= SECRET_MIN);
  const whole = (s) => forms.reduce((x, t) => x.split(t).join(REMOVED), String(s));
  const tail = (s) => {
    if (!s.endsWith('...')) return s;
    const head = s.slice(0, -3);
    for (let n = Math.min(flat.length - 1, head.length); n >= SECRET_MIN; n--) {
      if (head.endsWith(flat.slice(0, n))) return head.slice(0, -n) + REMOVED + '...';
    }
    return s;
  };
  return { whole, line: (s) => tail(whole(s)), forms, flat };
}

function deepCut(v, f, skip) {
  if (typeof v === 'string') return f(v);
  if (Array.isArray(v)) return v.map((x) => deepCut(x, f));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, skip && skip.includes(k) ? x : deepCut(x, f)]));
  return v;
}

/* A record, or a handoff with its own texts (a handoff's state is the likeliest place for a secret). */
function entryOf(db, key) {
  const e = loadEntry(db, key);
  if (e) return e;
  const h = db.stmt('SELECT key, fields, state, where_we_were, verify, track FROM handoffs WHERE key = ?').get(key);
  if (!h) return null;
  const front = JSON.parse(h.fields);
  return { key: h.key, kind: 'handoff', front, label: String(front.id ?? ''), track: h.track, body: '', handoff: { state: h.state, where: h.where_we_were, verify: h.verify } };
}

class DryRun {
  constructor(out) { this.out = out; }
}

/* ---- the text a request touches, hashed at the ask (never the row version, which every note bumps) ---- */

function touched(e, kind, p) {
  const secs = sectionsOf(e.body);
  if (kind === 'scrub') return e.handoff ? { fields: e.front, ...e.handoff } : { name: e.front.name ?? '', body: e.body };
  if (kind === 'withdraw') return { name: e.front.name ?? '', body: secs.Body ?? '', status: e.front.status };
  const out = {};
  for (const f of Object.keys(p)) out[f] = fieldNow(e, secs, f);
  return out;
}

/* The record's own text cut, or null where it does not hold the text. */
function recordCut(e, c) {
  const fields = deepCut(e.front, c.whole, ['id', 'key']);
  if (e.handoff) {
    const h = e.handoff;
    const now = { state: c.whole(h.state), where: h.where === null ? null : c.whole(h.where), verify: JSON.stringify(deepCut(JSON.parse(h.verify), c.whole)) };
    const changed = !same(fields, e.front) || now.state !== h.state || now.where !== h.where || !same(JSON.parse(now.verify), JSON.parse(h.verify));
    return changed ? { was: { fields: e.front, ...h }, now: { fields, ...now } } : null;
  }
  const body = c.whole(e.body);
  return !same(fields, e.front) || body !== e.body ? { was: { fields: e.front, body: e.body }, now: { fields, body } } : null;
}

/* Every live copy of a scrub's text, cut but not written: the record, then the journal notes,
   history rows and activity lines of the board (another record's note may quote it). */
function hitsOf(db, e, text) {
  const c = cutterOf(text);
  const out = { record: recordCut(e, c), notes: [], history: [], activity: [] };
  const seen = { notes: new Set(), history: new Set(), activity: new Set() };
  for (const t of c.forms) {
    for (const n of db.stmt('SELECT id, record, body FROM notes WHERE instr(body, ?) > 0').all(t)) {
      if (seen.notes.has(n.id)) continue;
      seen.notes.add(n.id);
      out.notes.push({ id: n.id, record: n.record, was: n.body, now: c.whole(n.body) });
    }
    for (const h of db.stmt('SELECT id, record, old, new FROM history WHERE instr(old, ?) > 0 OR instr(new, ?) > 0').all(t, t)) {
      if (seen.history.has(h.id)) continue;
      seen.history.add(h.id);
      out.history.push({ id: h.id, record: h.record, was: { old: h.old, new: h.new }, now: { old: h.old === null ? null : c.whole(h.old), new: h.new === null ? null : c.whole(h.new) } });
    }
  }
  /* a line holds the text whole, or ends a cut note on its first characters */
  const lines = [...c.forms.map(escOf).map((s) => db.stmt('SELECT seq, record, line FROM activity WHERE instr(line, ?) > 0').all(s)),
    db.stmt("SELECT seq, record, line FROM activity WHERE instr(line, ?) > 0 AND instr(line, '...') > 0").all(escOf(c.flat.slice(0, SECRET_MIN)))].flat();
  for (const a of lines) {
    if (seen.activity.has(a.seq)) continue;
    seen.activity.add(a.seq);
    const was = JSON.parse(a.line);
    const now = deepCut(was, c.line, ['ts', 'key', 'by']);
    if (!same(now, was)) out.activity.push({ seq: a.seq, record: a.record, was: a.line, now: JSON.stringify(now) });
  }
  return out;
}

/* Where a scrub's text sits, counted by place; another record's copies count as elsewhere. */
function countOf(h, key) {
  const own = (rows) => rows.filter((r) => r.record === key).length;
  const all = h.notes.length + h.history.length + h.activity.length;
  const out = { record: h.record ? 1 : 0, journal: own(h.notes), history: own(h.history), activity: own(h.activity) };
  out.elsewhere = all - out.journal - out.history - out.activity;
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n));
}

const placesOf = (db, e, text) => countOf(hitsOf(db, e, text), e.key);

function itemOf(db, kind, raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError('each item is { record, ... }');
  const id = String(raw.record ?? raw.id ?? '').trim();
  if (!id) throw new UsageError('each item names its record');
  const found = resolveRecord(db, id, { day: ctx.day });
  if (!found || found.kind === 'profile' || (found.kind === 'handoff' && kind !== 'scrub')) {
    throw new UsageError(found && found.kind === 'handoff' ? 'a handoff takes a scrub only: ' + id : 'unknown record id: ' + id);
  }
  const e = found.kind === 'handoff' ? entryOf(db, found.key) : found;
  const label = e.label || e.key;
  const extra = (allowed) => {
    const bad = Object.keys(raw).filter((k) => !['record', 'id', ...allowed].includes(k) && raw[k] !== undefined);
    if (bad.length) throw new UsageError('a ' + kind + ' of ' + label + ' takes no ' + bad.join(', '));
  };
  const p = {};
  if (kind === 'fix') {
    const allowed = fixFields(e);
    if (!allowed) throw new UsageError("a fix rewrites a task's or a knowledge record's text; " + label + ' is a ' + e.kind);
    extra(allowed);
    if (e.kind === 'knowledge' && e.front.status !== 'active') throw new UsageError(label + ' is ' + e.front.status + ': nothing to fix');
    for (const f of allowed) {
      if (raw[f] === undefined || raw[f] === null) continue;
      if (f === 'close') { p.close = closeOf(db, raw.close, e.key, ctx.day); continue; }
      if (typeof raw[f] !== 'string' || !textOf(raw[f])) throw new UsageError(label + ' ' + f + ' needs text');
      p[f] = f === 'name' ? textOf(raw[f]).replace(/\s*\n\s*/g, ' ') : f === 'words' ? flatOf(raw[f]) : guardHeadings(textOf(raw[f]));
    }
    const now = touched(e, kind, p);
    for (const f of Object.keys(p)) if (same(now[f], p[f])) delete p[f];
    if (!Object.keys(p).length) throw refuse(label + ' already reads as proposed (a fix names ' + allowed.join(', ') + ')', { same: label });
    /* unused, the record is rewritten in place: no press needed */
    if (e.kind === 'task' && !startedBy(db, e)) throw refuse(label + ' has not started: rewrite it in place (task edit ' + label + ' --intent, --description, --name, --close)', { inPlace: label });
    /* knowledge edit has no --words, so a words fix is asked even before use */
    if (e.kind === 'knowledge' && !usedBy(db, e) && p.words === undefined) throw refuse(label + ' is not in use yet: rewrite it in place (knowledge edit ' + label + ' --name, --body)', { inPlace: label });
  } else if (kind === 'withdraw') {
    extra([]);
    if (!isRuling(e)) throw new UsageError('a withdraw takes back a ruling never made; ' + label + ' is not a decision');
    if (e.front.status !== 'active') throw new UsageError(label + ' is ' + e.front.status + ': nothing to withdraw');
  } else {
    extra(['text']);
    const text = typeof raw.text === 'string' ? raw.text : '';
    if (text.trim().length < SECRET_MIN) throw new UsageError('a scrub names the exact text to remove, at least ' + SECRET_MIN + ' characters');
    p.text = text;
    if (!Object.keys(placesOf(db, e, text)).length) throw new UsageError(label + ' does not hold that text');
  }
  return { e, label, proposed: p, hash: hashOf(touched(e, kind, p)), proposal: proposalOf(kind, p, e.key) };
}

/* The board's own measure of a request: how many records, which sections, how much text. */
function measureOf(db, kind, items) {
  const sections = {};
  let size = 0;
  const add = (k, n = 1) => { sections[k] = (sections[k] || 0) + n; };
  for (const it of items) {
    if (kind === 'withdraw') { add('status'); continue; }
    if (kind === 'scrub') {
      for (const [k, n] of Object.entries(placesOf(db, it.e, it.proposed.text))) { add(k, n); size += n; }
      continue;
    }
    for (const [f, v] of Object.entries(it.proposed)) {
      add(SECTION[f] || f);
      if (typeof v === 'string') size += v.length;
    }
  }
  return { records: items.length, kinds: [...new Set(items.map((i) => i.e.kind))], sections, size };
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
/* a fixed field in words, as the card reads it */
const FIELD_WORDS = { name: 'the name', Description: 'the description', Intent: 'the intent', Body: 'the body', close: 'the close condition', words: "the ruling's words" };
const listWords = (a) => (a.length < 3 ? a.join(' and ') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

export function measureText(kind, m) {
  const entries = Object.entries(m.sections || {});
  const what = m.records === 1 ? '' : plural(m.records, m.kinds && m.kinds.length === 1 ? m.kinds[0] : 'record', m.kinds && m.kinds.length === 1 ? m.kinds[0] + 's' : 'records') + ': ';
  if (kind === 'withdraw') return what + 'withdrawn: never ruled';
  if (kind === 'scrub') return what + 'text removed from ' + plural(m.size, 'place', 'places') + ' (' + entries.map(([k, n]) => k + (m.records > 1 || n > 1 ? ' ' + n : '')).join(', ') + ')';
  const fields = entries.map(([k, n]) => (FIELD_WORDS[k] || k) + (m.records > 1 ? ' on ' + n : ''));
  return what + listWords(fields) + (m.size ? ', ' + m.size + ' characters proposed' : '');
}

/* a fix of one text field on one record, its words now and as proposed, both whole;
   null for a scrub, a withdraw, a close or several fields */
function changeOf(kind, items) {
  if (kind !== 'fix' || items.length !== 1 || !items[0].e) return null;
  const fs = Object.keys(items[0].proposed);
  if (fs.length !== 1 || fs[0] === 'close') return null;
  const { e, proposed } = items[0];
  return { field: SECTION[fs[0]] || fs[0], before: fieldNow(e, sectionsOf(e.body), fs[0]), after: proposed[fs[0]] };
}

/* ---- the pending row ---- */

const requestRow = (db, n) => db.stmt('SELECT id, kind, summary, reason, session, at, reversal, measure, changed FROM overrides WHERE id = ?').get(n);

function staleWhy(req, nowMs) {
  if (req.changed) return 'changed since asked';
  return nowMs - Date.parse(req.at) > EXPIRE_DAYS * DAY ? 'expired' : null;
}

function itemsOf(db, n) {
  return db.stmt('SELECT record, position, proposed, hash FROM override_items WHERE request = ? ORDER BY position').all(n).map((r) => {
    const e = entryOf(db, r.record);
    return { key: r.record, e, label: e ? e.label || e.key : r.record, proposed: JSON.parse(r.proposed), hash: r.hash };
  });
}

const expiresAt = (at) => stampNow(new Date(Date.parse(at) + EXPIRE_DAYS * DAY));

/* a list value goes as [null, list]: logVerb reads a bare array as an [old, new] pair */
const line = (db, ctx, req, changes, { key, note } = {}) => logVerb(db, {
  ts: ctx.at, verb: 'override', kind: 'override', id: '#' + req.id, key, name: req.summary, changes, by: ctx.by, pc: ctx.pc, note,
});

/* the asking session hears it closed with nothing applied, and its card stops waiting */
function dropRequest(db, req, ctx, why) {
  const labels = itemsOf(db, req.id).map((i) => i.label);
  db.stmt('DELETE FROM overrides WHERE id = ?').run(req.id);
  line(db, ctx, req, { dropped: why, records: [null, labels], asker: req.session });
}

/* The request a decide or a page names: its number (#n too), or a record it holds. */
function findRequest(db, token, day) {
  const t = String(token ?? '').trim().replace(/^#/, '');
  if (/^\d+$/.test(t)) return requestRow(db, Number(t)) || null;
  const e = resolveRecord(db, t, { day });
  const held = e ? db.stmt('SELECT request FROM override_items WHERE record = ?').get(e.key) : null;
  return held ? requestRow(db, held.request) : null;
}

/* a question or a handoff has no journal: its Keep is the activity line alone */
const keptOn = (db, key, proposal) => {
  const mark = '(proposal ' + proposal + ')';
  const r = db.stmt('SELECT at FROM notes WHERE record = ? AND instr(body, ?) > 0 LIMIT 1').get(key, mark)
    || db.stmt('SELECT at FROM activity WHERE record = ? AND instr(line, ?) > 0 LIMIT 1').get(key, mark);
  return r ? String(r.at || '').slice(0, 10) || 'an earlier day' : null;
};

/* ---- override request ---- */

/* overrideRequest(db, { kind, reason, summary, items: [{ record, name?, description?,
   intent?, close?, body?, text? }], session, dryRun? }, actor): one pending row the
   user's Allow or Keep decides. A dry run checks and measures, writing nothing. */
export function overrideRequest(db, input = {}, actor, opts) {
  const ctx = actorOf(actor, opts);
  const o = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const kind = String(o.kind ?? '').trim();
  if (!OVERRIDE_KINDS.includes(kind)) throw new UsageError('override request takes --kind ' + OVERRIDE_KINDS.join(', '));
  const session = (typeof o.session === 'string' && o.session.trim()) || ctx.session;
  if (!session) throw new UsageError('override request needs --session <own-id>: a session asks the user; a subagent reports to its session instead');
  const reason = textOf(o.reason).replace(/\s+/g, ' ');
  if (!reason) throw new UsageError('override request needs --reason: the bug that wrote the text, the ruling never made, or the secret');
  const summary = textOf(o.summary).replace(/\s+/g, ' ');
  if (!summary) throw new UsageError('override request needs --summary: what the user decides, in about 200 characters');
  if (summary.length > SUMMARY_MAX) throw new UsageError('--summary is ' + summary.length + ' characters; keep it to ' + SUMMARY_MAX + ' (the request page carries the whole before and after)');
  const raws = Array.isArray(o.items) ? o.items : [];
  if (!raws.length) throw new UsageError('override request names at least one record');
  const run = () => {
    const items = raws.map((r) => itemOf(db, kind, r, ctx));
    const seen = new Set();
    for (const it of items) {
      if (seen.has(it.e.key)) throw new UsageError(it.label + ' is named twice');
      seen.add(it.e.key);
    }
    if (items.length > 1) {
      const r = items.find((it) => isRuling(it.e));
      if (r) throw new UsageError('a batch holds only records that are not rulings: ' + r.label + ' is a ruling, asked alone (Q32)');
    }
    if (kind === 'scrub' && items.some((it) => summary.includes(it.proposed.text) || reason.includes(it.proposed.text))) {
      throw new UsageError('the summary and the reason never carry the text a scrub removes');
    }
    for (const it of items) {
      const k = keptOn(db, it.e.key, it.proposal);
      if (k) throw refuse(it.label + ': the user kept it as written on ' + k + '; the same change is not asked again', { kept: it.label });
    }
    const nowMs = ctx.date.getTime();
    for (const it of items) {
      const held = db.stmt('SELECT request FROM override_items WHERE record = ?').get(it.e.key);
      const req = held && requestRow(db, held.request);
      if (!req) continue;
      const why = staleWhy(req, nowMs);
      if (!why) {
        throw refuse(it.label + ' already has override #' + req.id + ' waiting, asked by ' + sessionWords(db, req.session) + ' on ' + req.at.slice(0, 10)
          + ': one request per record, and it waits on the user\'s Allow or Keep', { waiting: req.id });
      }
      dropRequest(db, req, ctx, why + ', then asked again');
    }
    const reversal = kind !== 'scrub' && items.some((it) => isRuling(it.e));
    const measure = measureOf(db, kind, items);
    const r = db.stmt('INSERT INTO overrides (kind, summary, reason, session, at, reversal, measure) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(kind, summary, reason, session, ctx.at, reversal ? 1 : 0, JSON.stringify(measure));
    const n = Number(r.lastInsertRowid);
    const add = db.stmt('INSERT INTO override_items (record, request, position, proposed, hash) VALUES (?, ?, ?, ?, ?)');
    items.forEach((it, i) => add.run(it.e.key, n, i, JSON.stringify(it.proposed), it.hash));
    const req = { id: n, summary };
    const change = changeOf(kind, items);
    line(db, ctx, req, { asked: kind, records: [null, items.map((i) => i.label)], ...(reversal ? { reversal: 'yes' } : {}) },
      { key: items.length === 1 ? items[0].e.key : undefined, note: reason });
    return {
      request: n, kind, records: items.map((i) => i.label), hashes: Object.fromEntries(items.map((i) => [i.label, i.hash])), reversal, measure, text: summary + ' (' + measureText(kind, measure) + ')', page: WEB.override(n),
      /* the card closes on its own once this passes unanswered */
      expires: expiresAt(ctx.at),
      /* the mod's card draws the two apart */
      summary, measured: measureText(kind, measure), ...(change ? { change } : {}),
      ...(kind === 'scrub' ? { unreached: UNREACHED } : {}),
    };
  };
  if (!o.dryRun) return tx(db, run);
  try {
    tx(db, () => { throw new DryRun(run()); });
  } catch (e) {
    if (e instanceof DryRun) return { ...e.out, dryRun: true };
    throw e;
  }
  return null;
}

/* ---- Allow: the three applies, each inside the decide's transaction ---- */

function applyFix(db, it, req, ctx) {
  const e = it.e;
  const k = WORK_KINDS[e.kind];
  const p = it.proposed;
  const front = normalize(k, { ...e.front });
  const before = { ...front };
  const secs = sectionsOf(e.body);
  let body = e.body;
  const moved = [];
  if (p.name !== undefined && p.name !== front.name) {
    moved.push({ field: 'name', old: front.name ?? '', next: p.name });
    /* a knowledge record made from its title carries it in its Description */
    if (e.kind === 'knowledge' && (secs.Description ?? '') === front.name) body = withSection(body, 'Description', p.name);
    front.name = p.name;
  }
  if (p.words !== undefined && p.words !== (front.words ?? '')) {
    moved.push({ field: 'words', old: front.words ?? '', next: p.words });
    front.words = p.words;
  }
  for (const f of ['description', 'intent', 'body']) {
    if (p[f] === undefined) continue;
    const old = secs[SECTION[f]] ?? '';
    if (old === p[f]) continue;
    body = withSection(body, SECTION[f], p[f]);
    moved.push({ field: f, old, next: p[f] });
  }
  const changes = {};
  /* a fixed Body is the whole text: the amended stamp stays only with an amendment it kept */
  if (p.body !== undefined && front.amended && !/^Amended \d{4}-\d{2}-\d{2} by /m.test(sectionsOf(body).Body ?? '')) {
    changes.amended = [front.amended, null];
    delete front.amended;
  }
  if (p.close !== undefined && !same(front.close, p.close)) {
    front.close = p.close;
    changes.close = [closeText(db, before.close), closeText(db, p.close)];
    if (front.landed && p.close.kind !== 'look') { changes.landed = [front.landed, null]; delete front.landed; }
  }
  front.corrected = ctx.at;
  front.updated = ctx.at;
  const fields = orderFront(k, front);
  putRecord(db, { key: e.key, kind: e.kind, slug: e.slug, fields, body, layout: e.layout, track: e.track });
  const why = 'corrected by the user: override #' + req.id;
  const ids = moved.map((m) => addHistory(db, ctx, { key: e.key, field: m.field, old: m.old, next: m.next, why }));
  for (const m of moved) changes[m.field] = 'corrected';
  if (ids.length) changes.history = historyRef(ids);
  logRow(db, ctx, { verb: 'edit', kind: e.kind, front: fields, changes, note: why });
  return { id: it.label };
}

function applyWithdraw(db, it, req, ctx) {
  const e = it.e;
  const front = normalize(WORK_KINDS.knowledge, { ...e.front });
  const was = front.status;
  front.status = 'withdrawn';
  front.closed = ctx.at;
  front.updated = ctx.at;
  const fields = orderFront(WORK_KINDS.knowledge, front);
  putRecord(db, { key: e.key, kind: e.kind, slug: e.slug, fields, body: e.body, layout: e.layout, track: e.track });
  const why = 'withdrawn: never ruled (override #' + req.id + ')';
  const h = addHistory(db, ctx, { key: e.key, field: 'status', old: was, next: 'withdrawn', why });
  logRow(db, ctx, { verb: 'edit', kind: e.kind, front: fields, changes: { status: [was, 'withdrawn'], history: historyRef([h]) }, note: why });
  return { id: it.label };
}

/* Every live copy at once: the record, its journal, its history, its activity
   lines (the search index follows through the triggers). The originals are
   sealed SEAL_DAYS, and no line written here carries the text. */
function applyScrub(db, it, req, ctx) {
  const e = it.e;
  const rows = hitsOf(db, e, it.proposed.text);
  const r = rows.record;
  if (r && e.handoff) {
    db.stmt('UPDATE handoffs SET fields = ?, state = ?, where_we_were = ?, verify = ? WHERE key = ?').run(JSON.stringify(r.now.fields), r.now.state, r.now.where, r.now.verify, e.key);
  } else if (r) putRecord(db, { key: e.key, kind: e.kind, slug: e.slug, fields: r.now.fields, body: r.now.body, layout: e.layout, track: e.track });
  for (const n of rows.notes) db.stmt('UPDATE notes SET body = ? WHERE id = ?').run(n.now, n.id);
  for (const h of rows.history) db.stmt('UPDATE history SET old = ?, new = ? WHERE id = ?').run(h.now.old, h.now.new, h.id);
  for (const a of rows.activity) db.stmt('UPDATE activity SET line = ? WHERE seq = ?').run(a.now, a.seq);
  const fields = r ? r.now.fields : e.front;
  const until = stampNow(new Date(ctx.date.getTime() + SEAL_DAYS * DAY));
  const s = db.stmt('INSERT INTO seals (record, request, at, until, rows) VALUES (?, ?, ?, ?, ?)').run(e.key, req.id, ctx.at, until, JSON.stringify(rows));
  logRow(db, ctx, {
    verb: 'edit', kind: e.kind, front: { id: fields.id, key: e.key, name: fields.name }, changes: { text: 'removed', sealed: until.slice(0, 10) },
    note: 'scrubbed by the user (override #' + req.id + '); the original is sealed until ' + until.slice(0, 10) + ', then purged',
  });
  return { id: it.label, seal: Number(s.lastInsertRowid), until, reached: countOf(rows, e.key) };
}

const APPLY = { fix: applyFix, withdraw: applyWithdraw, scrub: applyScrub };

/* Keep: one line in the journal, no proposed text, and the proposal's hash so the same ask is refused. */
function keepNote(db, it, req, ctx) {
  const e = it.e;
  const what = req.kind === 'fix' ? 'fix its ' + Object.keys(it.proposed).join(', ') : req.kind === 'withdraw' ? 'withdraw it' : 'scrub a text from it';
  const body = 'Kept as written by the user: override #' + req.id + ' asked to ' + what + ' (proposal ' + proposalOf(req.kind, it.proposed, e.key) + ').';
  if (e.kind === 'question' || e.kind === 'handoff') {
    logRow(db, ctx, { verb: 'note', kind: e.kind, front: { id: it.label, key: e.key, name: e.front.name || '' }, changes: {}, note: body });
    return;
  }
  addNote(db, e.key, { at: ctx.at, actor: ctx.by, body });
  const k = WORK_KINDS[e.kind];
  const fields = k ? orderFront(k, { ...normalize(k, { ...e.front }), updated: ctx.at }) : { ...e.front, updated: ctx.at };
  const journalless = e.layout && e.layout.journal === false;
  putRecord(db, {
    key: e.key, kind: e.kind, slug: e.slug, fields, track: e.track,
    body: journalless ? String(e.body).replace(/\n*$/, '\n') + '\n' : e.body, layout: journalless ? null : e.layout,
  });
  logRow(db, ctx, { verb: 'note', kind: e.kind, front: fields, changes: {}, note: body });
}

/* ---- override decide: the user's press ---- */

/* overrideDecide(db, { request, decision: 'allow' | 'keep' }, actor): only the
   user's act (the user actor). Allow applies every item or none; a touched text
   that moved since the ask refuses it and marks the request. The row goes either way. */
export function overrideDecide(db, input = {}, actor, opts) {
  const ctx = actorOf(actor, opts);
  if (!isUserAct(ctx.by)) {
    throw new UsageError("override decide is the user's own press, Allow or Keep (--user <session>); a session asks with override request and waits");
  }
  const decision = String(input && input.decision ? input.decision : '').trim().toLowerCase();
  if (!['allow', 'keep'].includes(decision)) throw new UsageError('override decide takes allow or keep');
  let refusal = null;
  const out = tx(db, () => {
    const req = findRequest(db, input.request, ctx.day);
    if (!req) throw new UsageError('no override request ' + String(input.request ?? '') + ' is waiting: it was decided, or never asked');
    const items = itemsOf(db, req.id);
    const labels = items.map((i) => i.label);
    /* expired unanswered: Allow is refused and Keep clears it, nothing applied either way */
    if (staleWhy(req, ctx.date.getTime()) === 'expired') {
      dropRequest(db, req, ctx, 'expired');
      if (decision === 'keep') return { request: req.id, kind: req.kind, decision, records: labels, asker: req.session, dropped: 'expired' };
      refusal = 'override #' + req.id + ' expired: it was asked on ' + req.at.slice(0, 10) + ', over ' + EXPIRE_DAYS + ' days ago; nothing was applied, and the session asks again';
      return null;
    }
    if (decision === 'allow') {
      const moved = items.filter((it) => !it.e || hashOf(touched(it.e, req.kind, it.proposed)) !== it.hash).map((it) => it.label);
      if (req.changed || moved.length) {
        if (!req.changed) {
          db.stmt('UPDATE overrides SET changed = ? WHERE id = ?').run(ctx.at, req.id);
          /* the asking session hears the refusal, wherever Allow was pressed */
          line(db, ctx, req, { changed: [null, moved], asker: req.session }, { note: 'changed since asked' });
        }
        refusal = 'override #' + req.id + ' changed since asked' + (moved.length ? ' (' + moved.join(', ') + ')' : '')
          + ': nothing was applied; Keep drops it, and the session asks again from the text as it stands';
        return null;
      }
    }
    const applied = decision === 'allow' ? items.map((it) => APPLY[req.kind](db, it, req, ctx)) : [];
    /* a request that changed since asked was never decided on its text: Keep only clears it */
    if (decision === 'keep' && !req.changed) for (const it of items) if (it.e) keepNote(db, it, req, ctx);
    db.stmt('DELETE FROM overrides WHERE id = ?').run(req.id);
    line(db, ctx, req, { decided: decision, records: [null, labels], asker: req.session },
      { key: items.length === 1 ? items[0].key : undefined, note: decision === 'allow' ? 'allowed by the user' : 'kept as written' });
    return {
      request: req.id, kind: req.kind, decision, records: labels, asker: req.session,
      ...(decision === 'allow' && req.kind === 'scrub' ? { scrubbed: applied, unreached: UNREACHED } : {}),
    };
  });
  if (refusal) throw new UsageError(refusal);
  return out;
}

/* ---- unscrub, and the purge ---- */

/* overrideUnscrub(db, { id } | { seal }, actor): the user's act; puts back each
   copy the scrub changed, unless it changed again since (those are named). */
export function overrideUnscrub(db, input = {}, actor, opts) {
  const ctx = actorOf(actor, opts);
  if (!isUserAct(ctx.by)) throw new UsageError("override unscrub is the user's act (Unscrub on the band, or --user <session> when they ask in chat)");
  return tx(db, () => {
    let seal;
    if (input.seal !== undefined && input.seal !== null) seal = db.stmt('SELECT * FROM seals WHERE id = ?').get(Number(String(input.seal).replace(/^#/, '')));
    else {
      const raw = String(input.id ?? '').trim();
      const e = resolveRecord(db, raw, { day: ctx.day });
      if (!e) throw new UsageError('unknown record id: ' + raw);
      seal = db.stmt('SELECT * FROM seals WHERE record = ? ORDER BY id DESC LIMIT 1').get(e.key);
    }
    const who = seal ? labelOf(db, seal.record) : String(input.id ?? input.seal ?? '');
    if (!seal) throw new UsageError('no scrub of ' + who + ' is sealed: nothing to put back');
    if (Date.parse(seal.until) <= ctx.date.getTime()) throw new UsageError('the scrub of ' + who + ' was purged on ' + seal.until.slice(0, 10) + ': its text is gone');
    const rows = JSON.parse(seal.rows);
    const left = [];
    const cur = entryOf(db, seal.record);
    if (rows.record && cur) {
      const fields = { ...cur.front };
      for (const [k, v] of Object.entries(rows.record.was.fields)) {
        if (same(cur.front[k], rows.record.now.fields[k])) fields[k] = v;
        else if (!same(v, rows.record.now.fields[k])) left.push('its ' + k);
      }
      if (cur.handoff) {
        const back = {};
        for (const k of ['state', 'where', 'verify']) {
          back[k] = cur.handoff[k] === rows.record.now[k] ? rows.record.was[k] : cur.handoff[k];
          if (cur.handoff[k] !== rows.record.now[k]) left.push('its ' + k);
        }
        db.stmt('UPDATE handoffs SET fields = ?, state = ?, where_we_were = ?, verify = ? WHERE key = ?').run(JSON.stringify(fields), back.state, back.where, back.verify, cur.key);
      } else {
        let body = cur.body;
        if (cur.body === rows.record.now.body) body = rows.record.was.body;
        else left.push('its body');
        putRecord(db, { key: cur.key, kind: cur.kind, slug: cur.slug, fields, body, layout: cur.layout, track: cur.track });
      }
    }
    for (const n of rows.notes) {
      const r = db.stmt('UPDATE notes SET body = ? WHERE id = ? AND body = ?').run(n.was, n.id, n.now);
      if (!r.changes) left.push('a journal note');
    }
    for (const h of rows.history) {
      const r = db.stmt('UPDATE history SET old = ?, new = ? WHERE id = ? AND old IS ? AND new IS ?').run(h.was.old, h.was.new, h.id, h.now.old, h.now.new);
      if (!r.changes) left.push('history #' + h.id);
    }
    for (const a of rows.activity) {
      const r = db.stmt('UPDATE activity SET line = ? WHERE seq = ? AND line = ?').run(a.was, a.seq, a.now);
      if (!r.changes) left.push('an activity line');
    }
    db.stmt('DELETE FROM seals WHERE id = ?').run(seal.id);
    const head = cur ? { id: cur.label, key: cur.key, name: cur.front.name } : { id: who, key: seal.record };
    logRow(db, ctx, { verb: 'edit', kind: cur ? cur.kind : 'record', front: head, changes: { text: 'restored' }, note: 'unscrubbed by the user: the text the scrub of ' + seal.at.slice(0, 10) + ' removed is back' });
    return { id: who, restored: true, ...(left.length ? { left } : {}) };
  });
}

/* The nightly backup's purge: a seal past its date goes before the copy is made. */

/* The purged original leaves the live file too: the search index merges past its deleted
   terms, VACUUM rewrites every page (earlier writes left copies in free space, measured),
   and the log is truncated. Inside an outer write it waits for the next purge. */
function wipe(db) {
  if (db.isTransaction) return;
  db.exec("INSERT INTO search (search) VALUES ('optimize')");
  db.exec('VACUUM');
  db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
}
export function purgeSeals(db, now = new Date()) {
  const t = now.getTime();
  const gone = db.stmt('SELECT id, until FROM seals').all().filter((s) => Date.parse(s.until) <= t);
  if (!gone.length) return 0;
  tx(db, () => { for (const s of gone) db.stmt('DELETE FROM seals WHERE id = ?').run(s.id); });
  wipe(db);
  return gone.length;
}

/* ---- reads: the band's rows and the request page ---- */

/* Pending requests in the session's scope (the asker's own always), and every
   scrub until it is purged, on any band. */
export function overrideCalls(db, session, scope, nowMs) {
  const rows = [];
  for (const req of db.stmt('SELECT id, kind, summary, reason, session, at, reversal, measure, changed FROM overrides ORDER BY id').all()) {
    /* expired unanswered, the row stays until Keep clears it */
    const expired = staleWhy(req, nowMs) === 'expired';
    const items = db.stmt(`SELECT i.record, coalesce(r.kind, CASE WHEN h.key IS NULL THEN NULL ELSE 'handoff' END) AS kind, coalesce(r.label, h.label) AS label, r.workstream, coalesce(ti.track, h.track) AS track
      FROM override_items i LEFT JOIN records r ON r.key = i.record LEFT JOIN handoffs h ON h.key = i.record
      LEFT JOIN track_items ti ON ti.task = i.record WHERE i.request = ? ORDER BY i.position`).all(req.id);
    if (scope && req.session !== session && !items.some((it) => inScope(scope, it.workstream, it.kind === 'track' ? it.record : it.track))) continue;
    const press = (label, decision, does) => ({ label, verb: 'overrideDecide', input: { request: req.id, decision }, does });
    const measure = measureText(req.kind, JSON.parse(req.measure));
    /* `change` was the request's kind before, and the band still reads it so: the
       before and after object for one fixed field, else the kind as it was */
    const change = (req.kind === 'fix' && items.length === 1 && changeOf(req.kind, itemsOf(db, req.id))) || req.kind;
    /* the band's tooltip: the workstreams it touches and its records by label */
    const wsOf = (it) => it.workstream || (it.track ? (db.stmt('SELECT workstream FROM records WHERE key = ?').get(it.track) || {}).workstream : null);
    const wss = [...new Set(items.map(wsOf).filter(Boolean))].map((k) => ({ id: labelOf(db, k), name: (db.stmt('SELECT title FROM records WHERE key = ?').get(k) || {}).title || '' }));
    const what = req.kind === 'withdraw' ? 'withdraws ' : req.kind === 'scrub' ? 'scrubs the text from ' : 'rewrites ';
    const on = items.length === 1 ? items[0].label : items.length + ' records';
    const keepDoes = expired || req.changed ? 'clears the request; the session asks again if it is still needed' : 'leaves ' + on + ' as written; the asking session hears it';
    rows.push({
      kind: 'override', record: items.length ? items[0].record : null, id: items.length === 1 ? items[0].label : null, request: req.id, count: items.length,
      reversal: req.reversal === 1, changed: Boolean(req.changed), ...(expired ? { expired: true } : {}), url: WEB.override(req.id), since: req.at,
      text: (expired ? 'Expired unanswered after ' + EXPIRE_DAYS + ' days: ' : req.changed ? 'Changed since asked: ' : '') + req.summary + ' (' + measure + ')',
      change, summary: req.summary, reason: req.reason || '', measure, workstreams: wss, records: items.map((it) => it.label).filter(Boolean),
      presses: expired || req.changed ? [press('Keep', 'keep', keepDoes)]
        : [press('Allow', 'allow', what + on + ' now, with no model turn; the asking session hears it'), press('Keep', 'keep', keepDoes)],
      /* the asking session hears the press as a turn */
      ...(session && req.session === session ? { mine: true } : {}),
    });
  }
  for (const s of db.stmt('SELECT id, record, at, until FROM seals ORDER BY id').all()) {
    if (Date.parse(s.until) <= nowMs) continue;
    const label = labelOf(db, s.record);
    rows.push({
      kind: 'scrub', record: s.record, id: label, seal: s.id, since: s.at, until: s.until,
      text: label + ': a text was scrubbed; the original is sealed until ' + s.until.slice(0, 10) + ', then purged. If it was a secret, rotate it.',
      presses: [{ label: 'Unscrub', verb: 'overrideUnscrub', input: { seal: s.id }, does: 'puts the scrubbed text back where it was' }],
    });
  }
  return rows;
}

/* overrideView(db, { request }): every record's full before and after; a scrub
   shows the after and never the text it removes. Null when none waits. */
export function overrideView(db, input = {}, actor, opts) {
  const o = input && typeof input === 'object' ? input : { request: input };
  return readTx(db, () => {
    const ctx = actorOf(actor, opts);
    const req = findRequest(db, o.request, ctx.day);
    if (!req) return null;
    const records = itemsOf(db, req.id).map((it) => {
      const head = { id: it.label, key: it.key, kind: it.e ? it.e.kind : '', name: it.e ? it.e.front.name || '' : '' };
      if (!it.e) return { ...head, gone: true, fields: [] };
      const secs = sectionsOf(it.e.body);
      if (req.kind === 'withdraw') return { ...head, fields: [{ field: 'status', before: it.e.front.status, after: 'withdrawn: never ruled' }] };
      if (req.kind === 'scrub') {
        /* a scrub moved between boards travels without its text, and is asked again */
        if (typeof it.proposed.text !== 'string') return { ...head, removed: true, fields: [] };
        const c = cutterOf(it.proposed.text);
        const after = it.e.handoff ? [it.e.handoff.state, it.e.handoff.where || ''].join('\n\n') : it.e.body;
        return { ...head, name: c.whole(head.name), removed: true, fields: [{ field: 'text', after: c.whole(after).trim() }] };
      }
      const fields = Object.entries(it.proposed).map(([f, v]) => (f === 'close'
        ? { field: 'close', before: closeText(db, it.e.front.close) || 'by hand', after: closeText(db, v) }
        : { field: SECTION[f] || f, before: fieldNow(it.e, secs, f), after: v }));
      return { ...head, fields };
    });
    const why = staleWhy(req, ctx.date.getTime());
    return {
      request: req.id, kind: req.kind, summary: req.summary, reason: req.reason, session: req.session, at: req.at, reversal: req.reversal === 1,
      measure: JSON.parse(req.measure), text: measureText(req.kind, JSON.parse(req.measure)), ...(why ? { stale: why } : {}), records,
      ...(req.kind === 'scrub' ? { unreached: UNREACHED } : {}),
    };
  });
}
