/* a record someone may act on keeps its old text in history, and a read by a
   session other than its writer is logged in reads (never the feed), so the board knows
   when it is used: from then on it changes only by an amend or a supersede. */
import { tx, readTx } from '../db.mjs';
import { actorOf, getMeta, labelOf, sessionWords } from '../records.mjs';
import { READS_SINCE } from '../render.mjs';
import { UsageError, loadEntry, resolveRecord } from './labels.mjs';
import { profileKey } from '../import.mjs';

export const READ_SITES = Object.freeze(['kickoff', 'show', 'toast', 'brief']);

/* One history row; the activity line carries its id, so the stream's cap never hides a change. */
export function addHistory(db, ctx, { key, field, old, next, why }) {
  const r = db.stmt('INSERT INTO history (record, at, actor, field, old, new, why) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(key, ctx.at, ctx.by, field, old ?? null, next ?? null, why ?? null);
  return Number(r.lastInsertRowid);
}

export const historyRef = (ids) => ids.map((n) => '#' + n).join(', ');

/* A bare day is local midnight, as decisions.mjs reads one. */
export function timeOf(s) {
  const t = String(s ?? '').trim();
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (d) return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3])).getTime();
  const n = Date.parse(t);
  return Number.isFinite(n) ? n : null;
}

/* The session that wrote a record: the one it names, else its create row's. */
export function writerOf(db, key, front = {}) {
  const named = (front.source && typeof front.source.session === 'string' && front.source.session)
    || (typeof front.session === 'string' && front.session) || null;
  if (named) return named;
  const row = db.stmt("SELECT actor FROM activity WHERE record = ? AND verb = 'create' ORDER BY seq LIMIT 1").get(key);
  const m = row && /^session:(.+)$/.exec(String(row.actor || ''));
  return m ? m[1] : null;
}

/* The first read per record and session counts; the writer's own reads mark nothing. */
export function noteRead(db, e, session, site, at) {
  const s = typeof session === 'string' ? session.trim() : '';
  if (!s || !e || !e.key) return false;
  if (writerOf(db, e.key, e.front || e.fields) === s) return false;
  return db.stmt('INSERT OR IGNORE INTO reads (record, session, site, at) VALUES (?, ?, ?, ?)').run(e.key, s, site, at).changes > 0;
}

/* Why a record counts as used, else null: made before reads were logged, read
   by another session, or another record links to it, cites it or refers to it. */
export function usedBy(db, e) {
  const since = getMeta(db, READS_SINCE);
  if (since) {
    const made = timeOf(e.front.created);
    if (made === null || made <= Date.parse(since)) return 'it was made before the board logged reads';
  }
  const r = db.stmt('SELECT session, site FROM reads WHERE record = ? LIMIT 1').get(e.key);
  if (r) return sessionWords(db, r.session) + ' read it (' + r.site + ')';
  const label = e.label || e.key;
  const l = db.stmt('SELECT "from", type FROM links WHERE "to" IN (?, ?) LIMIT 1').get(e.key, label);
  if (l) return labelOf(db, l.from) + ' ' + l.type + ' it';
  const ref = db.stmt(`SELECT r.label FROM records r, json_each(r.fields, '$.refs') j
    WHERE j.value IN (?, ?) AND r.key <> ? LIMIT 1`).get(e.key, label, e.key);
  if (ref) return (ref.label || 'another record') + ' refers to it';
  return null;
}

/* The two-line refusal a used record's in-place change gets. */
export const inUseRefusal = (id, why) => id + ' is in use (' + why + '): amend it (knowledge amend ' + id + ' --body "...") or supersede it (knowledge supersede ' + id + ').'
  + '\nAn override is only for text a bug wrote, a ruling never made, or a secret: override request ' + id
  + ' --kind fix|withdraw|scrub --reason "..." --summary "..." --session <own-id>.';

/* read(db, { ids, site, session }): the mod's reads, the decision-applies toast
   and an agent brief. Ids the board does not know are skipped, never refused. */
export function markRead(db, input = {}, actor) {
  const ctx = actorOf(actor);
  const site = String(input.site ?? '').trim();
  if (!READ_SITES.includes(site)) throw new UsageError('read takes --site ' + READ_SITES.join(', '));
  const session = (typeof input.session === 'string' && input.session.trim()) || ctx.session;
  if (!session) throw new UsageError('read needs --session <own-id>: the session that read them');
  const ids = (Array.isArray(input.ids) ? input.ids : [input.ids ?? input.id]).map((x) => String(x ?? '').trim()).filter(Boolean);
  if (!ids.length) throw new UsageError('read needs the record ids it read');
  return tx(db, () => {
    const marked = [];
    const skipped = [];
    for (const id of ids) {
      const e = resolveRecord(db, id, { day: ctx.day });
      if (!e || e.kind === 'handoff') { skipped.push(id); continue; }
      if (noteRead(db, e, session, site, ctx.at)) marked.push(e.label || e.key);
    }
    return { session, site, marked, skipped };
  });
}

/* recordHistory(db, { id }): a record's text changes, oldest first; a profile by its name. */
export function recordHistory(db, input = {}) {
  const raw = String((input && typeof input === 'object' ? input.id : input) ?? '').trim();
  return readTx(db, () => {
    const e = resolveRecord(db, raw) || (raw ? loadEntry(db, profileKey(raw)) : null);
    if (!e || e.kind === 'handoff') throw new UsageError('unknown record id: ' + raw);
    const rows = db.stmt('SELECT id, at, actor, field, old, new, why FROM history WHERE record = ? ORDER BY id').all(e.key)
      .map((r) => ({ id: r.id, at: r.at, by: r.actor, field: r.field, old: r.old, new: r.new, ...(r.why ? { why: r.why } : {}) }));
    return { id: e.label || (e.kind === 'profile' ? e.front.name : e.key), key: e.key, kind: e.kind, rows };
  });
}
