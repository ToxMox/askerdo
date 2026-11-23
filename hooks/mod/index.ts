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
  USAGE, answerArgs, coverageArgs, parseAnswer, parseAskerdo, parseResume, parseTrack, reviewCoversArgs, shelfText, taskEditArgs, trackAlert, trackText,
  threadNameOf, token, unquote, validateAsk, validateHandoff, waitingKeys, waitingToast,
  commandLead, heldText, lostTrackNote,
  AGENT_TOOLS, ASK_TOOL, agentChecks, firstTellingCard, flagLine, flagNote, isHubShell, movesTrack, namesBoardId, replyChecks,
} from '../../lib/mod-core.mjs'
import { clashText, toldClash } from '../../lib/mod-core.mjs'
import { closedFinished, inboxWaiting, withWaiting } from '../../lib/mod-core.mjs'
import { withColumns } from '../../lib/mod-core.mjs'
import { bandDropFacts, cutFact } from '../../lib/mod-core.mjs'
import { ageText } from '../../lib/mod-core.mjs'
import { receiptRow, receiptsOf } from '../../lib/mod-core.mjs'
import { changedStub, rewordResult, rewordedSince } from '../../lib/mod-core.mjs'
import { agentsBlockFor, briefPaths, dispatchRoles, withRules } from '../../lib/mod-core.mjs'
import { dispatchMissed, handedOn, laneNote, latestLane, tasksOfDispatch } from '../../lib/mod-core.mjs'
import { commandSuggestions } from '../../lib/mod-core.mjs'
import { checksWords, copiedWords } from '../../lib/mod-core.mjs'
import { pairRefused, placeArgs, placedWords, placeRefusal, refusedLeft } from '../../lib/mod-core.mjs'
import { cardHref, recordHref, signedRoot } from '../../lib/mod-core.mjs'
import { DRAWN_PARTS, depthOpen, drawnText } from '../../lib/mod-core.mjs'
import { commandLine, depthAnswer, editWords, filedWords, peerBody, resumeLine, rewoundNote, wholePercent } from '../../lib/mod-core.mjs'
import { handoffCheckLine, verifyLines } from '../../lib/mod-core.mjs'
import { noBandHere, noBandSection, surfacePick } from '../../lib/mod-core.mjs'
import { carriesTold, resumeBlock, tellBlock, tellingParts } from '../../lib/mod-core.mjs'
import { capFirst, keepWhole, nameOf } from '../../lib/mod-core.mjs'
import { carryBlock, offlineLine, withOffline } from '../../lib/mod-core.mjs'
import { feedRows, updatedText } from '../../lib/mod-core.mjs'
import { hubLauncherAt, isHubRegister, isLocalId, localCard, localEvent, localResult, pruneLocal, withLocal } from '../../lib/mod-core.mjs'
import { agentsHeadLive, agentsTree, askerdoPane, backgroundTree, bgRows, fitRow, graphTree, homeTree, paneTitle, standLine, stopWords, unreadLine, whereFacts, whereParts } from './home.tsx'
import { freshField, newSettingsView, settingsTree } from './settings.tsx'
import type { SettingsPlace } from './settings.tsx'
import type { Where } from './home.tsx'
import type { PaneTab } from './home.tsx'
import type { FlightCut } from './home.tsx'
import { DRAW_CEILING, DRAW_NEAR, countsUnder, pageCounts } from '../../lib/mod-core.mjs'
import { overrideTellingTree, underReply } from './questions.tsx'
import { heldTrack, homeGraph, localUrl, mineOf, statusModel, versionWords } from '../../lib/mod-core.mjs'
import { answeringOf } from '../../lib/mod-core.mjs'
import { actLabel, callPressText, parseOverride } from '../../lib/mod-core.mjs'
import { briefDecisionIds, forgedFiling, hubAnswers, namesQuestion, placedRelay, userMarked, isHubFactWrite, isHubOverride, isHubTaskWrite, overrideArgs, overrideCard, overrideOn, overrideResult, overrideTold } from '../../lib/mod-core.mjs'
import { FG_SHOW_MS, LIVE_AGENT, agentsModel, heldOver, heldWaitOf, agentsSegment, backgroundModel, bgRebuilt, flightsKept, flightsRebuilt, handoffOthers, handoffWrites, runningNames, runningWork, taskEnds } from '../../lib/mod-core.mjs'
import { blockSettled, continueLineOf, dispatchRunBlock, heldRunsRefusal, keptStateNote, liveRunIds, replyAsks, reportsIn, runEndHow, settleWords, stateNoteNamed, stopReadyWords, stopSettleWords } from '../../lib/mod-core.mjs'
import { closedInbox, commitsIn, dueAway, hubRan, inboxLeft, offTrackSlip } from '../../lib/mod-core.mjs'
import { leftCalls, leftNote } from '../../lib/mod-core.mjs'
import { noteHolder, noteWaits } from '../../lib/sender-words.mjs'
import { rewriteOffer, droppedTexts, droppedWords, amendedWords, titleLine } from '../../lib/note-scope.mjs'
import { LINK_VERB, captureCommit, headsOf, repoCandidates, shaHint } from '../../lib/commit-capture.mjs'
import { inboxLines, staleToolsLine, wakeIn } from '../../server/handoff-text.mjs'
import { asleepWake, holdOn, settles } from '../../server/web/draw.mjs'
import { STOP_FIRST, handoffCurrency, stepChanges, stepTool } from '../../lib/mod-core.mjs'
import { updateProblems, wrappedLine } from '../../lib/handoff-payload.mjs'
import { AGENTS_COUNT, AGENTS_LINE, AGENT_LINE, CARD_COUNT, CARD_LINE, agentLive, countLive, liveSetsBook, partsLive, statusFrame, statusRow } from './status.tsx'
import type { StatusRow } from './status.tsx'
import { type NeedsDrop, bandTree, rowQuestion } from './band.tsx'
import { checkHealth, health, healthDue, healthStale, sawLocal } from './health.ts'
import { healthCall, withHealth } from '../../lib/mod-core.mjs'
import { paneLoading, paneTree, rowCuttable } from './pane.tsx'
import { GUIDE_HOME, guideIndex, guideTree } from './guide.tsx'
import type { GuidePage } from './guide.tsx'
import type { PaneView, TracksTrim } from './pane.tsx'
import { firstTellingTree, pinnedOf, questionsLoading, questionsTree, ringKey } from './questions.tsx'
import type { QuestionsActions, QuestionsTrim, QuestionsView } from './questions.tsx'
import { COMMAND_TOOLS, FILE_TOOLS, checkText, findText, matchCall, parseProc, procNote, procToast, ranText, recordsRun, scanText, testRun } from '../../lib/proc-match.mjs'
import { READ_TOOLS, SEARCH_TOOLS, callSubject, decisionHits, turnCommands } from '../../lib/decision-match.mjs'
import { decideArgs, factArgs, decidedText, decisionsBlock, pointerNotes, pointerToast, withDecisions } from '../../lib/mod-core.mjs'
import { taskBlocks } from '../../lib/mod-core.mjs'
import { runsInCaller } from '../../lib/caller-runs.mjs'

/* the thread's clock as this copy's first line runs, after the engine has read, scanned and
   compiled its files; its first band read sends it for the timings */
const FIRST_LINE = performance.now()
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
type Run = { ok: boolean; code: number; out: string; err: string; json?: any; stale?: string; late?: boolean }

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
  /* the engine's word for how this process's session began (SessionStart source), compact aside */
  started?: string
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
  qpaneRedraw($)
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
    if (out.ASKERDO_SANDBOX_HOME && env.ASKERDO_HELD_WAIT_MS !== undefined) out.ASKERDO_HELD_WAIT_MS = String(env.ASKERDO_HELD_WAIT_MS)
    return out
  }
  return undefined
}

/* Every call of the mod's goes through here; no root configured passes no env. The
   CLI and the scripts run on the local server's route; only a 409 runs in a process. */
async function seamEnv($: any): Promise<Record<string, string> | undefined> {
  const cwd = await projectDir($)
  if (!seam.env || seam.cwd !== cwd) {
    seam.cwd = cwd
    /* the shell checks know the seam root's own launcher */
    seam.env = readSeam($, cwd).catch(() => undefined).then(async (env) => {
      const h = env ? await hostEnv($).catch(() => ({} as Record<string, string>)) : {} as Record<string, string>
      hubLauncherAt(env && env.ASKERDO_ROOT, [h.USERPROFILE, h.HOME])
      return env
    })
  }
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
   (only a refused connect starts the process); 'late' past ROUTE_MS, which may have run too. */
/* the mod's own limit, so a call the host never ends holds nothing for good: past the
   long poll's 20 s hold, under the host's 30 s */
const ROUTE_MS = 25000
async function routeFetch($: any, base: string, path: string, init: any): Promise<any> {
  let timer: any
  try {
    const late = new Promise<'late'>((done) => { try { timer = $.clock.after(ROUTE_MS, () => done('late')) } catch {} })
    return await Promise.race([$.http.fetch(slashed(base) + path, init), late])
  } catch (err: any) {
    const why = String((err && (err.code || err.message)) || err)
    if (!NOBODY.test(why)) return 'dropped'
    markDown(base)
    return null
  } finally {
    try { if (timer) timer.cancel() } catch {}
  }
}
/* a call that may have run: dropped or late */
const lost = (r: any): boolean => r === 'dropped' || r === 'late'

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
const ROUTED_SCRIPTS = ['mod-alias', 'mod-contract', 'mod-inbox', 'mod-queue', 'rules', 'depth-marker', 'drift', 'mod-carrier', 'placement-press']

/* Which route runs an argv, or null for a process. */
function routeOf(argv: string[]): { path: string; args: string[] } | null {
  const script = String(argv[1] || '').replace(/\\/g, '/')
  if (argv[0] !== 'node') return null
  if (script.endsWith('/bin/askerdo.mjs')) return { path: 'cli', args: argv.slice(2) }
  const m = script.match(/\/scripts\/([a-z-]+)\.mjs$/)
  return m && ROUTED_SCRIPTS.includes(m[1]) ? { path: 'mod', args: [m[1], ...argv.slice(2)] } : null
}

async function routePost($: any, base: string, path: string, body: any): Promise<{ status: number; reply: any } | 'dropped' | 'late' | null> {
  const r = await routeFetch($, base, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r || lost(r)) return r
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
  /* started first, so status reads a live server; the post itself would be a 409 */
  if (which.path === 'cli' && runsInCaller(which.args)) return null
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
  if (r && !lost(r) && r.status === 200 && r.reply && r.reply.needStdin) r = await routePost($, live.base, which.path, { ...call, stdin: '' })
  if (r === 'dropped') return failedRun('the local server dropped the call')
  if (r === 'late') return { ...failedRun('the local server did not answer within ' + ROUTE_MS / 1000 + ' s'), late: true }
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
  held('cli ' + args[0])
  const out = String(r.stdout || '')
  const err = String(r.stderr || '').replace(/^AskerDo: /gm, '').trim()
  const run: Run = { ok: r.exitCode === 0, code: r.exitCode, out, err, ...(r.late ? { late: true } : {}) }
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

/* The row's entry names another id: a new process takes its holds once that id ended, or once that id's process
   mark is another's (a /clear the app ran in a new process); a headless child inherits its parent's mark in the
   environment, so it takes nothing while the parent runs. This process's own last id always. */
function rowCheck($: any, sid: string, before?: string): Promise<void> {
  if (row.checked === sid) return Promise.resolve()
  if (row.checking) return row.checking.then(() => rowCheck($, sid, before))
  row.checking = (async (): Promise<void> => {
    const host = await hostId($)
    let was: any = null
    if (host) { try { was = ((await $.store.get('rows')) || {})[host] || null } catch {} }
    if (was && typeof was.sid === 'string' && was.sid !== sid) {
      const tasks = (Array.isArray(was.tasks) ? was.tasks : []).filter((t: any) => /^T-\d+$/.test(String(t)))
      const mark = await procMark($)
      const theirs = was.sid === before ? mark : await markOf($, was.sid)
      const apart = !!theirs && theirs !== mark
      /* a fork or a resume goes on with another conversation, never this row's cleared one */
      const cleared = apart && !['fork', 'resume'].includes(String(mem.started || ''))
      const why = was.sid === before ? 'a new id in this process' : was.ended ? 'a restart after the earlier id ended'
        : cleared ? 'a new process after the earlier id\'s (a /clear)' : ''
      if (!why) {
        /* left unchecked, so the next prompt checks again once that id's end may have landed */
        debugLine($, 'AskerDo: the app row ' + host + ' names ' + was.sid + ', which has not ended, so ' + sid + ' took nothing of it yet'
          + ' (its process mark ' + (theirs || 'unknown') + ', this one ' + mark + ', start ' + (mem.started || 'unknown') + ')')
        return
      }
      let track: string | null = null
      let unread = false
      if (was.track) {
        /* only what the board still has under the old id moves, so nobody else's is taken */
        const m = await cli($, ['track', 'mine', '--session', was.sid, '--json'])
        if (m.ok && m.json && m.json.held && m.json.track === was.track) track = was.track
        unread = !m.ok
      }
      let moved: Moved | null = null
      if (apart) moved = await takeFromGone($, was.sid, sid, { track, name: was.name, tasks, why: why + ', app row ' + host })
      else if (was.track || tasks.length) {
        moved = await moveHolds($, was.sid, sid, track, tasks, why + ', app row ' + host)
        const note = rewoundNote({ track: moved.track, name: was.name, tasks: moved.tasks, cli: rootPath($, 'bin/askerdo.mjs') })
        if (note) noteLater(note)
      }
      /* left open, so the next prompt moves the rest as this process's own earlier id's */
      if (moved && unread) moved.left.track = was.track
      if (moved && leftAny(moved)) {
        rowRetry.from = was.sid
        await rowFollow($, was.sid, sid, moved).catch(() => {})
        return
      }
    }
    rowRetry.from = undefined
    row.checked = sid
  })().finally(() => { row.checking = undefined })
  return row.checking
}

/* the process mark the store keeps for an id (procSeen), else its flights' */
async function markOf($: any, sid: string): Promise<string> {
  try {
    const m = await procOf($, sid)
    if (m) return m
    const f: any = await $.store.get(FLIGHTS_KEY + sid)
    return f && typeof f.proc === 'string' ? f.proc : ''
  } catch { return '' }
}

/* An earlier id of this app row whose process is gone, as a reopen: its agents died with it, so each open agent run
   of it and of the ids it kept ends handed on as that session; then its holds move here, one note and one debug line */
async function takeFromGone($: any, from: string, to: string, held: { track: string | null; name?: string; tasks: string[]; why: string }): Promise<Moved> {
  const olds: any = await Promise.resolve($.store.get(RUN_SIDS_KEY + from)).catch(() => null)
  const lost: string[] = []
  for (const s of [...new Set([from, ...(Array.isArray(olds) ? olds.filter((x: any) => typeof x === 'string' && x) : [])])]) {
    const r = await localVerb($, 'sessionRuns', { input: { session: s }, session: s })
    for (const run of r.ok && r.result && Array.isArray(r.result.runs) ? r.result.runs : []) {
      if (!run || run.worker !== 'agent') continue
      if (run.agentId) agentsGone.add(String(run.agentId))
      const e = await localVerb($, 'endRun', { input: { run: run.run, how: 'handed_on' }, session: s })
      if (e.ok) lost.push(String(run.job || run.agentId || 'run ' + run.run) + (Array.isArray(run.tasks) && run.tasks.length ? ' on ' + run.tasks.join(', ') : ''))
    }
  }
  /* its flights and kept ids go with its process */
  await carryUnsettled($, from, to)
  try { await $.store.delete(FLIGHTS_KEY + from); await $.store.delete(RUN_SIDS_KEY + from) } catch {}
  if (!mem.lineage.includes(from)) mem.lineage.push(from)
  const moved: Moved = held.track || held.tasks.length ? await moveHolds($, from, to, held.track, held.tasks, held.why) : { track: null, tasks: [], left: { track: null, tasks: [] } }
  runTick.quiet = false
  debugLine($, 'AskerDo: ' + to + ' took over from ' + from + ' (' + held.why + '): ended ' + (lost.length ? lost.join('; ') : 'no agent run')
    + ', moved ' + ([moved.track, ...moved.tasks].filter(Boolean).join(', ') || 'nothing'))
  const note = rewoundNote({ track: moved.track, name: held.name, tasks: moved.tasks, lost, cli: rootPath($, 'bin/askerdo.mjs') })
  if (note) noteLater(note)
  return moved
}

/* the stop still refuses on an earlier id's unsettled runs, so they go on under the id that continues it */
async function carryUnsettled($: any, from: string, to: string): Promise<void> {
  let kept: Unsettled[] = []
  await unsettledEdit($, from, (list) => { kept = list; return [] })
  if (!kept.length) return
  await unsettledEdit($, to, (mine) => [...mine, ...kept.filter((x) => !mine.some((y) => y.run === x.run))])
}

/* A prompt under an id whose check was left open (the row's other id had not ended) checks again;
   a prompt that read a new id has just checked it. A move that failed names this process's earlier id. */
const rowRetry: { from?: string } = {}
async function recheckRow($: any): Promise<void> {
  const was = mem.id
  const sid = await sessionId($)
  if (sid && sid === was && !mem.clearedFrom && row.checked !== sid) await rowCheck($, sid, rowRetry.from)
}
const leftAny = (m: { left: { track: string | null; tasks: string[] } }) => !!(m.left.track || m.left.tasks.length)

/* lines naming session ids go to the debug log, since the desktop app draws every
   transcript log line for the user */
function debugLine($: any, text: string): void {
  try { $.ui.log(text, { to: 'debug' }) } catch {}
}

/* The tasks the board still has in hand with `from`, then the track (checked by the caller),
   move to `to`, one log line saying what moved. Tasks first: the track's take-over ends the
   old holder's runs on its tasks, which would leave no hand to move. left: what a failed take
   left with `from`, for the row to keep and the next prompt to try again. */
type Moved = { track: string | null; tasks: string[]; left: { track: string | null; tasks: string[] } }
async function moveHolds($: any, from: string, to: string, track: string | null, tasks: string[], why: string): Promise<Moved> {
  const out: Moved = { track: null, tasks: [], left: { track: null, tasks: [] } }
  for (const t of tasks) {
    const s = await cli($, ['show', t, '--json'])
    if (!s.ok || !s.json) { out.left.tasks.push(t); continue }
    if (s.json.inHand !== from) continue
    /* the same session going on: its own agents' runs on the task stay open under `from` */
    const r = await cli($, ['task', 'update', t, '--in-hand', '--take-over', '--continues', from, '--session', to, '--json'])
    if (r.ok) out.tasks.push(t)
    else out.left.tasks.push(t)
  }
  /* a task left behind waits with the track: the track's take would end the hand the retry moves */
  if (track && out.left.tasks.length) { mem.track = undefined; out.left.track = track }
  else if (track) {
    /* the same session going on under a new id keeps the lease's since, so the user's hold stands */
    const r = await cli($, ['resume', track, '--take-over', '--continues', from, '--session', to, '--json'])
    if (r.ok && r.json.acquired) {
      setTrack(r.json.track, r.json.key)
      await writeMarker($, to)
      out.track = r.json.track
    } else { mem.track = undefined; out.left.track = track }
  }
  const what = [out.track, ...out.tasks].filter(Boolean)
  const left = [out.left.track, ...out.left.tasks].filter(Boolean)
  debugLine($, 'AskerDo: moved ' + (what.length ? what.join(', ') : 'nothing') + ' from ' + from + ' to ' + to + ' (' + why + ')'
    + (left.length ? '; the take failed for ' + left.join(', ') + ', tried again at the next prompt' : ''))
  kick($, true)
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

/* a /clear in this process renames the row's entry at once, so a reload before the next band load
   cannot leave it naming the earlier id. A mark test cannot do it: a child process inherits the mark */
async function rowFollow($: any, from: string, to: string, moved: Moved): Promise<void> {
  const host = await hostId($)
  if (!host) return
  let was: any = null
  try { was = ((await $.store.get('rows')) || {})[host] || null } catch {}
  /* a failed take leaves the entry naming `from` with what it still holds, which recheckRow moves */
  const left = moved.left
  if ((left.track || left.tasks.length) && (!was || was.sid === from)) {
    const kept = left.track && was && was.track === left.track && was.name ? String(was.name) : ''
    Object.assign(row, { sid: from, track: left.track, name: kept, tasks: left.tasks })
    await saveMarks($, host, { sid: from, track: left.track, ...(kept ? { name: kept } : {}), tasks: left.tasks }, 'rows')
    return
  }
  if (!was || was.sid !== from) return
  const name = moved.track && was.track === moved.track && was.name ? String(was.name) : ''
  const v = { sid: to, track: moved.track, ...(name ? { name } : {}), tasks: moved.tasks }
  Object.assign(row, { sid: to, track: moved.track, name, tasks: moved.tasks })
  row.kept = JSON.stringify(v)
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
  /* a read in flight is of the old folder: its answer must not land here */
  drift.gen++
  drift.line = null
  drift.key = undefined
  drift.watch = []
  kick($, true)
  void readWhere($).then(() => readDrift($)).catch(() => {})
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
    laterRedraw($)
    await retitle($)
  }
}

/* the drift line on Home, read at the session's start and again at a band load
   once what it reads moved: the folder, a profile, a doctor or onboard run, CLAUDE.md, AGENTS.md or a
   path the line names. A few stats per load, the read itself never per turn or on a timer.
   Off when the rules say doctor.drift is false; no band, no toast */
const drift: { key?: string; watch: string[]; checking?: boolean; again?: boolean; line: { text: string; doctor: boolean } | null; gen: number } = { watch: [], line: null, gen: 0 }
async function driftKey($: any, root: string): Promise<string> {
  const near = band.near || {}
  const stamps = await Promise.all(['CLAUDE.md', 'AGENTS.md', ...drift.watch].map(async (f) => {
    try { const st = await $.fs.stat(root + '/' + f.replace(/\/+$/, '')); return f + ':' + st.size + ':' + st.mtimeMs } catch { return f + ':-' }
  }))
  return [root, guard.profilesAt ?? '', near.cardsAt ?? '', ...stamps].join('|')
}
async function readDrift($: any): Promise<void> {
  const root = where.now && where.now.root
  /* after the band's first load too, which carries the held track the rules read keys on */
  if (!root || !band.loaded) return
  /* a call during a read runs once after it, so a folder's move is never left unread */
  if (drift.checking) { drift.again = true; return }
  drift.checking = true
  try {
    if ((await driftKey($, root)) === drift.key) return
    const gen = ++drift.gen
    /* the prompt's own cached rules read; with no board the setting is its default, on */
    const b = await readRules($).catch(() => null)
    if (gen !== drift.gen) return
    let line: any = null
    if (!(b && b.values && b.values['doctor.drift'] === false)) {
      const r = await spawn($, ['node', $.plugin.root + '/scripts/drift.mjs', '--root', root], { timeoutMs: 15000, stdin: JSON.stringify((b && b.rows) || []) }).catch(() => null)
      try { line = r && r.exitCode === 0 ? JSON.parse(String(r.stdout || '')) : null } catch {}
    }
    if (gen !== drift.gen) return
    drift.watch = line && Array.isArray(line.watch) ? line.watch.map(String) : []
    drift.key = await driftKey($, root)
    const next = line && typeof line.text === 'string' ? { text: line.text, doctor: !!line.doctor } : null
    if ((next && next.text) === (drift.line && drift.line.text)) return
    drift.line = next
    laterRedraw($)
  } finally {
    drift.checking = false
    if (drift.again) { drift.again = false; void readDrift($).catch(() => {}) }
  }
}

/* the doctor's run report sits on its card; a card with no run yet has nothing to open */
function driftHome(): { text: string; href?: string } | null {
  if (!drift.line) return null
  const card = drift.line.doctor ? (procs.cards || []).find((c: any) => c && c.slug === 'doctor-a-project') : null
  const href = card && Number(card.runs) > 0 ? recordHref(band.local, card.key || card.id, card.url) : ''
  return href ? { text: drift.line.text, href } : { text: drift.line.text + (drift.line.doctor ? ' (/askerdo:doctor)' : '') }
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

/* state: undefined until read; track and dir: the track key and folder it was read for */
const guard: { state?: any; track?: string | null; dir?: string; mark?: string; profilesAt?: number } = {}

/* each guard read goes to the debug log with its folder and source, so a wrong read shows why */
function guardReadLine(dir: string, trackKey: string | null | undefined, j: any, failed?: string): string {
  const at = 'AskerDo guard read for ' + dir + (trackKey ? ' (track ' + trackKey + ')' : '') + ': '
  if (failed !== undefined) return at + 'failed, ' + (failed || 'no reason given')
  const s = j && j.source
  const from = !s ? 'no profile (built-ins)' : s.profile ? s.profile + ' on ' + s.record : (s.level || 'source') + ' ' + (s.record || '')
  return at + (j && j.on ? 'on' : 'off') + ' from ' + from + (j && j.problem ? '; ' + j.problem : '')
}

async function markerRun($: any, sid: string, trackKey: string | null | undefined, extra: string[]): Promise<void> {
  try {
    const dir = await projectDir($)
    const argv = ['node', $.plugin.root + '/scripts/depth-marker.mjs', '--cwd', dir, '--session', sid]
    if (trackKey) argv.push('--track', trackKey)
    const r = await spawn($, [...argv, ...extra, '--json'], { timeoutMs: 15000 })
    if (r.exitCode !== 0) { debugLine($, guardReadLine(dir, trackKey, null, String(r.stderr || '').trim().split(/\r?\n/)[0])); return }
    const before = JSON.stringify(guardChip(guard.state))
    const j = JSON.parse(String(r.stdout || ''))
    guard.state = guardOf(j)
    guard.track = trackKey || null
    guard.dir = dir
    debugLine($, guardReadLine(dir, trackKey, j))
    if (JSON.stringify(guardChip(guard.state)) !== before) quietRedraw($, STATUS)
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
    /* runOlder may drop the old id from the tick, which would strand its unsettled ends */
    await carryUnsettled($, from, to).catch(() => {})
    /* the old id still holds the lease, so the new one takes it over */
    const moved: Moved = track || tasks.length ? await moveHolds($, from, to, track, tasks, '/clear') : (kick($), { track: null, tasks: [], left: { track: null, tasks: [] } })
    await rowFollow($, from, to, moved).catch(() => {})
    /* a failed take leaves the check open, so the next prompt's recheckRow tries again */
    if (leftAny(moved)) rowRetry.from = from
    else { rowRetry.from = undefined; row.checked = to }
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
          go: { type: 'boolean', description: 'true on the one yes option of a planned set of moves across tracks: answering it lets the session holding the gated task in hand file and move work with no further question until that task closes. Needs gates; only ' + n + ' can answer it' },
        },
      },
    },
    pick: { type: ['string', 'null'], description: 'The letter you recommend; null when you recommend none on purpose. Required with lettered options.' },
    crux: { type: 'string', description: 'Optional: one line, the fact that decides it' },
    workstream: { type: 'string', description: 'WS-n; left out, the workstream of the track this session holds, else inherited from the session' },
    track: { type: 'string', description: 'TR-n: the track the question belongs to' },
    gates: { type: 'array', items: { type: 'string' }, description: 'T-n ids of the tasks this question gates' },
    revisits: { type: 'array', items: { type: 'string' }, description: 'Q-n ids of the answered questions (rulings) this one reopens; needs reversal; stored blocking, and its card and telling lead with the reversal' },
    cites: { type: 'array', items: { type: 'string' }, description: 'Q-n ids of answered questions this one only mentions' },
    reversal: { type: 'string', description: 'With revisits: what changed since the ruling, short lines; the hub quotes the ruling and the costs ' + n + ' turned down' },
    stakes: { type: 'string', description: 'Short lines, one fact each, a bold lead then the fact' }, whileThisWaits: { type: 'string' }, context: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } }, topic: { type: 'string' },
    edits: { type: 'string', description: 'Q-n, or the L-n of a kept question: reword this open, unanswered question in place, keeping its id, instead of asking a new one; send the whole reworded question, then paste the reworded block the result hands back in this reply' },
  },
})

/* a repo's verify-first entry, as handoff_write takes it and handoff_update refreshes it */
const VERIFY_ENTRY = {
  path: { type: 'string', description: 'The repo, absolute' },
  branch: { type: 'string', description: 'Leave out: the write reads it from git; one git disagrees with is not stored, and the result names it' },
  worktree: { type: 'string', description: 'Where the branch is checked out when not at path, absolute; the checks then run there' },
  commit: { type: 'string', description: 'Leave out: read from git, as the branch is' }, expectedDirty: { type: 'array', items: { type: 'string' } },
  ownedByOthers: { type: 'array', items: { type: 'string' } },
  files: {
    type: 'array',
    description: 'Only the untracked files new since the last handoff and kept ones due for review; one left out carries its last disposition here. A delete under a folder the conversion keeps is stored as a keep',
    items: {
      type: 'object', required: ['path', 'disposition'],
      properties: {
        path: { type: 'string', description: 'Relative to the repo' },
        disposition: { type: 'string', enum: ['commit', 'ignore', 'delete', 'keep', 'undecided'] },
        reason: { type: 'string' }, review: { type: 'string', description: 'YYYY-MM-DD; default 7 days on, and a keep given again once due takes a new one' },
        suggest: { type: 'string', enum: ['commit', 'ignore', 'delete'] }, note: { type: 'string' },
      },
    },
  },
  worktrees: {
    type: 'array',
    description: 'A worktree holding work by its path, or a group: merged (the merged and clean worktrees with their branches) or branches (merged branches with no worktree); only new or due ones, the rest carry',
    items: {
      type: 'object', required: ['disposition'],
      properties: {
        path: { type: 'string', description: 'The worktree, absolute or relative to the repo' },
        group: { type: 'string', enum: ['merged', 'branches'] },
        disposition: { type: 'string', enum: ['remove', 'keep', 'undecided'] },
        reason: { type: 'string' }, review: { type: 'string', description: 'YYYY-MM-DD, a kept one; default 7 days on' },
      },
    },
  },
}

/* the places a filing names, as place, a close's leftovers and a handoff's take them: a real place on the held track lands, any other asks */
const TIER_LINES = 'tier 2: the track this session holds, at a real place: after is what it needs and before the tasks on it that must not finish without it; it files at once. '
  + 'One whose after reaches the work at the track\'s end (open work nothing there follows but the closing review) needs no before and files at once as the end. '
  + 'Asking to put it last on that track (last, with why), on another track or a parked one an event opens (tier 3: track, or unparkWhen with newTrack), '
  + 'in another workstream or project (tier 4: workstream with a track there, or wake for its inbox; a date wake says why that date in unplaced), '
  + 'or for a later session (wake next-session) creates nothing: it asks the user, with the reason and with here naming the real place on the held track it would otherwise take (left out when nothing there waits on it), and their press creates it or not.'
const PLACE_ANSWER = {
  tier: { type: 'integer', enum: [2, 3, 4], description: 'Where the work goes. ' + TIER_LINES },
  track: { type: 'string', description: 'TR-n: tier 3, another track in this workstream; tier 4, a track in the workstream named' },
  workstream: { type: 'string', description: 'WS-n: tier 4, the other workstream' },
  unparkWhen: { type: 'string', description: 'Tier 3: the event that opens a new parked track, "track-ends TR-n", "task-completes T-n" or "question-answered Q-n"' },
  newTrack: { type: 'string', description: 'With unparkWhen: the parked track\'s name (left out, the work\'s name)' },
  wake: { type: 'string', description: 'next-session at tier 2, at tier 3 with a track or at tier 4 with a track there: it waits on that track for a session other than this one. '
    + 'Tier 4 with no track: the event that brings it back in that workstream\'s inbox; a date YYYY-MM-DD (tier 2 or 4) only with unplaced' },
  unplaced: { type: 'string', description: 'With a date wake: why that date, one line' },
  whyElsewhere: { type: 'string', description: 'Tier 3 or 4 from a session that holds a track: why the held track\'s real place does not fit, one line, shown to the user in the placement question' },
  last: { type: 'string', description: 'Tier 2: asks to put it last on the held track (before its closing review), with why nothing there needs it sooner, one line, shown to the user in the placement question; here still names the real place, when one waits' },
  here: { type: 'object', additionalProperties: false, description: 'With a place that asks (last, tier 3 or 4, a wake): the real place on the held track the work would otherwise take, '
    + 'after what it needs and before the tasks that must not finish without it; the question offers it beside the place asked for. Left out when nothing on the held track waits on the work: the question then has no do-it-on-this-track press',
    properties: { after: { type: 'array', items: { type: 'string' } }, before: { type: 'array', items: { type: 'string' } } } },
}

/* a leftover step, as handoff_write takes it; task_update's close adds check */
const LEFTOVER_STEP = {
  runBy: { type: 'string', description: 'Who runs the step, which the kickoff prints: orchestrator (the session itself, for what needs its judgment), '
    + 'fork (the session\'s own fork on the session model, for work that needs its context, the briefs included early in the session), '
    + 'or agent:<model> (mechanical work such as data-file edits and filing records, and the briefs for a large read or past the handoff window, since a fork inherits the session\'s depth)' },
  name: { type: 'string', description: 'The step, one line' },
  task: { type: 'string', description: 'T-n: an existing task, moved onto the track' },
  after: { type: 'array', description: 'What it waits on: T-n ids, or the number of an earlier step here (1 first)', items: { anyOf: [{ type: 'string' }, { type: 'integer' }] } },
  before: { type: 'array', description: 'What waits on it: T-n ids alone (a later step here names this one in its own after). A tier 2 step names before, the tasks on the track that wait on it, unless its after reaches the work at the track\'s end; last asks the user', items: { type: 'string' } },
  description: { type: 'string', description: 'Required for a new step: what the next worker needs to start, why it was left, what it touches, what done looks like; '
    + 'a ruling is named by its K-n and statement, never quoted from the chat. A step filed by its check number takes that step\'s text, and one naming a task needs none' },
  priority: { type: 'string', enum: ['high', 'medium', 'low'] },
  ...PLACE_ANSWER,
  tier: { type: 'integer', enum: [2, 3, 4], description: 'Where the step goes; a step naming a task already on this track needs none. ' + TIER_LINES },
  newTrack: { type: 'string', description: 'With tier 3 and unparkWhen: the name of the parked track the event opens (steps naming the same name share it)' },
  unparkWhen: { type: 'string', description: 'Tier 3: the event that opens a new parked track, "track-ends TR-n", "task-completes T-n" (or a leftover\'s number here) or "question-answered Q-n"' },
}

/* the tools' words name the configured user, n */
const toolsFor = (n: string) => [
  {
    name: 'ask',
    description: 'Register a question for ' + n + ' on the AskerDo board, at ask time, before telling it in the reply. '
      + 'The session and project are filled in; the workstream, left out, is that of the track this session holds. '
      + 'Answers with the question id, its answer tokens (106a, 106b) and the block to paste in the reply\'s footer, under its label, exactly, once: the question\'s header line, then its reversal line, question line, crux and table. '
      + 'The ask names the options by letter, since the number comes at registration; model asks: '
      + '"When a session is working down a track, where do you want to see which task it\'s on? On the status line next to the track (a, my pick), '
      + 'as a row in the band above the prompt (b), or nowhere on screen, only in the kickoff and the Tracks tab (c)?" and '
      + '"Before the release, should the next step build just the size report at each handoff (a, my pick), all three drift checks '
      + 'from the design notes (b), or nothing until after the release (c)?" '
      + 'A question that reopens an answered one names it in revisits with a reversal, its ask leading with Reversal of Q-n, and may share a reply with other questions; one that only mentions an answered question lists it in cites. '
      + 'A question whose answer a task needs gates it (gates). '
      + 'A planned set of moves across tracks is asked once: take the task in hand first, then one ask with its yes option marked go and that task in gates; its answer, which only ' + n + ' can give, carries every placement by the session holding that task until the task closes. '
      + 'A look at finished work is one question listing what needs ' + n + '\'s eye, never one per item, '
      + 'gating its look task (labelled look); registering it ends this session\'s run on that task. '
      + 'A subagent never calls it: its question goes to the session that dispatched it. '
      + 'In a session that has not used AskerDo, the question stays with the session under a local label (L1, answered L1a) and is filed on the board only if the session uses AskerDo.',
    inputSchema: askSchema(n),
  },
  {
    name: 'override_request',
    description: 'Ask ' + n + ' to override a record already in use, the one way to change it beyond an amend: fix (text a bug or an import wrote), '
      + 'withdraw (a ruling ' + n + ' never made, or a knowledge record an undone import wrote) or scrub (a secret or personal detail); never for wording, scope or a change of mind (amend or supersede those). '
      + 'Any other knowledge record that stops being true ends by knowledge retire K-n --reason, with no press. '
      + 'The session decides whether its change qualifies; a subagent never calls it and reports to its session instead. '
      + 'One record with its corrected fields, or a batch as items. '
      + 'Answers with the block to put in the reply as written, which ' + n + ' answers on the card under it with the request\'s act (Withdraw, Fix or Scrub) or Keep; a fix or withdraw of a ruling is a reversal, its block and card leading with it.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['kind', 'summary', 'reason'],
      properties: {
        kind: { type: 'string', enum: ['fix', 'withdraw', 'scrub'] },
        record: { type: 'string', description: 'T-n or K-n: the one record; or items for a batch' },
        summary: { type: 'string', description: 'What ' + n + ' decides, at most 200 characters; never the text a scrub removes' },
        reason: { type: 'string', description: 'Why it qualifies: the bug that wrote the text, the ruling never made, the import undone, or the secret' },
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
    description: 'Append a stamped paragraph to the journal of a workstream, task, track or knowledge record; never a question, whose notes hold its answer '
      + '(a remark about one goes on the decision that answers it or the task it gates). '
      + 'When a task\'s work has changed, give the new title, description and intent with it (a track\'s new goal, when its aim changed): the text is replaced, '
      + 'the note is the why, and the old text stays in the record\'s history. A note on a task saying why it waits settles its ended run. '
      + 'A ruling it rests on is named by its K-n and statement; ' + n + '\'s words stay in that record. '
      + 'An agent\'s notes on a task are refused: it reports to its session. '
      + 'When the answer names another session\'s band and ' + n + ' should press the note in there, raise your hand and name that session and the note in your reply.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id', 'body'],
      properties: {
        id: { type: 'string', description: 'WS-n, T-n, TR-n or K-n' }, body: { type: 'string' },
        name: { type: 'string', description: 'A task: its new title, when the work changed what it is' },
        description: { type: 'string', description: 'A task: its new description, what the work is now' },
        intent: { type: 'string', description: 'A task: its new intent' },
        goal: { type: 'string', description: 'A track: its new goal' },
      },
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
    description: 'Record a ruling ' + n + ' made in chat, in the same turn: a title stating only what ' + n + ' chose, ' + n + '\'s words quoted whole, '
      + 'never cut, and what it governs (tasks, files, commands); the session\'s own picks go in the body, each named as the session\'s pick. '
      + 'Words ending in a question back or a hedge (thoughts?, perhaps) leave the choice open: record only what they settle, or ask; '
      + 'the result warns when they do. Left out, the track and workstream are the ones this session holds and the project is this one. '
      + 'One that replaces an earlier decision names it in supersedes. Sessions holding its tasks or track are told, an edit or command '
      + 'it governs gets a pointer to it, and the next leg\'s kickoff lists it. '
      + 'A hold from ' + n + ' on a track is a decision labelled hold naming the track with ' + n + '\'s words: no stop is refused until a decision superseding it lifts it, and a later take of the track needs a new one. '
      + 'The title, with the restatement in the body, is the statement tasks, briefs and notes carry with its K-n once ' + n + ' confirmed it (confirmed); ' + n + '\'s words stay in this record, and until it is confirmed a brief quotes them. '
      + 'A subagent never calls it: a ruling it was told of goes in its report.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['title'],
      properties: {
        title: { type: 'string', description: 'The ruling, one line: only what ' + n + ' chose, never a pick of the session\'s' },
        words: { type: 'string', description: n + '\'s words, quoted whole, never cut' },
        body: { type: 'string', description: 'Optional: what it settles and why; the session\'s own picks, each named as the session\'s pick' },
        tasks: { type: 'array', items: { type: 'string' }, description: 'T-n ids of the tasks it governs' },
        tracks: { type: 'array', items: { type: 'string' }, description: 'TR-n ids; with tracks and workstreams left out, the track this session holds' },
        workstreams: { type: 'array', items: { type: 'string' }, description: 'WS-n ids' },
        files: { type: 'array', items: { type: 'string' }, description: 'Globs relative to the repo (lib/builder.js, docs/**/*.md) whose edits it governs; a leading (read), (search) or (edit read) names the calls that point instead: (read) docs/index.md for a file to read, (search) ** for every search. Left out, it governs no file: name each file it governs; [] for none' },
        commands: { type: 'array', items: { type: 'string' }, description: 'Command fragments it governs (npm publish, or a script\'s name). With files also left out, the commands this turn ran, which the result says how to trim; [] for none' },
        question: { type: 'string', description: 'Q-n: the question it answers; the words carrying its answer token (167a) record the answer too, else the result says it is still open' },
        supersedes: { type: 'array', items: { type: 'string' }, description: 'K-n ids of the decisions it replaces' },
        labels: { type: 'array', items: { type: 'string' }, description: 'hold, with tracks naming the track: records ' + n + '\'s hold on it' },
        global: { type: 'boolean', description: 'true: it holds in every project' },
        confirmed: { type: 'boolean', description: 'true: ' + n + ' said yes to the title as worded (the restatement put to them); one whose title is the option ' + n + ' pressed on the question it names is marked by the board itself' },
      },
    },
  },
  {
    name: 'fact',
    description: 'Record a fact about this project or its tools that a later session needs, in one call: how something behaves, a trap and its way round, '
      + 'a measured number, what a research read found. Never a ruling ' + n + ' made (decide) and never work still to do (place, or a step with task_update checks.add); '
      + 'a note holds neither. The project is this one and the workstream the one of the track this session holds, when that track is in this project; it is a knowledge record (K-n), '
      + 'shown to the sessions whose calls touch its files. A subagent never calls it: a fact it finds goes in its report.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['title', 'body'],
      properties: {
        title: { type: 'string', description: 'The fact, one line' },
        body: { type: 'string', description: 'The fact in full: what holds, where it was seen or measured, and what it means for the next session' },
        files: { type: 'array', items: { type: 'string' }, description: 'Globs relative to the repo (lib/builder.js, docs/**/*.md) whose edits it bears on' },
        refs: { type: 'array', items: { type: 'string' }, description: 'Ids or links it rests on (T-n, K-n, a commit, a doc path)' },
        labels: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'task_update',
    description: 'Change a task on the board: its stored status (open, done or dropped), priority, name or labels, take it in hand for this session or let it go, '
      + 'and optionally add a journal note in the same call. A task\'s word (running, ready, waiting) is computed from its runs, steps and edges, never set. '
      + 'Taking a task in hand (inHand) opens this session\'s run on it and goes by the track\'s order: '
      + 'a task that is not ready yet needs a reason, or the edge that is wrong removed. '
      + 'A dispatch naming the task opens its agent\'s run, and no call here tags it; onto a task another session\'s run holds, take it over first (inHand with takeOver, on ' + n + '\'s word), then dispatch. '
      + 'runEnded ends this session\'s own agent run on it that went silent, leaving the task open. '
      + 'Closing a task carries its leftovers, so nothing found while doing it is left in the closing note. '
      + 'Work for the task\'s own worker is a step on it (checks.add); a step its worker will not do moves with moveSteps. A close is refused while a step stays open, naming each: '
      + 'settle it in the same call as done, struck with a word why, or a leftover naming it by check, or move it first. '
      + 'An agent\'s own task writes are refused: it reports its steps by number and the session ticks them.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: {
        id: { type: 'string', description: 'T-n' },
        status: { type: 'string', enum: ['open', 'dropped', 'done'] },
        reason: { type: 'string', description: 'Why it starts before it is ready, or why it is dropped' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        name: { type: 'string' },
        addLabels: { type: 'array', items: { type: 'string' } },
        removeLabels: { type: 'array', items: { type: 'string' } },
        inHand: { type: 'boolean', description: 'true: this session takes it in hand and starts it (a session may hold several); false: let it go' },
        takeOver: { type: 'boolean', description: 'with inHand true, or status done or dropped: take it from the session whose run holds it, which is told; only after ' + n + ' says so, or from this session\'s own earlier id after a rewind. '
          + 'A dispatch onto a task another session\'s run holds is refused until this take-over' },
        note: { type: 'string', description: 'A journal paragraph to add' },
        description: { type: 'string', description: 'With note: the task\'s new description when its work changed, the note being why; the old text stays in its history' },
        intent: { type: 'string', description: 'With note: the task\'s new intent, likewise' },
        checks: {
          type: 'object', additionalProperties: false,
          description: 'Its checklist, shown as done of total: add new steps, done or strike steps by their number (a step keeps the number it was given)',
          properties: {
            add: { type: 'array', items: { type: 'string' }, description: 'Steps to add, one line each' },
            done: {
              type: 'array', description: 'Step numbers now done, or { step, word } for a word on one',
              items: { anyOf: [{ type: 'integer' }, { type: 'object', additionalProperties: false, required: ['step', 'word'], properties: { step: { type: 'integer' }, word: { type: 'string' } } }] },
            },
            strike: {
              type: 'array', description: 'Steps that will not be done, each with a word why; a struck step stays settled, never open',
              items: { type: 'object', additionalProperties: false, required: ['step', 'why'], properties: { step: { type: 'integer' }, why: { type: 'string' } } },
            },
          },
        },
        leftovers: {
          type: 'array',
          description: 'With status done or dropped: the steps this close leaves, nothing filed or closed if one is refused. '
            + 'Each names its place as place takes it: tier 2 at a real place on the held track (with no after, after the closing task), or after the work at its end, files with the close; '
            + 'a step asked last, off the track or for a later session becomes ' + n + '\'s placement question, its card under this call and its block in the result, created only on their press, while the close lands. '
            + 'The board checks each place and answers one that does not fit with the call that does',
          items: {
            type: 'object', additionalProperties: false, required: ['runBy'],
            properties: {
              ...LEFTOVER_STEP,
              check: { type: 'integer', description: 'An open checklist step\'s number, in place of a name: the step files as a task with its text and is struck as left on this task' },
            },
          },
        },
        moveSteps: {
          type: 'array',
          description: 'Open steps this task\'s worker will not do, each moved by its number to one place and struck with where it went: '
            + 'onto an open task (onto), to a question already asked (question), or filed as a new task with the place fields, as a leftover is: '
            + 'at a real place on the held track, or after the work at its end, it lands, and anywhere else, or onto a task on another track, asks ' + n + ' first. '
            + 'A step moved to a question does not gate this task by itself: when the task needs its answer, the question gates the task (ask with gates naming it). '
            + 'A refused move writes nothing; a close with leftovers goes in its own call',
          items: {
            type: 'object', additionalProperties: false, required: ['check'],
            properties: {
              check: { type: 'integer', description: 'The open step\'s number' },
              onto: { type: 'string', description: 'T-n: the open task whose worker will do it' },
              question: { type: 'string', description: 'Q-n: the open question it waits on' },
              ...LEFTOVER_STEP,
            },
          },
        },
        runEnded: { type: 'string', enum: ['handed_on', 'failed'], description: 'Ends this session\'s own open agent run on the task (one whose agent went silent) as handed on or failed; the task stays open, ready to continue' },
      },
    },
  },
  {
    name: 'place',
    description: 'File found work, or place a task that has no home (an inbox task, a due one, an end). '
      + TIER_LINES + ' '
      + 'When nothing else is open on the held track but the task being closed and its closing review, the work goes on it at once and is the next thing taken. '
      + 'An asked filing answers with the question\'s id and the block to paste, as ask does, and its card draws under this call; '
      + 'after a talk (option c) the place settled is filed with question and ' + n + '\'s words. A session that holds no track files as before. '
      + 'Work for a task\'s own worker is a step on that task, in hand or not (task_update checks.add, or moveSteps onto it); an open task that covers it takes a note; '
      + 'what only ' + n + ' can decide or do is a question (ask). '
      + 'The board checks the place against what this session holds and answers one that does not fit with the call that does. '
      + 'A subagent never calls it: found work goes in its report.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['tier'],
      properties: {
        task: { type: 'string', description: 'T-n: a task with no home to place (an inbox task, a due one, an end); or name and description for new work' },
        name: { type: 'string', description: 'New work: one line' },
        description: { type: 'string', description: 'New work: what the next worker needs to start, why it was found, what done looks like; a ruling is named by its K-n and statement, never quoted from the chat' },
        intent: { type: 'string', description: 'New work: why it matters' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        labels: { type: 'array', items: { type: 'string' } },
        runBy: { type: 'string', description: 'New work: who runs it, orchestrator, fork or agent:<model>' },
        ...PLACE_ANSWER,
        after: { type: 'array', items: { type: 'string' }, description: 'Tier 2 or 3: T-n ids on that track it waits on' },
        before: { type: 'array', items: { type: 'string' }, description: 'Tier 2 or 3: T-n ids on that track that must not finish without it; at tier 2 the real place, none when after reaches the work at the track\'s end, else last asks ' + n },
        question: { type: 'string', description: 'Q-n: the placement question a talk settled; with words, the one filing it lets through at the place sent' },
        words: { type: 'string', description: 'With question: ' + n + '\'s words that settled the place' },
      },
    },
  },
  {
    name: 'handoff_write',
    description: 'Write the next handoff of the track this session holds (or the track named; with none held, name a workstream and a track named from the focus is started there). '
      + STOP_FIRST + ' Then: focus one line of at most 400 characters, '
      + 'state at most 10 KB (a line over 400 characters is wrapped onto an indented continuation line), whereWeWere at most 4 KB in your own words (where the conversation with ' + n + ' stood); '
      + 'a field over its budget is stored as sent and the result names the handoff_update patch that shortens it, never a second write; '
      + 'rulings: only those ' + n + ' made in chat that decide could not record, '
      + 'and verifyFirst with one entry per repo, '
      + 'its files list naming only untracked files new since the last handoff and kept ones whose review date has passed, each commit, ignore, delete (asked with the count of files it removes, which git has no copy of; one under a folder the conversion keeps is stored as a keep), keep (with a reason) or undecided, '
      + 'and its worktrees list likewise for each worktree holding work and the groups merged and branches (remove, keep with a reason, or undecided); '
      + 'a path left out carries its last disposition and reason on this PC, a keep its review date (7 days on when none is given), and the write finds every untracked file, worktree and merged branch itself. '
      + 'The write removes each merged, clean agent worktree (its branch tip in the checkout\'s branch, nothing uncommitted, never a locked one) with its branch, and each merged agent branch, after the board write, and its result lists them with any it had no time for, which the next write removes; '
      + 'what is left (a worktree holding unmerged work, a loose file with no disposition, a proposal, a keep past its review day) you ask ' + n + ' about in this reply through the ask tool, after the write; the resume asks nothing. '
      + 'The depth at handoff and the depth-guard marker are filled in; the track\'s tasks carry where it stands, so the state never retells the list, '
      + 'and the steps left go in leftovers, never as a Next list in the state. '
      + 'The track\'s lease goes with the handoff, and the write ends this session\'s runs as handed on, so their tasks read ready to continue for the next leg. '
      + 'The result names each run whose branch is not on the remote: push it, or say in the handoff why it waits. It ends with the resume block to close the reply with. '
      + 'While an agent or workflow this session started still runs, nothing is written: the result names what runs and gives no resume block, and you call handoff_write again once each has landed and you have checked what it left. '
      + 'If a later turn changes state after it (a board or repo write, a ruling, an ask, an agent or a stopped process), keep it current with handoff_update (load it first with ToolSearch, query `select:mcp__askerdo__handoff_update`) before that turn ends; never write it again for that. '
      + 'Open once the mod\'s depth note has come, '
      + 'or before it once ' + n + ' asks: through /askerdo handoff or park, or in chat, which askedInChat carries; otherwise refused.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['focus', 'goal', 'state', 'verifyFirst'],
      properties: {
        track: { type: 'string', description: 'TR-n; left out, the track this session holds' },
        workstream: { type: 'string', description: 'WS-n: with no track held or named, a track named from the focus is started here' },
        askedInChat: { type: 'string', description: 'When ' + n + ' asked for this handoff in chat: ' + n + "'s words, quoted, one line; it opens a handoff before the mod's depth note and leads whereWeWere" },
        focus: { type: 'string' },
        goal: { type: 'string', description: 'What the track is doing now, in a sentence or two: said again as it stands, or restated when the work changed, which the board keeps with the old text in its history and the next kickoff names' },
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
        waitingOnUser: {
          type: 'array',
          description: 'What waits on ' + n + ', one line each. The latest handoff\'s waits carry into this one on their own: give only new ones, and { drop: the line as written } for each one settled',
          items: { anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: false, required: ['drop'], properties: { drop: { type: 'string', description: 'A carried wait, as written, now settled' } } }] },
        },
        taskNotes: {
          type: 'array',
          description: 'A note for each task this session\'s open runs hold that this leg wrote nothing on: what was done and learned, with a new description or intent when its work changed (the note is the why); written before the write ends those runs. A task left silent is named in the result and the next kickoff',
          items: { type: 'object', additionalProperties: false, required: ['id', 'note'], properties: {
            id: { type: 'string', description: 'T-n' }, note: { type: 'string' },
            description: { type: 'string', description: 'Its new description, what the work is now' }, intent: { type: 'string', description: 'Its new intent' } } },
        },
        leftovers: {
          type: 'array',
          description: 'The steps left, in order: each becomes a task on the track (a name matching an open task there is that task), waits on its after, and is waited on by its before, '
            + 'so the next session takes the next step from the ready set. The state carries the thinking and never orders work. '
            + 'Each new step names its place as place takes it: tier 2 at a real place, with its before or after the work at the track\'s end, lands on the track; '
            + 'one asked last, off the track or for a later session becomes ' + n + '\'s placement question on the track, its card under this call and its block in the result, created only on their press, while the handoff lands. '
            + 'A leftover you cannot place at all (is it work) goes to ' + n + ' through ask',
          items: { type: 'object', additionalProperties: false, required: ['runBy'], properties: LEFTOVER_STEP },
        },
        status: { type: 'string', enum: ['waiting', 'parked'] },
        parkReason: { type: 'string' },
        nextPc: { type: 'string', description: 'When the next leg can only run on one PC: that PC\'s device name as askerdo status prints it (the board refuses a name it does not know); the resume block\'s label names it, and a resume on another PC takes the track only on the user\'s --here' },
      },
    },
  },
  {
    name: 'handoff_update',
    description: 'Patch the handoff this session wrote, in place, while it waits or is parked: it keeps its id (TR-n.m) and its depth. '
      + 'When a turn changes state after its handoff, patch it before that turn ends with what the next leg needs; a turn that only answered or read needs no patch. '
      + 'ops, applied in order: focus replaces the focus (one line of at most 400 characters); state replaces the section under its "## " heading, or appends it when new (the steps left stay tasks on the track, never a Next list); '
      + 'whereWeWere adds one line (line), or replaces it whole (text); waitingOnUser adds or drops one line of what waits on ' + n + '; verifyFirst snapshots one repo again as the write does, its untracked files, worktrees and merged branches. '
      + 'The write\'s prose order applies to the patched text; a field still over its budget is stored and the result names it. '
      + 'Once the track is resumed the update is refused, naming the session holding it: put what changed in a note on the track (note, id TR-n), which reaches that session at its next prompt.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['ops'],
      properties: {
        track: { type: 'string', description: 'TR-n or TR-n.m; left out, the track this session holds, else the one it last wrote a handoff for' },
        ops: {
          type: 'array',
          items: {
            anyOf: [
              { type: 'object', additionalProperties: false, required: ['op', 'text'], properties: {
                op: { type: 'string', enum: ['focus'] }, text: { type: 'string', description: 'The focus, one line of at most 400 characters, replacing it' } } },
              { type: 'object', additionalProperties: false, required: ['op', 'heading', 'text'], properties: {
                op: { type: 'string', enum: ['state'] }, heading: { type: 'string', description: 'The section\'s heading, one line starting "## "' },
                text: { type: 'string', description: 'The section\'s body under its heading, with no "## " line in it' } } },
              { type: 'object', additionalProperties: false, required: ['op', 'line'], properties: {
                op: { type: 'string', enum: ['whereWeWere'] }, line: { type: 'string', description: 'One line in your own words, added to whereWeWere' } } },
              { type: 'object', additionalProperties: false, required: ['op', 'text'], properties: {
                op: { type: 'string', enum: ['whereWeWere'] }, text: { type: 'string', description: 'The whole of whereWeWere, shorter, replacing it' } } },
              { type: 'object', additionalProperties: false, required: ['op'], properties: {
                op: { type: 'string', enum: ['waitingOnUser'] }, add: { type: 'string', description: 'One line to add' },
                drop: { type: 'string', description: 'A line already there, as written, to drop' } } },
              { type: 'object', additionalProperties: false, required: ['op', 'path'], properties: { op: { type: 'string', enum: ['verifyFirst'] }, ...VERIFY_ENTRY } },
              { type: 'object', additionalProperties: false, required: ['op', 'pc'], properties: {
                op: { type: 'string', enum: ['nextPc'] }, pc: { type: 'string', description: 'The device name of the PC the next leg runs on, or "" to clear it' } } },
            ],
          },
        },
      },
    },
  },
  {
    name: 'review_covers',
    description: 'Set what a review task read: its covers list, the code tasks it covers, each through its newest commit now. '
      + 'Left out, tasks is the default: every uncovered code task on its track finished before the review started (a project-wide review: the project\'s since the last one). '
      + 'A review that completes with no list takes the default on its own; give the list when the review read less, or other work; none: true clears the list, so the review covers nothing. '
      + 'A given list is kept: the review reopens only for a newer commit on a task in it, and work outside it waits for the next review.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['review'],
      properties: {
        review: { type: 'string', description: 'T-n: the review task' },
        tasks: { type: 'array', items: { type: 'string' }, description: 'T-n ids of the code tasks it read' },
        none: { type: 'boolean', description: 'true: clear the list (not with tasks)' },
      },
    },
  },
  {
    name: 'coverage',
    description: 'Read the review coverage of a track or a workstream: its code tasks with the review that covers each, its reviews, '
      + 'the commits no task owns, and whether a review is due. Reads only, unless scan links the commits here whose subjects lead with a task id first.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['scope'],
      properties: {
        scope: { type: 'string', description: 'TR-n or WS-n' },
        scan: { type: 'boolean', description: 'true: first link the commits in the repos its handoffs name' },
      },
    },
  },
  {
    name: 'depth',
    description: 'Read this session\'s context depth as the band\'s C ring shows it: the whole percent, the tokens and the window, '
      + 'and ' + n + '\'s two marks (the handoff window and the wrap line), which were told this session and whether a profile set them. Reads only. '
      + 'The mod\'s notes at the window and the wrap line arrive on their own.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { why: { type: 'string', description: 'A few words saying what the number is for' } } },
  },
  {
    name: 'drawn',
    description: 'Read what the AskerDo pane, band and status row last drew for this session, as text: each part\'s rows and folds, the columns it was drawn for and when. '
      + 'Use it to check your own surfaces before asking the user to look at them. Reads only; nothing is drawn for the call.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      part: { type: 'string', enum: [...DRAWN_PARTS], description: 'One part only (a long Tracks tab stays out of a band read); left out, all three' } } },
  },
]

/* Called a few times a leg, so they load through ToolSearch instead of riding every request;
   a tool missing from this list rides every request */
const DEFERRED_TOOLS = ['handoff_write', 'handoff_update', 'override_request', 'review_covers', 'coverage', 'drawn']

async function registerAll($: any): Promise<void> {
  /* one global name, so nothing new can collide with it later */
  try { await $.command.register({ name: 'askerdo', description: COMMAND_DESCRIPTION, argumentHint: COMMAND_HINT }) } catch {}
  const n = nameOf()
  for (const t of toolsFor(n)) { try { await $.tool.register({ ...t, isDeferred: DEFERRED_TOOLS.includes(t.name) }) } catch {} }
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
  try { toasts.timer = $.clock.after(t.ms, ran('toasts timer', () => { toasts.timer = undefined; toasts.on = undefined; nextToast($) })) } catch { toasts.on = undefined }
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
  loading?: Promise<void>; again?: boolean; timer?: any; urgent?: boolean; parts?: string
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
  /* every snoozed question, for the mark's asleep face and its card */
  asleep?: any[]
  /* the local board's band (its `track` the held track's numbers) and the held
     track's workstream graph `{ workstream, view, picture }`, null where none answers;
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
    if (!r || lost(r) || !r.ok) return null
    const j = JSON.parse(r.text)
    return j && j.ok === true && j.result != null ? j.result : null
  } catch {
    return null
  }
}

/* the session's ids before a /clear, whose inboxes the band peeks too */
const oldIds = (sid: string) => mem.lineage.filter((x) => x !== sid)

const bandPath = (sid: string, cwd: string, drew?: number, ringLog = '', parts = '') => 'band?session=' + encodeURIComponent(sid) + '&project=' + encodeURIComponent(cwd)
  + (oldIds(sid).length ? '&lineage=' + encodeURIComponent(oldIds(sid).join(',')) : '') + (drew ? '&redraw=' + drew : '')
  + (ringLog ? '&rings=' + encodeURIComponent(ringLog) : '') + (parts ? '&parts=' + encodeURIComponent(parts) : '')

/* this session's start count of the mod (a hooks worker respawn starts a fresh copy, kept in the snapshot) and the draws that threw since the last band read, both sent with the band read */
/* faults: one entry per draw site, its last words and how often it threw since a read took it */
type Fault = { text: string; n: number }
/* uiFaults: the engine's faults heard, each keyed apart so every one is a row */
const boot: { n: number; told: boolean; faults: Map<string, Fault>; was?: Promise<number>; uiFaults: number; dropped: number; flush?: any; flushing?: boolean } = { n: 0, told: false, faults: new Map(), uiFaults: 0, dropped: 0 }
/* past a burst of every live piece of a frame (57 seen in one session), with room for a second */
const FAULT_MAX = 200
/* a row's room on the log, so a flush of the whole book stays near 130 KB */
const FAULT_CHARS = 640
function faultAdd(key: string, text: string, n = 1): boolean {
  const f = boot.faults.get(key)
  if (f) { const same = f.text === text; f.text = text; f.n += n; return !same }
  if (boot.faults.size < FAULT_MAX) boot.faults.set(key, { text, n })
  else boot.dropped += n
  return true
}
/* takes up to max sites out as sent, with a row counting what the bound dropped; back() puts both back */
function faultsTake(max: number): { rows: string[]; back: () => void } {
  const out = [...boot.faults].slice(0, max)
  for (const [k] of out) boot.faults.delete(k)
  const dropped = boot.dropped
  boot.dropped = 0
  const rows = out.map(faultWords)
  if (dropped) rows.push('mod fault book full: ' + dropped + ' more faults dropped past its bound of ' + FAULT_MAX)
  return { rows, back: () => { for (const [k, f] of out) faultAdd(k, f.text, f.n); boot.dropped += dropped } }
}
const faultWords = ([, f]: [string, Fault]) => (f.n > 1 ? f.text + ' (threw ' + f.n + ' times)' : f.text).slice(0, FAULT_CHARS)
/* the book's rows leave on their own POST soon after a fault, not at the next band read: a write only,
   never a draw or a state set; no server answering leaves them for the band read, which starts it */
const FAULT_FLUSH_MS = 250
function faultsSoon($: any): void {
  if (boot.flush || boot.flushing) return
  try { boot.flush = $.clock.after(FAULT_FLUSH_MS, ran('fault flush', () => { boot.flush = undefined; void faultsFlush($).catch(() => {}) })) } catch { boot.flush = undefined }
}
async function faultsFlush($: any): Promise<void> {
  if (!boot.faults.size && !boot.dropped) return
  boot.flushing = true
  const sent = faultsTake(FAULT_MAX)
  let ok = false
  try {
    const base = await localBase($)
    const session = base ? String((await $.session.id()) || '') : ''
    const r = base ? await routeFetch($, base, 'faults', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session, faults: sent.rows }) }) : null
    let j: any = null
    try { j = r && !lost(r) ? JSON.parse(r.text) : null } catch {}
    ok = !!(j && j.ok === true)
  } catch {}
  finally {
    if (!ok) sent.back()
    boot.flushing = false
  }
  /* faults heard while this one was out go at once; a failure waits for the next fault or band read */
  if (ok && (boot.faults.size || boot.dropped)) faultsSoon($)
}
/* the count before this copy, read once: a get only, since a draw may ask first */
function bootWas($: any): Promise<number> {
  if (!boot.was) boot.was = snapBack($).then((s) => Number(s && s.starts) || 0)
  return boot.was
}
async function bootCount($: any): Promise<void> {
  boot.was = undefined
  snap.read = undefined
  boot.told = false
  boot.n = (await bootWas($)) + 1
  await snapSave($, true)
}

/* the local board's band; with no local server answering, it is started once as the
   route does, and read again. null with the words the band's offline line says. */
async function readBand($: any, sid: string, cwd: string, drew?: number, ringLog?: string, parts?: string): Promise<{ near: any; why: string }> {
  for (const again of [false, true]) {
    let base = await localBase($)
    if (!base) {
      const over = await seamEnv($)
      const live = await liveBase($, await callerEnv($, over), over)
      if (!live.base) return { near: null, why: 'local server not running: ' + live.why }
      base = slashed(live.base)
    }
    /* taken as sent, so a read meanwhile tells neither again; put back if this one fails */
    const tell = boot.n > 0 && !boot.told
    if (tell) boot.told = true
    /* what a failed flush left: 8 rows keep the GET under the local server's 16 KB request head */
    const faults = faultsTake(8)
    const told = (tell ? '&start=' + boot.n + '&load=' + Math.round(FIRST_LINE) + ',' + Math.round(performance.now()) : '') + (faults.rows.length ? '&faults=' + encodeURIComponent(JSON.stringify(faults.rows)) : '')
    const back = () => { if (tell) boot.told = false; faults.back() }
    let r: any
    try { r = await routeFetch($, base, bandPath(sid, cwd, drew, ringLog, parts) + told, { method: 'GET' }) } catch (err) { back(); throw err }
    let j: any = null
    try { j = r && !lost(r) ? JSON.parse(r.text) : null } catch {}
    if (j && j.ok === true && j.result && Array.isArray(j.result.questions)) return { near: j.result, why: '' }
    back()
    /* nobody listened at the address it named: started once, then read again */
    if (!r && !again) continue
    return { near: null, why: String((j && j.error) || 'the local server did not answer the band').replace(/\s+/g, ' ').trim() }
  }
  return { near: null, why: 'local server not running' }
}

const listOf = (v: any): any[] => (Array.isArray(v) ? v : [])
/* a band model whose questions or calls are not lists reads as none, so no surface throws on it;
   Home says the questions could not be read, and the fault rides the next band read */
function modelLists($: any, model: any): any {
  if (!model || typeof model !== 'object') return model
  const bad = ['questions', 'calls'].filter((k) => k in model && !Array.isArray(model[k]))
  if (!bad.length) return model
  const text = 'band model: ' + bad.join(' and ') + ' not a list'
  if (faultAdd('band model', text)) { debugLine($, PLUGIN + ': ' + text); faultsSoon($) }
  return { ...model, questions: listOf(model.questions), ...('calls' in model ? { calls: listOf(model.calls) } : {}), unreadQuestions: bad.includes('questions') }
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
  band.model = modelLists($, near.model)
  const ids = new Set(qs.map((q: any) => q.id))
  /* a press still saving keeps its look whatever the read says */
  for (const k of Object.keys(answers.chips)) if (!ids.has(k.split('|')[0]) && !isLocalId(k.split('|')[0]) && answers.chips[k].state !== 'pending') delete answers.chips[k]
  qpane.answering = answeringOf(answers.chips)
  band.questions = qs
  /* a pressed call stays hidden until a read no longer lists it */
  const listed = new Set(listOf(band.model && band.model.calls).map((c: any) => c && c.key))
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
  if (Array.isArray(near.asleep)) { band.asleep = near.asleep; wakesKeep(near.asleep) }
  band.marker = 'seq:' + near.seq
  /* a profile edit anywhere is read again at the next load */
  const edited = guard.profilesAt !== undefined && guard.profilesAt !== near.profilesAt
  guard.profilesAt = near.profilesAt
  bypassMoved($, near.bypass)
  return { found, rows, open: new Set(qs.flatMap((q: any) => [q.key, q.id]).filter(Boolean)), edited }
}

/* the switch on this session, as the band read it: a move reads the rules again, as a profile edit
   does; a timed one redraws at each minute of its countdown and reads them again at its end, which moves no row */
const byTick: { key?: string; b?: any; timer?: any } = {}
function bypassMoved($: any, b: any): void {
  const key = b ? JSON.stringify(b) : ''
  if (key === byTick.key) return
  byTick.key = key
  byTick.b = b
  rules.loading = undefined
  bypassArm($)
}
function bypassArm($: any): void {
  try { if (byTick.timer) byTick.timer.cancel() } catch {}
  byTick.timer = undefined
  const b = byTick.b
  const ends = b && !b.quiet && b.ends ? Date.parse(b.ends) : NaN
  if (!Number.isFinite(ends)) return
  const left = ends - Date.now()
  if (left <= 0) { rules.loading = undefined; return }
  try {
    byTick.timer = $.clock.after((left % 60000 || 60000) + 20, ran('bypass countdown', () => {
      byTick.timer = undefined
      quietRedraw($, ['hint'])
      bypassArm($)
    }))
  } catch {}
}

/* a session's end or start tells the board, for a one-session switch; never a throw, and an older board has no verb */
async function bypassEnd($: any, sid: string, reason: string): Promise<void> {
  if (!sid) return
  await localVerb($, 'bypassEnded', { input: { session: sid, reason }, session: sid }).catch(() => {})
}
/* A hot reload runs session.start again in the same process, whose environment it keeps (the engine's
   plugin guide): only a start this process has not yet seen for this id counts. '*': a /clear changed the id here */
async function bypassStart($: any): Promise<void> {
  const sid = String((await $.session.id()) || '')
  if (!sid) return
  let was = ''
  try { was = String((await $.env.get('ASKERDO_BYPASS_SEEN')) || '') } catch {}
  if (was === sid) return
  try { await $.env.set('ASKERDO_BYPASS_SEEN', sid) } catch {}
  if (was === '*') return
  /* the local server may not be up yet at a cold start */
  if (!(await localBase($))) { const over = await seamEnv($); await liveBase($, await callerEnv($, over), over).catch(() => null) }
  await bypassEnd($, sid, 'start')
}

/* the band's own inbox peek, when it read every box of this session's lineage */
function bandInbox(sid: string, ib: any): any[] | undefined {
  const boxes = ib && Array.isArray(ib.boxes) ? ib.boxes : []
  return ib && Array.isArray(ib.events) && [sid, ...oldIds(sid)].every((b) => boxes.includes(b)) ? ib.events : undefined
}

async function loadBand($: any): Promise<void> {
  const t0 = Date.now()
  /* each part's ms, sent with the next read for the local timings beside the whole load's */
  const parts: Record<string, number> = {}
  let at = t0
  const lap = (k: string) => { const n = Date.now(); parts[k] = (parts[k] || 0) + n - at; at = n }
  loads.unread = true
  const sid = await sessionId($)
  lap('id')
  await localRead($, sid).catch(() => null)
  lap('local')
  await readClosed($, sid)
  lap('closed')
  /* a handed-off session keeps the band it last drew; a load now is scoped without
     its lease, which would drop its workstreams' blockers */
  if (band.loaded && closedAs(sid) === 'handed off') return
  const first = !band.loaded || !!band.urgent
  band.urgent = false
  loads.unread = false
  const n = ++loads.n
  const cwd = await projectDir($)
  const gen = mem.gen
  const drew = band.drew
  const was = band.parts
  band.drew = 0
  band.parts = ''
  lap('dir')
  const ring = ringsOut()
  let read: { near: any; why: string }
  try { read = await readBand($, sid, cwd, drew, ring.log, was) } catch (err) { ring.back(); throw err }
  const { near, why } = read
  if (!near) ring.back()
  lap('band')
  if (!near) {
    /* no local band: the band keeps what it drew and says why */
    const was = band.model && band.model.offline
    band.model = withOffline(band.model, why)
    if (band.loaded && was === why) return
    band.loaded = true
    void readDrift($).catch(() => {})
    loadDrawn($, first, n)
    return
  }
  const { found, rows, open, edited } = await fromNear($, sid, cwd, near, gen)
  await drawFaultRead($)
  lap('near')
  /* the local band says when the board stopped answering; its cache still draws */
  band.model = withOffline(band.model, offlineLine(near))
  const ws = found && found.workstream
  /* the graph rides the band; one for a track the cache has not caught up with is read apart;
     with no track held, the project's workstream the band carries */
  const graph = ws && near.graph && near.graph.workstream === ws ? near.graph : ws ? await localGet($, 'graph/' + encodeURIComponent(ws))
    : near.graph && near.graph.unheld ? near.graph : null
  lap('graph')
  band.near = near
  band.graph = graph && graph.view ? (ws ? { workstream: ws, view: graph.view, picture: graph.picture || null } : graph) : null
  band.loaded = true
  void readDrift($).catch(() => {})
  /* the pane's own reads of this change start now, so they land inside the draw's gather */
  if (paneFaces.size) {
    shelfGraphs($)
    const which = view.filter.trim() ? 'all' : 'own'
    if (view.tab === 'home') { paneOverview($, foldOpen($, 'graph')); feedRead($, which) }
    /* a board change's release waits on them (coolTick); a first load draws at once */
    if (!first) paneReads.add(t0, [farMaps.loading, picOv.loading, feed.loading[which]])
  }
  /* a read before the local board's first snapshot carries no shelf; keeping the seen set
     then means the next read announces only what turned waiting, not the whole shelf */
  if (near.loaded !== false && Array.isArray(near.shelf)) {
    const fresh = newlyWaiting(band.seen, rows)
    band.seen = waitingKeys(rows)
    for (const r of fresh) announceWaiting($, r)
  }
  /* the guard's state follows the held track; and the folder, since a desktop
     spare reads it before the app moves the session to its project */
  const th = found ? found.key : null
  lap('draw')
  if (guard.state === undefined || guard.track !== th || guard.dir !== cwd || edited) await markerRun($, sid, th, th ? ['--write'] : [])
  lap('marker')
  guard.mark = band.marker
  /* the week chip's first figures; after this session.measure pushes them */
  if (!rates.read) {
    rates.read = true
    try { rates.list = ((await $.session.usage()) || {}).rateLimits } catch {}
  }
  lap('usage')
  band.inbox = await peekInbox($, bandInbox(sid, near.inbox)).catch(() => band.inbox)
  lap('inbox')
  /* the cards under replies follow an answer, drop or snooze made anywhere */
  follow.open = open
  await followRun($).catch(() => false)
  await queueFollow($, near).catch(() => {})
  lap('follow')
  drawCause('board')
  loadDrawn($, first, n)
  lap('redraw')
  band.drew = Date.now() - t0
  band.parts = JSON.stringify(parts)
  void deliver($).catch(() => {})
  /* a session engaged since its last load files the questions it kept */
  if (local.entry && local.sid === sid && local.entry.qs.length && (await isEngaged($))) void fileLocal($).catch(() => {})
}

/* each load's number, taken as it starts reading, so an answer's draw waits for a load read after its write;
   unread: the load in flight has not started reading yet */
const loads = { n: 0, unread: false }
/* a first or asked-for load draws at once; a board change from elsewhere waits out the cooldown; the
   load an answer's write started draws with that answer's done draw */
function loadDrawn($: any, first: boolean, n = 0): void {
  const l = owe.load
  if (l && l.gen === owe.gen && n > l.after) {
    owe.load = undefined
    kicksMet(n)
    /* the board moved now, so any draw meanwhile (a press, a tab) reads it */
    touch('board')
    if (owe.late !== undefined && n >= owe.late) owe.late = undefined
    return oweLet($, l.gen, [...BOARD, 'band', 'pane'])
  }
  /* the reload an answer's bound drew without: a passive update now */
  const late = owe.late === n
  if (owe.late !== undefined && n >= owe.late) owe.late = undefined
  if (late) kicksMet(n)
  /* the status row too only where its drawing moved: a change it does not show (a told mark, an
     answer drawn already) asks it nothing */
  if (!first || late) { boardRedraw($, ['cards']); return hintIfMoved($) }
  qpaneRedraw($, BOARD, 'board')
  drawnIfMoved($, [], ['load'])
}

/* One load at a time; a request made during one runs once more after it. quiet: a board change
   from elsewhere, which the cooldown draws; any other load (a press's write, a start) draws at once */
function refresh($: any, quiet = false): Promise<void> {
  if (!quiet) {
    band.urgent = true
    /* a kick still waiting asks the load this one is: running it too would load and draw twice */
    kicksMet(Infinity)
  }
  /* a load that has not started reading reads what this one would, its urgency included */
  if (band.loading) { if (!loads.unread) band.again = true; return band.loading }
  band.loading = (async () => {
    do { band.again = false; await loadBand($).catch(() => {}) } while (band.again)
  })().finally(() => { band.loading = undefined })
  return band.loading
}

/* a fresh copy after a hooks worker respawn draws the local server's band at once, never
   the loading line, when a copy before it ran this session; the full load follows as a first load */
let bandBackRead: Promise<void> | undefined
function bandBack($: any): Promise<void> {
  if (band.loaded) return Promise.resolve()
  if (!bandBackRead) bandBackRead = bandBackLoad($).catch(() => {})
  return bandBackRead
}
/* a draw waits on that read at most BACK_WAIT (the read may start the local server), then draws the
   loading line; the read landing later draws the band and the pane once */
const BACK_WAIT = 300
let backLate = false
function bandBackWithin($: any): Promise<void> {
  if (band.loaded) return Promise.resolve()
  const read = bandBack($)
  return new Promise((done) => {
    let timer: any
    try {
      timer = $.clock.after(BACK_WAIT, ran('back wait timer', () => {
        done()
        if (backLate) return
        backLate = true
        void read.then(() => { if (band.loaded) qpaneRedraw($, OWN, 'board') })
      }))
    } catch {}
    void read.then(() => { try { if (timer) timer.cancel() } catch {} done() })
  })
}
async function bandBackLoad($: any): Promise<void> {
  if ((await bootWas($)) < 1) return
  const sid = await sessionId($)
  const cwd = await projectDir($)
  const gen = mem.gen
  const { near } = await readBand($, sid, cwd)
  if (!near || band.loaded) return
  const { found } = await fromNear($, sid, cwd, near, gen)
  if (band.loaded) return
  const ws = found && found.workstream
  const graph = ws && near.graph && near.graph.workstream === ws ? near.graph : !ws && near.graph && near.graph.unheld ? near.graph : null
  band.near = near
  band.graph = graph && graph.view ? (ws ? { workstream: ws, view: graph.view, picture: graph.picture || null } : graph) : null
  band.loaded = true
  band.urgent = true
}

/* After a write of the mod's own: the band reloads without waiting for a poll. quiet: a model's
   write, which the gate draws; the user's own act draws at once */
/* the kicks still waiting, each with the load count when it was asked */
const kicks = new Map<any, number>()
function kick($: any, quiet = false): void {
  try {
    const t: any = $.clock.after(0, ran('refresh timer', () => { kicks.delete(t); void refresh($, quiet) }))
    if (!quiet && t) kicks.set(t, loads.n)
  } catch {}
}
/* a load that started reading after a kick was asked has read what the kick's write wrote */
function kicksMet(n: number): void {
  for (const [t, at] of kicks) if (at < n) { try { t.cancel() } catch {} kicks.delete(t) }
}

/* a closed session's poll stops, its band frozen as last drawn. */
const FREEZE_CLOSED = true

/* while the local board's long poll holds, the timer does nothing; else it arms the long
   poll again and reloads on a change of the board's seq. With no local server answering, the
   load starts it once (a refused start is not tried again until local.json changes). */
async function poll($: any): Promise<void> {
  if (FREEZE_CLOSED && closedAs(mem.id)) return
  /* while a problem shows, local.json's stamp on this tick; a moved file looks again */
  if (health.first) void localStamp($).then((s) => { if (sawLocal(s)) healthNow($) }).catch(() => {})
  /* while the offline row is up each beat reads the band again, since a board back with no write moves no seq */
  const off = !!(band.model && band.model.offline)
  if (wait.live && !off) return
  armWait($)
  if (off) return refresh($, true)
  const st = await waitRead($, 'state')
  if (st ? 'seq:' + st.seq !== band.marker || !band.loaded : !(await localBase($))) await refresh($, true)
}

async function localStamp($: any): Promise<string> {
  const root = routeRoots(await callerEnv($))[0]
  if (!root) return ''
  try { const st = await $.fs.stat(root + '/board/local.json'); return st.size + ':' + st.mtimeMs } catch { return '' }
}

function startPoll($: any): void {
  lagProbe($)
  armWait($)
  if (band.timer) return
  /* the entry stays for the row's readers; the span names a hold inside the poll's synchronous part */
  try { band.timer = $.clock.every(POLL_MS, ran('poll timer', () => { held('poll'); void poll($).catch(() => {}) })) } catch {}
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
    const j = r && !lost(r) && r.ok ? JSON.parse(r.text) : null
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
  if (r.changed && !frozen) await refresh($, true)
  return true
}

/* Live while a held request is out, false whenever the chain stops, so the poll
   arms it again after a freeze lifts. */
function armWait($: any): void {
  if (wait.busy || (FREEZE_CLOSED && closedAs(mem.id))) return
  wait.busy = true
  const stop = () => { wait.busy = false; wait.live = false }
  const step = ran('held request step', () => {
    void waitOnce($).catch(() => false).then((held) => {
      wait.live = held
      if (held && !(FREEZE_CLOSED && closedAs(mem.id))) {
        try { $.clock.after(0, step) } catch { stop() }
      } else stop()
    })
  })
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

/* ---- notes at a fixed place --------------------------- */

/* A row appended mid-turn moves at the next turn, rewriting the prompt cache and dropping the
   model's earlier reasoning, so a note waits for its loop's next call result or the next prompt */
type Later = { text: string; agentId?: string; done?: () => unknown; drop?: () => unknown }
const later: Later[] = []
const LATER_KEPT = 40

function noteLater(text: string, agentId?: string, done?: () => unknown, drop?: () => unknown): void {
  if (!text) return
  later.push({ text, agentId, done, drop })
  while (later.length > LATER_KEPT) { const x = later.shift(); try { if (x && x.drop) void x.drop() } catch {} }
}

function takeLater(agentId?: string): Later[] {
  const mine = later.filter((x) => x.agentId === agentId)
  for (const x of mine) later.splice(later.indexOf(x), 1)
  return mine
}

/* the notes have ridden: a delivery acks its answers only now */
function rode(xs: Later[]): void {
  for (const x of xs) if (x.done) { try { void Promise.resolve(x.done()).catch(() => {}) } catch {} }
}

/* a call's answer with its own notes and the loop's waiting ones; a refusal carries none, so they wait */
function withNotes(res: any, bound: string[], agentId?: string): any {
  if (!res || res.deny) { for (const t of bound) noteLater(t, agentId); return res }
  const xs = takeLater(agentId)
  const texts = [...bound, ...xs.map((x) => x.text)].filter(Boolean)
  if (!texts.length) return res
  rode(xs)
  return { ...res, context: [...(res.context || []), ...texts] }
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
  const all: any[] = (j && Array.isArray(j.events) ? j.events : []).map((e: any) => { const box = e.box || sid; return { ...e, key: box + '|' + e.key, box, orig: e } })
  /* a take-over written by one of this process's own ids is its own /clear move, not news to it */
  const own = [sid, ...mem.lineage]
  const selfMove = (e: any) => !!(e.raw && /-edit$/.test(String(e.raw.kind)) && /^taken over/.test(String(e.raw.detail || ''))
    && own.includes(String(e.raw.by || '').replace(/^session:/, '')))
  if (verb === 'take') ack(all.filter((e: any) => selfMove(e) || toldByTool(e)))
  const got: any[] = all.filter((e: any) => !selfMove(e) && !toldByTool(e)).concat(held)
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
  const waiting = inboxWaiting(fresh, band.options, (band.near && band.near.here && band.near.here.pc) || '')
  await toastArrived($, waiting).catch(() => {})
  return waiting
}

async function markTold($: any, evs: any[]): Promise<void> {
  try { await $.store.set('delivered', rememberKeys(await deliveredKeys($), evs.map((e: any) => e.key))) } catch {}
  ack(evs)
  await localTold($, evs.filter((e: any) => e.local)).catch(() => {})
  band.inbox = null
  /* the waiting count is the band's and Home's copy of it; the status row never reads it */
  laterRedraw($, ['band', 'pane', 'cards'])
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
  let text = ''
  try {
    await learnOptions($, fresh).catch(() => {})
    text = deliveryText(fresh, band.options)
  } finally { if (!text) landed(fresh) }
  /* acked once it rides; one never carried is not acked, so a later take answers it again */
  noteLater(text, undefined, async () => { try { received($, fresh); await markTold($, fresh) } finally { landed(fresh) } }, () => landed(fresh))
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
/* owed: an answer's owed draw this take joins (deliverAsked) */
async function submitWaiting($: any, owed = -1): Promise<void> {
  let fresh: any
  try {
    if (inbox.busy) await inbox.busy
    fresh = await readInboxes($, 'take')
  } catch (err) { if (owed >= 0) oweLet($, owed); throw err }
  band.inbox = null
  /* the waiting count shows on the band and Home's copy of it */
  if (owed >= 0) { touch('board'); oweLet($, owed, BAND_VIEW) }
  else qpaneRedraw($)
  if (!fresh || !fresh.length) return
  try {
    await learnOptions($, fresh).catch(() => {})
    /* not acked: the band counts it again at the next load */
    if (!(await ownSubmit($, deliveryText(fresh, band.options)))) { kick($); return }
    received($, fresh)
    await markTold($, fresh)
  } finally { landed(fresh) }
}

/* The user's typed prompt carries what waits, as its context. */
async function promptNote($: any): Promise<string> {
  if (inbox.busy) await inbox.busy
  const fresh = await readInboxes($, 'take')
  /* a take that answered covers the turn this prompt starts */
  inbox.prompted = fresh !== null
  if (!fresh || !fresh.length) return ''
  try {
    await learnOptions($, fresh).catch(() => {})
    const text = deliveryText(fresh, band.options)
    received($, fresh)
    await markTold($, fresh)
    return text
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
/* lead: the pressed surface, drawn first; the status row shows no chip */
function chipsMoved($: any, ids: string[], lead: Site = 'cards'): void {
  qpane.answering = answeringOf(answers.chips)
  /* the questions' cards, never every card */
  qpaneRedraw($, chipSites(ids, lead))
}
const answerFailed = (id: string) => (err: any): Recorded => ({ ok: false, text: 'Answering ' + id + ' failed: ' + String((err && err.message) || err) })
/* a recorded answer's chip: done under the pick that stands */
function chipDone(id: string, letter: string, r: Recorded): void {
  delete answers.chips[id + '|' + letter]
  if (!r.ok) return
  answers.chips[id + '|' + (r.pick || letter)] = { state: 'done' }
  savedFrozen(token(id, r.pick || letter))
}
/* the surfaces chipsMoved asks, the pressed one first */
function chipSites(ids: string[], lead: Site): string[] {
  const cards = ids.map(qCount)
  const rest = (['pane', 'band'] as Site[]).filter((s) => s !== lead)
  return lead === 'cards' ? [...cards, ...rest] : [lead, ...cards, ...rest]
}

/* an answer's done draw is owed to what its write starts (the reload, the turn it delivers),
   so after the press each surface draws once more, with all of it. waits: what it still waits on;
   load: the load that releases it, one read after the write; gen: moves at each draw, so a late release
   draws its own sites at the gate; late: the number of a reload the bound drew without, which the gate draws too */
const owe: { gen: number; waits: number; sites: Set<string>; timer?: any; load?: { after: number; gen: number }; late?: number } = { gen: 0, waits: 0, sites: new Set() }
/* a board slower than this draws the done state alone, so a chip never stays saving behind it; the
   local server answers a load's reads in about 160 ms at the median */
const OWE_MS = 400
function oweHold(): number { owe.waits++; return owe.gen }
function oweLet($: any, gen: number, sites: string[] = []): void {
  /* past the bound the press has had its two draws, so what lands later rides the next owed
     draw when one is armed, else waits at the gate as any passive update */
  if (gen !== owe.gen) {
    if (owe.timer) for (const s of sites) owe.sites.add(s)
    else if (sites.length) laterRedraw($, sites)
    return
  }
  for (const s of sites) owe.sites.add(s)
  if (--owe.waits <= 0) oweDraw($)
}
/* the reload a write starts: the first load read after now releases it */
function oweLoad($: any): void {
  if (!owe.load || owe.load.gen !== owe.gen) owe.waits++
  owe.load = { after: loads.n, gen: owe.gen }
  if (owe.timer) return
  try { owe.timer = $.clock.after(OWE_MS, ran('answer draw timer', () => { owe.timer = undefined; oweDraw($) })) } catch {}
}
function oweDraw($: any): void {
  try { if (owe.timer) owe.timer.cancel() } catch {}
  owe.timer = undefined
  owe.gen++
  owe.waits = 0
  if (owe.load) owe.late = owe.load.after + 1
  owe.load = undefined
  const sites = [...owe.sites]
  owe.sites.clear()
  if (sites.length) qpaneRedraw($, sites, 'board')
}

/* after: the caller's own changes once the write is in, and the surfaces they move */
async function pressAnswer($: any, id: string, letter: string, run: () => Promise<Recorded>, lead: Site = 'cards',
  after?: (r: Recorded) => Promise<string[]> | string[]): Promise<Recorded | null> {
  if (answeringOf(answers.chips)[id]) return null
  drawCause('answer', token(id, letter))
  answers.chips[id + '|' + letter] = { state: 'pending' }
  chipsMoved($, [id], lead)
  const gen = oweHold()
  const r: Recorded = await run().catch(answerFailed(id))
  chipDone(id, letter, r)
  toast($, r.text, 'press')
  /* a refused or failed write shows at once */
  if (!r.ok) { oweLet($, gen); chipsMoved($, [id], lead); return r }
  qpane.answering = answeringOf(answers.chips)
  /* moved now, drawn with the owed draw: a draw meanwhile reads the done chip */
  touch('view')
  oweLoad($)
  kick($)
  const more = after ? await Promise.resolve().then(() => after(r)).catch(() => [] as string[]) : []
  oweLet($, gen, [...chipSites([id], lead), ...more])
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
  const r = await pressAnswer($, q.id, a.letter, () => recordAnswer($, q.id, a.letter, 'band', undefined, undefined, q.version), 'band')
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
  if (lost(r)) return { ok: false, error: r === 'late' ? 'the local server did not answer within ' + ROUTE_MS / 1000 + ' s; it may have run' : 'the local server dropped the call; it may have run' }
  let j: any = null
  try { j = JSON.parse(r.text) } catch {}
  return j && j.ok === true ? { ok: true, result: j.result } : { ok: false, error: String((j && j.error) || 'the local server answered ' + r.status) }
}

/* The user's press in the session that asked (or that holds the look task) starts its turn with the
   result; the local board tells the inbox as the row lands, so the take waits for it */
async function deliverAsked($: any, before: any, site: PressSite): Promise<void> {
  /* an answer's done draw still owed waits for this turn's take too */
  const gen = owe.waits > 0 ? oweHold() : -1
  try {
    if (before && Number.isFinite(before.seq)) await waitRead($, 'wait?after=' + before.seq + '&ms=' + CATCH_MS).catch(() => null)
  } finally {
    if (!userDelivers($, site, gen) && gen >= 0) oweLet($, gen)
  }
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
  qpaneRedraw($)
  const r = await pressCall($, c, p, 'band').catch((err: any) => ({ ok: false, text: callPressText(c, p, null, String((err && err.message) || err)) }))
  if (r.ok) callPresses.set(c.key, 'done'); else callPresses.delete(c.key)
  toast($, r.text, 'press')
  qpaneRedraw($)
  await refresh($)
}

/* The band's calls less the ones pressed. */
function withPresses(model: any): any {
  if (!model || !Array.isArray(model.calls) || !callPresses.size) return model
  return { ...model, calls: model.calls.filter((c: any) => !callPresses.has(c.key)) }
}

/* /askerdo withdraw K-n (fix, scrub, or allow for any), keep K-n, unscrub K-n: the same
   act as the card's press, typed; the board refuses an act word that is not the request's */
async function overrideCmd($: any, verb: string, args: string): Promise<string> {
  const o = parseOverride(verb, args)
  if (o.error) return o.error
  mem.engaged = true
  const sid = await sessionId($)
  const before = await waitRead($, 'state')
  const argv = verb === 'unscrub' ? ['override', 'unscrub', o.id, '--user', sid, '--json'] : ['override', 'decide', o.id, verb, '--user', sid, '--json']
  const press = verb === 'unscrub' ? { label: 'Unscrub', verb: 'overrideUnscrub' } : { label: capFirst(verb), verb: 'overrideDecide' }
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
    ? { calls: listOf((withPresses(near.model) || {}).calls).map(linked), asks: near.handoffAsks || [] }
    : { missing: 'The local board is not answering, so Home\'s calls and the handoffs\' asks are not listed.' }
  /* the band's health row, in a line ahead of what may be a stale list */
  const fix = healthCall(healthShown($))
  return (fix ? 'AskerDo on this PC needs a fix: ' + fix.text + '\n' : '') + staleFirst(openSetText(full.concat(list.slice(SHOW_MAX)), { limit: SHOW_MAX, url: await setLink($), ...more }), r)
}

/* every site of the user's own hand starts one turn in an idle
   session; mid-turn a note at the next step; a frozen session only records. */
const TURN_SITES = ['band', 'pane', 'card', 'typed', 'resume']
const userStartsTurn = (site: PressSite): boolean => TURN_SITES.includes(site)
type PressSite = 'band' | 'pane' | 'card' | 'typed' | 'resume'

/* what the user did here reaches this session's model: mid-turn a note at the
   next step, idle one turn where the site starts one; a frozen session never. */
/* owed: the generation of an answer's owed draw the take's draw joins (-1 none); true when the take will release it */
function userDelivers($: any, site: PressSite, owed = -1): boolean {
  if (closedAs(mem.id)) return false
  if (mem.turn) { void deliver($).catch(() => {}); return false }
  if (!userStartsTurn(site)) return false
  /* a prompt submitted inside command.run would wait on the turn the command holds */
  try { $.clock.after(0, ran('submit timer', () => { void submitWaiting($, owed).catch(() => {}) })); return owed >= 0 } catch { return false }
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
type Recorded = { ok: boolean; text: string; pick?: string; owned?: boolean; stood?: boolean; gone?: boolean; sent?: string; late?: boolean; id?: string; key?: string; lands?: boolean }
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
    return stood ? { ...stood, stood: true } : { ok: false, text: failed('Answering ' + (shown || id), r), gone: GONE.test(r.err), late: r.late }
  }
  /* the same pick already stored reached its subscribers the first time, so no turn;
     else the turn waits for the answer's inbox line, as a call's press does (never the chip's look) */
  const already = !!(r.json && r.json.already)
  const owned = !already && ownsIt(r.json && r.json.owner, sid)
  /* the echo always names the label the store answered and its name; the name from
     what the band read when the answer leaves it out, never a second call */
  const label = (r.json && r.json.id) || shown || id
  const line = { id: label, key: (r.json && r.json.key) || undefined }
  const lands = owned && landsHere(r.json && r.json.owner, sid)
  /* the turn waits on this answer's own line, not on any board change (a redraw) */
  if (owned && !hold) void inboxHolds($, lands ? [line] : []).then(() => deliverAsked($, before, site)).catch(() => {})
  /* Send reloads once, after its last answer */
  if (!hold) kick($)
  const known = (band.questions || []).find((q: any) => q && (q.id === label || (q.key && q.key === id)))
  const name = (r.json && r.json.name) || (known && known.name) || ''
  const sent = 'Answered ' + label + (name ? ' (' + name + ')' : '') + ': '
    + (letter ? token(label, letter) + '.' + (note ? ' Note: ' + note : '') : note) + wentTo(r.json && r.json.owner, sid)
  /* the board stands only the same pick and note, so a resumed Send counts it as its own (`sent`) */
  if (already) return { ok: true, stood: true, pick: letter, sent, owned: ownsIt(r.json.owner, sid), text: label + (name ? ' (' + name + ')' : '') + ' already answered ' + (r.json.pick || token(label, letter)) + ', recorded as it was.' }
  return { ok: true, owned, text: sent, lands, ...line }
}

/* a press on a question another session owns starts no turn here; it went there */
const ownsIt = (owner: any, sid: string): boolean => !owner || !owner.session || owner.session === sid
/* the board tells this inbox only the owner's own press: a record with no owner session tells nobody here */
const landsHere = (owner: any, sid: string): boolean => !!(owner && owner.session === sid)

/* an answer to a question another session owns says where it went: that session's
   track (else another session) and PC, and that it reads it at its next turn */
function wentTo(owner: any, sid: string): string {
  if (!owner || !owner.session || owner.session === sid) return ''
  const who = owner.track ? 'the session on ' + owner.track + (owner.trackName ? ' ' + owner.trackName : '') : 'another session'
  return ' It went to ' + who + (owner.pc ? ', on ' + owner.pc : '') + ', which reads it at its next turn.'
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
/* this PC's day as YYYY-MM-DD, the day asleepWake reads "due now" against */
const todayIs = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
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
  /* the wake in the Asleep row's own words */
  const wake = asleepWake(DAY.test(words) ? { until: words } : { trigger: words }, todayIs()).text.replace(/[.!?]+$/, '')
  return { ok: true, text: 'Snoozed ' + label + ' ' + wake + '.' + wentTo(owner, sid) }
}

/* the Asleep group's Wake press, the user's act with no model turn: 'busy' while the board
   answers, then 'held' until the row leaves the list (the local board reads the wake later), a failure's
   words until the next press or the row leaves */
const wakes = new Map<string, string>()
const WAKE_HOLD_MS = 15000
let wakeGen = 0
const wakeHeld = new Map<string, number>()
const waking = (st: string | undefined) => st === 'busy' || st === 'held'
function wakePress($: any, id: string): void {
  if (waking(wakes.get(id))) return
  wakes.set(id, 'busy')
  qpaneRedraw($, PANE_ONLY)
  const end = (words: string) => {
    if (words) wakes.set(id, words)
    else if (!(band.asleep || []).some((q: any) => q && q.id === id)) wakes.delete(id)
    else {
      const gen = ++wakeGen
      wakes.set(id, 'held')
      wakeHeld.set(id, gen)
      try {
        $.clock.after(WAKE_HOLD_MS, ran('wake hold timer', () => {
          if (wakeHeld.get(id) !== gen) return
          wakeHeld.delete(id)
          if (wakes.get(id) === 'held') { wakes.delete(id); laterRedraw($, PANE_ONLY, 'view') }
        }))
      } catch {}
    }
    qpaneRedraw($, PANE_ONLY)
  }
  void (async () => {
    mem.engaged = true
    const sid = await sessionId($)
    const r = await queued(() => cli($, ['wake', id, '--user', sid, '--json']))
    kick($)
    /* awake already (woken elsewhere or by its date) is what the press asked for */
    end(r.ok || /not snoozed/.test(r.err || '') ? '' : wakeFailed(r.err || ''))
  })().catch((err: any) => end(wakeFailed(String((err && err.message) || err))))
}
/* a failure in the row's own words: the rows carry no id, and offline no board address */
function wakeFailed(err: string): string {
  if (/unreachable|offline|ECONNREFUSED|ETIMEDOUT|did not answer|nobody answered|could not start/i.test(err)) return 'Not woken: the board is offline. Press Wake again once it is back.'
  /* the CLI's own "AskerDo: " lead is the row's noise, as refusal() drops it */
  const why = err.trim().replace(/^AskerDo:\s*/, '').replace(/https?:\/\/\S+/g, 'the board').replace(/\b(?:Q|T-|K-|TR-|WS-|P-)\d+[a-z]?\b/g, 'it').replace(/\s+/g, ' ').trim()
  return 'Not woken' + (why ? ': ' + why : '.') + (why && !/[.!?]$/.test(why) ? '.' : '')
}
/* a band read: a row gone from the list drops its failure words and its hold, so a later snooze starts clean */
function wakesKeep(list: any[]): void {
  const ids = new Set(list.map((q: any) => q && q.id))
  for (const [id, st] of wakes) if (st !== 'busy' && !ids.has(id)) { wakes.delete(id); wakeHeld.delete(id) }
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

/* the engine skips this mod's prompt.submit hook for its own submit, so the blocks
   changed since the last prompt go here: a note ahead of the turn, else `head` for the text's front */
async function carryAhead($: any): Promise<{ head: string; undo: () => Promise<void> }> {
  await profilesRev($, true).catch(() => {})
  const was = { ...(carry.told || {}) }
  const changed = await carryNote($, false).catch(() => '')
  const none = { head: '', undo: async () => {} }
  if (!changed || await appendNote($, changed)) return none
  return { head: changed + '\n\n', undo: async () => {
    const told = carry.told || {}
    for (const id of Object.keys(told)) if (told[id] !== was[id]) { if (id in was) told[id] = was[id]; else delete told[id] }
    await keepSent($).catch(() => {})
  } }
}

/* Every turn the mod starts goes through here. A refused submit puts the blocks back for the next
   prompt, or with `later` leaves the whole text as a note at the next step */
async function ownSubmit($: any, text: string, later = false): Promise<boolean> {
  const c = await carryAhead($)
  let r: any
  try { r = await $.prompt.submit({ text: c.head + text, asUser: true }) } catch (err: any) { r = { drop: String((err && err.message) || err) } }
  if (!(r && r.drop)) return true
  if (later) noteLater(c.head + text)
  else await c.undo()
  return false
}

/* one turn when idle, else a note the model reads at its next step */
async function tellBrief($: any, text: string): Promise<'turn' | 'note' | ''> {
  if (userStartsTurn('resume') && !mem.turn) return (await ownSubmit($, text, true)) ? 'turn' : 'note'
  const c = await carryAhead($)
  noteLater(c.head + text)
  return 'note'
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
    const all = (shelf.json.rows || []).filter((row: any) => row && row.track && row.workstream === parsed.workstream)
    /* a track that waits or is parked comes before one never held, as before the shelf listed those */
    const held = all.filter((row: any) => row.state !== 'new')
    const rows = held.length ? held : all
    if (!rows.length) return 'No track of ' + parsed.workstream + ' is waiting or parked.' + lost
    if (rows.length > 1) return parsed.workstream + ' has ' + rows.length + ' tracks on the shelf; pick one.' + lost + '\n' + shelfText(rows)
    track = rows[0].track
  }
  const sid = await sessionId($)
  const move = parsed.move === 'take over' ? ['--take-over'] : parsed.move === 'read only' ? ['--read-only']
    : parsed.move === 'splinter' ? ['--splinter', parsed.name] : parsed.here ? ['--here'] : []
  const r = await cli($, ['resume', track, ...move, '--session', sid, '--json'])
  if (!r.ok) return failed('Resuming ' + track, r) + lost
  /* its handoff names another PC for the next leg; nothing was taken */
  if (r.json.elsewhere) return String(r.json.next || '') + lost
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
  const words = parsed.note && !inPrompt ? capFirst(nameOf()) + '\'s words with this resume:\n' + parsed.note : ''
  let told: 'turn' | 'note' | 'queued' | '' = ''
  const what = 'The kickoff' + (words ? ', with your words,' : '')
  if (inPrompt) return [head, brief, words].filter(Boolean).join('\n\n')
  if (brief || words) {
    const text = [verify.join('\n'), brief, words].filter(Boolean).join('\n\n')
    /* a prompt submitted inside command.run waits on the turn the command holds, so the
       typed resume submits from a timer once it has answered, as handoffCmd does */
    if (inCommand && userStartsTurn('resume') && !mem.turn) {
      $.clock.after(0, ran('resume brief timer', () => {
        void tellBrief($, text).then((t) => {
          if (t !== 'turn') toast($, what + (t === 'note' ? ' could not start a turn; it went to the model as a note.' : ' could not reach the model.'), 'press')
        })
      }))
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
  /* a prompt the user did not type (a start card's, a peer's) never carries their mark; the bridge is their own words */
  if (kind !== 'bridge' && userMarked(args)) {
    debugLine($, 'AskerDo origin: a prompt of ' + (await sessionId($)) + ' came from ' + kind + ' and its line ' + line + ' was not run')
    return 'AskerDo did not run this prompt\'s line ' + line + ': it is ' + nameOf() + '\'s own command and carries their mark, so it runs only when they type it themselves. '
      + 'Ask them to type it, or to press the card; a token they type in chat goes through the answer tool.'
  }
  debugLine($, 'AskerDo origin: a prompt of ' + (await sessionId($)) + ' came from ' + kind + ' and ran as ' + line)
  const r = await runAskerdo($, { args, origin: e.origin }, true)
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
const inboxText = (inbox: any, ws?: any) => inboxLines(Array.isArray(inbox) ? inbox : [], undefined, ws).map((l: string) => '\n' + l).join('')
/* `ws`: the closing track's workstream; `awayIds`: the due rows of another, which the close only names */
function keepInbox(track: string, inbox: any, more = false, dueIds?: string[], ws?: any, awayIds?: string[]): void {
  const list = Array.isArray(inbox) ? inbox : []
  const ids = list.map((t: any) => String((t && t.id) || t || '')).filter(Boolean)
  if (!ids.length) return
  /* the rows due at the close, which naming alone no longer settles */
  const due = dueIds || list.filter((t: any) => t && t.due).map((t: any) => String(t.id || '')).filter(Boolean)
  const away = awayIds || dueAway(list, ws)
  const was = checks.inbox
  checks.inbox = { track: track || (was && was.track) || '', ids: [...new Set([...((was && was.ids) || []), ...ids])],
    due: [...new Set([...((was && was.due) || []), ...due])], away: [...new Set([...((was && was.away) || []), ...away])], more: more || !!(was && was.more) }
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
    return r.ok ? trackText(r.json, Date.now(), sid) : needTrack()
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
    /* the user's own capture wakes 14 days out, the one filing the board never refuses */
    /* both are tier 2, a step on the held track or its workstream's inbox due on a date, so the capture is marked */
    const r = await cli($, ['track', 'capture', '--tier', '2', ...(p.inbox ? ['--workstream', ws, '--unplaced', 'captured into the inbox by /askerdo track capture inbox', '--wake', wakeIn()] : ['--track', held as string]), '--name', p.name, '--user', sid, '--json'])
    if (!r.ok) return failed('Capturing', r)
    kick($)
    return r.json.id + ' captured ' + (r.json.track ? 'onto ' + r.json.track : 'into the inbox of ' + ws + (r.json.wake ? ', back on ' + r.json.wake : '')) + '; the work in hand carries on.'
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
    /* the user's own command, marked so the board never asks about it */
    const r = await cli($, ['track', 'finish', target, ...(p.outcome ? ['--outcome', p.outcome] : []), '--user', sid, '--json'])
    if (!r.ok) { keptHold(target); return failed('Finishing ' + target, r) }
    if (target === held) setTrack(null)
    kick($)
    keepInbox(target, r.json.inbox, false, undefined, r.json.workstream)
    /* the board's sweep offer is worded for a session; this answer is the user's to read */
    return target + ' ' + (r.json.state || 'done') + '.' + junctionBack(r.json) + inboxText(r.json.inbox, r.json.workstream)
      + (r.json.sweep ? '\nTo look through ' + (r.json.id || target) + "'s sessions for anything left behind, run /askerdo:sweep " + (r.json.id || target) + '.' : '')
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
  const running = await runningForAsk($)
  $.clock.after(0, ran('park timer', () => { void submitPark($, track, sid, reason, running).catch(() => {}) }))
  return 'Asking the model to write the parked handoff for ' + track + ': ' + reason + '.' + waitsLine(running)
}

/* The track parked with no handoff only when no turn can start (the prompt refused). */
async function submitPark($: any, track: string, sid: string, reason: string, running = ''): Promise<void> {
  const ask = await submitAsk($, track, reason, running)
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
async function submitHandoff($: any, track: string, running = ''): Promise<void> {
  await submitAsk($, track, undefined, running)
}
/* the user's own ask waits for the session's work as the write does, and says so in one line */
async function runningForAsk($: any): Promise<string> {
  try { return runningNames((await handoffWaits($)).list) } catch { return '' }
}
const waitsLine = (running: string): string => (running ? ' It waits for the work still running: ' + running + '.' : '')

/* The transcript shows one short line in the user's name. The long ask goes first as a note the
   model reads and the user does not see as typed: the engine skips the mod's own prompt.submit
   hook for its own submit, so no context can ride it (measured on 2.1.308's plugin test) */
const appendNote = async ($: any, text: string): Promise<boolean> => {
  try { const a = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } }); return !(a && a.deny) } catch { return false }
}
async function submitAsk($: any, track: string, reason?: string, running = ''): Promise<{ turn: boolean; noted: boolean }> {
  const long = handoffPrompt(track, reason, running)
  const noted = await appendNote($, long)
  return { turn: await ownSubmit($, noted ? handoffAsk(track, reason) : long), noted }
}

async function handoffCmd($: any): Promise<string> {
  const track = await boundTrack($, undefined, true)
  if (!track) return needTrack()
  await handoffAsked($, await sessionId($))
  /* a prompt submitted inside command.run would wait on the turn the command
     holds (host check), so it goes from a timer once the command has answered */
  const running = await runningForAsk($)
  $.clock.after(0, ran('handoff timer', () => { void submitHandoff($, track, running) }))
  return 'Asking the model to write the handoff for ' + track + '.' + waitsLine(running)
}

/* the shortcut that puts the guard-on or guard-off profile on this project. */
async function guardCmd($: any, args: string): Promise<string> {
  const p = parseGuard(args)
  if (p.error) return p.error
  const sid = await sessionId($)
  await boundTrack($, sid, true)
  await markerRun($, sid, mem.trackKey, p.sub === 'show' ? [] : ['--project', p.sub])
  /* the user's press or command: its chip turns at once */
  qpaneRedraw($, OWN)
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
  if (['withdraw', 'fix', 'scrub', 'allow', 'keep', 'unscrub'].includes(p.verb)) return overrideCmd($, p.verb, p.args)
  return p.error
}

async function runAskerdo($: any, given: any, inPrompt = false): Promise<{ text: string }> {
  /* an id pasted from the desktop pane carries a word joiner after its hyphen */
  const e = { ...given, args: String((given && given.args) || '').split(String.fromCharCode(0x2060)).join('') }
  await settle($).catch(() => {})
  /* /askerdo L1a answers a kept question and engages nothing */
  /* a run the user did not start (a peer's line, the model's Skill call) never carries their mark */
  const kind = e.origin && e.origin.kind
  /* a live session read which origin a typed command carries, so USER_KINDS rests on a measure */
  if (userMarked(e.args)) debugLine($, 'AskerDo origin: /askerdo ' + String(e.args).trim().split(/\s+/)[0] + ' ran from ' + (kind || 'no origin'))
  if (kind && !USER_KINDS.includes(kind) && userMarked(e.args)) return { text: commandLead(e.args, modelCommand(e.args)) }
  const p = parseAskerdo(e.args || '')
  const a = p.verb === 'answer' ? parseAnswer(p.args) : null
  if (a && !a.error && [a, ...(a.more || [])].every((x: any) => isLocalId(x.id))) return { text: commandLead(e.args, await answerCmd($, p.args)) }
  /* engaged now, drawn after the command, so a binding it makes narrows the
     first draw instead of following a flash of every project blocker */
  const first = !mem.engaged
  mem.engaged = true
  try { return { text: commandLead(e.args, await askerdoCmd($, e.args || '', inPrompt)) } } finally { if (first) kick($) }
}

/* the origins of a run the user started: Enter, the Remote Control bridge, a follow-up to their own press; never the
   SDK host's own turn (a start card's prompt, a `claude -p` a session's shell runs), which userSaid does not count either */
const USER_KINDS = ['composer', 'bridge', 'auto-continuation']
const commandFailed = () => ({ text: PLUGIN + ': /' + COMMAND + ' failed before it answered.' })

/* ---- the AskerDo pane: Home, Questions and Tracks as tabs ---- */

/* The tab shown and Home's filter, kept across redraws; chosen: an opener or a tab press set the tab;
   unfolded: the questions Home's copy shows unfolded under their row. */
/* pic: the level Home's picture is on, null for the held track's lines; picOf: the track it
   was pressed on, so a new held track starts from its own lines */
/* done: Home's fold of finished agents, shut until pressed, held for the session only */
/* filterSeed: the text the filter field is drawn with, the filter as the field last mounted */
type PicView = { level: number; ws: string; tr: string | null; sel: string | null }
const view: { tab: PaneTab; filter: string; filterSeed: string; chosen?: boolean; unfolded: Set<string>; pic: PicView | null; picOf?: string; done: boolean; bgDone: boolean; bgMore: Set<string>; seeded?: PaneTab } = { tab: 'home', filter: '', filterSeed: '', unfolded: new Set(), pic: null, done: false, bgDone: false, bgMore: new Set() }

/* the moment this PC last drew a workstream (or the Overview) before this session's first
   draw, asked once a session for each, which the since line reads */
const picLooks: { got: Record<string, string | null>; asking: Set<string> } = { got: {}, asking: new Set() }
async function lookRead($: any, k: string): Promise<void> {
  if (k in picLooks.got || picLooks.asking.has(k)) return
  picLooks.asking.add(k)
  try {
    const base = await localBase($)
    if (!base) return
    const session = await sessionId($).catch(() => mem.id)
    const r = await routePost($, base, 'look', k === 'overview' ? { session } : { session, ws: k })
    if (!r || lost(r)) return
    /* any answer is kept, a refusal as no look, so an older server is not asked at every draw */
    const look = r.status === 200 && r.reply && r.reply.ok === true && r.reply.result ? r.reply.result.look : null
    picLooks.got[k] = typeof look === 'string' ? look : null
    boardRedraw($, PANE_ONLY, false)
  } finally {
    picLooks.asking.delete(k)
  }
}

/* the real assets/ favicons the picture nests for a session and its answers, read once */
const picIcons: Record<string, string> = {}
let iconsRead: Promise<void> | undefined
function iconsReady($: any): Promise<void> {
  if (!iconsRead) {
    iconsRead = (async () => {
      for (const [k, f] of [['fav', 'favicon'], ['quiet', 'favicon-quiet'], ['block', 'favicon-blocking']]) {
        try { const t = await $.fs.read($.plugin.root + '/assets/' + f + '.svg'); if (t) picIcons[k] = String(t) } catch {}
      }
    })()
  }
  return iconsRead
}
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
  /* Tracks at a track: the focus scrolls its tile's name into view (desktop) */
  if (tab === 'tracks' && focus && r && r.isPlaced !== false) try { await $.ui.focus({ requestId: PANE_ID, key: 'tname-' + focus + '-link' }) } catch {}
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
      const now: FeedRead = lines ? { mark, lines, wsNames: r.json.wsNames || {} }
        : have && have.lines ? { ...have, mark } : { mark, error: failed('Reading the activity', r) + '.' }
      const was = feed[which]
      feed[which] = now
      /* the same lines read again draw nothing; what Home shows is checked at the gate */
      const shown = (f?: FeedRead) => JSON.stringify(f ? [f.lines, f.wsNames, f.error] : null)
      if (shown(now) !== shown(was)) boardRedraw($, [], true)
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
    /* the first read (the tab opened) or one a settings press asked draws at once; one a board change moved waits for the gate */
    const asked = !have || sread.stale
    sread.stale = false
    sread.loading = (async () => {
      const dir = await projectDir($)
      const r = await cli($, ['settings', '--json', ...(track ? ['--track', track] : []), '--project', dir])
      const ok = r.ok && r.json && Array.isArray(r.json.rows)
      if (ok) pressesFrom((r.json.rows.find((x: any) => x && x.key === 'answerPresses') || {}).value)
      /* a failed read keeps the rows last read and says so */
      sread.have = ok ? { mark, json: r.json, dir, track }
        : { ...(have && have.json ? have : {}), mark, error: failed('Reading the settings', r) }
      if (asked) qpaneRedraw($)
      else laterRedraw($)
    })().catch(() => {}).finally(() => { sread.loading = undefined })
  }
  return have
}

/* the place a write goes as the CLI takes it: the record after the key or value, then --at */
const atArgs = (at?: SettingsPlace) => (!at || at.level === 'pc' ? [] : [...(at.level !== 'default' && at.record ? [at.record] : []), '--at', at.level])
const oneLine = (s: string) => String(s || '').replace(/\s+/g, ' ').trim()
/* a refusal in the verb's own words, without the CLI's prefix */
const refusal = (r: Run) => oneLine(r.err).replace(/^AskerDo: /, '') || 'the CLI failed (exit ' + r.code + ')'
/* a press-only setting's write, the user's own, through the route; a server that will not run it
   leaves a process with no script to start, which is said in words */
async function pressWrite($: any, press: { act: string; key: string; value?: string; at?: SettingsPlace }, dir: string, track?: string): Promise<Run> {
  const at = press.at && press.at.level !== 'pc' ? press.at : undefined
  const record = at ? (at.level === 'project' ? at.record || dir : at.record || undefined) : track || dir
  const body = { act: press.act, key: press.key, ...(press.value !== undefined ? { value: press.value } : {}), at: at && at.level, record, project: dir }
  const r = await spawn($, ['node', $.plugin.root + '/scripts/placement-press.mjs', '--session', await sessionId($)], { timeoutMs: 15000, stdin: JSON.stringify(body) })
  const out = String(r.stdout || '')
  const said = String(r.stderr || '').replace(/^(AskerDo|placement-press): /gm, '').trim()
  const err = /Cannot find module/.test(said) ? 'the local server did not take this press; nothing changed. Start a new session and press it again' : said
  const run: Run = { ok: r.exitCode === 0, code: r.exitCode, out, err }
  if (run.ok) { try { run.json = JSON.parse(out) } catch { run.ok = false; run.err = 'the press answered something that is not JSON' } }
  return run
}
const pressOf = (act: string, key: string, value?: string, at?: SettingsPlace) => (readRows().find((x: any) => x.key === key) || {}).press ? { act, key, value, at } : undefined
async function settingsWrite($: any, argv: string[], key: string, done: (r: Run) => { text: string; dim?: string }, press?: { act: string; key: string; value?: string; at?: SettingsPlace }): Promise<void> {
  const have = sread.have || {}
  const dir = have.dir || await projectDir($)
  const r = press ? await pressWrite($, press, dir, have.track) : await cli($, [...argv, ...(have.track ? ['--track', have.track] : []), '--project', dir, '--json'])
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
/* the phone sign-in mints through the route; the code stays drawn until its link
   expires, then the press comes back */
async function phoneLink($: any): Promise<void> {
  if (sview.phone && sview.phone.busy) return
  sview.phone = { busy: true }
  qpaneRedraw($, PANE_ONLY)
  const r = await cli($, ['login', '--qr', '--json'])
  const j = r.json || {}
  if (!r.ok || !Array.isArray(j.qr) || typeof j.url !== 'string') {
    sview.phone = { error: r.ok ? 'the CLI answered with no code' : refusal(r) }
    qpaneRedraw($, PANE_ONLY)
    return
  }
  const link = { url: j.url, expires: String(j.expires || ''), rows: j.qr.map(String) }
  sview.phone = link
  const left = Date.parse(link.expires) - Date.now()
  try { $.clock.after(Math.max(0, Number.isFinite(left) ? left : 0) + 500, ran('phone link timer', () => { if (sview.phone === link) { sview.phone = undefined; laterRedraw($, PANE_ONLY) } })) } catch {}
  qpaneRedraw($, PANE_ONLY)
}
function settingsActions($: any): any {
  return {
    redraw: () => qpaneRedraw($, PANE_ONLY),
    phone: () => { void phoneLink($).catch((e: any) => { sview.phone = { error: String((e && e.message) || e) }; qpaneRedraw($, PANE_ONLY) }) },
    set: (key: string, value: string, at?: SettingsPlace) => {
      void settingsWrite($, ['settings', 'set', key, value, ...atArgs(at)], key, (r) => savedWords(key, r, false), pressOf('set', key, value, at)).catch(() => {})
    },
    unset: (key: string, at?: SettingsPlace) => {
      void settingsWrite($, ['settings', 'unset', key, ...atArgs(at)], key, (r) => savedWords(key, r, true), pressOf('unset', key, undefined, at)).catch(() => {})
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
      qpaneRedraw($, PANE_ONLY)
    })().catch(() => {}).finally(() => { guide.loading = undefined })
  }
  return guide.pages
}

function pressed($: any, act: () => void, sites: Site[] = OWN): () => void {
  return () => {
    act()
    qpaneRedraw($, sites)
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
/* a desktop ring press on a key the mod no longer draws was sent before its redraw (a second click,
   a press reported twice): its toggle would undo the first and its flip put the key out of step */
function ringStale(e: any): boolean {
  if (e.plugin !== PLUGIN || e.surface !== 'desktop' || typeof e.element !== 'string' || !RING_PRESS.test(e.element)) return false
  const k = baseKey(e.element)
  return e.element !== (handed.has(k) ? k + HAND : k)
}
/* The ring press log for the local timings: each desktop ring press, whether its key was the one
   drawn, the toggles it made, and each surface's draws in the window after it (count, own ms,
   first and last end after the press); the next band read carries the closed ones */
const RING_WINDOW = 2000
/* f: the surface a press's own redraw named first, where it shows; a: each surface's writes the mod asked in
   the window, so a draw it never asked (the app's own render) reads apart */
/* z: the cause's wall time, to set it beside a lag's due time; q: each surface's first ask, so a late first draw
   reads as the mod asking late or the app drawing late after the ask */
type RingPress = { k: string; c?: string; s: number; t: string; n: number; o: number; at: number; d: Record<string, number[]>; i?: number; w?: number; l?: number
  f?: string; a?: Record<string, number>; z?: number; q?: Record<string, number>; v?: string }
const rings: { now?: RingPress; out: RingPress[] } = { out: [] }
/* a board change, an answer or strip press, a tab switch or a zoom opens the same window, its cause named;
   a board change inside a press's window is that press's own (an answer's write, a read meanwhile) */
function drawCause(c: string, k = ''): void {
  if (c === 'board' && rings.now && Date.now() - rings.now.at <= RING_WINDOW) return
  ringClose()
  const at = Date.now()
  rings.now = { k, c, s: 0, t: '', n: 0, o: -1, at, z: at, d: {}, ...(c === 'board' ? {} : pressWait()) }
}
/* a draw count's id as the ring rows name its surface ('q Q1' and 'card u1' are cards) */
const ringSurface = (id: string): string => { const w = id.split(' ')[0]; return w === 'q' || w === 'cards' ? 'card' : w }
function ringOpen(): RingPress | undefined {
  const p = rings.now
  return p && Date.now() - p.at <= RING_WINDOW ? p : undefined
}
function ringLead(sites: string[]): void {
  const p = ringOpen()
  if (p && p.c && p.c !== 'board' && !p.f && sites.length) p.f = ringSurface(sites[0])
}
function ringAsked(id: string): void {
  const p = ringOpen()
  if (!p) return
  const s = ringSurface(id), a = p.a || (p.a = {}), q = p.q || (p.q = {})
  a[s] = (a[s] || 0) + 1
  if (q[s] === undefined) q[s] = Date.now() - p.at
}
/* timing rows of work no draw row holds, sent with the ring rows: the hooks thread's lag (a 250 ms
   tick's largest lateness), the draw check's hidden draws, and each Send answer's laps */
const LAG_TICK = 250
/* block: the largest lateness of the ticks that ran back to back up to `last`, since ticks queued
   during a block run first when it ends and the press behind them would read 0 */
const LAG_NEAR = 50
/* why: each check's causes, by the slice or ask that opened its gate; since: the rows' window start;
   live: the live lines' asks, per wall second (sec, asks, first and last answer ms in it, ms answering,
   lone asks, asks by drawing) */
const lagged: { last: number; block: number; max: number; n: number; late: number; timer?: any; press?: { at: number; l: number }; check: number[]; sends: number[][]; stuck: number
  why: Record<string, number>; since: number; gates: number; live: { sec: number; n: number; a: number; z: number; ms: number; lone: number; by: Record<string, number> }; lives: number[]
  match: number[]; helds: { l: number; b: string[]; i: string[]; d: number; w: string; g: number; r: string }[]; depths: { p: number; w: string }[]
  sizes: { w: string; v: string; n: number; l: number; c: number; t: number; g: number }[]
  worst?: { d: number; w: string; g: number; r: string } } =
  { last: 0, block: 0, max: 0, n: 0, late: 0, check: [0, 0, 0, 0], sends: [], stuck: 0, why: {}, since: Date.now(), gates: 0,
    live: { sec: 0, n: 0, a: 0, z: 0, ms: 0, lone: 0, by: {} }, lives: [0, 0, 0, 0, 0, 0, 0], match: [0, 0, 0, 0, 0], helds: [], depths: [], sizes: [] }
/* the decision matcher's calls and ms, the main loop's apart from agents', and the worst one */
function matchTimed(agent: boolean, ms: number): void {
  const m = lagged.match
  if (agent) { m[2]++; m[3] += ms } else { m[0]++; m[1] += ms }
  if (ms > m[4]) m[4] = ms
}
/* the thread's last entries (hook, cli reply, poll), so a tick late by HELD_LATE names what
   entered before the hold began (the likely holder) and what ran queued behind it */
const HELD_LATE = 1000
/* eight agents' hooks can queue hundreds of entries inside a hold, so the ring is deep */
const HELD_RING = 256
const heldRing: [string, number, string, boolean][] = []
function held(what: string, e?: any): void {
  heldRing.push([what, Date.now(), e && typeof e === 'object' ? String(e.tool || e.surface || e.element || '') : '', !!(e && e.agentId !== undefined)])
  if (heldRing.length > HELD_RING) heldRing.shift()
}
function heldSeen(now: number, late: number): void {
  if (lagged.helds.length >= 3) return
  const due = now - late
  const name = ([w, , d, a]: [string, number, string, boolean]) => (w + (d ? ' ' + d : '') + (a ? ' agent' : '')).slice(0, 40)
  const b = heldRing.filter((h) => h[1] <= due).slice(-3).map((h) => name(h) + ' ' + (due - h[1]))
  /* a full ring starting inside the hold dropped what entered before it: say so rather than none */
  if (!b.length && heldRing.length >= HELD_RING && heldRing[0][1] > due) b.push('over ' + HELD_RING + ' entries inside the hold')
  const i = heldRing.filter((h) => h[1] > due).slice(0, 5).map((h) => name(h) + ' +' + (h[1] - due))
  const [w, g] = beatVerdict(due, now, late)
  lagged.helds.push({ l: late, b, i, d: due, w, g, r: spansAt(due) })
}
/* the worker offers no event loop utilisation or gc entries (performance holds now() alone),
   so its own setInterval beats beside the host's tick: beats inside a hold say the worker was free
   and the host held the tick (idle); none say its thread was held (busy: JS or a collection) */
const BEAT_MS = 250
const BEATS = 64
const beats = new Float64Array(BEATS)
const beat: { i: number; timer?: any } = { i: 0 }
function beatArm(): void {
  if (beat.timer !== undefined) return
  try {
    beat.timer = setInterval(() => {
      const t = Date.now()
      beats[beat.i] = t
      beat.i = (beat.i + 1) % BEATS
      /* an environment the host dropped or froze stops its beat; the next tick arms it again */
      if (t - lagged.last > 30000) beatStop()
    }, BEAT_MS)
  } catch { beat.timer = undefined }
}
function beatStop(): void {
  try { if (beat.timer !== undefined) clearInterval(beat.timer) } catch {}
  beat.timer = undefined
}
/* the largest gap between the worker's own beats across the hold, the hold's ends counted */
function beatVerdict(due: number, now: number, late: number): [string, number] {
  if (beat.timer === undefined) return ['unknown', -1]
  const inside: number[] = []
  for (let k = 0; k < BEATS; k++) if (beats[k] > due && beats[k] < now) inside.push(beats[k])
  inside.sort((x, y) => x - y)
  /* a ring wholly inside a long hold lost its first beats: count from the oldest kept */
  let gap = 0, prev = inside.length === BEATS ? inside[0] : due
  for (const t of [...inside, now]) { gap = Math.max(gap, t - prev); prev = t }
  gap = Math.round(gap)
  return [gap >= late * 0.75 ? 'busy' : gap <= 2 * BEAT_MS ? 'idle' : 'part busy', gap]
}
/* the timer bodies (ran: their synchronous part) and the redraw check (in flight to its end) as
   spans in a fixed ring, so a held tick names what was running when it came due: a name, two clock reads */
const SPANS = 32
const spanName: string[] = new Array(SPANS).fill('')
const spanAt = new Float64Array(SPANS)
const spanEnd = new Float64Array(SPANS)
let spanI = 0
const checkFlight: { at: number } = { at: 0 }
function spanPut(name: string, at: number, end: number): void {
  spanName[spanI] = name; spanAt[spanI] = at; spanEnd[spanI] = end
  spanI = (spanI + 1) % SPANS
}
function ran(name: string, fn: () => void): () => void {
  return () => {
    const t = Date.now()
    try { fn() } finally { spanPut(name, t, Date.now()) }
  }
}
/* what covered the due time (ms into it, its length), else the last span to end before it */
function spansAt(due: number): string {
  const out: string[] = []
  if (checkFlight.at && checkFlight.at <= due) out.push('redraw check in flight, ' + (due - checkFlight.at) + ' ms in, open at the tick')
  let last = -1
  for (let k = 0; k < SPANS; k++) {
    if (!spanName[k]) continue
    if (spanAt[k] <= due && spanEnd[k] >= due) out.push(spanName[k] + ', ' + (due - spanAt[k]) + ' ms in, ' + (spanEnd[k] - spanAt[k]) + ' ms long')
    else if (spanEnd[k] < due && (last < 0 || spanEnd[k] > spanEnd[last])) last = k
  }
  if (out.length) return out.slice(0, 3).join(' and ')
  return 'none' + (last >= 0 ? ' (last ' + spanName[last] + ', ended ' + (due - spanEnd[last]) + ' ms before)' : '')
}
function checkStarted(): void { checkFlight.at = Date.now() }
function checkEnded(): void {
  if (checkFlight.at) spanPut('redraw check in flight', checkFlight.at, Date.now())
  checkFlight.at = 0
}
/* a live ask answered: lives holds the closed seconds (count, asks, most in one, widest spread, ms answering, most
   from one drawing in one second, lone asks); g: the asking drawing, none for a piece asking alone */
function liveTimed(at: number, ms: number, g?: string): void {
  held('live')
  const sec = Math.floor(at / 1000), l = lagged.live
  if (sec !== l.sec || !l.n) { liveClose(); Object.assign(l, { sec, a: at % 1000 }) }
  l.n++; l.z = at % 1000; l.ms += ms
  if (g === undefined) l.lone++
  else l.by[g] = (l.by[g] || 0) + 1
}
function liveClose(): void {
  const l = lagged.live, v = lagged.lives
  if (l.n) {
    v[0]++; v[1] += l.n; v[2] = Math.max(v[2], l.n); v[3] = Math.max(v[3], l.z - l.a); v[4] += l.ms
    v[5] = Math.max(v[5], ...Object.values(l.by)); v[6] += l.lone
  }
  l.n = 0; l.ms = 0; l.lone = 0; l.by = {}
}
function lagProbe($: any): void {
  if (lagged.timer) return
  lagged.last = Date.now()
  lagged.block = 0
  try {
    lagged.timer = $.clock.every(LAG_TICK, () => {
      /* stops where the poll stops; startPoll arms it again */
      if (FREEZE_CLOSED && closedAs(mem.id)) { lagStop(); return }
      const now = Date.now(), gap = now - lagged.last, late = Math.max(0, gap - LAG_TICK)
      lagged.block = gap <= LAG_NEAR ? Math.max(lagged.block, late) : late
      lagged.last = now; lagged.n++
      if (late > lagged.max) { lagged.max = late; if (late >= LAG_PLACE) lagged.worst = lagPlace(now, late) }
      if (late >= LAG_NEAR) lagged.late++
      if (late >= HELD_LATE) heldSeen(now, late)
      if (beat.timer === undefined) beatArm()
    })
  } catch {}
  beatArm()
}
/* the worst late tick of a lag row from LAG_PLACE up: its due time, the worker's beat gap read against the
   lateness (busy: the gap spans it; idle: the beat kept time and the host held the tick) and what ran at due */
const LAG_PLACE = 250
function lagPlace(now: number, late: number): { d: number; w: string; g: number; r: string } {
  const due = now - late
  const [v, g] = beatVerdict(due, now, late)
  const w = v === 'unknown' ? v : g >= BEAT_MS + late / 2 ? 'busy' : g <= BEAT_MS + LAG_NEAR ? 'idle' : 'part busy'
  return { d: due, w, g, r: spansAt(due) }
}
function lagStop(): void {
  try { if (lagged.timer) lagged.timer.cancel() } catch {}
  lagged.timer = undefined
  beatStop()
}
/* ui.press carries no time of the click: a handler's wait is bounded by the block it sat in, the tick
   overdue now or, when ticks ran just before the handler, the block they closed */
function pressStarted(): { at: number; l: number } | undefined {
  held('press')
  if (!lagged.timer) return undefined
  const now = Date.now(), since = now - lagged.last
  lagged.press = { at: now, l: Math.max(0, since - LAG_TICK, since <= LAG_NEAR ? lagged.block : 0) }
  return lagged.press
}
function pressWait(): { l?: number } {
  const p = lagged.press
  lagged.press = undefined
  return p && Date.now() - p.at <= RING_WINDOW ? { l: p.l } : {}
}
function lagRows(): any[] {
  const rows: any[] = []
  if (lagged.late) rows.push({ x: 'lag', m: lagged.max, n: lagged.n, o: lagged.late, ...(lagged.worst || {}) })
  lagged.worst = undefined
  const [n, p, b, v] = lagged.check
  const s = Date.now() - lagged.since
  liveClose()
  if (n) rows.push({ x: 'check', n, p, b, v, s, g: lagged.gates, k: lagged.why })
  const [ls, ln, lm, lg, lt, ld, lo] = lagged.lives
  if (ls) rows.push({ x: 'live', s: ls, n: ln, m: lm, g: lg, t: Math.round(lt), d: ld, o: lo })
  for (const [a, c, r, l] of lagged.sends.splice(0)) rows.push({ x: 'send', a, c, r, ...(l ? { l } : {}) })
  if (lagged.stuck) rows.push({ x: 'stuck', n: lagged.stuck, d: sched.drawing })
  const [mn, mt, an, at, mw] = lagged.match
  if (mn || an) rows.push({ x: 'match', n: mn, t: +mt.toFixed(1), a: an, u: +at.toFixed(1), w: +mw.toFixed(1) })
  for (const h of lagged.helds.splice(0)) rows.push({ x: 'held', ...h })
  for (const s of lagged.sizes.splice(0)) rows.push({ x: 'size', ...s })
  for (const d of lagged.depths.splice(0)) rows.push({ x: 'depth', ...d })
  lagged.match = [0, 0, 0, 0, 0]
  lagged.max = lagged.n = lagged.late = 0
  lagged.check = [0, 0, 0, 0]
  lagged.why = {}
  lagged.gates = 0
  lagged.stuck = 0
  lagged.since = Date.now()
  lagged.lives = [0, 0, 0, 0, 0, 0, 0]
  return rows
}
/* a board change's draws count from the cooldown's release, its wait kept apart (w), so the draw
   reads like the baseline's */
function coolWaited(): void {
  const p = rings.now
  if (!p || p.c !== 'board' || p.w !== undefined || Object.keys(p.d).length || Date.now() - p.at > RING_WINDOW) return
  p.w = Date.now() - p.at
  p.at = Date.now()
  /* an ask before the release reads below zero */
  if (p.q) for (const s of Object.keys(p.q)) p.q[s] -= p.w
}
function ringPress(e: any, stale: boolean): void {
  if (e.plugin !== PLUGIN || e.surface !== 'desktop' || typeof e.element !== 'string' || !RING_PRESS.test(e.element)) return
  const at = Date.now()
  const row = { k: e.element, s: stale ? 1 : 0, t: '', n: 0, o: -1, at, z: at, d: {}, ...pressWait() }
  /* a stale press toggles and draws nothing, so the press before it keeps the window */
  if (stale) return ringKeep(row)
  ringClose()
  rings.now = row
}
function ringClose(): void {
  if (!rings.now) return
  ringKeep(rings.now)
  rings.now = undefined
}
function ringKeep(row: RingPress): void {
  rings.out.push(row)
  if (rings.out.length > 20) rings.out.shift()
}
function ringToggled(tok: string, open: boolean): void {
  const p = rings.now
  if (!p || Date.now() - p.at > RING_WINDOW) return
  p.t = tok; p.n++; p.o = open ? 1 : 0
}
/* cols: the columns the engine gave this draw, which the band's row carries so a session settles its px a column */
async function ringDraw($: any, surface: Site, draw: () => any, ids: string[] = [surface], cols?: number): Promise<any> {
  drawEnter()
  try {
    const tree = await ringTimed($, surface, draw, ids, cols)
    try { sizeWatch(surface, tree) } catch {}
    return tree
  } finally { drawLeave($) }
}
async function ringTimed($: any, surface: Site, draw: () => any, ids: string[], cols?: number): Promise<any> {
  await Promise.all(ids.map(async (id) => { try { await $.state.get({ ...DRAWN, id }) } catch {} }))
  /* a draw at other columns than the surface's last: the app drawing again for a width change */
  const was = colsLast[surface], widened = Number.isFinite(cols) && was !== undefined && was !== cols
  if (Number.isFinite(cols)) colsLast[surface] = cols as number
  const p = rings.now
  if (!p || Date.now() - p.at > RING_WINDOW) return draw()
  const t = Date.now()
  let tree: any
  try { return (tree = await draw()) } finally {
    const d = p.d[surface] || (p.d[surface] = [0, 0, 0, 0])
    const end = Date.now() - p.at
    d[0]++; d[1] += Date.now() - t; if (!d[2]) d[2] = end; d[3] = end
    if (Number.isFinite(cols)) d[4] = cols as number
    if (widened) d[5] = (d[5] || 0) + 1
    /* the largest drawing handed the app in the window (characters written out) and the ms writing it took,
       outside the draw's own ms; the pane's tab, since its size is the tab's */
    const s0 = performance.now()
    let n = 0
    try { n = tree === undefined ? 0 : JSON.stringify(tree).length } catch {}
    d[6] = Math.max(d[6] || 0, n); d[7] = (d[7] || 0) + performance.now() - s0
    /* the largest drawing's nodes and characters as the desktop page counts them */
    try { if (tree && typeof tree === 'object') { const c = countsOf(tree); d[8] = Math.max(d[8] || 0, c.nodes); d[9] = Math.max(d[9] || 0, c.chars) } } catch {}
    if (surface === 'pane') p.v = view.tab
  }
}
const colsLast: Record<string, number> = {}
/* back(): a read that failed puts the end rows back for the next, as the fault book does */
function ringsOut(): { log: string; back: () => void } {
  if (rings.now && Date.now() - rings.now.at > RING_WINDOW) ringClose()
  const ends = endsTake()
  /* the end rows and their count lead: the server logs a read's first 40 rows, and each is an agent's one record */
  const out: any[] = [...ends.rows, ...rings.out.splice(0).map(({ at, ...r }) => r), ...lagRows()]
  return { log: out.length ? JSON.stringify(out) : '', back: ends.back }
}

/* rings: a pane or a reply, where only the fold rings' presses hand off */
/* the same walk keeps each id and flag in a Text whole (keepWhole); a node nothing changes stays the same object */
const wholeKept = new Map<string, string>()
function wholeText(s: string): string {
  if (s.indexOf('-') < 0) return s
  let w = wholeKept.get(s)
  if (w === undefined) { if (wholeKept.size > 4000) wholeKept.clear(); w = keepWhole(s) as string; wholeKept.set(s, w) }
  return w
}
/* children copied only from the first one that changes */
function walkKids(list: any[], surface: string, rings: boolean, inText: boolean): any[] {
  let out: any[] | null = null
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    const d = typeof c === 'string' ? (inText ? wholeText(c) : c) : c && typeof c === 'object' ? handedKeys(c, surface, rings, inText) : c
    if (d !== c && !out) out = list.slice(0, i)
    if (out) out.push(d)
  }
  return out || list
}
function handedKeys(n: any, surface: string, rings = false, inText = false): any {
  if (typeof n === 'string') return inText ? wholeText(n) : n
  if (surface !== 'desktop' || !n || typeof n !== 'object') return n
  if (Array.isArray(n)) return walkKids(n, surface, rings, inText)
  if (n.type === 'Svg') return n
  const kids = Array.isArray(n.children) ? walkKids(n.children, surface, rings, inText || n.type === 'Text') : n.children
  const k = n.type === 'Button' && n.props && n.props.key
  const hand = typeof k === 'string' && handed.has(k) && (!rings || RING_PRESS.test(k))
  if (!hand && kids === n.children) return n
  return { ...n, props: hand ? { ...n.props, key: k + HAND } : n.props, ...(Array.isArray(n.children) ? { children: kids } : {}) }
}

/* the PC's first problem from `askerdo status`, looked at again when the route finds its
   local server gone or a start refused; never while a start is in flight */
/* each offline spell is a trouble of its own, so its first draw looks once and a fix that
   check finds (the join code) reaches the offline row; the board back, then gone again, is a new spell */
const offSpell = { on: false, n: 0 }
/* in a spell, the board not answering is the offline row's own word: a problem with no press adds nothing */
const spellKeeps = (p: any): boolean => p.key !== 'board' || !!(p.command || p.copy)
function healthNow($: any): any {
  if (route.starting) return health.first
  const proto = refusedProtocol()
  const off = !!(band.model && band.model.offline)
  if (off && !offSpell.on) offSpell.n++
  offSpell.on = off
  const sig = route.refused ? 'refused:' + route.refused.key + ':' + route.refused.why : route.down ? 'down:' + route.down.base
    : proto ? 'protocol:' + proto.board : off ? 'offline:' + offSpell.n : ''
  const now = Date.now()
  if (healthDue(sig, now)) {
    const args = ['status', '--json']
    void checkHealth(sig, now, [() => spawn($, healthArgv($, args), { timeoutMs: 30000 }), () => healthProcess($, args)], sig.startsWith('offline:') ? spellKeeps : undefined)
      .then((moved) => { if (moved) laterRedraw($) }).catch(() => {})
  }
  return health.first
}

/* the local server's word that the board refused this PC's protocol, as a problem; null when it did not */
const refusedProtocol = (): any => (band.near && band.near.protocol && typeof band.near.protocol.says === 'string' ? band.near.protocol : null)

/* The problem the band, the status row and /askerdo show: the status run's, else a protocol refusal
   the local server heard before that run looked again */
function healthShown($: any): any {
  return healthNow($) || refusedProtocol()
}

const healthArgv = ($: any, args: string[]) => ['node', $.plugin.root + '/bin/askerdo.mjs', ...args]

/* a process, past the route: the route is what may be broken */
async function healthProcess($: any, args: string[]): Promise<any> {
  const env = await seamEnv($)
  const init = { timeoutMs: 60000 }
  return $.process.run(healthArgv($, args), env ? { ...init, env } : init)
}

/* The problem's press: its verb run here, else its command copied, else Home, where its row and card are */
async function healthFix($: any, input?: any): Promise<void> {
  const p = health.first
  const command = String((input && input.command) || (p && p.command) || '')
  const copy = String((input && input.copy) || (p && !p.command && p.copy) || '')
  if (command) {
    toast($, 'Running askerdo ' + command, 'press')
    const r = await healthProcess($, [...command.split(' '), '--json']).catch((err: any) => ({ exitCode: -1, stderr: String((err && err.message) || err) }))
    const said = String((r && r.stderr) || '').replace(/^AskerDo: /gm, '').trim().split(/\r?\n/)[0]
    if (r && r.exitCode === 0) {
      /* the server it started writes a new local.json, which the route reads afresh */
      route.refused = undefined
      route.down = undefined
      route.key = undefined
    }
    toast($, r && r.exitCode === 0 ? 'askerdo ' + command + ' ran' : 'askerdo ' + command + ' failed' + (said ? ': ' + said : ''), 'press')
    healthStale()
    healthNow($)
    kick($)
    return
  }
  if (copy) {
    let copied = false
    try { copied = !!(await $.ui.copy({ text: copy })).isCopied } catch {}
    toast($, copied ? 'Copied: ' + copy : 'Could not copy: run ' + copy, 'press')
    return
  }
  await openPane($, 'home', undefined, true)
}

/* The band's model and presses, one set for the band over the prompt and Home's copy. */
type BandParts = { model: any; answer: (q: any, a: any) => void; open: (q?: any) => void; submit: () => void; send: () => void; press: (c: any, p: any) => void; fold: { open: boolean; toggle: () => void }; strip?: { view: QuestionsView; act: QuestionsActions }; still: boolean }
/* built once per version of the slices the band reads, and again at the next wall second; sig: the
   model and the view it draws with, as the band check compares them */
const bandKept: { key?: string; until: number; b?: BandParts; sig?: string } = { until: 0 }
function bandParts($: any): BandParts {
  void queueRead($).catch(() => {})
  const now = Date.now()
  if (bandKept.b && bandKept.key === tupleOf('band') && now < bandKept.until) return bandKept.b
  const b = bandBuild($)
  /* a strip draws from the view (questions.tsx stripTree) but never from a note being typed */
  const strip = b.strip ? JSON.stringify({ ...b.strip.view, notes: undefined }, (k: string, v: any) => (v instanceof Set ? [...v] : v)) : ''
  Object.assign(bandKept, { key: tupleOf('band'), until: nextSecond(now), b, sig: JSON.stringify([b.model, b.fold.open, b.still, strip]) })
  return b
}
function bandBuild($: any): BandParts {
  /* the questions this session keeps draw ahead of the board's; the queued count beside what waits */
  const model = withHealth(withWaiting(withPresses(withChipStates(withLocal(band.model, localOpen(), mem.id), answers.chips)), { inbox: band.inbox, closed: closedLine(closedAs(mem.id), savedHere()), saved: savedHere().length > 0,
    queued: answerQueue.items.size, queuedList: answerQueue.list().map((q) => ({ id: q.id, letter: q.letter, name: q.name || '', option: q.option || '' })) }), healthShown($))
  /* a strip lives only while its question's own row is drawn, so the count line closes it
     rather than hiding it until the other questions go */
  const one = rowQuestion(model)
  for (const id of Object.keys(bandStrips)) if (!one || one.id !== id) delete bandStrips[id]
  for (const id of Object.keys(bandNotes)) if (!bandStrips[id]) delete bandNotes[id]
  return {
    /* on confirm a chip opens the card's strip under the band's row, sharing the card's note and queue */
    strip: qpane.confirm ? { view: { ...qpane, strip: bandStrips, bandNote: bandNotes }, act: { ...cardActions($, (id, letter, version) => { void qpanePick($, id, letter, version, 'band') }, undefined, { site: 'band' }, bandStrips),
      bandNote: (id: string) => pressed($, () => { bandNotes[id] = !bandNotes[id]; noteSeed(id) }, BAND_VIEW)() } } : undefined,
    model,
    press: (c: any, p: any) => pressed($, () => {
      void (p && p.pane === 'tracks' ? openPane($, 'tracks', (c && c.id) || undefined, true) : c && c.kind === 'health' ? healthFix($, p && p.input) : bandCall($, c, p)).catch(() => {})
    })(),
    fold: { open: callFold.open, toggle: pressed($, () => { callFold.open = !callFold.open }, BAND_VIEW) },
    answer: (q: any, a: any) => {
      if (!qpane.confirm) return pressed($, () => { void bandAnswer($, q, a) })()
      drawCause('strip', token(q.id, a.letter))
      pressed($, () => { bandStrips[q.id] = a.letter; noteSeed(q.id) }, BAND_VIEW)()
    },
    still: !!refusedProtocol(),
    open: (q?: any) => pressed($, () => { void openPane($, 'questions', q && q.id).catch(() => {}) })(),
    submit: pressed($, () => { void submitWaiting($).catch(() => {}) }),
    send: pressed($, () => { void sendQueued($).catch(() => {}) }),
  }
}

/* this PC's name from the local board's read and the held track, for the chips */
const hereNow = () => ({ pc: (band.near && band.near.here && band.near.here.pc) || '', track: (heldNow() || {}).id || '' })

/* The status row's presses: the guard, the shelf count (Tracks), the AskerDo opener (Home)
   and the agents count (Home with its agents unfolded). */
function statusPresses($: any): { guard: () => void; shelf: () => void; home: () => void; questions: () => void; agents: () => void; health: () => void } {
  return {
    health: pressed($, () => { void healthFix($).catch(() => {}) }),
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
type FoldKey = 'graph' | 'agents' | 'background' | 'pickup' | 'elsewhere' | 'parked' | 'asleep'
const FOLD_KEYS: FoldKey[] = ['graph', 'agents', 'background', 'pickup', 'elsewhere', 'parked', 'asleep']
/* the Questions tab's Asleep group is shut too until pressed */
const folds: { open: Record<FoldKey, boolean>; ready?: Promise<void>; read: boolean; early: boolean; pressed: Set<FoldKey> } = {
  open: { graph: true, agents: true, background: true, pickup: true, elsewhere: true, parked: false, asleep: false }, read: false, early: false, pressed: new Set(),
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
      if (moved && folds.early) laterRedraw($, PANE_ONLY)
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
  drawCause('fold', k)
  folds.open[k] = open
  folds.pressed.add(k)
  void foldRead($).then(() => $.store.set('folds', { ...folds.open })).catch(() => {})
  qpaneRedraw($, PANE_ONLY)
}
/* the status row's agents count opens Home with the agents and the background tasks unfolded */
function agentsOpen($: any, open: boolean): void {
  folds.open.background = open
  folds.pressed.add('background')
  foldSet($, 'agents', open)
}

/* The picture is most of a Home draw: a draw that moved none of its inputs (a fold, a tab) reuses
   the last one; the looks and icons only gain keys, and the minute bounds what its dates show */
const picKept: { args?: any; looks?: number; icons?: number; minute?: number; gm?: any } = {}
/* each board load hands new objects with the same content, so an input is compared by its
   content, written out once per object */
const picContent = new WeakMap<object, string>()
function sameInput(a: any, b: any): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const of = (o: object) => { let s = picContent.get(o); if (s === undefined) { s = JSON.stringify(o); picContent.set(o, s) } return s }
  return of(a) === of(b)
}
/* written in place as reads land, so compared by their counts */
const PIC_GROWN = ['looks', 'icons']
function homeGraphKept(args: any): any {
  const minute = Math.floor(Date.now() / 60000)
  const looks = Object.keys(args.looks || {}).length
  const icons = Object.keys(args.icons || {}).length
  const a = picKept.args
  if (a && picKept.minute === minute && picKept.looks === looks && picKept.icons === icons && Object.keys(args).length === Object.keys(a).length
    && Object.keys(args).every((k) => (PIC_GROWN.includes(k) ? args[k] === a[k] : sameInput(args[k], a[k])))) {
    /* the kept inputs follow the new objects, so the next load compares against them */
    picKept.args = args
    return picKept.gm
  }
  const gm = homeGraph(args)
  Object.assign(picKept, { args, looks, icons, minute, gm })
  return gm
}

/* The pane's tabs as models: each tab's model is built once per version of the slices that tab
   reads (READS.pane) and again at the next wall second, where its ages turn; the check compares the
   model's sig, never a tree, and a draw builds the open tab's tree from the model */
const PANE_READS: Record<PaneTab, Slice[]> = {
  home: ['board', 'queue', 'view', 'flights', 'status'],
  /* status: the minute tick's "updated" line rides the status row's causes */
  questions: ['board', 'queue', 'cards', 'view', 'status'],
  tracks: ['board', 'view', 'status'],
  guide: ['board', 'view'],
  settings: ['board', 'view'],
}
type PaneLive = { count: boolean; rows: boolean }
const paneKept = new Map<string, { key: string; until: number; m: any }>()
/* the last model each pane drew from, for its face */
const paneDrew = new Map<string, any>()

/* One model for the pane's id and the two before it. */
async function paneModel($: any, e: any): Promise<any> {
  await snapBack($)
  /* the old threads pane's id draws the Tracks tab */
  if (!view.chosen && e.requestId !== PANE_ID) view.tab = e.requestId === 'askerdo-questions' ? 'questions' : 'tracks'
  if (view.seeded !== view.tab) { seedFields(); view.seeded = view.tab }
  await bandBackWithin($)
  if (!band.loaded) {
    startPoll($)
    kick($)
    void foldRead($)
    return { tab: view.tab, loading: true, sigs: {}, sig0: 'loading ' + view.tab }
  }
  if (view.tab !== 'questions') await foldsReady($)
  /* a pane the app restored opens without an opener */
  if (!where.paneRead) { where.paneRead = true; void readWhere($).catch(() => {}) }
  const cols = e.props.bodyColumns
  const surface = e.surface
  /* the title fits the width of every draw, retitled only when the fitted text changes */
  if (e.requestId === PANE_ID && Number.isFinite(cols) && cols !== where.cols) {
    const was = paneTitle(where.now, where.cols)
    where.cols = cols
    if (paneTitle(where.now, cols) !== was) void retitle($).catch(() => {})
  }
  const tab = view.tab
  let rings = ''
  if (tab === 'questions') {
    qpaneTick($)
    /* a ring pressed under a reply flips this tab's ring too */
    rings = [...qpane.unfolded].sort().join(' ')
  }
  if (tab === 'home' && surface === 'desktop') await iconsReady($)
  const els = $.ui.resolve(e)
  const liveRows = !!liveEls(els, e).Client
  const now = Date.now()
  const key = [tab, tupleOf('pane'), cols, surface, liveRows, liveFault.has(e.component + ' ' + surface), rings].join('|')
  const at = surface + ' ' + e.requestId
  const k = paneKept.get(at)
  if (k && k.key === key && now < k.until) return k.m
  const m = paneBuild($, tab, cols, surface, now)
  m.liveRows = liveRows
  paneKept.set(at, { key, until: nextSecond(now), m })
  return m
}

/* the open tab's model, with the counts and the link its head draws */
function paneBuild($: any, tab: PaneTab, cols: any, surface: string, now: number): any {
  const { qm, tm } = tabsModels($, now)
  /* the badge counts this session's own; the tab's header says the ones from elsewhere apart */
  const counts = { questions: qm.own + (qm.more || 0), tracks: tm.total }
  /* the board link follows the tab: Questions this project's Needs you, Home and Tracks the board's overview */
  const link = tab === 'questions' ? band.url : (band.views && band.views[tab === 'settings' || tab === 'guide' ? 'home' : tab]) || band.url
  const m: any = { tab, now, cols, surface, counts, link, sigs: {} }
  if (tab === 'questions') {
    const pin = pinnedOf(qm, qpane).pinned
    if (pin) void fullCard($, pin.id).catch(() => {})
    return Object.assign(m, { qm, at: band.at, asleepOpen: foldOpen($, 'asleep') })
  }
  if (tab === 'tracks') return Object.assign(m, { tm, tview: { parked: foldOpen($, 'parked'), pickup: foldOpen($, 'pickup'), elsewhere: foldOpen($, 'elsewhere') } as PaneView })
  if (tab === 'guide') {
    const pages = guideRead($)
    return Object.assign(m, { guide: { pages, error: pages && !pages.length ? 'The guide is not in this install (' + guideRoot($) + ').' : undefined, version: ownVersion($), repo: own.repo } })
  }
  if (tab === 'settings') {
    const read = settingsRead($)
    const held = heldNow()
    return Object.assign(m, { settings: { json: read && read.json, error: read && read.error, track: held && held.id ? { id: held.id, name: held.name } : null,
      project: read && read.dir ? whereParts(read.dir).name : undefined, bypass: band.near && band.near.bypass } })
  }
  const b = bandParts($)
  /* the copy draws no hover cards; the dock pane does not lift them, so they would draw empty.
     the arrow unfolds them under the row instead; an answered question folds away */
  /* 'ws-inbox' is the picture's inbox fold, kept as the user left it */
  const open = new Set([...listOf(b.model && b.model.questions).map((q: any) => q && q.id), ...listOf(b.model && b.model.calls).map((c: any) => c && c.key), 'ws-inbox'])
  for (const id of view.unfolded) if (!open.has(id)) view.unfolded.delete(id)
  const wide = !!view.filter.trim()
  const read = feedRead($, wide ? 'all' : 'own')
  /* the board on the LAN is plain http, which the desktop does not open, so a row's page
     goes through the local server's sign-in route, as the tray console's does */
  const viaLocal = (r: any) => (r.heading ? r : { ...r, href: recordHref(band.local, r.key || r.id, r.href) })
  const rows = read && read.lines ? feedRows(read.lines, { filter: view.filter, now, wsNames: read.wsNames }).map(viaLocal) : null
  /* drawn for the width this draw reports, so a pane dragged wider draws more columns */
  let gm: any
  const heldId = band.mine && band.mine.held ? band.mine.track : undefined
  if (view.picOf !== heldId) { view.picOf = heldId; view.pic = null }
  try {
    gm = homeGraphKept({ graph: band.graph, overview: paneOverview($, foldOpen($, 'graph')), far: farGraph($), mine: band.mine, local: band.near ? band.local || true : false, view: view.pic,
      looks: picLooks.got, icons: picIcons, boardUrl: band.views && band.views.home, columns: cols, draw: surface === 'desktop', pc: hereNow().pc })
  } catch {
    gm = { lines: [], why: 'The picture could not be drawn from what the local board holds.' }
  }
  /* a view gone stale draws where homeGraph fell back to, and stays there */
  if (view.pic && gm.view) view.pic = gm.view
  const graphOpen = foldOpen($, 'graph')
  if (graphOpen && gm.lookFor) void lookRead($, gm.lookFor).catch(() => {})
  const { am, bm } = inFlight()
  return Object.assign(m, { b, bandSig: bandKept.sig, sm: statusOf($), wide, read, rows, openQ: qm.cards.map((c: any) => c.id), gm, graphOpen,
    line: standLine(heldNow(), gm), am, bm, versions: versionWords(ownVersion($), band.near && band.near.boardVersion), drift: driftHome() })
}

/* the Questions and Tracks tabs' models, which every tab's head counts from: they read no view, so a fold
   or a tab press builds neither; once per board version and wall second */
const tabsKept: { key?: string; until: number; qm?: any; tm?: any } = { until: 0 }
function tabsModels($: any, now: number): { qm: any; tm: any } {
  const key = [slices.board, slices.queue, slices.cards, mem.id].join('.')
  if (tabsKept.key === key && now < tabsKept.until) return tabsKept as { qm: any; tm: any }
  const qm = questionsModel({ questions: questionCards(), more: band.more, sid: mem.id, now, local: band.local, here: hereNow(), asleep: band.asleep })
  const near = band.near || {}
  /* the tab's model from the band's reads */
  const tm = tracksView({ mine: band.mine, graph: band.graph, shelfRows: band.shelf, handoffs: near.handoffs, asks: near.asks, now,
    offline: band.model && band.model.offline, others: shelfGraphs($), local: band.local })
  Object.assign(tabsKept, { key, until: nextSecond(now), qm, tm })
  return { qm, tm }
}

/* what a pane drew from, so the check compares models: the live pieces (the status row's count, the agents'
   rows and heading) less what their Clients draw, which turns over by itself */
function paneSig(m: any, live: PaneLive): string {
  if (m.loading) return m.sig0
  const lk = (live.count ? 'c' : '') + (live.rows ? 'r' : '')
  if (m.sigs[lk]) return m.sigs[lk]
  const sets = (k: string, v: any) => (v instanceof Set ? [...v].sort() : v)
  const head = [m.tab, m.counts, m.link, m.cols, m.surface, m.surface === 'desktop' ? [...handed].filter((k) => RING_PRESS.test(k)).sort() : null]
  let body: any
  if (m.tab === 'questions') body = [m.qm, { ...qpane, notes: undefined }, updatedText(m.at, m.now), m.asleepOpen, [...wakes]]
  else if (m.tab === 'tracks') body = [m.tm, m.tview]
  else if (m.tab === 'guide') body = m.guide
  else if (m.tab === 'settings') body = [m.settings, sview, Math.floor(m.now / 60000)]
  else {
    const qs = m.b.model && Array.isArray(m.b.model.questions) ? m.b.model.questions : []
    const ages = qs.map((q: any) => (q && q.born ? ageText(m.now - q.born) : ''))
    const running = [...((m.am && m.am.rows) || []), ...((m.bm && m.bm.rows) || [])].filter((r: any) => !r.done).map((r: any) => stopState(r.id))
    body = [m.bandSig, ages, [...view.unfolded].sort(), m.sm ? hintSig(m.sm, live.count) : null,
      [m.rows, view.filter, view.filterSeed, m.wide, m.read && m.read.error, m.openQ],
      [picSig(m.gm), m.graphOpen, m.line],
      [flightSig(m.am, live.rows, true), flightSig(m.bm, live.rows, false), folds.open.agents, folds.open.background, view.done, view.bgDone, view.bgMore, running],
      m.versions, m.drift]
  }
  return (m.sigs[lk] = JSON.stringify([head, body], sets))
}
/* the flights' model less what their Clients draw: a running row's detail, depth and tone, and the agents'
   heading line; a finished row and the background's heading are drawn plain */
function flightSig(fm: any, live: boolean, agents: boolean): any {
  if (!fm || !live) return fm
  const rows = (fm.rows || []).map((r: any) => (r.done ? r : { id: r.id, under: r.under, ended: r.ended, stop: r.stop, kind: r.kind, bare: r.bare, job: r.job, command: r.command, status: r.status }))
  return agents ? { rows } : { ...fm, rows }
}
/* the picture's model written out once per build of it */
const picSigs = new WeakMap<object, string>()
function picSig(gm: any): string {
  if (!gm || typeof gm !== 'object') return String(gm)
  let s = picSigs.get(gm)
  if (s === undefined) { s = JSON.stringify(gm); picSigs.set(gm, s) }
  return s
}

/* One draw for the pane's id and the two before it, from its model. */
async function paneDraw($: any, e: any): Promise<any> {
  const m = await paneModel($, e)
  paneDrew.set(e.surface + ' ' + e.requestId, m)
  return paneTreeOf($, e, m)
}
const graphKept = new Map<string, { gm: any; key: string; tree: any }>()
function paneTreeOf($: any, e: any, m: any): any {
  const els = $.ui.resolve(e)
  if (m.loading) return m.tab === 'tracks' ? paneLoading(els) : questionsLoading(els)
  const { cols, surface, now } = m
  let body: any
  let homeBuild: ((t: HomeTrim) => any) | undefined
  /* a tab with a ladder of its own builds from its trim */
  let tabBuild: ((t: any) => any) | undefined
  let rungs: Rung[] = []
  if (m.tab === 'questions') {
    const act = cardActions($, (id: string, letter: string, version?: number) => { void qpanePick($, id, letter, version).catch(() => {}) },
      (verb, id) => { void qpaneEnd($, verb, id).catch(() => {}) })
    act.wake = (id: string) => wakePress($, id)
    act.fold = () => foldSet($, 'asleep', !foldOpen($, 'asleep'))
    act.waking = (id: string) => (waking(wakes.get(id)) ? 'busy' : wakes.get(id))
    tabBuild = (t: QuestionsTrim) => questionsTree(els, m.qm, qpane, act, cols, { at: m.at, now, asleep: m.asleepOpen }, surface, t)
    rungs = questionsRungs(m.qm, !!m.asleepOpen)
  } else if (m.tab === 'tracks') {
    const tm = m.tm
    const act = {
      copy: (id: string, command: string, name: string, from?: string) => { void paneCopy($, tm, id, command, name, from || surface).catch(() => {}) },
      resume: (id: string, takeOver: boolean) => { void paneResume($, id, takeOver).catch(() => {}) },
      ask: (qid: string) => { void openPane($, 'questions', qid).catch(() => {}) },
      fold: (k: string) => {
        if (!(FOLD_KEYS as string[]).includes(k)) return
        const open = !foldOpen($, k as FoldKey)
        if (open) tracksOpened = k
        foldSet($, k as FoldKey, open)
      },
    }
    tabBuild = (t: TracksTrim) => paneTree(els, tm, m.tview, act, cols, surface, t)
    rungs = tracksRungs(tm, m.tview)
  } else if (m.tab === 'guide') {
    body = guideTree(els, m.guide, surface === 'desktop')
  } else if (m.tab === 'settings') {
    body = settingsTree(els, m.settings, sview, settingsActions($), cols, surface)
  } else homeBuild = (trim: HomeTrim): any => {
    const b = m.b
    const unfold = {
      open: (id: string) => !trim.fold && view.unfolded.has(id),
      toggle: (id: string) => {
        if (!view.unfolded.delete(id)) view.unfolded.add(id)
        /* Home's question and call folds are ring presses too, so their log row counts the toggle */
        ringToggled(id, view.unfolded.has(id))
        qpaneRedraw($, PANE_ONLY)
      },
    }
    /* the copy's border and padding: a cell each on the terminal; the desktop's round border is
       1 px a side, so the padding's two cells and under one more */
    const inside = Number.isFinite(cols) ? cols - (surface === 'desktop' ? 3 : 4) : undefined
    const ours = b.model && bandTree(els, b.model, b.answer, { columns: inside, now, surface, open: b.open, submit: b.submit, send: b.send, cards: false, unfold, press: b.press, fold: b.fold, strip: b.strip, still: b.still })
    const sm = m.sm
    /* the guard's press under its own name, so `guard` below is still the guard's state */
    const { guard: guardTap, shelf, agents: openAgents, health: fixHealth } = statusPresses($)
    const status = sm ? statusKeptTree('home', liveEls(els, e), sm, null, { columns: inside, surface, guard: guardTap, shelf, agents: openAgents, health: fixHealth, wrap: true, cards: false }) : null
    const openQ = new Set(m.openQ)
    const openRow = (r: any) => (r.kind === 'question' && openQ.has(r.id) ? () => { void openPane($, 'questions', r.id).catch(() => {}) } : null)
    /* a press steps the view in the pane; a question open here opens its card; anything else is a page */
    const picPress = (a: any): (() => void) | null => {
      if (!a) return null
      if (a.kind === 'zoom' && a.read) return () => { void zoomFar($, a).catch(() => {}) }
      if (a.kind === 'select' || a.kind === 'zoom') return () => { drawCause('zoom', a.kind); view.pic = a.view; qpaneRedraw($, PANE_ONLY) }
      if ((a.kind === 'open' || a.kind === 'answer') && openQ.has(a.id)) return () => { void openPane($, 'questions', a.id).catch(() => {}) }
      return null
    }
    /* the picture's tree per picture model, its fold, width and the questions open here */
    const inboxOpen = view.unfolded.has('ws-inbox')
    const gkey = [surface, !!els.Svg, m.graphOpen, m.line, cols, inboxOpen, [...openQ].join(','), trim.pic || ''].join('|')
    const gk = graphKept.get(surface)
    const graph = trim.pic === 'line' ? graphLine(els, () => { drawCause('tab', 'tracks'); view.tab = 'tracks'; view.chosen = true; qpaneRedraw($, PANE_ONLY) })
      : gk && gk.gm === m.gm && gk.key === gkey ? gk.tree : graphTree(els, m.gm, picPress, surface,
      { open: m.graphOpen, toggle: () => foldSet($, 'graph', !foldOpen($, 'graph')), line: m.line, columns: cols, lean: trim.pic === 'lean',
        inbox: { open: inboxOpen, toggle: () => { if (!view.unfolded.delete('ws-inbox')) view.unfolded.add('ws-inbox'); qpaneRedraw($, PANE_ONLY) } } })
    if (trim.pic !== 'line') graphKept.set(surface, { gm: m.gm, key: gkey, tree: graph })
    const { am, bm } = m
    const stop = { state: stopState, press: (id: string, job: string) => stopPress($, id, job) }
    const agentsPart = am ? agentsTree(liveEls(els, e), am, foldOpen($, 'agents'), () => foldSet($, 'agents', !foldOpen($, 'agents')), surface, cols,
      { open: view.done, toggle: () => { view.done = !view.done; qpaneRedraw($, PANE_ONLY) } }, stop, trim.cut) : null
    const bgPart = bm ? backgroundTree(liveEls(els, e), bm, foldOpen($, 'background'), () => foldSet($, 'background', !foldOpen($, 'background')), surface, cols, stop,
      { has: (id: string) => view.bgMore.has(id), toggle: (id: string) => { if (!view.bgMore.delete(id)) view.bgMore.add(id); qpaneRedraw($, PANE_ONLY) } },
      { open: view.bgDone, toggle: () => { view.bgDone = !view.bgDone; qpaneRedraw($, PANE_ONLY) } }, trim.cut) : null
    const agents = agentsPart && bgPart ? els.Box({ key: 'in-flight', flexDirection: 'column', rowGap: 1, children: [agentsPart, bgPart] }) : agentsPart || bgPart
    const read = m.read
    const folded = trim.fold ? els.Box({ key: 'copy-folded', children: [els.Text({ dimColor: true, wrap: 'wrap',
      children: 'The open questions are drawn folded while Home holds this much; the board link above has each one whole.' })] }) : null
    const copy = [b.model && b.model.unreadQuestions ? unreadLine(els) : null, ours, folded, status]
    const feed = feedCut(m.rows, trim.feed)
    return homeTree(els, copy, { rows: feed.rows, filter: view.filter, seed: view.filterSeed, wide: m.wide, error: read && read.error, more: feed.more }, (v: string) => {
      view.filter = String(v || '')
      qpaneRedraw($, PANE_ONLY)
    }, surface, cols, graph, agents, openRow, m.versions, () => { view.tab = 'guide'; view.chosen = true; qpaneRedraw($, PANE_ONLY) }, m.drift)
  }
  const wrap = (b: any) => handedKeys(askerdoPane(els, m.tab, m.counts, cardHref(m.link) || undefined, (t: PaneTab) => {
    drawCause('tab', t)
    view.tab = t
    view.chosen = true
    qpaneRedraw($, PANE_ONLY)
  }, b, surface), surface, true)
  const last = () => wrap(tooLarge(els, m.tab))
  /* Home folds its questions only for a question or call open, never for the picture's inbox fold alone */
  if (homeBuild) rungs = homeRungs((m.rows || []).length, Math.max(m.am ? m.am.rows.length : 0, m.bm ? m.bm.rows.length : 0), [...view.unfolded].some((id) => id !== 'ws-inbox'))
  const build = tabBuild || homeBuild
  return ladderGuard(surface + '|' + m.tab, build ? (t: any) => wrap((build as any)(t)) : () => wrap(body), rungs, last).tree
}

/* ---- no drawing past the desktop page's bounds (pageCounts in mod-core) ---- */
type HomeTrim = { feed?: number; cut?: FlightCut; pic?: 'lean' | 'line'; fold?: boolean }
/* each drawing's counts, so its timing rows count it once */
const drawnCounts = new WeakMap<object, { nodes: number; depth: number; chars: number; text: number; gave?: number; words?: string[]; builds?: number; from?: { nodes: number; chars: number; text: number } }>()
const countsOf = (tree: any) => {
  if (!tree || typeof tree !== 'object') return pageCounts(tree)
  let c = drawnCounts.get(tree)
  if (!c) { c = pageCounts(tree); drawnCounts.set(tree, c) }
  return c
}
/* the newest k of Activity's entries, a day heading left with no row under it dropped, and how many rows went */
function feedCut(rows: any[] | null, k?: number): { rows: any[] | null; more: number } {
  if (!Array.isArray(rows) || !(Number(k) >= 0) || (k as number) >= rows.length) return { rows, more: 0 }
  const kept = rows.slice(0, k)
  while (kept.length && kept[kept.length - 1].heading) kept.pop()
  return { rows: kept, more: rows.slice(kept.length).filter((r: any) => !r.heading).length }
}
/* on 2.1.325 the page bounds the band as every plugin's rows stacked, and the engine's text room
   counts them from the top, so what the others' rows and the stack take comes off the band's ceiling */
const bandOthers = new Map<string, { nodes: number; chars: number; text: number }>()
const bandGave = new Map<string, boolean>()
/* the ceiling a drawing is held under (a band's on that surface); the rig's ASKERDO_DRAW_CEILING scales it */
function guardCeil(band?: string): typeof DRAW_CEILING {
  const f = drawFault.ceiling
  const c = f ? { nodes: DRAW_CEILING.nodes * f, depth: DRAW_CEILING.depth, chars: DRAW_CEILING.chars * f, text: DRAW_CEILING.text * f } : DRAW_CEILING
  const o = band ? bandOthers.get(band) : undefined
  return o ? { nodes: c.nodes - o.nodes, depth: c.depth, chars: c.chars - o.chars, text: c.text - o.text } : c
}
/* the band's rows as settled: the others' counts kept, and the band drawn again when they move its fit */
function bandRoom($: any, e: any): void {
  const rows: any[] = Array.isArray(e.props && e.props.rows) ? e.props.rows : []
  /* the stack's own Box: one node and its flexDirection */
  const o = { nodes: 1, chars: 19, text: 0 }
  for (const r of rows) {
    if (!r || r.plugin === PLUGIN) continue
    const c = pageCounts(r.tree, String(r.plugin || ''))
    o.nodes += c.nodes; o.chars += c.chars; o.text += c.text
  }
  const was = bandOthers.get(e.surface)
  if (was && was.nodes === o.nodes && was.chars === o.chars && was.text === o.text) return
  bandOthers.set(e.surface, o)
  const ours = rows.find((r: any) => r && r.plugin === PLUGIN)
  if (!ours || bandGave.get(e.surface) || !countsUnder(pageCounts(ours.tree), guardCeil(e.surface))) siteRedraw($, ['band'])
}
/* A rung cuts a part past a count k (0 to hi) and names, whole, what is left out at k (-1: none fit). `n`: the
   count the drawing before the rung holds, so its counts and k 0's place the cut without a search */
type Rung = { step: number; hi: number; n?: number; trim: (k: number) => any; words: (k: number) => string[] }
type Built = { tree: any; c: any }
/* the k between two built counts where each count meets the ceiling, read as a straight line */
function kAt(a: { k: number; y: Built }, b: { k: number; y: Built }, ceil: any): number {
  let k = Infinity
  for (const d of ['nodes', 'chars', 'text']) {
    const per = (b.y.c[d] - a.y.c[d]) / (b.k - a.k)
    if (per > 0) k = Math.min(k, a.k + Math.floor((ceil[d] - a.y.c[d]) / per))
  }
  return k
}
/* each surface and tab's last rung and k, where its next draw past the ceiling starts */
const ladderKept = new Map<string, { i: number; step: number; k: number }>()
/* A tab past the ceiling gives way rung by rung, decided on counts, and only the last build goes out; the
   last drawing when every rung is spent. Built once under the ceiling; past it, the last draw's rung and k
   first, else each rung's k 0 and the k its counts place, a step back when that misses (at most three) */
/* end: the last drawing's step and words, for a surface whose last drawing is not the pane's short one */
function ladderGuard(key: string, build: (t: any) => any, rungs: Rung[], last: () => any, end?: { step: number; words: string[] }): { tree: any; gave: string[] } {
  let builds = 0
  const at = (t: any): Built => { builds++; const tree = build(t); return { tree, c: countsOf(tree) } }
  const band = key.startsWith('band|') ? key.slice(5) : ''
  const ceil = guardCeil(band || undefined)
  const fits = (y: Built) => countsUnder(y.c, ceil)
  let x = at({})
  if (band) bandGave.set(band, !fits(x))
  if (fits(x)) { ladderKept.delete(key); return { tree: x.tree, gave: [] } }
  const from = { nodes: x.c.nodes, chars: x.c.chars, text: x.c.text }
  let gave: string[] = []
  const done = (step: number, k: number, i = -1) => {
    ladderKept.set(key, { i, step, k })
    Object.assign(countsOf(x.tree), { gave: step, words: gave, from, builds })
    return { tree: x.tree, gave }
  }
  /* the last drawing is not kept: a rung that fits again is found at the next draw */
  const lastly = () => {
    gave = end ? end.words : [...gave, 'the whole tab']
    const tree = last(); x = { tree, c: countsOf(tree) }; const out = done(end ? end.step : 6, 0); ladderKept.delete(key); return out
  }
  const kept = ladderKept.get(key)
  const r0 = kept && kept.i >= 0 && rungs[kept.i] && rungs[kept.i].step === kept.step && rungs[kept.i].hi >= 0 ? rungs[kept.i] : null
  if (r0 && kept) {
    const k = Math.min(kept.k, r0.hi)
    const y = at(r0.trim(k))
    if (fits(y)) { x = y; gave = r0.words(k); return done(r0.step, k, kept.i) }
  }
  let prev = x
  for (const [i, r] of rungs.entries()) {
    if (r.hi < 0) continue
    const y0 = at(r.trim(0))
    if (!fits(y0)) { gave = r.words(-1); prev = y0; continue }
    let lo = { k: 0, y: y0 }
    let up: { k: number; y: Built } | null = r.n !== undefined && r.n > 0 ? { k: r.n, y: prev } : null
    if (!up && r.hi > 0) {
      const yh = at(r.trim(r.hi))
      if (fits(yh)) lo = { k: r.hi, y: yh }
      else up = { k: r.hi, y: yh }
    }
    for (let t = 0; up && t < 3; t++) {
      const k = Math.min(kAt(lo, up, ceil), r.hi, up.k - 1)
      if (k <= lo.k) break
      const y = at(r.trim(k))
      if (fits(y)) { lo = { k, y }; break }
      up = { k, y }
    }
    x = lo.y
    gave = r.words(lo.k)
    return done(r.step, lo.k, i)
  }
  return lastly()
}
/* Home gives way: Activity's oldest rows, the finished flights, the running past a count, the picture's side
   parts, the picture; then, with a question or call open, the same with the questions folded (folded alone
   first, step 7). Each part leaves a line on Home saying so */
function homeRungs(n: number, runs: number, unfolded: boolean): Rung[] {
  const pass = (fold: boolean): Rung[] => {
    const f: HomeTrim = fold ? { fold } : {}
    const before = fold ? ['the open questions\' text'] : []
    const feed = (k: number) => (n ? [k > 0 ? 'the oldest Activity rows' : 'every Activity row'] : [])
    const flights = [...before, ...feed(0), 'the finished agents and background tasks']
    const running = [...flights, 'every running row']
    const rungs: Rung[] = fold ? [{ step: 7, hi: 0, trim: () => f, words: () => before }] : []
    rungs.push({ step: 1, hi: n - 1, n, trim: (k) => ({ ...f, feed: k }), words: (k) => [...before, ...feed(k)] },
      { step: 2, hi: 0, trim: () => ({ ...f, feed: 0, cut: { done: true } }), words: () => flights },
      { step: 3, hi: Math.max(0, runs), n: runs, trim: (r) => ({ ...f, feed: 0, cut: { done: true, run: r } }),
        words: (r) => [...flights, r > 0 ? 'the running rows past the first ' + r : 'every running row'] },
      { step: 4, hi: 0, trim: () => ({ ...f, feed: 0, cut: { done: true, run: 0 }, pic: 'lean' }), words: () => [...running, 'the picture\'s side parts'] },
      { step: 5, hi: 0, trim: () => ({ ...f, feed: 0, cut: { done: true, run: 0 }, pic: 'line' }), words: () => [...running, 'the picture\'s side parts', 'the picture'] })
    return rungs
  }
  return [...pass(false), ...(unfolded ? pass(true) : [])]
}
/* the section of the Tracks tab the user opened last, whose tracks give way after the others' */
let tracksOpened = ''
/* The Tracks tab gives way: the tracks past a count in each open section but the one opened last, then in that
   one too, then the held track's task and question rows past a count */
function tracksRungs(tm: any, tv: any): Rung[] {
  if (!tm || !tm.total) return []
  const n = (k: string) => (Array.isArray(tm[k]) ? tm[k].length : 0)
  const open = ['pickup', 'elsewhere', 'parked'].filter((k) => n(k) && (k === 'parked' ? !!(tv && tv.parked) : !tv || tv[k] !== false))
  const lastK = open.length > 1 && open.includes(tracksOpened) ? tracksOpened : ''
  const first = open.filter((k) => k !== lastK)
  const zero = Object.fromEntries(open.map((k) => [k, 0]))
  const held = tm.held ? Math.max(0, ...tm.held.groups.map((g: any[]) => g.filter(rowCuttable).length)) : 0
  const tracks = (k: number, which: string) => (k > 0 ? 'the tracks past the first ' + k + ' of ' + which : 'the tracks of ' + which)
  const rungs: Rung[] = [{ step: 8, hi: Math.max(0, ...first.map(n)) - 1, n: Math.max(0, ...first.map(n)), trim: (k) => ({ tiles: Object.fromEntries(first.map((s) => [s, k])) }),
    words: (k) => [tracks(k, lastK ? 'each section but the one opened last' : 'each section')] }]
  if (lastK) rungs.push({ step: 9, hi: n(lastK) - 1, n: n(lastK), trim: (k) => ({ tiles: { ...zero, [lastK]: k } }), words: (k) => [tracks(0, 'the other sections'), tracks(k, 'the section opened last')] })
  rungs.push({ step: 10, hi: held - 1, n: held, trim: (r) => ({ tiles: zero, rows: r }),
    words: (r) => [tracks(0, 'each section'), r > 0 ? 'the held track\'s task and question rows past the first ' + r : 'the held track\'s task and question rows'] })
  return rungs
}
/* The Questions tab gives way: the list's questions past a count, then the open card's long words folded,
   with as many of the list as then fit; the open card goes last */
function questionsRungs(qm: any, asleepOpen: boolean): Rung[] {
  const { pinned, rest } = pinnedOf(qm, qpane)
  const n = rest.length
  /* the open Asleep fold's rows go first: a snoozed question waits on nothing now */
  const a = asleepOpen && Array.isArray(qm.asleep) ? qm.asleep.length : 0
  const sleep = (k: number) => (k >= a ? [] : [k > 0 ? 'the asleep questions past the first ' + k : 'every asleep question'])
  const z = a ? { asleep: 0 } : {}
  const list = (k: number) => [...sleep(0), ...(k >= n ? [] : [k > 0 ? 'the questions past the first ' + k + ' of the list' : 'every question in the list'])]
  const rungs: Rung[] = a ? [{ step: 17, hi: a - 1, n: a, trim: (k) => ({ asleep: k }), words: sleep }] : []
  rungs.push({ step: 11, hi: n - 1, n, trim: (k) => ({ ...z, rows: k }), words: list })
  if (pinned) rungs.push({ step: 12, hi: n, trim: (k) => ({ ...z, rows: k, fold: true }), words: (k) => ['the open card\'s long words', ...list(Math.max(0, k))] })
  return rungs
}
/* The band's hover cards past a count: qs the mark's questions from elsewhere, run the agents card's running
   rows (its finished eight of each kind kept), wait the waiting items; bare: the status row's cards gone */
type BandTrim = { qs?: number; run?: number; wait?: number; bare?: boolean }
const BAND_HOLDS = ' not listed here while the band holds this much; '
/* how many of what a card leaves out, or all of it at none kept */
const bandLeft = (n: number, k: number, what: string) => (k > 0 ? n - k + ' more ' + what + ' are' : 'The ' + what + ' are') + BAND_HOLDS
function cardCut(s: any, keep: (c: any) => any): any {
  return s && s.card ? { ...s, card: keep(s.card) } : s
}
function statusCut(sm: any, t: BandTrim): any {
  if (!sm || (t.qs === undefined && t.run === undefined)) return sm
  const mark = t.qs === undefined ? sm.mark : cardCut(sm.mark, (c) => {
    const qs = Array.isArray(c.questions) ? c.questions : []
    if (qs.length <= (t.qs as number)) return c
    return { ...c, questions: qs.slice(0, t.qs), where: [cutFact(bandLeft(qs.length, t.qs as number, 'questions from elsewhere') + 'the Questions tab lists each one.'), ...(c.where || [])] }
  })
  const segments = t.run === undefined ? sm.segments : sm.segments.map((s: any) => (s && s.key === 'agents' ? cardCut(s, (c) => {
    const rows = Array.isArray(c.rows) ? c.rows : []
    const run = rows.filter((r: any) => !r.done)
    if (run.length <= (t.run as number)) return c
    const kept = new Set(run.slice(0, t.run))
    return { ...c, rows: rows.filter((r: any) => r.done || kept.has(r)),
      where: [cutFact(bandLeft(run.length, t.run as number, 'running rows') + 'Home\'s Agents and Background folds show each one.'), ...(c.where || [])] }
  }) : s))
  return { ...sm, mark, segments }
}
function bandCut(m: any, t: BandTrim): any {
  const w = m && m.inbox
  if (t.wait === undefined || !w) return m
  const items = Array.isArray(w.items) ? w.items : (w.lines || []).map((l: string) => ({ text: l, detail: '' }))
  if (items.length <= t.wait) return m
  return { ...m, inbox: { ...w, items: [...items.slice(0, t.wait), { text: bandLeft(items.length, t.wait, 'waiting items') + 'a turn hands every one to this session.', detail: '' }] } }
}
/* The band gives way: the mark card's questions from elsewhere, the agents card's running rows, the waiting
   items, each past a count; last, the status row's cards. The needs line keeps every press (the two rows) */
function bandRungs(sm: any, m: any): { rungs: Rung[]; end: { step: number; words: string[] } } {
  const mq = sm && sm.mark && sm.mark.card && Array.isArray(sm.mark.card.questions) ? sm.mark.card.questions.length : 0
  const ag = sm && Array.isArray(sm.segments) ? sm.segments.find((s: any) => s && s.key === 'agents') : null
  const run = ag && ag.card && Array.isArray(ag.card.rows) ? ag.card.rows.filter((r: any) => !r.done).length : 0
  const w = m && m.inbox
  const wait = w ? (Array.isArray(w.items) ? w.items : w.lines || []).length : 0
  const qsW = (k: number) => (mq ? [k > 0 ? 'the questions from elsewhere past the first ' + k + ' on the mark\'s card' : 'the questions from elsewhere on the mark\'s card'] : [])
  const runW = (k: number) => (run ? [k > 0 ? 'the running rows past the first ' + k + ' on the agents card' : 'the running rows on the agents card'] : [])
  const waitW = (k: number) => (wait > 1 ? [k > 0 ? 'the waiting items past the first ' + k : 'the waiting items'] : [])
  const rungs: Rung[] = []
  if (mq) rungs.push({ step: 13, hi: mq - 1, n: mq, trim: (k) => ({ qs: k }), words: qsW })
  if (run) rungs.push({ step: 14, hi: run - 1, n: run, trim: (k) => ({ qs: 0, run: k }), words: (k) => [...qsW(0), ...runW(k)] })
  if (wait > 1) rungs.push({ step: 15, hi: wait - 1, n: wait, trim: (k) => ({ qs: 0, run: 0, wait: k }), words: (k) => [...qsW(0), ...runW(0), ...waitW(k)] })
  return { rungs, end: { step: 16, words: [...qsW(0), ...runW(0), ...waitW(0), 'the status row\'s cards'] } }
}
/* the question cards under a reply past a count, as one line */
function cardsCut(els: any, n: number): any {
  return els.Box({ key: 'cards-cut', children: [els.Text({ dimColor: true, wrap: 'wrap',
    children: n + (n === 1 ? ' question asked here is' : ' questions asked here are') + ' not drawn under this reply while it holds this much; the Questions tab shows each one whole.' })] })
}
/* for the drawn tool, what gave way and the counts, once near a bound or past the ceiling */
function paneSized(tree: any): any {
  const c = countsOf(tree)
  const near = !countsUnder(c, DRAW_NEAR)
  return { gave: c.words || [], ...(near || c.gave ? { counts: { nodes: c.nodes, depth: c.depth, chars: c.chars, text: c.text, from: c.from, builds: c.builds } } : {}) }
}
/* a row when a surface's drawing comes past 80 percent of a bound or gives way, once until it changes */
const sizeSeen: Record<string, string> = {}
function sizeWatch(surface: string, tree: any): void {
  if (!tree || typeof tree !== 'object') return
  const c = countsOf(tree)
  const near = !countsUnder(c, DRAW_NEAR) || !!c.gave
  const was = sizeSeen[surface] || ''
  const now = near ? (surface === 'pane' ? view.tab : '') + ':' + (c.gave || 0) : ''
  sizeSeen[surface] = now
  if (!near || now === was) return
  lagged.sizes.push({ w: surface, v: surface === 'pane' ? view.tab : '', n: c.nodes, l: c.depth, c: c.chars, t: c.text, g: c.gave || 0 })
  if (lagged.sizes.length > 20) lagged.sizes.shift()
}
/* the picture given way: one line, its press opening the Tracks tab */
function graphLine(els: any, open: () => void): any {
  return els.Box({ key: 'graph', flexDirection: 'row', columnGap: 1, rowGap: 0.5, alignItems: 'center', flexWrap: 'wrap', children: [
    els.Box({ key: 'graph-line-words', flexShrink: 1, minWidth: 0, children: [els.Text({ dimColor: true, wrap: 'wrap', children: 'Where we stand is not drawn here while Home holds this much.' })] }),
    els.Button({ key: 'graph-to-tracks', label: 'Open the Tracks tab', onPress: open }),
  ] })
}
/* the last resort: the tab says it is too large to draw whole and where the rest shows; the tabs and the board link stay */
const TOO_LARGE: Record<string, string> = {
  home: 'Home holds too much to draw whole right now. The Questions tab lists each question, the Tracks tab shows where we stand, and the board link above has the rest.',
  questions: 'The Questions tab holds too many cards to draw whole right now; the board link above lists every question.',
  tracks: 'The Tracks tab holds too much to draw whole right now; the board link above shows the workstream whole.',
}
function tooLarge(els: any, tab: string): any {
  const words = TOO_LARGE[tab] || 'This tab holds too much to draw whole right now; the board link above shows it whole.'
  return els.Box({ key: 'too-large', flexDirection: 'column', children: [els.Text({ wrap: 'wrap', children: words })] })
}

/* this session's open questions, then every open question from elsewhere,
   answered here: the band read's row, the record whole once pinned */
function questionCards(): any[] {
  const own = [...localOpen(), ...(band.questions || [])]
  const ids = new Set(own.map((q: any) => q && q.id))
  const away = awayRows().filter((q: any) => !ids.has(q.id)).map((q: any) => {
    const f = awayFull.get(q.id)
    return f && f.version === q.version ? { ...f.record, track: q.track, trackName: q.trackName, pc: q.pc, project: q.project, asker: f.record.session || null, session: null, away: true } : { ...q, away: true }
  })
  return [...own, ...away]
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
const farMaps: { mark?: string; list: any[]; loading?: Promise<void> } = { list: [] }
function shelfGraphs($: any): any[] {
  const mark = String(band.marker)
  if (farMaps.mark !== mark && !farMaps.loading) {
    const own = new Set([band.graph && band.graph.workstream, band.mine && band.mine.held && band.mine.workstream].filter(Boolean))
    const wss = [...new Set((band.shelf || []).map((r: any) => r && r.workstream).filter((w: any) => w && !own.has(w)))] as string[]
    farMaps.loading = (async () => {
      /* the cards draw the view alone, so no picture is read; all asked together */
      const got = await Promise.all(wss.map((ws) => localGet($, 'graph/' + encodeURIComponent(ws) + '?picture=0')))
      const list = wss.flatMap((ws, i) => (got[i] && got[i].view ? [{ workstream: ws, view: got[i].view }] : []))
      const had = farMaps.list.length
      farMaps.list = list
      farMaps.mark = mark
      if (list.length || had) boardRedraw($, [], true)
    })().catch(() => {}).finally(() => { farMaps.loading = undefined })
  }
  return farMaps.list
}

/* another workstream the Overview zooms into, read from the local board at the press,
   again once per store change, and kept while the view stays on it or on the Overview */
const picFar: { ws?: string; graph?: any; mark?: string; loading?: boolean } = {}
const farOf = (ws: string, g: any) => (g && g.view ? { workstream: ws, view: g.view, picture: g.picture || null } : null)
async function zoomFar($: any, a: any): Promise<void> {
  const g = farOf(a.read, await localGet($, 'graph/' + encodeURIComponent(a.read)))
  if (!g) { paneNote($, 'The local board has no picture of ' + a.read + ' yet; the board has its page.'); return }
  Object.assign(picFar, { ws: a.read, graph: g, mark: String(band.marker) })
  drawCause('zoom', 'far')
  view.pic = a.view
  qpaneRedraw($, PANE_ONLY)
}
function farGraph($: any): any {
  const v = view.pic
  if (!picFar.ws || !v || (v.level > 0 && v.ws !== picFar.ws)) { picFar.ws = undefined; picFar.graph = undefined; return null }
  const ws = picFar.ws
  const mark = String(band.marker)
  if (picFar.mark !== mark && !picFar.loading) {
    picFar.loading = true
    void (async () => {
      const g = farOf(ws, await localGet($, 'graph/' + encodeURIComponent(ws)))
      picFar.mark = mark
      /* a failed read keeps the last picture rather than dropping the view */
      if (g && picFar.ws === ws) { picFar.graph = g; boardRedraw($, PANE_ONLY, false) }
    })().catch(() => {}).finally(() => { picFar.loading = false })
  }
  return picFar.graph
}

/* the Overview rides no band; Home reads it apart while its picture is open, once per
   store change, and again when the local board says a fresher one is due */
const picOv: { mark?: string; got: any; loading?: Promise<void>; timer?: any } = { got: null }
function paneOverview($: any, open: boolean): any {
  const mark = String(band.marker)
  if (open && picOv.mark !== mark && !picOv.loading) {
    picOv.loading = (async () => {
      const o = await localGet($, 'overview')
      const was = picOv.got
      picOv.got = o
      picOv.mark = mark
      if (picOv.timer) { try { picOv.timer.cancel() } catch {} }
      picOv.timer = undefined
      if (o && o.due > 0) { try { picOv.timer = $.clock.after(o.due, ran('picture timer', () => { picOv.timer = undefined; picOv.mark = undefined; boardRedraw($, [], true) })) } catch {} }
      if ((o && o.at) !== (was && was.at)) boardRedraw($, [], true)
    })().catch(() => {}).finally(() => { picOv.loading = undefined })
  }
  return picOv.got
}

/* ---- the Questions tab ----------------------------------------- */

/* What the person unfolded, typed, expanded and asked about: the tab's own, kept across redraws. */
const qpane: QuestionsView = { unfolded: new Set(), notes: {}, drawn: {}, strip: {}, queued: {}, confirm: true }
/* the open option rings are the session's own (qpane.unfolded, kept by the snapshot), so a flip
   writes only its question's count and draws that question's cards, as a strip press does */
function ringFlip($: any, tok: string, sites: string[]): void {
  if (!qpane.unfolded.delete(tok)) qpane.unfolded.add(tok)
  ringToggled(tok, qpane.unfolded.has(tok))
  qpaneRedraw($, sites)
}
/* the band's open strips, its own so a band press opens none on the pane's card; notes and queue are shared */
const bandStrips: Record<string, string> = {}
/* the band strips whose note field shows on the line in place of the option's words */
const bandNotes: Record<string, boolean> = {}

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
  /* the question's name and the option's words when queued, for the band's queued card */
  name?: string; option?: string
  /* where it was pressed: the pane, or the card under a reply (its told record's useId and key) */
  site: PressSite; useId?: string; key?: string; local?: boolean
}
/* The queue slice: every change moves `queue`. touched: ids set or dropped before the saved
   list came back, which that list never undoes; seen: the band marker each was last read at, so one
   read per question per board change; due: a save asked inside a batch, written at its end */
const answerQueue = {
  items: new Map<string, QueuedAnswer>(),
  touched: new Set<string>(),
  seen: new Map<string, string>(),
  read: undefined as Promise<void> | undefined,
  saving: Promise.resolve() as Promise<unknown>,
  next: undefined as Promise<void> | undefined,
  sending: false,
  /* ids whose record call ran out of time: it may have landed, so a later Send counts the same pick standing as its own */
  late: new Set<string>(),
  saveFailed: false,
  due: false,
  list: (): QueuedAnswer[] => [...answerQueue.items.values()],
}
function queueSet($: any, q: QueuedAnswer): void {
  answerQueue.items.set(q.id, q)
  answerQueue.touched.add(q.id)
  queueMoved($, q.id)
}
/* quiet: the caller draws, so it gets the surfaces back */
function queueDrop($: any, id: string, quiet = false): string[] {
  answerQueue.touched.add(id)
  if (!answerQueue.items.delete(id)) return []
  if (!quiet) { queueMoved($, id); return [] }
  queueDrawn()
  void queueSave($).catch(() => {})
  return [...queueCards(id), 'band', 'pane']
}
function queueDrawn(): void {
  touch('queue')
  qpane.queued = Object.fromEntries(answerQueue.list().map((q) => [q.id, { letter: q.letter }]))
}
/* the question's cards, and every open strip's, which carries the queue's count */
const queueCards = (id: string): string[] => [...new Set([id, ...Object.keys(qpane.strip || {})])].map(qCount)
/* the count shows on the band, Home's copy and each open strip */
function queueMoved($: any, id: string): void {
  queueDrawn()
  qpaneRedraw($, [...queueCards(id), 'band', 'pane'], 'queue')
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
      if (moved) { queueDrawn(); laterRedraw($, EVERY, 'queue'); void snapSave($) }
    })()
  }
  return answerQueue.read
}

/* one write at a time, each the whole list as it stands when the write starts, after the read so it
   never writes over what was saved; a save asked while one waits its turn is that one; inside a
   batch (Send) once, at its end */
function queueSave($: any): Promise<void> {
  if (sched.hold) { answerQueue.due = true; return Promise.resolve() }
  if (answerQueue.next) return answerQueue.next
  const run = answerQueue.saving.then(async () => {
    answerQueue.next = undefined
    await queueRead($)
    const ok = !!(await queueRun($, 'write', JSON.stringify(answerQueue.list())).catch(() => null))
    if (!ok && !answerQueue.saveFailed) toast($, 'Your queued answers could not be saved on this PC; they stay queued until this session ends.', 'press')
    answerQueue.saveFailed = !ok
  })
  answerQueue.next = run
  answerQueue.saving = run.catch(() => {})
  return run
}

/* the local board writes each answer's inbox line once its row comes back, after the verb
   returns, so Send's one turn waits until the inbox holds every line it recorded, capped */
const SEND_CATCH_MS = 10000
async function inboxHolds($: any, want: Array<{ id?: string; key?: string }>): Promise<void> {
  if (!want.length) return
  const until = Date.now() + SEND_CATCH_MS
  let st = await waitRead($, 'state').catch(() => null)
  while (st) {
    const evs = (await readInboxes($, 'peek').catch(() => null)) || []
    const has = (w: { id?: string; key?: string }) => evs.some((e: any) => e && e.raw && e.raw.kind === 'answer' && ((w.key && e.raw.key === w.key) || (w.id && e.raw.id === w.id)))
    const left = until - Date.now()
    /* a turn that started meanwhile takes each line as a note as it lands */
    if (mem.turn || want.every(has) || left <= 0) return
    st = await waitRead($, 'wait?after=' + st.seq + '&ms=' + Math.min(left, CATCH_MS)).catch(() => null)
  }
}

/* Send records each queued answer with its note and drawn version (a kept label in its own
   path), then delivers them together: one turn here, the owner's inbox elsewhere. One answered,
   dropped or reworded meanwhile is not recorded and drops; a failed one stays queued. */
/* lead: the surface Send was pressed on, drawn first */
async function sendQueued($: any, mark?: any, lead: Site = 'band'): Promise<void> {
  /* a press while one Send runs is told, never dropped unseen */
  if (answerQueue.sending) { if (!mark) toast($, 'Your last Send is still delivering. Press Send again once it is done for anything you queued since.', 'press'); return }
  answerQueue.sending = true
  let drew = false, held = false, owing = -1
  let list: QueuedAnswer[] = []
  try {
    await queueRead($)
    list = answerQueue.list().filter((q) => !answeringOf(answers.chips)[q.id])
    if (!list.length && !mark) { drew = true; return }
    /* the chips show saving before any round trip or the mark's write */
    drawCause('answer', 'send')
    for (const q of list) answers.chips[q.id + '|' + q.letter] = { state: 'pending' }
    chipsMoved($, list.map((q) => q.id), lead)
    /* the batch's done draw waits for its reload and its turn's take, one draw for every answer */
    owing = oweHold()
    const before = mark ? (mark.before === null ? null : { seq: mark.before }) : await waitRead($, 'state')
    const sending = await sendMark($, before, mark)
    const sent: string[] = [], dropped: string[] = [], kept: string[] = []
    const lines: Array<{ id?: string; key?: string }> = []
    let here = false
    /* the batch, the recording loop alone: the answers go with no passive draw, load or wait on the
       queue's file between them, while a press meanwhile draws at once */
    schedHold($)
    held = true
    const left = (id: string) => {
      answerQueue.touched.add(id)
      answerQueue.items.delete(id)
      queueDrawn()
      void queueSave($).catch(() => {})
    }
    for (const [i, q] of list.entries()) {
      const tok = token(q.id, q.letter)
      const t0 = Date.now()
      const r = await recordAnswer($, q.key || q.id, q.letter, q.site, q.note || undefined, q.id, q.version, true).catch(answerFailed(q.id))
      const call = Date.now() - t0
      let told = 0
      chipDone(q.id, q.letter, r)
      /* resumed, or after a call that ran out of time, the same pick standing is this send's own write */
      const own = !!((mark || answerQueue.late.has(q.id)) && r.ok && r.stood && r.sent && r.pick === q.letter)
      if (r.ok) answerQueue.late.delete(q.id)
      if (r.ok && (!r.stood || own)) {
        sent.push(own ? r.sent! : r.text)
        if (r.owned) here = true
        if (r.lands && !r.stood && !isLocalId(q.id)) lines.push({ id: r.id, key: r.key })
        sendDone($, sending, q.id, !!r.owned)
        left(q.id)
        noteGone(q.id)
        if (q.useId && !q.local) { const t = Date.now(); await cardSent($, q.useId, token(q.id, r.pick || q.letter)); told = Date.now() - t }
      } else if (r.ok || r.gone) {
        dropped.push('Your queued ' + tok + ' was not recorded and left the queue: ' + failWhy(r.text))
        left(q.id)
      } else kept.push(tok + ' (' + failWhy(r.text).replace(/[.]$/, '') + ')')
      if (lagged.sends.length < 10) lagged.sends.push([call, told, Date.now() - t0 - call - told, r.late ? 1 : 0])
      /* a server that stopped answering: the rest stay queued untried rather than each wait out the limit */
      if (r.late) {
        answerQueue.late.add(q.id)
        for (const rest of list.slice(i + 1)) { delete answers.chips[rest.id + '|' + rest.letter]; kept.push(token(rest.id, rest.letter) + ' (not tried)') }
        break
      }
    }
    held = false
    schedRelease($)
    /* the reload counts from the last write; its take joins the draw too */
    oweLoad($)
    const delivered = here || mark ? inboxHolds($, lines).then(() => deliverAsked($, before, 'pane')) : Promise.resolve()
    const n = sent.length
    const said = [n ? 'Sent ' + n + (n === 1 ? ' answer.' : ' answers.') : '', ...sent, ...dropped,
      kept.length ? 'Still queued, not recorded: ' + kept.join(', ') + '; press Send again.' : ''].filter(Boolean)
    if (said.length) toast($, said.map((t) => (/[.!?]$/.test(t) ? t : t + '.')).join(' '), 'press')
    qpane.answering = answeringOf(answers.chips)
    touch('view')
    const cards = list.map((q) => qCount(q.id))
    /* one not recorded shows at once, its chip back */
    if (kept.length) qpaneRedraw($, cards, 'cards')
    const gen = owing
    owing = -1
    oweLet($, gen, kept.length ? [] : cards)
    await Promise.all([refresh($), delivered])
    drew = true
  } finally {
    answerQueue.sending = false
    if (owing >= 0) oweLet($, owing)
    /* the mark ends with one snapshot write */
    const marked = !!snap.sending
    snap.sending = null
    if (held) { if (marked) snap.due = true; schedRelease($) } else if (marked) void snapSave($, true)
    /* the reload drew what stands; a send that threw before it puts its chips back and draws what differs */
    if (!drew) {
      for (const q of list) if (answers.chips[q.id + '|' + q.letter]?.state === 'pending') delete answers.chips[q.id + '|' + q.letter]
      qpane.answering = answeringOf(answers.chips)
      qpaneRedraw($, ['cards', ...list.map((q) => qCount(q.id))])
      drawnIfMoved($, [], ['send'])
    }
  }
}

/* a send in flight is marked in the snapshot, which outlives a hooks worker respawn, so the
   fresh copy finishes it once: what the board shows answered drops, the rest is recorded. The mark is
   written before the first answer; its done list rides the batch's end, since the follow and a stood
   pick already keep a resumed send from recording twice */
async function sendMark($: any, before: any, mark?: any): Promise<Sending> {
  snap.sending = { before: before && Number.isFinite(before.seq) ? before.seq : null, done: mark ? [...mark.done] : [], here: !!(mark && mark.here) }
  await snapSave($, true)
  return snap.sending
}
function sendDone($: any, sending: Sending, id: string, owned: boolean): void {
  sending.done.push(id)
  if (owned) sending.here = true
  void snapSave($)
}
async function sendResume($: any): Promise<void> {
  await snapBack($)
  const mark = snap.sending
  if (!mark || !Array.isArray(mark.done)) return
  await queueRead($)
  for (const id of mark.done) queueDrop($, id)
  /* the reload's queueFollow drops what the board shows answered, so nothing records twice */
  await refresh($)
  await sendQueued($, mark)
}

/* A queued answer leaves the queue once a read shows its question closed (answered in chat, by the
   CLI or on another PC, dropped or snoozed) or reworded past the version it was pressed on; one a
   read merely leaves out stays, so only the band's open rows or a show of the question decide. */
async function queueFollow($: any, near: any): Promise<void> {
  if (answerQueue.sending || near.loaded === false) return
  await queueRead($)
  const rows = (list: any) => {
    const m = new Map<string, any>()
    for (const r of Array.isArray(list) ? list : []) if (r && r.id) { m.set(r.id, r); if (r.key) m.set(r.key, r) }
    return m
  }
  const mine = rows(near.questions), away = rows(near.elsewhere && near.elsewhere.questions)
  for (const q of answerQueue.list()) {
    let id = q.id, handle = q.key || q.id
    if (isLocalId(q.id)) {
      /* a kept question follows the mod's own store until it is filed, then the board */
      const e = local.entry
      const k = e && e.qs.find((x) => x.label === q.id)
      if (k) { if (k.status !== 'open') queueLeave($, q.id); continue }
      const f = e && e.filed[q.id]
      if (!f) continue
      id = f.id
      handle = f.key || f.id
    }
    const shown = q.version !== undefined
    const own = mine.get(handle) || mine.get(id)
    let s: any = own ? { ...own, status: 'open' } : null
    if (!s) {
      const r = away.get(handle) || away.get(id)
      /* a row from elsewhere carries no rewording, so only a moved version is read again */
      if (r && !(shown && Number(r.version) > Number(q.version))) continue
      if (answerQueue.seen.get(q.id) === (band.marker || '')) continue
      answerQueue.seen.set(q.id, band.marker || '')
      const got = await cli($, ['show', handle, '--json']).catch(() => null)
      s = got && got.ok ? got.json : null
    }
    const now = answerQueue.items.get(q.id)
    if (!s || !now) continue
    if (['answered', 'dropped', 'snoozed'].includes(s.status) || (s.status === 'open' && now.version !== undefined && rewordedSince(now, s))) queueLeave($, q.id, s)
  }
}

/* a queued answer a read shows closed leaves the queue as queueDrop does, its draw at the gate */
function queueLeave($: any, id: string, s?: any): void {
  answerQueue.touched.add(id)
  const q = answerQueue.items.get(id)
  const late = answerQueue.late.delete(id)
  if (!q || !answerQueue.items.delete(id)) return
  queueDrawn()
  laterRedraw($, [...queueCards(id), 'band', 'pane'], 'queue')
  void queueSave($).catch(() => {})
  if (late && s && s.status === 'answered') void lateLanded($, q, s).catch(() => {})
}
/* a Send's call that ran out of time and landed with the queued pick is that Send's: one
   toast, the card told, and the turn the Send would have started */
async function lateLanded($: any, q: QueuedAnswer, s: any): Promise<void> {
  const said = String(s.answer || '').trim().split(/\r?\n/)[0]
  const m = /^\s*\d+([a-z])\b/.exec(said)
  if ((m ? m[1] : '') !== q.letter) return
  const label = s.id || q.id
  toast($, 'Answered ' + label + (s.name ? ' (' + s.name + ')' : '') + ': ' + (q.letter ? token(label, q.letter) : said) + ', recorded after all.', 'press')
  noteGone(q.id)
  if (q.useId && !q.local) await cardSent($, q.useId, token(q.id, q.letter))
  const sid = await sessionId($)
  const held = band.mine && band.mine.held ? band.mine.track : undefined
  /* the board's owner: the track's holder, else the asker */
  if ((s.track && s.track === held) || ownsIt({ session: s.session }, sid)) userDelivers($, 'pane')
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
    qtick.timer = $.clock.every(60000, ran('questions age timer', () => {
      void Promise.resolve($.ui.panes()).then((ps: any) => {
        if (view.tab === 'questions' && Array.isArray(ps) && ps.some((p: any) => p.id === PANE_ID || OLD_PANE_IDS.includes(p.id))) return quietRedraw($, ['cards'])
        try { qtick.timer.cancel() } catch {}
        qtick.timer = undefined
      }).catch(() => {})
    }))
  } catch {}
}

/* ---- the store and the scheduler ----------------------
   The state a draw reads, cut into slices, each with a version its causes move. The flights' data is
   `flights`, the cards' `tellings`, the queue's `answerQueue`; the rest still sits in the module's
   variables. */
type Slice = 'board' | 'flights' | 'queue' | 'cards' | 'view' | 'status'
const SLICES: Slice[] = ['board', 'flights', 'queue', 'cards', 'view', 'status']
const slices: Record<Slice, number> = { board: 0, flights: 0, queue: 0, cards: 0, view: 0, status: 0 }
/* the slices each surface's model reads: the band its questions, chips, strips and queued count,
   and on a desktop its status row too, which reads the board, the flights and the meters and guard */
const BAND_READS: Slice[] = ['board', 'queue', 'view']
const HINT_READS: Slice[] = ['board', 'flights', 'status']
const BAND_DESK: Slice[] = [...BAND_READS, 'flights', 'status']
const READS: Record<string, Slice[]> = {
  hint: HINT_READS,
  get band() { return drawnOn.has('desktop') ? BAND_DESK : BAND_READS },
  /* the open tab's */
  get pane() { return PANE_READS[view.tab] || SLICES },
}
function touch(...moved: Slice[]): void {
  for (const s of moved) slices[s]++
}
const tupleOf = (site: string): string => (READS[site] || SLICES).map((s) => slices[s]).join('.')
/* a checked surface's versions when its count was last written or it was last checked: a check skips
   a surface no slice it reads has moved since */
const seenAt = new Map<string, string>()
const movedSince = (site: string): boolean => seenAt.get(site) !== tupleOf(site)

/* The scheduler, the one writer of $.state. An interaction's asks flush at once, folded per turn of
   the loop, inside a batch too; a passive cause waits for the gate, at most once a second, and
   inside a batch (Send's recording) for its end; each dirty count is one plain write */
const sched = {
  now: new Set<string>(), armed: false,
  hold: 0, held: new Set<string>(), laterDue: false,
  drawing: 0, refused: new Set<string>(), idle: [] as Array<() => void>, n: 0, retry: undefined as any, ended: 0, endedAt: 0,
}
function schedNow($: any, sites: string[]): void {
  for (const s of sites) sched.now.add(s)
  /* an interaction is what moves the session's own slices */
  void snapSave($)
  if (sched.armed) return
  sched.armed = true
  void Promise.resolve().then(() => { sched.armed = false; schedFlush($) }).catch(() => {})
}
function schedFlush($: any): void {
  const sites = [...sched.now]
  sched.now.clear()
  if (sites.length) siteRedraw($, sites, true)
}
/* a batch: what was asked before it draws now, a passive ask inside it once at its end */
function schedHold($: any): void {
  schedFlush($)
  sched.hold++
}
function schedRelease($: any): void {
  if (sched.hold > 0) sched.hold--
  if (sched.hold) return
  const sites = [...sched.held]
  sched.held.clear()
  if (sites.length) siteRedraw($, sites)
  if (sched.laterDue) { sched.laterDue = false; coolArm($) }
  /* the told map and the queue file, written once for the batch */
  if (tellings.due.size) void toldWrite($).catch(() => {})
  if (answerQueue.due) { answerQueue.due = false; void queueSave($).catch(() => {}) }
  if (snap.due) void snapSave($, true)
}
/* the mod's draws in flight, inside which the engine refuses a write */
function drawEnter(): void { sched.drawing++; held('draw') }
function drawLeave($: any): void {
  sched.ended++
  if (--sched.drawing > 0) return
  sched.drawing = 0
  drawsEnded($)
}
function drawsEnded($: any): void {
  if (sched.retry) { try { sched.retry.cancel() } catch {} sched.retry = undefined }
  const ids = [...sched.refused]
  const idle = sched.idle.splice(0)
  sched.refused.clear()
  if (!ids.length && !idle.length) return
  /* once the engine has the draw's answer */
  const go = () => { for (const id of ids) drawnWrite($, id, true); for (const f of idle) f() }
  try { $.clock.after(0, ran('draws ended timer', go)) } catch { go() }
}
function drawnWrite($: any, id: string, again = false): void {
  if (READS[id]) seenAt.set(id, tupleOf(id))
  if (!again) ringAsked(id)
  sched.n = (sched.n + 1) % 4096
  /* a new value each write, past any an earlier copy of the module wrote */
  const v = Date.now() * 4096 + sched.n
  void Promise.resolve().then(() => $.state.set({ ...DRAWN, id }, v)).catch(() => {
    /* refused inside a draw: written again once the draws end; refused again, every site as before */
    if (!again) { sched.refused.add(id); if (!sched.drawing) drawsEnded($); else refusedArm($); return }
    if (rings.now) rings.now.i = (rings.now.i || 0) + 1
    try { $.ui.invalidate('ui.render') } catch {}
  })
}
/* a draw that never settles would keep a refused count unwritten for good, so the
   refused are written again once no draw has ended for REFUSED_MS (a live draw takes 150 ms); a
   stream of draws that keep ending waits for the last. Once more refused, every surface draws */
const REFUSED_MS = 500
function refusedArm($: any): void {
  if (sched.retry) return
  sched.endedAt = sched.ended
  const go = () => {
    sched.retry = undefined
    const ids = [...sched.refused]
    if (!ids.length) return
    if (sched.ended !== sched.endedAt && sched.drawing) { refusedArm($); return }
    sched.refused.clear()
    lagged.stuck++
    for (const id of ids) drawnWrite($, id, true)
  }
  try { sched.retry = $.clock.after(REFUSED_MS, ran('refused write timer', go)) } catch { sched.retry = undefined }
}
/* every other write to $.state (the engine wants its key written at the call): refused inside a
   draw, it waits for the draws to end, 2 s at most */
async function stateSet($: any, write: () => Promise<any>): Promise<void> {
  try { await write(); return } catch (err) { if (!sched.drawing) throw err }
  await new Promise<void>((done) => { sched.idle.push(done); try { $.clock.after(2000, done) } catch {} })
  await write()
}

/* ---- the snapshot -----------------------------------------
   The session's own slices mirrored into $.state, which outlives a hooks worker respawn: a fresh copy
   draws the tab, folds, strips, notes and queue its last copy left, and finishes a send in flight.
   Never the board's answer, which the local server holds (the band read back, bandBack). */
const SNAP = { plugin: 'askerdo', key: 'snapshot' } as const
/* the contract's shapes (types/index.d.ts) */
type Sending = { before: number | null; done: string[]; here: boolean }
type Snapshot = { v: number; starts: number; sending: Sending | null; view: any; q: any; queue: QueuedAnswer[] }
/* the snapshot's shape: a copy reads another shape as none */
const SNAP_V = 1
/* one write a second at most: the first at once, what comes in the next second folds into one at its end */
const SNAP_MS = 1000
const snap: { read?: Promise<Snapshot | null>; applied: boolean; sending: Sending | null; timer?: any; due: boolean; last: string; chain: Promise<void> } =
  { applied: false, sending: null, due: false, last: '', chain: Promise.resolve() }
/* a typed note rides the snapshot while its question is listed or queued, once both lists are read */
function notesKept(): Record<string, string> {
  if (!band.loaded || local.sid !== mem.id) return { ...qpane.notes }
  const keep = new Set([...questionCards().map((q: any) => q && q.id), ...answerQueue.items.keys()])
  return Object.fromEntries(Object.entries(qpane.notes).filter(([id]) => keep.has(id)))
}
function snapOf(): Snapshot {
  return {
    v: SNAP_V, starts: boot.n, sending: snap.sending,
    view: { tab: view.tab, chosen: !!view.chosen, filter: view.filter, unfolded: [...view.unfolded], pic: view.pic, picOf: view.picOf ?? null,
      done: view.done, bgDone: view.bgDone, bgMore: [...view.bgMore] },
    q: { unfolded: [...qpane.unfolded], notes: notesKept(), strip: { ...(qpane.strip || {}) }, band: { ...bandStrips },
      expanded: qpane.expanded ?? null, asking: qpane.asking ?? null },
    queue: answerQueue.list(),
    ...(answerQueue.late.size ? { late: [...answerQueue.late] } : {}),
  }
}
/* now: written at once, past the second's limit and a batch (a send's mark, a start's count) */
function snapSave($: any, now = false): Promise<void> {
  if (!now && (sched.hold || snap.timer)) { snap.due = true; return snap.chain }
  snap.due = false
  snap.chain = snap.chain.then(async () => {
    /* never over the last copy's before it is read back */
    await snapBack($)
    const v = snapOf()
    const s = JSON.stringify(v)
    if (s === snap.last) return
    snap.last = s
    return stateSet($, () => $.state.set(SNAP, v)).catch(() => { snap.last = '' })
  })
  if (!snap.timer) {
    try {
      snap.timer = $.clock.after(SNAP_MS, ran('snapshot timer', () => {
        snap.timer = undefined
        if (snap.due) void snapSave($)
      }))
    } catch { snap.timer = undefined }
  }
  return snap.chain
}
/* read once per copy (session.start, else its first draw); a get only, since a draw may ask first */
function snapBack($: any): Promise<Snapshot | null> {
  if (!snap.read) {
    snap.read = Promise.resolve().then(() => $.state.get(SNAP)).then((r: any) => {
      let s = r && r.value && r.value.v === SNAP_V ? r.value as Snapshot : null
      /* one that does not apply counts as none but its start count, and is written over, so draws go on */
      if (s && !snap.applied) {
        try { snapApply($, s) } catch (err: any) {
          s = { v: SNAP_V, starts: Number(s.starts) || 0, sending: null, view: null, q: null, queue: [] }
          debugLine($, PLUGIN + ': the saved snapshot did not apply and was dropped: ' + String((err && err.message) || err))
          void snapSave($, true)
        }
      }
      snap.applied = true
      return s
    }, () => null)
  }
  return snap.read
}
function snapApply($: any, s: Snapshot): void {
  const v = s.view
  const q = s.q
  /* the sets first, so a shape that throws leaves every slice as it was */
  const unfolded = new Set<string>((v && v.unfolded) || []), bgMore = new Set<string>((v && v.bgMore) || []), rings = [...((q && q.unfolded) || [])]
  /* a press or an opener before the read wins */
  if (v && v.tab in PANE_READS && !view.chosen) {
    view.tab = v.tab
    view.chosen = !!v.chosen
    view.filter = String(v.filter || '')
    view.unfolded = unfolded
    view.pic = v.pic || null
    view.picOf = v.picOf ?? undefined
    view.done = !!v.done
    view.bgDone = !!v.bgDone
    view.bgMore = bgMore
    view.seeded = undefined
  }
  if (q) {
    for (const id of rings) qpane.unfolded.add(id)
    Object.assign(qpane.notes, q.notes || {})
    qpane.strip = { ...(q.strip || {}), ...(qpane.strip || {}) }
    Object.assign(bandStrips, q.band || {})
    qpane.expanded = qpane.expanded ?? (q.expanded || undefined)
    qpane.asking = qpane.asking ?? (q.asking || undefined)
    qpane.drawn = { ...qpane.notes }
  }
  /* the queue file read later adds what the snapshot missed; ids touched meanwhile stand */
  for (const a of Array.isArray(s.queue) ? s.queue : []) {
    if (a && typeof a.id === 'string' && typeof a.letter === 'string' && !answerQueue.touched.has(a.id) && !answerQueue.items.has(a.id)) answerQueue.items.set(a.id, a)
  }
  /* a send that ran out of time keeps its mark, so the answer landing after a respawn still toasts once */
  for (const id of Array.isArray(s.late) ? s.late : []) if (typeof id === 'string' && !answerQueue.touched.has(id)) answerQueue.late.add(id)
  if (s.sending && Array.isArray(s.sending.done)) snap.sending = s.sending
  queueDrawn()
  touch('view')
}

/* Each site reads its own count as it draws, so a redraw writes the counts of the sites it changed
   and draws those alone: an invalidate draws every surface and every reply on screen again */
const DRAWN = { plugin: 'askerdo', key: 'drawn' } as const
/* 'card' is every card under a reply; 'cards' only the live ones whose model moved (cardsMoved); 'q <id>' that
   question's cards */
type Site = 'band' | 'hint' | 'pane' | 'card' | 'cards' | 'reply'
const EVERY: Site[] = ['band', 'hint', 'pane', 'cards']
const PANE_ONLY: Site[] = ['pane']
/* the meters, the guard and the thread: the status row on the hint; the band's and Home's through drawnIfMoved */
const STATUS: Site[] = ['hint']
/* a board load: the hint and the cards it changed, the band and the pane through drawnIfMoved */
const BOARD: Site[] = ['hint', 'cards']
/* the band's own view (its strips, its call fold), drawn on the band and Home's copy of it */
const BAND_VIEW: Site[] = ['band', 'pane']
/* a press that changes no card under a reply */
const OWN: Site[] = ['band', 'hint', 'pane']
/* The old asks, shims onto the scheduler. A press of the user's draws at once, in the order given
   (its own surface first) */
function qpaneRedraw($: any, sites: string[] = EVERY, slice: Slice = 'view'): void {
  touch(slice)
  ringLead(sites)
  schedNow($, sites)
}
/* Anything no press asked for (an agent's tick, a figure, a read, a model's write) waits for the gate;
   the band and the pane then draw only where their drawing would differ */
function laterRedraw($: any, sites: string[] = EVERY, slice: Slice = 'board'): void {
  boardRedraw($, sites.filter((s) => s !== 'band' && s !== 'pane'), sites.includes('band') || sites.includes('pane'), slice)
}
/* a card reads the count of its question, so a press draws that question's cards alone; an
   override request's card its telling's */
const qCount = (id: string): string => 'q ' + id
const cardCount = (useId: string, q: any): string => (q && q.id && !q.override ? qCount(q.id) : 'card ' + useId)
/* the live cards whose model moved since drawn, by the count each read; a settled card is never compared */
function cardsMoved(): string[] {
  const ids = new Set<string>()
  const now = Date.now()
  for (const [useId, f] of tellings.faces) {
    const q = told.get(useId)
    const sig = q && !cardSettled(q) ? modelSig(cardModel(useId, q, mem.id, now)) : 'settled'
    if (sig === f.sig) continue
    f.sig = sig
    ids.add(f.id)
  }
  return [...ids]
}
/* the scheduler's write of the sites' counts; a passive one is held while a batch runs, a press's never */
function siteRedraw($: any, sites: string[], press = false): void {
  if (sched.hold && !press) { for (const s of sites) sched.held.add(s); return }
  for (const id of new Set(sites.flatMap((s) => (s === 'cards' ? cardsMoved() : [s])))) drawnWrite($, id)
}

/* The gate: a redraw no press asked for (a board change, an agent's tick, the status row's figures, a
   read the draw started) waits out the cooldown, so each surface draws at most once a cooldown and what
   came meanwhile folds into that draw; the gather lets a draw's own reads land first. A press draws at
   once through qpaneRedraw */
const COOLDOWN_MS = 1000
const GATHER_MS = 250
/* hint: the status row asked only where its drawing moved (a running time's turn), checked once a release */
/* why: the slices moved (and asks) the release folds, for the redraw check row's causes */
const cool: { want: Set<string>; check: boolean; hint: boolean; timer?: any; last: number; why: Set<string> } = { want: new Set(), check: false, hint: false, last: 0, why: new Set() }
function boardRedraw($: any, sites: string[], check = true, slice: Slice = 'board'): void {
  touch(slice)
  for (const s of sites) cool.want.add(s)
  if (check) { cool.check = true; cool.why.add(slice) }
  coolArm($)
}
function hintIfMoved($: any): void {
  cool.hint = true
  coolArm($)
}
function coolArm($: any): void {
  if (cool.timer) return
  const wait = Math.max(GATHER_MS, cool.last + COOLDOWN_MS - Date.now())
  try { cool.timer = $.clock.after(wait, ran('cooldown timer', () => { cool.timer = undefined; coolTick($) })) } catch { coolTick($) }
}
/* Home's own reads a board load started (activity, overview, shelf graphs): the release waits on them,
   at most READS_MS from the load, so they land inside its one draw rather than open a second */
const READS_MS = 1000
const paneReads = {
  list: [] as Promise<any>[], at: 0,
  add(at: number, ps: Array<Promise<any> | undefined>) { this.at = at; for (const p of ps) if (p) this.list.push(p) },
}
function coolTick($: any): void {
  const reads = paneReads.list.splice(0)
  const left = paneReads.at + READS_MS - Date.now()
  if (!reads.length || left <= 0) return coolRelease($)
  let gone = false
  const go = () => {
    if (gone) return
    gone = true
    try { if (cool.timer) cool.timer.cancel() } catch {}
    cool.timer = undefined
    coolRelease($)
  }
  /* cool.timer held meanwhile, so a cause in the wait folds into this release */
  try { cool.timer = $.clock.after(left, ran('cooldown reads timer', go)) } catch { return coolRelease($) }
  void Promise.allSettled(reads).then(go)
}
function coolRelease($: any): void {
  /* inside a batch the gate opens at its end */
  if (sched.hold) { sched.laterDue = true; return }
  const sites = [...cool.want]
  const check = cool.check
  const hint = cool.hint && !cool.want.has('hint')
  const why = [...cool.why]
  cool.want.clear()
  cool.check = false
  cool.hint = false
  cool.why.clear()
  cool.last = Date.now()
  lagged.gates++
  coolWaited()
  if (sites.length) siteRedraw($, sites)
  /* a surface already asked draws anyway: checking it too would ask it twice */
  if (check) drawnIfMoved($, sites, why)
  if (hint) void hintMoved($).catch(() => true).then((moved) => { if (moved) siteRedraw($, STATUS) })
}

/* The app replaces a pane's or band's whole drawing on each render, which drops the hover under a
   resting pointer, so the status row's causes and a board load redraw the pane and the band only when
   their drawing would differ. Each surface's pane: its last render's event and what that drawing drew from
   (paneSig), with which live pieces drew as Clients */
const paneFaces = new Map<string, { e: any; sig: string; live: PaneLive }>()
/* each surface's band: its last render's event and what that drawing drew from (bandSig), with whether its
   status row's agents drew as Clients */
const bandFaces = new Map<string, { e: any; sig: string; live: boolean }>()
/* want: the surfaces a check is owed, filled while one runs so a cause meanwhile checks again after it */
const drawGate: { busy?: boolean; want: Set<Site>; why: Set<string> } = { want: new Set(), why: new Set() }
/* the status row's causes: its own sites, and the band and the pane where they would differ, all at the gate */
function quietRedraw($: any, sites: Site[]): void {
  laterRedraw($, [...sites, 'band', 'pane'], 'status')
}
async function paneSite($: any, e: any): Promise<any> {
  const k = e.surface + ' ' + e.requestId
  const tree = await paneDraw($, e)
  const m = paneDrew.get(k)
  const live = { count: hasKey(tree, AGENTS_COUNT), rows: !!(m && m.liveRows) }
  paneFaces.set(k, { e, sig: m ? paneSig(m, live) : '', live })
  const cols = Number(e.props && e.props.bodyColumns) || 0, desk = e.surface === 'desktop'
  if (m) drawnLast.pane = { at: Date.now(), cols: e.props && e.props.bodyColumns, surface: e.surface, m,
    fit: (rows: any[], which: string) => (which === 'background' ? bgRows(rows, cols, desk) : rows).map((r: any) => fitRow(r, cols, desk)),
    folds:{ agents: foldOpen($, 'agents'), background: foldOpen($, 'background'), agentsDone: view.done, bgDone: view.bgDone }, ...paneSized(tree) }
  return tree
}
/* each part's last draw as its draw hands it over (the model, its columns and time), for the drawn tool */
const drawnLast: Record<string, any> = {}
/* the segment keys a status drawing holds, so the text says which ones the row had room for */
function keysIn(n: any, re: RegExp, out: string[] = []): string[] {
  if (!n || typeof n !== 'object' || n.type === 'Svg') return out
  if (Array.isArray(n)) { for (const c of n) keysIn(c, re, out); return out }
  const k = n.key ?? (n.props && n.props.key)
  const hit = typeof k === 'string' ? re.exec(k) : null
  if (hit) out.push(hit[1])
  keysIn(n.children, re, out)
  if (n.props) keysIn(n.props.children, re, out)
  return out
}
/* what this session's pane, band and status row last drew, as text; a read draws nothing.
   the context figure only where the depth tool would give it without a why */
async function drawnTool($: any, input: any): Promise<any> {
  const part = input && typeof input.part === 'string' ? input.part.trim() : ''
  if (part && !DRAWN_PARTS.includes(part)) return { deny: 'drawn refused: part is one of ' + DRAWN_PARTS.join(', ') + ', or left out for all three' }
  if (guard.state === undefined) await refresh($).catch(() => {})
  const told = await toldMarks($, await sessionId($))
  const st = drawnLast.status
  const keys = st ? keysIn(st.tree, /^status-([a-z]+)$/) : []
  const drawn = { ...drawnLast, ...(st ? { status: { ...st, keys: keys.length ? keys : null } } : {}) }
  return { result: drawnText({ drawn, part: part || undefined, now: Date.now(), depth: depthOpen(guard.state && guard.state.main, told) }) }
}
async function bandFace($: any, e: any, next: any): Promise<any> {
  const tree = await bandSite($, e, next)
  const live = e.surface === 'desktop' && hasKey(tree, AGENTS_COUNT)
  bandFaces.set(e.surface, { e, sig: bandSig($, e, live), live })
  return tree
}
/* a drawing holds a node keyed `key` (a live Client's), found without writing the tree out */
function hasKey(n: any, key: string): boolean {
  if (!n || typeof n !== 'object') return false
  if (Array.isArray(n)) return n.some((c) => hasKey(c, key))
  if (n.type === 'Svg') return false
  if (n.key === key || (n.props && n.props.key === key)) return true
  return hasKey(n.children, key) || (!!n.props && hasKey(n.props.children, key))
}
/* what a surface's band draws from, so the check compares models, never trees: the band's model
   and view (bandParts), the ages its row shows, the status row's model on a desktop less what its live
   pieces draw, the props and the keys a press handed off */
function bandSig($: any, e: any, live: boolean): string {
  if (!band.loaded) return 'loading'
  const desk = e.surface === 'desktop'
  const b = bandParts($)
  const sm = desk ? statusOf($) : null
  const now = Date.now()
  const qs = b.model && Array.isArray(b.model.questions) ? b.model.questions : []
  const ages = qs.map((q: any) => (q && q.born ? ageText(now - q.born) : ''))
  const p = e.props || {}
  return JSON.stringify([bandKept.sig, ages, sm ? hintSig(sm, live) : null, p.bodyColumns, p.maxRows, !!p.hasSurvey,
    desk ? [...handed].sort() : null, liveFault.has(e.component + ' ' + e.surface)])
}
/* one check at a time; a cause meanwhile checks again after it. A surface whose slices have not moved
   since its count was written or it was checked is not checked */
/* an interaction's checks (a press's load, a Send) run at once, after a check in flight */
const NOW_CAUSES = ['load', 'send']
function drawnIfMoved($: any, asked: string[] = [], why: string[] = ['?']): void {
  let any = false
  for (const s of ['pane', 'band'] as Site[]) if (!asked.includes(s) && movedSince(s)) { drawGate.want.add(s); any = true }
  if (any) for (const w of why) drawGate.why.add(w)
  if (drawGate.busy || !drawGate.want.size) return
  drawGate.busy = true
  checkStarted()
  void (async () => {
    let again = false
    while (drawGate.want.size) {
      /* a passive cause that came during a check waits for the next gate, one check per gate */
      if (again && ![...drawGate.why].some((w) => NOW_CAUSES.includes(w))) {
        for (const w of drawGate.why) cool.why.add(w)
        drawGate.want.clear()
        drawGate.why.clear()
        cool.check = true
        coolArm($)
        break
      }
      const want = new Set(drawGate.want)
      drawGate.want.clear()
      const causes = [...drawGate.why].map((w) => (again ? 'again ' : '') + w)
      drawGate.why.clear()
      again = true
      for (const s of want) seenAt.set(s, tupleOf(s))
      const moved: Site[] = []
      const t0 = Date.now()
      if (want.has('pane') && await movedWithin($, paneMoved($))) moved.push('pane')
      const t1 = Date.now()
      if (want.has('band') && await movedWithin($, bandMoved($))) moved.push('band')
      const c = lagged.check
      c[0]++; c[1] += t1 - t0; c[2] += Date.now() - t1; c[3] += moved.length
      for (const w of causes) lagged.why[w] = (lagged.why[w] || 0) + 1
      if (moved.length) siteRedraw($, moved)
    }
  })().finally(() => { drawGate.busy = false; checkEnded() }).catch(() => {})
}
/* a check that never settles would hold the gate for good, stopping every later quiet
   redraw; past 5 s it counts as moved */
function movedWithin($: any, check: Promise<boolean>): Promise<boolean> {
  return new Promise((done) => {
    let timer: any
    try { timer = $.clock.after(5000, () => done(true)) } catch {}
    check.then(done, () => done(true)).finally(() => { try { if (timer) timer.cancel() } catch {} })
  })
}
/* a pane closed or opened drops its kept face, so the next check draws it */
function paneForget(id: string): void {
  for (const [k, d] of [...paneFaces]) if (d.e.requestId === id) paneFaces.delete(k)
  for (const k of [...paneKept.keys()]) if (k.endsWith(' ' + id)) paneKept.delete(k)
}
/* a draw that throws is logged, sent with the next band read, and draws that site's
   last good drawing, else throws on */
const keptDraws = new Map<string, any>()
/* ASKERDO_DRAW_FAULT, read at each band load, names the draw sites (a key's start) whose draws throw,
   so this fallback can be made to run on purpose: no builder guard can close it */
const drawFault: { site?: string; ceiling?: number } = {}
async function drawFaultRead($: any): Promise<void> {
  try { const v = await $.env.get('ASKERDO_DRAW_FAULT'); drawFault.site = typeof v === 'string' && v ? v : undefined } catch { drawFault.site = undefined }
  /* ASKERDO_DRAW_CEILING, a fraction under 1, lowers the size ceiling so a rig shoots the give-way on purpose */
  try { const v = Number(await $.env.get('ASKERDO_DRAW_CEILING')); drawFault.ceiling = v > 0 && v < 1 ? v : undefined } catch { drawFault.ceiling = undefined }
}
async function drawKept($: any, key: string, draw: () => any): Promise<any> {
  try {
    if (drawFault.site && key.startsWith(drawFault.site)) throw new Error('ASKERDO_DRAW_FAULT names this site')
    const tree = await draw()
    keptDraws.delete(key)
    keptDraws.set(key, tree)
    if (keptDraws.size > 200) keptDraws.delete(keptDraws.keys().next().value)
    return tree
  } catch (err: any) {
    const text = key + ': ' + String((err && err.message) || err).replace(/\s+/g, ' ')
    /* the same words again only count */
    if (faultAdd(key, text)) { debugLine($, PLUGIN + ': a draw threw, ' + text); faultsSoon($) }
    if (keptDraws.has(key)) return keptDraws.get(key)
    throw err
  }
}
/* each surface's band model at its last render's props compared with what that render drew from; a band
   never asked to draw has not moved, one whose draw never finished has */
async function bandMoved($: any): Promise<boolean> {
  if ([...drawnOn].some((s) => !bandFaces.has(s))) return true
  for (const d of [...bandFaces.values()]) if (bandSig($, d.e, d.live) !== d.sig) return true
  return false
}
/* an open pane's model at its last render's event compared with what that render drew from (no tree
   is built); one not drawn yet has moved. None listed: moved only while a face is kept, since a close drops it */
async function paneMoved($: any): Promise<boolean> {
  const ps = await $.ui.panes()
  const ids = (Array.isArray(ps) ? ps : []).map((p: any) => p && p.id).filter((id: any) => id === PANE_ID || OLD_PANE_IDS.includes(id))
  if (!ids.length) return paneFaces.size > 0
  for (const id of ids) {
    const drawn = [...paneFaces.values()].filter((d) => d.e.requestId === id)
    if (!drawn.length) return true
    for (const d of drawn) {
      if (paneSig(await paneModel($, d.e), d.live) !== d.sig) return true
    }
  }
  return false
}

/* the agents and background tasks as Home, the live lines and the card draw them; a stop refused
   shows on its row in the row's own words */
function inFlight(): { am: any; bm: any } {
  return flown('models', (now) => {
    const am = agentsModel(flightList(), guard.state, now, bgList())
    const bm = backgroundModel(bgList(), now)
    for (const m of [am, bm]) for (const r of (m && m.rows) || []) {
      const s = stops.get(r.id)
      if (s && s.said && !r.done) { r.detail = s.said; r.tone = 'amber'; r.refused = true }
    }
    return { am, bm }
  })
}
/* A model of the flights, built once per flights version, tick and guard until a shown running time
   turns over, so a second's live lines (16 here) share one build; callers never change what it returns */
const flownKept = new Map<string, { key: string; guard: any; until: number; v: any }>()
function flown<T>(name: string, build: (now: number) => T): T {
  const now = Date.now()
  const key = slices.flights + '.' + flights.tick
  const k = flownKept.get(name)
  if (k && k.key === key && k.guard === guard.state && now < k.until) return k.v
  const v = build(now)
  flownKept.set(name, { key, guard: guard.state, until: now + flightTurnIn(now), v })
  return v
}

/* A live line asks for its text each second (agentline.tsx): answered from the flights as Home and the
   agents card draw them, with no pane or band draw; a finished or gone agent's line keeps what it shows */
function liveAnswer($: any, e: any): any {
  liveSets.keep(e)
  const own = liveProps($, e, typeof e.element === 'string' ? e.element : '')
  if (!own) return own
  /* one piece of a drawing asks for every live piece there; the answer carries each one's props and
     names the drawing, so the pieces group by it (agentline.tsx); keep: the asker's own stays as shown */
  const keys = e.data && Array.isArray(e.data.keys) ? e.data.keys.filter((k: any) => typeof k === 'string').slice(0, 200) : null
  const g = e.surface + ' ' + e.component + ' ' + e.requestId
  const mine = own.props ? own.props : { keep: true }
  if (!keys) return own.props ? { props: { ...mine, g } } : own
  const rows: Record<string, any> = {}
  for (const k of keys) {
    const r = k === e.element ? own : liveProps($, e, k)
    if (r && r.props) rows[k] = r.props
  }
  return { props: { ...mine, g, rows } }
}
/* the live pieces' last state sets, kept from their asks for the fault row */
const liveSets = liveSetsBook()
const CARD_SITE: Record<string, string> = { AbovePrompt: 'band', PromptHint: 'hint' }
function liveProps($: any, e: any, key: string): any {
  const row = [AGENT_LINE, CARD_LINE].find((p) => key.startsWith(p))
  if (key !== AGENTS_LINE && key !== AGENTS_COUNT && key !== CARD_COUNT && !row) return null
  /* the count and its card line read the status row's own segment, as the band draws it */
  if (!row && key !== AGENTS_LINE) {
    /* the agents segment reads only the flights, the guard and the clock */
    const s = flown('segment', (now) => agentsSegment(flightList(), guard.state, now, bgList()))
    return s ? { props: key === AGENTS_COUNT ? countLive(s) : partsLive(s) } : {}
  }
  const { am, bm } = inFlight()
  if (!row) {
    if (!am) return {}
    const d = e.component === 'Pane' ? paneFaces.get(e.surface + ' ' + e.requestId) : undefined
    if (!d) return {}
    const desk = d.e.surface === 'desktop' && !!$.ui.resolve(d.e).Svg
    return { props: agentsHeadLive(am, foldOpen($, 'agents'), desk, d.e.props && d.e.props.bodyColumns) }
  }
  const id = key.slice(row.length)
  const desk = e.surface === 'desktop' && !!$.ui.resolve(e).Svg
  /* Home's rows are cut to the pane's width as drawn, the Background fold's lead as it chose, an armed stop's
     words on its line; the card's wrap */
  const d = row === AGENT_LINE && e.component === 'Pane' ? paneFaces.get(e.surface + ' ' + e.requestId) : undefined
  const cols = d ? Number(d.e.props && d.e.props.bodyColumns) || 0 : 0
  const r = [...(am ? am.rows : []), ...(bm ? (d ? bgRows(bm.rows, cols, desk) : bm.rows) : [])].find((x: any) => x.id === id)
  const home = (x: any) => (row === AGENT_LINE ? stopWords(x, { state: stopState, press: () => {} }, desk) : x)
  /* the card's rows fitted to its width as drawn (statusRow) */
  const card = row === CARD_LINE && desk ? cardCells.get(CARD_SITE[e.component] + ' ' + e.surface) || 0 : 0
  return r && !r.done ? { props: agentLive(home(d ? fitRow(r, cols, desk) : card ? cardFit(r, card) : r), desk) } : {}
}
/* a live line's answer carries how far past this wall second it came, so every row's next ask
   lands on the one shared second (agentline.tsx) */
function onSecond(r: any): any {
  return r && r.props ? { props: { ...r.props, phase: secondPhase(Date.now()) } } : r
}
/* a drawing where a live line failed (its component on that surface) draws them as plain text, redrawn each second as before */
const liveFault = new Set<string>()
const liveEls = (els: any, e: any) => (liveFault.has(e.component + ' ' + e.surface) ? { ...els, Client: undefined } : els)

/* The band's answer path, with the card's note; the band's strip records as the band */
async function qpanePick($: any, id: string, letter: string, version?: number, site: PressSite = 'pane'): Promise<void> {
  const note = (qpane.notes[id] || '').trim()
  const r = await pressAnswer($, id, letter, () => recordAnswer($, id, letter, site, note || undefined, undefined, version), site === 'band' ? 'band' : 'pane',
    () => { noteGone(id); return queueDrop($, id, true) })
  if (!r) return
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
  void ownSubmit($, askPrompt(tok)).catch(() => {})
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
      if (r.ok && r.json) { awayFull.set(id, { version: away.version, record: r.json }); qpaneRedraw($, EVERY, 'board') }
    } finally { awayReading.delete(id) }
    return
  }
  const at = (band.questions || []).findIndex((q: any) => q.id === id && q.lean)
  if (at < 0) return
  const r = await cli($, ['show', id, '--json'])
  const qs = band.questions || []
  if (r.ok && r.json && qs[at] && qs[at].id === id) { qs[at] = r.json; qpaneRedraw($, EVERY, 'board') }
}

/* The card's view writes, one set for the pane and the first telling. `where`: what a queued
   answer keeps of its card, with the version a reply's card answers by. */
type CardWhere = { site: PressSite; useId?: string; key?: string; local?: boolean; version?: number }
function cardActions($: any, pick: QuestionsActions['pick'], end: QuestionsActions['end'], where: CardWhere = { site: 'pane' },
  strips: Record<string, string> = qpane.strip as Record<string, string>): QuestionsActions {
  /* a strip's own presses draw where that strip is: the pressed question's cards, the pane first
     when pressed there and else only while its Questions tab shows them; the queue's count redraws the band
     through queueMoved. `was`: a question whose ask mode this press closed */
  const sites = (id: string, was?: string): string[] => {
    if (where.site === 'band') return BAND_VIEW
    const cards = [id, ...(was && was !== id ? [was] : [])].map(qCount)
    return where.useId ? [...cards, ...(view.tab === 'questions' ? ['pane'] : [])] : ['pane', ...cards]
  }
  return {
    /* Answer now, or a press on at once: the strip closes as it records */
    pick: (id, letter, version) => { delete strips[id]; noteSeed(id); pick(id, letter, version) },
    end,
    strip: (id: string, letter?: string) => {
      drawCause('strip', letter ? token(id, letter) : id)
      if (letter) strips[id] = letter
      else delete strips[id]
      noteSeed(id)
      qpaneRedraw($, sites(id))
    },
    queue: (id: string, letter: string, version?: number) => {
      const { version: drawn, ...at } = where
      delete strips[id]
      const rec = questionCards().find((x: any) => x && x.id === id)
      const opt = rec && Array.isArray(rec.options) ? rec.options.find((o: any) => o && o.type === letter) : undefined
      queueSet($, { id, letter, note: (qpane.notes[id] || '').trim(), version: 'version' in where ? drawn : version, ...at,
        ...(rec && rec.name ? { name: String(rec.name) } : {}), ...(opt && opt.option ? { option: String(opt.option) } : {}) })
      noteSeed(id)
      qpaneRedraw($, sites(id))
    },
    unqueue: (id: string) => { delete strips[id]; queueDrop($, id); noteSeed(id); qpaneRedraw($, sites(id)) },
    send: () => { void sendQueued($, undefined, where.site === 'band' ? 'band' : where.useId ? 'cards' : 'pane').catch(() => {}) },
    ask: (id: string, tok: string) => { const was = qpane.asking; qpane.asking = undefined; qpaneAsk($, tok); qpaneRedraw($, sites(id, was)) },
    asking: (id: string) => { const was = qpane.asking; qpane.asking = was === id ? undefined : id; qpaneRedraw($, sites(id, was)) },
    toggle: (tok: string, id?: string) => ringFlip($, tok, id ? sites(id) : ['pane', 'card']),
    note: (id: string, value: string) => { qpane.notes[id] = value; void snapSave($) },
    expand: (id: string) => { qpane.expanded = id; qpaneRedraw($, sites(id)); void fullCard($, id).catch(() => {}) },
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
      if (own.version) laterRedraw($)
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
      if (firstUsage.reading || rates.read) laterRedraw($)
    }).catch(() => {})
  }
  const now = Date.now()
  /* the agents segment as the live lines share it (flown), so the row never builds the agents' model again */
  const segment = flown('segment', (t) => agentsSegment(flightList(), guard.state, t, bgList()))
  const k = statusKept
  if (k.key === tupleOf('hint') + band.loaded && k.guard === guard.state && k.where === where.now && k.segment === segment && now < k.until) return k.m
  const reading = lastReading() || firstUsage.reading
  let m = statusModel({
    reading, main: guard.state && guard.state.main, rates: rates.list, guard: guard.state,
    thread: heldNow(), hand: band.hand,
    shelf: band.shelf, elsewhere: band.elsewhere, asleep: band.asleep, here: { pc: hereNow().pc }, now, segment,
    /* what the track's and task's tooltips read beside them */
    graph: band.graph, handoffs: band.near && band.near.handoffs, questions: band.questions, local: band.local,
    version: ownVersion($), health: healthShown($), bypass: band.near && band.near.bypass,
  })
  /* the AskerDo button's card names the folder and branch too */
  const facts = whereFacts(where.now)
  if (m && m.mark && m.mark.card && facts) m = { ...m, mark: { ...m.mark, card: { ...m.mark.card, where: facts } } }
  Object.assign(k, { key: tupleOf('hint') + band.loaded, guard: guard.state, where: where.now, segment, until: nextSecond(now), m })
  return m
}
/* The status row's model, built once per version of the slices it reads (READS.hint), the guard and the
   folder, and again at the next wall second, where its spans and ages turn over */
const statusKept: { key?: string; guard?: any; where?: any; segment?: any; until: number; m?: any } = { until: 0 }
const nextSecond = (now: number): number => Math.floor(now / 1000) * 1000 + 1000
/* how far into the scheduler's second a time is: the live pieces ask on it as the models turn on it */
const secondPhase = (now: number): number => now - (nextSecond(now) - 1000)

const guardToggle = ($: any) => () => { void guardPress($).catch(() => {}) }

/* At the hint line's end, the meters before the first load too (drawn always). A desktop's
   Code tab has no hint line (the band draws it there) and a cloud session no band, so
   the line draws wherever the app asks for it. */
async function statusDraw($: any, e: any, next: any, m: any = statusOf($)): Promise<any> {
  if (!m) return next(e)
  return handedKeys(statusKeptTree('hint', liveEls($.ui.resolve(e), e), m, await next(e), { columns: e.viewport && e.viewport.columns, surface: e.surface, ...statusPresses($) }), e.surface)
}
/* the status row's segments per site, surface, columns and live flag, built again only when its
   model moved; the frame round them (the app's hint, the two groups) is drawn each time */
const statusRows = new Map<string, { m: any; sig: string; row: StatusRow }>()
/* the agents card's width per site and surface as last drawn, which its rows' answers are fitted to */
const cardCells = new Map<string, number>()
const cardFit = (r: any, cols: number) => fitRow(r, cols, true, false)
/* the card's rows as last fitted at a site, for the drawn tool; none where no card drew rows */
const cardFitOf = (site: string, surface: string) => { const c = cardCells.get(site + ' ' + surface); return c ? (r: any) => cardFit(r, c) : undefined }
function statusKeptTree(site: string, els: any, m: any, hint: any, given: any): any {
  const opts = { ...given, fit: cardFit }
  const at = [site, opts.surface, opts.columns, !!els.Client, !!els.Svg, opts.cards === false].join(' ')
  const k = statusRows.get(at)
  let row = k && k.m === m ? k.row : undefined
  if (!row) {
    /* less what a live row's Clients draw, which turns over by itself */
    const sig = hintSig(m, opts.surface === 'desktop' && !!els.Client)
    if (k && k.sig === sig) { k.m = m; row = k.row } else {
      row = statusRow(els, m, opts)
      statusRows.delete(at)
      statusRows.set(at, { m, sig, row })
      if (statusRows.size > 12) statusRows.delete(statusRows.keys().next().value)
    }
  }
  cardCells.set(site + ' ' + opts.surface, row.card)
  return statusFrame(els, row, hint, opts)
}
/* the status row's model as last drawn per surface, so the flight tick asks a draw only when the row's
   model moved, with no tree built; live: its agents drew as Clients, which turn over by themselves */
const hintFaces = new Map<string, { sig: string; live: boolean }>()
/* the surfaces a hint draw started on: the desktop's Code tab draws none, so nothing there moves */
const hintOn = new Set<string>()
async function hintFace($: any, e: any, next: any): Promise<any> {
  hintOn.add(e.surface)
  const m = statusOf($)
  const tree = await statusDraw($, e, next, m)
  const live = e.surface === 'desktop' && hasKey(tree, AGENTS_COUNT)
  hintFaces.set(e.surface, { sig: hintSig(m, live), live })
  if (m) drawnLast.status = { at: Date.now(), cols: e.viewport && e.viewport.columns, surface: e.surface, site: 'hint', m, tree, fit: cardFitOf('hint', e.surface) }
  return tree
}
async function hintMoved($: any): Promise<boolean> {
  if ([...hintOn].some((s) => !hintFaces.has(s))) return true
  if (!hintFaces.size) return false
  const m = statusOf($)
  for (const d of [...hintFaces.values()]) if (hintSig(m, d.live) !== d.sig) return true
  return false
}
/* the model less what a live surface draws inside its agents' Clients (status.tsx: the count, the card's
   count line and each running row); the card's width is fixed while it has rows */
function hintSig(m: any, live: boolean): string {
  if (!m || !live || !Array.isArray(m.segments)) return JSON.stringify(m)
  const frame = (s: any) => {
    const c = s.card
    const rows = c && Array.isArray(c.rows) && c.rows.length ? c.rows : null
    return { ...s, text: undefined, tone: undefined, tip: undefined, pic: s.pic && { ...s.pic, labelTone: undefined },
      card: c && (rows ? { ...c, parts: undefined, rows: rows.map((r: any) => (r.done ? r : { id: r.id, under: r.under })) } : c) }
  }
  return JSON.stringify({ ...m, segments: m.segments.map((s: any) => (s && s.key === 'agents' ? frame(s) : s)) })
}

/* ---- tools ------------------------------------------------------------- */

async function askTool($: any, input: any, useId?: string): Promise<any> {
  const v = validateAsk(input)
  if (v.error) return { deny: 'ask refused: ' + v.error }
  const sid = await sessionId($)
  if (v.payload.edits && isLocalId(v.payload.edits)) return localReword($, sid, v.payload, useId)
  if (v.payload.edits) return rewordAsk($, sid, v.payload, useId)
  await boundTrack($, sid)
  /* a session not engaged keeps its question; asking engages nothing. So does a spare */
  if (!(await isEngaged($)) || isSpare(await projectDir($))) return localAsk($, sid, v.payload, useId)
  const payload = await boardPayload($, sid, await boundTrack($, sid, true), v.payload)
  const r = await cli($, ['register', '--json'], JSON.stringify(payload))
  if (!r.ok) return { deny: failed('ask', r) }
  if (useId && r.json && r.json.id) {
    const reverses = r.json.reverses ? { reverses: r.json.reverses, blocking: true } : {}
    /* the card's head reads the registered ask, its tokens numbered */
    await keepTold($, useId, { ...payload, ...reverses, id: r.json.id, key: r.json.key, name: r.json.name || payload.name, ask: r.json.ask || payload.ask, boardUrl: r.json.boardUrl, workstream: r.json.workstream || payload.workstream })
  }
  kick($, true)
  const letters = (payload.options || []).map((o: any) => o.type).filter((t: string) => /^[a-z]$/.test(t))
  return { result: askResult(r.json, { letters, pick: payload.pick, block: tellBlock({ ...payload, id: r.json.id, name: r.json.name || payload.name, reverses: r.json.reverses }, letters) }) }
}

/* `edits` rewords an open question in place through the CLI, keeping its id.
   It names a board question, so it engages; its earlier tellings go to their changed stub at
   once, and this reply tells the new wording as a first telling does. */
async function rewordAsk($: any, sid: string, raw: any, useId?: string): Promise<any> {
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
    await keepTold($, useId, { ...payload, ...reverses, id: j.id, key: j.key, name: j.name || payload.name,
      ask: j.ask || payload.ask, boardUrl: j.boardUrl, version: j.version, reworded: now.reworded })
    laterRedraw($)
  }
  kick($, true)
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

/* an override request, one round trip like ask; the reply tells its block,
   which the desktop draws as the card under it */
async function overrideTool($: any, input: any, useId?: string): Promise<any> {
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
  kick($, true)
  return { result: overrideResult(o) }
}

/* the card's press saving, by its telling */
const ovPressing = new Map<string, string>()

/* The act (Withdraw, Fix, Scrub) or Keep on the card: the band's press path, as the user's act in the asking session, so its
   turn starts carrying the result; the band's row for the request hides with it */
async function overridePress($: any, useId: string, o: any, decision: string): Promise<void> {
  if (ovPressing.has(useId) || (o.decided && o.decided !== 'changed')) return
  ovPressing.set(useId, decision)
  qpaneRedraw($)
  const row = listOf(band.model && band.model.calls).find((c: any) => c && c.kind === 'override' && String(c.key).startsWith('override:#' + o.request + '@'))
  const c = { key: row ? row.key : 'override:#' + o.request, id: overrideOn(o), mine: true }
  const p = { label: decision === 'allow' ? actLabel(o.kind) : 'Keep', verb: 'overrideDecide', input: { request: o.request, decision } }
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
  if (moved) laterRedraw($)
}

/* a rewrite the board dropped exits non-zero with the result on stdout: the note itself landed */
function noteLanded(r: Run): any {
  if (!/did not amend/.test(r.err)) return null
  try { return JSON.parse(r.out) } catch { return null }
}

async function noteTool($: any, input: any): Promise<any> {
  if (!input || !isRecordId(input.id) || /^Q\d/.test(input.id)) return { deny: 'note refused: id is WS-n, T-n, TR-n or K-n; a remark about a question goes on the decision that answers it or the task it gates' }
  if (typeof input.body !== 'string' || !input.body.trim()) return { deny: 'note refused: body is required' }
  const texts: string[] = []
  for (const f of ['name', 'description', 'intent', 'goal']) {
    if (input[f] === undefined) continue
    if (typeof input[f] !== 'string' || !input[f].trim()) return { deny: 'note refused: ' + f + ' is text' }
    texts.push('--' + f, input[f])
  }
  const r = await cli($, ['note', input.id, ...texts, '--session', await sessionId($), '--json'], input.body)
  const j = r.ok ? r.json || {} : noteLanded(r)
  if (!j) return { deny: failed('note', r) }
  const offer = rewriteOffer(j, input.body, true)
  const dropped = droppedTexts(j, input)
  const copied = copiedWords(j)
  const title = titleLine(j, true)
  /* read only after the write; the task's read is the one leftFlags would make */
  const shown = /^T-\d+$/.test(input.id) ? cli($, ['show', input.id, '--json']) : null
  const waits = /^TR?-\d+$/.test(input.id) ? await inTime($, noteHeld($, input.id, shown).catch(() => ''), HOLDER_MS, '') : ''
  return { result: 'Noted on ' + input.id + amendedWords(j) + '.' + (copied ? ' ' + copied : '') + (waits ? '\n' + waits : '') + (title ? '\n' + title : '') + (offer ? '\n' + offer : '')
    + (dropped.length ? '\n' + droppedWords(input.id, dropped, true) : ''), copied: Array.isArray(j.copied) ? j.copied : null, shown }
}

/* a read slower than this leaves the answer as it was */
const HOLDER_MS = 3000
function inTime<T>($: any, p: Promise<T>, ms: number, late: T): Promise<T> {
  let timer: any
  const t = new Promise<T>((done) => { try { timer = $.clock.after(ms, () => done(late)) } catch {} })
  return Promise.race([p, t]).finally(() => { try { if (timer) timer.cancel() } catch {} })
}

/* the band of another session holding the noted task or track, from the local
   cache; '' when this session or one of its ids before a /clear holds it, or nobody does */
async function noteHeld($: any, id: string, shown: Promise<Run> | null): Promise<string> {
  const own = [await sessionId($), ...mem.lineage]
  const g = band.graph
  let tracks: any[] = g && g.view && Array.isArray(g.view.tracks) ? g.view.tracks : []
  let task: any = null
  if (shown) {
    const r = await shown
    task = r.ok && r.json ? r.json : null
    const ws = task && task.workstream
    if (ws && (!g || g.workstream !== ws)) {
      const far = await localGet($, 'graph/' + encodeURIComponent(ws))
      tracks = far && far.view && Array.isArray(far.view.tracks) ? far.view.tracks : []
    }
  } else if (!tracks.some((t: any) => t && t.id === id)) {
    const r = await cli($, ['track', 'show', id, '--json'])
    tracks = r.ok && r.json && r.json.holder ? [{ id, holder: r.json.holder }] : []
  }
  return noteWaits(noteHolder(id, task, tracks, own), nameOf())
}

/* a close, or a closed task's note, naming something left with no leftover filed gets one
   line, never a block, once per record per loop of a session; a note's task status is one read */
const leftTold = new Set<string>()
async function leftFlags($: any, e: any, copied?: string[] | null, shown?: Promise<Run> | null, waits?: boolean): Promise<string[]> {
  const out: string[] = []
  for (const hit of leftCalls(e.tool, toolInput(e), copied)) {
    const k = (await sessionId($)) + ' ' + (e.agentId || 'main') + ' ' + hit.id
    if (leftTold.has(k)) continue
    const task = hit.kind === 'note' && /^T-\d+$/.test(hit.id)
    const r = task ? await (shown || cli($, ['show', hit.id, '--json'])) : null
    /* an agent files nothing, so an open record's note nudges only the main loop */
    const held = e.agentId !== undefined || (task && !hit.closedOnly && (waits ?? await heldWait($, hit.id).catch(() => false)))
    const words = leftNote(hit, r && r.ok && r.json ? r.json.status : undefined, held)
    if (!words) continue
    leftTold.add(k)
    out.push(words)
  }
  return out
}
/* a task whose ended run is kept unsettled is one the stop asks a why-it-waits note on */
async function heldWait($: any, id: string): Promise<boolean> {
  const mine = [...new Set([await sessionId($), ...runTick.sids])].filter(Boolean)
  return (await Promise.all(mine.map((s) => unsettledRead($, s)))).some((l) => l.some((x) => x.tasks.includes(id)))
}
/* the typed tools say it on their result; a shell call's rides its result's context, as a procedure pointer does */
/* `r.copied`: the ids the board copied a note's handed sentences onto, so a sentence it did not copy stays flagged */
async function withLeft($: any, e: any, r: any, waits?: boolean): Promise<any> {
  if (!r || r.deny || typeof r.result !== 'string') return r
  const { copied, shown, ...out } = r
  const lines = await leftFlags($, e, copied, shown, waits).catch(() => [] as string[])
  return lines.length ? { ...out, result: out.result + '\n' + lines.join('\n') } : out
}
/* an answer the user typed, recorded by the session: a kept label in the mod's store, a
   board question (or a label filed since) on the board with this session's id, kept out of its telling */
/* the user's own messages (typed or from the bridge), kept for the placement answer check */
const userWords: { at: number; text: string }[] = []
function userSaid(e: any): void {
  const kind = e.origin && e.origin.kind
  if (e.isMeta || (e.origin && e.origin.asUser === true) || !(!kind || kind === 'composer' || kind === 'bridge')) return
  userWords.push({ at: Date.now(), text: String(e.text || '').slice(0, 4000) })
  if (userWords.length > 40) userWords.shift()
}
const isPlacement = (q: any) => !!q && ((Array.isArray(q.labels) && q.labels.includes('placement')) || !!q.placement)
/* a go question frees a session's placement, so like a placement question only the user answers it */
const isGo = (q: any) => !!q && typeof q.goOption === 'string' && !!q.goOption
const usersAlone = (q: any) => isPlacement(q) || isGo(q)
const keptGo = (q: any) => Array.isArray(q.payload && q.payload.options) && q.payload.options.some((o: any) => o && o.go === true)
const GO_ASKS = 'whether this session may file and move work across tracks'
const asksWhat = (q: any) => (isGo(q) ? GO_ASKS : 'where found work goes')
const notNamed = (id: string, n: string, what: string) => 'answer refused: ' + id + ' asks ' + nameOf() + ' ' + what + ', and no message of theirs since it was asked names it. '
  + 'Have them press its card or the band, or type its token (' + n + 'a, ' + n + 'b and on) in chat; then record what they typed.'
const userNamed = (q: any, label: string) => {
  const since = Date.parse(String(q.created || '')) || 0
  const letters = (Array.isArray(q.options) ? q.options : []).map((o: any) => o && o.type)
  return userWords.some((w) => w.at >= since - 1000 && namesQuestion(w.text, q.id, label, letters))
}
/* a shell answer or drop of a placement question, read from the board; one it cannot read (down, unknown) passes to the board */
async function shellPlacementAnswer($: any, cmd: string): Promise<string> {
  for (const id of hubAnswers(cmd)) {
    if (!id || /[$`%]/.test(id)) return 'refused: name the question this answer or drop records by its number, so AskerDo can tell whether it is ' + nameOf() + '\'s alone. Carry on with the work in hand.'
    const q = await cli($, ['show', id, '--json']).catch(() => null)
    if (q && q.ok && usersAlone(q.json)) return placementOnly(String(q.json.id || id), asksWhat(q.json))
  }
  return ''
}

async function answerTool($: any, input: any): Promise<any> {
  const a = answerArgs(input)
  if (a.error) return { deny: 'answer refused: ' + a.error }
  let id = a.id
  let shown = a.id
  if (isLocalId(a.id)) {
    /* a kept go files with the user's mark, so the session records only what their message named */
    const kept = (await localRead($, await sessionId($))).qs.find((x) => x.label === a.id)
    if (kept && keptGo(kept) && !userNamed(localCard(kept, ''), a.id)) return { deny: notNamed(a.id, a.id, GO_ASKS) }
    const r = await localAnswer($, a.id, a.letter, a.note, null, a.drop, true)
    if (!r.filed) return r.ok ? { result: r.text } : { deny: 'answer refused: ' + r.text }
    id = r.filed.key || r.filed.id
    shown = r.filed.id
  }
  mem.engaged = true
  /* a placement question takes the answer only when the user's own message since it was asked names it */
  const q = await cli($, ['show', id, '--json']).catch(() => null)
  if (q && q.ok && usersAlone(q.json) && !userNamed(q.json, a.id)) {
    return { deny: notNamed(String(q.json.id || shown), String(q.json.id || shown).replace(/^Q/, ''), asksWhat(q.json)) }
  }
  const sid = await sessionId($)
  const argv = a.drop ? ['drop', id] : ['answer', id, ...(a.letter ? ['--pick', a.letter] : [])]
  if (a.note) argv.push('--note', a.note)
  /* the board takes a placement answer only with the user's mark, sent once their message named it */
  const placing = !!(q && q.ok && usersAlone(q.json))
  const r = await queued(() => cli($, [...argv, placing ? '--user' : '--session', sid, '--json']))
  if (!r.ok) return { deny: failed((a.drop ? 'Dropping ' : 'Answering ') + shown, r) }
  const label = (r.json && r.json.id) || shown
  if (placing) {
    toolTold.push({ id: label, kind: a.drop ? 'drop' : 'answer' })
    if (toolTold.length > 20) toolTold.shift()
  }
  kick($, true)
  const name = r.json && r.json.name ? ' (' + r.json.name + ')' : ''
  /* the inbox line the user mark sends here is not told again, so the result carries what the answer did */
  const placed = placing && isPlacement(q.json) ? toolPlaced(label, (r.json && r.json.name) || q.json.name, a.drop ? { outcome: 'drop' } : (r.json && r.json.placement) || {}, q.json.placement) : ''
  if (a.drop) return { result: 'Dropped ' + label + name + (a.note ? ': ' + a.note : '') + '.' + placed }
  return { result: 'Answered ' + label + name + ': ' + (a.letter ? token(label, a.letter) + '.' + (a.note ? ' Note: ' + a.note : '') : a.note) + placed }
}
/* placement answers the answer tool sent with the user's mark, whose inbox lines its result already told */
const toolTold: { id: string; kind: string }[] = []
const toldByTool = (e: any) => !!(e && e.raw && e.raw.amended !== true && /^user:/.test(String(e.raw.by || ''))
  && toolTold.some((t) => t.id === e.raw.id && t.kind === e.raw.kind))
/* what a placement answer did, in placedRelay's words, from the answer's result and the question's placement */
function toolPlaced(id: string, name: string, got: any, p: any): string {
  const how = p && p.task ? 'moved' : got.outcome === 'asked' && p && p.asked && p.asked.onto ? 'step' : undefined
  const said = placedRelay({ raw: { id, name, outcome: got.outcome, created: got.created, how } })
  return said ? ' ' + said : ''
}

/* one call records a ruling with its links; the watcher reads the triggers again */
async function decideTool($: any, input: any): Promise<any> {
  const d = decideArgs(input)
  if (d.error) return { deny: 'decide refused: ' + d.error }
  /* files and commands both left out take the main loop's commands this turn, never its edited files */
  const t = d.payload.files === undefined && d.payload.commands === undefined ? turnCommands(current.steps.map((s) => s.call)) : []
  if (t.length) d.payload.commands = t
  const r = await cli($, ['decide', '--session', await sessionId($), '--json'], JSON.stringify(d.payload))
  if (!r.ok) return { deny: failed('decide', r) }
  decs.stale = true
  void decisionRows($).catch(() => {})
  // an answer it recorded moves the question off the band now, not at the next poll
  if (r.json && r.json.answered) kick($, true)
  return { result: decidedText({ ...(r.json || {}), proposed: t.length > 0 }) }
}

/* a fact in one call, through knowledge new; the board fills the workstream from the track this session holds */
async function factTool($: any, input: any): Promise<any> {
  const f = factArgs(input)
  if (f.error) return { deny: 'fact refused: ' + f.error }
  const r = await cli($, [...f.args, '--session', await sessionId($), '--json'], f.body)
  if (!r.ok) return { deny: failed('fact', r) }
  /* one with files joins the triggers a call's pointer reads */
  if (f.args.includes('--file')) decs.stale = true
  const j = r.json || {}
  return { result: (j.id || 'The fact') + ' recorded: ' + flatWords(String(j.name || input.title)).slice(0, 200) + '.' + (j.boardUrl ? ' ' + j.boardUrl : '') }
}

/* The session ends its own open agent run on a task, one whose agent went silent,
   as that run's session (this id or an earlier one of this process); another session's run moves only by a take-over */
async function ownRunEnd($: any, id: string, how: string, sid: string): Promise<{ deny?: string; said?: string }> {
  const r = await localVerb($, 'taskRuns', { input: { task: id }, session: sid })
  if (!r.ok) return { deny: 'task_update refused: the board did not read ' + id + '\'s runs (' + flatWords(String(r.error || 'no answer')).slice(0, 200) + '). Nothing was ended.' }
  const open = (r.result && Array.isArray(r.result.runs) ? r.result.runs : []).filter((x: any) => x && !x.ended && x.worker === 'agent')
  const mine = open.find((x: any) => x.session === sid || runTick.sids.has(String(x.session)))
  if (!mine) {
    const other = open[0]
    return { deny: 'task_update refused: ' + id + (other ? ' has no open agent run of this session; run ' + other.run + ' (agent ' + flatWords(String(other.job || 'with no job name')).slice(0, 80)
      + ') is another session\'s and moves only by a take-over on ' + nameOf() + '\'s word' : ' has no open agent run to end') + '. Nothing was ended.' }
  }
  const e = await localVerb($, 'endRun', { input: { run: mine.run, how }, session: mine.session })
  if (!e.ok) return { deny: 'task_update refused: ' + flatWords(String(e.error || 'the board did not end run ' + mine.run)).slice(0, 300) + '. Nothing was ended.' }
  runTick.open = runTick.open.filter((x: any) => !(x && x.run === mine.run))
  if (e.result && e.result.run) { runTick.ended.push(e.result.run); if (runTick.ended.length > RUN_ENDED_KEPT) runTick.ended.shift() }
  kick($, true)
  return { said: 'ended run ' + mine.run + ' (agent ' + flatWords(String(mine.job || '')).slice(0, 80) + ') ' + how.replace('_', ' ') + '; ' + id + ' stays open' }
}

async function taskTool($: any, input: any, agentId?: string, useId?: string): Promise<any> {
  const t = taskEditArgs(input)
  if (t.error) return { deny: 'task_update refused: ' + t.error }
  const sid = await sessionId($)
  const own = t.runEnded ? await ownRunEnd($, t.id, t.runEnded, sid) : null
  if (own && own.deny) return own
  if (own && !t.args.length) return { result: own.said }
  /* one board call; starting goes by the track's order, so a task not ready needs a reason */
  const r = await cli($, ['task', 'update', t.id, ...t.args, '--session', sid, '--json'], t.stdin)
  const j = r.ok ? r.json || {} : noteLanded(r)
  if (!j) {
    /* a leftover the ladder refused carries the call that fits, worded in the tool's fields */
    const said = placeRefusal(r.out, 'task_update', true)
    if (said && agentId === undefined) refusedNow('the leftovers of ' + t.id + "'s close", said.call)
    return { deny: said ? said.deny + ' Nothing was filed or closed.' : failed('task_update', r) }
  }
  /* the board's `hand` says a take or a let-go in words, as the CLI words it, and where each leftover of a close went */
  /* an asked move has no destination yet: its card and block follow under Step n */
  const moved = Array.isArray(j.moves) && j.moves.length ? 'moved ' + j.moves.map((m: any) => m.asked ? 'step ' + m.check + ' asked as ' + (m.asked.id || 'a question') : 'step ' + m.check + ' to ' + m.to + (m.step ? ' step ' + m.step : '')
    + (m.track ? ' on ' + m.track : '') + (m.inbox ? ' in the inbox' : '')).join(', ') : ''
  const said = [own ? own.said : '', moved,
    j.edit ? editWords({ ...j.edit, hand: j.edit.hand || j.hand }, ' unchanged') + (j.leftovers ? '; ' + filedWords(j.leftovers) : '') : '',
    j.note ? 'noted on ' + t.id + amendedWords(j.note) : ''].filter(Boolean)
  /* the checklist after its checks, and where a note's "left for T-n" sentences were copied */
  const tail = [checksWords(j), j.note ? copiedWords(j.note) : '', j.note ? titleLine(j.note, true) : ''].filter(Boolean)
  const offer = j.note ? rewriteOffer(j.note, input.note, true) : ''
  const dropped = j.note ? droppedTexts(j.note, input) : []
  // a start, status or hand change moves the track's now set and the task the rules are read for
  rules.loading = undefined
  kick($, true)
  /* a take or a start brings the task's block, rulings with their words in it */
  const held = typeof j.block === 'string' ? j.block : ''
  const asked = agentId === undefined ? await stepsAsked($, j.steps, useId) : ''
  /* only a note's sentences are copied: a close with no note copied nothing */
  return { result: (said.join('; ') || t.id + ' unchanged') + (tail.length ? '\n' + tail.join('\n') : '') + (held ? '\n' + held : '') + (offer ? '\n' + offer : '')
    + (dropped.length ? '\n' + droppedWords(t.id, dropped, true) : '') + (asked ? '\n' + asked : ''), copied: j.note ? (Array.isArray(j.note.copied) ? j.note.copied : null) : [] }
}

/* the placement question a filing's result carries ({ asked }), on stdout either way */
function askedOf(r: Run): any {
  let j: any = r.json
  if (!j) { try { j = JSON.parse(r.out) } catch {} }
  /* a third wake through task edit answers under placed, waits set when its question is already out */
  const a = j && (j.asked || (j.placed && j.placed.asked))
  if (!a || typeof a !== 'object' || !a.id) return null
  return j.asked ? a : { ...a, wake: j.placed.waits ? 'waits' : 'asked' }
}

/* a filing the board asked about keeps its question's card under the call, as ask's does,
   and answers with the block to paste; register returns no options, so the question is read for them */
/* the go path rides a session's first asked filing */
const pathTold = new Set<string>()
async function placementTold($: any, given: any, useId?: string, work = 'it'): Promise<string> {
  const { wake, path, ...asked } = given
  const sid = await sessionId($).catch(() => mem.id || '')
  const way = typeof path === 'string' && path && !pathTold.has(sid) ? path.trim() + ' ' : ''
  if (way) pathTold.add(sid)
  let q: any = asked
  if (!Array.isArray(q.options)) {
    const s = await cli($, ['show', q.key || q.id, '--json']).catch(() => null)
    if (s && s.ok && s.json && Array.isArray(s.json.options)) q = { ...s.json, ...asked }
  }
  if (useId) {
    await keepTold($, useId, { ...q, id: asked.id, key: asked.key, name: asked.name || q.name, ask: asked.ask || q.ask })
    if (told.has(useId)) thisTurn().asks.push(useId)
  }
  kick($, true)
  const letters = (Array.isArray(q.options) ? q.options : []).map((o: any) => o && o.type).filter((t: string) => /^[a-z]$/.test(t || ''))
  return (wake ? work + ' was woken twice in this inbox stay, so the board stored no third wake: ' + nameOf() + ' is asked where it goes, and it waits on their press. '
    : 'Nothing was created: ' + nameOf() + ' is asked where it goes, and their press creates it or not. ')
    + way + askResult(q, { letters, pick: q.pick, block: tellBlock(q, letters) })
}

/* each asked step of a close, a move or a handoff keeps its own card, `<tool_use_id>#<step>` */
async function stepsAsked($: any, steps: any, useId?: string): Promise<string> {
  const out: string[] = []
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || !s.asked || !s.asked.id) continue
    out.push('Step ' + s.step + ': ' + await placementTold($, s.asked, useId ? useId + '#' + s.step : undefined))
  }
  if (out.length) landedNow()
  return out.join('\n\n')
}

/* found work filed by its tier through task create or task edit; the result says where the ladder put it */
async function placeTool($: any, input: any, useId?: string): Promise<any> {
  const p: any = placeArgs(input)
  if (p.error) {
    const work = input && typeof (input.task || input.name) === 'string' ? String(input.task || input.name).trim() : 'the work'
    refusedNow(work, 'place with what the refusal names')
    return { deny: 'place refused: ' + p.error }
  }
  const sid = await sessionId($)
  const r = await cli($, [...p.argv, '--session', sid, '--json'], p.stdin)
  const asked = askedOf(r)
  if (asked) {
    landedNow(p.work)
    /* its question already went to the user: told once, so no second card */
    if (asked.wake === 'waits') return { result: p.work + ' already waits on the answer to ' + asked.id + ', which went to ' + nameOf() + ': no new wake until it comes.' }
    return { result: await placementTold($, asked, useId, p.work) }
  }
  if (!r.ok) {
    const said = placeRefusal(r.out)
    refusedNow(p.work, said ? said.call : 'place with what the refusal names')
    return { deny: said ? said.deny : failed('place', r) }
  }
  const j = r.json || {}
  /* a create takes no runBy, so it rides an edit of the new task */
  let run = ''
  if (p.runBy && j.id) {
    const b = await cli($, ['task', 'edit', j.id, '--run-by', p.runBy, '--session', sid, '--json'])
    if (!b.ok) run = '\nIts runBy was not set: ' + failed('task edit --run-by', b)
  }
  landedNow(p.work)
  kick($, true)
  return { result: placedWords(j) + run }
}

/* the engine's own reading as the band shows it; nothing is written */
/* a session records what a review read, and reads the coverage, without the CLI */
async function coverageTool($: any, name: string, input: any): Promise<any> {
  const a = name === 'review_covers' ? reviewCoversArgs(input) : coverageArgs(input)
  if (a.error) return { deny: name + ' refused: ' + a.error }
  const r = await cli($, [...a.args, '--session', await sessionId($)])
  if (!r.ok) return { deny: failed(name, r) }
  return { result: r.out.trim() }
}

async function depthTool($: any, input: any): Promise<any> {
  let reading: any = lastReading()
  if (!reading) { try { reading = depthReading(((await $.session.usage()) || {}).context) } catch {} }
  /* the marks come from the profiles the band's load reads */
  if (guard.state === undefined) await refresh($).catch(() => {})
  const told = await toldMarks($, await sessionId($))
  const main = guard.state && guard.state.main
  const why = input && typeof input.why === 'string' ? input.why.trim() : ''
  /* a read before the first note is logged with its reason, for the timings */
  if (why && !told.length && !(main && main.on === false) && lagged.depths.length < 20) lagged.depths.push({ p: reading ? wholePercent(reading) : -1, w: why.slice(0, 80) })
  return { result: depthAnswer({ reading, main, told, why }) }
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

/* the leftovers the board laid out, each with what it waits on; one on a new parked track names it */
function laidOutNote(steps: any, track: string, parked?: any): string {
  if (!Array.isArray(steps) || !steps.length) return ''
  const later = (Array.isArray(parked) ? parked : []).map((p: any) => p.id + ' ' + p.name + ' parked' + (p.unpark ? ', opens ' + p.unpark : ''))
  return 'Laid out on ' + track + ': ' + steps.map((s: any) => s.id + ' ' + s.name + (s.created ? '' : ' (already there)')
    + (s.tier !== undefined ? ', tier ' + s.tier : '')
    + (s.track ? ', on ' + s.track : '')
    + (s.runBy ? ', run by ' + s.runBy : '')
    + (s.edges && s.edges.length ? ', after ' + s.edges.map((e: any) => e.on).join(', ') : '')
    + (s.before && s.before.length ? ', before ' + s.before.map((e: any) => e.task).join(', ') : '')).join('; ') + '.'
    + (later.length ? ' New track' + (later.length > 1 ? 's' : '') + ': ' + later.join('; ') + '.' : '')
}

/* a run that may have written: the route's late or dropped answer, a failed server call, a killed CLI */
const mayHaveRun = (r: Run): boolean => !!r.late || /it may have run/.test(r.err) || !Number.isInteger(r.code) || r.code < 0

/* this session's handoff on the track with this focus, written since `since` (5 s for clock skew),
   asked of the board now and once more 5 s later, with whether the session still holds the track; null when none shows */
async function handoffLanded($: any, track: string, sid: string, since: number, focus: string): Promise<any> {
  for (const wait of [0, 5000]) {
    if (wait) await new Promise((ok) => { try { $.clock.after(wait, () => ok(null)) } catch { ok(null) } })
    const t = await cli($, ['track', 'show', track, '--json'])
    const list = t.ok && t.json && Array.isArray(t.json.handoffs) ? t.json.handoffs : []
    const h = list.filter((x: any) => x && x.fromSession === sid && String(x.focus || '').trim() === String(focus || '').trim()
      && Date.parse(x.created) >= since - 5000).pop()
    if (!h) continue
    const m = await cli($, ['track', 'mine', '--session', sid, '--json'])
    /* the verify lines this PC worded at the write, kept beside its lists */
    const full = await cli($, ['track', 'show', h.id, '--json'])
    const lines = full.ok && full.json ? { ...(full.json.gitLine ? { gitLine: full.json.gitLine } : {}), ...(full.json.keptLine ? { keptLine: full.json.keptLine } : {}) } : {}
    return { id: h.id, status: h.status, created: h.created, track, released: m.ok && !(m.json.held && m.json.track === track), ...lines }
  }
  return null
}

/* what a handoff write gets while the session's work runs, from the tool or the shell;
   the session's own arms the landing note */
function handoffHeld(list: any[], agentId?: string): string {
  const names = runningNames(list)
  let noted = false
  let untracked: any[] = []
  if (agentId === undefined) {
    const mine = (x: any) => flight.has(x.id) || bgTasks.has(x.id)
    const ids = list.filter(mine).map((x) => x.id)
    untracked = list.filter((x) => !mine(x))
    /* the note comes after they land, so it names them without the time they had now */
    if (ids.length) { landing.ids = ids; landing.jobs = runningNames(list.filter(mine), null); noted = true }
  }
  /* only work the mod tracks lands a note; an agent known only from the engine's list never does */
  const note = !noted ? 'No note comes when they land: call handoff_write again once each has ended; it answers this way while any still runs. '
    : untracked.length ? 'A note comes when the ones this session tracks have landed (' + landing.jobs + '); ' + runningNames(untracked, null)
      + ' this session does not track, so no note comes for ' + (untracked.length === 1 ? 'it' : 'them') + ': call handoff_write again once each has ended. '
    : 'A note comes when the last has landed. '
  return 'Nothing was written: the handoff waits for the work this session started, still running: ' + names + '. '
    + 'Let each land and check what it left, then call handoff_write again with the state brought up to date; that write gives the resume block. '
    + note
    + 'To hand off at once, ' + nameOf() + ' presses Stop on an agent\'s row in the AskerDo pane; a stopped agent counts as landed. '
    + 'Until then the track stays with this session, and the reply gives no resume command.'
}
/* a main loop shell call whose CLI `handoff write` names the held track while work runs: the
   tool's answer, and the call does not run; '' lets it run (nothing runs, another track, no list) */
async function shellHandoffHeld($: any, e: any): Promise<string> {
  if (e.agentId !== undefined) return ''
  const tracks = handoffWrites(toolInput(e).command)
  if (!tracks.length) return ''
  const held = await boundTrack($).catch(() => null)
  if (!held || !tracks.includes(String(held).toUpperCase())) return ''
  const fly = await handoffWaits($)
  if (!fly.list.length) return ''
  /* the whole command is held, so a step beside the write must be run again */
  return (handoffOthers(toolInput(e).command) ? 'None of this command ran, its other steps included: run them again. ' : '') + handoffHeld(fly.list)
}

async function handoffTool($: any, input: any, agentId?: string, useId?: string): Promise<any> {
  const v = validateHandoff(input, { version: ownVersion($) })
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
    main: guard.state && guard.state.main, told, asked: marks.asked || v.asked })
  if (!gate.open) return { deny: gate.deny }
  /* an ask in chat counts as /askerdo handoff, so the reply check agrees */
  if (v.asked && !marks.asked) await handoffAsked($, sid)
  /* while the session's agents or workflows run nothing is written and no resume
     block is given: an answer, never a refusal, so the model waits rather than routes around it */
  const fly = await handoffWaits($, agentId)
  if (fly.list.length) return { result: handoffHeld(fly.list, agentId) }
  const unchecked = fly.checked ? '' : '\nThe check for running agents could not run (the engine\'s agent list did not answer), so this was written without it.'
  /* a session holding no track starts one from the focus, in the workstream named */
  let started = ''
  let key = track === held ? mem.trackKey : null
  let name = track === held && band.mine && band.mine.held ? band.mine.name : ''
  let ws = track === held && band.mine && band.mine.held ? band.mine.workstream : v.workstream
  if (!track) {
    if (!v.workstream) return { deny: 'handoff_write refused: this session holds no track; name the track (track: TR-n) or the workstream to start one in (workstream: WS-n)' }
    name = threadNameOf(payload.focus)
    const n = await cli($, ['track', 'new', '--workstream', v.workstream, '--name', name, '--goal', payload.goal || payload.focus, '--session', sid, '--json'])
    if (!n.ok) return unwritten(agentId, failed('Starting a track for the handoff', n), { workstream: v.workstream, ...v.payload })
    track = n.json.id as string
    key = n.json.key || null
    setTrack(track, key)
    started = 'Started ' + track + ' ' + name + ' in ' + v.workstream + '. '
  }
  const wasHeld = track === mem.track
  if (wasHeld) lettingGo(track)
  const began = Date.now()
  let r = await cli($, ['handoff', 'write', track as string, '--session', sid, '--json'], JSON.stringify(payload))
  /* a call the route lost may have landed, so the board is asked before anything is dropped or written again */
  let readBack = false
  if (!r.ok && mayHaveRun(r)) {
    const h = await handoffLanded($, track as string, sid, began, payload.focus)
    if (h) {
      r = { ...r, ok: true, json: h }
      readBack = true
    } else {
      keptHold(track)
      if (started) kick($, true)
      return unwritten(agentId, failed('handoff_write', r), { track, ...v.payload }, 'The board shows no handoff from this session on ' + track
        + ' since the call began, but the call may still land: run `askerdo track show ' + track + '` before writing it again.'
        + (started ? ' ' + track + ', started for it, stays with this session, so a second write lands on it.' : ''))
    }
  }
  if (!r.ok) {
    keptHold(track)
    /* the board answered no (server/verbs/handoffs.mjs REFUSED), so nothing was written and
       nothing needs carrying; a track started for it stays held, so the next send lands on it */
    if (/the board refused this handoff and wrote nothing/.test(r.err)) {
      if (started) kick($, true)
      /* a leftover the ladder refused carries the call that fits, worded as that step's own fields */
      const said = placeRefusal(r.out, 'handoff_write', true)
      return { deny: (said ? said.deny.replace(/^handoff_write refused: /, 'handoff_write: ') : 'handoff_write: ' + r.err.replace(/[.\s]+$/, '') + '.') + '\nFix what it names (a leftover: that step) and call handoff_write again; '
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
    kick($, true)
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
    laterRedraw($)
  }
  toast($, 'Handoff ' + r.json.id + ' written (' + r.json.status + ') on ' + track + '.', 'press')
  const percent = payload.depthAtHandoff ? payload.depthAtHandoff.percent : undefined
  const id = track as string
  void (async () => {
    await sendAlert($, handoffAlert({ name, track: id, id: r.json.id, percent, focus: payload.focus, names: await alertNames($, ws) }))
  })().catch(() => {})
  kick($, true)
  /* replyCheck reads this turn's reply for the resume block */
  if (agentId === undefined) checks.resume = id
  if (agentId === undefined) keepInbox(id, r.json.inbox, false, undefined, r.json.workstream)
  /* from here the turn's steps are checked against this handoff */
  if (agentId === undefined) await keepWrote($, { sid, id: r.json.id, track: id, status: r.json.status, turn: mem.turn, held: mem.track || null })
  const folders = folderFlag($, r.json.handoffChecks)
  /* a leftover asked of the user keeps its card under this call; the handoff landed */
  const asked = agentId === undefined ? await stepsAsked($, r.json.steps, useId) : ''
  return {
    result: started + 'Wrote ' + r.json.id + ' (' + r.json.status + ') on ' + id
      + (r.json.superseded && r.json.superseded.length ? ', superseding ' + r.json.superseded.join(', ') : '') + '.'
      + (r.json.released ? ' This session let ' + id + ' go with it.' : '')
      + (v.wrapped ? '\n' + wrappedLine(v.wrapped) : '')
      + (r.json.overLine ? '\n' + r.json.overLine : '')
      + (readBack ? '\nThe local server answered late, so this was read back from the board: the handoff landed once. The write\'s own lines (removals, leftovers, inbox) are not here; `askerdo track show ' + r.json.id + '` prints the handoff.' : '')
      + (laidOutNote(r.json.laidOut, id) ? '\n' + laidOutNote(r.json.laidOut, id, r.json.parkedTracks) : '')
      + (r.json.leavesLine ? '\n' + r.json.leavesLine : '')
      + (r.json.reviewLine ? '\n' + r.json.reviewLine : '')
      + (r.json.waitsLine ? '\n' + r.json.waitsLine : '')
      + (r.json.silentLine ? '\n' + r.json.silentLine : '')
      + (r.json.unpushedLine ? '\n' + r.json.unpushedLine : '')
      + (Array.isArray(r.json.verify) ? r.json.verify : []).filter((x: any) => x && x.ok === false).map((x: any) => '\nverify first: ' + x.path + ' FAILS: ' + (x.problems || []).join('; ')).join('')
      + (r.json.gitLine ? '\nWARNING: ' + r.json.gitLine : '')
      + (r.json.keptLine ? '\n' + r.json.keptLine : '')
      + inboxText(r.json.inbox, r.json.workstream)
      + (r.json.untakenLine ? '\n' + r.json.untakenLine : '')
      + (r.json.warning ? '\nWARNING: ' + r.json.warning : '')
      + (handoffFilesNote(r.json, true) ? '\n' + handoffFilesNote(r.json, true) : '')
      + (folders ? '\n' + folders : '')
      + unchecked
      + (asked ? '\n' + asked : '')
      + '\n\nClose your reply with this block exactly as written, just above the footer: never inline and never the kickoff text, which the resume prints.\n\n'
      + resumeBlock(id, r.json.nextPc || payload.nextPc),
  }
}

/* ---- the handoff kept current ---------------------------------- */

/* The handoff this session's main loop last wrote, the turn that wrote it and the track held
   after it, kept per session in the store so a hot reload still checks it; steps: the main
   loop's tool names this turn. */
type Wrote = { sid: string; id: string; track: string; status: string; turn?: string; held: string | null; gone?: boolean; seen?: boolean }
const current: { wrote?: Wrote | null; read?: string; steps: { tool: string; changes: boolean; call?: { tool: string; input: any } }[] } = { steps: [] }

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
async function currencyStep($: any, tool: string, input: any): Promise<string> {
  const live = await liveHandoff($)
  /* the call itself too: decide proposes the turn's commands */
  current.steps.push({ tool: stepTool(tool, input), changes: stepChanges(tool, input, live && live.id),
    call: { tool, input: { command: (input || {}).command } } })
  const c = handoffCurrency(live, mem.turn, current.steps)
  return c.note && c.at === current.steps.length - 1 ? c.note : ''
}

const trackOf = (id: string) => String(id || '').trim().replace(/\.\d+$/, '').toUpperCase()

/* the live handoff patched in place, keeping its id; the ops are checked before any board call */
async function updateTool($: any, input: any): Promise<any> {
  const { track: named, ...patch } = input && typeof input === 'object' && !Array.isArray(input) ? input : ({} as any)
  const bad = [...Object.keys(patch).filter((k) => k !== 'ops').map((k) => 'unknown field "' + k + '"'), ...updateProblems(patch)]
  /* an unknown top-level name gets the line the ops' own unknowns already carry */
  if (Object.keys(patch).some((k) => k !== 'ops') && !bad.some((x) => x.includes('new session'))) bad.push(staleToolsLine(ownVersion($)))
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
  kick($, true)
  const ch = j.changed && typeof j.changed === 'object' ? j.changed : {}
  const said = Object.entries(ch).map(([k, v]) => k + ': ' + v)
  const fails = (Array.isArray(j.verify) ? j.verify : []).filter((v: any) => v && v.ok === false && String(ch.verifyFirst || '').includes(v.path))
  const files = handoffFilesNote(j)
  return {
    result: 'Updated ' + j.id + ' (' + j.status + ') on ' + j.track + ' in place, keeping its id: ' + (said.join('; ') || 'nothing changed') + '.'
      + fails.map((v: any) => '\nverify first: ' + v.path + ' FAILS: ' + (v.problems || []).join('; ')).join('')
      + (j.gitLine ? '\nWARNING: ' + j.gitLine : '')
      + (j.keptLine ? '\n' + j.keptLine : '')
      + (j.overLine ? '\n' + j.overLine : '')
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
  quietRedraw($, STATUS)
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
  const mk = marksFor(main, rootPath($, 'docs/'))
  /* the status line's meter redraws as its whole percent or its marks move */
  const face = JSON.stringify([wholePercent(r), main || null])
  if (face !== marks.face) { marks.face = face; quietRedraw($, STATUS) }
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
  noteLater(mainDepthNote(r, won, mem.track, runningHere()))
}

/* last: the tokens at the last note (agent-depth.mjs's stamp); deny: past hard with hardDeny; a dispatch
   with a run is kept from its spawn, so its lane size is journaled at its end */
const agents = new Map<string, { last: number; tokens: number; deny?: boolean }>()
/* this session's agents in flight by agentId: the job, model, calls, the tool
   in use and depth; a finished one stays, dimmed in Home's done fold, while another runs.
   start and end stamp its running time, in Date.now()'s ms as the draws read it */
type Flight = { id: string; job: string; model: string; calls: number; tool?: string; tokens: number; done?: boolean; start?: number; end?: number
  /* the agent that spawned it; wf, a workflow's, which $.agent.list() never names; g, the guard's stamps;
     bg, run in the background, so TaskStop takes it; call and run, a workflow's: its Workflow call and run, which join its row */
  parent?: string; wf?: boolean; bg?: boolean; call?: string; run?: string; g?: { last: number }; tasks?: string[] }
/* the session's background shells, monitors and workflows (mod-core bgRebuilt), saved with the flights */
type Bg = { id: string; kind: string; job: string; command?: string; call?: string; run?: string; start?: number; end?: number; done?: boolean; status?: string; guessed?: boolean
  /* fg, a foreground shell call the mod wraps; reloaded, one kept over a reload, which the next list settles */
  fg?: boolean; shown?: boolean; reloaded?: boolean
  /* agent: the agent whose call started it, absent for the main loop's */
  agent?: string }
/* how each agent and background task ended, for the timing log; they ride the next ring rows */
const endRows: any[] = []
const END_MAX = 20
/* past the bound a count stands for the rest, as the fault book's, so a burst reads as clipped */
const endsLost = { n: 0 }
function endLogged(row: any): void {
  row.z = Date.now()
  if (endRows.length < END_MAX) endRows.push(row)
  else endsLost.n++
}
/* the end rows out for a band read, the dropped count last; back() puts them ahead of any heard since */
function endsTake(): { rows: any[]; back: () => void } {
  const out = endRows.splice(0), lost = endsLost.n
  endsLost.n = 0
  return { rows: lost ? [...out, { x: 'ends', n: lost }] : out, back: () => {
    const all = [...out, ...endRows.splice(0)]
    endRows.push(...all.slice(0, END_MAX))
    endsLost.n += lost + Math.max(0, all.length - END_MAX)
  } }
}
/* The flights slice: a start, an end or a stop's words move slices.flights and ask the gate;
   a tick (calls, the tool, tokens) moves only `tick`, which the live lines' model reads */
const flights = { agents: new Map<string, Flight>(), bg: new Map<string, Bg>(), tick: 0 }
const flight = flights.agents
const flightList = (): Flight[] => [...flight.values()]
const bgTasks = flights.bg
const bgList = (): Bg[] => [...bgTasks.values()]
/* mod-core flightsKept on both maps: a workflow's row and its agents stay and leave together */
function flightKeep(): void {
  const k = flightsKept(flightList(), bgList())
  const fs = new Set(k.flights.map((f: any) => f.id)), bs = new Set(k.bg.map((b: any) => b.id))
  for (const id of [...flight.keys()]) if (!fs.has(id)) flight.delete(id)
  for (const id of [...bgTasks.keys()]) if (!bs.has(id)) bgTasks.delete(id)
  if (!flight.size && !bgTasks.size) flightStop()
}

/* a hot reload or a lost hooks worker empties the module, so the session's flights
   ride the shared store and a load rebuilds from them; one key per session, so two sessions
   saving at once each keep theirs, and a load drops the keys no save touched for FLIGHTS_AGE */
const FLIGHTS_KEY = 'flights:'
const FLIGHTS_AGE = 3 * 86400000
/* one write a second at most: the first at once, what comes in the next second folds into one at its end */
const FLIGHTS_SAVE_MS = 1000
const flightSaving: { chain: Promise<void>; timer?: any; due?: boolean } = { chain: Promise.resolve() }
function flightSave($: any): void {
  if (flightSaving.timer) { flightSaving.due = true; return }
  flightWrite($)
  try {
    flightSaving.timer = $.clock.after(FLIGHTS_SAVE_MS, ran('flights save timer', () => {
      flightSaving.timer = undefined
      if (flightSaving.due) { flightSaving.due = false; flightSave($) }
    }))
  } catch { flightSaving.timer = undefined }
}
function flightWrite($: any): void {
  flightSaving.chain = flightSaving.chain.then(async () => {
    const sid = await sessionId($)
    if (!sid) return
    const list = flightList().map((f) => {
      const a = agents.get(f.id)
      return { ...f, tool: undefined, ...(a ? { g: { last: a.last } } : {}) }
    })
    /* a foreground call is kept only once shown */
    const bg = bgList().filter((b) => !b.fg || b.shown)
    if (list.length || bg.length) await $.store.set(FLIGHTS_KEY + sid, { at: Date.now(), proc: await procMark($), list, ...(bg.length ? { bg } : {}) })
    else await $.store.delete(FLIGHTS_KEY + sid)
  }).catch(() => {})
}
/* the other sessions' copies past FLIGHTS_AGE, and the one shared map an older mod wrote; by the same age
   the other sessions' unsettled runs (by the newest end) and stop-named tasks (by their write) */
async function flightTrim($: any, sid: string): Promise<void> {
  const keys = await $.store.keys()
  if (!Array.isArray(keys)) return
  const cut = Date.now() - FLIGHTS_AGE
  const mine = new Set([sid, ...runTick.sids])
  const ageOf = (k: string, v: any): number => k === 'flights' ? Math.max(0, ...Object.values(v || {}).map((x: any) => Number(x && x.at) || 0))
    : k.startsWith(UNSETTLED_KEY) ? Math.max(0, ...(Array.isArray(v) ? v : []).map((x: any) => Date.parse(x && x.ended) || 0))
      : Number(v && v.at) || 0
  for (const k of keys.map(String)) {
    const kind = [FLIGHTS_KEY, UNSETTLED_KEY, STOP_NAMED_KEY, PROC_KEY].find((p) => k.startsWith(p))
    if (k !== 'flights' && (!kind || mine.has(k.slice(kind.length)))) continue
    /* a process mark outlives the flights, so a reopen days later is still known */
    if (ageOf(k, await $.store.get(k)) < (kind === PROC_KEY ? Date.now() - PROC_AGE : cut)) await $.store.delete(k)
  }
}
/* at each load: what the store kept, checked against the engine's own list; events since the load win */
async function flightRebuild($: any): Promise<void> {
  const sid = await sessionId($)
  const [own, old, listed] = await Promise.all([
    sid ? Promise.resolve($.store.get(FLIGHTS_KEY + sid)).catch(() => null) : null,
    Promise.resolve($.store.get('flights')).catch(() => null), Promise.resolve($.agent.list()).catch(() => null)])
  const mine = own && Array.isArray(own.list) ? own : sid && old && old[sid] ? old[sid] : null
  /* at a reopen nothing the old process ran lives on, a workflow's agents included */
  const gone = await reopened($)
  const kept = (mine && Array.isArray(mine.list) ? mine.list : []).map((f: any) => (gone && f && !f.done ? { ...f, done: true, end: f.end || Date.now() } : f))
  if (sid) void flightTrim($, sid).catch(() => {})
  const rebuilt: Flight[] = flightsRebuilt(kept, Array.isArray(listed) ? listed : [])
  let added = 0
  for (const f of rebuilt) {
    if (flight.has(f.id)) continue
    const { g, ...rest } = f
    flight.set(f.id, rest)
    if (g && !rest.done && !agents.has(f.id)) agents.set(f.id, { last: Number(g.last) || 0, tokens: Number(rest.tokens) || 0 })
    added++
  }
  /* the background tasks come back as kept; the next Stop's list checks them */
  const kb = (mine && Array.isArray(mine.bg) ? mine.bg : []).map((b: any) => (b && b.fg ? { ...b, reloaded: true } : b))
  /* and its workflow rows end, so the minute's renewal stops counting them live */
  const bg = gone ? bgRebuilt(kb, [], Date.now()) : kb
  for (const b of bg) if (b && b.id && !bgTasks.has(b.id)) { bgTasks.set(b.id, b); added++ }
  flightKeep()
  if (added) flightRedraw($, true)
  if (added || kept.length) flightSave($)
}

/* a main loop shell call in the foreground, a row once it has run FG_SHOW_MS (the app's rail lists
   a long one); kept quiet until then, so a short call draws and saves nothing. The running time timer shows it */
function fgStart($: any, e: any): Bg | undefined {
  try {
    const i = toolInput(e)
    const id = 'fg-' + (e.tool_use_id || Date.now() + '-' + Math.random().toString(36).slice(2, 8))
    const b: Bg = { id, kind: 'shell', fg: true, job: String(i.description || i.command || '').slice(0, 1000),
      ...(i.command ? { command: String(i.command).slice(0, 1000) } : {}), start: Date.now() }
    bgTasks.set(id, b)
    flightArm($, FG_SHOW_MS + 20)
    return b
  } catch { return undefined }
}
/* the call returned or failed: its row leaves (a result moved to the background starts its own row) */
function fgEnd($: any, b: Bg): void {
  /* a Stop's list may have put a copy in its place */
  const cur = bgTasks.get(b.id) || b
  bgTasks.delete(b.id)
  if (!cur.shown && !b.shown) { if (!flight.size && !bgTasks.size) flightStop(); return }
  flightKeep()
  flightRedraw($, true)
  flightSave($)
}
/* the running time timer's turn, at its due time: a foreground call past the threshold since the last draw */
function fgDue($: any, at: number): boolean {
  const due = bgList().filter((b) => b.fg && !b.shown && !b.done && (b.start as number) + FG_SHOW_MS <= at)
  if (!due.length) return false
  for (const b of due) b.shown = true
  flightRedraw($, true)
  flightSave($)
  return true
}

/* a call that put work in the background: Bash or PowerShell with run_in_background (or moved
   there), Monitor and Workflow; the id is the result's; since, a foreground call's start */
function bgStart($: any, e: any, res: any, since?: number): void {
  try {
    const r = res && !res.isError && !res.deny && res.result && typeof res.result === 'object' ? res.result : null
    const id = r && (COMMAND_TOOLS.includes(e.tool) ? r.backgroundTaskId : e.tool === 'Monitor' || e.tool === 'Workflow' ? r.taskId : undefined)
    if (!id) return
    const i = toolInput(e)
    const kind = e.tool === 'Monitor' ? 'monitor' : e.tool === 'Workflow' ? 'workflow' : 'shell'
    const command = kind === 'shell' ? i.command : kind === 'monitor' ? i.command || (i.ws && i.ws.url) : r.workflowName || i.name || r.scriptPath
    const job = kind === 'workflow' ? r.workflowName || i.name || 'a workflow' : i.description || command || ''
    /* a workflow keeps its call's id, which its agents spawn under, and its run's, which they carry, so they draw under its row */
    const call = kind === 'workflow' && e.tool_use_id ? { call: String(e.tool_use_id) } : {}
    const run = kind === 'workflow' && r.runId ? { run: String(r.runId) } : {}
    bgTasks.set(String(id), { id: String(id), kind, job: String(job).slice(0, 1000), ...(command ? { command: String(command).slice(0, 1000) } : {}), ...call, ...run, start: since || Date.now(),
      ...(e.agentId !== undefined ? { agent: String(e.agentId) } : {}) })
    /* the main loop's workflow is one run, on its call's id (its agents are never listed) */
    if (kind === 'workflow' && e.agentId === undefined) {
      const tasks = tasksOfDispatch({ description: i.description, prompt: String(i.script || i.name || '') })
      if (tasks.length) runOpen($, String(id), String(job).slice(0, 200), tasks)
    }
    flightRedraw($, true)
    flightSave($)
  } catch {}
}
/* how it ended (the notification's word: completed, failed, killed), its run length when told; it
   overwrites an end a Stop's list or a notice only implied (guess: the end is the call's own time) */
function bgEnd($: any, id: string, status?: string, durationMs?: number, guess = false, path = 'notice'): void {
  const b = bgTasks.get(id)
  if (!b || (b.done && !b.guessed)) return
  if (!b.done) endLogged({ x: 'bgend', i: id, o: b.agent ? 'agent' : 'main', p: path, r: Number.isFinite(b.start) ? Date.now() - (b.start as number) : -1 })
  const guessed = b.done ? b.end : undefined
  b.done = true
  b.guessed = guess || undefined
  b.status = status || 'completed'
  b.end = Number.isFinite(durationMs) && Number.isFinite(b.start) ? (b.start as number) + (durationMs as number) : guessed ?? Date.now()
  bgRunEnd($, b)
  flightKeep()
  flightRedraw($, true)
  flightSave($)
  landedCheck()
}
/* the engine's own list at each Stop and SubagentStop: what it runs stays, what it does not has ended */
function bgReconcile($: any, listed: any): void {
  if (!Array.isArray(listed) || (!bgTasks.size && !listed.length)) return
  const before = JSON.stringify([flightList(), bgList()])
  const now = bgRebuilt(bgList(), listed, Date.now())
  for (const b of now) {
    const was = bgTasks.get(b.id)
    if (b.done && was && !was.done) { endLogged({ x: 'bgend', i: b.id, o: b.agent ? 'agent' : 'main', p: 'list', r: Number.isFinite(b.start) ? Date.now() - (b.start as number) : -1 }); bgRunEnd($, b) }
  }
  bgTasks.clear()
  for (const b of now) bgTasks.set(b.id, b)
  flightKeep()
  if (JSON.stringify([flightList(), bgList()]) === before) return
  flightRedraw($, true)
  flightSave($)
  landedCheck()
}

/* The stop column's presses: the first arms the button for STOP_ARM_MS, the second runs
   TaskStop with the person's words for the press; a refusal shows on the row until the next press */
const STOP_ARM_MS = 4000
const stops = new Map<string, { armed?: { cancel: () => void }; busy?: boolean; said?: string }>()
function stopState(id: string): string {
  const s = stops.get(id)
  return !s ? 'rest' : s.busy ? 'busy' : s.armed ? 'armed' : 'rest'
}
function stopPress($: any, id: string, job: string): void {
  const s = stops.get(id) || {}
  stops.set(id, s)
  if (s.busy) return
  if (!s.armed) {
    if (s.said) { s.said = undefined; flights.tick++ }
    const armed = { cancel: () => {} }
    s.armed = armed
    try {
      armed.cancel = $.clock.after(STOP_ARM_MS, ran('stop arm timer', () => { if (s.armed === armed) { s.armed = undefined; laterRedraw($, PANE_ONLY, 'view') } })).cancel
    } catch {}
    qpaneRedraw($, PANE_ONLY)
    return
  }
  try { s.armed.cancel() } catch {}
  s.armed = undefined
  s.busy = true
  qpaneRedraw($, PANE_ONLY)
  void (async () => {
    let res: any
    try {
      res = await $.tool.call({ tool: 'TaskStop', task_id: id, consent: 'The user pressed Stop on "' + flatWords(job) + '" in the AskerDo pane' })
    } catch (err: any) { res = { deny: String((err && err.message) || err) } }
    s.busy = false
    const why = res && (res.deny || (res.isError ? res.text || res.result || 'the stop failed' : ''))
    if (!why) return stopped($, id)
    s.said = 'not stopped: ' + flatWords(typeof why === 'string' ? why : JSON.stringify(why)).slice(0, 200)
    flightRedraw($, true)
    qpaneRedraw($, PANE_ONLY)
  })().catch(() => {})
}
const flatWords = (s: string): string => String(s || '').replace(/\s+/g, ' ').trim()
/* a stop that took, from a press here or the model's own TaskStop: the row ends as stopped */
function stopped($: any, id: string): void {
  stops.delete(id)
  if (bgTasks.has(id)) bgEnd($, id, 'killed', undefined, false, 'stop')
  else if (flight.has(id) && !flight.get(id)?.done) { endLogged({ x: 'end', a: id, e: 'unread', o: 'stopped', p: 'stop' }); agentGone($, id, '', 'killed') }
  qpaneRedraw($, PANE_ONLY)
}
/* calls and depth redraw at most once a second, a start or an end at once, and while one runs,
   as a shown running time turns over; all through the one timer. Flights show on the
   status row alone, so no card under a reply draws again */
const flightTick: { timer?: { cancel: () => void }; due?: number } = {}
/* now: a start or an end, which moves the flights slice and waits for the gate; else a tick */
function flightRedraw($: any, now = false): void {
  if (now) laterRedraw($, [...STATUS, 'band', 'pane'], 'flights')
  else flights.tick++
  flightArm($, now ? flightNext(Date.now()) : 1000)
}
/* ms to the next turn of a running agent's shown time (each second under a minute, then each
   minute); none when nothing runs */
function flightTurnIn(at: number): number {
  let ms = Infinity
  for (const f of [...flight.values(), ...bgTasks.values()]) {
    if (f.done || !Number.isFinite(f.start)) continue
    const run = Math.max(0, at - (f.start as number))
    /* a foreground call not yet shown turns over once, when it shows */
    if ((f as Bg).fg && !(f as Bg).shown) { ms = Math.min(ms, Math.max(0, FG_SHOW_MS - run)); continue }
    const unit = run < 60000 ? 1000 : 60000
    ms = Math.min(ms, unit - (run % unit))
  }
  return ms
}
/* a hair past the turn, so the draw reads the new figure */
const flightNext = (at: number): number => flightTurnIn(at) + 20
/* the pending timer stays when it is due as soon; a redraw re-arms for the next turn */
function flightArm($: any, ms: number): void {
  if (!(ms < Infinity)) return
  const due = Date.now() + ms
  if (flightTick.timer && (flightTick.due as number) <= due) return
  flightStop()
  try {
    flightTick.due = due
    flightTick.timer = $.clock.after(ms, ran('running time timer', () => {
      flightTick.timer = undefined
      /* the wait has run its length, whatever the wall clock says */
      flightTurn($, Math.max(Date.now(), due))
      flightArm($, flightNext(Date.now()))
    }))
  } catch { flightTick.timer = undefined }
}
/* a running time turned over: Home's and the band's are live lines, so the tick asks the status row
   alone, at the gate and only when its drawing moved; a surface whose live line failed draws its times as text */
function flightTurn($: any, at: number): void {
  if (fgDue($, at)) return
  if ([...liveFault].some((k) => /^(Pane|AbovePrompt) /.test(k))) return quietRedraw($, STATUS)
  hintIfMoved($)
}
function flightStop(): void {
  try { if (flightTick.timer) flightTick.timer.cancel() } catch {}
  flightTick.timer = undefined
}
/* never throws: the spawn hook's catch would spawn again */
function flightStart($: any, e: any, res: any, wake = false): void {
  try {
    const id = res && res.agentId
    if (!id || (res && res.deny)) return
    /* a wake after its run ended keeps that end, so its turn's end changes no run (a bound's late report goes as a note) */
    const settled = wake && (agentsGone.has(String(id)) || !runTick.open.some((r: any) => r && r.agentId === String(id)))
    if (settled) agentsGone.add(String(id))
    else agentsGone.delete(id)
    const was = flight.get(id)
    const parent = e.parentAgentId || (was && was.parent)
    flight.set(id, { id, job: String(e.description || e.subagentType || ''), model: String(res.model || e.model || e.parentModel || ''),
      calls: was ? was.calls : 0, tokens: was ? was.tokens : 0, start: was && !was.done && Number.isFinite(was.start) ? was.start : Date.now(),
      ...(parent ? { parent: String(parent) } : {}), ...(was && was.tasks ? { tasks: was.tasks } : {}), ...(e.workflow || (was && was.wf) ? { wf: true } : {}), ...(e.background || (was && was.bg) ? { bg: true } : {}),
      ...(e.workflow && e.tool_use_id ? { call: String(e.tool_use_id) } : was && was.call ? { call: was.call } : {}),
      ...(e.workflow && e.workflow.runId ? { run: String(e.workflow.runId) } : was && was.run ? { run: was.run } : {}) })
    if (e.name) agentNames.set(String(e.name), String(id))
    /* a resume's report is a new one */
    if (!settled) {
      reported.delete(String(id))
      handedBack.delete(String(id))
      heldTurns.delete(String(id))
      boundEnded.delete(String(id))
    }
    if (e.background) { bgSpawned.add(String(id)); if (bgSpawned.size > 200) bgSpawned.delete(bgSpawned.values().next().value as string) }
    flightRedraw($, true)
    flightSave($)
  } catch {}
}
function flightEnd($: any, agentId: string): void {
  const f = flight.get(agentId)
  if (!f) return
  f.done = true
  f.end = Date.now()
  f.tool = undefined
  flightEnded.add(agentId)
  flightKeep()
  flightRedraw($, true)
  flightSave($)
  landedCheck()
}
/* an agent the engine ended with no turn.complete (killed, failed) leaves at the main loop's next turn
   and at the run timer's tick, which hands in the list it read */
async function flightSweep($: any, listed?: any): Promise<void> {
  if (!flight.size) return
  const list = listed === undefined ? await $.agent.list() : listed
  if (!Array.isArray(list)) return
  const live = new Map(list.map((a: any) => [a && a.id, a && a.status]))
  for (const f of flight.values()) {
    const st = live.get(f.id)
    if (f.done || !st || LIVE_AGENT.includes(String(st))) continue
    endLogged({ x: 'end', a: f.id, e: String(st), o: 'ended', p: 'sweep' })
    agentGone($, f.id, '', String(st))
  }
  /* the calls and depth since the last start or end, for the next load */
  flightSave($)
}

/* an agent's turn end is its end only once the engine's list no longer runs it: one
   that stopped to wait on background work of its own reads waiting and still owes its report. A
   status the engine has not moved yet is read once more; an unread list ends it as before.
   Still running at the recheck with no call, no new turn and no background work of its own since is the
   engine's lag (an isolated agent's worktree cleanup held it past the recheck in a live run), so the turn's
   end is its end; a new turn is a wake */
const AGENT_END_RECHECK_MS = 2000
const agentTurns = new Map<string, number>()
/* the agents whose SubagentHandback call went through since their spawn or resume, with the report given: the
   turn's end is their end, though the engine lists them waiting on background work of their own */
const handedBack = new Map<string, string>()
/* a turn's end the recheck held open (a wait): its answer, so a later end by the sweep or a stop keeps the
   report, and when and at which call and turn it was held, for the bound on a wait with neither */
const heldTurns = new Map<string, { answer: string; at: number; calls?: number; turns: number }>()
const ownWork = (agentId: string): boolean => [...bgTasks.values()].some((b: any) => b && b.agent === agentId && !b.done)
async function agentTurnEnd($: any, agentId: string, answer: string, again = true, calls?: number, turns?: number, waitedThen = false): Promise<void> {
  /* an agent already ended (a stop, the sweep, a reload) opens no end of its own to wait on */
  if (agentsGone.has(agentId) || (!again && flight.get(agentId)?.done)) {
    if (again && boundEnded.has(agentId)) await boundReport($, agentId, answer).catch(() => {})
    rowEnd($, agentId)
    goneSettle(agentId)
    return
  }
  /* the report's prompt waits for this end, which may still be rechecking */
  if (again) { endPending(agentId); const x = runEnding.get(agentId); if (x) x.turn = true }
  /* read before the list's await, so a wake landing during the read counts as after this end */
  const now = flight.get(agentId)?.calls
  const began = agentTurns.get(agentId) || 0
  const waited = waitedThen || ownWork(agentId)
  let st: string | undefined
  let read = false
  try {
    const list = await $.agent.list()
    read = Array.isArray(list)
    const a = read ? list.find((x: any) => x && x.id === agentId) : undefined
    st = a ? String(a.status) : undefined
  } catch {}
  /* a turn begun since the end that armed this recheck supersedes it: that turn's own end answers */
  if (!again && (agentTurns.get(agentId) || 0) !== turns) {
    endLogged({ x: 'end', a: agentId, e: st || (read ? 'none' : 'unread'), o: 'superseded', p: 'recheck' })
    goneSettle(agentId)
    return
  }
  /* background work of its own still running at this end or the turn's is a wait, which the engine also lists as
     running: no lag. A stop inside the recheck may drop the row the session's list leaves out */
  const waits = waited || ownWork(agentId)
  const lag = !again && st !== 'waiting' && !waits && flight.get(agentId)?.calls === calls
  const given = handedBack.get(agentId)
  const live = given === undefined && !!st && LIVE_AGENT.includes(st) && !lag
  endLogged({ x: 'end', a: agentId, e: st || (read ? 'none' : 'unread'), o: live ? 'running' : 'ended', p: given !== undefined ? 'handback' : again ? 'turn' : 'recheck' })
  if (live) {
    if (again) {
      heldTurns.set(agentId, { answer: answer.trim() ? answer : heldTurns.get(agentId)?.answer || '', at: await clockNow($), calls: now, turns: began })
      try { $.clock.after(AGENT_END_RECHECK_MS, ran('agent end recheck', () => void agentTurnEnd($, agentId, answer, false, now, began, waits).catch(() => {}))) } catch {}
    } else endSettled(agentId)
    return
  }
  agentGone($, agentId, given && given.trim() ? given : answer)
}
/* an agent held open on background work of its own with no call and no turn for HELD_WAIT_MS ends with
   its held turn's words, so a server it left up never keeps its task running for hours; at the run tick */
function heldSweep($: any, listed: any, now: number, wait: number): void {
  for (const id of [...heldTurns.keys()]) if (agentsGone.has(id)) heldTurns.delete(id)
  const held = [...heldTurns].map(([id, h]) => ({ id, at: h.at, moved: flight.get(id)?.calls !== h.calls || (agentTurns.get(id) || 0) !== h.turns }))
  for (const id of heldOver(held, listed, now, wait)) {
    endLogged({ x: 'end', a: id, e: 'listed live', o: 'ended', p: 'held' })
    boundEnded.add(id)
    agentGone($, id, '', 'held')
  }
}
/* the agents the bound ended; the wait was real, so a later turn end's report goes on the run's tasks as a note */
const boundEnded = new Set<string>()
async function boundReport($: any, agentId: string, answer: string): Promise<void> {
  boundEnded.delete(agentId)
  const given = handedBack.get(agentId)
  handedBack.delete(agentId)
  const said = (given && given.trim() ? given : answer).trim()
  const run = runTick.ended.filter((r: any) => r && r.agentId === agentId).at(-1)
  const sid = await sessionId($)
  if (!said || !run || !sid) return
  for (const t of runTaskIds(run)) await cli($, ['note', t, '--session', sid, '--json'], 'Report after the 30 minute bound ended the run: ' + said.slice(0, REPORT_CUT))
}
async function clockNow($: any): Promise<number> {
  try { const t = Number(await $.clock.now()); if (Number.isFinite(t)) return t } catch {}
  return Date.now()
}
/* an agent's end in progress, which the prompt carrying its report awaits (capped), so the settle
   words ride that prompt; resolved once the run's end and its settle read are done, or the agent still runs */
const runEnding = new Map<string, { p: Promise<void>; done: () => void; turn?: boolean }>()
const RUN_ENDING_CAP_MS = 3000
function endPending(id: string): Promise<void> {
  let x = runEnding.get(id)
  if (!x) { let done = () => {}; const p = new Promise<void>((r) => { done = r }); x = { p, done }; runEnding.set(id, x) }
  return x.p
}
function endSettled(id: string): void {
  const x = runEnding.get(id)
  if (x) { runEnding.delete(id); x.done() }
}
/* the report's prompt (a peer's agent-message or a task notification) waits for each named agent's end, three seconds at most.
   A peer frame names the agent by its spawn's name, and a hand-back reaches the session before the agent's turn ends, so an
   agent in flight is awaited from here; a wait no turn end took up lapses at the cap */
async function endsNamed($: any, text: string): Promise<void> {
  const ids = [...String(text || '').matchAll(/<agent-message from="([^"]+)"/g)].map((m) => agentNames.get(m[1]) || m[1])
  for (const t of taskEnds(text)) ids.push(String(t.id))
  const early: string[] = []
  for (const id of new Set(ids)) {
    const f = flight.get(id)
    if (runEnding.has(id) || !f || f.done || f.parent) continue
    endPending(id)
    early.push(id)
  }
  await endsWait($, [...new Set(ids)].map((id) => runEnding.get(id)).filter(Boolean).map((x: any) => x.p))
  for (const id of early) { const x = runEnding.get(id); if (x && !x.turn) endSettled(id) }
}
/* a spawn's name to its agent id, for the peer frames that name it */
const agentNames = new Map<string, string>()
function endsWait($: any, waits: Promise<void>[]): Promise<unknown> {
  if (!waits.length) return Promise.resolve()
  return Promise.race([Promise.all(waits), new Promise<void>((r) => { try { $.clock.after(RUN_ENDING_CAP_MS, () => r()) } catch { r() } })])
}
/* every end of an agent (its report, the sweep, a Stop) runs the row's end and its run's end,
   once; a spawn or resume under the id clears it. word: the list's status, or killed for a stop */
const agentsGone = new Set<string>()
const goneEnding = new Set<string>()
function agentGone($: any, agentId: string, answer: string, word?: string): void {
  if (agentsGone.has(agentId)) { rowEnd($, agentId); goneSettle(agentId); return }
  agentsGone.add(agentId)
  agentTurns.delete(agentId)
  handedBack.delete(agentId)
  /* a held turn's report, for an end that carries none (the sweep, a stop, the bound) */
  const said = answer || heldTurns.get(agentId)?.answer || ''
  heldTurns.delete(agentId)
  try { flightEnd($, agentId) } catch {}
  void endPending(agentId)
  goneEnding.add(agentId)
  void runEnd($, agentId, said, word).catch(() => {}).finally(() => { goneEnding.delete(agentId); endSettled(agentId) })
}
/* an agent ending its turn with no hand-back while background work of its own runs (the stop's list
   still shows it) is refused once with words; the next end goes through whatever it did, so none can loop */
const stopAsked = new Set<string>()
function handbackAsk(agentId: string, active: boolean): string {
  if (!agentId) return ''
  if (active || stopAsked.has(agentId) || handedBack.has(agentId)) { stopAsked.delete(agentId); return '' }
  const own = [...bgTasks.values()].filter((b: any) => b && b.agent === agentId && !b.done)
  if (!own.length) return ''
  stopAsked.add(agentId)
  if (stopAsked.size > 50) stopAsked.delete(stopAsked.values().next().value as string)
  const names = own.slice(0, 3).map((b: any) => flatWords(String(b.command || b.job || b.id)).slice(0, 80)).join('; ')
  return 'AskerDo: your turn is ending with no report while background work you started still runs (' + names + '). '
    + 'Call SubagentHandback now with a report that says what is done, what you left running and why; or stop that work first, then hand back.'
}
/* a wake's row, reopened after its run ended, ends with the agent */
function rowEnd($: any, agentId: string): void {
  const f = flight.get(agentId)
  if (f && !f.done) { try { flightEnd($, agentId) } catch {} }
}
/* the agents a SendMessage call addressed since their last turn end; a resume with none is the engine's wake.
   a turn end keeps the text (ended) for one resume or MESSAGE_KEPT_MS, since a message sent in the agent's
   last model call resumes it after that end; such a resume is a message only when its prompt holds the text */
const MESSAGE_KEPT_MS = 5 * 60000
const messaged = new Map<string, { texts: string[]; ended?: number }>()
function messageSeen(to: any, text: any): void {
  const name = String(to || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim()
  if (!name) return
  const key = agentNames.get(name) || name
  const was = messaged.get(key)
  const texts = was && !was.ended ? was.texts : []
  messaged.delete(key)
  messaged.set(key, { texts: [...texts, typeof text === 'string' ? flatWords(text) : ''].filter(Boolean).slice(-5) })
  if (messaged.size > 50) messaged.delete(messaged.keys().next().value as string)
}
function messageEnded(id: string): void {
  for (const [k, m] of messaged) if ((k === id || agentNames.get(k) === id) && !m.ended) m.ended = Date.now()
}
function messageTaken(id: string, name: any, prompt: any): boolean {
  const keys = [id, ...(name ? [String(name)] : []), ...(name && agentNames.has(String(name)) ? [agentNames.get(String(name)) as string] : [])]
  for (const [k, v] of agentNames) if (v === id) keys.push(k)
  const said = flatWords(String(prompt || ''))
  let taken = false
  for (const k of keys) {
    const m = messaged.get(k)
    if (!m) continue
    messaged.delete(k)
    if (!m.ended) taken = true
    else if (Date.now() - m.ended < MESSAGE_KEPT_MS && said && m.texts.some((t) => said.includes(t.slice(0, 80)))) taken = true
  }
  return taken
}
/* an end left pending for an agent already gone would hold every stop for the cap; one whose run is still ending settles there */
function goneSettle(agentId: string): void {
  if (!goneEnding.has(agentId)) endSettled(agentId)
}

/* what a handoff waits for, read fresh: the load's rebuild awaited, so a reload's
   empty map never reads as nothing running, then the engine's own list. checked: false when the
   list could not be read and nothing kept runs */
const flightLoad: { done?: Promise<void> } = {}
const flightEnded = new Set<string>()
async function handoffWaits($: any, agentId?: string): Promise<{ list: any[]; checked: boolean }> {
  await (flightLoad.done || (flightLoad.done = flightRebuild($).catch(() => {})))
  let listed: any = null
  try { listed = await $.agent.list() } catch {}
  const list = runningWork(flightList(), bgList(), listed, agentId, flightEnded)
  return { list, checked: Array.isArray(listed) || list.length > 0 }
}
/* the session's work running now, from the module alone (a reply's end, a note) */
const runningHere = (): string => runningNames(runningWork(flightList(), bgList(), null, undefined, flightEnded))

/* one note once everything a refused-for-now write named has landed; kept in the module only */
const landing: { ids?: string[]; jobs?: string } = {}
function landedCheck(): void {
  if (!landing.ids) return
  const runs = (id: string) => { const f = flight.get(id) || bgTasks.get(id); return !!f && !f.done }
  if (landing.ids.some(runs)) return
  const jobs = landing.jobs
  landing.ids = landing.jobs = undefined
  noteLater('AskerDo: the work the handoff waited for has landed (' + jobs + '). Check what each left, then call handoff_write.')
}

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
  flightSave($)
  /* past hard with hardDeny the refusal on each call carries it */
  if (stage === 'hard' && g.hardDeny) return
  const note = await agentStateNote($, agentId)
  noteLater(agentNote(stage, { tokens, guard: g, note }), agentId)
}

/* ---- commits, linked to the task they finished ---- */

const namesOf = (...s: any[]) => s.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 120))

/* argv with no shell, off the tool's wall time; never throws */
const modGit = ($: any) => async (dir: string, args: string[]) => {
  try {
    const r = await $.process.run(['git', '-C', dir, ...args], { timeoutMs: 10000, env: { GIT_OPTIONAL_LOCKS: '0' } })
    return { status: r.exitCode, out: String(r.stdout || '') }
  } catch { return { status: -1, out: '' } }
}

/* the session's write: dropped when the board is away, never queued (the backfill catches it) */
const linkSend = ($: any) => (input: any) => localVerb($, LINK_VERB, { input, session: input.session })

/* the belt's last read of the session's repo, and the shas already sent */
const belt: { top?: string; branch?: string; head?: string; since?: string; linked: Set<string>; busy: Set<Promise<void>> } = { linked: new Set(), busy: new Set() }
const BELT_KEPT = 500
function beltSaw(sha: string): void {
  if (!sha) return
  if (belt.linked.size >= BELT_KEPT) belt.linked.delete(belt.linked.values().next().value as string)
  belt.linked.add(sha)
}

/* One commit linked by the design's order; `agentId` is the loop that made it. */
async function linkHere($: any, c: { dirs: string[]; sha: string; agentId?: string; was?: string[] }): Promise<void> {
  const sid = await sessionId($)
  const run = c.agentId ? await agentRun($, c.agentId, sid) : null
  const job = run && run.job ? String(run.job) : ''
  const r = await captureCommit(modGit($), linkSend($), {
    dirs: c.dirs, sha: c.sha, was: c.was, session: sid, job, agentTasks: run ? runTaskIds(run) : [],
    tagged: job ? ownJobTasks([job]) : [], hand: band.hand || [],
  })
  if (r) beltSaw(r.sha)
}

/* the HEADs a commit call starts on; never throws */
async function headsBefore($: any, e: any): Promise<string[] | undefined> {
  try { return await headsOf(modGit($), repoCandidates(toolInput(e).command, String(await $.session.cwd()))) } catch { return undefined }
}

function commitSeen($: any, cwd: string, e: any, res: any, was?: string[]): void {
  const run = linkHere($, { dirs: repoCandidates(toolInput(e).command, cwd), sha: shaHint(res.result).sha, agentId: e.agentId, was }).catch(() => {})
  belt.busy.add(run)
  void run.finally(() => belt.busy.delete(run))
}

/* the folder, the commit and the branch; --abbrev-ref holds for every revision after it, so the bare HEAD goes first */
const PLACE_ARGS = ['rev-parse', '--path-format=absolute', '--show-toplevel', 'HEAD', '--abbrev-ref', 'HEAD']

/* At the main loop's turn end: commits on the session's branch no tool call showed (a
   script's, the app's own commit action), since the last read; a branch switch is no commit. */
async function beltCheck($: any): Promise<void> {
  await Promise.allSettled([...belt.busy])
  const git = modGit($)
  const r = await git(await projectDir($), PLACE_ARGS)
  const [top, head, branch] = String(r.out).split(/\r?\n/).map((s) => s.trim())
  if (r.status !== 0 || !top || !head) return
  const was = { top: belt.top, branch: belt.branch, head: belt.head, since: belt.since }
  Object.assign(belt, { top, branch, head, since: new Date(Date.now() - 5000).toISOString() })
  if (!was.head || was.head === head || !was.top || !sameDir(was.top, top) || was.branch !== branch) return
  const list = await git(top, ['rev-list', '--reverse', '--max-count=20', '--since=' + was.since, was.head + '..' + head])
  if (list.status !== 0) return
  for (const sha of String(list.out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    if (belt.linked.has(sha)) continue
    beltSaw(sha)
    await linkHere($, { dirs: [top], sha })
  }
}

/* ---- runs: the board's record of this session's agents ---- */

/* what a top-level spawn serves, from its own input: its tasks (tasksOfDispatch, the ones
   its prompt names first), its job and the state note it names; never throws */
type SpawnRun = { tasks: string[]; job: string; stateNote: string; place: any }
async function spawnRun($: any, e: any): Promise<SpawnRun | null> {
  try {
    const briefs: string[] = []
    /* a -state.md file read as a brief is another run's record, whose head names its own note */
    const noteBriefs: string[] = []
    for (const f of briefPaths(e.prompt, await projectDir($))) {
      try { const t = await $.fs.read(f); if (typeof t === 'string') { briefs.push(t); if (!/-state\.md$/i.test(f)) noteBriefs.push(t) } } catch {}
    }
    const job = String(e.name || e.description || '').trim().slice(0, 200)
    const tasks = tasksOfDispatch(e, briefs, laneTagged(e))
    /* an isolated spawn carries no cwd (measured) and its worktree is cut later: its open reads it */
    const place = !tasks.length ? {} : !e.cwd && isolated.has(String(e.tool_use_id)) ? { isolated: true } : await gitPlace($, e.cwd)
    return { tasks, job, stateNote: stateNoteNamed([e.prompt, ...noteBriefs]), place }
  } catch { return null }
}
const topSpawn = (e: any): boolean => !e.parentAgentId && !e.workflow && !e.resume

/* another session's open run on a task the spawn names refuses it, naming the run; a read
   that fails refuses nothing, and the open after it tells the session what the board said. found:
   the tasks whose runs came back, for the dispatch block's last run lines */
async function spawnHeld($: any, s: SpawnRun | null): Promise<{ taken: string; found: any[] }> {
  try {
    if (!s || !s.tasks.length) return { taken: '', found: [] }
    const sid = await sessionId($)
    if (!sid) return { taken: '', found: [] }
    const found = (await Promise.all(s.tasks.map(async (task) => {
      const r = await localVerb($, 'taskRuns', { input: { task }, session: sid })
      return r.ok && r.result && Array.isArray(r.result.runs) ? { task, runs: r.result.runs } : null
    }))).filter(Boolean)
    return { taken: heldRunsRefusal(found, sid, { now: Date.now(), pc: hereNow().pc }), found }
  } catch { return { taken: '', found: [] } }
}

/* the repo, branch and start commit of a folder: the spawn's own, else the session's */
async function gitPlace($: any, dir?: string): Promise<any> {
  const r = await modGit($)(dir && String(dir).trim() ? String(dir) : await projectDir($), PLACE_ARGS)
  const [top, head, branch] = String(r.out).split(/\r?\n/).map((s) => s.trim())
  return r.status === 0 && top && head ? { repo: top, branch, startCommit: head } : {}
}

/* the Agent calls asking for a worktree, by call id, which their spawn shares */
const isolated = new Set<string>()
function isolatedCall(e: any): void {
  if (toolInput(e).isolation !== 'worktree' || !e.tool_use_id) return
  isolated.add(String(e.tool_use_id))
  if (isolated.size > 50) isolated.delete(isolated.values().next().value as string)
}

/* an isolated agent's worktree, which the engine names by the agent's id; its HEAD at the open is the start commit */
async function agentWorktree($: any, id: string): Promise<any> {
  const r = await modGit($)(await projectDir($), ['worktree', 'list', '--porcelain'])
  if (r.status !== 0) return {}
  const tail = 'agent-' + id
  for (const block of String(r.out).split(/\r?\n\s*\r?\n/)) {
    const path = ((/^worktree (.+)$/m.exec(block) || [])[1] || '').trim()
    const branch = ((/^branch (.+)$/m.exec(block) || [])[1] || '').trim()
    if (path && (path.replace(/[\\/]+$/, '').endsWith(tail) || branch.endsWith(tail))) return gitPlace($, path)
  }
  return {}
}

/* the worktree the engine cut for an isolated agent, from a foreground call's result or a background
   agent's end notification (its launch result carries none): its run takes that place once its end has landed.
   The engine removes a worktree left unchanged, so a folder git cannot read is placed as named */
async function runPlaced($: any, out: any): Promise<void> {
  const path = out && typeof out.worktreePath === 'string' ? out.worktreePath.trim() : ''
  const id = out && out.agentId ? String(out.agentId) : ''
  if (!path || !id) return
  const pending = runEnding.get(id)
  if (pending) await pending.p
  const run = [...runTick.ended].reverse().find((r: any) => r && r.agentId === id) || runTick.open.find((r: any) => r && r.agentId === id)
  if (!run || !run.session) return
  const p = await gitPlace($, path)
  const repo = p.repo || (/^[A-Za-z]:\\/.test(path) ? path.replace(/\\/g, '/') : path)
  const r = await localVerb($, 'endRun', { input: { run: run.run, place: { repo, branch: out.worktreeBranch || p.branch || null } }, session: run.session })
  if (r.ok) runRefresh(r.result && r.result.run)
}
/* the kept copy takes a place given later, so a resume reads where its last run worked */
function runRefresh(run: any): void {
  if (!run || run.run === undefined) return
  for (const list of [runTick.open, runTick.ended]) {
    const i = list.findIndex((x: any) => x && x.run === run.run)
    if (i >= 0) list[i] = { ...list[i], repo: run.repo, branch: run.branch, startCommit: run.startCommit }
  }
}

/* the run opens once the engine answers with the agent's id: a dispatch on the tasks it
   names, a resume the session's SendMessage asked for (no tasks) a new run on its last run's open tasks, a workflow on its call's id.
   Never awaited by the hook and never throws: the spawn hook's catch would spawn again */
function runOpen($: any, agentId: any, job: string, tasks: string[], stateNote = '', place?: any): void {
  try {
    if (!agentId || !job) return
    const id = String(agentId)
    const p = (async () => {
      /* a resume opens as the session of the agent's last run, which a /clear may have left under an older id */
      const last = tasks.length ? null : runTick.open.find((r: any) => r && r.agentId === id) || [...runTick.ended].reverse().find((r: any) => r && r.agentId === id)
      const sid = (last && last.session) || await sessionId($)
      if (!sid) return
      const at = await runPlace($, id, last, place)
      const input = { ...(tasks.length ? { tasks } : {}), job, agentId: String(agentId), ...at, ...(stateNote ? { stateNote } : {}) }
      const r = await localVerb($, 'openRun', { input, session: sid })
      if (r.ok) return runKept(sid, r.result && r.result.run)
      /* a race the read missed or a board refusal: the agent runs with no run on the board */
      noteLater('AskerDo: the board did not open a run for agent "' + flatWords(job).slice(0, 80) + '"' + (tasks.length ? ' on ' + tasks.join(', ') : '')
        + ' (' + flatWords(String(r.error || 'no answer')).slice(0, 300) + '). It runs with no run on the board, so the task does not show it.'
        + ' If another session\'s run holds the task, it moves only by a take-over on the user\'s word: task_update with inHand true and takeOver true, then dispatch again.')
    })().catch(() => {})
    /* the agent's end waits for its open */
    runOpening.set(id, p)
    void p.finally(() => { if (runOpening.get(id) === p) runOpening.delete(id) })
  } catch {}
}
const runOpening = new Map<string, Promise<void>>()
/* a resume works where its last run did, an agent the worktree list names (an isolated call or an isolating
   definition) in that worktree; only an agent with neither takes the spawn's or the session's place. A last repo git
   cannot read was a worktree the engine removed: no place rather than the session's */
async function runPlace($: any, id: string, last: any, place: any): Promise<any> {
  if (last && last.repo) { const p = await gitPlace($, last.repo); if (p.repo) return p }
  const wt = await agentWorktree($, id)
  if (wt.repo) return wt
  /* the worktree may not be listed yet, so the agent's first call reads it again */
  placeOwed.add(id)
  if (placeOwed.size > 50) placeOwed.delete(placeOwed.values().next().value as string)
  if ((last && last.repo) || (place && place.isolated)) return {}
  return place && place.repo ? place : gitPlace($)
}
const placeOwed = new Set<string>()
/* at an agent's first call, before it runs: a worktree named by its id now gives its run repo, branch and start commit */
async function placeLate($: any, id: string): Promise<void> {
  await runOpening.get(id)
  if (!placeOwed.delete(id)) return
  const p = await agentWorktree($, id)
  const run = runTick.open.find((r: any) => r && r.agentId === id)
  if (!p.repo || !run || !run.session) return
  const r = await localVerb($, 'endRun', { input: { run: run.run, place: p }, session: run.session })
  if (r.ok) runRefresh(r.result && r.result.run)
}
function spawnOpen($: any, e: any, res: any, s: SpawnRun | null): void {
  if (!res || res.deny || e.parentAgentId) return
  /* its depth is kept from the spawn, for the lane size at its end */
  const sized = () => { if (res.agentId && !agents.has(res.agentId)) agents.set(res.agentId, { last: 0, tokens: 0 }) }
  if (e.resume && !e.workflow) { sized(); return runOpen($, res.agentId, String(e.name || e.description || '').trim().slice(0, 200), []) }
  if (s && s.tasks.length) {
    sized(); checks.named++; runOpen($, res.agentId, s.job, s.tasks, s.stateNote, s.place)
    /* the Agents row names the tasks it serves, so two agents of one job read apart */
    const f = res.agentId ? flight.get(String(res.agentId)) : null
    if (f) { f.tasks = s.tasks.slice(0, 4); flightRedraw($, true); flightSave($) }
  }
}

/* the task ids a run serves, as the board gives them */
const runTaskIds = (run: any): string[] => (run && Array.isArray(run.tasks) ? run.tasks : []).map((t: any) => String((t && (t.id || t)) || '')).filter(Boolean)

/* the open run a loop works under: its top agent's (a workflow agent's is its Workflow call's row),
   from the tick's kept runs, else one read of the session's; null when none */
async function agentRun($: any, agentId: string, sid: string): Promise<any> {
  let id = agentId
  for (let i = 0, f = flight.get(id); f && f.parent && i < 10; i++, f = flight.get(id)) id = f.parent
  const top = flight.get(id)
  if (top && top.wf) {
    const w = bgList().find((b) => b.kind === 'workflow' && ((top.call && b.call === top.call) || (top.run && b.run === top.run)))
    if (!w) return null
    id = w.id
  }
  await runOpening.get(id)
  const kept = runTick.open.find((r: any) => r && r.agentId === id) || [...runTick.ended].reverse().find((r: any) => r && r.agentId === id)
  if (kept || !sid) return kept || null
  const r = await localVerb($, 'sessionRuns', { input: { session: sid }, session: sid })
  return (r.ok && r.result && Array.isArray(r.result.runs) ? r.result.runs : []).find((x: any) => x && x.agentId === id) || null
}

/* an agent's end ends its run with the engine's word (runEndHow), its report and its CONTINUE line (its
   state note's, else the answer's), as the session that opened it; the lane size note goes on the ended
   run's tasks. An agent with no kept run (a helper, a dispatch naming no task) sends nothing. Never throws */
const REPORT_CUT = 200000
async function runEnd($: any, agentId: string, answer: string, word?: string, run?: any): Promise<void> {
  const a = agents.get(agentId)
  agents.delete(agentId)
  const sid = await sessionId($)
  await runOpening.get(agentId)
  let kept = run || runTick.open.find((r: any) => r && r.agentId === agentId)
  /* a tick's older answer can drop a run opened while it was in flight: one read of the session's, as agentRun */
  if (!kept && sid) {
    const r = await localVerb($, 'sessionRuns', { input: { session: sid }, session: sid })
    kept = (r.ok && r.result && Array.isArray(r.result.runs) ? r.result.runs : []).find((x: any) => x && x.agentId === agentId)
  }
  if (!kept || !kept.session) return
  let noteText = ''
  const note = await agentStateNote($, agentId)
  if (note) { try { noteText = String(await $.fs.read(note)) } catch {} }
  const handed = handedOn(noteText) ?? handedOn(answer)
  const continueLine = continueLineOf(noteText) || continueLineOf(answer)
  const input: any = { agentId, how: runEndHow(word, handed), ...(answer.trim() ? { report: answer } : {}), ...(continueLine ? { continueLine } : {}) }
  let r = await localVerb($, 'endRun', { input, session: kept.session })
  /* a report past the route's body limit goes cut */
  if (!r.ok && /over \d+ bytes/.test(String(r.error)) && input.report) r = await localVerb($, 'endRun', { input: { ...input, report: input.report.slice(0, REPORT_CUT) }, session: kept.session })
  if (!r.ok) return
  runTick.open = runTick.open.filter((x: any) => !(x && x.agentId === agentId))
  const ended = r.result && r.result.run
  if (ended) { runTick.ended.push(ended); if (runTick.ended.length > RUN_ENDED_KEPT) runTick.ended.shift() }
  /* owed goes by the engine's stop word, so an agent handing on with a report still waits for it */
  if (r.result && r.result.ended && ended) await settleAfter($, ended, sid, word === 'killed' || word === 'stopped').catch(() => {})
  /* the bound's end judges no lane size: the agent waited, it did not run out */
  if (!(r.result && r.result.ended) || !a || !a.tokens || word === 'held') return
  const body = laneNote(a.tokens, ended && ended.job, handed, ended && ended.stateNote)
  for (const t of runTaskIds(ended)) {
    await cli($, ['note', t, '--session', sid || kept.session, '--json'], body)
    lanes.byTask.delete(t)
  }
}

/* An ended run whose tasks are not settled is kept in the store under the session, so a reload
   and the stop check read it, and the settle words ride the next prompt or call; one block read per task */
const UNSETTLED_KEY = 'unsettled:'
const UNSETTLED_KEPT = 20
/* owed: a background agent's run that ended before its report reached the session; noReport: it left none */
type Unsettled = { run: number; tasks: string[]; job: string; ended: string; session: string; agentId?: string; owed?: boolean; noReport?: boolean; stateNote?: string; branch?: string }
/* the agents whose report reached the session (a hand-back, or a notification carrying it), by id;
   the background spawns, kept past their flight row, whose report comes on its own prompt */
const reported = new Set<string>()
const bgSpawned = new Set<string>()
function reportsHeard(text: string): void {
  const r = reportsIn(text)
  for (const id of [...r.names.map((n: string) => agentNames.get(n) || n), ...r.ids]) reported.add(String(id))
  while (reported.size > 200) reported.delete(reported.values().next().value as string)
}
/* an owed run is left out of the stop for this long, in case its report never comes */
const OWED_MS = 10 * 60000
const owedNow = (x: Unsettled): boolean => !!x.owed && !(x.agentId && reported.has(x.agentId)) && Date.now() - (Date.parse(x.ended) || 0) < OWED_MS
async function blocksOf($: any, tasks: string[]): Promise<any[]> {
  const rs = await Promise.all(tasks.map((t) => cli($, ['task', 'block', t, '--json']).catch(() => ({ ok: false } as any))))
  return rs.map((r) => (r.ok && r.json && r.json.id ? r.json : null))
}
async function unsettledRead($: any, sid: string): Promise<Unsettled[]> {
  try { const v = await $.store.get(UNSETTLED_KEY + sid); return Array.isArray(v) ? v : [] } catch { return [] }
}
async function unsettledWrite($: any, sid: string, list: Unsettled[]): Promise<void> {
  try { if (list.length) await $.store.set(UNSETTLED_KEY + sid, list.slice(-UNSETTLED_KEPT)); else await $.store.delete(UNSETTLED_KEY + sid) } catch {}
}
/* every read-modify-write of one session's list runs in turn, so two ends, or an end and a report's
   prompt, never drop an entry; fn answers the new list */
const unsettledChain = new Map<string, Promise<unknown>>()
function unsettledEdit($: any, sid: string, fn: (list: Unsettled[]) => Unsettled[] | Promise<Unsettled[]>): Promise<Unsettled[]> {
  const p = (unsettledChain.get(sid) || Promise.resolve()).then(async () => {
    const list = await unsettledRead($, sid)
    const next = await fn(list)
    if (JSON.stringify(next) !== JSON.stringify(list)) await unsettledWrite($, sid, next)
    return next
  })
  const tail = p.catch(() => {})
  unsettledChain.set(sid, tail)
  void tail.then(() => { if (unsettledChain.get(sid) === tail) unsettledChain.delete(sid) })
  return p
}
async function settleAfter($: any, ended: any, sid: string, stopped = false): Promise<void> {
  const tasks = runTaskIds(ended)
  if (!tasks.length || !sid) return
  const mine = [...new Set([sid, ...runTick.sids])]
  const blocks = (await blocksOf($, tasks)).filter((b) => b && !blockSettled(b, ended.ended, mine))
  if (!blocks.length) return
  /* the plan's settle words ride the report: a background agent's that has not reached the session waits for it;
     decided in the chain, so a report heard meanwhile is either seen here or finds the entry */
  const id = String(ended.agentId || '')
  let owed = false
  await unsettledEdit($, sid, (list) => {
    owed = !!(id && bgSpawned.has(id) && !stopped && ended.report && !reported.has(id))
    return [...list.filter((x) => x.run !== ended.run), { run: ended.run, tasks: blocks.map((b) => b.id), job: String(ended.job || ''), ended: String(ended.ended || ''), session: String(ended.session || sid),
      ...(id ? { agentId: id } : {}), ...(owed ? { owed } : {}), ...(ended.report ? {} : { noReport: true }),
      ...(ended.stateNote ? { stateNote: String(ended.stateNote) } : {}), ...(ended.branch ? { branch: String(ended.branch) } : {}) }]
  })
  if (!owed) noteLater(settleWords(blocks, [ended], mine.filter((x) => x !== sid)))
}
/* a report that came after its run's end: its settle words ride the prompt carrying it */
async function owedSettle($: any): Promise<void> {
  const sid = await sessionId($)
  if (!sid) return
  let due: Unsettled[] = []
  await unsettledEdit($, sid, (list) => {
    due = list.filter((x) => x.owed && x.agentId && reported.has(x.agentId))
    return list.map((x) => (due.includes(x) ? { ...x, owed: undefined } : x))
  })
  if (!due.length) return
  const { left, blocks } = await unsettledSweep($, sid)
  const runs = left.filter((x) => due.some((d) => d.run === x.run))
  const words = settleWords([...new Set(runs.flatMap((x) => x.tasks))].map((t) => blocks.get(t)).filter(Boolean), runs, [...new Set(runTick.sids)].filter((x) => x !== sid))
  if (words) noteLater(words)
}
/* a settle through task_update drops the kept runs whose tasks all read settled now; `at` the id they are kept under
   (the stop reads each earlier id of this process too); answers what is left with its blocks */
async function unsettledSweep($: any, sid: string, at = sid): Promise<{ left: Unsettled[]; blocks: Map<string, any> }> {
  const list = await unsettledRead($, at)
  const blocks = new Map<string, any>()
  if (!list.length) return { left: [], blocks }
  const mine = [...new Set([sid, at, ...runTick.sids])]
  const ids = [...new Set(list.flatMap((x) => x.tasks))]
  ;(await blocksOf($, ids)).forEach((b, i) => blocks.set(ids[i], b))
  /* the blocks are read outside the chain; an entry kept meanwhile, whose tasks were not read, stays as it is */
  const left = await unsettledEdit($, at, (now) => now.map((x) => ({ ...x, tasks: x.tasks.filter((t) => !blocks.has(t) || !blockSettled(blocks.get(t), x.ended, mine)) })).filter((x) => x.tasks.length))
  return { left, blocks }
}

/* the main loop's stop. '' lets it through, else the refusal's words. Never
   throws: a failed read lets the stop through. The pick: an unsettled ended run refuses with or without workers in flight */
async function stopCheck($: any, e: any): Promise<string> {
  try {
    if (e && e.stop_hook_active) return ''
    const sid = await sessionId($)
    if (!sid) return ''
    /* an agent's end still landing (its recheck, its run's end) is kept before the stop reads, capped */
    await endsWait($, [...runEnding.values()].map((x) => x.p))
    const mine = [...new Set([sid, ...runTick.sids])]
    const kept = (await Promise.all(mine.map((s) => unsettledRead($, s)))).some((l) => l.length)
    const track = mem.track
    if (!track && !kept) return ''
    await readClosed($, sid)
    if (closedAs(sid) === 'handed off') return ''
    const view = track ? await localVerb($, 'trackView', { input: { track }, session: sid }) : null
    const v = view && view.ok && view.result ? view.result : null
    if (track && await holdHere($, sid, track, v)) return ''
    if (kept) {
      const left = (await Promise.all(mine.map((s) => unsettledSweep($, sid, s))))
      const runs = left.flatMap((x) => x.left).filter((x) => !owedNow(x))
      const blocks = [...new Set(runs.flatMap((x) => x.tasks))].map((t) => left.map((x) => x.blocks.get(t)).find(Boolean)).filter(Boolean)
      if (blocks.length) return stopSettleWords(settleWords(blocks, runs, mine.filter((x) => x !== sid)))
    }
    if (workersOut(e) || !v || waitsOnUser(sid, mine, e)) return ''
    const ready = (Array.isArray(v.readySet) ? v.readySet : []).filter((t: any) => t && t.id)
    const key = STOP_NAMED_KEY + sid
    const named: string[] = await Promise.resolve($.store.get(key)).then((x: any) => (x && Array.isArray(x.ids) ? x.ids : [])).catch(() => [])
    const fresh = ready.filter((t: any) => !named.includes(String(t.id)))
    if (!fresh.length) return ''
    /* `at` lets a later session's load trim it once this one is gone */
    try { await $.store.set(key, { at: Date.now(), ids: [...named, ...fresh.map((t: any) => String(t.id))].slice(-200) }) } catch {}
    return stopReadyWords(fresh, track)
  } catch { return '' }
}
const STOP_NAMED_KEY = 'stopNamed:'
/* workers in flight: an agent of the module's, a workflow row, or the engine's own list naming a running one */
function workersOut(e: any): boolean {
  if (flightList().some((f) => !f.done) || bgList().some((b) => b.kind === 'workflow' && !b.done)) return true
  return (Array.isArray(e && e.background_tasks) ? e.background_tasks : [])
    .some((t: any) => t && ['subagent', 'workflow'].includes(String(t.type)) && LIVE_AGENT.includes(String(t.status)))
}
/* the session waits on the user: an open question it asked, a kept one, or a reply that asks */
function waitsOnUser(sid: string, mine: string[], e: any): boolean {
  const asked = (band.questions || []).some((q: any) => q && mine.includes(q.session) && (!q.status || ['open', 'snoozed'].includes(q.status)))
  return asked || (local.sid === sid && localOpen().length > 0) || replyAsks(e && e.last_assistant_message)
}
/* the user's hold on the track: a decision labelled hold, since this session took it */
async function holdHere($: any, sid: string, track: string, v: any): Promise<boolean> {
  const r = await localVerb($, 'decisionsFor', { input: { track }, session: sid })
  if (!r.ok) return false
  const h = v && v.holder
  return holdOn(Array.isArray(r.result) ? r.result : [], track, h && h.session === sid ? h.since : '')
}

/* a main loop workflow's run ends with its notification's or the list's word */
function bgRunEnd($: any, b: Bg): void {
  if (b.kind !== 'workflow' || b.agent !== undefined) return
  const word = b.status === 'failed' ? 'failed' : b.status === 'killed' ? 'killed' : 'completed'
  void runEnd($, b.id, '', word).catch(() => {})
}

/* one timer a minute renews the lease, the session's runs and its live agents' runs in one
   write (renewLease); the answer's open runs are kept for the next tick and the end paths */
const RUN_TICK_MS = 60000
const RUN_SIDS_KEY = 'runSessions:'
/* open: the last answer's open runs; ended: the runs this process ended, newest last (for the commit join) */
const runTick: { timer?: { cancel: () => void }; last?: number; busy?: boolean; quiet?: boolean; open: any[]; ended: any[]; sids: Set<string>; older: string[] } =
  { open: [], ended: [], sids: new Set(), older: [] }
const RUN_ENDED_KEPT = 50
function runKept(sid: string, run: any): void {
  runTick.quiet = false
  runTick.sids.add(sid)
  if (run && run.run !== undefined && !runTick.open.some((x: any) => x && x.run === run.run)) runTick.open.push(run)
}
/* armed at each session start, so a hot reload, which cancels the module's waits, arms it again; it
   ignores the band's freeze, since agents may run under a closed band */
function runTickArm($: any): void {
  if (runTick.timer) return
  try { runTick.timer = $.clock.every(RUN_TICK_MS, ran('run timer', () => { void runTickNow($).catch(() => {}) })) } catch { runTick.timer = undefined }
  void runSidsRead($).catch(() => {})
}
function runTickStop(): void {
  try { if (runTick.timer) runTick.timer.cancel() } catch {}
  runTick.timer = undefined
}
/* After /clear the runs keep the old session id, so the ids this process opened runs
   under ride the store under the current id, and a reload reads them back */
async function runSidsRead($: any): Promise<void> {
  const sid = await sessionId($)
  const v = sid ? await $.store.get(RUN_SIDS_KEY + sid) : null
  for (const x of Array.isArray(v) ? v : []) if (typeof x === 'string' && x && x !== sid) runTick.sids.add(x)
}
async function runTickNow($: any): Promise<void> {
  if (runTick.busy) return
  runTick.busy = true
  try {
    const sid = await sessionId($)
    if (!sid) return
    let listed: any = null
    try { listed = await $.agent.list() } catch {}
    /* the sweep's work: an agent the list shows ended with no turn.complete seen */
    if (Array.isArray(listed)) { void flightSweep($, listed).catch(() => {}); heldSweep($, listed, await clockNow($), heldWaitOf(await seamEnv($).catch(() => undefined))) }
    const agentIds = liveRunIds(listed, flightList(), bgList())
    /* a session with no lease, no open run and nothing live writes nothing; the first tick always writes */
    if (runTick.quiet && !agentIds.length && !mem.track && !(band.hand && band.hand.length)) { runTick.last = Date.now(); return }
    const r = await localVerb($, 'renewLease', { input: { session: sid, agentIds }, session: sid })
    /* offline or refused: nothing said, the next minute tries again */
    if (!r.ok) { runTick.quiet = false; return }
    runTick.last = Date.now()
    const open = r.result && Array.isArray(r.result.runs) ? r.result.runs : []
    runTick.open = open
    /* after a reload only the open put this id in sids: an agent run under it is renewed as it after a /clear */
    if (open.some((x: any) => x && x.worker === 'agent')) runTick.sids.add(sid)
    runTick.quiet = !(r.result && r.result.held) && !open.length
    runTick.open = [...open, ...await runOlder($, sid, agentIds)]
  } finally { runTick.busy = false }
}
/* Each older id of this process that still has open agent runs renews the live ones as that session */
async function runOlder($: any, sid: string, agentIds: string[]): Promise<any[]> {
  const older = [...runTick.sids].filter((x) => x !== sid)
  const kept: any[] = []
  if (agentIds.length) {
    for (const old of older) {
      const r = await localVerb($, 'renewRuns', { input: { agentIds }, session: old })
      const runs = r.ok && r.result && Array.isArray(r.result.runs) ? r.result.runs.filter((x: any) => x && x.worker === 'agent') : []
      if (r.ok && !runs.length) runTick.sids.delete(old)
      kept.push(...runs)
    }
  }
  const now = [...runTick.sids].filter((x) => x !== sid)
  if (String(now) !== String(runTick.older)) {
    runTick.older = now
    try { if (now.length) await $.store.set(RUN_SIDS_KEY + sid, now); else await $.store.delete(RUN_SIDS_KEY + sid) } catch {}
  }
  return kept
}
/* at each load, the board's open agent runs of this session and the older ids kept, against the engine's
   list: one listed live stays for the tick to renew; one listed ended ends as the list says, with no report; one
   the list does not name, or with no agent id, is left unrenewed, so it reads unconfirmed */
async function runReload($: any): Promise<void> {
  await runSidsRead($).catch(() => {})
  const sid = await sessionId($)
  if (!sid) return
  if (await reopened($)) return runReopen($, sid)
  let listed: any = null
  try { listed = await $.agent.list() } catch {}
  if (!Array.isArray(listed)) return
  const status = new Map<string, string>(listed.filter((a: any) => a && a.id).map((a: any) => [String(a.id), String(a.status)]))
  for (const s of [...new Set([sid, ...runTick.sids])]) {
    const r = await localVerb($, 'sessionRuns', { input: { session: s }, session: s })
    for (const run of r.ok && r.result && Array.isArray(r.result.runs) ? r.result.runs : []) {
      const st = run && run.worker === 'agent' && run.agentId ? status.get(String(run.agentId)) : undefined
      if (!st || LIVE_AGENT.includes(st) || agentsGone.has(String(run.agentId))) continue
      agentsGone.add(String(run.agentId))
      await runEnd($, String(run.agentId), '', st, run).catch(() => {})
    }
  }
}
/* at a reopen no agent of the old process lives, so each open agent run of this session
   and its older ids ends handed on, with no report */
async function runReopen($: any, sid: string): Promise<void> {
  for (const s of [...new Set([sid, ...runTick.sids])]) {
    const r = await localVerb($, 'sessionRuns', { input: { session: s }, session: s })
    for (const run of r.ok && r.result && Array.isArray(r.result.runs) ? r.result.runs : []) {
      if (!run || run.worker !== 'agent') continue
      if (run.agentId) agentsGone.add(String(run.agentId))
      await localVerb($, 'endRun', { input: { run: run.run, how: 'handed_on' }, session: s })
    }
  }
}

/* a reopen is a load in another engine process under the same session id. The process keeps its
   mark in its own environment, which a hot reload keeps; the store keeps each session's last mark, the flights too */
const proc: { mark?: string; reopen?: Promise<boolean>; sid?: string } = {}
const PROCS_KEY = 'procSessions'
/* one key per session, so no other session's write evicts or races it; flightTrim ages them out */
const PROC_KEY = 'proc:'
const PROC_AGE = 30 * 86400000
async function procOf($: any, sid: string): Promise<string> {
  const v: any = await $.store.get(PROC_KEY + sid)
  if (v && typeof v.mark === 'string' && v.mark) return v.mark
  /* the shared map a build before the per-session key wrote */
  const all = ((await $.store.get(PROCS_KEY)) || {}) as Record<string, string>
  return typeof all[sid] === 'string' ? all[sid] : ''
}
async function procMark($: any): Promise<string> {
  if (proc.mark) return proc.mark
  let m = ''
  try { m = String((await $.env.get('ASKERDO_PROC')) || '') } catch {}
  if (!m) {
    m = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    try { await $.env.set('ASKERDO_PROC', m) } catch {}
  }
  return (proc.mark = m)
}
/* the mark the store held for the session before this one, writing this one */
async function procSeen($: any, sid: string): Promise<string> {
  const mark = await procMark($)
  proc.sid = sid
  const was = await procOf($, sid)
  if (was === mark) return was
  await $.store.set(PROC_KEY + sid, { mark, at: Date.now() })
  return was
}
/* the one place that says this load is a reopen, read once a load */
function reopened($: any): Promise<boolean> {
  return proc.reopen || (proc.reopen = (async () => {
    const sid = await sessionId($)
    if (!sid) return false
    const mark = await procMark($)
    const flights: any = await Promise.resolve($.store.get(FLIGHTS_KEY + sid)).catch(() => null)
    const was = (await procSeen($, sid)) || (flights && typeof flights.proc === 'string' ? flights.proc : '')
    return !!was && was !== mark
  })().catch(() => false))
}
/* a /clear's new id keeps this process's mark too, so its own reopen is known */
async function procKeep($: any): Promise<void> {
  const sid = await sessionId($)
  if (sid && sid !== proc.sid) await procSeen($, sid)
}

/* A main loop turn after a gap (the PC slept, or the timer paused while hidden) renews at once */
function runCatchUp($: any): void {
  if (runTick.last !== undefined && Date.now() - runTick.last <= RUN_TICK_MS) return
  void runTickNow($).catch(() => {})
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

/* The cards slice. told: tool_use_id -> the question its ask registered, for the result
   row; kept in $.store too, so a reload or a resumed transcript draws the same card. faces: each live card's
   model as last drawn and the count it read; kept: each settled card's last drawing; due: the
   records the told map's next write carries */
const told = new Map<string, any>()
const TOLD_KEEP = 50
const toldLoad: { loading?: Promise<void> } = {}
const tellings = {
  told,
  faces: new Map<string, { id: string; sig: string }>(),
  kept: new Map<string, { key: string; q: any; tree: any; drawn: any[]; tokens: string[] }>(),
  due: new Set<string>(),
  next: undefined as Promise<void> | undefined,
  writing: Promise.resolve() as Promise<unknown>,
}
/* the newest drawn hundred of each: a card dropped from them is drawn afresh when its reply is */
const CARDS_KEPT = 100
function keptPut<K, V>(m: Map<K, V>, k: K, v: V): void {
  m.delete(k)
  m.set(k, v)
  for (const old of m.keys()) { if (m.size <= CARDS_KEPT) break; m.delete(old) }
}

async function keepTold($: any, useId: string, q: any): Promise<void> {
  /* the card's head reads its age from the ask */
  if (!told.has(useId) && !q.created) q.created = new Date().toISOString()
  /* a settled card keeps the age and here mark it settled with */
  if (cardSettled(q) && !q.frozen) q.frozen = { at: Date.now(), here: hereNow() }
  told.set(useId, q)
  touch('cards')
  tellings.due.add(useId)
  /* a batch (Send) writes the map once, at its end */
  if (!sched.hold) await toldWrite($)
}
/* one write at a time, each carrying every record changed since the last; one asked while another waits
   its turn is that one */
function toldWrite($: any): Promise<void> {
  const t = tellings
  if (t.next) return t.next
  const run = t.writing.then(async () => {
    t.next = undefined
    const ids = [...t.due]
    t.due.clear()
    if (!ids.length) return
    try {
      const all: any = (await $.store.get('told')) || {}
      for (const u of ids) if (told.has(u)) all[u] = told.get(u)
      const keys = Object.keys(all)
      for (const k of keys.slice(0, Math.max(0, keys.length - TOLD_KEEP))) delete all[k]
      await $.store.set('told', all)
    } catch {}
  })
  t.next = run
  t.writing = run.catch(() => {})
  return run
}

/* answered, dropped or reworded, a card keeps its last drawing; a snooze wakes, so a snoozed one
   stays live, as does an override request's */
const cardSettled = (q: any): boolean => !!q && !q.override && (!!q.answered || (!!q.ended && !q.snoozed) || !!changedStub(q))
/* a record kept before cards held their frozen drawing settles at its first draw */
function frozenOf(q: any): { at: number; here: any } {
  if (!q.frozen) q.frozen = { at: Date.now(), here: hereNow() }
  return q.frozen
}
/* A live card's model, everything its drawing reads: the cards' check compares it and the
   draw draws from it, so no list of its inputs is kept by hand */
type CardModel = { id: string; over?: any; c?: any; view?: QuestionsView; opts?: any }
function cardModel(useId: string, q: any, sid: string | undefined, now: number): CardModel | null {
  const id = cardCount(useId, q)
  if (q.override) return { id, over: overrideCard(q, ovPressing.get(useId), now) }
  const c = firstTellingCard(q, sid, now, band.local)
  if (!c) return null
  const stub = changedStub(q)
  return { id, c, view: cardView(q.id), opts: { answered: q.answered, ended: q.ended, changed: stub ? stub.line : undefined, here: hereNow() } }
}
const only = (m: any, id: string): any => (m && id in m ? { [id]: m[id] } : {})
/* the pane's view as one card reads it: its question's entries only, the whole queue under an open strip
   (it shows the count); the rings ride their own state */
function cardView(id: string): QuestionsView {
  const v = qpane
  return { unfolded: v.unfolded, notes: v.notes, confirm: v.confirm, asking: v.asking === id ? id : undefined,
    answering: only(v.answering, id), strip: only(v.strip, id), drawn: only(v.drawn, id),
    queued: (v.strip || {})[id] ? v.queued : only(v.queued, id) }
}
function modelSig(m: CardModel | null): string {
  if (!m) return ''
  const { unfolded: _u, notes: _n, ...view } = m.view || ({} as any)
  return JSON.stringify([m.over, m.c, view, m.opts])
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
  /* a reply that had a card, or one a telling moves off, reads the cards' count; the reply that
     gains its first card drew without one and reads its own */
  const had = [at, key].some((k) => k && (tellAt.get(k) || []).length)
  const off = [...tellAt].some(([k, v]) => k !== at && k !== key && v.some((u) => asks.includes(u)))
  const mine = move(Object.fromEntries(tellAt))
  tellAt.clear()
  for (const [k, v] of Object.entries(mine)) tellAt.set(k, v)
  laterRedraw($, [...(had || off ? ['card'] : []), ...replyIds(at, key)], 'cards')
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
  qpaneRedraw($, [qCount(q.id), ...OWN], 'cards')
}

async function tellingPick($: any, useId: string, q: any, letter: string): Promise<void> {
  if (q.answered) return
  const note = (qpane.notes[q.id] || '').trim()
  /* the card it drew is the told record itself, so its key answers it; with the version it
     showed, so a press racing a rewording's redraw is refused, and the band's next load redraws it */
  const r = await pressAnswer($, q.id, letter, () => recordAnswer($, q.key || q.id, letter, 'card', note || undefined, q.id, q.local ? undefined : q.version || 1), 'cards',
    async (r) => {
      q.answered = token(q.id, r.pick || letter)
      noteGone(q.id)
      const moved = queueDrop($, q.id, true)
      await keepTold($, useId, q)
      return [qCount(q.id), ...OWN, ...moved]
    })
  if (!r || r.ok) return
  kick($)
  qpaneRedraw($, [qCount(q.id), ...OWN], 'cards')
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
    /* the three wake conditions combine, a record waited on among them, in the Asleep row's words */
    const wake = asleepWake(z, todayIs()).text.replace(/[.!?]+$/, '')
    q.ended = 'Snoozed ' + q.id + (wake ? ' ' + wake : '') + '.'
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
  /* the kept questions are the board's to every model that lists them (tabsModels) */
  touch('board')
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

async function localAsk($: any, sid: string, payload: any, useId?: string): Promise<any> {
  const q = await localQueued(async () => {
    const e = await localRead($, sid)
    e.n += 1
    const kept: LocalQ = { label: 'L' + e.n, payload, created: new Date().toISOString(), status: 'open', ...(useId ? { use: useId } : {}) }
    e.qs.push(kept)
    await localSave($, sid, e)
    return kept
  })
  if (useId) await keepTold($, useId, localCard(q, sid))
  laterRedraw($)
  return { result: localResult(q.label, payload) }
}

/* a kept question rewords in this session's store, keeping its L-n, its
   earlier cards stubbed as a board question's are; one filed since rewords on the board. */
async function localReword($: any, sid: string, raw: any, useId?: string): Promise<any> {
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
  if (out.filed) return rewordAsk($, sid, { ...raw, edits: out.filed.id }, useId)
  if (out.deny) return { deny: 'ask refused: ' + out.deny }
  const q: LocalQ = out.q
  if (useId && out.changed.length) {
    await loadTold($)
    const now = { reworded: { version: q.version } }
    for (const [u, t] of [...told]) {
      if (u !== useId && t && t.id === q.label && !changedStub(t) && rewordedSince(t, now)) { t.reworded = now.reworded; await keepTold($, u, t) }
    }
    await keepTold($, useId, { ...localCard(q, sid), version: q.version, reworded: now.reworded })
  }
  laterRedraw($)
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
  /* no site (the tool, a Send) is no press: the gate draws it */
  if (site) qpaneRedraw($)
  else laterRedraw($)
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
      /* a kept go's answer is the user's (a press, or a message answerTool checked) */
      const users = q.status === 'answered' && keptGo(q)
      const a = await cli($, [...how, ...(q.note ? ['--note', q.note] : []), users ? '--user' : '--session', sid, '--json'])
      if (!a.ok) lost = ', though its ' + (q.status === 'dropped' ? 'drop' : 'answer') + ' did not reach the board (' + a.err + ')'
      /* told already as the kept label, so its inbox line is not told again */
      else if (users) { toolTold.push({ id, kind: 'answer' }); if (toolTold.length > 20) toolTold.shift() }
    }
    e.qs.shift()
    e.filed[q.label] = { id, ...(r.json.key ? { key: r.json.key } : {}) }
    e.renamed.push(q.label + ' is now ' + id + ' on the board' + lost + '.')
    if (q.use) {
      await loadTold($)
      const t = told.get(q.use)
      if (t) {
        /* an answer the board refused leaves the card open, to be answered there */
        const { local: _l, answered: _a, ended: _e, ...rest } = t
        const now: any = { ...rest, id, key: r.json.key, name: r.json.name || t.name, ask: r.json.ask || t.ask, boardUrl: r.json.boardUrl, workstream: r.json.workstream || t.workstream, was: q.label }
        if (q.status === 'answered' && !lost) now.answered = q.pick ? token(id, q.pick) : String(q.note || '').slice(0, 80)
        if (q.status === 'dropped' && !lost) now.ended = 'Dropped ' + id + (q.note ? ': ' + q.note : '') + '.'
        await keepTold($, q.use, now)
      }
    }
    await localSave($, sid, e)
    moved = true
  }
  if (moved) { kick($, true); laterRedraw($) }
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

/* This turn's reply text as stored, and the dispatches flagged. The main loop's
   dispatches and commits, and whether a task was in hand as they ran or taken this turn. */
const checks: { texts: string[]; agents: any[]; resume?: string; carry?: string; inbox?: { track: string; ids: string[]; due?: string[]; away?: string[]; more?: boolean }; dispatched: number; named: number; commits: number; holding: boolean
  /* the turn's refused filings not yet paired; the tasks its asks gate */
  refused: { work: string; call: string }[]; gated: string[] } = {
  texts: [], agents: [], dispatched: 0, named: 0, commits: 0, holding: false, refused: [], gated: [],
}
/* the main loop's own filings only: a subagent files nothing */
function refusedNow(work: string, call: string): void { checks.refused.push({ work, call }) }
function landedNow(work?: string): void { checks.refused = pairRefused(checks.refused, work) }

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

/* the agent tasks running on the tracks this session holds, read from the board's view
   each time rather than kept in memory, so a mod reload still names them; a task its agent
   left with steps open sits in the ready rows, and its close still lands the agent's work */
function agentTasksHere(sid: string): string[] {
  const out: string[] = []
  const tracks = band.graph && band.graph.view && band.graph.view.tracks
  for (const tr of Array.isArray(tracks) ? tracks : []) {
    if (!tr || !tr.holder || tr.holder.session !== sid) continue
    const left = Array.isArray(tr.readySet) ? tr.readySet.filter(settles) : []
    for (const t of [...(Array.isArray(tr.now) ? tr.now : []), ...left]) {
      const id = String((t && t.id) || '')
      if (t.agent && /^T-\d+$/.test(id) && !out.includes(id)) out.push(id)
    }
  }
  return out
}

/* this turn ran the sweep verb or skill, whose reader's dispatch is the sweep's own read */
let sweepTurn = false
const SWEEP_SKILL = /(?:^|:)sweep$/
function sweepSeen(e: any): void {
  if ((e.tool === 'Skill' && SWEEP_SKILL.test(String(toolInput(e).skill || '')))
    || (COMMAND_TOOLS.includes(e.tool) && hubRan(toolInput(e).command, 'sweep'))) sweepTurn = true
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
/* sent: the blocks as first sent this session, with the facts they were built for; told: each block's text
   the session has, sent or told since; composed: the session a main prompt was last composed for */
type Facts = { surfaces: string[]; tools: string[] }
const carry: { facts?: Facts; resumed?: 'prime' | 'primed' | 'told'; toldResume?: boolean; marked?: string
  sent?: any[]; sentFacts?: Facts; told?: Record<string, string>; sid?: string; composed?: string; loading?: Promise<any[]> } = {}
const joined = (blocks: any[]) => blocks.map((b) => b.text).join('\n\n')

function invalidateCarrier($: any): void {
  try { $.ui.invalidate('prompt.section') } catch {}
}

/* a main prompt with no carrier means the engine renamed it, so the blocks reach a recorded
   prompt only at a session's start; once per session it is logged and marked for askerdo status */
async function carrierSeen($: any, has: boolean): Promise<void> {
  const sid = await sessionId($)
  if (!sid || carry.marked === sid) return
  carry.marked = sid
  /* a compose ran, so the prompt half is on here again */
  try { await $.store.delete('promptOff') } catch {}
  if (!has) debugLine($, 'AskerDo: this prompt has no ' + CARRIER + ' section, so rule changes reach the session only at its next start (askerdo status names it)')
  const r = await spawn($, ['node', $.plugin.root + '/scripts/mod-carrier.mjs', has ? 'seen' : 'missing', '--session', sid], { timeoutMs: 15000 })
  /* the band's health was read at its first draw, before the mark */
  if (!has && r && r.exitCode === 0) healthStale()
}

/* where Claude Code's built-in guard loads (managed settings, a Team or Enterprise login), a
   user's mod's prompt and classic hooks never run. Two answered turns that sent a request with none of
   them firing in this load conclude it: a reload's cached prompt still hears classic.Stop each turn */
const OFF_TURNS = 2
const OFF_NOTICE = 'AskerDo: its prompt hooks did not run in this session, as happens where an organization manages Claude Code (managed settings, or a Team or Enterprise login). '
  + 'Its rules and sections ride your prompts as notes instead; the band, the pane and the askerdo CLI work as usual. askerdo status says more.'
const OFF_LEAD = 'AskerDo\'s prompt hooks do not run in this session (an organization\'s guard keeps them off), so its blocks ride this prompt instead of the system prompt; a later note of a changed block takes its place.'
const half: { ran: boolean; stepped: boolean; quiet: number; off: boolean; was?: boolean; told?: string } = { ran: false, stepped: false, quiet: 0, off: false }

function promptRan(): void {
  half.ran = true
  half.off = false
}

async function halfQuiet($: any, e: any): Promise<void> {
  const stepped = half.stepped
  half.stepped = false
  if (half.ran || half.off || e.isAborted || !stepped || ++half.quiet < OFF_TURNS) return
  /* a user's own disableAllHooks stops the classic hooks without any guard */
  let own: any = false
  try { own = await $.settings.read({ key: 'disableAllHooks' }) } catch {}
  if (own === true) return
  half.off = true
  const sid = await sessionId($).catch(() => '')
  debugLine($, 'AskerDo: no prompt or classic hook ran in ' + OFF_TURNS + ' answered turns; the prompt half is off here')
  if (sid) void spawn($, ['node', $.plugin.root + '/scripts/mod-carrier.mjs', 'off', '--session', sid], { timeoutMs: 15000 }).catch(() => {})
  let told = false
  try { told = !!(await $.store.get('promptOff')) } catch {}
  try { await $.store.set('promptOff', { at: Date.now() }) } catch {}
  if (!told) try { $.ui.toast(OFF_NOTICE) } catch {}
}

/* the fallback: once the prompt half is off (this load, or a PC that saw it before), the blocks ride a prompt */
async function offBlocks($: any): Promise<string> {
  if (half.ran) return ''
  if (half.was === undefined) { try { half.was = !!(await $.store.get('promptOff')) } catch { half.was = false } }
  if (!half.off && !half.was) return ''
  /* once a session: a /clear's new id takes them again */
  const sid = await sessionId($).catch(() => '')
  if (half.told === sid) return ''
  half.told = sid
  const blocks = await sentBlocks($).catch(() => null)
  return blocks && blocks.length ? OFF_LEAD + '\n\n' + joined(blocks) : ''
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
  const c = await readContract($).catch(() => null)
  /* the session's one per-surface section rides from the first request, engaged or
     not, since the style's two are cut wherever it does (styleCut) */
  const side = c && c.section && c.surfaces ? c.surfaces[surfacePick(surfaces, tools)] : null
  const mine = side ? [{ id: PLUGIN + ':surface', text: side, scope: 'session' }] : []
  /* the mod's sections arrive once the session is engaged, whatever the surfaces read:
     a desktop session another session started composes with none even while its band draws */
  if (!(await isEngaged($))) return [...mine, ...own]
  const text = c && c.section ? c.section : bandSection()
  /* read only where no band draws, the names line stays */
  const bare = noBandHere(surfaces, tools) ? [{ id: PLUGIN + ':no-band', text: noBandSection(), scope: 'session' }] : []
  return [{ id: PLUGIN + ':band', text, scope: 'session' }, ...mine, ...bare, ...own]
}

/* The blocks stay as first sent for the session: a changed system prompt rewrites the prompt cache
   and drops the model's earlier reasoning, so a change reaches the session as a note (carryNote) */
const SENT_KEPT = 5
const CHANGED_NOTE = 'An AskerDo block changed since this session\'s system prompt was sent. The block below takes the place of the one of its kind there (the later as-of time wins) until the next session starts, when the system prompt carries it.'

async function keepSent($: any): Promise<void> {
  try {
    const all: any = (await $.store.get('carrierSent')) || {}
    delete all[carry.sid as string]
    all[carry.sid as string] = { sent: carry.sent, facts: carry.sentFacts, told: carry.told }
    const keys = Object.keys(all)
    for (const k of keys.slice(0, Math.max(0, keys.length - SENT_KEPT))) delete all[k]
    await $.store.set('carrierSent', all)
  } catch {}
}

/* this session's sent blocks from memory or the store (a reload keeps them); with none, built now,
   or read: none, or empty: a carrier this module never answered, so it holds none of them */
async function sentBlocks($: any, mode: 'build' | 'read' | 'empty' = 'build'): Promise<any[] | null> {
  const sid = await sessionId($).catch(() => mem.id || '')
  if (carry.sent && carry.sid === sid) return carry.sent
  if (carry.loading && carry.sid === sid) return carry.loading
  carry.sid = sid
  carry.sent = undefined
  const run = (async () => {
    let kept: any = null
    try { kept = ((await $.store.get('carrierSent')) || {})[sid] || null } catch {}
    if (kept && Array.isArray(kept.sent)) {
      carry.sentFacts = kept.facts
      carry.told = kept.told || {}
      return (carry.sent = kept.sent)
    }
    if (mode === 'read') return null as any
    const f = carry.facts || { surfaces: mem.surfaces || [], tools: [] }
    const blocks = mode === 'empty' ? [] : await modBlocks($, f.surfaces, f.tools)
    carry.sentFacts = f
    carry.told = Object.fromEntries(blocks.map((b: any) => [b.id, b.text]))
    carry.sent = blocks
    await keepSent($)
    return blocks
  })()
  carry.loading = run
  try { return await run } finally { if (carry.loading === run) carry.loading = undefined }
}

/* Once a prompt: the blocks that changed since the session last had them, as one note; quiet when
   a resumed thread's context carries them all */
async function carryNote($: any, quiet: boolean): Promise<string> {
  /* a request went out with a carrier this module never answered (loaded mid-session): it tells them all */
  const sent = await sentBlocks($, carry.composed && carry.composed === await sessionId($).catch(() => '') && !carry.resumed ? 'empty' : 'read')
  if (!sent) return ''
  const f = carry.sentFacts || carry.facts || { surfaces: mem.surfaces || [], tools: [] }
  const now = await modBlocks($, f.surfaces, f.tools)
  const told = carry.told || (carry.told = {})
  const moved = now.filter((b: any) => told[b.id] !== b.text)
  if (!moved.length) return ''
  for (const b of moved) told[b.id] = b.text
  await keepSent($)
  return quiet ? '' : CHANGED_NOTE + '\n\n' + joined(moved)
}

/* The contract's per-surface sections by their headings (lib/builder.js): each runs from its heading
   through its bullet list; text the cut does not recognise stays */
const SURFACE_HEADS = ['### On the desktop app', '### On the terminal and anywhere else']
function withoutSurfaces(text: string): string {
  const lines = text.split('\n')
  for (const head of SURFACE_HEADS) {
    const at = lines.findIndex((l) => l.trimEnd() === head)
    if (at < 0) continue
    let end = at + 1
    while (end < lines.length && !lines[end].startsWith('- ') && !/^#{1,3} /.test(lines[end])) end++
    if (end >= lines.length || !lines[end].startsWith('- ')) continue
    while (end < lines.length && lines[end].startsWith('- ')) end++
    const from = at > 0 && lines[at - 1] === '' ? at - 1 : at
    lines.splice(from, end - from)
  }
  return lines.join('\n')
}

/* the style loses its two sections only where the session's blocks carry the surface block:
   the blocks as first sent (a resume answers the same), else the saved contract they are built from */
async function styleCut($: any): Promise<boolean> {
  const sent = await sentBlocks($, 'read').catch(() => null)
  if (sent) return sent.some((b: any) => b.id === PLUGIN + ':surface')
  const c = await readContract($).catch(() => null)
  return !!(c && c.section && c.surfaces && c.surfaces.desktop && c.surfaces.terminal)
}

/* a compaction rewrites the whole prompt anyway, so the system prompt takes the blocks as they are now */
async function carrierFresh($: any): Promise<void> {
  const sid = await sessionId($).catch(() => mem.id || '')
  carry.sent = undefined
  carry.sid = undefined
  /* no compose since, so a prompt before the next request reads no carrier as unanswered */
  carry.composed = undefined
  try { const all: any = (await $.store.get('carrierSent')) || {}; delete all[sid]; await $.store.set('carrierSent', all) } catch {}
  invalidateCarrier($)
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

/* The tasks of this session's own open agent runs whose job is one of the names, from the runs
   already held, so a dispatch waits on no read; another session's run never counts */
function ownJobTasks(names: string[]): string[] {
  const want = new Set(names.map((n) => String(n || '').trim().toLowerCase()).filter(Boolean))
  if (!want.size) return []
  const runs = runTick.open.filter((r: any) => r && r.worker === 'agent' && runTick.sids.has(String(r.session))
    && want.has(String(r.job || '').trim().toLowerCase()))
  return [...new Set(runs.flatMap(runTaskIds))]
}
function laneTagged(input: any): string[] {
  try { return ownJobTasks(namesOf(input && input.name, input && input.description)) } catch { return [] }
}

/* the dispatch checks run where rules are in force (none with no board); a
   brief file the prompt names is read for lines against them. */
async function agentFlag($: any, input: any, top = false): Promise<string> {
  const briefs: string[] = []
  for (const f of briefPaths(input.prompt, await projectDir($))) {
    try { const t = await $.fs.read(f); if (typeof t === 'string') briefs.push(t) } catch {}
  }
  /* the tasks it serves, for the dispatch checks and the last lane's flag */
  const tasks = tasksOfDispatch(input, briefs, laneTagged(input))
  /* a dispatch naming tasks the mod cannot read is told with the call's answer */
  const missed = top && !input.resume && (await isEngaged($).catch(() => false)) ? dispatchMissed(input, tasks) : ''
  const r = await readRules($).catch(() => null)
  if (!(r && r.values)) return missed
  const name = String(input.description || input.subagent_type || 'an agent').slice(0, 60)
  const slips = agentChecks(input, { briefs, rules: r.values, inject: r.inject !== false, lanes: await laneSizes($, tasks).catch(() => []) })
  flagSlips($, 'the dispatch of ' + name, slips.filter((s: any) => !laneSaid(s)))
  return missed
}

/* a task's lane flag is said once a turn, on the first dispatch; the line under it is
   written then, so the later ones count only in the turn's note */
function laneSaid(slip: any): boolean {
  if (!/^lane /.test(String(slip && slip.id))) return false
  const first = checks.agents.flatMap((x: any) => x.slips).find((s: any) => s && s.id === slip.id)
  if (!first) return false
  first.n = (first.n || 1) + 1
  first.say = String(first.base || (first.base = first.say)) + ' (' + first.n + ' dispatches this turn carry it on)'
  return true
}

/* a desktop session driven while its window is not attached composes with no
   surface, yet the band carries its questions wherever it draws */
async function bandHere($: any): Promise<boolean> {
  if (mem.surfaces && mem.surfaces.length) return bandSurfaces(mem.surfaces)
  if (drawnOn.size) return bandSurfaces([...drawnOn])
  try { return bandSurfaces(await $.session.surfaces()) } catch { return false }
}

/* of a close's inbox ids, those still in the inbox, read once from the board; a failed read keeps them all.
   split into the ones the reply names and the due ones it places or wakes again (inboxLeft) */
async function stillInbox($: any, closed?: { track: string; ids: string[]; due?: string[]; away?: string[]; more?: boolean }, gated: string[] = []): Promise<{ name: string[]; due: string[] }> {
  if (!closed || !closed.ids.length) return { name: [], due: [] }
  if (!closed.track) return inboxLeft(closed, null, undefined, gated)
  const r = await cli($, ['track', 'show', closed.track, '--json']).catch(() => null)
  const ws = r && r.ok && r.json && r.json.workstream ? r.json.workstream.id : undefined
  return inboxLeft(closed, r && r.ok && Array.isArray(r.json && r.json.inbox) ? r.json.inbox : null, ws, gated)
}

async function replyCheck($: any, e: any): Promise<void> {
  const texts = checks.texts
  const items = checks.agents
  const resume = checks.resume
  const carry = checks.carry
  const closed = checks.inbox
  const shellLeft = shellMove.left || []
  shellMove.left = []
  /* a dispatch that named its task shows on the track by its run, with nothing in hand */
  const work = { dispatched: Math.max(0, checks.dispatched - checks.named), commits: checks.commits, holding: checks.holding, sweep: sweepTurn }
  const unfiled = refusedLeft(checks.refused)
  const gated = checks.gated
  checks.refused = []
  checks.gated = []
  sweepTurn = false
  checks.texts = []
  checks.agents = []
  checks.resume = undefined
  checks.carry = undefined
  checks.inbox = undefined
  checks.dispatched = 0
  checks.named = 0
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
    const left = await stillInbox($, closed, gated)
    const slips = replyChecks({ answer: e.answer, all: texts.length ? texts.join('\n\n') : e.answer,
      checks: c.checks, band: await bandHere($), windowTold, handoffAsked: !!marks.asked,
      /* the receipt rule rides the mod section alone */
      receipts: engaged ? due.map((r) => ({ token: r.token, after: r.turn === mem.turn && r.at > 0 ? texts[r.at] : undefined })) : [], resume, carry, held, inbox: left.name, due: left.due, running: runningHere(), left: shellLeft })
    if (slips.length) {
      try { $.ui.log(flagLine('this reply', slips)) } catch {}
      items.push({ what: 'your last reply', slips })
    }
    /* counted at the turn's end, so a task taken in hand later in the turn clears it; a commit
       or dispatch beside this session's own agent run on a task is that lane's work */
    const lane = runTick.open.some((r: any) => r && r.worker === 'agent' && runTick.sids.has(String(r.session)) && runTaskIds(r).length > 0)
    const holding = work.holding || (band.hand || []).length > 0 || lane
    const sid = await sessionId($)
    const off = engaged ? offTrackSlip({ ...work, holding, track: held, onboarding: onboarding.has(sid), agentTasks: agentTasksHere(sid) }) : null
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
  /* the mod's own check, saved options or not */
  if (unfiled && !e.isAborted) {
    try { $.ui.log(flagLine('this turn', [unfiled])) } catch {}
    items.push({ what: 'this turn', slips: [unfiled] })
  }
  if (!items.length) return
  noteLater(flagNote(items))
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

/* A flag note on the call's result and a toast, never a block. A command's hits on cards that
   opt in go into `ran`, so the run is recorded once the call's exit is known (procRecord). */
async function procWatch($: any, e: any, ran: any[] = []): Promise<string[]> {
  const out: string[] = []
  const cards = await procCards($)
  if (!cards.length) return out
  const hits = matchCall(cards, { tool: e.tool, input: toolInput(e), cwd: await projectDir($) })
  const test = hits.some((h) => recordsRun(h.card, e.tool)) && testRun(toolInput(e).command, await shellDirs($, e))
  ran.push(...hits.filter((h) => recordsRun(h.card, e.tool) && !test))
  for (const h of hits) {
    const k = (e.agentId || 'main') + ' ' + h.card.id
    if (procs.told.has(k)) continue
    procs.told.add(k)
    if (!procs.toasted.has(h.card.id)) {
      procs.toasted.add(h.card.id)
      toast($, procToast(h.card), 'ambient', 8000)
    }
    out.push(procNote(h.card, h.why, { agent: !!e.agentId, recorded: recordsRun(h.card, e.tool), test }))
  }
  return out
}

/* where a command runs: the main loop's shell, or an agent's run place (its worktree); an agent with
   no run found by its id in the worktree list, kept once looked up, a miss too ('': an agent with no
   worktree), since the engine cuts an agent's worktree before its first call and it never moves */
const agentDirs = new Map<string, string>()
async function shellDirs($: any, e: any): Promise<string[]> {
  if (e.agentId === undefined) { try { return [String(await $.session.cwd() || '')] } catch { return [] } }
  const id = String(e.agentId)
  const run = runTick.open.find((r: any) => r && r.agentId === id)
  if (run && run.repo) return [String(run.repo)]
  if (!agentDirs.has(id)) {
    const wt = await agentWorktree($, id).catch(() => ({}))
    agentDirs.set(id, wt.repo ? String(wt.repo) : '')
    if (agentDirs.size > 50) agentDirs.delete(agentDirs.keys().next().value as string)
  }
  const dir = agentDirs.get(id) as string
  return dir ? [dir] : []
}

/* A matched command that exited 0 (no error, not interrupted, not sent to the background)
   is a clean run, recorded once per card per loop and turn; a deviation is the session's to say. */
const procRan = new Set<string>()
function procRecord($: any, e: any, res: any, hits: any[]): void {
  const r = res && !res.isError && !res.deny ? res.result : null
  if (!r || (typeof r === 'object' && (r.interrupted || r.backgroundTaskId))) return
  for (const h of hits) {
    const k = (e.agentId || 'main') + ' ' + h.card.id + ' ' + mem.turn
    if (procRan.has(k)) continue
    procRan.add(k)
    void (async () => {
      const argv = ['proc', 'ran', h.card.slug, 'clean', '--project', await projectDir($), '--session', await sessionId($),
        '--note', 'recorded by AskerDo: ' + h.why + ', and it exited 0', '--json']
      /* the cards read again when the store's marker moves, as after any board write */
      if (!(await cli($, argv)).ok) procRan.delete(k)
    })().catch(() => { procRan.delete(k) })
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

/* a knowledge record's file globs point too, unless the rules in force switch pointers.knowledge off;
   the prompt's own cached rules read, and with no board the setting is its default, on */
async function knowledgeOn($: any): Promise<boolean> {
  const r = await readRules($).catch(() => null)
  return !(r && r.values && r.values['pointers.knowledge'] === false)
}

async function decisionWatch($: any, e: any): Promise<string[]> {
  const out: string[] = []
  const rows = await decisionRows($)
  if (!rows.length) return out
  const input = toolInput(e), cwd = await projectDir($)
  /* a shell's relative paths resolve where its cd left it; an agent's shell is not the session's */
  let shellCwd = cwd
  if (COMMAND_TOOLS.includes(e.tool) && e.agentId === undefined) try { shellCwd = String(await $.session.cwd() || cwd) } catch {}
  const t0 = performance.now()
  const hits = decisionHits(rows, { tool: e.tool, input, cwd, shellCwd })
  matchTimed(e.agentId !== undefined, performance.now() - t0)
  let factsOn: boolean | undefined
  /* the call's hits gathered first, then told as one: notes, one toast, one read */
  const told: any[] = []
  for (const h of hits) {
    const k = (mem.id || '') + ' ' + (e.agentId || 'main') + ' ' + h.decision.id
    if (decs.told.has(k)) continue
    /* a row with no type comes from a board that hands out decisions alone */
    const fact = h.decision.type !== undefined && h.decision.type !== 'decision'
    if (fact) {
      if (factsOn === undefined) factsOn = await knowledgeOn($)
      if (!factsOn) continue
    }
    decs.told.add(k)
    told.push({ ...h, fact })
  }
  if (!told.length) return out
  const subject = callSubject(e.tool, input, cwd)
  const fresh = told.filter((h) => !decs.toasted.has(h.decision.id))
  for (const h of fresh) decs.toasted.add(h.decision.id)
  if (fresh.length) toast($, pointerToast(fresh, subject), 'ambient', 8000)
  const ruled = told.filter((h) => !h.fact).map((h) => h.decision.id)
  if (ruled.length) void readOnce($, ruled, 'toast').catch(() => {})
  out.push(...pointerNotes(told, subject))
  return out
}

/* The block of each task a dispatch serves, and the rulings for the tasks whose block did not
   come back (a failed read): each decision told once, the briefs read once. Agent dispatches
   only: the engine fixes a workflow's and a resumed agent's prompt. */
async function dispatchContext($: any, e: any): Promise<{ ruled: string, held: string, labels?: string[] }> {
  const briefs: string[] = []
  for (const f of briefPaths(e.prompt, await projectDir($))) {
    try { const t = await $.fs.read(f); if (typeof t === 'string') briefs.push(t) } catch {}
  }
  const tasks = tasksOfDispatch(e, briefs, laneTagged(e)).slice(0, 5)
  if (!tasks.length) return { ruled: '', held: '' }
  const blocks = await Promise.all(tasks.map((t) => cli($, ['task', 'block', t, '--json']).catch(() => ({ ok: false } as any))))
  const got = (i: number) => blocks[i].ok && blocks[i].json && typeof blocks[i].json.text === 'string' && blocks[i].json.text.trim()
  const missing = tasks.filter((_t, i) => !got(i))
  const runs = await Promise.all(missing.map((t) => cli($, ['decisions', '--task', t, '--json'])))
  const shown = runs.flatMap((r) => (r.ok && Array.isArray(r.json) ? r.json : []))
  void readOnce($, briefDecisionIds(blocks.map((r, i) => (got(i) ? r.json : null)), shown), 'brief').catch(() => {})
  /* the tasks' labels, each a role the dispatch plays */
  const labels = blocks.flatMap((r) => (r.ok && r.json && Array.isArray(r.json.labels) ? r.json.labels : []))
  return { ruled: decisionsBlock(missing, shown), held: taskBlocks(blocks.map((r, i) => (got(i) ? r.json.text : ''))), labels }
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
  if (p.sub === 'scan' && p.check) {
    const r = await cli($, ['proc', 'scan', '--check', '--project', cwd, '--json'])
    /* exit 1 means a file has errors, and the report is still on stdout */
    let report: any
    if (r.code === 0 || r.code === 1) try { report = JSON.parse(r.out) } catch {}
    return report ? checkText(report) : failed('Checking the procedure files', r)
  }
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
    if (p.fixed) argv.push('--fixed', p.fixed)
    if (p.oneOff) argv.push('--one-off', p.oneOff)
    if (p.filed) argv.push('--filed', p.filed)
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
const subagentPlace = 'place refused: a subagent files nothing. Found work goes in your report (a message to main, or in your final result), '
  + 'and your session places each item the turn the report arrives; carry on with the work in hand.'
const subagentDecide = (n: string) => 'decide refused: a subagent records no ruling, since only its session saw ' + n + '\'s words. A ruling you were told of goes in your report (a message to main, or in your final result), '
  + 'and your session records it; carry on with the work in hand.'
const subagentFact = 'fact refused: a subagent records nothing. A fact you found goes in your report (a message to main, or in your final result), '
  + 'and your session records it the turn the report arrives; carry on with the work in hand.'
/* an agent's own task writes are refused; it reports its steps by number for the session to tick */
const subagentTaskWrite = 'refused: an agent writes no task. Report each step of your task by its number in your final result (done, with the evidence, '
  + 'or not done and why) and anything found; your session ticks the steps and writes the board. Carry on with the work in hand.'
const subagentFactWrite = 'refused: an agent records no fact or ruling on the board. What you found goes in your report (a message to main, or in your final result), '
  + 'and your session records it the turn the report arrives; carry on with the work in hand.'
/* the user's mark is the plugin's, sent on their own press or command */
const forgedDeny = (how: string) => how === 'override' ? 'refused: an override press with --user is ' + nameOf() + '\'s own, which the plugin sends from their press on the override card '
  + 'or their /askerdo allow, keep, withdraw, fix, scrub or unscrub; a session never sends it. Ask with the override_request tool and wait for their press. Carry on with the work in hand.'
  : 'refused: ' + (how === 'user' ? '--user is the mark of ' + nameOf() + '\'s own press or command, which the plugin sends; a session never sends it'
  : how === 'session' ? 'this filing names another session (--session); a session files as itself'
  : 'this filing clears or sets CLAUDE_CODE_SESSION_ID, so the board would not see the session filing it')
  + '. File found work with the place tool (a close\'s leftovers with task_update): off the track you hold or last on it, the board asks ' + nameOf() + ' where it goes. Carry on with the work in hand.'
const placementOnly = (id: string, what = 'where found work goes') => 'refused: ' + id + ' asks ' + nameOf() + ' ' + what + ', so only they answer it: their press on the card or the band, /askerdo with its token, '
  + 'or the token they type in chat, which you record with the answer tool. Carry on with the work in hand.'
/* the /askerdo command and the user's alias, as the Skill tool names them */
const ownCommand = (skill: any) => { const s = String(skill || '').replace(/^\//, '').replace(/^askerdo:/, ''); return s === COMMAND || (!!alias.name && s === alias.name) }
const modelCommand = (args: string) => 'refused: /' + COMMAND + ' ' + args.trim() + ' is ' + nameOf() + '\'s own command and carries their mark, so only they run it. '
  + 'A token they typed goes through the answer tool, and found work through the place tool. Carry on with the work in hand.'
const toolFailed = ($: any, e: any, next: any) => ({ deny: PLUGIN + ': the tool failed before it answered; nothing may have been written. Check with the CLI.' })

async function bandSite($: any, e: any, next: any): Promise<any> {
  drawnOn.add(e.surface)
  /* a hot reload lost the memory: read it back; the status row draws meanwhile, the band after */
  await snapBack($)
  await bandBackWithin($)
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
  /* the band never yields to the app's box; under it, the band
     draws above the box, which stays nearest the prompt */
  const short = !!e.props.hasSurvey
  const b = band.loaded ? bandParts($) : null
  /* on the desktop the band is one needs line; what it has no room for rides the mark's card */
  let drops: NeedsDrop | null = null
  const oursAt = (t: BandTrim) => b && b.model && handedKeys(bandTree(els, bandCut(b.model, t), b.answer, {
    columns: e.props.bodyColumns, rows: e.props.maxRows - (sm ? 1 : 0), now: Date.now(), short, surface: e.surface,
    open: b.open, submit: b.submit, send: b.send, press: b.press, fold: b.fold, strip: b.strip, still: b.still, dropped: (d) => { drops = d },
  }), e.surface)
  /* after oursAt, whose draw says what the needs line dropped */
  const statusAt = (t: BandTrim) => (sm ? handedKeys(statusKeptTree('band', liveEls(els, e), statusCut(dropsOn(sm, drops), t), null,
    { columns: e.props.bodyColumns, surface: e.surface, ...statusPresses($), ...(t.bare ? { cards: false } : {}) }), e.surface) : null)
  const ours = oursAt({})
  const status = statusAt({})
  const at = Date.now()
  const lastBand = (tree: any, o: any, s: any, d: NeedsDrop | null) => {
    drawnLast.band = { at, cols: e.props.bodyColumns, surface: e.surface, model: b ? b.model : null, loading: !band.loaded, drops: d,
      parts: [o ? (desk ? 'the needs line' : 'the band\'s rows') : '', s ? 'the status row' : ''].filter(Boolean), ...(tree ? paneSized(tree) : {}) }
    if (sm) drawnLast.status = { at, cols: e.props.bodyColumns, surface: e.surface, site: 'band', m: sm, tree: s, fit: cardFitOf('band', e.surface) }
  }
  /* nothing open or waiting: no band, and the app's content still draws */
  if (!ours && !status) { lastBand(null, ours, status, drops); return next(e) }
  const theirs = short || !ours ? await next(e) : null
  /* a half line between the band and the status row on the desktop, never
     before the app's slot (an empty block there, so its gap would draw an empty row); BAND_INSET on the left lines the mark's ink up with the composer's + (desktop-capabilities 2f) */
  const built = new Map<any, [any, any, NeedsDrop | null]>()
  const whole = (o: any, s: any) => {
    let tree: any
    if (!short && !s && !desk) tree = o
    else {
      const rows = [o, s].filter(Boolean)
      const ownRows = desk && theirs && rows.length > 1 ? [els.Box({ key: 'band-rows', flexDirection: 'column', rowGap: 1, children: rows })] : rows
      const gap = desk ? { ...(theirs ? {} : { rowGap: 1 }), paddingLeft: BAND_INSET } : {}
      tree = els.Box({ key: 'band-and-box', flexDirection: 'column', ...gap, children: [...ownRows, theirs].filter(Boolean) })
    }
    if (tree && typeof tree === 'object') built.set(tree, [o, s, drops])
    return tree
  }
  const first = whole(ours, status)
  /* past the page's bounds the band's hover cards give way; under them, this one build and one count */
  const at2 = (t: BandTrim) => { const o = oursAt(t); return whole(o, statusAt(t)) }
  const { rungs, end } = bandRungs(sm, b && b.model)
  const g = first && typeof first === 'object' ? ladderGuard('band|' + e.surface, (t: BandTrim) => (Object.keys(t).length ? at2(t) : first), rungs,
    () => at2({ qs: 0, run: 0, wait: 0, bare: true }), end).tree : first
  const [o, s, d] = built.get(g) || [ours, status, drops]
  lastBand(g, o, s, d)
  return g
}

/* the status model with the band's dropped chips on the mark's card, kept per model so the row's cache holds */
const dropKept: { m?: any; sig?: string; out?: any } = {}
function dropsOn(m: any, d: NeedsDrop | null): any {
  const facts = d ? bandDropFacts(d) : []
  if (!facts.length || !m || !m.mark || !m.mark.card) return m
  const sig = JSON.stringify(facts)
  if (dropKept.m !== m || dropKept.sig !== sig) {
    Object.assign(dropKept, { m, sig, out: { ...m, mark: { ...m.mark, card: { ...m.mark.card, where: [...facts, ...(m.mark.card.where || [])] } } } })
  }
  return dropKept.out
}

/* the tellings a reply carries, by its row id or its text; null for a reply with no card */
function usesOf(e: any): string[] | null {
  const uses = tellAt.get(e.requestId) || tellAt.get(textKey(e.props && e.props.text) || '')
  return uses && uses.length ? uses : null
}

/* a reply with no card reads only its own counts, by its row id and its text key, which move
   only when a telling is placed under that reply */
const replyIds = (...keys: (string | undefined)[]): string[] => keys.filter(Boolean).map((k) => 'reply ' + k)
async function replyDraw($: any, e: any, next: any): Promise<any> {
  await loadTellAt($)
  /* a reply's card reads its questions' counts, so a press or a change draws that question's cards alone;
     a settled card too, so its rings draw, its kept drawing standing otherwise */
  const uses = usesOf(e)
  const kept = () => drawKept($, 'reply ' + e.surface + ' ' + e.requestId, () => replySite($, e, next))
  if (uses) {
    if (uses.some((u) => !told.has(u))) await loadTold($)
    const shown = uses.filter((u) => told.has(u))
    return ringDraw($, 'card', kept, ['card', ...new Set(shown.map((u) => cardCount(u, told.get(u))))])
  }
  return ringDraw($, 'reply', kept, replyIds(e.requestId, textKey(e.props && e.props.text)))
}

async function replySite($: any, e: any, next: any): Promise<any> {
  await loadTellAt($)
  const uses = usesOf(e)
  if (!uses) return next(e)
  await snapBack($)
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
    if (!q) continue
    const settled = cardSettled(q)
    /* a settled card's last drawing, again only for another width, surface or ring of its own */
    const was = settled ? tellings.kept.get(useId) : undefined
    const at = (tokens: string[]) => e.surface + ' ' + columns + ' ' + (q.answered || '') + (q.ended || '') + ' ' + tokens.filter((t) => qpane.unfolded.has(t)).join(',')
    if (was && was.q === q && was.key === at(was.tokens)) {
      drawn.push(...was.drawn)
      if (was.tree) cards.push(was.tree)
      continue
    }
    /* drawn from its model; a settled one with the age and here mark it settled with */
    const frozen = settled ? frozenOf(q) : null
    const m = cardModel(useId, q, sid, frozen ? frozen.at : now)
    if (!m) continue
    if (frozen && m.opts) m.opts.here = frozen.here
    if (settled) tellings.faces.delete(useId)
    else keptPut(tellings.faces, useId, { id: m.id, sig: modelSig(m) })
    /* an override request's slim card, its block hidden as a question's is */
    if (m.over) {
      drawn.push(q)
      cards.push(overrideTellingTree(els, m.over, (d: string) => { void overridePress($, useId, q, d).catch(() => {}) }, e.surface, columns))
      continue
    }
    /* a filed question's reply still names its local label */
    const names = q.was ? [q, { ...q, id: q.was }] : [q]
    drawn.push(...names)
    const keep = (tree: any) => {
      if (!settled) return
      const tokens = (m.c.options || []).map((o: any) => o.token)
      keptPut(tellings.kept, useId, { key: at(tokens), q, tree, drawn: names, tokens })
    }
    /* reworded since, the card is its one changed line, which follows nothing more;
       none where this reply also carries the current telling (asked and reworded in one turn) */
    if (m.opts.changed && uses.some((u) => { const o = told.get(u); return o && o !== q && (q.key ? o.key === q.key : o.id === q.id) && !changedStub(o) })) { keep(null); continue }
    /* a card drawn live is followed from the band's reads, never read here */
    if (!settled && !follow.drawn.has(useId)) { follow.drawn.add(useId); fresh = true }
    const act = cardActions($, (id: string, letter: string) => { void tellingPick($, useId, q, letter).catch(() => {}) },
      (verb) => { void tellingEnd($, useId, q, verb).catch(() => {}) },
      { site: 'card', useId, key: q.key, local: !!q.local, version: q.local ? undefined : q.version || 1 })
    act.open = (id: string) => { void openPane($, 'questions', id).catch(() => {}) }
    const tree = firstTellingTree(els, m.c, m.view as QuestionsView, act, { columns, ...m.opts, surface: e.surface })
    keep(tree)
    cards.push(tree)
  }
  /* first drawn after the band loaded (a reload, an old reply scrolled to): one follow now */
  if (fresh && band.loaded) {
    try { $.clock.after(0, ran('follow timer', () => { void followRun($).then((m) => { if (m) laterRedraw($) }).catch(() => {}) })) } catch {}
  }
  if (!cards.length) return next(e)
  /* the desktop, where the card is measured to draw, draws the reply without
     the question's block; the stored message and every other screen keep it. Its
     footer draws under the last card, so it stays the last thing on screen */
  const text = e.props && typeof e.props.text === 'string' ? e.props.text : ''
  const parts = e.surface === 'desktop' && text && !e.props.isSummary ? tellingParts(text, drawn) : { body: text, footer: '' }
  const shown = parts.body
  const reply = await next(shown !== text ? { ...e, props: { ...e.props, text: shown } } : e)
  const handed = cards.map((c) => handedKeys(c, e.surface, true))
  /* past the page's bounds the cards past a count give way to one line, the reply itself kept */
  const n = handed.length
  const cut = (k: number) => underReply(els, reply, [...handed.slice(0, k), cardsCut(els, n - k)], parts.footer)
  const words = (k: number) => [k > 0 ? 'the question cards past the first ' + k : 'every question card']
  /* each reply keeps its own cut, so one long reply's k never caps the next one's cards */
  const tree = ladderGuard('card|' + e.surface + '|' + e.requestId, (t: any) => (t.cards === undefined ? underReply(els, reply, handed, parts.footer) : cut(t.cards)),
    n > 1 ? [{ step: 17, hi: n - 1, n, trim: (k) => ({ cards: k }), words }] : [], () => cut(0), { step: 17, words: words(0) }).tree
  /* a key per reply: past 64 replies' cuts the oldest goes (it only seeds a redraw), so a long session stays bounded */
  const cardKeys = [...ladderKept.keys()].filter((k) => k.startsWith('card|'))
  for (const k of cardKeys.slice(0, Math.max(0, cardKeys.length - 64))) ladderKept.delete(k)
  return tree
}

/* a track the model's own shell call took or left: the board's word, read once after the call, so
   the rules block, the band, the status line and the guard follow it (no long poll tells a closed session) */
const shellMove: { owed?: number; left?: string[] } = {}
async function trackMoved($: any, began: number): Promise<void> {
  const sid = await sessionId($)
  const was = mem.track === undefined ? null : mem.track
  const mine = band.mine && band.mine.held ? { key: mem.trackKey, name: band.mine.name, workstream: band.mine.workstream } : null
  const r = await readMine($, sid)
  if (!r.ok || mem.track === was) return
  await markerRun($, sid, mem.trackKey, mem.trackKey ? ['--write'] : [])
  if (mem.track) await liftFreeze($, sid)
  else if (was) {
    shellMove.left = [...(shellMove.left || []), was]
    await shellHandedOff($, sid, was, began, mine)
  }
  kick($, true)
}
/* a waiting handoff of the held track that the model wrote with its own shell call ends
   in the tool's freeze; a park never freezes, as with the tool */
async function shellHandedOff($: any, sid: string, track: string, began: number, mine: any): Promise<void> {
  const t = await cli($, ['track', 'show', track, '--json'])
  const list = t.ok && t.json && Array.isArray(t.json.handoffs) ? t.json.handoffs : []
  const h = list[list.length - 1]
  if (!h || h.fromSession !== sid || h.status !== 'waiting' || !(Date.parse(h.created) >= began - 5000)) return
  letGo({ track, key: mine ? mine.key : null, name: mine ? mine.name : '', workstream: mine ? mine.workstream : null, state: 'waiting', handoff: h.id, handoffStatus: 'waiting',
    focus: h.focus, created: h.created, age: '', resume: '/askerdo resume ' + track })
  await keepClosed($, sid, 'handed off')
  laterRedraw($)
}

export const register: Register = (on: any) => {
  /* the switch. Set before the settings hooks run (measured: this hook
     runs first), so the SessionStart summary and both inbox drains stay silent. */
  on('classic.SessionStart', async ($: any, e: any, next: any) => {
    promptRan()
    await $.env.set('ASKERDO_MOD', '1')
    seam.env = undefined
    if (e.source && e.source !== 'compact') mem.started = String(e.source)
    if (e.source === 'clear' && mem.clearedFrom) void settle($).catch(() => {})
    if (e.source === 'resume' || e.source === 'fork') carry.resumed = 'prime'
    if (e.source === 'compact') await carrierFresh($).catch(() => {})
    return next(e)
  }).catch(($: any, e: any, next: any) => next(e))

  on('session.start', async ($: any, e: any, next: any) => {
    const res = await next(e)
    await bootCount($).catch(() => {})
    /* a managed install skips classic hooks: the drains still go quiet here */
    try { await $.env.set('ASKERDO_MOD', '1') } catch {}
    mem.cwd = e.cwd
    seam.env = undefined
    await seamEnv($).catch(() => undefined)
    await registerAll($)
    /* the first id read checks the app row's holds */
    void sessionId($).catch(() => {})
    void queueRead($).catch(() => {})
    void sendResume($).catch(() => {})
    void bypassStart($).catch(() => {})
    startPoll($)
    /* the load reads the guard (and gives an opted-in track its marker) and delivers */
    kick($)
    /* the procedure scan starts here, so the first tool call never waits for it */
    void procCards($).catch(() => {})
    void decisionRows($).catch(() => {})
    void pruneKept($).catch(() => {})
    where.paneRead = false
    drift.key = undefined
    void readWhere($).then(() => readDrift($)).catch(() => {})
    /* the belt's first read of HEAD */
    void beltCheck($).catch(() => {})
    /* a reload's agents come back from the store and the engine's list; a handoff awaits it */
    flightLoad.done = flightRebuild($).catch(() => {})
    /* the run timer, its first tick at once */
    runTickArm($)
    void runTickNow($).catch(() => {})
    /* the board's open runs matched against the engine's list */
    void runReload($).catch(() => {})
    return res
  })

  /* delivery's idle or running: the main loop's turn */
  on('turn.start', async ($: any, e: any, next: any) => {
    /* an agent's new turn tells its recheck the turn's end was a wake, not its end */
    if (e.agentId !== undefined && flight.has(String(e.agentId))) agentTurns.set(String(e.agentId), (agentTurns.get(String(e.agentId)) || 0) + 1)
    if (e.agentId === undefined) {
      await followFolder($).catch(() => {})
      void readWhere($).catch(() => {})
    }
    const r = await next(e)
    if (e.agentId === undefined) {
      void flightSweep($).catch(() => {})
      runCatchUp($)
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
      await halfQuiet($, e).catch(() => {})
      /* a reply closed finished freezes the band until a reply that is not */
      if (!e.isAborted) {
        const sid = await sessionId($).catch(() => mem.id)
        const was = closedAs(sid)
        if (sid && closedFinished(e.answer)) { if (closedAs(sid) !== 'handed off' && was !== 'finished') await keepClosed($, sid, 'finished') }
        else if (was === 'finished') await keepClosed($, sid)
        /* the band's closed line follows; a reopened session's poll picks up at its next tick */
        if (closedAs(sid) !== was) laterRedraw($)
      }
    } else {
      messageEnded(String(e.agentId))
      await agentTurnEnd($, e.agentId, String(e.answer || '')).catch(() => {})
    }
    if (e.agentId === undefined) void beltCheck($).catch(() => {})
    return next(e)
  })

  /* the engine's list of the background work in flight, at each loop's stop */
  on('classic.Stop', async ($: any, e: any, next: any) => {
    promptRan()
    bgReconcile($, e.background_tasks)
    /* the stop check; a block keeps the turn going with its words */
    const block = await stopCheck($, e)
    return block ? { block } : next(e)
  }).catch(($: any, e: any, next: any) => next(e))
  on('classic.SubagentStop', async ($: any, e: any, next: any) => {
    promptRan()
    bgReconcile($, e.background_tasks)
    const ask = Array.isArray(e.background_tasks) ? handbackAsk(String(e.agent_id || ''), !!e.stop_hook_active) : ''
    return ask ? { block: ask } : next(e)
  }).catch(($: any, e: any, next: any) => next(e))
  /* a background task's notification row says how it ended and how long it ran */
  on('ui.render', { component: 'UserMessage' }, ($: any, e: any, next: any) => {
    const t = e.props && e.props.task
    /* after the draw, so the redraw it asks for is not refused inside one */
    const b = t && t.id ? bgTasks.get(String(t.id)) : undefined
    if (b && (!b.done || b.guessed)) {
      try { $.clock.after(0, ran('background end timer', () => bgEnd($, String(t.id), t.status, t.durationMs))) } catch {}
    }
    return next(e)
  })

  /* a move while idle redraws the band at once; a shell cd leaves the root alone */
  on('classic.CwdChanged', async ($: any, e: any, next: any) => {
    promptRan()
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
    held('turn.step', e)
    if (e.agentId === undefined) half.stepped = true
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
    const callBegan = Date.now()
    held('tool.call', e)
    if (e.tool === 'SendMessage') messageSeen(toolInput(e).to, toolInput(e).message)
    /* the notes this call carries on its result */
    const bound: string[] = []
    /* the procedure cards this command matched, recorded after it runs */
    const ran: any[] = []
    try {
      /* the seam root's launcher is known before any reader of the command (the step's tool, the hub flag) */
      if (COMMAND_TOOLS.includes(e.tool)) await seamEnv($).catch(() => undefined)
      /* an agent's own commits belong to its dispatch */
      if (e.agentId === undefined) trackWork(e)
      if (e.agentId === undefined) await onboardSeen($, e)
      if (e.agentId === undefined) sweepSeen(e)
      /* the turn's steps, for the handoff kept current */
      if (e.agentId === undefined) bound.push(await currencyStep($, e.tool, toolInput(e)))
      else if (placeOwed.has(String(e.agentId)) || runOpening.has(String(e.agentId))) await placeLate($, String(e.agentId)).catch(() => {})
      if (AGENT_TOOLS.includes(e.tool)) {
        await dispatchFresh($, e.tool_use_id)
        isolatedCall(e)
        bound.push(await agentFlag($, toolInput(e), e.agentId === undefined).catch(() => ''))
      }
      else if (COMMAND_TOOLS.includes(e.tool) && isHubShell(toolInput(e).command)) hub = true
      /* a call matching a procedure's trigger points the model at its file */
      if (COMMAND_TOOLS.includes(e.tool) || FILE_TOOLS.includes(e.tool)) {
        bound.push(...await procWatch($, e, ran).catch(() => [] as string[]))
        /* and one touching a decision's files or commands, at that decision */
        bound.push(...await decisionWatch($, e).catch(() => [] as string[]))
      }
      /* a read or a search points only at a record's globs marked for it */
      else if (READ_TOOLS.includes(e.tool) || SEARCH_TOOLS.includes(e.tool)) bound.push(...await decisionWatch($, e).catch(() => [] as string[]))
    } catch {}
    /* a board write may take a task or a track, so the next run tick writes whatever the last answered */
    if (hub || String(e.tool || '').startsWith('mcp__askerdo__')) runTick.quiet = false
    /* an agent reports an override to its session, which decides whether it qualifies */
    if (hub && e.agentId !== undefined && isHubOverride(toolInput(e).command)) return withNotes({ deny: subagentOverride(nameOf()) }, bound, e.agentId)
    if (hub && e.agentId !== undefined && isHubTaskWrite(toolInput(e).command)) return withNotes({ deny: subagentTaskWrite }, bound, e.agentId)
    if (hub && e.agentId !== undefined && isHubFactWrite(toolInput(e).command)) return withNotes({ deny: subagentFactWrite }, bound, e.agentId)
    /* the user's own acts stay on the mod's paths, so a shell call claiming one is refused */
    if (hub) {
      const forged = forgedFiling(toolInput(e).command, await sessionId($).catch(() => ''))
      if (forged) return withNotes({ deny: forgedDeny(forged) }, bound, e.agentId)
      const theirs = await shellPlacementAnswer($, toolInput(e).command).catch(() => '')
      if (theirs) return withNotes({ deny: theirs }, bound, e.agentId)
    }
    if (e.tool === 'Skill' && ownCommand(toolInput(e).skill) && userMarked(toolInput(e).args)) return withNotes({ deny: modelCommand(String(toolInput(e).args || '')) }, bound, e.agentId)
    /* a plain session's question stays with it, so a CLI register is refused */
    if (hub && isHubRegister(toolInput(e).command)) {
      await boundTrack($).catch(() => null)
      if (!(await isEngaged($).catch(() => true))) return withNotes({ deny: plainRegister }, bound, e.agentId)
    }
    /* an answer in the shell's own shape, never a refusal, as the tool's is */
    if (hub) {
      const waits = await shellHandoffHeld($, e).catch(() => '')
      if (waits) return withNotes({ result: { stdout: waits, stderr: '', interrupted: false } }, bound, e.agentId)
    }
    const a = e.agentId ? agents.get(e.agentId) : undefined
    const g = guard.state
    /* an agent's calls and the tool it is in, for the status row's card and Home */
    const f = e.agentId !== undefined ? flight.get(e.agentId) : undefined
    if (f && !f.done) { f.calls++; flightRedraw($) }
    /* the hand-back passes the hard floor too, since an agent's plain-text end reaches no one */
    if (!a || !a.deny || !g || !g.on || !g.hardDeny || isStateNoteCall(e.tool, toolInput(e)) || e.tool === 'SubagentHandback') {
      if (f && !f.done) f.tool = e.tool
      /* engaged after the call runs, so a binding it makes narrows the first draw */
      let res: any
      /* HEAD at the call's start, so a failed commit never links the old HEAD again */
      const commit = COMMAND_TOOLS.includes(e.tool) && commitsIn(toolInput(e).command)
      const was = commit ? await headsBefore($, e) : undefined
      /* the main loop's own; an agent's long command shows as its row's tool */
      const fg = e.agentId === undefined && COMMAND_TOOLS.includes(e.tool) && !toolInput(e).run_in_background ? fgStart($, e) : undefined
      try { res = await next(e) } finally {
        if (fg) fgEnd($, fg)
        if (hub) engage($)
        if (ran.length) procRecord($, e, res, ran)
        /* a close run from the shell lists the inbox it leaves; its ids ride the turn */
        if (hub && e.agentId === undefined && res && res.result) {
          const c = closedInbox(toolInput(e).command, res.result.stdout)
          if (c) keepInbox(c.track, c.ids, !!c.more, c.due || [], undefined, c.away || [])
        }
        if (hub && res && !res.isError) bound.push(...await leftFlags($, e).catch(() => [] as string[]))
        /* an agent's call never moves the session's track; a backgrounded one is read at the next prompt */
        if (hub && e.agentId === undefined && res && !res.deny && movesTrack(toolInput(e).command)) {
          if (toolInput(e).run_in_background) shellMove.owed = shellMove.owed || callBegan
          else await trackMoved($, callBegan).catch(() => {})
        }
        if (f && f.tool === e.tool) { f.tool = undefined; flightRedraw($) }
        /* background work starts a row; a stop the model runs ends one */
        if (COMMAND_TOOLS.includes(e.tool) || e.tool === 'Monitor' || e.tool === 'Workflow') bgStart($, e, res, fg && fg.start)
        else if (e.tool === 'TaskStop' && res && !res.isError && !res.deny) stopped($, String(toolInput(e).task_id || toolInput(e).shell_id || ''))
        else if (e.tool === 'SubagentHandback' && e.agentId !== undefined && res && !res.isError && !res.deny) handedBack.set(String(e.agentId), String(toolInput(e).message || ''))
        /* the worktree the engine cut for an agent goes to its run */
        if (AGENT_TOOLS.includes(e.tool) && e.agentId === undefined && res && !res.isError && res.result) void runPlaced($, res.result).catch(() => {})
        /* every loop's commit; the folder is read here, the git reads and the link run behind */
        if (res && !res.isError && commit) {
          try { commitSeen($, String(await $.session.cwd()), e, res, was) } catch {}
        }
      }
      return withNotes(res, bound.filter(Boolean), e.agentId)
    }
    return withNotes({ deny: agentDenyReason({ tokens: a.tokens, guard: g, note: '' }) }, bound.filter(Boolean), e.agentId)
  }).catch(($: any, e: any, next: any) => next(e))

  /* every spawned agent's prompt gets the rules in force
     appended; a workflow's or a resume's prompt is fixed, and nothing is refused */
  on('agent.spawn', async ($: any, e: any, next: any) => {
    await dispatchFresh($, e.tool_use_id)
    if (e.workflow || e.resume) {
      const res = await next(e)
      /* a resume no SendMessage asked for is the engine's wake on the agent's own work: it opens no run */
      const wake = !!e.resume && !e.workflow && !!res && !!res.agentId && !messageTaken(String(res.agentId), e.name, e.prompt)
      /* what each resume read as and what its prompt held, for a live check to read */
      if (e.resume && !e.workflow) endLogged({ x: 'resume', a: String((res && res.agentId) || e.resume.agentId || ''), k: wake ? 'wake' : res && res.agentId ? 'message' : 'none', h: flatWords(String(e.prompt || '')).slice(0, 120) })
      flightStart($, e, res, wake)
      if (!wake) spawnOpen($, e, res, null)
      return res
    }
    /* the tasks it serves, and the refusal when another session's run holds one */
    const s = topSpawn(e) ? await spawnRun($, e) : null
    const [r, { ruled, held, labels }, { taken, found }] = await Promise.all([readRules($).catch(() => null), dispatchContext($, e).catch(() => ({ ruled: '', held: '', labels: [] as string[] })),
      spawnHeld($, s)])
    if (taken) return { deny: taken }
    if (s && !s.stateNote) s.stateNote = keptStateNote(found)
    /* the agents' block, without the lines for the session alone; with the lines
       for each role it plays (its subagent type, its tasks' labels); each task's block after the rulings,
       then each task's last run and the run details, task data that rides with the rules off too */
    const block = r && r.agents ? agentsBlockFor(r, dispatchRoles(e.subagentType, labels)) : null
    const details = s ? dispatchRunBlock({ found, job: s.job, place: s.place, stateNote: s.stateNote }) : ''
    const prompt = withDecisions(withDecisions(withDecisions(withRules(e.prompt, block ? { ...r, ...block } : r), ruled), held), details)
    const res = await (prompt === e.prompt ? next(e) : next({ ...e, prompt }))
    flightStart($, e, res)
    spawnOpen($, e, res, s)
    return res
  }).catch(($: any, e: any, next: any) => next(e))


  on('session.end', async ($: any, e: any, next: any) => {
    /* first, inside the end's 1.5 s budget */
    const ending = bypassEnd($, e.sessionId, String(e.reason || ''))
    if (e.reason === 'clear') {
      try { await $.env.set('ASKERDO_BYPASS_SEEN', '*') } catch {}
      /* the cleared conversation's notes go with it; an undelivered answer is taken again */
      for (const x of takeLater()) { try { if (x.drop) void x.drop() } catch {} }
      mem.clearedFrom = e.sessionId
      seam.env = undefined
      try { $.clock.after(250, ran('clear settle timer', () => { void settle($).catch(() => {}) })) } catch {}
    } else {
      /* the end names no cause, so no run ends here; unrenewed, the session's runs read unconfirmed */
      runTickStop()
      await endRow($, e.sessionId).catch(() => {})
    }
    await ending
    return next(e)
  })

  on('prompt.submit', async ($: any, e: any, next: any) => {
    if (mem.clearedFrom) await settle($).catch(() => {})
    else await recheckRow($).catch(() => {})
    /* the user's own prompt (not a command, not a plugin's) lifts the freeze */
    const kind = e.origin && e.origin.kind
    userSaid(e)
    /* a background task's end delivered into a running turn draws no notification row until later */
    /* its arrival stands in for the end until the notification row brings the engine's run length */
    if (kind === 'task-notification') for (const t of taskEnds(e.text)) if (bgTasks.has(t.id)) bgEnd($, t.id, t.status, undefined, true, 'prompt')
    /* a started session's first prompt (not typed) runs its whole /askerdo resume line */
    const started = (await startedResume($, e).catch(() => '')) || (await sentCommand($, e).catch(() => ''))
    if (!e.command && !e.isMeta && (!kind || kind === 'composer' || kind === 'bridge')) await liftFreeze($, await sessionId($)).catch(() => {})
    if (namesBoardId(e.text)) engage($)
    /* a typed /askerdo:onboard runs the skill with no Skill call */
    if (e.command && ONBOARD.test(String(e.command))) onboarding.add(await sessionId($))
    /* a take-over elsewhere is told at the next prompt, once. While the long poll
       holds, each band load has read the held track; else it is read here */
    let lostNote = ''
    if (shellMove.owed) { const began = shellMove.owed; shellMove.owed = undefined; await trackMoved($, began).catch(() => {}) }
    else if (!e.command && !e.isMeta && mem.track && !wait.live) await readMine($, await sessionId($)).catch(() => null)
    if (lease.lost && !e.command && !e.isMeta) { lostNote = lostTrackNote(lease.lost); lease.lost = undefined }
    /* the profiles revision, once a prompt of any origin, before its compose reads the rules */
    await profilesRev($, true).catch(() => {})
    /* an engaged session files its kept questions and tells the labels; a typed
       L1a goes to the session, which records each token with the answer tool */
    const typed = !e.command && !e.isMeta
    const renamed = typed ? await renamedNote($).catch(() => '') : ''
    const note = [started, lostNote, renamed].filter(Boolean).join('\n\n')
    /* what waits rides the prompt as context, never a row; a command line takes none */
    const waits = typed ? await promptNote($).catch(() => '') : ''
    /* an agent's report waits for its end, so the settle words ride its own prompt */
    if (kind === 'peer' || kind === 'task-notification') {
      reportsHeard(e.text)
      await endsNamed($, e.text).catch(() => {})
      await owedSettle($).catch(() => {})
    }
    /* an isolated background agent's place, which only its end notification names */
    if (kind === 'task-notification') for (const t of taskEnds(e.text)) if (t.worktreePath) void runPlaced($, { agentId: t.id, ...t }).catch(() => {})
    /* a /clear's id keeps the process mark, so its own reopen is known */
    await procKeep($).catch(() => {})
    const xs = e.command ? [] : takeLater()
    afterPrime($)
    const resumed = (await resumeBlocks($).catch(() => '')) || (typed ? await offBlocks($).catch(() => '') : '')
    const changed = await carryNote($, !!resumed).catch(() => '')
    /* the engine keeps a hidden prompt's text as it came (a peer's message), so its note rides as context */
    const extra = [...(note && e.isMeta ? [note] : []), waits, ...xs.map((x) => x.text), changed, resumed].filter(Boolean)
    const told = note && !e.isMeta ? { text: note + '\n\n' + e.text } : {}
    if (!extra.length && !told.text) return next(e)
    let r: any
    try { r = await next({ ...e, ...told, ...(extra.length ? { context: [...(e.context || []), ...extra] } : {}) }) } catch (err) { later.unshift(...xs); throw err }
    rode(xs)
    return r
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
    if (e.agentId !== undefined) return { deny: subagentAsk(nameOf()) }
    await settle($).catch(() => {})
    const input = toolInput(e)
    const r = await askTool($, input, e.tool_use_id)
    /* the telling waits for the reply that carries its block, or the turn's end */
    if (e.tool_use_id && told.has(e.tool_use_id)) thisTurn().asks.push(e.tool_use_id)
    /* a question answers a refused filing; the tasks it gates owe the close nothing more */
    if (r && !r.deny) {
      landedNow()
      if (Array.isArray(input.gates)) checks.gated.push(...input.gates.map((g: any) => String(g).trim()))
    }
    return r
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__override_request' }, async ($: any, e: any) => {
    if (e.agentId !== undefined) return { deny: subagentOverride(nameOf()) }
    await settle($).catch(() => {})
    const r = await overrideTool($, toolInput(e), e.tool_use_id)
    /* the card draws as a question's does */
    if (e.tool_use_id && told.has(e.tool_use_id)) thisTurn().asks.push(e.tool_use_id)
    return r
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__note' }, async ($: any, e: any) => {
    if (e.agentId !== undefined && /^T-\d+$/.test(String(toolInput(e).id || '').trim())) return { deny: subagentTaskWrite }
    await settle($).catch(() => {})
    mem.engaged = true
    const id = String(toolInput(e).id || '')
    /* read before the sweep below drops the run this note settles */
    const waits = e.agentId === undefined && /^T-\d+$/.test(id) ? await heldWait($, id).catch(() => false) : false
    const r = await noteTool($, toolInput(e))
    if (r && !r.deny && e.agentId === undefined) landedNow()
    /* a note on a task saying why it waits settles its ended run */
    if (r && !r.deny && e.agentId === undefined && /^T-\d+$/.test(id)) await unsettledSweep($, await sessionId($)).catch(() => {})
    return withLeft($, e, r, waits)
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__answer' }, async ($: any, e: any) => {
    await settle($).catch(() => {})
    return answerTool($, toolInput(e))
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__decide' }, async ($: any, e: any) => {
    /* a ruling quotes the user's words, which an agent never sees; its session records what the report names */
    if (e.agentId !== undefined) return { deny: subagentDecide(nameOf()) }
    await settle($).catch(() => {})
    mem.engaged = true
    return decideTool($, toolInput(e))
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__fact' }, async ($: any, e: any) => {
    /* an agent writes nothing on the board; its session records what the report names */
    if (e.agentId !== undefined) return { deny: subagentFact }
    await settle($).catch(() => {})
    mem.engaged = true
    return factTool($, toolInput(e))
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__task_update' }, async ($: any, e: any) => {
    if (e.agentId !== undefined) return { deny: subagentTaskWrite }
    await settle($).catch(() => {})
    mem.engaged = true
    const input = toolInput(e)
    /* read before the write, whose reload drops the task from the view */
    const running = agentTasksHere(await sessionId($)).includes(String(input.id || ''))
    const r = await taskTool($, input, e.agentId, e.tool_use_id)
    /* a checklist step or a close's leftovers answer a refused filing */
    const files = (input.checks && Array.isArray(input.checks.add) && input.checks.add.length) || (Array.isArray(input.leftovers) && input.leftovers.length)
    if (!r.deny && files && e.agentId === undefined) landedNow()
    /* a take in hand or a start puts the turn's work on the track before the band reloads */
    if (!r.deny && input.inHand === true) checks.holding = true
    /* closing an agent task running on this session's track lands its work there */
    if (!r.deny && running && input.status === 'done') checks.holding = true
    /* a settle drops the kept unsettled runs it settled */
    if (!r.deny && e.agentId === undefined) await unsettledSweep($, await sessionId($)).catch(() => {})
    return withLeft($, e, r)
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__place' }, async ($: any, e: any) => {
    /* an agent files nothing; its session places what the report names */
    if (e.agentId !== undefined) return { deny: subagentPlace }
    await settle($).catch(() => {})
    mem.engaged = true
    return placeTool($, toolInput(e), e.tool_use_id)
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__handoff_write' }, async ($: any, e: any) => {
    await settle($).catch(() => {})
    return handoffTool($, toolInput(e), e.agentId, e.tool_use_id)
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__handoff_update' }, async ($: any, e: any) => {
    await settle($).catch(() => {})
    mem.engaged = true
    return updateTool($, toolInput(e))
  }).catch(toolFailed)
  on('tool.call', { tool: 'mcp__askerdo__depth' }, async ($: any, e: any) => depthTool($, toolInput(e))).catch(toolFailed)
  /* an agent's call reads its session's surfaces too, so a foreground command's row is read while it runs */
  on('tool.call', { tool: 'mcp__askerdo__drawn' }, async ($: any, e: any) => drawnTool($, toolInput(e))).catch(toolFailed)
  for (const name of ['review_covers', 'coverage']) {
    on('tool.call', { tool: 'mcp__askerdo__' + name }, async ($: any, e: any) => {
      await settle($).catch(() => {})
      return coverageTool($, name, toolInput(e))
    }).catch(toolFailed)
  }

  /* the band draws on the terminal and desktop surfaces only */
  /* the band's rows as settled, read and passed on unchanged; plugin '*' hears the band, which names none */
  on('ui.render', { component: 'AbovePromptList', plugin: '*' }, ($: any, e: any, next: any) => { try { bandRoom($, e) } catch {} return next(e) })
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any, next: any) => ringDraw($, 'band', () => drawKept($, 'band ' + e.surface, () => bandFace($, e, next)), ['band'], Number(e.props && e.props.bodyColumns)))

  on('ui.render', { component: 'PromptHint' }, ($: any, e: any, next: any) => ringDraw($, 'hint', () => drawKept($, 'hint ' + e.surface, () => hintFace($, e, next))))

  /* a press on the band or the status line hands the focus off its button (handOff) */
  on('ui.press', ($: any, e: any, next: any) => {
    const mark = pressStarted()
    /* a press no row took leaves its wait to no later row */
    const drop = () => { if (lagged.press === mark) lagged.press = undefined }
    const stale = ringStale(e)
    ringPress(e, stale)
    if (stale) { drop(); return { element: e.element } }
    handOff(e)
    const out = next(e)
    void Promise.resolve(out).then(drop, drop)
    return out
  }).catch(($: any, e: any, next: any) => next(e))

  /* one AskerDo pane; a pane saved under an id from before the tabs draws it too */
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($: any, e: any) => ringDraw($, 'pane', () => drawKept($, 'pane ' + e.surface + ' ' + e.requestId, () => paneSite($, e)), ['pane'], Number(e.props && e.props.bodyColumns)))
  on('ui.render', { component: 'Pane', requestId: OLD_PANE_IDS[0] }, ($: any, e: any) => ringDraw($, 'pane', () => drawKept($, 'pane ' + e.surface + ' ' + e.requestId, () => paneSite($, e))))
  on('ui.render', { component: 'Pane', requestId: OLD_PANE_IDS[1] }, ($: any, e: any) => ringDraw($, 'pane', () => drawKept($, 'pane ' + e.surface + ' ' + e.requestId, () => paneSite($, e))))
  on('ui.close', ($: any, e: any, next: any) => { paneForget(e.id); return next(e) }).catch(($: any, e: any, next: any) => next(e))
  on('ui.open', ($: any, e: any, next: any) => { paneForget(e.id); return next(e) }).catch(($: any, e: any, next: any) => next(e))
  on('ui.message', ($: any, e: any, next: any) => {
    const t = performance.now()
    const r = onSecond(liveAnswer($, e))
    if (r) liveTimed(Date.now(), performance.now() - t, e.data && Array.isArray(e.data.keys) ? e.surface + ' ' + e.component + ' ' + e.requestId : undefined)
    return r || next(e)
  })
  /* each fault its own row in the timings beside the held rows, so a teardown sets against them by time */
  on('ui.fault', ($: any, e: any, next: any) => {
    liveFault.add(e.component + ' ' + e.surface)
    const at = new Date().toISOString()
    faultAdd('ui.fault ' + at + ' ' + (++boot.uiFaults), 'ui.fault ' + e.component + ' ' + e.surface + ' at ' + at + ', ' + e.phase + ' ' + e.element
      + ' (' + e.module + ', ' + e.requestId + '): ' + e.reason + liveSets.words(e))
    faultsSoon($)
    return next(e)
  })

  /* the engine's own dialog with rewritten props, so it still collects the answer */
  on('ui.render', { component: 'AskUserQuestion' }, ($: any, e: any, next: any) => {
    const questions = decisionQuestions(e.props && e.props.questions)
    return questions ? next({ ...e, props: { ...e.props, questions } }) : next(e)
  })

  /* the band carries the queue; with saved options the whole mod section
     (builder.js) rides the prompt, so no-mod sessions keep the style alone */
  on('prompt.compose', async ($: any, e: any, next: any) => {
    promptRan()
    const main = !(e.traits || []).some((t: string) => t === 'teammate' || t === 'analysis')
    if (main) { carry.facts = { surfaces: e.surfaces, tools: e.tools }; carry.composed = await sessionId($).catch(() => '') }
    const res = await next(e)
    if (!main) return res
    mem.surfaces = e.surfaces
    const has = res.sections.some((s: any) => s.id === CARRIER)
    /* a bare prompt (CLAUDE_CODE_SIMPLE) has no named sections and is never recorded */
    if (!(e.traits || []).includes('bare')) void carrierSeen($, has).catch(() => {})
    /* the carrier section holds them, as first sent */
    if (has) return res
    /* no carrier (a bare prompt, rendered fresh every request, or a renamed section): appended; the engine
       records the first, which the notes then follow */
    await sentBlocks($).catch(() => null)
    const blocks = await modBlocks($, e.surfaces, e.tools)
    return blocks.length ? { sections: [...res.sections, ...blocks] } : res
  })

  on('prompt.section', { name: CARRIER }, async ($: any, e: any, next: any) => {
    promptRan()
    const res = await next(e)
    if (carry.resumed === 'prime') { carry.resumed = 'primed'; return res }
    const text = joined((await sentBlocks($)) || [])
    const core = res && typeof res.text === 'string' ? res.text : ''
    return text ? { text: core ? core + '\n\n' + text : text } : res
  })

  /* the engine's per-step reminder that the style is set: the style itself rides the prompt */
  on('prompt.attachment', { type: 'output_style' }, async ($: any, e: any, next: any) => {
    promptRan()
    if (e.agentId !== undefined || !/askerdo/i.test(String(e.text || ''))) return next(e)
    return { text: null }
  }).catch(($: any, e: any, next: any) => next(e))

  /* the style itself, asked as the first request carries it and held for the process */
  on('prompt.attachment', { type: 'output_style_instructions' }, async ($: any, e: any, next: any) => {
    if (e.agentId !== undefined || typeof e.text !== 'string' || !(await styleCut($))) return next(e)
    const text = withoutSurfaces(e.text)
    return text === e.text ? next(e) : next({ ...e, text })
  }).catch(($: any, e: any, next: any) => next(e))

  /* The first telling: the question as the pane's card under the reply
     that tells it, not on the ask tool's row, which the transcript collapses; any
     other reply is the engine's. */
  on('ui.render', { component: 'AssistantMessage' }, ($: any, e: any, next: any) => replyDraw($, e, next))

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
      /* a task's end delivered into an agent's conversation raises no Stop, notification row or
         prompt in the main loop, so the row it keeps is the end; a model's or tool's row is never one */
      else if (bgTasks.size && !['response', 'tool-result', 'tool-message'].includes(e.door)) {
        const text = textsOf(e.message).join('\n')
        if (text.includes('<task-notification>')) for (const t of taskEnds(text)) if (bgTasks.has(t.id)) bgEnd($, t.id, t.status, undefined, true, e.agentId !== undefined ? 'agent row' : 'row')
      }
    } catch {}
    return r
  }).catch(($: any, e: any, next: any) => next(e))

}
