/* Slice 2 of 2 of test/procedures.test.mjs, run as its own file. */
import { pickSlice } from './helpers/shard.mjs';

pickSlice(1);
await import('./procedures.test.mjs');
