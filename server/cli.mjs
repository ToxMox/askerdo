#!/usr/bin/env node
/* The board server's commands. No timers live in the server: Unraid's scheduler
   runs backup, export and check through `docker exec`, and they reach the running
   server's loopback admin route, so only the server opens the file.
   node server/cli.mjs <command> [--db <file>] [--port <n>]; usage lists them. */
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { ADMIN_HEADER, ADMIN_SECRET_FILE } from './paths.mjs';

/* node:sqlite announces itself as experimental on every start; that line is noise here */
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') process.stderr.write(String(w.stack || w) + '\n'); });

/* the database modules load after help and kit, which a PC without node:sqlite runs */
let openDb, migrate, maint;
const { timingRow, timingSummary } = await import('./timings.mjs');

const USAGE = 'usage: cli.mjs <migrate | import <store> | export <dir> | backup [--dir <dir>] | check | serve [--host <h>] [--settings <file>]'
  + ' | token new <device> | token list | token revoke <device> | setup-code | kit <dir> [--port <n>] [--tz <zone>]'
  + ' | timings [--file <log>] | restore [<date | file>] | rehearse <store> [--kept <pc data dir>] [--pc <name>] | help> [--db <file>] [--port <n>]\n';

const HELP = USAGE + [
  'serve        run the board; while no PC is on it, its start prints a setup code for the first PC;',
  '             --settings names a JSON file whose boardBackups, read at each backup, is the backups folder',
  'setup-code   a fresh setup code from the running board while no PC is on it (the old one stops working)',
  'kit <dir>    write a folder a Docker host builds the board from: server/, compose.yaml, README.txt;',
  "             --port is the port PCs reach (17480), --tz the zone (this PC's); on the host: docker compose up -d --build",
  "token ...    a device token made, listed or revoked on the board itself (the first PC's fallback)",
  'backup, export, check   the upkeep, through the running board when one is up',
  'restore      put a dated backup (or a file) back as the database; the board must be stopped',
  "migrate, import, rehearse, timings   the schema, the import from the file store, and the verbs' timings",
].join('\n') + '\n';

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

function openBoard(path, backups) {
  const db = openDb(path);
  const r = migrate(db, { backup: (n) => maint.vacuumInto(db, backups, 'askerdo-pre-schema-' + (n + 1) + '-' + maint.day() + '.db') });
  return { db, migrated: r };
}

/* The running server's admin route on loopback, with the secret it wrote beside the
   database, or null when none listens. */
let adminSecret = '';
function admin(port, cmd, body = {}) {
  const text = JSON.stringify(body);
  return new Promise((ok, fail) => {
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), [ADMIN_HEADER]: adminSecret };
    const req = request({ host: '127.0.0.1', port, path: '/admin/' + cmd, method: 'POST', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let r;
        try { r = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { r = null; }
        if (res.statusCode === 200 && r) ok(r.result);
        else fail(new Error((r && r.error) || 'the board answered ' + res.statusCode));
      });
    });
    req.on('error', (e) => (e.code === 'ECONNREFUSED' ? ok(null) : fail(e)));
    req.end(text);
  });
}

/* the backups folder a --settings file names at this moment, else the start's own */
function backupsFrom(settings, backups) {
  if (!settings) return backups;
  return () => {
    try {
      const v = JSON.parse(readFileSync(settings, 'utf8').trim()).boardBackups;
      if (typeof v === 'string' && v.trim()) return resolve(v.trim());
    } catch {}
    return backups;
  };
}

async function serve(db, { port, host, dataDir, backups, settings }) {
  const { createApi, newSetupCode, setupCodeText } = await import('./api.mjs');
  const api = createApi({ db, dataDir, backupsDir: backupsFrom(settings, backups), archiveDir: process.env.ASKERDO_ARCHIVE || undefined });
  const at = await api.listen(port, host);
  process.stdout.write('askerdo board listening on ' + at.host + ':' + at.port + '\n');
  /* the console is the one place the first PC's code shows */
  const setup = newSetupCode(db);
  if (setup) process.stdout.write(setupCodeText(setup.code, at.port));
  const stop = () => api.close().then(() => { db.close(); process.exit(0); });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

async function main(argv) {
  const a = args(argv);
  const cmd = a._[0];
  const path = resolve(a.db || process.env.ASKERDO_DB || '/data/askerdo.db');
  const dataDir = dirname(path);
  const backups = resolve(a.dir || process.env.ASKERDO_BACKUPS || join(dataDir, 'backups'));
  const port = Number(a.port || process.env.ASKERDO_PORT || 17480);
  const print = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');
  try { adminSecret = readFileSync(join(dataDir, ADMIN_SECRET_FILE), 'utf8').trim(); } catch {}
  if (cmd === 'help' || Object.hasOwn(a, 'help')) { process.stdout.write(HELP); return 0; }
  if (cmd === 'kit') {
    if (!a._[1]) { process.stderr.write(USAGE); return 2; }
    const { writeKit } = await import('./kit.mjs');
    const k = writeKit(a._[1], { port: a.port || 17480, tz: a.tz });
    process.stdout.write('wrote the board kit to ' + k.dir + ': port ' + k.port + ', time zone ' + k.tz
      + (k.zoneNamed ? '' : " (this PC's; --tz <Area/City> names another)") + '\n'
      + 'copy the folder to the Docker host and run docker compose up -d --build in it; docker compose logs board then shows the setup code for the first PC\n');
    return 0;
  }
  ({ openDb } = await import('./db.mjs'));
  ({ migrate } = await import('./migrate.mjs'));
  maint = await import('./maint.mjs');
  /* only a running board mints one: its start would replace a code minted in the file */
  if (cmd === 'setup-code') {
    const { setupCodeText } = await import('./api.mjs');
    const out = await admin(port, 'setup-code');
    if (out === null) { process.stderr.write('no board answers on port ' + port + ': start it, and its start prints a setup code while no PC is on it\n'); return 1; }
    if (!out.setup) { process.stderr.write("a PC is on this board already, so it takes no setup code: mint a join code on a PC on the board (join-code, or the tray's Add a PC)\n"); return 1; }
    process.stdout.write(setupCodeText(out.setup.code, port));
    return 0;
  }
  if (cmd === 'timings') {
    const rows = timingSummary(resolve(a.file || join(dataDir, 'timings.log')));
    if (!rows.length) process.stdout.write('no timings logged yet\n');
    for (const r of rows) process.stdout.write(timingRow(r) + '\n');
    return 0;
  }
  /* the migration from the file store in one run; --db names a new file, none runs the proofs alone */
  if (cmd === 'rehearse') {
    if (!a._[1]) { process.stderr.write(USAGE); return 2; }
    const { rehearse } = await import('./rehearse.mjs');
    const out = await rehearse({ store: a._[1], db: a.db, kept: a.kept, pc: a.pc });
    print(out);
    return out.ok ? 0 : 1;
  }
  if (cmd === 'token') {
    const sub = a._[1];
    const route = { new: 'token/new', list: 'token/list', revoke: 'token/revoke' }[sub];
    if (!route || (sub !== 'list' && !a._[2])) { process.stderr.write(USAGE); return 2; }
    let out = await admin(port, route, { device: a._[2] });
    if (out === null) {
      const api = await import('./api.mjs');
      const { db } = openBoard(path, backups);
      try { out = sub === 'new' ? api.newToken(db, a._[2]) : sub === 'list' ? api.listTokens(db) : api.revokeToken(db, a._[2]); } finally { db.close(); }
    }
    print(out);
    return 0;
  }
  /* never under a running server, which holds the file; no copy named lists them */
  if (cmd === 'restore') {
    if (!a._[1]) { print(maint.copies([backups])); return 0; }
    const up = await new Promise((done) => {
      const req = request({ host: '127.0.0.1', port, path: '/health', timeout: 1500 }, (res) => { res.resume(); done(true); });
      req.on('timeout', () => { req.destroy(); done(false); });
      req.on('error', () => done(false));
      req.end();
    });
    if (up) {
      process.stderr.write('a board is running on port ' + port + ', and it holds ' + path + ': stop it first (docker stop askerdo, or stop its service), then run restore again\n');
      return 1;
    }
    const r = maint.restore(path, maint.pickCopy(a._[1], [backups]));
    print(r);
    return r.ok ? 0 : 1;
  }
  if (!['migrate', 'import', 'export', 'backup', 'check', 'serve'].includes(cmd)) {
    process.stderr.write(USAGE);
    return 2;
  }
  if (cmd === 'export' && !a._[1]) throw new Error('export needs a folder');
  /* a running server does these itself; the file is opened here only when none is up */
  if (['backup', 'export', 'check'].includes(cmd)) {
    const body = cmd === 'export' ? { dir: resolve(a._[1]) } : cmd === 'backup' ? { keep: Number(a.keep) || undefined } : {};
    const out = await admin(port, cmd, body);
    if (out !== null) { print(out); return out.ok === false ? 1 : 0; }
    if (cmd === 'check') {
      const db = openDb(path);
      try { const r = maint.check(db, { log: join(dataDir, 'checks.log') }); print(r); return r.ok ? 0 : 1; } finally { db.close(); }
    }
  }
  mkdirSync(dataDir, { recursive: true });
  const { db, migrated } = openBoard(path, backups);
  if (cmd === 'serve') return serve(db, { port, host: a.host || process.env.ASKERDO_HOST || '127.0.0.1', dataDir, backups, settings: a.settings });
  try {
    if (cmd === 'migrate') print(migrated);
    if (cmd === 'import') {
      if (!a._[1]) throw new Error('import needs the store folder');
      const { importStore } = await import('./import.mjs');
      const { mapProjects } = await import('./tracks-import.mjs');
      const { pcNameOf } = await import('./rehearse.mjs');
      const t = performance.now();
      const counts = importStore(db, resolve(a._[1]));
      /* run on the PC that holds the folders, as the rehearsal does */
      const projects = mapProjects(db, { nameOf: await pcNameOf() });
      print({ counts, projects, ms: Math.round(performance.now() - t), bytes: statSync(path).size });
    }
    if (cmd === 'export') print(maint.exportTo(db, a._[1]));
    if (cmd === 'backup') print(maint.backup(db, backups, Number(a.keep || maint.KEEP)));
  } finally {
    db.close();
  }
  return 0;
}

const code = await main(process.argv.slice(2)).catch((e) => {
  process.stderr.write((e && e.message ? e.message : String(e)) + '\n');
  return 1;
});
if (typeof code === 'number') process.exitCode = code;
