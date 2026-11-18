import { PHASE_PRODUCTION_BUILD } from 'next/constants'

export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
    return
  }
  if (!process.env.DATABASE_URL || (process.env.PAYLOAD_SECRET?.length ?? 0) < 32) {
    throw new Error('CMS startup requires DATABASE_URL and a PAYLOAD_SECRET of at least 32 characters.')
  }
}
