import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pluginRoot } from '../lib/node-helpers.mjs';
import { TRAY_EXE, trayExePath } from '../lib/tray.mjs';

/* THE PREBUILT TRAY IS IN THE TREE: no test runs it, these pin that the
   committed binary, its notices and its toolchain pin are present, so a
   checkout that lost one fails here. */

test('the tray exe is committed prebuilt beside the icons and is a Windows executable', () => {
  const exe = trayExePath();
  assert.equal(exe, join(pluginRoot, 'assets', TRAY_EXE));
  assert.ok(existsSync(exe), exe);
  const size = statSync(exe).size;
  assert.ok(size > 100000 && size < 8000000, 'a few hundred KB, never a debug build: ' + size);
  const head = readFileSync(exe).subarray(0, 2).toString('latin1');
  assert.equal(head, 'MZ', 'a PE image starts with MZ');
});

test('the tray notices file names every crate in the lock, with the licence texts', () => {
  const notice = join(pluginRoot, 'assets', 'licenses', 'askerdo-tray.txt');
  assert.ok(existsSync(notice), notice);
  const text = readFileSync(notice, 'utf8');
  const lock = readFileSync(join(pluginRoot, 'tray', 'Cargo.lock'), 'utf8');
  const names = [...lock.matchAll(/^name = "([^"]+)"$/gm)].map((m) => m[1])
    .filter((n) => n !== 'askerdo-tray');
  assert.ok(names.length >= 10, 'the lock names the dependency graph: ' + names.length);
  for (const n of names) assert.ok(text.includes('- ' + n + '@'), 'the notice names ' + n);
  assert.ok(text.includes('MIT'), 'the notice carries the MIT text');
  assert.ok(text.includes('Apache'), 'the notice carries the Apache text');
});

test('the crate pins the exact toolchain version it was built with', () => {
  const pin = readFileSync(join(pluginRoot, 'tray', 'rust-toolchain.toml'), 'utf8');
  assert.match(pin, /channel = "\d+\.\d+\.\d+"/, 'an exact version, never a channel name');
  assert.match(pin, /x86_64-pc-windows-msvc/);
});
