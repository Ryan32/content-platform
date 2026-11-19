/** Find-in-document for the PDF viewer: where a term occurs in pdf.js text items, and where to draw its highlight. */
export type TextItem = { str?: string; transform?: number[]; width?: number }
export type Occurrence = { page: number; item: number; start: number }
/** A highlight as fractions of the page box, so it stays in place at any zoom. */
export type Mark = { item: number; start: number; left: number; top: number; width: number; height: number }
type Viewport = { transform: number[]; width: number; height: number; scale: number }

/** Every occurrence of the term inside a single text item (case-insensitive), in reading order. */
export function occurrences(items: readonly TextItem[], term: string, page: number): Occurrence[] {
  const needle = term.trim().toLowerCase(), found: Occurrence[] = []
  if (!needle) return found
  items.forEach((item, index) => {
    const text = (item.str ?? '').toLowerCase()
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) found.push({ page, item: index, start: at })
  })
  return found
}

const multiply = (m: number[], n: number[]) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]

/**
 * Highlight boxes for each occurrence. pdf.js gives the width of a whole text run, not of each glyph, so the box inside
 * a run is placed by character position: close enough to mark the word without a full text layer.
 */
export function matchMarks(items: readonly TextItem[], term: string, viewport: Viewport): Mark[] {
  const needle = term.trim().toLowerCase()
  return occurrences(items, needle, 0).flatMap(({ item, start }) => {
    const { str = '', transform, width = 0 } = items[item]
    if (!transform || !str.length || !viewport.width || !viewport.height) return []
    const tx = multiply(viewport.transform, transform)
    const fontHeight = Math.hypot(tx[2], tx[3]), runWidth = width * viewport.scale
    const left = tx[4] + runWidth * start / str.length, w = runWidth * needle.length / str.length
    const top = tx[5] - fontHeight * 1.05, h = fontHeight * 1.3
    return [{ item, start, left: left / viewport.width, top: top / viewport.height, width: w / viewport.width, height: h / viewport.height }]
  })
}
