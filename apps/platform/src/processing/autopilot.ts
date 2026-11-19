import { randomUUID } from 'node:crypto'
import type { Payload } from 'payload'
import { inTransaction } from '../db/payload-db'
import { profileForWordPressRoles } from '../domain/access-seed'
import { analysisEnvelope, ANALYSIS_VERSION, type AnalysisEnvelope } from './analysis'
import { backfillTags, type AnalysisReviewInput } from './analysis-review'
import { applyAnalysisDecision } from '../server/analysis-decision'

export const AUTOPILOT_NOTE = 'Applied automatically by the migration autopilot: kept the team\u2019s values, filled in what was missing.'

/**
 * The decision a reviewer would get by pressing Accept without changing anything (the ADR-037 review rule): keep what
 * the team wrote, backfill empty fields with the AI value, keep current tags (or take the AI's when there are none).
 * Never creates new vocabulary.
 */
export function autopilotDecision(e: AnalysisEnvelope, expectedUpdatedAt: string): AnalysisReviewInput {
  return { decision: 'accepted', expectedUpdatedAt, note: AUTOPILOT_NOTE, title: e.analysis.title?.value ?? '', summary: e.analysis.summary.value,
    use: {}, tags: backfillTags(e) ? e.analysis.tags.map(t => t.termId) : e.current.tags, newTags: [], files: [] }
}

/** WordPress package roles recorded in the item's import snapshot. */
export function snapshotRoles(snapshot: unknown): string[] {
  const roles = (snapshot as { manifest?: { package_and_category_roles?: unknown } } | null)?.manifest?.package_and_category_roles
  return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : []
}

/**
 * Applies pending combined analyses for migrated WordPress items: details by the review rule, the audience by the
 * fixed WordPress role mapping (never by AI), state Intake -> Draft. Publishing stays a person's decision. Items that
 * cannot be applied (stale, taxonomy changed) stay in Review and are not retried by this process.
 */
export async function runAutopilot(payload: Payload, skip: Set<number>, limit = 10) {
  const pending = await payload.find({ collection: 'suggestions', overrideAccess: true, depth: 0, limit: 100, sort: 'createdAt',
    where: { decision: { equals: 'pending' } } })
  const results: { suggestion: number; content: number; outcome: string; profile?: string | null }[] = []
  for (const suggestion of pending.docs) {
    if (results.length >= limit) break
    const id = Number(suggestion.id)
    if (skip.has(id)) continue
    const parsed = analysisEnvelope.safeParse(suggestion.proposal)
    if (!parsed.success || parsed.data.analysisVersion !== ANALYSIS_VERSION || !parsed.data.current.migrated) continue
    const contentId = typeof suggestion.content === 'number' ? suggestion.content : Number((suggestion.content as { id: number }).id)
    const attempt = randomUUID()
    try {
      const profile = await inTransaction(payload, async req => {
        const content = await payload.findByID({ collection: 'content', id: contentId, req, overrideAccess: true, depth: 0 })
        if (!String(content.sourceKey ?? '').startsWith('wordpress:')) throw new Error('not_migrated')
        await applyAnalysisDecision(payload, req, id, autopilotDecision(parsed.data, content.updatedAt), { reviewAttempt: attempt })
        if (content.accessProfile) return undefined
        const snapshot = await payload.find({ collection: 'source-snapshots', req, overrideAccess: true, depth: 0, limit: 1, sort: '-createdAt',
          where: { sourceKey: { equals: content.sourceKey } } })
        const name = profileForWordPressRoles(snapshotRoles(snapshot.docs[0]?.snapshot))
        if (!name) return null
        const found = await payload.find({ collection: 'access-profiles', req, overrideAccess: true, depth: 0, limit: 1,
          where: { and: [{ name: { equals: name } }, { active: { equals: true } }] } })
        if (!found.docs[0]) return null
        await payload.update({ collection: 'content', id: contentId, req, overrideAccess: true, data: { accessProfile: found.docs[0].id } as never })
        return name
      }, { isolation: 'serializable', confirm: async () =>
        (await payload.findByID({ collection: 'suggestions', id, overrideAccess: true, depth: 0 })).reviewAttempt === attempt })
      results.push({ suggestion: id, content: contentId, outcome: 'applied', profile })
    } catch (error) {
      skip.add(id)
      results.push({ suggestion: id, content: contentId, outcome: error instanceof Error ? error.message.slice(0, 60) : 'failed' })
    }
  }
  return results
}
