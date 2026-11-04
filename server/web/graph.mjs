/* The drawn graph's inputs from the track views, pure: the web reads its
   look from the database (data.mjs graphFrom), the mod from the views alone (mod-core
   homeGraph). One reading, so the web and the pane draw the same picture. */

/* layout.mjs keptJunctions, the same rule: the pure files import nothing (mod-core test). */
function keptJunctions(list) {
  const open = new Set(), ids = new Set(), out = new Map();
  for (const tv of list) { ids.add(tv.id); for (const t of tv.tasks || []) open.add(t.id); }
  for (const tv of list) {
    const j = tv.junction || {};
    if (!j.task || !j.track || !ids.has(j.track.id) || open.has(j.task.id) || out.has(j.task.id) || !(tv.tasks || []).length) continue;
    out.set(j.task.id, { id: j.task.id, key: j.task.key, name: j.task.name || '', track: j.track.id });
  }
  return [...out.values()];
}

/* a track's last completed review stays drawn, its diamond holding what it
   covered; the same rule as layout.mjs keptReviews (the pure files import nothing). */
export function keptReviews(list) {
  const out = new Map();
  for (const tv of list) {
    if (!(tv.tasks || []).length) continue;
    const done = (tv.finished || []).filter((f) => f && f.review && f.status === 'completed');
    const last = done.reduce((m, f) => (!m || (f.position ?? 0) > (m.position ?? 0) ? f : m), null);
    if (last && !out.has(last.id)) out.set(last.id, { ...last, track: tv.id });
  }
  return [...out.values()];
}

/* A station's short title: the name up to its first colon. */
export function shortTitle(name) {
  const s = String(name || '');
  const i = s.indexOf(': ');
  return i >= 6 ? s.slice(0, i) : s;
}

/* the short title beside an id in a list, past `max` letters cut at a word */
export function shortName(name, max = 40) {
  const s = shortTitle(String(name || '').replace(/\s+/g, ' ').trim());
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '') + '…';
}

/* ids each with its short name, past `most` the rest counted ("and 7 more"); `nameOf(id)` is a name or '' */
export function namedList(ids, nameOf, most = 0, max = 40) {
  const shown = most && ids.length > most ? ids.slice(0, most) : ids;
  const s = shown.map((id) => { const n = shortName(nameOf(id), max); return n ? id + ' ' + n : id; }).join('; ');
  return s + (shown.length < ids.length ? '; and ' + (ids.length - shown.length) + ' more' : '');
}

/* the name the view knows for a task id: its own open tasks, then the others it mentions */
export const viewNameOf = (view) => (id) => {
  const own = ((view && view.tasks) || []).find((t) => t.id === id);
  return own ? own.name : (view && view.names && view.names[id]) || '';
};

/* g (what the picture names) and D (what can move, by the track verbs' own reading) from
   workstreamView's tracks. look: gates(t) the open questions holding a task, trackOf(id, t, tv)
   the track of a dependency outside the views, front(tv) the track's record front or null,
   moved(tv, front) its last movement { last, days }; days null when it is not known;
   since(tv), optional, when it entered waiting (its live handoff), else `last` stands in.
   Optional: wsOf(id) a far dependency's workstream when it is another, neededBy(t) the open
   tasks outside the views that wait on t, each { id, track, ws }. */
export function graphOf(views, now, look) {
  const trackOf = new Map();
  for (const tv of views) for (const t of tv.tasks) trackOf.set(t.id, tv.id);
  const g = { tracks: [], tasks: [], edges: [] };
  const D = { tasks: {}, tracks: {}, critical: { len: 0, path: [], track: null } };
  const seen = new Set();
  const reviews = keptReviews(views);
  const keptR = new Set(reviews.map((k) => k.id));
  for (const k of reviews) if (!trackOf.has(k.id)) trackOf.set(k.id, k.track);
  for (const tv of views) {
    const front = look.front(tv);
    const moved = look.moved(tv, front);
    const j = tv.junction || {};
    const holder = tv.holder;
    g.tracks.push({
      id: tv.id, key: tv.key, name: tv.name, full: (front && front.goal) || tv.name,
      parent: j.track ? j.track.id : undefined, junction: j.task ? j.task.id : undefined, origin: front && front.origin,
      doneBefore: tv.done, parked: tv.parkReason || '', unpark: tv.unpark || '', last: moved.last, since: look.since ? look.since(tv) : null,
      lease: holder ? { who: holder.pc ? 'on ' + holder.pc : 'held', pc: holder.pc, since: holder.since, quiet: tv.quietSince || null } : null,
      /* the review readout and the finished code tasks and reviews, passed through for the station map */
      url: tv.url || null, review: tv.review || null, finished: Array.isArray(tv.finished) ? tv.finished : [],
    });
    const T = {
      state: tv.state, stalled: tv.stalled, noHandoff: tv.noHandoff, days: moved.days,
      open: tv.tasks.length, running: 0, left: 0, ready: 0, toGo: tv.critical.length, path: tv.critical.path,
    };
    D.tracks[tv.id] = T;
    const deps = {};
    for (const e of tv.edges) {
      if (e.done && !keptR.has(e.on)) continue;
      (deps[e.task] = deps[e.task] || []).push(e.on);
      const k = e.task + '>' + e.on;
      if (!seen.has(k)) { seen.add(k); g.edges.push([e.task, e.on]); }
    }
    /* running is the view's now set (a live hand backs it); a view without one, by its lease */
    const live = Array.isArray(tv.now) ? new Set(tv.now.map((n) => n.id)) : null;
    tv.tasks.forEach((t, i) => {
      const waits = (deps[t.id] || []).map((on) => {
        if (trackOf.has(on)) return { id: on, track: trackOf.get(on) === tv.id ? null : trackOf.get(on) };
        const ws = look.wsOf ? look.wsOf(on, t, tv) : '';
        return ws ? { id: on, track: look.trackOf(on, t, tv), ws } : { id: on, track: look.trackOf(on, t, tv) };
      });
      const gs = look.gates(t);
      const kind = t.pointer ? 'pointer' : t.status === 'in_progress' ? ((live ? live.has(t.id) : tv.state === 'active') ? 'now' : 'left')
        : t.ready ? 'ready' : gs.length && !waits.length ? 'gated' : 'waits';
      /* what waits on it from outside the picture: drawn waits have their connector */
      const needed = look.neededBy ? look.neededBy(t).filter((n) => !trackOf.has(n.id)) : [];
      D.tasks[t.id] = { kind, waits, gates: gs, needed };
      if (kind === 'now') T.running += 1;
      if (kind === 'left') T.left += 1;
      if (kind === 'ready') T.ready += 1;
      g.tasks.push({
        id: t.id, key: t.key, track: tv.id, pos: t.position ?? i + 1, status: t.status, title: shortTitle(t.name), full: t.name,
        promotedTo: t.pointer || undefined, agent: t.agent || null, session: t.session || null,
        checklist: t.progress && !t.pointer ? { done: t.progress.done, total: t.progress.total } : null,
        progress: t.pointer && t.progress ? { done: t.progress.done, total: t.progress.total } : null,
        url: t.url || null, ...(t.review ? { review: true, reviewScope: t.reviewScope || 'track', ...(t.reopened ? { reopened: true } : {}) } : {}),
      });
    });
    if (tv.critical.length > D.critical.len) D.critical = { len: tv.critical.length, path: tv.critical.path, track: tv.id };
  }
  /* a finished junction stays drawn, done and dimmed, where its side line leaves */
  for (const k of keptJunctions(views)) {
    g.tasks.push({ id: k.id, key: k.key, track: k.track, pos: 0, status: 'completed', title: shortTitle(k.name), full: k.name, kept: true });
    D.tasks[k.id] = { kind: 'done', waits: [], gates: [], needed: [] };
  }
  for (const k of reviews) {
    if (D.tasks[k.id]) continue;
    g.tasks.push({ id: k.id, key: k.key, track: k.track, pos: k.position ?? 0, status: 'completed', title: shortTitle(k.name), full: k.name, kept: true,
      review: true, reviewScope: k.reviewScope || 'track', covers: Array.isArray(k.covers) ? k.covers : [], closed: k.closed || null, url: k.url || null });
    D.tasks[k.id] = { kind: 'done', waits: [], gates: [], needed: [] };
  }
  return { g, D };
}

/* The look from the views alone: what holds a task is in its waitsOn words ("after Q93",
   "after T-41 on TR-5", "after T-41 in the inbox"); the last movement is the caller's. */
export function viewLook(lastOf) {
  const words = (t) => (Array.isArray(t.waitsOn) ? t.waitsOn : []);
  return {
    gates: (t) => words(t).map((w) => /^after (Q\d+)$/.exec(w)).filter(Boolean).map((m) => m[1]),
    trackOf: (on, t, tv) => {
      for (const w of words(t)) {
        if (w === 'after ' + on) return tv.id;
        if (w.startsWith('after ' + on + ' on ')) return w.slice(('after ' + on + ' on ').length);
        if (w === 'after ' + on + ' in the inbox') return 'the inbox';
      }
      return 'the inbox';
    },
    front: () => null,
    moved: (tv) => ({ last: (lastOf && lastOf(tv)) || null, days: null }),
  };
}
