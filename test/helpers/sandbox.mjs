/* The suite's throwaway directories, minted and removed in one place.
 *
 * Every test that needs a fake HOME, a fake store root, or a scratch tree
 * mints it here rather than calling mkdtempSync itself. Two things come with
 * that: the directory is REMOVED when the file that minted it finishes, and
 * its prefix is registered in the table below, the one place the suite's
 * shapes are named. A run that leaves TEMP as it found it is the whole point: abandoned
 * sandboxes pile up by the thousand, each one with files and often a small git
 * repo, and every NTFS operation in that folder pays for them.
 *
 * REMOVAL IS BEST EFFORT AND NEVER FAILS A TEST. Windows refuses to unlink a
 * file another process still holds open, so a sandbox whose server outlived
 * its stop is left on disk rather than turned into a red case, and stays
 * there until someone removes it by hand.
 *
 * WHERE THE REMOVAL IS REGISTERED. The default is the END OF THE FILE, a root
 * `after` hook this module registers on the importing file (verified: a
 * top-level `after` in an imported module attaches to the file root and runs
 * once every test in the file is done). That is deliberately the default
 * rather than a per-test hook: most sandboxes here host a spawned server or a
 * child process whose stop is registered in the test's own `t.after`, and
 * node runs those hooks in the order they were added, so a removal registered
 * at mint time would run BEFORE the stop it depends on. The file root runs
 * after all of them. A caller with a test context at hand and no child inside
 * the directory can pass `t` as the second argument to have it removed at the
 * end of that test instead. A process-exit handler is the last resort, for a
 * run that never reaches its root hooks.
 *
 * THERE IS NO SWEEP. A run killed before its root
 * hooks run (Ctrl+C, a hung file the runner kills) leaves that run's
 * sandboxes behind, and killed code cannot delete anything: a sandbox is
 * removed by the run that minted it, and what a killed run leaves is removed
 * by hand.
 */
import { after } from 'node:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* THE ONE PLACE THE PREFIXES ARE NAMED. A mint site passes one of these; an
   unregistered prefix throws at the mint rather than quietly minting a shape
   the guard test does not know. Grouped by the file that spends it. */
export const SANDBOX_PREFIXES = Object.freeze([
  /* test/run-tests.test.mjs: the fixture test files the script is run on */
  'askerdo-run-tests-',
  /* test/onboard-survey.test.mjs */
  'onboard-survey-',
  /* test/question-fixes.test.mjs */
  'askerdo-qfix-cli-',
  /* test/board-server.test.mjs */
  'nd-board-',
  'nd-board-cli-',
  /* the module-resolution shims a spawned server is started under: the hanging
     store, the broken work digest, the notification channel forced on or off,
     and the tray shimmed as one that can be started on demand, whose
     frames the case reads back out of a file in the same directory */
  'nd-shim-',
  'nd-tree-',
  'nd-refs-',
  'nd-ev-',
  'nd-line-',
  /* test/board-server.test.mjs and test/notify.test.mjs */
  'nd-open-',
  /* test/notify.test.mjs */
  'nd-notify-',
  /* test/tray.test.mjs */
  'nd-tray-',
  /* test/icons.test.mjs: a COPY of the icon package that the drift case doctors, so
     the checker is proved to catch a drift without a byte of the real assets/ ever
     being touched */
  'nd-icon-drift-',
  /* the native tray's stand-ins: a file that is plainly not a program
     for the cases that only read an argv, and a node script for the two that
     want a real child. Neither is ever the shipped exe. */
  'nd-tray-exe-',
  'nd-tray-stub-',
  'nd-tray-def-',
  /* test/sync.test.mjs (the data prefix is
     load bearing: dataDir() only honors CLAUDE_PLUGIN_DATA when the basename
     starts with the plugin name) */
  'ttd-home-',
  'askerdo-data-',
  'other-plugin-data-',
  /* test/sync-hub.test.mjs */
  'ttd-hub-home-',
  /* test/mod-switch.test.mjs */
  'ttd-modsw-home-',
  'ttd-modsw-sandbox-',
  /* test/hub-cli.test.mjs */
  'askerdo-cli-',
  /* the board's own tests (board-store, board-api, board-call, board-web, local-board, server-tracks) */
  'askerdo-store-',
  /* test/board-import.test.mjs */
  'askerdo-move-',
  /* test/server-work.test.mjs: a night's backup during a scrub's seal */
  'askerdo-backup-',
  /* test/server-handoffs.test.mjs */
  'askerdo-handoffs-',
  /* test/recent-opens.test.mjs */
  'nd-recent-',
  /* test/store-io.test.mjs */
  'nd-store-io-',
  /* test/procedures.test.mjs */
  'askerdo-proc-',
  /* test/work-toasts.test.mjs */
  'askerdo-toasts-',
  /* test/show-brief.test.mjs */
  'askerdo-brief-cli-',
  /* test/store-root.test.mjs: the fake homes the resolution is read over */
  'askerdo-root-',
  /* test/sync-sandbox.test.mjs: the handed home and the sandbox */
  'ttd-sbx-home-',
  'ttd-sbx-seam-',
  /* test/loose-files.test.mjs: data dirs and git repos */
  'askerdo-loose-',
  'askerdo-loose-repo-',
  /* test/profiles.test.mjs: stores, claude homes, and the CLI's seam and home */
  'askerdo-prof-cli-',
  /* test/handoff-check.test.mjs */
  'ttd-handoff-check-',
  /* test/sandbox.test.mjs, which proves this file */
  'nd-sandbox-',
]);

/* mkdtemp's own six random characters, which is what tells one of our
   sandboxes apart from a directory that merely starts the same way. */
const SUFFIX = /^[A-Za-z0-9]{6}$/;

/* A sandbox's name: a registered prefix plus exactly that suffix and nothing
   else (the guard test's matcher). */
export function isSandboxName(name) {
  for (const prefix of SANDBOX_PREFIXES) {
    if (name.length !== prefix.length + 6) continue;
    if (name.startsWith(prefix) && SUFFIX.test(name.slice(prefix.length))) return true;
  }
  return false;
}

/* Minted here and not yet removed. */
const live = new Set();

/* One throwaway directory under TEMP, registered for removal. Pass `t` only
   when the directory holds no spawned child, since a per-test hook added here
   runs before the stop hooks the test adds later. */
export function tempDir(prefix, t) {
  if (!SANDBOX_PREFIXES.includes(prefix)) {
    throw new Error('unregistered sandbox prefix ' + JSON.stringify(prefix)
      + ': add it to SANDBOX_PREFIXES in test/helpers/sandbox.mjs, so the guard'
      + ' knows what this mints');
  }
  const dir = mkdtempSync(join(tmpdir(), prefix));
  live.add(dir);
  if (t && typeof t.after === 'function') t.after(() => dropTempDir(dir));
  return dir;
}

const fixtures = new Map();

/* A fixture a case builds the same way every time, a small git repository above
   all: `build(dir)` runs once per file, and each call gets a fresh copy at `name`
   inside a new sandbox under `prefix` ('' is the sandbox itself). */
export function fixtureCopy(prefix, name, build) {
  const key = prefix + '|' + name;
  let dir = fixtures.get(key);
  if (!dir) {
    dir = join(tempDir(prefix), name || 'fixture');
    mkdirSync(dir, { recursive: true });
    build(dir);
    fixtures.set(key, dir);
  }
  const copy = join(tempDir(prefix), name);
  cpSync(dir, copy, { recursive: true });
  return copy;
}

/* Best effort, and silent about a refusal: a cleanup is never what fails a
   case. The retries are what carry a Windows handle that is closing. */
export function dropTempDir(dir) {
  live.delete(dir);
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch { /* another process still holds a file: it stays for a hand purge */ }
}

/* The store and sandbox seams a child must not inherit (and the mod's switch, which
   a suite run from a mod session would carry): a suite run with them set
   would otherwise have every spawned CLI, hook and server write that store. */
/* CLAUDE_CODE_SESSION_ID too: a CLI read names the runner's session as its reader */
export const SEAM_VARS = Object.freeze(['ASKERDO_ROOT', 'ASKERDO_SANDBOX_HOME', 'ASKERDO_MOD', 'CLAUDE_CODE_SESSION_ID']);

/* The runner's environment minus the seams, then `extra` on top, so a case that
   means a seam still sets it. */
export function childEnv(extra) {
  const env = { ...process.env };
  for (const k of SEAM_VARS) delete env[k];
  return { ...env, ...(extra || {}) };
}

function dropAll() {
  for (const dir of [...live]) dropTempDir(dir);
}

/* root hooks run in registration order and this one registers at import, so
   it runs before any root after a file adds later: a file that stops a server
   or a child does so in a test's own t.after, never in a root after */
after(dropAll);
/* the last resort, for an exit that never reaches the root hooks */
process.on('exit', dropAll);
