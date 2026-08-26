import { describe, expect, it } from 'vitest'
import { EngineBackedFaceTrackingService, ExponentialSmoothingTracker, IoUTrackingEngine } from '../src/services/faceTracking'
import type { DetectedFace } from '../src/types'

function face(trackingId: number, x: number, y: number): DetectedFace {
  return {
    id: `f-${trackingId}-${x}-${y}`,
    trackingId,
    boundingBox: { x, y, width: 100, height: 120 },
    confidence: 0.9,
    orientation: 'frontal',
    frameTimestamp: 0,
  }
}

describe('ExponentialSmoothingTracker', () => {
  it('smooths jittery detections toward the new position instead of snapping', () => {
    const tracker = new ExponentialSmoothingTracker()
    const first = tracker.update([face(1, 100, 100)])[0]
    const second = tracker.update([face(1, 140, 100)])[0]

    // Raw jump is 40px; the smoothed box must move only part of the way.
    expect(second.boundingBox.x).toBeGreaterThan(first.boundingBox.x)
    expect(second.boundingBox.x).toBeLessThan(140)
  })

  it('keeps tracking identity stable across frames', () => {
    const tracker = new ExponentialSmoothingTracker()
    const [a] = tracker.update([face(1, 10, 10)])
    const pair = tracker.update([face(1, 12, 12), face(2, 400, 400)])
    const both = tracker.update([face(1, 14, 14), face(2, 402, 402)])

    expect(pair.map((f) => f.trackingId)).toEqual([1, 2])
    expect(both.map((f) => f.trackingId)).toEqual([a.trackingId, pair[1].trackingId])
  })

  it('stops reporting faces that disappear from the frame', () => {
    const tracker = new ExponentialSmoothingTracker()
    tracker.update([face(1, 10, 10), face(2, 200, 200)])
    const remaining = tracker.update([face(1, 12, 12)])
    expect(remaining.map((f) => f.trackingId)).toEqual([1])
  })

  it('returns an empty array for an empty frame and resets cleanly', () => {
    const tracker = new ExponentialSmoothingTracker()
    expect(tracker.update([])).toEqual([])
    tracker.update([face(1, 5, 5)])
    tracker.reset()
    // After reset there is no history to smooth against.
    const afterReset = tracker.update([face(1, 500, 500)])[0]
    expect(afterReset.boundingBox.x).toBe(500)
  })
})

describe('EngineBackedFaceTrackingService', () => {
  it('validates input through the boundary schema', () => {
    const service = new EngineBackedFaceTrackingService(new IoUTrackingEngine({ stabilityFrames: 1 }))
    const valid = service.track({ faces: [face(1, 0, 0)] })
    expect(valid.length).toBe(1)
    expect(() => service.track({ faces: [] })).not.toThrow()
    // Malformed payloads fail schema validation rather than silently passing.
    expect(() => service.track({ faces: [{ ...face(1, 0, 0), confidence: 7 }] as unknown as DetectedFace[] })).toThrow()
  })
})
