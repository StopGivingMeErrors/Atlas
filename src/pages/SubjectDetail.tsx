import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import {
  notReady,
  useAsyncData,
  useAtlas,
  useAuditEvents,
  useEvidenceBySubject,
} from '../api/hooks'
import type { IdentityCandidate } from '../types'
import { cn, formatDate, formatRelative, formatTime, pct } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import { AuthorizationControl } from '../components/AuthorizationControl'
import {
  AuthorizationBadge,
  Button,
  EmptyState,
  ErrorPanel,
  IdentityStateBadge,
  Panel,
  PanelHeader,
  Pill,
  Stat,
} from '../components/ui/primitives'
import { AtlasServiceError } from '../services/errors'
import type { MediaAsset } from '../services/mediaStorage'

type CandidatePhase = 'idle' | 'loading' | 'loaded' | 'error'

export function SubjectDetail() {
  const { id } = useParams()
  const { investigations, identityResolution, mediaStorage } = useAtlas()

  const [candidatePhase, setCandidatePhase] = useState<CandidatePhase>('idle')
  const [candidates, setCandidates] = useState<IdentityCandidate[]>([])
  const [confirmedId, setConfirmedId] = useState<string | null>(null)
  const [candidateError, setCandidateError] = useState<string | null>(null)

  const [media, setMedia] = useState<MediaAsset[] | null>(null)
  const [mediaLoading, setMediaLoading] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)

  const subject = useAsyncData(async () => {
    if (!id) throw notReady()
    return investigations.getSubject({ subjectId: id })
  }, [id, investigations])

  const evidence = useEvidenceBySubject(id)
  const audit = useAuditEvents()

  if (subject.error !== null && subject.error.code === 'not_found') {
    return (
      <EmptyState
        icon={<ShieldAlert size={18} />}
        title="Subject not found"
        description="It may belong to another organization, or the record no longer exists."
        action={
          <Link to="/investigations">
            <Button variant="secondary">
              <ArrowLeft size={14} />
              Back to investigations
            </Button>
          </Link>
        }
      />
    )
  }

  const s = subject.data
  const subjectEvidence = [...(evidence.data ?? [])].sort((a, b) =>
    b.capturedAt.localeCompare(a.capturedAt),
  )
  const activity = s ? (audit.data ?? []).filter((event) => event.resourceId === s.id) : []

  const loadCandidates = async () => {
    if (!s) return
    setCandidateError(null)
    setCandidatePhase('loading')
    try {
      const found = await identityResolution.findCandidates({ subjectId: s.id })
      setCandidates(found)
      setCandidatePhase('loaded')
    } catch (err) {
      setCandidateError(err instanceof AtlasServiceError ? err.displayMessage : 'Failed to load candidates.')
      setCandidatePhase('error')
    }
  }

  const confirmCandidate = async (candidate: IdentityCandidate) => {
    setCandidateError(null)
    try {
      await identityResolution.confirmCandidate({ candidateId: candidate.id })
      setConfirmedId(candidate.id)
    } catch (err) {
      setCandidateError(err instanceof AtlasServiceError ? err.displayMessage : 'Confirmation failed.')
    }
  }

  const rejectCandidate = async (candidate: IdentityCandidate) => {
    setCandidateError(null)
    try {
      await identityResolution.rejectCandidate({ candidateId: candidate.id })
      setCandidates((prev) => prev.filter((c) => c.id !== candidate.id))
    } catch (err) {
      setCandidateError(err instanceof AtlasServiceError ? err.displayMessage : 'Rejection failed.')
    }
  }

  const loadMedia = async () => {
    if (!s) return
    setMediaError(null)
    setMediaLoading(true)
    try {
      const all = await mediaStorage.listByInvestigation({ investigationId: s.investigationId })
      setMedia(all.filter((asset) => asset.subjectId === s.id))
    } catch (err) {
      setMediaError(
        err instanceof AtlasServiceError ? err.displayMessage : 'Failed to load captured media.',
      )
    } finally {
      setMediaLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {s && (
              <Link
                to={`/investigations/${s.investigationId}`}
                className="text-ink-muted transition-colors hover:text-ink"
              >
                <ArrowLeft size={15} />
              </Link>
            )}
            {s ? s.label : 'Subject'}
          </span>
        }
        description={
          s
            ? `Enrolled ${formatDate(s.createdAt)} · active ${formatRelative(s.lastActivityAt)}`
            : 'Loading subject…'
        }
        actions={
          s && (
            <>
              <IdentityStateBadge state={s.identityState} />
              <AuthorizationBadge state={s.authorizationState} />
            </>
          )
        }
      />

      <div className="space-y-5 p-6">
        {(subject.error !== null || evidence.error !== null) && (
          <ErrorPanel
            error={(evidence.error ?? subject.error) as NonNullable<typeof evidence.error>}
          />
        )}

        {s && (
          <>
            <Panel className="p-4">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Stat
                  label="Authorization"
                  value={<span className="capitalize">{s.authorizationState}</span>}
                />
                <Stat
                  label="Identity"
                  value={<span className="capitalize">{s.identityState.replace('_', ' ')}</span>}
                />
                <Stat label="Evidence items" value={subjectEvidence.length} />
                <Stat label="Last activity" value={formatRelative(s.lastActivityAt)} />
              </div>
              {s.authorizationBasis !== '' && (
                <div className="mt-4 rounded-md border border-edge bg-surface-2 p-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                    Authorization basis
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">
                    {s.authorizationBasis}
                  </p>
                </div>
              )}
              <div className="mt-3 border-t border-edge pt-3">
                <AuthorizationControl subjectId={s.id} state={s.authorizationState} />
              </div>
            </Panel>

            {/* Identity matching + analyst review */}
            <Panel className="animate-fade-up">
              <PanelHeader
                title="Identity matching"
                action={
                  <Link to={`/capture?investigation=${s.investigationId}&subject=${s.id}`}>
                    <Button size="sm" variant="secondary">
                      <Camera size={13} />
                      Capture &amp; match media
                    </Button>
                  </Link>
                }
              />
              <div className="space-y-3 p-4">
                {s.authorizationState !== 'authorized' ? (
                  <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-muted p-2.5">
                    <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warn" />
                    <p className="text-xs leading-relaxed text-warn">
                      This subject is not authorized ({s.authorizationState}). Identity resolution
                      and candidate decisions are blocked until access is granted with a recorded
                      basis.
                    </p>
                  </div>
                ) : (
                  <>
                    {candidateError !== null && (
                      <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-muted p-2.5">
                        <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warn" />
                        <p className="text-xs leading-relaxed text-warn">{candidateError}</p>
                      </div>
                    )}
                    {candidatePhase !== 'loading' && candidatePhase !== 'loaded' && (
                      <Button variant="primary" onClick={() => void loadCandidates()}>
                        Load recorded candidates
                      </Button>
                    )}
                    {candidatePhase === 'loading' && (
                      <div className="flex items-center gap-2 py-2 text-xs text-ink-muted">
                        <Loader2 size={14} className="animate-spin text-accent" /> Loading candidates…
                      </div>
                    )}
                    {candidatePhase === 'loaded' && candidates.length === 0 && (
                      <p className="py-1 text-xs text-ink-muted">
                        No candidates recorded yet. Run identity matching from the capture workflow.
                      </p>
                    )}
                    {candidates.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                          {candidates.length} candidate{candidates.length === 1 ? '' : 's'} — analyst
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
                                  <p className="text-[13px] font-medium text-ink">
                                    {candidate.displayName}
                                  </p>
                                  <p className="text-[11px] text-ink-muted">{candidate.provider}</p>
                                </div>
                                <span className="font-mono text-xs text-ink-secondary">
                                  {pct(candidate.matchConfidence)}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                <Pill tone="neutral">Provider candidate</Pill>
                                {candidate.signals.map((signal) => (
                                  <Pill key={signal} tone="neutral">
                                    {signal}
                                  </Pill>
                                ))}
                                {candidate.trackRef !== null && (
                                  <Pill tone="neutral">track {candidate.trackRef}</Pill>
                                )}
                              </div>
                              {candidate.matchedAt != null && (
                                <p className="mt-1.5 text-[10px] text-ink-faint">
                                  Matched {formatDate(candidate.matchedAt)}
                                </p>
                              )}
                              <div className="mt-2.5 flex gap-1.5">
                                {isConfirmed ? (
                                  <Pill tone="ok">
                                    <CheckCircle2 size={11} /> Confirmed by analyst
                                  </Pill>
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
                  </>
                )}
              </div>
            </Panel>

            {/* Captured media */}
            <Panel className="animate-fade-up">
              <PanelHeader
                title={`Captured media${media !== null ? ` (${media.length})` : ''}`}
                action={
                  <Link to={`/capture?investigation=${s.investigationId}&subject=${s.id}`}>
                    <Button size="sm" variant="secondary">
                      <Camera size={13} />
                      Add media
                    </Button>
                  </Link>
                }
              />
              <div className="space-y-3 p-4">
                {mediaError !== null && <p className="text-xs text-danger">{mediaError}</p>}
                {media === null && !mediaLoading && (
                  <Button variant="secondary" onClick={() => void loadMedia()}>
                    Load captured media
                  </Button>
                )}
                {mediaLoading && (
                  <div className="flex items-center gap-2 py-2 text-xs text-ink-muted">
                    <Loader2 size={14} className="animate-spin text-accent" /> Loading media…
                  </div>
                )}
                {media !== null && media.length === 0 && (
                  <p className="text-xs text-ink-muted">
                    No media linked to this subject yet. Captures taken with this subject selected are
                    listed here with their integrity checksum.
                  </p>
                )}
                {media !== null && media.length > 0 && (
                  <ul className="divide-y divide-edge">
                    {media.map((asset) => (
                      <li key={asset.id} className="flex items-start justify-between gap-4 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-[12px] text-ink">
                            {asset.storagePath.split('/').pop()}
                          </p>
                          <p className="mt-0.5 text-[11px] text-ink-muted">
                            {asset.mimeType} · uploaded {formatDate(asset.uploadedAt)}
                            {asset.width !== null && asset.height !== null
                              ? ` · ${asset.width}×${asset.height}`
                              : ''}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                          {asset.checksum !== null ? asset.checksum.slice(0, 12) : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>

            {/* Evidence */}
            <Panel className="animate-fade-up">
              <PanelHeader title={`Linked evidence (${subjectEvidence.length})`} />
              {evidence.loading ? (
                <div className="flex items-center gap-2 px-4 py-6 text-xs text-ink-muted">
                  <Loader2 size={14} className="animate-spin" /> Loading evidence…
                </div>
              ) : subjectEvidence.length === 0 ? (
                <EmptyState
                  icon={<ShieldCheck size={18} />}
                  title="No evidence linked yet"
                  description="Evidence items referencing this subject appear here with full provenance."
                />
              ) : (
                <ul className="divide-y divide-edge">
                  {subjectEvidence.map((item) => (
                    <li key={item.id} className="flex items-start justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[13px] text-ink">{item.claim}</p>
                        <p className="mt-0.5 text-[11px] text-ink-muted">
                          captured {formatDate(item.capturedAt)}
                        </p>
                      </div>
                      <Pill tone="neutral" className="capitalize">
                        {item.evidenceType.replace('_', ' ')}
                      </Pill>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* Activity */}
            <Panel className="animate-fade-up">
              <PanelHeader title="Subject activity (durable audit trail)" />
              {audit.loading ? (
                <div className="flex items-center gap-2 px-4 py-6 text-xs text-ink-muted">
                  <Loader2 size={14} className="animate-spin" /> Loading audit trail…
                </div>
              ) : activity.length === 0 ? (
                <EmptyState
                  icon={<ShieldCheck size={18} />}
                  title="No recorded activity"
                  description="Authorization changes, matches, and decisions on this subject are recorded here."
                />
              ) : (
                <ul className="divide-y divide-edge">
                  {activity.map((event) => (
                    <li key={event.id} className="flex gap-4 px-4 py-3">
                      <span className="w-14 shrink-0 font-mono text-[11px] text-ink-muted">
                        {formatTime(event.timestamp)}
                      </span>
                      <div>
                        <p className="text-[13px] text-ink">{event.action}</p>
                        <p className="text-[11px] text-ink-muted">{event.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}
