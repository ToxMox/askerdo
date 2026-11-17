/* An invented harbor board around the Tidewatch demo in the picture contract's shape, as
   picture-model.mjs gives it after sinceLook: WS-12 and WS-11 open, the Overview of every
   workstream with open work. */
const tasks = {};
function task(id, tr, name, o) {
  tasks[id] = { id, key: id.toLowerCase(), url: '/r/' + id, tr, name, waits: [], cross: [], frees: [], ...o };
}
// WS-12, TR-12 Beacons
task('T-674', 'TR-12', 'B3 fix: flash refused after a reset of a still-computing flash', { st: 'ready', by: 'a helper agent' });
task('T-675', 'TR-12', 'B3 fix: Inspector panel and API disclosure', { st: 'ready', by: 'a helper agent' });
task('T-676', 'TR-12', 'Review B3 fix wave', { st: 'waits', review: true, waits: ['T-674', 'T-675'], by: 'a helper agent' });
task('T-677', 'TR-12', 'B3 live gate', { st: 'waits', waits: ['T-676'], by: 'the main session' });
task('T-678', 'TR-12', 'F030 B4', { st: 'waits', waits: ['T-677'], by: 'the main session' });
task('T-279', 'TR-12', 'F030 Integrate the harbor beacon timing', { st: 'waits', waits: ['T-678'] });
task('T-283', 'TR-12', 'R030 Retire old lamp dependency', { st: 'waits', waits: ['T-279'] });
task('T-17', 'TR-12', 'Beacon recorded-not-taken follow-ups', { st: 'ready', low: true });
// TR-13 Buoy maker and catalog
task('T-273', 'TR-13', 'C030b Buoy presets: browser, guarded Add, baseline Reset, guarded Replace, save a copy', { st: 'ready' });
task('T-274', 'TR-13', 'C030c Buoy maker: Layers and custom colors', { st: 'ready' });
task('T-14', 'TR-13', 'Buoy preview lifecycle and cost (C030a leftovers)', { st: 'ready' });
task('T-275', 'TR-13', 'C030d Buoy representative marks: original spar and the five representative shapes', { st: 'waits', waits: ['T-274'] });
task('T-296', 'TR-13', 'C035 On-chart marks mode in the Buoy maker', { st: 'waits', waits: ['T-274'] });
task('T-276', 'TR-13', 'C040 Expand accepted original symbol batches', { st: 'waits', waits: ['T-273', 'T-275'] });
task('T-282', 'TR-13', 'R010 Retire replaced commercial symbol content', { st: 'waits', waits: ['T-276', 'T-296'] });
// TR-14 Currents
task('T-254', 'TR-14', 'CU010 Currents: first-party replacement for old flow model', { st: 'ready' });
task('T-16', 'TR-14', 'R070 Retire old flow: Currents, Swell, Rip and Eddy gone from the tree with notices reconciled', { st: 'waits', waits: ['T-254'] });
// TR-15 Fog
task('T-285', 'TR-15', 'K020 Accept integrated fog replacement', { st: 'ready' });
task('T-286', 'TR-15', 'R050 Retire mist dependency', { st: 'waits', waits: ['T-285'] });
// TR-3 Tide charts redraw (main)
task('T-271', 'TR-3', 'K010 Reconcile existing fog work and remaining replacement contract', { st: 'done', leaves: 'TR-15' });
task('T-272', 'TR-3', 'C030a Buoy preview: native follow-up validation, framing and final symbols', { st: 'done', leaves: 'TR-13' });
task('T-293', 'TR-3', 'F025 Beacon light-pattern mockup and native contract', { st: 'done', leaves: 'TR-12' });
task('T-287', 'TR-3', 'R060 Remove unused third-party chart packs', { st: 'ready', ans: 'Q19' });
task('T-15', 'TR-3', 'R061 symbol follow-ups: review minors M1 to M4 and nits', { st: 'ready', low: true });
task('T-18', 'TR-3', 'Chart store known limits: viewport orthographic size, non-transactional chart open', { st: 'ready', low: true });
task('T-21', 'TR-3', 'Untracked chart files end state', { st: 'ready', low: true });
task('T-367', 'TR-3', 'Harbor procedure texts: four stale lines the chart texts pass found outside its scope', { st: 'ready' });
task('T-288', 'TR-3', 'RV010 Review-tier source triage', { st: 'waits', cross: ['T-254'] });
task('T-289', 'TR-3', 'V010 Validate integrated charts and performance', { st: 'waits', waits: ['T-288'], cross: ['T-283', 'T-282', 'T-16', 'T-286'] });
task('T-290', 'TR-3', 'V020 Verify release payload and finalize chart sources', { st: 'waits', waits: ['T-287', 'T-289'] });
task('T-326', 'TR-3', 'Merge branch/chart-independence to main, with the installer notices and website Help branches', { st: 'waits', waits: ['T-290'], ans: 'Q13', out: 'WS-7' });
// WS-11, TR-33 Release 2.4.10
task('T-853', 'TR-33', 'Audit the station import plan with a second reader across messy station files and old harbors before T-851 builds it', { st: 'now', agent: 'import plan auditor', fresh: 'new' });
task('T-854', 'TR-33', 'Review the station reader and datum fixes T-839 to T-845 before T-851 builds on them', { st: 'now', review: true, agent: 'station reader reviewer', fresh: 'new' });
task('T-846', 'TR-33', 'The dock screen showed the surge alarm off while its harbor holds the alarm-on profile, and kept showing off', { st: 'now', agent: 'alarm first-read fix', fresh: 'new' });
task('T-847', 'TR-33', 'Mock the redrawn tide chart: tide stations as pill markers on a coastline zoomed out, its readable heights and short current arrows zoomed in', { st: 'now', session: true, fresh: 'new', ans: 'Q175' });
task('T-848', 'TR-33', 'Build the redrawn tide chart on the dock screen and in the web page from the approved mock', { st: 'waits', waits: ['T-847'], fresh: 'new', by: 'a helper agent' });
task('T-849', 'TR-33', 'Your second look: the redrawn tide chart on the dock screen and the web page, and the web page on your phone', { st: 'waits', waits: ['T-848'], fresh: 'new', by: 'the main session' });
task('T-851', 'TR-33', "The station import keeps a harbor's own datum notes and its printout's height rules instead of moving them into the station file", { st: 'waits', waits: ['T-853', 'T-854'], fresh: 'new' });
task('T-852', 'TR-33', 'Rehearse the Kettle Point import again after the datum-notes fix: its notes and printouts judged into station files, a fresh standalone report', { st: 'waits', waits: ['T-851'], fresh: 'new' });
task('T-790', 'TR-33', "Your look: the surge rehearsal's warning page and run report", { st: 'now', session: true, waits: ['T-852'] });
task('T-791', 'TR-33', 'Review what lands in 2.4.10: the charts, the reader fixes, the station import and the alarm', { st: 'waits', review: true, waits: ['T-790', 'T-846', 'T-849'], by: 'a helper agent' });
task('T-792', 'TR-33', 'Release 2.4.10 and its public download', { st: 'waits', waits: ['T-791'], by: 'the main session' });
// frees, from the waits on either side
for (const t of Object.values(tasks)) for (const w of t.waits.concat(t.cross)) if (tasks[w]) tasks[w].frees.push(t.id);

const ans = {
  Q519: { tok: '519a', name: 'Chart track order', on: 'Oct 20', said: 'Beacons to the end, then buoys', settles: 'Each big track finishes before the next starts: Beacons, then Buoy maker and catalog, then Currents, then Fog.' },
  Q19: { tok: '19a', name: 'Chart gaps: apply these changes?', on: 'Oct 21', said: 'Apply all of it', settles: 'Among the changes: T-287 closes with one data edit, the license and validator flip.' },
  Q13: { tok: '13b', name: 'Chart merge timing: per finished track, or at the end as planned?', on: 'Oct 21', said: 'At the end, as planned', settles: 'branch/chart-independence merges to main once, at the end of the workstream; WS-7 resumes after it.' },
  Q175: { tok: '175a', name: 'Harbor tide chart redraw', on: 'Nov 6', said: 'Redraw before 2.4.10', settles: 'The chart is redrawn in this release, with a short second look of yours before it ships.' }
};
for (const [id, a] of Object.entries(ans)) Object.assign(a, { id, key: id.toLowerCase(), url: '/r/' + id });

const ov = [
  { id: 'WS-11', name: 'Tidewatch: fixes from the dock', short: 'Tidewatch: fixes from the dock', state: 'active', words: 'TR-33 Release 2.4.10 active', counts: '11 open: 5 running, 6 waiting',
    train: { agents: 3, names: ['alarm first-read fix', 'import plan auditor', 'station reader reviewer'] }, needs: 'Review due on TR-33: 6 finished code tasks wait for a review', changed: '8 new, 4 started, 2 done', opens: true },
  { id: 'WS-12', name: 'Tide charts redraw: original charts and licensed data retirement', short: 'Tide charts redraw', state: 'waiting', words: '5 tracks: 1 waiting, 1 new, 3 parked', counts: '28 open, critical path 17 tasks', opens: true },
  { id: 'WS-7', name: 'Dock screen modernization: new layout and big type', short: 'Dock screen modernization', state: 'parked', words: '2 tracks: 1 parked, 1 new', counts: 'TR-1 opens when T-326 completes', stalled: 'stalled 7 days', opens: true },
  { id: 'WS-8', name: 'Harbor accounts: sign-in, API, website and app', short: 'Harbor accounts', state: 'parked', words: '1 track parked', counts: 'TR-2 waits on the release timing', gated: 'the release timing (Q169, Q422)', gatedQ: ['Q169', 'Q422'], stalled: 'stalled 7 days', opens: true },
  { id: 'WS-3', name: 'Lighthouse', short: 'Lighthouse', state: 'waiting', words: '5 tracks: 1 waiting, 4 parked', counts: '16 open on the main line', needs: 'Whether to run the foghorns a fourth time before your try', opens: true },
  { id: 'WS-14', name: 'Moorings: inbox', short: 'Moorings', state: 'waiting', words: '2 tracks waiting', counts: '24 open', stalled: 'stalled 4 days', needs: 'Park or keep TR-23 and TR-24: no movement since Nov 2', opens: true },
  { id: 'WS-13', name: 'Bellbuoy', short: 'Bellbuoy', state: 'waiting', words: '1 track waiting', counts: '8 open, inbox 7', stalled: 'stalled 3 days', needs: 'Park or keep TR-26: no movement since Nov 2', opens: true },
  { id: 'WS-17', name: 'Seawall: inbox', short: 'Seawall', state: 'waiting', words: '1 track waiting since Nov 5', counts: 'nothing open, inbox 1', opens: true },
  { id: 'WS-6', name: 'sea-shanty-bits', short: 'sea-shanty-bits', state: 'new', words: '2 tracks, new, nobody on them yet', counts: '8 open: 1 ready, 7 waiting', opens: true }
];
for (const o of ov) Object.assign(o, { key: o.id.toLowerCase(), url: '/ws/' + o.id, moves: [] });
const ovLinks = [{ from: 'WS-12', to: 'WS-7', n: 1, pairs: [['TR-1', 'T-326']], text: 'WS-7 TR-1 Dock screen to sign-off opens when T-326 Merge branch/chart-independence to main completes' }];

function track(ws, o) { return { ws, key: o.id.toLowerCase(), url: '/r/' + o.id, running: 0, junctions: [], doneRun: 0, doneList: [], moves: [], ...o }; }
const ws = {
  'WS-12': {
    name: 'Tide charts redraw: original charts and licensed data retirement', short: 'Tide charts redraw', key: 'ws-12', url: '/ws/WS-12',
    // the longest chain, each parked track waiting on the one it opens after (the contract's section 3)
    crit: { n: 17, from: 'T-675', to: 'T-326', path: ['T-675', 'T-676', 'T-677', 'T-678', 'T-279', 'T-283', 'T-274', 'T-275', 'T-276', 'T-282', 'T-254', 'T-16', 'T-285', 'T-286', 'T-289', 'T-290', 'T-326'] },
    held: null, changed: null,
    tracks: [
      track('WS-12', { id: 'TR-12', name: 'Beacons', state: 'new', words: 'new, nobody on it yet', open: 8, ready: 3, waiting: 5, done: 0, chain: 6, from: 'T-293',
        spine: ['T-675', 'T-676', 'T-677', 'T-678', 'T-279', 'T-283'], resume: '/askerdo resume TR-12' }),
      track('WS-12', { id: 'TR-13', name: 'Buoy maker and catalog', chip: 'Buoy maker', state: 'parked', words: 'parked: after Beacons', stalled: 'stalled 7 days', open: 7, ready: 3, waiting: 4, done: 0, chain: 4, from: 'T-272',
        spine: ['T-274', 'T-275', 'T-276', 'T-282'], unpark: { kind: 'track-ends', on: 'TR-12' } }),
      track('WS-12', { id: 'TR-14', name: 'Currents', state: 'parked', words: 'parked: after Buoy maker', stalled: 'stalled 7 days', open: 2, ready: 1, waiting: 1, done: 0, chain: 2, from: null,
        spine: ['T-254', 'T-16'], unpark: { kind: 'track-ends', on: 'TR-13' } }),
      track('WS-12', { id: 'TR-15', name: 'Fog', state: 'parked', words: 'parked: after Currents', open: 2, ready: 1, waiting: 1, done: 0, chain: 2, from: 'T-271',
        spine: ['T-285', 'T-286'], unpark: { kind: 'track-ends', on: 'TR-14' } }),
      track('WS-12', { id: 'TR-3', name: 'Tide charts redraw (main: cleanup, license triage, validation, release)', short: 'Tide charts redraw', state: 'waiting', words: 'waiting since Oct 21', open: 9, ready: 5, waiting: 4, done: 23, chain: 9,
        from: null, spine: ['T-289', 'T-290', 'T-326'], doneRun: 20, junctions: ['T-271', 'T-272', 'T-293'], resume: '/askerdo resume TR-3' })
    ],
    links: [
      { from: 'TR-12', to: 'TR-13', kind: 'order', ans: 'Q519' },
      { from: 'TR-13', to: 'TR-14', kind: 'order', ans: 'Q519' },
      { from: 'TR-14', to: 'TR-15', kind: 'order', ans: 'Q519' },
      { from: 'TR-12', to: 'TR-3', kind: 'wait', pairs: [['T-289', 'T-283']] },
      { from: 'TR-13', to: 'TR-3', kind: 'wait', pairs: [['T-289', 'T-282']] },
      { from: 'TR-14', to: 'TR-3', kind: 'wait', pairs: [['T-288', 'T-254'], ['T-289', 'T-16']] },
      { from: 'TR-15', to: 'TR-3', kind: 'wait', pairs: [['T-289', 'T-286']] }
    ],
    out: [{ from: 'TR-3', task: 'T-326', ws: 'WS-7', text: 'WS-7 waits on T-326' }],
    in: []
  },
  'WS-11': {
    name: 'Tidewatch: fixes from the dock', short: 'Tidewatch: fixes from the dock', key: 'ws-11', url: '/ws/WS-11',
    crit: { n: 6, from: 'T-853', to: 'T-792', path: ['T-853', 'T-851', 'T-852', 'T-790', 'T-791', 'T-792'] },
    held: 'TR-33',
    changed: { n: '8 new, 4 started, 2 done', news: 8 },
    tracks: [
      track('WS-11', { id: 'TR-33', name: 'Release 2.4.10', state: 'active', words: 'active: the session and 3 agents', open: 11, running: 5, ready: 0, waiting: 6, done: 68, chain: 6,
        train: { agents: 3, names: ['alarm first-read fix', 'import plan auditor', 'station reader reviewer'], session: true }, from: null,
        spine: ['T-853', 'T-851', 'T-852', 'T-790', 'T-791', 'T-792'], doneRun: 68, reviewDue: 6, changed: '8 new, 4 started, 2 done', doneSince: ['T-850', 'T-787'],
        doneList: [
          { id: 'T-850', name: 'Rehearse the Seabright import a fourth time, with a fresh standalone report', closed: '2026-11-06T16:40:00' },
          { id: 'T-787', name: "Your look's steps for wave 3: the dock board, the windowed chart, the web page's viewport", closed: '2026-11-06T15:10:00' }
        ] })
    ],
    links: [],
    out: [],
    in: []
  }
};

/* a fresh copy each call, so a test may change it */
export function pictureMockData() {
  return JSON.parse(JSON.stringify({ at: '2026-11-06T18:00:00', look: '2026-11-06T14:23:00', ov, ovLinks, ws, tasks, ans }));
}
