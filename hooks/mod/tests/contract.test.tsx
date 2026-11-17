/* The first telling drawn by the mod, the mod's contract section, the reply
 * and dispatch checks, and the board kept out of an unengaged session under `claude plugin test`, both surfaces. */
import { describe, expect, test } from 'claude-code/testing'
import { COLD_START, pressAgain, pressRow, start, twiceAtMost, world } from './world.ts'
import { GLYPHS, firstTellingCard, gridWidths } from '../../../lib/mod-core.mjs'

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

/* the output style as the engine's attachment carries it, its two per-surface sections at the end */
const STYLE = 'Rule one.\n\n### On the desktop app\n\nIntro.\n\n- a line\n- another\n\n### On the terminal and anywhere else\n\nIntro.\n\n- a line\n'

const compose = ($: any, surfaces: string[], tools: string[] = []) => $.prompt.compose({
  model: 'm', promptModel: 'm', surfaces, tools, outputStyle: null, traits: [],
})
/* the contract checks the model was told, once a call has carried what waits */
const notes = async ($: any, w: any) => {
  await w.step($)
  return w.told.filter((m: any) => !m.agentId && m.type === 'user'
    && String(m.content[0].text).startsWith('AskerDo contract check')).map((m: any) => m.content[0].text)
}
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
  test('the card draws under the turn\'s last reply, not on the ask tool\'s row: the pane\'s card, the pick starred', COLD_START, async ($: any, on: any) => {
    const w = world(on)
    engineReply(on)
    on('ui.render', { component: 'ToolResult' }, () => ({ type: 'Box', props: { key: 'engine-row' }, children: [] }))
    await start($, w)
    await $.turn.start({ text: 'work', turnId: 't1' })
    const r = await w.call($, { tool: ASK, tool_use_id: 'tu-1', name: 'store shape', ask: ASKED, gist: 'One or many?', blocking: true,
      crux: 'Two writers at once.', stakes: 'A migration later.', options: OPTIONS, pick: 'b' })
    expect(r.result).toContain('Registered Q512')
    /* a reversal beside another ask of the turn keeps its marker and raises no flag */
    const second = await w.call($, { tool: ASK, tool_use_id: 'tu-2', name: 'back to one file', ask: ASKED, gist: 'g', blocking: true,
      revisits: ['Q500'], reversal: 'Two machines write now.', options: OPTIONS, pick: 'b' })
    expect(second.deny).toBeUndefined()
    expect(second.result).toContain('Reversal of Q500')
    expect(second.result).not.toContain('Q512')
    await replyRow($, 'msg-1')
    await replyRow($, 'msg-2', 'And one more thing.')
    /* a reply on screen before its card is placed draws the card when the turn ends */
    const onScreen = await mountReply($, 'desktop', 'msg-2', 'And one more thing.')
    expect(await onScreen.find({ key: 'qhead-Q512' })).toBeUndefined()
    await turnEnd($, 't1')
    await w.clock.settle()
    /* the model's telling is passive, so the card lands at the once a second gate */
    await w.clock.advance(1000)
    await w.clock.settle()
    expect((await onScreen.find({ key: 'qhead-Q512' }))?.text).toContain('store shape')
    await onScreen.unmount()
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
    const re = await w.call($, { tool: ASK, tool_use_id: 'tu-3', edits: 'Q512', name: 'store shape', ask: 'One file (a), many (b) or a table (c, my pick)?',
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
  test('a slot unfolds on a press, and Pick answers through the CLI and marks the card answered; an answer or drop made elsewhere reaches the card at the band\'s next load', { timeoutMs: 15000 }, async ($: any, on: any) => {
    const w = world(on)
    for (const id of ['Q512', 'Q513', 'Q514']) w.questions.push({ id, name: 'store shape', blocking: true, workstream: 'WS-11', options: OPTIONS, pick: 'b' })
    engineReply(on)
    await start($, w)
    await $.turn.start({ text: 'work', turnId: 't2' })
    for (const tu of ['tu-2', 'tu-3', 'tu-4']) {
      await w.call($, { tool: ASK, tool_use_id: tu, name: 'store shape', ask: ASKED, gist: 'One or many?', blocking: true, options: OPTIONS, pick: 'b' })
    }
    await replyRow($, 'msg-2')
    await turnEnd($, 't2')
    await w.clock.settle()
    const ui = await mountReply($, 'terminal', 'msg-2')
    await ui.press({ key: 'unfold-512b' })
    expect((await ui.find({ key: 'slot-512b-headline' }))?.text).toBe('Each record is its own file.')
    await ui.press({ key: 'pick-512b' })
    /* the reply's card answers through its strip too. Saving at the press, done once the write
       and its reload are in, and no surface asked more than twice */
    w.answerWait = 1000
    await ui.press({ key: 'qnow-Q512' })
    const saving = (await ui.find({ key: 'qdone-Q512' }))?.text
    await w.clock.advance(1000)
    await w.clock.settle()
    const cardDone = (await ui.find({ key: 'qdone-Q512' }))?.text
    w.answerWait = 0
    expect([saving?.includes(GLYPHS.pending), cardDone?.includes(GLYPHS.pending), cardDone?.includes('512b')]).toEqual([true, false, true])
    expect(w.last('answer').args.slice(0, 3)).toEqual(['answer', 'Q512', '--pick'])
    expect(w.last('answer').args[3]).toBe('b')
    expect(w.toasts.at(-1)).toContain('Answered Q512')
    expect((await ui.find({ key: 'qdone-Q512' }))?.text).toContain('512b')
    expect(await ui.find({ key: 'pick-512a' })).toBeUndefined()
    expect(twiceAtMost(await pressRow(w, 'answer', '512b'))).toBe(true)
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
    const r = await w.call($, { tool: ASK, tool_use_id: 'tu-7', name: 'store shape', ask: ASKED, gist: 'One or many?', blocking: true,
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
    /* answered five minutes after it was asked, two hours ago: the card keeps the age it settled with */
    const asked = Date.now() - 2 * 3600e3
    const q = { id: 'Q77', name: 'port pick', gist: 'Which port?', blocking: true, crux: 'Two services clash.',
      options: OPTIONS, pick: 'a', answered: '77a', created: new Date(asked).toISOString(), frozen: { at: asked + 5 * 60e3, here: { pc: '', track: '' } } }
    const w = world(on, { store: { told: { 'tu-old': q }, toldAt: { 'msg-old': ['tu-old'] } } })
    engineReply(on)
    for (const surface of SURFACES) {
      const ui = await mountReply($, surface, 'msg-old')
      expect((await ui.find({ key: 'qhead-Q77' }))?.text).toContain('port pick')
      expect((await ui.find({ key: 'qmeta-Q77' }))?.text).toMatch(/\b5m\b/)
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
        /* a second press before the redraw (a double click) neither shuts it again nor puts the key out of step */
        await Promise.all([ui.press({ key: 'unfold-77b' }), ui.press({ key: 'unfold-77b' })])
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
    const asked = await w.call($, { tool: ASK, tool_use_id: 'tu-9', name: 'store shape', ask: ASKED, gist: 'g', blocking: true,
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
    await w.call($, { tool: ASK, tool_use_id: 'tu-10', name: 'store shape', ask: ASKED, gist: 'g', blocking: true, options: OPTIONS, pick: 'b' })
    await replyRow($, 'msg-10', 'Pick 513a or 513b, on the card.')
    await turnEnd($, 't10')
    await w.clock.settle()
    expect((await drawn('desktop', 'msg_10-t0', 'Pick 513a or 513b, on the card.')).text).toBe('Pick 513a or 513b, on the card.')
    /* an override request's block hides the same way under its slim card, on the desktop only;
       the press named for its act (Fix here) decides it as the user's act through the band's press path */
    await $.turn.start({ text: 'work', turnId: 't11' })
    const ov = await w.call($, { tool: 'mcp__askerdo__override_request', tool_use_id: 'tu-11', kind: 'fix', record: 'K-3', body: 'The port is 17480.',
      summary: 'Fix the port an import wrote wrong', reason: 'the import cut a digit' })
    const said = ['Found a bad port.', '', ov.result.split('\n\n')[1], '', 'Back to the build after your answer.'].join('\n')
    await replyRow($, 'msg-11', said)
    await w.clock.settle()
    const ovDesk = await mountReply($, 'desktop', 'msg_11-t0', said)
    const deskText = String((await ovDesk.find({ key: 'engine-reply' }))?.text)
    expect([deskText.includes('Found a bad port.'), deskText.includes('Back to the build'), deskText.includes('fix K-3')]).toEqual([true, true, false])
    expect([(await ovDesk.find({ key: 'ovsummary-3' }))?.text, !!(await ovDesk.find({ key: 'ovlink-3' }))]).toEqual(['Fix the port an import wrote wrong', true])
    /* a one-field fix shows the words now and what they become under the summary */
    const words = [(await ovDesk.find({ key: 'ovnowwords-3' }))?.text, (await ovDesk.find({ key: 'ovbecomeswords-3' }))?.text]
    expect([words[0]?.includes('1748.'), words[1]?.includes('17480.')]).toEqual([true, true])
    expect([(await ovDesk.find({ key: 'ovpress-allow-3-face' }))?.text, (await ovDesk.find({ key: 'ovpress-keep-3-face' }))?.text].map((t) => String(t).trim())).toEqual(['Fix', 'Keep'])
    await ovDesk.press({ key: 'ovpress-allow-3' })
    await w.clock.settle()
    expect(w.verbs.at(-1)).toEqual({ name: 'overrideDecide', body: { input: { request: 3, decision: 'allow' }, user: 'sess-1' } })
    expect((await ovDesk.find({ key: 'ovstate-3' }))?.text).toContain('Fixed')
    expect(await ovDesk.find({ key: 'ovpress-keep-3' })).toBeUndefined()
    await ovDesk.unmount()
    expect((await drawn('terminal', 'msg-11', said)).text).toBe(said)
    /* two asks told in one footer: one line names both, under the second card */
    await $.turn.start({ text: 'work', turnId: 't12' })
    const pair = [] as string[]
    for (const tu of ['tu-12', 'tu-13']) {
      const r = await w.call($, { tool: ASK, tool_use_id: tu, name: 'store shape', ask: ASKED, gist: 'g', blocking: false, options: OPTIONS, pick: 'b' })
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
    const asked = await w.call($, { tool: ASK, tool_use_id: 'tu-12', name: 'store shape', ask: ASKED, gist: 'g', blocking: true, options: OPTIONS, pick: 'b' })
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
    await w.call($, { tool: ASK, tool_use_id: 'tu-13', name: 'port pick', ask: ASKED, gist: 'g', blocking: true, options: OPTIONS, pick: 'a' })
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

  /* the style is asked once, at a session's first request, before it engages */
  test('the engine\'s per-step style reminder is left out, and a session not engaged gets its surface section with the style\'s two cut, or keeps them with none', async ($: any, on: any) => {
    const w = checked(on)
    on('prompt.attachment', ($: any, e: any) => ({ text: e.text }))
    w.tracks[0].session = undefined
    w.contract.surfaces = { desktop: 'desktop rules', terminal: 'terminal rules' }
    await start($, w)
    const engine = { kind: 'engine' }
    const out = (await $.prompt.attachment({ type: 'output_style_instructions', text: STYLE, origin: engine })).text
    expect([out.includes('Rule one.'), out.includes('### On the'), out.includes('a line')]).toEqual([true, false, false])
    const ids = (await compose($, ['desktop'])).sections.map((s: any) => s.id)
    expect([ids.includes(PLUGIN + ':surface'), ids.includes(PLUGIN + ':band')]).toEqual([true, false])
    expect((await $.prompt.attachment({ type: 'output_style', text: 'askerdo output style is active.', origin: engine })).text).toBeNull()
  })

  /* every session gets the rules; the mod's section only once it is engaged */
  test('a session not engaged composes the rules block and no mod section; once engaged, both', async ($: any, on: any) => {
    const w = checked(on)
    w.rules = RULES
    w.tracks[0].session = undefined
    on('prompt.attachment', ($: any, e: any) => ({ text: e.text }))
    await start($, w)
    /* with no surface section to carry, the style keeps its two */
    expect((await $.prompt.attachment({ type: 'output_style_instructions', text: STYLE, origin: { kind: 'engine' } })).text).toBe(STYLE)
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
    const r = await w.call($, { tool: ASK, tool_use_id: 'tu-1', name: 'store shape', ask: ASKED, gist: 'One or many?', blocking: true, options: OPTIONS, pick: 'b' })
    expect(r.result).toContain('L1b')
    /* a kept question rewords in place, keeping L1 */
    const three = [...OPTIONS, { type: 'c', option: 'a table', getsYou: 'queries', costsYou: 'a server' }]
    const re = await w.call($, { tool: ASK, tool_use_id: 'tu-1r', edits: 'L1', name: 'store shape', ask: ASKED, gist: 'One, many or a table?', blocking: true, options: three, pick: 'b' })
    expect(re.result).toContain('Reworded L1')
    await $.turn.complete({ answer: 'L1 waits.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    expect((await w.call($, { tool: 'Bash', command: 'node ~/.claude/askerdo/cli.mjs register --json < q.json' })).deny).toContain('ask tool')
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ key: 'answer-L1c' })).toBeDefined()
    /* the chip opens the strip; its Answer now answers the kept label */
    await ui.press({ key: 'answer-L1b' })
    await ui.press({ key: 'qnow-L1' })
    await w.clock.settle()
    /* the press is the user's act: this idle session starts one turn carrying it */
    expect(w.prompts.at(-1)).toContain('L1b')
    expect(await ui.find({ key: 'q-L1' })).toBeUndefined()
    await ui.unmount()
    await w.call($, { tool: ASK, tool_use_id: 'tu-2', name: 'lock', ask: ASKED, gist: 'g', blocking: false, options: OPTIONS, pick: 'a' })
    await w.call($, { tool: ASK, tool_use_id: 'tu-3', name: 'later', ask: ASKED, gist: 'g', blocking: false, options: OPTIONS, pick: 'a' })
    /* a typed token goes to the session, which records each with the answer tool */
    await $.prompt.submit({ text: 'L2a' })
    expect((await w.call($, { tool: 'mcp__askerdo__answer', id: 'L2', pick: 'a' })).result).toContain('L2a')
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
    await w.call($, { tool: 'mcp__askerdo__answer', id: 'L3', pick: 'b' })
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
    expect((await notes($, w)).length).toBe(1)
    expect((await notes($, w))[0]).toContain('your last reply: em or en dashes')
  })

  /* work with no task in hand never reaches the track; a take in hand later in the turn clears it */
  test('a turn that dispatches with no task in hand gets the off-track slip; one that takes a task in hand does not', async ($: any, on: any) => {
    const w = checked(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    on('tool.call', { tool: 'Skill' }, () => ({ result: 'loaded' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran' }))
    on('agent.spawn', () => ({ model: 'opus', agentId: 'a-named' }))
    /* an agent task started before the mod (re)loaded, so only the board's view knows it */
    w.tracks[0].now = [{ id: 'T-41', agent: 'fixer' }]
    w.tracks[0].readySet = [{ id: 'T-42', agent: 'builder', word: { is: 'ready', next: 'settle', worker: 'agent', job: 'builder' }, progress: { done: 0, total: 2 } }]
    await start($, w)
    const turn = async (id: string, take: boolean, first?: any) => {
      await $.turn.start({ text: 'work', turnId: id })
      if (first) await w.call($, first)
      await w.call($, { tool: 'Agent', description: 'the fixer', prompt: 'Fix the band.' })
      if (take) await w.call($, { tool: 'mcp__askerdo__task_update', id: 'T-41', inHand: true })
      await $.turn.complete({ answer: OK + ' **Dispatched** the fixer.', durationMs: 5, isAborted: false, turnId: id, reason: 'answer' })
    }
    await turn('t1', false)
    expect((await notes($, w)).length).toBe(1)
    expect((await notes($, w))[0]).toContain('agent dispatch with no task in hand')
    expect((await notes($, w))[0]).toContain('TR-3')
    await turn('t2', true)
    expect((await notes($, w)).length).toBe(1)
    /* an onboarding run keeps its mark past its first turn though the session holds TR-3, until its report */
    await turn('t3', false, { tool: 'Skill', skill: 'askerdo:onboard' })
    await turn('t4', false)
    expect((await notes($, w)).length).toBe(1)
    await turn('t5', false, { tool: 'Bash', command: 'node ~/.claude/askerdo/cli.mjs proc ran onboard-a-project clean --note "done"' })
    expect((await notes($, w)).length).toBe(2)
    /* the sweep a track's finish offers dispatches its reader with no task; a grep for the word still flags */
    await turn('t5s', false, { tool: 'Bash', command: 'node ~/.claude/askerdo/cli.mjs sweep --track TR-39' })
    expect((await notes($, w)).length).toBe(2)
    await turn('t5g', false, { tool: 'Bash', command: 'grep -rn sweep skills/' })
    expect((await notes($, w)).length).toBe(3)
    /* a merge with no task held names the agent task it may land */
    await $.turn.start({ text: 'merge', turnId: 't6' })
    await w.call($, { tool: 'Bash', command: 'git merge lane-fixer' })
    await $.turn.complete({ answer: OK + ' **Merged** the fixer.', durationMs: 5, isAborted: false, turnId: 't6', reason: 'answer' })
    expect((await notes($, w))[3]).toContain('T-41')
    /* a task its agent left with steps open, closed with its merge, lands the work with no take */
    await $.turn.start({ text: 'settle', turnId: 't7' })
    await w.call($, { tool: 'Bash', command: 'git merge lane-builder' })
    await w.call($, { tool: 'mcp__askerdo__task_update', id: 'T-42', status: 'done' })
    await $.turn.complete({ answer: OK + ' **Closed** T-42.', durationMs: 5, isAborted: false, turnId: 't7', reason: 'answer' })
    expect((await notes($, w)).length).toBe(4)
    /* a dispatch whose spawn names its task shows on the track by its run, nothing in hand */
    const named = { tool: 'Agent', description: 'T-42 builder', prompt: 'T-42: build the band.' }
    await $.turn.start({ text: 'work', turnId: 't2n' })
    await w.call($, named)
    await $.agent.spawn({ ...named, tool_use_id: 'tu-named' })
    await $.turn.complete({ answer: OK + ' **Dispatched** the builder.', durationMs: 5, isAborted: false, turnId: 't2n', reason: 'answer' })
    expect((await notes($, w)).length).toBe(4)
    /* a commit beside this session's own agent run on a task is that lane's work */
    await $.turn.start({ text: 'commit', turnId: 't2c' })
    await w.call($, { tool: 'Bash', command: 'git commit -m "fix the band"' })
    await $.turn.complete({ answer: OK + ' **Committed** the fix.', durationMs: 5, isAborted: false, turnId: 't2c', reason: 'answer' })
    expect((await notes($, w)).length).toBe(4)
  })

  /* place files by its tier and an agent files nothing; a refusal nothing replaced in the turn is named at its end */
  test('place sends its tier and denies an agent; a refused filing left unfiled is named at the turn\'s end', async ($: any, on: any) => {
    const w = checked(on)
    const base = w.cli
    /* a filing last or off the track answers with what register returns */
    const FOUR = ['do it on this track', 'put it where asked', 'let\'s talk where it fits', 'drop it'].map((option, i) => ({ type: 'abcd'[i], option, getsYou: 'g' }))
    const asked = (id: string, name: string) => ({ id, key: id.toLowerCase() + 'key', name, ask: 'Where does it go: here (a) or where asked (b, my pick)?', track: 'TR-3' })
    for (const [id, name] of [['Q600', 'Sort the notes'], ['Q601', 'Tidy the docs'], ['Q602', 'Check the port'], ['Q603', 'A home for T-42']]) {
      w.questions.push({ ...asked(id, name), status: 'open', gist: 'found mid-task', options: FOUR, pick: 'b', blocking: false, labels: ['placement'] })
    }
    w.cli = (args: string[], stdin?: string, env?: any) => {
      const out = (v: any) => ({ exitCode: 0, stdout: JSON.stringify(v) + '\n', stderr: '' })
      if (args[0] === 'task' && args[1] === 'update' && args.includes('--leftovers')) {
        return out({ edit: { id: args[2], changed: ['status'] }, leftovers: [{ id: 'T-92', track: 'TR-3', tier: 2 }], steps: [{ step: 1, id: 'T-92' }, { step: 2, asked: asked('Q602', 'Check the port') }] })
      }
      /* a third wake through task edit answers under placed */
      if (args[0] === 'task' && args[1] === 'edit' && args.includes('--wake')) return out({ id: args[2], kind: 'task', changed: [], placed: { asked: asked('Q603', 'A home for ' + args[2]) } })
      if (args[0] !== 'task' || args[1] !== 'create') return base(args, stdin, env)
      const p = JSON.parse(stdin || '{}')
      if (p.last) return out({ asked: asked('Q600', p.name) })
      if (p.here) return out({ asked: asked('Q601', p.name) })
      if (p.track) {
        const last = '<why nothing on TR-3 needs it sooner>'
        const offers = [{ call: 'place', tier: 2, before: 'T-n', flags: '--tier 2 --before T-n' }, { call: 'place', tier: 2, last, flags: '--tier 2 --last "' + last + '"' }]
        const refused = { refused: "TR-3 is the track you hold, so the step is tier 2. The board's answer: tier 2 with before T-n (--tier 2 --before T-n); or tier 2 with last, a last resort (--tier 2 --last \"" + last + '").', offer: offers[0], offers }
        return { exitCode: 1, stdout: JSON.stringify(refused) + '\n', stderr: 'AskerDo: ' + refused.refused + '\n' }
      }
      return { exitCode: 0, stdout: JSON.stringify({ id: 'T-77', track: 'TR-3', tier: p.tier, ladder: { where: 'on TR-3 before T-50', filled: ['track', 'before'] } }) + '\n', stderr: '' }
    }
    await start($, w)
    const creates = () => w.cliRuns().filter((r: any) => r.args[0] === 'task' && r.args[1] === 'create')
    const agent = await w.call($, { tool: 'mcp__askerdo__place', agentId: 'a1', name: 'Fix the gap', description: 'Found by the lane.', tier: 2 })
    expect([String(agent.deny).includes('report'), creates().length]).toEqual([true, 0])
    /* nor does an agent record a fact on the board */
    const fact = await w.call($, { tool: 'mcp__askerdo__fact', agentId: 'a1', title: 'A trap', body: 'Seen by the lane.' })
    expect([String(fact.deny).includes('report'), w.cliRuns().filter((r: any) => r.args[0] === 'knowledge').length]).toEqual([true, 0])
    /* nor a ruling: an agent never sees the user's words */
    const ruling = await w.call($, { tool: 'mcp__askerdo__decide', agentId: 'a1', title: 'Ship it', words: 'ship it' })
    expect([String(ruling.deny).includes('report'), w.cliRuns().filter((r: any) => r.args[0] === 'decide').length]).toEqual([true, 0])
    /* an agent's own task writes, by the tool, a note on a task or the shell, are refused */
    const writes = [{ tool: 'mcp__askerdo__task_update', id: 'T-41', status: 'done' }, { tool: 'mcp__askerdo__note', id: 'T-41', body: 'done' },
      { tool: 'Bash', command: 'node ~/.claude/askerdo/cli.mjs task update T-41 --check-done 1 --json' }]
    const denied = await Promise.all(writes.map((x) => $.tool.call({ ...x, agentId: 'a1' })))
    expect([denied.map((r: any) => /step[^.]*number/.test(String(r.deny))), w.cliRuns().filter((r: any) => ['task', 'note'].includes(r.args[0])).length]).toEqual([[true, true, true], 0])
    await $.turn.start({ text: 'work', turnId: 't1' })
    const ok = await w.call($, { tool: 'mcp__askerdo__place', name: 'Fix the gap', description: 'Found by the lane.', tier: 2 })
    expect([JSON.parse(creates()[0].stdin).tier, String(ok.result).includes('Tier 2')]).toEqual([2, true])
    const no = await w.call($, { tool: 'mcp__askerdo__place', name: 'Tidy the docs', description: 'Seen in passing.', tier: 3, track: 'TR-3' })
    expect(String(no.deny)).toContain('place with tier 2')
    await $.turn.complete({ answer: OK + ' **Filed** the gap.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    const first = await notes($, w)
    const said = first.join('\n')
    expect([said.includes('"Tidy the docs"'), said.includes('"Fix the gap"')]).toEqual([true, false])
    /* last and off the track are asked: nothing is created, the card is kept under the call and the block handed back */
    await $.turn.start({ text: 'work', turnId: 't2' })
    const made = creates().length
    const last = await w.call($, { tool: 'mcp__askerdo__place', tool_use_id: 'tu-last', name: 'Sort the notes', description: 'Seen in passing.', runBy: 'fork', tier: 2, last: 'nothing needs it sooner' })
    const off = await w.call($, { tool: 'mcp__askerdo__place', tool_use_id: 'tu-off', name: 'Tidy the docs', description: 'Seen in passing.', tier: 3, track: 'TR-3', whyElsewhere: 'docs work', here: { before: ['T-50'] } })
    const close = await w.call($, { tool: 'mcp__askerdo__task_update', tool_use_id: 'tu-close', id: 'T-41', status: 'done',
      leftovers: [{ name: 'Wire the band', runBy: 'fork', tier: 2, before: ['T-50'] }, { name: 'Check the port', runBy: 'fork', tier: 3, track: 'TR-4', whyElsewhere: 'ports are TR-4\'s' }] })
    expect([creates().length - made, JSON.parse(creates().at(-1).stdin).here, w.cliRuns().filter((r: any) => r.args.includes('--run-by')).length])
      .toEqual([2, { before: ['T-50'] }, 0])
    for (const [r, id] of [[last, 'Q600'], [off, 'Q601'], [close, 'Q602']] as const) {
      expect([String(r.result).includes('Filed'), String(r.result).includes('Nothing was created'), String(r.result).includes('exactly, once:\n\n❓ ' + id)]).toEqual([false, true, true])
    }
    expect(String(close.result)).toContain('T-92')
    for (const [use, id, text] of [['tu-off', 'Q601', off.result], ['tu-close', 'Q602', close.result]] as const) {
      const said = 'Found work.\n\n' + HAND + ' **Needs you:** ' + String(text).split('exactly, once:\n\n')[1]
      await replyRow($, 'msg-' + use, said)
      const ui = await mountReply($, 'desktop', 'msg_' + use + '-t0', said)
      expect([!!(await ui.find({ key: 'qhead-' + id })), !!(await ui.find({ key: 'qhead-Q600' }))]).toEqual([true, false])
      await ui.unmount()
    }
    const wake = await w.call($, { tool: 'mcp__askerdo__place', tool_use_id: 'tu-wake', task: 'T-42', tier: 4, workstream: 'WS-11', wake: '2026-12-01', unplaced: 'later' })
    expect([String(wake.result).includes('woken twice'), String(wake.result).includes('exactly, once:\n\n❓ Q603')]).toEqual([true, true])
    await $.turn.complete({ answer: OK + ' **Asked** where they go.', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' })
    expect((await notes($, w)).slice(first.length).join('\n')).not.toContain('refused filing')
    /* the session's shell cannot pass itself off as the user or another session, nor answer a placement question, nor run the user's /askerdo filing */
    /* a bare number is the question too, and an override press is the user's from the main loop as from an agent */
    const cmds = ['task create --tier 3 --track TR-4 --user s1 --name x --json', 'track capture --tier 2 --track TR-3 --name x --session other', 'answer Q600 --pick b', 'answer 600 --pick b',
      'override decide 3 allow --user s1']
    const forged = []
    for (const c of cmds) forged.push(await $.tool.call({ tool: 'Bash', command: 'node ~/.claude/askerdo/cli.mjs ' + c }))
    forged.push(await $.tool.call({ tool: 'Skill', skill: 'askerdo', args: 'track capture inbox probe' }))
    expect(forged.map((r: any) => /place tool|answer tool|override_request/.test(String(r.deny)))).toEqual([true, true, true, true, true, true])
    /* its answer tool records a placement answer only once the user's own message names the question, and not by a bare number */
    w.questions.find((q: any) => q.id === 'Q600').placed = { outcome: 'asked', created: { id: 'T-95', track: 'TR-4', before: [], after: [] } }
    const early = await w.call($, { tool: 'mcp__askerdo__answer', id: 'Q600', pick: 'b' })
    await $.prompt.submit({ text: 'run the 600 checks' })
    const bare = await w.call($, { tool: 'mcp__askerdo__answer', id: 'Q600', pick: 'b' })
    await $.prompt.submit({ text: 'Q600 b' })
    const named = await w.call($, { tool: 'mcp__askerdo__answer', id: 'Q600', pick: 'b' })
    expect([String(early.deny).includes('press its card'), String(bare.deny).includes('press its card'), String(named.result).includes('600b'),
      w.cliRuns().filter((r: any) => r.args[0] === 'answer').length]).toEqual([true, true, true, 1])
    /* it goes with the user's mark, says what the answer created, and its inbox line is not told again */
    expect([w.last('answer').args.includes('--user'), w.last('answer').args.includes('--session'), String(named.result).includes('created T-95 on TR-4')]).toEqual([true, false, true])
    await $.prompt.submit({ text: 'carry on' })
    await w.clock.settle()
    expect([w.inbox[w.sid] === undefined && !w.taken[w.sid], w.told.some((m: any) => /I answered Q600/.test(String(m.content[0].text)))]).toEqual([false, false])
  })

  test('a clean reply with an empty set draws no names line and gets no note (acceptance 5)', async ($: any, on: any) => {
    const w = checked(on)
    w.questions = []
    w.tracks[0].session = undefined
    await start($, w)
    await compose($, ['desktop'])
    await reply($, OK + ' ' + GREEN + ' **Shipped**\n\nThe band is in.\n\n' + GREEN + ' Next up: the review.')
    expect(flags(w)).toEqual([])
    expect((await notes($, w))).toEqual([])
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

  /* a handoff waits for the mod's depth note or the user's ask */
  test('a close by handoff before the mod\'s note, unasked, is flagged; after the window note it is not', async ($: any, on: any) => {
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
      const r = await w.call($, { tool: 'mcp__askerdo__handoff_write', track: 'TR-3', goal: 'g', focus: 'next', state: 'Done.', verifyFirst: [{ path: 'C:/src/proj' }] })
      await $.turn.complete({ answer: answer(r.result.slice(r.result.indexOf('\u2b07'))), durationMs: 5, isAborted: false, turnId: id, reason: 'answer' })
      return r
    }
    /* the write's line naming its runs' unpushed branches reaches the result */
    w.unpushedLine = 'Unpushed: agent-x on branch lane-x'
    expect((await close('t1', () => OK + ' ' + FLAG + ' **Handed off**: resume with /askerdo resume TR-3.\n\n' + FLAG + ' Done.')).result).toContain(w.unpushedLine)
    expect(flags(w)[0]).toContain('/askerdo resume TR-3')
    await close('t2', (block) => OK + ' ' + FLAG + ' **Handed off**\n\n' + block + '\n\n' + FLAG + ' Done.')
    expect(flags(w).length).toBe(1)
    /* a turn that changes state past the handoff is told at that step to update it,
       and flagged at its end when it did not; one that called handoff_update, or only read, is not */
    const went = async (id: string, ops?: any[], command = 'git commit -m "x" -- a') => {
      await $.turn.start({ text: 'one more thing', turnId: id })
      await w.call($, { tool: 'Bash', command })
      if (ops) expect((await w.call($, { tool: 'mcp__askerdo__handoff_update', ops })).result).toContain('TR-3.5')
      await $.turn.complete({ answer: OK + ' **Kept going**\n\n' + FLAG + ' Done.', durationMs: 5, isAborted: false, turnId: id, reason: 'answer' })
    }
    const told = () => w.told.filter((m: any) => m.type === 'user' && /^AskerDo: .*TR-3\.5.*handoff_update/.test(String(m.content[0].text))).length
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
    expect((await notes($, w))).toEqual([])
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
    const r = await w.call($, { tool: 'Agent', description: 'the fixer', prompt: 'Fix the band.', model: 'fable' })
    expect(r.result).toBe('spawned')
    expect(flags(w)[0]).toBe('AskerDo: the dispatch of the fixer: the brief names no -state.md note; '
      + 'the brief has no output-size rule. Flagged, not rewritten.')
    await $.turn.complete({ answer: OK + ' **Dispatched** the fixer.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    expect((await notes($, w))[0]).toContain('the dispatch of the fixer: the brief names no -state.md note')
  })

  test('a brief naming its state note and a size rule passes clean', async ($: any, on: any) => {
    const w = checked(on)
    w.rules = RULES
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    await start($, w)
    await w.call($, { tool: 'Agent', description: 'the fixer', model: 'opus',
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
    const r = await w.call($, { tool: 'Agent', description: 'the fixer', prompt: 'Fix the band.' })
    expect(r.result).toBe('spawned')
    await $.turn.complete({ answer: OK + ' **Dispatched** the fixer.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(flags(w)).toEqual([])
    expect((await notes($, w))).toEqual([])
  })

  test('a brief file the prompt names is read, and its line against a rule in force is flagged', async ($: any, on: any) => {
    const w = checked(on)
    w.rules = RULES
    /* the repo CLAUDE.md's golden-fixture line pins bytes by design and is no hit */
    w.fsRead = (path: string) => (path.endsWith('lane-brief.md') ? 'Write a test for each item.'
      + '\n- Any change to generated contract text requires regenerating the golden\n  fixtures, which pin exact bytes: use the case configs from' : '')
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    await start($, w)
    await w.call($, { tool: 'Agent', description: 'the fixer', model: 'opus',
      prompt: 'Read docs/lane-brief.md. Keep docs/fix-state.md current. Final response under 2000 characters.' })
    expect(flags(w).join(' ')).toContain('a test per item')
    expect(flags(w).join(' ')).not.toContain('tests.pinWording')
  })

  /* a lane that handed work on to another agent; its size taken at the agent's last step */
  test('a lane that hands work on is journaled on its task, and the next dispatch naming the task is flagged', async ($: any, on: any) => {
    const w = checked(on)
    w.rules = RULES
    w.tasks = [{ id: 'T-7', kind: 'task', name: 'the fix', status: 'open', journal: '', steps: [{ n: 1, text: 'fix it', done: true }, { n: 2, text: 'measure at 238', done: false }] }]
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    on('agent.spawn', () => ({ model: 'opus', agentId: 'a1' }))
    await start($, w)
    const brief = { description: 'Fix lane 3', model: 'opus', prompt: 'T-7: keep docs/fix-state.md current. Final response under 2000 characters.' }
    await w.call($, { tool: 'Agent', tool_use_id: 'tu-1', ...brief })
    expect(flags(w)).toEqual([])
    await $.agent.spawn({ ...brief, tool_use_id: 'tu-1' })
    w.stepUsage.a1 = { input_tokens: 5000, cache_read_input_tokens: 450000, cache_creation_input_tokens: 0, output_tokens: 10 }
    const s = $.turn.step({ turnId: 't-a1', index: 0, model: 'm', messageCount: 3, agentId: 'a1' })
    for await (const _ of s) { /* drained */ }
    await s.result
    await $.turn.complete({ answer: 'Leg 1 done.\nCONTINUE: docs/fix-state.md', durationMs: 5, isAborted: false, turnId: 't-a1', reason: 'answer', agentId: 'a1' })
    /* the report's own prompt carries the task, its open step by number and the settling call, once */
    await $.prompt.submit({ text: '<agent-message from="a1">\n[Subagent hand-back]\nLeg 1 done.', origin: { kind: 'peer' }, isMeta: true })
    const told = w.contexts.at(-1).join('\n')
    expect(['T-7', '2. measure at 238', '"done": [2]'].map((x) => told.includes(x))).toEqual([true, true, true])
    await $.prompt.submit({ text: 'go on' })
    expect((w.contexts.at(-1) || []).join('\n')).not.toContain('measure at 238')
    await w.clock.settle()
    expect(w.tasks[0].journal).toContain('455k')
    await w.call($, { tool: 'Agent', tool_use_id: 'tu-2', ...brief })
    expect(flags(w).join(' ')).toContain('T-7 handed its work on')
  })

  /* with no rules in force the commit join reads the agent's run, ended or open, so a subagent's commit links to its task */
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
    await w.call($, { tool: 'Agent', tool_use_id: 'tu-1', ...brief })
    await $.agent.spawn({ ...brief, tool_use_id: 'tu-1' })
    await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't-a1', reason: 'answer', agentId: 'a1' })
    await w.call($, { tool: 'Bash', command: 'git commit -am "fix the band"', agentId: 'a1' })
    await w.clock.settle()
    const links = w.verbs.filter((v: any) => v.name === 'commitLink').map((v: any) => v.body.input)
    expect(links.length).toBe(1)
    expect([links[0].task, links[0].via, links[0].sha, links[0].repo, links[0].agent_job]).toEqual(['T-9', 'agent', SHA, 'github.com/example/proj', 'Band lane'])
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
    /* the engine asking again, as after a plugin reload */
    w.reask = () => { kept.text = undefined }
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
    const shells: string[] = []
    on('tool.call', { tool: 'Bash' }, ($: any, e: any) => { shells.push(e.command); return { result: { stdout: '', stderr: '', interrupted: false } } })
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
    await w.call($, { tool: 'mcp__askerdo__task_update', id: 'T-13', status: 'done' })
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
    /* the system prompt stays as first sent, so the cache holds; the change rides the prompt as a note,
       its block the latest in view */
    expect(await carried($, ['desktop'])).toBe(first)
    const note = w.contexts.at(-1).join('\n')
    expect([note.includes('A line added'), note.includes('rev r1')]).toEqual([true, false])
    expect(String(latest(note)) > String(latest(first))).toBe(true)
    /* asked again, as after a reload, the answer is the same */
    w.reask()
    expect(await carried($, ['desktop'])).toBe(first)
    /* told once */
    await $.prompt.submit({ text: 'and again' })
    expect(w.contexts.at(-1).join('\n')).not.toContain('A line added')
    await $.agent.spawn({ prompt: 'Then.', description: 'later' })
    expect(w.spawned[3]).toContain('rev r3, for its agents')
    /* a track the model's own shell call leaves, then takes, reaches the next prompt's rules with the band
       frozen; an agent's shell resume moves nothing */
    w.rules = (args: string[]) => ({ ...RULES, revision: 'r4', text: 'Rules in force (AskerDo rev r4, for ' + (args.includes('--track') ? args[args.indexOf('--track') + 1] : 'this session') + '):\n- Few tests. [built in]' })
    const cli = (verb: string, agentId?: string) => w.call($, { tool: 'Bash', command: 'node ~/.claude/askerdo/cli.mjs ' + verb + ' --session sess-1', ...(agentId ? { agentId } : {}) })
    const ruled = async (text: string) => { await $.prompt.submit({ text, origin: { kind: 'peer' } }); return w.contexts.at(-1).join('\n') }
    const t3 = w.tracks.find((t: any) => t.id === 'TR-3'), t4 = w.tracks.find((t: any) => t.id === 'TR-4')
    delete t3.session
    await cli('track park TR-3 --reason later')
    expect(await ruled('parked')).toContain('for this session')
    t4.session = 'sess-1'
    await cli('resume TR-4')
    expect(await ruled('resumed')).toContain('for TR-4')
    /* a waiting handoff written from the shell freezes the band as the tool's does */
    /* while the session's agents run, a shell handoff write of the held track does not run and
       its result names what runs; once they land it goes through */
    const writes = () => shells.filter((c) => c.includes('handoff write')).length
    const before = writes()
    const waited = await cli('handoff write TR-4')
    expect([writes() - before, String(waited.result.stdout)]).toEqual([0, expect.stringContaining('"later"')])
    /* held as one step of a compound command, the answer first says the other steps did not run */
    const both = await w.call($, { tool: 'Bash', command: 'git commit -m wip && node ~/.claude/askerdo/cli.mjs handoff write TR-4 --session sess-1' })
    const said = String(both.result.stdout), plain = String(waited.result.stdout)
    expect([writes() - before, said.includes('"later"'), said.length > plain.length, said.startsWith(plain.slice(0, 30))]).toEqual([0, true, true, false])
    for (const id of ['a1', 'a2', 'a3', 'a4']) await $.turn.complete({ answer: 'x', durationMs: 5, isAborted: false, turnId: 't-' + id, reason: 'answer', agentId: id })
    delete t4.session
    t4.handoffs.push({ id: 'TR-4.5', status: 'waiting', focus: 'f', fromSession: 'sess-1', created: new Date().toISOString() })
    await cli('handoff write TR-4')
    expect([writes() - before, w.stored.closedSessions]).toEqual([1, { 'sess-1': 'handed off' }])
    const reads = w.cliRuns().filter((r: any) => r.args[0] === 'track' && r.args[1] === 'mine').length
    await cli('resume TR-3', 'a1')
    expect(w.cliRuns().filter((r: any) => r.args[0] === 'track' && r.args[1] === 'mine').length).toBe(reads)
  })

  /* a typed resume's kickoff turn works under the taken track's rules from its first step */
  test('a resume\'s kickoff turn carries the taken track\'s rules, and so does a dispatch in that turn', async ($: any, on: any) => {
    const w = spawning(on, null, $)
    w.rules = (args: string[]) => {
      const tr = args.includes('--track') ? args[args.indexOf('--track') + 1] : ''
      const line = tr === 'TR-4' ? '\n- Every brief points at the preamble. [ws on WS-12]' : tr === 'TR-9' ? '\n- A side line. [ws on WS-12]' : ''
      const rev = tr === 'TR-4' ? 'r9' : tr === 'TR-9' ? 'r10' : 'r1'
      return { ...RULES, revision: rev, text: 'Rules in force (AskerDo rev ' + rev + '):\n- Few tests. [built in]' + line }
    }
    delete w.tracks[0].session
    await start($, w, 'desktop')
    expect(await carried($, ['desktop'])).not.toContain('preamble')
    await $.command.run({ command: 'askerdo', args: 'resume TR-4' })
    await w.clock.settle()
    /* the engine runs no hook of the mod's on its own submit, so what the turn reads is the notes and the prompt */
    const kickoff = w.prompts.findIndex((p: string) => p.includes('Kickoff for TR-4.2'))
    const read = [...w.appends.map((m: any) => m.content[0].text), w.prompts[kickoff], ...w.contexts[kickoff]].join('\n')
    expect([kickoff > -1, read.includes('Every brief points at the preamble.')]).toEqual([true, true])
    /* told once: the next prompt does not carry it again */
    await $.prompt.submit({ text: 'go on' })
    expect(w.contexts.at(-1).join('\n')).not.toContain('preamble')
    await $.agent.spawn({ prompt: 'Fix the band.', description: 'fixer' })
    expect(w.spawned.at(-1)).toContain('Every brief points at the preamble.')
    /* every turn the mod starts carries what changed: a track a typed command takes, then the
       band's submit chip; a refused submit puts the blocks back for the next */
    await $.command.run({ command: 'askerdo', args: 'track new WS-12 side work' })
    w.inbox['sess-1'] = [w.event('Q106', 'b')]
    w.marker += '+'
    await w.clock.advance(15000)
    await w.clock.settle()
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })
    const [appended, prompted] = [w.appends.length, w.prompts.length]
    w.appendDeny = 1
    w.submitThrows = 1
    await band.press({ key: 'inbox-submit' })
    await w.clock.settle()
    await pressAgain(band, 'inbox-submit')
    await w.clock.settle()
    const turn = [...w.appends.slice(appended).map((m: any) => m.content[0].text), ...w.prompts.slice(prompted)].join('\n')
    expect([w.prompts.length - prompted, turn.includes('A side line.')]).toEqual([1, true])
    await band.unmount()
  })

  /* a role's line reaches an agent of that subagent type or on a task with that label, and no other */
  test('a line bound to one role rides only the dispatches that play it', async ($: any, on: any) => {
    const rows = [{ rule: 'few', text: 'Few tests.', source: 'built in' }, { rule: 'audit-ground', text: 'Read every record first.', source: 'yours', for: 'agents', role: 'audit' }]
    const w = spawning(on, { ...RULES, rows, agents: { revision: 'r1', text: RULES.text } })
    const base = w.cli
    w.cli = (args: string[], stdin?: string, env?: any) => (args[0] === 'task' && args[1] === 'block'
      ? { exitCode: 0, stdout: JSON.stringify({ id: args[2], labels: args[2] === 'T-8' ? ['Audit'] : [], text: 'Task ' + args[2] }) + '\n', stderr: '' }
      : base(args, stdin, env))
    /* the last run, ended handed on, rides its next dispatch with the run details */
    w.boardRuns.push({ run: 1, worker: 'agent', agentId: 'old', job: 'fixer 1', session: 'sess-0', pc: 'PC-1', started: '2026-11-14T09:00:00.000Z', heard: '2026-11-14T09:30:00.000Z',
      ended: '2026-11-14T09:30:00.000Z', how: 'handed_on', continueLine: 'CONTINUE: leg 2, Part C', tasks: ['T-9'] })
    await start($, w)
    await $.agent.spawn({ prompt: 'T-8: audit the accounts.', description: 'auditor' })
    await $.agent.spawn({ prompt: 'Look around.', description: 'scout', subagentType: 'audit' })
    await $.agent.spawn({ prompt: 'T-9: fix the band.', description: 'fixer', subagentType: 'general-purpose' })
    expect(w.spawned.map((p: string) => p.includes('Read every record first.'))).toEqual([true, true, false])
    expect(w.spawned[2]).toContain(RULES.text)
    expect(['Last run on T-9: agent fixer 1, handed on', 'CONTINUE: leg 2, Part C', 'job fixer', 'by its number'].map((x) => w.spawned[2].includes(x))).toEqual([true, true, true, true])
  })

  test('with dispatch.inject off a dispatch keeps its prompt as written', async ($: any, on: any) => {
    const w = spawning(on, { ...RULES, inject: false })
    await start($, w)
    await $.agent.spawn({ prompt: 'Fix the band.', description: 'fixer' })
    expect(w.spawned).toEqual(['Fix the band.'])
  })

  /* where an organization's guard keeps the prompt and classic hooks from running */
  test('answered turns with no prompt or classic hook firing mark the prompt half off once, and the blocks ride the next prompt', async ($: any, on: any) => {
    const w = spawning(on, RULES, $)
    await start($, w)
    const turn = async (id: string, isAborted = false) => {
      await $.turn.start({ text: 'work', turnId: id })
      const s = $.turn.step({ turnId: id, index: 0, model: 'm', messageCount: 3 })
      for await (const _ of s) { /* drained */ }
      await s.result
      await $.turn.complete({ answer: 'done', durationMs: 5, isAborted, turnId: id, reason: 'answer' })
      await w.clock.settle()
    }
    const offs = () => w.runs.filter((r: any) => r.script.endsWith('mod-carrier.mjs') && r.args[0] === 'off').length
    /* an aborted turn and a single quiet turn conclude nothing */
    await turn('t1', true)
    await turn('t2')
    expect([offs(), w.toasts.length]).toEqual([0, 0])
    await turn('t3')
    await turn('t4')
    expect([offs(), w.toasts.length]).toEqual([1, 1])
    await $.prompt.submit({ text: 'go on' })
    expect(w.contexts.at(-1).join(' ')).toContain('rev r1')
    /* once a compose runs the half is on again: the next prompt carries no blocks */
    await compose($, ['desktop'])
    await $.prompt.submit({ text: 'more' })
    expect(w.contexts.at(-1).join(' ')).not.toContain('rev r1')
  })
})
