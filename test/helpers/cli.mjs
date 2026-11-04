/* The CLI run in-process: a spawned node costs a fresh interpreter and
 * every lib module loaded again, which on Windows is most of a CLI case's time.
 * A case that only reads a verb's output and exit code runs it here instead.
 *
 * One run at a time per process, because a run borrows the process globals the
 * verb reads: argv, env, cwd, stdin, exitCode. Each is put back afterwards.
 * Output is captured by async context, so a write the test runner makes while a
 * verb is running passes through untouched.
 *
 * Real processes stay where process behaviour is the subject: concurrent writers,
 * a hang under a watchdog, a crash's exit code, hooks reading their own stdin.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { PassThrough } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { childEnv } from './sandbox.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const CLI_PATH = join(here, '..', '..', 'bin', 'askerdo.mjs');
const CLI_URL = pathToFileURL(CLI_PATH).href;

const als = new AsyncLocalStorage();

/* patched once: a write inside a run lands in that run's buffer, any other passes */
for (const name of ['stdout', 'stderr']) {
  const stream = process[name];
  const write = stream.write;
  stream.write = function (chunk, encoding, cb) {
    const run = als.getStore();
    if (!run || run.closed) return write.apply(this, arguments);
    run[name] += typeof chunk === 'string' ? chunk
      : Buffer.from(chunk).toString(typeof encoding === 'string' ? encoding : 'utf8');
    const done = typeof encoding === 'function' ? encoding : cb;
    if (typeof done === 'function') process.nextTick(done);
    return true;
  };
}

function swapEnv(next) {
  const before = { ...process.env };
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, next);
  return () => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, before);
  };
}

let serial = Promise.resolve();
let runs = 0;

async function once(args, { env, cwd, input }) {
  const run = { stdout: '', stderr: '', closed: false };
  const stdin = new PassThrough();
  stdin.end(input === undefined || input === null ? '' : input);
  const stdinDesc = Object.getOwnPropertyDescriptor(process, 'stdin');
  const argv = process.argv;
  const exitCode = process.exitCode;
  const startDir = process.cwd();
  const restoreEnv = swapEnv(env || childEnv());
  try {
    Object.defineProperty(process, 'stdin', { configurable: true, enumerable: true, get: () => stdin });
    process.argv = [process.execPath, CLI_PATH, ...args];
    process.exitCode = undefined;
    if (cwd) process.chdir(cwd);
    /* a fresh query re-runs the entry's top level, so its store root is read from this env */
    await als.run(run, async () => {
      const mod = await import(CLI_URL + '?run=' + (++runs));
      await mod.done;
    });
    return { code: process.exitCode ?? 0, out: run.stdout, err: run.stderr };
  } finally {
    run.closed = true;
    if (cwd) process.chdir(startDir);
    process.exitCode = exitCode;
    process.argv = argv;
    if (stdinDesc) Object.defineProperty(process, 'stdin', stdinDesc);
    restoreEnv();
  }
}

/* The spawned helper's shape: { code, out, err }. `env` is the WHOLE environment,
   as a spawn's would be (childEnv() when omitted); `input` is stdin, empty if none. */
export function runCli(args, { env, cwd, input } = {}) {
  const result = serial.then(() => once(args, { env, cwd, input }));
  serial = result.catch(() => {});
  return result;
}

/* The local server's CLI route on 127.0.0.1 with the server's own refusal, and the
   <root>/board/local.json the launcher finds it by. `own` is the server's env; each
   answer's status lands in `answered` as { verb, status } (409: the caller ran it). */
export async function cliRoute(root, own) {
  const { handleCli } = await import('../../lib/local-route.mjs');
  const { routeRefusal, runCommand } = await import('../../lib/cli-commands.mjs');
  const { pluginVersion } = await import('../../lib/node-helpers.mjs');
  const answered = [];
  const srv = createServer((req, res) => handleCli(req, res, {
    run: runCommand,
    refuse: (b) => routeRefusal(b, { root, own, version: pluginVersion() }),
    timing: (verb, ms, status) => answered.push({ verb, status }),
  }));
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + srv.address().port + '/s/local';
  mkdirSync(join(root, 'board'), { recursive: true });
  writeFileSync(join(root, 'board', 'local.json'), JSON.stringify({ board: null, url, pid: process.pid }));
  /* one call as the launcher sends it */
  const post = (body) => new Promise((ok, fail) => {
    const text = JSON.stringify({ version: pluginVersion(), ...body });
    const req = request(url + '/cli', { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => ok({ status: res.statusCode, body: JSON.parse(s) }));
    });
    req.on('error', fail);
    req.end(text);
  });
  const close = () => new Promise((ok) => { srv.closeAllConnections(); srv.close(ok); });
  return { url, answered, post, close };
}
