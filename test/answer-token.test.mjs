/* The one authority on an answer token. Pure module, pure
 * tests: no store, no sandbox, no fs. What is pinned here is the whole rule,
 * so every renderer and the store can reach it instead of restating it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerToken, isLetterType, matchesToken, parseComposed } from '../lib/answer-token.mjs';

test('a letter type composes to the question number plus the letter', () => {
  assert.equal(answerToken('Q106', 'b'), '106b');
  assert.equal(answerToken('Q1', 'a'), '1a');
  assert.equal(answerToken('Q1043', 'z'), '1043z');
  /* the id in the three shapes a caller actually holds */
  assert.equal(answerToken('q106', 'b'), '106b');
  assert.equal(answerToken('106', 'b'), '106b');
  assert.equal(answerToken(106, 'b'), '106b');
  /* a stored type is trimmed, never rewritten */
  assert.equal(answerToken('Q106', ' b '), '106b');
});

test('every other stored type is carried verbatim, which is what keeps a pre-cut record readable', () => {
  /* the legacy reply-ordinal form, from a record older than letter types, shown as
     stored */
  assert.equal(answerToken('Q106', '1a'), '1a');
  assert.equal(answerToken('Q1', '1a'), '1a');
  /* not one lowercase letter: two letters, an uppercase, a word, punctuation */
  for (const t of ['aa', 'A', 'none', '9z', '<i>1a', '-']) {
    assert.equal(answerToken('Q106', t), t, t);
  }
  /* an empty type composes to nothing at all: no chip, no token, no pick */
  assert.equal(answerToken('Q106', ''), '');
  assert.equal(answerToken('Q106', undefined), '');
  assert.equal(answerToken('Q106', null), '');
  /* an id that names no question has no number to compose with */
  assert.equal(answerToken('', 'b'), 'b');
  assert.equal(answerToken(undefined, 'b'), 'b');
  assert.equal(answerToken('T-79', 'b'), 'b');
});

test('the shape test is exactly one lowercase letter', () => {
  for (const t of ['a', 'b', 'z', ' c ']) assert.equal(isLetterType(t), true, t);
  for (const t of ['A', 'aa', '1a', '', ' ', '1', 'none', undefined, null]) {
    assert.equal(isLetterType(t), false, String(t));
  }
});

test('the composed shape parses, and it is the old reply-ordinal form too', () => {
  assert.deepEqual(parseComposed('106b'), { number: '106', letter: 'b' });
  assert.deepEqual(parseComposed('1a'), { number: '1', letter: 'a' });
  assert.deepEqual(parseComposed(' 106B '), { number: '106', letter: 'b' });
  for (const t of ['b', '106', '106bb', 'a106', '', undefined]) {
    assert.equal(parseComposed(t), null, String(t));
  }
});

test('the matcher takes the composed token, the bare letter and the stored type, case folded', () => {
  /* the three forms `answer --pick` accepts, on a record with a letter type */
  assert.equal(matchesToken('Q106', 'b', '106b'), true);
  assert.equal(matchesToken('Q106', 'b', 'b'), true);
  assert.equal(matchesToken('Q106', 'b', ' 106b '), true);
  /* letter case is folded on both halves, and only letter case */
  assert.equal(matchesToken('Q106', 'b', '106B'), true);
  assert.equal(matchesToken('Q106', 'b', 'B'), true);
  /* a legacy record answers to its stored type, and to nothing new */
  assert.equal(matchesToken('Q106', '1a', '1a'), true);
  assert.equal(matchesToken('Q106', '1a', '1A'), true);
  assert.equal(matchesToken('Q106', '1a', '106a'), false);
  assert.equal(matchesToken('Q106', '1a', 'a'), false);
  /* the wrong question's token is not this option, however right the letter */
  assert.equal(matchesToken('Q106', 'b', '105b'), false);
  assert.equal(matchesToken('Q106', 'b', '1b'), false);
  /* another option's letter is never this one */
  assert.equal(matchesToken('Q106', 'b', 'a'), false);
  assert.equal(matchesToken('Q106', 'b', '106a'), false);
  /* nothing typed and nothing stored match nothing */
  assert.equal(matchesToken('Q106', 'b', ''), false);
  assert.equal(matchesToken('Q106', '', '106b'), false);
  assert.equal(matchesToken('Q106', '', ''), false);
});

test('an absent id means any number, which is the register own case', () => {
  /* the payload validates before an id is allocated for it, so the number
     cannot be checked there and is not */
  assert.equal(matchesToken(null, 'b', '106b'), true);
  assert.equal(matchesToken(null, 'b', '1b'), true);
  assert.equal(matchesToken(null, 'b', 'b'), true);
  assert.equal(matchesToken(null, 'b', '106a'), false);
  assert.equal(matchesToken(null, '1a', '1a'), true);
  assert.equal(matchesToken(null, '1a', '106a'), false);
});
