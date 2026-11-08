#!/usr/bin/env node
/* how the cost of one board write moves with the board's size. Fills a scratch
   board through the CLI's own runCommand (the path the conversion write takes), then
   times the next writes per kind. Needs ASKERDO_ROOT and ASKERDO_SANDBOX_HOME set.
     node scripts/write-growth.mjs fill <board> --to N
     node scripts/write-growth.mjs measure <board> [--n 200] [--kinds task,knowledge,decision] [--bulk]
   <board> is file:<db> (in process) or an http(s) board server URL; --bulk writes as the conversion does,
   with no close-to hint on knowledge new. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../lib/cli-commands.mjs';
import { wakeIn } from '../server/handoff-text.mjs';

const [mode, board, ...rest] = process.argv.slice(2);
const flag = (k, d) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : d; };
if (!['fill', 'measure'].includes(mode) || !board) { console.error('usage: write-growth.mjs fill|measure <board> [--to N] [--n 200]'); process.exit(1); }
if (!process.env.ASKERDO_ROOT || !process.env.ASKERDO_SANDBOX_HOME) { console.error('set ASKERDO_ROOT and ASKERDO_SANDBOX_HOME first'); process.exit(1); }

const project = 'C:/scratch/write-growth';
const env = { ...process.env, ASKERDO_BOARD_URL: board };
const near = !rest.includes('--bulk');
delete env.CLAUDE_CODE_SESSION_ID;
const bodiesDir = join(process.env.ASKERDO_SANDBOX_HOME, 'write-growth-bodies');
mkdirSync(bodiesDir, { recursive: true });

async function cli(argv, stdin = '') {
  const r = await runCommand({ argv: [...argv, '--json'], cwd: process.cwd(), env, stdin, tty: false, near });
  if (r.code !== 0) throw new Error(argv.slice(0, 2).join(' ') + ': ' + (r.stderr || r.stdout));
  return JSON.parse(String(r.stdout).trim());
}

/* a realistic size of prose: a few hundred bytes, varied per record */
const words = 'board write record track task note ruling knowledge question handoff session growth index scan table journal'.split(' ');
const prose = (i, n) => Array.from({ length: n }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(' ') + '.';

let ws = null;
async function workstream() {
  if (ws) return ws;
  const list = await cli(['ws', 'list']).catch(() => []);
  const found = (Array.isArray(list) ? list : list.workstreams || []).find((w) => w.name === 'write-growth');
  ws = found ? found.id : (await cli(['ws', 'create'], JSON.stringify({ name: 'write-growth', description: 'write cost measurement', projects: [project] }))).id;
  return ws;
}

const kinds = {
  task: async (i) => cli(['task', 'create'], JSON.stringify({ unplaced: 'measurement', wake: wakeIn(), name: 'Task ' + i + ' ' + prose(i, 6), description: prose(i, 60),
    workstream: await workstream(), status: i % 3 ? 'open' : 'completed', priority: ['high', 'medium', 'low'][i % 3], labels: ['bench'] })),
  knowledge: async (i) => {
    const f = join(bodiesDir, 'k-' + process.pid + '.md');
    writeFileSync(f, prose(i, 80) + '\n');
    return cli(['knowledge', 'new', '--type', i % 2 ? 'gotcha' : 'decision', '--title', 'Knowledge ' + i + ' ' + prose(i, 5), '--project', project, '--label', 'bench', '--body-file', f]);
  },
  decision: async (i) => cli(['decide'], JSON.stringify({ title: 'Ruling ' + i + ' ' + prose(i, 5), words: prose(i, 12), body: prose(i, 40),
    projects: [project], workstreams: [await workstream()], labels: ['bench'] })),
};
/* the mix a converted project carries: mostly tasks, then knowledge, then rulings */
const mix = ['task', 'task', 'task', 'knowledge', 'task', 'decision', 'task', 'knowledge', 'task', 'task'];

let seq = Date.now() % 100000;
if (mode === 'fill') {
  const to = Number(flag('to', 300));
  let t0 = performance.now();
  for (let i = 0; i < to; i++) {
    await kinds[mix[i % mix.length]](seq++);
    if ((i + 1) % 500 === 0) { const dt = performance.now() - t0; console.log('filled ' + (i + 1) + ': last 500 at ' + (dt / 500).toFixed(2) + ' ms a write'); t0 = performance.now(); }
  }
} else {
  const n = Number(flag('n', 200));
  await workstream();
  const out = {};
  for (const k of String(flag('kinds', Object.keys(kinds).join(','))).split(',')) {
    const ms = [];
    for (let i = 0; i < n; i++) { const t = performance.now(); await kinds[k](seq++); ms.push(performance.now() - t); }
    ms.sort((a, b) => a - b);
    out[k] = { mean: +(ms.reduce((a, b) => a + b, 0) / n).toFixed(2), p50: +ms[n >> 1].toFixed(2), p90: +ms[Math.floor(n * 0.9)].toFixed(2) };
  }
  console.log(JSON.stringify(out));
}
