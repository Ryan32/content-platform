import { principalFromUser, staff } from '../domain/access'

// Admin navigation visibility only. Server-side access rules still enforce every read and write.
export const isAdminUser = (user: unknown) => staff(principalFromUser(user), 'admin')
export const isStaffUser = (user: unknown) => staff(principalFromUser(user), 'editor')
