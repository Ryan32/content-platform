import { getPayload } from 'payload'
import config from '../payload.config'
import { principalFromUser, staff } from '../domain/access'

export async function editorContext(headers: Headers) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers })
  return user && staff(principalFromUser(user), 'editor') ? { payload, user } : null
}
