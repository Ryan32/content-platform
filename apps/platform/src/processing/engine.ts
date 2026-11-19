import type { Job } from './jobs'
import { inputSchema, ProcessingError } from './jobs'
import { extractionSchema, proposalEnvelope } from './review'
import { createHash } from 'node:crypto'
import { validateProposal } from './schema'
import { analysisEnvelope } from './analysis'

export interface Queue {
  claim(): Promise<Job | null>; heartbeat(job: Job): Promise<void>;
  finish(job: Job, result: unknown, proposal?: { model: string; data: unknown }): Promise<void>;
  defer(job: Job): Promise<void>; fail(job: Job, error: unknown): Promise<void>
}
export interface Processors {
  extract(job: Job): Promise<unknown | null>
  classify(job: Job): Promise<{ extraction: unknown; proposal: unknown }>
  /** Combined analysis of every source of an item (ae-analysis/2); returns the validated suggestion envelope. */
  analyze?(job: Job): Promise<unknown>
}
/** One bounded unit of work. Polling a provider releases the lease, not a long-running sleep. */
export async function workOnce(queue: Queue, processors: Processors) {
  const job = await queue.claim()
  if (!job) return { status: 'idle' }
  let leaseLost = false
  const heartbeat = setInterval(() => { void queue.heartbeat(job).catch(() => { leaseLost = true }) }, 30000)
  try {
    job.input = inputSchema.parse(job.input)
    if (job.input.kind === 'analyze') {
      if (!processors.analyze) throw new ProcessingError('wrong_job_stage')
      const data = analysisEnvelope.parse(await processors.analyze(job))
      if (leaseLost) throw new ProcessingError('lease_lost')
      await queue.finish(job, { proposalReady: true }, { model: job.input.modelId, data })
    } else if (job.input.kind === 'classify') {
      const result = await processors.classify(job)
      const data = proposalEnvelope.parse({ ...result, analysisVersion: 'ae-analysis/1', ...(job.input.videoId ? { sourceVimeoId: job.input.videoId } : {}), taxonomy: job.input.taxonomy, taxonomyIds: job.input.taxonomy.map(t => t.id),
        taxonomyVersion: createHash('sha256').update(JSON.stringify(job.input.taxonomy)).digest('hex') })
      validateProposal(data.proposal, data.extraction, data.taxonomyIds)
      if (leaseLost) throw new ProcessingError('lease_lost')
      await queue.finish(job, { proposalReady: true }, { model: job.input.modelId, data })
    } else {
      const result = await processors.extract(job)
      if (leaseLost) throw new ProcessingError('lease_lost')
      if (result === null) { await queue.defer(job); return { status: 'waiting', jobId: job.id } }
      await queue.finish(job, extractionSchema.parse(result))
    }
    return { status: 'succeeded', jobId: job.id }
  } catch (error) {
    await queue.fail(job, error)
    return { status: 'failed', jobId: job.id }
  } finally { clearInterval(heartbeat) }
}
