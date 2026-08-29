import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { generatePresignedUploadUrl } from '@/lib/s3'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await auth()
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const fileName = String(body?.fileName ?? '').trim()
  const contentType = String(body?.contentType ?? 'application/octet-stream')
  if (!fileName) return NextResponse.json({ error: 'fileName required' }, { status: 400 })
  if (!contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'Only image files are allowed.' }, { status: 400 })
  }

  // QR codes are shareable user content → public
  const { uploadUrl, cloud_storage_path } = await generatePresignedUploadUrl(fileName, contentType, true)
  return NextResponse.json({ uploadUrl, cloud_storage_path })
}
