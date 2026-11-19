/* The AskerDo pane (its Home and Tracks tabs) and the AskUserQuestion redraw under `claude plugin test`, on the terminal and the desktop. */
import { describe, expect, test } from 'claude-code/testing'
import { COLD_START, HEAVY, plain, pressAgain, start, world } from './world.ts'
import { PX_ROW } from '../home.tsx'
import { paneCells } from '../fold.tsx'

const PLUGIN = 'askerdo'
const PANE_ID = 'askerdo'
const SURFACES = ['terminal', 'desktop'] as const
const PANE = {
  title: 'Tracks', isFocused: true, bodyColumns: 100, placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 }, view: {},
}
/* the AskerDo pane, on its Tracks tab unless another is asked for */
async function mount($: any, surface: string, tab = 'tracks', id = PANE_ID, props = PANE) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: id, props })
  if (tab) await ui.press({ key: 'tab-' + tab })
  return ui
}

/* In WS-11: TR-3 held here, TR-5 held by another session, TR-6 waiting, TR-8 parked, TR-7 done;
   TR-4 parked, so on the shelf of another workstream. */
function shelfWorld(on: any) {
  const w = world(on)
  w.questions = []
  const t = (id: string, name: string, state: string, more: any = {}) => ({ id, key: 'trk' + id.slice(3) + 'abcd', name, state, workstream: 'WS-11',
    text: '0 running, 1 ready, 2 to go', tasks: [], now: [], handoffs: [], ...more })
  w.tracks.push(
    t('TR-5', 'other line', 'active', { session: 'sess-2' }),
    t('TR-6', 'next line', 'waiting', { handoffs: [{ id: 'TR-6.1', status: 'waiting', focus: 'write the tests' }] }),
    t('TR-7', 'finished', 'done'),
    t('TR-8', 'side line', 'parked', { parkReason: 'after the merge' }),
  )
  w.shelf.push(
    { track: 'TR-6', handoff: 'TR-6.1', name: 'next line', state: 'waiting', workstream: 'WS-11', age: '1h', focus: 'write the tests', resume: '/askerdo resume TR-6' },
    { track: 'TR-8', handoff: null, name: 'side line', state: 'parked', workstream: 'WS-11', age: '', parkReason: 'after the merge', noHandoff: true, resume: '/askerdo resume TR-8' },
  )
  return w
}

/* the held card and the tiles, in the order drawn */
const trackKeys = async (ui: any) => (await ui.findAll({ type: 'Box' })).map((b: any) => String(b.key)).filter((k: string) => /^trk-(held|tile)-/.test(k))
const textOf = async (ui: any, key: string) => plain((await ui.find({ key }))?.text)

describe('the AskerDo pane', () => {
  /* a hooks worker respawn starts a fresh copy with its memory gone; a copy before it ran
     this session, so the first draw reads the local server's band and draws it, never the loading line;
     the file's first case, so it takes the cold load */
  test('after a respawn the pane draws the local band at once, never the loading line; a draw that throws keeps its last drawing', COLD_START, async ($: any, on: any) => {
    const w = world(on)
    w.questions = [{ id: 'Q106', name: 'store shape', ask: 'One file or many?', blocking: true, track: 'TR-3', subscribers: ['other'], pick: 'b',
      options: [{ type: 'a', option: 'one file' }, { type: 'b', option: 'many files' }] }]
    /* a snapshot whose shape does not apply is dropped and written over, and the pane draws */
    on('state.get', ($: any, e: any, next: any) => (e.key === 'snapshot' ? { value: { value: { v: 1, starts: 1, view: { tab: 'home', unfolded: 5 } }, version: 1 } } : next(e)))
    let snaps = 0
    on('state.set', ($: any, e: any, next: any) => { if (e.key === 'snapshot') snaps++; return next(e) })
    /* the load the start kicks waits on the clock; the pane draws before it runs */
    await $.session.start({ cwd: w.cwd, surface: null, isInteractive: false })
    const ui = await mount($, 'terminal', '')
    /* the band's loading lines; Home's activity is its own read, which lands at the gate */
    expect(await ui.find({ text: /Reading the (tracks|questions)/ })).toBeUndefined()
    await ui.press({ key: 'tab-questions' })
    expect(await ui.find({ key: 'qcard-Q106' })).toBeDefined()
    await w.clock.settle()
    expect(snaps).toBeGreaterThan(0)
    /* a press's ring row names the surface its own redraw drew first and the writes the mod asked there */
    await ui.press({ key: 'tab-home' })
    const sentFrom = w.reads.length
    w.marker += '+'
    await w.clock.settle()
    const tab = w.reads.slice(sentFrom).map((r: any) => decodeURIComponent(String(r.url)))
      .flatMap((u: string) => { const m = /[?&]rings=([^&]*)/.exec(u); try { return m ? JSON.parse(m[1]) : [] } catch { return [] } })
      .find((r: any) => r && r.c === 'tab' && r.k === 'questions')
    expect([tab && tab.f, tab && tab.a && tab.a.pane > 0, tab && !!tab.d.pane]).toEqual(['pane', true, true])
    /* the press's own time and the pane's first ask, at or before its first draw */
    expect([tab && tab.z > 0, tab && tab.q && tab.q.pane >= 0 && tab.q.pane <= tab.d.pane[2]]).toEqual([true, true])
    /* the pane's drawn size in characters and the tab it drew */
    expect([tab && tab.d.pane[6] > 1000, tab && tab.v]).toEqual([true, 'questions'])
    /* the case below finds Questions as the tab left open */
    await ui.press({ key: 'tab-questions' })
    await w.clock.settle()
    await ui.unmount()
    /* a pane draw that throws (the fault knob names the site) keeps the last good drawing
       (Questions), is logged, and rides the next band read */
    const before = w.reads.length
    w.env.ASKERDO_DRAW_FAULT = 'pane terminal'
    w.change()
    await w.clock.advance(2000)
    await w.clock.settle()
    const again = await mount($, 'terminal', 'home')
    expect(await again.find({ key: 'qcard-Q106' })).toBeDefined()
    expect(w.debugLogs.some((l: string) => l.includes('a draw threw, pane terminal'))).toBe(true)
    await again.unmount()
    /* a band model whose questions are not a list draws Home, which says it could not read them */
    delete w.env.ASKERDO_DRAW_FAULT
    w.near = (s: string, p: string, l = '') => { const b = w.bandOf(s, p, l); return { ...b, model: { ...b.model, questions: 5 } } }
    w.change()
    await w.clock.advance(2000)
    await w.clock.settle()
    const home = await mount($, 'terminal', 'home')
    expect(plain((await home.find({ key: 'home-unread' }))?.text)).toMatch(/questions/i)
    await home.unmount()
    /* the band's count row says so too, in a few words */
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} } })
    expect(!!(await band.find({ key: 'count-unread' }))).toBe(true)
    await band.unmount()
    w.near = (s: string, p: string, l = '') => w.bandOf(s, p, l)
    w.marker += '+'
    w.change()
    await w.clock.advance(15000)
    await w.clock.settle()
    const reads = w.reads.slice(before).map((r: any) => decodeURIComponent(String(r.url))).filter((u: string) => u.includes('/local/band?'))
    /* the fault rows leave on their own flush, never paced by band reads */
    const flushedRows = () => w.fetches.filter((f: any) => String(f.url).endsWith('/local/faults')).map((f: any) => f.body.faults || [])
    const sentFaults = [...reads.filter((u: string) => u.includes('faults=')), ...flushedRows().flat()]
    expect(sentFaults.filter((t: string) => t.includes('pane terminal')).length).toBe(1)
    expect(sentFaults.some((t: string) => t.includes('band model'))).toBe(true)
    /* a burst of 80 faults at once leaves in one flush with none lost; the kit raises no ui.fault on call,
       so 80 replies' draws throw, each its own site in the same book the app's faults go to; each drew once
       first, so a throw keeps that drawing */
    const burstReply = (i: number, text: string) => $.ui.render({ surface: 'terminal', component: 'AssistantMessage', requestId: 'burst-' + i, props: { text: text + i, isFirstOfReply: true } })
    for (let i = 0; i < 80; i++) await burstReply(i, 'burst ')
    w.env.ASKERDO_DRAW_FAULT = 'reply'
    w.change()
    await w.clock.advance(2000)
    await w.clock.settle()
    const flushesBefore = flushedRows().length
    const readsBefore = w.reads.length
    for (let i = 0; i < 80; i++) await burstReply(i, 'burst again ')
    await w.clock.advance(1000)
    await w.clock.settle()
    delete w.env.ASKERDO_DRAW_FAULT
    w.change()
    const burstFlushes = flushedRows().slice(flushesBefore)
    expect(burstFlushes.length).toBe(1)
    expect(new Set((burstFlushes[0] || []).map((t: string) => (/burst-\d+/.exec(t) || [''])[0]).filter(Boolean)).size).toBe(80)
    expect(w.reads.slice(readsBefore).some((r: any) => String(r.url).includes('faults='))).toBe(false)
  })

  /* a lag tick that ran late rides the band read beside the ring rows; a block past a second
     also names what the thread entered before it, so the wait is the 250 ms tick plus 1 s, no less;
     its own case; each says whether the worker's own beat ran in the hold (idle: the host
     held the tick) or not (busy), what ran at the due time and the due time; real holds, past the 5 s limit */
  const heldRows = async (w: any) => {
    const before = w.reads.length
    w.marker += '+'
    await w.clock.settle()
    const sent = w.reads.slice(before).map((r: any) => decodeURIComponent(String(r.url)))
    expect(sent.some((u: string) => u.includes('"x":"lag"'))).toBe(true)
    const rows = sent.flatMap((u: string) => { const m = /[?&]rings=([^&]*)/.exec(u); try { return m ? JSON.parse(m[1]) : [] } catch { return [] } })
    /* the lag row places its worst tick as the held row does */
    w.lagWorst = rows.find((r: any) => r && r.x === 'lag' && r.d > 0)
    return rows.filter((r: any) => r && r.x === 'held')
  }
  test('a thread blocked past a second sends the lag and what entered before the block on the next band read', { timeoutMs: 15000 }, async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const helds = () => heldRows(w)
    /* busy: the worker's thread held by code outside the mod's bodies (the test's own, here) */
    const until = Date.now() + 1300
    while (Date.now() < until) { /* the block */ }
    await w.clock.advance(250)
    const [busy] = await helds()
    expect([busy.b.length > 0, busy.w, /^none/.test(busy.r), busy.d > 0 && busy.d < Date.now()]).toEqual([true, 'busy', true, true])
    expect([w.lagWorst && w.lagWorst.w, w.lagWorst && w.lagWorst.d === busy.d]).toEqual(['busy', true])
    /* idle: real time passes while the host delivers no tick, the worker free */
    await w.clock.advance(250)
    await new Promise((ok) => setTimeout(ok, 1300))
    await w.clock.advance(250)
    const [idle] = await helds()
    expect(idle.w).toBe('idle')
  })

  /* a hold inside one of the mod's named bodies says which ran at the due time; three real
     1.3 s holds plus the kit's work, 9 to 11 s in a full run, so it takes the long limit */
  test('a hold inside a redraw check, a timer or a band timer names that body in its held row', HEAVY, async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const helds = () => heldRows(w)
    /* the hold is the worker's own, never idle; a loaded host adds its own delay to the tick, part busy */
    const held = (h: any) => !!h && ['busy', 'part busy'].includes(h.w)
    /* busy inside a named body: a board change's redraw check, whose pane read holds */
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PANE })
    await w.clock.advance(2000)
    await w.clock.settle()
    w.change()
    await w.clock.settle()
    w.panesSpin = 1300
    let named: any
    for (let k = 0; k < 12 && !named; k++) {
      await w.clock.advance(250)
      if (!w.panesSpin) named = (await helds())[0]
    }
    expect([held(named), named && /redraw check/.test(named.r)]).toEqual([true, true])
    /* busy inside a timer body: the Questions tab's age timer, whose pane read holds */
    await ui.press({ key: 'tab-questions' })
    await w.clock.settle()
    w.panesSpin = 1300
    for (let k = 0; k < 260 && w.panesSpin; k++) await w.clock.advance(250)
    await w.clock.advance(250)
    const [timed] = await helds()
    await ui.unmount()
    expect([held(timed), timed && /questions age timer, \d+ ms in/.test(timed.r)]).toEqual([true, true])
    /* busy inside a band timer: two lines turn waiting at once, and the toasts timer that shows the
       second holds in the host's toast call */
    const row = (t: string) => ({ track: t, handoff: t + '.1', name: 'line ' + t, state: 'waiting', age: '0m', focus: 'step 1' })
    w.shelf.push(row('TR-6'), row('TR-7'))
    w.marker += '+'
    await w.clock.advance(1000)
    await w.clock.settle()
    w.toastSpin = 1300
    for (let k = 0; k < 60 && w.toastSpin; k++) await w.clock.advance(250)
    await w.clock.advance(250)
    const [toasted] = await helds()
    expect([held(toasted), toasted && /toasts timer, \d+ ms in/.test(toasted.r)]).toEqual([true, true])
  })

  /* the band's copy over this project's activity, newest first by day;
     words in the filter widen it to every project's lines */
  test('Home holds the band\'s copy and this project\'s activity; the filter widens it; the tabs redraw in place', COLD_START, async ($: any, on: any) => {
    const w = shelfWorld(on)
    let paneAsks = 0
    on('state.set', ($: any, e: any, next: any) => { if (e.key === 'drawn' && e.id === 'pane') paneAsks++; return next(e) })
    let ag = 0
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'ag-' + ++ag }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran' }))
    const ask = 'One file or many?'
    w.questions = [{ id: 'Q106', key: 'kq106ab', boardUrl: 'http://192.0.2.7:17480/r/kq106ab', name: 'store shape', ask, gist: ['**Seen** two writers at once', '**Built** one file each'].join(String.fromCharCode(10)), blocking: true, track: 'TR-3', subscribers: ['other'], pick: 'b',
      options: [{ type: 'a', option: 'one file' }, { type: 'b', option: 'many files' }] }]
    w.calls = [{ kind: 'look', record: 'k5', id: 'T-5', text: 'T-5 landed', presses: [{ label: 'Close', verb: 'editRecord', input: {} }] }]
    /* the store stamps local time, as the console reads it */
    const two = (n: number) => String(n).padStart(2, '0')
    const at = (h: number) => {
      const d = new Date(Date.now() - h * 3600000)
      return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + 'T' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':00'
    }
    /* a name past the pane's edge ends at a word with an ellipsis */
    const long = 'the pane ' + 'longword '.repeat(20)
    /* the local server's browser root: the pane's links go through its sign-in paths, which
       the desktop links as plain localhost */
    w.boardUrl = 'http://askerdo.localhost:7777/' + 'a'.repeat(32) + '/'
    /* the board on the LAN mints plain http pages, which the desktop does not open */
    const lan = 'http://192.0.2.7:17480/r/'
    w.feed = [
      { ts: at(0), kind: 'task', verb: 'update', id: 'T-54', key: 'k54abcde', name: long, project: 'C:/src/proj', ws: 'WS-11', changes: { status: ['open', 'in_progress'] }, href: lan + 'k54abcde' },
      { ts: at(0), kind: 'question', verb: 'create', id: 'Q106', name: 'store shape', project: 'C:/src/proj', ws: 'WS-11', href: lan + 'Q106' },
      { ts: at(1), kind: 'plan', verb: 'create', id: 'P-9', name: 'elsewhere', project: 'C:/src/other' },
      { ts: at(30), kind: 'question', verb: 'answer', id: 'Q48', name: 'one pane', project: 'C:/src/proj', ws: 'WS-11', href: lan + 'Q48' },
    ]
    w.near = (s: string, p: string, l: string) => ({ ...w.bandOf(s, p, l), graph: null })
    await start($, w)
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 'home')
      expect(await ui.find({ key: 'name-Q106' })).toBeDefined()
      expect(await ui.find({ key: 'status-shelf-open' })).toBeDefined()
      expect(await ui.find({ key: 'askerdo-open' })).toBeUndefined()
      expect(plain((await ui.find({ key: 'feed' }))!.text)).toMatch(/Today[\s\S]*T-54[\s\S]*now in progress/)
      expect((await ui.find({ key: 'feed' }))!.text).not.toContain('P-9')
      expect(plain((await ui.find({ key: 'feed' }))!.text)).toMatch(/the pane (longword )*longword…/)
      /* every row's id and name open its record: a page through the local server's sign-in route,
         an open question the Questions tab at its card */
      const feedTree = JSON.stringify(await ui.find({ key: 'feed' }))
      const page = 'http://localhost:7777/' + 'a'.repeat(32) + '/r/'
      expect([page + 'k54abcde', page + 'Q48'].map((u) => feedTree.split('"href":"' + u + '"').length - 1)).toEqual([2, 2])
      expect(feedTree.includes('192.0.2.7')).toBe(false)
      const qpress = (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.key)).filter((k: string) => /^f(id|name)p-.*Q106/.test(k))
      expect(qpress.length).toBe(2)
      /* a second open question drawn first, so a press that only opened the tab pins the wrong card */
      const one = w.questions
      w.questions = [{ id: 'Q105', key: 'kq105ab', name: 'log shape', ask: 'Rotate the log?', blocking: true, subscribers: ['other'], options: [{ type: 'a', option: 'daily' }] }, ...one]
      w.change()
      await w.clock.settle()
      /* the row's id and its name each open the card, through the press the row draws */
      for (const key of qpress) {
        await ui.press({ key: 'tab-home' })
        await w.clock.settle()
        await ui.press({ key })
        await w.clock.settle()
        expect([key, (await ui.findAll({ type: 'Box' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('qcard-'))]).toEqual([key, ['qcard-Q106']])
      }
      w.questions = one
      w.change()
      await w.clock.settle()
      await ui.press({ key: 'tab-home' })
      /* the copy draws no hover cards, question row, chips, count and status row
         alike (the dock pane draws them in place, the ask printed over the copy) */
      /* the fold ring's lit drawing is hidden in place, never a placed card */
      const tree = await ui.find({ key: 'home-band' })
      const cards = (n: any): number => (!n || typeof n !== 'object' ? 0 : (n.props && n.props.position === 'absolute' && n.props.display === 'none' ? 1 : 0)
        + (n.children || []).flat().reduce((s: number, c: any) => s + cards(c), 0))
      expect([cards(tree), JSON.stringify(tree).includes(ask)]).toEqual([0, false])
      /* the lit drawing hangs from a Box 0 wide on the rest one, never pulled back by cells */
      const hung: any[] = []
      const walk = (n: any, up: any): void => {
        if (!n || typeof n !== 'object') return
        const kids = (n.children || []).flat()
        const hov = n.hover || (n.props && n.props.hover)
        if (hov && hov.display === 'flex' && kids.some((c: any) => c && c.type === 'Svg')) hung.push([up, n])
        kids.forEach((c: any) => walk(c, n))
      }
      walk(tree, null)
      expect([hung.length > 0, hung.every(([up, lit]) => up.props.width === 0 && !up.props.marginLeft && !lit.props.marginLeft)]).toEqual([surface === 'desktop', true])
      /* the row's name opens Questions pinned at that card, folded and unfolded;
         unfolded, the card names the question no second time, the row's name in the link blue */
      for (const unfoldedRow of [false, ...(surface === 'desktop' ? [true] : [])]) {
        if (unfoldedRow) {
          await pressAgain(ui, 'unfold-Q106')
          const unfoldedTree = JSON.stringify(await ui.find({ key: 'qunfold-Q106' }))
          expect([unfoldedTree.includes('store shape'), !!(await ui.find({ key: 'qc-head-Q106' })), (await ui.find({ key: 'qlabel-Q106' }))!.children[0].props.color]).toEqual([false, false, 'suggestion'])
        }
        await ui.press({ key: 'name-Q106' })
        await w.clock.settle()
        expect((await ui.findAll({ type: 'Box' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('qcard-'))).toEqual(['qcard-Q106'])
        await ui.press({ key: 'tab-home' })
        if (await ui.find({ key: 'qunfold-Q106' })) await pressAgain(ui, 'unfold-Q106')
      }
      /* the desktop's arrow after the name unfolds the question and every option under the row, a second press folds */
      const arrow = await ui.find({ key: 'unfold-Q106' })
      expect(!!arrow).toBe(surface === 'desktop')
      if (arrow) {
        await pressAgain(ui, 'unfold-Q106')
        const open = (await ui.find({ key: 'qunfold-Q106' }))!.text
        expect([open.includes(ask), open.includes('one file'), open.includes('many files')]).toEqual([true, true, true])
        /* a gist with no crux draws as the Questions card's: one item a line, its bold lead kept for Markdown */
        const gist = await ui.find({ key: 'qc-gistmd-Q106' })
        expect([gist?.type, String(gist?.props.text).split(/\n/).map((l) => /^- \*\*\w+\*\* \w/.test(l)), await ui.find({ key: 'qc-crux-Q106' })]).toEqual(['Markdown', [true, true], undefined])
        await pressAgain(ui, 'unfold-Q106')
        expect(await ui.find({ key: 'qunfold-Q106' })).toBeUndefined()
        /* a press anywhere on an unfolded option's tile answers it through the band's path;
           on confirm it opens the strip in that tile first, and Answer now records */
        await pressAgain(ui, 'unfold-Q106')
        await ui.press({ key: 'qu-tile-106a' })
        expect(JSON.stringify(await ui.find({ key: 'qu-opt-106a' })).includes('"qnow-Q106"')).toBe(true)
        await ui.press({ key: 'qnow-Q106' })
        expect(w.last('answer').args.slice(0, 4)).toEqual(['answer', 'Q106', '--pick', 'a'])
        if (await ui.find({ key: 'qunfold-Q106' })) await pressAgain(ui, 'unfold-Q106')
        /* a call's arrow unfolds its fact card under its row, kept across the redraw */
        await pressAgain(ui, 'cunfold-look:k5@')
        expect(!!(await ui.find({ key: 'cunfolded-look:k5@' }))).toBe(true)
        await pressAgain(ui, 'cunfold-look:k5@')
      }
      /* a status row that fits the pane splits as the band's does */
      expect(await ui.find({ key: 'askerdo-status-left' })).toBeDefined()
      /* the local board has no picture, so where we stand draws nothing and one line says why */
      expect([!!(await textOf(ui, 'graph-why')), await ui.find({ key: 'graph-pic' }), await ui.find({ key: 'graph-mine' })]).toEqual([true, undefined, undefined])
      /* the board link follows the tab: Home and Tracks the overview, Questions this project's open set */
      const links = []
      /* a card's and a track's page on a plain-http LAN board go through the same route */
      const pages: string[] = []
      for (const tab of ['home', 'questions', 'tracks', 'settings']) {
        await ui.press({ key: 'tab-' + tab })
        links.push(JSON.stringify(await ui.find({ key: 'pane-board' })).match(/"href":"([^"]+)"/)![1])
        if (tab === 'questions' || tab === 'tracks') pages.push((await ui.findAll({ type: 'Link' })).map((l: any) => l.props.href).join(' '))
      }
      const signed = 'http://localhost:7777/' + 'a'.repeat(32) + '/'
      /* the card's and the held track's pages (the key is trk3abcd); the desktop copy draws its
         Questions tab with no card by this point, so only the track's is read there */
      expect(pages.map((t, i) => t.includes(signed + 'r/' + ['kq106ab', 'trk3abcd'][i]) && !t.includes('192.0.2.7'))).toEqual([surface !== 'desktop', true])
      expect(links).toEqual([signed, signed + 'needs-you?repo=' + encodeURIComponent('github.com/owner/proj'), signed, signed])
      await ui.unmount()
    }
    expect(w.last('activity --limit 50').args).toContain('--project')
    /* one too wide for the pane keeps a single wrapping group (with no 5 ring the row fits 30) */
    const narrow = await mount($, 'desktop', 'home', PANE_ID, { ...PANE, bodyColumns: 24 })
    expect([await narrow.find({ key: 'askerdo-status-left' }), (await narrow.find({ key: 'status-line' }))!.props.flexWrap]).toEqual([undefined, 'wrap'])
    await narrow.unmount()
    const ui = await mount($, 'desktop', 'home')
    /* a board change whose Home reads land past the gather draws Home once, with what they read */
    const routed = w.serverBy['/local/cli']
    w.serverBy['/local/cli'] = async (e: any) => { if (JSON.parse(e.init.body).argv[0] === 'activity') await w.clock.sleep(400); return routed(e) }
    await w.clock.advance(2000)
    await w.clock.settle()
    paneAsks = 0
    w.calls = []
    w.feed.unshift({ ts: at(0), kind: 'task', verb: 'update', id: 'T-60', key: 'k60abcde', name: 'late line', project: 'C:/src/proj', ws: 'WS-11' })
    w.marker += '+'
    for (let i = 0; i < 6; i++) { await w.clock.advance(500); await w.clock.settle() }
    expect([paneAsks, (await ui.find({ key: 'feed' }))!.text.includes('late line')]).toEqual([1, true])
    w.serverBy['/local/cli'] = routed
    /* agents starting, calling and ending while a slow check runs fold into the next gate, one check a gate */
    const burst = async () => {
      await $.agent.spawn({ description: 'Lane ' + (ag + 1), prompt: 'Go.', tool_use_id: 'tu-' + (ag + 1), background: true })
      await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag-' + ag })
    }
    await burst()
    w.panesWait = 1500
    const asked = w.panesAsked
    await w.clock.advance(1000)
    for (let i = 0; i < 2; i++) { await burst(); await w.clock.advance(600) }
    await w.clock.settle()
    const during = w.panesAsked - asked
    await w.clock.advance(400)
    await w.clock.settle()
    expect([during, w.panesAsked - asked]).toEqual([1, 1])
    w.panesWait = 0
    for (let i = 0; i < 4; i++) { await w.clock.advance(500); await w.clock.settle() }
    await ui.input({ key: 'feed-filter', text: 'plan', kind: 'change' })
    await w.clock.settle()
    /* the wider read is passive, so it lands at the gate */
    await w.clock.advance(1000)
    await w.clock.settle()
    expect((await ui.find({ key: 'feed' }))!.text).toContain('P-9')
    expect(w.last('activity --limit 300').args).not.toContain('--project')
    await ui.press({ key: 'tab-tracks' })
    expect(await ui.find({ key: 'tracks-counts' })).toBeDefined()
    await ui.unmount()
  })

  /* the held track's lines by default, the switch the whole workstream; a press
     selects and fills the strip, the second opens; the picture fits the width the pane reports */
  test("Home draws the held track's lines and switches to the whole workstream; a press selects, the next opens; its heading folds it, kept on this PC", async ($: any, on: any) => {
    /* Where we stand shut before a restart, as the store keeps it, which answers a moment late
       after the restart (registered before the world's, so it stands above that answer) */
    on('store.get', { key: 'folds' }, async ($: any, e: any, next: any) => { await w.clock.sleep(50); return next(e) })
    const w = world(on, { store: { folds: { graph: false } } })
    w.questions = []
    w.boardUrl = 'http://askerdo.localhost:53265/0123456789abcdef0123456789abcdef/#p=proj'
    const tv = (id: string, name: string, state: string, tasks: any[], edges: any[] = []) => ({ id, key: 'trk' + id, name, state, stalled: false,
      noHandoff: false, parkReason: null, done: 0, critical: { length: tasks.length, path: tasks.map((t) => t.id) }, tasks, edges, junction: null, holder: null })
    /* the board's word: running, else ready or waiting by what it waits on */
    const task = (id: string, name: string, is: string, waitsOn: string[] = []) => ({ id, key: 'k' + id, name, status: 'open',
      word: { is: is === 'open' ? (waitsOn.length ? 'waiting' : 'ready') : is }, ready: is === 'open' && !waitsOn.length, waitsOn })
    /* TR-3 holds a finished review, which Home leaves off, and a review to do */
    /* two loose tasks, one waiting on TR-6, one whose day came */
    const inboxList = [{ key: 'kT-70', id: 'T-70', name: 'stray idea', wake: { kind: 'track-ends', key: 'trkTR-6', id: 'TR-6', named: 'TR-6 next line', status: 'open' }, due: false },
      { key: 'kT-71', id: 'T-71', name: 'old idea', wake: { date: '2026-11-01' }, due: true }]
    const view = { workstream: 'WS-11', inbox: 2, inboxList, tracks: [
      { ...tv('TR-3', 'mod core and the sweep fixes the session found past the pane edge', 'active', [task('T-41', 'band row', 'running'), { ...task('T-42', 'home picture', 'open', ['after T-41', 'after T-50 on TR-5']), review: true }],
        [{ task: 'T-42', on: 'T-41', done: false }, { task: 'T-42', on: 'T-50', done: false }, { task: 'T-41', on: 'T-40', done: true }]),
      /* the user's hold, which the open view at the track's level says too */
      hold: { on: true, id: 'K-9', at: '2026-11-01T00:00:00Z' },
      finished: [{ id: 'T-40', key: 'kT-40', name: 'review the start', position: 0, status: 'done', closed: '2026-11-04T09:00:00Z', review: true, covers: [{ id: 'T-39', key: 'kT-39', name: 'start' }] }] },
      tv('TR-5', 'local route', 'active', [task('T-50', 'graph route', 'running')]),
      tv('TR-6', 'next line', 'waiting', [task('T-60', 'write the tests', 'open')]),
    ] }
    w.near = (s: string, p: string, l: string) => ({ ...w.bandOf(s, p, l), track: { id: 'TR-3', workstream: 'WS-11', workstreamName: 'the board', running: 1, ready: 0, toGo: 2, done: 3, total: 5 },
      graph: { workstream: 'WS-11', view } })
    /* the session's first draw asks for this PC's last look at WS-11, which the since line reads */
    const lookAt = (e: any) => ({ status: 200, ok: true, headers: {}, text: JSON.stringify({ ok: true, result: { ws: JSON.parse(e.init.body).ws || 'overview', look: new Date(Date.now() - 3600000).toISOString() } }) })
    w.fetchBy['/local/look'] = lookAt
    await start($, w)
    const pic = async (ui: any) => (await ui.find({ key: 'graph-pic' }))!.children[0].props
    const has = async (ui: any, id: string) => !!(await ui.find({ key: 'gline-' + id }))
    /* the first tree (Home, no tab press) waits for that read and draws shut, one line of the held
       track's counts; its heading's press opens it and saves that */
    let first: any
    const drawing = mount($, 'desktop', '').then(async (ui: any) => { first = !!(await ui.find({ key: 'graph-pic' })); return ui })
    await w.clock.settle()
    await w.clock.advance(50)
    const shut = await drawing
    expect([first, await shut.find({ key: 'graph-pic' })]).toEqual([false, undefined])
    expect(await textOf(shut, 'graph-sum')).toMatch(/TR-3\b.*\b2 open\b.*\b3 done/)
    await shut.press({ key: 'fold-graph' })
    expect([!!(await shut.find({ key: 'graph-pic' })), w.stored.folds.graph]).toEqual([true, true])
    await shut.unmount()
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 'home')
      await w.clock.settle()
      expect(await textOf(ui, 'graph-since')).toMatch(/^Since your last look, /)
      if (surface === 'desktop') {
        const p = await pic(ui)
        /* the finished review leaves the picture */
        expect(['stn:T-41', 'stn:T-42', 'stn:T-60', 'stn:T-40'].map((k) => p.source.includes('data-k="' + k + '"'))).toEqual([true, true, false, false])
        /* the pair on its own row, the held track's lines the one on */
        expect([(await ui.find({ key: 'graph-mine' }))!.props.plain, (await ui.find({ key: 'graph-all' }))!.props.plain]).toEqual([undefined, true])
        expect(await textOf(ui, 'graph-crumbs')).toMatch(/WS-11.*TR-3 mod core/)
        expect(await ui.find({ key: 'crumb-hold' })).toBeDefined()
        /* every legend entry leads with its mark as a picture the picture's own code drew, its words in lines beside it */
        const kinds: string[] = []
        const walk = (n: any) => { if (n && typeof n === 'object') { kinds.push(n.type === 'Svg' ? 'mark' : String(n.props && n.props.key).startsWith('legend-words-') ? 'words' : ''); (n.children || []).flat().forEach(walk) } }
        walk(await ui.find({ key: 'graph-legend' }))
        const marks = kinds.filter((k) => k === 'mark').length
        expect([marks > 0, marks]).toEqual([true, kinds.filter((k) => k === 'words').length])
        /* a station's first press selects it and fills the strip; its second opens the task's page */
        const zone = async (k: string) => String((await ui.findAll({ type: 'Box' })).map((z: any) => String(z.key)).find((x: string) => x.startsWith('gz-' + k + '-')))
        await ui.press({ key: (await zone('stn:T-42')).replace(/^gz-/, 'gzp-') })
        expect(await textOf(ui, 'graph-strip-stn:T-42')).toContain('home picture')
        /* the station's own press and the strip's first act both open the page now */
        expect((await ui.findAll({ type: 'Link' })).filter((l: any) => String(l.props.href).endsWith('/r/kT-42')).length).toBe(2)
      } else {
        expect([await has(ui, 'TR-3'), await has(ui, 'TR-5'), await has(ui, 'TR-6')]).toEqual([true, true, true])
        expect([await ui.find({ key: 'graph-legend' }), await ui.find({ key: 'graph-mine' })]).toEqual([undefined, undefined])
      }
      if (surface === 'desktop') {
        await ui.press({ key: 'graph-all' })
        expect((await pic(ui)).source).toContain('data-k="pill:TR-6"')
        /* each press lies where its thing is drawn, down the whole picture: a Box's top margin
           counts the engine's half-line rows, the row unit Home draws with */
        const zones = (await ui.findAll({ type: 'Box' })).filter((z: any) => /^gz-/.test(String(z.key)))
        const tops = zones.map((z: any) => [Number(String(z.key).split('-').pop()), z.props.marginTop * PX_ROW])
        expect([tops.some(([y]) => y > 40), tops.filter(([y, top]) => Math.abs(y - top) > 0.5)]).toEqual([true, []])
        /* the workstream's inbox opened, a row's wake names the track it waits on, and the due row's reads due in amber */
        await ui.press({ key: 'fold-inbox' })
        expect(await textOf(ui, 'graph-inbox-wake-T-70')).toContain('TR-6 next line')
        const due = (await ui.find({ key: 'graph-inbox-wake-T-71' }))!
        expect([/\bdue\b/.test(due.text), due.children[0].props.color]).toEqual([true, 'warning'])
        expect((await pic(ui)).source.includes('data-k="stn:T-40"')).toBe(false)
        await ui.press({ key: 'graph-mine' })
      }
      await ui.unmount()
    }
    /* one look a session for each workstream, however many draws */
    expect(w.posts.filter((x: any) => x.url.endsWith('/local/look')).map((x: any) => x.body.ws)).toEqual(['WS-11'])
    /* a narrow pane draws for its own width, never shrunk from a wider picture */
    /* at the narrowest pane (238 px) the long name, wider than the line, wraps whole at a word, or ends in an ellipsis */
    const narrow = await mount($, 'desktop', 'home', PANE_ID, { ...PANE, bodyColumns: 28 })
    expect((await pic(narrow)).width).toBeLessThanOrEqual(28 * 8.453)
    const crumbLine = String(await textOf(narrow, 'graph-crumbs')).replace(String(await textOf(narrow, 'crumb-hold')), '')
    const crumbWords = crumbLine.slice(crumbLine.indexOf('TR-3')).trim(), wholeCrumb = 'TR-3 ' + view.tracks[0].name, cutAt = crumbWords.replace(/…$/, '')
    /* longer than a line, wrapping, and whole or cut at a word with its ellipsis */
    expect([JSON.stringify(await narrow.find({ key: 'graph-crumbs' })).includes('"wrap":"wrap"'), crumbWords.length > 28,
      crumbWords === wholeCrumb || (crumbWords.endsWith('…') && wholeCrumb.startsWith(cutAt + ' '))]).toEqual([true, true, true])
    await narrow.unmount()
  })

  /* the folder and branch in the pane's title, and on the AskerDo button's card;
     the folder's name with its parent in brackets, fitted to the pane's width */
  test("an open pane's title takes the folder, its parent and the branch fitted to the width, retitled once when either changes and never when unchanged", async ($: any, on: any) => {
    const w = world(on)
    w.questions = []
    w.root = 'C:/src/shop-cart-promo-fix2'
    w.open = [PANE_ID]
    on('session.root', () => ({ value: w.root }))
    w.git = (argv: string[]) => argv.includes('--show-toplevel')
      ? { exitCode: 0, stdout: [w.root, 'C:/src/shop/.git/worktrees/promo', 'C:/src/shop/.git', 'cart/promo-v2', ''].join('\n'), stderr: '' }
      : { exitCode: 1, stdout: '', stderr: '' }
    await start($, w)
    const opens = () => w.panes.filter((p: any) => p.id === PANE_ID)
    const turn = async (n: number) => { await $.turn.start({ text: 'go', turnId: 't' + n }); await w.clock.settle() }
    const BS = String.fromCharCode(92)
    expect(opens().map((p: any) => [p.title.includes('shop-cart-promo-fix2 (C:' + BS + 'src)'), p.title.includes('cart/promo-v2'), p.title.includes(' · '), 'focus' in p])).toEqual([[true, true, false, false]])
    /* narrow, the brackets drop first, then the branch cuts; wide, the brackets again; a redraw at one width retitles nothing */
    for (const bodyColumns of [55, 40, 40, 70]) await (await mount($, 'desktop', '', PANE_ID, { ...PANE, bodyColumns })).unmount()
    await w.clock.settle()
    expect(opens().slice(1).map((p: any) => [p.title.includes('src'), p.title.includes('shop-cart-promo-fix2'), p.title.includes('cart/promo-v2'), p.title.endsWith('…'), 'focus' in p]))
      .toEqual([[false, true, true, false, false], [false, true, false, true, false], [true, true, true, false, false]])
    const seen = opens().length - 1
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} } })
    expect(await textOf(band, 'card-mark-where-group-0')).toMatch(/shop-cart-promo-fix2.*cart\/promo-v2/s)
    await band.unmount()
    await turn(1)
    expect(opens().length - seen).toBe(1)
    /* outside git: the folder alone */
    w.git = () => ({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' })
    await turn(2)
    await turn(3)
    expect(opens().slice(seen).map((p: any) => [p.title.includes('shop-cart-promo-fix2'), p.title.includes('cart/promo-v2'), 'focus' in p])).toEqual([[true, true, false], [true, false, false]])
  })

  test('a pane saved under an id from before the tabs draws the AskerDo pane, and opening the pane closes it', async ($: any, on: any) => {
    const w = shelfWorld(on)
    w.open = ['askerdo-threads']
    await start($, w)
    const old = await mount($, 'desktop', '', 'askerdo-threads')
    expect(await old.find({ key: 'tab-home' })).toBeDefined()
    expect(await old.find({ key: 'tracks-counts' })).toBeDefined()
    await old.unmount()
    expect((await $.command.run({ command: 'askerdo', args: 'pane' })).text).toContain('on Tracks')
    await w.clock.settle()
    expect(w.closed).toEqual(['askerdo-threads'])
  })

  /* the Settings tab draws the settings verb's rows under its sub-tabs; the chip's
     picker picks the layer and a save sends settings set there; both surfaces in one case, so a loaded CPU
     takes it past 5 s */
  test('the Settings tab lists the rows from settings --json, and a save sends settings set at the layer picked', HEAVY, async ($: any, on: any) => {
    const w = shelfWorld(on)
    const place = (level: string, record: string, scope: string, more: any = {}) => ({ level, record, scope, reaches: 'whom it reaches', profiles: [], profile: null, ...more })
    const copy = (label: string) => ({ label, line: label + ' in one plain line.', changes: 'What it changes.', takes: 'Within seconds.' })
    const rows = [
      { key: 'main.window', tab: 'sessions', ...copy('Handoff window'), kind: 'percent', min: 1, max: 99, builtIn: 30, value: 25, layer: 'track', record: 'TR-3', profile: 'settings-tr-3',
        scope: 'this track only', editable: true, changed: true, overridden: [], example: { kind: 'at', text: 'At 25%.' },
        places: [place('default', 'default', 'everywhere', { profiles: ['solo'], profile: 'solo', value: 30, overridden: [{ level: 'track', count: 1 }] }),
          place('track', 'TR-3', 'this track only', { profiles: ['settings-tr-3'], profile: 'settings-tr-3', value: 25, overridden: [] })] },
      { key: 'contract.weather', tab: 'replies', ...copy('Weather icon'), kind: 'bool', builtIn: true, value: true, layer: 'built-in', record: null, profile: null, scope: 'built-in',
        editable: true, changed: false, overridden: [], example: { kind: 'pair', a: ['Off', 'no icon'], b: ['On', 'an icon'] }, places: [place('default', 'default', 'everywhere')] },
    ]
    const tabs = [['replies', 'Replies'], ['sessions', 'Sessions'], ['agents', 'Agents'], ['tests', 'Tests'], ['rules', 'Rules'], ['pc', 'This PC']]
      .map(([tab, name]) => ({ tab, name, summary: name + ' in one sentence.', changed: rows.filter((r) => r.tab === tab && r.changed).length }))
    const fake = w.cli
    /* a minted link lives 20 s here; its rows a 21-module code */
    const qr = Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => ((x * y + x) % 3 ? '0' : '1')).join(''))
    w.cli = (args: string[], stdin?: string, env?: any) => {
      if (args[0] === 'login') return { exitCode: 0, stdout: JSON.stringify({ url: 'http://board.lan:17481/login/once', expires: new Date(Date.now() + 20000).toISOString(), qr }) + '\n', stderr: '' }
      if (args[0] !== 'settings') return fake(args, stdin, env)
      if (args[1] === 'set' && args[3] === '120') return { exitCode: 1, stdout: '', stderr: 'AskerDo: main.window takes 1 to 99\n' }
      if (args[1] === 'set') return { exitCode: 0, stdout: JSON.stringify({ key: args[2], value: 20, profile: 'solo', created: false, added: false, reaches: [] }) + '\n', stderr: '' }
      if (args[1] === 'rule' && args[3] === 'taken') return { exitCode: 1, stdout: '', stderr: 'AskerDo: taken is a built-in line\n' }
      if (args[1] === 'rule') return { exitCode: 0, stdout: JSON.stringify({ profile: 'solo', op: args[2], slug: args[3] }) + '\n', stderr: '' }
      return { exitCode: 0, stdout: JSON.stringify({ record: 'TR-3', board: true, rows, tabs, lists: [], held: [], home: 'solo', drops: ['naming'] }) + '\n', stderr: '' }
    }
    await start($, w)
    /* a field is keyed afresh when it resets, so it is found by the start of its key */
    const field = async (ui: any, key: string) => (await ui.findAll({ type: 'Input' })).find((n: any) => String(n.key).startsWith(key))
    const type = async (ui: any, key: string, text: string) => ui.input({ key: (await field(ui, key)).key, text, kind: 'change' })
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 'settings')
      await w.clock.settle()
      expect(w.last('settings --json').args).toContain('--track')
      /* the tab's view outlives a mount, as it outlives a redraw */
      await pressAgain(ui, 'set-sub-replies')
      expect((await ui.find({ key: 'set-tab-replies' }))!.text).toContain('Weather icon')
      /* a setting's fold opens on the ring (the terminal's arrow); its choice tiles take widths from bodyColumns, never 0 */
      await pressAgain(ui, 'set-more-contract.weather')
      const tiles = (await ui.findAll({ type: 'Box' })).filter((b: any) => /^set-ex-contract\.weather-/.test(String(b.key))).map((b: any) => b.props.width)
      expect([tiles.length, tiles.every((n: number) => n > 0), tiles.reduce((a: number, n: number) => a + n + 1, 0) <= PANE.bodyColumns]).toEqual([2, true, true])
      if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).some((n: any) => n.props.alt === 'Open: press to shut')).toBe(true)
      await pressAgain(ui, 'set-more-contract.weather')
      await pressAgain(ui, 'set-sub-sessions')
      expect((await ui.find({ key: 'set-row-main.window' }))!.text).toContain('Handoff window')
      await pressAgain(ui, 'set-chip-main.window')
      expect((await ui.find({ key: 'set-pick-main.window' }))!.text).toContain('overridden on 1 track')
      await pressAgain(ui, 'set-at-main.window-default')
      await type(ui, 'set-in-main.window', '20')
      await pressAgain(ui, 'set-save-main.window')
      await w.clock.settle()
      const set = w.last('settings set').args
      expect([set.slice(0, 4), set.slice(set.indexOf('--at'), set.indexOf('--at') + 2)]).toEqual([['settings', 'set', 'main.window', '20'], ['--at', 'default']])
      expect((await ui.find({ key: 'set-note-main.window' }))!.text).toContain('solo')
      /* a refused save puts the field back to the stored value and keeps the refusal under it */
      const was = (await field(ui, 'set-in-main.window')).key
      await type(ui, 'set-in-main.window', '120')
      await pressAgain(ui, 'set-save-main.window')
      await w.clock.settle()
      const back = await field(ui, 'set-in-main.window')
      expect([back.props.value, back.key !== was, (await ui.find({ key: 'set-note-main.window' }))!.text.includes('1 to 99')]).toEqual(['25', true, true])
      /* a rule add empties the form, its fields drawn afresh; a refused one keeps the words typed */
      await pressAgain(ui, 'set-sub-rules')
      const add = async (slug: string) => {
        const before = (await field(ui, 'set-line-text')).key
        await type(ui, 'set-line-slug', slug)
        await type(ui, 'set-line-text', 'A line of ' + slug + '.')
        await pressAgain(ui, 'set-line-add')
        await w.clock.settle()
        const text = await field(ui, 'set-line-text')
        return [(await field(ui, 'set-line-slug')).props.value, text.props.value, text.key !== before]
      }
      expect(await add('mine')).toEqual(['', '', true])
      expect(w.last('settings rule').args.slice(0, 4)).toEqual(['settings', 'rule', 'add', 'mine'])
      expect(await add('taken')).toEqual(['taken', 'A line of taken.', false])
      /* a line home dropped is listed with Bring back, which clears the drop on home */
      expect((await ui.find({ key: 'set-drow-naming' }))!.text).toContain('naming')
      await pressAgain(ui, 'set-back-naming')
      await w.clock.settle()
      const bring = w.last('settings rule').args
      expect([bring.slice(0, 4), bring[bring.indexOf('--profile') + 1]]).toEqual([['settings', 'rule', 'clear', 'naming'], 'solo'])
      /* This PC's phone row mints through login --qr and draws the code (the desktop an Svg with its
         quiet zone, the terminal the link) until the link expires, then the press again */
      await pressAgain(ui, 'set-sub-pc')
      await pressAgain(ui, 'set-phone')
      await w.clock.settle()
      expect(w.last('login').args.slice(0, 3)).toEqual(['login', '--qr', '--json'])
      const code = async () => (await ui.findAll({ type: 'Svg' })).find((n: any) => String(n.props.alt).startsWith('QR code'))
      if (surface === 'desktop') expect((await code())!.props.source).toContain('viewBox="0 0 29 29"')
      else expect((await ui.find({ key: 'set-phone-url' }))!.text).toContain('/login/once')
      expect((await ui.find({ key: 'set-row-phone' }))!.text).toContain('once, until')
      await w.clock.advance(21000)
      await w.clock.settle()
      await w.clock.advance(1000)
      await w.clock.settle()
      expect([!!(await code()), !!(await ui.find({ key: 'set-phone-url' })), !!(await ui.find({ key: 'set-phone' }))]).toEqual([false, false, true])
      await pressAgain(ui, 'set-sub-sessions')
      await ui.unmount()
    }
  })

  /* the Guide tab lists the README, then the guide pages in the order the README
     links them, each linking to the page on GitHub at the installed version's tag */
  test('the Guide tab lists the guide pages in reading order, linked at the installed tag', async ($: any, on: any) => {
    const w = shelfWorld(on)
    const pages: Record<string, string> = {
      'README.md': ['# AskerDo', '', '**A plugin.**', '', 'Start with [Getting started](docs/guide/getting-started.md), then [Add a PC](docs/guide/add-a-pc.md).'].join('\n'),
      'docs/guide/getting-started.md': ['# Getting started', '', 'From install to a first question. Then more.'].join('\n'),
      'docs/guide/add-a-pc.md': ['# Add a PC', '', '![A picture](img/a.png)', '', 'Put another PC on a board.'].join('\n'),
    }
    w.fsRead = (path: string) => {
      const p = String(path).replace(/\\/g, '/')
      const hit = Object.keys(pages).find((k) => p.endsWith('/' + k))
      return hit ? pages[hit] : ''
    }
    await start($, w)
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 'guide')
      await w.clock.settle()
      const rows = (await ui.findAll({ type: 'Box' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('guide-row-'))
      expect(rows).toEqual(['guide-row-README.md', 'guide-row-docs/guide/getting-started.md', 'guide-row-docs/guide/add-a-pc.md'])
      const hrefs = (await ui.findAll({ type: 'Link' })).map((n: any) => String(n.props.href))
      expect(hrefs).toContain('https://github.com/ToxMox/askerdo/blob/v0.7.0/docs/guide/add-a-pc.md')
      expect((await ui.find({ key: 'guide-row-docs/guide/add-a-pc.md' }))!.text).toContain('Put another PC on a board')
      await ui.unmount()
    }
  })

  /* the bottom line, this session's track as a card, the
     tracks to pick up, the one another session runs, the parked under a fold naming them, shut
     with nothing saved */
  test('the Tracks tab draws the bottom line, the held card, the tiles by section and the parked fold', async ($: any, on: any) => {
    const w = shelfWorld(on)
    /* the user's hold on the held track, which the board's view sends */
    w.decisions = [{ id: 'K-9', labels: ['hold'], tracks: ['TR-3'], created: '2026-11-01T00:00:00Z' }]
    await start($, w)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await textOf(ui, 'tracks-lead')).toContain('mod core')
      expect(await textOf(ui, 'trk-held-TR-3')).toContain('on hold')
      /* the closed one nowhere, the parked ones in the fold */
      expect(await trackKeys(ui)).toEqual(['trk-held-TR-3', 'trk-tile-TR-6', 'trk-tile-TR-5'])
      expect(await textOf(ui, 'parked-names')).toMatch(/parked line.*side line/)
      /* one session holds one track: a waiting one is copied for a new session; another's live one has no press */
      expect((await ui.find({ key: 'trk-press-TR-6' }))?.props.label).toMatch(/^Copy resume/)
      expect([await ui.find({ key: 'trk-press-TR-5' }), await ui.find({ key: 'trk-press-TR-3' })]).toEqual([undefined, undefined])
      expect(await textOf(ui, 'trk-tile-TR-6')).toContain('write the tests')
      expect(await ui.find({ key: 'sect-count-elsewhere' })).toBeDefined()
      await ui.press({ key: 'parked-fold' })
      expect(await trackKeys(ui)).toEqual(['trk-held-TR-3', 'trk-tile-TR-6', 'trk-tile-TR-5', 'trk-tile-TR-4', 'trk-tile-TR-8'])
      await ui.press({ key: 'parked-fold' })
      expect(await ui.find({ key: 'trk-tile-TR-8' })).toBeUndefined()
      await ui.unmount()
    }
    /* a held track of 112 tasks in the narrowest pane: the bar, its 20 px lead and their
       one-cell gap fit inside the card's border and padding */
    w.tracks.find((t: any) => t.id === 'TR-3').tasks = Array.from({ length: 53 }, (_, i) => 'T-' + (100 + i))
    w.tracks.find((t: any) => t.id === 'TR-3').name = 'mod core and the sweep fixes'
    w.boardUrl = 'http://askerdo.localhost:7777/' + 'a'.repeat(32) + '/'
    w.near = (s: string, p: string, l: string) => {
      const b = w.bandOf(s, p, l)
      return { ...b, graph: { ...b.graph, view: { ...b.graph.view, tracks: b.graph.view.tracks.map((t: any) => (t.id === 'TR-3' || t.id === 'TR-6' ? { ...t, done: 59, total: 112 } : t)) } } }
    }
    w.change()
    await w.clock.advance(2000)
    await w.clock.settle()
    const cols = 24
    const narrow = await mount($, 'desktop', 'tracks', PANE_ID, { ...PANE, bodyColumns: cols })
    /* the tiles' bars too, by the same measure */
    const bars = (await narrow.findAll({ type: 'Svg' })).filter((s: any) => String(s.props.alt).startsWith('One cell per task'))
    expect(bars.length).toBeGreaterThan(1)
    for (const bar of bars) expect(bar.props.width + 20 + 8.453).toBeLessThanOrEqual((cols - 4) * 8.453)
    /* a heading wider than the row wraps with its count after the last word, in a box that gives way before the ring */
    const otherTitle = await narrow.find({ key: 'sect-head-elsewhere-title' })
    expect([/session\s+1$/.test(otherTitle!.text), otherTitle!.props.flexShrink, await narrow.find({ key: 'sect-count-elsewhere' })]).toEqual([true, 1, undefined])
    /* the counts line in rows fitted from the columns, each row inside them, no count split across two */
    const countRows = (await narrow.findAll({ type: 'Box' })).filter((b: any) => /^tracks-counts-\d+$/.test(String(b.key)))
    expect(countRows.length).toBeGreaterThan(1)
    for (const r of countRows) expect([paneCells(String(r.text)) <= cols, /^\d+ \D+( · \d+ \D+)*$/.test(String(r.text).trim())]).toEqual([true, true])
    /* the heading too, its full stop never a row alone, the name still its track's page */
    const leadRows = (await narrow.findAll({ type: 'Box' })).filter((b: any) => /^tracks-lead-\d+$/.test(String(b.key)))
    expect(leadRows.length).toBeGreaterThan(1)
    /* a row's words are its semibold runs, a link's href and press label aside */
    const runs = (n: any): string[] => (n && n.type === 'Text' && n.props?.weight === 'semibold' ? [String(n.text ?? (n.children || []).join(''))]
      : (n?.children || []).flatMap((c: any) => (typeof c === 'object' ? runs(c) : [])))
    const words = (r: any) => runs(r).join(' ')
    expect(leadRows.map(words).join(' ')).toContain('sweep fixes')
    for (const r of leadRows) expect([paneCells(words(r), 600) <= cols, words(r) === '.']).toEqual([true, false])
    expect(leadRows.some((r: any) => JSON.stringify(r).includes('"href"'))).toBe(true)
    /* beside a link the gap is a space in the words, never a cell's margin (2.8 spaces wide) */
    expect(leadRows.some((r: any) => /"margin(Left|Right)":1\b/.test(JSON.stringify(r)))).toBe(false)
    await narrow.unmount()
  })

  /* the copy press puts the command on the pressed surface's clipboard and says so; one
     that does not take gives the command to type (the one failure the user would hit) */
  test('holding a track, a tile copies its resume command and toasts; a copy that does not take toasts the command', async ($: any, on: any) => {
    const w = shelfWorld(on)
    const copies: any[] = []
    let take = true
    on('ui.copy', ($: any, e: any) => { copies.push(e); return { value: take ? { isCopied: true } : { isCopied: false, reason: 'no-clipboard' } } })
    await start($, w)
    const ui = await mount($, 'desktop')
    await ui.press({ key: 'trk-press-TR-6' })
    await w.clock.settle()
    expect(copies.map((c: any) => c.text)).toEqual(['/askerdo resume TR-6'])
    expect(w.toasts.at(-1)).toMatch(/^Copied.*next line/)
    take = false
    await ui.press({ key: 'trk-press-TR-6' })
    await w.clock.settle()
    expect(w.toasts.at(-1)).toMatch(/^Could not copy.*\/askerdo resume TR-6/)
    /* nothing switched this session's track */
    expect(w.last('resume')).toBeUndefined()
    await ui.unmount()
  })

  /* the agent whose run the board holds on a task shows who runs it in the held card's running rows */
  /* each row says the board's word with who, where and since */
  test('the held card says each task\'s word: the agent running, an unconfirmed run with its PC, a ready task with who left it', async ($: any, on: any) => {
    const w = shelfWorld(on)
    const t = w.tracks.find((x: any) => x.tasks.includes('T-42'))
    const agent = (job: string, more: any) => ({ agent: job, word: { worker: 'agent', job, ...more } })
    t.tasks = [...t.tasks, 'T-43']
    t.now = [{ id: 'T-41', ...agent('api-builder', { is: 'running' }) }, { id: 'T-42', ...agent('row-lane', { is: 'unconfirmed', pc: 'desk PC' }) }]
    t.readySet = [{ id: 'T-43', ...agent('minors-lane', { is: 'ready', next: 'continue', how: 'handed_on' }) }]
    await start($, w)
    const ui = await mount($, 'desktop')
    const card = await textOf(ui, 'trk-held-TR-3')
    expect([/T-41[^]*api-builder/, /T-42[^]*row-lane[^]*desk PC/, /T-43[^]*minors-lane/].map((r) => r.test(card))).toEqual([true, true, true])
    await ui.unmount()
  })

  test('holding none, Resume here does what /askerdo resume TR-n does and takes the track', async ($: any, on: any) => {
    const w = shelfWorld(on)
    delete w.tracks[0].session
    w.tracks[0].state = 'waiting'
    await start($, w)
    const ui = await mount($, 'desktop')
    expect((await ui.find({ key: 'trk-press-TR-6' }))?.props.variant).toBe('primary')
    await ui.press({ key: 'trk-press-TR-6' })
    expect(w.last('resume').args).toEqual(['resume', 'TR-6', '--session', 'sess-1', '--json'])
    /* Resume is the user's own act, so an idle session starts one turn carrying the kickoff */
    expect(w.prompts.at(-1)).toContain('Kickoff for TR-6.1')
    expect(w.markers().at(-1)).toBe('sess-1')
    await w.clock.settle()
    expect([!!(await ui.find({ key: 'trk-held-TR-6' })), await ui.find({ key: 'trk-press-TR-6' })]).toEqual([true, undefined])
    await ui.unmount()
  })
})

describe('the AskUserQuestion redraw', () => {
  const QUESTIONS = [{
    question: 'Which store shape?', header: 'Store', multiSelect: false,
    options: [
      { label: 'One file', description: 'Gets you: a simple layout. Costs you: merge churn.' },
      { label: 'Many files (Recommended)', description: 'Isolation per record. **Pros:** no churn; **Cons:** more files to scan', preview: 'tree' },
      { label: 'Keep as is', description: 'Nothing changes for now.' },
    ],
  }]

  test('rewritten props reach the engine\'s own dialog, never a tree, its options the card\'s cells', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AskUserQuestion', props: { tool: 'AskUserQuestion', questions: QUESTIONS } })
    /* the engine's own dialog drew, handed the mod's props: a tree would never reach it */
    expect(w.dialogs.length).toBe(1)
    const [q] = w.dialogs[0].questions
    expect(q.question).toBe('Which store shape?')
    /* each label the letter, the star on the recommended one, the title */
    expect(q.options[0].label).toMatch(/^a .*One file/)
    expect(q.options[0].label).not.toContain('\u2605')
    expect(q.options[1].label).toMatch(/^b \u2605 Many files/)
    expect(q.options[1].label).not.toContain('Recommended')
    expect(q.options[2].label).toMatch(/^c .*Keep as is/)
    expect(q.options[0].description).toContain('Catch: merge churn')
    expect(q.options[1].description).toContain('What happens: no churn')
    expect(q.options[1].preview).toBe('tree')
    expect(q.options[2].description).toBe(QUESTIONS[0].options[2].description)
    await ui.unmount()
  })

  test('a dialog with no split anywhere passes through as it came', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const plain = [{ question: 'Go on?', header: 'Next', multiSelect: false,
      options: [{ label: 'Yes', description: 'Carry on.' }, { label: 'No', description: 'Stop here.' }] }]
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AskUserQuestion', props: { tool: 'AskUserQuestion', questions: plain } })
    expect(w.dialogs[0].questions).toEqual(plain)
    await ui.unmount()
  })
})
