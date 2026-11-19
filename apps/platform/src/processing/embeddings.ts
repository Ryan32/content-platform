import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { z } from 'zod'
import { ProcessingError } from './jobs'

/**
 * Semantic search embeddings (Amazon Titan Text Embeddings V2 on Bedrock, 1024 dimensions, normalized).
 * On only when SEMANTIC_SEARCH=true; the model can be overridden with EMBEDDING_MODEL_ID (it must stay 1024-d to match
 * the passage_embeddings column). Embeddings are search plumbing: they never decide who can see anything.
 */
export const DEFAULT_EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0'
export const EMBEDDING_DIMENSIONS = 1024
export const embeddingModel = () => process.env.EMBEDDING_MODEL_ID?.trim() || DEFAULT_EMBEDDING_MODEL
export const semanticSearchEnabled = () => process.env.SEMANTIC_SEARCH === 'true'

const response = z.object({ embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS) })
export type Embed = (text: string, signal?: AbortSignal) => Promise<number[]>

export function bedrockEmbedder(client = new BedrockRuntimeClient({})): Embed {
  return async (text, signal) => {
    const input = text.replace(/\s+/g, ' ').trim().slice(0, 30000)
    if (!input) throw new ProcessingError('no_extractable_text')
    const result = await client.send(new InvokeModelCommand({ modelId: embeddingModel(), contentType: 'application/json', accept: 'application/json',
      body: JSON.stringify({ inputText: input, dimensions: EMBEDDING_DIMENSIONS, normalize: true }) }), { abortSignal: signal })
    const parsed = response.safeParse(JSON.parse(new TextDecoder().decode(result.body)))
    if (!parsed.success) throw new ProcessingError('invalid_model_response')
    return parsed.data.embedding
  }
}
/** pgvector literal; values are numbers from a validated response, never user text. */
export const vectorLiteral = (v: number[]) => {
  if (v.length !== EMBEDDING_DIMENSIONS || v.some(x => !Number.isFinite(x))) throw new ProcessingError('invalid_embedding')
  return `[${v.join(',')}]`
}
