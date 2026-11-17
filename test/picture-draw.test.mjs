/* The redrawn picture: the mock's data drawn at the pane's narrowest and the board's
   widest, a station's trace, and the pane's Svg inside the app's limits; the model's critical
   path and its finished junctions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { crumbs, drawPicture, legend, railOf as railPlanOf, skinOf, traceSet } from '../server/web/picture-draw.mjs';
import { critOf, pictureOf } from '../server/web/picture-model.mjs';
import { paneMeasure, panePicture } from '../lib/mod-core.mjs';
import { wordWords } from '../server/web/draw.mjs';
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
  // with room beside it the name draws whole
  assert.match(drawPicture(P, VIEWS[2], { skin: 'web', width: 2400, measure }).svg, />Buoy maker and catalog opens</, 'a name cut with room to spare');
  // a top chip with free columns beside it keeps its whole name
  for (const width of [900, 1400]) {
    const top = [...drawPicture(P, { level: 2, ws: 'WS-12', tr: 'TR-14', sel: null }, { skin: 'web', width, measure }).svg.matchAll(/>(frees T-288[^<]*)</g)].map((m) => m[1]);
    assert.ok(top.length && top.every((s) => s.includes('Tide charts redraw')), 'a top chip cut with room beside it at ' + width + ': ' + top);
  }
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
  // five WS-7 tasks waiting on T-326 draw one chip that counts them, on the workstream and on the track;
  // a WS-7 track parked until T-326 completes rides that chip and is not counted, since it opens rather than waits
  P.ws['WS-12'].out = [1, 2, 3, 4, 5].map(() => ({ from: 'TR-3', task: 'T-326', ws: 'WS-7', text: 'WS-7 waits on T-326' }))
    .concat({ from: 'TR-3', task: 'T-326', ws: 'WS-7', waiter: 'TR-20', text: 'WS-7 waits on T-326' });
  for (const [V, width] of [[VIEWS[1], 1400], [VIEWS[1], 238], [VIEWS[3], 1400], [VIEWS[3], 238]]) {
    const r = drawPicture(P, { ...V, sel: null }, { skin: 'pane', width, measure }), at = V.level + ' ' + width;
    assert.equal(r.hits.filter((h) => h.k === 'ws:WS-7').length, 1, 'one chip for the five: ' + at);
    const count = texts(r.svg).map((x) => x.s).filter((s) => /5 tasks/.test(s));
    assert.ok(count.length && count.every((s) => !/track/.test(s)), 'the chip counts the tasks alone: ' + at + ' ' + count);
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
  return bad.concat(trainMisses(r, ov ? 0 : 1));
}

/* a train (a session's engine, an agent's car) presses what it rides, a station at or above its middle or the pill
   whose top edge it sits on, and so does a pill's tag on that edge: the pane's topmost zone over its whole box, and on the
   board the innermost press around its marks; a bead stands clear of every train and its right end presses the bead, by the
   pane's topmost zone and the board's (each 4 px past its press, the last laid on top) */
function trainMisses(r, level) {
  const bad = [], trains = [];
  const top = (px, py) => (r.hits.filter((z) => px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h).at(-1) || {}).k;
  const riders = [...r.svg.matchAll(/(<g transform="matrix\(([-\d.]+) 0 0 [-\d.]+ ([-\d.]+) ([-\d.]+)\)">)?<g><rect x="([-\d.]+)" y="([-\d.]+)" width="(22|15)" height="(12|10)"/g)].map((m) => {
    const k = m[1] ? +m[2] : 1, x = k * m[5] + (m[1] ? +m[3] : 0), y = k * m[6] + (m[1] ? +m[4] : 0), w = k * (m[7] === '22' ? 26 : 15), h = k * m[8];
    trains.push({ x, y, w, h });
    return { what: 'a train', x, y, w, h, at: m.index + (m[1] || '').length };
  }).concat(level < 2 ? [...r.svg.matchAll(/<g><rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="16" rx="8"/g)].map((m) => ({ what: 'a tag', x: +m[1], y: +m[2], w: +m[3], h: 16, at: m.index })) : []);
  for (const { what, x, y, w, h, at } of riders) {
    const cx = x + w / 2, cy = y + h / 2, near = (p) => Math.abs(p.x - cx);
    const ride = level === 2 ? Object.entries(r.pos).filter(([, p]) => p.y <= cy + 1).sort((a, b) => b[1].y - a[1].y || near(a[1]) - near(b[1]))[0]
      : Object.entries(r.pos).find(([, p]) => cx >= p.x && cx <= p.x + p.w && Math.abs(p.y - cy) <= 1.5);
    const want = ride && ['ws:', 'pill:', 'stn:'][level] + ride[0];
    const zones = [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [cx, cy]].map(([px, py]) => top(px + Math.sign(cx - px) * 0.5, py + Math.sign(cy - py) * 0.5));
    const st = [];
    for (const g of r.svg.slice(0, at).matchAll(/<g\b([^>]*)>|<\/g>/g)) { if (g[0] === '</g>') st.pop(); else st.push((/data-k="([^"]*)"/.exec(g[1]) || [])[1]); }
    const board = st.filter(Boolean).at(-1);
    if (!want || zones.some((z) => z !== want) || board !== want) bad.push(what + ' at ' + [x, y].map(Math.round) + ' rides ' + want + ' but presses ' + zones.join('|') + ', on the board ' + board);
  }
  const hz = [...r.svg.matchAll(/data-k="([^"]*)"><rect class="hz" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => ({ k: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] }));
  for (const b of r.hits.filter((h) => h.k.startsWith('bead:'))) {
    for (const t of trains) if (t.x < b.x + b.w && b.x < t.x + t.w && t.y < b.y + b.h && b.y < t.y + t.h) bad.push('a train at ' + [t.x, t.y].map(Math.round) + ' over ' + b.k);
    const px = b.x + b.w - 1, py = b.y + 11, board = hz.length ? (hz.filter((z) => px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h).at(-1) || {}).k : b.k;
    if (top(px, py) !== b.k || board !== b.k) bad.push(b.k + "'s right end presses " + top(px, py) + ', on the board ' + board);
  }
  return bad;
}

/* what in a track's picture runs out of its width or up under the board's crumb bar (the picture's first 36 px),
   stands on another station or chip (an answer chip in its station's words aside), steps back along the line (a fold
   steps down to the next band), runs a line through a chip or words (a curve by its points), runs an order line
   along another chip's line, or has a train pressing anything but its station */
function trackFaults(r, P, ws, tr, skin, measure) {
  const bad = [], floor = skin === 'web' ? 36 : 0;
  /* a line's press, a train's and a fan box's lie over the stations they pass or hold on purpose */
  const boxes = r.hits.filter((h) => !h.line && !h.train && !h.box && /^(stn|jump|trk|ws|ans|bead):/.test(h.k));
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
  /* a path's segments, each curve cut in n */
  const flat = (d, n) => {
    let x = 0, y = 0;
    const segs = [], to = (nx, ny) => { segs.push({ x1: x, y1: y, x2: nx, y2: ny }); x = nx; y = ny; };
    for (const c of d.matchAll(/([MLHVQC])([-\d. ]+)/g)) {
      const v = c[2].trim().split(/\s+/).map(Number), x0 = x, y0 = y;
      if (c[1] === 'M') { x = v[0]; y = v[1]; } else if (c[1] === 'L') to(v[0], v[1]); else if (c[1] === 'H') to(v[0], y); else if (c[1] === 'V') to(x, v[0]);
      else for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t, q = c[1] === 'Q', [ex, ey] = q ? [v[2], v[3]] : [v[4], v[5]];
        to(q ? u * u * x0 + 2 * u * t * v[0] + t * t * ex : u * u * u * x0 + 3 * u * u * t * v[0] + 3 * u * t * t * v[2] + t * t * t * ex,
          q ? u * u * y0 + 2 * u * t * v[1] + t * t * ey : u * u * u * y0 + 3 * u * u * t * v[1] + 3 * u * t * t * v[3] + t * t * t * ey);
      }
    }
    return segs;
  };
  /* an icon's paths sit in its own nested svg's units, so they are left out */
  for (const m of r.svg.replace(/<svg x=[\s\S]*?<\/svg>/g, '').matchAll(/<path\b[^>]*?\bd="([MLHVQC][-\d. MLHVQC]*)"[^>]*>/g)) {
    for (const s of flat(m[1], 8)) for (const b of keep) if (through(s, b)) bad.push('a line through ' + b.k + ' at ' + [s.x1, s.y1, s.x2, s.y2].map(Math.round).join());
  }
  /* an order line (the lavender dashes) runs on its own, never 14 px within 3 px of another chip's line, as two leaving one station did */
  const dist = (s, x, y) => { const dx = s.x2 - s.x1, dy = s.y2 - s.y1, t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(s.x1 + t * dx - x, s.y1 + t * dy - y); };
  const dashed = [...r.svg.matchAll(/<path\b[^>]*?\bd="([^"]+)"[^>]*?\bstroke="([^"]+)"[^>]*?\bstroke-dasharray=/g)].map((m) => ({ order: m[2] === skinOf(skin).c.lav, segs: flat(m[1], 48) }));
  for (const a of dashed.filter((p) => p.order)) for (const b of dashed.filter((p) => p !== a)) {
    let run = 0, best = 0;
    for (const s of a.segs) for (let d = 0, L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1); d < L; d++) {
      const x = s.x1 + (s.x2 - s.x1) * d / L, y = s.y1 + (s.y2 - s.y1) * d / L;
      run = b.segs.some((q) => dist(q, x, y) < 3) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    if (best >= 14) bad.push('an order line ' + best + ' px along another chip line from ' + [a.segs[0].x1, a.segs[0].y1].map(Math.round).join());
  }
  return [...new Set(bad.concat(trainMisses(r, 2)))];
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
/* a review waiting on a fan of twenty-two tasks, a chain of two inside it and one leaving the trunk, as TR-40 had */
function wideFan() {
  const tasks = {}, fan = Array.from({ length: 20 }, (_, i) => 10 + i);
  const add = (n, st, waits) => { tasks['T-' + n] = { id: 'T-' + n, tr: 'TR-40', name: 'Wave task ' + n + ' fixes one thing the sweep found', st, waits: waits.map((w) => 'T-' + w), cross: [], frees: [] }; };
  add(1, 'now', []); add(2, 'waits', [1]); add(3, 'waits', [2]);
  fan.forEach((n) => add(n, 'now', []));
  add(30, 'waits', [29]); add(31, 'waits', [2]); add(40, 'waits', [3, 30, 31, ...fan]); add(41, 'waits', [40]); add(42, 'waits', [41]);
  for (const t of Object.values(tasks)) for (const w of t.waits) tasks[w].frees.push(t.id);
  const spine = [1, 2, 3, 40, 41, 42].map((n) => 'T-' + n);
  const tr = { id: 'TR-40', ws: 'WS-11', name: 'Fixes from the review', state: 'active', words: 'active', open: 28, waiting: 7, done: 0, spine, from: null, doneRun: 0, junctions: [] };
  return { look: null, ov: [], ovLinks: [], ans: {}, tasks, ws: { 'WS-11': { id: 'WS-11', name: 'Fixes', crit: { n: 6, from: 'T-1', to: 'T-42', path: spine }, tracks: [tr], links: [], out: [], in: [] } } };
}
/* a parked side track of two stations that opens when another track ends, its last station freeing a task on the
   main line while its end opens a third track, so two chips leave that station; the main line runs the session and
   an agent, the session's station right after one with a long name; the track whose end opens the side one folds its
   finished run into a bead right before a station the session runs, and its pill carries what changed */
function sideTrack() {
  const tasks = {};
  const add = (id, tr, name, st, waits, cross, extra) => { tasks[id] = { id, tr, name, st, waits, cross, frees: [], ...extra }; };
  add('T-710', 'TR-60', 'Survey the loft rafters, the winch mounts and the drying racks before the season', 'ready', [], []);
  add('T-711', 'TR-60', 'Rehang the drying racks', 'now', ['T-710'], [], { session: true });
  add('T-712', 'TR-60', 'Oil the winch', 'now', ['T-710'], [], { agent: 'winch-oiler' });
  add('T-713', 'TR-60', 'Open the loft for the season', 'waits', ['T-711', 'T-712'], ['T-722']);
  add('T-721', 'TR-62', 'Splice the mooring lines', 'ready', [], []);
  add('T-722', 'TR-62', 'Whip the rope ends and coil them', 'waits', ['T-721'], []);
  add('T-731', 'TR-61', 'Patch the cork floats', 'now', [], [], { session: true });
  add('T-732', 'TR-61', 'Paint the patched floats', 'waits', ['T-731'], []);
  for (const t of Object.values(tasks)) for (const w of t.waits.concat(t.cross)) tasks[w].frees.push(t.id);
  const tr = (id, name, state, spine, extra) => ({ id, ws: 'WS-5', name, state, words: state, open: spine.length, ready: 0, waiting: spine.length, done: 0, spine, from: null, doneRun: 0, junctions: [], ...extra });
  return { look: null, ov: [], ovLinks: [], ans: { Q60: { tok: '60a' } }, tasks, ws: { 'WS-5': { id: 'WS-5', name: 'Net loft', crit: { n: 3, from: 'T-710', to: 'T-713', path: ['T-710', 'T-711', 'T-713'] },
    tracks: [tr('TR-60', 'Net loft main line', 'active', ['T-710', 'T-711', 'T-713'], { junctions: ['T-700'], train: { agents: 1, session: true } }),
      tr('TR-61', 'Float repairs', 'active', ['T-731', 'T-732'], { doneRun: 3, changed: '1 new, 3 done' }), tr('TR-62', 'Rope splicing', 'parked', ['T-721', 'T-722']), tr('TR-63', 'Buoy paint', 'parked', [])],
    links: [{ from: 'TR-61', to: 'TR-62', kind: 'order', ans: 'Q60' }, { from: 'TR-62', to: 'TR-63', kind: 'order', ans: 'Q60' }, { from: 'TR-62', to: 'TR-60', kind: 'wait', pairs: [['T-713', 'T-722']] }],
    out: [], in: [] } } };
}
/* a track's rail: its columns (stations and upright lines), each line end on no station and no other line, and the middles of its bus pieces */
function railOf(r, skin) {
  const c = skinOf(skin).c, paths = [];
  for (const m of r.svg.matchAll(/<path\b[^>]*?\bd="([^"]+)"[^>]*?\bstroke="([^"]+)"/g)) {
    if (m[2] !== c.line && m[2] !== c.crit) continue;
    let x = 0, y = 0;
    const segs = [], pts = [];
    for (const t of m[1].matchAll(/([MVHQ])([-\d. ]+)/g)) {
      const v = t[2].trim().split(/\s+/).map(Number), q = t[1] === 'Q';
      const nx = t[1] === 'V' ? x : q ? v[2] : v[0], ny = t[1] === 'V' ? v[0] : t[1] === 'H' ? y : q ? v[3] : v[1];
      if (t[1] === 'V' || t[1] === 'H') segs.push([x, y, nx, ny]);
      x = nx; y = ny; pts.push([x, y]);
    }
    paths.push({ segs, ends: [pts[0], pts.at(-1)] });
  }
  const near = (a, b) => Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1;
  const on = ([x, y], [x1, y1, x2, y2]) => x >= Math.min(x1, x2) - 1 && x <= Math.max(x1, x2) + 1 && y >= Math.min(y1, y2) - 1 && y <= Math.max(y1, y2) + 1;
  const stations = Object.values(r.pos).map((p) => [p.x, p.y]), xs = new Set(stations.map((s) => s[0]));
  const loose = paths.flatMap((p) => p.ends.filter((e) => !stations.some((s) => near(s, e)) && !paths.some((o) => o !== p && (o.segs.some((s) => on(e, s)) || o.ends.some((q) => near(q, e))))));
  const ups = paths.flatMap((p) => p.segs).filter((s) => s[0] === s[2] && Math.abs(s[3] - s[1]) > 2);
  return { cols: new Set([...xs, ...ups.map((s) => s[0])]).size, loose, bus: ups.filter((s) => !xs.has(s[0])).map((s) => [s[0], (s[1] + s[3]) / 2]) };
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
  shapes['WS-5'] = sideTrack();
  /* the Overview's pill with a train carries what changed too */
  shapes.ov.ov[0].changed = '3 new, 1 done';
  const level1 = ['ov', 'WS-7', 'WS-3', 'WS-14', 'WS-12', 'WS-5'].map((ws) => [ws, shapes[ws], ws]).concat([['skip', rowsOf.skip, 'WS-9'], ['both', rowsOf.both, 'WS-9']]);
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
  /* a fan too wide for the grid draws as the list at every width, its rail one column under the fan's box, every line end on a station or a line, and its box presses the review */
  shapes['WS-11F'] = wideFan();
  /* the side track's two chips from one station, the main line's trains, and a bead before the session's engine */
  for (const [ws, tr] of [['WS-7', 'TR-1'], ['WS-12', 'TR-15'], ['WS-12', 'TR-12'], ['WS-14L', 'TR-24'], ['WS-11F', 'TR-40'], ['WS-5', 'TR-62'], ['WS-5', 'TR-60'], ['WS-5', 'TR-61']]) for (const px of [238, 280, 438, 900, 1400]) for (const skin of ['web', 'pane']) {
    const P = shapes[ws], at = ws.replace(/[LF]$/, ''), r = drawPicture(P, { level: 2, ws: at, tr, sel: null }, { skin, width: px, measure: paneMeasure }), where = ws + ' ' + tr + ' ' + skin + ' ' + px;
    assert.deepEqual(trackFaults(r, P, at, tr, skin, paneMeasure), [], where);
    if (tr === 'TR-24' && px === 1400) assert.ok(Math.max(...Object.values(r.pos).map((p) => p.x)) > px / 2, 'the long line keeps to a rail at ' + skin + ' ' + px);
    if (tr !== 'TR-40') continue;
    const rail = railOf(r, skin), press = ([x, y]) => (r.hits.filter((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h).at(-1) || {}).k;
    /* the line stops at the fan's box and starts again under it, a short piece through the critical station in it */
    const box = r.hits.find((h) => h.box), edge = ([x, y]) => box && (Math.abs(y - box.y) < 1 || Math.abs(y - box.y - box.h) < 1 || Object.values(r.pos).some((p) => p.x === x && Math.abs(Math.abs(p.y - y) - 12) < 1));
    assert.deepEqual([rail.cols, rail.loose.filter((e) => !edge(e))], [1, []], where);
    assert.ok(box && press([box.x + box.w - 4, box.y + 4]) === 'stn:T-40', 'the box presses the review: ' + where);
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
    /* on the rail a station's first chip stands clearly nearer its own words than the next station's id */
    if (skin !== 'pane') continue;
    const ys = Object.values(main.pos).map((q) => q.y).sort((a, b) => a - b), col = (h) => [...main.svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"/g)].map((m) => [+m[1], +m[2]]).filter(([x]) => x >= h.x - 1 && x < h.x + h.w).map((t) => t[1]);
    const chips = main.hits.filter((h) => /^(trk|jump):/.test(h.k));
    for (const h of chips.filter((h) => !chips.some((o) => o !== h && Math.abs(o.y + o.h + 4 - h.y) < 2))) {
      const next = ys.find((y) => y > h.y + h.h), up = Math.max(...col(h).filter((y) => y < h.y)), down = Math.min(...col(h).filter((y) => y > h.y + h.h && y >= next - 20));
      if (next === undefined || up === -Infinity) continue;
      assert.ok(2 * (h.y - up - 3) <= down - 13 - h.y - h.h, h.k + ' stands ' + (h.y - up - 3) + ' px under its words and ' + (down - 13 - h.y - h.h) + ' over the next id');
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

  /* a tie between two chains goes to the lower task number on the workstream and the track page alike,
     whichever way the random record keys sort: the end waits on its own line's chain and on the other line's */
  const { freshBoard } = await import('./helpers/board-db.mjs');
  const w = await import('../server/verbs/work.mjs');
  const t = await import('../server/verbs/tracks.mjs');
  const { addEdge } = await import('../server/verbs/graph.mjs');
  const ctx = { session: 's1', now: new Date(2026, 10, 4, 12) };
  /* the other line is filed until its last key sorts after x's (as the numbers do) or before it; a line left off the tracks draws nowhere */
  for (const keysAgree of [true, false]) {
    const db = freshBoard();
    const ws = w.createRecord(db, { kind: 'workstream', name: 'Ties', description: 'd' }, ctx);
    const chain = (n) => { const [a, b] = [1, 2].map((i) => w.createRecord(db, { kind: 'task', name: n + i, description: 'd', workstream: ws.id }, ctx)); addEdge(db, { task: b.id, on: a.id, reason: 'r' }, 'cli'); return [a, b]; };
    const keyOf = (r) => db.prepare('SELECT key FROM records WHERE label = ?').get(r.id).key;
    const x = chain('x');
    let y = chain('y');
    while ((keyOf(y[1]) > keyOf(x[1])) !== keysAgree) y = chain('y');
    const end = w.createRecord(db, { kind: 'task', name: 'end', description: 'd', workstream: ws.id }, ctx);
    const own = t.newTrack(db, { name: 'Own', workstream: ws.id, tasks: [...x, end].map((r) => r.id) }, 'cli');
    t.newTrack(db, { name: 'Other', workstream: ws.id, tasks: y.map((r) => r.id) }, 'cli');
    for (const on of [x[1], y[1]]) addEdge(db, { task: end.id, on: on.id, reason: 'r' }, 'cli');
    const page = t.trackView(db, { track: own.id }).critical.path;
    const P = pictureOf({ views: t.workstreamView(db, { workstream: ws.id }) });
    assert.deepEqual([P.ws[ws.id].crit.path, page], [[x[0].id, x[1].id, end.id], [x[0].id, x[1].id, end.id]], 'the lower number wins on both, keys agreeing: ' + keysAgree);
  }
  const db = freshBoard();
  /* tied ends in different columns go to the lower number, as on the track page: the first waits off the picture */
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
  /* a track named as its workstream is (both cut at the colon) never says that name twice in the crumbs */
  /* one with no words after the cut shows its id alone */
  for (const name of ['Account system: the fixed release and the vendor exit', 'Account system']) {
    const twin = pictureOf({ views: [{ workstream: 'WS-8', name: 'Account system: login, API, website and app', tracks: [{ ...tv('TR-2', [task('T-2')]), name }] }] });
    for (const pane of [false, true]) {
      const words = crumbs(twin, { level: 2, ws: 'WS-8', tr: 'TR-2' }, { pane }).map((c) => c.words).join(' ');
      assert.ok(words.split('Account system').length <= 2, words);
      if (name.includes(':')) assert.match(words, /TR-2 \S/, 'the track keeps a name: ' + words);
    }
  }
});

test('each station says its word: running and unconfirmed with who, ready to start, continue or settle, waiting', () => {
  const at = '2026-11-14T12:00:00Z', ago = (min) => new Date(Date.parse(at) - min * 60000).toISOString();
  const agentRun = (job, more) => ({ worker: 'agent', job, ...more });
  const rows = [
    ['T-2', { is: 'running', ...agentRun('look-fixes'), since: ago(12) }],
    ['T-3', { is: 'unconfirmed', ...agentRun('lost-lane', { pc: 'pc-b' }), since: ago(9) }],
    ['T-4', { is: 'ready', next: 'start', since: ago(180) }, { progress: { done: 0, total: 3, text: '0 of 3' } }],
    ['T-5', { is: 'ready', next: 'continue', ...agentRun('auditor'), how: 'handed_on', ended: ago(30), since: ago(30) }],
    ['T-6', { is: 'ready', next: 'settle', ...agentRun('finisher'), how: 'finished', ended: ago(60), since: ago(60) }, { progress: { done: 0, total: 2, text: '0 of 2' } }],
    ['T-7', { is: 'waiting', on: ['after T-4'] }],
  ];
  /* a view's task as trackView sends it: the word, and the agent its run names */
  const tasks = rows.map(([id, word, more]) => ({ id, key: id, name: 'Task ' + id, status: 'open', word, ready: word.is === 'ready', ...(word.worker === 'agent' ? { agent: word.job } : {}), ...more }));
  const tv = { id: 'TR-1', key: 'TR-1', name: 'Release', state: 'active', stalled: false, noHandoff: false, holder: null, done: 0, sideTracks: [], hold: { on: true },
    critical: { length: 2, path: ['T-4', 'T-7'] }, tasks, edges: [{ task: 'T-7', on: 'T-4', done: false }], now: tasks.filter((t) => ['running', 'unconfirmed'].includes(t.word.is)) };
  const P = pictureOf({ views: [{ workstream: 'WS-1', tracks: [tv] }], at });
  const r = drawPicture(P, { level: 2, ws: 'WS-1', tr: 'TR-1', sel: null }, { skin: 'web', width: 1400, measure });
  const words = [...r.svg.matchAll(/>([^<>]+)<\/text>/g)].map((m) => m[1]).join(' ');
  for (const w of [/running: look-fixes for 12 min/, /unconfirmed: lost-lane on pc-b, not heard since/, /ready to start for 3 h, 3 steps open/,
    /ready to continue[^:]*: auditor handed on/, /ready to settle[^:]*: finisher finished, 2 steps open/, /waits on 1/]) assert.match(words, w);
  assert.ok(!/landing|in progress|nobody on it|…/.test(words), words);
  /* the track's line says the user's hold the view sends */
  assert.match(drawPicture(P, { level: 1, ws: 'WS-1', sel: null }, { skin: 'web', width: 1400, measure }).svg, /on hold, your word/);
  /* only the running agent draws a car: nothing has heard the unconfirmed one */
  const tr = P.ws['WS-1'].tracks[0];
  assert.deepEqual([(r.svg.match(/width="15" height="10"/g) || []).length, tr.running, tr.unconfirmed, tr.ready, tr.waiting, tr.open, tr.train.names],
    [1, 1, 1, 3, 1, 6, ['look-fixes']]);
  /* the Overview's counts read the row's running, unconfirmed and ready */
  const ov = pictureOf({ overview: { ws: [{ id: 'WS-1', name: 'Release', open: 5, running: 1, unconfirmed: 1, ready: 2, tracks: [] }] } }).ov[0].counts;
  assert.ok(/1 unconfirmed/.test(ov) && /1 waiting/.test(ov) && !/landing|stopped/.test(ov), ov);

  /* a run the app closed leaves its task to continue, the session named with the close and no cause */
  const idle = wordWords({ id: 'T-8', word: { is: 'ready', next: 'continue', worker: 'session', session: 's-a', how: 'closed_idle', since: ago(5) } }, at, 's-a');
  assert.ok(/continue/.test(idle) && /this session/.test(idle) && /closed by the app/.test(idle) && !/idle/.test(idle), idle);
});

/* a main line T-1 to T-6, a side chain T-20 to T-22 off T-1 that T-3 also feeds, and six on their own */
function tunnelShape() {
  const tasks = {};
  const add = (n, st, waits) => { tasks['T-' + n] = { id: 'T-' + n, tr: 'TR-9', name: 'Task ' + n, st, waits: waits.map((w) => 'T-' + w), cross: [], frees: [] }; };
  add(1, 'now', []); [2, 3, 4].forEach((n) => add(n, 'waits', [n - 1])); add(5, 'waits', [4]); add(6, 'waits', [5]);
  add(20, 'waits', [1]); add(21, 'waits', [20, 3]); add(22, 'waits', [21]);
  [30, 31, 32, 33, 34, 35].forEach((n) => add(n, 'ready', []));
  for (const t of Object.values(tasks)) for (const w of t.waits) tasks[w].frees.push(t.id);
  const spine = [1, 2, 3, 4, 5, 6].map((n) => 'T-' + n);
  const tr = { id: 'TR-9', ws: 'WS-9', name: 'Tunnels', state: 'active', words: 'active', open: 15, waiting: 8, done: 0, spine, from: null, doneRun: 0, junctions: [] };
  return { look: null, ov: [], ovLinks: [], ans: {}, tasks, ws: { 'WS-9': { id: 'WS-9', name: 'Rails', crit: { n: 6, from: 'T-1', to: 'T-6', path: spine }, tracks: [tr], links: [], out: [], in: [] } } };
}

test('on the rail a link between rows that are not neighbours runs as a tunnel, the main line on the surface', () => {
  const R = railPlanOf(tunnelShape(), { level: 2, ws: 'WS-9', tr: 'TR-9', sel: null }), has = (a, b) => R.tunnels.some((l) => l[0] === a && l[1] === b);
  assert.deepEqual([has('T-3', 'T-21'), has('T-1', 'T-20'), has('T-1', 'T-2'), has('T-21', 'T-22')], [true, true, false, false]);
});

test("a tunnel ending inside a folded side group shows on the group's row, and pressing its other end opens the group", () => {
  const P = tunnelShape(), V = { level: 2, ws: 'WS-9', tr: 'TR-9', sel: null }, side = (R) => R.groups.find((g) => g.members.includes('T-21'));
  const g = side(railPlanOf(P, V));
  assert.ok(g.folded && g.ports.exit.some((l) => l.join('>') === 'T-3>T-21'), 'the fold carries the exit');
  assert.ok(g.lands.includes('T-21') && !g.lands.includes('T-22'), 'the fold marks where tunnels land');
  const r = drawPicture(P, V, { skin: 'pane', width: 438, measure: paneMeasure });
  assert.ok(r.hits.some((h) => h.k.startsWith('prt:fexit:') && h.k.includes('T-3>T-21')), 'the fold row presses its portal');
  assert.equal(side(railPlanOf(P, { ...V, sel: 'prt:dive:T-3>T-21' })).folded, false);
  /* a fold counts its tasks by state and draws a mark of its own, which the legend then names; loose tasks
     are on their own, a group whose tasks wait on each other is off the main line */
  const own = (R) => R.groups.find((x) => x.kind === 'own');
  assert.deepEqual([own(railPlanOf(P, V)).states, side(railPlanOf(P, V)).states], [[[6, 'ready']], [[3, 'waiting']]]);
  assert.match(own(railPlanOf(P, V)).words, /nothing waits/);
  const fold = (svg) => [...svg.matchAll(/<g data-m="fold [\s\S]*?<\/g><\/g>/g)].map((m) => m[0]);
  assert.ok(fold(r.svg).length && fold(r.svg).every((s) => s.includes('stroke-dasharray') && !s.includes('"p-card2"') && (/6.ready/.test(s) || /3.waiting/.test(s))), 'each fold says its states, its mark not the finished run\'s');
  assert.ok(r.sideFold && legend(P, V, 'pane', { sideFold: r.sideFold }).length === legend(P, V, 'pane', {}).length + 1, 'the legend names the fold');
  const mixed = tunnelShape(), add = (n, st, waits, more) => { mixed.tasks['T-' + n] = { id: 'T-' + n, tr: 'TR-9', name: 'Task ' + n, st, waits: waits.map((w) => 'T-' + w), cross: [], frees: [], ...more }; };
  add(40, 'now', []); add(41, 'left', [], { agent: 'fixer', word: { is: 'unconfirmed', worker: 'agent', job: 'fixer' } }); add(42, 'waits', [40, 41]); add(43, 'gated', [42]);
  add(44, 'ready', [], { agent: 'fixer', word: { is: 'ready', next: 'settle', worker: 'agent', job: 'fixer' }, progress: { done: 1, total: 2 }, frees: ['T-42'] }); mixed.tasks['T-42'].waits.push('T-44');
  const mg = own(railPlanOf(mixed, V));
  assert.equal(mg.words, 'Off the main line');
  assert.deepEqual(mg.states, [[1, 'running'], [1, 'unconfirmed'], [7, 'ready'], [1, 'gated'], [1, 'waiting']]);
  for (const px of [238, 438]) {
    const m = drawPicture(mixed, V, { skin: 'pane', width: px, measure: paneMeasure }), words = fold(m.svg).map((s) => [...s.matchAll(/>([^<>]+)<\/text>/g)].map((x) => x[1]).join(' ')).join(' | ');
    for (const w of [/1.running/, /1.unconfirmed/, /7.ready/, /1.waiting on your answer/]) assert.match(words, w, px + ': ' + words);
    assert.ok(!words.includes('…'), 'nothing cut at ' + px + ': ' + words);
  }
  /* past a fold row's long words its portal takes a line of its own before its ids break one a line */
  const long = tunnelShape(), lt = long.tasks;
  lt['T-23'] = { id: 'T-23', tr: 'TR-9', name: 'Task 23', st: 'waits', waits: [], cross: [], frees: ['T-22'] };
  lt['T-20'].st = 'now'; lt['T-21'].waits.push('T-4'); lt['T-4'].frees.push('T-21'); lt['T-22'].waits.push('T-23', 'T-5'); lt['T-5'].frees.push('T-22');
  /* at 415 px the exit's ids just fit unspaced, so the fit test counts their letter spacing too */
  for (const px of [238, 415, 438]) {
    const m = drawPicture(long, V, { skin: 'pane', width: px, measure: paneMeasure });
    const ports = [...m.svg.matchAll(/<g data-m="prt \w+ (?![A-Z]+-\d)[\s\S]*?<\/g><\/g>/g)].map((x) => x[0]);
    assert.ok(ports.length, 'a fold portal at ' + px);
    for (const s of ports) assert.equal((s.match(/<text /g) || []).length - (s.match(/text-anchor="middle"/g) || []).length, 1, px + ': ' + s);
    const W = +m.svg.match(/viewBox="0 0 ([\d.]+)/)[1], xr = W - (W < 420 ? 6 : 20);
    for (const s of ports) assert.ok(+s.match(/^<g data-m="prt(?: \S+){6} (\S+)/)[1] <= xr, px + ': past the edge ' + s.slice(0, 80));
  }
  /* a fold portal too long for a line of its own breaks its ids by their spaced width too */
  const wide = tunnelShape(), wt = wide.tasks;
  [2, 3, 4, 5, 6].forEach((n) => { const id = 'T-' + (40 + n); wt[id] = { id, tr: 'TR-9', name: 'Task ' + id, st: 'waits', waits: ['T-' + n], cross: [], frees: ['T-21'] }; wt['T-' + n].frees.push(id); wt['T-21'].waits.push(id); });
  for (const px of [270]) {
    const m = drawPicture(wide, V, { skin: 'pane', width: px, measure: paneMeasure }), W = +m.svg.match(/viewBox="0 0 ([\d.]+)/)[1], xr = W - (W < 420 ? 6 : 20);
    for (const x of m.svg.matchAll(/<g data-m="prt(?: \S+){6} (\S+)/g)) assert.ok(+x[1] <= xr, px + ': past the edge at ' + x[1] + ' against ' + xr);
  }
});
