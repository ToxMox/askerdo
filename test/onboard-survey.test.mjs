/* The onboarding survey on small synthetic projects: the reads that are easy to get
 * wrong (nested memory types, a log of one entry per bullet, overrides patches on
 * added rows) and staleness judged against the project's own commits. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { survey } from '../skills/onboard/survey.mjs';
import { tempDir } from './helpers/sandbox.mjs';

function project(t) {
  const base = tempDir('onboard-survey-', t);
  const dir = join(base, 'proj');
  mkdirSync(dir);
  const git = (args, day) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: day + 'T12:00:00Z', GIT_COMMITTER_DATE: day + 'T12:00:00Z' },
  });
  git(['init', '-q', '-b', 'main'], '2026-01-01');
  /* a file given null is deleted */
  const commit = (day, files, msg = 'work on ' + day) => {
    for (const [f, text] of Object.entries(files)) if (text === null) rmSync(join(dir, f)); else writeFileSync(join(dir, f), text);
    git(['add', '--', ...Object.keys(files)], day);
    git(['commit', '-q', '-m', msg], day);
  };
  const root = git(['rev-parse', '--show-toplevel'], '2026-01-01').trim();
  return { base, dir, root, git, commit, work: join(base, 'work') };
}

test('the parse fixes: a nested memory type, a log of one entry per bullet, a patch on an added row and one naming no row', (t) => {
  const p = project(t);
  p.commit('2026-02-01', {
    'README.md': 'A project.\n',
    'DECISIONS.md': '# Decisions\n\n## Requirements from the owner\n\n- R1. Keep the store in one file,\n  so a backup is one copy.\n- R2. No server.\n\n## Decisions\n\n- D1. Use SQLite (2026-01-20).\n',
    'rulings.md': '# Rulings\n\n## Audio\n\n- Keep 48 kHz throughout,\n  resampling only at the edges.\n  - the mixer too\n- No plugins in the realtime path.\n\n## Interface\n\n- Dark theme only.\n',
    'decision-table.md': '# Decisions\n\nOne row per ruling.\n\n## Audio decisions\n\n| Decision | Reason and boundary | Authority |\n|---|---|---|\n'
      + '| Keep 48 kHz | Resample only at the edges | Owner |\n| No plugins in the realtime path | Latency | Owner, 2026-01-15 |\n\n'
      + '## Interface decisions\n\n| Decision | Reason and boundary | Authority |\n| :--- | --- | --- |\n| Dark theme only | | Owner |\n',
  });
  const claude = join(p.base, 'claude');
  const mem = join(claude, 'projects', p.root.replace(/[^A-Za-z0-9]/g, '-'), 'memory');
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(mem, 'short-replies.md'), '---\nname: short replies\ndescription: Keep replies short\nmetadata:\n  type: feedback\n  node_type: memory\n---\nKeep replies short.\n');
  mkdirSync(p.work);
  writeFileSync(join(p.work, 'overrides.json'), JSON.stringify({
    add: [{ id: 'added:one', home: 'task', def: 'keep', title: 'As added', fields: { name: 'As added' } }],
    rows: { 'added:one': { title: 'As patched', call: true }, 'gone:row': { def: 'leave' } },
  }));

  const doc = survey(p.dir, { work: p.work, board: false, env: { ...process.env, CLAUDE_CONFIG_DIR: claude } });
  const log = doc.rows.filter((r) => r.find === 'decision' && r.where.file === 'DECISIONS.md');
  assert.equal(log.length, 3, 'one record per entry: ' + log.map((r) => r.title).join(' | '));
  assert.match(log[0].fields.body, /backup is one copy/, 'an entry keeps its wrapped line');
  assert.equal(log[2].date, '2026-01-20', 'dated by its text');
  assert.equal(log[1].date, '2026-02-01', 'else by its line\'s commit');

  /* plain bullets with no entry ids: one record per top-level bullet, under its heading */
  const plain = doc.rows.filter((r) => r.find === 'decision' && r.where.file === 'rulings.md');
  assert.equal(plain.length, 3, plain.map((r) => r.title).join(' | '));
  assert.ok(/Audio/.test(plain[0].group) && plain[0].group === plain[1].group && /Interface/.test(plain[2].group), 'grouped by section');
  assert.match(plain[0].fields.body, /edges[\s\S]*mixer too/, 'a bullet keeps its wrapped line and nested bullet');
  assert.ok(plain[1].date === '2026-02-01' && plain[1].where.commit, 'dated by its first line\'s blame');

  /* a log kept as tables, under sections named for decisions too: one record per body row, titled by its first cell, the rest labelled by header */
  const table = doc.rows.filter((r) => r.find === 'decision' && r.where.file === 'decision-table.md');
  assert.deepEqual(table.map((r) => r.title), ['Keep 48 kHz', 'No plugins in the realtime path', 'Dark theme only']);
  assert.match(table[0].fields.body, /Reason and boundary: Resample only at the edges[\s\S]*Authority: Owner/);
  assert.ok(/Audio/.test(table[0].group) && table[0].group === table[1].group && /Interface/.test(table[2].group), 'grouped by section');
  assert.ok(table[1].date === '2026-01-15' && table[0].date === '2026-02-01' && table[0].where.commit, 'dated by its text, else its row\'s blame');

  assert.equal(doc.rows.find((r) => r.find === 'memory').home, 'rule', 'a feedback memory with its type under metadata is a rule line');

  const added = doc.rows.find((r) => r.id === 'added:one');
  assert.ok(added.title === 'As patched' && added.call === true, 'a patch reaches a row the session added');
  assert.equal(doc.warnings.length, 1);
  assert.match(doc.warnings[0], /gone:row/, 'a patch naming no row is reported by its id');
});

test('staleness is read against the project\'s own commits and the newest handoff, not the clock', (t) => {
  const p = project(t);
  p.commit('2026-03-01', { 'HANDOFF.md': '# A one-day brief\n\nDo the thing.\n' });
  p.commit('2026-03-02', { 'try-list.md': '# Try list\n\n- [ ] one\n- [ ] two\n- [ ] three\n' });
  for (let d = 3; d <= 11; d++) p.commit('2026-03-' + String(d).padStart(2, '0'), { 'work.txt': 'day ' + d + '\n' });
  p.commit('2026-03-11', { 'PARSER-HANDOFF.md': '# Parser\n\nNow on lexing.\n\n## Notes\n\nThe brief was done in an hour.\n' });
  /* a section reporting a step done or nothing parked says nothing about the whole handoff */
  p.commit('2026-03-12', { 'STATE.md': '# State\n\nNow on the importer.\n\n## Done\n\nStatus: done for the parser.\nParked work: None\n\n## Next\n\n1. Write the importer.\n' });

  const doc = survey(p.dir, { work: p.work, board: false, env: { ...process.env, CLAUDE_CONFIG_DIR: join(p.base, 'none') } });
  const row = (id) => doc.rows.find((r) => r.id === id);
  assert.equal(row('track:STATE').fields.state, 'waiting', 'only the newest live handoff waits');
  assert.notEqual(row('track:PARSER-HANDOFF').fields.state, 'finished', 'a note in a section that a brief was done says nothing about the file');
  assert.equal(row('track:HANDOFF').def, 'leave', 'a brief untouched for the project\'s recent work and unnamed by the state is left');
  assert.equal(row('track:try-list').def, 'leave', 'so is a list');
  assert.ok(doc.rows.filter((r) => r.find === 'task').every((r) => r.def === 'leave'), 'and its items');

  /* the same files with nothing done since: a quiet project judges nothing stale */
  const q = project(t);
  q.commit('2026-03-01', { 'HANDOFF.md': '# A one-day brief\n\nStatus: done, nothing left\n\nDo the thing.\n', 'try-list.md': '# Try list\n\n- [ ] one\n- [ ] two\n- [ ] three\n' });
  const quiet = survey(q.dir, { work: q.work, board: false, env: { ...process.env, CLAUDE_CONFIG_DIR: join(q.base, 'none') } });
  assert.ok(quiet.rows.filter((r) => r.find !== 'project').every((r) => r.def === 'keep'), quiet.rows.map((r) => r.id + ' ' + r.def).join(', '));
  const own = quiet.rows.find((r) => r.id === 'track:HANDOFF');
  assert.ok(own.call && own.fields.state !== 'finished', 'the state file saying done is the user\'s call, never finished');

  /* the file AGENTS.md says to read first is the state file, over a newer one-version lane note */
  const n = project(t);
  mkdirSync(join(n.dir, 'docs', 'workspace'), { recursive: true });
  mkdirSync(join(n.dir, 'Lane.Tests'));
  for (let d = 1; d <= 8; d++) n.commit('2026-05-0' + d, { 'docs/workspace/CURRENT.md': '# Where we are\n\nStep ' + d + '.\n' });
  n.commit('2026-05-08', { 'AGENTS.md': '# Agents\n\nRead `docs/workspace/CURRENT.md` first, and keep it current.\n' });
  n.commit('2026-05-09', { 'Lane.Tests/PROGRESS.md': '# Lane progress\n\nCheckpoint one.\n' });
  const named = survey(n.dir, { work: n.work, board: false, env: { ...process.env, CLAUDE_CONFIG_DIR: join(n.base, 'none') } });
  assert.equal(named.activity.stateFile, 'docs/workspace/CURRENT.md');
  assert.equal(named.rows.find((r) => r.id === 'track:docs/workspace/CURRENT').fields.state, 'waiting', 'the named file comes in as the live handoff');
  const lane = named.rows.find((r) => r.id === 'track:Lane.Tests/PROGRESS');
  assert.ok(lane.def === 'leave' && !lane.call, 'a one-version lane note the named state file never names is a checkpoint, not a call');
});

/* the git history read: a commit message is a claim, so a ruling found there is a call or evidence, never a decision */
test('the git history gives rulings as calls or evidence, deleted planning files, the arc, reverts and dropped branches', (t) => {
  const p = project(t);
  p.commit('2026-04-01', { 'README.md': 'A project.\n', 'DECISIONS.md': '# Decisions\n\n- D1. Use SQLite for the store file.\n- D2. No server.\n' });
  p.commit('2026-04-02', { 'SESSION-HANDOFF.md': '# Handoff\n\nNext: the mixer.\n' }, 'write the handoff');
  p.git(['checkout', '-q', '-b', 'spike-gpu'], '2026-04-03');
  p.commit('2026-04-03', { 'gpu.txt': 'try the gpu\n' }, 'spike: render on the gpu');
  p.git(['checkout', '-q', 'main'], '2026-04-03');
  p.git(['checkout', '-q', '-b', 'parser-rework'], '2026-04-03');
  p.commit('2026-04-03', { 'parser.txt': 'v2\n' }, 'try the old parser again');
  p.git(['checkout', '-q', 'main'], '2026-04-03');
  p.commit('2026-04-04', { 'src.txt': 'cache\n' }, 'Try a cache layer');
  p.commit('2026-04-05', { 'src.txt': 'no cache\n' }, 'Revert "Try a cache layer"');
  p.commit('2026-04-06', { 'SESSION-HANDOFF.md': null }, 'drop the old handoff');
  p.commit('2026-04-07', { 'engine.txt': 'v2\n' }, 'The owner chose the second engine over the first');
  p.commit('2026-04-08', { 'store.txt': 'sqlite\n' }, 'Use SQLite for the store file, decided in review');
  for (let d = 9; d <= 14; d++) p.commit('2026-04-' + String(d).padStart(2, '0'), { 'work.txt': 'day ' + d + '\n' });

  const doc = survey(p.dir, { work: p.work, board: false, env: { ...process.env, CLAUDE_CONFIG_DIR: join(p.base, 'none') } });
  const hist = doc.rows.filter((r) => r.find === 'history');
  assert.ok(doc.history.cap > 0 && doc.history.read === doc.history.total, 'the cap is reported with what was read');
  assert.ok(hist.every((r) => !(r.home === 'decision' && r.def === 'keep')), 'no commit subject starts as a decision');
  const ruling = hist.find((r) => /second engine/.test(r.title));
  assert.ok(ruling && ruling.call && ruling.def === 'leave', 'a ruling told only in a commit message is the user\'s call');
  const told = hist.find((r) => /SQLite/.test(r.title));
  const entry = doc.rows.find((r) => r.find === 'decision' && /SQLite/.test(r.title));
  assert.ok(told && told.evidence === entry.id && !told.call && told.def === 'leave', 'one repeating a log entry is evidence on that entry');

  const gone = hist.find((r) => r.where.file === 'SESSION-HANDOFF.md');
  const f = gone && gone.fields.files[0];
  assert.ok(gone.call && gone.def === 'leave' && f.deletedIn && f.lastVersion && f.lastVersion !== f.deletedIn, 'a deleted handoff is a call naming both commits');

  const arc = hist.find((r) => r.home === 'knowledge' && /2026-04/.test(r.fields.body));
  assert.ok(arc && arc.def === 'keep', 'the arc is a knowledge record proposed Keep');
  const revert = hist.find((r) => /cache layer/.test(r.title));
  assert.ok(revert.home === 'knowledge' && revert.def === 'keep', 'a revert is a tried-and-dropped note');
  const branch = hist.find((r) => /spike-gpu/.test(r.title));
  assert.ok(branch && branch.home === 'knowledge', 'so is a branch left unmerged');
  const rework = hist.find((r) => /parser-rework/.test(r.title));
  assert.ok(rework.call && rework.def === 'leave', 'a branch named for real work is the user\'s call, whatever its last subject says');

  const plain = join(p.base, 'plain');
  mkdirSync(plain);
  writeFileSync(join(plain, 'TODO.md'), '- [ ] one\n');
  const none = survey(plain, { work: join(p.base, 'work2'), board: false, env: { ...process.env, CLAUDE_CONFIG_DIR: join(p.base, 'none') } });
  assert.ok(!none.history && !none.rows.some((r) => r.find === 'history'), 'a folder outside git skips the step');
});
