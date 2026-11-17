import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = (f) => JSON.parse(readFileSync(join(root, '.claude-plugin', f), 'utf8'));

/* At install time plugin.json wins and the marketplace entry's version is ignored, so
   the entry can drift unnoticed; this pin turns that drift into a failing test. */
test('the marketplace entry carries the plugin manifest name and version', () => {
  const plugin = manifest('plugin.json');
  const market = manifest('marketplace.json');
  const entry = market.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry, 'marketplace.json lists the plugin under its manifest name');
  assert.equal(entry.version, plugin.version,
    'the marketplace entry version matches plugin.json (the release ritual bumps both)');
});

/* The mod carries the queue, so no prompt, tool call or stop hook runs a script. */
test('no prompt, tool call or stop hook is registered, and every hook script is on disk', () => {
  const reg = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8'));
  for (const kind of ['UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop']) assert.ok(!(kind in reg.hooks), kind);
  const at = '${CLAUDE_PLUGIN_ROOT}/';
  const scripts = Object.values(reg.hooks).flat().flatMap((e) => e.hooks).flatMap((h) => h.args || [])
    .filter((a) => a.startsWith(at));
  assert.ok(scripts.length > 0, 'the registry names its scripts');
  for (const a of scripts) assert.ok(existsSync(join(root, a.slice(at.length))), a);
});

/* The engine's TypeScript loader lets a second top-level function of one name replace the
   first with no error, so a clash shows only where a case draws it. Reads column-0 lines. */
test('no mod source file declares a top-level function name twice', () => {
  const dir = join(root, 'hooks', 'mod');
  const files = readdirSync(dir, { recursive: true }).filter((f) => /\.tsx?$/.test(f));
  assert.ok(files.some((f) => f === 'index.ts'), 'the mod core is read');
  const decl = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/;
  for (const f of files) {
    const seen = new Map();
    readFileSync(join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      const name = decl.exec(line)?.[1];
      if (!name) return;
      assert.ok(!seen.has(name), `${f}: function ${name} at line ${seen.get(name)} and again at line ${i + 1}`);
      seen.set(name, i + 1);
    });
  }
});
