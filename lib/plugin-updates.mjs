/* the Claude app's background auto-update for AskerDo's marketplace.
   The /plugin toggle stores it as autoUpdate on the marketplace's entry in
   <claude>/plugins/known_marketplaces.json, and mirrors it onto the user settings'
   extraKnownMarketplaces entry when that declares the marketplace, since that one wins.
   Fail-open: nothing here throws. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeHome, sandboxHome } from './node-helpers.mjs';
import { writeAtomic } from './store-io.mjs';

/* the name AskerDo's marketplace.json gives its marketplace */
const MARKETPLACE = 'askerdo';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* An installed copy sits in <plugins>/cache/<marketplace>/<plugin>/<version>. */
export function marketplaceName(root = ROOT) {
  const parts = root.split(/[\\/]+/);
  const i = parts.lastIndexOf('cache');
  return i > 0 && parts[i - 1] === 'plugins' && parts[i + 1] ? parts[i + 1] : MARKETPLACE;
}

/* The app's plugins folder: CLAUDE_CODE_PLUGIN_CACHE_DIR moves it, except in a sandbox. */
function pluginsDir(env, claude) {
  if (env.CLAUDE_CODE_PLUGIN_CACHE_DIR && !sandboxHome(env)) return env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
  return claude ? join(claude, 'plugins') : null;
}

const readJson = (file) => {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
};

function places(env, claude, name) {
  const plugins = pluginsDir(env, claude);
  return { name, known: plugins ? join(plugins, 'known_marketplaces.json') : null, settings: claude ? join(claude, 'settings.json') : null };
}

/* { on, set, name, file } as the app reads it (the settings entry first, then the known one,
   off by default; set says a value is there at all), or { on: null, name, why } when the
   marketplace is not found. */
export function pluginUpdates({ env = process.env, claude = claudeHome(env), name = marketplaceName() } = {}) {
  try {
    const p = places(env, claude, name);
    const entry = p.known && readJson(p.known);
    if (!entry || !entry[name] || typeof entry[name] !== 'object') return { on: null, name, why: 'the app knows no marketplace named ' + name + (p.known ? ' in ' + p.known : '') };
    const s = p.settings && readJson(p.settings);
    const declared = s && s.extraKnownMarketplaces && s.extraKnownMarketplaces[name];
    const v = declared && typeof declared.autoUpdate === 'boolean' ? declared.autoUpdate : entry[name].autoUpdate;
    return { on: v === true, set: typeof v === 'boolean', name, file: p.known };
  } catch (e) {
    return { on: null, name, why: (e && e.message) || String(e) };
  }
}

/* Sets the switch, merging into each file and keeping every other key; a file already
   at the value is not written. Answers { ok, on, name, wrote: [files] } or { ok: false, why }. */
export function setPluginUpdates(on, { env = process.env, claude = claudeHome(env), name = marketplaceName() } = {}) {
  try {
    const want = on === true;
    const p = places(env, claude, name);
    const known = p.known && readJson(p.known);
    if (!known || !known[name] || typeof known[name] !== 'object') return { ok: false, name, why: 'the app knows no marketplace named ' + name + (p.known ? ' in ' + p.known : '') };
    /* an unset switch is off already */
    const differs = (cur) => (cur === true) !== want;
    const wrote = [];
    if (differs(known[name].autoUpdate)) {
      known[name] = { ...known[name], autoUpdate: want };
      writeAtomic(p.known, JSON.stringify(known, null, 2));
      wrote.push(p.known);
    }
    const s = p.settings && readJson(p.settings);
    const declared = s && s.extraKnownMarketplaces && s.extraKnownMarketplaces[name];
    if (declared && typeof declared === 'object' && differs(declared.autoUpdate)) {
      s.extraKnownMarketplaces = { ...s.extraKnownMarketplaces, [name]: { ...declared, autoUpdate: want } };
      writeAtomic(p.settings, JSON.stringify(s, null, 2) + '\n');
      wrote.push(p.settings);
    }
    return { ok: true, on: want, name, wrote };
  } catch (e) {
    return { ok: false, name, why: (e && e.message) || String(e) };
  }
}
