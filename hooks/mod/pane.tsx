/* The Tracks tab's tree: the bottom line, the
 * track this session holds as a card, then tiles for the tracks to pick up, the ones other
 * sessions hold and the parked ones under a fold. The facts are the track tooltip's rows
 * (status.tsx factGroup); drawn from mod-core tracksView alone; index.ts owns the writes. */
import { cardHref, cellWidth, clampWords, statusPicture } from '../../lib/mod-core.mjs'
import { factGroup, factPart, linkLine, linkOver, pressFace, pressOver, tileLook } from './status.tsx'
import { FOLD_CELLS, fitWords, foldHead, paneCells } from './fold.tsx'

export type PaneActions = {
  /* a press's surface rides along, so the copy lands where the press came from */
  copy: (id: string, command: string, name: string, surface?: string) => void
  resume: (id: string, takeOver: boolean) => void
  ask: (qid: string) => void
  /* a section heading's press, its fold kept by index.ts on this PC */
  fold: (section: string) => void
}

/* each section open or shut (Parked shut, the rest open); index.ts keeps them across restarts */
export type PaneView = { parked: boolean; pickup?: boolean; elsewhere?: boolean }

const MID = ' · '
/* a cell of the pane's 14 px Sans, and a lead's 20 px with the gap after it, in cells */
const CELL = 8.45
const LEAD = (20 + CELL) / CELL
/* prose runs about 0.8 of a cell a letter, so a clamp counts this many letters a cell;
   one that runs long only wraps a row more */
const PROSE = 1.2
const letters = (cells: number) => Math.max(8, Math.floor(cells * PROSE))
/* the design's thresholds: full labels from 40 cells, two tiles to a row from 80, three from 140 */
const NARROW = 40, WIDE = 80, WIDER = 140
/* 12 px between tiles, as between rows */
const TILE_GAP_X = 12 / CELL, TILE_GAP_Y = 0.6
/* a tone's theme ink, as the tooltip's */
const INK: Record<string, any> = { sky: { color: 'suggestion' }, amber: { color: 'warning' }, dim: { dimColor: true } }
/* the terminal has no pictures: a lead is a glyph in its tone */
const TERM_LEAD: Record<string, string> = { thread: '≣', ldBlock: '!', ldAsk: '?', ldWaits: '…', ldHandoff: '→', ldDone: '✓', ldFlag: '»' }
const STATION_GLYPH: Record<string, string> = { now: '●', left: '◐', ready: '○' }

/* what the size guard cut: each section's tracks past a count, the station and question rows past a count */
export type TracksTrim = { tiles?: Record<string, number>; rows?: number }
const CUT_WORDS = ' not drawn here while the Tracks tab holds this much; the board link above shows '
const are = (n: number) => (n === 1 ? ' is' : ' are')

type Draw = { els: any; desk: boolean; act: PaneActions; cols: number; trim: TracksTrim }

export function paneTree(els: any, m: any, view: PaneView, act: PaneActions, columns?: number, surface?: string, trim: TracksTrim = {}): any {
  const { Box, Text, Button } = els
  const cols = Number(columns) > 0 ? Number(columns) : 60
  const d: Draw = { els, desk: surface === 'desktop' && !!els.Svg, act, cols, trim }
  const rows: any[] = [bottomRows(d, m.bottom)]
  if (!m.total) return <Box key="tracks" flexDirection="column" rowGap={1}>{rows}</Box>
  if (m.held) rows.push(heldCard(d, m.held))
  if (m.pickup.length) rows.push(section(d, 'pickup', 'Ready to pick up', m.pickup, view.pickup !== false, m.holding ? 'each starts in a new session' : ''))
  if (m.elsewhere.length) rows.push(section(d, 'elsewhere', m.elsewhere.length === 1 ? 'Running in another session' : 'Running in other sessions', m.elsewhere, view.elsewhere !== false))
  /* shut, Parked names what is inside, so a glance is enough */
  if (m.parked.length) rows.push(section(d, 'parked', 'Parked', m.parked, !!view.parked, '', true))
  return <Box key="tracks" flexDirection="column" rowGap={1}>{rows}</Box>
}

/* Where this session is, then the counts with the first in amber; the note with nothing at
   all; the offline line while the board is away. */
function bottomRows(d: Draw, b: any): any {
  const { Box, Text } = d.els
  /* the held name and the waiting tracks open their pages */
  const lead = b.leadParts ? leadRows(d, b.leadParts.map((p: any) => ({ ...p, weight: 'semibold' }))) : null
  const lines: any[] = [lead || <Box key="tracks-lead"><Text weight="semibold" wrap="wrap">{b.lead}</Text></Box>]
  /* on the desktop a count that does not fit the row before it starts its own, fitted from the
     pane's columns on every draw: a soft wrap at the pane's edge hangs its space past the edge */
  const rows: any[][] = []
  for (const p of b.parts) {
    const row = rows[rows.length - 1]
    if (row && (!d.desk || paneCells([...row, p].map((x: any) => x.text).join(MID)) <= d.cols - 1)) row.push(p)
    else rows.push([p])
  }
  const countRow = (ps: any[], key: string): any => {
    const all: any[] = []
    ps.forEach((p: any, i: number) => {
      if (i) all.push({ text: MID, tone: 'dim' })
      all.push(...(p.pieces ? p.pieces.map((x: any) => ({ ...x, tone: p.tone })) : [p]))
    })
    const linked = all.length ? linkLine(d.els, all, key, d.desk, false) : null
    if (linked) return linked
    const parts: any[] = []
    ps.forEach((p: any, i: number) => {
      if (i) parts.push(<Text dimColor>{MID}</Text>)
      parts.push(<Text {...(INK[p.tone] || {})}>{p.text}</Text>)
    })
    return <Box key={key}><Text wrap="wrap">{parts}</Text></Box>
  }
  if (rows.length === 1) lines.push(countRow(rows[0], 'tracks-counts'))
  else if (rows.length) lines.push(<Box key="tracks-counts" flexDirection="column">{rows.map((r, i) => countRow(r, 'tracks-counts-' + i))}</Box>)
  if (b.note) lines.push(<Box key="tracks-note"><Text dimColor wrap="wrap">{b.note}</Text></Box>)
  if (b.offline) lines.push(<Box key="tracks-offline"><Text color="warning" wrap="wrap">{b.offline}</Text></Box>)
  return <Box key="tracks-bottom" flexDirection="column">{lines}</Box>
}

/* on the desktop the heading's lines are fitted from the pane's columns on every draw, a word
   with no space before it (the full stop) kept with the one before: a soft wrap at the pane's edge
   hangs the name's press rim past the edge and can leave the full stop alone */
function leadRows(d: Draw, parts: any[]): any {
  if (!d.desk) return linkLine(d.els, parts, 'tracks-lead', false, false)
  const { Box, Text } = d.els
  const groups: any[][] = []
  let gap = false
  for (const p of parts) {
    for (const [, sp, w] of String(p.text).matchAll(/(\s*)(\S*)/g)) {
      if (sp) gap = true
      if (!w) continue
      const word = { ...p, text: w, space: gap }
      if (groups.length && !gap) groups[groups.length - 1].push(word)
      else groups.push([word])
      gap = false
    }
  }
  const asParts = (ws: any[]) => {
    const out: any[] = []
    ws.forEach((w, i) => {
      const last = out[out.length - 1]
      const sep = i && w.space ? ' ' : ''
      if (last && (last.href || '') === (w.href || '')) last.text += sep + w.text
      else {
        if (last && sep) last.text += sep
        const { space, ...part } = w
        out.push(part)
      }
    })
    return out
  }
  /* the gap beside a link is the space in the words on the desktop, and a press face adds no width */
  const cells = (ws: any[]) => paneCells(asParts(ws).map((p) => p.text).join(''), 600)
  const lines: any[][] = []
  for (const g of groups) {
    const line = lines[lines.length - 1]
    if (line && cells([...line, ...g]) <= d.cols - 1) line.push(...g)
    else lines.push([...g])
  }
  const row = (ws: any[], i: number) => {
    const key = 'tracks-lead-' + i
    return linkLine(d.els, asParts(ws), key, true, false)
      || <Box key={key}><Text weight="semibold" wrap="wrap">{asParts(ws).map((p) => p.text).join('')}</Text></Box>
  }
  return <Box key="tracks-lead" flexDirection="column">{lines.map(row)}</Box>
}

/* This session's track: the head across the card, then where, how far, you and the handoff;
   from 80 cells how far on the left and you and the handoff on the right. */
function heldCard(d: Draw, t: any): any {
  const { Box } = d.els
  const wide = d.cols >= WIDE
  const inner = d.cols - 3
  const half = wide ? Math.floor((inner - 2) / 2) : inner
  const room = half - 3
  /* a fact line's room inside the border and padding (4 cells), the column gap when wide,
     less the 20 px lead and its one-cell gap */
  const column = wide ? (d.cols - 6) / 2 : d.cols - 4
  const barPx = column * CELL - 20 - CELL
  const [g1, g2, g3] = t.groups.map((g: any) => fitGroup(rowsCut(g, d.trim.rows), room, wide, barPx))
  const group = (g: any, gi: number) => factGroup(d.els, g, 'hf-', gi, factDraw(d))
  const body = wide
    ? [
      <Box key="hcols" flexDirection="row" columnGap={2}>
        <Box key="hcol-left" flexDirection="column" rowGap={0.5} width={0} flexGrow={1}>{[group(g1, 0), group(g2, 1)]}</Box>
        <Box key="hcol-right" flexDirection="column" rowGap={0.5} width={0} flexGrow={1}>{[group(g3, 2)]}</Box>
      </Box>,
    ]
    : [group(g1, 0), group(g2, 1), group(g3, 2)]
  return (
    <Box key={'trk-held-' + t.id} flexDirection="column" rowGap={0.5} borderStyle="round" borderDimColor paddingX={1}>
      {[head(d, t, inner - 3), ...body, foundRow(d, t)].filter(Boolean)}
    </Box>
  )
}

/* what the track's arc found, the unplaced first in amber, and the verb that lists
   each with the command that moves it; nothing when the arc found nothing */
function foundRow(d: Draw, t: any): any {
  const f = t.found
  if (!f || !(f.total > 0)) return null
  const { Box, Text } = d.els
  const ids: string[] = Array.isArray(f.unplacedIds) ? f.unplacedIds : []
  const urls: string[] = Array.isArray(f.unplacedUrls) ? f.unplacedUrls : []
  const parts: any[] = [{ text: 'Found this arc: ', tone: 'dim' }]
  /* each unplaced id opens its page */
  if (f.unplaced) {
    const shown = ids.slice(0, 4)
    parts.push({ text: f.unplaced + ' unplaced' + (shown.length ? ' (' : ''), tone: 'amber' })
    shown.forEach((id, i) => parts.push({ text: id, tone: 'amber', href: urls[i] || undefined }, { text: i < shown.length - 1 ? ', ' : (ids.length > 4 ? ', ...' : '') + ')', tone: 'amber' }))
    parts.push({ text: MID, tone: 'dim' })
  }
  parts.push({ text: f.elsewhere + ' on other tracks' + MID + f.here + ' here' + MID + 'askerdo track found ' + t.id, tone: 'dim' })
  const line = linkLine(d.els, parts, 'trk-found-line-' + t.id, d.desk)
  return <Box key={'trk-found-' + t.id} paddingLeft={d.desk ? LEAD : 2}>{line || <Text wrap="wrap">{parts.map((p) => factPart(d.els, p))}</Text>}</Box>
}

/* a shut section's names as links, as many whole as fit `room`, then "and N more"; none when
   the first does not fit, so the section's cut words take the row instead of a wrap */
function shutNames(d: Draw, tracks: any[], room: number): any {
  const w = (s: string) => (d.desk ? paneCells(s) : cellWidth(s))
  const more = (n: number) => (n ? ' and ' + n + ' more' : '')
  let k = tracks.length
  const size = (n: number) => w(tracks.slice(0, n).map((t: any) => t.name).join(', ') + more(tracks.length - n))
  while (k > 1 && size(k) > room) k--
  if (size(k) > room) return null
  const parts: any[] = tracks.slice(0, k).flatMap((t: any, i: number) => [{ text: t.name, tone: 'dim', href: t.url || undefined }, ...(i < k - 1 ? [{ text: ', ', tone: 'dim' }] : [])])
  if (k < tracks.length) parts.push({ text: more(tracks.length - k), tone: 'dim' })
  return linkLine(d.els, parts, 'parked-names-line', d.desk, false)
}

/* A section: its heading the fold's press, the count whole and a note or, shut, the names cut
   at the row's end; open, its tiles in rows of one, two or three. Parked keeps its old keys. */
function section(d: Draw, key: string, title: string, tracks: any[], open: boolean, note: string, named = false): any {
  const { Box, Text } = d.els
  const parked = key === 'parked'
  const k = d.trim.tiles ? d.trim.tiles[key] : undefined
  const shown = Number(k) >= 0 ? tracks.slice(0, k) : tracks
  const left = tracks.length - shown.length
  const after = !open && named ? tracks.map((t: any) => t.name).join(', ') : note
  const count = String(tracks.length) + (after ? MID.trimEnd() : '')
  /* the heading's words, its gaps and the ring take the rest of the row; the desktop's by the pane's own widths */
  const room = d.desk ? d.cols - FOLD_CELLS - paneCells(title, 600) - paneCells(count) - 2 : d.cols - cellWidth(title) - cellWidth(String(tracks.length)) - 10
  /* the title and the bare count wider than the row: one Text, so the title wraps at a word with
     the count after its last word (two no-break spaces), clear of the ring; the note and names give way */
  const tight = d.desk && d.cols - FOLD_CELLS - paneCells(title, 600) - paneCells(String(tracks.length)) - 2 < 0
  const cut = tight ? '' : !after || room <= 0 ? after : d.desk ? fitWords(after, room) : clampWords(after, letters(room), 1)
  /* shut, the whole names that fit open their pages, the rest counted; drawn after the fold's press, so they take the pointer */
  const names = !tight && !open && named && room > 0 && tracks.some((t: any) => t.url) ? shutNames(d, tracks, room) : null
  /* no words fit after the count: its dot goes too */
  const rest = tight ? [] : [<Box key={'sect-count-' + key} flexShrink={0}><Text dimColor>{names || cut ? count : String(tracks.length)}</Text></Box>]
  if (names) rest.push(<Box key="parked-names" flexShrink={1} minWidth={0}>{names}{d.desk ? <Box position="absolute" top={0} left={0} /> : null}</Box>)
  else if (cut) rest.push(<Box key={parked ? 'parked-names' : 'sect-note-' + key} flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{cut}</Text></Box>)
  const words = tight
    ? <Text wrap="wrap"><Text weight="semibold">{title}</Text><Text dimColor>{'  ' + tracks.length}</Text></Text>
    : <Text weight="semibold">{title}</Text>
  const head = foldHead(d.els, { key: parked ? 'parked-row' : 'sect-head-' + key, press: parked ? 'parked-fold' : 'fold-' + key, open, toggle: () => d.act.fold(key),
    desk: d.desk, cols: d.cols, title: words, rest, ...(tight ? { titleCells: d.cols } : {}) })
  return (
    <Box key={parked ? 'parked' : 'sect-' + key} flexDirection="column" rowGap={0.5}>
      {head}
      {open ? grid(d, key, shown) : null}
      {open && left ? <Box key={'sect-cut-' + key}><Text dimColor wrap="wrap">{left + (shown.length ? ' more' : left === 1 ? ' track' : ' tracks') + are(left) + CUT_WORDS + 'each one.'}</Text></Box> : null}
    </Box>
  )
}

/* Tiles share a row by `width: 0` and `flexGrow: 1` (measured); a short last row keeps its
   tiles' width with empty ones. */
function grid(d: Draw, key: string, tracks: any[]): any {
  const { Box } = d.els
  const n = d.cols >= WIDER ? 3 : d.cols >= WIDE ? 2 : 1
  const tileCols = Math.floor((d.cols - (n - 1) * TILE_GAP_X) / n)
  /* a tile's bar by the held card's measure: the tile's px less border and padding (4 cells), the lead and its gap */
  const barPx = (d.cols * CELL - (n - 1) * TILE_GAP_X * CELL) / n - 4 * CELL - 20 - CELL
  const tiles = tracks.map((t, i) => tile(d, t, tileCols, i, barPx))
  if (n === 1) return <Box key={'grid-' + key} flexDirection="column" rowGap={TILE_GAP_Y}>{tiles}</Box>
  const rows: any[] = []
  for (let r = 0; r * n < tiles.length; r++) {
    const cells = tiles.slice(r * n, r * n + n).map((x, i) => <Box key={'cell-' + key + '-' + (r * n + i)} width={0} flexGrow={1} flexDirection="column">{x}</Box>)
    while (cells.length < n) cells.push(<Box key={'cell-' + key + '-gap-' + cells.length} width={0} flexGrow={1} />)
    rows.push(<Box key={'grid-' + key + '-' + r} flexDirection="row" columnGap={TILE_GAP_X}>{cells}</Box>)
  }
  return <Box key={'grid-' + key} flexDirection="column" rowGap={TILE_GAP_Y}>{rows}</Box>
}

/* One track in the list: the head, its one group of facts, the press on its own row. */
function tile(d: Draw, t: any, tileCols: number, i: number, barPx: number): any {
  const { Box } = d.els
  const room = tileCols - 5
  const parts: any[] = [head(d, t, room), factGroup(d.els, fitGroup(rowsCut(t.groups[0] || [], d.trim.rows), room, d.cols >= WIDE, barPx), 'tf-' + t.id + '-', 0, factDraw(d))]
  const found = foundRow(d, t)
  if (found) parts.push(found)
  if (t.press) parts.push(pressRow(d, t))
  const look = d.desk ? { ...tileLook(false, false), paddingX: 1 } : {}
  return <Box key={'trk-tile-' + t.id} flexDirection="column" rowGap={0.3} {...look}>{parts}</Box>
}

/* a group's station and question rows past the first `r`, one row in their place saying how many */
export const rowCuttable = (x: any): boolean => !!x && !!x.lead && (x.lead.kind === 'station' || ['ldAsk', 'ldBlock', 'ldWaits'].includes(x.lead.icon))
function rowsCut(g: any[], r?: number): any[] {
  const keep = Number(r)
  if (!(keep >= 0)) return g
  const n = g.filter(rowCuttable).length
  if (n <= keep) return g
  let seen = 0
  const out: any[] = []
  for (const x of g) {
    if (!rowCuttable(x)) { out.push(x); continue }
    seen++
    if (seen <= keep) out.push(x)
    else if (seen === keep + 1) out.push({ lead: x.lead, lines: [[{ text: (n - keep) + (keep ? ' more' : '') + (n - keep === 1 ? ' task or question row' : ' task and question rows') + are(n - keep) + CUT_WORDS + 'the track whole.', tone: 'dim' }]] })
  }
  return out
}

/* The tile's press: copy the resume command while this session holds a track, else resume here. */
function pressRow(d: Draw, t: any): any {
  const { Box, Button } = d.els
  const p = t.press
  const label = d.cols < NARROW ? p.short : p.label
  const run = (e: any) => (p.kind === 'copy' ? d.act.copy(t.id, p.command, t.name, e && e.surface) : d.act.resume(t.id, !!p.takeOver))
  return (
    <Box key={'trk-act-' + t.id} flexDirection="row" paddingLeft={d.desk ? LEAD : 2}>
      <Button key={'trk-press-' + t.id} label={label} {...(p.primary ? { variant: 'primary' } : {})} onPress={run} />
    </Box>
  )
}

/* The head: the rails icon in its tone, the id dim and the name semibold as one line of words
   (a press opens its page on the board), the state at the row's end, or under them when both
   do not fit one row. */
function head(d: Draw, t: any, room: number): any {
  const { Box, Text, Link } = d.els
  /* never `h`: the JSX factory's name */
  const top = t.head
  const lead = top.id + ' '
  const all = clampWords(lead + top.name, letters(room), 2)
  const name = all.startsWith(lead) ? all.slice(lead.length) : clampWords(top.name, letters(room - cellWidth(lead)), 2)
  const href = t.url ? cardHref(t.url) : ''
  /* one Text, so the name flows on after the id and wraps under it, never a row of its own */
  const words = <Text wrap="wrap"><Text dimColor>{top.id}</Text>{' '}<Text weight="semibold">{name}</Text></Text>
  const title = !href ? <Box key={'tname-' + t.id} flexShrink={1}>{words}</Box>
    : d.desk ? pressFace(d.els, 'tname-' + t.id, words, linkOver(d.els, 'tname-' + t.id + '-link', cellWidth(lead + name), href), { shrink: true })
      : (
        <Box key={'tname-' + t.id} flexDirection="row" columnGap={1} flexWrap="wrap" flexShrink={1}>
          <Text dimColor>{top.id}</Text>
          <Link href={href} label={name} />
        </Box>
      )
  const st = top.state ? <Box key={'tstate-' + t.id} flexShrink={0}><Text {...(INK[top.state.tone] || {})}>{top.state.text}</Text></Box> : null
  const one = !st || (cellWidth(lead + top.name) + cellWidth(top.state.text)) / PROSE + 3 <= room
  return (
    <Box key={'thead-' + t.id} flexDirection="row" columnGap={1} alignItems="flex-start">
      {leadOf(d, { kind: 'icon', icon: top.icon, tone: top.tone, lead: true }, 'tlead-' + t.id)}
      {one
        ? [<Box key={'tbody-' + t.id} flexGrow={1} flexShrink={1}>{title}</Box>, st]
        : <Box key={'tbody-' + t.id} flexDirection="column" flexGrow={1} flexShrink={1}>{[title, st]}</Box>}
    </Box>
  )
}

/* A lead: the tooltip's picture on the desktop, a glyph in its tone on the terminal. */
function leadOf(d: Draw, p: any, key: string): any {
  const { Box, Text, Svg } = d.els
  if (d.desk) {
    const pic = statusPicture(p, 0)
    return <Box key={key} flexShrink={0}><Svg source={pic.source} alt={pic.alt} width={pic.width} height={pic.height} /></Box>
  }
  if (p.kind === 'bar') return null
  const glyph = p.kind === 'station' ? STATION_GLYPH[p.state] || '○' : TERM_LEAD[p.icon] || '·'
  return <Box key={key} flexShrink={0} width={1}><Text {...(INK[p.tone] || (p.kind === 'station' ? INK.sky : INK.dim))}>{glyph}</Text></Box>
}

/* The facts drawn here: the pane's own leads, and a line with a question in it as a row whose
   words open Questions pinned at it. */
function factDraw(d: Draw): any {
  const { Box, Text, Button } = d.els
  return {
    lead: (p: any, key: string) => leadOf(d, p, key),
    line: (l: any[], key: string) => {
      const q = l.find((p) => p.ask)
      /* a name opens its page (status.tsx linkLine) */
      if (!q) return linkLine(d.els, l, 'trk-go-' + key, d.desk)
      const all = l.filter((p) => p.text)
      const rest = all.filter((p) => p !== q)
      if (d.desk) {
        /* the whole line is the face, so ", blocking" flows on after the name, never a row of its own */
        const words = <Text wrap="wrap">{all.map((p) => factPart(d.els, p))}</Text>
        const over = pressOver(d.els, 'trk-ask-' + q.ask, cellWidth(all.map((p) => p.text).join('')), () => d.act.ask(q.ask))
        return <Box key={key} flexDirection="row">{pressFace(d.els, 'trk-askface-' + q.ask, words, over, { shrink: true })}</Box>
      }
      return (
        <Box key={key} flexDirection="row" flexWrap="wrap">
          <Box key={'trk-askface-' + q.ask} flexShrink={1}><Button key={'trk-ask-' + q.ask} plain label={q.text} onPress={() => d.act.ask(q.ask)} /></Box>
          {rest.length ? <Text key={key + 'w'} wrap="wrap">{rest.map((p) => factPart(d.els, p))}</Text> : null}
        </Box>
      )
    },
  }
}

/* The group for a room of `room` cells: each part marked to clamp ends on a whole word within
   its rows (`clamp` under 80 cells, `clampWide` from 80), the words before it on its line
   counted; a bar takes the room left beside its lead, `barPx` when the caller measured it. */
function fitGroup(g: any[], room: number, wide: boolean, barPx?: number): any[] {
  const px = Math.max(40, Math.floor(barPx ?? room * CELL))
  return g.map((r) => ({
    ...r,
    lines: r.lines.map((l: any[]) => {
      if (l.some((p) => p.pack)) return packLine(l, room, wide)
      let before = ''
      return l.map((p) => {
        const rows = wide ? p.clampWide || p.clamp : p.clamp
        let out = p
        if (p.pic) out = { ...p, pic: { ...p.pic, max: px } }
        else if (rows && p.text) {
          const all = clampWords(before + p.text, letters(room), rows)
          out = { ...p, text: all.startsWith(before) ? all.slice(before.length) : clampWords(p.text, letters(room), rows) }
        }
        before += p.text || ''
        return out
      })
    }),
  }))
}

/* a line of linked names (`pack` rows, `packWide` from 80 cells) wraps whole names, each cut
   to one row; the names past its rows join the counted rest, "and N more" (`more`) */
function packLine(l: any[], room: number, wide: boolean): any[] {
  const w = letters(room)
  const rows = Math.max(1, ...l.map((p) => (wide ? p.packWide || p.pack : p.pack) || 0))
  const lead = l.filter((p) => !p.pack && !p.more)
  /* the separator after a name stays whole when the name is cut */
  const names = l.filter((p) => p.pack).map((p) => {
    const sep = (/[;,]?\s*$/.exec(p.text) as RegExpExecArray)[0]
    return { ...p, text: clampWords(p.text.slice(0, p.text.length - sep.length), w - sep.length, 1) + sep }
  })
  const counted = l.reduce((n, p) => n + (Number(p.more) || 0), 0)
  const fits = (ps: any[]) => {
    let row = 1, x = 0
    for (const p of ps) { const n = String(p.text).length; if (x && x + n > w) { row++; x = 0 } x += n }
    return row <= rows
  }
  for (let k = names.length; ; k--) {
    const left = names.length - k + counted
    const out = [...lead, ...names.slice(0, k), ...(left ? [{ text: 'and ' + left + ' more', more: left }] : [])]
    if (k <= Math.min(1, names.length) || fits(out)) return out
  }
}

/* Before the first read (a hot reload lost the memory). */
export function paneLoading(els: any): any {
  const { Box, Text } = els
  return <Box key="tracks"><Text dimColor>Reading the tracks...</Text></Box>
}
