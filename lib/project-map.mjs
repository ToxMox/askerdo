/* records carry a project's shared name (lib/project-id.mjs sharedName)
   and each PC keeps one small map from that name to its own folder, so a second
   PC may lay its folders out any way. The map lives in the PC's data dir. */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { checkoutOf, isPathName, normDir, sharedName, shortName, topOf } from './project-id.mjs';
import { writeAtomic } from './store-io.mjs';

export const mapFile = (dir) => join(dir, 'local', 'projects.json');

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/* name to folder; empty when the PC has none yet or the file does not parse */
export function readMap(dir) {
  if (!dir) return {};
  try {
    const m = JSON.parse(readFileSync(mapFile(dir), 'utf8'));
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch { return {}; }
}

function writeMap(dir, map) {
  const file = mapFile(dir);
  mkdirSync(dirname(file), { recursive: true });
  const sorted = Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]));
  writeAtomic(file, JSON.stringify(sorted, null, 2) + '\n');
}

/* the desktop app deletes a session's scratch workspace with the session */
const isScratch = (f) => (normDir(f) + '/').includes('/claude/scratch-workspaces/');

/* Each folder's main checkout under its shared name. A name already mapped to a
   folder that still exists keeps it, unless `replace` (a scan the user named). */
export function learnProjects(dir, folders, { replace = false } = {}) {
  const map = readMap(dir);
  const added = [];
  const known = [];
  for (const f of folders || []) {
    if (typeof f !== 'string' || !isAbsolute(f) || isScratch(f) || !isDir(f)) continue;
    const main = checkoutOf(f);
    const name = sharedName(f);
    if (!main || !name) continue;
    const had = map[name];
    if (had && normDir(had) === normDir(main)) { known.push({ name, dir: had }); continue; }
    if (had && isDir(had) && !replace) { known.push({ name, dir: had }); continue; }
    map[name] = main;
    added.push({ name, dir: main, ...(had ? { was: had } : {}) });
  }
  if (added.length && dir) writeMap(dir, map);
  return { file: dir ? mapFile(dir) : null, added, known };
}

/* How far below a named folder a scan looks for checkouts. */
export const SCAN_DEPTH = 3;
const skipped = (n) => n.startsWith('.') || n === 'node_modules';

/* Checkouts up to SCAN_DEPTH below `f`, never inside one; a link or junction
   counts when it is a checkout but is never walked, so a loop cannot hold the scan. */
function checkoutsUnder(f, depth, found) {
  let entries = [];
  try { entries = readdirSync(f, { withFileTypes: true }); } catch {}
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (e.name === 'node_modules' || !(e.isDirectory() || e.isSymbolicLink())) continue;
    const p = join(f, e.name);
    if (existsSync(join(p, '.git'))) found.push(p.replace(/\\/g, '/'));
    else if (depth > 1 && e.isDirectory() && !skipped(e.name)) checkoutsUnder(p, depth - 1, found);
  }
}

/* `askerdo projects scan`: a named folder inside a checkout is learned and wins;
   any other folder's checkouts up to SCAN_DEPTH down are learned without
   moving a mapped folder that exists. Several clones of one name under a parent
   map the one named for the repo, else the first; the rest come back in `others`. */
export function scanProjects(dir, folders) {
  const named = [];
  const found = [];
  const missing = [];
  for (const f of folders || []) {
    if (!isDir(f)) { missing.push(f); continue; }
    if (topOf(f)) { named.push(f); continue; }
    checkoutsUnder(f, SCAN_DEPTH, found);
  }
  const byName = new Map();
  for (const f of found) {
    const name = sharedName(f);
    const main = checkoutOf(f);
    if (!name || !main) continue;
    const list = byName.get(name) || [];
    if (!list.some((d) => normDir(d) === normDir(main))) list.push(main);
    byName.set(name, list);
  }
  const picks = [];
  const others = [];
  for (const [name, list] of byName) {
    const own = shortName(name).toLowerCase();
    const pick = list.find((d) => shortName(d).toLowerCase() === own) || list[0];
    picks.push(pick);
    for (const d of list) if (d !== pick) others.push({ name, dir: d, kept: pick });
  }
  const first = learnProjects(dir, named, { replace: true });
  const rest = learnProjects(dir, picks);
  const map = readMap(dir);
  /* a clone left out names the folder the map holds, which a mapped one may keep */
  const left = others.map((o) => ({ ...o, kept: map[o.name] || o.kept })).filter((o) => normDir(o.dir) !== normDir(o.kept));
  return { file: first.file, added: first.added.concat(rest.added), known: first.known.concat(rest.known), others: left, missing };
}

/* once the board moved a project to its new name, the map drops the old
   name; the new one keeps its folder, else takes the old one's through `folders`. */
export function renameInMap(dir, from, to, folders = [], { dryRun = false } = {}) {
  const map = readMap(dir);
  const had = map[from];
  const pair = had ? (folders || []).find((f) => normDir(f.from) === normDir(had)) : null;
  const next = map[to] || (pair ? String(pair.to).replace(/\\/g, '/').replace(/(.)\/+$/, '$1') : had) || null;
  const changed = had !== undefined || (!!next && map[to] !== next);
  if (changed) {
    delete map[from];
    if (next) map[to] = next;
    if (!dryRun) writeMap(dir, map);
  }
  return { file: mapFile(dir), changed, dir: next, dropped: had !== undefined };
}

/* `askerdo projects forget`: one entry off this PC's map */
export function forgetInMap(dir, name) {
  const map = readMap(dir);
  const had = map[name];
  if (had !== undefined) { delete map[name]; writeMap(dir, map); }
  return { file: mapFile(dir), dropped: had !== undefined, dir: had || null };
}

/* What a listed entry's folder says now: gone, or now another project's. Never
   pruned on its own, since a folder on an unplugged drive comes back. */
export function entryDrift(name, folder) {
  if (!isDir(folder)) return { gone: true };
  const now = sharedName(folder);
  return now && now !== name ? { now } : null;
}

/* Through the map: the session's own checkout when it is a checkout or
   worktree of the name, else the map's folder; null when this PC has none. */
export function folderHere(name, { cwd, dir, map } = {}) {
  if (!name) return null;
  if (cwd && isAbsolute(String(cwd)) && sharedName(cwd) === name) return topOf(cwd) || checkoutOf(cwd);
  const f = (map || readMap(dir))[name];
  if (f && isDir(f)) return f;
  /* a name with no remote is its own PC's path */
  return isPathName(name) && isDir(name) ? checkoutOf(name) : null;
}

/* What a reader says for a name this PC has no folder for, never a guess. */
export const unmappedLine = (name) => name + ' has no folder on this PC; askerdo projects scan <folder> maps it';
