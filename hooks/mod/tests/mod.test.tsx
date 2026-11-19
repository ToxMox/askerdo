/* The mod core under `claude plugin test`: the switch, and the
 * typed tools' validation and their CLI calls. */
import { describe, expect, test } from 'claude-code/testing'
import { COLD_START, start, world } from './world.ts'
import { NEEDS_TRACK, resumeBlock } from '../../../lib/mod-core.mjs'
import { runsInCaller } from '../../../lib/caller-runs.mjs'
import { TOOL, ASKED } from './mod-kit.ts'

describe('session start', () => {
  test('registers the typed tools in the prompt and the one command, which the typeahead offers', COLD_START, async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    expect(w.tools.map((t: any) => t.name)).toEqual(['ask', 'override_request', 'note', 'answer', 'decide', 'fact', 'task_update', 'place', 'handoff_write', 'handoff_update', 'review_covers', 'coverage', 'depth', 'drawn'])
    /* the rarely called ones load through ToolSearch on first use */
    expect(w.tools.filter((t: any) => t.isDeferred === true).map((t: any) => t.name).sort()).toEqual(['coverage', 'drawn', 'handoff_update', 'handoff_write', 'override_request', 'review_covers'])
    expect(w.tools.filter((t: any) => t.isDeferred !== true).every((t: any) => t.isDeferred === false)).toBe(true)
    expect(w.commands).toEqual(['askerdo'])
    expect(w.markers()).toEqual(['sess-1'])
    /* the typeahead's row for a bare /askerdo writes the space that runs the mod's command */
    const typed = await $.prompt.autocomplete({ text: '/askerdo', cursor: 8, token: '/askerdo', start: 0 })
    expect(typed.suggestions.map((r: any) => r.text)).toContain('/askerdo ')
  })

  test('mod present, drain silent: the switch is set before the settings hooks run', async ($: any, on: any) => {
    const w = world(on)
    await $.classic.SessionStart({ source: 'startup' })
    expect(w.events).toEqual(['env.set ASKERDO_MOD=1', 'settings SessionStart hooks, ASKERDO_MOD=1'])
    await start($, w)
    expect(w.env.ASKERDO_MOD).toBe('1')
  })
})

describe('typed tools', () => {
  test('ask refuses a missing pick before any CLI run', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const before = w.cliRuns().length
    const r = await $.tool.call({ tool: TOOL('ask'), name: 'store shape', ask: ASKED, gist: 'One or many?', blocking: true,
      options: [{ type: 'a', option: 'one' }, { type: 'b', option: 'many' }] })
    expect(r.deny).toContain('pick is required')
    expect(w.cliRuns().length).toBe(before)
  })

  test('ask fills session, project and the held track\'s workstream, and answers the tokens', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    /* a question names its track, never a plan */
    expect((await $.tool.call({ tool: TOOL('ask'), name: 'n', ask: ASKED, gist: 'g', blocking: false, plan: 'P-1' })).deny).toContain('unknown field "plan"')
    const r = await $.tool.call({ tool: TOOL('ask'), name: 'store shape', ask: ASKED, gist: 'One or many?', blocking: true,
      options: [{ type: 'a', option: 'one' }, { type: 'b', option: 'many' }], pick: 'b', gates: ['T-13'], track: 'TR-3' })
    expect(r.result).toContain('answer tokens 512a, 512b; pick 512b')
    const run = w.last('register')
    expect(run.args).toEqual(['register', '--json'])
    /* register takes both columns as text, so a missing one goes on empty */
    expect(JSON.parse(run.stdin)).toEqual({ name: 'store shape', ask: ASKED, gist: 'One or many?', blocking: true,
      options: [{ type: 'a', option: 'one', getsYou: '', costsYou: '' }, { type: 'b', option: 'many', getsYou: '', costsYou: '' }], pick: 'b', gates: ['T-13'], track: 'TR-3',
      session: 'sess-1', projectDir: 'C:/src/proj', workstream: 'WS-11' })
  })

  /* the desktop hands a spare to a project before its first prompt */
  test('a session moved from a spare reads its rules and guard and files its asks under the new folder at its next turn', async ($: any, on: any) => {
    const w = world(on)
    w.rules = { text: 'Rules in force (AskerDo rev r1, for the project):\n- Few tests. [built in]' }
    w.cwd = 'C:/Users/test-home/.claude/spares/spare-x'
    w.root = w.cwd
    on('session.root', () => ({ value: w.root }))
    on('prompt.compose', () => ({ sections: [] }))
    await start($, w)
    const ask = (name: string) => $.tool.call({ tool: TOOL('ask'), name, ask: ASKED, gist: 'g', blocking: false,
      options: [{ type: 'a', option: 'one' }, { type: 'b', option: 'many' }], pick: 'b' })
    /* in the spare the question is kept, never filed under the spare */
    expect((await ask('kept')).result).toContain('L1')
    expect(w.last('register')).toBeUndefined()
    w.root = 'C:/src/zzz'
    await $.turn.start({ text: 'work', turnId: 't1' })
    await w.clock.settle()
    await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] })
    const read = w.runs.filter((r: any) => r.script.endsWith('/rules.mjs')).at(-1).args
    expect(read[read.indexOf('--cwd') + 1]).toBe('C:/src/zzz')
    /* the guard read in the spare is read again for the project, with no press */
    const guardRead = w.runs.filter((r: any) => r.script.endsWith('depth-marker.mjs')).at(-1).args
    expect(guardRead[guardRead.indexOf('--cwd') + 1]).toBe('C:/src/zzz')
    await ask('filed')
    const filed = w.cliRuns().filter((r: any) => r.args[0] === 'register').map((r: any) => JSON.parse(r.stdin))
    expect(filed.map((p: any) => [p.name, p.projectDir])).toEqual([['kept', 'C:/src/zzz'], ['filed', 'C:/src/zzz']])
  })

  test('a CLI refusal reaches the model as the tool error', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    w.fail.register = 'several workstreams: WS-1, WS-2; put workstream in the payload'
    const r = await $.tool.call({ tool: TOOL('ask'), name: 'n', ask: ASKED, gist: 'g', blocking: false })
    expect(r.deny).toBe('ask failed: several workstreams: WS-1, WS-2; put workstream in the payload')
  })

  test('note, fact and task_update run the CLI with this session', async ($: any, on: any) => {
    for (const tool of ['Edit', 'Bash']) on('tool.call', { tool }, () => ({ result: 'ran' }))
    const w = world(on)
    /* another session holds the track, so the answer names its band and reminds the sender */
    w.tracks.push({ id: 'TR-5', key: 'trk5abcd', name: 'band rows', state: 'active', workstream: 'WS-11', session: 'sess-2', text: '', tasks: ['T-13'], now: [], handoffs: [] })
    w.tasks.push({ id: 'T-13', name: 'half', status: 'open', workstream: 'WS-11' })
    await start($, w)
    const noted = (await $.tool.call({ tool: TOOL('note'), id: 'T-13', body: 'half done' })).result
    expect([noted.startsWith('Noted on T-13.'), noted.includes('TR-5 (band rows)'), /raise your hand/i.test(noted)]).toEqual([true, true, true])
    expect(w.last('note').args).toEqual(['note', 'T-13', '--session', 'sess-1', '--json'])
    expect(w.last('note').stdin).toBe('half done')
    /* T-41 sits on TR-3, which this session holds: no reminder */
    expect(/raise your hand/i.test((await $.tool.call({ tool: TOOL('note'), id: 'T-41', body: 'on my own line' })).result)).toBe(false)
    /* a note promising later work is written and its answer names the calls that give it a home */
    const later = (await $.tool.call({ tool: TOOL('note'), id: 'T-41', body: 'The resize case is for later.' })).result
    expect([later.startsWith('Noted on T-41.'), later.includes('checks.add'), later.includes('fact')]).toEqual([true, true, true])
    /* the fact tool records through knowledge new with this session, the body on stdin */
    const fact = await $.tool.call({ tool: TOOL('fact'), title: 'The port is 1748', body: 'Seen in the server log.', files: ['server/*.mjs'] })
    expect([String(fact.result).startsWith('K-90 recorded'), w.last('knowledge new').args.includes('--session'), w.last('knowledge new').stdin]).toEqual([true, true, 'Seen in the server log.'])
    expect((await $.tool.call({ tool: TOOL('fact'), title: 'no body' })).deny).toContain('fact refused')
    expect((await $.tool.call({ tool: TOOL('note'), id: 'X-1', body: 'b' })).deny).toContain('note refused')
    /* a question's notes hold its answer: the refusal points at the decision or the gated task */
    expect((await $.tool.call({ tool: TOOL('note'), id: 'Q12', body: 'b' })).deny).toContain('decision')
    /* one board call, the note riding it */
    const t = await $.tool.call({ tool: TOOL('task_update'), id: 'T-13', status: 'done', note: 'shipped' })
    expect(t.deny).toBeUndefined()
    expect(w.last('task update').args).toEqual(['task', 'update', 'T-13', '--status', 'done', '--note', 'shipped', '--session', 'sess-1', '--json'])
    /* a description rewritten with the title left prints the title, as the note tool does */
    const rewrote = (await $.tool.call({ tool: TOOL('task_update'), id: 'T-13', note: 'scope moved', description: 'the new work' })).result
    expect([rewrote.includes('description amended'), rewrote.includes('The old title')]).toEqual([true, true])
    expect((await $.tool.call({ tool: TOOL('task_update'), id: 'T-13', status: 'completed' })).deny).toContain('status is one of')
    /* a start is a take or an agent: the old word is refused here, naming the take, and nothing reaches the board */
    const sent = w.cliRuns().length
    const old = (await $.tool.call({ tool: TOOL('task_update'), id: 'T-13', status: 'in_progress' })).deny
    expect([/inHand/.test(old), w.cliRuns().length]).toEqual([true, sent])
    /* a close's leftovers ride the CLI's stdin */
    const left = [{ name: 'A bug it found', runBy: 'orchestrator' }, { name: 'Later', runBy: 'fork', unplaced: 'waits on the other line', wake: 'track-ends TR-2' }]
    expect((await $.tool.call({ tool: TOOL('task_update'), id: 'T-13', status: 'done', leftovers: left })).deny).toBeUndefined()
    expect([w.last('task update').args.includes('--leftovers'), JSON.parse(w.last('task update').stdin)]).toEqual([true, left])
    /* a take and a let-go say which, in words */
    expect((await $.tool.call({ tool: TOOL('task_update'), id: 'T-13', inHand: true })).result).toMatch(/T-13 taken in hand/)
    expect((await $.tool.call({ tool: TOOL('task_update'), id: 'T-13', inHand: false })).result).toMatch(/T-13 let go/)
    /* a ruling naming no files or commands governs the commands this turn ran and none of its edited files; one naming [] governs none */
    await $.tool.call({ tool: 'Edit', file_path: 'C:/src/proj/lib/a.mjs', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x && npm publish' })
    await $.tool.call({ tool: TOOL('decide'), title: 'Publish from dev', words: 'publish from dev' })
    const proposed = JSON.parse(w.last('decide').stdin)
    expect([proposed.files, proposed.commands]).toEqual([undefined, ['npm publish']])
    await $.tool.call({ tool: TOOL('decide'), title: 'Rows first', files: [] })
    expect(JSON.parse(w.last('decide').stdin).commands).toBeUndefined()
    /* override_request asks with this session and answers the reply's block; an agent reports it
       to its session instead, through the tool or the CLI, and nothing runs */
    const ov = await $.tool.call({ tool: TOOL('override_request'), kind: 'fix', record: 'K-3', body: 'The port is 17480.', summary: 'Fix the port', reason: 'an import cut a digit' })
    expect(ov.result).toContain('fix K-3 or keep K-3')
    expect(w.last('override').args).toEqual(['override', 'request', '--session', 'sess-1', '--json'])
    expect(JSON.parse(w.last('override').stdin).items).toEqual([{ record: 'K-3', body: 'The port is 17480.' }])
    const ran = w.cliRuns().length
    const agent = await $.tool.call({ tool: TOOL('override_request'), kind: 'fix', record: 'K-3', summary: 's', reason: 'r', agentId: 'ag-1' })
    const shell = await $.tool.call({ tool: 'Bash', command: 'node ~/.claude/askerdo/cli.mjs override request K-3 --kind fix --summary s', agentId: 'ag-1' })
    expect([agent.deny, shell.deny].map((d: any) => /report it to your session/.test(String(d)))).toEqual([true, true])
    expect(w.cliRuns().length).toBe(ran)
  })

  /* no process for a command or script the local server runs; its 409
     starts the process; a call it failed may have run, so it is never run again.
     With no local server answering, the board verb starts it once and the call
     goes on the route; a start that fails is told and nothing runs. */
  test('the CLI and the scripts go through the local route, started once when none answers; a 409 spawns, a 500 is not run again', async ($: any, on: any) => {
    const w = world(on, { server: false })
    await start($, w)
    const starts = () => w.spawns().filter((x: any) => x.args[0] === 'board').length
    const cliSpawns = () => w.spawns().filter((x: any) => x.script.endsWith('askerdo.mjs') && x.args[0] !== 'board')
    expect(starts()).toBe(1)
    expect(w.routed.every((c: any) => c.cwd === 'C:/src/proj' && c.env.USERPROFILE === 'C:/Users/test-home' && c.version)).toBe(true)
    expect(w.routed.map((c: any) => c.argv[0])).toEqual(expect.arrayContaining(['depth-marker', 'mod-alias']))
    /* what the server would refuse is never posted: the load's first scan runs once, as a process */
    expect(w.routed.filter((c: any) => runsInCaller(c.argv))).toEqual([])
    expect(cliSpawns().map((x: any) => x.args.slice(0, 2).join(' '))).toEqual(['proc triggers'])
    const loaded = cliSpawns().length
    w.routeStatus.register = 409
    const r = await $.tool.call({ tool: TOOL('ask'), name: 'store shape', ask: ASKED, gist: 'g', blocking: true,
      options: [{ type: 'a', option: 'one' }, { type: 'b', option: 'many' }], pick: 'b' })
    expect(r.result).toContain('512b')
    expect(w.routed.some((c: any) => c.argv[0] === 'register' && JSON.parse(c.stdin).name === 'store shape')).toBe(true)
    expect(cliSpawns().slice(loaded).map((x: any) => x.args[0])).toEqual(['register'])
    w.routeStatus.task = 500
    const t = await $.tool.call({ tool: TOOL('task_update'), id: 'T-13', status: 'done' })
    expect(t.deny).toContain('may have run')
    delete w.routeStatus.task
    /* a dead server's local.json: one refused connect starts the server, and the call goes again on the route */
    const done = () => $.tool.call({ tool: TOOL('task_update'), id: 'T-13', status: 'done' })
    w.serverDown = true
    expect((await done()).deny).toBeUndefined()
    expect([starts(), w.last('task update').via]).toEqual([2, 'route'])
    /* a start that fails says so plainly, and is not tried again until local.json changes */
    w.serverDown = true
    w.fail.board = 'the board server did not come up: port 7777 is held'
    const refused = await done()
    expect(refused.deny).toContain('could not be started')
    expect(refused.deny).toContain('port 7777 is held')
    const posts = () => w.posts.filter((f: any) => f.url.includes('/local/cli')).length
    const tried = posts()
    await done()
    expect([starts(), posts()]).toEqual([3, tried])
    delete w.fail.board
    w.localServer()
    expect((await done()).deny).toBeUndefined()
    expect([starts(), posts()]).toEqual([3, tried + 1])
    expect(cliSpawns().some((x: any) => x.args[0] === 'task')).toBe(false)
    /* a take the server ran whose reply was reset keeps its lines; the next prompt carries them, once */
    const mod = w.serverBy['/local/mod']
    w.fetchBy['/local/mod'] = (e: any) => {
      const out = mod(e)
      if (JSON.parse(e.init.body).argv[1] !== 'take') return out
      delete w.fetchBy['/local/mod']
      throw new Error('askerdo: $.http.fetch(http://127.0.0.1:7777/x/local/mod) failed: ECONNRESET: The socket connection was closed unexpectedly')
    }
    w.inbox['sess-1'] = [w.event('Q106', 'a')]
    const told = () => w.told.filter((m: any) => /I answered Q106/.test(String(m.content[0].text))).length
    await $.prompt.submit({ text: 'one' })
    expect(told()).toBe(0)
    await $.prompt.submit({ text: 'two' })
    await $.prompt.submit({ text: 'three' })
    expect([told(), w.unacked('sess-1').length]).toEqual([1, 0])
  })

  /* the handoff lets the track go, and the reply closes on its resume block */
  test('handoff_write fills the depth, writes the marker, ends with the TR-n resume block and lets the track go', async ($: any, on: any) => {
    const w = world(on)
    on('agent.spawn', () => ({ model: 'opus', agentId: 'ag-1' }))
    /* the engine's list, read only while set */
    let unseenList: any[] | null = null
    on('agent.list', () => { if (!unseenList) throw new Error('no list'); return { value: unseenList } })
    await start($, w)
    expect(w.last('handoff write')).toBeUndefined()
    /* while an agent of the session runs, nothing is written and no resume block given;
       once it lands, one note says so and the same write goes through */
    /* an agent known only from the engine's list holds the write too, and no note is promised for it */
    unseenList = [{ id: 'ag-unseen', description: 'Unseen lane', type: 'general-purpose', status: 'running' }]
    const unseen = await $.tool.call({ tool: TOOL('handoff_write'), goal: 'g', focus: 'write the tests', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    expect([unseen.result.includes('Unseen lane'), /A note comes/.test(unseen.result), w.last('handoff write')]).toEqual([true, false, undefined])
    unseenList = null
    await $.agent.spawn({ description: 'Stall fix', prompt: 'Go.', tool_use_id: 'tu-1' })
    const waits = await $.tool.call({ tool: TOOL('handoff_write'), goal: 'g', focus: 'write the tests', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    expect([waits.deny, waits.result.includes('Stall fix'), waits.result.includes('/askerdo resume'), /A note comes/.test(waits.result), w.last('handoff write')])
      .toEqual([undefined, true, false, true, undefined])
    const landed = () => w.told.filter((m: any) => /has landed/.test(String(m.content[0].text))).length
    /* an agent whose turn ends while it waits on background work of its own has not reported:
       the write still holds and names it, and no note comes until its real end */
    unseenList = [{ id: 'ag-1', description: 'Stall fix', type: 'general-purpose', status: 'waiting' }]
    await $.turn.complete({ answer: 'waiting on my suite', durationMs: 5, isAborted: false, turnId: 't-agw', reason: 'answer', agentId: 'ag-1' })
    await w.clock.advance(3000)
    await w.step($)
    /* the review's minor: with an untracked agent beside it, the answer names that one again as getting no note */
    unseenList = [...unseenList, { id: 'ag-unseen', description: 'Unseen lane', type: 'general-purpose', status: 'running' }]
    const pausedWrite = await $.tool.call({ tool: TOOL('handoff_write'), goal: 'g', focus: 'write the tests', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    expect([pausedWrite.result.includes('Stall fix'), pausedWrite.result.split('Unseen lane').length - 1, w.last('handoff write'), landed()]).toEqual([true, 2, undefined, 0])
    unseenList = [{ id: 'ag-1', description: 'Stall fix', type: 'general-purpose', status: 'completed' }]
    await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't-ag', reason: 'answer', agentId: 'ag-1' })
    await w.step($)
    await w.step($)
    expect(landed()).toBe(1)
    /* the note names the job without the time it had when the write was held */
    const note = String(w.told.find((m: any) => /has landed/.test(String(m.content[0].text))).content[0].text)
    expect([note.includes('Stall fix'), /agent, \d/.test(note)]).toEqual([true, false])
    const before = w.markers().length
    const rulings = ['no session starts the next leg itself', { id: 'R1', registered: 'Q61' }]
    /* a 480 character bullet goes to the board wrapped under itself, and the result says so */
    const state = 'Done: core.\n- ' + 'a clause, '.repeat(48).trim()
    const r = await $.tool.call({ tool: TOOL('handoff_write'), goal: 'g', focus: 'write the tests', state, verifyFirst: [{ path: 'C:/src/proj', branch: 'ws-11' }], rulings })
    expect(r.result.endsWith(resumeBlock('TR-3'))).toBe(true)
    expect(r.result).toMatch(/wrapped 1 line/i)
    const run = w.last('handoff write')
    const sent = JSON.parse(run.stdin).state.split('\n')
    expect([sent.length, sent[2].startsWith('  '), sent.every((l: string) => l.length <= 400)]).toEqual([3, true, true])
    expect(run.args).toEqual(['handoff', 'write', 'TR-3', '--session', 'sess-1', '--json'])
    expect(JSON.parse(run.stdin).depthAtHandoff).toEqual({ tokens: 120000, percent: 60 })
    /* the rulings reach the store, which carries them until each is registered */
    expect(JSON.parse(run.stdin).rulings).toEqual(rulings)
    /* the track's marker written, then the session's own guard read */
    expect(w.markers().length).toBe(before + 2)
    /* the session holds no track now: a handoff asked for after it has none to write */
    expect((await $.command.run({ command: 'askerdo', args: 'handoff' })).text).toContain(NEEDS_TRACK)
    /* a track taken back through the CLI is read from the board at the next write */
    w.tracks[0].session = 'sess-1'
    const again = await $.tool.call({ tool: TOOL('handoff_write'), goal: 'g', focus: 'after the resume', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    expect(again.deny).toBeUndefined()
    expect(w.last('handoff write').args[2]).toBe('TR-3')
  })

  /* the board lets the track go and the long poll hears it before the write's own answer */
  test('a handoff that lets the track go tells no take-over at the next prompt; a take-over by another session is told once', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const cli = w.cli
    let answer = () => {}
    w.cli = (args: string[], stdin?: string, env?: any) => {
      const r = cli(args, stdin, env)
      if (args[0] !== 'handoff' || args[1] !== 'write') return r
      w.marker += '+'
      return new Promise((ok) => { answer = () => ok(r) })
    }
    const write = $.tool.call({ tool: TOOL('handoff_write'), goal: 'g', focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
    await w.clock.settle()
    answer()
    expect((await write).result).toContain('let TR-3 go')
    await $.prompt.submit({ text: 'go on' })
    expect(w.prompts.at(-1)).not.toContain('no longer holds')
    w.cli = cli
    await $.command.run({ command: 'askerdo', args: 'resume TR-3' })
    await w.clock.settle()
    w.tracks[0].session = 'sess-2'
    w.marker += '+'
    await w.clock.settle()
    await $.prompt.submit({ text: 'and on' })
    expect(w.prompts.at(-1)).toContain('no longer holds TR-3')
    await $.prompt.submit({ text: 'once more' })
    expect(w.prompts.at(-1)).not.toContain('no longer holds')
    /* a track the session leaves through the CLI (here track finish) is no take-over */
    delete w.tracks[0].session
    await $.command.run({ command: 'askerdo', args: 'resume TR-3' })
    await w.clock.settle()
    w.cli(['track', 'finish', 'TR-3', '--session', 'sess-1', '--json'])
    w.marker += '+'
    await w.clock.settle()
    await $.prompt.submit({ text: 'finished it' })
    expect(w.prompts.at(-1)).not.toContain('no longer holds')
  })

  test('handoff_write with no track held starts one in the workstream named, from the focus', async ($: any, on: any) => {
    const w = world(on)
    w.tracks[0].session = 'someone-else'
    w.contract = { section: 'The mod section.', checks: {} }
    await start($, w)
    const none = await $.tool.call({ tool: TOOL('handoff_write'), goal: 'g', focus: 'wire the freeze lift', state: 's', verifyFirst: [{ path: 'C:/x' }] })
    expect(none.deny).toContain('workstream')
    expect(w.last('handoff write')).toBeUndefined()
    /* a write the board did not take comes back whole, the track
       started for it is let go, and a reply without the block is flagged; one with it is not */
    const input = { workstream: 'WS-11', goal: 'g', focus: 'wire the freeze lift', state: 's', verifyFirst: [{ path: 'C:/x' }] }
    w.fail['handoff write'] = 'the board is offline: handoff write was not written'
    const flagged = w.logs.length
    const flags = () => w.logs.slice(flagged).filter((l: string) => l.startsWith('AskerDo: ')).length
    const lost = async (turnId: string, answer: (block: string) => string) => {
      await $.turn.start({ text: 'work', turnId })
      const r = await $.tool.call({ tool: TOOL('handoff_write'), ...input })
      const block = r.deny.slice(r.deny.indexOf('```'))
      expect(JSON.parse(block.replace(/^```json\n|\n```$/g, ''))).toEqual(input)
      await $.turn.complete({ answer: answer(block), durationMs: 5, isAborted: false, turnId, reason: 'answer' })
    }
    await lost('t1', () => 'The board is down.')
    expect(w.last('track drop').args[2]).toBe('TR-9')
    expect(flags()).toBe(1)
    await lost('t2', (block) => 'The board is down, so the handoff rides here:\n\n' + block.replace(/\n {2}/g, '\n    '))
    expect(flags()).toBe(1)
    /* a lost call the board shows no handoff for keeps the track started for it; one that landed reads as written once */
    w.fail['handoff write'] = 'the local server dropped the call; it may have run, so it was not run again'
    const count = (verb: string) => w.cliRuns().filter((x: any) => x.args.join(' ').startsWith(verb)).length
    const drops = count('track drop')
    /* the fake keeps each started TR-9 apart: the dropped ones are let go here */
    for (const t of w.tracks) if (t.session === 'sess-1') delete t.session
    const pending = $.tool.call({ tool: TOOL('handoff_write'), ...input })
    await w.clock.settle()
    await w.clock.advance(5000)
    await w.clock.settle()
    const unseen = await pending
    expect(unseen.deny).toMatch(/may still land[\s\S]*started for it, stays with this session[\s\S]*carries this handoff whole/)
    expect(count('track drop')).toBe(drops)
    delete w.fail['handoff write']
    w.lateWrite = true
    const writes = count('handoff write')
    const late = await $.tool.call({ tool: TOOL('handoff_write'), goal: 'g', focus: input.focus, state: 's', verifyFirst: [{ path: 'C:/x' }], nextPc: 'desk' })
    w.lateWrite = false
    expect(late.result).toMatch(/Wrote TR-9\.5 \(waiting\) on TR-9[\s\S]*read back from the board[\s\S]*Resume TR-9 in a new session on desk/)
    expect([count('handoff write') - writes, count('track drop'), w.last('handoff write').args[2]]).toEqual([1, drops, 'TR-9'])
    const r = await $.tool.call({ tool: TOOL('handoff_write'), workstream: 'WS-11', goal: 'g', focus: 'wire the freeze lift', state: 's', verifyFirst: [{ path: 'C:/x' }] })
    const made = w.last('track new').args
    /* the track started for it takes the handoff's goal */
    expect([made[made.indexOf('--workstream') + 1], made[made.indexOf('--name') + 1], made[made.indexOf('--goal') + 1], made[made.indexOf('--session') + 1]]).toEqual(['WS-11', 'wire the freeze lift', 'g', 'sess-1'])
    expect(w.last('handoff write').args[2]).toBe('TR-9')
    expect(r.result.endsWith(resumeBlock('TR-9'))).toBe(true)
  })
})
