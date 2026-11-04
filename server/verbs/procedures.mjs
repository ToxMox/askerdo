/* Procedure cards and their runs over SQLite (from
   lib/procedures.mjs). A card is a `procedure` record (PR-n); its steps file
   lives in a repo on a PC, so the PC reads and judges it (parseProcedure, judge,
   lint and git stay in lib/procedures.mjs) and hands the result in here. */
import { tx } from '../db.mjs';
import { actorOf, addNote, changesOf, guardHeadings, kebab, logRow, mintKey, orderFields, putRecord } from '../records.mjs';
import { UsageError, endingStamps, loadEntry as recordByKey, lookupFor, pickLabel, resolveRecord } from './labels.mjs';
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
  };
}
const recordRefs = (proc) => proc.refs.filter((r) => r.kind !== 'path').map((r) => r.target);
/* one card per name for every project, owned by none, so no project's scan retires it */
const everywhereCard = (proc, version) => ({ ...scanned('', undefined, proc), everywhere: true, ...(version ? { pluginVersion: version } : {}) });
/* a dotted version compare; a scan with none reads as the oldest */
const vparts = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
const atLeast = (a, b) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return true; };

/* One card's update inside the transaction, with its journal note and activity row. */
function updateCard(db, row, apply, ctx, note) {
  const before = JSON.parse(JSON.stringify(row.fields));
  const front = JSON.parse(JSON.stringify(row.fields));
  apply(front);
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
export function scanProject(db, { project: dir, repo = '', homes, head = '', files = [], everywhere, pluginVersion } = {}, actor) {
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
      out.created.push(make(f.proc, { ...scanned(project, repo, f.proc), stale: f.stale || [] },
        'card made from ' + PROC_DIR + '/' + f.proc.slug + '.md' + (head ? ' at ' + String(head).slice(0, 7) : '')));
    }
    for (const { f, card } of pairs) {
      if (!card) continue;
      const back = card.status === 'retired';
      const r = updateCard(db, byFront.get(card), (front) => {
        if (f.proc) {
          Object.assign(front, scanned(project, repo, f.proc));
          front.stale = f.stale || [];
          front.refs = refsFor(db, recordRefs(f.proc));
        } else front.stale = ['the file does not parse: ' + f.errors[0]];
        if (back) front.status = 'active';
      }, ctx, back ? 'the file is back: ' + card.doc : undefined);
      (r ? out.updated : out.unchanged).push(r ? r.id : card.id);
    }
    for (const c of gone) {
      const why = !c.project || sameDir(c.project, project) || foreign(c, repo, home) ? c.doc + ' is gone from ' + project
        : 'the cards of ' + normPath(c.project) + ' are the main checkout\'s, ' + project;
      updateCard(db, byFront.get(c), (front) => { front.status = 'retired'; }, ctx, 'retired: ' + why);
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

/* a run report rides the note, so the draft and the flag carry only its
   first sentence, which names the step that differed; the journal keeps the note. */
function leadOf(note) {
  const line = String(note || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
  const one = (/^.+?[.!?](?=\s|$)/.exec(line) || [line])[0].replace(/[.!?]$/, '');
  return one.length <= LEAD_MAX ? one : one.slice(0, LEAD_MAX).replace(/\s+\S*$/, '') + '...';
}
const LEAD_MAX = 200;

/* `proc ran <name> clean|deviated`: a clean run moves the verified commits to
   the `heads` the PC read where it ran; a deviation flags the card and drafts
   the edit as a journal note. The PC judges `stale` against the moved commits
   and names `base`, the checkout whose steps file it read. */
export function recordRun(db, { name, result, note, project = '', repo = '', base, heads = {}, stale, source = '' } = {}, actor) {
  if (!['clean', 'deviated'].includes(result)) throw new UsageError('a run is clean or deviated');
  const text = String(note || '').replace(/\s+/g, ' ').trim();
  if (result === 'deviated' && !text) throw new UsageError('a deviated run needs --note "what differed"');
  const lead = leadOf(note);
  const home = project ? normPath(project) : '';
  repo = repo || home.toLowerCase();
  return tx(db, () => {
    const rows = cardRows(db);
    /* PR-n names its live holder, never a retired card that held the label before */
    const live = /^pr-\d+$/i.test(String(name || '').trim()) ? resolveRecord(db, name, { kinds: ['procedure'], day: actorOf(actor).day }) : null;
    const hit = findCardIn(rows.map((r) => r.fields), live ? live.key : name, { project: home, repo });
    if (!hit) throw new UsageError('no procedure named ' + name + (home ? ' in ' + home : '') + ': proc scan reads a project\'s ' + PROC_DIR);
    const row = rows.find((r) => r.fields === hit);
    const mine = !!home && (sameDir(home, hit.project) || ofRepo(hit, repo));
    /* a project's shared name is no folder, so a card placed nowhere names none */
    const at0 = normPath(base || (mine ? home : hit.project || ''));
    const verified = { ...(hit.verified || {}) };
    if (result === 'clean') for (const [k, h] of Object.entries(heads || {})) if (h) verified[k] = h;
    const clean = result === 'clean' ? (Number(hit.cleanRuns) || 0) + 1 : 0;
    const suggest = clean === SCRIPT_AFTER;
    const draft = result === 'deviated'
      ? 'Draft edit for ' + hit.doc + ': bring the step that differed in line with this run ('
        + lead + (lead === text.replace(/[.!?]$/, '') ? '' : "; the whole note is in the card's journal") + '), commit it in '
        + (at0 || (hit.everywhere ? 'the checkout of ' + (source || "the AskerDo plugin's repo") + ', on the PC that holds it'
          : 'the folder of ' + (hit.projectRepo || 'its project'))) + ', then record a clean run.'
      : '';
    const runNote = result === 'clean'
      ? 'clean run' + (verified.self ? ' at ' + verified.self.slice(0, 7) : '') + (text ? ': ' + text : '')
        + (suggest ? '. ' + clean + ' clean runs in a row: the steps could become a script.' : '')
      : 'deviated run: ' + text + '. ' + draft;
    const ctx = actorOf(actor);
    const f = updateCard(db, row, (front) => {
      front.runs = (Number(front.runs) || 0) + 1;
      front.cleanRuns = clean;
      front.lastRun = ctx.at;
      if (Array.isArray(stale)) front.stale = stale;
      if (result === 'clean') { front.verified = verified; front.verifiedAt = ctx.at; front.flag = ''; }
      else front.flag = lead;
    }, ctx, runNote);
    return {
      id: f.id, slug: f.slug, name: f.name, result, runs: f.runs, cleanRuns: f.cleanRuns, verified: f.verified || {},
      stale: f.stale || [], flag: f.flag || '', path: at0 ? at0 + '/' + f.doc : f.doc,
      ...(draft ? { draft } : {}),
      ...(f.cleanRuns >= SCRIPT_AFTER ? { suggestScript: f.id + ' ran clean ' + f.cleanRuns + ' times in a row: its steps could become a script, with the file pointing at it.' } : {}),
    };
  });
}

/* Every card as the CLI and the mod read it, by number. */
export function procedureCards(db) {
  return cardRows(db).map((r) => cardView(r.fields)).sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)));
}

/* The live cards for the tool-call watcher; each PC shows them at its own
   checkout with cardsAt and matches with lib/proc-match.mjs matchCall. */
export function triggerCards(db) {
  return procedureCards(db).filter((c) => c.status !== 'retired');
}
