import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
// Review now lives inside the admin.
export default function Reviews() { redirect('/admin/review') }
