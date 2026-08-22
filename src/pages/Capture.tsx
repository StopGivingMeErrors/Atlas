import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Camera,
  CameraOff,
  ImagePlus,
  Loader2,
  ScanFace,
  Search,
  UserCheck,
  UserPlus,
  UserX,
} from 'lucide-react'
import type { DetectedFace, IdentityCandidate } from '../types'
import {
  createFaceDetectionProvider,
  ExponentialSmoothingTracker,
} from '../services/faceDetection'
import { identityResolutionService } from '../services/identityResolution'
import { cn, pct } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import { Button, ConfidenceBadge, Panel, PanelHeader, Pill } from '../components/ui/primitives'

type FeedState = 'idle' | 'requesting' | 'live' | 'denied' | 'image'
type ResolutionState = 'idle' | 'searching' | 'candidates' | 'unresolved'

export function Capture() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [feedState, setFeedState] = useState<FeedState>('idle')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [faces, setFaces] = useState<DetectedFace[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [resolution, setResolution] = useState<ResolutionState>('idle')
  const [candidates, setCandidates] = useState<IdentityCandidate[]>([])
  const [confirmedId, setConfirmedId] = useState<string | null>(null)

  const detecting = feedState === 'live' || feedState === 'image'

  useEffect(() => {
    if (!detecting) return
    const provider = createFaceDetectionProvider()
    const tracker = new ExponentialSmoothingTracker()
    let cancelled = false
    let raf = 0
    const tick = async () => {
      const detected = await provider.detect({ width: 1280, height: 720, timestamp: performance.now() })
      if (cancelled) return
      setFaces(tracker.update(detected))
      raf = window.setTimeout(tick, 66)
    }
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(raf)
      setFaces([])
    }
  }, [detecting])

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const startCamera = useCallback(async () => {
    setFeedState('requesting')
    setImageUrl(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setFeedState('live')
    } catch {
      setFeedState('denied')
    }
  }, [])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setFeedState('idle')
    setSelectedId(null)
    setResolution('idle')
  }, [])

  const onUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setImageUrl(URL.createObjectURL(file))
    setFeedState('image')
    setSelectedId(null)
    setResolution('idle')
  }, [])

  const selectFace = useCallback((trackingId: number) => {
    setSelectedId(trackingId)
    setResolution('idle')
    setCandidates([])
    setConfirmedId(null)
  }, [])

  const searchProvider = useCallback(async () => {
    setResolution('searching')
    const found = await identityResolutionService.findCandidates('subj-3')
    if (found.length > 0) {
      setCandidates(found)
      setResolution('candidates')
    } else {
      setResolution('unresolved')
    }
  }, [])

  const confirmCandidate = useCallback(async (candidate: IdentityCandidate) => {
    await identityResolutionService.confirmCandidate(candidate.id)
    setConfirmedId(candidate.id)
  }, [])

  const selectedFace = faces.find((f) => f.trackingId === selectedId) ?? null

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Capture"
        description="Detect and select subjects from live video or uploaded media"
        actions={
          <>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onUpload} />
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              <ImagePlus size={14} />
              Upload image
            </Button>
            {feedState === 'live' ? (
              <Button variant="danger" onClick={stopCamera}>
                <CameraOff size={14} />
                Stop camera
              </Button>
            ) : (
              <Button variant="primary" onClick={startCamera} disabled={feedState === 'requesting'}>
                <Camera size={14} />
                {feedState === 'requesting' ? 'Requesting…' : 'Start camera'}
              </Button>
            )}
          </>
        }
      />

      <div className="grid flex-1 grid-cols-1 gap-5 p-6 xl:grid-cols-[1fr_340px]">
        {/* Analysis canvas */}
        <Panel className="relative flex min-h-[420px] items-center justify-center overflow-hidden bg-black">
          {feedState === 'idle' && (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-edge bg-surface-2 text-ink-muted">
                <ScanFace size={20} strokeWidth={1.5} />
              </div>
              <p className="text-sm font-medium text-ink-secondary">No subjects detected yet</p>
              <p className="max-w-xs text-xs text-ink-muted">
                Start by uploading an image or opening the camera. Detection runs locally through
                the configured vision provider.
              </p>
            </div>
          )}

          {feedState === 'requesting' && (
            <div className="flex flex-col items-center gap-3 text-ink-muted">
              <Loader2 size={20} className="animate-spin" />
              <p className="text-xs">Requesting camera access…</p>
            </div>
          )}

          {feedState === 'denied' && (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-danger/30 bg-danger-muted text-danger">
                <CameraOff size={20} strokeWidth={1.5} />
              </div>
              <p className="text-sm font-medium text-ink">Camera access is required to analyze live video</p>
              <p className="max-w-xs text-xs text-ink-muted">
                Your browser blocked the camera. Grant permission and retry, or continue by
                uploading an image instead.
              </p>
              <div className="mt-1 flex gap-2">
                <Button variant="primary" onClick={startCamera}>
                  Retry
                </Button>
                <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  Upload image instead
                </Button>
              </div>
            </div>
          )}

          <div className={cn('scanline relative h-full w-full', !detecting && 'hidden')}>
            <video
              ref={videoRef}
              muted
              playsInline
              className={cn('h-full w-full object-cover', feedState !== 'live' && 'hidden')}
            />
            {feedState === 'image' && imageUrl && (
              <img src={imageUrl} alt="Uploaded evidence" className="h-full w-full object-contain" />
            )}

            {/* Detection overlay */}
            {faces.map((face) => {
              const isSelected = face.trackingId === selectedId
              return (
                <button
                  key={face.trackingId}
                  onClick={() => selectFace(face.trackingId)}
                  className={cn(
                    'absolute rounded-sm border transition-colors duration-150',
                    isSelected
                      ? 'animate-detection-pulse border-accent bg-accent/5'
                      : 'border-white/50 hover:border-accent/80',
                  )}
                  style={{
                    left: `${face.boundingBox.x * 100}%`,
                    top: `${face.boundingBox.y * 100}%`,
                    width: `${face.boundingBox.width * 100}%`,
                    height: `${face.boundingBox.height * 100}%`,
                  }}
                  aria-label={`Select subject ${face.trackingId}`}
                >
                  <span
                    className={cn(
                      'absolute -top-6 left-0 whitespace-nowrap rounded-sm px-1.5 py-0.5 font-mono text-[10px] tracking-wide',
                      isSelected ? 'bg-accent text-black' : 'bg-black/70 text-white/80',
                    )}
                  >
                    SUBJECT {String(face.trackingId).padStart(2, '0')} · {pct(face.confidence)}
                  </span>
                </button>
              )
            })}

            <div className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-white/70">
              {feedState === 'live' ? 'LIVE' : 'STILL'} · {faces.length} face{faces.length === 1 ? '' : 's'} detected ·
              Demo Detection Provider
            </div>
          </div>
        </Panel>

        {/* Detected subjects + identity resolution */}
        <div className="space-y-5">
          <Panel>
            <PanelHeader title={`Detected subjects (${faces.length})`} />
            {faces.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-ink-muted">
                Detections will appear here once a feed is active.
              </p>
            ) : (
              <ul className="divide-y divide-edge">
                {faces.map((face) => (
                  <li key={face.trackingId}>
                    <button
                      onClick={() => selectFace(face.trackingId)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors',
                        face.trackingId === selectedId ? 'bg-accent-muted' : 'hover:bg-surface-2',
                      )}
                    >
                      <div>
                        <p className="font-mono text-xs font-medium text-ink">
                          SUBJECT {String(face.trackingId).padStart(2, '0')}
                        </p>
                        <p className="text-[11px] text-ink-muted">
                          Face detected · {face.orientation}
                        </p>
                      </div>
                      <span className="font-mono text-xs text-accent">{pct(face.confidence)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {selectedFace && (
            <Panel className="animate-fade-up">
              <PanelHeader
                title="Identity resolution"
                action={<Pill tone="neutral">Detected face</Pill>}
              />
              <div className="space-y-3 p-4">
                {resolution === 'idle' && (
                  <>
                    <p className="text-xs leading-relaxed text-ink-muted">
                      No verified identity associated with this subject. Matching runs only against
                      consented, organization-authorized, or legally accessible records.
                    </p>
                    <div className="grid grid-cols-1 gap-1.5">
                      <Button variant="primary" onClick={searchProvider}>
                        <Search size={13} />
                        Search authorized identity provider
                      </Button>
                      <Button variant="secondary">
                        <UserPlus size={13} />
                        Add known identifier
                      </Button>
                      <Button variant="secondary">
                        <UserCheck size={13} />
                        Link existing person
                      </Button>
                      <Button variant="ghost">
                        <UserX size={13} />
                        Mark as unresolved
                      </Button>
                    </div>
                  </>
                )}

                {resolution === 'searching' && (
                  <div className="flex items-center gap-2 py-4 text-xs text-ink-muted">
                    <Loader2 size={14} className="animate-spin text-accent" />
                    Querying Authorized Identity Directory…
                  </div>
                )}

                {resolution === 'candidates' && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                      {candidates.length} candidate{candidates.length === 1 ? '' : 's'} found — analyst
                      confirmation required
                    </p>
                    {candidates.map((candidate) => {
                      const isConfirmed = candidate.id === confirmedId
                      return (
                        <div
                          key={candidate.id}
                          className={cn(
                            'rounded-md border p-3 transition-colors',
                            isConfirmed ? 'border-ok/40 bg-ok-muted' : 'border-edge bg-surface-2',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-[13px] font-medium text-ink">{candidate.displayName}</p>
                              <p className="text-[11px] text-ink-muted">{candidate.provider}</p>
                            </div>
                            <ConfidenceBadge score={candidate.matchConfidence} />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {candidate.signals.map((signal) => (
                              <Pill key={signal} tone="neutral">
                                {signal}
                              </Pill>
                            ))}
                          </div>
                          <div className="mt-2.5 flex gap-1.5">
                            {isConfirmed ? (
                              <Pill tone="ok">Confirmed by analyst</Pill>
                            ) : (
                              <>
                                <Button size="sm" variant="primary" onClick={() => confirmCandidate(candidate)}>
                                  Confirm identity
                                </Button>
                                <Button size="sm" variant="ghost">
                                  Reject
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {resolution === 'unresolved' && (
                  <p className="py-2 text-xs text-ink-muted">
                    No candidates found in authorized providers. The subject remains unresolved.
                  </p>
                )}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
