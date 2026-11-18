export const FORMATS = ['article', 'pdf', 'video', 'audio', 'slides', 'document'] as const
const LABELS: Record<string, [singular: string, plural: string]> = {
  article: ['Article', 'Articles'], pdf: ['PDF', 'PDFs'], video: ['Video', 'Videos'], audio: ['Audio', 'Audio'],
  slides: ['Slides', 'Slides'], document: ['Document', 'Documents'],
}
export const formatLabel = (format: string) => LABELS[format]?.[0] ?? format
export const formatPlural = (format: string) => LABELS[format]?.[1] ?? format

/** Colored format chip, like Portal's line-of-business chips. */
export function FormatChip({ format }: { format: string }) {
  return <span className={`chip chip-${format}`}>{formatLabel(format)}</span>
}

export function formatDate(value?: string) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
}
