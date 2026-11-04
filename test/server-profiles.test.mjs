/* Profiles and the rules in force on the board server: narrowest
 * wins with a track between the workstream and the task, a work record holding its own in
 * today's key order, the clash refusal, remove and drop, and the guard shortcut
 * on a project held by its remote. Stands in for the matching cases of
 * test/profiles.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshBoard } from './helpers/board-db.mjs';
import { putRecord, stampNow } from '../server/records.mjs';
import { frontText } from '../server/frontmatter.mjs';
import { resolveRecord as recordByLabel } from '../server/verbs/labels.mjs';
import { rulesBlock } from '../server/verbs/profile-rules.mjs';
import * as pf from '../server/verbs/profiles.mjs';
import { inTodaysOrder } from './helpers/old-store.mjs';

const APP = 'C:/repos/app';
const actor = { by: 'cli', now: () => new Date(2026, 9, 20, 10, 0, 0) };
const K = { ws: 'ws000001', t: 'tt000001', t2: 'tt000002', tr: 'tr000001' };
const AT = '2026-10-20T10:00:00-04:00';

/* WS-1 (project APP) > TR-1 > T-1; TR-1 was the plan P-1 before tracks, so P-1 still names it */
function tree() {
  const db = freshBoard();
  const rec = (key, kind, fields) => putRecord(db, { key, kind, slug: 'x', fields: { key, ...fields }, body: '' });
  rec(K.ws, 'workstream', { id: 'WS-1', name: 'ws', status: 'open', projects: [APP], created: AT, updated: AT });
  rec(K.t, 'task', { id: 'T-1', name: 'task', workstream: K.ws, status: 'in_progress', created: AT, updated: AT, subscribers: ['sess-9'] });
  rec(K.t2, 'task', { id: 'T-2', name: 'next', workstream: K.ws, status: 'open', created: AT, updated: AT, inHand: 'sess-9' });
  rec(K.tr, 'track', { id: 'TR-1', name: 'tr', workstream: K.ws, status: 'open', created: AT, updated: AT,
    labelHistory: ['P-1 2026-10-01 2026-10-20', 'TR-1 2026-10-20'] });
  db.prepare('INSERT INTO track_items (track, task, position) VALUES (?, ?, 1)').run(K.tr, K.t);
  return db;
}

const val = (eff, k) => eff.settings[k].value;
const from = (eff, k) => (eff.settings[k].profile ? eff.settings[k].profile + ' on ' + eff.settings[k].record : 'built-in');
const eff = (db, record, more) => pf.effective(db, { record, ...more });

test('resolution: built-in < default < project < workstream < track < task, the narrowest that sets it wins', () => {
  const db = tree();
  assert.deepEqual(eff(db, 'T-1').chain.map((c) => c.key), ['default', APP, 'WS-1', 'TR-1', 'T-1']);
  assert.deepEqual([val(eff(db, 'T-1'), 'agent.on'), from(eff(db, 'T-1'), 'agent.soft')], [false, 'built-in'], 'D20: off by default');
  const steps = [['default', 'agent.soft=100k'], [APP, 'agent.soft=110k'], ['WS-1', 'agent.soft=120k'],
    ['TR-1', 'agent.soft=130k'], ['T-1', 'agent.soft=140k']];
  for (const [i, [record, set]] of steps.entries()) {
    pf.profileDefine(db, { name: 'p' + i, set: [set] }, actor);
    pf.profileAdd(db, { record, name: 'p' + i }, actor);
    assert.equal(from(eff(db, 'T-1'), 'agent.soft'), 'p' + i + ' on ' + record, record);
  }
  assert.deepEqual(eff(db, 'TR-1').chain.map((c) => c.level), ['default', 'project', 'workstream', 'track']);
  assert.deepEqual(eff(db, 'T-1').chain.map((c) => c.level), ['default', 'project', 'workstream', 'track', 'task'],
    'a task resolved alone, as a dispatched agent resolves, has its track between the workstream and the task');
  assert.equal(val(eff(db, 'TR-1'), 'agent.soft'), 130000, 'each record sees its own chain, never a narrower one');
  assert.deepEqual(eff(db, 'WS-1', { project: 'C:/other' }).chain.map((c) => c.key), ['default', 'C:/other', 'WS-1']);
  assert.equal(from(eff(db, K.ws), 'agent.soft'), 'p2 on WS-1', 'a key is a record word too');

  /* the record holds its own, in today's key order, so the export keeps its bytes */
  const ws = recordByLabel(db, 'WS-1');
  /* the actor's local wall clock with this runner's own offset, so any zone passes */
  assert.deepEqual([ws.fields.profiles, ws.fields.updated], [['p2'], stampNow(actor.now())]);
  assert.match(ws.fields.updated, /^2026-10-20T10:00:00[+-]\d\d:\d\d$/);
  assert.ok(inTodaysOrder('workstream', Object.keys(ws.fields)), frontText(ws.fields));

  /* rules resolve the same way and their lines add up by slug, each saying where it came from */
  pf.profileDefine(db, { name: 'lean', set: ['tests.policy=standard'] }, actor);
  pf.profileRule(db, { name: 'lean', op: 'add', slug: 'unity-tests', text: 'Unity tests run in the editor only.' }, actor);
  pf.profileAdd(db, { record: 'WS-1', name: 'lean' }, actor);
  pf.profileDefine(db, { name: 'none', set: ['tests.policy=off'] }, actor);
  pf.profileRule(db, { name: 'none', op: 'drop', slug: 'opus-workers' }, actor);
  pf.profileAdd(db, { record: 'T-1', name: 'none' }, actor);
  const rows = rulesBlock(eff(db, 'T-1')).rows;
  const source = (rule) => (rows.find((r) => r.rule === rule) || {}).source;
  assert.deepEqual([source('tests.policy'), source('unity-tests'), source('opus-workers')], ['none on T-1', 'lean on WS-1', undefined]);
  /* a profile line under a built-in's slug takes its place, so no rule rides a session twice */
  pf.profileRule(db, { name: 'lean', op: 'add', slug: 'naming', text: 'Name things plainly.' }, actor);
  const named = rulesBlock(eff(db, 'T-1')).rows;
  assert.deepEqual([named.length, named.filter((r) => r.rule === 'naming').map((r) => r.source)], [rows.length, ['lean on WS-1']]);
  assert.equal(rulesBlock(eff(db, 'WS-1')).values['tests.policy'], 'standard');
  const size = rows.find((r) => r.rule === 'agent.soft');
  assert.ok(size && size.source !== 'built in' && size.text.includes(rulesBlock(eff(db, 'T-1')).values['agent.soft'] / 1000 + 'k'), 'Q100 100a: the lane size is the guard soft limit in force');
  /* a line for the session alone rides the session's block, never the one its agents get */
  pf.profileRule(db, { name: 'lean', op: 'add', slug: 'wave-note', text: 'Write the wave note at each wave boundary.', for: 'session' }, actor);
  const split = rulesBlock(eff(db, 'T-1'));
  assert.deepEqual([split.session.text.includes('wave note'), split.agents.text.includes('wave note'), split.text.includes('wave note'), split.agents.text.includes('Unity tests')],
    [true, false, false, true]);
  /* a line from a ruling changes only alongside a newer ruling, and its old words are kept */
  const ruling = (key, id, created) => putRecord(db, { key, kind: 'knowledge', slug: 'x', body: '', fields: { id, key, name: id, type: 'decision', status: 'active', created } });
  ruling('kk000001', 'K-1', AT);
  ruling('kk000002', 'K-2', '2026-10-20T11:00:00-04:00');
  pf.profileRule(db, { name: 'lean', op: 'add', slug: 'unity-tests', text: 'Unity tests run in the editor only.', from: 'K-2' }, actor);
  assert.throws(() => pf.profileRule(db, { name: 'lean', op: 'add', slug: 'unity-tests', text: 'Unity tests run anywhere.' }, actor), /came from K-2/);
  assert.throws(() => pf.profileRule(db, { name: 'lean', op: 'clear', slug: 'unity-tests', ruling: 'K-1' }, actor), /K-1 is not newer/);
  ruling('kk000003', 'K-3', '2026-10-20T12:00:00-04:00');
  const changed = pf.profileRule(db, { name: 'lean', op: 'add', slug: 'unity-tests', text: 'Unity tests run anywhere.', ruling: 'K-3' }, actor);
  assert.deepEqual({ ...db.prepare('SELECT old, new FROM history WHERE id = ?').get(changed.history) },
    { old: 'Unity tests run in the editor only.', new: 'Unity tests run anywhere.' });

  /* a session's rules come from its track, else its task in hand over its in_progress claim */
  assert.equal(pf.rulesFor(db, { cwd: APP, session: 'sess-9' }).record, 'T-2');
  assert.equal(pf.rulesFor(db, { cwd: APP, track: 'TR-1', session: 'sess-9' }).settings['tests.policy'].value, 'standard', 'a session reads its track');
  assert.equal(rulesBlock(eff(db, 'T-1')).values['tests.policy'], 'off', 'an agent on T-1 reads its task');
  assert.equal(pf.resolveSession(db, { cwd: APP, track: 'TR-9' }).settings['agent.soft'].record, APP, 'an unknown track holds nothing');
  const verbs = db.prepare("SELECT verb FROM activity WHERE kind = 'profile'").all().map((r) => r.verb);
  assert.equal(verbs.filter((v) => v === 'profile-add').length, 7, 'every change is an activity row');
});

test('add refuses two profiles setting one value on one record; remove drops an inherited one below and refuses one never there', () => {
  const db = tree();
  pf.profileDefine(db, { name: 'deep-code', set: ['agent.soft=400k', 'agent.hard=500k'] }, actor);
  pf.profileDefine(db, { name: 'docs-depth', set: ['agent.soft=300k'] }, actor);
  pf.profileDefine(db, { name: 'orch', set: ['main.window=25'] }, actor);
  for (const [set, why] of [[['main.window=40', 'main.wrap=30'], /below main.wrap/], [['agent.soft=5'], /1k to 2000k/], [[], /would set nothing/]]) {
    assert.throws(() => pf.profileDefine(db, { name: 'x', set }, actor), why);
  }
  assert.throws(() => pf.profileDefine(db, { name: 'guard-on', set: ['agent.on=on'] }, actor), /built in/);
  assert.equal(pf.profileAdd(db, { record: 'WS-1', name: 'deep-code' }, actor).added, true);
  assert.equal(pf.profileAdd(db, { record: 'WS-1', name: 'deep-code' }, actor).added, false, 'twice is a no-op');
  assert.throws(() => pf.profileAdd(db, { record: 'WS-1', name: 'docs-depth' }, actor), /agent\.soft \(deep-code and docs-depth\)/);
  pf.profileAdd(db, { record: 'WS-1', name: 'orch' }, actor);
  assert.throws(() => pf.profileDefine(db, { name: 'orch', set: ['agent.hard=600k'] }, actor), /WS-1 holds orch/);
  assert.throws(() => pf.profileAdd(db, { record: 'T-9', name: 'orch' }, actor), /T-9/);
  assert.throws(() => pf.profileAdd(db, { record: 'K-1', name: 'orch' }, actor), /knowledge record/);
  assert.equal(pf.profileList(db).profiles.find((p) => p.profile === 'deep-code').records.join(), 'WS-1');

  assert.equal(pf.profileRemove(db, { record: 'P-1', name: 'deep-code' }, actor).how, 'dropped');
  assert.equal(from(eff(db, 'T-1'), 'agent.soft'), 'built-in', 'a drop at the old plan id lands on its track and reaches its task');
  assert.equal(from(eff(db, 'WS-1'), 'agent.soft'), 'deep-code on WS-1', 'the workstream keeps it');
  assert.equal(pf.profileRemove(db, { record: 'P-1', name: 'deep-code' }, actor).how, 'already dropped');
  pf.profileAdd(db, { record: 'P-1', name: 'deep-code' }, actor);
  assert.equal(from(eff(db, 'T-1'), 'agent.soft'), 'deep-code on TR-1', 'adding it back clears the drop');
  assert.equal(pf.profileRemove(db, { record: 'P-1', name: 'deep-code' }, actor).how, 'removed');
  assert.equal(pf.profileRemove(db, { record: 'WS-1', name: 'deep-code' }, actor).how, 'removed');
  assert.throws(() => pf.profileRemove(db, { record: 'T-1', name: 'deep-code' }, actor), /neither holds nor inherits/);
  assert.equal(recordByLabel(db, 'P-1').fields.profileDrops, undefined, 'an empty holding leaves no line');
});

test('the guard shortcut holds a project by its remote, so every checkout of it and every machine sees it', () => {
  const db = tree();
  const REPO = 'github.com/example/app';
  let r = pf.profileGuard(db, { project: 'C:\\repos\\app\\', repo: REPO, want: 'on' }, actor);
  assert.deepEqual([r.steps, val(r.effective, 'agent.on')], [['added guard-on'], true]);
  assert.deepEqual(pf.loadProfiles(db).subscriptions['repo:' + REPO], { add: ['guard-on'], drop: [], dirs: [APP] });
  assert.equal(from(eff(db, 'C:/repos/app-b', { repo: REPO }), 'agent.on'), 'guard-on on C:/repos/app-b', 'another checkout of the remote');
  assert.equal(val(eff(db, 'TR-1'), 'agent.on'), true, 'a record whose workstream names the dir finds the remote by it');
  r = pf.profileGuard(db, { project: 'c:/repos/app', want: 'off' }, actor);
  assert.deepEqual([r.steps, val(r.effective, 'agent.on')], [['removed guard-on'], false]);
  pf.profileAdd(db, { record: 'default', name: 'guard-on' }, actor);
  r = pf.profileGuard(db, { project: APP, repo: REPO, want: 'off' }, actor);
  assert.deepEqual([r.steps, from(r.effective, 'agent.on')], [['added guard-off'], 'guard-off on ' + APP]);
  r = pf.profileGuard(db, { project: APP, repo: REPO, want: 'on' }, actor);
  assert.deepEqual([r.steps, from(r.effective, 'agent.on')], [['removed guard-off'], 'guard-on on default']);
  assert.throws(() => pf.profileGuard(db, { project: APP, want: 'maybe' }, actor), /on or off/);
});

test('the settings rows name the layer and profile behind each value, and a write lands where the value comes from', () => {
  const db = tree();
  pf.settingsSet(db, { key: 'main.window', value: 20 }, actor);
  pf.settingsSet(db, { key: 'agent.soft', value: '300k', at: 'workstream', record: 'WS-1' }, actor);
  pf.settingsSet(db, { key: 'main.window', value: 25, at: 'track', record: 'TR-1' }, actor);
  const row = (record, key) => {
    const r = pf.settings(db, { record }).rows.find((x) => x.key === key);
    return [r.value, r.layer, r.record, r.profile];
  };
  assert.deepEqual(row('TR-1', 'main.window'), [25, 'track', 'TR-1', 'settings-tr-1']);
  assert.deepEqual(row('TR-1', 'agent.soft'), [300000, 'workstream', 'WS-1', 'settings-ws-1']);
  assert.deepEqual(row('WS-1', 'main.window'), [20, 'default', 'default', 'personal'], 'a built-in value goes to the default profile');
  const again = pf.settingsSet(db, { key: 'main.window', value: 22, record: 'TR-1' }, actor);
  assert.deepEqual([again.profile, again.reaches.map((h) => h.record)], ['settings-tr-1', ['TR-1']], 'no --at: the profile that sets it now');
  assert.throws(() => pf.settingsSet(db, { key: 'contract.weather', value: false, at: 'track', record: 'TR-1' }, actor), /default only/);
  const line = pf.settings(db, { record: 'TR-1' }).rows.find((x) => x.key === 'rules.add' && x.slug === 'naming');
  assert.deepEqual([line.layer, line.editable], ['built-in', false], 'rule lines come as rows of their own');
  /* a row carries its own copy and sub-tab, its example at the value in force, and the records overriding it */
  const w = pf.settings(db, { record: 'WS-1' }).rows.find((x) => x.key === 'main.window');
  assert.equal(w.tab, 'sessions');
  assert.ok(w.label && w.line && w.changes && w.takes, 'the copy rides the row');
  assert.match(w.example.text, /\b20%/, 'the example is filled at the value in force');
  assert.deepEqual([w.changed, w.overridden], [true, [{ level: 'track', count: 1 }]], 'TR-1 sets it away from 20');
});

test('unset takes a value off its layer and the next layer down applies, dropping an emptied settings-record profile; a contract key goes back to built-in', () => {
  const db = tree();
  pf.settingsSet(db, { key: 'main.window', value: 20, at: 'default' }, actor);
  pf.settingsSet(db, { key: 'main.window', value: 25, at: 'track', record: 'TR-1' }, actor);
  pf.settingsSet(db, { key: 'contract.weather', value: false }, actor);
  const row = (key) => pf.settings(db, { record: 'TR-1' }).rows.find((x) => x.key === key);
  const u = pf.settingsUnset(db, { key: 'main.window', record: 'TR-1' }, actor);
  assert.deepEqual([u.profile, u.now.value, u.now.layer], ['settings-tr-1', 20, 'default'], 'no --at: off the layer that sets it now');
  assert.deepEqual([row('main.window').value, row('main.window').layer], [20, 'default']);
  /* the settings-tr-1 profile settings set made is empty now, so it is off TR-1 and gone; one the user made stays */
  const names = () => pf.profileList(db).profiles.map((x) => x.profile);
  assert.deepEqual([u.dropped, names().includes('settings-tr-1'), eff(db, 'TR-1').held.some((x) => x.profiles.includes('settings-tr-1'))], [true, false, false]);
  pf.profileDefine(db, { name: 'mine', set: ['agent.soft=300k'] }, actor);
  pf.profileAdd(db, { record: 'WS-1', name: 'mine' }, actor);
  pf.settingsUnset(db, { key: 'agent.soft', at: 'workstream', record: 'WS-1' }, actor);
  assert.ok(names().includes('mine'));
  pf.settingsUnset(db, { key: 'main.window', at: 'default' }, actor);
  assert.deepEqual([row('main.window').value, row('main.window').layer], [30, 'built-in']);
  assert.throws(() => pf.settingsUnset(db, { key: 'main.window', at: 'track', record: 'TR-1' }, actor), /nothing to remove/i);
  pf.settingsUnset(db, { key: 'contract.weather' }, actor);
  assert.deepEqual([row('contract.weather').value, row('contract.weather').changed], [true, false]);
});

test('on a board with no profile on default, a rule line added and a built-in line dropped from the settings surfaces reach the rules in force; a clear may leave the profile empty', () => {
  const db = tree();
  const home = pf.settings(db, {}).home;
  const added = pf.settingsRule(db, { op: 'add', slug: 'plain-names', text: 'Name things plainly.' }, actor);
  pf.settingsRule(db, { op: 'drop', slug: 'naming' }, actor);
  const rules = () => rulesBlock(eff(db, 'TR-1')).rows.map((x) => x.rule);
  assert.deepEqual([added.profile, added.added, rules().includes('plain-names'), rules().includes('naming')], [home, true, true, false]);
  /* the settings read lists the dropped line, so the pane and the board page offer Bring back */
  assert.deepEqual(pf.settings(db, { record: 'TR-1' }).drops, ['naming']);
  pf.settingsRule(db, { op: 'clear', slug: 'plain-names' }, actor);
  pf.settingsRule(db, { op: 'clear', slug: 'naming' }, actor);
  assert.deepEqual(pf.settings(db, {}).drops, []);
  assert.ok(rules().includes('naming'), 'the last line cleared leaves the profile empty, and the built-in line is back');
});

test('an invalid setting is refused and nothing is written', () => {
  const db = tree();
  pf.settingsSet(db, { key: 'main.wrap', value: 30, at: 'default' }, actor);
  const before = JSON.stringify(pf.loadProfiles(db));
  for (const [input, why] of [[{ key: 'main.window', value: 120 }, /1 to 99/], [{ key: 'main.window', value: 35, at: 'default' }, /below main.wrap/],
    [{ key: 'rules.add', value: 'x' }, /rule-add/], [{ key: 'queue', value: 'hub' }, /config\.json/], [{ key: 'contract.name', value: 'Alex' }, /retired/]]) {
    assert.throws(() => pf.settingsSet(db, input, actor), why);
  }
  assert.equal(JSON.stringify(pf.loadProfiles(db)), before);
});
