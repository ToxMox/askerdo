/* The AskerDo mod's core: typed tools and commands over
 * the AskerDo CLI, the track the session holds, the Needs-you band and its
 * toasts (band.tsx draws it), the AskerDo pane (home.tsx; its Questions tab
 * questions.tsx, its Tracks tab pane.tsx), the AskUserQuestion redraw, the switch that silences the
 * settings-hook drains and the SessionStart summary while the mod runs, the
 * answer delivery that replaces them, the depth meter and the agent guard.
 * Every store write goes through bin/askerdo.mjs, the one writer path. */
import type { Register } from 'claude-code'
import {
  BAND_MAX, bandSection, COMMAND, COMMAND_DESCRIPTION, COMMAND_HINT, NEEDS_TRACK, OLD_PANE_IDS, PANE_ID, POLL_MS,
  agentDenyReason, agentNote, agentStage, agentTokens, alertUrl, askPrompt, askResult,
  withChipStates, bandSurfaces, closedLine, deliveryText, depthReading, guardChip, guardOf, guardText,
  handoffAlert, handoffGate, pastWindow, isStateNoteCall, mainDepthNote, marksCrossed, marksFor, parseGuard, questionsModel,
  readingFrom, rememberKeys, stateNoteFrom,
  decisionQuestions, depthFrom, handoffAsk, handoffFilesNote, handoffPrompt, isRecordId, newlyWaiting, openSetText, tracksView,
  USAGE, answerArgs, parseAnswer, parseAskerdo, parseResume, parseTrack, shelfText, taskEditArgs, trackAlert, trackText,
  threadNameOf, token, unquote, validateAsk, validateHandoff, waitingKeys, waitingToast,
  commandLead, heldText, lostTrackNote,
  AGENT_TOOLS, ASK_TOOL, agentChecks, firstTellingCard, flagLine, flagNote, isHubShell, namesBoardId, replyChecks,
} from '../../lib/mod-core.mjs'
import { clashText, toldClash } from '../../lib/mod-core.mjs'
import { closedFinished, inboxWaiting, withWaiting } from '../../lib/mod-core.mjs'
import { withColumns } from '../../lib/mod-core.mjs'
import { receiptRow, receiptsOf } from '../../lib/mod-core.mjs'
import { aloneInTurn, besideSlip } from '../../lib/mod-core.mjs'
import { changedStub, rewordResult, rewordedSince } from '../../lib/mod-core.mjs'
import { briefPaths, withRules } from '../../lib/mod-core.mjs'
import { handedOn, laneNote, latestLane, tasksOfDispatch } from '../../lib/mod-core.mjs'
import { commandSuggestions } from '../../lib/mod-core.mjs'
import { cardHref, recordHref, signedRoot } from '../../lib/mod-core.mjs'
import { commandLine, depthText, editWords, peerBody, resumeLine, rewoundNote, wholePercent } from '../../lib/mod-core.mjs'
import { handoffCheckLine, verifyLines } from '../../lib/mod-core.mjs'
import { noBandHere, noBandSection, surfacePick } from '../../lib/mod-core.mjs'
import { carriesTold, hideTold, resumeBlock, tellBlock } from '../../lib/mod-core.mjs'
import { capFirst, nameOf } from '../../lib/mod-core.mjs'
import { carryBlock, offlineLine, withOffline } from '../../lib/mod-core.mjs'
import { feedRows } from '../../lib/mod-core.mjs'
import { isHubRegister, isLocalId, localCard, localEvent, localResult, pruneLocal, withLocal } from '../../lib/mod-core.mjs'
import { agentsTree, askerdoPane, graphTree, homeTree, paneTitle, standLine, whereFacts, whereParts } from './home.tsx'
import { freshField, newSettingsView, settingsTree } from './settings.tsx'
import type { SettingsPlace } from './settings.tsx'
import type { Where } from './home.tsx'
import type { PaneTab } from './home.tsx'
import { overrideTellingTree, underReply } from './questions.tsx'
import { heldTrack, homeGraph, localUrl, mineOf, statusModel, versionWords } from '../../lib/mod-core.mjs'
import { answeringOf } from '../../lib/mod-core.mjs'
import { callPressText, parseOverride } from '../../lib/mod-core.mjs'
import { briefDecisionIds, isHubOverride, overrideArgs, overrideCard, overrideOn, overrideResult, overrideTold } from '../../lib/mod-core.mjs'
import { agentsModel } from '../../lib/mod-core.mjs'
import { closedInbox, commitsIn, offTrackSlip } from '../../lib/mod-core.mjs'
import { inboxLines } from '../../server/handoff-text.mjs'
import { STOP_FIRST, handoffCurrency, stepChanges, stepTool } from '../../lib/mod-core.mjs'
import { updateProblems } from '../../lib/handoff-payload.mjs'
import { statusTree } from './status.tsx'
import { bandTree } from './band.tsx'
import { paneLoading, paneTree } from './pane.tsx'
import { GUIDE_HOME, guideIndex, guideTree } from './guide.tsx'
import type { GuidePage } from './guide.tsx'
import type { PaneView } from './pane.tsx'
import { firstTellingTree, pinnedOf, questionsLoading, questionsTree, ringKey } from './questions.tsx'
import type { QuestionsActions, QuestionsView } from './questions.tsx'
import { COMMAND_TOOLS, FILE_TOOLS, findText, matchCall, parseProc, procNote, procToast, ranText, scanText } from '../../lib/proc-match.mjs'
import { decisionHits } from '../../lib/decision-match.mjs'
import { decideArgs, decidedText, decisionNote, decisionsBlock, heldDecisionsNote, withDecisions } from '../../lib/mod-core.mjs'

const PLUGIN = 'askerdo'
const SHOW_MAX = 8
/* the cells a reply's text sits in from the left, after its bullet */
const REPLY_INDENT = 2
/* a desktop reply's viewport counts cells of the 13 px code font (7.8 px), a card's are its
   14 px Anthropic Sans (8.45 px); measured with the app's fonts in headless Edge, 2026-10-27 */
const DESK_CELL = 7.8 / 8.45
/* the desktop band's left inset, in ch (about 4 px), so the mark
   sits over the composer's +; the right end already sits under the mic */
const BAND_INSET = 0.5

/* stale: the note of a read the local server served from its offline cache */
type Run = { ok: boolean; code: number; out: string; err: string; json?: any; stale?: string }

/* Module memory only: a hot reload starts it over, and every value here can be
 * read back from the store. */
const mem: {
  /* the track the session holds (TR-n), its key, why the board could not be read;
     gen moves with each of the mod's own track moves, so a read begun before one is dropped */
  id?: string; track?: string | null; trackKey?: string | null; trackErr?: string; gen: number
  cwd?: string; clearedFrom?: string; settling?: Promise<void>
  /* the main loop's running turn, for delivery; earlier ids of this process (/clear) */
  turn?: string; lineage: string[]
  /* the session has touched the board; the surfaces the last prompt drew on */
  engaged?: boolean; surfaces?: string[]
  /* the session id that wrote its handoff or whose last reply closed finished;
     closedRead: read back from the store after a reload */
  closed?: { sid: string; as: 'handed off' | 'finished' }; closedRead?: boolean
} = { lineage: [], gen: 0 }

/* a closed session's band is frozen; '' while it is live. */
function closedAs(sid: string | undefined): string {
  return sid && mem.closed && mem.closed.sid === sid ? mem.closed.as : ''
}

/* the freeze outlives a hot reload, per session in the shared store, the newest kept */
const CLOSED_KEPT = 50
async function keepClosed($: any, sid: string, as?: 'handed off' | 'finished'): Promise<void> {
  mem.closed = as ? { sid, as } : undefined
  mem.closedRead = true
  try {
    const all = (await $.store.get('closedSessions')) || {}
    delete all[sid]
    if (as) all[sid] = as
    const keys = Object.keys(all)
    for (const k of keys.slice(0, Math.max(0, keys.length - CLOSED_KEPT))) delete all[k]
    await $.store.set('closedSessions', all)
  } catch {}
}

async function readClosed($: any, sid: string): Promise<void> {
  if (mem.closedRead) return
  mem.closedRead = true
  try {
    const as = ((await $.store.get('closedSessions')) || {})[sid]
    if ((as === 'handed off' || as === 'finished') && !mem.closed) mem.closed = { sid, as }
  } catch {}
}

/* a session that takes a track again, or that the user types in, is live again */
async function liftFreeze($: any, sid: string): Promise<void> {
  await readClosed($, sid)
  if (!closedAs(sid)) return
  await keepClosed($, sid)
  try { $.ui.invalidate('ui.render') } catch {}
  startPoll($)
  kick($)
}

/* the first touch of the board redraws the band with the blockers in scope. */
function engage($: any): void {
  if (mem.engaged) return
  mem.engaged = true
  kick($)
}

/* engaged this process, else by what the band holds for it (a held track, a task
   in hand, its own question) or the store's mark, so a reload keeps the mod's section */
const engagedMark = { read: new Set<string>(), saved: new Set<string>() }
async function isEngaged($: any): Promise<boolean> {
  const sid = await sessionId($).catch(() => mem.id)
  if (!sid) return !!mem.engaged
  if (!mem.engaged && (mem.track || (band.hand || []).length || (band.questions || []).some((q: any) => q && q.session === sid))) mem.engaged = true
  if (!mem.engaged && !engagedMark.read.has(sid)) {
    engagedMark.read.add(sid)
    try { if (((await $.store.get('engaged')) || {})[sid] === true) { mem.engaged = true; engagedMark.saved.add(sid) } } catch {}
  }
  if (mem.engaged && !engagedMark.saved.has(sid)) { engagedMark.saved.add(sid); await saveMarks($, sid, true, 'engaged') }
  return !!mem.engaged
}

/* the store root the project's settings name; the app's own environment
   carries none, so without it a sandboxed session's mod writes the live store. */
const seam: { cwd?: string; env?: Promise<Record<string, string> | undefined> } = {}

async function readSeam($: any, cwd: string): Promise<Record<string, string> | undefined> {
  for (const f of ['settings.local.json', 'settings.json']) {
    let env: any
    try { env = JSON.parse(String(await $.fs.read(cwd + '/.claude/' + f))).env } catch { continue }
    const root = env && env.ASKERDO_ROOT
    if (typeof root !== 'string' || !root) continue
    const out: Record<string, string> = { ASKERDO_ROOT: root }
    if (typeof env.ASKERDO_SANDBOX_HOME === 'string' && env.ASKERDO_SANDBOX_HOME) out.ASKERDO_SANDBOX_HOME = env.ASKERDO_SANDBOX_HOME
    return out
  }
  return undefined
}

/* Every call of the mod's goes through here; no root configured passes no env. The
   CLI and the scripts run on the local server's route; only a 409 runs in a process. */
async function seamEnv($: any): Promise<Record<string, string> | undefined> {
  const cwd = await projectDir($)
  if (!seam.env || seam.cwd !== cwd) { seam.cwd = cwd; seam.env = readSeam($, cwd).catch(() => undefined) }
  return seam.env
}

async function spawn($: any, argv: string[], init: any): Promise<any> {
  const env = await seamEnv($)
  const routed = await routeRun($, argv, init, env).catch((err: any) => failedRun('the call to the local server broke (' + String((err && err.message) || err) + ')'))
  if (routed) return routed
  return $.process.run(argv, env ? { ...init, env } : init)
}

/* ---- the local server's route ---- */

/* host: the variables a spawned CLI inherits; url: local.json's, per store root; down: the
   local.json and base a call found nobody listening at, read as no server until the file
   changes; starting: the one start in flight; refused: a start that failed, by root and local.json */
const route: {
  host?: Promise<Record<string, string>>; key?: string; url?: string; text?: string; version?: Promise<string>; down?: { text: string; base: string }
  starting?: Promise<string>; refused?: { key: string; text: string; why: string }
} = {}
/* what the launcher sends of its environment (bin/askerdo.mjs SENT) */
const SENT = /^(ASKERDO_|CLAUDE_)|^(HOME|USERPROFILE)$/

/* $.env.get takes literal names: the ones the commands read */
function hostEnv($: any): Promise<Record<string, string>> {
  if (!route.host) {
    route.host = (async () => {
      const got: Array<[string, Promise<any>]> = [
        ['ASKERDO_ROOT', $.env.get('ASKERDO_ROOT')], ['ASKERDO_SANDBOX_HOME', $.env.get('ASKERDO_SANDBOX_HOME')],
        ['ASKERDO_MOD', $.env.get('ASKERDO_MOD')],
        ['ASKERDO_BOARD_URL', $.env.get('ASKERDO_BOARD_URL')], ['ASKERDO_BOARD_TOKEN', $.env.get('ASKERDO_BOARD_TOKEN')],
        ['ASKERDO_BOARD_VERSION', $.env.get('ASKERDO_BOARD_VERSION')],
        ['CLAUDE_PLUGIN_DATA', $.env.get('CLAUDE_PLUGIN_DATA')], ['CLAUDE_CONFIG_DIR', $.env.get('CLAUDE_CONFIG_DIR')],
        ['HOME', $.env.get('HOME')], ['USERPROFILE', $.env.get('USERPROFILE')],
      ]
      const out: Record<string, string> = {}
      for (const [k, p] of got) {
        try { const v = await p; if (typeof v === 'string' && v) out[k] = v } catch {}
      }
      return out
    })()
  }
  return route.host
}

const absPath = (p: string) => /^([A-Za-z]:[\\/]|[\\/])/.test(p)

/* The environment the spawn would have had, as the launcher filters it. */
async function callerEnv($: any, over?: Record<string, string>): Promise<Record<string, string>> {
  const all: Record<string, string> = { ...(await hostEnv($)), ...(over || {}) }
  const out: Record<string, string> = {}
  for (const k of Object.keys(all)) if (SENT.test(k)) out[k] = all[k]
  return out
}

/* The store roots the launcher looks in for board/local.json (bin/askerdo.mjs roots). */
function routeRoots(env: Record<string, string>): string[] {
  const seamRoot = String(env.ASKERDO_ROOT ?? '').trim()
  if (seamRoot) return absPath(seamRoot) ? [seamRoot] : []
  const named = String(env.ASKERDO_SANDBOX_HOME ?? '').trim()
  const home = named && absPath(named) ? named : env.USERPROFILE || env.HOME || ''
  return home ? [home.replace(/[\\/]+$/, '') + '/.claude/askerdo'] : []
}

/* The route's base from local.json while it names a live server; '' for none. */
async function routeBase($: any, env: Record<string, string>): Promise<string> {
  const roots = routeRoots(env)
  const key = roots.join('|')
  if (route.key === key && route.url) return route.url
  route.key = key
  route.url = undefined
  route.text = ''
  for (const root of roots) {
    let text = ''
    try { text = String(await $.fs.read(root + '/board/local.json')) } catch { continue }
    route.text = text
    /* a server writes a new secret and pid at each start, so the text changes */
    if (route.down && route.down.text === text) return ''
    let l: any = null
    try { l = JSON.parse(text) } catch {}
    const url = l && typeof l.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+\//.test(l.url) ? l.url.replace(/\/+$/, '') : ''
    route.url = url || undefined
    if (url) route.down = undefined
    return url
  }
  return ''
}

const slashed = (base: string) => base.replace(/\/*$/, '/')

/* the engine's words for a connect nobody answered (2.1.308: `failed: ConnectionRefused: ...`) */
const NOBODY = /ConnectionRefused|ECONNREFUSED|Unable to connect/i

/* Nobody listening at base: local.json as read stays down until it changes. */
function markDown(base: string): void {
  route.down = { text: route.text || '', base: slashed(base) }
  route.url = undefined
}

/* A fetch on the route: the response, null when nobody listened (nothing was sent), else
   'dropped': a reset, the host's 30 s limit, an abort or any other error may have run it
   (only a refused connect starts the process). */
async function routeFetch($: any, base: string, path: string, init: any): Promise<any> {
  try {
    return await $.http.fetch(slashed(base) + path, init)
  } catch (err: any) {
    const why = String((err && (err.code || err.message)) || err)
    if (!NOBODY.test(why)) return 'dropped'
    markDown(base)
    return null
  }
}

/* The build this call wants (the launcher's versionOf): the seam, else plugin.json's. */
function routeVersion($: any, env: Record<string, string>): Promise<string> {
  const seamVersion = env.ASKERDO_BOARD_VERSION
  if (seamVersion) return Promise.resolve(seamVersion)
  if (!route.version) {
    route.version = (async () => {
      try { return String(JSON.parse(String(await $.fs.read($.plugin.root + '/.claude-plugin/plugin.json'))).version || '') } catch { return '' }
    })()
  }
  return route.version
}

/* the scripts the local server runs in process (lib/mod-scripts.mjs) */
const ROUTED_SCRIPTS = ['mod-alias', 'mod-contract', 'mod-inbox', 'mod-queue', 'rules', 'depth-marker']

/* Which route runs an argv, or null for a process. */
function routeOf(argv: string[]): { path: string; args: string[] } | null {
  const script = String(argv[1] || '').replace(/\\/g, '/')
  if (argv[0] !== 'node') return null
  if (script.endsWith('/bin/askerdo.mjs')) return { path: 'cli', args: argv.slice(2) }
  const m = script.match(/\/scripts\/([a-z-]+)\.mjs$/)
  return m && ROUTED_SCRIPTS.includes(m[1]) ? { path: 'mod', args: [m[1], ...argv.slice(2)] } : null
}

async function routePost($: any, base: string, path: string, body: any): Promise<{ status: number; reply: any } | 'dropped' | null> {
  const r = await routeFetch($, base, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r || r === 'dropped') return r
  let reply: any = null
  try { reply = JSON.parse(r.text) } catch {}
  return { status: r.status, reply }
}

const failedRun = (why: string) => ({ exitCode: 2, stdout: '', stderr: 'AskerDo: ' + why + '; it may have run, so it was not run again\n' })
const notRun = (why: string) => ({ exitCode: 2, stdout: '', stderr: 'AskerDo: ' + why + '; nothing was run\n' })

/* With no local server answering, the mod starts it once through
   the board verb (a process, since it starts one); a start that failed is told, and tried
   again only when local.json changes. '' once started, else why not. */
function startLocal($: any, env?: Record<string, string>): Promise<string> {
  const key = route.key || ''
  const text = route.text || ''
  if (route.refused && route.refused.key === key && route.refused.text === text) return Promise.resolve(route.refused.why)
  if (!route.starting) {
    route.starting = (async () => {
      const argv = ['node', $.plugin.root + '/bin/askerdo.mjs', 'board', '--json']
      let r: any
      try { r = await $.process.run(argv, { timeoutMs: 30000, ...(env ? { env } : {}) }) } catch (err: any) { r = { exitCode: -1, stderr: String((err && err.message) || err) } }
      if (r && r.exitCode === 0) {
        route.refused = undefined
        route.down = undefined
        route.key = undefined
        return ''
      }
      const said = String((r && r.stderr) || '').replace(/^AskerDo: /gm, '').trim().split(/\r?\n/)[0]
      const why = said || 'the board command exited ' + (r ? r.exitCode : 'with nothing')
      route.refused = { key, text, why }
      return why
    })().finally(() => { route.starting = undefined })
  }
  return route.starting
}

const noServer = (why: string) => notRun('the local server is not running and could not be started: ' + why)

/* The route's base, the local server started first when none answers; '' with `why` set. */
async function liveBase($: any, env: Record<string, string>, over?: Record<string, string>): Promise<{ base: string; why?: string }> {
  const base = await routeBase($, env)
  if (base) return { base }
  const why = await startLocal($, over)
  if (why) return { base: '', why }
  const again = await routeBase($, env)
  return again ? { base: again } : { base: '', why: 'it started, but board/local.json names no address that answers' }
}

/* A process's result from the route, or null to start the process: a 409 only (the command
   must run in the caller). A 500 or a dropped call may have run: never run again. */
async function routeRun($: any, argv: string[], init: any, over?: Record<string, string>): Promise<any> {
  const which = routeOf(argv)
  if (!which) return null
  const env = await callerEnv($, over)
  let live = await liveBase($, env, over)
  if (!live.base) return noServer(live.why || '')
  const call: any = { argv: which.args, cwd: await projectDir($), env, version: await routeVersion($, env) }
  if (init && init.stdin !== undefined) call.stdin = init.stdin
  let r = await routePost($, live.base, which.path, call)
  /* nobody listened, so nothing ran: the server is started once and the call sent again */
  if (!r) {
    live = await liveBase($, env, over)
    if (!live.base) return noServer(live.why || '')
    r = await routePost($, live.base, which.path, call)
  }
  /* a spawn with no stdin hands the child an empty one */
  if (r && r !== 'dropped' && r.status === 200 && r.reply && r.reply.needStdin) r = await routePost($, live.base, which.path, { ...call, stdin: '' })
  if (r === 'dropped') return failedRun('the local server dropped the call')
  if (!r) return noServer('nobody answered at its address')
  if (r.status === 200) {
    return r.reply && Number.isInteger(r.reply.code) ? { exitCode: r.reply.code, stdout: String(r.reply.stdout || ''), stderr: String(r.reply.stderr || '') }
      : failedRun('the local server answered something that is not a CLI result')
  }
  if (r.status === 500) return failedRun('the local server failed the call (' + String((r.reply && r.reply.error) || 'no reason given') + ')')
  if (r.status === 409) return null
  return notRun('the local server refused the call (' + r.status + ': ' + String((r.reply && r.reply.error) || 'no reason given') + ')')
}

async function cli($: any, args: string[], stdin?: string): Promise<Run> {
  const argv = ['node', $.plugin.root + '/bin/askerdo.mjs', ...args]
  const r = await spawn($, argv, { timeoutMs: 60000, ...(stdin === undefined ? {} : { stdin }) })
  const out = String(r.stdout || '')
  const err = String(r.stderr || '').replace(/^AskerDo: /gm, '').trim()
  const run: Run = { ok: r.exitCode === 0, code: r.exitCode, out, err }
  if (run.ok && args.includes('--json')) {
    try { run.json = JSON.parse(out) } catch { run.ok = false; run.err = 'the CLI answered something that is not JSON' }
    /* the offline note: `staleNote` beside a verb's own `stale` field, else `stale` */
    const note = run.json && [run.json.staleNote, run.json.stale].find((s: any) => typeof s === 'string' && s.trim())
    if (note) run.stale = note.replace(/\s+/g, ' ').trim()
  }
  return run
}

const failed = (what: string, r: Run) => what + ' failed' + (r.err ? ': ' + r.err : ' (exit ' + r.code + ')')
/* a path the mod writes into text for the model or the user takes one kind of slash */
const rootPath = ($: any, rel: string) => String($.plugin.root).replace(/\\/g, '/').replace(/\/+$/, '') + '/' + rel
/* a command's text read from the offline cache leads with the cache's note */
const staleFirst = (text: string, ...runs: Run[]) => {
  const s = runs.find((r) => r && r.stale)
  return s ? s.stale + '\n' + text : text
}

async function sessionId($: any): Promise<string> {
  const id = await $.session.id()
  if (mem.id !== id) {
    const was = mem.id
    mem.id = id; mem.track = undefined; mem.trackKey = undefined
    /* a new id in one process (not a /clear, which settle moves) is the same row */
    if (id && !mem.clearedFrom) void rowCheck($, id, was).catch(() => {})
  }
  if (row.checking) await row.checking.catch(() => {})
  return id
}

/* ---- the app's row keeps its holds across a new id ------- */

/* host: the app's id for this session's row (CLAUDE_CODE_HOST_SESSION_ID), null in a terminal;
   sid, track, name, tasks: what this id holds, from its last band load; checked: the id whose
   move check ran; kept: the entry last written to $.store's rows */
const row: { host?: string | null; sid?: string; track?: string | null; name?: string; tasks?: string[]
  checked?: string; checking?: Promise<void>; kept?: string } = {}

async function hostId($: any): Promise<string | null> {
  if (row.host === undefined) {
    try { const v = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID'); row.host = typeof v === 'string' && v ? v : null } catch { row.host = null }
  }
  return row.host
}

/* The row's entry names another id: a new process takes its holds only once that id ended (a
   headless child shares the row's id while its parent runs); this process's own last id always. */
function rowCheck($: any, sid: string, before?: string): Promise<void> {
  if (row.checked === sid) return Promise.resolve()
  if (row.checking) return row.checking.then(() => rowCheck($, sid, before))
  row.checking = (async (): Promise<void> => {
    const host = await hostId($)
    let was: any = null
    if (host) { try { was = ((await $.store.get('rows')) || {})[host] || null } catch {} }
    if (was && typeof was.sid === 'string' && was.sid !== sid) {
      const tasks = (Array.isArray(was.tasks) ? was.tasks : []).filter((t: any) => /^T-\d+$/.test(String(t)))
      const why = was.sid === before ? 'a new id in this process' : was.ended ? 'a restart after the earlier id ended' : ''
      if (!why) {
        /* left unchecked, so the next prompt checks again once that id's end may have landed */
        debugLine($, 'AskerDo: the app row ' + host + ' names ' + was.sid + ', which has not ended, so ' + sid + ' took nothing of it yet')
        return
      }
      if (was.track || tasks.length) {
        /* only what the board still has under the old id moves, so nobody else's is taken */
        let track: string | null = null
        if (was.track) {
          const m = await cli($, ['track', 'mine', '--session', was.sid, '--json'])
          if (m.ok && m.json && m.json.held && m.json.track === was.track) track = was.track
        }
        const moved = await moveHolds($, was.sid, sid, track, tasks, why + ', app row ' + host)
        const note = rewoundNote({ track: moved.track, name: was.name, tasks: moved.tasks, cli: rootPath($, 'bin/askerdo.mjs') })
        if (note) { try { await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: note }] } }) } catch {} }
      }
    }
    row.checked = sid
  })().finally(() => { row.checking = undefined })
  return row.checking
}

/* A prompt under an id whose check was left open (the row's other id had not ended) checks again;
   a prompt that read a new id has just checked it. */
async function recheckRow($: any): Promise<void> {
  const was = mem.id
  const sid = await sessionId($)
  if (sid && sid === was && !mem.clearedFrom && row.checked !== sid) await rowCheck($, sid)
}

/* lines naming session ids go to the debug log, since the desktop app draws every
   transcript log line for the user */
function debugLine($: any, text: string): void {
  try { $.ui.log(text, { to: 'debug' }) } catch {}
}

/* The track (checked by the caller) and the tasks the board still has in hand with `from`
   move to `to`, one log line saying what moved. */
async function moveHolds($: any, from: string, to: string, track: string | null, tasks: string[], why: string): Promise<{ track: string | null; tasks: string[] }> {
  const out: { track: string | null; tasks: string[] } = { track: null, tasks: [] }
  if (track) {
    const r = await cli($, ['resume', track, '--take-over', '--session', to, '--json'])
    if (r.ok && r.json.acquired) {
      setTrack(r.json.track, r.json.key)
      await writeMarker($, to)
      out.track = r.json.track
    } else mem.track = undefined
  }
  for (const t of tasks) {
    const s = await cli($, ['show', t, '--json'])
    if (!s.ok || !s.json || s.json.inHand !== from) continue
    const r = await cli($, ['task', 'update', t, '--in-hand', '--take-over', '--session', to, '--json'])
    if (r.ok) out.tasks.push(t)
  }
  const what = [out.track, ...out.tasks].filter(Boolean)
  debugLine($, 'AskerDo: moved ' + (what.length ? what.join(', ') : 'nothing') + ' from ' + from + ' to ' + to + ' (' + why + ')')
  kick($)
  return out
}

/* After a band load: what this id holds, kept by the app's row once its move check ran. */
async function keepHolds($: any, sid: string): Promise<void> {
  if (mem.clearedFrom || row.checked !== sid || mem.id !== sid) return
  const track = mem.track || null
  const name = track && band.mine && band.mine.held && band.mine.track === track ? String(band.mine.name || '') : ''
  const tasks = (band.hand || []).map((t: any) => t && t.id).filter((id: any) => typeof id === 'string')
  const last = row.sid
  Object.assign(row, { sid, track, name, tasks })
  const host = await hostId($)
  if (!host) return
  const v = { sid, track, ...(name ? { name } : {}), tasks }
  const key = JSON.stringify(v)
  if (row.kept === key) return
  /* a second process on the row (a claude run from this shell) leaves a live id's entry alone */
  let was: any = null
  try { was = ((await $.store.get('rows')) || {})[host] || null } catch {}
  if (was && typeof was.sid === 'string' && !was.ended && was.sid !== sid && was.sid !== last) return
  row.kept = key
  await saveMarks($, host, v, 'rows')
}

/* An id that ends (not by /clear) marks the row's entry, so a restart under a new id may take it. */
async function endRow($: any, sid: string): Promise<void> {
  const host = await hostId($)
  if (!host || !sid) return
  const was = ((await $.store.get('rows')) || {})[host]
  if (!was || was.sid !== sid) return
  row.kept = undefined
  await saveMarks($, host, { ...was, ended: true }, 'rows')
}

async function projectDir($: any): Promise<string> {
  return mem.cwd || (mem.cwd = await $.session.cwd())
}

const sameDir = (a: string, b: string) => {
  const n = (d: string) => d.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return n(a) === n(b)
}

/* a desktop spare (~/.claude/spares/) is no project; its asks stay kept until it moves */
const isSpare = (dir: string) => /[\\/]\.claude[\\/]spares[\\/]/i.test(dir + '/')

/* the desktop's move (set_cwd, /cd) sets session.root, where the engine reads the
   project's settings from; a shell cd moves session.cwd alone, so the root is followed */
async function followFolder($: any): Promise<void> {
  let now: any
  try { now = await $.session.root() } catch { return }
  if (typeof now !== 'string' || !now || (mem.cwd && sameDir(now, mem.cwd))) return
  const moved = !!mem.cwd
  mem.cwd = now
  if (!moved) return
  /* the seam and the rules are keyed by the folder; these caches are dropped */
  procs.cards = undefined
  procs.scanned = false
  decs.rows = undefined
  feed.own = undefined
  /* the old project's scope too, so its Needs-you link goes with it */
  band.scope = undefined
  kick($)
  void readWhere($).catch(() => {})
}

/* the folder and branch the pane's title and the AskerDo button's card name; read at the
   session's start, each turn's start, a move and each pane open, never on a timer */
/* cols: the pane's width at its last draw, which the title fits */
const where: { now: Where | null; gen: number; paneRead?: boolean; cols?: number } = { now: null, gen: 0 }
/* an open sets the pane's manners anew, so a retitle repeats the last opener's Escape */
const paneKeys: { closeOnEscape?: true } = {}
const GIT_WHERE = ['git', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir', '--abbrev-ref', 'HEAD']

async function readWhere($: any): Promise<void> {
  const gen = ++where.gen
  let root: any
  try { root = await $.session.root() } catch {}
  if (typeof root !== 'string' || !root) root = mem.cwd
  if (!root) return
  const git = async (argv: string[]) => { try { return await $.process.run(argv, { cwd: root, timeoutMs: 10000 }) } catch { return null } }
  const r = await git(GIT_WHERE)
  const lines = r ? String(r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []
  let branch: string | null = null, worktree = false
  if (lines.length >= 3) {
    /* a linked worktree's git dir is its own, under the main tree's common one */
    worktree = !sameDir(lines[1], lines[2])
    branch = lines[3] && lines[3] !== 'HEAD' && r.exitCode === 0 ? lines[3] : null
    /* a detached head shows its short hash; an unborn branch (no commit yet) its name */
    const alt = branch ? null : await git(r.exitCode === 0 ? ['git', 'rev-parse', '--short', 'HEAD'] : ['git', 'symbolic-ref', '--short', 'HEAD'])
    if (alt && alt.exitCode === 0) branch = String(alt.stdout || '').trim() || null
  }
  if (gen !== where.gen) return
  const next: Where = { root, worktree, branch }
  const was = where.now
  where.now = next
  if (!was || was.root !== next.root || was.branch !== next.branch || !!was.worktree !== worktree) {
    qpaneRedraw($)
    await retitle($)
  }
}

/* an open pane takes the new title; never with focus, and never an open of a closed pane
   (an open of an open id moves no tab and no keyboard: J1s in the 2.1.309 engine) */
async function retitle($: any): Promise<void> {
  const title = paneTitle(where.now, where.cols)
  let ps: any
  try { ps = await $.ui.panes() } catch { return }
  const p = Array.isArray(ps) ? ps.find((x: any) => x && x.id === PANE_ID) : null
  if (!p || p.title === title) return
  try { await $.ui.open({ id: PANE_ID, title, ...paneKeys }) } catch {}
}

/* lost, a track another session took over, told at this session's next prompt; gone, one this session lets go itself, which the board can release before the write answers */
const lease: { lost?: string; gone?: string } = {}

/* the mod's own move onto a track (or off one, null) */
function setTrack(id: string | null, key?: string | null): void {
  mem.gen++
  mem.track = id
  mem.trackKey = id ? key || null : null
  mem.trackErr = undefined
  if (id && id === lease.gone) lease.gone = undefined
}

/* from before the write until the cache shows it let go, no read tells it lost or sets it back */
function lettingGo(track: string | null | undefined): void {
  if (track) lease.gone = track
}

/* the board did not take the let-go, so the track is held as before */
function keptHold(track: string | null | undefined): void {
  if (track && lease.gone === track) lease.gone = undefined
}

/* The session holding a track on the board, from `track mine`'s workstream rows when listed, else
   its own read; null for nobody or a read that failed. */
async function holderNow($: any, track: string, mine: any): Promise<string | null> {
  const row = (mine.tracks || []).find((t: any) => t && t.id === track)
  if (row) return (row.holder && row.holder.session) || null
  const r = await cli($, ['track', 'show', track, '--json'])
  return r.ok && r.json && r.json.holder ? r.json.holder.session || null : null
}

/* `track mine`: the lease renewed, the held track and its workstream's tracks (the pane's
   read too). A read that a move of the mod's own overtook changes nothing. */
async function readMine($: any, sid: string): Promise<Run> {
  const gen = mem.gen
  const r = await cli($, ['track', 'mine', '--session', sid, '--json'])
  if (mem.id !== sid || gen !== mem.gen) return r
  if (!r.ok) {
    mem.trackErr = r.err
    if (mem.track === undefined) mem.track = null
    return r
  }
  const now = r.json.held ? r.json.track : null
  const was = mem.track
  /* a track left through the CLI (finish, park, another resume, track new) moves off
     silently; only another session holding it now is a take-over */
  if (was && was !== now && was !== lease.gone) {
    const by = await holderNow($, was, r.json)
    if (mem.id !== sid || gen !== mem.gen) return r
    if (by && by !== sid && mem.track === was) lease.lost = was
  }
  /* held on the board after the let-go was applied: taken again, as by a resume through the CLI */
  if (now && now === lease.gone && mem.track !== now) lease.gone = undefined
  mem.track = now
  mem.trackKey = r.json.held ? r.json.key : null
  mem.trackErr = undefined
  band.mine = r.json
  return r
}

/* The track this session holds, read from the board once per session id. A path that
   refuses or resolves on it (recheck) reads again while none is held: a CLI resume or
   track new is the board's alone. */
async function boundTrack($: any, sid?: string, recheck = false): Promise<string | null> {
  const id = sid || (await sessionId($))
  if (mem.id === id && mem.track !== undefined && !(recheck && mem.track === null)) return mem.track
  const r = await readMine($, id)
  return r.ok && r.json.held ? r.json.track : null
}

/* No track held, or a board that could not be read, in plain words. */
const needTrack = () => (mem.trackErr ? 'The board could not be read (' + mem.trackErr + '), so this session holds no track it can see.' : NEEDS_TRACK)

/* ---- the agent guard's opt-in and marker ------- */

/* state: undefined until read; track: the track key it was read for */
const guard: { state?: any; track?: string | null; mark?: string; profilesAt?: number } = {}

async function markerRun($: any, sid: string, trackKey: string | null | undefined, extra: string[]): Promise<void> {
  try {
    const argv = ['node', $.plugin.root + '/scripts/depth-marker.mjs', '--cwd', await projectDir($), '--session', sid]
    if (trackKey) argv.push('--track', trackKey)
    const r = await spawn($, [...argv, ...extra, '--json'], { timeoutMs: 15000 })
    if (r.exitCode !== 0) return
    const before = JSON.stringify(guardChip(guard.state))
    guard.state = guardOf(JSON.parse(String(r.stdout || '')))
    guard.track = trackKey || null
    if (JSON.stringify(guardChip(guard.state)) !== before) { try { $.ui.invalidate('ui.render') } catch {} }
  } catch {}
}

/* where the session is opted in, its track gets the marker, so the next
   session on the track is guarded too; nowhere else is anything written. */
async function writeMarker($: any, sid: string, trackKey?: string | null): Promise<void> {
  await markerRun($, sid, trackKey === undefined ? mem.trackKey : trackKey, ['--write'])
}

/* /clear goes on under a new id with no session.start, so the binding moves
 * at the first moment the new id is readable. */
async function settle($: any): Promise<void> {
  if (!mem.clearedFrom) return
  if (mem.settling) return mem.settling
  mem.settling = (async () => {
    const from = mem.clearedFrom as string
    const to = await $.session.id()
    if (!to || to === from) return
    mem.clearedFrom = undefined
    if (!mem.lineage.includes(from)) mem.lineage.push(from)
    const track = mem.id === from && mem.track !== undefined ? mem.track : await boundTrack($, from)
    /* the tasks the old id had in hand at its last load go too */
    const tasks = row.sid === from ? row.tasks || [] : []
    mem.id = to
    setTrack(null)
    /* queued answers move to the new id, as the lineage write drops the old one's */
    if (answerQueue.items.size) void queueSave($).catch(() => {})
    marks.told = undefined
    marks.percent = undefined
    marks.line = ''
    await registerAll($)
    /* the old id still holds the lease, so the new one takes it over */
    if (track || tasks.length) await moveHolds($, from, to, track, tasks, '/clear')
    else kick($)
    row.checked = to
  })()
  try { await mem.settling } finally { mem.settling = undefined }
}

const askSchema = (n: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['name', 'ask', 'gist', 'blocking'],
  properties: {
    name: { type: 'string', description: 'A short one-line hook for the question' },
    ask: { type: 'string', description: 'The question as ' + n + ' reads it on the card: one plain question ending in "?" that names the options inline by letter with the pick marked ("(a, my pick)", "(b)"); never the answer tokens' },
    gist: { type: 'string', description: 'Why the question came up, as short lines, one fact each: a bold lead then the fact; never the ask again, never a paragraph' },
    blocking: { type: 'boolean', description: 'true when work stops until ' + n + ' answers' },
    options: {
      type: 'array',
      description: 'The choices, each lettered a to z (unique); ' + n + ' answers with the question number and the letter',
      items: {
        type: 'object',
        required: ['type', 'option'],
        properties: {
          type: { type: 'string', description: 'One lowercase letter' },
          option: { type: 'string' },
          getsYou: { type: 'string', description: 'What happens: the second column of the row' },
          costsYou: { type: 'string', description: 'The catch; may be empty, "one-way" when hard to undo' },
          headline: { type: 'string', description: 'Optional: one plain sentence that does not restate the row' },
          whyPick: { type: 'string', description: 'Optional: why pick it' },
          whyNot: { type: 'string', description: 'Optional: why not' },
          undo: { type: 'string', description: 'Optional: how hard to undo ("easy", "painful" or "one-way" plus a few words)' },
        },
      },
    },
    pick: { type: ['string', 'null'], description: 'The letter you recommend; null when you recommend none on purpose. Required with lettered options.' },
    crux: { type: 'string', description: 'Optional: one line, the fact that decides it' },
    workstream: { type: 'string', description: 'WS-n; left out, the workstream of the track this session holds, else inherited from the session' },
    track: { type: 'string', description: 'TR-n: the track the question belongs to' },
    gates: { type: 'array', items: { type: 'string' }, description: 'T-n ids of the tasks this question gates' },
    revisits: { type: 'array', items: { type: 'string' }, description: 'Q-n ids of the answered questions (rulings) this one reopens; needs reversal; stored blocking, told alone in its reply (one told beside another ask is flagged on both cards)' },
    cites: { type: 'array', items: { type: 'string' }, description: 'Q-n ids of answered questions this one only mentions' },
    reversal: { type: 'string', description: 'With revisits: what changed since the ruling, short lines; the hub quotes the ruling and the costs ' + n + ' turned down' },
    stakes: { type: 'string', description: 'Short lines, one fact each, a bold lead then the fact' }, whileThisWaits: { type: 'string' }, context: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } }, topic: { type: 'string' },
    edits: { type: 'string', description: 'Q-n, or the L-n of a kept question: reword this open, unanswered question in place, keeping its id, instead of asking a new one; send the whole reworded question, then paste the reworded block the result hands back in this reply' },
  },
})

/* a repo's verify-first entry, as handoff_write takes it and handoff_update refreshes it */
const VERIFY_ENTRY = {
  path: { type: 'string', description: 'The repo, absolute' }, branch: { type: 'string' }, worktree: { type: 'string' },
  commit: { type: 'string' }, expectedDirty: { type: 'array', items: { type: 'string' } },
  ownedByOthers: { type: 'array', items: { type: 'string' } },
  files: {
    type: 'array',
    items: {
      type: 'object', required: ['path', 'disposition'],
      properties: {
        path: { type: 'string', description: 'Relative to the repo' },
        disposition: { type: 'string', enum: ['commit', 'ignore', 'delete', 'keep', 'undecided'] },
        reason: { type: 'string' }, review: { type: 'string', description: 'YYYY-MM-DD; default 7 days on' },
        suggest: { type: 'string', enum: ['commit', 'ignore', 'delete'] }, note: { type: 'string' },
      },
    },
  },
}

/* the tools' words name the configured user, n */
const toolsFor = (n: string) => [
  {
    name: 'ask',
    description: 'Register a question for ' + n + ' on the AskerDo board, at ask time, before telling it in the reply. '
      + 'The session and project are filled in; the workstream, left out, is that of the track this session holds. '
      + 'Answers with the question id, its answer tokens (106a, 106b) and the block to paste in the reply, exactly, once: the question\'s header line, then its reversal line, question line, crux and table. '
      + 'The ask names the options by letter, since the number comes at registration; model asks: '
      + '"When a session is working down a track, where do you want to see which task it\'s on? On the status line next to the track (a, my pick), '
      + 'as a row in the band above the prompt (b), or nowhere on screen, only in the kickoff and the Tracks tab (c)?" and '
      + '"Before the release, should the next step build just the size report at each handoff (a, my pick), all three drift checks '
      + 'from the design notes (b), or nothing until after the release (c)?" '
      + 'A question that reopens an answered one names it in revisits with a reversal and is told alone in its reply, its ask leading with Reversal of Q-n; one that only mentions an answered question lists it in cites. '
      + 'A subagent never calls it: its question goes to the session that dispatched it. '
      + 'In a session that has not used AskerDo, the question stays with the session under a local label (L1, answered L1a) and is filed on the board only if the session uses AskerDo.',
    inputSchema: askSchema(n),
  },
  {
    name: 'override_request',
    description: 'Ask ' + n + ' to override a record already in use, the one way to change it beyond an amend: fix (text a bug or an import wrote), '
      + 'withdraw (a ruling ' + n + ' never made) or scrub (a secret or personal detail); never for wording, scope or a change of mind (amend or supersede those). '
      + 'The session decides whether its change qualifies; a subagent never calls it and reports to its session instead. '
      + 'One record with its corrected fields, or a batch as items (records that are not rulings). '
      + 'Answers with the block to put in the reply as written, which ' + n + ' answers with Allow or Keep on the card under it; a fix or withdraw of a ruling is a reversal, told alone.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['kind', 'summary', 'reason'],
      properties: {
        kind: { type: 'string', enum: ['fix', 'withdraw', 'scrub'] },
        record: { type: 'string', description: 'T-n or K-n: the one record; or items for a batch' },
        summary: { type: 'string', description: 'What ' + n + ' decides, at most 200 characters; never the text a scrub removes' },
        reason: { type: 'string', description: 'Why it qualifies: the bug that wrote the text, the ruling never made, or the secret' },
        name: { type: 'string', description: 'fix: the corrected name' },
        description: { type: 'string', description: "fix: a task's corrected Description" },
        intent: { type: 'string', description: "fix: a task's corrected Intent" },
        close: { type: 'string', description: "fix: a task's close, as task edit --close takes it" },
        body: { type: 'string', description: "fix: a knowledge record's corrected Body" },
        words: { type: 'string', description: "fix: a decision's corrected quoted words" },
        text: { type: 'string', description: 'scrub: the exact text to remove' },
        items: {
          type: 'array', description: 'A batch: each record with its own fields as above',
          items: { type: 'object', required: ['record'], properties: {
            record: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, intent: { type: 'string' },
            close: { type: 'string' }, body: { type: 'string' }, words: { type: 'string' }, text: { type: 'string' } } },
        },
      },
    },
  },
  {
    name: 'note',
    description: 'Append a stamped paragraph to a record\'s journal (a question, workstream, plan, task, track or knowledge record).',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id', 'body'],
      properties: { id: { type: 'string', description: 'Q-n, WS-n, P-n, T-n, TR-n or K-n' }, body: { type: 'string' } },
    },
  },
  {
    name: 'answer',
    description: 'Record an answer ' + n + ' typed in chat, at once: id is the question (a board Q-n, or a label this session keeps, L1), '
      + 'pick the option letter, note ' + n + '\'s other words (a note alone is the answer). Each token typed is its own call: "L1a L2b" is two answers. '
      + 'A decline is drop, with ' + n + '\'s reason as the note. An answer ' + n + ' gave on the band, a card or /askerdo is recorded already; never record it again.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: {
        id: { type: 'string', description: 'Q-n, or L-n for a question this session keeps' },
        pick: { type: 'string', description: 'The option letter (b for 106b)' },
        note: { type: 'string', description: n + '\'s other words, or the answer itself when no letter fits' },
        drop: { type: 'boolean', description: 'true: ' + n + ' declined it; no pick' },
      },
    },
  },
  {
    name: 'decide',
    description: 'Record a ruling ' + n + ' made in chat, in the same turn: the ruling as the title, ' + n + '\'s words quoted, and what it governs '
      + '(tasks, files, commands). Left out, the track and workstream are the ones this session holds and the project is this one. '
      + 'One that replaces an earlier decision names it in supersedes. Sessions holding its tasks or track are told, an edit or command '
      + 'it governs gets a pointer to it, and the next leg\'s kickoff lists it.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['title'],
      properties: {
        title: { type: 'string', description: 'The ruling, one line' },
        words: { type: 'string', description: n + '\'s words, quoted' },
        body: { type: 'string', description: 'Optional: what it settles and why' },
        tasks: { type: 'array', items: { type: 'string' }, description: 'T-n ids of the tasks it governs' },
        tracks: { type: 'array', items: { type: 'string' }, description: 'TR-n ids; with tracks and workstreams left out, the track this session holds' },
        workstreams: { type: 'array', items: { type: 'string' }, description: 'WS-n ids' },
        files: { type: 'array', items: { type: 'string' }, description: 'Globs relative to the repo (lib/builder.js, docs/**/*.md) whose edits it governs' },
        commands: { type: 'array', items: { type: 'string' }, description: 'Command fragments it governs (npm publish, or a script\'s name)' },
        question: { type: 'string', description: 'Q-n: the question it answers' },
        supersedes: { type: 'array', items: { type: 'string' }, description: 'K-n ids of the decisions it replaces' },
        labels: { type: 'array', items: { type: 'string' } },
        global: { type: 'boolean', description: 'true: it holds in every project' },
      },
    },
  },
  {
    name: 'task_update',
    description: 'Change a task on the board: status, priority, name or labels, take it in hand for this session or let it go, '
      + 'and optionally add a journal note in the same call. Starting a task (in_progress, or agent) goes by the track\'s order: '
      + 'a task that is not ready yet needs a reason, or the edge that is wrong removed. '
      + 'When a dispatched agent works it, give agent, the job name the dispatch carries, so the track\'s now set shows who runs it.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: {
        id: { type: 'string', description: 'T-n' },
        status: { type: 'string', enum: ['open', 'in_progress', 'dropped', 'completed'] },
        agent: { type: 'string', description: 'The job name of the agent working it (the dispatch\'s name); starts it' },
        reason: { type: 'string', description: 'Why it starts before it is ready, or why it is dropped' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        name: { type: 'string' },
        addLabels: { type: 'array', items: { type: 'string' } },
        removeLabels: { type: 'array', items: { type: 'string' } },
        inHand: { type: 'boolean', description: 'true: this session takes it in hand (a session may hold several); false: let it go' },
        takeOver: { type: 'boolean', description: 'with inHand true: take it from the session that holds it, which is told; only after ' + n + ' says so, or from this session\'s own earlier id after a rewind' },
        note: { type: 'string', description: 'A journal paragraph to add' },
      },
    },
  },
  {
    name: 'handoff_write',
    description: 'Write the next handoff of the track this session holds (or the track named; with none held, name a workstream and a track named from the focus is started there). '
      + STOP_FIRST + ' Then: focus one line of at most 400 characters, '
      + 'state at most 10 KB with no line over 400 characters, whereWeWere at most 4 KB in your own words (where the conversation with ' + n + ' stood), '
      + 'rulings: only those ' + n + ' made in chat that decide could not record, '
      + 'and verifyFirst with one entry per repo, '
      + 'its files list giving each untracked file commit, ignore, delete, keep (with a reason) or undecided. '
      + 'The depth at handoff and the depth-guard marker are filled in; the track\'s tasks carry where it stands, so the state never retells the list, '
      + 'and the steps left go in leftovers, never as a Next list in the state. '
      + 'The track\'s lease goes with the handoff, and the result ends with the resume block to close the reply with. '
      + 'If a later turn changes state after it (a board or repo write, a ruling, an ask, an agent or a stopped process), keep it current with handoff_update before that turn ends; never write it again for that. '
      + 'Open from the depth meter\'s handoff window, '
      + 'or below it once ' + n + ' asks: through /askerdo handoff or park, or in chat, which askedInChat carries; otherwise refused.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['focus', 'state', 'verifyFirst'],
      properties: {
        track: { type: 'string', description: 'TR-n; left out, the track this session holds' },
        workstream: { type: 'string', description: 'WS-n: with no track held or named, a track named from the focus is started here' },
        askedInChat: { type: 'string', description: 'When ' + n + ' asked for this handoff in chat: ' + n + "'s words, quoted, one line; it opens a handoff below the window and leads whereWeWere" },
        focus: { type: 'string' },
        state: { type: 'string' },
        whereWeWere: { type: 'string', description: 'In your own words: ' + n + '\'s last exchange in their words, what was mid-thought, what was tried and dropped and what not to repeat, preferences learned this sitting' },
        rulings: {
          type: 'array',
          description: 'Rulings ' + n + ' made in chat that decide could not record (record the rest with decide first), one line each; the kickoff carries them (R1, R2) until one comes back as { id, registered } with the Q id or decisions row that registered it',
          items: {
            anyOf: [
              { type: 'string' },
              { type: 'object', additionalProperties: false, required: ['registered'],
                properties: { id: { type: 'string', description: 'Rn: a carried ruling' }, text: { type: 'string', description: 'a new ruling registered at once' }, registered: { type: 'string' } } },
            ],
          },
        },
        verifyFirst: { type: 'array', items: { type: 'object', required: ['path'], properties: VERIFY_ENTRY } },
        waitingOnUser: { type: 'array', items: { type: 'string' } },
        leftovers: {
          type: 'array',
          description: 'The steps left, in order: each becomes a task on the track (a name matching an open task there is that task), waits on its after, and is waited on by its before, '
            + 'so the next session takes the next step from the ready set. The state carries the thinking and never orders work. '
            + 'A leftover you cannot place (is it work at all, which track) goes to ' + n + ' as a question through ask, named in waitingOnUser',
          items: {
            type: 'object', additionalProperties: false, required: ['runBy'],
            properties: {
              runBy: { type: 'string', description: 'Who runs the step, which the kickoff prints: orchestrator (the session itself, for what needs its judgment), '
                + 'fork (a fork of the session on the session model, which writes the briefs), or agent:<model> (agent:opus, agent:sonnet: mechanical work such as data-file edits and filing records goes to an agent)' },
              name: { type: 'string', description: 'The step, one line' },
              task: { type: 'string', description: 'T-n: an existing task, moved onto the track' },
              after: { type: 'array', description: 'What it waits on: T-n ids, or the number of an earlier step here (1 first)', items: { anyOf: [{ type: 'string' }, { type: 'integer' }] } },
              before: { type: 'array', description: 'What waits on it: T-n ids alone (a later step here names this one in its own after)', items: { type: 'string' } },
              description: { type: 'string' },
              priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            },
          },
        },
        status: { type: 'string', enum: ['waiting', 'parked'] },
        parkReason: { type: 'string' },
      },
    },
  },
  {
    name: 'handoff_update',
    description: 'Patch the handoff this session wrote, in place, while it waits or is parked: it keeps its id (TR-n.m) and its depth. '
      + 'When a turn changes state after its handoff, patch it before that turn ends with what the next leg needs; a turn that only answered or read needs no patch. '
      + 'ops, applied in order: state replaces the section under its "## " heading, or appends it when new (the steps left stay tasks on the track, never a Next list); '
      + 'whereWeWere adds one line; waitingOnUser adds or drops one line of what waits on ' + n + '; verifyFirst snapshots one repo again as the write does. '
      + 'The write\'s budgets and prose order apply to the patched text. '
      + 'Once the track is resumed the update is refused, naming the session holding it: put what changed in a note on the track (note, id TR-n), which reaches that session at its next prompt.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['ops'],
      properties: {
        track: { type: 'string', description: 'TR-n or TR-n.m; left out, the track this session holds, else the one it last wrote a handoff for' },
        ops: {
          type: 'array',
          items: {
            anyOf: [
              { type: 'object', additionalProperties: false, required: ['op', 'heading', 'text'], properties: {
                op: { type: 'string', enum: ['state'] }, heading: { type: 'string', description: 'The section\'s heading, one line starting "## "' },
                text: { type: 'string', description: 'The section\'s body under its heading, with no "## " line in it' } } },
              { type: 'object', additionalProperties: false, required: ['op', 'line'], properties: {
                op: { type: 'string', enum: ['whereWeWere'] }, line: { type: 'string', description: 'One line in your own words, added to whereWeWere' } } },
              { type: 'object', additionalProperties: false, required: ['op'], properties: {
                op: { type: 'string', enum: ['waitingOnUser'] }, add: { type: 'string', description: 'One line to add' },
                drop: { type: 'string', description: 'A line already there, as written, to drop' } } },
              { type: 'object', additionalProperties: false, required: ['op', 'path'], properties: { op: { type: 'string', enum: ['verifyFirst'] }, ...VERIFY_ENTRY } },
            ],
          },
        },
      },
    },
  },
  {
    name: 'depth',
    description: 'Read this session\'s context depth as the band\'s C ring shows it: the whole percent, the tokens and the window, '
      + 'and ' + n + '\'s two marks (the handoff window and the wrap line), which were told this session and whether a profile set them. Reads only.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
]

async function registerAll($: any): Promise<void> {
  /* one global name, so nothing new can collide with it later */
  try { await $.command.register({ name: 'askerdo', description: COMMAND_DESCRIPTION, argumentHint: COMMAND_HINT }) } catch {}
  const n = await userName($)
  for (const t of toolsFor(n)) { try { await $.tool.register({ ...t, isDeferred: false }) } catch {} }
  await registerAlias($).catch(() => {})
}

/* ---- the personal alias ----------------------------------------- */

/* name: the alias this module answers ('' for none); told: the last refusal
   reported, so each is said once */
const alias: { name?: string; loading?: Promise<string>; told?: string } = {}

/* The saved config lives where node-helpers resolves it; the mod has no fs of its own there. */
async function readAlias($: any): Promise<{ alias: string; error?: string }> {
  const r = await spawn($, ['node', $.plugin.root + '/scripts/mod-alias.mjs', '--json'], { timeoutMs: 15000 })
  let j: any = null
  try { j = JSON.parse(String(r.stdout || '')) } catch {}
  if (r.exitCode !== 0 || !j) return { alias: '', error: 'the saved options could not be read' }
  /* the cards' press setting rides the same read */
  pressesFrom(j.presses)
  return j.error ? { alias: '', error: j.error } : { alias: String(j.alias || '') }
}

function refuseAlias($: any, name: string, reason: string): void {
  const text = PLUGIN + ': the alias ' + (name ? '/' + name : 'in your saved options') + ' was not registered: ' + reason
    + '. /' + COMMAND + ' still works; pick another alias with /askerdo:configure.'
  if (alias.told === text) return
  alias.told = text
  toast($, text, 'ambient', 10000)
  try { $.ui.log(text) } catch {}
}

const holderOf = (c: any) => c.source === 'builtin' ? 'a built-in command'
  : c.source === 'plugin' ? (c.plugin ? 'the ' + c.plugin + ' plugin' : 'another plugin')
  : c.source === 'user' ? 'one of your own commands' : 'an MCP prompt'

async function registerAlias($: any): Promise<void> {
  const r = await readAlias($)
  alias.name = ''
  if (r.error) return refuseAlias($, '', r.error)
  const name = r.alias
  if (!name || name === COMMAND) return
  /* registering a name another plugin holds would take it over silently */
  let list: any[] = []
  try { list = await $.command.list() } catch {}
  const held = list.find((c: any) => c.name === name && !(c.source === 'plugin' && c.plugin === $.plugin.name))
  if (held) return refuseAlias($, name, 'the name belongs to ' + holderOf(held))
  try {
    const done = await $.command.register({ name, description: COMMAND_DESCRIPTION + ' (your alias for /' + COMMAND + ')', argumentHint: COMMAND_HINT })
    if (done && done.command && done.command !== name) return refuseAlias($, name, 'it was registered as /' + done.command)
    alias.name = name
  } catch (err: any) {
    refuseAlias($, name, String((err && err.message) || err || 'refused').replace(/^[\s\S]*?\$\.command\.register:\s*/, ''))
  }
}

/* A hot reload loses the memory: read the name back once, without registering,
   and answer it only where the command list shows this plugin holding it. */
async function reloadedAlias($: any): Promise<string> {
  const r = await readAlias($)
  if (r.error || !r.alias) return ''
  let list: any[] = []
  try { list = await $.command.list() } catch {}
  return list.some((c: any) => c.name === r.alias && c.source === 'plugin' && c.plugin === $.plugin.name) ? r.alias : ''
}

function aliasName($: any): Promise<string> {
  if (alias.name !== undefined) return Promise.resolve(alias.name)
  if (!alias.loading) {
    alias.loading = reloadedAlias($).then((n) => (alias.name === undefined ? (alias.name = n) : alias.name))
      .catch(() => (alias.name = ''))
      .finally(() => { alias.loading = undefined })
  }
  return alias.loading
}

/* ---- the Needs-you band and toasts ---------------------- */

/* a plugin's newer toast takes its own seat, so a press's answer shows at once and
   holds its time, and a toast nobody pressed for waits its turn; one a press cuts shows again */
type Toast = { text: string; ms: number; press: boolean; key?: string; shown?: () => void }
const TOAST_MS = 4000
const toasts: { on?: Toast; timer?: any; queue: Toast[] } = { queue: [] }

function showToast($: any, t: Toast): void {
  toasts.on = t
  try { $.ui.toast(t.text, t.ms === TOAST_MS ? undefined : { timeoutMs: t.ms }) } catch {}
  /* once, so a toast a press cut and shows again sends nothing twice */
  const shown = t.shown
  t.shown = undefined
  if (shown) { try { shown() } catch {} }
  try { toasts.timer = $.clock.after(t.ms, () => { toasts.timer = undefined; toasts.on = undefined; nextToast($) }) } catch { toasts.on = undefined }
}

function nextToast($: any): void {
  const t = toasts.queue.shift()
  if (t) showToast($, t)
}

/* a keyed ambient toast replaces the queued one with its key, so a burst queues one */
function toast($: any, text: string, kind: 'press' | 'ambient', timeoutMs = TOAST_MS, more: { key?: string; shown?: () => void } = {}): void {
  const t: Toast = { text, ms: timeoutMs, press: kind === 'press', ...more }
  if (!t.press) {
    const at = t.key ? toasts.queue.findIndex((q) => q.key === t.key) : -1
    if (at >= 0) toasts.queue[at] = t
    else toasts.queue.push(t)
    if (!toasts.on) nextToast($)
    return
  }
  const cut = toasts.on
  if (toasts.timer) { try { toasts.timer.cancel() } catch {} }
  toasts.timer = undefined
  if (cut && !cut.press) toasts.queue.unshift(cut)
  showToast($, t)
}

/* Module memory like the rest: a hot reload starts it over and the next load
   reads it all back from the local band. */
const band: {
  model?: any; loaded?: boolean; marker?: string; url?: string; seen?: Set<string>; own?: string
  /* the local server's address; `url` the open set's link, through its sign-in path;
     scope: the project's shared and short names as the board files them */
  local?: string; scope?: { repo?: string; name?: string }
  /* the pane's board link on Home and Tracks (the board's overview) */
  views?: { home?: string; tracks?: string }
  loading?: Promise<void>; again?: boolean; timer?: any
  /* the pane draws from the same reads: no second poll. mine: `track mine` */
  mine?: any; shelf?: any[]
  /* the session's tasks in hand, newest first, for the status line */
  hand?: any[]
  /* the Questions pane's cards: the band's questions as read; at: when they were read */
  questions?: any[]; more?: number; at?: number
  /* what waits in the inbox, and the options of the questions it answers */
  inbox?: any; options: Record<string, any[]>
  /* the open questions this session does not own and their counts, for the mark */
  elsewhere?: { questions: any[]; blocking: number; waiting: number }
  /* the local board's band (its `track` the held track's numbers) and the held
     track's workstream graph `{ workstream, view, layout }`, null where none answers;
     drew: the last redraw's wall time in ms, sent with the next band read for the timings */
  near?: any; graph?: any; drew?: number
  /* the answer keys already toasted, read from $.store once */
  heard?: Set<string>
} = { options: {} }

/* The local route's base: local.json's, else the address the band last carried. */
async function localBase($: any): Promise<string> {
  const b = await routeBase($, await callerEnv($, await seamEnv($))).catch(() => '')
  if (b) return slashed(b)
  const carried = localUrl(band.local, '') || ''
  return carried && route.down && route.down.base === carried ? '' : carried
}

/* a read of the local route on the board server the band carries; null when no
   local board answers (no address, a failure, a refusal or no result). */
async function localGet($: any, path: string): Promise<any> {
  const base = await localBase($)
  if (!base) return null
  const r = await routeFetch($, base, String(path).replace(/^[/]+/, ''), { method: 'GET' })
  try {
    if (!r || r === 'dropped' || !r.ok) return null
    const j = JSON.parse(r.text)
    return j && j.ok === true && j.result != null ? j.result : null
  } catch {
    return null
  }
}

/* the session's ids before a /clear, whose inboxes the band peeks too */
const oldIds = (sid: string) => mem.lineage.filter((x) => x !== sid)

const bandPath = (sid: string, cwd: string, drew?: number) => 'band?session=' + encodeURIComponent(sid) + '&project=' + encodeURIComponent(cwd)
  + (oldIds(sid).length ? '&lineage=' + encodeURIComponent(oldIds(sid).join(',')) : '') + (drew ? '&redraw=' + drew : '')

/* the local board's band; with no local server answering, it is started once as the
   route does, and read again. null with the words the band's offline line says. */
async function readBand($: any, sid: string, cwd: string, drew?: number): Promise<{ near: any; why: string }> {
  for (const again of [false, true]) {
    let base = await localBase($)
    if (!base) {
      const over = await seamEnv($)
      const live = await liveBase($, await callerEnv($, over), over)
      if (!live.base) return { near: null, why: 'local server not running: ' + live.why }
      base = slashed(live.base)
    }
    const r = await routeFetch($, base, bandPath(sid, cwd, drew), { method: 'GET' })
    /* nobody listened at the address it named: started once, then read again */
    if (!r && !again) continue
    let j: any = null
    try { j = r && r !== 'dropped' ? JSON.parse(r.text) : null } catch {}
    if (j && j.ok === true && j.result && Array.isArray(j.result.questions)) return { near: j.result, why: '' }
    return { near: null, why: String((j && j.error) || 'the local server did not answer the band').replace(/\s+/g, ' ').trim() }
  }
  return { near: null, why: 'local server not running' }
}

/* What one load read from the local board's band. */
type Read = { found: any; rows: any[]; open: Set<string>; edited: boolean }

/* the project's needs-you page by the shared name the board files it under */
const needsYouAt = (root: string) => root + 'needs-you?repo=' + encodeURIComponent(String(band.scope?.repo || ''))

/* The held track as the band read it. It differs from the mod's own after a move the cache has
   not caught yet or a take-over elsewhere, and then `track mine` settles it on the board. */
async function nearMine($: any, sid: string, near: any, gen: number): Promise<any> {
  const m = mineOf(near)
  const now = m.held ? m.track : null
  /* the cache caught up with this session's own let-go; until then the board settles it */
  if (lease.gone && now !== lease.gone && mem.track !== lease.gone) lease.gone = undefined
  const back = now !== null && now === lease.gone && mem.track !== now
  if (!back && mem.id === sid && gen === mem.gen && (mem.track === undefined || mem.track === now)) {
    mem.track = now
    mem.trackKey = m.held ? m.key : null
    mem.trackErr = undefined
    band.mine = m
    return m
  }
  const r = await readMine($, sid)
  return r.ok ? r.json : null
}

/* the local board's band answers the model, the questions, the shelf, the counts and the
   held track in one call; `gen` is the mod's move count when the read began. */
async function fromNear($: any, sid: string, cwd: string, near: any, gen: number): Promise<Read> {
  const mine = await nearMine($, sid, near, gen)
  const found = mine && mine.held ? mine : null
  const qs: any[] = near.questions
  band.model = near.model
  const ids = new Set(qs.map((q: any) => q.id))
  /* a press still saving keeps its look whatever the read says */
  for (const k of Object.keys(answers.chips)) if (!ids.has(k.split('|')[0]) && !isLocalId(k.split('|')[0]) && answers.chips[k].state !== 'pending') delete answers.chips[k]
  qpane.answering = answeringOf(answers.chips)
  band.questions = qs
  /* a pressed call stays hidden until a read no longer lists it */
  const listed = new Set(((near.model && near.model.calls) || []).map((c: any) => c.key))
  for (const [k, v] of callPresses) if (v === 'done' && !listed.has(k)) callPresses.delete(k)
  band.more = 0
  band.at = Date.now()
  const rows = Array.isArray(near.shelf) ? near.shelf.filter((r: any) => r && r.track) : []
  band.shelf = rows
  band.hand = Array.isArray(near.hand) ? near.hand : []
  void keepHolds($, sid).catch(() => {})
  const links = near.links || {}
  const signed = signedRoot(links.local)
  if (near.scope && near.scope.repo) band.scope = near.scope
  band.url = signed ? (band.scope ? needsYouAt(signed) : signed) : links.needsYou || links.overview || band.url
  band.local = links.local || band.local
  band.views = { home: signed || links.overview || band.views?.home, tracks: signed || links.overview || band.views?.tracks }
  if (near.elsewhere) band.elsewhere = near.elsewhere
  band.marker = 'seq:' + near.seq
  /* a profile edit anywhere is read again at the next load */
  const edited = guard.profilesAt !== undefined && guard.profilesAt !== near.profilesAt
  guard.profilesAt = near.profilesAt
  return { found, rows, open: new Set(qs.flatMap((q: any) => [q.key, q.id]).filter(Boolean)), edited }
}

/* the band's own inbox peek, when it read every box of this session's lineage */
function bandInbox(sid: string, ib: any): any[] | undefined {
  const boxes = ib && Array.isArray(ib.boxes) ? ib.boxes : []
  return ib && Array.isArray(ib.events) && [sid, ...oldIds(sid)].every((b) => boxes.includes(b)) ? ib.events : undefined
}

async function loadBand($: any): Promise<void> {
  const t0 = Date.now()
  const sid = await sessionId($)
  await localRead($, sid).catch(() => null)
  await readClosed($, sid)
  /* a handed-off session keeps the band it last drew; a load now is scoped without
     its lease, which would drop its workstreams' blockers */
  if (band.loaded && closedAs(sid) === 'handed off') return
  const cwd = await projectDir($)
  const gen = mem.gen
  const drew = band.drew
  band.drew = 0
  const { near, why } = await readBand($, sid, cwd, drew)
  if (!near) {
    /* no local band: the band keeps what it drew and says why */
    const was = band.model && band.model.offline
    band.model = withOffline(band.model, why)
    if (band.loaded && was === why) return
    band.loaded = true
    try { $.ui.invalidate('ui.render') } catch {}
    return
  }
  const { found, rows, open, edited } = await fromNear($, sid, cwd, near, gen)
  /* the local band says when the board stopped answering; its cache still draws */
  band.model = withOffline(band.model, offlineLine(near))
  const ws = found && found.workstream
  /* the graph rides the band; one for a track the cache has not caught up with is read apart;
     with no track held, the project's workstream the band carries */
  const graph = ws && near.graph && near.graph.workstream === ws ? near.graph : ws ? await localGet($, 'graph/' + encodeURIComponent(ws))
    : near.graph && near.graph.unheld ? near.graph : null
  band.near = near
  band.graph = graph && graph.view ? (ws ? { workstream: ws, view: graph.view, layout: graph.layout || null } : graph) : null
  band.loaded = true
  /* a read before the local board's first snapshot carries no shelf; keeping the seen set
     then means the next read announces only what turned waiting, not the whole shelf */
  if (near.loaded !== false && Array.isArray(near.shelf)) {
    const fresh = newlyWaiting(band.seen, rows)
    band.seen = waitingKeys(rows)
    for (const r of fresh) announceWaiting($, r)
  }
  /* the guard's state follows the held track */
  const th = found ? found.key : null
  if (guard.state === undefined || guard.track !== th || edited) await markerRun($, sid, th, th ? ['--write'] : [])
  guard.mark = band.marker
  /* the week chip's first figures; after this session.measure pushes them */
  if (!rates.read) {
    rates.read = true
    try { rates.list = ((await $.session.usage()) || {}).rateLimits } catch {}
  }
  band.inbox = await peekInbox($, bandInbox(sid, near.inbox)).catch(() => band.inbox)
  /* the cards under replies follow an answer, drop or snooze made anywhere */
  follow.open = open
  await followRun($).catch(() => false)
  try { $.ui.invalidate('ui.render') } catch {}
  band.drew = Date.now() - t0
  void deliver($).catch(() => {})
  /* a session engaged since its last load files the questions it kept */
  if (local.entry && local.sid === sid && local.entry.qs.length && (await isEngaged($))) void fileLocal($).catch(() => {})
}

/* One load at a time; a request made during one runs once more after it. */
function refresh($: any): Promise<void> {
  if (band.loading) { band.again = true; return band.loading }
  band.loading = (async () => {
    do { band.again = false; await loadBand($).catch(() => {}) } while (band.again)
  })().finally(() => { band.loading = undefined })
  return band.loading
}

/* After a write of the mod's own: the band redraws without waiting for a poll. */
function kick($: any): void {
  try { $.clock.after(0, () => { void refresh($) }) } catch {}
}

/* a closed session's poll stops, its band frozen as last drawn. */
const FREEZE_CLOSED = true

/* while the local board's long poll holds, the timer does nothing; else it arms the long
   poll again and reloads on a change of the board's seq. With no local server answering, the
   load starts it once (a refused start is not tried again until local.json changes). */
async function poll($: any): Promise<void> {
  if ((FREEZE_CLOSED && closedAs(mem.id)) || wait.live) return
  armWait($)
  const st = await waitRead($, 'state')
  if (st ? 'seq:' + st.seq !== band.marker || !band.loaded : !(await localBase($))) await refresh($)
}

function startPoll($: any): void {
  armWait($)
  if (band.timer) return
  try { band.timer = $.clock.every(POLL_MS, () => { void poll($).catch(() => {}) }) } catch {}
}

/* one held request on the local route, answered the moment a change
   lands, armed again at once; a change reloads the band and the Home graph. The host ends
   any fetch at 30 s (2.1.308) and the server caps a hold at 60 s: 20 s leaves 10 s spare. */
const WAIT_MS = 20000
const wait: { live?: boolean; busy?: boolean; after?: number } = {}

async function waitRead($: any, path: string): Promise<any> {
  const base = await localBase($)
  if (!base) return null
  const r = await routeFetch($, base, path, { method: 'GET' })
  try {
    const j = r && r !== 'dropped' && r.ok ? JSON.parse(r.text) : null
    return j && j.ok === true && j.result && Number.isFinite(j.result.seq) ? j.result : null
  } catch {
    return null
  }
}

/* One held request; false when no local board answers it. */
async function waitOnce($: any): Promise<boolean> {
  let after = wait.after
  /* first from the seq the band was read at, so nothing between is skipped */
  if (after === undefined && band.loading) await band.loading.catch(() => {})
  if (after === undefined && band.near && Number.isFinite(band.near.seq)) after = band.near.seq
  if (after === undefined) {
    const st = await waitRead($, 'state')
    if (!st) return false
    after = st.seq
  }
  /* live from the moment the held request is out, so a prompt meanwhile trusts the band */
  wait.live = true
  const r = await waitRead($, 'wait?after=' + after + '&ms=' + WAIT_MS)
  if (!r) return false
  const frozen = FREEZE_CLOSED && closedAs(mem.id)
  /* a change a frozen band skipped is answered again once the wait is armed after the lift */
  if (!(r.changed && frozen)) wait.after = r.seq
  if (r.changed && !frozen) await refresh($)
  return true
}

/* Live while a held request is out, false whenever the chain stops, so the poll
   arms it again after a freeze lifts. */
function armWait($: any): void {
  if (wait.busy || (FREEZE_CLOSED && closedAs(mem.id))) return
  wait.busy = true
  const stop = () => { wait.busy = false; wait.live = false }
  const step = () => {
    void waitOnce($).catch(() => false).then((held) => {
      wait.live = held
      if (held && !(FREEZE_CLOSED && closedAs(mem.id))) {
        try { $.clock.after(0, step) } catch { stop() }
      } else stop()
    })
  }
  try { $.clock.after(0, step) } catch { stop() }
}

/* What must reach the user outside the session goes to the board server's alert
   route (the tray), at the address the local band carries; fail-open: none, no alert. */
async function sendAlert($: any, body: any): Promise<{ ok: boolean; via?: string; reason?: string }> {
  const url = alertUrl(band.local)
  if (!url) return { ok: false, reason: 'no board address' }
  try {
    const r = await $.http.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    let j: any = {}
    try { j = JSON.parse(r.text) } catch {}
    return r.ok ? { ok: true, via: j.via } : { ok: false, reason: j.error || 'status ' + r.status }
  } catch (err: any) {
    return { ok: false, reason: String((err && err.message) || err) }
  }
}

/* The tray's context in names: the project, the track's workstream. */
async function alertNames($: any, ws?: string | null): Promise<any> {
  /* the short name the board files the project under, from the band */
  if (!band.scope) await refresh($).catch(() => {})
  const names: any = band.scope && band.scope.name ? { project: band.scope.name } : {}
  if (ws) {
    const r = await cli($, ['show', ws, '--json'])
    if (r.ok && r.json && r.json.name) names.workstream = r.json.name
  }
  return names
}

/* An answer arriving from another session or the board raises a toast,
   once, kept in $.store so a reload never raises it again. It wakes nothing. */
async function toastArrived($: any, waiting: any): Promise<void> {
  const arrived: any[] = (waiting && Array.isArray(waiting.arrived)) ? waiting.arrived : []
  if (!arrived.length) return
  if (!band.heard) {
    let kept: any = []
    try { kept = (await $.store.get('toasted')) || [] } catch {}
    band.heard = new Set(Array.isArray(kept) ? kept : [])
  }
  const heard = band.heard
  const fresh = arrived.filter((a) => !heard.has(a.key))
  if (!fresh.length) return
  /* an onboarding run's own answers raise no toast; heard all the same, so none raises one later */
  const quiet = onboarding.has(await sessionId($))
  for (const a of fresh) {
    heard.add(a.key)
    if (!quiet) toast($, a.text, 'ambient', 8000)
  }
  band.heard = new Set(rememberKeys([...heard], []))
  try { await $.store.set('toasted', [...band.heard]) } catch {}
}

/* the tray alert goes as the toast shows, so it follows the toast's one per track */
function announceWaiting($: any, row: any): void {
  /* this session's own handoff had its toast and its alert when it was written */
  if (row.handoff === band.own) return
  const alert = async () => { await sendAlert($, trackAlert(row, await alertNames($, row.workstream))) }
  toast($, waitingToast(row), 'ambient', 8000, { key: 'waiting|' + row.track, shown: () => { void alert().catch(() => {}) } })
}

/* ---- answer delivery --------------------------- */

/* acks: by inbox, the keys told since the last take; flying: keys a take handed to a
   delivery still running, so a second take meanwhile never tells them too; prompted: a typed
   prompt's take answered and nothing has come in since, so its turn takes nothing */
const inbox: { busy?: Promise<void>; again?: boolean; acks: Record<string, string[]>; flying: Set<string>; prompted?: boolean } = { acks: {}, flying: new Set() }

async function inboxRun($: any, args: string[], stdin?: string): Promise<any> {
  const r = await spawn($, ['node', $.plugin.root + '/scripts/mod-inbox.mjs', ...args, '--json'],
    { timeoutMs: 30000, ...(stdin === undefined ? {} : { stdin }) })
  if (r.exitCode !== 0) return null
  try { return JSON.parse(String(r.stdout || '')) } catch { return null }
}

/* What was delivered, kept across reloads and /clear so nothing is told twice. */
async function deliveredKeys($: any): Promise<string[]> {
  try { const v = await $.store.get('delivered'); return Array.isArray(v) ? v : [] } catch { return [] }
}

/* the inbox keeps what a take answered until the next take acks it, so a line
   never told (a cut reply, a refused append) comes back by itself */
function ackKeys(box: string, keys: string[]): void {
  const list = inbox.acks[box] || (inbox.acks[box] = [])
  for (const k of keys) if (!list.includes(k)) list.push(k)
}
const ack = (evs: any[]) => { for (const e of evs) if (!e.local) ackKeys(e.box, [e.orig.key]) }
/* a delivery done, told or not: its keys can be taken again (unacked, they come back) */
const landed = (evs: any[]) => { for (const e of evs) inbox.flying.delete(e.key) }

/* This session's inbox and the ids it had before a /clear in one call, keyed
   by the inbox each came from (two sessions each hear the same answer); none told before. */
/* carried: a peek's events the band already read, so no script runs */
async function readInboxes($: any, verb: 'take' | 'peek', carried?: any[]): Promise<any[] | null> {
  const sid = await sessionId($)
  const old = oldIds(sid)
  const args = [verb, '--session', sid, ...(old.length ? ['--lineage', old.join(',')] : [])]
  const sent = verb === 'take' ? inbox.acks : {}
  if (verb === 'take') inbox.acks = {}
  const acking = Object.keys(sent).length > 0
  const j = verb === 'peek' && carried ? { events: carried } : await inboxRun($, acking ? [...args, '--ack'] : args, acking ? JSON.stringify(sent) : undefined)
  /* answers to the questions this session keeps wait in the mod's store */
  const held = localSaid(sid)
  if (!j || !Array.isArray(j.events)) {
    /* no answer: the acks may not have landed, so the next take sends them again */
    for (const box of Object.keys(sent)) ackKeys(box, sent[box])
    if (!held.length) return null
  }
  const got: any[] = (j && Array.isArray(j.events) ? j.events : []).map((e: any) => { const box = e.box || sid; return { ...e, key: box + '|' + e.key, box, orig: e } }).concat(held)
  if (!got.length) return []
  const kept = await deliveredKeys($)
  if (verb === 'take') ack(got.filter((e: any) => kept.includes(e.key)))
  const fresh = got.filter((e: any, i: number) => !kept.includes(e.key) && !inbox.flying.has(e.key) && got.findIndex((x: any) => x.key === e.key) === i)
  await overrideHeard($, fresh).catch(() => {})
  if (verb === 'take') for (const e of fresh) inbox.flying.add(e.key)
  /* an answer taken before any peek saw it still toasts (a peek toasts in peekInbox) */
  if (verb === 'take') await toastArrived($, inboxWaiting(fresh, band.options)).catch(() => {})
  return fresh
}

/* An answer's option, read once, so its line names the option. */
async function learnOptions($: any, fresh: any[]): Promise<void> {
  const ids = [...new Set(fresh.filter((e: any) => e.raw && e.raw.kind === 'answer' && e.raw.pick).map((e: any) => e.raw.id))]
  for (const id of ids.filter((x: any) => !band.options[x] && !isLocalId(x)).slice(0, 8)) {
    const r = await cli($, ['show', id, '--json'])
    if (r.ok && r.json && Array.isArray(r.json.options)) band.options[id] = r.json.options
  }
}

/* the band's count, read and left in place. */
async function peekInbox($: any, carried?: any[]): Promise<any> {
  const fresh = (await readInboxes($, 'peek', carried)) || []
  await learnOptions($, fresh)
  const waiting = inboxWaiting(fresh, band.options)
  await toastArrived($, waiting).catch(() => {})
  return waiting
}

async function markTold($: any, evs: any[]): Promise<void> {
  try { await $.store.set('delivered', rememberKeys(await deliveredKeys($), evs.map((e: any) => e.key))) } catch {}
  ack(evs)
  await localTold($, evs.filter((e: any) => e.local)).catch(() => {})
  band.inbox = null
  try { $.ui.invalidate('ui.render') } catch {}
}

/* answers the next reply owes a receipt line for; `at` counts the turn's
   texts at delivery, so only a reply written after it owes one */
const owed: Array<{ token: string; turn?: string; at: number }> = []

/* a delivery the model took, told as one transcript row naming each answer */
function received($: any, fresh: any[]): void {
  const got = receiptsOf(fresh)
  if (!got.length) return
  try { $.ui.log(receiptRow(got)) } catch {}
  for (const g of got) owed.push({ token: g.token, turn: mem.turn, at: checks.texts.length })
}

/* nothing starts a turn but the user. While a turn runs,
   what arrives is a note the model reads at its next step; idle, it waits. */
async function deliverOnce($: any): Promise<void> {
  if (!mem.turn) {
    /* idle, a line the band's peek just counted is the next turn's to take */
    if (band.inbox && band.inbox.n > 0) inbox.prompted = false
    return
  }
  const fresh = await readInboxes($, 'take')
  if (!fresh || !fresh.length) return
  try {
    await learnOptions($, fresh).catch(() => {})
    const text = deliveryText(fresh, band.options)
    /* a delivery that throws or is refused is not acked, so the next take answers it again */
    const r = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
    if (r && r.deny) return
    received($, fresh)
    await markTold($, fresh)
  } finally { landed(fresh) }
}

function deliver($: any): Promise<void> {
  if (inbox.busy) { inbox.again = true; return inbox.busy }
  inbox.busy = (async () => {
    do { inbox.again = false; await deliverOnce($).catch(() => {}) } while (inbox.again)
  })().finally(() => { inbox.busy = undefined })
  return inbox.busy
}

/* The submit chip: one prompt carrying all that waits; a refused submit leaves it unacked.
   only the user's press calls it, so it goes as the user's words, the relay under its header. */
async function submitWaiting($: any): Promise<void> {
  if (inbox.busy) await inbox.busy
  const fresh = await readInboxes($, 'take')
  band.inbox = null
  try { $.ui.invalidate('ui.render') } catch {}
  if (!fresh || !fresh.length) return
  try {
    await learnOptions($, fresh).catch(() => {})
    let r: any
    try { r = await $.prompt.submit({ text: deliveryText(fresh, band.options), asUser: true }) } catch (err: any) { r = { drop: String((err && err.message) || err) } }
    /* not acked: the band counts it again at the next load */
    if (r && r.drop) { kick($); return }
    received($, fresh)
    await markTold($, fresh)
  } finally { landed(fresh) }
}

/* The user's typed prompt carries what waits: a row before it, else a note at its top. */
async function promptNote($: any): Promise<string> {
  if (inbox.busy) await inbox.busy
  const fresh = await readInboxes($, 'take')
  /* a take that answered covers the turn this prompt starts */
  inbox.prompted = fresh !== null
  if (!fresh || !fresh.length) return ''
  try {
    await learnOptions($, fresh).catch(() => {})
    const text = deliveryText(fresh, band.options)
    let row = false
    try {
      const r = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
      row = !(r && r.deny)
    } catch {}
    /* a row, or else the prompt's own top, carries it either way */
    received($, fresh)
    await markTold($, fresh)
    return row ? '' : text
  } finally { landed(fresh) }
}

/* the mod's own answers run one call at a time, so a burst lands in the order pressed. */
const answers: { tail: Promise<unknown>; chips: Record<string, { state: string; error?: string }> } = { tail: Promise.resolve(), chips: {} }

function queued<T>(job: () => Promise<T>): Promise<T> {
  const run = answers.tail.then(job, job)
  answers.tail = run.catch(() => {})
  return run
}

/* every site's press shows the answered look at once, one press per question: saving
   until the store confirms, then done; a failure puts the chips back and the toast says why.
   A press on a question already saving or answered does nothing (null). */
function chipsMoved($: any): void {
  qpane.answering = answeringOf(answers.chips)
  try { $.ui.invalidate('ui.render') } catch {}
}
/* say: false where the caller tells the outcome itself (Send's one toast) */
async function pressAnswer($: any, id: string, letter: string, run: () => Promise<Recorded>, say = true): Promise<Recorded | null> {
  if (answeringOf(answers.chips)[id]) return null
  const key = id + '|' + letter
  answers.chips[key] = { state: 'pending' }
  chipsMoved($)
  const r: Recorded = await run().catch((err: any) => ({ ok: false, text: 'Answering ' + id + ' failed: ' + String((err && err.message) || err) }))
  delete answers.chips[key]
  if (r.ok) answers.chips[id + '|' + ((r as any).pick || letter)] = { state: 'done' }
  if (r.ok) savedFrozen(token(id, (r as any).pick || letter))
  if (say) toast($, r.text, 'press')
  chipsMoved($)
  return r
}

/* a press on a frozen band saves and starts no turn, so its closed line names
   what it saved; kept per freeze (keepClosed's object), so a lift or a new freeze clears it. */
const frozenSaves: { of?: object; tokens: string[] } = { tokens: [] }
function savedFrozen(tok: string): void {
  if (!closedAs(mem.id) || !mem.closed) return
  if (frozenSaves.of !== mem.closed) { frozenSaves.of = mem.closed; frozenSaves.tokens = [] }
  if (!frozenSaves.tokens.includes(tok)) frozenSaves.tokens.push(tok)
}
const savedHere = (): string[] => (closedAs(mem.id) && frozenSaves.of === mem.closed ? frozenSaves.tokens : [])

async function bandAnswer($: any, q: any, a: any): Promise<void> {
  /* the version the row was drawn from, as a card's */
  const r = await pressAnswer($, q.id, a.letter, () => recordAnswer($, q.id, a.letter, 'band', undefined, undefined, q.version))
  if (r) await refresh($)
}

/* each pressed call by its key, saving or done; its row leaves the band at once,
   and comes back only when the press fails */
const callPresses: Map<string, 'pending' | 'done'> = new Map()
/* several override requests fold to one count line; its press unfolds them */
const callFold = { open: false }
/* how long a press waits for the local board to tell the asking session's inbox */
const CATCH_MS = 3000

/* A board verb through the local route as the user's act (the user actor, today's answer trust), recorded at once. */
async function localVerb($: any, name: string, body: any): Promise<{ ok: boolean; result?: any; error?: string }> {
  const base = await localBase($)
  if (!base) return { ok: false, error: 'the local server is not running' }
  const r = await routeFetch($, base, 'verbs/' + encodeURIComponent(name), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r) return { ok: false, error: 'nobody answered at the local server\'s address; nothing was run' }
  if (r === 'dropped') return { ok: false, error: 'the local server dropped the call; it may have run' }
  let j: any = null
  try { j = JSON.parse(r.text) } catch {}
  return j && j.ok === true ? { ok: true, result: j.result } : { ok: false, error: String((j && j.error) || 'the local server answered ' + r.status) }
}

/* The user's press in the session that asked (or that holds the look task) starts its turn with the
   result; the local board tells the inbox as the row lands, so the take waits for it */
async function deliverAsked($: any, before: any, site: PressSite): Promise<void> {
  if (before && Number.isFinite(before.seq)) await waitRead($, 'wait?after=' + before.seq + '&ms=' + CATCH_MS).catch(() => null)
  userDelivers($, site)
}

/* A call's press: its verb with its input as the user's act. Pressed anywhere else, the result
   waits in the asking session's inbox for its next turn. */
async function pressCall($: any, c: any, p: any, site: PressSite): Promise<{ ok: boolean; text: string; result?: any }> {
  mem.engaged = true
  const sid = await sessionId($)
  const before = await waitRead($, 'state')
  const r = await localVerb($, p.verb, { input: p.input, user: sid })
  if (!r.ok) {
    /* an Allow refused as changed since asked, or expired, starts the asking session's turn too */
    if (c.mine && /changed since asked|expired/.test(r.error || '')) await deliverAsked($, before, site)
    return { ok: false, text: callPressText(c, p, null, r.error) }
  }
  if (c.mine || (r.result && r.result.asker === sid)) await deliverAsked($, before, site)
  kick($)
  return { ok: true, text: callPressText(c, p, r.result), result: r.result }
}

async function bandCall($: any, c: any, p: any): Promise<void> {
  if (callPresses.has(c.key)) return
  callPresses.set(c.key, 'pending')
  try { $.ui.invalidate('ui.render') } catch {}
  const r = await pressCall($, c, p, 'band').catch((err: any) => ({ ok: false, text: callPressText(c, p, null, String((err && err.message) || err)) }))
  if (r.ok) callPresses.set(c.key, 'done'); else callPresses.delete(c.key)
  toast($, r.text, 'press')
  try { $.ui.invalidate('ui.render') } catch {}
  await refresh($)
}

/* The band's calls less the ones pressed. */
function withPresses(model: any): any {
  if (!model || !Array.isArray(model.calls) || !callPresses.size) return model
  return { ...model, calls: model.calls.filter((c: any) => !callPresses.has(c.key)) }
}

/* /askerdo allow K-n, keep K-n, unscrub K-n: the same act as the band's press, typed */
async function overrideCmd($: any, verb: 'allow' | 'keep' | 'unscrub', args: string): Promise<string> {
  const o = parseOverride(verb, args)
  if (o.error) return o.error
  mem.engaged = true
  const sid = await sessionId($)
  const before = await waitRead($, 'state')
  const argv = verb === 'unscrub' ? ['override', 'unscrub', o.id, '--user', sid, '--json'] : ['override', 'decide', o.id, verb, '--user', sid, '--json']
  const press = verb === 'unscrub' ? { label: 'Unscrub', verb: 'overrideUnscrub' } : { label: verb === 'allow' ? 'Allow' : 'Keep', verb: 'overrideDecide' }
  const r = await cli($, argv)
  if (!r.ok) return callPressText({ id: o.id }, press, null, r.err || 'exit ' + r.code)
  if (r.json && r.json.asker === sid) await deliverAsked($, before, 'typed')
  kick($)
  return callPressText({ id: o.id }, press, r.json)
}

/* ---- commands ---------------------------------------------------------- */

/* the project's open set on the board, through the local server, which lands the
   browser signed in; '' with no local server known. In the form the desktop opens */
async function setLink($: any): Promise<string> {
  const root = (await localBase($)).replace(/local\/$/, '')
  if (!root) return ''
  if (!band.scope) await refresh($).catch(() => {})
  return cardHref(band.scope ? needsYouAt(root) : root)
}

async function openSet($: any): Promise<string> {
  const cwd = await projectDir($)
  const r = await cli($, ['list', '--project', cwd, '--json'])
  if (!r.ok) return failed('Reading the open questions', r)
  const list = (r.json && r.json.questions) || []
  const full = await Promise.all(list.slice(0, SHOW_MAX).map(async (q: any) => {
    const s = await cli($, ['show', q.id, '--json'])
    return s.ok ? s.json : q
  }))
  /* what waits on the user is the band's too, its calls and the live handoffs' asks */
  const { near } = await readBand($, await sessionId($), cwd).catch(() => ({ near: null }))
  /* an override's page through the local server's sign-in route, as setLink's */
  const root = (await localBase($)).replace(/local\/$/, '')
  const linked = (c: any) => (c.kind === 'override' && c.request != null ? { ...c, link: root ? cardHref(root + 'override/' + c.request) : cardHref(c.url) } : c)
  const more = near
    ? { calls: ((withPresses(near.model) || {}).calls || []).map(linked), asks: near.handoffAsks || [] }
    : { missing: 'The local board is not answering, so the band\'s calls and the handoffs\' asks are not listed.' }
  return staleFirst(openSetText(full.concat(list.slice(SHOW_MAX)), { limit: SHOW_MAX, url: await setLink($), ...more }), r)
}

/* every site of the user's own hand starts one turn in an idle
   session; mid-turn a note at the next step; a frozen session only records. */
const TURN_SITES = ['band', 'pane', 'card', 'typed', 'resume']
const userStartsTurn = (site: PressSite): boolean => TURN_SITES.includes(site)
type PressSite = 'band' | 'pane' | 'card' | 'typed' | 'resume'

/* what the user did here reaches this session's model: mid-turn a note at the
   next step, idle one turn where the site starts one; a frozen session never. */
function userDelivers($: any, site: PressSite): void {
  if (closedAs(mem.id)) return
  if (mem.turn) { void deliver($).catch(() => {}); return }
  if (!userStartsTurn(site)) return
  /* a prompt submitted inside command.run would wait on the turn the command holds */
  try { $.clock.after(0, () => { void submitWaiting($).catch(() => {}) }) } catch {}
}

/* What stands on an answered question, one wording for a refused press and an answered card's */
const answeredWords = (label: string, name: string | undefined, said: string): string =>
  label + (name ? ' (' + name + ')' : '') + ' was already answered' + (said ? ': ' + said + (/[.!?]$/.test(said) ? '' : '.') : '.')

/* "already answered" (elsewhere, since the last poll) is done: the toast says what stands */
async function alreadyAnswered($: any, id: string, shown: string | undefined, r: Run): Promise<{ ok: boolean; text: string; pick?: string } | null> {
  if (!/is already answered/.test(r.err)) return null
  const s = await cli($, ['show', id, '--json'])
  const label = (s.ok && s.json && s.json.id) || shown || id
  const said = s.ok && s.json ? String(s.json.answer || '').trim().split(/\r?\n/)[0] : ''
  const m = /^\s*\d+([a-z])\b/.exec(said)
  kick($)
  return { ok: true, text: answeredWords(label, s.ok && s.json ? s.json.name : undefined, said), pick: m ? m[1] : undefined }
}

/* `id` is a label or a key; `shown` the label a failure names. The user's act, so the
   actor is reserved (`--user`), never this session, which the fan-out would skip.
   No letter: the note is the answer. `version`: the one the pressed card showed,
   which refuses a press drawn before a rewording and never amends. `hold`: Send's, which starts
   the turn itself once every queued answer is in, so this says whether the turn is this session's. */
type Recorded = { ok: boolean; text: string; pick?: string; owned?: boolean; stood?: boolean; gone?: boolean }
/* what refuses an answer for good: the question is not open as it was read */
const GONE = /was reworded after version|is already dropped|unknown question id/
async function recordAnswer($: any, id: string, letter: string, site: PressSite, note?: string, shown?: string, version?: number, hold = false): Promise<Recorded> {
  /* a kept question is answered in the mod's store; it engages nothing */
  if (isLocalId(id)) {
    if (!hold) return localAnswer($, id, letter, note, site)
    const r = await localAnswer($, id, letter, note, null)
    return r.ok ? { ...r, owned: true } : { ...r, gone: true }
  }
  mem.engaged = true
  const sid = await sessionId($)
  const argv = ['answer', id, ...(letter ? ['--pick', letter] : []), '--user', sid, '--json']
  if (note) argv.push('--note', note)
  if (version !== undefined) argv.push('--version', String(version))
  const before = await waitRead($, 'state')
  const r = await queued(() => cli($, argv))
  if (!r.ok) {
    const stood = await alreadyAnswered($, id, shown, r)
    return stood ? { ...stood, stood: true } : { ok: false, text: failed('Answering ' + (shown || id), r), gone: GONE.test(r.err) }
  }
  /* the same pick already stored reached its subscribers the first time, so no turn;
     else the turn waits for the answer's inbox line, as a call's press does (never the chip's look) */
  const already = !!(r.json && r.json.already)
  const owned = !already && ownsIt(r.json && r.json.owner, sid)
  if (owned && !hold) void deliverAsked($, before, site).catch(() => {})
  kick($)
  /* the echo always names the label the store answered and its name; the name from
     what the band read when the answer leaves it out, never a second call */
  const label = (r.json && r.json.id) || shown || id
  const known = (band.questions || []).find((q: any) => q && (q.id === label || (q.key && q.key === id)))
  const name = (r.json && r.json.name) || (known && known.name) || ''
  if (already) return { ok: true, stood: true, text: label + (name ? ' (' + name + ')' : '') + ' already answered ' + (r.json.pick || token(label, letter)) + ', recorded as it was.' }
  return {
    ok: true, owned,
    text: 'Answered ' + label + (name ? ' (' + name + ')' : '') + ': '
      + (letter ? token(label, letter) + '.' + (note ? ' Note: ' + note : '') : note) + wentTo(r.json && r.json.owner, sid),
  }
}

/* a press on a question another session owns starts no turn here; it went there */
const ownsIt = (owner: any, sid: string): boolean => !owner || !owner.session || owner.session === sid

/* an answer to a question another session owns says where it went: that session's
   track (else another session) and PC, and that it reads it at its next turn */
function wentTo(owner: any, sid: string): string {
  if (!owner || !owner.session || owner.session === sid) return ''
  const who = owner.track ? 'the session on ' + owner.track + (owner.trackName ? ' ' + owner.trackName : '') : 'another session'
  return ' It went to ' + who + (owner.pc ? ', on ' + owner.pc : '') + ', which reads it at its next turn.'
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const SNOOZE_HOW = 'To snooze, write when in the note field: a date as YYYY-MM-DD, or the words that should wake it.'

/* drop and snooze from a card, the user's acts recorded and told as the user's chip answers
   are; the field's words are the drop's reason or the snooze's wake. */
async function recordEnd($: any, verb: 'drop' | 'snooze', id: string, words: string, site: PressSite, shown?: string): Promise<{ ok: boolean; text: string }> {
  if (isLocalId(id)) {
    return verb === 'drop' ? localAnswer($, id, '', words || undefined, site, true)
      : { ok: false, text: id + ' stays with this session, so it has no snooze: answer it or drop it.' }
  }
  mem.engaged = true
  const sid = await sessionId($)
  const how = verb === 'drop' ? (words ? ['--note', words] : []) : DAY.test(words) ? ['--until', words] : ['--trigger', words]
  const r = await queued(() => cli($, [verb, id, ...how, '--user', sid, '--json']))
  const label = (r.ok && r.json && r.json.id) || shown || id
  if (!r.ok) return { ok: false, text: failed((verb === 'drop' ? 'Dropping ' : 'Snoozing ') + label, r) }
  const owner = r.json && r.json.owner
  if (ownsIt(owner, sid)) userDelivers($, site)
  kick($)
  if (verb === 'drop') return { ok: true, text: 'Dropped ' + label + (words ? ': ' + words : '') + '.' + wentTo(owner, sid) }
  return { ok: true, text: 'Snoozed ' + label + (DAY.test(words) ? ' until ' + words : ', to wake when: ' + words) + '.' + wentTo(owner, sid) }
}

/* after a clash, the same token typed again answers the live holder */
const clash: { token?: string; key?: string } = {}

/* every token in the line is its own answer, each told on its own line */
async function answerCmd($: any, args: string): Promise<string> {
  const a = parseAnswer(args)
  if (a.error) return a.error
  const out: string[] = []
  for (const one of [a, ...(a.more || [])]) out.push(await answerOne($, one))
  return out.join('\n')
}

async function answerOne($: any, a: { id: string; letter: string; note?: string }): Promise<string> {
  if (isLocalId(a.id)) return (await localAnswer($, a.id, a.letter, a.note, 'typed')).text
  const s = await cli($, ['show', a.id, '--json'])
  const key = s.ok && s.json && typeof s.json.key === 'string' ? s.json.key : ''
  if (key) {
    await loadTold($)
    const was = toldClash([...told.values()], await sessionId($), a.id, key)
    const tok = token(a.id, a.letter)
    if (was && !(clash.token === tok && clash.key === key)) {
      clash.token = tok
      clash.key = key
      const now = await cli($, ['show', was.key, '--json'])
      const wasNow = now.ok && now.json && now.json.key === was.key ? String(now.json.id || '') : ''
      return clashText({ label: a.id, letter: a.letter, liveName: String(s.json.name || ''), was, wasNow })
    }
    clash.token = undefined
    clash.key = undefined
  }
  return (await recordAnswer($, key || a.id, a.letter, 'typed', a.note, a.id)).text
}

async function boardCmd($: any): Promise<string> {
  const over = await seamEnv($)
  const live = await liveBase($, await callerEnv($, over), over)
  if (!live.base) return 'Finding the board failed: the local server is not running and could not be started: ' + live.why
  return 'The board: ' + await setLink($)
}

/* one turn when idle, else a row the model reads at its next step */
async function tellBrief($: any, text: string): Promise<'turn' | 'note' | ''> {
  if (userStartsTurn('resume') && !mem.turn) {
    try { const p = await $.prompt.submit({ text, asUser: true }); if (!(p && p.drop)) return 'turn' } catch {}
  }
  try { const a = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } }); if (!(a && a.deny)) return 'note' } catch {}
  return ''
}

/* `inCommand`: typed as /askerdo resume, whose turn the command holds until it answers;
   `inPrompt`: a line in a prompt, whose text carries the kickoff, so nothing is told */
async function resumeCmd($: any, parsed: any, inCommand = false, inPrompt = false): Promise<string> {
  if (parsed.error) return parsed.error
  /* words typed after the id go only with a kickoff, so a refusal says they were held back */
  const lost = parsed.note && !inPrompt ? '\nYour words after the id were not sent.' : ''
  if (parsed.sub === 'shelf') {
    const r = await cli($, ['shelf', '--json'])
    return r.ok ? staleFirst(shelfText(r.json.rows), r) : failed('Reading the shelf', r)
  }
  let track = parsed.track
  if (parsed.workstream) {
    const shelf = await cli($, ['shelf', '--json'])
    if (!shelf.ok) return failed('Reading the shelf', shelf) + lost
    const rows = (shelf.json.rows || []).filter((row: any) => row && row.track && row.workstream === parsed.workstream)
    if (!rows.length) return 'No track of ' + parsed.workstream + ' is waiting or parked.' + lost
    if (rows.length > 1) return parsed.workstream + ' has ' + rows.length + ' tracks on the shelf; pick one.' + lost + '\n' + shelfText(rows)
    track = rows[0].track
  }
  const sid = await sessionId($)
  const move = parsed.move === 'take over' ? ['--take-over'] : parsed.move === 'read only' ? ['--read-only']
    : parsed.move === 'splinter' ? ['--splinter', parsed.name] : []
  const r = await cli($, ['resume', track, ...move, '--session', sid, '--json'])
  if (!r.ok) return failed('Resuming ' + track, r) + lost
  /* a held track names its holder and the user's three moves; nothing changed. The
     resume is the lease write, never a cache read, so no stale line */
  if (!r.json.acquired && !r.json.readOnly) return heldText(r.json) + lost
  if (r.json.readOnly) return track + ', read only: this session did not take it.\n\n' + String(r.json.kickoff || '') + lost
  setTrack(r.json.track, r.json.key)
  await writeMarker($, sid)
  await liftFreeze($, sid)
  kick($)
  folderFlag($, r.json.handoffChecks)
  /* the verify-first's pass or fail per repo above the kickoff; a failure never blocks */
  const verify = verifyLines(r.json.verify)
  const head = (r.json.splintered ? 'Started ' + r.json.track + ' from ' + r.json.parent + ', held by this session.'
    : 'Took ' + r.json.track + (r.json.handoff ? ' from ' + r.json.handoff.id : ' with no handoff yet') + ', held by this session.')
    + (r.json.next ? '\n' + r.json.next : '')
    + (verify.length ? '\n' + verify.join('\n') : '')
  /* a command's returned text is not measured to reach the model, so the brief (the
     kickoff, the state, where we were) goes as the user's own act: one turn when idle,
     else a row the model reads at its next step. Each part goes once, the
     verify-first above the kickoff whose line 1 already says resumed and held. */
  const brief = String(r.json.kickoff || '')
  const words = parsed.note && !inPrompt ? capFirst(await userName($)) + '\'s words with this resume:\n' + parsed.note : ''
  let told: 'turn' | 'note' | 'queued' | '' = ''
  const what = 'The kickoff' + (words ? ', with your words,' : '')
  if (inPrompt) return [head, brief, words].filter(Boolean).join('\n\n')
  if (brief || words) {
    const text = [verify.join('\n'), brief, words].filter(Boolean).join('\n\n')
    /* a prompt submitted inside command.run waits on the turn the command holds, so the
       typed resume submits from a timer once it has answered, as handoffCmd does */
    if (inCommand && userStartsTurn('resume') && !mem.turn) {
      $.clock.after(0, () => {
        void tellBrief($, text).then((t) => {
          if (t !== 'turn') toast($, what + (t === 'note' ? ' could not start a turn; it went to the model as a note.' : ' could not reach the model.'), 'press')
        })
      })
      told = 'queued'
    } else told = await tellBrief($, text)
  }
  return head + (told === 'queued' ? '\n' + what + ' starts a turn now.' : told === 'turn' ? '\n' + what + ' started a turn.'
    : told === 'note' ? '\n' + what + ' went to the model as a note.' : brief ? '\n\n' + brief + lost : lost)
}

/* a session's first prompt, per id, kept in $.store so a reload never sees one twice */
const prompted = new Set<string>()
async function firstPrompt($: any, sid: string): Promise<boolean> {
  if (!sid || prompted.has(sid)) return false
  prompted.add(sid)
  try { if (((await $.store.get('prompted')) || {})[sid]) return false } catch {}
  await saveMarks($, sid, true, 'prompted')
  return true
}

/* The app wraps a started session's first message in its own words, so a /askerdo line in it
   never runs as the command: the mod runs a whole resume line there, nothing else. The first
   prompt's origin goes to the debug log once a session. */
async function startedResume($: any, e: any): Promise<string> {
  /* the mod's own submits (asUser) are never a session's first message */
  if (e.origin && e.origin.asUser === true) return ''
  const sid = await sessionId($)
  if (!(await firstPrompt($, sid))) return ''
  const kind = e.origin && e.origin.kind
  debugLine($, 'AskerDo origin: the first prompt of ' + sid + ' came from ' + (kind || 'no origin') + (e.command ? ' as /' + e.command : '')
    + ' (app row ' + ((await hostId($)) || 'none') + ')')
  if (e.command || !kind || kind === 'composer') return ''
  const args = resumeLine(e.text)
  if (!args) return ''
  const said = await resumeCmd($, parseResume(args), false, true)
  return 'AskerDo ran this prompt\'s line /askerdo resume ' + args + ' as the command, so the line needs nothing more; its answer:\n\n' + said
}

/* a later prompt sent from elsewhere (not typed, not the mod's own) that is one whole
   /askerdo line runs as the typed command does, its answer above the line; its origin goes to the debug log */
async function sentCommand($: any, e: any): Promise<string> {
  const kind = e.origin && e.origin.kind
  if (e.command || !kind || kind === 'composer' || e.origin.asUser === true) return ''
  /* a peer's message reaches the hook in its cross-session envelope, the origin bare */
  const args = commandLine(kind === 'peer' ? (typeof e.origin.body === 'string' ? e.origin.body : peerBody(e.text)) : e.text)
  if (args === null) return ''
  const line = '/askerdo' + (args ? ' ' + args : '')
  debugLine($, 'AskerDo origin: a prompt of ' + (await sessionId($)) + ' came from ' + kind + ' and ran as ' + line)
  const r = await runAskerdo($, { args }, true)
  return 'AskerDo ran this prompt\'s line ' + line + ' as the command, so the line needs nothing more; its answer:\n\n' + r.text
}

/* a handoff folder's missing step or budget as a dim line; never a refusal */
function folderFlag($: any, checks: any): string {
  const line = handoffCheckLine(checks)
  if (line) try { $.ui.log(line) } catch {}
  return line
}

/* A side track finished or parked hands back where it left from; a closed parent
   takes no resume, so the board's open tracks (or the inbox count) are named instead */
const junctionBack = (r: any) => {
  const j = r && r.junction
  if (!j || !j.track || !j.track.id) return ''
  if (j.closed) {
    const open = Array.isArray(j.open) ? j.open : []
    return '\nIts junction ' + j.track.id + ' is ' + j.track.state + ', so there is no going back there. ' + (open.length
      ? 'Open in ' + j.workstream + ': ' + open.map((t: any) => t.id + ' ' + String(t.name || '').replace(/\s+/g, ' ').trim() + ' (' + t.state + ')').join('; ') + '; /askerdo resume TR-n takes one.'
      : j.workstream + ' has no open track' + (j.inbox ? '; ' + j.inbox + (j.inbox === 1 ? ' task waits' : ' tasks wait') + ' in its inbox' : '') + '.')
  }
  return '\nIts junction: /askerdo resume ' + j.track.id + ' goes back' + (j.task ? ' at ' + j.task.id : '') + '.'
}

/* the inbox a close leaves, as the kickoff words it; its ids are checked at the turn's end */
const inboxText = (inbox: any) => inboxLines(Array.isArray(inbox) ? inbox : []).map((l: string) => '\n' + l).join('')
function keepInbox(track: string, inbox: any, more = false): void {
  const ids = (Array.isArray(inbox) ? inbox : []).map((t: any) => String((t && t.id) || t || '')).filter(Boolean)
  if (!ids.length) return
  const was = checks.inbox
  checks.inbox = { track: track || (was && was.track) || '', ids: [...new Set([...((was && was.ids) || []), ...ids])], more: more || !!(was && was.more) }
}

/* a person's moves on a track; each call site one line naming its CLI command */
async function trackCmd($: any, args: string): Promise<string> {
  const p = parseTrack(args)
  if (p.error) return p.error
  if (p.sub === 'pane') return paneCmd($, 'tracks')
  const sid = await sessionId($)
  if (p.sub === 'show' && p.track) {
    const r = await cli($, ['track', 'show', p.track, '--json'])
    return r.ok ? String(r.json.kickoff || '') : failed('Reading ' + p.track, r)
  }
  if (p.sub === 'show') {
    const r = await readMine($, sid)
    return r.ok ? trackText(r.json) : needTrack()
  }
  if (p.sub === 'new') {
    const r = await cli($, ['track', 'new', '--workstream', p.workstream, '--name', p.name, '--session', sid, '--json'])
    if (!r.ok) return failed('Starting the track', r)
    setTrack(r.json.id, r.json.key)
    await writeMarker($, sid)
    await liftFreeze($, sid)
    kick($)
    return 'Started ' + r.json.id + ' ' + p.name + ' in ' + p.workstream + ', held by this session.'
  }
  if (p.sub === 'capture') {
    const held = await boundTrack($, sid, true)
    const ws = band.mine && band.mine.held ? band.mine.workstream : null
    if (!p.inbox && !held) return needTrack()
    if (p.inbox && !ws) return 'Capturing into the inbox needs the workstream of a held track. ' + needTrack()
    const r = await cli($, ['track', 'capture', ...(p.inbox ? ['--workstream', ws] : ['--track', held as string]), '--name', p.name, '--session', sid, '--json'])
    if (!r.ok) return failed('Capturing', r)
    kick($)
    return r.json.id + ' captured ' + (r.json.track ? 'onto ' + r.json.track : 'into the inbox of ' + ws) + '; the work in hand carries on.'
  }
  const held = await boundTrack($, sid, true)
  const target = p.track || held
  if (!target) return needTrack()
  if ((p.sub === 'park' || p.sub === 'finish') && target === held) lettingGo(target)
  if (p.sub === 'park') {
    const r = await cli($, ['track', 'park', target, '--reason', p.reason, '--session', sid, '--json'])
    if (!r.ok) { keptHold(target); return failed('Parking ' + target, r) }
    if (target === held) setTrack(null)
    kick($)
    return target + ' parked: ' + p.reason + '.' + (target === held ? ' This session holds no track now.' : '') + junctionBack(r.json)
  }
  if (p.sub === 'finish') {
    const r = await cli($, ['track', 'finish', target, ...(p.outcome ? ['--outcome', p.outcome] : []), '--session', sid, '--json'])
    if (!r.ok) { keptHold(target); return failed('Finishing ' + target, r) }
    if (target === held) setTrack(null)
    kick($)
    keepInbox(target, r.json.inbox)
    return target + ' ' + (r.json.state || 'done') + '.' + junctionBack(r.json) + inboxText(r.json.inbox)
  }
  /* splinter: the side track starts from the held one, which parks behind it */
  const r = await cli($, ['track', 'splinter', target, '--name', p.name, ...(p.at ? ['--at', p.at] : []), '--session', sid, '--json'])
  if (!r.ok) return failed('Splintering ' + target, r)
  setTrack(r.json.id, r.json.key)
  await writeMarker($, sid)
  kick($)
  return 'Started ' + r.json.id + ' ' + p.name + ', held by this session.' + (r.json.chain ? '\n' + r.json.chain : '')
    + (r.json.parked ? '\n' + target + ' is parked behind it; /askerdo resume ' + target + ' goes back.' : '')
}

async function parkCmd($: any, args: string): Promise<string> {
  const reason = unquote(args)
  if (!reason) return 'Usage: /askerdo park "reason"'
  const sid = await sessionId($)
  const track = await boundTrack($, sid, true)
  if (!track) return needTrack()
  await handoffAsked($, sid)
  /* the model writes the parked handoff, so the next leg gets this leg's
     mind; a timer, as handoffCmd, since the command holds the turn */
  $.clock.after(0, () => { void submitPark($, track, sid, reason).catch(() => {}) })
  return 'Asking the model to write the parked handoff for ' + track + ': ' + reason + '.'
}

/* The track parked with no handoff only when no turn can start (the prompt refused). */
async function submitPark($: any, track: string, sid: string, reason: string): Promise<void> {
  const ask = await submitAsk($, track, reason)
  if (ask.turn) return
  const own = mem.id === sid && mem.track === track
  if (own) lettingGo(track)
  const r = await cli($, ['track', 'park', track, '--reason', reason, '--session', sid, '--json'])
  if (!r.ok && own) keptHold(track)
  const said = r.ok ? 'No turn could start, so ' + track + ' was parked with no new handoff: ' + reason + '.'
    : failed('Parking ' + track, r)
  if (r.ok && mem.id === sid && mem.track === track) setTrack(null)
  /* the ask's note stays in the conversation, so it is called off */
  if (r.ok && ask.noted) await appendNote($, said + ' The parked handoff asked above is not wanted now.')
  toast($, said, 'press')
  kick($)
}

/* the user's own command, so the model reads it as the user's words; a refused prompt leaves
   the ask's note for the user's next one */
async function submitHandoff($: any, track: string): Promise<void> {
  await submitAsk($, track)
}

/* The transcript shows one short line in the user's name. The long ask goes first as a note the
   model reads and the user does not see as typed: the engine skips the mod's own prompt.submit
   hook for its own submit, so no context can ride it (measured on 2.1.308's plugin test) */
const appendNote = async ($: any, text: string): Promise<boolean> => {
  try { const a = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } }); return !(a && a.deny) } catch { return false }
}
async function submitAsk($: any, track: string, reason?: string): Promise<{ turn: boolean; noted: boolean }> {
  const long = handoffPrompt(track, reason, await userName($))
  const noted = await appendNote($, long)
  try {
    const p = await $.prompt.submit({ text: noted ? handoffAsk(track, reason) : long, asUser: true })
    return { turn: !(p && p.drop), noted }
  } catch { return { turn: false, noted } }
}

async function handoffCmd($: any): Promise<string> {
  const track = await boundTrack($, undefined, true)
  if (!track) return needTrack()
  await handoffAsked($, await sessionId($))
  /* a prompt submitted inside command.run would wait on the turn the command
     holds (host check), so it goes from a timer once the command has answered */
  $.clock.after(0, () => { void submitHandoff($, track) })
  return 'Asking the model to write the handoff for ' + track + '.'
}

/* the shortcut that puts the guard-on or guard-off profile on this project. */
async function guardCmd($: any, args: string): Promise<string> {
  const p = parseGuard(args)
  if (p.error) return p.error
  const sid = await sessionId($)
  await boundTrack($, sid, true)
  await markerRun($, sid, mem.trackKey, p.sub === 'show' ? [] : ['--project', p.sub])
  if (guard.state === undefined) return 'The state of the agent guard could not be read.'
  return guardText(guard.state)
}

/* /askerdo and its alias: the first word picks the subcommand. */
async function askerdoCmd($: any, args: string, inPrompt = false): Promise<string> {
  const p = parseAskerdo(args)
  if (p.verb === 'open') return openSet($)
  if (p.verb === 'answer') return answerCmd($, p.args)
  if (p.verb === 'home') return paneCmd($, 'home')
  if (p.verb === 'questions') return paneCmd($, 'questions')
  if (p.verb === 'board') return boardCmd($)
  if (p.verb === 'track') return trackCmd($, p.args)
  if (p.verb === 'park') return parkCmd($, p.args)
  if (p.verb === 'handoff') return handoffCmd($)
  if (p.verb === 'resume') return resumeCmd($, parseResume(p.args), !inPrompt, inPrompt)
  if (p.verb === 'pane') return paneCmd($, 'tracks')
  if (p.verb === 'guide') return paneCmd($, 'guide')
  if (p.verb === 'help') return USAGE + '\n\nThe Guide tab of the AskerDo pane (/askerdo guide) lists the README and the guide pages of this install, each linking to it on GitHub.'
  if (p.verb === 'guard') return guardCmd($, p.args)
  if (p.verb === 'proc') return procCmd($, p.args)
  if (p.verb === 'allow' || p.verb === 'keep' || p.verb === 'unscrub') return overrideCmd($, p.verb, p.args)
  return p.error
}

async function runAskerdo($: any, e: any, inPrompt = false): Promise<{ text: string }> {
  await settle($).catch(() => {})
  /* /askerdo L1a answers a kept question and engages nothing */
  const p = parseAskerdo(e.args || '')
  const a = p.verb === 'answer' ? parseAnswer(p.args) : null
  if (a && !a.error && [a, ...(a.more || [])].every((x: any) => isLocalId(x.id))) return { text: commandLead(e.args, await answerCmd($, p.args)) }
  /* engaged now, drawn after the command, so a binding it makes narrows the
     first draw instead of following a flash of every project blocker */
  const first = !mem.engaged
  mem.engaged = true
  try { return { text: commandLead(e.args, await askerdoCmd($, e.args || '', inPrompt)) } } finally { if (first) kick($) }
}

const commandFailed = () => ({ text: PLUGIN + ': /' + COMMAND + ' failed before it answered.' })

/* ---- the AskerDo pane: Home, Questions and Tracks as tabs ---- */

/* The tab shown and Home's filter, kept across redraws; chosen: an opener or a tab press set the tab;
   unfolded: the questions Home's copy shows unfolded under their row. */
/* graph: Home's scope, the held track's lines until the user switches */
/* done: Home's fold of finished agents, shut until pressed, held for the session only */
/* filterSeed: the text the filter field is drawn with, the filter as the field last mounted */
const view: { tab: PaneTab; filter: string; filterSeed: string; chosen?: boolean; unfolded: Set<string>; graph: string; done: boolean; seeded?: PaneTab } = { tab: 'home', filter: '', filterSeed: '', unfolded: new Set(), graph: 'mine', done: false }
const TAB_NAMES: Record<PaneTab, string> = { home: 'Home', questions: 'Questions', tracks: 'Tracks', settings: 'Settings', guide: 'Guide' }

/* Every opener, command or press: an open pane redraws on the tab asked for. Questions
   opens with the keys and Esc closes it, the card asked for pinned at the top. */
async function openPane($: any, tab: PaneTab, focus?: string, press = false): Promise<any> {
  if (!band.loaded) kick($)
  view.tab = tab
  view.chosen = true
  seedFields()
  if (tab === 'questions') {
    qpane.focus = focus
    if (focus) qpane.expanded = focus
  }
  /* a press hands the keys to the pane, so the desktop puts no focus back on the pressed
     button at each band draw, whose focusin raised its card again wherever the pointer was */
  const keys: any = tab === 'questions' ? { focus: true, closeOnEscape: true } : press ? { focus: true } : {}
  if (keys.closeOnEscape) paneKeys.closeOnEscape = true
  else delete paneKeys.closeOnEscape
  const r = await $.ui.open({ id: PANE_ID, title: paneTitle(where.now, where.cols), ...keys })
  qpaneRedraw($)
  void readWhere($).catch(() => {})
  if (tab === 'questions' && r && r.isPlaced !== false) {
    /* a desktop focuses the pane's frame, outside the tree its hotkeys answer in, so
       the ring goes onto the pinned card; the focus scrolls to it, so the view goes back up */
    const ring = deskRing()
    if (ring) try { await $.ui.focus({ requestId: PANE_ID, key: ring }) } catch {}
    /* fail-open: the 2.1.299 kit answers a press's scroll with "no implementation" */
    if (focus || ring) try { await $.ui.scroll({ to: 'start', in: PANE_ID }) } catch {}
  }
  void closeOld($)
  return r
}

/* A pane the app restored under an id from before the tabs gives way to the AskerDo pane. */
async function closeOld($: any): Promise<void> {
  try {
    const ps = await $.ui.panes()
    for (const p of Array.isArray(ps) ? ps : []) {
      if (p && OLD_PANE_IDS.includes(p.id)) try { await $.ui.close({ id: p.id }) } catch {}
    }
  } catch {}
}

async function paneCmd($: any, tab: PaneTab): Promise<string> {
  let r: any
  try { r = await openPane($, tab) } catch (err: any) {
    return 'The AskerDo pane did not open: ' + String((err && err.message) || err)
  }
  return r && r.isPlaced === false ? 'The AskerDo pane waits to be drawn: ' + r.reason + '.' : 'Opened the AskerDo pane on ' + TAB_NAMES[tab] + '.'
}

/* Home's activity, this project's (own) or every project's once the filter has
   words (all), each read once per store change; the filter itself works on what was read. */
type FeedRead = { mark?: string; lines?: any[]; wsNames?: Record<string, string>; error?: string }
const feed: { own?: FeedRead; all?: FeedRead; loading: Record<string, Promise<void> | undefined> } = { loading: {} }

function feedRead($: any, which: 'own' | 'all'): FeedRead | undefined {
  const have = feed[which]
  const mark = String(band.marker)
  if ((!have || have.mark !== mark) && !feed.loading[which]) {
    feed.loading[which] = (async () => {
      const argv = which === 'own'
        ? ['activity', '--limit', '50', '--places', '--project', await projectDir($), '--json']
        : ['activity', '--limit', '300', '--places', '--json']
      const r = await cli($, argv)
      const lines = r.ok && r.json && Array.isArray(r.json.lines) ? r.json.lines : null
      /* a failed read keeps the lines last read */
      feed[which] = lines ? { mark, lines, wsNames: r.json.wsNames || {} }
        : have && have.lines ? { ...have, mark } : { mark, error: failed('Reading the activity', r) + '.' }
      qpaneRedraw($)
    })().catch(() => {}).finally(() => { feed.loading[which] = undefined })
  }
  return have
}

/* the held track's facts, the local band's numbers over `track mine`'s */
const heldNow = () => heldTrack(band.mine, band.near && band.near.track)

/* the Settings tab's view, and its read through the settings verb, once per store change
   or held track; a write reads again, since with no board nothing on the board moves */
const sview = newSettingsView()
type SettingsRead = { mark?: string; json?: any; error?: string; dir?: string; track?: string }
const sread: { have?: SettingsRead; loading?: Promise<void>; stale?: boolean } = {}
function settingsRead($: any): SettingsRead | undefined {
  const have = sread.have
  const held = heldNow()
  const track = (held && held.id) || ''
  const mark = String(band.marker) + '|' + track
  if ((!have || have.mark !== mark || sread.stale) && !sread.loading) {
    sread.stale = false
    sread.loading = (async () => {
      const dir = await projectDir($)
      const r = await cli($, ['settings', '--json', ...(track ? ['--track', track] : []), '--project', dir])
      const ok = r.ok && r.json && Array.isArray(r.json.rows)
      if (ok) pressesFrom((r.json.rows.find((x: any) => x && x.key === 'answerPresses') || {}).value)
      /* a failed read keeps the rows last read and says so */
      sread.have = ok ? { mark, json: r.json, dir, track }
        : { ...(have && have.json ? have : {}), mark, error: failed('Reading the settings', r) }
      qpaneRedraw($)
    })().catch(() => {}).finally(() => { sread.loading = undefined })
  }
  return have
}

/* the place a write goes as the CLI takes it: the record after the key or value, then --at */
const atArgs = (at?: SettingsPlace) => (!at || at.level === 'pc' ? [] : [...(at.level !== 'default' && at.record ? [at.record] : []), '--at', at.level])
const oneLine = (s: string) => String(s || '').replace(/\s+/g, ' ').trim()
/* a refusal in the verb's own words, without the CLI's prefix */
const refusal = (r: Run) => oneLine(r.err).replace(/^AskerDo: /, '') || 'the CLI failed (exit ' + r.code + ')'
async function settingsWrite($: any, argv: string[], key: string, done: (r: Run) => { text: string; dim?: string }): Promise<void> {
  const have = sread.have || {}
  const dir = have.dir || await projectDir($)
  const r = await cli($, [...argv, ...(have.track ? ['--track', have.track] : []), '--project', dir, '--json'])
  /* a list's add field empties after an add and keeps its words after a refusal; any other field
     goes back to the stored value after a refusal, the refusal line under it */
  const list = (readRows().find((x: any) => x.key === key) || {}).kind === 'texts'
  if (r.ok) {
    /* the session's own save reaches its next prompt even before the board's revision moves */
    rules.loading = undefined
    sview.note = { key, ok: true, ...done(r) }
    delete sview.drafts[key]
    delete sview.at[key]
    if (list) freshField(sview, key)
  } else {
    sview.note = { key, ok: false, text: refusal(r) }
    if (!list) { delete sview.drafts[key]; freshField(sview, key) }
  }
  sread.stale = true
  qpaneRedraw($)
}
const readRows = (): any[] => (sread.have && sread.have.json && sread.have.json.rows) || []
/* where a saved value landed, in the chip's words, and when it takes effect (the row's own sentence) */
function savedWords(key: string, r: Run, unset: boolean): { text: string; dim?: string } {
  const row = readRows().find((x: any) => x.key === key) || {}
  const j = r.json || {}
  const label = row.label || key
  if (j.layer === 'pc') return { text: (unset ? label + ' is back to built-in' : 'Saved') + " in this PC's config.json.", dim: row.takes }
  const copy = key.startsWith('contract.') ? ", and this PC's copy" : ''
  if (unset) {
    if (j.removed === false) return { text: label + ' is built in already.', dim: row.takes }
    const now = j.now || {}
    const from = now.layer && now.layer !== 'built-in' ? 'now set on ' + now.profile + ' at ' + now.record : 'now built in'
    return { text: label + ' removed from ' + j.profile + '; ' + from + copy + '.', dim: row.takes }
  }
  const at = sview.at[key]
  const place = ((row.places || []) as any[]).find((p: any) => (at ? p.level === at.level && (p.record || null) === (at.record || null) : p.level === row.layer))
  const where = place && place.scope ? place.scope + ', ' : ''
  return { text: 'Saved ' + where + 'on ' + j.profile + (j.created ? ', a new profile' : '') + copy + '.', dim: row.takes }
}
function settingsActions($: any): any {
  return {
    redraw: () => qpaneRedraw($),
    set: (key: string, value: string, at?: SettingsPlace) => {
      void settingsWrite($, ['settings', 'set', key, value, ...atArgs(at)], key, (r) => savedWords(key, r, false)).catch(() => {})
    },
    unset: (key: string, at?: SettingsPlace) => {
      void settingsWrite($, ['settings', 'unset', key, ...atArgs(at)], key, (r) => savedWords(key, r, true)).catch(() => {})
    },
    /* a rule line rides a profile: added or dropped (switched off) on the home profile, which the
       verb holds on default in the same write, or cleared from the profile it is on */
    rule: (op: 'add' | 'clear' | 'drop', profile: string, slug: string, text?: string, audience?: string) => {
      const argv = ['settings', 'rule', op, slug, ...(op === 'add' ? ['--text', String(text || ''), ...(audience && audience !== 'both' ? ['--for', audience] : [])] : []),
        ...(op === 'clear' ? ['--profile', profile] : []), '--json']
      void (async () => {
        const json = (sread.have && sread.have.json) || {}
        /* a clear of a dropped line is its Bring back */
        const back = op === 'clear' && ((json.drops || []) as string[]).includes(slug)
        const r = await cli($, argv)
        const on = (r.json && r.json.profile) || profile
        const takes = (((json.lists || []) as any[]).find((l: any) => l.key === 'rules.add') || {}).takes
        sview.note = !r.ok ? { key: 'rules.add', ok: false, text: refusal(r) }
          : { key: 'rules.add', ok: true, text: 'Rule ' + slug + (op === 'add' ? ' added to ' : op === 'drop' ? ' dropped on ' : back ? ' brought back on ' : ' removed from ') + on + '.', dim: takes }
        /* an add empties the form; a refused one keeps the words typed */
        if (r.ok && op === 'add') { sview.line = { slug: '', text: '', for: 'both' }; freshField(sview, 'rules.add') }
        sread.stale = true
        qpaneRedraw($)
      })().catch(() => {})
    },
  }
}

/* the Guide tab's index, read once from the plugin root this mod runs from, so it
   matches the installed version the links point at */
const guide: { pages?: GuidePage[]; loading?: Promise<void> } = {}
const guideRoot = ($: any) => rootPath($, '').replace(/\/$/, '')
async function guideFile($: any, page: string): Promise<string | undefined> {
  try { const t = await $.fs.read(guideRoot($) + '/' + page); return typeof t === 'string' ? t : String(t) } catch { return undefined }
}
function guideRead($: any): GuidePage[] | undefined {
  if (!guide.pages && !guide.loading) {
    guide.loading = (async () => {
      const root = guideRoot($)
      let names: string[] = []
      try { names = ((await $.fs.list(root + '/docs/guide')) || []).filter((e: any) => e && e.kind === 'file' && /\.md$/i.test(e.name)).map((e: any) => 'docs/guide/' + e.name) } catch {}
      /* the pages the README links stand in the index even where the host refuses a listing */
      const readme = await guideFile($, GUIDE_HOME)
      for (const m of String(readme || '').matchAll(/docs\/guide\/[\w.-]+\.md/g)) if (!names.includes(m[0])) names.push(m[0])
      const all = [GUIDE_HOME, ...names]
      const texts = [readme, ...await Promise.all(names.map((f) => guideFile($, f)))]
      const read = all.map((_, i) => typeof texts[i] === 'string')
      guide.pages = guideIndex(all.filter((_, i) => read[i]), texts.filter((_, i) => read[i]))
      qpaneRedraw($)
    })().catch(() => {}).finally(() => { guide.loading = undefined })
  }
  return guide.pages
}

function pressed($: any, act: () => void): () => void {
  return () => {
    act()
    try { $.ui.invalidate('ui.render') } catch {}
  }
}
/* the desktop puts the focus back, after each draw, on the button with the pressed key, and
   that focus raises its card wherever the pointer is; so a desktop press redraws its button under
   the other of two keys, the focus falls off the band and typing goes to the prompt */
const HAND = '~'
const handed = new Set<string>()
const baseKey = (k: string) => (k.endsWith(HAND) ? k.slice(0, -HAND.length) : k)
/* a fold ring's press too, in a pane or a reply's card: the focus put back on it would
   turn :focus-visible at the next key down, and the app's focus shadow draw a second ring round it */
const RING_PRESS = /^c?unfold-/
function handOff(e: any): void {
  if (e.plugin !== PLUGIN || e.surface !== 'desktop' || typeof e.element !== 'string') return
  const k = baseKey(e.element)
  if (e.component !== 'AbovePrompt' && e.component !== 'PromptHint' && !RING_PRESS.test(k)) return
  if (handed.has(k)) handed.delete(k)
  else handed.add(k)
}
/* rings: a pane or a reply, where only the fold rings' presses hand off */
function handedKeys(n: any, surface: string, rings = false): any {
  if (surface !== 'desktop' || !handed.size || !n || typeof n !== 'object') return n
  const kids = Array.isArray(n.children) ? n.children.map((c: any) => handedKeys(c, surface, rings)) : n.children
  const k = n.type === 'Button' && n.props && n.props.key
  const props = typeof k === 'string' && handed.has(k) && (!rings || RING_PRESS.test(k)) ? { ...n.props, key: k + HAND } : n.props
  return { ...n, props, ...(Array.isArray(n.children) ? { children: kids } : {}) }
}

/* The band's model and presses, one set for the band over the prompt and Home's copy. */
function bandParts($: any): { model: any; answer: (q: any, a: any) => void; open: (q?: any) => void; submit: () => void; send: () => void; press: (c: any, p: any) => void; fold: { open: boolean; toggle: () => void } } {
  void queueRead($).catch(() => {})
  return {
    /* the questions this session keeps draw ahead of the board's; the queued count beside what waits */
    model: withWaiting(withPresses(withChipStates(withLocal(band.model, localOpen(), mem.id), answers.chips)), { inbox: band.inbox, closed: closedLine(closedAs(mem.id), savedHere()), saved: savedHere().length > 0,
      queued: answerQueue.items.size }),
    press: (c: any, p: any) => pressed($, () => { void bandCall($, c, p) })(),
    fold: { open: callFold.open, toggle: pressed($, () => { callFold.open = !callFold.open }) },
    answer: (q: any, a: any) => pressed($, () => { void bandAnswer($, q, a) })(),
    open: (q?: any) => pressed($, () => { void openPane($, 'questions', q && q.id).catch(() => {}) })(),
    submit: pressed($, () => { void submitWaiting($).catch(() => {}) }),
    send: pressed($, () => { void sendQueued($).catch(() => {}) }),
  }
}

/* this PC's name from the local board's read and the held track, for the chips */
const hereNow = () => ({ pc: (band.near && band.near.here && band.near.here.pc) || '', track: (heldNow() || {}).id || '' })

/* The status row's presses: the guard, the shelf count (Tracks), the AskerDo opener (Home)
   and the agents count (Home with its agents unfolded). */
function statusPresses($: any): { guard: () => void; shelf: () => void; home: () => void; questions: () => void; agents: () => void } {
  return {
    guard: pressed($, guardToggle($)),
    shelf: pressed($, () => { void openPane($, 'tracks', undefined, true).catch(() => {}) }),
    home: pressed($, () => { void openPane($, 'home', undefined, true).catch(() => {}) }),
    /* the mark pins the first question from elsewhere, as its hover lists them (blockers first, then oldest) */
    questions: pressed($, () => { void openPane($, 'questions', (awayRows()[0] || {}).id, true).catch(() => {}) }),
    agents: pressed($, () => { agentsOpen($, true); void openPane($, 'home', undefined, true).catch(() => {}) }),
  }
}

/* each pane section's fold, read once from $.store and saved there on every press;
   with nothing saved Parked is shut and every other section open. The saved `agentsOpen` still
   says Agents' fold until a press saves the new key. */
type FoldKey = 'graph' | 'agents' | 'pickup' | 'elsewhere' | 'parked'
const FOLD_KEYS: FoldKey[] = ['graph', 'agents', 'pickup', 'elsewhere', 'parked']
const folds: { open: Record<FoldKey, boolean>; ready?: Promise<void>; read: boolean; early: boolean; pressed: Set<FoldKey> } = {
  open: { graph: true, agents: true, pickup: true, elsewhere: true, parked: false }, read: false, early: false, pressed: new Set(),
}
/* the one read; a press made before it came back stands, and a draw that did not wait redraws */
function foldRead($: any): Promise<void> {
  if (!folds.ready) {
    folds.ready = (async () => {
      let moved = false
      try {
        const [kept, agents] = await Promise.all([$.store.get('folds'), $.store.get('agentsOpen')])
        const was = { ...(typeof agents === 'boolean' ? { agents } : {}), ...(kept && typeof kept === 'object' ? kept : {}) }
        for (const key of FOLD_KEYS) {
          if (typeof was[key] === 'boolean' && !folds.pressed.has(key) && folds.open[key] !== was[key]) { folds.open[key] = was[key]; moved = true }
        }
      } catch {}
      folds.read = true
      if (moved && folds.early) qpaneRedraw($)
    })()
  }
  return folds.ready
}
/* the pane's draw waits for the read, so a restart draws the saved folds first; a store that never answers still draws */
const FOLD_WAIT_MS = 150
function foldsReady($: any): Promise<void> {
  if (folds.read) return Promise.resolve()
  return new Promise<void>((done) => {
    let timer: any
    try { timer = $.clock.after(FOLD_WAIT_MS, done) } catch { done() }
    void foldRead($).then(() => {
      try { if (timer) timer.cancel() } catch {}
      done()
    })
  })
}
function foldOpen($: any, k: FoldKey): boolean {
  if (!folds.read) folds.early = true
  void foldRead($)
  return folds.open[k]
}
/* written after the read, so an early press never saves the defaults over the other saved folds */
function foldSet($: any, k: FoldKey, open: boolean): void {
  folds.open[k] = open
  folds.pressed.add(k)
  void foldRead($).then(() => $.store.set('folds', { ...folds.open })).catch(() => {})
  qpaneRedraw($)
}
/* the status row's agents count opens Home with the agents unfolded */
function agentsOpen($: any, open: boolean): void {
  foldSet($, 'agents', open)
}

/* One draw for the pane's id and the two before it. */
async function paneDraw($: any, e: any): Promise<any> {
  const els = $.ui.resolve(e)
  /* the old threads pane's id draws the Tracks tab */
  if (!view.chosen && e.requestId !== PANE_ID) view.tab = e.requestId === 'askerdo-questions' ? 'questions' : 'tracks'
  if (view.seeded !== view.tab) { seedFields(); view.seeded = view.tab }
  if (!band.loaded) {
    startPoll($)
    kick($)
    void foldRead($)
    return view.tab === 'tracks' ? paneLoading(els) : questionsLoading(els)
  }
  if (view.tab !== 'questions') await foldsReady($)
  /* a pane the app restored opens without an opener */
  if (!where.paneRead) { where.paneRead = true; void readWhere($).catch(() => {}) }
  const now = Date.now()
  const cols = e.props.bodyColumns
  const surface = e.surface
  /* the title fits the width of every draw, retitled only when the fitted text changes */
  if (e.requestId === PANE_ID && Number.isFinite(cols) && cols !== where.cols) {
    const was = paneTitle(where.now, where.cols)
    where.cols = cols
    if (paneTitle(where.now, cols) !== was) void retitle($).catch(() => {})
  }
  const here = hereNow()
  const qm = questionsModel({ questions: questionCards(), more: band.more, sid: mem.id, now, local: band.local, here })
  const near = band.near || {}
  /* the tab's model from the band's reads */
  const tm = tracksView({ mine: band.mine, graph: band.graph, shelfRows: band.shelf, handoffs: near.handoffs, asks: near.asks, hand: band.hand, now,
    offline: band.model && band.model.offline, others: shelfGraphs($), local: band.local })
  let body: any
  if (view.tab === 'questions') {
    const act = cardActions($, (id: string, letter: string, version?: number) => { void qpanePick($, id, letter, version).catch(() => {}) },
      (verb, id) => { void qpaneEnd($, verb, id).catch(() => {}) })
    qpaneTick($)
    const pin = pinnedOf(qm, qpane).pinned
    if (pin) void fullCard($, pin.id).catch(() => {})
    body = questionsTree(els, qm, qpane, act, cols, { at: band.at, now }, surface)
  } else if (view.tab === 'tracks') {
    const tview: PaneView = { parked: foldOpen($, 'parked'), pickup: foldOpen($, 'pickup'), elsewhere: foldOpen($, 'elsewhere') }
    body = paneTree(els, tm, tview, {
      copy: (id: string, command: string, name: string, from?: string) => { void paneCopy($, tm, id, command, name, from || surface).catch(() => {}) },
      resume: (id: string, takeOver: boolean) => { void paneResume($, id, takeOver).catch(() => {}) },
      ask: (qid: string) => { void openPane($, 'questions', qid).catch(() => {}) },
      fold: (k: string) => { if ((FOLD_KEYS as string[]).includes(k)) foldSet($, k as FoldKey, !foldOpen($, k as FoldKey)) },
    }, cols, surface)
  } else if (view.tab === 'guide') {
    const pages = guideRead($)
    const error = pages && !pages.length ? 'The guide is not in this install (' + guideRoot($) + ').' : undefined
    body = guideTree(els, { pages, error, version: ownVersion($), repo: own.repo }, surface === 'desktop')
  } else if (view.tab === 'settings') {
    const read = settingsRead($)
    const held = heldNow()
    body = settingsTree(els, { json: read && read.json, error: read && read.error, track: held && held.id ? { id: held.id, name: held.name } : null,
      project: read && read.dir ? whereParts(read.dir).name : undefined }, sview, settingsActions($), cols, surface)
  } else {
    const b = bandParts($)
    /* the copy draws no hover cards; the dock pane does not lift them, so they would draw empty.
       the arrow unfolds them under the row instead; an answered question folds away */
    const open = new Set([...((b.model && b.model.questions) || []).map((q: any) => q.id), ...((b.model && b.model.calls) || []).map((c: any) => c.key)])
    for (const id of view.unfolded) if (!open.has(id)) view.unfolded.delete(id)
    const unfold = {
      open: (id: string) => view.unfolded.has(id),
      toggle: (id: string) => { if (!view.unfolded.delete(id)) view.unfolded.add(id); qpaneRedraw($) },
    }
    /* the copy's border and padding: a cell each on the terminal; the desktop's round border is
       1 px a side, so the padding's two cells and under one more */
    const inside = Number.isFinite(cols) ? cols - (surface === 'desktop' ? 3 : 4) : undefined
    const ours = b.model && bandTree(els, b.model, b.answer, { columns: inside, now, surface, open: b.open, submit: b.submit, send: b.send, cards: false, unfold, press: b.press, fold: b.fold })
    const sm = statusOf($)
    /* the guard's press under its own name, so `guard` below is still the guard's state */
    const { guard: guardTap, shelf, agents: openAgents } = statusPresses($)
    const status = sm ? statusTree(els, sm, null, { columns: inside, surface, guard: guardTap, shelf, agents: openAgents, wrap: true, cards: false }) : null
    const wide = !!view.filter.trim()
    const read = feedRead($, wide ? 'all' : 'own')
    /* the board on the LAN is plain http, which the desktop does not open, so a row's page
       goes through the local server's sign-in route, as the tray console's does */
    const viaLocal = (r: any) => (r.heading ? r : { ...r, href: recordHref(band.local, r.key || r.id, r.href) })
    const rows = read && read.lines ? feedRows(read.lines, { filter: view.filter, now, wsNames: read.wsNames }).map(viaLocal) : null
    const openQ = new Set(qm.cards.map((c: any) => c.id))
    const openRow = (r: any) => (r.kind === 'question' && openQ.has(r.id) ? () => { void openPane($, 'questions', r.id).catch(() => {}) } : null)
    /* drawn for the width this draw reports, so a pane dragged wider draws more columns */
    let gm: any
    try {
      gm = homeGraph({ graph: band.graph, mine: band.mine, shelf: band.shelf, local: !!band.near, scope: view.graph, columns: cols, draw: surface === 'desktop' })
    } catch {
      gm = { scope: view.graph, lines: [], off: [], why: 'The picture could not be drawn from what the local board holds.' }
    }
    const graph = graphTree(els, gm, (s: string) => { view.graph = s; qpaneRedraw($) }, surface,
      { open: foldOpen($, 'graph'), toggle: () => foldSet($, 'graph', !foldOpen($, 'graph')), line: standLine(heldNow(), gm), columns: cols })
    const am = agentsModel(flightList(), guard.state, Date.now())
    const agents = am ? agentsTree(els, am, foldOpen($, 'agents'), () => foldSet($, 'agents', !foldOpen($, 'agents')), surface, cols,
      { open: view.done, toggle: () => { view.done = !view.done; qpaneRedraw($) } }) : null
    body = homeTree(els, [ours, status], { rows, filter: view.filter, seed: view.filterSeed, wide, error: read && read.error }, (v: string) => {
      view.filter = String(v || '')
      qpaneRedraw($)
    }, surface, cols, graph, agents, openRow, versionWords(ownVersion($), band.near && band.near.boardVersion), () => { view.tab = 'guide'; view.chosen = true; qpaneRedraw($) })
  }
  const counts = { questions: qm.cards.length + (qm.more || 0), tracks: tm.total }
  /* the board link follows the tab: Questions this project's Needs you, Home and Tracks the board's overview */
  const link = view.tab === 'questions' ? band.url : (band.views && band.views[view.tab === 'settings' || view.tab === 'guide' ? 'home' : view.tab]) || band.url
  return handedKeys(askerdoPane(els, view.tab, counts, cardHref(link) || undefined, (t: PaneTab) => {
    view.tab = t
    view.chosen = true
    qpaneRedraw($)
  }, body, surface), surface, true)
}

/* the pane's card keeps the beside mark its telling carried. Then every open
   question from elsewhere, answered here: the band read's row, the record whole once pinned */
function questionCards(): any[] {
  const beside = new Map<string, string[]>()
  for (const q of told.values()) if (q && q.id && Array.isArray(q.beside)) beside.set(q.id, q.beside)
  const own = [...localOpen(), ...(band.questions || [])]
  const ids = new Set(own.map((q: any) => q && q.id))
  const away = awayRows().filter((q: any) => !ids.has(q.id)).map((q: any) => {
    const f = awayFull.get(q.id)
    return f && f.version === q.version ? { ...f.record, track: q.track, trackName: q.trackName, pc: q.pc, asker: f.record.session || null, session: null, away: true } : { ...q, away: true }
  })
  return [...own, ...away].map((q: any) => beside.has(q.id) ? { ...q, beside: beside.get(q.id) } : q)
}

const awayRows = (): any[] => ((band.elsewhere && band.elsewhere.questions) || []).filter((q: any) => q && q.id)
/* a pinned question from elsewhere, read whole by the version its row carries */
const awayFull: Map<string, { version?: number; record: any }> = new Map()
const awayReading = new Set<string>()

function paneNote($: any, text: string): void {
  toast($, text, 'press')
}

/* What /askerdo resume TR-n does. Not through $.command.run: a press's own plugin is
 * left out of that chain (measured: no implementation); resumeCmd hands the model the
 * kickoff on both paths (a turn when idle, else a row). */
async function paneResume($: any, id: string, takeOver = false): Promise<void> {
  const text = await resumeCmd($, { sub: 'resume', track: id, ...(takeOver ? { move: 'take over' } : {}) })
  paneNote($, text.split(/\r?\n/)[0])
  await refresh($)
}

/* holding a track, a tile's press puts the resume command on the clipboard of the
   surface pressed; the toast says so, or gives the command to type when the copy did not take */
async function paneCopy($: any, tm: any, id: string, command: string, name: string, surface?: string): Promise<void> {
  const t = [tm.held, ...tm.pickup, ...tm.elsewhere, ...tm.parked].find((x: any) => x && x.id === id)
  const p = t && t.press && t.press.kind === 'copy' ? t.press : null
  let copied = false
  try { copied = !!(await $.ui.copy({ text: command, ...(surface ? { surface } : {}) })).isCopied } catch {}
  paneNote($, copied ? (p ? p.copied : 'Copied: paste it into a new session to pick up ' + name + '.')
    : p ? p.failed : 'Could not copy: type ' + command + ' in a new session.')
}

/* the band carries one workstream's map; the tab reads every other shelf workstream's
   once per store change while the pane draws, so each card counts from a map and the tracks
   other sessions run there are named (all of them, holding or not) */
const farMaps: { mark?: string; list: any[]; loading?: boolean } = { list: [] }
function shelfGraphs($: any): any[] {
  const mark = String(band.marker)
  if (farMaps.mark !== mark && !farMaps.loading) {
    farMaps.loading = true
    const own = new Set([band.graph && band.graph.workstream, band.mine && band.mine.held && band.mine.workstream].filter(Boolean))
    const wss = [...new Set((band.shelf || []).map((r: any) => r && r.workstream).filter((w: any) => w && !own.has(w)))] as string[]
    void (async () => {
      const list: any[] = []
      for (const ws of wss) {
        const g = await localGet($, 'graph/' + encodeURIComponent(ws))
        if (g && g.view) list.push({ workstream: ws, view: g.view })
      }
      const had = farMaps.list.length
      farMaps.list = list
      farMaps.mark = mark
      if (list.length || had) qpaneRedraw($)
    })().catch(() => {}).finally(() => { farMaps.loading = false })
  }
  return farMaps.list
}

/* ---- the Questions tab ----------------------------------------- */

/* What the person unfolded, typed, expanded and asked about: the tab's own, kept across redraws. */
const qpane: QuestionsView = { unfolded: new Set(), notes: {}, drawn: {}, strip: {}, queued: {}, confirm: true }

/* a field moved or mounted afresh is drawn with the words typed so far; a cleared note
   leaves both copies */
function noteSeed(id: string): void { qpane.drawn![id] = qpane.notes[id] || '' }
function noteGone(id: string): void { delete qpane.notes[id]; delete qpane.drawn![id] }
/* the pane's fields mount afresh on a tab change or an open, so each is drawn with its typed text */
function seedFields(): void {
  qpane.drawn = { ...qpane.notes }
  view.filterSeed = view.filter
  sview.findSeed = sview.query
}

/* "Answer presses" (answerPresses in this PC's config.json): confirm opens the strip, once records */
function pressesFrom(v: any): void {
  if (v === 'once' || v === 'confirm') qpane.confirm = v !== 'once'
}

/* ---- queued answers ---------------------------------------
   the user's pick and note kept off the board until Send, one per question, saved in this PC's
   data folder by session (scripts/mod-queue.mjs), so a restart keeps them. */
type QueuedAnswer = {
  id: string; letter: string; note: string; version?: number
  /* where it was pressed: the pane, or the card under a reply (its told record's useId and key) */
  site: PressSite; useId?: string; key?: string; local?: boolean
}
/* touched: ids set or dropped before the saved list came back, which that list never undoes */
const answerQueue = {
  items: new Map<string, QueuedAnswer>(),
  touched: new Set<string>(),
  read: undefined as Promise<void> | undefined,
  saving: Promise.resolve() as Promise<unknown>,
  sending: false,
  saveFailed: false,
  list: (): QueuedAnswer[] => [...answerQueue.items.values()],
}
function queueSet($: any, q: QueuedAnswer): void {
  answerQueue.items.set(q.id, q)
  answerQueue.touched.add(q.id)
  queueMoved($)
}
function queueDrop($: any, id: string): void {
  answerQueue.touched.add(id)
  if (answerQueue.items.delete(id)) queueMoved($)
}
function queueDrawn(): void {
  qpane.queued = Object.fromEntries(answerQueue.list().map((q) => [q.id, { letter: q.letter }]))
}
function queueMoved($: any): void {
  queueDrawn()
  qpaneRedraw($)
  void queueSave($).catch(() => {})
}

async function queueRun($: any, verb: 'read' | 'write', stdin?: string): Promise<any> {
  const sid = await sessionId($)
  const old = oldIds(sid)
  const r = await spawn($, ['node', $.plugin.root + '/scripts/mod-queue.mjs', verb, '--session', sid, ...(old.length ? ['--lineage', old.join(',')] : []), '--json'],
    { timeoutMs: 15000, ...(stdin === undefined ? {} : { stdin }) })
  if (r.exitCode !== 0) return null
  try { return JSON.parse(String(r.stdout || '')) } catch { return null }
}

/* read once per mod start (session.start, else the first draw) */
function queueRead($: any): Promise<void> {
  if (!answerQueue.read) {
    answerQueue.read = (async () => {
      const j = await queueRun($, 'read').catch(() => null)
      let moved = false
      for (const a of (j && Array.isArray(j.answers) ? j.answers : [])) {
        if (!a || typeof a.id !== 'string' || typeof a.letter !== 'string' || answerQueue.touched.has(a.id)) continue
        answerQueue.items.set(a.id, { ...a, note: String(a.note || '') })
        moved = true
      }
      if (moved) { queueDrawn(); qpaneRedraw($) }
    })()
  }
  return answerQueue.read
}

/* one write at a time, each the whole list, after the read so it never writes over what was saved */
function queueSave($: any): Promise<void> {
  const run = answerQueue.saving.then(async () => {
    await queueRead($)
    const ok = !!(await queueRun($, 'write', JSON.stringify(answerQueue.list())).catch(() => null))
    if (!ok && !answerQueue.saveFailed) toast($, 'Your queued answers could not be saved on this PC; they stay queued until this session ends.', 'press')
    answerQueue.saveFailed = !ok
  })
  answerQueue.saving = run.catch(() => {})
  return run
}

/* Send records each queued answer with its note and drawn version (a kept label in its own
   path), then delivers them together: one turn here, the owner's inbox elsewhere. One answered,
   dropped or reworded meanwhile is not recorded and drops; a failed one stays queued. */
async function sendQueued($: any): Promise<void> {
  if (answerQueue.sending) return
  answerQueue.sending = true
  qpaneRedraw($)
  try {
    await queueRead($)
    const list = answerQueue.list()
    if (!list.length) return
    const before = await waitRead($, 'state')
    const sent: string[] = [], dropped: string[] = [], kept: string[] = []
    let here = false
    for (const q of list) {
      const tok = token(q.id, q.letter)
      const r = await pressAnswer($, q.id, q.letter, () => recordAnswer($, q.key || q.id, q.letter, q.site, q.note || undefined, q.id, q.version, true), false)
      if (!r) continue
      if (r.ok && !r.stood) {
        sent.push(r.text)
        if (r.owned) here = true
        queueDrop($, q.id)
        noteGone(q.id)
        if (q.useId && !q.local) await cardSent($, q.useId, token(q.id, r.pick || q.letter))
      } else if (r.ok || r.gone) {
        dropped.push('Your queued ' + tok + ' was not recorded and left the queue: ' + failWhy(r.text))
        queueDrop($, q.id)
      } else kept.push(tok + ' (' + failWhy(r.text).replace(/[.]$/, '') + ')')
    }
    if (here) await deliverAsked($, before, 'pane')
    const n = sent.length
    const said = [n ? 'Sent ' + n + (n === 1 ? ' answer.' : ' answers.') : '', ...sent, ...dropped,
      kept.length ? 'Still queued, not recorded: ' + kept.join(', ') + '; press Send again.' : ''].filter(Boolean)
    if (said.length) toast($, said.map((t) => (/[.!?]$/.test(t) ? t : t + '.')).join(' '), 'press')
    await refresh($)
  } finally {
    answerQueue.sending = false
    qpaneRedraw($)
  }
}

/* a failed answer's reason without its "Answering Q-n failed" lead */
const failWhy = (text: string): string => text.replace(/^Answering \S+ failed: /, '')

/* the card under a reply follows a sent answer, as its own press does */
async function cardSent($: any, useId: string, tok: string): Promise<void> {
  await loadTold($)
  const t = told.get(useId)
  if (!t || t.answered) return
  t.answered = tok
  await keepTold($, useId, t)
}

/* The surfaces the band was drawn on: a desktop draws it from its first frame. */
const drawnOn = new Set<string>()

function deskRing(): string | undefined {
  if (!band.loaded || !drawnOn.has('desktop')) return undefined
  return ringKey(questionsModel({ questions: questionCards(), more: band.more, sid: mem.id, now: Date.now(), local: band.local }), qpane)
}

/* the pane head's "updated 5m ago" stays true while the pane is up. */
const qtick: { timer?: any } = {}
function qpaneTick($: any): void {
  if (qtick.timer) return
  try {
    qtick.timer = $.clock.every(60000, () => {
      void Promise.resolve($.ui.panes()).then((ps: any) => {
        if (view.tab === 'questions' && Array.isArray(ps) && ps.some((p: any) => p.id === PANE_ID || OLD_PANE_IDS.includes(p.id))) return qpaneRedraw($)
        try { qtick.timer.cancel() } catch {}
        qtick.timer = undefined
      }).catch(() => {})
    })
  } catch {}
}

function qpaneRedraw($: any): void {
  try { $.ui.invalidate('ui.render') } catch {}
}

/* The band's answer path, with the card's note. */
async function qpanePick($: any, id: string, letter: string, version?: number): Promise<void> {
  const note = (qpane.notes[id] || '').trim()
  const r = await pressAnswer($, id, letter, () => recordAnswer($, id, letter, 'pane', note || undefined, undefined, version))
  if (!r) return
  if (r.ok) { noteGone(id); queueDrop($, id) }
  await refresh($)
}

/* the pinned card's drop, snooze and typed answer; the card then leaves. */
async function qpaneEnd($: any, verb: 'drop' | 'snooze' | 'answer', id: string): Promise<void> {
  const words = (qpane.notes[id] || '').trim()
  const r = await cardEnd($, verb, id, words, 'pane')
  toast($, r.text, 'press')
  if (!r.ok) return
  noteGone(id)
  if (qpane.expanded === id) qpane.expanded = undefined
  if (qpane.focus === id) qpane.focus = undefined
  await refresh($)
}

/* Both cards' three ends; an empty field records nothing and says what to write. */
async function cardEnd($: any, verb: 'drop' | 'snooze' | 'answer', id: string, words: string, site: PressSite, shown?: string): Promise<{ ok: boolean; text: string }> {
  if (verb === 'snooze' && !words) return { ok: false, text: SNOOZE_HOW }
  if (verb === 'answer' && !words) return { ok: false, text: 'Type your answer in the field, then press Answer or Enter.' }
  if (verb === 'answer') return recordAnswer($, id, '', site, words, shown)
  return recordEnd($, verb, id, words, site, shown)
}

/* $.prompt.submit queues while a turn runs and starts its own once idle. */
function qpaneAsk($: any, tok: string): void {
  try { void $.prompt.submit({ text: askPrompt(tok), asUser: true }).catch(() => {}) } catch {}
}

/* a row past the band's six is the listing's; pinned, it is read whole. */
async function fullCard($: any, id: string): Promise<void> {
  const rows = awayRows()
  for (const k of awayFull.keys()) if (!rows.some((q: any) => q.id === k)) awayFull.delete(k)
  const away = (band.questions || []).some((q: any) => q.id === id) ? null : rows.find((q: any) => q.id === id)
  if (away) {
    const f = awayFull.get(id)
    if ((f && f.version === away.version) || awayReading.has(id)) return
    awayReading.add(id)
    try {
      const r = await cli($, ['show', id, '--json'])
      if (r.ok && r.json) { awayFull.set(id, { version: away.version, record: r.json }); qpaneRedraw($) }
    } finally { awayReading.delete(id) }
    return
  }
  const at = (band.questions || []).findIndex((q: any) => q.id === id && q.lean)
  if (at < 0) return
  const r = await cli($, ['show', id, '--json'])
  const qs = band.questions || []
  if (r.ok && r.json && qs[at] && qs[at].id === id) { qs[at] = r.json; qpaneRedraw($) }
}

/* The card's view writes, one set for the pane and the first telling. `where`: what a queued
   answer keeps of its card, with the version a reply's card answers by. */
type CardWhere = { site: PressSite; useId?: string; key?: string; local?: boolean; version?: number }
function cardActions($: any, pick: QuestionsActions['pick'], end: QuestionsActions['end'], where: CardWhere = { site: 'pane' }): QuestionsActions {
  return {
    /* Answer now, or a press on at once: the strip closes as it records */
    pick: (id, letter, version) => { delete (qpane.strip as any)[id]; noteSeed(id); pick(id, letter, version) },
    end,
    strip: (id: string, letter?: string) => {
      if (letter) (qpane.strip as any)[id] = letter
      else delete (qpane.strip as any)[id]
      noteSeed(id)
      qpaneRedraw($)
    },
    queue: (id: string, letter: string, version?: number) => {
      const { version: drawn, ...at } = where
      queueSet($, { id, letter, note: (qpane.notes[id] || '').trim(), version: 'version' in where ? drawn : version, ...at })
      delete (qpane.strip as any)[id]
      noteSeed(id)
      qpaneRedraw($)
    },
    unqueue: (id: string) => { queueDrop($, id); delete (qpane.strip as any)[id]; noteSeed(id); qpaneRedraw($) },
    send: () => { void sendQueued($).catch(() => {}) },
    ask: (id: string, tok: string) => { qpane.asking = undefined; qpaneAsk($, tok); qpaneRedraw($) },
    asking: (id: string) => { qpane.asking = qpane.asking === id ? undefined : id; qpaneRedraw($) },
    toggle: (tok: string) => {
      if (qpane.unfolded.has(tok)) qpane.unfolded.delete(tok)
      else qpane.unfolded.add(tok)
      qpaneRedraw($)
    },
    note: (id: string, value: string) => { qpane.notes[id] = value },
    expand: (id: string) => { qpane.expanded = id; qpaneRedraw($); void fullCard($, id).catch(() => {}) },
    noteFocus: (id: string) => { void Promise.resolve($.ui.focus({ requestId: PANE_ID, key: 'qnote-' + id })).catch(() => {}) },
    /* a press on an answered card says what stands rather than drawing nothing */
    stands: (id, s) => toast($, s.ended || answeredWords(id, s.name, s.answered || ''), 'press'),
  }
}

/* ---- the status line under the prompt ----------------------------- */

/* The context's first figures before any turn has measured it. */
const firstUsage: { asked?: boolean; reading?: any } = {}

/* this PC's plugin version for the mark's card and Home, read once (no seam: it is shown, not compared) */
const own: { asked?: boolean; version?: string; repo?: string } = {}
function ownVersion($: any): string {
  if (!own.asked) {
    own.asked = true
    void Promise.resolve($.fs.read($.plugin.root + '/.claude-plugin/plugin.json')).then((t: any) => {
      const j = JSON.parse(String(t))
      own.version = String(j.version || '')
      /* the Guide tab's links go to the repository the manifest names */
      own.repo = /^https:\/\/github\.com\//.test(String(j.repository || '')) ? String(j.repository) : undefined
      if (own.version) qpaneRedraw($)
    }).catch(() => {})
  }
  return own.version || ''
}

/* The status row's segments: the meters, the guard, the held track and the
   shelf; null before there is any. The first figures are read from here, so a surface with
   no hint line still asks. */
function statusOf($: any): any {
  if (typeof marks.percent !== 'number' && !firstUsage.asked) {
    firstUsage.asked = true
    void Promise.resolve($.session.usage()).then((u: any) => {
      firstUsage.reading = depthReading(u && u.context)
      /* the rings' first figures too, so a cold start's row has its meters before the first load */
      if (!rates.read && u && Array.isArray(u.rateLimits) && u.rateLimits.length) { rates.read = true; rates.list = u.rateLimits }
      if (firstUsage.reading || rates.read) qpaneRedraw($)
    }).catch(() => {})
  }
  const reading = lastReading() || firstUsage.reading
  const now = Date.now()
  const m = statusModel({
    reading, main: guard.state && guard.state.main, rates: rates.list, guard: guard.state,
    thread: heldNow(), hand: band.hand,
    shelf: band.shelf, elsewhere: band.elsewhere, here: { pc: hereNow().pc }, now, agents: flightList(),
    /* what the track's and task's tooltips read beside them */
    graph: band.graph, handoffs: band.near && band.near.handoffs, questions: band.questions, local: band.local,
    version: ownVersion($),
  })
  /* the AskerDo button's card names the folder and branch too */
  const facts = whereFacts(where.now)
  if (m && m.mark && m.mark.card && facts) return { ...m, mark: { ...m.mark, card: { ...m.mark.card, where: facts } } }
  return m
}

const guardToggle = ($: any) => () => { void guardPress($).catch(() => {}) }

/* At the hint line's end, the meters before the first load too (drawn always). A desktop's
   Code tab has no hint line (the band draws it there) and a cloud session no band, so
   the line draws wherever the app asks for it. */
async function statusDraw($: any, e: any, next: any): Promise<any> {
  const m = statusOf($)
  if (!m) return next(e)
  return handedKeys(statusTree($.ui.resolve(e), m, await next(e), { columns: e.viewport && e.viewport.columns, surface: e.surface, ...statusPresses($) }), e.surface)
}

/* ---- tools ------------------------------------------------------------- */

async function askTool($: any, input: any, useId?: string, turnAsks?: string[]): Promise<any> {
  const v = validateAsk(input)
  if (v.error) return { deny: 'ask refused: ' + v.error }
  /* a reversal beside another ask of the turn is flagged, never refused */
  const alone: string[] = turnAsks ? aloneInTurn(v.payload, turnAsks.map((u) => told.get(u))) : []
  const sid = await sessionId($)
  if (v.payload.edits && isLocalId(v.payload.edits)) return localReword($, sid, v.payload, alone, useId, turnAsks)
  if (v.payload.edits) return rewordAsk($, sid, v.payload, alone, useId, turnAsks)
  await boundTrack($, sid)
  /* a session not engaged keeps its question; asking engages nothing. So does a spare */
  if (!(await isEngaged($)) || isSpare(await projectDir($))) return localAsk($, sid, v.payload, alone, useId, turnAsks)
  const payload = await boardPayload($, sid, await boundTrack($, sid, true), v.payload)
  const r = await cli($, ['register', '--json'], JSON.stringify(payload))
  if (!r.ok) return { deny: failed('ask', r) }
  if (useId && r.json && r.json.id) {
    const reverses = r.json.reverses ? { reverses: r.json.reverses, blocking: true } : {}
    const beside = [...new Set([...alone, ...(Array.isArray(r.json.beside) ? r.json.beside : [])])]
    /* the card's head reads the registered ask, its tokens numbered */
    await keepTold($, useId, { ...payload, ...reverses, ...(beside.length ? { beside } : {}), id: r.json.id, key: r.json.key, name: r.json.name || payload.name, ask: r.json.ask || payload.ask, boardUrl: r.json.boardUrl, workstream: r.json.workstream || payload.workstream })
    if (beside.length) {
      await tellBeside($, r.json.id, beside, turnAsks)
      if (!(r.json.beside || []).length) r.json.warnings = [...(r.json.warnings || []), besideSlip(r.json.id, beside).say]
    }
  }
  kick($)
  const letters = (payload.options || []).map((o: any) => o.type).filter((t: string) => /^[a-z]$/.test(t))
  return { result: askResult(r.json, { letters, pick: payload.pick, block: tellBlock({ ...payload, id: r.json.id, name: r.json.name || payload.name, reverses: r.json.reverses }, letters) }) }
}

/* `edits` rewords an open question in place through the CLI, keeping its id.
   It names a board question, so it engages; its earlier tellings go to their changed stub at
   once, and this reply tells the new wording as a first telling does. */
async function rewordAsk($: any, sid: string, raw: any, alone: string[], useId?: string, turnAsks?: string[]): Promise<any> {
  const { edits, ...rest } = raw
  mem.engaged = true
  /* the question keeps its own workstream, track and gates, so none is filled in here */
  const payload: any = { ...rest, session: sid, ...(await projectOf($)) }
  const r = await cli($, ['question', 'edit', edits, '--json'], JSON.stringify(payload))
  if (!r.ok) return { deny: failed('ask (rewording ' + edits + ')', r) }
  const j = r.json || {}
  if (useId && j.id && (j.reworded || []).length) {
    await loadTold($)
    const now = { reworded: { version: j.version } }
    const same = (q: any) => !!q && (j.key ? q.key === j.key : q.id === j.id)
    for (const [u, q] of [...told]) {
      if (u !== useId && same(q) && !changedStub(q) && rewordedSince(q, now)) { q.reworded = now.reworded; await keepTold($, u, q) }
    }
    const reverses = j.reverses ? { reverses: j.reverses, blocking: true } : {}
    await keepTold($, useId, { ...payload, ...reverses, ...(alone.length ? { beside: alone } : {}), id: j.id, key: j.key, name: j.name || payload.name,
      ask: j.ask || payload.ask, boardUrl: j.boardUrl, version: j.version, reworded: now.reworded })
    if (alone.length) await tellBeside($, j.id, alone, turnAsks)
    qpaneRedraw($)
  }
  kick($)
  const letters = (payload.options || []).map((o: any) => o.type).filter((t: string) => /^[a-z]$/.test(t))
  return { result: rewordResult(j, { letters, pick: payload.pick, block: tellBlock({ ...payload, id: j.id, name: j.name || payload.name, reverses: j.reverses }, letters) }) }
}

/* the folder an ask files under; a spare sends none */
async function projectOf($: any): Promise<{ projectDir?: string }> {
  const dir = await projectDir($)
  return isSpare(dir) ? {} : { projectDir: dir }
}

/* The payload as register takes it. Filed under the held track's workstream, as it was
   under the bound thread */
async function boardPayload($: any, sid: string, held: string | null, raw: any): Promise<any> {
  const payload: any = { ...raw, session: sid, ...(await projectOf($)) }
  /* a question kept before the fill still files */
  if (Array.isArray(payload.options)) payload.options = withColumns(payload.options)
  if (!payload.workstream && held && (!payload.track || payload.track === held) && band.mine && band.mine.workstream) payload.workstream = band.mine.workstream
  return payload
}

/* the asks of the turn a reversal was told beside carry its id too, and the turn is flagged */
async function tellBeside($: any, id: string, beside: string[], turnAsks?: string[]): Promise<void> {
  for (const u of turnAsks || []) {
    const q = told.get(u)
    if (q && beside.includes(q.id)) await keepTold($, u, { ...q, beside: [...new Set([...(q.beside || []), id])] })
  }
  flagSlips($, 'this ask', [besideSlip(id, beside)])
}

/* an override request, one round trip like ask; the reply tells its block,
   which the desktop draws as the card under it */
async function overrideTool($: any, input: any, useId?: string, turnAsks?: string[]): Promise<any> {
  const v = overrideArgs(input)
  if (v.error) return { deny: 'override_request refused: ' + v.error }
  mem.engaged = true
  const sid = await sessionId($)
  const r = await cli($, ['override', 'request', '--session', sid, '--json'], JSON.stringify(v.payload))
  if (!r.ok) return { deny: failed('override_request', r) }
  /* the request's page through the local server's signed root, so the browser lands signed in */
  const root = signedRoot(await localBase($))
  const page = r.json && r.json.page ? String(r.json.page).replace(/^\/+/, '') : ''
  const o = overrideTold(r.json, root && page ? root + page : '')
  if (useId) await keepTold($, useId, o)
  /* a reversal told beside a question of the turn, either way round, is flagged as a question is */
  const alone: string[] = turnAsks ? aloneInTurn(o, turnAsks.map((u) => told.get(u))) : []
  if (alone.length) await tellBeside($, 'override #' + o.request, alone, turnAsks)
  kick($)
  const result = overrideResult(o, await userName($))
  return { result: alone.length ? result + '\nNote: ' + besideSlip('override #' + o.request, alone).say : result }
}

/* the card's press saving, by its telling */
const ovPressing = new Map<string, string>()

/* Allow or Keep on the card: the band's press path, as the user's act in the asking session, so its
   turn starts carrying the result; the band's row for the request hides with it */
async function overridePress($: any, useId: string, o: any, decision: string): Promise<void> {
  if (ovPressing.has(useId) || (o.decided && o.decided !== 'changed')) return
  ovPressing.set(useId, decision)
  qpaneRedraw($)
  const row = ((band.model && band.model.calls) || []).find((c: any) => c && c.kind === 'override' && String(c.key).startsWith('override:#' + o.request + '@'))
  const c = { key: row ? row.key : 'override:#' + o.request, id: overrideOn(o), mine: true }
  const p = { label: decision === 'allow' ? 'Allow' : 'Keep', verb: 'overrideDecide', input: { request: o.request, decision } }
  callPresses.set(c.key, 'pending')
  const r = await pressCall($, c, p, 'card').catch((err: any) => ({ ok: false, text: callPressText(c, p, null, String((err && err.message) || err)) }))
  ovPressing.delete(useId)
  /* an expired request, or one gone already, closes the card with nothing applied */
  if (r.ok) { callPresses.set(c.key, 'done'); o.decided = r.result && r.result.dropped ? 'dropped' : decision }
  else {
    callPresses.delete(c.key)
    if (/changed since asked/.test(r.text)) o.decided = 'changed'
    else if (/expired|is waiting: it was decided/.test(r.text)) o.decided = 'dropped'
  }
  await keepTold($, useId, o)
  toast($, r.text, 'press')
  qpaneRedraw($)
  await refresh($)
}

/* A decision pressed elsewhere (the band, another session, typed) reaches the card through the inbox. */
async function overrideHeard($: any, evs: any[]): Promise<void> {
  const heard = evs.map((e: any) => e && e.raw).filter((r: any) => r && r.kind === 'override' && r.decided)
  if (!heard.length) return
  await loadTold($)
  let moved = false
  for (const r of heard) {
    const n = Number(String(r.request || '').replace(/^#/, ''))
    for (const [u, o] of [...told]) {
      if (!o || !o.override || o.request !== n || o.decided === r.decided) continue
      if (o.decided && o.decided !== 'changed') continue
      o.decided = r.decided
      await keepTold($, u, o)
      moved = true
    }
  }
  if (moved) qpaneRedraw($)
}

async function noteTool($: any, input: any): Promise<any> {
  if (!input || !isRecordId(input.id)) return { deny: 'note refused: id is Q-n, WS-n, P-n, T-n, TR-n or K-n' }
  if (typeof input.body !== 'string' || !input.body.trim()) return { deny: 'note refused: body is required' }
  const r = await cli($, ['note', input.id, '--session', await sessionId($), '--json'], input.body)
  return r.ok ? { result: 'Noted on ' + input.id + '.' } : { deny: failed('note', r) }
}

/* an answer the user typed, recorded by the session: a kept label in the mod's store, a
   board question (or a label filed since) on the board with this session's id, kept out of its telling */
async function answerTool($: any, input: any): Promise<any> {
  const a = answerArgs(input)
  if (a.error) return { deny: 'answer refused: ' + a.error }
  let id = a.id
  let shown = a.id
  if (isLocalId(a.id)) {
    const r = await localAnswer($, a.id, a.letter, a.note, null, a.drop, true)
    if (!r.filed) return r.ok ? { result: r.text } : { deny: 'answer refused: ' + r.text }
    id = r.filed.key || r.filed.id
    shown = r.filed.id
  }
  mem.engaged = true
  const sid = await sessionId($)
  const argv = a.drop ? ['drop', id] : ['answer', id, ...(a.letter ? ['--pick', a.letter] : [])]
  if (a.note) argv.push('--note', a.note)
  const r = await queued(() => cli($, [...argv, '--session', sid, '--json']))
  if (!r.ok) return { deny: failed((a.drop ? 'Dropping ' : 'Answering ') + shown, r) }
  kick($)
  const label = (r.json && r.json.id) || shown
  const name = r.json && r.json.name ? ' (' + r.json.name + ')' : ''
  if (a.drop) return { result: 'Dropped ' + label + name + (a.note ? ': ' + a.note : '') + '.' }
  return { result: 'Answered ' + label + name + ': ' + (a.letter ? token(label, a.letter) + '.' + (a.note ? ' Note: ' + a.note : '') : a.note) }
}

/* one call records a ruling with its links; the watcher reads the triggers again */
async function decideTool($: any, input: any): Promise<any> {
  const d = decideArgs(input)
  if (d.error) return { deny: 'decide refused: ' + d.error }
  const r = await cli($, ['decide', '--session', await sessionId($), '--json'], JSON.stringify(d.payload))
  if (!r.ok) return { deny: failed('decide', r) }
  decs.stale = true
  void decisionRows($).catch(() => {})
  return { result: decidedText(r.json || {}) }
}

async function taskTool($: any, input: any): Promise<any> {
  const t = taskEditArgs(input)
  if (t.error) return { deny: 'task_update refused: ' + t.error }
  const sid = await sessionId($)
  /* one board call; starting goes by the track's order, so a task not ready needs a reason */
  const r = await cli($, ['task', 'update', t.id, ...t.args, '--session', sid, '--json'])
  if (!r.ok) return { deny: failed('task_update', r) }
  const j = r.json || {}
  /* the board's `hand` says a take or a let-go in words, as the CLI words it */
  const said = [j.start ? j.start.id + ' in progress' + (j.start.agent ? ', worked by ' + j.start.agent : '') : '',
    j.edit ? editWords({ ...j.edit, hand: j.edit.hand || j.hand }, ' unchanged') : '',
    j.note ? 'noted on ' + t.id : ''].filter(Boolean)
  // a start, status or hand change moves the track's now set and the task the rules are read for
  rules.loading = undefined
  kick($)
  /* a task taken in hand brings its rulings */
  const held = heldDecisionsNote(t.id, j.decisions)
  return { result: (said.join('; ') || t.id + ' unchanged') + (held ? '\n' + held : '') }
}

/* the engine's own reading as the band shows it; nothing is written */
async function depthTool($: any): Promise<any> {
  let reading: any = lastReading()
  if (!reading) { try { reading = depthReading(((await $.session.usage()) || {}).context) } catch {} }
  /* the marks come from the profiles the band's load reads */
  if (guard.state === undefined) await refresh($).catch(() => {})
  const told = await toldMarks($, await sessionId($))
  return { result: depthText({ reading, main: guard.state && guard.state.main, told, name: await userName($) }) }
}

/* A handoff the board did not take comes back whole in the failed result, and the
   turn's reply is checked for it, so a leg is never lost to a board that is down. */
function unwritten(agentId: string | undefined, why: string, input: any, said = ''): any {
  const block = carryBlock(input)
  if (agentId === undefined) checks.carry = block
  return { deny: why + (said ? '\n' + said : '') + '\nThe board did not confirm it, so your reply carries this handoff whole: put this block in it exactly as written, '
    + 'just above the footer, and write it again with handoff_write once the board takes writes, unless a check shows it landed.\n\n' + block }
}

/* the frozen band keeps no load, so it is handed the store's state first: the
   track let go and waiting on the shelf, for the status row and the Tracks tab; the
   board's handoff lets go of every task this session had in hand, so the hand empties too */
function letGo(row: any): void {
  band.mine = { held: false, track: null, workstream: null, tracks: [] }
  band.hand = []
  band.shelf = [...(band.shelf || []).filter((s: any) => s && s.track !== row.track), row]
}

/* the leftovers the board laid out, each with what it waits on */
function laidOutNote(steps: any, track: string): string {
  if (!Array.isArray(steps) || !steps.length) return ''
  return 'Laid out on ' + track + ': ' + steps.map((s: any) => s.id + ' ' + s.name + (s.created ? '' : ' (already there)')
    + (s.runBy ? ', run by ' + s.runBy : '')
    + (s.edges && s.edges.length ? ', after ' + s.edges.map((e: any) => e.on).join(', ') : '')
    + (s.before && s.before.length ? ', before ' + s.before.map((e: any) => e.task).join(', ') : '')).join('; ') + '.'
}

async function handoffTool($: any, input: any, agentId?: string): Promise<any> {
  const user = await userName($)
  const v = validateHandoff(input, { name: user })
  if (v.error) return { deny: 'handoff_write refused: ' + v.error }
  const sid = await sessionId($)
  const held = await boundTrack($, sid, true)
  let track = v.track || held
  const payload: any = { ...v.payload }
  try {
    const d = depthFrom(await $.session.usage())
    if (d) payload.depthAtHandoff = d
  } catch {}
  /* below the window only the user's ask opens a handoff */
  const told = await toldMarks($, sid)
  const gate = handoffGate({ percent: payload.depthAtHandoff && payload.depthAtHandoff.percent,
    main: guard.state && guard.state.main, told, asked: marks.asked || v.asked, name: user })
  if (!gate.open) return { deny: gate.deny }
  /* an ask in chat counts as /askerdo handoff, so the reply check agrees */
  if (v.asked && !marks.asked) await handoffAsked($, sid)
  /* a session holding no track starts one from the focus, in the workstream named */
  let started = ''
  let key = track === held ? mem.trackKey : null
  let name = track === held && band.mine && band.mine.held ? band.mine.name : ''
  let ws = track === held && band.mine && band.mine.held ? band.mine.workstream : v.workstream
  if (!track) {
    if (!v.workstream) return { deny: 'handoff_write refused: this session holds no track; name the track (track: TR-n) or the workstream to start one in (workstream: WS-n)' }
    name = threadNameOf(payload.focus)
    const n = await cli($, ['track', 'new', '--workstream', v.workstream, '--name', name, '--goal', payload.focus, '--session', sid, '--json'])
    if (!n.ok) return unwritten(agentId, failed('Starting a track for the handoff', n), { workstream: v.workstream, ...v.payload })
    track = n.json.id as string
    key = n.json.key || null
    setTrack(track, key)
    started = 'Started ' + track + ' ' + name + ' in ' + v.workstream + '. '
  }
  const wasHeld = track === mem.track
  if (wasHeld) lettingGo(track)
  const r = await cli($, ['handoff', 'write', track as string, '--session', sid, '--json'], JSON.stringify(payload))
  if (!r.ok) {
    keptHold(track)
    /* the board answered no (server/verbs/handoffs.mjs REFUSED), so nothing was written and
       nothing needs carrying; a track started for it stays held, so the next send lands on it */
    if (/the board refused this handoff and wrote nothing/.test(r.err)) {
      if (started) kick($)
      return { deny: 'handoff_write: ' + r.err.replace(/[.\s]+$/, '') + '.\nFix what it names (a leftover: that step) and call handoff_write again; '
        + 'nothing needs carrying in your reply.' + (started ? '\n' + started + 'It stays with this session, so the next handoff_write lands on ' + track + '.' : '') }
    }
    if (!started) return unwritten(agentId, failed('handoff_write', r), { track, ...v.payload })
    /* the track started for it carries nothing, so it is let go */
    lettingGo(track)
    const d = await cli($, ['track', 'drop', track as string, '--reason', 'its first handoff did not write', '--session', sid, '--json'])
    if (!d.ok) {
      keptHold(track)
      return unwritten(agentId, failed('handoff_write', r), { track, ...v.payload }, track + ', started for it, is still held: dropping it failed too (' + (d.err || 'exit ' + d.code) + ').')
    }
    setTrack(null)
    kick($)
    return unwritten(agentId, failed('handoff_write', r), { workstream: v.workstream, ...v.payload }, track + ', started for it, was dropped, so this session holds no track.')
  }
  if (agentId === undefined) checks.carry = undefined
  /* a handoff touches the board, so the band stays engaged once the track is let go */
  mem.engaged = true
  /* the lease goes with the handoff (parked too), so the session holds no track now */
  /* never `letGo`: the shelf's function below */
  const freed = wasHeld && (r.json.released || r.json.status === 'parked')
  if (freed) setTrack(null)
  else keptHold(track)
  await writeMarker($, sid, key)
  /* the track let go, the session's own guard is read again; the freeze below stops the
     band's read, so without this the shield would keep the track's state after a handoff */
  if (freed && key) await markerRun($, sid, null, [])
  band.own = r.json.id
  /* the main loop's waiting handoff of its held track freezes the band; park never */
  if (agentId === undefined && wasHeld && r.json.status === 'waiting') {
    if (r.json.released) letGo({ track: track as string, key, name, workstream: ws || null, state: 'waiting', handoff: r.json.id, handoffStatus: 'waiting',
      focus: payload.focus, created: r.json.created || new Date().toISOString(), age: '', resume: r.json.resume || '/askerdo resume ' + track })
    await keepClosed($, sid, 'handed off')
    try { $.ui.invalidate('ui.render') } catch {}
  }
  toast($, 'Handoff ' + r.json.id + ' written (' + r.json.status + ') on ' + track + '.', 'press')
  const percent = payload.depthAtHandoff ? payload.depthAtHandoff.percent : undefined
  const id = track as string
  void (async () => {
    await sendAlert($, handoffAlert({ name, track: id, id: r.json.id, percent, focus: payload.focus, names: await alertNames($, ws) }))
  })().catch(() => {})
  kick($)
  /* replyCheck reads this turn's reply for the resume block */
  if (agentId === undefined) checks.resume = id
  if (agentId === undefined) keepInbox(id, r.json.inbox)
  /* from here the turn's steps are checked against this handoff */
  if (agentId === undefined) await keepWrote($, { sid, id: r.json.id, track: id, status: r.json.status, turn: mem.turn, held: mem.track || null })
  const folders = folderFlag($, r.json.handoffChecks)
  return {
    result: started + 'Wrote ' + r.json.id + ' (' + r.json.status + ') on ' + id
      + (r.json.superseded && r.json.superseded.length ? ', superseding ' + r.json.superseded.join(', ') : '') + '.'
      + (r.json.released ? ' This session let ' + id + ' go with it.' : '')
      + (laidOutNote(r.json.laidOut, id) ? '\n' + laidOutNote(r.json.laidOut, id) : '')
      + (r.json.leavesLine ? '\n' + r.json.leavesLine : '')
      + inboxText(r.json.inbox)
      + (r.json.warning ? '\nWARNING: ' + r.json.warning : '')
      + (handoffFilesNote(r.json, user) ? '\n' + handoffFilesNote(r.json, user) : '')
      + (folders ? '\n' + folders : '')
      + '\n\nClose your reply with this block exactly as written, just above the footer: never inline and never the kickoff text, which the resume prints.\n\n'
      + resumeBlock(id),
  }
}

/* ---- the handoff kept current ---------------------------------- */

/* The handoff this session's main loop last wrote, the turn that wrote it and the track held
   after it, kept per session in the store so a hot reload still checks it; steps: the main
   loop's tool names this turn. */
type Wrote = { sid: string; id: string; track: string; status: string; turn?: string; held: string | null; gone?: boolean; seen?: boolean }
const current: { wrote?: Wrote | null; read?: string; steps: { tool: string; changes: boolean }[] } = { steps: [] }

async function keepWrote($: any, w: Wrote): Promise<void> {
  current.wrote = w
  current.read = w.sid
  await saveMarks($, w.sid, w, 'liveHandoffs')
}

/* live while it waits or is parked: gone once refused as resumed, or once the session takes a track */
async function liveHandoff($: any): Promise<Wrote | null> {
  const sid = await sessionId($)
  if (current.read !== sid) {
    current.read = sid
    try { current.wrote = ((await $.store.get('liveHandoffs')) || {})[sid] || null } catch { current.wrote = null }
  }
  const w = current.wrote
  if (!w || w.gone || w.sid !== sid) return null
  if (mem.track && mem.track !== w.held) { await keepWrote($, { ...w, gone: true }); return null }
  /* resumed or closed elsewhere: the shelf showed this handoff live, then lost it */
  const row = (band.shelf || []).find((r: any) => r && trackOf(r.track) === trackOf(w.track))
  const shelved = !!row && row.handoff === w.id && ['waiting', 'parked'].includes(row.state)
  if (shelved && !w.seen) await keepWrote($, { ...w, seen: true })
  else if (!shelved && w.seen) { await keepWrote($, { ...w, gone: true }); return null }
  return current.wrote
}

/* the first step that changes state after the live handoff gets the note, once */
async function currencyStep($: any, tool: string, input: any): Promise<void> {
  const live = await liveHandoff($)
  current.steps.push({ tool: stepTool(tool, input), changes: stepChanges(tool, input, live && live.id) })
  const c = handoffCurrency(live, mem.turn, current.steps)
  if (c.note && c.at === current.steps.length - 1) {
    try { await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: c.note }] } }) } catch {}
  }
}

const trackOf = (id: string) => String(id || '').trim().replace(/\.\d+$/, '').toUpperCase()

/* the live handoff patched in place, keeping its id; the ops are checked before any board call */
async function updateTool($: any, input: any): Promise<any> {
  const { track: named, ...patch } = input && typeof input === 'object' && !Array.isArray(input) ? input : ({} as any)
  const bad = [...Object.keys(patch).filter((k) => k !== 'ops').map((k) => 'unknown field "' + k + '"'), ...updateProblems(patch)]
  if (named !== undefined && !(typeof named === 'string' && /^TR-\d+(\.\d+)?$/i.test(named.trim()))) bad.unshift('track is TR-n or TR-n.m')
  if (bad.length) return { deny: 'handoff_update refused: ' + bad.join('; ') }
  const sid = await sessionId($)
  await liveHandoff($)
  const wrote = current.wrote && current.wrote.sid === sid ? current.wrote : null
  const track = (named && named.trim()) || (await boundTrack($, sid)) || (wrote ? wrote.track : '')
  if (!track) return { deny: 'handoff_update refused: this session holds no track and wrote no handoff; name the track (track: TR-n)' }
  const r = await cli($, ['handoff', 'update', track, '--session', sid, '--json'], JSON.stringify({ ops: patch.ops }))
  if (!r.ok) {
    if (!/the board refused this update and changed nothing/.test(r.err)) return { deny: failed('handoff_update', r) }
    /* resumed or closed since: the board names the holder and the note that reaches it */
    if (wrote && !wrote.gone && trackOf(wrote.track) === trackOf(track) && /no longer patched|a closed track/.test(r.err)) await keepWrote($, { ...wrote, gone: true })
    return { deny: 'handoff_update: ' + r.err.replace(/[.\s]+$/, '') + '.' }
  }
  const j = r.json || {}
  kick($)
  const ch = j.changed && typeof j.changed === 'object' ? j.changed : {}
  const said = Object.entries(ch).map(([k, v]) => k + ': ' + v)
  const fails = (Array.isArray(j.verify) ? j.verify : []).filter((v: any) => v && v.ok === false && String(ch.verifyFirst || '').includes(v.path))
  const files = handoffFilesNote(j, await userName($))
  return {
    result: 'Updated ' + j.id + ' (' + j.status + ') on ' + j.track + ' in place, keeping its id: ' + (said.join('; ') || 'nothing changed') + '.'
      + fails.map((v: any) => '\nverify first: ' + v.path + ' FAILS: ' + (v.problems || []).join('; ')).join('')
      + (files ? '\n' + files : ''),
  }
}

/* ---- the depth meter and the agent guard ---------------- */

/* told: the main marks said this session; asked: the user asked for a handoff this
   session (/askerdo handoff or park); percent and window: the last reading; face: what the status line's meter shows */
const marks: { told?: Array<string | number>; asked?: boolean; sid?: string; percent?: number; tokens?: number; window?: number; face?: string; chain?: Promise<void> } = {}

/* the last reading as the band shows it, null before any */
const lastReading = () => (typeof marks.percent === 'number' ? { percent: marks.percent, tokens: marks.tokens, window: marks.window } : null)

/* the rate-limit windows as the engine last reported them; read: the one read at the first load */
const rates: { list?: any[]; read?: boolean } = {}

function setRates($: any, list: any): void {
  if (!Array.isArray(list) || JSON.stringify(list) === JSON.stringify(rates.list)) return
  rates.list = list
  try { $.ui.invalidate('ui.render') } catch {}
}

/* The shield chip's press: the same path as /askerdo guard on and off. */
async function guardPress($: any): Promise<void> {
  const text = await guardCmd($, guard.state && guard.state.on ? 'off' : 'on')
  toast($, text, 'press')
}

async function toldMarks($: any, sid: string): Promise<Array<string | number>> {
  if (marks.told && marks.sid === sid) return marks.told
  let all: any = {}, asked: any = {}
  try { all = (await $.store.get('marks')) || {} } catch {}
  try { asked = (await $.store.get('handoffAsked')) || {} } catch {}
  marks.sid = sid
  marks.told = Array.isArray(all[sid]) ? all[sid] : []
  marks.asked = asked[sid] === true
  return marks.told as Array<string | number>
}

async function saveMarks($: any, sid: string, value: any, key = 'marks'): Promise<void> {
  try {
    const all: any = (await $.store.get(key)) || {}
    delete all[sid]
    all[sid] = value
    const keys = Object.keys(all)
    for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete all[k]
    await $.store.set(key, all)
  } catch {}
}

async function handoffAsked($: any, sid: string): Promise<void> {
  await toldMarks($, sid)
  marks.asked = true
  await saveMarks($, sid, true, 'handoffAsked')
}

/* the band's meter from 30 percent, and one note per mark the model reads;
   one reading at a time, so a measure and a step never tell a mark twice. */
function depthCheck($: any, r: any): Promise<void> {
  if (!r) return Promise.resolve()
  marks.chain = (marks.chain || Promise.resolve()).then(() => depthOnce($, r)).catch(() => {})
  return marks.chain
}

async function depthOnce($: any, r: any): Promise<void> {
  if (r.window) marks.window = r.window
  marks.percent = r.percent
  marks.tokens = r.tokens
  /* the marks and the meter's on/off come from the resolved profiles */
  const main = guard.state && guard.state.main
  /* the window note names the shipped doc where it lies */
  const mk = marksFor(main, await userName($), rootPath($, 'docs/'))
  /* the status line's meter redraws as its whole percent or its marks move */
  const face = JSON.stringify([wholePercent(r), main || null])
  if (face !== marks.face) { marks.face = face; try { $.ui.invalidate('ui.render') } catch {} }
  /* the meter draws, but its handoff notes wait for engagement; a mark passed
     meanwhile is told at the first measure after it */
  if (!(await isEngaged($))) return
  const sid = await sessionId($)
  const told = await toldMarks($, sid)
  const won = main && main.on === false ? [] : marksCrossed(r, told, mk)
  if (!won.length) return
  /* told by kind, so a mark moved since is never told twice */
  marks.told = told.concat(won.map((m: any) => m.kind))
  await saveMarks($, sid, marks.told)
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: mainDepthNote(r, won, mem.track) }] } })
}

/* last: the tokens at the last note (agent-depth.mjs's stamp); deny: past hard with hardDeny;
   tasks and name: what a dispatch serves, its lane size journaled at its end */
const agents = new Map<string, { last: number; tokens: number; deny?: boolean; tasks?: string[]; name?: string }>()
/* this session's agents in flight by agentId: the job, model, calls, the tool
   in use and depth; a finished one stays, dimmed in Home's done fold, while another runs.
   start and end stamp its running time, in Date.now()'s ms as the draws read it */
type Flight = { id: string; job: string; model: string; calls: number; tool?: string; tokens: number; done?: boolean; start?: number; end?: number }
const flight = new Map<string, Flight>()
const flightList = (): Flight[] => [...flight.values()]
/* calls and depth redraw at most once a second, a start or an end at once, and while one runs,
   as a shown running time turns over; all through the one timer */
const flightTick: { timer?: { cancel: () => void }; due?: number } = {}
function flightRedraw($: any, now = false): void {
  if (now) qpaneRedraw($)
  flightArm($, now ? flightNext(Date.now()) : 1000)
}
/* ms to the next turn of a running agent's shown time (each second under a minute, then each
   minute), a hair past it so the draw reads the new figure; none when nothing runs */
function flightNext(at: number): number {
  let ms = Infinity
  for (const f of flight.values()) {
    if (f.done || !Number.isFinite(f.start)) continue
    const run = Math.max(0, at - (f.start as number))
    const unit = run < 60000 ? 1000 : 60000
    ms = Math.min(ms, unit - (run % unit))
  }
  return ms + 20
}
/* the pending timer stays when it is due as soon; a redraw re-arms for the next turn */
function flightArm($: any, ms: number): void {
  if (!(ms < Infinity)) return
  const due = Date.now() + ms
  if (flightTick.timer && (flightTick.due as number) <= due) return
  flightStop()
  try {
    flightTick.due = due
    flightTick.timer = $.clock.after(ms, () => {
      flightTick.timer = undefined
      qpaneRedraw($)
      flightArm($, flightNext(Date.now()))
    })
  } catch { flightTick.timer = undefined }
}
function flightStop(): void {
  try { if (flightTick.timer) flightTick.timer.cancel() } catch {}
  flightTick.timer = undefined
}
/* never throws: the spawn hook's catch would spawn again */
function flightStart($: any, e: any, res: any): void {
  try {
    const id = res && res.agentId
    if (!id || (res && res.deny)) return
    const was = flight.get(id)
    flight.set(id, { id, job: String(e.description || e.subagentType || ''), model: String(res.model || e.model || e.parentModel || ''),
      calls: was ? was.calls : 0, tokens: was ? was.tokens : 0, start: was && !was.done && Number.isFinite(was.start) ? was.start : Date.now() })
    flightRedraw($, true)
  } catch {}
}
function flightEnd($: any, agentId: string): void {
  const f = flight.get(agentId)
  if (!f) return
  f.done = true
  f.end = Date.now()
  f.tool = undefined
  if (![...flight.values()].some((x) => !x.done)) { flight.clear(); flightStop() }
  flightRedraw($, true)
}
/* an agent the engine ended with no turn.complete (killed, failed) leaves at the main loop's next turn */
async function flightSweep($: any): Promise<void> {
  if (!flight.size) return
  const list = await $.agent.list()
  if (!Array.isArray(list)) return
  const live = new Map(list.map((a: any) => [a && a.id, a && a.status]))
  for (const f of flight.values()) {
    const st = live.get(f.id)
    if (!f.done && st && !['pending', 'running', 'waiting'].includes(String(st))) flightEnd($, f.id)
  }
}

/* an Agent call's tasks by tool_use_id, until its spawn names the agent */
const dispatched = new Map<string, { tasks: string[]; name: string }>()

async function agentStateNote($: any, agentId: string): Promise<string> {
  try {
    const m = await $.session.messages({ agentId })
    return Array.isArray(m) ? stateNoteFrom(m) : ''
  } catch { return '' }
}

/* the agent's own depth at each step; notes only where the guard is on.
   A dispatch serving a task keeps its size either way. */
async function agentCheck($: any, agentId: string, usage: any): Promise<void> {
  const g = guard.state
  const tokens = agentTokens(usage)
  if (!tokens) return
  let a = agents.get(agentId)
  if (a) a.tokens = tokens
  if (!g || !g.on) return
  if (!a) agents.set(agentId, a = { last: 0, tokens })
  if (tokens >= g.hard && g.hardDeny) a.deny = true
  const stage = agentStage(tokens, g, a.last)
  if (!stage) return
  a.last = tokens
  /* past hard with hardDeny the refusal on each call carries it */
  if (stage === 'hard' && g.hardDeny) return
  const note = await agentStateNote($, agentId)
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: agentNote(stage, { tokens, guard: g, note }) }] }, agentId })
}

/* the spawn of a dispatch that named tasks; never throws, since the
   spawn hook's catch would spawn again */
function laneStart(toolUseId: any, agentId: any): void {
  try {
    const d = toolUseId ? dispatched.get(toolUseId) : undefined
    if (!d) return
    dispatched.delete(toolUseId)
    if (agentId) agents.set(agentId, { ...(agents.get(agentId) || { last: 0, tokens: 0 }), tasks: d.tasks, name: d.name })
  } catch {}
}

/* at the agent's end its size and whether it finished its brief
   (its state note's CONTINUE line, else its answer's) go to each task's journal;
   the task's cached lane is dropped so the next dispatch reads it back */
async function laneEnd($: any, agentId: string, answer: string): Promise<void> {
  const a = agents.get(agentId)
  agents.delete(agentId)
  if (!a || !a.tasks || !a.tasks.length || !a.tokens) return
  let handed = null
  const note = await agentStateNote($, agentId)
  if (note) { try { handed = handedOn(String(await $.fs.read(note))) } catch {} }
  if (handed === null) handed = handedOn(answer)
  const body = laneNote(a.tokens, a.name, handed)
  const sid = await sessionId($)
  for (const t of a.tasks) {
    await cli($, ['note', t, '--session', sid, '--json'], body)
    lanes.byTask.delete(t)
  }
}

/* each task's latest lane size, read once until the store moves (as procCards) */
const lanes: { mark?: string; byTask: Map<string, any> } = { byTask: new Map() }
async function laneSizes($: any, tasks: string[]): Promise<any[]> {
  if (lanes.mark !== band.marker) { lanes.byTask.clear(); lanes.mark = band.marker }
  const out: any[] = []
  for (const t of tasks) {
    if (!lanes.byTask.has(t)) {
      const r = await cli($, ['show', t, '--journal-tail', '20', '--json'])
      lanes.byTask.set(t, r.ok && r.json ? latestLane(r.json.journal) : null)
    }
    out.push({ task: t, ...(lanes.byTask.get(t) || {}) })
  }
  return out
}

/* ---- the first telling and the contract checks --------------- */

/* tool_use_id -> the question its ask registered, for the result row; kept in
   $.store too, so a reload or a resumed transcript draws the same card */
const told = new Map<string, any>()
const TOLD_KEEP = 50
const toldLoad: { loading?: Promise<void> } = {}

async function keepTold($: any, useId: string, q: any): Promise<void> {
  /* the card's head reads its age from the ask */
  if (!told.has(useId) && !q.created) q.created = new Date().toISOString()
  told.set(useId, q)
  try {
    const all: any = (await $.store.get('told')) || {}
    all[useId] = q
    const keys = Object.keys(all)
    for (const k of keys.slice(0, Math.max(0, keys.length - TOLD_KEEP))) delete all[k]
    await $.store.set('told', all)
  } catch {}
}

function loadTold($: any): Promise<void> {
  if (!toldLoad.loading) {
    toldLoad.loading = (async () => {
      const all: any = (await $.store.get('told')) || {}
      for (const [k, v] of Object.entries(all)) if (!told.has(k) && v && typeof v === 'object') told.set(k, v)
    })().catch(() => {})
  }
  return toldLoad.loading
}

/* the first telling draws once, under the reply that carries its
   block, else under the turn's last text row at its end; row uuid -> tool_use_ids, in $.store */
const tellAt = new Map<string, string[]>()
type TurnTell = { turn?: string; asks: string[]; placed: string[]; last?: string; lastKey?: string }
const turnTell: TurnTell = { asks: [], placed: [] }
const tellLoad: { loading?: Promise<void> } = {}

/* The asks and the newest text row of the main loop's running turn (mem.turn). */
function thisTurn(): TurnTell {
  if (turnTell.turn !== mem.turn) { turnTell.turn = mem.turn; turnTell.asks = []; turnTell.placed = []; turnTell.last = undefined; turnTell.lastKey = undefined }
  return turnTell
}

/* This turn's asks not yet placed that a text carries (all of them with no text). */
function unplaced(text?: string): string[] {
  const t = thisTurn()
  return t.asks.filter((u) => !t.placed.includes(u) && (text === undefined || carriesTold(text, told.get(u))))
}

/* the desktop names a reply block `<API message id>-t<n>`, an id no hook is handed,
   so the row is also kept under its text: letters and digits, head and tail */
function textKey(text: unknown): string | undefined {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  return s ? 'text:' + (s.length > 96 ? s.slice(0, 48) + '/' + s.slice(-48) : s) : undefined
}

function loadTellAt($: any): Promise<void> {
  if (!tellLoad.loading) {
    tellLoad.loading = (async () => {
      const all: any = (await $.store.get('toldAt')) || {}
      for (const [k, v] of Object.entries(all)) if (!tellAt.has(k) && Array.isArray(v)) tellAt.set(k, v as string[])
    })().catch(() => {})
  }
  return tellLoad.loading
}

/* Asks drawn under one row (its uuid and its text key), each telling under one row only. */
async function placeTelling($: any, asks: string[], at?: string, key?: string): Promise<void> {
  if (!at || !asks.length) return
  turnTell.placed.push(...asks)
  await loadTellAt($)
  const move = (all: Record<string, string[]>) => {
    for (const k of Object.keys(all)) {
      const left = Array.isArray(all[k]) ? all[k].filter((u) => !asks.includes(u)) : []
      if (left.length) all[k] = left
      else delete all[k]
    }
    all[at] = [...(all[at] || []), ...asks]
    if (key) all[key] = [...(all[key] || []), ...asks]
    return all
  }
  const mine = move(Object.fromEntries(tellAt))
  tellAt.clear()
  for (const [k, v] of Object.entries(mine)) tellAt.set(k, v)
  qpaneRedraw($)
  try {
    const all = move((await $.store.get('toldAt')) || {})
    const keys = Object.keys(all)
    for (const k of keys.slice(0, Math.max(0, keys.length - 2 * TOLD_KEEP))) delete all[k]
    await $.store.set('toldAt', all)
  } catch {}
}

/* the telling's drop, snooze and typed answer, kept on the told record. */
async function tellingEnd($: any, useId: string, q: any, verb: 'drop' | 'snooze' | 'answer'): Promise<void> {
  const words = (qpane.notes[q.id] || '').trim()
  const r = await cardEnd($, verb, q.key || q.id, words, 'card', q.id)
  toast($, r.text, 'press')
  if (r.ok) {
    if (verb === 'answer') q.answered = words.replace(/\s+/g, ' ').slice(0, 80)
    else q.ended = r.text
    /* a snooze is the one ending that wakes, so the card goes live again */
    if (verb === 'snooze') q.snoozed = true
    noteGone(q.id)
    await keepTold($, useId, q)
  }
  qpaneRedraw($)
}

async function tellingPick($: any, useId: string, q: any, letter: string): Promise<void> {
  if (q.answered) return
  const note = (qpane.notes[q.id] || '').trim()
  /* the card it drew is the told record itself, so its key answers it; with the version it
     showed, so a press racing a rewording's redraw is refused, and the band's next load redraws it */
  const r = await pressAnswer($, q.id, letter, () => recordAnswer($, q.key || q.id, letter, 'card', note || undefined, q.id, q.local ? undefined : q.version || 1))
  if (!r) return
  if (!r.ok) kick($)
  if (r.ok) {
    q.answered = token(q.id, r.pick || letter)
    noteGone(q.id)
    queueDrop($, q.id)
    await keepTold($, useId, q)
  }
  qpaneRedraw($)
}

/* a card under a reply follows the band, so one answered there does not stay live.
   drawn: the told records a reply drew live or snoozed; open: the band's last open set;
   seen: the store marker each was last shown at, so one show per card per store change */
const follow: { drawn: Set<string>; open?: Set<string>; seen: Map<string, string>; chain?: Promise<boolean> } = { drawn: new Set(), seen: new Map() }

/* The told record as its question now stands, written as the card's own presses write it. */
function toldNow(q: any, s: any): boolean {
  /* reworded after the version this telling showed, the card goes to its changed stub */
  if (!changedStub(q) && rewordedSince(q, s)) { q.reworded = { version: s.reworded.version }; return true }
  const st = s && s.status
  if (st === 'open') {
    if (!q.snoozed) return false
    delete q.ended
    delete q.snoozed
    return true
  }
  if (st === 'snoozed') {
    if (q.snoozed) return false
    const z = s.snooze || {}
    /* the three wake conditions combine, a record waited on among them */
    q.ended = 'Snoozed ' + q.id + (z.until ? ' until ' + z.until : '')
      + (z.wakeOn ? ', waiting on ' + z.wakeOn + (z.wakeStatus ? ': ' + z.wakeStatus : '') : '')
      + (z.trigger ? ', to wake when: ' + z.trigger : '') + '.'
    q.snoozed = true
    return true
  }
  /* the Answer section's first paragraph is the answer that stands */
  const said = String(s.answer || '').split(/\r?\n\s*\r?\n/)[0].replace(/\s+/g, ' ').trim()
  if (st === 'answered') {
    const m = /^\d+([a-z])\b/.exec(said)
    q.answered = m ? token(q.id, m[1]) : said.slice(0, 80) || q.id
    delete q.ended
    delete q.snoozed
    return true
  }
  if (st !== 'dropped') return false
  const why = said.replace(/^Dropped\.\s*/, '')
  q.ended = 'Dropped ' + q.id + (why ? ': ' + why : '') + '.'
  delete q.snoozed
  return true
}

async function followTold($: any): Promise<boolean> {
  const open = follow.open
  if (!open) return false
  let moved = false
  for (const useId of [...follow.drawn]) {
    const q = told.get(useId)
    if (!q || q.answered || (q.ended && !q.snoozed) || changedStub(q)) { follow.drawn.delete(useId); continue }
    /* a kept question's card follows the mod's own store until it is filed */
    if (q.local) continue
    const handle = q.key || q.id
    let s: any = null
    /* the band's row carries a rewording, so an open card learns it with no read */
    const row = open.has(handle) ? (band.questions || []).find((x: any) => x && (x.key === handle || x.id === handle)) : null
    if (open.has(handle)) s = { status: 'open', ...(row && row.reworded ? { reworded: row.reworded } : {}) }
    else if (follow.seen.get(useId) !== (band.marker || '')) {
      follow.seen.set(useId, band.marker || '')
      const r = await cli($, ['show', handle, '--json'])
      s = r.ok ? r.json : null
    }
    if (s && toldNow(q, s)) { await keepTold($, useId, q); moved = true }
  }
  return moved
}

/* One follow at a time, from the band's load or a card drawn for the first time. */
function followRun($: any): Promise<boolean> {
  follow.chain = (follow.chain || Promise.resolve(false)).catch(() => false).then(() => followTold($))
  return follow.chain
}

/* ---- a plain session's own questions ------------ */

/* Per session in the store's `local`: n, the last label; at, the last touch (pruned after a
   week); qs, the kept questions; said, answers not yet told; renamed, the board labels to
   tell at the next prompt; filed, label -> the board's id and key once filed */
type LocalQ = { label: string; payload: any; created: string; status: 'open' | 'answered' | 'dropped'; pick?: string | null; note?: string; use?: string; version?: number }
type LocalEntry = { n: number; at: number; qs: LocalQ[]; said: any[]; renamed: string[]; filed: Record<string, { id: string; key?: string }> }
const local: { sid?: string; entry?: LocalEntry; chain: Promise<unknown>; filing?: Promise<void>; failed: Set<string> } = { chain: Promise.resolve(), failed: new Set() }

/* the session's entry, read once per id and kept in memory for the draws */
async function localRead($: any, sid: string): Promise<LocalEntry> {
  if (local.sid === sid && local.entry) return local.entry
  let e: any
  try { e = ((await $.store.get('local')) || {})[sid] } catch {}
  local.sid = sid
  local.entry = { n: 0, at: Date.now(), qs: [], said: [], renamed: [], filed: {}, ...(e && typeof e === 'object' ? e : {}) }
  return local.entry as LocalEntry
}

async function localSave($: any, sid: string, e: LocalEntry): Promise<void> {
  e.at = Date.now()
  local.sid = sid
  local.entry = e
  try {
    const all: any = (await $.store.get('local')) || {}
    all[sid] = e
    await $.store.set('local', all)
  } catch {}
}

/* one change at a time, filing included, so an answer never races its register */
function localQueued<T>(job: () => Promise<T>): Promise<T> {
  const run = local.chain.then(job, job)
  local.chain = run.catch(() => {})
  return run
}

/* the open kept questions as the board's cards, for the band and the pane */
function localOpen(): any[] {
  const e = local.sid && local.sid === mem.id ? local.entry : undefined
  return e ? e.qs.filter((q) => q.status === 'open').map((q) => localCard(q, local.sid)) : []
}

/* the answers waiting to be told, as inbox events of this session's own box */
function localSaid(sid: string): any[] {
  const e = local.sid === sid ? local.entry : undefined
  if (!e || !e.said.length) return []
  for (const q of e.qs) if (!band.options[q.label]) band.options[q.label] = q.payload.options || []
  return e.said.map((ev: any) => ({ ...ev, key: sid + '|' + ev.key, box: sid, orig: ev, local: true }))
}

async function localTold($: any, evs: any[]): Promise<void> {
  if (!evs.length) return
  const sid = evs[0].box
  const gone = new Set(evs.map((x: any) => x.orig.key))
  await localQueued(async () => {
    const e = await localRead($, sid)
    const left = e.said.filter((x: any) => !gone.has(x.key))
    if (left.length === e.said.length) return
    e.said = left
    await localSave($, sid, e)
  })
}

async function localAsk($: any, sid: string, payload: any, alone: string[], useId?: string, turnAsks?: string[]): Promise<any> {
  const q = await localQueued(async () => {
    const e = await localRead($, sid)
    e.n += 1
    const kept: LocalQ = { label: 'L' + e.n, payload, created: new Date().toISOString(), status: 'open', ...(useId ? { use: useId } : {}) }
    e.qs.push(kept)
    await localSave($, sid, e)
    return kept
  })
  if (useId) await keepTold($, useId, { ...localCard(q, sid), ...(alone.length ? { beside: alone } : {}) })
  if (alone.length) await tellBeside($, q.label, alone, turnAsks)
  qpaneRedraw($)
  return { result: localResult(q.label, payload, alone.length ? [besideSlip(q.label, alone).say] : []) }
}

/* a kept question rewords in this session's store, keeping its L-n, its
   earlier cards stubbed as a board question's are; one filed since rewords on the board. */
async function localReword($: any, sid: string, raw: any, alone: string[], useId?: string, turnAsks?: string[]): Promise<any> {
  const { edits, ...payload } = raw
  const out: any = await localQueued(async () => {
    const e = await localRead($, sid)
    const q = e.qs.find((x) => x.label === edits)
    if (!q) return e.filed[edits] ? { filed: e.filed[edits] } : { deny: edits + ' is not a question this session keeps' }
    if (q.status !== 'open') return { deny: edits + ' was already ' + q.status + '; ask a new question instead' }
    const old = q.payload || {}
    const changed = [...new Set([...Object.keys(old), ...Object.keys(payload)])].filter((k) => JSON.stringify(old[k]) !== JSON.stringify(payload[k]))
    if (changed.length) {
      q.payload = payload
      q.version = (q.version || 1) + 1
      await localSave($, sid, e)
    }
    return { q, changed }
  })
  if (out.filed) return rewordAsk($, sid, { ...raw, edits: out.filed.id }, alone, useId, turnAsks)
  if (out.deny) return { deny: 'ask refused: ' + out.deny }
  const q: LocalQ = out.q
  if (useId && out.changed.length) {
    await loadTold($)
    const now = { reworded: { version: q.version } }
    for (const [u, t] of [...told]) {
      if (u !== useId && t && t.id === q.label && !changedStub(t) && rewordedSince(t, now)) { t.reworded = now.reworded; await keepTold($, u, t) }
    }
    await keepTold($, useId, { ...localCard(q, sid), ...(alone.length ? { beside: alone } : {}), version: q.version, reworded: now.reworded })
    if (alone.length) await tellBeside($, q.label, alone, turnAsks)
  }
  qpaneRedraw($)
  const letters = (payload.options || []).map((o: any) => o.type).filter((t: string) => /^[a-z]$/.test(t))
  return { result: rewordResult({ id: q.label, name: payload.name, reworded: out.changed }, { letters, pick: payload.pick, block: tellBlock({ ...payload, id: q.label }, letters) }) }
}

/* An answer (or a drop) of the user's to a kept question, recorded in the store and told as
   their board answers are; one already filed is answered on the board under its new label.
   `own`: the session records what it read in chat, so nothing is told back to it. */
async function localAnswer($: any, label: string, letter: string, note: string | undefined, site: PressSite | null, drop = false, own = false): Promise<{ ok: boolean; text: string; pick?: string; filed?: { id: string; key?: string } }> {
  const sid = await sessionId($)
  const out: any = await localQueued(async () => {
    const e = await localRead($, sid)
    const q = e.qs.find((x) => x.label === label)
    if (!q) return e.filed[label] ? { filed: e.filed[label] } : { ok: false, text: label + ' is not a question this session keeps.' }
    if (q.status !== 'open') return { ok: false, text: label + ' was already ' + q.status + (q.pick ? ': ' + token(label, q.pick) : '') + '.' }
    const letters = (q.payload.options || []).map((o: any) => o && o.type).filter((t: any) => /^[a-z]$/.test(t || ''))
    if (letter && !letters.includes(letter)) return { ok: false, text: label + ' has no option ' + letter + (letters.length ? '; its tokens are ' + letters.map((l: string) => token(label, l)).join(', ') : '') + '.' }
    q.status = drop ? 'dropped' : 'answered'
    q.pick = drop ? null : letter || null
    if (note) q.note = note
    band.options[label] = q.payload.options || []
    if (!own) e.said.push(localEvent(q, sid, new Date().toISOString()))
    await localSave($, sid, e)
    return { ok: true, q }
  })
  if (out.filed) {
    const f = out.filed
    if (own) return { ok: false, text: '', filed: f }
    return drop ? recordEnd($, 'drop', f.key || f.id, note || '', site || 'typed', f.id) : recordAnswer($, f.key || f.id, letter, site || 'typed', note, f.id, undefined, site === null)
  }
  if (!out.ok) return out
  const q: LocalQ = out.q
  /* the card under the reply that asked follows the answer */
  if (q.use) {
    await loadTold($)
    const t = told.get(q.use)
    if (t) {
      if (drop) t.ended = 'Dropped ' + label + (note ? ': ' + note : '') + '.'
      else t.answered = letter ? token(label, letter) : String(note || '').replace(/\s+/g, ' ').slice(0, 80)
      await keepTold($, q.use, t)
    }
  }
  if (site) userDelivers($, site)
  qpaneRedraw($)
  const name = String(q.payload.name || '')
  if (drop) return { ok: true, text: 'Dropped ' + label + (note ? ': ' + note : '') + '.' }
  return { ok: true, pick: letter || undefined, text: 'Answered ' + label + ' (' + name + '): ' + (letter ? token(label, letter) + '.' + (note ? ' Note: ' + note : '') : note) }
}

/* Engaged now: each kept question goes to the board with its saved payload and this session's
   id, an answered or dropped one answered or dropped there too, its card taking the new label */
function fileLocal($: any): Promise<void> {
  if (!local.filing) local.filing = localQueued(() => fileAll($)).finally(() => { local.filing = undefined })
  return local.filing
}

async function fileAll($: any): Promise<void> {
  const sid = await sessionId($)
  const e = await localRead($, sid)
  if (!e.qs.length || !(await isEngaged($)) || isSpare(await projectDir($))) return
  const held = await boundTrack($, sid, true)
  let moved = false
  while (e.qs.length) {
    const q = e.qs[0]
    const r = await cli($, ['register', '--json'], JSON.stringify(await boardPayload($, sid, held, q.payload)))
    if (!r.ok || !r.json || !r.json.id) {
      /* left kept, filed at the next load; the failure said once */
      if (!local.failed.has(q.label)) { local.failed.add(q.label); try { $.ui.log('AskerDo: ' + q.label + ' was not filed on the board yet: ' + (r.err || 'no id came back')) } catch {} }
      break
    }
    const id = r.json.id
    let lost = ''
    if (q.status !== 'open') {
      const how = q.status === 'dropped' ? ['drop', id] : ['answer', id, ...(q.pick ? ['--pick', q.pick] : [])]
      const a = await cli($, [...how, ...(q.note ? ['--note', q.note] : []), '--session', sid, '--json'])
      if (!a.ok) lost = ', though its ' + (q.status === 'dropped' ? 'drop' : 'answer') + ' did not reach the board (' + a.err + ')'
    }
    e.qs.shift()
    e.filed[q.label] = { id, ...(r.json.key ? { key: r.json.key } : {}) }
    e.renamed.push(q.label + ' is now ' + id + ' on the board' + lost + '.')
    if (q.use) {
      await loadTold($)
      const t = told.get(q.use)
      if (t) {
        const { local: _l, ...rest } = t
        const now: any = { ...rest, id, key: r.json.key, name: r.json.name || t.name, ask: r.json.ask || t.ask, boardUrl: r.json.boardUrl, workstream: r.json.workstream || t.workstream, was: q.label }
        if (q.status === 'answered') now.answered = q.pick ? token(id, q.pick) : String(q.note || '').slice(0, 80)
        if (q.status === 'dropped') now.ended = 'Dropped ' + id + (q.note ? ': ' + q.note : '') + '.'
        await keepTold($, q.use, now)
      }
    }
    await localSave($, sid, e)
    moved = true
  }
  if (moved) { kick($); qpaneRedraw($) }
}

/* The next prompt tells each new label once ("L1 is now Q108 on the board."). */
async function renamedNote($: any): Promise<string> {
  const sid = await sessionId($)
  const e = await localRead($, sid)
  if (e.qs.length && (await isEngaged($))) await fileLocal($)
  return localQueued(async () => {
    const x = await localRead($, sid)
    if (!x.renamed.length) return ''
    const lines = x.renamed.join('\n')
    x.renamed = []
    await localSave($, sid, x)
    return lines
  })
}

/* A week untouched, an entry goes at a session start; the session starting keeps its own. */
async function pruneKept($: any): Promise<void> {
  const sid = await sessionId($)
  const all: any = (await $.store.get('local')) || {}
  const kept = pruneLocal(all, sid, Date.now())
  if (Object.keys(kept).length !== Object.keys(all).length) await $.store.set('local', kept)
}

const plainRegister = 'AskerDo: this session has not used AskerDo, so its questions stay with it. Ask through the ask tool,'
  + ' which keeps the question here under a local label (L1) and files it on the board if the session uses AskerDo. Nothing was registered.'

/* The saved options' mod section and check switches, read once per process. */
const contract: { loading?: Promise<any> } = {}
function readContract($: any): Promise<any> {
  if (!contract.loading) {
    contract.loading = (async () => {
      const r = await spawn($, ['node', $.plugin.root + '/scripts/mod-contract.mjs', '--json'], { timeoutMs: 15000 })
      let j: any = null
      try { j = JSON.parse(String(r.stdout || '')) } catch {}
      return r.exitCode === 0 && j ? j : { section: null, checks: null }
    })().catch(() => ({ section: null, checks: null }))
  }
  return contract.loading
}

/* the configured name the mod's own words use */
async function userName($: any): Promise<string> {
  const c = await readContract($).catch(() => null)
  return nameOf(c && c.name)
}

/* This turn's reply text as stored, and the dispatches flagged. The main loop's
   dispatches and commits, and whether a task was in hand as they ran or taken this turn. */
const checks: { texts: string[]; agents: any[]; resume?: string; carry?: string; inbox?: { track: string; ids: string[]; more?: boolean }; dispatched: number; commits: number; holding: boolean } = {
  texts: [], agents: [], dispatched: 0, commits: 0, holding: false,
}

/* sessions running the onboard skill: the run writes nothing to the board before the
   user's go, so it has nothing to hold. The mark lasts until the run's report is recorded
   (the skill's last step), whatever track the session holds; module memory, so a reload drops it */
const onboarding = new Set<string>()
const ONBOARD = /onboard$/
const ONBOARD_RAN = /\bproc\s+ran\s+onboard-a-project\b/
async function onboardSeen($: any, e: any): Promise<void> {
  if (e.tool === 'Skill' && ONBOARD.test(String(toolInput(e).skill || ''))) onboarding.add(await sessionId($))
  else if (COMMAND_TOOLS.includes(e.tool) && ONBOARD_RAN.test(String(toolInput(e).command || ''))) onboarding.delete(await sessionId($))
}

/* a handoff empties the hand, so the hand is read as each piece of work runs too */
function trackWork(e: any): void {
  const agent = AGENT_TOOLS.includes(e.tool)
  if (!agent && !(COMMAND_TOOLS.includes(e.tool) && commitsIn(toolInput(e).command))) return
  if (agent) checks.dispatched++
  else checks.commits++
  if ((band.hand || []).length) checks.holding = true
}

function textsOf(m: any): string[] {
  const c = m && m.content
  if (typeof c === 'string') return [c]
  return Array.isArray(c) ? c.filter((b: any) => b && b.type === 'text' && b.text).map((b: any) => String(b.text)) : []
}

/* the rules in force, read again only when the session, its track or the board's
   profiles revision changes (the guard's read where no local board says it); never per tool call */
const rules: { key?: string; guard?: any; rev?: number; loading?: Promise<any> } = {}
async function readRules($: any): Promise<any> {
  const sid = await sessionId($)
  const tr = await boundTrack($, sid)
  const dir = await projectDir($)
  const key = sid + '|' + (tr || '') + '|' + dir
  const rev = guard.profilesAt
  if (rules.loading && rules.key === key && (rev !== undefined ? rules.rev === rev : rules.guard === guard.state)) return rules.loading
  rules.key = key
  rules.guard = guard.state
  rules.rev = rev
  rules.loading = (async () => {
    const argv = ['node', $.plugin.root + '/scripts/rules.mjs', '--cwd', dir, '--session', sid]
    if (tr) argv.push('--track', tr)
    const r = await spawn($, [...argv, '--json'], { timeoutMs: 15000 })
    let j: any = null
    try { j = JSON.parse(String(r.stdout || '')) } catch {}
    return r.exitCode === 0 && j && typeof j.text === 'string' ? j : null
  })().catch(() => null)
  return rules.loading
}

/* the engine records the system prompt at a conversation's first request and rewrites
   it only for a named section whose prompt.section answer changed, so the mod's blocks ride the
   engine's own context_management section; a compose-appended one never reaches the record again */
const CARRIER = 'context_management'
const carry: { text?: string; facts?: { surfaces: string[]; tools: string[] }; resumed?: 'prime' | 'primed' | 'told'; toldResume?: boolean } = {}
const joined = (blocks: any[]) => blocks.map((b) => b.text).join('\n\n')

function invalidateCarrier($: any): void {
  try { $.ui.invalidate('prompt.section') } catch {}
}

/* a thread resumed in a new process sends its old record at the first request, where the
   engine only notes the answers (owedPrompt holds none yet). So the first answer is core's alone,
   asked again once that request went out, and the next request rewrites the record with the
   blocks; the first prompt carries them as context meanwhile */
function afterPrime($: any): void {
  if (carry.resumed !== 'primed') return
  carry.resumed = 'told'
  invalidateCarrier($)
}

async function resumeBlocks($: any): Promise<string> {
  if (!carry.resumed || carry.toldResume) return ''
  carry.toldResume = true
  let surfaces: string[] = mem.surfaces || []
  try { if (!surfaces.length) surfaces = await $.session.surfaces() } catch {}
  return joined(await modBlocks($, surfaces, []))
}

/* each block's first line says as of when its text last changed, so where a recorded
   prompt, a rewrite and a resume's context put several in view the latest wins; a stamp moves
   only with its block's text (kept in the store across restarts), so the record does not churn */
const AS_OF = 'Where several AskerDo blocks of one kind are in view, follow the one with the latest as-of time; a block with none is older than any with one.'
const stamps: { read?: boolean; all: Record<string, { hash: string; at: string }> } = { all: {} }
const STAMPS_KEPT = 200

function textHash(t: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16)
}

async function asOfNow($: any): Promise<string> {
  let ms = Date.now()
  try { const t = Number(await $.clock.now()); if (Number.isFinite(t)) ms = t } catch {}
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds())
}

async function stamped($: any, blocks: any[]): Promise<any[]> {
  if (!blocks.length) return blocks
  if (!stamps.read) {
    stamps.read = true
    try { stamps.all = { ...((await $.store.get('blockStamps')) || {}), ...stamps.all } } catch {}
  }
  const sid = await sessionId($).catch(() => mem.id || '')
  let moved = false
  const at = await asOfNow($)
  const out = blocks.map((b) => {
    const key = sid + '|' + b.id
    const hash = textHash(b.text)
    let st = stamps.all[key]
    if (!st || st.hash !== hash) { delete stamps.all[key]; st = stamps.all[key] = { hash, at }; moved = true }
    return { ...b, text: 'As of ' + st.at + '.\n' + b.text }
  })
  if (moved) {
    const keys = Object.keys(stamps.all)
    for (const k of keys.slice(0, Math.max(0, keys.length - STAMPS_KEPT))) delete stamps.all[k]
    try { await $.store.set('blockStamps', stamps.all) } catch {}
  }
  return [{ id: PLUGIN + ':as-of', text: AS_OF, scope: 'session' }, ...out]
}

/* The mod's blocks for the main prompt, stamped: the band, surface and no-band sections once engaged, then the rules */
async function modBlocks($: any, surfaces: string[], tools: string[]): Promise<any[]> {
  return stamped($, await rawBlocks($, surfaces, tools))
}

async function rawBlocks($: any, surfaces: string[], tools: string[]): Promise<any[]> {
  /* the session's rules in force; its own block, without the lines for its agents alone */
  const r = await readRules($).catch(() => null)
  const ruleText = r && r.session && r.session.text ? r.session.text : r && r.text
  const own = ruleText ? [{ id: PLUGIN + ':rules', text: ruleText, scope: 'session' }] : []
  /* the mod's sections arrive once the session is engaged, whatever the surfaces read:
     a desktop session another session started composes with none even while its band draws */
  if (!(await isEngaged($))) return own
  const c = await readContract($).catch(() => null)
  const text = c && c.section ? c.section : bandSection(nameOf(c && c.name))
  /* the session's one per-surface section rides beside the mod section, which
     says the carrier's two give way to it */
  const side = c && c.section && c.surfaces ? c.surfaces[surfacePick(surfaces, tools)] : null
  const mine = side ? [{ id: PLUGIN + ':surface', text: side, scope: 'session' }] : []
  /* read only where no band draws, the names line stays */
  const bare = noBandHere(surfaces, tools) ? [{ id: PLUGIN + ':no-band', text: noBandSection(c && c.name), scope: 'session' }] : []
  return [{ id: PLUGIN + ':band', text, scope: 'session' }, ...mine, ...bare, ...own]
}

/* once a prompt, before its request: blocks that moved since the carrier's answer are asked again */
async function carryCheck($: any): Promise<void> {
  if (carry.text === undefined) return
  const f = carry.facts || { surfaces: mem.surfaces || [], tools: [] }
  if (joined(await modBlocks($, f.surfaces, f.tools)) !== carry.text) invalidateCarrier($)
}

/* the profiles revision from the local board's state, read once per prompt and per
   dispatch, so a profile edit reaches the rules and the guard whether or not the band is live;
   marker: the guard is read again here on a move (a dispatch reads it anyway) */
async function profilesRev($: any, marker: boolean): Promise<void> {
  const st = await waitRead($, 'state').catch(() => null)
  if (!st || !Number.isFinite(st.profilesAt)) return
  const moved = guard.profilesAt !== undefined && guard.profilesAt !== st.profilesAt
  guard.profilesAt = st.profilesAt
  if (moved && marker) await markerRun($, await sessionId($), mem.trackKey, mem.trackKey ? ['--write'] : [])
}

/* before a dispatch the held track (one board read while none is held) and the guard
   for it are read again, since a CLI resume or a profile edit under a frozen band reaches the
   mod no other way; once per Agent or Workflow call, whose id its spawns share */
const fresh: { for?: string; run?: Promise<void> } = {}
function dispatchFresh($: any, toolUseId?: string): Promise<void> {
  if (!toolUseId || fresh.for !== toolUseId || !fresh.run) {
    fresh.for = toolUseId
    fresh.run = (async () => {
      const sid = await sessionId($)
      await boundTrack($, sid, true)
      await profilesRev($, false)
      await markerRun($, sid, mem.trackKey, mem.trackKey ? ['--write'] : [])
    })().catch(() => {})
  }
  return fresh.run
}

/* A dim line under the call and a note the model reads at the turn's end; never a block. */
function flagSlips($: any, what: string, slips: any[]): void {
  if (!slips.length) return
  try { $.ui.log(flagLine(what, slips)) } catch {}
  checks.agents.push({ what, slips })
}

/* the dispatch checks run where rules are in force (none with no board); a
   brief file the prompt names is read for lines against them. */
async function agentFlag($: any, input: any, toolUseId?: string): Promise<void> {
  const r = await readRules($).catch(() => null)
  if (!(r && r.values)) return
  const briefs: string[] = []
  for (const f of briefPaths(input.prompt, await projectDir($))) {
    try { const t = await $.fs.read(f); if (typeof t === 'string') briefs.push(t) } catch {}
  }
  /* the tasks it serves, for its lane size at its end and the last lane's flag */
  const tasks = tasksOfDispatch(input, briefs)
  const name = String(input.description || input.subagent_type || 'an agent').slice(0, 60)
  if (toolUseId && tasks.length) {
    if (dispatched.size >= 20) dispatched.delete(dispatched.keys().next().value as string)
    dispatched.set(toolUseId, { tasks, name })
  }
  flagSlips($, 'the dispatch of ' + name, agentChecks(input, { briefs, rules: r.values, inject: r.inject !== false, lanes: await laneSizes($, tasks).catch(() => []) }))
}

/* a desktop session driven while its window is not attached composes with no
   surface, yet the band carries its questions wherever it draws */
async function bandHere($: any): Promise<boolean> {
  if (mem.surfaces && mem.surfaces.length) return bandSurfaces(mem.surfaces)
  if (drawnOn.size) return bandSurfaces([...drawnOn])
  try { return bandSurfaces(await $.session.surfaces()) } catch { return false }
}

/* of a close's inbox ids, those still in the inbox, read once from the board; a failed read keeps them all */
async function stillInbox($: any, closed?: { track: string; ids: string[]; more?: boolean }): Promise<string[]> {
  if (!closed || !closed.ids.length) return []
  if (!closed.track) return closed.ids
  const r = await cli($, ['track', 'show', closed.track, '--json']).catch(() => null)
  if (!r || !r.ok || !Array.isArray(r.json && r.json.inbox)) return closed.ids
  const now: string[] = r.json.inbox.map((t: any) => String((t && t.id) || '')).filter(Boolean)
  const kept = closed.ids.filter((id) => now.includes(id))
  /* a shell line cut at ten: the board's own list holds the rest */
  return closed.more ? [...new Set([...kept, ...now])] : kept
}

async function replyCheck($: any, e: any): Promise<void> {
  const texts = checks.texts
  const items = checks.agents
  const resume = checks.resume
  const carry = checks.carry
  const closed = checks.inbox
  const work = { dispatched: checks.dispatched, commits: checks.commits, holding: checks.holding }
  checks.texts = []
  checks.agents = []
  checks.resume = undefined
  checks.carry = undefined
  checks.inbox = undefined
  checks.dispatched = 0
  checks.commits = 0
  checks.holding = false
  /* a receipt owed is checked once, by the first reply written after its delivery */
  const due = e.isAborted ? [] : owed.filter((r) => r.turn !== mem.turn || texts.length > r.at)
  for (const r of due) owed.splice(owed.indexOf(r), 1)
  const c = await readContract($)
  if (c && c.checks && !e.isAborted) {
    const told = await toldMarks($, await sessionId($))
    const windowTold = pastWindow({ percent: lastReading() ? wholePercent(lastReading()) : undefined, main: guard.state && guard.state.main, told })
    const engaged = await isEngaged($)
    const held = (await boundTrack($).catch(() => null)) || ''
    const slips = replyChecks({ answer: e.answer, all: texts.length ? texts.join('\n\n') : e.answer,
      checks: c.checks, band: await bandHere($), windowTold, handoffAsked: !!marks.asked, name: nameOf(c.name),
      /* the receipt rule rides the mod section alone */
      receipts: engaged ? due : [], resume, carry, held, inbox: await stillInbox($, closed) })
    if (slips.length) {
      try { $.ui.log(flagLine('this reply', slips)) } catch {}
      items.push({ what: 'your last reply', slips })
    }
    /* counted at the turn's end, so a task taken in hand later in the turn clears it */
    const holding = work.holding || (band.hand || []).length > 0
    const off = engaged ? offTrackSlip({ ...work, holding, track: held, onboarding: onboarding.has(await sessionId($)) }) : null
    if (off) {
      try { $.ui.log(flagLine('this turn', [off])) } catch {}
      items.push({ what: 'this turn', slips: [off] })
    }
  }
  /* the mod's own check, saved options or not: a turn past this session's live handoff that left it as it was */
  const steps = current.steps
  current.steps = []
  const stale = e.isAborted ? null : handoffCurrency(await liveHandoff($).catch(() => null), mem.turn, steps).slip
  if (stale) {
    try { $.ui.log(flagLine('this turn', [stale])) } catch {}
    items.push({ what: 'this turn', slips: [stale] })
  }
  if (!items.length) return
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: flagNote(items, await userName($)) }] } })
}

/* ---- procedures ------------------------------------------------- */

/* The cards' triggers, read again when the store moves; the project is scanned
   once per process. A card points each loop at its file once, and toasts once. */
const procs: { cards?: any[]; mark?: string; scanned?: boolean; loading?: Promise<void>; told: Set<string>; toasted: Set<string> } = {
  told: new Set(), toasted: new Set(),
}

/* never awaited on a tool call; before the first read lands a call gets no card */
async function procCards($: any): Promise<any[]> {
  /* cards read before the band knew the store's marker count as of its first one */
  if (procs.cards && procs.mark === undefined) procs.mark = band.marker
  if (procs.cards && procs.mark === band.marker) return procs.cards
  if (!procs.loading) {
    procs.loading = (async () => {
      const mark = band.marker
      /* --project always, so a worktree's cards show at its own paths */
      const dir = await projectDir($)
      const argv = ['proc', 'triggers', '--project', dir, '--json']
      if (procs.scanned) argv.push('--no-scan')
      procs.scanned = true
      const r = await cli($, argv)
      if (dir !== mem.cwd) return
      procs.cards = r.ok && Array.isArray(r.json) ? r.json : (procs.cards || [])
      procs.mark = mark
    })().catch(() => {}).finally(() => { procs.loading = undefined })
  }
  /* with cards in hand the call reads them and the refresh runs behind it */
  return procs.cards || []
}

/* A flag note and a toast, never a block. */
async function procWatch($: any, e: any): Promise<void> {
  const cards = await procCards($)
  if (!cards.length) return
  const hits = matchCall(cards, { tool: e.tool, input: toolInput(e), cwd: await projectDir($) })
  for (const h of hits) {
    const k = (e.agentId || 'main') + ' ' + h.card.id
    if (procs.told.has(k)) continue
    procs.told.add(k)
    if (!procs.toasted.has(h.card.id)) {
      procs.toasted.add(h.card.id)
      toast($, procToast(h.card), 'ambient', 8000)
    }
    const message = { type: 'user', content: [{ type: 'text', text: procNote(h.card, h.why, { agent: !!e.agentId }) }] }
    try { await $.session.append(e.agentId ? { message, agentId: e.agentId } : { message }) } catch {}
  }
}

/* the decisions governing files or commands, read again when the store moves (as
   procCards); a pointer costs tokens, so each fires once per decision per loop of a session */
const decs: { rows?: any[]; mark?: string; stale?: boolean; loading?: Promise<void>; told: Set<string>; toasted: Set<string> } = {
  told: new Set(), toasted: new Set(),
}

async function decisionRows($: any): Promise<any[]> {
  if (decs.rows && decs.mark === undefined) decs.mark = band.marker
  if (decs.rows && decs.mark === band.marker && !decs.stale) return decs.rows
  if (!decs.loading) {
    decs.stale = false
    decs.loading = (async () => {
      const mark = band.marker
      const dir = await projectDir($)
      const r = await cli($, ['decisions', 'triggers', '--project', dir, '--json'])
      if (dir !== mem.cwd) return
      decs.rows = r.ok && Array.isArray(r.json) ? r.json : (decs.rows || [])
      decs.mark = mark
    })().catch(() => {}).finally(() => { decs.loading = undefined })
  }
  return decs.rows || []
}

async function decisionWatch($: any, e: any): Promise<void> {
  const rows = await decisionRows($)
  if (!rows.length) return
  const hits = decisionHits(rows, { tool: e.tool, input: toolInput(e), cwd: await projectDir($) })
  for (const h of hits) {
    const k = (mem.id || '') + ' ' + (e.agentId || 'main') + ' ' + h.decision.id
    if (decs.told.has(k)) continue
    decs.told.add(k)
    if (!decs.toasted.has(h.decision.id)) {
      decs.toasted.add(h.decision.id)
      toast($, 'Decision ' + h.decision.id + ' applies: ' + h.decision.name, 'ambient', 8000)
    }
    void readOnce($, [h.decision.id], 'toast').catch(() => {})
    const message = { type: 'user', content: [{ type: 'text', text: decisionNote(h.decision, h.why, await userName($)) }] }
    try { await $.session.append(e.agentId ? { message, agentId: e.agentId } : { message }) } catch {}
  }
}

/* the rulings on the tasks a dispatch serves, for its brief */
async function dispatchDecisions($: any, e: any): Promise<string> {
  const briefs: string[] = []
  for (const f of briefPaths(e.prompt, await projectDir($))) {
    try { const t = await $.fs.read(f); if (typeof t === 'string') briefs.push(t) } catch {}
  }
  const tasks = tasksOfDispatch(e, briefs).slice(0, 5)
  if (!tasks.length) return ''
  const runs = await Promise.all(tasks.map((t) => cli($, ['decisions', '--task', t, '--json'])))
  const shown = runs.flatMap((r) => (r.ok && Array.isArray(r.json) ? r.json : []))
  void readOnce($, briefDecisionIds(shown), 'brief').catch(() => {})
  return decisionsBlock(tasks, shown)
}

/* the reads only the mod sees (the toast, an agent's brief) mark a ruling used on the
   board, once per record and session; a failed read is tried again at the next showing */
const readSent = new Set<string>()
async function readOnce($: any, ids: string[], site: 'toast' | 'brief'): Promise<void> {
  const sid = await sessionId($)
  const fresh = [...new Set(ids)].filter((id) => id && !readSent.has(sid + ' ' + id))
  if (!fresh.length) return
  for (const id of fresh) readSent.add(sid + ' ' + id)
  const r = await cli($, ['read', ...fresh, '--site', site, '--session', sid, '--json'])
  if (!r.ok) for (const id of fresh) readSent.delete(sid + ' ' + id)
}

async function procCmd($: any, args: string): Promise<string> {
  const p = parseProc(args)
  if (p.error) return p.error
  const cwd = await projectDir($)
  if (p.sub === 'scan') {
    const r = await cli($, ['proc', 'scan', '--project', cwd, '--json'])
    procs.cards = undefined
    void procCards($).catch(() => {})
    return r.ok ? scanText(r.json) : failed('Reading the procedures', r)
  }
  if (p.sub === 'ran') {
    if (p.name === 'onboard-a-project') onboarding.delete(await sessionId($))
    const argv = ['proc', 'ran', p.name, p.result, '--project', cwd, '--session', await sessionId($), '--json']
    if (p.note) argv.push('--note', p.note)
    const r = await cli($, argv)
    procs.cards = undefined
    void procCards($).catch(() => {})
    return r.ok ? ranText(r.json) : failed('Recording the run of ' + p.name, r)
  }
  const r = await cli($, ['proc', 'find', ...p.words.split(/\s+/), '--project', cwd, '--json'])
  return r.ok ? findText(r.json, p.words) : failed('Finding a procedure', r)
}

/* ---- wiring ------------------------------------------------------------ */

/* The tool's own arguments, without the envelope the engine adds. */
function toolInput(e: any): any {
  const { tool: _t, tool_use_id: _u, agentId: _a, requestMeta: _m, consent: _c, ...input } = e
  return input
}

const subagentAsk = (n: string) => "ask refused: a subagent's question goes to the session that dispatched it, not to " + n + '. '
  + 'Send it there (a message to main, or in your final result) and carry on with what does not need the answer.'
const subagentOverride = (n: string) => 'override refused: a subagent never asks ' + n + ' for an override; report it to your session '
  + '(a message to main, or in your final result), which decides whether the change qualifies and asks.'
const toolFailed = ($: any, e: any, next: any) => ({ deny: PLUGIN + ': the tool failed before it answered; nothing may have been written. Check with the CLI.' })

export const register: Register = (on: any) => {
  /* the switch. Set before the settings hooks run (measured: this hook
     runs first), so the SessionStart summary and both inbox drains stay silent. */
  on('classic.SessionStart', async ($: any, e: any, next: any) => {
    await $.env.set('ASKERDO_MOD', '1')
    seam.env = undefined
    if (e.source === 'clear' && mem.clearedFrom) void settle($).catch(() => {})
    if (e.source === 'resume' || e.source === 'fork') carry.resumed = 'prime'
    return next(e)
  }).catch(($: any, e: any, next: any) => next(e))

  on('session.start', async ($: any, e: any, next: any) => {
    const res = await next(e)
    /* a managed install skips classic hooks: the drains still go quiet here */
    try { await $.env.set('ASKERDO_MOD', '1') } catch {}
    mem.cwd = e.cwd
    seam.env = undefined
    await registerAll($)
    /* the first id read checks the app row's holds */
    void sessionId($).catch(() => {})
    void queueRead($).catch(() => {})
    startPoll($)
    /* the load reads the guard (and gives an opted-in track its marker) and delivers */
    kick($)
    /* the procedure scan starts here, so the first tool call never waits for it */
    void procCards($).catch(() => {})
    void decisionRows($).catch(() => {})
    void pruneKept($).catch(() => {})
    where.paneRead = false
    void readWhere($).catch(() => {})
    return res
  })

  /* delivery's idle or running: the main loop's turn */
  on('turn.start', async ($: any, e: any, next: any) => {
    if (e.agentId === undefined) {
      await followFolder($).catch(() => {})
      void readWhere($).catch(() => {})
    }
    const r = await next(e)
    if (e.agentId === undefined) {
      void flightSweep($).catch(() => {})
      mem.turn = (r && r.turnId) || e.turnId
      current.steps = []
      /* what waited and no typed prompt carried is a note at this turn's next step; after a
         typed prompt's take nothing is left to take (one localhost call a prompt) */
      if (inbox.prompted) inbox.prompted = false
      else void deliver($).catch(() => {})
    }
    return r
  })

  on('turn.complete', async ($: any, e: any, next: any) => {
    if (e.agentId === undefined) {
      /* a telling no reply carried draws under the turn's last text row */
      const t = thisTurn()
      await placeTelling($, unplaced(), t.last, t.lastKey).catch(() => {})
      /* the reply's checks */
      await replyCheck($, e).catch(() => {})
      mem.turn = undefined
      inbox.prompted = false
      /* a reply closed finished freezes the band until a reply that is not */
      if (!e.isAborted) {
        const sid = await sessionId($).catch(() => mem.id)
        const was = closedAs(sid)
        if (sid && closedFinished(e.answer)) { if (closedAs(sid) !== 'handed off' && was !== 'finished') await keepClosed($, sid, 'finished') }
        else if (was === 'finished') await keepClosed($, sid)
        /* the band's closed line follows; a reopened session's poll picks up at its next tick */
        if (closedAs(sid) !== was) { try { $.ui.invalidate('ui.render') } catch {} }
      }
    } else {
      try { flightEnd($, e.agentId) } catch {}
      void laneEnd($, e.agentId, String(e.answer || '')).catch(() => {})
    }
    return next(e)
  })

  /* a move while idle redraws the band at once; a shell cd leaves the root alone */
  on('classic.CwdChanged', async ($: any, e: any, next: any) => {
    void followFolder($).catch(() => {})
    return next(e)
  }).catch(($: any, e: any, next: any) => next(e))

  /* the engine pushes the figures; nothing polls them */
  on('session.measure', ($: any, e: any, next: any) => {
    void depthCheck($, depthReading(e.context)).catch(() => {})
    setRates($, e.rateLimits)
    return next(e)
  })

  /* each step's own usage: an agent's depth, and the main loop's between measures */
  on('turn.step', async function* ($: any, e: any, next: any) {
    const r = yield* next(e)
    try {
      if (e.agentId !== undefined) {
        const f = flight.get(e.agentId)
        const t = agentTokens(r && r.usage)
        if (f && t) { f.tokens = t; flightRedraw($) }
        void agentCheck($, e.agentId, r && r.usage).catch(() => {})
      }
      else if (marks.window) void depthCheck($, readingFrom(r && r.usage, marks.window)).catch(() => {})
    } catch {}
    return r
  })

  /* hardDeny past the hard floor: only the agent's state note passes (agent-depth.mjs) */
  on('tool.call', async ($: any, e: any, next: any) => {
    /* an Agent dispatch is flagged against the user's dispatch rules, never
       blocked; a shell call of the hub CLI, from either shell, engages the session */
    let hub = false
    try {
      /* an agent's own commits belong to its dispatch */
      if (e.agentId === undefined) trackWork(e)
      if (e.agentId === undefined) await onboardSeen($, e)
      /* the turn's steps, for the handoff kept current */
      if (e.agentId === undefined) await currencyStep($, e.tool, toolInput(e))
      if (AGENT_TOOLS.includes(e.tool)) {
        await dispatchFresh($, e.tool_use_id)
        await agentFlag($, toolInput(e), e.tool_use_id).catch(() => {})
      }
      else if (COMMAND_TOOLS.includes(e.tool) && isHubShell(toolInput(e).command)) hub = true
      /* a call matching a procedure's trigger points the model at its file */
      if (COMMAND_TOOLS.includes(e.tool) || FILE_TOOLS.includes(e.tool)) {
        await procWatch($, e).catch(() => {})
        /* and one touching a decision's files or commands, at that decision */
        await decisionWatch($, e).catch(() => {})
      }
    } catch {}
    /* an agent reports an override to its session, which decides whether it qualifies */
    if (hub && e.agentId !== undefined && isHubOverride(toolInput(e).command)) return { deny: subagentOverride(await userName($)) }
    /* a plain session's question stays with it, so a CLI register is refused */
    if (hub && isHubRegister(toolInput(e).command)) {
      await boundTrack($).catch(() => null)
      if (!(await isEngaged($).catch(() => true))) return { deny: plainRegister }
    }
    const a = e.agentId ? agents.get(e.agentId) : undefined
    const g = guard.state
    /* an agent's calls and the tool it is in, for the status row's card and Home */
    const f = e.agentId !== undefined ? flight.get(e.agentId) : undefined
    if (f && !f.done) { f.calls++; flightRedraw($) }
    if (!a || !a.deny || !g || !g.on || !g.hardDeny || isStateNoteCall(e.tool, toolInput(e))) {
      if (f && !f.done) f.tool = e.tool
      /* engaged after the call runs, so a binding it makes narrows the first draw */
      let res: any
      try { return (res = await next(e)) } finally {
        if (hub) engage($)
        /* a close run from the shell lists the inbox it leaves; its ids ride the turn */
        if (hub && e.agentId === undefined && res && res.result) {
          const c = closedInbox(toolInput(e).command, res.result.stdout)
          if (c) keepInbox(c.track, c.ids, !!c.more)
        }
        if (f && f.tool === e.tool) { f.tool = undefined; flightRedraw($) }
      }
    }
    return { deny: agentDenyReason({ tokens: a.tokens, guard: g, note: '' }) }
  }).catch(($: any, e: any, next: any) => next(e))

  /* every spawned agent's prompt gets the rules in force
     appended; a workflow's or a resume's prompt is fixed, and nothing is refused */
  on('agent.spawn', async ($: any, e: any, next: any) => {
    await dispatchFresh($, e.tool_use_id)
    if (e.workflow || e.resume) {
      const res = await next(e)
      flightStart($, e, res)
      return res
    }
    /* the rulings on the dispatch's tasks follow the rules block */
    const [r, ruled] = await Promise.all([readRules($).catch(() => null), dispatchDecisions($, e).catch(() => '')])
    /* the agents' block, without the lines for the session alone */
    const prompt = withDecisions(withRules(e.prompt, r && r.agents ? { ...r, ...r.agents } : r), ruled)
    const res = await (prompt === e.prompt ? next(e) : next({ ...e, prompt }))
    laneStart(e.tool_use_id, res && res.agentId)
    flightStart($, e, res)
    return res
  }).catch(($: any, e: any, next: any) => next(e))


  on('session.end', async ($: any, e: any, next: any) => {
    if (e.reason === 'clear') {
      mem.clearedFrom = e.sessionId
      seam.env = undefined
      try { $.clock.after(250, () => { void settle($).catch(() => {}) }) } catch {}
    } else await endRow($, e.sessionId).catch(() => {})
    return next(e)
  })

  on('prompt.submit', async ($: any, e: any, next: any) => {
    if (mem.clearedFrom) await settle($).catch(() => {})
    else await recheckRow($).catch(() => {})
    /* the user's own prompt (not a command, not a plugin's) lifts the freeze */
    const kind = e.origin && e.origin.kind
    /* a started session's first prompt (not typed) runs its whole /askerdo resume line */
    const started = (await startedResume($, e).catch(() => '')) || (await sentCommand($, e).catch(() => ''))
    if (!e.command && !e.isMeta && (!kind || kind === 'composer' || kind === 'bridge')) await liftFreeze($, await sessionId($)).catch(() => {})
    if (namesBoardId(e.text)) engage($)
    /* a typed /askerdo:onboard runs the skill with no Skill call */
    if (e.command && ONBOARD.test(String(e.command))) onboarding.add(await sessionId($))
    /* a take-over elsewhere is told at the next prompt, once. While the long poll
       holds, each band load has read the held track; else it is read here */
    let lostNote = ''
    if (!e.command && !e.isMeta && mem.track && !wait.live) await readMine($, await sessionId($)).catch(() => null)
    if (lease.lost && !e.command && !e.isMeta) { lostNote = lostTrackNote(lease.lost); lease.lost = undefined }
    /* the profiles revision, once a prompt of any origin, before its compose reads the rules */
    await profilesRev($, true).catch(() => {})
    /* an engaged session files its kept questions and tells the labels; a typed
       L1a goes to the session, which records each token with the answer tool */
    const typed = !e.command && !e.isMeta
    const renamed = typed ? await renamedNote($).catch(() => '') : ''
    /* what waits rides the prompt; a command line takes no rewrite */
    const note = [started, lostNote, renamed, typed ? await promptNote($).catch(() => '') : ''].filter(Boolean).join('\n\n')
    afterPrime($)
    await carryCheck($).catch(() => {})
    const resumed = await resumeBlocks($).catch(() => '')
    if (resumed) {
      const told = note && !e.isMeta ? { text: note + '\n\n' + e.text } : {}
      return next({ ...e, ...told, context: [...(e.context || []), ...(note && e.isMeta ? [note] : []), resumed] })
    }
    /* the engine keeps a hidden prompt's text as it came (a peer's message), so its note rides as context */
    if (note && e.isMeta) return next({ ...e, context: [...(e.context || []), note] })
    return !note ? next(e) : next({ ...e, text: note + '\n\n' + e.text })
  }).catch(($: any, e: any, next: any) => next(e))

  /* the command answers itself: no model turn */
  on('command.run', { command: 'askerdo' }, ($: any, e: any) => runAskerdo($, e)).catch(commandFailed)

  /* the alias's name is the person's, so this hook reads every run and passes
     on all but that one */
  on('command.run', async ($: any, e: any, next: any) => {
    if (e.command === COMMAND) return next(e)
    const name = await aliasName($)
    if (!name || e.command !== name) return next(e)
    return runAskerdo($, e)
  }).catch(($: any, e: any, next: any) => next.called ? next(e) : commandFailed())

  /* once the engine runs, the typeahead offers the mod's command beneath the
     app's own rows; before the first submit nothing of the mod's is listed */
  on('prompt.autocomplete', async ($: any, e: any, next: any) => {
    const r = await next(e)
    const mine = commandSuggestions(e, [COMMAND, alias.name || ''])
    return mine.length ? { suggestions: [...((r && r.suggestions) || []), ...mine] } : r
  }).catch(($: any, e: any, next: any) => next.called ? { suggestions: [] } : next(e))

  on('tool.call', { tool: 'mcp__askerdo__ask' }, async ($: any, e: any) => {
    /* a subagent's question is for the session that dispatched it */
    if (e.agentId !== undefined) return { deny: subagentAsk(await userName($)) }
    await settle($).catch(() => {})
    const r = await askTool($, toolInput(e), e.tool_use_id, [...thisTurn().asks])
    /* the telling waits for the reply that carries its block, or the turn's end */
    if (e.tool_use_id && told.has(e.tool_use_id)) thisTurn().asks.push(e.tool_use_id)
    return r
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__override_request' }, async ($: any, e: any) => {
    if (e.agentId !== undefined) return { deny: subagentOverride(await userName($)) }
    await settle($).catch(() => {})
    const r = await overrideTool($, toolInput(e), e.tool_use_id, [...thisTurn().asks])
    /* the card draws as a question's does */
    if (e.tool_use_id && told.has(e.tool_use_id)) thisTurn().asks.push(e.tool_use_id)
    return r
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__note' }, async ($: any, e: any) => {
    await settle($).catch(() => {})
    mem.engaged = true
    return noteTool($, toolInput(e))
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__answer' }, async ($: any, e: any) => {
    await settle($).catch(() => {})
    return answerTool($, toolInput(e))
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__decide' }, async ($: any, e: any) => {
    await settle($).catch(() => {})
    mem.engaged = true
    return decideTool($, toolInput(e))
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__task_update' }, async ($: any, e: any) => {
    await settle($).catch(() => {})
    mem.engaged = true
    const input = toolInput(e)
    const r = await taskTool($, input)
    /* a take in hand or a start puts the turn's work on the track before the band reloads */
    if (!r.deny && (input.inHand === true || input.status === 'in_progress' || input.agent !== undefined)) checks.holding = true
    return r
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__handoff_write' }, async ($: any, e: any) => {
    await settle($).catch(() => {})
    return handoffTool($, toolInput(e), e.agentId)
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__handoff_update' }, async ($: any, e: any) => {
    await settle($).catch(() => {})
    mem.engaged = true
    return updateTool($, toolInput(e))
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__depth' }, async ($: any, e: any) => depthTool($)).catch(toolFailed)

  /* the band draws on the terminal and desktop surfaces only */
  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any, next: any) => {
    drawnOn.add(e.surface)
    /* a hot reload lost the memory: read it back; the status row draws meanwhile, the band after */
    if (!band.loaded) {
      startPoll($)
      kick($)
    }
    /* the band is the queue; the meters, the guard and the
       thread draw on the status line under the prompt. On the
       desktop, which has no hint line, they are the band's last row, drawn always */
    const els = $.ui.resolve(e)
    const desk = e.surface === 'desktop'
    const sm = desk ? statusOf($) : null
    const status = sm ? handedKeys(statusTree(els, sm, null, { columns: e.props.bodyColumns, surface: e.surface, ...statusPresses($) }), e.surface) : null
    /* the band never yields to the app's box; under it, the band
       draws above the box, which stays nearest the prompt */
    const short = !!e.props.hasSurvey
    const b = band.loaded ? bandParts($) : null
    const ours = b && b.model && handedKeys(bandTree(els, b.model, b.answer, {
      columns: e.props.bodyColumns, rows: e.props.maxRows - (status ? 1 : 0), now: Date.now(), short, surface: e.surface,
      open: b.open, submit: b.submit, send: b.send, press: b.press, fold: b.fold,
    }), e.surface)
    /* nothing open or waiting: no band, and the app's content still draws */
    if (!ours && !status) return next(e)
    if (!short && !status && !desk) return ours
    const theirs = short || !ours ? await next(e) : null
    /* a half line between the band and the status row on the desktop, never
       before the app's slot (an empty block there, so its gap would draw an empty row); BAND_INSET on the left lines the mark's ink up with the composer's + (desktop-capabilities 2f) */
    const rows = [ours, status].filter(Boolean)
    const ownRows = desk && theirs && rows.length > 1 ? [els.Box({ key: 'band-rows', flexDirection: 'column', rowGap: 1, children: rows })] : rows
    const gap = desk ? { ...(theirs ? {} : { rowGap: 1 }), paddingLeft: BAND_INSET } : {}
    return els.Box({ key: 'band-and-box', flexDirection: 'column', ...gap, children: [...ownRows, theirs].filter(Boolean) })
  })

  on('ui.render', { component: 'PromptHint' }, ($: any, e: any, next: any) => statusDraw($, e, next))

  /* a press on the band or the status line hands the focus off its button (handOff) */
  on('ui.press', ($: any, e: any, next: any) => {
    handOff(e)
    return next(e)
  }).catch(($: any, e: any, next: any) => next(e))

  /* one AskerDo pane; a pane saved under an id from before the tabs draws it too */
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($: any, e: any) => paneDraw($, e))
  on('ui.render', { component: 'Pane', requestId: OLD_PANE_IDS[0] }, ($: any, e: any) => paneDraw($, e))
  on('ui.render', { component: 'Pane', requestId: OLD_PANE_IDS[1] }, ($: any, e: any) => paneDraw($, e))

  /* the engine's own dialog with rewritten props, so it still collects the answer */
  on('ui.render', { component: 'AskUserQuestion' }, ($: any, e: any, next: any) => {
    const questions = decisionQuestions(e.props && e.props.questions)
    return questions ? next({ ...e, props: { ...e.props, questions } }) : next(e)
  })

  /* the band carries the queue; with saved options the whole mod section
     (builder.js) rides the prompt, so no-mod sessions keep the style alone */
  on('prompt.compose', async ($: any, e: any, next: any) => {
    const main = !(e.traits || []).some((t: string) => t === 'teammate' || t === 'analysis')
    if (main) carry.facts = { surfaces: e.surfaces, tools: e.tools }
    const res = await next(e)
    if (!main) return res
    mem.surfaces = e.surfaces
    const blocks = await modBlocks($, e.surfaces, e.tools)
    /* the carrier section holds them; one answered before a change (or before the
       mod loaded) is asked again next turn */
    if (res.sections.some((s: any) => s.id === CARRIER)) {
      if (carry.resumed !== 'primed' && carry.text !== joined(blocks)) invalidateCarrier($)
      return res
    }
    /* no carrier (a bare prompt, rendered fresh every request): appended */
    return blocks.length ? { sections: [...res.sections, ...blocks] } : res
  })

  on('prompt.section', { name: CARRIER }, async ($: any, e: any, next: any) => {
    const res = await next(e)
    if (carry.resumed === 'prime') { carry.resumed = 'primed'; return res }
    const f = carry.facts || { surfaces: mem.surfaces || [], tools: [] }
    const text = joined(await modBlocks($, f.surfaces, f.tools))
    carry.text = text
    const core = res && typeof res.text === 'string' ? res.text : ''
    return text ? { text: core ? core + '\n\n' + text : text } : res
  })

  /* The first telling: the question as the pane's card under the reply
     that tells it, not on the ask tool's row, which the transcript collapses; any
     other reply is the engine's. */
  on('ui.render', { component: 'AssistantMessage' }, async ($: any, e: any, next: any) => {
    await loadTellAt($)
    const uses = tellAt.get(e.requestId) || tellAt.get(textKey(e.props && e.props.text) || '')
    if (!uses || !uses.length) return next(e)
    if (uses.some((u) => !told.has(u))) await loadTold($)
    const els = $.ui.resolve(e)
    const vw = e.viewport && e.viewport.columns
    /* the card is sized in its own cells, as the pane's copy is from bodyColumns */
    const columns = !vw ? undefined : (e.surface === 'desktop' ? Math.floor(vw * DESK_CELL) : vw) - REPLY_INDENT
    /* this session asked it, so the head names the session and the age as the pane does */
    const sid = mem.id || await sessionId($).catch(() => undefined)
    const now = Date.now()
    const cards: any[] = []
    const drawn: any[] = []
    let fresh = false
    for (const useId of uses) {
      const q = told.get(useId)
      /* an override request's slim card, its block hidden as a question's is */
      if (q && q.override) {
        drawn.push(q)
        cards.push(overrideTellingTree(els, overrideCard(q, ovPressing.get(useId)), (d: string) => { void overridePress($, useId, q, d).catch(() => {}) }, e.surface, columns))
        continue
      }
      const c = q && firstTellingCard(q, sid, now, band.local)
      if (!c) continue
      drawn.push(q)
      /* a filed question's reply still names its local label */
      if (q.was) drawn.push({ ...q, id: q.was })
      /* reworded since, the card is its one changed line, which follows nothing more;
         none where this reply also carries the current telling (asked and reworded in one turn) */
      const stub = changedStub(q)
      if (stub && uses.some((u) => { const o = told.get(u); return o && o !== q && (q.key ? o.key === q.key : o.id === q.id) && !changedStub(o) })) continue
      /* a card drawn live is followed from the band's reads, never read here */
      if (!stub && !q.answered && (!q.ended || q.snoozed) && !follow.drawn.has(useId)) { follow.drawn.add(useId); fresh = true }
      const act = cardActions($, (id: string, letter: string) => { void tellingPick($, useId, q, letter).catch(() => {}) },
        (verb) => { void tellingEnd($, useId, q, verb).catch(() => {}) },
        { site: 'card', useId, key: q.key, local: !!q.local, version: q.local ? undefined : q.version || 1 })
      act.open = (id: string) => { void openPane($, 'questions', id).catch(() => {}) }
      cards.push(firstTellingTree(els, c, qpane, act, { columns, answered: q.answered, ended: q.ended, surface: e.surface, changed: stub ? stub.line : undefined, here: hereNow() }))
    }
    /* first drawn after the band loaded (a reload, an old reply scrolled to): one follow now */
    if (fresh && band.loaded) {
      try { $.clock.after(0, () => { void followRun($).then((m) => { if (m) qpaneRedraw($) }).catch(() => {}) }) } catch {}
    }
    if (!cards.length) return next(e)
    /* the desktop, where the card is measured to draw, draws the reply without
       the question's block; the stored message and every other screen keep it */
    const text = e.props && typeof e.props.text === 'string' ? e.props.text : ''
    const shown = e.surface === 'desktop' && text && !e.props.isSummary ? hideTold(text, drawn) : text
    return underReply(els, await next(shown !== text ? { ...e, props: { ...e.props, text: shown } } : e), cards.map((c) => handedKeys(c, e.surface, true)))
  })

  /* the main loop's text rows; a telling sits under the one carrying its block */
  on('session.append', { door: 'response' }, async ($: any, e: any, next: any) => {
    const r = await next(e)
    if (e.agentId === undefined) afterPrime($)
    try {
      const texts = textsOf((r && r.message) || e.message)
      if (e.agentId === undefined && texts.some((t) => t.trim())) {
        const t = thisTurn()
        t.last = (r && r.uuid) || e.uuid
        t.lastKey = textKey(texts.join('\n'))
        const carried = unplaced(texts.join('\n'))
        if (carried.length) void placeTelling($, carried, t.last, t.lastKey).catch(() => {})
      }
    } catch {}
    return r
  }).catch(($: any, e: any, next: any) => next(e))

  /* each reply as stored, read at its turn's end; flagged, never rewritten */
  on('session.append', async ($: any, e: any, next: any) => {
    const r = await next(e)
    try {
      if (e.agentId === undefined && e.door === 'response') checks.texts.push(...textsOf((r && r.message) || e.message))
    } catch {}
    return r
  }).catch(($: any, e: any, next: any) => next(e))

}
