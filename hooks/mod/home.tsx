/* The AskerDo pane: one pane
 * with five tabs, Home, Questions, Tracks, Settings and Guide, as text buttons, the board link beside
 * them on every tab; Home holds a copy of the band, then this project's activity as the
 * tray's console shows it, the filter widening it to every project. Drawn from the model
 * alone; index.ts owns the reads and the writes. */
import { PANE_TABS, PANE_TITLE, UNREAD_WORDS, cellWidth, clampWords, fillGlyph, flightWords, kindPicture, markPicture, paneMeasure, textMeasure } from '../../lib/mod-core.mjs'
import { AGENTS_LINE, AGENT_LINE, PRESS_LIT, PRESS_RIM, agentRow, linkLine, linkOver, liveClient, pressFace, pressInside, pressOver, wordLink } from './status.tsx'
import { CELL_NARROW, FOLD_CELLS, fitWords, foldHead, paneCells } from './fold.tsx'
import { HOLD_WORDS } from '../../server/web/draw.mjs'

export type PaneTab = 'home' | 'questions' | 'tracks' | 'settings' | 'guide'
export type TabCounts = { questions?: number; tracks?: number; settings?: number }

/* rows: feedRows' (day headings and lines), null before the first read; wide: every project's;
   seed: the text the filter field is drawn with, never the typed filter, which trails the typing */
export type FeedView = { rows: any[] | null; filter: string; seed?: string; wide: boolean; error?: string; more?: number }
/* what a drawing past the mod's ceiling leaves out: the finished rows, and the running rows past a count */
export type FlightCut = { done?: boolean; run?: number }

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
  /* the press rim's light reaches past the link's face; at the row's right end it needs that room inside the pane */
  if (board) row.push(surface === 'desktop'
    ? <Box key="pane-board-room" flexShrink={0} marginRight={-PRESS_RIM.marginX}>{wordLink(els, 'pane-board', board, 'board ' + OUT, true)}</Box>
    : wordLink(els, 'pane-board', board, 'board ' + OUT, false))
  return (
    <Box key="askerdo-pane" flexDirection="column" rowGap={1}>
      <Box key="pane-tabs" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} rowGap={0.5} flexWrap="wrap">{row}</Box>
      {body}
    </Box>
  )
}

/* in the band's copy when the band read's questions were not a list, so Home is not read as empty */
export function unreadLine(els: any): any {
  const { Box, Text } = els
  return <Box key="home-unread"><Text color="warning" wrap="wrap">{UNREAD_WORDS}</Text></Box>
}

/* Home's top: the warnings, then the band's copy in its border */
function homeTop(els: any, copy: any[], behind?: string, drift?: { text: string; href?: string } | null, surface?: string): any[] {
  const { Box, Text } = els
  const band = copy.filter(Boolean)
  return [
    /* a board older than this PC says so first */
    behind ? <Box key="home-behind"><Text color="warning" wrap="wrap">{behind}</Text></Box> : null,
    /* what the project's pointers cite that drifted, read at the session's start */
    drift ? <Box key="home-drift" flexDirection="column"><Text color="warning" wrap="wrap">{drift.text}</Text>
      {drift.href ? wordLink(els, 'home-drift-open', drift.href, "the doctor's runs " + OUT, surface === 'desktop') : null}</Box> : null,
    <Box key="home-band" flexDirection="column" rowGap={1} borderStyle="round" borderDimColor paddingX={1}>
      {band.length ? band : <Text dimColor>Nothing open or waiting.</Text>}
    </Box>,
  ]
}

/* Home: the band's copy in a rounded dim border (the pane has no band background), then
   the agents, where we stand, then the activity, newest first, a dim heading per day. */
/* open: a row's press into the pane's own view of its record, or null where the pane has none */
export function homeTree(els: any, copy: any[], feed: FeedView, onFilter: (v: string) => void, surface?: string, columns?: number, graph?: any, agents?: any,
  open?: (e: any) => (() => void) | null, versions?: { pc: string; board: string; behind: string }, guide?: () => void, drift?: { text: string; href?: string } | null): any {
  const { Box } = els
  const parts: any[] = [
    ...homeTop(els, copy, versions && versions.behind, drift, surface),
    /* the agents draw above where we stand */
    agents || null,
    graph || null,
    ...feedParts(els, feed, onFilter, surface, columns, open, versions, guide, feed.more || 0),
  ]
  return <Box key="home" flexDirection="column" rowGap={1}>{parts}</Box>
}

/* Activity: its heading, the filter, the rows, the guide line and the versions */
function feedParts(els: any, feed: FeedView, onFilter: (v: string) => void, surface?: string, columns?: number,
  open?: (e: any) => (() => void) | null, versions?: { pc: string; board: string; behind: string }, guide?: () => void, more = 0): any[] {
  const { Box, Text, Input, Button } = els
  const parts: any[] = [
    /* the heading stays whole; its note takes the narrow row's squeeze */
    <Box key="feed-head" flexDirection="row" columnGap={2}>
      <Box key="feed-title" flexShrink={0}><Text weight="semibold" size="heading">Activity</Text></Box>
      <Box key="feed-note" flexShrink={1} minWidth={0}><Text dimColor>{feed.wide ? 'every project, newest first' : 'this project, newest first'}</Text></Box>
    </Box>,
  ]
  /* a phone draws no field */
  if (Input) parts.push(<Input key="feed-filter" placeholder="filter by words, kind or id" value={feed.seed ?? feed.filter} onInput={onFilter} onSubmit={onFilter} />)
  const lines: any[] = []
  if (feed.error) lines.push(<Box key="feed-error"><Text dimColor>{feed.error}</Text></Box>)
  else if (!feed.rows) lines.push(<Box key="feed-loading"><Text dimColor>Reading the activity...</Text></Box>)
  else if (!feed.rows.length && !(more > 0)) {
    lines.push(<Box key="feed-empty"><Text dimColor>{feed.wide ? 'Nothing in any project matches that.' : 'Nothing has moved in this project yet; type in the filter to see every project.'}</Text></Box>)
  }
  for (const r of feed.rows || []) lines.push(r.heading ? dayRow(els, r.heading) : feedRow(els, r, surface, columns, open))
  if (more > 0) lines.push(<Box key="feed-more"><Text dimColor wrap="wrap">{more + ' older rows are not drawn here; the filter finds them.'}</Text></Box>)
  parts.push(<Box key="feed" flexDirection="column" rowGap={1}>{lines}</Box>)
  /* the one pointer at the Guide tab, beside the version it describes */
  if (guide) parts.push(<Box key="home-guide" flexDirection="row"><Button key="home-guide-open" plain dimColor label="How it all works: the Guide tab" onPress={guide} /></Box>)
  if (versions) parts.push(<Box key="home-versions"><Text dimColor wrap="wrap">{versions.pc + '; ' + versions.board}</Text></Box>)
  return parts
}

/* the agents in flight, above Activity, drawn only while one runs. Shut, one
   line: the deepest running agent's bar, the counts and its depth; open, the counts and a
   row per running agent, then the finished ones dimmed in their own fold, shut by default.
   the heading is the fold; index.ts keeps which. */
export function agentsTree(els: any, am: any, open: boolean, onToggle: () => void, surface?: string, columns?: number, done?: { open: boolean; toggle: () => void }, stop?: StopView, cut?: FlightCut): any {
  const { Box, Text, Svg } = els
  const desk = surface === 'desktop' && !!Svg
  const cols = Number(columns) > 0 ? Number(columns) : 0
  const p = agentsHeadLive(am, open, desk, columns)
  const b = p.bar
  /* the deepest agent's bar and the line turn over in place together where a Client draws them */
  const live = liveClient(els, AGENTS_LINE, p, '100%')
  const bar = live || !b ? null : b.pic ? <Box key="agents-deep" flexShrink={0}><Svg source={b.pic.source} alt={b.pic.alt} width={b.pic.width} height={b.pic.height} /></Box>
    : <Box key="agents-deep" flexShrink={0}><Text {...b.ink}>{b.glyph}</Text></Box>
  const head = foldHead(els, { key: 'agents-head', press: 'agents-toggle', open, toggle: onToggle, desk, cols: Number(columns) > 0 ? Number(columns) : 200, line: HEAD_LINE, gap: 2,
    title: <Text weight="semibold" size="heading">Agents</Text>,
    rest: [bar, <Box key="agents-sum" flexGrow={1} flexShrink={1} minWidth={0}>{live || <Text dimColor wrap="truncate-end">{p.text}</Text>}</Box>] })
  /* a running agent's row turns over in place, the stop column at its end; a finished one's is fixed */
  const row = (r: any) => {
    const inner = agentRow(els, stopWords(fitRow(r, cols, desk), stop, desk), 'agent-', desk, r.done ? undefined : AGENT_LINE + r.id)
    return r.done ? inner : stopRow(els, 'agent-', r, inner, desk, stop)
  }
  /* a running dispatch's own agents stay under it; a finished one's go into the fold with it */
  const rows = open ? cutRun(els, 'agents', am.rows.filter((r: any) => !r.ended), cut, 'agents').map((r: any) => (r.cutLine || row(r))) : []
  const ended = am.rows.filter((r: any) => r.ended)
  if (open && ended.length) rows.push(cut && cut.done ? cutDone(els, 'agents', ended.filter((r: any) => !r.under).length, 'finished agents', 'each one\'s report is in the conversation')
    : doneFold(els, 'agents', ended, row, !!(done && done.open), () => { if (done) done.toggle() }, desk, Number(columns) > 0 ? Number(columns) : 200))
  return <Box key="agents" flexDirection="column" rowGap={1}>{[head, ...rows]}</Box>
}

/* The heading's live piece as plain data: shut, the deepest running agent's bar (the desktop's picture,
   else a dim glyph) beside the line; open, the line alone: what agentsTree draws and its Client is answered */
export function agentsHeadLive(am: any, open: boolean, desk: boolean, columns?: number): any {
  const deep = open ? null : am.deepest
  const m = deep && desk ? deep.meter : null
  const glyph = deep && !m ? fillGlyph(deep.pct) : ''
  const bar = m ? { pic: m, gap: 2 } : glyph ? { glyph, ink: { dimColor: true }, gap: 2 } : null
  return { text: agentsLine(am, open, desk, columns), wrap: 'truncate-end', bar }
}

/* The line beside the Agents heading. Shut: the deepest running agent's bar, then the longest
   running time where the whole line has the room, else the counts and depth; open: the counts */
export function agentsLine(am: any, open: boolean, desk: boolean, columns?: number): string {
  if (open) return am.running + ' running' + (am.done ? ', ' + am.done + ' done' : '')
  const m = desk ? am.deepest.meter : null
  const glyph = m ? '' : fillGlyph(am.deepest.pct)
  const barCells = m ? Math.ceil(m.width / 8) + 2 : glyph ? cellWidth(glyph) + 2 : 0
  /* the heading, its gaps and the fold's ring or arrow; the desktop's by the pane's own widths */
  const room = !(Number(columns) > 0) ? 0 : desk ? Number(columns) - FOLD_CELLS - headCells('Agents') - 2 - (m ? m.width / 8.453 + 2 : 0)
    : Number(columns) - cellWidth('Agents') - FOLD_CELLS - 6 - barCells
  const fit = (s: string) => (desk ? fitWords(s, room) : clampWords(s, room, 1))
  const timed = am.timed || am.summary
  return room > 0 ? (fit(timed) === timed ? timed : fit(am.summary)) : timed
}

/* the running rows past the cut's count fold into one row saying how many and where they show */
function cutRun(els: any, prefix: string, rows: any[], cut: FlightCut | undefined, what: string): any[] {
  if (!cut || !(Number(cut.run) >= 0) || rows.length <= Number(cut.run)) return rows
  const { Box, Text } = els
  const kept = rows.slice(0, Number(cut.run))
  const n = rows.length - kept.length
  const where = what === 'agents' ? 'the conversation shows each one as it works' : 'the app\'s background tasks list shows each one'
  return [...kept, { cutLine: <Box key={prefix + '-run-more'}><Text dimColor wrap="wrap">{'and ' + n + ' more running; ' + where + '.'}</Text></Box> }]
}
/* the finished rows given way, one line in place of their fold */
function cutDone(els: any, prefix: string, n: number, what: string, where: string): any {
  const { Box, Text } = els
  const one = n === 1 ? what.replace(/s$/, '') + ' is' : what + ' are'
  return <Box key={prefix + '-done-cut'}><Text dimColor wrap="wrap">{n + ' ' + one + ' not listed here while Home holds this much; ' + where + '.'}</Text></Box>
}

/* the finished agents under one fold, its heading the count; shut, their
   jobs follow it cut at the row's end, as a Tracks section's names do. The session's dispatches alone.
   Background's finished tasks too; the prefix keeps each fold's keys and press apart */
const doneCuts = new Map<string, { names: string; cut: string }>()
function doneFold(els: any, prefix: string, ended: any[], row: (r: any) => any, open: boolean, toggle: () => void, desk: boolean, cols: number): any {
  const { Box, Text } = els
  const tops = ended.filter((r: any) => !r.under)
  const title = tops.length + ' done'
  const room = desk ? cols - FOLD_CELLS - paneCells(title, 600) - 1 : cols - cellWidth(title) - 4
  const names = tops.map((r: any) => r.job).join(', ')
  /* the same names in the same room cut the same way: a long list is measured once, not on every draw */
  const k = prefix + '|' + desk + '|' + room
  const was = doneCuts.get(k)
  const fitted = !open && room >= 10 ? (was && was.names === names ? was.cut : desk ? fitWords(names, room) : clampWords(names, room, 1)) : ''
  if (!open && room >= 10) { doneCuts.delete(k); doneCuts.set(k, { names, cut: fitted }); if (doneCuts.size > 8) doneCuts.delete(doneCuts.keys().next().value as string) }
  const rest = !open && room >= 10 ? [<Box key={prefix + '-done-names'} flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{fitted}</Text></Box>] : []
  const head = foldHead(els, { key: prefix + '-done-head', press: prefix + '-done-fold', open, toggle, desk, cols, title: <Text weight="semibold">{title}</Text>, rest })
  return <Box key={prefix + '-done'} flexDirection="column" rowGap={1}>{[head, ...(open ? ended.map(row) : [])]}</Box>
}

/* The stop column: at the right edge of every running row, agents and background alike,
   so each button lines up under the last; a row TaskStop cannot take keeps it empty. On the desktop it is
   as wide as its square button, one 20 px text line each way, so the names get the room */
export const STOP_CELLS = 20 / 8.453
const STOP_LINES = 1
const STOP_TERM = 10
export type StopView = { state: (id: string) => string; press: (id: string, job: string) => void }
const stopCells = (desk: boolean) => (desk ? STOP_CELLS : STOP_TERM)

/* a running row's name cut at a whole word in the room its indent, bar and the stop column leave, so the
   column never moves; the job's bold measured as drawn. On the desktop its detail keeps to two
   lines where it can, the depth's limit going first, then the depth, which the meter shows. The live
   line's props are fitted the same way */
export function fitRow(r: any, cols: number, desk: boolean, stop = true): any {
  if (!(cols > 0)) return r
  /* a background row's lead on the desktop is its kind's icon (status.tsx agentLive) */
  const bar = desk ? (r.meter ? r.meter.width / PX_CELL + 1 : r.kind ? kindPicture(r.kind, r.done, r.bare).width / PX_CELL + 1 : 0) : r.kind ? 0 : 2
  const indent = 3 * Math.min(2, Number(r.under) || 0)
  /* a finished row has no stop column and its name wraps whole; its detail keeps to two lines as a running one's.
     in the agents card (no stop column) every row's detail keeps to one line, cut as a running one's */
  if (r.done) {
    const detail = desk && !stop ? fitDetail(r, cols - indent - bar, 1, true) : desk && r.depth ? fitDetail(r, cols - indent - bar) : r.detail
    return detail === r.detail ? r : { ...r, detail }
  }
  /* a cell spare, and the stop column and its gap where the row has one (the agents card's has none) */
  const room = cols - indent - bar - (stop ? stopCells(desk) + 2 : 1)
  if (!desk) {
    const job = clampWords(r.job, room, 1)
    return job === r.job ? r : { ...r, job }
  }
  /* the app faults a live line that changes size on renders nothing asked for, so its rows come from
     the width (the detail with its ticking fields at their widest) and the detail is cut to them. The name's
     room keeps a cell spare for its bold; the dim line's wrap takes it. The job and a refused stop's
     words never tick, so the agents card's job takes up to two lines (Home's keeps one) and the refusal three */
  const job = cutLines(r.job, room, stop ? 1 : 2, 600)
  /* only a row with a stop column draws a refusal: the agents card's rows keep the size the card drew, one detail line.
     lines: the detail's alone, its fixed height; the job never ticks and takes the lines it draws in */
  const lines = !stop ? 1 : r.refused ? Math.min(3, wrapLines(String(r.detail), room + 1)) : Math.min(2, wrapLines(widest(r) + (r.depth ? ', 999k' : ''), room + 1))
  return { ...r, job, detail: fitDetail(r, room + 1, lines, true), lines }
}
/* a running row's detail with the fields that tick at their widest: the time, the calls (the tool in use takes what is left) */
const widest = (r: any) => [r.stem, '9h 59m', ...(r.kind ? [] : ['999 calls'])].filter(Boolean).join(', ')
const WIDE_TOOL = ', in PowerShell'
const TOOL_LEAST = 2

/* lines a dim line takes wrapped at whole words in `room` cells */
function wrapLines(s: string, room: number, weight = 400): number {
  let n = 1, line = ''
  for (const w of s.split(' ')) {
    const t = line ? line + ' ' + w : w
    if (!line || paneCells(t, weight) <= room) line = t
    else { n++; line = w }
  }
  return n
}
/* s in `n` lines of `room` cells, cut after its last whole word that fits */
function cutLines(s: string, room: number, n: number, weight = 400): string {
  if (wrapLines(s, room, weight) <= n) return s
  const words = s.split(' ')
  for (let k = words.length - 1; k > 0; k--) {
    const cut = words.slice(0, k).join(' ').replace(/[,;:]$/, '') + '…'
    if (wrapLines(cut, room, weight) <= n) return cut
  }
  return words[0] + '…'
}
/* the detail in `n` lines: the depth's limit goes first, then the depth (the meter shows it); a live line's
   (sized) last words then, so it never takes a line its size has not */
function fitDetail(r: any, room: number, n = 2, sized = false): string {
  const whole = String(r.detail || '')
  const tool = !r.done && r.tool && whole.endsWith(', ' + r.tool) ? String(r.tool) : ''
  const d = tool ? whole.slice(0, -tool.length - 2) : whole
  const fits = (s: string) => wrapLines(s, room) <= n
  /* a running row's parts are picked against its widest form, so they hold between ticks;
     the tool in use, which comes and goes, takes only the room they leave */
  if (sized && !r.done) {
    /* the limit's words give way to a tool as wide as PowerShell, on every tick alike; the depth stays */
    const wideDepth = r.depth ? String(r.depth).replace(/^\S+/, '999k') : ''
    /* each drop is decided on the widest form, so a row's parts hold as its time and calls grow */
    const k = r.kind ? 0 : fits(widest(r) + (wideDepth ? ', ' + wideDepth : '') + WIDE_TOOL) ? 0
      : !wideDepth || fits(widest(r) + ', ' + wideDepth.replace(/ of \S+$/, '')) ? 1 : 2
    for (let j = k; j <= 2; j++) { const s = dropParts(d, r.depth, j); if (fits(s)) return tool ? withTool(s, tool, fits) : s }
    return cutLines(dropParts(d, r.depth, 2), room, n)
  }
  if (fits(d)) return r.detail
  const forms = r.depth && d.endsWith(r.depth) ? [d.replace(/ of \S+$/, ''), d.slice(0, -r.depth.length).replace(/, $/, '')] : []
  if (!sized) return forms.find(fits) || forms[1] || r.detail
  return forms.find(fits) || cutLines(forms[1] || d, room, n)
}
/* the parts, then the tool in use where it fits, its name cut to the room left where it does not; the floor counts
   the name's letters after "in ", so a name of wide letters is cut where a narrow one is; under two, none */
function withTool(s: string, tool: string, fits: (s: string) => boolean): string {
  if (fits(s + ', ' + tool)) return s + ', ' + tool
  const least = tool.indexOf(' ') + 1 + TOOL_LEAST
  for (let i = tool.length - 1; i >= least; i--) { const t = s + ', ' + tool.slice(0, i) + '…'; if (fits(t)) return t }
  return s
}

/* the detail with its last k parts left out: 1 the depth's limit, 2 the depth */
function dropParts(s: string, depth: string, k: number): string {
  if (k >= 1 && depth && s.endsWith(depth)) return k >= 2 ? s.slice(0, -depth.length).replace(/, $/, '') : s.replace(/ of \S+$/, '')
  return s
}

/* while a row's stop is armed its detail line says to press again, and while it stops it says so;
   the desktop's column holds the square alone. The terminal keeps its words in the column */
export function stopWords(r: any, stop: StopView | undefined, desk: boolean): any {
  if (!desk || !stop || !r.stop || r.done) return r
  const st = stop.state(r.id)
  return st === 'armed' ? { ...r, detail: 'press again to stop' } : st === 'busy' ? { ...r, detail: 'stopping' } : r
}

/* The Background fold's icons take the meter's width only where it costs no name a word; else each
   keeps its own width (bare), so the fold's names share one start. The live answer reads the rows the same way */
export function bgRows(rows: any[], cols: number, desk: boolean): any[] {
  const costs = desk && rows.some((r: any) => r.kind && fitRow(r, cols, desk).job !== fitRow({ ...r, bare: true }, cols, desk).job)
  return costs ? rows.map((r: any) => (r.kind ? { ...r, bare: true } : r)) : rows
}

/* the desktop's stop button, a square. A Button is as wide as its label and the kit's 12 px
   padding each side (desktop-capabilities, a Button's width), so the square is a Box in the button's
   fill holding the stop square, its press laid over it; armed it takes the primary look, stopping it dims */
const STOP_GLYPH = '■'
const STOP_FILL = 'rgba(128, 128, 128, 0.34)', STOP_LIT = 'rgba(128, 128, 128, 0.48)', STOP_EDGE = 'rgba(128, 128, 128, 0)'
function stopSquare(els: any, prefix: string, id: string, st: string, go: () => void): any {
  const { Box, Text } = els
  const armed = st === 'armed', live = st !== 'busy'
  return (
    <Box key={prefix + 'stopface-' + id} borderStyle="single" borderColor={STOP_EDGE} padding={0} width={STOP_CELLS} height={STOP_LINES} flexShrink={0}
      flexDirection="row" justifyContent="center" alignItems="center" backgroundColor={armed ? 'text' : STOP_FILL} {...(live && !armed ? { hover: { backgroundColor: STOP_LIT } } : {})}>
      <Text {...(armed ? { color: 'inverseText' } : live ? {} : { dimColor: true })}>{STOP_GLYPH}</Text>
      {live ? pressOver(els, prefix + 'stop-' + id, 4, go) : null}
    </Box>
  )
}

/* the row and its column; the desktop's square, the terminal's Stop, then Stop? while armed, then stopping */
function stopRow(els: any, prefix: string, r: any, inner: any, desk: boolean, stop?: StopView, extra?: { press: any; hover: any } | null): any {
  const { Box, Button, Text } = els
  const st = stop ? stop.state(r.id) : 'rest'
  const go = () => { if (stop) stop.press(r.id, r.job) }
  const face = !stop || !r.stop ? null
    : desk ? stopSquare(els, prefix, r.id, st, go)
    : st === 'busy' ? <Text key={prefix + 'stopping-' + r.id} dimColor>stopping</Text>
    : st === 'armed' ? <Button key={prefix + 'stop-' + r.id} variant="primary" label="Stop?" onPress={go} />
    : <Button key={prefix + 'stop-' + r.id} label="Stop" onPress={go} />
  return (
    <Box key={prefix + 'run-' + r.id} flexDirection="row" columnGap={1} alignItems="center">
      <Box key={prefix + 'main-' + r.id} flexGrow={1} flexShrink={1} minWidth={0} {...(extra ? { hover: extra.hover } : {})}>{extra ? extra.press : null}{inner}</Box>
      {/* the desktop's square is as wide as the column, so it stands in for it */}
      {desk && face ? face : <Box key={prefix + 'stopcol-' + r.id} width={stopCells(desk)} flexShrink={0} flexDirection="row" justifyContent="flex-end" alignItems="center">{face}</Box>}
    </Box>
  )
}

/* Home's Background fold, right under Agents: the session's background shells and monitors
   (a workflow draws under Agents), a row each with its kind and running time, the stop column at its end; drawn while one
   runs. Shut, its line counts them by kind. On the desktop a row's press unfolds its whole command and
   its status (the app offers a plugin no way to open its own Background tasks pane at one task).
   the finished ones sit in their own done fold below the running, as the agents' do */
export function backgroundTree(els: any, bm: any, open: boolean, onToggle: () => void, surface?: string, columns?: number, stop?: StopView,
  more?: { has: (id: string) => boolean; toggle: (id: string) => void }, done?: { open: boolean; toggle: () => void }, cut?: FlightCut): any {
  const { Box, Text, Svg } = els
  const desk = surface === 'desktop' && !!Svg
  const cols = Number(columns) > 0 ? Number(columns) : 0
  const words = flightWords(null, bm) + ' running' + (bm.done ? ', ' + bm.done + ' done' : '')
  const room = !cols ? 0 : desk ? cols - FOLD_CELLS - headCells('Background') - 2 : cols - cellWidth('Background') - FOLD_CELLS - 6
  const fit = (s: string, n = room) => (!n ? s : desk ? fitWords(s, n) : clampWords(s, n, 1))
  const want = open ? bm.summary : words
  const beside = fit(want) === want ? want : fit(bm.summary)
  /* where not even the first clause stays whole beside the heading, the count goes whole to a line under it */
  const under = !!room && beside !== want && !beside.startsWith(bm.summary.split(',')[0])
  const below = desk ? cols - FOLD_CELLS : cols - 2
  const line = !under ? beside : fit(want, below) === want ? want : fit(bm.summary, below)
  const sum = <Box key="bg-sum" flexGrow={1} flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{line}</Text></Box>
  const head = foldHead(els, { key: 'bg-head', press: 'bg-toggle', open, toggle: onToggle, desk, cols: cols || 200, line: HEAD_LINE, gap: 2,
    title: <Text weight="semibold" size="heading">Background</Text>, ...(under ? { under: sum } : { rest: [sum] }) })
  const row = (r: any) => {
    const inner = agentRow(els, stopWords(fitRow(r, cols, desk), stop, desk), 'bg-', desk, r.done ? undefined : AGENT_LINE + r.id)
    const toggle = desk && more ? () => more.toggle(r.id) : null
    const press = toggle ? { press: pressOver(els, 'bg-more-' + r.id, cols || 200, toggle), hover: PRESS_LIT.hover } : null
    const face = r.done ? (press ? <Box key={'bg-main-' + r.id} hover={press.hover}>{press.press}{inner}</Box> : inner) : stopRow(els, 'bg-', r, inner, desk, stop, press)
    if (!more || !more.has(r.id)) return face
    /* unfolded: the whole command or name, and how it stands */
    const said = [r.status === 'running' ? 'running' : r.status === 'killed' ? 'stopped' : r.status, 'task ' + r.id].join(', ')
    return (
      <Box key={'bg-row-' + r.id} flexDirection="column" rowGap={0.5}>
        {face}
        <Box key={'bg-full-' + r.id} flexDirection="column" paddingRight={desk ? STOP_CELLS + 1 : 0}>
          {r.command && r.command !== r.job ? <Text key={'bg-cmd-' + r.id} wrap="wrap">{r.command}</Text> : null}
          <Text key={'bg-state-' + r.id} dimColor wrap="wrap">{said}</Text>
        </Box>
      </Box>
    )
  }
  const all = open ? bgRows(bm.rows, cols, desk) : []
  const rows = cutRun(els, 'bg', all.filter((r: any) => !r.done), cut, 'background').map((r: any) => (r.cutLine || row(r)))
  const ended = all.filter((r: any) => r.done)
  if (ended.length) rows.push(cut && cut.done ? cutDone(els, 'bg', ended.length, 'finished background tasks', 'the app\'s background tasks list keeps them')
    : doneFold(els, 'bg', ended, row, !!(done && done.open), () => { if (done) done.toggle() }, desk, cols || 200))
  return <Box key="background" flexDirection="column" rowGap={1}>{[head, ...rows]}</Box>
}

/* the heading's line: Anthropic Sans 16 on 24 px */
const HEAD_LINE = 24
const headCells = (s: string) => textMeasure(s, 16, 600) / 8.453

/* The shut heading's one line: the held track's counts from the facts its tooltip reads,
   for example "TR-4: 7 open, 1 running, 1 unconfirmed, 2 ready, 90 done"; with no track held, the lines drawn, else why not */
export function standLine(held: any, gm: any): string {
  if (held && held.id) {
    const n: string[] = []
    if (Number.isFinite(held.total) && Number.isFinite(held.done)) n.push(Math.max(0, held.total - held.done) + ' open')
    if (held.running) n.push(held.running + ' running')
    if (held.unconfirmed) n.push(held.unconfirmed + ' unconfirmed')
    if (held.ready) n.push(held.ready + ' ready')
    if (Number.isFinite(held.done)) n.push(held.done + ' done')
    /* the user's hold leads the line */
    return held.id + (held.hold ? ', ' + HOLD_WORDS : '') + (n.length ? ': ' + n.join(', ') : '')
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
  fold?: { open: boolean; toggle: () => void; line: string; columns?: number; inbox?: { open: boolean; toggle: () => void }; lean?: boolean }): any {
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
  /* the mock's row of its own under the heading: the held track's lines, the whole workstream; with
     no picture too, and a view the pane cannot draw is its board page's link */
  if (desk && (gm.views || []).length) {
    /* both are buttons, the one shown primary: from the Overview neither is, and dim words read as text. Two cells beside a link, whose press rim reaches past its words */
    parts.push(<Box key="graph-views" flexDirection="row" columnGap={gm.views.some((v: any) => v.act.kind === 'open') ? 2 : 1} rowGap={0.5} flexWrap="wrap" alignItems="center">
      {gm.views.map((v: any) => {
        const go = press(v.act)
        if (!go) return v.act.href ? wordLink(els, 'graph-' + v.key, v.act.href, v.label + ' ' + OUT, true) : null
        return <Button key={'graph-' + v.key} label={v.label} onPress={go} {...(v.on ? { variant: 'primary' } : {})} />
      })}
    </Box>)
  }
  /* the workstreams the line names open their pages */
  const why = gm.why && Array.isArray(gm.whyParts) ? linkLine(els, gm.whyParts.map((p: any) => ({ ...p, tone: 'dim' })), 'graph-why', desk, false) : null
  if (gm.why) parts.push(why || <Box key="graph-why"><Text dimColor wrap="wrap">{gm.why}</Text></Box>)
  /* a drawing past the mod's ceiling draws the picture alone, its side parts named on the Tracks tab */
  const lean = !!(fold && fold.lean)
  if (lean) gm = { ...gm, crumbs: [], inbox: null, strip: null, legend: [], more: null }
  if (pic && ((gm.crumbs || []).length || gm.hold)) parts.push(crumbRow(els, gm.crumbs, press, cols, gm.hold))
  if (gm.since) parts.push(<Box key="graph-since"><Text dimColor wrap="wrap">{'Since your last look, ' + gm.since.when + ': ' + gm.since.words}</Text></Box>)
  if (pic) {
    const p = gm.picture
    /* the ground's press first, so every zone lies over it, and each zone in the order drawn */
    const ground = p.clear && press(p.clear)
    const zones = [ground ? zoneOver(els, { k: 'ground', x: 0, y: 0, w: p.width, h: p.height }, ground, '', p.height) : null,
      ...(p.zones || []).map((z: any) => zoneOver(els, z, press(z.act), z.act && z.act.href, p.height))]
    /* the Box is the picture's cells at the app's font; the Svg, past it and given no height, fills it at its own aspect */
    parts.push(<Box key="graph-pic" flexShrink={0} width={p.width / PX_CELL}><Svg source={p.source} alt={p.alt} width={Math.min(SVG_MAX, p.width * 2)} />{zones}</Box>)
    /* a row, so the column does not stretch the link's rim, whose margins then pass the pane's edge */
    if (gm.more) parts.push(gm.more.href ? <Box key="graph-more" flexDirection="row">{wordLink(els, 'graph-more-link', gm.more.href, gm.more.words + ' ' + OUT, desk)}</Box> : <Box key="graph-more"><Text dimColor>{gm.more.words}</Text></Box>)
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
  if (lean) parts.push(<Box key="graph-lean"><Text dimColor wrap="wrap">The picture's trail, loose tasks, selection and legend are not drawn here while Home holds this much; the Tracks tab shows the workstream whole.</Text></Box>)
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

/* the crumbs as presses in the link's blue, the current one and the marks between them secondary.
   a crumb wider than the pane wraps at a word onto a second line, ending in an ellipsis
   only where two lines do not hold it; the row breaks between crumbs, so a crumb's room is the line's */
function crumbRow(els: any, crumbs: any[], press: (a: any) => (() => void) | null, cols: number, hold?: string): any {
  const { Box, Text } = els
  const row: any[] = []
  const room = cols - 1
  crumbs.forEach((c: any, i: number) => {
    if (i) row.push(<Box key={'crumb-sep-' + i} flexShrink={0}><Text dimColor>›</Text></Box>)
    const go = c.act ? press(c.act) : null
    const one = paneCells(c.words) <= room
    const words = one ? c.words : cutLines(c.words, room, 2)
    const wrap = one ? {} : { wrap: 'wrap' }
    row.push(go ? pressFace(els, 'crumb-' + i, <Text color="suggestion" {...wrap}>{words}</Text>, pressOver(els, 'crumbp-' + i, cellWidth(c.words), go), { shrink: !one })
      : <Box key={'crumb-' + i} {...(one ? { flexShrink: 0 } : { flexShrink: 1, minWidth: 0 })}><Text dimColor {...wrap}>{words}</Text></Box>)
  })
  /* the track's hold beside its crumb, whole: past the line's room it wraps under it */
  if (hold) row.push(<Box key="crumb-hold" flexShrink={0}><Text color="warning">{hold}</Text></Box>)
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
   in the pane, else a link to its page. A thing's zone lights grey on hover as every press does;
   the ground's clear does not. The app's font sets the px of a cell and the picture scales with
   it, so down the picture a zone is a share of its height. The engine takes only whole percents, so a
   zero-width column as tall as the picture shares its height out by flexGrow: above, the zone, below */
const PX_CELL = 8.453, PX_LINE = 20, PX_ROW = PX_LINE / 2, SVG_MAX = 4096
function zoneOver(els: any, z: any, go: (() => void) | null, href: string | undefined, height: number): any {
  const { Box } = els
  if (!go && !href) return null
  const cells = z.w / PX_CELL
  const id = z.k + '-' + z.x + '-' + z.y
  const below = Math.max(0, height - z.y - z.h)
  /* the zone cuts its press itself, so the press needs no cut of its own */
  const face = pressInside(els, (go ? 'gzp-' : 'gzl-') + id, cells, go, href, 'zone')
  const lit = z.k === 'ground' ? {} : { hover: PRESS_LIT.hover }
  return (
    <Box key={'gzc-' + id} position="absolute" top={0} left={0} width={0} height="100%" flexDirection="column">
      {z.y > 0 ? <Box key={'gza-' + id} height={0} flexGrow={z.y} /> : null}
      <Box key={'gz-' + id} marginLeft={z.x / PX_CELL} width={cells} height={0} flexGrow={z.h} overflow="hidden" justifyContent="center" {...lit}>{face}</Box>
      {below > 0 ? <Box key={'gzb-' + id} height={0} flexGrow={below} /> : null}
    </Box>
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
  if (desk) return pressFace(els, 'fnamef-' + k, face, pressInside(els, (act ? 'fnamep-' : 'fnamel-') + k, cellWidth(name), act, href))
  return act ? <Button key={'fnamep-' + k} plain onPress={act}>{face}</Button> : <Link key={'fnamel-' + k} href={href}>{face}</Link>
}

/* One line in the console's two rows: the kind's picture (desktop), the id and the name as the
   record's press (the pane's own view, else its board page), the time; under them what happened and where. */
function feedRow(els: any, e: any, surface?: string, columns?: number, open?: (e: any) => (() => void) | null): any {
  const { Box, Text, Svg, Button, Link } = els
  const desk = surface === 'desktop'
  const k = e.at
  let icon: any = null
  /* Activity's rows are most of Home's page nodes, so each row keeps only the Boxes its look needs */
  if (surface === 'desktop' && Svg) {
    const p = markPicture(e.kind, 'dim')
    icon = <Svg key={'fkind-' + k} source={p.source} alt={p.alt} width={p.width} height={p.height} />
  }
  const act = open ? open(e) : null
  /* a linked id lights as every press does */
  const id = act
    ? (desk ? pressFace(els, 'fid-' + k, <Text color="suggestion">{e.id}</Text>, pressInside(els, 'fidp-' + k, cellWidth(e.id), act))
      : <Box key={'fid-' + k} flexShrink={0}><Button key={'fidp-' + k} plain label={e.id} onPress={act} /></Box>)
    : e.href ? (desk ? pressFace(els, 'fid-' + k, <Text color="suggestion">{e.id}</Text>, pressInside(els, 'fid-' + k + '-link', cellWidth(e.id), null, e.href))
      : wordLink(els, 'fid-' + k, e.href, e.id, desk)) : <Box key={'fid-' + k} flexShrink={0}><Text dimColor>{e.id}</Text></Box>
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
          {nameFace(els, k, name, act, e.href, desk, Button, Link)}
          {/* the time takes the room the name leaves, so it ends at the row's right edge */}
          <Box key={'ftime-' + k} flexGrow={1} flexShrink={0} justifyContent="flex-end"><Text dimColor tabular>{e.time}</Text></Box>
        </Box>
        <Text key={'fwhat-' + k} dimColor wrap="truncate-end">{what}</Text>
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
   its body, desktop-capabilities 2f), in headPx: its px run 7.74 to a cell at least, in any app font */
const titleRoom = (cols: number) => (cols - 54 / CELL_NARROW) * 7.74

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
