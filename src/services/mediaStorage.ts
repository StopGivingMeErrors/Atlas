import { z } from 'zod'
import { ProviderNotConfiguredError, AtlasServiceError } from './errors'
import { requireSupabaseClient } from './supabase/client'

/**
 * Media storage service boundary.
 *
 * Handles persistence of captured media to Supabase Storage.
 * Separated from capture to maintain clear boundaries:
 * - MediaCaptureService: permission, stream, frame capture, validation
 * - MediaStorageService: upload, download, delete, metadata
 */

export const uploadMediaInputSchema = z.object({
  investigationId: z.string().uuid(),
  subjectId: z.string().uuid().nullable().optional(),
  fileName: z.string().min(1),
  mimeType: z.string().regex(/^image\//),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type UploadMediaInput = z.infer<typeof uploadMediaInputSchema> & {
  file: Blob
}

export const listMediaInputSchema = z.object({
  investigationId: z.string().uuid(),
})

export type ListMediaInput = z.infer<typeof listMediaInputSchema>

export const mediaAssetSchema = z.object({
  id: z.string().uuid(),
  investigationId: z.string().uuid(),
  subjectId: z.string().uuid().nullable(),
  storagePath: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  checksum: z.string().nullable(),
  uploadedBy: z.string().uuid(),
  uploadedAt: z.string().datetime(),
})

export type MediaAsset = z.infer<typeof mediaAssetSchema>

/** Shape of a media_assets row as stored in Postgres (snake_case). */
interface MediaAssetRow {
  id: string
  organization_id: string
  investigation_id: string | null
  uploaded_by: string
  storage_path: string
  media_type: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export type MediaStorageErrorCode =
  | 'STORAGE_NOT_CONFIGURED'
  | 'UPLOAD_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'DELETE_FAILED'
  | 'INVALID_PATH'
  | 'PERMISSION_DENIED'
  | 'QUOTA_EXCEEDED'
  | 'NETWORK_ERROR'

const storageErrorMessages: Record<MediaStorageErrorCode, string> = {
  STORAGE_NOT_CONFIGURED: 'Media storage is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  UPLOAD_FAILED: 'Failed to upload media to storage.',
  DOWNLOAD_FAILED: 'Failed to download media from storage.',
  DELETE_FAILED: 'Failed to delete media from storage.',
  INVALID_PATH: 'Invalid storage path.',
  PERMISSION_DENIED: 'Permission denied for storage operation.',
  QUOTA_EXCEEDED: 'Storage quota exceeded.',
  NETWORK_ERROR: 'Network error during storage operation.',
}

export class MediaStorageError extends AtlasServiceError {
  readonly code: MediaStorageErrorCode
  readonly details?: unknown

  constructor(code: MediaStorageErrorCode, details?: unknown, message?: string) {
    super('MediaStorage', 'provider_failure', details, message ?? storageErrorMessages[code])
    this.name = 'MediaStorageError'
    this.code = code
    this.details = details
  }

  get displayMessage(): string {
    return storageErrorMessages[this.code]
  }
}

export interface MediaStorageService {
  readonly isConfigured: boolean
  upload(input: UploadMediaInput): Promise<MediaAsset>
  /** Lists stored media for an investigation (organization-scoped by RLS). */
  listByInvestigation(input: ListMediaInput): Promise<MediaAsset[]>
  download(path: string): Promise<Blob>
  delete(path: string): Promise<void>
  getPublicUrl(path: string): string | null
  getSignedUrl(path: string, expiresIn?: number): Promise<string | null>
}

function generateStoragePath(investigationId: string, fileName: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 10)
  const ext = fileName.split('.').pop() ?? 'jpg'
  return `investigations/${investigationId}/${timestamp}-${random}.${ext}`
}

function computeChecksum(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async () => {
      const buffer = reader.result as ArrayBuffer
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
      resolve(hashHex)
    }
    reader.onerror = () => reject(new Error('Failed to read blob for checksum'))
    reader.readAsArrayBuffer(blob)
  })
}

export class SupabaseMediaStorageService implements MediaStorageService {
  readonly isConfigured = true
  private readonly bucketName = 'media-assets'

  private getClient() {
    return requireSupabaseClient('MediaStorage')
  }

  async upload(input: UploadMediaInput): Promise<MediaAsset> {
    const { file, ...rest } = input
    const parsed = uploadMediaInputSchema.parse(rest)
    const client = this.getClient()

    const storagePath = generateStoragePath(parsed.investigationId, parsed.fileName)
    const checksum = await computeChecksum(file)

    const { data, error } = await client.storage
      .from(this.bucketName)
      .upload(storagePath, file, {
        contentType: parsed.mimeType,
        upsert: false,
      })

    if (error) {
      if (error.message.includes('quota')) {
        throw new MediaStorageError('QUOTA_EXCEEDED', { path: storagePath, originalError: error.message })
      }
      if (error.message.includes('permission') || error.message.includes('unauthorized')) {
        throw new MediaStorageError('PERMISSION_DENIED', { path: storagePath, originalError: error.message })
      }
      throw new MediaStorageError('UPLOAD_FAILED', { path: storagePath, originalError: error.message })
    }

    let width: number | null = null
    let height: number | null = null

    if (parsed.mimeType.startsWith('image/')) {
      try {
        const dimensions = await this.getImageDimensions(file)
        width = dimensions.width
        height = dimensions.height
      } catch {
        // Dimensions are optional; don't fail upload if we can't read them
      }
    }

    // The storage object alone is not a record. Persist the durable
    // media_assets row so subject/investigation lineage and the provenance
    // chain survive; organization and actor come from the session, never
    // from the browser payload.
    const { data: userData } = await client.auth.getUser()
    const uploadedBy = userData.user?.id ?? 'unknown'

    const { data: user, error: userError } = await client
      .from('users')
      .select('organization_id')
      .eq('user_id', uploadedBy)
      .maybeSingle<{ organization_id: string }>()
    if (userError !== null || user === null || user.organization_id === '') {
      await client.storage.from(this.bucketName).remove([storagePath])
      throw new MediaStorageError('PERMISSION_DENIED', undefined, 'User has no organization membership')
    }

    const { data: row, error: rowError } = await client
      .from('media_assets')
      .insert({
        organization_id: user.organization_id,
        investigation_id: parsed.investigationId,
        uploaded_by: uploadedBy,
        storage_path: data.path,
        media_type: parsed.mimeType,
        metadata: {
          ...(parsed.metadata ?? {}),
          subjectId: parsed.subjectId ?? null,
          size: file.size,
          checksum,
          width,
          height,
        },
      })
      .select('id, created_at')
      .single<{ id: string; created_at: string }>()

    if (rowError !== null || row === null) {
      await client.storage.from(this.bucketName).remove([data.path])
      throw new MediaStorageError('UPLOAD_FAILED', { originalError: rowError?.message })
    }

    return {
      id: row.id,
      investigationId: parsed.investigationId,
      subjectId: parsed.subjectId ?? null,
      storagePath: data.path,
      mimeType: parsed.mimeType,
      size: file.size,
      width,
      height,
      checksum,
      uploadedBy,
      uploadedAt: row.created_at,
    }
  }

  async listByInvestigation(input: ListMediaInput): Promise<MediaAsset[]> {
    const parsed = listMediaInputSchema.parse(input)
    const client = this.getClient()
    const { data, error } = await client
      .from('media_assets')
      .select('*')
      .eq('investigation_id', parsed.investigationId)
      .order('created_at', { ascending: false })
    if (error !== null) {
      throw new MediaStorageError('DOWNLOAD_FAILED', { originalError: error.message })
    }
    return (data ?? []).map((raw) => {
      const row = raw as MediaAssetRow
      return mediaAssetSchema.parse({
        id: row.id,
        investigationId: row.investigation_id,
        subjectId: typeof row.metadata?.subjectId === 'string' ? row.metadata.subjectId : null,
        storagePath: row.storage_path,
        mimeType: row.media_type,
        size: typeof row.metadata?.size === 'number' ? row.metadata.size : 0,
        width: typeof row.metadata?.width === 'number' ? row.metadata.width : null,
        height: typeof row.metadata?.height === 'number' ? row.metadata.height : null,
        checksum: typeof row.metadata?.checksum === 'string' ? row.metadata.checksum : null,
        uploadedBy: row.uploaded_by,
        uploadedAt: row.created_at,
      })
    })
  }

  private async getImageDimensions(file: Blob): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      const objectUrl = URL.createObjectURL(file)

      img.onload = () => {
        URL.revokeObjectURL(objectUrl)
        resolve({ width: img.width, height: img.height })
      }

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('Failed to load image for dimensions'))
      }

      img.src = objectUrl
    })
  }

  async download(path: string): Promise<Blob> {
    if (!path || path.trim() === '') {
      throw new MediaStorageError('INVALID_PATH', { path })
    }

    const client = this.getClient()

    const { data, error } = await client.storage
      .from(this.bucketName)
      .download(path)

    if (error) {
      if (error.message.includes('not found')) {
        throw new MediaStorageError('INVALID_PATH', { path, originalError: error.message })
      }
      throw new MediaStorageError('DOWNLOAD_FAILED', { path, originalError: error.message })
    }

    return data
  }

  async delete(path: string): Promise<void> {
    if (!path || path.trim() === '') {
      throw new MediaStorageError('INVALID_PATH', { path })
    }

    const client = this.getClient()

    const { error } = await client.storage
      .from(this.bucketName)
      .remove([path])

    if (error) {
      throw new MediaStorageError('DELETE_FAILED', { path, originalError: error.message })
    }
  }

  getPublicUrl(path: string): string | null {
    if (!path || path.trim() === '') {
      return null
    }

    const client = this.getClient()

    const { data } = client.storage
      .from(this.bucketName)
      .getPublicUrl(path)

    return data.publicUrl
  }

  async getSignedUrl(path: string, expiresIn = 3600): Promise<string | null> {
    if (!path || path.trim() === '') {
      return null
    }

    const client = this.getClient()

    const { data, error } = await client.storage
      .from(this.bucketName)
      .createSignedUrl(path, expiresIn)

    if (error) {
      return null
    }

    return data.signedUrl
  }
}

export class UnconfiguredMediaStorageService implements MediaStorageService {
  readonly isConfigured = false

  async upload(): Promise<MediaAsset> {
    throw new ProviderNotConfiguredError('MediaStorage')
  }

  async listByInvestigation(): Promise<MediaAsset[]> {
    throw new ProviderNotConfiguredError('MediaStorage')
  }

  async download(): Promise<Blob> {
    throw new ProviderNotConfiguredError('MediaStorage')
  }

  async delete(): Promise<void> {
    throw new ProviderNotConfiguredError('MediaStorage')
  }

  getPublicUrl(): string | null {
    return null
  }

  async getSignedUrl(): Promise<string | null> {
    return null
  }
}