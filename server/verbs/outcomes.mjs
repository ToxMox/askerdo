/* a workstream's outcomes in the user's words (o1, o2...), the ones a task
   serves, and the growth line a handoff carries, as every surface shows them.
   Pure, on the board so the kickoff and the web print them. */

const mapOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const ADDED_MAX = 8;
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

/* A workstream's outcomes in their own order: [{ id, text }]. */
export const outcomeList = (front) => Object.entries(mapOf(front && front.outcomes)).map(([id, text]) => ({ id, text: String(text) }));

/* A task's served outcomes against its workstream's: null when the workstream
   has none and the task names none, so there is nothing to say. */
export function servesView(outcomes, serves) {
  const have = mapOf(outcomes);
  const ids = Array.isArray(serves) ? serves : [];
  if (!Object.keys(have).length && !ids.length) return null;
  return ids.map((id) => (Object.hasOwn(have, id) ? { id, text: String(have[id]) } : { id, removed: true }));
}

/* 'o2 simpler cards; o3 (removed)', 'none', or '' for nothing to say. */
export function servesText(view) {
  if (!view) return '';
  return view.length ? view.map((s) => s.id + ' ' + (s.removed ? '(removed)' : flat(s.text))).join('; ') : 'none';
}

/* The handoff's tasks-added line from [{ id, name, view }]: at most eight. */
export function addedLine(entries, since) {
  if (!entries.length) return '';
  const what = (t) => (t.view === null ? flat(t.name)
    : '(' + (t.view.length ? t.view.map((s) => (s.removed ? s.id + ' removed' : flat(s.text))).join('; ') : 'serves none') + ')');
  const more = entries.length - ADDED_MAX;
  return 'Tasks added since ' + (since || 'the track began') + ': '
    + entries.slice(0, ADDED_MAX).map((t) => t.id + ' ' + what(t)).join(', ') + (more > 0 ? ', and ' + more + ' more' : '');
}

/* The one growth line, from a shown handoff's map (its `since` a label); ''
   when nothing was counted at all. */
export function growthLine(g) {
  if (!g || typeof g !== 'object') return '';
  const n = (v) => Number(v) || 0;
  const repos = n(g.repos);
  const none = n(g.noBaseline);
  const uncounted = n(g.notCounted);
  if (!n(g.tasksAdded) && !n(g.tasksClosed) && !repos && !none && !uncounted) return '';
  const parts = [plural(n(g.tasksAdded), 'task') + ' added, ' + n(g.tasksClosed) + ' closed'];
  if (repos) {
    parts.push('tests about +' + n(g.testsAdded) + '/-' + n(g.testsRemoved),
      'lines +' + n(g.linesAdded) + '/-' + n(g.linesRemoved) + ' in ' + plural(repos, 'repo'));
  }
  if (none) parts.push(plural(none, 'repo') + ' with no baseline');
  if (uncounted) parts.push(plural(uncounted, 'repo') + ' not counted');
  if (!repos && !none && !uncounted) parts.push('no repos recorded');
  return 'Growth since ' + (g.since ? g.since : 'the track began') + ': ' + parts.join('; ');
}
