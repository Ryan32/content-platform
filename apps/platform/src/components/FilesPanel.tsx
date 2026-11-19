import Icon from './Icon'
import type { MaterialFile } from '../domain/library'

const TYPE: Record<string, string> = { 'application/pdf': 'PDF', 'application/zip': 'Zip', 'text/plain': 'Text', 'text/vtt': 'Captions', 'image/svg+xml': 'SVG' }
const typeOf = (mime: string) => TYPE[mime] ?? (mime.includes('word') || mime === 'application/msword' ? 'Word' : mime.includes('presentation') || mime.includes('powerpoint') ? 'PowerPoint'
  : mime.includes('sheet') || mime.includes('excel') ? 'Excel' : mime.startsWith('audio/') ? 'Audio' : mime.startsWith('video/') ? 'Video' : mime.startsWith('image/') ? 'Image' : 'File')
const size = (bytes?: number) => !bytes ? '' : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

/**
 * The page's files, one section each (owner decision: one page per WordPress package; files never get their own page).
 * Each section has a stable anchor (#file-<id>) that search results link to. Names and descriptions show with view access;
 * Download and Preview appear only with download access.
 */
export function FilesPanel({ files, downloadable, previewing, highlighted, path }: {
  files: MaterialFile[]; downloadable: number[]; previewing?: number; highlighted?: number; path: string
}) {
  if (!files.length) return null
  return <section className="panel"><h2>{files.length === 1 ? 'File' : `Files (${files.length})`}</h2>
    <ul className="files files-detailed">{files.map(f => {
      const canDownload = downloadable.includes(f.id)
      return <li key={f.id} id={`file-${f.id}`} className={f.id === highlighted ? 'is-match' : undefined}>
        <span className="file-icon"><Icon name="file" /></span>
        <span className="file-body">
          <span className="file-name">{f.name}</span>
          <span className="small-text subtle">{[typeOf(f.mimeType), size(f.bytes)].filter(Boolean).join(' · ')}{f.id === highlighted ? ' · matches your search' : ''}</span>
          {f.description && <span className="file-description">{f.description}</span>}
          {canDownload && <span className="file-actions">
            {f.mimeType === 'application/pdf' && f.id !== previewing && <a className="btn-ghost small" href={`${path}?file=${f.id}#file-${f.id}`}><Icon name="page" size={14} />Preview</a>}
            <a className="btn-ghost small" href={`/files/${f.id}?download=1`}><Icon name="download" size={14} />Download</a></span>}
        </span></li>
    })}</ul>
    {!downloadable.length && <p className="small-text subtle side-note">Downloads aren&apos;t included with your access to this resource.</p>}
  </section>
}
