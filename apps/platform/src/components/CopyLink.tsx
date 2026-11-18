'use client'
import { useState } from 'react'
import Icon from './Icon'

/** Copies an absolute link to this page (or a heading) and confirms with a short toast. */
export default function CopyLink({ path, label = 'Copy link', compact = false }: { path: string; label?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    const url = new URL(path, window.location.origin).toString()
    try { await navigator.clipboard.writeText(url) } catch {
      const field = document.createElement('textarea'); field.value = url; document.body.appendChild(field); field.select()
      document.execCommand('copy'); field.remove()
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }
  return <button type="button" className={compact ? 'copy-anchor' : 'btn-ghost small'} onClick={copy} aria-label={label} title={label}>
    <Icon name={copied ? 'check' : 'link'} size={14} />{!compact && (copied ? 'Copied' : 'Copy link')}
    <span className="sr-only" role="status">{copied ? 'Link copied' : ''}</span>
  </button>
}
