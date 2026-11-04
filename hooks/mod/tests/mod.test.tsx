/* The mod core under `claude plugin test`: the switch, the
 * typed tools' validation and their CLI calls, the one /askerdo command and its
 * alias answering with no model turn, and the track taken over after /clear. */
import { describe, expect, test } from 'claude-code/testing'
import { LOCAL_ROOT, start, world } from './world.ts'
import { NEEDS_TRACK, SUBCOMMANDS_LINE, resumeBlock } from '../../../lib/mod-core.mjs'

const TOOL = (n: string) => 'mcp__askerdo__' + n
const ASKED = 'One file (a) or many (b, my pick)?'
/* the project's open set on the board, through the local server; in the localhost form the desktop opens */
const SET = LOCAL_ROOT.replace('127.0.0.1', 'localhost') + 'needs-you?repo=' + encodeURIComponent('github.com/owner/proj')

describe('session start', () => {
  test('registers the typed tools in the prompt and the one command, which the typeahead offers', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    expect(w.tools.map((t: any) => t.name)).toEqual(['ask', 'override_request', 'note', 'answer', 'decide', 'task_update', 'handoff_write', 'handoff_update', 'review_covers', 'coverage', 'depth'])
    expect(w.tools.every((t: any) => t.isDeferred === false)).toBe(true)
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
  test('a session moved from a spare reads its rules and files its asks under the new folder at its next turn', async ($: any, on: any) => {
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

  test('note and task_update run the CLI with this session', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    expect((await $.tool.call({ tool: TOOL('note'), id: 'T-13', body: 'half done' })).result).toBe('Noted on T-13.')
    expect(w.last('note').args).toEqual(['note', 'T-13', '--session', 'sess-1', '--json'])
    expect(w.last('note').stdin).toBe('half done')
    expect((await $.tool.call({ tool: TOOL('note'), id: 'X-1', body: 'b' })).deny).toContain('id is Q-n')
    /* one board call, the note riding it */
    const t = await $.tool.call({ tool: TOOL('task_update'), id: 'T-13', status: 'completed', note: 'shipped' })
    expect(t.deny).toBeUndefined()
    expect(w.last('task update').args).toEqual(['task', 'update', 'T-13', '--status', 'completed', '--note', 'shipped', '--session', 'sess-1', '--json'])
    expect((await $.tool.call({ tool: TOOL('task_update'), id: 'T-13', status: 'done' })).deny).toContain('status is one of')
    /* a take and a let-go say which, in words */
    expect((await $.tool.call({ tool: TOOL('task_update'), id: 'T-13', inHand: true })).result).toMatch(/T-13 taken in hand/)
    expect((await $.tool.call({ tool: TOOL('task_update'), id: 'T-13', inHand: false })).result).toMatch(/T-13 let go/)
    /* override_request asks with this session and answers the reply's block; an agent reports it
       to its session instead, through the tool or the CLI, and nothing runs */
    const ov = await $.tool.call({ tool: TOOL('override_request'), kind: 'fix', record: 'K-3', body: 'The port is 17480.', summary: 'Fix the port', reason: 'an import cut a digit' })
    expect(ov.result).toContain('allow K-3 or keep K-3')
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
    expect(w.routed.map((c: any) => c.argv.slice(0, 2).join(' '))).toEqual(expect.arrayContaining(['proc triggers']))
    expect(w.routed.every((c: any) => c.cwd === 'C:/src/proj' && c.env.USERPROFILE === 'C:/Users/test-home' && c.version)).toBe(true)
    expect(w.routed.map((c: any) => c.argv[0])).toEqual(expect.arrayContaining(['depth-marker', 'mod-alias']))
    expect(w.spawns().filter((x: any) => x.args[0] !== 'board')).toEqual([])
    w.routeStatus.register = 409
    const r = await $.tool.call({ tool: TOOL('ask'), name: 'store shape', ask: ASKED, gist: 'g', blocking: true,
      options: [{ type: 'a', option: 'one' }, { type: 'b', option: 'many' }], pick: 'b' })
    expect(r.result).toContain('512b')
    expect(w.routed.some((c: any) => c.argv[0] === 'register' && JSON.parse(c.stdin).name === 'store shape')).toBe(true)
    expect(cliSpawns().map((x: any) => x.args[0])).toEqual(['register'])
    w.routeStatus.task = 500
    const t = await $.tool.call({ tool: TOOL('task_update'), id: 'T-13', status: 'completed' })
    expect(t.deny).toContain('may have run')
    delete w.routeStatus.task
    /* a dead server's local.json: one refused connect starts the server, and the call goes again on the route */
    const done = () => $.tool.call({ tool: TOOL('task_update'), id: 'T-13', status: 'completed' })
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
    const told = () => w.appends.filter((m: any) => /I answered Q106/.test(String(m.content[0].text))).length
    await $.prompt.submit({ text: 'one' })
    expect(told()).toBe(0)
    await $.prompt.submit({ text: 'two' })
    await $.prompt.submit({ text: 'three' })
    expect([told(), w.unacked('sess-1').length]).toEqual([1, 0])
  })

  /* the handoff lets the track go, and the reply closes on its resume block */
  test('handoff_write holds the budget, fills the depth, writes the marker, ends with the TR-n resume block and lets the track go', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    const long = await $.tool.call({ tool: TOOL('handoff_write'), focus: 'next', state: 'x'.repeat(401), verifyFirst: [{ path: 'C:/src/proj' }] })
    expect(long.deny).toContain('state lines over 400 characters: line 1 (401)')
    expect(w.last('handoff write')).toBeUndefined()
    const before = w.markers().length
    const rulings = ['no session starts the next leg itself', { id: 'R1', registered: 'Q61' }]
    const r = await $.tool.call({ tool: TOOL('handoff_write'), focus: 'write the tests', state: 'Done: core.', verifyFirst: [{ path: 'C:/src/proj', branch: 'ws-11' }], rulings })
    expect(r.result.endsWith(resumeBlock('TR-3'))).toBe(true)
    const run = w.last('handoff write')
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
    const again = await $.tool.call({ tool: TOOL('handoff_write'), focus: 'after the resume', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
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
    const write = $.tool.call({ tool: TOOL('handoff_write'), focus: 'f', state: 's', verifyFirst: [{ path: 'C:/src/proj' }] })
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
    const none = await $.tool.call({ tool: TOOL('handoff_write'), focus: 'wire the freeze lift', state: 's', verifyFirst: [{ path: 'C:/x' }] })
    expect(none.deny).toContain('workstream')
    expect(w.last('handoff write')).toBeUndefined()
    /* a write the board did not take comes back whole, the track
       started for it is let go, and a reply without the block is flagged; one with it is not */
    const input = { workstream: 'WS-11', focus: 'wire the freeze lift', state: 's', verifyFirst: [{ path: 'C:/x' }] }
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
    delete w.fail['handoff write']
    const r = await $.tool.call({ tool: TOOL('handoff_write'), workstream: 'WS-11', focus: 'wire the freeze lift', state: 's', verifyFirst: [{ path: 'C:/x' }] })
    const made = w.last('track new').args
    expect([made[made.indexOf('--workstream') + 1], made[made.indexOf('--name') + 1], made[made.indexOf('--session') + 1]]).toEqual(['WS-11', 'wire the freeze lift', 'sess-1'])
    expect(w.last('handoff write').args[2]).toBe('TR-9')
    expect(r.result.endsWith(resumeBlock('TR-9'))).toBe(true)
  })
})

const SURFACES = ['terminal', 'desktop'] as const
const run = ($: any, args = '', command = 'askerdo') => $.command.run({ command, args }).then((r: any) => r.text)

describe('one /askerdo command answers with no model turn', () => {
  for (const surface of SURFACES) {
    test('nothing draws the open set as decision tables, ending on the subcommands (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      /* the band's calls and the live handoffs' asks are listed too */
      w.calls = [{ kind: 'look', record: 'k5', id: 'T-5', text: 'T-5 landed', presses: [{ label: 'Close', verb: 'editRecord', input: {} }, { label: 'Not yet', verb: 'lookNotYet', input: {} }] }]
      w.handoffAsks = [{ track: 'TR-8', name: 'side line', handoff: 'TR-8.2', text: 'pick the store' }]
      await start($, w, surface)
      const text = await run($)
      expect([text.includes('T-5 landed'), text.includes('Not yet'), text.includes('pick the store')]).toEqual([true, true, true])
      expect(text).toContain('1 open question for this project, 1 blocking.')
      expect(text).toContain('|106b *|many files|isolation|more files|')
      expect(text).toContain('Answer with /askerdo <token> [note], for example /askerdo 106b.')
      expect(text).toContain('Board: ' + SET)
      expect(text.split('\n').at(-1)).toBe(SUBCOMMANDS_LINE)
      expect(w.last('list').args).toEqual(['list', '--project', 'C:/src/proj', '--json'])
      expect(w.prompts).toEqual([])
    })

    test('a token answers, the rest of the line the note; a bad one gets the usage (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      await start($, w, surface)
      expect(await run($, '106b "files are the truth"')).toContain('Answered Q106 (store shape): 106b. Note: files are the truth')
      expect(w.last('answer').args).toEqual(['answer', 'Q106', '--pick', 'b', '--user', 'sess-1', '--json', '--note', 'files are the truth'])
      expect(await run($, 'Q106 a because')).toContain('Answered Q106 (store shape): 106a. Note: because')
      expect(await run($, '106')).toContain('Usage: /askerdo 106b [note]')
      /* the word, then the record the override holds */
      expect(await run($, 'allow K-3')).toContain('Allowed override #3')
      expect(w.last('override').args).toEqual(['override', 'decide', 'K-3', 'allow', '--user', 'sess-1', '--json'])
    })

    test('board, and an unknown word prints the usage (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      await start($, w, surface)
      expect(await run($, 'board')).toContain('The board: ' + SET)
      const usage = await run($, 'answer 106b')
      expect(usage).toContain('Unknown subcommand "answer".')
      for (const verb of ['board', 'track', 'park', 'handoff', 'resume', 'pane']) expect(usage).toContain('/askerdo ' + verb)
      expect(w.last('answer')).toBeUndefined()
    })

    test('track shows, starts and makes its moves; the old thread word says where they went (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      await start($, w, surface)
      expect(await run($, 'track')).toContain('TR-3')
      expect(await run($, 'thread')).toContain('/askerdo track')
      const before = w.markers().length
      expect(await run($, 'track new WS-11 board mod')).toContain('TR-9')
      expect(w.last('track new').args.slice(0, 6)).toEqual(['track', 'new', '--workstream', 'WS-11', '--name', 'board mod'])
      expect(w.markers().length).toBe(before + 1)
      await run($, 'track capture a later idea')
      expect(w.last('track capture').args.slice(2, 4)).toEqual(['--track', 'TR-9'])
      /* an inbox capture says why it waits on no track, or the board refuses it */
      await run($, 'track capture inbox another idea')
      expect(w.last('track capture').args).toContain('--unplaced')
      await run($, 'track park "waits on the release"')
      expect(w.last('track park').args.slice(0, 5)).toEqual(['track', 'park', 'TR-9', '--reason', 'waits on the release'])
      /* parked, the session holds nothing more */
      expect(await run($, 'handoff')).toContain(NEEDS_TRACK)
      expect(await run($, 'track new board mod')).toContain('Usage: /askerdo track new')
    })

    test('park asks the model for a parked handoff; the pointer only when no turn can start (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      /* the prompt names the user as "the user" */
      w.contract = { section: null, checks: null }
      await start($, w, surface)
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

    test('resume TR-n takes the track and hands over the kickoff; WS-n finds its one shelved track; nothing lists the shelf (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      await start($, w, surface)
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
      /* a refused prompt still reaches the model as a note, and the toast says so */
      w.submitThrows = 1
      await run($, 'resume TR-4')
      await w.clock.settle()
      expect(w.appends.at(-1).content[0].text).toContain('Kickoff for TR-4.2')
      expect(w.toasts.at(-1)).toContain('as a note')
      expect(await run($, 'resume WS-12')).toContain('TR-4')
      expect(w.last('resume').args[1]).toBe('TR-4')
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
    test('resume on a held track answers its holder and the three moves, and takes nothing (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      w.tracks[1].session = 'other-sess'
      await start($, w, surface)
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

    test('handoff asks the model through a prompt of its own (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      await start($, w, surface)
      expect(await run($, 'handoff')).toContain('TR-3')
      await w.clock.settle()
      expect(w.prompts.length).toBe(1)
      expect([w.prompts[0].length < 120, w.prompts[0].includes('TR-3')]).toEqual([true, true])
      expect(w.appends.at(-1).content[0].text).toMatch(/handoff_write[\s\S]*resume block/)
    })

    test('home, questions and pane open the one AskerDo pane on their tabs (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      await start($, w, surface)
      expect(await run($, 'home')).toContain('on Home')
      expect(await run($, 'questions')).toContain('on Questions')
      expect(await run($, 'pane')).toContain('on Tracks')
      expect(await run($, 'track pane')).toContain('on Tracks')
      expect(w.panes.map((p: any) => [p.id, p.title.startsWith('AskerDo')])).toEqual(Array(4).fill(['askerdo', true]))
    })

    test('the /resume takeover is gone: the built-in answers every form (' + surface + ')', async ($: any, on: any) => {
      const w = world(on)
      await start($, w, surface)
      expect(await run($, 'TR-4', 'resume')).toBe('the built-in resume: TR-4')
      expect(await run($, 'WS-12', 'resume')).toBe('the built-in resume: WS-12')
      expect(await run($, '', 'resume')).toBe('the built-in resume: picker')
      expect(w.last('resume')).toBeUndefined()
      expect(w.commands).not.toContain('resume')
    })
  }
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
    const w = world(on)
    await start($, w)
    await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    w.sid = 'sess-2'
    const toolsBefore = w.tools.length
    await $.prompt.submit({ text: 'carry on' })
    /* the old id still holds the lease, so the new one takes it over */
    expect(w.last('resume').args).toEqual(['resume', 'TR-3', '--take-over', '--session', 'sess-2', '--json'])
    expect(w.tracks[0].session).toBe('sess-2')
    expect(w.markers().at(-1)).toBe('sess-2')
    expect(w.tools.length).toBe(toolsBefore * 2)
    expect((await $.command.run({ command: 'askerdo', args: 'track' })).text).toContain('TR-3')
  })

  test('the timer moves it too when no prompt comes first, and only once', async ($: any, on: any) => {
    const w = world(on)
    await start($, w)
    await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    w.sid = 'sess-2'
    await w.clock.advance(300)
    const binds = () => w.cliRuns().filter((r: any) => r.args.includes('--take-over')).length
    expect(binds()).toBe(1)
    await $.prompt.submit({ text: 'carry on' })
    expect(binds()).toBe(1)
  })

  /* the app's row id stays across a rewind, so its holds follow the new id */
  test('a start under a new id on the same app row takes back the track and the task, and tells the model', async ($: any, on: any) => {
    const w = world(on)
    w.env.CLAUDE_CODE_HOST_SESSION_ID = 'local_row1'
    w.hand = [{ id: 'T-81', name: 'the fix' }]
    w.tasks = [{ id: 'T-81', inHand: 'sess-1' }]
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
    expect(w.last('resume').args).toEqual(['resume', 'TR-3', '--take-over', '--session', 'sess-2', '--json'])
    expect(w.last('task update').args).toEqual(['task', 'update', 'T-81', '--in-hand', '--take-over', '--session', 'sess-2', '--json'])
    expect([w.tracks[0].session, w.tasks[0].inHand]).toEqual(['sess-2', 'sess-2'])
    const told = w.appends.map((m: any) => String(m.content[0].text)).filter((t: string) => t.includes('new id'))
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
    const w = world(on, { store: { rows: { local_row1: { sid: 'sess-0', track: 'TR-3', tasks: ['T-81'] } } } })
    w.env.CLAUDE_CODE_HOST_SESSION_ID = 'local_row1'
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
  })
})
