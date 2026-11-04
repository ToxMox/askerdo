/* The ONE authority on an answer token: the token is a
   question's number plus an option's letter; a record stores the letter alone.
   Any other stored type composes to itself, so older records read on. */

/* A stored type that composes: one lowercase letter, deliberately narrow, so a
   card, a paste and a record can never disagree about which token was
   meant. */
export const LETTER_RE = /^[a-z]$/;

/* A composed token's shape, digits then one letter: one shape test serves
   the refusal, the wrong-number check and the matcher. */
export const COMPOSED_RE = /^(\d+)([a-z])$/;

/* The question's number out of 'Q106', 'q106', '106' or 106, or null. An
   absent id is how a caller that does not know the number yet asks for the
   loose match below. */
function numberOf(id) {
  const m = /^[Qq]?(\d+)$/.exec(String(id === undefined || id === null ? '' : id).trim());
  return m ? m[1] : null;
}

const fold = (s) => String(s === undefined || s === null ? '' : s).trim().toLowerCase();

/* Is this stored type one the composer composes? The store and the renderers
   read the shape here, so they agree on which types are letters. */
export function isLetterType(type) {
  return LETTER_RE.test(String(type === undefined || type === null ? '' : type).trim());
}

/* A composed token split into its number and its letter. Exported so the
   register's refusal and the wrong-number refusal read the shape here rather
   than growing a regex each. */
export function parseComposed(token) {
  const m = COMPOSED_RE.exec(fold(token));
  return m ? { number: m[1], letter: m[2] } : null;
}

/* THE COMPOSER: a letter type takes the question's number, and every other
   stored type is returned exactly as stored, which keeps older records
   readable. */
export function answerToken(id, type) {
  const t = String(type === undefined || type === null ? '' : type).trim();
  if (!isLetterType(t)) return t;
  const n = numberOf(id);
  return n === null ? t : n + t;
}

/* THE MATCHER: three forms name an option, case folded, and no others. An
   absent id skips the number check, which is the register's case alone, where
   the payload is validated before an id exists. */
export function matchesToken(id, type, typed) {
  const t = fold(typed);
  if (!t) return false;
  const stored = fold(type);
  if (!stored) return false;
  if (t === stored) return true;
  if (!isLetterType(stored)) return false;
  const parsed = parseComposed(t);
  if (!parsed || parsed.letter !== stored) return false;
  const n = numberOf(id);
  return n === null || n === parsed.number;
}

/* The letter an Answer section records, as the store writes it ("499a, ..."):
   the reversal's turned-down options read it (server/verbs/questions.mjs keeps
   the board's copy of this rule). */
export function answeredPick(q) {
  const m = /^\s*([A-Za-z0-9][\w-]*)\s*[.:,]/.exec(String(q.answer || ''));
  if (!m) return null;
  const num = String(q.id).replace(/^Q/i, '');
  const tok = m[1].toLowerCase();
  const hit = (q.options || []).find((o) => {
    const t = String(o.type || '').toLowerCase();
    return t && (tok === t || tok === num + t || tok === 'q' + num + t);
  });
  return hit ? String(hit.type).toLowerCase() : null;
}

/* An earlier answer's paragraph, by its opening words. It lives here
   because every reader of an answer section must read one rule. Anchored. */
export function isEarlierAnswer(paragraph) {
  return /^Earlier answer, given /.test(String(paragraph === undefined || paragraph === null ? '' : paragraph));
}
