import { S3Client } from '@aws-sdk/client-s3'
import { createHash, randomUUID } from 'node:crypto'
import type { Payload } from 'payload'
import { MAX_DOCUMENT_BYTES, stageOriginal } from '../processing/storage'
import { explain, jobLabel, STATE_LABEL } from '../processing/messages'
import { ITEM_FORMAT, MIME_TYPES, SUPPORTED_LABEL, extensionOf } from '../processing/formats'

export const UPLOAD_TYPES: Record<string, string> = MIME_TYPES
/** Display name for an uploaded file: no path, no control characters, bounded. */
export const cleanFileName = (name?: string | null) => name ? name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]/g, '').slice(0, 200) || undefined : undefined
export class UploadError extends Error { constructor(public status: number, message: string) { super(message) } }

export const formatFor = (fileName: string) => ITEM_FORMAT[extensionOf(fileName)]
/** "2026_tax-planning playbook.pdf" → "2026 tax planning playbook" */
export const titleFromFileName = (fileName: string) =>
  fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled'

/** Creates one Intake library item for a file as the signed-in editor, then attaches the file. */
export async function createItemFromFile(payload: Payload, user: { id: unknown; collection: 'users' }, file: File, title?: string) {
  const format = formatFor(file.name)
  if (!process.env.CONTENT_BUCKET) throw new UploadError(503, 'File storage is not configured.')
  if (!format) throw new UploadError(415, `Unsupported file type. Use ${SUPPORTED_LABEL}.`)
  if (!file.size || file.size > MAX_DOCUMENT_BYTES) throw new UploadError(413, 'Files must be between 1 byte and 50 MB.')
  const item = await payload.create({ collection: 'content', overrideAccess: false, user: user as never, depth: 0, draft: false,
    data: { title: (title?.trim() || titleFromFileName(file.name)).slice(0, 200), format: format as never, evidenceVersion: 'unprocessed' } } as never) as { id: number }
  try {
    return { contentId: item.id, ...(await uploadSource(payload, item.id, file)) }
  } catch (error) {
    // The item stays in Intake without a file; report it so the editor can retry from the item's Processing panel.
    throw Object.assign(error instanceof Error ? error : new Error('upload_failed'), { contentId: item.id })
  }
}

export type ContentDoc = { id: number; state: string; sourceKey?: string | null; sourceHash?: string | null; vimeoId?: string | null; thumbnailVersion?: string | null; thumbnailSource?: string | null }

/**
 * Stores an editor's file privately and registers it on the library item. Manually created items take the file's
 * fingerprint as their source version, so a new upload replaces the previous file's evidence. Imported items keep
 * their WordPress source version. The background worker queues processing.
 */
export async function uploadSource(payload: Payload, contentId: number, file: File, client = new S3Client({})) {
  if (!process.env.CONTENT_BUCKET) throw new UploadError(503, 'File storage is not configured.')
  const content = await payload.findByID({ collection: 'content', id: contentId, depth: 0, overrideAccess: true, disableErrors: true }) as ContentDoc | null
  if (!content) throw new UploadError(404, 'Library item not found.')
  if (!['intake', 'draft'].includes(content.state)) throw new UploadError(409, 'Files can only be added while the item is in Intake or Draft. Ask an administrator to move it back to Draft.')
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!UPLOAD_TYPES[extension]) throw new UploadError(415, `Unsupported file type. Use ${SUPPORTED_LABEL}.`)
  if (!file.size || file.size > MAX_DOCUMENT_BYTES) throw new UploadError(413, 'Files must be between 1 byte and 50 MB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const object = await stageOriginal(client, process.env.CONTENT_BUCKET, contentId, bytes, extension)
  return registerSource(payload, content, object, extension, file.name, file.size)
}

/**
 * Registers a stored original (immutable `content/<id>/<sha256>.<ext>`) as the item's file. Manually created items take
 * its fingerprint as their source version; imported items keep theirs. Shared by direct and large (S3) uploads.
 */
export async function registerSource(payload: Payload, content: ContentDoc, object: { key: string; hash: string }, extension: string, fileName?: string, bytes?: number) {
  const contentId = content.id, hash = object.hash
  if (!['intake', 'draft'].includes(content.state)) throw new UploadError(409, 'Files can only be added while the item is in Intake or Draft. Ask an administrator to move it back to Draft.')
  if (!UPLOAD_TYPES[extension]) throw new UploadError(415, 'Unsupported file type.')
  const manual = !content.sourceKey || content.sourceKey.startsWith('manual:')
  let version = content.sourceHash
  if (manual && version !== hash) {
    await payload.update({ collection: 'content', id: contentId, overrideAccess: true, depth: 0,
      data: { sourceKey: content.sourceKey ?? `manual:${randomUUID()}`, sourceHash: hash } })
    version = hash
  }
  if (!version) throw new UploadError(409, 'This imported item has no source version. Re-run its import before adding files.')
  const existing = await payload.find({ collection: 'assets', overrideAccess: true, depth: 0, limit: 1,
    where: { and: [{ content: { equals: contentId } }, { sha256: { equals: hash } }, { version: { equals: version } }] } })
  const asset = existing.docs[0] ?? await payload.create({ collection: 'assets', overrideAccess: true, depth: 0,
    data: { content: contentId, objectKey: object.key, sha256: hash, mimeType: UPLOAD_TYPES[extension], version,
      fileName: cleanFileName(fileName) ?? `${hash.slice(0, 12)}.${extension}`, role: 'download', ...(bytes ? { bytes } : {}) } })
  return { assetId: asset.id, replacedSource: manual }
}

/** Editor-facing processing summary for one item's current version. */
export async function processingStatus(payload: Payload, contentId: number) {
  const content = await payload.findByID({ collection: 'content', id: contentId, depth: 0, overrideAccess: true, disableErrors: true }) as ContentDoc | null
  if (!content) return null
  const version = content.sourceHash ?? ''
  const { pendingLargeUploads } = await import('./large-upload')
  const [assets, jobs, suggestions, settings, pendingUploads] = await Promise.all([
    payload.find({ collection: 'assets', overrideAccess: true, depth: 0, limit: 50, sort: '-createdAt', where: { content: { equals: contentId } } }),
    payload.find({ collection: 'processing-jobs', overrideAccess: true, depth: 0, limit: 50, sort: '-createdAt', where: { content: { equals: contentId } } }),
    payload.find({ collection: 'suggestions', overrideAccess: true, depth: 0, limit: 20, sort: '-createdAt', where: { content: { equals: contentId } } }),
    payload.findGlobal({ slug: 'automation-settings', overrideAccess: true, depth: 0 }).catch(() => null),
    pendingLargeUploads(contentId),
  ])
  return {
    state: content.state, vimeoId: content.vimeoId ?? null, pendingUploads,
    thumbnail: { version: content.thumbnailVersion ?? null, source: content.thumbnailSource ?? null },
    automation: settings ? { paused: Boolean(settings.paused), documents: settings.documentsEnabled !== false, vimeo: settings.vimeoEnabled !== false,
      transcription: settings.transcriptionEnabled !== false, tagging: settings.taggingEnabled !== false } : null,
    files: assets.docs.map(a => ({ id: a.id, type: a.mimeType, current: a.version === version, uploadedAt: a.createdAt })),
    jobs: jobs.docs.map(j => ({ id: j.id, step: jobLabel(j.stage, j.input), state: j.state ?? 'queued', stateLabel: STATE_LABEL[j.state ?? 'queued'],
      current: j.sourceVersion === version, reason: explain(j.errorCode), updatedAt: j.updatedAt })),
    suggestions: suggestions.docs.map(s => ({ id: s.id, decision: s.decision ?? 'pending', current: s.sourceVersion === version, createdAt: s.createdAt })),
  }
}
