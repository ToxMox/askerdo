/* The old stores frozen under test/fixtures/old-store/ (its make.mjs wrote them with
   the file store's own writers): a copy per test, and the one git repo the loose
   store's handoff names, rebuilt to the same commit. */
import { cpSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFile } from '../../server/frontmatter.mjs';

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'old-store');
/* where the frozen files name the repo and the scratch tree they were made in */
export const REPO_MARK = 'C:/askerdo-fixture/repo';
export const BASE_MARK = 'C:/askerdo-fixture/base';

export const slugOf = (dir) => String(dir).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root';

/* fixed dates, so the commit hash is the one the frozen snapshot holds */
const GIT_ENV = { GIT_AUTHOR_DATE: '2026-10-25T09:00:00+00:00', GIT_COMMITTER_DATE: '2026-10-25T09:00:00+00:00' };

/* One commit of a.txt, then notes.txt left loose; returns the repo's path with forward slashes. */
export function fixtureRepo(dir) {
  const repo = dir.replace(/\\/g, '/');
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...GIT_ENV } }).trim();
  git('init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 't'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git('config', k, v);
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'one');
  writeFileSync(join(repo, 'notes.txt'), 'loose\n');
  return repo;
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));

/* Every spelling of `from` in a file's text (forward, back, JSON-escaped back) and its slug in names. */
export function swapPath(root, from, to) {
  const forms = (p) => [p, p.replace(/\//g, '\\'), p.replace(/\//g, '\\\\'), slugOf(p)];
  const [a, b] = [forms(from), forms(to)];
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    let out = text;
    for (let i = 0; i < a.length; i++) out = out.split(a[i]).join(b[i]);
    if (out !== text) writeFileSync(file, out);
    const name = file.slice(dirname(file).length + 1);
    if (name.includes(a[3])) renameSync(file, join(dirname(file), name.split(a[3]).join(b[3])));
  }
}

/* A copy of the frozen store `name` at `<dir>/askerdo`, its repo mark swapped for `repo`. */
export function oldStore(name, dir, repo) {
  const root = join(dir, 'askerdo');
  cpSync(join(FIXTURE_DIR, name), root, { recursive: true });
  if (repo) swapPath(root, REPO_MARK, repo);
  return root;
}

/* A record file as the old readers split it: the front, the text under the
   `# ` title (a question's gist), and each `## ` section's text trimmed. */
export function fileParts(text) {
  const { fields, rest } = splitFile(text);
  const lines = rest.split('\n');
  let i = 0;
  const gist = [];
  if (lines.some((l) => l.startsWith('# '))) {
    while (!lines[i].startsWith('# ')) i++;
    for (i++; i < lines.length && !lines[i].startsWith('## '); i++) gist.push(lines[i]);
  }
  const sections = {};
  while (i < lines.length) {
    if (!lines[i].startsWith('## ')) { i++; continue; }
    const head = lines[i++].slice(3).trim();
    const body = [];
    for (; i < lines.length && !lines[i].startsWith('## '); i++) body.push(lines[i]);
    sections[head] = body.join('\n').trim();
  }
  return { front: fields, gist: gist.join('\n').trim(), sections };
}

/* Today's front key order per kind, frozen from the old writers. */
let keyOrder;

/* A front's known keys sit in today's order (a key the order does not name may sit anywhere). */
export function inTodaysOrder(kind, keys) {
  keyOrder ||= JSON.parse(readFileSync(join(FIXTURE_DIR, 'key-order.json'), 'utf8'));
  const order = keyOrder[kind];
  if (!order) throw new Error('no frozen key order for ' + kind);
  return keys.filter((k) => order.includes(k)).join() === order.filter((k) => keys.includes(k)).join();
}
