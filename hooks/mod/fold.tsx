/* the pane's one open and shut control, a sky ring with its
 * chevron ending the row, drawn here once for every fold and expand arrow on the desktop; the
 * terminal has no Svg, so it keeps its text arrows. */
import { paneMeasure } from '../../lib/mod-core.mjs'
import { pressOver } from './status.tsx'

/* the ring's 24 px and a cell's gap before it, in the pane's 8.453 px cells (3.84, so 4) */
export const FOLD_CELLS = 4
const PX = 24, CELL = 8.453
export const OPEN = '▾', SHUT = '▸'
/* light then dark: the ring the badge's sky, the chevron the pane's sky; lit, the light theme's pale
   sky tint and the dark theme's grey (a sky tint read teal on near black) */
const RING = ['#00AEEF', '#26C3FF'], CHEVRON = ['#0284c7', '#26c3ff'], LIT = ['rgba(0,174,239,0.2)', 'rgba(255,255,255,0.14)']
const PATH = { shut: 'M10.2 7.6L14.6 12L10.2 16.4', open: 'M7.6 10.2L12 14.6L16.4 10.2' }

/* shut points right, open points down: two drawings, swapped by the press's redraw */
export function foldPicture(open: boolean, lit = false): { source: string; alt: string; width: number; height: number } {
  const css = (i: number) => '.r{stroke:' + RING[i] + '}.c{stroke:' + CHEVRON[i] + '}' + (lit ? '.f{fill:' + LIT[i] + '}' : '')
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="' + PX + '" height="' + PX + '" viewBox="0 0 24 24"><style>' + css(0)
    + '@media (prefers-color-scheme: dark){' + css(1) + '}</style>'
    /* the lit fill stays under the ring's stroke; out to the box's edge it would draw a second ring round it */
    + (lit ? '<circle cx="12" cy="12" r="10.1" class="f"/>' : '')
    + '<circle cx="12" cy="12" r="10.1" fill="none" stroke-width="1.6" class="r"/>'
    + '<path d="' + PATH[open ? 'open' : 'shut'] + '" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="c"/></svg>'
  return { source, alt: open ? 'Open: press to shut' : 'Shut: press to open', width: PX, height: PX }
}

/* The ring on a line `line` px tall, its margins giving the line back; the lit drawing lies over the
   rest one and shows on hover, since a hover can show a Box, never hide one. With key and press it is
   its own press and lights on its own hover, else on the hover of the keyed row above it. */
export function foldRing(els: any, open: boolean, o: { key?: string; pressKey?: string; press?: () => void; band?: boolean; line?: number } = {}): any {
  const { Box, Svg } = els
  const rest = foldPicture(open), lit = foldPicture(open, true)
  const own = o.key && o.pressKey && o.press
  const margin = ((o.line || 20) - PX) / 20
  /* the lit copy hangs leftward out of a Box 0 wide, so it lies on the rest one at any cell
     width; pulled back by cells it would miss where a cell is not 24/2.839 px and squeeze the rest one.
     Kept in the flow, a row's press laid over the ring still takes the pointer. */
  return (
    <Box {...(o.key ? { key: o.key } : {})} flexDirection="row" flexShrink={0} marginY={margin}>
      <Svg source={rest.source} alt={rest.alt} width={PX} height={PX} />
      <Box width={0} flexShrink={0} justifyContent="flex-end">
        <Box flexShrink={0} display="none" hover={{ display: 'flex' }}>
          <Svg source={lit.source} alt={lit.alt} width={PX} height={PX} />
        </Box>
      </Box>
      {own ? pressOver(els, o.pressKey as string, 3, o.press as () => void, undefined, !!o.band) : null}
    </Box>
  )
}

/* the desktop's cells for words at the pane's 14 px (600: a heading's title) */
export const paneCells = (s: string, weight = 400) => paneMeasure(s, 14, weight) / CELL

/* a heading's line on the desktop cut after a whole word where its room ends, so the ring keeps its place */
export function fitWords(s: string, cells: number): string {
  const fits = (t: string) => paneCells(t) <= cells
  if (fits(s)) return s
  const words = s.split(' ')
  const cut = () => words.join(' ').replace(/[,;:]$/, '') + '…'
  while (words.length > 1 && !fits(cut())) words.pop()
  return cut()
}

/* the ring's width left empty, so a grid's rows without one keep their columns under the ones with one */
export function foldGap(els: any, key: string): any {
  const { Box } = els
  return <Box key={key} flexShrink={0} width={Math.round((PX / CELL) * 1000) / 1000} />
}

/* B's ring ends its row one cell past what comes before, whatever the row's own gap. Unkeyed, so
   a ring that is not its own press lights with the row that holds it */
export function foldEnd(els: any, ring: any, gap: number): any {
  const { Box } = els
  return <Box flexDirection="row" flexGrow={1} flexShrink={0} justifyContent="flex-end" {...(gap > 1 ? { marginLeft: 1 - gap } : {})}>{ring}</Box>
}

/* A section heading, the whole row its press: the title and what follows it, the ring at the
   row's end, lit from anywhere on the row; presses inside it come lifted (liftPress). line: the
   first line's height; titleCells: the title's width, so one wider than the row wraps rather than
   running under the ring. The terminal: the arrow and the title one plain Button. */
export function foldHead(els: any, o: { key: string; press: string; open: boolean; toggle: () => void; desk: boolean; cols: number; title: any; rest?: any[]; wrap?: boolean; line?: number; gap?: number; titleCells?: number }): any {
  const { Box, Button, Text } = els
  const rest = (o.rest || []).filter(Boolean)
  if (!o.desk) {
    return (
      <Box key={o.key} flexDirection="row" columnGap={o.gap || 1} alignItems="center" {...(o.wrap ? { flexWrap: 'wrap' } : {})}>
        <Box key={o.key + '-face'} flexShrink={0}><Button key={o.press} plain onPress={o.toggle}><Text>{(o.open ? OPEN : SHUT) + ' '}</Text>{o.title}</Button></Box>
        {rest}
      </Box>
    )
  }
  return (
    <Box key={o.key} flexDirection="row" columnGap={1} alignItems="flex-start">
      {pressOver(els, o.press, o.cols, o.toggle)}
      <Box key={o.key + '-words'} flexDirection="row" columnGap={o.gap || 1} rowGap={0.5} alignItems="center" flexGrow={1} flexShrink={1} minWidth={0} {...(o.wrap ? { flexWrap: 'wrap' } : {})}>
        {/* the title stays whole on one line unless wider than the row; what follows it takes the cut */}
        <Box key={o.key + '-title'} {...(Number(o.titleCells) > o.cols - FOLD_CELLS ? { flexShrink: 1, minWidth: 0 } : { flexShrink: 0 })}>{o.title}</Box>
        {rest}
      </Box>
      {foldRing(els, o.open, { line: o.line })}
    </Box>
  )
}

/* A press inside a heading row painted after its press, so it takes the pointer (an empty placed
   Box makes its parent positioned, desktop-capabilities "a press laid over a whole Box") */
export function liftPress(els: any, key: string, press: any, desk: boolean): any {
  const { Box } = els
  return <Box key={key} flexShrink={0}>{press}{desk ? <Box position="absolute" top={0} left={0} /> : null}</Box>
}
