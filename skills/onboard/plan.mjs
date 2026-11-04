#!/usr/bin/env node
/* the user's marks on the review page turned into the apply plan. Each step is one CLI
   call (args, plus stdin JSON or a body file); `@{id}` names the id an earlier step made.
   node plan.mjs <work dir> [--session <id>] [--chat-go]   (reads rows.json and choices.json, writes plan.json) */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateProblems } from '../../server/handoff-text.mjs';

const STATE_BYTES = 10240;
const LINE_MAX = 400;
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const t = oneLine(s); return t.length > n ? t.slice(0, n - 3) + '...' : t; };
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const ref = (id) => '@{' + id + '}';
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/* Where a row came from and its date, said in the record's own text (the CLI keeps created, not updated or closed). */
export function fromLine(row) {
  const w = row.where || {};
  const at = w.file + (w.line ? ' line ' + w.line : '') + (w.commit ? ' (commit ' + w.commit + ')' : '');
  const how = { commit: 'commit date', blame: 'line last changed', text: 'dated in the text', mtime: 'file time', heading: 'dated in the heading' }[row.dateHow] || 'date';
  return 'From the old system: ' + at + (row.date ? ', ' + row.date + ' (' + how + ')' : '') + (row.closed ? '; done there by ' + row.closed : '') + '.';
}

function wrap(line) {
  if (line.length <= LINE_MAX) return [line];
  const out = [];
  let rest = line;
  while (rest.length > LINE_MAX) {
    let cut = rest.lastIndexOf(' ', LINE_MAX);
    if (cut < LINE_MAX / 2) cut = LINE_MAX;
    out.push(rest.slice(0, cut).trimEnd());
    rest = '  ' + rest.slice(cut).trimStart();
  }
  out.push(rest);
  return out;
}

/* An old handoff's text as a handoff state: long lines wrapped, a "Next" list and a
   "Where we were" heading renamed so the board reads them as history, cut at 10 KB. */
export function historyState(text, where) {
  const tail = '(cut at 10 KB: the whole text is ' + where + ')';
  let lines = String(text || '').replace(/\r\n/g, '\n').trim().split('\n').flatMap(wrap).map((l) => {
    const bare = l.replace(/^#{1,6}\s*/, '').replace(/[*_:]/g, '').trim();
    if (l.trim() === '## Where we were') return '## Where we were (old handoff)';
    return bare.length <= 40 && /\bnext\b/i.test(bare) ? l.replace(/\s*$/, ' (as the old handoff had it)') : l;
  });
  if (!lines.join('').trim()) lines = ['(empty at this version)'];
  let state = lines.join('\n');
  if (bytes(state) > STATE_BYTES) {
    const keep = [];
    let n = bytes(tail) + 2;
    for (const l of lines) { if (n + bytes(l) + 1 > STATE_BYTES) break; keep.push(l); n += bytes(l) + 1; }
    state = keep.join('\n') + '\n' + tail;
  }
  const left = stateProblems(state, { state: STATE_BYTES, line: LINE_MAX });
  return left.length ? '(this version did not fit a handoff: ' + clip(left.join('; '), 300) + '; read ' + where + ')' : state;
}

/* the board reads a bare Q-and-number token in a question's prose as one of its own
   records, so an old queue's labels become the old question's title; one in a file name passes. */
const bareTitle = (s) => String(s || '').replace(/^Q\d+(-|\s+)/, '').replace(/\.md$/, '').replace(/-/g, ' ').trim();
export function oldTitles(rows) {
  const out = new Map();
  for (const r of rows) {
    const m = /^(\.claude\/questions\/[^/]+)\/Q(\d+)-/.exec((r.where && r.where.file) || '');
    if (m) out.set(m[1] + '#' + m[2], bareTitle((r.fields && r.fields.name) || r.title) || 'old question ' + m[2]);
  }
  return out;
}
/* a label heading a file name (`Q1-take.md`) is left as it is, as the board's inPath reads it */
export function unlabel(text, titles, folder) {
  const named = (dir, n) => '"' + (titles.get(dir + '#' + n) || 'old question ' + n) + '"';
  return String(text ?? '').replace(/(^|[^\\/.\w])Q(\d+)\b(?!-[a-z]|\.[A-Za-z0-9])/g, (m, pre, n) => pre + (folder ? named(folder, n) : 'old question ' + n));
}

export function gitReader(dir) {
  return (v) => {
    if (!v.commit) { try { return readFileSync(join(dir, v.path), 'utf8'); } catch { return ''; } }
    const r = spawnSync('git', ['show', v.commit + ':' + v.path], { cwd: dir, encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20 });
    return r.status === 0 ? r.stdout : '';
  };
}

/* rows.json plus choices.json to the plan: { steps, after, pending, left, counts }.
   `readVersion(v)` gives an old handoff's text at a version (git show by default). */
export function buildPlan(doc, choices, { readVersion, session } = {}) {
  const { dir, slug, shared } = doc.project;
  const label = 'import:' + slug;
  const read = readVersion || gitReader(dir);
  const marks = (choices && choices.items) || {};
  const choiceOf = (r) => (marks[r.id] && marks[r.id].choice) || r.def || 'keep';
  const steps = [];
  const after = [];
  const pending = [];
  const left = [];
  const add = (s) => { steps.push({ n: steps.length + 1, ...s }); return s; };
  /* the session on the writes that use it only to name who wrote them; never on track new
     (the session would hold every imported track) or handoff write (it lets go of the session's tasks in hand) */
  const by = session ? ['--session', session] : [];
  const bySession = session ? { session } : {};
  const pend = (r, why) => pending.push({ row: r.id, title: r.title, why, note: (marks[r.id] && marks[r.id].note) || '' });

  const kept = [];
  for (const r of doc.rows) {
    const c = choiceOf(r);
    if (c === 'leave') { left.push(r.id); continue; }
    if (c === 'convert' && !r.converted) { pend(r, 'marked convert: rework the row as the note says, then set converted'); continue; }
    /* a Convert the session reworked into a leave, ahead of the home checks; choices.json stays as the user marked it */
    if (c === 'convert' && r.choice === 'leave') { left.push(r.id); continue; }
    if (r.home === '?') { pend(r, 'unplaced: place it, or ask, before it can go in'); continue; }
    if (r.home === 'none') { pend(r, 'it has no home on the board: leave it or give it one'); continue; }
    if (r.home === 'rule' && !(r.fields && r.fields.text)) { pend(r, 'a rule line needs words of at most 400 characters'); continue; }
    kept.push(r);
  }
  const keptIds = new Set(kept.map((r) => r.id));
  const of = (home) => kept.filter((r) => r.home === home);

  /* workstreams: an existing one is used as it is; a new one is made, dated by the project */
  const wsRef = new Map();
  for (const r of of('workstream')) {
    const f = r.fields || {};
    const key = f.key || r.id.replace(/^ws:/, '');
    if (f.use) { wsRef.set(key, f.use); continue; }
    add({ id: r.id, row: r.id, op: 'ws create', args: ['ws', 'create'], stdin: {
      name: f.name || r.title, description: oneLine(f.description || r.title) + '\n\n' + fromLine(r), projects: [dir],
      labels: [label], refs: ['onboard:' + r.id], ...(r.date ? { created: r.date } : {}), ...(f.outcomes ? { outcomes: f.outcomes } : {}), ...bySession,
    } });
    wsRef.set(key, ref(r.id));
  }
  const wsOf = (r) => {
    const w = (r.fields || {}).workstream || 'main';
    if (/^WS-\d+$/.test(w)) return w;
    return wsRef.get(w) || null;
  };

  /* tasks, each dated by its line in the old list */
  const taskRefs = new Map();
  const made = [];
  for (const r of of('task')) {
    const f = r.fields || {};
    const ws = wsOf(r);
    if (!ws) { pend(r, 'its workstream is left out'); continue; }
    made.push(r);
    add({ id: r.id, row: r.id, op: 'task create', args: ['task', 'create'], stdin: {
      name: clip(f.name || r.title, 200), description: (f.text || r.title) + '\n\n' + fromLine(r), ...(f.intent ? { intent: f.intent } : {}),
      workstream: ws, status: f.status === 'completed' ? 'completed' : f.status === 'dropped' ? 'dropped' : 'open', priority: f.priority || 'medium',
      labels: [label], refs: ['onboard:' + r.id], ...(r.date ? { created: r.date } : {}), ...bySession,
    } });
    const t = f.track && keptIds.has(f.track) ? f.track : null;
    if (t) { if (!taskRefs.has(t)) taskRefs.set(t, []); taskRefs.get(t).push({ ref: ref(r.id), open: f.status !== 'completed' && f.status !== 'dropped' }); }
  }

  /* a task row's after (row ids, T-n ids, or a number naming the n-th task row on its
     track, 1 first), before and runBy; an edge to a row this plan does not write is reported */
  const madeIds = new Set(made.map((r) => r.id));
  const ended = (r) => ['completed', 'dropped'].includes((r.fields || {}).status);
  const groupOf = (r) => { const t = (r.fields || {}).track; return t && keptIds.has(t) ? t : null; };
  const unlinked = [];
  const edgeTo = (r, a) => {
    const grp = made.filter((x) => groupOf(x) === groupOf(r));
    const n = /^\d+$/.test(String(a).trim()) ? Number(a) : 0;
    const row = n ? grp[n - 1] : null;
    const s = row ? row.id : String(a).trim();
    if (/^T-\d+$/.test(s)) return s;
    if (madeIds.has(s) && s !== r.id) return ref(s);
    unlinked.push({ row: r.id, names: a, why: 'is no task this plan writes' });
    return null;
  };
  const orders = new Map();
  const order = (r) => {
    if (orders.has(r.id)) return orders.get(r.id);
    const f = r.fields || {};
    const after = list(f.after).map((a) => edgeTo(r, a)).filter(Boolean);
    const before = list(f.before).map((b) => edgeTo(r, b)).filter(Boolean);
    const o = { after, before, runBy: f.runBy ? String(f.runBy) : null };
    orders.set(r.id, o);
    return o;
  };
  const laid = new Set();
  const ordered = (r) => { const o = order(r); return o.after.length || o.before.length || o.runBy; };

  /* tracks: the old handoffs become its history, oldest first, each with its own date */
  const madeTracks = new Set();
  for (const r of of('track')) {
    const f = r.fields || {};
    const ws = wsOf(r);
    if (!ws) { pend(r, 'its workstream is left out'); continue; }
    const tasks = taskRefs.get(r.id) || [];
    const hist = f.history || [];
    madeTracks.add(r.id);
    const span = hist.length ? hist[0].at.slice(0, 10) + ' to ' + hist[hist.length - 1].at.slice(0, 10) : r.date;
    add({ id: r.id, row: r.id, op: 'track new', files: f.files || [r.where.file], args: ['track', 'new', '--workstream', ws, '--name', clip(f.name || r.title, 120),
      '--goal', clip((f.goal ? f.goal + ' ' : '') + 'From the old system: ' + (f.files || [r.where.file]).join(', ') + (span ? ', ' + span : '') + '.', 400),
      '--label', label, '--ref', 'onboard:' + r.id, ...tasks.flatMap((t) => ['--task', t.ref])] });
    /* the old list's order onto the track, so the ready set holds only what nothing waits on */
    const open = made.filter((x) => groupOf(x) === r.id && !ended(x));
    if (open.some(ordered)) {
      add({ id: r.id + '@layout', row: r.id, op: 'track layout', args: ['track', 'layout', ref(r.id)], stdin: { steps: open.map((x) => {
        const o = order(x);
        laid.add(x.id);
        return { task: ref(x.id), ...(o.after.length ? { after: o.after } : {}), ...(o.before.length ? { before: o.before } : {}), ...(o.runBy ? { runBy: o.runBy } : {}) };
      }) } });
    }
    const state = f.state || 'waiting';
    hist.forEach((v, i) => {
      const last = i === hist.length - 1;
      const where = v.path + (v.commit ? ' at commit ' + v.commit : ' (uncommitted)');
      const parked = last && state === 'parked';
      add({ id: r.id + '@' + (i + 1), row: r.id, op: 'handoff write', args: ['handoff', 'write', ref(r.id)], stdin: {
        focus: clip('From the old system: ' + v.path + ' as of ' + v.at.slice(0, 10) + (v.subject ? ' (' + v.subject + ')' : ''), 400),
        state: historyState(read(v), where), verifyFirst: [{ path: dir, ...(v.commit ? { commit: v.commit } : {}) }], created: v.at,
        ...(parked ? { status: 'parked', parkReason: clip(f.parkReason || 'imported: parked in the old system', 300) } : {}),
      } });
    });
    if (state === 'finished') {
      add({ id: r.id + '@finish', row: r.id, op: 'track finish', args: ['track', 'finish', ref(r.id), '--outcome', 'imported: finished in the old system',
        ...(tasks.some((t) => t.open) ? ['--leftovers', 'inbox'] : []), ...by] });
    } else if (state === 'parked' && !hist.length) {
      add({ id: r.id + '@park', row: r.id, op: 'track park', args: ['track', 'park', ref(r.id), '--reason', clip(f.parkReason || 'imported: parked in the old system', 300), ...by] });
    }
  }

  /* an ordered task no layout carried (it is on no track): its run-by and edges one by one */
  for (const r of made.filter((x) => !ended(x) && !laid.has(x.id) && ordered(x))) {
    const o = order(r);
    if (o.runBy) add({ id: r.id + '@runby', row: r.id, op: 'task edit', args: ['task', 'edit', ref(r.id), '--run-by', o.runBy, ...by] });
    o.after.forEach((on, i) => add({ id: r.id + '@after' + (i + 1), row: r.id, op: 'edge add', args: ['edge', 'add', ref(r.id), on, '--reason', 'the order of the old list', ...by] }));
    o.before.forEach((t, i) => add({ id: r.id + '@before' + (i + 1), row: r.id, op: 'edge add', args: ['edge', 'add', t, ref(r.id), '--reason', 'the order of the old list', ...by] }));
  }

  /* rulings and facts, dated as the old system dated them */
  const firstWs = [...wsRef.values()][0];
  for (const r of of('decision')) {
    const f = r.fields || {};
    /* workstreams always named, so decide never links the track the session holds */
    add({ id: r.id, row: r.id, op: 'decide', args: ['decide', ...by], stdin: {
      title: clip(f.title || r.title, 200), body: String(f.body || r.excerpt || r.title).trim() + '\n\n' + fromLine(r), ...(f.words ? { words: f.words } : {}),
      projects: [dir], labels: [label], refs: ['onboard:' + r.id], ...(r.date ? { created: r.date } : {}), workstreams: firstWs ? [firstWs] : [],
    } });
  }
  for (const r of of('knowledge')) {
    const f = r.fields || {};
    add({ id: r.id, row: r.id, op: 'knowledge new', args: ['knowledge', 'new', '--type', f.type === 'decision' ? 'decision' : 'gotcha', '--title', clip(f.title || r.title, 200),
      '--project', dir, '--label', label, '--ref', 'onboard:' + r.id, ...(r.date ? ['--created', r.date] : []), ...by],
    body: String(f.body || r.excerpt || r.title).trim() + '\n\n' + fromLine(r) });
  }
  const titles = oldTitles(doc.rows);
  for (const r of of('question')) {
    const f = r.fields || {};
    /* the ref keeps the row id: a rerun from another PC matches by it, and the board never reads a ref's text as an id */
    const folder = (/^(\.claude\/questions\/[^/]+)\//.exec(r.where.file || '') || [])[1];
    const un = (t) => unlabel(t, titles, folder);
    const ask = un(oneLine(f.ask || r.title));
    const options = (f.options || []).map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'type' || typeof v !== 'string' ? v : un(v)])));
    add({ id: r.id, row: r.id, op: 'register', args: ['register'], stdin: {
      name: clip(un(folder ? bareTitle(f.name || r.title) : f.name || r.title), 80), ask: /\?$/.test(ask) ? ask : ask + '?',
      gist: un((f.gist || '**From the old system:** ' + r.where.file) + '\n' + fromLine(r)),
      projectDir: dir, session: session || 'onboard-' + slug, blocking: f.blocking === true, ...(options.length ? { options } : {}),
      ...(f.pick ? { pick: f.pick } : { pick: null }), ...(r.date ? { created: r.date } : {}), ...(firstWs ? { workstream: firstWs } : {}),
      labels: [label], refs: ['onboard:' + r.id],
    } });
    /* the track it belongs to and the tasks it blocks (row ids, or TR-n and T-n), once they exist */
    const tr = f.track ? (madeTracks.has(f.track) ? ref(f.track) : /^TR-\d+$/.test(f.track) ? f.track : null) : null;
    if (f.track && !tr) unlinked.push({ row: r.id, names: f.track, why: 'is no track this plan writes', kind: 'Track' });
    const gates = list(f.gates).map((g) => String(g).trim()).filter((g) => {
      if (/^T-\d+$/.test(g) || madeIds.has(g)) return true;
      unlinked.push({ row: r.id, names: g, why: 'is no task this plan writes', kind: 'Gate' });
      return false;
    }).map((g) => (madeIds.has(g) ? ref(g) : g));
    if (tr || gates.length) {
      add({ id: r.id + '@scope', row: r.id, op: 'question edit', args: ['question', 'edit', ref(r.id), ...(tr ? ['--track', tr] : []), ...gates.flatMap((g) => ['--add-gate', g]), ...by] });
    }
  }

  /* rule lines, then each profile held on the project unless it already is; the project's own
     profile (named by its slug) never goes into one built in or held by anything else */
  const onBoard = (p) => ((doc.board && doc.board.profiles) || []).find((x) => x.profile === p);
  const renamed = [];
  const nameFor = (p) => {
    const x = p === slug && onBoard(p);
    if (!x || !(x.builtIn || x.elsewhere)) return p;
    let n = p;
    for (let k = 2; onBoard(n); k++) n = p.slice(0, 36) + '-' + k;
    renamed.push({ asked: p, profile: n, why: p + (x.builtIn ? ' is built in' : ' is held by ' + (x.records || []).join(', ')) });
    return n;
  };
  const profiles = new Map();
  for (const r of of('rule')) {
    const f = r.fields;
    const want = f.profile || slug;
    if (!profiles.has(want)) profiles.set(want, nameFor(want));
    const profile = profiles.get(want);
    add({ id: r.id, row: r.id, op: 'profile rule-add', args: ['profile', 'rule-add', profile, f.slug, '--text', f.text, ...(f.for && f.for !== 'both' ? ['--for', f.for] : []), ...by] });
  }
  const held = (p) => { const x = onBoard(p); return Boolean(x && (x.here || (x.records || []).some((rec) => [dir, shared].some((d) => String(rec).toLowerCase() === String(d).toLowerCase())))); };
  for (const p of profiles.values()) if (!held(p)) add({ id: 'hold:' + p, row: null, op: 'profile add', args: ['profile', 'add', dir, p, ...by] });

  /* procedure cards come from docs/procedures files: a scan for those there, a repo edit first for the rest */
  const procs = of('procedure');
  if (procs.some((r) => r.fields && r.fields.scan)) add({ id: 'proc-scan', row: null, rows: procs.filter((r) => r.fields.scan).map((r) => r.id), op: 'proc scan', args: ['proc', 'scan', '--project', dir] });
  for (const r of procs.filter((x) => !(x.fields && x.fields.scan))) {
    after.push({ row: r.id, what: 'write ' + (r.fields.target || 'docs/procedures/<name>.md') + ' from ' + r.where.file + (r.where.line ? ' line ' + r.where.line : '') + ', commit it, then run proc scan --project ' + dir });
  }

  const counts = {};
  for (const s of steps) counts[s.op] = (counts[s.op] || 0) + 1;
  return { made: new Date().toISOString(), marked: Boolean(choices && choices.done), project: doc.project, label, steps, after, pending, left, counts, profiles: renamed, unlinked };
}

/* with no call left open, the user's go in chat stands for the page's I'm done.
   Marks the page already saved stay; a call still unmarked needs the page. */
export function chatGo(doc, choices) {
  const items = (choices && choices.items) || {};
  const open = doc.rows.filter((r) => r.call && !(items[r.id] && items[r.id].choice));
  if (open.length) throw new Error(open.length + ' calls still wait on the user (' + open.map((r) => r.title).slice(0, 3).join('; ') + '): they mark them on the page, or answer them on the band first');
  return { version: 1, ...(choices || {}), items, done: true, from: 'chat', savedAt: new Date().toISOString() };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const work = process.argv[2];
  if (!work || work === '--help') { console.log('node plan.mjs <work dir> [--session <id>] [--chat-go]'); process.exit(work ? 0 : 1); }
  const si = process.argv.indexOf('--session');
  const doc = JSON.parse(readFileSync(join(work, 'rows.json'), 'utf8'));
  let choices = null;
  try { choices = JSON.parse(readFileSync(join(work, 'choices.json'), 'utf8')); } catch { /* none yet */ }
  if (process.argv.includes('--chat-go')) {
    try { choices = chatGo(doc, choices); } catch (e) { console.error('plan: ' + e.message); process.exit(1); }
    writeFileSync(join(work, 'choices.json'), JSON.stringify(choices, null, 2) + '\n');
    console.log('choices.json: done from the go in chat, ' + Object.keys(choices.items).length + ' page marks kept');
  }
  if (!choices) { console.error('plan: no choices.json in ' + work + ': the page has not been marked (with no calls, --chat-go takes the go in chat)'); process.exit(1); }
  const plan = buildPlan(doc, choices, { session: si > 0 ? process.argv[si + 1] : undefined });
  writeFileSync(join(work, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  console.log('plan.json: ' + plan.steps.length + ' steps (' + Object.entries(plan.counts).map(([k, v]) => k + ' ' + v).join(', ') + '); left out ' + plan.left.length
    + '; for after the write ' + plan.after.length + (choices.done ? '' : '; the page is not marked done yet'));
  for (const u of plan.unlinked) console.log((u.kind || 'Edge') + ' dropped: ' + u.row + ' names ' + JSON.stringify(u.names) + ', which ' + u.why + '.');
  for (const p of plan.profiles) console.log('Rule lines go to profile ' + p.profile + ', not ' + p.asked + ': ' + p.why + '.');
  if (plan.pending.length) {
    console.log('Waiting on the session (' + plan.pending.length + '):');
    for (const p of plan.pending) console.log('  ' + p.row + ': ' + p.why + (p.note ? ' (note: ' + clip(p.note, 160) + ')' : ''));
  }
}
