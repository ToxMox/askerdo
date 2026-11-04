/* The board kit: a folder a Docker host with no Claude Code builds and runs.
   It reads only server/ and the compose.yaml beside it, so it runs from the plugin folder. */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* A zone the image's Node knows; the PC running the kit lends its own when none is named. */
function zoneOf(tz) {
  const z = String(tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').trim();
  try { new Intl.DateTimeFormat('en', { timeZone: z }); } catch {
    throw new Error('the time zone ' + JSON.stringify(z) + ' is not one Node knows: name it as Area/City, for example Europe/Berlin');
  }
  return z;
}

function swap(text, from, to, what) {
  if (!from.test(text)) throw new Error('compose.yaml no longer has the ' + what + ' line the kit rewrites');
  return text.replace(from, to);
}

/* The repo's compose file with the kit's port and zone written in (no shell variables),
   and host folders beside it in place of the named volumes, so a restore there is a plain copy. */
export function kitCompose(text, { port, tz }) {
  let t = swap(text, /^# Port and zone:.*\n/m, '', 'port and zone comment');
  t = swap(t, /^(\s+- )"[^"]+:[^"]+"$/m, '$1"' + port + ':' + port + '"', 'port');
  t = swap(t, /^(\s+ASKERDO_PORT: )"[^"]+"$/m, '$1"' + port + '"', 'ASKERDO_PORT');
  t = swap(t, /^(\s+TZ: ).*$/m, '$1' + tz, 'TZ');
  t = swap(t, /^(\s+- )askerdo-data:\/data$/m, '$1./data:/data', 'data volume');
  t = swap(t, /^(\s+- )askerdo-backups:\/backups$/m, '$1./backups:/backups', 'backups volume');
  return swap(t, /\n(#[^\n]*\n)*volumes:\n[\s\S]*$/, '', 'top-level volumes');
}

const readme = ({ port, tz }) => `AskerDo board kit

This folder builds and runs the AskerDo board on a Docker host with the compose
plugin; the host needs no Claude Code. In this folder, run:

  docker compose up -d --build

The board listens on port ${port}, in the time zone ${tz}. While no PC is on it, its
start prints a setup code to its log:

  docker compose logs board

On the first PC, run /askerdo:configure and give it the board address,
http://<this host>:${port}, and that code. It works until the first PC joins; a
restart replaces it, and while no PC has joined,
docker exec askerdo node /app/server/cli.mjs setup-code prints a fresh one. Every
later PC joins with a code from a PC already on the board.

The database lives in data/ and the backups in backups/, beside this file. Keep the
folder on a local disk of the host, never a network share or a FUSE path such as
Unraid's /mnt/user. A restore is a plain copy into data/ while the board is stopped.
On an Unraid host, run chown -R 99:100 data backups in this folder after the first
start, so the appdata share can edit them (Docker creates them owned by root).
`;

/* writeKit(dir, { port, tz }): refuses a folder that holds anything. */
export function writeKit(dir, { port = 17480, tz, root = ROOT } = {}) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('--port takes a port number, 1 to 65535: ' + port);
  const zone = zoneOf(tz);
  const out = resolve(String(dir || ''));
  if (!dir) throw new Error('kit needs a folder to write into');
  if (existsSync(out) && readdirSync(out).length) throw new Error(out + ' is not empty: name a new or empty folder for the kit');
  const compose = kitCompose(readFileSync(join(root, 'compose.yaml'), 'utf8'), { port: p, tz: zone });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, 'server'), join(out, 'server'), { recursive: true });
  writeFileSync(join(out, 'compose.yaml'), compose);
  /* the build reads server/ alone; the board's own folders stay out of each rebuild */
  writeFileSync(join(out, '.dockerignore'), '*\n!server\n');
  writeFileSync(join(out, 'README.txt'), readme({ port: p, tz: zone }));
  return { dir: out, port: p, tz: zone, zoneNamed: Boolean(tz) };
}
