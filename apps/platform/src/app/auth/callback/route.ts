import { getPayload } from 'payload'
import config from '../../../payload.config'
import { completeLogin } from '../../../auth/browser'
import { syncSignedInUser } from '../../../server/identity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = (request: Request) => completeLogin(request, async profile => {
  const outcome = await syncSignedInUser(await getPayload({ config }), profile)
  if (outcome !== 'updated') console.info(`Browser sign-in profile: ${outcome}`)
})
