import { ProcessingError } from './jobs'
import { THUMBNAIL_WIDTH } from './thumbnails'

// Kept apart from thumbnails.ts so the web bundle never pulls in the native canvas addon; only the worker imports this.
/** Renders page 1 of a PDF to a JPEG about THUMBNAIL_WIDTH wide. Runs only in the worker (native canvas). */
export async function renderPdfThumbnail(bytes: Uint8Array, timeoutMs = 20000): Promise<Uint8Array> {
  if (!Buffer.from(bytes.subarray(0, 1024)).includes('%PDF-')) throw new ProcessingError('invalid_pdf')
  const [{ getDocument }, { createCanvas }, path, { createRequire }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'), import('@napi-rs/canvas'), import('node:path'), import('node:module')])
  const fonts = path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep
  const task = getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, useSystemFonts: false,
    disableFontFace: true, useWasm: false, verbosity: 0, standardFontDataUrl: fonts })
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([(async () => {
      const doc = await task.promise
      const page = await doc.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(3, THUMBNAIL_WIDTH / base.width) })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const context = canvas.getContext('2d')
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise
      return new Uint8Array(await canvas.encode('jpeg', 82))
    })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProcessingError('thumbnail_timeout')), timeoutMs) })])
  } finally { clearTimeout(timer); await task.destroy().catch(() => {}) }
}
