/* The kickoff: what a session reads first on a
   track. kickoffInput gathers it from the database; kickoffText is pure. The
   task list always comes from the tables: a handoff adds the thinking and
   never retells the list. */
import { clockOf, dayOf, labelOf, stampNow, unguardHeadings } from '../records.mjs';
import { ENDED_TASK, loadRecord, pathBetween, trackGraph } from './graph.mjs';
import { inboxOffers, pastWords, placeOf, whereWords, withOffers } from './found.mjs';
import { noteRead } from './history.mjs';
import { labelGates } from './labels.mjs';
import { NEWEST_FIRST, closingReviews, goalRestatedOf, isStalled, openLeaves, projectInbox, stateOf, taskWake, trackView } from './tracks.mjs';
import { addedLine, growthLine, servesView } from './outcomes.mjs';
import { decisionsSince } from './decisions.mjs';
import { cardsCited } from './procedures.mjs';
import { citedWords } from './proc-cards.mjs';
import { loadProfiles } from './profiles.mjs';
import { ageText, atWords, whoWords } from '../web/feed.mjs';
import { namedList, shortName, viewNameOf } from '../web/graph.mjs';
import { CLI, dueLine, inboxLines, leavesLine, offerLines, reviewLine, waitingOf } from '../handoff-text.mjs';

export { CLI, ageText, inboxLines };

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const ms = (s) => { const n = Date.parse(String(s || '')); return Number.isFinite(n) ? n : null; };

/* the transcript path is measured; it lives on the machine that ran the session. */
export const previousLine = (sid) => 'Previous session: ' + sid + '. Its transcript is ~/.claude/projects/<its project folder>/' + sid
  + '.jsonl on the machine it ran on (`ls ~/.claude/projects/*/' + sid + '.jsonl` finds it); read only its last turns,'
  + ' and only when this handoff leaves something unclear.';

/* An item that names question Qn (Q-n too), as a word. */
export const mentions = (text, id) => {
  const n = /^Q-?(\d+)$/i.exec(String(id || '').trim());
  return !!n && new RegExp('\\bQ-?' + n[1] + '\\b', 'i').test(String(text));
};

const firstOf = (v) => (Array.isArray(v) ? v.find((p) => typeof p === 'string' && p.trim()) : null) || null;

/* where a workstream's handoff folder sits. An absolute one is a folder; a
   relative one sits in its first project, named by its shared name, which each
   PC resolves through its own map; an old record's sits in its first folder. */
export function handoffAtOf(ws) {
  const h = ws && typeof ws.handoff === 'string' ? ws.handoff.trim().replace(/\\/g, '/').replace(/\/+$/, '') : '';
  if (!h) return null;
  if (/^([A-Za-z]:)?\//.test(h)) return { dir: h };
  const rel = h.replace(/^(\.\/)+/, '');
  const name = firstOf(ws.projectRepos);
  if (name) return { project: name, rel };
  const base = firstOf(ws.projects);
  return base ? { dir: (base.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + rel).replace(/\/\.\//g, '/') } : null;
}

/* The kickoff's Read line: the folder when known, else where it sits by name.
   once a profile on the workstream carries rule lines, they ride the rules
   in force and the line points at map.md alone. */
export function readLine(ws) {
  const on = Array.isArray(ws.ruleProfiles) && ws.ruleProfiles.length ? ws.ruleProfiles : null;
  const ride = on ? 'Read: ' + ws.id + "'s rules ride the rules in force (profile " + on.join(', ') + ')' : '';
  if (ws.handoffDir) {
    return on ? ride + '; grep ' + ws.handoffDir + '/map.md for what you touch.'
      : 'Read: ' + ws.id + ' ' + ws.handoffDir + '/rules.md whole; grep ' + ws.handoffDir + '/map.md for what you touch.';
  }
  const at = ws.handoffAt;
  if (at) {
    return on ? ride + '; grep ' + at.rel + '/map.md for what you touch, in ' + at.project + '.'
      : 'Read: ' + ws.id + ' ' + at.rel + '/rules.md whole and grep ' + at.rel + '/map.md for what you touch, in ' + at.project + '.';
  }
  return on ? ride + '.' : 'Read: ' + ws.id + ' names no handoff folder, so no rules are listed.';
}

/* The profiles a workstream holds that carry rule lines. */
function ruleProfilesOf(db, wsRec) {
  const held = Array.isArray(wsRec.fields.profiles) ? wsRec.fields.profiles : [];
  if (!held.length) return [];
  const { profiles } = loadProfiles(db);
  return held.filter((n) => {
    const s = profiles[n] && profiles[n].settings;
    return Boolean(s && Array.isArray(s['rules.add']) && s['rules.add'].length);
  });
}

/* a shown handoff's growth line and its tasks added with the
   outcomes they serve, as the kickoff, the CLI and the web print them. */
/* `opts.held`: the track whose arc it is, so its own track's call is tier 2; `opts.day` the clock's day. */
export function growthLines(db, g, opts = {}) {
  if (!g) return [];
  const recs = (v) => String(v || '').split(/\s+/).filter(Boolean).map((k) => loadRecord(db, k)).filter(Boolean);
  const added = recs(g.added).map((t) => {
    const ws = t.fields.workstream ? loadRecord(db, t.fields.workstream) : null;
    return { id: t.fields.id, name: t.fields.name, view: servesView(ws && ws.fields.outcomes, t.fields.serves) };
  });
  return [growthLine(g), addedLine(added, g.since), ...foundGrowth(db, [...recs(g.added), ...recs(g.found)], opts)].filter(Boolean);
}

const WENT_MAX = 12;

/* where each task the arc filed went now, and the unplaced ones with their reasons and wakes.
   one whose wake has not come owes nothing; a due one, or one with no reason, gets the board's call. */
function foundGrowth(db, tasks, { held = null, day, inbox = null, calledAt = 'under the due line' } = {}) {
  if (!tasks.length) return [];
  const placed = tasks.map((t) => ({ t, where: placeOf(db, t) }));
  /* a closed task needs no place, so only open work is asked for one */
  const loose = placed.filter((x) => x.where.kind !== 'track' && !ENDED_TASK.includes(x.t.fields.status))
    .map((x) => ({ ...x, ...taskWake(db, x.t, day) }));
  const on = placed.filter((x) => x.where.kind === 'track');
  const out = [];
  const more = on.length - WENT_MAX;
  const heldRec = held ? loadRecord(db, held) : null;
  if (on.length) {
    /* a reader with no held track (the board page) gets the placeholder */
    out.push('Where they went: ' + on.slice(0, WENT_MAX).map((x) => x.t.fields.id + ' ' + whereWords(x.where, null)).join('; ')
      + (more > 0 ? '; and ' + more + ' more (' + CLI + ' track found ' + (heldRec ? heldRec.fields.id : 'TR-n') + ' lists them all)' : ''));
  }
  if (loose.length) {
    /* another workstream's due task is placed there, so only named here */
    const mine = (x) => !heldRec || !x.t.fields.workstream || x.t.fields.workstream === heldRec.fields.workstream;
    /* the kickoff's inbox rows: one with the user owes nothing, and the due line already printed a due one's call */
    const rowOf = new Map((inbox || []).map((r) => [r.id, r]));
    const asked = (x) => Boolean(rowOf.get(x.t.fields.id) && rowOf.get(x.t.fields.id).asked);
    const called = (x) => Boolean(x.due && rowOf.get(x.t.fields.id) && rowOf.get(x.t.fields.id).due);
    const owed = loose.filter((x) => (x.due || x.where.kind === 'none') && mine(x) && !asked(x));
    const rows = withOffers(db, owed.filter((x) => !called(x)).map((x) => ({ id: x.t.fields.id, key: x.t.key, name: x.t.fields.name, wake: x.wake, due: x.due })),
      { held, ownWs: heldRec ? heldRec.fields.workstream : null });
    const where = rows.length === owed.length ? 'below' : rows.length ? 'below or ' + calledAt : calledAt;
    out.push('Unplaced: ' + loose.map((x) => x.t.fields.id + ' ' + one(x.t.fields.name) + ' (' + (x.where.reason || 'no reason given') + pastWords(x.where.whyElsewhere) + (x.due ? ', due' + (mine(x) ? '' : ' in ' + labelOf(db, x.t.fields.workstream) + ', which places it') : ', wakes ' + one(x.wake))
        + (asked(x) ? ', with the user as ' + rowOf.get(x.t.fields.id).asked : '') + ')').join('; ')
      + '. ' + (owed.length ? 'Owed now: ' + owed.map((x) => x.t.fields.id).join(', ') + '; place each by the board\'s call ' + where + ', give it a wake, or ask the user'
        + (owed.length < loose.length ? '; the rest owe nothing now' : '') + '.'
        : loose.some((x) => x.due && asked(x)) ? 'None owes anything now: a due one with the user waits on its answer, and the rest come back at their wake.'
          : 'None is due, so none owes anything now; each comes back at its wake.'), ...offerLines(rows, CLI));
  }
  return out;
}

/* The track's questions (a question belongs to its track) and those gating one of its tasks;
   one that names no track at all stays with its workstream. */
function questionsOf(db, trackKey, wsKey, where) {
  const tasks = db.stmt('SELECT task FROM track_items WHERE track = ?').all(trackKey).map((r) => r.task);
  const old = JSON.stringify(labelGates(db, tasks).map((x) => x.from));
  return db.stmt(`SELECT q.key, q.label, q.title, q.fields, q.status FROM records q WHERE q.kind = 'question' AND ${where}
    AND (coalesce(json_extract(q.fields, '$.track'), q.track) = ?
      OR (coalesce(json_extract(q.fields, '$.track'), q.track, '') = '' AND q.workstream = ?)
      OR EXISTS (SELECT 1 FROM links l JOIN track_items ti ON ti.track = ? WHERE l."from" = q.key AND l.type = 'gates' AND l."to" = ti.task)
      OR q.key IN (SELECT value FROM json_each(?)))
    ORDER BY q.id`).all(trackKey, wsKey || '', trackKey, old).map((r) => ({ ...r, fields: JSON.parse(r.fields) }));
}

/* Questions answered since `since`: the track's, and the ones the handoff's session asked. */
function answersSince(db, trackKey, wsKey, since, session) {
  const t = ms(since);
  if (t === null) return [];
  const rows = questionsOf(db, trackKey, wsKey, "q.status = 'answered'");
  if (session) {
    for (const r of db.stmt(`SELECT key, label, title, fields, status FROM records WHERE kind = 'question' AND status = 'answered'
        AND json_extract(fields, '$.session') = ?`).all(session)) {
      if (!rows.some((x) => x.key === r.key)) rows.push({ ...r, fields: JSON.parse(r.fields) });
    }
  }
  return rows.filter((r) => (ms(r.fields.answered) ?? -Infinity) >= t).map((r) => {
    const note = db.stmt('SELECT body FROM notes WHERE record = ? ORDER BY position LIMIT 1').get(r.key);
    return { id: r.label, name: r.title, answer: note ? unguardHeadings(note.body) : '' };
  });
}

/* the workstream's other open tracks with ready work and no session, each with its
   ready count and the decision or question that started it (its refs, else the first ruling
   naming it); one waiting on a blocking question of its own is the user's, so left out. */
/* `keep(rec)`, when given, drops a track before its graph is built (the shelf keeps only never-held ones) */
export function untakenTracks(db, wsKey, trackKey, keep = null, nowMs = Date.now()) {
  if (!wsKey) return [];
  const out = [];
  for (const r of db.stmt(`SELECT key FROM records WHERE kind = 'track' AND workstream = ? AND status = 'open' AND key <> ?
      AND NOT EXISTS (SELECT 1 FROM leases WHERE track = records.key) ORDER BY id`).all(wsKey, trackKey || '')) {
    const t = loadRecord(db, r.key);
    if (keep && !keep(t)) continue;
    const g = trackGraph(db, r.key, nowMs);
    const ready = g.ready.length;
    if (!ready) continue;
    if (questionsOf(db, r.key, null, "q.status = 'open'").some((q) => q.fields.blocking === true || q.fields.blocking === 'true')) continue;
    const ref = (Array.isArray(t.fields.refs) ? t.fields.refs : []).map((x) => String(labelOf(db, x))).find((l) => /^(K-\d+|Q-?\d+)$/i.test(l));
    const ruled = ref ? null : db.stmt(`SELECT label FROM records WHERE kind = 'knowledge'
      AND EXISTS (SELECT 1 FROM json_each(coalesce(json_extract(fields, '$.tracks'), '[]')) WHERE value = ?) ORDER BY id LIMIT 1`).get(r.key);
    /* the shelf's caller (keep) reuses the bar's counts rather than graphing the track again */
    out.push({ id: t.fields.id, name: t.fields.name, ready, from: ref || (ruled ? ruled.label : null), ...(keep ? { done: g.done, total: g.total } : {}) });
  }
  return out;
}

/* one line for them, the first few named and the rest counted. */
export const UNTAKEN_MAX = 5;
const UNTAKEN_NAME = 70;
export function untakenLine(list, ws) {
  if (!Array.isArray(list) || !list.length) return '';
  const cut = (s) => { const t = one(s); return t.length > UNTAKEN_NAME ? t.slice(0, UNTAKEN_NAME - 3).trimEnd() + '...' : t; };
  const more = list.length - UNTAKEN_MAX;
  return 'Untaken in ' + (ws ? ws.id : 'this workstream') + ', ready work and no session (' + list.length + '): '
    + list.slice(0, UNTAKEN_MAX).map((t) => t.id + ' ' + cut(t.name) + ' (' + t.ready + ' ready' + (t.from ? ', from ' + t.from : '') + ')').join('; ')
    + (more > 0 ? '; and ' + more + ' more (`' + CLI + ' track list --workstream ' + (ws ? ws.id : 'WS-n') + '` lists them)' : '')
    + '. Tell the user, who may want one resumed (/askerdo resume TR-n).';
}

/* The track's goal: its goal field, else its Description section. */
function goalOf(rec) {
  if (rec.fields.goal && one(rec.fields.goal)) return one(rec.fields.goal);
  const m = /(?:^|\n)## Description[ \t]*\n([\s\S]*?)(?=\n## |$)/.exec(String(rec.body || ''));
  return m && one(m[1]) ? one(m[1]) : null;
}

/* The note a handoff that restates the goal leaves on the track; the Goal line says it instead. */
export const goalNote = (handoffId) => 'Goal restated at handoff ' + handoffId + '.';

/* The track's journal notes written since its newest handoff, all of them before its first:
   a note left while nobody held the track reaches the session that takes it next. */
function notesSinceHandoff(db, trackKey) {
  const last = db.stmt('SELECT label, created FROM handoffs WHERE track = ? ORDER BY ' + NEWEST_FIRST + ' LIMIT 1').get(trackKey);
  const since = last ? ms(last.created) : null;
  const own = last ? goalNote(last.label) : null;
  const rows = db.stmt('SELECT at, body FROM notes WHERE record = ? ORDER BY position').all(trackKey);
  return rows.map((r, i) => ({ at: r.at, body: unguardHeadings(r.body), tail: rows.length - i }))
    .filter((r) => (since === null || (ms(r.at) ?? -Infinity) >= since) && r.body !== own);
}

/* The task a due review's step goes before, for the kickoff and the handoff write, so the printed call is at a real
   place: the track's first mid-track review or look, else its last work in dependency order, else its closing
   review. Work not started comes first; a task the unreviewed work already waits on would close a loop. */
export function checkpointOf(db, trackKey, view = trackView(db, { track: trackKey })) {
  if (!view.tasks.length) return null;
  const looks = new Set(db.stmt(`SELECT label FROM records WHERE key IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM json_each(fields, '$.labels') WHERE value = 'look')`)
    .all(JSON.stringify(view.tasks.map((t) => t.key))).map((r) => r.label));
  const late = db.stmt('SELECT r.key FROM track_items ti JOIN records r ON r.key = ti.task WHERE ti.track = ? AND r.label IN (SELECT value FROM json_each(?))')
    .all(trackKey, JSON.stringify(((view.review && view.review.uncovered) || []).map((t) => t.id)));
  const closing = closingReviews(db, trackKey);
  const free = view.tasks.filter((t) => !late.some((r) => pathBetween(db, r.key, t.key)));
  const work = free.filter((t) => !closing.has(t.key));
  const idle = work.filter((t) => !['running', 'unconfirmed'].includes(t.word.is));
  const from = idle.length ? idle : work;
  const t = from.find((x) => x.review || looks.has(x.id)) || from.at(-1) || (view.tasks.every((x) => closing.has(x.key)) ? free[0] : null);
  return t ? t.id : null;
}

/* Everything the renderer needs, in one read. `h` is the handoff the kickoff
   carries (the live one, else null); `opts.now` is the clock. `opts.viewer`:
   the asking session, for the wording alone; `opts.reader` also marks the rulings read. */
export function kickoffInput(db, trackKey, h, opts) {
  /* the reader names this session's own run on the index */
  const reader = (opts && (opts.reader || opts.viewer)) || null;
  const view = trackView(db, { track: trackKey }, reader ? { ...opts, reader } : opts);
  const rec = loadRecord(db, trackKey);
  const wsRec = rec.fields.workstream ? loadRecord(db, rec.fields.workstream) : null;
  const wsKey = wsRec ? wsRec.key : null;
  const nowMs = clockOf(opts).getTime();
  const stalls = [];
  if (wsKey) {
    for (const r of db.stmt(`SELECT key FROM records WHERE kind = 'track' AND workstream = ? AND status IN ('open', 'parked') AND key <> ? ORDER BY id`).all(wsKey, trackKey)) {
      const t = loadRecord(db, r.key);
      const st = stateOf(db, t);
      if (isStalled(db, t, st, nowMs)) stalls.push({ id: t.fields.id, name: t.fields.name, state: st, parkReason: t.fields.parkReason || null });
    }
  }
  const waits = questionsOf(db, trackKey, wsKey, "q.status = 'open'")
    .map((q) => ({ id: q.label, name: q.title, blocking: q.fields.blocking === true || q.fields.blocking === 'true' }));
  const answers = h ? answersSince(db, trackKey, wsKey, h.created, h.fromSession) : [];
  const last = h ? null : db.stmt('SELECT label, status, fields FROM handoffs WHERE track = ? ORDER BY ' + NEWEST_FIRST + ' LIMIT 1').get(trackKey);
  /* a resumed handoff's waits stay until the next handoff drops them, so the held track still shows them */
  const carried = h ? waitingOf(h) : last && last.status === 'resumed' ? waitingOf(JSON.parse(last.fields)) : [];
  /* read from the board, never from the handoff, so a resume carries every decision */
  const leg = decisionsSince(db, { track: trackKey, handoff: h ? h.key || h.id : undefined });
  const ruled = leg.decisions;
  const decisions = ruled.map((d) => ({ id: d.id, name: d.name, created: d.created, ...(d.amended ? { amended: d.amended } : {}) }));
  /* a session's kickoff is a read of each ruling it lists */
  if (opts && opts.reader) {
    const at = stampNow(clockOf(opts));
    for (const d of ruled) noteRead(db, loadRecord(db, d.key), opts.reader, 'kickoff', at);
  }
  /* who runs each open task, read in one go by key; the procedure cards its refs name */
  const runBy = {};
  const procs = {};
  if (view.tasks.length) {
    /* refs as a JSON text always, so a bare string is a one item list, as tasksCiting's json_each reads it */
    for (const r of db.stmt(`SELECT label, json_extract(fields, '$.runBy') AS runBy, json_array(fields -> '$.refs') AS refs
        FROM records WHERE key IN (SELECT value FROM json_each(?))`).all(JSON.stringify(view.tasks.map((t) => t.key)))) {
      runBy[r.label] = r.runBy || null;
      /* refs stored in any shape must not fail the whole kickoff */
      let refs = [];
      try { const [v] = JSON.parse(r.refs); refs = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]; } catch { refs = []; }
      const cited = cardsCited(db, refs);
      if (cited.length) procs[r.label] = cited;
    }
  }
  /* each due item owed here carries the board's call */
  const inbox = inboxOffers(db, projectInbox(db, wsKey, dayOf(new Date(nowMs))), { held: trackKey, wsKey });
  return {
    view, handoff: h, waits, carried, answers, stalls, decisions, legBegan: leg.since, runBy, procs, reader, now: nowMs, lastHandoff: last ? { id: last.label, status: last.status } : null,
    goal: goalOf(rec), goalRestated: goalRestatedOf(db, rec), notes: notesSinceHandoff(db, trackKey), checkpoint: checkpointOf(db, trackKey, view),
    growth: h ? growthLines(db, h.growth, { held: trackKey, day: dayOf(new Date(nowMs)), inbox }) : [],
    inbox, leaves: openLeaves(db, trackKey, view), untaken: untakenTracks(db, wsKey, trackKey, null, nowMs),
    workstream: workstreamHead(wsRec, db),
  };
}

/* A track's workstream as the PC places its handoff folder (the kickoff, and a
   handoff write's folder check); null for none. With `db`, the profiles
   carrying its rules too. */
export function workstreamHead(wsRec, db) {
  if (!wsRec) return null;
  const at = handoffAtOf(wsRec.fields);
  const rules = db ? ruleProfilesOf(db, wsRec) : [];
  return {
    id: wsRec.fields.id, name: wsRec.fields.name, handoff: wsRec.fields.handoff || null,
    projectRepos: Array.isArray(wsRec.fields.projectRepos) ? wsRec.fields.projectRepos : [],
    handoffDir: at && at.dir ? at.dir : null, ...(at && at.project ? { handoffAt: { project: at.project, rel: at.rel } } : {}),
    ...(rules.length ? { ruleProfiles: rules } : {}),
  };
}

/* "the orchestrator", "the fork", "an Opus agent" */
export function runByWords(v) {
  if (v === 'orchestrator' || v === 'fork') return 'the ' + v;
  const m = /^agent:(.+)$/.exec(String(v || ''));
  if (!m) return String(v || '');
  const model = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  return (/^[aeiou]/i.test(model) ? 'an ' : 'a ') + model + ' agent';
}
/* only a runner that is named is said; "not named" on every line is noise */
const runOf = (k, id) => (k.runBy && k.runBy[id] ? ', run by ' + runByWords(k.runBy[id]) : '')
  + (k.procs && k.procs[id] ? ', procedure ' + k.procs[id].map((c) => citedWords(c, { reasons: false })).join('; ') : '');

/* The index's sets in its order, each row by the task's word, with counts and ages and no step text. */
const INDEX = [
  ['Unconfirmed', (w) => w.is === 'unconfirmed'],
  ['To settle', (w) => w.is === 'ready' && w.next === 'settle'],
  ['To continue', (w) => w.is === 'ready' && w.next === 'continue'],
  ['Ready to start', (w) => w.is === 'ready' && w.next === 'start'],
  ['Running', (w) => w.is === 'running'],
];
const agoOf = (k, at) => (ms(at) === null ? '' : ageText(k.now - ms(at)));
const stepsOf = (t) => { const p = t.progress; return p ? (p.done ? p.done + ' of ' : '') + p.total + (p.total === 1 && !p.done ? ' step' : ' steps') : ''; };
const readyOf = (k, t) => (t.word.is === 'ready' ? agoOf(k, t.word.since) : '');
/* what every row of a set says alike goes once in its head ("each 5 steps, ready 2d") */
function sharedOf(k, list) {
  const alike = (f) => { const s = new Set(list.map(f)); return list.length > 1 && s.size === 1 ? [...s][0] : ''; };
  return { steps: alike(stepsOf), ready: alike((t) => readyOf(k, t)) };
}
function indexRow(k, t, shared = {}) {
  const w = t.word;
  const who = whoWords(w, k.now, k.reader);
  const steps = shared.steps ? '' : stepsOf(t);
  const ready = !shared.ready && readyOf(k, t) ? 'ready ' + readyOf(k, t) : '';
  const bits = w.is === 'unconfirmed' ? [who] : w.is === 'running' ? [who + (agoOf(k, w.since) ? ', running ' + agoOf(k, w.since) : '')] : [who, steps, ready];
  /* a row with a run behind it says who already; only its procedure cards ride it */
  const inner = bits.filter(Boolean).join(', ') + runOf(w.is === 'ready' ? k : { procs: k.procs }, t.id);
  return t.id + ' ' + one(t.name) + (inner ? ' (' + inner.replace(/^, /, '') + ')' : '');
}
const taskLine = (t) => t.id + ' ' + one(t.name) + (t.progress ? ' (' + t.progress.text + ')' : '');
/* a row's waits, each id with its name, those not named above first, past three counted */
const WAITS_MAX = 3;
function waitsWords(words, nameOf, above) {
  const items = words.map((w) => {
    const m = /^after (T-\d+)(.*)$/.exec(w);
    if (!m) return { above: false, text: w.replace(/^after /, '') };
    const name = shortName(nameOf(m[1]));
    return { above: above.has(m[1]), text: m[1] + (name ? ' ' + name : '') + m[2] };
  });
  const num = (x) => Number((/^T-(\d+)/.exec(x.text) || [])[1]) || Infinity;
  const order = items.sort((a, b) => a.above - b.above || num(a) - num(b));
  return 'after ' + order.slice(0, WAITS_MAX).map((x) => x.text).join('; ')
    + (order.length > WAITS_MAX ? '; and ' + (order.length - WAITS_MAX) + ' more' : '');
}
/* a stamp on the day of the one before it says its clock alone, never "today" twice */
const dayPart = (w) => (w.lastIndexOf(' ') > 0 ? w.slice(0, w.lastIndexOf(' ')) : null);
const clockAfter = (w, prev) => (prev && dayPart(w) && dayPart(w) === dayPart(prev) ? w.slice(w.lastIndexOf(' ') + 1) : w);

const NOTE_MAX = 600;
const NOTES_MAX = 10;

/* The kickoff's text. `mode`: 'show' (how to resume it), 'resumed' (this session
   holds it now) or 'read only' (another session holds it); `holds`, a `track show` by its holder. */
export function kickoffText(k, { mode = 'show', holder = null, who = '', away = null, holds = false } = {}) {
  const v = k.view;
  const h = k.handoff;
  const name = one(v.name);
  const lines = [];
  if (mode === 'resumed') {
    lines.push('Track ' + v.id + ' (' + name + ') is held by this session now' + (h ? ', resumed from handoff ' + h.id : '')
      + ': do not run resume again.');
    /* the user took it on another PC than the handoff named */
    if (away) lines.push('Taken on ' + away.pc + ' although the handoff names ' + away.nextPc + ' for this leg, by the user\'s --here: tell the user which of the work here needs ' + away.nextPc + ' before starting on it.');
  } else if (mode === 'read only') {
    lines.push('Track ' + v.id + ' (' + name + '), read only: ' + (who || 'another session') + ' holds it.');
  } else {
    lines.push('Resume track ' + v.id + ' (' + name + ') with /askerdo resume ' + v.id + '; a session runs `' + CLI + ' resume ' + v.id
      + ' --session <own-id>`.');
  }
  /* a due inbox task anywhere on the project leads every kickoff, ahead of the inbox list */
  const due = dueLine(k.inbox, CLI, k.workstream);
  if (due) lines.push(due);
  lines.push('Chain: ' + v.chain + '.');
  /* the chain names the parent; where it branched is said only at a task */
  if (v.junction && v.junction.track) { if (v.junction.task) lines.push('It branched from ' + v.junction.track.id + ' at ' + v.junction.task.id + '.'); }
  else if (v.junction && v.junction.task) lines.push('It branched at ' + v.junction.task.id + '.');
  /* a track made with no goal holds its name as its description */
  const gr = k.goal && k.goalRestated;
  if (gr) lines.push('Goal, restated at handoff ' + gr.handoff + (gr.at ? ' (' + atWords(gr.at, k.now) + ')' : '') + ': ' + k.goal.replace(/[\s.]+$/, '') + '. It was: ' + one(gr.was).replace(/[\s.]+$/, '') + '.');
  else if (k.goal && k.goal !== name) lines.push('Goal: ' + k.goal.replace(/[\s.]+$/, '') + '.');
  if (k.notes && k.notes.length) {
    lines.push((k.lastHandoff || h ? 'Notes on ' + v.id + ' since its last handoff' : 'Notes on ' + v.id) + ' (' + k.notes.length + '):');
    /* a long-lived track's notes would flood the kickoff: the newest only, the rest counted */
    const left = Math.max(0, k.notes.length - NOTES_MAX);
    if (left) lines.push('(' + left + ' older ' + (left === 1 ? 'note' : 'notes') + ' left out: `' + CLI + ' show ' + v.id + ' --journal` reads them)');
    for (const n of k.notes.slice(left)) {
      const body = one(n.body);
      const cut = body.length > NOTE_MAX;
      lines.push('- ' + (n.at ? atWords(n.at, k.now) + ': ' : '') + (cut ? body.slice(0, NOTE_MAX - 3) + '... (cut; `' + CLI + ' show ' + v.id
        + ' --journal-tail ' + n.tail + '` reads it whole)' : body));
    }
  }
  if (h) {
    lines.push('Focus: ' + one(h.focus), ...(k.growth || []));
    if (h.nextPc && !away) lines.push('The handoff names ' + h.nextPc + ' as the PC its next leg runs on.');
    /* a task handed off silent is said, since what that leg knew of it is lost */
    if (Array.isArray(h.silentInHand) && h.silentInHand.length) {
      lines.push('Handed off with nothing written on ' + (h.silentInHand.length === 1 ? 'it' : 'them') + ' in the last leg: ' + h.silentInHand.map((t) => t.id + ' ' + one(t.name)).join('; ')
        + '. Read the state and whereWeWere for what that leg knew, and note what you learn on each (`' + CLI + ' note <T-n> --body "<what it holds now>" --session <own-id>`).');
    }
  }
  else if (k.lastHandoff) lines.push('No handoff yet this leg: the last one, ' + k.lastHandoff.id + ', is ' + k.lastHandoff.status + ' (`' + CLI + ' track show ' + k.lastHandoff.id + '` prints it).');
  else lines.push(v.state === 'new' ? 'A new track: no session has held it yet.' : 'No handoff yet: the tasks below are where it stands.');
  if (v.state === 'parked' && v.parkReason) lines.push('Parked because: ' + one(v.parkReason) + (v.unpark ? '; opens again ' + v.unpark : ''));
  const nameOf = viewNameOf(v);
  lines.push('Where it stands: ' + v.text + (v.stalled ? ', stalled' : '') + ' (' + v.done + ' of ' + v.total + ' done).');
  /* what has a run behind it leads, then what is ready, then what runs */
  const rows = [...v.now, ...v.readySet].filter((t) => t.word);
  const sets = INDEX.map(([head, is]) => [head, rows.filter((t) => is(t.word))]).filter(([, list]) => list.length);
  /* a parked track's ready tasks read ready by the table alone */
  if (v.state === 'parked' && v.readySet.length) lines.push('Parked: the ready tasks below start only once ' + v.id + ' opens again.');
  for (const [head, list] of sets) {
    const shared = sharedOf(k, list);
    const each = [shared.steps, shared.ready ? 'ready ' + shared.ready : ''].filter(Boolean).join(', ');
    lines.push(head + ' (' + list.length + (each ? ', each ' + each : '') + '): ' + list.map((t) => indexRow(k, t, shared)).join('; '));
  }
  if (!sets.length && v.tasks.length) lines.push('Nothing is running or ready: every open task waits on something.');
  /* the track's review readout, after Ready; its step is the holder's to lay out */
  const own = mode === 'resumed' || (mode === 'show' && Boolean(holder));
  const review = reviewLine(v.review, v.id, { before: k.checkpoint || null, lay: own || holds });
  if (review) lines.push(review);
  /* a held track's work is laid out before it starts; told only to its holder
     (resumed, or reading its own), never in a read-only kickoff of another's track */
  if (v.holder && !v.tasks.length && own) {
    lines.push('Nothing is laid out on ' + v.id + ': put its steps on it first, each with what it waits on (`' + CLI + ' track layout ' + v.id
      + ' --session <own-id> --json` reads { "steps": [...] } on stdin).');
  }
  if (v.critical.path.length) lines.push('Longest chain ' + v.critical.path.length + ': ' + namedList(v.critical.path, nameOf) + '.');
  const shown = new Set(rows.map((t) => t.id));
  const rest = v.tasks.filter((t) => !shown.has(t.id));
  if (rest.length) {
    lines.push('Then, in dependency order:');
    const above = new Set(shown);
    for (const t of rest) {
      lines.push('- ' + taskLine(t) + runOf(k, t.id) + (t.waitsOn.length ? ', ' + waitsWords(t.waitsOn, nameOf, above) : ''));
      above.add(t.id);
    }
  }
  /* the same ask as the handoff's result, to the holder alone */
  if (own && k.leaves && k.leaves.length) lines.push(leavesLine(k.leaves, v.id));
  if (v.sideTracks.length) lines.push('Side tracks: ' + v.sideTracks.map((s) => s.id + ' (' + s.state + ')').join(', '));
  if (k.stalls.length) {
    lines.push('Stalled in ' + (k.workstream ? k.workstream.id : 'the workstream') + ': '
      + k.stalls.map((s) => s.id + ' ' + one(s.name) + ' (' + s.state + (s.parkReason ? ': ' + one(s.parkReason) : '') + ')').join('; '));
  }
  const untaken = untakenLine(k.untaken, k.workstream);
  if (untaken) lines.push(untaken);
  /* the project's inboxes, not the workstream's alone, since a task can be filed in the wrong one */
  if (own) lines.push(...inboxLines(k.inbox, CLI, k.workstream, { calls: !due }));
  /* a question answered since the handoff no longer waits; one still open is listed once */
  const listed = k.answers.map((a) => a.id).concat(k.waits.map((q) => q.id));
  const carried = (k.carried || waitingOf(h)).filter((w) => !listed.some((id) => mentions(w, id)));
  const waits = k.waits.map((q) => q.id + ' ' + one(q.name) + (q.blocking ? ' (blocking)' : ''));
  lines.push('Waiting on the user: ' + (waits.length || carried.length ? waits.concat(carried.map(one)).join('; ') : 'nothing'));
  /* a carried item can be done already, and repeating it costs the user a look */
  if (carried.length) lines.push('Check each item the handoff carried against the app or the board before repeating it to the user; it may be done already.');
  if (k.answers.length) {
    /* the board knows when the handoff was written, never what a session heard */
    lines.push('Answered since the handoff was written:');
    for (const a of k.answers) lines.push('- ' + a.id + ' (' + one(a.name) + '): ' + (one(a.answer) || 'answered'));
  }
  if (k.decisions && k.decisions.length) {
    /* when the leg began and each ruling's local time, so one made before it reads apart */
    const began = k.legBegan ? atWords(k.legBegan, k.now) : '';
    lines.push('Decisions made or amended since the last leg began' + (began ? ' ' + began : '') + ' (' + k.decisions.length + '):');
    for (const d of k.decisions) {
      const made = d.created ? atWords(d.created, k.now) : '';
      const when = [made ? clockAfter(made, began) : '', d.amended ? 'amended ' + clockAfter(atWords(d.amended, k.now), made || began) : ''].filter(Boolean).join(', ');
      lines.push('- ' + d.id + ' ' + one(d.name) + (when ? ' (' + when + ')' : ''));
    }
  }
  /* the handoff's rulings stay only as the fallback for a board that could not be reached */
  const open = h ? (h.rulings || []).filter((r) => !r.registered) : [];
  if (open.length) {
    /* one stop at the end, whatever punctuation a ruling's own text ends with */
    lines.push('Rulings made in chat, not yet registered (' + open.length + '): ' + open.map((r) => r.id + ': ' + one(r.text).replace(/[\s.;:,!?]+$/, '')).join('; ')
      + '. Record each with decide (the decide tool, or `' + CLI + ' decide --session <own-id>` with its JSON on stdin), then mark it in the next handoff as { id, registered: <its K-n> }.');
  }
  const ws = k.workstream;
  if (ws) lines.push(readLine(ws));
  if (h) {
    if (h.status === 'parked' && h.parkReason && h.parkReason !== v.parkReason) lines.push('The handoff was parked because: ' + one(h.parkReason));
    lines.push('', 'The state (handoff ' + h.id + '):', '', h.state);
    if (h.whereWeWere) lines.push('', 'Where we were (the previous session, in its own words):', '', h.whereWeWere);
    if (h.fromSession) lines.push('', previousLine(h.fromSession));
  }
  return lines.join('\n');
}
