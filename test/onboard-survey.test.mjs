/* The fact gatherer on one small project and a stubbed board: folder counts and touches, the entry points and what
 * they name, cites and code readers, the board's answered question, and the bounded subject samples. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { survey } from '../skills/onboard/survey.mjs';
import { instructionFiles } from '../skills/onboard/instructions.mjs';
import { loadersOf, scopesOf } from '../skills/onboard/plan.mjs';
import { sharedName } from '../lib/project-id.mjs';
import { tempDir } from './helpers/sandbox.mjs';

function project(t) {
  const base = tempDir('onboard-survey-', t);
  const dir = join(base, 'proj');
  mkdirSync(dir);
  const git = (args, day) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: day + 'T12:00:00Z', GIT_COMMITTER_DATE: day + 'T12:00:00Z' },
  });
  git(['init', '-q', '-b', 'main'], '2026-01-01');
  const put = (files) => { for (const [f, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), text); } };
  const commit = (day, files, msg = 'work on ' + day) => { put(files); git(['add', '--', ...Object.keys(files)], day); git(['commit', '-q', '-m', msg], day); };
  return { base, dir, put, commit, work: join(base, 'work') };
}

/* a board with one workstream for the project, an answered question, an earlier import's record and two tasks */
const STUB = `const a = process.argv.slice(2);
const mine = [process.env.STUB_SHARED];
const out = (v) => console.log(JSON.stringify(v));
if (a[0] === 'show') out([{ id: 'Q5', key: 'q5', name: 'Which bus rate?', status: 'answered', answer: '5a: 48 kHz, ' + 'every device on it. '.repeat(30) }]);
else if (a[0] === 'profile') out({ profiles: JSON.parse(process.env.STUB_PROFILES || '[]'), rows: [] });
else if (a[0] === 'track') out({ tracks: JSON.parse(process.env.STUB_TRACKS || '[]') });
else if (a[0] === 'conversion') out(JSON.parse(process.env.STUB_MAP || '{"rows":[],"last":null}'));
else if (a[0] === 'projects') out({ projects: [] });
else if (a[0] === 'decisions') out([]);
else if (a.includes('--project')) out({ questions: [{ id: 'Q5', key: 'q5', name: 'Which bus rate?', status: 'answered', labels: [] }] });
else if (a.includes('--label')) out(a.includes('knowledge') ? [{ id: 'K-2', name: 'Bus rate', refs: ['onboard:fact:handoff/STATE.md#L2'] }] : []);
else if (a.includes('workstream') && !a.includes('--workstream')) out([{ id: 'WS-1', name: 'Proj', status: 'open', projectRepos: mine }]);
else if (a.includes('knowledge')) out([{ id: 'K-2', name: 'Bus rate', type: 'gotcha', status: 'active', projectRepos: mine }]);
else if (a.includes('task')) out([{ id: 'T-1', name: 'Wire the bus', status: 'open' }, { id: 'T-2', name: 'Port the mixer', status: 'done' }]);
else out([]);`;

test('the survey writes facts and judges nothing', (t) => {
  const p = project(t);
  p.commit('2026-01-10', {
    '.gitignore': 'handoff-*.md\nCLAUDE.local.md\n',
    'docs/plans/old-plan/PLAN.md': '# Old plan\n\n- [ ] Port the mixer\n',
    'logs/run-1.md': '# Run 1\n\nRan the tests.\n',
  }, 'plan: the old plan');
  /* fifteen commits into one folder: its sample keeps the newest ten and the oldest two, each subject clipped */
  for (let i = 1; i <= 15; i++) p.commit('2026-02-' + String(i).padStart(2, '0'), { ['notes/n' + i + '.md']: 'note ' + i + '\n' }, 'note ' + i + ' ' + 'x'.repeat(i === 15 ? 300 : 0));
  p.commit('2026-03-01', {
    'reviews/wave-1.md': '# Wave 1 review\n',
    /* a data file naming a folder's file reads it */
    /* a ../ value resolves from its own folder: ../notes here is tools/notes, not the root notes */
    'tools/sync/paths.json': '{\n  "runs": "../../logs/run-1.md",\n  "notes": "../notes"\n}\n',
    'tools/notes/a.md': 'a\n',
    /* a value written from the root with a leading slash still counts for the root folder */
    'tools/root.json': '{\n  "index": "/notes/index.md"\n}\n',
    /* a JSON value that only mentions a folder in a sentence does not read it */
    'tools/sync/notes.json': '{\n  "about": "the run notes under logs/ are old"\n}\n',
    'tests/check.mjs': "import { readFileSync } from 'node:fs';\nreadFileSync('reviews/wave-1.md', 'utf8');\n",
  }, 'review: wave 1');
  p.commit('2026-04-20', {
    'CLAUDE.md': '# Project\n\nRead `handoff/STATE.md` first. Plans live in docs/plans/.\n\n- Never force-push a shared branch.\n',
    'handoff/STATE.md': '# State\n\nNow on the meters.\n',
  }, 'handoff: state');
  /* untracked: a plan git has no copy of, and an ignored handoff at the root */
  p.put({ 'docs/plans/new-plan/PLAN.md': '# New plan\n', 'handoff-x.md': '# Old handoff\n' });
  const old = new Date('2026-04-25T12:00:00Z');
  utimesSync(join(p.dir, 'docs/plans/new-plan/PLAN.md'), old, old);
  const cli = join(p.base, 'cli.mjs');
  writeFileSync(cli, STUB);

  const env = { ...process.env, CLAUDE_CONFIG_DIR: join(p.base, 'none'), STUB_SHARED: sharedName(p.dir) };
  const d = survey(p.dir, { work: p.work, cli, env });
  const f = JSON.parse(readFileSync(d.factsFile, 'utf8'));
  const folder = (path) => f.folders.find((x) => x.path === path);

  /* a folder's counts and touches: git's path, tracked and untracked, first commit, last touch from the untracked file */
  const plans = folder('docs/plans');
  assert.deepEqual([plans.tracked, plans.untracked, plans.first, plans.last], [1, 1, '2026-01-10', '2026-04-25']);
  assert.ok(folder('docs/plans/old-plan') && folder('docs/plans/new-plan'), 'folders to depth three');
  assert.ok(f.project.ignoredHandoffs.includes('handoff-x.md'));

  /* an entry point with its text and the file it names; a cite into a folder from outside it; a code reader */
  const claude = f.entryPoints.find((e) => e.file === 'CLAUDE.md');
  assert.ok(claude.text.includes('force-push') && claude.names.some((n) => n.file === 'handoff/STATE.md'));
  assert.ok(plans.cites.from.some((c) => c.startsWith('CLAUDE.md:')));
  assert.ok(folder('reviews').codeReaders.from.some((c) => c.startsWith('tests/check.mjs:')));
  assert.ok(folder('logs').codeReaders.from.includes('tools/sync/paths.json:2'));
  assert.ok(folder('tools/notes').codeReaders.from.includes('tools/sync/paths.json:3'));
  assert.ok(!(folder('notes').codeReaders || { from: [] }).from.some((c) => c.startsWith('tools/sync/')));
  assert.ok(folder('notes').codeReaders.from.includes('tools/root.json:2'));
  assert.ok(!folder('logs').codeReaders.from.some((c) => c.startsWith('tools/sync/notes.json')));
  assert.ok(f.claude.some((c) => /force-push/.test(c.clause)), 'the CLAUDE.md clauses');

  /* the board: the answered question with its answer clipped, open tasks only, the earlier import with its refs */
  const q = f.board.questions.find((x) => x.id === 'Q5');
  assert.ok(q.answer.startsWith('5a') && q.answer.length <= 200);
  assert.deepEqual(f.board.openTasks.map((x) => x.id), ['T-1']);
  assert.deepEqual(f.board.imported[0].refs, ['onboard:fact:handoff/STATE.md#L2']);

  /* bounded subjects, and nothing judged */
  const notes = folder('notes');
  assert.equal(notes.commits, 15);
  assert.equal(notes.subjects.length, 12);
  assert.ok(notes.subjects[0].includes('note 15') && notes.subjects.at(-1).endsWith('note 1') && notes.subjects.every((s) => s.length <= 131));
  assert.ok(f.folders.every((x) => !('role' in x) && !('end' in x)));
  assert.ok(!existsSync(join(p.work, 'proposal.json')), 'the session writes the proposal');

  /* the second run reads the map: a source unchanged, one changed, an answered call whose subject is unchanged,
     each folder marked since the last run, and an earlier import's track without the label seeding its source paths;
     an untracked source unedited since reads unchanged, as does the git-ignored CLAUDE.local.md a call names, and one
     under a folder the handover deleted is retired */
  const blob = (f) => execFileSync('git', ['rev-parse', 'HEAD:' + f], { cwd: p.dir, encoding: 'utf8' }).trim();
  const seen = JSON.parse(readFileSync(join(p.work, 'facts-map.json'), 'utf8'));
  /* a keep whose reader still names it holds; one whose reader is gone, one with no evidence and one kept
     until a track's next handoff, which came, are judged again */
  const keep = (folder, evidence) => ({ key: 'folder:' + folder, kind: 'folder', subject: folder, fate: 'keep', why: 'kept', ...(evidence ? { evidence } : {}) });
  const judged = [keep('reviews/', { readers: ['tests/check.mjs'] }), keep('notes/', { readers: ['tools/gone.mjs'] }), keep('docs/plans/'),
    keep('logs/', { until: { track: 'TR-2', seen: 'TR-2.2' } })];
  const run = { source: 'run:r1', kind: 'run', at: '2026-04-26T00:00:00Z', detail: { folders: seen.folders, judged, left: [
    { item: 'checkup:a', source: 'handoff/STATE.md', hash: blob('handoff/STATE.md') }, { item: 'checkup:b', source: 'logs/run-1.md', hash: 'an older blob' }] } };
  const map = { last: run, rows: [run, { source: 'handoff/STATE.md', kind: 'file', hash: blob('handoff/STATE.md'), records: ['T-1'] },
    { source: 'logs/run-1.md', kind: 'file', hash: 'an older blob', records: ['K-2'] },
    { source: 'call:dormant', kind: 'call', answer: 'a', detail: { ask: 'Which plans?', subjects: { 'CLAUDE.md': blob('CLAUDE.md'), 'old/plan.md': 'its blob then', 'CLAUDE.local.md': null } } },
    { source: 'loose/idea.md', kind: 'file', records: ['K-2'] }, { source: 'CLAUDE.local.md', kind: 'file', records: ['K-2'] }, { source: 'old/', kind: 'folder', fate: 'delete', sha: 'abc' },
    { source: 'old/rules.md', kind: 'file', hash: 'its blob then', records: ['T-1'] }, { source: 'old-notes.md', kind: 'file', fate: 'delete', sha: 'def', records: ['T-1'] }] };
  p.commit('2026-05-01', { 'fresh/new.md': '# New\n' }, 'a new folder');
  p.put({ 'loose/idea.md': '# An idea git never saw\n', 'CLAUDE.local.md': '# Mine\n\n- Answer in short lines.\n' });
  const textHash = (f) => execFileSync('git', ['hash-object', f], { cwd: p.dir, encoding: 'utf8' }).trim();
  map.rows.find((r) => r.source === 'loose/idea.md').hash = textHash('loose/idea.md');
  map.rows.find((r) => r.source === 'CLAUDE.local.md').hash = map.rows.find((r) => r.kind === 'call').detail.subjects['CLAUDE.local.md'] = textHash('CLAUDE.local.md');
  const track = { id: 'TR-2', name: 'Old line', state: 'parked', parkReason: 'waits on the mixer', handoff: 'TR-2.3', unpark: 'when T-1 Wire the bus completes', labels: ['imported'], refs: ['handoff-import:WS-7', p.dir.replace(/\\/g, '/') + '/reviews/wave-1.md', 'notes/n1.md'] };
  const again = survey(p.dir, { work: p.work, cli, env: { ...env, STUB_MAP: JSON.stringify(map), STUB_TRACKS: JSON.stringify([track]),
    STUB_PROFILES: JSON.stringify([{ profile: 'proj', records: [p.dir], settings: { 'rules.add': [{ slug: 'bus-rate', text: 'Run the bus at 48 kHz.', from: 'K-3' }] } }]) } }).facts;
  const state = Object.fromEntries(again.conversion.sources.map((x) => [x.source, x.state]));
  assert.deepEqual(state, { 'handoff/STATE.md': 'unchanged', 'logs/run-1.md': 'changed', 'loose/idea.md': 'unchanged', 'CLAUDE.local.md': 'unchanged', 'old/rules.md': 'retired', 'old-notes.md': 'retired', 'reviews/wave-1.md': 'seeded', 'notes/n1.md': 'seeded' });
  assert.equal(again.conversion.calls[0].state, 'unchanged');
  /* a single file's end carries its fate and commit as a folder's does; a finding left out stays left while its source is unchanged */
  assert.equal(again.conversion.folders.find((x) => x.folder === 'old-notes.md').at, 'def');
  assert.deepEqual(again.conversion.left.map((l) => [l.item, l.state]), [['checkup:a', 'unchanged'], ['checkup:b', 'changed']]);
  const since = (path) => again.folders.find((x) => x.path === path).since;
  assert.deepEqual([since('notes'), since('docs/plans'), since('fresh')], ['unchanged', 'unchanged', 'new']);
  assert.ok(again.board.imported.some((x) => x.id === 'TR-2'), 'the earlier import is listed as imported');
  /* the doctor reads its board from the facts: a park's condition, a track's refs, a profile's holders and a line's ruling */
  const tr = again.board.tracks.find((x) => x.id === 'TR-2');
  assert.ok(tr.unpark && tr.refs.includes('notes/n1.md'));
  assert.deepEqual([again.board.profiles[0].records, again.board.profiles[0].lines[0].from], [[p.dir], 'K-3']);
  /* a seed says which records name the file, so the plan knows a track's ref holds only its work */
  assert.deepEqual(again.conversion.sources.find((x) => x.source === 'notes/n1.md').kinds, ['track']);
  const states = Object.fromEntries(again.conversion.judgments.map((j) => [j.subject, j.state]));
  assert.deepEqual(states, { 'reviews/': 'holds', 'notes/': 'rejudge', 'docs/plans/': 'rejudge', 'logs/': 'rejudge' });
  assert.match(again.conversion.judgments.find((j) => j.subject === 'logs/').because.join(), /TR-2\.3/);
});

/* which instruction files Claude reads by the Project instructions setting, and the rule files
   around them with what loads each and the cites that are gone */
test('the survey says which instruction files Claude reads and lists each rule file with its loaders and gone cites', (t) => {
  const p = project(t);
  p.commit('2026-01-10', { 'tools/old.ps1': 'Write-Host old\n', 'Assets/Scripts/Player.cs': 'class Player {}\n', 'ProjectSettings/ProjectVersion.txt': '6000.0\n', 'out/build.log': 'built\n' }, 'tools: the old script');
  p.commit('2026-02-10', {
    'AGENTS.md': '# Agents\n\n- Run the tests before a push.\n- The project is described in README.md.\n- Rule bodies live in rule-bodies/.\n',
    'README.md': '# Proj\n',
    '.claude/rules/unity.md': '---\npaths:\n  - "Assets/**/*.cs"\n  - "README.md"\n---\n\nRun tools/old.ps1 after an edit.\nThe gotchas: rule-bodies/unity.md\nBodies live in rule-bodies/.\n'
      + 'The player: Assets/Scripts/Player.cs; the build writes out/build.log.\n',
    'rule-bodies/unity.md': 'Never bake lights in play mode.\n',
    '.claude/settings.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/load.mjs' }] }] } }),
    '.claude/hooks/load.mjs': "console.log(readFileSync('rule-bodies/unity.md', 'utf8'));\nconsole.log('Project notes: README.md');\n",
    '.claude/hooks/inject.mjs': "import { readFileSync } from 'node:fs';\nconst FILES = ['rule-bodies/session.md'];\nfor (const f of FILES) process.stdout.write(readFileSync(f, 'utf8'));\n",
    'rule-bodies/session.md': 'Ask before a schema migration.\n',
    /* a body named on two lines of one menu, each with its own globs */
    '.claude/rules/code.md': '---\npaths:\n  - "src/api/**"\n  - "**/*.sql"\n---\n- `src/api/**`: read rule-bodies/api.md\n- `.sql` files: read rule-bodies/sql.md and rule-bodies/api.md\n',
    'rule-bodies/api.md': 'Validate every request body.\n', 'rule-bodies/sql.md': 'Name every index.\n',
    '.mcp.json': JSON.stringify({ mcpServers: { rules: { command: 'node', args: ['tools/serve.mjs'] } } }),
    'tools/serve.mjs': "serve(readFileSync('.claude/rules/unity.md'));\n",
    '.agents/skills/rules/SKILL.md': '# Rules\n\nRead .claude/rules/unity.md before an edit.\n',
    /* a workstream's handoff protocol, its standing rules read only through its resume section */
    'docs/plans/ui/handoff/README.md': '# Handoff\n\n## Resume (read in this order)\n\n1. [now.md](now.md): where things stand.\n2. [rules.md](rules.md): standing rules.\n\n## Writing a handoff\n\nUpdate now.md.\n',
    'docs/plans/ui/handoff/now.md': '# Now\n\n- The grid is half done.\n',
    'docs/plans/ui/handoff/rules.md': '# Standing rules\n\n## Model routing (the user, 2026-09-20)\n\n- Opus authors the views.\n',
  }, 'the rules');
  /* the Unity project moves into game/, and the build log leaves git for the disk */
  const g = (...a) => execFileSync('git', a, { cwd: p.dir });
  g('rm', '-q', 'tools/old.ps1');
  mkdirSync(join(p.dir, 'game'));
  g('mv', 'Assets', 'game/Assets');
  g('mv', 'ProjectSettings', 'game/ProjectSettings');
  g('rm', '-q', '--cached', 'out/build.log');
  p.put({ '.gitignore': 'out/\n' });
  g('add', '.gitignore');
  g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'tools: drop the old script');
  const home = join(p.base, 'home');
  mkdirSync(home);
  const run = () => survey(p.dir, { work: p.work, board: false, managed: join(p.base, 'managed'), env: { ...process.env, CLAUDE_CONFIG_DIR: home } }).facts;
  const f = run();
  /* the default setting reads AGENTS.md only where no CLAUDE.md sits at the root or above it (a folder with no
     ancestors on disk, so this machine's own files take no part); the user's CLAUDE.md is memory, never an ancestor's */
  const agentsRead = (have) => instructionFiles('Z:/none/proj', [''], new Set(have), { mode: 'claude-md-or-agents-md' }).files.find((x) => x.file === 'AGENTS.md').read;
  assert.deepEqual([agentsRead(['AGENTS.md']), agentsRead(['AGENTS.md', 'CLAUDE.md'])], ['start', false]);
  const memory = join(p.base, '.claude', 'CLAUDE.md');
  mkdirSync(dirname(memory));
  writeFileSync(memory, '# my own rules');
  const above = (mem) => (instructionFiles(p.dir, [''], new Set(), { mode: 'claude-md-or-agents-md' }, { memory: mem }).above || []).filter((x) => x.includes(basename(p.base) + '/.claude/'));
  assert.deepEqual([above([]).length, above([memory]).length], [1, 0]);
  assert.equal(f.instructions.setting.mode, 'claude-md-or-agents-md');
  assert.ok(f.claude.some((c) => c.file === 'AGENTS.md' && /tests before a push/.test(c.clause)), 'AGENTS.md has its own ledger');
  const rule = f.ruleFiles.find((x) => x.file === '.claude/rules/unity.md');
  /* a cite under the nested Unity project, or on disk though git ignores it, is no gone cite */
  assert.deepEqual([rule.loads[0].by, rule.loads[0].paths, rule.cites.gone.map((x) => x.path)], ['rules', ['Assets/**/*.cs', 'README.md'], ['tools/old.ps1']]);
  assert.ok(f.ruleFiles.find((x) => x.file === '.claude/hooks/load.mjs').loads.some((l) => l.by === 'hook' && l.event === 'SessionStart'));
  /* a server .mcp.json runs from the repo is a loader named in its loads, and the plan sees what it reads; so is a Codex skill under .agents/ */
  assert.deepEqual(f.ruleFiles.find((x) => x.file === 'tools/serve.mjs').loads.map((l) => [l.by, l.server]), [['server', 'rules']]);
  assert.deepEqual(loadersOf(f.ruleFiles)['.claude/rules/unity.md'].sort(), ['.agents/skills/rules/SKILL.md', 'tools/serve.mjs']);
  /* a rules menu loads the body it names on its own globs, wherever the body sits; the hook loads the body it reads and
     only names the README, which stays loaded by AGENTS.md alone, as the menu's `paths:` never loads it; a folder that
     AGENTS.md or the menu names loads none of its files, and AGENTS.md's entry notes it */
  assert.deepEqual([loadersOf(f.ruleFiles)['rule-bodies/unity.md'], scopesOf(f.ruleFiles)['rule-bodies/unity.md']], [['.claude/hooks/load.mjs', '.claude/rules/unity.md'], ['Assets/**/*.cs', 'README.md']]);
  assert.deepEqual(['api', 'sql'].map((b) => scopesOf(f.ruleFiles, p.dir)['rule-bodies/' + b + '.md'].sort()), [['**/*.sql', 'src/api/**'], ['**/*.sql']], 'each line naming a body gives it its globs');
  assert.deepEqual(f.ruleFiles.find((x) => x.file === 'README.md').loads.map((l) => l.by), ['pointer']);
  assert.deepEqual(f.ruleFiles.find((x) => x.file === 'rule-bodies/unity.md').loads.map((l) => l.by), ['hook', 'menu']);
  /* a script reading paths it keeps in a constant loads each, and the body joins the rule files */
  assert.deepEqual(loadersOf(f.ruleFiles)['rule-bodies/session.md'], ['.claude/hooks/inject.mjs']);
  assert.deepEqual(f.instructions.files.find((x) => x.file === 'AGENTS.md').folders, ['rule-bodies/:5']);
  const handoff = (n) => f.ruleFiles.find((x) => x.file === 'docs/plans/ui/handoff/' + n) || {};
  assert.deepEqual(['README.md', 'now.md', 'rules.md'].map((n) => handoff(n).role), ['entry', 'resume', 'rules']);
  assert.deepEqual(handoff('rules.md').loads, [{ by: 'handoff', from: 'docs/plans/ui/handoff/README.md:6' }], 'the resume section loads the standing rules');
  /* the user's setting reads CLAUDE.md only: AGENTS.md is not read */
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ pluginConfigs: { 'cc-plugin-agents-md@builtin': { options: { instructionFiles: 'claude-md' } } } }));
  assert.equal(run().instructions.files.find((x) => x.file === 'AGENTS.md').read, false);
});
