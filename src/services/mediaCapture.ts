import { z } from 'zod'
import { MediaCaptureError } from './errors'

/**
 * Media capture service boundary.
 *
 * Handles camera permission, MediaStream lifecycle, frame capture,
 * and media validation. Does not perform persistence — that is a
 * separate storage service.
 */

export const mediaConstraintsSchema = z.object({
  video: z.object({
    width: z.union([z.number().int().positive(), z.object({ ideal: z.number().int().positive() })]).optional(),
    height: z.union([z.number().int().positive(), z.object({ ideal: z.number().int().positive() })]).optional(),
    facingMode: z.enum(['user', 'environment']).optional(),
  }).optional(),
})

export type MediaConstraints = z.infer<typeof mediaConstraintsSchema>

export const capturedMediaSchema = z.object({
  blob: z.instanceof(Blob),
  mimeType: z.string().startsWith('image/'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  capturedAt: z.string().datetime(),
})

export type CapturedMedia = z.infer<typeof capturedMediaSchema>

export interface MediaCaptureService {
  readonly isSupported: boolean
  readonly isStreaming: boolean
  readonly currentStream: MediaStream | null

  requestPermission(constraints?: MediaConstraints): Promise<MediaStream>
  stopStream(): void
  attachVideoElement(video: HTMLVideoElement): void
  detachVideoElement(): void
  captureFrame(): Promise<CapturedMedia>
  validateMedia(blob: Blob, mimeType: string): Promise<CapturedMedia>
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MIN_DIMENSION = 10
const MAX_DIMENSION = 8000

export class BrowserMediaCaptureService implements MediaCaptureService {
  private stream: MediaStream | null = null
  private videoElement: HTMLVideoElement | null = null

  get isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices !== 'undefined' &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    )
  }

  get isStreaming(): boolean {
    return this.stream !== null && this.stream.active
  }

  get currentStream(): MediaStream | null {
    return this.stream
  }

  async requestPermission(constraints?: MediaConstraints): Promise<MediaStream> {
    if (!this.isSupported) {
      throw new MediaCaptureError('MEDIA_API_UNAVAILABLE')
    }

    if (this.stream !== null) {
      this.stopStream()
    }

    const videoConstraints = constraints?.video ?? {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: 'user',
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
      })
      return this.stream
    } catch (error) {
      const err = error as DOMException | Error
      if (err instanceof DOMException) {
        switch (err.name) {
          case 'NotAllowedError':
            throw new MediaCaptureError('CAMERA_PERMISSION_DENIED', { name: err.name, message: err.message })
          case 'NotFoundError':
            throw new MediaCaptureError('CAMERA_NOT_AVAILABLE', { name: err.name, message: err.message })
          case 'NotReadableError':
          case 'TrackStartError':
            throw new MediaCaptureError('CAMERA_IN_USE', { name: err.name, message: err.message })
          case 'OverconstrainedError':
            throw new MediaCaptureError('STREAM_FAILED', { name: err.name, message: err.message })
          case 'AbortError':
            throw new MediaCaptureError('STREAM_FAILED', { name: err.name, message: err.message })
          default:
            throw new MediaCaptureError('STREAM_FAILED', { name: err.name, message: err.message })
        }
      }
      throw new MediaCaptureError('STREAM_FAILED', { message: err.message })
    }
  }

  attachVideoElement(video: HTMLVideoElement): void {
    this.videoElement = video
    if (this.stream !== null) {
      video.srcObject = this.stream
      video.play().catch(() => {
        // Video play can fail if not user-initiated; caller handles UI
      })
    }
  }

  detachVideoElement(): void {
    if (this.videoElement !== null) {
      this.videoElement.srcObject = null
      this.videoElement = null
    }
  }

  stopStream(): void {
    if (this.stream !== null) {
      this.stream.getTracks().forEach((track) => {
        track.stop()
      })
      this.stream = null
    }
    this.detachVideoElement()
  }

  async captureFrame(): Promise<CapturedMedia> {
    if (!this.isStreaming) {
      throw new MediaCaptureError('CAPTURE_FAILED', { reason: 'No active stream' })
    }

    const video = this.videoElement
    if (!video || video.readyState < (HTMLVideoElement as any).HAVE_CURRENT_DATA) {
      throw new MediaCaptureError('CAPTURE_FAILED', { reason: 'Video not ready', readyState: video?.readyState })
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new MediaCaptureError('CAPTURE_FAILED', { reason: 'Canvas context unavailable' })
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new MediaCaptureError('CAPTURE_FAILED', { reason: 'toBlob returned null' }))
            return
          }
          const capturedAt = new Date().toISOString()
          this.validateMedia(blob, blob.type)
            .then((validated) => resolve({ ...validated, capturedAt }))
            .catch(reject)
        },
        'image/jpeg',
        0.92
      )
    })
  }

  async validateMedia(blob: Blob, mimeType: string): Promise<CapturedMedia> {
    if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
      throw new MediaCaptureError('UNSUPPORTED_FORMAT', { mimeType, supported: SUPPORTED_MIME_TYPES })
    }

    if (blob.size === 0) {
      throw new MediaCaptureError('INVALID_MEDIA', { reason: 'Empty blob', size: blob.size })
    }

    if (blob.size > MAX_FILE_SIZE) {
      throw new MediaCaptureError('MEDIA_TOO_LARGE', { size: blob.size, max: MAX_FILE_SIZE })
    }

    return new Promise((resolve, reject) => {
      const img = new Image()
      const objectUrl = URL.createObjectURL(blob)

      img.onload = () => {
        URL.revokeObjectURL(objectUrl)

        if (img.width < MIN_DIMENSION || img.height < MIN_DIMENSION) {
          reject(new MediaCaptureError('INVALID_DIMENSIONS', { width: img.width, height: img.height, min: MIN_DIMENSION }))
          return
        }

        if (img.width > MAX_DIMENSION || img.height > MAX_DIMENSION) {
          reject(new MediaCaptureError('INVALID_DIMENSIONS', { width: img.width, height: img.height, max: MAX_DIMENSION }))
          return
        }

        resolve({
          blob,
          mimeType,
          width: img.width,
          height: img.height,
          size: blob.size,
          capturedAt: new Date().toISOString(),
        })
      }

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        reject(new MediaCaptureError('INVALID_MEDIA', { reason: 'Failed to load image for validation' }))
      }

      img.src = objectUrl
    })
  }
}

export class UnconfiguredMediaCaptureService implements MediaCaptureService {
  readonly isSupported = false
  readonly isStreaming = false
  readonly currentStream = null

  async requestPermission(): Promise<MediaStream> {
    throw new MediaCaptureError('MEDIA_API_UNAVAILABLE')
  }

  stopStream(): void {}

  attachVideoElement(): void {}

  detachVideoElement(): void {}

  async captureFrame(): Promise<CapturedMedia> {
    throw new MediaCaptureError('MEDIA_API_UNAVAILABLE')
  }

  async validateMedia(): Promise<CapturedMedia> {
    throw new MediaCaptureError('MEDIA_API_UNAVAILABLE')
  }
}