import type { z } from 'zod'
import type { DetectedFace, BoundingBox } from '../types'
import { trackFacesInputSchema } from './schemas'
import { parseOrThrow } from './supabase/rows'

/**
 * Face tracking service boundary.
 *
 * Tracks detected faces across frames: associates detections temporally
 * using IoU-based matching, assigns stable tracking IDs, and manages
 * track lifecycle (ACTIVE, TEMPORARILY_LOST, EXPIRED).
 *
 * Tracking operates ONLY on real detections from FaceDetectionService.
 * It never invents faces or generates fake tracking IDs.
 */

export type TrackFacesInput = z.infer<typeof trackFacesInputSchema>

/** Lifecycle state of a face track. */
export type TrackState = 'ACTIVE' | 'TEMPORARILY_LOST' | 'EXPIRED'

/** Internal representation of a tracked face with lifecycle metadata. */
export interface TrackedFace extends DetectedFace {
  trackId: number
  state: TrackState
  firstSeenAt: number
  lastSeenAt: number
  framesSinceDetection: number
  consecutiveFramesDetected: number
}

/** Configuration for the tracking engine. */
export interface TrackingConfig {
  /** IoU threshold for associating detections with existing tracks. */
  iouThreshold: number
  /** Maximum center-point distance (normalized 0-1) for association fallback. */
  centerDistanceThreshold: number
  /** Frames a track can be lost before becoming TEMPORARILY_LOST. */
  lostToleranceFrames: number
  /** Frames a track can be lost before expiring. */
  expirationFrames: number
  /** Minimum frames a track must be detected before considered stable. */
  stabilityFrames: number
  /** Maximum number of tracks to maintain. */
  maxTracks: number
}

/** Default tracking configuration. */
export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  iouThreshold: 0.3,
  centerDistanceThreshold: 0.15,
  lostToleranceFrames: 3,
  expirationFrames: 10,
  stabilityFrames: 2,
  maxTracks: 20,
}

/** A single detection candidate for matching. */
interface DetectionCandidate {
  face: DetectedFace
  matched: boolean
}

/** A track with its current state and history. */
interface InternalTrack {
  trackId: number
  face: TrackedFace
  state: TrackState
  framesSinceDetection: number
  consecutiveFramesDetected: number
}

/** IoU (Intersection over Union) between two bounding boxes. */
function calculateIoU(boxA: BoundingBox, boxB: BoundingBox): number {
  const x1 = Math.max(boxA.x, boxB.x)
  const y1 = Math.max(boxA.y, boxB.y)
  const x2 = Math.min(boxA.x + boxA.width, boxB.x + boxB.width)
  const y2 = Math.min(boxA.y + boxA.height, boxB.y + boxB.height)

  if (x2 <= x1 || y2 <= y1) return 0

  const intersection = (x2 - x1) * (y2 - y1)
  const areaA = boxA.width * boxA.height
  const areaB = boxB.width * boxB.height
  const union = areaA + areaB - intersection

  return union > 0 ? intersection / union : 0
}

/** Center-point distance (normalized 0-1) between two bounding boxes. */
function calculateCenterDistance(boxA: BoundingBox, boxB: BoundingBox): number {
  const centerAx = boxA.x + boxA.width / 2
  const centerAy = boxA.y + boxA.height / 2
  const centerBx = boxB.x + boxB.width / 2
  const centerBy = boxB.y + boxB.height / 2

  const dx = centerAx - centerBx
  const dy = centerAy - centerBy
  return Math.sqrt(dx * dx + dy * dy)
}

/** Convert a raw detection to a tracked face with initial state. */
function createTrackedFace(
  face: DetectedFace,
  trackId: number,
  timestamp: number
): TrackedFace {
  return {
    ...face,
    trackId,
    state: 'ACTIVE',
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    framesSinceDetection: 0,
    consecutiveFramesDetected: 1,
  }
}

/** Tracking engine implementing IoU-based association with lifecycle management. */
export class IoUTrackingEngine implements FaceTrackingEngine {
  private tracks = new Map<number, InternalTrack>()
  private nextTrackId = 1
  private config: TrackingConfig
  private frameTimestamp = 0

  constructor(config: Partial<TrackingConfig> = {}) {
    this.config = { ...DEFAULT_TRACKING_CONFIG, ...config }
  }

  /** Update tracks with new detections. Returns active tracked faces. */
  update(faces: DetectedFace[]): TrackedFace[] {
    this.frameTimestamp++

    // Mark all existing tracks as not detected this frame
    for (const track of this.tracks.values()) {
      track.framesSinceDetection++
    }

    // Create candidates from detections
    const candidates: DetectionCandidate[] = faces.map((face) => ({
      face,
      matched: false,
    }))

    // Try to match each existing track to a detection
    for (const track of this.tracks.values()) {
      if (track.state === 'EXPIRED') continue

      let bestMatch: DetectionCandidate | null = null
      let bestIoU = 0
      let bestCenterDist = Infinity

      for (const candidate of candidates) {
        if (candidate.matched) continue

        const iou = calculateIoU(track.face.boundingBox, candidate.face.boundingBox)
        const centerDist = calculateCenterDistance(track.face.boundingBox, candidate.face.boundingBox)

        // Prefer IoU match, fall back to center distance
        if (iou >= this.config.iouThreshold && iou > bestIoU) {
          bestIoU = iou
          bestMatch = candidate
        } else if (iou === 0 && centerDist < this.config.centerDistanceThreshold && centerDist < bestCenterDist) {
          bestCenterDist = centerDist
          bestMatch = candidate
        }
      }

      if (bestMatch) {
        // Match found - update track
        bestMatch.matched = true
        const matchedFace = bestMatch.face
        track.face = {
          ...matchedFace,
          trackId: track.trackId,
          state: 'ACTIVE',
          firstSeenAt: track.face.firstSeenAt,
          lastSeenAt: this.frameTimestamp,
          framesSinceDetection: 0,
          consecutiveFramesDetected: track.consecutiveFramesDetected + 1,
        }
        track.state = 'ACTIVE'
        track.framesSinceDetection = 0
        track.consecutiveFramesDetected++
      } else {
        // No match - track is lost this frame
        track.framesSinceDetection++
        if (track.state === 'ACTIVE') {
          if (track.framesSinceDetection >= this.config.lostToleranceFrames) {
            track.state = 'TEMPORARILY_LOST'
          }
        }
        if (track.framesSinceDetection >= this.config.expirationFrames) {
          track.state = 'EXPIRED'
        }
      }
    }

    // Create new tracks for unmatched detections
    for (const candidate of candidates) {
      if (candidate.matched) continue
      if (this.tracks.size >= this.config.maxTracks) break

      const trackId = this.nextTrackId++
      const trackedFace = createTrackedFace(candidate.face, trackId, this.frameTimestamp)
      this.tracks.set(trackId, {
        trackId,
        face: trackedFace,
        state: 'ACTIVE',
        framesSinceDetection: 0,
        consecutiveFramesDetected: 1,
      })
    }

    // Clean up expired tracks
    for (const [trackId, track] of this.tracks.entries()) {
      if (track.state === 'EXPIRED') {
        this.tracks.delete(trackId)
      }
    }

    // Return only ACTIVE tracks that are stable enough
    const result: TrackedFace[] = []
    for (const track of this.tracks.values()) {
      if (track.state === 'ACTIVE' && track.consecutiveFramesDetected >= this.config.stabilityFrames) {
        result.push(track.face)
      }
    }

    return result
  }

  /** Reset all tracking state. */
  reset(): void {
    this.tracks.clear()
    this.nextTrackId = 1
    this.frameTimestamp = 0
  }

  /** Get all tracks including temporarily lost ones (for debugging/visualization). */
  getAllTracks(): TrackedFace[] {
    const result: TrackedFace[] = []
    for (const track of this.tracks.values()) {
      if (track.state !== 'EXPIRED') {
        result.push(track.face)
      }
    }
    return result
  }

  /** Get tracking statistics. */
  getStats(): { active: number; temporarilyLost: number; expired: number; total: number } {
    let active = 0
    let temporarilyLost = 0
    let expired = 0
    for (const track of this.tracks.values()) {
      if (track.state === 'ACTIVE') active++
      else if (track.state === 'TEMPORARILY_LOST') temporarilyLost++
      else if (track.state === 'EXPIRED') expired++
    }
    return { active, temporarilyLost, expired, total: this.tracks.size }
  }
}

/** Smooths bounding boxes across frames and keeps tracking IDs stable. */
export class ExponentialSmoothingTracker implements FaceTrackingEngine {
  private previous = new Map<number, DetectedFace>()
  private readonly alpha: number

  constructor(alpha: number = 0.35) {
    this.alpha = alpha
  }

  update(faces: DetectedFace[]): TrackedFace[] {
    const smoothed = faces.map((face) => {
      const prev = this.previous.get(face.trackingId)
      if (!prev) return {
        ...face,
        trackId: face.trackingId,
        state: 'ACTIVE' as const,
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        framesSinceDetection: 0,
        consecutiveFramesDetected: 1,
      }
      const a = this.alpha
      const smoothedFace = {
        ...face,
        boundingBox: {
          x: prev.boundingBox.x + a * (face.boundingBox.x - prev.boundingBox.x),
          y: prev.boundingBox.y + a * (face.boundingBox.y - prev.boundingBox.y),
          width: prev.boundingBox.width + a * (face.boundingBox.width - prev.boundingBox.width),
          height:
            prev.boundingBox.height + a * (face.boundingBox.height - prev.boundingBox.height),
        },
      }
      // Ensure TrackedFace properties are present
      return {
        ...smoothedFace,
        trackId: face.trackingId,
        state: 'ACTIVE' as const,
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        framesSinceDetection: 0,
        consecutiveFramesDetected: 1,
      } as TrackedFace
    })
    this.previous = new Map(smoothed.map((f) => [f.trackingId, f]))
    return smoothed
  }

  reset(): void {
    this.previous.clear()
  }
}

/** Minimal tracker that only validates input (for unconfigured mode). */
export class NullTrackingEngine implements FaceTrackingEngine {
  update(faces: DetectedFace[]): TrackedFace[] {
    // Return faces as-is but ensure they have trackId
    return faces.map((face, index) => ({
      ...face,
      trackId: face.trackingId ?? index + 1,
      state: 'ACTIVE' as const,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      framesSinceDetection: 0,
      consecutiveFramesDetected: 1,
    }))
  }

  reset(): void {
    // No-op
  }
}

export type FaceTrackingEngine = {
  update(faces: DetectedFace[]): TrackedFace[]
  reset(): void
  getAllTracks?(): TrackedFace[]
  getStats?(): { active: number; temporarilyLost: number; expired: number; total: number }
}

export interface FaceTrackingService {
  track(input: TrackFacesInput): TrackedFace[]
  reset(): void
}

export class EngineBackedFaceTrackingService implements FaceTrackingService {
  private readonly engine: FaceTrackingEngine

  constructor(engine: FaceTrackingEngine = new IoUTrackingEngine()) {
    this.engine = engine
  }

  track(input: TrackFacesInput): TrackedFace[] {
    const { faces } = parseOrThrow('FaceTracking', trackFacesInputSchema, input)
    return this.engine.update(faces)
  }

  reset(): void {
    this.engine.reset()
  }
}

export class UnconfiguredFaceTrackingService implements FaceTrackingService {
  private readonly engine = new NullTrackingEngine()

  track(input: TrackFacesInput): TrackedFace[] {
    return this.engine.update(parseOrThrow('FaceTracking', trackFacesInputSchema, input).faces)
  }

  reset(): void {
    this.engine.reset()
  }
}