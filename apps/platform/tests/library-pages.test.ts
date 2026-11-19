import { describe, expect, it } from 'vitest'
import { carrierGroups } from '../src/domain/carriers'
import { applyReviewSchedule, approvalRoute, suggestedWindow } from '../src/domain/review'
import { parseMarkdown } from '../src/domain/markdown'
import { topicHref } from '../src/domain/navigation'
import type { Material } from '../src/domain/library'

const item = (id: string, extra: Partial<Material>): Material => ({ id, title: id, description: '', format: 'pdf', version: 'v', body: '', updatedAt: '', evidence: [], ...extra })
const now = new Date('2026-11-18T12:00:00.000Z')

describe('REQ-CARRIER-01: carrier pages group items by what the advisor needs to do', () => {
  it('uses type, audience and topics, first match wins', () => {
    const groups = carrierGroups([item('a', { kind: 'howto', topics: ['products:commission-schedules'] }), item('b', { topics: ['products:commission-schedules'] }),
      item('c', { topics: ['operations:sample-applications'] }), item('d', { audience: 'client' }), item('e', { lines: ['life'] }), item('f', {})])
    expect(groups.map(g => [g.id, g.items.map(i => i.id)])).toEqual([['howto', ['a']], ['clients', ['d']], ['pay', ['b']], ['apply', ['c']], ['underwriting', ['e']], ['other', ['f']]])
  })
  it('sends Carriers A–Z to the carrier index', () => {
    expect(topicHref('products', 'Carriers A–Z')).toBe('/carriers')
  })
})

describe('REQ-GOV-03: snooze, default windows and approval routing', () => {
  const published = { state: 'published', reviewWindow: 'annual', lastReviewedAt: '2025-11-01T00:00:00.000Z' }
  it('snoozes once per review for 7 days, and renewing clears it', () => {
    const snoozed = applyReviewSchedule({}, published, { renewal: false, snooze: true, now })
    expect(snoozed.reviewDueAt).toBe('2026-11-25T12:00:00.000Z')
    expect(() => applyReviewSchedule({}, { ...published, snoozedAt: snoozed.snoozedAt }, { renewal: false, snooze: true, now })).toThrow('already snoozed')
    const edited = applyReviewSchedule({ title: 'x' }, { ...published, snoozedAt: snoozed.snoozedAt }, { renewal: false, now })
    expect(edited.reviewDueAt).toBe('2026-11-25T12:00:00.000Z')
    const renewed = applyReviewSchedule({}, { ...published, snoozedAt: snoozed.snoozedAt }, { renewal: true, now })
    expect(renewed.snoozedAt).toBeNull(); expect(renewed.reviewDueAt).toBe('2027-11-18T12:00:00.000Z')
  })
  it('suggests a window from where an item is filed', () => {
    expect(suggestedWindow({ topics: ['products:commission-schedules'] })).toBe('monthly')
    expect(suggestedWindow({ topics: ['operations:forms'] })).toBe('semiannual')
    expect(suggestedWindow({ section: 'events' })).toBe('fixedDate')
    expect(suggestedWindow({ format: 'video' })).toBe('biennial')
    expect(suggestedWindow({})).toBe('annual')
  })
  it('routes approval by audience, line of business and carrier', () => {
    expect(approvalRoute({ audience: 'client', lines: ['wealth'] }).approvers).toContain('Compliance, then Creative Services')
    expect(approvalRoute({ lines: ['wealth'] }).approvers).toBe('AEWM Compliance')
    expect(approvalRoute({ carriers: [1] }).when).toBe('Carrier documents and forms')
    expect(approvalRoute({}).approvers).toBe('Section owner')
  })
})

describe('REQ-HOWTO-02: callouts in how-to articles', () => {
  it('turns > lines into one callout block', () => {
    const blocks = parseMarkdown('Intro\n\n> **Note:** first\n> second\n\nAfter')
    expect(blocks.map(b => b.type)).toEqual(['paragraph', 'callout', 'paragraph'])
  })
})
