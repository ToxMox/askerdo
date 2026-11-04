/* The board's graph layout, pure: the graph in, each station's column and
   row and each line's band out; the drawing is the caller's. */

const ENDED = new Set(['completed', 'dropped']);

/* graph = { tracks: [{ id, parent?, junction?, doneBefore? }], tasks: [{ id, track, pos, status, promotedTo?, kept? }],
     edges: [[task, dependsOn], ...] }. Done and dropped tasks are counted, not drawn, except a kept one:
   a finished junction whose side line still runs, drawn so the side keeps hanging from it.
   Returns { cols, rows, stations: { id: { col, row, line, sub } },
     lines: [{ id, row, rows, level, firstCol, lastCol, done }], links: [{ from, to, kind, far?, via? }] }.
   kind: track (next on the same rail), branch (a rail leaving the station it depends on), merge (a second
   wait; far when no one-rail bend reaches it), cross (another line), junction (a side line leaves).
   via, on cross and junction links and far merges: the vertical climbs in the gap right of that column;
   a far merge with no via has no clear route and is only named. */
export function layoutGraph(g) {
  const task = {}, trk = {}, order = {};
  g.tasks.forEach((t) => { task[t.id] = t; });
  g.tracks.forEach((tr, i) => { trk[tr.id] = tr; order[tr.id] = i; });
  const isOpen = (id) => !!task[id] && (!ENDED.has(task[id].status) || !!task[id].kept) && trk[task[id].track] !== undefined;
  const open = g.tasks.filter((t) => isOpen(t.id));
  open.sort((a, b) => (order[a.track] - order[b.track]) || (a.pos - b.pos));

  const deps = {}, byTrack = {};
  open.forEach((t) => { deps[t.id] = []; (byTrack[t.track] = byTrack[t.track] || []).push(t); });
  g.edges.forEach((e) => {
    if (isOpen(e[0]) && isOpen(e[1]) && deps[e[0]].indexOf(e[1]) < 0) deps[e[0]].push(e[1]);
  });
  // an edge that another path already implies is not drawn
  const anc = {};
  const ancestors = (id) => {
    if (anc[id]) return anc[id];
    const s = anc[id] = {};
    deps[id].forEach((d) => { s[d] = 1; const a = ancestors(d); for (const k in a) s[k] = 1; });
    return s;
  };
  const rdeps = {};
  open.forEach((t) => {
    rdeps[t.id] = deps[t.id].filter((d) => !deps[t.id].some((o) => o !== d && ancestors(o)[d]));
  });
  // a side track's first stations sit right of its junction, so the branch leaves to the right
  const hang = {};
  open.forEach((t) => {
    const tr = trk[t.track];
    if (!tr.junction || !isOpen(tr.junction)) return;
    if (!deps[t.id].some((d) => task[d].track === t.track)) hang[t.id] = tr.junction;
  });

  const col = {}, busy = {};
  const colOf = (id) => {
    if (col[id] !== undefined) return col[id];
    if (busy[id]) return 0; // cycles are refused at write; this only keeps a bad row from hanging a draw
    busy[id] = true;
    let c = 0;
    deps[id].forEach((d) => { c = Math.max(c, endOf(d) + 1); });
    if (hang[id]) c = Math.max(c, colOf(hang[id]) + 1);
    busy[id] = false;
    col[id] = c;
    return c;
  };
  // a task that waits on a promoted task waits for its whole side track
  const endOf = (id) => {
    let c = colOf(id);
    const p = task[id].promotedTo;
    if (p && byTrack[p]) byTrack[p].forEach((s) => { c = Math.max(c, colOf(s.id)); });
    return c;
  };
  open.forEach((t) => { colOf(t.id); });
  // a root line whose finished work comes before its first station keeps a column for its beads
  const leads = new Set(g.tracks.filter((tr) => tr.lead && !(tr.parent && trk[tr.parent]) && open.some((t) => t.track === tr.id && col[t.id] === 0)).map((tr) => tr.id));
  if (leads.size) open.forEach((t) => { col[t.id] += 1; });

  // lines in tree order: a parent, then its side tracks, the one leaving furthest right first,
  // so no branch's connector has to cross a sibling line's stations
  const kids = {}, roots = [];
  g.tracks.forEach((tr) => {
    if (tr.parent && trk[tr.parent]) (kids[tr.parent] = kids[tr.parent] || []).push(tr); else roots.push(tr);
  });
  const jcol = (tr) => (tr.junction && isOpen(tr.junction) ? col[tr.junction] : -1);
  const seq = [];
  const walk = (list, level) => {
    list.slice().sort((a, b) => (jcol(b) - jcol(a)) || (order[a.id] - order[b.id]))
      .forEach((tr) => { seq.push([tr, level]); walk(kids[tr.id] || [], level + 1); });
  };
  walk(roots, 0);

  const stations = {}, lines = [], next = {}, head = {};
  let row = 0, cols = 0;
  seq.forEach(([tr, level]) => {
    const list = (byTrack[tr.id] || []).slice();
    if (!list.length) return; // a finished line is not drawn
    list.sort((a, b) => (col[a.id] - col[b.id]) || (a.pos - b.pos));
    const mine = {}, inD = {}, inU = {};
    list.forEach((t) => { mine[t.id] = 1; inU[t.id] = []; });
    list.forEach((t) => {
      inD[t.id] = rdeps[t.id].filter((d) => mine[d]);
      inD[t.id].forEach((d) => { inU[d].push(t.id); });
    });
    // rails: the longest chain still unplaced becomes the next rail, so the first is the line's trunk
    const free = {}, chains = [];
    list.forEach((t) => { free[t.id] = 1; });
    for (;;) {
      const memo = {};
      let best = null;
      const longest = (id) => {
        if (memo[id]) return memo[id];
        let b = memo[id] = [id];
        inU[id].forEach((u) => { if (free[u]) { const p = longest(u); if (p.length + 1 > b.length) b = [id].concat(p); } });
        return (memo[id] = b);
      };
      list.forEach((t) => { if (free[t.id]) { const p = longest(t.id); if (!best || p.length > best.length) best = p; } });
      if (!best) break;
      best.forEach((id) => { delete free[id]; });
      chains.push(best);
    }
    // each chain takes the rail, above or below, nearest the rails it connects to (a second wait more
    // than one rail away is written under the station, not drawn); chains a column apart share a rail
    const rails = [], where = {};
    chains.forEach((ch) => {
      const h = ch[0];
      let src = null;
      inD[h].forEach((d) => { if (src === null || col[d] > col[src]) src = d; });
      const start = src !== null ? col[src] + 1 : col[h], end = col[ch[ch.length - 1]];
      let pick = null, cost = Infinity;
      const at = (r) => rails.indexOf(r);
      // a wait climbing past another rail's work in the gap it joins by crosses that rail, so the far side of
      // a fan-in's station is dearer than the near one
      const past = (p, q, c) => { let n = 0; for (let k = Math.min(p, q) + 1; k < Math.max(p, q); k++) if (rails[k].ivs.some((iv) => iv[0] <= c - 1 && iv[1] >= c)) n++; return n; };
      const score = (p) => {
        let c = 0;
        ch.forEach((id) => {
          inD[id].concat(inU[id]).forEach((o) => {
            if (!where[o]) return;
            const q = at(where[o]), s = Math.abs(q - p);
            c += s + (s > 1 ? 10 : 0) + 12 * past(p, q, Math.max(col[o], col[id]));
          });
        });
        return c;
      };
      rails.forEach((r, i) => {
        if (!r.ivs.every((iv) => start > iv[1] + 1 || end < iv[0] - 1)) return;
        const c = score(i);
        if (c < cost) { cost = c; pick = r; }
      });
      const c1 = score(rails.length), c0 = score(-1);
      if (c1 < cost) { cost = c1; pick = 'bottom'; }
      if (c0 < cost) { cost = c0; pick = 'top'; }
      if (pick === 'bottom' || pick === 'top') {
        const nr = { ivs: [] };
        if (pick === 'top') rails.unshift(nr); else rails.push(nr);
        pick = nr;
      }
      pick.ivs.push([start, end]);
      ch.forEach((id, i) => { where[id] = pick; if (i) next[ch[i - 1]] = id; });
      if (src !== null) head[h] = src;
    });
    const sub = {};
    list.forEach((t) => { sub[t.id] = rails.indexOf(where[t.id]); });
    let rows = 1, first = Infinity, last = -1;
    list.forEach((t) => {
      const c = col[t.id];
      rows = Math.max(rows, sub[t.id] + 1); first = Math.min(first, c); last = Math.max(last, c); cols = Math.max(cols, c + 1);
      stations[t.id] = { col: c, row: row + sub[t.id], line: tr.id, sub: sub[t.id] };
    });
    const done = g.tasks.filter((t) => t.track === tr.id && ENDED.has(t.status) && !t.kept).length + (tr.doneBefore || 0);
    lines.push({ id: tr.id, row, rows, level, firstCol: leads.has(tr.id) ? first - 1 : first, lastCol: last, done });
    row += rows;
  });

  // a second wait one rail away bends through a gap clear of other stations; one further away climbs
  // a gap whose rows are clear on both sides, the one nearest the station that waits
  const taken = {};
  Object.keys(stations).forEach((id) => { taken[stations[id].row + ':' + stations[id].col] = 1; });
  const clear = (r, c0, c1) => { for (let c = c0; c <= c1; c++) if (taken[r + ':' + c]) return false; return true; };
  const open2 = (a, b, gp) => clear(a.row, a.col + 1, gp) && clear(b.row, gp + 1, b.col - 1);
  const bendable = (a, b) => {
    if (Math.abs(a.row - b.row) > 1) return false;
    for (let gp = a.col; gp < b.col; gp++) if (open2(a, b, gp)) return true;
    return false;
  };
  const links = [];
  open.forEach((t) => {
    if (!stations[t.id]) return;
    rdeps[t.id].forEach((d) => {
      if (!stations[d]) return;
      const kind = task[d].track !== t.track ? 'cross' : next[d] === t.id ? 'track' : head[t.id] === d ? 'branch' : 'merge';
      const lk = { from: d, to: t.id, kind };
      if (kind === 'merge') lk.far = !bendable(stations[d], stations[t.id]);
      if (lk.far) for (let gp = stations[t.id].col - 1; gp >= stations[d].col && lk.via === undefined; gp--) if (open2(stations[d], stations[t.id], gp)) lk.via = gp;
      links.push(lk);
    });
    if (hang[t.id] && stations[hang[t.id]]) links.push({ from: hang[t.id], to: t.id, kind: 'junction' });
  });

  // between lines, one vertical in a gap no band between them covers (a band's box is its columns);
  // a wait on another line turns in just before the station that waits
  const idx = {};
  lines.forEach((ln, i) => { idx[ln.id] = i; });
  links.forEach((lk) => {
    if (lk.kind !== 'cross' && lk.kind !== 'junction') return;
    const a = stations[lk.from], b = stations[lk.to];
    const lo = Math.min(idx[a.line], idx[b.line]), hi = Math.max(idx[a.line], idx[b.line]), cands = [];
    for (let c = a.col; c < b.col; c++) cands.push(c);
    if (lk.kind === 'cross') cands.reverse();
    let pick = a.col, best = Infinity;
    cands.forEach((c) => {
      let hits = 0;
      for (let k = lo + 1; k < hi; k++) if (c >= lines[k].firstCol && c < lines[k].lastCol) hits++;
      const score = hits * 4 + (clear(a.row, a.col + 1, c) ? 0 : 1) + (clear(b.row, c + 1, b.col - 1) ? 0 : 1);
      if (score < best) { best = score; pick = c; }
    });
    lk.via = pick;
  });
  return { cols, rows: row, stations, lines, links };
}

/* The Home tab's "My track's lines": the session's track, its parents, its side
   tracks and the lines it waits on or holds, as a set of track ids. */
export function linesTouching(g, me) {
  const keep = new Set(), byId = {}, trackOf = {}, live = {};
  g.tracks.forEach((t) => { byId[t.id] = t; });
  g.tasks.forEach((t) => { trackOf[t.id] = t.track; live[t.id] = !ENDED.has(t.status); });
  for (let t = byId[me]; t && !keep.has(t.id); t = byId[t.parent]) keep.add(t.id);
  const down = (id) => g.tracks.forEach((x) => { if (x.parent === id && !keep.has(x.id)) { keep.add(x.id); down(x.id); } });
  down(me);
  g.edges.forEach(([task, on]) => {
    if (!live[task] || !live[on]) return;
    if (trackOf[task] === me) keep.add(trackOf[on]);
    if (trackOf[on] === me) keep.add(trackOf[task]);
  });
  return keep;
}

/* The finished junctions to keep drawn: a side line with open tasks whose junction task
   is done, its parent among the views (graph.mjs keeps the same rule). Each as { id, track }. */
function keptJunctions(list) {
  const open = new Set(), ids = new Set(), out = new Map();
  for (const tv of list) { ids.add(tv.id); for (const t of tv.tasks || []) open.add(t.id); }
  for (const tv of list) {
    const j = tv.junction || {};
    if (!j.task || !j.track || !ids.has(j.track.id) || open.has(j.task.id) || out.has(j.task.id) || !(tv.tasks || []).length) continue;
    out.set(j.task.id, { id: j.task.id, track: j.track.id });
  }
  return [...out.values()];
}

/* The track verbs' workstream view into the layout's graph: view.tracks holds each track's
   trackView (server/verbs/tracks.mjs), in listTracks order. A view lists only open tasks, so
   the done count rides on the track; without a position, a task keeps the view's order. */
export function layoutInput(view) {
  const list = Array.isArray(view) ? view : (view && view.tracks) || [];
  const tracks = [], tasks = [], edges = [], seen = new Set();
  const kept = new Set();
  for (const k of keptJunctions(list)) {
    kept.add(k.id);
    tasks.push({ id: k.id, track: k.track, pos: 0, status: 'completed', kept: true });
  }
  /* a track's last completed review stays drawn (web/graph.mjs keptReviews) */
  for (const tv of list) {
    if (!(tv.tasks || []).length) continue;
    const last = (tv.finished || []).filter((f) => f && f.review && f.status === 'completed')
      .reduce((m, f) => (!m || (f.position ?? 0) > (m.position ?? 0) ? f : m), null);
    if (!last || kept.has(last.id)) continue;
    kept.add(last.id);
    tasks.push({ id: last.id, track: tv.id, pos: last.position ?? 0, status: 'completed', kept: true });
  }
  for (const tv of list) {
    const j = tv.junction || {};
    const tr = { id: tv.id, doneBefore: tv.done || 0 };
    /* finished code work no review folded, placed before the line's first station */
    const at = (tv.tasks || []).map((t, i) => t.position ?? i + 1).concat((tv.finished || []).filter((f) => kept.has(f.id)).map((f) => f.position ?? 0));
    if ((tv.finished || []).some((f) => f && !f.review && !f.covered && (f.position ?? 0) < Math.min(...at))) tr.lead = true;
    if (j.track) tr.parent = j.track.id;
    if (j.task) tr.junction = j.task.id;
    tracks.push(tr);
    (tv.tasks || []).forEach((t, i) => {
      const out = { id: t.id, track: tv.id, pos: t.position ?? i + 1, status: t.status };
      if (t.pointer) out.promotedTo = t.pointer;
      tasks.push(out);
    });
    for (const e of tv.edges || []) {
      const k = e.task + '>' + e.on;
      if ((e.done && !kept.has(e.on)) || seen.has(k)) continue;
      seen.add(k);
      edges.push([e.task, e.on]);
    }
  }
  return { tracks, tasks, edges };
}
