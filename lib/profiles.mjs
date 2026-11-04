/* Profiles on this PC: the depth-guard markers in the
   claude home, written from what the board resolves. The settings, the chain and
   the words are the board's pure half (server/verbs/profile-rules.mjs). */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEYS, SETTINGS, valuesOf } from '../server/verbs/profile-rules.mjs';

export {
  SETTINGS, effectiveText, heldText, normProjectDir, rulesBlock, rulesText, settingsText, valuesOf,
} from '../server/verbs/profile-rules.mjs';

export const MARKER = 'depth-guard.json';
/* what marks a marker as ours, so a hand-written one is never rewritten or removed */
export const MARKER_BY = 'askerdo profiles';

/* Every setting at its built-in value: what a board that could not be read leaves. */
export function builtIns() {
  const settings = {};
  for (const key of Object.keys(SETTINGS).filter((k) => !SETTINGS[k].list)) {
    settings[key] = { value: SETTINGS[key].def, profile: null, record: null, level: 'built-in' };
  }
  return { chain: [], settings, lines: [] };
}

const slugOf = (dir) => String(dir).replace(/[^A-Za-z0-9]/g, '-');

/* The harness's own folder for a project when it has one in another case. */
function projectFolder(home, dir) {
  const want = slugOf(dir);
  try {
    const hit = readdirSync(join(home, 'projects')).find((n) => n.toLowerCase() === want.toLowerCase());
    if (hit) return join(home, 'projects', hit);
  } catch {}
  return join(home, 'projects', want);
}

/* `track` is the folder: the held track's key. */
export function markerPath(home, dir, track) {
  const base = projectFolder(home, dir);
  return track ? join(base, track, MARKER) : join(base, MARKER);
}

/* What the marker holds: the old shape's soft, hard and remind only while the guard
   is on (a hook from before profiles reads any marker as opted in). */
export function markerBody(eff, dir, track) {
  const v = valuesOf(eff);
  const sources = {};
  for (const k of KEYS) {
    const s = eff.settings[k];
    if (s.profile) sources[k] = { profile: s.profile, record: s.record, level: s.level };
  }
  const agent = { on: v['agent.on'], soft: v['agent.soft'], hard: v['agent.hard'], remind: v['agent.remind'], hardDeny: v['agent.hardDeny'] };
  const held = eff.chain.find((c) => c.level === 'track');
  /* the field keeps its name: the hooks and the mod read `thread` */
  const body = { by: MARKER_BY, projectDir: dir, thread: track ? (held ? held.key : track) : null, records: eff.chain.map((c) => c.key) };
  if (agent.on) Object.assign(body, { soft: agent.soft, hard: agent.hard, remind: agent.remind, hardDeny: agent.hardDeny });
  return { ...body, meter: { on: v['main.on'], window: v['main.window'], wrap: v['main.wrap'] }, agent, sources };
}

function readJson(path) {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch { return null; }
}

/* Our marker on disk as it stands, or null (a hand-written one never opts in). */
export function readMarker(home, dir, track) {
  const j = readJson(markerPath(home, dir, track));
  return j && j.by === MARKER_BY ? j : null;
}

/* Writes the marker when a profile sets anything, removes ours when none does;
   a hand-written marker is never touched. Returns what it did. */
export function syncMarker(home, dir, track, eff) {
  const path = markerPath(home, dir, track);
  const current = readJson(path);
  const foreign = current && current.by !== MARKER_BY;
  const any = KEYS.some((k) => eff.settings[k].profile);
  if (!any) {
    if (current && !foreign) { rmSync(path, { force: true }); return { path, did: 'removed' }; }
    return { path, did: 'none' };
  }
  const text = JSON.stringify(markerBody(eff, dir, track), null, 2) + '\n';
  let old = null;
  try { old = readFileSync(path, 'utf8'); } catch {}
  if (old === text) return { path, did: 'current' };
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return { path, did: 'written' };
}
