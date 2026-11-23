/* The agent guard's agents in flight under `claude plugin test`: the status row and Home while
 * agents and background work run, the stop's refusals, and the runs kept over a reopen, a /clear and a reload. */
import { describe, expect, test } from 'claude-code/testing'
import { HEAVY, pageRefusals, pressAgain, start } from './world.ts'
import { fitRow } from '../home.tsx'
import { AGENTS_COUNT, liveSetsBook } from '../status.tsx'
import { liveBook } from '../agentline.tsx'
import { PLUGIN, HINT, world, mount, measure, CALLS, live, bar, wallSteps, step, deskHost, guardOn } from './depth-kit.ts'

describe('the agent guard', () => {
  /* the agents segment draws only while an agent runs, its card the job, model, its running time,
     calls and depth, amber past the warning point; Home's section unfolds from its press; a
     finished one waits in a fold of its own, shut until pressed, under the running ones */
  test('an agent in flight shows on the status row and Home, and leaves when it ends', HEAVY, async ($: any, on: any) => {
    /* Agents shut under the saved key stays shut after the update, though nothing saved opens it */
    const card = { id: 'Q106', name: 'store shape', gist: 'One file or many?', blocking: true, pick: 'b',
      options: [{ type: 'a', option: 'one file', getsYou: 'simple', costsYou: 'churn' }, { type: 'b', option: 'many files', getsYou: 'isolation', costsYou: 'more files', headline: 'Each record is its own file.' }] }
    const w = world(on, { store: { agentsOpen: false, told: { 'tu-0': card, 'tu-9': { ...card, id: 'Q107', name: 'another question' } }, toldAt: { 'msg-1': ['tu-0'], 'msg-2': ['tu-9'] } } })
    /* a hard limit apart from the default, so Home and the row name the same one */
    guardOn(w, { hard: 400000 })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran' }))
    let replies = 0
    const drew: Record<string, number> = {}
    on('ui.render', { component: 'AssistantMessage' }, ($: any, e: any) => { replies++; drew[e.requestId] = (drew[e.requestId] || 0) + 1; return { type: 'Box', props: { key: 'engine-reply' }, children: [] } })
    let n = 0
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'ag-' + ++n }))
    /* the mod's asks to draw the pane or the band again */
    let asks = 0
    const wrote: Record<string, number> = {}
    on('state.set', ($: any, e: any, next: any) => {
      if (e.key === 'drawn') wrote[e.id] = (wrote[e.id] || 0) + 1
      if (e.key === 'drawn' && (e.id === 'pane' || e.id === 'band')) asks++
      return next(e)
    })
    /* the flights' store writes, and the pane checks (each builds Home's tree) */
    let saves = 0, checks = 0, open = w.open
    w.stored = new Proxy(w.stored, { set: (t: any, k: string, v: any) => { if (k === 'flights:sess-1') saves++; t[k] = v; return true } })
    Object.defineProperty(w, 'open', { get: () => { checks++; return open }, set: (v: any) => { open = v } })
    await start($, w)
    await $.agent.spawn({ description: 'Band lane, whose card row keeps its height as it wraps', prompt: 'Go.', tool_use_id: 'tu-1' })
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag-1' })
    await step($, w, 'ag-1', 280000)
    const term = await mount($, 'terminal')
    expect((await term.find({ key: 'status-agents' }))?.text).toMatch(/1.*Band lane[^(]*\(Opus 5\.5, \D*\d+s, 1 [a-z ]*call, 280k of 400k\)/)
    await term.unmount()
    const ui = await mount($, 'desktop')
    const count = async () => (await ui.find({ type: 'Text', in: 'status-agents-count' }))?.props.color
    expect(await count()).toBe('suggestion')
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'askerdo', props: { title: 'AskerDo', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
    expect([await live(pane, 'agents-line'), !!(await bar(pane, 'agents-line')), await pane.find({ key: 'agent-ag-1' })]).toEqual([expect.stringContaining('deepest 280k of 400k'), true, undefined])
    /* the running time turns over each second on the status row, never a card under a reply */
    const hint = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'PromptHint', props: HINT })
    const reply = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AssistantMessage', requestId: 'msg-1', props: { text: 'Q106 waits.', isFirstOfReply: true } })
    await w.clock.settle()
    expect(await reply.find({ key: 'qhead-Q106' })).toBeDefined()
    /* a board load's redraw lands within the cooldown, before the count */
    await w.clock.advance(1000)
    await w.clock.settle()
    /* a press on one card's option draws that card, never another question's card */
    const reply2 = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AssistantMessage', requestId: 'msg-2', props: { text: 'Q107 waits.', isFirstOfReply: true } })
    await w.clock.settle()
    const others = drew['msg-2']
    const cardWas = wrote['q Q106'] || 0
    await reply.press({ key: 'pick-106a' })
    await w.clock.settle()
    /* a press is an interaction, its card's count written at once with no clock moved, once */
    expect([!!(await reply.find({ key: 'qstrip-Q106' })), !!(await reply2.find({ key: 'qhead-Q107' })), drew['msg-2'] - others, wrote['q Q106'] - cardWas]).toEqual([true, true, 0, 1])
    await reply.press({ key: 'qcancel-Q106' })
    await w.clock.settle()
    /* so does a press on one card's option ring */
    await reply.press({ key: 'unfold-106b' })
    await w.clock.settle()
    expect([!!(await reply.find({ key: 'slot-106b-headline' })), drew['msg-2'] - others]).toEqual([true, 0])
    await reply2.unmount()
    const [hints, drawn] = [w.hints, replies]
    for (let i = 0; i < 3; i++) { await w.clock.advance(1000); await w.clock.settle() }
    expect([w.hints > hints, replies - drawn]).toEqual([true, 0])
    await reply.unmount()
    await hint.unmount()
    await ui.press({ key: 'status-agents-open' })
    await w.clock.settle()
    expect(await live(pane, 'agent-line-ag-1')).toMatch(/Opus 5\.5, \D*\d+s,/)
    /* the app replaces the pane's and the band's whole drawing on each render, dropping a
       hover; ticks, a call and a context growing across bar steps and the warning point draw them again only
       when they would differ, while the running rows (Home's, the band's agents card) and the agents' count ask
       for their own props */
    w.open = ['askerdo']
    asks = 0
    checks = 0
    const bars = async () => [await bar(pane, 'agent-line-ag-1'), await bar(ui, 'card-row-line-ag-1')]
    const first = await bars()
    for (const tokens of [300000, 320000, 340000]) { await w.clock.advance(1000); await step($, w, 'ag-1', tokens) }
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag-1' })
    await w.clock.advance(1000)
    await w.clock.settle()
    const was = [await live(pane, 'agent-line-ag-1'), await live(ui, 'card-row-line-ag-1')]
    /* Home's line and the card's row hold the rows their width gave them while their words turn over
       (the app faults one that resizes itself) */
    const heldOf = async (at: any, key: string) => (await at.findAll({ type: 'Box', in: key })).map((b: any) => b.props.height).find((n: any) => n !== undefined)
    const rows = async () => [await heldOf(pane, 'agent-line-ag-1'), await heldOf(ui, 'card-row-line-ag-1')]
    const rowsWere = await rows()
    /* the card's narrow row keeps the whole job on its two lines */
    expect(was[1]).toContain('as it wraps')
    /* each piece shows the answer from before its tick's wall second, a clock the kit's frame clock does not
       move, so the frame and the wall step together until every piece shows the call and the tone, read once */
    const turned = await wallSteps([pane, ui], async () => [await live(pane, 'agent-line-ag-1'), await live(ui, 'card-row-line-ag-1'), await count()],
      (got) => CALLS(2).test(String(got[0])) && CALLS(2).test(String(got[1])) && got[2] === 'warning')
    expect([asks, checks, was, ...turned, rowsWere.every((n) => Number(n) > 0) && String(await rows()) === String(rowsWere)])
      .toEqual([0, 0, [expect.stringMatching(CALLS(1)), expect.stringMatching(CALLS(1))], expect.stringMatching(CALLS(2)), expect.stringMatching(CALLS(2)), 'warning', true])
    expect((await bars()).map((b, i) => !!b && !!first[i] && b !== first[i])).toEqual([true, true])
    /* each live line's own tree is one the app's page draws */
    expect([await pageRefusals(pane, await pane.find({ key: 'home' })), await pageRefusals(ui, await ui.find({ key: 'band-and-box' }))]).toEqual([{}, {}])
    /* the desktop counts a render against the piece whose state was set and clears that count only on the
       piece's own timer fire or props (the kit clears every piece's on any tick, so it never faults). Home's pieces as
       the pane drew them, the status copy's count first, run on the desktop's rule: each piece sets only its own state
       on its own tick, never another's or in a render, at most once a second, and the ruling: no piece draws an
       answer where it lands, so the drawing turns over in one tick a second, every piece the same answer (the host has
       one frame clock: the spread between the pieces' turns is 0 here and the timers' alignment on the desktop) */
    const deskKeys = [AGENTS_COUNT, 'agents-line', 'agent-line-ag-1']
    const deskProps = await Promise.all(deskKeys.map(async (k) => ((await pane.find({ type: 'Client', key: k })) || (await ui.find({ type: 'Client', key: k })))?.props.props))
    const desk = deskHost(deskProps, 6000)
    const deskOnce = deskKeys.every((k) => desk.sets.filter((x) => x.k === k).every((x, i, all) => !i || x.at - all[i - 1].at >= 900))
    const deskSpread = [1, 2, 3, 4].map((n) => { const at = desk.turns.filter((x) => x.n === n).map((x) => x.at); return at.length === deskKeys.length ? Math.max(...at) - Math.min(...at) : -1 })
    /* once named the drawing asks once a second, on the wall second (300 ms off the host's clock): the first
       asks, well past it, step onto the following one, not a full second on */
    const deskAsks = desk.asks.slice(deskKeys.length)
    const deskOnWall = deskAsks.every((t, i) => (t + 700) % 1000 <= 100 && (!i || t - deskAsks[i - 1] === 1000)) && deskAsks[0] < 2000
    expect([deskProps.every(Boolean), desk.faults, desk.sets.filter((x) => !x.own).map((x) => x.k + ' ' + x.at), deskOnce, deskSpread,
      liveBook().pieces.flatMap((x: any) => x.ring).filter((r: any) => r[0] !== 'tick' || r[2] > 5), desk.running, deskOnWall, deskAsks.length])
      .toEqual([true, [], [], true, [0, 0, 0, 0], [], [1, 1, 1], true, 5])
    /* the asker (the count) unmounts just after its ask, as on Home, another tab, Home again: the engine tells the
       module nothing, so a mate asks once the dead piece's beat is 1.5 s old, at most one second's ask missed, and the
       drawing still asks once a wall second */
    const goneAt = 3400
    const goneRun = deskHost(deskProps, 9000, { from: 100000, g: 'desk-gone', gone: goneAt })
    const goneAfter = goneRun.drawn.filter((t) => t > 100000 + goneAt)
    const goneSeconds = goneRun.drawn.map((t) => Math.floor((t + 700) / 1000))
    expect([goneRun.faults, goneAfter[0] - (100000 + goneAt) <= 2000, new Set(goneSeconds).size === goneSeconds.length,
      goneAfter.every((t, i) => (t + 700) % 1000 <= 100 && (!i || t - goneAfter[i - 1] === 1000)), goneRun.asker !== AGENTS_COUNT])
      .toEqual([[], true, true, true, true])
    /* a frame clock that stalls 1.5 s and catches up fires the asker's timer twice back to back: it asks once
       in that wall second, and the drawing asks on after the stall */
    const stallRun = deskHost(deskProps, 9000, { from: 200000, g: 'desk-stall', stall: [4050, 1500] })
    const stallSeconds = stallRun.drawn.map((t) => Math.floor((t + 700) / 1000))
    expect([stallRun.faults, new Set(stallSeconds).size === stallSeconds.length, stallRun.drawn.filter((t) => t > 200000 + 5550).length >= 3])
      .toEqual([[], true, true])
    /* in the kit every piece shows the answer from before its tick's second: a call shows within three seconds; the
       drawing's asks ride the next band read's live row */
    const liveAsks = async () => {
      w.change()
      await w.clock.settle()
      const url = String(w.reads.filter((r: any) => String(r.url).includes('/local/band?')).pop().url)
      return (JSON.parse(new URLSearchParams(url.split('?')[1]).get('rings') || '[]').find((r: any) => r.x === 'live') || { n: 0 }).n
    }
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag-1' })
    const [shownIn2] = await wallSteps([pane], async () => [await live(pane, 'agent-line-ag-1')], (got) => CALLS(3).test(String(got[0])))
    await liveAsks()
    for (let i = 0; i < 4; i++) await pane.advance(1000)
    const asks4 = await liveAsks()
    expect([shownIn2, asks4 <= 4]).toEqual([expect.stringMatching(CALLS(3)), true])
    expect(await pane.find({ key: 'agents-done' })).toBeUndefined()
    await $.agent.spawn({ description: 'Pane lane', name: 'pane-lane', prompt: 'T-40: go.', tool_use_id: 'tu-2' })
    for (let i = 0; i < 10; i++) await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag-2' })
    await step($, w, 'ag-2', 380000)
    await $.turn.complete({ answer: 'Leg 1 done.\nCONTINUE: docs/pane-state.md, leg 2', durationMs: 5, isAborted: false, turnId: 't-ag-2', reason: 'answer', agentId: 'ag-2' })
    /* Home follows what no press asked for within the redraw cooldown */
    await w.clock.advance(1000)
    await w.clock.settle()
    expect([(await pane.find({ key: 'agents-done-head' }))?.text, await pane.find({ key: 'agent-ag-2' }), !!(await pane.find({ key: 'agent-ag-1' })), asks > 0])
      .toEqual([expect.stringMatching(/1 done.*Pane lane/), undefined, true, true])
    /* its end ends its run as the session that opened it, handed on with its report and CONTINUE line */
    const ends = () => w.verbs.filter((v: any) => v.name === 'endRun' && v.body.input.agentId === 'ag-2')
      .map((v: any) => [v.body.input.how, /Leg 1 done/.test(v.body.input.report), /leg 2/.test(v.body.input.continueLine), v.body.session])
    expect(ends()).toEqual([['handed_on', true, true, 'sess-1']])
    await pane.press({ key: 'agents-done-fold' })
    await w.clock.settle()
    expect([(await pane.find({ key: 'agent-ag-2' }))?.text, !!(await pane.find({ key: 'agent-ag-1' }))]).toEqual([expect.stringContaining('done'), true])
    /* the card's finished row keeps its detail to the card's one line, the depth's limit cut first, where Home's wide row keeps it */
    expect([(await ui.find({ key: 'card-row-ag-2' }))?.text, (await pane.find({ key: 'agent-ag-2' }))?.text]).toEqual([expect.stringMatching(/done.*380k(?! of)/), expect.stringContaining('380k of 400k')])
    /* the drawn text gives each row as fitted where it drew: the card's cut, Home's whole */
    const drawnRead = async (part: string) => String((await $.tool.call({ tool: 'mcp__askerdo__drawn', part })).result)
    const cardRead = (await drawnRead('status')).split('\n').find((l) => l.includes('- agents:')) || ''
    expect([/Pane lane \([^)]*380k(?! of)/.test(cardRead), /Pane lane: [^\n]*380k of 400k/.test(await drawnRead('pane'))]).toEqual([true, true])
    /* a running row ticked into and out of a tool, a short name or a long one, keeps the same parts in the
       same places and its lines at each width, in the card and on Home; the tool takes what room is left, cut where it is short */
    const tickRow = (tool: string) => ({ id: 'ag-9', job: 'Tick lane', stem: 'Opus 5.5', depth: '212k of 450k', done: false,
      tool: tool ? 'in ' + tool : '', detail: 'Opus 5.5, 14m, 41 calls, 212k of 450k' + (tool ? ', in ' + tool : '') })
    const tickBlinks = [] as string[]
    const tickTools = new Set<string>()
    /* one rule for every tool: where the long MCP name shows three letters or more, PowerShell shows, cut where it must */
    const tickMissed = [] as string[]
    let tickCut = false
    for (let cols = 16; cols <= 70; cols++) for (const stop of [false, true]) {
      const bare = fitRow(tickRow(''), cols, true, stop)
      const shown = {} as Record<string, string>
      for (const tool of ['Bash', 'PowerShell', 'search_the_issue_tracker_for_open_items']) {
        const r = fitRow(tickRow(tool), cols, true, stop)
        if (!r.detail.startsWith(bare.detail) || r.lines !== bare.lines) tickBlinks.push(tool + ' ' + cols)
        if (!stop && /212k, in PowerShell$|212k, in search\S*…$/.test(r.detail)) tickTools.add(tool)
        shown[tool] = r.detail.slice(bare.detail.length)
      }
      if (/in sea/.test(shown.search_the_issue_tracker_for_open_items) && !/in Po/.test(shown.PowerShell)) tickMissed.push(cols + ' ' + stop)
      if (/in Po\S*…$/.test(shown.PowerShell)) tickCut = true
    }
    expect([tickBlinks, tickTools.size]).toEqual([[], 2])
    expect([tickMissed, tickCut]).toEqual([[], true])
    /* past the hour and 99 calls, and nested two deep with a longer model name, a row keeps the same parts and lines */
    const tickParts = (r: any) => [r.detail.includes('212k'), r.detail.includes('of 450k'), r.lines].join()
    const tickGrown = [] as string[]
    for (let cols = 16; cols <= 50; cols++) for (const stop of [false, true]) for (const [under, stem] of [[0, 'Opus 5.5'], [2, 'Sonnet 4.5']] as const) {
      const ran = ['3m, 8 calls', '1h 12m, 123 calls'].map((t) =>
        tickParts(fitRow({ ...tickRow(''), under, stem, detail: stem + ', ' + t + ', 212k of 450k' }, cols, true, stop)))
      if (new Set(ran).size > 1) tickGrown.push([cols, stop, under].join())
    }
    expect(tickGrown).toEqual([])
    /* the once-a-second gate: agents starting, calling and ending in a burst inside one second draw each surface at most once.
       The gate measures its cooldown on the real clock and waits on the test's, so each 750 real ms a loaded machine
       spends in the burst may open it once more */
    const wall = Date.now()
    await w.clock.advance(1000)
    await w.clock.settle()
    const wroteWas = { ...wrote }
    const savesWas = saves
    for (let i = 3; i <= 5; i++) {
      await $.agent.spawn({ description: 'Burst lane ' + i, prompt: 'Go.', tool_use_id: 'tu-b' + i })
      await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag-' + i })
      await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't-ag-' + i, reason: 'answer', agentId: 'ag-' + i })
      await w.clock.advance(200)
      await w.clock.settle()
    }
    const most = 1 + Math.floor((Date.now() - wall) / 750)
    expect(['hint', 'band', 'pane'].map((s) => (wrote[s] || 0) - (wroteWas[s] || 0) <= most)).toEqual([true, true, true])
    /* and the flights' store is written once in that second, holding every end once it is out */
    const inSecond = saves - savesWas
    await w.clock.advance(1000)
    await w.clock.settle()
    expect([inSecond, w.stored['flights:sess-1'].list.filter((f: any) => /^ag-[345]$/.test(f.id) && f.done).length]).toEqual([1, 3])
    await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't-ag-1', reason: 'answer', agentId: 'ag-1' })
    await w.clock.advance(1000)
    await w.clock.settle()
    expect([await ui.find({ key: 'status-agents' }), await pane.find({ key: 'agents' })]).toEqual([undefined, undefined])
    /* a resume opens a new run under the agent's id, on the tasks its last run served */
    await $.tool.call({ tool: 'SendMessage', to: 'pane-lane', message: 'Go on.' })
    await $.agent.spawn({ description: 'Pane lane', name: 'pane-lane', prompt: 'Go on.', tool_use_id: 'tu-3', resume: true })
    await w.clock.settle()
    expect(w.verbs.filter((v: any) => v.name === 'openRun').slice(-1).map((v: any) => [v.body.input.job, v.body.input.tasks, !!v.body.input.agentId]))
      .toEqual([['pane-lane', undefined, true]])
    /* a live piece's fault words carry its drawing's pieces and the piece's last state sets, each cause with its
       ms since the piece's own render and tick, as the asker's ask carried them (the kit raises no fault on a piece) */
    const faultBook = liveSetsBook()
    const faultSite = { surface: 'desktop', component: 'Pane', requestId: 'askerdo' }
    faultBook.keep({ ...faultSite, element: AGENTS_COUNT, data: { line: true, keys: [AGENTS_COUNT, 'agents-line', 'agent-line-ag-1'], sets: { 'agents-line': [['mount', 0, 0], ['hand', 12, 980], ['hand', 9, 1490]] } } })
    const faultWords = faultBook.words({ ...faultSite, element: 'agents-line' })
    expect([/3 pieces/.test(faultWords), /mount\D+0\D+0\D+hand\D+12\D+980\D+hand\D+9\D+1490/.test(faultWords), faultBook.words({ ...faultSite, element: 'agent-line-ag-1' }).includes('hand')]).toEqual([true, true, false])
    await pane.unmount()
    await ui.unmount()
  })

  /* an agent the main loop's sweep finds killed and one stopped from its row each get the lane note
     and their run's end once (handed on, by agent id), and a turn end after the stop adds neither. Its
     own case, so the minute tick it waits on comes soon after the session starts (the kit's clock holds each
     timer's hook call open until its next fire, which the engine skips past 10 s) */
  test('a swept and a stopped lane each end their run and note their task once', HEAVY, async ($: any, on: any) => {
    const w = world(on)
    guardOn(w)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran' }))
    let n = 6
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'ag-' + ++n }))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    on('tool.call', { tool: 'TaskStop' }, ($: any, e: any) => ({ result: { message: 'stopped', task_id: e.task_id, task_type: 'local_agent' } }))
    const goneList: any[] = []
    on('agent.list', () => ({ value: goneList }))
    /* rules in force, none injected, so a dispatch naming a task keeps its lane */
    w.rules = { record: 'TR-3', inject: false, revision: 'r1', text: '', values: {} }
    await start($, w)
    for (const [job, tu, task] of [['swept-lane', 'tu-sw', 'T-41'], ['stopped-lane', 'tu-st', 'T-42']]) {
      const brief = { description: job, name: job, prompt: task + ': go.', tool_use_id: tu, background: true }
      await $.tool.call({ tool: 'Agent', ...brief })
      await $.agent.spawn(brief)
    }
    for (const id of ['ag-7', 'ag-8']) { goneList.push({ id, type: 'general-purpose', status: 'running' }); await step($, w, id, 90000) }
    /* each dispatch naming a task opened one run with the engine's id; a minute renews the live ids in one write */
    const opened = w.verbs.filter((v: any) => v.name === 'openRun' && v.body.input.tasks).map((v: any) => [v.body.input.job, v.body.input.agentId, v.body.input.tasks])
    const renews = () => w.verbs.filter((v: any) => v.name === 'renewLease')
    const renewsWas = renews().length
    await w.clock.advance(60000)
    await w.clock.settle()
    expect([opened.slice(-2), renews().length - renewsWas, renews().at(-1).body.input.agentIds, w.boardRuns.filter((r: any) => r.agentId === 'ag-7').length])
      .toEqual([[['swept-lane', 'ag-7', ['T-41']], ['stopped-lane', 'ag-8', ['T-42']]], 1, ['ag-7', 'ag-8'], 1])
    goneList[0].status = 'killed'
    await $.turn.start({ text: 'work', turnId: 't-main-sweep' })
    await w.clock.settle()
    /* the stop a row's second press runs, as the model's own */
    await $.tool.call({ tool: 'TaskStop', task_id: 'ag-8' })
    await w.clock.settle()
    goneList[1].status = 'killed'
    await $.turn.complete({ answer: 'stopped', durationMs: 5, isAborted: false, turnId: 't-ag-8', reason: 'answer', agentId: 'ag-8' })
    await w.clock.advance(3000)
    await w.clock.settle()
    const goneMarks = (id: string) => w.verbs.filter((v: any) => v.name === 'endRun' && v.body.input.agentId === id).map((v: any) => v.body.input.how)
    const goneNotes = (task: string) => w.cliRuns().filter((r: any) => r.args[0] === 'note' && r.args[1] === task).length
    expect([goneMarks('ag-7'), goneNotes('T-41'), goneMarks('ag-8'), goneNotes('T-42')]).toEqual([['handed_on'], 1, ['handed_on'], 1])
  })

  /* background work rows under Background on Home and counts on the agents chip; its stop arms on
     the first press and runs TaskStop with the person's words on the second, a refusal staying on the row;
     the engine's list at a Stop ends what it no longer runs */
  test('background work shows under Background, and its stop takes a second press', HEAVY, async ($: any, on: any) => {
    const w = world(on)
    let n = 0
    /* a call held until its test frees it; moved, its result says the app put it in the background */
    const held = new Map<string, Promise<unknown>>()
    on('tool.call', { tool: 'Bash' }, async ($: any, e: any) => {
      await held.get(e.tool_use_id)
      return { result: { stdout: '', stderr: '', interrupted: false, ...(e.run_in_background || e.moved ? { backgroundTaskId: 'b' + ++n } : {}) } }
    })
    on('tool.call', { tool: 'Monitor' }, () => ({ result: { taskId: 'm1', timeoutMs: 300000 } }))
    on('tool.call', { tool: 'Workflow' }, () => ({ result: { status: 'async_launched', taskId: 'w1', taskType: 'local_workflow', workflowName: 'Two lookups', runId: 'wf_r1' } }))
    let k = 0
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'ag-' + ++k }))
    on('classic.Stop', () => ({}))
    on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Box', props: { key: 'engine-user' }, children: [] }))
    const stops: any[] = []
    on('tool.call', { tool: 'TaskStop' }, ($: any, e: any) => {
      stops.push([e.task_id, e.consent])
      return stops.length === 1 ? { deny: 'No task found with ID: ' + e.task_id + '; it may have ended or moved, so the stop had nothing left to end' } : { result: { message: 'stopped', task_id: e.task_id, task_type: 'local_bash' } }
    })
    await start($, w)
    await $.tool.call({ tool: 'Bash', command: 'npm run watch', description: 'Watch the build', run_in_background: true })
    await $.tool.call({ tool: 'Monitor', command: 'gh run watch', description: 'CI on main', timeout_ms: 300000 })
    await w.clock.settle()
    const ui = await mount($, 'desktop')
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'askerdo', props: { title: 'AskerDo', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
    expect([await live(ui, 'status-agents-count'), await live(pane, 'agent-line-b1'), (await pane.find({ key: 'bg-head' }))?.text])
      .toEqual(['2', expect.stringContaining('shell'), expect.stringMatching(/Background.*2 running/)])
    /* once the pieces know their drawing, one ask a second answers all of Home's live rows; the asks
       ride the next band read's live row (the first two seconds each piece asks for itself) */
    const liveRow = async () => {
      w.change()
      await w.clock.settle()
      const url = String(w.reads.filter((r: any) => String(r.url).includes('/local/band?')).pop().url)
      const rows = JSON.parse(new URLSearchParams(url.split('?')[1]).get('rings') || '[]')
      return rows.find((r: any) => r.x === 'live')
    }
    for (let i = 0; i < 2; i++) await pane.advance(1000)
    await liveRow()
    /* an asker's 900 ms between asks reads the wall clock, which pane.advance does not move: an answer
       within 100 ms of a wall second steps nothing, so with no real wait the next ticks ask none */
    await new Promise((ok) => setTimeout(ok, 1000))
    for (let i = 0; i < 3; i++) await pane.advance(1000)
    expect((await liveRow()).n).toBeLessThanOrEqual(3)
    /* each row leads with its kind's icon: a shell's and a monitor's differ */
    const icons = [await bar(pane, 'agent-line-b1'), await bar(pane, 'agent-line-m1')]
    expect([!!icons[0], !!icons[1], icons[0] !== icons[1]]).toEqual([true, true, true])
    /* each stop button is a square, as wide as tall in the pane's px, holding one glyph; armed it
       keeps its size in another fill and the row's line says to press again, until the arm runs out */
    const faces = async () => (await pane.findAll({ type: 'Box' })).filter((b: any) => /-stopface-/.test(String(b.key)))
      .map((b: any) => ({ face: /^\W$/u.test(String(b.text).trim()) && Math.round(b.props.width * 8.453) === Math.round(b.props.height * 20), fill: b.props.backgroundColor }))
    const rest = await faces()
    await pane.press({ key: 'bg-stop-b1' })
    const armed = await faces()
    expect([rest.map((f) => f.face), armed.map((f) => f.face), armed[0].fill !== rest[0].fill, armed[1].fill === rest[1].fill, await live(pane, 'agent-line-b1')])
      .toEqual([[true, true], [true, true], true, true, expect.stringMatching(/again/)])
    await w.clock.advance(5000)
    await w.clock.settle()
    expect(await live(pane, 'agent-line-b1')).not.toMatch(/again/)
    await pressAgain(pane, 'bg-stop-b1')
    expect(stops).toEqual([])
    await pressAgain(pane, 'bg-stop-b1')
    await w.clock.settle()
    /* the refusal's words whole, on the lines they need */
    expect([stops[0], await live(pane, 'agent-line-b1')]).toEqual([['b1', expect.stringContaining('"Watch the build"')], expect.stringMatching(/No task found.*nothing left to end/)])
    await pressAgain(pane, 'bg-stop-b1')
    await pressAgain(pane, 'bg-stop-b1')
    await w.clock.settle()
    /* a finished row goes under its own done fold below the running ones, shut until pressed */
    expect([stops.length, await pane.find({ key: 'bg-b1' }), (await pane.find({ key: 'background' }))?.text, (await faces()).map((f) => f.face)])
      .toEqual([2, undefined, expect.stringMatching(/1 done\s*Watch the build\s*$/), [true]])
    await pane.press({ key: 'bg-done-fold' })
    await w.clock.settle()
    expect((await pane.find({ key: 'bg-b1' }))?.text).toEqual(expect.stringContaining('stopped'))
    /* a shell that ends after the turn's last call: the Stop's list ends it, its notification next turn says it failed */
    await $.tool.call({ tool: 'Bash', command: 'npm run lint', description: 'Lint', run_in_background: true })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'm1', type: 'monitor', status: 'running' }] })
    const told = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'UserMessage', requestId: 'n-b2', props: { text: '', task: { id: 'b2', status: 'failed', durationMs: 60000 } } })
    await w.clock.advance(1000)
    await w.clock.settle()
    expect((await pane.find({ key: 'bg-b2' }))?.text).toEqual(expect.stringContaining('failed'))
    await told.unmount()
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    await w.clock.advance(1000)
    await w.clock.settle()
    expect([await pane.find({ key: 'background' }), await ui.find({ key: 'status-agents' })]).toEqual([undefined, undefined])
    /* a foreground call still running past the threshold has its row with no agent running, with no
       stop; it leaves when the call returns, and one its result moves to the background stays one row */
    const longCall = async (id: string, moved: boolean) => {
      let free: any
      held.set(id, new Promise((r) => { free = r }))
      const call = $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Full suite', tool_use_id: id, ...(moved ? { moved } : {}) })
      await w.clock.settle()
      const young = await pane.find({ key: 'background' })
      for (let i = 0; i < 3; i++) { await w.clock.advance(1000); await w.clock.settle() }
      const shown = [(await pane.find({ key: 'bg-head' }))?.text, await live(pane, 'agent-line-fg-' + id), await live(ui, 'status-agents-count'), (await faces()).length]
      /* an agent of the session reads the pane as drawn while the call still runs */
      const read = String((await $.tool.call({ tool: 'mcp__askerdo__drawn', part: 'pane', agentId: 'ag-look' })).result)
      free()
      await call
      await w.clock.advance(1000)
      await w.clock.settle()
      return { young, shown, read }
    }
    const fgRun = await longCall('tu-long', false)
    expect([fgRun.young, ...fgRun.shown, await pane.find({ key: 'background' })])
      .toEqual([undefined, expect.stringMatching(/1 running/), expect.stringContaining('foreground'), '1', 0, undefined])
    /* the fold, its count and the row with its running time, at the columns the pane was drawn for */
    const row = fgRun.read.split('\n').find((l) => l.includes('Full suite')) || ''
    expect([/Background\b.*\b1 running/.test(fgRun.read), /\b\d+s\b/.test(row), /\b100\b/.test(fgRun.read)]).toEqual([true, true, true])
    const fgMoved = await longCall('tu-moved', true)
    expect([fgMoved.shown[2], (await pane.find({ key: 'bg-head' }))?.text, await live(pane, 'agent-line-b3')])
      .toEqual(['1', expect.stringMatching(/1 running/), expect.stringContaining('shell')])
    /* its end delivered into a running turn ends the row then, not at the Stop; the
       notification row's run length, later, replaces the notice's arrival */
    await $.tool.call({ tool: 'Bash', command: 'npm run watch', description: 'Watch', run_in_background: true })
    await $.prompt.submit({ text: '<task-notification>\n<task-id>b3</task-id>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>', origin: { kind: 'task-notification', turnId: 't-run' } })
    await w.clock.advance(1000)
    await w.clock.settle()
    const ended = (await pane.find({ key: 'bg-head' }))?.text
    const row3 = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'UserMessage', requestId: 'n-b3', props: { text: '', task: { id: 'b3', status: 'completed', durationMs: 600000 } } })
    await w.clock.advance(1000)
    await w.clock.settle()
    await row3.unmount()
    if (!(await pane.find({ key: 'bg-b3' }))) { await pane.press({ key: 'bg-done-fold' }); await w.clock.settle() }
    expect([ended, (await pane.find({ key: 'bg-b3' }))?.text]).toEqual([expect.stringMatching(/1 running(?!, 2)/), expect.stringContaining('10m')])
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    await w.clock.advance(1000)
    await w.clock.settle()
    /* a command an agent started ends while that agent's turn runs on: no Stop comes, so the
       notification row its conversation keeps ends the row; a call with no description is named from its
       command's work past its setup */
    await $.tool.call({ tool: 'Bash', command: 'cd .sandbox && node scripts/run-tests.mjs test/x.test.mjs', run_in_background: true, agentId: 'ag-lane' })
    await w.clock.advance(1000)
    await w.clock.settle()
    const laneShellRunning = (await pane.find({ key: 'bg-head' }))?.text
    const laneShellName = String(await live(pane, 'agent-line-b5'))
    expect([/run-tests/.test(laneShellName), /\bcd\b|\.sandbox/.test(laneShellName)]).toEqual([true, false])
    await $.session.append({ message: { type: 'user', role: 'user', content: [{ type: 'text', text: '<task-notification>\n<task-id>b5</task-id>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>' }] },
      door: 'delivery', origin: { kind: 'task-notification' }, uuid: 'n-lane-b5', agentId: 'ag-lane' })
    await w.clock.advance(1000)
    await w.clock.settle()
    expect([laneShellRunning, await pane.find({ key: 'background' })]).toEqual([expect.stringMatching(/1 running/), undefined])
    /* a workflow's row and its agents stay and leave together: ended beside a running agent, it goes to the
       done fold with its agents under it, one joined by its run with its call empty; the lane counts once */
    await $.agent.spawn({ description: 'Lane A', prompt: 'Go.', tool_use_id: 'tu-a', background: true })
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'tu-w' })
    await $.agent.spawn({ description: 'Look up one', prompt: 'x', tool_use_id: 'tu-w', workflow: { runId: 'wf_r1', agentIndex: 1 } })
    await $.agent.spawn({ description: 'Look up two', prompt: 'x', tool_use_id: '', workflow: { runId: 'wf_r1', agentIndex: 2 } })
    await step($, w, 'ag-2', 52000)
    for (const id of ['ag-2', 'ag-3']) await $.turn.complete({ answer: 'x', durationMs: 5, isAborted: false, turnId: 't-' + id, reason: 'answer', agentId: id })
    const wtold = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'UserMessage', requestId: 'n-w1', props: { text: '', task: { id: 'w1', status: 'completed', durationMs: 60000 } } })
    await w.clock.advance(1000)
    await w.clock.settle()
    await wtold.unmount()
    const shut = (await pane.find({ key: 'agents-done-head' }))?.text
    await pane.press({ key: 'agents-done-fold' })
    await w.clock.settle()
    const pad = async (id: string) => { const r = await pane.find({ key: 'agent-' + id }); return r ? Number(r.props.paddingLeft) || 0 : -1 }
    expect([shut, await pad('w1'), await pad('ag-2') > 0, await pad('ag-3') > 0, await live(ui, 'status-agents-count')])
      .toEqual([expect.stringMatching(/1 done\s*Two lookups\s*$/), 0, true, true, '1'])
    /* at 238 px a finished agent's detail keeps to two lines as a running one's, its depth's limit going first */
    const wide = (await pane.find({ key: 'agent-ag-2' }))?.text
    await pane.unmount()
    const narrow = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'askerdo', props: { title: 'AskerDo', isFocused: true, bodyColumns: 23, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
    expect([wide, (await narrow.find({ key: 'agent-ag-2' }))?.text]).toEqual([expect.stringMatching(/52k of \d+k/), expect.stringMatching(/52k(?! of)/)])
    await narrow.unmount()
    /* 22 commands ending together while the band read fails: the next read that lands carries 20 end rows
       and a count of the 2 past them */
    w.change()
    await w.clock.settle()
    for (let i = 0; i < 22; i++) await $.tool.call({ tool: 'Bash', command: 'npm run job' + i, description: 'Job ' + i, run_in_background: true })
    await w.clock.settle()
    w.fetchBy['/local/band?'] = { status: 500, ok: false, headers: {}, text: JSON.stringify({ ok: false, error: 'the local server is restarting' }) }
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    w.change()
    await w.clock.advance(1000)
    await w.clock.settle()
    delete w.fetchBy['/local/band?']
    w.change()
    await w.clock.settle()
    const endUrl = String(w.reads.filter((r: any) => String(r.url).includes('/local/band?')).pop().url)
    const endSent = JSON.parse(new URLSearchParams(endUrl.split('?')[1]).get('rings') || '[]')
    expect([endSent.filter((r: any) => r.x === 'bgend').length, endSent.find((r: any) => r.x === 'ends')?.n]).toEqual([20, 2])
    await ui.unmount()
  })

  /* a dispatch onto a task another session's open run holds is refused before
     it starts, naming that run, and opens no run */
  test('a dispatch onto a task another session\'s run holds is refused naming the run, and opens nothing', async ($: any, on: any) => {
    const w = world(on)
    let spawned = 0
    on('agent.spawn', () => { spawned++; return { model: 'claude-opus-5-5', agentId: 'ag-' + spawned } })
    const at = new Date(Date.now() - 600000).toISOString()
    w.boardRuns.push({ run: 1, worker: 'agent', agentId: 'ag-x', job: 'other-lane', session: 'other-sess', pc: 'PC-2', started: at, heard: at, ended: null, tasks: ['T-42'] })
    await start($, w)
    let res: any
    try { res = await $.agent.spawn({ description: 'mine', name: 'mine', prompt: 'T-42: go.', tool_use_id: 'tu-1' }) } catch (err: any) { res = String((err && err.message) || err) }
    await w.clock.settle()
    const said = JSON.stringify(res)
    expect([/run 1\b/.test(said), said.includes('other-lane'), said.includes('PC-2'), spawned, w.verbs.filter((v: any) => v.name === 'openRun').length]).toEqual([true, true, true, 0, 0])
    /* a dispatch opens on the task its prompt names, never on a run of the same job; one
       naming none takes this session's own open run of that job, never another session's */
    for (const [tu, prompt] of [['tu-2', 'T-43: go.'], ['tu-3', 'T-44: go.'], ['tu-4', 'Carry on.']]) {
      await $.agent.spawn({ description: 'other-lane', name: 'other-lane', prompt, tool_use_id: tu })
      await w.clock.settle()
    }
    expect(w.verbs.filter((v: any) => v.name === 'openRun').map((v: any) => v.body.input.tasks)).toEqual([['T-43'], ['T-44'], ['T-43', 'T-44']])
  })

  /* with a worker in flight a stop is refused only for a run of this session that ended with
     its task unsettled, naming its open step and the settling call; the marked second stop passes, and a settle lets it through */
  test('a stop with an agent in flight is refused for its sibling\'s unsettled end until it is settled', HEAVY, async ($: any, on: any) => {
    const w = world(on)
    w.tasks = [{ id: 'T-41', name: 'Cut the tray', steps: [{ n: 1, text: 'build it', done: true }, { n: 2, text: 'measure it' }] }, { id: 'T-42', name: 'Draw the band' }]
    const status: Record<string, string> = {}
    on('agent.list', () => ({ value: Object.entries(status).map(([id, s]) => ({ id, description: id, type: 'general-purpose', status: s })) }))
    const prompts: Record<string, string> = {}
    on('agent.spawn', ($: any, e: any) => {
      const id = e.resume && e.resume.agentId ? e.resume.agentId : 'ag-' + e.name
      status[id] = 'running'; prompts[e.name] = e.prompt; return { model: 'claude-opus-5-5', agentId: id }
    })
    on('classic.Stop', () => ({}))
    on('classic.SubagentStop', () => ({}))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    on('tool.call', { tool: 'Bash' }, ($: any, e: any) => ({ result: { stdout: '', stderr: '', interrupted: false, ...(e.run_in_background ? { backgroundTaskId: 'b-' + e.tool_use_id } : {}) } }))
    on('tool.call', { tool: 'SubagentHandback' }, () => ({ result: { success: true, message: 'Report delivered to your caller.' } }))
    /* an isolated agent's run opens at its own worktree, never the session's folder */
    const WT = 'C:/src/proj/.claude/worktrees/agent-ag-T-41'
    const TIP = 'b'.repeat(40)
    w.git = (argv: string[]) => argv.includes('worktree')
      ? { exitCode: 0, stdout: 'worktree C:/src/proj\nHEAD ' + 'a'.repeat(40) + '\nbranch refs/heads/main\n\nworktree ' + WT + '\nHEAD ' + TIP + '\nbranch refs/heads/worktree-agent-ag-T-41\n\n', stderr: '' }
      : argv[2] === WT ? { exitCode: 0, stdout: WT + '\n' + TIP + '\nworktree-agent-ag-T-41\n', stderr: '' }
        : argv.includes('rev-parse') && !argv[2].includes('agent-') ? { exitCode: 0, stdout: 'C:/src/proj\n' + 'a'.repeat(40) + '\nmain\n', stderr: '' } : { exitCode: 128, stdout: '', stderr: 'fatal' }
    await start($, w)
    for (const t of ['T-41', 'T-42']) {
      const brief = { description: t, name: t, prompt: t + ': go.', tool_use_id: 'tu-' + t }
      if (t === 'T-41') await $.tool.call({ tool: 'Agent', ...brief, isolation: 'worktree' })
      await $.agent.spawn(t === 'T-42' ? { ...brief, background: true } : brief)
    }
    await w.clock.settle()
    const opened = w.boardRuns.find((r: any) => r.agentId === 'ag-T-41')
    expect([opened.repo, opened.branch, opened.startCommit, prompts['T-41'].includes('your own worktree'), prompts['T-41'].includes('C:/src/proj;'),
      w.boardRuns.find((r: any) => r.agentId === 'ag-T-42').repo]).toEqual([WT, 'worktree-agent-ag-T-41', TIP, true, false, 'C:/src/proj'])
    /* the hand-back, naming the agent by its spawn's name, reaches the session before the agent's turn ends;
       and the engine still lists it running at its turn's end and at the recheck (an isolated agent's cleanup) */
    const report = $.prompt.submit({ text: '<agent-message from="T-41">\n[Subagent hand-back]\nBuilt it.', origin: { kind: 'peer' }, isMeta: true })
    await w.clock.settle()
    await $.turn.complete({ answer: 'Built it.', durationMs: 5, isAborted: false, turnId: 't-a', reason: 'answer', agentId: 'ag-T-41' })
    await w.clock.advance(2000)
    await w.clock.settle()
    await report
    expect(['T-41', '2. measure it'].map((x) => w.contexts.at(-1).join('\n').includes(x))).toEqual([true, true])
    /* an isolated agent's end notification places its run, a worktree the engine has removed as named */
    const BS = String.fromCharCode(92)
    await $.prompt.submit({ text: '<task-notification>\n<task-id>ag-T-41</task-id>\n<status>completed</status>\n<worktree><worktreePath>C:' + BS + 'wt' + BS + 'agent-41</worktreePath><worktreeBranch>worktree-agent-41</worktreeBranch></worktree>\n</task-notification>',
      origin: { kind: 'task-notification' } })
    await w.clock.settle()
    const placed = w.boardRuns.find((r: any) => r.agentId === 'ag-T-41')
    expect([placed.repo, placed.branch, placed.startCommit, !!placed.ended, placed.report]).toEqual(['C:/wt/agent-41', 'worktree-agent-41', TIP, true, 'Built it.'])
    const live = [{ id: 'ag-T-42', type: 'subagent', status: 'running' }]
    const first = await $.classic.Stop({ stop_hook_active: false, background_tasks: live })
    const marked = await $.classic.Stop({ stop_hook_active: true, background_tasks: live })
    expect([String(first && first.block).match(/T-41|2\. measure it|task_update/g), !!(marked && marked.block)])
      .toEqual([expect.arrayContaining(['T-41', '2. measure it', 'task_update']), false])
    await $.tool.call({ tool: 'mcp__askerdo__task_update', id: 'T-41', checks: { done: [2] }, status: 'done' })
    const after = await $.classic.Stop({ stop_hook_active: false, background_tasks: live })
    expect([!!(after && after.block), w.stored['unsettled:sess-1']]).toEqual([false, undefined])
    /* an agent woken inside the recheck (its own background work done) keeps its run, and its real end
       carries its report; a later turn end of the gone agent leaves no end for the stop to wait on */
    const turnEnd = (answer: string, turnId: string) => $.turn.complete({ answer, durationMs: 5, isAborted: false, turnId, reason: 'answer', agentId: 'ag-T-42' })
    const run42 = () => w.boardRuns.find((r: any) => r.agentId === 'ag-T-42')
    /* waiting on background work of its own past the recheck, still listed running, keeps its run */
    await $.tool.call({ tool: 'Bash', command: 'npm run build', run_in_background: true, agentId: 'ag-T-42', tool_use_id: 'tu-b42' })
    await turnEnd('Waiting on my build.', 't-a2')
    /* a stop's list inside the recheck that leaves the agent's own shell out is a guess, still a wait */
    await $.classic.SubagentStop({ stop_hook_active: false, background_tasks: [] })
    await w.clock.advance(2000)
    await w.clock.settle()
    expect(!!run42().ended).toBe(false)
    await turnEnd('Waiting on my build.', 't-b')
    await $.turn.start({ text: 'Your build finished.', turnId: 't-c', agentId: 'ag-T-42' })
    await w.clock.advance(2000)
    await w.clock.settle()
    expect(!!run42().ended).toBe(false)
    /* woken again and its next turn ended inside the first recheck, the engine still listing
       it running; the first recheck is superseded, and the run ends with the last turn's report */
    await turnEnd('Waiting again.', 't-c')
    await $.turn.start({ text: 'Done again.', turnId: 't-d', agentId: 'ag-T-42' })
    /* an agent handing on by its CONTINUE line with a report still waits for its hand-back */
    await turnEnd(['Drew it.', 'CONTINUE: the second half.'].join(String.fromCharCode(10)), 't-d')
    status['ag-T-42'] = 'completed'
    await w.clock.advance(2000)
    await w.clock.settle()
    expect([!!run42().ended, run42().how, run42().report.startsWith('Drew it.')]).toEqual([true, 'handed_on', true])
    await turnEnd('Drew it.', 't-e')
    let held: any = 'pending'
    void $.classic.Stop({ stop_hook_active: false, background_tasks: [] }).then((r: any) => { held = String((r && r.block) || '') })
    await w.clock.settle()
    /* a background agent's end before its hand-back holds no stop, and its settle words ride the hand-back */
    const settleLine = /T-42 \([^)]*\): agent/
    const owedHeld = settleLine.test(held)
    await $.prompt.submit({ text: '<agent-message from="T-42">\n[Subagent hand-back]\nDrew it.', origin: { kind: 'peer' }, isMeta: true })
    await w.clock.settle()
    expect([held === 'pending', owedHeld, settleLine.test(w.contexts.at(-1).join('\n'))]).toEqual([false, false, true])
    /* a resumed isolated agent opens in its own worktree, never the session's folder */
    await $.tool.call({ tool: 'SendMessage', to: 'T-41', message: 'Go on.' })
    await $.agent.spawn({ description: 'T-41', name: 'T-41', prompt: 'Go on.', tool_use_id: 'tu-r41', resume: { agentId: 'ag-T-41' } })
    await w.clock.settle()
    const resumed = w.boardRuns.filter((r: any) => r.agentId === 'ag-T-41').at(-1)
    expect([w.boardRuns.filter((r: any) => r.agentId === 'ag-T-41').length, resumed.repo, resumed.startCommit]).toEqual([2, WT, TIP])
    /* an agent that hands its report back with a server of its own left up, which the engine then lists waiting,
       ends at that turn with the handed-back report; its wake when the server ends opens no run and keeps that report */
    status['ag-T-41'] = 'running'
    await $.tool.call({ tool: 'Bash', command: 'npm run serve', run_in_background: true, agentId: 'ag-T-41', tool_use_id: 'tu-s41' })
    await $.tool.call({ tool: 'SubagentHandback', message: 'Served it.', agentId: 'ag-T-41', tool_use_id: 'tu-h41' })
    status['ag-T-41'] = 'waiting'
    await $.turn.complete({ answer: 'Handed it back.', durationMs: 5, isAborted: false, turnId: 't-r41', reason: 'answer', agentId: 'ag-T-41' })
    await w.clock.settle()
    const served = () => w.boardRuns.filter((r: any) => r.agentId === 'ag-T-41')
    expect([!!served().at(-1).ended, served().at(-1).report]).toEqual([true, 'Served it.'])
    /* the engine raises the wake as a resume spawn with no message from the session; it opens no run */
    const opens = w.verbs.filter((v: any) => v.name === 'openRun').length
    await $.agent.spawn({ description: 'T-41', prompt: '', tool_use_id: '', resume: { agentId: 'ag-T-41' } })
    await w.clock.settle()
    /* a message the session sends in the wake's last model call outlives its turn end */
    await $.tool.call({ tool: 'SendMessage', to: 'T-41', message: 'Check the port too.' })
    await $.turn.complete({ answer: 'woke', durationMs: 5, isAborted: false, turnId: 't-w41', reason: 'answer', agentId: 'ag-T-41' })
    status['ag-T-41'] = 'idle'
    await w.clock.advance(62000)
    await w.clock.settle()
    expect([served().length, served().at(-1).report, w.verbs.filter((v: any) => v.name === 'openRun').length]).toEqual([2, 'Served it.', opens])
    /* the engine resumes it with that message after the end: a message, which opens a run; a later wake opens none */
    await $.agent.spawn({ description: 'T-41', prompt: 'Check the port too.', tool_use_id: '', resume: { agentId: 'ag-T-41' } })
    await w.clock.settle()
    await $.turn.complete({ answer: 'Checked.', durationMs: 5, isAborted: false, turnId: 't-m41', reason: 'answer', agentId: 'ag-T-41' })
    await $.agent.spawn({ description: 'T-41', prompt: 'Check the port too.', tool_use_id: '', resume: { agentId: 'ag-T-41' } })
    await w.clock.settle()
    expect([served().length, w.verbs.filter((v: any) => v.name === 'openRun').length - opens]).toEqual([3, 1])
  })

  /* two agents ending together each keep their unsettled run; the store's edits run in turn */
  test('two agents ending together both keep their unsettled runs', HEAVY, async ($: any, on: any) => {
    const w = world(on)
    w.tasks = [{ id: 'T-41', name: 'Cut the tray', steps: [{ n: 1, text: 'build it' }] }, { id: 'T-42', name: 'Draw the band', steps: [{ n: 1, text: 'draw it' }] }]
    const status: Record<string, string> = {}
    on('agent.list', () => ({ value: Object.entries(status).map(([id, s]) => ({ id, description: id, type: 'general-purpose', status: s })) }))
    on('agent.spawn', ($: any, e: any) => { const id = e.resume ? e.resume.agentId : 'ag-' + e.name; status[id] = 'running'; return { model: 'claude-opus-5-5', agentId: id } })
    on('tool.call', { tool: 'Bash' }, ($: any, e: any) => ({ result: { stdout: '', stderr: '', interrupted: false, ...(e.run_in_background ? { backgroundTaskId: 'b-' + e.tool_use_id } : {}) } }))
    on('tool.call', { tool: 'SubagentHandback' }, () => ({ result: { success: true, message: 'Report delivered to your caller.' } }))
    on('classic.SubagentStop', () => ({}))
    await start($, w)
    for (const t of ['T-41', 'T-42']) await $.agent.spawn({ description: t, name: t, prompt: t + ': go.', tool_use_id: 'tu-' + t })
    await w.clock.settle()
    for (const t of ['T-41', 'T-42']) status['ag-' + t] = 'completed'
    await Promise.all(['T-41', 'T-42'].map((t) => $.turn.complete({ answer: 'Did ' + t + '.', durationMs: 5, isAborted: false, turnId: 't-' + t, reason: 'answer', agentId: 'ag-' + t })))
    await w.clock.advance(3000)
    await w.clock.settle()
    expect((w.stored['unsettled:sess-1'] || []).map((x: any) => x.tasks[0]).sort()).toEqual(['T-41', 'T-42'])
    /* a wait on its own build past the 30 minute bound ends the run handed on with no lane note,
       and the agent's later hand-back lands on the run's task as a note */
    await $.tool.call({ tool: 'SendMessage', to: 'T-41', message: 'Build it again.' })
    await $.agent.spawn({ description: 'T-41', name: 'T-41', prompt: 'Build it again.', tool_use_id: 'tu-b41', resume: { agentId: 'ag-T-41' } })
    await w.clock.settle()
    await step($, w, 'ag-T-41', 50000)
    await $.tool.call({ tool: 'Bash', command: 'npm run build', run_in_background: true, agentId: 'ag-T-41', tool_use_id: 'tu-bb41' })
    /* its first end with no hand-back while its build runs is refused once, naming the hand-back; the next goes through */
    const build = [{ id: 'b-tu-bb41', type: 'shell', status: 'running', description: 'npm run build', command: 'npm run build' }]
    const stops = [await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'ag-T-41', background_tasks: build }),
      await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'ag-T-41', background_tasks: build })]
    expect(stops.map((r: any) => /SubagentHandback/.test(String((r && r.block) || '')))).toEqual([true, false])
    await $.turn.complete({ answer: 'Waiting on the build.', durationMs: 5, isAborted: false, turnId: 't-b41', reason: 'answer', agentId: 'ag-T-41' })
    const notesOn = () => w.cliRuns().filter((r: any) => r.args[0] === 'note' && r.args[1] === 'T-41').map((r: any) => String(r.stdin))
    const runs41 = () => w.boardRuns.filter((r: any) => r.agentId === 'ag-T-41')
    const notesWas = notesOn().length
    w.ahead = 31 * 60000
    await w.clock.advance(60000)
    await w.clock.settle()
    expect([runs41().length, !!runs41().at(-1).ended, runs41().at(-1).how, notesOn().length - notesWas]).toEqual([2, true, 'handed_on', 0])
    /* the build's end wakes it as a resume spawn with no message from the session, which opens no run */
    await $.agent.spawn({ description: 'T-41', prompt: '', tool_use_id: '', resume: { agentId: 'ag-T-41' } })
    await w.clock.settle()
    await $.tool.call({ tool: 'SubagentHandback', message: 'Built it at last.', agentId: 'ag-T-41', tool_use_id: 'tu-hb41' })
    status['ag-T-41'] = 'completed'
    await $.turn.complete({ answer: 'Handed back.', durationMs: 5, isAborted: false, turnId: 't-b41b', reason: 'answer', agentId: 'ag-T-41' })
    await w.clock.settle()
    expect([runs41().length, notesOn().slice(notesWas).map((n: string) => n.includes('Built it at last.'))]).toEqual([2, [true]])
  })

  /* with nothing in flight a stop with ready work is refused once, naming it; a task named once is not named
     again; a question the session asked, a reply that asks the user, the user's hold and a handoff each let it through */
  test('a stop with nothing in flight names the ready work once and lets through what waits on the user', HEAVY, async ($: any, on: any) => {
    const w = world(on)
    w.questions = []
    w.tasks = [{ id: 'T-41', name: 'Cut the tray' }, { id: 'T-42', name: 'Draw the band' }]
    on('classic.Stop', () => ({}))
    await start($, w)
    const stop = async (said = 'Done for now.') => { const r = await $.classic.Stop({ stop_hook_active: false, background_tasks: [], last_assistant_message: said }); return String((r && r.block) || '') }
    const named = await stop()
    const again = await stop()
    w.tasks.push({ id: 'T-43', name: 'Fold the pane' })
    w.tracks[0].tasks.push('T-43')
    const asks = await stop('Shall I start T-43 now?')
    w.questions = [{ id: 'Q200', name: 'which first', session: 'sess-1', blocking: false, gist: 'Which first?' }]
    w.change()
    await w.clock.settle()
    const asked = await stop()
    w.questions = []
    w.change()
    await w.clock.settle()
    w.decisions = [{ id: 'K-9', name: 'Hold the track', labels: ['hold'], tracks: ['TR-3'], created: new Date().toISOString() }]
    const holding = await stop()
    w.decisions = []
    const t43 = await stop()
    w.tasks.push({ id: 'T-44', name: 'Trim the rows' })
    w.tracks[0].tasks.push('T-44')
    await $.command.run({ command: 'askerdo', args: 'handoff' })
    await $.tool.call({ tool: 'mcp__askerdo__handoff_write', goal: 'g', focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    await w.clock.settle()
    expect([named.match(/T-4\d/g), again, asks, asked, holding, t43.match(/T-4\d/g), await stop()])
      .toEqual([['T-41', 'T-42'], '', '', '', '', ['T-43'], ''])
  })

  /* a load in another process under the same id is a reopen. The old process's agent run ends
     handed on and its workflow row drops; the session's own run, left open by the app's end, is renewed by the first
     tick, so its task reads running again with no new run and nothing taken back. The app's end ends no run */
  test('a reopened session\'s first tick renews its own runs with no new run, and the app\'s end ends none', HEAVY, async ($: any, on: any) => {
    const at = Date.now() - 600000
    const wf = { id: 'w9', kind: 'workflow', job: 'Two lookups', start: at }
    const w = world(on, { store: { procSessions: { 'sess-1': 'old-proc' }, 'flights:sess-1': { at, proc: 'old-proc', list: [{ id: 'ag-o', job: 'Old lane', model: '', calls: 1, tokens: 0, start: at }], bg: [wf] } } })
    w.tasks = [{ id: 'T-41', name: 'Cut the tray' }, { id: 'T-42', name: 'Draw the band' }]
    const was = new Date(at).toISOString()
    w.boardRuns.push({ run: 1, worker: 'session', agentId: null, job: null, session: 'sess-1', pc: 'PC-1', started: was, heard: was, ended: null, tasks: ['T-41'] },
      { run: 2, worker: 'agent', agentId: 'ag-o', job: 'Old lane', session: 'sess-1', pc: 'PC-1', started: was, heard: was, ended: null, tasks: ['T-42'] })
    on('agent.list', () => ({ value: [] }))
    await start($, w)
    await w.clock.settle()
    const renewed = w.verbs.filter((v: any) => v.name === 'renewLease').at(-1).body.input.agentIds
    await $.prompt.submit({ text: 'go on' })
    await w.clock.settle()
    await $.session.end({ reason: 'other', sessionId: 'sess-1' })
    await w.clock.settle()
    const own = w.boardRuns[0]
    expect([own.ended, own.heard > was, w.boardRuns[1].how, renewed.includes('w9'), w.boardRuns.length, w.verbs.some((v: any) => v.name === 'openRun'), w.last('task update')])
      .toEqual([null, true, 'handed_on', false, 2, false, undefined])
  })

  /* a /clear the app ran in a new process; the earlier id's agent died with its process, so
     its run ends handed on as that id and its flights go, and the lease renews under the new id, which holds the track */
  test('a /clear in a new process ends the earlier id\'s agent runs handed on and renews under the new id', HEAVY, async ($: any, on: any) => {
    const at = Date.now() - 120000
    const w = world(on, { store: { rows: { local_row1: { sid: 'sess-0', track: 'TR-3', tasks: [] } }, procSessions: { 'sess-0': 'old-proc' },
      'flights:sess-0': { at, proc: 'old-proc', list: [{ id: 'ag-o', job: 'walk-a', model: '', calls: 1, tokens: 0, start: at }] } } })
    w.env.CLAUDE_CODE_HOST_SESSION_ID = 'local_row1'
    w.tracks[0].session = 'sess-0'
    const was = new Date(at).toISOString()
    w.boardRuns.push({ run: 1, worker: 'agent', agentId: 'ag-o', job: 'walk-a', session: 'sess-0', pc: 'PC-1', started: was, heard: was, ended: null, tasks: ['T-42'] })
    on('agent.list', () => ({ value: [] }))
    await start($, w)
    await w.clock.advance(60000)
    await w.clock.settle()
    const ends = w.verbs.filter((v: any) => v.name === 'endRun').map((v: any) => [v.body.session, v.body.input.how])
    const renewed = w.verbs.filter((v: any) => v.name === 'renewLease').map((v: any) => v.body.input.session)
    expect([w.boardRuns[0].how, ends, w.stored['flights:sess-0'], renewed.length > 1 && renewed.every((s: string) => s === 'sess-1'), w.tracks[0].session])
      .toEqual(['handed_on', [['sess-0', 'handed_on']], undefined, true, 'sess-1'])
  })

  /* the board hears a real start and every end for a one-session bypass; a hot reload runs
     session.start again in the same process and must not clear a live switch */
  test('a bypass hears a real start and each end, never a reload', HEAVY, async ($: any, on: any) => {
    const w = world(on)
    const heard = () => w.bypassEnds.map((i: any) => [i.session, i.reason])
    const again = async () => { await $.session.start({ cwd: w.cwd, surface: null, isInteractive: false }); await w.clock.settle() }
    await start($, w)
    expect(heard()).toEqual([['sess-1', 'start']])
    await again()
    expect(heard().length).toBe(1)
    await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    w.sid = 'sess-2'
    await w.clock.settle()
    /* a reload after a /clear, the same process under the new id */
    await again()
    expect(heard()).toEqual([['sess-1', 'start'], ['sess-1', 'clear']])
    await $.session.end({ reason: 'other', sessionId: 'sess-2', resume: { id: 'sess-2' } })
    /* a reopen is a new process, whose environment holds no mark */
    delete w.env.ASKERDO_BYPASS_SEEN
    await again()
    expect(heard().slice(2)).toEqual([['sess-2', 'other'], ['sess-2', 'start']])
  })

  /* a hot reload empties the module; the load rebuilds from the store's copy and the
     engine's list, so the agent still running counts, its own helper under it, and its end lands.
     The board's open runs are matched against the list: the listed live one renewed, the listed
     ended one ended, the one the list does not name left out of the renewal, so its last heard stops moving */
  test('a reload keeps the session\'s agents, a helper under the agent that started it', HEAVY, async ($: any, on: any) => {
    const kept = { id: 'ag-r', job: 'Rehearsal', model: 'claude-opus-5-5', calls: 4, tokens: 1000, start: Date.now() - 60000 }
    const w = world(on, { store: { 'flights:sess-1': { at: Date.now() - 60000, list: [kept] } } })
    const reloadHelper = { id: 'ag-h', parentId: 'ag-r', description: 'Helper', type: 'general-purpose', status: 'running' }
    const reloaded = { id: 'ag-r', description: 'Rehearsal', type: 'general-purpose', status: 'running' }
    on('agent.list', () => ({ value: [reloaded, reloadHelper,
      { id: 'ag-d', description: 'Done lane', type: 'general-purpose', status: 'completed' }] }))
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'ag-r' }))
    const was = new Date(Date.now() - 600000).toISOString()
    for (const [run, agentId, task] of [[1, 'ag-r', 'T-51'], [2, 'ag-d', 'T-52'], [3, 'ag-g', 'T-53']] as const)
      w.boardRuns.push({ run, worker: 'agent', agentId, job: 'lane-' + run, session: 'sess-1', pc: 'PC-1', started: was, heard: was, ended: null, tasks: [task] })
    await start($, w)
    await w.clock.settle()
    await w.clock.advance(60000)
    await w.clock.settle()
    const runOf = (id: string) => w.boardRuns.find((r: any) => r.agentId === id)
    expect([runOf('ag-r').heard !== was, runOf('ag-d').how, runOf('ag-g').heard, runOf('ag-g').ended, w.verbs.filter((v: any) => v.name === 'endRun').map((v: any) => v.body.input.agentId),
      w.verbs.filter((v: any) => v.name === 'renewLease').at(-1).body.input.agentIds.includes('ag-g')])
      .toEqual([true, 'finished', was, null, ['ag-d'], false])
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'askerdo', props: { title: 'AskerDo', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
    expect([await live(pane, 'agents-line'), await live(pane, 'agent-line-ag-r'), !!(await pane.find({ key: 'agent-ag-h' }))])
      .toEqual([expect.stringMatching(/1 running/), expect.stringMatching(CALLS(4)), true])
    /* the engine lists an agent that has reported as completed */
    reloadHelper.status = 'completed'
    await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't-ag-h', reason: 'answer', agentId: 'ag-h' })
    /* the store takes the flights at most once a second */
    await w.clock.advance(1000)
    await w.clock.settle()
    expect([await live(pane, 'agents-line'), w.stored['flights:sess-1'].list.map((f: any) => [f.id, !!f.done])])
      .toEqual([expect.stringMatching(/1 running, 1 done(?!,)/), [['ag-r', false], ['ag-h', true], ['ag-d', true]]])
    await pane.unmount()
    /* a /clear after the reload: the run opened under the old id is still renewed as it, and ends at the agent's end */
    await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    w.sid = 'sess-2'
    const heard = runOf('ag-r').heard
    await w.clock.advance(60000)
    await w.clock.settle()
    const renewed = runOf('ag-r').heard !== heard
    reloaded.status = 'completed'
    await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't-ag-r', reason: 'answer', agentId: 'ag-r' })
    await w.clock.advance(1000)
    await w.clock.settle()
    expect([renewed, runOf('ag-r').how, w.verbs.filter((v: any) => v.name === 'endRun').at(-1).body.session]).toEqual([true, 'finished', 'sess-1'])
    /* resumed after the /clear, it opens as the session of its last run, where the board finds that run */
    await $.tool.call({ tool: 'SendMessage', to: 'Rehearsal', message: 'Go on.' })
    await $.agent.spawn({ description: 'Rehearsal', name: 'Rehearsal', prompt: 'Go on.', tool_use_id: 'tu-r2', resume: true })
    await w.clock.settle()
    expect(w.verbs.filter((v: any) => v.name === 'openRun').map((v: any) => v.body.session)).toEqual(['sess-1'])
    /* the unlisted run, silent since the reload, is ended handed on by the session's own call, its task left open */
    const r = await $.tool.call({ tool: 'mcp__askerdo__task_update', id: 'T-53', runEnded: 'handed_on' })
    expect([r.deny, runOf('ag-g').how, w.verbs.filter((v: any) => v.name === 'endRun').at(-1).body, w.last('task update')])
      .toEqual([undefined, 'handed_on', { input: { run: 3, how: 'handed_on' }, session: 'sess-1' }, undefined])
  })

})
