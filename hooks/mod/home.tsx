/* The AskerDo pane: one pane
 * with five tabs, Home, Questions, Tracks, Settings and Guide, as text buttons, the board link beside
 * them on every tab; Home holds a copy of the band, then this project's activity as the
 * tray's console shows it, the filter widening it to every project. Drawn from the model
 * alone; index.ts owns the reads and the writes. */
import { PANE_TABS, PANE_TITLE, cellWidth, clampWords, fillGlyph, graphLegend, markPicture, paneMeasure, reviewPictures } from '../../lib/mod-core.mjs'
import { agentRow, linkLine, linkOver, pressFace, pressOver, wordLink } from './status.tsx'
import { FOLD_CELLS, fitWords, foldHead, liftPress, paneCells } from './fold.tsx'

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
  open?: (e: any) => (() => void) | null, versions?: { pc: string; board: string; behind: string }, guide?: () => void): any {
  const { Box, Text, Input, Button } = els
  const band = copy.filter(Boolean)
  const parts: any[] = [
    /* a board older than this PC says so first */
    versions && versions.behind ? <Box key="home-behind"><Text color="warning" wrap="wrap">{versions.behind}</Text></Box> : null,
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
  const rows = open ? am.rows.filter((r: any) => !r.done).map(row) : []
  const ended = am.rows.filter((r: any) => r.done)
  if (open && ended.length) rows.push(doneFold(els, ended, row, !!(done && done.open), () => { if (done) done.toggle() }, desk, Number(columns) > 0 ? Number(columns) : 200))
  return <Box key="agents" flexDirection="column" rowGap={1}>{[head, ...rows]}</Box>
}

/* the finished agents under one fold, its heading the count; shut, their
   jobs follow it cut at the row's end, as a Tracks section's names do */
function doneFold(els: any, ended: any[], row: (r: any) => any, open: boolean, toggle: () => void, desk: boolean, cols: number): any {
  const { Box, Text } = els
  const title = ended.length + ' done'
  const room = desk ? cols - FOLD_CELLS - paneCells(title, 600) - 1 : cols - cellWidth(title) - 4
  const names = ended.map((r: any) => r.job).join(', ')
  const rest = !open && room >= 10 ? [<Box key="agents-done-names" flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{desk ? fitWords(names, room) : clampWords(names, room, 1)}</Text></Box>] : []
  const head = foldHead(els, { key: 'agents-done-head', press: 'agents-done-fold', open, toggle, desk, cols, title: <Text weight="semibold">{title}</Text>, rest })
  return <Box key="agents-done" flexDirection="column" rowGap={1}>{[head, ...(open ? ended.map(row) : [])]}</Box>
}

/* the heading's line: Anthropic Sans 16 on 24 px; the pane's labeled buttons 32 px */
const HEAD_LINE = 24, BUTTON_LINE = 32
const headCells = (s: string) => paneMeasure(s, 16, 600) / 8.453
/* a pane button's cells: its words and padding, 12 px a side labeled, 6 px plain */
const buttonCells = (label: string, plain: boolean) => paneMeasure(label, 14, 400) / 8.453 + (plain ? 12 : 24) / 8.453

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

/* the held track's lines by default, a switch to the whole workstream; the desktop
   draws mod-core homeGraph's picture, the terminal one line per drawn line; the lines left out
   named with their state. Nothing to draw: one plain line why. The heading is the fold
   (the switch keeps its own presses), shut it keeps one line. */
export function graphTree(els: any, gm: any, onScope: (s: string) => void, surface?: string, fold?: { open: boolean; toggle: () => void; line: string; columns?: number },
  review?: (id: string | null) => void): any {
  const { Box, Text, Button, Svg } = els
  const desk = surface === 'desktop' && !!Svg
  const open = !fold || fold.open
  const cols = fold && Number(fold.columns) > 0 ? Number(fold.columns) : 200
  const title = <Text key="graph-title" weight="semibold" size="heading">Where we stand</Text>
  const rest: any[] = []
  /* with no track held there is no "mine" to switch to */
  let line = HEAD_LINE
  if (open && gm.lines.length && !gm.unheld) {
    let used = headCells('Where we stand') + 2
    for (const [id, label] of [['mine', "My track's lines"], ['all', 'Whole workstream']]) {
      const plain = id !== gm.scope
      used += buttonCells(label, plain) + 2
      /* a labeled button on the heading's first line makes it 32 px */
      if (!plain && used <= cols - FOLD_CELLS) line = BUTTON_LINE
      const b = plain ? <Button key={'graph-' + id} plain dimColor label={label} onPress={() => onScope(id)} />
        : <Button key={'graph-' + id} label={label} onPress={() => onScope(id)} />
      rest.push(fold ? liftPress(els, 'graph-lift-' + id, b, desk) : b)
    }
  }
  const sumRoom = cols - FOLD_CELLS - headCells('Where we stand') - 2
  if (!open && fold && fold.line) rest.push(<Box key="graph-sum" flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{desk ? fitWords(fold.line, sumRoom) : fold.line}</Text></Box>)
  const head = fold
    ? foldHead(els, { key: 'graph-head', press: 'fold-graph', open, toggle: fold.toggle, desk, cols, title, rest, wrap: open, line, gap: 2 })
    : <Box key="graph-head" flexDirection="row" columnGap={2} alignItems="center" flexWrap="wrap">{[title, ...rest]}</Box>
  const parts: any[] = [head]
  if (!open) return <Box key="graph" flexDirection="column" rowGap={1}>{parts}</Box>
  /* the workstreams the line names open their pages */
  const why = gm.why && Array.isArray(gm.whyParts) ? linkLine(els, gm.whyParts.map((p: any) => ({ ...p, tone: 'dim' })), 'graph-why', desk, false) : null
  if (gm.why) parts.push(why || <Box key="graph-why"><Text dimColor>{gm.why}</Text></Box>)
  const pic = surface === 'desktop' && Svg && gm.picture
  if (pic) {
    const p = gm.picture
    const zones = (p.hits || []).map((z: any) => zoneOver(els, z, review))
    parts.push(<Box key="graph-pic" flexShrink={0}><Svg source={p.source} alt={p.alt} width={p.width} height={p.height} />{zones}</Box>)
    if (gm.pressed) parts.push(reviewList(els, gm.pressed, () => { if (review) review(null) }, cols))
  } else {
    /* each line's track name opens its page */
    for (const l of gm.lines) {
      const rest = ': ' + [l.words, l.counts].filter(Boolean).join(', ')
      parts.push(l.url ? linkLine(els, [{ text: l.id + ' ' + l.name, href: l.url }, { text: rest }], 'gline-' + l.id, desk)
        : <Box key={'gline-' + l.id}><Text>{l.id + ' ' + l.name + rest}</Text></Box>)
    }
  }
  if (gm.off.length) {
    /* the workstream and each line left out open their pages */
    const ws = gm.workstream + (gm.workstreamName ? ' ' + gm.workstreamName : '')
    const off: any[] = [{ text: 'Also in ', tone: 'dim' }, { text: ws, tone: 'dim', href: gm.workstreamUrl || undefined }, { text: ', not drawn: ', tone: 'dim' }]
    gm.off.forEach((o: any, i: number) => {
      off.push({ text: o.id + ' ' + o.name, tone: 'dim', href: o.url || undefined })
      off.push({ text: (o.words ? ', ' + o.words : '') + (i < gm.off.length - 1 ? '; ' : '.'), tone: 'dim' })
    })
    parts.push(linkLine(els, off, 'graph-off', desk) || <Box key="graph-off"><Text dimColor>{off.map((p) => p.text).join('')}</Text></Box>)
  }
  if (pic) parts.push(legendTree(els, cols, gm.marks))
  return <Box key="graph" flexDirection="column" rowGap={1}>{parts}</Box>
}

/* the legend leads each meaning with the picture's own mark, packed into rows by the
   pane's width so an entry wraps whole; a row may still wrap should the measure run short */
function legendTree(els: any, cols: number, marks?: any): any {
  const { Box, Text, Svg } = els
  const rows: any[][] = [[]]
  let used = 0
  for (const m of graphLegend(marks)) {
    const cells = m.width / 8.453 + 1 + paneMeasure(m.words, 14, 400) / 8.453
    if (rows[rows.length - 1].length && used + 2 + cells > cols) { rows.push([]); used = 0 }
    used += (rows[rows.length - 1].length ? 2 : 0) + cells
    rows[rows.length - 1].push(
      <Box key={'legend-' + m.key} flexDirection="row" columnGap={1} alignItems="center" flexShrink={0}>
        <Box key={'legend-mark-' + m.key} flexShrink={0}><Svg source={m.source} alt={m.alt} width={m.width} height={m.height} /></Box>
        <Text key={'legend-words-' + m.key} dimColor>{m.words}</Text>
      </Box>)
  }
  return (
    <Box key="graph-legend" flexDirection="column">
      {rows.map((r, i) => <Box key={'legend-row-' + i} flexDirection="row" columnGap={2} alignItems="center" flexWrap="wrap">{r}</Box>)}
    </Box>
  )
}

/* a press laid over the picture where a name or a review's diamond is drawn (an Svg takes
   no press): a review's opens its list, the rest their board page; offsets by margins, in cells and lines */
const PX_CELL = 8.453, PX_LINE = 20
function zoneOver(els: any, z: any, review?: (id: string | null) => void): any {
  const { Box } = els
  const cells = z.w / PX_CELL
  const press = z.kind === 'review' ? (review ? pressOver(els, 'gzp-' + z.id, cells, () => review(z.id)) : null) : linkOver(els, 'gzl-' + z.kind + '-' + z.id, cells, z.href)
  if (!press) return null
  return (
    <Box key={'gz-' + z.kind + '-' + z.id + '-' + z.x + '-' + z.y} position="absolute" top={0} left={0} marginLeft={z.x / PX_CELL} marginTop={z.y / PX_LINE}
      width={cells} height={z.h / PX_LINE} overflow="hidden">{press}</Box>
  )
}

/* a pressed review's list under the map: its name opening its page, when it was done and how
   much it covered, the close X, then each covered task by id and name, the name its board page */
function reviewList(els: any, r: any, close: () => void, cols: number): any {
  const { Box, Text, Svg } = els
  const pics = reviewPictures()
  const n = r.covers.length
  const head = (
    <Box key="rvl-head" flexDirection="row" columnGap={1} alignItems="flex-start">
      <Box key="rvl-lead" flexShrink={0}><Svg source={pics.diamond.source} alt={pics.diamond.alt} width={20} height={20} /></Box>
      <Box key="rvl-words" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        <Box key="rvl-name" flexDirection="row" columnGap={1} flexWrap="wrap">
          <Text key="rvl-id" dimColor>{r.id}</Text>
          {r.url ? wordLink(els, 'rvl-link', r.url, clampWords(r.name, Math.max(12, cols - 12), 2), true) : <Text key="rvl-n" weight="semibold" wrap="wrap">{r.name}</Text>}
        </Box>
        <Text key="rvl-sum" dimColor wrap="wrap">{(r.day ? 'Done ' + r.day + ' · ' : '') + 'covered ' + n + ' finished code ' + (n === 1 ? 'task' : 'tasks')}</Text>
      </Box>
      {pressFace(els, 'rvl-close', <Svg source={pics.close.source} alt={pics.close.alt} width={16} height={16} />, pressOver(els, 'rvl-close-p', 2, close))}
    </Box>
  )
  const rows = r.covers.map((c: any) => {
    const p = markPicture('task', 'dim')
    const room = Math.max(12, cols - 8 - cellWidth(c.id))
    return (
      <Box key={'rvl-' + c.id} flexDirection="row" columnGap={1} alignItems="center" paddingLeft={3}>
        <Box key={'rvl-ic-' + c.id} flexShrink={0}><Svg source={p.source} alt={p.alt} width={p.width} height={p.height} /></Box>
        <Text key={'rvl-cid-' + c.id} dimColor>{c.id}</Text>
        {c.url ? wordLink(els, 'rvl-c-' + c.id, c.url, clampWords(c.name || c.id, room, 1), true) : <Text key={'rvl-cn-' + c.id} wrap="truncate-end">{c.name}</Text>}
      </Box>
    )
  })
  return <Box key={'rvl-' + r.id} flexDirection="column" rowGap={0.5} borderStyle="round" borderDimColor paddingX={1}>{[head, ...rows]}</Box>
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
