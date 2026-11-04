/* Rebuilds the file viewer's vendored client stack under assets/.
 *
 * DEV-SIDE ONLY. This is the one thing in the repo that touches npm, and it
 * never runs in CI: assets/ is committed prebuilt so the runtime stays
 * zero-dependency (no install step, no node_modules, nothing to resolve at
 * serve time). Everything happens inside scripts/viewer/.build/, which is
 * gitignored and recreated from scratch on every run, so a build can never
 * leave half-installed state behind.
 *
 * Versions are PINNED below. If npm rejects a pin as nonexistent, substitute
 * the nearest available patch in the same minor (else the nearest minor in the
 * same major), update the pin here, and name the substitution in the CHANGELOG:
 * never float a range, or two rebuilds would not produce the same bytes.
 *
 * License notices are DERIVED, never hand-listed. What ships is a bundle, so
 * the packages that need a notice are the ones whose code is compiled into it,
 * not the names pinned below: MIT, ISC and BSD-3-Clause all want the
 * copyright notice to travel with the compiled form. highlight.min.js comes
 * with an esbuild metafile that names every input, and the two dists copied
 * in already bundled take the dependency closure of their package.
 *
 * Usage: node scripts/build-viewer.mjs [--licenses-only]
 * --licenses-only regenerates assets/licenses/ from the build tree already on
 * disk: no network, no install, and the vendored bundles are never rewritten.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pluginRoot } from '../lib/node-helpers.mjs';

const PINS = {
  esbuild: '0.25.8',
  /* The file-refs viewer's client stack (docs/file-refs-spec.md section 3):
     markdown-it renders, DOMPurify sanitizes every fragment before it reaches
     the DOM, highlight.js colors code. Two of the three publish a browser
     build inside their own tarball and are copied out of it byte for byte;
     highlight.js publishes none, so its COMMON build is bundled here from
     HLJS_ENTRY, which is why it is the one of the three with a metafile. */
  'markdown-it': '14.3.0',
  dompurify: '3.4.14',
  'highlight.js': '11.12.0',
};

/* package -> the licenses/<file>.txt it lands in ('@' and '/' collapse to one
   hyphen). WHICH packages get a file is derived below, not listed here. */
const licenseName = (pkg) => pkg.replace(/^@/, '').replace(/\//g, '-') + '.txt';

/* The license field as a notice row says it. Every row wraps the field in a
   paren pair of its own, and an SPDX expression is allowed to arrive already
   wearing one (dompurify reads "(MPL-2.0 OR Apache-2.0)"), so a wrapping pair
   is stripped here rather than shipped doubled. */
function licenseText(meta) {
  const raw = String((meta && meta.license) || 'see the notice').trim();
  return /^\([^()]*\)$/.test(raw) ? raw.slice(1, -1).trim() : raw;
}

/* The LICENSE file to travel with a package's compiled form. The first shape
   is the ordinary one; the fallback catches the hyphenated spelling some
   packages use instead (punycode.js ships LICENSE-MIT.txt and nothing else).
   Exact form first rather than one loose pattern, so a package carrying BOTH
   (dompurify has LICENSE and LICENSE-MPL) still copies its primary notice
   whatever order the directory reads back in. */
const LICENSE_FILE = /^LICEN[CS]E(\.md|\.txt)?$/i;
const LICENSE_ALT = /^LICEN[CS]E[-_.][\w.-]+$/i;

/* Bundles that arrive PREBUILT, so nothing describes what went into them: each
   one's contributors are the dependency closure of the package it was built
   from. The two client-stack dists below are this shape. */
/* The tray exe's notice is written by scripts/build-tray.mjs out of a cargo
   graph this script knows nothing about, so the sweep below leaves it where it
   is: a notice deleted here would take the attribution for a shipped binary
   with it. */
const TRAY_NOTICE = 'askerdo-tray.txt';

const LICENSES_ONLY = process.argv.slice(2).includes('--licenses-only');

const BUILD_DIR = join(pluginRoot, 'scripts', 'viewer', '.build');
const ASSETS = join(pluginRoot, 'assets');
const LICENSE_DIR = join(ASSETS, 'licenses');
/* Three lines that exist only because highlight.js publishes no browser
   build: the entry names the COMMON language set and parks it on window, and
   esbuild turns it into the script tag the viewer page loads. */
const HLJS_ENTRY = join(pluginRoot, 'scripts', 'viewer', 'hljs-entry.js');

/* The text shapes this repo keeps out of its files (CRLF, en and em dashes,
   home paths with a username segment, UUID shapes), checked HERE so a
   vendored asset is caught as it is written rather than after it has already
   been staged. */
const HOME_PATH = /(?:[A-Za-z]:[\\/]Users[\\/]|\/home\/|\/Users\/)([^\\/\s"'`)\]},;|*]+)/gi;
const PLACEHOLDER_SEGMENT = /^(?:\.\.\.|<[^<>]*>|%USERNAME%|\$USER|\$HOME)$/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DASH = /[\u2013\u2014]/;

const written = [];

function main() {
  if (LICENSES_ONLY) return licensesOnly();

  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });
  mkdirSync(LICENSE_DIR, { recursive: true });

  writeFileSync(join(BUILD_DIR, 'package.json'),
    JSON.stringify({ private: true, devDependencies: PINS }, null, 2) + '\n');

  console.log('installing pinned build dependencies (dev-side, network)...');
  execSync('npm install --no-audit --no-fund --loglevel=error', { cwd: BUILD_DIR, stdio: 'inherit' });

  /* the entries are copied INTO the build dir so bare imports resolve against
     BUILD_DIR/node_modules rather than anything up the repo tree */
  cpSync(HLJS_ENTRY, join(BUILD_DIR, 'hljs-entry.js'));

  const hljsMeta = bundle('hljs-entry.js', 'highlight.min.js', true);

  copyAsset(join(BUILD_DIR, 'out', 'highlight.min.js'), 'highlight.min.js');
  /* verbatim out of the published tarball, sourceMappingURL comment and all:
     a byte-for-byte copy is a claim anybody can re-check against the registry,
     and the map it names simply is not a served asset */
  copyAsset(join(BUILD_DIR, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js'), 'markdown-it.min.js');
  copyAsset(join(BUILD_DIR, 'node_modules', 'dompurify', 'dist', 'purify.min.js'), 'purify.min.js');

  licenses(noticeSet(hljsMeta));
  selfScan();
  report();
}

/* The notice set is a function of what is installed, so it can be recomputed
   exactly from a build tree that is already on disk. Nothing here installs,
   and nothing here rewrites a vendored bundle: the esbuild run is in-memory
   (write: false) purely to get the metafile back. */
function licensesOnly() {
  if (!existsSync(join(BUILD_DIR, 'node_modules'))) {
    throw new Error('--licenses-only needs an existing build tree at ' + BUILD_DIR
      + '; run node scripts/build-viewer.mjs without the flag first');
  }
  mkdirSync(LICENSE_DIR, { recursive: true });
  cpSync(HLJS_ENTRY, join(BUILD_DIR, 'hljs-entry.js'));
  licenses(noticeSet(bundle('hljs-entry.js', 'highlight.min.js', false)));
  selfScan();
  report();
}

/* One option set, used by the real build and by the metafile-only run, so the
   inputs the notices are derived from are the inputs that were compiled. */
function bundle(entry, outfile, write) {
  const require = createRequire(join(BUILD_DIR, 'x.cjs'));
  const esbuild = require('esbuild');
  return esbuild.buildSync({
    entryPoints: [join(BUILD_DIR, entry)],
    bundle: true,
    minify: true,
    format: 'iife',
    outfile: join(BUILD_DIR, 'out', outfile),
    define: { 'process.env.NODE_ENV': '"production"' },
    legalComments: 'none',
    target: ['chrome110'],
    logLevel: 'warning',
    metafile: true,
    write,
  }).metafile;
}

function copyAsset(from, name) {
  cpSync(from, join(ASSETS, name));
  written.push(name);
}

function pkgMeta(pkg) {
  return JSON.parse(readFileSync(join(BUILD_DIR, 'node_modules', pkg, 'package.json'), 'utf8'));
}

/* Every package whose source really landed in the bundle, straight from the
   esbuild metafile inputs. A hand-kept list drifts the moment a transitive
   dependency changes, and the drift is invisible: the bundle is minified with
   legalComments: 'none', so assets/licenses/ is the ONLY attribution that
   ships. */
function bundledPackages(metafile) {
  const out = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const at = input.lastIndexOf('node_modules/');
    if (at < 0) continue;
    const parts = input.slice(at + 'node_modules/'.length).split('/');
    out.add(parts[0].startsWith('@') ? parts[0] + '/' + parts[1] : parts[0]);
  }
  return out;
}

/* A prebuilt bundle has no metafile, so its contributors are the closure of
   what it declares it depends on. */
function dependencyClosure(pkg, out = new Set()) {
  if (out.has(pkg)) return out;
  out.add(pkg);
  if (!existsSync(join(BUILD_DIR, 'node_modules', pkg, 'package.json'))) return out;
  for (const dep of Object.keys(pkgMeta(pkg).dependencies || {})) dependencyClosure(dep, out);
  return out;
}

function noticeSet(hljsMeta) {
  return [
    { asset: 'assets/highlight.min.js', packages: bundledPackages(hljsMeta) },
    { asset: 'assets/markdown-it.min.js', packages: dependencyClosure('markdown-it') },
    { asset: 'assets/purify.min.js', packages: dependencyClosure('dompurify') },
  ];
}

function licenses(groups) {
  const sections = [];
  const copied = new Set();
  for (const group of groups) {
    const rows = [];
    for (const pkg of [...group.packages].sort()) {
      const dir = join(BUILD_DIR, 'node_modules', pkg);
      const name = licenseName(pkg);
      if (!copied.has(name)) {
        const names = readdirSync(dir);
        const hit = names.find((n) => LICENSE_FILE.test(n)) || names.find((n) => LICENSE_ALT.test(n));
        if (!hit) throw new Error('no LICENSE file found in ' + pkg);
        cpSync(join(dir, hit), join(LICENSE_DIR, name));
        written.push(join('licenses', name).replace(/\\/g, '/'));
        copied.add(name);
      }
      const meta = pkgMeta(pkg);
      rows.push('- `' + pkg + '@' + meta.version + '` ('
        + licenseText(meta) + ') -> `' + name + '`');
    }
    sections.push('## ' + group.asset, '', ...rows, '');
  }
  /* a package that dropped out of the graph must not leave a stale notice
     behind claiming code that no longer ships */
  for (const f of readdirSync(LICENSE_DIR)) {
    if (f === 'README.md' || f === TRAY_NOTICE) continue;
    if (!copied.has(f)) rmSync(join(LICENSE_DIR, f));
  }
  const readme = [
    '# Vendored license notices',
    '',
    'Vendored prebuilt; rebuild with node scripts/build-viewer.mjs. Runtime code',
    'stays zero-dependency: these packages are compiled into assets/ and never',
    'installed at runtime.',
    '',
    'Every package whose code is compiled into a shipped bundle has a notice here,',
    'not just the direct dependencies: a bundle built here is derived from the',
    'esbuild metafile inputs, and a bundle vendored ALREADY BUILT from the',
    'dependency closure of the package it came from, which over-covers rather',
    'than under-covers. This file is generated; never hand-edit it.',
    '',
    'The tray executable is the one shipped artifact this file does not list crate',
    'by crate: assets/askerdo-tray.exe is built from the Rust crate in tray/',
    'and carries its own notice beside this one at licenses/askerdo-tray.txt,',
    'regenerated with node scripts/build-tray.mjs --licenses-only.',
    '',
    ...sections,
  ].join('\n');
  writeFileSync(join(LICENSE_DIR, 'README.md'), readme);
  written.push('licenses/README.md');
}

/* Every written text asset, scanned before anything else can stage it. A hit
   is fatal: the vendored bytes are never edited to dodge the scan. */
function selfScan() {
  const hits = [];
  const scanned = [];
  const skipped = [];
  for (const rel of written) {
    const buf = readFileSync(join(ASSETS, rel));
    /* a NUL-bearing asset decodes into nonsense rather than into findings, so
       it is skipped BY NAME below: an unscanned file must never be counted as
       a clean one */
    if (buf.includes(0)) { skipped.push(rel); continue; }
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
  for (const rel of skipped) {
    console.log('self-scan SKIPPED ' + rel + ': contains NUL bytes, not scanned as text');
  }
  console.log('self-scan clean: ' + scanned.length + ' of ' + written.length
    + ' files written by this run carry no CR bytes, en or em dashes, UUID shapes,'
    + ' or home paths' + (skipped.length ? ' (' + skipped.length + ' skipped, named above)' : ''));
  console.log('self-scan covers only what this run wrote; hand-authored assets such as'
    + ' house.css are not scanned by this run');
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
  /* the budget holds the viewer's client stack (roughly 310KB of
     markdown-it, DOMPurify, and highlight.js common);
     it is a NOTICE, not a gate, and it exists so an accidental doubling is
     seen rather than shipped */
  if (total > 1100 * 1024) console.log('WARNING: assets total is over 1100KB (roughly 960KB is the accepted budget)');
}

if (!existsSync(HLJS_ENTRY)) throw new Error('missing highlight.js entry: ' + HLJS_ENTRY);
main();
