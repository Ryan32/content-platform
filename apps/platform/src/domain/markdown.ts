/**
 * Small, safe Markdown subset for how-to articles: headings (#, ##, ###), paragraphs, bullet and numbered lists, > callouts,
 * **bold**, *italic*, `code`, links and images. No raw HTML is ever passed through. Links must be http(s), mailto or
 * site-relative; images must come from this site's authorized /files/ route.
 */
export type Inline = { t: 'text' | 'strong' | 'em' | 'code'; v: string } | { t: 'link'; v: string; href: string }
export type Block =
  | { type: 'heading'; level: 2 | 3; text: string; id: string }
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'image'; alt: string; src: string }
  | { type: 'callout'; content: Inline[] }

export const anchorId = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'section'

export function safeHref(href: string): string | null {
  const value = href.trim()
  if (/^(https?:|mailto:)/i.test(value)) return value
  if (/^\/(?!\/)/.test(value) || value.startsWith('#')) return value
  return null
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g
  let last = 0
  for (const m of text.matchAll(pattern)) {
    if (m.index! > last) out.push({ t: 'text', v: text.slice(last, m.index) })
    if (m[2]) out.push({ t: 'strong', v: m[2] })
    else if (m[3]) out.push({ t: 'em', v: m[3] })
    else if (m[4]) out.push({ t: 'code', v: m[4] })
    else { const href = safeHref(m[6]); out.push(href ? { t: 'link', v: m[5], href } : { t: 'text', v: m[5] }) }
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) })
  return out
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = []
  const used = new Map<string, number>()
  let paragraph: string[] = []
  let list: { ordered: boolean; items: Inline[][] } | null = null
  let lastWasQuote = false
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', content: parseInline(paragraph.join(' ')) })
    if (list) blocks.push({ type: 'list', ...list })
    paragraph = []; list = null
  }
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    const image = /^!\[([^\]]*)\]\((\/files\/\d+)\)\s*$/.exec(line.trim())
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    const quote = /^>\s?(.*)$/.exec(line)
    if (!line.trim()) { flush(); lastWasQuote = false; continue }
    if (!/^>/.test(line)) lastWasQuote = false
    if (heading) {
      flush()
      const text = heading[2].trim()
      let id = anchorId(text); const n = used.get(id) ?? 0; used.set(id, n + 1); if (n) id = `${id}-${n + 1}`
      blocks.push({ type: 'heading', level: heading[1].length === 3 ? 3 : 2, text, id })
    } else if (image) { flush(); blocks.push({ type: 'image', alt: image[1], src: image[2] }) }
    else if (quote) {
      flush()
      const last = blocks[blocks.length - 1]
      if (last?.type === 'callout' && lastWasQuote) last.content.push({ t: 'text', v: ' ' }, ...parseInline(quote[1]))
      else blocks.push({ type: 'callout', content: parseInline(quote[1]) })
      lastWasQuote = true; continue
    }
    else if (bullet || numbered) {
      const ordered = Boolean(numbered)
      if (paragraph.length || (list && list.ordered !== ordered)) flush()
      list ??= { ordered, items: [] }
      list.items.push(parseInline((bullet ?? numbered)![1]))
    } else { if (list) flush(); paragraph.push(line.trim()) }
  }
  flush()
  return blocks
}
