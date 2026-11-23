/* The Settings tab: every setting from the
 * settings verb's rows, grouped in its sub-tabs, each row its label, one plain line, a control and a
 * scope chip, a fold that explains it (its ring ending the row's first line) and an edit-at picker
 * under the chip. Drawn from the read alone; index.ts owns the read and the writes. */
import { cellWidth, clampWords, dotPicture, statusPicture, switchPicture } from '../../lib/mod-core.mjs'
import { PRESS_RIM, SKY, pressFace, pressOver } from './status.tsx'
import { CELL_NARROW, FOLD_CELLS, OPEN, SHUT, fitWords, foldEnd, foldHead, foldRing, paneCells } from './fold.tsx'

/* where a write goes: a layer and its record (none for default and this PC) */
export type SettingsPlace = { level: string; record?: string | null }
/* the tab's own state, kept across redraws by index.ts */
export type SettingsView = {
  sub: string; query: string; only: boolean; more: Set<string>; picker?: string; at: Record<string, SettingsPlace>
  drafts: Record<string, string>; builtins: boolean; line: { slug: string; text: string; for: string; role?: string }
  note?: { key: string; ok: boolean; text: string; dim?: string }
  /* a field's draw count: a new one keys it afresh, so a reset shows even where the drawn value did not move */
  gen: Record<string, number>
  /* the text the search field is drawn with, never the typed query, which trails the typing */
  findSeed: string
  /* the phone sign-in: a mint in flight, the link and its QR rows while it lives, or the refusal */
  phone?: { busy?: boolean; url?: string; expires?: string; rows?: string[]; error?: string }
}
/* json: settings --json; error: the last read failed (the rows are the read before) */
export type SettingsModel = { json?: any; error?: string; track?: { id: string; name: string } | null; project?: string; bypass?: { quiet?: boolean } | null }
export type SettingsActions = {
  redraw: () => void
  set: (key: string, value: string, at?: SettingsPlace) => void
  unset: (key: string, at?: SettingsPlace) => void
  rule: (op: 'add' | 'clear' | 'drop', profile: string, slug: string, text?: string, audience?: string) => void
  phone: () => void
}

export const newSettingsView = (): SettingsView => ({ sub: 'replies', query: '', only: false, more: new Set(), at: {}, drafts: {}, builtins: false, line: { slug: '', text: '', for: 'both', role: '' }, gen: {}, findSeed: '' })
/* the field's key at its draw count, and the next count */
const fieldKey = (v: SettingsView, base: string, k: string) => base + (v.gen[k] ? '-' + v.gen[k] : '')
export const freshField = (v: SettingsView, k: string) => { v.gen[k] = (v.gen[k] || 0) + 1 }
/* the search emptied by the mod: keyed afresh, since its drawn text may not have moved */
const findClear = (v: SettingsView) => { v.query = ''; v.findSeed = ''; freshField(v, 'find') }

const TILE = 'rgba(128, 128, 128, 0.08)', LIT = 'rgba(128, 128, 128, 0.16)', CLEAR = 'rgba(128, 128, 128, 0)'
const WIDE = 80
/* the board's mid layout (its 640 px step): a rule row's name beside its words */
const MID = 60
/* the chip's column on a wide row, in cells */
const CHIP_COLS = 18
const MASTER_ON = 'Every session is on bypass from the tray until you turn it off; this setting takes over again then.'
const BYPASS_TIMES = 'placement.times'
const AUDIENCE: Record<string, string> = { session: 'for the session', agents: 'for its agents', both: 'for both' }
const LEVELS = ['default', 'project', 'workstream', 'track', 'task']

type Draw = { els: any; desk: boolean; cols: number; wide: boolean; v: SettingsView; act: SettingsActions; m: SettingsModel; rows: any[]; board: boolean }

/* a value in the row's own words: 350k, 30%, on, the choice's word */
export function valueWords(row: any, v = row.value): string {
  if (row.kind === 'tokens') return Math.round(Number(v) / 1000) + 'k'
  if (row.kind === 'percent') return v + '%'
  if (row.kind === 'bool') return v ? 'on' : 'off'
  if (row.kind === 'choice') return (row.choices && row.choices[v]) || String(v)
  if (row.kind === 'text') return v === '' ? 'none' : String(v)
  if (row.kind === 'texts') return Array.isArray(v) ? (v.length ? plural(v.length, row.key === BYPASS_TIMES ? 'time' : 'line') : 'none') : String(v)
  return String(v)
}
/* the CLI's words for a value */
function cliWords(row: any, v = row.value): string {
  if (row.kind === 'tokens') return Math.round(Number(v) / 1000) + 'k'
  if (row.kind === 'bool') return v ? 'on' : 'off'
  if (row.kind === 'texts') return "'" + JSON.stringify(v) + "'"
  const t = String(v)
  return /\s/.test(t) || t === '' ? '"' + t + '"' : t
}
const lastPart = (dir: string) => String(dir || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(dir || '')
const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many)
/* an action as the board's buttons draw it: the surface's own button, never bare words */
function actButton(d: Draw, key: string, label: string, press: () => void): any {
  const { Box, Button } = d.els
  return <Box key={key + '-box'} flexShrink={0}><Button key={key} label={label} onPress={press} /></Box>
}

function recordName(d: Draw, level: string, record: string): string {
  if (level === 'project') return lastPart(record)
  if (level === 'track' && d.m.track && d.m.track.id === record) return record + ' ' + d.m.track.name
  return record
}
function overriddenWords(list: any[]): string {
  const parts = (list || []).map((o: any) => plural(o.count, o.level))
  return parts.length ? 'overridden on ' + parts.join(' and ') : ''
}


export function settingsTree(els: any, m: SettingsModel, v: SettingsView, act: SettingsActions, columns?: number, surface?: string): any {
  const { Box, Text } = els
  const cols = Number(columns) > 0 ? Number(columns) : 60
  if (!m.json) {
    const words = m.error || 'Reading the settings...'
    return <Box key="settings"><Text dimColor wrap="wrap">{words}</Text></Box>
  }
  const rows = (m.json.rows || []) as any[]
  const d: Draw = { els, desk: surface === 'desktop' && !!els.Svg, cols, wide: cols >= WIDE, v, act, m, rows, board: !!m.json.board }
  const parts: any[] = [scopeHead(d)]
  if (m.error) parts.push(<Box key="set-error"><Text dimColor wrap="wrap">{m.error + '; showing the last read.'}</Text></Box>)
  parts.push(searchRow(d))
  const q = v.query.trim().toLowerCase()
  if (q) parts.push(searchBody(d, q))
  else {
    parts.push(subStrip(d))
    parts.push(tabBody(d, v.sub))
  }
  return <Box key="settings" flexDirection="column" rowGap={1}>{parts}</Box>
}

/* whose settings these are, and the narrowest-wins line */
function scopeHead(d: Draw): any {
  const { Box, Text } = d.els
  let lead: string, line: string
  if (d.board) {
    const where = [d.m.track ? 'track ' + d.m.track.id + ' ' + d.m.track.name : '', d.m.project ? 'project ' + d.m.project : ''].filter(Boolean).join(', ')
    lead = 'This session\'s settings' + (where ? ': ' + where : '') + '.'
    line = 'Each value comes from the narrowest place that sets it. Press a chip to choose where to set it.'
  } else {
    lead = 'Settings for this PC.'
    line = 'No board joined: your reply options and the question queue live in this PC\'s config.json; the rest need a board, which /askerdo:configure joins.'
  }
  return (
    <Box key="set-scope" flexDirection="column">
      <Text weight="semibold" wrap="wrap">{lead}</Text>
      <Text dimColor wrap="wrap">{line}</Text>
    </Box>
  )
}

/* the field over every sub-tab, its clear press while it has words, and the changed-only switch */
function searchRow(d: Draw): any {
  const { Box, Input, Button } = d.els
  const parts: any[] = []
  const find: any[] = []
  if (Input) {
    find.push(
      <Box key="set-find-box" flexShrink={1} minWidth={0}>
        <Input key={fieldKey(d.v, 'set-find', 'find')} placeholder="search every setting" value={d.v.findSeed}
          onInput={(t: string) => { d.v.query = String(t || ''); d.act.redraw() }} onSubmit={(t: string) => { d.v.query = String(t || ''); d.act.redraw() }} />
      </Box>)
  }
  if (d.v.query.trim()) find.push(<Box key="set-clear-box" flexShrink={0}><Button key="set-clear" plain dimColor label="clear" onPress={() => { findClear(d.v); d.act.redraw() }} /></Box>)
  /* the group grows and the field does not (an Input stops at 20em), so clear sits beside the field
     and Changed only keeps the row's far end; on a narrow pane the field shrinks before clear wraps */
  if (find.length) parts.push(<Box key="set-find-row" flexDirection="row" columnGap={1} alignItems="center" flexGrow={1} flexShrink={1} minWidth={0}>{find}</Box>)
  /* the press's rim hangs past its face; at the far end that room stays inside the body */
  parts.push(<Box key="set-only-box" flexShrink={0} {...(d.desk ? { marginRight: -PRESS_RIM.marginX } : {})}>{switchButton(d, 'set-only', d.v.only, 'Changed only', () => { d.v.only = !d.v.only; d.act.redraw() })}</Box>)
  return <Box key="set-search" flexDirection="row" columnGap={1} rowGap={0.5} alignItems="center" flexWrap="wrap">{parts}</Box>
}

/* a toggle: the switch picture and its words, one press laid over both (a Button holds no Svg);
   the terminal a glyph */
function switchButton(d: Draw, key: string, on: boolean, words: string, press?: () => void): any {
  const { Box, Button, Text, Svg } = d.els
  if (!d.desk) {
    const label = (on ? '◉ ' : '○ ') + words
    return press ? <Button key={key} plain label={label} onPress={press} /> : <Text key={key} dimColor>{label}</Text>
  }
  const p = switchPicture(on, !!press)
  const face = (
    <Box key={key + '-look'} flexDirection="row" columnGap={0.6} alignItems="center">
      <Svg source={p.source} alt={p.alt} width={p.width} height={p.height} />
      <Text {...(press ? {} : { dimColor: true })}>{words}</Text>
    </Box>)
  return press ? pressFace(d.els, key + '-face', face, pressOver(d.els, key, cellWidth(words) + 5, press)) : <Box key={key} flexShrink={0}>{face}</Box>
}

/* the sub-tabs as the pane's own tab row one level down, with each one's changed count */
function subStrip(d: Draw): any {
  const { Box, Button } = d.els
  const tabs = (d.m.json.tabs || []) as any[]
  const btns = tabs.map((t: any) => {
    const label = t.name + (t.changed ? ' ' + t.changed : '')
    const go = () => { d.v.sub = t.tab; d.v.picker = undefined; d.act.redraw() }
    return (
      <Box key={'set-subbox-' + t.tab} flexShrink={0}>
        {t.tab === d.v.sub ? <Button key={'set-sub-' + t.tab} label={label} onPress={go} /> : <Button key={'set-sub-' + t.tab} plain dimColor label={label} onPress={go} />}
      </Box>)
  })
  return <Box key="set-subs" flexDirection="row" columnGap={1} rowGap={0.5} flexWrap="wrap" alignItems="center">{btns}</Box>
}

const settingRowsOf = (d: Draw, tab: string) => d.rows.filter((r: any) => r.tab === tab && r.kind !== 'line' && (!d.v.only || r.changed))

function card(d: Draw, key: string, kids: any[], head?: string): any {
  const { Box, Text } = d.els
  const parts = head ? [<Box key={key + '-head'}><Text weight="semibold" size="heading">{head}</Text></Box>, ...kids] : kids
  return <Box key={key} flexDirection="column" rowGap={1} borderStyle="round" borderDimColor paddingX={1} paddingY={0.5}>{parts}</Box>
}

function tabBody(d: Draw, tab: string): any {
  const { Box, Text } = d.els
  const t = ((d.m.json.tabs || []) as any[]).find((x: any) => x.tab === tab)
  const parts: any[] = []
  if (t) parts.push(<Box key="set-sum"><Text weight="semibold" wrap="wrap">{t.summary}</Text></Box>)
  if (!d.board && ['sessions', 'agents', 'tests'].includes(tab)) {
    parts.push(<Box key="set-ro"><Text dimColor wrap="wrap">Kept on a board profile: read only here, at the built-in values, until this PC joins a board.</Text></Box>)
  }
  if (tab === 'rules') parts.push(rulesBody(d))
  else {
    const rows = settingRowsOf(d, tab)
    if (!rows.length) parts.push(<Box key="set-none"><Text dimColor wrap="wrap">{'Nothing in ' + (t ? t.name : tab) + ' is set away from built-in.'}</Text></Box>)
    else if (tab === 'agents') {
      const guard = rows.filter((r: any) => r.key.startsWith('agent.')), briefs = rows.filter((r: any) => r.key.startsWith('dispatch.'))
      if (guard.length) parts.push(card(d, 'set-card-guard', guard.map((r: any) => settingRow(d, r)), 'The guard'))
      if (briefs.length) parts.push(card(d, 'set-card-briefs', briefs.map((r: any) => settingRow(d, r)), 'Briefs'))
    } else parts.push(card(d, 'set-card-' + tab, rows.map((r: any) => settingRow(d, r))))
  }
  /* the one action on This PC leads it, so a phone is a press away without a scroll */
  if (tab === 'pc' && d.board && !d.v.only) parts.splice(t ? 1 : 0, 0, card(d, 'set-card-phone', [phoneRow(d)]))
  return <Box key={'set-tab-' + tab} flexDirection="column" rowGap={1}>{parts}</Box>
}

/* the search: label, line and key across every sub-tab, the results under each tab's name */
function searchBody(d: Draw, q: string): any {
  const { Box, Text } = d.els
  const hit = (r: any) => [r.label, r.line, r.key].some((s) => String(s || '').toLowerCase().includes(q))
  const groups = ((d.m.json.tabs || []) as any[]).map((t: any) => [t, settingRowsOf(d, t.tab).filter(hit)] as [any, any[]]).filter(([, rs]) => rs.length)
  const phone = d.board && !d.v.only && hit(PHONE)
  const n = groups.reduce((a, [, rs]) => a + rs.length, 0) + (phone ? 1 : 0)
  const head = n ? plural(n, 'setting') + ' in ' + plural(groups.length, 'tab') + (n === 1 ? ' matches' : ' match') + ' “' + d.v.query.trim() + '”.'
    : 'No setting matches “' + d.v.query.trim() + '”.'
  const parts: any[] = [<Box key="set-sum"><Text weight="semibold" wrap="wrap">{head}</Text></Box>]
  for (const [t, rs] of groups) parts.push(card(d, 'set-found-' + t.tab, rs.map((r: any) => settingRow(d, r)), t.name))
  if (phone) parts.push(card(d, 'set-card-phone', [phoneRow(d)]))
  return <Box key="set-tab-search" flexDirection="column" rowGap={1}>{parts}</Box>
}

/* a phone signs in to the board's web views with one press and a scan */
const PHONE = { key: 'phone', label: 'Sign in a phone', line: "A single-use link to the board's web views, drawn as a QR code for the phone's camera." }
/* the modules dark ink on a white field, as a phone's reader wants on either theme */
const QR_INK = '#0B0B0B', QR_FIELD = '#FFFFFF', QR_QUIET = 4
/* the pane's cell in px, and the card's border and padding in cells */
const CELL_PX = 8.453, CARD_CELLS = 3

/* The rows as an Svg the pane takes: one rect per dark run on a white field with its quiet
   zone, a whole number of px a module, as large as the card allows up to 6. */
export function qrPicture(rows: string[], cols: number): { source: string; alt: string; width: number; height: number } {
  const n = rows.length + 2 * QR_QUIET
  const scale = Math.max(2, Math.min(6, Math.floor(((cols - CARD_CELLS) * CELL_NARROW) / n)))
  let d = ''
  rows.forEach((row, y) => {
    for (const m of row.matchAll(/1+/g)) d += 'M' + ((m.index || 0) + QR_QUIET) + ' ' + (y + QR_QUIET) + 'h' + m[0].length + 'v1h-' + m[0].length + 'z'
  })
  const px = n * scale
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges">'
    + '<rect width="' + n + '" height="' + n + '" rx="1" fill="' + QR_FIELD + '"/><path fill="' + QR_INK + '" d="' + d + '"/></svg>'
  return { source, alt: "QR code of a single-use sign-in link to the board's web views", width: px, height: px }
}

const clockWords = (iso: string) => {
  const t = new Date(iso)
  return Number.isFinite(t.getTime()) ? t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0') : iso
}

/* the press; once pressed, the code and its expiry until the link dies, then the press again */
function phoneRow(d: Draw): any {
  const { Box, Text, Svg } = d.els
  const p = d.v.phone || {}
  const live = Array.isArray(p.rows) && p.rows.length > 0 && !!p.url && Date.parse(p.expires || '') > Date.now()
  const parts: any[] = [labelOf(d, PHONE), <Box key="set-line-phone"><Text dimColor wrap="wrap">{PHONE.line}</Text></Box>]
  if (live) {
    const pic = qrPicture(p.rows as string[], d.cols)
    if (d.desk) parts.push(<Box key="set-phone-qr" flexShrink={0} alignSelf="flex-start"><Svg source={pic.source} alt={pic.alt} width={pic.width} /></Box>)
    /* the terminal draws no Svg: the link itself, to open on the phone */
    else parts.push(<Box key="set-phone-url"><Text wrap="wrap">{p.url}</Text></Box>)
    parts.push(<Box key="set-phone-until"><Text dimColor wrap="wrap">{'It signs in one phone, once, until ' + clockWords(p.expires as string) + '.'}</Text></Box>)
  } else if (p.busy) parts.push(<Box key="set-phone-busy"><Text dimColor wrap="wrap">Asking the board for a link...</Text></Box>)
  else {
    parts.push(<Box key="set-phone-act" flexDirection="row">{actButton(d, 'set-phone', 'Show a sign-in code', () => d.act.phone())}</Box>)
    if (p.error) parts.push(<Box key="set-note-phone"><Text color="warning" wrap="wrap"><Text weight="semibold">No code.</Text>{' ' + p.error}</Text></Box>)
  }
  return <Box key="set-row-phone" flexDirection="column" rowGap={0.5}>{parts}</Box>
}

/* the explanation opens and shuts on the pane's one fold control, the ring; the terminal its arrow */
function moreRing(d: Draw, k: string): any {
  const { Box, Button } = d.els
  const open = d.v.more.has(k)
  const toggle = () => { if (!d.v.more.delete(k)) d.v.more.add(k); d.act.redraw() }
  if (d.desk) return foldRing(d.els, open, { key: 'set-ring-' + k, pressKey: 'set-more-' + k, press: toggle })
  return <Box key={'set-ring-' + k} flexShrink={0}><Button key={'set-more-' + k} plain dimColor label={open ? OPEN : SHUT} onPress={toggle} /></Box>
}

/* One setting: its label and changed dot, its line, the control and the chip, the saved line or
   the refusal, then the fold and the picker when open; the fold's ring ends the first line. */
function settingRow(d: Draw, row: any): any {
  const { Box, Text, Button } = d.els
  const k = row.key
  const ring = moreRing(d, k)
  const help = <Box key={'set-help-' + k}><Text dimColor wrap="wrap">{row.line}</Text></Box>
  /* the tray's master switch outranks this row while it is on */
  const master = k === 'placement.mode' && d.m.bypass && d.m.bypass.master
    ? <Box key="set-bypass-on"><Text color="warning" wrap="wrap">{MASTER_ON}</Text></Box> : null
  const tail: any[] = []
  if (d.v.more.has(k)) tail.push(moreFold(d, row))
  if (d.v.picker === k) tail.push(picker(d, row))
  if (d.board && k === 'contract.custom') {
    const say = (
      <Box key={'set-ptr-' + k} flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text wrap="wrap">Yours ride your profile as rule lines, so every session and agent on every PC carries them:</Text>
        <Button key="set-see-rules" plain label="see Rules" onPress={() => { d.v.sub = 'rules'; findClear(d.v); d.act.redraw() }} />
      </Box>)
    return <Box key={'set-row-' + k} flexDirection="column" rowGap={0.5}>{[labelOf(d, row, ring), help, say, ...tail]}</Box>
  }
  const ctl = control(d, row)
  const note = noteOf(d, row)
  const chipBox = chip(d, row)
  if (d.wide) {
    /* the ring a cell past the chip, at the grid's end */
    return (
      <Box key={'set-row-' + k} flexDirection="column" rowGap={0.5}>
        <Box key={'set-grid-' + k} flexDirection="row" columnGap={2} alignItems="flex-start">
          <Box key={'set-lc-' + k} width={0} flexGrow={5} flexDirection="column" rowGap={0.3}>{[labelOf(d, row), help, master].filter(Boolean)}</Box>
          <Box key={'set-cc-' + k} width={0} flexGrow={4} flexDirection="column" rowGap={0.5}>{[ctl, note]}</Box>
          <Box key={'set-kc-' + k} width={CHIP_COLS} flexShrink={0} flexDirection="row" justifyContent="flex-end">{chipBox}</Box>
          <Box key={'set-fc-' + k} flexShrink={0} marginLeft={-1}>{ring}</Box>
        </Box>
        {tail}
      </Box>)
  }
  /* narrow: the control and its chip share a line when they fit; a field or a list takes the line */
  const fill = row.editable && ['text', 'texts'].includes(row.kind)
  return (
    <Box key={'set-row-' + k} flexDirection="column" rowGap={0.5}>
      {labelOf(d, row, ring)}
      {help}
      {master}
      <Box key={'set-ck-' + k} flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0.5} alignItems="center">
        <Box key={'set-cc-' + k} flexShrink={1} minWidth={0} {...(fill ? { width: '100%' } : {})}>{ctl}</Box>
        <Box key={'set-kc-' + k} flexShrink={1} minWidth={0}>{chipBox}</Box>
      </Box>
      {note}
      {tail}
    </Box>)
}

/* the label and its changed dot; a ring given ends the line, level with the label's first line */
function labelOf(d: Draw, row: any, ring?: any): any {
  const { Box, Text, Svg } = d.els
  const k = row.key
  const dot = !row.changed ? null : d.desk ? <Box key={'set-dot-' + k} flexShrink={0}><Svg {...dotPicture()} /></Box>
    : <Text key={'set-dot-' + k} color="suggestion">•</Text>
  const lab = (
    <Box key={'set-lab-' + k} flexDirection="row" columnGap={0.8} alignItems="center" {...(ring ? { flexShrink: 1, minWidth: 0 } : {})}>
      <Box key={'set-labw-' + k} flexShrink={1} minWidth={0}><Text weight="semibold" wrap="wrap">{row.label}</Text></Box>
      {dot}
    </Box>)
  if (!ring) return lab
  return <Box key={'set-labr-' + k} flexDirection="row" columnGap={1} alignItems="flex-start">{lab}{foldEnd(d.els, ring, 1)}</Box>
}

/* a toggle, a short choice's Buttons, a number or a line with its save, a list with drop and add */
function control(d: Draw, row: any): any {
  const { Box, Text, Button, Input } = d.els
  const k = row.key
  const at = d.v.at[k]
  if (!row.editable) {
    const val = row.kind === 'bool' ? switchButton(d, 'set-val-' + k, !!row.value, row.value ? 'On' : 'Off') : <Text key={'set-val-' + k}>{valueWords(row)}</Text>
    return (
      <Box key={'set-ctl-' + k} flexDirection="column">
        {val}
        {row.why ? <Text key={'set-why-' + k} dimColor wrap="wrap">{'Read only: ' + row.why + '.'}</Text> : null}
      </Box>)
  }
  if (row.kind === 'bool') return <Box key={'set-ctl-' + k} flexDirection="row">{switchButton(d, 'set-tog-' + k, !!row.value, row.value ? 'On' : 'Off', () => d.act.set(k, row.value ? 'off' : 'on', at))}</Box>
  if (row.kind === 'choice') {
    const btns = (row.values || []).map((c: string) => {
      const label = valueWords(row, c)
      return (
        <Box key={'set-chbox-' + k + '-' + c} flexShrink={0}>
          {c === row.value ? <Button key={'set-ch-' + k + '-' + c} label={label} onPress={() => d.act.set(k, c, at)} />
            : <Button key={'set-ch-' + k + '-' + c} plain dimColor label={label} onPress={() => d.act.set(k, c, at)} />}
        </Box>)
    })
    return <Box key={'set-ctl-' + k} flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0.5} alignItems="center">{btns}</Box>
  }
  /* a phone draws no field: the value as words */
  if (!Input) return <Box key={'set-ctl-' + k}><Text>{valueWords(row)}</Text></Box>
  const shown = (row.kind === 'tokens' ? valueWords(row) : row.kind === 'texts' ? '' : String(row.value ?? ''))
  const draft = Object.hasOwn(d.v.drafts, k) ? d.v.drafts[k] : shown
  const save = (t?: string) => {
    const words = String(t ?? (Object.hasOwn(d.v.drafts, k) ? d.v.drafts[k] : shown)).trim()
    d.act.set(k, row.kind === 'percent' ? words.replace(/%$/, '').trim() : words, at)
  }
  const keep = (t: string) => { d.v.drafts[k] = String(t ?? '') }
  if (row.kind === 'percent' || row.kind === 'tokens') {
    return (
      <Box key={'set-ctl-' + k} flexDirection="row" columnGap={1} alignItems="center" flexWrap="wrap">
        <Box key={'set-inbox-' + k} width={9} flexShrink={0}><Input key={fieldKey(d.v, 'set-in-' + k, k)} value={draft} onInput={keep} onSubmit={save} /></Box>
        <Text key={'set-unit-' + k} dimColor>{row.kind === 'percent' ? '%' : 'tokens'}</Text>
        {actButton(d, 'set-save-' + k, 'Save', () => save())}
      </Box>)
  }
  if (row.kind === 'texts') {
    const list = Array.isArray(row.value) ? row.value : []
    const items = list.map((t: string, i: number) => (
      <Box key={'set-item-' + k + '-' + i} flexDirection="row" columnGap={1} alignItems="flex-start" backgroundColor={TILE} paddingX={1} paddingY={0.3}>
        <Box key={'set-itemw-' + k + '-' + i} flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="wrap">{t}</Text></Box>
        {actButton(d, 'set-itemdrop-' + k + '-' + i, 'Drop', () => d.act.set(k, JSON.stringify(list.filter((_: any, j: number) => j !== i)), at))}
      </Box>))
    const add = (t?: string) => {
      const words = String(t ?? d.v.drafts[k] ?? '').trim()
      if (words) d.act.set(k, JSON.stringify([...list, words]), at)
    }
    /* minWidth 0: a field's 20em would hold a narrow pane's row open past its edge; its Box never
       grows past the field (an Input stops at 20em), so Add and Save sit beside it at any width */
    return (
      <Box key={'set-ctl-' + k} flexDirection="column" rowGap={0.5} flexShrink={1} minWidth={0}>
        {items.length ? items : <Text key={'set-noitems-' + k} dimColor>None here.</Text>}
        <Box key={'set-addrow-' + k} flexDirection="row" columnGap={1} alignItems="center">
          <Box key={'set-inbox-' + k} flexShrink={1} minWidth={0}><Input key={fieldKey(d.v, 'set-in-' + k, k)} placeholder={k === BYPASS_TIMES ? 'minutes, as 90' : 'your own rule'} value={d.v.drafts[k] || ''} onInput={keep} onSubmit={add} /></Box>
          {actButton(d, 'set-add-' + k, 'Add', () => add())}
        </Box>
      </Box>)
  }
  return (
    <Box key={'set-ctl-' + k} flexDirection="row" columnGap={1} alignItems="center" flexShrink={1} minWidth={0}>
      <Box key={'set-inbox-' + k} flexShrink={1} minWidth={0}><Input key={fieldKey(d.v, 'set-in-' + k, k)} placeholder="none" value={draft} onInput={keep} onSubmit={save} /></Box>
      {actButton(d, 'set-save-' + k, 'Save', () => save())}
    </Box>)
}

/* the place a write goes now: the one picked, else the layer that sets it */
function placeOf(row: any, at?: SettingsPlace): any {
  const places = (row.places || []) as any[]
  if (at) return places.find((p: any) => p.level === at.level && (p.record || null) === (at.record || null)) || null
  return places.find((p: any) => p.level === row.layer) || null
}

/* the scope in plain words; a press opens the picker (lit while open) */
function chip(d: Draw, row: any): any {
  const { Box, Text, Button } = d.els
  const k = row.key
  const picked = placeOf(row, d.v.at[k])
  const words = (d.v.at[k] && picked ? picked.scope : row.scope) || row.layer
  const live = row.editable && Array.isArray(row.places) && row.places.length > 0 && !(d.board && k === 'contract.custom')
  const open = d.v.picker === k
  const toggle = () => { d.v.picker = open ? undefined : k; d.act.redraw() }
  if (!d.desk) {
    return live ? <Button key={'set-chip-' + k} plain dimColor label={'(' + words + ')'} onPress={toggle} /> : <Text key={'set-chip-' + k} dimColor>{'(' + words + ')'}</Text>
  }
  const room = d.wide ? CHIP_COLS - 3 : Math.max(6, d.cols - 6)
  return (
    <Box key={'set-chipbox-' + k} borderStyle="round" borderDimColor paddingX={0.8} paddingY={0} flexShrink={1} minWidth={0}
      {...(open ? { backgroundColor: LIT } : {})} {...(live ? { hover: { backgroundColor: LIT } } : {})}>
      <Text dimColor={!open} wrap="truncate-end">{clampWords(words, Math.floor(room * 1.2), 1)}</Text>
      {live ? pressOver(d.els, 'set-chip-' + k, cellWidth(words) + 2, toggle) : null}
    </Box>)
}

/* the saved line (where it landed, when it takes effect) or the refusal in the verb's words */
function noteOf(d: Draw, row: any): any {
  const { Box, Text, Svg } = d.els
  const n = d.v.note
  if (!n || n.key !== row.key) return null
  if (!n.ok) {
    return (
      <Box key={'set-note-' + row.key}>
        <Text color="warning" wrap="wrap"><Text weight="semibold">Not saved.</Text>{' ' + n.text}</Text>
      </Box>)
  }
  const tick = d.desk ? <Box key={'set-tick-' + row.key} flexShrink={0}><Svg {...statusPicture({ kind: 'icon', icon: 'ldDone', tone: 'sky', lead: true })} /></Box>
    : <Text key={'set-tick-' + row.key} color="suggestion">✓</Text>
  return (
    <Box key={'set-note-' + row.key} flexDirection="row" columnGap={1} alignItems="flex-start">
      {tick}
      <Box key={'set-notew-' + row.key} flexDirection="column" flexShrink={1} minWidth={0}>
        <Text wrap="wrap">{n.text}</Text>
        {n.dim ? <Text dimColor wrap="wrap">{n.dim}</Text> : null}
      </Box>
    </Box>)
}

/* the more fold: what changes, an example at the value in force, when it takes effect, the CLI, the reset */
function moreFold(d: Draw, row: any): any {
  const { Box, Text, Markdown } = d.els
  const k = row.key
  const mh = (key: string, words: string) => <Box key={'set-mh-' + key + '-' + k} marginTop={0.4}><Text weight="semibold">{words}</Text></Box>
  const parts: any[] = []
  if (row.changes) parts.push(mh('changes', 'What changes'), <Box key={'set-changes-' + k}><Text wrap="wrap">{row.changes}</Text></Box>)
  if (row.example) parts.push(mh('example', row.example.kind === 'values' ? 'What each choice does' : 'Example'), example(d, row))
  if (row.takes) parts.push(mh('takes', 'Takes effect'), <Box key={'set-takes-' + k}><Text wrap="wrap">{row.takes}</Text></Box>)
  const cmd = d.board && k === 'contract.custom' ? 'profile rule-add' : row.editable ? 'settings set ' + k + ' ' + cliWords(row) : ''
  const code = '`' + k + '`' + (cmd ? '  `' + cmd + '`' : '')
  parts.push(mh('cli', 'For the CLI'), Markdown ? <Markdown key={'set-cli-' + k} text={code} /> : <Box key={'set-cli-' + k}><Text wrap="wrap">{code}</Text></Box>)
  const reset = resetOf(d, row)
  if (reset) parts.push(reset)
  return <Box key={'set-fold-' + k} flexDirection="column" rowGap={0.3} borderStyle="round" borderDimColor backgroundColor={TILE} paddingX={1} paddingY={0.5}>{parts}</Box>
}

/* a bordered Box's border and padding across, in cells: 1 px and a cell a side on the desktop */
const boxCells = (d: Draw) => (d.desk ? 2 + 2 / CELL_PX : 4)
/* a choice's least width in cells: narrower, side by side they squeeze each to a few words */
const TILE_MIN = 30

function example(d: Draw, row: any): any {
  const { Box, Text } = d.els
  const k = row.key
  const e = row.example
  const tiles: { key: string; cap: string; text: string }[] = []
  let now = ''
  if (e.kind === 'pair') {
    now = row.kind === 'bool' ? (row.value ? 'b' : 'a') : 'b'
    tiles.push({ key: 'a', cap: e.a[0], text: e.a[1] }, { key: 'b', cap: e.b[0], text: e.b[1] })
  } else if (e.kind === 'values') {
    now = String(row.value)
    for (const [val, t] of Object.entries(e.values || {})) tiles.push({ key: val, cap: valueWords(row, val), text: String(t) })
  } else return <Box key={'set-exs-' + k}><Text wrap="wrap">{e.text}</Text></Box>
  for (const t of tiles) if (t.key === now) t.cap += ', now'
  /* Each tile a width from bodyColumns, as many to a row as fit at their least, the rest on new rows;
     the room is the row's less the card's and the fold's borders and padding. */
  const box = boxCells(d)
  const room = d.desk ? d.cols - 2 * box : Math.floor(d.cols - 2 * box)
  const widest = (s: string) => Math.max(0, ...s.split(/\s+/).map((w) => (d.desk ? paneCells(w) : cellWidth(w))))
  const least = Math.max(TILE_MIN, Math.ceil(box + Math.max(...tiles.map((t) => Math.max(widest(t.cap), widest(t.text))))))
  const n = Math.max(1, Math.min(tiles.length, Math.floor((room + 1) / (least + 1))))
  /* a desktop cell may be cut to a tenth; the terminal's are whole */
  const share = (room - (n - 1)) / n
  const width = Math.max(1, d.desk ? Math.floor(share * 10) / 10 : Math.floor(share))
  const tile = (t: { key: string; cap: string; text: string }) => (
    <Box key={'set-ex-' + k + '-' + t.key} flexDirection="column" borderStyle="round" {...(t.key === now ? { borderColor: SKY } : { borderDimColor: true })} paddingX={1} paddingY={0.3}
      width={width} flexShrink={0}>
      <Text dimColor wrap="wrap">{t.cap}</Text>
      {t.text.split('\n').map((l, i) => <Text key={'set-exl-' + k + '-' + t.key + '-' + i} wrap="wrap">{l}</Text>)}
    </Box>)
  const rows: any[] = []
  for (let r = 0; r * n < tiles.length; r++) {
    rows.push(<Box key={'set-exr-' + k + '-' + r} flexDirection="row" columnGap={1} alignItems="stretch">{tiles.slice(r * n, r * n + n).map(tile)}</Box>)
  }
  return <Box key={'set-exs-' + k} flexDirection="column" rowGap={0.5}>{rows}</Box>
}

/* back to built-in, or off this layer with what applies then */
function resetOf(d: Draw, row: any): any {
  const { Box, Text } = d.els
  const k = row.key
  if (!row.changed || !row.editable || (d.board && k === 'contract.custom')) return null
  const built = row.builtIn === undefined ? '' : valueWords(row, row.builtIn)
  const narrow = d.board && LEVELS.indexOf(row.layer) > 0
  let label = 'Back to built-in', said = built ? 'The built-in value is ' + built + '.' : '', at: SettingsPlace | undefined
  if (narrow) {
    /* a narrow terminal cannot wrap a button: the dim line after it says the rest */
    label = !d.desk && d.cols < 40 ? 'Remove' : 'Remove from this layer'
    at = { level: row.layer, record: row.record }
    const i = LEVELS.indexOf(row.layer)
    const under = ((row.places || []) as any[]).filter((p: any) => LEVELS.indexOf(p.level) < i && p.value !== undefined).pop()
    said = 'Without it, ' + (under ? valueWords(row, under.value) + ' from ' + under.scope : 'the built-in ' + (built || 'value')) + ' applies here.'
  } else if (d.board && row.layer === 'default' && !k.startsWith('contract.')) at = { level: 'default' }
  return (
    <Box key={'set-rs-' + k} flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0.3} alignItems="center" marginTop={0.4}>
      {actButton(d, 'set-reset-' + k, label, () => d.act.unset(k, at))}
      {said ? <Box key={'set-rsw-' + k} flexShrink={1} minWidth={0}><Text dimColor wrap="wrap">{said}</Text></Box> : null}
    </Box>)
}

/* the edit-at picker: each place with whom it reaches and what it sets; a press picks where the next write goes */
function picker(d: Draw, row: any): any {
  const { Box, Text, Button, Svg } = d.els
  const k = row.key
  const parts: any[] = [<Box key={'set-ph-' + k}><Text weight="semibold" wrap="wrap">{'Where to set: ' + row.label}</Text></Box>]
  const now = placeOf(row, d.v.at[k]) || {}
  const ICON: Record<string, string> = { project: 'ldDir', workstream: 'ldFolder', track: 'thread', task: 'ldDone' }
  for (const p of (row.places || []) as any[]) {
    const here = p.level === now.level && (p.record || null) === (now.record || null)
    let said: string
    if (p.level === 'pc') said = 'This PC\'s config.json: ' + p.reaches + '.'
    else {
      const name = p.profile || (p.profiles && p.profiles[0])
      const where = p.level === 'default' ? (name ? 'On ' + name + ', your default profile' : 'On your default profile')
        : (name ? 'On ' + name + ', held on ' : 'A new profile held on ') + recordName(d, p.level, p.record)
      const over = overriddenWords(p.overridden)
      said = where + ': ' + p.reaches + '.' + (p.value !== undefined ? ' Sets ' + valueWords(row, p.value) + (p.level === row.layer ? ' now' : '') + (over ? ', ' + over : '') + '.' : '')
    }
    const pick = () => {
      if (p.level === row.layer && (p.record || null) === (row.record || null)) delete d.v.at[k]
      else d.v.at[k] = { level: p.level, record: p.record }
      d.v.picker = undefined
      d.act.redraw()
    }
    const btn = here ? <Button key={'set-at-' + k + '-' + p.level} label={p.scope} onPress={pick} /> : <Button key={'set-at-' + k + '-' + p.level} plain label={p.scope} onPress={pick} />
    /* a narrow pane gives the lead icons' room to the buttons */
    let icon: any = null
    if (d.desk && d.wide) {
      const pic = ICON[p.level] ? statusPicture({ kind: 'icon', icon: ICON[p.level], tone: here ? 'sky' : 'dim', lead: true }) : { ...statusPicture({ kind: 'mark', face: 'quiet' }), alt: 'AskerDo mark' }
      icon = <Box key={'set-pi-' + k + '-' + p.level} flexShrink={0} marginTop={0.3}><Svg source={pic.source} alt={pic.alt} width={pic.width} height={pic.height} /></Box>
    }
    parts.push(
      <Box key={'set-pl-' + k + '-' + p.level} flexDirection="row" columnGap={1} alignItems="flex-start">
        {icon}
        <Box key={'set-pv-' + k + '-' + p.level} flexDirection="column" rowGap={0.2} flexShrink={1} minWidth={0} alignItems="flex-start">
          <Box key={'set-pb-' + k + '-' + p.level} flexShrink={0}>{btn}</Box>
          <Text dimColor wrap="wrap">{said}</Text>
        </Box>
      </Box>)
  }
  if (!d.board) parts.push(<Box key={'set-ptail-' + k}><Text dimColor wrap="wrap">Join a board to keep it on your default profile, which every PC reads: /askerdo:configure.</Text></Box>)
  else if (k.startsWith('contract.')) parts.push(<Box key={'set-ptail-' + k}><Text dimColor wrap="wrap">Your reply options are one set for every session, so they live on your default profile, which every PC reads.</Text></Box>)
  return <Box key={'set-pick-' + k} flexDirection="column" rowGap={0.6} borderStyle="round" borderDimColor backgroundColor={TILE} paddingX={1} paddingY={0.5}>{parts}</Box>
}

/* Rules as the board page lays them out: your own lines, the add form as its own row, the
   dropped lines' note, the built-in lines' fold; each line a row with its Drop on the right */
function rulesBody(d: Draw): any {
  const { Box, Text, Button, Input } = d.els
  const lists = (d.m.json.lists || []) as any[]
  const add = lists.find((l: any) => l.key === 'rules.add') || {}
  const drop = lists.find((l: any) => l.key === 'rules.drop') || {}
  const lines = d.rows.filter((r: any) => r.kind === 'line')
  const mine = lines.filter((l: any) => l.layer !== 'built-in')
  const built = lines.filter((l: any) => l.layer === 'built-in')
  /* the verb names the profile a new line goes to */
  const home = String(d.m.json.home || '')
  const parts: any[] = [listHead(d, add, mine.length > 0)]
  if (!d.board) {
    parts.push(<Box key="set-rules-nob"><Text dimColor wrap="wrap">Rule lines come from a board: they ride a profile there, so every session and agent on every PC carries them. Join one with /askerdo:configure to see the lines in force and add your own.</Text></Box>)
    return card(d, 'set-card-rules', parts)
  }
  if (mine.length) parts.push(<Box key="set-mine" flexDirection="column" rowGap={0.6}>{mine.map((l: any) => lineRow(d, l, true, () => d.act.rule('clear', l.profile, l.slug)))}</Box>)
  else if (!d.v.only) parts.push(<Box key="set-rules-none"><Text dimColor>None of yours yet.</Text></Box>)
  if (Input && !d.v.only) {
    const ln = d.v.line
    const go = () => {
      const slug = ln.slug.trim(), text = ln.text.trim()
      /* agents with a role named reach only that role's agents */
      const role = String(ln.role || '').trim().toLowerCase()
      if (slug && text) d.act.rule('add', home, slug, text, ln.for === 'agents' && role ? 'agents:' + role : ln.for)
    }
    const who = ['session', 'agents', 'both'].map((a) => (
      <Box key={'set-forbox-' + a} flexShrink={0}>
        {ln.for === a ? <Button key={'set-for-' + a} label={a} onPress={() => { ln.for = a; d.act.redraw() }} />
          : <Button key={'set-for-' + a} plain dimColor label={a} onPress={() => { ln.for = a; d.act.redraw() }} />}
      </Box>))
    const field = (key: string, label: string, hint: string, value: string, keep: (t: string) => void, submit: (t: string) => void) => (
      <Box key={key + '-f'} flexDirection="column" rowGap={0.2} flexShrink={1} minWidth={0}>
        <Text dimColor>{label}</Text>
        <Input key={fieldKey(d.v, key, 'rules.add')} placeholder={hint} value={value} onInput={keep} onSubmit={submit} />
      </Box>)
    const keepSlug = (t: string) => { ln.slug = String(t || '') }
    const keepText = (t: string) => { ln.text = String(t || '') }
    const keepRole = (t: string) => { ln.role = String(t || '') }
    parts.push(
      <Box key="set-addline" flexDirection="column" rowGap={0.6} borderStyle="round" borderDimColor paddingX={1} paddingY={0.5}>
        <Text weight="semibold">Add a rule line</Text>
        <Box key="set-addf1" flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0.5}>
          <Box key="set-slugbox" flexGrow={1} width={12} flexShrink={1} minWidth={0}>{field('set-line-slug', 'Name', 'few-tests', ln.slug, keepSlug, keepSlug)}</Box>
          <Box key="set-textbox" flexGrow={3} width={20} flexShrink={1} minWidth={0}>{field('set-line-text', 'Rule', 'the rule in plain words', ln.text, keepText, go)}</Box>
        </Box>
        <Box key="set-addf2" flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0.5} alignItems="center">
          <Text key="set-forlab" dimColor>For</Text>
          {who}
          {ln.for === 'agents' ? <Box key="set-rolebox" width={16} flexShrink={1} minWidth={0}>{field('set-line-role', 'Role (optional)', 'review', ln.role || '', keepRole, go)}</Box> : null}
          <Box key="set-addon" flexGrow={1} flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{'on ' + home + ', everywhere'}</Text></Box>
          {actButton(d, 'set-line-add', 'Add', go)}
        </Box>
        {noteOf(d, { key: 'rules.add' })}
      </Box>)
  }
  /* the lines home switched off, each with Bring back, as the board page lists them */
  const drops = ((d.m.json.drops || []) as string[]).filter((x) => typeof x === 'string' && x)
  parts.push(listHead(d, drop, drops.length > 0))
  if (drops.length) {
    const gone = (slug: string): LineSide => ({ chip: 'everywhere, on ' + home, label: 'Bring back', press: 'set-back-' + slug, who: 'dropped', dim: true, row: 'set-d' })
    parts.push(<Box key="set-drops" flexDirection="column" rowGap={0.6}>{drops.map((slug) => lineRow(d, { slug, words: 'Off for every session and agent this profile reaches.' }, false,
      () => d.act.rule('clear', home, slug), gone(slug)))}</Box>)
  }
  parts.push(<Box key="set-dropnote"><Text dimColor wrap="wrap">{'Press Drop on a built-in line to switch it off on ' + home + ', everywhere.'}</Text></Box>)
  if (built.length && !d.v.only) parts.push(builtinFold(d, built, home))
  return card(d, 'set-card-rules', parts)
}

function listHead(d: Draw, l: any, changed: boolean): any {
  return settingHead(d, { key: l.key || 'rules', label: l.label || '', line: l.line || '', changed })
}
/* a list setting's label and line, its fold the copy alone */
function settingHead(d: Draw, row: any): any {
  const { Box, Text } = d.els
  const k = row.key
  const l = ((d.m.json.lists || []) as any[]).find((x: any) => x.key === k) || {}
  return (
    <Box key={'set-row-' + k} flexDirection="column" rowGap={0.3}>
      {labelOf(d, row, moreRing(d, k))}
      <Box key={'set-help-' + k}><Text dimColor wrap="wrap">{row.line}</Text></Box>
      {d.v.more.has(k) ? moreFold(d, { ...l, key: k, editable: false }) : null}
    </Box>)
}

/* a scope as the board's chip: a rounded outline on the desktop, the words in brackets on the terminal */
function tagChip(d: Draw, key: string, words: string): any {
  const { Box, Text } = d.els
  if (!d.desk) return <Text key={key} dimColor>{'(' + words + ')'}</Text>
  return (
    <Box key={key} borderStyle="round" borderDimColor paddingX={0.8} paddingY={0} flexShrink={1} minWidth={0}>
      <Text dimColor wrap="truncate-end">{words}</Text>
    </Box>)
}
/* the right part of a rule row: the board's 290 px, in the pane's cells, room for a chip and Bring back */
const LINE_SIDE = 35
/* a rule line as the board's row: its name and audience, its words, then its chip and Drop on the
   right; at a mid width the chip and Drop go under the words, narrow it all stacks. A dropped
   line (`gone`) draws the same row with Bring back, as the board's dropped list does */
type LineSide = { chip: string; label: string; press: string; who?: string; dim?: boolean; row?: string }
function lineRow(d: Draw, l: any, mine: boolean, onDrop: () => void, gone?: LineSide): any {
  const { Box, Text } = d.els
  const k = l.slug
  const s: LineSide = gone || { chip: (l.scope || l.layer) + (mine && l.profile ? ', on ' + l.profile : ''), label: 'Drop', press: 'set-drop-' + k }
  const r = s.row || 'set-l'
  const side = (
    <Box key={r + 'kc-' + k} flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0.4} alignItems="center" {...(d.wide ? { justifyContent: 'flex-end' } : {})}>
      {tagChip(d, r + 'scope-' + k, s.chip)}
      {actButton(d, s.press, s.label, onDrop)}
    </Box>)
  const name = (
    <Box key={r + 'lc-' + k} flexDirection="column" flexShrink={1} minWidth={0}>
      <Text weight="semibold" wrap="wrap">{l.slug}</Text>
      <Text key={r + 'who-' + k} dimColor wrap="wrap">{s.who || (l.role ? 'for ' + l.role + ' agents' : AUDIENCE[l.audience] || AUDIENCE.both)}</Text>
    </Box>)
  const words = <Box key={r + 'w-' + k} flexShrink={1} minWidth={0}><Text wrap="wrap" dimColor={!!s.dim}>{l.words}</Text></Box>
  /* the desktop's faint tile per row; a terminal's border would draw, so there the rows stand bare */
  const tile = d.desk ? { backgroundColor: TILE, borderStyle: 'round', borderColor: CLEAR, paddingX: 1, paddingY: 0.4 } : {}
  if (d.wide) {
    return (
      <Box key={r + 'row-' + k} {...tile} flexDirection="row" columnGap={2} alignItems="flex-start">
        <Box key={r + 'nc-' + k} width={0} flexGrow={0.9}>{name}</Box>
        <Box key={r + 'cc-' + k} width={0} flexGrow={2.4}>{words}</Box>
        <Box key={r + 'sc-' + k} width={LINE_SIDE} flexShrink={0} flexDirection="row" justifyContent="flex-end">{side}</Box>
      </Box>)
  }
  if (d.cols >= MID) {
    return (
      <Box key={r + 'row-' + k} {...tile} flexDirection="row" columnGap={2} alignItems="flex-start">
        <Box key={r + 'nc-' + k} width={0} flexGrow={0.9}>{name}</Box>
        <Box key={r + 'cc-' + k} width={0} flexGrow={2} flexDirection="column" rowGap={0.5}>{[words, side]}</Box>
      </Box>)
  }
  return <Box key={r + 'row-' + k} {...tile} flexDirection="column" rowGap={0.5}>{[name, words, side]}</Box>
}

/* the built-in lines, shut by default: the count and their names cut at the row's end */
function builtinFold(d: Draw, built: any[], home: string): any {
  const { Box, Text } = d.els
  const title = (!d.desk && d.cols < 40 ? 'Built-in (' : 'Built-in lines (') + built.length + ')'
  const open = d.v.builtins
  const inner = d.cols - 4
  const room = d.desk ? inner - FOLD_CELLS - paneCells(title, 600) - 1 : inner - cellWidth(title) - 4
  const names = built.map((l: any) => l.slug).join(', ')
  const rest = !open && room >= 10 ? [<Box key="set-bnames" flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{d.desk ? fitWords(names, room) : clampWords(names, Math.floor(room * 1.2), 1)}</Text></Box>] : []
  const head = foldHead(d.els, { key: 'set-bhead', press: 'set-builtins', open, toggle: () => { d.v.builtins = !open; d.act.redraw() }, desk: d.desk, cols: inner,
    title: <Text weight="semibold" wrap="wrap">{title}</Text>, rest, titleCells: d.desk ? paneCells(title, 600) : cellWidth(title) })
  const rows = open ? [<Box key="set-built" flexDirection="column" rowGap={0.6}>{built.map((l: any) => lineRow(d, l, false, () => d.act.rule('drop', home, l.slug)))}</Box>] : []
  return <Box key="set-builtins-fold" flexDirection="column" rowGap={1}>{[head, ...rows]}</Box>
}
