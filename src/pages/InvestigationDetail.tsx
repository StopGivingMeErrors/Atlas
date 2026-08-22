import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, ShieldAlert, ShieldCheck } from 'lucide-react'
import { activity, evidence, investigations, profiles, sources, subjects } from '../data/seed'
import { cn, formatDate, formatRelative, formatTime, pct } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import {
  Avatar,
  Button,
  ConfidenceBadge,
  EmptyState,
  IdentityStateBadge,
  Panel,
  PanelHeader,
  Pill,
  Stat,
} from '../components/ui/primitives'

const tabs = ['Subjects', 'Evidence', 'Timeline', 'Sources', 'Activity'] as const
type Tab = (typeof tabs)[number]

export function InvestigationDetail() {
  const { id } = useParams()
  const [tab, setTab] = useState<Tab>('Subjects')
  const investigation = investigations.find((inv) => inv.id === id)

  if (!investigation) {
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

  const invSubjects = subjects.filter((s) => s.investigationId === investigation.id)
  const invEvidence = evidence.filter((e) => e.investigationId === investigation.id)
  const invActivity = activity.filter((a) =>
    a.detail.toLowerCase().includes(investigation.title.split('—')[0].trim().toLowerCase().slice(0, 12)),
  )

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link to="/investigations" className="text-ink-muted transition-colors hover:text-ink">
              <ArrowLeft size={15} />
            </Link>
            {investigation.title}
          </span>
        }
        description={`Created by ${investigation.createdBy} · ${formatDate(investigation.createdAt)}`}
        actions={
          <>
            <Pill tone={investigation.riskLevel === 'low' ? 'neutral' : investigation.riskLevel === 'medium' ? 'warn' : 'danger'} className="capitalize">
              {investigation.riskLevel} risk
            </Pill>
            <Pill tone={investigation.status === 'active' ? 'accent' : 'neutral'} className="capitalize">
              {investigation.status.replace('_', ' ')}
            </Pill>
          </>
        }
      />

      <div className="space-y-5 p-6">
        <Panel className="p-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Subjects" value={invSubjects.length} />
            <Stat label="Evidence items" value={invEvidence.length} />
            <Stat label="Last activity" value={formatRelative(investigation.updatedAt)} />
            <Stat label="Authorization" value="On record" sub="See subject basis" />
          </div>
          <p className="mt-4 border-t border-edge pt-3 text-[13px] leading-relaxed text-ink-secondary">
            {investigation.description}
          </p>
        </Panel>

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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {invSubjects.map((subject) => {
              const profile = profiles.find((p) => p.id === subject.profileId)
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
                        <p className="font-mono text-[11px] uppercase text-ink-muted">{subject.label}</p>
                      </div>
                    </div>
                    <IdentityStateBadge state={subject.identityState} />
                  </div>

                  {profile && (
                    <div className="mt-3 flex items-center gap-2">
                      <ConfidenceBadge score={profile.confidenceScore} />
                      <span className="text-[11px] text-ink-muted">
                        {subject.evidenceCount} evidence items
                      </span>
                    </div>
                  )}

                  <div className="mt-3 rounded-md border border-edge bg-surface-2 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                      Authorization basis
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">
                      {subject.authorizationBasis}
                    </p>
                    <Pill tone="ok" className="mt-1.5 capitalize">
                      {subject.consentStatus.replace('_', ' ')}
                    </Pill>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-edge pt-3">
                    <span className="text-[11px] text-ink-muted">
                      Active {formatRelative(subject.lastActivityAt)}
                    </span>
                    {profile ? (
                      <Link to={`/people/${profile.id}`}>
                        <Button size="sm" variant="secondary">
                          Open profile
                        </Button>
                      </Link>
                    ) : (
                      <Button size="sm" variant="secondary" disabled>
                        Unresolved
                      </Button>
                    )}
                  </div>
                </Panel>
              )
            })}
          </div>
        )}

        {tab === 'Evidence' && (
          <Panel>
            <PanelHeader title={`Evidence (${invEvidence.length})`} />
            {invEvidence.length === 0 ? (
              <EmptyState
                icon={<FileText size={18} />}
                title="No evidence captured yet"
                description="Evidence is added automatically when research runs complete, or manually by analysts."
              />
            ) : (
              <ul className="divide-y divide-edge">
                {invEvidence.map((item) => {
                  const source = sources.find((s) => s.id === item.sourceId)
                  return (
                    <li key={item.id} className="flex items-start justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[13px] text-ink">{item.claim}</p>
                        <p className="mt-0.5 text-[11px] text-ink-muted">
                          {source?.sourceName} · captured {formatDate(item.capturedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Pill tone="neutral" className="capitalize">
                          {item.evidenceType.replace('_', ' ')}
                        </Pill>
                        <span className="font-mono text-xs text-ink-secondary">{pct(item.confidence)}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        )}

        {tab === 'Timeline' && (
          <Panel>
            <PanelHeader title="Case timeline" />
            <ul className="divide-y divide-edge">
              {[...invEvidence]
                .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
                .map((item) => (
                  <li key={item.id} className="flex gap-4 px-4 py-3">
                    <span className="w-24 shrink-0 font-mono text-[11px] text-ink-muted">
                      {formatDate(item.capturedAt)}
                    </span>
                    <p className="text-[13px] text-ink-secondary">{item.claim}</p>
                  </li>
                ))}
            </ul>
          </Panel>
        )}

        {tab === 'Sources' && (
          <Panel>
            <PanelHeader title="Sources referenced in this case" />
            <ul className="divide-y divide-edge">
              {sources
                .filter((s) => invEvidence.some((e) => e.sourceId === s.id))
                .map((source) => (
                  <li key={source.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">{source.sourceName}</p>
                      <p className="text-[11px] text-ink-muted">{source.provider}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-[11px] text-ink-muted">
                      <Pill tone="neutral">Credibility {pct(source.credibilityScore)}</Pill>
                      <span>Retrieved {formatRelative(source.retrievedAt)}</span>
                    </div>
                  </li>
                ))}
            </ul>
          </Panel>
        )}

        {tab === 'Activity' && (
          <Panel>
            <PanelHeader title="Case activity" />
            {invActivity.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck size={18} />}
                title="No recent case activity"
                description="Actions taken within this investigation will appear here."
              />
            ) : (
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
            )}
          </Panel>
        )}
      </div>
    </div>
  )
}
