export interface Evidence {
  id: string; version: string; text: string; locator: string
}
export interface Material {
  id: string; title: string; description: string; format: string; version: string;
  /** Date shown to readers: the source system's last update for migrated items, otherwise the last edit here. */
  body: string; updatedAt: string; evidence: Evidence[]
  /** Original publication date on the old site (migrated items only). */
  originalPublishedAt?: string
  vimeoId?: string; previewAssetId?: number; downloadAssetIds?: number[]; thumbnailVersion?: string
  kind?: string; section?: string; topics?: string[]
  audience?: string; licensing?: string[]; lines?: string[]; program?: string; carriers?: number[]; takeaways?: string[]
  /** Set on direct reads for the reader's detail page. */
  details?: { owner?: string; lastReviewedAt?: string; reviewDueAt?: string; reviewWindow?: string }
  /** Originals the reader may view inline (PDF, image, audio, video, sheets). Download permission is required until view-only derivatives exist (ADR-026). */
  inlineAssets?: { id: number; mimeType: string }[]
  /** The page's files (one section each). Names and descriptions are visible with view access; downloads need download access. */
  files?: MaterialFile[]
  /** Pictures from the article itself (not offered as downloads). */
  articleImages?: number[]
  /** Additional Vimeo videos on the same page. */
  moreVideos?: { vimeoId: string; title?: string }[]
  /** Search results: where the query matched (a passage, possibly inside one of the page's files). */
  match?: { citationId: string; locator: string; assetId?: number }
}
export interface MaterialFile { id: number; name: string; mimeType: string; bytes?: number; description?: string }
/** Reader link to a page, opened at the matched passage and file. Files never have their own page. */
export function matchHref(item: Pick<Material, 'id' | 'match'>) {
  const params = new URLSearchParams()
  if (item.match?.citationId) params.set('citation', item.match.citationId)
  if (item.match?.assetId) params.set('file', String(item.match.assetId))
  const query = params.toString()
  return `/resources/${encodeURIComponent(item.id)}${query ? `?${query}` : ''}${item.match?.assetId ? `#file-${item.match.assetId}` : ''}`
}
/** Narrows a listing to part of the Library menu. Values are the stored keys from domain/navigation. */
export interface BrowseFilters {
  section?: string; topic?: string; page?: string; kind?: string; kinds?: string[]; excludeKinds?: string[]
  audience?: string; licensing?: string[]; lines?: string[]; program?: string; carrier?: number; formats?: string[]
  updatedSince?: string; sort?: 'recent' | 'popular'; ids?: number[]; pageSize?: number
}
export interface Carrier { id: number; name: string; slug: string; lines: string[]; summary: string; logoText: string; count: number }
export interface Kit { id: number; title: string; description: string; section?: string; items: Material[] }
/** Reader-only extras on top of the MCP-safe repository. All results pass the same authorization as search. */
export interface ReaderExtras {
  mostUsed(limit: number): Promise<Material[]>
  recordView(id: string): Promise<void>
  savedIds(): Promise<number[]>
  setSaved(id: string, saved: boolean): Promise<boolean>
  carriers(): Promise<Carrier[]>
  kits(filters: { section?: string; contentId?: string; id?: number }): Promise<Kit[]>
  feedback(id: string, kind: 'helpful' | 'not-helpful' | 'edit', comment?: string): Promise<boolean>
  userId: number
}
export interface LibraryRepository {
  search(query: string, format: string | undefined, page: number, action: 'view' | 'retrieve', filters?: BrowseFilters): Promise<{ items: Material[]; hasNextPage: boolean; total?: number }>
  /** `file` selects which of the page's files to preview (e.g. arriving from a search hit inside it). */
  get(id: string, action: 'view' | 'retrieve', options?: { file?: number }): Promise<Material | null>
}

export function createLibrary(repository: LibraryRepository, origin: string) {
  const urlFor = (id: string, citation?: string, file?: number) => {
    const url = new URL(`/resources/${encodeURIComponent(id)}`, origin)
    if (citation) url.searchParams.set('citation', citation)
    if (file) { url.searchParams.set('file', String(file)); url.hash = `file-${file}` }
    return url.toString()
  }
  return {
    async search(query: string, page = 1, format?: string) {
      const result = await repository.search(query, format, page, 'retrieve')
      return { ...result, items: result.items.map(item => ({ id: item.id, title: item.title,
        description: item.description.slice(0, 500), format: item.format, version: item.version, url: urlFor(item.id),
        // Where it matched (a passage, maybe inside one of the page's files) and a link to the page opened there.
        ...(item.match ? { matchedIn: item.match.locator, citationId: item.match.citationId, matchUrl: urlFor(item.id, item.match.citationId, item.match.assetId) } : {}) })) }
    },
    async read(id: string) {
      const item = await repository.get(id, 'retrieve')
      if (!item) return null
      return { id: item.id, title: item.title, version: item.version, url: urlFor(id),
        text: item.body.slice(0, 12000), truncated: item.body.length > 12000,
        evidence: item.evidence.slice(0, 20).map(e => ({ ...e, text: e.text.slice(0, 2000), url: urlFor(id, e.id) })) }
    },
    async cite(id: string, citationId: string) {
      const item = await repository.get(id, 'retrieve')
      const evidence = item?.evidence.find(e => e.id === citationId && e.version === item.version)
      return evidence && item ? { ...evidence, title: item.title, url: urlFor(id, citationId) } : null
    },
  }
}
