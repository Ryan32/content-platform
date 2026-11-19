import { inTransaction, optionalSqlPool, TransactionUnavailable } from '../../../../../db/payload-db'
import { editorContext } from '../../../../../server/editor'
import { reviewInput, reviewPatch, proposalEnvelope, taxonomyUnchanged } from '../../../../../processing/review'
import { randomUUID } from 'node:crypto'
import { readAnalysisForm } from '../../../../../processing/analysis-review'
import { actorOf, emit } from '../../../../../processing/analytics'
import { ANALYSIS_VERSION } from '../../../../../processing/analysis'
import { applyAnalysisDecision } from '../../../../../server/analysis-decision'
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
  const reviewAttempt = randomUUID()
  let recordLabels: (() => Promise<unknown>) | undefined
  // The decision is committed only if a fresh read sees this attempt's marker (see inTransaction).
  const confirm = async () => (await ctx.payload.findByID({ collection: 'suggestions', id: Number(id), user: ctx.user, overrideAccess: false, depth: 0 })).reviewAttempt === reviewAttempt
  try {
    await inTransaction(ctx.payload, async req => {
      const suggestion = await ctx.payload.findByID({ collection: 'suggestions', id: Number(id), req, overrideAccess: false, depth: 0 })
      if (suggestion.decision !== 'pending') throw new Error('already_reviewed')
      const contentId = typeof suggestion.content === 'number' ? suggestion.content : suggestion.content.id
      const content = await ctx.payload.findByID({ collection: 'content', id: contentId, req, overrideAccess: false, depth: 0 })
      if (combined) {
        if (!v2.success || (suggestion.proposal as { analysisVersion?: string })?.analysisVersion !== ANALYSIS_VERSION) throw new Error('format_mismatch')
        const applied = await applyAnalysisDecision(ctx.payload, req, Number(id), v2.data, { asUser: ctx.user, reviewAttempt })
        // Human decisions as ML labels, recorded after the confirmed commit; never blocks the reviewer.
        const pool = optionalSqlPool(ctx.payload)
        if (pool) recordLabels = () => emit(pool, { stream: 'events', event: 'review.decision', contentId: applied.contentId, actor: actorOf(ctx.user),
          data: { suggestion_id: Number(id), model: applied.model, ...applied.labels } }).catch(() => undefined)
        return
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
    }, { user: ctx.user, isolation: 'serializable', confirm })
  } catch (error) {
    if (error instanceof TransactionUnavailable) return new Response('Review unavailable', { status: 503 })
    return back(id, 'conflict')
  }
  await recordLabels?.()
  return back(id)
}
