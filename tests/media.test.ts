import { describe, expect, it } from 'vitest'
import { MediaCaptureError } from '../src/services/errors'
import { mediaConstraintsSchema, capturedMediaSchema } from '../src/services/mediaCapture'
import { uploadMediaInputSchema } from '../src/services/mediaStorage'
import { MediaStorageError } from '../src/services/errors'

describe('MediaCaptureError', () => {
  it('exposes camera-specific error codes', () => {
    const err = new MediaCaptureError('CAMERA_PERMISSION_DENIED')
    expect(err.cameraCode).toBe('CAMERA_PERMISSION_DENIED')
    expect(err.code).toBe('CAMERA_PERMISSION_DENIED')
    expect(err.displayMessage).toContain('permission')
  })

  it('has correct display messages for all camera error codes', () => {
    const codes = [
      'CAMERA_PERMISSION_DENIED',
      'CAMERA_NOT_AVAILABLE',
      'CAMERA_IN_USE',
      'STREAM_FAILED',
      'CAPTURE_FAILED',
      'INVALID_MEDIA',
      'MEDIA_TOO_LARGE',
      'UNSUPPORTED_FORMAT',
      'INVALID_DIMENSIONS',
      'MEDIA_API_UNAVAILABLE',
    ] as const

    for (const code of codes) {
      const err = new MediaCaptureError(code)
      expect(err.cameraCode).toBe(code)
      expect(err.displayMessage).toBeTruthy()
      expect(err.displayMessage.length).toBeGreaterThan(0)
    }
  })

  it('accepts custom message', () => {
    const err = new MediaCaptureError('CAPTURE_FAILED', { reason: 'test' }, 'Custom capture error')
    expect(err.displayMessage).toBe('Custom capture error')
    expect(err.details).toEqual({ reason: 'test' })
  })

  it('is an AtlasServiceError', () => {
    const err = new MediaCaptureError('CAPTURE_FAILED')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('MediaCaptureError')
    expect(err.service).toBe('MediaCapture')
  })
})

describe('MediaStorageError', () => {
  it('exposes storage-specific error codes', () => {
    const err = new MediaStorageError('STORAGE_NOT_CONFIGURED')
    expect(err.storageCode).toBe('STORAGE_NOT_CONFIGURED')
    expect(err.code).toBe('STORAGE_NOT_CONFIGURED')
    expect(err.displayMessage).toContain('storage')
  })

  it('has correct display messages for all storage error codes', () => {
    const codes = [
      'STORAGE_NOT_CONFIGURED',
      'UPLOAD_FAILED',
      'DOWNLOAD_FAILED',
      'DELETE_FAILED',
      'INVALID_PATH',
      'PERMISSION_DENIED',
      'QUOTA_EXCEEDED',
      'NETWORK_ERROR',
    ] as const

    for (const code of codes) {
      const err = new MediaStorageError(code)
      expect(err.storageCode).toBe(code)
      expect(err.displayMessage).toBeTruthy()
      expect(err.displayMessage.length).toBeGreaterThan(0)
    }
  })

  it('is an AtlasServiceError', () => {
    const err = new MediaStorageError('UPLOAD_FAILED')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('MediaStorageError')
    expect(err.service).toBe('MediaStorage')
  })
})

describe('mediaConstraintsSchema', () => {
  it('accepts valid constraints with ideal dimensions', () => {
    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
      },
    }
    const result = mediaConstraintsSchema.safeParse(constraints)
    expect(result.success).toBe(true)
  })

  it('accepts simple number dimensions', () => {
    const constraints = {
      video: {
        width: 1920,
        height: 1080,
      },
    }
    const result = mediaConstraintsSchema.safeParse(constraints)
    expect(result.success).toBe(true)
  })

  it('accepts partial constraints', () => {
    const constraints = { video: { width: 1280 } }
    const result = mediaConstraintsSchema.safeParse(constraints)
    expect(result.success).toBe(true)
  })

  it('accepts empty constraints', () => {
    const constraints = {}
    const result = mediaConstraintsSchema.safeParse(constraints)
    expect(result.success).toBe(true)
  })

  it('rejects invalid facingMode', () => {
    const constraints = { video: { facingMode: 'invalid' } }
    const result = mediaConstraintsSchema.safeParse(constraints)
    expect(result.success).toBe(false)
  })

  it('rejects negative dimensions', () => {
    const constraints = { video: { width: -100 } }
    const result = mediaConstraintsSchema.safeParse(constraints)
    expect(result.success).toBe(false)
  })
})

describe('capturedMediaSchema', () => {
  it('accepts valid captured media', () => {
    const blob = new Blob(['test'], { type: 'image/jpeg' })
    const media = {
      blob,
      mimeType: 'image/jpeg',
      width: 1280,
      height: 720,
      size: blob.size,
      capturedAt: new Date().toISOString(),
    }
    const result = capturedMediaSchema.safeParse(media)
    expect(result.success).toBe(true)
  })

  it('rejects non-image mime types', () => {
    const blob = new Blob(['test'], { type: 'video/mp4' })
    const media = {
      blob,
      mimeType: 'video/mp4',
      width: 1280,
      height: 720,
      size: blob.size,
      capturedAt: new Date().toISOString(),
    }
    const result = capturedMediaSchema.safeParse(media)
    expect(result.success).toBe(false)
  })

  it('rejects invalid dimensions', () => {
    const blob = new Blob(['test'], { type: 'image/jpeg' })
    const media = {
      blob,
      mimeType: 'image/jpeg',
      width: -1,
      height: 720,
      size: blob.size,
      capturedAt: new Date().toISOString(),
    }
    const result = capturedMediaSchema.safeParse(media)
    expect(result.success).toBe(false)
  })

  it('rejects zero dimensions', () => {
    const blob = new Blob(['test'], { type: 'image/jpeg' })
    const media = {
      blob,
      mimeType: 'image/jpeg',
      width: 0,
      height: 720,
      size: blob.size,
      capturedAt: new Date().toISOString(),
    }
    const result = capturedMediaSchema.safeParse(media)
    expect(result.success).toBe(false)
  })
})

describe('UploadMediaInput schema', () => {
  it('accepts valid upload input', () => {
    const input = {
      investigationId: '550e8400-e29b-41d4-a716-446655440001',
      subjectId: '550e8400-e29b-41d4-a716-446655440002',
      fileName: 'capture.jpg',
      mimeType: 'image/jpeg',
      metadata: { width: 1280, height: 720 },
    }
    const result = uploadMediaInputSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('requires investigationId', () => {
    const input = {
      fileName: 'capture.jpg',
      mimeType: 'image/jpeg',
    }
    const result = uploadMediaInputSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('requires fileName', () => {
    const input = {
      investigationId: '550e8400-e29b-41d4-a716-446655440001',
      mimeType: 'image/jpeg',
    }
    const result = uploadMediaInputSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('requires valid mimeType starting with image/', () => {
    const input = {
      investigationId: '550e8400-e29b-41d4-a716-446655440001',
      fileName: 'capture.jpg',
      mimeType: 'video/mp4',
    }
    const result = uploadMediaInputSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('accepts nullable subjectId', () => {
    const input = {
      investigationId: '550e8400-e29b-41d4-a716-446655440001',
      fileName: 'capture.jpg',
      mimeType: 'image/jpeg',
      subjectId: null,
    }
    const result = uploadMediaInputSchema.safeParse(input)
    expect(result.success).toBe(true)
  })
})