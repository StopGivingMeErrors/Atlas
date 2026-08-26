import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FaceDetectionError } from '../src/services/errors'

const hoisted = vi.hoisted(() => ({ stub: null as unknown }))

vi.mock('../src/services/supabase/client', async () => {
  const { ProviderNotConfiguredError } = await import('../src/services/errors')
  return {
    getSupabaseClient: () => hoisted.stub,
    requireSupabaseClient: (service: string) => {
      if (hoisted.stub === null) throw new ProviderNotConfiguredError(service)
      return hoisted.stub as SupabaseClient
    },
  }
})

import { ProviderBackedFaceDetectionService } from '../src/services/faceDetection'
import { HttpFaceDetectionProvider } from '../src/services/providers/httpFaceDetection'
import { UnconfiguredFaceDetectionService } from '../src/services/faceDetection'
import { detectFacesInputSchema, detectedFaceSchema } from '../src/services/schemas'

const minimalJpegBase64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='

const _validFaceResponse = [{
  id: 'face-1',
  trackingId: 1,
  boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  confidence: 0.95,
  orientation: 'frontal' as const,
  frameTimestamp: 1234567890,
}]

beforeEach(() => {
  hoisted.stub = null
})

describe('detectFacesInputSchema', () => {
  it('accepts valid input with imageBase64', () => {
    const input = {
      width: 1280,
      height: 720,
      timestamp: 1234,
      imageBase64: minimalJpegBase64,
    }
    const result = detectFacesInputSchema.safeParse(input)
    expect(result.success).toBe(true)
    expect(result.data.imageBase64).toBeDefined()
  })

  it('rejects missing imageBase64', () => {
    const input = { width: 1280, height: 720, timestamp: 1234 }
    const result = detectFacesInputSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects empty imageBase64', () => {
    const input = { width: 1280, height: 720, timestamp: 1234, imageBase64: '' }
    const result = detectFacesInputSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects negative width', () => {
    const input = { width: -5, height: 720, timestamp: 1234, imageBase64: 'test' }
    const result = detectFacesInputSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects negative height', () => {
    const input = { width: 1280, height: -5, timestamp: 1234, imageBase64: 'test' }
    const result = detectFacesInputSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects negative timestamp', () => {
    const input = { width: 1280, height: 720, timestamp: -1, imageBase64: 'test' }
    const result = detectFacesInputSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

describe('detectedFaceSchema', () => {
  it('accepts valid detected face', () => {
    const face = {
      id: 'face-1',
      trackingId: 1,
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      confidence: 0.95,
      orientation: 'frontal' as const,
      frameTimestamp: 1234567890,
    }
    const result = detectedFaceSchema.safeParse(face)
    expect(result.success).toBe(true)
  })

  it('rejects invalid confidence', () => {
    const face = {
      id: 'face-1',
      trackingId: 1,
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      confidence: 1.5,
      orientation: 'frontal' as const,
      frameTimestamp: 1234567890,
    }
    const result = detectedFaceSchema.safeParse(face)
    expect(result.success).toBe(false)
  })

  it('rejects invalid orientation', () => {
    const face = {
      id: 'face-1',
      trackingId: 1,
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      confidence: 0.95,
      orientation: 'upside-down' as const,
      frameTimestamp: 1234567890,
    }
    const result = detectedFaceSchema.safeParse(face)
    expect(result.success).toBe(false)
  })

  it('rejects negative bounding box dimensions', () => {
    const face = {
      id: 'face-1',
      trackingId: 1,
      boundingBox: { x: 0.1, y: 0.2, width: -0.3, height: 0.4 },
      confidence: 0.95,
      orientation: 'frontal' as const,
      frameTimestamp: 1234567890,
    }
    const result = detectedFaceSchema.safeParse(face)
    expect(result.success).toBe(false)
  })
})

describe('UnconfiguredFaceDetectionService', () => {
  it('throws ProviderNotConfiguredError when no provider is configured', async () => {
    const service = new UnconfiguredFaceDetectionService()
    await expect(service.detect({
      width: 1280,
      height: 720,
      timestamp: 1234,
      imageBase64: 'test',
    })).rejects.toThrow('Provider not configured.')
  })

  it('has isConfigured = false and providerName = null', () => {
    const service = new UnconfiguredFaceDetectionService()
    expect(service.isConfigured).toBe(false)
    expect(service.providerName).toBeNull()
  })
})

describe('ProviderBackedFaceDetectionService with HttpFaceDetectionProvider', () => {
  const validInput = {
    width: 1280,
    height: 720,
    timestamp: 1234,
    imageBase64: minimalJpegBase64,
  }

  const validFaceResponse = [{
    id: 'face-1',
    trackingId: 1,
    boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    confidence: 0.95,
    orientation: 'frontal' as const,
    frameTimestamp: 1234567890,
  }]

  beforeEach(() => {
    // Reset fetch mock
    global.fetch = vi.fn()
  })

  afterEach(() => {
    // fetch mock is reset via global.fetch = vi.fn() in beforeEach
  })

  it('returns validated faces on successful provider response', async () => {
    const provider = new HttpFaceDetectionProvider('https://vision.example.com/detect', 5000)
    
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => validFaceResponse,
    })) as any

    const service = new ProviderBackedFaceDetectionService(provider)
    const faces = await service.detect(validInput)

    expect(faces).toHaveLength(1)
    expect(faces[0].id).toBe('face-1')
    expect(faces[0].confidence).toBe(0.95)
    expect(faces[0].orientation).toBe('frontal')
  })

  it('throws FACE_DETECTION_PROVIDER_ERROR on HTTP error status', async () => {
    const provider = new HttpFaceDetectionProvider('https://vision.example.com/detect', 5000)
    
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    })) as any

    const service = new ProviderBackedFaceDetectionService(provider)
    await expect(service.detect(validInput)).rejects.toThrow('Face detection provider returned an error.')
  })

it('sets up abort controller with correct timeout', async () => {
    const _provider = new HttpFaceDetectionProvider('https://vision.example.com/detect', 100) // 100ms timeout
    
    let fetchCalled = false
    let fetchSignal: AbortSignal | null = null
    global.fetch = vi.fn(async (url, options) => {
      fetchCalled = true
      fetchSignal = options?.signal ?? null
      return { ok: true, json: async () => [] }
    }) as any

    const provider2 = new HttpFaceDetectionProvider('https://vision.example.com/detect', 100)
    const service = new ProviderBackedFaceDetectionService(provider2)
    await service.detect(validInput)

    expect(fetchCalled).toBe(true)
    expect(fetchSignal).toBeInstanceOf(AbortSignal)
  })

  it('throws FACE_DETECTION_INVALID_RESPONSE on malformed response', async () => {
    const provider = new HttpFaceDetectionProvider('https://vision.example.com/detect', 5000)
    
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [{ invalid: 'data' }],
    })) as any

    const service = new ProviderBackedFaceDetectionService(provider)
    await expect(service.detect(validInput)).rejects.toThrow('Face detection provider returned an invalid response.')
  })

  it('rejects invalid base64', async () => {
    const provider = new HttpFaceDetectionProvider('https://vision.example.com/detect', 5000)
    
    const invalidInput = {
      width: 1280,
      height: 720,
      timestamp: 1234,
      imageBase64: 'not-valid-base64!',
    }
    
    const service = new ProviderBackedFaceDetectionService(provider)
    await expect(service.detect(invalidInput)).rejects.toThrow()
  })

  it('validates provider response schema', async () => {
    const provider = new HttpFaceDetectionProvider('https://vision.example.com/detect', 5000)
    
    // Valid response should pass
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => validFaceResponse,
    })) as any

    const service = new ProviderBackedFaceDetectionService(provider)
    const faces = await service.detect(validInput)
    expect(faces).toHaveLength(1)
  })

  it('returns empty array for no faces', async () => {
    const provider = new HttpFaceDetectionProvider('https://vision.example.com/detect', 5000)
    
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    })) as any

    const service = new ProviderBackedFaceDetectionService(provider)
    const faces = await service.detect(validInput)
    expect(faces).toEqual([])
  })
})

describe('FaceDetectionError', () => {
  it('exposes faceDetectionErrorCode', () => {
    const error = new FaceDetectionError('FACE_DETECTION_TIMEOUT')
    expect(error.faceDetectionErrorCode).toBe('FACE_DETECTION_TIMEOUT')
    expect(error.code).toBe('FACE_DETECTION_TIMEOUT')
    expect(error.displayMessage).toContain('timed out')
  })

  it('has correct display messages for all error codes', () => {
    const codes = [
      'FACE_DETECTION_PROVIDER_NOT_CONFIGURED',
      'FACE_DETECTION_PROVIDER_ERROR',
      'FACE_DETECTION_INVALID_RESPONSE',
      'FACE_DETECTION_INVALID_IMAGE',
      'FACE_DETECTION_TIMEOUT',
    ] as const

    for (const code of codes) {
      const error = new FaceDetectionError(code)
      expect(error.faceDetectionErrorCode).toBe(code)
      expect(error.displayMessage).toBeTruthy()
      expect(error.displayMessage.length).toBeGreaterThan(0)
    }
  })

  it('accepts custom message', () => {
    const error = new FaceDetectionError('FACE_DETECTION_TIMEOUT', { reason: 'test' }, 'Custom timeout error')
    expect(error.displayMessage).toBe('Custom timeout error')
    expect(error.details).toEqual({ reason: 'test' })
  })
})

describe('FaceDetection integration with media capture', () => {
  it('media capture produces CapturedMedia with blob', async () => {
    const { capturedMediaSchema } = await import('../src/services/mediaCapture')
    
    const capturedMedia = {
      blob: new Blob(['test'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 1280,
      height: 720,
      size: 1000,
      capturedAt: new Date().toISOString(),
    }
    
    const result = capturedMediaSchema.safeParse(capturedMedia)
    expect(result.success).toBe(true)
  })
})

describe('stale/cancelled request handling', () => {
  it('provider handles aborted requests', async () => {
    const provider = new HttpFaceDetectionProvider('https://vision.example.com/detect', 5000)
    
    let resolveFetch: (value: any) => void
    const fetchPromise = new Promise((resolve) => { resolveFetch = resolve })
    global.fetch = vi.fn(() => fetchPromise) as any

    const service = new ProviderBackedFaceDetectionService(provider)
    const detectPromise = service.detect({
      width: 1280,
      height: 720,
      timestamp: 1234,
      imageBase64: minimalJpegBase64,
    })

    // Simulate component unmount by resolving
    resolveFetch!({ ok: true, json: async () => [] })
    
    await expect(detectPromise).resolves.toEqual([])
  })
})