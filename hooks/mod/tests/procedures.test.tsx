/* Procedure pointers under `claude plugin test`: the tool-call watcher
 * points the model at a procedure's file (a note and a toast, never a block),
 * `/askerdo proc` finds and records runs, and the Agent check names the testing
 * rule when the `agents` option is on. */
import { describe, expect, test } from 'claude-code/testing'
import { COLD_START, start, world } from './world.ts'

const RELEASE = {
  id: 'PR-2', key: 'w0n84ns3', name: 'Cut an AskerDo release', slug: 'release', status: 'active',
  project: 'C:/src/proj', doc: 'docs/procedures/release.md', path: 'C:/src/proj/docs/procedures/release.md',
  repos: { site: 'C:/src/site' }, words: ['release'], commands: ['commit -m "release:'],
  files: ['.claude-plugin/plugin.json', '**/*.csproj | PackageReference', 'site:public/*.html'],
  stale: [], flag: '', verifiedAt: '2026-10-19T10:00:00+00:00', runs: 2, cleanRuns: 2, badge: 'fresh', reasons: [],
}
const TESTS = {
  ...RELEASE, id: 'PR-3', key: 'sp83a8qm', name: 'Run the tests without wasting time', slug: 'run-tests',
  doc: 'docs/procedures/run-tests.md', path: 'C:/src/proj/docs/procedures/run-tests.md', repos: {},
  commands: ['node --test'], files: [], record: 'command', stale: ['changed since a2a2042: test/ (2 commits)'], badge: 'stale',
  reasons: ['changed since a2a2042: test/ (2 commits)'],
}

/* a decision governing the release commit, as decisions triggers prints it */
const RULING = {
  id: 'K-12', key: 'kd12abcd', name: 'A release commit names its version', words: 'every release commit says release: x.y.z.',
  files: [], commands: ['commit -m "release:'], scope: 'project', projectRepos: ['proj'], tasks: ['T-5'], project: 'C:/src/proj',
}

/* the fake CLI's proc verbs, over the world's own */
function procWorld(on: any) {
  const w = world(on)
  w.cards = [RELEASE, TESTS]
  const base = w.cli
  w.cli = (args: string[], stdin?: string) => {
    const json = (v: any) => ({ exitCode: 0, stdout: JSON.stringify(v) + '\n', stderr: '' })
    if (args[0] === 'decisions' && args[1] === 'triggers') return json(w.rulings || [])
    if (args[0] !== 'proc') return base(args, stdin)
    if (args[1] === 'triggers') return json(w.cards)
    if (args[1] === 'find') return json(w.cards.filter((c: any) => c.words.some((x: string) => x.includes(args[2]))))
    if (args[1] === 'scan') return json({ project: w.cwd, created: [], updated: ['PR-2'], retired: [], unchanged: ['PR-3'], unparseable: [], warnings: [] })
    if (args[1] === 'ran') {
      const deviated = args[3] === 'deviated'
      return json({ id: 'PR-2', slug: args[2], name: RELEASE.name, result: args[3], runs: 3, cleanRuns: deviated ? 0 : 3, stale: [],
        flag: deviated ? 'x' : '', path: RELEASE.path,
        ...(deviated && args.includes('--one-off') ? { outcome: { kind: 'one-off', ref: args[args.indexOf('--one-off') + 1] } } : {}) })
    }
    return { exitCode: 1, stdout: '', stderr: 'AskerDo: unknown proc verb\n' }
  }
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited' }))
  return w
}

const pointers = (w: any, agentId?: string) => w.told.filter((m: any) => m.agentId === agentId
  && String(m.content[0].text).startsWith('AskerDo procedure pointer')).map((m: any) => m.content[0].text)

describe('the procedure watcher', () => {
  test('a matching command runs, and the model is pointed at the file once with a toast', COLD_START, async ($: any, on: any) => {
    const w = procWorld(on)
    w.rulings = [RULING]
    /* the scan starts with the session; a call before it lands goes on without a card */
    let release: any
    w.hold = { verb: 'proc triggers', until: new Promise((r) => { release = r }) }
    await start($, w)
    expect((await w.call($, { tool: 'Bash', command: 'git commit -m "release: 0.5.34"' })).result).toBe('ran')
    expect(pointers(w).length).toBe(0)
    release()
    await w.clock.settle()
    const r = await w.call($, { tool: 'Bash', command: 'git commit -m "release: 0.5.35" -- CHANGELOG.md' })
    expect(r.result).toBe('ran')
    const notes = pointers(w)
    expect(notes.length).toBe(1)
    /* a pointer rides the call it matched, never a row appended mid-turn, which moves at the next turn */
    expect([r.context.includes(notes[0]), w.appends.length]).toEqual([true, 0])
    expect(notes[0]).toContain('procedure PR-2 Cut an AskerDo release')
    expect(notes[0]).toContain('C:/src/proj/docs/procedures/release.md')
    /* a card that does not opt in leaves the run to the session */
    expect(notes[0]).toContain('askerdo proc ran release clean')
    /* the decision's toast raised first; the procedure's shows once it ends */
    await w.clock.advance(8000)
    await w.clock.settle()
    expect(w.toasts.at(-1)).toContain('PR-2')
    /* the first read scans this project; the next calls read the cache */
    expect(w.last('proc triggers').args).toContain('--project')
    await w.call($, { tool: 'Bash', command: 'git commit -m "release: 0.5.35"' })
    expect(pointers(w).length).toBe(1)
    expect(w.cliRuns().filter((x: any) => x.args[0] === 'proc' && x.args[1] === 'triggers').length).toBe(1)
    /* only a card that opts in (record: command) is recorded clean when its command exits 0,
       once in the turn, under this session; its pointer asks only for a deviation */
    await w.clock.settle()
    const ranArgs = () => w.cliRuns().filter((x: any) => x.args[0] === 'proc' && x.args[1] === 'ran').map((x: any) => x.args)
    expect(ranArgs()).toEqual([])
    await w.call($, { tool: 'Bash', command: 'node --test test/a.test.mjs' })
    await w.call($, { tool: 'Bash', command: 'node --test test/b.test.mjs' })
    await w.clock.settle()
    const ran = ranArgs()
    expect(ran.length).toBe(1)
    expect([ran[0].slice(2, 4), ran[0][ran[0].indexOf('--session') + 1]]).toEqual([['run-tests', 'clean'], 'sess-1'])
    expect(pointers(w).at(-1)).not.toContain('proc ran run-tests clean')
    /* the decision the commit touches is pointed at once in the loop, in one line with the user's words */
    const ruled = w.told.filter((m: any) => !m.agentId && String(m.content[0].text).startsWith('AskerDo decision pointer')).map((m: any) => m.content[0].text)
    expect(ruled.length).toBe(1)
    expect(ruled[0]).toContain('K-12')
    expect(ruled[0]).toContain('A release commit names its version')
    expect(ruled[0]).toContain('every release commit says release: x.y.z')
    expect(ruled[0]).not.toContain('\n')
    /* words that end in a stop get no second one */
    expect(ruled[0]).not.toMatch(/\."\./)
    expect(w.cliRuns().filter((x: any) => x.args[0] === 'decisions').length).toBe(1)
    /* the toast's read marks the ruling used by this session, once */
    await w.clock.settle()
    expect(w.cliRuns().filter((x: any) => x.args[0] === 'read').map((x: any) => x.args)).toEqual([['read', 'K-12', '--site', 'toast', '--session', 'sess-1', '--json']])
  })

  test('after the store moves, a call reads the last cards and the refresh runs behind it', async ($: any, on: any) => {
    const w = procWorld(on)
    await start($, w)
    await w.call($, { tool: 'Bash', command: 'git commit -m "release: 1"' })
    expect(pointers(w).length).toBe(1)
    w.cards = []
    w.marker = '2026-10#9'
    await w.clock.advance(15000)
    await w.clock.settle()
    await w.call($, { tool: 'Bash', command: 'git commit -m "release: 2"', agentId: 'ag-2' })
    expect(pointers(w, 'ag-2').length).toBe(1)
    const reads = w.cliRuns().filter((x: any) => x.args[0] === 'proc' && x.args[1] === 'triggers')
    expect(reads.length).toBe(2)
    expect(reads[1].args).toEqual(['proc', 'triggers', '--project', 'C:/src/proj', '--json', '--no-scan'])
    await w.clock.settle()
    await w.call($, { tool: 'Bash', command: 'git commit -m "release: 3"', agentId: 'ag-3' })
    expect(pointers(w, 'ag-3')).toEqual([])
  })

  test('a stale card says so in the pointer, and an agent gets its own', async ($: any, on: any) => {
    const w = procWorld(on)
    await start($, w)
    await w.call($, { tool: 'Bash', command: 'node --test test/a.test.mjs', agentId: 'ag-1' })
    const notes = pointers(w, 'ag-1')
    expect(notes.length).toBe(1)
    expect(notes[0]).toContain('The card is stale (changed since a2a2042: test/ (2 commits))')
    expect(pointers(w).length).toBe(0)
  })

  test('an edit matches a file glob, with its contains text, in this repo or a covered one', async ($: any, on: any) => {
    const w = procWorld(on)
    await start($, w)
    const r = await w.call($, { tool: 'Edit', file_path: 'C:/src/proj/src/App.csproj', old_string: 'a', new_string: 'b' })
    expect(r.result).toBe('edited')
    expect(pointers(w).length).toBe(0)
    await w.call($, { tool: 'Edit', file_path: 'C:\\src\\site\\public\\index.html', old_string: 'a', new_string: 'b' })
    expect(pointers(w)[0]).toContain('the edit of public/index.html matches site:public/*.html')
  })

  /* a knowledge record's file glob points as a decision's does, and pointers.knowledge off silences it */
  const FACT = {
    id: 'K-20', key: 'kf20abcd', name: 'Schema edits need a migration', type: 'gotcha', files: ['src/db/**'], commands: [],
    scope: 'project', projectRepos: ['proj'], tasks: [], project: 'C:/src/proj',
  }
  const facts = (w: any) => w.told.filter((m: any) => String(m.content[0].text).startsWith('AskerDo knowledge pointer')).map((m: any) => m.content[0].text)

  test('an edit a knowledge record\'s glob takes points at it once; another file draws nothing', async ($: any, on: any) => {
    const w = procWorld(on)
    w.rulings = [FACT]
    await start($, w)
    await w.call($, { tool: 'Edit', file_path: 'C:/src/proj/src/app.ts', old_string: 'a', new_string: 'b' })
    /* the first call starts the read; the next ones match against it */
    await w.clock.settle()
    expect(facts(w)).toEqual([])
    await w.call($, { tool: 'Edit', file_path: 'C:/src/proj/src/db/schema.ts', old_string: 'a', new_string: 'b' })
    await w.call($, { tool: 'Edit', file_path: 'C:/src/proj/src/db/seed.ts', old_string: 'a', new_string: 'b' })
    expect(facts(w).length).toBe(1)
    expect(facts(w)[0]).toContain('K-20')
    expect(facts(w)[0]).toContain('Schema edits need a migration')
    await w.clock.advance(8000)
    await w.clock.settle()
    expect(w.toasts.some((t: string) => t.includes('K-20'))).toBe(true)
  })

  /* an edit of a shared file many rulings name carries one compact block and draws one toast */
  test('an edit matching more than three records carries one block of titles and one counted toast', async ($: any, on: any) => {
    const w = procWorld(on)
    w.rulings = [1, 2, 3, 4, 5].map((n) => ({ ...RULING, id: 'K-3' + n, key: 'kd3' + n + 'abcd', name: 'Band ruling ' + n, commands: [], files: ['lib/shared.mjs'] }))
    await start($, w)
    await w.call($, { tool: 'Edit', file_path: 'C:/src/proj/src/app.ts', old_string: 'a', new_string: 'b' })
    await w.clock.settle()
    const r = await w.call($, { tool: 'Edit', file_path: 'C:/src/proj/lib/shared.mjs', old_string: 'a', new_string: 'b' })
    await w.call($, { tool: 'Edit', file_path: 'C:/src/proj/lib/shared.mjs', old_string: 'b', new_string: 'c' })
    const told = w.told.filter((m: any) => String(m.content[0].text).startsWith('AskerDo')).map((m: any) => m.content[0].text)
    expect(told.length).toBe(1)
    expect([r.context.includes(told[0]), [1, 2, 3, 4, 5].every((n) => told[0].includes('K-3' + n + ' Band ruling ' + n))]).toEqual([true, true])
    expect(told[0]).not.toContain('every release commit')
    await w.clock.advance(8000)
    await w.clock.settle()
    const raised = w.toasts.filter((t: string) => t.includes('K-3') || t.includes('lib/shared.mjs'))
    expect(raised.length).toBe(1)
    expect(raised[0]).toContain('5 decisions')
  })

  /* a glob marked (read) points at a read of its file once in the session; another read draws nothing */
  test('a read of a file a record marks for reads carries the pointer once; another read carries none', async ($: any, on: any) => {
    const w = procWorld(on)
    w.rulings = [{ ...FACT, id: 'K-21', name: 'Read the codebase index first', files: ['(read) docs/index.md'] }]
    on('tool.call', { tool: 'Read' }, () => ({ result: 'read' }))
    await start($, w)
    await w.call($, { tool: 'Read', file_path: 'C:/src/proj/docs/other.md' })
    await w.clock.settle()
    expect((await w.call($, { tool: 'Read', file_path: 'C:/src/proj/src/app.ts' })).result).toBe('read')
    expect(facts(w)).toEqual([])
    const r = await w.call($, { tool: 'Read', file_path: 'C:/src/proj/docs/index.md' })
    await w.call($, { tool: 'Read', file_path: 'C:/src/proj/docs/index.md' })
    expect(facts(w).length).toBe(1)
    expect([facts(w)[0].includes('K-21'), r.context.includes(facts(w)[0])]).toEqual([true, true])
  })

  test('with pointers.knowledge off, a knowledge record points at nothing and a decision still does', async ($: any, on: any) => {
    const w = procWorld(on)
    w.rulings = [RULING, FACT]
    w.rules = { record: 'proj', inject: true, revision: 'r1', text: 'Rules in force (AskerDo rev r1, for proj):', values: { 'pointers.knowledge': false } }
    await start($, w)
    await w.call($, { tool: 'Edit', file_path: 'C:/src/proj/src/app.ts', old_string: 'a', new_string: 'b' })
    await w.clock.settle()
    await w.call($, { tool: 'Edit', file_path: 'C:/src/proj/src/db/schema.ts', old_string: 'a', new_string: 'b' })
    await w.clock.advance(8000)
    await w.clock.settle()
    expect(facts(w)).toEqual([])
    expect(w.toasts.some((t: string) => t.includes('K-20'))).toBe(false)
    await w.call($, { tool: 'Bash', command: 'git commit -m "release: 1"' })
    expect(w.told.some((m: any) => String(m.content[0].text).startsWith('AskerDo decision pointer'))).toBe(true)
  })

  test('a command outside every covered repo and an unrelated command point at nothing', async ($: any, on: any) => {
    const w = procWorld(on)
    w.cwd = 'C:/src/elsewhere'
    await start($, w)
    await w.call($, { tool: 'Bash', command: 'git commit -m "release: 1"' })
    await w.call($, { tool: 'Bash', command: 'ls' })
    expect(pointers(w)).toEqual([])
    expect(w.toasts.filter((t: string) => t.startsWith('Procedure '))).toEqual([])
  })

  test('a CLI that cannot read the cards leaves every call alone', async ($: any, on: any) => {
    const w = procWorld(on)
    w.fail.proc = 'the store lock is held'
    const base = w.cli
    w.cli = (args: string[], stdin?: string) => (args[0] === 'proc' ? { exitCode: 2, stdout: '', stderr: 'AskerDo: locked\n' } : base(args, stdin))
    await start($, w)
    expect((await w.call($, { tool: 'Bash', command: 'git commit -m "release: 1"' })).result).toBe('ran')
    expect(pointers(w)).toEqual([])
  })
})

describe('/askerdo proc', () => {
  const run = ($: any, args: string) => $.command.run({ command: 'askerdo', args }).then((r: any) => r.text)

  test('words find a procedure, with its badge and file', async ($: any, on: any) => {
    const w = procWorld(on)
    await start($, w)
    const text = await run($, 'proc release')
    expect(text).toContain('PR-2 release [fresh]: Cut an AskerDo release')
    expect(text).toContain('C:/src/proj/docs/procedures/release.md')
    expect(w.last('proc find').args).toEqual(['proc', 'find', 'release', '--project', 'C:/src/proj', '--json'])
  })

  test('ran records a clean run, and a deviated one carries its note and its outcome', async ($: any, on: any) => {
    const w = procWorld(on)
    await start($, w)
    expect(await run($, 'proc ran release clean')).toContain('Recorded a clean run of PR-2 release (3 runs, 3 clean in a row).')
    const text = await run($, 'proc ran release deviated "the tray step was skipped" --one-off "no tray change"')
    expect(text).toContain('no tray change')
    const args = w.last('proc ran').args
    expect(args.slice(0, 4)).toEqual(['proc', 'ran', 'release', 'deviated'])
    expect(args[args.indexOf('--note') + 1]).toBe('the tray step was skipped')
    expect(args[args.indexOf('--one-off') + 1]).toBe('no tray change')
    expect(args[args.indexOf('--session') + 1]).toBe('sess-1')
    expect(await run($, 'proc ran release deviated')).toContain('A deviated run needs a note')
  })

  test('scan reads the project', async ($: any, on: any) => {
    const w = procWorld(on)
    await start($, w)
    expect(await run($, 'proc scan')).toContain('Procedures of C:/src/proj: updated PR-2; unchanged PR-3.')
  })
})

describe('the testing check on a dispatch', () => {
  test('with rules in force, a brief that runs tests without the rule is flagged, not blocked', async ($: any, on: any) => {
    const w = world(on)
    w.contract = { section: 'The mod section.', checks: { emdash: true } }
    w.rules = { record: 'TR-3', inject: true, revision: 'r1', text: 'Rules in force (AskerDo rev r1, for TR-3):\n- Few tests. [built in]', values: { 'tests.policy': 'few' } }
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
    await start($, w)
    const r = await w.call($, { tool: 'Agent', description: 'the fixer', model: 'opus',
      prompt: 'Keep docs/state/fix-state.md current. Fix the band and run the tests. Final response under 2000 characters.' })
    expect(r.result).toBe('spawned')
    expect(w.logs.at(-1)).toContain('the brief runs tests without the testing rule')
    await w.call($, { tool: 'Agent', description: 'the second', model: 'opus',
      prompt: 'Keep docs/state/b-state.md current. Run only the test files you touch, one full run at the end. Final response under 2000 characters.' })
    expect(w.logs.filter((l: string) => l.includes('the second'))).toEqual([])
  })

  test('a dispatch tells each ruling once: in the task block, or in the decisions block on a board without blocks', async ($: any, on: any) => {
    const w = procWorld(on)
    w.rulings = [RULING]
    let blocks = true
    const base = w.cli
    w.cli = (args: string[], stdin?: string) => {
      const json = (v: any) => ({ exitCode: 0, stdout: JSON.stringify(v) + '\n', stderr: '' })
      if (args[0] === 'decisions' && args[1] === '--task') return json([RULING])
      if (args[0] === 'task' && args[1] === 'block') {
        /* a review's block also tells its covered tasks' rulings, which count as read too */
        return blocks ? json({ id: args[2], decisions: [{ id: 'K-12', name: RULING.name, words: RULING.words }],
          covers: { listed: true, tasks: [{ id: 'T-6', name: 'Cut the tray', decisions: [{ id: 'K-13', name: 'The tray ships alone' }] }] }, text:'Task ' + args[2] + ' Cut it (open)\nDecisions in force (hold to them):\n- K-12 ' + RULING.name })
          : { exitCode: 1, stdout: '', stderr: 'AskerDo: the board has no verb named taskBlock\n' }
      }
      return base(args, stdin)
    }
    const spawned: string[] = []
    on('agent.spawn', ($: any, e: any) => { spawned.push(e.prompt); return { model: 'opus', agentId: 'a' + spawned.length } })
    await start($, w)
    await $.agent.spawn({ prompt: 'T-5: cut the release.', description: 'releaser' })
    expect(spawned[0].split('K-12').length - 1).toBe(1)
    expect(spawned[0]).toContain('Task T-5 Cut it')
    expect(w.cliRuns().filter((x: any) => x.args[0] === 'decisions' && x.args[1] === '--task').length).toBe(0)
    await w.clock.settle()
    expect(w.last('read').args.slice(1, 3)).toEqual(['K-12', 'K-13'])
    blocks = false
    await $.agent.spawn({ prompt: 'T-5: cut it again.', description: 'again' })
    expect(spawned[1].split('K-12').length - 1).toBe(1)
    expect(spawned[1]).not.toContain('Task T-5 Cut it')
  })
})
