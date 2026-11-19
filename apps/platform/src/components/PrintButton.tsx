'use client'
import Icon from './Icon'
export default function PrintButton() {
  return <button type="button" className="btn-ghost small" onClick={() => window.print()}><Icon name="printer" size={14} />Print</button>
}
