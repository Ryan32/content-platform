export interface Evidence {
  id: string; version: string; text: string; locator: string
}
export interface Material {
  id: string; title: string; description: string; format: string; version: string;
  body: string; updatedAt: string; evidence: Evidence[]
  vimeoId?: string; previewAssetId?: number; downloadAssetIds?: number[]
}
export interface LibraryRepository {
  search(query: string, format: string | undefined, page: number, action: 'view' | 'retrieve'): Promise<{ items: Material[]; hasNextPage: boolean }>
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
