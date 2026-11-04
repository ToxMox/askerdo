#!/usr/bin/env node
/* The icon checker.
 *
 * The marks are the icon package's delivered files, committed as
 * delivered (their provenance, their exact colours and their measured
 * validation live in assets/icons/README.md, manifest.json and
 * validation-report.json), and nothing here rebuilds them:
 * assets/icons/export.mjs documents how they were cut, needs a dependency this
 * repo will never install, and is never run.
 *
 * What CAN still drift is the committed file against what the package says it
 * is: a resize, a re-save through some tool, a frame dropped by a helpful
 * editor, an .ico quietly rewritten with PNG frames the exe's own parser
 * cannot read. So this reads the manifest and then reads the BYTES of every
 * committed icon, and pins:
 *
 *   - each .ico's frame count, each frame's pixel size, each frame's encoding
 *     (a classic 40 byte BITMAPINFOHEADER at 32 bits per pixel, or a PNG frame
 *     where the manifest says png, which is app.ico's 256 alone), and each
 *     frame's declared length against the end of the file, so a frame cut off
 *     after its header is a drift and not a pass;
 *   - each committed PNG's own width, height, bit depth and colour type;
 *   - every favicon SVG's viewBox, which is the 64 unit space the whole
 *     package is drawn in, that it carries no tile rect, and that it is drawn
 *     at the package's own tray fit (the mark alone, enlarged);
 *   - and the other direction: every .ico and .png committed under assets/ or
 *     assets/icons/ has to BE a manifest export, so a stray icon cannot sit
 *     there unpinned.
 *
 * It is stdlib only, it reads and it never writes, and it takes no time: one
 * pass over a handful of files. test/icons.test.mjs runs it as a function, so
 * a drift fails the suite rather than waiting for somebody to run a script.
 *
 *   node scripts/check-icons.mjs            # prints one line per file, or the
 *                                           # problems, and exits 1 on any
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, '..');

/* Where each name the manifest exports is committed. The tray faces, the app
   identity and the board's favicons are served or compiled in, so they sit in
   assets/ beside everything else the runtime reaches; the app-*.png family is
   the package's exports and is wired to nothing, so it sits with the
   package's own papers under assets/icons/. */
export function committedPath(root, name) {
  const under = /^app-\d+\.png$/.test(name) ? join('assets', 'icons') : 'assets';
  return join(root, under, name);
}

/* The two folders the package lands in, and the only two this checker walks:
   assets/ is what the runtime serves and compiles in, assets/icons/ is the
   package's own papers with the app-*.png family beside them. Not recursive:
   assets/licenses/ is text and nothing else under assets/ holds an icon. */
export const ICON_DIRS = ['assets', join('assets', 'icons')];

/* The three SVGs the board serves, and the one viewBox the package draws in. */
export const FAVICONS = ['favicon.svg', 'favicon-quiet.svg', 'favicon-blocking.svg'];
export const VIEWBOX = '0 0 64 64';

/* AND THEY WEAR NO TILE: the mark alone, enlarged
   to the canvas, as the tray faces and the app identity already were. The fit
   that replaced the tile is the PACKAGE'S own rather than one invented here,
   manifest.json's framing.tray16: the maximum uniform fit of the mark's
   painted bounds (10.55 5.15 59.95 56.75) into the 64 unit canvas, centred.
   Both halves are pinned because either alone would pass a half-done re-cut,
   the rects removed with the drawing left small, or the drawing enlarged with
   the tile still under it. */
export const FIT = 'matrix(1.2403100775193798 0 0 1.2403100775193798'
  + ' -11.720930232558144 -6.387596899224807)';

/* One .ico, read as the exe's own parser reads it (tray/src/icon.rs): an
   ICONDIR of 6 bytes, then one 16 byte entry per frame, each naming an offset
   at which a frame's bytes begin. A frame is classic when it opens with a 40
   byte BITMAPINFOHEADER and png when it opens with the PNG signature. */
export function readIco(bytes) {
  if (bytes.length < 6) return { error: 'shorter than an ICONDIR' };
  if (bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) {
    return { error: 'not an icon: the ICONDIR reserved word or type is wrong' };
  }
  const count = bytes.readUInt16LE(4);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    if (at + 16 > bytes.length) return { error: 'the directory runs past the file' };
    /* 0 in the byte means 256, which is how a 256 px frame is spelled */
    const declared = bytes[at] === 0 ? 256 : bytes[at];
    /* dwBytesInRes then dwImageOffset: the entry says how long its frame is as
       well as where it starts, and a frame cut off after its 40 byte header
       would read as a perfectly good frame without this. */
    const bytesInRes = bytes.readUInt32LE(at + 8);
    const offset = bytes.readUInt32LE(at + 12);
    if (offset + 8 > bytes.length) return { error: 'entry ' + i + ' points past the file' };
    if (offset + bytesInRes > bytes.length) {
      return {
        error: 'entry ' + i + ' declares ' + bytesInRes + ' bytes at ' + offset
          + ' and the file ends at ' + bytes.length + ': the frame is truncated',
      };
    }
    const png = bytes.subarray(offset, offset + 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (png) {
      const head = readPng(bytes.subarray(offset));
      frames.push({ size: declared, encoding: 'png', bits: head.depth, png: head });
      continue;
    }
    if (offset + 40 > bytes.length) return { error: 'entry ' + i + ' has no DIB header' };
    if (bytes.readUInt32LE(offset) !== 40) {
      return { error: 'entry ' + i + ' opens with neither a 40 byte DIB header nor a PNG' };
    }
    frames.push({
      size: bytes.readInt32LE(offset + 4),
      /* a classic icon DIB stores the colour rows and the AND mask as one
         bitmap of doubled height */
      declaredHeight: bytes.readInt32LE(offset + 8),
      encoding: 'dib',
      bits: bytes.readUInt16LE(offset + 14),
      compression: bytes.readUInt32LE(offset + 16),
      entrySize: declared,
    });
  }
  return { frames };
}

/* A PNG's IHDR, which is the first chunk and always at byte 8. */
export function readPng(bytes) {
  if (bytes.length < 26) return { error: 'shorter than an IHDR' };
  const sig = bytes.subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!sig) return { error: 'no PNG signature' };
  if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return { error: 'no IHDR first' };
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    depth: bytes[24],
    colour: bytes[25],
  };
}

/* The whole check, as a list of problems: empty is green. Every message names
   the file and what was expected, because a checker that only says "no" costs
   the next reader the same reading twice. */
export function check(root = REPO_ROOT) {
  const problems = [];
  const seen = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, 'assets', 'icons', 'manifest.json'), 'utf8'));
  } catch (e) {
    return { problems: ['assets/icons/manifest.json is not readable JSON: ' + e.message], seen };
  }
  if (!Array.isArray(manifest.exports) || !manifest.exports.length) {
    return { problems: ['assets/icons/manifest.json carries no exports'], seen };
  }

  for (const want of manifest.exports) {
    const path = committedPath(root, want.file);
    let bytes;
    try {
      bytes = readFileSync(path);
    } catch {
      problems.push(want.file + ' is named by the manifest and is not committed');
      continue;
    }
    if (want.type === 'ico') {
      const got = readIco(bytes);
      if (got.error) {
        problems.push(want.file + ': ' + got.error);
        continue;
      }
      const wantFrames = want.frames.map((f) => f.size + ':' + f.encoding).join(' ');
      const gotFrames = got.frames.map((f) => f.size + ':' + f.encoding).join(' ');
      if (wantFrames !== gotFrames) {
        problems.push(want.file + ' carries frames ' + gotFrames + ', manifest says ' + wantFrames);
      }
      for (const frame of got.frames) {
        if (frame.encoding === 'dib') {
          if (frame.bits !== 32) {
            problems.push(want.file + ' frame ' + frame.size + ' is ' + frame.bits
              + ' bits, not the 32 the exe parses');
          }
          if (frame.compression !== 0) {
            problems.push(want.file + ' frame ' + frame.size + ' is compressed, not BI_RGB');
          }
          if (frame.declaredHeight !== frame.size * 2) {
            problems.push(want.file + ' frame ' + frame.size
              + ' does not declare the doubled height a classic icon DIB has');
          }
          if (frame.entrySize !== frame.size) {
            problems.push(want.file + ' frame ' + frame.size
              + ' disagrees with its directory entry (' + frame.entrySize + ')');
          }
        } else if (frame.png && frame.png.width !== frame.size) {
          problems.push(want.file + ' PNG frame is ' + frame.png.width + ' px, entry says '
            + frame.size);
        }
      }
      seen.push(want.file + ' ' + gotFrames);
      continue;
    }
    if (want.type === 'png') {
      const got = readPng(bytes);
      if (got.error) {
        problems.push(want.file + ': ' + got.error);
        continue;
      }
      if (got.width !== want.size || got.height !== want.size) {
        problems.push(want.file + ' is ' + got.width + 'x' + got.height + ', manifest says '
          + want.size);
      }
      /* 8 bit channels and colour type 6, which is RGBA: a quantized or
         palettized re-save would lose the true alpha the package promises */
      if (got.depth !== 8 || got.colour !== 6) {
        problems.push(want.file + ' is bit depth ' + got.depth + ' colour type ' + got.colour
          + ', not 8 bit RGBA');
      }
      seen.push(want.file + ' ' + got.width + 'x' + got.height + ' rgba8');
      continue;
    }
    problems.push(want.file + ' has an export type this checker does not know: ' + want.type);
  }

  /* The loop above reads the files the manifest NAMES, which leaves the other
     direction open: an .ico or .png committed under assets/ that the manifest
     says nothing about would be served or compiled in with nothing pinning it
     (an old mark left behind, a re-cut frame saved beside the real one). So
     walk the two folders and require every icon in them to be a manifest
     export, landed where committedPath() puts it. */
  const named = new Map(manifest.exports.map((e) => [e.file, committedPath(root, e.file)]));
  for (const under of ICON_DIRS) {
    let entries;
    try {
      entries = readdirSync(join(root, under), { withFileTypes: true });
    } catch (e) {
      problems.push(under.replace(/\\/g, '/') + ' is not a readable folder: ' + e.message);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(ico|png)$/i.test(entry.name)) continue;
      const where = under.replace(/\\/g, '/') + '/' + entry.name;
      const want = named.get(entry.name);
      if (!want) {
        problems.push(where + ' is committed and the manifest does not name it');
      } else if (want !== join(root, under, entry.name)) {
        problems.push(where + ' is committed here, the manifest puts it in '
          + relative(root, want).replace(/\\/g, '/'));
      }
    }
  }

  /* The favicons are SVG and carry no manifest frames of their own: what is
     pinned is the 64 unit space every drawing in the package shares, and the
     re-cut that took the tile out of them. */
  for (const name of FAVICONS) {
    let text;
    try {
      text = readFileSync(join(root, 'assets', name), 'utf8');
    } catch {
      problems.push(name + ' is not committed');
      continue;
    }
    const found = /viewBox="([^"]*)"/.exec(text);
    if (!found) problems.push(name + ' carries no viewBox');
    else if (found[1] !== VIEWBOX) {
      problems.push(name + ' has viewBox "' + found[1] + '", not "' + VIEWBOX + '"');
    } else seen.push(name + ' viewBox ' + VIEWBOX);
    if (/<rect/.test(text)) {
      problems.push(name + ' carries a rect: the tile is back and the mark should stand alone');
    }
    if (!text.includes(FIT)) {
      problems.push(name + ' is not drawn at the package fit ' + FIT);
    }
  }

  return { problems, seen };
}

/* Run directly: say what was read, and fail loudly on anything that drifted. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { problems, seen } = check();
  for (const line of seen) console.log(line);
  for (const line of problems) console.error('DRIFT: ' + line);
  console.log(problems.length ? problems.length + ' problem(s)' : seen.length + ' files, all as delivered');
  process.exit(problems.length ? 1 : 0);
}
