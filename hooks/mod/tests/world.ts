/* The world beneath the mod in its tests: the session, the host calls, a local server
 * (its route and band, by default) and a fake AskerDo CLI answering from memory,
 * every run recorded. */
import { mock } from 'claude-code/testing'
import { bandModel } from '../../../lib/mod-core.mjs'

/* via: the local route ran it, or a process (a 409, the server's start, or a script with no route) */
export type Run = { script: string; args: string[]; stdin?: string; env?: Record<string, string>; via: 'route' | 'process' }

/* the local server's address, as its local.json names it */
export const LOCAL_ROOT = 'http://127.0.0.1:7777/' + 'a'.repeat(32) + '/'
const HOME = 'C:/Users/test-home'

/* server: false starts the world with no local server running (no local.json) */
export function world(on: any, opts: { store?: Record<string, unknown>; server?: boolean } = {}) {
  const w: any = {
    sid: 'sess-1',
    cwd: 'C:/src/proj',
    runs: [] as Run[],
    env: {} as Record<string, string | undefined>,
    events: [] as string[],
    commands: [] as string[],
    tools: [] as any[],
    prompts: [] as string[],
    /* each prompt's origin, as the engine stamps it (asUser or framed) */
    origins: [] as any[],
    contexts: [] as any[],
    /* the board's tracks; sess-1 holds TR-3 (its lease), whose tasks the now set names */
    tracks: [
      { id: 'TR-3', key: 'trk3abcd', name: 'mod core', state: 'active', workstream: 'WS-11', session: 'sess-1', text: '1 running, 2 ready, 4 to go',
        tasks: ['T-41', 'T-42'], now: [{ id: 'T-41' }], handoffs: [{ id: 'TR-3.1', status: 'resumed', focus: 'start', created: '2026-10-24T10:00:00+00:00' }] },
      { id: 'TR-4', key: 'trk4abcd', name: 'parked line', state: 'parked', workstream: 'WS-12', parkReason: 'later', text: '0 running, 1 ready, 1 to go',
        tasks: [], now: [], handoffs: [{ id: 'TR-4.2', status: 'parked', focus: 'Parked: later', created: '2026-10-22T10:00:00+00:00' }] },
    ] as any[],
    questions: [
      { id: 'Q106', name: 'store shape', blocking: true, workstream: 'WS-11', track: 'TR-3', gist: 'One file or many?', pick: 'b',
        options: [{ type: 'a', option: 'one file', getsYou: 'simple', costsYou: 'churn' },
          { type: 'b', option: 'many files', getsYou: 'isolation', costsYou: 'more files' }] },
    ],
    shelf: [{ track: 'TR-4', key: 'trk4abcd', handoff: 'TR-4.2', name: 'parked line', state: 'parked', workstream: 'WS-12', age: '2d', focus: 'Parked: later',
      parkReason: 'later', resume: '/askerdo resume TR-4' }] as any[],
    usageCalls: 0,
    toasts: [] as string[],
    fetches: [] as any[],
    fetchAnswer: { status: 200, ok: true, headers: {}, text: '{"ok":true,"via":"popup","files":0}' } as any,
    fetchBy: {} as Record<string, any>,
    reads: [] as any[],
    fail: {} as Record<string, string>,
    boardUrl: 'http://board/#p=proj',
    panes: [] as any[],
    dialogs: [] as any[],
    appends: [] as any[],
    logs: [] as string[],
    /* $.ui.log lines sent { to: 'debug' }, off the transcript */
    debugLogs: [] as string[],
    /* what scripts/mod-contract.mjs prints: no saved options unless a test sets them */
    contract: { section: null, checks: null } as any,
    /* what scripts/mod-alias.mjs prints from the saved options */
    alias: { alias: '' } as any,
    /* this PC's queued answers by session, as scripts/mod-queue.mjs keeps them in the data folder */
    queuedFile: {} as Record<string, any[]>,
    /* names $.command.register refuses (a skill holds them), and what $.command.list shows */
    refuse: [] as string[],
    listed: [{ name: 'resume', source: 'builtin', description: '' }] as any[],
    /* what scripts/depth-marker.mjs answers: off unless a test opts in */
    guard: { on: false, source: null, guard: null } as any,
    /* what scripts/rules.mjs prints: none unless a test sets it */
    rules: null as any,
    /* each session's inbox as scripts/mod-inbox.mjs takes it: { key, line, raw } */
    inbox: {} as Record<string, any[]>,
    /* sessions $.session.send reaches (running), and what was sent */
    live: [] as string[],
    sent: [] as any[],
    agentMessages: {} as Record<string, any[]>,
    /* answered questions stay readable by show, as in the store */
    answered: [] as any[],
    /* the tasks show reads back, and the usage the session reports */
    tasks: [] as any[],
    usage: { rateLimits: [] } as any,
    /* the activity lines Home reads (--places), newest first; the panes the app holds open, and what the mod closed */
    feed: [] as any[],
    open: [] as string[],
    closed: [] as string[],
    /* the board's band calls (bandCalls rows); a row's `told` session gets `told.line` when pressed */
    calls: [] as any[],
    verbs: [] as any[],
  }
  w.clock = mock.clock(on)
  /* a move of the marker is a change on the board, which a held wait answers */
  let marker = '2026-10#1'
  Object.defineProperty(w, 'marker', { get: () => marker, set: (v: string) => { marker = v; if (w.change) w.change() }, enumerable: true })
  /* the mod's own store, as mock.store keeps it, readable by the test */
  w.stored = JSON.parse(JSON.stringify(opts.store || {})) as Record<string, any>
  on('store.get', ($: any, e: any) => ({ value: w.stored[e.key] === undefined ? undefined : JSON.parse(JSON.stringify(w.stored[e.key])) }))
  on('store.set', ($: any, e: any) => { w.stored[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } })
  on('store.delete', ($: any, e: any) => { delete w.stored[e.key]; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(w.stored) }))
  w.event = (id: string, pick: string, by = 'other-sess', at = '2026-10-20T10:00:00+00:00') => ({
    key: [at, 'answer', id, pick, '', by].join('|'),
    line: id + ' (store shape) was answered in another session: ' + id.replace(/^Q/, '') + pick + '.',
    raw: { at, kind: 'answer', id, name: 'store shape', pick, by },
  })
  /* what a take answered stays in `taken` until a later take acks its key; --lineage reads the old ids too */
  w.taken = {} as Record<string, any[]>
  w.unacked = (sid: string) => [...(w.taken[sid] || []), ...(w.inbox[sid] || [])]
  w.inboxRun = (args: string[], stdin?: string) => {
    const flag = (n: string) => { const i = args.indexOf('--' + n); return i < 0 ? undefined : args[i + 1] }
    const sid = flag('session') as string
    if (args[0] === 'put') { (w.inbox[sid] || (w.inbox[sid] = [])).push(...JSON.parse(stdin || '[]')); return { put: 1 } }
    const acks = args.includes('--ack') ? JSON.parse(stdin || '{}') : {}
    const events: any[] = []
    for (const b of [sid, ...String(flag('lineage') || '').split(',').filter(Boolean)]) {
      if (args[0] === 'take') {
        w.taken[b] = [...(w.taken[b] || []).filter((e: any) => !(acks[b] || []).includes(e.key)), ...(w.inbox[b] || [])]
        w.inbox[b] = []
      }
      events.push(...w.unacked(b).map((e: any) => ({ ...e, box: b })))
    }
    return { events }
  }
  w.cli = (args: string[], stdin?: string, env?: Record<string, string>): any => {
    const verb = ['thread', 'handoff', 'task', 'plan', 'track', 'question'].includes(args[0]) ? args[0] + ' ' + args[1] : args[0]
    if (w.fail[verb]) return { exitCode: 1, stdout: '', stderr: 'AskerDo: ' + w.fail[verb] + '\n' }
    const flag = (n: string) => { const i = args.indexOf('--' + n); return i < 0 ? undefined : args[i + 1] }
    const json = (v: any) => ({ exitCode: 0, stdout: JSON.stringify(v) + '\n', stderr: '' })
    /* the board verb starts the local server of the store root its caller names */
    if (verb === 'board') {
      w.serverAt((env && env.ASKERDO_ROOT) || String(w.env.USERPROFILE || HOME) + '/.claude/askerdo')
      return json({ status: 'started', url: LOCAL_ROOT, port: 7777 })
    }
    if (verb === 'list') {
      const sess = flag('session')
      /* the CLI matches a project by remote, else by path; the world has no remotes,
         and a question with no folder stands in every project */
      const dir = (d: any) => String(d || '').replace(/\\/g, '/').toLowerCase()
      const proj = flag('project')
      const qs = w.questions.filter((q: any) => (!sess || (q.subscribers || []).includes(sess)) && (!args.includes('--blocking') || q.blocking)
        && (!proj || !q.projectDir || dir(q.projectDir) === dir(proj)))
      return json({ questions: qs.map(({ options, subscribers, pick, ...q }: any) => q) })
    }
    if (verb === 'activity' && args.includes('--places')) {
      const proj = flag('project')
      const lines = w.feed.filter((l: any) => !proj || String(l.project).toLowerCase() === proj.toLowerCase())
      return json({ lines, wsNames: { 'WS-11': 'the board' }, months: [], nextBefore: null })
    }
    if (verb === 'show') {
      const id = args[1]
      if (/^WS-/.test(id)) return json({ id, name: 'the board' })
      const task = w.tasks.find((x: any) => x.id === id)
      if (task) return json(task)
      return json(w.questions.find((q: any) => q.id === id) || w.answered.find((q: any) => q.id === id) || {})
    }
    if (verb === 'register') {
      const p = JSON.parse(stdin || '{}')
      /* each registration takes the next label, Q512 first */
      const id = 'Q' + (512 + w.cliRuns().filter((r: any) => r.args[0] === 'register').length - 1)
      return json({ id, name: p.name, workstream: p.workstream || 'WS-11', thread: p.thread, boardUrl: 'http://board/q/' + id })
    }
    if (verb === 'question edit') {
      /* a rewording keeps the id, numbers the ask's tokens and moves the version once per edit */
      const p = JSON.parse(stdin || '{}')
      const id = args[2]
      const version = 1 + w.cliRuns().filter((r: any) => r.args[0] === 'question' && r.args[2] === id).length
      const ask = String(p.ask || '').replace(/\((?=[a-z][,)])/g, '(' + id.replace(/^Q/, ''))
      return json({ id, name: p.name, ask, changed: [], reworded: ['ask', 'options'], version })
    }
    if (verb === 'answer') {
      /* a key answers its record, and the result names the label */
      const hit = (q: any) => q.id === args[1] || (q.key && q.key === args[1])
      const label = (w.questions.find(hit) || { id: args[1] }).id
      /* the pick the store already holds stands and names it, told to nobody again */
      if (w.already) {
        w.questions = w.questions.filter((q: any) => !hit(q))
        return json({ id: label, name: 'store shape', status: 'answered', pick: label.replace(/^Q/, '') + flag('pick'), already: true })
      }
      /* show reads the status and the Answer section as the store writes them */
      const said = flag('pick') ? label.replace(/^Q/, '') + flag('pick') + '.' : String(flag('note') || '')
      w.answered.push(...w.questions.filter(hit).map((q: any) => ({ ...q, status: 'answered', answer: said })))
      /* the user's press is told to the question's owner (`owner`, else the session pressed in), as the store does */
      const user = flag('user')
      const owned = (w.questions.find(hit) || {}).owner
      const to = owned || user
      const typed = (e: any) => ({ ...e, raw: { ...e.raw, pick: null, note: flag('note') } })
      if (to) (w.inbox[to] || (w.inbox[to] = [])).push(flag('pick') ? w.event(label, String(flag('pick')), 'user:' + user) : typed(w.event(label, '', 'user:' + user)))
      w.questions = w.questions.filter((q: any) => !hit(q))
      w.marker += '+'
      return json({ id: label, name: 'store shape', status: 'answered', ...(owned ? { owner: { session: owned, track: 'TR-1', pc: 'PC-2' } } : {}) })
    }
    if (verb === 'drop' || verb === 'snooze') {
      /* the card leaves the open set */
      const hit = (q: any) => q.id === args[1] || (q.key && q.key === args[1])
      const label = (w.questions.find(hit) || { id: args[1] }).id
      const status = verb === 'drop' ? 'dropped' : 'snoozed'
      w.answered.push(...w.questions.filter(hit).map((q: any) => ({ ...q, status,
        ...(verb === 'drop' ? { answer: 'Dropped.' + (flag('note') ? ' ' + flag('note') : '') } : { snooze: { until: flag('until'), trigger: flag('trigger') } }) })))
      w.questions = w.questions.filter((q: any) => !hit(q))
      w.marker += '+'
      return json({ id: label, status })
    }
    if (verb === 'note') {
      /* a task's note lands in its journal, which show reads back */
      const task = w.tasks.find((x: any) => x.id === args[1])
      if (task) task.journal = [task.journal, flag('body') || stdin].filter(Boolean).join('\n\n')
      return json({ id: args[1] })
    }
    /* the board's track verbs, from w.tracks; a lease is a track's `session` */
    const track = (id: any) => w.tracks.find((t: any) => t.id === id)
    const take = (t: any, sess: any) => { for (const x of w.tracks) if (x.session === sess) delete x.session; t.session = sess; t.state = 'active' }
    const fresh = (name: any, ws: any, sess: any) => {
      const t = { id: 'TR-9', key: 'trk9abcd', name, state: 'active', workstream: ws, text: '0 running, 0 ready, 0 to go', tasks: [], now: [], handoffs: [] }
      w.tracks.push(t)
      take(t, sess)
      return t
    }
    const missing = (id: any) => ({ exitCode: 1, stdout: '', stderr: 'AskerDo: no track ' + id + '\n' })
    if (verb === 'track mine') {
      const t = w.tracks.find((x: any) => x.session === flag('session'))
      if (!t) return json({ held: false, track: null, workstream: null, tracks: [] })
      const row = (x: any) => ({ id: x.id, key: x.key, name: x.name, state: x.state, parkReason: x.parkReason, text: x.text, now: x.now, chain: x.id,
        holder: x.session ? { session: x.session } : null, handoff: x.handoffs.at(-1) || null })
      return json({ held: true, track: t.id, key: t.key, name: t.name, workstream: t.workstream, state: t.state, text: t.text, chain: t.id, now: t.now,
        readySet: [], tracks: w.tracks.filter((x: any) => x.workstream === t.workstream && !['done', 'dropped'].includes(x.state)).map(row) })
    }
    if (verb === 'resume') {
      const t = track(args[1])
      if (!t) return missing(args[1])
      const sess = flag('session')
      if (args.includes('--read-only')) return json({ acquired: false, readOnly: true, track: t.id, kickoff: 'Kickoff for ' + t.id })
      if (flag('splinter') !== undefined) {
        const s = fresh(flag('splinter'), t.workstream, sess)
        t.state = 'parked'
        return json({ acquired: true, splintered: true, track: s.id, key: s.key, parent: t.id, chain: t.id + ' > ' + s.id, parked: true, kickoff: 'Kickoff for ' + s.id })
      }
      if (t.session && t.session !== sess && !args.includes('--take-over')) {
        return json({ acquired: false, track: t.id, key: t.key, holder: { session: t.session, pc: 'PC-2', since: '2026-10-25T09:00:00+00:00' },
          moves: ['splinter', 'take over', 'read only'], chain: t.id })
      }
      take(t, sess)
      const h = t.handoffs.at(-1) || null
      return json({ acquired: true, track: t.id, key: t.key, session: sess, handoff: h, kickoff: 'Kickoff for ' + (h ? h.id : t.id), ...(w.resumeExtra || {}) })
    }
    if (verb === 'handoff write') {
      const p = JSON.parse(stdin || '{}')
      const t = track(args[2])
      if (!t) return missing(args[2])
      const id = args[2] + '.5'
      const mine = t.session === flag('session')
      if (mine) delete t.session
      t.state = p.status === 'parked' ? 'parked' : mine ? 'waiting' : t.state
      t.handoffs.push({ id, status: p.status || 'waiting', focus: p.focus })
      return json({ id, track: t.id, status: p.status || 'waiting', superseded: [args[2] + '.4'], released: mine, trackState: t.state, resume: '/askerdo resume ' + t.id })
    }
    /* the track's last handoff patched in place, its id kept */
    if (verb === 'handoff update') {
      const t = track(String(args[2]).replace(/\.\d+$/, ''))
      if (!t) return missing(args[2])
      const h = t.handoffs.at(-1)
      const ops = JSON.parse(stdin || '{}').ops || []
      return json({ id: h.id, track: t.id, status: h.status, changed: Object.fromEntries(ops.map((o: any) => [o.op, 'patched'])), verify: [] })
    }
    if (verb === 'track new') {
      const t = fresh(flag('name'), flag('workstream'), flag('session'))
      return json({ id: t.id, key: t.key, state: 'active' })
    }
    if (verb === 'track show') {
      const t = track(args[2])
      return t ? json({ track: t.id, holder: t.session ? { session: t.session, pc: 'PC-2' } : null, kickoff: 'Kickoff for ' + t.id, handoffs: [] }) : missing(args[2])
    }
    if (verb === 'track park' || verb === 'track finish' || verb === 'track drop') {
      const t = track(args[2])
      if (!t) return missing(args[2])
      delete t.session
      t.state = verb === 'track park' ? 'parked' : verb === 'track drop' ? 'dropped' : 'done'
      if (verb === 'track park') t.parkReason = flag('reason')
      return json({ id: t.id, key: t.key, state: t.state, leftovers: [], junction: w.junction || null })
    }
    if (verb === 'track splinter') {
      const t = track(args[2])
      const s = fresh(flag('name'), t.workstream, flag('session'))
      t.state = 'parked'
      return json({ id: s.id, key: s.key, parent: t.id, chain: t.id + ' > ' + s.id, parked: true, session: flag('session') })
    }
    if (verb === 'track capture') return json({ id: 'T-90', created: true, track: flag('track') || null })
    if (verb === 'task update') {
      /* a start lands in the now set of the track that holds the task, with its agent */
      const id = args[2]
      const out: any = {}
      if (flag('agent') !== undefined || flag('status') === 'in_progress') {
        const t = w.tracks.find((x: any) => x.tasks.includes(id))
        if (t) t.now = [...t.now.filter((n: any) => n.id !== id), { id, ...(flag('agent') ? { agent: flag('agent') } : {}) }]
        out.start = { id, ...(flag('agent') ? { agent: flag('agent') } : {}) }
      }
      if (['priority', 'name', 'add-label', 'remove-label'].some((f) => flag(f) !== undefined) || args.includes('--in-hand') || args.includes('--let-go')
        || (flag('status') !== undefined && flag('status') !== 'in_progress')) out.edit = { id, changed: ['edited'] }
      /* a hand move says which way (the board's `hand`), and show reads the holder back */
      const hand = args.includes('--in-hand') ? 'taken' : args.includes('--let-go') ? 'let go' : ''
      if (hand) {
        out.edit = { id, changed: ['inHand'], hand }
        const task = w.tasks.find((x: any) => x.id === id)
        if (task) task.inHand = hand === 'taken' ? flag('session') : undefined
      }
      if (flag('note') !== undefined) out.note = { id }
      return json(out)
    }
    if (verb === 'shelf') return json({ rows: w.shelf, unreadable: [] })
    /* the user's Allow or Keep typed, on a request another session asked */
    /* a session's request (its payload on stdin), measured and paged as the board does */
    if (verb === 'override' && args[1] === 'request') {
      const p = JSON.parse(stdin || '{}')
      const records = (p.items || []).map((i: any) => i.record)
      /* a fix of one text field carries its words now and as proposed */
      const one = p.kind === 'fix' && records.length === 1 ? Object.keys(p.items[0]).filter((k) => k !== 'record') : []
      const change = one.length === 1 ? { change: { field: 'Body', before: 'The port is 1748.', after: p.items[0][one[0]] } } : {}
      return json({ request: 3, kind: p.kind, records, reversal: false, summary: p.summary, measured: 'the body, 18 characters proposed', page: '/override/3', ...change })
    }
    if (verb === 'override') return json({ request: 3, kind: 'fix', decision: args[3], records: [args[2]], asker: 'other' })
    /* the mod's reads of rulings (the toast, a brief) */
    if (verb === 'read') return json({ session: flag('session'), site: flag('site'), marked: args.slice(1).filter((a) => /^[A-Z]+-\d+$/.test(a)), skipped: [] })
    return { exitCode: 1, stdout: '', stderr: 'AskerDo: unknown verb in the fake\n' }
  }
  w.cliRuns = () => w.runs.filter((r: Run) => r.script.endsWith('askerdo.mjs'))
  w.markers = () => w.runs.filter((r: Run) => r.script.endsWith('depth-marker.mjs')).map((r: Run) => r.args[r.args.indexOf('--session') + 1])
  w.last = (verb: string) => w.cliRuns().filter((r: Run) => r.args.join(' ').startsWith(verb)).at(-1)

  on('session.id', () => ({ value: w.sid }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('session.usage', () => (w.usageCalls++, { value: { context: { tokens: 120000, window: 200000, percent: 60.2 }, ...w.usage } }))
  on('command.register', ($: any, e: any) => {
    if (w.refuse.includes(e.name)) return { deny: 'a skill holds /' + e.name }
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('tool.register', ($: any, e: any) => { w.tools.push(e); return { value: { tool: 'mcp__askerdo__' + e.name } } })
  on('command.list', () => ({ value: w.listed }))
  /* project files the mod reads ($.fs.read): a settings file absent unless a test adds it */
  w.files = {} as Record<string, string>
  w.fsRead = null as null | ((path: string) => string)
  on('fs.read', ($: any, e: any, next: any) => {
    /* the engine hands the hook the path with backslashes */
    const file = w.files[String(e.path).replace(/\\/g, '/')]
    if (file !== undefined) return { value: file }
    if (/[\\/]\.claude[\\/]settings/.test(e.path)) return { deny: 'ENOENT: ' + e.path }
    /* the plugin's own manifest: the version the route's calls carry */
    if (/[\\/]\.claude-plugin[\\/]plugin\.json$/.test(e.path)) return { value: JSON.stringify({ name: 'askerdo', version: '0.7.0', repository: 'https://github.com/ToxMox/askerdo' }) }
    return w.fsRead ? { value: w.fsRead(e.path) } : next(e)
  })
  on('env.set', ($: any, e: any) => { w.env[e.name] = e.value; w.events.push('env.set ' + e.name + '=' + e.value); return { value: undefined } })
  on('env.get', ($: any, e: any) => ({ value: w.env[e.name] }))
  /* answer spawns in flight, and the most at once; slowAnswers makes each take a while */
  w.active = 0
  w.maxActive = 0
  w.slowAnswers = false
  w.answerWait = 0
  /* what each script prints, as spawned or as the local route runs it in process */
  w.script = (script: string, args: string[], stdin?: string, env?: Record<string, string>): any => {
    if (String(script).endsWith('depth-marker.mjs')) {
      const i = args.indexOf('--project')
      if (i >= 0) {
        w.guard = args[i + 1] === 'on' ? { on: true, source: 'project', guard: { soft: 350000, hard: 450000, remind: 25000 } }
          : { on: false, source: null, guard: null }
      }
      return { exitCode: 0, stdout: JSON.stringify(w.guard) + '\n', stderr: '' }
    }
    if (String(script).endsWith('mod-inbox.mjs')) return { exitCode: 0, stdout: JSON.stringify(w.inboxRun(args, stdin)) + '\n', stderr: '' }
    if (String(script).endsWith('/rules.mjs')) {
      return w.rules ? { exitCode: 0, stdout: JSON.stringify(w.rules) + '\n', stderr: '' } : { exitCode: 1, stdout: '', stderr: 'rules: none' }
    }
    if (String(script).endsWith('mod-alias.mjs')) return { exitCode: 0, stdout: JSON.stringify(w.alias) + '\n', stderr: '' }
    if (String(script).endsWith('mod-queue.mjs')) {
      const at = (k: string) => { const i = args.indexOf(k); return i < 0 ? '' : args[i + 1] }
      const sid = at('--session')
      const old = at('--lineage').split(',').filter(Boolean)
      if (args[0] === 'read') return { exitCode: 0, stdout: JSON.stringify({ answers: [sid, ...old].flatMap((s) => w.queuedFile[s] || []) }) + '\n', stderr: '' }
      for (const s of old) delete w.queuedFile[s]
      const list = JSON.parse(String(stdin))
      if (list.length) w.queuedFile[sid] = list
      else delete w.queuedFile[sid]
      return { exitCode: 0, stdout: JSON.stringify({ saved: list.length }) + '\n', stderr: '' }
    }
    if (String(script).endsWith('mod-contract.mjs')) return { exitCode: 0, stdout: JSON.stringify(w.contract) + '\n', stderr: '' }
    return w.cli(args, stdin, env)
  }
  /* every run, routed or spawned: answers can be slowed or a verb held */
  w.exec = async (via: 'route' | 'process', script: string, args: string[], stdin?: string, env?: Record<string, string>) => {
    if (w.slowAnswers && String(script).endsWith('askerdo.mjs') && args[0] === 'answer') {
      w.maxActive = Math.max(w.maxActive, ++w.active)
      for (let i = 0; i < 50; i++) await Promise.resolve()
      w.active--
    }
    if (w.hold && args.slice(0, 2).join(' ') === w.hold.verb) await w.hold.until
    /* an answer that takes a while on the mocked clock, so a press settles while it saves */
    if (w.answerWait && args[0] === 'answer') await w.clock.sleep(w.answerWait)
    w.runs.push({ script, args, stdin, env, via })
    return w.script(script, args, stdin, env)
  }
  w.spawns = () => w.runs.filter((r: Run) => r.via === 'process')
  /* the git reads of the folder and branch, kept out of w.runs; outside git by default */
  w.git = (argv: string[], cwd?: string): any => ({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' })
  w.gitRuns = [] as string[][]
  on('process.run', async ($: any, e: any) => {
    if (e.argv[0] === 'git') { w.gitRuns.push(e.argv); return { value: w.git(e.argv, e.init && e.init.cwd) } }
    const [, script, ...args] = e.argv
    return { value: await w.exec('process', script, args, e.init && e.init.stdin, e.init && e.init.env) }
  })
  /* the local server (board/local.json under a store root): its CLI route answers from
     the fake CLI and sends back (409) what must run in the caller, as the server does;
     `routeStatus` forces a status by verb, `serverDown` refuses every connect, `routed`
     holds each call the route took */
  w.routed = [] as any[]
  w.routeStatus = {} as Record<string, number>
  w.serverDown = false
  /* the local server's answers, under any a test puts in fetchBy */
  w.serverBy = {} as Record<string, any>
  w.pid = 0
  /* a server start writes a new pid, so local.json's text changes */
  w.serverAt = (root: string) => {
    w.serverDown = false
    w.files[root + '/board/local.json'] = JSON.stringify({ board: null, url: LOCAL_ROOT + 'local', pid: ++w.pid })
  }
  w.localServer = (home = HOME) => {
    w.env.USERPROFILE = home
    w.serverAt(home + '/.claude/askerdo')
  }
  const answer = (status: number, body: any) => ({ status, ok: status === 200, headers: {}, text: JSON.stringify(body) })
  const refused = () => { throw new Error('askerdo: $.http.fetch(' + LOCAL_ROOT + 'local) failed: ConnectionRefused: Unable to connect. Is the computer able to access the url?') }
  /* the band the local board answers, built from the world's questions, tracks and shelf by
     the board's scope rule; a test sets its own `w.near`, or none for no board (404) */
  w.bandOf = (session: string, project: string, lineage = '') => {
    const dir = (d: any) => String(d || '').replace(/\\/g, '/').toLowerCase()
    const open = w.questions.filter((q: any) => (!q.status || q.status === 'open') && (!q.projectDir || !project || dir(q.projectDir) === dir(project)))
    /* the board's ownerOf: a question on a track is its holder's, else its asker's */
    const holder = (q: any) => { const t = q.track && w.tracks.find((x: any) => x.id === q.track); return (t && t.session) || q.session }
    const own = (q: any) => holder(q) === session || (q.subscribers || []).includes(session)
    const held = w.tracks.find((t: any) => t.session === session)
    const near = new Set([...open.filter(own).map((q: any) => q.workstream), held && held.workstream].filter(Boolean))
    const engaged = open.some(own) || !!held
    const inScope = (q: any) => engaged && q.blocking === true && (!near.size || !q.workstream || near.has(q.workstream))
    const num = (q: any) => Number(String(q.id).replace(/\D/g, '')) || 0
    const qs = open.filter((q: any) => own(q) || inScope(q))
      .sort((a: any, b: any) => (a.blocking ? 0 : 1) - (b.blocking ? 0 : 1) || num(a) - num(b))
      .map((q: any) => ({ ...q, asker: q.session, session: own(q) ? session : null }))
    /* every open question on the board this session does not own, blockers first */
    const away = w.questions.filter((q: any) => (!q.status || q.status === 'open') && !own(q))
      .sort((a: any, b: any) => (a.blocking ? 0 : 1) - (b.blocking ? 0 : 1) || num(a) - num(b))
      .map((q: any) => ({ id: q.id, name: q.name, blocking: q.blocking === true, track: q.track || '', trackName: q.trackName || '', pc: q.pc || '', created: q.created || '',
        ask: q.ask || '', options: (q.options || []).map((o: any) => ({ type: o.type, option: o.option })), ...(q.pick ? { pick: q.pick } : {}), ...(q.key ? { key: q.key } : {}) }))
    /* the held track, its workstream's open tracks as the graph's views with each line's last
       handoff, and the inbox peek of the boxes asked for, as `track mine` and the peek answered */
    const lines = held ? w.tracks.filter((x: any) => x.workstream === held.workstream && !['done', 'dropped'].includes(x.state)) : []
    const view = (x: any) => ({ id: x.id, key: x.key, name: x.name, state: x.state, parkReason: x.parkReason, text: x.text, now: x.now, chain: x.id,
      holder: x.session ? { session: x.session } : null, readySet: [], done: 0, junction: null, edges: [], critical: { length: 0, path: [] },
      tasks: (x.tasks || []).map((id: string) => ({ id, key: 'k' + id, name: id, status: (x.now || []).some((n: any) => n.id === id) ? 'in_progress' : 'open' })) })
    const boxes = [session, ...String(lineage || '').split(',').filter((b) => b && b !== session)]
    return {
      model: bandModel({ questions: qs, shelfRows: w.shelf, sid: session, calls: w.calls }), questions: qs, shelf: w.shelf,
      elsewhere: { questions: away, blocking: away.filter((q: any) => q.blocking).length, waiting: away.filter((q: any) => !q.blocking).length },
      profilesAt: w.profilesAt || 0, handoffAsks: w.handoffAsks || [],
      track: held ? { ...view(held), workstream: held.workstream, url: 'http://askerdo.localhost:53265/r/' + held.key } : null, hand: w.hand || [],
      graph: held ? { workstream: held.workstream, view: { workstream: held.workstream, inbox: 0, tracks: lines.map(view) }, layout: null } : null,
      handoffs: Object.fromEntries(lines.filter((x: any) => x.handoffs.length).map((x: any) => [x.id, x.handoffs.at(-1)])),
      inbox: { boxes, events: w.inboxRun(['peek', '--session', session, ...(boxes.length > 1 ? ['--lineage', boxes.slice(1).join(',')] : [])]).events },
      links: { overview: 'https://board.test/', needsYou: w.boardUrl, local: w.boardUrl },
      /* the shared and short names the board files the project under */
      scope: { repo: 'github.com/owner/proj', name: 'proj' },
    }
  }
  w.near = (session: string, project: string, lineage = '') => w.bandOf(session, project, lineage)
  /* the band's state and its long poll: a held wait answers when `w.change()` lands one,
     or unchanged once the clock passes its ms */
  w.boardSeq = 1
  w.waiting = [] as Array<() => void>
  w.change = () => { w.boardSeq++; for (const f of w.waiting.splice(0)) f() }
  const seqOf = (changed: boolean) => answer(200, { ok: true, result: { seq: w.boardSeq, loaded: true, online: true, changed, profilesAt: w.profilesAt || 0 } })
  w.serverBy['/local/band?'] = (e: any) => {
    if (w.serverDown) refused()
    const q = new URLSearchParams(String(e.url).split('?')[1] || '')
    return w.near ? answer(200, { ok: true, result: { seq: w.boardSeq, loaded: true, online: true, ...w.near(q.get('session') || '', q.get('project') || '', q.get('lineage') || '') } })
      : answer(404, { ok: false, error: 'no board' })
  }
  w.serverBy['/local/state'] = () => { if (w.serverDown) refused(); return w.near ? seqOf(false) : answer(404, { ok: false, error: 'no board' }) }
  w.serverBy['/local/wait?'] = (e: any) => {
    if (w.serverDown) refused()
    if (!w.near) return answer(404, { ok: false, error: 'no board' })
    const q = String(e.url).split('?')[1] || ''
    const arg = (n: string) => Number((q.split('&').find((x) => x.startsWith(n + '=')) || '').split('=')[1])
    if (w.boardSeq > arg('after')) return seqOf(true)
    return new Promise((done) => {
      w.waiting.push(() => done(seqOf(true)))
      w.clock.sleep(arg('ms')).then(() => done(seqOf(false)))
    })
  }
  /* what must run in the caller (lib/cli-commands.mjs runsInCaller): it starts a process or reads git */
  const inCaller = (argv: string[]) => ['board', 'login'].includes(argv[0]) || (argv[0] === 'proc' && ['scan', 'ran'].includes(argv[1]))
  w.serverBy['/local/cli'] = async (e: any) => {
    if (w.serverDown) refused()
    const call = JSON.parse(e.init.body)
    w.routed.push(call)
    const status = w.routeStatus[call.argv[0]] || (inCaller(call.argv) ? 409 : 200)
    if (status !== 200) return answer(status, { ok: false, error: status === 409 ? 'runs in the caller' : 'the board broke' })
    const r = await w.exec('route', '/plugin/bin/askerdo.mjs', call.argv, call.stdin, call.env)
    return answer(200, { code: r.exitCode, stdout: r.stdout, stderr: r.stderr })
  }
  /* a board verb passed through: the pressed row leaves, its asker's inbox hears it */
  w.serverBy['/local/verbs/'] = (e: any) => {
    if (w.serverDown) refused()
    const name = decodeURIComponent(String(e.url).split('/local/verbs/')[1])
    const body = JSON.parse(e.init.body)
    w.verbs.push({ name, body })
    if (w.fail[name]) return answer(400, { ok: false, error: w.fail[name] })
    const same = (p: any) => p.verb === name && JSON.stringify(p.input) === JSON.stringify(body.input)
    const row = w.calls.find((c: any) => c.presses.some(same))
    w.calls = w.calls.filter((c: any) => c !== row)
    if (row && row.told) (w.inbox[row.told.session] || (w.inbox[row.told.session] = [])).push(row.told.event)
    w.marker += '+'
    return answer(200, { ok: true, result: (row && row.result) || {} })
  }
  /* the mod's scripts, run in process there */
  w.serverBy['/local/mod'] = async (e: any) => {
    if (w.serverDown) refused()
    const call = JSON.parse(e.init.body)
    w.routed.push(call)
    const [name, ...args] = call.argv
    const status = w.routeStatus[name] || 200
    if (status !== 200) return answer(status, { ok: false, error: 'refused' })
    const r = await w.exec('route', '/plugin/scripts/' + name + '.mjs', args, call.stdin, call.env)
    return answer(200, { code: r.exitCode, stdout: r.stdout, stderr: r.stderr })
  }
  on('prompt.submit', ($: any, e: any) => {
    /* a submit the engine refuses: the next n throw */
    if (w.submitThrows > 0) { w.submitThrows--; throw new Error('the engine refused the prompt') }
    w.prompts.push(e.text); w.origins.push(e.origin); w.contexts.push(e.context || []); return { text: e.text }
  })
  /* the engine's own typeahead rows are not on the event: from core, none */
  on('prompt.autocomplete', () => ({ suggestions: [] }))
  on('ui.toast', ($: any, e: any) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.log', ($: any, e: any) => { (e.to === 'debug' ? w.debugLogs : w.logs).push(e.text); return { value: undefined } })
  /* the engine's own band: nothing drawn */
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: { key: 'engine-band' }, children: [] }))
  /* the alert's posts in fetches, the local route's reads and calls apart; fetchBy answers
     the first key the URL contains (a function of the request, or the answer), else fetchAnswer */
  w.posts = [] as any[]
  on('http.fetch', async ($: any, e: any) => {
    const get = ((e.init && e.init.method) || 'GET') === 'GET'
    const call = /\/local\/(cli|mod)$/.test(String(e.url))
    ;(get ? w.reads : call ? w.posts : w.fetches).push({ url: e.url, init: e.init, body: JSON.parse((e.init && e.init.body) || '{}') })
    const hit = (by: Record<string, any>) => { const k = Object.keys(by).find((x) => String(e.url).includes(x)); return k ? by[k] : undefined }
    const v = hit(w.fetchBy) ?? hit(w.serverBy) ?? w.fetchAnswer
    /* a throw is the host's refusal (a hook that throws is skipped, reaching the network) */
    try { return { value: typeof v === 'function' ? await v(e) : v } } catch (err: any) { return { deny: String((err && err.message) || err) } }
  })
  on('session.append', ($: any, e: any, next: any) => { w.appends.push(e.agentId ? { ...e.message, agentId: e.agentId } : e.message); return next(e) })
  on('session.send', ($: any, e: any) => {
    const to = typeof e.to === 'object' ? e.to.sessionId : e.to
    w.sent.push({ to, text: e.text })
    return w.live.includes(to) ? { isDelivered: true } : { isDelivered: false, reason: 'not running' }
  })
  on('session.messages', ($: any, e: any) => ({ value: w.agentMessages[e.agentId] || [] }))
  on('ui.open', ($: any, e: any) => { w.panes.push(e); return { value: { isPlaced: true } } })
  /* each pane's title is its latest open's, as the engine's record keeps it */
  on('ui.panes', () => ({ value: w.open.map((id: string) => ({ id, title: [...w.panes].reverse().find((p: any) => p.id === id)?.title ?? id })) }))
  on('ui.close', ($: any, e: any) => { w.closed.push(e.id); w.open = w.open.filter((id: string) => id !== e.id); return { value: { closed: true } } })
  /* the engine's own dialog: it records the props it was handed */
  on('ui.render', { component: 'AskUserQuestion' }, ($: any, e: any) => {
    w.dialogs.push(e.props)
    return { type: 'engine', ref: w.dialogs.length }
  })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  /* the engine beneath the turn: a step answers the usage the test set for its loop */
  w.stepUsage = {} as Record<string, any>
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('turn.step', async function* ($: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: w.stepUsage[e.agentId || 'main'] || null }
  })
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => { w.events.push('settings SessionStart hooks, ASKERDO_MOD=' + w.env.ASKERDO_MOD); return {} })
  /* the engine's built-in, which the mod leaves alone */
  on('command.run', { command: 'resume' }, ($: any, e: any) => ({ text: 'the built-in resume: ' + (e.args || 'picker') }))
  w.env.USERPROFILE = HOME
  if (opts.server !== false) w.localServer()
  return w
}

export async function start($: any, w: any, surface: string | null = null) {
  await $.session.start({ cwd: w.cwd, surface, isInteractive: surface !== null })
  await w.clock.settle()
}

/* a desktop press redraws its button under another key, so a second press finds it by its first */
export async function pressAgain(ui: any, key: string) {
  const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.key))
  await ui.press({ key: keys.find((k: string) => k === key) || keys.find((k: string) => k.startsWith(key)) || key })
}
