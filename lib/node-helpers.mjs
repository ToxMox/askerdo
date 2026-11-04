/* The builder stays pure, so every environment-shaped helper the hooks, skills
 * and build script share lives here. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
/* store-io imports node core modules only, so this cannot close a cycle back
 * through the store. */
import { appendLog } from './store-io.mjs';

export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export function pluginVersion() {
  return JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
}

/* Claude Code writes .orphaned_at into a cache copy the moment an update or a rollback
 * replaces it, and deletes the folder days later (measured 2026-10-30); sessions still
 * running such a copy must not take back what the installed copy owns. */
export function replacedCopy(root = pluginRoot) {
  try { return existsSync(join(root, '.orphaned_at')); } catch { return false; }
}

function within(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

/* the sandbox seam. ASKERDO_SANDBOX_HOME names a fake home; with only ASKERDO_ROOT
 * set it is the root's sibling '<root>-home'. Either way the sync writes under
 * <sandbox>/.claude, never under the real ~/.claude, and an unusable seam refuses. */
export function sandboxHome(env = process.env, home = homedir()) {
  const named = env.ASKERDO_SANDBOX_HOME === undefined ? '' : String(env.ASKERDO_SANDBOX_HOME).trim();
  let value;
  let from = 'ASKERDO_SANDBOX_HOME';
  let why = '';
  if (named) {
    value = named;
    if (!isAbsolute(value)) why = 'a relative path';
    else if (!isDirectory(value)) why = 'not an existing directory';
  } else {
    const seam = seamRoot(env);
    /* a seam naming the live store is no sandbox (liveSeam says so) */
    if (!seam || seam.asUnset || (seam.root && liveSeam(env, home))) return null;
    from = 'ASKERDO_ROOT';
    if (!seam.root) return { from, problem: 'ASKERDO_ROOT is ' + seam.why + ': "' + seam.value + '"' };
    value = resolve(seam.root) + '-home';
  }
  if (!why && (relative(resolve(home), resolve(value)) === '' || within(value, join(home, '.claude')))) {
    why = 'the real home or inside its .claude';
  }
  if (why) return { from, problem: from + ' gives a sandbox home that is ' + why + ': "' + value + '"' };
  return { from, home: value };
}

function isDirectory(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/* The live store a seam names, or null: ASKERDO_ROOT at ~/.claude/askerdo is the
 * real store, so callers treat it as no seam and say so. */
export function liveSeam(env = process.env, home = homedir()) {
  const seam = seamRoot(env);
  if (!seam || !seam.root) return null;
  const norm = (p) => resolve(p).split('\\').join('/').replace(/\/+$/, '').toLowerCase();
  return norm(join(home, '.claude', STORE_SLUG)) === norm(seam.root) ? seam.root : null;
}

/* The .claude the sync writes: the sandbox's when the seam is in force, and
 * null when the seam is refused (never the real home then). */
export function claudeHome(env = process.env) {
  const s = sandboxHome(env);
  if (s && s.problem) return null;
  return join(s && s.home ? s.home : homedir(), '.claude');
}

/* CLAUDE_PLUGIN_DATA can leak from another plugin's context and the harness
 * names this dir inconsistently, so trust it only when it names this plugin,
 * and otherwise prefer the askerdo sibling holding the config. In a
 * sandbox it is trusted only when it sits inside the sandbox home; with a
 * refused seam there is none (null). */
export function dataDir(env = process.env) {
  const s = sandboxHome(env);
  const claude = claudeHome(env);
  return claude ? resolveDataDir(claude, s && s.home, env) : null;
}

const DATA_SLUG = 'askerdo';

function findDataDirs(claude, inside, env = process.env) {
  const named = env.CLAUDE_PLUGIN_DATA;
  const root = join(claude, 'plugins', 'data');
  const primary = named && basename(named).startsWith(DATA_SLUG) && (!inside || within(named, inside))
    ? named
    : join(root, DATA_SLUG + '-' + DATA_SLUG);
  if (existsSync(join(primary, 'config.json'))) return { primary, held: primary };
  let names = [];
  try { names = readdirSync(root); } catch {}
  const d = names.find((n) => n.startsWith(DATA_SLUG) && existsSync(join(root, n, 'config.json')));
  return { primary, held: d ? join(root, d) : null };
}

function resolveDataDir(claude, inside, env) {
  const { primary, held } = findDataDirs(claude, inside, env);
  return held || primary;
}

/* The store folder under ~/.claude. */
export const STORE_SLUG = 'askerdo';

/* the seam's six cases are classified HERE and nowhere else, so the
 * resolver's fall-through and the refusal helper's sentence cannot drift. One
 * probe at most: a stat that throws is the path that does not exist. */
function seamRoot(env) {
  const raw = envSeam('ROOT', env);
  if (raw === undefined) return null;
  const value = String(raw).trim();
  /* empty or whitespace only is the same as unset and says nothing,
   * which is what tray.mjs and board-ensure.mjs already do with theirs. */
  if (!value) return { value: String(raw), why: 'set but empty', asUnset: true };
  /* refused rather than resolved against the cwd, for rootValue's own reason: a
   * root that became the current directory would materialize a live store. */
  if (!isAbsolute(value)) return { value, why: 'a relative path' };
  let stat = null;
  try { stat = statSync(value); } catch {}
  if (!stat) return { value, why: 'a path that does not exist' };
  if (!stat.isDirectory()) return { value, why: 'not a directory' };
  return { value, root: value };
}

/* Said out loud ONCE per distinct verdict: a hook that resolves three times
 * must not write three lines, and two values in one process must each get theirs. */
const seamLogged = new Set();

function logSeam(seam, root) {
  if (seam.asUnset) return;
  const line = seam.root
    ? 'store root: ASKERDO_ROOT names "' + seam.root
      + '", taken before the default'
    : 'store root: ASKERDO_ROOT is ' + seam.why + ': "' + seam.value
      + '"; using ' + root + ' and creating nothing';
  if (seamLogged.has(line)) return;
  seamLogged.add(line);
  try { appendLog(root, line); } catch {}
}

/* storeRoot() must stay infallible because three fail-open hooks call
 * it, so the entry points a person invokes directly ask this and refuse. Null
 * when there is nothing to say; the env is handed in and never read here. */
export function seamRootProblem(env) {
  /* a named sandbox home that cannot be used would send the store to the real home */
  const s = env && env.ASKERDO_SANDBOX_HOME !== undefined && String(env.ASKERDO_SANDBOX_HOME).trim() ? sandboxHome(env) : null;
  if (s && s.problem) return s.problem + '. It must name an existing absolute directory outside the real home; nothing was read and nothing was created.';
  const seam = seamRoot(env);
  if (!seam || seam.root) return null;
  return 'ASKERDO_ROOT is ' + seam.why + ': "' + seam.value
    + '". It must name an existing absolute directory; nothing was read and nothing'
    + ' was created.';
}

/* the import and migration scripts write a whole history at once,
 * so the real store is only ever their target on purpose (--install). */
export function liveStoreProblem(root, install) {
  if (install) return null;
  const norm = (p) => resolve(p).split('\\').join('/').toLowerCase();
  if (norm(join(homedir(), '.claude', STORE_SLUG)) !== norm(root)) return null;
  return 'the target is the live store (' + root + '); set ASKERDO_ROOT to a sandbox clone, or pass --install at install time';
}

/* the seam is read before the default, and `env` is an
 * argument because envSeam already takes one and a case must not mutate the
 * runner's own environment. */
export function storeRoot(home, env = process.env) {
  /* no home handed in means the sandbox's, when ASKERDO_SANDBOX_HOME names one */
  if (home === undefined) {
    const s = sandboxHome(env);
    home = s && s.home && s.from === 'ASKERDO_SANDBOX_HOME' ? s.home : homedir();
  }
  const seam = seamRoot(env);
  if (seam && seam.root) {
    /* a seam naming the live store is no seam, so it logs nothing */
    if (!liveSeam(env, home)) logSeam(seam, seam.root);
    return seam.root;
  }
  const picked = join(String(home), '.claude', STORE_SLUG);
  /* the line lands in the root actually resolved, which is where
   * somebody will look for it. */
  if (seam) logSeam(seam, picked);
  return picked;
}

/* One hop for every ASKERDO_ seam. `env` is an argument: a caller already holds one. */
export function envSeam(name, env = process.env) {
  return env['ASKERDO_' + name];
}

/* the mod sets ASKERDO_MOD=1 in its session's environment,
 * so the settings-hook drains and the SessionStart summary stand down and the
 * mod is the session's one delivery path. */
export function modRunning(env = process.env) {
  return env.ASKERDO_MOD === '1';
}

export const DEFAULT_CONFIG = {
  weather: true, forecast: true, tasks: true, docs: true, fold: true,
  decision: true, diff: true, emdash: true, visual: true, interactive: true,
  ids: true,
  /* queue: 'hub' | 'text' | 'off'; legacy values coerce in the builder's
   * queueMode. hub is the cross-project store and stays opt-in. */
  queue: 'text',
  dlg: 'blockers',
  /* user-authored rules appended to the generated ones, verbatim */
  custom: [],
  /* a second name for the mod's /askerdo; empty registers none */
  alias: '',
  /* the board server and this PC's device token; ASKERDO_BOARD_URL and
   * ASKERDO_BOARD_TOKEN override them; empty reaches no board */
  boardUrl: '',
  boardToken: '',
  /* the board this PC hosts: where its daily copies go; empty is beside its database */
  boardBackups: '',
  /* a Docker board on this PC: its container, backed up daily; empty is none */
  boardContainer: '',
  /* a question card's option press: 'confirm' opens the strip, 'once' records at once */
  answerPresses: 'confirm',
};

/* Merged over defaults so a config written before a new toggle existed stays
 * valid. */
export function loadConfig(env = process.env) {
  const dirs = [dataDir(env)].filter(Boolean);
  /* a sandbox with no saved options of its own reads the real ones, read only */
  const s = sandboxHome(env);
  if (s && s.home) dirs.push(resolveDataDir(join(homedir(), '.claude'), null, env));
  for (const dir of dirs) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) };
    } catch {}
  }
  return null;
}
