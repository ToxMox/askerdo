/* The names the placement rule's two halves share. */

// A Symbol cannot arrive in a request body: only the answer of a placement question sets it.
export const APPROVED = Symbol('placement approved');

// Likewise only askPlacement sets this on a register payload: a request never registers a placement question.
export const BOARD_ASKS = Symbol('placement asked by the board');

export const PLACEMENT_LABEL = 'placement';
