/* The first telling drawn by the mod, the mod's contract section, the reply
 * and dispatch checks, and the board kept out of an unengaged session under `claude plugin test`, both surfaces. */
import { describe, expect, test } from 'claude-code/testing'
import { start, world } from './world.ts'
import { firstTellingCard, gridWidths } from '../../../lib/mod-core.mjs'

const PLUGIN = 'askerdo'
const ASK = 'mcp__askerdo__ask'
const ASKED = 'One file (a) or many (b, my pick)?'
const SURFACES = ['terminal', 'desktop'] as const
const HAND = '\u{1F64B}', GREEN = '\u{1F7E2}', FLAG = '\u{1F3C1}', OK = '\u2705', SUN = '\u2600\uFE0F'
const CHECKS = { emdash: true, forecast: true, hub: true }
const BAND = {
  hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 11 }, view: {},
}
const OPTIONS = [
  { type: 'a', option: 'one file', getsYou: 'simple', costsYou: 'merge churn' },
  { type: 'b', option: 'many files', getsYou: 'isolation', costsYou: '', undo: 'one-way: a migration', headline: 'Each record is its own file.' },
]

const compose = ($: any, surfaces: string[], tools: string[] = []) => $.prompt.compose({
  model: 'm', promptModel: 'm', surfaces, tools, outputStyle: null, traits: [],
})
const notes = (w: any) => w.appends.filter((m: any) => !m.agentId && m.type === 'user'
  && String(m.content[0].text).startsWith('AskerDo contract check')).map((m: any) => m.content[0].text)
const flags = (w: any) => w.logs.filter((l: string) => l.startsWith('AskerDo: '))

async function reply($: any, answer: string, id = 't1') {
  await $.turn.start({ text: 'work', turnId: id })
  await $.turn.complete({ answer, durationMs: 5, isAborted: false, turnId: id, reason: 'answer' })
}

function checked(on: any, checks: any = CHECKS) {
  const w = world(on)
  w.contract = { section: 'The mod section: writes no names line.', checks }
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'core', scope: 'shared' }] }))
  return w
}

/* The reply that asked: a text row the model wrote this turn, as the engine stores it. */
const replyRow = ($: any, uuid: string, text = 'Q512 waits for you.') => $.session.append({
  message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
  door: 'response', origin: { kind: 'model', model: 'm' }, uuid,
})
/* the engine's own reply drawing, beneath the plugin */
const engineReply = (on: any) => on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'Box', props: { key: 'engine-reply' }, children: [] }))
const mountReply = ($: any, surface: string, id: string, text = 'Q512 waits for you.', viewport?: any) => $.ui.mount({ plugin: PLUGIN, surface,
  component: 'AssistantMessage', requestId: id, props: { text, isFirstOfReply: true }, ...(viewport ? { viewport } : {}) })
const turnEnd = ($: any, turnId: string) => $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId, reason: 'answer' })

describe('the first telling', () => {
  /* the tool's row is collapsed in the transcript, so the card draws
     under the reply that asked, the turn's last text row, and the tool's row is the engine's */
  test('the card draws under the turn\'s last reply, not on the ask tool\'s row: the pane\'s card, the pick starred', async ($: any, on: any) => {
    const w = world(on)
    engineReply(on)
    on('ui.render', { component: 'ToolResult' }, () => ({ type: 'Box', props: { key: 'engine-row' }, children: [] }))
    await start($, w)
    await $.turn.start({ text: 'work', turnId: 't1' })
    const r = await $.tool.call({ tool: ASK, tool_use_id: 'tu-1', name: 'store shape', ask: ASKED, gist: 'One or many?', blocking: true,
      crux: 'Two writers at once.', stakes: 'A migration later.', options: OPTIONS, pick: 'b' })
    expect(r.result).toContain('Registered Q512')
    /* a reversal beside another ask of the turn is registered and flagged, never refused */
    const second = await $.tool.call({ tool: ASK, tool_use_id: 'tu-2', name: 'back to one file', ask: ASKED, gist: 'g', blocking: true,
      revisits: ['Q500'], reversal: 'Two machines write now.', options: OPTIONS, pick: 'b' })
    expect(second.deny).toBeUndefined()
    expect(second.result).toContain('Q512')
    await replyRow($, 'msg-1')
    await replyRow($, 'msg-2', 'And one more thing.')
    await turnEnd($, 't1')
    await w.clock.settle()
    for (const surface of SURFACES) {
      const ui = await mountReply($, surface, 'msg-2')
      expect(await ui.find({ key: 'engine-reply' })).toBeDefined()
      expect((await ui.find({ key: 'qhead-Q512' }))?.text).toContain('store shape')
      expect((await ui.find({ key: 'qcrux-Q512' }))?.text).toContain('Two writers at once.')
      expect((await ui.find({ key: 'qstakes-Q512' }))?.props.text).toContain('A migration later.')
      expect((await ui.find({ key: 'ogets-512a' }))?.text).toBe('simple')
      /* the pick starred; a one-way undo says so in the catch (rule 15) */
      expect((await ui.find({ key: 'otitle-512b' }))?.text).toContain('\u2605')
      expect((await ui.find({ key: 'ocatch-512b' }))?.text).toContain('one-way')
      expect(await ui.find({ key: 'ask-Q512' })).toBeDefined()
      /* both cards of the reply say they were asked together */
      expect((await ui.find({ key: 'qbeside-Q512' }))?.text).toContain('Q513')
      expect((await ui.find({ key: 'qbeside-Q513' }))?.text).toContain('Q512')
      /* no hotkeys in the transcript */
      expect((await ui.find({ key: 'pick-512a' }))?.props.hotkey).toBeUndefined()
      await ui.unmount()
      /* the earlier reply of the turn and the tool's own row keep the engine's drawing */
      const early = await mountReply($, surface, 'msg-1')
      expect(await early.find({ key: 'telling-Q512' })).toBeUndefined()
      await early.unmount()
      const row = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolResult', requestId: 'tu-1',
        props: { tool_use_id: 'tu-1', tool: ASK, output: r.result, isErrored: false } })
      expect(await row.find({ key: 'telling-Q512' })).toBeUndefined()
      expect(await row.find({ key: 'engine-row' })).toBeDefined()
      await row.unmount()
    }
    /* the desktop keys a block by its API message id, which no hook is handed;
       the row's text finds the turn's last reply, and only that one */
    const desk = await mountReply($, 'desktop', 'msg_01Ab-t0', ' And one more thing. ', { columns: 98, rows: 40 })
    expect((await desk.find({ key: 'qhead-Q512' }))?.text).toContain('store shape')
    /* a desktop reply's 98 columns are code-font cells, the pane's card at 88 of its own;
       the head names the session that asked, where the board link follows */
    const told = firstTellingCard({ id: 'Q512', name: 'store shape', options: OPTIONS, pick: 'b' })
    expect((await desk.find({ key: 'qcols-Q512' }))!.children[0].props.flexGrow).toBe(gridWidths(88, 'desktop', told.options).weights.option)
    expect((await desk.find({ key: 'qmeta-Q512' }))?.text).toContain('asked by this session')
    await desk.unmount()
    const deskEarly = await mountReply($, 'desktop', 'msg_01Cd-t0')
    expect(await deskEarly.find({ key: 'qhead-Q512' })).toBeUndefined()
    await deskEarly.unmount()

    /* reworded in place, Q512 keeps its id; the first card is one changed line with
       no chips, its press pins Q512 in the Questions tab, and the later reply draws the new card */
    await $.turn.start({ text: 'work', turnId: 't2' })
    const three = [...OPTIONS, { type: 'c', option: 'a table', getsYou: 'queries', costsYou: 'a server' }]
    const re = await $.tool.call({ tool: ASK, tool_use_id: 'tu-3', edits: 'Q512', name: 'store shape', ask: 'One file (a), many (b) or a table (c, my pick)?',
      gist: 'One, many or a table?', blocking: true, options: three, pick: 'c' })
    expect(re.result).toContain('Q512')
    expect(w.last('question edit').args.slice(0, 3)).toEqual(['question', 'edit', 'Q512'])
    await replyRow($, 'msg-3', 'Q512 again, reworded.')
    await turnEnd($, 't2')
    await w.clock.settle()
    for (const surface of SURFACES) {
      const first = await mountReply($, surface, 'msg-2')
      expect(await first.find({ key: 'qchanged-Q512' })).toBeDefined()
      expect(await first.find({ key: 'pick-512a' })).toBeUndefined()
      expect(await first.find({ key: 'qbeside-Q513' })).toBeDefined()
      await first.unmount()
      const later = await mountReply($, surface, 'msg-3', 'Q512 again, reworded.')
      expect((await later.find({ key: 'otitle-512c' }))?.text).toContain('a table')
      await later.unmount()
    }
    const first = await mountReply($, 'terminal', 'msg-2')
    await first.press({ key: 'qopen-Q512' })
    expect(w.panes.at(-1)?.focus).toBe(true)
  })

  /* an answer or a drop made off the card reaches it too */
  test('a slot unfolds on a press, and Pick answers through the CLI and marks the card answered; an answer or drop made elsewhere reaches the card at the band\'s next load', async ($: any, on: any) => {
    const w = world(on)
    for (const id of ['Q512', 'Q513', 'Q514']) w.questions.push({ id, name: 'store shape', blocking: true, workstream: 'WS-11', options: OPTIONS, pick: 'b' })
    engineReply(on)
    await start($, w)
    await $.turn.start({ text: 'work', turnId: 't2' })
    for (const tu of ['tu-2', 'tu-3', 'tu-4']) {
      await $.tool.call({ tool: ASK, tool_use_id: tu, name: 'store shape', ask: ASKED, gist: 'One or many?', blocking: true, options: OPTIONS, pick: 'b' })
    }
    await replyRow($, 'msg-2')
    await turnEnd($, 't2')
    await w.clock.settle()
    const ui = await mountReply($, 'terminal', 'msg-2')
    await ui.press({ key: 'unfold-512b' })
    expect((await ui.find({ key: 'slot-512b-headline' }))?.text).toBe('Each record is its own file.')
    await ui.press({ key: 'pick-512b' })
    /* the reply's card answers through its strip too */
    await ui.press({ key: 'qnow-Q512' })
    expect(w.last('answer').args.slice(0, 3)).toEqual(['answer', 'Q512', '--pick'])
    expect(w.last('answer').args[3]).toBe('b')
    expect(w.toasts.at(-1)).toContain('Answered Q512')
    expect((await ui.find({ key: 'qdone-Q512' }))?.text).toContain('512b')
    expect(await ui.find({ key: 'pick-512a' })).toBeUndefined()
    await w.clock.settle()
    expect(await ui.find({ key: 'pick-513a' })).toBeDefined()
    /* a typed /askerdo 513a or a chat answer through the CLI, and a drop on the board */
    w.cli(['answer', 'Q513', '--pick', 'a', '--json'])
    w.cli(['drop', 'Q514', '--note', 'not needed', '--json'])
    await w.clock.advance(15000)
    await w.clock.settle()
    expect((await ui.find({ key: 'qdone-Q513' }))?.text).toContain('513a')
    expect(await ui.find({ key: 'pick-513a' })).toBeUndefined()
    expect((await ui.find({ key: 'qdone-Q514' }))?.text).toContain('Dropped')
    /* an ended card's press says its end */
    const toasted = w.toasts.length
    await ui.press({ key: 'stand-514a' })
    expect([w.toasts.length, w.toasts.at(-1).includes('Q514')]).toEqual([toasted + 1, true])
    expect(w.stored.told['tu-3'].answered).toBe('513a')
  })

  /* a reload or a resumed transcript has no memory of the ask */
  test('the card and the reply it draws under are kept in the store', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    await $.turn.start({ text: 'work', turnId: 't7' })
    const r = await $.tool.call({ tool: ASK, tool_use_id: 'tu-7', name: 'store shape', ask: ASKED, gist: 'One or many?', blocking: true,
      crux: 'Two writers at once.', options: OPTIONS, pick: 'b' })
    expect(r.result).toContain('Registered Q512')
    await replyRow($, 'msg-7')
    await turnEnd($, 't7')
    await w.clock.settle()
    const kept = w.stored.told
    expect(kept['tu-7'].id).toBe('Q512')
    expect(kept['tu-7'].crux).toBe('Two writers at once.')
    expect(w.stored.toldAt['msg-7']).toEqual(['tu-7'])
  })

  test('a reply the store holds from before a reload draws the card, its answer included', async ($: any, on: any) => {
    const q = { id: 'Q77', name: 'port pick', gist: 'Which port?', blocking: true, crux: 'Two services clash.',
      options: OPTIONS, pick: 'a', answered: '77a' }
    const w = world(on, { store: { told: { 'tu-old': q }, toldAt: { 'msg-old': ['tu-old'] } } })
    engineReply(on)
    for (const surface of SURFACES) {
      const ui = await mountReply($, surface, 'msg-old')
      expect((await ui.find({ key: 'qhead-Q77' }))?.text).toContain('port pick')
      expect((await ui.find({ key: 'qcrux-Q77' }))?.text).toContain('Two services clash.')
      expect((await ui.find({ key: 'qdone-Q77' }))?.text).toContain('77a')
      /* answered, a desktop checks the answer's badge and dims the rest, no answer press;
         the terminal keeps its letters, each a plain press */
      const chip = async (tok: string) => (await ui.find({ key: 'ochip-' + tok }))!.children
      if (surface === 'desktop') {
        const alts = [(await chip('77a'))[0].props.alt, (await chip('77b'))[0].props.alt]
        expect([/your answer/.test(alts[0]), /not picked/.test(alts[1])]).toEqual([true, true])
        /* answered is green at a glance: the frame and the chosen tile, not the pick's sky */
        const frame = (await ui.find({ key: 'qcard-Q77' }))!.props.borderColor
        const tiles = await Promise.all(['77a', '77b'].map(async (t) => (await ui.find({ key: 'opt-' + t }))!.props.borderColor === frame))
        expect([!!frame && frame !== '#00AEEF', tiles]).toEqual([true, [true, false]])
        /* an answered card's ring redraws under its other key on each press, as an open card's */
        const rings = async () => (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('unfold-77b'))
        await ui.press({ key: 'unfold-77b' })
        expect([await rings(), !!(await ui.find({ key: 'slot-77b-headline' }))]).toEqual([['unfold-77b~'], true])
        await ui.press({ key: 'unfold-77b~' })
        expect([await rings(), !!(await ui.find({ key: 'slot-77b-headline' }))]).toEqual([['unfold-77b'], false])
      } else expect((await chip('77a'))[0].props.plain).toBe(true)
      expect(await ui.find({ key: 'pick-77a' })).toBeUndefined()
      /* a press on another option says the answer that stands and records nothing */
      await ui.press({ key: 'stand-77b' })
      expect([w.toasts.at(-1).includes('77a'), w.cliRuns().some((r: any) => r.args[0] === 'answer')]).toEqual([true, false])
    }
  })

  /* the stored reply carries the whole question; the desktop draws it once, on the card */
  test('on the desktop the reply draws without the question\'s block under its card; the stored reply and the terminal keep it, and a reply without the block draws whole', async ($: any, on: any) => {
    const w = world(on)
    on('ui.render', { component: 'AssistantMessage' }, ($: any, e: any) => ({ type: 'Box', props: { key: 'engine-reply' },
      children: [{ type: 'Text', props: {}, children: [e.props.text] }] }))
    await start($, w)
    await $.turn.start({ text: 'work', turnId: 't9' })
    const asked = await $.tool.call({ tool: ASK, tool_use_id: 'tu-9', name: 'store shape', ask: ASKED, gist: 'g', blocking: true,
      crux: 'Two writers at once.', options: OPTIONS, pick: 'b' })
    /* the reply pastes the block the result hands back; lines it put inside the block go with it */
    const block = String(asked.result).split('exactly, once:\n\n')[1].replace('Two writers', '- **Stakes:** a lost write\nTwo writers')
    /* the block goes in the footer, under its label */
    const full = ['Body before.', '', HAND + ' **Needs you:** ' + block].join('\n')
    await replyRow($, 'msg-9', full)
    await w.clock.settle()
    /* the footer draws under the last card, the last thing in the reply, at every width */
    const order = async (ui: any) => (await ui.find({ key: 'askerdo-reply' }))!.children.map((c: any) => String(c.props.key).replace(/^telling-.*/, 'card'))
    const footer = async (ui: any) => String((await ui.find({ key: 'askerdo-reply-foot-text' }))?.props.text)
    const drawn = async (surface: string, id: string, text: string, px?: number) => {
      const ui = await mountReply($, surface, id, text, px ? { columns: Math.floor(px / 7.8), rows: 40 } : undefined)
      const r = { text: String((await ui.find({ key: 'engine-reply' }))?.text), card: !!(await ui.find({ key: 'qhead-Q512' })),
        order: surface === 'desktop' ? await order(ui) : [], footer: await footer(ui) }
      await ui.unmount()
      return r
    }
    for (const px of [238, 438, 900, 1400]) {
      const desk = await drawn('desktop', 'msg_09-t0', full, px)
      expect([desk.card, desk.order]).toEqual([true, ['engine-reply', 'card', 'askerdo-reply-foot']])
      expect([desk.text.includes('Body before.'), desk.text.includes('Needs you'), desk.text.includes('512a'), desk.text.includes('Crux'), desk.text.includes('Stakes')]).toEqual([true, false, false, false, false])
      expect([desk.footer.includes('Needs you'), /\bQ512\b/.test(desk.footer), desk.footer.includes('512a')]).toEqual([true, true, false])
    }
    expect(JSON.stringify(w.appends)).toContain('|512b *|many files|')
    expect((await drawn('terminal', 'msg-9', full)).text).toBe(full)
    /* a reply whose block is not found: the card beside the text, whole */
    await $.turn.start({ text: 'work', turnId: 't10' })
    await $.tool.call({ tool: ASK, tool_use_id: 'tu-10', name: 'store shape', ask: ASKED, gist: 'g', blocking: true, options: OPTIONS, pick: 'b' })
    await replyRow($, 'msg-10', 'Pick 513a or 513b, on the card.')
    await turnEnd($, 't10')
    await w.clock.settle()
    expect((await drawn('desktop', 'msg_10-t0', 'Pick 513a or 513b, on the card.')).text).toBe('Pick 513a or 513b, on the card.')
    /* an override request's block hides the same way under its slim card, on the desktop only;
       Allow on the card decides it as the user's act through the band's press path */
    await $.turn.start({ text: 'work', turnId: 't11' })
    const ov = await $.tool.call({ tool: 'mcp__askerdo__override_request', tool_use_id: 'tu-11', kind: 'fix', record: 'K-3', body: 'The port is 17480.',
      summary: 'Fix the port an import wrote wrong', reason: 'the import cut a digit' })
    const said = ['Found a bad port.', '', ov.result.split('\n\n')[1], '', 'Back to the build after your answer.'].join('\n')
    await replyRow($, 'msg-11', said)
    await w.clock.settle()
    const ovDesk = await mountReply($, 'desktop', 'msg_11-t0', said)
    const deskText = String((await ovDesk.find({ key: 'engine-reply' }))?.text)
    expect([deskText.includes('Found a bad port.'), deskText.includes('Back to the build'), deskText.includes('allow K-3')]).toEqual([true, true, false])
    expect([(await ovDesk.find({ key: 'ovsummary-3' }))?.text, !!(await ovDesk.find({ key: 'ovlink-3' }))]).toEqual(['Fix the port an import wrote wrong', true])
    /* a one-field fix shows the words now and what they become under the summary */
    const words = [(await ovDesk.find({ key: 'ovnowwords-3' }))?.text, (await ovDesk.find({ key: 'ovbecomeswords-3' }))?.text]
    expect([words[0]?.includes('1748.'), words[1]?.includes('17480.')]).toEqual([true, true])
    await ovDesk.press({ key: 'ovpress-allow-3' })
    await w.clock.settle()
    expect(w.verbs.at(-1)).toEqual({ name: 'overrideDecide', body: { input: { request: 3, decision: 'allow' }, user: 'sess-1' } })
    expect((await ovDesk.find({ key: 'ovstate-3' }))?.text).toContain('Allowed')
    expect(await ovDesk.find({ key: 'ovpress-keep-3' })).toBeUndefined()
    await ovDesk.unmount()
    expect((await drawn('terminal', 'msg-11', said)).text).toBe(said)
    /* two asks told in one footer: one line names both, under the second card */
    await $.turn.start({ text: 'work', turnId: 't12' })
    const pair = [] as string[]
    for (const tu of ['tu-12', 'tu-13']) {
      const r = await $.tool.call({ tool: ASK, tool_use_id: tu, name: 'store shape', ask: ASKED, gist: 'g', blocking: false, options: OPTIONS, pick: 'b' })
      pair.push(String(r.result))
    }
    const ids = pair.map((r) => /Registered (Q\d+)/.exec(r)![1])
    const both = ['Body.', '', HAND + ' **Needs you:**', '', ...pair.map((r) => r.split('exactly, once:\n\n')[1] + '\n'), 'Then the release.'].join('\n')
    await replyRow($, 'msg-12', both)
    await w.clock.settle()
    for (const px of [238, 438, 900, 1400]) {
      const two = await mountReply($, 'desktop', 'msg_12-t0', both, { columns: Math.floor(px / 7.8), rows: 40 })
      const foot = await footer(two)
      expect([await order(two), ids.map((id) => new RegExp('\\b' + id + '\\b').test(foot)), foot.includes('Then the release'),
        /\b5\d\d[ab]\b/.test(foot), String((await two.find({ key: 'engine-reply' }))?.text)]).toEqual([['engine-reply', 'card', 'card', 'askerdo-reply-foot'], [true, true], true, false, 'Body.'])
      expect(foot.split('\n').filter((l) => ids.some((id) => l.includes(id))).length).toBe(1)
      await two.unmount()
    }
  })

  test('a reply with no ask in its turn keeps the engine\'s own drawing', async ($: any, on: any) => {
    const w = world(on)
    engineReply(on)
    await start($, w)
    await $.turn.start({ text: 'work', turnId: 't8' })
    await replyRow($, 'msg-x')
    const ui = await mountReply($, 'desktop', 'msg-x')
    expect(await ui.find({ key: 'askerdo-reply' })).toBeUndefined()
    expect(await ui.find({ key: 'engine-reply' })).toBeDefined()
  })

  /* the card never draws under the status line and then jumps */
  test('the card draws once, under the later reply that carries its block, never the asking row; a turn whose replies never carry it draws it under its last reply once it ends', async ($: any, on: any) => {
    const w = world(on)
    engineReply(on)
    await start($, w)
    const card = async (id: string, text: string) => {
      const ui = await mountReply($, 'terminal', id, text)
      const r = !!(await ui.find({ key: 'qhead-Q512' })) || !!(await ui.find({ key: 'qhead-Q513' }))
      await ui.unmount()
      return r
    }
    await $.turn.start({ text: 'work', turnId: 't12' })
    await replyRow($, 'msg-ask', 'Asking about the store.')
    const asked = await $.tool.call({ tool: ASK, tool_use_id: 'tu-12', name: 'store shape', ask: ASKED, gist: 'g', blocking: true, options: OPTIONS, pick: 'b' })
    await w.clock.settle()
    expect(await card('msg-ask', 'Asking about the store.')).toBe(false)
    const told = 'Here it is.\n\n' + String(asked.result).split('exactly, once:\n\n')[1]
    await replyRow($, 'msg-told', told)
    await replyRow($, 'msg-after', 'Carrying on.')
    await turnEnd($, 't12')
    await w.clock.settle()
    expect([await card('msg-ask', 'Asking about the store.'), await card('msg-told', told), await card('msg-after', 'Carrying on.')]).toEqual([false, true, false])
    /* no reply carries the block: nothing mid-turn, then the turn's last reply */
    await $.turn.start({ text: 'work', turnId: 't13' })
    await $.tool.call({ tool: ASK, tool_use_id: 'tu-13', name: 'port pick', ask: ASKED, gist: 'g', blocking: true, options: OPTIONS, pick: 'a' })
    await replyRow($, 'msg-plain', 'Over to you.')
    await w.clock.settle()
    expect(await card('msg-plain', 'Over to you.')).toBe(false)
    await turnEnd($, 't13')
    await w.clock.settle()
    expect(await card('msg-plain', 'Over to you.')).toBe(true)
  })
})

describe('the mod section', () => {
  test('with saved options the section rides an engaged session\'s prompt whatever the surfaces read, the session\'s one per-surface section beside it', async ($: any, on: any) => {
    const w = checked(on)
    w.contract.surfaces = { desktop: 'desktop rules', terminal: 'terminal rules' }
    await start($, w)
    const side = (r: any) => r.sections.filter((s: any) => s.id === PLUGIN + ':surface').map((s: any) => s.text.split('\n').pop())
    for (const surface of SURFACES) {
      const r = await compose($, [surface])
      const band = r.sections.find((s: any) => s.id === PLUGIN + ':band')
      expect([band.scope, band.text.endsWith('The mod section: writes no names line.')]).toEqual(['session', true])
      expect(side(r)).toEqual([surface + ' rules'])
    }
    /* a terminal with the desktop attached takes the stricter one; the desktop's session server says desktop */
    expect(side(await compose($, ['terminal', 'desktop']))).toEqual(['terminal rules'])
    expect(side(await compose($, ['terminal', 'desktop'], ['mcp__ccd_session__mark_chapter']))).toEqual(['desktop rules'])
    /* a desktop session another session started reads no surface; engaged, it
       still gets the section, the desktop's by its tools, else the stricter terminal one; the
       phone alone draws no band, so a section of its own keeps the names line there */
    const keeps = (r: any) => r.sections.some((s: any) => s.id === PLUGIN + ':no-band' && /names line/.test(s.text))
    for (const [on, tools, rules, names] of [[[], ['mcp__ccd_session__mark_chapter'], 'desktop rules', false], [[], [], 'terminal rules', false],
      [['mobile'], [], 'terminal rules', true]] as any[]) {
      const r = await compose($, on, tools)
      expect(r.sections.map((s: any) => s.id)).toContain(PLUGIN + ':band')
      expect([side(r), keeps(r)]).toEqual([[rules], names])
    }
  })

  /* every session gets the rules; the mod's section only once it is engaged */
  test('a session not engaged composes the rules block and no mod section; once engaged, both', async ($: any, on: any) => {
    const w = checked(on)
    w.rules = RULES
    w.tracks[0].session = undefined
    await start($, w)
    const ids = async () => (await compose($, ['desktop'])).sections.map((s: any) => s.id).filter((id: string) => id !== PLUGIN + ':as-of')
    expect(await ids()).toEqual(['intro', PLUGIN + ':rules'])
    await $.prompt.submit({ text: 'what about Q106?' })
    expect(await ids()).toEqual(['intro', PLUGIN + ':band', PLUGIN + ':rules'])
  })

  /* a plain session keeps its questions until the user engages it */
  test('a plain session keeps its question as L1, answered from the band or, typed, by the session through the answer tool with no CLI call; /askerdo files both with their answers and the next prompt tells the labels', async ($: any, on: any) => {
    const w = world(on)
    w.tracks[0].session = undefined
    await start($, w)
    await $.turn.start({ text: 'work', turnId: 't1' })
    const r = await $.tool.call({ tool: ASK, tool_use_id: 'tu-1', name: 'store shape', ask: ASKED, gist: 'One or many?', blocking: true, options: OPTIONS, pick: 'b' })
    expect(r.result).toContain('L1b')
    /* a kept question rewords in place, keeping L1 */
    const three = [...OPTIONS, { type: 'c', option: 'a table', getsYou: 'queries', costsYou: 'a server' }]
    const re = await $.tool.call({ tool: ASK, tool_use_id: 'tu-1r', edits: 'L1', name: 'store shape', ask: ASKED, gist: 'One, many or a table?', blocking: true, options: three, pick: 'b' })
    expect(re.result).toContain('Reworded L1')
    await $.turn.complete({ answer: 'L1 waits.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    expect((await $.tool.call({ tool: 'Bash', command: 'node ~/.claude/askerdo/cli.mjs register --json < q.json' })).deny).toContain('ask tool')
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ key: 'answer-L1c' })).toBeDefined()
    await ui.press({ key: 'answer-L1b' })
    await w.clock.settle()
    /* the press is the user's act: this idle session starts one turn carrying it */
    expect(w.prompts.at(-1)).toContain('L1b')
    expect(await ui.find({ key: 'q-L1' })).toBeUndefined()
    await ui.unmount()
    await $.tool.call({ tool: ASK, tool_use_id: 'tu-2', name: 'lock', ask: ASKED, gist: 'g', blocking: false, options: OPTIONS, pick: 'a' })
    await $.tool.call({ tool: ASK, tool_use_id: 'tu-3', name: 'later', ask: ASKED, gist: 'g', blocking: false, options: OPTIONS, pick: 'a' })
    /* a typed token goes to the session, which records each with the answer tool */
    await $.prompt.submit({ text: 'L2a' })
    expect((await $.tool.call({ tool: 'mcp__askerdo__answer', id: 'L2', pick: 'a' })).result).toContain('L2a')
    expect(w.cliRuns().filter((x: any) => ['register', 'answer'].includes(x.args[0]))).toEqual([])
    await $.command.run({ command: 'askerdo', args: 'board' })
    await w.clock.settle()
    const regs = w.cliRuns().filter((x: any) => x.args[0] === 'register').map((x: any) => JSON.parse(x.stdin))
    expect(regs.map((p: any) => [p.name, p.session, p.pick, p.options.length])).toEqual([['store shape', 'sess-1', 'b', 3], ['lock', 'sess-1', 'a', 2], ['later', 'sess-1', 'a', 2]])
    expect(w.cliRuns().filter((x: any) => x.args[0] === 'answer').map((x: any) => x.args.join(' '))).toEqual([
      'answer Q512 --pick b --session sess-1 --json', 'answer Q513 --pick a --session sess-1 --json'])
    await $.prompt.submit({ text: 'go on' })
    expect(w.prompts.at(-1)).toContain('L1 is now Q512 on the board')
    /* a typed label after filing answers its board question */
    await $.tool.call({ tool: 'mcp__askerdo__answer', id: 'L3', pick: 'b' })
    expect(w.last('answer Q514').args).toEqual(expect.arrayContaining(['b', '--session']))
  })
})

describe('the reply checks (flag, never rewrite)', () => {
  test('an em dash gets a dim note under the reply and a note the model reads (acceptance 5)', async ($: any, on: any) => {
    const w = checked(on)
    await start($, w)
    await compose($, ['terminal'])
    await reply($, OK + ' ' + GREEN + ' **Shipped** \u2014 the band is in.')
    expect(flags(w)).toEqual(['AskerDo: this reply: em or en dashes. Flagged, not rewritten.'])
    expect(notes(w).length).toBe(1)
    expect(notes(w)[0]).toContain('your last reply: em or en dashes')
  })

  /* work with no task in hand never reaches the track; a take in hand later in the turn clears it */
  test('a turn that dispatches with no task in hand gets the off-track slip; one that takes a task in hand does not', async ($: any, on: any) => {
    const w = checked(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    on('tool.call', { tool: 'Skill' }, () => ({ result: 'loaded' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran' }))
    await start($, w)
    const turn = async (id: string, take: boolean, first?: any) => {
      await $.turn.start({ text: 'work', turnId: id })
      if (first) await $.tool.call(first)
      await $.tool.call({ tool: 'Agent', description: 'the fixer', prompt: 'Fix the band.' })
      if (take) await $.tool.call({ tool: 'mcp__askerdo__task_update', id: 'T-41', inHand: true })
      await $.turn.complete({ answer: OK + ' **Dispatched** the fixer.', durationMs: 5, isAborted: false, turnId: id, reason: 'answer' })
    }
    await turn('t1', false)
    expect(notes(w).length).toBe(1)
    expect(notes(w)[0]).toContain('agent dispatch with no task in hand')
    expect(notes(w)[0]).toContain('TR-3')
    await turn('t2', true)
    expect(notes(w).length).toBe(1)
    /* an onboarding run keeps its mark past its first turn though the session holds TR-3, until its report */
    await turn('t3', false, { tool: 'Skill', skill: 'askerdo:onboard' })
    await turn('t4', false)
    expect(notes(w).length).toBe(1)
    await turn('t5', false, { tool: 'Bash', command: 'node ~/.claude/askerdo/cli.mjs proc ran onboard-a-project clean --note "done"' })
    expect(notes(w).length).toBe(2)
  })

  test('a clean reply with an empty set draws no names line and gets no note (acceptance 5)', async ($: any, on: any) => {
    const w = checked(on)
    w.questions = []
    w.tracks[0].session = undefined
    await start($, w)
    await compose($, ['desktop'])
    await reply($, OK + ' ' + GREEN + ' **Shipped**\n\nThe band is in.\n\n' + GREEN + ' Next up: the review.')
    expect(flags(w)).toEqual([])
    expect(notes(w)).toEqual([])
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ key: 'needs-you' })).toBeUndefined()
  })

  test('a names line, or a remark that none are open, is flagged where the band draws only', async ($: any, on: any) => {
    const w = checked(on)
    await start($, w)
    await compose($, ['terminal'])
    await reply($, OK + ' **Done**\n\nNo open questions right now.')
    expect(flags(w)[0]).toContain('a names line or a remark about open questions')
    await compose($, ['mobile'])
    await reply($, OK + ' **Done**\n\n\u2753 **[1 open question](http://b)**: [Q106 store shape](http://b/q)', 't2')
    expect(flags(w).length).toBe(1)
    /* a desktop window not attached composes with no surface, though the band draws there */
    await (await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })).unmount()
    await compose($, [])
    await reply($, OK + ' **Done**\n\n\u2753 **[1 open question](http://b)**: [Q106 store shape](http://b/q)', 't3')
    expect(flags(w).length).toBe(2)
  })

  test('a footer that disagrees with line 1 is flagged; so is a line 1 that promises a footer with none under it, and a glyph in the wrong slot', async ($: any, on: any) => {
    const w = checked(on, { ...CHECKS, weather: true })
    await start($, w)
    await reply($, OK + ' ' + SUN + ' ' + GREEN + ' **Run r06 passed** for T-304\n\n' + HAND + ' Needs you: go on the review?')
    expect(flags(w)[0]).toContain('disagrees with line 1')
    /* hand, sun, hand, its question unlabeled and with no footer */
    await reply($, HAND + ' ' + SUN + ' ' + HAND + ' **Store shape**\n\nOne file or many?\n\n|Option|What happens|\n|-|-|\n|a|one file|', 't2')
    expect(flags(w)[1]).toContain('promises a labeled footer')
    expect(flags(w)[1]).toContain('in the status slot')
  })

  /* a handoff waits for the meter's window or the user's ask */
  test('a close by handoff below the window, unasked, is flagged; after the window note it is not', async ($: any, on: any) => {
    const w = checked(on)
    await start($, w)
    const close = OK + ' ' + FLAG + ' **Handed off**\n\n```\nResume thread TR-3 (mod core) from handoff TR-3.2\n```\n\n'
      + FLAG + ' Done. The kickoff above is the go.'
    /* a fenced resume of another session's track is no close of this one; one of the track it holds is */
    const step = (tr: string) => OK + ' ' + GREEN + ' **Step 2 is ready**\n\nThe test session takes its handoff with:\n\n```\n/askerdo resume ' + tr
      + '\n```\n\n' + GREEN + ' Next up: its kickoff.'
    await reply($, step('TR-4'), 't0')
    expect(flags(w)).toEqual([])
    await reply($, step('TR-3'), 't0b')
    expect(flags(w).length).toBe(1)
    await reply($, close)
    expect(flags(w)[1]).toContain('an early handoff')
    await $.session.measure({ context: { window: 1000000, percent: 31, tokens: 310000 }, rateLimits: [], changed: ['context'] })
    await w.clock.settle()
    await reply($, close, 't2')
    expect(flags(w).length).toBe(2)
  })

  /* a handoff close hands the user the resume command alone in a copy block */
  test('a reply after a handoff write without the block its result hands is flagged; with the block it is not', async ($: any, on: any) => {
    const w = checked(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran' }))
    await start($, w)
    await $.session.measure({ context: { window: 1000000, percent: 31, tokens: 310000 }, rateLimits: [], changed: ['context'] })
    await w.clock.settle()
    const close = async (id: string, answer: (block: string) => string) => {
      await $.turn.start({ text: 'work', turnId: id })
      const r = await $.tool.call({ tool: 'mcp__askerdo__handoff_write', track: 'TR-3', focus: 'next', state: 'Done.', verifyFirst: [{ path: 'C:/src/proj' }] })
      await $.turn.complete({ answer: answer(r.result.slice(r.result.indexOf('\u2b07'))), durationMs: 5, isAborted: false, turnId: id, reason: 'answer' })
    }
    await close('t1', () => OK + ' ' + FLAG + ' **Handed off**: resume with /askerdo resume TR-3.\n\n' + FLAG + ' Done.')
    expect(flags(w)[0]).toContain('/askerdo resume TR-3')
    await close('t2', (block) => OK + ' ' + FLAG + ' **Handed off**\n\n' + block + '\n\n' + FLAG + ' Done.')
    expect(flags(w).length).toBe(1)
    /* a turn that changes state past the handoff is told at that step to update it,
       and flagged at its end when it did not; one that called handoff_update, or only read, is not */
    const went = async (id: string, ops?: any[], command = 'git commit -m "x" -- a') => {
      await $.turn.start({ text: 'one more thing', turnId: id })
      await $.tool.call({ tool: 'Bash', command })
      if (ops) expect((await $.tool.call({ tool: 'mcp__askerdo__handoff_update', ops })).result).toContain('TR-3.5')
      await $.turn.complete({ answer: OK + ' **Kept going**\n\n' + FLAG + ' Done.', durationMs: 5, isAborted: false, turnId: id, reason: 'answer' })
    }
    const told = () => w.appends.filter((m: any) => m.type === 'user' && /^AskerDo: .*TR-3\.5.*handoff_update/.test(String(m.content[0].text))).length
    const stale = () => flags(w).filter((f: string) => f.includes('TR-3.5') && f.includes('handoff_update')).length
    await went('t2r', undefined, 'git status')
    expect([told(), stale()]).toEqual([0, 0])
    await went('t3')
    expect([told(), stale()]).toEqual([1, 1])
    await went('t4', [{ op: 'whereWeWere', line: 'The user asked one more thing.' }])
    expect([told(), stale()]).toEqual([2, 1])
    /* seen on the shelf, then resumed by another session: no more notes or flags */
    w.shelf.push({ track: 'TR-3', handoff: 'TR-3.5', name: 'mod core', state: 'waiting', age: '0m', focus: 'next' })
    w.marker += '+'
    await w.clock.advance(15000)
    await w.clock.settle()
    await went('t5')
    expect([told(), stale()]).toEqual([3, 2])
    w.shelf.splice(w.shelf.findIndex((s: any) => s.track === 'TR-3'), 1)
    w.marker += '+'
    /* the handed-off band is frozen until the user types in this session again */
    await $.prompt.submit({ text: 'one more thing' })
    await w.clock.settle()
    await went('t6')
    expect([told(), stale()]).toEqual([3, 2])
  })

  test('without saved options nothing is checked', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    await reply($, 'An em dash \u2014 here.')
    expect(flags(w)).toEqual([])
    expect(notes(w)).toEqual([])
  })
})

describe('the Agent-call checks', () => {
  /* each check by its profile key; the size rule only while the injection is off */
  test('with rules in force, a brief with no state note and no size rule is flagged and still dispatched', async ($: any, on: any) => {
    const w = checked(on)
    w.rules = { ...RULES, inject: false, values: { ...RULES.values, 'dispatch.stateNote': true, 'dispatch.outputRule': true } }
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    await start($, w)
    await $.turn.start({ text: 'work', turnId: 't1' })
    const r = await $.tool.call({ tool: 'Agent', description: 'the fixer', prompt: 'Fix the band.', model: 'fable' })
    expect(r.result).toBe('spawned')
    expect(flags(w)[0]).toBe('AskerDo: the dispatch of the fixer: the brief names no -state.md note; '
      + 'the brief has no output-size rule. Flagged, not rewritten.')
    await $.turn.complete({ answer: OK + ' **Dispatched** the fixer.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(notes(w)[0]).toContain('the dispatch of the fixer: the brief names no -state.md note')
  })

  test('a brief naming its state note and a size rule passes clean', async ($: any, on: any) => {
    const w = checked(on)
    w.rules = RULES
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    await start($, w)
    await $.tool.call({ tool: 'Agent', description: 'the fixer', model: 'opus',
      prompt: 'Keep docs/state/fix-state.md current. Final response under 2000 characters.' })
    expect(flags(w)).toEqual([])
  })

  /* a user with no board has no rules in force, so no dispatch checks */
  test('with no rules in force, a dispatch raises no flag', async ($: any, on: any) => {
    const w = checked(on)
    /* a task in hand, so the off-track check stays out of this one */
    w.hand = [{ id: 'T-41', name: 'wire it' }]
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    await start($, w)
    await $.turn.start({ text: 'work', turnId: 't1' })
    const r = await $.tool.call({ tool: 'Agent', description: 'the fixer', prompt: 'Fix the band.' })
    expect(r.result).toBe('spawned')
    await $.turn.complete({ answer: OK + ' **Dispatched** the fixer.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(flags(w)).toEqual([])
    expect(notes(w)).toEqual([])
  })

  test('a brief file the prompt names is read, and its line against a rule in force is flagged', async ($: any, on: any) => {
    const w = checked(on)
    w.rules = RULES
    /* the repo CLAUDE.md's golden-fixture line pins bytes by design and is no hit */
    w.fsRead = (path: string) => (path.endsWith('lane-brief.md') ? 'Write a test for each item.'
      + '\n- Any change to generated contract text requires regenerating the golden\n  fixtures, which pin exact bytes: use the case configs from' : '')
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    await start($, w)
    await $.tool.call({ tool: 'Agent', description: 'the fixer', model: 'opus',
      prompt: 'Read docs/lane-brief.md. Keep docs/fix-state.md current. Final response under 2000 characters.' })
    expect(flags(w).join(' ')).toContain('a test per item')
    expect(flags(w).join(' ')).not.toContain('tests.pinWording')
  })

  /* a lane that handed work on to another agent; its size taken at the agent's last step */
  test('a lane that hands work on is journaled on its task, and the next dispatch naming the task is flagged', async ($: any, on: any) => {
    const w = checked(on)
    w.rules = RULES
    w.tasks = [{ id: 'T-7', kind: 'task', name: 'the fix', status: 'in_progress', journal: '' }]
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    on('agent.spawn', () => ({ model: 'opus', agentId: 'a1' }))
    await start($, w)
    const brief = { description: 'Fix lane 3', model: 'opus', prompt: 'T-7: keep docs/fix-state.md current. Final response under 2000 characters.' }
    await $.tool.call({ tool: 'Agent', tool_use_id: 'tu-1', ...brief })
    expect(flags(w)).toEqual([])
    await $.agent.spawn({ ...brief, tool_use_id: 'tu-1' })
    w.stepUsage.a1 = { input_tokens: 5000, cache_read_input_tokens: 450000, cache_creation_input_tokens: 0, output_tokens: 10 }
    const s = $.turn.step({ turnId: 't-a1', index: 0, model: 'm', messageCount: 3, agentId: 'a1' })
    for await (const _ of s) { /* drained */ }
    await s.result
    await $.turn.complete({ answer: 'Leg 1 done.\nCONTINUE: docs/fix-state.md', durationMs: 5, isAborted: false, turnId: 't-a1', reason: 'answer', agentId: 'a1' })
    await w.clock.settle()
    expect(w.tasks[0].journal).toContain('455k')
    await $.tool.call({ tool: 'Agent', tool_use_id: 'tu-2', ...brief })
    expect(flags(w).join(' ')).toContain('T-7 handed its work on')
  })

  /* with no rules in force the dispatch join still holds, so a subagent's commit links to its task */
  test("a subagent's commit with no rules in force is linked to its dispatch's task", async ($: any, on: any) => {
    const w = world(on)
    const SHA = 'a'.repeat(40)
    const US = String.fromCharCode(31), RS = String.fromCharCode(30)
    w.git = (argv: string[]) => {
      const sub = argv.slice(3).find((a: string) => !a.startsWith('-') && !a.includes('='))
      if (sub === 'rev-parse' && argv.includes('HEAD^{commit}')) return { exitCode: 0, stdout: 'C:/src/proj\nC:/src/proj/.git\n' + SHA + '\n', stderr: '' }
      if (sub === 'show') return { exitCode: 0, stdout: [SHA, 'b'.repeat(40), '2026-11-04T10:00:00-05:00', 'fix the band'].join(US) + RS
        + '\n\n12\t3\tlib/band.mjs\n40\t0\tpackage-lock.json\n', stderr: '' }
      if (sub === 'config') return { exitCode: 0, stdout: 'remote.origin.url https://github.com/example/proj.git\n', stderr: '' }
      return { exitCode: 1, stdout: '', stderr: '' }
    }
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'no sha line here', stderr: '', interrupted: false } }))
    on('agent.spawn', () => ({ model: 'opus', agentId: 'a1' }))
    await start($, w)
    const brief = { description: 'Band lane', model: 'opus', prompt: 'T-9: fix the band.' }
    await $.tool.call({ tool: 'Agent', tool_use_id: 'tu-1', ...brief })
    await $.agent.spawn({ ...brief, tool_use_id: 'tu-1' })
    await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't-a1', reason: 'answer', agentId: 'a1' })
    await $.tool.call({ tool: 'Bash', command: 'git commit -am "fix the band"', agentId: 'a1' })
    await w.clock.settle()
    const links = w.verbs.filter((v: any) => v.name === 'commitLink').map((v: any) => v.body.input)
    expect(links.length).toBe(1)
    expect([links[0].task, links[0].via, links[0].sha, links[0].repo]).toEqual(['T-9', 'agent', SHA, 'github.com/example/proj'])
    expect([links[0].added, links[0].removed]).toEqual([12, 3])
  })
})

const RULES = {
  record: 'TR-3', inject: true, revision: 'r1', text: 'Rules in force (AskerDo rev r1, for TR-3):\n- Few tests. [built in]',
  values: { 'tests.policy': 'few', 'tests.fullRun': 'end', 'tests.pinWording': false },
}

describe('the rules in force', () => {
  function spawning(on: any, rules: any, top?: any) {
    const w = world(on)
    w.rules = rules
    w.spawned = [] as string[]
    on('agent.spawn', ($: any, e: any) => { w.spawned.push(e.prompt); return { model: 'opus', agentId: 'a' + w.spawned.length } })
    /* the engine's shape: its context_management section is answered through prompt.section and
       kept until prompt.section is invalidated, the one change its recorded system prompt takes */
    const kept: { text?: string } = {}
    on('ui.invalidate', ($: any, e: any, next: any) => { if (e.event === 'prompt.section') kept.text = undefined; return next(e) })
    on('prompt.section', ($: any, e: any) => ({ text: e.text }))
    on('prompt.compose', async () => {
      if (kept.text === undefined) kept.text = (await top.prompt.section({ name: 'context_management', text: 'core context' })).text
      return { sections: [{ id: 'intro', text: 'core', scope: 'shared' }, { id: 'context_management', text: kept.text, scope: 'session' }] }
    })
    return w
  }
  const carried = async ($: any, surfaces: string[]) => {
    const r = await compose($, surfaces)
    expect(r.sections.map((s: any) => s.id)).toEqual(['intro', 'context_management'])
    return r.sections[1].text
  }
  /* the latest as-of time a text carries */
  const latest = (t: string) => (t.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g) || []).sort().at(-1)

  test('a dispatch gets the block appended once per revision, and the main session gets it too', async ($: any, on: any) => {
    const w = spawning(on, RULES, $)
    await start($, w)
    /* a thread resumed in a new process, its record from before */
    await $.classic.SessionStart({ source: 'resume' })
    await $.agent.spawn({ prompt: 'Fix the band.', description: 'fixer' })
    await $.agent.spawn({ prompt: 'Fix it.\n\n' + RULES.text, description: 'again' })
    expect(w.spawned[0]).toBe('Fix the band.\n\n' + RULES.text)
    /* the rules are resolved for the track the session holds */
    const read = w.runs.filter((r: any) => r.script.endsWith('/rules.mjs')).at(-1).args
    expect(read[read.indexOf('--track') + 1]).toBe('TR-3')
    expect(w.spawned[1].split('Rules in force').length).toBe(2)
    /* its first prompt carries the blocks; the first request's answer is core's, asked again once it went out */
    await $.prompt.submit({ text: 'go on' })
    const resumed = w.contexts.at(-1).join(' ')
    expect([resumed.includes('rev r1'), !!latest(resumed)]).toEqual([true, true])
    expect(await carried($, ['mobile'])).toBe('core context')
    await replyRow($, 'u-resumed', 'Going on.')
    const first = await carried($, ['mobile'])
    /* the same text keeps its as-of time, so the record does not churn */
    expect([first.includes('rev r1'), latest(first)]).toEqual([true, latest(resumed)])
    await w.clock.advance(5000)
    w.rules = { ...RULES, revision: 'r2', text: 'Rules in force (AskerDo rev r2, for T-13):\n- Few tests. [built in]' }
    await $.tool.call({ tool: 'mcp__askerdo__task_update', id: 'T-13', status: 'completed' })
    await $.agent.spawn({ prompt: 'Next.', description: 'after' })
    expect(w.spawned[2]).toContain('for T-13')
    /* a profile edit under a frozen band reaches the next prompt, sent or typed, and the next dispatch */
    await $.turn.start({ text: 'work', turnId: 't1' })
    await $.turn.complete({ answer: FLAG + ' Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.settle()
    w.rules = { ...RULES, revision: 'r3', text: 'Rules in force (AskerDo rev r3, for TR-3):\n- A line added. [yours]',
      agents: { revision: 'r3', text: 'Rules in force (AskerDo rev r3, for its agents):\n- A line added. [yours]' } }
    w.profilesAt = 2
    w.change()
    await w.clock.settle()
    await $.prompt.submit({ text: 'carry on', origin: { kind: 'peer' } })
    const text = await carried($, ['desktop'])
    expect([text.includes('A line added'), text.includes('rev r1')]).toEqual([true, false])
    /* the rewrite's block is the latest in view, above the resumed thread's context */
    expect(String(latest(text)) > String(latest(resumed))).toBe(true)
    await $.agent.spawn({ prompt: 'Then.', description: 'later' })
    expect(w.spawned[3]).toContain('rev r3, for its agents')
  })

  test('with dispatch.inject off a dispatch keeps its prompt as written', async ($: any, on: any) => {
    const w = spawning(on, { ...RULES, inject: false })
    await start($, w)
    await $.agent.spawn({ prompt: 'Fix the band.', description: 'fixer' })
    expect(w.spawned).toEqual(['Fix the band.'])
  })
})
