/* Today's frontmatter, read leniently and written back in file order. The
   reader and scalar rules mirror the old store's so a record renders to the
   bytes its file holds; strict YAML refuses three live files, this does not. */

const FULL_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

export function fmScalar(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (FULL_STAMP.test(s)) return s;
  if (s === '' || /^\s|\s$/.test(s) || s.includes(':') || s.includes('#')
    || /[\r\n\u2028\u2029]/.test(s) || s.startsWith('"')
    || s === 'true' || s === 'false' || /^\d+$/.test(s)) {
    return JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }
  return s;
}

function parseScalar(s) {
  if (s.startsWith('"')) {
    try { return JSON.parse(s); } catch { throw new Error('bad quoted scalar: ' + s); }
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^\d+$/.test(s)) return Number(s);
  return s;
}

/* Keys in file order: a list, a one-level map, a scalar, or [] for a bare `key:`. */
export function parseFront(text) {
  const front = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const m = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (!m) throw new Error('bad frontmatter line: ' + line);
    const rest = m[2].trim();
    if (rest !== '') {
      front[m[1]] = parseScalar(rest);
    } else if (i + 1 < lines.length && lines[i + 1].startsWith('  - ')) {
      const arr = [];
      while (i + 1 < lines.length && lines[i + 1].startsWith('  - ')) arr.push(parseScalar(lines[++i].slice(4).trim()));
      front[m[1]] = arr;
    } else if (i + 1 < lines.length && /^  [A-Za-z]/.test(lines[i + 1])) {
      const map = {};
      while (i + 1 < lines.length && /^  [A-Za-z]/.test(lines[i + 1])) {
        const mm = /^  ([A-Za-z][A-Za-z0-9_-]*): (.*)$/.exec(lines[++i]);
        if (!mm) throw new Error('bad frontmatter map line: ' + lines[i]);
        map[mm[1]] = parseScalar(mm[2].trim());
      }
      front[m[1]] = map;
    } else {
      front[m[1]] = [];
    }
  }
  return front;
}

/* The inverse of parseFront: an empty list and an empty string are both `key:`. */
export function frontText(front) {
  const out = [];
  for (const [k, v] of Object.entries(front)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      out.push(k + ':');
      for (const x of v) out.push('  - ' + fmScalar(x));
    } else if (typeof v === 'object') {
      out.push(k + ':');
      for (const [s, x] of Object.entries(v)) if (x !== undefined && x !== null) out.push('  ' + s + ': ' + fmScalar(x));
    } else if (v === '') {
      out.push(k + ':');
    } else {
      out.push(k + ': ' + fmScalar(v));
    }
  }
  return out.join('\n') + '\n';
}

/* A record file split at its frontmatter fence. */
export function splitFile(text) {
  if (!text.startsWith('---\n')) throw new Error('missing frontmatter');
  const end = text.indexOf('\n---\n', 3);
  if (end < 0) throw new Error('unterminated frontmatter');
  return { fields: parseFront(text.slice(4, end + 1)), rest: text.slice(end + 5) };
}
