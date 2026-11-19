import Link from 'next/link'
import type { Material } from '../domain/library'
import { FormatChip, formatDate } from './Format'
import { Thumbnail } from './Thumbnail'
import { SaveButton } from './ReaderActions'
import { PROGRAMS, TOPIC_OPTIONS, labelOf } from '../domain/navigation'

const topicLabel = (value: string) => TOPIC_OPTIONS.find(o => o.value === value)?.label.split(' — ')[1] ?? ''

/** Resource cards with thumbnails (design: Hub). How-to articles carry a badge so readers can tell instructions from source material. */
export function ResourceGrid({ items, saved = [] }: { items: Material[]; saved?: number[] }) {
  return <div className="card-grid">
    {items.map(item => <article key={item.id} className="resource-card">
      <Thumbnail id={item.id} version={item.thumbnailVersion} format={item.format} title={item.title} rounded={0} />
      <div className="resource-card-body">
        <span className="chip-line">{item.kind === 'howto' ? <span className="chip chip-howto">How-to</span> : <FormatChip format={item.format} />}
          {item.topics?.[0] && <span className="chip chip-topic">{topicLabel(item.topics[0])}</span>}
          {item.audience === 'client' && <span className="chip chip-client">Client-ready</span>}</span>
        <h3><Link className="stretch" href={`/resources/${item.id}`}>{item.title}</Link></h3>
        {item.description && <p>{item.description}</p>}
        <span className="card-foot"><span className="subtle small-text">{[item.program && labelOf(PROGRAMS, item.program), formatDate(item.updatedAt)].filter(Boolean).join(' · ')}</span>
          <SaveButton id={item.id} initial={saved.includes(Number(item.id))} compact title={item.title} /></span>
      </div>
    </article>)}
  </div>
}

/** Compact list view of the same items. */
export function ResourceList({ items, saved = [] }: { items: Material[]; saved?: number[] }) {
  return <div className="result-list">{items.map(item => <ResultRowLite key={item.id} item={item} saved={saved.includes(Number(item.id))} />)}</div>
}
function ResultRowLite({ item, saved }: { item: Material; saved: boolean }) {
  return <article className="result-row">
    <span className="result-thumb"><Thumbnail id={item.id} version={item.thumbnailVersion} format={item.format} title={item.title} rounded={8} compact /></span>
    <div className="result-body"><h3><Link className="stretch" href={`/resources/${item.id}`}>{item.title}</Link></h3>
      {item.description && <p>{item.description}</p>}
      <div className="chip-line">{item.kind === 'howto' ? <span className="chip chip-howto">How-to</span> : <FormatChip format={item.format} />}<span className="small-text subtle">Updated {formatDate(item.updatedAt)}</span></div></div>
    <SaveButton id={item.id} initial={saved} compact title={item.title} />
  </article>
}
