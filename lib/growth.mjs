/* how much work grew since the previous handoff, this PC's half: tests and
   lines per verify-first repo, with git off the event loop (the local server
   runs handoffs). A report only: a failed read says so and never stops a
   handoff. The board adds the tasks half and prints the line. */
import { execFile } from 'node:child_process';
import { captureCommit, subjectIds } from './commit-capture.mjs';

/* test files: under test/ or tests/, or named *.test.*, *_test.*, test_*.py, *Tests.cs */
const TEST_PATHS = [':(glob)**/test/**', ':(glob)**/tests/**', ':(glob)**/*.test.*', ':(glob)**/*_test.*',
  ':(glob)**/test_*.py', ':(glob)**/*Tests.cs'];
/* a line that declares a test; a heuristic, so the count is shown as "about" */
const DECLARES = /(?:^|[^\w.$])(?:test|it)(?:\.(?:only|skip|todo))?\s*\(|\bdef test_|\[(?:Test|Fact)\b/;

/* one deadline across every repo, well inside the mod's 60 s CLI call;
   a repo reached past it is not counted, and the handoff is written all the same */
const GROWTH_MS = 20000;

function run(path, args, deadline) {
  const left = deadline - Date.now();
  if (!(left > 0)) return Promise.resolve({ status: -1, out: '' });
  return new Promise((ok) => {
    try {
      execFile('git', ['-C', path, ...args], {
        encoding: 'utf8', timeout: Math.min(15000, left), windowsHide: true, maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      }, (err, stdout) => {
        if (err && typeof err.code !== 'number') return ok({ status: -1, out: '' });
        ok({ status: err ? err.code : 0, out: String(stdout || '') });
      });
    } catch {
      ok({ status: -1, out: '' });
    }
  });
}

const samePath = (a, b) => {
  const n = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

/* The newest earlier handoff's commit for this repo, or ''; `chain` is the
   track's handoffs oldest first, each with its verify summary. */
export function baselineOf(chain, path) {
  for (let i = chain.length - 1; i >= 0; i--) {
    const e = (chain[i].verify || []).find((x) => x && x.commit && samePath(x.path, path));
    if (e) return e.commit;
  }
  return '';
}

/* One repo from its baseline to its new commit: counted, noBaseline or notCounted. */
export async function repoGrowth(path, from, to, deadline = Date.now() + GROWTH_MS) {
  const git = (args) => run(path, args, deadline);
  if (!path || !to || (await git(['rev-parse', '--verify', '--quiet', to + '^{commit}'])).status !== 0) return { state: 'notCounted' };
  if (!from) return { state: 'noBaseline' };
  const anc = (await git(['merge-base', '--is-ancestor', from, to])).status;
  if (anc === -1) return { state: 'notCounted' };
  if (anc !== 0) return { state: 'noBaseline' };
  const [stat, diff] = await Promise.all([git(['diff', '--shortstat', '--no-color', from, to]),
    git(['diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', from, to, '--', ...TEST_PATHS])]);
  if (stat.status !== 0 || diff.status !== 0) return { state: 'notCounted' };
  const num = (re) => { const m = re.exec(stat.out); return m ? Number(m[1]) : 0; };
  const out = { state: 'counted', linesAdded: num(/(\d+) insertion/), linesRemoved: num(/(\d+) deletion/), testsAdded: 0, testsRemoved: 0 };
  let hunk = false;
  for (const line of diff.out.split('\n')) {
    if (line.startsWith('diff --git ')) hunk = false;
    else if (line.startsWith('@@')) hunk = true;
    else if (hunk && line[0] === '+' && DECLARES.test(line.slice(1))) out.testsAdded++;
    else if (hunk && line[0] === '-' && DECLARES.test(line.slice(1))) out.testsRemoved++;
  }
  return out;
}

/* The repo half a new handoff sends the board: `entries` its verify
   summary with commits, `chain` the track's earlier handoffs. */
export async function handoffRepoGrowth(entries, chain, budgetMs = GROWTH_MS) {
  const deadline = Date.now() + budgetMs;
  const repos = await Promise.all((entries || []).map((e) => repoGrowth(e && e.path, baselineOf(chain || [], e && e.path), e && e.commit, deadline)));
  const counted = repos.filter((r) => r.state === 'counted');
  const sum = (k) => counted.reduce((n, r) => n + r[k], 0);
  const count = (s) => repos.filter((r) => r.state === s).length || undefined;
  return {
    ...(counted.length ? {
      repos: counted.length, testsAdded: sum('testsAdded'), testsRemoved: sum('testsRemoved'),
      linesAdded: sum('linesAdded'), linesRemoved: sum('linesRemoved'),
    } : {}),
    noBaseline: count('noBaseline'), notCounted: count('notCounted'),
  };
}

/* the commits each repo gained over a range whose subject names a task, linked
   through `send` (offline commits, a script's, a teammate's); the board keys a link on
   repo, sha and task, so one sent again is a no-op. Never the unowned fallback here. */
export async function backfillCommits(ranges, send, { session = '', budgetMs = 10000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const git = (dir, args) => run(dir, args, deadline);
  let linked = 0;
  for (const { path, from, to } of ranges || []) {
    if (!path || !from || !to) continue;
    const log = await git(path, ['log', '--format=%H%x1f%s', '--max-count=500', from + '..' + to]);
    if (log.status !== 0) continue;
    for (const line of log.out.split('\n')) {
      const [sha, subject] = line.split(String.fromCharCode(31));
      if (!sha || !subjectIds(subject).length) continue;
      const r = await captureCommit(git, send, { dirs: [path], sha: sha.trim(), session, unowned: false });
      if (r && r.error) throw new Error(r.error);
      linked += r && r.linked ? r.linked.length : 0;
    }
  }
  return { linked };
}
