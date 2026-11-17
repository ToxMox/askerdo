/* The Needs-you band's tree: one open
 * question as one row with its chips, several as a count line, what waits for this
 * session with its submit chip; nothing at all when nothing is open or waiting. The
 * meters, the guard, the thread and the shelf are the status line's, which index.ts adds
 * as the band's last row on the desktop. The desktop draws the
 * marks as pictures; the shelf, pane and board presses left for the status row and pane.
 * Drawn from the model alone; index.ts owns every read and write. */
import { CARD_CELLS, SKY, TILE_GAP, cardColors, factTip, pressFace, pressOver, tileLook, tilePress, wordLink } from './status.tsx'
import { OPEN, SHUT, fitWords, foldEnd, foldRing } from './fold.tsx'
import { QUEUED_MARK, type QuestionsActions, type QuestionsView, noteField, prose, stripTree } from './questions.tsx'
import {
  COUNT_MARK, STAR, UNREAD_SHORT, ageText, answerLabels, badgePicture, callCard, cardText, cellWidth, chipCard, chipText, clampWords, countCard, countTip, facePicture, foldCard,
  deskCells, inboxCard, markPicture, offlineCard, queuedCard, queuedLabel, rowGap, rowNeed, statusPicture, submitLabel, submitTip, waitingRow,
} from '../../lib/mod-core.mjs'

/* a pressed chip's state, while its CLI runs, after it took, after it failed */
export type ChipState = 'pending' | 'done' | 'failed'
export type BandAnswer = { letter: string; token: string; option: string; gets?: string; catch?: string; undo?: string; state?: ChipState; error?: string }
export type BandQuestion = { id: string; name: string; ask?: string; crux?: string; gist?: string; reverses?: string; blocking: boolean; pick: string | null; answers: BandAnswer[]; born?: number; version?: number }
/* a call the board raises (callRows), any kind alike; a press runs its verb as the user or opens its page */
export type BandPress = { label: string; verb: string | null; input?: any; url?: string; pane?: string; does?: string }
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
  /* Answer presses on confirm: the band's open strips (view.strip), the queued answers and the card's strip presses */
  strip?: { view: QuestionsView; act: QuestionsActions }
  /* the board refuses this PC's protocol: the cached chips draw with no press, since none could land */
  still?: boolean
  /* told on each desktop draw what the band's one line had no room for (null: nothing) */
  dropped?: (d: NeedsDrop | null) => void
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

/* the question the band draws as a row of its own; none while several fold into the count line */
export const rowQuestion = (m: any): BandQuestion | undefined =>
  (m && m.total === 1 && Array.isArray(m.questions) && m.questions.length === 1 ? m.questions[0] : undefined)

/* the letter whose strip is open on this question, and the letter queued for it */
function stripOf(q: BandQuestion, opts: BandOpts): string | undefined {
  const at = opts.strip && opts.strip.view.strip ? opts.strip.view.strip[q.id] : undefined
  return at && q.answers.some((a) => a.letter === at) ? at : undefined
}
const queuedOf = (q: BandQuestion, opts: BandOpts): string | undefined => {
  const qd = opts.strip && opts.strip.view.queued
  return qd && qd[q.id] ? qd[q.id].letter : undefined
}
/* the card's strip under the pressed chip; the band's own row carries the queued count and Send */
function bandStrip(els: any, q: BandQuestion, letter: string, opts: BandOpts): any {
  const s = opts.strip!
  const a = q.answers.find((x) => x.letter === letter)
  const { send, ...act } = s.act
  return stripTree(els, { id: q.id, version: q.version, options: q.answers }, a, s.view, act, {}, opts.surface === 'desktop' && !!els.Svg)
}

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

/* the gist's lines as plain words, for a card drawn as text: list marks and bold marks gone */
const gistWords = (g?: string) => String(g || '').split(/\n/).map((l) => l.replace(/^(?:[-*+]\s|\d+[.)]\s)/, '').replace(/\*\*|__/g, '').trim()).filter(Boolean)

/* a question's desktop card: a reversal's ruling, the tray face beside the id
   and name in bold, the ask, the crux in italics (else the gist's lines, drawn as the Questions card's),
   and how long it has waited in the secondary gray. headless: Home's unfolded card, whose row names it */
function questionCard(els: any, q: BandQuestion, now?: number, headless = false): any[] {
  const { Box, Text, Svg } = els
  const p = facePicture(q.blocking)
  const age = q.born && Number.isFinite(now) ? ', asked ' + ageText((now as number) - q.born) + ' ago' : ''
  return [
    q.reverses ? <Box key={'qc-rev-' + q.id}><Text wrap="wrap">{q.reverses}</Text></Box> : null,
    headless ? null : <Box key={'qc-head-' + q.id} flexDirection="row" columnGap={1}>
      {Svg ? <Svg source={p.source} alt={p.alt} width={p.width} height={p.height} /> : null}<Text bold wrap="wrap">{q.id + ' ' + q.name}</Text>
    </Box>,
    q.ask ? <Box key={'qc-ask-' + q.id}><Text wrap="wrap">{q.ask}</Text></Box> : null,
    q.crux ? <Box key={'qc-crux-' + q.id}><Text italic wrap="wrap">{q.crux}</Text></Box>
      : q.gist ? <Box key={'qc-gist-' + q.id} flexDirection="column">{prose(els, 'qc-gistmd-' + q.id, q.gist)}</Box> : null,
    <Box key={'qc-foot-' + q.id}><Text color="inactive" wrap="wrap">{(q.blocking ? 'blocking' : 'waiting') + age}</Text></Box>,
  ].filter(Boolean)
}

/* an option's desktop card: the option in bold (the pick starred), what happens
   and the catch in the warning color, a one-way line when hard to undo, the press it names.
   the title leads with the option's badge; the token stays in the press line. */
function optionCard(els: any, a: BandAnswer, pick: boolean, press: boolean, confirm = false): any[] {
  const { Box, Text, Svg } = els
  const c = chipCard(a, pick, confirm)
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
  /* the tile whose strip is open stays lit and holds it, as a card's option does */
  const at = stripOf(q, opts), queued = queuedOf(q, opts)
  const options = q.answers.map((a) => {
    const lit = a.letter === at
    const edge = lit ? SKY : queued === a.letter ? 'warning' : q.pick === a.letter
    return (
      <Box key={'qu-opt-' + a.token} flexDirection="column" paddingX={1} {...tileLook(edge, !lit, lit)}>
        {[lit || opts.still ? null : tilePress(els, 'qu-tile-' + a.token, opts.columns || 200, () => onAnswer(q, a)), ...optionCard(els, a, q.pick === a.letter, false),
          lit ? bandStrip(els, q, a.letter, opts) : null].filter(Boolean)}
      </Box>
    )
  })
  return (
    <Box key={'qunfold-' + q.id} flexDirection="column" rowGap={1} paddingLeft={3}>
      {questionCard(els, q, opts.now, true)}
      <Box key={'qu-tiles-' + q.id} flexDirection="column" rowGap={TILE_GAP.rowGap}>{options}</Box>
    </Box>
  )
}

/* the pane's words in cells, by the one measure rowNeed uses */
const nameCells = (s: string, desk: boolean) => (desk ? deskCells(s) : cellWidth(s))
/* Home's name on its own lines: broken at the last space that fits `room`, the rest on the second,
   which ends at a whole word with an ellipsis where it still overflows */
function nameLines(name: string, room: number, desk: boolean): string[] {
  const words = name.split(' ')
  if (nameCells(name, desk) <= room || words.length < 2) return [name]
  let i = 1
  while (i < words.length - 1 && nameCells(words.slice(0, i + 1).join(' '), desk) <= room) i++
  const rest = words.slice(i).join(' ')
  const second = desk ? fitWords(rest, room) : clampWords(rest, room, 1)
  return second ? [words.slice(0, i).join(' '), second] : [words.slice(0, i).join(' ') + '…']
}

/* the name broken at spaces into lines of at most `room` cells, every word kept */
function wrapLines(name: string, room: number, desk: boolean): string[] {
  const out: string[] = []
  for (const w of name.split(' ')) {
    const last = out.length ? out[out.length - 1] + ' ' + w : ''
    if (last && nameCells(last, desk) <= room) out[out.length - 1] = last
    else out.push(w)
  }
  return out
}

/* One open question: the mark, its label in bold then the name (a press opens the pane at it), a chip
   per answer, the age. In Home's copy a name the row cannot hold goes under the chips, at
   most two lines. The label stays whole; the name cuts first. cut: the desktop band's narrowest
   forms: no name, no mark, the first `keep` letters and a +N chip; the card names every option */
type QCut = { name?: boolean; mark?: boolean; keep?: number }
function questionRow(els: any, q: BandQuestion, onAnswer: (q: BandQuestion, a: BandAnswer) => void, opts: BandOpts, closed: string, noAge = false, cut: QCut = {}): any {
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
  /* the name on its own lines leaves the first line the mark, chips, age and ring: past the row's
     width the age goes first, then the chips' words, so the ring stays inside the row */
  const topNeed = (a: string, named: boolean) => rowNeed(said, { ...fit, age: a }, named, 0, gap)
  const ageShown = own && age && topNeed(age, wordy) > (cols as number) ? '' : age
  const shown = own && wordy && topNeed(ageShown, true) > (cols as number) ? q.answers.map((a) => (q.pick === a.letter ? STAR + ' ' : '') + a.letter) : labels
  /* the line's room past the mark and the bold label, each with its gap (the ring stays on the first line) */
  const before = onDesk ? markPicture('open', 'rest', true).width / 8.453 + 1 + deskCells(q.id, 600) + 1 : 2 + 1 + cellWidth(q.id) + 2
  /* unfolded, the row is the card's only naming, so its name runs whole on as many lines as it takes */
  const whole = !!fold && fold.open(q.id)
  const lines = own ? (whole ? wrapLines(q.name, (cols as number) - before, onDesk) : nameLines(q.name, (cols as number) - before, onDesk)) : [q.name]
  /* on the desktop the name takes the band's one weight, as its labels do;
     Home's press to the Questions tab wears the link blue the pane's other tab presses do */
  const link = onDesk && !onBand(opts) && opts.open ? { color: 'suggestion' } : {}
  const faceOf = (s: string) => (onDesk ? <Text {...link} wrap="truncate-end">{s}</Text> : <Text weight="semibold" wrap="truncate-end">{s}</Text>)
  const words = lines.length < 2 ? faceOf(lines[0])
    : <Box key={'qlines-' + q.id} flexDirection="column" flexShrink={1} minWidth={0}>{lines.map((s, i) => <Box key={'qline-' + i} minWidth={0}>{faceOf(s)}</Box>)}</Box>
  const labeled = (rest: any) => (
    <Box key={'qlabeled-' + q.id} flexDirection="row" columnGap={1} flexShrink={1} minWidth={0} alignItems="flex-start">
      <Box key={'qlabel-' + q.id} flexShrink={0}><Text bold {...link}>{q.id}</Text></Box>
      {cut.name ? null : <Box key={'qwords-' + q.id} flexShrink={1} minWidth={0}>{rest}</Box>}
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
  const tip = [q.reverses, q.ask, ...(q.crux ? [q.crux] : gistWords(q.gist))].filter(Boolean) as string[]
  const desk = onDesk && opts.cards !== false
  const kept = Math.max(1, Math.min(q.answers.length, cut.keep ?? q.answers.length))
  const hid = q.answers.slice(kept)
  /* letters past the line: the question's card names every option */
  const every = hid.length ? q.answers.map((a) => a.token + ' ' + a.option) : []
  const qcard = questionCard(els, q, opts.now)
  if (every.length) qcard.push(<Box key={'qc-opts-' + q.id} flexDirection="column">{every.map((l, i) => <Text key={'qc-opt-' + i} wrap="wrap">{l}</Text>)}</Box>)
  const card = desk ? hoverCard(els, [q.id + ' ' + q.name, ...tip, ...every], 2, opts, 0, qcard) : tip.length ? hoverCard(els, tip, 2, opts) : null
  const ring = fold
    ? foldRing(els, fold.open(q.id), { key: 'qarrow-' + q.id, pressKey: 'unfold-' + q.id, press: () => fold.toggle(q.id), band: onBand(opts) })
    : null
  const dot = <Box key={'qdot-' + q.id} flexShrink={0}>{glyph}</Box>
  const head = (
    <Box key={'qhead-' + q.id} flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>
      {own || cut.mark ? null : dot}
      <Box key={'qname-' + q.id} flexShrink={1} minWidth={0}>{name}{card}</Box>
    </Box>
  )
  /* the name sits one cell from its chips, as the chips from each other; the row's gap parts the rest */
  let x = 2 + cellWidth(said.name) + 1
  const lit = stripOf(q, opts), queued = queuedOf(q, opts)
  const chips = q.answers.slice(0, kept).map((a, i) => {
    const pick = q.pick === a.letter
    const named = shown[i] !== (pick ? STAR + ' ' : '') + a.letter
    const at = x
    /* the terminal's letter takes a cell of sky each side */
    x += chipWidth(shown[i]) + 3
    const card = hoverCard(els, chipText(a, pick), at, opts, 0, desk ? optionCard(els, a, pick, !opts.still, !!opts.strip) : undefined)
    const look = { lit: a.letter === lit, queued: a.letter === queued }
    return <Box key={'chip-' + a.token} flexShrink={0}>{chipFace(els, a, pick, named, () => onAnswer(q, a), opts, look)}{card}</Box>
  })
  /* the folded letters' chip: its card names them, its press opens the question in the pane */
  if (hid.length) {
    const more = '+' + hid.length
    const go = () => { if (opts.open) opts.open(q) }
    chips.push(
      <Box key={'qmore-' + q.id} flexShrink={0}>
        {pressFace(els, 'qmoreface-' + q.id, <Text tabular>{more}</Text>, opts.still ? null : pressOver(els, 'qmore-press-' + q.id, cellWidth(more) + 1, go, undefined, true), { chip: {} })}
        {hoverCard(els, [...hid.map((a) => chipText(a, q.pick === a.letter)), MORE_TIP], x, opts, 0, desk ? [...hid.flatMap((a) => optionCard(els, a, q.pick === a.letter, false)),
          <Box key={'qmore-tip-' + q.id}><Text color="inactive" wrap="wrap">{MORE_TIP}</Text></Box>] : undefined, CARD_CELLS)}
      </Box>)
  }
  const chipRow = <Box key={'qchips-' + q.id} flexDirection="row" columnGap={1} flexShrink={0}>{chips}</Box>
  const parts: any[] = [chipRow]
  if (ageShown && !noAge) parts.push(<Box key={'qage-' + q.id} flexShrink={0}><Text dimColor tabular>{ageShown}</Text></Box>)
  /* the desktop band's one line cuts the receipt, the question's card naming the band frozen */
  if (closed) parts.push(deskBand(els, opts) ? <Box key="closed" flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{closed}</Text>{hoverCard(els, closed, 0, opts)}</Box>
    : <Box key="closed" flexShrink={0}><Text dimColor>{closed}</Text></Box>)
  if (ring) parts.push(foldEnd(els, ring, gap))
  const lead = <Box key={'qlead-' + q.id} flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>{head}{chipRow}</Box>
  /* the band's row takes its lead's room, else the name's whole width holds it and the letters run past */
  const fits = deskBand(els, opts) ? { flexShrink: 1, minWidth: 0 } : {}
  if (!own) return <Box key={'q-' + q.id} flexDirection="row" columnGap={gap} {...fits} {...rowLook(opts)}>{[lead, ...parts.slice(1)]}</Box>
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

const MORE_TIP = "Past the band's width; press to open the question in the Questions pane, where every option answers."

/* the terminal's tint hugs the row's content; a desktop row takes none (the
   dark bar). A desktop row spans the band, so its words cut, never its presses */
const rowLook = (opts: BandOpts) => (opts.surface === 'desktop' ? {} : { alignSelf: 'flex-start', hover: { backgroundColor: TINT } })

/* a desktop chip is a face, the letter's sky badge then the star and words
   where the row has room, its press laid over and keyed answer-<token>; the terminal's a Button,
   the letter on a sky ground, the pick's primary. Letters only, the pick keeps its star */
/* lit, its strip is open (the terminal's arrow says the strip is under it); queued, the card's amber badge or mark */
function chipFace(els: any, a: BandAnswer, pick: boolean, named: boolean, press: () => void, opts: BandOpts, look: { lit?: boolean; queued?: boolean } = {}): any {
  const { Box, Text, Button, Svg } = els
  if (opts.surface === 'desktop' && Svg) {
    const p = look.queued ? badgePicture(a.letter, 'queued') : badgePicture(a.letter)
    const said = (pick ? STAR + (named ? ' ' : '') : '') + (named ? a.option : '')
    const words = said ? <Text>{pick ? <Text color={SKY}>{named ? STAR + ' ' : STAR}</Text> : null}{named ? a.option : null}</Text> : null
    const cells = Math.ceil(p.width / 8) + (said ? cellWidth(said) + 1 : 0)
    return pressFace(els, 'chipface-' + a.token, [<Svg source={p.source} alt={p.alt} width={p.width} height={p.height} />, words],
      opts.still ? null : pressOver(els, 'answer-' + a.token, cells, press, undefined, onBand(opts)),
      { chip: { pick, only: !said, ...(look.lit ? { lit: true } : {}), ...(opts.still ? { still: true } : {}) } })
  }
  if (opts.still) return (
    <Box key={'answerstill-' + a.token} paddingX={2}>
      <Text>{pick ? STAR + ' ' : ''}<Text backgroundColor={SKY} color="#0b0b0b">{' ' + a.letter + ' '}</Text>{look.queued ? ' ' + QUEUED_MARK : ''}{named ? ' ' + a.option : ''}</Text>
    </Box>
  )
  return (
    <Button key={'answer-' + a.token} onPress={press} {...(pick || look.lit ? { variant: 'primary' } : {})}>
      {pick ? STAR + ' ' : ''}<Text backgroundColor={SKY} color="#0b0b0b">{' ' + a.letter + ' '}</Text>{look.queued ? ' ' + QUEUED_MARK : ''}{named ? ' ' + a.option : ''}{look.lit ? ' ' + OPEN : ''}
    </Button>
  )
}

/* what waits for this session, its lines on the mark's card,
   and the one press that starts a turn with it; `brief` where it shares the count line. */
/* the waiting row's words, its press and the cells each takes (the mark two, a chip's frame) */
function waitingSize(w: any, opts: BandOpts, desk: boolean, brief: boolean) {
  const label = brief ? w.n + ' waiting' : waitingRow(w)
  const submit = submitLabel(w)
  const cells = desk ? (s: string) => deskCells(s) : cellWidth
  const press = cells(submit) + (desk ? 2 : 4)
  return { label, submit, words: cells(label), press, need: 2 + cells(label) + GAP + press }
}

function waitingGroup(els: any, w: any, opts: BandOpts, x: number, row: number, brief: boolean): any {
  const { Box, Text, Button } = els
  const desk = opts.surface === 'desktop' && !!els.Svg
  const { label, submit, words, press, need } = waitingSize(w, opts, desk, brief)
  const room = Number.isFinite(opts.columns) ? (opts.columns as number) - x : Infinity
  /* an item's words whole beside the press, else the press under them and the words wrapped to the band's width */
  const under = !brief && need > room
  /* a card's place is whole cells */
  const at = Math.ceil(under ? x + 2 : x + 2 + Math.min(words, Math.max(0, room - 2 - GAP - press)) + GAP)
  return (
    <Box key="inbox" flexDirection={under ? 'column' : 'row'} columnGap={GAP} flexShrink={brief ? 0 : 1} minWidth={0}>
      <Box key="inbox-head" flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>
        <Box key="inbox-mark" flexShrink={0}>{mark(els, opts, 'inbox', <Text color="success">{WAIT}</Text>)}{factHover(els, 'inbox', inboxCard(w), 'inbox', x, opts, row, w.lines || [])}</Box>
        <Box key="inbox-words" flexShrink={1} minWidth={0}><Text key="inbox-label" wrap={under ? 'wrap' : 'truncate-end'}>{label}</Text></Box>
      </Box>
      <Box key="inbox-submit-chip" flexShrink={0} {...(under ? { paddingLeft: 3 } : {})}>
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
function countRow(els: any, m: any, opts: BandOpts, closed: string, inbox: any, queued = 0, tight = false): any {
  const { Box, Text } = els
  const parts: any[] = []
  let x = 0
  /* the desktop band's one line cuts the receipt, its card holding it whole */
  const line = deskBand(els, opts)
  if (closed) {
    parts.push(line ? <Box key="closed" flexShrink={1} minWidth={0}><Text dimColor wrap="truncate-end">{closed}</Text>{hoverCard(els, closed, 0, opts)}</Box>
      : <Box key="closed" flexShrink={0}><Text dimColor>{closed}</Text></Box>)
    x += cellWidth(closed) + GAP
  }
  if (m.total) {
    const { Button } = els
    const open = opts.open
    const desk = opts.surface === 'desktop' && !!els.Svg
    const words = m.total + ' open'
    const head = desk ? words : COUNT_MARK + ' ' + words
    /* tight: the band's one line keeps the blocking count by its mark; the card says the word */
    const blocking = m.blocking && !closed ? m.blocking + (tight ? '' : ' blocking') : ''
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
    /* the read's questions were not a list: a few words here, the sentence in the count's tooltip */
    if (m.unreadQuestions) parts.push(<Box key="count-unread" flexShrink={1} minWidth={0}><Text color="warning" wrap="truncate-end">{UNREAD_SHORT}</Text></Box>)
  }
  if (inbox) parts.push(waitingGroup(els, inbox, opts, x, 0, !!m.total))
  if (queued) parts.push(queuedGroup(els, queued, opts))
  /* a queued count, or what waits, wraps under the rest rather than cut its press */
  return <Box key="count" flexDirection="row" columnGap={GAP} {...(queued || inbox ? { flexWrap: 'wrap' } : {})}>{parts}</Box>
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
  /* a `pane` press opens the AskerDo pane there, the url its page elsewhere */
  if (!p.verb && !p.pane) return p.url ? wordLink(els, key, p.url, p.label, desk) : null
  const act = () => { if (opts.press) opts.press(c, p) }
  if (desk) return pressFace(els, key + '-face', <Text>{p.label}</Text>, pressOver(els, key, cellWidth(p.label) + 1, act, undefined, onBand(opts)), { chip: {} })
  return <Button key={key} label={p.label} onPress={act} />
}

/* the cells a call's one-line row needs: the mark, its words, the gap, its presses and Home's ring */
function callNeed(c: BandCall, words: string, desk: boolean, ring: boolean): number {
  const w = desk ? (s: string) => deskCells(s) : cellWidth
  const mark = desk ? markPicture('call', 'rest', true).width / 8.453 : 1
  /* a desktop chip's border and padding take about two cells, a terminal button four */
  const presses = c.presses.reduce((n, p) => n + w(p.label) + (desk ? 2 : 4) + 1, 0)
  return mark + 1 + w(words) + GAP + presses + (ring ? 4 : 0)
}

/* One call as one compact row: the mark and its short line, its fact card on hovering either, its
   presses. Home's copy ends the row with the fold ring that unfolds the card under it.
   a row too narrow for its words whole wraps them, its presses on the line under them */
function callRow(els: any, c: BandCall, opts: BandOpts, x = 0): any {
  const { Box, Text } = els
  const desk = opts.surface === 'desktop'
  const fold = desk ? opts.unfold : undefined
  const ring = fold
    ? foldRing(els, fold.open(c.key), { key: 'carrow-' + c.key, pressKey: 'cunfold-' + c.key, press: () => fold.toggle(c.key), band: onBand(opts) })
    : null
  const said = c.short || c.text
  const room = Number.isFinite(opts.columns) ? (opts.columns as number) - x : Infinity
  const own = !onBand(opts) && callNeed(c, said, desk && !!els.Svg, !!ring) > room
  const markBox = <Box key={'cmark-' + c.key} flexShrink={0}>{callMark(els, opts)}</Box>
  const words = <Box key={'ctext-' + c.key} flexShrink={1} minWidth={0} {...(own ? { flexGrow: 1 } : {})}><Text wrap={own ? 'wrap' : 'truncate-end'}>{said}</Text></Box>
  const card = factHover(els, 'call-' + c.key, callCard(c), 'call', x, opts)
  const presses = c.presses.map((p, i) => callPress(els, c, p, i, opts)).filter(Boolean)
  if (own) return (
    <Box key={'call-' + c.key} flexDirection="row" columnGap={1} alignItems="flex-start" {...rowLook(opts)}>
      {markBox}
      <Box key={'cbody-' + c.key} flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} {...(desk ? { rowGap: 1 } : {})}>
        <Box key={'chead-' + c.key} flexDirection="row" columnGap={1} minWidth={0} alignItems="flex-start">{words}{card}{ring ? <Box key={'cring-' + c.key} flexShrink={0}>{ring}</Box> : null}</Box>
        <Box key={'cpresses-' + c.key} flexDirection="row" columnGap={1} flexWrap="wrap">{presses}</Box>
      </Box>
    </Box>
  )
  const head = (
    <Box key={'chead-' + c.key} flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>
      {markBox}{words}{card}
    </Box>
  )
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
  const words = list.length + ' override requests wait on you'
  const toggle = () => { if (opts.fold) opts.fold.toggle() }
  if (opts.surface === 'desktop' && els.Svg) {
    /* the card hangs on the row, since the row's press lies over the words */
    return (
      <Box key="calls-overrides" flexDirection="row" columnGap={1}>
        {pressOver(els, 'calls-fold', Number.isFinite(opts.columns) ? (opts.columns as number) : 200, toggle, undefined, onBand(opts))}
        <Box key="calls-overrides-mark" flexShrink={0}>{callMark(els, opts)}</Box>
        <Box key="calls-overrides-words" flexShrink={1} minWidth={0}><Text wrap={onBand(opts) ? 'truncate-end' : 'wrap'}>{words}</Text></Box>
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

/* the board stopped answering, so what the band draws is this PC's last copy. One
   line on the band, cut at its width; the card holds every word and the fix, and the row's press is
   the health chip's (healthFix: it copies or runs the fix). Home has no cards, so there the words wrap */
const OFFLINE_TAIL = ' (drawn from this PC\'s last copy)'
function offlineRow(els: any, line: string, m: any, opts: BandOpts, up: number): any {
  const { Box, Text, Button } = els
  const hc = (Array.isArray(m.calls) ? m.calls : []).find((c: BandCall) => c.kind === 'health') as BandCall | undefined
  const act = () => { if (opts.press) opts.press(hc || { key: 'health', kind: 'health', text: '', presses: [] }, (hc && hc.presses[0]) as BandPress) }
  const card = offlineCard(line, hc)
  /* the app's engine gives a nested Text its own pre-wrap, so a cut needs sibling Texts; the tail gives way
     first, and a line that fits does not shrink at all (a share of a px still draws its ellipsis) */
  const holds = deskCells(line) + 2 < (Number.isFinite(opts.columns) ? (opts.columns as number) : Infinity)
  const words = onBand(opts) && opts.surface === 'desktop' && els.Svg
    ? <Box key="offline-cut" flexDirection="row" minWidth={0}>
        <Box key="offline-line" flexShrink={holds ? 0 : 1} minWidth={0}><Text color="warning" wrap="truncate-end">{line}</Text></Box>
        <Box key="offline-tail" flexShrink={1000} minWidth={0}><Text dimColor wrap="truncate-end">{OFFLINE_TAIL}</Text></Box>
      </Box>
    : <Text wrap={onBand(opts) ? 'truncate-end' : 'wrap'}><Text color="warning">{line}</Text><Text dimColor>{OFFLINE_TAIL}</Text></Text>
  if (opts.surface === 'desktop' && els.Svg) {
    return (
      <Box key="band-offline" flexDirection="row">
        {pressOver(els, 'offline-fix', Number.isFinite(opts.columns) ? (opts.columns as number) : 200, act, undefined, onBand(opts))}
        <Box key="offline-word" flexShrink={1} minWidth={0}>{words}</Box>
        {factHover(els, 'offline', card, 'call', 0, opts, up)}
      </Box>
    )
  }
  return (
    <Box key="band-offline" flexDirection="row">
      <Box key="offline-word" flexShrink={1} minWidth={0}>
        <Button key="offline-fix" plain onPress={act}>{words}</Button>
        {factHover(els, 'offline', card, 'call', 0, opts, up, [line + OFFLINE_TAIL, hc && hc.fix && !line.includes(hc.fix) ? 'Fix: ' + hc.fix : '', card.press].filter(Boolean))}
      </Box>
    </Box>
  )
}
/* the lines the offline words take at this width: one on the band, wrapped on Home */
function offlineLines(line: string, opts: BandOpts, desk: boolean): number {
  if (onBand(opts)) return 1
  const cols = Number.isFinite(opts.columns) ? Math.max(1, opts.columns as number) : Infinity
  return Math.max(1, Math.ceil((desk ? deskCells(line + OFFLINE_TAIL) : cellWidth(line + OFFLINE_TAIL)) / cols))
}

/* ---- the desktop band is one needs line over the status line, a lead at its
   left and up to three chips at its right end; nothing on it wraps, and every word a form drops is in
   its group's card. Home's copy (no cards) and the terminal draw the rows below as before ---- */
const PX = 8.453
const pxCells = (n: number) => n / PX
/* a chip's frame (border and padding) with words, and with a picture alone; a desktop Button's */
const CHIP_FRAME = 1.75, CHIP_BARE = 1.25, BTN = 2
/* a letter's chip alone: the 18 px badge, half a cell each side and its 1 px border (status.tsx CHIP) */
const LETTER_CHIP = 18 / 8.453 + 1 + 2 / 8.453
const LEAD_GAP = 2, CHIP_GAP = 1
/* the fewest cells a cut lead keeps of its words, and the band's note field */
const WORDS_FLOOR = 6, FIELD_FLOOR = 5
/* full words, short words, icon and count */
type Form = 0 | 1 | 2
/* firm: the lead cuts past its floor before this chip goes (Send stays on the band) */
type NeedsChip = { key: 'waiting' | 'queued' | 'offline'; w: number[]; draw: (f: Form, x: number) => any; firm?: boolean }
/* what the line had no room for, which the AskerDo mark's card names (bandDropFacts) */
export type NeedsDrop = { inbox?: any; queued?: number; offline?: boolean }
const deskBand = (els: any, opts: BandOpts) => opts.surface === 'desktop' && !!els.Svg && onBand(opts)

/* The one plan: chips shrink a form at a time from the right before the lead cuts; the lead cuts to its
   floor before a chip goes, the chips not firm going first from the right; a firm chip goes only when
   the lead's narrowest form (least) still leaves it no room. */
export function needsPlan(cols: number, lead: { full: number; floor: number; least?: number } | null, chips: { w: number[]; firm?: boolean }[], start: Form = 0): { forms: Form[]; kept: number[]; room: number } {
  const forms: Form[] = chips.map(() => start)
  let kept = chips.map((_, i) => i)
  const width = () => kept.reduce((n, i) => n + chips[i].w[forms[i]], 0) + CHIP_GAP * Math.max(0, kept.length - 1)
  const total = (l: number) => (lead ? l + (kept.length ? LEAD_GAP : 0) : 0) + width()
  for (const f of [1, 2] as Form[]) for (let i = chips.length - 1; i >= 0 && total(lead ? lead.full : 0) > cols; i--) if (forms[i] < f) forms[i] = f
  const loose = () => kept.filter((i) => !chips[i].firm)
  while (loose().length && total(lead ? lead.floor : 0) > cols) { const out = loose().at(-1); kept = kept.filter((i) => i !== out) }
  while (kept.length && total(lead ? lead.least ?? lead.floor : 0) > cols) kept = kept.slice(0, -1)
  return { forms, kept, room: cols - (kept.length ? width() + (lead ? LEAD_GAP : 0) : 0) }
}

/* a row's card of a head and groups, its head's picture given */
function cardHover(els: any, key: string, card: any, svg: any, x: number, opts: BandOpts): any {
  return hoverCard(els, [cardText(card)], x, opts, 0, factTip(els, key, card, svg), CARD_CELLS)
}
const svgOf = (els: any, p: any) => { const { Svg } = els; return <Svg source={p.source} alt={p.alt} width={p.width} height={p.height} /> }

/* the waiting chip: the inbox mark, the count and the press that starts a turn with them; bare, the
   lead is the waiting update itself, so the chip is the press alone */
function waitingChip(els: any, w: any, opts: BandOpts, bare: boolean): NeedsChip {
  const { Box, Text, Button } = els
  const p = markPicture('inbox', 'rest', true)
  const act = () => { if (opts.submit) opts.submit() }
  const say = [submitLabel(w), 'Start a turn', 'Start']
  const count = [w.n + ' waiting', String(w.n), String(w.n)]
  const iw = pxCells(p.width)
  const w3 = bare ? say.map((s) => deskCells(s) + BTN)
    : [0, 1].map((f) => iw + 1 + deskCells(count[f]) + 1 + deskCells(say[f]) + BTN).concat(iw + 0.6 + deskCells(count[2]) + CHIP_FRAME)
  const draw = (f: Form, x: number) => {
    if (bare) return <Box key="inbox-submit-chip" flexShrink={0}><Button key="inbox-submit" label={say[f]} onPress={act} />{hoverCard(els, submitTip(w), x, opts)}</Box>
    const card = cardHover(els, 'inbox', inboxCard(w), svgOf(els, p), x, opts)
    if (f === 2) return <Box key="inbox" flexShrink={0}>{pressFace(els, 'inbox-face', [svgOf(els, p), <Text tabular>{count[2]}</Text>], opts.still ? null : pressOver(els, 'inbox-submit', iw + deskCells(count[2]) + 1, act, undefined, true), { chip: {} })}{card}</Box>
    return (
      <Box key="inbox" flexDirection="row" columnGap={1} flexShrink={0} alignItems="center">
        <Box key="inbox-mark" flexShrink={0}>{svgOf(els, p)}</Box>
        <Box key="inbox-words" flexShrink={0}><Text key="inbox-label" tabular>{count[f]}</Text></Box>
        <Button key="inbox-submit" label={say[f]} onPress={act} />
        {card}
      </Box>
    )
  }
  return { key: 'waiting', w: w3, draw }
}

/* the queued answers by question and pick: the queue itself (any Answer presses setting), its name and
   words kept when queued, else the band's question's */
function queuedList(m: any): any[] {
  const qs: BandQuestion[] = Array.isArray(m.questions) ? m.questions : []
  return (Array.isArray(m.queuedList) ? m.queuedList : []).map((e: any) => {
    const q = qs.find((x) => x.id === e.id)
    const a = q && q.answers.find((x) => x.letter === e.letter)
    return { id: e.id, letter: e.letter, name: e.name || (q ? q.name : ''), option: e.option || (a ? a.option : '') }
  })
}

/* the queued chip: the count and Send; at its smallest the amber badge holds the count and is the press */
function queuedChip(els: any, n: number, m: any, opts: BandOpts): NeedsChip {
  const { Box, Text, Button } = els
  const p = { ...badgePicture(String(n), 'queued'), alt: queuedLabel(n) + ', an amber badge' }
  const act = () => { if (opts.send) opts.send() }
  const words = [queuedLabel(n), n + ' queued']
  const w3 = [0, 1].map((f) => deskCells(words[f]) + 1 + deskCells('Send') + BTN).concat(pxCells(p.width) + CHIP_BARE)
  const draw = (f: Form, x: number) => {
    const card = cardHover(els, 'queued', queuedCard(queuedList(m), n), svgOf(els, p), x, opts)
    if (f === 2) return <Box key="queued" flexShrink={0}>{pressFace(els, 'queued-face', svgOf(els, p), pressOver(els, 'queued-send', pxCells(p.width) + 1, act, undefined, true), { chip: { only: true } })}{card}</Box>
    return (
      <Box key="queued" flexDirection="row" columnGap={1} flexShrink={0} alignItems="center">
        <Box key="queued-label" flexShrink={0}><Text color="warning">{words[f]}</Text></Box>
        <Button key="queued-send" label="Send" onPress={act} />
        {card}
      </Box>
    )
  }
  return { key: 'queued', w: w3, draw, firm: true }
}

/* the offline press and card, the status row's health chip's own (healthFix: it copies or runs the fix) */
function offlinePress(m: any, opts: BandOpts): { act: () => void; hc?: BandCall } {
  const hc = (Array.isArray(m.calls) ? m.calls : []).find((c: BandCall) => c.kind === 'health') as BandCall | undefined
  return { hc, act: () => { if (opts.press) opts.press(hc || { key: 'health', kind: 'health', text: '', presses: [] }, (hc && hc.presses[0]) as BandPress) } }
}
/* the offline chip, when something else leads: the amber monitor and its words */
function offlineChip(els: any, line: string, m: any, opts: BandOpts): NeedsChip {
  const { Box, Text } = els
  const { act, hc } = offlinePress(m, opts)
  const words = ['board offline', 'offline', '']
  const pic = (f: Form) => statusPicture({ kind: 'icon', icon: 'monitor', tone: 'amber' }, words[f] ? 4 : 0)
  const w3 = ([0, 1, 2] as Form[]).map((f) => pxCells(pic(f).width) + deskCells(words[f]) + 1)
  const draw = (f: Form, x: number) => {
    const face = [svgOf(els, pic(f)), words[f] ? <Text color="warning">{words[f]}</Text> : null]
    return (
      <Box key="offline-chip" flexShrink={0}>
        {pressFace(els, 'offline-face', face, pressOver(els, 'offline-fix', w3[f], act, undefined, true))}
        {cardHover(els, 'offline', offlineCard(line, hc), svgOf(els, pic(2)), x, opts)}
      </Box>
    )
  }
  return { key: 'offline', w: w3, draw }
}

/* the waiting update leading the line: its words cut, the inbox card holding them whole */
function waitingLead(els: any, w: any, opts: BandOpts): any {
  const { Box, Text } = els
  const p = markPicture('inbox', 'rest', true)
  return (
    <Box key="inbox" flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>
      <Box key="inbox-mark" flexShrink={0}>{svgOf(els, p)}</Box>
      <Box key="inbox-words" flexShrink={1} minWidth={0}><Text key="inbox-label" wrap="truncate-end">{waitingRow(w)}</Text></Box>
      {cardHover(els, 'inbox', inboxCard(w), svgOf(els, p), 0, opts)}
    </Box>
  )
}

/* the answer strip on the line: the label, the picked letter and its option's words (or the
   note field in their place), then its presses. Forms: whole words; short words; at the narrowest no
   label and no Cancel, the lit letter its press; with the note field open, Now and Note alone.
   Every word dropped is in the letter's card */
const STRIP_SAY: string[][] = [['Answer now', 'Queue answer', 'Unqueue', 'Cancel', 'Note'], ['Now', 'Queue', 'Unqueue', 'Cancel', 'Note'], ['Now', 'Queue', 'Unqueue', '', 'Note'], ['Now', '', '', '', 'Note']]
const STRIP_TIP = 'Answer now records it on the board at once; Queue answer keeps it on this PC until Send; Note adds a note sent with it; Cancel closes this.'
const FIELD_TIP = ' Queue and Unqueue come back when Note shuts the field; the note stays.'
function stripPresses(q: BandQuestion, opts: BandOpts, f: number, letter: string): string[] {
  const queued = queuedOf(q, opts)
  const s = STRIP_SAY[f]
  /* the narrowest form has room for one: Unqueue on the queued letter, else Queue */
  return [s[0], f === 2 && queued === letter ? s[2] : s[1], f < 2 && queued ? s[2] : '', s[3], s[4]].filter(Boolean)
}
const stripForms = (field: boolean) => (field ? [0, 1, 2, 3] : [0, 1, 2])
function stripNeed(q: BandQuestion, opts: BandOpts, f: number, words: number, letter: string): number {
  const ps = stripPresses(q, opts, f, letter)
  const gap = f >= 2 ? 0.5 : 1
  return (f < 2 ? deskCells(q.id, 600) + gap : 0) + pxCells(18) + CHIP_BARE + gap + words + ps.reduce((n, l) => n + deskCells(l) + CHIP_FRAME + gap, 0)
}
const noteOpen = (q: BandQuestion, opts: BandOpts) => !!(opts.strip && opts.strip.view.bandNote && opts.strip.view.bandNote[q.id])
function stripLine(els: any, q: BandQuestion, letter: string, opts: BandOpts, room: number): any {
  const { Box, Text } = els
  const { view, act } = opts.strip!
  const a = q.answers.find((x) => x.letter === letter)!
  const field = noteOpen(q, opts) && !!els.Input
  const forms = stripForms(field)
  /* the long labels only beside the option's whole word, the short ones beside a word of WORDS_FLOOR */
  const word = deskCells(a.option)
  const words = (n: number) => (field ? FIELD_FLOOR : n === 0 ? word + 0.5 : n === 1 ? Math.min(word, WORDS_FLOOR) : 0)
  const f = forms.find((n) => stripNeed(q, opts, n, words(n), letter) <= room) ?? forms.at(-1)!
  const queued = queuedOf(q, opts) === letter
  const cancel = () => { if (act.strip) act.strip(q.id) }
  const does: Record<string, [string, () => void, boolean?]> = {
    'Answer now': ['now', () => act.pick(q.id, letter, q.version), true], Now: ['now', () => act.pick(q.id, letter, q.version), true],
    'Queue answer': ['queue', () => { if (act.queue) act.queue(q.id, letter, q.version) }], Queue: ['queue', () => { if (act.queue) act.queue(q.id, letter, q.version) }],
    Unqueue: ['unqueue', () => { if (act.unqueue) act.unqueue(q.id) }], Cancel: ['cancel', cancel],
    Note: ['bandnote', () => { if (act.bandNote) act.bandNote(q.id) }],
  }
  const noted = field || !!(view.notes && view.notes[q.id])
  const presses = stripPresses(q, opts, f, letter).filter((l) => l !== 'Queue answer' && l !== 'Queue' || !!act.queue).map((l) => {
    const [k, press, primary] = does[l]
    const key = 'q' + k + '-' + q.id
    return pressFace(els, key + '-face', <Text>{l}</Text>, pressOver(els, key, cellWidth(l) + 1, press, undefined, true), { chip: { pick: !!primary, ...(k === 'bandnote' && noted ? { lit: true } : {}) } })
  })
  const p = queued ? badgePicture(letter, 'queued') : badgePicture(letter)
  const badge = pressFace(els, 'qsbadge-' + q.id, svgOf(els, p), f >= 2 ? pressOver(els, 'qcancel-' + q.id, 3, cancel, undefined, true) : null,
    { chip: { only: true, lit: true, ...(f >= 2 ? {} : { still: true }) } })
  const card = hoverCard(els, [q.id + ' ' + q.name, chipText(a, q.pick === letter), STRIP_TIP], 0, opts, 0, [
    <Box key={'qs-title-' + q.id}><Text bold wrap="wrap">{q.id + ' ' + q.name}</Text></Box>,
    ...optionCard(els, a, q.pick === letter, false),
    <Box key={'qs-tip-' + q.id}><Text color="inactive" wrap="wrap">{STRIP_TIP + (f >= 2 ? ' Press the letter to cancel.' : '') + (f === 3 ? FIELD_TIP : '')}</Text></Box>,
  ], CARD_CELLS)
  return (
    <Box key={'qbandstrip-' + q.id} flexDirection="row" columnGap={f >= 2 ? 0.5 : 1} alignItems="center" flexGrow={1} flexShrink={1} minWidth={0}>
      {f < 2 ? <Box key={'qslabel-' + q.id} flexShrink={0}><Text bold>{q.id}</Text></Box> : null}
      <Box key={'qsletter-' + q.id} flexShrink={0}>{badge}{card}</Box>
      {/* no set width: whatever a column measures in px, the field gives way first, then the word; either
          grows into the room, so the presses keep their place with the field open or shut */}
      {field ? <Box key={'qsfield-' + q.id} flexGrow={1} flexShrink={1000} minWidth={0}>{noteField(els, { id: q.id, options: q.answers }, view, act, false, 'a note sent with ' + a.token)}</Box>
        : <Box key={'qswords-' + q.id} flexGrow={1} flexShrink={100} minWidth={0}><Text wrap="truncate-end">{a.option}</Text></Box>}
      <Box key={'qspresses-' + q.id} flexDirection="row" columnGap={f >= 2 ? 0.5 : 1} flexShrink={0}>{presses}</Box>
    </Box>
  )
}

/* The desktop band's one needs line: the lead (the strip, one question, several, the frozen receipt, the
   board offline, what waits; the first that applies) and the chips (waiting, queued, offline) */
function needsLine(els: any, m: any, onAnswer: (q: BandQuestion, a: BandAnswer) => void, opts: BandOpts, closed: string, inbox: any, queued: number): any {
  const { Box } = els
  const cols = Number.isFinite(opts.columns) ? opts.columns as number : Infinity
  const one = rowQuestion(m)
  const shown = one && !one.answers.some((a) => a.state === 'pending' || a.state === 'done') ? one : undefined
  const at = shown && opts.strip ? stripOf(shown, opts) : undefined
  const kind = at ? 'strip' : shown ? 'question' : m.total && !one ? 'count' : closed && (m.saved || inbox || queued) ? 'receipt'
    : m.offline ? 'offline' : inbox ? 'waiting' : null
  const chips: NeedsChip[] = []
  if (inbox) chips.push(waitingChip(els, inbox, opts, kind === 'waiting'))
  if (queued) chips.push(queuedChip(els, queued, m, opts))
  if (m.offline && kind !== 'offline') chips.push(offlineChip(els, m.offline, m, opts))
  /* each lead's whole need and the floor it cuts to */
  const markW = pxCells(markPicture('open', 'rest', true).width)
  let size: { full: number; floor: number } | null = null
  let said: any, fit: any
  let cuts: { w: number; cut: QCut }[] = []
  if (kind === 'strip') {
    const field = noteOpen(shown!, opts) && !!els.Input
    size = { full: stripNeed(shown!, opts, 0, deskCells(shown!.answers.find((a) => a.letter === at)!.option) + 1, at!), floor: stripNeed(shown!, opts, stripForms(field).at(-1)!, field ? FIELD_FLOOR : 0, at!) }
  } else if (kind === 'question') {
    const age = shown!.born && Number.isFinite(opts.now) ? ageText((opts.now as number) - shown!.born) : ''
    said = { ...shown!, name: shown!.id + '  ' + shown!.name }
    fit = { surface: 'desktop', age, closed, unfold: false }
    const label = deskCells(shown!.id + '  ')
    const cut = closed ? Math.min(deskCells(closed), WORDS_FLOOR) + 1 : 0
    /* past the floor the name cuts to a stub, then goes, then the mark, then letters fold into a +N
       chip one at a time; each counted as drawn (letters bare, the pick's star) */
    const n = shown!.answers.length
    const chip = (a: BandAnswer) => (shown!.pick === a.letter ? LETTER_CHIP - 2 * 0.5 + 0.6 + deskCells(STAR) + 1.5 : LETTER_CHIP)
    const bare = (k: number, name: number, dot = true) => (dot ? markW + 1 : 0) + deskCells(shown!.id, 600) + (name ? 1 + name : 0) + 1 + cut
      + shown!.answers.slice(0, k).reduce((w, a) => w + chip(a) + 1, -1) + (k < n ? 1 + deskCells('+' + (n - k)) + CHIP_FRAME : 0)
    cuts = [{ w: bare(n, WORDS_FLOOR), cut: {} }, { w: bare(n, 3), cut: {} }, { w: bare(n, 0), cut: { name: true } }, { w: bare(n, 0, false), cut: { name: true, mark: true } }]
    for (let k = n - 1; k >= 1; k--) cuts.push({ w: bare(k, 0, false), cut: { name: true, mark: true, keep: k } })
    size = { full: rowNeed(said, fit, true, label + 24, 3), floor: cuts[0].w, least: Math.min(...cuts.map((c) => c.w)) }
  } else if (kind === 'count') {
    const b = m.blocking && !closed ? markW + 1 + 2 : 0
    const head = markW + 1 + deskCells(m.total + ' open') + (closed ? GAP : 0)
    size = { full: head + (closed ? deskCells(closed) : 0) + (b ? b + deskCells(m.blocking + ' blocking') : 0) + (m.unreadQuestions ? GAP + deskCells(UNREAD_SHORT) : 0), floor: head + (closed ? Math.min(deskCells(closed), WORDS_FLOOR) : 0) + (b ? b + deskCells(String(m.blocking)) : 0) }
  } else if (kind === 'receipt') size = { full: deskCells(closed), floor: Math.min(deskCells(closed), WORDS_FLOOR) }
  else if (kind === 'offline') size = { full: deskCells(m.offline + OFFLINE_TAIL), floor: WORDS_FLOOR }
  else if (kind === 'waiting') size = { full: markW + 1 + deskCells(waitingRow(inbox)), floor: markW + 1 + WORDS_FLOOR }
  let plan = needsPlan(cols, size, chips, kind === 'strip' ? 2 : 0)
  /* the question row draws the options' words only where its room holds them all, so its full need
     is what it draws at the planned room; the chips take back what that leaves */
  if (kind === 'question' && Number.isFinite(plan.room) && plan.kept.length) {
    const g = rowGap(said, plan.room, fit)
    const drawn = rowNeed(said, fit, answerLabels(said, plan.room, fit).some((l, i) => l !== said.answers[i].letter && l !== STAR + ' ' + said.answers[i].letter), Infinity, g)
    if (drawn < size!.full) plan = needsPlan(cols, { ...size!, full: Math.max(size!.floor, drawn) }, chips)
  }
  const room = Number.isFinite(plan.room) ? plan.room : Infinity
  let lead: any = null
  if (kind === 'strip') lead = stripLine(els, shown!, at!, opts, room)
  else if (kind === 'question') {
    const c = cuts.find((x) => x.w <= room) || cuts.reduce((a, b) => (b.w < a.w ? b : a))
    lead = questionRow(els, shown!, onAnswer, { ...opts, columns: Math.max(1, Math.floor(room)) }, closed, room < rowNeed(said, fit, false, deskCells(shown!.id + '  ') + WORDS_FLOOR, 1), c.cut)
  }
  else if (kind === 'count') lead = countRow(els, m, opts, closed, null, 0, room < size!.full)
  else if (kind === 'receipt') lead = countRow(els, { total: 0 }, opts, closed, null)
  /* the line keeps its words whole only where they fit beside the chips */
  else if (kind === 'offline') lead = offlineRow(els, m.offline, m, Number.isFinite(room) ? { ...opts, columns: Math.max(1, Math.floor(room)) } : opts, 0)
  else if (kind === 'waiting') lead = waitingLead(els, inbox, opts)
  const dropped = chips.filter((_, i) => !plan.kept.includes(i)).map((c) => c.key)
  if (opts.dropped) opts.dropped(dropped.length ? { inbox: dropped.includes('waiting') ? inbox : undefined, queued: dropped.includes('queued') ? queued : undefined, offline: dropped.includes('offline') } : null)
  let x = Number.isFinite(cols) ? cols - plan.kept.reduce((n, i) => n + chips[i].w[plan.forms[i]] + CHIP_GAP, 0) : 0
  /* a card's place is whole cells */
  const drawn = plan.kept.map((i) => { const c = chips[i].draw(plan.forms[i], Math.max(0, Math.floor(x))); x += chips[i].w[plan.forms[i]] + CHIP_GAP; return c })
  if (!lead && !drawn.length) return null
  if (!drawn.length) return lead
  const right = <Box key="needs-chips" flexDirection="row" columnGap={CHIP_GAP} flexShrink={0} alignItems="center">{drawn}</Box>
  if (!lead) return <Box key="needs-line" flexDirection="row">{right}</Box>
  return (
    <Box key="needs-line" flexDirection="row" columnGap={LEAD_GAP} alignItems="center">
      <Box key="needs-lead" flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0}>{lead}</Box>
      {right}
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
  if (deskBand(els, opts)) {
    const line = needsLine(els, m, onAnswer, opts, closed, inbox, queued)
    return line ? <Box key="needs-you" flexDirection="column">{line}</Box> : null
  }
  const rows: any[] = []
  /* the foot row holds only what waits under a single question */
  let foot: any = null
  const one = rowQuestion(m)
  if (one) {
    /* a pressed chip vanishes at once, its row with it; no pressed or saving look */
    if (!one.answers.some((a) => a.state === 'pending' || a.state === 'done')) {
      rows.push(questionRow(els, one, onAnswer, opts, closed))
      const at = stripOf(one, opts)
      if (opts.surface === 'desktop' && opts.unfold && opts.unfold.open(one.id)) rows.push(unfoldTree(els, one, onAnswer, opts))
      /* the strip on a row of its own under the question's, under the label; closed, the band is as before */
      else if (at) rows.push(<Box key={'qbandstrip-' + one.id} flexDirection="column" paddingLeft={opts.surface === 'desktop' ? 3 : 0}>{bandStrip(els, one, at, opts)}</Box>)
    }
    if (inbox || queued) foot = [inbox ? waitingGroup(els, inbox, opts, 0, 1, false) : null, queued ? queuedGroup(els, queued, opts) : null].filter(Boolean)
  } else if (m.total || inbox || queued) {
    rows.push(countRow(els, m, opts, closed, inbox, queued))
  }
  /* the band holds questions and blockers only: the board's calls and the PC's health draw on Home's copy */
  const cs = (!onBand(opts) && Array.isArray(m.calls) ? m.calls : []) as BandCall[]
  /* a frozen band's receipt stays where the pressed row went, so the press shows it landed */
  if (!rows.length && closed && (m.saved || cs.length)) rows.push(countRow(els, { total: 0 }, opts, closed, null))
  const budget = Number.isFinite(opts.rows) ? Math.max(1, opts.rows as number) : Infinity
  /* Home's calls under the questions, within the rows the foot and the offline lines leave */
  const off = m.offline ? offlineLines(m.offline, opts, opts.surface === 'desktop' && !!els.Svg) : 0
  if (cs.length) rows.push(...callTrees(els, cs, opts).slice(0, Math.max(0, budget - rows.length - (foot ? 1 : 0) - off)))
  /* the waiting item and the queued Send each keep a line when one line holds both short of whole */
  const desk = opts.surface === 'desktop' && !!els.Svg
  const stack = !!inbox && !!queued && Number.isFinite(opts.columns)
    && waitingSize(inbox, opts, desk, false).need + GAP + (desk ? deskCells(queuedLabel(queued) + ' Send') + 3 : cellWidth(queuedLabel(queued)) + 1 + chipWidth('Send')) > (opts.columns as number)
  if (foot && rows.length < budget) rows.push(<Box key="band-foot" flexDirection={stack ? 'column' : 'row'} columnGap={GAP} {...(queued && !stack ? { flexWrap: 'wrap' } : {})}>{foot}</Box>)
  if (m.offline && rows.length < budget) rows.push(offlineRow(els, m.offline, m, opts, rows.length))
  /* a half line between rows, so the desktop's 32 px chips do not crowd the next row */
  const gap = opts.surface === 'desktop' ? { rowGap: 1 } : {}
  return rows.length ? <Box key="needs-you" flexDirection="column" {...gap}>{rows}</Box> : null
}
