/* Procedures: the docs/procedures parse contract, staleness by evidence
 * over a throwaway git repo, the watcher's matching, the file openers and the
 * CLI verbs on a board (server-procedures has the board's card verbs). */
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pr from '../lib/procedures.mjs';
import * as pm from '../lib/proc-match.mjs';
import { cardKind, filesOf } from '../lib/record-refs.mjs';
import { agentChecks } from '../lib/mod-core.mjs';
import { childEnv, fixtureCopy, tempDir } from './helpers/sandbox.mjs';
import { cliRoute, runCli as cliRun } from './helpers/cli.mjs';
import { slicer } from './helpers/shard.mjs';

/* run as two files: this file takes cases 1, 3, 5 and on, procedures-2
   the rest, so the git-bound cases are spread across processes */
const mine = slicer(2);
const test = (...args) => (mine() ? nodeTest(...args) : undefined);

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, '..');

const slash = (p) => p.replace(/\\/g, '/');

const DEMO = `---
name: demo
title: Build the demo
summary: "Run the build with \`--check\` and read the symbol."
triggers:
  words: [build the demo, demo build]
  commands: ['scripts/build.mjs']
  files:
    - lib/*.mjs
    - glob: 'conf/**/*.json'
      contains: DEMO_KEY
repos: {}
---

# Build the demo

## Trigger

Someone asks for the demo build.

## Preconditions

- The tree is clean. check: \`git status --short\`

## Steps

### 1. Build

Edit \`lib/a.mjs\`: the \`SYMBOL\` constant. Also see \`lib/b.mjs\`.

\`\`\`sh
node scripts/build.mjs --check
\`\`\`

### 2. Look

\`\`\`text
not a command
\`\`\`

## Verify

\`\`\`sh
node scripts/build.mjs
\`\`\`

- expect: exit 0.

## References

- \`lib/a.mjs::SYMBOL\`: the symbol the build reads.
- \`scripts/build.mjs\`: the build.
- \`T-239\`: the procedure system.
`;

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

/* A repo holding one procedure, its referenced files, and the two non-procedures. */
function demoRepo() {
  /* built once per file and copied */
  return slash(fixtureCopy('askerdo-proc-', 'repo', buildDemo));
}

function buildDemo(dir) {
  mkdirSync(join(dir, 'docs', 'procedures'), { recursive: true });
  mkdirSync(join(dir, 'lib'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'procedures', 'demo.md'), DEMO);
  writeFileSync(join(dir, 'docs', 'procedures', 'README.md'), '# not a procedure\n');
  writeFileSync(join(dir, 'docs', 'procedures', '_template.md'), '---\nname: <name>\n---\n');
  writeFileSync(join(dir, 'lib', 'a.mjs'), 'export const SYMBOL = 1;\n');
  writeFileSync(join(dir, 'lib', 'b.mjs'), 'export const B = 1;\n');
  writeFileSync(join(dir, 'scripts', 'build.mjs'), "if (process.argv.includes('--check')) process.exit(0);\n");
  git(dir, 'init', '-q');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
}

function commitFile(dir, rel, text) {
  writeFileSync(join(dir, rel), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'edit ' + rel);
}

const parse = (text, name = 'demo.md') => pr.parseProcedure(text, name);
const broken = (from, to) => parse(DEMO.replace(from, to));

/* ---- the frontmatter subset ---- */

test('the YAML subset reads flow lists, quotes, a list of maps and an empty map', () => {
  const y = pr.parseYaml([
    'a: plain value',
    "b: 'it''s quoted: yes'",
    'c: "double: \\"q\\""',
    "d: [one, 'two, three', \"four\"]",
    'e: {}',
    'f:',
    '  - x',
    '  - glob: g',
    '    contains: k',
    'g:',
    '  inner: v # a comment',
  ].join('\n'));
  assert.deepEqual(y, {
    a: 'plain value', b: "it's quoted: yes", c: 'double: "q"', d: ['one', 'two, three', 'four'], e: {},
    f: ['x', { glob: 'g', contains: 'k' }], g: { inner: 'v' },
  });
  assert.throws(() => pr.parseYaml('a: x: y'), /quote a value that contains ": "/);
  assert.throws(() => pr.parseYaml('a: `cmd`'), /quote a value that starts with `/);
  assert.throws(() => pr.parseYaml('a:\n\t- x'), /tab/);
  assert.throws(() => pr.parseYaml('a: 1\na: 2'), /appears twice/);
});

/* ---- the file contract ---- */

test('the committed procedures and the demo parse; README and _template are never procedures', () => {
  for (const n of readdirSync(join(pluginRoot, 'docs', 'procedures')).filter((f) => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_'))) {
    const r = parse(readFileSync(join(pluginRoot, 'docs', 'procedures', n), 'utf8').replace(/\r\n/g, '\n'), n);
    assert.equal(r.ok, true, n + ': ' + r.errors.join('; '));
  }
  const r = parse(DEMO);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.proc.triggers, {
    words: ['build the demo', 'demo build'], commands: ['scripts/build.mjs'],
    files: [{ repo: 'self', glob: 'lib/*.mjs', contains: '' }, { repo: 'self', glob: 'conf/**/*.json', contains: 'DEMO_KEY' }],
  });
  assert.deepEqual(r.proc.commands.map((c) => c.section + ': ' + c.line), [
    'Preconditions: git status --short', 'Steps: node scripts/build.mjs --check', 'Verify: node scripts/build.mjs',
  ]);
  assert.deepEqual(r.proc.refs.map((x) => x.kind + ' ' + x.target), ['path lib/a.mjs::SYMBOL', 'path scripts/build.mjs', 'record T-239']);
});

test('each MUST of the contract is an error that keeps the file off the board', () => {
  const cases = [
    [broken('repos: {}', 'repos: {}\nowner: me'), /unknown frontmatter key: owner/],
    [parse(DEMO, 'other.md'), /name must equal the file name/],
    [parse(DEMO, 'Bad_Name.md'), /not a procedure name/],
    [broken('summary: "Run', 'summary: "' + 'x'.repeat(200) + ' Run'), /summary is over 200 characters/],
    [broken("  words: [build the demo, demo build]\n  commands: ['scripts/build.mjs']\n  files:\n    - lib/*.mjs\n    - glob: 'conf/**/*.json'\n      contains: DEMO_KEY\n", '  words: []\n'), /at least one non-empty list/],
    [broken('    - lib/*.mjs', '    - site:lib/*.mjs'), /names repo site, which repos does not list/],
    [broken('# Build the demo\n', '# Build a demo\n'), /the H1 must equal the title/],
    [broken('## Verify', '## Check'), /the H2 headings must be/],
    [broken('### 2. Look', '### 3. Look'), /no gaps \(found 3 after 1\)/],
    [broken('- expect: exit 0.', 'It exits 0.'), /"- expect: " bullet/],
    [broken('- `scripts/build.mjs`: the build.', '- scripts/build.mjs: the build.'), /one backticked target/],
    [broken('- `scripts/build.mjs`: the build.', '- `C:/x/build.mjs`: the build.'), /absolute/],
    [broken('## Preconditions\n\n- The tree', '## Preconditions\n\nThe tree'), /Preconditions holds only bullets/],
    [broken('## Steps\n\n', '## Steps\n\nIntro text.\n\n'), /## Steps holds only H3 steps/],
    [broken('---\nname: demo', 'name: demo'), /no frontmatter/],
  ];
  for (const [r, want] of cases) {
    assert.equal(r.ok, false, String(want));
    assert.ok(r.errors.some((e) => want.test(e)), want + ' not in: ' + r.errors.join('; '));
  }
});

test('command lines name their repo scripts and flags; PATH commands are not checked', () => {
  assert.deepEqual(pr.commandScripts('node scripts/build.mjs --check'), [{ script: 'scripts/build.mjs', flags: ['--check'] }]);
  assert.deepEqual(pr.commandScripts('T=$(mktemp -d); env -u ASKERDO_ROOT HOME="$T" node --test test/a.test.mjs'), []);
  assert.deepEqual(pr.commandScripts('tools/cc/claude.exe plugin test .'), [{ script: 'tools/cc/claude.exe', flags: [] }]);
  assert.deepEqual(pr.commandScripts('git status --short && ./tools/x.sh --go=1 | tail'), [{ script: 'tools/x.sh', flags: ['--go'] }]);
  assert.deepEqual(pr.commandScripts('pwsh -File bump-version.ps1'), []);
  assert.deepEqual(pr.commandScripts('pwsh bump-version.ps1 -Version 1'), [{ script: 'bump-version.ps1', flags: [] }]);
});

test('a quoted pipe stays one word and a bare command on PATH is not a missing file', () => {
  const dir = demoRepo();
  const proc = { ...parse(DEMO).proc, commands: [{ section: 'Steps', line: "curl.exe -s https://x | grep -E 'a|tools/gone.sh'" }] };
  assert.deepEqual(pr.judge(dir, proc, {}), []);
});

/* ---- staleness by evidence ---- */

test('staleness: a referenced file changed, a symbol gone, a flag gone, a script gone', () => {
  const dir = demoRepo();
  const proc = parse(DEMO).proc;
  assert.deepEqual(pr.judge(dir, proc, {}), [], 'fresh against the commit that wrote the file');
  assert.deepEqual(pr.lint(dir, proc), ['lib/b.mjs (in Steps) is not in References']);
  const head = git(dir, 'rev-parse', 'HEAD');
  commitFile(dir, 'lib/a.mjs', 'export const SYMBOL = 2;\n');
  assert.deepEqual(pr.judge(dir, proc, { self: head }), ['changed since ' + head.slice(0, 7) + ': lib/a.mjs (1 commit)']);
  const now = git(dir, 'rev-parse', 'HEAD');
  commitFile(dir, 'lib/a.mjs', 'export const OTHER = 2;\n');
  commitFile(dir, 'scripts/build.mjs', 'process.exit(0);\n');
  assert.deepEqual(pr.judge(dir, proc, { self: now }), [
    'changed since ' + now.slice(0, 7) + ': lib/a.mjs (1 commit)',
    'symbol gone: lib/a.mjs::SYMBOL',
    'changed since ' + now.slice(0, 7) + ': scripts/build.mjs (1 commit)',
    'flag gone: --check in scripts/build.mjs',
  ]);
  rmSync(join(dir, 'scripts', 'build.mjs'));
  const gone = pr.judge(dir, proc, { self: git(dir, 'rev-parse', 'HEAD') });
  assert.ok(gone.includes('gone: scripts/build.mjs'), gone.join('; '));
  assert.ok(gone.includes('command gone: scripts/build.mjs'), gone.join('; '));
  assert.ok(pr.judge(dir, proc, { self: 'f'.repeat(40) }).includes('the verified commit fffffff is not in the repo'));
});

/* ---- the watcher's matching ---- */

const CARD = {
  id: 'PR-2', name: 'Cut a release', slug: 'release', status: 'active', project: 'C:/src/proj', doc: 'docs/procedures/release.md',
  repos: { site: 'C:/src/site' }, words: ['release', 'version bump'], commands: ['bump-version.ps1'],
  files: ['**/*.csproj | PackageReference', 'site:public/*.html', '.claude-plugin/plugin.json'], stale: [],
};

test('a command matches inside a covered repo only; an edit matches its glob and contains', () => {
  const m = (tool, input, cwd = 'C:/src/proj') => pm.matchCall([CARD], { tool, input, cwd }).map((h) => h.why);
  assert.deepEqual(m('PowerShell', { command: '.\\Bump-Version.ps1 -Version 2' }), ['the command contains bump-version.ps1']);
  assert.deepEqual(m('Bash', { command: 'pwsh bump-version.ps1' }, 'c:\\src\\site\\sub'), ['the command contains bump-version.ps1']);
  assert.deepEqual(m('Bash', { command: 'pwsh bump-version.ps1' }, 'C:/src/other'), []);
  assert.deepEqual(m('Bash', { command: 'ls' }), []);
  assert.deepEqual(m('Edit', { file_path: 'C:\\src\\proj\\src\\deep\\App.csproj', new_string: '<PackageReference Include="x" />' }),
    ['the edit of src/deep/App.csproj matches **/*.csproj | PackageReference']);
  assert.deepEqual(m('Edit', { file_path: 'C:/src/proj/App.csproj', new_string: '<Compile />' }), []);
  assert.deepEqual(m('Write', { file_path: 'C:/src/site/public/index.html', content: 'x' }), ['the edit of public/index.html matches site:public/*.html']);
  assert.deepEqual(m('Write', { file_path: 'C:/src/site/public/deep/index.html', content: 'x' }), []);
  assert.deepEqual(m('MultiEdit', { file_path: '.claude-plugin/plugin.json', edits: [{ new_string: '"version"' }] }),
    ['the edit of .claude-plugin/plugin.json matches .claude-plugin/plugin.json']);
  assert.deepEqual(pm.matchCall([{ ...CARD, status: 'retired' }], { tool: 'PowerShell', input: { command: 'bump-version.ps1' }, cwd: 'C:/src/proj' }), []);
  assert.deepEqual(m('Bash', { command: 'ls # bump-version.ps1 next' }), [], 'a comment never matches');
  assert.ok(pm.globRe('**/*.md').test('a.md') && pm.globRe('**/*.md').test('x/y/a.md') && !pm.globRe('*.md').test('x/a.md'));
  /* a trigger of several words is the program and its arguments, never a mention */
  const run = (command) => pm.matchCall([{ ...CARD, commands: ['node --test', 'commit -m "release:'] }], { tool: 'Bash', input: { command }, cwd: 'C:/src/proj' }).length;
  for (const used of ['env -u ASKERDO_ROOT HOME=$T node --test test/a.test.mjs', 'cd x && "C:/Program Files/nodejs/node.exe" --test 2>&1 | tail -5',
    'git add -- a && git commit -m "release: 1.2.3" -- a']) assert.equal(run(used), 1, used);
  for (const said of ['grep -rn "node --test" docs', 'git commit -m "run node --test first"', 'ls # then node --test',
    'echo "git commit -m \\"release: 1.2.3\\""']) assert.equal(run(said), 0, said);
  /* a bare word is a program the command runs, a dotted one a file argument */
  const BOX = { ...CARD, commands: ['ssh', 'docker', 'install.sh', 'run-tests.mjs'] };
  const box = (command) => pm.matchCall([BOX], { tool: 'Bash', input: { command }, cwd: 'C:/src/proj' }).map((h) => h.why);
  for (const used of ['docker exec askerdo-board node cli.mjs status', 'ssh box "ls /mnt"', 'sudo DOCKER_HOST=x docker ps',
    'node scripts/run-tests.mjs test/a.test.mjs', 'bash server/unraid/install.sh']) assert.equal(box(used).length, 1, used);
  assert.deepEqual(box('docker ps'), ['the command runs docker']);
  /* a launcher's command is matched as what it runs; read-only inner commands stay unmatched */
  for (const used of ['ls | xargs -I {} docker image rm {}', 'find . -name x -exec docker rm {} \\;', 'wsl -d ubuntu -- docker ps',
    'pwsh -NoProfile -Command "docker ps"', 'bash -lc "cd x && node scripts/run-tests.mjs"', "node -e \"require('child_process').execSync('docker ps')\""])
    assert.equal(box(used).length, 1, used);
  for (const said of ['ls | xargs grep docker', 'find . -exec grep -l docker {} +', 'bash -c "echo docker"', "node -e \"console.log('docker ps')\""])
    assert.equal(box(said).length, 0, said);
  for (const said of ['grep -rn "without docker" docs/guide', 'node -e "// start docker first\nrun()"', 'git commit -m "fix install.sh"',
    'rg docker lib', 'git log -- server/unraid/install.sh', "cat > SKILL.md <<'EOF'\ndocker exec x\nEOF", 'node build.mjs # needs docker']) assert.equal(box(said).length, 0, said);
  /* a live-install card skips a command that sets the sandbox seam */
  const JOIN = { ...CARD, everywhere: true, live: true, commands: ['askerdo.mjs join'] };
  const join = (command) => pm.matchCall([JOIN], { tool: 'Bash', input: { command }, cwd: 'C:/x' }).length;
  assert.equal(join('node bin/askerdo.mjs join http://box:7700 code'), 1);
  assert.equal(join('ASKERDO_ROOT=/s/askerdo ASKERDO_SANDBOX_HOME=/s/h node bin/askerdo.mjs join http://box:7700 code'), 0);
  assert.equal(join('env -u ASKERDO_ROOT node bin/askerdo.mjs join http://box:7700 code'), 1);
});

test('the pointer note names the file and the run verb; a stale card says why', () => {
  const note = pm.procNote({ ...CARD, stale: ['gone: scripts/x.mjs'] }, 'the command contains bump-version.ps1');
  assert.ok(note.startsWith('AskerDo procedure pointer (nothing was blocked): the command contains bump-version.ps1, which is procedure PR-2 Cut a release.'));
  assert.ok(note.includes('C:/src/proj/docs/procedures/release.md'));
  assert.ok(note.includes('The card is stale (gone: scripts/x.mjs)'));
  assert.ok(note.includes('askerdo proc ran release clean'));
  assert.ok(!pm.procNote(CARD, 'x', { agent: true }).includes('proc ran'), 'T-12: a subagent is never asked to write the board');
  assert.ok(!/[\u2013\u2014]/.test(note));
  assert.deepEqual(pm.badgeOf({ ...CARD, flag: 'x', stale: ['y'] }).badge, 'flagged');
  assert.deepEqual(pm.badgeOf({ ...CARD, verifiedAt: '2026-10-20' }).badge, 'fresh');
  assert.deepEqual(pm.badgeOf(CARD).badge, 'never run');
});

test('/askerdo proc words, ran and scan parse; a deviated run needs its note', () => {
  assert.deepEqual(pm.parseProc('version bump'), { sub: 'find', words: 'version bump' });
  assert.deepEqual(pm.parseProc('ran release clean'), { sub: 'ran', name: 'release', result: 'clean', note: '' });
  assert.deepEqual(pm.parseProc('ran release Deviated "the tray step"'), { sub: 'ran', name: 'release', result: 'deviated', note: 'the tray step' });
  assert.match(pm.parseProc('ran release deviated').error, /needs a note/);
  assert.match(pm.parseProc('ran release').error, /^Usage/);
  assert.deepEqual(pm.parseProc('scan'), { sub: 'scan' });
  assert.match(pm.parseProc('').error, /^Usage/);
});

test('the Agent check names the testing rule only where a brief runs tests without it', () => {
  const ids = (prompt) => agentChecks({ prompt: 'Keep x-state.md. Final response under 2000 characters. ' + prompt }, { rules: {} }).map((s) => s.id);
  assert.deepEqual(ids('Fix the band.'), []);
  assert.deepEqual(ids('Fix the band and run the tests.'), ['tests']);
  assert.deepEqual(ids('Run only the test files you touch, one full run at the end.'), []);
  assert.deepEqual(ids('Run tests per docs/procedures/run-tests.md.'), []);
  assert.deepEqual(ids('Read your brief docs/briefs/lane.md, then run the suite.'), []);
  assert.deepEqual(ids('Targeted test files while working.'), ['tests'], 'half the rule is not the rule');
});

/* ---- the file openers ---- */

test('a procedure opens its steps file, its paths (a repo prefix read through repos) and its refs', () => {
  assert.equal(cardKind('PR-3'), 'procedure');
  const rec = { ...CARD, kind: 'procedure', paths: ['lib/a.mjs::SYMBOL', 'site:public/'], refs: ['T-239'] };
  assert.deepEqual(filesOf(rec), ['C:/src/proj/docs/procedures/release.md', 'C:/src/proj/lib/a.mjs', 'C:/src/site/public', 'T-239']);
});

/* ---- the CLI ---- */

/* A second checkout of the demo repo, on its own branch. */
function laneOf(dir) {
  const lane = slash(join(tempDir('askerdo-proc-'), 'lane'));
  git(dir, 'worktree', 'add', '-q', '-b', 'lane', lane);
  return lane;
}

/* the cards live on the board (server-procedures has the verbs); this PC parses,
   judges and finds the repo's main checkout, through the local route */
test('the proc verbs on a board: scan from a second checkout, find, ran, triggers, and show PR-n', async () => {
  const dir = demoRepo();
  const lane = laneOf(dir);
  const root = join(tempDir('askerdo-proc-'), 'askerdo');
  const env = childEnv({ ASKERDO_ROOT: root, ASKERDO_BOARD_URL: 'memory:procedures-cli' });
  const route = await cliRoute(root, env);
  try {
    const scan = await cliRun(['proc', 'scan', '--json'], { env, cwd: lane });
    assert.equal(scan.code, 0, scan.err);
    const made = JSON.parse(scan.out);
    assert.equal(made.created.length, 1);
    assert.equal(slash(made.project).toLowerCase(), dir.toLowerCase(), 'a second checkout scans for the main one');
    const id = made.created[0];
    const find = await cliRun(['proc', 'find', 'demo', 'build', '--json'], { env, cwd: dir });
    assert.deepEqual(JSON.parse(find.out).map((c) => c.id), [id]);
    const ran = await cliRun(['proc', 'ran', 'demo', 'deviated', '--note', 'skipped step 2', '--json'], { env, cwd: lane });
    assert.equal(ran.code, 0, ran.err);
    assert.equal(JSON.parse(ran.out).flag, 'skipped step 2');
    assert.equal((await cliRun(['proc', 'ran', 'demo', 'deviated'], { env, cwd: dir })).code, 1, 'a deviated run needs its note');
    /* a plugin card's fix goes to the plugin's repo, never the installed copy it was read from */
    const ew = await cliRun(['proc', 'ran', 'join-a-pc', 'deviated', '--note', 'x', '--json'], { env, cwd: dir });
    assert.equal(ew.code, 0, ew.err);
    const draft = JSON.parse(ew.out).draft;
    assert.ok(draft.includes('github.com/toxmox/askerdo') && !slash(draft).toLowerCase().includes(slash(pluginRoot).toLowerCase()), draft);
    const trig = JSON.parse((await cliRun(['proc', 'triggers', '--project', lane, '--no-scan', '--json'], { env, cwd: lane })).out);
    assert.deepEqual(trig.filter((c) => !c.everywhere).map((c) => [c.id, c.badge]), [[id, 'flagged']]);
    /* the plugin's own cards for every project come back beside the repo's, at the plugin's folder */
    assert.ok(trig.some((c) => c.everywhere && slash(c.path).toLowerCase().startsWith(slash(pluginRoot).toLowerCase() + '/')), JSON.stringify(trig.map((c) => c.path)));
    assert.equal(slash(trig[0].path).toLowerCase(), (lane + '/docs/procedures/demo.md').toLowerCase(), 'the watcher sees it at its own checkout');
    assert.equal(JSON.parse((await cliRun(['show', id, '--json'], { env, cwd: dir })).out).kind, 'procedure');
  } finally { await route.close(); }
});

test('git failing is not a verdict on the verified commit', () => {
  const dir = demoRepo();
  const proc = parse(DEMO).proc;
  const head = git(dir, 'rev-parse', 'HEAD');
  assert.deepEqual(pr.judge(dir, proc, { self: head }), []);
  assert.deepEqual(pr.judge(dir, proc, { self: 'f'.repeat(40) }), ['the verified commit fffffff is not in the repo']);
  const path = process.env.PATH;
  const Path = process.env.Path;
  process.env.PATH = '';
  if (Path !== undefined) process.env.Path = '';
  let reasons;
  try { reasons = pr.judge(dir, proc, { self: head }); } finally {
    process.env.PATH = path;
    if (Path !== undefined) process.env.Path = Path;
  }
  assert.deepEqual(reasons, ['not judged: git did not answer in the repo']);
});
