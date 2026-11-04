/* Writes the generated docs and stamps: docs/guide/reply-rules.md whole from the
 * contract builder, docs/guide/cli.md below its marker from the CLI's own help,
 * and server/version.json, the plugin version the board server carries wherever
 * it runs. --check rebuilds and compares against the committed files instead of
 * writing. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginRoot, pluginVersion } from '../lib/node-helpers.mjs';
import { CLI_MARKER, cliReferenceBody } from './build-cli-ref.mjs';
import { rulesPage } from './build-rules-ref.mjs';

const version = pluginVersion();
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

const cliNow = read(join(pluginRoot, 'docs', 'guide', 'cli.md'));
const at = cliNow.indexOf(CLI_MARKER);
if (at < 0) {
  console.error('docs/guide/cli.md has lost its generated-part marker; put it back under the hand-written head');
  process.exit(1);
}

const outputs = [
  ['docs/guide/reply-rules.md', rulesPage()],
  ['docs/guide/cli.md', cliNow.slice(0, at + CLI_MARKER.length) + '\n' + cliReferenceBody()],
  ['server/version.json', JSON.stringify({ version }, null, 2) + '\n'],
];

if (process.argv.includes('--check')) {
  for (const [rel, out] of outputs) {
    if (read(join(pluginRoot, rel)) !== out) {
      console.error(rel + ' is stale; run: node scripts/build.mjs');
      process.exit(1);
    }
  }
  console.log(outputs.map(([rel]) => rel).join(', ') + ' are current');
} else {
  for (const [rel, out] of outputs) writeFileSync(join(pluginRoot, rel), out);
  console.log('built ' + outputs.map(([rel]) => rel).join(', ') + ' at version ' + version);
}
