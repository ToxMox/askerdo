#!/usr/bin/env node
/* The gate lives here rather than in permissions.deny so uninstalling the
 * plugin leaves no denial behind. */
import { loadConfig } from '../lib/node-helpers.mjs';

let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const cfg = loadConfig();
  if (cfg && cfg.dlg === 'ban') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'The AskerDo dialog policy is "banned": ask in reply text instead (a decision table when options exist). Change the policy with /askerdo:configure.',
      },
    }));
  }
  process.exit(0);
});
