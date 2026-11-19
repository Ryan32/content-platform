import { describe, expect, it, vi } from 'vitest'
import { PROFILE_SEED, AUDIENCE_SEED, profileForWordPressRoles } from '../src/domain/access-seed'
import { autopilotDecision, snapshotRoles } from '../src/processing/autopilot'
import { seedReference } from '../src/reference/seed'
import type { AnalysisEnvelope } from '../src/processing/analysis'

describe('REQ-IMPORT-10: WordPress access maps to decided profiles, never by AI', () => {
  it('maps the decided role combinations (ACCESS-MODEL section 6)', () => {
    expect(profileForWordPressRoles(['full-only'])).toBe('Full-Active members')
    expect(profileForWordPressRoles(['full-only', 'io', 'medicare', '__wpdm__'])).toBe('Full-Active members')
    expect(profileForWordPressRoles(['full-only', 'subscriber', 'life'])).toBe('All members')
    expect(profileForWordPressRoles(['aewm'])).toBe('AEWM-restricted')
    expect(profileForWordPressRoles(['aewm', 'guest'])).toBe('AEWM-restricted')
    expect(profileForWordPressRoles(['elite-signature-status', 'legends-signature-status'])).toBe('Elite and above')
    expect(profileForWordPressRoles(['rob-russell-bootcamp', 'rob-russell-coaching'])).toBe('Program: Rob Russell (Coaching or Bootcamp)')
    expect(profileForWordPressRoles(['commission-schedules', 'io', 'life'])).toBe('All members')
  })

  it('holds unknown, empty, mixed and open-decision cases for a person (fail closed)', () => {
    expect(profileForWordPressRoles([])).toBeNull()
    expect(profileForWordPressRoles(['guest', '__wpdm__'])).toBeNull()
    expect(profileForWordPressRoles(['aewm', 'full-only'])).toBeNull()
    expect(profileForWordPressRoles(['aexchange-thacker', 'elite-signature-status'])).toBeNull()
    expect(profileForWordPressRoles(['some-new-role'])).toBeNull()
  })

  it('only names profiles and audiences that the seed creates', () => {
    const names = new Set(PROFILE_SEED.map(p => p.name)), keys = new Set(AUDIENCE_SEED.map(a => a.key))
    for (const roles of [['full-only'], ['subscriber'], ['aewm'], ['premier-signature-status'], ['elite-signature-status'], ['legends-signature-status'],
      ['rob-russell-coaching'], ['rob-russell-coaching', 'rob-russell-bootcamp'], ['commission-schedules']])
      expect(names.has(profileForWordPressRoles(roles)!)).toBe(true)
    expect(PROFILE_SEED.flatMap(p => p.scopes).every(s => keys.has(s))).toBe(true)
  })

  it('reads roles from the import snapshot manifest', () => {
    expect(snapshotRoles({ manifest: { package_and_category_roles: ['aewm', 7, '__wpdm__'] } })).toEqual(['aewm', '__wpdm__'])
    expect(snapshotRoles(null)).toEqual([])
  })
})

describe('REQ-AI-05: migration autopilot applies the review rule unchanged', () => {
  const envelope = (current: { tags: number[] }) => ({
    analysis: { title: { value: 'Clean title', reason: '', evidenceIds: [] }, summary: { value: 'AI summary', reason: '', evidenceIds: [] },
      tags: [{ termId: 4, evidenceIds: ['s1-e1'], confidence: 0.9 }], newTags: [{ label: 'X tag', dimension: 'topic', definition: 'd', evidenceIds: ['s1-e1'] }] },
    current: { tags: current.tags },
  }) as unknown as AnalysisEnvelope

  it('keeps the team tags, backfills AI tags only when there are none, and never creates new tags', () => {
    const kept = autopilotDecision(envelope({ tags: [9] }), '2026-11-18T00:00:00Z')
    expect(kept).toMatchObject({ decision: 'accepted', use: {}, tags: [9], newTags: [], files: [], summary: 'AI summary', title: 'Clean title' })
    expect(autopilotDecision(envelope({ tags: [] }), 'x').tags).toEqual([4])
  })
})

describe('REQ-ACCESS-02: reference seed is create-only', () => {
  it('creates what is missing and never edits existing records', async () => {
    const existing = new Set(['audiences:internal:employees', 'access-profiles:All members', 'carriers:athene', 'taxonomy:topic:seminars'])
    const payload = {
      count: vi.fn(async ({ collection, where }: { collection: string; where: Record<string, { equals: string }> }) =>
        ({ totalDocs: existing.has(`${collection}:${Object.values(where)[0].equals}`) ? 1 : 0 })),
      create: vi.fn(async () => ({ id: 1 })), update: vi.fn(),
    }
    const created = await seedReference(payload as never, { schema: 'ae-library-reference/1',
      carriers: [{ name: 'Athene', slug: 'athene', lines: ['annuity'] }, { name: 'Pacific Life', slug: 'pacific-life', lines: [] }],
      tags: [{ key: 'topic:seminars', label: 'Seminars', dimension: 'topic', definition: 'd' }] })
    expect(created).toEqual({ audiences: AUDIENCE_SEED.length - 1, profiles: PROFILE_SEED.length - 1, carriers: 1, tags: 0 })
    expect(payload.update).not.toHaveBeenCalled()
    const full = payload.create.mock.calls.map(c => (c as unknown as [{ collection: string; data: { name?: string; grants?: unknown[] } }])[0])
      .find(c => c.collection === 'access-profiles' && c.data.name === 'Full-Active members')
    expect(full?.data.grants).toHaveLength(6)
  })
})
