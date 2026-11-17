/* A note whose words say the work changed scope, with no rewrite riding it, gets one line
   back offering the rewrite prefilled: a line, never a refusal, so the session is not
   pushed to an easier path. Shared by the CLI's note and task update and the mod's tools. */

/* only phrases that name a change of scope: bare "instead", "narrow" or "widen" fill progress notes */
const SCOPE = /\b(re-?scop(?:e|ed|es|ing)|split by|(?:widened|narrowed) to|now also)\b/i;

/* The words that name a scope change, else null. */
export function scopeWords(text) {
  const m = SCOPE.exec(String(text ?? ''));
  return m ? m[0] : null;
}

/* The offer for a note's result (the board's noteRecord answer), else ''. `tool` words it
   for the mod's note and task_update; the CLI's names the command. */
export function rewriteOffer(r, body, tool = false) {
  const said = scopeWords(body);
  const cur = r && r.current;
  if (!said || !cur || !cur.field || (r.amended && r.amended.length)) return '';
  const now = String(cur.text ?? '').replace(/\s+/g, ' ').trim();
  const how = tool
    ? 'call note again on ' + r.id + ' with ' + cur.field + ' set to the new text and body saying why'
    : 'askerdo note ' + r.id + ' --' + cur.field + ' "<new text>" --body "<why>"';
  return 'AskerDo: this note says "' + said + '", and ' + r.id + '\'s ' + cur.field + ' still reads as before. If the work changed, rewrite it ('
    + how + '); the old text stays in its history. Its ' + cur.field + ' now: "' + now + '"';
}

const TEXTS = ['description', 'intent', 'goal'];

/* The texts a note sent that its reply does not show taken: a board older than the amend
   keeps the note and drops the text, answering with neither amended nor current. A title
   the reply's name does not carry was dropped by a board older than the title amend. */
export function droppedTexts(r, sent) {
  const named = TEXTS.filter((k) => sent && typeof sent[k] === 'string' && sent[k].trim());
  const title = sent && typeof sent.name === 'string' && sent.name.trim() && r && typeof r.name === 'string' && r.name !== sent.name.trim() ? ['name'] : [];
  if (!named.length || !r || (r.amended && r.amended.length) || r.current) return title;
  return [...title, ...named];
}

/* The fields a note amended, the title called by its name. */
export function amendedWords(r) {
  return r && Array.isArray(r.amended) && r.amended.length ? ', ' + r.amended.map((f) => (f === 'name' ? 'title' : f)).join(' and ') + ' amended' : '';
}

/* A task's description or intent rewritten with its title left as it was: the title on one
   line, so the session reads it against the new text. */
export function titleLine(r, tool = false) {
  const a = r && Array.isArray(r.amended) ? r.amended : [];
  if (!r || r.kind !== 'task' || a.includes('name') || !a.some((f) => f === 'description' || f === 'intent') || !r.name) return '';
  return 'Title unchanged: "' + r.name + '" (if it no longer says what ' + r.id + ' is, '
    + (tool ? 'call note again with name set to the new title' : 'askerdo note ' + r.id + ' --name "<new title>" --body "<why>"') + ').';
}

/* The plain line for a dropped rewrite, so no session believes the text moved. */
export function droppedWords(id, fields, tool = false) {
  const what = fields.join(' and ');
  return 'AskerDo: the note on ' + id + ' was written, but the board did not amend its ' + what
    + ': the board server is older than the amend, so the ' + what + ' still reads as before. Do not send the note again; once the board server is updated, '
    + (tool ? 'call note on ' + id + ' with the new ' + what + ' and a body saying why.' : 'run askerdo note ' + id + ' --' + fields[0] + ' "<new text>" --body "<why>".');
}
