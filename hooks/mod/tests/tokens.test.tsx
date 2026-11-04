/* Answer tokens on keys: a typed token answers the label's live holder
 * by its key, and when this session was told that label as another record the
 * mod asks first; the same token typed again answers the live holder. */
import { describe, expect, test } from 'claude-code/testing'
import { start, world } from './world.ts'

const run = ($: any, args = '') => $.command.run({ command: 'askerdo', args }).then((r: any) => r.text)

function keyed(on: any, told: Record<string, any> = {}) {
  const w = world(on, { store: { told } })
  w.questions[0].key = 'k7m2q9xa'
  return w
}

describe('a typed token resolves to the live holder', () => {
  test('no clash: the answer goes by key and the echo names the label and the name', async ($: any, on: any) => {
    const w = keyed(on, { u1: { id: 'Q106', key: 'k7m2q9xa', name: 'store shape', session: 'sess-1' } })
    await start($, w)
    expect(await run($, '106b')).toContain('Answered Q106 (store shape): 106b.')
    expect(w.last('answer').args).toEqual(['answer', 'k7m2q9xa', '--pick', 'b', '--user', 'sess-1', '--json'])
  })

  test('told as another record: asks, then the same token again answers the live holder', async ($: any, on: any) => {
    const w = keyed(on, { u1: { id: 'Q106', key: 'zzzzzzzz', name: 'tray spacing', session: 'sess-1' } })
    await start($, w)
    const asked = await run($, '106b')
    expect(asked).toContain('Not answered yet: this session was told Q106 (tray spacing), but Q106 is now (store shape). '
      + 'Type 106b again to answer Q106 (store shape).')
    expect(w.last('answer')).toBeUndefined()
    expect(await run($, '106b')).toContain('Answered Q106 (store shape): 106b.')
    expect(w.last('answer').args[1]).toBe('k7m2q9xa')
  })

  test('a question told in another session is no clash', async ($: any, on: any) => {
    const w = keyed(on, { u1: { id: 'Q106', key: 'zzzzzzzz', name: 'tray spacing', session: 'other-sess' } })
    await start($, w)
    expect(await run($, '106b')).toContain('Answered Q106 (store shape): 106b.')
  })
})
