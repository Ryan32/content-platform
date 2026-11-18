import { z } from 'zod'
import type { Extraction } from './extract'
import { ProcessingError } from './jobs'

const evidenceIds = z.array(z.string().min(1).max(160)).min(1).max(32)
export const proposalSchema = z.strictObject({
  summary: z.string().trim().min(1).max(2000),
  tags: z.array(z.strictObject({
    termId: z.number().int().positive(), evidenceIds, confidence: z.number().min(0).max(1),
  })).max(50),
  takeaways: z.array(z.strictObject({ text: z.string().trim().min(1).max(1000), evidenceIds })).max(30),
  warnings: z.array(z.string().max(500)).max(50),
})
export type Proposal = z.infer<typeof proposalSchema>

export function validateProposal(value: unknown, extraction: Extraction, taxonomyIds: readonly number[]): Proposal {
  const result = proposalSchema.safeParse(value)
  if (!result.success) throw new ProcessingError('invalid_proposal')
  const terms = new Set(taxonomyIds)
  const evidence = new Set(extraction.passages.map(p => p.id))
  const proposal = result.data
  if (proposal.tags.some(tag => !terms.has(tag.termId)) ||
      new Set(proposal.tags.map(tag => tag.termId)).size !== proposal.tags.length ||
      [...proposal.tags, ...proposal.takeaways].some(item => item.evidenceIds.some(id => !evidence.has(id)))) {
    throw new ProcessingError('invalid_proposal_reference')
  }
  return proposal
}
