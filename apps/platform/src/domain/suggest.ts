import { SECTIONS, pageHref, sectionHref, topicHref } from './navigation'

/** Ctrl K search: live results grouped by kind, with quick type filters. Pure so it can be tested without a browser. */
export type SuggestKind = 'document' | 'video' | 'slides' | 'howto' | 'page'
export type SuggestItem = { kind: SuggestKind; id: string; title: string; meta: string; href: string }
export type SuggestFilter = 'all' | SuggestKind
export const FILTERS: { id: SuggestFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'document', label: 'Documents' }, { id: 'video', label: 'Videos' },
  { id: 'slides', label: 'Slides' }, { id: 'howto', label: 'How-to' }, { id: 'page', label: 'Pages' },
]
const GROUP_LABEL: Record<SuggestKind, string> = { document: 'Documents', video: 'Videos', slides: 'Slides', howto: 'How-to articles', page: 'Pages' }
const ORDER: SuggestKind[] = ['document', 'video', 'slides', 'howto', 'page']

/** Maps a library format to the palette's kind. */
export function kindForFormat(format: string, kind?: string): SuggestKind {
  if (kind === 'howto') return 'howto'
  if (format === 'video' || format === 'audio') return 'video'
  if (format === 'slides') return 'slides'
  return 'document'
}

export const queryWords = (query: string) => query.toLowerCase().split(/\s+/).map(w => w.trim()).filter(Boolean).slice(0, 8)

/** Sections, topics and familiar pages whose names contain every typed word. */
export function matchPages(query: string, limit = 6): SuggestItem[] {
  const words = queryWords(query)
  if (!words.length) return []
  const entries: SuggestItem[] = []
  for (const s of SECTIONS) {
    entries.push({ kind: 'page', id: `section:${s.id}`, title: s.label, meta: 'Section', href: sectionHref(s.id) })
    for (const t of s.topics) entries.push({ kind: 'page', id: `topic:${s.id}:${t}`, title: t, meta: `Topic · ${s.label}`, href: topicHref(s.id, t) })
    for (const f of s.familiar) entries.push({ kind: 'page', id: `page:${s.id}:${f}`, title: f, meta: `Page you know · ${s.label}`, href: pageHref(s.id, f) })
  }
  const seen = new Set<string>()
  return entries.filter(e => {
    const key = e.title.toLowerCase()
    if (seen.has(key) || !words.every(w => key.includes(w))) return false
    seen.add(key); return true
  }).slice(0, limit)
}

/** Splits a title around the first match of the first typed word, for highlighting. */
export function highlight(title: string, query: string): [before: string, match: string, after: string] {
  const word = queryWords(query)[0]
  const at = word ? title.toLowerCase().indexOf(word) : -1
  return at < 0 ? [title, '', ''] : [title.slice(0, at), title.slice(at, at + word.length), title.slice(at + word.length)]
}

export type SuggestGroup = { label: string; items: SuggestItem[] }
export type SuggestView = { groups: SuggestGroup[]; flat: SuggestItem[]; counts: Record<SuggestFilter, number> }

/**
 * Groups ranked results (already authorized and ordered by the server) into Top hit + kind groups,
 * applying the selected type filters. Counts always reflect the unfiltered results so chips show what each type holds.
 */
export function groupSuggestions(results: SuggestItem[], selected: SuggestKind[], max = 9): SuggestView {
  const counts = { all: results.length, document: 0, video: 0, slides: 0, page: 0 } as Record<SuggestFilter, number>
  for (const r of results) counts[r.kind]++
  const visible = (selected.length ? results.filter(r => selected.includes(r.kind)) : results).slice(0, max)
  const groups: SuggestGroup[] = []
  if (visible.length) groups.push({ label: 'Top hit', items: [visible[0]] })
  for (const kind of ORDER) {
    const items = visible.slice(1).filter(r => r.kind === kind)
    if (items.length) groups.push({ label: GROUP_LABEL[kind], items })
  }
  return { groups, flat: groups.flatMap(g => g.items), counts }
}

/** Toggles one type chip; choosing All, or every type, clears the filter. */
export function toggleFilter(selected: SuggestKind[], chip: SuggestFilter): SuggestKind[] {
  if (chip === 'all') return []
  const next = selected.includes(chip) ? selected.filter(k => k !== chip) : [...selected, chip]
  return next.length === ORDER.length ? [] : next
}
