/* Slice 3 of 4 of test/board-server.test.mjs, run as its own file. */
import { pickSlice } from './helpers/shard.mjs';

pickSlice(2);
await import('./board-server.test.mjs');
