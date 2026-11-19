import type { Block, Inline } from '../domain/markdown'
import CopyLink from './CopyLink'
import Icon from './Icon'

function Text({ parts }: { parts: Inline[] }) {
  return <>{parts.map((p, i) => p.t === 'strong' ? <strong key={i}>{p.v}</strong> : p.t === 'em' ? <em key={i}>{p.v}</em>
    : p.t === 'code' ? <code key={i}>{p.v}</code> : p.t === 'link' ? <a key={i} href={p.href} {...(/^https?:/.test(p.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{p.v}</a>
    : <span key={i}>{p.v}</span>)}</>
}

/** How-to article body: headings get anchors and a copy-link button; screenshots open full size. */
export function Article({ blocks, path }: { blocks: Block[]; path: string }) {
  return <article className="wiki">
    {blocks.map((b, i) => {
      if (b.type === 'heading') {
        const H = b.level === 2 ? 'h2' : 'h3'
        return <H key={i} id={b.id} className="wiki-heading">{b.text}<CopyLink path={`${path}#${b.id}`} label={`Copy link to “${b.text}”`} compact /></H>
      }
      if (b.type === 'image') return <figure key={i} className="wiki-shot"><a href={b.src} target="_blank" rel="noopener">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={b.src} alt={b.alt} loading="lazy" /></a>{b.alt && <figcaption>{b.alt}</figcaption>}</figure>
      if (b.type === 'callout') return <aside key={i} className="wiki-callout"><Icon name="info" size={16} /><p><Text parts={b.content} /></p></aside>
      if (b.type === 'list') { const L = b.ordered ? 'ol' : 'ul'; return <L key={i} className={b.ordered ? 'wiki-steps' : undefined}>{b.items.map((item, j) => <li key={j}><Text parts={item} /></li>)}</L> }
      return <p key={i}><Text parts={b.content} /></p>
    })}
  </article>
}

/** "On this page" list for the article's headings. */
export function OnThisPage({ blocks }: { blocks: Block[] }) {
  const headings = blocks.filter((b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading')
  if (headings.length < 2) return null
  return <nav className="panel toc" aria-label="On this page"><h2>On this page</h2>
    <ol>{headings.map(h => <li key={h.id} className={h.level === 3 ? 'toc-sub' : undefined}><a href={`#${h.id}`}>{h.text}</a></li>)}</ol></nav>
}
