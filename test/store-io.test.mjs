/* The atomic write under a CONCURRENT READER:
 * Windows refuses to replace an open file (827 refusals in 2000 replaces), so writeAtomic swaps NAMES instead. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, readFileSync, readdirSync, renameSync,
  rmSync, unlinkSync, watch, writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { writeAtomic } from '../lib/store-io.mjs';
import { tempDir } from './helpers/sandbox.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Distinctive bytes: the payload carries its own number at BOTH ends with a
   long filler between, so a read that mixed two writes is visible as a
   mismatch rather than having to be inferred from a length. */
const payload = (n) => String(n) + ':' + 'x'.repeat(3000) + ':' + String(n) + '\n';

/* A child, started and then waited for: every one of these prints 'ready' once
   it holds what the case needs it to hold, so no case races its own setup. */
function startChild(source, args) {
  const child = spawn(process.execPath, ['-e', source, ...args],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  /* a say() after the child died (failure paths only) must not surface as an
     unhandled EPIPE */
  child.stdin.on('error', () => {});
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const line = async (want, capMs = 15000) => {
    const deadline = Date.now() + capMs;
    for (;;) {
      const hit = out.split('\n').find((l) => l.startsWith(want));
      if (hit !== undefined) return hit.slice(want.length);
      if (Date.now() > deadline) {
        throw new Error('child never said ' + want + ' (stdout ' + JSON.stringify(out)
          + ', stderr ' + JSON.stringify(err) + ')');
      }
      await sleep(5);
    }
  };
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill();
  });
  return { child, line, stop, say: (s) => child.stdin.write(s + '\n') };
}

/* Windows deletes a file with an open handle by MARKING it: the name can
   outlive the unlink until the last handle closes, so what a case asserts is
   that nothing is left once the child is gone, polled rather than read once. */
async function settles(dir, want, capMs = 10000) {
  const deadline = Date.now() + capMs;
  for (;;) {
    const now = readdirSync(dir).sort();
    if (now.length === want.length && now.every((n, i) => n === want[i])) return now;
    if (Date.now() > deadline) return now;
    await sleep(20);
  }
}

/* Holds the target open for the whole case and reads it from that HELD handle
   on request, always from position 0, so what comes back is what the handle
   was opened on rather than wherever a previous read left the cursor. */
const HOLDER = [
  "const fs = require('node:fs');",
  "const fd = fs.openSync(process.argv[1], 'r');",
  "process.stdout.write('ready\\n');",
  "process.stdin.on('data', () => {",
  "  const buf = Buffer.alloc(1 << 20);",
  "  const n = fs.readSync(fd, buf, 0, buf.length, 0);",
  "  process.stdout.write('held:' + JSON.stringify(buf.slice(0, n).toString('utf8')) + '\\n');",
  "});",
  "setInterval(() => {}, 1000);",
].join('\n');

test('a child holding the target open: the swap lands the new bytes and the held handle still reads the old ones whole', async (t) => {
  const dir = tempDir('nd-store-io-');
  const target = join(dir, 'record.md');
  const OLD = payload(0);
  const NEW = payload(1);
  writeFileSync(target, OLD);

  const held = startChild(HOLDER, [target]);
  t.after(held.stop);
  await held.line('ready');

  /* The platform, measured rather than named. The probe carries the SAME bytes
     the target already has, so a platform that allows the replace is not
     changing anything by taking it. */
  const probe = join(dir, 'probe.bytes');
  writeFileSync(probe, OLD);
  let refusedReplace = false;
  try {
    renameSync(probe, target);
  } catch (e) {
    refusedReplace = true;
    assert.ok(['EPERM', 'EACCES', 'EBUSY'].includes(e.code),
      'a refused replace should carry a sharing-violation code, got ' + e.code);
    unlinkSync(probe);
  }

  /* A plain renameSync would end the case here, with the refusal above thrown
     straight at the caller and the temp file left behind. */
  writeAtomic(target, NEW);
  assert.equal(readFileSync(target, 'utf8'), NEW, 'the new bytes are under the target name');

  /* The reader that was holding the file when the write happened: on Windows
     those bytes are in the aside file the swap renamed to, elsewhere in the
     unlinked original, and the handle never sees a mix. */
  held.say('read');
  const seen = JSON.parse(await held.line('held:'));
  assert.equal(seen, OLD, 'the held handle reads the old bytes, whole');

  if (refusedReplace) {
    /* the plain replace was refused microseconds earlier against the same held
       handle, and the write landed anyway: the swap is the only path that
       could have put it there */
    assert.ok(true);
  }

  await held.stop();
  const left = await settles(dir, ['record.md']);
  assert.deepEqual(left, ['record.md'], 'no temp and no aside file survives the write');
});

/* The board server's shape: re-reads the target on a 1ms tick and records every
   distinct payload. ENOENT is skipped rather than counted, since the swap's gap
   is microseconds where the name is absent. */
const TICKER = [
  "const fs = require('node:fs');",
  "const f = process.argv[1];",
  "let reads = 0; let torn = 0; let missing = 0; const seen = new Set();",
  "setInterval(() => {",
  "  let s;",
  "  try { s = fs.readFileSync(f, 'utf8'); }",
  "  catch (e) { if (e.code === 'ENOENT') missing++; return; }",
  "  reads++;",
  "  const m = /^(\\d+):x+:(\\d+)\\n$/.exec(s);",
  "  if (!m || m[1] !== m[2]) { torn++; seen.add('TORN:' + s.length + ':' + s.slice(0, 12)); return; }",
  "  seen.add(m[1]);",
  "}, 1);",
  "process.stdout.write('ready\\n');",
  "process.stdin.on('data', () => {",
  "  process.stdout.write('report:' + JSON.stringify({ reads, torn, missing, seen: [...seen] }) + '\\n');",
  "  process.exit(0);",
  "});",
].join('\n');

test('a child re-reading the target on a fast tick: three hundred writes, no failure and no torn read', async (t) => {
  const dir = tempDir('nd-store-io-');
  const target = join(dir, 'record.md');
  writeFileSync(target, payload(0));

  const ticker = startChild(TICKER, [target]);
  t.after(ticker.stop);
  await ticker.line('ready');

  /* The probe measured 827 refusals in 2000 replaces against exactly this shape, so a
     plain rename would throw well inside this loop's first hundred. */
  const WRITES = 300;
  const failures = [];
  for (let i = 1; i <= WRITES; i++) {
    try {
      writeAtomic(target, payload(i));
    } catch (e) {
      failures.push(i + ': ' + ((e && e.code) || '') + ' ' + ((e && e.message) || e));
    }
    /* a yield every so often, so the reader is really interleaved with the
       writes rather than starved by a synchronous run of them */
    if (i % 25 === 0) await sleep(1);
  }
  assert.deepEqual(failures, [], 'every write landed');
  assert.equal(readFileSync(target, 'utf8'), payload(WRITES), 'the final bytes are the last write');

  ticker.say('report');
  const r = JSON.parse(await ticker.line('report:'));
  assert.equal(r.torn, 0, 'no read saw a mix of two writes: ' + JSON.stringify(r.seen.filter((s) => s.startsWith('TORN'))));
  assert.ok(r.reads > 20, 'the reader really was reading, ' + r.reads + ' whole reads');
  const written = new Set(Array.from({ length: WRITES + 1 }, (_, i) => String(i)));
  const strange = r.seen.filter((s) => !written.has(s));
  assert.deepEqual(strange, [], 'every payload the reader saw is one that was written');

  await ticker.stop();
  const left = await settles(dir, ['record.md']);
  assert.deepEqual(left, ['record.md'], 'three hundred writes leave no temp and no aside file');
});

test('the plain path is one rename: a file nobody holds never mints an aside', async (t) => {
  const dir = tempDir('nd-store-io-', t);
  const target = join(dir, 'record.md');
  writeFileSync(target, payload(0));

  /* Every name that appeared while the write ran: watcher events are delivered
     after the synchronous write returns, so a name that existed for
     microseconds is still reported. */
  const seen = new Set();
  let watcher;
  try {
    watcher = watch(dir, (ev, name) => { if (name) seen.add(String(name)); });
  } catch {
    watcher = null;
  }

  writeAtomic(target, payload(1));
  const control = join(dir, 'control.bytes');
  writeFileSync(control, 'x');
  await sleep(150);
  if (watcher) watcher.close();
  rmSync(control, { force: true });

  assert.equal(readFileSync(target, 'utf8'), payload(1));
  assert.deepEqual(readdirSync(dir).sort(), ['record.md'], 'nothing is left beside the target');

  if (watcher) {
    assert.ok(seen.has('control.bytes'),
      'the watcher was live: it should have seen the control write, saw ' + JSON.stringify([...seen]));
    assert.deepEqual([...seen].filter((n) => n.includes('.tmp-aside-')), [],
      'the plain path mints no aside name at all');
  }
  assert.ok(!existsSync(target + '.away'), 'and nothing was moved out of the way');
});
