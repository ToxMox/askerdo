/* The rehearsal of the migration from the file store, in
   one call: the raw import with its byte proof, the track merge with its proof,
   the export read back byte for byte, the folder paths named by shared names, then the database file, the brain archive
   beside it, and the live handoffs' loose-file lists and the kept dispositions on
   this PC. Everything runs in memory first, so a failed proof leaves no file behind. */
import { chmodSync, constants, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDb, readTx } from './db.mjs';
import { migrate } from './migrate.mjs';
import { fullVerify, handoffTextAsKept, importFiles, importStore, verifySummary } from './import.mjs';
import { READS_FILE, RECORD_DIRS, storeFiles } from './render.mjs';
import { actorOf } from './records.mjs';
import { labelSnapshot, mapProjects, mergeTracks, proveTracks } from './tracks-import.mjs';
import { runVerb } from './verbs/index.mjs';

const VERIFY_HEAD = '## Verify first\n\n```json\n';

const fresh = () => { const db = openDb(':memory:'); migrate(db); return db; };

/* the PC names each folder, since only it can read their git (the PC side only). */
export async function pcNameOf() {
  const { normDir, sharedName } = await import('../lib/project-id.mjs');
  return (d) => sharedName(d) || normDir(d);
}

/* The record files of a store folder, store-relative, as the import reads them. */
export function storeRecordFiles(root) {
  const ls = (rel) => (existsSync(join(root, rel)) ? readdirSync(join(root, rel)) : []);
  const md = (rel) => ls(rel).filter((n) => n.endsWith('.md') && n !== 'index.md' && !n.includes('.tmp-')).map((n) => rel + '/' + n);
  const out = Object.values(RECORD_DIRS).concat(['handoffs']).flatMap(md);
  for (const p of ['profiles/profiles.json', 'legacy/id-map.jsonl', 'legacy/brain-map.json', 'tracks/inbox.json']) if (existsSync(join(root, p))) out.push(p);
  return out.concat(ls('activity').filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n)).map((n) => 'activity/' + n)).sort();
}

/* A handoff file as the board keeps it: the loose-file lists dropped, every other byte the same. */
function withoutLists(text) {
  const at = text.lastIndexOf(VERIFY_HEAD);
  if (at < 0) return text;
  return text.slice(0, at + VERIFY_HEAD.length) + JSON.stringify(verifySummary(fullVerify(text)), null, 2) + '\n```\n';
}

const filesOf = (db) => readTx(db, () => new Map([...storeFiles(db)].map((f) => [f.path, f.text])));

/* The storage core's proof: every record file rendered back byte for byte. */
export function renderProof(db, root) {
  const mine = filesOf(db);
  const theirs = storeRecordFiles(root);
  const n = { files: theirs.length, identical: 0, listsDropped: 0, differing: 0, missing: 0, extra: 0 };
  const problems = [];
  for (const p of theirs) {
    const raw = readFileSync(join(root, p), 'utf8');
    const text = p.startsWith('handoffs/') ? handoffTextAsKept(raw) : raw;
    const back = mine.get(p);
    if (back === undefined) { n.missing += 1; problems.push(p + ' did not come back'); continue; }
    if (back === text) n.identical += 1;
    else if (p.startsWith('handoffs/') && back === withoutLists(text)) n.listsDropped += 1;
    else { n.differing += 1; problems.push(p + ' came back different'); }
  }
  const known = new Set(theirs);
  /* the board's read log has no file in today's store */
  for (const p of mine.keys()) if (!known.has(p) && p !== READS_FILE) { n.extra += 1; problems.push(p + ' was rendered but is not in the store'); }
  return { counts: n, problems };
}

/* The export after the merge, imported again and rendered: the weekly export and
   the rollback carry tracks, their order and handoffs. */
export function roundTrip(db) {
  const first = filesOf(db);
  const back = fresh();
  importFiles(back, first);
  const again = filesOf(back);
  back.close();
  const problems = [];
  let identical = 0;
  for (const [p, text] of first) {
    if (again.get(p) === text) identical += 1;
    else problems.push(p + (again.has(p) ? ' changed' : ' was lost') + ' on the way through the export');
  }
  for (const p of again.keys()) if (!first.has(p)) problems.push(p + ' appeared on the way through the export');
  return { counts: { files: first.size, identical }, problems };
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/* The frozen brain archive, copied once beside the database, where the API
   serves it from; an archive already there is left as it is. */
export function copyArchive(root, dataDir) {
  const from = join(root, 'archive');
  const to = join(dataDir, 'archive');
  if (!existsSync(from)) return { skipped: 'the store has no archive' };
  if (existsSync(to)) return { skipped: 'an archive is already there, left as it is', dir: to };
  const tmp = to + '.tmp-' + process.pid;
  rmSync(tmp, { recursive: true, force: true });
  cpSync(from, tmp, { recursive: true });
  renameSync(tmp, to);
  const files = walk(to);
  /* read only for whoever runs the server; Windows keeps the scratch removable */
  if (process.platform !== 'win32') for (const f of files) chmodSync(f, 0o444);
  return { dir: to, files: files.length, bytes: files.reduce((n, f) => n + statSync(f).size, 0) };
}

/* The live handoffs' lists, whole from the store, kept on this PC in the file
   tracks in the session reads (lib/tracks-session.mjs); the PC side only. */
async function keepLive(root, live, dir, pc) {
  const { saveKept } = await import('../lib/tracks-session.mjs');
  return live.map((h) => {
    const repos = fullVerify(readFileSync(join(root, h.file), 'utf8'));
    return { label: h.label, track: h.track, path: saveKept(dir, { label: h.label, key: h.key, track: h.track, pc, created: h.created, repos }) };
  });
}

/* The per-file dispositions (<store>/kept/<repo>.json, asked marks and review
   days included) stay on this PC too; a file already there is never overwritten. */
async function keepDispositions(root, dir) {
  const { KEPT_DIR } = await import('../lib/loose-files.mjs');
  const from = join(root, KEPT_DIR);
  const names = existsSync(from) ? readdirSync(from).filter((n) => n.endsWith('.json')).sort() : [];
  const out = { copied: [], left: [] };
  if (names.length) mkdirSync(join(dir, KEPT_DIR), { recursive: true });
  for (const n of names) {
    try { copyFileSync(join(from, n), join(dir, KEPT_DIR, n), constants.COPYFILE_EXCL); out.copied.push(n); } catch (e) {
      if (e && e.code === 'EEXIST') out.left.push(n);
      else throw e;
    }
  }
  return out;
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
const round2 = (x) => Math.round(x * 100) / 100;

/* The reads the band, the kickoff and the views make, on the written file. */
export function measureReads(path, runs = 20) {
  const db = openDb(path);
  try {
    const tracks = db.prepare("SELECT key, label, workstream FROM records WHERE kind = 'track' AND status IN ('open', 'parked') ORDER BY id").all();
    const wss = [...new Set(tracks.map((t) => t.workstream))];
    const calls = [
      ...wss.map((w) => ['workstreamView', { workstream: w }]),
      ...tracks.map((t) => ['trackKickoff', { track: t.key }]),
      ['shelf', {}],
    ];
    const by = new Map();
    for (let i = 0; i < runs; i++) {
      for (const [verb, input] of calls) {
        const t = performance.now();
        runVerb(db, verb, input, {});
        if (!by.has(verb)) by.set(verb, []);
        by.get(verb).push(performance.now() - t);
      }
    }
    return Object.fromEntries([...by].map(([verb, ms]) => {
      ms.sort((a, b) => a - b);
      return [verb, { calls: ms.length, p50: round2(pct(ms, 50)), p95: round2(pct(ms, 95)) }];
    }));
  } finally {
    db.close();
  }
}

/* rehearse({ store, db, kept, pc, map, now }): `db` is the file to write (it must
   not exist yet; none writes nothing), `kept` the PC data dir that keeps the live
   handoffs' lists and the store's kept dispositions (none keeps them nowhere). */
export async function rehearse({ store, db: target, kept, pc, map = [], now = new Date(), measure = true } = {}) {
  const root = resolve(store);
  const file = target ? resolve(target) : null;
  if (file && existsSync(file)) throw new Error(file + ' exists; the rehearsal writes a fresh database');
  const timings = {};
  const time = (k, fn) => { const t = performance.now(); const r = fn(); timings[k] = Math.round(performance.now() - t); return r; };
  const atPc = kept ? pc || (await import('node:os')).hostname() : pc;
  const db = fresh();
  try {
    const imported = time('importMs', () => importStore(db, root));
    const render = time('renderProofMs', () => renderProof(db, root));
    const before = time('labelsMs', () => labelSnapshot(db, actorOf({ now }).day));
    const merge = time('mergeMs', () => mergeTracks(db, { map, now, pc: atPc }));
    const proof = time('trackProofMs', () => proveTracks(db, { before, merge }));
    const nameOf = await pcNameOf();
    const projects = time('projectsMs', () => mapProjects(db, { nameOf, now }));
    const round = time('roundTripMs', () => roundTrip(db));
    const problems = [...render.problems, ...proof.problems, ...round.problems];
    const out = {
      ok: !problems.length, problems, store: root,
      counts: {
        import: imported, render: render.counts, tracks: merge.counts, proof: proof.checked, roundTrip: round.counts,
        projects: { folders: projects.folders.length, records: projects.records },
      },
      projects: projects.folders,
      tracks: merge.tracks.map(({ key, ...t }) => t), live: merge.live.map(({ file: f, ...h }) => h), reopened: merge.reopened,
      closedWithNoWorkstream: proof.closedNowhere,
      timings,
    };
    if (problems.length) return out;
    if (file) {
      time('writeMs', () => { db.prepare('VACUUM INTO ?').run(file + '.tmp-' + process.pid); renameSync(file + '.tmp-' + process.pid, file); });
      out.db = { path: file, bytes: statSync(file).size };
      out.archive = time('archiveMs', () => copyArchive(root, dirname(file)));
    }
    if (kept) {
      const t = performance.now();
      out.kept = await keepLive(root, merge.live, resolve(kept), atPc);
      out.dispositions = await keepDispositions(root, resolve(kept));
      /* the same pairs seed this PC's project map; a name it already maps keeps its folder */
      const { learnProjects } = await import('../lib/project-map.mjs');
      out.projectMap = learnProjects(resolve(kept), projects.folders.map((f) => f.dir));
      timings.keptMs = Math.round(performance.now() - t);
    }
    if (file && measure) out.reads = time('readsMs', () => measureReads(file));
    return out;
  } finally {
    db.close();
  }
}
