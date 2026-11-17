/* Words that name something left undone: work for later, a limit named, a check still
   owed, a finding left unfixed. One list for the sweep's filters and the turn's flags,
   kept tight so a plain done note passes. */
/* "left for T-n", "handed to T-n", "rides T-n": the board copies such a sentence onto that
   task, so it has a home; the matcher lives with the board's pure text, which ships alone. */
import { routedTo } from '../server/handoff-text.mjs';

const PHRASES = [
  /\bleft (?:open|undone|unfixed|unfiled|for later|for the next)\b/i,
  /\bnot (?:yet )?(?:measured|verified|tested|filed|fixed|checked|wired|landed|covered)\b/i,
  /\bun(?:measured|verified|tested|filed)\b/i,
  /\bknown (?:limit(?:ation)?s?|gaps?)\b/i,
  /\bstill (?:owed|open|to do|missing|pending)\b/i,
  /\bfor the user to (?:check|look|test|try|confirm|decide|measure)\b/i,
  /\bfollow[- ]ups?\b/i,
  /\bnext session\b/i,
  /\bout of scope\b/i,
  /\b(?:noticed|spotted|seen) in passing\b/i,
  /\brides? the next\b/i,
  /\bfor later\b/i,
  /\b(?:a|another|the) later (?:lane|wave|pass|session|round|release|fix)\b/i,
  /\bTODO\b/,
];

/* "later" counts only at the end of a clause about doing something: "I'll file it later",
   never "two minutes later", "a later wake" or "later in the session". */
const LATER = /\b(?:I'll|I will|we'll|we will|will|can|could|should|to)\b[^.;:!?\n]{0,48}?\blater\b(?=\s*(?:$|[.,;:!?)\]*"']|(?:on|if|when|once|after|and|or|so|but)\b))/i;

/* The words that matched, or null when the text names nothing left. A sentence handed to a task is
   skipped once the board copied it: `copied` is the reply's list, null a reply with none (an older
   board: every sentence kept), left out when the caller has no reply (each handed sentence skipped). */
export function leftUndone(text, copied) {
  let s = String(text ?? '');
  const home = (ids) => copied === undefined || (Array.isArray(copied) && ids.every((id) => copied.includes(id)));
  for (const r of routedTo(s)) if (home(r.ids)) s = s.replace(r.sentence, '');
  if (!s) return null;
  for (const re of [...PHRASES, LATER]) {
    const m = re.exec(s);
    if (m) return m[0];
  }
  return null;
}
