/**
 * Which originals the reader can show inline, and with which viewer. SVG and HTML are deliberately excluded (they can
 * carry script). Office files and spreadsheets need a converted preview (Gotenberg → PDF) before they can be shown.
 */
export type Viewer = 'pdf' | 'image' | 'audio' | 'video'
const INLINE: Record<string, Viewer> = {
  'application/pdf': 'pdf',
  'image/png': 'image', 'image/jpeg': 'image', 'image/gif': 'image', 'image/webp': 'image',
  'audio/mpeg': 'audio', 'audio/mp4': 'audio', 'audio/x-m4a': 'audio', 'audio/wav': 'audio', 'audio/ogg': 'audio',
  'video/mp4': 'video', 'video/webm': 'video',
}
export const viewerFor = (mimeType: string): Viewer | null => INLINE[mimeType.toLowerCase()] ?? null
export const isInlineType = (mimeType: string) => viewerFor(mimeType) !== null

/** Page number from a citation locator such as "page 3" or "p. 3–4". */
export function locatorPage(locator: string | undefined): number | null {
  const match = locator && /\bp(?:age|\.)?\s*(\d{1,5})/i.exec(locator)
  return match ? Number(match[1]) : null
}
/** Start time in seconds from a locator such as "00:12:30.000 – …", "750.2s – 755.0s" or "t=750". */
export function locatorSeconds(locator: string | undefined): number | null {
  if (!locator) return null
  const t = /\bt=(\d{1,6})\b/.exec(locator)
  if (t) return Number(t[1])
  const seconds = /^(\d{1,6})(?:\.\d+)?s\b/.exec(locator.trim())
  if (seconds) return Number(seconds[1])
  const clock = /\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/.exec(locator)
  return clock ? Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) : null
}
