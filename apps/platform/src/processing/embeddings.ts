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

type Db = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> }

/**
 * Worker step: embed reviewed citation passages of Draft/Published items that have no embedding for the current
 * evidence version, and prune embeddings for superseded evidence. Bounded per call; safe to run repeatedly.
 */
export async function syncEmbeddings(db: Db, embed: Embed, batch = 48) {
  const model = embeddingModel()
  const pruned = await db.query(`DELETE FROM passage_embeddings e USING content c WHERE e.content_id=c.id
    AND (e.evidence_version <> c.evidence_version OR c.state NOT IN ('draft','published'))`)
  const { rows } = await db.query(`SELECT c.id AS content_id, c.title, p.citation_id, p.version, p.locator, p.text
    FROM content c JOIN content_passages p ON p._parent_id=c.id AND p.version=c.evidence_version
    WHERE c.state IN ('draft','published') AND NOT EXISTS (SELECT 1 FROM passage_embeddings e
      WHERE e.content_id=c.id AND e.citation_id=p.citation_id AND e.model=$1)
    ORDER BY c.state='published' DESC, c.id, p._order LIMIT $2`, [model, batch])
  let embedded = 0
  for (let i = 0; i < rows.length; i += 4) {
    await Promise.all(rows.slice(i, i + 4).map(async row => {
      // Title and location give short passages their context.
      const vector = await embed(`${row.title}\n${row.locator}\n${row.text}`)
      await db.query(`INSERT INTO passage_embeddings (content_id, citation_id, evidence_version, model, embedding)
        SELECT $1::integer, $2::varchar, $3::varchar, $4::varchar, $5::vector WHERE EXISTS (SELECT 1 FROM content WHERE id=$1::integer AND evidence_version=$3::varchar)
        ON CONFLICT (content_id, citation_id, model) DO NOTHING`, [row.content_id, row.citation_id, row.version, model, vectorLiteral(vector)])
      embedded++
    }))
  }
  return { embedded, pruned: pruned.rowCount ?? 0 }
}
