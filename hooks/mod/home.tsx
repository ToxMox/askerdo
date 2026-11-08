/* The AskerDo pane: one pane
 * with five tabs, Home, Questions, Tracks, Settings and Guide, as text buttons, the board link beside
 * them on every tab; Home holds a copy of the band, then this project's activity as the
 * tray's console shows it, the filter widening it to every project. Drawn from the model
 * alone; index.ts owns the reads and the writes. */
import { PANE_TABS, PANE_TITLE, cellWidth, clampWords, fillGlyph, markPicture, paneMeasure } from '../../lib/mod-core.mjs'
import { PRESS_LIT, agentRow, linkLine, linkOver, pressFace, pressOver, wordLink } from './status.tsx'
import { FOLD_CELLS, fitWords, foldHead, paneCells } from './fold.tsx'

export type PaneTab = 'home' | 'questions' | 'tracks' | 'settings' | 'guide'
export type TabCounts = { questions?: number; tracks?: number; settings?: number }

/* rows: feedRows' (day headings and lines), null before the first read; wide: every project's;
   seed: the text the filter field is drawn with, never the typed filter, which trails the typing */
export type FeedView = { rows: any[] | null; filter: string; seed?: string; wide: boolean; error?: string }

const OUT = '↗'

/* The tab row over the tab's body: the tab shown a default Button, the others plain and
   dim with their counts; a press redraws this same pane. A desktop's link lights grey */
export function askerdoPane(els: any, tab: PaneTab, counts: TabCounts, board: string | undefined, onTab: (t: PaneTab) => void, body: any, surface?: string): any {
  const { Box, Button } = els
  /* a tab never shrinks, so a narrow pane wraps the row rather than cutting a word */
  const tabs = PANE_TABS.map(([id, name]: any) => {
    const n = (counts as any)[id]
    const label = name + (Number.isFinite(n) ? ' ' + n : '')
    return (
      <Box key={'tabbox-' + id} flexShrink={0}>
        {id === tab
          ? <Button key={'tab-' + id} label={label} onPress={() => onTab(id)} />
          : <Button key={'tab-' + id} plain dimColor label={label} onPress={() => onTab(id)} />}
      </Box>
    )
  })
  const row: any[] = [<Box key="pane-tab-buttons" flexDirection="row" columnGap={1} rowGap={0.5} flexWrap="wrap" alignItems="center" flexShrink={1} minWidth={0}>{tabs}</Box>]
  if (board) row.push(wordLink(els, 'pane-board', board, 'board ' + OUT, surface === 'desktop'))
  return (
    <Box key="askerdo-pane" flexDirection="column" rowGap={1}>
      <Box key="pane-tabs" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} rowGap={0.5} flexWrap="wrap">{row}</Box>
      {body}
    </Box>
  )
}

/* Home: the band's copy in a rounded dim border (the pane has no band background), then
   the agents, where we stand, then the activity, newest first, a dim heading per day. */
/* open: a row's press into the pane's own view of its record, or null where the pane has none */
export function homeTree(els: any, copy: any[], feed: FeedView, onFilter: (v: string) => void, surface?: string, columns?: number, graph?: any, agents?: any,
  open?: (e: any) => (() => void) | null, versions?: { pc: string; board: string; behind: string }, guide?: () => void, drift?: { text: string; href?: string } | null): any {
  const { Box, Text, Input, Button } = els
  const band = copy.filter(Boolean)
  const parts: any[] = [
    /* a board older than this PC says so first */
    versions && versions.behind ? <Box key="home-behind"><Text color="warning" wrap="wrap">{versions.behind}</Text></Box> : null,
    /* what the project's pointers cite that drifted, read at the session's start */
    drift ? <Box key="home-drift" flexDirection="column"><Text color="warning" wrap="wrap">{drift.text}</Text>
      {drift.href ? wordLink(els, 'home-drift-open', drift.href, "the doctor's runs " + OUT, surface === 'desktop') : null}</Box> : null,
    <Box key="home-band" flexDirection="column" rowGap={1} borderStyle="round" borderDimColor paddingX={1}>
      {band.length ? band : <Text dimColor>Nothing open or waiting.</Text>}
    </Box>,
    /* the agents draw above where we stand */
    agents || null,
    graph || null,
    <Box key="feed-head" flexDirection="row" columnGap={2}>
      <Text weight="semibold" size="heading">Activity</Text>
      <Text dimColor>{feed.wide ? 'every project, newest first' : 'this project, newest first'}</Text>
    </Box>,
  ]
  /* a phone draws no field */
  if (Input) parts.push(<Input key="feed-filter" placeholder="filter by words, kind or id" value={feed.seed ?? feed.filter} onInput={onFilter} onSubmit={onFilter} />)
  const lines: any[] = []
  if (feed.error) lines.push(<Box key="feed-error"><Text dimColor>{feed.error}</Text></Box>)
  else if (!feed.rows) lines.push(<Box key="feed-loading"><Text dimColor>Reading the activity...</Text></Box>)
  else if (!feed.rows.length) {
    lines.push(<Box key="feed-empty"><Text dimColor>{feed.wide ? 'Nothing in any project matches that.' : 'Nothing has moved in this project yet; type in the filter to see every project.'}</Text></Box>)
  }
  for (const r of feed.rows || []) lines.push(r.heading ? dayRow(els, r.heading) : feedRow(els, r, surface, columns, open))
  parts.push(<Box key="feed" flexDirection="column" rowGap={1}>{lines}</Box>)
  /* the one pointer at the Guide tab, beside the version it describes */
  if (guide) parts.push(<Box key="home-guide" flexDirection="row"><Button key="home-guide-open" plain dimColor label="How it all works: the Guide tab" onPress={guide} /></Box>)
  if (versions) parts.push(<Box key="home-versions"><Text dimColor wrap="wrap">{versions.pc + '; ' + versions.board}</Text></Box>)
  return <Box key="home" flexDirection="column" rowGap={1}>{parts}</Box>
}

/* the agents in flight, above Activity, drawn only while one runs. Shut, one
   line: the deepest running agent's bar, the counts and its depth; open, the counts and a
   row per running agent, then the finished ones dimmed in their own fold, shut by default.
   the heading is the fold; index.ts keeps which. */
export function agentsTree(els: any, am: any, open: boolean, onToggle: () => void, surface?: string, columns?: number, done?: { open: boolean; toggle: () => void }): any {
  const { Box, Text, Svg } = els
  const desk = surface === 'desktop' && !!Svg
  const counts = am.running + ' running' + (am.done ? ', ' + am.done + ' done' : '')
  const deep = open ? null : am.deepest
  const m = deep && desk ? deep.meter : null
  const glyph = deep && !m ? fillGlyph(deep.pct) : ''
  const barCells = m ? Math.ceil(m.width / 8) + 2 : glyph ? cellWidth(glyph) + 2 : 0
  /* the heading, its gaps and the fold's ring or arrow; the desktop's by the pane's own widths */
  const room = !(Number(columns) > 0) ? 0 : desk ? Number(columns) - FOLD_CELLS - headCells('Agents') - 2 - (m ? m.width / 8.453 + 2 : 0)
    : Number(columns) - cellWidth('Agents') - FOLD_CELLS - 6 - barCells
  const fit = (s: string) => (desk ? fitWords(s, room) : clampWords(s, room, 1))
  /* the longest running time where the whole line has the room, else the counts and depth */
  const timed = am.timed || am.summary
  const line = open ? counts : room > 0 ? (fit(timed) === timed ? timed : fit(am.summary)) : timed
  const bar = m ? <Box key="agents-deep" flexShrink={0}><Svg source={m.source} alt={m.alt} width={m.width} height={m.height} /></Box>
    : glyph ? <Box key="agents-deep" flexShrink={0}><Text dimColor>{glyph}</Text></Box> : null
  const head = foldHead(els, { key: 'agents-head', press: 'agents-toggle', open, toggle: onToggle, desk, cols: Number(columns) > 0 ? Number(columns) : 200, line: HEAD_LINE, gap: 2,
    title: <Text weight="semibold" size="heading">Agents</Text>,
    rest: [bar, <Box key="agents-sum" flexGrow={1} flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{line}</Text></Box>] })
  const row = (r: any) => agentRow(els, desk ? r : { ...r, meter: undefined }, 'agent-', desk ? undefined : fillGlyph(r.pct))
  /* a running dispatch's own agents stay under it; a finished one's go into the fold with it */
  const rows = open ? am.rows.filter((r: any) => !r.ended).map(row) : []
  const ended = am.rows.filter((r: any) => r.ended)
  if (open && ended.length) rows.push(doneFold(els, ended, row, !!(done && done.open), () => { if (done) done.toggle() }, desk, Number(columns) > 0 ? Number(columns) : 200))
  return <Box key="agents" flexDirection="column" rowGap={1}>{[head, ...rows]}</Box>
}

/* the finished agents under one fold, its heading the count; shut, their
   jobs follow it cut at the row's end, as a Tracks section's names do. The session's dispatches alone */
function doneFold(els: any, ended: any[], row: (r: any) => any, open: boolean, toggle: () => void, desk: boolean, cols: number): any {
  const { Box, Text } = els
  const tops = ended.filter((r: any) => !r.under)
  const title = tops.length + ' done'
  const room = desk ? cols - FOLD_CELLS - paneCells(title, 600) - 1 : cols - cellWidth(title) - 4
  const names = tops.map((r: any) => r.job).join(', ')
  const rest = !open && room >= 10 ? [<Box key="agents-done-names" flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{desk ? fitWords(names, room) : clampWords(names, room, 1)}</Text></Box>] : []
  const head = foldHead(els, { key: 'agents-done-head', press: 'agents-done-fold', open, toggle, desk, cols, title: <Text weight="semibold">{title}</Text>, rest })
  return <Box key="agents-done" flexDirection="column" rowGap={1}>{[head, ...(open ? ended.map(row) : [])]}</Box>
}

/* the heading's line: Anthropic Sans 16 on 24 px */
const HEAD_LINE = 24
const headCells = (s: string) => paneMeasure(s, 16, 600) / 8.453

/* The shut heading's one line: the held track's counts from the facts its tooltip reads,
   for example "TR-4: 7 open, 1 unheld, 90 done"; with no track held, the lines drawn, else why not */
export function standLine(held: any, gm: any): string {
  if (held && held.id) {
    const n: string[] = []
    if (Number.isFinite(held.total) && Number.isFinite(held.done)) n.push(Math.max(0, held.total - held.done) + ' open')
    if (held.running) n.push(held.running + ' running')
    if (held.stale && held.stale.length) n.push(held.stale.length + ' unheld')
    if (held.ready) n.push(held.ready + ' ready')
    if (Number.isFinite(held.done)) n.push(held.done + ' done')
    return held.id + (n.length ? ': ' + n.join(', ') : '')
  }
  if (gm.lines.length) return (gm.workstream ? gm.workstream + ': ' : '') + gm.lines.length + (gm.lines.length === 1 ? ' line' : ' lines')
  return gm.why || ''
}

/* mod-core homeGraph's redrawn picture as the approved mock's pane frame draws it:
   the views pair on its own row, the crumbs, the since line, the picture with a press laid over
   each thing it draws, the selection's strip, the legend. The terminal draws a line a track.
   Nothing to draw: one plain line why. The heading is the fold, shut it keeps one line.
   press: what an act does in the pane, else null and its href opens as a link; fold.inbox: the inbox's own fold */
export function graphTree(els: any, gm: any, press: (a: any) => (() => void) | null, surface?: string,
  fold?: { open: boolean; toggle: () => void; line: string; columns?: number; inbox?: { open: boolean; toggle: () => void } }): any {
  const { Box, Text, Button, Svg } = els
  const desk = surface === 'desktop' && !!Svg
  const open = !fold || fold.open
  const cols = fold && Number(fold.columns) > 0 ? Number(fold.columns) : 200
  const title = <Text key="graph-title" weight="semibold" size="heading">Where we stand</Text>
  const rest: any[] = []
  const sumRoom = cols - FOLD_CELLS - headCells('Where we stand') - 2
  if (!open && fold && fold.line) rest.push(<Box key="graph-sum" flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{desk ? fitWords(fold.line, sumRoom) : fold.line}</Text></Box>)
  const head = fold
    ? foldHead(els, { key: 'graph-head', press: 'fold-graph', open, toggle: fold.toggle, desk, cols, title, rest, wrap: open, line: HEAD_LINE, gap: 2 })
    : <Box key="graph-head" flexDirection="row" columnGap={2} alignItems="center" flexWrap="wrap">{[title, ...rest]}</Box>
  const parts: any[] = [head]
  if (!open) return <Box key="graph" flexDirection="column" rowGap={1}>{parts}</Box>
  const pic = desk && gm.picture
  /* the mock's row of its own under the heading: the held track's lines, the whole workstream */
  if (pic && (gm.views || []).length) {
    parts.push(<Box key="graph-views" flexDirection="row" columnGap={1} rowGap={0.5} flexWrap="wrap" alignItems="center">
      {gm.views.map((v: any) => {
        const go = press(v.act) || (() => {})
        return v.on ? <Button key={'graph-' + v.key} label={v.label} onPress={go} /> : <Button key={'graph-' + v.key} plain dimColor label={v.label} onPress={go} />
      })}
    </Box>)
  }
  /* the workstreams the line names open their pages */
  const why = gm.why && Array.isArray(gm.whyParts) ? linkLine(els, gm.whyParts.map((p: any) => ({ ...p, tone: 'dim' })), 'graph-why', desk, false) : null
  if (gm.why) parts.push(why || <Box key="graph-why"><Text dimColor wrap="wrap">{gm.why}</Text></Box>)
  if (pic && (gm.crumbs || []).length) parts.push(crumbRow(els, gm.crumbs, press))
  if (gm.since) parts.push(<Box key="graph-since"><Text dimColor wrap="wrap">{'Since your last look, ' + gm.since.when + ': ' + gm.since.words}</Text></Box>)
  if (pic) {
    const p = gm.picture
    /* the ground's press first, so every zone lies over it, and each zone in the order drawn */
    const ground = p.clear && press(p.clear)
    const zones = [ground ? zoneOver(els, { k: 'ground', x: 0, y: 0, w: p.width, h: p.height }, ground, '') : null,
      ...(p.zones || []).map((z: any) => zoneOver(els, z, press(z.act), z.act && z.act.href))]
    parts.push(<Box key="graph-pic" flexShrink={0}><Svg source={p.source} alt={p.alt} width={p.width} height={p.height} />{zones}</Box>)
    if (gm.more) parts.push(gm.more.href ? wordLink(els, 'graph-more', gm.more.href, gm.more.words + ' ' + OUT, desk) : <Box key="graph-more"><Text dimColor>{gm.more.words}</Text></Box>)
    if (gm.inbox) parts.push(inboxTree(els, gm.inbox, fold && fold.inbox, desk, cols))
    if (gm.strip) parts.push(stripTree(els, gm.strip, press))
    if ((gm.legend || []).length) parts.push(legendTree(els, cols, gm.legend))
  } else {
    /* each line's track name opens its page */
    for (const l of gm.lines) {
      const rest = ': ' + [l.words, l.counts].filter(Boolean).join(', ')
      parts.push(l.url ? linkLine(els, [{ text: l.id + ' ' + l.name, href: l.url }, { text: rest }], 'gline-' + l.id, desk)
        : <Box key={'gline-' + l.id}><Text>{l.id + ' ' + l.name + rest}</Text></Box>)
    }
    if (gm.inbox) parts.push(inboxTree(els, gm.inbox, fold && fold.inbox, desk, cols))
  }
  return <Box key="graph" flexDirection="column" rowGap={1}>{parts}</Box>
}

/* the workstream's loose tasks in the board's words, amber once stalled: a fold listing each
   task, its id opening its page as the feed's does; from a board that sends no list, the line opens
   the board's inbox panel. Under each task its wake, amber once due, and the count of the due */
function inboxTree(els: any, ib: any, fold: { open: boolean; toggle: () => void } | undefined, desk: boolean, cols: number): any {
  const { Box, Text } = els
  const ink = ib.warn ? { color: 'warning' } : null
  const due = ib.due || ''
  if (!ib.tasks || !fold) {
    const line = ib.href ? linkLine(els, [{ text: ib.count, href: ib.href, tone: 'sky' }, { text: due, tone: 'amber' }, { text: ib.rest, tone: ib.warn ? 'amber' : 'dim' }], 'graph-inbox', desk) : null
    return line || <Box key="graph-inbox"><Text wrap="wrap"><Text {...(ink || {})}>{ib.count}</Text>{due ? <Text color="warning">{due}</Text> : null}<Text {...(ink || { dimColor: true })}>{ib.rest}</Text></Text></Box>
  }
  const words = ib.count + due + ib.rest
  const title = <Text wrap="wrap"><Text weight="semibold" {...(ink || {})}>{ib.count}</Text>{due ? <Text weight="semibold" color="warning">{due}</Text> : null}<Text {...(ink || { dimColor: true })}>{ib.rest}</Text></Text>
  /* semibold runs wider than the measure, so the title wraps before it would push the ring out */
  const head = foldHead(els, { key: 'graph-inbox-head', press: 'fold-inbox', open: fold.open, toggle: fold.toggle, desk, cols, title, titleCells: paneCells(words, 600) + 1 })
  const rows = fold.open ? ib.tasks.map((t: any) => {
    const line = t.href ? linkLine(els, [{ text: t.id, href: t.href, tone: 'sky' }, { text: ' ' + t.name }], 'graph-inbox-' + t.id, desk)
      : <Box key={'graph-inbox-' + t.id}><Text wrap="wrap"><Text dimColor>{t.id}</Text>{' ' + t.name}</Text></Box>
    if (!t.wake) return line
    const wake = <Box key={'graph-inbox-wake-' + t.id}><Text wrap="wrap" {...(t.due ? { color: 'warning' } : { dimColor: true })}>{t.wake}</Text></Box>
    return <Box key={'graph-inbox-row-' + t.id} flexDirection="column">{[line, wake]}</Box>
  }) : []
  return <Box key="graph-inbox" flexDirection="column" rowGap={0.5}>{[head, ...rows]}</Box>
}

/* the crumbs as presses in the link's blue, the current one and the marks between them secondary */
function crumbRow(els: any, crumbs: any[], press: (a: any) => (() => void) | null): any {
  const { Box, Text } = els
  const row: any[] = []
  crumbs.forEach((c: any, i: number) => {
    if (i) row.push(<Box key={'crumb-sep-' + i} flexShrink={0}><Text dimColor>›</Text></Box>)
    const go = c.act ? press(c.act) : null
    row.push(go ? pressFace(els, 'crumb-' + i, <Text color="suggestion">{c.words}</Text>, pressOver(els, 'crumbp-' + i, cellWidth(c.words), go))
      : <Box key={'crumb-' + i} flexShrink={0}><Text dimColor>{c.words}</Text></Box>)
  })
  return <Box key="graph-crumbs" flexDirection="row" columnGap={1} rowGap={0.5} flexWrap="wrap" alignItems="center">{row}</Box>
}

/* the mock's pdet: the selection's name, its chips, its facts, then its acts, the first primary */
function stripTree(els: any, s: any, press: (a: any) => (() => void) | null): any {
  const { Box, Text, Button } = els
  const k = String(s.key)
  const rows: any[] = [<Box key="strip-title"><Text weight="semibold" wrap="wrap">{s.title}</Text></Box>]
  if (s.chips.length) {
    const chips: any[] = []
    s.chips.forEach((c: any, i: number) => {
      if (i) chips.push(<Text key={'chip-sep-' + i} dimColor>{' · '}</Text>)
      chips.push(c.warn ? <Text key={'chip-' + i} color="warning">{c.words}</Text> : <Text key={'chip-' + i} dimColor>{c.words}</Text>)
    })
    rows.push(<Box key="strip-chips"><Text wrap="wrap">{chips}</Text></Box>)
  }
  s.facts.forEach((f: any, i: number) => {
    const [first, ...more] = f.lines.length ? f.lines : ['']
    rows.push(<Box key={'strip-fact-' + i} flexDirection="column">
      <Text wrap="wrap"><Text dimColor>{f.label + ': '}</Text>{String(first)}</Text>
      {more.map((l: any, j: number) => <Text key={'strip-fact-' + i + '-' + j} wrap="wrap">{String(l)}</Text>)}
    </Box>)
  })
  const acts = s.acts.map((a: any, i: number) => {
    const key = 'strip-act-' + i
    const primary = a.primary ? { variant: 'primary' } : {}
    const go = press(a.act)
    if (go) return <Button key={key} label={a.label} onPress={go} {...primary} />
    const href = a.act && a.act.href
    if (!href) return null
    /* no API opens a page from a press: a link laid over the button's face does */
    return <Box key={key} flexShrink={0}><Button key={key + '-face'} label={a.label} onPress={() => {}} {...primary} />{linkOver(els, key + '-link', cellWidth(a.label) + 3, href)}</Box>
  }).filter(Boolean)
  if (acts.length) rows.push(<Box key="strip-acts" flexDirection="row" columnGap={1} rowGap={0.5} flexWrap="wrap" marginTop={0.5}>{acts}</Box>)
  return <Box key={'graph-strip-' + k} flexDirection="column" rowGap={0.5} borderStyle="round" borderDimColor paddingX={1}>{rows}</Box>
}

/* the legend leads each meaning with the picture's own mark, packed into rows by the
   pane's width so an entry wraps whole; its words come in lines that fit the pane, the
   mark on the first, and an entry may still shrink and wrap should the measure run short */
function legendTree(els: any, cols: number, legend: any[]): any {
  const { Box, Text, Svg } = els
  const rows: any[][] = [[]]
  let used = 0
  for (const m of legend) {
    const lines: string[] = Array.isArray(m.lines) && m.lines.length ? m.lines : [m.words]
    const cells = Number(m.cells) || m.width / PX_CELL + 1 + paneMeasure(m.words, 14, 400) / PX_CELL
    if (rows[rows.length - 1].length && used + 2 + cells > cols) { rows.push([]); used = 0 }
    used += (rows[rows.length - 1].length ? 2 : 0) + cells
    const tall = lines.length > 1
    rows[rows.length - 1].push(
      <Box key={'legend-' + m.key} flexDirection="row" columnGap={1} alignItems={tall ? 'flex-start' : 'center'} flexShrink={1} minWidth={0}>
        <Box key={'legend-mark-' + m.key} flexShrink={0} {...(tall ? { marginTop: Math.max(0, PX_LINE - m.height) / 2 / PX_ROW } : {})}>
          <Svg source={m.source} alt={m.alt} width={m.width} height={m.height} />
        </Box>
        <Box key={'legend-words-' + m.key} flexDirection="column" flexShrink={1} minWidth={0}>
          {lines.map((l, i) => <Text key={'legend-line-' + m.key + '-' + i} dimColor wrap="wrap">{l}</Text>)}
        </Box>
      </Box>)
  }
  return (
    <Box key="graph-legend" flexDirection="column">
      {rows.map((r, i) => <Box key={'legend-row-' + i} flexDirection="row" columnGap={2} alignItems="center" flexWrap="wrap">{r}</Box>)}
    </Box>
  )
}

/* a press laid over the picture where a thing is drawn (an Svg takes no press): its act
   in the pane, else a link to its page; offsets by margins, across in cells, down in the engine's
   half-line rows (desktop-capabilities: a Box's vertical margin), the height in lines.
   a thing's zone lights grey on hover as every press does; the ground's clear does not */
const PX_CELL = 8.453, PX_LINE = 20, PX_ROW = PX_LINE / 2
function zoneOver(els: any, z: any, go: (() => void) | null, href?: string): any {
  const { Box } = els
  if (!go && !href) return null
  const cells = z.w / PX_CELL
  const id = z.k + '-' + z.x + '-' + z.y
  const face = go ? pressOver(els, 'gzp-' + id, cells, go) : linkOver(els, 'gzl-' + id, cells, href as string)
  const lit = z.k === 'ground' ? {} : { hover: PRESS_LIT.hover }
  return (
    <Box key={'gz-' + id} position="absolute" top={0} left={0} marginLeft={z.x / PX_CELL} marginTop={z.y / PX_ROW}
      width={cells} height={z.h / PX_LINE} overflow="hidden" {...lit}>{face}</Box>
  )
}

function dayRow(els: any, label: string): any {
  const { Box, Text } = els
  return <Box key={'day-' + label}><Text dimColor weight="semibold">{label}</Text></Box>
}

/* the cells a row spends beside its name: the picture and its gap, and two gaps */
const ICON_CELLS = 3
/* semibold runs wider than the measured cell */
const BOLD_SLACK = 2

/* the name opens what the id opens; the desktop's press laid over the clamped words */
function nameFace(els: any, k: string, name: string, act: (() => void) | null, href: string, desk: boolean, Button: any, Link: any): any {
  const { Text } = els
  const face = <Text weight="semibold" wrap="truncate-end">{name}</Text>
  if (!name || (!act && !href)) return face
  if (desk) return pressFace(els, 'fnamef-' + k, face, act ? pressOver(els, 'fnamep-' + k, cellWidth(name), act) : linkOver(els, 'fnamel-' + k, cellWidth(name), href))
  return act ? <Button key={'fnamep-' + k} plain onPress={act}>{face}</Button> : <Link key={'fnamel-' + k} href={href}>{face}</Link>
}

/* One line in the console's two rows: the kind's picture (desktop), the id and the name as the
   record's press (the pane's own view, else its board page), the time; under them what happened and where. */
function feedRow(els: any, e: any, surface?: string, columns?: number, open?: (e: any) => (() => void) | null): any {
  const { Box, Text, Svg, Button, Link } = els
  const desk = surface === 'desktop'
  const k = e.at
  let icon: any = null
  if (surface === 'desktop' && Svg) {
    const p = markPicture(e.kind, 'dim')
    icon = <Box key={'fkind-' + k} flexShrink={0}><Svg source={p.source} alt={p.alt} width={p.width} height={p.height} /></Box>
  }
  const act = open ? open(e) : null
  /* a linked id lights as every press does */
  const id = act
    ? (desk ? pressFace(els, 'fid-' + k, <Text color="suggestion">{e.id}</Text>, pressOver(els, 'fidp-' + k, cellWidth(e.id), act))
      : <Box key={'fid-' + k} flexShrink={0}><Button key={'fidp-' + k} plain label={e.id} onPress={act} /></Box>)
    : e.href ? wordLink(els, 'fid-' + k, e.href, e.id, desk) : <Box key={'fid-' + k} flexShrink={0}><Text dimColor>{e.id}</Text></Box>
  /* a name past the pane's edge ends at a word with an ellipsis */
  const room = Number(columns) > 0 ? Number(columns) - (icon ? ICON_CELLS : 0) - cellWidth(e.id) - cellWidth(e.time || '') - 2 - BOLD_SLACK : 0
  const name = room > 0 ? clampWords(e.name, room, 1) : e.name
  /* the line below clamps too, or a long workstream name widens the row past the pane and cuts the time */
  const whatRoom = Number(columns) > 0 ? Number(columns) - (icon ? ICON_CELLS : 0) - 2 : 0
  const what = whatRoom > 0 ? clampWords(e.what, whatRoom, 1) : e.what
  return (
    <Box key={'feed-' + k} flexDirection="row" columnGap={1}>
      {icon}
      <Box key={'fbody-' + k} flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box key={'fhead-' + k} flexDirection="row" columnGap={1}>
          {id}
          <Box key={'fname-' + k} flexGrow={1} flexShrink={1}>{nameFace(els, k, name, act, e.href, desk, Button, Link)}</Box>
          <Box key={'ftime-' + k} flexShrink={0}><Text dimColor tabular>{e.time}</Text></Box>
        </Box>
        <Box key={'fwhat-' + k}><Text dimColor wrap="truncate-end">{what}</Text></Box>
      </Box>
    </Box>
  )
}

/* the session's folder (its root), whether it is a linked worktree, and its branch
   (a detached head's short hash; null outside git) */
export type Where = { root: string; worktree?: boolean; branch?: string | null }

const WORKTREE = ' worktree'
const SEP = ' · '
const BS = String.fromCharCode(92)

/* the folder's name and its parent, in the path's own separators (backslashes on Windows) */
export function whereParts(root: string): { name: string; parent: string } {
  const back = /^[a-z]:/i.test(root) || root.includes(BS)
  const p = root.split(BS).join('/').replace(/\/+/g, '/').replace(/(.)\/$/, '$1')
  const i = p.lastIndexOf('/')
  const name = i >= 0 && i < p.length - 1 ? p.slice(i + 1) : p
  let parent = i > 0 ? p.slice(0, i) : i === 0 ? '/' : ''
  if (/^[a-z]:$/i.test(parent)) parent += '/'
  return { name, parent: back ? parent.split('/').join(BS) : parent }
}

/* the header's 14 px Anthropic Sans in px (headless Edge with the app's woff2); the
   header keeps an en space whole (white-space:nowrap collapses only ASCII runs) */
const EN = String.fromCharCode(0x2002)
const FACT_GAP = EN + EN
function headPx(s: string): number {
  let px = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) as number
    px += c > 0xffff ? 19.2 : ch === EN ? 7 : ch === ' ' ? 3 : /[A-Z]/.test(ch) ? 9.7 : /[0-9]/.test(ch) ? 8.5
      : ch === '(' || ch === ')' ? 5.7 : ch === BS ? 4.7 : ch === ':' ? 3.3 : ch === '-' ? 5 : 7.5
  }
  return px
}
/* the head's room past its chrome (pads, close and menu: about 96 px of a tile 42 px wider than
   its body, desktop-capabilities 2f), from the body's 8.453 px columns */
const titleRoom = (cols: number) => cols * 8.453 + 42 - 96

/* the pane's title, the folder's name with its parent in brackets, then its branch,
   each fact led by its emoji and parted by wide gaps; fitted to `cols`: the brackets drop first,
   then the end (the branch) cuts. The app's roster takes 512 at most */
export function paneTitle(w: Where | null | undefined, cols?: number): string {
  if (!w || !w.root) return PANE_TITLE
  const { name, parent } = whereParts(w.root)
  const branch = w.branch ? FACT_GAP + '🌿 ' + w.branch : ''
  const cap = (t: string) => { const c = [...t]; return c.length > 200 ? c.slice(0, 199).join('') + '…' : t }
  const short = cap(PANE_TITLE + FACT_GAP + '📁 ' + name + branch)
  const full = parent && parent !== name ? cap(PANE_TITLE + FACT_GAP + '📁 ' + name + ' (' + parent + ')' + branch) : short
  if (!(Number(cols) > 0)) return full
  const room = titleRoom(Number(cols))
  if (headPx(full) <= room) return full
  if (headPx(short) <= room) return short
  const c = [...short]
  let n = c.length - 1
  while (n > PANE_TITLE.length && headPx(c.slice(0, n).join('').trimEnd() + '…') > room) n--
  return n > PANE_TITLE.length ? c.slice(0, n).join('').trimEnd() + '…' : PANE_TITLE
}

/* the same two facts as one group of the AskerDo button's tooltip, whole (the card wraps) */
export function whereFacts(w: Where | null | undefined): any[] | null {
  if (!w || !w.root) return null
  const { name, parent } = whereParts(w.root)
  const dir = [{ text: name }, ...(w.worktree ? [{ text: WORKTREE, tone: 'dim' }] : []), ...(parent ? [{ text: SEP + parent, tone: 'dim' }] : [])]
  const facts: any[] = [{ lead: { kind: 'icon', icon: 'ldDir', tone: 'dim', lead: true }, lines: [dir] }]
  if (w.branch) facts.push({ lead: { kind: 'icon', icon: 'ldBranch', tone: 'dim', lead: true }, lines: [[{ text: w.branch }]] })
  return facts
}
