export interface Evidence {
  id: string; version: string; text: string; locator: string
}
export interface Material {
  id: string; title: string; description: string; format: string; version: string;
  body: string; updatedAt: string; evidence: Evidence[]
  vimeoId?: string; previewAssetId?: number; downloadAssetIds?: number[]; thumbnailVersion?: string
  kind?: string; section?: string; topics?: string[]
  audience?: string; licensing?: string[]; lines?: string[]; program?: string; carriers?: number[]; takeaways?: string[]
  /** Set on direct reads for the reader's detail page. */
  details?: { owner?: string; lastReviewedAt?: string; reviewDueAt?: string; reviewWindow?: string }
  /** Originals the reader may view inline (PDF, image, audio, video, sheets). Download permission is required until view-only derivatives exist (ADR-026). */
  inlineAssets?: { id: number; mimeType: string }[]
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
  get(id: string, action: 'view' | 'retrieve'): Promise<Material | null>
}

export function createLibrary(repository: LibraryRepository, origin: string) {
  const urlFor = (id: string, citation?: string) => {
    const url = new URL(`/resources/${encodeURIComponent(id)}`, origin)
    if (citation) url.searchParams.set('citation', citation)
    return url.toString()
  }
  return {
    async search(query: string, page = 1, format?: string) {
      const result = await repository.search(query, format, page, 'retrieve')
      return { ...result, items: result.items.map(item => ({ id: item.id, title: item.title,
        description: item.description.slice(0, 500), format: item.format, version: item.version, url: urlFor(item.id) })) }
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
