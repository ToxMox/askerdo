/* what an import's cut leaves is deleted, not kept under an ended status.
   A dry run counts by kind; the delete runs only on yes, and its text leaves the file as a scrub's does. */
import { readTx, tx } from '../db.mjs';
import { actorOf, addDays, logVerb, putRecord } from '../records.mjs';
import { ARCHIVE_DAYS, UsageError, archiveDay, entryOf, loadEntry, resolveRecord } from './labels.mjs';
import { wipe } from './override.mjs';

const KINDS = ['knowledge', 'task', 'track', 'question', 'workstream'];
const LABEL = /^import:\S+$/;
const LINKS = ['gates', 'cites', 'revisits'];
const ROW = 'SELECT key, kind, slug, fields, body, layout, track, version FROM records';

const listOf = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v])
  .flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean);
const kindWord = (e) => (e.kind === 'knowledge' && e.front.type === 'decision' ? 'decision' : e.kind);
const onboardRefs = (e) => (e.front.refs || []).map(String).filter((r) => r.startsWith('onboard:'));
const isTheImports = (e, label) => KINDS.includes(e.kind) && (e.front.labels || []).includes(label) && onboardRefs(e).length > 0;
const ofItem = (e, items) => onboardRefs(e).some((r) => items.some((i) => r === 'onboard:' + i || r.startsWith('onboard:' + i + '@')));

/* What stops a record going: a ruling or fact the user has not withdrawn (a purge by ruling has the
   user's cut instead), work someone holds, or a line or workstream holding a record outside the purge. */
function heldWhy(db, e, keys, byRuling) {
  if (e.kind === 'knowledge' && !byRuling && e.front.status !== 'withdrawn') return 'is ' + e.front.status + ': only the user\'s Withdraw press takes it away';
  if (e.kind === 'task' && db.stmt('SELECT 1 FROM run_tasks rt JOIN runs r ON r.id = rt.run AND r.ended IS NULL WHERE rt.task = ?').get(e.key)) return 'has a run open on it';
  if (e.kind === 'track') {
    if (db.stmt('SELECT 1 FROM leases WHERE track = ?').get(e.key)) return 'is held by a session';
    const on = db.stmt('SELECT task FROM track_items WHERE track = ?').all(e.key).map((r) => r.task)
      .concat(db.stmt("SELECT key FROM records WHERE track = ? OR json_extract(fields, '$.track') = ?").all(e.key, e.key).map((r) => r.key));
    if (on.some((k) => !keys.has(k))) return 'holds a record outside this purge';
  }
  if (e.kind === 'workstream') {
    const inIt = db.stmt(`SELECT key FROM records WHERE key <> ?1 AND (workstream = ?1
      OR EXISTS (SELECT 1 FROM json_each(fields, '$.workstreams') WHERE value = ?1))`).all(e.key).map((r) => r.key);
    if (inIt.some((k) => !keys.has(k))) return 'holds a record outside this purge';
  }
  return null;
}

/* The user's cut a purge by ruling rests on: an answered question, or a confirmed decision in force. */
function rulingOf(db, token, day) {
  const e = resolveRecord(db, token, { kinds: ['knowledge', 'question'], day });
  if (!e) throw new UsageError('--ruling names an answered Q-n or a confirmed decision K-n: ' + token);
  if (e.kind === 'question' && e.front.status !== 'answered') throw new UsageError(e.label + ' is ' + e.front.status + ', not a ruling yet');
  if (e.kind === 'knowledge' && (e.front.type !== 'decision' || e.front.status !== 'active' || e.front.confirmed !== true)) {
    throw new UsageError(e.label + ' is not a confirmed decision in force: --ruling names an answered Q-n or a confirmed decision K-n');
  }
  return e;
}

function planOf(db, o, day) {
  const ids = listOf(o.ids);
  const items = listOf(o.items);
  const token = String(o.ruling ?? '').trim();
  const ruling = token ? rulingOf(db, token, day) : null;
  const named = String(o.label ?? '').trim();
  if (ruling && (!ids.length || items.length || named)) throw new UsageError('a purge by --ruling names its records with --id only, and no import label');
  const label = ruling ? null : named.replace(/^(?!import:)/, 'import:');
  if (!ruling && !LABEL.test(label)) throw new UsageError('purge names the import by its label, import:<slug>, or the ruling that cut the records (--ruling with --id)');
  const gone = [];
  const foreign = [];
  let picked;
  if (ruling) {
    picked = [];
    for (const id of ids) {
      const e = resolveRecord(db, id, { day });
      if (!e) gone.push(id);
      else if (e.kind !== 'knowledge') foreign.push({ id: e.label || id, kind: e.kind, why: 'is not a decision or knowledge record, the only kinds a purge by ruling takes' });
      else if (e.key === ruling.key) foreign.push({ id: e.label || id, kind: kindWord(e), why: 'is the ruling this purge rests on' });
      else picked.push(e);
    }
  } else if (ids.length) {
    picked = [];
    for (const id of ids) {
      const e = resolveRecord(db, id, { day });
      if (!e) gone.push(id);
      else if (e.kind === 'handoff' || !isTheImports(e, label)) foreign.push({ id: e.label || id, kind: e.kind, why: 'is not a record of ' + label });
      else picked.push(e);
    }
  } else {
    picked = db.stmt(ROW + ` WHERE kind IN (${KINDS.map(() => '?').join(', ')}) AND EXISTS (SELECT 1 FROM json_each(fields, '$.labels') WHERE value = ?)`)
      .all(...KINDS, label).map(entryOf).filter((e) => isTheImports(e, label));
  }
  if (items.length) picked = picked.filter((e) => ofItem(e, items));
  const uniq = [...new Map(picked.map((e) => [e.key, e])).values()];
  /* a hold can free nothing else, so one pass against the whole set, then again without what it held */
  let keys = new Set(uniq.map((e) => e.key));
  let held = [];
  for (;;) {
    const now = uniq.filter((e) => keys.has(e.key)).map((e) => ({ e, why: heldWhy(db, e, keys, Boolean(ruling)) })).filter((x) => x.why);
    if (!now.length) break;
    held = held.concat(now);
    for (const x of now) keys.delete(x.e.key);
  }
  const going = uniq.filter((e) => keys.has(e.key));
  const counts = {};
  for (const e of going) counts[kindWord(e)] = (counts[kindWord(e)] || 0) + 1;
  const handoffs = going.filter((e) => e.kind === 'track').reduce((n, e) => n + db.stmt('SELECT count(*) AS n FROM handoffs WHERE track = ?1 OR thread = ?1').get(e.key).n, 0);
  return {
    label, ruling: ruling ? ruling.label || ruling.key : null, going, counts, handoffs,
    held: [...foreign, ...held.map((x) => ({ id: x.e.label || x.e.key, kind: kindWord(x.e), why: x.why }))], gone,
  };
}

/* The record's rows everywhere it has them. Its label keeps a row that rests it as an ended record's
   would (its archive day, then REST_DAYS in pickLabel), so no new record takes it while a citation is fresh. */
function deleteRecord(db, e, day) {
  const k = e.key;
  const hand = db.stmt('SELECT key FROM handoffs WHERE track = ?1 OR thread = ?1').all(k).map((r) => r.key);
  for (const h of hand) db.stmt('DELETE FROM activity WHERE record = ?').run(h);
  db.stmt('DELETE FROM handoffs WHERE track = ?1 OR thread = ?1').run(k);
  const rest = archiveDay(e.kind, e.front) || addDays(day, ARCHIVE_DAYS);
  db.stmt(`UPDATE labels SET "to" = ? WHERE key = ? AND origin = 'history' AND "to" IS NULL`).run(rest, k);
  const runs = db.stmt('SELECT run FROM run_tasks WHERE task = ?').all(k).map((r) => r.run);
  for (const t of ['notes', 'history', 'reads', 'seals', 'override_items']) db.stmt(`DELETE FROM ${t} WHERE record = ?`).run(k);
  db.stmt('DELETE FROM activity WHERE record = ?').run(k);
  db.stmt('DELETE FROM covers WHERE review = ?1 OR task = ?1').run(k);
  db.stmt('DELETE FROM commits WHERE task = ?').run(k);
  /* the rows from it cascade; a gate or cite from a record outside the purge leaves that record's
     fields too, else the gate holds and the next save writes the link back */
  const names = [k, ...db.stmt('SELECT label FROM labels WHERE key = ?').all(k).map((r) => r.label)];
  const from = db.stmt(`SELECT DISTINCT "from" AS f FROM links WHERE "to" IN (SELECT value FROM json_each(?)) AND "from" <> ?`).all(JSON.stringify(names), k);
  for (const { f } of from) {
    const o = loadEntry(db, f);
    if (!o) continue;
    const lists = LINKS.filter((t) => Array.isArray(o.fields[t]) && o.fields[t].some((x) => names.includes(String(x))));
    for (const t of lists) o.fields[t] = o.fields[t].filter((x) => !names.includes(String(x)));
    if (lists.length) putRecord(db, o);
  }
  db.stmt('DELETE FROM links WHERE "to" = ?').run(k);
  db.stmt('DELETE FROM records WHERE key = ?').run(k);
  for (const r of runs) if (!db.stmt('SELECT 1 FROM run_tasks WHERE run = ?').get(r)) db.stmt('DELETE FROM runs WHERE id = ?').run(r);
}

/* importPurge { label, ids?, items?, ruling?, yes? }: the records an import wrote (its import:<slug> label and an
   onboard: ref), or those named by id or onboard item; with ruling, the knowledge records named by id that the
   user's ruling cut, whatever wrote them. Without yes it counts and writes nothing. */
export function importPurge(db, input = {}, actor, opts) {
  const ctx = actorOf(actor, opts);
  const o = input && typeof input === 'object' && !Array.isArray(input) ? input : { label: input };
  const shown = (p) => ({ label: p.label, ...(p.ruling ? { ruling: p.ruling } : {}), counts: p.counts, handoffs: p.handoffs, records: p.going.map((e) => e.label || e.key), held: p.held, gone: p.gone });
  if (o.yes !== true) return readTx(db, () => ({ ...shown(planOf(db, o, ctx.day)), dryRun: true }));
  const out = tx(db, () => {
    const p = planOf(db, o, ctx.day);
    for (const e of p.going) deleteRecord(db, e, ctx.day);
    db.stmt('DELETE FROM overrides WHERE NOT EXISTS (SELECT 1 FROM override_items WHERE request = overrides.id)').run();
    if (p.going.length) {
      const by = p.ruling || p.label;
      logVerb(db, { ts: ctx.at, verb: 'delete', kind: p.ruling ? 'ruling' : 'import', id: by, name: by, by: ctx.by, pc: ctx.pc,
        changes: Object.fromEntries(Object.entries(p.counts).map(([k, n]) => [k, [n, 0]])),
        note: 'purged: the records ' + by + (p.ruling ? ' cut' : ' wrote') + ', deleted on the user\'s yes' });
    }
    return { ...shown(p), purged: true };
  });
  if (out.records.length) wipe(db);
  return out;
}
