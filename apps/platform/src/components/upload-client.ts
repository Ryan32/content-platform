'use client'
import { MAX_BYTES, MIME_TYPES, SIZE_HINT, extensionOf } from '../processing/formats'
/**
 * One upload path for every screen. Files up to 50 MB post to the app as before. Larger audio/video (up to 2 GB) and
 * PDFs (up to 500 MB) go straight from the browser to private S3 storage with a short-lived signed URL; the background
 * worker then fingerprints the file and attaches it, and processing starts automatically.
 */
export const DIRECT_LIMIT = 50 * 1024 * 1024
export const UPLOAD_HINT = SIZE_HINT
export { ACCEPT_ATTRIBUTE, SUPPORTED_LABEL } from '../processing/formats'
/** Problem with a file before upload, or null. */
export function fileProblem(file: File) {
  const ext = extensionOf(file.name)
  if (!MIME_TYPES[ext]) return 'Unsupported file type.'
  if (!file.size) return 'Empty file.'
  const limit = MAX_BYTES[ext]
  return file.size > limit ? `Larger than ${limit >= 1024 ** 3 ? `${limit / 1024 ** 3} GB` : `${limit / 1024 ** 2} MB`}.` : null
}

export class UploadFailure extends Error { constructor(message: string, public contentId?: number) { super(message) } }

export async function sendFile(file: File, options: { contentId?: number; title?: string; onProgress?: (fraction: number) => void } = {}):
  Promise<{ contentId: number; large: boolean }> {
  const { contentId, title, onProgress } = options
  if (file.size > DIRECT_LIMIT) {
    const problem = fileProblem(file)
    if (problem) throw new UploadFailure(problem)
    const response = await fetch('/library-api/uploads', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, size: file.size, ...(contentId ? { contentId } : {}), ...(title ? { title } : {}) }) })
    const signed = await response.json().catch(() => ({}))
    if (!response.ok) throw new UploadFailure(signed.error ?? 'The upload could not be started.', signed.contentId)
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', signed.url)
      for (const [name, value] of Object.entries(signed.headers as Record<string, string>)) xhr.setRequestHeader(name, value)
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded / event.total) }
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadFailure('The upload was not accepted by storage. Try again.', signed.contentId))
      xhr.onerror = () => reject(new UploadFailure('The upload was interrupted. Check your connection and try again.', signed.contentId))
      xhr.send(file)
    })
    return { contentId: signed.contentId, large: true }
  }
  const body = new FormData(); body.append('file', file)
  if (!contentId) body.append('title', title ?? '')
  const response = await fetch(contentId ? `/library-api/content/${contentId}/files` : '/library-api/bulk', { method: 'POST', body, credentials: 'same-origin' })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new UploadFailure(result.error ?? 'Upload failed.', result.contentId)
  return { contentId: contentId ?? result.contentId, large: false }
}
