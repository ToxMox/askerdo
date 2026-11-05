/* The Needs-you band and the toasts (the rows) under `claude
 * plugin test`, every drawing on both surfaces the band is raised on. */
import { describe, expect, test } from 'claude-code/testing'
import { pressAgain, start, world } from './world.ts'
import { bandModel } from '../../../lib/mod-core.mjs'

const PLUGIN = 'askerdo'
const STAR = '\u2605'
const FLAG = '\u{1F3C1}'
const DONE = '✓'
const SAVING = '◌'
const SKY = '#00AEEF'
const PANE_ID = 'askerdo'
const SURFACES = ['terminal', 'desktop'] as const
const BAND = {
  hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 11 }, view: {},
}
const PANE = { title: 'Questions', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BOARD = 'http://askerdo.localhost:53265/0123456789abcdef0123456789abcdef/#p=proj'
const mount = ($: any, surface: string) => $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
const rowKeys = async (ui: any) => ((await ui.find({ key: 'needs-you' }))?.children || []).map((r: any) => r.props.key)
/* a chip's words: T-92, the desktop's face beside its badge, the terminal's Button */
const labels = async (ui: any) => {
  const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('answer-'))
  return Promise.all(keys.map(async (k: string) => String(((await ui.find({ key: 'chipface-' + k.slice(7) })) || (await ui.find({ key: k })))!.text).trim()))
}

/* on TR-3, the track this session holds, so the band shows it */
function oneQuestion(w: any) {
  w.questions = [
    { id: 'Q106', name: 'store shape', blocking: true, track: 'TR-3', subscribers: ['other'], pick: 'b', crux: 'one file or many',
      created: new Date(Date.now() - 3 * 3600000).toISOString(),
      options: [{ type: 'a', option: 'one file', costsYou: 'merge churn', undo: 'one-way: the split files are gone' },
        { type: 'b', option: 'many files', costsYou: 'more files to scan' }] },
  ]
}

function threeQuestions(w: any) {
  oneQuestion(w)
  w.questions.unshift({ id: 'Q107', name: 'mine, not blocking', blocking: false, subscribers: ['sess-1'], pick: null,
    options: [{ type: 'a', option: 'yes' }, { type: 'b', option: 'no' }] })
  w.questions.push({ id: 'Q108', name: 'someone else, not blocking', blocking: false, subscribers: ['other'], options: [] })
}

describe('the band', () => {
  /* on the desktop the status row always draws */
  test('nothing open and nothing waiting draws no band and the app\'s content still draws; the shelf alone draws none; the desktop keeps its status row', async ($: any, on: any) => {
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
        expect([col.props.rowGap, col.children.map((c: any) => c.props.key)]).toEqual([undefined, ['askerdo-status', 'engine-band']])
      }
      await ui.unmount()
    }
  })

  test('one open question is one row: its name, letter-and-name chips with the pick primary and starred, no token, ending at its age; a bubble on the desktop', async ($: any, on: any) => {
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
      expect([await rowKeys(ui), !!(await ui.find({ key: 'qnow-Q106' })), answered(), w.prompts.length]).toEqual([['q-Q106', 'qbandstrip-Q106'], true, 0, 0])
      if (surface === 'desktop') expect((await ui.find({ key: 'chipface-106a' }))!.props.borderColor).toBe(SKY)
      else expect((await ui.find({ key: 'answer-106a' }))?.props.variant).toBe('primary')
      await ui.press({ key: 'qqueue-Q106' })
      expect([await rowKeys(ui), !!(await ui.find({ key: 'queued-send' })), answered()]).toEqual([['q-Q106', 'band-foot'], true, 0])
      await pressAgain(ui, 'answer-106a')
      await ui.press({ key: 'qunqueue-Q106' })
      expect([await rowKeys(ui), answered()]).toEqual([['q-Q106'], 0])
      await ui.unmount()
    }
    /* Home's copy keeps the words it has room for; narrower, the pick keeps its star
       and the row's gaps close, so the name takes their room before it cuts.
       narrower still, the mark, the chips and the age stay the row and the name draws
       whole under them, across at most two lines; a name that fits keeps one row */
    const gaps: number[] = []
    for (const [cols, words, own, name] of [[62, true, false, 'store shape'], [40, false, false, 'store shape'], [24, false, true, 'store shape for every board']] as const) {
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
      if (own) {
        const said = (n: any): string => (typeof n === 'string' ? n : (n.children || []).map(said).join(''))
        const lines = (await pane.find({ key: 'qlines-Q106' }))!.children.map((l: any) => said(l).trim())
        expect([lines.length, lines.join(' ')]).toEqual([2, name])
      }
      await pane.unmount()
    }
    expect(gaps[1]).toBeLessThan(gaps[0])
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
    await $.tool.call({ tool: 'mcp__askerdo__handoff_write', focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
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
    /* a resume takes a track again, so the band is live and draws what came in */
    await $.command.run({ command: 'askerdo', args: 'resume TR-4' })
    await w.clock.settle()
    const live = await mount($, 'terminal')
    expect(await live.find({ key: 'closed' })).toBeUndefined()
    /* Q106 stays with TR-3, which this session no longer holds */
    expect((await live.find({ key: 'count-mark' }))?.text).toContain('2 open')
    await live.unmount()
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

  for (const surface of SURFACES) {
    test('pressing the starred chip accepts the pick through the CLI answer, toasts, and redraws (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      oneQuestion(w)
      /* Answer presses at once: the chip records with no strip */
      w.alias = { alias: '', presses: 'once' }
      await start($, w)
      const ui = await mount($, surface)
      await ui.press({ key: 'answer-106b' })
      expect(w.last('answer').args).toEqual(['answer', 'Q106', '--pick', 'b', '--user', 'sess-1', '--json'])
      expect(w.toasts.at(-1)).toContain('106b')
      /* the press is the user's act, so this idle session starts one turn carrying it */
      await w.clock.settle()
      expect(w.prompts.at(-1)).toContain('106b')
      expect(await ui.find({ key: 'q-Q106' })).toBeUndefined()
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
      await $.tool.call({ tool: 'mcp__askerdo__handoff_write', focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
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
  }

  test('a burst of presses answers one at a time and every one lands; a failed chip says so and a press retries', async ($: any, on: any) => {
    const w = world(on)
    threeQuestions(w)
    w.questions.push({ id: 'Q109', name: 'third ask', blocking: false, subscribers: ['sess-1'], pick: null, options: [{ type: 'a', option: 'go' }] })
    /* at once, so each pane press records */
    w.alias = { alias: '', presses: 'once' }
    await start($, w)
    /* the band's answers and the pane's run through one queue */
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE_ID, props: PANE })
    await pane.press({ key: 'tab-questions' })
    w.slowAnswers = true
    await Promise.all(['pick-106a', 'pick-107b', 'pick-109a'].map((key) => pane.press({ key })))
    await w.clock.settle()
    expect(w.cliRuns().filter((r: any) => r.args[0] === 'answer').map((r: any) => r.args[1]).sort()).toEqual(['Q106', 'Q107', 'Q109'])
    expect(w.maxActive).toBe(1)
    expect(w.questions.map((q: any) => q.id)).toEqual(['Q108'])
    await pane.unmount()
    w.slowAnswers = false
    w.questions.push({ id: 'Q110', name: 'lock', blocking: false, subscribers: ['sess-1'], pick: null, options: [{ type: 'a', option: 'go' }] })
    w.marker += '+'
    await w.clock.advance(15000)
    await w.clock.settle()
    const ui = await mount($, 'desktop')
    w.fail.answer = 'store lock still held after 30000ms; nothing was written'
    await ui.press({ key: 'answer-110a' })
    await w.clock.settle()
    /* a failure puts the chip back and the toast says why */
    expect((await ui.findAll({ type: 'Button' })).some((b: any) => String(b.key).startsWith('answer-110a'))).toBe(true)
    expect(w.toasts.at(-1)).toMatch(/store lock still held/)
    delete w.fail.answer
    /* a pressed chip vanishes at once with its row, no done or saving look, and stays gone */
    w.answerWait = 1000
    await pressAgain(ui, 'answer-110a')
    expect(await ui.find({ key: 'q-Q110' })).toBeUndefined()
    expect(JSON.stringify(await ui.find({ key: 'needs-you' }) || '').match(new RegExp(DONE + '|' + SAVING))).toBeNull()
    await w.clock.advance(1000)
    await w.clock.settle()
    expect(await ui.find({ key: 'q-Q110' })).toBeUndefined()
    await ui.unmount()
  })

  test('a root the project\'s settings name rides every spawn, a band answer\'s included', async ($: any, on: any) => {
    const w = world(on)
    oneQuestion(w)
    w.files[w.cwd + '/.claude/settings.json'] = JSON.stringify({ env: { ASKERDO_ROOT: 'C:/wrong' } })
    w.files[w.cwd + '/.claude/settings.local.json'] = JSON.stringify({ env: { ASKERDO_ROOT: 'C:/sandbox/askerdo' } })
    await start($, w)
    const ui = await mount($, 'desktop')
    await ui.press({ key: 'answer-106b' })
    await ui.press({ key: 'qnow-Q106' })
    expect(w.last('answer').env.ASKERDO_ROOT).toBe('C:/sandbox/askerdo')
    expect(w.runs.every((r: any) => r.env && r.env.ASKERDO_ROOT === 'C:/sandbox/askerdo')).toBe(true)
    await ui.unmount()
  })

  test('the shelf leaves the band: the status row\'s count opens the pane on Tracks, its AskerDo press on Home; the first read announces nothing', async ($: any, on: any) => {
    const w = world(on)
    w.shelf.push({ track: 'TR-6', handoff: 'TR-6.1', name: 'next line', state: 'waiting', age: '1h', focus: 'go on' })
    await start($, w)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await rowKeys(ui)).toEqual(['q-Q106'])
      await ui.unmount()
    }
    const ui = await mount($, 'desktop')
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE_ID, props: PANE })
    await ui.press({ key: 'status-shelf-open' })
    await w.clock.settle()
    expect(await pane.find({ key: 'tracks-bottom' })).toBeDefined()
    await ui.press({ key: 'askerdo-open' })
    await w.clock.settle()
    expect(await pane.find({ key: 'home' })).toBeDefined()
    /* a press hands the keys to the pane, so the desktop puts no focus back on the button */
    expect(w.panes.map((p: any) => [p.id, p.focus])).toEqual([[PANE_ID, true], [PANE_ID, true]])
    await pane.unmount()
    await ui.unmount()
    expect(w.toasts).toEqual([])
    expect(w.fetches).toEqual([])
  })

  test('a desktop press keeps every card in the tree and hands the focus off its button: the redraw draws it under its other key, so the app restores no focus there', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const ui = await mount($, 'desktop')
    const carded = async (key: string) => ((await ui.find({ key }))!.children || []).some((c: any) => c.props && c.props.display === 'none')
    const toggles = async () => (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('status-guard-toggle'))
    expect([await toggles(), await carded('status-guard'), await carded('status-mark')]).toEqual([['status-guard-toggle'], true, true])
    await ui.press({ key: 'status-guard-toggle' })
    await ui.redraw()
    const moved = await toggles()
    expect(moved).toHaveLength(1)
    expect(moved[0]).not.toBe('status-guard-toggle')
    expect([await carded('status-guard'), await carded('status-mark'), !!(await ui.find({ key: 'band-and-box' }))]).toEqual([true, true, true])
    /* the next press of that button hands it off again, back under the first key */
    await ui.press({ key: moved[0] })
    await ui.redraw()
    expect(await toggles()).toEqual(['status-guard-toggle'])
    expect(await carded('status-guard')).toBe(true)
    await ui.unmount()
  })

  test('the band follows the store on the poll, and never reads the usage for it', async ($: any, on: any) => {
    const w = world(on)
    w.questions = []
    delete w.tracks[0].session
    await start($, w)
    const reads = w.usageCalls
    const ui = await mount($, 'terminal')
    expect(await ui.find({ key: 'needs-you' })).toBeUndefined()
    threeQuestions(w)
    /* TR-3 held by none, Q106 is its asker's */
    w.questions.find((q: any) => q.id === 'Q106').session = 'sess-1'
    await w.clock.advance(15000)
    await w.clock.settle()
    expect(await ui.find({ key: 'needs-you' })).toBeUndefined()
    w.marker = '2026-10#2'
    await w.clock.advance(15000)
    await w.clock.settle()
    expect((await ui.find({ key: 'count-mark' }))?.text).toContain('2 open')
    expect(w.usageCalls).toBe(reads)
    await ui.unmount()
  })

  /* the local board's band in one call, freshened by its held request */
  test('with a local board the band is its one read, the long poll redraws it when a change lands, with no timer, armed again after a freeze lifts, and the band says when the board is offline or the local server could not start', async ($: any, on: any) => {
    const w = world(on)
    w.localServer()
    const q = (id: string, name: string, session: string | null = 'sess-1') => ({ id, key: id.toLowerCase() + 'abcd', name, blocking: true, session, subscribers: [], pick: 'a',
      options: [{ type: 'a', option: 'yes' }, { type: 'b', option: 'no' }] })
    /* another track's blocking question in this session's scope draws no row and counts on no line */
    const theirs = q('Q105', 'their port', null)
    let qs = [theirs, q('Q106', 'store shape')]
    w.near = () => ({ questions: qs, model: bandModel({ questions: qs, shelfRows: [], sid: 'sess-1' }), shelf: [], profilesAt: 1, links: {} })
    await start($, w)
    const ui = await mount($, 'terminal')
    expect([!!(await ui.find({ key: 'name-Q106' })), !!(await ui.find({ key: 'name-Q105' }))]).toEqual([true, false])
    /* none of the store's four reads ran, through the route or as a process */
    expect(w.routed.filter((c: any) => ['activity', 'list', 'shelf'].includes(c.argv[0]))).toEqual([])
    expect(w.cliRuns().filter((r: any) => r.via === 'process')).toEqual([])
    qs = [theirs, q('Q106', 'store shape'), q('Q107', 'a second')]
    w.change()
    await w.clock.settle()
    expect((await ui.find({ key: 'count-mark' }))?.text).toContain('2 open')
    /* a reply closed finished freezes the band and stops the chain; a reply that is not
       lifts it, the next tick arms the long poll again and draws what came in meanwhile */
    const reply = async (turnId: string, answer: string) => {
      await $.turn.start({ text: 'work', turnId })
      await $.turn.complete({ answer, durationMs: 5, isAborted: false, turnId, reason: 'answer' })
    }
    await reply('t1', FLAG + ' Done.')
    qs = [...qs, q('Q108', 'a third')]
    w.change()
    await w.clock.settle()
    expect((await ui.find({ key: 'count-mark' }))?.text).toContain('2 open')
    await reply('t2', 'More to do.')
    await w.clock.advance(15000)
    await w.clock.settle()
    expect((await ui.find({ key: 'count-mark' }))?.text).toContain('3 open')
    qs = [...qs, q('Q109', 'a fourth')]
    w.change()
    await w.clock.settle()
    expect((await ui.find({ key: 'count-mark' }))?.text).toContain('4 open')
    /* the band says when the local board lost the board, and stops saying it */
    const live = w.near
    w.near = () => ({ ...live(), online: false, offline: true, stale: true, board: 'board offline' })
    w.change()
    await w.clock.settle()
    expect((await ui.find({ key: 'band-offline' }))?.text).toContain('board offline')
    w.near = live
    w.change()
    await w.clock.settle()
    expect(await ui.find({ key: 'band-offline' })).toBeUndefined()
    /* the local server gone and its start refused, the band says why; no store read stands in */
    w.serverDown = true
    w.fail.board = 'the port is taken'
    w.change()
    await w.clock.settle()
    expect((await ui.find({ key: 'band-offline' }))?.text).toContain('the port is taken')
    expect(w.cliRuns().filter((r: any) => ['activity', 'list', 'shelf'].includes(r.args[0]))).toEqual([])
    await ui.unmount()
  })

  test('a write of the mod\'s own redraws the band with no poll', async ($: any, on: any) => {
    const w = world(on)
    oneQuestion(w)
    await start($, w)
    const ui = await mount($, 'desktop')
    expect(await ui.find({ key: 'q-Q106' })).toBeDefined()
    await $.command.run({ command: 'askerdo', args: '106b' })
    await w.clock.settle()
    /* a typed answer waits for the next prompt, so only its row goes */
    expect(await ui.find({ key: 'q-Q106' })).toBeUndefined()
    await ui.unmount()
  })

  test('the board\'s calls draw as rows with their presses; a press runs its verb as the user and in the asking session starts its turn; several overrides fold to a count; a problem askerdo status lists leads them with its fix, is looked at again when local.json moves, its press runs the fix, and a clean readout draws none', async ($: any, on: any) => {
    const w = world(on)
    w.questions = []
    w.health = { problems: [{ key: 'server', says: 'this PC\'s local server runs AskerDo 0.8.9 and this plugin is 0.8.13', fix: 'run askerdo board --restart', command: 'board --restart' }] }
    const since = '2026-10-27T10:00:00.000Z'
    const look = { kind: 'look', record: 'k5', id: 'T-5', text: 'T-5 band rows: its work landed, and it closes at your look', since,
      presses: [{ label: 'Close', verb: 'editRecord', input: { id: 'k5', kind: 'task', status: 'completed' } }, { label: 'Not yet', verb: 'lookNotYet', input: { task: 'k5' } }] }
    const override = (n: number, mine: boolean) => ({ kind: 'override', record: 'kk' + n, id: 'K-' + n, request: n, text: 'Reword K-' + n + ' (one record)', since, mine,
      presses: [{ label: 'Allow', verb: 'overrideDecide', input: { request: n, decision: 'allow' } }, { label: 'Keep', verb: 'overrideDecide', input: { request: n, decision: 'keep' } }] })
    w.calls = [look, { ...override(3, true), result: { request: 3, decision: 'allow', records: ['K-3'], asker: 'sess-1' },
      told: { session: 'sess-1', event: { key: 'seq:93', line: 'Override #3 (K-3) was allowed by the user: the change is applied.',
        raw: { kind: 'override', id: 'K-3', name: '', request: '#3', decided: 'allow', records: ['K-3'], by: 'user:sess-1', seq: 93 } } } }]
    await start($, w)
    const pressKeys = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('callpress-'))
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect((await rowKeys(ui)).filter((k: string) => k.startsWith('call-')).length).toBe(3)
      expect((await pressKeys(ui)).length).toBe(5)
      expect((await ui.find({ key: (await rowKeys(ui))[0] }))!.text).toMatch(/0\.8\.9[^]*Restart/)
      if (surface === 'desktop') expect((await ui.find({ key: 'askerdo-status' }))!.text).toContain('local server')
      /* a desktop row spans the band, its words cut before its presses;
         its tooltip is the fact card, the terminal's one line */
      const key = (await rowKeys(ui)).find((k: string) => k.startsWith('call-look'))!.slice(5)
      expect([(await ui.find({ key: 'call-' + key }))!.props.alignSelf, (await ui.find({ key: 'ctext-' + key }))!.props.minWidth])
        .toEqual([surface === 'terminal' ? 'flex-start' : undefined, 0])
      expect(!!(await ui.find({ key: 'card-call-' + key + '-head' }))).toBe(surface === 'desktop')
      await ui.unmount()
    }
    const ui = await mount($, 'desktop')
    /* a poll tick with board/local.json unmoved looks no sooner than the minute; once the
       sync's new server rewrites it, the next tick looks again */
    const healthText = async () => (await ui.find({ key: (await rowKeys(ui)).find((k: string) => k.startsWith('call-health'))! }))!.text
    const statusRuns = () => w.runs.filter((r: any) => r.args[0] === 'status').length
    const ran = statusRuns()
    await w.clock.advance(15000)
    await w.clock.settle()
    /* the first poll after a new problem reads its baseline and runs no second status */
    expect(statusRuns()).toBe(ran)
    w.health = { problems: [{ ...w.health.problems[0], says: 'the local server runs AskerDo 0.8.12' }] }
    await w.clock.advance(15000)
    await w.clock.settle()
    expect(await healthText()).toMatch(/0\.8\.9/)
    w.serverAt(w.env.USERPROFILE + '/.claude/askerdo')
    await w.clock.advance(15000)
    await w.clock.settle()
    expect(await healthText()).toMatch(/0\.8\.12/)
    /* the fix runs here as a process, and once the readout is clean the row goes */
    w.health = { problems: [] }
    await ui.press({ key: (await pressKeys(ui)).find((k: string) => k.startsWith('callpress-0-health'))! })
    await w.clock.settle()
    expect(w.spawns().some((r: any) => r.args.join(' ') === 'board --restart --json')).toBe(true)
    expect((await rowKeys(ui)).some((k: string) => k.startsWith('call-health'))).toBe(false)
    const turns = w.prompts.length
    await ui.press({ key: (await pressKeys(ui)).find((k: string) => k.startsWith('callpress-0-look'))! })
    await w.clock.settle()
    /* a look task nobody here holds: recorded as the user's act, and no turn starts */
    expect(w.verbs[0]).toEqual({ name: 'editRecord', body: { input: look.presses[0].input, user: 'sess-1' } })
    expect(w.prompts.length).toBe(turns)
    /* a track the Allow's reload finds waiting shows after the Allow's toast, not over it */
    w.shelf.push({ track: 'TR-6', handoff: 'TR-6.1', name: 'next line', state: 'waiting', age: '1m', focus: 'write the tests' })
    await ui.press({ key: (await pressKeys(ui)).find((k: string) => k.startsWith('callpress-0-override'))! })
    await w.clock.settle()
    const said = () => w.toasts.map((t: string) => (/Allowed override #3/.test(t) ? 'allow' : /^TR-6 /.test(t) ? 'shelf' : 'other'))
    expect(said().filter((t: string) => t !== 'other')).toEqual(['allow'])
    await w.clock.advance(4000)
    await w.clock.settle()
    expect(said().filter((t: string) => t !== 'other')).toEqual(['allow', 'shelf'])
    expect(w.prompts.at(-1)).toContain('allowed override #3')
    expect(await rowKeys(ui)).toEqual([])
    /* several override requests fold to one count line; its press unfolds their rows */
    w.calls = [override(4, false), override(5, false)]
    w.marker += '+'
    await w.clock.advance(15000)
    await w.clock.settle()
    expect(await rowKeys(ui)).toEqual(['calls-overrides'])
    await ui.press({ key: 'calls-fold' })
    await w.clock.settle()
    expect((await pressKeys(ui)).length).toBe(4)
    await ui.unmount()
  })
})

describe('toasts and the alert', () => {
  test('a track newly waiting toasts and sends the tray alert', async ($: any, on: any) => {
    const w = world(on)
    w.boardUrl = BOARD
    await start($, w)
    w.shelf.push({ track: 'TR-6', handoff: 'TR-6.1', name: 'next line', state: 'waiting', age: '1m', focus: 'write the tests' })
    w.marker = '2026-10#2'
    await w.clock.advance(15000)
    await w.clock.settle()
    expect(w.toasts).toEqual(['TR-6 next line is waiting: write the tests. Resume it with /askerdo resume TR-6.'])
    expect(w.fetches.length).toBe(1)
    expect(w.fetches[0].url).toBe('http://127.0.0.1:53265/0123456789abcdef0123456789abcdef/api/alert')
    expect(w.fetches[0].init.method).toBe('POST')
    /* the name leads, the context in names */
    expect(w.fetches[0].body).toEqual({ kind: 'track', title: 'next line is waiting: write the tests', where: 'next line', card: 'TR-6.1',
      whereNames: { project: 'proj', track: 'next line' } })
    /* a restarted local board answers before its first snapshot with no shelf; the read
       after it announces no track that waited all along */
    w.near = (s: string, p: string, l: string) => ({ ...w.bandOf(s, p, l), loaded: false, shelf: [] })
    w.marker = '2026-10#3'
    await w.clock.advance(15000)
    await w.clock.settle()
    w.near = (s: string, p: string, l: string) => w.bandOf(s, p, l)
    w.marker = '2026-10#4'
    await w.clock.advance(15000)
    await w.clock.settle()
    expect(w.toasts.length).toBe(1)
  })

  test('handoffs on one track in a burst queue one toast, the newest, and its alert as it shows', async ($: any, on: any) => {
    const w = world(on)
    w.boardUrl = BOARD
    await start($, w)
    const row = (n: number) => ({ track: 'TR-6', handoff: 'TR-6.' + n, name: 'next line', state: 'waiting', age: '0m', focus: 'step ' + n })
    w.shelf.push(row(1))
    for (const n of [1, 2, 3]) {
      w.shelf[0] = row(n)
      w.marker = '2026-10#' + (n + 1)
      await w.clock.advance(1000)
      await w.clock.settle()
    }
    expect(w.toasts.length).toBe(1)
    await w.clock.advance(8000)
    await w.clock.settle()
    expect(w.toasts.length).toBe(2)
    expect(w.toasts[1]).toContain('step 3')
    expect(w.fetches.map((f: any) => f.body.card)).toEqual(['TR-6.1', 'TR-6.3'])
  })

  test('a handoff written toasts once and sends the handoff alert; its own waiting row sends nothing more', async ($: any, on: any) => {
    const w = world(on)
    w.boardUrl = BOARD
    await start($, w)
    const r = await $.tool.call({ tool: 'mcp__askerdo__handoff_write', focus: 'write the tests', state: 'Done: core.',
      verifyFirst: [{ path: 'C:/src/proj' }] })
    expect(r.result).toContain('Wrote TR-3.5 (waiting)')
    expect(w.toasts).toEqual(['Handoff TR-3.5 written (waiting) on TR-3.'])
    w.shelf.push({ track: 'TR-3', handoff: 'TR-3.5', name: 'mod core', state: 'waiting', age: '0m', focus: 'write the tests' })
    w.marker = '2026-10#3'
    await w.clock.advance(15000)
    await w.clock.settle()
    expect(w.toasts).toEqual(['Handoff TR-3.5 written (waiting) on TR-3.'])
    expect(w.fetches.map((f: any) => f.body)).toEqual([{ kind: 'handoff', title: 'mod core handed off at 60 percent: write the tests',
      where: 'mod core', card: 'TR-3.5', whereNames: { project: 'proj', workstream: 'the board', track: 'mod core' } }])
  })

  test('the alert fails open: no board address sends nothing, a refusal throws nothing', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    w.shelf.push({ track: 'TR-6', handoff: 'TR-6.1', name: 'next line', state: 'waiting', age: '1m', focus: 'f' })
    w.marker = '2026-10#2'
    await w.clock.advance(15000)
    await w.clock.settle()
    expect(w.toasts.length).toBe(1)
    expect(w.fetches).toEqual([])
    w.boardUrl = BOARD
    w.fetchAnswer = { status: 503, ok: false, headers: {}, text: '{"error":"no tray attached"}' }
    w.shelf.push({ track: 'TR-7', handoff: 'TR-7.1', name: 'third', state: 'waiting', age: '1m', focus: 'g' })
    w.marker = '2026-10#3'
    await w.clock.advance(15000)
    await w.clock.settle()
    expect(w.toasts.length).toBe(2)
    expect(w.fetches.length).toBe(1)
  })
})

describe('the prompt section', () => {
  const compose = ($: any, surfaces: string[]) => $.prompt.compose({
    model: 'm', promptModel: 'm', surfaces, tools: [], outputStyle: null, traits: [],
  })

  test('where the band draws, the model is told it carries the queue', async ($: any, on: any) => {
    const w = world(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'core', scope: 'shared' }] }))
    await start($, w)
    for (const surface of SURFACES) {
      const r = await compose($, [surface])
      const band = r.sections.find((s: any) => s.id === 'askerdo:band')
      expect(band.scope).toBe('session')
      expect(band.text).toContain('write no names line')
    }
  })
})
