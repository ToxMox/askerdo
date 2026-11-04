/* The Notifications page's RENDERER: a model in and an HTML string out,
 * so every case is a pure call. What the routes do with the page is
 * test/board-server.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NOTIFY_ROWS, SAMPLE_SHAPES, SOUND_VALUES, renderNotify, sampleAlert,
  sampleShape, soundLabel,
} from '../lib/notify-page.mjs';
import { ALERT_KINDS, CATEGORY_KEYS, SOUNDS, validateAlert } from '../lib/notify.mjs';
import { ASSETS } from '../lib/board-assets.mjs';
import { pluginRoot } from '../lib/node-helpers.mjs';

const META = Object.freeze({
  assetBase: '/s/assets',
  boardBase: '/s/',
  getUrl: '/s/api/notify',
  postUrl: '/s/api/notify',
  testUrl: '/s/api/notify/test',
  version: '0.5.28',
});

const page = (over) => renderNotify({ ...META, ...(over || {}) });

/* The page's own style block, which is where every rule it adds lives. */
function styles(html) {
  return html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
}

test('the page carries the eight rows in the lab own order, with three controls each', () => {
  const html = page();
  assert.deepEqual(NOTIFY_ROWS.map((r) => r.key), CATEGORY_KEYS.slice());
  const order = [...html.matchAll(/data-cat="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, CATEGORY_KEYS.slice(), 'eight rows, in the map own order');

  for (const r of NOTIFY_ROWS) {
    const row = html.slice(html.indexOf('data-cat="' + r.key + '"'));
    const end = row.indexOf('</div>');
    const one = row.slice(0, end);
    assert.ok(one.includes(r.label), r.key + ': the label');
    assert.ok(one.includes(r.hint), r.key + ': the hint');
    assert.ok(one.includes('<input type="checkbox" data-f="show">'), r.key + ': show');
    assert.ok(one.includes('<select data-f="sound">'), r.key + ': sound');
    assert.ok(one.includes('data-do="play"'), r.key + ': the play arrow');
    assert.ok(one.includes('data-do="test"'), r.key + ': the Test button');
  }
  assert.equal((html.match(/data-do="test"/g) || []).length, 8);
  assert.equal((html.match(/data-do="play"/g) || []).length, 8);
  assert.equal((html.match(/<select/g) || []).length, 8, 'one select per row and no more');
});

/* The row's words come from the sample table the Test button raises; the ONE
   override is the row that means two endings. */
test('the row words are the sample own, with one override for the row that means two', () => {
  assert.deepEqual(SAMPLE_SHAPES.map((s) => s.key), CATEGORY_KEYS, 'one sample per row, in order');
  for (const r of NOTIFY_ROWS) {
    const shape = sampleShape(r.key);
    assert.ok(shape, r.key + ' has no sample');
    assert.equal(r.hint, shape.hint, r.key);
    if (r.key !== 'plan-closed') assert.equal(r.label, shape.label, r.key);
  }
  const plan = NOTIFY_ROWS.find((r) => r.key === 'plan-closed');
  assert.equal(plan.label, 'a plan or workstream closed',
    'the ONE row for a plan and a workstream, and its label says both');
  assert.ok(page().includes('a plan or workstream closed'));
  assert.ok(!NOTIFY_ROWS.some((r) => r.key === 'ws-closed'));
});

/* Every sample goes through a production builder and names no real record. */
test('each sample builds an alert the route accepts, through the production builders', () => {
  for (const shape of SAMPLE_SHAPES) {
    const a = sampleAlert(shape, 'IM');
    const v = validateAlert(a);
    assert.equal(v.error, undefined, shape.key);
    assert.ok(ALERT_KINDS.includes(v.value.kind), shape.key);
    assert.equal(v.value.sound, 'IM', shape.key + ': the sound on screen');
    if (shape.event.id) assert.match(shape.event.id, /^(Q|T-|P-)0$/, shape.key);
  }
  assert.equal(sampleShape('no such row'), null);
  assert.equal(sampleAlert(sampleShape('collapse'), 'IM').kind, 'info', 'the summary names no record');
});

test('the sound select offers exactly the set the settings route validates', () => {
  const html = page();
  const block = (name) => {
    const at = html.indexOf('<select data-f="' + name + '">');
    return html.slice(at, html.indexOf('</select>', at));
  };
  const values = (name) => [...block(name).matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  /* the sound select is the closed table plus the word silent, and nothing a
     stale page could save that the route would refuse */
  assert.deepEqual(values('sound'), [...SOUNDS, 'silent']);
  assert.deepEqual(SOUND_VALUES.slice(), [...SOUNDS, 'silent']);
  assert.equal(values('sound').length, 26);

  /* the words over the values are readable, and derived for the two looping
     families so they cannot drift from SOUNDS */
  assert.equal(soundLabel('Default'), 'default');
  assert.equal(soundLabel('SMS'), 'text message');
  assert.equal(soundLabel('Looping.Alarm'), 'alarm 1');
  assert.equal(soundLabel('Looping.Alarm10'), 'alarm 10');
  assert.equal(soundLabel('Looping.Call'), 'call 1');
  assert.equal(soundLabel('Looping.Call7'), 'call 7');
  assert.equal(soundLabel('silent'), 'silent, no sound');
  for (const name of SOUND_VALUES) assert.ok(soundLabel(name).length > 0, name);
  assert.equal(new Set(SOUND_VALUES.map(soundLabel)).size, SOUND_VALUES.length,
    'one word per value, so a reader can tell any two apart');
});

test('the master switch and the quiet hours stand above the rows, and the tray does not', () => {
  const html = page();
  assert.ok(html.includes('<input type="checkbox" id="nf-enabled">'));
  assert.ok(html.includes('<input type="time" id="nf-from">'));
  assert.ok(html.includes('<input type="time" id="nf-to">'));
  assert.ok(html.indexOf('id="nf-enabled"') < html.indexOf('data-cat="blocking"'),
    'the master switch is above the rows');
  assert.ok(html.indexOf('id="nf-to"') < html.indexOf('data-cat="blocking"'));
  /* empty means off, said on the page */
  assert.ok(/[Ee]mpty means off/.test(html));
  /* THE ICON SWITCH IS NOT ON THIS PAGE: it stays a file key, and the GET route
     still answers it */
  assert.ok(!html.includes('nf-tray'));
  /* the icon switch is NOT a control here: the page names the exe in one line
     of prose and offers nothing to flip */
  assert.ok(!/<input[^>]*tray/i.test(html), 'no tray input');
  assert.ok(!/data-f="tray"/.test(html), 'and no tray field on a row');
  assert.equal((html.match(/<input /g) || []).length, 13,
    'the master switch, the two times, one show per row, and the editor\'s two'
    + ' templates at the foot');
  /* the three open keys never appear on a page at all */
  for (const never of ['openPreset', 'openScheme', 'openCommand']) {
    assert.ok(!html.includes(never), never);
  }
});

test('the page links the board', () => {
  const html = page();
  /* the popup answers to this page alone, so it names no Windows switch */
  assert.ok(!html.includes('Windows notification settings'));
  assert.ok(html.includes('<a href="/s/">back to the board</a>'));
  assert.ok(!html.includes('notification lab'), 'the lab page is gone (T-303)');
  /* and only where the caller named the URL */
  const bare = renderNotify({ assetBase: '/s/assets' });
  assert.ok(!bare.includes('back to the board'));
  assert.ok(bare.includes('data-cat="blocking"'), 'the rows stand either way');
});

test('the page loads house.css and the quiet face, and nothing off the register', () => {
  const html = page();
  const names = [...html.matchAll(/\/assets\/([A-Za-z0-9._-]+)/g)].map((m) => m[1]);
  assert.ok(names.length >= 2, names.join(','));
  for (const name of names) assert.ok(ASSETS[name], name);
  assert.ok(names.includes('house.css'), 'the house sheet is the theme');
  /* the quiet face: the dot is question-driven and this page reads no question queue */
  assert.ok(names.includes('favicon-quiet.svg'));
  /* the styles and the script are INLINE, so this page joins no register */
  assert.ok(!html.includes('<script src='), 'the script is inline, like the lab');
  assert.equal((html.match(/<link rel="stylesheet"/g) || []).length, 1,
    'one sheet, and it is the house one');
});

/* THE PALETTE RULE and the contrast floor over the page's own style block:
   house tokens only, and the hint register is --ink-2 because --ink-3 measures
   3.6:1 against a 4.5:1 floor. */
test('the chrome names house tokens only, and no colour outside the palette rule', () => {
  const css = styles(page());
  const house = readFileSync(join(pluginRoot, 'assets', 'house.css'), 'utf8');
  const used = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
  assert.ok(used.length > 10, 'the chrome resolves through tokens');
  for (const token of new Set(used)) {
    assert.ok(house.includes(token + ':'), 'house.css does not define ' + token);
  }
  /* no literal colour of any kind: no hex, no rgb, no hsl, no named hue */
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'a hex colour reached the chrome');
  assert.ok(!/\b(?:rgba?|hsla?)\(/.test(css), 'a literal colour function reached the chrome');
  for (const hue of ['green', 'lime', 'orange', 'yellow', 'olive', 'chartreuse']) {
    assert.ok(!new RegExp('\\b' + hue + '\\b').test(css), 'the palette rule bans ' + hue);
  }
  /* the "on" control wears a house blue rather than the browser's own green */
  assert.ok(css.includes('accent-color: var(--teal)'), 'the checkbox accent is a house token');
  assert.ok(!css.includes('var(--ink-3)'),
    'the hint register is --ink-2: --ink-3 is under the 4.5:1 floor on this ground');
});

test('the page installs no keyboard handler and no gesture of its own', () => {
  const html = page();
  const src = readFileSync(join(pluginRoot, 'lib', 'notify-page.mjs'), 'utf8');
  for (const key of ['keydown', 'keyup', 'keypress', 'accesskey', 'tabindex', 'onkey']) {
    assert.ok(!new RegExp(key, 'i').test(html), 'the page names ' + key);
  }
  /* only the two listeners a real control needs */
  const listeners = [...html.matchAll(/addEventListener\("([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(listeners.sort(), ['change', 'click']);
  assert.ok(!/document\.write|innerHTML|outerHTML|insertAdjacentHTML/.test(src),
    'every value the script sets is a property or text, never markup');
  /* it opens no stream and polls nothing: one read at load, then a write per
     change, which is the view route's own posture */
  assert.ok(!/setInterval|EventSource|visibilitychange/.test(html));
  assert.equal((html.match(/fetch\(/g) || []).length, 3, 'the load, the write and the test');
});

/* THE ONE THING A ONE-POST-PER-CHANGE PAGE CAN GET WRONG: a change made while
   the last POST is still in flight. It is QUEUED, not dropped, so a control can
   never keep a value the board was never asked for. */
test('a change made while a write is in flight is queued into a pending patch', () => {
  const html = page();
  assert.ok(html.includes('var pending = null;'), 'there is a queue');
  assert.ok(html.includes('if (busy) { pending = merge(pending || {}, patch); return; }'),
    'the busy guard merges the patch rather than dropping it');
  assert.ok(!/if \(busy\) return;/.test(html), 'and the silent drop is gone');
  /* the merge is field by field under categories, so two rows changed in one
     tick both reach the board */
  assert.ok(html.includes('function merge(into, patch) {'));
  assert.ok(html.includes('into.categories[c][f] = one[f];'));
  /* busy is cleared down BOTH arms of the chain, so a throw inside paint can
     never wedge the page with a queue that goes out no more */
  assert.ok(html.includes('}).then(reset, reset);'));
  assert.ok(html.includes('if (next) save(next);'), 'and the queued patch is what goes next');
});

test('every value the renderer is handed is escaped on its way into the page', () => {
  const html = renderNotify({
    ...META,
    assetBase: '/s"><script>a()</script>/assets',
    boardBase: "/s/'b'?a=1&b=<x>",
    version: '0.5.28 <b>x</b>',
  });
  assert.ok(!html.includes('<script>a()</script>'), 'an asset base cannot open a tag');
  assert.ok(html.includes('&quot;&gt;&lt;script&gt;'), html.slice(0, 400));
  assert.ok(html.includes('/s/&#39;b&#39;?a=1&amp;b=&lt;x&gt;'));
  assert.ok(html.includes('board 0.5.28 &lt;b&gt;x&lt;/b&gt;'));
  /* the three URLs the script reads are a JS literal with '<' escaped, so a
     payload string can never close the script element */
  const evil = renderNotify({ ...META, getUrl: '</script><img src=x>' });
  assert.ok(!evil.includes('</script><img'), 'the literal is escaped for a script body');
  assert.ok(evil.includes('\\u003c/script>'));
  /* one script element and one style element, and the document closes */
  assert.equal((evil.match(/<script>/g) || []).length, 1);
  assert.ok(evil.endsWith('</body></html>\n'));
});

test('the page is one document with a title, a dark scheme and a viewport', () => {
  const html = page();
  assert.ok(html.startsWith('<!doctype html><html lang="en"><head><meta charset="utf-8">'));
  assert.ok(html.includes('<title>AskerDo notifications</title>'));
  assert.ok(html.includes('<meta name="color-scheme" content="dark">'));
  assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes('<h1>notifications</h1>'));
  assert.ok(html.includes('id="nf-err"'), 'the error register the lab has');
  /* the board version, printed only where one was named */
  assert.ok(html.includes('board 0.5.28'));
  assert.ok(!renderNotify({ ...META, version: '' }).includes('board 0.5.28'));
});

/* ---- the pause block --------------------------------------------- */

/* ---- the openers section -------------------------- */

test('the openers card stands at the foot of the page, below every row', () => {
  const html = page();
  assert.ok(html.includes('<section class="nf-top nf-open">'));
  assert.ok(html.includes('<h2 class="nf-open-h">openers</h2>'));
  /* the two templates, as text inputs: a file and a folder, and nothing else */
  assert.ok(html.includes('<input type="text" id="nf-ed-file"'));
  assert.ok(html.includes('<input type="text" id="nf-ed-folder"'));
  /* BELOW the eight category rows and STILL INSIDE the main: the only thing
     after </main> is the optional board version line */
  const card = html.indexOf('<section class="nf-top nf-open">');
  assert.ok(html.indexOf('data-cat="blocking"') < card);
  assert.ok(card > 0 && card < html.indexOf('</main>'));
  assert.ok(/<\/main>\n(?:<p class="nf-foot">[^<]*<\/p>\n)?<script>/.test(html), html.slice(-400));
  /* the retired keys never appear on a page at all, and neither does a command
     the SERVER would run: the exe runs the template and the page names a kind */
  for (const never of ['openPreset', 'openScheme', 'openCommand', 'spawn']) {
    assert.ok(!html.includes(never), never);
  }
});

test('the help line carries the spellings that were measured, and the redline', () => {
  const html = page();
  /* the two defaults, said in full, since they are what an empty field means */
  assert.ok(html.includes('vscode://file/{path}:{line}:{col}'));
  assert.ok(html.includes('vscode://file/{path}/'));
  /* measured on Windows: the full path starts VS Code, and code.cmd does too because
     the opener nulls the standard handles */
  assert.ok(html.includes('name the program in full'));
  assert.ok(html.includes('<code>code {path}</code> is not found'));
  assert.ok(html.includes('starts the editor too'));
  /* the redline, in the page's own words: the server never runs it */
  assert.ok(html.includes('The board never runs either template'));
  /* and what an empty template costs, since that is a real value */
  assert.ok(html.includes('folder in editor leaves the overflow menu'));
});

test('each template is one POST of one value, and the answer is what it repaints from', () => {
  const html = page();
  assert.ok(html.includes('if (t.id === "nf-ed-file") return save({ editor: { file: t.value } });'));
  assert.ok(html.includes('if (t.id === "nf-ed-folder") '
    + 'return save({ editor: { folder: t.value } });'));
  /* the value on screen is a PROPERTY the answer set, so no template ever
     passes through this page's markup at all */
  assert.ok(html.includes('document.getElementById("nf-ed-file").value ='
    + ' typeof ed.file === "string" ? ed.file : "";'));
  assert.ok(html.includes('document.getElementById("nf-ed-folder").value ='
    + ' typeof ed.folder === "string" ? ed.folder : "";'));
  assert.ok(!/id="nf-ed-file"[^>]*value=/.test(html), 'the input renders with no value');
  /* a change queued behind a write in flight keeps BOTH templates, the way the
     categories branch keeps both rows */
  assert.ok(html.includes('if (k === "editor") {'));
  assert.ok(html.includes('if (Object.prototype.hasOwnProperty.call(ed, tpl)) '
    + 'into.editor[tpl] = ed[tpl];'));
});

test('the openers card adds no colour and no token outside the palette', () => {
  const css = styles(page());
  const block = css.slice(css.indexOf('.nf-open-h'));
  assert.ok(!/#[0-9a-fA-F]{3,8}/.test(block), block);
  assert.ok(!/rgb|hsl/.test(block), block);
  for (const token of ['var(--ink-2)', 'var(--ink)', 'var(--card-flat)', 'var(--line-2)',
    'var(--font-mono)', 'var(--fs-small)', 'var(--r-ctl)']) {
    assert.ok(block.includes(token), token);
  }
});

test('the pause block sits inside the top card, above the quiet hours', () => {
  const html = page();
  const top = html.indexOf('<section class="nf-top">');
  const pause = html.indexOf('<div class="nf-pause">');
  const quiet = html.indexOf('<div class="nf-quiet">');
  const rows = html.indexOf('<section class="nf-rows">');
  assert.ok(top >= 0 && pause >= 0 && quiet >= 0 && rows >= 0);
  assert.ok(top < pause, 'the pause is inside the top card');
  assert.ok(pause < quiet, 'master switch, pause, quiet hours, then the schedule');
  assert.ok(quiet < rows, 'and the row table is untouched below all of it');
});

test('the four pause buttons post the four values of the one verb', () => {
  const html = page();
  for (const [value, label] of [
    ['hour', 'For 1 hour'],
    ['tomorrow', 'Until 07:00 tomorrow'],
    ['until-resume', 'Until I resume'],
  ]) {
    assert.ok(html.includes('data-pause="' + value + '">' + label + '</button>'), label);
  }
  assert.ok(html.includes('data-pause="" id="nf-resume" disabled>Resume now</button>'));
  /* Resume is the one that starts greyed: an empty label from the server is no
     pause, and paint() is what un-greys it */
  assert.ok(html.includes('id="nf-resume" disabled'));
  /* the words the pause reads back into are the SERVER'S, never a time this
     page formatted: the script sets textContent from settings.pauseLabel */
  assert.ok(html.includes('s.pauseLabel'));
  assert.ok(html.includes('"Paused " + lab'));
  assert.ok(html.includes('id="nf-pause-now"'));
  /* one verb, through the save() helper every other control uses */
  assert.ok(html.includes('save({ pause: p })'));
});

test('the row table, the two selects and the two buttons are where they were', () => {
  const html = page();
  assert.equal((html.match(/class="nf-row"/g) || []).length, NOTIFY_ROWS.length);
  assert.equal((html.match(/data-do="test"/g) || []).length, NOTIFY_ROWS.length);
  assert.equal((html.match(/data-do="play"/g) || []).length, NOTIFY_ROWS.length);
  /* the pause buttons carry data-do too, and the click handler reads data-pause
     BEFORE it looks for a row, so a pause click never falls into the test path */
  assert.equal((html.match(/data-do="pause"/g) || []).length, 4);
  assert.ok(html.indexOf('var p = b.getAttribute("data-pause");')
    < html.indexOf('var row = b.closest(".nf-row");'));
});
