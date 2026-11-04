/* What the file openers need to know about a record's refs: the id shapes, the
   list each kind's f/<id>/<n> routes index, and the one path classifier. Pure:
   no fs, no env. */

/* A record id the activity route and the f/ routes take. */
export const REC_ID = /^(?:Q\d+|(?:WS|P|T)-\d+)$/;

/* Tracks, threads, handoffs, knowledge and procedures: kinds whose refs live in
   their own fields rather than in `refs` alone (a track's TR-n.m too). */
export const CARD_ID = /^(?:T[RH]-\d+(?:\.\d+)?|K-\d+|PR-\d+)$/;

/* One normalization for a project directory, so two spellings compare equal. */
export function normDir(d) {
  return String(d || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

export function cardKind(id) {
  const s = String(id || '');
  if (/^TH-\d+$/.test(s)) return 'thread';
  if (/^TR-\d+$/.test(s)) return 'track';
  if (/^T[RH]-\d+\.\d+$/.test(s)) return 'handoff';
  if (/^K-\d+$/.test(s)) return 'knowledge';
  if (/^PR-\d+$/.test(s)) return 'procedure';
  return '';
}

const listOf = (v) => (Array.isArray(v) ? v.map((x) => String(x || '')).filter(Boolean) : []);
const slashed = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

/* A procedure's doc and its paths, a `repo:` prefix read through `repos`. */
function procFiles(rec) {
  const home = slashed(rec.project);
  if (!home) return [];
  const repos = rec.repos && typeof rec.repos === 'object' ? rec.repos : {};
  const out = [home + '/' + String(rec.doc || '')];
  for (const raw of listOf(rec.paths)) {
    const t = raw.split('::')[0];
    const m = /^([a-z0-9][a-z0-9-]*):(?!\/)(.+)$/.exec(t);
    const other = m && repos[m[1]];
    const p = (other ? slashed(other) : home) + '/' + (other ? m[2] : t).replace(/\/+$/, '');
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/* The list a work record's or card kind's f/<id>/<n> routes index; n is a position here.
   `place` maps a project's shared name to this PC's folder; a name it cannot
   place stays as written, so positions never shift. */
export function filesOf(rec, place) {
  const kind = String((rec && rec.kind) || '');
  if (kind === 'thread') return listOf(rec.links).concat(listOf(rec.refs));
  if (kind === 'knowledge') {
    const named = listOf(rec.projectRepos).map((n) => (typeof place === 'function' && place(n)) || n);
    return listOf(rec.projects).concat(named, listOf(rec.refs));
  }
  if (kind === 'procedure') return procFiles(rec).concat(listOf(rec.refs));
  if (kind === 'handoff') {
    const repos = Array.isArray(rec.verifyFirst) ? rec.verifyFirst : Array.isArray(rec.verify) ? rec.verify : [];
    return repos.map((e) => String((e && e.path) || ''));
  }
  return listOf(rec && rec.refs);
}

/* A question's evidence, the list f/<Qid>/<n> indexes. */
export const evidenceOf = (items) =>
  (Array.isArray(items) ? items : []).map((x) => String(x || '')).filter(Boolean);

const WORK_ID = /^(?:WS|P|T)-\d+$/;
const QUESTION_ID = /^Q\d+$/;
const HTTP_REF = /^https?:\/\//i;
/* Path shapes per platform; a UNC ref is never a path (an unreachable share
   froze an open for 21 seconds). */
const ABS_PATH = /^[A-Za-z]:[\\/]/;
const POSIX_PATH = /^\/(?!\/)/;
const REL_PATH = /[\\/]/;

/* The one classifier: only a 'path' is ever opened by the f/ routes. */
export function refShape(ref, platform) {
  const s = String(ref === undefined || ref === null ? '' : ref).trim();
  const os = !platform ? 'win32' : String(platform);
  if (!s) return 'text';
  if (WORK_ID.test(s)) return 'work';
  if (CARD_ID.test(s)) return 'card';
  if (QUESTION_ID.test(s)) return 'question';
  if (HTTP_REF.test(s)) return 'url';
  if (ABS_PATH.test(s)) return 'path';
  if (os !== 'win32' && POSIX_PATH.test(s)) return 'path';
  if (REL_PATH.test(s)) return 'path-rel';
  return 'text';
}
