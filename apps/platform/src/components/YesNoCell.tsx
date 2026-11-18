import type { DefaultCellComponentProps } from 'payload'

/** List-view cell for on/off fields: a readable Yes/No pill instead of Payload's raw `true`/`false`. */
export default function YesNoCell({ cellData }: DefaultCellComponentProps) {
  return cellData ? <span className="ae-pill ae-pill--ok">Yes</span> : <span className="ae-pill">No</span>
}
