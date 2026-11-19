/* Slice 2 of 2 of test/loose-files.test.mjs, run as its own file. */
import { pickSlice } from './helpers/shard.mjs';

pickSlice(1);
await import('./loose-files.test.mjs');
