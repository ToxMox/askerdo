/* The names the placement rule's two halves share. */

// A Symbol cannot arrive in a request body: only the answer of a placement question sets it.
export const APPROVED = Symbol('placement approved');

// Likewise only askPlacement sets this on a register payload: a request never registers a placement question.
export const BOARD_ASKS = Symbol('placement asked by the board');

export const PLACEMENT_LABEL = 'placement';

// Ends the refusals of a filing past the held track, and rides an asked filing's result as `path`.
export const GO_PATH = 'A planned set of moves across tracks is asked once: take the task in hand first, then one ask with its yes option marked go and that task in gates; its answer carries every placement by the session holding that task until the task closes.';
