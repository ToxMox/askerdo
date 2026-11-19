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
import { decisionHits, turnCommands } from '../lib/decision-match.mjs';
import { childEnv, fixtureCopy, tempDir } from './helpers/sandbox.mjs';
import { cliRoute, runCli as cliRun } from './helpers/cli.mjs';
import { slicer } from './helpers/shard.mjs';
import { cardRow, cardText } from '../skills/onboard/cards.mjs';

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

/* a routine bullet from an old how-to section becomes a card that parses clean, with and without an expect */
test('a card written from an onboarding routine row parses clean, its steps and scripts carried', () => {
  const routine = (text, lead, target) => ({ title: lead, fields: { target, lead, sourceText: text, expect: (/expect[^.]*/.exec(text) || [])[0],
    commands: [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]), scripts: pr.commandScripts([...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]).join(' && ')) } });
  const one = cardText(routine('Rebuild the driver: `pwsh scripts/build-driver.ps1 -Clean`. Then run `node scripts/test.mjs --fast`, expect `0 fail`.', 'Rebuild the driver', 'docs/procedures/rebuild-the-driver.md'));
  const r = parse(one.text, one.name + '.md');
  assert.equal(r.ok, true, r.errors.join('; ') + '\n' + one.text);
  assert.deepEqual(r.proc.commands.map((c) => c.section + ': ' + c.line), ['Steps: pwsh scripts/build-driver.ps1 -Clean', 'Steps: node scripts/test.mjs --fast'], 'Verify reruns no step');
  const release = cardText(cardRow({ title: 'Release', fields: { steps: [{ text: 'Publish', run: 'npm publish' }], verify: { expect: 'the version is live', run: 'npm view . version' } } }, 'docs/procedures/release.md'));
  const rel = parse(release.text, release.name + '.md');
  assert.equal(rel.ok, true, rel.errors.join('; ') + '\n' + release.text);
  assert.deepEqual(rel.proc.commands.filter((c) => c.section === 'Verify').map((c) => c.line), ['npm view . version'], 'Verify runs the named check, never the publish');
  /* a step prints as written: its sentence never runs into its command, its heading is whole, a bare path is
     named and not run, its code keeps its lines, and an MCP tool is called, never fenced as a shell line */
  const code = 'Take a snapshot first:\n```python\nfrom snap import take\npre = take()\n```';
  const steps = [{ text: 'Rebuild the app (with `--clean`): run the build.', run: 'npm run build -- --clean' }, { text: 'Read `tools/snap.py` and `node-map.json` first.' },
    { text: code }, { text: 'Start a debug session.', run: 'mcp__ide__debugger_launch' }, { text: 'Check it (the CLI checks too.)', run: 'npm run check' },
    { text: 'Never run `node tools/publish.mjs --force` here.' }, 'Then run `npm test`.',
    { text: 'Build it with `mcp__a__b_c`.' }, { text: 'Probe the app and stamp the zip.', run: 'curl.exe -s http://localhost:5000/health\n(Get-Item out/app.zip).LastWriteTime' }];
  /* the item's summary, words and preconditions print; a generic program is never a trigger or a reference */
  const fields = { steps, summary: 'Rebuild the app clean and check it.', words: ['clean rebuild'], commands: ['wpr', 'tools/x.ps1'],
    preconditions: [{ text: 'The app is running', check: 'curl.exe -s http://localhost:5000/health' }] };
  const written = cardText(cardRow({ title: 'Rebuild', fields }, 'docs/procedures/rebuild.md'));
  const wr = parse(written.text, written.name + '.md');
  assert.equal(wr.ok, true, wr.errors.join('; ') + '\n' + written.text);
  /* an object step runs only its run: one that names a command fences none, a string step's command span runs */
  assert.deepEqual(wr.proc.commands.filter((c) => c.section !== 'Verify').map((c) => c.section + ': ' + c.line), ['Preconditions: curl.exe -s http://localhost:5000/health',
    'Steps: npm run build -- --clean', 'Steps: npm run check', 'Steps: npm test', 'Steps: curl.exe -s http://localhost:5000/health', 'Steps: (Get-Item out/app.zip).LastWriteTime']);
  assert.ok(wr.proc.refs.some((x) => x.target === 'tools/publish.mjs') && !(wr.proc.triggers.commands || []).includes('tools/publish.mjs'), written.text);
  assert.deepEqual([wr.proc.summary, wr.proc.triggers.words, wr.proc.triggers.commands], [fields.summary, ['rebuild', 'clean rebuild'], ['tools/x.ps1']]);
  assert.ok(!wr.proc.refs.some((x) => /curl/.test(x.target)), written.text);
  /* a step's body follows its heading without repeating it; a tool name keeps its underscores; a run is one fence in the shell any PowerShell line needs */
  assert.ok(!/[.!?;:]["')\]]*: `/.test(written.text) && written.text.split('Rebuild the app (with').length === 2, written.text);
  assert.ok(/### 8\. .*`mcp__a__b_c`/.test(written.text) && /```powershell\ncurl\.exe[^\n]*\n\(Get-Item[^\n]*\n```/.test(written.text), written.text);
  assert.ok(['tools/snap.py', 'node-map.json'].every((p) => wr.proc.refs.some((x) => x.target === p)), 'a path the step names is a reference');
  assert.ok(written.text.includes(code.split('\n').slice(1).join('\n')) && written.text.includes('mcp__ide__debugger_launch'), written.text);
  assert.deepEqual(r.proc.refs.map((x) => x.target), ['scripts/build-driver.ps1', 'scripts/test.mjs']);
  const bare = cardText(routine('Run the tests: `npm test`.', 'Run the tests', 'docs/procedures/run-the-tests.md'));
  const b = parse(bare.text, bare.name + '.md');
  assert.equal(b.ok, true, b.errors.join('; ') + '\n' + bare.text);
  assert.deepEqual(b.proc.refs.map((x) => x.target), ['docs/procedures/run-the-tests.md'], 'a card with no repo script names itself');
});

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
  /* a build output git ignores need not be a reference */
  mkdirSync(join(dir, 'out'));
  writeFileSync(join(dir, 'out', 'app.exe'), 'x');
  writeFileSync(join(dir, '.git', 'info', 'exclude'), 'out/\n');
  /* a path the steps send a session to that a commit deleted is read; one the repo never held, a placeholder and a URL are not */
  commitFile(dir, 'lib/gone.mjs', 'x\n');
  git(dir, 'rm', '-q', 'lib/gone.mjs');
  git(dir, 'commit', '-q', '-m', 'drop lib/gone.mjs');
  const named = ['out/app.exe', 'out/later.zip', 'lib/gone.mjs', 'lib/never.mjs', 'docs/<name>.md', 'https://x/y.md'].map((token) => ({ section: 'Steps', token }));
  assert.deepEqual(pr.lint(dir, { ...proc, backticks: proc.backticks.concat(named) }).map((w) => w.split(' ')[0]), ['lib/b.mjs', 'lib/gone.mjs']);
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
  /* judged at a commit (the vouch's before), the files are read as that commit holds them, not on disk */
  const at = git(dir, 'rev-parse', 'HEAD');
  const then = pr.judge(dir, proc, {}, { head: at });
  assert.deepEqual(['gone: scripts/build.mjs', 'command gone: scripts/build.mjs', 'flag gone: --check in scripts/build.mjs'].map((x) => then.includes(x)), [false, false, true], then.join('; '));
  /* a References bullet the handover noted with git is history, never gone */
  const noted = parse(DEMO.replace('`scripts/build.mjs`: the build.', '`scripts/build.mjs`: the build. (in git at ' + at.slice(0, 10) + ')')).proc;
  assert.ok(!pr.judge(dir, noted, { self: at }).includes('gone: scripts/build.mjs'));
});

/* ---- the watcher's matching ---- */

const CARD = {
  id: 'PR-2', name: 'Cut a release', slug: 'release', status: 'active', project: 'C:/src/proj', doc: 'docs/procedures/release.md',
  repos: { site: 'C:/src/site' }, words: ['release', 'version bump'], commands: ['bump-version.ps1'],
  files: ['**/*.csproj | PackageReference', 'site:public/*.html', '.claude-plugin/plugin.json'], stale: [],
};

test('a command matches inside a covered repo only; an edit matches its glob and contains', () => {
  const m = (tool, input, cwd = 'C:/src/proj') => pm.matchCall([CARD], { tool, input, cwd }).map((h) => h.why);
  assert.deepEqual(m('PowerShell', { command: '.\\Bump-Version.ps1 -Version 2' }), ['the command runs bump-version.ps1']);
  assert.deepEqual(m('Bash', { command: 'pwsh bump-version.ps1' }, 'c:\\src\\site\\sub'), ['the command runs bump-version.ps1']);
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
  /* a bare word is a program the command runs, a dotted one a file it runs (never a git add or cp of it) */
  const BOX = { ...CARD, commands: ['ssh', 'docker', 'install.sh', 'run-tests.mjs', 'check.py'] };
  const box = (command) => pm.matchCall([BOX], { tool: 'Bash', input: { command }, cwd: 'C:/src/proj' }).map((h) => h.why);
  for (const used of ['docker exec askerdo-board node cli.mjs status', 'ssh box "ls /mnt"', 'sudo DOCKER_HOST=x docker ps',
    'node scripts/run-tests.mjs test/a.test.mjs', 'bash server/unraid/install.sh', 'pytest tests/check.py', 'uv run tests/check.py'])
    assert.equal(box(used).length, 1, used);
  assert.deepEqual(box('docker ps'), ['the command runs docker']);
  /* a decision's fragment inside a run path (the CLI under ~/.claude/askerdo) draws no pointer; the governed run still does */
  const ruled = [{ id: 'K-9', project: 'C:/src/proj', commands: ['/askerdo', 'scripts/build.mjs'] }];
  const ptr = (command) => decisionHits(ruled, { tool: 'Bash', input: { command }, cwd: 'C:/src/proj' }).length;
  assert.equal(ptr('node ~/.claude/askerdo/cli.mjs show T-1 --json'), 0);
  /* a slash command never matches a path argument ending in its name, only a prompt that runs it */
  assert.equal(ptr('node C:/Users/u/.claude/askerdo/cli.mjs list --project C:/src/askerdo'), 0);
  assert.equal(ptr('claude -p "/askerdo questions"'), 1);
  assert.equal(ptr('node C:/src/proj/scripts/build.mjs --check'), 1);
  /* a ruling naming no links takes the commands that ran something and no edited file, each pointing again */
  const turn = turnCommands([{ tool: 'Edit', input: { file_path: 'C:\\src\\proj\\lib\\a.mjs' } }, { tool: 'Write', input: { file_path: 'C:/elsewhere/b.md' } },
    { tool: 'Bash', input: { command: 'cd C:/src/proj && git status && git add -- lib/a.mjs && git commit -m x -- lib/a.mjs && git push origin dev && npm publish' } },
    { tool: 'Bash', input: { command: 'git push --force origin dev' } }, { tool: 'Bash', input: { command: 'git push -f origin main && git push origin --delete old' } },
    { tool: 'Bash', input: { command: 'node ~/.claude/askerdo/cli.mjs show T-1' } },
    { tool: 'Read', input: { file_path: 'C:/src/proj/README.md' } }]);
  /* the session's own git bookkeeping is no ruling's subject; a forced push may be */
  assert.deepEqual(turn, ['npm publish', 'git push --force origin', 'git push -f origin', 'git push origin --delete']);
  assert.equal(decisionHits([{ id: 'K-7', project: 'C:/src/proj', commands: turn }], { tool: 'Bash', input: { command: 'npm publish' }, cwd: 'C:/src/proj' }).length, 1);
  /* a read or a search points only at a glob marked for it; a search matches by its scope and pattern */
  const marked = [{ id: 'K-8', project: 'C:/src/proj', files: ['src/**', '(read) docs/index.md', '(search) lib/** | TODO'] }];
  const on = (tool, input, cwd = 'C:/src/proj') => decisionHits(marked, { tool, input, cwd }).map((h) => h.why);
  assert.deepEqual(on('Read', { file_path: 'C:\\src\\proj\\docs\\index.md' }), ['the read of docs/index.md matches (read) docs/index.md']);
  for (const [tool, input] of [['Read', { file_path: 'C:/src/proj/src/a.ts' }], ['Read', { file_path: 'C:/src/proj/docs/other.md' }],
    ['Edit', { file_path: 'C:/src/proj/docs/index.md', new_string: 'x' }], ['Grep', { pattern: 'todo', path: 'src' }],
    ['Grep', { pattern: 'fixme', path: 'lib' }], ['Glob', { pattern: 'docs/**/*.md' }]]) assert.deepEqual(on(tool, input), [], tool + ' ' + JSON.stringify(input));
  for (const [tool, input, cwd] of [['Grep', { pattern: 'TODO' }], ['Grep', { pattern: 'todo', path: 'C:/src/proj/lib/x' }],
    ['Grep', { pattern: 'TODO', glob: 'lib/**/*.mjs' }], ['Glob', { pattern: '**/*TODO*' }, 'C:/src/proj/lib']]) assert.equal(on(tool, input, cwd).length, 1, tool + ' ' + JSON.stringify(input));
  /* a shell read or search points as the tools do; a written file, an unknown flag, a variable path or a piped search stays silent */
  const sh = (command, shellCwd) => decisionHits(marked, { tool: 'Bash', input: { command }, cwd: 'C:/src/proj', shellCwd }).length;
  for (const [used, at] of [['rg -n TODO lib'], ['grep -rn todo'], ['cat docs/index.md 2>/dev/null | head -5'], ['Get-Content -Path docs/index.md -TotalCount 40'],
    ['Select-String -Path lib/*.mjs -Pattern TODO'], ['cat index.md', 'C:/src/proj/docs'], ['cd docs && sed -n 1,20p index.md'], ['rg TODO /c/src/proj/lib']])
    assert.equal(sh(used, at), 1, used);
  for (const said of ['rg -n FIXME lib', 'rg TODO src', 'echo x > docs/index.md', "cat > docs/index.md <<'EOF'\nx\nEOF", 'cat $D/index.md',
    'rg --no-such-flag TODO lib', 'git log | rg TODO', 'cd $X && cat docs/index.md', 'grep TODO']) assert.equal(sh(said), 0, said);
  /* an edit's contains word matches in any case, and an edit that does not write it stays silent */
  const worded = [{ id: 'K-6', project: 'C:/src/proj', files: ['lib/a.mjs | Opus'] }];
  const wrote = (new_string) => decisionHits(worded, { tool: 'Edit', input: { file_path: 'C:/src/proj/lib/a.mjs', new_string }, cwd: 'C:/src/proj' }).length;
  assert.equal(wrote('runBy: agent:opus'), 1);
  assert.equal(wrote('runBy: agent'), 0);
  /* a flag or an environment setting matches the run carrying it, never a read or a git command naming it */
  const TONE = { ...CARD, commands: ['--counter-tone', 'APP_DRY_RUN', 'APP_TEST_TONES=true'] };
  const tone = (command) => pm.matchCall([TONE], { tool: 'PowerShell', input: { command }, cwd: 'C:/src/proj' }).map((h) => h.why);
  assert.deepEqual(tone('& "C:/node/node.exe" tools/app-smoke.mjs app.exe out/x --asio-signal 512 --counter-tone --tone-peak 0.5'), ['the command runs with --counter-tone']);
  for (const used of ["$env:APP_DRY_RUN = '1'\nnode tools/noise-stream.js", 'APP_DRY_RUN=1 node tools/noise-stream.js',
    'flutter.bat build apk --dart-define=APP_TEST_TONES=true',
    /* Start-Process runs its -FilePath with its -ArgumentList */
    "(Start-Process app.exe -ArgumentList '--asio-signal','512','--counter-tone' -PassThru -Wait).ExitCode"]) assert.equal(tone(used).length, 1, used);
  for (const said of ['rg -- --counter-tone tools', 'grep -rn APP_DRY_RUN tools', "$env:APP_DRY_RUN = '1'", 'echo $env:APP_DRY_RUN',
    'git commit -m "APP_TEST_TONES=true" -- a', 'git log -S APP_DRY_RUN', 'node tools/noise-stream.js --counter-tones'])
    assert.equal(tone(said).length, 0, said);
  /* a launcher's command is matched as what it runs; read-only inner commands stay unmatched */
  for (const used of ['ls | xargs -I {} docker image rm {}', 'find . -name x -exec docker rm {} \\;', 'wsl -d ubuntu -- docker ps',
    'pwsh -NoProfile -Command "docker ps"', 'bash -lc "cd x && node scripts/run-tests.mjs"', "node -e \"require('child_process').execSync('docker ps')\""])
    assert.equal(box(used).length, 1, used);
  for (const said of ['ls | xargs grep docker', 'find . -exec grep -l docker {} +', 'bash -c "echo docker"', "node -e \"console.log('docker ps')\""])
    assert.equal(box(said).length, 0, said);
  for (const said of ['grep -rn "without docker" docs/guide', 'node -e "// start docker first\nrun()"', 'git commit -m "fix install.sh"',
    'rg docker lib', 'git log -- server/unraid/install.sh', "cat > SKILL.md <<'EOF'\ndocker exec x\nEOF", 'node build.mjs # needs docker',
    'git add -- server/unraid/install.sh && git commit -m "x" -- server/unraid/install.sh', 'git checkout -- scripts/run-tests.mjs',
    'cp server/unraid/install.sh /tmp/i.sh']) assert.equal(box(said).length, 0, said);
  /* a live-install card skips a command that sets the sandbox seam */
  const JOIN = { ...CARD, everywhere: true, live: true, commands: ['askerdo.mjs join'] };
  const join = (command) => pm.matchCall([JOIN], { tool: 'Bash', input: { command }, cwd: 'C:/x' }).length;
  assert.equal(join('node bin/askerdo.mjs join http://box:7700 code'), 1);
  assert.equal(join('ASKERDO_ROOT=/s/askerdo ASKERDO_SANDBOX_HOME=/s/h node bin/askerdo.mjs join http://box:7700 code'), 0);
  assert.equal(join('env -u ASKERDO_ROOT node bin/askerdo.mjs join http://box:7700 code'), 1);
});

test('the pointer note names the file and the run verb; a stale card says why', () => {
  const note = pm.procNote({ ...CARD, stale: ['gone: scripts/x.mjs'] }, 'the command runs bump-version.ps1');
  assert.ok(note.startsWith('AskerDo procedure pointer (nothing was blocked): the command runs bump-version.ps1, which is procedure PR-2 Cut a release.'));
  assert.ok(note.includes('C:/src/proj/docs/procedures/release.md'));
  assert.ok(note.includes('The card is stale (gone: scripts/x.mjs)'));
  assert.ok(note.includes('askerdo proc ran release clean'));
  assert.ok(!pm.procNote(CARD, 'x', { agent: true }).includes('proc ran'), 'T-12: a subagent is never asked to write the board');
  /* the mod records a command's run only for a card that opts in; then only a deviation is asked for */
  assert.deepEqual([pm.recordsRun(CARD, 'Bash'), pm.recordsRun({ ...CARD, record: 'command' }, 'PowerShell'), pm.recordsRun({ ...CARD, record: 'command' }, 'Edit')], [false, true, false]);
  const cmd = pm.procNote(CARD, 'x', { recorded: true });
  assert.ok(!cmd.includes('proc ran release clean') && /deviated.*--fixed.*--one-off.*--filed/.test(cmd));
  assert.ok(!pm.procNote(CARD, 'x', { agent: true, recorded: true }).includes('proc ran'));
  /* a sandboxed or agent-worktree run of the command is recorded by no one */
  assert.deepEqual(['ASKERDO_ROOT=/s/a node --test x', "$env:ASKERDO_SANDBOX_HOME = 'C:/s/h'; node --test x",
    'cd C:/r/.claude/worktrees/agent-a1 && node --test x', 'node --test x', 'env -u ASKERDO_ROOT node --test x', 'ASKERDO_ROOT= node --test x'].map((c) => pm.testRun(c)), [true, true, true, false, false, false]);
  assert.deepEqual([pm.testRun('node --test x', ['C:\\r\\.claude\\worktrees\\agent-a1']), pm.testRun('node --test x', ['C:/r/.claude/worktrees/feature'])], [true, false]);
  assert.ok(!/proc ran release (clean|deviated)/.test(pm.procNote(CARD, 'x', { recorded: true, test: true })));
  assert.ok(!/[\u2013\u2014]/.test(note));
  assert.deepEqual(pm.badgeOf({ ...CARD, flag: 'x', stale: ['y'] }).badge, 'flagged');
  assert.deepEqual(pm.badgeOf({ ...CARD, verifiedAt: '2026-10-20' }).badge, 'fresh');
  assert.deepEqual(pm.badgeOf(CARD).badge, 'never run');
});

test('/askerdo proc words, ran and scan parse; a deviated run needs its note', () => {
  assert.deepEqual(pm.parseProc('version bump'), { sub: 'find', words: 'version bump' });
  assert.deepEqual(pm.parseProc('ran release clean'), { sub: 'ran', name: 'release', result: 'clean', note: '' });
  assert.deepEqual(pm.parseProc('ran release Deviated "the tray step"'), { sub: 'ran', name: 'release', result: 'deviated', note: 'the tray step' });
  assert.deepEqual(pm.parseProc('ran release deviated "the tray step" --one-off "no tray change"'),
    { sub: 'ran', name: 'release', result: 'deviated', note: 'the tray step', oneOff: 'no tray change' });
  assert.equal(pm.parseProc('ran release deviated step 4 was off --filed T-12').filed, 'T-12');
  assert.match(pm.parseProc('ran release deviated').error, /needs a note/);
  assert.match(pm.parseProc('ran release').error, /^Usage/);
  assert.deepEqual(pm.parseProc('scan'), { sub: 'scan' });
  assert.deepEqual(pm.parseProc('scan --check'), { sub: 'scan', check: true });
  assert.match(pm.scanText({ project: 'C:/main', created: [], here: 'C:/wt' }), /main checkout.*C:.wt/);
  assert.match(pm.parseProc('').error, /^Usage/);
});

test('the Agent check names the testing rule only where a brief runs tests without it', () => {
  const ids = (prompt) => agentChecks({ prompt: 'Keep x-state.md. Final response under 2000 characters. ' + prompt }, { rules: {} }).map((s) => s.id);
  assert.deepEqual(ids('Fix the band.'), []);
  assert.deepEqual(ids('Fix the band and run the tests.'), ['tests']);
  assert.deepEqual(ids('Run the tests you change while working; do not run the full suite, the orchestrator does.'), []);
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
    /* --check reads the branch's own files and writes nothing, so the scan below still creates the card */
    writeFileSync(join(lane, 'docs', 'procedures', 'bad.md'), DEMO.replace('name: demo', 'name: bad').replace('`scripts/build.mjs`: the build.', '`scripts/gone.mjs`: the build.'));
    const check = await cliRun(['proc', 'scan', '--check', '--json'], { env, cwd: lane });
    assert.equal(check.code, 1, 'a file with errors fails the check');
    const files = JSON.parse(check.out).files;
    assert.deepEqual(files.map((x) => [x.name, x.errors.length > 0]), [['bad.md', true], ['demo.md', false]]);
    assert.ok(files[0].errors.includes('gone: scripts/gone.mjs'), files[0].errors.join('; '));
    const scan = await cliRun(['proc', 'scan', '--json'], { env, cwd: lane });
    assert.equal(scan.code, 0, scan.err);
    const made = JSON.parse(scan.out);
    assert.equal(made.created.length, 1);
    assert.equal(slash(made.project).toLowerCase(), dir.toLowerCase(), 'a second checkout scans for the main one');
    assert.equal(slash(made.here).toLowerCase(), lane.toLowerCase(), 'and says which checkout it was asked for');
    const id = made.created[0];
    const find = await cliRun(['proc', 'find', 'demo', 'build', '--json'], { env, cwd: dir });
    assert.deepEqual(JSON.parse(find.out).map((c) => c.id), [id]);
    /* a fix names a commit of this checkout that changed the card's file, which the PC reads in git */
    assert.equal((await cliRun(['proc', 'ran', 'demo', 'deviated', '--note', 'skipped step 2', '--fixed', 'f'.repeat(40)], { env, cwd: lane })).code, 1);
    const ran = await cliRun(['proc', 'ran', 'demo', 'deviated', '--note', 'skipped step 2', '--fixed', 'HEAD', '--json'], { env, cwd: lane });
    assert.equal(ran.code, 0, ran.err);
    assert.deepEqual([JSON.parse(ran.out).outcome.kind, JSON.parse(ran.out).outcome.ref], ['fixed', git(lane, 'rev-parse', 'HEAD')]);
    /* once a clean run verified HEAD, that commit no longer fixes a later deviation */
    assert.equal((await cliRun(['proc', 'ran', 'demo', 'clean'], { env, cwd: lane })).code, 0);
    assert.equal((await cliRun(['proc', 'ran', 'demo', 'deviated', '--note', 'skipped step 2', '--fixed', 'HEAD'], { env, cwd: lane })).code, 1);
    assert.equal((await cliRun(['proc', 'ran', 'demo', 'deviated'], { env, cwd: dir })).code, 1, 'a deviated run needs its note');
    const trig = JSON.parse((await cliRun(['proc', 'triggers', '--project', lane, '--no-scan', '--json'], { env, cwd: lane })).out);
    assert.notEqual(trig.find((c) => c.id === id).badge, 'flagged', 'a fixed card carries no flag');
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
