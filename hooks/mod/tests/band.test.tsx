/* The Needs-you band (the rows) under `claude plugin test`, every drawing on both
 * surfaces the band is raised on, and its presses. */
import { describe, expect, test } from 'claude-code/testing'
import { COLD_START, HEAVY, plain, pressAgain, pressRow, start, twiceAtMost, world } from './world.ts'
import { deskCells, PAGE_BOUNDS, pageCounts, rowNeed } from '../../../lib/mod-core.mjs'
import { PLUGIN, STAR, SKY, PANE_ID, SURFACES, BAND, PANE, BOARD, cooled, mount, rowKeys, labels, drawnCells, oneQuestion, threeQuestions } from './band-kit.ts'

describe('the band', () => {
  /* on the desktop the status row always draws */
  test('nothing open and nothing waiting draws no band and the app\'s content still draws; the shelf alone draws none; the desktop keeps its status row', COLD_START, async ($: any, on: any) => {
    const w = world(on)
    w.questions = []
    delete w.tracks[0].session
    w.shelf.push({ track: 'TR-6', handoff: 'TR-6.1', name: 'next line', state: 'waiting', age: '1h', focus: 'go on' })
    await start($, w)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await ui.find({ key: 'needs-you' })).toBeUndefined()
      expect(await ui.find({ key: 'engine-band' })).toBeDefined()
      expect(!!(await ui.find({ key: 'askerdo-status' }))).toBe(surface === 'desktop')
      /* no half line before the app's content, whose empty slot would draw an empty row under the status row */
      if (surface === 'desktop') {
        const col = (await ui.find({ key: 'band-and-box' }))!
        /* engine 2.1.325's kit leaves core's drawing as its { type: 'engine', ref } node among the children; it is the engine's band */
        const keyOf = (c: any) => (c.type === 'engine' ? 'engine-band' : c.props.key)
        expect([col.props.rowGap, col.children.map(keyOf)]).toEqual([undefined, ['askerdo-status', 'engine-band']])
      }
      await ui.unmount()
    }
  })

  /* on 2.1.325 the page bounds the band as every plugin's rows stacked; a row above, read at
     AbovePromptList, comes off the band's ceiling (the inline plugin's register is sent as source) */
  test('another plugin\'s large row above leaves the whole band under the page\'s bounds, the band still drawn', { timeoutMs: 30000, plugins: [{ name: 'other', tier: 'prepend', register: (on: any) => {
    on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => { const els = $.ui.resolve(e); return els.Box({ key: 'other-row', flexDirection: 'column', children: Array.from({ length: 850 }, (_, i) => els.Text({ key: 'o' + i, children: 'xxxx' })) }) })
  } }] }, async ($: any, on: any) => {
    const w = world(on)
    oneQuestion(w)
    for (let i = 0; i < 6; i++) w.questions.push({ ...w.questions[0], id: 'Q20' + i, name: 'question ' + i })
    await start($, w)
    const ui = await mount($, 'desktop')
    for (let i = 0; i < 2; i++) await cooled(w)
    const drawn = await ui.drawn()
    expect([!!(await ui.find({ key: 'other-row' })), !!(await ui.find({ key: 'band-and-box' }))]).toEqual([true, true])
    expect(pageCounts(drawn).nodes).toBeLessThan(PAGE_BOUNDS.nodes)
    await ui.unmount()
  })

  test('one open question is one row: its name, letter-and-name chips with the pick primary and starred, no token, ending at its age; a bubble on the desktop', HEAVY, async ($: any, on: any) => {
    const w = world(on)
    oneQuestion(w)
    w.boardUrl = BOARD
    await start($, w)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await rowKeys(ui)).toEqual(['q-Q106'])
      expect(await ui.find({ type: 'Text', text: 'store shape' })).toBeDefined()
      /* the label leads the name in bold and keeps its width; the name is what cuts */
      const label = (await ui.find({ key: 'qlabel-Q106' }))!
      expect([label.props.flexShrink, label.children[0].props.bold, label.text, (await ui.find({ key: 'qwords-Q106' }))!.props.flexShrink]).toEqual([0, true, 'Q106', 1])
      const chips = await labels(ui)
      expect(chips[1].startsWith(STAR)).toBe(true)
      expect(chips[1]).toContain('many files')
      expect(chips.some((l: string) => l.includes('106'))).toBe(false)
      /* the desktop's pick wears the sky rim on its face, the terminal's is the primary */
      if (surface === 'desktop') {
        const rims = await Promise.all(['106a', '106b'].map(async (t) => (await ui.find({ key: 'chipface-' + t }))!.props.borderColor === SKY))
        expect(rims).toEqual([false, true])
      } else expect((await ui.find({ key: 'answer-106b' }))?.props.variant).toBe('primary')
      expect(await ui.find({ type: 'Text', text: '3h' })).toBeDefined()
      /* the token lives in the chip's card; the row's card is its crux */
      expect(await ui.find({ type: 'Text', text: 'one file or many' })).toBeDefined()
      if (surface === 'terminal') {
        expect((await ui.find({ type: 'Text', text: '(my pick)' }))?.text).toContain('106b many files')
        expect(await ui.find({ key: 'qc-head-Q106' })).toBeUndefined()
      } else {
        /* the row's card: the tray face, the id and name in bold, the crux in italics, the gray foot */
        const head = (await ui.find({ key: 'qc-head-Q106' }))!
        expect([head.children[0].type, head.children[1].props.bold]).toEqual(['Svg', true])
        expect(head.text).toContain('Q106 store shape')
        expect((await ui.find({ key: 'qc-crux-Q106' }))?.children[0].props.italic).toBe(true)
        const foot = (await ui.find({ key: 'qc-foot-Q106' }))!
        expect(foot.children[0].props.color).toBe('inactive')
        expect(foot.text).toMatch(/blocking.*3h/)
        /* a chip's card: the catch in the warning color, the one-way line only where the undo says so, the press */
        expect((await ui.find({ key: 'oc-catch-106b' }))?.children[0].props.color).toBe('warning')
        expect([!!(await ui.find({ key: 'oc-oneway-106a' })), !!(await ui.find({ key: 'oc-oneway-106b' }))]).toEqual([true, false])
        expect((await ui.find({ key: 'oc-press-106b' }))?.text).toContain('106b')
      }
      /* the band draws no pane or board press; the row ends at its age */
      expect(JSON.stringify(await ui.find({ key: 'needs-you' })).includes('"Link"')).toBe(false)
      const row = (await ui.find({ key: 'q-Q106' }))!
      expect(row.children.at(-1).props.key).toBe('qage-Q106')
      /* the name sits one cell from its chips, as the chips from each other */
      const lead = (await ui.find({ key: 'qlead-Q106' }))!
      expect([lead.props.columnGap, lead.children.map((c: any) => c.props.key)]).toEqual([1, ['qhead-Q106', 'qchips-Q106']])
      /* the terminal's row hugs its content and tints on hover; the desktop's spans the band */
      expect(row.props.alignSelf).toBe(surface === 'terminal' ? 'flex-start' : undefined)
      const raw = (await ui.find({ key: 'needs-you' }))!.children[0]
      expect(!!(raw.hover || raw.props.hover)).toBe(surface === 'terminal')
      expect((await ui.find({ key: 'qdot-Q106' }))!.children[0].type).toBe(surface === 'desktop' ? 'Svg' : 'Text')
      /* every card sized from its text inside the band, never placed by `right` */
      const cards = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.position === 'absolute' && b.props.display === 'none')
      expect(cards.length).toBeGreaterThan(2)
      expect(cards.every((c: any) => c.props.width <= BAND.bodyColumns && c.props.right === undefined && c.props.left <= 0)).toBe(true)
      /* on confirm (the default) a chip opens the card's strip under the row, the chip lit, and records nothing;
         Queue answer puts it in the card's queue, which the band's row counts; Unqueue takes the band back to its one row */
      const answered = () => w.cliRuns().filter((r: any) => r.args[0] === 'answer').length
      await ui.press({ key: 'answer-106a' })
      /* on the desktop the strip leads the band's one line in the question's place */
      const desk = surface === 'desktop'
      expect([await rowKeys(ui), !!(await ui.find({ key: 'qnow-Q106' })), answered(), w.prompts.length]).toEqual([desk ? ['qbandstrip-Q106'] : ['q-Q106', 'qbandstrip-Q106'], true, 0, 0])
      if (desk) expect((await ui.find({ key: 'qsbadge-Q106' }))!.props.borderColor).toBe(SKY)
      else expect((await ui.find({ key: 'answer-106a' }))?.props.variant).toBe('primary')
      await ui.press({ key: 'qqueue-Q106' })
      expect([await rowKeys(ui), !!(await ui.find({ key: 'queued-send' })), answered()]).toEqual([desk ? ['needs-line'] : ['q-Q106', 'band-foot'], true, 0])
      /* the queued card names the answer from the queue itself */
      if (desk) expect(JSON.stringify(await ui.find({ key: 'queued' }))).toContain('store shape')
      await pressAgain(ui, 'answer-106a')
      await ui.press({ key: 'qunqueue-Q106' })
      expect([await rowKeys(ui), answered()]).toEqual([['q-Q106'], 0])
      /* a strip behind the count line closes, so the row comes back bare when the second question goes */
      if (surface === 'terminal') {
        const reload = async () => { w.marker += '+'; await w.clock.advance(15000); await w.clock.settle() }
        await pressAgain(ui, 'answer-106a')
        w.questions.push({ id: 'Q110', name: 'second', blocking: false, subscribers: ['sess-1'], options: [{ type: 'a', option: 'yes' }] })
        await reload()
        expect(await rowKeys(ui)).toEqual(['count'])
        w.questions.pop()
        await reload()
        expect(await rowKeys(ui)).toEqual(['q-Q106'])
      }
      await ui.unmount()
    }
    /* Home's copy keeps the words it has room for; narrower, the pick keeps its star
       and the row's gaps close, so the name takes their room before it cuts.
       narrower still, the mark, the chips and the age stay the row and the name draws
       whole under them, across at most two lines; a name that fits keeps one row */
    const gaps: number[] = []
    for (const [cols, words, own, name] of [[62, true, false, 'store shape'], [40, false, false, 'store shape'], [28, false, true, 'store shape for every board']] as const) {
      w.questions[0].name = name
      w.marker = 'name#' + cols
      await w.clock.advance(15000)
      await w.clock.settle()
      const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE_ID, props: { ...PANE, bodyColumns: cols } })
      await pane.press({ key: 'tab-home' })
      const chips = await labels(pane)
      expect([chips[0].includes('one file'), chips[1].startsWith(STAR)]).toEqual([words, true])
      const top = await pane.find({ key: 'qtop-Q106' })
      expect(top ? top.children.slice(0, 2).map((c: any) => c.props.key) : null).toEqual(own ? ['qchips-Q106', 'qage-Q106'] : null)
      /* the fold ring ends the first line, the name under it keeping the whole row */
      expect(JSON.stringify((top || (await pane.find({ key: 'q-Q106' })))!.children.at(-1)).includes('"unfold-Q106"')).toBe(true)
      gaps.push((top || (await pane.find({ key: 'q-Q106' })))!.props.columnGap)
      /* the row's counted width is what it draws, words or the letters with the pick's bare star, never short of it */
      if (!own) {
        const row = (await pane.find({ key: 'q-Q106' }))!
        const age = (await pane.find({ key: 'qage-Q106' }))!.text
        const said = { name: 'Q106  ' + name, pick: 'b', answers: [{ letter: 'a', option: 'one file' }, { letter: 'b', option: 'many files' }] }
        const over = rowNeed(said, { surface: 'desktop', age, unfold: true }, words, Infinity, row.props.columnGap) - drawnCells(row)
        expect([cols, over >= 0 && over < 0.5]).toEqual([cols, true])
      }
      if (own) {
        const said = (n: any): string => (typeof n === 'string' ? n : (n.children || []).map(said).join(''))
        const lines = (await pane.find({ key: 'qlines-Q106' }))!.children.map((l: any) => said(l).trim())
        expect([lines.length, lines.join(' ')]).toEqual([2, name])
      }
      await pane.unmount()
    }
    expect(gaps[1]).toBeLessThan(gaps[0])
    /* a name far past any real one is cut where the band's model is built, so its card never makes the app refuse the band */
    const kept = w.questions[0].name
    w.questions[0].name = 'word '.repeat(15000)
    w.marker = 'name#long'
    await w.clock.advance(15000)
    await w.clock.settle()
    const long = await mount($, 'desktop')
    const longHead = await long.find({ key: 'qc-head-Q106' })
    expect([!!longHead, (longHead?.text || '').length < 1000, (longHead?.text || '').endsWith('...')]).toEqual([true, true, true])
    await long.unmount()
    w.questions[0].name = kept
    /* the worst band, a strip open with a queued answer, one waiting update and the board
       offline, is one needs line over the status row at 238, 438, 900 and 1400 px, nothing on it wrapping */
    w.inbox['sess-1'] = [{ key: 'k1', line: 'T-1 got a note', raw: { at: '2026-11-11T10:00:00+00:00', kind: 'task-note', id: 'T-1', name: 'a task', by: 'session:abc', pc: 'PC-2', note: 'n' } }]
    const near = w.near
    w.near = (...a: any[]) => ({ ...near(...a), online: false, offline: true, stale: true, board: 'board offline: the board does not know this token' })
    w.marker += '+'
    await w.clock.advance(15000)
    await w.clock.settle()
    const wide = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 160 } })
    await pressAgain(wide, 'answer-106a')
    await pressAgain(wide, 'qqueue-Q106')
    await pressAgain(wide, 'answer-106a')
    await wide.unmount()
    const shown = (n: any): any[] => (!n || typeof n !== 'object' || (n.props && (n.props.position === 'absolute' || n.props.display === 'none')) ? []
      : [n, ...[].concat(n.children || []).flatMap(shown)])
    for (const cols of [28, 51, 101, 160]) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: cols } })
      const col = (await ui.find({ key: 'band-and-box' }))!
      const needs = (await ui.find({ key: 'needs-you' }))!
      /* the app's engine gives a Text nested in a cut Text its own pre-wrap, so it counts as wrapping */
      const nested = (n: any) => n.type === 'Text' && /^truncate/.test(String(n.props && n.props.wrap)) && [].concat(n.children || []).some((c: any) => c && c.type === 'Text')
      const wraps = shown(needs).filter((n: any) => n.props && (n.props.wrap === 'wrap' || n.props.flexWrap === 'wrap' || nested(n))).length
      expect([cols, col.children.map((c: any) => c.props.key), needs.children.length, wraps, !!(await ui.find({ key: 'qnow-Q106' }))]).toEqual([cols, ['needs-you', 'askerdo-status'], 1, 0, true])
      /* with the note field open Now, Note and the cancel press stay at every width; the field takes no set
         width, so in px it gives way before any press, the line fitting with it at its floor; open or shut, the field or
         the word grows and the presses end the strip, Note last, so Note stays under the pointer */
      const ends = async () => {
        const strip = (await ui.find({ key: 'qbandstrip-Q106' }))!
        const mid = strip.children.find((c: any) => /^qs(field|words)-/.test(String(c.props.key)))
        const presses = strip.children.at(-1)
        return [mid.props.flexGrow > 0, presses.props.key, String(presses.children.at(-1).props.key).startsWith('qbandnote-Q106')]
      }
      const shut = await ends()
      await ui.press({ key: 'qbandnote-Q106' })
      const field = (await ui.find({ key: 'qsfield-Q106' }))!
      const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.key))
      const line = (await ui.find({ key: 'needs-line' }))!
      expect([cols, field.props.width, field.props.flexShrink > 0, ['qnow', 'qbandnote', 'qcancel'].every((k) => keys.some((x: string) => x.startsWith(k + '-Q106'))),
        drawnCells(line, true) + 5 <= cols, shut, await ends()]).toEqual([cols, undefined, true, true, true, [true, 'qspresses-Q106', true], [true, 'qspresses-Q106', true]])
      await pressAgain(ui, 'qbandnote-Q106')
      if (cols === 28) {
        /* shut and cancelled, the queued badge with Send stays beside the question */
        await pressAgain(ui, 'qcancel-Q106')
        expect([!!(await ui.find({ key: 'answer-106a' })), !!(await ui.find({ key: 'queued-send' }))]).toEqual([true, true])
        await pressAgain(ui, 'answer-106a')
      }
      await ui.unmount()
    }
    /* five options with an answer queued: the letters, the +N chip and the queued badge share the line, none over another */
    w.questions[0].options.push({ type: 'c', option: 'three files' }, { type: 'd', option: 'four files' }, { type: 'e', option: 'five files' })
    w.marker += '+5'
    await w.clock.advance(15000)
    await w.clock.settle()
    for (const cols of [28, 51, 101, 160]) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: cols } })
      if ((await ui.findAll({ type: 'Button' })).some((b: any) => String(b.key).startsWith('qcancel-Q106'))) await pressAgain(ui, 'qcancel-Q106')
      const line = (await ui.find({ key: 'needs-line' }))!
      /* a chip's outline and focus ring draw whole: no clipping Box holds a letter */
      const clipped = (n: any, inClip = false): boolean => !!n && typeof n === 'object' && ((inClip && /^chipface-/.test(String(n.props && n.props.key)))
        || [].concat(n.children || []).some((c: any) => clipped(c, inClip || (n.props && n.props.overflow === 'hidden'))))
      expect([cols, !!(await ui.find({ key: 'q-Q106' })), !!(await ui.find({ key: 'queued-send' })), drawnCells(line, true) <= cols, clipped(line)]).toEqual([cols, true, true, true, false])
      /* where the drawn row leaves the room, the queued chip says its count beside a Send button, not the bare badge */
      if (cols >= 101) expect([cols, !!(await ui.find({ key: 'queued-label' })), (await ui.findAll({ type: 'Button' })).some((b: any) => b.key === 'queued-send')]).toEqual([cols, true, true])
      await ui.unmount()
    }
    /* the offline line leading beside the chips holds its words only where they fit beside them, never under a chip */
    w.questions = []
    w.marker += '+0'
    await w.clock.advance(15000)
    await w.clock.settle()
    let led = 0
    for (let cols = 30; cols <= 70; cols++) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: cols } })
      const line = await ui.find({ key: 'needs-line' })
      const box = await ui.find({ key: 'offline-line' })
      if (line && box) led++
      const firm = box && box.props.flexShrink === 0 ? deskCells(plain(box.text)) : 0
      expect([cols, !line || drawnCells(line, true) + firm <= cols]).toEqual([cols, true])
      await ui.unmount()
    }
    expect(led).toBeGreaterThan(0)
  })

  test('several open collapse to the count line, its card naming them, "N open" opening the pane on Questions; frozen it says so and stays as drawn', async ($: any, on: any) => {
    const w = world(on)
    threeQuestions(w)
    await start($, w)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await rowKeys(ui)).toEqual(['count'])
      const count = (await ui.find({ key: 'count-mark' }))?.text
      expect(count).toContain('2 open')
      expect(count).toContain('1 blocking')
      expect(await labels(ui)).toEqual([])
      /* the desktop's card is the fact card, a question a fact */
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /Q106 store shape \(blocking\); Q107 mine/ })).toBeDefined()
      else expect((await ui.find({ key: 'card-count-head' }))?.text).toContain('2 open')
      await ui.press({ key: 'count-open-press' })
      await w.clock.settle()
      expect([w.panes.at(-1).id, w.panes.at(-1).focus]).toEqual([PANE_ID, true])
      await ui.unmount()
    }
    await $.tool.call({ tool: 'mcp__askerdo__handoff_write', goal: 'g', focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    await w.clock.settle()
    w.questions.push({ id: 'Q109', name: 'later', blocking: true, subscribers: ['sess-1'], options: [] })
    w.marker += '+'
    await w.clock.advance(15000)
    await w.clock.settle()
    const ui = await mount($, 'terminal')
    expect((await ui.find({ key: 'closed' }))?.text).toBe('handed off: band frozen')
    const face = (await ui.find({ type: 'Text', text: /open/ }))?.text
    expect(face).toContain('2 open')
    expect(face).not.toContain('blocking')
    await ui.unmount()
    /* a resume takes a track again, so the band is live and draws what came in; its id
       pasted from the desktop pane, the word joiner after its hyphen */
    await $.command.run({ command: 'askerdo', args: 'resume TR-' + String.fromCharCode(0x2060) + '4' })
    await w.clock.settle()
    const live = await mount($, 'terminal')
    expect(await live.find({ key: 'closed' })).toBeUndefined()
    /* Q106 stays with TR-3, which this session no longer holds */
    expect((await live.find({ key: 'count-mark' }))?.text).toContain('2 open')
    await live.unmount()
  })

  /* a hooks worker respawn starts a fresh copy over the session's state: its first band
     read tells the local server the start count, for the timings, and later reads do not */
  test('a fresh copy of the mod sends its start count with its first band read, once', async ($: any, on: any) => {
    const w = world(on)
    oneQuestion(w)
    const wrote: number[] = []
    on('state.set', ($: any, e: any, next: any) => { if (e.key === 'snapshot' && wrote.at(-1) !== e.value.starts) wrote.push(e.value.starts); return next(e) })
    await start($, w)
    /* the respawned worker raises session.start again in the same session */
    const before = w.reads.length
    await start($, w)
    const ui = await mount($, 'terminal')
    w.marker += '+'
    w.change()
    await w.clock.advance(15000)
    await w.clock.settle()
    const reads = w.reads.slice(before).map((r: any) => String(r.url)).filter((u: string) => u.includes('/local/band?'))
    expect(reads.length).toBeGreaterThan(1)
    expect(reads.filter((u: string) => u.includes('&start=2')).length).toBe(1)
    expect(wrote).toEqual([1, 2])
    await ui.unmount()
  })

  /* the band has no track row; the status row's track card carries the counts and
     the now set, so with nothing open the band is the status row alone, from one read */
  test('with a track held and nothing open the band is the status row alone, the track card naming its counts and what runs now', async ($: any, on: any) => {
    const w = world(on)
    w.questions = []
    w.boardUrl = BOARD
    const track = { id: 'TR-3', key: 'trk3abcd', name: 'mod core', state: 'active', workstream: 'WS-11', chain: 'TR-3', now: [{ id: 'T-41' }, { id: 'T-42' }],
      running: 2, ready: 3, toGo: 5, holder: { session: 'sess-1' } }
    w.near = (s: string, p: string, l: string) => ({ ...w.bandOf(s, p, l), track })
    on('ui.render', { component: 'PromptHint' }, () => ({ type: 'Box', props: { key: 'engine-hint' }, children: [] }))
    await start($, w)
    const card = async (ui: any) => (await ui.find({ key: 'status-thread' }))?.text
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await ui.find({ key: 'needs-you' })).toBeUndefined()
      if (surface === 'desktop') {
        expect(await ui.find({ key: 'askerdo-status' })).toBeDefined()
        /* the counts ride the tooltip's rows, a station for each running task */
        expect(await card(ui)).toMatch(/T-41.*T-42.*chain 5/)
      }
      await ui.unmount()
    }
    const hint = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '' } })
    expect(await card(hint)).toMatch(/TR-3 mod core.*T-41/)
    await hint.unmount()
    /* the held track, its graph for Home and the inbox peek ride the band: no track mine, graph read or peek script */
    const urls = w.reads.map((r: any) => r.url)
    expect(urls.some((u: string) => u.includes('/local/band?session=sess-1'))).toBe(true)
    expect(urls.some((u: string) => u.includes('/local/graph/'))).toBe(false)
    const reads = () => w.routed.map((c: any) => c.argv.slice(0, 2).join(' ')).filter((v: string) => v === 'track mine' || v.startsWith('mod-inbox'))
    expect(reads()).toEqual([])
    /* a move of the mod's own that the band has not caught: track mine settles it, and no take-over is told */
    await $.command.run({ command: 'askerdo', args: 'resume TR-4' })
    await w.clock.settle()
    expect(reads()).toContain('track mine')
    const ui = await mount($, 'desktop')
    expect(await card(ui)).toContain('TR-4')
    await ui.unmount()
    await $.prompt.submit({ text: 'go on' })
    expect(w.prompts.at(-1)).not.toContain('no longer holds')
  })

  test('under the app\'s box the band still draws above it, and the box is kept', async ($: any, on: any) => {
    const w = world(on)
    threeQuestions(w)
    await start($, w)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, hasSurvey: true } })
    expect(await ui.find({ key: 'count' })).toBeDefined()
    expect(await ui.find({ key: 'engine-band' })).toBeDefined()
    await ui.unmount()
  })

  test('pressing the starred chip accepts the pick through the CLI answer, toasts, and redraws', { timeoutMs: 15000 }, async ($: any, on: any) => {
    const w = world(on)
    oneQuestion(w)
    /* Answer presses at once: the chip records with no strip */
    w.alias = { alias: '', presses: 'once' }
    await start($, w)
    const ui = await mount($, 'desktop')
    await ui.press({ key: 'answer-106b' })
    expect(w.last('answer').args).toEqual(['answer', 'Q106', '--pick', 'b', '--user', 'sess-1', '--json'])
    expect(w.toasts.at(-1)).toContain('106b')
    /* the press is the user's act, so this idle session starts one turn carrying it */
    await w.clock.settle()
    expect(w.prompts.at(-1)).toContain('106b')
    expect(await ui.find({ key: 'q-Q106' })).toBeUndefined()
    /* the band first, then each surface once more with the write, its reload and the turn */
    const bandRow = await pressRow(w, 'answer', '106b')
    expect([bandRow && bandRow.f, twiceAtMost(bandRow)]).toEqual(['band', true])
    /* no settings file names a root, so no spawn carries one */
    expect(w.runs.some((r: any) => r.env && r.env.ASKERDO_ROOT)).toBe(false)
    /* a press on a question another session owns goes to that owner only:
       the toast names where, and no turn or inbox line comes here */
    oneQuestion(w)
    w.questions[0].owner = 'sess-2'
    w.marker += '+'
    await w.clock.advance(15000)
    await w.clock.settle()
    const told = (sid: string) => w.unacked(sid).filter((e: any) => e.raw.id === 'Q106').length
    const before = [w.prompts.length, told('sess-1')]
    await pressAgain(ui, 'answer-106b')
    await w.clock.settle()
    expect([w.prompts.length, told('sess-1'), told('sess-2'), /went to the session on TR-1/.test(w.toasts.at(-1))]).toEqual([...before, 1, true])
    /* pressed again on a band that still lists it, the pick the store holds starts no turn */
    oneQuestion(w)
    w.already = true
    w.marker += '+'
    await w.clock.advance(15000)
    await w.clock.settle()
    const turns = w.prompts.length
    await pressAgain(ui, 'answer-106b')
    await w.clock.settle()
    expect([w.cliRuns().filter((r: any) => r.args[0] === 'answer').length, w.prompts.length]).toEqual([3, turns])
    /* on a frozen band the press still saves, the closed line says so where the row was, and no turn starts */
    w.already = false
    oneQuestion(w)
    w.questions[0].version = 3
    w.marker += '+'
    await w.clock.advance(15000)
    await w.clock.settle()
    await $.tool.call({ tool: 'mcp__askerdo__handoff_write', goal: 'g', focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    await w.clock.settle()
    /* edited on the board after the row was drawn, the press carries the version it showed,
       so the board refuses it once reworded */
    w.questions[0].version = 4
    await ui.press({ key: 'answer-106a' })
    await w.clock.settle()
    expect([w.last('answer').args.slice(1, 4), w.prompts.length]).toEqual([['Q106', '--pick', 'a'], turns])
    const args = w.last('answer').args
    expect(args[args.indexOf('--version') + 1]).toBe('3')
    const receipt = String((await ui.find({ key: 'closed' }))?.text)
    expect([receipt.includes('106a'), /next session/.test(receipt)]).toEqual([true, true])
    await ui.unmount()
  })
})
