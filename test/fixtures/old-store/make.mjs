/* How the stores in this folder were made: with the file store's own writers
   (lib/hub-store.mjs verbs, lib/threads.mjs createThread and writeHandoff, knowledge,
   procedures, profiles, steps), which the repo no longer carries, so it cannot run
   again; it says what each store holds. `node test/fixtures/old-store/make.mjs
   --write` ran it; under the test runner it does nothing. */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_MARK, FIXTURE_DIR, REPO_MARK, fixtureRepo, swapPath } from '../../helpers/old-store.mjs';

const PROC = `---
name: demo
title: Build the demo
summary: Run the build.
triggers:
  words: [build the demo]
repos: {}
---

# Build the demo

## Trigger

Someone asks for the demo build.

## Preconditions

- None.

## Steps

### 1. Build

Run the build.

## Verify

\`\`\`sh
node build.mjs
\`\`\`

- expect: exit 0.

## References

- \`build.mjs\`: the build.
`;

function procRepo(dir) {
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', windowsHide: true });
  mkdirSync(join(dir, 'docs', 'procedures'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'procedures', 'demo.md'), PROC);
  writeFileSync(join(dir, 'build.mjs'), '\n');
  git('init', '-q');
  for (const [k, v] of [['core.autocrlf', 'false'], ['user.email', 't@example.com'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git('config', k, v);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return dir.replace(/\\/g, '/');
}

async function make() {
  const hub = await import('../../../lib/hub-store.mjs');
  const th = await import('../../../lib/threads.mjs');
  const kn = await import('../../../lib/knowledge.mjs');
  const pr = await import('../../../lib/procedures.mjs');
  const pf = await import('../../../lib/profiles.mjs');
  const { addStep } = await import('../../../lib/steps.mjs');
  const NO_REPO = 'C:/no/such/repo';
  const stores = {};

  const fresh = () => {
    const base = mkdtempSync(join(tmpdir(), 'askerdo-freeze-')).replace(/\\/g, '/');
    const root = join(base, 'askerdo');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'settings.json'), '{ "storeGit": false }\n');
    return { base, root };
  };

  /* kinds: one of every kind the old writers made (test/board-store.test.mjs) */
  {
    const s = fresh();
    const { root } = s;
    const ws = await hub.createRecord(root, 'workstream', { name: 'board server', description: 'One board.' });
    const plan = await hub.createRecord(root, 'plan', { name: 'storage core', workstream: ws.id, description: 'Tables first.' });
    const task = await hub.createRecord(root, 'task', { name: 'the renderer', workstream: ws.id, plan: plan.id, description: 'Bytes back.', intent: 'Every file.' });
    await hub.noteRecord(root, task.id, 'First pass landed.\n\nA second paragraph: with a colon.');
    await hub.noteRecord(root, ws.id, 'Opened.');
    const options = [
      { type: 'a', option: 'one file', getsYou: 'simple', costsYou: 'contention' },
      { type: 'b', option: 'a server', getsYou: 'one writer', costsYou: 'a box to run' },
    ];
    const q = await hub.register(root, { name: 'where the board lives', gist: 'Where should it live?', blocking: true, session: 'sess-a', projectDir: 'C:/repos/app', options, gates: [task.id] });
    await hub.answer(root, q.id, { pick: 'b', note: 'one writer' });
    await hub.answer(root, q.id, { pick: 'a', note: 'changed my mind', amend: true });
    await hub.register(root, { name: 'still open', gist: 'Open?', blocking: false, session: 'sess-b', projectDir: 'C:/repos/app', options });
    const thread = await th.createThread(root, { name: 'the build', goal: 'Ship it.', description: 'The line of work.' });
    await th.writeHandoff(root, thread.id, { focus: 'Write the tests next.', state: '## Now\n\nThe verbs exist.', whereWeWere: 'Mid design.', verifyFirst: [{ path: NO_REPO }] });
    await kn.createKnowledge(root, { type: 'gotcha', title: 'WAL needs a local disk', body: '# heading\n\nNot over FUSE.', projects: ['C:/repos/app'], labels: ['sqlite'] });
    await pr.scanProject(root, procRepo(join(s.base, 'repo')));
    await pf.profileDefine(root, 'deep-code', { set: ['agent.soft=400k'], description: 'deep' });
    mkdirSync(join(root, 'legacy'), { recursive: true });
    writeFileSync(join(root, 'legacy', 'id-map.jsonl'), JSON.stringify({ old: 'Q1', key: q.key, name: 'where', kind: 'question', closed: '', at: '2026-10-21' }) + '\n');
    writeFileSync(join(root, 'legacy', 'brain-map.json'), JSON.stringify({ source: 'test', roots: {}, ids: { 'app:G-0001': { to: task.key }, 'app:D-0002': { archive: 'archive/x.md' } } }, null, 2) + '\n');
    stores.kinds = s;
  }

  /* thread-plan: TH-1 with P-1 (T-1 on it), two handoffs TH-1.1 and TH-1.2, resumed by s2 (test/board-import.test.mjs) */
  {
    const s = fresh();
    const { root } = s;
    const ws = await hub.createRecord(root, 'workstream', { name: 'board server', description: 'One board.' });
    const plan = await hub.createRecord(root, 'plan', { name: 'storage core', workstream: ws.id, description: 'Tables first.' });
    await hub.createRecord(root, 'task', { name: 'the renderer', workstream: ws.id, plan: plan.id, description: 'Bytes back.' });
    const thread = await th.createThread(root, { name: 'the build', goal: 'Ship it.', description: 'The line of work.', links: [ws.id], session: 's1' });
    await th.writeHandoff(root, thread.id, { focus: 'First leg.', state: 'Started.', whereWeWere: 'Early.', verifyFirst: [{ path: NO_REPO }] });
    await th.writeHandoff(root, thread.id, { focus: 'Second leg.', state: 'Going.', whereWeWere: 'Mid.', verifyFirst: [{ path: NO_REPO }] });
    await th.resumeThread(root, thread.id, { session: 's2' });
    stores['thread-plan'] = s;
  }

  /* order: P-1 holds T-1 (ordinal 30), T-2 (10, completed), T-3 (20), and step "the schema" over T-4 (40) and T-5 (50); T-6 on no plan */
  {
    const s = fresh();
    const { root } = s;
    const ws = await hub.createRecord(root, 'workstream', { name: 'board server', description: 'One board.' });
    const plan = await hub.createRecord(root, 'plan', { name: 'storage core', workstream: ws.id, description: 'Tables first.' });
    const task = (name, more) => hub.createRecord(root, 'task', { name, workstream: ws.id, description: name + '.', ...more });
    await task('ship it', { plan: plan.id, ordinal: 30 });
    const done = await task('parse the input', { plan: plan.id, ordinal: 10 });
    await task('check the parse', { plan: plan.id, ordinal: 20 });
    const a = await task('tables', { plan: plan.id, ordinal: 40 });
    const b = await task('indexes', { plan: plan.id, ordinal: 50 });
    await task('a stray idea');
    await hub.editRecord(root, 'task', done.id, { status: 'completed' });
    await addStep(root, plan.id, { name: 'the schema', tasks: [a.id, b.id] });
    stores.order = s;
  }

  /* loose: TH-1's handoff TH-1.1 names the fixture repo (helpers/old-store.mjs fixtureRepo) with notes.txt loose */
  {
    const s = fresh();
    const { root } = s;
    const repo = fixtureRepo(mkdtempSync(join(tmpdir(), 'askerdo-freeze-repo-')));
    const ws = await hub.createRecord(root, 'workstream', { name: 'board server', description: 'One board.' });
    const thread = await th.createThread(root, { name: 'the build', goal: 'Ship it.', description: 'The line of work.', links: [ws.id] });
    await th.writeHandoff(root, thread.id, { focus: 'Go on.', state: 'Work.', whereWeWere: 'Mid.', verifyFirst: [{ path: repo }] });
    s.repo = repo;
    stores.loose = s;
  }

  for (const [name, s] of Object.entries(stores)) {
    const out = join(FIXTURE_DIR, name);
    rmSync(out, { recursive: true, force: true });
    /* the store's own state stays out: its lock, temp files, board secret and port, inbox and saved index */
    const skip = /[\\/](\.lock|[^\\/]*\.tmp-[^\\/]*|board|inbox|record-index\.json)$/;
    cpSync(s.root, out, { recursive: true, filter: (src) => !skip.test(src) });
    if (s.repo) swapPath(out, s.repo, REPO_MARK);
    swapPath(out, s.base, BASE_MARK);
  }
  const order = { question: hub.KEY_ORDER };
  for (const [kind, k] of Object.entries(hub.WORK_KINDS)) order[kind] = k.keys;
  writeFileSync(join(FIXTURE_DIR, 'key-order.json'), JSON.stringify(order, null, 2) + '\n');
  for (const s of Object.values(stores)) for (const d of [s.base, s.repo]) if (d) rmSync(d, { recursive: true, force: true });
}

if (process.argv[2] === '--write') await make();
