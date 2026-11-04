/* The tray's readings off the local board's questions, one definition each, so
   the dot, the counts and the cards read one board. Pure. */

/* The live dot's one rule, over ALL projects and OPEN questions only: blocking
   wins, else waiting, else quiet. Not the header's tallies, which count what the
   filter shows. No clock is read, and every surface derives the dot from HERE. */
export function dotState(snap) {
  let waiting = false;
  for (const e of (snap && snap.entries) || []) {
    if (String((e && e.status) || '') !== 'open') continue;
    if (e.blocking === true) return 'blocking';
    waiting = true;
  }
  return waiting ? 'waiting' : 'quiet';
}

/* THE BLOCKING COUNT, over the same reading as the dot: the dot says which
   state the board is in, the count how many open questions block, which one word
   cannot carry. Here, not in the server, so tooltip and corner cannot disagree. */
export function blockingCount(snap) {
  let n = 0;
  for (const e of (snap && snap.entries) || []) {
    if (String((e && e.status) || '') !== 'open') continue;
    if (e.blocking === true) n += 1;
  }
  return n;
}

/* THE WAITING COUNT, the blocking count's rule word for word but with
   `blocking !== true`, so the two partition the open set. Not `=== false`: a
   question whose flag is absent or junk is open and not blocking, so it waits. */
export function waitingCount(snap) {
  let n = 0;
  for (const e of (snap && snap.entries) || []) {
    if (String((e && e.status) || '') !== 'open') continue;
    if (e.blocking !== true) n += 1;
  }
  return n;
}

/* The wire bound on a name travelling to the tray on the event stream.
   The menu's own cut is forty and lives in the exe; this one stops a
   pathological name riding every change event. */
const CARD_NAME_MAX = 120;

/* The numeric part of a question id, or -1 for anything that is not one: the
   snapshot's order is the store directory's filename sort, which runs `Q1`, `Q10`,
   `Q100`, `Q11`, `Q2`, so string order stops being id order past nine questions. */
function idOrder(e) {
  const m = /^Q(\d+)$/.exec(String((e && e.id) || ''));
  return m ? Number(m[1]) : -1;
}

/* THE MENU'S QUESTION LINES: open blocking questions, OLDEST first by the
   id's number, which is registration order and decides which are named when more
   than cap block. The name is cut here because it rides every change event. */
export function trayCards(snap, cap = 5) {
  const open = openCards(snap, true);
  open.sort((a, b) => idOrder(a) - idOrder(b));
  return open.slice(0, capOf(cap)).map(cardOf);
}

/* THE MENU'S SECOND BLOCK: open waiting questions,
   NEWEST first, the opposite of the blocking block: the menu names the newest
   waiting questions. A non-Q id sorts last, never eating a slot. */
export function trayWaitingCards(snap, cap = 5) {
  const open = openCards(snap, false);
  open.sort((a, b) => idOrder(b) - idOrder(a));
  return open.slice(0, capOf(cap)).map(cardOf);
}

/* the open questions of one kind, the shared half of the two readings above */
function openCards(snap, blocking) {
  const open = [];
  for (const e of (snap && snap.entries) || []) {
    if (String((e && e.status) || '') !== 'open') continue;
    if ((e.blocking === true) !== blocking) continue;
    open.push(e);
  }
  return open;
}

function capOf(cap) {
  return Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : 5;
}

/* ONE ENTRY AS THE WIRE CARRIES IT, cut BY CODE POINT and not by UTF-16 unit: a
   cut through a surrogate pair makes an escape serde_json rejects, and the exe
   drops the WHOLE frame for as long as that question stays open. */
function cardOf(e) {
  const raw = String(e.name === undefined || e.name === null ? '' : e.name);
  const card = { id: String(e.id), name: Array.from(raw).slice(0, CARD_NAME_MAX).join('') };
  /* the tray opens the record by its key */
  if (typeof e.key === 'string' && e.key) card.key = e.key;
  return card;
}
