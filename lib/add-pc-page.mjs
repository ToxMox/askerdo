/* The Add a PC page: the tray menu opens it, and its script asks this PC's
   local server for a join code, which the server mints through the board with this
   PC's token, so the token never reaches the page. */
import { esc, literal, shell } from './notify-page.mjs';

function css() {
  return [
    '.ap-card, .ap-start { background: var(--card); border: 1px solid var(--line);'
      + ' border-radius: var(--r-card); padding: 18px 20px; margin: 0 0 16px;'
      + ' box-shadow: var(--shadow-card); }',
    '.ap-card[hidden], .ap-fail[hidden], .ap-start[hidden] { display: none; }',
    '.ap-start { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }',
    '.ap-start p { flex: 1 1 240px; margin: 0; color: var(--ink); }',
    '.ap-fail { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 0 0 14px; }',
    '.ap-fail .lab-err { margin: 0; }',
    '.ap-h { font-size: var(--fs-small); font-weight: 700; margin: 0 0 6px;'
      + ' text-transform: uppercase; letter-spacing: 0.16em; color: var(--ink-2); }',
    '.ap-code { font-family: var(--font-mono); font-size: clamp(16px, 7vw, 44px);'
      + ' font-weight: 650; letter-spacing: 0.06em; color: var(--ink); margin: 0 0 6px;'
      + ' user-select: all; overflow-wrap: anywhere; }',
    '.ap-gone .ap-code { color: var(--ink-3); text-decoration: line-through; }',
    '.ap-until { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;'
      + ' font-size: var(--fs-small); color: var(--ink-2); }',
    '.ap-gone .ap-until span { color: var(--amber); }',
    '.ap-run { margin: 18px 0 0; }',
    '.ap-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }',
    '.ap-line code { flex: 1 1 260px; min-width: 0; font-family: var(--font-mono);'
      + ' font-size: var(--fs-small); color: var(--ink); background: var(--card-flat);'
      + ' border: 1px solid var(--line-2); border-radius: var(--r-ctl); padding: 8px 10px;'
      + ' overflow-wrap: anywhere; user-select: all; }',
    '.nf-b:disabled { opacity: 0.5; cursor: default; }',
    '.nf-b.ap-ok { border-color: var(--teal); color: var(--teal); }',
    '.ap-board { margin: 10px 0 0; font-size: var(--fs-small); color: var(--ink-2); }',
    '.ap-board span { font-family: var(--font-mono); color: var(--ink); overflow-wrap: anywhere; }',
    /* a narrow window keeps the code on one line */
    '@media (max-width: 480px) { body { padding: 18px 16px 40px; } .ap-card, .ap-start { padding: 14px; } }',
  ].join('\n  ');
}

/* A code is minted only on a press: a mint replaces this PC's live code, so a reload
   must never kill one already typed on the new PC. Copy takes navigator.clipboard when
   the page has it and the execCommand path in the click otherwise: the desktop's
   Browser pane has no navigator.clipboard (docs/desktop-capabilities.md). */
const SCRIPT = `(function () {
  var err = document.getElementById("ap-err");
  var fail = document.getElementById("ap-fail");
  var card = document.getElementById("ap-card");
  var code = document.getElementById("ap-code");
  var until = document.getElementById("ap-until-words");
  var line = document.getElementById("ap-line");
  var board = document.getElementById("ap-board");
  var copyBtn = document.getElementById("ap-copy");
  var newBtn = document.getElementById("ap-new");
  var retryBtn = document.getElementById("ap-retry");
  var start = document.getElementById("ap-start");
  var mintBtn = document.getElementById("ap-mint");
  var timer = null;
  function gone() {
    card.classList.add("ap-gone");
    until.textContent = "this code has expired: New code mints another";
    copyBtn.disabled = true;
  }
  function show(r) {
    clearTimeout(timer);
    card.classList.remove("ap-gone");
    code.textContent = r.code;
    until.textContent = "works once, until " + r.until;
    line.textContent = r.line;
    board.textContent = r.board;
    copyBtn.disabled = false;
    card.hidden = false;
    start.hidden = true;
    fail.hidden = true;
    var left = Date.parse(r.expires) - Date.now();
    if (left > 0) timer = setTimeout(gone, Math.min(left, 2147483647));
  }
  function mint() {
    newBtn.disabled = true;
    retryBtn.disabled = true;
    mintBtn.disabled = true;
    fetch(AP.mint, { method: "POST", headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, body: j }; },
          function () { return { ok: false, body: {} }; });
      })
      .then(function (out) {
        if (out.ok && out.body.code) return show(out.body);
        return said(out.body.error || "the board did not mint a code");
      }, function () { said("this PC's local server did not answer"); })
      .then(function () { newBtn.disabled = false; retryBtn.disabled = false; mintBtn.disabled = false; });
  }
  function said(words) {
    err.textContent = words;
    fail.hidden = false;
  }
  function legacy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.top = "0"; ta.style.left = "0"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  function told(ok) {
    if (!ok) {
      var range = document.createRange();
      range.selectNodeContents(line);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    copyBtn.textContent = ok ? "Copied" : "Selected: press Ctrl+C";
    copyBtn.classList.toggle("ap-ok", ok);
    setTimeout(function () { copyBtn.textContent = "Copy"; copyBtn.classList.remove("ap-ok"); }, 1600);
  }
  copyBtn.addEventListener("click", function () {
    var text = line.textContent;
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { told(true); },
        function () { told(legacy(text)); });
    } else {
      told(legacy(text));
    }
  });
  mintBtn.addEventListener("click", mint);
  newBtn.addEventListener("click", mint);
  retryBtn.addEventListener("click", mint);
}());`;

/* Everything the caller names; the code itself arrives from the mint route. */
export function renderAddPc(meta) {
  const m = meta || {};
  const script = 'var AP = ' + literal({ mint: String(m.mintUrl || '') }) + ';\n' + SCRIPT;
  return shell(String(m.assetBase || ''), 'AskerDo add a PC', css())
    + '<header class="board-head">\n'
    + '<h1>add a PC</h1>\n'
    + '<p class="lede">A join code puts another PC on this board without carrying a token '
    + 'over: the new PC trades the code for a token of its own. It works once, for ten minutes, '
    + 'and minting another, here or with join-code, replaces it.</p>\n'
    + '<p class="lab-ctl">'
    + (m.boardBase ? '<a href="' + esc(m.boardBase) + '">back to the board</a>' : '')
    + '</p>\n'
    + '</header>\n'
    + '<main class="lab-main">\n'
    + '<div class="ap-start" id="ap-start"><p>Mint the code when the new PC is ready for it: '
    + 'its configure step asks for the code and this board\'s address.</p>'
    + '<button class="nf-b" id="ap-mint" type="button">Mint a code</button></div>\n'
    + '<div class="ap-fail" id="ap-fail" hidden><span class="lab-err" id="ap-err"></span>'
    + '<button class="nf-b" id="ap-retry" type="button">Try again</button></div>\n'
    + '<section class="ap-card" id="ap-card" hidden>\n'
    + '<h2 class="ap-h">join code</h2>\n'
    + '<div class="ap-code" id="ap-code"></div>\n'
    + '<div class="ap-until"><span id="ap-until-words"></span>'
    + '<button class="nf-b" id="ap-new" type="button">New code</button></div>\n'
    + '<p class="ap-board">board address <span id="ap-board"></span></p>\n'
    + '<div class="ap-run">\n'
    + '<h2 class="ap-h">or, once AskerDo is installed there, run</h2>\n'
    + '<div class="ap-line"><code id="ap-line"></code>'
    + '<button class="nf-b" id="ap-copy" type="button" disabled>Copy</button></div>\n'
    + '</div>\n'
    + '</section>\n'
    + '<p class="board-hint">On the new PC, /askerdo:configure\'s join asks for the board '
    + 'address and the code (the join-a-pc card in AskerDo\'s docs/procedures walks the whole '
    + 'setup). The command line shown with a code does the same from a terminal: it saves the '
    + 'board address and the new PC\'s own token in its AskerDo config, and the next session '
    + 'start there brings the board up.</p>\n'
    + '</main>\n'
    + (m.version ? '<p class="nf-foot">board ' + esc(m.version) + '</p>\n' : '')
    + '<script>\n' + script + '\n</script>\n'
    + '</body></html>\n';
}
