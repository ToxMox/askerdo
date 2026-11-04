/* The seam every PC-side caller uses: boardCall runs the verb table in
   process on memory:, and with no board setting it refuses. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tempDir } from './helpers/sandbox.mjs';

process.removeAllListeners('warning');
const { BoardCallError, boardCall, boardRequest, startBoard } = await import('../lib/board-call.mjs');
const { storeRoot } = await import('../lib/node-helpers.mjs');
const { API } = await import('../server/paths.mjs');

test('a verb through boardCall on memory: writes and reads back, and no setting refuses', async () => {
  /* an empty sandbox home: its data dir holds no config, so nothing names a board */
  process.env.ASKERDO_SANDBOX_HOME = tempDir('askerdo-store-');
  delete process.env.ASKERDO_BOARD_URL;
  await assert.rejects(boardCall('listWork', {}), BoardCallError);

  process.env.ASKERDO_BOARD_URL = 'memory:';
  const ws = await boardCall('createRecord', { kind: 'workstream', name: 'Board', description: 'One board.' }, { session: 's1', pc: 'pc1' });
  assert.equal((await boardCall('readRecord', ws.id)).name, 'Board');
});

test('a write the local server dropped after it was sent may have run, and is not sent to the board again', async () => {
  const b = await startBoard();
  /* a local server that passes the write to the board, then dies before it answers */
  const fake = createServer((req) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      await boardRequest('POST', API + '/verbs/' + req.url.split('/verbs/')[1], JSON.parse(Buffer.concat(chunks).toString('utf8')), { url: b.url, token: b.token });
      req.socket.destroy();
    });
  });
  await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
  const dir = join(storeRoot(), 'board');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'local.json'), JSON.stringify({ board: b.url, url: 'http://127.0.0.1:' + fake.address().port + '/local' }));
  process.env.ASKERDO_BOARD_URL = b.url;
  process.env.ASKERDO_BOARD_TOKEN = b.token;
  try {
    await assert.rejects(boardCall('createRecord', { kind: 'workstream', name: 'Once', description: 'One write.' }, { session: 's1' }), /may have run/);
    assert.equal(b.db.prepare("SELECT count(*) AS n FROM records WHERE kind = 'workstream'").get().n, 1);
  } finally {
    delete process.env.ASKERDO_BOARD_URL;
    delete process.env.ASKERDO_BOARD_TOKEN;
    fake.close();
    await b.close();
  }
});
