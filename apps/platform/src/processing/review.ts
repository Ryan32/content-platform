import { z } from 'zod'
import { createHash } from 'node:crypto'
import { proposalSchema, validateProposal } from './schema'

export const extractionSchema = z.object({
  passages: z.array(z.object({ id: z.string().min(1).max(160), text: z.string().min(1).max(20000), locator: z.string().min(1).max(200) }).strict()).min(1).max(50000),
  warnings: z.array(z.string().max(500)).max(100), processorVersion: z.string().min(1).max(100),
}).strict()
export const proposalEnvelope = z.object({
  analysisVersion: z.literal('ae-analysis/1'),
  sourceVimeoId: z.string().regex(/^\d+$/).optional(),
  extraction: extractionSchema,
  proposal: proposalSchema,
  taxonomy: z.array(z.object({ id: z.number().int().positive(), label: z.string(), definition: z.string(), dimension: z.string() }).strict()).max(500),
  taxonomyIds: z.array(z.number().int().positive()), taxonomyVersion: z.string(),
}).strict()
export const reviewInput = z.object({ decision: z.enum(['accepted', 'rejected']), summary: z.string().max(2000),
  tags: z.array(z.number().int().positive()).max(50), note: z.string().max(2000), expectedUpdatedAt: z.string().min(1) }).strict()
export function reviewPatch(value: unknown, current: { sourceHash?: string | null; updatedAt: string; vimeoId?: string | null }, sourceVersion: string, input: z.infer<typeof reviewInput>) {
  const envelope = proposalEnvelope.parse(value)
  // Rejecting stale work records a decision only; it never changes content.
  if (input.decision === 'rejected') return null
  if (current.sourceHash !== sourceVersion || current.updatedAt !== input.expectedUpdatedAt) throw new Error('stale_review')
  validateProposal(envelope.proposal, envelope.extraction, envelope.taxonomyIds)
  if (envelope.sourceVimeoId && current.vimeoId !== envelope.sourceVimeoId) throw new Error('stale_video')
  if (input.tags.some(id => !envelope.taxonomyIds.includes(id))) throw new Error('unapproved_taxonomy')
  const version = createHash('sha256').update(JSON.stringify({ sourceVersion, extraction: envelope.extraction })).digest('hex')
  return { description: input.summary, acceptedTags: [...new Set(input.tags)], state: 'draft' as const,
    body: envelope.extraction.passages.map(p => p.text).join('\n\n'), evidenceVersion: version,
    passages: envelope.extraction.passages.map(p => ({ citationId: `${version.slice(0, 16)}-${p.id}`, version, text: p.text, locator: p.locator })),
    // Evidence-backed takeaways become the reader's "Key takeaways" (reviewed by the editor accepting them).
    takeaways: envelope.proposal.takeaways.slice(0, 6).map(t => ({ text: t.text.slice(0, 300) })) }
}

export function taxonomyUnchanged(value: z.infer<typeof proposalEnvelope>, current: { id: number; label: string; definition?: string | null; dimension?: string | null }[], selected: number[]) {
  return selected.every(id => {
    const before = value.taxonomy.find(t => t.id === id), after = current.find(t => t.id === id)
    return before && after && before.label === after.label && before.definition === (after.definition ?? '') && before.dimension === (after.dimension ?? '')
  })
}
