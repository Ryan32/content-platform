'use client'
import { Thumbnail } from './Thumbnail'

/** Admin list cell for Library items: the item's thumbnail or format placeholder. */
export default function ThumbnailCell({ cellData, rowData }: { cellData?: string | null; rowData?: { id?: number; format?: string; title?: string } }) {
  if (!rowData?.id) return null
  return <div style={{ width: 88 }}><Thumbnail id={rowData.id} version={cellData} format={rowData.format ?? 'document'} title={rowData.title ?? ''} rounded={6} compact /></div>
}
