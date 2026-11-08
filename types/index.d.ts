/* The values the mod keeps in $.state: a write redraws only the draws that read it. */

/* the question cards' option rings that stand open, by option token ('106b') */
export type OpenRings = string[]

declare module 'claude-code' {
  interface PluginState {
    /* drawn: a count per site (band, hint, pane, card), each read by that site's draws, so a redraw
       writes only the sites it changed; a reply with no card reads its own, by row id and text key */
    askerdo: { unfolded: OpenRings; drawn: StateFamily<number> }
  }
}
