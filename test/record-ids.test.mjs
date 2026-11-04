/* Record keys. The labels and the picker are tested on the board (server-questions,
   server-work). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKey } from '../lib/record-ids.mjs';
import { mintKey } from '../server/records.mjs';
import { freshBoard } from './helpers/board-db.mjs';

test('a key the board mints is a key on the PC, and a label or another shape is not', () => {
  const db = freshBoard();
  for (let i = 0; i < 200; i++) assert.ok(isKey(mintKey(db)));
  for (const not of ['T-12', 'abcdefgi', 'ABCDEFGH', 'abcdefg', '']) assert.equal(isKey(not), false, not);
});
