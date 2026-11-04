/* The board's settings page, drawn on the server from the settings verb's rows.
   Every control is a plain form, so a save works with the
   script off; the script adds the live search and Changed only, and opens folds in place. */
import { esc } from './draw.mjs';
import { PC_SETTINGS } from '../verbs/profile-rules.mjs';
import { lastPart } from './settings.mjs';

const LEVELS = ['default', 'project', 'workstream', 'track', 'task'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AUDIENCE = { session: 'for the session', agents: 'for its agents', both: 'for both' };
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many);
const kWords = (v) => Math.round(Number(v) / 1000) + 'k';
const dateOf = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() : String(iso || ''); };
const attr = (k, v) => ' ' + k + '="' + esc(v) + '"';
const hidden = (k, v) => (v === undefined || v === null || v === '' ? '' : '<input type="hidden"' + attr('name', k) + attr('value', v) + '>');

function valueWords(row, v = row.value) {
  if (row.kind === 'tokens') return kWords(v);
  if (row.kind === 'percent') return v + '%';
  if (row.kind === 'bool') return v ? 'on' : 'off';
  if (row.kind === 'choice') return (row.choices && row.choices[v]) || String(v);
  if (row.kind === 'text') return v === '' ? 'none' : String(v);
  return String(v);
}
function cliWords(row, v = row.value) {
  if (row.kind === 'tokens') return kWords(v);
  if (row.kind === 'bool') return v ? 'on' : 'off';
  const t = String(v);
  return /\s/.test(t) || t === '' ? '"' + t + '"' : t;
}

/* ---- the view's address: scope, record, workstream and sub-tab ---- */

export function viewQuery(m, over = {}) {
  const q = { scope: m.scope.kind === 'everywhere' ? '' : m.scope.kind, record: m.scope.kind === 'everywhere' ? '' : m.scope.record, ws: '', tab: m.tab === 'replies' ? '' : m.tab, ...over };
  if (!q.scope || q.scope === 'project') q.ws = q.ws || (m.ws ? m.ws.id : '');
  const p = new URLSearchParams();
  for (const k of ['scope', 'record', 'ws', 'tab', 'edit', 'place']) if (q[k]) p.set(k, q[k]);
  const s = p.toString();
  return '/settings' + (s ? '?' + s : '');
}

/* a project by its shared name's last part when the view knows it, else its folder's */
const projectName = (m, record) => (m.scope.kind === 'project' ? m.scope.word : m.project ? m.project.name : lastPart(record));
const recordName = (m, level, record) => (level === 'default' ? 'everywhere' : level === 'project' ? projectName(m, record) : record + (m.names[record] ? ' ' + m.names[record] : ''));

function scopeHead(m) {
  const pill = (href, on, title, inner) => '<a' + attr('href', href) + (on ? ' class="on" aria-current="page"' : '') + attr('title', title) + '>' + inner + '</a>';
  const named = (id, name) => '<span class="id">' + esc(id) + '</span>' + (name ? ' <span class="nm">' + esc(name) + '</span>' : '');
  const s = m.scope;
  const wide = [pill(viewQuery(m, { scope: '', record: '', edit: '', place: '' }), s.kind === 'everywhere', 'Your default profile, for every session on every PC', 'Everywhere')];
  if (m.project) {
    wide.push(pill(viewQuery(m, { scope: 'project', record: m.project.dir, edit: '', place: '' }), s.kind === 'project', 'Project ' + m.project.name,
      '<span class="dim3">project</span> ' + esc(m.project.name)));
  }
  for (const w of m.workstreams) {
    const here = m.ws && w.id === m.ws.id;
    wide.push(pill(viewQuery(m, { scope: 'workstream', record: w.id, ws: '', edit: '', place: '' }), s.kind === 'workstream' && s.record === w.id, 'Workstream ' + w.id + ' ' + w.name,
      named(w.id, here ? w.name : '')));
  }
  const trs = m.tracks.map((t) => pill(viewQuery(m, { scope: 'track', record: t.id, ws: '', edit: '', place: '' }), s.kind === 'track' && s.record === t.id, 'Track ' + t.id + ' ' + t.name, named(t.id, t.name)));
  const held = (m.read.held || []).slice().reverse();
  const from = held.map((h) => h.profiles.join(', ') + (h.level === 'default' ? ' everywhere' : ' on ' + recordName(m, h.level, h.record))).join(', then ');
  const lead = s.kind === 'everywhere' ? 'Everywhere: the values on your default profile, which every session on every PC reads. Pick a project, workstream or track to see it as its sessions do, and set values there.'
    : 'As ' + (s.kind === 'project' ? 'a session in ' + s.word : s.kind + ' ' + s.word + ' resolves it') + ': each value comes from the narrowest place that sets it' + (from ? ', here ' + from : '') + '.';
  return '<section class="scope"><div class="scopebar"><span class="eyebrow">Settings for</span>' + wide.join('') + '</div>'
    + (m.ws && trs.length ? '<div class="scopebar trs"><span class="eyebrow">Tracks in ' + esc(m.ws.id) + '</span>' + trs.join('') + '</div>' : '')
    + '<p class="scopeline">' + esc(lead) + ' Press a chip to choose where a value is set.</p></section>';
}

/* ---- where a write goes ---- */

/* The place a row's control writes to: the one picked in the picker, else the one that sets it now. */
function targetOf(m, row) {
  const places = row.places || [];
  const picked = m.edit && m.edit.key === row.key ? places.find((p) => p.level === m.edit.place && writable(m, p)) : null;
  return picked || places.find((p) => p.level === row.layer) || null;
}
/* A project place needs its folder, which the board knows only from the workstream or the scope. */
const projectDir = (m) => (m.scope.kind === 'project' ? { dir: m.scope.record, repo: m.scope.repo } : m.project ? { dir: m.project.dir, repo: m.project.repo } : null);
const writable = (m, p) => p.level !== 'project' || !!projectDir(m);
/* The form's at, record and repo for a place; none names the scope's record, as the CLI's bare set does. */
function whereOf(m, p) {
  if (!p) return { at: '', record: m.scope.record, repo: m.scope.kind === 'project' ? m.scope.repo : '' };
  if (p.level === 'default') return { at: 'default', record: 'default', repo: '' };
  if (p.level === 'project') { const d = projectDir(m) || { dir: p.record, repo: '' }; return { at: 'project', record: d.dir, repo: d.repo || '' }; }
  return { at: p.level, record: p.record, repo: '' };
}
const whereFields = (w, back) => hidden('at', w.at) + hidden('record', w.record) + hidden('repo', w.repo) + hidden('back', back);
const overWords = (list) => { const parts = (list || []).map((o) => plural(o.count, o.level)); return parts.length ? 'overridden on ' + parts.join(' and ') : ''; };

function chip(m, row, target, open) {
  const live = row.editable && (row.places || []).length > 0 && row.key !== 'contract.custom';
  const t = row.layer === 'built-in' ? 'Built in: no profile sets it' : 'Set on ' + row.profile + ', held at ' + recordName(m, row.layer, row.record);
  if (!live) return '<span class="chip ro"' + attr('title', t) + '>' + esc(row.scope || row.layer) + '</span>';
  return '<a class="chip pchip' + (open || (target && target.level !== row.layer) ? ' active' : '') + '"' + attr('href', '#p-' + row.key) + attr('title', t + ': press to choose where to set it') + '>' + esc(target ? target.scope : row.scope) + '</a>';
}

function control(m, row, target, back) {
  if (!row.editable) {
    const val = row.kind === 'bool' ? '<span class="tog ro"><span class="sw' + (row.value ? ' on' : '') + '"></span>' + (row.value ? 'On' : 'Off') + '</span>' : '<span class="val">' + esc(valueWords(row)) + '</span>';
    return '<div class="ctl">' + val + '</div>' + (row.why ? '<div class="why dim">Read only: ' + esc(row.why) + '.</div>' : '');
  }
  const form = (inner, cls = 'ctl') => '<form method="post" action="/settings/set" class="' + cls + '">' + hidden('key', row.key) + whereFields(whereOf(m, target), back) + inner + '</form>';
  if (row.kind === 'bool') {
    return form('<button type="submit" class="tog" name="value"' + attr('value', row.value ? 'off' : 'on') + ' aria-pressed="' + !!row.value + '"' + attr('aria-label', row.label + ': turn ' + (row.value ? 'off' : 'on')) + '><span class="sw' + (row.value ? ' on' : '') + '"></span>' + (row.value ? 'On' : 'Off') + '</button>');
  }
  if (row.kind === 'choice') {
    return form('<span class="seg" role="group"' + attr('aria-label', row.label) + '>' + row.values.map((c) => '<button type="submit" name="value"' + attr('value', c) + (c === row.value ? ' class="on" aria-pressed="true"' : '') + '>' + esc(valueWords(row, c)) + '</button>').join('') + '</span>');
  }
  if (row.kind === 'percent' || row.kind === 'tokens' || row.kind === 'text') {
    const drawn = row.kind === 'tokens' ? kWords(row.value) : String(row.value);
    /* a refused save draws the stored value again, the refusal line under it, as the pane does */
    const short = row.kind !== 'text';
    const input = '<input class="fld' + (short ? ' short' : '') + '" name="value"' + attr('value', drawn) + attr('data-drawn', drawn) + attr('aria-label', row.label)
      + (short ? ' inputmode="' + (row.kind === 'percent' ? 'numeric' : 'text') + '"' : ' placeholder="none"') + ' autocomplete="off">';
    return form(input + (short ? '<span class="dim">' + (row.kind === 'percent' ? '%' : 'tokens') + '</span>' : '') + '<button type="submit" class="gbtn">Save</button>', short ? 'ctl' : 'ctl wide');
  }
  return '<div class="ctl"><span class="val">' + esc(valueWords(row)) + '</span></div>';
}

function example(row) {
  const e = row.example;
  const lines = (t) => esc(t).split('\n').join('<br>');
  const tile = (cap, text, now) => '<div class="tile' + (now ? ' now' : '') + '"><div class="cap">' + esc(cap) + (now ? ', now' : '') + '</div><div>' + lines(text) + '</div></div>';
  if (e.kind === 'pair') {
    const now = row.kind === 'bool' ? (row.value ? 'b' : 'a') : 'b';
    return '<div class="exs">' + tile(e.a[0], e.a[1], now === 'a') + tile(e.b[0], e.b[1], now === 'b') + '</div>';
  }
  if (e.kind === 'values') return '<div class="exs col">' + Object.entries(e.values).map(([v, t]) => tile(valueWords(row, v), t, v === row.value)).join('') + '</div>';
  return '<p>' + lines(e.text) + '</p>';
}
const cmd = (c) => '<div class="cmd"><code>' + esc(c) + '</code><button class="copy" type="button"' + attr('data-copy', c) + '>Copy</button></div>';
const atArgs = (w) => (!w.at ? '' : (w.at !== 'default' ? ' ' + cliWords({ kind: 'text' }, w.record) : '') + ' --at ' + w.at);

function resetOf(m, row, back) {
  if (!row.changed || !row.editable || row.key === 'contract.custom') return '';
  const place = (row.places || []).find((p) => p.level === row.layer);
  if (!place || !writable(m, place)) return '';
  const built = row.builtIn === undefined ? '' : valueWords(row, row.builtIn);
  const form = (label, words) => '<form method="post" action="/settings/unset" class="rs">' + hidden('key', row.key) + whereFields(whereOf(m, place), back)
    + '<button type="submit" class="gbtn">' + label + '</button><span class="dim">' + esc(words) + '</span></form>';
  const i = LEVELS.indexOf(row.layer);
  if (i > 0) {
    const under = (row.places || []).filter((p) => LEVELS.indexOf(p.level) < i && p.value !== undefined).pop();
    return form('Remove from this layer', 'Without it, ' + (under ? valueWords(row, under.value) + ' from ' + under.scope : 'the built-in ' + built) + ' applies here.');
  }
  return form('Back to built-in', 'The built-in value is ' + built + '.');
}

function moreFold(m, row, target, back) {
  const parts = [];
  if (row.changes) parts.push('<div class="mh">What changes</div><p>' + esc(row.changes) + '</p>');
  if (row.example) parts.push('<div class="mh">' + (row.example.kind === 'values' ? 'What each choice does' : 'Example') + '</div>' + example(row));
  if (row.takes) parts.push('<div class="mh">Takes effect</div><p>' + esc(row.takes) + '</p>');
  const c = row.key === 'contract.custom' ? 'askerdo profile rule-add' : row.editable ? 'askerdo settings set ' + row.key + ' ' + cliWords(row) + atArgs(whereOf(m, target)) : '';
  parts.push('<div class="mh">For the CLI</div><div class="clis"><code class="key">' + esc(row.key) + '</code>' + (c ? cmd(c) : '') + '</div>');
  return '<div class="more"' + attr('id', 'm-' + row.key) + '>' + parts.join('') + resetOf(m, row, back) + '</div>';
}

function picker(m, row, target) {
  const tab = row.tab === 'replies' ? '' : row.tab;
  const parts = ['<div class="ph">Where to set: ' + esc(row.label) + '</div><ul class="places">'];
  for (const p of row.places || []) {
    const here = target && p.level === target.level;
    const name = p.profile || (p.profiles && p.profiles[0]);
    const rn = recordName(m, p.level, p.record);
    const where = p.level === 'default' ? (name ? 'On ' + name + ', your default profile' : 'On your default profile')
      : (name ? 'On ' + name + ', held on ' : 'A new profile held on ') + rn;
    const over = overWords(p.overridden);
    const said = where + ': ' + p.reaches + '.' + (p.value !== undefined ? ' Sets ' + valueWords(row, p.value) + (p.level === row.layer ? ' now' : '') + (over ? ', ' + over : '') + '.' : '');
    /* the whole row, circle, chip and words, is one press target */
    const inner = '<span class="dot' + (here ? ' active' : '') + '"></span><div><span class="chip' + (writable(m, p) ? (here ? ' active' : '') : ' ro') + '">' + esc(p.scope) + '</span><div class="dim">' + esc(said) + '</div></div>';
    const pick = writable(m, p)
      ? '<a class="prow"' + attr('href', viewQuery(m, { tab, edit: row.key, place: p.level }) + '#s-' + row.key) + (here ? ' aria-current="true"' : '') + '>' + inner + '</a>'
      : '<div class="prow ro">' + inner + '</div>';
    parts.push('<li' + (here ? ' class="here"' : '') + '>' + pick + '</li>');
  }
  parts.push('</ul>');
  if (row.key.startsWith('contract.')) parts.push('<p class="dim">Your reply options are one set for every session, so they live on your default profile, which every PC reads.</p>');
  else if (m.scope.kind === 'everywhere') parts.push('<p class="dim">Pick a project, workstream or track above to set it narrower.</p>');
  return '<div class="pick"' + attr('id', 'p-' + row.key) + '>' + parts.join('') + '</div>';
}

function noteOf(row, st) {
  if (st.refused) return '<div class="note no" role="alert"><b>Not saved.</b> ' + esc(st.refused.why) + '</div>';
  if (st.saved) {
    const head = row.layer === 'built-in' ? 'Saved: back to the built-in ' + valueWords(row) + '.' : 'Saved ' + row.scope + ', on ' + row.profile + '.';
    return '<div class="note ok" role="status"><span class="tick" aria-hidden="true"></span><div><div>' + esc(head) + '</div><div class="dim">' + esc(row.takes || '') + '</div></div></div>';
  }
  return '';
}

const findText = (row) => [row.label, row.line, row.key].join(' ').toLowerCase();
function settingRow(m, row, st, tabBack) {
  const k = row.key;
  const target = targetOf(m, row);
  const pickOpen = !!(m.edit && m.edit.key === k);
  const back = pickOpen ? viewQuery(m, { tab: row.tab === 'replies' ? '' : row.tab, edit: k, place: m.edit.place }) : tabBack;
  const dot = row.changed ? '<span class="cdot" title="Changed from built-in"></span>' : '';
  const head = '<div class="sl"><div class="lab">' + esc(row.label) + dot + '</div><div class="help">' + esc(row.line) + ' <a class="mbtn"' + attr('href', '#m-' + k) + ' aria-label="More about ' + esc(row.label) + '"><span class="mo">more</span><span class="le">less</span></a></div></div>';
  const attrs = attr('id', 's-' + k) + attr('data-key', k) + attr('data-find', findText(row)) + (row.changed ? ' data-changed="1"' : '') + attr('title', k);
  const cls = 'srow' + (pickOpen ? ' pick-open' : '');
  if (k === 'contract.custom') {
    const say = '<div class="sr"><p class="ptr">Yours ride your profile as rule lines, so every session and agent on every PC carries them: <a class="link sky"' + attr('href', viewQuery(m, { tab: 'rules' })) + ' data-go="rules">see Rules</a></p></div>';
    return '<div class="' + cls + '"' + attrs + '>' + head + say + moreFold(m, row, target, back) + '</div>';
  }
  const right = '<div class="sr"><div class="cc">' + control(m, row, target, back) + '</div>' + chip(m, row, target, pickOpen) + noteOf(row, st) + '</div>';
  return '<div class="' + cls + '"' + attrs + '>' + head + right + moreFold(m, row, target, back) + picker(m, row, target) + '</div>';
}

/* ---- rule lines ---- */

function ruleForm(back, fields, label, cls = 'gbtn') {
  return '<form method="post" action="/settings/rule" class="inl">' + Object.entries(fields).map(([k, v]) => hidden(k, v)).join('') + hidden('back', back)
    + '<button type="submit" class="' + cls + '">' + label + '</button></form>';
}
function lineRow(m, l, mine, back) {
  const t = mine ? 'Set on ' + l.profile + ', held at ' + recordName(m, l.layer, l.record) : 'Built in: every board carries it';
  const drop = mine ? ruleForm(back, { op: 'clear', name: l.profile, slug: l.slug }, 'Drop') : ruleForm(back, { op: 'drop', name: m.home, slug: l.slug }, 'Drop');
  return '<div class="lrow" data-key="rules.add"' + attr('data-find', (l.slug + ' ' + l.words + ' rule lines').toLowerCase()) + (mine ? ' data-changed="1"' : '') + '>'
    + '<div class="ln"><b>' + esc(l.slug) + '</b><span class="dim">' + esc(AUDIENCE[l.audience] || AUDIENCE.both) + '</span></div><div class="lw">' + esc(l.words) + '</div>'
    + '<div class="lk"><span class="chip"' + attr('title', t) + '>' + esc(l.scope + (mine && l.profile ? ', on ' + l.profile : '')) + '</span>' + drop + '</div></div>';
}
function listHead(l, changed) {
  return '<div class="srow head"' + attr('id', 's-' + l.key) + attr('data-key', l.key) + attr('data-find', [l.label, l.line, l.key].join(' ').toLowerCase()) + (changed ? ' data-changed="1"' : '') + '><div class="sl"><div class="lab">' + esc(l.label)
    + (changed ? '<span class="cdot" title="Changed from built-in"></span>' : '') + '</div><div class="help">' + esc(l.line) + ' <a class="mbtn"' + attr('href', '#m-' + l.key) + '><span class="mo">more</span><span class="le">less</span></a></div></div>'
    + '<div class="more"' + attr('id', 'm-' + l.key) + '><div class="mh">What changes</div><p>' + esc(l.changes || '') + '</p>' + (l.example ? '<div class="mh">Example</div><p>' + esc(l.example.text || '') + '</p>' : '')
    + (l.takes ? '<div class="mh">Takes effect</div><p>' + esc(l.takes) + '</p>' : '') + '</div></div>';
}
function rulesBody(m, st, back) {
  const json = m.read;
  const lists = json.lists || [];
  const add = lists.find((l) => l.key === 'rules.add');
  const drop = lists.find((l) => l.key === 'rules.drop');
  const lines = json.rows.filter((r) => r.kind === 'line');
  const mine = lines.filter((l) => l.layer !== 'built-in');
  const built = lines.filter((l) => l.layer === 'built-in');
  const ref = st.refused && st.refused.key === 'rules' ? st.refused : null;
  const typed = (k) => (ref && ref.form ? String(ref.form[k] || '') : '');
  const aud = typed('for') || 'both';
  const parts = [listHead(add, mine.length > 0), ...mine.map((l) => lineRow(m, l, true, back))];
  parts.push('<form method="post" action="/settings/rule" class="addline" id="s-rules"><div class="lab">Add a rule line</div>' + hidden('op', 'add') + hidden('name', m.home) + hidden('back', back)
    + '<div class="addf"><input class="fld slug" name="slug" placeholder="name" aria-label="Name"' + attr('value', typed('slug')) + ' data-drawn="" autocomplete="off">'
    + '<input class="fld grow" name="text" placeholder="the rule in plain words" aria-label="The rule"' + attr('value', typed('text')) + ' data-drawn="" autocomplete="off"></div>'
    + '<div class="addf"><span class="seg" role="radiogroup" aria-label="For">' + ['session', 'agents', 'both'].map((a) => '<label><input type="radio" name="for"' + attr('value', a) + (a === aud ? ' checked' : '') + '>' + a + '</label>').join('') + '</span>'
    + '<span class="dim">on ' + esc(m.home) + ', everywhere</span><button type="submit" class="gbtn">Add</button></div>'
    + (ref ? '<div class="note no" role="alert"><b>Not saved.</b> ' + esc(ref.why) + '</div>' : st.saved === 'rules' ? '<div class="note ok" role="status"><span class="tick" aria-hidden="true"></span><div><div>Saved on ' + esc(m.home) + '.</div><div class="dim">' + esc(add.takes || '') + '</div></div></div>' : '')
    + '</form>');
  parts.push(listHead(drop, m.drops.length > 0));
  for (const s of m.drops) {
    parts.push('<div class="lrow" data-key="rules.drop"' + attr('data-find', (s + ' dropped lines').toLowerCase()) + ' data-changed="1"><div class="ln"><b>' + esc(s) + '</b><span class="dim">dropped</span></div>'
      + '<div class="lw dim">Off for every session and agent this profile reaches.</div><div class="lk"><span class="chip">everywhere, on ' + esc(m.home) + '</span>' + ruleForm(back, { op: 'clear', name: m.home, slug: s }, 'Bring back') + '</div></div>');
  }
  parts.push('<p class="dim dropnote">Press drop on a built-in line to switch it off on ' + esc(m.home) + ', everywhere.</p>');
  parts.push('<details class="done-f bfold"><summary>Built-in lines (' + built.length + ') <span class="dim3">' + esc(built.map((l) => l.slug).join(', ')) + '</span></summary>'
    + built.map((l) => lineRow(m, l, false, back)).join('') + '</details>');
  return '<section class="panel">' + parts.join('') + '</section>';
}

/* ---- This PC: every joined PC, read only; a token only as set or not set ---- */

function pcRow(key, why) {
  const s = PC_SETTINGS[key];
  return '<div class="srow"' + attr('data-key', key) + attr('data-find', [s.label, s.line, key].join(' ').toLowerCase()) + attr('title', key) + '><div class="sl"><div class="lab">' + esc(s.label) + '</div><div class="help">' + esc(s.line) + '</div></div>'
    + '<div class="sr"><div class="cc txt"><div class="why dim">Read only: ' + esc(why) + '.</div></div><span class="chip ro" title="Kept in the config.json of each PC">each PC</span></div></div>';
}
function pcBody(m) {
  const keeps = '<section class="panel"><h2>What each PC keeps</h2>' + pcRow('queue', "a board PC's queue is hub, set by the join")
    + pcRow('boardUrl', 'set by the join') + pcRow('boardToken', 'set by the join; it never leaves that PC, and the board shows only whether it is set') + '</section>';
  return keeps + m.devices.map((d) => {
    const me = d.device === m.device;
    const head = '<div class="devh"><h2 class="dn">' + esc(d.device) + '</h2>' + (me ? '<span class="chip active">this browser signed in through it</span>' : '')
      + (d.live ? '<span class="dim">joined ' + esc(dateOf(d.joined)) + '</span>' : '<span class="chip stalled">token revoked ' + esc(dateOf(d.revoked)) + '</span>') + '</div>';
    const facts = [[PC_SETTINGS.queue.label, PC_SETTINGS.queue.choices.hub], [PC_SETTINGS.boardUrl.label, m.origin],
      [PC_SETTINGS.boardToken.label, d.live ? 'set' : 'not set: a join code rejoins it']];
    const find = ['pc', d.device, ...facts.flat()].join(' ').toLowerCase();
    return '<section class="panel dev"' + attr('data-find', find) + '>' + head + '<dl class="facts">' + facts.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl></section>';
  }).join('');
}
function pcSummary(m) {
  const ds = m.devices;
  const live = ds.filter((d) => d.live).length;
  return plural(ds.length, 'PC') + (ds.length === 1 ? ' has' : ' have') + ' joined this board; ' + (live === ds.length ? 'each holds' : live + ' of them hold') + ' a live token, and their questions wait here.';
}

/* ---- the page ---- */

/* `back` is the tab's own address, so a save comes back on its tab whichever one the script shows */
function tabBody(m, t, st) {
  const tab = t.tab;
  const back = viewQuery(m, { tab: tab === 'replies' ? '' : tab });
  const rows = m.read.rows.filter((r) => r.tab === tab && r.kind !== 'line');
  const stOf = (r) => ({ saved: st.saved === r.key, refused: st.refused && st.refused.key === r.key ? st.refused : null });
  const panel = (rs, h) => (rs.length ? '<section class="panel">' + (h ? '<h2>' + esc(h) + '</h2>' : '') + rs.map((r) => settingRow(m, r, stOf(r), back)).join('') + '</section>' : '');
  const out = ['<h2 class="gh">' + esc(t.name) + '</h2>', '<p class="sum">' + esc(tab === 'pc' ? pcSummary(m) : t.summary) + '</p>'];
  if (tab === 'pc') out.push('<p class="dim sub2">Your phone signs in with a login link from one of them and keeps no settings of its own.</p>', pcBody(m));
  else if (tab === 'rules') out.push(rulesBody(m, st, back));
  else if (tab === 'agents') out.push(panel(rows.filter((r) => r.key.startsWith('agent.')), 'The guard'), panel(rows.filter((r) => r.key.startsWith('dispatch.')), 'Briefs'));
  else out.push(panel(rows));
  return '<section class="sub' + (tab === m.tab ? ' on' : '') + '"' + attr('data-sub', tab) + '>' + out.join('') + '</section>';
}

/* `st`: { saved: a row's key or 'rules', refused: { key, why, form } } */
export function settingsPage(kit, m, st = {}) {
  const back = viewQuery(m);
  const tabs = m.read.tabs.map((t) => '<a' + attr('href', viewQuery(m, { tab: t.tab === 'replies' ? '' : t.tab })) + attr('data-go', t.tab) + (t.tab === m.tab ? ' class="on" aria-current="page"' : '') + '>' + esc(t.name)
    + (t.changed ? '<span class="n">' + t.changed + '</span>' : '') + '</a>').join('');
  const side = '<aside class="sside"><input type="search" class="sfind" placeholder="Search every setting" aria-label="Search every setting" hidden>'
    + '<button type="button" class="tog only" aria-pressed="false" hidden><span class="sw"></span>Changed only</button><nav class="subs" aria-label="Settings groups">' + tabs + '</nav></aside>';
  const body = m.read.tabs.map((t) => tabBody(m, t, st)).join('');
  /* a refusal no row can show (a key the page does not draw) goes above the chooser */
  const lost = st.refused && st.refused.key !== 'rules' && !m.read.rows.some((r) => r.key === st.refused.key && r.kind !== 'line');
  const top = lost ?'<div class="note no" role="alert"><b>Not saved.</b> ' + esc(st.refused.why) + '</div>' : '';
  return '<div class="settings"' + attr('data-back', back) + '><h1>Settings</h1><p class="lede">Every setting your sessions and agents read, kept on this board\'s profiles, so each PC and your phone see the same values.</p>'
    + top + scopeHead(m) + '<div class="sgrid">' + side + '<div class="smain"><p class="sum hits" aria-live="polite"></p>' + body + '</div></div></div>';
}

export const SIGNED_OUT_LINE = '<p class="lede after">After you sign in, this link opens the board\'s settings: every setting your sessions and agents read, from any PC or your phone.</p>';
