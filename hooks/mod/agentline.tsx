/* A pane or band piece that turns over by itself: the app draws a pane's or band's whole tree again
   on every redraw, which drops the hover under the pointer, so a running agent's line, its depth bar
   and the agents' count are asked for here each second (the mod answers with the props, no draw) */
/* the table has no Svg, but the environment's h builds one, and the desktop page draws it in a Client */
const Svg: any = 'Svg'

const ink = (o: any): any => {
  const out: any = {}
  if (o && typeof o.color === 'string') out.color = o.color
  if (o && o.dimColor === true) out.dimColor = true
  return out
}

/* the pieces share this module's scope on the drawing thread. Each answer names the piece's drawing
   (g); once named, the first live piece of a drawing asks for all of them, once a second, and leaves the one
   answer here. One not named yet, or left alone, asks for itself. A piece whose timer stopped (unmounted)
   drops out past BEAT_MS */
const pieces = new Set<any>()
/* the engine tells no piece of an unmount, and a dead piece looks like a live one not yet ticked
   this second until a mate's second tick: 1.5 s drops it there, half a second clear of a live asker's
   jitter; a later asker only hands the role over, the mate that drops it asking in its place */
const BEAT_MS = 1500
/* one ask a second per piece, held by construction; 100 ms under the second for a tick's jitter */
const ASK_GAP_MS = 900
/* the desktop counts a render against the piece whose state was set and clears that count only on the
   piece's own tick, pointer, key, press or props, so a piece sets only its own state, on its own tick. Its
   bookkeeping lives here, not in its state, so no set loses its timer's handle */
const recs = new WeakMap<any, any>()
/* an answer sets nothing where it lands; every piece of a drawing, the asker too, takes on its own
   tick the newest that landed HOLD_MS before the edge of the wall second the tick sits nearest, so every piece
   ticking in one second takes the same one, whatever landed between their ticks */
const HOLD_MS = 300
const KEEP = 3
const answers = new Map<string, any[]>()
function landed(list: any[], a: any): void {
  list.push(a)
  if (list.length > KEEP) list.shift()
}
/* the nearest edge of the mod's wall second, as its newest answer's phase places it */
function edgeOf(now: number, list: any[] | undefined): number {
  const ref = list && [...list].reverse().find((a) => typeof a.phase === 'number')
  const off = ref ? ref.at - ref.phase : 0
  return now - ((((now - off + 500) % 1000) + 1000) % 1000) + 500
}
function ripe(list: any[] | undefined, edge: number, k: string): any {
  if (!list) return undefined
  for (let i = list.length - 1; i >= 0; i--) if (list[i].at < edge - HOLD_MS && list[i].rows[k]) return list[i]
  return undefined
}

/* each piece's last state sets, what caused each and the ms since its own last render and tick,
   ride the asks already sent, so the mod's fault row names the path of a render loop fault */
const RING = 6
const sets = new WeakMap<any, any[]>()
const drawnAt = new WeakMap<any, number>()
function noted(o: any, cause: string): void {
  const now = Date.now()
  const r = sets.get(o) || []
  const rec = recs.get(o)
  r.push([cause, now - (drawnAt.get(o) || now), now - ((rec && rec.beat) || now)])
  if (r.length > RING) r.shift()
  sets.set(o, r)
}
function ringsOf(list: any[]): any {
  const out: any = {}
  for (const o of list) { const r = sets.get(o), k = recs.get(o)?.k; if (r && typeof k === 'string') out[k] = r }
  return out
}
/* each piece's key, drawing and last sets, for the kit's case, which drives this module on the desktop's rule */
export function liveBook(): any {
  return { pieces: [...pieces].map((o) => ({ k: recs.get(o)?.k, g: recs.get(o)?.g, ring: sets.get(o) || [] })) }
}

/* the piece's timer moved ms on, then once a second; its handle kept here */
function step(surface: any, s: any, ms: number): void {
  s.stop()
  /* a step moves the ask onto the wall second on purpose, so its first tick may ask inside ASK_GAP_MS */
  s.asked = undefined
  const first = surface.every(ms, () => {
    first()
    tick(surface)
    s.stop = surface.every(1000, () => tick(surface))
  })
  s.stop = first
}

function tick(surface: any): void {
  const s = recs.get(surface)
  if (!s) return
  const now = Date.now()
  s.beat = now
  /* a stall past BEAT_MS (every timer late at once) may have dropped a live piece: its own tick puts it back, last */
  pieces.add(surface)
  const list = s.g ? answers.get(s.g) : undefined
  /* the newest answer before this second, the drawing's or its own, unless props the mod drew came after it */
  const edge = edgeOf(now, list && list.length ? list : s.own)
  const a = [ripe(list, edge, s.k), ripe(s.own, edge, s.k)].filter(Boolean).sort((x, y) => y.at - x.at)[0]
  if (a && a !== s.taken && s.k && a.rows[s.k] && !(s.propsAt > a.at)) {
    s.taken = a
    s.live = a.rows[s.k]
    s.liveFor = s.props
    noted(surface, 'tick')
    surface.setState({ n: ((surface.state && surface.state.n) || 0) + 1 })
  }
  /* a piece another asks for keeps its tick on that asker's wall second */
  const c = list && list[list.length - 1]
  if (c && c.from !== surface && c !== s.stepped && typeof c.phase === 'number') {
    s.stepped = c
    const w = (c.phase + now - c.at) % 1000
    if (w > 100 && w < 1000) step(surface, s, 1000 - w)
  }
  /* a frame clock catching up after a stall fires the timer twice back to back: one ask */
  const soon = s.asked !== undefined && now - s.asked < ASK_GAP_MS
  if (!s.g || !s.k) {
    if (soon) return
    s.asked = now
    return surface.post({ line: true, sets: ringsOf([surface]) })
  }
  const mates: any[] = []
  for (const o of pieces) {
    const os = recs.get(o)
    if (!os || now - (os.beat || 0) > BEAT_MS) { if (o !== surface) pieces.delete(o); continue }
    if (os.g === s.g && os.k) mates.push(o)
  }
  if (mates[0] !== surface || soon) return
  s.asked = now
  surface.post({ line: true, keys: mates.map((o) => recs.get(o).k), sets: ringsOf(mates) })
}

/* an answer to this piece's ask, kept for the ticks: its drawing named, the rows (its own, when it asked alone)
   left here. The ask goes on the mod's one wall second; the answer says how far past that second it came
   (phase, ms), and an ask more than a tenth late steps onto the next */
function heard(p: any, surface: any, s: any): void {
  if (p === s.handled) return
  s.handled = p
  s.g = p.g
  const phase = typeof p.phase === 'number' ? p.phase : undefined
  const rows = p.rows && typeof p.rows === 'object' ? p.rows : !p.keep && s.k ? { [s.k]: p } : null
  if (rows) {
    const a = { rows, at: Date.now(), phase, from: surface }
    if (p.rows) {
      const list = answers.get(p.g) || []
      answers.delete(p.g)
      answers.set(p.g, list)
      if (answers.size > 50) answers.delete(answers.keys().next().value as string)
      landed(list, a)
    } else landed(s.own || (s.own = []), a)
  }
  if (phase !== undefined && phase > 100 && phase < 1000) step(surface, s, 1000 - phase)
}

const LiveLine = (props: any, surface: any): any => {
  let p = props || {}
  let s = recs.get(surface)
  if (!s) {
    s = { beat: Date.now() }
    recs.set(surface, s)
    s.stop = surface.every(1000, () => tick(surface))
    pieces.add(surface)
  }
  if (typeof p.k === 'string') s.k = p.k
  /* an answer draws what the piece showed; props the mod drew show at once */
  if (typeof p.g === 'string') heard(p, surface, s)
  else if (props !== s.props) {
    s.props = props
    s.propsAt = Date.now()
  }
  p = s.live && s.liveFor === s.props ? s.live : s.props || {}
  drawnAt.set(surface, Date.now())
  const { Box, Text } = surface.elements
  const wrap = p.wrap === 'truncate-end' ? 'truncate-end' : p.wrap === 'wrap' ? 'wrap' : undefined
  /* words in parts, each its own color: the agents' count beside its icon, the card's count line */
  if (Array.isArray(p.parts)) {
    const parts = p.parts.map((x: any) => (x && typeof x === 'object' ? (x.color ? <Text color={String(x.color)}>{String(x.text || '')}</Text> : String(x.text || '')) : String(x)))
    return <Text {...(p.tabular ? { tabular: true } : {})} {...ink(p)} {...(wrap ? { wrap } : {})}>{parts}</Text>
  }
  const line = <Text dimColor wrap={wrap || 'wrap'}>{String(p.text || '')}</Text>
  const b = p.bar
  const bar = b && b.pic && b.pic.source ? <Box flexShrink={0}><Svg source={String(b.pic.source)} alt={String(b.pic.alt || 'Depth bar')} width={b.pic.width} height={b.pic.height} /></Box>
    : b && b.glyph ? <Box flexShrink={0}><Text {...ink(b.ink)}>{String(b.glyph)}</Text></Box> : null
  /* an agent's row: the bar beside its job and line */
  if (typeof p.job === 'string') {
    /* the detail, which ticks, holds the rows its width gave it; the job, which never ticks,
       takes the lines it draws in, so a job measured a line longer than it draws leaves no blank line */
    const held = Number(p.rows) > 0 ? <Box height={Number(p.rows)} overflow="hidden">{line}</Box> : line
    return (
      <Box flexDirection="row" columnGap={1}>
        {bar}
        <Box flexDirection="column" flexShrink={1}>
          <Text weight="semibold" wrap="wrap">{p.job}</Text>
          {held}
        </Box>
      </Box>
    )
  }
  if (!bar) return line
  /* Home's shut heading: the deepest agent's bar, then the line, cut at the row's end */
  return (
    <Box flexDirection="row" columnGap={Number(b.gap) || 1} alignItems="center">
      {bar}
      <Box flexShrink={1} minWidth={0}>{line}</Box>
    </Box>
  )
}
export default LiveLine
