import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createLibrary, type LibraryRepository } from '../domain/library'

export function createContentMcp(repository: LibraryRepository, origin: string, scopes: string[]) {
  const server = new McpServer({ name: 'ae-content-platform', version: '0.1.0' })
  const library = createLibrary(repository, origin)
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  const respond = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  if (scopes.includes('content:search')) server.registerTool('search_content', {
    description: 'Find authorized AE library material by title, description, or text. Returns stable reader links. Currently keyword search, not semantic ranking.',
    inputSchema: { query: z.string().max(200), page: z.number().int().min(1).max(100).default(1),
      format: z.enum(['article', 'pdf', 'video', 'audio', 'slides', 'document']).optional() }, annotations,
  }, async ({ query, page, format }) => respond(await library.search(query, page, format)))
  if (scopes.includes('content:read')) {
    server.registerTool('get_content', {
      description: 'Read bounded text and evidence from one authorized content ID. Null means unavailable; do not infer its existence.',
      inputSchema: { id: z.string().regex(/^\d+$/).max(30) }, annotations,
    }, async ({ id }) => respond(await library.read(id)))
    server.registerTool('resolve_citation', {
      description: 'Resolve a citation against current access and exact evidence version. Null means unavailable or superseded.',
      inputSchema: { id: z.string().regex(/^\d+$/).max(30), citationId: z.string().min(1).max(120) }, annotations,
    }, async ({ id, citationId }) => respond(await library.cite(id, citationId)))
  }
  return server
}
