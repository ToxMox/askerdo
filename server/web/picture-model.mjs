/* The redrawn workstream picture's data, P: one shape the board and the pane
   draw from, built from the track views and
   the picture verbs' extras. Pure: the mod runs it too, so it imports only the pure graph. */
import { graphOf, viewLook } from './graph.mjs';
import { endedOf, endedParts } from './draw.mjs';

const DAY = 86400000;
const LOOK_DAYS = 30;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* "Oct 21" from a stamp's own date, as its writer's clock read it */
export function dayWords(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(stamp || ''));
  return m ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) : '';
}

/* the name before its first " (" or ": ", when that leaves a name of its own */
export function shortOf(name) {
  const s = String(name || '');
  const m = /^(.{10,}?)(?: \(|: )/.exec(s);
  return m ? m[1] : s;
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const list = (v) => (Array.isArray(v) ? v : []);
const arr = (v) => [].concat(v || []).filter(Boolean);

/* Section 3: the longest chain of open tasks over their waits plus each parked track's unpark
   condition: track-ends TR-a makes the parked track's first tasks wait on TR-a's last ones,
   task-completes T-m on T-m. `views` (trackView rows) stand in for `tasks` ({ id, tr, deps, zero }).
   A tie goes as the track page's (server/verbs/graph.mjs): the first in `tasks` order, each `deps` in the board's order. */
export function critOf({ views, tasks, parks = [] } = {}) {
  const rows = tasks || critTasks(views || []);
  const by = new Map(rows.map((t) => [t.id, t]));
  const deps = new Map(rows.map((t) => [t.id, list(t.deps).filter((d) => by.has(d) && d !== t.id)]));
  const onTrack = (tr) => rows.filter((t) => t.tr === tr);
  for (const p of parks) {
    if (!p || !p.tr) continue;
    const heads = onTrack(p.tr).filter((t) => !deps.get(t.id).some((d) => by.get(d).tr === p.tr));
    let ons = [];
    if (p.kind === 'track-ends' && p.on !== p.tr) {
      const theirs = onTrack(p.on);
      ons = theirs.filter((t) => !theirs.some((u) => deps.get(u.id).includes(t.id))).map((t) => t.id);
    } else if (p.kind === 'task-completes' && by.has(p.on)) ons = [p.on];
    /* a park that closes a loop of parks is cut there, so the path starts at a track's start */
    for (const h of heads) deps.set(h.id, [...new Set([...deps.get(h.id), ...ons.filter((o) => o !== h.id && !reaches(deps, o, h.id))])]);
  }
  const memo = new Map();
  const on = new Set();
  const chain = (id) => {
    if (memo.has(id)) return memo.get(id);
    /* a loop through park conditions adds nothing */
    if (on.has(id)) return { len: 0, path: [] };
    on.add(id);
    let best = { len: 0, path: [] };
    for (const d of deps.get(id)) { const r = chain(d); if (r.len > best.len) best = r; }
    on.delete(id);
    const own = by.get(id).zero ? 0 : 1;
    const out = { len: best.len + own, path: own ? [...best.path, id] : best.path };
    memo.set(id, out);
    return out;
  };
  let best = { len: 0, path: [] };
  for (const t of rows) { const r = chain(t.id); if (r.len > best.len) best = r; }
  return { n: best.len, from: best.path[0] || null, to: best.path[best.path.length - 1] || null, path: best.path };
}

/* whether `from` waits, through any chain of waits, on `to` */
function reaches(deps, from, to) {
  const seen = new Set();
  const walk = (id) => id === to || (!seen.has(id) && (seen.add(id), (deps.get(id) || []).some(walk)));
  return walk(from);
}

/* the open tasks of trackView rows with their open waits, each track's by position; a promoted task adds no length */
function critTasks(tvs) {
  const open = new Set();
  for (const tv of tvs) for (const t of list(tv.tasks)) open.add(t.id);
  const out = [];
  for (const tv of tvs) {
    const deps = {};
    for (const e of list(tv.edges)) if (!e.done && open.has(e.on)) (deps[e.task] = deps[e.task] || []).push(e.on);
    for (const t of byPosition(list(tv.tasks))) out.push({ id: t.id, tr: tv.id, deps: deps[t.id] || [], ...(t.pointer ? { zero: true } : {}) });
  }
  return out;
}

/* a track's tasks in its own order (trackView's position), which views list by column first */
const byPosition = (ts) => ts.map((t, i) => ({ t, p: Number.isFinite(t.position ?? t.pos) ? (t.position ?? t.pos) : Infinity, i }))
  .sort((a, b) => a.p - b.p || a.i - b.i).map((x) => x.t);

/* a track's park words: "parked: after Beacons", "parked: until T-326 completes" */
function parkedWords(u, nameOf) {
  if (!u) return 'parked';
  if (u.kind === 'track-ends') return 'parked: after ' + (nameOf(u.on) || u.onName || u.on);
  return 'parked: until ' + u.on + (u.kind === 'question-answered' ? ' is answered' : ' completes');
}

/* who holds an active line: the reader's own session, else a session on its PC as the track page names it */
function holderOn(tv, held, pc) {
  const on = tv.holder && tv.holder.pc;
  if (!on || tv.id === held) return 'the session';
  return 'a session on ' + (pc && String(on).toLowerCase() === String(pc).toLowerCase() ? 'this PC' : on);
}

function trackWords(tv, x, agents, nameOf, held, pc) {
  if (tv.state === 'active') return 'active: ' + holderOn(tv, held, pc) + (agents ? ' and ' + plural(agents, 'agent', 'agents') : '');
  if (tv.state === 'waiting') return x.since ? 'waiting since ' + dayWords(x.since) : 'waiting';
  if (tv.state === 'new') return 'new, nobody on it yet';
  if (tv.state === 'parked') return parkedWords(x.unpark, nameOf);
  return tv.state;
}

const stalledWords = (stalled, days) => (stalled ? (Number.isFinite(days) && days > 0 ? 'stalled ' + plural(days, 'day', 'days') : 'stalled') : undefined);

/* An Answer as the strip and the chips read it. */
function answerOf(a) {
  return { id: a.id, key: a.key, url: a.url || null, tok: a.tok || '', name: a.name || '', on: dayWords(a.at), said: a.said || '', settles: a.settles || '' };
}

/* One workstream into P.ws and P.tasks. */
function addWs(P, view, x, held, pc) {
  const tvs = list(view.tracks);
  const wsId = view.workstream || x.workstream;
  const xt = x.tracks || {};
  const xk = x.tasks || {};
  const { g, D } = graphOf(tvs, Date.parse(P.at) || 0, viewLook(), { keepReview: false });
  const byTr = new Map(tvs.map((tv) => [tv.id, tv]));
  const nameOf = (tr) => (byTr.has(tr) ? shortOf(byTr.get(tr).name) : '');
  for (const [id, a] of Object.entries(x.answers || {})) P.ans[id] = answerOf(a);
  const ansOf = (q) => (q && P.ans[q] ? q : undefined);
  for (const gt of g.tasks) {
    const d = D.tasks[gt.id];
    const waits = d.waits.filter((w) => !w.track).map((w) => w.id);
    const cross = d.waits.filter((w) => w.track).map((w) => w.id);
    let st = gt.kept ? 'done' : d.kind === 'pointer' ? 'waits' : d.kind;
    /* in the session's own hand, still waiting on open tasks */
    if (st === 'now' && !gt.agent && waits.length + cross.length) st = 'held';
    const e = xk[gt.id] || {};
    const ans = ansOf((x.taskAns || {})[gt.id]);
    P.tasks[gt.id] = {
      id: gt.id, key: gt.key, url: gt.url || null, tr: gt.track, ws: wsId, name: gt.full, st, waits, cross, frees: [],
      ...(gt.review ? { review: true } : {}), ...(e.low ? { low: true } : {}), ...(e.by ? { by: e.by } : {}),
      ...(st === 'now' || st === 'held' ? (gt.agent ? { agent: gt.agent } : { session: true }) : {}),
      /* its agent stopped; the station lands with no train car */
      ...(st === 'now' && endedOf(gt) ? { ended: endedOf(gt) } : {}),
      ...(ans ? { ans } : {}),
      times: { created: e.created || null, ...(e.started ? { started: e.started } : {}), ...(e.closed ? { closed: e.closed } : {}) },
    };
  }
  /* tasks off this workstream's tracks that a drawn task waits on or frees */
  for (const f of Object.values(x.far || {})) {
    if (P.tasks[f.id]) continue;
    P.tasks[f.id] = {
      id: f.id, key: f.key, url: f.url || null, tr: f.tr || null, ws: f.ws || null, name: f.name || '', st: f.st || 'waits',
      waits: [], cross: list(f.waits), frees: [], far: true, ...(f.trName ? { trName: f.trName } : {}), ...(f.wsName ? { wsName: f.wsName } : {}),
      times: { created: f.created || null },
    };
  }
  for (const tv of tvs) {
    const j = (tv.junction || {}).task;
    if (j && P.tasks[j.id] && !P.tasks[j.id].leaves) P.tasks[j.id].leaves = tv.id;
  }
  for (const o of list(x.out)) if (o.task && P.tasks[o.task]) P.tasks[o.task].out = o.ws;
  const tracks = tvs.map((tv) => {
    const e = xt[tv.id] || {};
    const own = g.tasks.filter((t) => t.track === tv.id && !t.kept).map((t) => P.tasks[t.id]);
    const ownIds = new Set(own.map((t) => t.id));
    /* a station whose agent ended counts apart from running */
    const running = own.filter((t) => (t.st === 'now' || t.st === 'held') && !t.ended).length;
    const landing = own.filter((t) => t.ended === 'finished').length;
    const stopped = own.filter((t) => t.ended === 'stopped').length;
    const ready = own.filter((t) => t.st === 'ready').length;
    const names = own.filter((t) => t.st === 'now' && t.agent && !t.ended).map((t) => t.agent);
    const junctions = g.tasks.filter((t) => t.kept && t.track === tv.id).map((t) => t.id);
    const short = shortOf(tv.name);
    /* due by the board's own reading (the review size reached), counting what waits */
    const rd = tv.review && tv.review.due && Array.isArray(tv.review.uncovered) ? tv.review.uncovered.length : 0;
    const stalled = stalledWords(tv.stalled, e.stalledDays);
    return {
      id: tv.id, key: tv.key, url: tv.url || null, ws: wsId, name: tv.name, ...(short !== tv.name ? { short } : {}),
      state: tv.state, words: trackWords(tv, e, names.length, nameOf, held, pc), ...(stalled ? { stalled } : {}),
      open: own.length, ready, running, ...(landing ? { landing } : {}), ...(stopped ? { stopped } : {}), waiting: own.length - running - landing - stopped - ready, done: tv.done || 0, chain: (tv.critical || {}).length || 0,
      ...(tv.holder || names.length ? { train: { agents: names.length, names, session: Boolean(tv.holder) } } : {}),
      from: ((tv.junction || {}).task || {}).id || null,
      spine: list((tv.critical || {}).path).filter((id) => ownIds.has(id)),
      doneRun: Math.max(0, (tv.done || 0) - junctions.length), junctions,
      ...(e.unpark ? { unpark: { kind: e.unpark.kind, on: e.unpark.on } } : {}),
      ...(rd ? { reviewDue: rd } : {}),
      ...(tv.state !== 'active' ? { resume: '/askerdo resume ' + tv.id } : {}),
      doneList: list(e.doneList), moves: list(e.moves),
    };
  });
  const trOf = (id) => (P.tasks[id] || {}).tr;
  const links = [];
  for (const t of tracks) {
    const u = t.unpark;
    if (!u) continue;
    const ans = ansOf((xt[t.id] || {}).parkAns);
    if (u.kind === 'track-ends' && byTr.has(u.on)) links.push({ from: u.on, to: t.id, kind: 'order', ...(ans ? { ans } : {}) });
    if (u.kind === 'task-completes' && byTr.has(trOf(u.on))) links.push({ from: trOf(u.on), to: t.id, kind: 'order', on: u.on, ...(ans ? { ans } : {}) });
  }
  const waitsBy = new Map();
  for (const t of tracks) {
    for (const id of g.tasks.filter((x2) => x2.track === t.id && !x2.kept).map((x2) => x2.id)) {
      for (const c of P.tasks[id].cross) {
        const from = trOf(c);
        if (!byTr.has(from) || from === t.id) continue;
        const k = from + '>' + t.id;
        if (!waitsBy.has(k)) waitsBy.set(k, { from, to: t.id, kind: 'wait', pairs: [] });
        waitsBy.get(k).pairs.push([id, c]);
      }
    }
  }
  const order = new Map(tvs.map((tv, i) => [tv.id, i]));
  links.push(...[...waitsBy.values()].sort((a, b) => order.get(a.from) - order.get(b.from) || order.get(a.to) - order.get(b.to)));
  const parks = tracks.filter((t) => t.unpark).map((t) => ({ tr: t.id, kind: t.unpark.kind, on: t.unpark.on }));
  /* each task's waits as the view gave them, the board's order, so a tie goes as on the track page */
  const crit = critOf({ tasks: tvs.flatMap((tv) => byPosition(g.tasks.filter((t) => t.track === tv.id && !t.kept)))
    .map((t) => ({ id: t.id, tr: t.track, deps: D.tasks[t.id].waits.map((w) => w.id), ...(t.promotedTo ? { zero: true } : {}) })), parks });
  const short = shortOf(x.name || view.name || '');
  P.ws[wsId] = {
    id: wsId, key: x.key || null, url: x.url || null, name: x.name || '', ...(short && short !== x.name ? { short } : {}),
    crit, held: held && byTr.has(held) ? held : null, tracks, links, out: list(x.out), in: list(x.in),
  };
}

/* The Overview's words from the verb's counts. */
function ovWords(w) {
  const trs = list(w.tracks);
  if (!trs.length) return 'no track yet';
  const active = trs.filter((t) => t.state === 'active');
  if (active.length === 1 && trs.length === 1) return active[0].id + ' ' + active[0].name + ' active';
  if (active.length === 1) return active[0].id + ' ' + active[0].name + ' active, ' + plural(trs.length - 1, 'other track', 'other tracks');
  const n = {};
  for (const t of trs) n[t.state] = (n[t.state] || 0) + 1;
  // the state the pill reads leads, so a parked line beside a new one reads "1 parked, 1 new"
  const lead = ovState(w);
  const parts = [lead, ...['active', 'waiting', 'new', 'parked'].filter((s) => s !== lead)].filter((s) => n[s]).map((s) => n[s] + ' ' + s);
  if (parts.length === 1) return plural(trs.length, 'track', 'tracks') + ' ' + parts[0].replace(/^\d+ /, '');
  return plural(trs.length, 'track', 'tracks') + ': ' + parts.join(', ');
}

function ovCounts(w) {
  const trs = list(w.tracks);
  const inbox = w.inbox ? ', inbox ' + w.inbox + (w.inboxDue ? ', ' + w.inboxDue + ' due' : '') : '';
  if (w.running || w.landing || w.stopped) {
    const waiting = w.open - w.running - (w.landing || 0) - (w.stopped || 0) - w.ready;
    const rest = [w.running ? w.running + ' running' : '', ...endedParts(w), w.ready ? w.ready + ' ready' : '', waiting ? waiting + ' waiting' : ''].filter(Boolean);
    return w.open + ' open: ' + rest.join(', ') + inbox;
  }
  const u = ovState(w) === 'parked' ? trs.find((t) => t.state === 'parked' && t.unpark) : null;
  if (u) return u.id + ' opens when ' + u.unpark.on + (u.unpark.kind === 'track-ends' ? ' ends' : u.unpark.kind === 'question-answered' ? ' is answered' : ' completes');
  if (!w.open) return 'nothing open' + inbox;
  return w.open + ' open' + (w.crit > 1 ? ', critical path ' + w.crit + ' tasks' : '') + inbox;
}

/* the mock's reading: a parked line with a new one beside it reads parked */
function ovState(w) {
  const s = new Set(list(w.tracks).map((t) => t.state));
  return s.has('active') ? 'active' : s.has('waiting') ? 'waiting' : s.has('parked') ? 'parked' : 'new';
}

function ovWs(w) {
  const short = shortOf(w.name);
  const stalled = stalledWords(Number.isFinite(w.stalledDays), w.stalledDays);
  const gatedQ = list(w.gatedQ);
  return {
    id: w.id, key: w.key || null, url: w.url || null, name: w.name || '', ...(short !== w.name ? { short } : {}),
    state: ovState(w), words: ovWords(w), counts: ovCounts(w), ...(w.inbox && w.inboxDue ? { due: w.inboxDue + ' due' } : {}),
    ...(w.held ? { train: { agents: list(w.agents).length, names: list(w.agents) } } : {}),
    ...(w.needs ? { needs: w.needs } : {}),
    ...(gatedQ.length ? { gated: list(w.gatedNames).slice(0, 2).join('; ') + ' (' + gatedQ.join(', ') + ')', gatedQ } : {}),
    ...(stalled ? { stalled } : {}),
    opens: list(w.tracks).length > 0, moves: list(w.moves),
  };
}

/* pictureOf({ views, extras, overview, held, pc, at }): views, workstreamView results (one or a
   list); extras, the pictureView results for them; overview, pictureOverview's; held, the
   reader's held track id; pc, the reader's PC, none on the board; at, when the data was read. */
export function pictureOf({ views, extras, overview, held = null, pc = '', at } = {}) {
  const P = { at: at || new Date().toISOString(), look: null, ov: [], ovLinks: [], ws: {}, tasks: {}, ans: {} };
  if (overview) {
    P.ov = list(overview.ws).map(ovWs);
    P.ovLinks = list(overview.links).map((l) => ({ ...l, pairs: list(l.pairs).map((p) => [...p]) }));
  }
  const X = new Map(arr(extras).map((x) => [x.workstream, x]));
  for (const v of arr(views)) addWs(P, v, X.get(v.workstream) || {}, held, pc);
  for (const t of Object.values(P.tasks)) {
    for (const w of [...t.waits, ...t.cross]) if (P.tasks[w] && !P.tasks[w].frees.includes(t.id)) P.tasks[w].frees.push(t.id);
  }
  return P;
}

const sinceWords = (n) => [n.new ? n.new + ' new' : '', n.started ? n.started + ' started' : '', n.done ? n.done + ' done' : ''].filter(Boolean).join(', ');

function countMoves(moves, from) {
  const n = { new: 0, started: 0, done: 0 };
  const done = [];
  for (const m of list(moves)) {
    if (!(Date.parse(m[2]) > from) || !(m[1] in n)) continue;
    n[m[1]] += 1;
    if (m[1] === 'done' && !done.includes(m[0])) done.push(m[0]);
  }
  return { n, done };
}

/* sinceLook(P, look): P with what moved since the reader's last look; none past 30 days, or with no look. */
export function sinceLook(P, look) {
  const out = JSON.parse(JSON.stringify(P));
  const from = Date.parse(look);
  const at = Date.parse(out.at);
  if (!look || !Number.isFinite(from) || (Number.isFinite(at) && at - from > LOOK_DAYS * DAY)) { out.look = null; return out; }
  out.look = look;
  for (const o of out.ov) { const w = sinceWords(countMoves(o.moves, from).n); if (w) o.changed = w; }
  for (const W of Object.values(out.ws)) {
    const all = [];
    for (const t of W.tracks) {
      all.push(...list(t.moves));
      const c = countMoves(t.moves, from);
      const w = sinceWords(c.n);
      if (w) t.changed = w;
      if (c.done.length) t.doneSince = c.done;
    }
    const c = countMoves(all, from);
    W.changed = sinceWords(c.n) ? { n: sinceWords(c.n), news: c.n.new } : null;
  }
  for (const t of Object.values(out.tasks)) {
    const tm = t.times || {};
    const after = (s) => Date.parse(s) > from;
    const f = after(tm.closed) ? 'done' : after(tm.created) ? 'new' : after(tm.started) ? 'started' : null;
    if (f) t.fresh = f;
  }
  return out;
}
