/* Rebuilds the vendored tray executable under assets/ from the Rust crate in
 * tray/.
 *
 * DEV-SIDE ONLY, exactly like scripts/build-viewer.mjs beside it: it never
 * runs in CI and no test ever calls it. assets/askerdo-tray.exe is
 * committed prebuilt so the runtime keeps its promise of no install step, and
 * the toolchain that produced it is PINNED in tray/rust-toolchain.toml rather
 * than left to whatever stable happens to be, because two rebuilds that do not
 * produce the same bytes are two different binaries wearing one name.
 *
 * License notices are DERIVED, never hand-listed, for the same reason the
 * viewer's are: what ships is a statically linked binary, so the crates that
 * need a notice are every crate in the resolved graph the release build was
 * cut from, not the four named in Cargo.toml. `cargo metadata` is the source,
 * and the full text of each distinct license is copied out of the crate
 * sources cargo already unpacked.
 *
 * THE BUILDER'S OWN PATHS ARE REMAPPED OUT. rustc writes the source path of
 * every panic site into the binary, and for a dependency that path is wherever
 * cargo unpacked the crate: under the builder's home. Those strings are not
 * text this script writes, so a text scan never sees them (the exe carries
 * NUL bytes and is skipped as binary). Two --remap-path-prefix rules computed
 * at run time (never a literal path, which would itself be the violation) turn them into
 * cargo-registry/... and askerdo-tray/..., and the exe is scanned as
 * BYTES afterwards, in UTF-8 and UTF-16LE, for the home path the run time
 * reports. The rules ride in CARGO_ENCODED_RUSTFLAGS, which REPLACES the
 * rustflags in tray/.cargo/config.toml, so target-feature=+crt-static travels
 * with them or the C runtime stops being static.
 *
 * Usage: node scripts/build-tray.mjs [--licenses-only]
 * --licenses-only regenerates assets/licenses/askerdo-tray.txt from the
 * lockfile already on disk: no compile, and the vendored exe is not rewritten.
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pluginRoot } from '../lib/node-helpers.mjs';

const CRATE = join(pluginRoot, 'tray');
const ASSETS = join(pluginRoot, 'assets');
const LICENSE_DIR = join(ASSETS, 'licenses');
const EXE_NAME = 'askerdo-tray.exe';
const NOTICE_NAME = 'askerdo-tray.txt';
const TARGET = 'x86_64-pc-windows-msvc';

const LICENSES_ONLY = process.argv.slice(2).includes('--licenses-only');

/* The same text shapes build-viewer.mjs keeps out of what it writes, checked
   here for the same reason: a generated notice is caught as it is written
   rather than after it has been staged. */
const HOME_PATH = /(?:[A-Za-z]:[\\/]Users[\\/]|\/home\/|\/Users\/)([^\\/\s"'`)\]},;|*]+)/gi;
const PLACEHOLDER_SEGMENT = /^(?:\.\.\.|<[^<>]*>|%USERNAME%|\$USER|\$HOME)$/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DASH = /[\u2013\u2014]/;

const written = [];

function main() {
  const pin = pinnedChannel();
  if (!LICENSES_ONLY) {
    checkToolchain(pin);
    console.log('building the tray exe with ' + pin + ' (dev-side, no network beyond crates.io)...');
    run('cargo', ['build', '--release', '--locked'], { CARGO_ENCODED_RUSTFLAGS: rustflags() });
    const built = join(CRATE, 'target', 'release', EXE_NAME);
    if (!existsSync(built)) throw new Error('the release build produced no ' + built);
    copyFileSync(built, join(ASSETS, EXE_NAME));
    written.push(EXE_NAME);
  }
  notices(pin);
  selfScan();
  report();
  /* signed at every rebuild, before its commit; this script never signs */
  if (!LICENSES_ONLY) {
    console.log('the exe is UNSIGNED: the maintainer signs assets/' + EXE_NAME + ' before it is committed;'
      + ' a release refuses it unsigned (docs/procedures/release.md step 4)');
  }
}

/* ---- the toolchain ----------------------------------------------------- */

function pinnedChannel() {
  const toml = readFileSync(join(CRATE, 'rust-toolchain.toml'), 'utf8');
  const hit = toml.match(/^\s*channel\s*=\s*"([^"]+)"/m);
  if (!hit) throw new Error('tray/rust-toolchain.toml names no channel');
  return hit[1];
}

/* The pin is only a pin if it is checked. rustup honours the file on its own,
   so this is a guard against a machine where the override did not take (a
   cargo run from outside the crate directory, a RUSTUP_TOOLCHAIN in the
   environment), not a second mechanism. */
function checkToolchain(pin) {
  const active = run('rustup', ['show', 'active-toolchain']).trim();
  if (!active.startsWith(pin + '-')) {
    throw new Error('the active toolchain is "' + active + '" but tray/rust-toolchain.toml pins '
      + pin + '; run `rustup toolchain install ' + pin + '` and build again');
  }
  console.log('toolchain ' + active.split(' ')[0]);
}

function run(exe, args, env) {
  return execFileSync(exe, args, {
    cwd: CRATE,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
}

/* ---- the paths that must not ship -------------------------------------- */

/* Where cargo unpacked the dependency sources on THIS machine. The env var
   first because a machine that sets CARGO_HOME means it; the home's .cargo
   otherwise, which is cargo's own default. Neither is ever written down: the
   whole point is that no path from this machine reaches a committed file. */
function cargoHome() {
  const set = (process.env.CARGO_HOME || '').trim();
  return set || join(homedir(), '.cargo');
}

function registrySrc() {
  const usual = join(cargoHome(), 'registry', 'src');
  if (existsSync(usual)) return usual;
  /* a layout this rule does not guess: ask cargo where the sources it
     resolved actually sit, and cut at the registry root */
  const meta = JSON.parse(run('cargo', ['metadata', '--format-version', '1', '--locked']));
  for (const pkg of meta.packages) {
    const at = pkg.manifest_path.search(/registry[\\/]src[\\/]/);
    if (at >= 0) return pkg.manifest_path.slice(0, at + 'registry/src'.length);
  }
  throw new Error('no cargo registry source root found: looked at ' + usual + ' and at cargo metadata');
}

/* CARGO_ENCODED_RUSTFLAGS is unit-separator joined, and it REPLACES the
   config's rustflags rather than adding to them, so crt-static is repeated
   here on purpose: tray/.cargo/config.toml keeps it for a plain `cargo build`
   and this keeps it for the build that ships. */
function rustflags() {
  const flags = [
    '-C',
    'target-feature=+crt-static',
    '--remap-path-prefix=' + registrySrc() + '=cargo-registry',
    '--remap-path-prefix=' + CRATE + '=askerdo-tray',
  ];
  console.log('remapping ' + (flags.length - 2) + ' path prefixes out of the binary'
    + ' (the cargo registry sources and the crate directory)');
  /* the unit separator is the character cargo splits this variable on */
  return flags.join(String.fromCharCode(0x1f));
}

/* The builder's home as bytes, in the two encodings a Windows binary can
   carry a path in: rustc writes panic locations as UTF-8 and Windows string
   resources are UTF-16LE. Both slash forms, because a path can reach a
   binary either way. Derived at run time, never a literal. */
function homePatterns() {
  const home = homedir();
  const forms = [home, home.replace(/\\/g, '/')];
  const out = [];
  for (const form of new Set(forms)) {
    out.push({ label: 'UTF-8 ' + (form.includes('\\') ? 'backslash' : 'forward slash'), bytes: Buffer.from(form, 'utf8') });
    out.push({ label: 'UTF-16LE ' + (form.includes('\\') ? 'backslash' : 'forward slash'), bytes: Buffer.from(form, 'utf16le') });
  }
  return out;
}

/* How many times a needle occurs in a haystack, overlapping counted once. */
function occurrences(buf, needle) {
  let n = 0;
  for (let at = buf.indexOf(needle); at !== -1; at = buf.indexOf(needle, at + needle.length)) n += 1;
  return n;
}

/* ---- the notices ------------------------------------------------------- */

/* A license file as a crate ships it. The name is what says WHICH license the
   file is when a crate dual-licenses and ships both, which is the shape most
   of this graph takes (LICENSE-MIT beside LICENSE-APACHE). */
const LICENSE_FILE = /^LICEN[CS]E(?:[-_.][\w.-]+)?$/i;

function labelFor(file, expression) {
  const upper = file.toUpperCase();
  if (upper.includes('APACHE')) return 'Apache-2.0';
  if (upper.includes('MIT')) return 'MIT';
  if (upper.includes('BSD')) return 'BSD';
  if (upper.includes('UNLICENSE')) return 'Unlicense';
  if (upper.includes('UNICODE')) return 'Unicode-3.0';
  return expression;
}

function notices(pin) {
  const meta = JSON.parse(run('cargo', ['metadata', '--format-version', '1', '--locked']));
  const crates = meta.packages
    .filter((p) => p.name !== 'askerdo-tray')
    .sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version));

  const rows = [];
  /* keyed on the license TEXT, so the twenty crates that ship byte-identical
     copies of the MIT text contribute one section between them */
  const texts = new Map();
  for (const pkg of crates) {
    rows.push('- ' + pkg.name + '@' + pkg.version + ' (' + (pkg.license || 'see the notice') + ')'
      + (pkg.repository ? ' ' + pkg.repository : ''));
    const dir = dirname(pkg.manifest_path);
    let names = [];
    try { names = readdirSync(dir); } catch { names = []; }
    for (const file of names.filter((n) => LICENSE_FILE.test(n)).sort()) {
      let text;
      try { text = readFileSync(join(dir, file), 'utf8'); } catch { continue; }
      const body = text.replace(/\r\n/g, '\n').trimEnd() + '\n';
      const key = createHash('sha256').update(body).digest('hex');
      if (texts.has(key)) {
        texts.get(key).from.push(pkg.name + '@' + pkg.version);
        continue;
      }
      texts.set(key, { label: labelFor(file, pkg.license || ''), from: [pkg.name + '@' + pkg.version], body });
    }
  }
  const sections = [...texts.values()].sort((a, b) => a.label.localeCompare(b.label));

  const out = [
    '# assets/' + EXE_NAME,
    '',
    'The AskerDo tray executable, built from the Rust crate in tray/ with',
    'node scripts/build-tray.mjs and committed prebuilt so the runtime needs no',
    'install step. Toolchain pin: ' + pin + ', target ' + TARGET + '.',
    'This file is generated; never hand-edit it.',
    '',
    'Every crate in the resolved dependency graph of the release build is listed,',
    'not just the four named in tray/Cargo.toml: the exe is statically linked, so',
    'the compiled form travels with the notices of everything compiled into it,',
    'and a build-time crate is listed too, which over-covers rather than',
    'under-covers.',
    '',
    '## Crates',
    '',
    ...rows,
    '',
    '## License texts',
    '',
    'Each distinct license text below appears once, copied byte for byte from the',
    'crate sources, with the crates that ship that exact text named above it.',
    '',
    ...sections.flatMap((s) => [
      '### ' + s.label + ' (as shipped by ' + s.from.slice(0, 4).join(', ')
        + (s.from.length > 4 ? ' and ' + (s.from.length - 4) + ' more' : '') + ')',
      '',
      s.body,
      '',
    ]),
  ].join('\n');
  writeFileSync(join(LICENSE_DIR, NOTICE_NAME), out);
  written.push(join('licenses', NOTICE_NAME).replace(/\\/g, '/'));
  console.log(crates.length + ' crates, ' + sections.length + ' distinct license texts');
}

/* ---- the guards -------------------------------------------------------- */

function selfScan() {
  const hits = [];
  const scanned = [];
  const binary = [];
  const patterns = homePatterns();
  for (const rel of written) {
    const buf = readFileSync(join(ASSETS, rel));
    /* A file with NUL bytes is not text and its lines mean nothing, but it can
       still CARRY the builder's home, which is what the committed exe did: it
       gets the byte scan instead of the line scan, never neither. */
    if (buf.includes(0)) {
      binary.push(rel);
      for (const { label, bytes } of patterns) {
        const found = occurrences(buf, bytes);
        if (found) hits.push(rel + ': the home path ' + found + ' times as ' + label);
      }
      continue;
    }
    scanned.push(rel);
    if (buf.includes(13)) hits.push(rel + ': CR byte (CRLF line endings)');
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((line, i) => {
      const at = rel + ':' + (i + 1) + ': ';
      if (DASH.test(line)) hits.push(at + 'en or em dash');
      if (UUID.test(line)) hits.push(at + 'UUID-shaped string');
      for (const m of line.matchAll(HOME_PATH)) {
        if (!PLACEHOLDER_SEGMENT.test(m[1])) hits.push(at + m[0]);
      }
    });
  }
  if (hits.length) {
    console.error('self-scan findings (assets left in place, nothing further written):');
    for (const h of hits) console.error('  ' + h);
    process.exit(1);
  }
  for (const rel of binary) {
    console.log('self-scan ' + rel + ': binary, scanned as bytes for the home path in '
      + patterns.length + ' encodings, 0 hits');
  }
  console.log('self-scan clean: ' + scanned.length + ' of ' + written.length
    + ' files written by this run carry no CR bytes, en or em dashes, UUID shapes,'
    + ' or home paths' + (binary.length ? ' (' + binary.length + ' binary, named above)' : ''));
}

function report() {
  let total = 0;
  for (const rel of written) {
    const file = join(ASSETS, rel);
    const buf = readFileSync(file);
    total += statSync(file).size;
    console.log(rel.padEnd(28) + String(buf.length).padStart(8) + '  ' + createHash('sha256').update(buf).digest('hex'));
  }
  console.log('total'.padEnd(28) + String(total).padStart(8) + ' bytes');
}

if (!existsSync(join(CRATE, 'Cargo.toml'))) throw new Error('missing the tray crate: ' + CRATE);
main();
