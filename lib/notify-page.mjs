/* The notifications page: one served page where
   each category says whether it shows and with which sound. A change is ONE
   POST of ONE value and the control repaints from the answer. */
import {
  CATEGORY_KEYS, SOUNDS, collapseAlert, questionAlert, workAlert,
} from './notify.mjs';

/* ---- small helpers ----------------------------------------------------- */

/* A value the page script reads, embedded as a JavaScript literal. '<' is
   escaped so a payload can never open a tag out of a script body, and the two
   unicode line separators end a line in JavaScript but not in JSON. */
export function literal(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---- the sample cards the Test button raises ---------------------------- */

/* `Q0`, `T-0` and `P-0` are ids the store can never mint, so a test card names no
   real record and still passes the id gates of the production builders. */
const Q = 'Q0';

const GISTS = Object.freeze({
  blocking: 'a test is asking nothing here: this is the shape a question that blocks work '
    + 'arrives in.\nthe second line is the second line of the gist, which is where a real '
    + 'question would carry the rest of its ask.',
  open: 'a test preference, so nothing is stuck and nothing is waiting on you.',
  closed: 'a test closing a question it never opened, so the close line reads first and the '
    + 'gist second.',
  woken: 'a test of a snoozed question waking, to show the open card off the woken row.',
});

/* One per category row, in CATEGORY_KEYS order; the label and hint are the row's words. */
export const SAMPLE_SHAPES = Object.freeze([
  {
    key: 'blocking',
    label: 'a blocking question opened',
    hint: 'the card a question that blocks work raises',
    builder: 'question',
    event: { kind: 'open', id: Q, name: 'test blocking', blocking: true, gist: GISTS.blocking },
  },
  {
    key: 'open',
    label: 'a question opened',
    hint: 'the same card for a preference: nothing is stuck',
    builder: 'question',
    event: { kind: 'open', id: Q, name: 'test', blocking: false, gist: GISTS.open },
  },
  {
    key: 'closed',
    label: 'a question closed',
    hint: 'what the board raises when a question is answered',
    builder: 'question',
    event: { kind: 'closed', id: Q, name: 'test', status: 'answered', gist: GISTS.closed },
  },
  {
    key: 'woken',
    label: 'a question woken',
    hint: 'a snoozed question coming back: the open card, off the woken gate',
    builder: 'question',
    event: { kind: 'open', id: Q, name: 'test woken', blocking: false, gist: GISTS.woken, woken: true, wokenName: 'test task, completed' },
  },
  {
    key: 'task-completed',
    label: 'a task completed',
    hint: 'the work half: a terminal ending a session authored',
    builder: 'work',
    event: { id: 'T-0', name: 'test', ending: 'completed' },
  },
  {
    key: 'task-dropped',
    label: 'a task dropped',
    hint: 'the other terminal status a task can land on',
    builder: 'work',
    event: { id: 'T-0', name: 'test', ending: 'dropped' },
  },
  {
    key: 'plan-closed',
    label: 'a plan closed',
    hint: 'a close carries its outcome into the line',
    builder: 'work',
    event: { id: 'P-0', name: 'test', ending: 'closed', outcome: 'shipped' },
  },
  {
    key: 'collapse',
    label: 'the collapse summary',
    hint: 'the last card of a burst over the cap of five, on its own',
    builder: 'collapse',
    event: { more: 2 },
  },
]);

export function sampleShape(key) {
  return SAMPLE_SHAPES.find((s) => s.key === String(key)) || null;
}

/* The alert request through the production builder the shape names and no
   other route, wearing the sound on screen; a sample names no record, so it
   asks for no files. */
export function sampleAlert(shape, sound) {
  const s = shape || {};
  if (s.builder === 'collapse') return collapseAlert((s.event || {}).more, sound);
  const alert = s.builder === 'work' ? workAlert(s.event, sound) : questionAlert(s.event, sound);
  return { ...alert, files: false };
}

/* ---- the eight rows ---------------------------------------------------- */

/* ONE OVERRIDE on the sample's words: `plan-closed` is the single row for a
   plan and a workstream closing, so its label says both. */
const LABEL_OVERRIDE = Object.freeze({
  'plan-closed': 'a plan or workstream closed',
});

export const NOTIFY_ROWS = Object.freeze(CATEGORY_KEYS.map((key) => {
  const shape = sampleShape(key) || {};
  return Object.freeze({
    key,
    label: LABEL_OVERRIDE[key] || String(shape.label || key),
    hint: String(shape.hint || ''),
  });
}));

/* ---- the sound set, with the words a person reads over it -------------- */

/* The readable word for a Windows sound name. The looping families are derived
   rather than listed, so this can never fall out of step with SOUNDS. */
const SOUND_WORDS = Object.freeze({
  Default: 'default',
  IM: 'instant message',
  Mail: 'mail',
  Reminder: 'reminder',
  SMS: 'text message',
});

export function soundLabel(value) {
  const name = String(value === undefined || value === null ? '' : value);
  if (name === 'silent') return 'silent, no sound';
  if (SOUND_WORDS[name]) return SOUND_WORDS[name];
  const m = /^Looping\.(Alarm|Call)(\d*)$/.exec(name);
  if (m) return (m[1] === 'Alarm' ? 'alarm ' : 'call ') + (m[2] || '1');
  return name;
}

/* The sound select's whole vocabulary, in the order it is shown. It is EXACTLY
   the set the settings route validates against, which is what makes a stale
   page impossible to save from. */
export const SOUND_VALUES = Object.freeze([...SOUNDS, 'silent']);

/* ---- the chrome -------------------------------------------------------- */

/* house.css carries the tokens every rule below resolves through. THE HINT
   REGISTER IS --ink-2 AND NOT --ink-3: every word on a settings surface is
   load-bearing, and --ink-3 measures 3.6:1 against a 4.5:1 floor. */
function chrome() {
  return [
    '.board-head, .lab-main, .nf-foot { max-width: 900px;'
      + ' margin-left: auto; margin-right: auto; }',
    '.board-head { margin-bottom: 18px; }',
    '.board-head h1 { margin: 0 0 8px; font-weight: 700; letter-spacing: -0.02em;'
      + ' background: linear-gradient(100deg, var(--teal-acc), var(--blue-acc));'
      + ' -webkit-background-clip: text; background-clip: text; color: transparent; }',
    '.board-hint { font-size: var(--fs-small); color: var(--ink-2); margin: 8px 0 0; }',
    /* the way out */
    '.lab-ctl { display: flex; align-items: center; gap: 14px; flex-wrap: wrap;'
      + ' margin: 14px 0 0; }',
    '.lab-ctl a { color: var(--blue); font-weight: 600; text-decoration: none;'
      + ' font-size: var(--fs-small); }',
    '.lab-ctl a:hover { color: var(--blue-acc); }',
    '.lab-err { color: var(--red); font-size: var(--fs-small); margin: 0 0 12px; }',
    '.lab-err:empty { display: none; }',
    /* the master switch and the quiet hours, above the rows and in one card */
    '.nf-top { background: var(--card); border: 1px solid var(--line);'
      + ' border-radius: var(--r-card); padding: 14px 16px; margin: 0 0 16px;'
      + ' box-shadow: var(--shadow-card); }',
    '.nf-main-sw { display: flex; align-items: center; gap: 9px; font-weight: 650;'
      + ' color: var(--ink); cursor: pointer; }',
    /* the pause, between the master switch and the quiet hours: one row of
       buttons and the words the SERVER built for the state they wrote */
    '.nf-pause { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;'
      + ' margin: 12px 0 0; font-size: var(--fs-small); color: var(--ink-2); }',
    '.nf-pause .nf-b { padding: 4px 10px; }',
    '.nf-pause-now { color: var(--ink); font-weight: 650; }',
    '.nf-pause-now:empty { display: none; }',
    '.nf-quiet { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;'
      + ' margin: 12px 0 0; font-size: var(--fs-small); color: var(--ink-2); }',
    '.nf-quiet label { display: flex; align-items: center; gap: 7px; }',
    '.nf-h { font-size: var(--fs-small); color: var(--ink-2); font-weight: 400; }',
    '.nf-top .nf-h { display: block; margin: 7px 0 0; }',
    /* one card per category: the words on the left, the two controls and the
       two buttons on the right, wrapping under them at a narrow width */
    '.nf-rows { display: flex; flex-direction: column; gap: 10px; }',
    '.nf-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;'
      + ' background: var(--card); border: 1px solid var(--line);'
      + ' border-radius: var(--r-card); padding: 11px 14px;'
      + ' box-shadow: var(--shadow-card); }',
    '.nf-row:hover { border-color: var(--line-2); }',
    '.nf-name { flex: 1 1 240px; min-width: 0; color: var(--ink); font-weight: 650; }',
    '.nf-name .nf-h { display: block; margin-top: 2px; }',
    '.nf-f { display: flex; align-items: center; gap: 6px; font-size: var(--fs-small);'
      + ' color: var(--ink-2); }',
    '.nf-f select { font: inherit; font-size: var(--fs-small); color: var(--ink);'
      + ' background: var(--card-flat); border: 1px solid var(--line-2);'
      + ' border-radius: var(--r-ctl); padding: 5px 8px; cursor: pointer; }',
    '.nf-quiet input[type="time"] { font: inherit; font-size: var(--fs-small);'
      + ' color: var(--ink); background: var(--card-flat);'
      + ' border: 1px solid var(--line-2); border-radius: var(--r-ctl);'
      + ' padding: 5px 8px; }',
    /* an "on" control wears the house teal: the palette rule leaves no green */
    '.nf-row input[type="checkbox"], .nf-top input[type="checkbox"] {'
      + ' accent-color: var(--teal); width: 15px; height: 15px; cursor: pointer; }',
    '.nf-show { display: flex; align-items: center; gap: 7px; font-size: var(--fs-small);'
      + ' color: var(--ink-2); cursor: pointer; }',
    '.nf-b { font: inherit; font-size: var(--fs-small); font-weight: 600;'
      + ' color: var(--ink); background: var(--card-flat);'
      + ' border: 1px solid var(--line-2); border-radius: var(--r-ctl);'
      + ' padding: 5px 12px; cursor: pointer; }',
    '.nf-b:hover { border-color: var(--blue); color: var(--blue-acc); }',
    '.nf-play { padding: 5px 9px; }',
    '.nf-foot { margin-top: 26px; font-size: var(--fs-small); color: var(--ink-2); }',
    /* the openers, at the foot: one card in the master switch's own shape, two
       text fields wide enough to read a whole template in */
    '.nf-open-h { font-size: var(--fs-small); font-weight: 700; margin: 0 0 4px;'
      + ' text-transform: uppercase; letter-spacing: 0.16em; color: var(--ink-2); }',
    '.nf-ed { display: flex; flex-direction: column; gap: 9px; margin: 10px 0 0;'
      + ' font-size: var(--fs-small); color: var(--ink-2); }',
    '.nf-ed label { display: flex; align-items: center; gap: 7px; }',
    '.nf-ed input { flex: 1 1 auto; min-width: 0; font: inherit;'
      + ' font-family: var(--font-mono); font-size: var(--fs-small);'
      + ' color: var(--ink); background: var(--card-flat);'
      + ' border: 1px solid var(--line-2); border-radius: var(--r-ctl); padding: 5px 10px; }',
    '.nf-open .nf-h code { font-family: var(--font-mono); color: var(--ink);'
      + ' word-break: break-all; }',
  ].join('\n  ');
}

/* The tab's mark, with NO dot on it, the file viewer's reason: the dot is
   question-driven and this page reads no question queue, so it wears the face
   that claims the least. */
const FAVICON = 'favicon-quiet.svg';

/* `css` is a page's own rules after the shared ones (the Add a PC page) */
export function shell(assetBase, title, css = '') {
  const base = String(assetBase || '');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">\n'
    + '<title>' + esc(title) + '</title>\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<meta name="color-scheme" content="dark">\n'
    + '<link rel="icon" href="' + esc(base) + '/' + FAVICON + '">\n'
    + '<link rel="stylesheet" href="' + esc(base) + '/house.css">\n'
    + '<style>\n  ' + chrome() + (css ? '\n  ' + css : '') + '\n</style>\n</head>\n<body>\n';
}

/* ---- the page script --------------------------------------------------- */

/* One paint off the GET, one POST per change, one repaint off the answer.
   Every value the script sets is a PROPERTY or TEXT: the settings are the
   server's own words. No keyboard work: the controls are real controls. */
function pageScript() {
  return [
    '(function () {',
    '  var err = document.getElementById("nf-err");',
    '  var busy = false;',
    '  var pending = null;',
    '  function rows() { return document.querySelectorAll(".nf-row"); }',
    '  function field(row, name) { return row.querySelector("[data-f=\\"" + name + "\\"]"); }',
    '  function paint(s) {',
    '    if (!s || typeof s !== "object") return;',
    '    document.getElementById("nf-enabled").checked = s.enabled !== false;',
    '    document.getElementById("nf-from").value = typeof s.quietFrom === "string" ? s.quietFrom : "";',
    '    document.getElementById("nf-to").value = typeof s.quietTo === "string" ? s.quietTo : "";',
    /* THE PAUSE'S OWN WORDS ARE THE SERVER'S: this page formats no time
       of its own, so the two surfaces cannot say a pause two ways. An empty
       label is no pause, which is what greys Resume. */
    '    var lab = typeof s.pauseLabel === "string" ? s.pauseLabel : "";',
    '    document.getElementById("nf-pause-now").textContent = lab ? "Paused " + lab : "";',
    '    document.getElementById("nf-resume").disabled = !lab;',
    /* the editor's two templates, painted the way every other
       value here is: a PROPERTY the answer set, never markup this page built. */
    '    var ed = s.editor && typeof s.editor === "object" ? s.editor : {};',
    '    document.getElementById("nf-ed-file").value = typeof ed.file === "string" ? ed.file : "";',
    '    document.getElementById("nf-ed-folder").value = typeof ed.folder === "string" ? ed.folder : "";',
    '    var cats = s.categories || {};',
    '    var list = rows();',
    '    for (var i = 0; i < list.length; i += 1) {',
    '      var row = list[i];',
    '      var c = cats[row.getAttribute("data-cat")];',
    '      if (!c) continue;',
    '      field(row, "show").checked = c.show !== false;',
    '      field(row, "sound").value = c.sound;',
    '    }',
    '  }',
    '  function load() {',
    '    return fetch(NF.get, { headers: { Accept: "application/json" } })',
    '      .then(function (r) { return r.json(); })',
    '      .then(paint, function () { err.textContent = "the board did not answer"; });',
    '  }',
    /* A CHANGE MADE WHILE A POST IS IN FLIGHT IS QUEUED, NOT DROPPED: it joins
       a pending patch and goes out the moment that POST settles, or the page
       could keep a value on screen the board was never asked for. */
    '  function merge(into, patch) {',
    '    for (var k in patch) {',
    '      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;',
    /* the editor's two templates are two controls, so a change queued on one
       must not take the other's queued change down with it */
    '      if (k === "editor") {',
    '        var ed = patch.editor || {};',
    '        into.editor = into.editor || {};',
    '        for (var tpl in ed) {',
    '          if (Object.prototype.hasOwnProperty.call(ed, tpl)) into.editor[tpl] = ed[tpl];',
    '        }',
    '        continue;',
    '      }',
    '      if (k !== "categories") { into[k] = patch[k]; continue; }',
    '      var cats = patch.categories || {};',
    '      into.categories = into.categories || {};',
    '      for (var c in cats) {',
    '        if (!Object.prototype.hasOwnProperty.call(cats, c)) continue;',
    '        var one = cats[c] || {};',
    '        into.categories[c] = into.categories[c] || {};',
    '        for (var f in one) {',
    '          if (!Object.prototype.hasOwnProperty.call(one, f)) continue;',
    '          into.categories[c][f] = one[f];',
    '        }',
    '      }',
    '    }',
    '    return into;',
    '  }',
    /* THE ONE PLACE busy IS CLEARED, and the chain reaches it down BOTH arms,
       so a throw inside paint cannot wedge the page with a queue that never
       goes out. */
    '  function reset() {',
    '    busy = false;',
    '    var next = pending;',
    '    pending = null;',
    '    if (next) save(next);',
    '  }',
    /* ONE POST OF ONE VALUE, and the answer is what the page repaints from:
       what is on screen is what was written, never what was asked for */
    '  function save(patch) {',
    '    if (busy) { pending = merge(pending || {}, patch); return; }',
    '    busy = true;',
    '    err.textContent = "";',
    '    fetch(NF.post, {',
    '      method: "POST",',
    '      headers: { "Content-Type": "application/json" },',
    '      body: JSON.stringify(patch),',
    '    }).then(function (r) {',
    '      return r.json().then(function (j) { return { ok: r.ok, body: j }; },',
    '        function () { return { ok: r.ok, body: {} }; });',
    '    }).then(function (out) {',
    '      if (out.ok) return paint(out.body.settings);',
    '      err.textContent = out.body.error || "the setting was refused";',
    '      return load();',
    '    }, function () {',
    '      err.textContent = "the board did not answer";',
    '    }).then(reset, reset);',
    '  }',
    /* THE TEST BUTTON AND THE PLAY ARROW: a popup card down a write-nothing
       path, with no gate of any kind, because you clicked */
    '  function test(body) {',
    '    err.textContent = "";',
    '    fetch(NF.test, {',
    '      method: "POST",',
    '      headers: { "Content-Type": "application/json" },',
    '      body: JSON.stringify(body),',
    '    }).then(function (r) {',
    '      if (r.ok) return null;',
    '      return r.json().then(function (j) {',
    '        err.textContent = j.error || "the test was refused";',
    '      }, function () { err.textContent = "the test was refused"; });',
    '    }, function () { err.textContent = "the board did not answer"; });',
    '  }',
    '  document.addEventListener("change", function (ev) {',
    '    var t = ev.target;',
    '    if (!t || !t.closest) return;',
    '    if (t.id === "nf-enabled") return save({ enabled: t.checked });',
    '    if (t.id === "nf-from") return save({ quietFrom: t.value });',
    '    if (t.id === "nf-to") return save({ quietTo: t.value });',
    '    if (t.id === "nf-ed-file") return save({ editor: { file: t.value } });',
    '    if (t.id === "nf-ed-folder") return save({ editor: { folder: t.value } });',
    '    var row = t.closest(".nf-row");',
    '    if (!row) return undefined;',
    '    var name = t.getAttribute("data-f");',
    '    if (!name) return undefined;',
    '    var one = {};',
    '    one[name] = name === "show" ? t.checked : t.value;',
    '    var patch = { categories: {} };',
    '    patch.categories[row.getAttribute("data-cat")] = one;',
    '    return save(patch);',
    '  });',
    '  document.addEventListener("click", function (ev) {',
    '    if (!ev.target.closest) return;',
    '    var b = ev.target.closest("button[data-do]");',
    '    if (!b) return;',
    /* the pause buttons are the SAME save() the switches use, one verb per
       button, and the answer is what the words repaint from */
    '    var p = b.getAttribute("data-pause");',
    '    if (p !== null) return save({ pause: p });',
    '    var row = b.closest(".nf-row");',
    '    if (!row) return;',
    '    var sound = field(row, "sound").value;',
    '    if (b.getAttribute("data-do") === "play") return test({ sound: sound });',
    '    return test({ category: row.getAttribute("data-cat"), sound: sound });',
    '  });',
    '  load();',
    '}());',
  ].join('\n');
}

/* ---- the page ---------------------------------------------------------- */

function option(value, label) {
  return '<option value="' + esc(value) + '">' + esc(label) + '</option>';
}

function row(r) {
  return '<div class="nf-row" data-cat="' + esc(r.key) + '">'
    + '<span class="nf-name">' + esc(r.label)
    + '<span class="nf-h">' + esc(r.hint) + '</span></span>'
    + '<label class="nf-show"><input type="checkbox" data-f="show"> show</label>'
    + '<label class="nf-f">sound '
    + '<select data-f="sound">'
    + SOUND_VALUES.map((s) => option(s, soundLabel(s))).join('')
    + '</select></label>'
    + '<button class="nf-b nf-play" data-do="play" aria-label="play this sound"'
    + ' title="play this sound">&#9654;</button>'
    + '<button class="nf-b" data-do="test">Test</button>'
    + '</div>';
}

/* Everything the caller has to name. No store value reaches this renderer,
   because this page reads no store. */
export function renderNotify(meta) {
  const m = meta || {};
  const base = String(m.assetBase || '');
  const script = 'var NF = ' + literal({
    get: String(m.getUrl || ''),
    post: String(m.postUrl || ''),
    test: String(m.testUrl || ''),
  }) + ';\n' + pageScript();
  return shell(base, 'AskerDo notifications')
    + '<header class="board-head">\n'
    + '<h1>notifications</h1>\n'
    + '<p class="lede">One row per notification the board raises in the tray\'s popup: '
    + 'whether it shows at all, and which of Windows\' own sounds it rings. A change is saved '
    + 'the moment you make it, and the control repaints from what was written. Test draws '
    + 'that row\'s card with the sound on screen, and the arrow plays the sound on its own; '
    + 'neither writes anything.</p>\n'
    + '<p class="lab-ctl">'
    + (m.boardBase ? '<a href="' + esc(m.boardBase) + '">back to the board</a>' : '')
    + '</p>\n'
    + '</header>\n'
    + '<main class="lab-main">\n'
    + '<p class="lab-err" id="nf-err"></p>\n'
    + '<section class="nf-top">\n'
    + '<label class="nf-main-sw"><input type="checkbox" id="nf-enabled"> notifications on</label>'
    + '<span class="nf-h">Off silences every row below, and stops the tray exe being '
    + 'started for an alert at all.</span>\n'
    + '<div class="nf-pause">'
    + '<span>pause</span>'
    + '<button class="nf-b" data-do="pause" data-pause="hour">For 1 hour</button>'
    + '<button class="nf-b" data-do="pause" data-pause="tomorrow">Until 07:00 tomorrow</button>'
    + '<button class="nf-b" data-do="pause" data-pause="until-resume">Until I resume</button>'
    + '<button class="nf-b" data-do="pause" data-pause="" id="nf-resume" disabled>Resume now</button>'
    + '<span class="nf-pause-now" id="nf-pause-now"></span>'
    + '</div>'
    + '<span class="nf-h">A pause silences every row below until it ends, and the tray menu '
    + 'carries the same four buttons. Test and the play arrow are never paused.</span>\n'
    + '<div class="nf-quiet">'
    + '<label>quiet hours, from <input type="time" id="nf-from"></label>'
    + '<label>to <input type="time" id="nf-to"></label>'
    + '</div>'
    + '<span class="nf-h">Empty means off. A window may cross midnight, and a window whose '
    + 'ends are equal is off.</span>\n'
    + '</section>\n'
    + '<section class="nf-rows">' + NOTIFY_ROWS.map(row).join('') + '</section>\n'
    /* THE OPENERS, at the FOOT of this page: the editor target is a setting
        and a setting on this board is edited on a page. The rule
       that matters holds: THE SERVER NEVER RUNS IT, the tray exe does. */
    + '<section class="nf-top nf-open">\n'
    + '<h2 class="nf-open-h">openers</h2>\n'
    + '<div class="nf-ed">'
    + '<label>a file <input type="text" id="nf-ed-file" spellcheck="false"'
    + ' autocomplete="off" autocapitalize="off"></label>'
    + '<label>a folder <input type="text" id="nf-ed-folder" spellcheck="false"'
    + ' autocomplete="off" autocapitalize="off"></label>'
    + '</div>'
    + '<span class="nf-h">The one editor the board opens a linked file in. A scheme '
    + 'url or a command line; {path}, {line} and {col} are filled in, and a :{line} or '
    + ':{col} tail leaves when the ref names neither. The defaults are '
    + '<code>vscode://file/{path}:{line}:{col}</code> and <code>vscode://file/{path}/</code>. '
    + 'A command line has to name the program in full, as in '
    + '<code>"C:/Program Files/Microsoft VS Code/Code.exe" {path}</code>: measured here, '
    + '<code>code {path}</code> is not found at all, and <code>code.cmd {path}</code> starts '
    + 'the editor too (it once reported success and opened nothing, while the child inherited '
    + 'the exe\'s handles; the exe nulls them now). Empty means the control says so instead, and folder '
    + 'in editor leaves the overflow menu. The board never runs either template: it hands the '
    + 'tray exe a program and an argument list, and the exe runs them.</span>\n'
    + '</section>\n'
    + '</main>\n'
    + (m.version ? '<p class="nf-foot">board ' + esc(m.version) + '</p>\n' : '')
    + '<script>\n' + script + '\n</script>\n'
    + '</body></html>\n';
}
