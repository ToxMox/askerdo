/* Pure by design, so the platform arrives as an argument and win32 pins on any
 * runner. The hard rules: a path is always an argv element or a
 * frame field, never shell text, and the template is the user's own setting. */

/* The kinds a page may ask for. Exported because
 * the route's validator whitelists against this list and the builder switches
 * on it. */
export const OPEN_KINDS = Object.freeze([
  'open', 'openwith', 'reveal', 'editor', 'project', 'terminal', 'claude',
]);

const PATH_MARK = '{path}';
const LINE_MARK = '{line}';
const COL_MARK = '{col}';

/* A scheme template is a URL and a command template is an argv: the `://` is
 * what tells them apart, since a drive letter carries one slash and not two. */
const SCHEME_URL = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/* An anchor in this origin carries the board identity secret in its own URL, so
 * a template expanding to script would be script where the secret is. The
 * control characters are stripped FOR THE TEST ALONE, never from the URL. */
const BAD_SCHEME = /^(?:javascript|data|vbscript):/i;

/* split/join rather than replace: a path carrying $& or $1 would be read as a
 * replacement pattern. */
function fill(token, path) {
  return String(token).split(PATH_MARK).join(path);
}

/* Quotes group and do not survive; null for an unclosed quote, since guessing
 * where it closes would invent an argument. Tokenizing happens before
 * substitution, so a path with spaces can never split into two arguments. */
export function tokenize(template) {
  const s = String(template === undefined || template === null ? '' : template);
  const out = [];
  let cur = '';
  let started = false;
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') {
      quoted = !quoted;
      started = true;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (started) out.push(cur);
      cur = '';
      started = false;
      continue;
    }
    cur += ch;
    started = true;
  }
  if (quoted) return null;
  if (started) out.push(cur);
  return out;
}

/* Forward slashes, percent-encoded, with the separators and the drive colon put
 * back: a wholly encoded path arrives as one opaque segment, and encodeURI
 * leaves # and ? standing, either of which would shear the URL. */
export function enc(p) {
  return encodeURIComponent(String(p).replace(/\\/g, '/'))
    .replace(/%2F/g, '/').replace(/%3A/g, ':');
}

/* With no line or no column to place, the `:{line}` or `:{col}` tail leaves with
 * it rather than leaving a bare colon behind. */
function expand(template, path, line, col, encode) {
  let tpl = String(template);
  if (!col) tpl = tpl.split(':' + COL_MARK).join('');
  if (!line) tpl = tpl.split(':' + LINE_MARK).join('');
  return tpl.split(PATH_MARK).join(encode ? enc(path) : path)
    .split(LINE_MARK).join(line)
    .split(COL_MARK).join(col);
}

function textOf(v) {
  return String(v === undefined || v === null ? '' : v);
}

/* The one editor setting, read defensively: the merge already typed
 * it, and this module is handed whatever a caller holds. */
function templateOf(settings, which) {
  const e = settings.editor;
  if (!e || typeof e !== 'object' || Array.isArray(e)) return '';
  return textOf(e[which]).trim();
}

/* A template is a URL or an argv, and the two refuse different things. Nothing
 * here touches the filesystem: the program is the exe's answer and the file was
 * the refs allowlist's. */
function fromTemplate(kind, template, spot) {
  if (SCHEME_URL.test(template)) {
    const url = expand(template, spot.path, spot.line, spot.col, true);
    if (BAD_SCHEME.test(url.replace(/[\u0000-\u0020]/g, ''))) {
      return { error: 'the editor template expands to a scheme this board never opens' };
    }
    return { kind, url };
  }
  const tokens = tokenize(expand(template, PATH_MARK, spot.line, spot.col, false));
  if (tokens === null) return { error: 'the editor template has an unclosed quote' };
  /* A ref is model-authored, so a template that would let one decide which
   * binary runs is refused; the program is always the user's own literal text. */
  if (tokens.length && tokens[0].includes(PATH_MARK)) {
    return { error: 'the editor template names {path} as the program to run; '
      + 'the program has to be your own text' };
  }
  const argv = tokens.map((token) => fill(token, spot.path));
  if (!argv.length || !argv[0]) return { error: 'the editor template names no program' };
  return { kind, exe: argv[0], args: argv.slice(1) };
}

/* THE CLICK'S OWN REFUSAL, OFFERED AT THE WRITE: the settings route calls
 * this per field, so a template every later click would answer with a sentence is
 * refused where it is typed. An EMPTY template is the off switch, and is fine. */
export function checkTemplate(template) {
  const t = textOf(template).trim();
  if (!t) return '';
  const built = fromTemplate('editor', t, { path: PATH_MARK, line: '1', col: '1' });
  return built.error || '';
}

/* THE ONE FRAME BUILDER, and the exe is the one opener: three
 * shapes and no fourth, or a sentence the route hands back as a 409. `target` is
 * a resolved path, or the `{ path, line, col }` a ref was cut into. */
export function openFrame(kind, target, isDir, settings, platform) {
  const id = textOf(kind);
  const spot = target && typeof target === 'object'
    ? { path: textOf(target.path), line: textOf(target.line), col: textOf(target.col) }
    : { path: textOf(target), line: '', col: '' };
  const dir = isDir === true;
  const s = settings && typeof settings === 'object' ? settings : {};
  const os = textOf(platform);
  if (!OPEN_KINDS.includes(id)) return { error: 'unknown open kind: ' + id };
  if (!spot.path) return { error: 'there is no path to open' };
  /* The tray exe is the one opener and it is a Windows binary, so there is no
   * second answer to give anywhere else. */
  if (os !== 'win32') return { error: 'the native opener is wired on Windows alone' };
  if (id === 'open' || id === 'reveal') return { kind: id, verb: 'open', path: spot.path };
  if (id === 'openwith') {
    /* the picker is for a file, and the shell has no openas for a
     * folder to reach. */
    if (dir) return { error: 'open with is for files' };
    return { kind: id, verb: 'openas', path: spot.path };
  }
  /* THE ONE PROGRAM NAME THE SERVER PUTS ON THE WIRE, and the store never named
   * it: Windows Terminal at the folder. */
  if (id === 'terminal') return { kind: id, exe: 'wt.exe', args: ['-d', spot.path] };
  /* the folder and no q=, because a prefilled first message is a message
   * the board wrote into a session the person did not type. */
  if (id === 'claude') {
    return { kind: id, url: 'claude://code/new?folder=' + encodeURIComponent(spot.path) };
  }
  const which = id === 'project' || dir ? 'folder' : 'file';
  const template = templateOf(s, which);
  /* An absent template omits the entry and refuses the kind, as an absent
   * flag omits its line. */
  if (!template) {
    return { error: 'no editor ' + which + ' template is set; set one on the notifications page' };
  }
  return fromTemplate(id, template, id === 'project' ? { ...spot, line: '', col: '' } : spot);
}
