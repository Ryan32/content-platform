import Link from 'next/link'
import { matchHref, type Material } from '../domain/library'
import { FormatChip, formatDate } from './Format'
import { Thumbnail } from './Thumbnail'
import { SaveButton } from './ReaderActions'
import { PROGRAMS, labelOf, sectionById } from '../domain/navigation'

/** Search result row (design: Search): thumbnail, title, summary, type/section chips, meta, save. */
export function ResultRow({ item, saved }: { item: Material; saved: boolean }) {
  const section = item.section ? sectionById(item.section) : undefined
  return <article className="result-row">
    <span className="result-thumb"><Thumbnail id={item.id} version={item.thumbnailVersion} format={item.format} title={item.title} rounded={8} compact /></span>
    <div className="result-body">
      <h3><Link className="stretch" href={matchHref(item)}>{item.title}</Link></h3>
      {item.description && <p>{item.description}</p>}
      {item.match?.locator && <p className="small-text subtle result-match">Found in {item.match.locator}</p>}
      <div className="chip-line">
        {item.kind === 'howto' ? <span className="chip chip-howto">How-to</span> : <FormatChip format={item.format} />}
        {section && <span className={`chip chip-section section-${section.id}`}>{section.label}</span>}
        {item.audience === 'client' && <span className="chip chip-client">Client-ready</span>}
        <span className="small-text subtle">{[item.program && labelOf(PROGRAMS, item.program), `Updated ${formatDate(item.updatedAt)}`].filter(Boolean).join(' · ')}</span>
      </div>
    </div>
    <SaveButton id={item.id} initial={saved} compact title={item.title} />
  </article>
}
