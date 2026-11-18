import { assetResponse } from '../../../server/assets'
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return assetResponse(request, (await params).id, new URL(request.url).searchParams.get('download') === '1')
}
