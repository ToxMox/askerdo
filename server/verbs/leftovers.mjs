/* The steps left at a checkpoint, each laid out as a task inside the caller's transaction:
   a handoff's and a task's as it closes, through the one layout. */
import { actorOf, addNote, labelOf } from '../records.mjs';
import { RUN_BY_HINT, leftAtClose, runByOf, stepAt } from '../handoff-text.mjs';
import { TrackRefusal, loadRecord } from './graph.mjs';
import { resolveRecord } from './labels.mjs';
import { LAID, askFiling, capture, inboxLacks, ladderPlace, landedTier, laterTrack, layOut, ownTrackLacks, parkTrack, policedHeld, realBefore, settlePlace } from './tracks.mjs';
import { isNextSession, wakeOf } from './upkeep.mjs';
import { editRecord } from './work.mjs';

/* the task a step names is on the track: by its live holder, never an archived record that held the label */
const onTrack = (db, trackKey, task) => {
  const e = resolveRecord(db, String(task).trim(), { kinds: ['task'] });
  return Boolean(e && db.stmt('SELECT 1 FROM track_items WHERE track = ? AND task = ?').get(trackKey, e.key));
};
const isRefusal =(e) => !!e && (e.name === 'TrackRefusal' || (e.constructor && e.constructor.name === 'UsageError'));
const INBOX_KEYS = ['name', 'task', 'description', 'priority', 'runBy', 'unplaced', 'wake', 'whyElsewhere'];

/* Each leftover laid out on its own, its after numbers turned into the ids laid out before it, so a
   refusal names its step. Each names who runs it. One naming
   newTrack goes on a new track of that name, parked until its unparkWhen. `home`: track (the record a
   plain step goes on, or null), workstream (a new track's or the inbox's), why (a new track's park
   reason), from (what left them), inbox (a close's step may go to the inbox, unplaced with its wake),
   follows (a close's task, which a step on its track with no after waits on), via (close, moveSteps or handoff) and
   closing (the key of the task they leave, which nothing-else-open leaves out). A step at a real place on the
   held track is filed; one last or off it is asked of the user, its entry { step, name, asked }, and the call lands. */
export function layLeftovers(db, home, steps, actor) {
  const { track, session } = home;
  if (!Array.isArray(steps)) throw new TrackRefusal('leftovers is a list of steps: { name, description, task, after, before, runBy }');
  /* a new task says its own job; no fallback text (a close note, a state section) says what done looks like */
  steps.forEach((s, i) => {
    if (s && typeof s === 'object' && s.task === undefined && (typeof s.description !== 'string' || !s.description.trim())) {
      throw new TrackRefusal(stepAt('leftovers', i, s) + ': description says the job the new task holds and what done looks like, for whoever takes it next');
    }
  });
  const out = [];
  const fresh = new Map();
  const c = actorOf(actor);
  const heldRec = policedHeld(db, c);
  const onHeld = (task) => heldRec && onTrack(db, heldRec.key, task);
  /* a step is at a real place through its own before, or a later step with one that waits on it */
  const real = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (!heldRec || !s || typeof s !== 'object') { real[i] = false; continue; }
    const later = steps.some((o, j) => j > i && o && Array.isArray(o.after) && o.after.includes(i + 1) && real[j]);
    real[i] = s.tier === undefined && s.task !== undefined ? onHeld(s.task) : later || realBefore(db, heldRec, s.before, null, false);
  }
  const skip = () => new Set([home.closing, ...out.map((o) => o.key)].filter(Boolean));
  steps.forEach((s, i) => {
    const at = stepAt('leftovers', i, s) + ': ';
    if (!s || typeof s !== 'object' || !runByOf(s.runBy)) throw new TrackRefusal(at + 'runBy names who runs it: ' + RUN_BY_HINT);
    /* a step names its tier, unless it names a task already on the track and places nothing */
    const stays = s.task !== undefined && track && ['newTrack', 'unparkWhen', 'track', 'workstream', 'unplaced', 'wake', 'tier'].every((k) => s[k] === undefined)
      && onTrack(db, track.key, s.task);
    let lad = null;
    try {
      lad = stays ? null : ladderPlace(db, { ...s, name: s.name || s.task }, c,
        { via: 'leftover', task: s.task, taskWs: home.workstream, marked: Boolean(heldRec), steps, laterReal: real[i], skip: skip() });
      if (lad && lad.ask) {
        /* the question outlives this call, so a step named by its number is named by its id */
        const n = /^\s*task-completes\s+(\d+)\s*$/i.exec(typeof s.unparkWhen === 'string' ? s.unparkWhen : '');
        if (n && !(Number(n[1]) >= 1 && Number(n[1]) <= i && out[Number(n[1]) - 1].id)) {
          throw new TrackRefusal('unparkWhen names leftover ' + n[1] + ', which is not an earlier step filed in this call: name its event by T-n');
        }
        const sent = n ? { ...s, unparkWhen: 'task-completes ' + out[Number(n[1]) - 1].id } : s;
        out.push({ step: i + 1, name: s.name || s.task, asked: askFiling(db, sent, c, s.task !== undefined ? { task: s.task.trim() } : { draft: s }, { via: home.via || 'close', task: home.from, step: i + 1 }, skip()) });
        return;
      }
    } catch (e) {
      if (!isRefusal(e)) throw e;
      throw new TrackRefusal(at + e.message, e.data);
    }
    if (lad && lad.inbox) {
      out.push({ ...toInbox(db, { ...home, workstream: lad.inbox.ws }, { ...(s.task !== undefined ? { task: s.task } : { name: s.name }), description: s.description, priority: s.priority, runBy: s.runBy,
        unplaced: lad.inbox.unplaced || 'filed at tier ' + lad.tier + ' into the inbox of ' + labelOf(db, lad.inbox.ws) + ' until its wake', wake: lad.inbox.wake,
        ...(lad.whyElsewhere ? { whyElsewhere: lad.whyElsewhere } : {}) }, at, actor, lad.tier), step: i + 1 });
      return;
    }
    /* a step for the next session stays on its own track, waiting there */
    const next = lad ? Boolean(lad.nextSession) : isNextSession(s.wake) && s.unplaced === undefined;
    if (next && !session) throw new TrackRefusal(at + 'wake next-session waits for a session other than the one that leaves the step, and this call names no session');
    if (!lad && home.inbox && (s.unplaced !== undefined || (s.wake !== undefined && !next))) {
      out.push({ ...toInbox(db, home, s, at, actor), step: i + 1 });
      return;
    }
    let after;
    if (Array.isArray(s.after)) {
      after = s.after.map((a) => {
        if (typeof a === 'string' && /^T-\d+$/.test(a.trim())) return a.trim();
        if (Number.isInteger(a) && a >= 1 && a <= i && out[a - 1].asked && !out[a - 1].id) throw new TrackRefusal(at + 'after names step ' + a + ', which is asked of the user (' + out[a - 1].asked.id + '), so nothing is made for it yet');
        if (Number.isInteger(a) && a >= 1 && a <= i) return out[a - 1].id;
        throw new TrackRefusal(at + 'after names ' + JSON.stringify(a) + ': a T-n id, or the number of an earlier step' + (i ? ' (1 to ' + i + ')' : ', and this is the first'));
      });
    }
    const { newTrack: named, unparkWhen, tier: _tier, track: _track, workstream: _ws, whyElsewhere: _why, ...one } = { ...s, ...(after ? { after } : {}) };
    if (next) delete one.wake;
    if (!lad && named === undefined && !track) throw new TrackRefusal(at + home.from + ' is on no track, so each leftover names its home: newTrack with unparkWhen, or unplaced with its wake');
    const on = lad ? lad.track || laterTrack(db, lad.park.ws, fresh, lad.park.name || s.name || String(s.task), lad.park.when, at, actor)
      : named === undefined ? track : laterTrack(db, home.workstream, fresh, named, unparkWhen, at, actor);
    if (next && !lad && on !== track) throw new TrackRefusal(at + 'wake next-session keeps the step on ' + (track ? track.fields.id : 'its own track') + ': leave out newTrack');
    /* a close's step on its own track with no after follows the closing task */
    /* the ladder loads its own copy of the track, so the two are compared by key */
    const same = Boolean(track) && on.key === track.key;
    const step = home.follows && same && !stays && one.after === undefined ? { ...one, after: [home.follows] } : one;
    try {
      const laid = layOut(db, { track: on.key, steps: [step], session, nextSession: next, [LAID]: true, skip: [...skip()] }, actor).steps[0];
      const settled = stays ? {} : settlePlace(db, laid.key, { ...(lad || { tier: landedTier(db, laid.key, session) }), ...(next ? { nextSession: true } : {}) }, actor, session ? { defaulted: laid.default || null } : {});
      out.push(same ? { ...laid, ...settled, step: i + 1 } : { ...laid, ...settled, step: i + 1, track: on.fields.id });
    } catch (e) {
      if (!isRefusal(e)) throw e;
      /* the layout names its one step as step 1; the leftover's own number stands in */
      const m = String(e.message), inner = stepAt('steps', 0, step) + ': ';
      throw new TrackRefusal(at + (m.startsWith(inner) ? m.slice(inner.length) : m.replace(/^step 1\b\.?\s*/, '')), e.data);
    }
  });
  /* parked once every step is laid, so "task-completes 2" can name a leftover by its number */
  const parked = [...fresh.values()].map((f) => {
    const n = /^\s*task-completes\s+(\d+)\s*$/i.exec(f.when);
    if (n && !(Number(n[1]) >= 1 && Number(n[1]) <= out.length)) throw new TrackRefusal(f.at + 'unparkWhen names leftover ' + n[1] + ', and there are ' + out.length);
    if (n && !out[Number(n[1]) - 1].id) throw new TrackRefusal(f.at + 'unparkWhen names leftover ' + n[1] + ', which is asked of the user, so nothing is made for it yet');
    const when = n ? 'task-completes ' + out[Number(n[1]) - 1].id : f.when;
    let r;
    try {
      r = parkTrack(db, { track: f.rec.key, reason: home.why, unparkWhen: when }, actor);
    } catch (e) {
      if (!isRefusal(e)) throw e;
      throw new TrackRefusal(f.at + e.message, e.data);
    }
    return { id: r.id, name: f.rec.fields.name, unpark: r.unpark };
  });
  return { steps: out, parked };
}

/* A close's step for work no plan reaches yet goes to the inbox through every inbox filing's refusals,
   worded in the step's fields. */
function toInbox(db, home, s, at, actor, tier) {
  const extra = Object.keys(s).filter((k) => !INBOX_KEYS.includes(k));
  if (extra.some((k) => k === 'newTrack' || k === 'unparkWhen')) throw new TrackRefusal(at + 'a step goes on a new track (newTrack) or into the inbox (unplaced), not both');
  if (extra.some((k) => k === 'after' || k === 'before')) throw new TrackRefusal(at + 'after and before order steps on a track, and an inbox step has none around it');
  if (extra.length) throw new TrackRefusal(at + 'an inbox step does not take ' + extra.join(', ') + ' (it takes ' + INBOX_KEYS.join(', ') + ')');
  if (typeof s.unplaced !== 'string' || !s.unplaced.trim()) throw new TrackRefusal(at + 'unplaced is why no plan reaches the work, a line of text, and goes with its wake');
  const c = actorOf(actor);
  const where = { via: 'leftover', track: home.track ? home.track.fields.id : null };
  const no = inboxLacks(s.unplaced, s.wake, where) || ownTrackLacks(db, s.wake, c.session, where);
  if (no) throw new TrackRefusal(at + no);
  try {
    wakeOf(db, s.wake, c.day, null, 'leftover');
    const r = capture(db, { workstream: home.workstream ? labelOf(db, home.workstream) : null, ...(s.task !== undefined ? { task: s.task.trim() } : { name: s.name }),
      description: s.description, priority: s.priority, unplaced: s.unplaced, wake: s.wake, ...(tier !== undefined ? { tier } : {}), ...(s.whyElsewhere !== undefined ? { whyElsewhere: s.whyElsewhere } : {}) }, actor);
    const runBy = runByOf(s.runBy);
    editRecord(db, { id: r.key, kind: 'task', runBy }, actor);
    return { id: r.id, key: r.key, name: r.name, created: r.created, runBy, inbox: true, unplaced: r.unplaced, wake: r.wake || null, ...(r.asked ? { asked: r.asked } : {}), edges: [],
      ...(r.tier !== undefined ? { tier: r.tier, ladder: r.ladder } : {}) };
  } catch (e) {
    if (!isRefusal(e)) throw e;
    throw new TrackRefusal(at + e.message, e.data);
  }
}

/* A closing task's leftovers, so nothing found while doing it is left in its closing note: a step
   goes on the task's own track, on a new parked track, or into the inbox with its wake. */
export function leaveOnClose(db, taskKey, steps, actor) {
  const task = loadRecord(db, taskKey);
  const row = db.stmt('SELECT track FROM track_items WHERE task = ?').get(taskKey);
  const track = row ? loadRecord(db, row.track) : null;
  const id = task.fields.id;
  const lay = layLeftovers(db, { track, workstream: task.fields.workstream || (track && track.fields.workstream) || null, from: id,
    why: 'work for later, left by ' + id + ' as it closed', inbox: true, follows: id, via: 'close', closing: taskKey, session: actorOf(actor).session }, steps, actor);
  const opens = new Map(lay.parked.map((p) => [p.id, p.unpark]));
  const out = lay.steps.map((t) => (t.asked && !t.id ? { name: t.name, asked: t.asked } : { id: t.id, name: t.name, created: t.created !== false, ...(t.tier !== undefined ? { tier: t.tier, ladder: t.ladder } : {}),
    ...(t.inbox ? { inbox: true, wake: t.wake, ...(t.asked ? { asked: t.asked } : {}) } : { track: t.track || track.fields.id, ...(opens.has(t.track) ? { parked: true, opens: opens.get(t.track) } : {}) }) }));
  const c = actorOf(actor);
  addNote(db, taskKey, { at: c.at, actor: c.by, body: leftAtClose(out.map((t) => (t.id ? t.id + (t.inbox ? ' in the inbox' : ' on ' + t.track + (t.parked ? ' (parked)' : ''))
    : '"' + t.name + '" asked of the user as ' + t.asked.id))) });
  return out;
}
