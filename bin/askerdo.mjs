#!/usr/bin/env node
/* The AskerDo CLI launcher: one keep-alive call to this
   PC's local server, which runs the command in process (lib/cli-commands.mjs).
   It never opens a board file, takes a lock or starts a process. With no local
   server, or one that cannot stand in for this caller, the same module runs here.
   Exit 0 success, 1 bad input, 2 store failure. */
/* node:sqlite announces itself as experimental on every load; a caller reading the first
   stderr line must get the reason, not that, as server/cli.mjs does */
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') process.stderr.write(String(w.stack || w) + '\n'); });

/* getBuiltinModule, not import: an ESM import of node:http costs about 50 ms more on Windows */
const NAMES = ['node:http', 'node:fs', 'node:os', 'node:path'];
const [{ Agent, request }, { readFileSync }, { homedir }, { isAbsolute, join }] = typeof process.getBuiltinModule === 'function'
  ? NAMES.map((n) => process.getBuiltinModule(n)) : await Promise.all(NAMES.map((n) => import(n)));

/* What the commands read of the environment: the seams, the session's settings and the home. */
const SENT = /^(ASKERDO_|CLAUDE_)/;

function callerEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (SENT.test(k) || k === 'HOME' || k === 'USERPROFILE') out[k] = v;
  return out;
}

/* The root storeRoot() picks, so local.json is found without loading the store
   code; the server checks the caller's store before it runs anything. */
function rootOf(env) {
  const seam = String(env.ASKERDO_ROOT ?? '').trim();
  if (seam) return isAbsolute(seam) ? seam : null;
  const named = String(env.ASKERDO_SANDBOX_HOME ?? '').trim();
  return join(named && isAbsolute(named) ? named : homedir(), '.claude', 'askerdo');
}

function alive(pid) {
  if (!Number.isInteger(pid)) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/* The local server's route base from <store>/board/local.json, while it runs. */
function localServer(env) {
  const root = rootOf(env);
  if (!root) return null;
  let l;
  try { l = JSON.parse(readFileSync(join(root, 'board', 'local.json'), 'utf8')); } catch { return null; }
  return l && typeof l.url === 'string' && alive(l.pid) ? l.url : null;
}

/* The build this call wants: a local server running another one refuses it. */
function versionOf(env) {
  const seam = env.ASKERDO_BOARD_VERSION;
  if (seam) return seam;
  try { return JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version; } catch { return ''; }
}

const agent = new Agent({ keepAlive: true });

function post(url, body) {
  const text = JSON.stringify(body);
  return new Promise((ok, fail) => {
    const req = request(url + '/cli', {
      method: 'POST', agent, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let reply = null;
        try { reply = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        ok({ status: res.statusCode, reply });
      });
      res.on('error', fail);
    });
    req.on('error', fail);
    req.end(text);
  });
}

function readAll() {
  return new Promise((ok, fail) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => ok(data));
    process.stdin.on('error', fail);
  });
}

const failed = (why) => ({ code: 2, stdout: '', stderr: 'AskerDo: ' + why + '\n' });

async function main() {
  const argv = process.argv.slice(2);
  const env = process.env;
  const cwd = process.cwd();
  const tty = process.stdin.isTTY === true;
  const url = localServer(env);
  /* stdin read once: a refusal after it was read hands the text itself to the fallback */
  let stdin;
  if (url) {
    const call = { argv, cwd, env: callerEnv(env), tty, version: versionOf(env) };
    let r = null;
    try {
      r = await post(url, call);
      /* stdin is read only for a command that asks for it: a terminal's never ends */
      if (r.status === 200 && r.reply && r.reply.needStdin) {
        stdin = await readAll();
        r = await post(url, { ...call, stdin });
      }
    } catch (e) {
      /* nothing listening means nothing ran; any other break may have come after the command started */
      if (!e || e.code !== 'ECONNREFUSED') return failed('the local server dropped the call (' + ((e && (e.code || e.message)) || e) + '); it may have run');
    }
    if (r && r.status === 200) return r.reply && Number.isInteger(r.reply.code) ? r.reply : failed('the local server answered something that is not a CLI result');
    if (r && r.status === 500) return failed('the local server failed the call: ' + ((r.reply && r.reply.error) || 'no reason given'));
  }
  /* no local server, or a refusal before anything ran: the same commands, here */
  const { runCommand } = await import('../lib/cli-commands.mjs');
  return runCommand({ argv, cwd, env, stdin: stdin ?? readAll, tty });
}

/* exported so tests can run a verb in-process and await it; the shim's import still runs it */
export const done = main().then(
  (r) => {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exitCode = r.code;
  },
  (e) => {
    process.stderr.write('AskerDo: ' + ((e && e.message) || e) + '\n');
    process.exitCode = 2;
  },
);
