/* The one /askerdo command and its alias answering with no model turn under `claude plugin test`,
 * and the track taken over after /clear. */
import { describe, expect, test } from 'claude-code/testing'
import { COLD_START, start, world } from './world.ts'
import { NEEDS_TRACK, SUBCOMMANDS_LINE } from '../../../lib/mod-core.mjs'
import { SET } from './mod-kit.ts'

const run = ($: any, args = '', command = 'askerdo') => $.command.run({ command, args }).then((r: any) => r.text)

describe('one /askerdo command answers with no model turn', () => {
  test('nothing draws the open set one line per question, no table, ending on the subcommands', COLD_START, async ($: any, on: any) => {
    const w = world(on)
    /* the band's calls and the live handoffs' asks are listed too */
    w.calls = [{ kind: 'look', record: 'k5', id: 'T-5', text: 'T-5 landed', presses: [{ label: 'Close', verb: 'editRecord', input: {} }, { label: 'Not yet', verb: 'lookNotYet', input: {} }] }]
    w.handoffAsks = [{ track: 'TR-8', name: 'side line', handoff: 'TR-8.2', text: 'pick the store' }]
    await start($, w, 'desktop')
    const text = await run($)
    expect([text.includes('T-5 landed'), text.includes('Not yet'), text.includes('pick the store')]).toEqual([true, true, true])
    expect(text).toContain('1 open question for this project, 1 blocking.')
    /* the cards carry the tables; here a line with its tokens */
    expect([text.split('\n').filter((l) => /^- Q106 .*106b \*/.test(l)).length, text.includes('|106')]).toEqual([1, false])
    expect(text).toContain('for example /askerdo 106b.')
    expect(text).toContain('Board: ' + SET)
    expect(text.split('\n').at(-1)).toBe(SUBCOMMANDS_LINE)
    expect(w.last('list').args).toEqual(['list', '--project', 'C:/src/proj', '--json'])
    expect(w.prompts).toEqual([])
  })

  test('a token answers, the rest of the line the note; a bad one gets the usage', async ($: any, on: any) => {
    const w = world(on)
    await start($, w, 'desktop')
    expect(await run($, '106b "files are the truth"')).toContain('Answered Q106 (store shape): 106b. Note: files are the truth')
    expect(w.last('answer').args).toEqual(['answer', 'Q106', '--pick', 'b', '--user', 'sess-1', '--json', '--note', 'files are the truth'])
    expect(await run($, 'Q106 a because')).toContain('Answered Q106 (store shape): 106a. Note: because')
    expect(await run($, '106')).toContain('Usage: /askerdo 106b [note]')
    /* the act's word (allow still taken), then the record the override holds */
    expect(await run($, 'fix K-3')).toContain('Fixed')
    expect(w.last('override').args).toEqual(['override', 'decide', 'K-3', 'fix', '--user', 'sess-1', '--json'])
    expect(await run($, 'allow K-3')).toContain('Fixed')
  })

  test('board, and an unknown word prints the usage', async ($: any, on: any) => {
    const w = world(on)
    await start($, w, 'desktop')
    expect(await run($, 'board')).toContain('The board: ' + SET)
    const usage = await run($, 'answer 106b')
    expect(usage).toContain('Unknown subcommand "answer".')
    for (const verb of ['board', 'track', 'park', 'handoff', 'resume', 'pane']) expect(usage).toContain('/askerdo ' + verb)
    expect(w.last('answer')).toBeUndefined()
  })

  test('track shows, starts and makes its moves; the old thread word says where they went', async ($: any, on: any) => {
    const w = world(on)
    await start($, w, 'desktop')
    expect(await run($, 'track')).toContain('TR-3')
    expect(await run($, 'thread')).toContain('/askerdo track')
    const before = w.markers().length
    expect(await run($, 'track new WS-11 board mod')).toContain('TR-9')
    expect(w.last('track new').args.slice(0, 6)).toEqual(['track', 'new', '--workstream', 'WS-11', '--name', 'board mod'])
    expect(w.markers().length).toBe(before + 1)
    await run($, 'track capture a later idea')
    /* the mod's capture names its tier, so the board places it as a session's filing */
    expect(w.last('track capture').args.slice(2, 6)).toEqual(['--tier', '2', '--track', 'TR-9'])
    /* the user's own command carries the user mark, so the board never asks about it */
    expect([w.last('track capture').args.includes('--user'), w.last('track capture').args.includes('--session')]).toEqual([true, false])
    /* an inbox capture says why it waits on no track, and its wake, or the board refuses it */
    await run($, 'track capture inbox another idea')
    const inbox = w.last('track capture').args
    expect(inbox).toContain('--unplaced')
    expect(inbox[inbox.indexOf('--wake') + 1]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await run($, 'track park "waits on the release"')
    expect(w.last('track park').args.slice(0, 5)).toEqual(['track', 'park', 'TR-9', '--reason', 'waits on the release'])
    /* parked, the session holds nothing more */
    expect(await run($, 'handoff')).toContain(NEEDS_TRACK)
    expect(await run($, 'track new board mod')).toContain('Usage: /askerdo track new')
  })

  test('park asks the model for a parked handoff; the pointer only when no turn can start', async ($: any, on: any) => {
    const w = world(on)
    /* the prompt names the user as "the user" */
    w.contract = { section: null, checks: null }
    await start($, w, 'desktop')
    /* the parking leg's mind goes in the handoff the model writes */
    expect(await run($, 'park "waits on the release"')).toContain('TR-3')
    await w.clock.settle()
    /* the transcript shows one short line in the user's name; the long ask goes first as a note */
    expect([w.prompts.at(-1).length < 120, w.prompts.at(-1).includes('waits on the release')]).toEqual([true, true])
    expect(w.appends.at(-1).content[0].text).toMatch(/^The user is parking TR-3[\s\S]*handoff_write[\s\S]*status parked[\s\S]*waits on the release/)
    expect(w.last('track park')).toBeUndefined()
    w.submitThrows = 1
    await run($, 'park "waits on the release"')
    await w.clock.settle()
    expect(w.last('track park').args).toEqual(['track', 'park', 'TR-3', '--reason', 'waits on the release', '--session', 'sess-1', '--json'])
    expect(await run($, 'park')).toContain('Usage: /askerdo park "reason"')
  })

  test('resume TR-n takes the track and hands over the kickoff; WS-n finds its one shelved track; nothing lists the shelf', async ($: any, on: any) => {
    const w = world(on)
    await start($, w, 'desktop')
    expect(await run($, 'resume')).toContain('/askerdo resume TR-4')
    expect(await run($, 'resume TR-4')).toMatch(/TR-4[\s\S]*starts a turn now/)
    /* the kickoff starts a turn once the command has answered (it sat as a note) */
    await w.clock.settle()
    expect(w.prompts.at(-1)).toContain('Kickoff for TR-4.2')
    expect(w.last('resume').args).toEqual(['resume', 'TR-4', '--session', 'sess-1', '--json'])
    expect(w.tracks[1].session).toBe('sess-1')
    /* words after the id ride the kickoff, after it; a refusal says they were not sent */
    expect(await run($, 'resume TR-4\nLook at the bar first.')).toContain('with your words')
    await w.clock.settle()
    expect(w.prompts.at(-1)).toMatch(/Kickoff for TR-4\.2[\s\S]*Look at the bar first\.$/)
    expect(await run($, 'resume WS-11 Look at the bar first.')).toContain('not sent')
    /* a refused prompt still reaches the model as a note on the next prompt, and the toast says so */
    w.submitThrows = 1
    await run($, 'resume TR-4')
    await w.clock.settle()
    await $.prompt.submit({ text: 'go on' })
    expect(w.told.at(-1).content[0].text).toContain('Kickoff for TR-4.2')
    expect(w.toasts.at(-1)).toContain('as a note')
    /* an untaken track beside it does not stop WS-n taking the parked one */
    w.shelf.push({ track: 'TR-9', key: 'trk9abcd', name: 'side line', state: 'new', workstream: 'WS-12', ready: 2 })
    expect(await run($, 'resume WS-12')).toContain('TR-4')
    expect(w.last('resume').args[1]).toBe('TR-4')
    w.shelf.pop()
    /* the verify-first's pass or fail above the kickoff, the folder check as a dim line; neither blocks */
    w.resumeExtra = {
      verify: { ok: false, repos: [{ path: 'C:/r', ok: false, problems: ['on branch x, the handoff says main'] }] },
      handoffChecks: [{ workstream: 'WS-12', missing: [], warnings: ['now.md is 7000 bytes; its budget is 6144'] }],
    }
    const text = await run($, 'resume TR-4')
    expect(text).toMatch(/TR-4[\s\S]*C:\/r FAILS: on branch x[\s\S]*starts a turn now/)
    expect(w.logs.some((l: string) => l.includes('WS-12') && l.includes('budget'))).toBe(true)
  })

  /* a track another session holds is never taken without one of the user's three moves */
  test('resume on a held track answers its holder and the three moves, and takes nothing', async ($: any, on: any) => {
    const w = world(on)
    w.tracks[1].session = 'other-sess'
    await start($, w, 'desktop')
    const text = await run($, 'resume TR-4')
    /* the app keeps no args, so the first line names the command; the holder by its PC, never its id */
    expect(text.split('\n')[0]).toMatch(/^resume TR-4: /)
    expect(text).toContain('PC-2')
    expect(text).not.toContain('other-sess')
    for (const move of ['--splinter', '--take-over', '--read-only']) expect(text).toContain('/askerdo resume TR-4 ' + move)
    expect([w.tracks[1].session, w.tracks[0].session]).toEqual(['other-sess', 'sess-1'])
    await w.clock.settle()
    expect(w.prompts).toEqual([])
    /* the move the user runs takes it, and the other session hears at its next prompt */
    await run($, 'resume TR-4 --take-over')
    expect(w.last('resume').args).toContain('--take-over')
    expect(w.tracks[1].session).toBe('sess-1')
  })

  test('handoff asks the model through a prompt of its own', async ($: any, on: any) => {
    const w = world(on)
    await start($, w, 'desktop')
    expect(await run($, 'handoff')).toContain('TR-3')
    await w.clock.settle()
    expect(w.prompts.length).toBe(1)
    expect([w.prompts[0].length < 120, w.prompts[0].includes('TR-3')]).toEqual([true, true])
    expect(w.appends.at(-1).content[0].text).toMatch(/handoff_write[\s\S]*resume block/)
  })

  test('home, questions and pane open the one AskerDo pane on their tabs', async ($: any, on: any) => {
    const w = world(on)
    await start($, w, 'desktop')
    expect(await run($, 'home')).toContain('on Home')
    expect(await run($, 'questions')).toContain('on Questions')
    expect(await run($, 'pane')).toContain('on Tracks')
    expect(await run($, 'track pane')).toContain('on Tracks')
    expect(w.panes.map((p: any) => [p.id, p.title.startsWith('AskerDo')])).toEqual(Array(4).fill(['askerdo', true]))
  })

  test('the /resume takeover is gone: the built-in answers every form', async ($: any, on: any) => {
    const w = world(on)
    await start($, w, 'desktop')
    expect(await run($, 'TR-4', 'resume')).toBe('the built-in resume: TR-4')
    expect(await run($, 'WS-12', 'resume')).toBe('the built-in resume: WS-12')
    expect(await run($, '', 'resume')).toBe('the built-in resume: picker')
    expect(w.last('resume')).toBeUndefined()
    expect(w.commands).not.toContain('resume')
  })
})

describe('the personal alias', () => {
  test('registers a second name that does exactly what /askerdo does', async ($: any, on: any) => {
    const w = world(on)
    w.alias = { alias: 'ad' }
    await start($, w, 'terminal')
    expect(w.commands).toEqual(['askerdo', 'ad'])
    expect(await run($, '', 'ad')).toBe(await run($))
    expect(await run($, 'board', 'ad')).toContain('The board: ' + SET)
    expect(await run($, 'thread', 'ad')).toBe(await run($, 'thread'))
    expect(await run($, '106b', 'ad')).toContain('Answered Q106 (store shape): 106b.')
    expect(w.last('answer').args).toEqual(['answer', 'Q106', '--pick', 'b', '--user', 'sess-1', '--json'])
    expect(w.toasts).toEqual([])
  })

  test('no alias saved registers nothing more, and other commands pass through', async ($: any, on: any) => {
    const w = world(on)
    await start($, w, 'desktop')
    expect(w.commands).toEqual(['askerdo'])
    expect(await run($, 'TH-4', 'resume')).toBe('the built-in resume: TH-4')
    expect(w.toasts).toEqual([])
    expect(w.logs).toEqual([])
  })

  test('a refused alias toasts and logs once, and /askerdo still works', async ($: any, on: any) => {
    const w = world(on)
    w.alias = { alias: 'handoff' }
    w.refuse = ['handoff']
    await start($, w, 'terminal')
    expect(w.commands).toEqual(['askerdo'])
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('the alias /handoff was not registered: a skill holds /handoff')
    expect(w.toasts[0]).toContain('/askerdo still works')
    expect(w.logs).toEqual(w.toasts)
    /* a /clear registers everything again; the refusal is not said twice */
    await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    w.sid = 'sess-2'
    await $.prompt.submit({ text: 'carry on' })
    expect(w.commands).toEqual(['askerdo', 'askerdo'])
    expect(w.toasts.length).toBe(1)
    expect(w.logs.filter((l: string) => l.includes('alias')).length).toBe(1)
    expect(await run($, 'board')).toContain('The board: ' + SET)
  })

  test('a name another plugin or a built-in holds is not taken over', async ($: any, on: any) => {
    const w = world(on)
    w.alias = { alias: 'ad' }
    w.listed.push({ name: 'ad', source: 'plugin', plugin: 'azure-devops', description: '' })
    await start($, w, 'desktop')
    expect(w.commands).toEqual(['askerdo'])
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('the alias /ad was not registered: the name belongs to the azure-devops plugin')
  })

  test('a built-in name is not taken over either', async ($: any, on: any) => {
    const w = world(on)
    w.alias = { alias: 'resume' }
    await start($, w, 'terminal')
    expect(w.commands).toEqual(['askerdo'])
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('the alias /resume was not registered: the name belongs to a built-in command')
    expect(await run($, 'TH-4', 'resume')).toBe('the built-in resume: TH-4')
  })

  test('a saved value that is not a bare word is reported, never silent', async ($: any, on: any) => {
    const w = world(on)
    w.alias = { error: 'the alias is the bare word, with no slash' }
    await start($, w, 'terminal')
    expect(w.commands).toEqual(['askerdo'])
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('the alias in your saved options was not registered: the alias is the bare word, with no slash')
  })
})

describe('the alias after a hot reload', () => {
  test('a name a built-in holds is passed on, never answered as /askerdo', async ($: any, on: any) => {
    const w = world(on)
    w.alias = { alias: 'resume' }
    /* no session.start: the module came back from a reload with its memory gone */
    expect(await run($, 'TH-4', 'resume')).toBe('the built-in resume: TH-4')
  })

  test('a name the command list shows this plugin holding is answered', async ($: any, on: any) => {
    const w = world(on)
    w.alias = { alias: 'ad' }
    w.listed.push({ name: 'ad', source: 'plugin', plugin: 'askerdo', description: '' })
    expect(await run($, 'board', 'ad')).toContain('The board: ' + SET)
  })
})

describe('/clear', () => {
  test('the binding moves to the new session id at the first prompt, with its marker', async ($: any, on: any) => {
    /* an agent's unsettled end goes on under the new id, so the stop still asks for its settle */
    const w = world(on, { store: { 'unsettled:sess-1': [{ run: 7, tasks: ['T-41'], job: 'lane', ended: new Date().toISOString(), session: 'sess-1' }] } })
    w.hand = [{ id: 'T-41', name: 'the fix' }]
    w.tasks = [{ id: 'T-41', inHand: 'sess-1' }]
    /* the session's own agent works the task in hand across the /clear */
    const status: Record<string, string> = {}
    on('agent.list', () => ({ value: Object.entries(status).map(([id, s]) => ({ id, description: id, type: 'general-purpose', status: s })) }))
    on('agent.spawn', () => { status['ag-c'] = 'running'; return { model: 'claude-opus-5-5', agentId: 'ag-c' } })
    on('classic.Stop', () => ({}))
    await start($, w)
    await $.agent.spawn({ description: 'Fix lane', name: 'Fix lane', prompt: 'T-41: go.', tool_use_id: 'tu-c' })
    await w.clock.settle()
    const agentRun = () => w.boardRuns.find((r: any) => r.agentId === 'ag-c')
    await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    w.sid = 'sess-2'
    const toolsBefore = w.tools.length
    await $.prompt.submit({ text: 'carry on' })
    /* the old id still holds the lease, so the new one takes it over */
    expect(w.last('resume').args).toEqual(['resume', 'TR-3', '--take-over', '--continues', 'sess-1', '--session', 'sess-2', '--json'])
    /* the hand on the track's task moves too, before the track's take-over ends the old id's */
    expect([w.tracks[0].session, w.tasks[0].inHand]).toEqual(['sess-2', 'sess-2'])
    expect([(w.stored['unsettled:sess-2'] || []).map((x: any) => x.run), w.stored['unsettled:sess-1']]).toEqual([[7], undefined])
    expect(w.markers().at(-1)).toBe('sess-2')
    expect(w.tools.length).toBe(toolsBefore * 2)
    expect((await $.command.run({ command: 'askerdo', args: 'track' })).text).toContain('TR-3')
    /* the agent's run stays open under the earlier id, renewed as it, and its end lands there with its report */
    await w.clock.advance(60000)
    await w.clock.settle()
    expect([w.last('task update').args.includes('--continues'), agentRun().session, agentRun().ended]).toEqual([true, 'sess-1', null])
    status['ag-c'] = 'completed'
    await $.turn.complete({ answer: 'Fixed it.\nCONTINUE: none', durationMs: 5, isAborted: false, turnId: 't-c', reason: 'answer', agentId: 'ag-c' })
    await w.clock.settle()
    const ended = w.verbs.filter((v: any) => v.name === 'endRun').at(-1)
    expect([agentRun().how, agentRun().report, ended.body.session, ended.body.input.continueLine]).toEqual(['finished', 'Fixed it.\nCONTINUE: none', 'sess-1', expect.stringContaining('none')])
    /* and the stop asks for its settle */
    const stop = await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    expect([String((stop && stop.block) || '').includes('T-41'), (w.stored['unsettled:sess-2'] || []).map((x: any) => x.run)]).toEqual([true, [7, agentRun().run]])
  })

  test('the timer moves it too when no prompt comes first, and only once', async ($: any, on: any) => {
    const w = world(on)
    w.env.CLAUDE_CODE_HOST_SESSION_ID = 'local_row1'
    w.hand = [{ id: 'T-41', name: 'the fix' }]
    w.tasks = [{ id: 'T-41', inHand: 'sess-1' }]
    w.fail['task update'] = 'the local server did not answer'
    await start($, w)
    await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    w.sid = 'sess-2'
    await w.clock.advance(300)
    const binds = () => w.cliRuns().filter((r: any) => r.args[0] === 'resume' && r.args.includes('--take-over')).length
    /* a failed task take keeps the row naming the earlier id with the task and the track,
       whose take waits so it cannot end that hand; the next prompt moves both */
    const row1 = () => w.stored.rows.local_row1
    expect([binds(), row1().sid, row1().track, row1().tasks]).toEqual([0, 'sess-1', 'TR-3', ['T-41']])
    delete w.fail['task update']
    await $.prompt.submit({ text: 'carry on' })
    await w.clock.settle()
    expect([binds(), w.tracks[0].session, w.tasks[0].inHand, row1().sid]).toEqual([1, 'sess-2', 'sess-2', 'sess-2'])
    await $.prompt.submit({ text: 'go on' })
    expect(binds()).toBe(1)
  })

  /* the app's row id stays across a rewind, so its holds follow the new id */
  test('a start under a new id on the same app row takes back the track and the task, and tells the model', async ($: any, on: any) => {
    const w = world(on)
    w.env.CLAUDE_CODE_HOST_SESSION_ID = 'local_row1'
    w.hand = [{ id: 'T-81', name: 'the fix' }]
    w.tasks = [{ id: 'T-81', inHand: 'sess-1' }]
    w.tracks[0].tasks.push('T-81')
    /* a cold start's desktop row draws the meters while the band's first load waits */
    let loaded: any
    const held = new Promise((r) => { loaded = r })
    w.fetchBy['/local/band?'] = async (e: any) => { await held; return w.serverBy['/local/band?'](e) }
    await start($, w, 'desktop')
    const props = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} }
    const mount = () => $.ui.mount({ plugin: 'askerdo', surface: 'desktop', component: 'AbovePrompt', props })
    await (await mount()).unmount()
    await w.clock.settle()
    const drawn = async () => { const ui = await mount(); const keys = [!!(await ui.find({ key: 'status-context' })), !!(await ui.find({ key: 'needs-you' }))]; await ui.unmount(); return keys }
    expect(await drawn()).toEqual([true, false])
    loaded()
    await w.clock.settle()
    expect(await drawn()).toEqual([true, true])
    await $.session.end({ reason: 'other', sessionId: 'sess-1' })
    w.sid = 'sess-2'
    await start($, w, 'desktop')
    expect(w.last('resume').args).toEqual(['resume', 'TR-3', '--take-over', '--continues', 'sess-1', '--session', 'sess-2', '--json'])
    expect(w.last('task update').args).toEqual(['task', 'update', 'T-81', '--in-hand', '--take-over', '--continues', 'sess-1', '--session', 'sess-2', '--json'])
    expect([w.tracks[0].session, w.tasks[0].inHand]).toEqual(['sess-2', 'sess-2'])
    /* told with the next prompt */
    await $.prompt.submit({ text: 'go on' })
    const told = w.told.map((m: any) => String(m.content[0].text)).filter((t: string) => t.includes('new id'))
    expect(told.length).toBe(1)
    expect(['TR-3', 'T-81', 'track show TR-3'].every((x) => told[0].includes(x))).toBe(true)
    /* the command's path takes one kind of slash */
    expect(told[0].includes('\\')).toBe(false)
    expect(w.debugLogs.some((l: string) => l.includes('sess-1') && l.includes('sess-2') && l.includes('T-81'))).toBe(true)
  })

  /* another process on the row (a claude run from the shell, or a restart that
     checked before the old id's end landed) leaves a live id's entry alone, and takes it at the
     first prompt after that id ended */
  test('a live id\'s row entry is kept from another process, whose next prompt after the end takes the holds', async ($: any, on: any) => {
    const w = world(on, { store: { rows: { local_row1: { sid: 'sess-0', track: 'TR-3', tasks: ['T-81'] } }, procSessions: { 'sess-0': 'parent-proc' } } })
    w.env.CLAUDE_CODE_HOST_SESSION_ID = 'local_row1'
    /* a claude run from the session's shell inherits its parent's process mark */
    w.env.ASKERDO_PROC = 'parent-proc'
    w.tracks[0].session = 'sess-0'
    w.tasks = [{ id: 'T-81', inHand: 'sess-0' }]
    await start($, w, 'desktop')
    await $.prompt.submit({ text: 'hello' })
    await w.clock.settle()
    expect([w.stored.rows.local_row1.sid, w.cliRuns().filter((r: any) => r.args.includes('--take-over')).length]).toEqual(['sess-0', 0])
    w.stored.rows.local_row1.ended = true
    await $.prompt.submit({ text: 'carry on' })
    await w.clock.settle()
    expect([w.tracks[0].session, w.tasks[0].inHand]).toEqual(['sess-1', 'sess-1'])
    expect(w.stored.rows.local_row1.sid).toBe('sess-1')
  })

  /* the app ran a /clear in a new process; the row's entry never ended, but its id's process
     mark is another's, so the new id holds the track and the task from its start */
  test('a start in a new process after a /clear takes the row\'s holds from the earlier id', async ($: any, on: any) => {
    const w = world(on, { store: { rows: { local_row1: { sid: 'sess-0', track: 'TR-3', name: 'Walk', tasks: ['T-81'] } }, 'proc:sess-0': { mark: 'old-proc', at: Date.now() } } })
    w.env.CLAUDE_CODE_HOST_SESSION_ID = 'local_row1'
    w.tracks[0].session = 'sess-0'
    w.tracks[0].tasks.push('T-81')
    w.tasks = [{ id: 'T-81', inHand: 'sess-0' }]
    await start($, w, 'desktop')
    expect([w.tracks[0].session, w.tasks[0].inHand]).toEqual(['sess-1', 'sess-1'])
    await $.prompt.submit({ text: 'go on' })
    const told = w.told.map((m: any) => String(m.content[0].text)).filter((t: string) => t.includes('new id'))
    expect([told.length, /TR-3/.test(told[0] || '')]).toEqual([1, true])
  })

  test('an exit that is not a clear moves nothing', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    await $.session.end({ reason: 'resume', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    w.sid = 'sess-2'
    await $.prompt.submit({ text: 'hello' })
    await w.clock.advance(300)
    expect(w.cliRuns().filter((r: any) => r.args.includes('--take-over')).length).toBe(0)
  })
})

/* the app wraps a started session's first message, so the command never runs from it */
describe('a started session\'s /askerdo line', () => {
  test('a first prompt that was not typed runs its whole resume line; a typed one and a mention in a sentence do not', async ($: any, on: any) => {
    const w = world(on)
    await start($, w, 'desktop')
    const resumes = () => w.cliRuns().filter((r: any) => r.args[0] === 'resume').length
    await $.prompt.submit({ text: '/askerdo resume TR-4', origin: { kind: 'composer' } })
    expect(resumes()).toBe(0)
    w.sid = 'sess-5'
    const brief = 'Background (from the session that started this one): the look.\nTask:\n/askerdo resume TR-4'
    await $.prompt.submit({ text: brief, origin: { kind: 'peer' } })
    expect(w.last('resume').args).toEqual(['resume', 'TR-4', '--session', 'sess-5', '--json'])
    /* the kickoff rides above the brief, which stays whole */
    expect(w.prompts.at(-1)).toContain('Kickoff for TR-4.2')
    expect(w.prompts.at(-1).endsWith(brief)).toBe(true)
    w.sid = 'sess-6'
    await $.prompt.submit({ text: 'Run /askerdo resume TR-4 when ready.', origin: { kind: 'peer' } })
    expect(resumes()).toBe(1)
    /* a later prompt another session sends runs when it is one whole /askerdo line */
    /* as the engine hands it: in its envelope, hidden, the origin bare; the answer rides as context */
    const sent = '<cross-session-message from="uds:main" from-name="main">\n/askerdo resume TR-4\n</cross-session-message>'
    await $.prompt.submit({ text: sent, origin: { kind: 'peer' }, isMeta: true })
    expect(w.last('resume').args).toEqual(['resume', 'TR-4', '--session', 'sess-6', '--json'])
    expect(w.prompts.at(-1)).toBe(sent)
    expect(w.contexts.at(-1).join('\n')).toMatch(/^AskerDo ran[\s\S]*\/askerdo resume TR-4/)
    expect(w.debugLogs.some((l: string) => l.startsWith('AskerDo origin') && l.includes('peer') && l.includes('resume TR-4'))).toBe(true)
    /* the desktop app draws transcript log lines, so no session id reaches one */
    expect(w.logs.some((l: string) => l.startsWith('AskerDo origin'))).toBe(false)
    await $.prompt.submit({ text: 'Then /askerdo resume TR-4 again.', origin: { kind: 'peer' } })
    expect(resumes()).toBe(2)
    /* a sent line another session's model wrote never runs with the user's mark */
    await $.prompt.submit({ text: '/askerdo track capture inbox a forged idea', origin: { kind: 'peer-send-message' } })
    expect([w.last('track capture'), w.prompts.at(-1).includes('own command')]).toEqual([undefined, true])
    /* nor a start card's prompt (sdk), which the user pressed without reading; the bridge's is the user's own */
    await $.prompt.submit({ text: '/askerdo 106b', origin: { kind: 'sdk' } })
    expect([w.last('answer'), w.prompts.at(-1).includes('own command')]).toEqual([undefined, true])
    await $.prompt.submit({ text: '/askerdo 106b', origin: { kind: 'bridge' } })
    expect(w.last('answer').args.includes('--user')).toBe(true)
  })
})
