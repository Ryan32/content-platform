import { describe, expect, it } from 'vitest'
import { SECTIONS, TOPIC_OPTIONS, isReadingPath, pageHref, searchHref, sectionFromPath, slugify, tagValue, topicHref } from '../src/domain/navigation'
import { groupSuggestions, highlight, kindForFormat, matchPages, toggleFilter, type SuggestItem } from '../src/domain/suggest'

describe('REQ-NAV-01: reader navigation follows the design handoff', () => {
  it('has the six sections in usage order with topics and familiar pages', () => {
    expect(SECTIONS.map(s => s.id)).toEqual(['products', 'operations', 'marketing', 'planning', 'coaching', 'events'])
    for (const s of SECTIONS) { expect(s.topics.length).toBeGreaterThanOrEqual(5); expect(s.familiar.length).toBeGreaterThan(0) }
  })
  it('finds the active section and reading pages from the path', () => {
    expect(sectionFromPath('/sections/operations')).toBe('operations')
    expect(sectionFromPath('/sections/unknown')).toBeNull()
    expect(sectionFromPath('/')).toBeNull()
    expect(isReadingPath('/resources/12')).toBe(true)
    expect(isReadingPath('/sections/events')).toBe(false)
  })
  it('gives topics and familiar pages stable keys and links', () => {
    expect(slugify('Tax, RMDs & IRAs')).toBe('tax-rmds-iras')
    expect(tagValue('planning', 'Tax, RMDs & IRAs')).toBe('planning:tax-rmds-iras')
    expect(topicHref('planning', 'Tax, RMDs & IRAs')).toBe('/sections/planning?topic=tax-rmds-iras')
    expect(pageHref('products', 'Annuity Rate Watch')).toBe('/sections/products?page=annuity-rate-watch')
    expect(new Set(TOPIC_OPTIONS.map(o => o.value)).size).toBe(TOPIC_OPTIONS.length)
  })
  it('turns topic names into clean search links', () => {
    expect(searchHref('Tax, RMDs & IRAs')).toBe('/?q=Tax+RMDs+IRAs')
  })
})

describe('REQ-NAV-02: Ctrl K search groups live results and filters by type', () => {
  const r = (kind: SuggestItem['kind'], id: string, title = id): SuggestItem => ({ kind, id, title, meta: '', href: `/x/${id}` })
  const results = [r('document', 'a'), r('video', 'b'), r('document', 'c'), r('slides', 'd'), r('page', 'e')]
  it('puts the best result first, then groups by kind, with unfiltered counts', () => {
    const view = groupSuggestions(results, [])
    expect(view.groups.map(g => g.label)).toEqual(['Top hit', 'Documents', 'Videos', 'Slides', 'Pages'])
    expect(view.flat.map(i => i.id)).toEqual(['a', 'c', 'b', 'd', 'e'])
    expect(view.counts).toEqual({ all: 5, document: 2, video: 1, slides: 1, page: 1 })
  })
  it('applies combined type filters but keeps counts for every chip', () => {
    const view = groupSuggestions(results, ['video', 'page'])
    expect(view.flat.map(i => i.id)).toEqual(['b', 'e'])
    expect(view.counts.document).toBe(2)
  })
  it('toggles chips; All or every type clears the filter', () => {
    expect(toggleFilter([], 'video')).toEqual(['video'])
    expect(toggleFilter(['video'], 'video')).toEqual([])
    expect(toggleFilter(['video'], 'all')).toEqual([])
    expect(toggleFilter(['document', 'video', 'slides', 'howto'], 'page')).toEqual([])
  })
  it('maps formats, matches pages and highlights the typed word', () => {
    expect(kindForFormat('audio')).toBe('video')
    expect(kindForFormat('pdf')).toBe('document')
    expect(matchPages('hr hub').map(p => p.title)).toEqual(['Hiring & HR Hub', 'HR Hub'])
    expect(matchPages('commission').map(p => p.title)).toEqual(['Commission Schedules'])
    expect(matchPages('   ')).toEqual([])
    expect(highlight('Allianz Commission Schedule', 'comm')).toEqual(['Allianz ', 'Comm', 'ission Schedule'])
    expect(highlight('Transfer list', 'zzz')).toEqual(['Transfer list', '', ''])
  })
})
