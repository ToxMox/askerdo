/* The icon package as the repo committed it. scripts/check-icons.mjs
 * reads the committed bytes rather than repainting the art, and it runs HERE as
 * a function so a drift fails the suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { check, committedPath, readIco, readPng, FAVICONS, FIT, VIEWBOX } from '../scripts/check-icons.mjs';
import { pluginRoot } from '../lib/node-helpers.mjs';
import { ASSETS } from '../lib/board-assets.mjs';
import { tempDir } from './helpers/sandbox.mjs';

test('the checker is green over every committed icon, and names what it read', () => {
  const { problems, seen } = check(pluginRoot);
  assert.deepEqual(problems, []);
  /* fifteen exports in the manifest plus the three favicon SVGs */
  assert.equal(seen.length, 18);
  for (const line of ['tray-waiting.ico 16:dib 20:dib 24:dib 32:dib 48:dib',
    'tray-light-blocking.ico 16:dib 20:dib 24:dib 32:dib 48:dib',
    'app.ico 16:dib 24:dib 32:dib 48:dib 64:dib 128:dib 256:png',
    'favicon-32.png 32x32 rgba8',
    'favicon.svg viewBox ' + VIEWBOX]) {
    assert.ok(seen.includes(line), line);
  }
});

/* THE DRIFT CASE, driven through check() rather than its readers, which would leave
   every compare inside check() unpinned. The real assets/ is read and never written;
   the doctoring is on a sandbox COPY. */
test('the checker is green over a faithful copy and names every drift in a doctored one', () => {
  const clean = plant(tempDir('nd-icon-drift-'));
  assert.deepEqual(check(clean).problems, [], 'a faithful copy drifts in nothing');

  const bad = plant(tempDir('nd-icon-drift-'));

  /* a frame dropped: the ICONDIR says four where the manifest wants five */
  const dropped = readFileSync(join(bad, 'assets', 'tray-waiting.ico'));
  dropped.writeUInt16LE(4, 4);
  writeFileSync(join(bad, 'assets', 'tray-waiting.ico'), dropped);

  /* the wrong drawing under the right name: a 48 px app raster saved as the
     32 px favicon, which no name or extension would ever show */
  copyFileSync(join(bad, 'assets', 'icons', 'app-48.png'), join(bad, 'assets', 'favicon-32.png'));

  /* a frame cut off after its header: the entry still declares its length, and
     that is the only thing that catches this */
  const cut = readFileSync(join(bad, 'assets', 'tray-quiet.ico'));
  let last = 0;
  for (let i = 0; i < cut.readUInt16LE(4); i++) last = Math.max(last, cut.readUInt32LE(6 + i * 16 + 12));
  writeFileSync(join(bad, 'assets', 'tray-quiet.ico'), cut.subarray(0, last + 40));

  /* a stray the manifest says nothing about, which the export loop alone would
     never look at */
  copyFileSync(join(bad, 'assets', 'app.ico'), join(bad, 'assets', 'app-old.ico'));

  const { problems } = check(bad);
  const named = (re) => problems.filter((p) => re.test(p));
  assert.equal(named(/^tray-waiting\.ico carries frames .* manifest says /).length, 1, problems);
  assert.equal(named(/^favicon-32\.png is 48x48, manifest says 32$/).length, 1, problems);
  assert.equal(named(/^tray-quiet\.ico: entry \d+ declares .* truncated$/).length, 1, problems);
  assert.equal(named(/^assets\/app-old\.ico is committed and the manifest does not name it$/).length,
    1, problems);
  assert.equal(problems.length, 4, problems);
});

test('the checker refuses a tree it cannot read, and its readers refuse a non-icon', () => {
  /* not an icon at all */
  assert.match(readIco(Buffer.from('not an icon at all')).error, /not an icon/);
  assert.match(readIco(Buffer.alloc(3)).error, /ICONDIR/);
  assert.match(readPng(Buffer.alloc(64)).error, /signature/);

  /* and a checker pointed at a tree with no manifest says so rather than
     passing on an empty list */
  const empty = check(join(pluginRoot, 'test'));
  assert.equal(empty.problems.length, 1);
  assert.match(empty.problems[0], /manifest\.json is not readable JSON/);
});

/* A copy of the icon package under a sandbox root: the manifest, every file it
   exports where committedPath() puts it, and the three favicon SVGs. Nothing
   else of the repo is copied, because nothing else is what the checker reads. */
function plant(root) {
  mkdirSync(join(root, 'assets', 'icons'), { recursive: true });
  const manifestAt = join('assets', 'icons', 'manifest.json');
  copyFileSync(join(pluginRoot, manifestAt), join(root, manifestAt));
  const manifest = JSON.parse(readFileSync(join(root, manifestAt), 'utf8'));
  for (const want of manifest.exports) {
    copyFileSync(committedPath(pluginRoot, want.file), committedPath(root, want.file));
  }
  for (const name of FAVICONS) {
    copyFileSync(join(pluginRoot, 'assets', name), join(root, 'assets', name));
  }
  return root;
}

test('the package rides in the repo with its provenance, and its exporter never runs', () => {
  const papers = ['README.md', 'manifest.json', 'validation-report.json', 'export.mjs',
    'package.json'];
  for (const name of papers) {
    assert.ok(existsSync(join(pluginRoot, 'assets', 'icons', name)), 'assets/icons/' + name);
  }
  const readme = readFileSync(join(pluginRoot, 'assets', 'icons', 'README.md'), 'utf8');
  assert.match(readme, /^Provenance: /, 'the one line head that says where the files came from');
  assert.match(readme, /never run here/);
  /* the colours the package fixed, in the repo rather than in a chat log */
  for (const hex of ['#FFF3DA', '#E8540B', '#FF6AC8', '#FFB300', '#E68A00']) {
    assert.ok(readme.includes(hex), hex);
  }

  /* THE EXPORTER IS DOCUMENTATION. It is not imported by anything, it is not
     wired into any script, and the dependency it names is never installed. */
  const roots = ['lib', 'hooks', 'bin', 'scripts', 'test'];
  for (const dir of roots) {
    const hits = [];
    for (const file of walk(join(pluginRoot, dir))) {
      /* over CODE with comments stripped: check-icons.mjs names the exporter
         in its header on purpose, to say that it is documentation */
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      /* a REACH is an import or a spawn of it, not a mention: the 404 case in
         test/board-server.test.mjs names the file exactly to prove no route
         serves it */
      if (/\b(import|require|execFile|execFileSync|spawn|spawnSync)\b[^\n]*icons\/(export\.mjs|package\.json)/
        .test(code)) hits.push(file);
    }
    assert.deepEqual(hits, [], dir + ' reaches into the exporter');
  }
  assert.equal(existsSync(join(pluginRoot, 'assets', 'icons', 'node_modules')), false);

  /* no committed file of the package names a person or a home directory */
  for (const name of papers) {
    const text = readFileSync(join(pluginRoot, 'assets', 'icons', name), 'utf8');
    assert.ok(!/[A-Za-z]:\\Users|[A-Za-z]:\/Users|\/home\//.test(text), name + ' names a home path');
    assert.ok(!/[\r\u2013\u2014]/.test(text), name + ' is LF and plain hyphens');
  }
});

/* THE RESOURCE ICON, read out of the COMMITTED EXE rather than the build
   script: winresource writes each frame's payload verbatim, so a frame of
   app.ico appearing whole in the exe is the resource being there. */
test('the built exe carries app.ico as its resource icon', () => {
  const exe = readFileSync(join(pluginRoot, 'assets', 'askerdo-tray.exe'));
  const app = readFileSync(join(pluginRoot, 'assets', 'app.ico'));
  const count = app.readUInt16LE(4);
  const found = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    const size = app.readUInt32LE(at + 8);
    const offset = app.readUInt32LE(at + 12);
    const frame = app.subarray(offset, offset + size);
    if (exe.includes(frame)) found.push(app[at] === 0 ? 256 : app[at]);
  }
  assert.deepEqual(found, [16, 24, 32, 48, 64, 128, 256],
    'every frame of app.ico rides in the exe as a resource');
});

/* THE APP IDENTITY IS THE TRAY DRAWING, ENLARGED, WITH NO TILE:
   app.ico's small frames are the package's own dark quiet tray frames copied
   byte for byte, so a re-cut cannot drift them silently. */
test('app.ico wears the tray drawing at 16 to 48, byte for byte, and no tile above it', () => {
  const frames = (name) => {
    const bytes = readFileSync(join(pluginRoot, 'assets', name));
    const out = new Map();
    for (let i = 0; i < bytes.readUInt16LE(4); i++) {
      const at = 6 + i * 16;
      const size = bytes[at] === 0 ? 256 : bytes[at];
      const offset = bytes.readUInt32LE(at + 12);
      out.set(size, bytes.subarray(offset, offset + bytes.readUInt32LE(at + 8)));
    }
    return out;
  };
  const app = frames('app.ico');
  const tray = frames('tray-quiet.ico');
  for (const size of [16, 24, 32, 48]) {
    assert.ok(app.get(size).equals(tray.get(size)), size + ' px is not the tray face');
  }
  /* and the drawing above them is the same drawing: a tile would fill its frame edge
     to edge while the mark alone covers a third of it, read off the 32 px frame's
     alpha */
  const dib = app.get(32);
  let painted = 0;
  for (let i = 0; i < 32 * 32; i++) if (dib[40 + i * 4 + 3] !== 0) painted += 1;
  assert.equal(painted, 538, 'the 32 px frame paints the mark alone');
  assert.ok(painted < 700, 'a tiled frame would paint nearly all 1024');

  /* the SVG the 64, 128 and 256 frames were rendered from rides in the repo
     and carries no tile */
  const svg = readFileSync(join(pluginRoot, 'assets', 'icons', 'app-mark-dark.svg'), 'utf8');
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.equal(/<rect/.test(svg), false, 'the tile rects are gone');
  for (const hex of ['#FFF3DA', '#FF6AC8']) assert.ok(svg.includes(hex), hex);
  assert.ok(!/[\r\u2013\u2014]/.test(svg), 'LF and plain hyphens');
});

/* AND SO DOES THE BOARD'S TAB: the three faces are the
   mark alone, and the quiet face's drawing is assets/icons/app-mark-dark.svg's
   body byte for byte. */
test('the three favicons are the mark alone, at the fit the app identity wears', () => {
  const read = (name) => readFileSync(join(pluginRoot, 'assets', name), 'utf8');
  const faces = FAVICONS.map(read);
  for (let i = 0; i < faces.length; i++) {
    const svg = faces[i];
    assert.equal(/<rect/.test(svg), false, FAVICONS[i] + ' still carries a tile rect');
    assert.ok(svg.includes(FIT), FAVICONS[i] + ' is not drawn at the package fit');
    assert.ok(!/[\r\u2013\u2014]/.test(svg), FAVICONS[i] + ' is LF and plain hyphens');
    /* the check the package draws on dark, as delivered */
    assert.ok(svg.includes('stroke="#FFF3DA" stroke-width="6"'), FAVICONS[i] + ' lost the check');
  }

  /* the three markers, which are the only thing that tells the faces apart */
  const [waiting, quiet, blocking] = faces;
  assert.ok(waiting.includes('<circle cx="50.6" cy="14.5" r="9.35" fill="#39C9FF"/>'));
  assert.ok(blocking.includes('<circle cx="50.6" cy="14.5" r="9.35" fill="#FFB300"/>'));
  assert.ok(quiet.includes('<circle cx="50.6" cy="14.5" r="6.5" stroke="#FF6AC8"'
    + ' stroke-width="5.7" fill="none"'), 'the quiet face draws a hollow ring');

  /* ONE DRAWING, and this is the assert that says so. The served faces carry the
     product's accessible name and the delivered package does not, so the name is
     normalized out and the rest still matches. */
  const body = (text) => text.slice(text.indexOf('<svg'));
  const unnamed = (text) => text.replace(/aria-label="[^"]*"/, 'aria-label="X"')
    .replace(/<title>[^<]*<\/title>/, '<title>X</title>');
  const mark = read(join('icons', 'app-mark-dark.svg'));
  assert.equal(unnamed(body(quiet)), unnamed(body(mark)), 'the quiet tab face is not the app identity drawing');
  assert.ok(body(quiet).includes('aria-label="AskerDo"><title>AskerDo</title>'),
    'the served face is named for the product');
  assert.ok(body(mark).includes('aria-label="t.ask&amp;ding"'),
    'the delivered package keeps the name it shipped with');
});

/* THE RASTERS CARRY NO TILE EITHER: the register serves three 32 px PNGs beside the
   SVGs, so the alpha is read out of the committed bytes rather than trusted (a tiled
   32 px face paints nearly all of its 1024 pixels). */
test('the 32 px favicon rasters are the tile-less drawing, edge to edge', () => {
  const want = { 'favicon-32.png': 546, 'favicon-quiet-32.png': 534, 'favicon-blocking-32.png': 546 };
  for (const name of Object.keys(want)) {
    const { width, height, rgba } = decodeRgba(readFileSync(join(pluginRoot, 'assets', name)));
    assert.deepEqual([width, height], [32, 32], name);
    const at = (x, y) => rgba[(y * width + x) * 4 + 3];
    let painted = 0;
    for (let i = 0; i < width * height; i++) if (rgba[i * 4 + 3] !== 0) painted += 1;
    assert.equal(painted, want[name], name + ' paints the mark alone');
    assert.ok(painted < 700, name + ': a tiled face would paint nearly all 1024');
    /* every edge is reached, top and bottom by the fit and the sides by the
       widest part of the drawing, so nothing is floating in padding */
    const row = (y) => { for (let x = 0; x < width; x++) if (at(x, y)) return true; return false; };
    const col = (x) => { for (let y = 0; y < height; y++) if (at(x, y)) return true; return false; };
    for (const [edge, hit] of [['top', row(0)], ['bottom', row(31)], ['left', col(0)],
      ['right', col(31)]]) {
      assert.ok(hit, name + ' does not reach its ' + edge + ' edge');
    }
  }
});

/* AND THE FIVE APP RASTERS: the checker's readPng() sees the IHDR alone and cannot
   tell a tile from a mark, so the committed ALPHA is what is read here. */
test('the five app rasters are the tile-less drawing, filling the canvas', () => {
  /* size: opaque pixels, first painted column, last painted column */
  const want = {
    48: [1089, 1, 46],
    64: [1879, 1, 62],
    96: [3926, 2, 93],
    128: [6904, 2, 125],
    256: [26627, 5, 250],
  };
  for (const size of Object.keys(want).map(Number)) {
    const name = 'app-' + size + '.png';
    const { width, height, rgba } = decodeRgba(readFileSync(committedPath(pluginRoot, name)));
    assert.deepEqual([width, height], [size, size], name);
    const at = (x, y) => rgba[(y * width + x) * 4 + 3];
    let painted = 0;
    for (let i = 0; i < width * height; i++) if (rgba[i * 4 + 3] !== 0) painted += 1;
    const [pixels, first, last] = want[size];
    assert.equal(painted, pixels, name + ' paints the mark alone');
    assert.ok(painted * 2 < width * height,
      name + ': a tiled render painted nearly the whole square');
    const row = (y) => { for (let x = 0; x < width; x++) if (at(x, y)) return true; return false; };
    const col = (x) => { for (let y = 0; y < height; y++) if (at(x, y)) return true; return false; };
    assert.ok(row(0), name + ' does not reach its top edge');
    assert.ok(row(height - 1), name + ' does not reach its bottom edge');
    let left = 0;
    while (left < width && !col(left)) left += 1;
    let right = width - 1;
    while (right > left && !col(right)) right -= 1;
    assert.deepEqual([left, right], [first, last], name + ' is not drawn at the package fit');
  }
});

/* THE BIGGEST ONE IS NOT A SECOND RENDER: app-256.png is app.ico's 256 frame
   lifted byte for byte, so it cannot drift the way a fresh capture would, and
   it fails the moment either file is re-cut alone. */
test('app-256.png is the 256 frame of app.ico, byte for byte', () => {
  const ico = readFileSync(join(pluginRoot, 'assets', 'app.ico'));
  const read = readIco(ico);
  assert.equal(read.error, undefined, 'app.ico parses');
  const biggest = read.frames.at(-1);
  assert.deepEqual([biggest.size, biggest.encoding], [256, 'png'], 'the 256 frame is a PNG');
  let frame;
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const entry = 6 + i * 16;
    if ((ico[entry] === 0 ? 256 : ico[entry]) !== 256) continue;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    frame = ico.subarray(offset, offset + length);
  }
  assert.ok(frame, 'app.ico carries a 256 entry');
  const raster = readFileSync(committedPath(pluginRoot, 'app-256.png'));
  assert.ok(frame.equals(raster), 'app-256.png and app.ico 256 are not the same PNG');
});

/* An 8 bit RGBA PNG to its pixels with node's own zlib: the repo installs no
   image dependency and the checker's readPng() reads the IHDR alone, which
   cannot answer 'is the tile gone'. */
function decodeRgba(bytes) {
  const head = readPng(bytes);
  assert.equal(head.error, undefined, 'a PNG');
  assert.deepEqual([head.depth, head.colour], [8, 6], '8 bit RGBA');
  const idat = [];
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(pos);
    const kind = bytes.subarray(pos + 4, pos + 8).toString('latin1');
    if (kind === 'IDAT') idat.push(bytes.subarray(pos + 8, pos + 8 + length));
    pos += 12 + length;
    if (kind === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = head;
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error('filter ' + filter);
      rgba[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, rgba };
}

test('the register serves the three favicon SVGs and their rasters, and nothing else new', () => {
  for (const name of FAVICONS) assert.ok(ASSETS[name], name);
  for (const name of ['favicon-32.png', 'favicon-quiet-32.png', 'favicon-blocking-32.png']) {
    assert.equal(ASSETS[name], 'image/png', name);
    assert.ok(existsSync(join(pluginRoot, 'assets', name)), name);
  }
  /* the app identity's PNGs are art and are NOT served: they live
     under assets/icons/ and the register does not carry them */
  for (const name of ['app-48.png', 'app-64.png', 'app-96.png', 'app-128.png', 'app-256.png']) {
    assert.equal(ASSETS[name], undefined, name);
    assert.equal(committedPath(pluginRoot, name), join(pluginRoot, 'assets', 'icons', name));
    assert.ok(existsSync(committedPath(pluginRoot, name)), name);
  }
  assert.equal(ASSETS['app.ico'], undefined, 'the identity mark is not a page asset');
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}
