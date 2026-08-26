import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Camera,
  CameraOff,
  ImagePlus,
  Loader2,
  ScanFace,
  Search,
  ShieldAlert,
  Download,
  Fingerprint,
} from 'lucide-react'
import type { DetectedFace, IdentityCandidate } from '../types'
import { useAtlas, useInvestigations, useSubjects } from '../api/hooks'
import { AtlasServiceError, MediaCaptureError, FaceDetectionError } from '../services/errors'
import { cn, pct } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import {
  Button,
  ConfidenceBadge,
  EmptyState,
  Panel,
  PanelHeader,
  Pill,
} from '../components/ui/primitives'

type FeedState = 'idle' | 'requesting' | 'live' | 'denied' | 'image'

/**
 * Explicit detection pipeline states. The UI must always be able to answer
 * "what is the system doing right now" — including when no provider exists.
 */
type PipelineState =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'NO_FACE'
  | 'FACE_DETECTED'
  | 'TRACKING'

type CaptureState = 'idle' | 'capturing' | 'captured' | 'validating' | 'uploading' | 'success' | 'error'

const pipelineCopy: Record<PipelineState, string> = {
  PROVIDER_NOT_CONFIGURED:
    'No vision provider is configured. Detections are unavailable — nothing is being analyzed.',
  NO_FACE: 'Provider active. No face detected in the current frame.',
  FACE_DETECTED: 'Face detected in the current frame.',
  TRACKING: 'Tracking a selected face across frames.',
}

export function Capture() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [feedState, setFeedState] = useState<FeedState>('idle')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [faces, setFaces] = useState<DetectedFace[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [pipeline, setPipeline] = useState<PipelineState>('NO_FACE')

  // Deep-link preselect from the subject workspace (/capture?investigation=…&subject=…).
  const [searchParams] = useSearchParams()
  const appliedParamsRef = useRef(false)

  const [investigationId, setInvestigationId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [resolution, setResolution] = useState<
    'idle' | 'searching' | 'candidates' | 'unresolved'
  >('idle')
  const [candidates, setCandidates] = useState<IdentityCandidate[]>([])
  const [confirmedId, setConfirmedId] = useState<string | null>(null)
  const [resolutionError, setResolutionError] = useState<string | null>(null)
  const [matching, setMatching] = useState(false)

  // Capture workflow state
  const [captureState, setCaptureState] = useState<CaptureState>('idle')
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [capturedMedia, setCapturedMedia] = useState<{
    blob: Blob
    mimeType: string
    width: number
    height: number
    size: number
    capturedAt: string
  } | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)

  const { faceDetection, faceTracking, identityResolution, mediaCapture, mediaStorage } = useAtlas()
  const investigationsQuery = useInvestigations()
  const subjectsQuery = useSubjects(investigationId === '' ? undefined : investigationId)

  const detecting = feedState === 'live' || feedState === 'image'

  useEffect(() => {
    if (appliedParamsRef.current) return
    const inv = searchParams.get('investigation')
    const sub = searchParams.get('subject')
    if (inv !== null || sub !== null) {
      appliedParamsRef.current = true
      if (inv !== null && inv !== '') setInvestigationId(inv)
      if (sub !== null && sub !== '') setSubjectId(sub)
    }
  }, [searchParams])

  // Attach video element to media capture service when stream is active
  useEffect(() => {
    if (feedState === 'live' && videoRef.current) {
      mediaCapture.attachVideoElement(videoRef.current)
    } else {
      mediaCapture.detachVideoElement()
    }
    return () => {
      mediaCapture.detachVideoElement()
    }
  }, [feedState, mediaCapture])

  // Face detection loop
  useEffect(() => {
    if (!detecting) return
    if (!faceDetection.isConfigured) {
      setPipeline('PROVIDER_NOT_CONFIGURED')
      setFaces([])
      return
    }
    let cancelled = false
    let timer = 0
    let lastDetectionTime = 0
    const DETECTION_INTERVAL_MS = 100 // ~10 FPS for detection

    const captureFrameForDetection = async (): Promise<string | null> => {
      const video = videoRef.current
      if (!video || video.readyState < (HTMLVideoElement as any).HAVE_CURRENT_DATA) {
        return null
      }
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.8).split(',')[1] // base64 without data URL prefix
    }

    const tick = async () => {
      const now = performance.now()
      if (now - lastDetectionTime < DETECTION_INTERVAL_MS) {
        if (!cancelled) timer = window.setTimeout(tick, DETECTION_INTERVAL_MS)
        return
      }
      lastDetectionTime = now

      try {
        const imageBase64 = await captureFrameForDetection()
        if (!imageBase64) {
          if (!cancelled) timer = window.setTimeout(tick, DETECTION_INTERVAL_MS)
          return
        }
        const detected = await faceDetection.detect({
          width: videoRef.current?.videoWidth ?? 1280,
          height: videoRef.current?.videoHeight ?? 720,
          timestamp: performance.now(),
          imageBase64,
        })
        if (cancelled) return
        // Track detected faces across frames using the container's faceTracking service
        const tracked = faceTracking.track({ faces: detected })
        setFaces(tracked)
        setPipeline((prev) =>
          prev === 'TRACKING' || prev === 'FACE_DETECTED'
            ? tracked.length > 0
              ? prev
              : 'NO_FACE'
            : tracked.length > 0
              ? 'FACE_DETECTED'
              : 'NO_FACE',
        )
      } catch (err) {
        if (!cancelled) {
          if (err instanceof AtlasServiceError) {
            if (err.code === 'provider_not_configured') {
              setPipeline('PROVIDER_NOT_CONFIGURED')
            } else if (err instanceof FaceDetectionError) {
              // Face detection specific errors - could display to user
              console.warn('Face detection error:', err.faceDetectionErrorCode, err.displayMessage)
            }
          }
        }
      }
      if (!cancelled) timer = window.setTimeout(tick, DETECTION_INTERVAL_MS)
    }
    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      setFaces([])
      setSelectedId(null)
      setPipeline('NO_FACE')
    }
  }, [detecting, faceDetection, faceTracking])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mediaCapture.stopStream()
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    }
  }, [imageUrl, mediaCapture])

  const startCamera = useCallback(async () => {
    setFeedState('requesting')
    setImageUrl(null)
    setCaptureError(null)
    try {
      await mediaCapture.requestPermission({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      })
      if (videoRef.current) {
        await videoRef.current.play()
      }
      setFeedState('live')
    } catch (err) {
      if (err instanceof MediaCaptureError) {
        setCaptureError(err.displayMessage)
      } else {
        setCaptureError('Failed to start camera.')
      }
      setFeedState('denied')
    }
  }, [mediaCapture])

  const stopCamera = useCallback(() => {
    mediaCapture.stopStream()
    setFeedState('idle')
    setSelectedId(null)
    setResolution('idle')
    setCandidates([])
    setCaptureError(null)
    setCaptureState('idle')
    setCapturedBlob(null)
    setCapturedMedia(null)
  }, [mediaCapture])

  const onUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    mediaCapture.stopStream()
    setFeedState('image')
    setImageUrl(URL.createObjectURL(file))
    setSelectedId(null)
    setResolution('idle')
    setCaptureError(null)
    setCaptureState('idle')
    setCapturedBlob(null)
    setCapturedMedia(null)
  }, [mediaCapture])

  const captureFrame = useCallback(async () => {
    if (!mediaCapture.isStreaming) {
      setCaptureError('No active camera stream.')
      return
    }
    setCaptureError(null)
    setCaptureState('capturing')
    try {
      const media = await mediaCapture.captureFrame()
      setCapturedBlob(media.blob)
      setCapturedMedia(media)
      setCaptureState('captured')
    } catch (err) {
      if (err instanceof MediaCaptureError) {
        setCaptureError(err.displayMessage)
      } else {
        setCaptureError('Capture failed.')
      }
      setCaptureState('error')
    }
  }, [mediaCapture])

  const validateAndStoreCapture = useCallback(async () => {
    if (!capturedBlob || !capturedMedia || !investigationId) {
      setCaptureError('Missing capture data or investigation.')
      return
    }
    setCaptureState('validating')
    try {
      // Validate again before upload (defense in depth)
      await mediaCapture.validateMedia(capturedBlob, capturedMedia.mimeType)
      setCaptureState('uploading')
      if (mediaStorage.isConfigured) {
        await mediaStorage.upload({
          investigationId,
          subjectId: subjectId || null,
          file: capturedBlob,
          fileName: `capture-${Date.now()}.jpg`,
          mimeType: capturedMedia.mimeType,
          metadata: {
            width: capturedMedia.width,
            height: capturedMedia.height,
            capturedAt: capturedMedia.capturedAt,
          },
        })
        setCaptureState('success')
        // Could show asset info or transition to next step
      } else {
        // Storage not configured - still valid capture
        setCaptureState('success')
        setCaptureError('Storage not configured. Capture validated but not persisted.')
      }
    } catch (err) {
      if (err instanceof MediaCaptureError) {
        setCaptureError(err.displayMessage)
      } else if (err instanceof AtlasServiceError) {
        setCaptureError(err.displayMessage)
      } else {
        setCaptureError('Upload failed.')
      }
      setCaptureState('error')
    }
  }, [capturedBlob, capturedMedia, investigationId, subjectId, mediaCapture, mediaStorage])

  const resetCapture = useCallback(() => {
    setCapturedBlob(null)
    setCapturedMedia(null)
    setCaptureState('idle')
    setCaptureError(null)
  }, [])

  const downloadCapture = useCallback(() => {
    if (!capturedBlob || !capturedMedia) return
    const url = URL.createObjectURL(capturedBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `capture-${capturedMedia.capturedAt.replace(/[:.]/g, '-')}.jpg`
    a.click()
    URL.revokeObjectURL(url)
  }, [capturedBlob, capturedMedia])

  // Selecting a tracked face moves the pipeline to TRACKING.
  const selectFace = useCallback((trackingId: number) => {
    setSelectedId(trackingId)
    setPipeline((prev) => (prev === 'PROVIDER_NOT_CONFIGURED' ? prev : 'TRACKING'))
    setResolution('idle')
    setCandidates([])
    setConfirmedId(null)
    setResolutionError(null)
  }, [])

  const selectedFace = faces.find((f) => f.trackingId === selectedId) ?? null

  const searchProvider = useCallback(async () => {
    if (subjectId === '') {
      setResolutionError('Select an investigation and subject before running resolution.')
      return
    }
    setResolutionError(null)
    setResolution('searching')
    try {
      const found = await identityResolution.findCandidates({ subjectId })
      if (found.length > 0) {
        setCandidates(found)
        setResolution('candidates')
      } else {
        setCandidates([])
        setResolution('unresolved')
      }
    } catch (err) {
      setResolution(
        err instanceof AtlasServiceError && err.code === 'authorization_required'
          ? 'idle'
          : 'idle',
      )
      setResolutionError(err instanceof AtlasServiceError ? err.displayMessage : 'Resolution failed.')
    }
  }, [identityResolution, subjectId])

  /** Grabs the current frame (live video or uploaded image) as base64 JPEG. */
  const getMatchFrame = useCallback((): {
    imageBase64: string
    width: number
    height: number
  } | null => {
    if (
      feedState === 'live' &&
      videoRef.current !== null &&
      videoRef.current.videoWidth > 0
    ) {
      const video = videoRef.current
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (ctx === null) return null
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      return {
        imageBase64: canvas.toDataURL('image/jpeg', 0.8).split(',')[1],
        width: canvas.width,
        height: canvas.height,
      }
    }
    if (
      feedState === 'image' &&
      imageRef.current !== null &&
      imageRef.current.complete &&
      imageRef.current.naturalWidth > 0
    ) {
      const img = imageRef.current
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (ctx === null) return null
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      return {
        imageBase64: canvas.toDataURL('image/jpeg', 0.8).split(',')[1],
        width: canvas.width,
        height: canvas.height,
      }
    }
    return null
  }, [feedState])

  /**
   * Runs provider-backed identity matching for the selected face/track and
   * records the returned candidates server-side. Provider-not-configured is
   * surfaced honestly — no fake results are ever shown.
   */
  const matchFace = useCallback(async () => {
    if (selectedFace === null) {
      setResolutionError('Select a detected face before running matching.')
      return
    }
    if (subjectId === '') {
      setResolutionError('Select an investigation and subject before running matching.')
      return
    }
    const frame = getMatchFrame()
    if (frame === null) {
      setResolutionError('No current frame available for matching.')
      return
    }
    setResolutionError(null)
    setMatching(true)
    setResolution('searching')
    try {
      // Provenance first: when storage is configured, the analyzed frame is
      // persisted BEFORE any provider call, so every candidate can point at
      // durable evidence. A storage failure aborts matching — we never make
      // an untraceable provider call.
      let mediaAssetId: string | undefined
      if (mediaStorage.isConfigured && investigationId !== '') {
        try {
          const binary = atob(frame.imageBase64)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          const asset = await mediaStorage.upload({
            investigationId,
            subjectId,
            fileName: `identity-match-frame-${Date.now()}.jpg`,
            mimeType: 'image/jpeg',
            metadata: { source: 'identity_matching', track_id: selectedFace.trackingId },
            file: new Blob([bytes], { type: 'image/jpeg' }),
          })
          mediaAssetId = asset.id
        } catch (storageErr) {
          setResolution('idle')
          setMatching(false)
          setResolutionError(
            storageErr instanceof AtlasServiceError
              ? `Frame could not be stored (${storageErr.displayMessage}) — matching aborted so no untraceable provider call is made.`
              : 'Frame could not be stored — matching aborted so no untraceable provider call is made.',
          )
          return
        }
      }

      const result = await identityResolution.matchIdentity({
        subjectId,
        trackId: selectedFace.trackingId,
        imageBase64: frame.imageBase64,
        frameWidth: frame.width,
        frameHeight: frame.height,
        faceBox: selectedFace.boundingBox,
        mediaAssetId,
      })
      if (result.status === 'not_configured') {
        setCandidates([])
        setConfirmedId(null)
        setResolution('idle')
        setResolutionError(
          'No identity matching endpoint is configured for this deployment or organization — no matching was performed and nothing was recorded.',
        )
        return
      }
      if (result.candidates.length > 0) {
        setCandidates(result.candidates)
        setConfirmedId(null)
        setResolution('candidates')
      } else {
        setCandidates([])
        setConfirmedId(null)
        setResolution('unresolved')
      }
    } catch (err) {
      setResolution('idle')
      setResolutionError(err instanceof AtlasServiceError ? err.displayMessage : 'Matching failed.')
    } finally {
      setMatching(false)
    }
  }, [identityResolution, mediaStorage, investigationId, subjectId, selectedFace, getMatchFrame])

  const confirmCandidate = useCallback(async (candidate: IdentityCandidate) => {
    setResolutionError(null)
    try {
      await identityResolution.confirmCandidate({ candidateId: candidate.id })
      setConfirmedId(candidate.id)
    } catch (err) {
      setResolutionError(err instanceof AtlasServiceError ? err.displayMessage : 'Confirmation failed.')
    }
  }, [identityResolution])

  const rejectCandidate = useCallback(async (candidate: IdentityCandidate) => {
    setResolutionError(null)
    try {
      await identityResolution.rejectCandidate({ candidateId: candidate.id })
      setCandidates((prev) => prev.filter((c) => c.id !== candidate.id))
      if (candidates.length <= 1) setResolution('unresolved')
    } catch (err) {
      setResolutionError(err instanceof AtlasServiceError ? err.displayMessage : 'Rejection failed.')
    }
  }, [identityResolution, candidates.length])

  const providerLabel = faceDetection.providerName ?? 'No provider configured'

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
              <Button variant="primary" onClick={() => void startCamera()} disabled={feedState === 'requesting'}>
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
                Start by uploading an image or opening the camera. Detection runs through the
                configured vision provider.
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
              {captureError && (
                <p className="mt-2 text-xs text-warn">{captureError}</p>
              )}
              <div className="mt-1 flex gap-2">
                <Button variant="primary" onClick={() => void startCamera()}>
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
              <img
                ref={imageRef}
                src={imageUrl}
                alt="Uploaded evidence"
                className="h-full w-full object-contain"
              />
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

            {/* Honest pipeline status overlay */}
            <div className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] space-y-1">
              <div className="rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-white/70">
                {feedState === 'live' ? 'LIVE' : 'STILL'} · {faces.length} face{faces.length === 1 ? '' : 's'} ·{' '}
                {providerLabel}
              </div>
              <div
                className={cn(
                  'inline-block rounded px-2 py-1 text-[10px] font-medium',
                  pipeline === 'PROVIDER_NOT_CONFIGURED'
                    ? 'bg-warn/90 text-black'
                    : pipeline === 'TRACKING'
                      ? 'bg-accent/90 text-black'
                      : 'bg-black/60 text-white/70',
                )}
              >
                {pipeline.replace(/_/g, ' ')} — {pipelineCopy[pipeline]}
              </div>
            </div>
          </div>
        </Panel>

        {/* Case context + identity resolution + capture workflow */}
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Case context" />
            <div className="space-y-3 p-4">
              <div>
                <label htmlFor="cap-inv" className="mb-1 block text-xs font-medium text-ink-secondary">
                  Investigation
                </label>
                <select
                  id="cap-inv"
                  value={investigationId}
                  onChange={(e) => {
                    setInvestigationId(e.target.value)
                    setSubjectId('')
                    setResolution('idle')
                    setCandidates([])
                  }}
                  className="h-9 w-full rounded-md border border-edge bg-surface-2 px-2 text-[13px] text-ink outline-none focus:border-accent-dim"
                >
                  <option value="">Select an investigation…</option>
                  {(investigationsQuery.data ?? []).map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="cap-subject" className="mb-1 block text-xs font-medium text-ink-secondary">
                  Subject
                </label>
                <select
                  id="cap-subject"
                  value={subjectId}
                  onChange={(e) => {
                    setSubjectId(e.target.value)
                    setResolution('idle')
                    setCandidates([])
                  }}
                  disabled={investigationId === ''}
                  className="h-9 w-full rounded-md border border-edge bg-surface-2 px-2 text-[13px] text-ink outline-none focus:border-accent-dim"
                >
                  <option value="">
                    {investigationId === '' ? 'Choose an investigation first…' : 'Select a subject…'}
                  </option>
                  {(subjectsQuery.data ?? []).map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.label} · {subject.authorizationState}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={`Detected faces (${faces.length})`} />
            {faces.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-ink-muted">
                {pipeline === 'PROVIDER_NOT_CONFIGURED'
                  ? 'No vision provider configured.'
                  : 'Detections will appear here once a feed is active.'}
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
                          FACE {String(face.trackingId).padStart(2, '0')}
                        </p>
                        <p className="text-[11px] capitalize text-ink-muted">{face.orientation}</p>
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
                {resolutionError !== null && (
                  <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-muted p-2.5">
                    <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warn" />
                    <p className="text-xs leading-relaxed text-warn">{resolutionError}</p>
                  </div>
                )}

                {resolution === 'idle' && (
                  <>
                    <p className="text-xs leading-relaxed text-ink-muted">
                      No verified identity associated with this face. Matching runs only against
                      consented, organization-authorized, or legally accessible records, and every
                      returned candidate is recorded for analyst review.
                    </p>
                    <div className="grid grid-cols-1 gap-1.5">
                      <Button
                        variant="primary"
                        onClick={() => void matchFace()}
                        disabled={matching || selectedFace === null || subjectId === ''}
                      >
                        <Fingerprint size={13} />
                        {matching ? 'Matching…' : 'Run identity matching'}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void searchProvider()}
                        disabled={subjectId === ''}
                      >
                        <Search size={13} />
                        Review recorded candidates
                      </Button>
                    </div>
                    {!faceDetection.isConfigured && (
                      <p className="text-xs text-warn">
                        No vision provider configured — detections are unavailable. Identity matching
                        uses the identity provider endpoint (VITE_ATLAS_IDENTITY_MATCHING_ENDPOINT or
                        the organization matching URL).
                      </p>
                    )}
                  </>
                )}

                {resolution === 'searching' && (
                  <div className="flex items-center gap-2 py-4 text-xs text-ink-muted">
                    <Loader2 size={14} className="animate-spin text-accent" />
                    {matching
                      ? 'Matching selected face against the authorized provider…'
                      : 'Querying authorized identity directory…'}
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
                            <Pill tone="neutral">Provider candidate</Pill>
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
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => void confirmCandidate(candidate)}
                                >
                                  Confirm identity
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void rejectCandidate(candidate)}
                                >
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
                    No candidates found in authorized providers. The face remains unresolved.
                  </p>
                )}
              </div>
            </Panel>
          )}

          {/* Capture workflow panel */}
          {feedState === 'live' && (
            <Panel className="animate-fade-up">
              <PanelHeader
                title="Media capture"
                action={
                  captureState === 'success' && capturedMedia && (
                    <>
                      <Button variant="secondary" size="sm" onClick={downloadCapture}>
                        <Download size={12} />
                        Download
                      </Button>
                      <Button variant="ghost" size="sm" onClick={resetCapture}>
                        Capture another
                      </Button>
                    </>
                  )
                }
              />
              <div className="space-y-3 p-4">
                {captureError && (
                  <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-muted p-2.5">
                    <ShieldAlert size={14} className="mt-0.5 shrink-0 text-danger" />
                    <p className="text-xs leading-relaxed text-danger">{captureError}</p>
                  </div>
                )}

                {captureState === 'idle' && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs leading-relaxed text-ink-muted">
                      Capture a still frame from the live video stream for evidence or identification.
                    </p>
                    <Button variant="primary" onClick={captureFrame} disabled={!mediaCapture.isStreaming}>
                      <Camera size={13} />
                      Capture frame
                    </Button>
                  </div>
                )}

                {captureState === 'capturing' && (
                  <div className="flex items-center gap-2 py-2 text-xs text-ink-muted">
                    <Loader2 size={14} className="animate-spin text-accent" />
                    Capturing frame…
                  </div>
                )}

                {captureState === 'captured' && capturedMedia && (
                  <div className="space-y-2">
                    <p className="text-xs leading-relaxed text-ink-muted">
                      Frame captured: {capturedMedia.width}×{capturedMedia.height},{' '}
                      {(capturedMedia.size / 1024).toFixed(1)} KB, {capturedMedia.mimeType}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="primary" onClick={validateAndStoreCapture} disabled={!investigationId}>
                        {mediaStorage.isConfigured ? 'Validate & store' : 'Validate (storage not configured)'}
                      </Button>
                      <Button variant="ghost" onClick={resetCapture}>
                        Retake
                      </Button>
                    </div>
                    {!investigationId && (
                      <p className="text-xs text-warn">Select an investigation to enable storage.</p>
                    )}
                  </div>
                )}

                {captureState === 'validating' && (
                  <div className="flex items-center gap-2 py-2 text-xs text-ink-muted">
                    <Loader2 size={14} className="animate-spin text-accent" />
                    Validating media…
                  </div>
                )}

                {captureState === 'uploading' && (
                  <div className="flex items-center gap-2 py-2 text-xs text-ink-muted">
                    <Loader2 size={14} className="animate-spin text-accent" />
                    {mediaStorage.isConfigured ? 'Uploading to storage…' : 'Storage not configured…'}
                  </div>
                )}

                {captureState === 'success' && capturedMedia && (
                  <div className="rounded-md border border-ok/30 bg-ok-muted p-3">
                    <p className="text-xs leading-relaxed text-ok">
                      Media captured and validated successfully.
                    </p>
                    {mediaStorage.isConfigured && (
                      <p className="mt-1 text-xs text-ink-muted">Stored in media assets.</p>
                    )}
                    {!mediaStorage.isConfigured && (
                      <p className="mt-1 text-xs text-warn">Storage not configured — not persisted.</p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <Button variant="secondary" size="sm" onClick={downloadCapture}>
                        <Download size={12} />
                        Download
                      </Button>
                      <Button variant="ghost" size="sm" onClick={resetCapture}>
                        Capture another
                      </Button>
                    </div>
                  </div>
                )}

                {captureState === 'error' && (
                  <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-muted p-2.5">
                    <ShieldAlert size={14} className="mt-0.5 shrink-0 text-danger" />
                    <p className="text-xs leading-relaxed text-danger">
                      {captureError || 'Capture failed.'}
                    </p>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {!selectedFace && detecting && faces.length > 0 && (
            <EmptyState
              icon={<ScanFace size={18} />}
              title="Select a face to begin resolution"
              description="Click a bounding box on the feed or pick a tracked face above."
            />
          )}
        </div>
      </div>
    </div>
  )
}