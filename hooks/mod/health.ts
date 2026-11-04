/* what is wrong with AskerDo on this PC, from `askerdo status --json`, kept for the band
 * and the status row: the first problem it lists, or null when all is well. Checked at the first
 * draw, again when the route finds the local server gone or its start refused (and when that
 * clears), after a fix's press, each minute while a problem stands, and when board/local.json
 * moves while one stands (the sync replaced the server the problem named). */

export type HealthProblem = { key: string; says: string; fix: string; command?: string; copy?: string }
type Ran = { exitCode?: number; stdout?: string; stderr?: string }

const AGAIN_MS = 60000
/* the stamp before the poll has read one: the poll reads it only while a problem stands */
const UNSEEN = '?'

/* sig: the route's trouble the last check ran under ('' for none); local: board/local.json's
   stamp as the band's poll last read it, stamp: the one the last check ran under */
export const health: { first: HealthProblem | null; checked: boolean; sig: string; at: number; local: string; stamp: string; running?: Promise<boolean> } = {
  first: null, checked: false, sig: '', at: 0, local: '', stamp: '',
}

/* Whether a draw at `now`, with the route's trouble `sig`, should look again. */
export function healthDue(sig: string, now: number): boolean {
  if (health.running) return false
  if (!health.checked) return true
  if (sig !== health.sig && (sig || health.first)) return true
  if (health.first && health.local !== health.stamp) return true
  return !!health.first && now - health.at >= AGAIN_MS
}

/* The first problem a status run lists, null for none, undefined when its output is not the readout
   (it exits 1 with problems listed, so the code says nothing) */
export function firstProblem(r: Ran | null): HealthProblem | null | undefined {
  let j: any
  try { j = JSON.parse(String((r && r.stdout) || '')) } catch { return undefined }
  if (!j || !Array.isArray(j.problems)) return undefined
  const p = j.problems.find((x: any) => x && typeof x.says === 'string' && typeof x.fix === 'string')
  if (!p) return null
  return { key: String(p.key || ''), says: p.says, fix: p.fix, ...(typeof p.command === 'string' ? { command: p.command } : {}), ...(typeof p.copy === 'string' ? { copy: p.copy } : {}) }
}

/* One check through each run in turn until one gives the readout (the route, then a process, since
   the route is what may be broken); true when what the band draws changed. No readout keeps the last. */
export function checkHealth(sig: string, now: number, runs: Array<() => Promise<Ran>>): Promise<boolean> {
  if (health.running) return health.running
  if (!health.first) health.local = UNSEEN
  health.stamp = health.local
  health.running = (async () => {
    let p: HealthProblem | null | undefined
    for (const run of runs) {
      let r: Ran | null = null
      try { r = await run() } catch {}
      p = firstProblem(r)
      if (p !== undefined) break
    }
    health.checked = true
    health.sig = sig
    health.at = now
    if (p === undefined) return false
    const was = JSON.stringify(health.first)
    health.first = p
    return JSON.stringify(p) !== was
  })().finally(() => { health.running = undefined })
  return health.running
}

/* The poll's read of local.json's stamp ('' for none); true when a problem stands and the
   file moved since the last check, so the caller looks again now. */
export function sawLocal(stamp: string): boolean {
  /* the first read after a new problem is its baseline, not a move */
  if (health.stamp === UNSEEN && !health.running) health.stamp = stamp
  health.local = stamp
  return !health.running && !!health.first && stamp !== health.stamp
}

/* After a fix ran: the next draw looks again at once. */
export function healthStale(): void {
  health.checked = false
}
