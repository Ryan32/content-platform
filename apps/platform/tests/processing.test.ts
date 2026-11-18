import { describe, it, expect } from 'vitest'
import { workOnce, type Queue } from '../src/processing/engine'
import { jobKey, inputSchema, ProcessingError, type Job } from '../src/processing/jobs'
import { reviewPatch, taxonomyUnchanged } from '../src/processing/review'

const extraction = { processorVersion: 'test/1', warnings: [], passages: [{ id: 'p1', text: 'Synthetic AE retirement evidence.', locator: 'Page 1' }] }
const envelope = { analysisVersion: 'ae-analysis/1' as const, extraction, taxonomyIds: [1, 2], taxonomyVersion: 'taxonomy/1',
  taxonomy: [{ id: 1, label: 'Retirement', definition: '', dimension: 'topic' }, { id: 2, label: 'Life', definition: '', dimension: 'business-line' }],
  proposal: { summary: 'Retirement', tags: [{ termId: 1, evidenceIds: ['p1'], confidence: 0.9 }], takeaways: [], warnings: [] } }
class MemoryQueue implements Queue {
  state = 'queued'; attempts = 0; result: unknown; proposal: unknown
  job: Job = { id: 1, content_id: 7, source_version: 'v1', idempotency_key: 'k', input: { kind: 'document', assetId: 1, format: 'pdf' },
    attempts: 1, lease_token: 'lease1', deadline_at: '2099-01-01' }
  async claim() { if (this.state !== 'queued') return null; this.state = 'running'; this.attempts++; return this.job }
  async heartbeat() {}
  async finish(_job: Job, result: unknown, proposal?: unknown) { this.result = result; this.proposal = proposal; this.state = 'succeeded' }
  async defer() { this.state = 'queued'; this.attempts-- }
  async fail(_job: Job, error: unknown) { this.state = error instanceof ProcessingError && error.retryable ? 'queued' : 'failed' }
}
describe('processing recovery and editorial boundaries', () => {
  it('retries a transient failure and stores only one successful result', async () => {
    const queue = new MemoryQueue(); let calls = 0
    const processor = { extract: async () => { if (++calls === 1) throw new ProcessingError('rate_limited', true); return extraction }, classify: async () => envelope }
    expect((await workOnce(queue, processor)).status).toBe('failed')
    expect(queue.state).toBe('queued')
    expect((await workOnce(queue, processor)).status).toBe('succeeded')
    expect((await workOnce(queue, processor)).status).toBe('idle')
    expect(queue.attempts).toBe(2)
  })
  it('releases pending provider work without consuming failed attempts', async () => {
    const queue = new MemoryQueue()
    expect((await workOnce(queue, { extract: async () => null, classify: async () => envelope })).status).toBe('waiting')
    expect(queue.attempts).toBe(0)
    expect(queue.result).toBeUndefined()
  })
  it('stages proposals separately from extracted evidence', async () => {
    const queue = new MemoryQueue()
    queue.job.input = { kind: 'classify', extractionJobId: 1, modelId: 'approved-model', taxonomy: [{ id: 1, label: 'Retirement', dimension: 'topic', definition: 'Retirement education' }] }
    await workOnce(queue, { extract: async () => extraction, classify: async () => ({ extraction, proposal: envelope.proposal }) })
    expect(queue.proposal).toMatchObject({ model: 'approved-model', data: { extraction } })
    expect(queue.result).toEqual({ proposalReady: true })
  })
  it('rejects arbitrary source URLs and makes processor/input versions part of identity', () => {
    expect(() => inputSchema.parse({ kind: 'document', url: 'http://169.254.169.254' })).toThrow()
    expect(jobKey(1, 'v1', { kind: 'vimeo' })).not.toBe(jobKey(1, 'v2', { kind: 'vimeo' }))
    expect(jobKey(1, 'v1', { kind: 'vimeo' })).toBe(jobKey(1, 'v1', { kind: 'vimeo' }))
  })
  it('human review may replace descriptive values but never grant access or publish', () => {
    const patch = reviewPatch(envelope, { sourceHash: 'v1', updatedAt: 'now' }, 'v1', { decision: 'accepted', summary: 'Human edit', tags: [2], note: '', expectedUpdatedAt: 'now' })!
    expect(patch.description).toBe('Human edit'); expect(patch.acceptedTags).toEqual([2]); expect(patch.state).toBe('draft')
    expect(patch).not.toHaveProperty('accessProfile')
    expect(patch.passages[0].citationId).toContain('-p1')
  })
  it('rejects stale source, concurrent editorial changes and unapproved tags', () => {
    const input = { decision: 'accepted' as const, summary: '', tags: [1], note: '', expectedUpdatedAt: 'now' }
    expect(() => reviewPatch(envelope, { sourceHash: 'v2', updatedAt: 'now' }, 'v1', input)).toThrow('stale_review')
    expect(() => reviewPatch(envelope, { sourceHash: 'v1', updatedAt: 'later' }, 'v1', input)).toThrow('stale_review')
    expect(() => reviewPatch(envelope, { sourceHash: 'v1', updatedAt: 'now' }, 'v1', { ...input, tags: [999] })).toThrow('unapproved_taxonomy')
    expect(reviewPatch(envelope, { sourceHash: 'v1', updatedAt: 'now' }, 'v1', { ...input, decision: 'rejected' })).toBeNull()
    expect(reviewPatch(envelope, { sourceHash: 'v2', updatedAt: 'later' }, 'v1', { ...input, decision: 'rejected' })).toBeNull()
    expect(() => reviewPatch({ ...envelope, sourceVimeoId: '123' }, { sourceHash: 'v1', updatedAt: 'now', vimeoId: '456' }, 'v1', input)).toThrow('stale_video')
    expect(taxonomyUnchanged(envelope, [{ ...envelope.taxonomy[0], definition: 'Changed meaning' }], [1])).toBe(false)
  })
})
