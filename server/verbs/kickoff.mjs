/* The kickoff: what a session reads first on a
   track. kickoffInput gathers it from the database; kickoffText is pure. The
   task list always comes from the tables: a handoff adds the thinking and
   never retells the list. */
import { clockOf, stampNow } from '../records.mjs';
import { loadRecord } from './graph.mjs';
import { noteRead } from './history.mjs';
import { NEWEST_FIRST, isStalled, openLeaves, projectInbox, stateOf, trackView } from './tracks.mjs';
import { addedLine, growthLine, servesView } from './outcomes.mjs';
import { decisionsSince } from './decisions.mjs';
import { loadProfiles } from './profiles.mjs';
import { atWords, holderWords } from '../web/feed.mjs';
import { LEFT_WORDS } from '../web/draw.mjs';
import { namedList, shortName, viewNameOf } from '../web/graph.mjs';
import { CLI, inboxLines, leavesLine, waitingOf } from '../handoff-text.mjs';

export { CLI, inboxLines };

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const ms = (s) => { const n = Date.parse(String(s || '')); return Number.isFinite(n) ? n : null; };

/* the transcript path is measured; it lives on the machine that ran the session. */
export const previousLine = (sid) => 'Previous session: ' + sid + '. Its transcript is ~/.claude/projects/<its project folder>/' + sid
  + '.jsonl on the machine it ran on (`ls ~/.claude/projects/*/' + sid + '.jsonl` finds it); read only its last turns,'
  + ' and only when this handoff leaves something unclear.';

/* An item that names question Qn (Q-n too), as a word. */
const mentions = (text, id) => {
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
export function growthLines(db, g) {
  if (!g) return [];
  const added = String(g.added || '').split(/\s+/).filter(Boolean).map((k) => loadRecord(db, k)).filter(Boolean).map((t) => {
    const ws = t.fields.workstream ? loadRecord(db, t.fields.workstream) : null;
    return { id: t.fields.id, name: t.fields.name, view: servesView(ws && ws.fields.outcomes, t.fields.serves) };
  });
  return [growthLine(g), addedLine(added, g.since)].filter(Boolean);
}

/* The track's questions (a question belongs to its track) and those gating one of its tasks;
   one that names no track at all stays with its workstream. */
function questionsOf(db, trackKey, wsKey, where) {
  return db.stmt(`SELECT q.key, q.label, q.title, q.fields, q.status FROM records q WHERE q.kind = 'question' AND ${where}
    AND (coalesce(json_extract(q.fields, '$.track'), q.track) = ?
      OR (coalesce(json_extract(q.fields, '$.track'), q.track, '') = '' AND q.workstream = ?)
      OR EXISTS (SELECT 1 FROM links l JOIN track_items ti ON ti.track = ?
      WHERE l."from" = q.key AND l.type = 'gates' AND (l."to" = ti.task OR l."to" IN (SELECT label FROM labels WHERE key = ti.task))))
    ORDER BY q.id`).all(trackKey, wsKey || '', trackKey).map((r) => ({ ...r, fields: JSON.parse(r.fields) }));
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
    return { id: r.label, name: r.title, answer: note ? note.body : '' };
  });
}

/* Everything the renderer needs, in one read. `h` is the handoff the kickoff
   carries (the live one, else null); `opts.now` is the clock. `opts.viewer`:
   the asking session, for the wording alone; `opts.reader` also marks the rulings read. */
export function kickoffInput(db, trackKey, h, opts) {
  /* the view reads a started task no live hand backs as stale, the reader's own hand live */
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
  const last = h ? null : db.stmt('SELECT label, status FROM handoffs WHERE track = ? ORDER BY ' + NEWEST_FIRST + ' LIMIT 1').get(trackKey);
  /* read from the board, never from the handoff, so a resume carries every decision */
  const leg = decisionsSince(db, { track: trackKey, handoff: h ? h.key || h.id : undefined });
  const ruled = leg.decisions;
  const decisions = ruled.map((d) => ({ id: d.id, name: d.name, created: d.created, ...(d.amended ? { amended: d.amended } : {}) }));
  /* a session's kickoff is a read of each ruling it lists */
  if (opts && opts.reader) {
    const at = stampNow(clockOf(opts));
    for (const d of ruled) noteRead(db, loadRecord(db, d.key), opts.reader, 'kickoff', at);
  }
  /* who runs each open task, read in one go by key */
  const runBy = {};
  if (view.tasks.length) {
    for (const r of db.stmt(`SELECT label, json_extract(fields, '$.runBy') AS runBy FROM records WHERE key IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(view.tasks.map((t) => t.key)))) runBy[r.label] = r.runBy || null;
  }
  return {
    view, handoff: h, waits, answers, stalls, decisions, legBegan: leg.since, runBy, reader, now: nowMs, lastHandoff: last ? { id: last.label, status: last.status } : null,
    growth: h ? growthLines(db, h.growth) : [],
    inbox: projectInbox(db, wsKey), leaves: openLeaves(db, trackKey, view),
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

/* the handoff's tasks in hand, given back, and any another session took meanwhile */
function handLine(hand, now) {
  if (!hand || (!hand.given.length && !hand.kept.length)) return null;
  const kept = hand.kept.map((t) => t.id + ' stays with ' + holderWords(t.holder, { now }) + ', which took it in hand meanwhile');
  return 'In hand again: ' + (hand.given.length ? hand.given.map((t) => t.id + ' ' + one(t.name)).join('; ') : 'none')
    + (kept.length ? '. ' + kept.join('; ') : '') + '.';
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
const runOf = (k, id) => (k.runBy && k.runBy[id] ? ', run by ' + runByWords(k.runBy[id]) : '');

const taskLine = (t) => t.id + ' ' + one(t.name) + (t.progress ? ' (' + t.progress.text + (t.pointer ? ' on ' + t.pointer : '') + ')' : '');
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
/* an agent by name; a session as this one or a session, never its raw id */
const tagOf = (n, reader) => (n.agent ? ' by ' + n.agent : n.session ? (n.session === reader ? ' by this session' : ' by a session') : '');

/* The kickoff's text. `mode`: 'show' (how to resume it), 'resumed' (this session
   holds it now) or 'read only' (another session holds it). */
export function kickoffText(k, { mode = 'show', holder = null, hand = null, who = '' } = {}) {
  const v = k.view;
  const h = k.handoff;
  const name = one(v.name);
  const lines = [];
  if (mode === 'resumed') {
    lines.push('Track ' + v.id + ' (' + name + ') is held by this session now' + (h ? ', resumed from handoff ' + h.id : '')
      + ': do not run resume again.');
    const held = handLine(hand, k.now);
    if (held) lines.push(held);
  } else if (mode === 'read only') {
    lines.push('Track ' + v.id + ' (' + name + '), read only: ' + (who || 'another session') + ' holds it.');
  } else {
    lines.push('Resume track ' + v.id + ' (' + name + ') with /askerdo resume ' + v.id + '; a session runs `' + CLI + ' resume ' + v.id
      + ' --session <own-id>`.');
  }
  lines.push('Chain: ' + v.chain + '.');
  /* the chain names the parent; where it branched is said only at a task */
  if (v.junction && v.junction.track) { if (v.junction.task) lines.push('It branched from ' + v.junction.track.id + ' at ' + v.junction.task.id + '.'); }
  else if (v.junction && v.junction.task) lines.push('It was promoted from ' + v.junction.task.id + '.');
  if (h) lines.push('Focus: ' + one(h.focus), ...(k.growth || []));
  else if (k.lastHandoff) lines.push('No handoff yet this leg: the last one, ' + k.lastHandoff.id + ', is ' + k.lastHandoff.status + ' (`' + CLI + ' track show ' + k.lastHandoff.id + '` prints it).');
  else lines.push(v.state === 'new' ? 'A new track: no session has held it yet.' : 'No handoff yet: the tasks below are where it stands.');
  if (v.state === 'parked' && v.parkReason) lines.push('Parked because: ' + one(v.parkReason) + (v.unpark ? '; opens again ' + v.unpark : ''));
  /* a started task no live hand backs (the view's stale) goes to the list below */
  const stale = new Set((v.stale || []).map((n) => n.id));
  const now = v.now;
  const nameOf = viewNameOf(v);
  lines.push('Where it stands: ' + v.text + (v.stalled ? ', stalled' : '') + ' (' + v.done + ' of ' + v.total + ' done).');
  lines.push('Now: ' + (now.length ? now.map((n) => n.id + ' ' + one(n.name) + tagOf(n, k.reader)).join('; ') : 'nothing running'));
  lines.push('Ready (' + v.readySet.length + '): ' + (v.readySet.length ? v.readySet.map((t) => t.id + ' ' + one(t.name) + runOf(k, t.id)).join('; ') : 'nothing'));
  /* a held track's work is laid out before it starts; told only to its holder
     (resumed, or reading its own), never in a read-only kickoff of another's track */
  const own = mode === 'resumed' || (mode === 'show' && Boolean(holder));
  if (v.holder && !v.tasks.length && own) {
    lines.push('Nothing is laid out on ' + v.id + ': put its steps on it first, each with what it waits on (`' + CLI + ' track layout ' + v.id
      + ' --session <own-id> --json` reads { "steps": [...] } on stdin).');
  }
  if (v.critical.path.length) lines.push('Longest chain ' + v.critical.path.length + ': ' + namedList(v.critical.path, nameOf) + '.');
  const shown = new Set([...now.map((n) => n.id), ...v.readySet.map((t) => t.id)]);
  const rest = v.tasks.filter((t) => !shown.has(t.id));
  if (rest.length) {
    lines.push('Then, in dependency order:');
    const above = new Set(shown);
    for (const t of rest) {
      lines.push('- ' + taskLine(t) + (stale.has(t.id) ? ', ' + LEFT_WORDS : '') + runOf(k, t.id) + (t.waitsOn.length ? ', ' + waitsWords(t.waitsOn, nameOf, above) : ''));
      above.add(t.id);
    }
  }
  const withSteps = v.tasks.filter((t) => shown.has(t.id) && t.progress);
  if (withSteps.length) lines.push('Checklists: ' + withSteps.map((t) => t.id + ' ' + t.progress.text + (t.pointer ? ' on ' + t.pointer : '')).join('; '));
  /* the same ask as the handoff's result, to the holder alone */
  if (own && k.leaves && k.leaves.length) lines.push(leavesLine(k.leaves, v.id));
  if (v.sideTracks.length) lines.push('Side tracks: ' + v.sideTracks.map((s) => s.id + ' (' + s.state + ')').join(', '));
  if (k.stalls.length) {
    lines.push('Stalled in ' + (k.workstream ? k.workstream.id : 'the workstream') + ': '
      + k.stalls.map((s) => s.id + ' ' + one(s.name) + ' (' + s.state + (s.parkReason ? ': ' + one(s.parkReason) : '') + ')').join('; '));
  }
  /* the project's inboxes, not the workstream's alone, since a task can be filed in the wrong one */
  if (own) lines.push(...inboxLines(k.inbox));
  /* a question answered since the handoff no longer waits; one still open is listed once */
  const listed = k.answers.map((a) => a.id).concat(k.waits.map((q) => q.id));
  const carried = waitingOf(h).filter((w) => !listed.some((id) => mentions(w, id)));
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
    lines.push('Decisions since the last leg began' + (began ? ' ' + began : '') + ' (' + k.decisions.length + '):');
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
