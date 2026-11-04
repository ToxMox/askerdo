#!/usr/bin/env node
/* Check handoff folders for the depth-guard marker step.
   node scripts/check-handoff.mjs <handoff dir>... [--json]
   Exit 0 when every folder has the step everywhere, 1 when one misses it. */
import { checkHandoffDir } from '../lib/handoff-check.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const dirs = args.filter((a) => a !== '--json');
if (!dirs.length) {
  process.stderr.write('usage: node scripts/check-handoff.mjs <handoff dir>... [--json]\n');
  process.exit(2);
}
const results = dirs.map(checkHandoffDir);
if (json) process.stdout.write(JSON.stringify(results) + '\n');
else {
  for (const r of results) {
    process.stdout.write((r.ok ? 'PASS ' : 'FAIL ') + r.dir + '\n');
    for (const m of r.missing) process.stdout.write('  missing: ' + m + '\n');
    for (const w of r.warnings) process.stdout.write('  warning: ' + w + '\n');
  }
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
