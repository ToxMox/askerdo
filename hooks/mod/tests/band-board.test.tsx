/* The Needs-you band against the board under `claude plugin test`: a slow board, a burst
 * of presses, the poll and the long poll, the board's calls on Home, and the toasts and the tray alert. */
import { describe, expect, test } from 'claude-code/testing'
import { HEAVY, plain, pressAgain, start, world } from './world.ts'
import { bandModel } from '../../../lib/mod-core.mjs'
import { runsInCaller } from '../../../lib/caller-runs.mjs'
import { PLUGIN, FLAG, DONE, SAVING, PANE_ID, SURFACES, BAND, PANE, BOARD, cooled, mount, rowKeys, oneQuestion, threeQuestions } from './band-kit.ts'

describe('the band', () => {
  /* on a board slower than the 400 ms bound the done state draws alone at the bound, and the
     reload and the turn's take that land later wait for the gate like any passive update */
  test('a slow board draws an answer\'s done state at the bound and its late reload and take through the gate', async ($: any, on: any) => {
    const w = world(on)
    oneQuestion(w)
    w.alias = { alias: '', presses: 'once' }
    const slowAsks: string[] = []
    on('state.set', ($: any, e: any, next: any) => { if (e.key === 'drawn') slowAsks.push(e.id); return next(e) })
    await start($, w)
    const ui = await mount($, 'terminal')
    await cooled(w)
    await cooled(w)
    /* the reload's read lands at 600 ms, the turn's take told at 800 ms */
    w.fetchBy['/local/band?'] = async (e: any) => { await w.clock.sleep(600); return w.serverBy['/local/band?'](e) }
    w.fetchBy['/local/wait?'] = async (e: any) => { if (String(e.url).includes('ms=3000')) await w.clock.sleep(800); return w.serverBy['/local/wait?'](e) }
    const slowStep = async (ms: number) => { const at = slowAsks.length; await w.clock.advance(ms); await w.clock.settle(); return slowAsks.slice(at).sort() }
    await ui.press({ key: 'answer-106b' })
    await w.clock.settle()
    const atBound = await slowStep(450)
    const atReload = await slowStep(200)
    const atTake = await slowStep(200)
    const gated = await slowStep(2000)
    const once = (ids: string[]) => ids.every((id, i) => id !== ids[i + 1])
    /* the turn's take landed: its prompt went */
    expect([atBound, atReload, atTake, w.prompts.length]).toEqual([['band', 'pane', 'q Q106'], [], [], 1])
    expect([gated.includes('band'), once(gated)]).toEqual([true, true])
    await ui.unmount()
  })

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
    /* the band's count writes, each one draw of it */
    let bands = 0
    on('state.set', ($: any, e: any, next: any) => { if (e.key === 'drawn' && e.id === 'band') bands++; return next(e) })
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'ag-1' }))
    const copies: any[] = []
    on('ui.copy', (_: any, e: any) => { copies.push(e); return { value: { isCopied: true } } })
    await start($, w)
    const ui = await mount($, 'terminal')
    await cooled(w)
    expect([!!(await ui.find({ key: 'name-Q106' })), !!(await ui.find({ key: 'name-Q105' }))]).toEqual([true, false])
    /* none of the store's four reads ran, through the route or as a process */
    expect(w.routed.filter((c: any) => ['activity', 'list', 'shelf'].includes(c.argv[0]))).toEqual([])
    expect(w.cliRuns().filter((r: any) => r.via === 'process' && !runsInCaller(r.args))).toEqual([])
    /* an agent's start and end move the flights, which the terminal's band never reads: no draw */
    const was = bands
    await $.agent.spawn({ description: 'Band lane', prompt: 'Go.', tool_use_id: 'tu-1' })
    await cooled(w)
    await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't-ag-1', reason: 'answer', agentId: 'ag-1' })
    await cooled(w)
    expect(bands - was).toBe(0)
    qs = [theirs, q('Q106', 'store shape'), q('Q107', 'a second')]
    w.change()
    await cooled(w)
    await cooled(w)
    /* one board change draws the band once */
    expect([(await ui.find({ key: 'count-mark' }))?.text, bands - was]).toEqual([expect.stringContaining('2 open'), 1])
    /* a reply closed finished freezes the band and stops the chain; a reply that is not
       lifts it, the next tick arms the long poll again and draws what came in meanwhile */
    const reply = async (turnId: string, answer: string) => {
      await $.turn.start({ text: 'work', turnId })
      await $.turn.complete({ answer, durationMs: 5, isAborted: false, turnId, reason: 'answer' })
    }
    await reply('t1', FLAG + ' Done.')
    qs = [...qs, q('Q108', 'a third')]
    w.change()
    await cooled(w)
    expect((await ui.find({ key: 'count-mark' }))?.text).toContain('2 open')
    await reply('t2', 'More to do.')
    await w.clock.advance(15000)
    await w.clock.settle()
    expect((await ui.find({ key: 'count-mark' }))?.text).toContain('3 open')
    qs = [...qs, q('Q109', 'a fourth')]
    w.change()
    await cooled(w)
    expect((await ui.find({ key: 'count-mark' }))?.text).toContain('4 open')
    /* the band says when the local board lost the board, and stops saying it */
    const live = w.near
    /* an offline spell's first draw looks once, however often it draws; the stopped board's
       problem has no fix to press, so the row reads as it did with no check */
    const statusRuns = () => w.runs.filter((r: any) => r.args[0] === 'status').length
    const looked = statusRuns()
    w.health = { problems: [{ key: 'board', says: 'the board at x does not answer', fix: 'check the PC the board runs on' }] }
    w.near = () => ({ ...live(), online: false, offline: true, stale: true, board: 'board offline' })
    for (let i = 0; i < 3; i++) { w.change(); await cooled(w) }
    expect([(await ui.find({ key: 'band-offline' }))?.text, statusRuns() - looked]).toEqual([expect.stringContaining('board offline'), 1])
    expect((await ui.find({ key: 'band-offline' }))!.text).not.toContain('check the PC')
    w.health = { problems: [] }
    /* alone on the desktop band at 238 px the offline line is one cut line: no Text nested in its cut Text */
    const kept = qs
    qs = []
    w.change()
    await cooled(w)
    const desk = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 28 } })
    const row = (await desk.find({ key: 'band-offline' }))!
    const cut = (await desk.findAll({ type: 'Text' })).filter((t: any) => /^truncate/.test(String(t.props.wrap)) && plain(t.text).includes('last copy'))
    expect([!!row, cut.length, cut.every((t: any) => [].concat(t.children || []).every((c: any) => !c || c.type !== 'Text'))]).toEqual([true, 1, true])
    await desk.unmount()
    qs = kept
    w.change()
    await cooled(w)
    /* a board that refuses this PC's protocol draws no offline line and no band row:
       the status row's chip and Home name the update, and /askerdo leads with it */
    const one = [q('Q106', 'store shape')]
    w.near = () => ({ ...live(), questions: one, model: bandModel({ questions: one, shelfRows: [], sid: 'sess-1' }), online: false, offline: true, stale: true, board: 'board offline: refused',
      protocol: { key: 'board', says: 'update the board server: it speaks protocol 1 and this PC 2, so it refuses this PC', fix: 'back it up, then rebuild it', pc: 2, board: 1 } })
    w.change()
    await cooled(w)
    expect([await ui.find({ key: 'band-offline' }), (await rowKeys(ui)).filter((k: string) => k.startsWith('call'))]).toEqual([undefined, []])
    /* its cached chips draw with no press, since none could land */
    expect([await ui.find({ key: 'answer-106a' }), !!(await ui.find({ key: 'answerstill-106a' }))]).toEqual([undefined, true])
    expect((await $.command.run({ command: 'askerdo', args: '' })).text).toMatch(/needs a fix: Update the board server/)
    w.near = live
    w.change()
    await cooled(w)
    expect(await ui.find({ key: 'band-offline' })).toBeUndefined()
    /* a new spell looks again, and the join code a refused token needs reaches the offline row's card */
    w.health = { problems: [{ key: 'board', says: 'the board does not know this PC\'s token', fix: 'run askerdo join-code --device this-pc and then git cherry-pick fix/card-wrap. A follow-up: node scripts/run-tests.mjs, then join again', copy: 'askerdo join-code --device this-pc' }] }
    w.near = () => ({ ...live(), online: false, offline: true, stale: true, board: 'board offline: the board does not know this token' })
    const spell = statusRuns()
    for (let i = 0; i < 3; i++) { w.change(); await cooled(w) }
    const joined = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 28 } })
    expect([plain((await joined.find({ key: 'offline-chip' }))!.text).includes('askerdo join-code'), statusRuns() - spell]).toEqual([true, 1])
    /* each word of the askerdo command on the card's lines holds whole at its hyphens; the sentence
       after it and another program's command (whose CLI would read the joiner) keep plain hyphens */
    const said = (await joined.findAll({ type: 'Text' })).map((t: any) => String(t.text)).filter((t: string) => plain(t).includes('join-code'))
    const loose = (t: string, w: string) => new RegExp('(' + w + ')-(?!' + String.fromCharCode(0x2060) + ')').test(t)
    expect([said.some((t) => plain(t).includes('run-tests') && plain(t).includes('cherry')), said.filter((t) => loose(t, 'join|this|-')),
      said.filter((t) => plain(t).includes('run-tests') && !(loose(t, 'follow') && loose(t, 'run') && loose(t, 'cherry') && loose(t, 'card')))])
      .toEqual([true, [], []])
    await joined.unmount()
    w.near = live
    w.change()
    await cooled(w)
    /* the board's no-press problem listed first hides no fix listed after it */
    w.health = { problems: [{ key: 'board', says: 'the board at x does not answer', fix: 'check the PC the board runs on' },
      { key: 'tray', says: 'the tray is not running', fix: 'run askerdo board', command: 'board' }] }
    w.near = () => ({ ...live(), online: false, offline: true, stale: true, board: 'board offline' })
    for (let i = 0; i < 2; i++) { w.change(); await cooled(w) }
    const tray = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 28 } })
    const chip = plain((await tray.find({ key: 'offline-chip' }))!.text)
    expect([chip.includes('run askerdo board'), chip.includes('check the PC')]).toEqual([true, false])
    await tray.unmount()
    w.health = { problems: [] }
    w.near = live
    w.change()
    await cooled(w)
    /* a replaced local server answers offline until it reaches the board, then online with no
       write, so the board's seq never moves; the row clears within two beats all the same */
    w.near = () => ({ ...live(), online: false, offline: true, stale: true, board: 'board offline' })
    w.change()
    await cooled(w)
    await w.clock.advance(15000)
    await w.clock.settle()
    expect(!!(await ui.find({ key: 'band-offline' }))).toBe(true)
    w.near = live
    for (let i = 0; i < 2; i++) { await w.clock.advance(15000); await w.clock.settle() }
    expect(await ui.find({ key: 'band-offline' })).toBeUndefined()
    /* the local server gone and its start refused, the band says why; no store read stands in */
    const ran = w.cliRuns().length
    w.health = { problems: [{ key: 'server', says: 'the local server could not start', fix: 'free the port', copy: 'askerdo board --restart' }] }
    w.serverDown = true
    w.fail.board = 'the port is taken: free it or run askerdo board --restart'
    w.change()
    await cooled(w)
    expect((await ui.find({ key: 'band-offline' }))?.text).toContain('the port is taken')
    /* at the pane's narrowest width, the questions leading the band's one line, the
       board offline is its amber chip; its card holds every word and the fix's command, and its press copies
       the command as the health chip's does */
    await w.clock.advance(1000)
    await w.clock.settle()
    const narrow = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 28 } })
    const off = (await narrow.find({ key: 'offline-chip' }))!
    expect(['the port is taken', 'free the port', 'copy askerdo board --restart'].map((s) => plain(off.text).includes(s))).toEqual([true, true, true])
    await narrow.press({ key: 'offline-fix' })
    await w.clock.settle()
    expect(copies.map((e: any) => e.text)).toEqual(['askerdo board --restart'])
    await narrow.unmount()
    w.health = { problems: [] }
    expect(w.cliRuns().slice(ran).filter((r: any) => ['activity', 'list', 'shelf'].includes(r.args[0]))).toEqual([])
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

  test('the board\'s calls draw on Home, never on the band: a press runs its verb as the user and in the asking session starts its turn; several overrides fold to a count; the PC\'s problem is the status row\'s chip, looked at again when local.json moves, and its press runs the fix', HEAVY, async ($: any, on: any) => {
    const w = world(on)
    w.questions = []
    w.health = { problems: [{ key: 'server', says: 'this PC\'s local server runs AskerDo 0.8.9 and this plugin is 0.8.13', fix: 'run askerdo board --restart', command: 'board --restart' }] }
    const since = '2026-10-27T10:00:00.000Z'
    const look = { kind: 'look', record: 'k5', id: 'T-5', text: 'T-5 band rows: its work landed, and it closes at your look', since,
      presses: [{ label: 'Close', verb: 'editRecord', input: { id: 'k5', kind: 'task', status: 'done' } }, { label: 'Not yet', verb: 'lookNotYet', input: { task: 'k5' } }] }
    const override = (n: number, mine: boolean) => ({ kind: 'override', record: 'kk' + n, id: 'K-' + n, request: n, text: 'Reword K-' + n + ' (one record)', since, mine,
      presses: [{ label: 'Fix', verb: 'overrideDecide', input: { request: n, decision: 'allow' } }, { label: 'Keep', verb: 'overrideDecide', input: { request: n, decision: 'keep' } }] })
    w.calls = [look, { ...override(3, true), result: { request: 3, decision: 'allow', records: ['K-3'], asker: 'sess-1' },
      told: { session: 'sess-1', event: { key: 'seq:93', line: 'Override #3 (K-3) was allowed by the user: the change is applied.',
        raw: { kind: 'override', id: 'K-3', name: '', request: '#3', decided: 'allow', records: ['K-3'], by: 'user:sess-1', seq: 93 } } } }]
    await start($, w)
    const pressKeys = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('callpress-'))
    const callKeys = async (ui: any) => (await ui.findAll({ type: 'Box' })).map((b: any) => String(b.key)).filter((k: string) => /^calls?-/.test(k))
    const home = async (surface: string) => {
      const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE_ID, props: PANE })
      await pane.press({ key: 'tab-home' })
      return pane
    }
    for (const surface of SURFACES) {
      const band = await mount($, surface)
      /* the health check's problem lands at the once a second gate */
      await w.clock.advance(1000)
      await w.clock.settle()
      expect([await callKeys(band), await pressKeys(band)]).toEqual([[], []])
      if (surface === 'desktop') expect((await band.find({ key: 'askerdo-status' }))!.text).toContain('local server')
      await band.unmount()
      const pane = await home(surface)
      expect((await rowKeys(pane)).filter((k: string) => k.startsWith('call-')).length).toBe(3)
      expect((await pressKeys(pane)).length).toBe(5)
      expect((await pane.find({ key: (await rowKeys(pane))[0] }))!.text).toMatch(/0\.8\.9[^]*Restart/)
      await pane.unmount()
      /* on a narrow Home a call's words wrap whole over its presses, never cut */
      const narrow = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE_ID, props: { ...PANE, bodyColumns: 24 } })
      await narrow.press({ key: 'tab-home' })
      const words = (await narrow.findAll({ type: 'Text' })).filter((t: any) => plain(t.text) === look.text)
      expect([words.length, words[0] && words[0].props.wrap, (await pressKeys(narrow)).length]).toEqual([1, 'wrap', 5])
      await narrow.unmount()
    }
    const band = await mount($, 'desktop')
    const ui = await home('desktop')
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
    /* the status row's chip runs the fix here as a process, and once the readout is clean chip and row go */
    w.health = { problems: [] }
    await band.press({ key: 'status-health-fix' })
    await w.clock.settle()
    expect(w.spawns().some((r: any) => r.args.join(' ') === 'board --restart --json')).toBe(true)
    await w.clock.advance(1000)
    await w.clock.settle()
    expect((await rowKeys(ui)).some((k: string) => k.startsWith('call-health'))).toBe(false)
    expect((await band.find({ key: 'askerdo-status' }))!.text).not.toContain('local server')
    const turns = w.prompts.length
    await ui.press({ key: (await pressKeys(ui)).find((k: string) => k.startsWith('callpress-0-look'))! })
    await w.clock.settle()
    /* a look task nobody here holds: recorded as the user's act, and no turn starts */
    expect(w.verbs.filter((v: any) => v.name !== 'renewLease')[0]).toEqual({ name: 'editRecord', body: { input: look.presses[0].input, user: 'sess-1' } })
    expect(w.prompts.length).toBe(turns)
    /* a track the press's reload finds waiting shows after the press's toast, not over it */
    w.shelf.push({ track: 'TR-6', handoff: 'TR-6.1', name: 'next line', state: 'waiting', age: '1m', focus: 'write the tests' })
    await ui.press({ key: (await pressKeys(ui)).find((k: string) => k.startsWith('callpress-0-override'))! })
    await w.clock.settle()
    const said = () => w.toasts.map((t: string) => (/: override #3 /.test(t) ? 'allow' : /^TR-6 /.test(t) ? 'shelf' : 'other'))
    expect(said().filter((t: string) => t !== 'other')).toEqual(['allow'])
    await w.clock.advance(4000)
    await w.clock.settle()
    expect(said().filter((t: string) => t !== 'other')).toEqual(['allow', 'shelf'])
    expect(w.prompts.at(-1)).toContain('allowed override #3')
    expect((await rowKeys(ui)).filter((k: string) => k.startsWith('call'))).toEqual([])
    /* several override requests fold to one count line on Home; its press unfolds their rows */
    w.calls = [override(4, false), override(5, false)]
    w.marker += '+'
    await w.clock.advance(15000)
    await w.clock.settle()
    expect((await rowKeys(ui)).filter((k: string) => k.startsWith('call'))).toEqual(['calls-overrides'])
    expect(await callKeys(band)).toEqual([])
    await ui.press({ key: 'calls-fold' })
    await w.clock.settle()
    expect((await pressKeys(ui)).length).toBe(4)
    await ui.unmount()
    await band.unmount()
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
    const r = await $.tool.call({ tool: 'mcp__askerdo__handoff_write', goal: 'g', focus: 'write the tests', state: 'Done: core.',
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
