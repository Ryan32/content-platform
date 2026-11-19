import { describe, expect, it } from 'vitest'
import { ANALYSIS_VERSION, type AnalysisEnvelope } from '../src/processing/analysis'
import { analysisPatch, defaultChoice, readAnalysisForm, newTagKey } from '../src/processing/analysis-review'

function envelope(current: Partial<AnalysisEnvelope['current']> = {}): AnalysisEnvelope {
  return { analysisVersion: ANALYSIS_VERSION, sources: [{ label: 'PDF 1', passages: 1, status: 'used' }],
    passages: [{ id: 's1-e1', text: 'Allianz annuity income guide.', locator: 'PDF 1 · Page 1' }],
    current: { title: 'Team title', description: 'Team summary', body: '', kind: 'resource', section: null, topics: [], pages: [], audience: 'advisor', program: null,
      licensing: [], lines: ['life'], carriers: [], tags: [], takeaways: [], migrated: true, sourceCategories: ['Annuities'], ...current },
    analysis: { title: { value: 'Cleaner title', reason: 'Typos', evidenceIds: ['s1-e1'] }, summary: { value: 'AI summary.', reason: '', evidenceIds: ['s1-e1'] },
      kind: { value: 'howto', reason: '', evidenceIds: [] }, section: { value: 'products', reason: '', evidenceIds: ['s1-e1'] }, topics: null, pages: null,
      audience: { value: 'client', reason: '', evidenceIds: [] }, program: null, licensing: null, lines: { values: ['annuity'], reason: '', evidenceIds: [] },
      carriers: { ids: [8], reason: '', evidenceIds: ['s1-e1'] }, tags: [{ termId: 3, evidenceIds: ['s1-e1'], confidence: 0.9 }],
      newTags: [{ label: 'Income Riders', dimension: 'topic', definition: 'Guaranteed income riders.', evidenceIds: ['s1-e1'] }],
      takeaways: [{ text: 'Income for life.', evidenceIds: ['s1-e1'] }], conflicts: [], warnings: [] },
    taxonomy: [{ id: 3, label: 'Annuities', definition: '', dimension: 'topic' }], taxonomyIds: [3], taxonomyVersion: 'x', carriers: [{ id: 8, name: 'Allianz' }] }
}
const content = { sourceHash: 'v1', updatedAt: 't1', vimeoId: null, state: 'intake', body: '' }
const form = (extra: Record<string, string | string[]> = {}) => {
  const f = new URLSearchParams({ decision: 'accepted', expectedUpdatedAt: 't1', title: 'Cleaner title', summary: 'AI summary.' })
  for (const [k, v] of Object.entries(extra)) for (const x of [v].flat()) f.append(k, x)
  return readAnalysisForm(f)
}

describe('REQ-AI-02: review keeps team values, backfills gaps, proposes clean-up', () => {
  it('pre-selects current for team-written values and the suggestion for empty fields and import defaults', () => {
    const e = envelope()
    expect(defaultChoice(e, 'title')).toBe('current')
    expect(defaultChoice(e, 'summary')).toBe('current')
    expect(defaultChoice(e, 'lines')).toBe('current')          // team chose "life"; AI says annuity → proposal only
    expect(defaultChoice(e, 'section')).toBe('suggested')      // empty → backfill
    expect(defaultChoice(e, 'carriers')).toBe('suggested')
    expect(defaultChoice(e, 'takeaways')).toBe('suggested')
    expect(defaultChoice(e, 'kind')).toBe('suggested')         // migrated item still on the import default
    expect(defaultChoice(envelope({ migrated: false }), 'kind')).toBe('current') // a person chose it
    expect(defaultChoice(envelope({ description: '' }), 'summary')).toBe('suggested')
  })

  it('applies defaults when the form leaves a field untouched, never replaces existing reading text, and moves Intake to Draft', () => {
    const input = form({ tags: '3' })
    expect(input.success).toBe(true)
    const patch = analysisPatch(envelope(), { ...content, body: 'WordPress article' }, 'v1', input.data!, [41])!
    expect(patch).not.toHaveProperty('title'); expect(patch).not.toHaveProperty('description'); expect(patch).not.toHaveProperty('lines')
    expect(patch).toMatchObject({ section: 'products', carriers: [8], kind: 'howto', audience: 'client', takeaways: [{ text: 'Income for life.' }], acceptedTags: [3, 41], state: 'draft' })
    expect(patch).not.toHaveProperty('body')
    expect((patch.passages as unknown[]).length).toBe(1)
  })

  it('applies a proposed clean-up only when the reviewer picks it, using their edited wording', () => {
    const input = form({ use_title: 'suggested', use_summary: 'suggested', use_lines: 'suggested', use_section: 'current' })
    input.data!.title = 'Reviewer wording'
    const patch = analysisPatch(envelope(), content, 'v1', input.data!, [])!
    expect(patch).toMatchObject({ title: 'Reviewer wording', description: 'AI summary.', lines: ['annuity'] })
    expect(patch).not.toHaveProperty('section')
    expect(patch.body).toBe('Allianz annuity income guide.')
  })

  it('rejects stale items, forged tags and unknown new tags; rejection changes nothing', () => {
    expect(() => analysisPatch(envelope(), { ...content, sourceHash: 'v2' }, 'v1', form().data!, [])).toThrow('stale_review')
    expect(() => analysisPatch(envelope(), content, 'v1', form({ tags: '99' }).data!, [])).toThrow('unapproved_taxonomy')
    expect(() => analysisPatch(envelope(), content, 'v1', form({ newTags: '5' }).data!, [])).toThrow('unknown_new_tag')
    expect(analysisPatch(envelope(), content, 'v1', { ...form().data!, decision: 'rejected' }, [])).toBeNull()
    expect(analysisPatch(envelope(), { ...content, state: 'published' }, 'v1', form().data!, [])).not.toHaveProperty('state')
  })

  it('gives proposed new tags a stable key so the same tag is reused across items', () => {
    expect(newTagKey({ label: 'Income Riders', dimension: 'topic' })).toBe('topic:income-riders')
  })
})
