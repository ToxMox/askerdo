/* The handoff folder check: names a missing
   depth-guard marker step, so a session without its marker is detectable
   instead of looking shallow. Budgets and long lines are warnings only. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { folderHere } from './project-map.mjs';

export const HANDOFF_FILES = ['README.md', 'now.md', 'rules.md', 'map.md'];
const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'handoff');

/* The marker step, either form: the marker file itself, or a verify-first.ps1
   run with -SessionId, which writes it. */
export const MARKER_RE = /depth-guard(?:\.json|\s+marker)|verify-first\.ps1[^\n]*-SessionId/i;
const LINE_MAX = 400;
const FENCE = /^\s*(```|~~~)/;

/* The ## sections; a heading inside a fenced block is text. */
function splitSections(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let fenced = false;
  let cur = null;
  const sections = [];
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced && line.startsWith('## ')) {
      cur = { heading: line.slice(3).trim(), lines: [] };
      sections.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  return { sections };
}

const section = (text, re) => {
  const s = splitSections(text).sections.find((x) => re.test(x.heading));
  return s ? s.lines.join('\n') : null;
};

/* Budgets from README's "Keeping it lean" table: |file|6 KB|...| rows. */
export function budgetsOf(readme) {
  const out = {};
  for (const m of String(readme || '').matchAll(/^\|([\w.-]+\.md)\|\s*(\d+(?:\.\d+)?)\s*KB\s*\|/gim)) {
    out[m[1]] = Math.round(Number(m[2]) * 1024);
  }
  return out;
}

/* files: { 'README.md': text, 'now.md': text, ... } (absent files left out).
   `onThread`: the handoffs live on a thread, so now.md and the README's
   marker steps are not the protocol and are not asked for. */
export function checkHandoffFiles(files, { onThread = false } = {}) {
  const missing = [];
  const warnings = [];
  const readme = files['README.md'];
  const now = files['now.md'];
  if (onThread) { /* rules.md and map.md only: their budgets and long lines below */ }
  else if (readme === undefined) missing.push('README.md is missing');
  else {
    const resume = section(readme, /^resume\b/i);
    if (resume === null) missing.push('README.md has no Resume section, so no marker step');
    else if (!MARKER_RE.test(resume)) missing.push('README.md Resume has no depth-guard marker step');
    const writing = section(readme, /^writing a handoff\b/i);
    if (writing !== null && !MARKER_RE.test(writing)) {
      missing.push('README.md "Writing a handoff" does not say to keep the marker step');
    }
  }
  if (onThread) { /* now.md, if any, is a pointer to the thread */ }
  else if (now === undefined) missing.push('now.md is missing');
  else {
    const verify = section(now, /^verify first\b/i);
    if (verify === null) missing.push('now.md has no Verify first section, so no marker check');
    else if (!MARKER_RE.test(verify)) missing.push('now.md Verify first has no depth-guard marker step');
  }
  const budgets = budgetsOf(readme);
  for (const [name, text] of Object.entries(files)) {
    if (onThread && (name === 'README.md' || name === 'now.md')) continue;
    const size = Buffer.byteLength(text, 'utf8');
    if (budgets[name] !== undefined && size > budgets[name]) {
      warnings.push(name + ' is ' + size + ' bytes; its budget is ' + budgets[name]);
    }
    const long = text.split('\n').filter((l) => l.length > LINE_MAX).length;
    if (long) warnings.push(name + ' has ' + long + ' line' + (long === 1 ? '' : 's') + ' over ' + LINE_MAX + ' characters');
  }
  return { ok: missing.length === 0, missing, warnings };
}

export function checkHandoffDir(dir, opts = {}) {
  const files = {};
  for (const name of HANDOFF_FILES) {
    const p = join(dir, name);
    if (existsSync(p)) files[name] = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  }
  return { dir, ...checkHandoffFiles(files, opts), present: Object.keys(files) };
}

/* A workstream's handoff folder on this PC through the project map (
   server/verbs/kickoff.mjs handoffAtOf), or null. A relative one sits in its
   first project's folder here; `unmapped` names a project this PC has no folder for. */
export function handoffDirOf(ws, { cwd, dir } = {}) {
  const h = ws && typeof ws.handoff === 'string' ? ws.handoff.trim() : '';
  if (!h) return { dir: null };
  if (isAbsolute(h) || /^[A-Za-z]:\//.test(h)) return { dir: h };
  const first = (k) => (Array.isArray(ws[k]) ? ws[k].find((p) => typeof p === 'string' && p.trim()) : null);
  const name = first('projectRepos');
  const base = name ? folderHere(name, { cwd, dir }) : first('projects');
  if (!base) return { dir: null, ...(name ? { unmapped: name } : {}) };
  return { dir: join(base, h).replace(/\\/g, '/') };
}

/* a folder that does not exist yet gets the template's four files, placeholders filled. */
export function seedHandoffDir(dir, ws) {
  if (!dir || existsSync(dir)) return false;
  mkdirSync(dir, { recursive: true });
  const fill = (t) => t.replaceAll('<WS-n>', () => ws.id).replaceAll('<Name>', () => ws.name).replaceAll('<handoff dir>', () => dir);
  for (const name of HANDOFF_FILES) writeFileSync(join(dir, name), fill(readFileSync(join(TEMPLATE, name), 'utf8')));
  return true;
}
