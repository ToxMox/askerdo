/* The Questions pane, the band's labels and name press, and the ask tool's
 * decision fields under `claude plugin test`, on the terminal
 * and the desktop. */
import { describe, expect, test } from 'claude-code/testing'
import { COLD_START, pressAgain, pressRow, start, twiceAtMost, world } from './world.ts'
import { gridWidths, questionsModel } from '../../../lib/mod-core.mjs'
import { ringKey } from '../questions.tsx'

const PLUGIN = 'askerdo'
const PANE_ID = 'askerdo'
const ASKED = 'One file (a) or many (b, my pick)?'
const STAR = '\u2605'
const SURFACES = ['terminal', 'desktop'] as const
const PANE = {
  title: 'Questions', isFocused: true, bodyColumns: 100, placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 }, view: {},
}
const BAND = {
  hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 11 }, view: {},
}
/* the AskerDo pane on its Questions tab */
async function mountPane($: any, surface: string, props: any = PANE) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE_ID, props })
  await ui.press({ key: 'tab-questions' })
  return ui
}
const mountBand = ($: any, surface: string, columns = 100) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: columns } })

/* Q107 mine and not blocking, Q106 mine and blocking with a crux and slots on b (so pinned first), Q503 blocking. */
function decisionWorld(on: any) {
  const w = world(on)
  w.questions = [
    { id: 'Q107', name: 'mine, not blocking', blocking: false, subscribers: ['sess-1'], pick: null, gist: 'Small one.',
      boardUrl: 'http://askerdo.localhost:5/s/q/Q107',
      options: [{ type: 'a', option: 'yes', getsYou: 'done today', costsYou: '' }, { type: 'b', option: 'no', getsYou: 'nothing moves', costsYou: 'waits' }] },
    { id: 'Q106', name: 'store shape', ask: ASKED, blocking: true, subscribers: ['sess-1', 'other'], pick: 'b', gist: 'One file or many?',
      crux: 'Two writers touch the store at once.', stakes: 'A wrong pick costs a migration later.',
      boardUrl: 'http://askerdo.localhost:5/s/q/Q106',
      reverses: [{ id: 'Q512', name: 'store layout', quote: '512b, many files. Why: merges.', declined: ['512a, one file: merge churn'] }],
      options: [
        { type: 'a', option: 'one file', getsYou: 'simple', costsYou: 'merge churn' },
        { type: 'b', option: 'many files', getsYou: 'isolation', costsYou: 'more files',
          undo: 'painful: a migration', headline: 'Each record is its own file.', whyNot: 'more to scan' },
      ] },
    { id: 'Q503', name: 'command names', blocking: true, subscribers: ['other'], pick: 'a', gist: 'Which name?',
      boardUrl: 'http://askerdo.localhost:5/s/q/Q503',
      options: [{ type: 'a', option: '/askerdo', getsYou: 'one name', costsYou: 'longer' }] },
  ]
  return w
}

const keysWith = async (ui: any, prefix: string) =>
  (await ui.findAll({ type: 'Box' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith(prefix))

describe('the Questions pane', () => {
  test('/askerdo questions opens the AskerDo pane on Questions, its ring on the pinned card\'s note press', COLD_START, async ($: any, on: any) => {
    const w = decisionWorld(on)
    await start($, w)
    /* a desktop draws the band first; this kit has no ui.focus, so the open fails open past it */
    await (await mountBand($, 'desktop')).unmount()
    expect((await $.command.run({ command: 'askerdo', args: 'questions' })).text).toContain('Opened the AskerDo pane on Questions.')
    /* opened with the keys, so the pinned card's hotkeys work at once; Esc closes it */
    expect(w.panes.map((p: any) => [p.id, p.title.startsWith('AskerDo'), p.focus, p.closeOnEscape])).toEqual([[PANE_ID, true, true, true]])
    /* a desktop focuses the pane's frame, where no hotkey answers, so the ring moves onto
       the pinned card's quiet note press; a card with no options, onto its answer field */
    const m = questionsModel({ questions: w.questions, more: 0, sid: 'sess-1', now: Date.now() })
    const view = { unfolded: new Set<string>(), notes: {} }
    expect([ringKey(m, { ...view, expanded: 'Q106' }), ringKey(m, { ...view, focus: 'Q503' })]).toEqual(['qnotekey-Q106', 'qnotekey-Q503'])
    const free = questionsModel({ questions: [{ ...w.questions[0], options: [] }], more: 0, sid: 'sess-1', now: Date.now() })
    expect(ringKey(free, view)).toBe('qnote-Q107')
  })

  /* the expanded card pinned at the top in one bordered box, the
     rest one index row each under it, oldest first; a name press pins, a chip press answers.
     a waiting question from another track is listed too, last, and answered there */
  test('the pinned card at the top, the index rows under it, a name press pins and a chip answers', async ($: any, on: any) => {
    const w = decisionWorld(on)
    /* Answer presses at once keeps the one-press answer, no strip */
    w.alias = { alias: '', presses: 'once' }
    /* Q107 and Q503 on two tracks, so the index draws two chip headers */
    Object.assign(w.questions[0], { track: 'TR-20', trackName: 'Settings in the pane', pc: 'desk PC' })
    Object.assign(w.questions[2], { track: 'TR-21', pc: 'laptop' })
    w.questions.push({ id: 'Q600', name: 'port for the board', ask: 'Which port?', blocking: false, session: 'sess-9', track: 'TR-22', pc: 'laptop',
      subscribers: [], options: [{ type: 'a', option: 'last port' }, { type: 'b', option: 'any port' }] })
    const bandOf = w.near
    w.near = (...a: any[]) => ({ ...bandOf(...a), here: { pc: 'desk PC' } })
    await start($, w)
    for (const surface of SURFACES) {
      const ui = await mountPane($, surface)
      /* its own two counted, the band's blocker from another track and Q600 from elsewhere apart */
      expect((await ui.find({ key: 'questions-head' }))?.text).toMatch(/^2 \D*1 blocking\D*2 from elsewhere/)
      const boxes = await keysWith(ui, 'q')
      expect(boxes.filter((k: string) => /^q(card|line)-/.test(k))).toEqual(['qcard-Q106', 'qline-Q107', 'qline-Q503', 'qline-Q600'])
      const card = await ui.find({ key: 'qcard-Q106' })
      expect([card?.props.borderStyle, card?.props.borderDimColor, card?.props.paddingX]).toEqual(['round', true, 1])
      expect(card?.text).not.toContain('command names')
      /* the id in bold leads the head with the short name, the ask under it, then the meta */
      const head = await ui.find({ key: 'qhead-Q106' })
      expect(head?.children.map((b: any) => b.props.key)).toEqual(['qrev-Q106', 'qtitle-Q106', 'qask-Q106', 'qmeta-Q106'])
      expect((await ui.find({ key: 'qid-Q106' }))?.children[0].props.bold).toBe(true)
      expect((await ui.find({ key: 'qname-Q106' }))?.text).toBe('store shape')
      expect((await ui.find({ key: 'qask-Q106' }))?.text).toBe(ASKED)
      expect((await ui.find({ key: 'qmeta-Q106' }))?.text).toContain('blocking')
      /* a reversal's loud marker leads the head, naming the ruling, in the warning color */
      const rev = await ui.find({ key: 'qrev-Q106' })
      expect(rev?.text).toContain('REVERSAL of Q512 (store layout)')
      expect(rev?.children[0].props.color).toBe('warning')
      const crux = await ui.find({ key: 'qcrux-Q106' })
      expect(crux?.text).toBe('Decides: Two writers touch the store at once.')
      expect(crux?.children[0].props.italic).toBe(true)
      /* the why and the stakes unfolded under the grid, through the reply renderer */
      const gist = await ui.find({ key: 'qgist-Q106' })
      expect([gist?.type, /^- One file or many\?$/m.test(gist?.props.text)]).toEqual(['Markdown', true])
      expect((await ui.find({ key: 'qstakes-Q106' }))?.props.text).toContain('A wrong pick costs a migration later.')
      /* a Link carries no key in the kit: found by its keyed Box */
      expect(JSON.stringify(await ui.find({ key: 'qlink-Q106' }))).toContain('"href":"http://localhost:5/s/q/Q106"')
      /* the footer: the note field and n to reach it; no pick button, the rows are the presses */
      expect((await ui.find({ key: 'qnote-Q106' }))?.type).toBe('Input')
      expect((await ui.find({ key: 'qnotekey-Q106' }))?.props.hotkey).toBe('n')
      expect(await ui.find({ key: 'qgo-Q106' })).toBeFalsy()
      /* one chip header per group; a row leads with its marker and its id, then the name */
      expect((await keysWith(ui, 'qghead-')).filter((k: string) => /^qghead-Q\d+$/.test(k))).toEqual(['qghead-Q107', 'qghead-Q503', 'qghead-Q600'])
      const lead = (await ui.find({ key: 'qleft-Q503' }))!.children.map((b: any) => b.props.key)
      expect(lead.slice(0, 2)).toEqual(['qdot-Q503', 'qrowid-Q503'])
      expect((await ui.find({ key: 'qrowid-Q503' }))?.text).toBe('Q503')
      expect((await ui.find({ key: 'qline-Q503' }))?.text).toContain('command names')
      expect((await ui.find({ key: 'pick-503a' }))?.props.hotkey).toBeUndefined()
      await ui.unmount()
    }
    const ui = await mountPane($, 'terminal')
    await ui.press({ key: 'qrow-Q107' })
    const pinned = await keysWith(ui, 'q')
    expect(pinned.filter((k: string) => /^q(card|line)-/.test(k))).toEqual(['qcard-Q107', 'qline-Q106', 'qline-Q503', 'qline-Q600'])
    /* a record from before the ask: its name heads the card, once */
    expect((await ui.find({ key: 'qname-Q107' }))?.text).toBe('mine, not blocking')
    expect(await ui.find({ key: 'qask-Q107' })).toBeUndefined()
    /* the band's reads, no second poll and no read of its own */
    expect(w.reads.filter((r: any) => r.url.includes('/local/band?')).length).toBe(1)
    await ui.press({ key: 'pick-503a' })
    expect(w.last('answer').args.slice(0, 4)).toEqual(['answer', 'Q503', '--pick', 'a'])
    expect(await ui.find({ key: 'qstrip-Q503' })).toBeUndefined()
    /* the one from elsewhere, pinned, is read whole once and answered through the same path */
    await ui.press({ key: 'qrow-Q600' })
    expect([!!(await ui.find({ key: 'qcard-Q600' })), w.cliRuns().filter((r: any) => r.args[0] === 'show' && r.args[1] === 'Q600').length]).toEqual([true, 1])
    await ui.press({ key: 'pick-600b' })
    expect(w.last('answer').args.slice(0, 4)).toEqual(['answer', 'Q600', '--pick', 'b'])
    await ui.unmount()
  })

  /* The grid: three columns the header shares where every word fits whole, else the catch folds */
  test('the grid keeps its columns with the header, folds the catch where a word no longer fits, and marks the pick row', async ($: any, on: any) => {
    const w = decisionWorld(on)
    w.questions[1].options[0].getsYou = 'simple: one place to read, one place to write, and no index to keep in step'
    const long = 'move check second throwaway question'
    w.questions[0].name = long
    await start($, w)
    for (const surface of SURFACES) {
      for (const columns of [120, 50]) {
        const ui = await mountPane($, surface, { ...PANE, bodyColumns: columns })
        /* a desktop's fold rings end the last column, so they stand in one column at the
           row's end and the option column keeps its share of the whole row; the header keeps their room */
        const ring = surface === 'desktop'
        const heads = (await ui.find({ key: 'qcols-Q106' }))!.children
        if (ring) expect(heads.at(-1).children.at(-1).props.key).toBe('qcol-ring-Q106')
        const head = heads.map((b: any) => b.props.width)
        /* a desktop's shares follow each column's longest text, what happens and catch never
           under a fifth; the option's its longest title on one line, at most a third */
        const grow = heads.map((b: any) => b.props.flexGrow)
        if (surface === 'desktop') {
          const sum = grow.reduce((a: number, b: number) => a + b, 0)
          expect(Math.max(...grow)).toBe(grow[1])
          expect(Math.min(...grow.slice(1)) * 5).toBeGreaterThanOrEqual(sum - 1)
          const title = (STAR + ' many files').length / (columns - 10)
          if (columns === 120) expect(grow[0] / sum > title && grow[0] * 4 < sum).toBe(true)
          else expect(Math.abs(grow[0] * 3 - sum)).toBeLessThanOrEqual(2)
        }
        for (const tok of ['106a', '106b']) {
          const cells = (await ui.find({ key: 'ocells-' + tok }))!.children
          /* the option column shares the header's width (a desktop's its weight); the title wraps beside its chip */
          expect([cells[0].props.width, cells[0].props.flexGrow]).toEqual([head[0], grow[0]])
          if (surface === 'desktop' && columns === 120) expect(cells.map((b: any) => b.props.flexGrow)).toEqual(grow)
          /* the terminal's arrow follows the title, only where the option has slots; a
             desktop's ring ends the row, a row without one keeping its room */
          expect(cells.length).toBe(heads.length)
          const [chip, title, arrow] = cells[0].children
          expect([chip.props.key, title.props.key]).toEqual(['ochip-' + tok, 'otitle-' + tok])
          const after = ring ? cells.at(-1).children.at(-1) : arrow
          expect(JSON.stringify(after || null).includes('"unfold-' + tok + '"')).toBe(tok === '106b')
          if (surface === 'desktop') expect(cells[0].props.alignItems).toBe('flex-start')
          /* the letter draws once: a desktop's badge with its keyed blank press laid
             over it, cut to the badge; the terminal's [ a ] its label */
          const press = surface === 'desktop' ? chip.children[1].children[0].children[0] : chip.children[0]
          expect(press).toMatchObject({ type: 'Button', props: { key: 'pick-' + tok, hotkey: tok.slice(-1) } })
          expect(press.props.label.trim()).toBe(surface === 'desktop' ? '' : tok.slice(-1))
          if (surface === 'desktop') {
            /* the cell holds the badge and its press, nothing else, no stray dot */
            expect([chip.children.length, chip.children[0].type, chip.children[1].props.overflow]).toEqual([2, 'Svg', 'hidden'])
            expect(chip.children[0].props.alt).toContain(tok === '106b' ? 'the pick' : 'Option a')
          }
          /* every row padded alike; a desktop's each a tile, the pick's outlined in sky; the terminal's pick tinted */
          const tile = (await ui.find({ key: 'opt-' + tok }))!.props
          if (surface === 'desktop') expect([tile.paddingX, tile.borderStyle, tile.borderColor === '#00AEEF']).toEqual([1, 'round', tok === '106b'])
          else expect([tile.paddingX, tile.borderStyle, !!tile.backgroundColor]).toEqual([1, undefined, tok === '106b'])
        }
        if (surface === 'terminal') expect((await ui.find({ key: 'pick-106b' }))?.props.variant).toBe('primary')
        expect((await ui.find({ key: 'otitle-106b' }))?.text).toContain(STAR + ' many files')
        expect((await ui.find({ key: 'otitle-106a' }))?.text).not.toContain(STAR)
        const fold = await ui.find({ key: 'ohappens-106a' })
        if (columns === 120) {
          expect([head.length, fold]).toEqual([3, undefined])
          expect((await ui.find({ key: 'ocatch-106a' }))?.text).toBe('merge churn')
        } else {
          expect(head.length).toBe(2)
          expect(fold?.text).toContain('simple')
          expect((await ui.find({ key: 'ocatch-106a' }))?.text).toContain('merge churn')
        }
        await ui.unmount()
      }
    }
    /* the switch is by the card's words, so short ones keep three columns where these fold */
    expect(gridWidths(50, 'desktop', [{ option: 'yes', gets: 'done', catch: 'none', slots: [] }]).two).toBe(false)
    /* in the narrowest pane a title wraps at its spaces, no word cut to dots;
       an index row's name ends at a word before its chips, which draw whole */
    const ui = await mountPane($, 'desktop', { ...PANE, bodyColumns: 28 })
    const cell = await ui.find({ key: 'otitle-106b' })
    expect([/\bmany\b/.test(cell!.text) && /\bfiles\b/.test(cell!.text), JSON.stringify(cell).includes('truncate-end')]).toEqual([true, false])
    const row = (await ui.find({ key: 'qleft-Q107' }))!.text
    expect([row.includes('…'), row.includes(long)]).toEqual([true, false])
    expect((await keysWith(ui, 'ichip-107')).length).toBe(2)
    await ui.unmount()
  })

  for (const surface of SURFACES) {
    test('an option unfolds on a press into only its filled slots, in order, and folds again (' + surface + ')', async ($: any, on: any) => {
      const w = decisionWorld(on)
      await start($, w)
      const ui = await mountPane($, surface)
      await ui.press({ key: 'unfold-106b' })
      expect(await keysWith(ui, 'slot-')).toEqual(['slot-106b-headline', 'slot-106b-whyNot', 'slot-106b-undo'])
      expect((await ui.find({ key: 'slot-106b-headline' }))?.text).toBe('Each record is its own file.')
      expect((await ui.find({ key: 'slot-106b-whyNot' }))?.text).toBe('Why not: more to scan')
      expect((await ui.find({ key: 'slot-106b-undo' }))?.text).toBe('Undo: painful: a migration')
      /* a desktop ring's press redraws it under its other key, so the app puts no focus back on it */
      expect(!!(await ui.find({ key: 'unfold-106b' }))).toBe(surface !== 'desktop')
      await pressAgain(ui, 'unfold-106b')
      expect(await keysWith(ui, 'slot-')).toEqual([])
      await ui.unmount()
    })

    /* a press opens the strip under the option; Queue answer records nothing and
       marks the card, a press on another option moves the strip and queues that one instead, Cancel
       closes it, and Answer now records with the card's note */
    test('a row press opens the strip: queue, change, cancel, then Answer now records with the card\'s note; drop, snooze and a typed answer too (' + surface + ')', async ($: any, on: any) => {
      const w = decisionWorld(on)
      w.questions.push({ id: 'Q108', name: 'later one', blocking: false, subscribers: ['sess-1'], pick: null, gist: 'Later.',
        options: [{ type: 'a', option: 'yes', getsYou: 'g', costsYou: '' }] },
      { id: 'Q109', name: 'version name', blocking: false, subscribers: ['sess-1'], pick: null, gist: 'Free text.', options: [] })
      /* one snoozed question, which the wake verb puts back */
      const napOne = { id: 'Q110', name: 'nap one', wake: 'until Nov 20' }
      let nap = [napOne]
      const bandOf = w.near
      w.near = (...a: any[]) => ({ ...bandOf(...a), asleep: nap })
      const fake = w.cli
      let down = true
      w.cli = (args: string[], stdin?: string, env?: any) => {
        if (args[0] !== 'wake') return fake(args, stdin, env)
        if (down) return { exitCode: 1, stdout: '', stderr: 'AskerDo: the board at http://127.0.0.1:52565 is unreachable (ECONNREFUSED)\n' }
        nap = nap.filter((q) => q.id !== args[1])
        w.change()
        return { exitCode: 0, stdout: JSON.stringify({ id: args[1], status: 'open' }) + String.fromCharCode(10), stderr: '' }
      }
      await start($, w)
      const ui = await mountPane($, surface)
      await ui.input({ key: 'qnote-Q106', text: 'files are the truth', kind: 'change' })
      /* a redraw while typing draws the field as it was, so it puts no older text back */
      await ui.redraw()
      expect((await ui.find({ key: 'qnote-Q106' }))?.props.value).toBe('')
      await ui.press({ key: 'pick-106a' })
      /* the note field moves into the strip with the words typed; its presses keyed by digit on the pinned card */
      expect(JSON.stringify(await ui.find({ key: 'qstrip-Q106' }))).toContain('"qnote-Q106"')
      expect((await ui.find({ key: 'qnote-Q106' }))?.props.value).toBe('files are the truth')
      expect((await ui.find({ key: 'qnow-Q106' }))?.props.hotkey).toBe('1')
      await ui.press({ key: 'qqueue-Q106' })
      expect([w.last('answer'), await ui.find({ key: 'qstrip-Q106' })]).toEqual([undefined, undefined])
      expect((await ui.find({ key: 'qqueued-Q106' }))?.text).toContain('Queued 106a')
      expect(!!(await ui.find({ key: 'oqueued-106a' }))).toBe(true)
      await ui.press({ key: 'pick-106b' })
      expect(!!(await ui.find({ key: 'qunqueue-Q106' }))).toBe(true)
      await ui.press({ key: 'qqueue-Q106' })
      expect([!!(await ui.find({ key: 'oqueued-106b' })), !!(await ui.find({ key: 'oqueued-106a' }))]).toEqual([true, false])
      await ui.press({ key: 'pick-106a' })
      await ui.press({ key: 'qcancel-Q106' })
      expect([await ui.find({ key: 'qstrip-Q106' }), w.last('answer')]).toEqual([undefined, undefined])
      await ui.press({ key: 'pick-106a' })
      await ui.press({ key: 'qnow-Q106' })
      expect(w.last('answer').args).toEqual(['answer', 'Q106', '--pick', 'a', '--user', 'sess-1', '--json', '--note', 'files are the truth'])
      expect(w.toasts.at(-1)).toBe('Answered Q106 (store shape): 106a. Note: files are the truth')
      expect(await ui.find({ key: 'qcard-Q106' })).toBeUndefined()
      /* no note: the same path, no --note; the own questions pin first, so the name press pins the
         blocker and a desktop answers it by the whole card's tile (a press anywhere on it) */
      if (surface === 'desktop') await ui.press({ key: 'qrow-Q503' })
      await ui.press({ key: surface === 'desktop' ? 'tile-503a' : 'pick-503a' })
      await ui.press({ key: 'qnow-Q503' })
      expect(w.last('answer').args).toEqual(['answer', 'Q503', '--pick', 'a', '--user', 'sess-1', '--json'])
      /* drop sends the field as its reason, and the card leaves */
      await ui.input({ key: 'qnote-Q107', text: 'not needed', kind: 'change' })
      await ui.press({ key: 'qdrop-Q107' })
      expect(w.last('drop').args).toEqual(['drop', 'Q107', '--note', 'not needed', '--user', 'sess-1', '--json'])
      expect(w.toasts.at(-1)).toContain('Dropped Q107')
      expect(await ui.find({ key: 'qcard-Q107' })).toBeUndefined()
      /* snooze reads the field: empty it says how and records nothing; a date is the wake day */
      await ui.press({ key: 'qsnooze-Q108' })
      expect(w.last('snooze')).toBeUndefined()
      expect(w.toasts.at(-1)).toContain('YYYY-MM-DD')
      await ui.input({ key: 'qnote-Q108', text: '2026-11-01', kind: 'change' })
      await ui.press({ key: 'qsnooze-Q108' })
      expect(w.last('snooze').args).toEqual(['snooze', 'Q108', '--until', '2026-11-01', '--user', 'sess-1', '--json'])
      /* no lettered options: no grid, no ask-about; Enter in the field is the answer */
      expect((await ui.find({ key: 'qnote-Q109' }))?.props.placeholder).toBe('your answer')
      expect(await ui.find({ key: 'qgrid-Q109' })).toBeUndefined()
      expect(await ui.find({ key: 'ask-Q109' })).toBeUndefined()
      expect((await ui.find({ key: 'qanswer-Q109' }))?.props.variant).toBe('primary')
      await ui.input({ key: 'qnote-Q109', text: 'Moxglow' })
      expect(w.last('answer').args).toEqual(['answer', 'Q109', '--user', 'sess-1', '--json', '--note', 'Moxglow'])
      /* the asleep one counts in no number and no crescent draws by the tab;
         its fold is shut until pressed, and Wake runs the verb as the user's act */
      const tabWith = async () => [(await ui.find({ key: 'tab-questions' }))?.props.label, JSON.stringify(await ui.find({ key: 'tabbox-questions' })).includes('Crescent')]
      const tabAsleep = await tabWith()
      expect([tabAsleep[1], await ui.find({ key: 'asleep-Q110' })]).toEqual([false, undefined])
      await ui.press({ key: 'asleep-fold' })
      const rested = (await ui.find({ key: 'asleep-Q110' }))?.text
      expect(rested).toContain('nap one')
      /* a failed Wake says so on the row with no id or address, and the words go once the row leaves and returns */
      await ui.press({ key: 'wake-Q110' })
      await w.clock.settle()
      await ui.redraw()
      const said = String((await ui.find({ key: 'asleep-Q110' }))?.text)
      expect([said !== rested, /Q110|127\.0\.0\.1/.test(said)]).toEqual([true, false])
      const reread = async (list: any[]) => { nap = list; w.change(); await w.clock.settle(); await ui.redraw() }
      await reread([])
      expect(await tabWith()).toEqual(tabAsleep)
      await reread([napOne])
      expect((await ui.find({ key: 'asleep-Q110' }))?.text).toBe(rested)
      down = false
      await ui.press({ key: 'wake-Q110' })
      expect(w.last('wake').args).toEqual(['wake', 'Q110', '--user', 'sess-1', '--json'])
      await w.clock.settle()
      await ui.redraw()
      expect(await ui.find({ key: 'asleep-Q110' })).toBeUndefined()
      await ui.unmount()
    })

    /* queued answers stay off the board, saved on this PC, until one Send records them all
       with their notes and starts one turn carrying them; the band and every open strip offer Send */
    test('queue, change, then Send records both answers and starts one turn (' + surface + ')', { timeoutMs: 15000 }, async ($: any, on: any) => {
      const w = decisionWorld(on)
      /* each save of the queue file sets or clears the session's list */
      let saves = 0
      w.queuedFile = new Proxy(w.queuedFile, {
        set: (t: any, k: string, v: any) => { saves++; t[k] = v; return true },
        deleteProperty: (t: any, k: string) => { saves++; delete t[k]; return true },
      })
      await start($, w)
      const ui = await mountPane($, surface)
      await ui.input({ key: 'qnote-Q106', text: 'files are the truth', kind: 'change' })
      await ui.press({ key: 'pick-106a' })
      await ui.press({ key: 'qqueue-Q106' })
      await ui.press({ key: 'pick-106b' })
      await ui.press({ key: 'qqueue-Q106' })
      await ui.press({ key: 'pick-107a' })
      await ui.press({ key: 'qqueue-Q107' })
      await w.clock.settle()
      expect(w.last('answer')).toBeUndefined()
      expect(w.queuedFile['sess-1'].map((q: any) => q.id + q.letter)).toEqual(['Q106b', 'Q107a'])
      /* an open strip shows the count and Send, as the band does */
      await ui.press({ key: 'pick-107a' })
      expect((await ui.find({ key: 'qsendcount-Q107' }))?.text).toContain('2')
      expect(!!(await ui.find({ key: 'qsend-Q107' }))).toBe(true)
      await ui.press({ key: 'qcancel-Q107' })
      const band = await mountBand($, surface)
      expect((await band.find({ key: 'queued' }))?.text).toContain('2')
      const prompts = w.prompts.length
      const saved = saves
      await band.press({ key: 'queued-send' })
      await w.clock.settle()
      const answered = w.cliRuns().filter((r: any) => r.args[0] === 'answer').map((r: any) => r.args)
      /* a batch, so the queue file is written once for every answer sent */
      expect(saves - saved).toBe(1)
      expect(answered.map((a: string[]) => a[1] + a[3])).toEqual(['Q106b', 'Q107a'])
      expect(answered[0]).toContain('files are the truth')
      /* the timing rows ride the next band read: a lap for each answer sent, and the draw check's */
      const rode = w.reads.map((r: any) => decodeURIComponent(String(r.url))).filter((u: string) => u.includes('/local/band?')).join(' ')
      expect([(rode.match(/"x":"send"/g) || []).length, rode.includes('"x":"check"')]).toEqual([2, true])
      const turn = w.prompts.slice(prompts)
      expect(turn.length).toBe(1)
      expect([/106b/.test(turn[0]), /107a/.test(turn[0])]).toEqual([true, true])
      expect(w.queuedFile['sess-1']).toBeUndefined()
      expect(await band.find({ key: 'queued' })).toBeUndefined()
      /* the whole queue draws each surface at the press, then once more when the batch, its reload
         and its turn have landed, never a draw an answer */
      expect(twiceAtMost(await pressRow(w, 'answer', 'send'), 2)).toBe(true)
      await band.unmount()
      await ui.unmount()
    })

    test('ask about an option, then a row press, submits a prompt and records nothing (' + surface + ')', async ($: any, on: any) => {
      const w = decisionWorld(on)
      await start($, w)
      const ui = await mountPane($, surface)
      await ui.press({ key: 'ask-Q106' })
      await ui.press({ key: 'pick-106b' })
      await w.clock.settle()
      expect(w.prompts).toEqual(['Tell me more about 106b before I pick.'])
      expect(w.last('answer')).toBeUndefined()
      await ui.unmount()
    })
  }

  /* a restart keeps the queue: the mod comes back over the data folder its last run saved;
     one answered another way meanwhile (the session's answer tool, the CLI) leaves it at the next read */
  test('a queued answer survives a restart and Send records it with its note; one answered elsewhere leaves the queue', async ($: any, on: any) => {
    const w = decisionWorld(on)
    w.queuedFile['sess-1'] = [{ id: 'Q106', letter: 'b', note: 'kept over a restart', version: 1, site: 'pane' },
      { id: 'Q107', letter: 'a', note: '', version: 1, site: 'band' }]
    await start($, w)
    const ui = await mountPane($, 'terminal')
    expect((await ui.find({ key: 'qqueued-Q106' }))?.text).toContain('106b')
    const band = await mountBand($, 'terminal')
    expect((await band.find({ key: 'queued' }))?.text).toContain('2')
    const q107 = w.questions.find((q: any) => q.id === 'Q107')
    w.questions = w.questions.filter((q: any) => q !== q107)
    w.answered.push({ ...q107, status: 'answered', answer: '107b.' })
    w.marker += '+'
    await w.clock.advance(15000)
    await w.clock.settle()
    expect((await band.find({ key: 'queued' }))?.text).toContain('1')
    await band.press({ key: 'queued-send' })
    await w.clock.settle()
    const a = w.last('answer').args
    expect([a[1], a[3], a.includes('kept over a restart')]).toEqual(['Q106', 'b', true])
    expect(w.cliRuns().filter((r: any) => r.args[0] === 'answer').length).toBe(1)
    expect(w.queuedFile['sess-1']).toBeUndefined()
    await band.unmount()
    await ui.unmount()
  })

  /* one Send starts one turn carrying every answer, even when the board writes the last
     one's inbox line well after its verb returned */
  test('Send of four queued answers starts one turn carrying all four when the last line lands late', async ($: any, on: any) => {
    const w = decisionWorld(on)
    const one = (id: string) => ({ id, name: 'one of four', blocking: false, subscribers: ['sess-1'], pick: null, gist: 'One.',
      options: [{ type: 'a', option: 'yes', getsYou: 'g', costsYou: '' }] })
    w.questions.push(one('Q108'), one('Q110'))
    w.queuedFile['sess-1'] = [['Q106', 'b'], ['Q107', 'a'], ['Q108', 'a'], ['Q110', 'a']]
      .map(([id, letter]) => ({ id, letter, note: '', version: 1, site: 'band' }))
    w.inboxLag = (label: string) => (['Q110', 'Q111'].includes(label) ? 1500 : 0)
    await start($, w)
    const band = await mountBand($, 'terminal')
    const prompts = w.prompts.length
    await band.press({ key: 'queued-send' })
    await w.clock.settle()
    await w.clock.advance(2000)
    await w.clock.settle()
    expect(w.cliRuns().filter((r: any) => r.args[0] === 'answer').length).toBe(4)
    const turn = w.prompts.slice(prompts)
    expect(turn.length).toBe(1)
    expect(['106b', '107a', '108a', '110a'].filter((t) => !turn[0].includes(t))).toEqual([])
    /* a single press waits on its own answer's line, not on the board change its verb makes */
    w.questions.push(one('Q111'), { ...one('Q112'), noSession: true }, one('Q113'))
    w.marker += '+'
    await w.clock.advance(15000)
    await w.clock.settle()
    const ui = await mountPane($, 'terminal')
    await ui.press({ key: 'pick-111a' })
    await ui.press({ key: 'qnow-Q111' })
    await w.clock.settle()
    await w.clock.advance(2000)
    await w.clock.settle()
    expect(w.prompts.slice(prompts + 1).filter((p: string) => p.includes('111a')).length).toBe(1)
    /* a line that never lands here holds no Send, and a second press meanwhile says so */
    for (const id of ['Q112', 'Q113']) {
      await ui.press({ key: 'pick-' + id.slice(1) + 'a' })
      await ui.press({ key: 'qqueue-' + id })
    }
    await ui.unmount()
    const toasts = w.toasts.length
    void band.press({ key: 'queued-send' })
    await band.press({ key: 'queued-send' })
    await w.clock.settle()
    await w.clock.advance(2000)
    await w.clock.settle()
    expect([w.prompts.some((p: string) => p.includes('113a')), w.toasts.slice(toasts).some((t: string) => /still/i.test(t))]).toEqual([true, true])
    await band.unmount()
  })

  /* a press made while a Send records draws at once, and a call the local server never answers
     ends at the route's limit: the answer stays queued and presses keep drawing */
  test('a press during a Send draws, and a Send whose call never answers ends with the answer still queued', async ($: any, on: any) => {
    const w = decisionWorld(on)
    w.queuedFile['sess-1'] = [{ id: 'Q106', letter: 'b', note: '', version: 1, site: 'pane' }, { id: 'Q107', letter: 'a', note: '', version: 1, site: 'band' }]
    w.hold = { verb: 'answer Q106', until: new Promise(() => {}) }
    await start($, w)
    const ui = await mountPane($, 'terminal')
    const band = await mountBand($, 'terminal')
    await band.press({ key: 'queued-send' })
    await w.clock.settle()
    await ui.press({ key: 'pick-503a' })
    expect(!!(await ui.find({ key: 'qstrip-Q503' }))).toBe(true)
    /* nothing drawn is read past here, so the surfaces go before the clock runs */
    await band.unmount()
    await ui.unmount()
    /* just past the route's 25 s limit: each mocked second runs the mod's ticks */
    await w.clock.advance(26000)
    await w.clock.settle()
    expect((w.queuedFile['sess-1'] || []).map((q: any) => q.id)).toEqual(['Q106', 'Q107'])
    expect(w.toasts.some((t: string) => t.includes('106b'))).toBe(true)
  })

  /* the call that ran out of time landed after all: it counts as sent, said once, with the Send's
     turn, and Send runs again for the rest (split from the case above for its time under load) */
  test('a Send whose call ran out of time but landed counts as sent once, and Send runs again', async ($: any, on: any) => {
    const w = decisionWorld(on)
    w.queuedFile['sess-1'] = [{ id: 'Q106', letter: 'b', note: '', version: 1, site: 'pane' }, { id: 'Q107', letter: 'a', note: '', version: 1, site: 'band' }]
    w.hold = { verb: 'answer Q106', until: new Promise(() => {}) }
    await start($, w)
    const first = await mountBand($, 'terminal')
    await first.press({ key: 'queued-send' })
    await w.clock.settle()
    /* no band drawn while the clock runs past the route's limit */
    await first.unmount()
    await w.clock.advance(26000)
    await w.clock.settle()
    const q106 = w.questions.find((q: any) => q.id === 'Q106')
    w.questions = w.questions.filter((q: any) => q !== q106)
    w.answered.push({ ...q106, status: 'answered', answer: '106b.' })
    w.inbox['sess-1'] = [w.event('Q106', 'b', 'user:sess-1')]
    const toasts = w.toasts.length, prompts = w.prompts.length
    /* the marker's move answers the held wait at once */
    w.marker += '+'
    await w.clock.advance(2000)
    await w.clock.settle()
    expect((w.queuedFile['sess-1'] || []).map((q: any) => q.id)).toEqual(['Q107'])
    expect([w.toasts.slice(toasts).filter((t: string) => t.includes('106b')).length, w.prompts.length - prompts]).toEqual([1, 1])
    w.hold = undefined
    const band = await mountBand($, 'terminal')
    await band.press({ key: 'queued-send' })
    await w.clock.settle()
    expect(w.queuedFile['sess-1']).toBeUndefined()
    await band.unmount()
  })
  /* a respawn between the late toast and the read that shows the answer landed keeps the toast and the turn */
  test('a fresh copy still says once that a late Send landed', async ($: any, on: any) => {
    const w = decisionWorld(on)
    /* the snapshot and queue the late Send leaves, so the case stands alone */
    const late = { v: 1, starts: 1, sending: null, view: null, q: null, queue: [], hc: {}, late: ['Q106'] }
    on('state.get', ($: any, e: any, next: any) => e.key === 'snapshot' ? { value: { value: late, version: 1 } } : next(e))
    w.queuedFile['sess-1'] = [{ id: 'Q106', letter: 'b', note: '', version: 1, site: 'pane' }, { id: 'Q107', letter: 'a', note: '', version: 1, site: 'band' }]
    const q106 = w.questions.find((q: any) => q.id === 'Q106')
    w.questions = w.questions.filter((q: any) => q !== q106)
    w.answered.push({ ...q106, status: 'answered', answer: '106b.' })
    w.inbox['sess-1'] = [w.event('Q106', 'b', 'user:sess-1')]
    await start($, w)
    await w.clock.advance(2000)
    await w.clock.settle()
    expect((w.queuedFile['sess-1'] || []).map((q: any) => q.id)).toEqual(['Q107'])
    expect([w.toasts.filter((t: string) => t.includes('106b')).length, w.prompts.length]).toEqual([1, 1])
  })

  /* a hooks worker respawn cut a Send; the fresh copy finds the send's mark in the
     session's state and finishes it once: the answer the board already holds is not recorded again */
  /* landed: the cut came after the board write and before its mark; the board's stood answer is the send's own */
  for (const landed of [false, true]) test('a Send cut by a respawn is finished once by the fresh copy, with one turn' + (landed ? ' (its write landed)' : ''), async ($: any, on: any) => {
    const w = decisionWorld(on)
    if (landed) { w.already = true; w.inbox['sess-1'] = [w.event('Q106', 'b', 'user:sess-1')] }
    w.queuedFile['sess-1'] = [{ id: 'Q106', letter: 'b', note: '', version: 1, site: 'pane' },
      { id: 'Q107', letter: 'a', note: '', version: 1, site: 'band' }]
    const q107 = w.questions.find((q: any) => q.id === 'Q107')
    w.questions = w.questions.filter((q: any) => q !== q107)
    w.answered.push({ ...q107, status: 'answered', answer: '107a.' })
    let mark: any = { before: null, done: [], here: true }
    on('state.get', ($: any, e: any, next: any) => e.key === 'snapshot' ? { value: { value: { v: 1, starts: 1, sending: mark }, version: 1 } } : next(e))
    on('state.set', ($: any, e: any, next: any) => { if (e.key === 'snapshot') mark = e.value.sending; return next(e) })
    await start($, w)
    await w.clock.advance(5000)
    await w.clock.settle()
    const answered = w.cliRuns().filter((r: any) => r.args[0] === 'answer').map((r: any) => r.args[1])
    expect(answered).toEqual(['Q106'])
    expect(w.prompts.length).toBe(1)
    expect(mark).toBeNull()
    expect(w.queuedFile['sess-1']).toBeUndefined()
    const said = w.toasts.join(' ')
    expect([said.includes('Sent 1 answer'), said.includes('not recorded')]).toEqual([true, false])
  })

  /* the kit loads each test's module afresh, so the second test is a fresh copy over the
     $.state the first one's copy wrote, as after a hooks worker respawn (the queue file left empty) */
  let left: any
  test('the session\'s own slices are mirrored into its state as they change', async ($: any, on: any) => {
    const w = decisionWorld(on)
    on('state.set', ($: any, e: any, next: any) => { if (e.key === 'snapshot') left = e.value; return next(e) })
    await start($, w)
    const ui = await mountPane($, 'terminal')
    await ui.press({ key: 'pick-106b' })
    await ui.press({ key: 'qqueue-Q106' })
    await ui.press({ key: 'pick-107a' })
    await ui.input({ key: 'qnote-Q107', text: 'typed before the respawn', kind: 'change' })
    await w.clock.advance(1000)
    await w.clock.settle()
    expect([left.view.tab, left.q.strip, left.queue.map((q: any) => q.id + q.letter)]).toEqual(['questions', { Q107: 'a' }, ['Q106b']])
    await ui.unmount()
  })
  test('a respawned copy draws the tab, the open strip, the typed note and the queue its last copy left, with no loading line', async ($: any, on: any) => {
    const w = decisionWorld(on)
    on('state.get', ($: any, e: any, next: any) => e.key === 'snapshot' ? { value: { value: left, version: 1 } } : next(e))
    /* the engine asks the fresh copy to draw before its session.start lands */
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PANE })
    expect(await ui.find({ type: 'Text', text: /^Reading the/ })).toBeUndefined()
    expect((await ui.find({ key: 'qnote-Q107' }))?.props.value).toBe('typed before the respawn')
    /* the queue rides the open strip's Send row */
    expect((await ui.find({ key: 'qsendcount-Q107' }))?.text).toMatch(/^1 answer/)
    await start($, w)
    expect(!!(await ui.find({ key: 'qstrip-Q107' }))).toBe(true)
    await ui.unmount()
  })
})

describe('the band\'s buttons and name', () => {
  for (const surface of SURFACES) {
    test('pressing a question\'s name opens the Questions pane at that card (' + surface + ')', async ($: any, on: any) => {
      const w = decisionWorld(on)
      w.questions = w.questions.filter((q: any) => q.id === 'Q503').map((q: any) => ({ ...q, track: 'TR-3' }))
      await start($, w)
      const ui = await mountBand($, surface)
      expect(await ui.find({ type: 'Text', text: 'command names' })).toBeDefined()
      await ui.press({ key: 'name-Q503' })
      await w.clock.settle()
      expect(w.panes.map((p: any) => [p.id, p.title.startsWith('AskerDo'), p.focus])).toEqual([[PANE_ID, true, true]])
      /* the card pinned at the top; the keys stay with the pane, so its hotkeys work at once */
      const pane = await mountPane($, surface)
      expect(await keysWith(pane, 'qcard-')).toEqual(['qcard-Q503'])
      expect((await pane.find({ key: 'qnote-Q503' }))?.props.autoFocus).toBeUndefined()
      expect((await pane.find({ key: 'pick-503a' }))?.props.hotkey).toBe('a')
      await pane.unmount()
      await ui.unmount()
    })
  }
})

describe('the ask tool\'s decision fields', () => {
  test('crux and the option slots pass through to register as given', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const options = [
      { type: 'a', option: 'one', getsYou: 'simple', costsYou: '' },
      { type: 'b', option: 'many', getsYou: 'isolation', costsYou: 'more files', headline: 'Each record its own file.',
        whyPick: 'no churn', whyNot: 'more to scan', undo: 'painful: a migration' },
    ]
    const r = await $.tool.call({ tool: 'mcp__askerdo__ask', name: 'store shape', ask: ASKED, gist: 'One or many?', blocking: true,
      crux: 'Two writers at once.', options, pick: 'b' })
    expect(r.result).toContain('Registered Q512')
    const sent = JSON.parse(w.last('register').stdin)
    expect(sent.crux).toBe('Two writers at once.')
    expect(sent.options).toEqual(options)
    const schema = w.tools.find((t: any) => t.name === 'ask').inputSchema
    expect(Object.keys(schema.properties.options.items.properties)).toEqual(
      ['type', 'option', 'getsYou', 'costsYou', 'headline', 'whyPick', 'whyNot', 'undo'])
    expect(schema.properties.crux.type).toBe('string')
  })

  test('a slot that is not text is refused before the CLI', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const before = w.cliRuns().length
    const r = await $.tool.call({ tool: 'mcp__askerdo__ask', name: 'n', ask: ASKED, gist: 'g', blocking: false, crux: 3,
      options: [{ type: 'a', option: 'x', undo: ['easy'] }], pick: 'a' })
    expect(r.deny).toContain('options[0].undo must be text')
    expect(r.deny).toContain('crux must be text')
    /* a subagent's ask registers nothing and is sent to the session that dispatched it */
    const sub = await $.tool.call({ tool: 'mcp__askerdo__ask', name: 'n', ask: ASKED, gist: 'g', blocking: false, agentId: 'a1' })
    expect(sub.deny).toContain('the session that dispatched it')
    expect(w.cliRuns().length).toBe(before)
  })
})
