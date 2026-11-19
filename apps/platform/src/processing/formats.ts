/**
 * The one list of file types the library accepts and processes, with size limits. Used by uploads (direct and
 * large), the WordPress import, the job queue and the browser. Covers everything present in the WordPress backup.
 */
const MiB = 1024 * 1024
export const DIRECT_UPLOAD_BYTES = 50 * MiB

/** Text-bearing documents read on our own server (OCR via Textract for scanned PDFs). */
export const DOCUMENT_FORMATS = ['pdf', 'docx', 'pptx', 'xlsx', 'xlsm', 'vtt', 'txt', 'doc', 'xls', 'ppt', 'zip'] as const
/** Audio/video for Amazon Transcribe. */
export const MEDIA_FORMATS = ['mp3', 'mp4', 'wav', 'flac', 'm4a', 'ogg', 'webm'] as const
/** Images: SVG text is read directly; raster images are described and transcribed by the AI model. */
export const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'] as const
export type DocumentFormat = typeof DOCUMENT_FORMATS[number]
export type ImageFormat = typeof IMAGE_FORMATS[number]

export const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12', doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  zip: 'application/zip', vtt: 'text/vtt', txt: 'text/plain',
  mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'video/webm',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
}

/** Largest accepted file per type. Office/zip over 200 MB are refused outright (owner decision, 2026-11-18). */
export const MAX_BYTES: Record<string, number> = {
  pdf: 500 * MiB, docx: 200 * MiB, pptx: 200 * MiB, xlsx: 200 * MiB, xlsm: 200 * MiB, zip: 200 * MiB,
  doc: 50 * MiB, xls: 50 * MiB, ppt: 50 * MiB, vtt: 4 * MiB, txt: 4 * MiB,
  mp3: 2048 * MiB, mp4: 2048 * MiB, wav: 2048 * MiB, flac: 2048 * MiB, m4a: 2048 * MiB, ogg: 2048 * MiB, webm: 2048 * MiB,
  jpg: 20 * MiB, jpeg: 20 * MiB, png: 20 * MiB, webp: 20 * MiB, gif: 20 * MiB, svg: 2 * MiB,
}
/** Library display format for an item created from a file. */
export const ITEM_FORMAT: Record<string, string> = {
  pdf: 'pdf', docx: 'document', doc: 'document', xlsx: 'document', xlsm: 'document', xls: 'document', txt: 'document', vtt: 'document', zip: 'document',
  pptx: 'slides', ppt: 'slides', mp3: 'audio', wav: 'audio', m4a: 'audio', flac: 'audio', ogg: 'audio', mp4: 'video', webm: 'video',
  jpg: 'document', jpeg: 'document', png: 'document', webp: 'document', gif: 'document', svg: 'document',
}
export const extensionOf = (name: string) => /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1].toLowerCase() ?? ''
export const isDocument = (ext: string): ext is DocumentFormat => (DOCUMENT_FORMATS as readonly string[]).includes(ext)
export const isMedia = (ext: string) => (MEDIA_FORMATS as readonly string[]).includes(ext)
export const isImage = (ext: string): ext is ImageFormat => (IMAGE_FORMATS as readonly string[]).includes(ext)
export const ACCEPT_ATTRIBUTE = Object.keys(MIME_TYPES).map(e => '.' + e).join(',')
export const SUPPORTED_LABEL = 'PDF, Word, PowerPoint, Excel, zip packets, captions, text, images, audio or video'
export const SIZE_HINT = 'Up to 50 MB; Office files and zips up to 200 MB; PDFs up to 500 MB; audio and video up to 2 GB.'
