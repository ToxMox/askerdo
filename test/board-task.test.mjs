/* The scheduled task document, over the pure module. Nothing here
 * registers, runs or deletes a task and nothing here can: the module has no fs,
 * no child_process and no environment read. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TASK_DESCRIPTION, TASK_NAME, actionMatches, formatArgs, parseAction, parseArgs,
  taskXml, wantedAction, xmlEscape, xmlUnescape,
} from '../lib/board-task.mjs';
import { dataDir, pluginRoot } from '../lib/node-helpers.mjs';
import { hostStart, hostedHere, prepareHost } from '../lib/board-host.mjs';
import { dailyBackup, moveCopy } from '../lib/board-backup.mjs';
import { tempDir } from './helpers/sandbox.mjs';
import { TRAY_EXE, trayExePath } from '../lib/tray.mjs';

const SID = 'S-1-5-21-1111111111-2222222222-3333333333-1001';
const EXE = 'C:\\cache\\askerdo\\assets\\askerdo-tray.exe';
const ROOT = 'C:\\store\\askerdo';

const doc = (over = {}) => taskXml({ sid: SID, command: EXE, args: ['--serve', '--root', ROOT], ...over });

/* THE MEASURED REFUSAL, pinned so nobody pastes a modern export back in: a 1.2
   document carrying either 1.3 element is refused whole by schtasks /create
   with 'The task XML contains an unexpected node. (31,7)'. */
test('the XML declares version 1.2 and omits the two 1.3 elements', () => {
  const xml = doc();
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-16"\?>\n/);
  assert.match(xml, /<Task version="1\.2" xmlns="http:\/\/schemas\.microsoft\.com\/windows\/2004\/02\/mit\/task">/);
  assert.ok(!xml.includes('DisallowStartOnRemoteAppSession'), 'a 1.3 element would be refused');
  assert.ok(!xml.includes('UseUnifiedSchedulingEngine'), 'a 1.3 element would be refused');
  /* LF throughout, and no BOM in the STRING: the BOM is the ensure's, added
     when it writes the file as UTF-16, because that is a file property */
  assert.ok(!xml.includes('\r'));
  assert.equal(xml.charCodeAt(0), '<'.charCodeAt(0));
});

test('every setting the Intent names is in the XML', () => {
  const xml = doc();
  for (const [tag, value] of [
    ['MultipleInstancesPolicy', 'IgnoreNew'],
    ['ExecutionTimeLimit', 'PT0S'],
    ['Priority', '4'],
    ['StartWhenAvailable', 'true'],
    ['DisallowStartIfOnBatteries', 'false'],
    ['StopIfGoingOnBatteries', 'false'],
    ['RunOnlyIfNetworkAvailable', 'false'],
    ['AllowStartOnDemand', 'true'],
    ['LogonType', 'InteractiveToken'],
    ['RunLevel', 'LeastPrivilege'],
    ['Enabled', 'true'],
    ['Hidden', 'false'],
    ['RunOnlyIfIdle', 'false'],
    ['WakeToRun', 'false'],
    ['AllowHardTerminate', 'true'],
  ]) {
    assert.ok(xml.includes('<' + tag + '>' + value + '</' + tag + '>'), tag + ' is ' + value);
  }
  /* the logon trigger, carrying the SID it was handed and nothing else, and
     the principal carrying the same one */
  assert.match(xml, new RegExp('<LogonTrigger>\\s*<Enabled>true</Enabled>\\s*<UserId>' + SID + '</UserId>'));
  assert.match(xml, new RegExp('<Principal id="Author">\\s*<UserId>' + SID + '</UserId>'));
  /* the action, and the working directory that is written but never compared */
  assert.ok(xml.includes('<Command>' + EXE + '</Command>'));
  assert.ok(xml.includes('<WorkingDirectory>C:\\</WorkingDirectory>'));
  /* the undo rides in the description a person reads in the UI */
  assert.ok(TASK_DESCRIPTION.includes('schtasks /delete /tn'));
  assert.ok(TASK_DESCRIPTION.includes(TASK_NAME));
  /* and the document is well formed enough to round trip through parseAction */
  assert.deepEqual(parseAction(xml), { command: EXE, args: ['--serve', '--root', ROOT] });
});

test('the ampersand and every other entity are escaped', () => {
  assert.equal(TASK_NAME, 'AskerDo board');
  /* the name has a space and no ampersand, so it reaches schtasks as ONE
     argv entry and the argument string it rides in round trips */
  assert.equal(formatArgs(['/tn', TASK_NAME]), '/tn "AskerDo board"');
  assert.deepEqual(parseArgs(formatArgs(['/tn', TASK_NAME])), ['/tn', TASK_NAME]);
  const wild = 'a&b<c>d"e\'f';
  const xml = taskXml({ sid: wild, command: wild, args: ['--serve', '--root', wild] });
  assert.equal(xmlEscape(wild), 'a&amp;b&lt;c&gt;d&quot;e&apos;f');
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), 'every bare ampersand is an entity');
  assert.ok(!xml.includes('<c>'), 'a raw angle bracket never reaches the document');
  /* the brand itself, in the one place a document carries it: plain, since
     AskerDo has nothing to escape, and the delete hint's quotes are entities */
  const branded = taskXml({ sid: SID, command: EXE, args: [], description: TASK_DESCRIPTION });
  assert.ok(branded.includes('AskerDo board'), 'the brand is the brand, not slugged');
  assert.ok(branded.includes('&quot;AskerDo board&quot;'), 'the hint is escaped, not raw');
  /* and it comes back out again, byte for byte */
  assert.equal(xmlUnescape(xmlEscape(wild)), wild);
  assert.equal(xmlUnescape('&amp;lt;'), '&lt;', 'an escaped ampersand does not re-open an entity');
  assert.deepEqual(parseAction(xml).command, wild);
});

/* THE RULE THE WHOLE MODULE EXISTS FOR: an identity reaches the document as an
   argument and never as a read, so no tracked file can carry one. */
test('no username and no home path is ever built into a tracked file', () => {
  const src = readFileSync(join(pluginRoot, 'lib', 'board-task.mjs'), 'utf8');
  assert.ok(!/S-1-5-/.test(src), 'no SID literal');
  assert.ok(!/[A-Za-z]:[\\/]Users[\\/]/.test(src), 'no home path');
  for (const forbidden of ['process.env', 'homedir', 'node:fs', 'node:child_process', 'node:os']) {
    assert.ok(!src.includes(forbidden), 'board-task.mjs reads ' + forbidden);
  }
  /* the SID in the document is the one it was PASSED */
  const mine = 'S-1-5-21-9-9-9-4242';
  assert.ok(doc({ sid: mine }).includes('<UserId>' + mine + '</UserId>'));
  assert.ok(!doc({ sid: mine }).includes(SID));
  /* and a document with no SID is refused rather than written half-formed */
  assert.throws(() => taskXml({ sid: '', command: EXE }), /SID/);
  assert.throws(() => taskXml({ sid: SID, command: '' }), /command/);
});

test('parseAction reads back what taskXml wrote', () => {
  const spaced = 'C:\\Program Files\\AskerDo plugin\\assets\\' + TRAY_EXE;
  const args = ['--serve', '--root', 'C:\\store with space\\askerdo', '--note', 'a "quoted" word'];
  const back = parseAction(taskXml({ sid: SID, command: spaced, args }));
  assert.deepEqual(back, { command: spaced, args });
  /* the argument string itself, as one value the scheduler stores verbatim */
  assert.equal(formatArgs(['--serve', '--root', ROOT]), '--serve --root ' + ROOT);
  assert.equal(formatArgs(['--root', 'C:\\a b']), '--root "C:\\a b"');
  assert.deepEqual(parseArgs('--root "C:\\a b" --serve'), ['--root', 'C:\\a b', '--serve']);
  assert.deepEqual(parseArgs(''), []);
  /* what schtasks actually prints: CR CR LF endings and an escaped brand */
  const printed = '<?xml version="1.0" encoding="UTF-16"?>\r\r\n<Task version="1.2">\r\r\n'
    + '<Actions Context="Author">\r\r\n<Exec>\r\r\n<Command>' + EXE + '</Command>\r\r\n'
    + '<Arguments>--serve --root "C:\\a&amp;b"</Arguments>\r\r\n</Exec>\r\r\n</Actions>\r\r\n</Task>';
  assert.deepEqual(parseAction(printed), { command: EXE, args: ['--serve', '--root', 'C:\\a&b'] });
  /* and what it prints when there is no task, or no action in it */
  assert.equal(parseAction('ERROR: The system cannot find the file specified.'), null);
  assert.equal(parseAction(''), null);
  assert.equal(parseAction('<Exec><Command>  </Command></Exec>'), null);
  /* an Exec with no Arguments at all is an action with no arguments */
  assert.deepEqual(parseAction('<Exec><Command>' + EXE + '</Command></Exec>'),
    { command: EXE, args: [] });
});

test('the compare is case-insensitive on path form and difference-sensitive everywhere else', () => {
  const wanted = { command: EXE, args: ['--serve', '--root', ROOT] };
  const current = parseAction(doc());
  assert.equal(actionMatches(wanted, current), true);
  /* a path is case-insensitive on Windows, and a case-only difference is not a
     stale action: reading it as one would re-register at every session start */
  assert.equal(actionMatches(wanted, parseAction(taskXml({
    sid: SID, command: EXE.toUpperCase(), args: ['--SERVE', '--ROOT', ROOT.toUpperCase()],
  }))), true);
  /* a changed checkout, a changed root, a changed flag, a dropped flag */
  const stale = (over) => actionMatches(wanted, parseAction(taskXml({ sid: SID, command: EXE, ...over })));
  assert.equal(stale({ command: 'C:\\cache\\askerdo-0.5.27\\assets\\' + TRAY_EXE,
    args: ['--serve', '--root', ROOT] }), false, 'an older checkout is stale');
  assert.equal(stale({ args: ['--serve', '--root', 'C:\\other\\askerdo'] }), false, 'another root is stale');
  assert.equal(stale({ args: ['--open', '--root', ROOT] }), false, 'another flag is stale');
  assert.equal(stale({ args: ['--serve'] }), false, 'a dropped root is stale');
  assert.equal(stale({ args: ['--serve', '--root', ROOT, '--log', 'C:\\t.log'] }), false, 'an added flag is stale');
  /* a missing or unparseable read-back is stale, never current */
  assert.equal(actionMatches(wanted, null), false);
  assert.equal(actionMatches(wanted, parseAction('ERROR: cannot find the file')), false);
  /* the working directory is written and NOT compared: it is not what makes an
     action stale, and comparing it only adds a way to churn */
  assert.equal(actionMatches(wanted, parseAction(taskXml({
    sid: SID, command: EXE, args: wanted.args, workDir: 'D:\\somewhere else',
  }))), true);
  /* and neither is the trigger, whose UserId comes back normalized to
     DOMAIN\user while the principal's stays the SID (measured) */
  assert.equal(actionMatches(wanted, parseAction(doc({ sid: 'MACHINE\\user' }))), true);
});

test('wantedAction points at the released checkout', () => {
  const w = wantedAction(ROOT);
  assert.equal(w.command, trayExePath());
  assert.equal(w.command, join(pluginRoot, 'assets', TRAY_EXE));
  assert.deepEqual(w.args, ['--serve', '--root', ROOT]);
  /* the root is the ensure's, never assumed: two roots give two actions */
  assert.notEqual(formatArgs(wantedAction('C:\\a').args), formatArgs(wantedAction('C:\\b').args));
  /* and the action is the exe, so a task from an older release names an exe
     under an older cache directory and reads as stale by the path alone */
  assert.ok(w.command.endsWith(join('assets', TRAY_EXE)));
});

/* a moved store root needs no change to the module, and this is the proof: the new
   root reaches <Arguments> verbatim, and the slug has no space, so the one string the
   scheduler stores carries no quotes and comes back unchanged. */
test('wantedAction carries the new root verbatim into Arguments, unquoted', () => {
  const w = wantedAction(ROOT);
  assert.deepEqual(w.args, ['--serve', '--root', ROOT]);
  const line = formatArgs(w.args);
  assert.equal(line, '--serve --root ' + ROOT);
  assert.ok(!line.includes('"'), 'no space in the new slug, so no quoting: ' + line);
  assert.deepEqual(parseArgs(line), w.args);
  const xml = taskXml({ sid: SID, command: w.command, args: w.args });
  assert.ok(xml.includes('<Arguments>' + line + '</Arguments>'), xml);
  assert.deepEqual(parseAction(xml), { command: w.command, args: w.args });
});

/* the board this PC hosts runs from the plugin folder of the local server
   that starts it, and its database lives under the store root, which an update keeps */
test('the hosted board starts from the current plugin folder with its database outside it, never on a database moved away', async () => {
  const root = tempDir('askerdo-store-');
  /* board here after a move sets the moved database aside */
  mkdirSync(join(root, 'board-host'));
  for (const n of ['moved.json', 'askerdo.db']) writeFileSync(join(root, 'board-host', n), '{}');
  const host = await prepareHost(root);
  assert.ok(!existsSync(host.db) && !existsSync(join(root, 'board-host', 'moved.json')), 'a fresh database');
  assert.equal(readdirSync(join(root, 'board-host', 'moved')).length, 1);
  const s = hostStart(root);
  assert.equal(s.args[0], join(pluginRoot, 'server', 'cli.mjs'));
  const db = s.args[s.args.indexOf('--db') + 1];
  assert.ok(db.startsWith(root) && !db.startsWith(pluginRoot), db);
  assert.equal(s.args[s.args.indexOf('--port') + 1], String(host.port));
  assert.equal(s.args[s.args.indexOf('--host') + 1], '127.0.0.1');
  assert.equal(s.args[s.args.indexOf('--settings') + 1], join(dataDir(), 'config.json'), 'the boardBackups setting reaches the running board');
  /* the port is kept once chosen */
  assert.equal((await prepareHost(root)).port, host.port);
  /* it answers 127.0.0.1 alone, so join-code and the tray's Add a PC refuse for it */
  assert.ok(hostedHere(root, host.url) && hostedHere(root, 'http://localhost:' + host.port + '/'));
  assert.ok(!hostedHere(root, 'http://nas:' + host.port) && !hostedHere(tempDir('askerdo-store-'), host.url));
});

/* the first session start of each day copies the hosted board, once;
   port 1 answers nothing, so the copy is made from the file as with the board down */
test('the hosted board gets one copy a day, at the first session start of that day', async () => {
  const root = tempDir('askerdo-store-');
  const dir = join(root, 'board-host');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'host.json'), JSON.stringify({ port: 1, db: join(dir, 'askerdo.db') }));
  const { openDb } = await import('../server/db.mjs');
  const { migrate } = await import('../server/migrate.mjs');
  const db = openDb(join(dir, 'askerdo.db'));
  migrate(db);
  db.close();
  const at = (d, h) => ({ now: new Date(2026, 10, d, h), log: () => {} });
  const runs = [await dailyBackup(root, at(3, 8)), await dailyBackup(root, at(3, 17)), await dailyBackup(root, at(4, 8))];
  assert.deepEqual(runs.map((r) => Boolean(r.made)), [true, false, true], JSON.stringify(runs));
  assert.equal(readdirSync(join(dir, 'backups')).filter((n) => n.endsWith('.db')).length, 2);
  /* a move's copy that day leaves the day's dated copy as it was */
  const dated = join(dir, 'backups', 'askerdo-2026-11-04.db');
  const was = statSync(dated).mtimeMs;
  const moved = await moveCopy(root, 'http://nas:17480', { now: new Date(2026, 10, 4, 9) });
  assert.ok(existsSync(moved.file) && moved.file !== dated && Number.isInteger(moved.seq));
  assert.equal(statSync(dated).mtimeMs, was);

  /* a Docker board configure set up here is backed up in its container the same way */
  const pc = tempDir('askerdo-store-');
  const calls = [];
  const logs = [];
  let answer = { code: 0, out: JSON.stringify({ file: '/backups/askerdo-2026-11-03.db' }), err: '' };
  const docker = async (args) => { calls.push(args); return answer; };
  const day = (d, h) => ({ cfg: { boardContainer: 'askerdo' }, now: new Date(2026, 10, d, h), log: (l) => logs.push(l), docker });
  assert.ok((await dailyBackup(pc, day(3, 8))).container.made);
  await dailyBackup(pc, day(3, 17));
  assert.equal(calls.length, 1, 'once a day');
  assert.deepEqual(calls[0].slice(0, 2), ['exec', 'askerdo']);
  assert.ok(calls[0].includes('backup'));
  answer = { code: 'ENOENT', out: '', err: 'spawn docker ENOENT' };
  const away = await dailyBackup(pc, day(4, 8));
  assert.ok(away.container.skipped && !away.container.failed, JSON.stringify(away));
  assert.equal(logs.length, 2, 'the skip is one log line');
  await dailyBackup(pc, day(4, 17));
  assert.equal(calls.length, 2, 'a skipped day is not tried again');
});
