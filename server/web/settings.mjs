/* The board's settings page: the settings verb's rows for the scope the
   chooser names, the PCs joined to the board, and the writes a form posts, each one the
   verb's own call made as the user from the signed-in device. */
import { readTx } from '../db.mjs';
import { UsageError, lookupFor } from '../verbs/labels.mjs';
import { loadProfiles, settings } from '../verbs/profiles.mjs';
import { REPO_KEY, TAKES_EFFECT, normProjectDir, parseRecordWith, sameDir, tabsOf } from '../verbs/profile-rules.mjs';
import { runVerb } from '../verbs/index.mjs';

export const SETTING_TABS = ['replies', 'sessions', 'agents', 'tests', 'rules', 'pc'];
const SCOPES = ['everywhere', 'project', 'workstream', 'track'];
const DONE = "('done', 'dropped', 'folded')";

const listOf = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
const isDir = (s) => /^([A-Za-z]:)?\//.test(String(s || '').replace(/\\/g, '/'));
export const lastPart = (p) => String(p || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';

const wsRow = (db, where, v) => db.stmt("SELECT key, label, title, fields FROM records WHERE kind = 'workstream' AND " + where).get(v);
/* the line a session is on, else the newest open track's: the nav's own pick */
function currentWs(db) {
  const r = db.stmt(`SELECT w.label AS ws FROM leases l JOIN records t ON t.key = l.track JOIN records w ON w.key = t.workstream ORDER BY l.seen DESC LIMIT 1`).get()
    || db.stmt(`SELECT w.label AS ws FROM records t JOIN records w ON w.key = t.workstream
      WHERE t.kind = 'track' AND coalesce(t.status, '') NOT IN ${DONE} ORDER BY t.updated DESC LIMIT 1`).get()
    || db.stmt("SELECT label AS ws FROM records WHERE kind = 'workstream' AND status = 'open' ORDER BY id LIMIT 1").get();
  return r ? r.ws : null;
}

/* A workstream's project as a folder the verbs take, with its remote when it has one. */
function projectOf(data, fields) {
  const names = listOf(fields.projectRepos);
  const remote = names.find((n) => !isDir(n)) || '';
  const dir = listOf(fields.projects).find(isDir) || names.find(isDir) || (remote && listOf((data.subscriptions[REPO_KEY + remote] || {}).dirs)[0]) || '';
  return dir ? { dir: normProjectDir(dir), repo: remote, name: lastPart(remote || dir) } : null;
}

/* The page's model from its query: { scope, record, ws, tab, edit, place }. */
export function settingsModel(db, q, { device, origin, tokens = [] } = {}) {
  return readTx(db, () => {
    const lookup = lookupFor(db);
    const data = loadProfiles(db);
    const scope = SCOPES.includes(q.scope) ? q.scope : 'everywhere';
    let rec = null;
    let ws;
    if (scope === 'track' || scope === 'workstream') {
      rec = parseRecordWith(lookup, q.record || '');
      if (rec.level !== scope) throw new UsageError(q.record + ' is not a ' + scope);
      ws = scope === 'workstream' ? wsRow(db, 'key = ?', rec.ref) : wsRow(db, 'key = ?', rec.row.fields.workstream);
    } else ws = (q.ws && wsRow(db, 'label = ?', String(q.ws).toUpperCase())) || wsRow(db, 'label = ?', currentWs(db));
    const wsFields = ws ? JSON.parse(ws.fields) : {};
    const project = ws ? projectOf(data, wsFields) : null;
    let read;
    let scopeOf;
    if (scope === 'project') {
      const dir = normProjectDir(q.record || (project && project.dir) || '');
      const repo = project && sameDir(project.dir, dir) ? project.repo : '';
      read = settings(db, { record: dir, repo: repo || undefined });
      scopeOf = { kind: 'project', record: dir, repo, word: lastPart(repo || dir) };
    } else if (rec) {
      read = settings(db, { record: rec.key, ...(project ? { repo: project.repo || undefined, repos: project.repo ? { [project.dir]: project.repo } : {} } : {}) });
      scopeOf = { kind: scope, record: rec.key, word: rec.key, name: rec.row.fields.name || '' };
    } else {
      read = settings(db, { record: 'default' });
      scopeOf = { kind: 'everywhere', record: 'default', word: 'Everywhere' };
    }
    const tracks = ws ? db.stmt(`SELECT label, title FROM records WHERE kind = 'track' AND workstream = ? AND coalesce(status, '') NOT IN ${DONE} ORDER BY id`).all(ws.key)
      .map((t) => ({ id: t.label, name: t.title })) : [];
    const workstreams = db.stmt("SELECT label, title FROM records WHERE kind = 'workstream' AND status = 'open' ORDER BY id").all().map((w) => ({ id: w.label, name: w.title }));
    if (ws && !workstreams.some((w) => w.id === ws.label)) workstreams.push({ id: ws.label, name: ws.title });
    /* names for the records a row or the scope line points at */
    const names = {};
    for (const c of read.chain) if (c.level !== 'default' && c.level !== 'project') names[c.key] = (lookup(c.ref) || { fields: {} }).fields.name || '';
    const { home, drops } = read;
    /* a save here runs no PC's sync: each PC takes a reply option at its next session start */
    read = { ...read, rows: read.rows.map((r) => (r.takes === TAKES_EFFECT.reply ? { ...r, takes: TAKES_EFFECT.replyBoard } : r)) };
    /* the page has no session in view, so its summaries name the picked place */
    const place = scopeOf.kind === 'everywhere' ? 'everywhere' : scopeOf.kind === 'project' ? 'in ' + scopeOf.word : 'on ' + scopeOf.word;
    read.tabs = tabsOf(read.rows, { board: true, place });
    const tab = SETTING_TABS.includes(q.tab) ? q.tab : 'replies';
    return {
      scope: scopeOf, ws: ws ? { id: ws.label, name: ws.title } : null, project, workstreams, tracks, read, names, tab, home, drops,
      edit: q.edit ? { key: String(q.edit), place: String(q.place || '') } : null,
      device, origin, devices: devicesOf(tokens, device),
    };
  });
}

/* Each joined PC once, the signed-in one first, then the live ones. */
function devicesOf(tokens, me) {
  const by = new Map();
  for (const t of tokens) {
    const d = by.get(t.device) || { device: t.device, joined: t.created, live: false, revoked: null };
    if (!t.revoked) { d.live = true; d.joined = t.created; } else d.revoked = t.revoked;
    by.set(t.device, d);
  }
  return [...by.values()].sort((a, b) => (b.device === me) - (a.device === me) || b.live - a.live);
}

/* ---- the writes ------------------------------------------------------------------ */

const field = (f, k) => (typeof f[k] === 'string' ? f[k] : '');
const opt = (s) => (s === '' ? undefined : s);

/* One posted form as its verb call; the verb alone validates. */
export function settingsWrite(db, what, f, device) {
  const actor = { pc: device, user: true };
  const where = { at: opt(field(f, 'at')), record: opt(field(f, 'record')), repo: opt(field(f, 'repo')) };
  if (where.repo && where.record) where.repos = { [where.record]: where.repo };
  if (what === 'set') return runVerb(db, 'settingsSet', { key: field(f, 'key'), value: field(f, 'value'), ...where }, actor);
  if (what === 'unset') return runVerb(db, 'settingsUnset', { key: field(f, 'key'), ...where }, actor);
  if (what === 'rule') {
    return runVerb(db, 'settingsRule', { profile: opt(field(f, 'name')), op: field(f, 'op'), slug: field(f, 'slug'), text: opt(field(f, 'text')), for: opt(field(f, 'for')) }, actor);
  }
  throw new UsageError('the settings page has no write named ' + what);
}
