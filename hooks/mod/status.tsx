/* The status line under the prompt: the
 * three context meters, the guard, the held track and the shelf, one glyph each, its words in a hover card;
 * the app's own hint stays beside them. On the desktop the same segments are the band's
 * last row, drawn as pictures, opened by the
 * AskerDo mark. Drawn from the model alone (statusModel); index.ts owns the reads. */
import { cardText, cellWidth, chipGroups, chipHeader, rowParts, rowsText, statusPicture } from '../../lib/mod-core.mjs'

type CardPart = { text: string; tone?: string; pic?: any; href?: string; weight?: string }
/* an agent's row in its card, its depth bar drawn on the desktop */
type CardRow = { id: string; job: string; detail: string; tone: string; done?: boolean; meter?: any }
export type StatusSegment = {
  key: string; text: string; tone: string; tip: string; press?: string; href?: string; pic?: any; empty?: boolean
  card?: { title: string; parts: CardPart[]; press?: string; rows?: CardRow[]; head?: CardHead; groups?: CardFact[][]; where?: CardFact[] | null; questions?: any[]; here?: any; foot?: string }
}
/* a tooltip's head and its groups of facts, each led by a picture */
type CardHead = { icon: string; title: string; state?: { text: string; tone?: string } | null }
type CardFact = { lead: any; lines: CardPart[][] }
/* surface 'desktop' with a null hint: drawn as the band's row. Shelf, the count's
   press (the pane on Tracks); home, the AskerDo press (the pane on Home): the mark on the
   desktop, a word at the line's end on the terminal; wrap, the pane's copy: two groups when it
   fits the columns, else one wrapping group;
   cards false: no hover cards (the dock pane does not lift them, so they would draw empty) */
export type StatusOpts = { columns?: number; guard?: () => void; surface?: string; shelf?: () => void; home?: () => void; questions?: () => void; agents?: () => void; health?: () => void; wrap?: boolean; cards?: boolean }

const OPENER = 'AskerDo'

/* a plain dark card on the terminal. A desktop lifts a band card into its own
   popover on its own background, keeping only the text color, so there both are theme
   keys it maps for either theme. */
export function cardColors(surface?: string): { bg: string; text: string } {
  return surface === 'desktop' ? { bg: 'userMessageBackground', text: 'text' } : { bg: '#24292f', text: '#afb8c1' }
}

const GAP = 3
const TONES: Record<string, any> = {
  dim: { dimColor: true }, bright: {}, warning: { color: 'warning' }, error: { color: 'error' }, success: { color: 'success' },
}
/* a picture's label: the theme's secondary words at rest, its amber and red past a line */
const LABEL: Record<string, string> = { sky: 'inactive', dim: 'inactive', amber: 'warning', red: 'error' }
/* a card number's color by its tone: the theme's blue, amber, red and green */
const INK: Record<string, string> = { sky: 'suggestion', amber: 'warning', red: 'error', green: 'success' }
/* the app's popover, at most 360 px, in cells of 8.45 px */
export const CARD_CELLS = 42
/* a picture's room between it and its label, in px */
const PIC_GAP = 4
/* the desktop row's left group, the rest pushed to the row's right end */
/* the agents segment closes the left group, so its coming and going moves nothing else */
const LEFT = new Set(['mark', 'context', 'hour', 'week', 'agents'])
/* U+2007, a digit wide */
const FIGURE = ' '

/* A segment's press: the guard's toggle, the shelf's opener, the mark's. */
function pressOf(s: StatusSegment, opts: StatusOpts): { key: string; act: () => void } | null {
  if (s.press === 'guard' && opts.guard) return { key: 'status-guard-toggle', act: opts.guard }
  if (s.press === 'shelf' && opts.shelf) return { key: 'status-shelf-open', act: opts.shelf }
  if (s.press === 'home' && opts.home) return { key: 'askerdo-open', act: opts.home }
  /* the mark's press while questions wait elsewhere: the Questions tab */
  if (s.press === 'questions' && (opts.questions || opts.home)) return { key: 'askerdo-open', act: (opts.questions || opts.home) as () => void }
  if (s.press === 'agents' && opts.agents) return { key: 'status-agents-open', act: opts.agents }
  /* the PC's problem runs or copies its fix */
  if (s.press === 'health' && opts.health) return { key: 'status-health-fix', act: opts.health }
  return null
}

/* a press that opens a page: no API opens a URL from a press, only a Link does
   (an anchor on the desktop, OSC 8 on the terminal) */
const linkKey = (s: StatusSegment) => 'status-' + s.key + '-link'

/* a blank label a fifth over the face and two cells more, so a bold or wide label and the room still sit under it */
const blank = (cells: number) => FIGURE.repeat(Math.ceil(cells * 1.2) + 2)

/* a press laid over all of the Box that holds it, cut to that Box. band: the band's 28 px
   buttons sit centered on it; elsewhere a plain one is stretched to it, so where it lights it presses */
function cover(els: any, align: string, fill: string, press: any): any {
  const { Box } = els
  return (
    <Box position="absolute" top={0} left={0} width="100%" height="100%" overflow="hidden" justifyContent={align}>
      <Box width="600%" flexShrink={0} justifyContent={align} alignItems={fill}>{press}</Box>
    </Box>
  )
}

/* As pressOver, a Link with a blank label. A truncating Text draws as an
   inline block, which the link's hover underline does not reach */
export function linkOver(els: any, key: string, cells: number, href: string): any {
  const { Link, Text } = els
  return cover(els, 'center', 'stretch', <Link key={key} href={href}><Text wrap="truncate-end">{blank(cells)}</Text></Link>)
}

/* a link drawn as words: on the desktop the words in the link's blue on the shared look */
export function wordLink(els: any, key: string, href: string, label: string, desk: boolean): any {
  const { Box, Link, Text } = els
  if (!desk) return <Box key={key} flexShrink={0}><Link href={href} label={label} /></Box>
  return pressFace(els, key, <Text color="suggestion">{label}</Text>, linkOver(els, key + '-link', cellWidth(label), href))
}

/* a blank plain Button over a face (an Svg takes no press); its figure spaces outrun the face, cut
   to it, six Boxes of room so a squeezed label ends in an ellipsis (the dot); a hotkey's cue
   draws first. It lights nothing itself: pressFace's Box or a lit tile does. band: drawn on the band. */
export function pressOver(els: any, key: string, cells: number, act: () => void, hotkey?: string, band = false): any {
  const { Button } = els
  const button = <Button key={key} plain label={blank(cells)} onPress={act} {...(hotkey ? { hotkey } : {})} hover={UNLIT} />
  return cover(els, hotkey ? 'flex-end' : 'center', band ? 'center' : 'stretch', button)
}

/* a face and its press as one, the one grey highlight: the face drawn on
   its own Box (PRESS_LIT), whose hover lights behind the icon and label, inside PRESS_RIM, which
   cuts the light to a subtle corner and gives the room back. shrink: the face may be cut. */
export function pressFace(els: any, key: string, face: any, press: any, o: { shrink?: boolean; gap?: number; chip?: { pick?: boolean; only?: boolean } } = {}): any {
  const { Box } = els
  if (o.chip) {
    /* a band chip is one Box, its own fill lit grey, 28 px on the 20 px line, the kit's corner by a border sky on the pick */
    const pad = o.chip.only ? { paddingX: CHIP_ONLY_X } : { paddingLeft: CHIP_LEFT, paddingRight: CHIP_RIGHT }
    return (
      <Box key={key} {...CHIP} borderColor={o.chip.pick ? SKY : CLEAR} {...pad} flexShrink={0}>{face}{press}</Box>
    )
  }
  const size = o.shrink ? { flexShrink: 1, minWidth: 0 } : { flexShrink: 0 }
  return (
    <Box key={key} {...PRESS_RIM} {...size}>
      <Box key={key + '-lit'} {...PRESS_LIT} {...size} {...(o.gap ? { columnGap: o.gap } : {})}>{face}{press}</Box>
    </Box>
  )
}

/* a desktop option is a faint rounded tile a few px apart, the pick's outlined in the
   accent. A live tile is one press and lights whole on hover; one gray reads on both themes */
const TILE = 'rgba(128, 128, 128, 0.08)', LIT = 'rgba(128, 128, 128, 0.16)', CLEAR = 'rgba(128, 128, 128, 0)'
/* a press under a lit face or tile keeps that light as the one hover look */
const UNLIT = { backgroundColor: CLEAR }
export const TILE_GAP = { rowGap: 0.6, marginTop: 0.4 }
/* every press's one grey highlight, half a cell past its face and 4 px up and down,
   lit behind it. A bordered Box takes the kit's padding unless told 0; the clear double border's cut is the
   kit's radius less 3 px (5 px), never a pill; the margins give room and border back, so nothing moves. */
const ROOM_X = 0.5, ROOM_Y = 0.4, RIM_Y = 0.3, RIM_X = 3 / 8.45
const back = (n: number) => -Math.round(n * 1000) / 1000
export const PRESS_RIM = { borderStyle: 'double', borderColor: CLEAR, overflow: 'hidden', padding: 0, marginX: back(ROOM_X + RIM_X), marginY: back(ROOM_Y + RIM_Y) }
export const PRESS_LIT = { paddingX: ROOM_X, paddingY: ROOM_Y, hover: { backgroundColor: LIT } }
/* the pick's outline in sky as on the band; an answered card's chosen tile takes its green */
/* lit, the tile holding an open strip keeps the hover's light */
export function tileLook(edge: boolean | string, live: boolean, lit = false): any {
  const color = typeof edge === 'string' ? edge : edge ? SKY : CLEAR
  return { borderStyle: 'round', borderColor: color, paddingY: 0.4, backgroundColor: lit ? LIT : TILE, ...(live ? { hover: { backgroundColor: LIT } } : {}) }
}
/* the pick's sky, one hex on both themes */
export const SKY = '#00AEEF'
/* a band chip's rest and lit fills; the border's 1 px and padding of 3 px make 28 px, the margins give the line back */
const CHIP_REST = 'rgba(128, 128, 128, 0.12)', CHIP_LIT = 'rgba(128, 128, 128, 0.2)'
export const CHIP = { borderStyle: 'single', backgroundColor: CHIP_REST, hover: { backgroundColor: CHIP_LIT }, paddingY: 0.3, marginY: -0.4, columnGap: 0.6 }
const CHIP_LEFT = 0.6, CHIP_RIGHT = 0.9, CHIP_ONLY_X = 0.5

/* a meta chip in the answer chip's box at its full 28 px, with no light since it takes no
   press; the terminal's its words in brackets */
export function metaChip(els: any, key: string, ch: any, surface?: string): any {
  const { Box, Text, Svg } = els
  if (surface !== 'desktop' || !Svg) return <Box key={key} flexShrink={0}><Text color={ch.accent ? 'suggestion' : undefined}>{'[' + ch.text + ']'}</Text></Box>
  const p = statusPicture({ kind: 'icon', icon: ch.icon, tone: ch.accent ? 'sky' : 'rest' })
  const { hover, marginY, ...box } = CHIP
  return (
    <Box key={key} {...box} flexDirection="row" alignItems="center" borderColor={ch.accent ? SKY : CLEAR} paddingLeft={CHIP_LEFT} paddingRight={CHIP_RIGHT} flexShrink={0}>
      <Svg source={p.source} alt={p.alt} width={p.width} height={p.height} />
      <Text color={ch.accent ? SKY : undefined}>{ch.text}</Text>
    </Box>
  )
}

/* a group's header, its chips and the track's name dim beside them or on the line under them */
export function chipHeaderTree(els: any, key: string, g: any, room: number, surface?: string): any {
  const { Box, Text } = els
  const hd = chipHeader(g, room, { surface: surface === 'desktop' && els.Svg ? 'desktop' : surface })
  const name = hd.name ? <Box key={key + '-name'} flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{hd.name}</Text></Box> : null
  if (!hd.chips.length && !name) return null
  const chips = hd.chips.map((ch: any) => metaChip(els, key + '-' + ch.kind, ch, surface))
  const row = <Box key={key + '-chips'} flexDirection="row" columnGap={1} flexShrink={0}>{chips}</Box>
  if (hd.under) return <Box key={key} flexDirection="column">{row}{name}</Box>
  return <Box key={key} flexDirection="row" columnGap={1} alignItems="center">{hd.chips.length ? row : null}{name}</Box>
}
/* Laid first in the tile, stretched over all of it; a press the tile holds (a ring, an arrow) is
   positioned and later, so it paints and takes the pointer above this one */
export function tilePress(els: any, key: string, cells: number, act: () => void): any {
  const { Box, Button } = els
  return (
    <Box position="absolute" top={0} left={0} width="100%" height="100%" overflow="hidden" alignItems="stretch">
      <Box width="600%" flexShrink={0} alignItems="stretch">
        <Button key={key} plain label={FIGURE.repeat(cells)} onPress={act} hover={UNLIT} />
      </Box>
    </Box>
  )
}

/* the desktop's face, a picture and its label, the press laid over both. Every label is real Text, so the row's words share one font and baseline;
   a label with its own tone (the sync's age, the shelf's count) takes that tone's color */
function pictureFace(els: any, s: StatusSegment, opts: StatusOpts): { face: any; head: () => any; cells: number } {
  const { Text, Svg } = els
  const label = s.pic.label as string | undefined
  const p = statusPicture(s.pic, label ? PIC_GAP : 0)
  /* the card's head sets its title one gap from the ink, so its picture leaves out the label's gap */
  const hp = label ? statusPicture(s.pic, 0) : p
  const on = pressOf(s, opts)
  const cells = Math.ceil(p.width / 8) + (label ? cellWidth(label) : 0)
  /* the pane's copy wraps; the band's row does not */
  const press = on ? pressOver(els, on.key, cells, on.act, undefined, !opts.wrap) : s.href ? linkOver(els, linkKey(s), cells, s.href) : null
  const color = s.pic.labelTone ? INK[s.pic.labelTone] : LABEL[s.pic.tone] || 'inactive'
  const face = [<Svg source={p.source} alt={p.alt} width={p.width} height={p.height} />, label ? <Text tabular color={color}>{label}</Text> : null]
  return {
    face: press ? pressFace(els, 'face-' + s.key, face, press) : face,
    head: () => <Svg source={hp.source} alt={hp.alt} width={hp.width} height={hp.height} />,
    cells,
  }
}

/* the terminal's one plain line, its press named only where one is wired. */
function tipLine(s: StatusSegment, pressed: boolean): string {
  if (!s.card) return s.tip
  const facts = s.card.groups ? cardText(s.card) : s.card.parts.map((p) => p.text).join('') + rowsText(s.card.rows)
  return s.card.title + ': ' + facts + (pressed && s.card.press ? '. ' + s.card.press : '')
}

/* a desktop card (measured: the band and the pane lift it into a popover up to 360 px
   wide, above the row unless taller than the room there; an Svg draws as a Box's child):
   the picture and a bold title, the line with its numbers in their tone's color, the press. */
function deskCard(els: any, s: StatusSegment, svg: any, pressed: boolean, cols?: number): any[] {
  const { Box, Text } = els
  const c = s.card as NonNullable<StatusSegment['card']>
  if (c.groups) return factCard(els, s, svg, pressed)
  if (c.questions) return elsewhereCard(els, s, svg, pressed, cols)
  const parts = c.parts.map((p) => (p.tone && INK[p.tone] ? <Text color={INK[p.tone]}>{p.text}</Text> : p.text))
  return [
    <Box key={'card-head-' + s.key} flexDirection="row" columnGap={1}>{svg}<Text bold>{c.title}</Text></Box>,
    <Text wrap="wrap">{parts}</Text>,
    ...(c.rows || []).map((r) => agentRow(els, r, 'card-row-')),
    pressed && c.press ? <Text dimColor wrap="wrap">{c.press}</Text> : null,
    /* the AskerDo button's folder and branch, a group under what it shows */
    c.where && c.where.length ? factGroup(els, c.where, 'card-' + s.key + '-where-', 0) : null,
  ]
}

/* the held track's and task's tooltip: the head (the icon, the bold name, the
   state in its tone), then groups half a row apart, each fact a 20 px lead picture beside its wrapped
   lines, a bar drawn inline before its words; the press line last */
function factCard(els: any, s: StatusSegment, svg: any, pressed: boolean): any[] {
  const { Box, Text } = els
  const c = s.card as NonNullable<StatusSegment['card']>
  const k = 'card-' + s.key + '-'
  /* never `h`: the JSX factory's name */
  const top = c.head as CardHead
  const st = top.state
  const head = (
    <Box key={k + 'head'} flexDirection="row" columnGap={1} alignItems="center">
      {svg}
      <Box key={k + 'title'} flexGrow={1} flexShrink={1}><Text bold wrap="wrap">{top.title}</Text></Box>
      {st ? <Box key={k + 'state'} flexShrink={0}>{factPart(els, { text: st.text, tone: st.tone })}</Box> : null}
    </Box>
  )
  const groups = (c.groups || []).map((g, gi) => factGroup(els, g, k, gi))
  return [head, ...groups, pressed && c.press ? <Text key={k + 'press'} dimColor wrap="wrap">{c.press}</Text> : null]
}

/* the mark's card while questions wait elsewhere: the head, then one group per track and PC
   (groups of one too), its chip header over rows of the marker, the bold id, the name and the age,
   no answer chips; the press line and the folder and branch last. Its room is the lifted popover's:
   at most 360 px and the window less 16 px, less its 16 px padding each side */
function elsewhereCard(els: any, s: StatusSegment, svg: any, pressed: boolean, cols?: number): any[] {
  const { Box, Text, Svg } = els
  const c = s.card as NonNullable<StatusSegment['card']>
  const k = 'card-' + s.key + '-'
  const room = Math.max(8, Math.floor(Math.min(CARD_CELLS, Number(cols) > 0 ? (cols as number) - 2 : CARD_CELLS) - 4))
  const [head] = factCard(els, { ...s, card: { ...c, groups: [], press: '' } }, svg, false)
  const row = (q: any) => {
    /* the 20 px marker is two cells and a half, the row model counts one */
    const r = rowParts(q, room - 2, { answers: false, surface: 'desktop' })
    const p = statusPicture({ kind: 'icon', icon: r.blocking ? 'ldBlock' : 'ldAsk', tone: r.blocking ? 'amber' : 'dim', lead: true })
    return (
      <Box key={k + 'q-' + q.id} flexDirection="row" columnGap={1} alignItems="center">
        <Box key={k + 'qmark-' + q.id} flexShrink={0}><Svg source={p.source} alt={p.alt} width={p.width} height={p.height} /></Box>
        <Box key={k + 'qid-' + q.id} flexShrink={0}><Text bold>{r.id}</Text></Box>
        <Box key={k + 'qname-' + q.id} flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="truncate-end">{r.name}</Text></Box>
        {r.age ? <Box key={k + 'qage-' + q.id} flexShrink={0}><Text dimColor>{r.age}</Text></Box> : null}
      </Box>
    )
  }
  const groups = chipGroups(c.questions || [], c.here || null).map((g: any, gi: number) => (
    <Box key={k + 'cgroup-' + gi} flexDirection="column" rowGap={0.2}>
      {chipHeaderTree(els, k + 'chead-' + gi, g, room, 'desktop')}
      {g.rows.map(row)}
    </Box>
  ))
  return [head, ...groups, pressed && c.press ? <Text key={k + 'press'} dimColor wrap="wrap">{c.press}</Text> : null,
    c.where && c.where.length ? factGroup(els, c.where, k + 'where-', 0) : null,
    /* the head counts questions here, so the version closes the card */
    c.foot ? <Text key={k + 'foot'} dimColor wrap="wrap">{c.foot}</Text> : null]
}

/* The same tooltip for another row's card of a head and groups (the band's rows) */
export function factTip(els: any, key: string, card: { head: CardHead; groups: CardFact[][]; press?: string }, svg: any): any[] {
  return factCard(els, { key, text: '', tone: '', tip: '', card: { title: card.head.title, parts: [], ...card } }, svg, !!card.press)
}

/* a fact's words in its tone: the theme's ink by name, dim, or plain */
export function factPart(els: any, p: CardPart): any {
  const { Text } = els
  const ink = p.tone && INK[p.tone] ? { color: INK[p.tone] } : p.tone === 'dim' ? { dimColor: true } : null
  if (p.weight) return <Text weight={p.weight} {...(ink || {})}>{p.text}</Text>
  return ink ? <Text {...ink}>{p.text}</Text> : p.text
}

/* a line with links. One link: on the desktop the whole line is its face. Else each run of
   parts sharing a link is its own face (a Link on the terminal), the runs wrapping whole; null for none */
export function linkLine(els: any, l: CardPart[], key: string, desk: boolean, whole = true): any {
  const { Box, Text, Link } = els
  const shown = l.filter((p) => !p.pic && p.text)
  const hrefs = [...new Set(shown.filter((p) => p.href).map((p) => p.href))]
  if (!hrefs.length) return null
  const text = (ps: CardPart[]) => ps.map((p) => p.text).join('')
  if (hrefs.length === 1 && desk && whole) {
    const words = <Text wrap="wrap">{shown.map((p) => factPart(els, p))}</Text>
    return <Box key={key} flexDirection="row">{pressFace(els, key + '-go', words, linkOver(els, key + '-go-link', cellWidth(text(shown)), hrefs[0] as string), { shrink: true })}</Box>
  }
  const runs: CardPart[][] = []
  for (const p of shown) {
    const last = runs[runs.length - 1]
    if (last && (last[0].href || '') === (p.href || '')) last.push(p)
    else runs.push([p])
  }
  /* a run's own edge spaces are the gaps beside it, so a Box never starts or ends in one */
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap">
      {runs.map((r, i) => {
        const k = key + '-r' + i
        const gap = { ...(i < runs.length - 1 && /\s$/.test(text(r)) ? { marginRight: 1 } : {}), ...(i && /^\s/.test(text(r)) ? { marginLeft: 1 } : {}) }
        const parts = r.map((p, j) => {
          const t = j === r.length - 1 ? p.text.replace(/\s+$/, '') : p.text
          return { ...p, text: j === 0 ? t.replace(/^\s+/, '') : t }
        })
        const href = r[0].href
        if (!href) return <Box key={k} flexShrink={1} minWidth={0} {...gap}><Text wrap="wrap">{parts.map((p) => factPart(els, p))}</Text></Box>
        if (!desk) return <Box key={k} flexShrink={1} minWidth={0} {...gap}><Link href={href} label={text(parts)} /></Box>
        return <Box key={k} flexShrink={1} minWidth={0} {...gap}>{pressFace(els, k + '-face', <Text wrap="wrap">{parts.map((p) => factPart(els, p))}</Text>, linkOver(els, k + '-link', cellWidth(text(parts)), href), { shrink: true })}</Box>
      })}
    </Box>
  )
}

/* how a site other than the tooltip draws a fact: `lead` its own lead (the terminal has no
   picture), `line` a line it draws itself (a press in it), null to take the tooltip's */
export type FactDraw = { lead?: (p: any, key: string) => any; line?: (l: CardPart[], key: string) => any }
const leadPic = (els: any, p: any, key: string) => {
  const { Box, Svg } = els
  const d = statusPicture(p, 0)
  return <Box key={key} flexShrink={0}><Svg source={d.source} alt={d.alt} width={d.width} height={d.height} /></Box>
}

/* a group of facts, each its 20 px lead beside its wrapped lines, a bar drawn
   inline before its words; the tooltip's, and the Tracks tab's */
export function factGroup(els: any, g: CardFact[], k: string, gi: number, o: FactDraw = {}): any {
  const { Box, Text } = els
  const lead = o.lead || ((p: any, key: string) => leadPic(els, p, key))
  const line = (l: CardPart[], key: string) => {
    const own = o.line ? o.line(l, key) : linkLine(els, l, key, true)
    if (own) return own
    const bar = l.find((p) => p.pic)
    const words = <Text key={key + 'w'} wrap="wrap">{l.filter((p) => !p.pic && p.text).map((p) => factPart(els, p))}</Text>
    const pic = bar ? lead(bar.pic, key + 'bar') : null
    return pic ? <Box key={key} flexDirection="row" columnGap={1} alignItems="center" flexWrap="wrap">{pic}{words}</Box> : <Box key={key}>{words}</Box>
  }
  return (
    <Box key={k + 'group-' + gi} flexDirection="column">
      {g.map((r, ri) => (
        /* the 20 px lead sits on its fact's first line, a wrapped one too */
        <Box key={k + 'row-' + gi + '-' + ri} flexDirection="row" columnGap={1} alignItems="flex-start">
          {lead(r.lead, k + 'lead-' + gi + '-' + ri)}
          <Box key={k + 'lines-' + gi + '-' + ri} flexDirection="column" flexShrink={1} flexGrow={1}>
            {r.lines.map((l, li) => line(l, k + 'line-' + gi + '-' + ri + '-' + li))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/* an agent as the card and Home draw it: the depth bar (desktop) and the job,
   the model, running time, calls, tool in use and depth under it; a finished one dimmed */
export function agentRow(els: any, r: CardRow, prefix: string, glyph?: string): any {
  const { Box, Text, Svg } = els
  const m = r.meter
  const bar = m && Svg ? <Box key={prefix + 'bar-' + r.id} flexShrink={0}><Svg source={m.source} alt={m.alt} width={m.width} height={m.height} /></Box>
    : glyph ? <Box key={prefix + 'bar-' + r.id} flexShrink={0}><Text {...(TONES[ROW_TONE[r.tone]] || {})}>{glyph}</Text></Box> : null
  return (
    <Box key={prefix + r.id} flexDirection="row" columnGap={1}>
      {bar}
      <Box key={prefix + 'body-' + r.id} flexDirection="column" flexShrink={1}>
        <Text {...(r.done ? { dimColor: true } : { weight: 'semibold' })} wrap="wrap">{r.job}</Text>
        <Text dimColor wrap="wrap">{r.detail}</Text>
      </Box>
    </Box>
  )
}
const ROW_TONE: Record<string, string> = { sky: 'bright', amber: 'warning', red: 'error', dim: 'dim' }

/* the row's fixed shrink order. The gaps tighten 3, 2, 1; the task's
   name is cut with an ellipsis, its id and "+N" kept; the track's name is cut, then drawn as its icon
   alone; then the task in hand, the 5-hour and weekly percents and the agents' count drop to their
   icons one at a time. At the narrowest band (238 px, 28 cells) the shelf's count goes, then the
   task's and the track's icons, then the rate rings (the pane's copy wraps instead); the mark with its
   count and the context ring always stay. `over`: a segment's label cut (a string) or dropped (null);
   `gone`: a segment not drawn. */
const SHRINK = ['task', 'hour', 'week', 'agents', 'health']
const LAST = ['shelf', 'task', 'thread', 'week', 'hour']
const TRACK_MIN = 4
const TASK_MIN = 6
const ELLIPSIS = '\u2026'
/* the task's label: its id, its name, the count of the rest */
const TASK_PARTS = /^(\S+)(?: (.*?))?( \+\d+)?$/
/* the terminal's face for a segment drawn as its icon alone */
const TERM_ICON: Record<string, string> = { thread: '\u2263', task: '\u25a3', health: '!' }
type Plan = { gap: number; over: Map<string, string | null>; gone: Set<string> }

/* A segment as drawn under the plan: the desktop's picture label, the terminal's text */
function formOf(s: StatusSegment, over: Map<string, string | null>, desk: boolean): StatusSegment {
  if (!over.has(s.key)) return s
  const v = over.get(s.key) as string | null
  if (desk && s.pic) return { ...s, pic: { ...s.pic, label: v === null ? undefined : v } }
  if (v !== null) return { ...s, text: v }
  return { ...s, text: TERM_ICON[s.key] || s.text.replace(/\s*\d+%?$/, '') }
}
function cellsOf(s: StatusSegment, desk: boolean): number {
  if (!(desk && s.pic)) return cellWidth(s.text)
  const label = s.pic.label as string | undefined
  return Math.ceil(statusPicture(s.pic, label ? PIC_GAP : 0).width / 8) + (label ? cellWidth(label) : 0)
}
const labelOf = (s: StatusSegment, desk: boolean): string => String(desk && s.pic ? s.pic.label || '' : s.text)
function shrinkPlan(segs: StatusSegment[], budget: number | undefined, desk: boolean, extra: number, wraps = false): Plan {
  const over = new Map<string, string | null>()
  const gone = new Set<string>()
  const width = (gap: number) => {
    const drawn = segs.filter((s) => !gone.has(s.key))
    return drawn.reduce((n, s) => n + cellsOf(formOf(s, over, desk), desk), 0) + gap * (drawn.length - 1) + (extra ? extra + gap : 0)
  }
  if (budget === undefined) return { gap: GAP, over, gone }
  for (const gap of [GAP, 2, 1]) if (width(gap) <= budget) return { gap, over, gone }
  /* a label cut to the room at gap 1, its head and tail kept, never below `min` of its body */
  const room = budget
  const cut = (key: string, head: string, body: string, tail: string, min: number): boolean => {
    const b = [...body]
    over.delete(key)
    const keep = Math.max(min, b.length - (width(1) - room) - 1)
    if (keep < b.length) over.set(key, head + b.slice(0, keep).join('').trimEnd() + ELLIPSIS + tail)
    return width(1) <= room
  }
  /* counted whole, a long task name would hide every label, so it gives way first, then the
     track's, then the task's name goes (its id and count stay), then the track's label */
  const task = segs.find((s) => s.key === 'task')
  const tp = task ? TASK_PARTS.exec(labelOf(task, desk)) : null
  const named = !!(tp && tp[2])
  const track = segs.find((s) => s.key === 'thread')
  const tl = track ? labelOf(track, desk) : ''
  const cutTrack = () => !!track && cut('thread', '', tl, '', TRACK_MIN)
  if (named && cut('task', tp![1] + ' ', tp![2], tp![3] || '', TASK_MIN)) return { gap: 1, over, gone }
  if (cutTrack()) return { gap: 1, over, gone }
  if (named) {
    over.set('task', tp![1] + (tp![3] || ''))
    if (cutTrack() || (!track && width(1) <= budget)) return { gap: 1, over, gone }
  }
  if (track) {
    over.set('thread', null)
    if (width(1) <= budget) return { gap: 1, over, gone }
  }
  for (const k of SHRINK) {
    if (!segs.some((s) => s.key === k)) continue
    over.set(k, null)
    if (width(1) <= budget) return { gap: 1, over, gone }
  }
  /* the pane's copy wraps instead */
  for (const k of wraps ? [] : LAST) {
    if (!segs.some((s) => s.key === k)) continue
    if (k === 'shelf') over.set(k, null)
    else gone.add(k)
    if (width(1) <= budget) break
  }
  return { gap: 1, over, gone }
}

/* The segments sit at the line's right end and each card opens leftward on the row
   itself (a negative left offset), over what is drawn before it; a one-row site
   clips what paints outside it. */
export function statusTree(els: any, m: any, hint: any, opts: StatusOpts = {}): any {
  const { Box, Text, Button, Link } = els
  const desk = opts.surface === 'desktop'
  /* an empty shelf is the desktop's gray 0; the mark opens the desktop's row; the terminal draws neither */
  const all: StatusSegment[] = desk ? [m.mark, ...m.segments].filter(Boolean) : m.segments.filter((s: StatusSegment) => !s.empty)
  const cols = Number.isFinite(opts.columns) ? (opts.columns as number) : undefined
  const card = cardColors(opts.surface)
  const drawn: any[] = []
  const home = opts.home
  /* the desktop's opener is the mark; the terminal keeps the word */
  const opener = home && !desk ? <Box key="askerdo-opener" flexShrink={0}><Button key="askerdo-open" plain label={OPENER} onPress={() => home()} /></Box> : null
  /* the whole columns are the segments' budget; on the terminal the app's hint gives way */
  const { gap, over, gone } = shrinkPlan(all, cols, desk, opener ? cellWidth(OPENER) : 0, !!opts.wrap)
  const segs = all.filter((s) => !gone.has(s.key)).map((s) => formOf(s, over, desk))
  let fromRight = opener ? cellWidth(OPENER) + gap : 0
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]
    const pic = desk && s.pic ? pictureFace(els, s, opts) : null
    const on = pressOf(s, opts)
    const tip = tipLine(s, !!on || !!s.href)
    const w = pic ? pic.cells : cellWidth(s.text)
    const room = cols === undefined ? tip.length : Math.max(1, cols - fromRight - w - 1)
    /* a tooltip of grouped facts is as wide as the app's popover, not its flat line */
    const facts = !!(pic && s.card && (s.card.groups || s.card.questions || (s.card.where && s.card.where.length)))
    const width = Math.min(facts ? CARD_CELLS : tip.length, room)
    const face = <Text tabular {...(TONES[s.tone] || {})}>{s.text}</Text>
    const body = pic && s.card ? deskCard(els, s, pic.head(), !!on || !!s.href, cols) : [<Text color={card.text} wrap={desk ? 'wrap' : 'truncate-end'}>{tip}</Text>]
    drawn.unshift(
      <Box key={'status-' + s.key} flexShrink={0}>
        {pic ? pic.face : on ? <Button key={on.key} plain onPress={on.act}>{face}</Button> : s.href ? <Link key={linkKey(s)} href={s.href}>{face}</Link> : face}
        {opts.cards === false ? null : (
          <Box position="absolute" top={0} left={-(width + 1)} width={width} display="none" hover={{ display: 'flex' }} backgroundColor={card.bg}
            {...(desk ? { flexDirection: 'column' } : {})} {...(facts ? { rowGap: 1 } : {})}>
            {body}
          </Box>
        )}
      </Box>,
    )
    fromRight += w + gap
  }
  /* the pane's copy wraps at the pane's width, half a line apart on the desktop, one group;
     it splits as the band does when the row's cells fit the columns */
  const fits = cols !== undefined && fromRight - gap <= cols
  if (opts.wrap && !fits) {
    const line = <Box key="status-line" flexDirection="row" columnGap={gap} flexShrink={1} flexWrap="wrap" {...(desk ? { rowGap: 1 } : {})}>{drawn}</Box>
    return <Box key="askerdo-status" flexDirection="row" justifyContent="space-between" columnGap={gap}>{line}{opener}</Box>
  }
  /* the band's row is two groups pushed apart, the gap growing with the bar */
  if (opts.wrap || (desk && hint === null)) {
    const left = drawn.filter((_, i) => LEFT.has(segs[i].key))
    const right = drawn.filter((_, i) => !LEFT.has(segs[i].key))
    return (
      <Box key="askerdo-status" flexDirection="row" justifyContent="space-between" columnGap={gap}>
        <Box key="askerdo-status-left" flexDirection="row" columnGap={gap} flexShrink={0}>{left}</Box>
        <Box key="status-line" flexDirection="row" columnGap={gap} flexShrink={0}>{right}{opener}</Box>
      </Box>
    )
  }
  const line = <Box key="status-line" flexDirection="row" columnGap={gap} flexShrink={0}>{drawn}</Box>
  return (
    <Box key="askerdo-status" flexDirection="row" justifyContent="space-between" columnGap={gap}>
      <Box key="status-hint" flexShrink={1}>{hint}</Box>
      <Box key="askerdo-status-end" flexDirection="row" columnGap={gap} flexShrink={0}>{line}{opener}</Box>
    </Box>
  )
}
