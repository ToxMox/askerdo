/* The redrawn picture: the mock's data drawn at the pane's narrowest and the board's
   widest, a station's trace, and the pane's Svg inside the app's limits; the model's critical
   path and its finished junctions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawPicture, traceSet } from '../server/web/picture-draw.mjs';
import { critOf, pictureOf } from '../server/web/picture-model.mjs';
import { paneMeasure, panePicture } from '../lib/mod-core.mjs';
import { pictureMockData } from './helpers/picture-mock-data.mjs';
import { pictureWsShapes } from './helpers/picture-ws-shapes.mjs';

const measure = (s, px, wt) => s.length * px * (wt >= 600 ? 0.6 : 0.55);
const VIEWS = [
  { level: 0, ws: null, tr: null, sel: null },
  { level: 1, ws: 'WS-12', tr: null, sel: 'pill:TR-12' },
  { level: 2, ws: 'WS-12', tr: 'TR-12', sel: 'stn:T-675' },
  { level: 2, ws: 'WS-12', tr: 'TR-3', sel: null },
  { level: 2, ws: 'WS-11', tr: 'TR-33', sel: 'stn:T-847' }
];

test('the picture draws every level inside its width, a station traces both ways, and the pane Svg keeps the app limits', () => {
  const P = pictureMockData();
  for (const skin of ['web', 'pane']) for (const width of [238, 1400]) for (const V of VIEWS) {
    const at = skin + ' ' + width + ' ' + JSON.stringify(V);
    const r = drawPicture(P, V, { skin, width, measure, icons: { fav: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="9"/></svg>' } });
    assert.equal(r.w, width, at);
    assert.ok(!/NaN|undefined/.test(r.svg), 'no broken number: ' + at);
    const boxes = [...r.svg.matchAll(/<rect x="([-\d.]+)" y="[-\d.]+" width="([\d.]+)"/g)].map((m) => [+m[1], +m[2]]);
    for (const [x, w] of boxes.concat(r.hits.map((h) => [h.x, h.w]))) assert.ok(x >= 0 && x + w <= width + 0.5, 'a box out of the width at ' + at + ': ' + x + '+' + w);
    if (skin === 'pane') assert.ok(r.svg.length <= 131072 && r.w <= 4096 && r.h <= 4096, 'the pane Svg past the app limits: ' + at);
  }
  // T-676 waits on T-674 and T-675 and frees its chain, on through T-289 on another track
  const lit = traceSet(P, VIEWS[2], 'stn:T-676');
  for (const id of ['T-674', 'T-675', 'T-677', 'T-283', 'T-289', 'T-326']) assert.ok(lit['stn:' + id], id + ' lit by T-676');
  assert.ok(!lit['stn:T-17'] && !lit['stn:T-288'], 'a station off the trace stays dim');
  // the board's data has no hand-cut chip name: the whole name still leaves the line one row at the board's width
  for (const w of P.ws['WS-12'].tracks) delete w.chip;
  const r = drawPicture(P, VIEWS[2], { skin: 'web', width: 1400, measure });
  assert.equal(r.pos['T-675'].y, r.pos['T-283'].y, 'the line drew one station a row');
  assert.match(r.svg, /… opens</, 'the name gave way, its verb kept');
  // a pill's counts wrap whole in the 238 px pane (a 194 px picture); a park's head keeps its id's row at the board's width
  const texts = (svg) => [...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: +m[1], y: +m[2], s: m[3] }));
  const narrow = texts(drawPicture(P, VIEWS[1], { skin: 'pane', width: 194, measure }).svg);
  for (const t of P.ws['WS-12'].tracks) assert.ok(narrow.some((x) => x.s.endsWith(t.waiting + ' waiting')), t.id + "'s counts cut");
  P.ws['WS-12'].tracks.find((t) => t.id === 'TR-14').words = 'parked: after Buoy maker and catalog';
  const wide = texts(drawPicture(P, VIEWS[1], { skin: 'web', width: 1400, measure }).svg);
  assert.equal(wide.find((x) => x.s.startsWith('parked: after Buoy')).y, wide.find((x) => x.s === 'TR-14').y, 'the head left the id row');
  // a station's words press as its icon does, on the board's line and on the pane's rails, and its answer chip presses over it
  const inside = (h, x, y) => x >= h.x && x <= h.x + h.w && y >= h.y - 12 && y <= h.y + h.h;
  for (const [skin, width] of [['web', 1400], ['pane', 238]]) {
    const r = drawPicture(P, VIEWS[3], { skin, width, measure }), at = skin + ' ' + width;
    const hit = (k) => r.hits.findIndex((h) => h.k === k);
    const name = texts(r.svg).find((x) => x.s.startsWith('Merge branch'));
    assert.ok(inside(r.hits[hit('stn:T-326')], name.x + 5, name.y), "the station's name out of its press: " + at);
    assert.ok(hit('stn:T-326') < hit('ans:Q13'), 'the answer chip lies under the station: ' + at);
  }
  // five WS-7 tasks waiting on T-326 draw one chip that counts them, on the workstream and on the track
  P.ws['WS-12'].out = [1, 2, 3, 4, 5].map(() => ({ from: 'TR-3', task: 'T-326', ws: 'WS-7', text: 'WS-7 waits on T-326' }));
  for (const [V, width] of [[VIEWS[1], 1400], [VIEWS[1], 238], [VIEWS[3], 1400], [VIEWS[3], 238]]) {
    const r = drawPicture(P, { ...V, sel: null }, { skin: 'pane', width, measure }), at = V.level + ' ' + width;
    assert.equal(r.hits.filter((h) => h.k === 'ws:WS-7').length, 1, 'one chip for the five: ' + at);
    assert.match(texts(r.svg).map((x) => x.s).join(' '), /5 tasks/, 'the chip counts them: ' + at);
  }
  // two parks opening on one track stand at one depth, side by side, never on each other
  P.ws['WS-12'].links = P.ws['WS-12'].links.map((l) => (l.from === 'TR-13' && l.to === 'TR-14' ? { ...l, from: 'TR-12' } : l));
  const two = drawPicture(P, { ...VIEWS[1], sel: null }, { skin: 'web', width: 1400, measure }).pos;
  assert.notEqual(two['TR-13'].x + ',' + two['TR-13'].y, two['TR-14'].x + ',' + two['TR-14'].y, 'TR-13 and TR-14 drawn on each other');
});

/* a picture's texts as boxes, cap top to baseline */
function textBoxes(svg, measure) {
  return [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map((m) => {
    const a = (n) => (new RegExp('\\b' + n + '="([^"]*)"').exec(m[1]) || [])[1];
    const s = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const px = +a('font-size'), w = measure(s, px, +(a('font-weight') || 400)) + (+a('letter-spacing') || 0) * s.length;
    const x = +a('x') - (a('text-anchor') === 'middle' ? w / 2 : a('text-anchor') === 'end' ? w : 0);
    return { k: 'text "' + s + '"', x, y: +a('y') - px * 0.8, w, h: px };
  });
}
/* a segment through a box's inside, 1 px in (Liang-Barsky) */
function through(s, b) {
  let t0 = 0, t1 = 1;
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  for (const [p, q] of [[-dx, s.x1 - b.x - 1], [dx, b.x + b.w - 1 - s.x1], [-dy, s.y1 - b.y - 1], [dy, b.y + b.h - 1 - s.y1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; t0 = Math.max(t0, t); } else { if (t < t0) return false; t1 = Math.min(t1, t); }
  }
  return t1 - t0 > 1e-6;
}

/* what in an Overview or a level-1 picture runs out of its width or over something else: its pills, chips,
   counts and free text (the parked caption) as boxes, each path's segments as lines (a chip's own are 2 px wide) */
function faults(r, measure, ov) {
  const bad = [], hits = (p) => r.hits.filter((h) => h.k.startsWith(p));
  const pills = hits(ov ? 'ws:' : 'pill:'), chips = ov ? [] : hits('ws:'), counts = ov ? hits('wlink:') : hits('link:').concat(hits('ans:'));
  const texts = textBoxes(r.svg, measure);
  /* a text belongs to the box its start stands in (a pill's tag rides its top edge) and stays inside its sides */
  const owner = (t) => pills.concat(chips, counts).find((b) => t.x >= b.x - 1 && t.x <= b.x + b.w && t.y + t.h >= b.y - 10 && t.y <= b.y + b.h);
  const free = texts.filter((t) => !owner(t));
  for (const t of texts) if (owner(t) && t.x + t.w > owner(t).x + owner(t).w + 1) bad.push(t.k + ' past ' + owner(t).k);
  const over = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
  const solid = pills.concat(chips, free);
  for (const b of solid.concat(counts)) if (b.x < -0.5 || b.x + b.w > r.w + 0.5) bad.push(b.k + ' out of the width');
  solid.forEach((a, i) => solid.slice(i + 1).forEach((b) => { if (over(a, b)) bad.push(a.k + ' over ' + b.k); }));
  for (const c of counts) for (const b of chips.concat(free, pills)) if (over(c, b)) bad.push(c.k + ' over ' + b.k);
  counts.forEach((a, i) => counts.slice(i + 1).forEach((b) => { if (over(a, b)) bad.push(a.k + ' over ' + b.k); }));
  const paths = [...r.svg.matchAll(/<path d="(M[-\d. LVH]+)"[^>]*stroke-width="([\d.]+)"/g)].map((m) => {
    let x = 0, y = 0;
    const segs = [];
    for (const c of m[1].matchAll(/([MLVH])([-\d.]+)(?: ([-\d.]+))?/g)) {
      const [nx, ny] = c[1] === 'V' ? [x, +c[2]] : c[1] === 'H' ? [+c[2], y] : [+c[2], +c[3]];
      if (c[1] !== 'M') segs.push({ x1: x, y1: y, x2: nx, y2: ny });
      x = nx; y = ny;
    }
    /* a link's ends name the two pills it joins */
    const on = (px, py) => (pills.find((p) => px >= p.x - 2 && px <= p.x + p.w + 2 && py >= p.y - 2 && py <= p.y + p.h + 2) || {}).k;
    const ends = segs.length ? [on(segs[0].x1, segs[0].y1), on(x, y)].sort().join() : '';
    return { link: +m[2] !== 2, segs, ends };
  });
  const id = (s) => s.x1 + ',' + s.y1 + ' ' + s.x2 + ',' + s.y2;
  const cross = through;
  /* a line may start in a pill's round corner, so a pill counts from 8 px in */
  const cores = pills.map((p) => ({ ...p, y: p.y + 8, h: p.h - 16 }));
  for (const p of paths) for (const s of p.segs) {
    for (const b of chips.concat(cores, free)) if (cross(s, b)) bad.push('a line through ' + b.k + ' at ' + id(s));
    /* under a count only its own link, or one between the same two tracks (the count drawn on top) */
    for (const c of counts) {
      const pair = c.k.startsWith('link:') && c.k.slice(5).split('>').map((t) => 'pill:' + t).sort().join();
      const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1), mid = L > 0 && Math.abs((c.x + c.w / 2 - s.x1) * (s.y2 - s.y1) - (c.y + c.h / 2 - s.y1) * (s.x2 - s.x1)) / L < 2;
      if (!(p.link && (p.ends === pair || mid)) && cross(s, { x: c.x + 2, y: c.y + 2, w: c.w - 4, h: c.h - 4 })) bad.push('a line under ' + c.k + ' at ' + id(s));
    }
  }
  /* two links never run along each other, and none crosses a chip's line */
  const links = paths.filter((p) => p.link).flatMap((p) => p.segs), stubs = paths.filter((p) => !p.link).flatMap((p) => p.segs);
  links.forEach((a, i) => links.slice(i + 1).forEach((b) => {
    const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy);
    const off = (x, y) => Math.abs((x - a.x1) * dy - (y - a.y1) * dx) / L, along = (x, y) => ((x - a.x1) * dx + (y - a.y1) * dy) / L;
    if (L < 1 || off(b.x1, b.y1) > 1.5 || off(b.x2, b.y2) > 1.5) return;
    const lo = Math.max(0, Math.min(along(b.x1, b.y1), along(b.x2, b.y2))), hi = Math.min(L, Math.max(along(b.x1, b.y1), along(b.x2, b.y2)));
    if (hi - lo > 4) bad.push('two links along each other at ' + id(a));
  }));
  for (const s of stubs) for (const q of links) {
    if (cross(q, { x: Math.min(s.x1, s.x2) - 1, y: Math.min(s.y1, s.y2) - 1, w: Math.abs(s.x2 - s.x1) + 2, h: Math.abs(s.y2 - s.y1) + 2 })) bad.push('a link across a chip line at ' + id(s));
  }
  return bad;
}

/* what in a track's picture runs out of its width or up under the board's crumb bar (the picture's first 36 px),
   stands on another station or chip (an answer chip in its station's words aside), steps back along the line (a fold
   steps down to the next band), or runs a line through a chip or words (a curve by its points) */
function trackFaults(r, P, ws, tr, skin, measure) {
  const bad = [], floor = skin === 'web' ? 36 : 0;
  const boxes = r.hits.filter((h) => /^(stn|jump|trk|ws|ans|bead):/.test(h.k));
  for (const b of boxes) if (b.x < -0.5 || b.x + b.w > r.w + 0.5 || b.y < floor) bad.push(b.k + ' out of the picture at ' + [b.x, b.y, b.w, b.h].join());
  const over = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
  const holds = (a, b) => b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.w <= a.x + a.w + 1 && b.y + b.h <= a.y + a.h + 1;
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
    if (over(a, b) && !(a.k.startsWith('stn:') && b.k.startsWith('ans:') && holds(a, b)) && !(b.k.startsWith('stn:') && a.k.startsWith('ans:') && holds(b, a))) bad.push(a.k + ' over ' + b.k);
  }));
  const sp = P.ws[ws].tracks.find((t) => t.id === tr).spine.filter((id) => r.pos[id]);
  for (let i = 1; i < sp.length; i++) {
    const a = r.pos[sp[i - 1]], b = r.pos[sp[i]];
    if ((b.x < a.x && b.y <= a.y) || b.y < a.y || (b.x === a.x && b.y === a.y)) bad.push('the line steps back from ' + sp[i - 1] + ' to ' + sp[i]);
  }
  const keep = r.hits.filter((h) => /^(jump|trk|ws|ans):/.test(h.k)).concat(textBoxes(r.svg, measure));
  for (const m of r.svg.matchAll(/<path\b[^>]*?\bd="([MLHVQC][-\d. MLHVQC]*)"[^>]*>/g)) {
    let x = 0, y = 0;
    const segs = [], to = (nx, ny) => { segs.push({ x1: x, y1: y, x2: nx, y2: ny }); x = nx; y = ny; };
    for (const c of m[1].matchAll(/([MLHVQC])([-\d. ]+)/g)) {
      const v = c[2].trim().split(/\s+/).map(Number), x0 = x, y0 = y;
      if (c[1] === 'M') { x = v[0]; y = v[1]; } else if (c[1] === 'L') to(v[0], v[1]); else if (c[1] === 'H') to(v[0], y); else if (c[1] === 'V') to(x, v[0]);
      else for (let t = 0.125; t <= 1; t += 0.125) {
        const u = 1 - t, q = c[1] === 'Q', [ex, ey] = q ? [v[2], v[3]] : [v[4], v[5]];
        to(q ? u * u * x0 + 2 * u * t * v[0] + t * t * ex : u * u * u * x0 + 3 * u * u * t * v[0] + 3 * u * t * t * v[2] + t * t * t * ex,
          q ? u * u * y0 + 2 * u * t * v[1] + t * t * ey : u * u * u * y0 + 3 * u * u * t * v[1] + 3 * u * t * t * v[3] + t * t * t * ey);
      }
    }
    for (const s of segs) for (const b of keep) if (through(s, b)) bad.push('a line through ' + b.k + ' at ' + [s.x1, s.y1, s.x2, s.y2].map(Math.round).join());
  }
  return [...new Set(bad)];
}
/* one task chain twenty long on one track, as the berth fix line, with a task beside it feeding its fifth */
function longTrack() {
  const ids = Array.from({ length: 20 }, (_, i) => 'T-' + (500 + i)), tasks = {};
  ids.forEach((id, i) => { tasks[id] = { id, tr: 'TR-24', name: 'Berth fix step ' + (i + 1) + ' and its verification', st: i ? 'waits' : 'ready', waits: i ? [ids[i - 1]] : [], cross: [], frees: i < 19 ? [ids[i + 1]] : [] }; });
  tasks['T-499'] = { id: 'T-499', tr: 'TR-24', name: 'A side check the fifth step waits on', st: 'ready', waits: [], cross: [], frees: ['T-504'] };
  tasks['T-504'].waits.push('T-499');
  const tr = { id: 'TR-24', ws: 'WS-14', name: 'Berth fix and verification', state: 'waiting', words: 'waiting', open: 21, waiting: 20, done: 0, spine: ids, from: null, doneRun: 0, junctions: [] };
  return { look: null, ov: [], ovLinks: [], ans: {}, tasks, ws: { 'WS-14': { id: 'WS-14', name: 'Berths', crit: { n: 20, from: ids[0], to: ids[19], path: ids }, tracks: [tr], links: [], out: [], in: [] } } };
}
/* three tracks in a row, the third waiting on both others, and two tracks waiting on each other */
function rowShapes() {
  const tr = (id, state) => ({ id, ws: 'WS-9', name: 'Track ' + id + ' does a thing', state, words: state + ', nobody on it', open: 2, waiting: 2, ready: 0, running: 0, done: 1, spine: [], from: null, doneRun: 1, junctions: [] });
  const link = (from, to, n) => ({ from, to, pairs: Array.from({ length: n }, (_, i) => [from + 'x' + i, to + 'y' + i]) });
  const ws = (tracks, links) => ({ look: null, ov: [], ovLinks: [], ans: {}, tasks: {}, ws: { 'WS-9': { id: 'WS-9', name: 'Rows', crit: { n: 3, from: 'T-1', to: 'T-3', path: [] }, tracks, links, out: [], in: [] } } });
  return {
    skip: ws([tr('TR-1', 'active'), tr('TR-2', 'waiting'), tr('TR-3', 'waiting')], [link('TR-1', 'TR-2', 1), link('TR-2', 'TR-3', 1), link('TR-1', 'TR-3', 2)]),
    both: ws([tr('TR-1', 'active'), tr('TR-2', 'waiting')], [link('TR-1', 'TR-2', 2), link('TR-2', 'TR-1', 1)])
  };
}

test("nothing in the Overview's, a workstream's or a track's picture or the pane's legend runs out of the width or over anything else, on the invented harbor board", () => {
  const shapes = pictureWsShapes(), rowsOf = rowShapes();
  /* a wait skipping a pill on its row and two tracks waiting on each other, beside the harbor board's shapes */
  const level1 = ['ov', 'WS-7', 'WS-3', 'WS-14', 'WS-12'].map((ws) => [ws, shapes[ws], ws]).concat([['skip', rowsOf.skip, 'WS-9'], ['both', rowsOf.both, 'WS-9']]);
  for (const [name, P, ws] of level1) for (const px of [238, 438, 900, 1400]) {
    const V = ws === 'ov' ? { level: 0, ws: null, tr: null, sel: null } : { level: 1, ws, tr: null, sel: null };
    for (const skin of ['web', 'pane']) {
      const r = drawPicture(P, V, { skin, width: px, measure: paneMeasure });
      assert.deepEqual(faults(r, paneMeasure, ws === 'ov'), [], name + ' ' + skin + ' ' + px);
    }
    if (ws === 'WS-9') continue;
    /* the legend as the pane packs it: entries in rows, two cells apart, in a body px wide, as the picture is drawn (238 px, 28 columns) */
    const columns = Math.floor(px / 8.453), rows = [[]];
    let used = 0;
    for (const e of panePicture(P, V, { columns }).legend) {
      if (rows.at(-1).length && used + 2 + e.cells > columns) { rows.push([]); used = 0; }
      used += (rows.at(-1).length ? 2 : 0) + e.cells;
      rows.at(-1).push({ k: e.words, x: used - e.cells, w: e.cells });
    }
    for (const b of rows.flat()) assert.ok(b.x >= 0 && b.x + b.w <= columns, ws + ' ' + px + ': "' + b.k + '" takes ' + b.w.toFixed(1) + ' of ' + columns + ' columns');
  }
  /* the line ends on a task waiting on another workstream, TR-15 stacks two left chips, TR-12 a right chip with its answer;
     a line twenty long folds into bands at the board's width rather than the phone's rail */
  shapes['WS-14L'] = longTrack();
  for (const [ws, tr] of [['WS-7', 'TR-1'], ['WS-12', 'TR-15'], ['WS-12', 'TR-12'], ['WS-14L', 'TR-24']]) for (const px of [238, 280, 438, 900, 1400]) for (const skin of ['web', 'pane']) {
    const P = shapes[ws], at = ws.replace(/L$/, ''), r = drawPicture(P, { level: 2, ws: at, tr, sel: null }, { skin, width: px, measure: paneMeasure });
    assert.deepEqual(trackFaults(r, P, at, tr, skin, paneMeasure), [], ws + ' ' + tr + ' ' + skin + ' ' + px);
    if (tr === 'TR-24' && px === 1400) assert.ok(Math.max(...Object.values(r.pos).map((p) => p.x)) > px / 2, 'the long line keeps to a rail at ' + skin + ' ' + px);
  }
  /* a park that opens when a task completes names that task, and each chip on the main line names its own park */
  const z = shapes['WS-3'], parks = ['TR-34', 'TR-35', 'TR-36'];
  const words = (id) => z.ws['WS-3'].tracks.find((t) => t.id === id).name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const own = (id) => words(id).filter((w) => !parks.some((o) => o !== id && words(o).includes(w)));
  const inHit = (r, h) => [...r.svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)<\/text>/g)].filter((m) => +m[1] >= h.x - 1 && +m[1] <= h.x + h.w && +m[2] >= h.y && +m[2] <= h.y + h.h + 2).map((m) => m[3]).join(' ');
  for (const [skin, px] of [['web', 1400], ['pane', 438]]) {
    const park = drawPicture(z, { level: 2, ws: 'WS-3', tr: 'TR-36', sel: null }, { skin, width: px, measure: paneMeasure });
    assert.ok(park.hits.some((h) => /T-401/.test(inHit(park, h))), 'TR-36 opens when T-401 completes: ' + skin);
    const main = drawPicture(z, { level: 2, ws: 'WS-3', tr: 'TR-18', sel: null }, { skin, width: px, measure: paneMeasure });
    for (const h of main.hits) {
      const p = h.k.startsWith('trk:') ? h.k.slice(4) : h.k.startsWith('jump:') ? (z.tasks[h.k.slice(5)] || {}).tr : null;
      if (parks.includes(p)) assert.ok(own(p).some((w) => inHit(main, h).toLowerCase().includes(w)), 'the chip for ' + p + ' reads "' + inHit(main, h) + '": ' + skin);
    }
  }
});

test("the redrawn picture's critical path counts the track order's parks as waits; a loop of parks ends", async () => {
  /* Beacons, then Buoys parked after it, then the main line waiting on both, as WS-12 */
  const tasks = [
    { id: 's1', tr: 'beacons', deps: [] }, { id: 's2', tr: 'beacons', deps: ['s1'] }, { id: 'lone', tr: 'beacons', deps: [] },
    { id: 'f1', tr: 'buoys', deps: [] }, { id: 'f2', tr: 'buoys', deps: ['f1'] },
    { id: 'm1', tr: 'main', deps: ['s2', 'f2'] },
  ];
  assert.equal(critOf({ tasks }).n, 3, 'without the park, two lines side by side');
  assert.deepEqual(critOf({ tasks, parks: [{ tr: 'buoys', kind: 'track-ends', on: 'beacons' }] }).path, ['s1', 's2', 'f1', 'f2', 'm1'], 'Buoys start after the last of Beacons');
  const loop = critOf({ tasks, parks: [{ tr: 'buoys', kind: 'track-ends', on: 'beacons' }, { tr: 'beacons', kind: 'track-ends', on: 'buoys' }] });
  /* the park that closes the loop is cut, so the path is named from a track's start */
  assert.deepEqual([loop.n, tasks.find((x) => x.id === loop.from).deps], [5, []]);

  /* a tie between two chains names the same path on the workstream as on the track page: the end waits on
     its own line's chain and on the other line's, whose last task comes first in the board's order */
  const { freshBoard } = await import('./helpers/board-db.mjs');
  const w = await import('../server/verbs/work.mjs');
  const t = await import('../server/verbs/tracks.mjs');
  const { addEdge } = await import('../server/verbs/graph.mjs');
  const db = freshBoard();
  const ctx = { session: 's1', now: new Date(2026, 10, 4, 12) };
  const ws = w.createRecord(db, { kind: 'workstream', name: 'Ties', description: 'd' }, ctx);
  const chain = (n) => { const [a, b] = [1, 2].map((i) => w.createRecord(db, { kind: 'task', name: n + i, description: 'd', workstream: ws.id }, ctx)); addEdge(db, { task: b.id, on: a.id, reason: 'r' }, 'cli'); return [a, b]; };
  const keyOf = (r) => db.prepare('SELECT key FROM records WHERE label = ?').get(r.id).key;
  const [x, y] = [chain('x'), chain('y')].sort((p, q) => (keyOf(p[1]) < keyOf(q[1]) ? 1 : -1));
  const end = w.createRecord(db, { kind: 'task', name: 'end', description: 'd', workstream: ws.id }, ctx);
  const own = t.newTrack(db, { name: 'Own', workstream: ws.id, tasks: [...x, end].map((r) => r.id) }, 'cli');
  t.newTrack(db, { name: 'Other', workstream: ws.id, tasks: y.map((r) => r.id) }, 'cli');
  for (const on of [x[1], y[1]]) addEdge(db, { task: end.id, on: on.id, reason: 'r' }, 'cli');
  const page = t.trackView(db, { track: own.id }).critical.path;
  const P = pictureOf({ views: t.workstreamView(db, { workstream: ws.id }) });
  assert.deepEqual([P.ws[ws.id].crit.path, page], [[y[0].id, y[1].id, end.id], [y[0].id, y[1].id, end.id]], 'the board\'s order breaks the tie on both');
  /* tied ends in different columns go by the track's own order, as on the track page: the first waits off the picture */
  const [order, far] = ['Order', 'Far'].map((name) => w.createRecord(db, { kind: 'workstream', name, description: 'd' }, ctx));
  const off = t.capture(db, { track: t.newTrack(db, { name: 'Far', workstream: far.id }, 'cli').id, name: 'far' }, 'cli');
  const line = t.newTrack(db, { name: 'Order', workstream: order.id }, 'cli');
  const [first] = ['first', 'second'].map((name) => t.capture(db, { track: line.id, name }, 'cli'));
  addEdge(db, { task: first.id, on: off.id, reason: 'r' }, 'cli');
  const ends = [pictureOf({ views: t.workstreamView(db, { workstream: order.id }) }).ws[order.id].crit.to, t.trackView(db, { track: line.id }).critical.path.at(-1)];
  assert.deepEqual(ends, [first.id, first.id]);
});

test('a finished junction stays a done station on its line, the side line leaving from it', () => {
  const tv = (id, tasks, extra) => ({ id, key: id, name: id, state: 'waiting', stalled: false, noHandoff: false, holder: null, done: 1, sideTracks: [],
    critical: { length: tasks.length, path: tasks.map((t) => t.id) }, tasks, edges: [], ...extra });
  const task = (id) => ({ id, key: id, name: 'Task ' + id, status: 'open', ready: true });
  const side = { junction: { track: { id: 'TR-1', key: 'TR-1' }, task: { id: 'T-1', key: 'T-1', name: 'The junction' } } };
  const P = pictureOf({ views: [{ workstream: 'WS-1', tracks: [tv('TR-1', [task('T-2')]), tv('TR-2', [task('T-3')], side)] }] });
  const main = P.ws['WS-1'].tracks.find((t) => t.id === 'TR-1');
  assert.deepEqual([main.junctions, main.doneRun, P.tasks['T-1'].st, P.tasks['T-1'].leaves], [['T-1'], 0, 'done', 'TR-2']);
});

test('a task whose agent stopped reads finished and landing, or its next leg due, with no train car', () => {
  const ran = (agentEnd) => {
    const t = { id: 'T-2', key: 'T-2', name: 'Fix the look', status: 'in_progress', agent: 'look-fixes', ...(agentEnd ? { agentEnd } : {}) };
    const tv = { id: 'TR-1', key: 'TR-1', name: 'Release', state: 'active', stalled: false, noHandoff: false, holder: null, done: 0, sideTracks: [],
      critical: { length: 1, path: ['T-2'] }, tasks: [t], edges: [], now: [{ id: 'T-2', agent: 'look-fixes' }] };
    const P = pictureOf({ views: [{ workstream: 'WS-1', tracks: [tv] }] });
    const r = drawPicture(P, { level: 2, ws: 'WS-1', tr: 'TR-1', sel: null }, { skin: 'web', width: 1400, measure });
    return { words: [...r.svg.matchAll(/>([^<>]+)<\/text>/g)].map((m) => m[1]).join(' '), cars: (r.svg.match(/width="15" height="10"/g) || []).length };
  };
  const live = ran(null);
  assert.ok(live.words.includes('running: look-fixes') && live.cars > 0, live.words);
  const landed = ran({ how: 'finished', at: '2026-11-07T01:33:56Z' });
  assert.deepEqual([/finished: look-fixes, landing/.test(landed.words), /running/.test(landed.words), landed.cars], [true, false, 0]);
  assert.match(ran({ how: 'stopped' }).words, /stopped: look-fixes, next leg due/);
});
