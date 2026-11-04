/* The mod's pure half: what the typed tools refuse before the
 * CLI is run, how the commands read their arguments, and the text they answer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginRoot } from '../lib/node-helpers.mjs';
import { childEnv, tempDir } from './helpers/sandbox.mjs';
import {
  ALIAS_MAX, bandSection, COMMAND, SUBCOMMANDS_LINE, USAGE, alertUrl, checkAlias, parseAskerdo, clampWords, decisionQuestions, decisionRow, tracksView,
  splitGetsCosts, askResult, bandModel, bandSurfaces, countTip, STAR,
  answerArgs, depthFrom, newlyWaiting, offTrackSlip, openSetText, parseAnswer, parseResume, parseTrack, heldText, NEEDS_TRACK, resumeLine,
  projectSlug, questionTable, shelfText, taskEditArgs, trackAlert, trackText, validateAsk,
  validateHandoff, waitingKeys, waitingToast, OPTION_TEXT, SLOTS, answerLabels, askPrompt, cardHref, recordHref,
  questionsHeader, questionsModel, pinnedSplit, slotLine, cardMeta, chipGroups, chipHeader, rowParts,
  DEPTH_MARKER, MAIN_MARKS, agentDenyReason, agentNote, agentStage, agentTokens, deliveryText, depthReading,
  guardChip, guardOf, guardText, handoffAlert, handoffGate, isStateNoteCall, mainDepthNote, mainOf, marksCrossed, marksFor, parseGuard,
  projectName, readingFrom, rememberKeys, stateNoteFrom, whereNames,
  agentChecks, firstTellingCard, flagLine, flagNote, footerOf, isHubShell, namesBoardId, replyChecks, receiptsOf,
  closedFinished, handedOn, inboxWaiting, laneNote, latestLane, tasksOfDispatch, homeGraph, callRows, callCard, cardText, agentsModel,
  aloneInTurn,
} from '../lib/mod-core.mjs';
import { freshBoard } from './helpers/board-db.mjs';

const ask = (over = {}) => ({
  name: 'store shape', ask: 'One file (a) or many files (b, my pick)?', gist: 'One file or many?', blocking: true,
  options: [{ type: 'a', option: 'one file' }, { type: 'b', option: 'many files' }], pick: 'b', ...over,
});

test("the pure half imports only the pure handoff check and the board's drawing, so the hooks module (no Node) can load it", () => {
  const read = (...p) => readFileSync(join(pluginRoot, ...p), 'utf8');
  const froms = (f) => (f.match(/^\s*import\s.*$/gm) || []).map((l) => l.replace(/^.*from\s*/, ''));
  const src = read('lib', 'mod-core.mjs');
  const check = read('lib', 'handoff-payload.mjs');
  const pure = [['server', 'handoff-text.mjs'], ['server', 'layout.mjs'], ['server', 'web', 'draw.mjs'], ['server', 'web', 'graph.mjs'], ['server', 'web', 'feed.mjs']].map((p) => read(...p));
  assert.deepEqual(froms(src), ["'./handoff-payload.mjs';", "'../server/layout.mjs';", "'../server/web/draw.mjs';", "'../server/web/graph.mjs';", "'../server/web/feed.mjs';"]);
  /* the handoff check shares the board's text checks */
  assert.deepEqual(froms(check), ["'../server/handoff-text.mjs';"]);
  for (const f of pure) assert.equal(/^\s*import\s/m.test(f), false);
  for (const f of [src, check, ...pure]) assert.equal(/\bprocess\.|require\(/.test(f), false);
});

test('ask: a whole payload passes, an option without a column gets it empty, and a composed pick token is stored as its letter', () => {
  const filled = ask().options.map((o) => ({ ...o, getsYou: '', costsYou: '' }));
  assert.deepEqual(validateAsk(ask()).payload, ask({ options: filled }));
  assert.equal(validateAsk(ask({ pick: '512b' })).payload.pick, 'b');
  assert.equal(validateAsk(ask({ pick: null })).payload.pick, null);
  assert.ok(validateAsk(ask({ options: undefined, pick: undefined })).payload, 'no options, no pick');
});

test('ask: the pick is required with lettered options and must name one', () => {
  assert.match(validateAsk(ask({ pick: undefined })).error, /pick is required/);
  assert.match(validateAsk(ask({ pick: 'c' })).error, /pick must name one of the options by its letter \(a, b\)/);
  assert.match(validateAsk({ name: 'n', gist: 'g', blocking: false, pick: 'a' }).error, /no lettered options/);
});

test('ask: letters, required fields, ids and unknown keys are refused by name', () => {
  const twice = validateAsk(ask({ options: [{ type: 'a', option: 'x' }, { type: 'a', option: 'y' }], pick: 'a' }));
  assert.match(twice.error, /"a" is used twice/);
  assert.match(validateAsk(ask({ options: [{ type: '1a', option: 'x' }], pick: null })).error, /one lowercase letter/);
  assert.ok(validateAsk(ask({ options: [{ type: '', option: 'a plain panel' }], pick: undefined })).payload);
  const e = validateAsk({ gist: '', blocking: 'yes', workstream: 'W1', gates: ['T-1', 'Q2'], thread: 'TH-3' }).error;
  for (const want of ['unknown field "thread"', 'name is required', 'ask is required', 'gist is required', 'blocking is required', 'workstream is a WS-n id', 'gates is a list of T-n ids']) {
    assert.ok(e.includes(want), want + ' in ' + e);
  }
});

test('ask: the result names the id, the scope, the tokens and the pick', () => {
  const t = askResult({ id: 'Q512', name: 'store shape', workstream: 'WS-11', track: 'TR-3', boardUrl: 'http://b/q/Q512', warnings: ['inherited WS-11'] },
    { letters: ['a', 'b'], pick: 'b' });
  assert.equal(t, 'Registered Q512 (store shape) under WS-11, TR-3; answer tokens 512a, 512b; pick 512b. Board: http://b/q/Q512\nNote: inherited WS-11');
  /* the result ends with the block to paste, opened by its header line, the table last */
  const block = tellBlock({ id: 'Q512', name: 'store shape', ask: 'One store (a) or two (b, my pick)?', crux: 'two writers', pick: 'b',
    revisits: ['Q84'], reverses: [{ id: 'Q84', name: 'the hide' }], options: [{ type: 'a', option: 'one' }, { type: 'b', option: 'two', costsYou: 'files' }] });
  const ls = block.split('\n').filter(Boolean);
  assert.ok(/^❓ Q512 \(store shape\)$/.test(ls[0]) && /Reversal of Q84 \(the hide\)/.test(ls[1]), block);
  assert.ok(ls.some((l) => l.includes('(512a)') && l.includes('(512b, my pick)')) && ls.includes('two writers'), block);
  assert.ok(ls.at(-1).startsWith('|512b *|two|') && ls.at(-2).startsWith('|512a|'), block);
  assert.ok(askResult({ id: 'Q512', name: 'store shape' }, { block }).endsWith('\n\n' + block));
});

const handoff = (over = {}) => ({
  focus: 'write the tests next', state: 'Done: the core.\nNext: tests.', verifyFirst: [{ path: 'C:/src/repo', branch: 'main' }], ...over,
});

test('handoff: the tool refuses what the CLI refuses (one shared check), and rulings pass', () => {
  const rulings = ['no session starts the next leg itself', { id: 'R1', registered: 'Q61' }];
  assert.deepEqual(validateHandoff(handoff({ track: 'TR-3', rulings })), { track: 'TR-3', workstream: undefined, payload: handoff({ rulings }) });
  /* a track's tasks carry where it stands, so the step and the task in hand are refused */
  assert.match(validateHandoff(handoff({ step: 'P-10/s3' })).error, /unknown field "step"/);
  /* a session resumed across an update sends its old names; the refusal says start a new one */
  assert.match(validateHandoff(handoff({ waitingOnOld: [] }), { version: '0.8.13' }).error, /AskerDo 0\.8\.13 does not take.*start a new session/);
  assert.match(validateHandoff(handoff({ track: 'T-3' })).error, /track is a TR-n id/);
  assert.match(validateHandoff(handoff({ state: 'x'.repeat(401) })).error, /state lines over 400 characters: line 1 \(401\)/);
  /* bytes, not characters: a two-byte letter counts twice */
  assert.match(validateHandoff(handoff({ state: '\u00e9'.repeat(5200) })).error, /state is 10400 bytes/);
  assert.match(validateHandoff(handoff({ state: 'a\n## Where we were\nb' })).error, /whereWeWere/);
  assert.match(validateHandoff(handoff({ focus: 'f'.repeat(401) })).error, /focus is 401 characters/);
  assert.match(validateHandoff(handoff({ rulings: [{ id: 'R1' }] })).error, /rulings\[0\]\.registered/);
  /* a leftover is named the board's way, its number from 1 and its name */
  const left = validateHandoff(handoff({ leftovers: [{ name: 'One', runBy: 'fork' }, { name: 'Fix the seam' }] })).error;
  assert.ok(/step 2\b/.test(left) && left.includes('Fix the seam') && !/\[1\]/.test(left), left);
  /* the user's ask in chat opens the gate below the window and leads whereWeWere */
  const chat = validateHandoff(handoff({ askedInChat: '"let\'s do a handoff and pick this up tomorrow"' }));
  assert.ok(chat.asked && chat.payload.whereWeWere.includes('let\'s do a handoff') && !('askedInChat' in chat.payload));
  assert.equal(handoffGate({ percent: 29, asked: chat.asked }).open, true);
  assert.match(handoffGate({ percent: 29, asked: false }).deny, /askedInChat/);
  assert.match(validateHandoff(handoff({ askedInChat: 'a\nb' })).error, /askedInChat/);
});

test('handoff: required fields, verify-first shape and the parked pair', () => {
  const e = validateHandoff({ verifyFirst: [{ path: 'relative', extra: 1 }], waitingOnUser: ['a\nb'], status: 'parked' }).error;
  for (const want of ['focus', 'state', 'verifyFirst[0] has unknown field "extra"', 'verifyFirst[0].path', 'waitingOnUser[0] is one line', 'a parked handoff needs parkReason']) {
    assert.ok(e.includes(want), want + ' in ' + e);
  }
  assert.match(validateHandoff(handoff({ verifyFirst: [] })).error, /verifyFirst is required/);
  assert.match(validateHandoff(handoff({ parkReason: 'x' })).error, /parkReason goes with status parked/);
  assert.ok(validateHandoff(handoff({ status: 'parked', parkReason: 'waits on the user' })).payload);
});

test('depth at handoff: nothing until the window reported, a whole percent after', () => {
  assert.equal(depthFrom(undefined), undefined);
  assert.equal(depthFrom({ context: { window: 200000 } }), undefined);
  assert.deepEqual(depthFrom({ context: { tokens: 90000, window: 200000 } }), { tokens: 90000 });
  assert.deepEqual(depthFrom({ context: { tokens: 90000, window: 200000, percent: 45.4 } }), { tokens: 90000, percent: 45 });
});

import { handoffCurrency, stepChanges, stepTool } from '../lib/mod-core.mjs';
test('a turn after the handoff asks for an update only when it changed state', () => {
  const live = { id: 'TR-4.126', status: 'waiting', turn: 't1' };
  const step = (tool, input = {}) => ({ tool, changes: stepChanges(tool, input, live.id) });
  const reads = [step('Read'), step('Grep'), step('Bash', { command: 'node ~/.claude/askerdo/cli.mjs show T-1' }), step('mcp__askerdo__note', { id: 'TR-4' })];
  const quiet = handoffCurrency(live, 't2', reads);
  assert.ok(!quiet.note && !quiet.slip, 'a read-only turn stays silent');
  for (const change of [step('Bash', { command: 'git add -- a && git commit -m "x" -- a' }), step('mcp__askerdo__task_update', { id: 'T-1' })]) {
    const c = handoffCurrency(live, 't2', [...reads, change]);
    assert.ok(c.note && c.at === reads.length && c.slip, change.tool);
  }
  assert.ok(!handoffCurrency(live, 't2', [...reads, step('Edit'), step('mcp__askerdo__handoff_update')]).slip, 'an update after the change clears it');
  /* a shell step counts unless every command in it reads; a flag before a hub verb is skipped */
  const cli = 'node ~/.claude/askerdo/cli.mjs ';
  for (const cmd of ["sed -i 's/a/b/' lib/x.mjs", 'cat > lib/x.mjs <<EOF\nx\nEOF', 'git checkout -- lib/x.mjs', cli + 'track mine TR-4']) {
    assert.ok(stepChanges('Bash', { command: cmd }, live.id), cmd);
  }
  for (const cmd of ['ls -la lib | head', 'grep -n "a|b" lib/x.mjs', 'git -C repo diff --stat && git status', cli + '--json list', cli + 'legacy']) {
    assert.ok(!stepChanges('Bash', { command: cmd }, live.id), cmd);
  }
  /* the CLI's handoff update is the update, as the tool is */
  const upd = { command: cli + 'handoff update TR-4' };
  assert.ok(!handoffCurrency(live, 't2', [...reads, step('Edit'), { tool: stepTool('Bash', upd), changes: stepChanges('Bash', upd, live.id) }]).slip, 'the CLI update clears it');
});

test('task_update maps to task update flags, the note riding the call, and refuses what the board would', () => {
  assert.deepEqual(taskEditArgs({ id: 'T-13', status: 'in_progress', addLabels: ['x'], note: 'started' }),
    { id: 'T-13', args: ['--status', 'in_progress', '--add-label', 'x', '--note', 'started'], starts: true });
  /* an agent tag starts the task, with the reason a task not ready needs */
  const a = taskEditArgs({ id: 'T-13', agent: 'api-builder', reason: 'the edge is wrong' });
  assert.deepEqual([a.starts, a.args.slice(0, 2), a.args.includes('the edge is wrong')], [true, ['--agent', 'api-builder'], true]);
  assert.match(taskEditArgs({ id: 'T-13', agent: 'x', status: 'completed' }).error, /agent/);
  assert.match(taskEditArgs({ id: 'T-13', status: 'blocked' }).error, /status is one of open, in_progress/);
  assert.match(taskEditArgs({ id: 'WS-1', status: 'open' }).error, /id is a T-n id/);
  assert.match(taskEditArgs({ id: 'T-1' }).error, /nothing to change/);
  assert.equal(taskEditArgs({ id: 'T-1', note: 'only a note' }).starts, false);
});

test('/askerdo routes on its first word: nothing, a token, a subcommand, else the usage', () => {
  assert.equal(COMMAND, 'askerdo');
  assert.deepEqual(parseAskerdo(''), { verb: 'open', args: '' });
  assert.deepEqual(parseAskerdo('   '), { verb: 'open', args: '' });
  assert.deepEqual(parseAskerdo('106b "files are the truth"'), { verb: 'answer', args: '106b "files are the truth"' });
  assert.deepEqual(parseAskerdo('Q106 b'), { verb: 'answer', args: 'Q106 b' });
  assert.deepEqual(parseAskerdo('106bc'), { verb: 'answer', args: '106bc' }, 'a malformed token gets the answer usage');
  assert.deepEqual(parseAskerdo('board'), { verb: 'board', args: '' });
  assert.deepEqual(parseAskerdo('track park "later"'), { verb: 'track', args: 'park "later"' });
  /* the old word says where its moves went */
  assert.ok(parseAskerdo('thread').error.includes('/askerdo track'));
  assert.deepEqual(parseAskerdo('park "waits on the release"'), { verb: 'park', args: '"waits on the release"' });
  assert.deepEqual(parseAskerdo('handoff'), { verb: 'handoff', args: '' });
  assert.deepEqual(parseAskerdo('resume TR-4'), { verb: 'resume', args: 'TR-4' });
  assert.deepEqual(parseAskerdo('Pane'), { verb: 'pane', args: '' });
  assert.deepEqual(parseAskerdo('questions'), { verb: 'questions', args: '' });
  /* help answers the list, which names the Guide tab */
  assert.deepEqual(parseAskerdo('help'), { verb: 'help', args: '' });
  assert.ok(USAGE.includes('/askerdo guide'));
  for (const bad of ['q', 'answer 106b', 'boards']) {
    const r = parseAskerdo(bad);
    assert.equal(r.verb, 'usage', bad);
    assert.ok(r.error.includes(USAGE), bad);
  }
  for (const verb of ['questions', 'board', 'track', 'park', 'handoff', 'resume', 'pane']) {
    assert.ok(SUBCOMMANDS_LINE.includes(verb), verb);
    assert.ok(USAGE.includes('/askerdo ' + verb), verb);
  }
});

test('the alias is a bare command word or nothing', () => {
  for (const ok of ['ad', 'q', 'ask-2', '9x', 'x'.repeat(ALIAS_MAX)]) assert.deepEqual(checkAlias(ok), { alias: ok }, ok);
  assert.deepEqual(checkAlias('  ad  '), { alias: 'ad' });
  for (const none of [undefined, null, '', '   ']) assert.deepEqual(checkAlias(none), { alias: '' });
  for (const [bad, why] of [['/ad', /no slash/], ['Ad', /lowercase/], ['a d', /lowercase/], ['-ad', /starting with/],
    ['a_d', /lowercase/], ['x'.repeat(ALIAS_MAX + 1), /at most 16/], [7, /text/]]) {
    assert.match(checkAlias(bad).error, why, String(bad));
  }
});

test('the mod reads the saved alias through scripts/mod-alias.mjs', (t) => {
  const home = tempDir('ttd-home-', t);
  const data = tempDir('askerdo-data-', t);
  mkdirSync(join(home, '.claude'), { recursive: true });
  const read = () => JSON.parse(execFileSync(process.execPath, [join(pluginRoot, 'scripts', 'mod-alias.mjs'), '--json'], {
    env: { ...childEnv(), HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_DATA: data }, encoding: 'utf8',
  }));
  assert.deepEqual(read(), { alias: '', presses: 'confirm' }, 'no config, no alias');
  writeFileSync(join(data, 'config.json'), JSON.stringify({ name: 'Probe' }));
  assert.deepEqual(read(), { alias: '', presses: 'confirm' }, 'a config saved before the option');
  /* the cards' press setting rides the same read */
  writeFileSync(join(data, 'config.json'), JSON.stringify({ name: 'Probe', alias: 'ad', answerPresses: 'once' }));
  assert.deepEqual(read(), { alias: 'ad', presses: 'once' });
  writeFileSync(join(data, 'config.json'), JSON.stringify({ name: 'Probe', alias: '/ad' }));
  assert.match(read().error, /no slash/, 'a hand edit the editor would refuse');
  /* queued answers kept in the same data folder by session, and carried over a /clear */
  const queue = (args, input) => JSON.parse(execFileSync(process.execPath, [join(pluginRoot, 'scripts', 'mod-queue.mjs'), ...args, '--json'], {
    env: { ...childEnv(), HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_DATA: data }, encoding: 'utf8', input,
  }));
  queue(['write', '--session', 's1'], JSON.stringify([{ id: 'Q106', letter: 'b', note: 'n', site: 'pane' }]));
  assert.deepEqual(queue(['read', '--session', 's1']).answers.map((a) => a.id + a.letter), ['Q106b']);
  queue(['write', '--session', 's2', '--lineage', 's1'], JSON.stringify(queue(['read', '--session', 's2', '--lineage', 's1']).answers));
  assert.deepEqual([queue(['read', '--session', 's1']).answers.length, queue(['read', '--session', 's2']).answers.length], [0, 1]);
});

test('/askerdo 106b reads the token, the spaced forms and an optional quoted note', () => {
  assert.deepEqual(parseAnswer('106b'), { id: 'Q106', letter: 'b', note: undefined });
  assert.deepEqual(parseAnswer('Q106 b "files are the truth"'), { id: 'Q106', letter: 'b', note: 'files are the truth' });
  assert.deepEqual(parseAnswer('106 a because'), { id: 'Q106', letter: 'a', note: 'because' });
  for (const bad of ['', 'b', '106', '106bc', 'Q106B']) assert.match(parseAnswer(bad).error, /Usage: \/askerdo 106b/, bad);
  /* each token in the line is its own answer; a quoted token stays note text */
  assert.deepEqual(parseAnswer('L1a L2a').more, [{ id: 'L2', letter: 'a', note: undefined }]);
  const two = parseAnswer('155a "like 154a" 156b because');
  assert.deepEqual([two.note, two.more.map((x) => [x.id, x.letter, x.note])], ['like 154a', [['Q156', 'b', 'because']]]);
  /* a later token takes the first's spaced forms, and a connector between tokens is no note */
  for (const line of ['155 a 156 b', 'Q155a and Q156 b', '155a, 156b']) {
    const r = parseAnswer(line);
    assert.deepEqual([r.note, r.more.map((x) => [x.id, x.letter, x.note])], [undefined, [['Q156', 'b', undefined]]], line);
  }
  assert.equal(parseAnswer('155a and 156b and why').more[0].note, 'and why');
});

test('the answer tool reads a board question or a kept label, a letter or a note, or a drop', () => {
  assert.deepEqual(answerArgs({ id: 'L2', pick: 'a' }), { id: 'L2', letter: 'a', note: undefined, drop: false });
  assert.equal(answerArgs({ id: '106', note: 'neither' }).id, 'Q106');
  for (const bad of [{ id: 'T-1', pick: 'a' }, { id: 'Q1' }, { id: 'Q1', pick: 'ab' }, { id: 'Q1', pick: 'a', drop: true }]) assert.ok(answerArgs(bad).error, JSON.stringify(bad));
});

test('/askerdo track and /askerdo resume read their subcommands', () => {
  assert.deepEqual(parseTrack(''), { sub: 'show' });
  assert.deepEqual(parseTrack('TR-4'), { sub: 'show', track: 'TR-4' });
  assert.deepEqual(parseTrack('new WS-11 "board mod core"'), { sub: 'new', workstream: 'WS-11', name: 'board mod core' });
  assert.deepEqual(parseTrack('park "after the merge"'), { sub: 'park', reason: 'after the merge' });
  assert.deepEqual(parseTrack('park TR-4 later'), { sub: 'park', track: 'TR-4', reason: 'later' });
  assert.deepEqual(parseTrack('finish'), { sub: 'finish' });
  assert.deepEqual(parseTrack('splinter T-41 the store fix'), { sub: 'splinter', at: 'T-41', name: 'the store fix' });
  assert.deepEqual(parseTrack('capture inbox an idea'), { sub: 'capture', inbox: true, name: 'an idea' });
  assert.deepEqual(parseTrack('pane'), { sub: 'pane' });
  for (const bad of ['new', 'new board', 'park', 'splinter', 'capture', 'bogus']) assert.ok(parseTrack(bad).error, bad);
  assert.deepEqual(parseResume(''), { sub: 'shelf' });
  assert.deepEqual(parseResume('WS-12'), { sub: 'resume', workstream: 'WS-12' });
  assert.match(parseResume('TR-x').error, /Usage: \/askerdo resume/);
  assert.deepEqual(parseResume('TR-4\nAfter you resume, read this.'), { sub: 'resume', track: 'TR-4', note: 'After you resume, read this.' });
  /* the three moves on a held track */
  assert.deepEqual(parseResume('TR-4 --take-over'), { sub: 'resume', track: 'TR-4', move: 'take over' });
  assert.deepEqual(parseResume('TR-4 --splinter the fix'), { sub: 'resume', track: 'TR-4', move: 'splinter', name: 'the fix' });
  assert.ok(parseResume('TR-4 --splinter').error);
  /* a resume block from before tracks: the thread's label, which the board resolves
     to its track */
  assert.deepEqual(parseResume('TH-4.95'), { sub: 'resume', track: 'TH-4' });
  assert.deepEqual(parseResume('TH-4 --take-over'), { sub: 'resume', track: 'TH-4', move: 'take over' });
  /* a started session's line runs the bare id or --read-only, never a move of a live
     lease */
  assert.deepEqual(['TR-4', 'TR-4 --read-only', 'TR-4 --take-over', 'TR-4 --splinter x'].map((a) => resumeLine('Task:\n/askerdo resume ' + a)), ['TR-4', 'TR-4 --read-only', '', '']);
});

test('the open set draws the crux and the filled slots of each option in order', () => {
  const q = { id: 'Q7', name: 'n', crux: 'speed or safety', options: [
    { type: 'a', option: 'x', getsYou: 'g', costsYou: '', headline: 'Plain words.', whyPick: 'fast', whyNot: 'slow', undo: 'easy' },
    { type: 'b', option: 'y', getsYou: 'h', costsYou: 'c' }] };
  const t = questionTable(q);
  assert.ok(t.includes('\nCrux: speed or safety\n'), t);
  assert.deepEqual(t.split('\n\n').pop().split('\n').map((l) => l.trim().replace(/:.*/, '')), ['- 7a', '- Why pick it', '- Why not', '- Undo'], t);
});

test('the open set draws decision tables with composed tokens and the pick marked', () => {
  const q = { id: 'Q512', name: 'store shape', blocking: true, workstream: 'WS-11', gist: 'One file\nor many?', pick: 'b',
    options: [{ type: 'a', option: 'one file', getsYou: 'simple', costsYou: 'a|b' }, { type: 'b', option: 'many', getsYou: 'isolation', costsYou: 'files' }] };
  assert.equal(questionTable(q), '**Q512 store shape** (blocking), WS-11\nOne file or many?\n\n|Type|Option|What happens|Catch|\n|-|-|-|-|\n'
    + '|512a|one file|simple|a\\|b|\n|512b *|many|isolation|files|');
  const text = openSetText([q, { id: 'Q513', name: 'naming', blocking: false }], { url: 'http://board/#p=x' });
  assert.ok(text.startsWith('2 open questions for this project, 1 blocking.'), text);
  assert.ok(text.includes('Answer with /askerdo <token> [note], for example /askerdo 512b.'), text);
  assert.ok(text.endsWith('Board: http://board/#p=x\n\n' + SUBCOMMANDS_LINE), text);
  assert.ok(openSetText([q, q, q], { limit: 1 }).includes('And 2 more: Q512 store shape, Q512 store shape.'));
  /* with no question, the band's calls and the handoffs' asks still wait on the user */
  const [call] = callRows([{ kind: 'override', record: 'k3', id: 'K-3', request: 3, text: 'Reword K-3 (1 record, 40 words)', summary: 'Reword K-3. Then more.',
    change: { field: 'Body', before: 'old words', after: 'new words' }, measure: '1 record, 40 words', workstreams: [{ id: 'WS-11', name: 'board' }], records: ['K-3'], url: '/override/3',
    presses: [{ label: 'Allow', verb: 'overrideDecide', input: { request: 3, decision: 'allow' }, does: 'rewrites K-3 now' }, { label: 'Keep', verb: 'overrideDecide', input: { request: 3, decision: 'keep' } }] }]);
  const page = 'http://localhost:1/x/override/3';
  const some = openSetText([], { calls: [{ ...call, link: page }], asks: [{ track: 'TR-8', text: 'pick the store' }] });
  assert.ok(!some.startsWith('Nothing waits') && ['Allow', '/askerdo allow K-3', 'TR-8', 'pick the store'].every((x) => some.includes(x)), some);
  /* the override row leads with its name, links its page, and leaves the tallies to the tooltip */
  assert.ok(/^- Override #3\b/m.test(some) && some.includes(page) && !some.includes('40 words'), some);
  assert.ok(openSetText([]).startsWith('Nothing waits'));
  /* the call's tooltip carries the measure, the workstream it touches and its page */
  const facts = cardText(callCard(call));
  assert.ok(['40 words', 'WS-11', '/override/3', 'rewrites K-3 now'].every((x) => facts.includes(x)), facts);
  assert.equal(call.short, 'Reword K-3.');
});

test('shelf and track lines: each shelf row with its resume command; a held track with its holder and the three moves', () => {
  assert.ok(!shelfText([]).includes('/askerdo resume'));
  const line = shelfText([{ track: 'TR-1', name: 'lane', state: 'parked', age: '1h', focus: 'Parked: pivot', parkReason: 'pivot', unpark: 'when T-5 seam guard completes', codeMoved: true }]);
  assert.ok(['/askerdo resume TR-1', 'pivot', 'when T-5 seam guard completes', 'code moved since'].every((w) => line.includes(w)), line);
  assert.equal(trackText({ held: false }), NEEDS_TRACK);
  assert.ok(trackText({ held: true, track: 'TR-2', name: 'x', text: '1 running', now: [{ id: 'T-4', agent: 'api-builder' }] }).includes('T-4 (api-builder)'));
  /* the holder by its PC and local times, never its session id or a raw stamp */
  const holder = { session: '506d78a7-0594', pc: 'PC-2', since: '2026-10-28T15:18:20+00:00', seen: '2026-10-28T16:01:00+00:00' };
  const held = heldText({ track: 'TR-2', holder, pc: 'pc-2' }, Date.parse('2026-10-28T17:00:00+00:00'));
  assert.ok(['this PC', '15:18', '16:01', '/askerdo resume TR-2 --splinter', '/askerdo resume TR-2 --take-over', '/askerdo resume TR-2 --read-only'].every((w) => held.includes(w)), held);
  assert.ok(!held.includes('506d78a7') && !held.includes('2026-10-28T'), held);
  assert.equal(held.split('today').length, 2, 'a second time on the same day drops its day (run 3): ' + held);
  const quiet = heldText({ track: 'TR-2', holder: { ...holder, quietSince: holder.seen }, pc: 'other' });
  assert.ok(quiet.includes('PC-2') && quiet.includes('quiet since'), quiet);
});

test('the project slug is the harness folder name for a project', () => {
  assert.equal(projectSlug('C:\\Demo\\tidewatch-lane'), 'C--Demo-tidewatch-lane');
  assert.equal(projectSlug('C:\\Users\\user\\.claude'), 'C--Users-user--claude');
});

/* ---- the Needs-you band ---- */

test('band: no question and nothing on the shelf is no model at all', () => {
  assert.equal(bandModel({ questions: [], shelfRows: [{ status: 'parked' }], sid: 's' }), null);
  assert.equal(bandModel(), null);
});

test('band: the model carries answer tokens, the pick, the overflow and the counts', () => {
  const qs = Array.from({ length: 8 }, (_, i) => ({ id: 'Q' + (100 + i), name: 'n\n' + i, blocking: i === 0,
    subscribers: ['s'], options: [{ type: 'a', option: 'x' }, { type: '', option: 'panel' }], pick: 'a' }));
  const m = bandModel({ questions: qs, shelfRows: [{ status: 'waiting' }, { status: 'parked' }], sid: 's' });
  assert.equal(m.questions.length, 6);
  assert.equal(m.more, 2);
  assert.equal(m.total, 8);
  assert.deepEqual(m.questions[0].answers, [{ letter: 'a', token: '100a', option: 'x', gets: '', catch: '' }]);
  assert.equal(m.questions[0].name, 'n 0');
  assert.equal(m.questions[0].mine, true);
  assert.equal(m.waiting, 1);
  /* the count line's card names what the count hides */
  assert.match(countTip(m), /^Q100 n 0 \(blocking\); Q101 n 1; .*; and 2 more$/);
});

test('band: newly waiting threads, none on the first read, a new handoff of a thread counts', () => {
  const rows = [{ thread: 'TH-1', handoff: 'TH-1.2', status: 'waiting' }, { thread: 'TH-2', handoff: 'TH-2.1', status: 'parked' }];
  assert.deepEqual(newlyWaiting(undefined, rows), []);
  const seen = waitingKeys(rows);
  assert.deepEqual(newlyWaiting(seen, rows), []);
  const next = [{ thread: 'TH-1', handoff: 'TH-1.3', status: 'waiting' }, { thread: 'TH-5', handoff: 'TH-5.1', status: 'waiting' }];
  assert.deepEqual(newlyWaiting(seen, next).map((r) => r.handoff), ['TH-1.3', 'TH-5.1']);
  /* a row the board marks as an import's history is not announced */
  const imported = [{ thread: 'TH-1', handoff: 'TH-1.3', status: 'waiting', history: true }, { thread: 'TH-5', handoff: 'TH-5.1', status: 'waiting' }];
  assert.deepEqual(newlyWaiting(seen, imported).map((r) => r.handoff), ['TH-5.1']);
});

test('off-track: work with no task in hand is flagged, but not in an onboarding run', () => {
  assert.equal(offTrackSlip({ dispatched: 1 }).id, 'off-track');
  assert.equal(offTrackSlip({ dispatched: 1, commits: 2, onboarding: true }), null);
});

test('alert: the loopback route from a board URL, and the track alert in the api/alert shape', () => {
  const secret = '0123456789abcdef0123456789abcdef';
  assert.equal(alertUrl('http://askerdo.localhost:53265/' + secret + '/#p=c%3A'), 'http://127.0.0.1:53265/' + secret + '/api/alert');
  assert.equal(alertUrl('http://askerdo.localhost:53265/' + secret + '/q/Q1'), 'http://127.0.0.1:53265/' + secret + '/api/alert');
  assert.equal(alertUrl('http://board/#p=proj'), null);
  assert.equal(alertUrl(undefined), null);
  const row = { track: 'TR-6', name: 'next line', focus: 'write\nthe tests' };
  /* the name leads; the context in names */
  assert.deepEqual(trackAlert(row, { project: 'proj', workstream: 'the board' }), { kind: 'track', title: 'next line is waiting: write the tests',
    where: 'next line', card: 'TR-6', whereNames: { project: 'proj', workstream: 'the board', track: 'next line' } });
  assert.equal(trackAlert({ track: 'TR-7', focus: 'f' }).title, 'TR-7 is waiting: f');
  assert.equal(trackAlert({ ...row, focus: 'x'.repeat(300) }).title.length, 120);
  assert.equal(waitingToast(row), 'TR-6 next line is waiting: write the tests. Resume it with /askerdo resume TR-6.');
});

test('the band section goes where the band draws', () => {
  assert.equal(bandSurfaces(['terminal']), true);
  assert.equal(bandSurfaces(['mobile', 'desktop']), true);
  assert.equal(bandSurfaces(['mobile']), false);
  assert.equal(bandSurfaces([]), false);
  assert.match(bandSection(), /write no names line/);
});

test('Tracks tab: the held card, the user\'s tracks first to pick up, the quiet one elsewhere, the parked apart', () => {
  const t = (id, state, more = {}) => ({ id, name: id, state, text: '1 running', now: [], ...more });
  const mine = { held: true, track: 'TR-2', workstream: 'WS-1', tracks: [
    t('TR-10', 'new'), t('TR-2', 'active', { now: [{ id: 'T-7', agent: 'fixer' }] }), t('TR-3', 'waiting', { handoff: { id: 'TR-3.2', status: 'waiting', focus: 'new\nline', waitingOnUser: ['Q5 the port', 'your look at the tray'] } }),
    t('TR-5', 'active', { quietSince: '2026-10-19T00:30:00+00:00' }), t('TR-9', 'parked', { parkReason: 'later', unpark: 'when Q12 the port is answered' }),
    t('TR-6', 'waiting', { handoff: { id: 'TR-6.1', status: 'resumed', waitingOnUser: ['an old wait, handed on'] } }),
  ] };
  const shelfRows = [{ track: 'TR-3', handoff: 'TR-3.2', state: 'waiting', age: '1h' }, { track: 'TR-20', name: 'far', state: 'waiting', workstream: 'WS-2', age: '3d' }];
  /* the tab's sections: the user's tracks lead the pick-up list, the quiet one runs elsewhere */
  const asks = { 'TR-20': [{ id: 'Q7', name: 'port', blocking: true }], 'TR-2': [{ id: 'Q8', name: 'look', blocking: false }] };
  const v = tracksView({ mine, shelfRows, asks, now: Date.parse('2026-10-19T13:30:00+00:00') });
  assert.deepEqual([v.held.id, v.pickup.map((x) => x.id), v.elsewhere.map((x) => [x.id, x.quiet]), v.parked.map((x) => x.id)],
    ['TR-2', ['TR-20', 'TR-3', 'TR-6', 'TR-10'], [['TR-5', true]], ['TR-9']]);
  /* a parked card names what opens it again, from the board's row */
  assert.ok(['later', 'when Q12 the port is answered'].every((w) => cardText(v.parked[0]).includes(w)), cardText(v.parked[0]));
  assert.deepEqual(v.pickup[1].waits, ['your look at the tray'], 'a line naming a question answered since waits no more');
  const slept = tracksView({ mine, shelfRows, asks: { ...asks, 'TR-3': [{ id: 'Q5', name: 'the port', snoozed: true }] } });
  assert.deepEqual(slept.pickup[1].waits, ['Q5 the port', 'your look at the tray'], 'a snoozed question still waits, as the kickoff reads it');
  /* a resumed handoff's waits were handed on; the head names the tracks it counts */
  assert.deepEqual([v.needsYou, v.bottom.parts[0].tone, v.pickup[2].waits], [3, 'amber', []]);
  assert.ok(['TR-2', 'TR-20 far', 'TR-3'].every((id) => v.bottom.parts[0].text.includes(id)) && !v.bottom.text.includes('TR-6'), v.bottom.text);
  /* holding a track, a press copies the command for a new session; holding none, it resumes here */
  assert.deepEqual([v.pickup[1].press.kind, v.elsewhere[0].press.command], ['copy', '/askerdo resume TR-5 --take-over']);
  const free = tracksView({ mine: { held: false }, shelfRows, asks });
  assert.deepEqual(free.pickup.map((x) => [x.id, x.press.kind, x.press.primary]), [['TR-20', 'resume', true], ['TR-3', 'resume', false]]);
  /* holding none, the shelf's workstreams' maps name the tracks other sessions run there */
  const others = [{ workstream: 'WS-2', view: { tracks: [{ id: 'TR-21', name: 'live', state: 'active', holder: { session: 's9' }, tasks: [] }] } }];
  assert.deepEqual(tracksView({ mine: { held: false }, shelfRows, others }).elsewhere.map((x) => [x.id, x.workstream, x.press]), [['TR-21', 'WS-2', null]]);
  /* a shelf track in the held workstream counts from the band's map, a far one from its own, while holding */
  const map = { workstream: 'WS-1', view: { tracks: [{ id: 'TR-4', state: 'waiting', done: 2, total: 4, now: [], readySet: [{ id: 'T-1' }] }] } };
  const far2 = [{ workstream: 'WS-2', view: { tracks: [{ id: 'TR-20', state: 'waiting', done: 1, total: 3, now: [], readySet: [{ id: 'T-2' }, { id: 'T-3' }] }] } }];
  const held = tracksView({ mine: { held: true, track: 'TR-2', workstream: 'WS-1', tracks: [] }, graph: map, others: far2,
    shelfRows: [{ track: 'TR-4', workstream: 'WS-1', state: 'waiting', done: 2, total: 4 }, { track: 'TR-20', workstream: 'WS-2', state: 'waiting', done: 1, total: 3 }] });
  assert.deepEqual(held.pickup.map((x) => [x.id, x.readySet.length]), [['TR-4', 1], ['TR-20', 2]]);
  assert.deepEqual([tracksView({}).total, !!tracksView({}).bottom.note], [0, true]);
  /* the held tile's workstream row and each id of its longest chain open their board pages */
  const local = 'http://127.0.0.1:5/' + 'a'.repeat(32) + '/local/';
  const chain = { workstream: 'WS-1', view: { tracks: [{ id: 'TR-2', state: 'active', done: 0, total: 3, now: [], readySet: [], critical: ['T-1', 'T-2', 'T-3'],
    tasks: [{ id: 'T-1', name: 'one' }, { id: 'T-2', name: 'two' }, { id: 'T-3', name: 'three' }] }] } };
  const tile = tracksView({ mine: { held: true, track: 'TR-2', workstream: 'WS-1', tracks: [] }, graph: chain, local }).held;
  const links = (lead) => tile.groups.flat().filter((r) => r.lead.icon === lead).flatMap((r) => r.lines.flat()).filter((p) => p.href).map((p) => p.href.split('/r/')[1]);
  assert.deepEqual([...new Set(links('ldFolder'))], ['WS-1']);
  assert.deepEqual(links('ldFlag'), ['T-1', 'T-2', 'T-3']);
});

test('pane: a focus wraps at spaces into two rows, then ends on a whole word with an ellipsis', () => {
  const focus = 'Fix the two Tidewatch tide chart review majors in parallel lanes (a gauge refused after a reset; the station map and API panel)';
  assert.equal(clampWords('short focus', 40), 'short focus');
  for (const width of [20, 33, 60]) {
    const out = clampWords(focus, width);
    assert.ok(out.endsWith('\u2026'), out);
    const kept = out.slice(0, -1).split(' ');
    /* every kept word is whole, in the focus's order */
    assert.deepEqual(kept, focus.split(' ').slice(0, kept.length));
    const rows = [];
    for (const word of out.split(' ')) {
      if (rows.length && rows[rows.length - 1].length + 1 + word.length <= width) rows[rows.length - 1] += ' ' + word;
      else rows.push(word);
    }
    assert.ok(rows.length <= 2 && rows.every((r) => r.length <= width), width + ': ' + JSON.stringify(rows));
  }
});

test('dialog: a gets/costs split becomes a table row; no split, no change', () => {
  assert.deepEqual(splitGetsCosts('Gets you: speed. Costs you: memory.'), { lead: '', gets: 'speed', costs: 'memory' });
  assert.deepEqual(splitGetsCosts('Cons: churn; Pros: simple'), { lead: '', gets: 'simple', costs: 'churn' });
  assert.equal(decisionRow('Fast path. **Upside:** quick | **Downside:** brittle'), 'Fast path. What happens: quick | Catch: brittle');
  assert.equal(splitGetsCosts('It costs: nothing much'), null);
  assert.equal(splitGetsCosts('Gets you: x. Costs you:'), null);
  assert.equal(decisionRow('Plain words.'), null);
  const qs = [{ question: 'Q?', header: 'H', multiSelect: false, options: [
    { label: 'A', description: 'Gets you: x. Costs you: y', preview: 'p' }, { label: 'B', description: 'plain' }] }];
  const out = decisionQuestions(qs);
  assert.deepEqual(out[0].options[0], { label: 'a A', description: 'What happens: x | Catch: y', preview: 'p' });
  assert.equal(out[0].options[1].description, 'plain');
  assert.equal(qs[0].options[0].description, 'Gets you: x. Costs you: y');
  assert.equal(decisionQuestions([{ question: 'Q?', options: [{ label: 'B', description: 'plain' }] }]), null);
  assert.equal(decisionQuestions(undefined), null);
  /* an already rewritten row is left as it is */
  assert.equal(decisionQuestions(out), null);
});

test('ask: a reversal beside another ask of the turn is named, its own rewording is not', () => {
  const rev = { id: 'Q577', revisits: ['Q41'], reversal: 'r' };
  assert.deepEqual(aloneInTurn({ revisits: ['Q41'], reversal: 'r' }, [{ id: 'Q512' }]), ['Q512']);
  assert.deepEqual(aloneInTurn({ edits: 'Q577', revisits: ['Q41'], reversal: 'r' }, [rev]), []);
  assert.deepEqual(aloneInTurn({ edits: 'Q512' }, [rev, rev]), ['Q577']);
});

test('ask: crux and the option slots are optional text, passed through as given', () => {
  assert.deepEqual(OPTION_TEXT, ['getsYou', 'costsYou', 'headline', 'whyPick', 'whyNot', 'undo']);
  const full = ask({ crux: 'two writers', options: [{ type: 'a', option: 'one', getsYou: 'simple', costsYou: '' },
    { type: 'b', option: 'many', headline: 'h', whyPick: 'p', whyNot: 'n', undo: 'one-way: a migration' }] });
  assert.deepEqual(validateAsk(full).payload, { ...full, options: [full.options[0], { ...full.options[1], getsYou: '', costsYou: '' }] });
  const e = validateAsk(ask({ crux: 1, options: [{ type: 'a', option: 'x', headline: 2, undo: null }], pick: 'a' })).error;
  for (const m of ['crux must be text', 'options[0].headline must be text', 'options[0].undo must be text']) assert.ok(e.includes(m), m);
});

test('questions pane: cards in the band order, rows with the pick starred, slots filled only, in order', () => {
  assert.deepEqual(SLOTS.map(([f]) => f), ['headline', 'whyPick', 'whyNot', 'undo']);
  const m = questionsModel({ more: 2, questions: [
    { id: 'Q106', name: 'store\nshape', blocking: true, gist: 'One or many?', crux: 'two writers', pick: 'b',
      boardUrl: 'http://askerdo.localhost:53265/abc/q/Q106',
      options: [{ type: 'a', option: 'one', getsYou: 'simple', costsYou: 'churn' },
        { type: 'b', option: 'many', getsYou: 'isolation', costsYou: '', undo: 'painful', headline: 'Each its own.', whyPick: ' ' },
        { type: '', option: 'a plain panel' }] },
    { id: 'Q107', name: 'small', blocking: false, options: [], track: 'TR-20', trackName: 'Settings in the pane', pc: 'laptop' },
  ] });
  assert.equal(questionsHeader(m), '4 open questions, 1 blocking');
  assert.equal(questionsHeader(questionsModel({})), 'No open questions for this session or blocking this project.');
  const [c, d] = m.cards;
  assert.equal(c.name, 'store shape');
  assert.equal(c.crux, 'two writers');
  assert.equal(d.crux, '');
  /* whose track and which PC; a narrow card clips the track's name before its PC */
  assert.deepEqual([d.track, d.trackName, d.pc, c.track, c.pc], ['TR-20', 'Settings in the pane', 'laptop', undefined, undefined]);
  const where = (cols) => cardMeta(d, cols).find((p) => p.where).text;
  assert.ok(where(165).includes('Settings in the pane') && !where(20).includes('Settings') && where(20).includes('laptop'));
  /* one group per track and PC in the cards' order, the viewer's PC "this PC", its track own */
  const near = { track: 'TR-20', trackName: 'Settings in the pane', pc: 'Desk PC ' };
  const g = questionsModel({ here: { pc: 'desk pc', track: 'TR-20' }, questions: [
    { id: 'Q1', name: 'one', ...near }, { id: 'Q2', name: 'two', track: 'TR-21', pc: 'laptop' }, { id: 'Q3', name: 'three', ...near }] });
  const groups = chipGroups(g.cards, g.here);
  assert.deepEqual(groups.map((x) => x.rows.map((c) => c.id)), [['Q1', 'Q3'], ['Q2']]);
  assert.deepEqual([groups[0].chips.pc.text, groups[0].chips.track.own, groups[1].chips.pc.text, groups[1].chips.track.own], ['this PC', true, 'laptop', false]);
  /* under the pinned card the held track's come first, oldest first, then the rest blockers first */
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  const o = questionsModel({ now: Date.now(), here: { track: 'TR-20' }, questions: [
    { id: 'Q9', name: 'pinned', track: 'TR-20' }, { id: 'Q5', name: 'old', track: 'TR-21', created: ago(90), away: true },
    { id: 'Q6', name: 'blocks', track: 'TR-22', blocking: true, created: ago(10), away: true }, { id: 'Q7', name: 'held', track: 'TR-20', created: ago(5) }] });
  assert.deepEqual(pinnedSplit(o.cards, undefined, o.here).rest.map((c) => c.id), ['Q7', 'Q6', 'Q5']);
  const away = questionsModel({ here: { track: 'TR-20' }, questions: [
    { id: 'Q6', name: 'blocks', blocking: true, away: true }, { id: 'Q7', name: 'held' }, { id: 'Q8', name: 'own blocker', blocking: true }] });
  assert.equal(pinnedSplit(away.cards, undefined, away.here).pinned.id, 'Q8', 'the default pin is its own blocker before one from elsewhere');
  /* the held track's own question pins over a blocker from another track the band also carries, its own blocker first */
  const mine = (more) => questionsModel({ here: { track: 'TR-20' }, questions: [
    { id: 'Q3', name: 'their blocker', track: 'TR-2', pc: 'laptop', blocking: true }, { id: 'Q4', name: 'held', track: 'TR-20' }, ...more] });
  assert.deepEqual([mine([]), mine([{ id: 'Q5', name: 'held blocker', track: 'TR-20', blocking: true }])].map((x) => pinnedSplit(x.cards, undefined, x.here).pinned.id), ['Q4', 'Q5']);
  /* chips drop whole as the room shrinks, the track's first; the name gives way before the id and age */
  assert.deepEqual([60, 12, 3].map((r) => chipHeader(groups[0], r).chips.map((c) => c.kind)), [['track', 'pc'], ['pc'], []]);
  const row = rowParts({ ...g.cards[0], name: 'a long name that cannot fit', age: '2h' }, 20);
  assert.ok(row.cut && row.id === 'Q1' && row.age === '2h');
  /* each stored line of the why and the stakes is one list item */
  const two = questionsModel({ questions: [{ id: 'Q1', name: 'n', gist: 'One file\nor many?', stakes: '**Cost:** a\n- migration' }] }).cards[0];
  assert.deepEqual([two.gist, two.stakes].map((t) => t.split('\n').filter((l) => /^- \S/.test(l)).length), [2, 2]);
  assert.equal(d.stakes, '');
  assert.equal(c.url, 'http://localhost:53265/abc/q/Q106');
  assert.equal(d.url, '');
  assert.deepEqual(c.options.map((o) => o.token), ['106a', '106b'], 'only lettered options get a row');
  assert.deepEqual(c.options.map((o) => [o.pick, o.gets, o.catch]), [[false, 'simple', 'churn'], [true, 'isolation', '']]);
  assert.deepEqual(c.options[0].slots, []);
  assert.deepEqual(c.options[1].slots.map(slotLine), ['Each its own.', 'Undo: painful']);
  assert.equal(askPrompt('503b'), 'Tell me more about 503b before I pick.');
});

test('the card link takes plain localhost, which the desktop links and the host guard answers', () => {
  assert.equal(cardHref('http://askerdo.localhost:53265/abc/q/Q1'), 'http://localhost:53265/abc/q/Q1');
  assert.equal(cardHref('http://127.0.0.1:5/abc/q/Q1'), 'http://localhost:5/abc/q/Q1');
  /* the desktop opens no other plain http: address, so no dead press draws */
  assert.equal(cardHref('http://192.0.2.20:8080/r/Q1'), '');
  assert.equal(cardHref(undefined), '');
  /* a LAN board's record goes through the local server's signed route; with none known, as is */
  const local = 'http://127.0.0.1:5/' + 'a'.repeat(32) + '/local/';
  assert.equal(recordHref(local, 'kq1', 'http://192.0.2.20:8080/r/kq1'), 'http://localhost:5/' + 'a'.repeat(32) + '/r/kq1');
  assert.deepEqual([recordHref('', 'kq1', 'http://192.0.2.20:8080/r/kq1'), recordHref('', 'kq1', 'https://b.test/r/kq1')], ['', 'https://b.test/r/kq1']);
});

test('band labels: the letter and option name where the one-question row fits, the letter alone where not', () => {
  const q = { id: 'Q106', name: 'store shape', pick: 'b', answers: [
    { letter: 'a', token: '106a', option: 'one file' }, { letter: 'b', token: '106b', option: 'many files' }] };
  assert.deepEqual(answerLabels(q, 100), ['a one file', STAR + ' b many files']);
  assert.deepEqual(answerLabels(q, 50), ['a', STAR + ' b']);
  assert.deepEqual(answerLabels(q, undefined), ['a', STAR + ' b']);
});

test('alerts: the handoff alert leads with the track name; whereNames keeps the four names, cut at 60', () => {
  const names = { project: 'Tidewatch', workstream: 'the gauges' };
  assert.deepEqual(handoffAlert({ name: 'mod core', track: 'TR-3', id: 'TR-3.5', percent: 31, focus: 'write\nthe tests', names }), {
    kind: 'handoff', title: 'mod core handed off at 31 percent: write the tests', where: 'mod core', card: 'TR-3.5',
    whereNames: { project: 'Tidewatch', workstream: 'the gauges', track: 'mod core' },
  });
  assert.equal(handoffAlert({ track: 'TR-3', id: 'TR-3.5', focus: 'f' }).title, 'TR-3 handed off: f');
  assert.deepEqual(whereNames({ project: 'x'.repeat(80), holds: '', extra: 'no' }), { project: 'x'.repeat(60) });
  assert.equal(projectName('C:\\Demo\\tidewatch\\'), 'tidewatch');
  assert.equal(projectName('/home/d/proj'), 'proj');
});

test('delivery: one note, and a bounded record of what was told', () => {
  assert.match(deliveryText(['x', 'y']), /\(not my words\):\n- x\n- y$/);
  assert.deepEqual(rememberKeys(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  assert.equal(rememberKeys(Array.from({ length: 400 }, (_, i) => 'k' + i), ['z']).length, 300);
  assert.equal(rememberKeys(undefined, ['z']).at(-1), 'z');
  /* the band counts what waits; an answer's hover line names its option */
  const waiting = inboxWaiting([{ key: 'k', line: 'Q20 (Who drives) was answered in another session: 20a.',
    raw: { kind: 'answer', id: 'Q20', name: 'Who drives', pick: 'a' } }], { Q20: [{ type: 'a', option: 'I drive it' }] });
  assert.deepEqual([waiting.n, waiting.answers], [1, true]);
  assert.match(waiting.lines[0], /20a, I drive it/);
  assert.equal(closedFinished('Shipped.\n\n\u{1F3C1} Done: nothing left.'), true);
  assert.equal(closedFinished('Shipped.\n\n\u{1F7E2} Next up: the tests.'), false);
});

test('meter: nothing below 30 percent, the window at 30, the insistence at 40, none before a reading', () => {
  assert.deepEqual(MAIN_MARKS.map((m) => m.percent), [30, 40]);
  assert.equal(depthReading({ window: 200000 }), null);
  assert.equal(depthReading(undefined), null);
  const at = (p) => depthReading({ percent: p, tokens: p * 10000, window: 1000000 });
  assert.deepEqual(marksCrossed(at(29.9), []), []);
  assert.deepEqual(marksCrossed(at(41), [30]).map((m) => m.percent), [40]);
  assert.deepEqual(marksCrossed(at(41), [30, 40]), []);
  const both = marksCrossed(at(45), []);
  const note = mainDepthNote(at(45), both);
  assert.match(note, /^CONTEXT DEPTH \(main session\): 450k tokens/);
  /* the mark's own note names it, once */
  assert.equal(note.split('40 percent wrap line').length, 2);
  assert.match(note, /40 percent wrap line: start nothing new/);
  /* a jump past both still carries the 30 mark's rule and doc pointer */
  assert.match(note, /Also first crossed now: .*30 percent mark: .*handoff-timing\.md/);
  const step = readingFrom({ input_tokens: 10, cache_read_input_tokens: 299990, cache_creation_input_tokens: 0 }, 1000000);
  assert.equal(step.tokens, 300000);
  assert.equal(step.percent, 30);
  assert.equal(readingFrom({ input_tokens: 5 }, undefined), null);
});

test('guard: off unless opted in, the defaults 350k and 450k, the band line either way', () => {
  assert.deepEqual(DEPTH_MARKER, { soft: 350000, hard: 450000, remind: 25000 });
  const MAIN = { on: true, window: 30, wrap: 40 };
  assert.deepEqual(guardOf(null), { on: false, main: MAIN });
  assert.deepEqual(guardOf({ on: false, source: null, guard: null }), { on: false, main: MAIN });
  const g = guardOf({ on: true, source: 'thread', guard: { soft: 'x', hard: 500000 } });
  assert.deepEqual(g, { on: true, source: 'thread', soft: 350000, hard: 500000, remind: 25000, hardDeny: false, main: MAIN });
  assert.equal(guardChip(undefined), null);
  assert.match(guardChip({ on: false }).tip, /off; press to turn on$/);
  assert.match(guardChip(guardOf({ on: true, source: 'project', guard: {} })).tip, /on, soft 350k hard 450k from this project; press to turn off$/);
  assert.equal(guardText({ on: false }), 'The agent guard is off for this project. Turn it on with /askerdo guard on.');
  assert.ok(guardText(g).startsWith('The agent guard is on for this thread'));
  /* the source is the profile and record the setting came from */
  const via = (level) => guardText(guardOf({ on: true, source: { profile: 'deep-code', record: 'WS-3', level }, guard: {} }));
  assert.ok(via('project').startsWith('The agent guard is on for this project:'));
  assert.ok(via('workstream').startsWith('The agent guard is on through deep-code on WS-3:'));
  assert.ok(via('default').startsWith('The agent guard is on everywhere (your default profile deep-code):'));
  assert.deepEqual(parseGuard(''), { sub: 'show' });
  assert.deepEqual(parseGuard(' ON '), { sub: 'on' });
  assert.ok(parseGuard('later').error.startsWith('Usage: /askerdo guard'));
  assert.deepEqual(parseAskerdo('guard off'), { verb: 'guard', args: 'off' });
});

test('meter: the marks follow the resolved main.window and main.wrap, and main.on off is read', () => {
  assert.deepEqual(marksFor({ window: 5, wrap: 10 }).map((m) => m.percent), [5, 10]);
  assert.deepEqual(marksFor({ window: 50, wrap: 20 }).map((m) => m.percent), [50, 51], 'a wrap below the window is moved past it');
  assert.deepEqual(marksFor(undefined), MAIN_MARKS);
  const mk = marksFor({ window: 5, wrap: 10 });
  const at = (p) => depthReading({ percent: p, tokens: p * 10000, window: 1000000 });
  assert.deepEqual(marksCrossed(at(12), [], mk).map((m) => m.percent), [5, 10]);
  assert.match(mk[0].note, /^The user's 5 percent mark: pick the handoff boundary/);
  assert.deepEqual(mainOf({ main: { on: false, window: 5, wrap: 10 } }), { on: false, window: 5, wrap: 10 });
  assert.deepEqual(guardOf({ on: false, main: { window: 5, wrap: 10 } }).main, { on: true, window: 5, wrap: 10 });
  /* told by kind; marks moved from 12/13 to 11/12 after the window was told give the wrap line, never the window twice */
  const kinds = (r, told, main) => marksCrossed(r, told, marksFor(main)).map((m) => m.kind);
  assert.deepEqual(kinds(at(12), [], { window: 12, wrap: 13 }), ['window']);
  assert.deepEqual(kinds(at(13), ['window'], { window: 11, wrap: 12 }), ['wrap']);
  assert.deepEqual(kinds(at(13), [], { window: 11, wrap: 12 }), ['window', 'wrap']);
  /* one floored whole percent, from the tokens when known, so 127911 of 1M is 12 even where the engine said 13 */
  const a10 = { percent: 12.79, tokens: 127911, window: 1000000 };
  assert.deepEqual([kinds(a10, ['window'], { window: 11, wrap: 13 }), kinds({ ...a10, percent: 13 }, ['window'], { window: 11, wrap: 13 })], [[], []]);
  assert.match(mainDepthNote(a10, marksFor({ window: 11, wrap: 13 }).slice(0, 1)), /\b12\b/);
});

test('guard: the agent stamp rule, and its notes with the CONTINUE ending', () => {
  const g = guardOf({ on: true, guard: {} });
  assert.equal(agentStage(349999, g, 0), null);
  assert.equal(agentStage(350000, g, 0), 'soft');
  assert.equal(agentStage(374000, g, 350000), null);
  assert.equal(agentStage(375000, g, 350000), 'soft');
  assert.equal(agentStage(451000, g, 440000), 'hard', 'the first past hard always');
  assert.equal(agentStage(460000, g, 451000), null);
  assert.equal(agentStage(500000, { on: false }, 0), null);
  assert.equal(agentTokens({ input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3, output_tokens: 9 }), 6);
  assert.equal(agentTokens(null), 0);
  const soft = agentNote('soft', { tokens: 360000, guard: g, note: 'C:/x/a-state.md' });
  const hard = agentNote('hard', { tokens: 455000, guard: g });
  const deny = agentDenyReason({ tokens: 455000, guard: g });
  assert.ok(soft.startsWith('CONTEXT DEPTH 360k tokens, past the soft limit of 350k'));
  assert.ok(soft.includes('about 90k tokens before the hard floor at 450k, after which this reminder turns urgent'));
  assert.ok(soft.includes('The state note you have been writing is C:/x/a-state.md.'));
  assert.ok(agentNote('soft', { tokens: 360000, guard: { ...g, hardDeny: true } }).includes('only the state note can be written'));
  assert.ok(hard.startsWith('URGENT: CONTEXT DEPTH 455k tokens, past the hard floor of 450k'));
  for (const t of [soft, hard, deny]) {
    assert.ok(t.includes('CONTINUE: <your state note path>'), t);
    assert.doesNotMatch(t, /\b(stop|cancel|abandon|abort|kill|terminate|halt|interrupt)\b/i);
    assert.doesNotMatch(t, /[\u2013\u2014]/);
  }
  assert.ok(isStateNoteCall('Write', { file_path: 'C:\\x\\Lane-State.md' }));
  assert.ok(!isStateNoteCall('Read', { file_path: 'a-state.md' }));
  assert.ok(!isStateNoteCall('Edit', { file_path: 'a.md' }));
  assert.equal(stateNoteFrom([{ toolUses: [{ tool: 'Write', input: { file_path: 'a-state.md' } }] },
    { toolUses: [{ tool: 'Edit', input: { file_path: 'b-state.md' } }, { tool: 'Bash', input: { command: 'x' } }] }]), 'b-state.md');
  assert.equal(stateNoteFrom(undefined), '');
});

/* ---- the first telling and the contract checks ---- */

const H = '\u{1F64B}', G = '\u{1F7E2}', OK = '\u2705';
const ON = { emdash: true, forecast: true };

test('the first telling is the pane card; a one-way undo says so in the catch (rule 15)', () => {
  const c = firstTellingCard({ id: 'Q512', name: 'store', blocking: true, crux: 'two writers', pick: 'b', boardUrl: 'http://x.localhost:5/q',
    options: [{ type: 'a', option: 'one', getsYou: 'simple', costsYou: '', undo: 'one-way: a rewrite' },
      { type: 'b', option: 'many', getsYou: 'isolation', costsYou: 'files', undo: 'one-way' }, { type: 'c', option: 'none', costsYou: 'one-way already' }] });
  assert.equal(c.crux, 'two writers');
  assert.deepEqual(c.options.map((o) => o.catch), ['one-way', 'files (one-way)', 'one-way already']);
  assert.equal(firstTellingCard({}), null);
  /* a LAN board's plain-http link goes through the local server's signed route */
  const lan = firstTellingCard({ id: 'Q512', key: 'kq512ab', boardUrl: 'http://192.0.2.7:17480/r/kq512ab' }, 's', Date.now(), 'http://askerdo.localhost:7777/' + 'a'.repeat(32) + '/');
  assert.ok(lan.url.startsWith('http://localhost:7777/') && lan.url.endsWith('/r/kq512ab'), lan.url);
  assert.ok(questionTable({ id: 'Q7', name: 'n', options: [{ type: 'a', option: 'x', undo: 'one-way' }], pick: 'a' }).includes('|7a *|x||one-way|'));
});

/* a reply with the question told in its emoji-led footer, the bullets right under */
import { hideTold, tellBlock } from '../lib/mod-core.mjs';
test('the desktop hide takes a question told in the footer with its bullets and table, and keeps the footer lead', () => {
  const a = ['\u{1f50e} \u{2600}\u{fe0f} \u{1f64b} **I\'ve filed Q1 (sample name length) on the e2e board for this check.**', '',
    '\u{1f64b} Needs you: **Should the sample record use a short name (1a, my pick) or a long name (1b)?**',
    '- **Test:** this is a sample question for the e2e check.',
    '- **Not blocking:** it\'s only a preference. If you leave it, nothing changes, because the pick isn\'t applied until you accept it.', '',
    '|type|option|what happens|catch|', '|-|-|-|-|', '|1a *|Short name|the record reads at a glance||', '|1b|Long name|the record says more|wraps on the band|', '',
    '\u{2753} **[1 open question](http://127.0.0.1:47960/r/z35ww76b)**: [Q1 (sample name length)](http://127.0.0.1:47960/r/z35ww76b)'].join('\n');
  /* these replies lost the header line, so the registered strings find the block; the gist bullets stay */
  const shown = hideTold(a, [{ id: 'Q1', name: 'sample name length', ask: 'Should the sample record use a short name (a, my pick) or a long name (b)?', options: [{ type: 'a' }, { type: 'b' }] }]);
  assert.ok(!/\b1[ab]\b|Should the sample/.test(shown) && shown.includes('Not blocking'), shown);
  assert.ok(shown.includes('\u{1f64b} Needs you') && shown.includes('filed Q1') && shown.includes('1 open question'), shown);
  /* the kept lead points at the card by the question's id, never a bare label */
  assert.ok(/\bQ1\b/.test(shown.split('\n').find((l) => l.includes('Needs you'))), shown);
  /* a reply with the label as a heading of its own, the question on the next line */
  const c = ['## \u{1f64b} Needs you:', '**L1 (sample color): Should the sample card be blue (L1a, my pick) or green (L1b)?**',
    '- **Test:** a sample question.', '', '|type|option|what happens|catch|', '|-|-|-|-|', '|L1a *|Blue|matches||', '|L1b|Green|stands out||'].join('\n');
  const label = hideTold(c, [{ id: 'L1', name: 'sample color', ask: 'Should the sample card be blue (a, my pick) or green (b)?', options: [{ type: 'a' }, { type: 'b' }] }]);
  assert.ok(!/L1a|Should the sample/.test(label) && /\bL1\b/.test(label), label);
  /* a reply with the crux glued under the ask, then the table */
  const g = ['\u{1f64b} Needs you: **Should the band draw short (2a, my pick) or tall (2b)?**', 'The box sits nearest the prompt.', '',
    '|type|option|what happens|catch|', '|-|-|-|-|', '|2a *|Short|fits||', '|2b|Tall|reads more||', '', 'Then the merge.'].join('\n');
  const glued = hideTold(g, [{ id: 'Q2', name: 'band height', ask: 'Should the band draw short (a, my pick) or tall (b)?', crux: 'The box sits nearest the prompt', options: [{ type: 'a' }, { type: 'b' }] }]);
  assert.ok(!/\b2[ab]\b|Should the band|nearest the prompt/.test(glued) && /Needs you.*\bQ2\b/.test(glued) && glued.includes('Then the merge'), glued);
  /* the pasted block hides from its header line through its table, whatever is inside it */
  const q = { id: 'Q542', name: 'the hide', ask: 'Cut from the header (a, my pick) or parse shapes (b)?', crux: 'Each new shape draws twice.', pick: 'a',
    revisits: ['Q84'], options: [{ type: 'a', option: 'Header' }, { type: 'b', option: 'Shapes' }] };
  const pasted = tellBlock(q).replace('Cut from', '**Q542 (the hide):** Cut from').replace('Each new', 'A line the reply put inside.\nEach new');
  const cut = hideTold('Done.\n\n\u{1f64b} **Needs you:** ' + pasted + '\n\n- **Why:** the reply\'s own gist\n\nThen the merge.', [{ ...q, name: 'the hide, reworded' }]);
  assert.ok(!/542[ab]|Cut from|draws twice|put inside|Reversal/.test(cut) && /Needs you.*\bQ542\b.*card/.test(cut), cut);
  assert.ok(cut.includes('own gist') && cut.includes('Then the merge') && cut.startsWith('Done.'), cut);
  /* a reply with neither the header nor a registered string is left as it was */
  assert.equal(hideTold('Done.\n\nThe band stays short.', [q]), 'Done.\n\nThe band stays short.');
});

import { closedInbox, commitsIn } from '../lib/mod-core.mjs';
test('engagement: a board id in a prompt and a hub CLI call; a shell call that commits', () => {
  assert.ok(namesBoardId('look at T-304') && namesBoardId('Q12?') && namesBoardId('TH-3.2'));
  assert.ok(!namesBoardId('a T-shirt and Q-tips'));
  assert.ok(isHubShell('node ~/.claude/askerdo/cli.mjs list') && isHubShell('node bin/askerdo.mjs show T-1'));
  assert.ok(!isHubShell('git status'));
  assert.ok(commitsIn('cd C:/x && git add -- a && git commit -m "T-1: a; b" -- a') && commitsIn('git -C C:/x merge --no-ff ws-11/lane'));
  assert.ok(commitsIn('git commit -m "docs: say when --dry-run helps"'), 'a flag in the message is not a flag');
  assert.ok(!['git log --grep commit', 'git merge --abort', 'git commit --dry-run', 'git merge-base a b', 'echo git commit', 'git merge --squash ws-11/lane'].some(commitsIn));
});

test('reply checks: dashes, the names line where the band draws, the footer; a raised hand and codes are never judged (design 4.6)', () => {
  assert.deepEqual(replyChecks({ answer: 'a \u2014 b', checks: ON }).map((s) => s.id), ['dash']);
  assert.deepEqual(replyChecks({ answer: 'a \u2014 b', checks: {} }), []);
  assert.deepEqual(replyChecks({ answer: 'x', all: 'y \u2013 z', checks: ON }).map((s) => s.id), ['dash']);
  const names = OK + ' **Done**\n\n\u2753 **[2 open questions](u)**: [Q1 a](u)';
  assert.deepEqual(replyChecks({ answer: names, checks: ON, band: true }).map((s) => s.id), ['names']);
  assert.deepEqual(replyChecks({ answer: names, checks: ON, band: false }), []);
  assert.deepEqual(replyChecks({ answer: 'There are no open questions.', checks: ON, band: true }).map((s) => s.id), ['names']);
  const stated = OK + ' ' + H + ' **Fixed**\n\n' + H + ' Needs you: the e2e run r06 waits on your look at T-304.';
  assert.deepEqual(replyChecks({ answer: stated, checks: { ...ON, ids: true } }), []);
  const off = OK + ' ' + G + ' **Fixed**\n\n## ' + H + ' Needs you: go?';
  assert.deepEqual(replyChecks({ answer: off, checks: ON }).map((s) => s.id), ['footer']);
  assert.equal(footerOf(off).glyph, H);
  assert.equal(footerOf('no footer here'), null);
  assert.deepEqual(replyChecks({ answer: off, checks: { forecast: false } }), []);
  /* a mid-arc status whose footer names the next step is no early handoff */
  const status = OK + ' ' + G + ' **Fixes landing**\n\nThe imported handoffs read back whole.\n\n' + G + ' Next up: the kickoff cut, then the pane chain.';
  assert.deepEqual(replyChecks({ answer: status, checks: ON, windowTold: false }), []);
  /* each answer delivered before the reply is named somewhere in the turn's text */
  const owed = receiptsOf([{ raw: { kind: 'answer', id: 'Q52', name: 'answer receipts', pick: 'a' } }, { raw: { kind: 'answer', id: 'Q53', name: 'mark', note: 'n' } }]);
  assert.deepEqual(replyChecks({ answer: 'Got 52a (answer receipts) and Q53.', receipts: owed }), []);
  const miss = replyChecks({ answer: 'done', all: ['Got 52a.', 'done'].join(' '), receipts: owed });
  assert.deepEqual(miss.map((s) => s.id), ['receipt']);
  assert.ok(miss[0].say.includes('Q53') && !miss[0].say.includes('52a'));
  /* a close's inbox id still unplaced flags unless the reply names it; the shell's Inbox line gives the ids */
  const shell = closedInbox('node ~/.claude/askerdo/cli.mjs track finish TR-7', ['TR-7 done.', 'Inbox (2): T-5 Docs (WS-1 Main); T-9 Fix (WS-1 Main).', 'Place each: ...'].join('\n'));
  assert.deepEqual(shell, { track: 'TR-7', ids: ['T-5', 'T-9'] });
  assert.deepEqual(replyChecks({ answer: 'T-5 waits on the user.', inbox: shell.ids }).map((s) => s.id + ' ' + s.say.includes('T-9') + s.say.includes('T-5')), ['inbox truefalse']);
  assert.equal(closedInbox('node ~/.claude/askerdo/cli.mjs track show TR-7', 'Inbox (1): T-5 a (WS-1 b).'), null);
  /* a line cut at ten says so, and the turn-end check reads the board's whole list */
  assert.equal(closedInbox('node ~/.claude/askerdo/cli.mjs track finish TR-7', 'Inbox (14): T-5 a (WS-1 b); and 13 more.').more, true);
});

test('agent checks: none with no rules in force, the state note and size rule by their profile keys; flag text', () => {
  const on = { rules: { 'dispatch.stateNote': true, 'dispatch.outputRule': true }, inject: false };
  assert.deepEqual(agentChecks({ prompt: 'Fix it.' }), [], 'no board, no rules, no checks');
  assert.deepEqual(agentChecks({ prompt: 'Fix it.', model: 'fable' }, on).map((s) => s.id), ['state', 'size']);
  assert.deepEqual(agentChecks({ prompt: 'Fix it.' }, { ...on, inject: true }).map((s) => s.id), ['state'], 'the injection carries the size rule');
  assert.deepEqual(agentChecks({ prompt: 'Fix it.' }, { ...on, rules: { 'dispatch.stateNote': false } }).map((s) => s.id), ['size']);
  assert.deepEqual(agentChecks({ prompt: 'Keep x-state.md. Final response under 2000 characters.' }, on), []);
  assert.deepEqual(agentChecks({ prompt: 'Read your brief: docs/briefs/lane-6.md. Reply in at most 300 words.' }, on), []);
  const slips = agentChecks({ prompt: 'x-state.md' }, on);
  assert.equal(flagLine('the dispatch of a', slips), 'AskerDo: the dispatch of a: the brief has no output-size rule. Flagged, not rewritten.');
  assert.ok(flagNote([{ what: 'your last reply', slips: [{ say: 'em or en dashes' }] }]).includes('your last reply: em or en dashes.'));
  /* the task's latest lane flags when it handed work on to another agent; a finished one, whatever its size, nothing */
  const ok = { prompt: 'Keep x-state.md. Final response under 2000 characters.' };
  const lane = (journal) => agentChecks(ok, { ...on, lanes: [{ task: 'T-7', ...latestLane(journal) }] }).map((s) => s.id);
  const past = laneNote(300000, 'Fix lane 3', handedOn('Leg 1 done.\nCONTINUE: docs/fix-state.md'));
  assert.deepEqual(lane(past), ['lane T-7']);
  assert.deepEqual(lane(laneNote(460000, 'big but done', handedOn('CONTINUE: none'))), []);
  /* a finished lane in other words is finished; a next step is not */
  assert.deepEqual(['CONTINUE: done; nothing left in this lane', 'CONTINUE: lane complete', 'CONTINUE: done with S2; S3 next'].map(handedOn), [false, false, true]);
  assert.deepEqual(lane([past, laneNote(200000, 'Fix lane 4', false)].join('\n\n')), []);
  const brief = ['Intro', '# Brief (T-10)', 'As T-11 did.'].join('\n');
  assert.deepEqual(tasksOfDispatch({ description: 'T-7 fix', prompt: 'Lane for T-8.\nSee T-9.' }, [brief]), ['T-7', 'T-8', 'T-10']);
});

test("agents: a running agent's time since its start reads in minutes, a finished one's run length stays", () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const list = [{ id: 'a1', job: 'Band lane', model: 'opus', calls: 3, start: now - 75000 },
    { id: 'a2', job: 'Review', model: 'opus', calls: 1, start: now - 600000, end: now - 590000, done: true }];
  const [run, done] = agentsModel(list, null, now).rows;
  assert.match(run.detail, /\b1m\b/);
  assert.match(done.detail, /\b10s\b/);
  assert.match(agentsModel(list, null, now + 3600000).rows[1].detail, /\b10s\b/);
});

test('the mod reads its contract section and check switches through scripts/mod-contract.mjs', (t) => {
  const home = tempDir('ttd-home-', t);
  const data = tempDir('askerdo-data-', t);
  mkdirSync(join(home, '.claude'), { recursive: true });
  const read = () => JSON.parse(execFileSync(process.execPath, [join(pluginRoot, 'scripts', 'mod-contract.mjs'), '--json'], {
    env: { ...childEnv(), HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_DATA: data }, encoding: 'utf8',
  }));
  assert.deepEqual(read(), { section: null, checks: null }, 'no saved options, no contract');
  writeFileSync(join(data, 'config.json'), JSON.stringify({ name: 'Probe', queue: 'hub', emdash: false }));
  const r = read();
  assert.deepEqual(r.checks, { emdash: false, forecast: true, weather: true, hub: true });
  assert.ok(r.section.startsWith('## Where the AskerDo mod runs'));
  assert.ok(r.section.includes("above the user's prompt") && r.section.includes('`ask` tool') && !('name' in r));
  assert.ok(r.surfaces.desktop.startsWith('### On the desktop app') && r.surfaces.terminal.startsWith('### On the terminal'), 'T-25: both sections, the mod picks one');
  assert.ok(r.surfaces.desktop.includes('hides it under the card') && r.surfaces.terminal.includes('full copy'), 'Q84: the mod\'s own asking lines ride');
});

test("Home with no track held draws the project's workstream the band carries, whole, and names the other", async () => {
  const { putRecord } = await import('../server/records.mjs');
  const t = await import('../server/verbs/tracks.mjs');
  const db = freshBoard();
  putRecord(db, { key: 'ws000001', kind: 'workstream', fields: { id: 'WS-1', key: 'ws000001', name: 'Board', status: 'open', labelHistory: ['WS-1 2026-10-25'] }, body: '' });
  const line = t.newTrack(db, { name: 'Main line', workstream: 'WS-1' }, 'cli');
  t.capture(db, { track: line.id, name: 'First step' }, 'cli');
  const graph = { workstream: 'WS-1', name: 'Board', view: t.workstreamView(db, { workstream: 'WS-1' }), layout: null, unheld: true, others: [{ id: 'WS-2', name: 'Inbox' }] };
  const mine = { held: false, track: null, workstream: null, tracks: [] };
  const gm = homeGraph({ graph, mine, local: true, columns: 60 });
  assert.deepEqual([gm.scope, gm.lines.map((l) => l.id)], ['all', [line.id]]);
  assert.ok(gm.picture && /WS-2/.test(gm.why), 'drawn, the note naming the other workstream');
  assert.equal(homeGraph({ graph: { ...graph, unheld: false }, mine, local: true }).lines.length, 0, "a held track's graph is never drawn for a session without one");
});

test('a completed review folds the code it covered into its diamond, and the legend lists a review mark only where the map draws it', async () => {
  const { runVerb } = await import('../server/verbs/index.mjs');
  const { putRecord } = await import('../server/records.mjs');
  const { graphLegend } = await import('../lib/mod-core.mjs');
  const t = await import('../server/verbs/tracks.mjs');
  const db = freshBoard();
  putRecord(db, { key: 'ws000001', kind: 'workstream', fields: { id: 'WS-1', key: 'ws000001', name: 'Board', status: 'open', labelHistory: ['WS-1 2026-10-25'] }, body: '' });
  const line = t.newTrack(db, { workstream: 'WS-1', name: 'Export' }, 'cli');
  const make = (name) => runVerb(db, 'createRecord', { name, description: 'd', track: line.id }, 'cli');
  const at = (h) => ({ session: 's1', now: new Date(2026, 10, 4, h) });
  const code = ['Export a file', 'Import it'].map(make);
  const review = make('Review the export');
  make('Release');
  code.forEach((c, i) => {
    runVerb(db, 'commitLink', { repo: 'r', sha: String(i + 1).repeat(40), task: c.id, via: 'message', at: at(8).now.toISOString(), added: 3, removed: 0 }, at(8));
    runVerb(db, 'editRecord', { id: c.id, status: 'completed' }, at(9));
  });
  const draw = () => homeGraph({ graph: { workstream: 'WS-1', view: t.workstreamView(db, { workstream: 'WS-1' }), layout: null },
    mine: { held: true, track: line.id, workstream: 'WS-1', tracks: [] }, local: true, columns: 52, pressed: review.id });
  const before = draw();
  assert.equal((before.picture.source.match(/class="bead"/g) || []).length, 2, 'two finished code tasks wait as beads');
  assert.ok(graphLegend(before.marks).some((m) => m.key === 'bead') && !graphLegend(before.marks).some((m) => m.key === 'reviewed'));
  runVerb(db, 'editRecord', { id: review.id, status: 'completed' }, at(11));
  const after = draw();
  assert.ok(!/class="bead"/.test(after.picture.source), 'what the review covered draws no bead');
  assert.deepEqual(after.pressed.covers.map((c) => c.id), code.map((c) => c.id), 'its press lists what it covered');
  assert.ok(after.picture.hits.some((h) => h.kind === 'review' && h.id === review.id), 'its diamond takes a press');
  const keys = graphLegend(after.marks).map((m) => m.key);
  assert.ok(keys.includes('reviewed') && !keys.includes('bead'), keys.join(','));
});

test("Home's strips each close their own card, and a wait on another line ends at each card's edge (in-app run 3)", async () => {
  const w = await import('../server/verbs/work.mjs');
  const t = await import('../server/verbs/tracks.mjs');
  const gr = await import('../server/verbs/graph.mjs');
  const db = freshBoard();
  const ws = w.createRecord(db, { kind: 'workstream', name: 'Board', description: 'd' }, 'cli');
  const task = (name) => w.createRecord(db, { kind: 'task', name, description: 'd', workstream: ws.id }, 'cli');
  const main = ['Web views', 'The look', 'Command file', 'The move', 'Release'].map(task);
  const side = ['Strips', 'Cards', 'Last web view'].map(task);
  const line = t.newTrack(db, { name: 'Main line', workstream: ws.id, tasks: [...main, ...side].map((x) => x.id) }, 'cli');
  main.forEach((x, i) => i && gr.addEdge(db, { task: x.id, on: main[i - 1].id, reason: 'o' }, 'cli'));
  const branch = t.splinter(db, { from: line.id, name: 'Before the look', park: false, tasks: side.map((x) => x.id) }, 'cli');
  side.forEach((x, i) => i && gr.addEdge(db, { task: x.id, on: side[i - 1].id, reason: 'o' }, 'cli'));
  gr.addEdge(db, { task: main[1].id, on: side[2].id, reason: 'the look after the web views' }, 'cli');
  const graph = { workstream: ws.id, name: 'Board', view: t.workstreamView(db, { workstream: ws.id }), layout: null };
  const gm = homeGraph({ graph, mine: { held: true, track: branch.id, workstream: ws.id, tracks: [] }, local: true, columns: 28 });
  assert.ok(gm.picture.strips > 2, 'drawn in strips: ' + gm.picture.strips);
  const src = gm.picture.source;
  const frames = [...src.matchAll(/<svg x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" viewBox="([-\d. ]+)"><rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)];
  assert.equal(frames.length, gm.picture.strips, 'every strip draws its own frame');
  for (const f of frames) {
    const [vx, vy, vw, vh] = f[1].split(' ').map(Number), [x, y, fw, fh] = f.slice(2).map(Number);
    assert.ok(x >= vx && x + fw <= vx + vw + 0.01 && y >= vy && y + fh <= vy + vh, 'a frame inside its strip, closed on every side: ' + f[0]);
  }
  const shared = src.slice(src.indexOf('<g id="hg">'), src.indexOf('</defs>'));
  assert.ok(!/stroke-dasharray="5 4"/.test(shared), 'the wait between lines is not in the drawing every strip shows');
  const leaving = shared.slice(shared.indexOf('data-task="' + side[2].id + '"'));
  assert.ok(leaving.slice(0, leaving.indexOf('</g>')).includes(main[1].id), 'the station it leaves names the far end');
});

test('the mark names this PC\'s version in both shapes; the board is behind only when older by number', async () => {
  const { statusModel, versionWords } = await import('../lib/mod-core.mjs');
  const mark = (elsewhere) => statusModel({ reading: { percent: 5 }, elsewhere, version: '0.8.10' }).mark;
  const away = mark({ blocking: 1, waiting: 0, questions: [{ id: 'Q7', name: 'port', blocking: true }] });
  assert.ok(mark({ blocking: 0, waiting: 0, questions: [] }).card.title.includes('0.8.10'));
  assert.ok(away.card.foot.includes('0.8.10'));
  /* 0.8.9 is older than 0.8.10, which a string compare gets wrong */
  assert.match(versionWords('0.8.10', '0.8.9').behind, /0\.8\.9.*0\.8\.10/);
  assert.match(versionWords('0.8.10', '0.8.8').board, /0\.8\.8/);
  for (const board of ['0.8.10', '0.9.0', 'unknown', undefined]) assert.equal(versionWords('0.8.10', board).behind, '', String(board));
});
