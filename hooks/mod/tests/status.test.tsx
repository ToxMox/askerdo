/* The status line under the prompt under
 * `claude plugin test`: the line's model, the terminal's hint site, and the desktop's band
 * row. */
import { describe, expect, test } from 'claude-code/testing'
import { statusModel, statusPicture } from '../../../lib/mod-core.mjs'
import { start, world } from './world.ts'

const PLUGIN = 'askerdo'
const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const MAIN = { on: true, window: 30, wrap: 40 }
const BAND = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} }
const seg = (m: any, key: string) => m && m.segments.find((s: any) => s.key === key)
const isHex = (c: any) => /^#/.test(String(c))
const segKeys = async (ui: any) => (await ui.findAll({ type: 'Box' })).map((b: any) => String(b.key))
  .filter((k: string) => k.startsWith('status-') && k !== 'status-hint' && k !== 'status-line')
const face = (s: any) => [s.text, s.tone]
/* a desktop segment's picture and label: inside its lit Box when it has a press */
const faceOf = (seg: any) => {
  const rim = seg.children[0]
  return rim.type === 'Box' && /^face-/.test(String(rim.props.key)) ? rim.children[0].children : seg.children
}

describe('the status line', () => {
  test('the meters: the fill follows the percent, the color the state, shortest horizon first', async () => {
    const context = (percent: number, main: any = MAIN) => statusModel({ reading: { percent, window: 1000000 }, main }).segments[0]
    expect(face(context(10))).toEqual(['○ C 10%', 'dim'])
    expect(face(context(31))).toEqual(['◔ C 31%', 'bright'])
    expect(face(context(41))).toEqual(['◑ C 41%', 'warning'])
    /* the hard limit: the depth guard's 450k of the window */
    expect(context(46).tone).toBe('error')
    expect(context(41, { on: false, window: 30, wrap: 40 }).tone).toBe('dim')
    const m = statusModel({ reading: { percent: 11 }, main: MAIN,
      rates: [{ kind: 'seven_day', percentUsed: 86 }, { kind: 'five_hour', percentUsed: 12 }] })
    expect(m.segments.map(face)).toEqual([['○ C 11%', 'dim'], ['○ H 12%', 'dim'], ['◕ W 86%', 'warning']])
    expect(seg(statusModel({ rates: [{ kind: 'five_hour', percentUsed: 100 }] }), 'hour').tone).toBe('error')
    /* the words live in the cards, led by a plain title, never the picture's name */
    expect(m.segments.every((s: any) => s.card.title.length > 1 && s.tip.startsWith(s.card.title + ': '))).toBe(true)
  })

  test('the held track, the tasks in hand, the shelf count and the guard', async () => {
    const both = statusModel({ thread: { id: 'TR-4', name: 'e2e line', state: 'active' }, hand: [{ id: 'T-9', name: 'wire it' }, { id: 'T-3', name: 'test it' }] })
    const held = seg(both, 'thread')
    expect(face(held)).toEqual(['e2e line', 'dim'])
    /* the newest task in hand and a count of the rest; the card lists them all */
    const hand = seg(both, 'task')
    expect(hand.text).toContain('T-9')
    expect(hand.text).toContain('+1')
    expect(hand.tip).toContain('T-3')
    expect(seg(statusModel({ thread: { id: 'TR-4', name: 'e2e line' }, hand: [] }), 'task')).toBeUndefined()
    /* a side track's segment is its chain; its card adds the now set with agents */
    const chain = 'TR-7 under TR-5, 1 parked behind this'
    const side = seg(statusModel({ thread: { id: 'TR-7', name: 'side', state: 'active', chain, now: [{ id: 'T-41', agent: 'api-builder' }] } }), 'thread')
    expect([side.text, side.pic.label]).toEqual([chain, chain])
    expect(side.tip).toContain('T-41, api-builder')
    /* the task's tooltip says its intent and newest note in its rows; no link, no press line */
    /* each wait carries its short name */
    const graph = { view: { tracks: [{ id: 'TR-4', name: 'e2e line', tasks: [{ id: 'T-9', name: 'wire it', waitsOn: ['after T-84', 'after Q12'] }], names: { 'T-84': 'the move' } }] } }
    const task = seg(statusModel({ hand: [{ id: 'T-9', name: 'wire it', intent: 'Wire the band.', note: { at: '2026-10-26T20:00:00+00:00', text: 'Half wired.' } }],
      graph, questions: [{ id: 'Q12', name: 'the port' }], now: Date.parse('2026-10-26T20:20:00+00:00') }), 'task')
    const facts = task.card.groups.flat().map((r: any) => r.lines.flat().map((p: any) => p.text).join(''))
    expect([facts.some((x: string) => x.includes('Wire the band.')), facts.some((x: string) => x.includes('Half wired.')), task.card.press, task.href]).toEqual([true, true, '', undefined])
    expect(facts.some((x: string) => x.includes('T-84 the move') && x.includes('Q12 the port'))).toBe(true)
    const shelf = [{ track: 'TR-4', state: 'waiting', name: 'a' }, { track: 'TR-5', state: 'waiting', name: 'b' }, { track: 'TR-6', state: 'parked' }]
    expect(seg(statusModel({ shelf }), 'shelf').text).toBe('▤ 2')
    expect(statusModel({ shelf: [{ track: 'TR-6', state: 'parked' }] })).toBeNull()
    expect(face(seg(statusModel({ guard: { on: true, soft: 350000, hard: 450000, source: 'project' } }), 'guard'))).toEqual(['\u{1F6E1} on', 'success'])
  })

  /* on the desktop a ring's tip color tells urgency; context sky below the
     handoff mark, amber to the wrap mark, red from it; a rate window amber from 85, red spent */
  test('the desktop pictures take the user\'s colors at their lines, in either theme', async () => {
    const ring = (percent: number, main: any = MAIN) => statusModel({ reading: { percent, window: 1000000 }, main }).segments[0].pic
    expect([29, 30, 39, 40].map((p) => ring(p).tone)).toEqual(['sky', 'amber', 'amber', 'red'])
    expect([ring(33.6).percent, ring(33.6).ticks, ring(33.6).letter]).toEqual([33.6, [30, 40], 'C'])
    /* the ring's label, its alt and the note floor alike (12.79 is 12, never 13) */
    const a10 = statusModel({ reading: { percent: 12.79, tokens: 127911, window: 1000000 }, main: MAIN }).segments[0]
    expect([a10.pic.label, a10.text.endsWith(' 12%'), statusPicture(a10.pic).alt.includes('12 percent')]).toEqual(['12%', true, true])
    expect([ring(26, { on: true, window: 25, wrap: 35 }).tone, ring(45, { on: false, window: 30, wrap: 40 }).tone]).toEqual(['amber', 'sky'])
    const rate = (kind: string, percentUsed: number) => seg(statusModel({ rates: [{ kind, percentUsed }] }), kind === 'five_hour' ? 'hour' : 'week').pic
    expect([84, 85, 99, 100].map((p) => rate('five_hour', p).tone)).toEqual(['sky', 'amber', 'amber', 'red'])
    expect([rate('five_hour', 12), rate('seven_day', 12)].map((r: any) => [r.letter, r.segments])).toEqual([['5', 5], ['W', 7]])
    /* the five-hour ring draws only with its rate, since some accounts have no
       such limit; no weekly figure yet, an empty grey W with no percent, its
       card under today's title; `empty` keeps it off the terminal */
    const keys = (rates?: any) => statusModel({ reading: { percent: 5 }, rates }).segments.map((s: any) => s.key)
    expect([keys(), keys([{ kind: 'five_hour', percentUsed: 12 }])]).toEqual([['context', 'week'], ['context', 'hour', 'week']])
    const blank = seg(statusModel({ reading: { percent: 5 } }), 'week')
    expect([blank.empty, blank.pic.letter, blank.pic.percent, blank.pic.tone, blank.pic.label, blank.card.title]).toEqual([true, 'W', 0, 'dim', undefined, 'Weekly limit'])
    expect(/next model reply/.test(blank.tip) && !/s-(sky|amber|red)/.test(statusPicture(blank.pic).source)).toBe(true)
    const shield = (guard: any) => seg(statusModel({ guard }), 'guard').pic.state
    expect([shield({ on: true }), shield({ on: false }), shield({ on: true, problem: 'bad line' })]).toEqual(['on', 'off', 'unread'])
    const shelf = seg(statusModel({ shelf: [{ thread: 'TH-4', status: 'waiting', name: 'a' }] }), 'shelf').pic
    expect([shelf.label, shelf.labelTone]).toEqual(['1', 'sky'])
    /* the shades switch with the app's theme inside the picture */
    expect(statusPicture(ring(35)).source).toMatch(/prefers-color-scheme: dark\)\{.*\.s-amber\{stroke:#/)
    /* the mark wears the tray's face on what waits outside this session, blocking
       above zero, else waiting, else quiet; its count beside it and its press to Questions while any wait */
    const mark = (elsewhere: any) => statusModel({ reading: { percent: 5 }, elsewhere }).mark
    const one = mark({ blocking: 1, waiting: 0, questions: [{ id: 'Q7', name: 'port', blocking: true, track: 'TR-2', pc: 'laptop' }] })
    const none = mark({ blocking: 0, waiting: 0, questions: [] })
    expect([one.pic.face, one.pic.label, one.press, mark({ blocking: 0, waiting: 2 }).pic.face, none.pic.face, none.pic.label, none.press])
      .toEqual(['blocking', '1', 'questions', 'waiting', 'quiet', undefined, 'home'])
  })

  test('the hint line keeps the app\'s hint and draws the segments at its end, each with its card; the meters alone before the first load; a cloud session\'s line draws too', async ($: any, on: any) => {
    const w = world(on)
    on('ui.render', { component: 'PromptHint' }, () => ({ type: 'Box', props: { key: 'engine-hint' }, children: [] }))
    /* a reading draws before the band's first load, and nothing of the board does */
    const before = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'PromptHint', props: HINT })
    expect(await before.find({ key: 'engine-hint' })).toBeDefined()
    expect(await segKeys(before)).toEqual(['status-context'])
    await before.unmount()
    w.usage.rateLimits = [{ kind: 'seven_day', percentUsed: 29 }]
    await start($, w)
    const first = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'PromptHint', props: HINT })
    await first.unmount()
    await w.clock.settle()
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'PromptHint', props: HINT })
    expect(await ui.find({ key: 'engine-hint' })).toBeDefined()
    expect(await segKeys(ui)).toEqual(['status-context', 'status-week', 'status-guard', 'status-thread'])
    /* each card hidden at rest, shown on hover, opening leftward over the line, the terminal's dark card */
    const card = (await ui.find({ key: 'status-context' }))!.children[1]
    expect([card.props.position, card.props.display, card.props.left === -(card.props.width + 1)]).toEqual(['absolute', 'none', true])
    expect(JSON.stringify(card.children)).toContain('context')
    expect([card.props.backgroundColor, card.children[0].props.color].every(isHex)).toBe(true)
    /* the shield presses as the band's does; the terminal keeps the AskerDo word and draws no mark */
    expect((await ui.find({ key: 'status-guard-toggle' }))?.type).toBe('Button')
    expect([(await ui.find({ key: 'askerdo-open' }))?.props.label, await ui.find({ key: 'status-mark' })]).toEqual(['AskerDo', undefined])
    await ui.unmount()
    /* a cloud session asks for the hint line and has no band, so it draws there too */
    const desk = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'PromptHint', props: HINT })
    expect(await desk.find({ key: 'engine-hint' })).toBeDefined()
    expect(await desk.find({ key: 'status-context' })).toBeDefined()
    await desk.unmount()
  })

  /* the desktop's Code tab has no hint line, so the segments are
     the band's last row there, read from the band alone, their cards in the theme's colors */
  test('on the desktop the line is the band\'s last row, its reads asked from the band, its cards in theme colors', async ($: any, on: any) => {
    const w = world(on)
    /* Q107 on this session's track draws on the band; Q106, another's, only in the mark */
    w.questions = [{ id: 'Q106', name: 'store shape', blocking: true, subscribers: ['other'], pick: 'b',
      options: [{ type: 'a', option: 'one file' }, { type: 'b', option: 'many files' }] },
    { id: 'Q107', name: 'port', blocking: false, track: 'TR-3', options: [{ type: 'a', option: 'keep' }] }]
    await start($, w)
    const first = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })
    await first.unmount()
    await w.clock.settle()
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })
    /* the half line between the band and the status row */
    const col = (await ui.find({ key: 'band-and-box' }))!
    expect([col.props.rowGap, col.children.map((r: any) => r.props.key)]).toEqual([1, ['needs-you', 'askerdo-status']])
    /* the desktop draws the empty shelf as a gray 0, the terminal none; the mark opens the row;
       before the engine's first figures the W ring draws blank in its place */
    expect(await segKeys(ui)).toEqual(['status-mark', 'status-context', 'status-week', 'status-guard', 'status-thread', 'status-shelf'])
    const percentOf = async (k: string) => faceOf((await ui.find({ key: k }))!).find((c: any) => c && c.type === 'Text')?.children.join('')
    expect(await percentOf('status-week')).toBeUndefined()
    /* the shelf's count is Text after its picture, as the rings'
       percents are, so the row's words share one font and baseline */
    const [pic, label] = faceOf((await ui.find({ key: 'status-shelf' }))!)
    expect([/<text/.test(pic.props.source), label.type, label.props.color, /^\d+$/.test(label.children.join(''))]).toEqual([false, 'Text', 'inactive', true])
    /* two groups pushed apart, the mark and the meters left, the rest at the row's end */
    const row = (await ui.find({ key: 'askerdo-status' }))!
    expect([row.props.justifyContent, row.children.map((g: any) => g.children.map((b: any) => b.props.key))]).toEqual(['space-between',
      [['status-mark', 'status-context', 'status-week'], ['status-guard', 'status-thread', 'status-shelf']]])
    /* each segment is a picture; the shield's, the mark's and the shelf's presses are blank
       plain Buttons laid over them; each wider than its picture, cut to the picture's box */
    for (const k of await segKeys(ui)) expect(faceOf((await ui.find({ key: k }))!)[0].type).toBe('Svg')
    const pressOver = async (k: string) => {
      const f = faceOf((await ui.find({ key: k }))!)
      const p = f.find((c: any) => c && c.props.position === 'absolute')
      const b = p.children[0].children[0]
      const cells = Math.ceil(f[0].props.width / 8)
      return [b.props.key, p.props.overflow, /^ +$/.test(b.props.label) && b.props.label.length > cells]
    }
    expect([await pressOver('status-guard'), await pressOver('status-mark'), await pressOver('status-shelf')]).toEqual([
      ['status-guard-toggle', 'hidden', true], ['askerdo-open', 'hidden', true], ['status-shelf-open', 'hidden', true]])
    /* the track and the rate rings open their pages by a Link over the picture, the track's
       from the local server; the context ring has no press */
    const href = async (k: string) => (JSON.stringify(await ui.find({ key: k })).match(/"href":"([^"]+)"/) || [])[1]
    expect([await href('status-thread'), await href('status-week'), await href('status-context')])
      .toEqual([expect.stringMatching(/^http:\/\/localhost:\d+\/r\//), 'https://claude.ai/settings/usage', undefined])
    /* every press lights one grey highlight, the track's, a ring's, the shield's and the
       mark's alike: the face drawn on its own Box lit on hover, inside a clipping Box whose margins give the room
       back; a link press's blank label is a truncating Text, which the hover underline does not reach */
    const rims = await Promise.all(['status-thread', 'status-week', 'status-guard', 'status-mark'].map(async (k) => (await ui.find({ key: k }))!.children[0]))
    const lit = (b: any) => !!(b.hover || b.props.hover || {}).backgroundColor
    const look = (r: any) => JSON.stringify({ ...r.props, key: '' })
    expect(rims.every((r: any) => r.props.marginX < 0 && r.props.marginY < 0 && r.props.overflow === 'hidden' && lit(r.children[0])
      && r.children[0].children[0].type === 'Svg' && look(r) === look(rims[0]))).toBe(true)
    const blank = faceOf(await ui.find({ key: 'status-thread' })).find((c: any) => c && c.props.position === 'absolute').children[0].children[0].children[0]
    expect([blank.type, /^truncate/.test(blank.props.wrap)]).toEqual(['Text', true])
    /* the track's tooltip draws its facts in groups, a lead picture beside each, on its first line */
    const trackTip = (await ui.find({ key: 'status-thread' }))!.children.find((c: any) => c.props && c.props.display === 'none')
    const groups = trackTip.children.filter((c: any) => c && /^card-thread-group-/.test(String(c.props.key)))
    expect([groups.length, groups.every((g: any) => g.children.length > 0 && g.children.every((r: any) => r.children[0].children[0].type === 'Svg' && r.props.alignItems === 'flex-start'))]).toEqual([3, true])
    /* Q106 blocks: the mark wears the amber face; the AskerDo word leaves the desktop row */
    expect(faceOf((await ui.find({ key: 'status-mark' }))!)[0].props.alt).toContain('1 blocking')
    expect(await ui.find({ key: 'askerdo-opener' })).toBeUndefined()
    /* every card on the band, the row's and the question's, takes theme keys, never a hard color */
    const cards = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.position === 'absolute' && b.props.display === 'none')
    expect(cards.length).toBeGreaterThan(5)
    expect(cards.some((c: any) => isHex(c.props.backgroundColor) || isHex(c.children[0].props.color))).toBe(false)
    /* no card is cut at one line: the desktop's popover is unclipped, so they wrap;
       a status card is its picture and a bold title over the line */
    expect(cards.every((c: any) => c.children.filter((t: any) => t.type === 'Text').every((t: any) => t.props.wrap === 'wrap'))).toBe(true)
    /* the mark's card heads with the mark and lists Q106, waiting outside this session, as a row with no answer chips */
    const markCard = (await ui.find({ key: 'status-mark' }))!.children.find((c: any) => c.props.display === 'none')
    const qrow = await ui.find({ key: 'card-mark-q-Q106' })
    expect([markCard.children[0].children[0].type, !!qrow, JSON.stringify(qrow).includes('"Button"')]).toEqual(['Svg', true, false])
    /* the first model reply's figures replace the blank week ring with its own; no five-hour rate, no 5 ring */
    await $.session.measure({ context: { window: 1000000 }, rateLimits: [{ kind: 'seven_day', percentUsed: 29 }], changed: ['rateLimits'] })
    await w.clock.settle()
    expect([await ui.find({ key: 'status-hour' }), await percentOf('status-week')]).toEqual([undefined, '29%'])
    await ui.unmount()
  })

  /* narrowing, the gaps tighten; the task's long name is cut first, its id
     and count kept, then the track's, then the task's name goes; then the track, the task and the percents
     drop to their icons; the mark and the context ring's percent stay */
  test('the status row shrinks in its fixed order and keeps its right end', async ($: any, on: any) => {
    const w = world(on)
    w.questions = []
    w.tracks[0].name = 'band and status row work'
    w.hand = [{ id: 'T-62', name: 'agents in flight and their depth bars under the band' }, { id: 'T-63', name: 'cards' }]
    on('ui.render', { component: 'PromptHint' }, () => ({ type: 'Box', props: { key: 'engine-hint' }, children: [] }))
    await start($, w)
    await $.session.measure({ context: { window: 1000000, percent: 12, tokens: 120000 }, changed: ['context', 'rateLimits'],
      rateLimits: [{ kind: 'five_hour', percentUsed: 44 }, { kind: 'seven_day', percentUsed: 38 }] })
    await w.clock.settle()
    const label = async (ui: any, k: string) => {
      const seg = await ui.find({ key: 'status-' + k })
      return seg ? faceOf(seg).find((c: any) => c && c.type === 'Text')?.children.join('') : undefined
    }
    const at = async (bodyColumns: number) => {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns } })
      const out = [(await ui.find({ key: 'askerdo-status-left' }))!.props.columnGap]
      for (const k of ['thread', 'task', 'hour', 'week', 'context', 'shelf']) out.push(await label(ui, k))
      out.push(!!(await ui.find({ key: 'status-mark' })) && !!(await ui.find({ key: 'status-guard' })))
      await ui.unmount()
      return out
    }
    /* how a label reads: whole, cut with an ellipsis, the task's id and count alone, or the icon alone */
    const form = (l: string | undefined, whole: string) => l === undefined ? 'icon' : l === whole ? 'whole'
      : l.endsWith('…') || l.endsWith('… +1') ? 'cut' : l === 'T-62 +1' ? 'id' : l
    const T = 'T-62 agents in flight and their depth bars under the band +1', R = 'band and status row work'
    const read = async (n: number) => {
      const [gap, track, task, hour, ...rest] = await at(n)
      return [gap, form(track, R), form(task, T), hour, ...rest]
    }
    expect(await read(140)).toEqual([3, 'whole', 'whole', '44%', '38%', '12%', '0', true])
    expect(await read(132)).toEqual([2, 'whole', 'whole', '44%', '38%', '12%', '0', true])
    expect(await read(100)).toEqual([1, 'whole', 'cut', '44%', '38%', '12%', '0', true])
    expect(await read(70)).toEqual([1, 'cut', 'cut', '44%', '38%', '12%', '0', true])
    expect(await read(55)).toEqual([1, 'cut', 'id', '44%', '38%', '12%', '0', true])
    expect(await read(45)).toEqual([1, 'icon', 'icon', '44%', '38%', '12%', '0', true])
    expect(await read(37)).toEqual([1, 'icon', 'icon', undefined, '38%', '12%', '0', true])
    /* the narrowest band: the shelf's count goes, then the task's icon, then the track's;
       the mark and the context ring with its percent stay */
    const kept = async (bodyColumns: number) => {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns } })
      const keys = await segKeys(ui)
      const out = [['mark', 'context', 'guard', 'thread', 'task'].filter((k) => keys.includes('status-' + k)), await label(ui, 'shelf'), await label(ui, 'context')]
      await ui.unmount()
      return out
    }
    expect(await kept(28)).toEqual([['mark', 'context', 'guard', 'thread'], undefined, '12%'])
    expect(await kept(24)).toEqual([['mark', 'context', 'guard'], undefined, '12%'])
    /* the terminal's line budgets the whole columns: the hint gives way, the track and task take glyphs */
    const term = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns: 40, rows: 30 } })
    const glyph = async (t: string) => !!(await term.find({ type: 'Text', text: t }))
    expect([await glyph('≣'), await glyph('▣')]).toEqual([true, true])
    await term.unmount()
  })
})
