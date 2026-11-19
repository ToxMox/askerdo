/* Procedure cards and their runs over SQLite (from
   lib/procedures.mjs). A card is a `procedure` record (PR-n); its steps file
   lives in a repo on a PC, so the PC reads and judges it (parseProcedure, judge,
   lint and git stay in lib/procedures.mjs) and hands the result in here. */
import { tx } from '../db.mjs';
import { actorOf, addNote, changesOf, guardHeadings, kebab, labelOf, logRow, mintKey, orderFields, putRecord } from '../records.mjs';
import { UsageError, endingStamps, loadEntry as recordByKey, lookupFor, pickLabel, resolveRecord } from './labels.mjs';
import { placeOf } from './found.mjs';
import {
  PROC_DIR, SCRIPT_AFTER, cardForFile, cardView, cardsOfProject, fileTriggerText, findCardIn, foreign, isAbsolute,
  normPath, ofRepo, sameDir,
} from './proc-cards.mjs';

export { UsageError };

const KIND = 'procedure';
const RECORD_LABEL = /^(?:Q\d+|(?:WS|PR|P|T|TH|TR|K)-\d+)$/;

function cardRows(db) {
  return db.stmt("SELECT key FROM records WHERE kind = 'procedure' ORDER BY id").all().map((r) => recordByKey(db, r.key));
}

/* A card's body above its Journal: the summary as its Description. */
const descBody = (summary) => '\n## Description\n\n' + guardHeadings(summary) + '\n\n';

/* the old store's refsFor: a ref naming a record is stored as its key, anything else as written */
function refsFor(db, list) {
  const lookup = lookupFor(db);
  return (list || []).map((v) => {
    const s = String(v).trim();
    if (!RECORD_LABEL.test(s.toUpperCase())) return v;
    const r = lookup(s);
    return r ? r.key : v;
  });
}

/* Every field a scan owns, from the parsed file. The card carries its
   project's shared name only (a folder with no remote is named by its path). */
function scanned(project, repo, proc) {
  return {
    name: proc.title, slug: proc.slug, project: undefined, projectRepo: repo,
    doc: PROC_DIR + '/' + proc.slug + '.md',
    summary: proc.summary, words: proc.triggers.words, commands: proc.triggers.commands,
    files: proc.triggers.files.map(fileTriggerText), repos: { ...proc.repos },
    paths: proc.refs.filter((r) => r.kind === 'path').map((r) => r.target), live: proc.live || undefined,
    record: proc.record === 'command' ? 'command' : undefined,
  };
}
const recordRefs = (proc) => proc.refs.filter((r) => r.kind !== 'path').map((r) => r.target);
/* one card per name for every project, owned by none, so no project's scan retires it */
const everywhereCard = (proc, version) => ({ ...scanned('', undefined, proc), everywhere: true, ...(version ? { pluginVersion: version } : {}) });
/* a dotted version compare; a scan with none reads as the oldest */
const vparts = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
const atLeast = (a, b) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return true; };

/* a conversion's handover (`by`, its last commit) records a card's verified commit (`at`: its own last commit,
   or for a card it edited that read stale, the base the card had before); `vouched.was` keeps what the card held
   before the import's first such record, so the undo gives it back and a second handover run keeps it */
function vouchOn(front, { at, by }) {
  const v = front.verified || {};
  const was = front.vouched && v.self === front.vouched.head ? front.vouched.was : v.self;
  front.verified = { ...v, self: at };
  front.vouched = { head: at, ...(by && by !== at ? { by } : {}), ...(was ? { was } : {}) };
  return at === by ? 'verified at ' + at.slice(0, 7) + ' by the conversion handover, which wrote this card or found it current before its first commit'
    : 'verified commit kept at ' + at.slice(0, 7) + ', its base before the conversion handover edited it, so the edit is no run';
}
function unvouchOn(front, by) {
  const h = front.vouched;
  if (!h || (h.by || h.head) !== by) return '';
  const v = { ...(front.verified || {}) };
  if (v.self === h.head) { if (h.was) v.self = h.was; else delete v.self; }
  front.verified = v;
  delete front.vouched;
  return 'the verified commit ' + h.head.slice(0, 7) + ' the conversion handover recorded is withdrawn with the import';
}
const both = (...notes) => notes.filter(Boolean).join('. ') || undefined;

/* One card's update inside the transaction, with its journal note and activity row; a note
   may be a function, read after the update, when the update says what it did. */
function updateCard(db, row, apply, ctx, said) {
  const before = JSON.parse(JSON.stringify(row.fields));
  const front = JSON.parse(JSON.stringify(row.fields));
  apply(front);
  const note = typeof said === 'function' ? said() : said;
  /* stamps or clears closed; a card back after its archive day takes a fresh label */
  endingStamps(db, KIND, front, before, ctx);
  const changes = changesOf(before, front);
  if (!Object.keys(changes).length && !note) return null;
  front.updated = ctx.at;
  putRecord(db, {
    key: row.key, kind: KIND, slug: row.slug, fields: orderFields(KIND, front), body: descBody(front.summary || front.name),
    layout: row.layout, track: row.track,
  });
  if (note) addNote(db, row.key, { at: ctx.at, actor: ctx.by, body: guardHeadings(note) });
  logRow(db, ctx, { verb: 'edit', kind: KIND, front, changes, note });
  return front;
}

/* `proc scan` (the board half): the PC read the project's docs/procedures and
   hands in, per file, { name, proc } with its stale and warnings lists or
   { name, errors }; plus the main checkout (`project`), its shared name, every
   checkout of it on that PC (`homes`) and HEAD. Cards are made, followed and
   retired here; nothing is written when nothing moved. `everywhere`, when the PC
   could read the plugin's own folder, is every card it holds for all projects. */
export function scanProject(db, { project: dir, repo = '', homes, head = '', files = [], everywhere, pluginVersion, unvouch = '' } = {}, actor) {
  const project = normPath(dir);
  if (!isAbsolute(project)) throw new UsageError('a scan needs the project\'s absolute main checkout: ' + dir);
  repo = repo || project.toLowerCase();
  const home = (Array.isArray(homes) && homes.length ? homes : [project]).map(normPath);
  const out = { project, created: [], updated: [], retired: [], unchanged: [], unparseable: [], warnings: [] };
  for (const f of files) {
    if (f.errors) out.unparseable.push({ file: PROC_DIR + '/' + f.name, errors: f.errors });
    if (f.warnings && f.warnings.length) out.warnings.push({ file: PROC_DIR + '/' + f.name, warnings: f.warnings });
  }
  const ewFiles = Array.isArray(everywhere) ? everywhere.filter((f) => f && f.proc) : null;
  if (ewFiles) out.everywhere = { created: [], updated: [], retired: [], unchanged: [] };
  return tx(db, () => {
    const rows = cardRows(db);
    const byFront = new Map(rows.map((r) => [r.fields, r]));
    const cards = cardsOfProject(rows.map((r) => r.fields), { project, repo, homes: home });
    const pairs = files.map((f) => ({ f, card: cardForFile(cards, f.proc && f.proc.slug, f.name) }));
    const used = new Set(pairs.map((p) => p.card).filter(Boolean));
    const gone = cards.filter((c) => c.status !== 'retired' && !used.has(c));
    const ewCards = rows.map((r) => r.fields).filter((c) => c.everywhere);
    /* only a plugin as new as the card's last scan moves it, so two PCs on different versions never flip it */
    const ewMine = (c) => atLeast(pluginVersion, c.pluginVersion);
    const ewAll = (ewFiles || []).map((f) => ({ f, card: cardForFile(ewCards, f.proc.slug, f.name) }));
    const ewPairs = ewAll.filter((p) => !p.card || ewMine(p.card));
    const ewUsed = new Set(ewAll.map((p) => p.card).filter(Boolean));
    const ewGone = ewFiles ? ewCards.filter((c) => c.status !== 'retired' && !ewUsed.has(c) && ewMine(c)) : [];
    if (!files.length && !gone.length && !ewPairs.length && !ewGone.length) return out;
    const ctx = actorOf(actor);
    const make = (proc, fields, note) => {
      const key = mintKey(db);
      const id = pickLabel(db, KIND, ctx.day);
      const front = orderFields(KIND, {
        id, key, ...fields, status: 'active', stale: fields.stale || [],
        refs: refsFor(db, recordRefs(proc)), runs: 0, cleanRuns: 0, created: ctx.at, updated: ctx.at, labelHistory: [id + ' ' + ctx.day],
      });
      putRecord(db, { key, kind: KIND, slug: kebab(front.name, KIND), fields: front, body: descBody(front.summary) });
      addNote(db, key, { at: ctx.at, actor: ctx.by, body: guardHeadings(note) });
      logRow(db, ctx, { verb: 'create', kind: KIND, front, changes: changesOf({}, front) });
      return id;
    };
    for (const { f } of pairs.filter((p) => p.f.proc && !p.card)) {
      const fields = { ...scanned(project, repo, f.proc), stale: f.stale || [] };
      const said = f.vouch ? vouchOn(fields, f.vouch) : '';
      out.created.push(make(f.proc, fields, both('card made from ' + PROC_DIR + '/' + f.proc.slug + '.md' + (head ? ' at ' + String(head).slice(0, 7) : ''), said)));
    }
    for (const { f, card } of pairs) {
      if (!card) continue;
      const back = card.status === 'retired';
      let said = '';
      const r = updateCard(db, byFront.get(card), (front) => {
        if (f.proc) {
          Object.assign(front, scanned(project, repo, f.proc));
          front.stale = f.stale || [];
          front.refs = refsFor(db, recordRefs(f.proc));
        } else front.stale = ['the file does not parse: ' + f.errors[0]];
        if (back) front.status = 'active';
        said = both(unvouch && unvouchOn(front, unvouch), f.proc && f.vouch && vouchOn(front, f.vouch)) || '';
      }, ctx, () => both(back && 'the file is back: ' + card.doc, said));
      (r ? out.updated : out.unchanged).push(r ? r.id : card.id);
    }
    for (const c of gone) {
      const why = !c.project || sameDir(c.project, project) || foreign(c, repo, home) ? c.doc + ' is gone from ' + project
        : 'the cards of ' + normPath(c.project) + ' are the main checkout\'s, ' + project;
      let said = '';
      updateCard(db, byFront.get(c), (front) => { front.status = 'retired'; said = unvouch ? unvouchOn(front, unvouch) : ''; }, ctx, () => both('retired: ' + why, said));
      out.retired.push(c.id);
    }
    /* the everywhere cards follow the plugin's folder, never this project's */
    for (const { f } of ewPairs.filter((p) => !p.card)) {
      out.everywhere.created.push(make(f.proc, everywhereCard(f.proc, pluginVersion), 'card for every project made from the AskerDo plugin\'s ' + PROC_DIR + '/' + f.proc.slug + '.md'));
    }
    for (const { f, card } of ewPairs) {
      if (!card) continue;
      const back = card.status === 'retired';
      const r = updateCard(db, byFront.get(card), (front) => {
        Object.assign(front, everywhereCard(f.proc, pluginVersion));
        front.stale = [];
        front.refs = refsFor(db, recordRefs(f.proc));
        if (back) front.status = 'active';
      }, ctx, back ? 'the file is back in the AskerDo plugin: ' + card.doc : undefined);
      (r ? out.everywhere.updated : out.everywhere.unchanged).push(r ? r.id : card.id);
    }
    for (const c of ewGone) {
      updateCard(db, byFront.get(c), (front) => { front.status = 'retired'; if (pluginVersion) front.pluginVersion = pluginVersion; }, ctx, 'retired: ' + c.doc + ' is gone from the AskerDo plugin');
      out.everywhere.retired.push(c.id);
    }
    return out;
  });
}

/* a run report rides the note, so the flag carries only its
   first sentence, which names the step that differed; the journal keeps the note. */
function leadOf(note) {
  const line = String(note || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
  const one = (/^.+?[.!?](?=\s|$)/.exec(line) || [line])[0].replace(/[.!?]$/, '');
  return one.length <= LEAD_MAX ? one : one.slice(0, LEAD_MAX).replace(/\s+\S*$/, '') + '...';
}
const LEAD_MAX = 200;

/* The card a run or a drafts call names, as recordRun has always found it. */
function cardNamed(db, name, home, repo, actor) {
  const rows = cardRows(db);
  /* PR-n names its live holder, never a retired card that held the label before */
  const live = /^pr-\d+$/i.test(String(name || '').trim()) ? resolveRecord(db, name, { kinds: ['procedure'], day: actorOf(actor).day }) : null;
  const hit = findCardIn(rows.map((r) => r.fields), live ? live.key : name, { project: home, repo });
  if (!hit) throw new UsageError('no procedure named ' + name + (home ? ' in ' + home : '') + ': proc scan reads a project\'s ' + PROC_DIR);
  return { hit, row: rows.find((r) => r.fields === hit) };
}

/* ---- a deviated run carries its outcome in the same call; the board files no task ---- */

const ENDED = ['done', 'dropped'];
/* the step a deviation names: the first "step N" of its lead, else of its note; '' for none */
export function stepOf(lead, text) {
  const m = /\bsteps?\s+(\d+)\b/i.exec(String(lead || '')) || /\bsteps?\s+(\d+)\b/i.exec(String(text || ''));
  return m ? 'step ' + m[1] : '';
}
const slotOf = (step) => step || 'steps';
const isOpen = (db, key) => { const r = key ? db.stmt('SELECT status FROM records WHERE key = ?').get(key) : null; return !!r && !ENDED.includes(r.status); };
/* the open tasks holding the flag: those a run named as filed, and the draft tasks the board filed before */
const openTasks = (db, front) => [...new Set([...Object.values(front.filedTasks || {}), ...Object.values(front.drafts || {})])].filter((k) => isOpen(db, k));

export const OUTCOMES = '--fixed <commit> (the steps are fixed now, in the commit that changed the card), --one-off "why" (a one-off, and the steps stand) or --filed T-n (real work you filed through the ladder: an open task on a track or in an inbox)';
const MARK = '. Outcome: ';
const SAID = { fixed: (r) => 'the steps are fixed in ' + r.slice(0, 7), 'one-off': (r) => 'a one-off, the steps stand: ' + r, filed: (r) => 'filed as ' + r };
const HEARD = [['fixed', /^the steps are fixed in (\S+)$/], ['one-off', /^a one-off, the steps stand: ([\s\S]*)$/], ['filed', /^filed as (\S+)$/]];

/* The outcome a run names, checked before anything is written: one for a deviation, none for a clean run. */
function outcomeOf(db, result, { fixed, oneOff, filed }) {
  const given = [['fixed', fixed], ['one-off', oneOff], ['filed', filed]]
    .map(([k, v]) => [k, typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v ? String(v) : '']).filter(([, v]) => v);
  if (result === 'clean') {
    if (given.length) throw new UsageError('an outcome goes with a deviated run; a clean run takes none');
    return null;
  }
  if (!given.length) throw new UsageError('a deviated run says what happens next, in the same call, with one of: ' + OUTCOMES);
  if (given.length > 1) throw new UsageError('a deviated run takes one outcome, not ' + given.map(([k]) => '--' + k).join(' and '));
  const [kind, v] = given[0];
  if (kind === 'fixed') {
    if (!/^[0-9a-f]{7,40}$/i.test(v)) throw new UsageError('--fixed takes the commit that changed the card, as a sha: ' + v);
    return { kind, ref: v.toLowerCase() };
  }
  if (kind === 'one-off') return { kind, ref: v };
  const rec = resolveRecord(db, v, { kinds: ['task'] });
  if (!rec) throw new UsageError('--filed names the task you filed: no task ' + v);
  const id = rec.fields.id;
  if (ENDED.includes(rec.fields.status)) throw new UsageError(id + ' is ' + rec.fields.status + ': --filed names open work');
  if (placeOf(db, rec).kind === 'none') {
    throw new UsageError(id + ' is on no track and in no inbox: place it through the ladder first (the place tool, or `askerdo task edit ' + id + ' --track TR-n`), then record the run');
  }
  return { kind, ref: id, key: rec.key };
}

/* Each deviated run in a card's journal: its lead, step and outcome (kind none for the runs recorded before a run carried its outcome). */
function deviations(db, key) {
  const out = [];
  for (const n of db.stmt('SELECT at, body FROM notes WHERE record = ? ORDER BY position').all(key)) {
    const body = String(n.body || '');
    if (!body.startsWith('deviated run: ')) continue;
    const rest = body.slice('deviated run: '.length);
    const at = rest.lastIndexOf(MARK);
    const cut = at >= 0 ? at : rest.lastIndexOf('. Draft edit for ');
    const text = cut < 0 ? rest : rest.slice(0, cut);
    let outcome = { kind: 'none' };
    const said = at >= 0 ? rest.slice(at + MARK.length).replace(/\.$/, '') : '';
    for (const [kind, re] of HEARD) { const m = re.exec(said); if (m) { outcome = { kind, ref: m[1] }; break; } }
    const lead = leadOf(text);
    out.push({ at: String(n.at || '').slice(0, 10), lead, step: stepOf(lead, text), outcome });
  }
  return out;
}

/* `proc ran <name> clean|deviated`: a clean run moves the verified commits to the `heads` the PC
   read where it ran; a deviated one names its outcome (outcomeOf), which the card records. Only
   a filed outcome flags the card, until that task closes. The PC judges `stale` against the
   moved commits and names `base`, the checkout whose steps file it read. */
export function recordRun(db, { name, result, note, fixed, oneOff, filed, project = '', repo = '', base, heads = {}, stale } = {}, actor) {
  if (!['clean', 'deviated'].includes(result)) throw new UsageError('a run is clean or deviated');
  const text = String(note || '').replace(/\s+/g, ' ').trim();
  if (result === 'deviated' && !text) throw new UsageError('a deviated run needs --note "what differed", with one of: ' + OUTCOMES);
  const lead = leadOf(note);
  const home = project ? normPath(project) : '';
  repo = repo || home.toLowerCase();
  return tx(db, () => {
    const { hit, row } = cardNamed(db, name, home, repo, actor);
    const outcome = outcomeOf(db, result, { fixed, oneOff, filed });
    const step = outcome ? stepOf(lead, text) : '';
    /* a one-off that recurs at a step is the card to fix, not a run to excuse again */
    if (outcome && outcome.kind === 'one-off' && step) {
      const last = deviations(db, row.key).filter((d) => d.step === step).at(-1);
      if (last && last.outcome.kind === 'one-off') {
        throw new UsageError(step + ' of ' + hit.id + ' deviated as a one-off before (' + last.at + ': ' + last.lead
          + '): a deviation that recurs means the card should be fixed (--fixed <commit>) or the work filed (--filed T-n)');
      }
    }
    const mine = !!home && (sameDir(home, hit.project) || ofRepo(hit, repo));
    /* a project's shared name is no folder, so a card placed nowhere names none */
    const at0 = normPath(base || (mine ? home : hit.project || ''));
    const verified = { ...(hit.verified || {}) };
    if (result === 'clean') for (const [k, h] of Object.entries(heads || {})) if (h) verified[k] = h;
    const clean = result === 'clean' ? (Number(hit.cleanRuns) || 0) + 1 : 0;
    const suggest = clean === SCRIPT_AFTER;
    const ctx = actorOf(actor);
    const filedTasks = outcome && outcome.kind === 'filed' ? { ...(hit.filedTasks || {}), [slotOf(step)]: outcome.key } : hit.filedTasks;
    const waits = openTasks(db, { ...hit, filedTasks }).map((k) => labelOf(db, k));
    const runNote = result === 'clean'
      ? 'clean run' + (verified.self ? ' at ' + verified.self.slice(0, 7) : '') + (text ? ': ' + text : '')
        + (suggest ? '. ' + clean + ' clean runs in a row: the steps could become a script.' : '')
        + (waits.length ? '. The flag holds while ' + waits.join(', ') + ' waits.' : '')
      : 'deviated run: ' + text.replace(/\.$/, '') + MARK + SAID[outcome.kind](outcome.ref) + '.';
    const f = updateCard(db, row, (front) => {
      front.runs = (Number(front.runs) || 0) + 1;
      front.cleanRuns = clean;
      front.lastRun = ctx.at;
      if (Array.isArray(stale)) front.stale = stale;
      /* a clean run's commit is the run's own record, never the handover's to withdraw */
      if (result === 'clean') { front.verified = verified; front.verifiedAt = ctx.at; delete front.vouched; }
      if (outcome && outcome.kind === 'filed') { front.filedTasks = filedTasks; front.flag = lead; }
      else if (!waits.length) front.flag = '';
    }, ctx, runNote);
    return {
      id: f.id, slug: f.slug, name: f.name, result, runs: f.runs, cleanRuns: f.cleanRuns, verified: f.verified || {},
      stale: f.stale || [], flag: f.flag || '', path: at0 ? at0 + '/' + f.doc : f.doc,
      ...(outcome ? { outcome: { kind: outcome.kind, ref: outcome.ref, ...(step ? { step } : {}) } } : {}), ...(waits.length ? { openTasks: waits } : {}),
      ...(f.cleanRuns >= SCRIPT_AFTER ? { suggestScript: f.id + ' ran clean ' + f.cleanRuns + ' times in a row: its steps could become a script, with the file pointing at it.' } : {}),
    };
  });
}

/* `proc drafts <name>`: the card's deviated runs by the step each names, with the outcome each run
   recorded, and the draft tasks the board once filed for a deviated run still open, for the session to settle. */
export function procDrafts(db, { name, project = '', repo = '' } = {}, actor) {
  const home = project ? normPath(project) : '';
  return tx(db, () => {
    const { hit, row } = cardNamed(db, name, home, repo || home.toLowerCase(), actor);
    const groups = new Map();
    for (const d of deviations(db, row.key)) {
      const g = groups.get(d.step) || { step: d.step, runs: [] };
      g.runs.push(d);
      groups.set(d.step, g);
    }
    const steps = [...groups.values()].sort((a, b) => b.runs.length - a.runs.length).map((g) => {
      const outcomes = {};
      for (const r of g.runs) outcomes[r.outcome.kind] = (outcomes[r.outcome.kind] || 0) + 1;
      const last = g.runs.at(-1);
      return { step: g.step, runs: g.runs.length, from: g.runs[0].at, to: last.at, lead: last.lead, last: last.outcome, outcomes };
    });
    const drafts = Object.entries(hit.drafts || {}).filter(([, k]) => isOpen(db, k))
      .map(([slot, k]) => ({ step: slot === slotOf('') ? '' : slot, task: labelOf(db, k) }));
    return { id: hit.id, slug: hit.slug, steps, drafts };
  });
}

const viewOf = (db, fields) => {
  const open = openTasks(db, fields).map((k) => labelOf(db, k));
  return cardView(open.length ? { ...fields, openTasks: open } : fields);
};

/* Every card as the CLI and the mod read it, by number; `openTasks`, the open tasks holding its flag. */
export function procedureCards(db) {
  return cardRows(db).map((r) => viewOf(db, r.fields)).sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)));
}

/* The cards a record's refs name (a key, or a PR-n stored as written), each with its badge and reasons. */
export function cardsCited(db, refs) {
  const out = [];
  for (const v of Array.isArray(refs) ? refs : []) {
    const e = resolveRecord(db, String(v), { kinds: [KIND] });
    if (!e || out.some((c) => c.key === e.key)) continue;
    const c = viewOf(db, e.fields);
    out.push({ id: c.id, key: c.key, name: c.name, badge: c.badge, reasons: c.reasons });
  }
  return out;
}

/* The open tasks whose refs name a card, by its key or its label. */
export function tasksCiting(db, card) {
  return db.stmt(`SELECT DISTINCT r.key, r.label, r.title, r.status FROM records r, json_each(r.fields, '$.refs') j
    WHERE r.kind = 'task' AND coalesce(r.status, '') NOT IN ('done', 'dropped') AND (j.value = ? OR upper(j.value) = ?) ORDER BY r.id`)
    .all(card.key, String(card.label || '').toUpperCase());
}

/* The live cards for the tool-call watcher; each PC shows them at its own
   checkout with cardsAt and matches with lib/proc-match.mjs matchCall. */
export function triggerCards(db) {
  return procedureCards(db).filter((c) => c.status !== 'retired');
}
