/* The mod tests' shared names: a typed tool's full name, an ask's words and the project's open set on the board. */
import { LOCAL_ROOT } from './world.ts'

export const TOOL = (n: string) => 'mcp__askerdo__' + n
export const ASKED = 'One file (a) or many (b, my pick)?'
/* the project's open set on the board, through the local server; in the localhost form the desktop opens */
export const SET = LOCAL_ROOT.replace('127.0.0.1', 'localhost') + 'needs-you?repo=' + encodeURIComponent('github.com/owner/proj')
