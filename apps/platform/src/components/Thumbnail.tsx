// Shared preview tile for the reader and admin: the real thumbnail when one exists, otherwise a designed placeholder by format.
// Inline styles so it renders identically inside Payload's admin and the reader site.
const ART: Record<string, { from: string; to: string; ink: string; label: string; glyph: string }> = {
  pdf: { from: '#fde7e7', to: '#f7c9cc', ink: '#a8323a', label: 'PDF', glyph: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5' },
  video: { from: '#ece6ff', to: '#d5c8ff', ink: '#5b3cc4', label: 'Video', glyph: 'M5 4l14 8-14 8z' },
  audio: { from: '#fdf0d2', to: '#f9dc9a', ink: '#8a5a00', label: 'Audio', glyph: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' },
  slides: { from: '#ffe9da', to: '#ffcfae', ink: '#a24b12', label: 'Slides', glyph: 'M3 4h18v12H3zM12 16v4M8 20h8' },
  document: { from: '#e3eaff', to: '#c8d5ff', ink: '#3149b5', label: 'Document', glyph: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8M8 9h2' },
  article: { from: '#ddf4ef', to: '#b8e8dc', ink: '#116d5b', label: 'Article', glyph: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5' },
}

export function Thumbnail({ id, version, format, title, ratio = '16 / 9', rounded = 10, compact = false }: {
  id: number | string; version?: string | null; format: string; title: string; ratio?: string; rounded?: number; compact?: boolean
}) {
  const frame: React.CSSProperties = { position: 'relative', width: '100%', aspectRatio: ratio, borderRadius: rounded, overflow: 'hidden', flex: 'none' }
  if (version) return <div style={frame}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/thumbnails/${id}?v=${encodeURIComponent(version)}`} alt="" loading="lazy" decoding="async"
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#eef0f3' }} />
    {format === 'video' && <span aria-hidden style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
      <span style={{ width: compact ? 22 : 44, height: compact ? 22 : 44, borderRadius: '50%', background: 'rgba(17,24,39,.6)', display: 'grid', placeItems: 'center' }}>
        <svg width={compact ? 10 : 18} height={compact ? 10 : 18} viewBox="0 0 24 24" fill="#fff"><path d="M7 4l13 8-13 8z" /></svg></span></span>}
  </div>
  const art = ART[format] ?? ART.document
  return <div role="img" aria-label={`${art.label}: ${title}`} style={{ ...frame, background: `linear-gradient(135deg, ${art.from}, ${art.to})`, color: art.ink,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: compact ? 0 : 8 }}>
    <svg width={compact ? 16 : 34} height={compact ? 16 : 34} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={art.glyph} /></svg>
    {!compact && <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', opacity: .85 }}>{art.label}</span>}
  </div>
}
