/* Timing logs and the check log: every tier writes one JSON
   line per call ({ at, tier, verb, ms, status }) and these read them back. */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];

/* p50 and p95 per tier and verb, from a log and its rotated copy. */
export function timingSummary(file) {
  const by = new Map();
  for (const f of [file + '.1', file]) {
    if (!file || !existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      const ms = Number(r.ms);
      if (!Number.isFinite(ms)) continue;
      const k = (r.tier || 'server') + ' ' + r.verb;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(ms);
    }
  }
  return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([k, ms]) => {
    ms.sort((a, b) => a - b);
    return { verb: k, calls: ms.length, p50: pct(ms, 50), p95: pct(ms, 95) };
  });
}

export const timingRow = (r) => r.verb.padEnd(34) + String(r.calls).padStart(7) + ' calls  p50 ' + r.p50.toFixed(2) + ' ms  p95 ' + r.p95.toFixed(2) + ' ms';

/* The weekly check's result kept on the server, one line per run. */
export function logCheck(file, r) {
  if (!file) return;
  try { appendFileSync(file, JSON.stringify(r) + '\n'); } catch { /* the check's own result still prints */ }
}

export function lastCheck(file) {
  if (!file || !existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) { try { return JSON.parse(lines[i]); } catch { /* a torn line */ } }
  return null;
}
