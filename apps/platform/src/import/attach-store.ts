import { CopyObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { Payload } from 'payload'
import { assertImport } from './package'
import type { AttachDeps } from './attach'

const notFound = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404

/** Trusted operations task only (CLI). Reads imports/files/*, writes content/* objects and asset rows. */
export function payloadAttachDeps(payload: Payload, bucket: string, s3 = new S3Client({})): AttachDeps {
  const size = async (key: string) => {
    try { return (await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).ContentLength ?? -1 } catch (error) {
      if (notFound(error)) return null
      throw error
    }
  }
  return {
    async content(sourceKey) {
      const { docs } = await payload.find({ collection: 'content', where: { sourceKey: { equals: sourceKey } }, limit: 2, depth: 0, overrideAccess: true })
      assertImport(docs.length <= 1, 'duplicate_database_identity')
      return docs[0] ? { id: Number(docs[0].id), sourceHash: (docs[0] as { sourceHash?: string | null }).sourceHash ?? null } : null
    },
    async copy(file, key, bytes) {
      assertImport(/^[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(file) && /^content\/\d+\/(?:thumb-)?[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(key), 'invalid_attach_key')
      const existing = await size(key)
      if (existing !== null) { assertImport(existing === bytes, 'existing_object_size_mismatch'); return 'existing' }
      const source = `imports/files/${file}`
      assertImport((await size(source)) === bytes, 'uploaded_file_missing_or_wrong_size')
      // Content keys are immutable: never replace an object that appeared concurrently.
      await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: key, CopySource: `${bucket}/${source}`, ServerSideEncryption: 'AES256', IfNoneMatch: '*' }))
        .catch(error => { if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode !== 412) throw error })
      assertImport((await size(key)) === bytes, 'copied_object_size_mismatch')
      return 'copied'
    },
    async asset(content, sha256, version) {
      const { docs } = await payload.find({ collection: 'assets', overrideAccess: true, depth: 0, limit: 1,
        where: { and: [{ content: { equals: content } }, { sha256: { equals: sha256 } }, { version: { equals: version } }] } })
      return docs[0] ? Number(docs[0].id) : null
    },
    async cover(contentId, key, version) {
      // Same columns an editor's cover upload sets (server/thumbnails.ts); never replaces an editor's own cover.
      const pool = (payload.db as unknown as { pool: { query: (sql: string, params: unknown[]) => Promise<{ rowCount: number | null }> } }).pool
      const result = await pool.query(`UPDATE content SET thumbnail_key=$2, thumbnail_version=$3, thumbnail_source='upload', thumbnail_for='upload'
        WHERE id=$1 AND (thumbnail_source IS DISTINCT FROM 'upload' OR thumbnail_key=$2)`, [contentId, key, version])
      return Boolean(result.rowCount)
    },
    async createAsset(data) {
      return Number((await payload.create({ collection: 'assets', overrideAccess: true, depth: 0, data })).id)
    },
  }
}
