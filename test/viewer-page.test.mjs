/* The board's FILE VIEWER page, in process: metadata in, HTML out, and the
 * MODULE reads no file, which is the point. Every path is synthetic because
 * this file is public. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderRefView, baseName, extOf } from '../lib/viewer-page.mjs';
import { pluginRoot } from '../lib/node-helpers.mjs';

const META = {
  assetBase: '/s/assets',
  recordId: 'T-4',
  recordName: 'file refs, cut 2',
  ref: 'X:/synthetic/repo/docs/spec.md',
  index: 2,
  total: 5,
  rawUrl: '/s/f/T-4/2/raw',
  backUrl: '/s/w/T-4',
  cap: 1048576,
  version: '9.9.9',
  /* the open-in payload, ENTIRE: one route the row posts a kind to. No template and
     no program name is a field here, because nothing is minted in the browser. */
  openUrl: '/s/f/T-4/2/open',
};

const render = (over = {}) => renderRefView({ ...META, ...over });

test('the page names the record, the path, and where the bytes are, and nothing else', () => {
  const html = render();
  assert.ok(html.includes('<p class="rv-path">X:/synthetic/repo/docs/spec.md</p>'));
  assert.ok(html.includes('<a class="wref" href="/s/w/T-4">T-4</a>'));
  assert.ok(html.includes('<span>file refs, cut 2</span>'));
  /* the index is said the way a person counts, one-based, against the total */
  assert.ok(html.includes('<span class="chip">ref 3 of 5</span>'));
  /* the raw url and the extension ride as a literal the page script reads; the
     extension is computed HERE so the client never re-parses the path */
  assert.ok(html.includes('"raw":"/s/f/T-4/2/raw"'));
  assert.ok(html.includes('"ext":"md"'));
  assert.ok(html.includes('"cap":1048576'));
  assert.ok(html.includes('board 9.9.9'));
  /* the tab says which file, not which record: a reader with four viewer tabs
     open is telling them apart by filename */
  assert.ok(html.includes('<title>AskerDo file spec.md</title>'));
  /* with no line, the field is there and empty: the client reads a field, never
     a colon tail, so it must be a field even when the ref named none */
  assert.ok(html.includes('"line":""'));

  /* a LINE was cut off the ref by the server and arrives beside the path. The
     reader still sees the spelling the record wrote, because the path is this
     page's subject; everything derived comes off the two fields instead. */
  const lined = render({ line: '42' });
  assert.ok(lined.includes('<p class="rv-path">X:/synthetic/repo/docs/spec.md:42</p>'));
  assert.ok(lined.includes('"line":"42"'));
  /* and the extension is still md, not md:42, because the ref it is read off
     was cut once and upstream */
  assert.ok(lined.includes('"ext":"md"'));
  assert.ok(lined.includes('"path":"X:/synthetic/repo/docs/spec.md"'));
  assert.ok(lined.includes('<title>AskerDo file spec.md</title>'));
});

test('the shell wears the house sheet, the quiet mark, and the client stack', () => {
  const html = render();
  assert.ok(html.includes('<link rel="stylesheet" href="/s/assets/house.css">'));
  assert.ok(html.includes('<link rel="icon" href="/s/assets/favicon-quiet.svg">'));
  assert.ok(html.includes('<meta name="color-scheme" content="dark">'));
  /* no stylesheet of its own: house tokens plus one chrome block, the work
     surface's own rule */
  assert.equal((html.match(/<link rel="stylesheet"/g) || []).length, 1);
  /* the three vendored bundles, from the shared asset routes and from nowhere
     else: a viewer that reached a CDN would be the remote fetch this page has
     promised never to make */
  assert.deepEqual(html.match(/<script src="[^"]*"><\/script>/g), [
    '<script src="/s/assets/markdown-it.min.js"></script>',
    '<script src="/s/assets/purify.min.js"></script>',
    '<script src="/s/assets/highlight.min.js"></script>',
  ]);
  /* one inline script, the page script, and no other */
  assert.equal((html.match(/<script>/g) || []).length, 1);
});

test('the page script parses, sanitizes every fragment, and forbids the media tags', () => {
  const html = render();
  const script = /<script>\n([\s\S]*?)\n<\/script>/.exec(html)[1];
  assert.doesNotThrow(() => new Script(script, { filename: 'viewer-page.js' }));
  /* every HTML insertion goes through ONE function, and that function
     sanitizes: two innerHTML assignments would be two places to check */
  assert.equal((script.match(/innerHTML/g) || []).length, 1);
  assert.ok(script.includes('out.innerHTML = window.DOMPurify.sanitize(html, PURIFY);'));
  /* text only, no remote fetches: the forbid list names them rather than
     trusting a default */
  for (const tag of ['img', 'picture', 'source', 'video', 'audio', 'iframe', 'object',
    'embed', 'svg', 'style', 'link']) {
    assert.ok(script.includes('"' + tag + '"'), tag);
  }
  /* the ladder's rungs, each present and each falling back to plain */
  for (const needle of ['markdownit(', 'JSON.parse(text)', 'window.hljs.highlight(',
    'pre.textContent = text;', 'RICH_MAX = 204800']) {
    assert.ok(script.includes(needle), needle);
  }
  /* every refusal the raw route can answer with has a sentence here, the folder state
     included */
  for (const status of ['404', '409', '413', '415']) {
    assert.ok(script.includes('res.status === ' + status), status);
  }
  /* A FOLDER IS ITS OWN STATE, not a 404 saying the file is gone, and NOT a red one:
     the hue is empty, so the box wears the page's own ink and the controls stand. */
  assert.ok(script.includes('refuse("", "This ref names a folder, not a file.'));
  assert.ok(script.includes('box.className = hue ? "callout " + hue : "callout";'));
  assert.ok(script.includes('the controls above open the folder itself.'));
  /* and the 404's own red sentence is exactly what it was, for a file that is
     really gone */
  assert.ok(script.includes('refuse("red", "This file was named here, '
    + 'and it is not there now. "'));
  /* A STRING-LEVEL PIN on the forbidden sinks: innerHTML through insert() is
     the only way HTML reaches this page. A text search cannot prove the
     sanitizer, but a second door cannot be added without failing here. */
  for (const sink of ['insertAdjacentHTML', 'outerHTML', 'document.write',
    'createContextualFragment', 'DOMParser']) {
    assert.ok(!script.includes(sink), sink);
  }
  /* rendered markdown anchors wear the refs chips' own outbound posture, in
     ONE post-sanitize pass over whatever survived the sanitizer */
  assert.equal((script.match(/addHook/g) || []).length, 1);
  assert.ok(script.includes('window.DOMPurify.addHook("afterSanitizeAttributes"'));
  assert.ok(script.includes('node.setAttribute("target", "_blank");'));
  assert.ok(script.includes('node.setAttribute("rel", "noreferrer");'));
});

test('every metadata string is escaped, prose and attribute alike', () => {
  const hostile = '<script>alert(1)</script>';
  const html = render({
    recordId: hostile,
    recordName: hostile,
    ref: 'C:/repos/' + hostile + '/x.md',
    backUrl: '/s/w/' + hostile,
    rawUrl: '/s/f/' + hostile + '/0/raw',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!/href="[^"]*[<>]/.test(html), 'no href carries a raw metacharacter');
  /* the literal helper escapes '<' so a metadata string can never close the
     script body it rides in */
  assert.ok(!/<script>[\s\S]*?<\/script>[\s\S]*?<\/script>/.test(html));
  /* two script elements would mean the payload opened one */
  assert.equal((html.match(/<script/g) || []).length, 4);
});

test('the viewer chrome sizes and shapes everything through house tokens', () => {
  const chrome = render().match(/<style>[\s\S]*?<\/style>/)[0];
  const bare = (text, prop, token) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/[;{}]/)
    .map((d) => d.trim())
    .filter((d) => new RegExp('^' + prop + '\\s*:').test(d))
    .filter((d) => /[0-9](\.[0-9]+)?px/.test(d))
    .filter((d) => !d.includes(token));
  /* the holes, proved caught before the chrome is judged by them */
  assert.deepEqual(bare('.a { font: 650 14px/1.5 system-ui; }', 'font(-size)?', 'var(--fs-'),
    ['font: 650 14px/1.5 system-ui']);
  assert.deepEqual(bare('.a { box-shadow: 0 2px 4px #000 }', 'box-shadow', 'var(--shadow-'),
    ['box-shadow: 0 2px 4px #000']);
  assert.deepEqual(bare(chrome, 'font(-size)?', 'var(--fs-'), []);
  assert.deepEqual(bare(chrome, 'border-radius', 'var(--r-'), []);
  assert.deepEqual(bare(chrome, 'box-shadow', 'var(--shadow-'), []);
  /* and the two mono blocks resolve their face through the sheet as well */
  assert.equal((chrome.match(/font-family: var\(--font-mono\)/g) || []).length, 3);
});

test('the path readers agree with the shapes a ref really takes', () => {
  assert.equal(baseName('X:/synthetic/repo/docs/spec.md'), 'spec.md');
  assert.equal(baseName('C:\\synthetic\\repo\\notes.txt'), 'notes.txt');
  assert.equal(baseName('/synthetic/README'), 'README');
  assert.equal(baseName('bare.md'), 'bare.md');
  /* a path ending in a separator has no name of its own and keeps the string */
  assert.equal(baseName('/synthetic/dir/'), '/synthetic/dir/');
  assert.equal(baseName(''), '');

  assert.equal(extOf('X:/synthetic/repo/docs/spec.md'), 'md');
  assert.equal(extOf('C:\\synthetic\\repo\\RUN.LOG'), 'log');
  assert.equal(extOf('/synthetic/repo/Makefile'), '');
  /* a dot in a directory further up is not this file's extension */
  assert.equal(extOf('/synthetic/v1.2/README'), '');
  /* a leading dot is a whole filename, not an extension */
  assert.equal(extOf('/synthetic/repo/.gitignore'), '');
  assert.equal(extOf(''), '');
});

/* ---- the page script, RUN rather than read ----------------------------- */

/* The ladder is branches and a string search passes on a branch that never
   fires, so one harness RUNS the emitted script against the real markdown-it
   bundle. The sanitizer is stubbed, which is the harness's one limit. */
const MD_BUNDLE = readFileSync(join(pluginRoot, 'assets', 'markdown-it.min.js'), 'utf8');

function element(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    className: '',
    textContent: '',
    innerHTML: '',
    href: '',
    disabled: false,
    parentNode: null,
    attrs: Object.create(null),
    kids: [],
    listeners: Object.create(null),
    appendChild(child) { this.kids.push(child); child.parentNode = this; return child; },
    getAttribute(name) { return this.attrs[name] === undefined ? null : this.attrs[name]; },
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    /* the controls of this row, in render order: the page script walks up from
       the click target instead, and this stays honest for a caller that asks */
    querySelectorAll() { return this.kids.filter((k) => k.attrs['data-open-kind'] !== undefined); },
  };
}

/* The opener row, built from the HTML the module really emitted: every control
   is a BUTTON that posts now, and reading the tags back keeps the harness
   honest about that. */
function pickerRow(html) {
  const row = element('p');
  const block = /<p class="rv-open" id="rv-open">([\s\S]*?)<\/p>/.exec(html);
  if (!block) return row;
  for (const m of block[1].matchAll(/<(a|button) class="ab-btn"[^>]*data-open-kind="([a-z]+)"/g)) {
    const el = element(m[1]);
    el.className = 'ab-btn';
    el.setAttribute('data-open-kind', m[2]);
    row.appendChild(el);
  }
  return row;
}

/* A localStorage that records, or one that throws on every access: a browser
   with site data switched off is the second, and the page must not care. */
function fakeStorage(mode = 'ok') {
  const store = new Map();
  return {
    reads: 0,
    getItem(key) {
      this.reads++;
      if (mode === 'throws') throw new Error('access denied');
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (mode === 'throws') throw new Error('access denied');
      store.set(key, value);
    },
    seen: store,
  };
}

async function runScript({
  ref, text, langs = [], status = 200, length, over = {}, storage, openStatus = 200, openBody,
}) {
  const html = render({ ref, ...over });
  const script = /<script>\n([\s\S]*?)\n<\/script>/.exec(html)[1];
  const out = element('div');
  const note = element('p');
  const row = pickerRow(html);
  const oops = element('span');
  const posts = [];
  const ctx = {};
  /* the context IS its own window, so a UMD bundle's global assignment and the
     script's own window.<name> reads land on the same object */
  ctx.window = ctx;
  ctx.localStorage = storage || fakeStorage();
  const byId = {
    'rv-out': out, 'rv-note': note, 'rv-open': row, 'rv-open-error': oops,
  };
  ctx.document = {
    getElementById: (id) => (byId[id] === undefined ? null : byId[id]),
    createElement: element,
  };
  ctx.DOMPurify = { sanitize: (html2) => html2, addHook: () => {} };
  ctx.hljs = {
    getLanguage: (name) => (langs.includes(name) ? { name } : undefined),
    highlight: (body, opts) => ({ value: '[' + opts.language + ']' + body }),
  };
  ctx.fetch = (url, init) => {
    if (init && init.method === 'POST') {
      posts.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return Promise.resolve({
        status: openStatus,
        json: () => (openBody === undefined
          ? Promise.reject(new Error('not json'))
          : Promise.resolve(openBody)),
      });
    }
    return Promise.resolve({
      status,
      headers: {
        get: (k) => (k === 'content-length' && length !== undefined ? String(length) : null),
      },
      text: () => Promise.resolve(text),
    });
  };
  createContext(ctx);
  new Script(MD_BUNDLE).runInContext(ctx);
  new Script(script).runInContext(ctx);
  /* the script's own promise chain runs on this same microtask queue */
  await new Promise((r) => setTimeout(r, 0));
  const click = async (id) => {
    const el = row.kids.find((k) => k.attrs['data-open-kind'] === id);
    assert.ok(el, 'no control for ' + id);
    let prevented = false;
    row.listeners.click({ target: el, preventDefault() { prevented = true; } });
    await new Promise((r) => setTimeout(r, 0));
    return { el, prevented };
  };
  return { out, note, row, oops, posts, click, storage: ctx.localStorage };
}

/* The extension map is a promise this page cannot keep alone: a mapping to a
   language the bundle does not carry falls back to plain text while the map
   still claims a colour, so it is checked against the SHIPPED asset. */
test('every language the extension map names is one the shipped bundle carries', () => {
  const script = /<script>\n([\s\S]*?)\n<\/script>/.exec(render())[1];
  const literal = /var LANGS = (Object\.assign\([\s\S]*?\}\));/.exec(script)[1];
  const langs = new Script('(' + literal + ')').runInThisContext();
  const ctx = {};
  ctx.window = ctx;
  createContext(ctx);
  new Script(readFileSync(join(pluginRoot, 'assets', 'highlight.min.js'), 'utf8')).runInContext(ctx);
  for (const name of new Set(Object.values(langs))) {
    assert.ok(ctx.hljs.getLanguage(name), name);
  }
  /* the one language added on top of the common set, and the reason it is there: on
     Windows, ps1 is as ordinary a ref as sh is anywhere else */
  assert.equal(langs.ps1, 'powershell');
  assert.equal(langs.psm1, 'powershell');
  assert.ok(ctx.hljs.getLanguage('powershell'));
  /* the control, so the loop above can be seen to be able to fail */
  assert.ok(!ctx.hljs.getLanguage('gradle'));
});

test('every fence wears the same tile, the ones the bundle cannot color included', async () => {
  const { out } = await runScript({
    ref: 'X:/synthetic/repo/docs/doc.md',
    text: '```\nbare\n```\n\n```mermaid\ngraph TD;\n```\n\n```js\nvar x = 1;\n```\n',
    langs: ['javascript'],
  });
  assert.equal(out.className, 'rv-out rv-md');
  assert.equal((out.innerHTML.match(/<pre class="rv-code">/g) || []).length, 3,
    'bare, mermaid, and js all land in the same block');
  /* the two the bundle cannot color are escaped and uncolored, and neither is
     interpreted: mermaid and katex are out of scope */
  assert.ok(out.innerHTML.includes('<pre class="rv-code"><code>bare\n</code></pre>'), out.innerHTML);
  assert.ok(out.innerHTML.includes('<pre class="rv-code"><code>graph TD;\n</code></pre>'), out.innerHTML);
  /* and the one it can carries the highlighter's own output */
  assert.ok(out.innerHTML.includes('<code class="hljs">[javascript]var x = 1;'), out.innerHTML);
  /* markdown-it's own wrapper never appears: that is a pre this sheet does not
     style, and a document mixing the two would show one fence in a tile and the
     next one bare */
  assert.ok(!/<pre><code/.test(out.innerHTML), out.innerHTML);
});

test('a fence body the highlighter never saw is escaped before it is wrapped', async () => {
  const { out } = await runScript({
    ref: 'X:/synthetic/repo/docs/doc.md',
    text: '```\n</code></pre><img src=x onerror="boom">\n```\n',
  });
  assert.ok(!out.innerHTML.includes('<img'), out.innerHTML);
  assert.ok(out.innerHTML.includes('&lt;/code&gt;&lt;/pre&gt;&lt;img src=x onerror=&quot;boom&quot;&gt;'),
    out.innerHTML);
  assert.equal((out.innerHTML.match(/<\/pre>/g) || []).length, 1, 'one tile, not two');
});

test('an extension that names an Object property is still just an extension', async () => {
  const { out } = await runScript({ ref: 'X:/synthetic/repo/x.constructor', text: 'plain body\n' });
  /* both maps are prototype-free, so this lands on plain: an inherited truthy
     value would have sent it to markdown, or to a highlighter for a language
     called "function Object() { [native code] }" */
  assert.equal(out.className, 'rv-out');
  assert.equal(out.innerHTML, '');
  assert.equal(out.kids.length, 1);
  assert.equal(out.kids[0].className, 'rv-code');
  assert.equal(out.kids[0].textContent, 'plain body\n');
});

test('the rich-render cap measures the bytes the server said, not the characters', async () => {
  const { out, note } = await runScript({
    ref: 'X:/synthetic/repo/docs/doc.md',
    text: '# head\n',
    /* seven characters, and a content-length over the cap: only the header can
       tell those apart, which is the branch this pins */
    length: 204801,
  });
  assert.equal(out.className, 'rv-out', 'no markdown was rendered');
  assert.ok(note.textContent.includes('204800'), note.textContent);
  assert.equal(out.kids[0].textContent, '# head\n');
});

/* ---- open in (docs/file-refs-spec.md section 4) ------------------------ */

const openIds = (html) => (html.match(/data-open-kind="([a-z]+)"/g) || [])
  .map((s) => s.slice('data-open-kind="'.length, -1));

/* four controls and no picker, every one of them a BUTTON,
   because the exe is the one opener and the browser mints nothing. */
test('the opener row is four buttons that post a kind', () => {
  const html = render();
  assert.ok(html.includes('<p class="rv-open" id="rv-open">'));
  assert.deepEqual(openIds(html), ['open', 'openwith', 'editor', 'reveal']);
  assert.ok(html.includes('<button class="ab-btn" type="button" data-open-kind="open">open</button>'));
  assert.ok(html.includes('<button class="ab-btn" type="button" data-open-kind="openwith">open with</button>'));
  assert.ok(html.includes('<button class="ab-btn" type="button" data-open-kind="editor">editor</button>'));
  assert.ok(html.includes('<button class="ab-btn" type="button" data-open-kind="reveal">reveal</button>'));
  /* NOT ONE ANCHOR: every control is a POST */
  assert.equal(/<a class="ab-btn"/.test(html), false);
  /* the answer bar's own vocabulary, so house.css needs nothing new. NO LABEL:
     the row sits under the path it acts on and the four words say it. */
  assert.equal(html.includes('class="ab-label"'), false);
  assert.ok(html.includes('<span class="ab-sep"></span>'));
  assert.ok(html.includes('<span class="ab-error" id="rv-open-error"></span>'));
  /* `data-open` is the board shell's own pane attribute, so the row wears the
     opener's name instead and cannot collide with it */
  assert.equal(/data-open="/.test(html), false);
});

/* The redline (spec section 6) as a property of this module: the page names a
   KIND and carries neither a command nor a template, under every spelling a
   caller could smuggle one in with. */
test('no template and no program name reaches the page, whatever the meta carries', () => {
  const html = render({
    hasCommand: true,
    schemeTemplate: 'editor://open?f={path}',
    editor: { file: '"X:/synthetic/apps/editor.exe" --wait {path}' },
    openCommand: '"X:/synthetic/apps/editor.exe" --wait {path}',
    openPreset: 'vscode',
  });
  assert.ok(!html.includes('editor.exe'), 'no command text, under any key');
  assert.ok(!html.includes('--wait'));
  assert.ok(!html.includes('synthetic/apps'));
  assert.ok(!html.includes('editor://open?f='), 'and no template either, since none is expanded here');
  /* and nothing is minted client-side: no URL scheme is built in the script at all */
  const script = /<script>\n([\s\S]*?)\n<\/script>/.exec(html)[1];
  for (const needle of ['vscode://', 'obsidian://', 'mintUrl', 'schemeUrl', 'BAD_SCHEME',
    'localStorage']) {
    assert.ok(!script.includes(needle), needle);
  }
  /* the REF literal is the whole payload: the path, the two numbers and the one
     route, and no preset or template beside them */
  assert.deepEqual(Object.keys(JSON.parse(/var REF = (\{[\s\S]*?\});/.exec(html)[1])).sort(),
    ['cap', 'col', 'ext', 'line', 'open', 'path', 'raw']);
});

/* the other half: the ref's LINE and COLUMN are cut off it by the server
   and arrive as their own fields, so nothing here re-reads a ref. */
test('the line and the column ride as fields and the reader sees the ref as written', () => {
  assert.ok(render().includes('"col":""'), 'the field is there and empty when the ref named none');
  const lined = render({ line: '42', col: '7' });
  assert.ok(lined.includes('<p class="rv-path">X:/synthetic/repo/docs/spec.md:42:7</p>'));
  assert.ok(lined.includes('"line":"42"'));
  assert.ok(lined.includes('"col":"7"'));
  assert.ok(lined.includes('"path":"X:/synthetic/repo/docs/spec.md"'));
  /* a column with no line cannot come off lineCut, and is not drawn if it does */
  assert.ok(render({ col: '7' }).includes('<p class="rv-path">X:/synthetic/repo/docs/spec.md</p>'));
  /* and the extension is still md, because the ref it is read off was cut once
     and upstream */
  assert.ok(lined.includes('"ext":"md"'));
});

test('a control posts its kind and a refusal lands in the row, not on the file', async () => {
  const r = await runScript({
    ref: 'X:/synthetic/repo/notes.txt',
    text: 'x\n',
    openStatus: 409,
    openBody: { error: 'open with is for files' },
  });
  const { el, prevented } = await r.click('openwith');
  assert.equal(prevented, true, 'a button posts rather than navigating');
  assert.deepEqual(r.posts.map((p) => [p.url, p.body]),
    [['/s/f/T-4/2/open', { kind: 'openwith' }]]);
  assert.equal(r.posts[0].headers['Content-Type'], 'application/json');
  /* the failure is the SERVER'S OWN SENTENCE, in the answer bar's error
     vocabulary, and the row is where it is said */
  assert.equal(r.oops.textContent, 'open with is for files');
  /* and the control comes back, because success here is not a reload */
  assert.equal(el.disabled, false);
  /* the file itself is untouched by any of it */
  assert.equal(r.out.kids[0].textContent, 'x\n');

  /* every one of the four posts its own kind and nothing else */
  for (const kind of ['open', 'editor', 'reveal']) {
    const one = await runScript({ ref: META.ref, text: 'x\n' });
    await one.click(kind);
    assert.deepEqual(one.posts.map((p) => p.body), [{ kind }], kind);
  }

  /* a refusal with no JSON body still says something a reader can act on */
  const mute = await runScript({ ref: META.ref, text: 'x\n', openStatus: 500 });
  await mute.click('reveal');
  assert.equal(mute.oops.textContent, 'the board answered 500');

  /* and a 200 leaves no line at all */
  const ok = await runScript({ ref: META.ref, text: 'x\n' });
  await ok.click('reveal');
  assert.equal(ok.posts.length, 1);
  assert.equal(ok.oops.textContent, '');
});

test('a render with no metadata at all is still a page and never throws', () => {
  const html = renderRefView();
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<div class="rv-out" id="rv-out"></div>'));
  /* no version, no footnote; no back url, no anchor */
  assert.ok(!html.includes('<p class="footnote rv-foot">'));
  assert.ok(!html.includes('class="wref" href'));
  assert.ok(html.includes('"ext":""'));
});
