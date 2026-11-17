#!/usr/bin/env node
/* Cuts the crescent faces from favicon-quiet.svg with only its top right ring swapped
 * for the ruled crescent (the logo itself never changes): asleep (nothing waits,
 * something is asleep) in moon yellow, and waiting-asleep (a question waits, another
 * is asleep) in the waiting dot's sky. Each face gets a favicon SVG, its 32 px raster
 * and a dark and a light tray icon. Rasters come from headless Edge at device scale 1
 * with a throwaway profile under .sandbox/; the PNG and ICO bytes are written here, so
 * a second run gives the same files.
 *
 *   node scripts/cut-asleep-icons.mjs            # writes the eight files
 *   node scripts/cut-asleep-icons.mjs --compare  # also renders the quiet faces and
 *                                                # prints their distance from the
 *                                                # committed tray-quiet icons
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(REPO, 'assets');
export const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
export const TRAY_SIZES = [16, 20, 24, 32, 48];

/* The crescent inks: the dark one is the ruled moon yellow; the light one is a
   darker gold of the same hue, so it holds on #F3F3F3 and stays off the amber. */
export const INK = { dark: '#FFE08A', light: '#9E7C00' };

/* waiting with something asleep wears the crescent in the waiting dot's own
   inks, the sky read from favicon.svg and the light waiting icon's (manifest colors). */
function waitingInk() {
  const dot = /<circle cx="50.6" cy="14.5" r="9.35" fill="(#[0-9A-F]{6})"\/>/i.exec(readFileSync(join(ASSETS, 'favicon.svg'), 'utf8'));
  if (!dot) throw new Error('favicon.svg has no waiting dot to read');
  const light = JSON.parse(readFileSync(join(ASSETS, 'icons', 'manifest.json'), 'utf8')).colors.waiting.light;
  return { dark: dot[1].toUpperCase(), light };
}
export const FACES = {
  asleep: { ink: () => INK, words: 'AskerDo, asleep',
    note: 'The asleep face: favicon-quiet.svg with its top right ring replaced by a moon\n     crescent in the same footprint.' },
  'waiting-asleep': { ink: waitingInk, words: 'AskerDo, waiting, something asleep',
    note: 'The waiting face with something asleep: favicon-quiet.svg with its top right ring\n     replaced by the asleep crescent in the waiting dot\'s sky, in the same footprint.' },
};

/* The light set's swaps, the package's own light tokens (manifest.json colors). */
const LIGHT = [['#3ACFFF', '#0077B8'], ['#9B91FF', '#7856CB'], ['#FF62C4', '#CE238E'],
  ['stroke="#FFF3DA"', 'stroke="#E8540B"'], ['stroke="#FF6AC8"', 'stroke="#DF1989"']];

const RING = /<circle cx="50.6" cy="14.5" r="6.5"[^>]*\/>/;
/* The dots' footprint (r 9.35 at 50.6, 14.5) bitten at the upper right, so the
   body sits lower left and the horns point up and right. */
const R = 9.35, CX = 50.6, CY = 14.5, BITE = [0.5, -0.42, 0.78];

function quietDrawing() {
  const text = readFileSync(join(ASSETS, 'favicon-quiet.svg'), 'utf8');
  return text.slice(text.indexOf('<svg'));
}

/* The quiet drawing recoloured for a light taskbar, which the tray-light faces wear. */
export function lighten(svg) {
  let out = svg;
  for (const [from, to] of LIGHT) out = out.split(from).join(to);
  return out;
}

export function asleepSvg(theme = 'dark', face = 'asleep') {
  const ink = FACES[face].ink()[theme];
  const mask = '<mask id="asleep-bite" maskUnits="userSpaceOnUse" x="0" y="0" width="80" height="80">'
    /* a path, not a rect: the checker reads any rect as the old tile come back */
    + '<path d="M0 0H80V80H0Z" fill="#fff"/><circle cx="' + (CX + R * BITE[0]).toFixed(2)
    + '" cy="' + (CY + R * BITE[1]).toFixed(2) + '" r="' + (R * BITE[2]).toFixed(2) + '" fill="#000"/></mask>';
  const moon = '<defs>' + mask + '</defs><circle cx="' + CX + '" cy="' + CY + '" r="' + R
    + '" fill="' + ink + '" mask="url(#asleep-bite)"/>';
  let svg = quietDrawing();
  if (!RING.test(svg)) throw new Error('favicon-quiet.svg has no ring to replace');
  const words = FACES[face].words;
  svg = svg.replace(RING, moon)
    .replace('aria-label="AskerDo"><title>AskerDo</title>', 'aria-label="' + words + '"><title>' + words + '</title>');
  return theme === 'light' ? lighten(svg) : svg;
}

/* One headless Edge for every render: each job is an SVG string and a pixel size,
   captured over a transparent background, decoded to straight RGBA. */
export async function render(jobs) {
  const sandbox = join(REPO, '.sandbox');
  mkdirSync(sandbox, { recursive: true });
  const prof = mkdtempSync(join(sandbox, 'edge-icons-'));
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--remote-debugging-port=0', '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws;
  try {
    let port = null;
    for (let i = 0; i < 150 && !port; i++) {
      await sleep(100);
      const f = join(prof, 'DevToolsActivePort');
      if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0].trim();
    }
    if (!port) throw new Error('Edge gave no debugging port');
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    ws = new WebSocket(targets.find((x) => x.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let id = 0;
    const waiting = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise((r) => {
      const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params }));
    });
    await send('Page.enable');
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const out = [];
    /* a job may bring its own page (html, width, height) instead: the look check's sheet */
    for (const job of jobs) {
      const w = job.width || job.size, h = job.height || job.size;
      await send('Emulation.setDeviceMetricsOverride', { width: Math.max(w, 64), height: Math.max(h, 64), deviceScaleFactor: 1, mobile: false });
      const html = job.html || '<!doctype html><html><head><style>html,body{margin:0;background:transparent}'
        + 'img{display:block;width:' + w + 'px;height:' + h + 'px}</style></head><body>'
        + '<img src="data:image/svg+xml;base64,' + Buffer.from(job.svg).toString('base64') + '"></body></html>';
      const loaded = new Promise((r) => {
        const on = (e) => { if (JSON.parse(e.data).method === 'Page.loadEventFired') { ws.removeEventListener('message', on); r(); } };
        ws.addEventListener('message', on);
      });
      await send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
      await loaded;
      await sleep(150);
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
      const bytes = Buffer.from(shot.result.data, 'base64');
      if (job.html) { out.push(bytes); continue; }
      const png = decodePng(bytes);
      if (png.width !== w || png.height !== h) throw new Error('capture is ' + png.width + 'x' + png.height + ', wanted ' + w);
      out.push(png.rgba);
    }
    return out;
  } finally {
    try { ws?.close(); } catch {}
    /* Browser.close ends Edge's child processes too; killing the parent alone leaves them */
    const exited = new Promise((r) => edge.once('exit', r));
    try {
      const port = readFileSync(join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
      const url = (await (await fetch('http://127.0.0.1:' + port + '/json/version')).json()).webSocketDebuggerUrl;
      const b = new WebSocket(url);
      await new Promise((r) => b.addEventListener('open', r, { once: true }));
      b.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    } catch {
      edge.kill();
    }
    await Promise.race([exited, sleep(5000)]);
    for (let i = 0; i < 20; i++) {
      try { rmSync(prof, { recursive: true, force: true }); break; } catch { await sleep(250); }
    }
  }
}

/* PNG in: 8 bit RGB or RGBA, any filter; out: straight RGBA. */
export function decodePng(bytes) {
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  const depth = bytes[24], colour = bytes[25];
  if (depth !== 8 || (colour !== 6 && colour !== 2)) throw new Error('PNG is depth ' + depth + ' colour ' + colour);
  const idat = [];
  for (let pos = 8; pos + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(pos);
    const kind = bytes.subarray(pos + 4, pos + 8).toString('latin1');
    if (kind === 'IDAT') idat.push(bytes.subarray(pos + 8, pos + 8 + length));
    pos += 12 + length;
    if (kind === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colour === 6 ? 4 : 3, stride = width * bpp;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = raw[y * (stride + 1) + 1 + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error('filter ' + filter);
      px[y * stride + x] = v & 0xff;
    }
  }
  if (bpp === 4) return { width, height, rgba: px };
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) px.copy(rgba, i * 4, i * 3, i * 3 + 3);
  return { width, height, rgba };
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function chunk(kind, data) {
  const body = Buffer.concat([Buffer.from(kind, 'latin1'), data]);
  let c = -1;
  for (const byte of body) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE((c ^ -1) >>> 0, 8 + data.length);
  return out;
}

/* 8 bit RGBA, filter 0, no metadata: the same pixels always give the same bytes. */
export function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4);
  head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* The tray's classic form (tray/src/icon.rs reads only this): bottom-up straight
   BGRA, the 40 byte header at doubled height, and a 1 bit AND mask set at alpha 0. */
export function encodeIco(frames) {
  const parts = frames.map(({ size, rgba }) => {
    const maskStride = Math.ceil(size / 32) * 4;
    const colour = Buffer.alloc(size * size * 4), mask = Buffer.alloc(maskStride * size);
    for (let y = 0; y < size; y++) {
      const row = size - 1 - y;
      for (let x = 0; x < size; x++) {
        const s = (y * size + x) * 4, d = (row * size + x) * 4, a = rgba[s + 3];
        if (a === 0) { mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7); continue; }
        colour[d] = rgba[s + 2]; colour[d + 1] = rgba[s + 1]; colour[d + 2] = rgba[s]; colour[d + 3] = a;
      }
    }
    const head = Buffer.alloc(40);
    head.writeUInt32LE(40, 0); head.writeInt32LE(size, 4); head.writeInt32LE(size * 2, 8);
    head.writeUInt16LE(1, 12); head.writeUInt16LE(32, 14); head.writeUInt32LE(colour.length + mask.length, 20);
    return Buffer.concat([head, colour, mask]);
  });
  const dir = Buffer.alloc(6 + 16 * frames.length);
  dir.writeUInt16LE(1, 2); dir.writeUInt16LE(frames.length, 4);
  let offset = dir.length;
  frames.forEach(({ size }, i) => {
    const at = 6 + 16 * i;
    dir[at] = size; dir[at + 1] = size;
    dir.writeUInt16LE(1, at + 4); dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(parts[i].length, at + 8); dir.writeUInt32LE(offset, at + 12);
    offset += parts[i].length;
  });
  return Buffer.concat([dir, ...parts]);
}

/* An ICO's DIB frames back to top-down straight RGBA, for the compare and the look check. */
export function icoFrames(bytes) {
  const out = [];
  for (let i = 0; i < bytes.readUInt16LE(4); i++) {
    const o = bytes.readUInt32LE(6 + 16 * i + 12), size = bytes.readInt32LE(o + 4);
    const rgba = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = o + 40 + ((size - 1 - y) * size + x) * 4, d = (y * size + x) * 4;
        rgba[d] = bytes[s + 2]; rgba[d + 1] = bytes[s + 1]; rgba[d + 2] = bytes[s]; rgba[d + 3] = bytes[s + 3];
      }
    }
    out.push({ size, rgba });
  }
  return out;
}

async function main() {
  const names = Object.keys(FACES), n = TRAY_SIZES.length, per = 1 + 2 * n;
  const jobs = [];
  for (const face of names) {
    const dark = asleepSvg('dark', face), light = asleepSvg('light', face);
    jobs.push({ svg: dark, size: 32 }, ...TRAY_SIZES.map((size) => ({ svg: dark, size })),
      ...TRAY_SIZES.map((size) => ({ svg: light, size })));
  }
  const compare = process.argv.includes('--compare');
  const quiet = quietDrawing();
  if (compare) {
    for (const svg of [quiet, lighten(quiet)]) for (const size of TRAY_SIZES) jobs.push({ svg, size });
  }
  const shots = await render(jobs);
  const wrote = [];
  names.forEach((face, k) => {
    const at = k * per;
    const header = '<!-- ' + FACES[face].note + ' Cut by scripts/cut-asleep-icons.mjs; never hand-edited. -->\n';
    const frames = (from) => TRAY_SIZES.map((size, i) => ({ size, rgba: shots[from + i] }));
    const files = ['favicon-' + face + '.svg', 'favicon-' + face + '-32.png', 'tray-' + face + '.ico', 'tray-light-' + face + '.ico'];
    writeFileSync(join(ASSETS, files[0]), header + asleepSvg('dark', face));
    writeFileSync(join(ASSETS, files[1]), encodePng(32, shots[at]));
    writeFileSync(join(ASSETS, files[2]), encodeIco(frames(at + 1)));
    writeFileSync(join(ASSETS, files[3]), encodeIco(frames(at + 1 + n)));
    wrote.push(...files);
  });
  console.log('wrote ' + wrote.join(', '));
  if (compare) {
    for (const [k, name] of [[0, 'tray-quiet.ico'], [1, 'tray-light-quiet.ico']]) {
      const committed = icoFrames(readFileSync(join(ASSETS, name)));
      const line = TRAY_SIZES.map((size, i) => {
        const a = committed[i].rgba, b = shots[names.length * per + k * n + i];
        let max = 0, sum = 0;
        for (let j = 0; j < a.length; j++) { const d = Math.abs(a[j] - b[j]); max = Math.max(max, d); sum += d; }
        return size + ' px max ' + max + ' mean ' + (sum / a.length).toFixed(2);
      });
      console.log(name + ' against an Edge render of the same drawing: ' + line.join(', '));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
