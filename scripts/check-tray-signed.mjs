/* Refuses a release whose committed tray exe is unsigned: the maintainer
 * signs assets/askerdo-tray.exe after every rebuild, before the release commit.
 * Passes only on an Authenticode status of Valid, and only when the exe on disk
 * is the committed one, so a signature made after the commit is not counted.
 *
 * Usage: node scripts/check-tray-signed.mjs
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pluginRoot } from '../lib/node-helpers.mjs';

const REL = 'assets/askerdo-tray.exe';
const exe = join(pluginRoot, REL);

function refuse(why) {
  console.error('check-tray-signed: ' + why);
  process.exit(1);
}

if (process.platform !== 'win32') refuse('Authenticode is read on Windows only');

const dirty = execFileSync('git', ['-C', pluginRoot, 'status', '--porcelain', '--', REL], { encoding: 'utf8' }).trim();
if (dirty) refuse(REL + ' differs from the committed one: commit the signed exe, then check again');

/* Windows PowerShell when pwsh 7 is not installed: both carry the cmdlet */
function status() {
  const command = "(Get-AuthenticodeSignature -LiteralPath '" + exe.replace(/'/g, "''") + "').Status";
  for (const shell of ['pwsh', 'powershell']) {
    try {
      return execFileSync(shell, ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true }).trim();
    } catch (e) {
      if (e.code !== 'ENOENT') refuse(shell + ' could not read the signature: ' + (e.message || e));
    }
  }
  return refuse('neither pwsh nor powershell is on PATH');
}

const s = status();
if (s !== 'Valid') refuse(REL + ' signature status is ' + (s || 'empty') + ', not Valid: the maintainer signs it before the release commit');
console.log('check-tray-signed: ' + REL + ' is signed (Valid)');
