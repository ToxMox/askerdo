/* The contract tests' shared kit: the ask, its options and the style, the prompt's compose, a reply, its row and
 * its mount, the checks switched on, and the notes and flags they leave. */
import { world } from './world.ts'

export const PLUGIN = 'askerdo'
export const ASK = 'mcp__askerdo__ask'
export const ASKED = 'One file (a) or many (b, my pick)?'
export const SURFACES = ['terminal', 'desktop'] as const
export const HAND = '\u{1F64B}', GREEN = '\u{1F7E2}', FLAG = '\u{1F3C1}', OK = '\u2705', SUN = '\u2600\uFE0F'
export const CHECKS = { emdash: true, forecast: true, hub: true }
export const BAND = {
  hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 11 }, view: {},
}
export const OPTIONS = [
  { type: 'a', option: 'one file', getsYou: 'simple', costsYou: 'merge churn' },
  { type: 'b', option: 'many files', getsYou: 'isolation', costsYou: '', undo: 'one-way: a migration', headline: 'Each record is its own file.' },
]

/* the output style as the engine's attachment carries it, its two per-surface sections at the end */
export const STYLE = 'Rule one.\n\n### On the desktop app\n\nIntro.\n\n- a line\n- another\n\n### On the terminal and anywhere else\n\nIntro.\n\n- a line\n'

export const compose = ($: any, surfaces: string[], tools: string[] = []) => $.prompt.compose({
  model: 'm', promptModel: 'm', surfaces, tools, outputStyle: null, traits: [],
})
/* the contract checks the model was told, once a call has carried what waits */
export const notes = async ($: any, w: any) => {
  await w.step($)
  return w.told.filter((m: any) => !m.agentId && m.type === 'user'
    && String(m.content[0].text).startsWith('AskerDo contract check')).map((m: any) => m.content[0].text)
}
export const flags = (w: any) => w.logs.filter((l: string) => l.startsWith('AskerDo: '))

export async function reply($: any, answer: string, id = 't1') {
  await $.turn.start({ text: 'work', turnId: id })
  await $.turn.complete({ answer, durationMs: 5, isAborted: false, turnId: id, reason: 'answer' })
}

export function checked(on: any, checks: any = CHECKS) {
  const w = world(on)
  w.contract = { section: 'The mod section: writes no names line.', checks }
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'core', scope: 'shared' }] }))
  return w
}

/* The reply that asked: a text row the model wrote this turn, as the engine stores it. */
export const replyRow = ($: any, uuid: string, text = 'Q512 waits for you.') => $.session.append({
  message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
  door: 'response', origin: { kind: 'model', model: 'm' }, uuid,
})
/* the engine's own reply drawing, beneath the plugin */
export const engineReply = (on: any) => on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'Box', props: { key: 'engine-reply' }, children: [] }))
export const mountReply = ($: any, surface: string, id: string, text = 'Q512 waits for you.', viewport?: any) => $.ui.mount({ plugin: PLUGIN, surface,
  component: 'AssistantMessage', requestId: id, props: { text, isFirstOfReply: true }, ...(viewport ? { viewport } : {}) })
export const turnEnd = ($: any, turnId: string) => $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId, reason: 'answer' })
export const RULES = {
  record: 'TR-3', inject: true, revision: 'r1', text: 'Rules in force (AskerDo rev r1, for TR-3):\n- Few tests. [built in]',
  values: { 'tests.policy': 'few', 'tests.fullRun': 'end', 'tests.pinWording': false },
}
