/* Invented shapes from a harbor board around the Tidewatch demo, as picture-model.mjs gives them, cut to
   what the Overview's, the workstream level's and the track level's drawing and the legend read: WS-7, a
   parked track with a stall, a wait between its two tracks, chips in and out, and the line ending on a
   task that waits on another workstream; WS-3, a main line with four parks under it, two of them beside a
   wait, three opening when a task completes; WS-14, two neighbours on a row joined by a critical wait;
   WS-12, TR-12 and TR-15 with their left and right chips and answer chips; the Overview, nine workstreams,
   two of them waiting on each other and a third on one of them. */
export function pictureWsShapes() {
  return {
    'WS-7': {
      look: null, ov: [], ovLinks: [], ans: {},
      tasks: {
        "T-259": { id: "T-259", tr: "TR-1", name: "Tide row dropdown contents vertically off-centre", st: "waits", waits: [], cross: ["T-326"], frees: ["T-255"] },
        "T-255": { id: "T-255", tr: "TR-1", name: "Tide row resize grip", st: "waits", waits: ["T-259"], cross: ["T-326"], frees: ["T-121", "T-236", "T-235"] },
        "T-121": { id: "T-121", tr: "TR-1", name: "Phase 5: sweep and layout acceptance", st: "waits", waits: ["T-255"], cross: [], frees: ["T-233"] },
        "T-236": { id: "T-236", tr: "TR-1", name: "Dock screen final acceptance: walkthrough with the user and sign-off", st: "waits", waits: ["T-255"], cross: ["T-252", "T-253"], frees: ["T-233"] },
        "T-235": { id: "T-235", tr: "TR-1", name: "Website docs prose for the new dock screen", st: "waits", waits: ["T-255"], cross: ["T-252", "T-253"], frees: ["T-144"], out: "WS-8" },
        "T-233": { id: "T-233", tr: "TR-1", name: "Website screenshot refresh: dock screen and console, after final UI approval", st: "waits", waits: ["T-121", "T-236"], cross: [], frees: ["T-144"], out: "WS-8" },
        "T-247": { id: "T-247", tr: "TR-1", name: "Preferences Colors section (theme customizer)", st: "waits", waits: [], cross: ["T-144"], frees: [] },
        "T-252": { tr: "TR-16" },
        "T-253": { tr: "TR-16" },
      },
      ws: { 'WS-7': {
        crit: { n: 4, from: "T-259", to: "T-233", path: ["T-259", "T-255", "T-121", "T-233"] },
        tracks: [
          { id: "TR-1", ws: "WS-7", name: "Dock screen to sign-off, then the release's website work", state: "parked", words: "parked: until T-326 completes", stalled: "stalled 8 days", open: 7, waiting: 7, done: 17,
            spine: ["T-259", "T-255", "T-121", "T-233", "T-247"], from: null, doneRun: 17, junctions: [] },
          { id: "TR-16", name: "Dock-app walkthrough fixes", state: "new", words: "new, nobody on it yet", open: 2, waiting: 2, done: 0 },
        ],
        links: [
          { from: "TR-16", to: "TR-1", pairs: [["T-236", "T-252"], ["T-236", "T-253"], ["T-235", "T-252"], ["T-235", "T-253"]] },
        ],
        out: [
          { from: "TR-1", task: "T-235", ws: "WS-8", text: "WS-8 waits on T-235" },
          { from: "TR-1", task: "T-233", ws: "WS-8", text: "WS-8 waits on T-233" },
        ],
        in: [
          { to: "TR-16", task: "T-252", ws: "WS-12", on: "T-326", text: "waits on WS-12 T-326" },
          { to: "TR-1", task: "T-255", ws: "WS-12", on: "T-326", text: "waits on WS-12 T-326" },
          { to: "TR-1", task: "T-259", ws: "WS-12", on: "T-326", text: "waits on WS-12 T-326" },
          { to: "TR-1", task: "T-247", ws: "WS-8", on: "T-144", text: "waits on WS-8 T-144" },
          { to: "TR-16", task: "T-253", ws: "WS-12", on: "T-326", text: "waits on WS-12 T-326" },
          { to: "TR-1", task: null, ws: "WS-12", on: "T-326", text: "waits on WS-12 T-326" },
        ],
      } },
    },
    'WS-3': {
      look: null, ov: [], ovLinks: [], ans: { Q173: { tok: "173a" } },
      tasks: {
        "T-817": { id: "T-817", tr: "TR-18", name: "The east horn's sound clock runs about 8% slow from the start, 21 s behind over the cycle (Horns 107, Must be true 3)", st: "ready", waits: [], cross: [], frees: ["T-399"] },
        "T-398": { id: "T-398", tr: "TR-18", name: "The foghorn confirmation: the bench, then the north horn, then the east horn", st: "left", waits: [], cross: [], frees: ["T-399", "T-690", "T-698"] },
        "T-399": { id: "T-399", tr: "TR-18", name: "The user's try at the pier: one combined list", st: "waits", waits: ["T-398", "T-817"], cross: [], frees: ["T-401", "T-728", "T-729", "T-730", "T-736", "T-758"], ans: "Q173" },
        "T-401": { id: "T-401", tr: "TR-18", name: "Pick the next round from the try's findings and the parked research tracks' tasks", st: "waits", waits: ["T-399"], cross: [], frees: [] },
        "T-690": { tr: "TR-34" }, "T-698": { tr: "TR-34" }, "T-691": { tr: "TR-34" },
        "T-728": { tr: "TR-35" }, "T-729": { tr: "TR-35" }, "T-730": { tr: "TR-35" }, "T-736": { tr: "TR-35" }, "T-758": { tr: "TR-35" },
      },
      ws: { 'WS-3': {
        name: "Lighthouse",
        crit: { n: 6, from: "T-817", to: "T-691", path: ["T-817", "T-816", "T-820", "T-399", "T-401", "T-691"] },
        tracks: [
          { id: "TR-18", ws: "WS-3", name: "Lighthouse main line", state: "waiting", words: "waiting since Nov 5", open: 16, ready: 5, waiting: 11, done: 30,
            spine: ["T-817", "T-399", "T-401"], from: null, doneRun: 30, junctions: [] },
          { id: "TR-34", ws: "WS-3", name: "Lighthouse foghorn sound research", state: "parked", words: "parked: until T-401 completes", open: 38, ready: 36, waiting: 2, done: 0 },
          { id: "TR-35", ws: "WS-3", name: "Lighthouse lamps and lenses", state: "parked", words: "parked: until T-399 completes", open: 11, ready: 5, waiting: 6, done: 0 },
          { id: "TR-36", ws: "WS-3", name: "Lighthouse keeper engine and app leftovers", state: "parked", words: "parked: until T-401 completes", open: 15, ready: 15, waiting: 0, done: 0 },
          { id: "TR-37", ws: "WS-3", name: "Lighthouse before a public release", state: "parked", words: "parked", open: 4, ready: 4, waiting: 0, done: 0 },
        ],
        links: [
          { from: "TR-18", to: "TR-34", kind: "order", on: "T-401" },
          { from: "TR-18", to: "TR-35", kind: "order", on: "T-399" },
          { from: "TR-18", to: "TR-36", kind: "order", on: "T-401" },
          { from: "TR-18", to: "TR-34", kind: "wait", pairs: [["T-690", "T-398"], ["T-698", "T-398"]] },
          { from: "TR-18", to: "TR-35", kind: "wait", pairs: [["T-728", "T-399"], ["T-729", "T-399"], ["T-730", "T-399"], ["T-736", "T-399"], ["T-758", "T-399"]] },
        ],
      } },
    },
    'WS-14': {
      look: null, ov: [], ovLinks: [], tasks: { "T-503": { tr: "TR-24" }, "T-507": { tr: "TR-23" } }, ans: {},
      ws: { 'WS-14': {
        crit: { n: 17, from: "T-488", to: "T-510", path: ["T-503", "T-507"] },
        tracks: [
          { id: "TR-23", name: "Berth map acceptance", state: "waiting", words: "waiting since Oct 5", stalled: "stalled 4 days", open: 4, ready: 1, waiting: 3, done: 23 },
          { id: "TR-24", name: "Berth fix and verification", state: "waiting", words: "waiting since Oct 5", stalled: "stalled 4 days", open: 20, ready: 6, waiting: 14, done: 0 },
        ],
        links: [{ from: "TR-24", to: "TR-23", kind: "wait", pairs: [["T-507", "T-503"], ["T-508", "T-501"]] }],
        out: [], in: [],
      } },
    },
    'WS-12': {
      look: null, ov: [], ovLinks: [], ans: { Q519: { tok: "519a" } },
      tasks: {
        "T-17": { id: "T-17", tr: "TR-12", name: "Beacon recorded-not-taken follow-ups", st: "ready", waits: [], cross: [], frees: [] },
        "T-674": { id: "T-674", tr: "TR-12", name: "B3 fix: flash refused after a reset of a still-computing flash", st: "ready", waits: [], cross: [], frees: ["T-676"] },
        "T-675": { id: "T-675", tr: "TR-12", name: "B3 fix: Inspector panel and API disclosure", st: "ready", waits: [], cross: [], frees: ["T-676"] },
        "T-676": { id: "T-676", tr: "TR-12", name: "Review B3 fix wave", st: "waits", waits: ["T-675", "T-674"], cross: [], frees: ["T-677"], review: true },
        "T-677": { id: "T-677", tr: "TR-12", name: "B3 live gate", st: "waits", waits: ["T-676"], cross: [], frees: ["T-678"] },
        "T-678": { id: "T-678", tr: "TR-12", name: "F030 B4", st: "waits", waits: ["T-677"], cross: [], frees: ["T-279"] },
        "T-279": { id: "T-279", tr: "TR-12", name: "F030 Integrate the harbor beacon timing", st: "waits", waits: ["T-678"], cross: [], frees: ["T-283"] },
        "T-283": { id: "T-283", tr: "TR-12", name: "R030 Retire old lamp dependency", st: "waits", waits: ["T-279"], cross: [], frees: ["T-289"] },
        "T-285": { id: "T-285", tr: "TR-15", name: "K020 Accept integrated fog replacement", st: "ready", waits: [], cross: [], frees: ["T-286"] },
        "T-286": { id: "T-286", tr: "TR-15", name: "R050 Retire mist dependency", st: "waits", waits: ["T-285"], cross: [], frees: ["T-289"] },
        "T-289": { tr: "TR-3" }, "T-293": { tr: "TR-3" }, "T-271": { tr: "TR-3" },
      },
      ws: { 'WS-12': {
        name: "Chart independence: original charts and licensed data retirement", short: "Chart independence",
        crit: { n: 17, from: "T-675", to: "T-326", path: ["T-675", "T-676", "T-677", "T-678", "T-279", "T-283", "T-274", "T-275", "T-276", "T-282", "T-254", "T-16", "T-285", "T-286", "T-289", "T-290", "T-326"] },
        tracks: [
          { id: "TR-3", name: "Chart independence (main: cleanup, license triage, validation, release)", short: "Chart independence", state: "waiting", words: "waiting since Oct 21" },
          { id: "TR-12", ws: "WS-12", name: "Beacons", state: "new", words: "new, nobody on it yet", spine: ["T-675", "T-676", "T-677", "T-678", "T-279", "T-283"], from: "T-293", doneRun: 0, junctions: [] },
          { id: "TR-13", name: "Buoy maker and catalog", state: "parked", words: "parked: after Beacons" },
          { id: "TR-14", name: "Currents", state: "parked", words: "parked: after Buoy maker and catalog" },
          { id: "TR-15", ws: "WS-12", name: "Fog", state: "parked", words: "parked: after Currents", spine: ["T-285", "T-286"], from: "T-271", doneRun: 0, junctions: [] },
        ],
        links: [
          { from: "TR-12", to: "TR-13", kind: "order", ans: "Q519" },
          { from: "TR-13", to: "TR-14", kind: "order", ans: "Q519" },
          { from: "TR-14", to: "TR-15", kind: "order", ans: "Q519" },
          { from: "TR-12", to: "TR-3", kind: "wait", pairs: [["T-289", "T-283"]] },
          { from: "TR-13", to: "TR-3", kind: "wait", pairs: [["T-289", "T-282"]] },
          { from: "TR-14", to: "TR-3", kind: "wait", pairs: [["T-288", "T-254"], ["T-289", "T-16"]] },
          { from: "TR-15", to: "TR-3", kind: "wait", pairs: [["T-289", "T-286"]] },
        ],
        out: [], in: [],
      } },
    },
    ov: {
      look: null, ws: {}, tasks: {}, ans: {},
      ov: [
        { id: "WS-11", name: "Tidewatch: fixes from the dock", state: "active", words: "TR-33 Release 2.4.10 active", counts: "9 open: 2 running, 1 ready, 6 waiting", train: { agents: 2 }, needs: "Review due on TR-33 Release 2.4.10: 5 finished code tasks wait for a review" },
        { id: "WS-14", name: "Moorings: inbox", state: "waiting", words: "2 tracks waiting", counts: "24 open, critical path 17 tasks, inbox 1", needs: "Track TR-23 Berth map acceptance has open tasks and no movement since Nov 2 15:33", stalled: "stalled 4 days" },
        { id: "WS-8", name: "Harbor accounts: sign-in, API, website and app", short: "Harbor accounts", state: "parked", words: "1 track parked", counts: "2 open, critical path 2 tasks", needs: "Fetch the signed berth permit from the port authority's document service by 2026-11-07.", stalled: "stalled 8 days" },
        { id: "WS-3", name: "Lighthouse", state: "waiting", words: "5 tracks: 1 waiting, 4 parked", counts: "84 open, critical path 6 tasks", needs: "The third foghorn run failed line 3 on all three foghorns; the user has not been told yet, and a fourth run before the user's try is the user's call." },
        { id: "WS-13", name: "Bellbuoy", state: "waiting", words: "1 track waiting", counts: "8 open, critical path 6 tasks, inbox 7", needs: "Track TR-26 Chime reliability candidate: card layout and acceptance has open tasks and no movement since Nov 2 16:26", stalled: "stalled 4 days" },
        { id: "WS-12", name: "Chart independence: original charts and licensed data retirement", short: "Chart independence", state: "waiting", words: "5 tracks: 1 waiting, 1 new, 3 parked", counts: "28 open, critical path 17 tasks" },
        { id: "WS-7", name: "Dock screen modernization: new layout and big type", short: "Dock screen modernization", state: "parked", words: "2 tracks: 1 parked, 1 new", counts: "TR-1 opens when T-326 completes", stalled: "stalled 8 days" },
        { id: "WS-6", name: "sea-shanty-bits", state: "new", words: "2 tracks new", counts: "8 open, critical path 3 tasks, inbox 1" },
        { id: "WS-17", name: "Seawall: inbox", state: "waiting", words: "1 track waiting", counts: "nothing open, inbox 1" },
      ],
      ovLinks: [
        { from: "WS-7", to: "WS-8", n: 2, pairs: [["T-144", "T-235"], ["T-144", "T-233"]] },
        { from: "WS-8", to: "WS-7", n: 1, pairs: [["T-247", "T-144"]] },
        { from: "WS-12", to: "WS-7", n: 5, pairs: [["T-252", "T-326"], ["T-255", "T-326"], ["T-259", "T-326"], ["T-253", "T-326"], ["TR-1", "T-326"]] },
      ],
    },
  };
}
