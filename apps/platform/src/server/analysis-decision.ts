import type { Payload, PayloadRequest } from 'payload'
import { analysisPatch, fileDescriptionUpdates, newTagKey, reviewLabels, type AnalysisReviewInput } from '../processing/analysis-review'
import { analysisEnvelope } from '../processing/analysis'
import { taxonomyUnchanged } from '../processing/review'

/**
 * Applies a decision on a combined AI analysis inside the caller's transaction: the reviewing editor's choices from the
 * Review screen, or the migration autopilot's defaults (`asUser` omitted: system, which the autopilot only uses for
 * migrated items). Same checks either way: stale item or taxonomy, unknown carriers, unapproved tags. New vocabulary is
 * created only for the `newTags` the caller lists. Returns what changed, for review labels.
 */
export async function applyAnalysisDecision(payload: Payload, req: PayloadRequest, suggestionId: number, input: AnalysisReviewInput,
  meta: { asUser?: { id: number | string }; reviewAttempt: string }) {
  const overrideAccess = !meta.asUser
  const suggestion = await payload.findByID({ collection: 'suggestions', id: suggestionId, req, overrideAccess, depth: 0 })
  if (suggestion.decision !== 'pending') throw new Error('already_reviewed')
  const contentId = typeof suggestion.content === 'number' ? suggestion.content : suggestion.content.id
  const content = await payload.findByID({ collection: 'content', id: contentId, req, overrideAccess, depth: 0 })
  const envelope = analysisEnvelope.parse(suggestion.proposal)
  const newTagIds: number[] = []
  if (input.decision === 'accepted') {
    // Suggested existing tags must be unchanged since the AI saw them; current tags are the team's own.
    const offered = input.tags.filter(t => envelope.taxonomyIds.includes(t))
    const terms = await payload.find({ collection: 'taxonomy', where: { id: { in: offered } }, pagination: false, req, overrideAccess })
    if (terms.docs.length !== offered.length || !taxonomyUnchanged(envelope as never, terms.docs, offered)) throw new Error('taxonomy_changed')
    const carriers = envelope.analysis.carriers?.ids ?? []
    if (carriers.length && (await payload.find({ collection: 'carriers', where: { id: { in: carriers } }, pagination: false, req, overrideAccess })).docs.length !== carriers.length) throw new Error('carriers_changed')
    // Approved new vocabulary: reuse a tag with the same key, otherwise create it.
    for (const index of input.newTags) {
      const t = envelope.analysis.newTags[index], key = newTagKey(t)
      const found = await payload.find({ collection: 'taxonomy', where: { key: { equals: key } }, limit: 1, req, overrideAccess })
      newTagIds.push(found.docs[0]?.id ?? (await payload.create({ collection: 'taxonomy', req, overrideAccess,
        data: { label: t.label, dimension: t.dimension, definition: t.definition, key } as never })).id)
    }
  }
  const patch = analysisPatch(suggestion.proposal, content, suggestion.sourceVersion, input, newTagIds)
  if (patch) await payload.update({ collection: 'content', id: contentId, data: patch as never, req, overrideAccess: true, context: { reviewedEvidence: true } })
  let fileUpdates: { assetId: number; description: string }[] = []
  if (patch) {
    // Per-file descriptions: only this item's files of the reviewed source version.
    const files = await payload.find({ collection: 'assets', req, overrideAccess: true, depth: 0, pagination: false,
      where: { and: [{ content: { equals: contentId } }, { version: { equals: suggestion.sourceVersion } }] } })
    const current = new Map(files.docs.map(f => [Number(f.id), (f as { description?: string | null }).description]))
    fileUpdates = fileDescriptionUpdates(envelope, input, current)
    for (const update of fileUpdates)
      await payload.update({ collection: 'assets', id: update.assetId, data: { description: update.description } as never, req, overrideAccess: true })
  }
  await payload.update({ collection: 'suggestions', id: suggestionId, req, overrideAccess: true,
    data: { decision: input.decision, reviewNote: input.note, reviewedBy: meta.asUser ? meta.asUser.id : null, reviewedAt: new Date().toISOString(), reviewAttempt: meta.reviewAttempt } as never })
  return { contentId, model: suggestion.model, labels: reviewLabels(envelope, input, patch, fileUpdates, newTagIds) }
}
