import { createLocalReq } from 'payload'
import { editorContext } from '../../../../../server/editor'
import { reviewInput, reviewPatch, proposalEnvelope, taxonomyUnchanged } from '../../../../../processing/review'
import { randomUUID } from 'node:crypto'
const back = (id: string, error?: string) => new Response(null, { status: 303, headers: { Location: `/admin/review/${id}${error ? `?error=${error}` : ''}`, 'Cache-Control': 'no-store' } })
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const input = reviewInput.safeParse({ decision: form.get('decision'), summary: form.get('summary'), tags: form.getAll('tags').map(Number), note: form.get('note'), expectedUpdatedAt: form.get('expectedUpdatedAt') })
  if (!input.success) return back(id, 'invalid')
  const tx = await ctx.payload.db.beginTransaction({ isolationLevel: 'serializable' })
  const reviewAttempt = randomUUID()
  if (tx === null || tx === undefined) return new Response('Review unavailable', { status: 503 })
  try {
    const req = await createLocalReq({ user: ctx.user }, ctx.payload); req.transactionID = tx
    const suggestion = await ctx.payload.findByID({ collection: 'suggestions', id: Number(id), req, overrideAccess: false, depth: 0 })
    if (suggestion.decision !== 'pending') throw new Error('already_reviewed')
    const contentId = typeof suggestion.content === 'number' ? suggestion.content : suggestion.content.id
    const content = await ctx.payload.findByID({ collection: 'content', id: contentId, req, overrideAccess: false, depth: 0 })
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
