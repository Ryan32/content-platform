import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
// Review now lives inside the admin.
export default async function Review({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(/^\d+$/.test(id) ? `/admin/review/${id}` : '/admin/review')
}
