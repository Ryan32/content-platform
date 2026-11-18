import { describe, expect, it, vi } from 'vitest'
import { formatFor, titleFromFileName } from '../src/server/processing'
import { rankedContentIds } from '../src/server/search'
import { Users, AccessProfiles, Audiences } from '../src/collections'

const scopeField = (fields: any[], path: string[]): any => {
  const [name, ...rest] = path
  // Descend through unnamed layout fields (rows, collapsibles) to find named fields.
  const flat = fields.flatMap(f => !f.name && f.fields ? f.fields : [f])
  const field = flat.find(f => f.name === name)
  return rest.length ? scopeField(field.fields, rest) : field
}

describe('REQ-CMS-02: bulk add naming and formats', () => {
  it('derives readable titles and library formats from file names', () => {
    expect(titleFromFileName('2026_Tax__Planning-Playbook.pdf')).toBe('2026 Tax Planning - Playbook')
    expect(titleFromFileName('.pdf')).toBe('Untitled')
    expect(formatFor('deck.PPTX')).toBe('slides')
    expect(formatFor('webinar.mp4')).toBe('video')
    expect(formatFor('notes.txt')).toBe('document')
    expect(formatFor('payload.exe')).toBeUndefined()
  })
})

describe('REQ-AUTH-05: audiences are chosen from an approved list', () => {
  const find = vi.fn(async ({ where }: any) => ({ docs: where.and[0].key.equals === 'business-line:annuity' ? [{ id: 1 }] : [] }))
  const req = { payload: { find } }
  for (const [label, field] of [['membership', scopeField(Users.fields, ['memberships', 'scope'])],
    ['access rule', scopeField(AccessProfiles.fields, ['grants', 'scope'])]] as const) {
    it(`accepts only active audiences on a ${label}`, async () => {
      expect(await field.validate('business-line:annuity', { req })).toBe(true)
      expect(await field.validate('business-line:anuity', { req })).toMatch(/active audience/)
      expect(await field.validate('', { req })).toMatch(/Choose an audience/)
      // Values saved before the Audiences list existed stay valid until changed.
      expect(await field.validate('legacy:scope', { req, previousValue: 'legacy:scope' })).toBe(true)
    })
  }
  it('requires a stable, lowercase audience key that cannot be edited later', () => {
    const key = Audiences.fields.find((f: any) => f.name === 'key') as any
    expect(key.validate('business-line:annuity', {})).toBe(true)
    expect(key.validate('Business Line', {})).toMatch(/lowercase/)
    expect(key.access.update({})).toBe(false)
  })
})

describe('REQ-SEARCH-01: ranked full-text search', () => {
  it('returns ranked IDs, an empty list for no matches, and null for stop-word-only queries', async () => {
    const db = (ranked: number[], nodes: number) => ({ query: vi.fn(async (sql: string) =>
      ({ rows: sql.includes('ts_rank_cd') ? ranked.map(id => ({ id })) : [{ id: nodes }] })) })
    expect(await rankedContentIds(db([3, 1], 1), 'tax planning')).toEqual([3, 1])
    expect(await rankedContentIds(db([], 2), 'nothing matches')).toEqual([])
    expect(await rankedContentIds(db([], 0), 'the')).toBeNull()
  })
})
