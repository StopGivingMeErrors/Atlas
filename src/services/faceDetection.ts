import { z } from 'zod'
import type { DetectedFace } from '../types'
import { detectedFaceSchema, detectFacesInputSchema } from './schemas'
import { parseOrThrow } from './supabase/rows'
import { ProviderNotConfiguredError } from './errors'

/**
 * Face detection service boundary.
 *
 * The UI consumes only this interface. Detection providers are pluggable:
 * a production deployment registers a real vision provider (MediaPipe,
 * TensorFlow.js, or an authorized backend vision service) via the
 * container. When no provider is configured, every call fails with
 * ProviderNotConfiguredError — the system never fabricates detections.
 */
export type DetectFacesInput = z.infer<typeof detectFacesInputSchema>

export interface FaceDetectionProvider {
  readonly name: string
  detect(input: DetectFacesInput): Promise<DetectedFace[]>
}

export interface FaceDetectionService {
  /** Human-readable provider name for status displays; null when unconfigured. */
  readonly providerName: string | null
  readonly isConfigured: boolean
  detect(input: DetectFacesInput): Promise<DetectedFace[]>
}

/** Wraps a concrete provider with boundary validation. */
export class ProviderBackedFaceDetectionService implements FaceDetectionService {
  readonly providerName: string
  readonly isConfigured = true

  private readonly provider: FaceDetectionProvider

  constructor(provider: FaceDetectionProvider) {
    this.provider = provider
    this.providerName = provider.name
  }

  async detect(input: DetectFacesInput): Promise<DetectedFace[]> {
    const frame = parseOrThrow('FaceDetection', detectFacesInputSchema, input)
    const faces = await this.provider.detect(frame)
    return parseOrThrow('FaceDetection', z.array(detectedFaceSchema), faces)
  }
}

export class UnconfiguredFaceDetectionService implements FaceDetectionService {
  readonly providerName: string | null = null
  readonly isConfigured = false

  async detect(): Promise<DetectedFace[]> {
    throw new ProviderNotConfiguredError('FaceDetection')
  }
}
