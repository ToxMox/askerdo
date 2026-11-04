/* Profiles and the rules in force over SQLite (from
   lib/profiles.mjs). A profile is a `profile` record keyed by its name; the
   default's and the projects' holdings are the `profile.subscriptions` meta
   row; a work record holds its own in `profiles` and `profileDrops`. The pure
   resolution is profile-rules.mjs, shared with each PC's local server. */
import { tx } from '../db.mjs';
import { actorOf, getMeta, logRow, orderFields, setMeta, putRecord } from '../records.mjs';
import { profileKey } from '../import.mjs';
import { UsageError, loadEntry as recordByKey, lookupFor, resolveRecord } from './labels.mjs';
import { addHistory, historyRef, timeOf } from './history.mjs';

/* Replace a row's fields in its kind's key order, keeping body, slug, layout and track. */
const saveRecord = (db, row, fields) => putRecord(db, {
  key: row.key, kind: row.kind, slug: row.slug, fields: orderFields(row.kind, fields), body: row.body, layout: row.layout, track: row.track,
});
import {
  AUDIENCES, BUILTIN, KIND_LEVEL, LEVELS, PC_SETTINGS, REPO_KEY, RETIRED, SETTINGS, activeAt, byLabel, chainOver, checkName, checkPairs, checkSetting, clashes,
  contractHeld, contractHome, heldIn, heldOf, isDirKey, isRepoKey, noSub, normProjectDir, parseRecordWith, parseValue, profileOf, projectKeys, projectSub,
  listCopy, remoteOf, resolveChain, sameDir, settingRows, settingsOf, tabsOf, travelText, travelsOf, wordsOf,
} from './profile-rules.mjs';

export { UsageError };

const SUBS = 'profile.subscriptions';
const WORK_KINDS = Object.keys(KIND_LEVEL);

/* ---- the stored data ---------------------------------------------------- */

/* Today's readProfiles shape, { profiles, subscriptions }: what resolveChain
   takes and what each PC's cache holds. */
export function loadProfiles(db) {
  const out = { profiles: {}, subscriptions: {} };
  for (const r of db.stmt("SELECT fields FROM records WHERE kind = 'profile' ORDER BY id").all()) {
    const f = JSON.parse(r.fields);
    if (f && f.name && f.profile && typeof f.profile === 'object') out.profiles[f.name] = f.profile;
  }
  const raw = getMeta(db, SUBS);
  for (const [k, v] of Object.entries(raw ? JSON.parse(raw) : {})) {
    if (!v || typeof v !== 'object') continue;
    out.subscriptions[k] = { add: Array.isArray(v.add) ? v.add.slice() : [], drop: Array.isArray(v.drop) ? v.drop.slice() : [] };
    if (isRepoKey(k)) out.subscriptions[k].dirs = Array.isArray(v.dirs) ? v.dirs.slice() : [];
  }
  return out;
}

/* Sorted, with empty holdings left out: today's writeProfiles, so the export
   stays byte-stable. */
export function saveSubscriptions(db, subscriptions) {
  const subs = {};
  for (const k of Object.keys(subscriptions).sort()) {
    const v = subscriptions[k];
    if (!v.add.length && !v.drop.length) continue;
    subs[k] = { add: [...v.add].sort(), drop: [...v.drop].sort() };
    if (v.dirs && v.dirs.length) subs[k].dirs = [...v.dirs].sort();
  }
  setMeta(db, SUBS, JSON.stringify(subs));
}

function saveProfile(db, name, profile) {
  putRecord(db, { key: profileKey(name), kind: 'profile', fields: { name, profile }, body: '' });
}

/* A record word inside the transaction: unknown work records are refused by
   name. The board cannot read a checkout, so a project's remote comes from the
   caller: `repo` for the dir it names, `repos` its project map for the rest. */
function recordWord(db, word, repo, repos) {
  const rec = parseRecordWith(lookupFor(db), word);
  if (rec.level === 'project') rec.repo = repo || remoteOf(repos, rec.key);
  return rec;
}

/* Where a verb's record holds its profiles, read for the change: a work
   record's own fields, a project's remote entry (a dir entry folds into it),
   or the default's entry. */
function holdingFor(db, data, rec) {
  if (KIND_LEVEL[rec.level]) {
    const row = recordByKey(db, rec.ref);
    return {
      sub: heldOf(row.fields), shown: rec.key, key: row.key, travels: 'record',
      save(next, at) {
        saveRecord(db, row, { ...row.fields, profiles: [...next.add].sort(), profileDrops: [...next.drop].sort(), updated: at });
      },
    };
  }
  if (rec.level === 'project') {
    const { repo, dirs, key, shown } = projectKeys(data, rec.key, rec.repo);
    return {
      sub: projectSub(data, rec.key, rec.repo), shown, repo, travels: travelsOf('project', repo),
      save(next) {
        if (repo) {
          let keep = (data.subscriptions[key] && data.subscriptions[key].dirs) || [];
          for (const d of [...dirs, rec.key]) if (!keep.some((x) => sameDir(x, d))) keep = [...keep, d];
          for (const d of dirs) delete data.subscriptions[d];
          data.subscriptions[key] = { ...next, dirs: keep };
        } else data.subscriptions[key] = next;
        saveSubscriptions(db, data.subscriptions);
      },
    };
  }
  return {
    sub: data.subscriptions.default || noSub(), shown: 'default', travels: 'board',
    save(next) { data.subscriptions.default = next; saveSubscriptions(db, data.subscriptions); },
  };
}

/* ---- the reads ---------------------------------------------------------- */

/* What a record resolves to: its chain, each setting with where it came from,
   the rule lines, and which levels hold what. */
export function effective(db, { record, project, repo, repos } = {}) {
  const rec = recordWord(db, record, repo, repos);
  const data = loadProfiles(db);
  const r = resolveChain(data, chainOver(lookupFor(db), rec, { project, repo, repos }));
  return { record: rec.key, ...r, held: heldIn(data, r.chain) };
}

/* the board's settings rows for a record (default when none named);
   each PC adds its own rows from config.json (withPcRows). */
export function settings(db, { record, project, repo, repos } = {}) {
  const rec = recordWord(db, record || 'default', repo, repos);
  const data = loadProfiles(db);
  const chain = chainOver(lookupFor(db), rec, { project, repo, repos });
  const rows = settingRows(data, chain, null, { board: true, under: underOf(db, data, repos) });
  /* home: the profile a rule line or a built-in value goes to, one pick for the pane and the board page;
     drops: the line names home switched off, which both list with a Bring back */
  const home = contractHome(data).profile || HOME;
  const drops = (settingsOf(data.profiles[home])['rules.drop'] || []).filter((x) => typeof x === 'string' && x);
  return { record: rec.key, chain, rows, tabs: tabsOf(rows, { board: true }), lists: listCopy(true), held: heldIn(data, chain), home, drops };
}

/* every holding with the chain above it, so a row can say where narrower records override it. */
function underOf(db, data, repos) {
  const lookup = lookupFor(db);
  return holdings(db, data).map((h) => {
    const rec = KIND_LEVEL[h.level] ? { level: h.level, key: h.shown, ref: h.key, row: lookup(h.key) }
      : h.level === 'project' ? { level: 'project', key: h.shown, repo: h.repo || '' } : { level: 'default', key: 'default' };
    return { level: h.level, record: h.shown, profiles: h.sub.add, chain: chainOver(lookup, rec, { repos }) };
  });
}

/* A session's track word; one the board does not know still resolves at the
   track level, holding nothing. */
function sessionRec(db, word) {
  try {
    const rec = parseRecordWith(lookupFor(db), word);
    if (rec.level === 'track') return rec;
  } catch (e) { if (!(e instanceof UsageError)) throw e; }
  return { level: 'track', key: String(word).trim() };
}

/* A session's settings: its track when it holds one, else its project. */
export function resolveSession(db, { cwd, repo, repos, track } = {}) {
  const rec = track ? sessionRec(db, track) : { level: 'project', key: normProjectDir(cwd), repo: repo || '' };
  return resolveChain(loadProfiles(db), chainOver(lookupFor(db), rec, { project: cwd, repo, repos }));
}

/* The newest task the session has in hand, else the one it holds
   in_progress (it subscribes), lowest label first. */
function heldTask(db, session) {
  const hand = db.stmt(`SELECT key, label FROM records WHERE kind = 'task' AND json_extract(fields, '$.inHand') = ?
    AND status NOT IN ('completed', 'dropped') ORDER BY json_extract(fields, '$.inHandSince') DESC, id DESC LIMIT 1`).get(session);
  if (hand) return { level: 'task', key: hand.label, ref: hand.key, row: lookupFor(db)(hand.key) };
  const held = db.stmt(`SELECT key, label FROM records AS r WHERE kind = 'task' AND status = 'in_progress'
    AND EXISTS (SELECT 1 FROM json_each(r.fields, '$.subscribers') WHERE value = ?)`).all(session)
    .sort((a, b) => String(a.label).localeCompare(String(b.label), 'en', { numeric: true }));
  return held.length ? { level: 'task', key: held[0].label, ref: held[0].key, row: lookupFor(db)(held[0].key) } : null;
}

/* A session's rules: its track, else its task in hand, else its project. */
export function rulesFor(db, { cwd, repo, repos, track, session } = {}) {
  const rec = track ? sessionRec(db, track)
    : (session && heldTask(db, session)) || { level: 'project', key: normProjectDir(cwd), repo: repo || '' };
  return { record: rec.key, ...resolveChain(loadProfiles(db), chainOver(lookupFor(db), rec, { project: cwd, repo, repos })) };
}

/* Every work record's holding, shown by label. */
function recordHoldings(db) {
  const rows = db.stmt(`SELECT key, kind, label, fields FROM records WHERE kind IN (${WORK_KINDS.map(() => '?').join(', ')})
    AND (json_extract(fields, '$.profiles') IS NOT NULL OR json_extract(fields, '$.profileDrops') IS NOT NULL)`).all(...WORK_KINDS);
  const out = [];
  for (const r of rows) {
    const sub = heldOf(JSON.parse(r.fields));
    if (sub.add.length || sub.drop.length) out.push({ shown: r.label, key: r.key, level: r.kind, sub, travels: 'record' });
  }
  return out.sort((a, b) => byLabel(a.shown, b.shown));
}

/* Every holding the board knows, the default and projects first. */
function holdings(db, data) {
  const out = [];
  for (const [key, sub] of Object.entries(data.subscriptions)) {
    if (key === 'default') out.push({ shown: 'default', key, level: 'default', sub, travels: 'board' });
    else if (isRepoKey(key)) {
      const repo = key.slice(REPO_KEY.length);
      out.push({ shown: (sub.dirs || [])[0] || repo, key, level: 'project', sub, travels: 'remote', repo });
    } else if (isDirKey(key)) out.push({ shown: key, key, level: 'project', sub, travels: 'here' });
  }
  return [...out, ...recordHoldings(db)];
}

export function profileList(db) {
  const data = loadProfiles(db);
  const held = {};
  const where = {};
  const subscriptions = {};
  for (const h of holdings(db, data)) {
    subscriptions[h.shown] = { add: h.sub.add, drop: h.sub.drop };
    for (const n of h.sub.add) {
      (held[n] = held[n] || []).push(h.shown);
      (where[n] = where[n] || []).push({ record: h.shown, level: h.level, travels: h.travels, ...(h.repo ? { repo: h.repo } : {}), note: travelText(h) });
    }
  }
  const row = (n, p, builtIn) => ({
    profile: n, builtIn, description: p.description || '', settings: builtIn ? p.settings : settingsOf(p),
    records: (held[n] || []).sort(), held: (where[n] || []).sort((a, b) => a.record.localeCompare(b.record)),
  });
  const rows = Object.entries(BUILTIN).map(([n, p]) => row(n, p, true));
  for (const n of Object.keys(data.profiles).sort()) rows.push(row(n, data.profiles[n], false));
  return { profiles: rows, subscriptions };
}

/* ---- the writes --------------------------------------------------------- */

export function profileAdd(db, { record, name, repo, repos } = {}, actor) {
  const n = checkName(name);
  return tx(db, () => {
    const rec = recordWord(db, record, repo, repos);
    const data = loadProfiles(db);
    if (!profileOf(data, n)) throw new UsageError('no profile named ' + n + ' (profile list shows them; profile define makes one)');
    const h = holdingFor(db, data, rec);
    const sub = { add: [...h.sub.add], drop: [...h.sub.drop] };
    const wasDropped = sub.drop.includes(n);
    sub.drop = sub.drop.filter((x) => x !== n);
    if (sub.add.includes(n) && !wasDropped) return { record: h.shown, profile: n, added: false, travels: h.travels };
    const bad = clashes(data, sub.add.filter((x) => x !== n).concat(n));
    if (bad.length) {
      throw new UsageError('refused: on ' + h.shown + ', two profiles would set ' + bad.join(', ')
        + '; remove one first, or put the value in one profile');
    }
    if (!sub.add.includes(n)) sub.add.push(n);
    const c = actorOf(actor);
    const { at } = c;
    h.save(sub, at);
    logRow(db, c, { verb: 'profile-add', kind: 'profile', front: { id: h.shown, key: h.key, name: n }, changes: { profile: n } });
    return { record: h.shown, profile: n, added: true, travels: h.travels };
  });
}

/* Off the record when it holds the profile; when it only inherits it, a drop,
   so the profile stops applying here and below. */
export function profileRemove(db, { record, name, project, repo, repos } = {}, actor) {
  const n = checkName(name);
  return tx(db, () => {
    const rec = recordWord(db, record, repo, repos);
    const data = loadProfiles(db);
    const h = holdingFor(db, data, rec);
    const sub = { add: [...h.sub.add], drop: [...h.sub.drop] };
    let how;
    if (sub.add.includes(n)) { sub.add = sub.add.filter((x) => x !== n); how = 'removed'; }
    else if (sub.drop.includes(n)) return { record: h.shown, profile: n, how: 'already dropped', travels: h.travels };
    else {
      /* the record is the chain's narrowest level, so the wider ones are what it inherits */
      const active = activeAt(data, chainOver(lookupFor(db), rec, { project, repo, repos }));
      if (!active.slice(0, -1).some((names) => names.includes(n))) {
        throw new UsageError(h.shown + ' neither holds nor inherits ' + n + '; nothing to remove');
      }
      sub.drop.push(n);
      how = 'dropped';
    }
    const c = actorOf(actor);
    const { at } = c;
    h.save(sub, at);
    logRow(db, c, { verb: 'profile-remove', kind: 'profile', front: { id: h.shown, key: h.key, name: n }, changes: { profile: n, how } });
    return { record: h.shown, profile: n, how, travels: h.travels };
  });
}

/* Make or edit a profile. Every record holding it is checked again for a clash. */
export function profileDefine(db, { name, set = [], unset = [], description, made } = {}, actor) {
  const n = checkName(name);
  if (BUILTIN[n]) throw new UsageError(n + ' is built in and cannot be edited');
  const changes = {};
  for (const pair of set) {
    const i = String(pair).indexOf('=');
    if (i < 1) throw new UsageError('--set takes key=value: ' + pair);
    const key = pair.slice(0, i).trim();
    changes[key] = parseValue(key, pair.slice(i + 1));
  }
  for (const key of unset) if (!SETTINGS[key] && !Object.hasOwn(RETIRED, key)) throw new UsageError('unknown setting ' + key);
  return tx(db, () => {
    const data = loadProfiles(db);
    const before = data.profiles[n];
    const c = actorOf(actor);
    const { at } = c;
    const settings = { ...settingsOf(before) };
    for (const key of unset) delete settings[key];
    Object.assign(settings, changes);
    if (!Object.keys(settings).length) throw new UsageError(n + ' would set nothing; give it --set key=value');
    checkPairs(settings, n);
    const p = { description: description !== undefined ? String(description).trim() : (before && before.description) || '', settings };
    /* a profile settings set made for a record says so, so its last unset drops it */
    const maker = (before && before.made) || (before ? null : made);
    if (maker) p.made = maker;
    p.created = (before && before.created) || at;
    p.updated = at;
    data.profiles[n] = p;
    for (const { shown, sub } of holdings(db, data)) {
      if (!sub.add.includes(n)) continue;
      const bad = clashes(data, sub.add);
      if (bad.length) throw new UsageError('refused: ' + shown + ' holds ' + n + ' and another profile, and both would set ' + bad.join(', '));
    }
    saveProfile(db, n, p);
    logRow(db, c, { verb: before ? 'profile-edit' : 'profile-define', kind: 'profile', front: { id: n, name: n, key: profileKey(n) }, changes: settings });
    return { profile: n, created: !before, settings, description: p.description };
  });
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/* A ruling a rule line comes from: a decision K-n or an answered Q-n, with when it was made. */
function rulingOf(db, token, day, flag) {
  const t = String(token ?? '').trim();
  const e = t ? resolveRecord(db, t, { kinds: ['knowledge', 'question'], day }) : null;
  if (!e) throw new UsageError(flag + ' names a ruling, a decision K-n or an answered Q-n: ' + token);
  if (e.kind === 'knowledge' && e.front.type !== 'decision') throw new UsageError(e.label + ' is a ' + e.front.type + ', not a ruling');
  if (e.kind === 'question' && e.front.status !== 'answered') throw new UsageError(e.label + ' is ' + e.front.status + ', not a ruling yet');
  return { key: e.key, label: e.label, at: timeOf(e.kind === 'question' ? e.front.answered || e.front.created : e.front.created) };
}

/* A slug's line as the history keeps it: its words, a drop, or nothing. */
function lineAt(settings, s) {
  const l = (Array.isArray(settings['rules.add']) ? settings['rules.add'] : []).find((x) => x && x.slug === s);
  if (l) return l.text;
  return (Array.isArray(settings['rules.drop']) ? settings['rules.drop'] : []).includes(s) ? '(dropped here)' : null;
}

/* Rule lines on a profile: add (or replace) a line, drop a wider one by slug,
   clear a slug from both lists. Add or drop makes a missing profile. A line is
   for the session, its agents, or both (`for` left out, as before).
   a line names the ruling it came from, and then changes only with a newer one. */
export function profileRule(db, { name, op, slug, text, for: aud, from, ruling } = {}, actor) {
  const n = checkName(name);
  if (BUILTIN[n]) throw new UsageError(n + ' is built in and cannot be edited');
  if (!['add', 'drop', 'clear'].includes(op)) throw new UsageError('profile rule takes add, drop or clear');
  const s = String(slug ?? '').trim();
  if (!SLUG_RE.test(s)) throw new UsageError('a rule slug is lowercase letters, digits and dashes, at most 40: ' + slug);
  const sentence = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (op === 'add' && (!sentence || sentence.length > 400)) throw new UsageError('profile rule add takes the rule in plain words, at most 400 characters');
  const who = aud === undefined || aud === null || aud === '' || aud === 'both' ? null : String(aud).trim();
  if (who !== null && (op !== 'add' || !AUDIENCES.includes(who))) throw new UsageError('--for takes session, agents or both, on rule-add: ' + aud);
  if (from !== undefined && from !== null && from !== '' && op !== 'add') throw new UsageError('--from names where a new line came from, on rule-add');
  return tx(db, () => {
    const data = loadProfiles(db);
    const before = data.profiles[n];
    if (!before && op === 'clear') throw new UsageError('no profile named ' + n);
    const c = actorOf(actor);
    const { at } = c;
    const newer = ruling !== undefined && ruling !== null && ruling !== '' ? rulingOf(db, ruling, c.day, '--ruling') : null;
    const source = newer || (from !== undefined && from !== null && from !== '' ? rulingOf(db, from, c.day, '--from') : null);
    /* the lines this change replaces, clears or drops that came from a ruling */
    const held = op === 'drop' ? Object.values(data.profiles).flatMap((p) => settingsOf(p)['rules.add'] || [])
      : settingsOf(before)['rules.add'] || [];
    for (const l of held.filter((x) => x && x.slug === s && x.from)) {
      const was = recordByKey(db, l.from);
      const wasAt = was ? timeOf(was.kind === 'question' ? was.front.answered || was.front.created : was.front.created) : null;
      if (!newer || newer.key === l.from || (wasAt !== null && (newer.at === null || newer.at <= wasAt))) {
        throw new UsageError('rule ' + s + ' came from ' + (was ? was.label : l.from) + ': it changes only with a newer ruling (--ruling K-n)'
          + (newer ? '; ' + newer.label + ' is not newer' : ''));
      }
    }
    const settings = { ...settingsOf(before) };
    const adds = (Array.isArray(settings['rules.add']) ? settings['rules.add'] : []).filter((l) => l.slug !== s);
    const drops = (Array.isArray(settings['rules.drop']) ? settings['rules.drop'] : []).filter((x) => x !== s);
    if (op === 'add') adds.push({ slug: s, text: sentence, ...(who ? { for: who } : {}), ...(source ? { from: source.key } : {}) });
    if (op === 'drop') drops.push(s);
    if (adds.length) settings['rules.add'] = adds.sort((a, b) => a.slug.localeCompare(b.slug)); else delete settings['rules.add'];
    if (drops.length) settings['rules.drop'] = drops.sort(); else delete settings['rules.drop'];
    /* a clear may leave a profile empty, as settings unset does; one settings set made then goes */
    const gone = !Object.keys(settings).length && before.made === 'settings';
    if (!gone) saveProfile(db, n, { ...(before || {}), description: (before && before.description) || '', settings, created: (before && before.created) || at, updated: at });
    const old = lineAt(settingsOf(before), s);
    const next = lineAt(settings, s);
    const h = old !== next ? addHistory(db, c, { key: profileKey(n), field: 'rule ' + s, old, next, why: newer ? 'ruling ' + newer.label : op }) : null;
    logRow(db, c, { verb: before ? 'profile-edit' : 'profile-define', kind: 'profile', front: { id: n, name: n, key: profileKey(n) },
      changes: { rule: op, slug: s, ...(h ? { line: 'changed', history: historyRef([h]) } : {}) } });
    if (gone) dropProfile(db, data, n, c);
    return { profile: n, op, slug: s, settings, ...(gone ? { dropped: true } : {}), ...(h ? { history: h } : {}) };
  });
}

/* the profile a board with none held on default gets (the editor's save makes the same) */
const HOME = 'personal';

/* A new profile's name for a record: settings-ws-11, settings-tr-20, settings-<repo or folder>. */
function settingsName(rec, repo) {
  const base = rec.level === 'project' ? String(repo || rec.key).replace(/[/]+$/, '').split('/').pop() : rec.key;
  const slug = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31).replace(/-+$/, '');
  return 'settings-' + (slug || 'project');
}

/* one setting into a profile, in one transaction. With `at`, into the
   profile held there that sets it, else the one held there, else a new one named
   for the record; with neither `at` nor `profile`, into the profile that sets it
   now for `record`, or the user's own default profile when it is built in. The
   contract family is set at default only, where it is read. */
export function settingsSet(db, { key, value, at, record, profile, project, repo, repos } = {}, actor) {
  const k = String(key ?? '').trim();
  if (Object.hasOwn(PC_SETTINGS, k)) throw new UsageError(k + " lives in each PC's config.json, never on the board");
  if (Object.hasOwn(SETTINGS, k) && SETTINGS[k].list) throw new UsageError(k + ' is set with profile rule-add, rule-drop and rule-clear');
  const v = checkSetting(k, value);
  const contract = SETTINGS[k].contract === true;
  if (at !== undefined && at !== null && at !== '' && !LEVELS.includes(at)) throw new UsageError('--at takes ' + LEVELS.join(', ') + ': ' + at);
  if (contract && at && at !== 'default') throw new UsageError(k + ' is set at default only: the contract is read from the profiles held on default');
  return tx(db, () => {
    const data = loadProfiles(db);
    let name = profile ? checkName(profile) : null;
    let target = null;
    let forRecord = false;
    if (at) {
      const word = at === 'default' ? 'default' : record;
      if (!word) throw new UsageError('--at ' + at + ' needs the record: ' + (at === 'project' ? 'a project directory' : 'its id'));
      const rec = recordWord(db, word, repo, repos);
      if (rec.level !== at) throw new UsageError(word + ' is ' + (rec.level === 'default' ? 'default' : 'a ' + rec.level) + ', not a ' + at);
      const h = holdingFor(db, data, rec);
      const own = h.sub.add.filter((n) => data.profiles[n]);
      if (!name) name = own.find((n) => settingsOf(data.profiles[n])[k] !== undefined) || (own.length === 1 ? own[0] : null);
      if (!name && own.length > 1) throw new UsageError('refused: ' + h.shown + ' holds ' + own.join(', ') + ' and none of them sets ' + k + '; --profile picks one');
      if (!name && at !== 'default') forRecord = true;
      if (!name) name = at === 'default' ? contractHome(data).profile || HOME : settingsName(rec, h.repo || rec.repo);
      target = { word: rec.level === 'default' ? 'default' : rec.key, repo: rec.repo, holds: h.sub.add.includes(name) && !h.sub.drop.includes(name) };
    } else if (name) {
      if (!data.profiles[name]) throw new UsageError('no profile named ' + name + '; --at names where a new one goes');
    } else {
      const now = contract ? (contractHeld(data)[k] || {}).profile
        : resolveChain(data, chainOver(lookupFor(db), recordWord(db, record || 'default', repo, repos), { project, repo, repos })).settings[k].profile;
      if (now) name = now;
      else {
        name = contractHome(data).profile || HOME;
        const def = data.subscriptions.default || noSub();
        target = { word: 'default', holds: def.add.includes(name) };
      }
    }
    if (BUILTIN[name]) throw new UsageError(k + ' comes from ' + name + ', which is built in; --at names where the value goes');
    /* the pair check names the key set, so the refusal reads from its side */
    checkPairs({ ...settingsOf(data.profiles[name]), [k]: v }, k);
    const created = !data.profiles[name];
    profileDefine(db, { name, set: [k + '=' + wordsOf(k, v)], ...(created && forRecord ? { made: 'settings' } : {}) }, actor);
    const added = target && !target.holds ? profileAdd(db, { record: target.word, name, repo: target.repo, repos }, actor).added : false;
    const reaches = holdings(db, loadProfiles(db)).filter((h) => h.sub.add.includes(name))
      .map((h) => ({ record: h.shown, level: h.level, note: travelText(h) }));
    return { key: k, value: v, profile: name, created, added, reaches };
  });
}

/* take one setting off the layer that sets it: with `at`, the profile held
   there that sets it; with none, the profile that sets it now for `record`. The
   contract family lives whole on the default profile, so there it goes back to the
   built-in value. Returns what applies to the record after it. */
export function settingsUnset(db, { key, at, record, project, repo, repos } = {}, actor) {
  const k = String(key ?? '').trim();
  if (Object.hasOwn(PC_SETTINGS, k)) throw new UsageError(k + " lives in each PC's config.json, never on the board");
  if (!Object.hasOwn(SETTINGS, k)) throw new UsageError('unknown setting ' + k + ' (one of ' + Object.keys(SETTINGS).join(', ') + ')');
  const spec = SETTINGS[k];
  if (spec.list) throw new UsageError(spec.label + ' are set with profile rule-add, rule-drop and rule-clear (' + k + ')');
  if (at !== undefined && at !== null && at !== '' && !LEVELS.includes(at)) throw new UsageError('--at takes ' + LEVELS.join(', ') + ': ' + at);
  if (spec.contract) {
    if (at && at !== 'default') throw new UsageError(k + ' is set at default only: the contract is read from the profiles held on default');
    if (!contractHeld(loadProfiles(db))[k]) return { key: k, value: spec.def, removed: false, now: { value: spec.def, layer: 'built-in', record: null, profile: null } };
    const r = settingsSet(db, { key: k, value: spec.def, at: 'default' }, actor);
    return { key: k, value: r.value, profile: r.profile, removed: true, from: 'default', now: { value: r.value, layer: 'default', record: 'default', profile: r.profile } };
  }
  const word = at ? (at === 'default' ? 'default' : record) : record || 'default';
  if (!word) throw new UsageError('--at ' + at + ' needs the record: ' + (at === 'project' ? 'a project directory' : 'its id'));
  return tx(db, () => {
    const data = loadProfiles(db);
    const rec = recordWord(db, word, repo, repos);
    const chainOf = () => chainOver(lookupFor(db), rec, { project: at ? undefined : project, repo, repos });
    let name;
    let where;
    if (at) {
      if (rec.level !== at) throw new UsageError(word + ' is ' + (rec.level === 'default' ? 'default' : 'a ' + rec.level) + ', not a ' + at);
      const h = holdingFor(db, data, rec);
      name = h.sub.add.filter((n) => !h.sub.drop.includes(n)).find((n) => settingsOf(profileOf(data, n))[k] !== undefined);
      if (!name) throw new UsageError('Nothing to remove: no profile held on ' + h.shown + ' sets ' + spec.label.toLowerCase() + ' (' + k + ')');
      where = h.shown;
    } else {
      const s = resolveChain(data, chainOf()).settings[k];
      if (!s.profile) throw new UsageError(spec.label + ' is built in here, so there is nothing to remove (' + k + ')');
      name = s.profile;
      where = s.record;
    }
    if (BUILTIN[name]) throw new UsageError(spec.label + ' comes from ' + name + ', which is built in; profile remove takes it off ' + where + ' (' + k + ')');
    const before = data.profiles[name];
    const next = { ...settingsOf(before) };
    delete next[k];
    const c = actorOf(actor);
    /* a profile settings set made, left empty, comes off every record and goes; one the user made stays */
    const gone = !Object.keys(next).length && before.made === 'settings';
    if (gone) dropProfile(db, data, name, c);
    else {
      saveProfile(db, name, { ...before, settings: next, updated: c.at });
      logRow(db, c, { verb: 'profile-edit', kind: 'profile', front: { id: name, name, key: profileKey(name) }, changes: { unset: k } });
    }
    const s = resolveChain(loadProfiles(db), chainOf()).settings[k];
    return { key: k, profile: name, removed: true, from: where, ...(gone ? { dropped: true } : {}), now: { value: s.value, layer: s.level, record: s.record, profile: s.profile } };
  });
}

/* a rule line from the settings surfaces. Add and drop go on the home profile and
   hold it on default in the same write, so the line reaches every session; clear takes
   the line off the profile named, the home one when none. */
export function settingsRule(db, { op, slug, text, for: aud, profile } = {}, actor) {
  if (!['add', 'drop', 'clear'].includes(op)) throw new UsageError('settings rule takes add, drop or clear');
  return tx(db, () => {
    const home = contractHome(loadProfiles(db)).profile || HOME;
    const name = op === 'clear' && profile ? profile : home;
    const r = profileRule(db, { name, op, slug, text, for: aud }, actor);
    const added = op === 'clear' ? false : profileAdd(db, { record: 'default', name }, actor).added;
    return { ...r, added };
  });
}

/* Off every holding (held or dropped there), then the profile itself, inside the caller's transaction. */
function dropProfile(db, data, name, c) {
  let subs = false;
  for (const h of holdings(db, data)) {
    if (!h.sub.add.includes(name) && !h.sub.drop.includes(name)) continue;
    const next = { add: h.sub.add.filter((x) => x !== name), drop: h.sub.drop.filter((x) => x !== name) };
    if (h.travels === 'record') {
      const row = recordByKey(db, h.key);
      saveRecord(db, row, { ...row.fields, profiles: next.add, profileDrops: next.drop, updated: c.at });
    } else { data.subscriptions[h.key] = { ...data.subscriptions[h.key], ...next }; subs = true; }
  }
  if (subs) saveSubscriptions(db, data.subscriptions);
  db.stmt('DELETE FROM records WHERE key = ?').run(profileKey(name));
  logRow(db, c, { verb: 'delete', kind: 'profile', front: { id: name, name, key: profileKey(name) }, changes: { emptied: true } });
}

/* The /askerdo guard shortcut on a project: guard-on or guard-off on it, swapped
   as needed, and nothing left on it when the inherited state already says so. */
export function profileGuard(db, { project, repo, want } = {}, actor) {
  if (want !== 'on' && want !== 'off') throw new UsageError('profile guard takes on or off');
  const dir = normProjectDir(project);
  const mine = want === 'on' ? 'guard-on' : 'guard-off';
  const other = want === 'on' ? 'guard-off' : 'guard-on';
  return tx(db, () => {
    const held = () => projectSub(loadProfiles(db), dir, repo);
    const steps = [];
    if (held().add.includes(other)) { profileRemove(db, { record: dir, name: other, repo }, actor); steps.push('removed ' + other); }
    const now = effective(db, { record: dir, repo });
    if (now.settings['agent.on'].value !== (want === 'on') && !held().add.includes(mine)) {
      if (profileAdd(db, { record: dir, name: mine, repo }, actor).added) steps.push('added ' + mine);
    }
    return { record: projectKeys(loadProfiles(db), dir, repo).shown, guard: want, steps, effective: effective(db, { record: dir, repo }) };
  });
}
