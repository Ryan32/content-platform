import { createHash } from 'node:crypto'
import { z } from 'zod'
import { analysisEnvelope, MULTI_FIELDS, SINGLE_FIELDS, validateAnalysis, type AnalysisEnvelope, type CurrentRecord } from './analysis'
import { slugify } from '../domain/navigation'

/**
 * Review rule for combined analyses (owner decision, 2026-11-18):
 *  - Keep what the library team wrote. Title and summary default to the current value; AI wording is a proposed clean-up.
 *  - Backfill what is missing. Empty fields (and import defaults never chosen by a person) default to the AI value.
 *  - Everything else the AI proposes is shown beside the current value and applies only if the reviewer picks it.
 * Nothing here publishes, grants access, or deletes; acceptance moves an Intake item to Draft.
 */
export const REVIEW_FIELDS = ['title', 'summary', ...SINGLE_FIELDS, ...MULTI_FIELDS, 'carriers', 'takeaways'] as const
export type ReviewField = typeof REVIEW_FIELDS[number]
type Choice = 'current' | 'suggested'

const IMPORT_DEFAULTS: Partial<Record<ReviewField, string>> = { kind: 'resource', audience: 'advisor' }

/** The proposed value for a field, or undefined when the AI made no proposal. */
export function suggestedValue(e: AnalysisEnvelope, field: ReviewField): unknown {
  const a = e.analysis
  switch (field) {
    case 'title': return a.title?.value
    case 'summary': return a.summary.value
    case 'carriers': return a.carriers?.ids.length ? a.carriers.ids : undefined
    case 'takeaways': return a.takeaways.length ? a.takeaways.map(t => t.text) : undefined
    default: {
      const v = a[field]
      if (!v) return undefined
      return 'values' in v ? (v.values.length ? v.values : undefined) : v.value
    }
  }
}
export function currentValue(c: CurrentRecord, field: ReviewField): unknown {
  return field === 'summary' ? c.description : c[field]
}
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Which option the review form pre-selects. */
export function defaultChoice(e: AnalysisEnvelope, field: ReviewField): Choice {
  const proposed = suggestedValue(e, field), current = currentValue(e.current, field)
  if (proposed === undefined || same(proposed, current)) return 'current'
  if (isEmpty(current)) return 'suggested'
  // A migrated record never chose these; the import set the schema default.
  if (e.current.migrated && IMPORT_DEFAULTS[field] === current) return 'suggested'
  return 'current'
}
/** Tags: keep every current tag; pre-check AI tags (and proposed new tags) only when the item has none. */
export const backfillTags = (e: AnalysisEnvelope) => e.current.tags.length === 0

export const analysisReviewInput = z.object({
  decision: z.enum(['accepted', 'rejected']), expectedUpdatedAt: z.string().min(1), note: z.string().max(2000),
  title: z.string().trim().max(300), summary: z.string().trim().max(2000),
  use: z.partialRecord(z.enum(REVIEW_FIELDS), z.enum(['current', 'suggested'])),
  tags: z.array(z.number().int().positive()).max(80), newTags: z.array(z.number().int().min(0).max(7)).max(8),
}).strict()
export type AnalysisReviewInput = z.infer<typeof analysisReviewInput>

export function readAnalysisForm(form: URLSearchParams) {
  return analysisReviewInput.safeParse({
    decision: form.get('decision'), expectedUpdatedAt: form.get('expectedUpdatedAt'), note: form.get('note') ?? '',
    title: form.get('title') ?? '', summary: form.get('summary') ?? '',
    use: Object.fromEntries(REVIEW_FIELDS.filter(f => form.has(`use_${f}`)).map(f => [f, form.get(`use_${f}`)])),
    tags: form.getAll('tags').map(Number), newTags: form.getAll('newTags').map(Number),
  })
}

export const newTagKey = (t: { label: string; dimension: string }) => `${t.dimension}:${slugify(t.label)}`

/**
 * Builds the content update for an accepted analysis. `newTagIds` are the taxonomy IDs created or reused for the
 * selected new tags (resolved by the caller inside the same transaction). Throws on stale or forged input.
 */
export function analysisPatch(value: unknown, content: { sourceHash?: string | null; updatedAt: string; vimeoId?: string | null; state?: string | null; body?: string | null },
  sourceVersion: string, input: AnalysisReviewInput, newTagIds: number[]) {
  const e = analysisEnvelope.parse(value)
  if (input.decision === 'rejected') return null
  if (content.sourceHash !== sourceVersion || content.updatedAt !== input.expectedUpdatedAt) throw new Error('stale_review')
  if (e.sourceVimeoId && content.vimeoId !== e.sourceVimeoId) throw new Error('stale_video')
  validateAnalysis(e.analysis, new Set(e.passages.map(p => p.id)), e.taxonomyIds, e.carriers.map(c => c.id))
  const allowedTags = new Set([...e.current.tags, ...e.taxonomyIds])
  if (input.tags.some(id => !allowedTags.has(id))) throw new Error('unapproved_taxonomy')
  if (input.newTags.some(i => i >= e.analysis.newTags.length)) throw new Error('unknown_new_tag')

  const patch: Record<string, unknown> = {}
  const pick = (field: ReviewField) => (input.use[field] ?? defaultChoice(e, field)) === 'suggested' && suggestedValue(e, field) !== undefined
  // Editable text: the reviewer's edited wording wins; an unchanged box means "keep current".
  if (pick('title') && input.title) patch.title = input.title
  if (pick('summary') && input.summary) patch.description = input.summary
  for (const field of [...SINGLE_FIELDS, ...MULTI_FIELDS] as const) if (pick(field)) patch[field] = suggestedValue(e, field)
  if (pick('carriers')) patch.carriers = suggestedValue(e, 'carriers')
  if (pick('takeaways')) patch.takeaways = (suggestedValue(e, 'takeaways') as string[]).map(text => ({ text }))
  patch.acceptedTags = [...new Set([...input.tags, ...newTagIds])]

  // Citations and search evidence come from every source; reading text is only backfilled, never replaced.
  const version = createHash('sha256').update(JSON.stringify({ sourceVersion, passages: e.passages })).digest('hex')
  patch.evidenceVersion = version
  patch.passages = e.passages.map(p => ({ citationId: `${version.slice(0, 16)}-${p.id}`, version, text: p.text, locator: p.locator }))
  if (!content.body?.trim()) patch.body = e.passages.map(p => p.text).join('\n\n')
  if (content.state === 'intake') patch.state = 'draft'
  return patch
}
