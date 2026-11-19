/* The band tests' shared kit: the band's props and mount, its rows' readers, a desktop row's drawn width and
 * the boards of one and three questions. */
import { deskCells } from '../../../lib/mod-core.mjs'

export const PLUGIN = 'askerdo'
export const STAR = '\u2605'
export const FLAG = '\u{1F3C1}'
export const DONE = '✓'
export const SAVING = '◌'
export const SKY = '#00AEEF'
export const PANE_ID = 'askerdo'
export const SURFACES = ['terminal', 'desktop'] as const
export const BAND = {
  hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 11 }, view: {},
}
export const PANE = { title: 'Questions', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
export const BOARD = 'http://askerdo.localhost:53265/0123456789abcdef0123456789abcdef/#p=proj'
/* a board change from elsewhere draws once the redraw cooldown has passed */
export const cooled = async (w: any) => { await w.clock.settle(); await w.clock.advance(1000); await w.clock.settle() }
export const mount = ($: any, surface: string) => $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
export const rowKeys = async (ui: any) => ((await ui.find({ key: 'needs-you' }))?.children || []).map((r: any) => r.props.key)
/* a chip's words: the desktop's face beside its badge, the terminal's Button */
export const labels = async (ui: any) => {
  const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('answer-'))
  return Promise.all(keys.map(async (k: string) => String(((await ui.find({ key: 'chipface-' + k.slice(7) })) || (await ui.find({ key: k })))!.text).trim()))
}

/* a desktop row's one-line width in cells as laid out: Texts by deskCells, Svgs by px, Boxes side by side
   with their gaps, padding, border and margins; hover cards and laid-over presses take none; firm: cut words take none */
export const PX = 8.453
export const num = (v: any) => (typeof v === 'number' ? v : 0)
export function drawnCells(n: any, firm = false): number {
  const p = (n && n.props) || {}
  if (!n || typeof n !== 'object' || p.position === 'absolute' || p.display === 'none') return 0
  const all: any[] = [].concat(n.children || []).flat(Infinity)
  const kids = all.filter((c: any) => c && typeof c === 'object')
  const said = (t: any): string => (typeof t === 'string' || typeof t === 'number' ? String(t) : t && t.type === 'Text' ? [].concat(t.children || []).flat(Infinity).map(said).join('') : '')
  if (n.type === 'Text') return firm && /^truncate/.test(String(p.wrap)) ? 0 : deskCells(said(n), p.bold ? 600 : 400)
  if (n.type === 'Svg') return num(p.width) / PX
  const side = (k: string) => num(p[k + 'Left'] ?? p[k + 'X'] ?? p[k]) + num(p[k + 'Right'] ?? p[k + 'X'] ?? p[k])
  const shown = kids.filter((c: any) => !(c.props && (c.props.position === 'absolute' || c.props.display === 'none'))).map((c: any) => drawnCells(c, firm))
  const inner = p.flexDirection === 'column' ? Math.max(0, ...shown) : shown.reduce((a, b) => a + b, 0) + num(p.columnGap ?? p.gap) * Math.max(0, shown.length - 1)
  return (typeof p.width === 'number' ? p.width : inner + side('padding') + (p.borderStyle ? 2 / PX : 0)) + side('margin')
}

/* on TR-3, the track this session holds, so the band shows it */
export function oneQuestion(w: any) {
  w.questions = [
    { id: 'Q106', name: 'store shape', blocking: true, track: 'TR-3', subscribers: ['other'], pick: 'b', crux: 'one file or many',
      created: new Date(Date.now() - 3 * 3600000).toISOString(),
      options: [{ type: 'a', option: 'one file', costsYou: 'merge churn', undo: 'one-way: the split files are gone' },
        { type: 'b', option: 'many files', costsYou: 'more files to scan' }] },
  ]
}

export function threeQuestions(w: any) {
  oneQuestion(w)
  w.questions.unshift({ id: 'Q107', name: 'mine, not blocking', blocking: false, subscribers: ['sess-1'], pick: null,
    options: [{ type: 'a', option: 'yes' }, { type: 'b', option: 'no' }] })
  w.questions.push({ id: 'Q108', name: 'someone else, not blocking', blocking: false, subscribers: ['other'], options: [] })
}
