import { describe, it, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createContentMcp } from '../src/mcp/server'
import { createLibrary, type Material, type LibraryRepository } from '../src/domain/library'

const item: Material = { id: '1', title: 'Synthetic onboarding guide', format: 'article', description: 'Test fixture only',
  body: 'Use an approved account.', version: 'v1', updatedAt: '2026-11-17T00:00:00Z',
  evidence: [{ id: 'cite-1', version: 'v1', text: 'Use an approved account.', locator: 'Section 1' }],
}
function fixture() {
  let revoked = false
  const calls: string[] = []
  const repository: LibraryRepository = {
    async search(_q, _f, _p, action) { calls.push(action); return { items: revoked ? [] : [item], hasNextPage: false } },
    async get(id, action) { calls.push(action); return !revoked && id === item.id ? item : null },
  }
  return { repository, calls, revoke: () => { revoked = true } }
}
describe('REQ-MCP-01: general read tools', () => {
  it('negotiates, lists tools, and returns evidence with a canonical link through the SDK', async () => {
    const f = fixture()
    const server = createContentMcp(f.repository, 'https://library.example', ['content:search', 'content:read'])
    const client = new Client({ name: 'independent-test-client', version: '1' })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(a), client.connect(b)])
    try {
      const tools = await client.listTools()
      expect(tools.tools.map(t => t.name)).toEqual(['search_content', 'get_content', 'resolve_citation'])
      const result = await client.callTool({ name: 'resolve_citation', arguments: { id: '1', citationId: 'cite-1' } })
      expect(JSON.stringify(result)).toContain('https://library.example/resources/1?citation=cite-1')
      f.revoke()
      const denied = await client.callTool({ name: 'get_content', arguments: { id: '1' } })
      expect(JSON.stringify(denied)).not.toContain(item.title)
      expect(f.calls.every(action => action === 'retrieve')).toBe(true)
    } finally { await client.close(); await server.close() }
  })
  it('does not expose read tools to a search-only token', async () => {
    const server = createContentMcp(fixture().repository, 'https://library.example', ['content:search'])
    const client = new Client({ name: 'test', version: '1' })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(a), client.connect(b)])
    try {
      expect((await client.listTools()).tools.map(t => t.name)).toEqual(['search_content'])
      expect((await client.callTool({ name: 'get_content', arguments: { id: '1' } })).isError).toBe(true)
    } finally { await client.close(); await server.close() }
  })
  it('answers stateless Streamable HTTP initialize', async () => {
    const server = createContentMcp(fixture().repository, 'https://library.example', ['content:read'])
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
    await server.connect(transport)
    try {
      const response = await transport.handleRequest(new Request('https://library.example/mcp', { method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
      }))
      expect(response.status).toBe(200)
      expect((await response.json()).result.serverInfo.name).toBe('ae-content-platform')
    } finally { await server.close() }
  })
  it('does not silently relink a superseded citation', async () => {
    const f = fixture()
    const repository: LibraryRepository = { ...f.repository, get: async () => ({ ...item, version: 'v2' }) }
    expect(await createLibrary(repository, 'https://library.example').cite('1', 'cite-1')).toBeNull()
  })
})
