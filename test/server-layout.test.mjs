/* The board's graph layout: the picture the views mock draws, fed from the tracks
   view. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshBoard } from './helpers/board-db.mjs';

const { putRecord } = await import('../server/records.mjs');
const g = await import('../server/verbs/graph.mjs');
const t = await import('../server/verbs/tracks.mjs');
const { layoutGraph, layoutInput, linesTouching } = await import('../server/layout.mjs');
const { graphOf, viewLook } = await import('../server/web/graph.mjs');
const { SKIN_PANE, SKIN_WEB, drawFit, drawGraph, lineCounts } = await import('../server/web/draw.mjs');

test('a parked parent, its side track and a wait across it lay out by depth, the side band at its junction, no connector through a band', () => {
  const db = freshBoard();
  putRecord(db, { key: 'ws000001', kind: 'workstream', fields: { id: 'WS-1', key: 'ws000001', name: 'Board', status: 'open', labelHistory: ['WS-1 2026-10-25'] }, body: '' });
  const add = (track, name) => t.capture(db, { track, name }, 'cli');
  const dep = (task, on) => g.addEdge(db, { task: task.id, on: on.id, reason: 'order' }, 'cli');

  const main = t.newTrack(db, { name: 'Main line', workstream: 'WS-1', session: 's1' }, { session: 's1' });
  const [done, a1, a2] = ['Done first', 'The junction', 'After it'].map((n) => add(main.id, n));
  dep(a1, done); dep(a2, a1);
  db.prepare("UPDATE records SET fields = json_set(fields, '$.status', 'completed') WHERE key = ?").run(done.key);
  g.startTask(db, { task: a1.id }, { session: 's1' });
  const side = t.splinter(db, { from: main.id, name: 'Side line' }, { session: 's1' });
  const [s1, s2, s3] = ['One', 'Two', 'Three'].map((n) => add(side.id, n));
  dep(s2, s1); dep(s3, s2);
  const other = t.newTrack(db, { name: 'Other line', workstream: 'WS-1' }, 'cli');
  const o = add(other.id, 'Waits on both');
  dep(o, a1); dep(o, s2);
  const lone = t.newTrack(db, { name: 'Unrelated', workstream: 'WS-1' }, 'cli');
  const u = add(lone.id, 'Alone');

  const view = { tracks: t.listTracks(db, { workstream: 'WS-1' }).tracks.map((x) => t.trackView(db, { track: x.id })) };
  const input = layoutInput(view);
  const L = layoutGraph(input);
  const colOf = Object.fromEntries([a1, a2, s1, s2, s3, o, u].map((x) => [x.id, L.stations[x.id].col]));
  assert.deepEqual(colOf, { [a1.id]: 0, [a2.id]: 1, [s1.id]: 1, [s2.id]: 2, [s3.id]: 3, [o.id]: 3, [u.id]: 0 }, 'columns by dependency depth');
  assert.equal(L.stations[done.id], undefined, 'a done task is not a station');
  const line = (id) => L.lines.find((l) => l.id === id);
  assert.equal(line(main.id).done, 1, 'but its line counts it');

  assert.equal(line(side.id).firstCol, L.stations[a1.id].col + 1, 'the side band starts at its junction');
  assert.ok(L.links.some((l) => l.kind === 'junction' && l.from === a1.id && l.to === s1.id));

  const order = L.lines.map((l) => l.id);
  let passed = 0;
  for (const lk of L.links.filter((l) => l.via !== undefined)) {
    const [i, j] = [order.indexOf(L.stations[lk.from].line), order.indexOf(L.stations[lk.to].line)].sort((x, y) => x - y);
    for (const ln of L.lines.slice(i + 1, j)) {
      passed += 1;
      assert.ok(lk.via < ln.firstCol || lk.via >= ln.lastCol, lk.from + ' to ' + lk.to + ' climbs through ' + ln.id + "'s band");
    }
  }
  assert.ok(passed > 0, 'the wait on the main line passes the side line');

  assert.deepEqual([...linesTouching(input, side.id)].sort(), [main.id, other.id, side.id].sort(), "the Home tab's lines leave the unrelated one out");

  /* the junction task done, the side line still hangs from it, drawn done and counted once */
  db.prepare("UPDATE records SET fields = json_set(fields, '$.status', 'completed') WHERE key = ?").run(a1.key);
  const after = t.listTracks(db, { workstream: 'WS-1' }).tracks.map((x) => t.trackView(db, { track: x.id }));
  const L2 = layoutGraph(layoutInput(after));
  assert.ok(L2.stations[a1.id], 'the finished junction is still a station');
  assert.equal(L2.lines.find((l) => l.id === side.id).firstCol, L2.stations[a1.id].col + 1, 'the side band still starts right of it');
  assert.ok(L2.links.some((l) => l.kind === 'junction' && l.from === a1.id && l.to === s1.id));
  assert.equal(L2.lines.find((l) => l.id === main.id).done, 2, 'the kept junction is not counted twice');
  const G2 = graphOf(after, Date.now(), viewLook());
  assert.equal(G2.D.tasks[a1.id].kind, 'done');
  assert.match(drawGraph(L2, G2.D, G2.g, SKIN_WEB, { interactive: true }), new RegExp('data-task="' + a1.id + '"'));
});

test('a side line with no junction task names its parent line; the counts split the open tasks from the longest chain; a wait no gap clears of a caption stops at its words', () => {
  const tv = (id, name, tasks, extra) => ({
    id, key: id.toLowerCase(), name, state: 'waiting', stalled: false, noHandoff: false, parkReason: null, holder: null, done: 0, sideTracks: [],
    critical: { length: tasks.length, path: tasks.map((x) => x.id) }, tasks, edges: [], ...extra,
  });
  const task = (id, ready) => ({ id, key: id.toLowerCase(), name: 'Task ' + id, status: 'open', ready });
  const views = [
    tv('TR-1', 'Main line', [task('T-1', true), task('T-2', false), task('T-3', false)], { edges: [{ task: 'T-2', on: 'T-1' }, { task: 'T-3', on: 'T-2' }] }),
    /* wide enough that its caption takes two lines, where the parent is written */
    tv('TR-2', 'Side line', [task('T-4', true), task('T-5', false), task('T-6', false)],
      { junction: { track: { id: 'TR-1', key: 'tr-1' }, task: null }, edges: [{ task: 'T-5', on: 'T-4' }, { task: 'T-6', on: 'T-5' }] }),
  ];
  const { g, D } = graphOf(views, Date.now(), viewLook());
  const L = layoutGraph(layoutInput(views));
  const svg = drawGraph(L, D, g, SKIN_WEB, { view: 3000 });
  const cap = /<g class="cap" data-track="TR-2">[\s\S]*?<\/g>/.exec(svg)[0];
  assert.ok(!/undefined/.test(cap) && /Main line/.test(cap), cap);
  /* open 3: 1 ready and 2 waiting add up to it; the chain of 3 and the 2 done stand apart */
  assert.deepEqual(lineCounts(g.tracks[0], D, 2).match(/\d+/g).map(Number), [3, 1, 2, 3, 2]);
  /* a narrow pane's strip card clamps the counts to two lines and still keeps the done count and the chain */
  const busy = [tv('TR-9', 'The look and the move', [task('T-11', true), task('T-12', true), task('T-13', true), task('T-14', true), task('T-15', false)],
    { state: 'active', holder: { session: 's1', pc: 'pc-1' }, done: 90, now: [{ id: 'T-11' }, { id: 'T-12' }], critical: { length: 7, path: ['T-14', 'T-15'] }, edges: [{ task: 'T-15', on: 'T-14' }] })];
  for (const t of busy[0].tasks.slice(0, 3)) t.status = 'in_progress';
  const B = graphOf(busy, Date.now(), viewLook());
  const narrow = /<g class="cap" data-track="TR-9">[\s\S]*?<\/g>/.exec(drawFit(layoutGraph(layoutInput(busy)), B.D, B.g, SKIN_PANE, { view: 250 }))[0];
  assert.ok(/90 done/.test(narrow) && /chain 7/.test(narrow), narrow);
  /* the wait's one gap runs under the lower line's caption, so the line skips the caption's words */
  const near = [tv('TR-3', 'Upper', [task('T-7', true), task('T-8', false)], { edges: [{ task: 'T-8', on: 'T-7' }, { task: 'T-8', on: 'T-9' }] }),
    tv('TR-4', 'Lower line with a long name', [task('T-9', true)])];
  const N = graphOf(near, Date.now(), viewLook());
  const drawn = drawGraph(layoutGraph(layoutInput(near)), N.D, N.g, SKIN_WEB, { view: 3000 });
  const jump = /<path d="[^"]*V([\d.]+)M[\d.]+ ([\d.]+)[^"]*" fill="none" stroke="[^"]*" stroke-width="2.2" stroke-dasharray/.exec(drawn);
  const words = [.../<g class="cap" data-track="TR-4">(?:(?!<\/g>)[\s\S])*<\/g>/.exec(drawn)[0].matchAll(/<text x="[\d.]+" y="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(jump && words.length && words.every((y) => y > Number(jump[2]) && y < Number(jump[1])), 'the wait skips every line of the caption: ' + (jump && jump.slice(1)) + ' ' + words);
  /* The shape: a chain a to d where c also waits on e, f and g and d on h and i, and
     j waits on c. Every wait is a drawn path ending at its station, none is left as
     words; in the pane's strips the far ones meet by ports */
  const pairs = [['b', 'a'], ['c', 'b'], ['d', 'c'], ['c', 'e'], ['c', 'f'], ['c', 'g'], ['d', 'h'], ['d', 'i'], ['j', 'c']];
  const tr10 = [tv('line', 'Build line', [...'abcdefghij'].map((id) => task(id, 'aefghi'.includes(id))),
    { critical: { length: 4, path: ['a', 'b', 'c', 'd'] }, edges: pairs.map(([on1, on2]) => ({ task: on1, on: on2 })) })];
  const R = graphOf(tr10, Date.now(), viewLook());
  const RL = layoutGraph(layoutInput(tr10));
  const whole = drawGraph(RL, R.D, R.g, SKIN_WEB, { view: 3000 });
  const endOf = (d) => { let x, y; for (const [, c, a] of d.matchAll(/([MHVCQ])([^MHVCQ]*)/g)) { const n = a.trim().split(/[ ,]+/).map(Number); if (c === 'H') x = n[0]; else if (c === 'V') y = n[0]; else [x, y] = n.slice(-2); } return [x, y]; };
  const into = (id, svg = whole) => {
    const at = new RegExp('data-task="' + id + '"><title>[^<]*</title><circle cx="([\\d.]+)" cy="([\\d.]+)"').exec(svg).slice(1).map(Number);
    return [...new Set([...svg.matchAll(/<path d="([^"]+)" fill="none"/g)].map((m) => m[1]).filter((d) => { const e = endOf(d); return Math.abs(e[0] - at[0]) < 0.5 && Math.abs(e[1] - at[1]) < 0.5; }))];
  };
  const from = (id, svg = whole) => {
    const at = new RegExp('data-task="' + id + '"><title>[^<]*</title><circle cx="([\\d.]+)" cy="([\\d.]+)"').exec(svg).slice(1).map(Number);
    return [...svg.matchAll(/<path d="M([\d.]+) ([\d.]+)/g)].filter((m) => Math.abs(m[1] - at[0]) < 0.5 && Math.abs(m[2] - at[1]) < 0.5);
  };
  assert.ok([...'efghi'].every((id) => from(id).length) && into('c').length && into('d').length, 'each wait into c and d leaves its station as a line');
  assert.ok(!/also after/.test(whole), 'no wait left as words');
  /* the release waited on 13 running tasks; every one joins one trunk into it, the critical one white on it */
  const fixes = Array.from({ length: 13 }, (_, i) => 'f' + i);
  const manyFixes = [tv('line', 'Updates', fixes.map((id) => ({ ...task(id, false), status: 'in_progress', agent: 'lane' })).concat([task('r', false), task('o', false)]),
    { critical: { length: 3, path: ['f9', 'r', 'o'] }, now: fixes.map((id) => ({ id })), edges: fixes.map((id) => ({ task: 'r', on: id })).concat([{ task: 'o', on: 'r' }]) })];
  const W = graphOf(manyFixes, Date.now(), viewLook()), WL = layoutGraph(layoutInput(manyFixes));
  for (const view of [431, 900]) {
    const fan = drawGraph(WL, W.D, W.g, SKIN_PANE, { view });
    // the one on the station's own row runs straight in; the others turn at the trunk
    const turns = new Set(fixes.flatMap((id) => from(id, fan).map((m) => (/Q([\d.]+) /.exec(fan.slice(m.index, fan.indexOf('"', m.index + 9))) || [])[1]).filter(Boolean)));
    assert.ok(!/also after/.test(fan) && fixes.every((id) => from(id, fan).length) && turns.size === 1, view + ': every wait drawn, all turning onto one trunk at ' + [...turns]);
  }
  /* in the pane at 438 px the far waits into d meet the trunk past where j's branch has left it, so neither reads as feeding j */
  const pane = drawGraph(RL, R.D, R.g, SKIN_PANE, { view: 431 });
  const curve = /H([\d.]+)C[\d.]+ [\d.]+ [\d.]+ [\d.]+ ([\d.]+) /.exec(into('j', pane).find((d) => d.includes('C'))).slice(1).map(Number);
  const xAtV = (d) => { let x; for (const [, c, a] of d.matchAll(/([MHVCQ])([^MHVCQ]*)/g)) { const n = a.trim().split(/[ ,]+/).map(Number); if (c === 'V') return x; x = c === 'H' ? n[0] : n[n.length - 2]; } };
  const joins = into('d', pane).filter((d) => d.includes('V')).map(xAtV);
  assert.ok(joins.length === 2 && joins.every((x) => x >= curve[0] + 0.75 * (curve[1] - curve[0])), 'joins ' + joins + ' past the branch ' + curve);
  const strips = drawFit(RL, R.D, R.g, SKIN_PANE, { view: 250 });
  assert.ok((strips.match(/<svg /g) || []).length > 1 && /r="3.4"/.test(strips) && !/also after/.test(strips), 'in strips the far waits meet by ports');
});

/* seeded random tracks at every pane and web width draw no line through a station or its words.
   A wait whose every route needs a gap another line already holds past full labels (one lane fits there) keeps
   its words, naming a real wait of that station */
test('random tracks draw no line through a station or its words; a wait with no free lane keeps its words', async () => {
  const { paneMeasure: measure } = await import('../lib/mod-core.mjs');
  const { SKIN_NARROW, viewCols } = await import('../server/web/draw.mjs');
  const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // a track: lanes of work, now and then a wait on another lane, a fan-out and a fan-in
  const track = (seed) => {
    const r = rng(seed), n = 6 + Math.floor(r() * 15), deps = Array.from({ length: n }, () => new Set()), ends = [];
    for (let i = 0; i < n; i++) {
      const roll = r();
      if (i && roll < 0.12 && ends.length > 2) { ends.sort(() => r() - 0.5).slice(0, 3 + Math.floor(r() * 8)).forEach((e) => deps[i].add(e)); ends.length = 0; ends.push(i); continue; }
      if (i && roll < 0.22) { const a = Math.floor(r() * i); for (let j = 3 + Math.floor(r() * 5); j > 0 && i < n; j--, i++) { deps[i].add(a); ends.push(i); } i--; continue; }
      if (i && ends.length && roll < 0.75) { const e = Math.floor(r() * ends.length); deps[i].add(ends[e]); ends[e] = i; } else ends.push(i);
      if (i > 2 && r() < 0.25) deps[i].add(Math.floor(r() * (i - 1)));
    }
    const memo = {}, chain = (i) => memo[i] || (memo[i] = [...deps[i]].reduce((b, d) => (chain(d).length >= b.length ? chain(d) : b), []).concat(['t' + i]));
    const path = deps.map((_, i) => chain(i)).reduce((b, c) => (c.length > b.length ? c : b), []);
    const tasks = deps.map((d, i) => ({ id: 't' + i, key: 't' + i, name: 'Task t' + i + ' word'.repeat(Math.floor(r() * 9)), status: !d.size && r() < 0.3 ? 'in_progress' : 'open', ready: !d.size, agent: 'lane' }));
    return [{ id: 'line', key: 'line', name: 'Random ' + seed, state: 'active', done: 0, holder: { session: 's', pc: 'pc' }, critical: { length: path.length, path },
      tasks, now: tasks.filter((t) => t.status === 'in_progress').map((t) => ({ id: t.id })), edges: deps.flatMap((d, i) => [...d].map((on) => ({ task: 't' + i, on: 't' + on }))) }];
  };
  // points every 2 px or so along a path
  const points = (d) => {
    const out = []; let x = 0, y = 0;
    for (const [, c, a] of d.matchAll(/([MHVQC])([^MHVQC]*)/g)) {
      const n = a.trim().split(/[ ,]+/).map(Number), x0 = x, y0 = y;
      if (c === 'M') { [x, y] = n; continue; }
      const end = c === 'H' ? [n[0], y] : c === 'V' ? [x, n[0]] : n.slice(-2);
      const at = c === 'Q' ? (t) => [0, 1].map((k) => (1 - t) ** 2 * [x0, y0][k] + 2 * (1 - t) * t * n[k] + t * t * n[2 + k])
        : c === 'C' ? (t) => [0, 1].map((k) => (1 - t) ** 3 * [x0, y0][k] + 3 * (1 - t) ** 2 * t * n[k] + 3 * (1 - t) * t * t * n[2 + k] + t ** 3 * n[4 + k])
          : (t) => [x0 + (end[0] - x0) * t, y0 + (end[1] - y0) * t];
      for (let k = 1, m = Math.ceil(Math.hypot(end[0] - x0, end[1] - y0) / 2) + 1; k <= m; k++) out.push(at(k / m));
      [x, y] = end;
    }
    return out;
  };
  for (let seed = 1; seed <= 30; seed++) {
    const views = track(seed), { g, D } = graphOf(views, 0, viewLook()), L = layoutGraph(layoutInput(views));
    for (const [S, view] of [[SKIN_PANE, 236.7], [SKIN_PANE, 431.1], [SKIN_PANE, 896], [SKIN_PANE, 1394.7], [SKIN_NARROW, 328], [SKIN_NARROW, 628], [SKIN_WEB, 868]]) {
      const P = drawGraph(L, D, g, S, { view, measure, parts: true, strip: viewCols(S, L.cols, view) || undefined });
      const where = seed + ' at ' + view;
      for (const d of new Set([...P.body.matchAll(/<path d="([^"]+)" fill="none"/g)].map((m) => m[1]))) {
        const pts = points(d), ends = [pts[0], pts[pts.length - 1]];
        for (const b of P.boxes) {
          // the words' glyphs, 3 px in from the box the router keeps clear
          const pad = b.ring ? 1 : 8, inside = (p) => p[0] > b.x0 + pad && p[0] < b.x1 - pad && p[1] > b.y0 + (b.ring ? 1 : 7) && p[1] < b.y1 - 3;
          if (b.ring && ends.some(inside)) continue;
          assert.ok(!pts.some(inside), where + ': ' + d + ' crosses ' + (b.ring ? 'the ring' : 'the words') + ' of ' + b.id);
        }
      }
      for (const m of P.body.matchAll(/data-task="([^"]+)"><title>[^<]*<\/title>([\s\S]*?)<\/g>/g)) {
        const t = m[2].replace(/<[^>]+>/g, '|'), i = t.indexOf('also after ');
        if (i >= 0) for (const n of t.slice(i).split('|').slice(0, 2).join(' ').match(/t\d+/g)) assert.ok(L.links.some((lk) => lk.from === n && lk.to === m[1]), where + ': ' + m[1] + ' names ' + n);
      }
    }
  }
});
