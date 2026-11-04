/* One long case file run as several files: node runs files side by side
 * but a file's cases in order, so the longest file sets the run's wall time.
 * Case i belongs to slice i mod `of`; slice 0 when the file runs directly,
 * another when a sibling file picks one before importing it. */
const PICK = Symbol.for('ttd.test.shard');

/* For the case file: a counter that answers whether the next case is this
   process's. The file wraps its own `test` with it, so a case's location stays
   in that file. */
export function slicer(of) {
  const slice = globalThis[PICK] || 0;
  let i = 0;
  return () => (i++ % of) === slice;
}

/* For a sibling file: pick the slice, then import the case file. */
export function pickSlice(slice) {
  globalThis[PICK] = slice;
}
