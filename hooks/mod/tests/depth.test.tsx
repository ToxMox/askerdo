/* The main depth meter, the agent guard and the marker
 *  under `claude plugin test`, fed synthetic `session.measure` and
 * step usage figures, the status line drawn on the terminal and the desktop. */
import { describe, expect, test } from 'claude-code/testing'
import { start, world as base } from './world.ts'
import { STOP_FIRST } from '../../../lib/mod-core.mjs'

const PLUGIN = 'askerdo'
const SURFACES = ['terminal', 'desktop'] as const
const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
/* the engine's own hint under the status line, as status.test.tsx stands it in */
function world(on: any, opts?: Parameters<typeof base>[1]) {
  const w = base(on, opts)
  on('ui.render', { component: 'PromptHint' }, () => ({ type: 'Box', props: { key: 'engine-hint' }, children: [] }))
  return w
}
const BAND = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} }
/* the status line is the hint line's on the terminal and the band's last row on the desktop */
const mount = ($: any, surface: string) => surface === 'desktop'
  ? $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
  : $.ui.mount({ plugin: PLUGIN, surface, component: 'PromptHint', props: HINT })
const WINDOW = 1000000
const measure = async ($: any, w: any, percent: number | undefined) => {
  const context: any = { window: WINDOW }
  if (percent !== undefined) { context.percent = percent; context.tokens = Math.round(percent * WINDOW / 100) }
  await $.session.measure({ context, rateLimits: [], changed: ['context'] })
  await w.clock.settle()
}
/* the status line's context meter, its percent and tone; the shield's card */
const TONE = (p: any) => p.color || (p.dimColor ? 'dim' : 'bright')
const meter = async (ui: any) => {
  const t = await ui.find({ type: 'Text', text: / C \d+%$/ })
  if (t) return [t.text.split(' ').pop(), TONE(t.props)]
  /* the desktop's number beside its ring */
  const d = (await ui.find({ key: 'status-context' }))?.children.find((c: any) => c.type === 'Text')
  return d ? [d.children.join(''), TONE(d.props)] : undefined
}
/* the shield's segment with its hover card, either surface (a title, the state, the press) */
const guardTip = async (ui: any) => (await ui.find({ key: 'status-guard' }))?.text
const notes = (w: any) => w.appends.filter((m: any) => !m.agentId).map((m: any) => m.content[0].text)
const agentNotes = (w: any, id: string) => w.appends.filter((m: any) => m.agentId === id).map((m: any) => m.content[0].text)
const usage = (tokens: number) => ({ input_tokens: 1000, cache_read_input_tokens: tokens - 3000, cache_creation_input_tokens: 2000, output_tokens: 10 })

async function step($: any, w: any, agentId: string | undefined, tokens: number) {
  w.stepUsage[agentId || 'main'] = usage(tokens)
  const s = $.turn.step({ turnId: 't-' + (agentId || 'main'), index: 0, model: 'm', messageCount: 3, ...(agentId ? { agentId } : {}) })
  for await (const _ of s) { /* drained */ }
  await s.result
  await w.clock.settle()
}

function guardOn(w: any, extra: any = {}) {
  w.guard = { on: true, source: 'project', guard: { soft: 350000, hard: 450000, remind: 25000, ...extra } }
}

describe('the main depth meter', () => {
  for (const surface of SURFACES) {
    test('nothing below 30 percent, the window note at 30, the insistence at 40, each once (' + surface + ')', async ($: any, on: any) => {
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
    expect(await meter(ui)).toEqual(['32%', 'bright'])
    expect(notes(w).length).toBe(1)
    await ui.unmount()
  })

  /* the meter's window and the user's ask are a handoff's only triggers */
  test('handoff_write is refused below the window; the mark told, or /askerdo handoff, opens it', async ($: any, on: any) => {
    const w = world(on)
    w.usage.context = { tokens: 120000, window: WINDOW, percent: 12 }
    await start($, w)
    const write = () => $.tool.call({ tool: 'mcp__askerdo__handoff_write', focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    const writes = () => w.cliRuns().filter((r: any) => r.args[0] === 'handoff' && r.args[1] === 'write').length
    const refused = await write()
    expect(String(refused.deny)).toContain('12 percent, below the 30 percent handoff window')
    expect(String(refused.deny)).toContain('/askerdo handoff')
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
    expect(String((await write()).deny)).toContain('below the 30 percent handoff window')
    await $.command.run({ command: 'askerdo', args: 'handoff' })
    await write()
    expect(writes()).toBe(2)
  })
})

describe('the agent guard', () => {
  for (const surface of SURFACES) {
    test('the shield chip says the guard\'s state, off by default; a press toggles it through /askerdo guard\'s path (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      await start($, w)
      const ui = await mount($, surface)
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
  }

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
    expect(agentNotes(w, 'ag-1')).toEqual([])
  })

  test('on: a subagent crossing soft gets the CONTINUE note naming its state note, then reminders and the urgent one', async ($: any, on: any) => {
    const w = world(on)
    guardOn(w)
    await start($, w)
    w.agentMessages['ag-1'] = [{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 'u1', tool: 'Write', input: { file_path: 'C:/x/lane-9-state.md', content: 'x' } }] }]
    await step($, w, 'ag-1', 340000)
    expect(agentNotes(w, 'ag-1')).toEqual([])
    await step($, w, 'ag-1', 352000)
    const soft = agentNotes(w, 'ag-1')
    expect(soft.length).toBe(1)
    expect(soft[0]).toContain('CONTEXT DEPTH 352k tokens, past the soft limit of 350k')
    expect(soft[0]).toContain('The state note you have been writing is C:/x/lane-9-state.md.')
    expect(soft[0]).toContain('CONTINUE: <your state note path>')
    expect(soft[0]).toContain('after which this reminder turns urgent')
    await step($, w, 'ag-1', 370000)
    expect(agentNotes(w, 'ag-1').length).toBe(1)
    await step($, w, 'ag-1', 378000)
    expect(agentNotes(w, 'ag-1').length).toBe(2)
    await step($, w, 'ag-1', 451000)
    const all = agentNotes(w, 'ag-1')
    expect(all.length).toBe(3)
    expect(all[2]).toMatch(/^URGENT: CONTEXT DEPTH 451k tokens, past the hard floor of 450k/)
    for (const n of all) expect(n).not.toMatch(/\b(stop|cancel|abandon|abort|kill|terminate|halt|interrupt)\b/i)
    /* the main loop hears none of it */
    expect(notes(w)).toEqual([])
  })

  test('on with hardDeny: past hard every call is refused but the state note', async ($: any, on: any) => {
    const w = world(on)
    guardOn(w, { hardDeny: true })
    on('tool.call', { tool: 'Write' }, () => ({ result: 'written' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran' }))
    await start($, w)
    expect((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag-2' })).result).toBe('ran')
    await step($, w, 'ag-2', 352000)
    expect(agentNotes(w, 'ag-2')[0]).toContain('after which only the state note can be written')
    await step($, w, 'ag-2', 460000)
    expect(agentNotes(w, 'ag-2').length).toBe(1)
    const denied = await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag-2' })
    expect(String(denied.deny || denied.text)).toContain('Only a Write or Edit to your state note')
    expect((await $.tool.call({ tool: 'Write', file_path: 'C:/x/lane-9-state.md', content: 'n', agentId: 'ag-2' })).result).toBe('written')
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
    await $.tool.call({ tool: 'mcp__askerdo__handoff_write', focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    w.tracks[0].session = 'sess-1'
    guardOn(w)
    const brief = { description: 'reader', prompt: 'Read it.', tool_use_id: 'tu-1' }
    await $.tool.call({ tool: 'Agent', ...brief })
    await $.agent.spawn(brief)
    const last = (s: string) => w.runs.filter((r: any) => r.script.endsWith(s)).at(-1).args
    expect(last('depth-marker.mjs')).toContain('trk3abcd')
    expect(last('/rules.mjs')).toContain('TR-3')
    await step($, w, 'ag-9', 352000)
    expect(agentNotes(w, 'ag-9')[0]).toContain('past the soft limit of 350k')
  })

  /* the agents segment draws only while an agent runs, its card the job, model, its running time,
     calls and depth, amber past the warning point; Home's section unfolds from its press; a
     finished one waits in a fold of its own, shut until pressed, under the running ones */
  test('an agent in flight shows on the status row and Home, and leaves when it ends', async ($: any, on: any) => {
    /* Agents shut under the saved key stays shut after the update, though nothing saved opens it */
    const w = world(on, { store: { agentsOpen: false } })
    /* a hard limit apart from the default, so Home and the row name the same one */
    guardOn(w, { hard: 400000 })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran' }))
    let n = 0
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'ag-' + ++n }))
    await start($, w)
    await $.agent.spawn({ description: 'Band lane', prompt: 'Go.', tool_use_id: 'tu-1' })
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag-1' })
    await step($, w, 'ag-1', 340000)
    const term = await mount($, 'terminal')
    expect((await term.find({ key: 'status-agents' }))?.text).toMatch(/1.*Band lane \(Opus 5\.5, \D*\d+s, 1 tool call, 340k of 400k\)/)
    await term.unmount()
    const ui = await mount($, 'desktop')
    const label = (await ui.find({ key: 'face-agents-lit' }))!.children.find((c: any) => c && c.type === 'Text')
    expect([label.children.join(''), label.props.color]).toEqual(['1', 'warning'])
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'askerdo', props: { title: 'AskerDo', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
    expect([(await pane.find({ key: 'agents-sum' }))?.text, await pane.find({ key: 'agent-ag-1' })]).toEqual([expect.stringContaining('deepest 340k of 400k'), undefined])
    await ui.press({ key: 'status-agents-open' })
    await w.clock.settle()
    expect((await pane.find({ key: 'agent-ag-1' }))?.text).toMatch(/Opus 5\.5, \D*\d+s,/)
    expect(await pane.find({ key: 'agents-done' })).toBeUndefined()
    await $.agent.spawn({ description: 'Pane lane', prompt: 'Go.', tool_use_id: 'tu-2' })
    await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't-ag-2', reason: 'answer', agentId: 'ag-2' })
    await w.clock.settle()
    expect([(await pane.find({ key: 'agents-done-head' }))?.text, await pane.find({ key: 'agent-ag-2' }), !!(await pane.find({ key: 'agent-ag-1' }))])
      .toEqual([expect.stringMatching(/1 done.*Pane lane/), undefined, true])
    await pane.press({ key: 'agents-done-fold' })
    await w.clock.settle()
    expect([(await pane.find({ key: 'agent-ag-2' }))?.text, !!(await pane.find({ key: 'agent-ag-1' }))]).toEqual([expect.stringContaining('done'), true])
    await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't-ag-1', reason: 'answer', agentId: 'ag-1' })
    await w.clock.settle()
    expect([await ui.find({ key: 'status-agents' }), await pane.find({ key: 'agents' })]).toEqual([undefined, undefined])
    await pane.unmount()
    await ui.unmount()
  })
})

describe('the marker', () => {
  test('handoff_write asks for the track\'s marker, which the script writes only where opted in', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    await $.tool.call({ tool: 'mcp__askerdo__handoff_write', focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
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
    const depthTool = async () => String((await $.tool.call({ tool: 'mcp__askerdo__depth' })).result)
    /* a mark's told state: the parenthesis after its number */
    const state = (text: string, p: number) => (new RegExp('\\b' + p + '\\D*?\\(([^)]*)\\)').exec(text) || [])[1]
    const before = await depthTool()
    await measure($, w, 6)
    expect(await meter(ui)).toEqual(['6%', 'bright'])
    expect(notes(w)[0]).toContain('The user\'s 5 percent mark: pick the handoff boundary')
    /* the session reads its own depth, as the band shows it, and its marks */
    const depth = await depthTool()
    expect(['6 percent', '60000 tokens', 'deep-code on WS-3'].every((x) => depth.includes(x))).toBe(true)
    /* the crossed 5 mark is told now, the 10 mark as it was */
    expect([!!state(before, 5), state(depth, 5) !== state(before, 5), state(depth, 10) === state(before, 10)]).toEqual([true, true, true])
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
    expect(agentNotes(w, 'ag-1')).toEqual([])
    await step($, w, 'ag-1', 410000)
    expect(agentNotes(w, 'ag-1')[0]).toContain('past the soft limit of 400k')
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
