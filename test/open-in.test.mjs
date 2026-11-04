/* The FRAME a kind becomes (docs/file-refs-spec.md section 4): the exe is
 * the one opener, so this module answers three shapes and no fourth, and it
 * takes its PLATFORM as an argument so the win32 branch pins anywhere. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_KINDS, checkTemplate, enc, openFrame, tokenize } from '../lib/open-in.mjs';

const FILE = 'X:/synthetic/repo/docs/spec.md';
const DIR = 'X:/synthetic/repo/docs';
const SPACED = 'X:/synthetic/my notes/a b.md';
const SCHEME = {
  editor: { file: 'vscode://file/{path}:{line}:{col}', folder: 'vscode://file/{path}/' },
};
const CMD = (file, folder) => ({ editor: { file, folder: folder === undefined ? '' : folder } });

/* The one list this module publishes and the one the route whitelists against. */
test('the open kinds are the whitelist the route validates against', () => {
  assert.deepEqual([...OPEN_KINDS],
    ['open', 'openwith', 'reveal', 'editor', 'project', 'terminal', 'claude']);
  assert.throws(() => { OPEN_KINDS.push('emacs'); });
});

/* THREE SHAPES AND NO FOURTH, which is what the exe parses. Every frame carries
   its kind, for the exe's journal line and for nothing else. */
test('every kind answers exactly one of the three frame shapes', () => {
  const shape = (frame) => {
    const keys = Object.keys(frame).filter((k) => k !== 'kind').sort().join(',');
    return keys;
  };
  assert.equal(shape(openFrame('open', FILE, false, SCHEME, 'win32')), 'path,verb');
  assert.equal(shape(openFrame('openwith', FILE, false, SCHEME, 'win32')), 'path,verb');
  assert.equal(shape(openFrame('reveal', DIR, true, SCHEME, 'win32')), 'path,verb');
  assert.equal(shape(openFrame('editor', FILE, false, SCHEME, 'win32')), 'url');
  assert.equal(shape(openFrame('claude', DIR, true, SCHEME, 'win32')), 'url');
  assert.equal(shape(openFrame('terminal', DIR, true, SCHEME, 'win32')), 'args,exe');
  assert.equal(shape(openFrame('editor', FILE, false, CMD('code {path}'), 'win32')), 'args,exe');
  /* the kind rides on every one of them */
  for (const kind of OPEN_KINDS) {
    const frame = openFrame(kind, kind === 'openwith' ? FILE : DIR,
      kind !== 'openwith', SCHEME, 'win32');
    assert.equal(frame.kind, kind, kind);
    assert.equal(frame.error, undefined, kind);
  }
});

/* The shell verbs, and nothing between the path and the frame: the exe hands
   ShellExecuteW the verb and the path, so no concatenation happens anywhere. */
test('the verb kinds carry the verb and the path and nothing else', () => {
  assert.deepEqual(openFrame('open', FILE, false, SCHEME, 'win32'),
    { kind: 'open', verb: 'open', path: FILE });
  assert.deepEqual(openFrame('open', DIR, true, SCHEME, 'win32'),
    { kind: 'open', verb: 'open', path: DIR });
  /* the picker on purpose, and it is for a file */
  assert.deepEqual(openFrame('openwith', SPACED, false, SCHEME, 'win32'),
    { kind: 'openwith', verb: 'openas', path: SPACED });
  assert.match(openFrame('openwith', DIR, true, SCHEME, 'win32').error, /open with is for files/);
  /* the system folder handler and no selection, so the caller hands
     the FOLDER in and the frame is an ordinary open */
  assert.deepEqual(openFrame('reveal', DIR, true, SCHEME, 'win32'),
    { kind: 'reveal', verb: 'open', path: DIR });
  /* a spaced path is one field and never a command line */
  assert.equal(openFrame('open', SPACED, false, SCHEME, 'win32').path, SPACED);
});

/* one editor control whose target is a setting, and the line and the
   column both land when the ref names them. */
test('a scheme template fills the path, the line and the column', () => {
  assert.equal(openFrame('editor', { path: FILE, line: '42', col: '7' }, false, SCHEME, 'win32').url,
    'vscode://file/X:/synthetic/repo/docs/spec.md:42:7');
  /* a :{col} tail with no column leaves with it, and so does :{line} */
  assert.equal(openFrame('editor', { path: FILE, line: '42', col: '' }, false, SCHEME, 'win32').url,
    'vscode://file/X:/synthetic/repo/docs/spec.md:42');
  assert.equal(openFrame('editor', { path: FILE, line: '', col: '' }, false, SCHEME, 'win32').url,
    'vscode://file/X:/synthetic/repo/docs/spec.md');
  assert.equal(openFrame('editor', FILE, false, SCHEME, 'win32').url,
    'vscode://file/X:/synthetic/repo/docs/spec.md');
  /* a folder takes the folder template, and `project` takes it whatever the
     target was, with no line or column to place */
  assert.equal(openFrame('editor', DIR, true, SCHEME, 'win32').url,
    'vscode://file/X:/synthetic/repo/docs/');
  assert.equal(openFrame('project', { path: DIR, line: '9', col: '3' }, true, SCHEME, 'win32').url,
    'vscode://file/X:/synthetic/repo/docs/');
  /* the ENCODING: forward slashes, the drive colon and the separators put back,
     and a # or a ? percent-encoded rather than left to shear the URL */
  assert.equal(enc('X:\\a b\\c#d?e.md'), 'X:/a%20b/c%23d%3Fe.md');
  assert.equal(openFrame('editor', 'X:\\a b\\c.md', false, SCHEME, 'win32').url,
    'vscode://file/X:/a%20b/c.md');
  /* A NON-BMP NAME through the encoder: encodeURIComponent is code-point safe,
     so the pair travels as one character's four bytes and never as two halves */
  assert.equal(enc('X:/synthetic/\ud83d\ude00.md'), 'X:/synthetic/%F0%9F%98%80.md');
  assert.equal(openFrame('editor', 'X:/synthetic/\ud83d\ude00.md', false, SCHEME, 'win32').url,
    'vscode://file/X:/synthetic/%F0%9F%98%80.md');
});

/* The command-line half of the editor target: a command line, tokenized once, then
   filled. */
test('a command template tokenizes once and the path fills whole tokens', () => {
  const built = openFrame('editor', SPACED, false,
    CMD('"X:/synthetic/apps/my editor.exe" --wait {path}'), 'win32');
  assert.equal(built.exe, 'X:/synthetic/apps/my editor.exe');
  /* TWO arguments and not four: the program's spaces survived because quotes
     group, and the PATH's because substitution happens after tokenizing */
  assert.deepEqual(built.args, ['--wait', SPACED]);
  /* the line and the column fill inside a token, tail-dropped the same way */
  assert.deepEqual(
    openFrame('editor', { path: FILE, line: '42', col: '7' }, false,
      CMD('code -g "{path}:{line}:{col}"'), 'win32').args,
    ['-g', FILE + ':42:7'],
  );
  assert.deepEqual(
    openFrame('editor', { path: FILE, line: '', col: '' }, false,
      CMD('code -g "{path}:{line}:{col}"'), 'win32').args,
    ['-g', FILE],
  );
  /* a template naming no {path} still runs: how the app finds the file is the
     author's business */
  assert.deepEqual(openFrame('editor', FILE, false, CMD('app --resume'), 'win32'),
    { kind: 'editor', exe: 'app', args: ['--resume'] });
  /* the program alone */
  assert.deepEqual(openFrame('editor', FILE, false, CMD('"X:/synthetic/apps/e.exe"'), 'win32'),
    { kind: 'editor', exe: 'X:/synthetic/apps/e.exe', args: [] });
  /* a path carrying a replacement pattern is data, never a pattern: split and
     join rather than String.replace is what makes that true */
  assert.deepEqual(
    openFrame('editor', 'X:/synthetic/$&/x.md', false, CMD('app {path}'), 'win32').args,
    ['X:/synthetic/$&/x.md'],
  );
  /* the folder template is the one `project` reads, and a command line is as
     good as a scheme there */
  assert.deepEqual(openFrame('project', DIR, true, CMD('', 'shell {path}'), 'win32'),
    { kind: 'project', exe: 'shell', args: [DIR] });
  /* AN ARGV IS NOT A COMMAND LINE: a path carrying % or & is one argument, with
     no encoding and no quoting, because nothing here ever reaches a shell */
  assert.deepEqual(
    openFrame('editor', 'X:/synthetic/100% & more/a b.md', false, CMD('app {path}'), 'win32'),
    { kind: 'editor', exe: 'app', args: ['X:/synthetic/100% & more/a b.md'] },
  );
});

/* THE ONE PROGRAM NAME THE SERVER PUTS ON THE WIRE, and the Claude link, both
   literals in this module. */
test('terminal names wt.exe and the Claude link carries the folder and no q', () => {
  assert.deepEqual(openFrame('terminal', DIR, true, SCHEME, 'win32'),
    { kind: 'terminal', exe: 'wt.exe', args: ['-d', DIR] });
  /* an argv array, so a spaced folder is one argument and never a command line */
  assert.deepEqual(openFrame('terminal', 'X:/synthetic/my notes', true, SCHEME, 'win32').args,
    ['-d', 'X:/synthetic/my notes']);
  const link = openFrame('claude', 'X:/synthetic/my notes', true, SCHEME, 'win32');
  assert.equal(link.url, 'claude://code/new?folder=X%3A%2Fsynthetic%2Fmy%20notes');
  assert.equal(link.url.includes('q='), false, 'no prefilled first message');
  /* neither reads the editor setting at all */
  assert.equal(openFrame('terminal', DIR, true, {}, 'win32').error, undefined);
  assert.equal(openFrame('claude', DIR, true, {}, 'win32').error, undefined);
});

/* Every refusal is a sentence the route hands back as a 409. */
test('every refusal names what is missing or what is not allowed', () => {
  /* an absent or empty template refuses its kind, which is what omits the
     project-folder entry from the overflow */
  assert.match(openFrame('project', DIR, true, CMD('x', ''), 'win32').error,
    /no editor folder template is set/);
  assert.match(openFrame('editor', FILE, false, CMD('', 'x'), 'win32').error,
    /no editor file template is set/);
  assert.match(openFrame('editor', FILE, false, {}, 'win32').error, /no editor file template/);
  assert.match(openFrame('editor', FILE, false, { editor: ['x'] }, 'win32').error,
    /no editor file template/);
  assert.match(openFrame('editor', FILE, false, CMD('  \t '), 'win32').error,
    /no editor file template/);
  /* a template that cannot be read at all: guessing where the quote closes
     would be inventing an argument */
  assert.match(openFrame('editor', FILE, false, CMD('"X:/apps/e.exe --wait'), 'win32').error,
    /unclosed quote/);
  assert.match(openFrame('editor', FILE, false, CMD('"" {path}'), 'win32').error,
    /names no program/);
  /* {path} in the FIRST token would let a ref decide which binary runs, and a
     ref is model-authored while the program is the user's own text */
  for (const tpl of ['{path}', '{path} --wait', '"{path}" --wait', 'X:/apps/{path}.exe x']) {
    const built = openFrame('editor', FILE, false, CMD(tpl), 'win32');
    assert.equal(built.exe, undefined, tpl);
    assert.match(built.error, /names \{path\} as the program to run/, tpl);
  }
  /* and the rule is the first token's alone */
  assert.deepEqual(openFrame('editor', FILE, false, CMD('app {path} --also={path}'), 'win32').args,
    [FILE, '--also=' + FILE]);
  /* THE BAD_SCHEME GATE, on the server: an anchor in the board origin carries
     the identity secret, so a template expanding to script is refused */
  for (const tpl of ['javascript://x/{path}', 'JavaScript://x/{path}', 'data://x/{path}',
    'vbscript://x/{path}']) {
    assert.match(openFrame('editor', FILE, false, CMD(tpl), 'win32').error,
      /a scheme this board never opens/, tpl);
  }
  /* a kind this module does not build, the belt behind the route's whitelist */
  assert.match(openFrame('vscode', FILE, false, SCHEME, 'win32').error, /unknown open kind: vscode/);
  assert.match(openFrame('', FILE, false, SCHEME, 'win32').error, /unknown open kind/);
  assert.match(openFrame('constructor', FILE, false, SCHEME, 'win32').error, /unknown open kind/);
  /* no path is no open, on every kind */
  assert.match(openFrame('open', '', false, SCHEME, 'win32').error, /no path to open/);
  assert.match(openFrame('editor', undefined, false, SCHEME, 'win32').error, /no path to open/);
  /* the exe is a Windows binary, so there is no second answer to give elsewhere */
  for (const os of ['darwin', 'linux', '']) {
    assert.match(openFrame('open', FILE, false, SCHEME, os).error, /Windows alone/, os);
  }
});

test('the tokenizer groups on double quotes and on nothing else', () => {
  assert.deepEqual(tokenize('a b c'), ['a', 'b', 'c']);
  assert.deepEqual(tokenize('  a   b  '), ['a', 'b']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('   '), []);
  assert.deepEqual(tokenize(undefined), []);
  assert.deepEqual(tokenize('"one token here" next'), ['one token here', 'next']);
  /* quotes group, they do not survive, and a quoted run mid-token joins the
     token it is in rather than starting a new one */
  assert.deepEqual(tokenize('--flag="a b" x'), ['--flag=a b', 'x']);
  assert.deepEqual(tokenize('"" x'), ['', 'x']);
  /* a single quote is an ordinary character here: only the double quote groups,
     because a Windows path is full of the other kind of apostrophe trouble */
  assert.deepEqual(tokenize("it's fine"), ["it's", 'fine']);
  /* a tab separates like a space */
  assert.deepEqual(tokenize('a\tb'), ['a', 'b']);
  /* unreadable, and said so rather than guessed at */
  assert.equal(tokenize('"a b'), null);
});

/* THE WRITE-TIME COURTESY: the same four sentences the click makes, off the same
   builder, so a template the settings route takes is one a click can still refuse for
   a reason about the FILE and never about the template. */
test('checkTemplate makes the click own refusals at the write, and passes the rest', () => {
  assert.equal(checkTemplate(''), '', 'an empty template is the off switch');
  assert.equal(checkTemplate('   '), '');
  assert.equal(checkTemplate(undefined), '');
  assert.equal(checkTemplate('vscode://file/{path}:{line}:{col}'), '');
  assert.equal(checkTemplate('"X:/synthetic/apps/my editor.exe" --wait {path}'), '');
  assert.equal(checkTemplate('app --resume'), '', 'a template naming no {path} still runs');
  /* THE SAME FUNCTION THE CLICK CALLS: every sentence here is the one openFrame
     would answer with for that very template, matched whole */
  for (const tpl of ['javascript://x/{path}', 'data://x/{path}', '"X:/synthetic/ed.exe {path}',
    '{path} --wait', '""']) {
    const said = checkTemplate(tpl);
    assert.ok(said, tpl);
    assert.equal(said,
      openFrame('editor', { path: '{path}', line: '1', col: '1' }, false, CMD(tpl), 'win32').error,
      tpl);
  }
});
