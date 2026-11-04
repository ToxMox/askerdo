/* Answers between sessions under `claude plugin
 * test`: nothing wakes a session. Idle, what waits is counted on the
 * band and rides the submit chip or the next prompt the user types; running, a note
 * the model reads; each once per session, /clear included. */
import { describe, expect, test } from 'claude-code/testing'
import { pressAgain, start, world } from './world.ts'

/* the user's lines in their own voice, the rest under the relay header */
const RELAY = 'AskerDo relays these updates'
const OURS = /^(I (answered|changed my answer|dropped|snoozed) |AskerDo relays )/
const delivered = (w: any) => w.prompts.filter((p: string) => OURS.test(p))
const noted = (w: any) => w.appends.filter((m: any) => !m.agentId && OURS.test(String(m.content[0].text))).map((m: any) => m.content[0].text)
/* the transcript row the moment answers reach the model */
const receipts = (w: any) => w.logs.filter((l: string) => /reached the model/.test(l))

async function storeMoves(w: any) {
  w.marker += '+'
  await w.clock.advance(15000)
  await w.clock.settle()
}

const AT = '2026-10-21T09:00:00+00:00'
const edit = (id: string) => ({ key: [AT, 'question-edit', id, '', '', ''].join('|'),
  line: id + ' (card verdict) was edited on the board: name.', raw: { at: AT, kind: 'question-edit', id, name: 'card verdict', detail: 'name' } })
const BAND = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} }
const mount = ($: any) => $.ui.mount({ plugin: 'askerdo', surface: 'desktop', component: 'AbovePrompt', props: BAND })

describe('answer delivery', () => {
  test('idle: nothing starts a turn; the band counts what waits, and its submit chip sends it all in one prompt, once', async ($: any, on: any) => {
    const w = world(on)
    w.inbox['sess-1'] = [w.event('Q106', 'b'), edit('Q107')]
    await start($, w)
    await storeMoves(w)
    expect(delivered(w)).toEqual([])
    expect(noted(w)).toEqual([])
    expect(w.inbox['sess-1'].length).toBe(2)
    const ui = await mount($)
    expect((await ui.find({ key: 'inbox-submit' }))?.props.label).toContain('2')
    /* the mark's card names the answer's option */
    expect(await ui.find({ type: 'Text', text: /106b, many files/ })).toBeDefined()
    /* a submit the engine refuses puts the events back */
    w.submitThrows = 1
    await ui.press({ key: 'inbox-submit' })
    await w.clock.settle()
    expect(delivered(w)).toEqual([])
    expect(w.unacked('sess-1').length).toBe(2)
    expect(receipts(w)).toEqual([])
    await storeMoves(w)
    await pressAgain(ui, 'inbox-submit')
    await w.clock.settle()
    expect(delivered(w).length).toBe(1)
    expect(receipts(w).length).toBe(1)
    expect(receipts(w)[0]).toContain('106b (store shape)')
    /* the user's answer goes as the user's own words; the edit stays the plugin's relay */
    const [mine, relayed] = delivered(w)[0].split(RELAY)
    expect(mine).toContain('I answered Q106 (store shape): 106b, many files.')
    expect(relayed).toContain('Q107 (card verdict) was edited')
    expect(w.origins.at(-1)?.asUser).toBe(true)
    expect(await ui.find({ key: 'inbox' })).toBeUndefined()
    /* a crash leftover read again is neither counted nor told twice */
    w.inbox['sess-1'] = [w.event('Q106', 'b')]
    await storeMoves(w)
    expect(await ui.find({ key: 'inbox' })).toBeUndefined()
    await $.prompt.submit({ text: 'go on' })
    await w.clock.settle()
    expect(delivered(w).length).toBe(1)
    expect(noted(w)).toEqual([])
    await ui.unmount()
  })

  test('a prompt the user types carries what waits at its top, and the turn it starts does not tell it again', async ($: any, on: any) => {
    const w = world(on)
    w.inbox['sess-1'] = [w.event('Q106', 'b')]
    await start($, w)
    await $.prompt.submit({ text: 'carry on' })
    await w.clock.settle()
    expect(noted(w).length).toBe(1)
    expect(noted(w)[0]).toContain('I answered Q106 (store shape): 106b')
    expect(w.prompts.at(-1)).toBe('carry on')
    /* the turn the prompt starts makes no second inbox call */
    const takes = () => w.runs.filter((r: any) => r.script.endsWith('mod-inbox.mjs') && r.args[0] === 'take').length
    const took = takes()
    await $.turn.start({ text: 'carry on', turnId: 't1' })
    await w.clock.settle()
    expect(takes()).toBe(took)
    expect(noted(w).length).toBe(1)
    expect(delivered(w)).toEqual([])
  })

  test('running: an answer arriving mid-turn is a note the model reads at its next step', async ($: any, on: any) => {
    const w = world(on)
    w.contract = { section: 'The mod section.', checks: {} }
    await start($, w)
    await $.turn.start({ text: 'work', turnId: 't1' })
    w.inbox['sess-1'] = [w.event('Q107', 'a'), w.event('Q108', 'c')]
    await storeMoves(w)
    /* each answer arriving raises a toast, and starts nothing */
    expect(w.toasts.filter((t: string) => /Q10[78]/.test(t)).length).toBe(2)
    expect(delivered(w)).toEqual([])
    expect(noted(w).length).toBe(1)
    expect(noted(w)[0]).toContain('I answered Q107 (store shape): 107a.')
    expect(noted(w)[0]).toContain('I answered Q108 (store shape): 108c.')
    /* the batch is one row naming each answer */
    expect(receipts(w).length).toBe(1)
    expect(receipts(w)[0]).toContain('107a')
    expect(receipts(w)[0]).toContain('108c')
    /* the reply after them that skips one is flagged, once */
    const said = 'Got 107a (store shape).'
    await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: said }] },
      door: 'response', origin: { kind: 'model', model: 'm' }, uuid: 'm1' })
    /* the turn ends: the next answer waits for the user */
    await $.turn.complete({ answer: said, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    const flagged = () => w.logs.filter((l: string) => /receipt/.test(l))
    expect(flagged().length).toBe(1)
    expect(flagged()[0]).toContain('108c')
    expect(flagged()[0]).not.toContain('107a')
    await $.turn.start({ text: 'more', turnId: 't2' })
    await $.turn.complete({ answer: 'more', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' })
    expect(flagged().length).toBe(1)
    w.inbox['sess-1'] = [w.event('Q109', 'a')]
    await storeMoves(w)
    expect(delivered(w)).toEqual([])
    expect(noted(w).length).toBe(1)
  })

  test('/clear: the first prompt re-binds and carries what waits in the old id\'s inbox', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    w.sid = 'sess-2'
    w.inbox['sess-1'] = [w.event('Q110', 'a')]
    await $.prompt.submit({ text: 'carry on' })
    await w.clock.settle()
    expect(w.last('resume').args).toEqual(['resume', 'TR-3', '--take-over', '--session', 'sess-2', '--json'])
    expect(noted(w).length).toBe(1)
    expect(noted(w)[0]).toContain('Q110')
  })

  test('a handed-off session\'s band stays as last drawn and says why; what waits rides a prompt typed there', async ($: any, on: any) => {
    const w = world(on)
    w.hand = [{ id: 'T-41', name: 'wire it' }]
    /* Q106 blocks in the held track's workstream: the board scopes it through the lease, which
       goes with the handoff, so a reload would drop it from the band */
    await start($, w)
    const seg = async (ui: any, k: string) => (await ui.find({ key: 'status-' + k }))?.text
    const live = await mount($)
    expect(await seg(live, 'thread')).toContain('mod core')
    expect(await seg(live, 'task')).toBeDefined()
    await live.unmount()
    await $.turn.start({ text: 'go on', turnId: 't1' })
    await $.tool.call({ tool: 'mcp__askerdo__handoff_write', focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    await $.turn.complete({ answer: 'Handed off.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.settle()
    w.questions[0].name = 'renamed later'
    w.inbox['sess-1'] = [w.event('Q106', 'a')]
    await storeMoves(w)
    expect(delivered(w)).toEqual([])
    const frozen = await mount($)
    expect((await frozen.find({ key: 'closed' }))?.text).toContain('handed off')
    /* kept in the store, so a hot reload reads the freeze back */
    expect(w.stored.closedSessions).toEqual({ 'sess-1': 'handed off' })
    expect((await frozen.find({ key: 'q-Q106' }))?.text).toContain('store shape')
    /* frozen, it still shows the store's state: the track let go and waiting on the shelf */
    expect(await seg(frozen, 'thread')).toBeUndefined()
    /* the board let go of the tasks in hand with the handoff */
    expect(await seg(frozen, 'task')).toBeUndefined()
    expect(await seg(frozen, 'shelf')).toMatch(/\b1\b/)
    await frozen.unmount()
    await $.prompt.submit({ text: 'one more thing' })
    await w.clock.settle()
    expect(noted(w).at(-1)).toContain('Q106')
    /* the prompt the user typed makes the session live again */
    expect(w.stored.closedSessions).toEqual({})
  })

  test('mod present, drain silent: the switch stays set while the mod delivers', async ($: any, on: any) => {
    const w = world(on)
    await $.classic.SessionStart({ source: 'startup' })
    w.inbox['sess-1'] = [w.event('Q106', 'b')]
    await start($, w)
    expect(w.env.ASKERDO_MOD).toBe('1')
    await $.prompt.submit({ text: 'go' })
    await w.clock.settle()
    expect(noted(w).length).toBe(1)
  })
})
