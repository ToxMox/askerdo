/* The Questions pane's tree:
 * the expanded card pinned at the top in one bordered box, then one index row per other
 * question, the held track's first. The same card draws under the reply that asked (the first
 * telling). Drawn from the model alone; index.ts owns the writes. */
import {
  STAR, badgePicture, cardHref, cardMeta, cellWidth, chipGroups, chipOf, clampWords, gridWidths, pinnedSplit, questionsHeader, rowParts, slotLine,
  updatedText,
} from '../../lib/mod-core.mjs'
import { GLYPHS, queuedLabel, token } from '../../lib/mod-core.mjs'
import { SKY, TILE_GAP, chipHeaderTree, pressFace, pressOver, tileLook, tilePress, wordLink } from './status.tsx'
import { OPEN, SHUT, foldGap, foldRing } from './fold.tsx'

export type QuestionsActions = {
  /* `version`: the one the card was drawn from, so a press made before a rewording is refused */
  pick: (id: string, letter: string, version?: number) => void
  ask: (id: string, tok: string) => void
  asking: (id: string) => void
  toggle: (tok: string) => void
  note: (id: string, value: string) => void
  expand: (id: string) => void
  /* the note field's hotkey: moves the pane's focus ring onto the field */
  noteFocus?: (id: string) => void
  /* drop or snooze with the field's words, or the field as the answer */
  end?: (verb: 'drop' | 'snooze' | 'answer', id: string) => void
  /* the changed stub's press: the question pinned in the Questions tab */
  open?: (id: string) => void
  /* a press on an answered or ended card: says what stands, records nothing */
  stands?: (id: string, said: { name?: string; answered?: string; ended?: string }) => void
  /* opens the strip under an option; no letter closes it (Cancel) */
  strip?: (id: string, letter?: string) => void
  /* queues the answer with the card's note, off the board until Send; unqueue drops it */
  queue?: (id: string, letter: string, version?: number) => void
  unqueue?: (id: string) => void
  /* records and delivers every queued answer together */
  send?: () => void
}

/* expanded: the card pinned at the top; asking: the card whose next chip press asks. */
export type QuestionsView = {
  unfolded: Set<string>; notes: Record<string, string>; focus?: string; expanded?: string; asking?: string
  /* the text each note field is drawn with, set only when the mod moves or clears it;
     a redraw drawing the typed copy re-seeds the field behind the typing and drops keys */
  drawn?: Record<string, string>
  /* the question each press is answering, saving ('pending') or done */
  answering?: Record<string, { letter: string; state: string }>
  /* confirm: an option press opens its strip (else it records at once); strip: the letter
     whose strip is open, per question; queued: each queued answer's letter, per question */
  confirm?: boolean
  strip?: Record<string, string>
  queued?: Record<string, { letter: string }>
}

/* hotkeys: the pane's pinned card only; two cards on one key would clash.
   surface: a desktop draws each letter as a ring, its hotkey's cap cut under it.
   ended: the dim line of a card dropped or snoozed from its footer.
   changed: a telling reworded since, drawn as its one line (changedStub's). */
export type CardOpts = { columns?: number; answered?: string; ended?: string; hotkeys?: boolean; surface?: string; changed?: string; here?: any }

/* The pane head: when the band last read a change, now, and the board's address. */
export type PaneHead = { at?: number; now?: number; board?: string }

const OUT = '↗', DOT = '●', SEP = ' · '
/* the strip's keys, digits so they never take an option's letter or n */
const STRIP_KEYS = { now: '1', queue: '2', cancel: '3', unqueue: '4', send: '5' }
/* a queued answer's terminal chip carries the mark after its letter */
const QUEUED_MARK = '‖'
/* the terminal's pick row tint: a theme key, so it follows the person's theme */
const TINT = 'userMessageBackground'
/* a tile press's blank label when the card's width is not known: wider than any card */
const WIDE = 200
/* an answered card is green: its frame, its head and the chosen tile, in the
   app's theme green so it reads on both themes; the terminal's green its success key */
const ANSWERED_GREEN = 'diffAdded'
const green = (desk: boolean) => (desk ? ANSWERED_GREEN : 'success')
/* the pick's star: the sky on a desktop, the accent on the terminal */
const starInk = (desk: boolean) => (desk ? SKY : 'suggestion')

/* a grid column's size: the terminal's character widths; on a desktop its share of
   the row by weight (width 0 growing by it, the renderer taking no flexBasis) */
function col(w: any, which: 'option' | 'happens' | 'catch'): any {
  if (w.weights) return { width: 0, flexGrow: w.weights[which], flexShrink: 1 }
  if (which === 'option') return { width: w.option, flexShrink: 0 }
  if (which === 'happens' && !w.two) return { width: w.happens, flexShrink: 0 }
  return { flexGrow: 1, flexShrink: 1 }
}

export function questionsTree(els: any, m: any, view: QuestionsView, act: QuestionsActions, columns?: number, head: PaneHead = {}, surface?: string): any {
  const { Box, Text } = els
  const title: any[] = [<Text weight="semibold" size="heading">{questionsHeader(m)}</Text>]
  const fresh = updatedText(head.at as number, head.now as number)
  if (fresh) title.push(<Text dimColor>{fresh}</Text>)
  const top: any[] = [<Box key="questions-title" flexDirection="row" columnGap={2} flexShrink={1}>{title}</Box>]
  /* in the form the desktop opens, lit grey there */
  const board = cardHref(head.board)
  if (board) top.push(wordLink(els, 'questions-board', board, 'open the board ' + OUT, surface === 'desktop'))
  const rows: any[] = [<Box key="questions-head" flexDirection="row" justifyContent="space-between" columnGap={2}>{top}</Box>]
  const { pinned, rest } = pinnedOf(m, view)
  /* the pane's cards wear their track and PC chips, "this PC" and the held track in sky */
  const here = m.here || {}
  if (pinned) rows.push(cardTree(els, pinned, view, act, { columns, hotkeys: true, surface, here }))
  if (rest.length) {
    const index: any[] = [<Box key="questions-also"><Text dimColor>{'Also waiting (' + rest.length + ')'}</Text></Box>]
    const room = Number(columns) > 0 ? Number(columns) - 3 : 0
    for (const g of chipGroups(rest, here)) {
      const first = g.rows[0].id
      index.push(<Box key={'qgroup-' + first} flexDirection="column">
        {chipHeaderTree(els, 'qghead-' + first, g, room, surface)}
        {g.rows.map((c: any) => indexRow(els, c, view, act, columns, surface))}
      </Box>)
    }
    rows.push(<Box key="questions-index" flexDirection="column" rowGap={1}>{index}</Box>)
  }
  if (m.more) rows.push(<Box key="questions-more"><Text dimColor>{'And ' + m.more + ' more: /askerdo'}</Text></Box>)
  return <Box key="questions" flexDirection="column" rowGap={1}>{rows}</Box>
}

/* The card pinned at the top: the one expanded, else the one asked for, else pinnedSplit's;
   the index under it the held track's first. */
export function pinnedOf(m: any, view: QuestionsView): { pinned: any; rest: any[] } {
  const ids = m.cards.map((c: any) => c.id)
  const want = [view.expanded, view.focus].find((id) => id && ids.includes(id))
  return pinnedSplit(m.cards, want, m.here || undefined)
}

/* where the pane's focus ring starts so its keys answer at once: the pinned card's
   quiet note press (Enter only reaches the field), its ask press where an option holds n,
   and with no options the answer field itself. */
export function ringKey(m: any, view: QuestionsView): string | undefined {
  const { pinned } = pinnedOf(m, view)
  if (!pinned) return undefined
  if (!pinned.options.length) return 'qnote-' + pinned.id
  return pinned.options.some((o: any) => o.letter === 'n') ? 'ask-' + pinned.id : 'qnotekey-' + pinned.id
}

const glyphOf = (els: any, c: any): any => {
  const { Text } = els
  return c.blocking ? <Text color="warning">{DOT}</Text> : <Text dimColor>{DOT}</Text>
}

/* One question of the index: the glyph, the id bold, the name (a press pins it; it gives way
   first), the answer chips (a press answers), the age at the right. */
function indexRow(els: any, c: any, view: QuestionsView, act: QuestionsActions, columns?: number, surface?: string): any {
  const { Box, Text, Button } = els
  const desk = surface === 'desktop' && !!els.Svg
  const r = rowParts(c, Number(columns) > 0 ? Number(columns) - 3 : 0, { answers: true, surface: desk ? 'desktop' : surface })
  const name = <Text wrap="truncate-end">{r.name}</Text>
  /* the desktop's name lights as every press does, its press laid over the words */
  const expand = () => act.expand(c.id)
  const left: any[] = [
    <Box key={'qdot-' + c.id} flexShrink={0}>{glyphOf(els, c)}</Box>,
    <Box key={'qrowid-' + c.id} flexShrink={0}><Text bold>{c.id}</Text></Box>,
    desk ? pressFace(els, 'qrowface-' + c.id, name, pressOver(els, 'qrow-' + c.id, Math.max(1, cellWidth(r.name)), expand), { shrink: true })
      : <Button key={'qrow-' + c.id} plain onPress={expand}>{name}</Button>,
  ]
  const press = view.answering && view.answering[c.id]
  const chips = c.options.map((o: any) => <Box key={'ichip-' + o.token} flexShrink={0}>
    {press ? doneChip(els, o, press.letter === o.letter, press.state === 'pending', desk) : chipButton(els, c, o, view, act, false, surface, false, true)}</Box>)
  const right: any[] = [<Box key={'qchips-' + c.id} flexDirection="row" columnGap={1} flexShrink={0}>{chips}</Box>]
  if (r.age) right.push(<Box key={'qage-' + c.id} flexShrink={0}><Text dimColor>{r.age}</Text></Box>)
  return (
    <Box key={'qline-' + c.id} flexDirection="row" justifyContent="space-between" columnGap={1} flexWrap="wrap">
      <Box key={'qleft-' + c.id} flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>{left}</Box>
      <Box key={'qright-' + c.id} flexDirection="row" columnGap={1} flexShrink={0}>{right}</Box>
    </Box>
  )
}

/* A letter chip: the terminal's bracketed button, the pick's primary; in ask mode the pinned
   card's press asks about the option instead. A desktop draws the letter in its sky badge
   with the press over it; a hotkey's key cap is cut under it and still answers.
   on confirm the press opens the option's strip instead, an index row's pinning its card first. */
const pressFor = (c: any, o: any, view: QuestionsView, act: QuestionsActions, index = false) => () => {
  if (view.asking === c.id) return act.ask(c.id, o.token)
  if (view.confirm && act.strip) {
    if (index) act.expand(c.id)
    return act.strip(c.id, o.letter)
  }
  act.pick(c.id, o.letter, c.version)
}
const queuedOf = (c: any, view: QuestionsView): string | undefined => (view.queued && view.queued[c.id] ? view.queued[c.id].letter : undefined)
function chipButton(els: any, c: any, o: any, view: QuestionsView, act: QuestionsActions, hotkeys: boolean, surface?: string, quiet = false, index = false): any {
  const { Button } = els
  const press = pressFor(c, o, view, act, index)
  const queued = queuedOf(c, view) === o.letter
  if (surface === 'desktop' && els.Svg) return badgeChip(els, o, queued ? 'queued' : o.pick ? 'pick' : 'open', press, hotkeys, quiet)
  const props: any = { key: 'pick-' + o.token, label: queued ? o.letter + ' ' + QUEUED_MARK : o.letter, onPress: press }
  if (hotkeys) props.hotkey = o.letter
  if (o.pick) props.variant = 'primary'
  return <Button {...props} />
}

/* a pressed question's chip: the answer's badge green with its check (the terminal's
   letter with a check, a saving mark until the store confirms), the rest dim; no press */
function doneChip(els: any, o: any, mine: boolean, saving: boolean, desk: boolean): any {
  const { Text } = els
  if (desk) return badgeChip(els, o, mine ? 'answer' : 'other')
  return mine ? <Text color={green(false)} bold>{o.letter + ' ' + (saving ? GLYPHS.pending : GLYPHS.done)}</Text> : <Text dimColor>{o.letter}</Text>
}

/* an option's badge (badgePicture) and, while the card is open, the blank press over it. */
function badgeChip(els: any, o: any, state: string, press?: () => void, hotkeys = false, quiet = false): any[] {
  const { Svg } = els
  const p = badgePicture(o.letter, state)
  const svg = <Svg source={p.source} alt={p.alt} width={p.width} height={p.height} />
  if (!press) return [svg]
  const over = pressOver(els, 'pick-' + o.token, Math.ceil(p.width / 8), press, hotkeys ? o.letter : undefined)
  return quiet ? [svg, over] : [pressFace(els, 'ring-' + o.token, svg, over)]
}

/* Markdown draws the why and the stakes as a reply's text is drawn: one list item per stored
   line (lineSet), bold leads kept; with no Markdown the same items as plain lines. */
function prose(els: any, key: string, text: string): any {
  const { Box, Text, Markdown } = els
  return Markdown ? <Markdown key={key} text={text} /> : <Box key={key}><Text>{text}</Text></Box>
}

/* One card, drawn alike pinned in the pane and under the reply that asked: one bordered
   box of groups a blank row apart (head, crux, grid, why, stakes, footer). answered (a
   token) draws the chips as letters (a desktop's as rings) and a dim line where the footer was. */
export function cardTree(els: any, c: any, view: QuestionsView, act: QuestionsActions, given: CardOpts = {}): any {
  const { Box, Text, Button, Input } = els
  if (given.changed) return changedTree(els, c, given.changed, act, given.surface)
  /* a press shows the answered look at once, saving until the store confirms */
  const press = !given.answered && !given.ended && view.answering ? view.answering[c.id] : undefined
  const opts = press ? { ...given, answered: token(c.id, press.letter) } : given
  const saving = !!press && press.state === 'pending'
  const { answered } = opts
  const desk = opts.surface === 'desktop' && !!els.Svg
  /* answered, the head says so in green, so a scroll past tells it from an open card */
  const done = answered && !opts.ended
    ? <Box key={'qdone-' + c.id}><Text color={saving ? undefined : green(desk)} dimColor={saving} weight="semibold">{(saving ? GLYPHS.pending + ' Saving ' : 'Answered ') + answered}</Text></Box>
    : null
  /* a queued answer says so in the head; the strip opens only on a live card in confirm */
  const live = !answered && !opts.ended
  const queuedAt = live ? queuedOf(c, view) : undefined
  const queuedLine = queuedAt ? <Box key={'qqueued-' + c.id}><Text color="warning" weight="semibold">{'Queued ' + token(c.id, queuedAt) + ': on this PC, off the board until Send'}</Text></Box> : null
  const stripAt = live && view.confirm && view.strip && c.options.some((o: any) => o.letter === view.strip![c.id]) ? view.strip[c.id] : undefined
  const w = gridWidths(opts.columns as number, opts.surface, c.options)
  /* in the pane the chips say where it was asked and the title line its age */
  const chipped = !!opts.here && !!(c.track || c.pc)
  const chipHead = chipped ? chipHeaderTree(els, 'qchiphead-' + c.id, { chips: chipOf(c, opts.here), trackName: c.trackName },
    Number(opts.columns) > 0 ? Number(opts.columns) - 4 : 0, opts.surface) : null
  /* each part its own box, so a narrow card wraps between parts, never inside the track's */
  const parts = cardMeta(c, opts.columns, chipped)
  const meta: any[] = parts.map((p: any, i: number) => {
    const sep = i < parts.length - 1 ? SEP.trimEnd() : ''
    return <Box key={'qmetapart-' + c.id + '-' + i} flexShrink={1}>
      <Text>{p.warn ? <Text color="warning">{p.text}</Text> : <Text dimColor>{p.text}</Text>}<Text dimColor>{sep}</Text></Text></Box>
  })
  const metaRow: any[] = [<Box key={'qmetatext-' + c.id} flexShrink={1} flexDirection="row" flexWrap="wrap" columnGap={1}>{meta}</Box>]
  if (c.url) metaRow.push(wordLink(els, 'qlink-' + c.id, c.url, OUT, opts.surface === 'desktop'))
  /* the head leads with a reversal's marker, then the id in bold, then the ask */
  const beside = c.beside && c.beside.length ? 'Asked in one reply with ' + c.beside.join(', ') + '; a reversal is told alone' : ''
  const groups: any[] = [
    <Box key={'qhead-' + c.id} flexDirection="column">
      {done}
      {queuedLine}
      {c.reverses ? <Box key={'qrev-' + c.id}><Text color="warning" bold>{c.reverses}</Text></Box> : null}
      {beside ? <Box key={'qbeside-' + c.id}><Text color="warning">{beside}</Text></Box> : null}
      {chipHead}
      <Box key={'qtitle-' + c.id} flexDirection="row" columnGap={1}>
        <Box key={'qglyph-' + c.id} flexShrink={0}>{glyphOf(els, c)}</Box>
        <Box key={'qid-' + c.id} flexShrink={0}><Text bold>{c.id}</Text></Box>
        {c.name ? <Box key={'qname-' + c.id} flexShrink={1} flexGrow={1}><Text>{c.name}</Text></Box> : null}
        {chipped && c.age ? <Box key={'qtitleage-' + c.id} flexShrink={0}><Text dimColor>{c.age}</Text></Box> : null}
      </Box>
      {c.ask ? <Box key={'qask-' + c.id}><Text weight="semibold">{c.ask}</Text></Box> : null}
      {metaRow.length > 1 || meta.length ? <Box key={'qmeta-' + c.id} flexDirection="row" columnGap={1}>{metaRow}</Box> : null}
    </Box>,
  ]
  if (c.crux) groups.push(<Box key={'qcrux-' + c.id}><Text italic>{'Decides: ' + c.crux}</Text></Box>)
  /* the ruling's quote and the costs the user turned down, under the crux */
  if (c.ruling && c.ruling.length) {
    groups.push(<Box key={'qruling-' + c.id} flexDirection="column">{c.ruling.map((l: string, i: number) =>
      <Box key={'qruling-' + c.id + '-' + i}><Text dimColor>{l}</Text></Box>)}</Box>)
  }
  const free = !c.options.length
  const gap = desk && ringRoom(c) ? foldGap(els, 'qcol-ring-' + c.id) : null
  const cols: any[] = [
    <Box key={'qcol-option-' + c.id} {...col(w, 'option')}><Text dimColor>Option</Text></Box>,
    ringEnd(els, 'qcol-happens-' + c.id, col(w, 'happens'), <Text dimColor>{w.two ? 'What happens, catch' : 'What happens'}</Text>, w.two ? gap : null),
  ]
  if (!w.two) cols.push(ringEnd(els, 'qcol-catch-' + c.id, col(w, 'catch'), <Text dimColor>Catch</Text>, gap))
  const grid: any[] = [<Box key={'qcols-' + c.id} flexDirection="row" columnGap={1} paddingX={1}>{cols}</Box>]
  const stands = act.stands
  const stand = (answered || opts.ended) && !saving && stands
    ? () => stands(c.id, { name: c.name, answered: opts.ended ? undefined : answered, ended: opts.ended }) : undefined
  const orows = c.options.map((o: any) => optionRow(els, c, o, w, view, act, opts, stand, o.letter === stripAt ? stripTree(els, c, o, view, act, opts, desk) : null))
  /* a desktop's options are tiles a few px apart; the terminal's are rows */
  if (desk) grid.push(<Box key={'qtiles-' + c.id} flexDirection="column" {...TILE_GAP}>{orows}</Box>)
  else grid.push(...orows)
  /* a question with no lettered options has no grid; its field is the answer */
  if (!free) groups.push(<Box key={'qgrid-' + c.id} flexDirection="column">{grid}</Box>)
  /* no fold on the pinned card; the why and the stakes under the grid */
  if (c.gist) groups.push(<Box key={'qwhy-' + c.id} flexDirection="column"><Text weight="semibold">Why</Text>{prose(els, 'qgist-' + c.id, c.gist)}</Box>)
  if (c.stakes) groups.push(<Box key={'qstakesbox-' + c.id} flexDirection="column"><Text weight="semibold">Stakes</Text>{prose(els, 'qstakes-' + c.id, c.stakes)}</Box>)
  if (opts.ended) {
    groups.push(<Box key={'qdone-' + c.id}><Text dimColor>{opts.ended}</Text></Box>)
  } else if (!answered) {
    const foot: any[] = []
    const keyed = !!opts.hotkeys && !!act.noteFocus && !c.options.some((o: any) => o.letter === 'n')
    const end = act.end
    const word = free ? 'answer' : 'note'
    /* a phone draws no field: its pick answers without a note */
    if (Input) {
      if (keyed) foot.push(<Button key={'qnotekey-' + c.id} plain dimColor hotkey="n" label={word} onPress={() => (act.noteFocus as any)(c.id)} />)
      /* one field per card, in the open strip while there is one */
      if (!stripAt) foot.push(noteField(els, c, view, act, keyed, free ? 'your answer' : 'a note sent with the option you press', free ? () => { if (end) end('answer', c.id) } : undefined))
      if (free && end) foot.push(<Button key={'qanswer-' + c.id} variant="primary" label="Answer" onPress={() => end('answer', c.id)} />)
    }
    /* no footer pick; the option rows are the presses and the star marks the recommendation */
    if (!free) {
      const label = view.asking === c.id ? 'press the letter of the option to ask about, or here to cancel' : 'ask about an option'
      foot.push(<Button key={'ask-' + c.id} plain dimColor label={label} onPress={() => act.asking(c.id)} />)
    }
    /* quiet and with no hotkey (letters are options, n the field); snooze needs the field */
    if (end) {
      foot.push(<Button key={'qdrop-' + c.id} plain dimColor label="drop" onPress={() => end('drop', c.id)} />)
      /* a question kept with the session has no snooze */
      if (Input && !c.local) foot.push(<Button key={'qsnooze-' + c.id} plain dimColor label="snooze" onPress={() => end('snooze', c.id)} />)
    }
    groups.push(<Box key={'qfoot-' + c.id} flexDirection="row" columnGap={2} flexWrap="wrap">{foot}</Box>)
  }
  const frame = done && !saving ? { borderColor: green(desk) } : { borderDimColor: true }
  return <Box key={'qcard-' + c.id} flexDirection="column" rowGap={1} borderStyle="round" {...frame} paddingX={1}>{groups}</Box>
}

/* The card's one note field; keyed, its label is the n press beside it. */
function noteField(els: any, c: any, view: QuestionsView, act: QuestionsActions, keyed: boolean, placeholder: string, submit?: () => void): any {
  const { Input } = els
  return <Input key={'qnote-' + c.id} {...(keyed ? {} : { label: c.options.length ? 'note' : 'answer' })} placeholder={placeholder}
    value={(view.drawn || {})[c.id] || ''} onInput={(v: string) => act.note(c.id, v)}
    onSubmit={(v: string) => { act.note(c.id, v); if (submit) submit() }} />
}

/* the strip under the pressed option: the note field, Answer now (records and
   delivers as a press always did), Queue answer (off the board until Send), Unqueue on a queued
   card, Cancel. The pane's pinned card keys them by digit. */
function stripTree(els: any, c: any, o: any, view: QuestionsView, act: QuestionsActions, opts: CardOpts, desk: boolean): any {
  const { Box, Text, Button, Input } = els
  const keys = !!opts.hotkeys
  const queued = queuedOf(c, view)
  const presses: any[] = [['now', 'Answer now', () => act.pick(c.id, o.letter, c.version), true]]
  if (act.queue) presses.push(['queue', 'Queue answer', () => (act.queue as any)(c.id, o.letter, c.version), false])
  if (queued && act.unqueue) presses.push(['unqueue', 'Unqueue', () => (act.unqueue as any)(c.id), false])
  presses.push(['cancel', 'Cancel', () => { if (act.strip) act.strip(c.id) }, false])
  const face = ([k, label, press, primary]: any) => {
    const key = 'q' + k + '-' + c.id
    const hotkey = keys ? (STRIP_KEYS as any)[k] : undefined
    if (desk) return pressFace(els, key + '-face', <Text>{label}</Text>, pressOver(els, key, cellWidth(label) + 1, press, hotkey), { chip: { pick: primary } })
    return <Button key={key} label={label} onPress={press} {...(primary ? { variant: 'primary' } : {})} {...(hotkey ? { hotkey } : {})} />
  }
  const keyed = keys && !!act.noteFocus && !c.options.some((x: any) => x.letter === 'n')
  /* every open strip carries the queue's count and Send while any answer is queued */
  const n = view.queued ? Object.keys(view.queued).length : 0
  const send = n && act.send ? (
    <Box key={'qsendrow-' + c.id} flexDirection="row" columnGap={2} rowGap={desk ? 0.6 : 0} flexWrap="wrap" alignItems="center">
      <Box key={'qsendcount-' + c.id} flexShrink={0}><Text color="warning">{queuedLabel(n)}</Text></Box>
      {face(['send', 'Send', () => (act.send as any)(), false])}
    </Box>
  ) : null
  return (
    <Box key={'qstrip-' + c.id} flexDirection="column" rowGap={desk ? 0.6 : 0} paddingTop={desk ? 0.4 : 0} paddingLeft={desk ? 0 : 2}>
      {Input ? noteField(els, c, view, act, keyed, 'a note sent with ' + o.token) : null}
      <Box key={'qstrippress-' + c.id} flexDirection="row" columnGap={2} rowGap={desk ? 0.6 : 0} flexWrap="wrap">{presses.map(face)}</Box>
      {send}
    </Box>
  )
}

/* a desktop card's options draw the fold ring when one of them unfolds */
const ringRoom = (c: any) => c.options.some((o: any) => o.slots && o.slots.length)

/* the ring, or its room, ends the grid's last column, so the rings stand in one
   column at the row's end and the option column keeps its third of the whole row */
function ringEnd(els: any, key: string, at: any, body: any, end: any): any {
  const { Box } = els
  if (!end) return <Box key={key} {...at}>{body}</Box>
  return (
    <Box key={key} {...at} flexDirection="row" columnGap={1} alignItems="flex-start">
      <Box key={key + '-words'} flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>{body}</Box>
      {end}
    </Box>
  )
}

/* One option as a row of the grid's columns, every row padded alike; the pick starred, on a
   desktop its tile outlined, on the terminal its row tinted. The chip is a sub-column,
   so the title wraps under its own first word, never cut; the terminal's unfold arrow follows the
   title, a desktop's ring ends the row; under 60 cells the catch goes under what happens. */
function optionRow(els: any, c: any, o: any, w: any, view: QuestionsView, act: QuestionsActions, opts: CardOpts, stand?: () => void, strip?: any): any {
  const { Box, Text, Button } = els
  /* answered, a desktop's chosen badge is green with a check and the rest dim */
  const desk = opts.surface === 'desktop' && !!els.Svg
  const done = opts.answered || opts.ended
  const mine = !opts.ended && opts.answered === o.token
  /* an open desktop card's tile is the option's press, lit whole on hover; the tile
     holding the open strip stays lit and takes no press of its own */
  const lit = !!strip
  const live = desk && !done && !lit
  const queued = !done && queuedOf(c, view) === o.letter
  const face = !done ? chipButton(els, c, o, view, act, !!opts.hotkeys, opts.surface, live)
    : opts.ended ? (desk ? badgeChip(els, o, 'other') : <Text dimColor>{o.letter}</Text>)
      : doneChip(els, o, mine, false, desk)
  /* done, the terminal's letter is a plain press saying what stands; a desktop's tile is */
  const chip = done && stand && !desk ? <Button key={'stand-' + o.token} plain onPress={stand}>{face}</Button> : face
  /* the pick's star stays sky on an answered card, so the user sees whether the answer matched it */
  const star = <Text color={starInk(desk)}>{STAR + ' '}</Text>
  /* the options not chosen on an answered or ended card read dim */
  const dim = !!done && !mine
  const isOpen = view.unfolded.has(o.token)
  /* a desktop's fold ring ends the tile's first line, its own press placed over the
     tile's; the terminal keeps its arrow after the title */
  const fold = () => act.toggle(o.token)
  const ring = desk && o.slots.length ? foldRing(els, isOpen, { key: 'oarrow-' + o.token, pressKey: 'unfold-' + o.token, press: fold }) : null
  const arrow = !o.slots.length || desk ? null
    : <Box key={'oarrow-' + o.token} flexShrink={0}><Button key={'unfold-' + o.token} plain label={isOpen ? OPEN : SHUT} onPress={fold} /></Box>
  /* a desktop's title flows word by word. A word too long for the
     column breaks there, never to dots; the star is its own item, dropped where it does not fit */
  const words = String(o.option || '').split(' ').filter(Boolean)
  const flow = desk && words.length > 0
  const word = (wd: string) => <Text wrap="wrap" dimColor={dim}>{wd + ' '}</Text>
  const starred = o.pick && !(w.weights && w.weights.star === false)
  const title = flow
    ? [starred ? <Box key={'ostar-' + o.token} flexShrink={0}>{star}</Box> : null, ...words.map(word)]
    : <Text dimColor={dim}>{o.pick ? star : null}{o.option}</Text>
  /* the badge alone, centered on the title's first line */
  const optionCell: any[] = [
    <Box key={'ochip-' + o.token} flexShrink={0} {...(desk ? { marginRight: 1, height: 1 } : {})}>{chip}</Box>,
    /* a line's last space hangs into the gap after the column, so a word that fits is never cut for it */
    flow ? <Box key={'otitle-' + o.token} flexShrink={1} minWidth={0} marginRight={-0.5} flexDirection="row" flexWrap="wrap">{title}</Box>
      : <Box key={'otitle-' + o.token} flexShrink={1}>{title}</Box>,
  ]
  if (queued) optionCell.push(<Box key={'oqueued-' + o.token} flexShrink={0}><Text color="warning">queued</Text></Box>)
  if (arrow) optionCell.push(arrow)
  /* the rings stand in one column: a row with none keeps the ring's room when another option has one */
  const end = ring || (desk && ringRoom(c) ? foldGap(els, 'ogap-' + o.token) : null)
  const catchText = w.two ? <Text dimColor>{o.catch ? 'catch: ' + o.catch : ' '}</Text> : <Text dimColor={dim}>{o.catch || ' '}</Text>
  const catchCell = w.two ? <Box key={'ocatch-' + o.token}>{catchText}</Box> : ringEnd(els, 'ocatch-' + o.token, col(w, 'catch'), catchText, end)
  const gets = <Box key={'ogets-' + o.token} {...(w.two ? {} : col(w, 'happens'))}><Text dimColor={dim}>{o.gets || ' '}</Text></Box>
  /* a desktop's cells start on one first line, never centered on the tallest */
  const top = desk ? { alignItems: 'flex-start' } : {}
  const cells: any[] = [<Box key={'ocell-' + o.token} {...col(w, 'option')} flexDirection="row" columnGap={1} {...top}>{optionCell}</Box>]
  if (w.two) cells.push(ringEnd(els, 'ohappens-' + o.token, { flexDirection: 'column', ...col(w, 'happens') }, [gets, o.catch ? catchCell : null], end))
  else cells.push(gets, catchCell)
  const parts: any[] = [<Box key={'ocells-' + o.token} flexDirection="row" columnGap={1} {...top}>{cells}</Box>]
  /* the slots in their fixed order, under the title; an empty one is never drawn */
  if (isOpen) {
    for (const s of o.slots) {
      parts.push(<Box key={'slot-' + o.token + '-' + s.id} paddingLeft={2}><Text dimColor={s.id !== 'headline'}>{slotLine(s)}</Text></Box>)
    }
  }
  if (strip) parts.push(strip)
  if (live) parts.unshift(tilePress(els, 'tile-' + o.token, opts.columns || WIDE, pressFor(c, o, view, act)))
  /* the done tile's press lights nothing: the look stays the answered one */
  else if (desk && done && stand) parts.unshift(tilePress(els, 'stand-' + o.token, opts.columns || WIDE, stand))
  /* an open card outlines the pick's tile in sky, an answered one the chosen tile in green */
  /* lit in sky, queued in amber; the terminal's lit row is framed, the frame in its padding's cells */
  const edge = done ? (mine ? green(desk) : false) : lit ? SKY : queued ? 'warning' : !!o.pick
  const look = desk ? tileLook(edge, live, lit)
    : { ...(o.pick ? { backgroundColor: TINT } : {}), ...(lit ? { borderStyle: 'round', borderColor: 'suggestion', paddingX: 0 } : {}) }
  return <Box key={'opt-' + o.token} flexDirection="column" paddingX={1} {...look}>{parts}</Box>
}

/* a card reworded since it was told is one line and one press, no chips; the press
   pins the question in the Questions tab, as the index row's name press does there. */
function changedTree(els: any, c: any, line: string, act: QuestionsActions, surface?: string): any {
  const { Box, Text, Button } = els
  const words = c.id + SEP + line
  const face = <Text dimColor>{words}</Text>
  const open = () => { if (act.open) act.open(c.id) }
  const press = surface === 'desktop' && els.Svg ? pressFace(els, 'qchangedface-' + c.id, face, pressOver(els, 'qopen-' + c.id, cellWidth(words), open))
    : <Button key={'qopen-' + c.id} plain onPress={open}>{face}</Button>
  return <Box key={'qchanged-' + c.id} flexDirection="row">{press}</Box>
}

/* The first telling: the card drawn under the reply that asked. */
export function firstTellingTree(els: any, c: any, view: QuestionsView, act: QuestionsActions, opts: CardOpts = {}): any {
  const { Box } = els
  return <Box key={'telling-' + c.id} flexDirection="column" marginTop={1}>{cardTree(els, c, view, act, { ...opts, hotkeys: false })}</Box>
}

/* a one-field fix's words now and what they become, each quoted and clamped to two
   lines in the card's room (its border and padding, the label); a desktop's prose runs 1.2 a cell */
const CHANGE_LABELS = [['now', 'Now:'], ['becomes', 'Becomes:']]
function changeRows(els: any, n: number, change: any, columns?: number, desk = false): any {
  const { Box, Text } = els
  const room = Number(columns) > 0 ? Number(columns) - 4 - cellWidth('Becomes: ') - 2 : 0
  const width = room > 0 ? Math.floor(room * (desk ? 1.2 : 1)) : 60
  const rows = CHANGE_LABELS.map(([k, label]) => {
    const words = String(change[k] || '')
    return (
      <Box key={'ov' + k + '-' + n} flexDirection="row" columnGap={1} alignItems="flex-start">
        <Box key={'ov' + k + 'label-' + n} flexShrink={0}><Text dimColor>{label}</Text></Box>
        <Box key={'ov' + k + 'words-' + n} flexShrink={1}>{words ? <Text>{'"' + clampWords(words, width, 2) + '"'}</Text> : <Text dimColor>(empty)</Text>}</Box>
      </Box>
    )
  })
  return <Box key={'ovchange-' + n} flexDirection="column">{rows}</Box>
}

/* an override request under the reply that made it, slim: a reversal's lead loud on top,
   the session's summary, what the board measured, its page, and Allow and Keep (overrideCard). */
export function overrideTellingTree(els: any, m: any, press: (decision: string) => void, surface?: string, columns?: number): any {
  const { Box, Text, Button } = els
  const desk = surface === 'desktop' && !!els.Svg
  const n = m.request
  const head: any[] = []
  if (m.lead) head.push(<Box key={'ovlead-' + n}><Text color="warning" bold>{m.lead}</Text></Box>)
  head.push(<Box key={'ovtitle-' + n} flexDirection="row" columnGap={1}>
    <Box key={'ovid-' + n} flexShrink={0}><Text bold>{m.title}</Text></Box>
    <Box key={'ovwhat-' + n} flexShrink={1}><Text dimColor>{m.what}</Text></Box>
  </Box>)
  if (m.records) head.push(<Box key={'ovrecs-' + n}><Text dimColor>{m.records}</Text></Box>)
  const meta: any[] = [<Box key={'ovmeasured-' + n} flexShrink={1}><Text dimColor>{m.measured}</Text></Box>]
  if (m.url) meta.push(wordLink(els, 'ovlink-' + n, m.url, 'before and after ' + OUT, desk))
  const groups: any[] = [
    <Box key={'ovhead-' + n} flexDirection="column">{head}</Box>,
    <Box key={'ovsummary-' + n}><Text>{m.summary}</Text></Box>,
  ]
  if (m.change) groups.push(changeRows(els, n, m.change, columns, desk))
  groups.push(<Box key={'ovmeta-' + n} flexDirection="row" columnGap={2} flexWrap="wrap">{meta}</Box>)
  const foot: any[] = m.presses.map((p: any) => {
    const key = 'ovpress-' + p.decision + '-' + n
    const act = () => press(p.decision)
    return desk ? pressFace(els, key + '-face', <Text>{p.label}</Text>, pressOver(els, key, cellWidth(p.label) + 1, act), { chip: {} })
      : <Button key={key} label={p.label} onPress={act} />
  })
  if (m.line) {
    const look = m.state === 'allow' ? { color: green(desk) } : m.state === 'changed' || m.state === 'expired' ? { color: 'warning' } : { dimColor: true }
    foot.unshift(<Box key={'ovstate-' + n} flexShrink={1}><Text {...look}>{m.line}</Text></Box>)
  }
  if (foot.length) groups.push(<Box key={'ovfoot-' + n} flexDirection="row" columnGap={2} flexWrap="wrap">{foot}</Box>)
  const frame = m.state === 'allow' ? { borderColor: green(desk) } : { borderDimColor: true }
  return (
    <Box key={'ovtelling-' + n} flexDirection="column" marginTop={1}>
      <Box key={'ovcard-' + n} flexDirection="column" rowGap={1} borderStyle="round" {...frame} paddingX={1}>{groups}</Box>
    </Box>
  )
}

/* The reply as the engine draws it, the cards of the asks its turn made under it. */
export function underReply(els: any, reply: any, cards: any[]): any {
  const { Box } = els
  return <Box key="askerdo-reply" flexDirection="column">{reply}{cards}</Box>
}

export function questionsLoading(els: any): any {
  const { Box, Text } = els
  return <Box key="questions"><Text dimColor>Reading the questions...</Text></Box>
}
