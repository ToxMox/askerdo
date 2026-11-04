/* The track merge of the migration from the file store, run on a raw import: each thread and its plans
   become one track on the user's mapping, keeping the thread's number and key;
   every other plan becomes its own track. Old order becomes "depends on" edges, handoffs and questions move
   onto their tracks, and TH-n, TH-n.m and P-n resolve through the track's label history. */
import { tx } from './db.mjs';
import { ImportError } from './import.mjs';
import { actorOf, isKey, kebab, logVerb, orderFields, putHandoff, putNotes, putRecord, setMeta } from './records.mjs';
import { historyItem, parseHistory, resolveRecord } from './verbs/labels.mjs';
import { ENDED_TASK, TASK_KEYS, loadRecord, trackGraph, writeFront } from './verbs/graph.mjs';
import { noHandoff, stateOf } from './verbs/tracks.mjs';
import { createRecord } from './verbs/work.mjs';

export const IMPORT_REASON = 'from import';
const BY = 'import';
const FROM_THREAD = { active: 'open', waiting: 'open', parked: 'parked', done: 'done', dropped: 'dropped' };
const LIVE = ['waiting', 'parked'];

const num = (label) => Number(String(label).split('-')[1]) || 0;
const ms = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : 0; };
const mapOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const list = (v) => (Array.isArray(v) ? v : []);
const union = (...ls) => [...new Set(ls.flatMap(list))];
const ended = (rec) => ENDED_TASK.includes(rec.fields.status);
const chainNo = (h) => Number((/\.(\d+)$/.exec(String(h.fields.id || '')) || [])[1]) || 0;

const rowsOf = (db, kind) => db.stmt('SELECT key FROM records WHERE kind = ? ORDER BY id').all(kind).map((r) => loadRecord(db, r.key));
const notesOf = (db, key) => db.stmt('SELECT at, actor, body FROM notes WHERE record = ? ORDER BY position').all(key).map((n) => ({ ...n }));

/* The old store's stepsOf: the plan's steps in order, each naming its tasks. */
function stepsOf(f) {
  const names = mapOf(f.steps);
  const tasks = mapOf(f.stepTasks);
  const closes = mapOf(f.stepCloses);
  return Object.keys(names).filter((id) => /^s[1-9]\d{0,5}$/.test(id)).map((id) => ({
    id, name: String(names[id]), closes: String(closes[id] ?? ''), tasks: String(tasks[id] ?? '').split(/\s+/).filter(Boolean),
  }));
}

function wsOfThread(db, thread) {
  for (const l of list(thread.fields.links)) {
    const r = isKey(l) ? db.stmt("SELECT key FROM records WHERE key = ? AND kind = 'workstream'").get(l) : null;
    if (r) return r.key;
  }
  return null;
}

/* The groups the mapping names, then every other thread and plan on its own. */
function groupsOf(db, map, problems) {
  const threads = rowsOf(db, 'thread');
  const plans = rowsOf(db, 'plan');
  const byLabel = (rows, label) => rows.filter((r) => r.fields.id === label);
  const used = new Set();
  const groups = [];
  for (const m of map) {
    const th = byLabel(threads, m.thread);
    if (th.length !== 1) { problems.push('the mapping names ' + m.thread + ', which ' + (th.length ? 'more than one thread holds' : 'no thread holds')); continue; }
    const ps = [];
    for (const p of m.plans || []) {
      const hit = byLabel(plans, p);
      if (hit.length !== 1) problems.push('the mapping names ' + p + ', which ' + (hit.length ? 'more than one plan holds' : 'no plan holds'));
      else if (used.has(hit[0].key)) problems.push('the mapping names ' + p + ' twice');
      else { ps.push(hit[0]); used.add(hit[0].key); }
    }
    if (used.has(th[0].key)) { problems.push('the mapping names ' + m.thread + ' twice'); continue; }
    used.add(th[0].key);
    groups.push({ thread: th[0], plans: ps });
  }
  for (const t of threads) if (!used.has(t.key)) groups.push({ thread: t, plans: [] });
  /* open plans take the first new numbers, closed ones after them */
  const rest = plans.filter((p) => !used.has(p.key))
    .sort((a, b) => (a.fields.status === 'closed') - (b.fields.status === 'closed') || num(a.fields.id) - num(b.fields.id));
  for (const p of rest) groups.push({ thread: null, plans: [p] });
  for (const g of groups) {
    const ws = g.thread ? wsOfThread(db, g.thread) || (g.plans[0] && g.plans[0].fields.workstream) : g.plans[0].fields.workstream;
    const label = (g.thread || g.plans[0]).fields.id;
    if (!ws) problems.push(label + ' names no workstream, and a track needs one');
    for (const p of g.plans) if (ws && p.fields.workstream !== ws) problems.push(p.fields.id + ' is in another workstream than ' + label);
    g.workstream = ws;
  }
  return groups;
}

/* The old order of a plan's tasks: its steps first, then its other tasks by
   ordinal and number. A step that is not one task becomes a task here. */
function planOrder(db, plan, placed, ws, actor, out) {
  const at = (ref) => {
    const e = resolveRecord(db, ref, { kinds: ['task'] });
    return e ? e.key : null;
  };
  const add = (key) => { if (!placed.has(key)) { placed.add(key); out.push(key); } };
  for (const s of stepsOf(plan.fields)) {
    const covers = s.tasks.map(at).filter(Boolean);
    covers.forEach(add);
    if (covers.length === 1) continue;
    const r = createRecord(db, {
      name: s.name, workstream: ws,
      description: 'Step ' + s.id + ' of ' + plan.fields.id + (s.closes ? '; it closed when ' + s.closes : '') + '.',
    }, actor);
    const done = covers.length && covers.every((k) => ended(loadRecord(db, k)));
    const t = loadRecord(db, r.key);
    /* the step it came from: labels differ per import, so the board picture names it so */
    const change = { fromStep: plan.fields.id + '/' + s.id };
    if (done) {
      change.status = 'completed';
      change.closed = covers.map((k) => loadRecord(db, k).fields.closed).filter(Boolean).sort((a, b) => ms(a) - ms(b)).pop() || t.fields.created;
    }
    writeFront(db, t, change, TASK_KEYS);
    placed.add(r.key);
    out.push(r.key);
    out.stepTasks.push(r.id);
  }
  const loose = db.stmt("SELECT key FROM records WHERE kind = 'task' AND json_extract(fields, '$.plan') = ?").all(plan.key)
    .map((r) => loadRecord(db, r.key))
    .sort((a, b) => (a.fields.ordinal ?? 0) - (b.fields.ordinal ?? 0) || num(a.fields.id) - num(b.fields.id));
  for (const t of loose) add(t.key);
}

const demote = (text) => text.split('\n').map((l) => (/^#{1,5} /.test(l) ? '#' + l : l)).join('\n');
const tidy = (body) => { const b = String(body || '').replace(/\s+$/, ''); return b ? b + '\n\n' : ''; };

function trackBody(g) {
  if (!g.thread) return tidy(g.plans[0].body) || '\n## Description\n\n' + g.plans[0].fields.name + '\n\n';
  let body = tidy(g.thread.body) || '\n## Description\n\n' + (g.thread.fields.goal || g.thread.fields.name) + '\n\n';
  for (const p of g.plans) body += '## ' + p.fields.id + ': ' + p.fields.name + '\n\n' + tidy(demote(String(p.body || '').replace(/^\s+/, '')));
  return body;
}

function historyOf(parts, id, day) {
  const spans = parts.flatMap((p) => {
    const h = parseHistory(p.fields.labelHistory);
    return h.length ? h : [{ label: p.fields.id, from: String(p.fields.created || day).slice(0, 10), to: '' }];
  }).map((h) => ({ ...h, to: h.to || day }));
  spans.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return spans.concat([{ label: id, from: day, to: '' }]).map(historyItem);
}

/* Front values naming a key that went away, swapped for the track's key. */
function swapKeys(v, gone, depth = 0) {
  if (typeof v === 'string') return gone.has(v) ? gone.get(v) : v;
  if (Array.isArray(v)) return v.map((x) => swapKeys(x, gone, depth + 1));
  if (v && typeof v === 'object' && depth < 2) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swapKeys(x, gone, depth + 1)]));
  return v;
}

/* mergeTracks(db, { map, now, pc }): one transaction; any problem stops it with
   nothing written. `pc` names the PC that keeps the live handoffs' lists. */
export function mergeTracks(db, { map = [], now = new Date(), pc } = {}) {
  const actor = { by: BY, now };
  const c = actorOf(actor);
  return tx(db, () => {
    const problems = [];
    if (db.stmt("SELECT count(*) AS n FROM records WHERE kind = 'track'").get().n) {
      problems.push('the database already holds tracks; the merge runs once, on a raw import');
    }
    const groups = groupsOf(db, map, problems);
    if (problems.length) throw new ImportError('the track merge stopped, nothing was written:\n' + problems.join('\n'));

    /* numbers: a thread keeps its own, the rest follow the highest */
    let top = Math.max(0, ...groups.filter((g) => g.thread).map((g) => num(g.thread.fields.id)));
    for (const g of groups) {
      g.id = g.thread ? 'TR-' + num(g.thread.fields.id) : 'TR-' + (++top);
      g.key = (g.thread || g.plans[0]).key;
      g.parts = [g.thread, ...g.plans].filter(Boolean);
      g.from = g.parts.map((p) => p.fields.id);
    }
    const alias = new Map(groups.flatMap((g) => g.parts.map((p) => [p.key, g.key])));
    const gone = new Map([...alias].filter(([k, t]) => k !== t));

    /* the old order, read while the plans are still records */
    const placed = new Set();
    const stepTasks = [];
    for (const g of groups) {
      g.order = [];
      g.order.stepTasks = stepTasks;
      for (const p of g.plans) planOrder(db, p, placed, g.workstream, actor, g.order);
    }

    /* handoffs per thread, newest first, for the status and the park reason */
    const hoffs = db.stmt('SELECT id, key, slug, fields, state, where_we_were, verify FROM handoffs ORDER BY id').all()
      .map((h) => ({ ...h, fields: JSON.parse(h.fields), verify: JSON.parse(h.verify) }));
    const byThread = new Map();
    for (const h of hoffs) {
      if (!byThread.has(h.fields.thread)) byThread.set(h.fields.thread, []);
      byThread.get(h.fields.thread).push(h);
    }
    /* newest first by chain number, as the board orders them: created stays as
       it was, even where an old import stamped it later than the next one */
    for (const l of byThread.values()) l.sort((a, b) => chainNo(b) - chainNo(a) || b.id - a.id);

    /* the tracks, the parts gone */
    for (const g of groups) {
      const head = g.thread || g.plans[0];
      const chain = g.thread ? byThread.get(g.thread.key) || [] : [];
      const tStatus = g.thread ? g.thread.fields.status : null;
      const status = g.thread ? FROM_THREAD[tStatus] || 'open' : head.fields.status === 'closed' ? 'done' : 'open';
      const parked = chain.find((h) => h.fields.status === 'parked');
      const outcome = g.thread ? undefined : head.fields.outcome || undefined;
      const closed = ['done', 'dropped'].includes(status) ? g.parts.map((p) => p.fields.closed).filter(Boolean).sort((a, b) => ms(a) - ms(b)).pop() || c.at : undefined;
      const refs = union(...g.parts.map((p) => p.fields.refs), g.thread ? list(g.thread.fields.links).filter((l) => !isKey(l)) : []);
      const fields = orderFields('track', {
        id: g.id, key: g.key, name: head.fields.name, workstream: g.workstream, status,
        goal: g.thread ? g.thread.fields.goal || undefined : undefined,
        parkReason: status === 'parked' ? (parked && parked.fields.parkReason) || 'parked before the import' : undefined,
        outcome: status === 'done' || status === 'dropped' ? outcome : undefined,
        created: g.parts.map((p) => p.fields.created).filter(Boolean).sort((a, b) => ms(a) - ms(b))[0] || c.at,
        updated: g.parts.map((p) => p.fields.updated).filter(Boolean).sort((a, b) => ms(a) - ms(b)).pop() || c.at,
        closed,
        labels: union(...g.parts.map((p) => p.fields.labels)),
        refs: refs.map((r) => (gone.has(r) ? gone.get(r) : r)),
        profiles: union(...g.parts.map((p) => p.fields.profiles)),
        profileDrops: union(...g.parts.map((p) => p.fields.profileDrops)),
        labelHistory: historyOf(g.parts, g.id, c.day),
      });
      const merged = g.parts.length > 1;
      const notes = g.parts.flatMap((p, i) => notesOf(db, p.key).map((n, j) => ({
        ...n, body: merged && p !== g.thread ? p.fields.id + ': ' + n.body : n.body, rank: [ms(n.at), i, j],
      })));
      notes.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
      notes.push({ at: c.at, actor: BY, body: 'Made at the import from ' + g.from.join(' and ')
        + (g.thread ? ', keeping ' + g.thread.fields.id + "'s number" : '') + '.' });
      g.body = trackBody(g);
      g.fields = fields;
      g.notes = notes;
      g.chain = chain;
      g.status = status;
      g.threadStatus = tStatus;
    }
    const del = db.stmt('DELETE FROM records WHERE key = ?');
    const dropLabels = db.stmt("DELETE FROM labels WHERE key = ? AND origin = 'history'");
    for (const g of groups) for (const p of g.parts) { del.run(p.key); dropLabels.run(p.key); }
    for (const g of groups) {
      putRecord(db, { key: g.key, kind: 'track', slug: kebab(g.fields.name, 'track'), fields: g.fields, body: g.body });
      putNotes(db, g.key, g.notes.map(({ rank, ...n }) => n));
    }

    /* tasks onto their tracks in the old order; open ones chained */
    const item = db.stmt('INSERT INTO track_items (track, task, position) VALUES (?, ?, ?)');
    const edge = db.stmt('INSERT INTO depends (task, "on", reason, added, actor) VALUES (?, ?, ?, ?, ?)');
    for (const g of groups) {
      let prev = null;
      g.open = 0;
      g.edges = 0;
      g.order.forEach((key, i) => {
        const t = loadRecord(db, key);
        const change = {};
        if (t.fields.plan !== undefined) change.plan = undefined;
        if (t.fields.ordinal !== undefined) change.ordinal = undefined;
        if (t.fields.workstream !== g.workstream) change.workstream = g.workstream;
        if (Object.keys(change).length) writeFront(db, t, change, TASK_KEYS);
        item.run(g.key, key, i + 1);
        if (ended(t)) return;
        g.open += 1;
        if (prev) { edge.run(key, prev, IMPORT_REASON, c.at, BY); g.edges += 1; }
        prev = key;
      });
    }

    /* handoffs onto their tracks, statuses kept; a thread active at the import had
       its session end with it, so its newest handoff waits again */
    const live = [];
    const reopened = [];
    const trackOf = new Map(groups.filter((g) => g.thread).map((g) => [g.thread.key, g]));
    let orphans = 0;
    for (const h of hoffs) {
      const g = trackOf.get(h.fields.thread);
      if (!g) { orphans += 1; continue; }
      let f = {};
      for (const [k, v] of Object.entries(h.fields)) {
        if (k === 'thread') f.track = g.key;
        else f[k] = v;
      }
      if (g.threadStatus === 'active' && g.chain[0] === h && f.status === 'resumed') {
        const { resumedBy, resumed, ...rest } = f;
        f = { ...rest, status: 'waiting', updated: c.at };
        reopened.push(f.id);
      }
      if (LIVE.includes(f.status) && pc) {
        const out = {};
        for (const [k, v] of Object.entries(f)) { out[k] = v; if (k === 'track') out.pc = pc; }
        f = out;
      }
      putHandoff(db, { key: h.key, slug: h.slug, fields: f, state: h.state, whereWeWere: h.where_we_were, verify: h.verify });
      if (LIVE.includes(f.status)) {
        live.push({ label: f.id, key: h.key, track: g.id, created: f.created, file: 'handoffs/' + h.key + '-' + h.slug + '.md' });
      }
    }

    /* every other front, and the old label maps, follow a key that went away */
    let rewritten = 0;
    if (gone.size) {
      const like = [...gone.keys()].map(() => 'fields LIKE ?').join(' OR ');
      const args = [...gone.keys()].map((k) => '%' + k + '%');
      for (const r of db.prepare('SELECT key FROM records WHERE ' + like).all(...args)) {
        const rec = loadRecord(db, r.key);
        const fields = swapKeys(rec.fields, gone);
        if (JSON.stringify(fields) === JSON.stringify(rec.fields)) continue;
        putRecord(db, { key: rec.key, kind: rec.kind, slug: rec.slug, fields, body: rec.body, layout: rec.layout, track: rec.track });
        rewritten += 1;
      }
      for (const h of db.prepare('SELECT key, slug, fields, state, where_we_were, verify FROM handoffs WHERE ' + like).all(...args)) {
        const f = JSON.parse(h.fields);
        const fields = swapKeys(f, gone);
        if (JSON.stringify(fields) === JSON.stringify(f)) continue;
        putHandoff(db, { key: h.key, slug: h.slug, fields, state: h.state, whereWeWere: h.where_we_were, verify: JSON.parse(h.verify) });
        rewritten += 1;
      }
      for (const [from, to] of gone) {
        db.stmt("UPDATE labels SET key = ? WHERE key = ? AND origin = 'id-map'").run(to, from);
        for (const b of db.stmt("SELECT id, extra FROM labels WHERE origin = 'brain' AND (key = ? OR extra LIKE ?)").all(from, '%' + from + '%')) {
          const e = JSON.parse(b.extra);
          if (e.to === from) e.to = to;
          db.stmt('UPDATE labels SET key = ?, extra = ? WHERE id = ?').run(isKey(e.to) ? e.to : null, JSON.stringify(e), b.id);
        }
      }
    }

    /* a question's plan and thread name its track now, one `track` in their place;
       the raw import keeps them, so its byte proof needs no mapping back */
    let questions = 0;
    const named = db.stmt("SELECT key FROM records WHERE kind = 'question' AND (json_extract(fields, '$.plan') IS NOT NULL OR json_extract(fields, '$.thread') IS NOT NULL)");
    for (const r of named.all()) {
      const rec = loadRecord(db, r.key);
      const { plan, thread } = rec.fields;
      if (plan && thread && plan !== thread) {
        throw new ImportError('the track merge stopped, nothing was written:\n' + rec.fields.id + ' names plan and thread on two tracks');
      }
      const fields = {};
      for (const [k, v] of Object.entries(rec.fields)) {
        if (k !== 'plan' && k !== 'thread') fields[k] = v;
        else if (!('track' in fields) && (plan || thread)) fields.track = plan || thread;
      }
      putRecord(db, { key: rec.key, kind: rec.kind, slug: rec.slug, fields, body: rec.body, layout: rec.layout, track: rec.track });
      questions += 1;
    }

    setMeta(db, 'label.top.TR', String(Math.max(top, ...groups.map((g) => num(g.id)))));
    logVerb(db, {
      ts: c.at, verb: 'import', kind: 'track', id: '', name: 'the import', by: BY,
      changes: { tracks: [null, groups.map((g) => g.id)] },
      note: groups.length + ' tracks from ' + groups.filter((g) => g.thread).length + ' threads and '
        + groups.reduce((n, g) => n + g.plans.length, 0) + ' plans, on the user\'s mapping',
    });

    const inbox = db.stmt(`SELECT count(*) AS n FROM records r WHERE r.kind = 'task'
      AND NOT EXISTS (SELECT 1 FROM track_items ti WHERE ti.task = r.key)`).get().n;
    return {
      day: c.day, at: c.at, alias, live, reopened, stepTasks,
      tracks: groups.map((g) => ({
        id: g.id, key: g.key, name: g.fields.name, from: g.from, status: g.status, thread: g.threadStatus,
        tasks: g.order.length, open: g.open, edges: g.edges, handoffs: g.chain.length, live: live.some((h) => h.track === g.id),
      })),
      counts: {
        tracks: groups.length, threads: groups.filter((g) => g.thread).length, plans: groups.reduce((n, g) => n + g.plans.length, 0),
        tasksOnTracks: placed.size, inbox, stepTasks: stepTasks.length, edges: groups.reduce((n, g) => n + g.edges, 0),
        handoffs: hoffs.length - orphans, orphanHandoffs: orphans, liveHandoffs: live.length, reopened: reopened.length, refsRewritten: rewritten, questionsOnTracks: questions,
      },
    };
  });
}

/* Every label a record has held, and every handoff label, to the key it names. */
export function labelSnapshot(db, day) {
  const out = new Map();
  const labels = db.stmt("SELECT DISTINCT label FROM labels WHERE origin = 'history' UNION SELECT DISTINCT label FROM handoffs WHERE label IS NOT NULL").all();
  for (const { label } of labels) {
    const e = resolveRecord(db, label, { day });
    if (e) out.set(label, e.key);
  }
  return out;
}

/* The merge's proof: every task on one track or in an inbox, every old label
   resolving where it did (a thread or plan now its track), the old order as
   edges, nothing ready that was not next, and each track in its thread's state. */
export function proveTracks(db, { before, merge }) {
  const problems = [];
  /* a closed task that never had a workstream or a plan had no home before either */
  const homeless = db.stmt(`SELECT label, status FROM records r WHERE r.kind = 'task' AND coalesce(r.workstream, '') = ''
    AND NOT EXISTS (SELECT 1 FROM track_items ti WHERE ti.task = r.key)`).all();
  for (const t of homeless) if (!ENDED_TASK.includes(t.status)) problems.push(t.label + ' is open on no track and in no workstream inbox');
  const closedNowhere = homeless.filter((t) => ENDED_TASK.includes(t.status)).map((t) => t.label);
  let labels = 0;
  const minted = new Set(merge.stepTasks || []);
  for (const [label, key] of before) {
    if (minted.has(label)) continue;
    const want = merge.alias.get(key) || key;
    const e = resolveRecord(db, label, { day: merge.day });
    labels += 1;
    if (!e || e.key !== want) problems.push(label + ' resolved to ' + key + ' before the merge and to ' + (e ? e.key : 'nothing') + ' after');
  }
  const ownEdges = db.stmt(`SELECT count(*) AS n FROM depends WHERE reason = ? AND task IN (SELECT task FROM track_items WHERE track = ?)`);
  const firstOpen = db.stmt(`SELECT r.key, r.label, r.status FROM track_items ti JOIN records r ON r.key = ti.task
    WHERE ti.track = ? AND r.status NOT IN ('completed', 'dropped') ORDER BY ti.position LIMIT 1`);
  let edges = 0;
  for (const t of merge.tracks) {
    const n = ownEdges.get(IMPORT_REASON, t.key).n;
    edges += n;
    if (n !== Math.max(0, t.open - 1)) problems.push(t.id + ' has ' + n + ' import edges for ' + t.open + ' open tasks');
    const first = firstOpen.get(t.key);
    const ready = trackGraph(db, t.key).ready;
    if (ready.some((r) => !first || r.key !== first.key)) problems.push(t.id + ' reads ' + ready.map((r) => r.id).join(', ') + ' ready; only its next task may be');
    const rec = loadRecord(db, t.key);
    const state = stateOf(db, rec);
    const want = t.thread === 'parked' ? 'parked' : ['active', 'waiting'].includes(t.thread) ? 'waiting'
      : t.status === 'open' ? 'new' : t.status;
    if (state !== want) problems.push(t.id + ' reads ' + state + ', its ' + (t.thread ? 'thread was ' + t.thread : 'plan was ' + t.status));
    if (t.live && noHandoff(db, t.key, state)) problems.push(t.id + ' had a live handoff at the import and reads no handoff yet');
    const hs = db.stmt('SELECT count(*) AS n FROM handoffs WHERE track = ?').get(t.key).n;
    if (hs !== t.handoffs) problems.push(t.id + ' holds ' + hs + ' handoffs, its thread had ' + t.handoffs);
  }
  return {
    problems, closedNowhere,
    checked: { labels, tasks: db.stmt("SELECT count(*) AS n FROM records WHERE kind = 'task'").get().n, edges, tracks: merge.tracks.length },
  };
}

/* Once at the migration: each record's folder paths become the project's
   shared name. `nameOf(dir)` is the PC's (lib/project-id.mjs sharedName, run
   where the folders are); a record's stored remote wins. The field keeps its
   place, so the export's key order holds. Returns each folder with its name and
   the records that named it, which seed this PC's project map. */
export function mapProjects(db, { nameOf, now = new Date() } = {}) {
  if (typeof nameOf !== 'function') throw new TypeError('mapProjects needs the PC\'s nameOf');
  const folders = new Map();
  const seen = (dir, name) => {
    const slashed = String(dir).replace(/\\/g, '/');
    const k = slashed.replace(/\/+$/, '').toLowerCase();
    if (!folders.has(k)) folders.set(k, { dir: slashed.replace(/(.)\/+$/, '$1'), name, records: 0 });
    folders.get(k).records += 1;
  };
  const swap = (fields, from, to, names) => {
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
      if (k === from) out[to] = names;
      else if (k !== to) out[k] = v;
    }
    return out;
  };
  let records = 0;
  return tx(db, () => {
    /* a question's folder and a procedure card's main checkout */
    for (const [kind, from] of [['question', 'projectDir'], ['procedure', 'project']]) {
      for (const rec of rowsOf(db, kind)) {
        const dir = rec.fields[from];
        if (typeof dir !== 'string' || !dir) continue;
        const name = rec.fields.projectRepo || nameOf(dir);
        seen(dir, name);
        putRecord(db, { ...rec, fields: swap(rec.fields, from, 'projectRepo', name) });
        records += 1;
      }
    }
    for (const kind of ['workstream', 'knowledge']) {
      for (const rec of rowsOf(db, kind)) {
        const dirs = list(rec.fields.projects).filter((d) => typeof d === 'string' && d);
        if (!dirs.length) continue;
        const own = dirs.map((d) => nameOf(d));
        dirs.forEach((d, i) => seen(d, own[i]));
        /* the folders' names in their order, so the first project stays first; a
           workstream's stored remotes are the PC's reading of the same folders */
        putRecord(db, { ...rec, fields: swap(rec.fields, 'projects', 'projectRepos', union(own, rec.fields.projectRepos)) });
        records += 1;
      }
    }
    logVerb(db, {
      ts: actorOf({ now }).at, verb: 'import', kind: 'project', id: '', name: 'the project map', by: BY,
      changes: { projects: [null, [...new Set([...folders.values()].map((f) => f.name))]] },
      note: folders.size + ' folders across ' + records + ' records became shared names',
    });
    return { folders: [...folders.values()], records };
  });
}
