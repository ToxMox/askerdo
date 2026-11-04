/* Procedure cards, the pure half (from lib/procedures.mjs and
   lib/proc-match.mjs): a card as the CLI and the mod read it, which cards are a
   project's, and a card shown at this machine's checkout. No database here, so
   each PC's local server answers from its cache; trigger matching itself stays
   lib/proc-match.mjs (matchCall, findCards). */

export const PROC_DIR = 'docs/procedures';
/* README: a few clean runs in a row suggest a script */
export const SCRIPT_AFTER = 3;

/* lib/proc-match.mjs: forward slashes, no trailing slash; a drive path is caseless */
export const normPath = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
const caseless = (p) => (/^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p);
export const isAbsolute = (p) => /^[A-Za-z]:[\\/]/.test(String(p)) || String(p).startsWith('/');

export function relativeTo(dir, path) {
  const d = caseless(normPath(dir));
  const p = normPath(path);
  const lp = caseless(p);
  if (!d) return null;
  if (lp === d) return '';
  return lp.startsWith(d + '/') ? p.slice(d.length + 1) : null;
}
export const sameDir = (a, b) => relativeTo(a, b) === '';

export const fileTriggerText = (t) => (t.repo && t.repo !== 'self' ? t.repo + ':' : '') + t.glob + (t.contains ? ' | ' + t.contains : '');

/* lib/proc-match.mjs badgeOf: flagged, stale, never run or fresh */
export function badgeOf(card) {
  const c = card || {};
  if (c.status === 'retired') return { badge: 'retired', reasons: ['the file is gone from ' + String(c.project || 'its repo')] };
  if (c.flag) return { badge: 'flagged', reasons: ['the last run deviated: ' + c.flag] };
  if (Array.isArray(c.stale) && c.stale.length) return { badge: 'stale', reasons: c.stale.slice() };
  if (!c.verifiedAt) return { badge: 'never run', reasons: [] };
  return { badge: 'fresh', reasons: [] };
}

/* A card as the CLI and the mod read it; `verified` rides along so the PC's
   scan can judge staleness against it. A card names its project only, so
   `project` and `path` are left for the PC to fill from its map (cardsMapped). */
export function cardView(front) {
  const b = badgeOf(front);
  return {
    id: front.id, key: front.key, name: front.name, slug: front.slug, status: front.status, summary: front.summary,
    project: front.project || '', ...(front.projectRepo ? { projectRepo: front.projectRepo } : {}),
    doc: front.doc, path: front.project ? normPath(front.project) + '/' + front.doc : front.doc,
    repos: front.repos || {}, words: front.words || [], commands: front.commands || [], files: front.files || [],
    stale: front.stale || [], flag: front.flag || '', verified: front.verified || {}, verifiedAt: front.verifiedAt || '',
    runs: front.runs || 0, cleanRuns: front.cleanRuns || 0, badge: b.badge, reasons: b.reasons,
    ...(front.everywhere ? { everywhere: true } : {}), ...(front.live ? { live: true } : {}),
  };
}

/* A card is this project's by its shared name, else an old card by its path. */
export const ofRepo = (card, repo) => !!repo && card.projectRepo === repo;
/* the project's card at no folder of this machine's (named only, or another machine's old path) */
export const foreign = (card, repo, homes) => ofRepo(card, repo) && !(homes || []).some((h) => sameDir(h, card.project));

/* A project's cards: by its remote, or at any of its checkouts
   (`homes`, the main one first), the main checkout's first. */
export function cardsOfProject(cards, { project, repo, homes } = {}) {
  const away = (c) => (sameDir(c.project, project) ? 0 : 1);
  return (cards || []).filter((c) => ofRepo(c, repo) || (homes || []).some((h) => sameDir(c.project, h)) || sameDir(c.project, project))
    .sort((a, b) => away(a) - away(b));
}

/* The card a procedure file belongs to: by its slug, else by its file. */
export const cardForFile = (cards, slug, fileName) => cards.find((c) => (slug && c.slug === slug) || c.doc === PROC_DIR + '/' + fileName) || null;

/* A card by PR-n, key, or slug (this project's first). */
export function findCardIn(cards, name, { project, repo } = {}) {
  const raw = String(name || '').trim();
  const all = cards || [];
  if (/^[0-9a-hjkmnp-tv-z]{8}$/.test(raw) || /^pr-\d+$/i.test(raw)) {
    const up = raw.toUpperCase();
    /* a label a retired card held before names the card holding it now */
    const hits = all.filter((c) => c.key === raw || c.id === up);
    return hits.find((c) => c.status !== 'retired') || hits[0] || null;
  }
  const named = all.filter((c) => c.slug === raw.toLowerCase());
  /* a name no card of the project holds is the live everywhere card's */
  return named.find((c) => project && !c.everywhere && (sameDir(c.project, project) || ofRepo(c, repo)))
    || named.find((c) => c.everywhere && c.status !== 'retired')
    || (named.length === 1 ? named[0] : null);
}

/* `proc triggers` at a checkout: the repo's cards scanned on another
   machine shown at `project` (its main checkout here), and the main checkout's
   shown at `here` when `hasDoc(doc)` says the file is in that checkout too. */
export function cardsAt(cards, { project, repo, homes, here, hasDoc } = {}) {
  if (!project) return cards;
  const at = (c, dir) => ({ ...c, project: dir, path: normPath(dir) + '/' + c.doc });
  const rows = cards.map((c) => (foreign(c, repo, homes || [project]) ? at(c, project) : c));
  if (!here || sameDir(project, here)) return rows;
  /* an everywhere card stays at the plugin root it was read from */
  return rows.map((c) => (!c.everywhere && sameDir(c.project, project) && (!hasDoc || hasDoc(c.doc)) ? at(c, here) : c));
}
