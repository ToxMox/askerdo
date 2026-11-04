/* The tray's readings, in process: a snapshot of the local board's questions
 * in, the dot, the counts and the cards out, every payload synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockingCount, dotState, trayCards, trayWaitingCards, waitingCount,
} from '../lib/board-state.mjs';

/* A minimal question in the shape the local board's snapshot carries. */
function q(over = {}) {
  return {
    id: 'Q1',
    name: 'store shape',
    status: 'open',
    blocking: true,
    created: '2026-08-20',
    ...over,
  };
}

const snap = (entries, unreadable = []) => ({ entries, unreadable });

/* ---- the live dot ------------------------------------------------------ */

/* The ONE rule every surface wearing the dot derives its face from: the served
   shells call this, the open page transcribes it, and the tray reads its result
   off the ping header. */
test('the dot is blocking, then waiting, then quiet, over every project at once', () => {
  const blocks = q({ id: 'Q1', blocking: true });
  const asks = q({ id: 'Q2', blocking: false });
  assert.equal(dotState(snap([blocks])), 'blocking');
  assert.equal(dotState(snap([asks])), 'waiting');
  /* one blocking question anywhere wins, whatever order the store hands them
     over in and whatever project each of them belongs to */
  assert.equal(dotState(snap([asks, blocks])), 'blocking');
  assert.equal(dotState(snap([blocks, asks])), 'blocking');
  assert.equal(dotState(snap([asks, q({ id: 'Q3', blocking: false })])), 'waiting');
});

test('snoozed, answered, and dropped never light the dot', () => {
  for (const status of ['snoozed', 'answered', 'dropped']) {
    /* blocking: true is deliberate: a closed question keeps the flag it was
       registered with, and the flag alone must never light the corner */
    assert.equal(dotState(snap([q({ status, blocking: true })])), 'quiet', status);
  }
  /* and one open question beside them is still the whole answer */
  assert.equal(dotState(snap([
    q({ id: 'Q1', status: 'answered', blocking: true }),
    q({ id: 'Q2', status: 'snoozed', blocking: true }),
    q({ id: 'Q3', status: 'open', blocking: false }),
  ])), 'waiting');
  /* a status no verb ever writes is not open either */
  assert.equal(dotState(snap([q({ status: 'weird', blocking: true })])), 'quiet');
});

test('an empty store is quiet, and an unreadable file never flips the dot by itself', () => {
  assert.equal(dotState(snap([])), 'quiet');
  /* the tolerant reads, exactly as the digest keeps them */
  assert.equal(dotState({}), 'quiet');
  assert.equal(dotState(undefined), 'quiet');
  /* a file that would not parse is not a question: the placeholder card in
     Blocking is where that is reported, not the tab and not the tray */
  assert.equal(dotState(snap([], [{ file: 'Q9-corrupt.md', error: 'no title' }])), 'quiet');
  assert.equal(dotState(snap([q({ status: 'answered' })],
    [{ file: 'Q9-corrupt.md', error: 'no title' }])), 'quiet');
});

/* THE TOOLTIP'S NUMBER, beside the corner's word and under one rule: the
   dot's own first clause counted rather than short-circuited, so a count of
   zero on a `blocking` corner is impossible by construction. */
test('the blocking count is the dot first clause counted, over the same open questions', () => {
  assert.equal(blockingCount(snap([])), 0);
  assert.equal(blockingCount(snap([q({ id: 'Q1', blocking: false })])), 0);
  assert.equal(blockingCount(snap([q({ id: 'Q1', blocking: true })])), 1);
  assert.equal(blockingCount(snap([
    q({ id: 'Q1', blocking: true }),
    q({ id: 'Q2', blocking: false }),
    q({ id: 'Q3', blocking: true }),
  ])), 2, 'over every project at once, the way the dot reads');

  /* the same three exclusions: a closed question keeps the flag it was
     registered with, and a flag alone never counts */
  for (const status of ['snoozed', 'answered', 'dropped', 'weird']) {
    assert.equal(blockingCount(snap([q({ status, blocking: true })])), 0, status);
  }
  /* and the same tolerant reads the dot keeps */
  assert.equal(blockingCount({}), 0);
  assert.equal(blockingCount(undefined), 0);
  assert.equal(blockingCount(snap([], [{ file: 'Q9-corrupt.md', error: 'no title' }])), 0);

  /* the two never disagree: wherever the count is 1 or more the corner is
     rose, and wherever it is 0 the corner is anything but */
  for (const entries of [[], [q({ id: 'Q1', blocking: false })],
    [q({ id: 'Q1', blocking: true })],
    [q({ id: 'Q1', blocking: true }), q({ id: 'Q2', blocking: true })],
    [q({ id: 'Q1', status: 'answered', blocking: true }), q({ id: 'Q2', blocking: false })]]) {
    const both = [dotState(snap(entries)), blockingCount(snap(entries))];
    assert.equal(both[0] === 'blocking', both[1] > 0, JSON.stringify(both));
  }
});

/* ---- the tray menu's two readings -------------------------------- */

/* THE WAITING COUNT, over the same fixtures the blocking one uses and under the
   same rule word for word: open questions only, over all projects, no clock.
   The one clause that differs is the flag. */
test('the waiting count is the open questions that are not blocking', () => {
  assert.equal(waitingCount(snap([])), 0);
  assert.equal(waitingCount(snap([q({ id: 'Q1', blocking: true })])), 0);
  assert.equal(waitingCount(snap([q({ id: 'Q1', blocking: false })])), 1);
  const both = [
    q({ id: 'Q1', blocking: true }),
    q({ id: 'Q2', blocking: false }),
    q({ id: 'Q3', blocking: true }),
    q({ id: 'Q4', blocking: false }),
  ];
  assert.equal(waitingCount(snap(both)), 2, 'over every project at once');
  /* THE TWO PARTITION THE OPEN SET: their sum is every open question there is,
     which is what lets one counts line say both numbers */
  assert.equal(waitingCount(snap(both)) + blockingCount(snap(both)), 4);

  /* the same three exclusions the dot and the blocking count keep */
  for (const status of ['snoozed', 'answered', 'dropped', 'weird']) {
    assert.equal(waitingCount(snap([q({ status, blocking: false })])), 0, status);
  }
  /* a flag that is absent or junk is open and is not blocking, so it waits,
     exactly as dotState reads it */
  assert.equal(waitingCount(snap([q({ id: 'Q1', blocking: undefined })])), 1);
  assert.equal(waitingCount(snap([q({ id: 'Q1', blocking: 'yes' })])), 1);
  /* and the same tolerant reads */
  assert.equal(waitingCount({}), 0);
  assert.equal(waitingCount(undefined), 0);
  assert.equal(waitingCount(snap([], [{ file: 'Q9-corrupt.md', error: 'no title' }])), 0);

  /* a board with neither kind, and one with both, are the two ends of it */
  assert.equal(waitingCount(snap([q({ status: 'answered' })])), 0);
  assert.equal(dotState(snap(both)), 'blocking');
});

/* THE MENU'S QUESTION LINES: the open blocking questions, oldest first, at most
   five, each cut to the wire bound. */
test('trayCards names the oldest blocking questions and no others', () => {
  assert.deepEqual(trayCards(snap([])), []);
  assert.deepEqual(trayCards(snap([q({ id: 'Q1', blocking: false })])), []);
  assert.deepEqual(
    trayCards(snap([q({ id: 'Q1', name: 'the port', blocking: true })])),
    [{ id: 'Q1', name: 'the port' }],
  );
  /* the same exclusions, so a closed question's flag never names a line */
  for (const status of ['snoozed', 'answered', 'dropped', 'weird']) {
    assert.deepEqual(trayCards(snap([q({ status, blocking: true })])), [], status);
  }
  /* the tolerant reads the two counts keep */
  assert.deepEqual(trayCards({}), []);
  assert.deepEqual(trayCards(undefined), []);
  assert.deepEqual(trayCards({ entries: 'nope' }), []);
});

/* OLDEST FIRST is ascending by the id's NUMBER and not the snapshot's order:
   the store hands entries over in filename order, which runs Q1, Q10, Q100,
   Q11, Q2. */
test('trayCards sorts by the id NUMBER, not by the store directory order', () => {
  const blocks = (id) => q({ id, name: 'n' + id, blocking: true });
  const directoryOrder = ['Q1', 'Q10', 'Q100', 'Q11', 'Q2', 'Q3'].map(blocks);
  assert.deepEqual(
    trayCards(snap(directoryOrder)).map((c) => c.id),
    ['Q1', 'Q2', 'Q3', 'Q10', 'Q11'],
  );
  /* and the CAP takes the five oldest rather than the first five it met */
  assert.equal(trayCards(snap(directoryOrder)).length, 5);
  assert.deepEqual(trayCards(snap(directoryOrder), 2).map((c) => c.id), ['Q1', 'Q2']);
  assert.deepEqual(trayCards(snap(directoryOrder), 0), []);
});

test('trayCards cuts a name at the wire bound of 120', () => {
  const long = 'x'.repeat(400);
  const [card] = trayCards(snap([q({ id: 'Q1', name: long, blocking: true })]));
  assert.equal(card.name.length, 120);
  /* THE 120 IS A WIRE BOUND AND NOT A DISPLAY ONE: no ellipsis is added here,
     because the menu's own cut is forty and it appends the dots itself */
  assert.ok(!card.name.endsWith('...'));
  /* a missing name is an empty one rather than an absent field: the menu draws
     `<id> <name>` and an undefined would reach a label */
  const [none] = trayCards(snap([q({ id: 'Q2', name: undefined, blocking: true })]));
  assert.equal(none.name, '');
  assert.deepEqual(Object.keys(none).sort(), ['id', 'name']);
});

/* THE CUT IS BY CODE POINT: a name cut between the halves of a surrogate pair
   puts a lone surrogate on the wire, serde_json rejects the escape, and the exe
   drops the WHOLE frame. */
test('a name cut at the wire bound never splits a character', () => {
  const emoji = '\u{1F600}';
  /* 119 plain characters and then the emoji: its two units straddle index 120,
     which is exactly where a unit-wise cut would land */
  const name = 'x'.repeat(119) + emoji + 'y'.repeat(20);
  const [card] = trayCards(snap([q({ id: 'Q1', name, blocking: true })]));
  assert.equal(Array.from(card.name).length, 120, 'the bound is counted in code points');
  assert.equal(card.name.length, 121, 'and the emoji rode over it whole');
  assert.ok(card.name.endsWith(emoji));
  assert.ok(card.name.isWellFormed(), 'no lone surrogate reaches the wire');
  /* the frame the exe parses is the round trip that matters */
  assert.equal(JSON.parse(JSON.stringify({ tray: { questions: [card] } })).tray.questions[0].name,
    card.name);

  /* a name that is ALL emoji is cut on the same rule and stays well formed */
  const all = trayWaitingCards(snap([q({ id: 'Q2', name: emoji.repeat(400), blocking: false })]));
  assert.equal(Array.from(all[0].name).length, 120);
  assert.ok(all[0].name.isWellFormed());
});

/* THE MENU'S SECOND BLOCK: the WAITING questions, newest first, in the same shape and
   under the same cut. */
test('trayWaitingCards names the newest waiting questions and no others', () => {
  assert.deepEqual(trayWaitingCards(snap([])), []);
  /* a blocking question is never in it: the two lists partition the open set
     exactly as the two counts do */
  assert.deepEqual(trayWaitingCards(snap([q({ id: 'Q1', blocking: true })])), []);
  assert.deepEqual(
    trayWaitingCards(snap([q({ id: 'Q1', name: 'the port', blocking: false })])),
    [{ id: 'Q1', name: 'the port' }],
  );
  /* an absent or junk flag is open and not blocking, so it WAITS, which is
     waitingCount's rule word for word */
  assert.deepEqual(trayWaitingCards(snap([q({ id: 'Q1', blocking: undefined })])).map((c) => c.id),
    ['Q1']);
  assert.deepEqual(trayWaitingCards(snap([q({ id: 'Q1', blocking: 'yes' })])).map((c) => c.id),
    ['Q1']);
  /* the same exclusions every reading here keeps */
  for (const status of ['snoozed', 'answered', 'dropped', 'weird']) {
    assert.deepEqual(trayWaitingCards(snap([q({ status, blocking: false })])), [], status);
  }
  /* and the same tolerant reads */
  assert.deepEqual(trayWaitingCards({}), []);
  assert.deepEqual(trayWaitingCards(undefined), []);
  assert.deepEqual(trayWaitingCards({ entries: 'nope' }), []);
});

/* NEWEST FIRST is the OPPOSITE of the blocking block, and by the id's NUMBER
   for the same reason: the store hands its entries over in filename order. */
test('trayWaitingCards sorts newest first and caps at five', () => {
  const waits = (id) => q({ id, name: 'n' + id, blocking: false });
  const directoryOrder = ['Q1', 'Q10', 'Q100', 'Q11', 'Q2', 'Q3'].map(waits);
  assert.deepEqual(
    trayWaitingCards(snap(directoryOrder)).map((c) => c.id),
    ['Q100', 'Q11', 'Q10', 'Q3', 'Q2'],
  );
  assert.equal(trayWaitingCards(snap(directoryOrder)).length, 5);
  assert.deepEqual(trayWaitingCards(snap(directoryOrder), 2).map((c) => c.id), ['Q100', 'Q11']);
  assert.deepEqual(trayWaitingCards(snap(directoryOrder), 0), []);
  /* the two blocks over ONE board, sorted the two ways they are sorted */
  const mixed = snap([
    q({ id: 'Q1', name: 'oldest blocker', blocking: true }),
    q({ id: 'Q4', name: 'newer blocker', blocking: true }),
    q({ id: 'Q2', name: 'older waiter', blocking: false }),
    q({ id: 'Q9', name: 'newest waiter', blocking: false }),
  ]);
  assert.deepEqual(trayCards(mixed).map((c) => c.id), ['Q1', 'Q4']);
  assert.deepEqual(trayWaitingCards(mixed).map((c) => c.id), ['Q9', 'Q2']);
  /* a name is cut at the same wire bound with no ellipsis */
  const [long] = trayWaitingCards(snap([q({ id: 'Q1', name: 'x'.repeat(400), blocking: false })]));
  assert.equal(long.name.length, 120);
  assert.ok(!long.name.endsWith('...'));
});
