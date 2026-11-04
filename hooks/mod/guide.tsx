/* The Guide tab: an index of the installed plugin's README and
 * docs/guide pages, each a title and its one-line summary, linking to the page on GitHub at the
 * installed version's tag. Drawn from the model alone; index.ts owns the reads. */
import { cellWidth } from '../../lib/mod-core.mjs'
import { linkOver, pressFace } from './status.tsx'

export const GUIDE_HOME = 'README.md'
const GUIDE_DIR = 'docs/guide/'
const OUT = '↗'

export type GuidePage = { page: string; title: string; summary: string }

/* the page on GitHub at the release tag (each public release is tagged vX.Y.Z), else the default branch */
export function guideHref(repo: string, page: string, version?: string): string {
  return repo.replace(/\/+$/, '') + '/blob/' + (version ? 'v' + version : 'main') + '/' + page
}

/* The pages in reading order: the README, then the guide pages in the order the README links
   them, then the rest by name; each titled by its first heading and summed up by its first paragraph. */
export function guideIndex(pages: string[], texts: (string | undefined)[]): GuidePage[] {
  const readme = texts[pages.indexOf(GUIDE_HOME)]
  const order: string[] = []
  for (const m of String(readme || '').matchAll(/docs\/guide\/([\w.-]+\.md)/g)) if (!order.includes(GUIDE_DIR + m[1])) order.push(GUIDE_DIR + m[1])
  const at = (p: string) => (p === GUIDE_HOME ? -1 : order.includes(p) ? order.indexOf(p) : order.length)
  return pages.map((page, i) => ({ page, title: titleOf(page, texts[i]), summary: summaryOf(texts[i]) }))
    .sort((a, b) => at(a.page) - at(b.page) || a.page.localeCompare(b.page))
}

/* inline Markdown as words: links and code by their text, pictures and emphasis marks gone */
const plain = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\*\*|__|`/g, '').replace(/(^|\W)\*(\S[^*]*)\*/g, '$1$2').replace(/\s+/g, ' ').trim()

function titleOf(page: string, text?: string): string {
  const m = String(text || '').replace(/<!--[\s\S]*?-->/g, '').match(/^#\s+(.+)$/m)
  if (m) return plain(m[1])
  const name = page.split('/').pop()!.replace(/\.md$/i, '').replace(/-/g, ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/* the first plain paragraph (a bold lead line counts), past headings, pictures, tables, lists,
   HTML and code, cut to its first sentence */
export function summaryOf(text?: string): string {
  const para: string[] = []
  let fence = ''
  for (const line of String(text || '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) { if (f && f[1][0] === fence[0]) fence = ''; continue }
    if (f) { if (para.length) break; fence = f[1]; continue }
    const t = line.trim()
    if (!t || /^(#|\||<|!\[|[-*+]\s|\d+[.)]\s|>)/.test(t)) { if (para.length) break; continue }
    para.push(t)
  }
  const words = plain(para.join(' '))
  const one = words.match(/^.*?[.!?](?=\s+[A-Z("'])/)
  return one ? one[0] : words
}

/* The tab: the version the links point at, a row per page (its title a bold link, its summary
   under it), then the repository. desk: a link's words drawn under a blank Link, as the pane's others. */
export function guideTree(els: any, m: { pages?: GuidePage[]; version?: string; repo?: string; error?: string }, desk: boolean): any {
  const { Box, Text, Link } = els
  const link = (key: string, href: string, words: string, bold: boolean) => {
    const b = bold ? { bold: true } : {}
    if (!href) return <Box key={key} flexShrink={1} minWidth={0}><Text wrap="wrap" {...b}>{words}</Text></Box>
    if (!desk) return <Box key={key} flexShrink={1} minWidth={0}><Link href={href} label={words} /></Box>
    const face = <Text wrap="wrap" color="suggestion" {...b}>{words}</Text>
    return pressFace(els, key, face, linkOver(els, key + '-link', cellWidth(words), href), { shrink: true })
  }
  const head = m.version ? 'AskerDo ' + m.version + ': each page opens on GitHub at this release.' : 'Each page opens on GitHub.'
  const parts: any[] = [<Box key="guide-head"><Text dimColor wrap="wrap">{head}</Text></Box>]
  if (m.error) parts.push(<Box key="guide-error"><Text dimColor wrap="wrap">{m.error}</Text></Box>)
  else if (!m.pages) parts.push(<Box key="guide-loading"><Text dimColor>Reading the guide...</Text></Box>)
  else {
    for (const p of m.pages) {
      parts.push(
        <Box key={'guide-row-' + p.page} flexDirection="column" alignItems="flex-start">
          {link('guide-link-' + p.page, m.repo ? guideHref(m.repo, p.page, m.version) : '', p.title, true)}
          {p.summary ? <Box key={'guide-sum-' + p.page}><Text dimColor wrap="wrap">{p.summary}</Text></Box> : null}
        </Box>)
    }
    if (m.repo) parts.push(<Box key="guide-repo" flexDirection="column" alignItems="flex-start">{link('guide-repo-link', m.repo, 'The AskerDo repository ' + OUT, false)}</Box>)
  }
  return <Box key="guide" flexDirection="column" rowGap={1}>{parts}</Box>
}
