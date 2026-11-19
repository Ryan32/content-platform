import { createLocalReq } from 'payload'
import { editorContext } from '../../../../../server/editor'
import { reviewInput, reviewPatch, proposalEnvelope, taxonomyUnchanged } from '../../../../../processing/review'
import { randomUUID } from 'node:crypto'
import { analysisPatch, fileDescriptionUpdates, newTagKey, readAnalysisForm } from '../../../../../processing/analysis-review'
import { analysisEnvelope, ANALYSIS_VERSION } from '../../../../../processing/analysis'
/** Returns to the review page, or to the Add content wizard when the decision was made there. */
const location = (id: string, error?: string, returnTo?: string | null) => returnTo
  ? `${returnTo}${error ? `&error=${error}` : ''}` : `/admin/review/${id}${error ? `?error=${error}` : ''}`
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let returnTo: string | null = null
  const back = (id: string, error?: string) => new Response(null, { status: 303, headers: { Location: location(id, error, returnTo), 'Cache-Control': 'no-store' } })
  const origin = process.env.PLATFORM_ORIGIN
  if (!origin || request.headers.get('origin') !== new URL(origin).origin) return new Response('Forbidden', { status: 403 })
  if (Number(request.headers.get('content-length') ?? 0) > 20000) return new Response('Request too large', { status: 413 })
  const ctx = await editorContext(request.headers)
  if (!ctx) return new Response('Forbidden', { status: 403 })
  const { id } = await params
  if (!/^\d+$/.test(id)) return new Response('Not found', { status: 404 })
  // Bound the actual body, not merely the caller-supplied Content-Length.
  const reader = request.body?.getReader(); let text = '', size = 0
  if (!reader) return new Response('Invalid review', { status: 400 })
  const decoder = new TextDecoder()
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length
    if (size > 20000) { await reader.cancel(); return new Response('Request too large', { status: 413 }) }; text += decoder.decode(next.value, { stream: true }) }
  text += decoder.decode()
  const form = new URLSearchParams(text)
  const requested = form.get('returnTo')
  returnTo = requested && /^\/admin\/add-content\?id=\d+&step=\d$/.test(requested) ? requested : null
  const combined = form.get('format') === ANALYSIS_VERSION
  const input = reviewInput.safeParse({ decision: form.get('decision'), summary: form.get('summary'), tags: form.getAll('tags').map(Number), note: form.get('note'), expectedUpdatedAt: form.get('expectedUpdatedAt') })
  const v2 = readAnalysisForm(form)
  if (combined ? !v2.success : !input.success) return back(id, 'invalid')
  const tx = await ctx.payload.db.beginTransaction({ isolationLevel: 'serializable' })
  const reviewAttempt = randomUUID()
  if (tx === null || tx === undefined) return new Response('Review unavailable', { status: 503 })
  try {
    const req = await createLocalReq({ user: ctx.user }, ctx.payload); req.transactionID = tx
    const suggestion = await ctx.payload.findByID({ collection: 'suggestions', id: Number(id), req, overrideAccess: false, depth: 0 })
    if (suggestion.decision !== 'pending') throw new Error('already_reviewed')
    const contentId = typeof suggestion.content === 'number' ? suggestion.content : suggestion.content.id
    const content = await ctx.payload.findByID({ collection: 'content', id: contentId, req, overrideAccess: false, depth: 0 })
    if (combined) {
      if (!v2.success || (suggestion.proposal as { analysisVersion?: string })?.analysisVersion !== ANALYSIS_VERSION) throw new Error('format_mismatch')
      const envelope = analysisEnvelope.parse(suggestion.proposal)
      let newTagIds: number[] = []
      if (v2.data.decision === 'accepted') {
        // Suggested existing tags must be unchanged since the AI saw them; current tags are the team's own.
        const offered = v2.data.tags.filter(t => envelope.taxonomyIds.includes(t))
        const terms = await ctx.payload.find({ collection: 'taxonomy', where: { id: { in: offered } }, pagination: false, req, overrideAccess: false })
        if (terms.docs.length !== offered.length || !taxonomyUnchanged(envelope as never, terms.docs, offered)) throw new Error('taxonomy_changed')
        const carriers = envelope.analysis.carriers?.ids ?? []
        if (carriers.length && (await ctx.payload.find({ collection: 'carriers', where: { id: { in: carriers } }, pagination: false, req, overrideAccess: false })).docs.length !== carriers.length) throw new Error('carriers_changed')
        // Approved new vocabulary: reuse a tag with the same key, otherwise create it as the reviewing editor.
        for (const index of v2.data.newTags) {
          const t = envelope.analysis.newTags[index], key = newTagKey(t)
          const found = await ctx.payload.find({ collection: 'taxonomy', where: { key: { equals: key } }, limit: 1, req, overrideAccess: false })
          newTagIds.push(found.docs[0]?.id ?? (await ctx.payload.create({ collection: 'taxonomy', req, overrideAccess: false,
            data: { label: t.label, dimension: t.dimension, definition: t.definition, key } as never })).id)
        }
      }
      const patch = analysisPatch(suggestion.proposal, content, suggestion.sourceVersion, v2.data, newTagIds)
      if (patch) await ctx.payload.update({ collection: 'content', id: contentId, data: patch as never, req, overrideAccess: true, context: { reviewedEvidence: true } })
      if (patch) {
        // Per-file descriptions: only this item's files of the reviewed source version.
        const files = await ctx.payload.find({ collection: 'assets', req, overrideAccess: true, depth: 0, pagination: false,
          where: { and: [{ content: { equals: contentId } }, { version: { equals: suggestion.sourceVersion } }] } })
        const current = new Map(files.docs.map(f => [Number(f.id), (f as { description?: string | null }).description]))
        for (const update of fileDescriptionUpdates(envelope, v2.data, current))
          await ctx.payload.update({ collection: 'assets', id: update.assetId, data: { description: update.description } as never, req, overrideAccess: true })
      }
      await ctx.payload.update({ collection: 'suggestions', id: Number(id), req, overrideAccess: true,
        data: { decision: v2.data.decision, reviewNote: v2.data.note, reviewedBy: ctx.user.id, reviewedAt: new Date().toISOString(), reviewAttempt } })
      await ctx.payload.db.commitTransaction(tx)
      const persisted = await ctx.payload.findByID({ collection: 'suggestions', id: Number(id), user: ctx.user, overrideAccess: false, depth: 0 })
      if (persisted.reviewAttempt !== reviewAttempt) throw new Error('commit_unconfirmed')
      return back(id)
    }
    if (!input.success) throw new Error('invalid')
    const patch = reviewPatch(suggestion.proposal, content, suggestion.sourceVersion, input.data)
    if (patch) {
      const terms = await ctx.payload.find({ collection: 'taxonomy', where: { id: { in: patch.acceptedTags } }, pagination: false, req, overrideAccess: false })
      if (terms.docs.length !== patch.acceptedTags.length) throw new Error('taxonomy_changed')
      if (!taxonomyUnchanged(proposalEnvelope.parse(suggestion.proposal), terms.docs, patch.acceptedTags)) throw new Error('taxonomy_changed')
      // Explicit staff-only approval boundary; never accept policy/state from form input.
      await ctx.payload.update({ collection: 'content', id: contentId, data: patch, req, overrideAccess: true, context: { reviewedEvidence: true } })
    }
    await ctx.payload.update({ collection: 'suggestions', id: Number(id), req, overrideAccess: true,
      data: { decision: input.data.decision, reviewNote: input.data.note, reviewedBy: ctx.user.id, reviewedAt: new Date().toISOString(), reviewAttempt } })
    await ctx.payload.db.commitTransaction(tx)
    const persisted = await ctx.payload.findByID({ collection: 'suggestions', id: Number(id), user: ctx.user, overrideAccess: false, depth: 0 })
    if (persisted.reviewAttempt !== reviewAttempt) throw new Error('commit_unconfirmed')
    return back(id)
  } catch {
    await ctx.payload.db.rollbackTransaction(tx)
    return back(id, 'conflict')
  }
}
