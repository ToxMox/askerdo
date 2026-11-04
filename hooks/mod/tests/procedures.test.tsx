/* Procedure pointers under `claude plugin test`: the tool-call watcher
 * points the model at a procedure's file (a note and a toast, never a block),
 * `/askerdo proc` finds and records runs, and the Agent check names the testing
 * rule when the `agents` option is on. */
import { describe, expect, test } from 'claude-code/testing'
import { start, world } from './world.ts'

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
  commands: ['node --test'], files: [], stale: ['changed since a2a2042: test/ (2 commits)'], badge: 'stale',
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
        ...(deviated ? { draft: 'Draft edit for docs/procedures/release.md: make the steps say what this run did.' } : {}) })
    }
    return { exitCode: 1, stdout: '', stderr: 'AskerDo: unknown proc verb\n' }
  }
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited' }))
  return w
}

const pointers = (w: any, agentId?: string) => w.appends.filter((m: any) => m.agentId === agentId
  && String(m.content[0].text).startsWith('AskerDo procedure pointer')).map((m: any) => m.content[0].text)

describe('the procedure watcher', () => {
  test('a matching command runs, and the model is pointed at the file once with a toast', async ($: any, on: any) => {
    const w = procWorld(on)
    w.rulings = [RULING]
    /* the scan starts with the session; a call before it lands goes on without a card */
    let release: any
    w.hold = { verb: 'proc triggers', until: new Promise((r) => { release = r }) }
    await start($, w)
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m "release: 0.5.34"' })).result).toBe('ran')
    expect(pointers(w).length).toBe(0)
    release()
    await w.clock.settle()
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m "release: 0.5.35" -- CHANGELOG.md' })
    expect(r.result).toBe('ran')
    const notes = pointers(w)
    expect(notes.length).toBe(1)
    expect(notes[0]).toContain('procedure PR-2 Cut an AskerDo release')
    expect(notes[0]).toContain('C:/src/proj/docs/procedures/release.md')
    expect(notes[0]).toContain('askerdo proc ran release clean')
    /* the decision's toast raised first; the procedure's shows once it ends */
    await w.clock.advance(8000)
    await w.clock.settle()
    expect(w.toasts.at(-1)).toContain('PR-2')
    /* the first read scans this project; the next calls read the cache */
    expect(w.last('proc triggers').args).toContain('--project')
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "release: 0.5.35"' })
    expect(pointers(w).length).toBe(1)
    expect(w.cliRuns().filter((x: any) => x.args[0] === 'proc').length).toBe(1)
    /* the decision the commit touches is pointed at once in the loop, in one line with the user's words */
    const ruled = w.appends.filter((m: any) => !m.agentId && String(m.content[0].text).startsWith('AskerDo decision pointer')).map((m: any) => m.content[0].text)
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
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "release: 1"' })
    expect(pointers(w).length).toBe(1)
    w.cards = []
    w.marker = '2026-10#9'
    await w.clock.advance(15000)
    await w.clock.settle()
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "release: 2"', agentId: 'ag-2' })
    expect(pointers(w, 'ag-2').length).toBe(1)
    const reads = w.cliRuns().filter((x: any) => x.args[0] === 'proc' && x.args[1] === 'triggers')
    expect(reads.length).toBe(2)
    expect(reads[1].args).toEqual(['proc', 'triggers', '--project', 'C:/src/proj', '--json', '--no-scan'])
    await w.clock.settle()
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "release: 3"', agentId: 'ag-3' })
    expect(pointers(w, 'ag-3')).toEqual([])
  })

  test('a stale card says so in the pointer, and an agent gets its own', async ($: any, on: any) => {
    const w = procWorld(on)
    await start($, w)
    await $.tool.call({ tool: 'Bash', command: 'node --test test/a.test.mjs', agentId: 'ag-1' })
    const notes = pointers(w, 'ag-1')
    expect(notes.length).toBe(1)
    expect(notes[0]).toContain('The card is stale (changed since a2a2042: test/ (2 commits))')
    expect(pointers(w).length).toBe(0)
  })

  test('an edit matches a file glob, with its contains text, in this repo or a covered one', async ($: any, on: any) => {
    const w = procWorld(on)
    await start($, w)
    const r = await $.tool.call({ tool: 'Edit', file_path: 'C:/src/proj/src/App.csproj', old_string: 'a', new_string: 'b' })
    expect(r.result).toBe('edited')
    expect(pointers(w).length).toBe(0)
    await $.tool.call({ tool: 'Edit', file_path: 'C:\\src\\site\\public\\index.html', old_string: 'a', new_string: 'b' })
    expect(pointers(w)[0]).toContain('the edit of public/index.html matches site:public/*.html')
  })

  test('a command outside every covered repo and an unrelated command point at nothing', async ($: any, on: any) => {
    const w = procWorld(on)
    w.cwd = 'C:/src/elsewhere'
    await start($, w)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "release: 1"' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(pointers(w)).toEqual([])
    expect(w.toasts.filter((t: string) => t.startsWith('Procedure '))).toEqual([])
  })

  test('a CLI that cannot read the cards leaves every call alone', async ($: any, on: any) => {
    const w = procWorld(on)
    w.fail.proc = 'the store lock is held'
    const base = w.cli
    w.cli = (args: string[], stdin?: string) => (args[0] === 'proc' ? { exitCode: 2, stdout: '', stderr: 'AskerDo: locked\n' } : base(args, stdin))
    await start($, w)
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m "release: 1"' })).result).toBe('ran')
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

  test('ran records a clean run, and a deviated one carries its note and drafts the edit', async ($: any, on: any) => {
    const w = procWorld(on)
    await start($, w)
    expect(await run($, 'proc ran release clean')).toContain('Recorded a clean run of PR-2 release (3 runs, 3 clean in a row).')
    const text = await run($, 'proc ran release deviated "the tray step was skipped"')
    expect(text).toContain('Draft edit for docs/procedures/release.md')
    const args = w.last('proc ran').args
    expect(args.slice(0, 4)).toEqual(['proc', 'ran', 'release', 'deviated'])
    expect(args[args.indexOf('--note') + 1]).toBe('the tray step was skipped')
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
    const r = await $.tool.call({ tool: 'Agent', description: 'the fixer', model: 'opus',
      prompt: 'Keep docs/state/fix-state.md current. Fix the band and run the tests. Final response under 2000 characters.' })
    expect(r.result).toBe('spawned')
    expect(w.logs.at(-1)).toContain('the brief runs tests without the testing rule')
    await $.tool.call({ tool: 'Agent', description: 'the second', model: 'opus',
      prompt: 'Keep docs/state/b-state.md current. Run only the test files you touch, one full run at the end. Final response under 2000 characters.' })
    expect(w.logs.filter((l: string) => l.includes('the second'))).toEqual([])
  })
})
