/* The AskerDo pane (its Home and Tracks tabs) and the AskUserQuestion redraw under `claude plugin test`, on the terminal and the desktop. */
import { describe, expect, test } from 'claude-code/testing'
import { pressAgain, start, world } from './world.ts'

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
const textOf = async (ui: any, key: string) => (await ui.find({ key }))?.text

describe('the AskerDo pane', () => {
  /* the band's copy over this project's activity, newest first by day;
     words in the filter widen it to every project's lines */
  test('Home holds the band\'s copy and this project\'s activity; the filter widens it; the tabs redraw in place', async ($: any, on: any) => {
    const w = shelfWorld(on)
    const ask = 'One file or many?'
    w.questions = [{ id: 'Q106', key: 'kq106ab', boardUrl: 'http://192.0.2.7:17480/r/kq106ab', name: 'store shape', ask, crux: 'Two writers at once.', blocking: true, track: 'TR-3', subscribers: ['other'], pick: 'b',
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
      expect((await ui.find({ key: 'feed' }))!.text).toMatch(/Today[\s\S]*T-54[\s\S]*now in progress/)
      expect((await ui.find({ key: 'feed' }))!.text).not.toContain('P-9')
      expect((await ui.find({ key: 'feed' }))!.text).toMatch(/the pane (longword )*longword…/)
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
      await ui.press({ key: qpress[1] })
      await w.clock.settle()
      expect((await ui.findAll({ type: 'Box' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('qcard-'))).toEqual(['qcard-Q106'])
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
      /* the row's name, and the desktop's unfolded card's head, open Questions pinned at that card */
      for (const key of ['name-Q106', ...(surface === 'desktop' ? ['qu-name-Q106'] : [])]) {
        if (key.startsWith('qu-')) await pressAgain(ui, 'unfold-Q106')
        await ui.press({ key })
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
    await ui.input({ key: 'feed-filter', text: 'plan', kind: 'change' })
    await w.clock.settle()
    expect((await ui.find({ key: 'feed' }))!.text).toContain('P-9')
    expect(w.last('activity --limit 300').args).not.toContain('--project')
    await ui.press({ key: 'tab-tracks' })
    expect(await ui.find({ key: 'tracks-counts' })).toBeDefined()
    await ui.unmount()
  })

  /* the held track's lines by default (its own, the line it waits on), the rest named
     under them; the switch draws the whole workstream; the picture fits the width the pane reports */
  test("Home draws the held track's lines and switches to the whole workstream; its heading folds it, kept on this PC", async ($: any, on: any) => {
    /* Where we stand shut before a restart, as the store keeps it, which answers a moment late
       after the restart (registered before the world's, so it stands above that answer) */
    on('store.get', { key: 'folds' }, async ($: any, e: any, next: any) => { await w.clock.sleep(50); return next(e) })
    const w = world(on, { store: { folds: { graph: false } } })
    w.questions = []
    w.boardUrl = 'http://askerdo.localhost:53265/0123456789abcdef0123456789abcdef/#p=proj'
    const tv = (id: string, name: string, state: string, tasks: any[], edges: any[] = []) => ({ id, key: 'trk' + id, name, state, stalled: false,
      noHandoff: false, parkReason: null, done: 0, critical: { length: tasks.length, path: tasks.map((t) => t.id) }, tasks, edges, junction: null, holder: null })
    const task = (id: string, name: string, status: string, waitsOn: string[] = []) => ({ id, key: 'k' + id, name, status, ready: status === 'open' && !waitsOn.length, waitsOn })
    /* TR-3 holds a finished review, which Home leaves off, and a review to do */
    const view = { workstream: 'WS-11', inbox: 0, tracks: [
      { ...tv('TR-3', 'mod core', 'active', [task('T-41', 'band row', 'in_progress'), { ...task('T-42', 'home picture', 'open', ['after T-41', 'after T-50 on TR-5']), review: true }],
        [{ task: 'T-42', on: 'T-41', done: false }, { task: 'T-42', on: 'T-50', done: false }, { task: 'T-41', on: 'T-40', done: true }]),
      finished: [{ id: 'T-40', key: 'kT-40', name: 'review the start', position: 0, status: 'completed', closed: '2026-11-04T09:00:00Z', review: true, covers: [{ id: 'T-39', key: 'kT-39', name: 'start' }] }] },
      tv('TR-5', 'local route', 'active', [task('T-50', 'graph route', 'in_progress')]),
      tv('TR-6', 'next line', 'waiting', [task('T-60', 'write the tests', 'open')]),
    ] }
    w.near = (s: string, p: string, l: string) => ({ ...w.bandOf(s, p, l), track: { id: 'TR-3', workstream: 'WS-11', workstreamName: 'the board', running: 1, ready: 0, toGo: 2, done: 3, total: 5 },
      graph: { workstream: 'WS-11', view, layout: null } })
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
      if (surface === 'desktop') {
        const p = await pic(ui)
        expect(['TR-3', 'TR-5', 'TR-6'].map((id) => p.source.includes('data-track="' + id + '"'))).toEqual([true, true, false])
        expect(p.source.includes('data-task="T-40"')).toBe(false)
        /* every legend entry leads with its mark as a picture the graph's own code drew */
        const kinds: string[] = []
        const walk = (n: any) => { if (n && typeof n === 'object') { kinds.push(n.type === 'Svg' && /stroke="p-/.test(n.props.source) ? 'mark' : n.type === 'Text' ? 'words' : ''); (n.children || []).flat().forEach(walk) } }
        walk(await ui.find({ key: 'graph-legend' }))
        const marks = kinds.filter((k) => k === 'mark').length
        expect([marks > 0, marks]).toEqual([true, kinds.filter((k) => k === 'words').length])
      } else {
        expect([await has(ui, 'TR-3'), await has(ui, 'TR-5'), await has(ui, 'TR-6')]).toEqual([true, true, false])
        expect(await ui.find({ key: 'graph-legend' })).toBeUndefined()
      }
      /* the workstream's name beside its id */
      expect(await textOf(ui, 'graph-off')).toMatch(/WS-11 the board.*TR-6/)
      await ui.press({ key: 'graph-all' })
      if (surface === 'desktop') {
        expect((await pic(ui)).source).toContain('data-track="TR-6"')
        /* each name's press lies where it is drawn, down the whole picture: a Box's top margin
           counts the engine's half-line rows, 10 px on the pane's 20 px line */
        const zones = (await ui.findAll({ type: 'Box' })).filter((z: any) => /^gz-/.test(String(z.key)))
        const tops = zones.map((z: any) => [Number(String(z.key).split('-').pop()), z.props.marginTop * 10])
        expect([tops.some(([y]) => y > 40), tops.filter(([y, top]) => Math.abs(y - top) > 0.5)]).toEqual([true, []])
        /* no finished review drawn in the whole workstream either; the review to do opens its own page */
        expect((await pic(ui)).source.includes('data-task="T-40"')).toBe(false)
        expect((await ui.findAll({ type: 'Link' })).map((l: any) => String(l.props.href).split('/').pop())).toContain('kT-42')
      }
      else expect(await has(ui, 'TR-6')).toBe(true)
      expect(await ui.find({ key: 'graph-off' })).toBeUndefined()
      await ui.press({ key: 'graph-mine' })
      await ui.unmount()
    }
    /* a narrow pane draws for its own width, never shrunk from a wider picture */
    const narrow = await mount($, 'desktop', 'home', PANE_ID, { ...PANE, bodyColumns: 30 })
    expect((await pic(narrow)).width).toBeLessThanOrEqual(30 * 8.453)
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
     picker picks the layer and a save sends settings set there */
  test('the Settings tab lists the rows from settings --json, and a save sends settings set at the layer picked', async ($: any, on: any) => {
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
    w.cli = (args: string[], stdin?: string, env?: any) => {
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
    await start($, w)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await textOf(ui, 'tracks-lead')).toContain('mod core')
      /* the closed one nowhere, the parked ones in the fold */
      expect(await trackKeys(ui)).toEqual(['trk-held-TR-3', 'trk-tile-TR-6', 'trk-tile-TR-5'])
      expect(await textOf(ui, 'parked-names')).toMatch(/parked line.*side line/)
      /* one session holds one track: a waiting one is copied for a new session; another's live one has no press */
      expect((await ui.find({ key: 'trk-press-TR-6' }))?.props.label).toMatch(/^Copy resume/)
      expect([await ui.find({ key: 'trk-press-TR-5' }), await ui.find({ key: 'trk-press-TR-3' })]).toEqual([undefined, undefined])
      expect(await textOf(ui, 'trk-tile-TR-6')).toContain('write the tests')
      await ui.press({ key: 'parked-fold' })
      expect(await trackKeys(ui)).toEqual(['trk-held-TR-3', 'trk-tile-TR-6', 'trk-tile-TR-5', 'trk-tile-TR-4', 'trk-tile-TR-8'])
      await ui.press({ key: 'parked-fold' })
      expect(await ui.find({ key: 'trk-tile-TR-8' })).toBeUndefined()
      await ui.unmount()
    }
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

  /* a dispatched agent's tag shows who runs the task in the held card's running rows */
  test('task_update with an agent shows that agent on the held card', async ($: any, on: any) => {
    const w = shelfWorld(on)
    await start($, w)
    const ui = await mount($, 'desktop')
    expect(await textOf(ui, 'trk-held-TR-3')).not.toContain('api-builder')
    const r = await $.tool.call({ tool: 'mcp__askerdo__task_update', id: 'T-42', agent: 'api-builder' })
    expect(r.deny).toBeUndefined()
    await w.clock.settle()
    const now = await textOf(ui, 'trk-held-TR-3')
    expect([now.includes('T-42'), now.includes('api-builder')]).toEqual([true, true])
    await ui.unmount()
  })

  for (const surface of SURFACES) {
    test('holding none, Resume here does what /askerdo resume TR-n does and takes the track (' + surface + ')', async ($: any, on: any) => {
      const w = shelfWorld(on)
      delete w.tracks[0].session
      w.tracks[0].state = 'waiting'
      await start($, w)
      const ui = await mount($, surface)
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
  }
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

  for (const surface of SURFACES) {
    test('rewritten props reach the engine\'s own dialog, never a tree, its options the card\'s cells (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      await start($, w)
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AskUserQuestion', props: { tool: 'AskUserQuestion', questions: QUESTIONS } })
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

    test('a dialog with no split anywhere passes through as it came (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      await start($, w)
      const plain = [{ question: 'Go on?', header: 'Next', multiSelect: false,
        options: [{ label: 'Yes', description: 'Carry on.' }, { label: 'No', description: 'Stop here.' }] }]
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AskUserQuestion', props: { tool: 'AskUserQuestion', questions: plain } })
      expect(w.dialogs[0].questions).toEqual(plain)
      await ui.unmount()
    })
  }
})
