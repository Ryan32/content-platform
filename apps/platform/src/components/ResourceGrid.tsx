import Link from 'next/link'
import type { Material } from '../domain/library'
import { FormatChip, formatDate } from './Format'
import { Thumbnail } from './Thumbnail'

/** Resource cards with thumbnails. How-to articles carry a badge so readers can tell instructions from source material. */
export function ResourceGrid({ items }: { items: Material[] }) {
  return <div className="card-grid">
    {items.map(item => <Link key={item.id} className="resource-card" href={`/resources/${item.id}`}>
      <Thumbnail id={item.id} version={item.thumbnailVersion} format={item.format} title={item.title} rounded={0} />
      <div className="resource-card-body">
        <span className="chip-line">{item.kind === 'howto' ? <span className="chip chip-howto">How-to</span> : <FormatChip format={item.format} />}</span>
        <h3>{item.title}</h3>
        {item.description && <p>{item.description}</p>}
        <span className="subtle small-text">Updated {formatDate(item.updatedAt)}</span>
      </div>
    </Link>)}
  </div>
}
