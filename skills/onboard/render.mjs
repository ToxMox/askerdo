#!/usr/bin/env node
/* writes review.html (the user's page to mark) and items.json from rows.json.
   node render.mjs <work dir> */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

const HOMES = [
  ['workstream', 'Workstream', 'The body of work the import goes into.'],
  ['track', 'Tracks: lines of work', 'Each old handoff file (or dated series of them) becomes a track, its old versions the track\'s handoffs, oldest first, each with the date of its commit. A list of three or more items becomes a track too, its items the tasks.'],
  ['task', 'Tasks', 'Each item of an old list, open or checked off, dated by the commit that last changed its line. A task of a track you leave goes into the workstream\'s inbox.'],
  ['question', 'Open questions', 'Questions still open in the old system: they go on the board as open questions.'],
  ['decision', 'Decisions', 'Entries of an old decision log, and answered questions, become decision records with their original dates.'],
  ['knowledge', 'Knowledge', 'Facts and gotchas (project and reference memories) become knowledge records.'],
  ['rule', 'Rule lines', 'Working rules for a profile, which every session and agent brief in this project carries. Lines already in CLAUDE.md start at Leave: keep copies one onto the profile so agent briefs carry it too, and the CLAUDE.md line stays unless your note says to take it out.'],
  ['procedure', 'Procedures', 'Step lists. A file in docs/procedures/ gets its card from proc scan; a step list elsewhere needs moving there first, a repo edit I make after the write with your OK.'],
  ['?', 'Not placed yet', 'I could not place these on my own. Each is asked on your band; its answer decides it.'],
  ['none', 'No home on the board', 'Found, but nothing on the board fits.'],
];
const HOME_WORD = { workstream: 'workstream', track: 'track', task: 'task', question: 'question', decision: 'decision', knowledge: 'knowledge', rule: 'rule line', procedure: 'procedure', '?': 'unplaced', none: 'no home' };
const OPTS = [['keep', 'Keep', 'keep'], ['convert', 'Convert', 'change'], ['leave', 'Leave', 'drop']];

const where = (w) => esc((w.file || '') + (w.line ? ' line ' + w.line : '') + (w.commit ? ' @' + String(w.commit).slice(0, 8) : ''));
const ctl = () => `<div class="ctl" role="group" aria-label="Your choice">${OPTS.map(([v, l, c]) => `<button type="button" class="ch c-${c}" data-v="${v}" aria-pressed="false">${l}</button>`).join('')}</div>`;
const note = (ph) => `<textarea class="note" rows="1" data-ph="${esc(ph)}" placeholder="${esc(ph)}" aria-label="Your note"></textarea>`;

function detail(r) {
  const f = r.fields || {};
  if (r.home === 'workstream') return f.use ? `<p class="rule">Goes into <b>${esc(f.use)}</b>, already on the board.</p>` : `<p class="rule"><b>New workstream:</b> ${esc(f.name || r.title)}. ${esc(f.description || '')}</p>`;
  if (r.home === 'track') {
    const h = f.history || [];
    const state = { waiting: 'waits to be resumed', parked: 'is parked', finished: 'is finished' }[f.state] || f.state;
    return `<p class="rule"><b>Track:</b> ${esc(f.name || r.title)}. ${h.length ? esc(plural(h.length, 'old handoff')) + ' as its history, ' + esc(h[0].at.slice(0, 10)) + ' to ' + esc(h[h.length - 1].at.slice(0, 10)) + '; ' : ''}it ${esc(state)}.</p>`
      + (h.length ? `<details class="more"><summary>The versions</summary><ul class="plain">${h.map((v) => `<li>${esc(v.at.slice(0, 10))} ${esc(v.commit ? v.commit.slice(0, 8) : 'uncommitted')}: ${esc(v.subject)}</li>`).join('')}</ul></details>` : '');
  }
  if (r.home === 'task') return `<p class="meta">${f.status === 'completed' ? 'done' : 'open'}${r.closed ? ', checked off by ' + esc(r.closed) : ''}</p>`;
  if (r.home === 'rule') return f.text ? `<p class="rule">${esc(f.text)}</p><p class="meta">on the ${esc(f.profile)} profile as <code>${esc(f.slug)}</code></p>` : '<p class="meta">over 400 characters: say the shorter words in a note and choose Convert</p>';
  if (r.home === 'question') return `<p class="rule">${esc(f.ask || r.title)}</p>`;
  if (r.home === 'decision' && f.words) return `<p class="words"><b>Your words:</b> ${esc(f.words)}</p>`;
  if (r.home === 'procedure' && f.target) return `<p class="meta">moves to ${esc(f.target)}</p>`;
  return '';
}

function card(r) {
  const badges = [`<span class="badge b-home">${esc(HOME_WORD[r.home] || r.home)}</span>`, r.date ? `<span class="badge">${esc(r.date)}</span>` : '',
    r.asked ? `<span class="badge b-asked">asked as ${esc(r.asked)}</span>` : '', r.needsWords ? '<span class="badge b-asked">needs words</span>' : ''].join(' ');
  return `<div class="card item" data-id="${esc(r.id)}" data-def="${esc(r.def || 'keep')}" data-group="${esc(r.group || '')}" data-state="${esc(r.def || 'keep')}">
<div class="rhead"><span class="rtitle">${esc(r.title)}</span> ${badges}</div>
<p class="meta">${where(r.where || {})}</p>${detail(r)}${(r.evidenceFrom || []).map((e) => `<p class="meta">Commit ${esc(e.commit)} (${esc(e.day)}) says the same: ${esc(e.subject)}</p>`).join('')}<p class="why">${esc(r.why || '')}</p>
${r.excerpt ? `<details class="more"><summary>What it says</summary><p class="ex">${esc(r.excerpt)}</p></details>` : ''}${ctl()}${note('Add a note (optional)')}</div>`;
}

const groupBtns = () => '<div class="gbtn"><button type="button" class="btn" data-gset="keep">Keep all</button><button type="button" class="btn" data-gset="leave">Leave all</button><button type="button" class="btn" data-gset="proposal">As proposed</button></div>';

const GROUP_TITLE = { workstreams: 'The workstream', tracks: 'Tracks from the old files', questions: 'The old question queue (.claude/questions)', memory: 'Claude memory files', procedures: 'Step lists and procedure files', unplaced: 'Folders I could not read' };
const marksOf = (list) => { const n = {}; for (const r of list) n[r.def || 'keep'] = (n[r.def || 'keep'] || 0) + 1; return OPTS.filter(([v]) => n[v]).map(([v, l]) => n[v] + ' ' + l).join(', '); };

/* With calls on the page, every group starts collapsed, its count and starting marks in its summary. */
function section(doc, home, label, lede, { skip = new Set(), collapse = false } = {}) {
  const rows = doc.rows.filter((r) => r.home === home && !skip.has(r.id));
  if (!rows.length) return '';
  const groups = new Map();
  for (const r of rows) { const g = r.group || home; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  const title = (g, list) => {
    if (g.startsWith('tasks:track:')) { const t = doc.rows.find((x) => x.id === g.slice(6)); return 'On the track ' + (t ? t.title : g.slice(12)); }
    if (g.startsWith('tasks:')) return 'From ' + g.slice(6);
    if (GROUP_TITLE[g]) return GROUP_TITLE[g];
    if (g.startsWith('history: ')) return 'Git history: ' + g.slice(9);
    if (g.includes(':')) return 'From ' + g.slice(g.indexOf(':') + 1);
    return list[0].where && list[0].where.file ? list[0].where.file : g;
  };
  const body = collapse || groups.size > 1 || rows.length > 8
    ? [...groups].map(([g, list]) => `<details class="grp"${groups.size === 1 && !collapse ? ' open' : ''}><summary>${esc(title(g, list))} (${list.length})${collapse ? ` <span class="gm">starts at ${esc(marksOf(list))}</span>` : ''} <span class="gc" data-gc="${esc(g)}"></span></summary>${groupBtns()}${list.map(card).join('')}</details>`).join('')
    : rows.map(card).join('');
  return `<section><h2>${esc(label)} (${rows.length})</h2><p class="lede">${esc(lede)}</p>${body}</section>`;
}

/* The rows the survey or the session's discovery pass could not settle (call: true), each open; a call that
   may repeat a log entry (pair) shows beside that entry. */
function callSection(doc, calls, boxed) {
  const byId = new Map(doc.rows.map((r) => [r.id, r]));
  const shown = new Set();
  const parts = [];
  for (const r of calls) {
    if (shown.has(r.id)) continue;
    const mate = r.pair && byId.get(r.pair);
    if (!mate) { shown.add(r.id); parts.push(card(r)); continue; }
    const both = [mate, ...calls.filter((x) => x.pair === r.pair)].filter((x) => !shown.has(x.id));
    both.forEach((x) => shown.add(x.id));
    parts.push(`<div class="pair"><p class="lede">These may hold the same ruling: keep the one in force and leave the copy.</p>${both.map(card).join('')}</div>`);
  }
  return `<section class="calls"><h2>Your calls (${boxed})</h2><p class="lede">I could not settle these from the files, so each needs your mark. Everything below starts at my proposal and stays collapsed: open a group only to disagree.</p>${parts.join('')}</section>`;
}

const CSS = `
:root{--bg:#0d1218;--surface:#151c24;--surface2:#1c2631;--text:#e6edf3;--muted:#a9b6c3;--line:#2f3e4d;--accent:#26C3FF;--accent2:#00AEEF;--accentText:#7fdcff;--keep:#86EFAC;--keepInk:#0b2e17;--change:#26C3FF;--changeInk:#03263a;--drop:#F28B82;--dropInk:#3d0b07;--dropText:#f6a49d;--amber:#f5b942;--amberText:#f5c66b;--code:#22303d;--strip:#10171f;color-scheme:dark}
@media (prefers-color-scheme: light){:root{--bg:#f6f8fb;--surface:#ffffff;--surface2:#edf2f7;--text:#14202b;--muted:#4f5f6e;--line:#c5d1dd;--accent:#00AEEF;--accent2:#26C3FF;--accentText:#006f99;--dropText:#9b2c22;--amber:#d9971f;--amberText:#7a4b00;--code:#e6edf4;--strip:#ffffff;color-scheme:light}}
*{box-sizing:border-box}[hidden]{display:none!important}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:20px 16px 200px;overflow-wrap:anywhere}
h1{font-size:1.6rem;line-height:1.25;margin:.2em 0 .4em}h2{font-size:1.3rem;margin:2em 0 .4em;padding-bottom:.3em;border-bottom:2px solid var(--accent)}
p{margin:.5em 0}code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:.9em}
.lede,.why,.meta{color:var(--muted)}.why,.meta{font-size:15px;margin:.2em 0}
.how{background:var(--surface);border:1px solid var(--line);border-left:5px solid var(--accent);border-radius:10px;padding:4px 16px 10px;margin:16px 0}
.how ul{padding-left:1.2em;margin:.4em 0}.how li{margin:.4em 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px}.tile .num{font-size:1.5rem;font-weight:700;color:var(--accentText)}.tile .lab{font-size:15px;color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--line);border-left:5px solid var(--line);border-radius:8px;padding:12px 16px;margin:12px 0}
details .card{background:var(--bg)}.card[data-state=keep]{border-left-color:var(--keep)}.card[data-state=convert]{border-left-color:var(--change)}.card[data-state=leave]{border-left-color:var(--drop)}
.rhead{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}.rtitle{font-weight:650}
.rule{margin:.6em 0;padding:10px 12px;background:var(--surface2);border-radius:6px}.words{color:var(--muted)}
.ex{white-space:pre-wrap;font-size:15px;color:var(--muted)}ul.plain{padding-left:1.2em;font-size:15px}
.badge{font-size:13px;line-height:1.5;padding:1px 8px;border-radius:999px;border:1px solid var(--line);white-space:nowrap;color:var(--muted)}
.b-home{color:var(--accentText);border-color:var(--accent)}.b-asked{color:var(--amberText);border-color:var(--amber)}
.ctl{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 6px}.gbtn{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 8px}
button{font:inherit}.ch,.btn{min-height:44px;padding:8px 18px;border-radius:8px;border:2px solid var(--line);background:var(--surface2);color:var(--text);font-size:16px;font-weight:600;line-height:1.2;cursor:pointer}
.ch:hover,.btn:hover{border-color:var(--accent)}.gbtn .btn{min-height:36px;padding:4px 12px;font-size:14px}
.c-keep[aria-pressed=true]{background:var(--keep);border-color:var(--keep);color:var(--keepInk)}
.c-change[aria-pressed=true]{background:var(--change);border-color:var(--change);color:var(--changeInk)}
.c-drop[aria-pressed=true]{background:var(--drop);border-color:var(--drop);color:var(--dropInk)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
textarea.note{display:block;width:100%;min-height:46px;margin:4px 0 2px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font-family:inherit;font-size:17px;line-height:1.5;resize:none;overflow:hidden}
details .card textarea.note{background:var(--surface)}textarea.note::placeholder{color:var(--muted)}
details{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:2px 14px;margin:12px 0}details[open]{padding-bottom:10px}
details.more{background:transparent;border:0;padding:0;margin:2px 0}details.more>summary{font-size:15px;color:var(--accentText);padding:6px 0}
summary{cursor:pointer;font-weight:650;padding:10px 0}.gc{font-weight:600;color:var(--accentText);margin-left:6px}
.done{background:var(--surface);border:1px solid var(--line);border-left:5px solid var(--accent);border-radius:10px;padding:4px 16px 14px;margin:16px 0}
.btn.big{min-height:52px;padding:10px 30px;font-size:18px;background:var(--accent2);border-color:var(--accent2);color:var(--changeInk)}
.donemsg{font-weight:700;font-size:18px;min-height:1.6em}
.strip{position:fixed;left:0;right:0;bottom:0;z-index:10;background:var(--strip);border-top:2px solid var(--accent2);box-shadow:0 -4px 16px rgba(0,0,0,.25)}
.strip .in{max-width:920px;margin:0 auto;padding:8px 16px;display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center;font-size:15px}
#save{font-weight:700;color:var(--accentText)}#save[data-k=down],#save[data-k=fail]{color:var(--dropText)}.strip .btn{min-height:38px;padding:5px 14px;font-size:15px}
#only[aria-pressed=true]{background:var(--change);border-color:var(--change);color:var(--changeInk)}
#copyshow{width:100%;height:30vh;font:13px/1.4 ui-monospace,Consolas,monospace;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:6px}
.copybox{position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;padding:0}
.only-changed .item:not(.changed){display:none}
.gm{font-weight:500;font-size:15px;color:var(--muted);margin-left:6px}.calls h2{border-bottom-color:var(--amber)}
.pair{border:1px dashed var(--amber);border-radius:10px;padding:2px 12px;margin:12px 0}
@media (max-width:520px){h1{font-size:1.35rem}.card{padding:10px 12px}}
`;

export function renderPage(doc) {
  const p = doc.project;
  const b = doc.board;
  const JS = readFileSync(join(HERE, 'review-page.js'), 'utf8');
  if (/<\/script/i.test(JS)) throw new Error('review-page.js holds a closing script tag');
  const calls = doc.rows.filter((r) => r.call);
  const skip = new Set([...calls.map((r) => r.id), ...calls.map((r) => r.pair).filter(Boolean)]);
  const opts = calls.length ? { skip, collapse: true } : {};
  /* each row counted once, where it shows: the calls box, else its home's group */
  const boxed = doc.rows.filter((r) => skip.has(r.id)).length;
  const n = (h) => doc.rows.filter((r) => r.home === h && !skip.has(r.id)).length;
  const tile = (num, lab) => `<div class="tile"><div class="num">${num}</div><div class="lab">${esc(lab)}</div></div>`;
  const tiles = (boxed ? tile(boxed, 'Your calls') : '') + HOMES.filter(([h]) => n(h)).map(([h, l]) => tile(n(h), HOME_WORD[h] === 'unplaced' ? 'not placed yet' : l.split(':')[0])).join('');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Onboarding Review</title><style>${CSS}</style></head><body data-project="${esc(p.slug)}" data-token=""><main>
<h1>${esc(p.name)}: what moves to the board</h1>
<p class="lede">I read ${esc(p.dir)} (${esc(p.shared)}) without changing it: its handoff files and their git history, lists, decision logs, CLAUDE.md, the Claude memory files for it and the old question queue${p.git ? ', and its commit history (subjects and file paths)' : ''}. Each thing I found is a row below with where it is, its date in the old system and where I propose it goes. Nothing is on the board yet.</p>
<div class="how"><ul>
<li><b>Keep</b> brings it in as proposed. <b>Convert</b> brings it in differently: say how in the note (another home, other words, another track) and I rework it before anything is written. <b>Leave</b> leaves it where it is, and a later run does not propose it again.</li>
<li>Every row starts at my proposal, so press a button only where you disagree. Groups have Keep all, Leave all and As proposed.</li>
${calls.length ? `<li>It saves as you go. When you finish, press I'm done and tell me. Then it goes to a scratch board first, and I show you what landed before the real write.</li>`
    : `<li>Nothing here needs your mark: I settled every row from the files. Look only if you want; your go in chat is enough. A row you change saves as you go. Then it goes to a scratch board first, and I show you what landed before the real write.</li>`}
</ul></div>
${calls.length ? callSection(doc, calls, boxed) : ''}
<div class="grid">${tiles}</div>
${b ? `<p class="lede">On the board already: ${esc(b.workstreams.map((w) => w.id + ' ' + w.name).join(', ') || 'no workstream for this project')}; ${esc(plural(b.imported.length, 'record'))} from an earlier import; ${esc(plural(b.knowledge.length, 'knowledge record'))} for the project.${doc.already ? ' ' + esc(plural(doc.already, 'row')) + ' an earlier run already took or left are not shown.' : ''}</p>` : ''}
${doc.codeTodos ? `<p class="lede">${esc(doc.codeTodos)} TODO comments in the code stay in the code.</p>` : ''}
${HOMES.map(([h, l, lede]) => section(doc, h, l, lede, opts)).join('\n')}
<div class="done"><h2>When you are done</h2><p>Your marks are saved either way; this marks the page finished.</p>
<div class="card item" data-id="note:general"><label for="gn"><b>Anything else</b></label><textarea class="note" id="gn" rows="1" placeholder="Add a note (optional)"></textarea></div>
<div class="ctl"><button type="button" id="done" class="btn big">I'm done</button></div><p id="donemsg" class="donemsg" aria-live="polite"></p></div>
</main>
<div class="strip"><div class="in"><span id="save" data-k="busy" aria-live="polite">Loading your marks</span><span id="p-changed"></span><span id="p-convert"></span>
<button type="button" id="only" class="btn" aria-pressed="false">Show only what I changed</button><button type="button" id="copy" class="btn" hidden>Copy my choices</button>
<span id="copymsg" class="small"></span><textarea id="copyshow" readonly hidden aria-label="Your choices as text"></textarea></div></div>
<textarea id="copybox" class="copybox" aria-hidden="true" tabindex="-1"></textarea>
<script>
${JS}</script>
</body></html>
`;
  const items = doc.rows.map((r) => ({ id: r.id, home: r.home, def: r.def || 'keep', title: r.title, ...(r.call ? { call: true } : {}) }));
  return { html, items };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const work = process.argv[2];
  if (!work || work === '--help') { console.log('node render.mjs <work dir>'); process.exit(work ? 0 : 1); }
  const doc = JSON.parse(readFileSync(join(work, 'rows.json'), 'utf8'));
  const { html, items } = renderPage(doc);
  writeFileSync(join(work, 'review.html'), html);
  writeFileSync(join(work, 'items.json'), JSON.stringify({ reading: 'choices.json holds only the rows the user changed or noted; a missing row stands at def (keep, convert or leave)', items }, null, 2) + '\n');
  console.log('review.html ' + html.length + ' bytes, ' + items.length + ' rows');
}
