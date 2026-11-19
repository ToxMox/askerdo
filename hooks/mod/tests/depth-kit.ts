/* The depth tests' shared kit: the world with the engine's hint stood in, the status line's mount, the
 * measure and step feeds, the live pieces' readers and the desktop page's host for them. */
import { world as base } from './world.ts'
import LiveLine from '../agentline.tsx'

export const PLUGIN = 'askerdo'
export const SURFACES = ['terminal', 'desktop'] as const
export const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
/* the engine's own hint under the status line, as status.test.tsx stands it in */
export function world(on: any, opts?: Parameters<typeof base>[1]) {
  const w = base(on, opts)
  w.hints = 0
  on('ui.render', { component: 'PromptHint' }, () => { w.hints++; return { type: 'Box', props: { key: 'engine-hint' }, children: [] } })
  return w
}
export const BAND = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} }
/* the status line is the hint line's on the terminal and the band's last row on the desktop */
export const mount = ($: any, surface: string) => surface === 'desktop'
  ? $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
  : $.ui.mount({ plugin: PLUGIN, surface, component: 'PromptHint', props: HINT })
export const WINDOW = 1000000
export const measure = async ($: any, w: any, percent: number | undefined) => {
  const context: any = { window: WINDOW }
  if (percent !== undefined) { context.percent = percent; context.tokens = Math.round(percent * WINDOW / 100) }
  await $.session.measure({ context, rateLimits: [], changed: ['context'] })
  /* a figure draws at the gate's next release */
  await w.clock.advance(1000)
  await w.clock.settle()
  /* a note rides the loop's next call */
  await w.step($)
}
/* the status line's context meter, its percent and tone; the shield's card */
export const TONE = (p: any) => p.color || (p.dimColor ? 'dim' : 'bright')
export const meter = async (ui: any) => {
  const t = await ui.find({ type: 'Text', text: / C \d+%$/ })
  if (t) return [t.text.split(' ').pop(), TONE(t.props)]
  /* the desktop's number beside its ring */
  const d = (await ui.find({ key: 'status-context' }))?.children.find((c: any) => c.type === 'Text')
  return d ? [d.children.join(''), TONE(d.props)] : undefined
}
/* an agent line's count of calls, whatever words follow the number */
export const CALLS = (n: number) => new RegExp(String.raw`\b${n} [a-z ]*calls?\b`)
/* what a live piece (a Client keyed `key`) draws, its words and its bar's picture: Home's running agents turn over in place */
export const live = async (pane: any, key: string) => (await pane.find({ in: key }))?.text
export const bar = async (ui: any, key: string) => (await ui.find({ type: 'Svg', in: key }))?.props.source
/* the live pieces hold an answer by the wall clock, which the kit's frame clock does not move: each step moves
   both 100 ms, up to three seconds, until a read gives what ok wants, and that read is handed back */
export async function wallSteps(drawings: any[], read: () => Promise<any[]>, ok: (got: any[]) => boolean): Promise<any[]> {
  let got = await read()
  for (let i = 0; i < 30 && !ok(got); i++) {
    await new Promise((r) => setTimeout(r, 100))
    for (const d of drawings) await d.advance(100)
    got = await read()
  }
  return got
}
/* the shield's segment with its hover card, either surface (a title, the state, the press) */
export const guardTip = async (ui: any) => (await ui.find({ key: 'status-guard' }))?.text
export const notes = (w: any) => w.told.filter((m: any) => !m.agentId).map((m: any) => m.content[0].text)
/* an agent's notes once its next call has carried them */
export const agentNotes = async ($: any, w: any, id: string) => {
  await w.step($, id)
  return w.told.filter((m: any) => m.agentId === id).map((m: any) => m.content[0].text)
}
export const usage = (tokens: number) => ({ input_tokens: 1000, cache_read_input_tokens: tokens - 3000, cache_creation_input_tokens: 2000, output_tokens: 10 })

export async function step($: any, w: any, agentId: string | undefined, tokens: number) {
  w.stepUsage[agentId || 'main'] = usage(tokens)
  const s = $.turn.step({ turnId: 't-' + (agentId || 'main'), index: 0, model: 'm', messageCount: 3, ...(agentId ? { agentId } : {}) })
  for await (const _ of s) { /* drained */ }
  await s.result
  await w.clock.settle()
  if (!agentId) await w.step($)
}

/* the desktop page's host for live pieces as its code reads, one count per instance: a render after a set
   adds one, the instance's own timer fire or props that differ clear it, and a set at three faults. The mod's answer
   is stood in for (each piece's row turns over each second, phase from a wall second 300 ms off the clock), and the
   module's clock is the host's. turns: when each piece first drew each second's answer. opt: a start time, a
   drawing name, when the first piece unmounts and a stall ([at, ms]) the clock catches up on, firing each timer due in it
   at its end; drawn: the drawing's asks, apart from pieces asking alone */
export function deskHost(list: any[], until: number, opt: { from?: number; g?: string; gone?: number; stall?: [number, number] } = {}) {
  let now = opt.from || 0, ctx: any = null
  until += now
  const wall = globalThis.Date
  const Clock: any = class extends wall { static now() { return 1e12 + now } }
  globalThis.Date = Clock
  const out = { asks: [] as number[], drawn: [] as number[], turns: [] as { k: string; n: number; at: number }[], sets: [] as { k: string; at: number; own: boolean }[], faults: [] as string[], running: [] as number[], asker: '' }
  const events: { at: number; fn: () => void; on: boolean; i?: any; ms?: number }[] = []
  const due = new Set<any>()
  const flush = () => { while (due.size) for (const i of [...due]) { due.delete(i); i.T++; i.draw() } }
  const row = (k: string) => ({ text: k + ' at ' + Math.floor(now / 1000), wrap: 'wrap' })
  const give = (i: any, p: any) => { if (i.gone || JSON.stringify(p) === JSON.stringify(i.props)) return; i.T = 0; i.props = p; ctx = { i, by: 'props' }; i.draw(); ctx = null }
  const pieces = list.map((first) => {
    const i: any = { props: first, T: 0, k: first.k, state: undefined }
    i.draw = () => {
      const n = /at (\d+)/.exec(JSON.stringify(LiveLine(i.props, i.s)))
      if (n && Number(n[1]) !== i.n) { i.n = Number(n[1]); out.turns.push({ k: i.k, n: i.n, at: now }) }
    }
    i.s = {
      elements: { Box: 'Box', Text: 'Text' }, columns: 40, rows: 1,
      get state() { return i.state },
      setState: (v: any) => { if (i.T >= 3) out.faults.push(i.k); out.sets.push({ k: i.k, at: now, own: !!ctx && ctx.i === i }); i.state = v; due.add(i) },
      every: (ms: number, fn: () => void) => { const t = { at: now + ms, ms, fn, on: true, i }; events.push(t); return () => { t.on = false } },
      onPointer: () => () => {}, onKey: () => () => {},
      post: (d: any) => {
        out.asks.push(now)
        if (Array.isArray(d.keys)) { out.asker = i.k; out.drawn.push(now) }
        events.push({ at: now + 5, on: true, fn: () => {
          const rows: any = {}
          for (const k of d.keys || []) rows[k] = row(k)
          give(i, { ...row(i.k), g: opt.g || 'desk', ...(d.keys ? { rows } : {}), phase: (now + 700) % 1000 })
        } })
      },
    }
    ctx = { i: null, by: 'mount' }
    i.draw()
    ctx = null
    return i
  })
  flush()
  /* an unmount stops the piece's timers; the engine tells the module nothing */
  if (opt.gone) events.push({ at: now + opt.gone, on: true, fn: () => { pieces[0].gone = true; for (const e of events) if (e.i === pieces[0]) e.on = false } })
  for (;;) {
    const next = events.filter((e) => e.on && e.at <= until).sort((a, b) => a.at - b.at)[0]
    if (!next) break
    const [sAt, sMs] = opt.stall ? [opt.stall[0] + (opt.from || 0), opt.stall[1]] : [0, 0]
    now = next.at > sAt && next.at < sAt + sMs ? sAt + sMs : next.at
    if (next.i) { next.i.T = 0; next.at += next.ms!; ctx = { i: next.i, by: 'tick' } } else next.on = false
    next.fn()
    ctx = null
    flush()
  }
  out.running = pieces.map((i) => events.filter((e) => e.i === i && e.on).length)
  globalThis.Date = wall
  return out
}

export function guardOn(w: any, extra: any = {}) {
  w.guard = { on: true, source: 'project', guard: { soft: 350000, hard: 450000, remind: 25000, ...extra } }
}
