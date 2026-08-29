import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createS3Client, getBucketConfig } from './aws-config'

function shouldServeInline(contentType: string): boolean {
  // image/svg+xml excluded — SVGs can execute embedded scripts (XSS risk)
  return (
    (contentType.startsWith('image/') && contentType !== 'image/svg+xml') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('audio/')
  )
}

export async function generatePresignedUploadUrl(
  fileName: string,
  contentType: string,
  isPublic = false
): Promise<{ uploadUrl: string; cloud_storage_path: string }> {
  const { bucketName, folderPrefix } = getBucketConfig()
  const s3 = createS3Client()
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const cloud_storage_path = isPublic
    ? `${folderPrefix}public/uploads/${Date.now()}-${safeName}`
    : `${folderPrefix}uploads/${Date.now()}-${safeName}`
  const cmd = new PutObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    ContentType: contentType,
  })
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 })
  return { uploadUrl, cloud_storage_path }
}

export async function getFileUrl(
  cloud_storage_path: string,
  contentType: string,
  isPublic: boolean
): Promise<string> {
  const { bucketName } = getBucketConfig()
  if (isPublic) {
    const region = process.env.AWS_REGION ?? 'us-east-1'
    const encoded = cloud_storage_path.split('/').map(encodeURIComponent).join('/')
    return `https://${bucketName}.s3.${region}.amazonaws.com/${encoded}`
  }
  const s3 = createS3Client()
  const cmd = new GetObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    ResponseContentDisposition: shouldServeInline(contentType) ? 'inline' : 'attachment',
  })
  return getSignedUrl(s3, cmd, { expiresIn: 3600 })
}

export async function deleteFile(cloud_storage_path: string): Promise<void> {
  const { bucketName } = getBucketConfig()
  const s3 = createS3Client()
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: cloud_storage_path }))
}
