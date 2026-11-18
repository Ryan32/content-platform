import { logout } from '../../../auth/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = (request: Request) => logout(request)
