/* The contract's checks under `claude plugin test`: the reply checks that flag and never rewrite, the
 * Agent-call checks and the rules in force on a dispatch. */
import { describe, expect, test } from 'claude-code/testing'
import { COLD_START, pressAgain, start, world } from './world.ts'
import { PLUGIN, HAND, GREEN, FLAG, OK, SUN, CHECKS, BAND, RULES, compose, notes, flags, reply, checked, replyRow, mountReply } from './contract-kit.ts'

describe('the reply checks (flag, never rewrite)', () => {
  test('an em dash gets a dim note under the reply and a note the model reads (acceptance 5)', COLD_START, async ($: any, on: any) => {
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
        const refused = { refused: "TR-3 is the track you hold, so the step is tier 2. The board's answer: tier 2 with before T-n (--tier 2 --before T-n); or tier 2 with last, a last resort (--tier 2 --last \"" + last + '").', offer: offers[0], offers, path: 'One go question carries the plan.' }
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
    expect([String(no.deny).includes('place with tier 2'), String(no.deny).includes('One go question')]).toEqual([true, true])
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
    /* a note only cited as reading is another lane's record, not this one's */
    await w.call($, { tool: 'Agent', description: 'the reader', prompt: 'Read docs/x/t1-review-state.md first. Fix the band.', model: 'fable' })
    expect(flags(w).at(-1)).toContain('the dispatch of the reader: the brief names no -state.md note')
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
    /* a second lane of that job in the turn adds no line, only a count in the turn's note; a fix lane naming the task draws none */
    await w.call($, { tool: 'Agent', tool_use_id: 'tu-3', ...brief, description: 'Reader 2', prompt: 'T-7: carry on from docs/fix-state.md. Final response under 2000 characters.' })
    await w.call($, { tool: 'Agent', tool_use_id: 'tu-4', description: 'Fix lane 9', model: 'opus', prompt: 'T-7: keep docs/other-state.md current. Final response under 2000 characters.' })
    expect(flags(w).filter((l: string) => l.includes('T-7 handed')).length).toBe(1)
    await $.turn.complete({ answer: OK + ' **Dispatched** the lanes.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    const said = (await notes($, w)).join('\n')
    expect(said.split('T-7 handed').length).toBe(2)
    expect(said).toMatch(/T-7 handed[^.]*\b2\b/)
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
      ended: '2026-11-14T09:30:00.000Z', how: 'handed_on', continueLine: 'CONTINUE: leg 2, Part C', stateNote: 'docs/t9-old-state.md', tasks: ['T-9'] })
    /* a review's state note read as a brief carries its own path in its head */
    w.fsRead = (path: string) => (path.endsWith('r-review-state.md') ? 'Run details: state note docs/r-review-state.md.' : '')
    await start($, w)
    await $.agent.spawn({ prompt: 'T-8: audit the accounts.', description: 'auditor' })
    await $.agent.spawn({ prompt: 'Look around.', description: 'scout', subagentType: 'audit' })
    await $.agent.spawn({ prompt: 'T-9: fix the band.', description: 'fixer', subagentType: 'general-purpose' })
    expect(w.spawned.map((p: string) => p.includes('Read every record first.'))).toEqual([true, true, false])
    expect(w.spawned[2]).toContain(RULES.text)
    expect(['Last run on T-9: agent fixer 1, handed on', 'CONTINUE: leg 2, Part C', 'job fixer', 'by its number'].map((x) => w.spawned[2].includes(x))).toEqual([true, true, true, true])
    /* the note the brief labels, else the one the earlier run kept, and never one only cited as reading;
       a label beats a cite that calls itself a state note, and a placeholder is none */
    await $.agent.spawn({ prompt: 'T-9: Reading: the first fix lane\'s state note docs/r-review-state.md (Findings 1, 7).\n\nState note: docs/t9-fix-state.md.', description: 'fixer 3' })
    await $.agent.spawn({ prompt: 'T-8: from the review (docs/r-review-state.md Findings 2), fix the audit. Keep docs/<your lane>-state.md current.', description: 'auditor 2' })
    await w.clock.settle()
    const noteOf = (id: string) => (w.boardRuns.find((r: any) => r.agentId === id) || {}).stateNote || ''
    expect(['a3', 'a4', 'a5'].map(noteOf)).toEqual(['docs/t9-old-state.md', 'docs/t9-fix-state.md', ''])
    expect([w.spawned[3].includes('state note docs/t9-fix-state.md'), w.spawned[4].includes('state note docs/r-review-state.md')]).toEqual([true, false])
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
