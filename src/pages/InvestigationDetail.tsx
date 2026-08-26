import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  FileText,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
} from 'lucide-react'
import {
  useAtlas,
  useAuditEvents,
  useEvidence,
  useInvestigation,
  useProfiles,
  useSources,
  useSubjects,
} from '../api/hooks'
import type { InvestigationSubject, SubjectAuthorization } from '../types'
import { cn, formatDate, formatRelative, formatTime, pct } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import { AuthorizationControl } from '../components/AuthorizationControl'
import {
  AuthorizationBadge,
  Avatar,
  Button,
  EmptyState,
  ErrorPanel,
  IdentityStateBadge,
  Panel,
  PanelHeader,
  Pill,
  Stat,
} from '../components/ui/primitives'

const tabs = ['Subjects', 'Evidence', 'Timeline', 'Sources', 'Activity'] as const
type Tab = (typeof tabs)[number]

const authorizationChoices: readonly SubjectAuthorization[] = [
  'undeclared',
  'authorized',
  'restricted',
]

function EnrollSubjectForm({
  investigationId,
  onCreated,
}: {
  investigationId: string
  onCreated: (subject: InvestigationSubject) => void
}) {
  const { investigations } = useAtlas()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [state, setState] = useState<SubjectAuthorization>('undeclared')
  const [basis, setBasis] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <UserPlus size={14} />
        Enroll subject
      </Button>
    )
  }

  const submit = async () => {
    setError(null)
    if (label.trim() === '') {
      setError('Subject label is required.')
      return
    }
    if ((state === 'authorized' || state === 'restricted') && basis.trim() === '') {
      setError('An authorization basis is required to grant or restrict access.')
      return
    }
    setSaving(true)
    try {
      const subject = await investigations.createSubject({
        investigationId,
        label: label.trim(),
        authorizationState: state,
        authorizationBasis:
          state === 'authorized' || state === 'restricted' ? basis.trim() : undefined,
      })
      setOpen(false)
      onCreated(subject)
      navigate(`/subjects/${subject.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrollment failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel className="w-full max-w-md p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
        Enroll subject
      </p>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Subject label (e.g. CASE-2417 primary)"
        className="mt-2 h-8 w-full rounded-md border border-edge bg-surface-1 px-2 text-xs text-ink outline-none focus:border-accent-dim"
      />
      <select
        value={state}
        onChange={(e) => setState(e.target.value as SubjectAuthorization)}
        className="mt-2 h-8 w-full rounded-md border border-edge bg-surface-1 px-2 text-xs text-ink outline-none focus:border-accent-dim"
      >
        {authorizationChoices.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {(state === 'authorized' || state === 'restricted') && (
        <textarea
          value={basis}
          onChange={(e) => setBasis(e.target.value)}
          placeholder="Authorization basis (consent reference, mandate id…) — recorded in the audit trail"
          rows={2}
          className="mt-2 w-full rounded-md border border-edge bg-surface-1 px-2 py-1.5 text-xs text-ink outline-none focus:border-accent-dim"
        />
      )}
      {error !== null && <p className="mt-2 text-[11px] text-danger">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={() => void submit()} disabled={saving}>
          {saving ? 'Enrolling…' : 'Create subject'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">
        Identity resolution requires an explicitly authorized subject. You can grant
        authorization here with a basis, or later from the workspace.
      </p>
    </Panel>
  )
}

export function InvestigationDetail() {
  const { id } = useParams()
  const [tab, setTab] = useState<Tab>('Subjects')

  const investigation = useInvestigation(id)
  const subjects = useSubjects(id)
  const evidence = useEvidence(id)
  const sources = useSources()
  const profiles = useProfiles()
  const audit = useAuditEvents()

  if (investigation.error !== null && investigation.error.code === 'not_found') {
    return (
      <EmptyState
        icon={<ShieldAlert size={18} />}
        title="Investigation not found"
        description="It may have been archived, or you may not have access."
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

  const inv = investigation.data
  const invSubjects = subjects.data ?? []
  const invEvidence = [...(evidence.data ?? [])].sort((a, b) =>
    b.capturedAt.localeCompare(a.capturedAt),
  )
  const sourceById = new Map((sources.data ?? []).map((s) => [s.id, s]))
  const profileById = new Map((profiles.data ?? []).map((p) => [p.id, p]))
  const invActivity = (audit.data ?? []).filter(
    (event) =>
      event.resourceType === 'investigation_subject' ||
      event.resourceType === 'identity_candidate' ||
      event.resourceId === id,
  )

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link to="/investigations" className="text-ink-muted transition-colors hover:text-ink">
              <ArrowLeft size={15} />
            </Link>
            {inv ? inv.title : 'Investigation'}
          </span>
        }
        description={
          inv
            ? `Created by ${inv.createdBy} · ${formatDate(inv.createdAt)}`
            : 'Loading investigation…'
        }
        actions={
          inv && (
            <>
              <Pill
                tone={
                  inv.riskLevel === 'low'
                    ? 'neutral'
                    : inv.riskLevel === 'medium'
                      ? 'warn'
                      : 'danger'
                }
                className="capitalize"
              >
                {inv.riskLevel} risk
              </Pill>
              <Pill tone={inv.status === 'active' ? 'accent' : 'neutral'} className="capitalize">
                {inv.status.replace('_', ' ')}
              </Pill>
            </>
          )
        }
      />

      <div className="space-y-5 p-6">
        {(investigation.error !== null ||
          subjects.error !== null ||
          evidence.error !== null) && (
          <ErrorPanel
            error={
              (subjects.error ?? evidence.error ?? investigation.error) as NonNullable<
                typeof subjects.error
              >
            }
          />
        )}

        {inv && (
          <Panel className="p-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Subjects" value={invSubjects.length} />
              <Stat label="Evidence items" value={invEvidence.length} />
              <Stat label="Last activity" value={formatRelative(inv.updatedAt)} />
              <Stat label="Authorization" value="Per subject" sub="See each subject's record" />
            </div>
            <p className="mt-4 border-t border-edge pt-3 text-[13px] leading-relaxed text-ink-secondary">
              {inv.description}
            </p>
          </Panel>
        )}

        <nav className="flex gap-1 border-b border-edge">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'border-b-2 px-3 py-2 text-[13px] transition-colors',
                tab === t
                  ? 'border-accent font-medium text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink-secondary',
              )}
            >
              {t}
            </button>
          ))}
        </nav>

        {tab === 'Subjects' && (
          <div className="space-y-4">
            <div>
              {inv && (
                <EnrollSubjectForm
                  investigationId={inv.id}
                  onCreated={() => {
                    subjects.reload()
                  }}
                />
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {subjects.loading && (
                <div className="col-span-full flex items-center gap-2 py-6 text-xs text-ink-muted">
                  <Loader2 size={14} className="animate-spin" /> Loading subjects…
                </div>
              )}
              {!subjects.loading && invSubjects.length === 0 && (
                <EmptyState
                  icon={<ShieldCheck size={18} />}
                  title="No subjects yet"
                  description="Enroll a subject above, then capture media and run identity matching from its workspace."
                />
              )}
              {invSubjects.map((subject) => {
                const profile =
                  subject.profileId !== null ? profileById.get(subject.profileId) : undefined
                return (
                  <Panel key={subject.id} className="animate-fade-up p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {profile ? (
                          <Avatar initials={profile.initials} color={profile.avatarColor} size="lg" />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-edge-strong font-mono text-[10px] text-ink-muted">
                            {subject.label.split(' ')[1]}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium">
                            {profile ? profile.canonicalName : subject.label}
                          </p>
                          <p className="font-mono text-[11px] uppercase text-ink-muted">
                            {subject.label}
                          </p>
                        </div>
                      </div>
                      <IdentityStateBadge state={subject.identityState} />
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <AuthorizationBadge state={subject.authorizationState} />
                      <span className="text-[11px] text-ink-muted">
                        {subject.evidenceCount} evidence items
                      </span>
                    </div>

                    {subject.authorizationBasis !== '' && (
                      <div className="mt-3 rounded-md border border-edge bg-surface-2 p-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                          Authorization basis
                        </p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">
                          {subject.authorizationBasis}
                        </p>
                      </div>
                    )}

                    <AuthorizationControl subjectId={subject.id} state={subject.authorizationState} />

                    <div className="mt-3 flex items-center justify-between border-t border-edge pt-3">
                      <span className="text-[11px] text-ink-muted">
                        Active {formatRelative(subject.lastActivityAt)}
                      </span>
                      <div className="flex items-center gap-2">
                        <Link to={`/subjects/${subject.id}`}>
                          <Button size="sm" variant="secondary">
                            Open workspace
                          </Button>
                        </Link>
                        {profile && (
                          <Link to={`/people/${profile.id}`}>
                            <Button size="sm" variant="secondary">
                              Profile
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  </Panel>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'Evidence' && (
          <Panel>
            <PanelHeader title={`Evidence (${invEvidence.length})`} />
            {evidence.loading && (
              <div className="flex items-center gap-2 px-4 py-6 text-xs text-ink-muted">
                <Loader2 size={14} className="animate-spin" /> Loading evidence…
              </div>
            )}
            {!evidence.loading && invEvidence.length === 0 && (
              <EmptyState
                icon={<FileText size={18} />}
                title="No evidence captured yet"
                description="Evidence is captured through research runs and analyst notes with full provenance."
              />
            )}
            <ul className="divide-y divide-edge">
              {invEvidence.map((item) => {
                const source = sourceById.get(item.sourceId)
                return (
                  <li key={item.id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[13px] text-ink">{item.claim}</p>
                      <p className="mt-0.5 text-[11px] text-ink-muted">
                        {source?.sourceName ?? item.sourceId} · captured{' '}
                        {formatDate(item.capturedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Pill tone="neutral" className="capitalize">
                        {item.evidenceType.replace('_', ' ')}
                      </Pill>
                      <span className="font-mono text-xs text-ink-secondary">
                        {pct(item.confidence)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Panel>
        )}

        {tab === 'Timeline' && (
          <Panel>
            <PanelHeader title="Case timeline" />
            {invEvidence.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-ink-muted">No events yet.</p>
            ) : (
              <ul className="divide-y divide-edge">
                {invEvidence.map((item) => (
                  <li key={item.id} className="flex gap-4 px-4 py-3">
                    <span className="w-24 shrink-0 font-mono text-[11px] text-ink-muted">
                      {formatDate(item.capturedAt)}
                    </span>
                    <p className="text-[13px] text-ink-secondary">{item.claim}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {tab === 'Sources' && (
          <Panel>
            <PanelHeader title="Sources referenced in this case" />
            <ul className="divide-y divide-edge">
              {[...new Set(invEvidence.map((e) => e.sourceId))].map((sourceId) => {
                const source = sourceById.get(sourceId)
                if (!source) return null
                return (
                  <li key={sourceId} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <a
                        href={source.canonicalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-[13px] font-medium text-ink hover:text-accent"
                      >
                        {source.sourceName}
                      </a>
                      <p className="text-[11px] text-ink-muted">{source.provider}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-[11px] text-ink-muted">
                      <Pill tone="neutral">Credibility {pct(source.credibilityScore)}</Pill>
                      <span>Retrieved {formatRelative(source.retrievedAt)}</span>
                    </div>
                  </li>
                )
              })}
              {invEvidence.length === 0 && (
                <li className="px-4 py-6 text-center text-xs text-ink-muted">
                  No sources referenced yet.
                </li>
              )}
            </ul>
          </Panel>
        )}

        {tab === 'Activity' && (
          <Panel>
            <PanelHeader title="Case activity (durable audit trail)" />
            {audit.loading && (
              <div className="flex items-center gap-2 px-4 py-6 text-xs text-ink-muted">
                <Loader2 size={14} className="animate-spin" /> Loading audit trail…
              </div>
            )}
            {!audit.loading && invActivity.length === 0 && (
              <EmptyState
                icon={<ShieldCheck size={18} />}
                title="No recorded activity for this case"
                description="Subject authorization changes and identity decisions are recorded here."
              />
            )}
            <ul className="divide-y divide-edge">
              {invActivity.map((event) => (
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
          </Panel>
        )}
      </div>
    </div>
  )
}
