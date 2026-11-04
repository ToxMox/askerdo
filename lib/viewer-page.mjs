/* The board's FILE VIEWER page, rendered from METADATA ONLY (docs/file-refs-spec.md section 3):
   not a byte of the referenced file is baked in, so the server never parses
   viewed content. Every fragment goes through DOMPurify. */

/* ---- small helpers ----------------------------------------------------- */

/* A value the page script reads, embedded as a JavaScript literal. '<' is
   escaped so a payload can never open a tag out of a script body, and the two
   unicode line separators end a line in JavaScript but not in JSON. */
function literal(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function oneLine(s) {
  return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim();
}

/* The last segment of a path, by either separator, for the tab's title. A path
   ending in a separator has no name of its own and keeps the whole string. */
export function baseName(path) {
  const s = String(path === undefined || path === null ? '' : path);
  const cut = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  const tail = cut < 0 ? s : s.slice(cut + 1);
  return tail || s;
}

/* The lowercase extension, computed HERE and handed to the page script as a
   field, so the client never re-parses the path. A leading dot is a whole
   filename, and a dot further up the path is not this file's. */
export function extOf(path) {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/* ---- the chrome -------------------------------------------------------- */

/* house.css carries the tokens every rule below resolves its sizes, radii and
   shadows through, exactly as the board and work chrome do. */
function chrome() {
  return [
    '.board-head, .rv-main, .rv-foot { max-width: 1100px; margin-left: auto; margin-right: auto; }',
    '.board-head { margin-bottom: 18px; }',
    '.board-head h1 { margin: 0 0 8px; font-weight: 700; letter-spacing: -0.02em;'
      + ' background: linear-gradient(100deg, var(--teal-acc), var(--blue-acc));'
      + ' -webkit-background-clip: text; background-clip: text; color: transparent; }',
    /* the path is the page's subject, so it is said once at full length and
       never truncated: a reader who cannot see the whole path cannot tell
       which of two same-named files they are looking at */
    '.rv-path { font-family: var(--font-mono); font-size: var(--fs-small); color: var(--ink-2);'
      + ' margin: 0 0 8px; word-break: break-all; }',
    '.rv-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 8px;'
      + ' font-size: var(--fs-small); color: var(--ink-2); }',
    '.rv-meta .wref { color: var(--blue); font-weight: 600; text-decoration: none; }',
    '.rv-meta .wref:hover { color: var(--blue-acc); }',
    /* the open-in row borrows the answer bar's own control vocabulary whole,
       so the sheet needs nothing new, and shrunk a size because this row is a
       way out of the page rather than the thing the page is for */
    '.rv-open { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0 0 10px; }',
    '.rv-open .ab-btn { padding: 3px 10px; font-size: var(--fs-small); text-decoration: none; }',
    '.rv-open .ab-error { flex-basis: 100%; }',
    '.rv-open .ab-error:empty { display: none; }',
    '.board-hint { font-size: var(--fs-small); color: var(--ink-3); margin: 0; }',
    /* one glass sheet for whatever the ladder produced, folded or not */
    '.rv-out { background: var(--card); border: 1px solid var(--line); border-radius: var(--r-card);'
      + ' backdrop-filter: blur(18px); box-shadow: var(--shadow-card); padding: 18px 20px;'
      + ' overflow-x: auto; }',
    '.rv-out > :first-child { margin-top: 0; }',
    '.rv-out > :last-child { margin-bottom: 0; }',
    '.rv-note { font-size: var(--fs-small); color: var(--ink-3); margin: 0 0 8px; }',
    '.rv-note:empty { display: none; }',
    /* code, and plain text, wear the same block: a log file and a python file
       differ in whether anything is colored, never in shape */
    '.rv-code { font-family: var(--font-mono); font-size: calc(var(--fs-small) + 0.5px);'
      + ' line-height: 1.5; margin: 0; white-space: pre-wrap; word-break: break-word; }',
    '.rv-md h1, .rv-md h2, .rv-md h3, .rv-md h4 { letter-spacing: -0.01em; }',
    '.rv-md h1 { font-size: var(--fs-lead); margin: 18px 0 8px; }',
    '.rv-md h2 { font-size: calc(var(--fs-body) + 1px); margin: 18px 0 8px;'
      + ' text-transform: none; letter-spacing: normal; color: var(--ink); }',
    '.rv-md h3, .rv-md h4 { font-size: var(--fs-body); margin: 14px 0 6px; color: var(--ink-2); }',
    '.rv-md p, .rv-md ul, .rv-md ol { margin: 0 0 10px; }',
    '.rv-md li { margin: 2px 0; }',
    '.rv-md blockquote { margin: 0 0 10px; padding-left: 14px;'
      + ' border-left: 2px solid var(--line-2); color: var(--ink-2); }',
    '.rv-md code { font-family: var(--font-mono); font-size: calc(var(--fs-small) + 0.5px);'
      + ' padding: 1px 5px; border-radius: var(--r-ctl); background: var(--card-2); }',
    '.rv-md pre.rv-code { padding: 12px 14px; border-radius: var(--r-tile);'
      + ' background: var(--card-2); margin: 0 0 10px; }',
    '.rv-md pre.rv-code code { padding: 0; background: none; }',
    '.rv-md table { border-collapse: collapse; margin: 0 0 10px; }',
    '.rv-md th, .rv-md td { border: 1px solid var(--line); padding: 5px 10px; text-align: left; }',
    '.rv-md th { color: var(--ink-2); }',
    '.rv-md hr { border: 0; border-top: 1px solid var(--line); margin: 16px 0; }',
    /* the highlight palette, in house hues rather than a vendored theme: the
       stylesheet a syntax theme would add is one more thing to keep in step
       with the sheet, and these eight roles are all the common set emits */
    '.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-doctag,'
      + ' .hljs-name, .hljs-strong { color: var(--purple); }',
    '.hljs-string, .hljs-attr, .hljs-symbol, .hljs-bullet, .hljs-addition,'
      + ' .hljs-quote { color: var(--teal); }',
    '.hljs-number, .hljs-regexp, .hljs-link, .hljs-meta { color: var(--amber); }',
    '.hljs-comment { color: var(--ink-3); font-style: italic; }',
    '.hljs-title, .hljs-built_in, .hljs-title.class_, .hljs-title.function_ { color: var(--blue-acc); }',
    '.hljs-variable, .hljs-template-variable, .hljs-attribute, .hljs-type,'
      + ' .hljs-selector-id, .hljs-selector-class { color: var(--blue); }',
    '.hljs-deletion { color: var(--red); }',
    '.hljs-emphasis { font-style: italic; }',
    '.rv-foot { margin-top: 26px; }',
  ].join('\n  ');
}

/* The tab's mark, with NO dot on it, the work surface's own reason: the dot is
   question-driven and a file viewer reads no question queue, so it wears the
   face that claims the least. */
const FAVICON = 'favicon-quiet.svg';

function shell(assetBase, title) {
  const base = String(assetBase || '');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">\n'
    + '<title>' + esc(title) + '</title>\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<meta name="color-scheme" content="dark">\n'
    + '<link rel="icon" href="' + esc(base) + '/' + FAVICON + '">\n'
    + '<link rel="stylesheet" href="' + esc(base) + '/house.css">\n'
    + '<style>\n  ' + chrome() + '\n</style>\n</head>\n<body>\n';
}

/* ---- the page script --------------------------------------------------- */

/* Decide what the bytes are from the EXTENSION, never by sniffing: the ref is
   what the record says the file is. Every fragment is sanitized and every
   fallback lands on PLAIN, so a failure still shows the file. */
function pageScript() {
  return [
    '(function () {',
    '  var out = document.getElementById("rv-out");',
    '  var note = document.getElementById("rv-note");',
    /* above this, markdown and highlighting are skipped: a quarter of a
       megabyte of markdown is a page the browser spends seconds on, and the
       reader asked to see a file, not to wait for one */
    '  var RICH_MAX = 204800;',
    /* the sanitizer's whole configuration, in one place. FORBID_TAGS is the
       spec's text-only rule made literal; DOMPurify strips script elements and
       on* handlers on its own. */
    '  var PURIFY = {',
    '    FORBID_TAGS: ["img", "picture", "source", "video", "audio", "track", "embed",',
    '      "object", "iframe", "frame", "frameset", "canvas", "svg", "math", "style", "link", "base"],',
    '    FORBID_ATTR: ["srcset", "style", "background", "poster", "loading"],',
    '  };',
    /* extension to highlight.js language name. A name the bundle does not
       carry falls to plain rather than to highlightAuto: a wrong guess helps
       nobody. Both maps are PROTOTYPE-FREE. */
    '  var LANGS = Object.assign(Object.create(null), {',
    '    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",',
    '    ts: "typescript", tsx: "typescript", json: "json", jsonc: "json",',
    '    yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini", cfg: "ini", conf: "ini",',
    '    css: "css", scss: "scss", less: "less",',
    '    html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml",',
    '    sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell", psm1: "powershell",',
    '    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin",',
    '    swift: "swift", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp",',
    '    php: "php", sql: "sql", lua: "lua", pl: "perl", r: "r", diff: "diff", patch: "diff",',
    '    mk: "makefile",',
    '  });',
    '  var MD = Object.assign(Object.create(null), { md: 1, markdown: 1, mdown: 1, mkd: 1, mkdn: 1 });',
    '',
    '  function have(name) { return typeof window[name] !== "undefined" && window[name]; }',
    '',
    /* the fence fallback's own escape: this page wraps every fence, so it owns
       the escaping for the bodies it does not hand to the highlighter.
       DOMPurify still sees the result. */
    '  function escHtml(s) {',
    '    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")',
    '      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");',
    '  }',
    '',
    /* Rendered markdown links wear the work surface's own outbound posture:
       new tab, no referrer. ONE post-sanitize pass, so it lands on every
       anchor that survived and on nothing that did not. */
    '  if (have("DOMPurify")) {',
    '    window.DOMPurify.addHook("afterSanitizeAttributes", function (node) {',
    '      if (node.tagName === "A" && node.hasAttribute && node.hasAttribute("href")) {',
    '        node.setAttribute("target", "_blank");',
    '        node.setAttribute("rel", "noreferrer");',
    '      }',
    '    });',
    '  }',
    '',
    /* one insertion point for HTML, so "everything is sanitized" is one line a
       reader can check rather than a claim spread over four branches */
    '  function insert(cls, html) {',
    '    out.className = "rv-out " + cls;',
    '    out.innerHTML = window.DOMPurify.sanitize(html, PURIFY);',
    '  }',
    '',
    '  function plain(text) {',
    '    out.className = "rv-out";',
    '    out.textContent = "";',
    '    var pre = document.createElement("pre");',
    '    pre.className = "rv-code";',
    /* textContent, not innerHTML: nothing here is interpreted, so an html or
       svg ref with no highlighter available still lands as source */
    '    pre.textContent = text;',
    '    out.appendChild(pre);',
    '  }',
    '',
    '  function says(text) { note.textContent = text; }',
    '',
    /* a refusal is a callout, built with textContent for the same reason: the
       message can carry the status the server sent and nothing else */
    '  function refuse(hue, text) {',
    '    out.className = "rv-out";',
    '    out.textContent = "";',
    '    var box = document.createElement("div");',
    /* no hue is a state that is not a fault: the folder branch below wears the
       page's own ink rather than one of the four consequence colours. */
    '    box.className = hue ? "callout " + hue : "callout";',
    '    box.textContent = text;',
    '    out.appendChild(box);',
    '  }',
    '',
    '  function highlighted(text, lang) {',
    '    try {',
    '      return window.hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;',
    '    } catch (e) { return null; }',
    '  }',
    '',
    '  function code(text, lang) {',
    '    if (!have("hljs") || !have("DOMPurify") || !window.hljs.getLanguage(lang)) return plain(text);',
    '    var html = highlighted(text, lang);',
    '    if (html === null) return plain(text);',
    '    insert("rv-code-block", "<pre class=\\"rv-code\\"><code class=\\"hljs\\">" + html + "</code></pre>");',
    '  }',
    '',
    /* markdown-it hands a fence body here and EVERY fence returns a <pre>, so
       every fence wears the same tile. Returning "" would hand the body to
       markdown-it's own wrapper, which this sheet does not style. */
    '  function fence(str, lang) {',
    '    var name = LANGS[String(lang || "").toLowerCase()] || String(lang || "").toLowerCase();',
    '    var known = name && have("hljs") && window.hljs.getLanguage(name);',
    '    var html = known ? highlighted(str, name) : null;',
    '    if (html === null) return "<pre class=\\"rv-code\\"><code>" + escHtml(str) + "</code></pre>";',
    '    return "<pre class=\\"rv-code\\"><code class=\\"hljs\\">" + html + "</code></pre>";',
    '  }',
    '',
    '  function markdown(text) {',
    '    if (!have("markdownit") || !have("DOMPurify")) return plain(text);',
    /* html: false is belt to the sanitizer's braces: raw HTML in the source is
       escaped by the renderer before DOMPurify ever sees it. typographer stays
       off so the rendered text carries the punctuation the file carries. */
    '    var md = window.markdownit({',
    '      html: false, linkify: false, typographer: false, highlight: fence,',
    '    });',
    '    insert("rv-md", md.render(text));',
    '  }',
    '',
    '  function json(text) {',
    '    var pretty;',
    /* a file the store's own tooling wrote parses; one a person is midway
       through editing does not, and showing it raw is more use than a parse
       error would be */
    '    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return plain(text); }',
    '    code(pretty, "json");',
    '  }',
    '',
    '  function show(text, bytes) {',
    '    if (bytes > RICH_MAX) {',
    '      says("over " + RICH_MAX + " bytes, so this is shown as plain text: no markdown, no highlighting.");',
    '      return plain(text);',
    '    }',
    '    var ext = String(REF.ext || "");',
    '    if (MD[ext]) return markdown(text);',
    '    if (ext === "json" || ext === "jsonc") return json(text);',
    '    var lang = LANGS[ext];',
    '    if (lang) return code(text, lang);',
    '    plain(text);',
    '  }',
    '',
    /* Content-Length is what the server sent for these bytes; the character
       count is the floor it falls back to, and it can only under-report a
       multi-byte file, which errs toward rendering rather than toward refusing */
    '  function bytesOf(res, text) {',
    '    var n = Number(res.headers.get("content-length"));',
    '    return n > 0 ? n : text.length;',
    '  }',
    '',
    /* ---- open in (docs/file-refs-spec.md section 4) --------------------- */
    /* NOTHING IS MINTED HERE: every control posts a KIND to
       the one route, the server builds the frame out of the record's own refs
       list, and the tray exe is the one opener. */
    '  var row = document.getElementById("rv-open");',
    '  var oops = document.getElementById("rv-open-error");',
    '  function said(text) { if (oops) oops.textContent = text; }',
    /* A CONTROL THAT CAN ONLY ANSWER A SENTENCE IS OMITTED: this
       page is metadata only and learns the ref is a folder from its own 409, so
       open with, reveal and the divider between them leave the row then. */
    '  function folderRow() {',
    '    if (!row) return;',
    '    var gone = ["openwith", "reveal"];',
    '    var all = row.querySelectorAll("[data-open-kind], .ab-sep");',
    '    for (var i = 0; i < all.length; i += 1) {',
    '      var kind = all[i].getAttribute("data-open-kind");',
    '      if (!kind || gone.indexOf(kind) >= 0) all[i].parentNode.removeChild(all[i]);',
    '    }',
    '  }',
    '',
    '  if (row) {',
    '    var ctrlOf = function (node) {',
    '      while (node && node !== row) {',
    '        if (node.getAttribute && node.getAttribute("data-open-kind")) return node;',
    '        node = node.parentNode;',
    '      }',
    '      return null;',
    '    };',
    /* a POST in flight owns the control that started it, the work surface's own
       discipline. Success here is not a reload, so the control comes back
       either way and only a failure leaves a line behind. */
    '    var launch = function (el, id) {',
    '      if (!REF.open) return;',
    '      el.disabled = true;',
    '      said("");',
    '      fetch(REF.open, {',
    '        method: "POST",',
    '        headers: { "Content-Type": "application/json" },',
    '        body: JSON.stringify({ kind: id }),',
    '      }).then(function (res) {',
    '        el.disabled = false;',
    '        if (res.status === 200) return null;',
    '        return res.json().then(function (j) {',
    '          said((j && j.error) || ("the board answered " + res.status));',
    '        }, function () { said("the board answered " + res.status); });',
    '      }, function () {',
    '        el.disabled = false;',
    '        said("the board server is not answering");',
    '      });',
    '    };',
    '    row.addEventListener("click", function (ev) {',
    '      var el = ctrlOf(ev.target);',
    '      if (!el) return;',
    '      ev.preventDefault();',
    '      launch(el, el.getAttribute("data-open-kind"));',
    '    });',
    '  }',
    '',
    '  fetch(REF.raw, { cache: "no-store" }).then(function (res) {',
    '    if (res.status === 200) return res.text().then(function (t) { show(t, bytesOf(res, t)); });',
    '    if (res.status === 404) {',
    '      return refuse("red", "This file was named here, and it is not there now. "',
    '        + "The path above is what the record says; nothing has been changed for you.");',
    '    }',
    /* A FOLDER IS NOT A MISSING FILE: a directory ref answers 409,
       never the 404 that says the file is gone. It is a state of its own, in
       the quiet register, with the row above still acting on it. */
    '    if (res.status === 409) {',
    '      folderRow();',
    '      return refuse("", "This ref names a folder, not a file. There are no bytes to show; "',
    '        + "the controls above open the folder itself.");',
    '    }',
    '    if (res.status === 413) {',
    '      return refuse("amber", "This file is larger than the " + REF.cap',
    '        + " byte viewer cap, so the board did not serve it. Open it in an editor.");',
    '    }',
    '    if (res.status === 415) {',
    '      return refuse("amber", "This looks like a binary file. The viewer serves text only.");',
    '    }',
    '    refuse("red", "The board answered " + res.status + " for this file.");',
    '  }, function () {',
    '    refuse("red", "The board could not be reached. It may be restarting; reload in a moment.");',
    '  });',
    '}());',
  ].join('\n');
}

/* ---- the page ---------------------------------------------------------- */

/* FOUR BUTTONS AND NOTHING MINTED: every control
   posts a kind, and each label is a literal here. `data-open-kind` rather than
   `data-open`, which the board shell's pane already claims. */
function openRow() {
  const button = (id, label) => '<button class="ab-btn" type="button" data-open-kind="'
    + id + '">' + label + '</button>';
  const out = [
    button('open', 'open'),
    button('openwith', 'open with'),
    button('editor', 'editor'),
    '<span class="ab-sep"></span>',
    button('reveal', 'reveal'),
    '<span class="ab-error" id="rv-open-error"></span>',
  ];
  return '<p class="rv-open" id="rv-open">' + out.join('') + '</p>\n';
}

/* Everything the caller has to name. `ref` is the PATH the record holds, the
   line and column suffixes already cut off by the server. No template and no
   program name is a field here: the page names a kind and nothing else. */
export function renderRefView(meta) {
  const m = meta || {};
  const ref = String(m.ref || '');
  const line = String(m.line === undefined || m.line === null ? '' : m.line);
  const col = String(m.col === undefined || m.col === null ? '' : m.col);
  /* the spelling the record actually wrote, put back for the READER alone:
     nothing downstream reads this string, the server holding the clean path and
     the two numbers separately. */
  const shown = ref + (line ? ':' + line : '') + (line && col ? ':' + col : '');
  const id = String(m.recordId || '');
  const total = Number.isFinite(m.total) ? Number(m.total) : 0;
  const index = Number.isFinite(m.index) ? Number(m.index) : 0;
  const script = 'var REF = ' + literal({
    raw: String(m.rawUrl || ''),
    ext: extOf(ref),
    cap: Number.isFinite(m.cap) ? Number(m.cap) : 0,
    path: ref,
    line,
    col,
    open: String(m.openUrl || ''),
  }) + ';\n' + pageScript();
  const base = String(m.assetBase || '');
  return shell(base, 'AskerDo file ' + baseName(ref))
    + '<header class="board-head">\n'
    + '<h1>file ref</h1>\n'
    + '<p class="rv-path">' + esc(shown) + '</p>\n'
    + '<p class="rv-meta">'
    + (m.backUrl ? '<a class="wref" href="' + esc(m.backUrl) + '">' + esc(id) + '</a>' : esc(id))
    + ' <span>' + esc(oneLine(m.recordName)) + '</span>'
    + ' <span class="chip">ref ' + esc(String(index + 1)) + ' of ' + esc(String(total)) + '</span>'
    + '</p>\n'
    + openRow()
    + '<p class="board-hint">read only, text only: the board serves these bytes and never '
    + 'parses them, and this page renders them in your browser</p>\n'
    + '</header>\n'
    + '<main class="rv-main">\n'
    + '<p class="rv-note" id="rv-note"></p>\n'
    + '<div class="rv-out" id="rv-out"></div>\n'
    + '</main>\n'
    + (m.version ? '<p class="footnote rv-foot">board ' + esc(m.version) + '</p>\n' : '')
    + '<script src="' + esc(base) + '/markdown-it.min.js"></script>\n'
    + '<script src="' + esc(base) + '/purify.min.js"></script>\n'
    + '<script src="' + esc(base) + '/highlight.min.js"></script>\n'
    + '<script>\n' + script + '\n</script>\n'
    + '</body></html>\n';
}
