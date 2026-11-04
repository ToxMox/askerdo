/* projects rename: a project's records move from one shared name to
   another in one transaction, so a clone of the renamed remote lands in the same
   project. Fields change in place, so each front keeps its key order. */
import { tx } from '../db.mjs';
import { actorOf, addNote, logVerb, orderFields, putRecord } from '../records.mjs';
import { UsageError, endingStamps, entryOf } from './labels.mjs';
import { REPO_KEY, isDirKey, normProjectDir } from './profile-rules.mjs';
import { loadProfiles, saveSubscriptions } from './profiles.mjs';
import { relativeTo } from './proc-cards.mjs';

export { UsageError };

const KINDS = ['question', 'workstream', 'knowledge', 'procedure'];
const ONE = { question: 'projectRepo', procedure: 'projectRepo', workstream: 'projectRepos', knowledge: 'projectRepos' };
const WORDS = { question: 'question', workstream: 'workstream', knowledge: 'knowledge record', procedure: 'procedure card', profile: 'profile holding' };

/* a shared name as sharedName writes it: forward slashes, no trailing slash, lowercase */
const nameOf = (v) => String(v ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const lower = (v) => (typeof v === 'string' ? nameOf(v) : '');
const listOf = (v) => (Array.isArray(v) ? v : []);
const lastPart = (s) => String(s).split('/').filter(Boolean).pop() || '';
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

/* Every record naming `name` in its project field, oldest first. */
function rowsNaming(db, kind, name) {
  const sql = ONE[kind] === 'projectRepo'
    ? "SELECT key, kind, slug, fields, body, layout, track, version FROM records WHERE kind = ? AND lower(json_extract(fields, '$.projectRepo')) = ? ORDER BY id"
    : `SELECT key, kind, slug, fields, body, layout, track, version FROM records AS r WHERE kind = ?
       AND EXISTS (SELECT 1 FROM json_each(r.fields, '$.projectRepos') WHERE lower(value) = ?) ORDER BY id`;
  return db.stmt(sql).all(kind, name).map(entryOf);
}

/* `folders` as [{ from, to }] absolute dirs; a path under an old dir moves with it. */
function folderMap(folders) {
  const pairs = listOf(folders).map((f) => {
    if (!f || typeof f !== 'object') throw new UsageError('a folder is { from, to }, two absolute directories');
    return { from: normProjectDir(f.from), to: normProjectDir(f.to) };
  }).sort((a, b) => b.from.length - a.from.length);
  const rebase = (d) => {
    if (typeof d !== 'string' || !d) return null;
    for (const f of pairs) {
      const rest = relativeTo(f.from, d);
      if (rest !== null) return rest ? f.to + '/' + rest : f.to;
    }
    return null;
  };
  return { pairs, rebase };
}

/* projectsRename { from, to, folders, dryRun }: a question's projectRepo (and its
   short project when it was the old one's), a procedure card's projectRepo, a
   workstream's and a knowledge record's projectRepos, and the profile holdings
   by remote (repo:<name>, its dirs through `folders`) and at an old folder. A
   card the new name holds under a moving card's slug is a scan's twin, retired. */
export function projectsRename(db, input = {}, actor) {
  const from = nameOf(input.from);
  const to = nameOf(input.to);
  if (!from || !to) throw new UsageError('projects rename needs the old name and the new name');
  if (from === to) throw new UsageError('the old and the new name are the same: ' + from);
  const { pairs, rebase } = folderMap(input.folders);
  const dryRun = input.dryRun === true;
  /* a question's short name: an old folder's last part becomes the new one's, else the name's */
  const shorts = new Map(pairs.map((f) => [lastPart(f.from).toLowerCase(), lastPart(f.to)]));
  if (!shorts.has(lastPart(from))) shorts.set(lastPart(from), lastPart(to));
  return tx(db, () => {
    const moving = Object.fromEntries(KINDS.map((k) => [k, rowsNaming(db, k, from)]));
    const slugs = new Set(moving.procedure.filter((c) => !c.fields.everywhere).map((c) => c.fields.slug).filter(Boolean));
    const twins = [];
    const held = [];
    for (const kind of KINDS) {
      for (const e of rowsNaming(db, kind, to)) {
        if (kind === 'procedure' && slugs.has(e.fields.slug)) twins.push(e);
        else held.push(e.label || e.key);
      }
    }
    const data = loadProfiles(db);
    const subs = data.subscriptions;
    const oldKey = REPO_KEY + from;
    const newKey = REPO_KEY + to;
    if (subs[newKey]) held.push('the profile holding ' + newKey);
    const dirKeys = Object.keys(subs).filter((k) => isDirKey(k) && rebase(k) !== null);
    for (const k of dirKeys) if (subs[rebase(k)]) held.push('the profile holding at ' + rebase(k));
    const moved = Object.fromEntries(KINDS.map((k) => [k, moving[k].length]));
    moved.profile = (subs[oldKey] ? 1 : 0) + dirKeys.length;
    const total = Object.values(moved).reduce((a, b) => a + b, 0);
    const unmapped = subs[oldKey] ? listOf(subs[oldKey].dirs).filter((d) => rebase(d) === null) : [];
    const out = { from, to, dryRun, folders: pairs, moved, retired: twins.filter((e) => e.fields.status !== 'retired').map((e) => e.label), unmapped, activity: null };
    if (!total) return out;
    if (held.length) {
      throw new UsageError(to + ' already holds records (' + held.slice(0, 8).join(', ') + (held.length > 8 ? ' and ' + (held.length - 8) + ' more' : '')
        + '): a rename moves a project onto a name no record holds');
    }
    if (dryRun) return out;
    const ctx = actorOf(actor);
    const put = (e, fields) => putRecord(db, { key: e.key, kind: e.kind, slug: e.slug, fields, body: e.body, layout: e.layout, track: e.track });
    for (const kind of KINDS) {
      for (const e of moving[kind]) {
        const f = { ...e.fields };
        if (ONE[kind] === 'projectRepo') f.projectRepo = to;
        else f.projectRepos = [...new Set(listOf(f.projectRepos).map((n) => (lower(n) === from ? to : n)))];
        /* folders a record still names from before the shared names */
        if (kind === 'question' && rebase(f.projectDir) !== null) f.projectDir = rebase(f.projectDir);
        if (kind === 'procedure' && rebase(f.project) !== null) f.project = rebase(f.project);
        if (Array.isArray(f.projects)) f.projects = f.projects.map((d) => rebase(d) ?? d);
        if (kind === 'question' && typeof f.project === 'string' && shorts.has(f.project.toLowerCase())) f.project = shorts.get(f.project.toLowerCase());
        put(e, f);
      }
    }
    for (const e of twins) {
      if (e.fields.status === 'retired') continue;
      const keep = moving.procedure.find((c) => c.fields.slug === e.fields.slug);
      const f = { ...e.fields, status: 'retired', updated: ctx.at };
      endingStamps(db, 'procedure', f, e.fields, ctx);
      put(e, orderFields('procedure', f));
      addNote(db, e.key, { at: ctx.at, actor: ctx.by, body: 'retired: ' + keep.label + ' carries this procedure since ' + from + ' became ' + to });
    }
    if (subs[oldKey]) {
      subs[newKey] = { ...subs[oldKey], dirs: listOf(subs[oldKey].dirs).map((d) => rebase(d) ?? d) };
      delete subs[oldKey];
    }
    for (const k of dirKeys) {
      subs[rebase(k)] = subs[k];
      delete subs[k];
    }
    if (moved.profile) saveSubscriptions(db, subs);
    const said = Object.entries(moved).filter(([, n]) => n).map(([k, n]) => plural(n, WORDS[k]));
    out.activity = logVerb(db, {
      ts: ctx.at, verb: 'rename', kind: 'project', id: '', name: from + ' to ' + to, by: ctx.by, pc: ctx.pc,
      changes: { project: [from, to], ...(pairs.length ? { folders: [pairs.map((f) => f.from), pairs.map((f) => f.to)] } : {}) },
      note: 'moved ' + said.join(', ') + (out.retired.length ? '; retired ' + out.retired.join(', ') + ', a scan\'s twins' : ''),
    });
    return out;
  });
}
