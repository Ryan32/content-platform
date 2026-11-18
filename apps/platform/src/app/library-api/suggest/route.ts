import { authenticatedLibrary } from '../../../server/library'
import { allowsBrowserSession } from '../../../auth/browser'
import { formatLabel } from '../../../components/Format'
import { kindForFormat, matchPages, queryWords, type SuggestItem } from '../../../domain/suggest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

/**
 * GET ?q= — live results for the Ctrl K search window. Library items come from the same ranked, authorized search as
 * the reader list (so suggestions never reveal anything the person cannot open), followed by matching sections,
 * topics and familiar pages. Never calls AI.
 */
export async function GET(request: Request) {
  if (!allowsBrowserSession(request.headers)) return json({ error: 'Forbidden' }, 403)
  const query = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 200)
  if (!queryWords(query).length) return json({ results: [] })
  let repository
  try { repository = await authenticatedLibrary(request.headers) } catch { return json({ error: 'The library is temporarily unavailable.' }, 503) }
  if (!repository) return json({ results: matchPages(query) })
  let items: SuggestItem[] = []
  try {
    const found = await repository.search(query, undefined, 1, 'view')
    items = found.items.slice(0, 12).map(item => ({ kind: kindForFormat(item.format, item.kind), id: item.id, title: item.title,
      meta: item.kind === 'howto' ? 'How-to article' : formatLabel(item.format), href: `/resources/${encodeURIComponent(item.id)}` }))
  } catch { return json({ error: 'Search is temporarily unavailable.' }, 503) }
  return json({ results: [...items, ...matchPages(query)] })
}
