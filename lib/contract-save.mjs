/* One save of this PC's contract options: checked by the settings table,
   onto a board user's profile first, then config.json, then the sync.
   Pure of spawning: the caller hands in how to run the sync. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, DEFAULT_CONFIG } from './node-helpers.mjs';
import { checkAlias } from './mod-core.mjs';
import { boardCall } from './board-call.mjs';
import { CONTRACT_KEYS, PC_SETTINGS, RETIRED, SETTINGS, checkSetting, contractOf, contractSets } from '../server/verbs/profile-rules.mjs';

const SETTING_OF = Object.fromEntries([...CONTRACT_KEYS.map((k) => [k, 'contract.' + k]), ['queue', 'queue']]);
const specOf = (k) => SETTINGS[SETTING_OF[k]] || PC_SETTINGS[SETTING_OF[k]];
/* config.json's key order, kept so an unchanged save writes the same bytes */
export const OPTION_KEYS = Object.freeze([...CONTRACT_KEYS.filter((k) => specOf(k).kind === 'bool'), 'dlg', 'queue', 'custom', 'alias']);
const KEYS = new Set(OPTION_KEYS);
/* the board URL and this PC's token: a save keeps the saved ones */
const KEPT = Object.keys(DEFAULT_CONFIG).filter((k) => !KEYS.has(k));
/* the profile a board with none held on default gets for the options */
const NEW_HOME = 'personal';

/* Answers { error } (nothing written) or { changed, sync, profile? }. runSync(args)
   runs hooks/sync.mjs with args and answers { code, stdout, stderr }. */
export async function saveContract(raw, { env = process.env, runSync }) {
  const named = checkAlias(raw && raw.alias);
  if (named.error) return { error: named.error };
  const cfg = validate(raw);
  if (!cfg) return { error: 'config shape rejected' };
  const dir = dataDir(env);
  if (!dir) return { error: 'the sandbox seam was refused, so there is no data dir to save into' };
  const file = join(dir, 'config.json');
  if (raw.alias === undefined) cfg.alias = savedAlias(file);
  const kept = savedKept(file);
  let profile = null;
  if (kept.boardToken) {
    /* a board PC's queue is the board */
    cfg.queue = 'hub';
    try { profile = await saveToBoard(cfg, (name, input) => boardCall(name, input, { env })); } catch (e) {
      return { error: 'the board did not take the options, so nothing was saved: ' + ((e && e.message) || e) };
    }
  }
  Object.assign(cfg, kept);
  const out = JSON.stringify(cfg, null, 2) + '\n';
  try {
    mkdirSync(dir, { recursive: true });
    /* identical bytes skip the write, so mtime moves only on a real change */
    let same = false;
    try { same = readFileSync(file, 'utf8') === out; } catch {}
    if (!same) writeFileSync(file, out);
  } catch (e) {
    return { error: 'the save failed: ' + ((e && e.message) || e) };
  }
  /* the board's copy may not have reached this PC's cache yet, so the sync builds from the file */
  const r = runSync(profile ? ['--no-pull'] : []);
  if (r.code !== 0) return { error: 'the options were saved, but the sync failed: ' + (r.stderr || r.stdout).trim() };
  const sync = r.stdout.trim();
  /* sync announces a real write and stays silent on the identical no-op */
  return { changed: sync.includes('output style regenerated'), sync, ...(profile ? { profile } : {}) };
}

/* The options onto the profile held on default; a board holding none there gets one.
   call(name, input) runs a board verb: the join's seed calls the board it just saved. */
export async function saveToBoard(cfg, call) {
  const { profile } = contractOf(await call('profileList', {}));
  const name = profile || NEW_HOME;
  await call('profileDefine', { name, set: contractSets(cfg) });
  if (!profile) await call('profileAdd', { record: 'default', name });
  return name;
}

function savedAlias(file) {
  try {
    const a = checkAlias(JSON.parse(readFileSync(file, 'utf8')).alias);
    return a.error ? '' : a.alias;
  } catch { return ''; }
}

/* without this, one options save would cut the PC off its board */
function savedKept(file) {
  let saved;
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
  const out = {};
  for (const k of KEPT) if (saved && typeof saved[k] === typeof DEFAULT_CONFIG[k]) out[k] = saved[k];
  return out;
}

/* Strict: anything that is not exactly a set of options is refused, not coerced,
   and each value goes through the settings table's own check. */
function validate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  /* a retired option from an older caller is dropped, not refused */
  for (const key of Object.keys(raw)) if (!KEYS.has(key) && !Object.hasOwn(RETIRED, 'contract.' + key)) return null;
  const custom = raw.custom === undefined ? [] : raw.custom;
  if (!Array.isArray(custom) || custom.some((r) => typeof r !== 'string')) return null;
  const named = checkAlias(raw.alias);
  if (named.error) return null;
  const given = { ...raw, custom: custom.map((r) => r.replace(/\s+$/, '')).filter(Boolean), alias: named.alias };
  const cfg = {};
  for (const key of OPTION_KEYS) {
    const kind = specOf(key).kind;
    if (typeof given[key] !== (kind === 'bool' ? 'boolean' : kind === 'texts' ? 'object' : 'string')) return null;
    try { cfg[key] = checkSetting(SETTING_OF[key], given[key]); } catch { return null; }
  }
  return cfg;
}
