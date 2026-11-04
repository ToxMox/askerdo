/* The server-side notification channel, tested with no popup in sight: every
   case injects the platform and the relay, so the file runs identically on CI
   and on Windows, raises no real notification, and writes only to temp roots. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
  CAP, CATEGORY_KEYS, DEFAULTS, EDITOR_MAX, ENSURE_STEP_MS, ENSURE_WAIT_MS,
  RELAY_CEIL_MS, attributionOf, categoryOf, collapseAlert, createNotifier,
  createWorkNotifier, defaultCategories, defaultEditor, enrichEvents, inQuietHours,
  loadSettings, mergeCategories, mergeEditor, mergeSettings, paused, pauseLabel,
  pauseUntil, questionAlert, RELAY_MS, rowFor, saveSettings, settingsPath, SOUNDS,
  dirKey, questionWhereNames, workAlertTitle, workWhereNames,
} from '../lib/notify.mjs';
import { normDir } from '../lib/record-refs.mjs';
import { pluginRoot } from '../lib/node-helpers.mjs';
import { childEnv, tempDir } from './helpers/sandbox.mjs';

/* synthetic identity: a 32-hex shape assembled here, never a real secret */
const SECRET = 'a1b2c3d4'.repeat(4);
const PORT = 4321;
const BASE = 'http://127.0.0.1:' + PORT + '/' + SECRET + '/';

function fakeLog() {
  const lines = [];
  const fn = (line) => lines.push(line);
  fn.lines = lines;
  return fn;
}

/* An available channel on any platform: win32 injected, and a relay that records
   every alert it is handed; `pushAlert: null` is the caller with NO relay. */
function notifier(over = {}) {
  const root = over.root || tempDir('nd-notify-');
  mkdirSync(join(root, 'board'), { recursive: true });
  const log = over.log || fakeLog();
  const seen = [];
  const recording = (alert) => { seen.push(alert); return true; };
  const relay = over.pushAlert === undefined ? recording : over.pushAlert;
  const n = createNotifier({
    root,
    port: over.port === undefined ? PORT : over.port,
    secret: over.secret === undefined ? SECRET : over.secret,
    instance: 'inst01',
    platform: over.platform || 'win32',
    pushAlert: relay === null ? undefined : relay,
    /* the injected clock the quiet-hours gate reads, midday by default so a
       case that says nothing about it is never inside a window */
    now: over.now || (() => new Date(2026, 7, 21, 12, 0, 0)),
    log,
  });
  return { n, root, seen, log };
}

/* ---- settings ---------------------------------------------------------- */

/* The eight rows as they arrive out of the box, written here rather than
   imported so the case would fail if defaultCategories quietly changed one. */
const EIGHT = () => ({
  blocking: { show: true, sound: 'Default' },
  open: { show: true, sound: 'Default' },
  closed: { show: true, sound: 'Default' },
  woken: { show: true, sound: 'Default' },
  'task-completed': { show: true, sound: 'Default' },
  'task-dropped': { show: true, sound: 'Default' },
  'plan-closed': { show: true, sound: 'Default' },
  collapse: { show: true, sound: 'Default' },
});

test('settings default, merge over the defaults, and are created exactly once', () => {
  const { n, log } = notifier();
  assert.deepEqual(n.loadSettings(), { ...DEFAULTS, categories: EIGHT() },
    'an absent file reads as the defaults');
  assert.equal(existsSync(n.file), false, 'and a read never creates it');

  assert.equal(n.ensureSettings(), true);
  const first = readFileSync(n.file, 'utf8');
  assert.deepEqual(JSON.parse(first), {
    enabled: true, tray: true,
    quietFrom: '', quietTo: '',
    categories: EIGHT(),
    /* the three open keys retired and ONE editor target took their place,
       two templates and no third */
    editor: { file: 'vscode://file/{path}:{line}:{col}', folder: 'vscode://file/{path}/' },
    /* the pause is APPENDED to DEFAULTS, so it lands on disk at the first
       ensure like every other key, and a file written before it existed reads
       as no pause */
    pausedUntil: '',
  });
  assert.equal(n.ensureSettings(), false, 'never overwritten afterwards');
  assert.equal(readFileSync(n.file, 'utf8'), first, 'byte for byte');

  /* a hand edit, read on the next tick, exactly as a page write is */
  writeFileSync(n.file, JSON.stringify({ categories: { open: { show: false } } }));
  assert.equal(n.loadSettings().categories.open.show, false,
    'a file naming one field of one row stays valid');
  assert.equal(n.loadSettings().categories.blocking.sound, 'Default',
    'and everything it did not name is the default');
  assert.deepEqual(log.lines, [], 'and none of that is worth a log line');
});

/* Every row shows, with the default sound, on all eight. */
test('the eight category defaults are the ruled ones, and the map is never shared', () => {
  assert.deepEqual(CATEGORY_KEYS.slice(), ['blocking', 'open', 'closed', 'woken',
    'task-completed', 'task-dropped', 'plan-closed', 'collapse']);
  assert.deepEqual(defaultCategories(), EIGHT());
  assert.deepEqual(DEFAULTS.categories, EIGHT());
  for (const key of CATEGORY_KEYS) {
    assert.equal(DEFAULTS.categories[key].sound, 'Default', key);
    assert.equal(DEFAULTS.categories[key].show, true, key);
  }
  /* Object.freeze is SHALLOW, so a merge handing back a row out of DEFAULTS
     would let one caller silence the defaults for the life of the process */
  const a = mergeSettings({});
  const b = mergeSettings({});
  assert.notEqual(a.categories, DEFAULTS.categories);
  assert.notEqual(a.categories.blocking, DEFAULTS.categories.blocking);
  assert.notEqual(a.categories.blocking, b.categories.blocking, 'and never with each other');
  a.categories.blocking.show = false;
  assert.equal(DEFAULTS.categories.blocking.show, true, 'the defaults did not move');
  assert.equal(mergeSettings({}).categories.blocking.show, true, 'nor did the next merge');
  assert.deepEqual(defaultCategories(), EIGHT());
});

test('a wrong type falls back to that key default, and unknown keys are ignored', () => {
  assert.deepEqual(mergeSettings({}), { ...DEFAULTS, categories: EIGHT() });
  assert.deepEqual(mergeSettings(null), { ...DEFAULTS, categories: EIGHT() });
  assert.deepEqual(mergeSettings([true]), { ...DEFAULTS, categories: EIGHT() });
  assert.deepEqual(mergeSettings({ enabled: 'yes', tray: 0 }),
    { ...DEFAULTS, categories: EIGHT() });
  const merged = mergeSettings({ enabled: false, shove: 1 });
  assert.deepEqual(Object.keys(merged).sort(), ['categories', 'editor', 'enabled',
    'pausedUntil', 'quietFrom', 'quietTo', 'tray']);
  assert.equal(merged.enabled, false);
});

test('the category map takes what it recognises and drops the rest', () => {
  assert.deepEqual(mergeCategories(null), EIGHT(), 'the whole file absent');
  assert.deepEqual(mergeCategories({}), EIGHT(), 'the map absent');
  assert.deepEqual(mergeCategories({ categories: null }), EIGHT(), 'a null map');
  /* `typeof []` is 'object', which is exactly why the map needs its own branch
     rather than riding the typed loop */
  assert.deepEqual(mergeCategories({ categories: [] }), EIGHT(), 'an array map');
  assert.deepEqual(mergeCategories({ categories: { open: null } }), EIGHT(), 'a null row');
  assert.deepEqual(mergeCategories({ categories: { open: [] } }), EIGHT(), 'an array row');
  assert.deepEqual(mergeCategories({ categories: { open: {} } }), EIGHT(), 'an empty row');

  /* a field absent keeps that field's own default; a field outside its set
     falls back to the same */
  const one = mergeCategories({ categories: { woken: { show: false } } });
  assert.deepEqual(one.woken, { show: false, sound: 'Default' });
  /* the toast builds' `duration` still loads, and is dropped */
  const bad = mergeCategories({
    categories: { open: { show: 'yes', duration: 'sticky', sound: 'Fanfare' } },
  });
  assert.deepEqual(bad.open, { show: true, sound: 'Default' });
  /* the set is CASE-SENSITIVE and closed: one table and no invented vocabulary */
  assert.equal(mergeCategories({ categories: { open: { sound: 'mail' } } }).open.sound, 'Default');
  assert.equal(mergeCategories({ categories: { open: { sound: 'Mail' } } }).open.sound, 'Mail');
  assert.equal(mergeCategories({ categories: { open: { sound: 'silent' } } }).open.sound, 'silent');

  /* an unknown category key is DROPPED, not carried */
  const alien = mergeCategories({ categories: { 'ws-closed': { show: false }, nope: {} } });
  assert.deepEqual(Object.keys(alien), CATEGORY_KEYS.slice());
  assert.deepEqual(alien, EIGHT(), 'and it changed nothing on the way past');
});

/* THE SUPERSESSION: the three booleans the map replaced still mean what
   they meant, once, on read, for a file written before the map existed. */
test('the three legacy booleans seed the map once, and a map beside them wins', () => {
  /* `woken: false` gated every OPEN event, blocking ones included */
  const woken = mergeCategories({ woken: false });
  assert.equal(woken.open.show, false);
  assert.equal(woken.blocking.show, false);
  assert.equal(woken.woken.show, false);
  assert.equal(woken.closed.show, true, 'and nothing else');
  assert.equal(woken['task-completed'].show, true);

  const closed = mergeCategories({ closed: false });
  assert.equal(closed.closed.show, false);
  assert.equal(closed.open.show, true);

  const quiet = mergeCategories({ sound: false });
  for (const key of CATEGORY_KEYS) assert.equal(quiet[key].sound, 'silent', key);
  for (const key of CATEGORY_KEYS) assert.equal(quiet[key].show, true, key);

  const all = mergeCategories({ enabled: true, woken: false, closed: false, sound: false, tray: true });
  assert.equal(all.blocking.show, false);
  assert.equal(all.closed.show, false);
  assert.equal(all.collapse.sound, 'silent');

  /* `true` is the default and seeds nothing; a value of the wrong type is not
     a false either */
  assert.deepEqual(mergeCategories({ woken: true, closed: true, sound: true }), EIGHT());
  assert.deepEqual(mergeCategories({ woken: 'no', sound: 0 }), EIGHT());

  /* TWO GATES FOR ONE BEHAVIOUR IS A PAGE THAT CAN LIE, so where a map exists
     it is the whole truth and the booleans are ignored */
  const both = mergeCategories({ woken: false, sound: false, categories: { open: { show: true } } });
  assert.equal(both.open.show, true);
  assert.equal(both.blocking.show, true, 'the boolean beside the map says nothing');
  assert.equal(both.collapse.sound, 'Default');
});

/* THE QUIET HOURS, against an injected clock and never against the real one. */
test('the quiet-hours window gates on a clock, wraps midnight, and is off when it is empty', () => {
  const at = (h, m) => new Date(2026, 0, 15, h, m, 0);
  /* a plain window inside one day */
  assert.equal(inQuietHours(at(13, 0), '12:00', '14:00'), true);
  assert.equal(inQuietHours(at(12, 0), '12:00', '14:00'), true, 'the start is inside');
  assert.equal(inQuietHours(at(14, 0), '12:00', '14:00'), false, 'the end is outside');
  assert.equal(inQuietHours(at(11, 59), '12:00', '14:00'), false);
  /* and one that WRAPS MIDNIGHT: 22:00 to 07:00 is the night, not the day */
  assert.equal(inQuietHours(at(23, 30), '22:00', '07:00'), true);
  assert.equal(inQuietHours(at(3, 0), '22:00', '07:00'), true);
  assert.equal(inQuietHours(at(7, 0), '22:00', '07:00'), false);
  assert.equal(inQuietHours(at(12, 0), '22:00', '07:00'), false);
  /* EQUAL ENDS ARE OFF rather than always-on: a person who set both to the
     same minute meant nothing, and an always-on window looks like a break */
  assert.equal(inQuietHours(at(9, 0), '09:00', '09:00'), false);
  /* empty is off, and so is anything that is not a time */
  assert.equal(inQuietHours(at(9, 0), '', ''), false);
  assert.equal(inQuietHours(at(9, 0), '22:00', ''), false);
  assert.equal(inQuietHours(at(9, 0), 'half past nine', '10:00'), false);
  assert.equal(inQuietHours(at(9, 0), '24:00', '25:00'), false);
  assert.equal(inQuietHours(at(9, 0), '9:00', '10:00'), false, 'HH:MM and nothing looser');
  assert.equal(inQuietHours(at(9, 0), null, undefined), false);
});

/* The merge is TYPED against each key's own default, per key: a value of the
   key's own type survives, anything else falls back, and unknown keys drop. */
test('the typed merge keeps strings and booleans honest in the same file', () => {
  const open = mergeSettings({ quietFrom: '22:00', quietTo: '07:00' });
  assert.equal(open.quietFrom, '22:00');
  assert.equal(open.quietTo, '07:00');
  assert.equal(open.enabled, true, 'and the booleans are untouched by any of it');

  /* each key refuses the other kind's value: a boolean handed to a string key
     and a string handed to a boolean key are the same fallback */
  const crossed = mergeSettings({ enabled: 'quiet', tray: 'yes', quietFrom: 4, quietTo: null });
  assert.deepEqual(crossed, { ...DEFAULTS, categories: EIGHT(), editor: defaultEditor() });
  /* an empty string is a REAL value for a string key, not a fallback: it is how
     the quiet hours stay switched off */
  assert.equal(mergeSettings({ quietFrom: '' }).quietFrom, '');

  /* the file an older install carries: five booleans, three of which are gone from
     DEFAULTS and seed the map instead, and nothing to migrate */
  const legacy = mergeSettings({
    enabled: true, woken: false, closed: true, sound: false, tray: true,
  });
  assert.equal(legacy.woken, undefined, 'the three booleans left DEFAULTS');
  assert.equal(legacy.closed, undefined);
  assert.equal(legacy.sound, undefined);
  assert.equal(legacy.categories.blocking.show, false, 'and they seeded the map');
  assert.equal(legacy.categories.open.sound, 'silent');
  assert.equal(legacy.quietFrom, '');
  assert.equal(legacy.quietTo, '');
});

/* the three open keys retired and ONE editor target replaced
   them. NOTHING MIGRATES: the old key named a program the SERVER ran and the new
   one names a program the EXE runs, and a silent promotion is the hazard. */
test('the three retired open keys are gone from DEFAULTS and ignored on read', () => {
  for (const key of ['openPreset', 'openScheme', 'openCommand']) {
    assert.equal(Object.prototype.hasOwnProperty.call(DEFAULTS, key), false, key);
  }
  const carried = mergeSettings({
    openPreset: 'reveal',
    openScheme: 'editor://open?f={path}&l={line}',
    openCommand: '"X:/synthetic/apps/editor.exe" {path}',
  });
  assert.equal(carried.openPreset, undefined);
  assert.equal(carried.openScheme, undefined);
  assert.equal(carried.openCommand, undefined);
  assert.deepEqual(carried.editor, defaultEditor(), 'and nothing was promoted into editor');
  /* a file carrying BOTH the old keys and the new one keeps only the new */
  const both = mergeSettings({
    openCommand: 'old {path}',
    editor: { file: 'new {path}', folder: 'newdir {path}' },
  });
  assert.deepEqual(both.editor, { file: 'new {path}', folder: 'newdir {path}' });
  assert.equal(both.openCommand, undefined);
});

/* The two templates, each typed on its own, and the map given the categories'
   own treatment: a fresh object every call, so the frozen defaults cannot move. */
test('the editor target merges per template and never shares the defaults', () => {
  assert.deepEqual(defaultEditor(),
    { file: 'vscode://file/{path}:{line}:{col}', folder: 'vscode://file/{path}/' });
  assert.deepEqual(DEFAULTS.editor, defaultEditor());
  /* the whole key absent, null, an array or the wrong type is the whole default */
  assert.deepEqual(mergeEditor(null), defaultEditor(), 'the whole file absent');
  assert.deepEqual(mergeEditor({}), defaultEditor(), 'the key absent');
  assert.deepEqual(mergeEditor({ editor: null }), defaultEditor(), 'a null map');
  assert.deepEqual(mergeEditor({ editor: [] }), defaultEditor(), 'an array map');
  assert.deepEqual(mergeEditor({ editor: 'vscode://file/{path}' }), defaultEditor(), 'a string');
  /* each template independently: one named leaves the other at its default */
  assert.deepEqual(mergeEditor({ editor: { file: 'code {path}' } }),
    { file: 'code {path}', folder: 'vscode://file/{path}/' });
  assert.deepEqual(mergeEditor({ editor: { folder: '' } }),
    { file: 'vscode://file/{path}:{line}:{col}', folder: '' },
    'an empty template is a real value: it is how the project entry is switched off');
  assert.deepEqual(mergeEditor({ editor: { file: 4, folder: null } }), defaultEditor());
  assert.deepEqual(mergeEditor({ editor: { file: 'x', mine: 'y' } }),
    { file: 'x', folder: 'vscode://file/{path}/' }, 'an unknown field inside it is ignored');
  /* the bound, so a pathological template cannot ride every open frame */
  assert.equal(EDITOR_MAX, 2048);
  assert.equal(mergeEditor({ editor: { file: 'x'.repeat(EDITOR_MAX) } }).file.length, EDITOR_MAX);
  assert.equal(mergeEditor({ editor: { file: 'x'.repeat(EDITOR_MAX + 1) } }).file,
    defaultEditor().file);

  /* THE FROZEN-DEFAULT HAZARD, the one frozenCategories exists for: Object.freeze
     is shallow, so a merge handing back the DEFAULTS object would let one caller
     move the defaults for the life of the process */
  const a = mergeSettings({});
  const b = mergeSettings({});
  assert.notEqual(a.editor, DEFAULTS.editor);
  assert.notEqual(a.editor, b.editor);
  a.editor.file = 'moved';
  assert.equal(DEFAULTS.editor.file, 'vscode://file/{path}:{line}:{col}');
  assert.equal(mergeSettings({}).editor.file, 'vscode://file/{path}:{line}:{col}');
});

/* The board server's open route and its viewer page need the editor key on
   every platform, while createNotifier exists only where the channel does. */
test('loadSettings reads the notify file for a caller that is not the channel', () => {
  const root = tempDir('nd-open-');
  mkdirSync(join(root, 'board'), { recursive: true });
  assert.deepEqual(loadSettings(root), { ...DEFAULTS, categories: EIGHT(), editor: defaultEditor() },
    'an absent file is the defaults');
  writeFileSync(settingsPath(root), JSON.stringify({
    editor: { file: 'x {path}' }, categories: { open: { sound: 'silent' } },
  }));
  assert.equal(loadSettings(root).editor.file, 'x {path}');
  assert.equal(loadSettings(root).editor.folder, 'vscode://file/{path}/');
  assert.equal(loadSettings(root).categories.open.sound, 'silent');
  /* malformed is the defaults and is SILENT here: a per-request reader that
     logged would write a line per click on a store nobody has fixed yet */
  writeFileSync(settingsPath(root), 'not json at all\n');
  assert.deepEqual(loadSettings(root), { ...DEFAULTS, categories: EIGHT() });
  let said = 0;
  loadSettings(root, () => { said++; });
  assert.equal(said, 1, 'a caller that wants to hear about it still can');
});

test('a malformed settings file falls back to the defaults and logs ONCE', () => {
  const { n, log } = notifier();
  writeFileSync(n.file, 'not json at all\n');
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(n.loadSettings(), { ...DEFAULTS, categories: EIGHT() });
  }
  assert.deepEqual(log.lines, ['notify: settings file is malformed; using defaults'],
    'a file that stays broken must not write a line every five seconds');
});

/* THE ROW AN EVENT IS UNDER, for both halves and in one function. */
test('categoryOf places every event shape, and blocking beats woken', () => {
  assert.equal(categoryOf({ kind: 'open', blocking: false }), 'open');
  assert.equal(categoryOf({ kind: 'open', blocking: true }), 'blocking');
  assert.equal(categoryOf({ kind: 'open', blocking: false, woken: true }), 'woken');
  /* a blocking question coming back off a snooze blocks work exactly as a new
     one does, and the blocking row is the one that decides stickiness */
  assert.equal(categoryOf({ kind: 'open', blocking: true, woken: true }), 'blocking');
  assert.equal(categoryOf({ kind: 'closed', status: 'answered' }), 'closed');
  assert.equal(categoryOf({ kind: 'closed', status: 'dropped', blocking: true }), 'closed');
  assert.equal(categoryOf({ kind: 'collapse' }), 'collapse');
  /* the work half keys on the ENDING first, so a plan and a workstream closing
     land on the ONE row both endings mean */
  assert.equal(categoryOf({ id: 'T-1', ending: 'completed' }), 'task-completed');
  assert.equal(categoryOf({ id: 'T-1', ending: 'dropped' }), 'task-dropped');
  assert.equal(categoryOf({ id: 'P-1', ending: 'closed' }), 'plan-closed');
  assert.equal(categoryOf({ id: 'WS-1', ending: 'closed' }), 'plan-closed');
  /* an event nothing can place is ungated rather than silently dropped */
  assert.equal(categoryOf({}), '');
  assert.equal(categoryOf(null), '');
  assert.equal(rowFor(DEFAULTS, '').show, true);
  assert.equal(rowFor(DEFAULTS, 'nope').sound, 'Default', 'a row that is not there is the default');
  /* the DEFAULTS rows are frozen row by row, so the one reader that does read
     straight out of them cannot move them */
  assert.ok(Object.isFrozen(DEFAULTS.categories.blocking));
  assert.ok(Object.isFrozen(DEFAULTS.categories));
});

/* ---- the alert --------------------------------------------------------- */

/* the TITLE IS THE NAME ALONE; the id, `blocks work` and `a
   preference` ride the where line. */
test('the question card leads with the name and maps the event to its kind', () => {
  const a = questionAlert({ kind: 'open', id: 'Q7', name: 'store shape', blocking: true }, 'Mail');
  assert.equal(a.kind, 'blocker');
  assert.equal(a.title, 'store shape');
  assert.equal(a.card, 'Q7');
  assert.equal(a.where, 'Q7, blocks work');
  assert.equal(a.blocking, true);
  assert.equal(a.sound, 'Mail');
  assert.equal(questionAlert({ kind: 'open', id: 'Q7', name: 'x', blocking: false }).kind, 'question');
  assert.equal(questionAlert({ kind: 'closed', id: 'Q7', name: 'x', status: 'answered' }).kind, 'answer');
  assert.equal(questionAlert({ kind: 'closed', id: 'Q7', name: 'x', status: 'dropped' }).kind, 'dropped');
  assert.equal(questionAlert({ kind: 'open', id: 'Q7', name: '  ', blocking: false }).title, 'Q7',
    'a question with no name is named by its id');
});

/* THE ATTRIBUTION'S OWN WORDS, in one place because the Test button raises them too. */
test('attributionOf says the id, the state and the workstream, and the collapse has none', () => {
  const q = { kind: 'open', id: 'Q107', name: 'x' };
  assert.equal(attributionOf({ ...q, blocking: true }), 'Q107, blocks work');
  assert.equal(attributionOf({ ...q, blocking: false }), 'Q107, a preference',
    'the reassurance past the semicolon lives in the body room now');
  assert.equal(attributionOf({ ...q, blocking: false, woken: true, wokeBy: 'T-1 completed' }),
    'Q107, a preference', 'a linked wake changes the body, never this line');
  assert.equal(attributionOf({ kind: 'closed', id: 'Q107', status: 'answered' }),
    'Q107, closed as answered');
  assert.equal(attributionOf({ kind: 'closed', id: 'Q107', status: 'dropped' }),
    'Q107, closed as dropped', 'the landed vocabulary, not a form that only spells answered');

  /* the work endings, in the same three-part shape */
  assert.equal(attributionOf({ id: 'T-42', ending: 'completed' }), 'T-42, completed');
  assert.equal(attributionOf({ id: 'T-42', ending: 'dropped' }), 'T-42, dropped');
  assert.equal(attributionOf({ id: 'P-9', ending: 'closed' }), 'P-9, closed');
  assert.equal(attributionOf({ id: 'T-42', ending: 'exploded' }), 'T-42',
    'an ending outside the set adds no word it cannot vouch for');

  /* the workstream clause: the token and its name, the token alone where the
     work snapshot resolved no name, and nothing at all where there is none */
  assert.equal(attributionOf({ ...q, blocking: true, workstream: 'WS-4', workstreamName: 'AskerDo' }),
    'Q107, blocks work, WS-4 AskerDo');
  assert.equal(attributionOf({ ...q, blocking: true, workstream: 'WS-4' }),
    'Q107, blocks work, WS-4', 'a work store that would not read costs the clause its name');
  assert.equal(attributionOf({ id: 'T-42', ending: 'completed', workstream: 'WS-4' }),
    'T-42, completed, WS-4');

  /* THE COLLAPSE SUMMARY NAMES NO RECORD, so it gets no line: an attribution
     with nothing to attribute is a blank row under the text */
  assert.equal(attributionOf({ kind: 'collapse', more: 3 }), '');
  assert.equal(attributionOf({ more: 3 }), '');
  assert.equal(attributionOf(null), '');
  assert.equal(attributionOf(undefined), '');

});

/* THE ENRICHMENT, pure: the snapshot the tick already holds reaches the event,
   and the digest never grows a field for it. */
test('enrichEvents carries the gist and the workstream onto a fresh list', () => {
  const events = Object.freeze([
    Object.freeze({ kind: 'open', id: 'Q1', name: 'one', blocking: true }),
    Object.freeze({ kind: 'open', id: 'Q2', name: 'two', blocking: false }),
    Object.freeze({ kind: 'closed', id: 'Q9', name: 'gone', status: 'answered' }),
  ]);
  const entries = [
    { id: 'Q1', name: 'one', gist: 'first\nsecond', workstream: 'WS-4' },
    { id: 'Q2', name: 'two', workstream: 'WS-7' },
  ];
  const names = { 'WS-4': 'AskerDo' };
  const out = enrichEvents(events, entries, names);

  assert.equal(out[0].gist, 'first\nsecond');
  assert.equal(out[0].workstream, 'WS-4');
  assert.equal(out[0].workstreamName, 'AskerDo');
  /* an entry with no gist adds none, and a token the map could not resolve
     carries the token alone */
  assert.equal('gist' in out[1], false);
  assert.equal(out[1].workstream, 'WS-7');
  assert.equal('workstreamName' in out[1], false);
  /* an id no entry names is simply nothing added */
  assert.deepEqual(out[2], { kind: 'closed', id: 'Q9', name: 'gone', status: 'answered' });

  /* PURE, and the input is not mutated: the events were frozen above, so a
     write would have thrown in a module and failed silently in a script */
  assert.equal('gist' in events[0], false);
  assert.ok(out[0] !== events[0], 'a fresh object per event');

  /* a null map, an absent entry list and an empty event list are all answers
     rather than failures */
  assert.equal(enrichEvents(events, entries, null)[0].workstreamName, undefined);
  assert.equal(enrichEvents(events, entries, null)[0].workstream, 'WS-4');
  assert.deepEqual(enrichEvents(events, null, null)[0], events[0]);
  assert.deepEqual(enrichEvents(null, entries, names), []);
  assert.deepEqual(enrichEvents([], entries, names), []);
  /* a Map is a map too, since the caller builds whichever is to hand */
  assert.equal(enrichEvents(events, entries, new Map([['WS-4', 'named']]))[0].workstreamName,
    'named');
});

/* THE NO-SHELL CLAIM, said where it can fail: no shell, no encoded command and no
   registry write is left in the channel. The scan is over CODE with comments
   stripped, because the module names the retired path in its header on purpose. */
test('the channel names no shell, encodes no command, and writes no registry key', () => {
  const src = readFileSync(join(pluginRoot, 'lib', 'notify.mjs'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(code.includes('createNotifier'), 'the comment strip left the code behind');
  for (const needle of ['powershell', 'pwsh', 'EncodedCommand', 'AUMID', 'HKCU', 'HKEY',
    'reg add', 'reg delete', 'New-ItemProperty', 'Set-ItemProperty', 'spawn']) {
    assert.ok(!new RegExp(needle, 'i').test(code), 'the module still names ' + needle);
  }
  /* and the module exports no old path, so an importer that wanted one fails to
     resolve rather than quietly doing nothing */
  return import('../lib/notify.mjs').then((m) => {
    for (const gone of ['toastScript', 'spawnToast', 'encodedCommand', 'powershellPath',
      'TOAST_HOLD_MS', 'TRAY_AUMID', 'TRAY_AUMID_PATH']) {
      assert.equal(m[gone], undefined, 'lib/notify.mjs still exports ' + gone);
    }
  });
});

/* The relay seam can throw outright, and an alert is never worth taking a board
   server down for: show() swallows it, says so once, and the tick carries on. */
test('a relay that throws escapes nothing', async () => {
  const boom = () => { throw new Error('socket gone'); };
  const { n, log } = notifier({ pushAlert: boom });
  await assert.doesNotReject(() => n.raise(
    [{ kind: 'open', id: 'Q7', name: 'store shape', blocking: false }], DEFAULTS));
  /* the event was still processed and logged; only the alert was lost */
  assert.ok(log.lines.includes('notify: open Q7'));
  assert.ok(log.lines.some((l) => l.includes('notify: the tray relay failed')), log.lines.join('|'));
  for (const line of log.lines) assert.ok(!line.includes(SECRET), line);
});

test('the card is the record id, and a malformed id never reaches it', async () => {
  const { n, seen, log } = notifier();
  await n.raise([
    { kind: 'open', id: 'Q7', name: 'store shape', blocking: false },
    { kind: 'open', id: 'Q7/../board/secret', name: 'traversal', blocking: false },
    { kind: 'open', id: '', name: 'empty', blocking: false },
    { kind: 'closed', id: 'q7', name: 'lowercase', status: 'answered' },
  ], DEFAULTS);
  assert.equal(seen.length, 1, 'only the well-formed id raised anything');
  assert.equal(seen[0].card, 'Q7');
  assert.ok(log.lines.includes('notify: dropped an event whose id was not well formed'));
  /* logging carries the kind and the id, never the URL or the secret */
  assert.ok(log.lines.includes('notify: open Q7'));
  for (const line of log.lines) assert.ok(!line.includes(SECRET), line);
});

test('one tick raises at most five alerts and collapses the rest into one', async () => {
  const { n, seen } = notifier();
  const events = [];
  for (let i = 1; i <= 7; i++) {
    events.push({ kind: 'open', id: 'Q' + i, name: 'shape ' + i, blocking: false });
  }
  const raised = await n.raise(events, DEFAULTS);
  assert.equal(seen.length, CAP, 'a store that changed seven times does not stack seven cards');
  assert.equal(raised, CAP);
  const last = seen[CAP - 1];
  assert.equal(last.kind, 'info');
  assert.match(last.title, /^3 more/, 'nothing is dropped silently');
  assert.equal(last.card, undefined, 'and the summary names no record: it opens the board');

  /* exactly at the cap, every event still gets its own card */
  const two = notifier();
  assert.equal(await two.n.raise(events.slice(0, CAP), DEFAULTS), CAP);
  assert.equal(two.seen.length, CAP);
  for (const a of two.seen) assert.notEqual(a.kind, 'info');
});

/* THE SHOW FILTER RUNS FIRST: a hidden category must not eat one of the five,
   or switching a row off would cost the rows beside it their cards. */
test('a hidden category never eats a slot of the five', async () => {
  const events = [];
  for (let i = 1; i <= 7; i++) {
    events.push({ kind: 'open', id: 'Q' + i, name: 'shape ' + i, blocking: i <= 2 });
  }
  /* seven events, two of them blocking: with the blocking row off, five remain
     and every one of them fits, so there is no summary at all */
  const { n, seen } = notifier();
  assert.equal(await n.raise(events, withRow('blocking', { show: false })), CAP);
  assert.equal(seen.length, CAP);
  assert.deepEqual(seen.map((a) => a.card), ['Q3', 'Q4', 'Q5', 'Q6', 'Q7']);

  /* and with the filter off, the same seven are four cards and a summary of
     three: the arithmetic is the cap's own, over what survived the filter */
  const all = notifier();
  assert.equal(await all.n.raise(events, DEFAULTS), CAP);
  assert.match(all.seen[CAP - 1].title, /^3 more/);
});

test('the collapse row hides the summary while the four that fit still stand', async () => {
  const events = [];
  for (let i = 1; i <= 9; i++) {
    events.push({ kind: 'open', id: 'Q' + i, name: 'shape ' + i, blocking: false });
  }
  const { n, seen } = notifier();
  /* four cards and no fifth: the summary is the one that went */
  assert.equal(await n.raise(events, withRow('collapse', { show: false })), CAP - 1);
  assert.equal(seen.length, CAP - 1);
  for (const a of seen) assert.notEqual(a.kind, 'info');

  /* the number in its words is the same arithmetic it always was, and the row
     carries its own sound into it like any other */
  const loud = notifier();
  assert.equal(await loud.n.raise(events, withRow('collapse', { sound: 'Reminder' })), CAP);
  const summary = loud.seen[CAP - 1];
  assert.match(summary.title, /^5 more/);
  assert.equal(summary.sound, 'Reminder');
});

/* ---- the gate order --------------------------------------------- */

/* A settings object with one row changed and everything else at its default. */
function withRow(key, over) {
  const categories = defaultCategories();
  categories[key] = { ...categories[key], ...over };
  return { ...DEFAULTS, categories };
}

test('a row silences its own category and no other, before the alert is built', async () => {
  const events = [
    { kind: 'open', id: 'Q1', name: 'a', blocking: true },
    { kind: 'open', id: 'Q2', name: 'b', blocking: false },
    { kind: 'open', id: 'Q3', name: 'c', blocking: false, woken: true },
    { kind: 'closed', id: 'Q4', name: 'd', status: 'answered' },
  ];
  const seenIds = async (settings) => {
    const { n, seen } = notifier();
    await n.raise(events, settings);
    return seen.map((a) => a.card);
  };
  assert.deepEqual(await seenIds(DEFAULTS), ['Q1', 'Q2', 'Q3', 'Q4']);
  assert.deepEqual(await seenIds(withRow('blocking', { show: false })), ['Q2', 'Q3', 'Q4']);
  assert.deepEqual(await seenIds(withRow('open', { show: false })), ['Q1', 'Q3', 'Q4']);
  assert.deepEqual(await seenIds(withRow('woken', { show: false })), ['Q1', 'Q2', 'Q4']);
  assert.deepEqual(await seenIds(withRow('closed', { show: false })), ['Q1', 'Q2', 'Q3']);
  /* a hidden category is not a raised alert either: the count answers what was
     offered, and nothing was */
  const off = notifier();
  assert.equal(await off.n.raise([events[0]], withRow('blocking', { show: false })), 0);
  assert.equal(off.seen.length, 0);
});

test('a row carries its own sound onto the alert', async () => {
  const { n, seen } = notifier();
  await n.raise([{ kind: 'open', id: 'Q7', name: 'store shape', blocking: true }], DEFAULTS);
  assert.equal(seen[0].sound, 'Default');
  const quiet = notifier();
  await quiet.n.raise([{ kind: 'open', id: 'Q7', name: 'store shape', blocking: false }],
    withRow('open', { sound: 'silent' }));
  assert.equal(quiet.seen[0].sound, 'silent');
});

test('the quiet-hours window stops the question half before an alert is built', async () => {
  const at = (h) => notifier({ now: () => new Date(2026, 0, 15, h, 0, 0) });
  const night = { ...DEFAULTS, quietFrom: '22:00', quietTo: '07:00' };
  const inside = at(23);
  assert.equal(await inside.n.raise([{ kind: 'open', id: 'Q7', name: 'x', blocking: true }], night), 0);
  assert.equal(inside.seen.length, 0, 'nothing was built, let alone offered');
  assert.deepEqual(inside.log.lines, [], 'and a quiet hour is not a diagnosis');

  const outside = at(12);
  assert.equal(await outside.n.raise([{ kind: 'open', id: 'Q7', name: 'x', blocking: true }], night), 1);
  assert.equal(outside.seen.length, 1);

  /* it applies to EVERY category, the blocking one included */
  const burst = at(23);
  const many = [];
  for (let i = 1; i <= 7; i++) many.push({ kind: 'open', id: 'Q' + i, name: 'x', blocking: i === 1 });
  assert.equal(await burst.n.raise(many, night), 0);
  assert.equal(burst.seen.length, 0, 'not even the collapse summary');
});

/* ---- the settings write ----------------------------------------- */

test('a page write patches the file, materialises the map, and drops the three booleans', () => {
  const root = tempDir('nd-notify-');
  mkdirSync(join(root, 'board'), { recursive: true });
  const file = settingsPath(root);
  const read = () => JSON.parse(readFileSync(file, 'utf8'));

  /* an ABSENT file is the defaults plus the patch, and the file it writes is
     WHOLE: a person opening it by hand sees every switch there is */
  const first = saveSettings(root, { enabled: false });
  assert.equal(first.enabled, false);
  assert.deepEqual(Object.keys(read()).sort(), ['categories', 'editor', 'enabled',
    'pausedUntil', 'quietFrom', 'quietTo', 'tray']);
  assert.deepEqual(read().categories, EIGHT());
  assert.deepEqual(read().editor, defaultEditor(), 'and the object lands whole, not by reference');

  /* ONE VALUE AT A TIME, and everything beside it stands */
  saveSettings(root, { categories: { blocking: { sound: 'Mail' } } });
  assert.equal(read().categories.blocking.sound, 'Mail');
  assert.equal(read().categories.blocking.show, true, 'the row keeps its other fields');
  assert.equal(read().categories.open.sound, 'Default', 'and the rows beside it are untouched');
  assert.equal(read().enabled, false, 'as is the write before this one');

  saveSettings(root, { quietFrom: '22:00' });
  saveSettings(root, { quietTo: '07:00' });
  assert.equal(read().quietFrom, '22:00');
  assert.equal(read().quietTo, '07:00');
  assert.equal(read().categories.blocking.sound, 'Mail');
});

/* `editor` is a WRITABLE key, so it has to join the explicit list, and it
   takes the categories' own nested branch rather than a flat push. Without both
   the Openers page saves nothing and looks like it saved. */
test('a page write moves the editor templates, one at a time', () => {
  const root = tempDir('nd-notify-');
  mkdirSync(join(root, 'board'), { recursive: true });
  const file = settingsPath(root);
  const read = () => JSON.parse(readFileSync(file, 'utf8'));

  const back = saveSettings(root, { editor: { file: 'code -g {path}:{line}:{col}' } });
  assert.equal(read().editor.file, 'code -g {path}:{line}:{col}', 'the value actually moved');
  assert.equal(read().editor.folder, 'vscode://file/{path}/', 'and the other template stands');
  assert.equal(back.editor.file, 'code -g {path}:{line}:{col}', 'and the answer says so');

  saveSettings(root, { editor: { folder: '' } });
  assert.equal(read().editor.folder, '', 'an empty template is a real value');
  assert.equal(read().editor.file, 'code -g {path}:{line}:{col}', 'the first write stands');

  saveSettings(root, { enabled: false });
  assert.equal(read().editor.file, 'code -g {path}:{line}:{col}',
    'and a write to another key does not reset it');
});

/* the redline: the three old keys DROP on the next write, in the
   idiom the three superseded booleans already use, and nothing is promoted. */
test('a page write drops the three retired open keys and migrates nothing', () => {
  const root = tempDir('nd-notify-');
  mkdirSync(join(root, 'board'), { recursive: true });
  const file = settingsPath(root);
  const read = () => JSON.parse(readFileSync(file, 'utf8'));

  writeFileSync(file, JSON.stringify({
    enabled: true,
    openPreset: 'command',
    openScheme: 'editor://open?f={path}',
    openCommand: '"X:/synthetic/apps/e.exe" {path}',
  }, null, 2) + '\n');
  saveSettings(root, { tray: false });
  const disk = read();
  assert.equal(disk.openPreset, undefined);
  assert.equal(disk.openScheme, undefined);
  assert.equal(disk.openCommand, undefined);
  assert.deepEqual(disk.editor, defaultEditor(),
    'a hand-written openCommand is NOT migrated into editor');
});

test('a page write leaves a hand-added key standing, and a malformed file is one line', () => {
  const root = tempDir('nd-notify-');
  mkdirSync(join(root, 'board'), { recursive: true });
  const file = settingsPath(root);
  const read = () => JSON.parse(readFileSync(file, 'utf8'));

  /* the patch lands over the FILE's own parsed contents, so a key a person
     hand-added survives a page write */
  writeFileSync(file, JSON.stringify({
    enabled: true, tray: true, mine: 'do not eat this',
  }, null, 2) + '\n');
  saveSettings(root, { enabled: false });
  assert.equal(read().mine, 'do not eat this');
  assert.equal(read().enabled, false);

  /* THE SUPERSESSION LANDS ON THE FIRST WRITE: the three booleans seed the map
     and then go, so after this there is exactly one place a show can be read */
  writeFileSync(file, JSON.stringify({ enabled: true, woken: false, sound: false }) + '\n');
  const after = saveSettings(root, { categories: { closed: { show: false } } });
  const disk = read();
  assert.equal(disk.woken, undefined, 'the boolean is gone from the file');
  assert.equal(disk.closed, undefined);
  assert.equal(disk.sound, undefined);
  assert.equal(disk.categories.blocking.show, false, 'and its meaning is in the map');
  assert.equal(disk.categories.open.sound, 'silent');
  assert.equal(disk.categories.closed.show, false, 'with the patch over it');
  assert.deepEqual(after.categories, disk.categories, 'and the answer is what was written');

  /* a malformed file is replaced by the defaults plus the patch, with ONE line
     for the caller to log */
  writeFileSync(file, 'not json at all\n');
  const said = [];
  const back = saveSettings(root, { tray: false }, () => said.push('malformed'));
  assert.deepEqual(said, ['malformed']);
  assert.equal(read().tray, false);
  assert.deepEqual(read().categories, EIGHT());
  assert.equal(back.enabled, true, 'the defaults under the patch');
  /* an absent file is not malformed and says nothing */
  const clean = tempDir('nd-notify-');
  mkdirSync(join(clean, 'board'), { recursive: true });
  const quiet = [];
  saveSettings(clean, { enabled: true }, () => quiet.push('malformed'));
  assert.deepEqual(quiet, []);
});

/* ---- feature detection ------------------------------------------------- */

test('a platform without the channel is inert, and says so exactly once', async () => {
  const { n, seen, log } = notifier({ platform: 'linux' });
  assert.equal(n.available, false);
  assert.equal(n.ensureSettings(), false, 'no settings file is created');
  assert.equal(existsSync(n.file), false);
  assert.equal(await n.raise([{ kind: 'open', id: 'Q7', name: 'store shape', blocking: false }], DEFAULTS), 0);
  assert.equal(seen.length, 0, 'nothing is ever offered off Windows');
  assert.deepEqual(log.lines, ['notify: unavailable on this platform']);
  /* and on Windows with NO relay handed in, the channel is available and every
     alert is dropped with a line: there is nothing behind the tray */
  const alone = notifier({ pushAlert: null });
  assert.equal(alone.n.available, true);
  assert.equal(await alone.n.raise([{ kind: 'open', id: 'Q7', name: 'x', blocking: false }], DEFAULTS), 1);
  assert.ok(alone.log.lines.includes('notify: no tray channel: the alert was dropped'),
    alone.log.lines.join('|'));
});

test('an empty event list raises nothing at all', async () => {
  const { n, seen, log } = notifier();
  assert.equal(await n.raise([], DEFAULTS), 0);
  assert.equal(await n.raise(undefined, DEFAULTS), 0);
  assert.equal(seen.length, 0);
  assert.deepEqual(log.lines, []);
});

test('the settings file lives beside the board identity', () => {
  assert.equal(settingsPath('/store'), join('/store', 'board', 'notify.json'));
});

/* ---- the relay, and the one path behind it ----------------------------- */

const OPEN_Q7 = { kind: 'open', id: 'Q7', name: 'store shape', blocking: false };

test('an attached tray takes the alert, and an alert no tray takes is logged and dropped', async () => {
  const relayed = notifier();
  assert.equal(await relayed.n.raise([OPEN_Q7], DEFAULTS), 1);
  assert.equal(relayed.seen.length, 1);
  assert.equal(relayed.seen[0].card, 'Q7');
  assert.ok(!relayed.log.lines.some((l) => l.includes('dropped')), relayed.log.lines.join('|'));

  /* false is no tray attached and none that could be started: the alert is
     LOST, and the log is the only place that can say so */
  const none = notifier({ pushAlert: () => false });
  assert.equal(await none.n.raise([OPEN_Q7], DEFAULTS), 1);
  assert.ok(none.log.lines.includes('notify: no tray took the alert: it was dropped'),
    none.log.lines.join('|'));
  assert.ok(none.log.lines.includes('notify: open Q7'), 'and the event is still recorded');
  for (const line of none.log.lines) assert.ok(!line.includes(SECRET), line);

  /* ONE LINE PER DROPPED ALERT: the refusal carries whether
     the SERVER already logged it, so a person who chose Exit is named once. */
  const quiet = notifier({
    pushAlert: () => ({ reason: 'the tray was exited by the person', logged: true }),
  });
  assert.equal(await quiet.n.raise([OPEN_Q7], DEFAULTS), 1);
  assert.ok(!quiet.log.lines.some((l) => l.includes('no tray took the alert')),
    quiet.log.lines.join('|'));
  assert.ok(quiet.log.lines.includes('notify: open Q7'), 'and the event is still recorded');
  /* a refusal the server did NOT log is this half's line to write */
  const said = notifier({ pushAlert: () => ({ reason: 'no tray attached' }) });
  assert.equal(await said.n.raise([OPEN_Q7], DEFAULTS), 1);
  assert.ok(said.log.lines.includes('notify: no tray took the alert: it was dropped'),
    said.log.lines.join('|'));
});

/* THE RELAY IS AWAITED: it starts the tray exe on demand, so five
   alerts arriving at once must not become five demands for one exe. */
test('the alerts of one tick go out in order, one at a time', async () => {
  const seen = [];
  let inFlight = 0;
  const slow = (alert) => new Promise((resolve) => {
    inFlight += 1;
    assert.equal(inFlight, 1, 'two alerts were in the relay at once');
    setTimeout(() => {
      seen.push(alert);
      inFlight -= 1;
      resolve(true);
    }, 1);
  });
  const { n } = notifier({ pushAlert: slow });
  const events = [];
  for (let i = 1; i <= 3; i++) events.push({ kind: 'open', id: 'Q' + i, name: 'shape ' + i, blocking: false });
  assert.equal(await n.raise(events, DEFAULTS), 3);
  assert.deepEqual(seen.map((a) => a.card), ['Q1', 'Q2', 'Q3']);
});

test('the collapse summary rides the relay too, so one tick is one channel', async () => {
  const { n, seen } = notifier();
  const events = [];
  for (let i = 1; i <= 7; i++) events.push({ kind: 'open', id: 'Q' + i, name: 'shape ' + i, blocking: false });
  assert.equal(await n.raise(events, DEFAULTS), CAP);
  assert.equal(seen.length, CAP);
  assert.match(seen[CAP - 1].title, /^3 more/);
});

/* ---- show and the burst ------------------------------------------------ */

const burstEvents = (n) => Array.from({ length: n }, (_, i) => ({
  kind: 'open', id: 'Q0', name: 'burst ' + (i + 1), blocking: i === 0,
  gist: 'one question of a burst, to show the cap of five and the summary.',
}));

test('show says which path it took, and there are only two words left', async () => {
  const relayed = notifier();
  const alert = questionAlert({ kind: 'open', id: 'Q0', name: 'test', blocking: false }, 'Default');
  assert.equal(await relayed.n.show(alert), 'tray');
  assert.equal(relayed.seen[0], alert);
  /* no tray, and nothing behind it: a diagnosis rather than a second path */
  const none = notifier({ pushAlert: () => false });
  assert.equal(await none.n.show(alert), 'none');
  const bare = notifier({ pushAlert: null });
  assert.equal(await bare.n.show(alert), 'none');
});

test('a burst is production arithmetic: six events, four cards and a summary', async () => {
  const { n, seen } = notifier();
  assert.equal(await n.raise(burstEvents(CAP + 1), DEFAULTS), CAP);
  assert.equal(seen.length, CAP, 'four events and the summary');
  /* the summary's words live in collapseAlert and nowhere else */
  assert.equal(seen[CAP - 1].title, collapseAlert(2).title);
  const long = notifier();
  assert.equal(await long.n.raise(burstEvents(12), DEFAULTS), CAP);
  assert.equal(long.seen[CAP - 1].title, collapseAlert(12 - CAP + 1).title);
});

/* ---- the work half: the relay, the ensure, and the drop ---------------- */

/* ONE fake board per case, on a port the OS hands out, closed through `t.after`. A
   LISTEN THAT FAILS REJECTS: unhandled it would be an uncaught exception and a
   promise that never settled, which is a hang. */
function fakeBoard(handler, port) {
  return new Promise((resolve, reject) => {
    const srv = createServer(handler);
    srv.on('error', reject);
    srv.listen(port === undefined ? 0 : port, '127.0.0.1', () => resolve({
      port: srv.address().port,
      close: () => new Promise((done) => srv.close(done)),
    }));
  });
}

/* AND EVERY CASE THAT OPENS ONE IS BOUND: a failed assert would leave a listening
   server, so a red case would become a suite that sat for ever. A bound on a case is
   not a timed pass. */
const BOUND = { timeout: 60000 };

/* A board that answers the ping the way the real one does (204 with the version
   header the ensure's probe reads) and records every alert posted to it. */
function boardOf(seen, code) {
  return (req, res) => {
    if (String(req.url).endsWith('/ping')) {
      req.resume();
      res.writeHead(204, { 'x-askerdo-board': '9.9.9' });
      return res.end();
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { body += d; });
    return req.on('end', () => {
      seen.push({ method: req.method, url: req.url, type: req.headers['content-type'], body });
      res.writeHead(typeof code === 'function' ? code() : code);
      res.end();
    });
  };
}

/* The work half with its relay pointed at a fake board: the answer lands one
   loopback round trip after raise() returned, because the verb never waits for
   it. The ensure is a FAKE by default, so no case here starts a server. */
function workNotifier(over = {}) {
  const root = over.root || tempDir('nd-notify-');
  mkdirSync(join(root, 'board'), { recursive: true });
  writeFileSync(settingsPath(root), JSON.stringify(DEFAULTS) + '\n');
  const log = over.log || fakeLog();
  const pending = [];
  const ensured = [];
  const w = createWorkNotifier({
    root,
    port: over.port,
    secret: SECRET,
    platform: over.platform || 'win32',
    relayMs: over.relayMs,
    ensureWaitMs: over.ensureWaitMs,
    ensureStepMs: over.ensureStepMs,
    ensure: over.ensure === undefined ? (dir) => { ensured.push(dir); } : over.ensure,
    ping: over.ping,
    settled: (p) => pending.push(p),
    /* the injected clock the quiet-hours gate reads on this half too */
    now: over.now || (() => new Date(2026, 7, 21, 12, 0, 0)),
    log,
  });
  const settle = async () => {
    while (pending.length) await pending.shift();
  };
  return { w, root, log, settle, ensured };
}

const ENDING = { id: 'T-1', name: 'counter rebuild', ending: 'completed' };

/* THE WORK HALF KEEPS THE SAME GATE ORDER, in the same words: the master
   switch, then the quiet-hours window, then this ending's own row. */
test('the work half places every ending on a row, and the row decides the alert', BOUND, async (t) => {
  const cases = [
    [{ id: 'T-1', name: 'x', ending: 'completed' }, 'task-completed'],
    [{ id: 'T-1', name: 'x', ending: 'dropped' }, 'task-dropped'],
    [{ id: 'P-1', name: 'x', ending: 'closed' }, 'plan-closed'],
    [{ id: 'WS-1', name: 'x', ending: 'closed' }, 'plan-closed'],
  ];
  for (const [ev, cat] of cases) {
    /* the row switched off is an alert that was never built: no relay, no line */
    const off = workNotifier({ port: 1 });
    writeFileSync(settingsPath(off.root), JSON.stringify({
      enabled: true, categories: { [cat]: { show: false } },
    }) + '\n');
    assert.equal(off.w.raise(ev), 0, cat);
    await off.settle();
    assert.deepEqual(off.log.lines, [], cat);

    /* and the row's own sound is what the alert carries, on the record's card */
    const seen = [];
    const board = await fakeBoard(boardOf(seen, 204));
    t.after(() => board.close());
    const on = workNotifier({ port: board.port });
    writeFileSync(settingsPath(on.root), JSON.stringify({
      enabled: true, categories: { [cat]: { sound: 'Mail' } },
    }) + '\n');
    assert.equal(on.w.raise(ev), 1, cat);
    await on.settle();
    const sent = JSON.parse(seen[0].body).alert;
    assert.equal(sent.sound, 'Mail', cat);
    assert.equal(sent.card, ev.id, cat);
    await board.close();
  }
  /* one row off does not silence its neighbour */
  const seen = [];
  const board = await fakeBoard(boardOf(seen, 204));
  t.after(() => board.close());
  const w = workNotifier({ port: board.port });
  writeFileSync(settingsPath(w.root), JSON.stringify({
    enabled: true, categories: { 'task-completed': { show: false } },
  }) + '\n');
  assert.equal(w.w.raise({ id: 'T-1', name: 'x', ending: 'completed' }), 0);
  assert.equal(w.w.raise({ id: 'T-1', name: 'x', ending: 'dropped' }), 1);
  await w.settle();
  assert.equal(seen.length, 1);
  await board.close();
});

test('the quiet-hours window silences the work half too, before anything is built', BOUND, async (t) => {
  const seen = [];
  const board = await fakeBoard(boardOf(seen, 204));
  t.after(() => board.close());
  const night = { enabled: true, quietFrom: '22:00', quietTo: '07:00' };

  const inside = workNotifier({ port: board.port, now: () => new Date(2026, 0, 15, 23, 0, 0) });
  writeFileSync(settingsPath(inside.root), JSON.stringify(night) + '\n');
  assert.equal(inside.w.raise(ENDING), 0);
  await inside.settle();
  assert.equal(seen.length, 0, 'nothing reached the relay');
  assert.deepEqual(inside.log.lines, [], 'and a quiet hour is not a dropped alert');

  const outside = workNotifier({ port: board.port, now: () => new Date(2026, 0, 15, 12, 0, 0) });
  writeFileSync(settingsPath(outside.root), JSON.stringify(night) + '\n');
  assert.equal(outside.w.raise(ENDING), 1);
  await outside.settle();
  assert.equal(seen.length, 1);
  await board.close();
});

test('the work alert is offered to the relay route, and a 204 is the whole of it', BOUND, async (t) => {
  const seen = [];
  let code = 204;
  const board = await fakeBoard(boardOf(seen, () => code));
  t.after(() => board.close());
  const { w, log, settle, ensured } = workNotifier({ port: board.port });

  assert.equal(w.raise(ENDING), 1, 'one alert is on its way, which is what a verb is told');
  await settle();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/' + SECRET + '/api/relay', 'secret-prefixed like every api route');
  assert.match(seen[0].type, /^application\/json/);
  const sent = JSON.parse(seen[0].body);
  assert.deepEqual(Object.keys(sent), ['alert'], 'the alert alone, no toast document');
  /* the popup's request, in the api/alert shape */
  assert.deepEqual(sent.alert, {
    kind: 'done', title: sent.alert.title, where: sent.alert.where, blocking: false,
    card: 'T-1', files: true, sound: 'Default',
  });
  assert.deepEqual(log.lines, ['notify: work completed T-1']);
  assert.deepEqual(ensured, [], 'a board that answered is not a board worth starting');

  /* 503 is the server saying it could not put the alert anywhere, so the alert
     is DROPPED with one line rather than raised another way. */
  code = 503;
  assert.equal(w.raise(ENDING), 1);
  await settle();
  assert.equal(seen.length, 2);
  assert.deepEqual(ensured, [], 'a 503 is an answer: the board is up');
  assert.deepEqual(log.lines, ['notify: work completed T-1',
    'notify: the work alert for T-1 was dropped: no tray took it']);
  for (const line of log.lines) assert.ok(!line.includes(SECRET), line);

  await board.close();
});

test('a relay that never answers costs the alert its budget and nothing more', BOUND, async (t) => {
  const held = [];
  /* a board that takes the request and never answers it: the whole point of a
     bound, since the OS connect and read timeouts are measured in seconds */
  const board = await fakeBoard((req, res) => { held.push(res); req.resume(); });
  /* the held responses are ended FIRST: a connection nothing ends holds the close
     itself open, so the cleanup would be the hang it is here to prevent. */
  t.after(async () => {
    for (const res of held) { try { res.end(); } catch { /* the case is over */ } }
    await board.close();
  });
  const { w, log, settle, ensured } = workNotifier({ port: board.port, relayMs: 40 });
  assert.equal(w.raise(ENDING), 1);
  await settle();
  assert.deepEqual(log.lines, ['notify: the work alert for T-1 was dropped: the board did not answer']);
  assert.deepEqual(ensured, [], 'a board that is listening is not started again');
  assert.equal(RELAY_MS, 300, 'and the shipped budget is the contract one');
  assert.equal(RELAY_CEIL_MS, 1000, 'with the belt from creation behind it');
  for (const res of held) { try { res.end(); } catch { /* the case is over */ } }
  await board.close();
});

test('a verb that blocks its own loop after raise() still takes the 204 path', BOUND, async (t) => {
  /* THE CAP IS ARMED ON CONNECT: the verb POSTs and then blocks its own loop with
     synchronous git (measured 495 ms), so a cap armed at request creation would
     expire before the socket could connect. */
  const seen = [];
  const board = await fakeBoard(boardOf(seen, 204));
  t.after(() => board.close());
  const { w, log, settle } = workNotifier({ port: board.port, relayMs: 40 });
  assert.equal(w.raise(ENDING), 1);
  /* the synchronous store write, in miniature: three times the cap, on the loop
     this process needs back before its own socket can connect */
  const until = Date.now() + 120;
  while (Date.now() < until) { /* deliberately blocking, exactly as spawnSync does */ }
  await settle();
  assert.equal(seen.length, 1, 'the request reached the board on the far side of the block');
  assert.deepEqual(log.lines, ['notify: work completed T-1']);
  await board.close();
});

/* THE CLI'S OWN ENSURE, so the CLI starts a tray that is not running: a REFUSED
   connection is the one answer with a next step, and the ensure here stands in by
   listening on the port the relay was refused on. */
test('a refused relay runs the ensure, waits for the real ping, and relays once more', BOUND, async (t) => {
  const seen = [];
  const handler = boardOf(seen, 204);
  const claim = await fakeBoard(handler);
  t.after(() => claim.close());
  const { port } = claim;
  await claim.close();

  let live = null;
  /* the board the ensure brings up is the case's too, and it is opened deep inside
     production's own path, so the cleanup is registered for it before it exists. */
  t.after(() => (live ? live.close() : undefined));
  const ensured = [];
  const ensure = async (dir) => {
    ensured.push(dir);
    live = await fakeBoard(handler, port);
  };
  const { w, root, log, settle } = workNotifier({
    port, ensure, ensureWaitMs: 3000, ensureStepMs: 20,
  });
  assert.equal(w.raise(ENDING), 1);
  await settle();
  assert.deepEqual(ensured, [root], 'the ensure is handed the store root, once');
  assert.equal(seen.length, 1, 'the alert landed on the far side of the ensure');
  assert.equal(seen[0].url, '/' + SECRET + '/api/relay');
  assert.deepEqual(log.lines, ['notify: work completed T-1']);
  /* the shipped budget is the contract one, and the poll's step with it: 700
     rather than 1000 because the verb's exit is bounded by ONE SECOND, and 700
     plus the second relay's own 300 cap stays inside it on the refused path. */
  assert.equal(ENSURE_WAIT_MS, 700);
  assert.equal(ENSURE_STEP_MS, 100);
  assert.ok(ENSURE_WAIT_MS + RELAY_MS <= 1000, 'the refused path can outrun the Intent');
  if (live) await live.close();
});

test('an ensure that brings nothing up is one line and a dropped alert', BOUND, async () => {
  /* port 1: listen(0) never hands it to a parallel test, so the relay is always
     refused; the ensure cannot change that and the alert is lost */
  const port = 1;
  const ensured = [];
  const { w, log, settle } = workNotifier({
    port,
    ensure: (dir) => { ensured.push(dir); },
    ensureWaitMs: 60,
    ensureStepMs: 10,
  });
  assert.equal(w.raise(ENDING), 1);
  await settle();
  assert.equal(ensured.length, 1, 'it was tried exactly once');
  assert.deepEqual(log.lines, ['notify: the work alert for T-1 was dropped: no board server answered']);
});

test('an ensure that throws is swallowed, and the poll still bounds the wait', BOUND, async () => {
  const port = 1;
  const { w, log, settle } = workNotifier({
    port,
    ensure: () => { throw new Error('spawn EPERM'); },
    ensureWaitMs: 40,
    ensureStepMs: 10,
  });
  assert.equal(w.raise(ENDING), 1);
  await settle();
  assert.deepEqual(log.lines, ['notify: the work alert for T-1 was dropped: no board server answered']);

  /* and an ensure whose promise REJECTS is the same: nothing here awaits it */
  const rejecting = workNotifier({
    port,
    ensure: () => Promise.reject(new Error('no board for you')),
    ensureWaitMs: 40,
    ensureStepMs: 10,
  });
  assert.equal(rejecting.w.raise(ENDING), 1);
  await rejecting.settle();
  assert.deepEqual(rejecting.log.lines,
    ['notify: the work alert for T-1 was dropped: no board server answered']);
});

test('an alert that never went is not reported as one, on either side of the relay', BOUND, async (t) => {
  const seen = [];
  const board = await fakeBoard(boardOf(seen, 503));
  t.after(() => board.close());
  const { w, log, settle } = workNotifier({ port: board.port });
  assert.equal(w.raise(ENDING), 1);
  await settle();
  assert.ok(!log.lines.includes('notify: work completed T-1'), 'nothing went, so nothing is claimed');
  assert.deepEqual(log.lines, ['notify: the work alert for T-1 was dropped: no tray took it']);
  await board.close();
});

test('a refusal that names its reason is the reason the verb logs, in its one line', BOUND, async (t) => {
  /* THE 503 BODY CARRIES THE WHY: the CLI raised this alert
     in another process, so the body is the only way its line can say what happened. */
  const refusing = (reason) => (req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: reason }) + '\n');
    });
  };
  const board = await fakeBoard(refusing('the tray was exited by the person'));
  t.after(() => board.close());
  const { w, log, settle } = workNotifier({ port: board.port });
  assert.equal(w.raise(ENDING), 1);
  await settle();
  assert.deepEqual(log.lines,
    ['notify: the work alert for T-1 was dropped: the tray was exited by the person']);
  await board.close();

  /* and a body that is not that shape is not a reason: this half's own wording
     stands, and nothing from the wire is repeated into the log */
  const junk = await fakeBoard((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(503); res.end('nope'); });
  });
  t.after(() => junk.close());
  const other = workNotifier({ port: junk.port });
  assert.equal(other.w.raise(ENDING), 1);
  await other.settle();
  assert.deepEqual(other.log.lines,
    ['notify: the work alert for T-1 was dropped: no tray took it']);
  await junk.close();
});

test('the work half spawns nothing on any path, and names no shell', () => {
  const src = readFileSync(join(pluginRoot, 'lib', 'notify.mjs'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/child_process/.test(code), 'the module still imports a spawner');
  assert.ok(!/spawn/i.test(code), 'the module still names a spawn');
  /* the ensure is IMPORTED rather than copied, so the CLI and the SessionStart
     hook start a board the same way and cannot drift */
  assert.ok(/from '\.\/board-ensure\.mjs'/.test(src), 'the ensure is not the shared one');
  const w = createWorkNotifier({ root: tempDir('nd-notify-'), port: PORT, secret: SECRET, platform: 'win32' });
  assert.equal(w.available, true, 'and availability is the platform, nothing else');
  assert.equal(w.exe, undefined, 'there is no exe on this surface any more');
});

/* ---- the pause (the tray menu) ------------------------------------ */

const CLOCK = (y, mo, d, h, mi) => () => new Date(y, mo, d, h, mi, 0);

/* THE VERB RESOLVED INTO A VALUE, against an injected clock and through the
   store's ONE stamp format. No new time vocabulary anywhere. */
test('pauseUntil turns each token into a value off the injected clock', () => {
  const at = new Date(2026, 8, 9, 14, 40, 0);
  /* an hour is now plus 3600000, to the second */
  const hour = pauseUntil(at, 'hour');
  assert.match(hour, /^2026-09-09T15:40:00[+-]\d\d:\d\d$/, hour);
  /* tomorrow is 07:00 on the NEXT calendar day, always */
  const tomorrow = pauseUntil(at, 'tomorrow');
  assert.match(tomorrow, /^2026-09-10T07:00:00[+-]\d\d:\d\d$/, tomorrow);
  /* the token and the empty string pass through as themselves */
  assert.equal(pauseUntil(at, 'until-resume'), 'until-resume');
  assert.equal(pauseUntil(at, ''), '');
  /* anything else resolves to no pause rather than to a guess */
  for (const junk of ['week', 'HOUR', 'tomorrow ', null, undefined, 3, {}]) {
    assert.equal(pauseUntil(at, junk), '', String(junk));
  }
});

test('tomorrow is the next day even from 23:50 and from 06:00, and across a month end', () => {
  const day = (v) => v.slice(0, 10);
  assert.equal(day(pauseUntil(new Date(2026, 8, 9, 23, 50, 0), 'tomorrow')), '2026-09-10');
  /* BEFORE 07:00 IT IS STILL THE NEXT DAY: a person clicking at two in the
     morning is asking for the morning after the night they are in */
  assert.equal(day(pauseUntil(new Date(2026, 8, 9, 6, 0, 0), 'tomorrow')), '2026-09-10');
  assert.equal(day(pauseUntil(new Date(2026, 8, 9, 2, 0, 0), 'tomorrow')), '2026-09-10');
  /* a month end, a year end, and a leap day */
  assert.equal(day(pauseUntil(new Date(2026, 8, 30, 12, 0, 0), 'tomorrow')), '2026-10-01');
  assert.equal(day(pauseUntil(new Date(2026, 11, 31, 12, 0, 0), 'tomorrow')), '2027-01-01');
  assert.equal(day(pauseUntil(new Date(2028, 1, 28, 12, 0, 0), 'tomorrow')), '2028-02-29');
  /* an hour's pause rolls the day too */
  assert.equal(day(pauseUntil(new Date(2026, 8, 30, 23, 30, 0), 'hour')), '2026-10-01');
  /* and the value it wrote is one the store can read back */
  assert.ok(paused(new Date(2026, 8, 30, 23, 40, 0),
    pauseUntil(new Date(2026, 8, 30, 23, 30, 0), 'hour')));
});

test('a pause holds until its stamp lapses, and the token holds for good', () => {
  const at = new Date(2026, 8, 9, 14, 40, 0);
  const hour = pauseUntil(at, 'hour');
  assert.equal(paused(at, hour), true);
  assert.equal(paused(new Date(2026, 8, 9, 15, 39, 0), hour), true);
  /* A LAPSED STAMP SIMPLY STOPS SUPPRESSING and is never rewritten */
  assert.equal(paused(new Date(2026, 8, 9, 15, 41, 0), hour), false);
  assert.equal(paused(new Date(2027, 0, 1, 0, 0, 0), hour), false);
  assert.equal(paused(at, 'until-resume'), true);
  assert.equal(paused(new Date(2099, 0, 1), 'until-resume'), true);
  assert.equal(paused(at, ''), false);
  /* junk is no pause, so a hand-mangled file never silences the channel */
  for (const junk of ['soon', 'until resume', '2026-13-40T99:99:99+00:00', null, 7]) {
    assert.equal(paused(at, junk), false, String(junk));
  }
});

/* THE LABEL'S FOUR FORMS, built HERE and printed verbatim by both the menu and
   the page, so the two can never be two vocabularies for one state. */
test('the pause label has four forms and the exe formats none of them', () => {
  const at = new Date(2026, 8, 9, 14, 40, 0);
  assert.equal(pauseLabel(at, ''), '');
  assert.equal(pauseLabel(at, 'until-resume'), 'until I resume');
  assert.equal(pauseLabel(at, pauseUntil(at, 'hour')), 'until 15:40');
  assert.equal(pauseLabel(at, pauseUntil(at, 'tomorrow')), 'until 07:00 tomorrow');
  /* an hour's pause from 23:30 lands tomorrow and says so */
  const late = new Date(2026, 8, 9, 23, 30, 0);
  assert.equal(pauseLabel(late, pauseUntil(late, 'hour')), 'until 00:30 tomorrow');
  /* a LAPSED pause has no label at all: an empty label IS no pause, which is
     what greys Resume on the page and in the menu */
  assert.equal(pauseLabel(new Date(2026, 8, 9, 16, 0, 0), pauseUntil(at, 'hour')), '');
  /* and junk never renders */
  assert.equal(pauseLabel(at, 'soon'), '');
});

/* THE MERGE takes the key absent, wrong-typed and junk, and falls back to no
   pause in every one of those cases. */
test('the merge accepts pausedUntil absent, wrong-typed and junk', () => {
  assert.equal(DEFAULTS.pausedUntil, '');
  assert.equal(mergeSettings({}).pausedUntil, '');
  assert.equal(mergeSettings(null).pausedUntil, '');
  for (const bad of [true, 3, null, [], {}, 'soon', 'until resume', '15:40']) {
    assert.equal(mergeSettings({ pausedUntil: bad }).pausedUntil, '', JSON.stringify(bad));
  }
  assert.equal(mergeSettings({ pausedUntil: 'until-resume' }).pausedUntil, 'until-resume');
  const stamp = pauseUntil(new Date(2026, 8, 9, 14, 40, 0), 'hour');
  assert.equal(mergeSettings({ pausedUntil: stamp }).pausedUntil, stamp);
  /* A STAMP IN THE PAST IS KEPT AS IT IS, never rewritten by a reader: the gate
     compares it against the clock and a lapsed one simply stops suppressing */
  const old = '2020-01-01T00:00:00+00:00';
  assert.equal(mergeSettings({ pausedUntil: old }).pausedUntil, old);
  assert.equal(paused(new Date(2026, 8, 9), old), false);
});

/* THE EXPLICIT-LIST TRAP, pinned so it can never come back: saveSettings
   copies a patch key by a NAMED list, so a key in DEFAULTS and not in that
   list lands on disk at its default and never moves while the file looks right. */
test('saveSettings actually persists pausedUntil', () => {
  const root = tempDir('nd-notify-');
  mkdirSync(join(root, 'board'), { recursive: true });
  const file = settingsPath(root);

  const first = saveSettings(root, { pausedUntil: 'until-resume' });
  assert.equal(first.pausedUntil, 'until-resume');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pausedUntil, 'until-resume');
  assert.equal(loadSettings(root).pausedUntil, 'until-resume');

  /* and Resume writes the empty string over it rather than leaving it */
  const back = saveSettings(root, { pausedUntil: '' });
  assert.equal(back.pausedUntil, '');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pausedUntil, '');

  /* a stamp survives the round trip byte for byte */
  const stamp = pauseUntil(new Date(2026, 8, 9, 14, 40, 0), 'hour');
  assert.equal(saveSettings(root, { pausedUntil: stamp }).pausedUntil, stamp);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pausedUntil, stamp);
  /* a write of something ELSE leaves the pause standing */
  assert.equal(saveSettings(root, { enabled: false }).pausedUntil, stamp);
});

test('the pause gates the question half, before the quiet hours are read', async () => {
  const at = CLOCK(2026, 8, 9, 14, 40);
  const stamp = pauseUntil(at(), 'hour');
  const ev = [{ kind: 'open', id: 'Q7', name: 'x', blocking: true }];

  const held = notifier({ now: at });
  assert.equal(await held.n.raise(ev, { ...DEFAULTS, pausedUntil: stamp }), 0);
  assert.equal(held.seen.length, 0, 'nothing was built, let alone offered');

  const forever = notifier({ now: at });
  assert.equal(await forever.n.raise(ev, { ...DEFAULTS, pausedUntil: 'until-resume' }), 0);
  assert.equal(forever.seen.length, 0);

  /* a LAPSED stamp and an empty one do not gate */
  const after = notifier({ now: CLOCK(2026, 8, 9, 16, 0) });
  assert.equal(await after.n.raise(ev, { ...DEFAULTS, pausedUntil: stamp }), 1);
  const none = notifier({ now: at });
  assert.equal(await none.n.raise(ev, { ...DEFAULTS, pausedUntil: '' }), 1);

  /* THE GATE'S PLACE IN THE ORDER: what is pinned is that the pause alone
     suppresses at an hour the quiet hours leave open, because the two cannot be
     told apart from the outside; second is why Pause reads in the log line. */
  const outside = notifier({ now: at });
  assert.equal(await outside.n.raise(ev, {
    ...DEFAULTS, pausedUntil: stamp, quietFrom: '22:00', quietTo: '07:00',
  }), 0, 'the pause holds at midday, which the window does not');
  assert.equal(outside.seen.length, 0);

  /* it applies to EVERY category, the blocking one included, and to the
     collapse summary a burst over the cap would raise */
  const burst = notifier({ now: at });
  const many = [];
  for (let i = 1; i <= 7; i++) many.push({ kind: 'open', id: 'Q' + i, name: 'x', blocking: i === 1 });
  assert.equal(await burst.n.raise(many, { ...DEFAULTS, pausedUntil: 'until-resume' }), 0);
  assert.equal(burst.seen.length, 0, 'not even the collapse summary');
});

/* ---- the names and the pick the tray cards draw ----------- */

test('enrichEvents carries the project, the held task and the pick as names', () => {
  const options = [
    { type: '504a', option: 'Names on every card', getsYou: '', costsYou: '' },
    { type: '504b', option: 'Ids only', getsYou: '', costsYou: '' },
  ];
  const entries = [
    { id: 'Q1', project: 'Tidewatch', projectDir: 'C:\\Demo\\tidewatch',
      workstream: 'WS-11', gates: ['T-307', 'T-9'], pick: '504a', options, track: 'TR-2' },
    { id: 'Q2', projectDir: 'C:/Demo/harbor/', pick: '504b', options },
    { id: 'Q3', projectDir: 'C:/Work/Side-Repo', pick: 'keep it as it is', gates: ['T-404'] },
  ];
  const names = { 'WS-11': 'the board', 'T-307': 'tray cards', 'TR-2': 'mod core' };
  const projects = { [dirKey('C:/Demo/harbor')]: 'Harbor app' };
  const out = enrichEvents([
    { kind: 'open', id: 'Q1', blocking: true },
    { kind: 'open', id: 'Q2', blocking: false },
    { kind: 'open', id: 'Q3', blocking: true },
  ], entries, names, projects);
  assert.equal(out[0].projectName, 'Tidewatch', 'the stored name wins');
  assert.equal(out[0].workstreamName, 'the board');
  assert.equal(out[0].holdsName, 'tray cards and 1 more');
  assert.equal(out[0].trackName, 'mod core');
  assert.equal(out[0].pick, 'Names on every card', 'the option name, never its code');
  assert.equal(out[1].projectName, 'Harbor app', 'the dir map names a project with no stored name');
  assert.equal(out[1].pick, 'Ids only');
  assert.equal(out[2].projectName, 'Side-Repo', 'else the last segment in its own casing');
  assert.equal(out[2].pick, 'keep it as it is', 'a free-text pick stays');
  assert.equal('holdsName' in out[2], false, 'a gate with no name is not shown as a code');
  /* a bare code with no option to name it is dropped */
  const bare = enrichEvents([{ kind: 'open', id: 'Q1' }], [{ id: 'Q1', pick: '504c', options }]);
  assert.equal('pick' in bare[0], false);
  /* the board server keys its map with shell's normDir; the two must agree */
  for (const d of ['C:\\src\\X\\', 'c:/src/x', '/home/user/x//']) assert.equal(dirKey(d), normDir(d));
});

test('questionWhereNames: a blocker holds up its task, or else its workstream once', () => {
  assert.deepEqual(questionWhereNames({
    kind: 'open', blocking: true, projectName: 'p', workstreamName: 'w', holdsName: 't', trackName: 'th',
  }), { project: 'p', workstream: 'w', track: 'th', holds: 't' });
  assert.deepEqual(questionWhereNames({ kind: 'open', blocking: true, projectName: 'p', workstreamName: 'w' }),
    { project: 'p', holds: 'w' }, 'the workstream is not said twice');
  assert.deepEqual(questionWhereNames({ kind: 'open', blocking: false, workstreamName: 'w', holdsName: 't' }),
    { workstream: 'w' }, 'a preference holds nothing up');
  assert.deepEqual(questionWhereNames({ kind: 'closed', status: 'answered', projectName: 'p', holdsName: 't' }),
    { project: 'p' });
  assert.deepEqual(questionWhereNames({ kind: 'open' }), {});
});

test('the question watcher sends names and the pick with the alert; an answer sends no pick', async () => {
  const alerts = [];
  const { n } = notifier({ pushAlert: (alert) => { alerts.push(alert); return true; } });
  const entries = [{ id: 'Q7', project: 'Tidewatch', projectDir: 'C:/Demo/tidewatch',
    workstream: 'WS-11', gates: ['T-307'], pick: '7a',
    options: [{ type: '7a', option: 'Names on the card', getsYou: '', costsYou: '' }] }];
  const events = enrichEvents([
    { kind: 'open', id: 'Q7', name: 'store shape', blocking: true },
    { kind: 'closed', id: 'Q7', name: 'store shape', status: 'answered' },
    { kind: 'open', id: 'Q8', name: 'no entry', blocking: false },
  ], entries, { 'WS-11': 'the board', 'T-307': 'tray cards' }, {});
  await n.raise(events, DEFAULTS);
  assert.equal(alerts.length, 3);
  assert.equal(alerts[0].kind, 'blocker');
  assert.deepEqual(alerts[0].whereNames, { project: 'Tidewatch', workstream: 'the board', holds: 'tray cards' });
  assert.equal(alerts[0].pick, 'Names on the card');
  assert.equal(alerts[0].where, attributionOf(events[0]), 'where stays for an older exe');
  assert.equal(alerts[1].kind, 'answer');
  assert.deepEqual(alerts[1].whereNames, { project: 'Tidewatch', workstream: 'the board' });
  assert.equal('pick' in alerts[1], false, 'an answer shows no pick');
  /* nothing known is the alert it always was */
  assert.deepEqual(Object.keys(alerts[2]).sort(),
    ['blocking', 'card', 'files', 'kind', 'sound', 'title', 'where']);
});

test('workAlertTitle and workWhereNames lead with names and add nothing unknown', () => {
  assert.equal(workAlertTitle({ id: 'T-1', name: 'counter rebuild', ending: 'completed' }), 'counter rebuild completed');
  assert.equal(workAlertTitle({ id: 'P-2', name: 'board rework', ending: 'closed', outcome: 'shipped' }),
    'board rework closed: shipped');
  assert.equal(workAlertTitle({ id: 'T-1', ending: 'dropped' }), '', 'no name, so the id and the ending stand');
  assert.deepEqual(workWhereNames({ projectName: ' p ', workstreamName: 'w' }), { project: 'p', workstream: 'w' });
  assert.deepEqual(workWhereNames({ workstream: 'WS-3' }), {}, 'a token is never a name');
});

test('the work sender posts a name-led title and the names it holds', BOUND, async (t) => {
  const seen = [];
  const board = await fakeBoard(boardOf(seen, () => 204));
  t.after(() => board.close());
  const { w, settle } = workNotifier({ port: board.port });
  assert.equal(w.raise({ ...ENDING, workstream: 'WS-3', workstreamName: 'the board', projectName: 'Tidewatch' }), 1);
  assert.equal(w.raise(ENDING), 1);
  await settle();
  const posts = seen.map((s) => JSON.parse(s.body).alert);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].title, 'counter rebuild completed');
  assert.deepEqual(posts[0].whereNames, { project: 'Tidewatch', workstream: 'the board' });
  assert.equal('whereNames' in posts[1], false, 'no names known, none sent');
  assert.equal(posts[1].title, 'counter rebuild completed');
  await board.close();
});
