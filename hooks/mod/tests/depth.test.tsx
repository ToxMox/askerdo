/* The main depth meter, the agent guard and the marker
 *  under `claude plugin test`, fed synthetic `session.measure` and
 * step usage figures, the status line drawn on the terminal and the desktop. */
import { describe, expect, test } from 'claude-code/testing'
import { COLD_START, HEAVY, start } from './world.ts'
import { STOP_FIRST } from '../../../lib/mod-core.mjs'
import { PLUGIN, SURFACES, world, mount, WINDOW, measure, meter, guardTip, notes, agentNotes, usage, step, guardOn } from './depth-kit.ts'

describe('the main depth meter', () => {
  for (const surface of SURFACES) {
    test('nothing below 30 percent, the window note at 30, the insistence at 40, each once (' + surface + ')', COLD_START, async ($: any, on: any) => {
      const w = world(on)
      await start($, w)
      const ui = await mount($, surface)
      /* the desktop's number turns amber from the handoff mark */
      const tones = surface === 'desktop' ? ['inactive', 'warning', 'error'] : ['dim', 'bright', 'warning']
      await measure($, w, 12)
      await measure($, w, 29.9)
      expect(await meter(ui)).toEqual(['29%', tones[0]])
      expect(notes(w)).toEqual([])
      await measure($, w, 30.4)
      expect(await meter(ui)).toEqual(['30%', tones[1]])
      expect(notes(w).length).toBe(1)
      /* the note waits for the loop's next call, never a row appended mid-turn */
      expect([w.told.at(-1).via, w.appends.length]).toEqual(['call', 0])
      expect(notes(w)[0]).toStartWith('CONTEXT DEPTH (main session): 304k tokens (304000), 30 percent of the 1000k window')
      expect(notes(w)[0]).toContain('The user\'s 30 percent mark: pick the handoff boundary')
      /* the window note asks for the where-we-were in the model's own words */
      expect(notes(w)[0]).toContain('whereWeWere in your own words')
      await measure($, w, 35)
      expect(notes(w).length).toBe(1)
      await measure($, w, 41)
      expect(await meter(ui)).toEqual(['41%', tones[2]])
      expect(notes(w).length).toBe(2)
      expect(notes(w)[1]).toContain('The user\'s 40 percent wrap line: start nothing new')
      await measure($, w, 44)
      expect(notes(w).length).toBe(2)
      /* running work continues; only what the session started is stopped, at the handoff */
      for (const n of notes(w)) expect(n.replace(STOP_FIRST, '')).not.toMatch(/\b(stop|cancel|abandon)\b/i)
      await ui.unmount()
    })
  }

  test('a jump past both marks gives one note naming the higher; no reading yet shows nothing', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const reads = w.usageCalls
    await measure($, w, undefined)
    expect(notes(w)).toEqual([])
    await measure($, w, 45)
    expect(notes(w).length).toBe(1)
    expect(notes(w)[0]).toContain('40 percent wrap line')
    /* the 30 mark's rule and doc pointer ride along */
    expect(notes(w)[0]).toContain('handoff-timing.md')
    expect(w.usageCalls).toBe(reads)
  })

  test('between measures a main step\'s own usage moves the meter over the measured window', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const ui = await mount($, 'terminal')
    await measure($, w, 10)
    await step($, w, undefined, 320000)
    await w.clock.advance(1000)
    await w.clock.settle()
    expect(await meter(ui)).toEqual(['32%', 'bright'])
    expect(notes(w).length).toBe(1)
    await ui.unmount()
  })

  /* the meter's window and the user's ask are a handoff's only triggers */
  test('handoff_write is refused below the window; the mark told, or /askerdo handoff, opens it', async ($: any, on: any) => {
    const w = world(on)
    w.usage.context = { tokens: 120000, window: WINDOW, percent: 12 }
    await start($, w)
    const write = () => $.tool.call({ tool: 'mcp__askerdo__handoff_write', goal: 'g', focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    const writes = () => w.cliRuns().filter((r: any) => r.args[0] === 'handoff' && r.args[1] === 'write').length
    const refused = await write()
    /* the refusal names the note and the ask, never a depth */
    expect(String(refused.deny)).toContain('/askerdo handoff')
    expect(String(refused.deny)).not.toContain('percent')
    expect(writes()).toBe(0)
    /* the mark told this session keeps it open, as after a compaction */
    await measure($, w, 31)
    await write()
    expect(writes()).toBe(1)
    /* the handoff let the track go; taken back, /clear carries it to the new id */
    await $.command.run({ command: 'askerdo', args: 'resume TR-3' })
    /* a fresh session after /clear starts closed, and the user's ask opens it */
    await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    w.sid = 'sess-2'
    await $.prompt.submit({ text: 'carry on' })
    await w.clock.settle()
    expect(String((await write()).deny)).toContain('handoff_write refused')
    await $.command.run({ command: 'askerdo', args: 'handoff' })
    await write()
    expect(writes()).toBe(2)
  })
})

describe('the agent guard', () => {
  test('the shield chip says the guard\'s state, off by default; a press toggles it through /askerdo guard\'s path', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const ui = await mount($, 'desktop')
    expect(await guardTip(ui)).toMatch(/Off.*Press to turn it on/)
    await ui.press({ key: 'status-guard-toggle' })
    await w.clock.settle()
    expect(w.toasts.at(-1)).toContain('The agent guard is on for this project')
    expect(await guardTip(ui)).toMatch(/On \(this project\).*350k.*450k.*Press to turn it off/)
    const run = w.runs.filter((r: any) => r.script.endsWith('depth-marker.mjs')).at(-1)
    expect(run.args).toEqual(['--cwd', 'C:/src/proj', '--session', 'sess-1', '--track', 'trk3abcd', '--project', 'on', '--json'])
    expect((await $.command.run({ command: 'askerdo', args: 'guard off' })).text).toContain('The agent guard is off for this project. Turn it on with /askerdo guard on.')
    expect(await guardTip(ui)).toMatch(/Off.*Press to turn it on/)
    expect((await $.command.run({ command: 'askerdo', args: 'guard maybe' })).text).toContain('Usage: /askerdo guard')
    await ui.unmount()
  })

  test('a board the marker could not read shows its problem in the guard slot and in /askerdo guard', async ($: any, on: any) => {
    const w = world(on)
    w.guard = { on: true, source: { level: 'marker', record: 'm' }, guard: { soft: 350000, hard: 450000, remind: 25000 },
      main: { on: true, window: 30, wrap: 40 }, problem: 'the board: offline' }
    await start($, w)
    const ui = await mount($, 'terminal')
    expect(await guardTip(ui)).toMatch(/the board: offline.*stays on/)
    expect((await $.command.run({ command: 'askerdo', args: 'guard' })).text).toMatch(/board could not be read.*guard is on.*the board: offline/)
    await ui.unmount()
  })

  test('off: a subagent past every limit hears nothing', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    await step($, w, 'ag-1', 470000)
    expect((await agentNotes($, w, 'ag-1'))).toEqual([])
  })

  test('on: a subagent crossing soft gets the CONTINUE note naming its state note, then reminders and the urgent one', async ($: any, on: any) => {
    const w = world(on)
    guardOn(w)
    await start($, w)
    w.agentMessages['ag-1'] = [{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 'u1', tool: 'Write', input: { file_path: 'C:/x/lane-9-state.md', content: 'x' } }] }]
    await step($, w, 'ag-1', 340000)
    expect((await agentNotes($, w, 'ag-1'))).toEqual([])
    await step($, w, 'ag-1', 352000)
    const soft = (await agentNotes($, w, 'ag-1'))
    expect(soft.length).toBe(1)
    expect(soft[0]).toContain('CONTEXT DEPTH 352k tokens, past the soft limit of 350k')
    expect(soft[0]).toContain('The state note you have been writing is C:/x/lane-9-state.md.')
    expect(soft[0]).toContain('CONTINUE: <your state note path>')
    expect(soft[0]).toContain('after which this reminder turns urgent')
    await step($, w, 'ag-1', 370000)
    expect((await agentNotes($, w, 'ag-1')).length).toBe(1)
    await step($, w, 'ag-1', 378000)
    expect((await agentNotes($, w, 'ag-1')).length).toBe(2)
    await step($, w, 'ag-1', 451000)
    const all = (await agentNotes($, w, 'ag-1'))
    expect(all.length).toBe(3)
    expect(all[2]).toMatch(/^URGENT: CONTEXT DEPTH 451k tokens, past the hard floor of 450k/)
    for (const n of all) expect(n).not.toMatch(/\b(stop|cancel|abandon|abort|kill|terminate|halt|interrupt)\b/i)
    /* the main loop hears none of it */
    expect(notes(w)).toEqual([])
  })

  test('on with hardDeny: past hard every call is refused but the state note and the hand-back', async ($: any, on: any) => {
    const w = world(on)
    guardOn(w, { hardDeny: true })
    on('tool.call', { tool: 'Write' }, () => ({ result: 'written' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran' }))
    on('tool.call', { tool: 'SubagentHandback' }, () => ({ result: { success: true } }))
    await start($, w)
    expect((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag-2' })).result).toBe('ran')
    await step($, w, 'ag-2', 352000)
    expect((await agentNotes($, w, 'ag-2'))[0]).toMatch(/after which only the state note and [^.]*hand-back/)
    await step($, w, 'ag-2', 460000)
    expect((await agentNotes($, w, 'ag-2')).length).toBe(1)
    const denied = await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag-2' })
    expect(String(denied.deny || denied.text)).toMatch(/SubagentHandback/)
    expect((await $.tool.call({ tool: 'Write', file_path: 'C:/x/lane-9-state.md', content: 'n', agentId: 'ag-2' })).result).toBe('written')
    /* a plain-text end reaches no one, so the report's hand-back passes too */
    expect((await $.tool.call({ tool: 'SubagentHandback', message: 'Did half.', agentId: 'ag-2' })).result).toEqual({ success: true })
    /* another agent, and the main loop, are not touched */
    expect((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag-3' })).result).toBe('ran')
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).result).toBe('ran')
  })

  /* the handoff freezes the band, so only the dispatch can see the CLI resume and the profile edit */
  test('a dispatch reads the held track and the guard again, so its agent is guarded and its rules are the track\'s', async ($: any, on: any) => {
    const w = world(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    on('agent.spawn', () => ({ model: 'opus', agentId: 'ag-9' }))
    await start($, w)
    await $.tool.call({ tool: 'mcp__askerdo__handoff_write', goal: 'g', focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    w.tracks[0].session = 'sess-1'
    guardOn(w)
    const brief = { description: 'reader', prompt: 'Read it.', tool_use_id: 'tu-1' }
    await $.tool.call({ tool: 'Agent', ...brief })
    await $.agent.spawn(brief)
    const last = (s: string) => w.runs.filter((r: any) => r.script.endsWith(s)).at(-1).args
    expect(last('depth-marker.mjs')).toContain('trk3abcd')
    expect(last('/rules.mjs')).toContain('TR-3')
    await step($, w, 'ag-9', 352000)
    expect((await agentNotes($, w, 'ag-9'))[0]).toContain('past the soft limit of 350k')
  })

  /* the desktop page drops a drawing past 2000 nodes or 262,144 characters without a word and keeps the old one,
     its Buttons dead; a Home built past both goes out under them, a line for each part that gave way, its presses alive */
  test('a Home past the desktop page\'s bounds is drawn under them, saying what gave way, and still takes presses', HEAVY, async ($: any, on: any) => {
    const t0 = Date.now() - 600000
    const list: any[] = []
    for (let i = 0; i < 260; i++) list.push({ id: 'ag-' + i, job: 'Lane ' + i + ' reads the store and writes its report', model: 'claude-opus-5-5', calls: 4, tokens: 1000, start: t0 })
    for (let i = 0; i < 120; i++) list.push({ id: 'dn-' + i, job: 'Finished lane ' + i, model: 'claude-opus-5-5', calls: 9, tokens: 5000, start: t0, done: true })
    const w = world(on, { store: { 'flights:sess-1': { at: Date.now() - 60000, list } } })
    on('agent.list', () => ({ value: list.filter((f) => !f.done).map((f) => ({ id: f.id, description: f.job, type: 'general-purpose', status: 'running' })) }))
    const at = new Date(Date.now() - 3600000)
    const ts = at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0') + 'T' + String(at.getHours()).padStart(2, '0') + ':00:00'
    w.feed = Array.from({ length: 300 }, (_, i) => ({ ts, kind: 'task', verb: 'update', id: 'T-' + (1000 + i), key: 'k' + i + 'x'.repeat(400), name: 'row ' + i, project: 'C:/src/proj', ws: 'WS-11',
      changes: { status: ['open', 'in_progress'] }, href: 'http://192.0.2.7:17480/r/k' + i + 'x'.repeat(400) }))
    await start($, w)
    await w.clock.settle()
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'askerdo', props: { title: 'AskerDo', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
    await w.clock.settle()
    await pane.press({ key: 'tab-home' })
    await w.clock.advance(1000)
    await w.clock.settle()
    if (await pane.find({ key: 'agents-done-fold' })) await pane.press({ key: 'agents-done-fold' })
    await w.clock.settle()
    /* counted apart from the mod's own count: every element and string, and every name and string the drawing carries, which is past the page's count */
    const nodes = (n: any): number => (typeof n === 'string' ? 1 : !n || typeof n !== 'object' ? 0 : Array.isArray(n) ? n.reduce((s: number, c: any) => s + nodes(c), 0) : 1 + nodes(n.children))
    const root = await pane.find({ key: 'askerdo-pane' })
    const read = String((await $.tool.call({ tool: 'mcp__askerdo__drawn', part: 'pane' })).result)
    console.log('size guard, kit: ' + read.split('\n').filter((l) => /drawing:|left out/.test(l)).join(' | '))
    const text = (n: any): number => (typeof n === 'string' ? n.length : !n || typeof n !== 'object' ? 0 : Array.isArray(n) ? n.reduce((s: number, c: any) => s + text(c), 0) : text(n.children))
    const all = (n: any): number => (typeof n === 'string' ? n.length : !n || typeof n !== 'object' ? 0 : Array.isArray(n) ? n.reduce((s: number, c: any) => s + all(c), 0) : Object.entries(n).reduce((s: number, [k, v]: any) => s + k.length + all(v), 0))
    expect([nodes(root) < 2000, all(root) < 262144 && text(root) < 100000, /left out so the drawing stays whole: .*Activity/.test(read), /before it gave way/.test(read)]).toEqual([true, true, true, true])
    /* each part that gave way says so on Home itself */
    const said = [await pane.find({ key: 'feed-more' }), await pane.find({ key: 'agents-done-cut' }), await pane.find({ key: 'agents-run-more' })].filter(Boolean)
    expect(said.length > 0 && said.every((n: any) => /\d+ /.test(String(n.text)))).toBe(true)
    /* its presses land: the fold shuts and the tabs switch */
    await pane.press({ key: 'agents-toggle' })
    await w.clock.settle()
    expect(await pane.find({ key: 'agent-ag-0' })).toBeUndefined()
    await pane.press({ key: 'tab-tracks' })
    await w.clock.settle()
    expect(await pane.find({ key: 'feed' })).toBeUndefined()
    await pane.unmount()
  })

  /* a full Activity list (50 linked rows) leaves a long track's picture, six agents and seven shells room under
     the 1800-node ceiling (the kit scene: 1941 to 1964 nodes at 30 a row, 1664 to 1680 at 25), so none of its rows give way */
  test('a full Activity list keeps its rows cheap enough that a busy Home draws every one', HEAVY, async ($: any, on: any) => {
    const w = world(on)
    const at = new Date(Date.now() - 3600000)
    const ts = at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0') + 'T' + String(at.getHours()).padStart(2, '0') + ':00:00'
    w.feed = Array.from({ length: 50 }, (_, i) => ({ ts, kind: 'task', verb: 'update', id: 'T-' + (1000 + i), key: 'k' + i, name: 'The lane ' + i + ' fix', project: 'C:/src/proj', ws: 'WS-11',
      changes: { status: ['open', 'in_progress'] }, href: 'http://192.0.2.7:17480/r/k' + i }))
    await start($, w)
    await w.clock.settle()
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'askerdo', props: { title: 'AskerDo', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
    await w.clock.settle()
    await pane.press({ key: 'tab-home' })
    await w.clock.settle()
    const nodes = (n: any): number => (typeof n === 'string' ? 1 : !n || typeof n !== 'object' ? 0 : Array.isArray(n) ? n.reduce((s: number, c: any) => s + nodes(c), 0) : 1 + nodes(n.children))
    const feed = await pane.find({ key: 'feed' })
    const rows = (feed.children || []).filter((c: any) => String(c.key || (c.props && c.props.key) || '').startsWith('feed-'))
    /* by this count the rows drew 854 nodes before the cut and 704 after, so the bound sits between */
    expect([rows.length, nodes(feed) < 780]).toEqual([50, true])
    await pane.unmount()
  })

  /* the Tracks and Questions tabs give way in their own order, each part's line on the tab, before the last drawing */
  test('a Tracks tab and a Questions tab past the page\'s bounds are drawn under them, saying what gave way, and still take presses', HEAVY, async ($: any, on: any) => {
    /* two replies' question cards past the bounds: six heavy under msg-a, six lighter under msg-b */
    const told: Record<string, any> = {}
    const toldAt: Record<string, string[]> = { 'msg-a': [], 'msg-b': [] }
    for (let i = 0; i < 12; i++) {
      const at = i < 6 ? 'msg-a' : 'msg-b'
      told['tu-c' + i] = { id: 'Q' + (300 + i), name: 'card ' + i, gist: 'word '.repeat(i < 6 ? 8000 : 4000), blocking: false, pick: 'a', options: [{ type: 'a', option: 'yes' }, { type: 'b', option: 'no' }] }
      toldAt[at].push('tu-c' + i)
    }
    const w = world(on, { store: { told, toldAt } })
    on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'Box', props: { key: 'engine-reply' }, children: [] }))
    const held = w.tracks.find((t: any) => t.id === 'TR-3')
    held.now = Array.from({ length: 300 }, (_, i) => ({ id: 'T-' + (2000 + i), session: 'sess-1' }))
    for (let i = 0; i < 80; i++) {
      w.tracks.push({ id: 'TR-' + (100 + i), key: 'trkx' + i, name: 'side line ' + i + ' with a name long enough to wrap', state: i % 2 ? 'active' : 'waiting', workstream: 'WS-11',
        session: i % 2 ? 'other-' + i : undefined, text: '5 running', tasks: [], now: Array.from({ length: 5 }, (_, j) => ({ id: 'T-' + (5000 + i * 10 + j), session: 'other-' + i })), handoffs: [] })
    }
    w.questions[0].crux = 'word '.repeat(19000)
    for (let i = 0; i < 300; i++) {
      w.questions.push({ id: 'Q' + (400 + i), name: 'side question ' + i + ' about the store', blocking: false, workstream: 'WS-9',
        options: ['a', 'b', 'c', 'd'].map((t) => ({ type: t, option: 'option ' + t + ' of ' + i })) })
    }
    /* a long Asleep fold, open, gives way under the guard rather than costing the whole tab */
    const nap = Array.from({ length: 300 }, (_, i) => ({ id: 'Q' + (800 + i), name: 'nap ' + i + ' on a trigger that never fires', wake: 'until the store moves' }))
    const bandOf = w.near
    w.near = (...a: any[]) => ({ ...bandOf(...a), asleep: nap })
    await start($, w)
    await w.clock.settle()
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'askerdo', props: { title: 'AskerDo', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
    await w.clock.settle()
    /* counted apart from the mod's own count: every element and string, and the whole drawing written out */
    const nodesIn = (n: any): number => (typeof n === 'string' ? 1 : !n || typeof n !== 'object' ? 0 : Array.isArray(n) ? n.reduce((s: number, c: any) => s + nodesIn(c), 0) : 1 + nodesIn(n.children))
    const textIn = (n: any): number => (typeof n === 'string' ? n.length : !n || typeof n !== 'object' ? 0 : Array.isArray(n) ? n.reduce((s: number, c: any) => s + textIn(c), 0) : textIn(n.children))
    const under = async () => {
      const root = await pane.find({ key: 'askerdo-pane' })
      const read = String((await $.tool.call({ tool: 'mcp__askerdo__drawn', part: 'pane' })).result)
      /* each element's props written out, and every string under it */
      const charsIn = (n: any): number => (typeof n === 'string' ? n.length : !n || typeof n !== 'object' ? 0 : Array.isArray(n) ? n.reduce((s: number, c: any) => s + charsIn(c), 0)
        : JSON.stringify({ ...n.props, children: undefined }).length + charsIn(n.children))
      const chars = charsIn(root)
      const built = Number((/built (\d+) times? to fit/.exec(read) || [])[1])
      console.log('size guard, tabs: ' + read.split('\n').filter((l) => /tab|drawing:|left out/.test(l)).join(' | ') + ' | kit ' + nodesIn(root) + ' nodes, ' + chars + ' characters')
      return [nodesIn(root) < 2000, chars < 262144 && textIn(root) < 100000, /left out so the drawing stays whole: .*the tracks|left out so the drawing stays whole: .*question/.test(read), /before it gave way/.test(read), /whole tab/.test(read), built <= 8]
    }
    for (const tab of ['tracks', 'questions']) {
      await pane.press({ key: 'tab-' + tab })
      if (tab === 'questions') await pane.press({ key: 'asleep-fold' })
      await w.clock.advance(1000)
      await w.clock.settle()
      expect([tab, ...(await under())]).toEqual([tab, true, true, true, true, false, true])
    }
    /* the Questions tab says on itself what it left out, and a press on the list pins that question */
    const cut = await pane.find({ key: 'questions-cut' })
    expect(/\d+ /.test(String(cut && cut.text))).toBe(true)
    expect(/\d+ /.test(String((await pane.find({ key: 'asleep-cut' }))?.text))).toBe(true)
    await pane.press({ key: 'qrow-Q400' })
    await w.clock.settle()
    expect(!!(await pane.find({ key: 'qcard-Q400' }))).toBe(true)
    /* the Tracks tab's lines, and its fold's press lands */
    await pane.press({ key: 'tab-tracks' })
    await w.clock.settle()
    const tracksText = String((await pane.find({ key: 'tracks' }))?.text)
    expect([/tracks are not drawn here/.test(tracksText), /task and question rows are not drawn here/.test(tracksText)]).toEqual([true, true])
    await pane.press({ key: 'fold-elsewhere' })
    await w.clock.settle()
    expect(await pane.find({ key: 'sect-cut-elsewhere' })).toBeUndefined()
    await pane.unmount()
    /* each reply keeps its own cut: a heavy reply cut short never caps the lighter reply drawn after it */
    const shown: number[] = []
    for (const [id, from] of [['msg-a', 300], ['msg-b', 306]] as const) {
      const reply = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AssistantMessage', requestId: id, props: { text: 'Cards.', isFirstOfReply: true } })
      await w.clock.settle()
      let k = 0
      for (let i = 0; i < 6; i++) if (await reply.find({ key: 'qhead-Q' + (from + i) })) k++
      shown.push(k)
      expect(!!(await reply.find({ key: 'cards-cut' }))).toBe(k < 6)
      await reply.unmount()
    }
    expect(shown[0] > 0 && shown[0] < shown[1]).toBe(true)
  })

  /* the band's hover cards grow with the questions from elsewhere and the running agents; past the bounds
     they give way, each card saying how many it left out, and the band's presses still land */
  test('a band past the page\'s bounds is drawn under them, its cards saying what they left out, and still takes presses', HEAVY, async ($: any, on: any) => {
    const t1 = Date.now() - 600000
    const flights: any[] = Array.from({ length: 150 }, (_, i) => ({ id: 'bd-' + i, job: 'Band lane ' + i + ' reads the store and writes its report', model: 'claude-opus-5-5', calls: 4, tokens: 1000, start: t1 }))
    const w = world(on, { store: { 'flights:sess-1': { at: Date.now() - 60000, list: flights } } })
    on('agent.list', () => ({ value: flights.map((f) => ({ id: f.id, description: f.job, type: 'general-purpose', status: 'running' })) }))
    for (let i = 0; i < 300; i++) w.questions.push({ id: 'Q' + (700 + i), name: 'band side question ' + i + ' about the store', blocking: false, workstream: 'WS-9', options: [{ type: 'a', option: 'yes' }] })
    await start($, w)
    await w.clock.settle()
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} } })
    await w.clock.advance(1000)
    await w.clock.settle()
    /* counted apart from the mod's own count: every element and string, each element's props written out */
    const bandNodes = (n: any): number => (typeof n === 'string' ? 1 : !n || typeof n !== 'object' ? 0 : Array.isArray(n) ? n.reduce((s: number, c: any) => s + bandNodes(c), 0) : 1 + bandNodes(n.children))
    const bandChars = (n: any): number => (typeof n === 'string' ? n.length : !n || typeof n !== 'object' ? 0 : Array.isArray(n) ? n.reduce((s: number, c: any) => s + bandChars(c), 0)
      : JSON.stringify({ ...n.props, children: undefined }).length + bandChars(n.children))
    const root = await band.find({ key: 'band-and-box' })
    const read = String((await $.tool.call({ tool: 'mcp__askerdo__drawn', part: 'band' })).result)
    console.log('size guard, band: ' + read.split('\n').filter((l) => /drawing:|left out/.test(l)).join(' | ') + ' | kit ' + bandNodes(root) + ' nodes, ' + bandChars(root) + ' characters')
    const said = String(root && root.text)
    expect([bandNodes(root) < 2000, bandChars(root) < 262144, /left out so the drawing stays whole: .*elsewhere/.test(read), /before it gave way/.test(read),
      /questions from elsewhere are not/.test(said)]).toEqual([true, true, true, true, true])
    /* the agents card's press still opens the pane */
    const opened = w.panes.length
    await band.press({ key: 'status-agents-open' })
    await w.clock.settle()
    expect(w.panes.length).toBeGreaterThan(opened)
    await band.unmount()
  })
})

describe('the marker', () => {
  test('handoff_write asks for the track\'s marker, which the script writes only where opted in', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    await $.tool.call({ tool: 'mcp__askerdo__handoff_write', goal: 'g', focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    const runs = w.runs.filter((r: any) => r.script.endsWith('depth-marker.mjs')).slice(-2).map((r: any) => r.args)
    expect(runs[0]).toEqual(['--cwd', 'C:/src/proj', '--session', 'sess-1', '--track', 'trk3abcd', '--write', '--json'])
    /* the track let go, the shield reads the session's own guard, not the track's */
    expect(runs[1]).toEqual(['--cwd', 'C:/src/proj', '--session', 'sess-1', '--json'])
  })

  test('/clear then the first turn asks for the marker of the track under the new id', async ($: any, on: any) => {
    const w = world(on)
    guardOn(w)
    await start($, w)
    await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    w.sid = 'sess-2'
    await $.prompt.submit({ text: 'carry on' })
    await w.clock.settle()
    const run = w.runs.filter((r: any) => r.script.endsWith('depth-marker.mjs')).at(-1)
    expect(run.args).toEqual(['--cwd', 'C:/src/proj', '--session', 'sess-2', '--track', 'trk3abcd', '--write', '--json'])
  })
})

describe('the resolved profiles', () => {
  const PROFILE = { on: false, source: null, guard: null, main: { on: true, window: 5, wrap: 10 } }

  test('the meter and its notes follow main.window and main.wrap from the marker', async ($: any, on: any) => {
    const w = world(on)
    w.guard = { ...PROFILE, sources: { 'main.window': 'deep-code on WS-3' } }
    await start($, w)
    const ui = await mount($, 'terminal')
    await measure($, w, 4)
    expect(await meter(ui)).toEqual(['4%', 'dim'])
    const depthTool = async (why?: string) => String((await $.tool.call({ tool: 'mcp__askerdo__depth', ...(why ? { why } : {}) })).result)
    /* a mark's told state: the parenthesis after its number */
    const state = (text: string, p: number) => (new RegExp('\\b' + p + '\\D*?\\(([^)]*)\\)').exec(text) || [])[1]
    /* before the first note no number without why, and the percent alone with it */
    const gated = await depthTool()
    expect([/\d/.test(gated), gated.includes('why')]).toEqual([false, true])
    const asked = await depthTool('the user asked')
    expect([asked.includes('4 percent'), asked.includes('Marks'), asked.includes('told')]).toEqual([true, false, false])
    /* the drawn status row withholds the figure the depth tool withholds, and gives it once a note is told */
    const drawn = async () => String((await $.tool.call({ tool: 'mcp__askerdo__drawn', part: 'status' })).result)
    const before = await drawn()
    await measure($, w, 6)
    expect([/\bcontext\b/.test(before), /\b4\s*%/.test(before), /\b6\s*%/.test(await drawn())]).toEqual([true, false, true])
    expect(await meter(ui)).toEqual(['6%', 'bright'])
    expect(notes(w)[0]).toContain('The user\'s 5 percent mark: pick the handoff boundary')
    /* the session reads its own depth, as the band shows it, and its marks */
    const depth = await depthTool()
    expect(['6 percent', '60000 tokens', 'deep-code on WS-3'].every((x) => depth.includes(x))).toBe(true)
    /* the crossed 5 mark is told now, the 10 mark not yet */
    expect([!!state(depth, 5), !!state(depth, 10), state(depth, 5) !== state(depth, 10)]).toEqual([true, true, true])
    await measure($, w, 12)
    expect(await meter(ui)).toEqual(['12%', 'warning'])
    expect(notes(w).length).toBe(2)
    await ui.unmount()
  })

  test('main.on off: the meter stays dim and no notes at any depth', async ($: any, on: any) => {
    const w = world(on)
    w.guard = { ...PROFILE, main: { on: false, window: 30, wrap: 40 } }
    await start($, w)
    const ui = await mount($, 'terminal')
    await measure($, w, 45)
    expect(await meter(ui)).toEqual(['45%', 'dim'])
    expect(notes(w)).toEqual([])
    await ui.unmount()
  })

  test('the guard from a workstream profile names it, and its limits reach the agents', async ($: any, on: any) => {
    const w = world(on)
    w.guard = { on: true, source: { profile: 'deep-code', record: 'WS-11', level: 'workstream' },
      guard: { soft: 400000, hard: 500000, remind: 25000, hardDeny: false }, main: { on: true, window: 30, wrap: 40 } }
    await start($, w)
    const ui = await mount($, 'terminal')
    expect(await guardTip(ui)).toMatch(/deep-code.*400k.*500k/)
    expect((await $.command.run({ command: 'askerdo', args: 'guard' })).text)
      .toContain('The agent guard is on through deep-code on WS-11: subagents hear a hand-off note past 400k and an urgent one past 500k.')
    await step($, w, 'ag-1', 380000)
    expect((await agentNotes($, w, 'ag-1'))).toEqual([])
    await step($, w, 'ag-1', 410000)
    expect((await agentNotes($, w, 'ag-1'))[0]).toContain('past the soft limit of 400k')
    await ui.unmount()
  })

  test('a profile edit in the store is read again at the next load; other writes are not', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const ui = await mount($, 'terminal')
    const reads = () => w.runs.filter((r: any) => r.script.endsWith('depth-marker.mjs')).length
    const before = reads()
    w.marker = '2026-10#2'
    await w.clock.advance(15000)
    await w.clock.settle()
    expect(reads()).toBe(before)
    w.guard = { on: true, source: { profile: 'guard-on', record: 'C:/src/proj', level: 'project' }, guard: {}, main: {} }
    /* the board's profiles moved */
    w.profilesAt = 1
    w.marker = '2026-10#3'
    await w.clock.advance(15000)
    await w.clock.settle()
    expect(reads()).toBe(before + 1)
    expect(await guardTip(ui)).toMatch(/On .*350k.*450k/)
    await ui.unmount()
  })
})
