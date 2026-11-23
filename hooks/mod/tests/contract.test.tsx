/* The first telling drawn by the mod, the mod's contract section and the board
 * kept out of an unengaged session
 * under `claude plugin test`, both surfaces. */
import { describe, expect, test } from 'claude-code/testing'
import { COLD_START, pressRow, start, twiceAtMost, world } from './world.ts'
import { GLYPHS, firstTellingCard, gridWidths } from '../../../lib/mod-core.mjs'
import { PLUGIN, ASK, ASKED, SURFACES, HAND, BAND, OPTIONS, STYLE, compose, reply, checked, replyRow, engineReply, mountReply, turnEnd, RULES } from './contract-kit.ts'

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

  /* a go question kept before the session engaged is still the user's alone to answer */
  test('a kept go question takes a session\'s answer only from a message of the user and files it with their mark', async ($: any, on: any) => {
    const w = world(on)
    w.tracks[0].session = undefined
    await start($, w)
    await $.turn.start({ text: 'work', turnId: 't1' })
    const options = [{ type: 'a', option: 'move them', go: true }, { type: 'b', option: 'ask each' }]
    await w.call($, { tool: ASK, tool_use_id: 'tu-1', name: 'the moves', ask: ASKED, gist: 'Six moves.', blocking: true, options, pick: 'a', gates: ['T-42'] })
    expect((await w.call($, { tool: 'mcp__askerdo__answer', id: 'L1', pick: 'a' })).deny).toContain('press its card')
    await $.prompt.submit({ text: 'L1a' })
    expect((await w.call($, { tool: 'mcp__askerdo__answer', id: 'L1', pick: 'a' })).result).toContain('L1a')
    await $.command.run({ command: 'askerdo', args: 'board' })
    await w.clock.settle()
    expect(w.last('answer').args).toEqual(['answer', 'Q512', '--pick', 'a', '--user', 'sess-1', '--json'])
  })
})
