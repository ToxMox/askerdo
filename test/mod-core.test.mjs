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
  splitGetsCosts, askResult, bandModel, bandSurfaces, countTip, drawnText, STAR,
  answerArgs, depthFrom, newlyWaiting, offTrackSlip, openSetText, parseAnswer, parseResume, parseTrack, heldText, NEEDS_TRACK, resumeLine,
  filedWords, projectSlug, shelfText, taskEditArgs, trackAlert, trackText, validateAsk,
  validateHandoff, waitingKeys, waitingToast, OPTION_TEXT, SLOTS, answerLabels, askPrompt, cardHref, recordHref,
  questionsHeader, questionsModel, pinnedSplit, slotLine, cardMeta, chipGroups, chipHeader, rowParts,
  DEPTH_MARKER, MAIN_MARKS, agentDenyReason, agentNote, agentStage, agentTokens, deliveryText, depthReading,
  guardChip, guardOf, guardText, handoffAlert, handoffGate, isStateNoteCall, mainDepthNote, mainOf, marksCrossed, marksFor, parseGuard,
  projectName, readingFrom, rememberKeys, stateNoteFrom, whereNames,
  agentChecks, firstTellingCard, flagLine, flagNote, footerOf, isHubShell, namesBoardId, replyChecks, receiptsOf,
  closedFinished, continueLineOf, handedOn, blockSettled, settleWords, reportsIn, dispatchRunBlock, replyAsks, isHubTaskWrite, isHubFactWrite, forgedFiling, hubAnswers, namesQuestion, userMarked, inboxWaiting, runEndHow, heldOver, heldWaitOf, laneNote, latestLane, tasksOfDispatch, dispatchMissed,homeGraph, callRows, callCard, cardText, agentsModel, flightsRebuilt,
  leftCalls, leftNote, paneMeasure, bgRebuilt, flightsKept, backgroundModel, runningNames, statusModel, hubRan,
  taskBlocks, withDecisions, decisionsBlock, decisionNote, pointerNotes, pointerToast, heldTrack, overrideCard, overrideTold,
} from '../lib/mod-core.mjs';
import { overBudget, overLine, updateProblems } from '../lib/handoff-payload.mjs';
import { freshBoard } from './helpers/board-db.mjs';

const ask = (over = {}) => ({
  name: 'store shape', ask: 'One file (a) or many files (b, my pick)?', gist: 'One file or many?', blocking: true,
  options: [{ type: 'a', option: 'one file' }, { type: 'b', option: 'many files' }], pick: 'b', ...over,
});

test("the pure half imports only pure modules (the handoff check, the board's drawing, the left-undone matcher, the command splitter), so the hooks module (no Node) can load it", () => {
  const read = (...p) => readFileSync(join(pluginRoot, ...p), 'utf8');
  const froms = (f) => (f.match(/^\s*import\s.*$/gm) || []).map((l) => l.replace(/^.*from\s*/, ''));
  const src = read('lib', 'mod-core.mjs');
  const check = read('lib', 'handoff-payload.mjs');
  const pure = [['server', 'handoff-text.mjs'], ['server', 'web', 'draw.mjs'], ['server', 'web', 'feed.mjs'], ['lib', 'left-undone.mjs'], ['lib', 'proc-match.mjs'], ['lib', 'sender-words.mjs']].map((p) => read(...p));
  assert.deepEqual(froms(src), ["'./handoff-payload.mjs';", "'../server/web/draw.mjs';", "'../server/web/graph.mjs';", "'../server/web/picture-model.mjs';", "'../server/web/picture-draw.mjs';", "'../server/web/feed.mjs';", "'./left-undone.mjs';", "'./proc-match.mjs';", "'./sender-words.mjs';"]);
  /* the handoff check shares the board's text checks; the picture's two modules the board's drawing */
  assert.deepEqual(froms(check), ["'../server/handoff-text.mjs';"]);
  const picture = [read('server', 'web', 'graph.mjs'), read('server', 'web', 'picture-model.mjs'), read('server', 'web', 'picture-draw.mjs')];
  assert.deepEqual(picture.map(froms), [[], ["'./graph.mjs';"], ["'./draw.mjs';"]]);
  /* the left-undone matcher reads the board's routing words from the pure handoff text */
  /* the feed words a task's run with the drawing's leftWords, as picture-draw does */
  pure.forEach((f, i) => assert.deepEqual(froms(f), i === 3 ? ["'../server/handoff-text.mjs';"] : i === 2 ? ["'./draw.mjs';"] : []));
  pure.push(...picture);
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
  focus: 'write the tests next', goal: 'the core and its tests', state:'Done: the core.\nNext: tests.', verifyFirst: [{ path: 'C:/src/repo', branch: 'main' }], ...over,
});

test('handoff: the tool refuses what the CLI refuses (one shared check), and rulings pass', () => {
  const rulings = ['no session starts the next leg itself', { id: 'R1', registered: 'Q61' }];
  assert.deepEqual(validateHandoff(handoff({ track: 'TR-3', rulings })), { track: 'TR-3', workstream: undefined, payload: handoff({ rulings }) });
  /* a track's tasks carry where it stands, so the step and the task in hand are refused */
  assert.match(validateHandoff(handoff({ step: 'P-10/s3' })).error, /unknown field "step"/);
  /* a session resumed across an update sends its old names; the refusal says start a new one */
  assert.match(validateHandoff(handoff({ waitingOnOld: [] }), { version: '0.8.13' }).error, /AskerDo 0\.8\.13 does not take.*start a new session/);
  assert.match(validateHandoff(handoff({ track: 'T-3' })).error, /track is a TR-n id/);
  /* a long bullet wraps under itself, twice if need be; a fenced line and one long word pass whole */
  const state = 'Done:\n- ' + 'a clause, '.repeat(90).trim() + '\n```\n' + 'y'.repeat(450) + '\n```\n' + 'z'.repeat(450);
  const wrapped = validateHandoff(handoff({ state }));
  const lines = wrapped.payload.state.split('\n');
  assert.equal(wrapped.wrapped, 1);
  assert.ok(lines.length >= 8 && lines[1].startsWith('- ') && lines[2].startsWith('  ') && lines[3].startsWith('  '));
  assert.ok(lines.every((l) => l.length <= 400 || /^(y+|z+)$/.test(l)));
  assert.equal(wrapped.payload.state.split(/\s+/).join(' '), state.split(/\s+/).join(' '));
  assert.match(validateHandoff(handoff({ state: 'a\n## Where we were\nb' })).error, /whereWeWere/);
  /* a field over its budget passes the check, and the stored handoff's line names the patch for each */
  const big = handoff({ focus: 'f'.repeat(450), state: '\u00e9'.repeat(5200), whereWeWere: 'w'.repeat(5000) });
  assert.equal(validateHandoff(big).error, undefined);
  const over = overBudget(big);
  assert.deepEqual(over.map((x) => x.field), ['focus', 'state', 'whereWeWere']);
  /* bytes, not characters: a two-byte letter counts twice */
  assert.ok(over[1].size.startsWith('10400'));
  const fix = overLine(over, 'TR-9');
  assert.ok(['"op": "focus"', '"op": "state"', '"op": "whereWeWere"', 'TR-9'].every((s) => fix.includes(s)), fix);
  assert.equal(overLine(overBudget(handoff()), 'TR-9'), '');
  assert.equal(updateProblems({ ops: [{ op: 'focus', text: 'f'.repeat(300) }, { op: 'whereWeWere', text: 'shorter' }] }).length, 0);
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
  for (const want of ['focus', 'goal', 'state', 'verifyFirst[0] has unknown field "extra"', 'verifyFirst[0].path', 'waitingOnUser[0] is one line', 'a parked handoff needs parkReason']) {
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
  for (const change of [step('Bash', { command: 'git add -- a && git commit -m "x" -- a' }), step('mcp__askerdo__task_update', { id: 'T-1' }),
    step('mcp__askerdo__place', { tier: 2 }), step('mcp__askerdo__fact', { title: 't' })]) {
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
  assert.deepEqual(taskEditArgs({ id: 'T-13', inHand: true, addLabels: ['x'], note: 'started' }),
    { id: 'T-13', args: ['--in-hand', '--add-label', 'x', '--note', 'started'], starts: true });
  /* the board stores three statuses: each old word is refused before the board, naming the call that fits */
  assert.match(taskEditArgs({ id: 'T-13', status: 'in_progress' }).error, /inHand.*agent/);
  for (const s of ['blocked', 'deferred']) assert.match(taskEditArgs({ id: 'T-13', status: s }).error, /open/);
  /* the dispatch opens an agent's run, so the agent tag is gone; runEnded ends the session's own run and leaves the task open */
  assert.match(taskEditArgs({ id: 'T-13', agent: 'api-builder' }).error, /unknown field "agent"/);
  assert.deepEqual([taskEditArgs({ id: 'T-13', runEnded: 'handed_on' }).runEnded, !!taskEditArgs({ id: 'T-13', runEnded: 'handed_on', status: 'done' }).error,
    !!taskEditArgs({ id: 'T-13', runEnded: 'finished' }).error], ['handed_on', true, true]);
  /* a done step takes a word, as the tool's schema offers */
  assert.deepEqual([taskEditArgs({ id: 'T-13', checks: { done: [1, { step: 3, word: 'read in the log' }] } }).args,
    !!taskEditArgs({ id: 'T-13', checks: { done: [{ step: 3 }] } }).error], [['--check-done', '1', '--check-done', '3: read in the log'], true]);
  /* a step's move rides stdin as --move-steps, so it goes in its own call beside a close's leftovers */
  const mv = taskEditArgs({ id: 'T-13', moveSteps: [{ check: 2, onto: 'T-5' }] });
  assert.deepEqual([mv.args, JSON.parse(mv.stdin)], [['--move-steps'], [{ check: 2, onto: 'T-5' }]]);
  assert.match(taskEditArgs({ id: 'T-13', status: 'done', moveSteps: [{ check: 2, onto: 'T-5' }], leftovers: [{ check: 3, runBy: 'fork' }] }).error, /moveSteps and leftovers/);
  /* a move the board asks of the user carries here, its real place on the held track */
  const asked = { check: 2, runBy: 'fork', tier: 3, track: 'TR-2', whyElsewhere: 'the tray owns it', here: { before: ['T-9'] } };
  assert.deepEqual([JSON.parse(taskEditArgs({ id: 'T-13', moveSteps: [asked] }).stdin)[0].here, !!taskEditArgs({ id: 'T-13', moveSteps: [{ ...asked, here: { at: 'T-9' } }] }).error],
    [{ before: ['T-9'] }, true]);
  /* the board's third wake answers asked as the question object */
  assert.match(filedWords([{ id: 'T-4', inbox: true, wake: 'next-session', asked: { id: 'Q-7', key: 'k', name: 'n', ask: 'a?' } }]), /with the user as Q-7\)/);
  /* a take-over rides a take in hand or a close, never alone */
  assert.deepEqual([taskEditArgs({ id: 'T-13', inHand: true, takeOver: true }).args, !!taskEditArgs({ id: 'T-13', takeOver: true }).error,
    taskEditArgs({ id: 'T-13', status: 'done', takeOver: true }).args.includes('--take-over')], [['--in-hand', '--take-over'], true, true]);
  assert.match(taskEditArgs({ id: 'WS-1', status: 'open' }).error, /id is a T-n id/);
  assert.match(taskEditArgs({ id: 'T-1' }).error, /nothing to change/);
  assert.equal(taskEditArgs({ id: 'T-1', note: 'only a note' }).starts, false);
});

test("a close, or a note, naming something left with no leftover filed is flagged, by tool or hub shell", () => {
  const flagged = (tool, input, status) => leftCalls(tool, input).map((h) => leftNote(h, status)).filter(Boolean);
  const close = flagged('mcp__askerdo__task_update', { id: 'T-917', status: 'done', note: 'Works; not measured on the real logon task.' });
  assert.equal(close.length, 1);
  assert.ok(close[0].includes('T-917') && close[0].includes('not measured'));
  /* leftovers filed with it, a done note, a start, and a note on an open task stay quiet */
  assert.deepEqual(flagged('mcp__askerdo__task_update', { id: 'T-917', status: 'done', note: 'not measured', leftovers: [{ name: 'Measure it', runBy: 'fork' }] }), []);
  assert.deepEqual(flagged('mcp__askerdo__task_update', { id: 'T-917', status: 'done', note: 'Measured at 238 and 1400 px.' }), []);
  assert.deepEqual(flagged('mcp__askerdo__task_update', { id: 'T-917', inHand: true, note: 'left open for now' }), []);
  assert.equal(flagged('mcp__askerdo__note', { id: 'T-917', body: 'Known limit: the virtual switch.' }, 'done').length, 1);
  /* a note on an open record names the calls that give it a home, never on a done note; a task update's note on an
     open task, or a why-it-waits note after a held stop, stays quiet */
  const open = flagged('mcp__askerdo__note', { id: 'WS-11', body: 'The cache split is for later.' });
  assert.ok(open.length === 1 && ['checks.add', 'place', 'ask', 'fact'].every((w) => open[0].includes(w)));
  assert.equal(flagged('mcp__askerdo__note', { id: 'T-917', body: 'Known limit: the virtual switch.' }, 'open').length, 1);
  assert.deepEqual(flagged('mcp__askerdo__note', { id: 'T-917', body: 'Built the band; tests green.' }, 'open'), []);
  assert.deepEqual(flagged('mcp__askerdo__task_update', { id: 'T-917', note: 'not measured' }, 'open'), []);
  assert.deepEqual(leftCalls('mcp__askerdo__note', { id: 'T-917', body: 'the next session merges it' }).map((h) => leftNote(h, 'open', true)), [null]);
  /* the hub CLI from either shell: a track finish's outcome, and a close that sends its leftovers on stdin */
  const track = flagged('Bash', { command: 'node ~/.claude/askerdo/cli.mjs track finish TR-39 --outcome "the look is left for the user to check" --session s1' });
  assert.ok(track.length === 1 && track[0].includes('TR-39') && track[0].includes('for the user to check'));
  const stdin = "@'\n[{\"name\":\"Measure it\",\"runBy\":\"fork\"}]\n'@ | node C:/x/askerdo/cli.mjs task update T-5 --status completed --note 'not measured' --leftovers";
  assert.deepEqual(flagged('PowerShell', { command: stdin }), []);
  assert.deepEqual(flagged('Bash', { command: 'git commit -m "T-5: not measured"' }), []);
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

test('the open set draws one line per question with its tokens and the pick marked, never a table', () => {
  const q = { id: 'Q512', name: 'store shape', blocking: true, workstream: 'WS-11', gist: 'One file\nor many?', pick: 'b',
    options: [{ type: 'a', option: 'one file', getsYou: 'simple', costsYou: 'a|b' }, { type: 'b', option: 'many', getsYou: 'isolation', costsYou: 'files' }] };
  const text = openSetText([q, { id: 'Q513', name: 'naming', blocking: false }], { url: 'http://board/#p=x' });
  const lines = text.split('\n').filter((l) => /^- Q51[23] /.test(l));
  assert.deepEqual([lines.length, /512a.*512b \*/.test(lines[0]), text.includes('|512'), text.includes('isolation')], [2, true, false, false], text);
  assert.ok(text.startsWith('2 open questions for this project, 1 blocking.'), text);
  assert.ok(text.includes('for example /askerdo 512b.'), text);
  assert.ok(text.endsWith('Board: http://board/#p=x\n\n' + SUBCOMMANDS_LINE), text);
  assert.ok(openSetText([q, q, q], { limit: 1 }).includes('And 2 more: Q512 store shape, Q512 store shape.'));
  /* with no question, the band's calls and the handoffs' asks still wait on the user */
  const [call] = callRows([{ kind: 'override', record: 'k3', id: 'K-3', request: 3, text: 'Reword K-3 (1 record, 40 words)', summary: 'Reword K-3. Then more.',
    change: { field: 'Body', before: 'old words', after: 'new words' }, measure: '1 record, 40 words', workstreams: [{ id: 'WS-11', name: 'board' }], records: ['K-3'], url: '/override/3',
    presses: [{ label: 'Fix', verb: 'overrideDecide', input: { request: 3, decision: 'allow' }, does: 'rewrites K-3 now' }, { label: 'Keep', verb: 'overrideDecide', input: { request: 3, decision: 'keep' } }] }]);
  const page = 'http://localhost:1/x/override/3';
  const some = openSetText([], { calls: [{ ...call, link: page }], asks: [{ track: 'TR-8', text: 'pick the store' }] });
  assert.ok(!some.startsWith('Nothing waits') && ['Fix', '/askerdo fix K-3', 'TR-8', 'pick the store'].every((x) => some.includes(x)), some);
  /* the override row leads with its name, links its page, and leaves the tallies to the tooltip */
  assert.ok(/^- Override #3\b/m.test(some) && some.includes(page) && !some.includes('40 words'), some);
  assert.ok(openSetText([]).startsWith('Nothing waits'));
  /* the call's tooltip carries the measure, the workstream it touches and its page */
  const facts = cardText(callCard(call));
  assert.ok(['40 words', 'WS-11', '/override/3', 'rewrites K-3 now'].every((x) => facts.includes(x)), facts);
  assert.equal(call.short, 'Reword K-3.');
  /* a withdraw of an undone import's rulings and facts leads with what it holds, the facts not called rulings */
  const mixed = (sections) => overrideCard(overrideTold({ request: 4, kind: 'withdraw', records: ['K-1', 'K-2', 'K-4'], reversal: true, measure: { sections } })).lead;
  assert.ok(/knowledge record/.test(mixed({ rulings: 2, facts: 1 })) && /2 rulings/.test(mixed({ rulings: 2, facts: 1 })) && /3 rulings/.test(mixed({ rulings: 3 })), mixed({ rulings: 2, facts: 1 }));
});

test('shelf and track lines: each shelf row with its resume command; a held track with its holder and the three moves', () => {
  assert.ok(!shelfText([]).includes('/askerdo resume'));
  const line = shelfText([{ track: 'TR-1', name: 'lane', state: 'parked', age: '1h', focus: 'Parked: pivot', parkReason: 'pivot', unpark: 'when T-5 seam guard completes', codeMoved: true }]);
  assert.ok(['/askerdo resume TR-1', 'pivot', 'when T-5 seam guard completes', 'code moved since'].every((w) => line.includes(w)), line);
  assert.equal(trackText({ held: false }), NEEDS_TRACK);
  /* the Now line names each task with its word and who runs it */
  const now = trackText({ held: true, track: 'TR-2', name: 'x', text: '1 running', now: [{ id: 'T-4', agent: 'api-builder', word: { is: 'running', worker: 'agent', job: 'api-builder' } }] });
  assert.ok(/Now: T-4 \(running.*api-builder/.test(now), now);
  /* a task its agent finished arrives in the ready set alone, ready to settle, and is listed once */
  const settle = { id: 'T-1', agent: 'home-nodes', word: { is: 'ready', next: 'settle', worker: 'agent', job: 'home-nodes' }, progress: { done: 0, total: 1 } };
  const left = trackText({ held: true, track: 'TR-2', name: 'x', text: '1 ready', now: [], readySet: [settle] });
  assert.ok(!left.includes('Now:') && left.match(/T-1\b/g).length === 1, left);
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
  /* a review due is no band row and counts nowhere on it; its card still draws where a page lists it */
  const review = { kind: 'review', record: 'tr1', id: 'TR-1', name: 'lane', text: 'Review due on TR-1 lane', presses: [{ label: 'Open the track', url: '/track/TR-1', pane: 'tracks' }] };
  assert.equal(bandModel({ questions: [], calls: [review], sid: 's' }), null);
  const scrub = { kind: 'scrub', id: 'K-2', text: 'K-2 was scrubbed', presses: [{ label: 'Unscrub', verb: 'unscrub' }] };
  assert.deepEqual(bandModel({ questions: [], calls: [review, scrub], sid: 's' }).calls.map((c) => c.kind), ['scrub']);
  assert.equal(callCard(callRows([review])[0]).head.state.text, 'review due');
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
  /* the drawn read says when the questions were not read */
  const read = (band) => drawnText({ drawn: { band: { at: 0, parts: ['the needs line'], ...band } }, part: 'band', now: 0 });
  assert.match(read({ model: { questions: [], total: 2, unreadQuestions: true } }), /questions: 2, not read/);
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
  /* a merge landing an agent task started in an earlier turn names that task, not an unseen track */
  const landed = offTrackSlip({ commits: 1, agentTasks: ['T-393'] }).say;
  assert.ok(landed.includes('T-393') && !landed.includes('never shows'), landed);
  /* a sweep run by node's full quoted path from PowerShell is the sweep's turn, as the bare node form is */
  assert.equal(hubRan(String.raw`& "C:\Program Files\nodejs\node.exe" "C:\Users\me\.claude\askerdo\cli.mjs" sweep`, 'sweep'), true);
  assert.equal(hubRan('node ~/.claude/askerdo/cli.mjs sweep', 'sweep'), true);
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
    t('TR-10', 'new'), t('TR-2', 'active', { now: [{ id: 'T-7', agent: 'fixer' }], handoff: { id: 'TR-2.1', status: 'resumed', waitingOnUser: ['a carried wait'] } }), t('TR-3', 'waiting', { handoff: { id: 'TR-3.2', status: 'waiting', focus: 'new\nline', waitingOnUser: ['Q5 the port', 'your look at the tray'] } }),
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
  /* the held track keeps its resumed handoff's waits until the next handoff drops them */
  assert.deepEqual(v.held.waits, ['a carried wait']);
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
  /* the held tile and the status row's track card show the goal, a restated one with its old text */
  const restated = { goal: 'ship the reader', goalRestated: { handoff: 'TR-2.4', at: '2026-10-19T12:30:00+00:00', was: 'fix the writer' } };
  const at = Date.parse('2026-10-19T13:30:00+00:00');
  const goalOf = (rows) => JSON.stringify(rows.filter((r) => r.lead.icon === 'ldIntent'));
  const restTile = tracksView({ mine: { held: true, track: 'TR-2', workstream: 'WS-1', tracks: [] }, graph: { workstream: 'WS-1', view: { tracks: [{ ...chain.view.tracks[0], ...restated }] } }, now: at }).held;
  const card = statusModel({ now: at, thread: heldTrack({ held: true, track: 'TR-2', name: 'two', ...restated }, null) }).segments.find((s) => s.key === 'thread');
  for (const shown of [goalOf(restTile.groups.flat()), JSON.stringify(card)]) assert.ok(['ship the reader', 'restated', 'fix the writer'].every((w) => shown.includes(w)), shown);
  assert.ok(!goalOf(tile.groups.flat()).includes('restated'), 'no goal, no goal row');
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
  assert.ok(questionsHeader(m).startsWith('4 ') && questionsHeader(m).includes('1 blocking'));
  assert.match(questionsHeader(questionsModel({})), /^No /);
  /* the count is this session's own, as the band's; the rest from elsewhere, said apart */
  const split = questionsModel({ sid: 's1', questions: [{ id: 'Q1', name: 'mine', session: 's1', blocking: true },
    { id: 'Q2', name: 'a blocker near', session: null, blocking: true }, { id: 'Q3', name: 'far', away: true, project: 'tides' }] });
  assert.deepEqual([split.own, split.elsewhere, split.blocking], [1, 2, 1]);
  assert.match(questionsHeader(split), /^1 .*\b2 from elsewhere/);
  /* the asleep ones ride apart, in no count, the waking record its own linked piece */
  const nap = questionsModel({ sid: 's1', local: 'http://127.0.0.1:5/' + 'a'.repeat(32) + '/', questions: [{ id: 'Q1', name: 'mine', session: 's1' }],
    asleep: [{ id: 'Q8', name: 'later', wake: 'until T-398 is completed', record: 'T-398' }, { id: 'Q9', name: 'far', wake: 'until Nov 20', project: 'tides' }] });
  assert.deepEqual([nap.own, nap.elsewhere, nap.cards.length, nap.asleep.map((q) => q.id), nap.asleep[1].project], [1, 0, 1, ['Q8', 'Q9'], 'tides']);
  assert.ok(nap.asleep[0].pieces.some((p) => p.text === 'T-398' && p.url) && !nap.asleep[1].pieces.some((p) => p.url));
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
  /* another project's question groups apart under its project's chip, the last to drop */
  const far = chipGroups(questionsModel({ questions: [{ id: 'Q4', track: 'TR-21', pc: 'laptop', project: 'tides', away: true },
    { id: 'Q5', track: 'TR-21', pc: 'laptop', away: true }] }).cards, g.here);
  assert.deepEqual([far.length, chipHeader(far[0], 9).chips.map((c) => [c.kind, c.text])], [2, [['project', 'tides']]]);
  const row = rowParts({ ...g.cards[0], name: 'a long name that cannot fit', age: '2h' }, 20);
  assert.ok(row.cut && row.id === 'Q1' && row.age === '2h');
  /* a wide desktop row measures its words as the pane's Text draws them, wider than the system font:
     a name the system font fits is cut, at a whole word */
  const words = 'word '.repeat(40).trim();
  const sys = (s, wt) => paneMeasure(s, 14, wt) / 8.453;
  const wide = rowParts({ id: 'Q1', name: words }, 2 + sys('Q1', 600) + 1 + 1 + sys(words, 400) + 1, { surface: 'desktop' });
  assert.ok(wide.cut && /^(word )*word\u2026$/.test(wide.name), wide.name);
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
  /* the desktop row measures its words as the pane's Text draws them: a width the system font fills shows the letters alone */
  const sys = (s) => paneMeasure(s, 14, 400) / 8.453;
  const fill = 3 + sys(q.name) + 1 + q.answers.reduce((n, a) => n + 20 / 8.453 + 2.1 + sys((q.pick === a.letter ? STAR + ' ' : '') + a.option) + 1, 0);
  assert.deepEqual([fill, fill * 1.1].map((c) => answerLabels(q, Math.ceil(c), { surface: 'desktop' })), [['a', STAR + ' b'], ['a one file', STAR + ' b many files']]);
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
  /* a placement answer relays what it created, or that nothing was, as the plugin's words */
  const placed = (raw) => deliveryText([{ line: 'Q30 answered.', raw: { kind: 'answer', id: 'Q30', name: 'Tidy the docs', pick: 'a', by: 'user:s1', ...raw } }]);
  const made = placed({ created: { id: 'T-91', track: 'TR-3', before: ['T-50'], after: [] } });
  assert.ok(made.startsWith('I answered Q30') && /not my words\):\n- .*T-91 on TR-3, before T-50/.test(made), made);
  assert.ok(/created nothing/.test(placed({ outcome: 'talk' })) && !/created/.test(placed({})), placed({ outcome: 'talk' }));
  /* a step added onto another track's task names that task as no new one */
  assert.ok(/step of T-40/.test(placed({ outcome: 'asked', how: 'step', created: { id: 'T-40', track: 'TR-4' } })));
  assert.deepEqual(rememberKeys(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  assert.equal(rememberKeys(Array.from({ length: 400 }, (_, i) => 'k' + i), ['z']).length, 300);
  assert.equal(rememberKeys(undefined, ['z']).at(-1), 'z');
  /* the band counts what waits; an answer's hover line names its option */
  const waiting = inboxWaiting([{ key: 'k', line: 'Q20 (Who drives) was answered in another session: 20a.',
    raw: { kind: 'answer', id: 'Q20', name: 'Who drives', pick: 'a' } }], { Q20: [{ type: 'a', option: 'I drive it' }] });
  assert.deepEqual([waiting.n, waiting.answers], [1, true]);
  assert.match(waiting.lines[0], /20a, I drive it/);
  /* an item names what happened, its record with its name, and the PC it came from */
  const note = inboxWaiting([{ key: 'n', line: 'x', raw: { kind: 'task-note', id: 'T-9', name: 'Fix the row', by: 'session:s2', pc: 'PC-2', detail: 'see the log' } }], {}, 'PC-1');
  assert.ok(/note/i.test(note.items[0].text) && /T-9 Fix the row/.test(note.items[0].text) && /PC-2/.test(note.items[0].text) && /see the log/.test(note.lines[0]), JSON.stringify(note.items));
  /* the user's press in the session that asked draws no row and adds nothing to the count;
     a press in another session on this PC still shows its row */
  const press = (by) => ({ key: by, box: 's1', line: 'x', raw: { kind: 'answer', id: 'Q20', name: 'Who drives', pick: 'a', by, pc: 'PC-1' } });
  assert.equal(inboxWaiting([press('user:s1')], {}, 'PC-1'), null);
  const both = inboxWaiting([press('user:s1'), press('user:s2')], {}, 'PC-1');
  assert.deepEqual([both.n, both.items.length, both.keys], [1, 1, ['user:s2']]);
  assert.ok(/Q20 Who drives/.test(both.items[0].text) && /another session/.test(both.items[0].text), JSON.stringify(both.items));
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
  assert.ok(agentNote('soft', { tokens: 360000, guard: { ...g, hardDeny: true } }).includes('only the state note and the report\'s hand-back'));
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
});

/* a reply with the question told in its emoji-led footer, the bullets right under */
import { hideTold, tellBlock, tellingParts } from '../lib/mod-core.mjs';
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
  /* fenced lines above the footer repeat the ask; they stay whole and only the footer's block folds */
  const w = { id: 'Q3', name: 'open the walk', ask: 'Will you open a session at C:/sample/worktrees/walk and send /askerdo resume TR-5 there (a, my pick), or skip it (b)?',
    pick: 'a', options: [{ type: 'a', option: 'Open' }, { type: 'b', option: 'Skip' }] };
  const fence = '`'.repeat(3);
  const reply = ['Ready.', '', 'Open a session at this folder:', fence + 'text', 'C:/sample/worktrees/walk', fence, 'Then send:', fence,
    '/askerdo resume TR-5', fence, '', '\u{1f64b} **Needs you:**', '', tellBlock(w)].join('\n');
  const parts = tellingParts(reply, [w]);
  assert.ok(parts.body.includes('worktrees/walk\n') && parts.body.includes('resume TR-5\n') && !parts.body.includes('card'), parts.body);
  assert.ok(/Q3.*card above/.test(parts.footer) && !/Q3a|Will you open/.test(parts.footer), parts.footer);
});

import { closedInbox, commitsIn, hubLauncherAt, inboxLeft, movesTrack } from '../lib/mod-core.mjs';
import { inboxLines } from '../server/handoff-text.mjs';
test('engagement: a board id in a prompt and a hub CLI call; a shell call that commits', () => {
  assert.ok(namesBoardId('look at T-304') && namesBoardId('Q12?') && namesBoardId('TH-3.2') && namesBoardId('pasted T-' + String.fromCharCode(0x2060) + '97'));
  assert.ok(!namesBoardId('a T-shirt and Q-tips'));
  assert.ok(isHubShell('node ~/.claude/askerdo/cli.mjs list') && isHubShell('node bin/askerdo.mjs show T-1'));
  assert.ok(!isHubShell('git status'));
  /* a seam root's own launcher, as a command may type it; any other cli.mjs stays invisible */
  const root = 'C:/My Box/.sandbox/store';
  try {
    hubLauncherAt(root);
    assert.deepEqual(['node "C:/My Box/.sandbox/store/cli.mjs" resume TR-1 --session s', 'node c:\\my box\\.sandbox\\STORE\\cli.mjs list', 'node "/c/My Box/.sandbox/store/cli.mjs" list',
      'node $ASKERDO_ROOT/cli.mjs list', 'node "${ASKERDO_ROOT}/cli.mjs" list', 'node $env:ASKERDO_ROOT/cli.mjs list', 'node %ASKERDO_ROOT%\\cli.mjs list',
      'node C:/other/proj/cli.mjs list', 'node "D:/My Box/.sandbox/store/cli.mjs" list', 'node "C:/x/My Box/.sandbox/store/cli.mjs" list', 'node ~/.claude/askerdo/cli.mjs list'].map(isHubShell),
      [true, true, true, true, true, true, true, false, false, false, true]);
    assert.ok(movesTrack('node "C:/My Box/.sandbox/store/cli.mjs" resume TR-1 --session s'));
    /* the guard reads the root's launcher as it reads the live one */
    assert.equal(forgedFiling('node "C:/My Box/.sandbox/store/cli.mjs" track capture --tier 2 --track TR-1 --name x --session S2', 'S1'), 'session');
    /* the variable in another letter case, a WSL path, and a root under the home folder as ~ or the home variable */
    hubLauncherAt('C:/Users/Pat/sbx/store', ['C:\\Users\\Pat']);
    assert.deepEqual(['node $env:askerdo_root/cli.mjs answer Q1 --pick b --user s', 'node /mnt/c/Users/Pat/sbx/store/cli.mjs list', 'node ~/sbx/store/cli.mjs answer Q1 --user s',
      'node $env:userprofile\\sbx\\store\\cli.mjs list', 'node ~/other/store/cli.mjs list'].map(isHubShell), [true, true, true, true, false]);
    assert.equal(forgedFiling('node ~/sbx/store/cli.mjs answer Q1 --pick b --user s1', 's1'), 'user');
  } finally { hubLauncherAt(undefined); }
  assert.ok(isHubShell('node ~/.claude/askerdo/cli.mjs list') && isHubShell('node bin/askerdo.mjs show T-1') && !isHubShell('node "C:/My Box/.sandbox/store/cli.mjs" list'));
  assert.ok(commitsIn('cd C:/x && git add -- a && git commit -m "T-1: a; b" -- a') && commitsIn('git -C C:/x merge --no-ff fix/lane'));
  assert.ok(commitsIn('git commit -m "docs: say when --dry-run helps"'), 'a flag in the message is not a flag');
  assert.ok(!['git log --grep commit', 'git merge --abort', 'git commit --dry-run', 'git merge-base a b', 'echo git commit', 'git merge --squash fix/lane'].some(commitsIn));
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
  /* a resume command handed over while the session's work runs, the track held or let go from the shell */
  const early = (o) => replyChecks({ answer: '```text\n/askerdo resume TR-3\n```', checks: ON, ...o }).some((s) => s.id === 'resume-early');
  assert.deepEqual([early({ held: 'TR-3', running: '"lane" (agent, 2m)' }), early({ left: ['TR-3'], running: '"lane" (agent)' }), early({ held: 'TR-3' })], [true, true, false]);
  /* a reply past a one-liner opens with the cluster; a one-liner and a short conversational turn need none */
  assert.deepEqual(replyChecks({ answer: '**Fixed**\n\nThe band draws again.\n\n' + G + ' Next up: the merge.', checks: ON }).map((s) => s.id), ['no-cluster']);
  assert.deepEqual(replyChecks({ answer: 'Yes, 0.8.16 shipped it.', checks: ON }), []);
  assert.deepEqual(replyChecks({ answer: 'Good question. The band reads the board each minute.\n\nSo a press shows within that minute.', checks: ON }), []);
  /* each answer delivered before the reply is named somewhere in the turn's text */
  const owed = receiptsOf([{ raw: { kind: 'answer', id: 'Q52', name: 'answer receipts', pick: 'a' } }, { raw: { kind: 'answer', id: 'Q53', name: 'mark', note: 'n' } }]);
  assert.deepEqual(replyChecks({ answer: 'Got 52a (answer receipts) and Q53.', receipts: owed }), []);
  const miss = replyChecks({ answer: 'done', all: ['Got 52a.', 'done'].join(' '), receipts: owed });
  assert.deepEqual(miss.map((s) => s.id), ['receipt']);
  assert.ok(miss[0].say.includes('Q53') && !miss[0].say.includes('52a'));
  /* the cluster opens line 1 and the receipt is the rest of it or the next line; both checks pass, a later receipt flags */
  const body = '\n\n## ' + G + ' Next up: the merge.';
  assert.deepEqual(replyChecks({ answer: OK + ' ' + G + ' Got 52a (answer receipts) and Q53.' + body, checks: ON, receipts: owed }), []);
  assert.deepEqual(replyChecks({ answer: OK + ' ' + G + ' **Fixed**\nGot 52a and Q53.' + body, checks: ON, receipts: owed }), []);
  assert.deepEqual(replyChecks({ answer: OK + ' ' + G + ' **Fixed**\n\nThe band draws.\n\n- 52a and Q53 landed.' + body, checks: ON, receipts: owed }).map((s) => s.id), ['receipt']);
  /* an answer landing mid-turn is read in the text written after it, or the final reply */
  const receiptEarly = 'Reading the slip.\nThen the caller.';
  const lateFinal = 'Done.\nGot 52a (answer receipts).';
  const lateOwed = [{ token: '52a', after: lateFinal }];
  assert.deepEqual(replyChecks({ answer: lateFinal, all: [receiptEarly, lateFinal].join('\n\n'), receipts: lateOwed }), []);
  assert.deepEqual(replyChecks({ answer: 'Done.', all: [receiptEarly, 'Got 52a.', 'Done.'].join('\n\n'), receipts: [{ token: '52a', after: 'Got 52a.' }] }), []);
  const lateMiss = replyChecks({ answer: 'Done.\nAll merged.', all: [receiptEarly, 'Done.\nAll merged.'].join('\n\n'), receipts: [{ token: '52a', after: 'Done.\nAll merged.' }] });
  assert.ok(lateMiss.length === 1 && lateMiss[0].say.includes('52a'));
  /* a close's inbox id still unplaced flags unless the reply names it; the shell's Inbox line gives the ids */
  const shell = closedInbox('node ~/.claude/askerdo/cli.mjs track finish TR-7', ['TR-7 done.', 'Inbox (2): T-5 Docs (WS-1 Main); T-9 Fix (WS-1 Main).', 'Place each: ...'].join('\n'));
  assert.deepEqual(shell, { track: 'TR-7', ids: ['T-5', 'T-9'] });
  assert.deepEqual(replyChecks({ answer: 'T-5 waits on the user.', inbox: shell.ids }).map((s) => s.id + ' ' + s.say.includes('T-9') + s.say.includes('T-5')), ['inbox truefalse']);
  assert.equal(closedInbox('node ~/.claude/askerdo/cli.mjs track show TR-7', 'Inbox (1): T-5 a (WS-1 b).'), null);
  /* a line cut at ten says so, and the turn-end check reads the board's whole list */
  assert.equal(closedInbox('node ~/.claude/askerdo/cli.mjs track finish TR-7', 'Inbox (14): T-5 a (WS-1 b); and 13 more.').more, true);
  /* a due task is placed or woken again by the turn's end, naming it is not enough; one woken since passes */
  const closed = closedInbox('node ~/.claude/askerdo/cli.mjs track finish TR-7', 'Inbox (3): T-5 a (WS-1 b, due); T-6 c (WS-1 b, due); T-9 d (WS-1 b, wakes 2026-12-01).');
  assert.deepEqual(closed.due, ['T-5', 'T-6']);
  /* T-9, not yet due, owes nothing, not even a name */
  const left = inboxLeft(closed, [{ id: 'T-5', due: true }, { id: 'T-6', due: false }, { id: 'T-9', due: false }]);
  assert.deepEqual(left, { name: [], due: ['T-5'] });
  /* the close owes only its own workstream's due tasks; another's is named; one with the user passes */
  const rows = [{ id: 'T-5', due: true, workstream: { id: 'WS-2' } }, { id: 'T-6', due: true, asked: 'Q-9', workstream: { id: 'WS-1' } }, { id: 'T-9', due: false }];
  assert.deepEqual(inboxLeft(closed, rows, 'WS-1'), { name: ['T-5'], due: [] });
  /* a due task passes placed (gone from the inbox) or gated by this turn's ask */
  const own = (id) => ({ id, due: true, workstream: { id: 'WS-1' } });
  assert.deepEqual(inboxLeft(closed, [own('T-6')], 'WS-1'), { name: [], due: ['T-6'] }, 'T-5 placed');
  assert.deepEqual(inboxLeft(closed, [own('T-5'), own('T-6')], 'WS-1', ['T-6']), { name: [], due: ['T-5'] }, 'T-6 asked');
  /* the close's Inbox line owes what the check owes, and the check reads it back so with the board's read failed, text or JSON */
  /* the owed item carries its reason, description line and the board's call on its own line below the list (the line reads (a); b; and), so the parse holds */
  const offer = { call: 'place', tier: 3, track: 'TR-2', flags: '--tier 3 --track TR-2', hint: { track: 'TR-2', name: 'Docs' } };
  const two = [{ id: 'T-4', name: 'a', due: true, workstream: { id: 'WS-1', name: 'b' }, reason: 'waits on (a); b, due)', line: 'The docs lag', offers: [offer, { call: 'ask' }] },
    { id: 'T-7', name: 'c', due: true, workstream: { id: 'WS-2', name: 'd' } }];
  const lines = inboxLines(two, undefined, 'WS-1');
  const mine = lines.filter((l) => l.startsWith('- T-4 '));
  assert.ok(mine.length === 1 && mine[0].includes('waits on (a)') && mine[0].includes('task edit T-4 --tier 3 --track TR-2') && /ask the user/.test(mine[0]), mine.join('\n'));
  assert.ok(!lines.some((l) => l.startsWith('- T-7 ')), 'an away item is only named');
  assert.ok(!lines[0].includes('waits on'), 'the Inbox line keeps its items bare');
  const said = closedInbox('node ~/.claude/askerdo/cli.mjs track finish TR-3', 'TR-3 done.\n' + lines.join('\n'));
  const json = closedInbox('node ~/.claude/askerdo/cli.mjs track finish TR-3 --json', JSON.stringify({ id: 'TR-3', workstream: 'WS-1', inbox: two }));
  for (const c of [said, json]) assert.deepEqual(inboxLeft(c, null), { name: ['T-7'], due: ['T-4'] });
  assert.deepEqual(replyChecks({ answer: 'T-5 and T-9 wait.', inbox: left.name, due: left.due }).map((s) => s.id + ' ' + s.say.includes('T-5')), ['inbox-due true']);
});

test('agent checks: none with no rules in force, the state note and size rule by their profile keys; flag text', () => {
  const on = { rules: { 'dispatch.stateNote': true, 'dispatch.outputRule': true }, inject: false };
  assert.deepEqual(agentChecks({ prompt: 'Fix it.' }), [], 'no board, no rules, no checks');
  assert.deepEqual(agentChecks({ prompt: 'Fix it.', model: 'fable' }, on).map((s) => s.id), ['state', 'size']);
  assert.deepEqual(agentChecks({ prompt: 'Fix it.' }, { ...on, inject: true }).map((s) => s.id), ['state'], 'the injection carries the size rule');
  assert.deepEqual(agentChecks({ prompt: 'Fix it.' }, { ...on, rules: { 'dispatch.stateNote': false } }).map((s) => s.id), ['size']);
  assert.deepEqual(agentChecks({ prompt: 'Keep x-state.md. Final response under 2000 characters.' }, on), []);
  /* a '<lane>-state.md' placeholder names no note */
  assert.deepEqual(agentChecks({ prompt: '- State note: `docs/<your lane>-state.md`. Final response under 2000 characters.' }, on).map((s) => s.id), ['state']);
  assert.deepEqual(agentChecks({ prompt: 'Read your brief: docs/briefs/lane-6.md. Reply in at most 300 words.' }, on), []);
  /* the testing rule in the brief's own words passes; a brief with neither clause slips, citing no repo path */
  const ran = 'Keep x-state.md. Final response under 2000 characters. Run the tests.';
  assert.deepEqual(agentChecks({ prompt: ran + ' While working, run only the test files you touch; run the full suite (or full gate) once at the end, before your last commit.' }, on), []);
  const bare = agentChecks({ prompt: ran }, on);
  assert.deepEqual(bare.map((s) => s.id), ['tests']);
  assert.ok(!/run-tests\.md/.test(bare[0].say), bare[0].say);
  /* a brief that only names a test session runs no tests */
  assert.deepEqual(agentChecks({ prompt: 'Keep x-state.md. Final response under 2000 characters. A walk waits for the desktop test session.' }, on), []);
  const slips = agentChecks({ prompt: 'Keep x-state.md.' }, on);
  assert.equal(flagLine('the dispatch of a', slips), 'AskerDo: the dispatch of a: the brief has no output-size rule. Flagged, not rewritten.');
  assert.ok(flagNote([{ what: 'your last reply', slips: [{ say: 'em or en dashes' }] }]).includes('your last reply: em or en dashes.'));
  const twice = flagNote([1, 2].map(() => ({ what: 'the dispatch of Last lane', slips })));
  assert.equal(twice.split('the dispatch of Last lane').length, 2, 'a repeated dispatch is said once');
  assert.match(twice, /\b2\b/);
  /* the task's latest lane flags when it handed work on to another agent; a finished one, whatever its size, nothing */
  const ok = { prompt: 'Keep x-state.md. Final response under 2000 characters.' };
  const lane = (journal) => agentChecks({ ...ok, description: 'Fix lane 3' }, { ...on, lanes: [{ task: 'T-7', ...latestLane(journal) }] }).map((s) => s.id);
  const past = laneNote(300000, 'Fix lane 3', handedOn('Leg 1 done.\nCONTINUE: docs/fix-state.md'));
  assert.deepEqual(lane(past), ['lane T-7']);
  /* a leg under a new name carries the job on when its brief names the lane's state note, whatever marks sit round it */
  const leg = (prompt) => agentChecks({ prompt, description: 'Leg 2' }, { ...on, lanes: [{ task: 'T-7', ...latestLane(laneNote(300000, 'Fix lane 3', true, 'docs/fix-state.md')) }] }).map((s) => s.id);
  assert.deepEqual([leg('Carry on from **docs/fix-state.md**. Final response under 2000 characters.'), leg('Keep docs/prefix-state.md. Final response under 2000 characters.')], [['lane T-7'], []]);
  assert.deepEqual(lane(laneNote(460000, 'big but done', handedOn('CONTINUE: none'))), []);
  /* a finished lane in other words is finished; a next step is not */
  assert.deepEqual(['CONTINUE: done; nothing left in this lane', 'CONTINUE: lane complete', 'CONTINUE: done with S2; S3 next'].map(handedOn), [false, false, true]);
  assert.deepEqual(lane([past, laneNote(200000, 'Fix lane 4', false)].join('\n\n')), []);
  /* a run's end from the engine's word, and the last CONTINUE line itself */
  assert.deepEqual([runEndHow('failed', true), runEndHow('killed', false), runEndHow('completed', true), runEndHow(undefined, null), runEndHow('held', false)], ['failed', 'handed_on', 'handed_on', 'finished', 'handed_on']);
  assert.match(continueLineOf('a\nCONTINUE: one\nCONTINUE: leg 2, Part C\n'), /^CONTINUE: leg 2/);
  /* a run held on background work alone ends after the bound, unless the agent moved or the list ended it */
  const heldList = [{ id: 'a', status: 'running' }, { id: 'b', status: 'waiting' }, { id: 'c', status: 'running' }, { id: 'd', status: 'completed' }];
  const heldAt = (id, ago, moved = false) => ({ id, at: 100 * 60000 - ago * 60000, moved });
  assert.deepEqual(heldOver([heldAt('a', 31), heldAt('b', 20), heldAt('c', 40, true), heldAt('d', 40)], heldList, 100 * 60000), ['a']);
  /* only a sandbox session's settings shorten the bound */
  assert.deepEqual([heldWaitOf({ ASKERDO_SANDBOX_HOME: 'C:/s/home', ASKERDO_HELD_WAIT_MS: '120000' }), heldWaitOf({ ASKERDO_HELD_WAIT_MS: '120000' }), heldWaitOf(undefined)], [120000, 30 * 60000, 30 * 60000]);
  /* an ended run's task is settled once it closed, waits, another worker runs it, or a note came after the end;
     the settle words name its open step by number in the close, with takeOver only for this process's earlier id */
  const at = '2026-11-14T10:00:00.000Z';
  const blk = { id: 'T-5', name: 'Cut it', status: 'open', word: { is: 'ready', next: 'settle' }, steps: [{ n: 2, text: 'measure' }], notes: [] };
  assert.deepEqual([blockSettled(blk, at, ['s1']), blockSettled({ ...blk, word: { is: 'waiting' } }, at), blockSettled({ ...blk, word: { is: 'running', worker: 'session', session: 's1' } }, at, ['s1']),
    blockSettled({ ...blk, notes: [{ at: '2026-11-14T10:05:00.000Z', body: 'waits on Q3' }] }, at)], [false, true, false, true]);
  const said = settleWords([blk], [{ run: 4, job: 'cutter', how: 'finished', session: 's0', tasks: [{ id: 'T-5' }] }], ['s0']);
  assert.ok(said.includes('2. measure') && said.includes('"done": [2]') && said.includes('"takeOver": true'), said);
  /* a long name is cut at a word with a mark, so a cut inside its own parentheses reads as cut */
  const longName = 'Scratch: ' + 'several plain words '.repeat(4) + '(dropped afterwards, once the test ended and the sandbox board was removed)';
  const long = settleWords([{ ...blk, name: longName }], []);
  const kept = (/\((Scratch.*?)\.\.\.\): its last run/.exec(long) || [])[1] || '';
  assert.ok(kept.length > 50 && longName.startsWith(kept + ' '), long);
  /* a stopped agent's run left no report, so its words send the session to none; the same call stays */
  /* and they name where to read, its state note and branch */
  const stopped = settleWords([blk], [{ run: 5, job: 'cutter', how: 'handed_on', report: null, stateNote: 'docs/x-state.md', branch: 'worktree-agent-a1', tasks: [{ id: 'T-5' }] }]);
  assert.ok(/no report/.test(stopped) && !/against the report/.test(stopped) && stopped.includes('"done": [2]')
    && stopped.includes('docs/x-state.md') && stopped.includes('worktree-agent-a1'), stopped);
  /* a report reaches the session by a hand-back or a notification's own result, never the engine's interim or pointer words */
  const note = (id, result) => '<task-notification>\n<task-id>' + id + '</task-id>\n<status>completed</status>\n<result>' + result + '</result>\n</task-notification>';
  assert.deepEqual(reportsIn(['<agent-message from="walk-i">\nDone.', note('a1', 'This agent has not reported yet: it is waiting on its own background work.'),
    note('a2', 'This agent\'s report was delivered to you as a message from "walk-b".'), note('a3', '1. done.\nCONTINUE: none')].join('\n')), { names: ['walk-i'], ids: ['a3'] });
  /* the dispatch's last run line and run details */
  const det = dispatchRunBlock({ found: [{ task: 'T-5', runs: [{ run: 4, worker: 'agent', job: 'cutter', how: 'handed_on', ended: at, continueLine: 'CONTINUE: leg 2' }] }],
    job: 'cutter 2', place: { repo: '/r', branch: 'b', startCommit: 'abc1234' }, stateNote: 'docs/x-state.md', now: Date.parse(at) + 60000 });
  assert.ok(['Last run on T-5: agent cutter, handed on', 'CONTINUE: leg 2', 'start commit abc1234', 'docs/x-state.md', 'by its number'].every((w) => det.includes(w)), det);
  /* a reply waits on the user by a question in its last paragraph outside code, or a footer that needs the user */
  assert.deepEqual(['Built it.\n\nShall I start T-6?', 'Is it?\n\nBuilt it.', 'Done.\n\n```\nwhy?\n```', 'Done.\n\n\u{1F64B} Needs you\nQ12 asks which.'].map(replyAsks), [true, false, false, true]);
  /* an agent's hub task writes are matched; a read is not */
  /* a segment naming a scratch board inline, or asking for --help, writes no live board */
  const cli = 'node ~/.claude/askerdo/cli.mjs ';
  const hub = (s) => isHubTaskWrite(s.includes('cli.mjs') ? s : cli + s);
  assert.deepEqual(['task update T-5 --status done', 'check done T-5 2', 'note T-5 --body x', 'edge add T-5 T-6', 'task block T-5 --json', 'show T-5', 'note K-5 --body x',
    'ASKERDO_ROOT=/s/store ASKERDO_BOARD_URL=file:/s/b.db ' + cli + 'task update T-5 --status done', 'export ASKERDO_BOARD_URL=memory: && ' + cli + 'check done T-5 2',
    'ASKERDO_BOARD_URL=file:$S/b.db ' + cli + 'note T-5 --body x', 'ASKERDO_BOARD_URL=memory: ' + cli + 'show T-5 && ' + cli + 'edge add T-5 T-6', 'task update --help',
    'bash -c "' + cli + 'task update T-5 --status done"', 'export ASKERDO_BOARD_URL=memory: && env -u ASKERDO_BOARD_URL ' + cli + 'check done T-5 2'].map(hub),
    [true, true, true, true, false, false, false, false, false, true, true, false, true, true]);
  /* and its fact and ruling writes; reading them stays open */
  const fact = (s) => isHubFactWrite(s.includes('cli.mjs') ? s : cli + s);
  assert.deepEqual(['knowledge new --title x', 'knowledge amend K-5', 'knowledge edit K-5 --name x', 'knowledge supersede K-5', 'decide --json', 'decisions --json', 'override decide 3 yes', 'show K-5',
    "$env:ASKERDO_BOARD_URL = 'file:C:/s/b.db'; " + cli + 'knowledge new --title x', 'decide --help', cli + 'decide --json && ' + cli + 'decide --help'].map(fact),
    [true, true, true, true, true, false, false, false, false, false, true]);
  /* a live filing carrying the user's mark, another session's id or a cleared session id passes the call off; the session's own and a scratch board's pass */
  const forged = (s) => forgedFiling(s.includes('cli.mjs') ? s : cli + s, 'S1');
  assert.deepEqual(['task create --tier 3 --track TR-2 --user S1 --name x', 'track capture --tier 2 --track TR-1 --name x --session S2',
    'env -u CLAUDE_CODE_SESSION_ID ' + cli + 'task create --tier 2 --name x', "$env:CLAUDE_CODE_SESSION_ID = ''; " + cli + 'track layout TR-2', 'answer Q4 --pick b --user S1',
    'task update T-1 --status done --leftovers --session S2', 'bash -c "' + cli + 'track finish TR-1 --leftovers inbox --user S1"',
    'task create --tier 2 --name x --session S1', 'task create --tier 2 --name x --session "$CLAUDE_CODE_SESSION_ID"', 'task update T-1 --status done --session S2',
    'ASKERDO_BOARD_URL=file:/s/b.db ' + cli + 'task create --user S1 --name x',
    'override decide 3 allow --user S1', 'override unscrub K-4 --user=S1', 'override request --json'].map(forged),
    ['user', 'session', 'env', 'env', 'user', 'session', 'user', '', '', '', '', 'override', 'override', '']);
  /* a bare number and q5 are read as the board's answer verb reads them */
  assert.deepEqual(hubAnswers(cli + 'answer Q4 --pick b && ' + cli + 'drop --note "no" Q5 && ASKERDO_BOARD_URL=memory: ' + cli + 'answer Q6 --pick a && ' + cli + 'answer 5 --pick b; ' + cli + 'drop q07'),
    ['Q4', 'Q5', 'Q5', 'Q7']);
  /* the user's message names a placement question by its Q form, a token or its label; another record's number, or a bare number, does not */
  assert.deepEqual(['Q12 b', 'go with 12a', 'L3a', 'T-12 is done', 'Q120', 'run the 12 tests', '12', '12z'].map((t) => namesQuestion(t, 'Q12', 'L3', ['a', 'b', 'c', 'd'])),
    [true, true, true, false, false, false, false, false]);
  /* an /askerdo line the model starts may not carry the user's mark */
  assert.deepEqual(['12b', 'L1a', 'track capture inbox x', 'track finish', 'track park "r"', 'keep 3', ''].map(userMarked), [true, false, true, true, false, true, false]);
  /* the lane's tasks lead its prompt, else its brief, else the session's own runs of its job; a row, a range or a report's title is data */
  const brief = ['Intro', '# Brief (T-10)', 'As T-11 did.'].join('\n');
  const report = '# Review of T-12 and T-13\n| T-14 | a row |';
  const audit = { description: 'notes audit', prompt: 'Audit lane (T-8): read rows T-20 to T-30.\n\n| T-9 | handed on |\nRead docs/review.md first.' };
  assert.deepEqual(tasksOfDispatch(audit, [report]), ['T-8']);
  assert.deepEqual(tasksOfDispatch({ description: 'T-7 fix', prompt: 'Lane for T-8.\nSee T-9.' }, [brief]), ['T-7', 'T-8']);
  assert.deepEqual(tasksOfDispatch({ prompt: 'Read your brief: docs/b.md.' }, [brief]), ['T-10'], 'a prompt naming no task points at its brief');
  assert.deepEqual(tasksOfDispatch(audit, [report], ['T-5']), ['T-8'], 'the task the prompt names wins over a run of the same job');
  assert.deepEqual(tasksOfDispatch({ description: 'cutter', prompt: 'Carry on.' }, [], ['T-5']), ['T-5'], 'a prompt naming none takes its job\'s run');
  /* ids in the opening line's second sentence count when its brief's heading names them, after a colon too; a heading the opening line does not name stays data */
  const fixLane = { description: 'Fix lane: agent ends', prompt: 'You are the "agent ends" fix lane of TR-61 (Fixes before the next release). Your tasks are T-206, T-203 and T-202 on the board; read docs/b-brief.md.' };
  const laneBrief = '# Fix wave lane "agent ends": T-206, T-203 and T-202 on the LIVE board\nAs T-9 did.';
  assert.deepEqual(tasksOfDispatch(fixLane, [laneBrief]), ['T-206', 'T-203', 'T-202']);
  assert.deepEqual(tasksOfDispatch({ ...fixLane, prompt: fixLane.prompt.replace('T-203 and T-202', 'T-203') }, [laneBrief]), ['T-206', 'T-203'], 'a brief two lanes share gives each its own');
  assert.deepEqual(tasksOfDispatch({ prompt: 'You are the auditor.\nRead docs/review.md; T-12 asks.' }, [report]), [], 'ids further down never take a heading');
  assert.ok(dispatchMissed({ prompt: 'You are the auditor.\nRead docs/review.md; T-12 asks.' }, []).includes('T-12'));
  assert.deepEqual([dispatchMissed(fixLane, ['T-206']), dispatchMissed({ prompt: 'Look around.' }, [])], ['', '']);
  assert.deepEqual(agentChecks({ ...ok, description: 'Fix lane 3' }, { ...on, lanes: tasksOfDispatch(audit, [report]).map((task) => ({ task, ...latestLane(past) })) }).map((s) => s.id), ['lane T-8']);
  /* the brief gets each served task's block after the rulings, once; a task the board could not read is left out */
  /* a ruling's body and its amends ride the brief and the pointer */
  const k1 = { id: 'K-1', name: 'Whole pane', words: 'move it all', gist: 'Rows go first.', amends: ['Amended 2026-11-10 by s1: steps go on the checklist.'] };
  const ruled = decisionsBlock(['T-7'], [k1]);
  assert.ok(['Rows go first', 'steps go on the checklist'].every((s) => ruled.includes(s) && decisionNote(k1, 'the edit of a.js').includes(s)), ruled);
  /* a confirmed ruling is carried by its title and K-n; its words stay in the record */
  const sure = { ...k1, confirmed: true };
  assert.ok([decisionsBlock(['T-7'], [sure]), decisionNote(sure, 'the edit of a.js')].every((s) => s.includes('K-1') && s.includes('Whole pane') && !s.includes('move it all')));
  /* a long quote keeps whole sentences, never a word cut short */
  const longNote = decisionNote({ ...k1, words: 'Keep the rows. ' + 'x'.repeat(400) + ' tail.' }, 'the edit of a.js');
  assert.ok(longNote.includes('Keep the rows.') && !longNote.includes('tail') && !longNote.includes('...'), longNote);
  /* more than three records a call matches are one block and one counted toast */
  const many = ['K-1', 'K-2', 'K-3', 'K-4'].map((id) => ({ decision: { ...k1, id, name: 'Ruling ' + id }, why: 'the edit of a.js matches a.js' }));
  const block = pointerNotes(many, 'the edit of a.js');
  assert.ok(block.length === 1 && many.every((h) => block[0].includes(h.decision.id)) && !block[0].includes('Rows go first'), block[0]);
  assert.equal(pointerNotes(many.slice(0, 3), 'the edit of a.js').length, 3);
  assert.ok(/4 decisions/.test(pointerToast(many, 'the edit of a.js')) && pointerToast(many, 'the edit of a.js').includes('a.js'));
  const held = taskBlocks(['Task T-7 Fix\nNotes (1):\n- scope: the square confirms too', '']);
  const prompt = withDecisions(withDecisions('Lane for T-7.', ruled), held);
  assert.ok(prompt.indexOf('move it all') < prompt.indexOf('the square confirms too'), prompt);
  assert.equal(withDecisions(prompt, held), prompt);
  assert.equal(taskBlocks(['', null]), '');
});

test("agents: a running agent's time since its start reads in minutes, a finished one's run length stays", () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const list = [{ id: 'a1', job: 'Band lane', model: 'opus', calls: 3, start: now - 75000 },
    { id: 'a2', job: 'Review', model: 'opus', calls: 1, start: now - 600000, end: now - 590000, done: true }];
  const [run, done] = agentsModel(list, null, now).rows;
  assert.match(run.detail, /\b1m\b/);
  assert.match(done.detail, /\b10s\b/);
  assert.match(agentsModel(list, null, now + 3600000).rows[1].detail, /\b10s\b/);
  /* two agents of one job on two tasks read apart by their tasks; a job naming its task is not told twice */
  const lanes = [{ id: 'b1', job: 'Walk lane', model: 'opus', calls: 1, start: now - 6000, tasks: ['T-197'] },
    { id: 'b2', job: 'Walk lane', model: 'opus', calls: 1, start: now - 6000, tasks: ['T-199'] }, { id: 'b3', job: 'T-197 walk wait two', model: 'opus', calls: 1, start: now, tasks: ['T-197'] }];
  const jobs = agentsModel(lanes, null, now).rows.map((r) => r.job);
  assert.ok(jobs[0].includes('T-197') && jobs[1].includes('T-199') && jobs[0] !== jobs[1] && jobs[2].split('T-197').length === 2, jobs.join(' | '));
});

test('agents: a load rebuilds the flights from the kept copy and the engine list, a helper counted under its dispatch; the background tasks the same way, the chip counting all of it by kind', () => {
  const now = Date.parse('2026-11-07T01:35:00Z');
  const kept = [{ id: 'r5', job: 'Rehearsal', model: 'opus', calls: 9, tokens: 1000, start: now - 3600000 },
    { id: 'sp', job: 'Skills parts', model: 'opus', calls: 2, start: now - 1400000, end: now - 500000, done: true, parent: 'r5' },
    { id: 'gone', job: 'Ended while unloaded', model: 'opus', calls: 1, start: now - 900000 }];
  const listed = [{ id: 'r5', status: 'running', description: 'Rehearsal' }, { id: 'qr', status: 'running', description: 'QR lane' }];
  const m = agentsModel(flightsRebuilt(kept, listed), null, now);
  assert.deepEqual([m.running, m.done], [2, 1]);
  const at = (id) => m.rows.findIndex((r) => r.id === id);
  assert.deepEqual([at('sp') - at('r5'), m.rows[at('sp')].under, m.rows[at('sp')].ended, m.rows[at('gone')].ended], [1, 1, false, true]);
  assert.match(m.rows[at('r5')].detail, /\b1h\b/);
  assert.deepEqual(flightsKept(flightsRebuilt(kept, [{ id: 'r5', status: 'completed' }]), []).flights, []);
  /* a Stop's list: a kept shell it still runs stays, a monitor it no longer runs has ended, a workflow only it names joins; its agents are the flights';
     a kept remote workflow it types "cloud session" stays */
  const bg = bgRebuilt([{ id: 'b1', kind: 'shell', job: 'npm test', start: now - 120000 }, { id: 'b2', kind: 'monitor', job: 'watch CI', start: now - 60000 },
    { id: 'w2', kind: 'workflow', job: 'Remote review', start: now - 30000 }],
  [{ id: 'b1', type: 'shell', status: 'running' }, { id: 'w1', type: 'workflow', status: 'running', description: 'Review' }, { id: 'r5', type: 'subagent', status: 'running' },
    { id: 'w2', type: 'cloud session', status: 'running' }], now);
  assert.deepEqual(bg.map((b) => [b.id, !!b.done]), [['b1', false], ['b2', true], ['w2', false], ['w1', false]]);
  assert.deepEqual(flightsKept([], bgRebuilt(bg, [], now)).bg, []);
  /* a foreground call the module wraps outlives a list that leaves it out, joins one naming its command, and
     one kept over a reload ends unlisted with no row; one still under the threshold draws nothing */
  const fgs = bgRebuilt([{ id: 'fg-a', kind: 'shell', fg: true, shown: true, job: 'Full suite', command: 'npm test', start: now - 5000 },
    { id: 'fg-b', kind: 'shell', fg: true, shown: true, reloaded: true, job: 'Lint', start: now - 5000 }], [{ id: 'x9', type: 'shell', status: 'running', command: 'npm test' }], now);
  assert.deepEqual(fgs.map((b) => [b.id, !!b.done]), [['fg-a', false]]);
  /* a command over the engine's limit, listed cut with its marker, joins the call's row too */
  const long = 'node x.mjs <<EOF\n' + 'y'.repeat(1200);
  const cut = bgRebuilt([{ id: 'fg-d', kind: 'shell', fg: true, shown: true, job: 'Payload', command: long.slice(0, 1000), start: now - 5000 }],
    [{ id: 'x8', type: 'shell', status: 'running', command: long.slice(0, 1000) + '... [+' + (long.length - 1000) + ' chars]' }], now);
  assert.deepEqual(cut.map((b) => b.id), ['fg-d']);
  assert.deepEqual(backgroundModel([...fgs, { id: 'fg-c', kind: 'shell', fg: true, job: 'ls', start: now - 100 }], now).rows.map((r) => [r.id, r.stop]), [['fg-a', false]]);
  /* a row takes its call's description; with none (a kept call's or the engine's list, which repeats the command), its
     command's work past the setup; no name or unfolded command shows a secret's value */
  const loopCmd = 'for W in 238 438; do rm -rf out/$W; node scripts/build.mjs --check; done';
  const leakCmd = 'GITHUB_TOKEN=ghp_x1 curl -H "Authorization: Bearer sk-9" https://u:pw7@h/x';
  const namedRows = backgroundModel(bgRebuilt([{ id: 'n1', kind: 'shell', job: 'Render the look rig', command: loopCmd, start: now - 9000 },
    { id: 'n2', kind: 'shell', job: loopCmd, command: loopCmd, start: now - 9000 }],
  [{ id: 'n1', type: 'shell', status: 'running' }, { id: 'n2', type: 'shell', status: 'running' },
    { id: 'n3', type: 'shell', status: 'running', description: leakCmd, command: leakCmd }], now), now).rows;
  const nameOfRow = (id) => namedRows.find((r) => r.id === id);
  assert.deepEqual([nameOfRow('n1').job, /^for\b|\brm\b/.test(nameOfRow('n2').job), nameOfRow('n2').job.includes('build')], ['Render the look rig', false, true]);
  assert.ok(['ghp_x1', 'sk-9', 'pw7'].every((v) => !(nameOfRow('n3').job + nameOfRow('n3').command).includes(v)), nameOfRow('n3').command);
  /* an interpreter's row is named from the script it runs; the stop and hold texts take the rows' mask */
  assert.deepEqual([/\bnode\b/.test(nameOfRow('n2').job), runningNames([{ id: 'wk', kind: 'workflow', job: leakCmd }], null).includes('ghp_x1')], [false, false]);
  const chip = statusModel({ now, agents: flightsRebuilt(kept, listed), background: bg }).segments.find((s) => s.key === 'agents');
  assert.equal(chip.pic.label, '5');
  assert.ok(['2 agents', '1 shell', '2 workflows'].every((k) => chip.tip.includes(k)), chip.tip);
  /* a workflow heads its group under Agents, its stop on its row; its agents (spawned under its call) sit under it with
     none of their own, a finished one kept; Background holds no workflow, and each running agent counts once, the workflow then not */
  const crew = flightsRebuilt([...kept, { id: 'wa', job: 'Read the tables', model: 'opus', calls: 3, tokens: 1000, start: now - 20000, wf: true, call: 'tu-w2' },
    { id: 'wb', job: 'Check the units', model: 'opus', calls: 1, start: now - 20000, end: now - 5000, done: true, wf: true, call: 'tu-w2' }], listed);
  const wbg = bg.map((b) => (b.id === 'w2' ? { ...b, call: 'tu-w2' } : b));
  const rows = agentsModel(crew, null, now, wbg).rows;
  const w = rows.findIndex((r) => r.id === 'w2');
  assert.deepEqual(rows.slice(w, w + 3).map((r) => [r.id, r.under, r.stop, r.done]), [['w2', 0, true, false], ['wa', 1, false, false], ['wb', 1, false, true]]);
  assert.deepEqual([rows.filter((r) => r.id === 'wa').length, backgroundModel(wbg, now).rows.some((r) => r.kind === 'workflow')], [1, false]);
  const wchip = statusModel({ now, agents: crew, background: wbg }).segments.find((s) => s.key === 'agents');
  assert.equal(wchip.pic.label, '5');
  assert.ok(['3 agents', '1 shell', '1 workflow'].every((k) => wchip.tip.includes(k)), wchip.tip);
  /* a day's finished agents: the chip's card keeps every running row and only the newest finished, its line still counting them all */
  const day = [{ id: 'run', job: 'Still at it', model: 'opus', calls: 1, start: now - 1000 },
    ...Array.from({ length: 150 }, (_, i) => ({ id: 'e' + i, job: 'Ended ' + i, model: 'opus', calls: 1, start: now - 9000, end: now - 5000, done: true }))];
  const dchip = statusModel({ now, agents: day }).segments.find((s) => s.key === 'agents');
  const drows = dchip.card.rows.map((r) => r.id);
  assert.ok(drows.includes('run') && drows.includes('e149') && !drows.includes('e0') && drows.length < 20, String(drows.length));
  assert.match(dchip.card.parts.map((x) => x.text).join(''), /150 done/);
  assert.equal(agentsModel(day, null, now).rows.length, 151);
  /* the newest eight by their end, not their start; a dispatch kept whole with its own agent; the line says how many more */
  const late = [{ id: 'run', job: 'Still at it', model: 'opus', calls: 1, start: now - 1000 },
    ...Array.from({ length: 20 }, (_, i) => ({ id: 'e' + i, job: 'Ended ' + i, model: 'opus', calls: 1, start: now - 90000 + i, end: now - 50000 + i, done: true })),
    { id: 'first', job: 'Ended last', model: 'opus', calls: 1, start: now - 99000, end: now - 100, done: true },
    { id: 'kid', parent: 'first', job: 'Its own agent', model: 'opus', calls: 1, start: now - 98000, end: now - 200, done: true }];
  const lchip = statusModel({ now, agents: late }).segments.find((s) => s.key === 'agents');
  const lrows = lchip.card.rows.map((r) => r.id);
  assert.deepEqual([lrows.length, lrows.includes('first') && lrows.includes('kid'), lrows.includes('e19'), lrows.includes('e14'), lrows.includes('e13')], [9, true, true, true, false]);
  assert.match(lchip.card.parts.map((x) => x.text).join(''), /\b14\b/);
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
  const { runVerb } = await import('../server/verbs/index.mjs');
  const graph = { workstream: 'WS-1', name: 'Board', view: t.workstreamView(db, { workstream: 'WS-1' }), unheld: true, others: [{ id: 'WS-2', name: 'Inbox' }],
    picture: runVerb(db, 'pictureView', { workstream: 'WS-1' }, 'cli') };
  const mine = { held: false, track: null, workstream: null, tracks: [] };
  const gm = homeGraph({ graph, mine, local: true, columns: 60 });
  /* the workstream's level, each track a pill */
  assert.deepEqual([gm.level, gm.lines.map((l) => l.id), gm.views], [1, [line.id], []]);
  assert.ok(gm.picture && gm.picture.zones.some((z) => z.k === 'pill:' + line.id) && /WS-2/.test(gm.why), 'drawn, the note naming the other workstream');
  assert.equal(homeGraph({ graph: { ...graph, unheld: false }, mine, local: true }).lines.length, 0, "a held track's graph is never drawn for a session without one");
  /* another workstream the Overview zoomed into, read apart from the band, draws beside it */
  putRecord(db, { key: 'ws000002', kind: 'workstream', fields: { id: 'WS-2', key: 'ws000002', name: 'Inbox', status: 'open', labelHistory: ['WS-2 2026-10-25'] }, body: '' });
  const far = t.newTrack(db, { name: 'Far line', workstream: 'WS-2' }, 'cli');
  t.capture(db, { track: far.id, name: 'Far step' }, 'cli');
  const zoomed = homeGraph({ graph, mine, local: true, columns: 60, view: { level: 1, ws: 'WS-2', tr: null, sel: null },
    far: { workstream: 'WS-2', view: t.workstreamView(db, { workstream: 'WS-2' }), picture: runVerb(db, 'pictureView', { workstream: 'WS-2' }, 'cli') } });
  assert.deepEqual([zoomed.view.ws, zoomed.picture.zones.some((z) => z.k === 'pill:' + far.id)], ['WS-2', true]);
  /* the workstream's loose tasks under its picture, each with its page; an empty inbox draws none */
  assert.equal(gm.inbox, null);
  const loose = ['Stray idea', 'Another'].map((name) => t.capture(db, { workstream: 'WS-1', name, wake: '2099-01-01' }, 'cli'));
  const local = 'http://localhost:1/' + 'ab'.repeat(16) + '/';
  const ib = homeGraph({ graph: { ...graph, view: t.workstreamView(db, { workstream: 'WS-1' }) }, mine, local, columns: 60 }).inbox;
  assert.ok(/\b2\b/.test(ib.count) && /#inbox$/.test(ib.href), 'the count, its press the board panel');
  assert.deepEqual(ib.tasks.map((x) => [x.id, !!x.href]), loose.map((x) => [x.id, true]));
  for (const x of loose) t.capture(db, { track: line.id, task: x.id }, 'cli');
  assert.equal(homeGraph({ graph: { ...graph, view: t.workstreamView(db, { workstream: 'WS-1' }) }, mine, local, columns: 60 }).inbox, null, 'placed on a track, the line goes');
});

test("a completed review takes the code it covered off the track's review due and leaves Home's picture itself", async () => {
  const { runVerb } = await import('../server/verbs/index.mjs');
  const { putRecord } = await import('../server/records.mjs');
  const t = await import('../server/verbs/tracks.mjs');
  const db = freshBoard();
  putRecord(db, { key: 'ws000001', kind: 'workstream', fields: { id: 'WS-1', key: 'ws000001', name: 'Board', status: 'open', labelHistory: ['WS-1 2026-10-25'] }, body: '' });
  const line = t.newTrack(db, { workstream: 'WS-1', name: 'Export' }, 'cli');
  const make = (name) => runVerb(db, 'createRecord', { name, description: 'd', track: line.id }, 'cli');
  const at = (h) => ({ session: 's1', now: new Date(2026, 10, 4, h) });
  const code = ['Export a file', 'Import it'].map(make);
  const review = runVerb(db, 'createRecord', { name: 'Review the export', description: 'd', track: line.id, labels: ['review'] }, 'cli');
  make('Release');
  code.forEach((c, i) => {
    runVerb(db, 'commitLink', { repo: 'r', sha: String(i + 1).repeat(40), task: c.id, via: 'message', at: at(8).now.toISOString(), added: 3, removed: 0 }, at(8));
    runVerb(db, 'editRecord', { id: c.id, status: 'done' }, at(9));
  });
  const graph = () => ({ workstream: 'WS-1', view: t.workstreamView(db, { workstream: 'WS-1' }), picture: runVerb(db, 'pictureView', { workstream: 'WS-1' }, 'cli') });
  const draw = (view) => homeGraph({ graph: graph(), mine: { held: true, track: line.id, workstream: 'WS-1', tracks: [] }, local: true, view, columns: 52 });
  /* the pill's strip names the review due; the held line draws the review's station */
  const pill = { level: 1, ws: 'WS-1', sel: 'pill:' + line.id };
  const due = (gm) => gm.strip.facts.some((f) => /review/i.test(f.label));
  const station = (gm) => gm.picture.zones.some((z) => z.k === 'stn:' + review.id) || gm.picture.source.includes('stn:' + review.id);
  assert.ok(!due(draw(pill)) && station(draw()), 'two finished code tasks under the review size are not due');
  runVerb(db, 'settingsSet', { key: 'review.tasks', value: 2, at: 'track', record: line.id }, 'cli');
  assert.ok(due(draw(pill)), 'two finished code tasks at a size of two wait for the review');
  runVerb(db, 'editRecord', { id: review.id, status: 'done' }, at(11));
  assert.ok(!due(draw(pill)), 'what the review covered is no longer due');
  assert.ok(!station(draw()), 'the finished review leaves the picture');
});

test("Home draws the redrawn picture's three levels inside the pane's Svg limits, each press zone carrying its action, and a track past the limits up to them and '+N more on the board'", async () => {
  const { panePicture } = await import('../lib/mod-core.mjs');
  const { pictureMockData } = await import('./helpers/picture-mock-data.mjs');
  const P = pictureMockData();
  const local = 'http://localhost:1/' + 'ab'.repeat(16) + '/';
  const draw = (V, columns = 51, data = P) => panePicture(data, V, { held: 'TR-12', local, columns });
  const levels = [{ level: 0, ws: 'WS-12', tr: null, sel: 'ws:WS-7' },{ level: 1, ws: 'WS-12', tr: null, sel: 'pill:TR-12' }, { level: 2, ws: 'WS-12', tr: 'TR-12', sel: 'stn:T-675' }];
  for (const columns of [28, 166]) for (const V of levels) {
    const m = draw(V, columns), p = m.picture, at = columns + ' ' + JSON.stringify(V);
    assert.ok(p && p.source.length <= 131072 && p.width <= 4096 && p.height <= 4096 && !m.more, at);
    assert.ok(p.zones.length && p.zones.every((z) => z.act), 'every zone presses: ' + at);
    assert.ok(m.strip && m.legend.length && m.legend.every((e) => e.source && e.width > 0), at);
  }
  /* a station: the first press selects, the second opens its task; the ground clears */
  const zone = (m, k) => m.picture.zones.find((z) => z.k === k).act;
  const first = zone(draw({ ...levels[2], sel: null }), 'stn:T-675');
  assert.deepEqual([first.kind, first.view.sel], ['select', 'stn:T-675']);
  const sel = draw(first.view), again = zone(sel, 'stn:T-675');
  assert.ok(again.kind === 'open' && again.id === 'T-675' && /t-675/i.test(again.href), JSON.stringify(again));
  assert.equal(sel.picture.clear.view.sel, null);
  assert.ok(sel.strip.acts[0].primary && sel.strip.acts[0].act.kind === 'open');
  /* a pill's second press zooms in; the Overview crumb and the views pair step out */
  const pill = zone(draw(levels[1]), 'pill:TR-12');
  assert.deepEqual([pill.kind, pill.view.level, pill.view.tr], ['zoom', 2, 'TR-12']);
  assert.deepEqual([sel.crumbs[0].act.kind, sel.crumbs[0].act.view.level], ['zoom', 0]);
  assert.deepEqual(sel.views.map((v) => [v.key, v.on, v.act.view.level]), [['mine', true, 2], ['all', false, 1]]);
  /* a workstream the band did not carry zooms from the Overview, the pane reading it first, and "List them" opens the finished list */
  const other = draw(levels[0]);
  assert.deepEqual([zone(other, 'ws:WS-7'), other.strip.acts[0].act].map((a) => [a.kind, a.read, a.view.level, a.view.ws]), [['zoom', 'WS-7', 1, 'WS-7'], ['zoom', 'WS-7', 1, 'WS-7']]);
  assert.match(draw({ level: 2, ws: 'WS-12', tr: 'TR-3', sel: 'bead:TR-3' }).strip.acts[0].act.href, /#done$/);
  /* a track of 150 more stations on its main line draws those that fit, the rest one press to its board page
     (on the main line, since side work past eight stations folds to its count) */
  const big = JSON.parse(JSON.stringify(P));
  const spine = big.ws['WS-12'].tracks.find((t) => t.id === 'TR-12').spine;
  let prev = 'T-283';
  for (let i = 0; i < 150; i++) {
    const id = 'T-' + (9000 + i);
    big.tasks[id] = { id, key: id.toLowerCase(), tr: 'TR-12', ws: 'WS-12', name: 'Step ' + i + ' of a long line', st: 'waits', waits: [prev], cross: [], frees: [] };
    big.tasks[prev].frees.push(id);
    spine.push(id);
    prev = id;
  }
  const cut = draw({ ...levels[2], sel: null }, 28, big);
  assert.ok(cut.picture.height <= 4096 && cut.picture.source.length <= 131072, cut.picture.height + ' px');
  assert.ok(cut.more && cut.more.n > 50 && cut.more.n < 158 && /tr-12/i.test(cut.more.href), JSON.stringify(cut.more));
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
  /* behind only on an older shipped commit; a commit off the record or none at all never nags */
  const { commitWords } = await import('../lib/mod-core.mjs');
  const shipped = [{ commit: '86b0d444' }, { commit: '2c5a27a0' }];
  const states = ['86b0d4441234', '2c5a27a0', 'abcdef12', null].map((c) => commitWords(c, shipped));
  assert.deepEqual(states.map((s) => s.state), ['step', 'behind', 'unrecorded', 'unknown']);
  assert.deepEqual(states.map((s) => !!s.behind), [false, true, false, false]);
  assert.match(states[1].behind, /2c5a27a0.*86b0d444/);
  assert.equal(commitWords('2c5a27a0', []).behind, '', 'no record compares nothing');
});

test('the drift line reads the conversion map: a dead pointer, a cite into a retired folder, a long rule line and a retired folder holding files again', async () => {
  const { driftOf } = await import('../lib/mod-core.mjs');
  const files = new Set(['docs/guide.md']);
  const map = { last: { source: 'run:r1', kind: 'run', at: '2026-11-01T10:00:00Z' }, rows: [
    { source: 'handoff/', kind: 'folder', fate: 'delete', sha: 'c1' },
    { source: 'handoff/RESULTS.md', kind: 'file', records: ['K-1'] },
    { source: 'docs/', kind: 'folder', fate: 'keep', why: 'the project\'s own docs' },
    /* a file kept by its own entry inside the retired folder */
    { source: 'handoff/KEEP.md', kind: 'folder', fate: 'keep', why: 'the user keeps it' },
  ] };
  files.add('handoff/KEEP.md');
  const rules = (cited, long) => [
    { rule: 'read-the-guide', text: 'Read `' + cited + '` before a change.', source: 'mine on default' },
    { rule: 'wordy', text: 'x'.repeat(long), source: 'mine on default' },
    { rule: 'few-tests', text: 'y'.repeat(500), source: 'built in' },
  ];
  const off = driftOf({ rules: rules('docs/gone.md', 401), exists: (p) => files.has(p), map, listed: { 'handoff/': ['KEEP.md', 'NEW.md'] } });
  assert.deepEqual(off.dead.map((d) => d.path), ['docs/gone.md']);
  assert.deepEqual(off.long.map((l) => l.slug), ['wordy'], 'a built-in line is never flagged');
  assert.deepEqual(off.fresh, [{ folder: 'handoff/', names: ['NEW.md'] }]);
  assert.match(off.text, /handoff\/.*2026-11-01/, 'the nudge names the run it changed since');
  assert.ok(off.doctor);
  const cites = driftOf({ rules: rules('handoff/STATE.md', 10), exists: (p) => files.has(p), map, listed: {} });
  assert.deepEqual(cites.dead.map((d) => [d.path, d.retired]), [['handoff/STATE.md', true]], 'a cite into a retired folder');
  assert.equal(driftOf({ rules: rules('docs/guide.md', 400), exists: (p) => files.has(p), map, listed: { 'handoff/': [] } }), null);
  assert.equal(driftOf({ rules: rules('handoff/KEEP.md', 10), exists: (p) => files.has(p), map, listed: { 'handoff/': ['KEEP.md'] } }), null, 'the kept file is neither retired nor new');
  assert.equal(driftOf({ rules: rules('docs/guide.md', 400), exists: (p) => files.has(p), map: null, listed: {} }), null, 'no map, nothing retired');
});

import { statusPicture, DRAW_CEILING } from '../lib/mod-core.mjs';
test("a track's bar draws a cell a task and stays inside the page's limit on an Svg's source on a track too long for that", () => {
  const bar = (done, rest) => statusPicture({ kind: 'bar', cells: [...Array(done).fill('done'), ...Array(rest).fill('waits')] }).source;
  assert.equal(bar(300, 16).split('<rect').length - 1, 316);
  /* the longest bar drawn a cell a task leaves the drawing most of its character budget */
  assert.ok(bar(1400, 100).length < DRAW_CEILING.chars / 5, 'a 1500-task bar is a small share of a drawing');
  const long = bar(4000, 1000);
  assert.ok(long.length < 131072 && long.includes('f-rest') && long.includes('f-track'), 'both runs drawn, in few shapes');
});
