import type { DetectedFace } from '../../types'
import type { FaceDetectionProvider } from '../faceDetection'
import { z } from 'zod'
import { detectedFaceSchema, detectFacesInputSchema } from '../schemas'
import { AtlasServiceError, FaceDetectionError } from '../errors'

/**
 * Remote vision provider. Delegates detection to the authorized backend
 * service (VITE_ATLAS_FACE_DETECTION_ENDPOINT) and validates its response
 * against the detection schema before returning it to the UI.
 *
 * The provider sends the actual image bytes as multipart/form-data to the
 * configured endpoint. The endpoint must accept multipart/form-data with
 * an 'image' field containing the image file, and optional 'width', 'height',
 * 'timestamp' fields for metadata.
 */
export class HttpFaceDetectionProvider implements FaceDetectionProvider {
  readonly name: string

  private readonly endpoint: string
  private readonly timeoutMs: number

  constructor(endpoint: string, timeoutMs: number = 30000) {
    this.endpoint = endpoint
    this.name = 'Remote Vision Provider'
    this.timeoutMs = timeoutMs
  }

  async detect(input: unknown): Promise<DetectedFace[]> {
    const parsedFrame = detectFacesInputSchema.safeParse(input)
    if (!parsedFrame.success) {
      throw new AtlasServiceError('FaceDetection', 'validation_failed', parsedFrame.error.issues)
    }

    const { imageBase64, width, height, timestamp } = parsedFrame.data

    // Convert base64 to Blob
    const binaryString = atob(imageBase64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    const blob = new Blob([bytes], { type: 'image/jpeg' })

    const formData = new FormData()
    formData.append('image', blob, 'frame.jpg')
    formData.append('width', String(width))
    formData.append('height', String(height))
    formData.append('timestamp', String(timestamp))

    let response: Response
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

      response = await fetch(this.endpoint, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new FaceDetectionError('FACE_DETECTION_TIMEOUT')
      }
      throw new AtlasServiceError('FaceDetection', 'network', undefined, String(error))
    }

    if (!response.ok) {
      let errorDetail: unknown
      try {
        errorDetail = await response.json()
      } catch {
        errorDetail = await response.text().catch(() => null)
      }
      throw new FaceDetectionError('FACE_DETECTION_PROVIDER_ERROR', { status: response.status, detail: errorDetail })
    }

    const payload: unknown = await response.json().catch(() => null)
    const result = z.array(detectedFaceSchema).safeParse(payload)
    if (!result.success) {
      throw new FaceDetectionError('FACE_DETECTION_INVALID_RESPONSE', { issues: result.error.issues })
    }
    return result.data
  }
}
