import type { DetectedFace } from '../types'

/**
 * Computer-vision abstraction layer.
 *
 * The UI consumes only this interface. Swapping the demo provider for
 * MediaPipe, TensorFlow.js, or an authorized backend vision service
 * requires implementing FaceDetectionProvider — no UI changes.
 */
export interface FaceDetectionProvider {
  readonly name: string
  detect(frame: FrameContext): Promise<DetectedFace[]>
}

export interface FrameContext {
  width: number
  height: number
  timestamp: number
}

export interface FaceTrackingEngine {
  update(faces: DetectedFace[]): DetectedFace[]
  reset(): void
}

/**
 * Demo provider producing stable, plausible detections so the capture
 * workspace is fully exercisable without camera hardware or a model.
 * Detections drift slightly frame-to-frame to simulate live tracking.
 */
export class DemoFaceDetectionProvider implements FaceDetectionProvider {
  readonly name = 'Demo Detection Provider'
  private seedFaces: Array<{ base: DetectedFace; phase: number }>

  constructor(faceCount: number = 2) {
    const layouts = [
      { x: 0.22, y: 0.24, width: 0.16, height: 0.28, confidence: 0.992 },
      { x: 0.58, y: 0.3, width: 0.14, height: 0.25, confidence: 0.968 },
      { x: 0.42, y: 0.18, width: 0.13, height: 0.23, confidence: 0.941 },
    ]
    this.seedFaces = layouts.slice(0, faceCount).map((layout, i) => ({
      phase: i * 1.7,
      base: {
        id: `face-${i + 1}`,
        trackingId: i + 1,
        boundingBox: { x: layout.x, y: layout.y, width: layout.width, height: layout.height },
        confidence: layout.confidence,
        orientation: 'frontal',
        frameTimestamp: 0,
      },
    }))
  }

  async detect(frame: FrameContext): Promise<DetectedFace[]> {
    const t = frame.timestamp / 1000
    return this.seedFaces.map(({ base, phase }) => ({
      ...base,
      boundingBox: {
        ...base.boundingBox,
        x: base.boundingBox.x + Math.sin(t * 0.8 + phase) * 0.004,
        y: base.boundingBox.y + Math.cos(t * 0.6 + phase) * 0.003,
      },
      confidence: Math.min(0.999, base.confidence + Math.sin(t * 1.3 + phase) * 0.004),
      frameTimestamp: frame.timestamp,
    }))
  }
}

/** Smooths bounding boxes across frames and keeps tracking IDs stable. */
export class ExponentialSmoothingTracker implements FaceTrackingEngine {
  private previous = new Map<number, DetectedFace>()
  private readonly alpha: number

  constructor(alpha: number = 0.35) {
    this.alpha = alpha
  }

  update(faces: DetectedFace[]): DetectedFace[] {
    const smoothed = faces.map((face) => {
      const prev = this.previous.get(face.trackingId)
      if (!prev) return face
      const a = this.alpha
      return {
        ...face,
        boundingBox: {
          x: prev.boundingBox.x + a * (face.boundingBox.x - prev.boundingBox.x),
          y: prev.boundingBox.y + a * (face.boundingBox.y - prev.boundingBox.y),
          width: prev.boundingBox.width + a * (face.boundingBox.width - prev.boundingBox.width),
          height: prev.boundingBox.height + a * (face.boundingBox.height - prev.boundingBox.height),
        },
      }
    })
    this.previous = new Map(smoothed.map((f) => [f.trackingId, f]))
    return smoothed
  }

  reset(): void {
    this.previous.clear()
  }
}

export function createFaceDetectionProvider(): FaceDetectionProvider {
  return new DemoFaceDetectionProvider()
}
