/* The Needs-you band's tree: one open
 * question as one row with its chips, several as a count line, what waits for this
 * session with its submit chip; nothing at all when nothing is open or waiting. The
 * meters, the guard, the thread and the shelf are the status line's, which index.ts adds
 * as the band's last row on the desktop. The desktop draws the
 * marks as pictures; the shelf, pane and board presses left for the status row and pane.
 * Drawn from the model alone; index.ts owns every read and write. */
import { CARD_CELLS, SKY, TILE_GAP, cardColors, factTip, pressFace, pressOver, tileLook, tilePress, wordLink } from './status.tsx'
import { OPEN, SHUT, foldEnd, foldRing } from './fold.tsx'
import {
  COUNT_MARK, STAR, ageText, answerLabels, badgePicture, callCard, cardText, cellWidth, chipCard, chipText, countCard, countTip, facePicture, foldCard,
  inboxCard, markPicture, paneMeasure, queuedLabel, rowGap, rowNeed, submitTip, waitingLabel,
} from '../../lib/mod-core.mjs'

/* a pressed chip's state, while its CLI runs, after it took, after it failed */
export type ChipState = 'pending' | 'done' | 'failed'
export type BandAnswer = { letter: string; token: string; option: string; gets?: string; catch?: string; undo?: string; state?: ChipState; error?: string }
export type BandQuestion = { id: string; name: string; ask?: string; crux?: string; reverses?: string; blocking: boolean; pick: string | null; answers: BandAnswer[]; born?: number; version?: number }
/* a call the board raises (callRows), any kind alike; a press runs its verb as the user or opens its page */
export type BandPress = { label: string; verb: string | null; input?: any; url?: string; does?: string }
/* short: the row's one line; the rest of callRows' facts ride along for the card (callCard) */
export type BandCall = { key: string; kind: string; id?: string | null; text: string; short?: string; since?: string | null; until?: string | null; url?: string | null; mine?: boolean; presses: BandPress[]; [k: string]: any }

/* short: the app's box holds the band's foot; rows: the site's budget, maxRows;
   surface: the cards' colors (cardColors) and the desktop's pictures; open: the pane on Questions;
   cards false: no hover cards (Home's copy, as the dock pane draws them empty);
   unfold: Home's fold ring ending a desktop question's row and what it unfolds */
export type BandOpts = {
  columns?: number; rows?: number; now?: number; short?: boolean; surface?: string
  open?: (q?: BandQuestion) => void; submit?: () => void; cards?: boolean
  /* Send, which records and delivers the answers queued on this PC */
  send?: () => void
  unfold?: { open: (id: string) => boolean; toggle: (id: string) => void }
  /* press: a call's verb press; fold: several override requests' count line, unfolded or not */
  press?: (c: BandCall, p: BandPress) => void; fold?: { open: boolean; toggle: () => void }
}

/* the hovered question row's tint on the terminal, the Questions pane's pick-row theme key */
const TINT = 'userMessageBackground'
const GAP = 3
const DOT = '●', WAIT = '✓', CALL = '\u25C6'
/* the word that leads a one-way line */
const ONE_WAY = 'one-way'.length
/* a terminal button draws two cells each side of its label */
const chipWidth = (label: string) => cellWidth(label) + 4
/* Home's copy draws no cards: it is the pane's, off the band */
const onBand = (opts: BandOpts) => opts.cards !== false

/* a mark, the desktop's picture or the terminal's glyph */
function mark(els: any, opts: BandOpts, kind: 'blocking' | 'open' | 'inbox', glyph: any): any {
  const { Svg } = els
  if (opts.surface !== 'desktop' || !Svg) return glyph
  const p = markPicture(kind, 'rest', true)
  return <Svg source={p.source} alt={p.alt} width={p.width} height={p.height} />
}

/* Lines past what the rows above can hold ride the last one. */
function foldLines(lines: string[], max: number): string[] {
  return lines.length <= max ? lines : [...lines.slice(0, max - 1), lines.slice(max - 1).join('; ')]
}

/* A hover card, hidden until the keyed Box around it is hovered. The desktop ignores
   `right`, so the card is sized from its text, cut at the band's width, and
   moved left only as far as it would overrun the band; x is where its element starts. A
   site clips what paints outside it, so a card rises at most `up` rows, the rows above. */
function hoverCard(els: any, text: string | string[], x: number, opts: BandOpts, up = 0, body?: any[], cap = Infinity): any {
  const { Box, Text } = els
  if (opts.cards === false) return null
  const columns = opts.columns
  const card = cardColors(opts.surface)
  /* a desktop lifts the card into its own popover, unclipped, so there it wraps whole */
  const desk = opts.surface === 'desktop'
  const all = Array.isArray(text) ? text : [text]
  const lines = desk ? all : foldLines(all, up + 1)
  const wide = Math.min(cap, Math.max(1, ...lines.map((l) => cellWidth(l))))
  const fits = Number.isFinite(columns)
  const width = fits ? Math.max(1, Math.min(wide, columns as number)) : wide
  const left = fits ? Math.max(-x, Math.min(0, (columns as number) - x - width)) : 0
  /* a desktop card with a body draws it, its parts half a line apart */
  const rich = desk && body
  return (
    <Box position="absolute" top={1 - lines.length} left={left} width={width} flexDirection="column"
      display="none" hover={{ display: 'flex' }} backgroundColor={card.bg} {...(rich ? { rowGap: 1 } : {})}>
      {rich ? body : lines.map((l, i) => <Text key={'card-line-' + i} color={card.text} wrap={desk ? 'wrap' : 'truncate-end'}>{l}</Text>)}
    </Box>
  )
}

/* a row's card of a head and groups, the status row's fact
   card on the desktop, as wide as the app's popover; the terminal's plain lines, else the card's one */
function factHover(els: any, key: string, card: any, kind: 'call' | 'open' | 'inbox', x: number, opts: BandOpts, up = 0, plain?: string | string[]): any {
  const { Svg } = els
  if (opts.surface !== 'desktop' || !Svg) return hoverCard(els, plain || [cardText(card)], x, opts, up)
  const p = markPicture(kind, 'rest', true)
  return hoverCard(els, [cardText(card)], x, opts, up, factTip(els, key, card, <Svg source={p.source} alt={p.alt} width={p.width} height={p.height} />), CARD_CELLS)
}

/* a question's desktop card: a reversal's ruling, the tray face beside the id
   and name in bold, the ask, the crux in italics, and how long it has waited in the secondary gray */
function questionCard(els: any, q: BandQuestion, now?: number, open?: () => void): any[] {
  const { Box, Text, Svg } = els
  const p = facePicture(q.blocking)
  const age = q.born && Number.isFinite(now) ? ', asked ' + ageText((now as number) - q.born) + ' ago' : ''
  const title = q.id + ' ' + q.name
  const face = [Svg ? <Svg source={p.source} alt={p.alt} width={p.width} height={p.height} /> : null, <Text bold wrap="wrap">{title}</Text>]
  /* Home's unfolded card names the question under its row, so its head opens the pane at it too */
  const pressed = open ? pressFace(els, 'qc-headface-' + q.id, face, pressOver(els, 'qu-name-' + q.id, cellWidth(title) + 3, open), { shrink: true, gap: 1 }) : null
  return [
    q.reverses ? <Box key={'qc-rev-' + q.id}><Text wrap="wrap">{q.reverses}</Text></Box> : null,
    <Box key={'qc-head-' + q.id} flexDirection="row" columnGap={1}>{pressed || face[0]}{pressed ? null : face[1]}</Box>,
    q.ask ? <Box key={'qc-ask-' + q.id}><Text wrap="wrap">{q.ask}</Text></Box> : null,
    q.crux ? <Box key={'qc-crux-' + q.id}><Text italic wrap="wrap">{q.crux}</Text></Box> : null,
    <Box key={'qc-foot-' + q.id}><Text color="inactive" wrap="wrap">{(q.blocking ? 'blocking' : 'waiting') + age}</Text></Box>,
  ].filter(Boolean)
}

/* an option's desktop card: the option in bold (the pick starred), what happens
   and the catch in the warning color, a one-way line when hard to undo, the press it names.
   the title leads with the option's badge; the token stays in the press line. */
function optionCard(els: any, a: BandAnswer, pick: boolean, press: boolean): any[] {
  const { Box, Text, Svg } = els
  const c = chipCard(a, pick)
  const k = a.token
  const p = badgePicture(a.letter)
  return [
    <Box key={'oc-title-' + k} flexDirection="row" columnGap={0.6}>
      {Svg ? <Svg source={p.source} alt={p.alt} width={p.width} height={p.height} /> : null}
      <Text bold wrap="wrap">{pick ? <Text color={SKY}>{STAR + ' '}</Text> : null}{a.option}</Text>
    </Box>,
    c.gets || c.catch ? (
      <Box key={'oc-body-' + k} flexDirection="column">
        {c.gets ? <Box key={'oc-gets-' + k}><Text wrap="wrap">{c.gets}</Text></Box> : null}
        {c.catch ? <Box key={'oc-catch-' + k}><Text color="warning" wrap="wrap">{'Catch: ' + c.catch}</Text></Box> : null}
      </Box>
    ) : null,
    c.oneWay ? <Box key={'oc-oneway-' + k}><Text wrap="wrap"><Text color="warning" bold>{c.oneWay.slice(0, ONE_WAY)}</Text>{c.oneWay.slice(ONE_WAY)}</Text></Box> : null,
    press ? <Box key={'oc-press-' + k}><Text color="inactive" wrap="wrap">{c.press}</Text></Box> : null,
  ].filter(Boolean)
}

/* Home's unfolded question under its row: the card's content, then every option's,
   each a tile that answers on a press anywhere on it */
function unfoldTree(els: any, q: BandQuestion, onAnswer: (q: BandQuestion, a: BandAnswer) => void, opts: BandOpts): any {
  const { Box } = els
  const options = q.answers.map((a) => (
    <Box key={'qu-opt-' + a.token} flexDirection="column" paddingX={1} {...tileLook(q.pick === a.letter, true)}>
      {[tilePress(els, 'qu-tile-' + a.token, opts.columns || 200, () => onAnswer(q, a)), ...optionCard(els, a, q.pick === a.letter, false)]}
    </Box>
  ))
  return (
    <Box key={'qunfold-' + q.id} flexDirection="column" rowGap={1} paddingLeft={3}>
      {questionCard(els, q, opts.now, opts.open ? () => opts.open!(q) : undefined)}
      <Box key={'qu-tiles-' + q.id} flexDirection="column" rowGap={TILE_GAP.rowGap}>{options}</Box>
    </Box>
  )
}

/* the pane's words in cells, as rowNeed measures them (8.453 px a desktop cell) */
const nameCells = (s: string, desk: boolean) => (desk ? paneMeasure(s, 14, 400) / 8.453 : cellWidth(s))
/* Home's name on its own lines: broken at the last space that fits `room`, the rest on the second,
   which cuts with an ellipsis where it still overflows */
function nameLines(name: string, room: number, desk: boolean): string[] {
  const words = name.split(' ')
  if (nameCells(name, desk) <= room || words.length < 2) return [name]
  let i = 1
  while (i < words.length - 1 && nameCells(words.slice(0, i + 1).join(' '), desk) <= room) i++
  return [words.slice(0, i).join(' '), words.slice(i).join(' ')]
}

/* One open question: the mark, its label in bold then the name (a press opens the pane at it), a chip
   per answer, the age. In Home's copy a name the row cannot hold goes under the chips, at
   most two lines. The label stays whole; the name cuts first */
function questionRow(els: any, q: BandQuestion, onAnswer: (q: BandQuestion, a: BandAnswer) => void, opts: BandOpts, closed: string): any {
  const { Box, Text, Button } = els
  const cols = opts.columns
  const onDesk = opts.surface === 'desktop'
  const glyph = q.blocking ? mark(els, opts, 'blocking', <Text color="warning">{DOT}</Text>) : mark(els, opts, 'open', <Text dimColor>{DOT}</Text>)
  /* Home's fold ring ends the row's first line */
  const fold = onDesk ? opts.unfold : undefined
  const age = q.born && Number.isFinite(opts.now) ? ageText((opts.now as number) - q.born) : ''
  const fit = { surface: opts.surface, age, closed, unfold: !!fold }
  /* the fit counts the label with the name, a cell more for its bold */
  const said = { ...q, name: q.id + '  ' + q.name }
  const labels = answerLabels(said, cols as number, fit)
  /* a narrow row's gaps close before its name cuts */
  const gap = rowGap(said, cols as number, fit)
  const wordy = q.answers.some((a, i) => labels[i] !== (q.pick === a.letter ? STAR + ' ' : '') + a.letter)
  const own = !onBand(opts) && Number.isFinite(cols) && rowNeed(said, fit, wordy, Infinity, gap) > (cols as number)
  /* the line's room past the mark and the label (the ring stays on the first line), a cell spare for the pane's wider letters */
  const lines = own ? nameLines(q.name, (cols as number) - (onDesk ? 3 : 2) - 1 - cellWidth(q.id) - 2, onDesk) : [q.name]
  /* on the desktop the name takes the band's one weight, as its labels do */
  const faceOf = (s: string) => (onDesk ? <Text wrap="truncate-end">{s}</Text> : <Text weight="semibold" wrap="truncate-end">{s}</Text>)
  const words = lines.length < 2 ? faceOf(lines[0])
    : <Box key={'qlines-' + q.id} flexDirection="column" flexShrink={1} minWidth={0}>{lines.map((s, i) => <Box key={'qline-' + i} minWidth={0}>{faceOf(s)}</Box>)}</Box>
  const labeled = (rest: any) => (
    <Box key={'qlabeled-' + q.id} flexDirection="row" columnGap={1} flexShrink={1} minWidth={0} alignItems="flex-start">
      <Box key={'qlabel-' + q.id} flexShrink={0}><Text bold>{q.id}</Text></Box>
      <Box key={'qwords-' + q.id} flexShrink={1} minWidth={0}>{rest}</Box>
    </Box>
  )
  const open = opts.open
  /* the desktop's name lights as every press does, its press laid over the label and words;
     the terminal's press is the words' Button */
  const name = !open ? labeled(words) : onDesk
    ? pressFace(els, 'qnameface-' + q.id, labeled(words), pressOver(els, 'name-' + q.id, cellWidth(said.name), () => open(q), undefined, onBand(opts)), { shrink: true })
    : labeled(lines.length < 2 ? <Button key={'name-' + q.id} plain onPress={() => open(q)}>{words}</Button>
      : <Box key={'qlines-' + q.id} flexDirection="column">{lines.map((s, i) => <Button key={(i ? 'name' + i + '-' : 'name-') + q.id} plain onPress={() => open(q)}>{faceOf(s)}</Button>)}</Box>)
  /* a reversal's card leads with the ruling it reopens */
  const tip = [q.reverses, q.ask, q.crux].filter(Boolean) as string[]
  const desk = onDesk && opts.cards !== false
  const card = desk ? hoverCard(els, [q.id + ' ' + q.name, ...tip], 2, opts, 0, questionCard(els, q, opts.now)) : tip.length ? hoverCard(els, tip, 2, opts) : null
  const ring = fold
    ? foldRing(els, fold.open(q.id), { key: 'qarrow-' + q.id, pressKey: 'unfold-' + q.id, press: () => fold.toggle(q.id), band: onBand(opts) })
    : null
  const dot = <Box key={'qdot-' + q.id} flexShrink={0}>{glyph}</Box>
  const head = (
    <Box key={'qhead-' + q.id} flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>
      {own ? null : dot}
      <Box key={'qname-' + q.id} flexShrink={1} minWidth={0}>{name}{card}</Box>
    </Box>
  )
  /* the name sits one cell from its chips, as the chips from each other; the row's gap parts the rest */
  let x = 2 + cellWidth(said.name) + 1
  const chips = q.answers.map((a, i) => {
    const pick = q.pick === a.letter
    const named = labels[i] !== (pick ? STAR + ' ' : '') + a.letter
    const at = x
    /* the terminal's letter takes a cell of sky each side */
    x += chipWidth(labels[i]) + 3
    const card = hoverCard(els, chipText(a, pick), at, opts, 0, desk ? optionCard(els, a, pick, true) : undefined)
    return <Box key={'chip-' + a.token} flexShrink={0}>{chipFace(els, a, pick, named, () => onAnswer(q, a), opts)}{card}</Box>
  })
  const chipRow = <Box key={'qchips-' + q.id} flexDirection="row" columnGap={1} flexShrink={0}>{chips}</Box>
  const parts: any[] = [chipRow]
  if (age) parts.push(<Box key={'qage-' + q.id} flexShrink={0}><Text dimColor tabular>{age}</Text></Box>)
  if (closed) parts.push(<Box key="closed" flexShrink={0}><Text dimColor>{closed}</Text></Box>)
  if (ring) parts.push(foldEnd(els, ring, gap))
  const lead = <Box key={'qlead-' + q.id} flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>{head}{chipRow}</Box>
  if (!own) return <Box key={'q-' + q.id} flexDirection="row" columnGap={gap} {...rowLook(opts)}>{[lead, ...parts.slice(1)]}</Box>
  /* the name half a line under the chips, as Home's status row wraps */
  return (
    <Box key={'q-' + q.id} flexDirection="row" columnGap={1} alignItems="flex-start" {...rowLook(opts)}>
      {dot}
      <Box key={'qbody-' + q.id} flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} {...(onDesk ? { rowGap: 1 } : {})}>
        <Box key={'qtop-' + q.id} flexDirection="row" columnGap={gap}>{parts}</Box>
        {head}
      </Box>
    </Box>
  )
}

/* the terminal's tint hugs the row's content; a desktop row takes none (the
   dark bar). A desktop row spans the band, so its words cut, never its presses */
const rowLook = (opts: BandOpts) => (opts.surface === 'desktop' ? {} : { alignSelf: 'flex-start', hover: { backgroundColor: TINT } })

/* a desktop chip is a face, the letter's sky badge then the star and words
   where the row has room, its press laid over and keyed answer-<token>; the terminal's a Button,
   the letter on a sky ground, the pick's primary. Letters only, the pick keeps its star */
function chipFace(els: any, a: BandAnswer, pick: boolean, named: boolean, press: () => void, opts: BandOpts): any {
  const { Text, Button, Svg } = els
  if (opts.surface === 'desktop' && Svg) {
    const p = badgePicture(a.letter)
    const said = (pick ? STAR + (named ? ' ' : '') : '') + (named ? a.option : '')
    const words = said ? <Text>{pick ? <Text color={SKY}>{named ? STAR + ' ' : STAR}</Text> : null}{named ? a.option : null}</Text> : null
    const cells = Math.ceil(p.width / 8) + (said ? cellWidth(said) + 1 : 0)
    return pressFace(els, 'chipface-' + a.token, [<Svg source={p.source} alt={p.alt} width={p.width} height={p.height} />, words],
      pressOver(els, 'answer-' + a.token, cells, press, undefined, onBand(opts)), { chip: { pick, only: !said } })
  }
  return (
    <Button key={'answer-' + a.token} onPress={press} {...(pick ? { variant: 'primary' } : {})}>
      {pick ? STAR + ' ' : ''}<Text backgroundColor={SKY} color="#0b0b0b">{' ' + a.letter + ' '}</Text>{named ? ' ' + a.option : ''}
    </Button>
  )
}

/* what waits for this session, its lines on the mark's card,
   and the one press that starts a turn with it; `brief` where it shares the count line. */
function waitingGroup(els: any, w: any, opts: BandOpts, x: number, row: number, brief: boolean): any {
  const { Box, Text, Button } = els
  const label = brief ? w.n + ' waiting' : waitingLabel(w)
  const submit = 'submit ' + w.n
  const at = x + 2 + label.length + GAP
  return (
    <Box key="inbox" flexDirection="row" columnGap={GAP} flexShrink={0}>
      <Box key="inbox-head" flexDirection="row" columnGap={1}>
        <Box key="inbox-mark">{mark(els, opts, 'inbox', <Text color="success">{WAIT}</Text>)}{factHover(els, 'inbox', inboxCard(w), 'inbox', x, opts, row, w.lines || [])}</Box>
        <Text key="inbox-label">{label}</Text>
      </Box>
      <Box key="inbox-submit-chip">
        <Button key="inbox-submit" label={submit} onPress={() => { if (opts.submit) opts.submit() }} />
        {hoverCard(els, submitTip(w), at, opts)}
      </Box>
    </Box>
  )
}

/* the answers queued on this PC and the one press that sends them all */
function queuedGroup(els: any, n: number, opts: BandOpts): any {
  const { Box, Text, Button } = els
  return (
    <Box key="queued" flexDirection="row" columnGap={1} flexShrink={0}>
      <Box key="queued-label" flexShrink={0}><Text color="warning">{queuedLabel(n)}</Text></Box>
      <Button key="queued-send" label="Send" onPress={() => { if (opts.send) opts.send() }} />
    </Box>
  )
}

/* Several open questions, or only what waits: the user's count line. Frozen, it leads with
   the frozen mark and drops the blocking count. */
function countRow(els: any, m: any, opts: BandOpts, closed: string, inbox: any, queued = 0): any {
  const { Box, Text } = els
  const parts: any[] = []
  let x = 0
  if (closed) {
    parts.push(<Box key="closed" flexShrink={0}><Text dimColor>{closed}</Text></Box>)
    x += cellWidth(closed) + GAP
  }
  if (m.total) {
    const { Button } = els
    const open = opts.open
    const desk = opts.surface === 'desktop' && !!els.Svg
    const words = m.total + ' open'
    const head = desk ? words : COUNT_MARK + ' ' + words
    const blocking = m.blocking && !closed ? m.blocking + ' blocking' : ''
    /* "N open" is the press that opens the pane on Questions */
    const face = <Text tabular>{head}</Text>
    const press = open && !desk ? <Button key="count-open-press" plain onPress={() => open()}>{face}</Button> : face
    /* on the desktop the mark and the words light and press as one, as the status row's do */
    const over = open && desk ? pressOver(els, 'count-open-press', 3 + cellWidth(head), () => open(), undefined, onBand(opts)) : null
    const card = factHover(els, 'count', countCard(m), 'open', x, opts, 0, countTip(m))
    parts.push(desk ? (
      <Box key="count-mark" flexDirection="row" columnGap={2} flexShrink={0}>
        {over ? pressFace(els, 'count-open', [mark(els, opts, 'open', null), press], over, { gap: 1 })
          : <Box key="count-open" flexDirection="row" columnGap={1}>{mark(els, opts, 'open', null)}{press}</Box>}
        {blocking ? <Box key="count-blocking" flexDirection="row" columnGap={1}>{mark(els, opts, 'blocking', null)}<Text color="warning" tabular>{blocking}</Text></Box> : null}
        {card}
      </Box>
    ) : (
      <Box key="count-mark" flexDirection="row" flexShrink={0}>
        {press}{blocking ? <Text>{', '}<Text color="warning">{blocking}</Text></Text> : null}{card}
      </Box>
    ))
    /* the mark is two cells wide */
    x += 1 + cellWidth(head) + (blocking ? 2 + blocking.length : 0) + GAP
  }
  if (inbox) parts.push(waitingGroup(els, inbox, opts, x, 0, !!m.total))
  if (queued) parts.push(queuedGroup(els, queued, opts))
  /* a queued count wraps under the rest rather than cut its Send */
  return <Box key="count" flexDirection="row" columnGap={GAP} {...(queued ? { flexWrap: 'wrap' } : {})}>{parts}</Box>
}

/* a call's mark, the flag picture on the desktop */
function callMark(els: any, opts: BandOpts): any {
  const { Svg, Text } = els
  if (opts.surface !== 'desktop' || !Svg) return <Text color={SKY}>{CALL}</Text>
  const p = markPicture('call', 'rest', true)
  return <Svg source={p.source} alt={p.alt} width={p.width} height={p.height} />
}

/* One press of a call: a verb through opts.press as the user's act; a page through a Link, since no API
   opens a URL from a press */
function callPress(els: any, c: BandCall, p: BandPress, i: number, opts: BandOpts): any {
  const { Text, Button } = els
  const key = 'callpress-' + i + '-' + c.key
  const desk = opts.surface === 'desktop' && !!els.Svg
  if (!p.verb) return p.url ? wordLink(els, key, p.url, p.label, desk) : null
  const act = () => { if (opts.press) opts.press(c, p) }
  if (desk) return pressFace(els, key + '-face', <Text>{p.label}</Text>, pressOver(els, key, cellWidth(p.label) + 1, act, undefined, onBand(opts)), { chip: {} })
  return <Button key={key} label={p.label} onPress={act} />
}

/* One call as one compact row: the mark and its short line, its fact card on hovering either, its
   presses. Home's copy ends the row with the fold ring that unfolds the card under it. */
function callRow(els: any, c: BandCall, opts: BandOpts, x = 0): any {
  const { Box, Text } = els
  const fold = opts.surface === 'desktop' ? opts.unfold : undefined
  const ring = fold
    ? foldRing(els, fold.open(c.key), { key: 'carrow-' + c.key, pressKey: 'cunfold-' + c.key, press: () => fold.toggle(c.key), band: onBand(opts) })
    : null
  const head = (
    <Box key={'chead-' + c.key} flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>
      <Box key={'cmark-' + c.key} flexShrink={0}>{callMark(els, opts)}</Box>
      <Box key={'ctext-' + c.key} flexShrink={1} minWidth={0}><Text wrap="truncate-end">{c.short || c.text}</Text></Box>
      {factHover(els, 'call-' + c.key, callCard(c), 'call', x, opts)}
    </Box>
  )
  const presses = c.presses.map((p, i) => callPress(els, c, p, i, opts)).filter(Boolean)
  const parts = [head, <Box key={'cpresses-' + c.key} flexDirection="row" columnGap={1} flexShrink={0}>{presses}</Box>]
  if (ring) parts.push(foldEnd(els, ring, GAP))
  return <Box key={'call-' + c.key} flexDirection="row" columnGap={GAP} {...rowLook(opts)}>{parts}</Box>
}

/* Home's unfolded call under its row: the fact card's body, so the batch's measure reads in the pane */
function callUnfold(els: any, c: BandCall, opts: BandOpts, indent: number): any {
  const { Box, Svg } = els
  if (opts.surface !== 'desktop' || !opts.unfold || !opts.unfold.open(c.key)) return null
  const p = markPicture('call', 'rest', true)
  const pic = Svg ? <Svg source={p.source} alt={p.alt} width={p.width} height={p.height} /> : null
  return <Box key={'cunfolded-' + c.key} flexDirection="column" rowGap={1} paddingLeft={indent}>{factTip(els, 'cu-' + c.key, callCard(c), pic)}</Box>
}

/* Several override requests as one count line, as several questions fold; its card names
   them and its press unfolds their rows under it. On the desktop, the band's and Home's
   alike, the whole row is the press and the fold ring ends it, lit from anywhere on the row */
function foldRow(els: any, list: BandCall[], opts: BandOpts): any {
  const { Box, Text, Button } = els
  const open = !!(opts.fold && opts.fold.open)
  const words = list.length + ' override requests wait on your Allow or Keep'
  const toggle = () => { if (opts.fold) opts.fold.toggle() }
  if (opts.surface === 'desktop' && els.Svg) {
    /* the card hangs on the row, since the row's press lies over the words */
    return (
      <Box key="calls-overrides" flexDirection="row" columnGap={1}>
        {pressOver(els, 'calls-fold', Number.isFinite(opts.columns) ? (opts.columns as number) : 200, toggle, undefined, onBand(opts))}
        <Box key="calls-overrides-mark" flexShrink={0}>{callMark(els, opts)}</Box>
        <Box key="calls-overrides-words" flexShrink={1} minWidth={0}><Text wrap="truncate-end">{words}</Text></Box>
        {foldEnd(els, foldRing(els, open), 1)}
        {factHover(els, 'calls-fold', foldCard(list), 'call', 0, opts, 0)}
      </Box>
    )
  }
  return (
    <Box key="calls-overrides" flexDirection="row" columnGap={1} {...rowLook(opts)}>
      <Box key="calls-overrides-mark" flexShrink={0}>{callMark(els, opts)}</Box>
      <Box key="calls-overrides-words" flexShrink={1} minWidth={0}>
        <Button key="calls-fold" plain onPress={toggle}><Text>{(open ? OPEN : SHUT) + ' ' + words}</Text></Button>
        {factHover(els, 'calls-fold', foldCard(list), 'call', 2, opts, 0, list.map((c) => c.text))}
      </Box>
    </Box>
  )
}

/* The calls' rows in the board's order, the overrides folded where the first stood when there are several. */
function callTrees(els: any, cs: BandCall[], opts: BandOpts): any[] {
  const { Box } = els
  const overrides = cs.filter((c) => c.kind === 'override')
  const fold = overrides.length > 1
  const out: any[] = []
  for (const c of cs) {
    if (!fold || c.kind !== 'override') out.push(callRow(els, c, opts), callUnfold(els, c, opts, 3))
    else if (c === overrides[0]) {
      out.push(foldRow(els, overrides, opts))
      if (opts.fold && opts.fold.open) {
        for (const o of overrides) out.push(<Box key={'unfolded-' + o.key} flexDirection="column" paddingLeft={3}>{callRow(els, o, opts, 3)}</Box>, callUnfold(els, o, opts, 6))
      }
    }
  }
  return out.filter(Boolean)
}

/* the board stopped answering, so what the band draws is this PC's last copy */
function offlineRow(els: any, line: string): any {
  const { Box, Text } = els
  return (
    <Box key="band-offline" flexDirection="row" columnGap={1}>
      <Box key="offline-word" flexShrink={0}><Text color="warning">{line}</Text></Box>
      <Text dimColor wrap="truncate-end">{'drawn from this PC\'s last copy'}</Text>
    </Box>
  )
}

/* The band's tree, or null when there is nothing to draw (the band's own rule). */
export function bandTree(els: any, m: any, onAnswer: (q: BandQuestion, a: BandAnswer) => void, opts: BandOpts = {}): any {
  const { Box } = els
  const short = !!opts.short
  const closed = short ? '' : m.closed || ''
  const inbox = m.inbox && m.inbox.n > 0 ? m.inbox : null
  const queued = Number.isInteger(m.queued) && m.queued > 0 ? m.queued as number : 0
  const qs = (m.questions || []) as BandQuestion[]
  const rows: any[] = []
  /* the foot row holds only what waits under a single question */
  let foot: any = null
  if (m.total === 1 && qs.length === 1) {
    /* a pressed chip vanishes at once, its row with it; no pressed or saving look */
    if (!qs[0].answers.some((a) => a.state === 'pending' || a.state === 'done')) {
      rows.push(questionRow(els, qs[0], onAnswer, opts, closed))
      if (opts.surface === 'desktop' && opts.unfold && opts.unfold.open(qs[0].id)) rows.push(unfoldTree(els, qs[0], onAnswer, opts))
    }
    if (inbox || queued) foot = [inbox ? waitingGroup(els, inbox, opts, 0, 1, false) : null, queued ? queuedGroup(els, queued, opts) : null].filter(Boolean)
  } else if (m.total || inbox || queued) {
    rows.push(countRow(els, m, opts, closed, inbox, queued))
  }
  const cs = (Array.isArray(m.calls) ? m.calls : []) as BandCall[]
  /* a frozen band's receipt stays where the pressed row went, so the press shows it landed */
  if (!rows.length && closed && (m.saved || cs.length)) rows.push(countRow(els, { total: 0 }, opts, closed, null))
  const budget = Number.isFinite(opts.rows) ? Math.max(1, opts.rows as number) : Infinity
  /* the board's calls under the questions, within the rows the foot and the offline line leave */
  if (cs.length) rows.push(...callTrees(els, cs, opts).slice(0, Math.max(0, budget - rows.length - (foot ? 1 : 0) - (m.offline ? 1 : 0))))
  if (foot && rows.length < budget) rows.push(<Box key="band-foot" flexDirection="row" columnGap={GAP} {...(queued ? { flexWrap: 'wrap' } : {})}>{foot}</Box>)
  if (m.offline && rows.length < budget) rows.push(offlineRow(els, m.offline))
  /* a half line between rows, so the desktop's 32 px chips do not crowd the next row */
  const gap = opts.surface === 'desktop' ? { rowGap: 1 } : {}
  return rows.length ? <Box key="needs-you" flexDirection="column" {...gap}>{rows}</Box> : null
}
