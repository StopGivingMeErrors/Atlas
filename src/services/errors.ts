/**
 * Atlas service error taxonomy.
 *
 * Every service call resolves with typed output or rejects with an
 * AtlasServiceError. The UI maps `provider_not_configured` to a visible
 * "Provider not configured." state — the system never falls back to demo
 * data when a real provider is missing.
 */

export type AtlasErrorCode =
  | 'provider_not_configured'
  | 'authorization_required'
  | 'validation_failed'
  | 'not_found'
  | 'conflict'
  | 'provider_failure'
  | 'network'
  | 'supabase_unreachable'
  | 'schema_not_ready'
  | 'auth_provider_disabled'
  | 'email_already_registered'
  | 'email_confirmation_required'
  | 'invalid_credentials'
  | 'weak_password'

// Extended error codes for specific services
export type ServiceErrorCode =
  | AtlasErrorCode
  | 'CAMERA_PERMISSION_DENIED'
  | 'CAMERA_NOT_AVAILABLE'
  | 'CAMERA_IN_USE'
  | 'STREAM_FAILED'
  | 'CAPTURE_FAILED'
  | 'INVALID_MEDIA'
  | 'MEDIA_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_DIMENSIONS'
  | 'MEDIA_API_UNAVAILABLE'
  | 'STORAGE_NOT_CONFIGURED'
  | 'UPLOAD_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'DELETE_FAILED'
  | 'INVALID_PATH'
  | 'PERMISSION_DENIED'
  | 'QUOTA_EXCEEDED'
  | 'NETWORK_ERROR'

export type CameraErrorCode =
  | 'CAMERA_PERMISSION_DENIED'
  | 'CAMERA_NOT_AVAILABLE'
  | 'CAMERA_IN_USE'
  | 'STREAM_FAILED'
  | 'CAPTURE_FAILED'
  | 'INVALID_MEDIA'
  | 'MEDIA_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_DIMENSIONS'
  | 'MEDIA_API_UNAVAILABLE'

export type MediaStorageErrorCode =
  | 'STORAGE_NOT_CONFIGURED'
  | 'UPLOAD_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'DELETE_FAILED'
  | 'INVALID_PATH'
  | 'PERMISSION_DENIED'
  | 'QUOTA_EXCEEDED'
  | 'NETWORK_ERROR'

export type FaceDetectionErrorCode =
  | 'FACE_DETECTION_PROVIDER_NOT_CONFIGURED'
  | 'FACE_DETECTION_PROVIDER_ERROR'
  | 'FACE_DETECTION_INVALID_RESPONSE'
  | 'FACE_DETECTION_INVALID_IMAGE'
  | 'FACE_DETECTION_TIMEOUT'

export type CapturedMedia = {
  blob: Blob
  mimeType: string
  width: number
  height: number
  size: number
  capturedAt: string
}

export type MediaConstraints = {
  video?: {
    width?: number | { ideal: number }
    height?: number | { ideal: number }
    facingMode?: 'user' | 'environment'
  }
}

const codeMessages: Record<AtlasErrorCode, string> = {
  provider_not_configured: 'Provider not configured.',
  authorization_required:
    'Subject authorization is not established. Identity resolution is blocked.',
  validation_failed: 'Request failed schema validation.',
  not_found: 'Resource not found.',
  conflict: 'Resource is in a conflicting state.',
  provider_failure: 'The configured provider failed to complete the request.',
  network: 'Network communication with the application API failed.',
  supabase_unreachable:
    'Could not reach the Supabase project. The URL may be wrong or the project may not exist.',
  schema_not_ready:
    'The database schema is not ready. Please apply the required migrations in the Supabase dashboard SQL editor.',
  auth_provider_disabled:
    'The email/password authentication provider is not enabled in the Supabase dashboard.',
  email_already_registered: 'An account with this email address already exists.',
  email_confirmation_required:
    'Registration received. Please confirm your email address before signing in.',
  invalid_credentials: 'Invalid email or password.',
  weak_password: 'Password does not meet the minimum requirements.',
}

const serviceErrorMessages: Record<string, string> = {
  ...codeMessages,
  CAMERA_PERMISSION_DENIED: 'Camera permission was denied. Please grant camera access in your browser settings.',
  CAMERA_NOT_AVAILABLE: 'No camera device found on this system.',
  CAMERA_IN_USE: 'Camera is already in use by another application.',
  STREAM_FAILED: 'Failed to start camera stream.',
  CAPTURE_FAILED: 'Failed to capture frame from video stream.',
  INVALID_MEDIA: 'Captured media is invalid or corrupted.',
  MEDIA_TOO_LARGE: 'Captured media exceeds maximum allowed size.',
  UNSUPPORTED_FORMAT: 'Unsupported media format. Only JPEG, PNG, and WebP are accepted.',
  INVALID_DIMENSIONS: 'Captured media dimensions are invalid.',
  MEDIA_API_UNAVAILABLE: 'Camera API is not available in this browser context.',
  STORAGE_NOT_CONFIGURED: 'Media storage is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  UPLOAD_FAILED: 'Failed to upload media to storage.',
  DOWNLOAD_FAILED: 'Failed to download media from storage.',
  DELETE_FAILED: 'Failed to delete media from storage.',
  INVALID_PATH: 'Invalid storage path.',
  PERMISSION_DENIED: 'Permission denied for storage operation.',
  QUOTA_EXCEEDED: 'Storage quota exceeded.',
  NETWORK_ERROR: 'Network error during storage operation.',
  FACE_DETECTION_PROVIDER_NOT_CONFIGURED: 'Face detection provider is not configured.',
  FACE_DETECTION_PROVIDER_ERROR: 'Face detection provider returned an error.',
  FACE_DETECTION_INVALID_RESPONSE: 'Face detection provider returned an invalid response.',
  FACE_DETECTION_INVALID_IMAGE: 'Invalid image data provided for face detection.',
  FACE_DETECTION_TIMEOUT: 'Face detection request timed out.',
}

export class AtlasServiceError extends Error {
  readonly code: string
  readonly service: string
  readonly details?: unknown

  constructor(service: string, code: string, details?: unknown, message?: string) {
    super(message ?? `[${service}] ${serviceErrorMessages[code]}`)
    this.name = 'AtlasServiceError'
    this.service = service
    this.code = code
    this.details = details
  }

  /** User-facing message safe to render directly in the UI. */
  get displayMessage(): string {
    return serviceErrorMessages[this.code]
  }
}

export class ProviderNotConfiguredError extends AtlasServiceError {
  constructor(service: string) {
    super(service, 'provider_not_configured')
    this.name = 'ProviderNotConfiguredError'
  }
}

export class AuthorizationRequiredError extends AtlasServiceError {
  constructor(service: string, subjectId: string, state: string) {
    super(service, 'authorization_required', { subjectId, state })
    this.name = 'AuthorizationRequiredError'
  }
}

export class MediaCaptureError extends AtlasServiceError {
  readonly cameraCode: CameraErrorCode
  readonly details?: unknown
  private readonly customMessage?: string

  constructor(cameraCode: CameraErrorCode, details?: unknown, message?: string) {
    super('MediaCapture', cameraCode, details, message ?? serviceErrorMessages[cameraCode])
    this.name = 'MediaCaptureError'
    this.cameraCode = cameraCode
    this.details = details
    this.customMessage = message
  }

  // Camera-specific code accessor
  get cameraErrorCode(): CameraErrorCode {
    return this.cameraCode
  }

  get displayMessage(): string {
    return this.customMessage ?? serviceErrorMessages[this.code]
  }
}

export class MediaStorageError extends AtlasServiceError {
  readonly storageCode: MediaStorageErrorCode
  readonly details?: unknown

  constructor(storageCode: MediaStorageErrorCode, details?: unknown, message?: string) {
    super('MediaStorage', storageCode, details, message ?? serviceErrorMessages[storageCode])
    this.name = 'MediaStorageError'
    this.storageCode = storageCode
    this.details = details
  }

  // Storage-specific code accessor
  get storageErrorCode(): MediaStorageErrorCode {
    return this.storageCode
  }

  get displayMessage(): string {
    return serviceErrorMessages[this.code]
  }
}

export class FaceDetectionError extends AtlasServiceError {
  readonly faceDetectionCode: FaceDetectionErrorCode
  readonly details?: unknown
  private readonly customMessage?: string

  constructor(faceDetectionCode: FaceDetectionErrorCode, details?: unknown, message?: string) {
    super('FaceDetection', faceDetectionCode, details, message ?? serviceErrorMessages[faceDetectionCode])
    this.name = 'FaceDetectionError'
    this.faceDetectionCode = faceDetectionCode
    this.details = details
    this.customMessage = message
  }

  get faceDetectionErrorCode(): FaceDetectionErrorCode {
    return this.faceDetectionCode
  }

  get displayMessage(): string {
    return this.customMessage ?? serviceErrorMessages[this.code]
  }
}

export function toAtlasServiceError(service: string, error: unknown): AtlasServiceError {
  if (error instanceof AtlasServiceError) return error
  if (error instanceof Error) {
    const msg = error.message
    if (/fetch|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(msg)) {
      // Distinguish "Supabase project unreachable" (DNS/transport) from generic network error.
      if (/ENOTFOUND|ECONNREFUSED/i.test(msg)) {
        return new AtlasServiceError(service, 'supabase_unreachable', undefined, msg)
      }
      return new AtlasServiceError(service, 'network', undefined, msg)
    }
  }
  return new AtlasServiceError(
    service,
    'provider_failure',
    error,
    error instanceof Error ? error.message : undefined,
  )
}