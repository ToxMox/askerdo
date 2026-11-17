/* The values the mod keeps in $.state: a write redraws only the draws that read it. */

/* the question cards' option rings that stand open, by option token ('106b') */
export type OpenRings = string[]

/* a queued answer send in flight, for a fresh copy to finish */
export type Sending = { before: number | null; done: string[]; here: boolean }

/* the session's own slices, which a fresh copy after a hooks worker respawn draws from at once;
   v: its shape, a copy reads another as none; starts: the mod's copies this session */
export type Snapshot = {
  v: number; starts: number; sending: Sending | null
  view: { tab: string; chosen: boolean; filter: string; unfolded: string[]; pic: { level: number; ws: string; tr: string | null; sel: string | null } | null
    picOf: string | null; done: boolean; bgDone: boolean; bgMore: string[] }
  q: { unfolded: string[]; notes: Record<string, string>; strip: Record<string, string>; band: Record<string, string>; expanded: string | null; asking: string | null }
  queue: { id: string; letter: string; note: string; version?: number; site: string; useId?: string; key?: string; local?: boolean }[]
  /* queued answers whose send ran out of time, for the toast when they land */
  late?: string[]
}

declare module 'claude-code' {
  interface PluginState {
    /* drawn: a count per site (band, hint, pane, card), each read by that site's draws, so a redraw
       writes only the sites it changed; a reply with no card reads its own, by row id and text key */
    askerdo: { unfolded: OpenRings; drawn: StateFamily<number>; snapshot: Snapshot }
  }
}
