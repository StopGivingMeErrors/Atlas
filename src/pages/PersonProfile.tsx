import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Download,
  FilePlus2,
  FolderOpen,
  RefreshCw,
  UserX,
} from 'lucide-react'
import type { FactCategory, IntelligenceFact } from '../types'
import {
  activity,
  evidence,
  facts,
  networkEdges,
  networkNodes,
  profiles,
  sources,
  subjects,
  timeline,
} from '../data/seed'
import { researchService } from '../services/research'
import { cn, formatDate, formatRelative, formatTime, pct } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import { EvidenceDrawer } from '../components/EvidenceDrawer'
import { NetworkGraph } from '../components/NetworkGraph'
import {
  Avatar,
  Button,
  ConfidenceBadge,
  EmptyState,
  IdentityStateBadge,
  OriginBadge,
  Panel,
  PanelHeader,
  Pill,
  Skeleton,
} from '../components/ui/primitives'

const tabs = ['Overview', 'Timeline', 'Sources', 'Network', 'Evidence', 'Activity'] as const
type Tab = (typeof tabs)[number]

const categoryLabels: Record<FactCategory, string> = {
  employment: 'Employment',
  education: 'Education',
  organization: 'Organizations',
  public_profile: 'Public profiles',
  website: 'Websites',
  publication: 'Publications',
  social_presence: 'Social presence',
  location: 'Location',
  news_mention: 'News mentions',
}

function FactRow({ fact, onOpen }: { fact: IntelligenceFact; onOpen: (fact: IntelligenceFact) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">{fact.label}</p>
        <p className="mt-0.5 text-[13px] text-ink">{fact.value}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <OriginBadge origin={fact.origin} />
          <ConfidenceBadge score={fact.confidence} showPct={false} />
        </div>
      </div>
      <button
        onClick={() => onOpen(fact)}
        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-muted transition-colors hover:bg-accent-muted hover:text-accent"
      >
        {fact.sourceCount} {fact.sourceCount === 1 ? 'source' : 'sources'}
      </button>
    </div>
  )
}

export function PersonProfile() {
  const { id } = useParams()
  const [tab, setTab] = useState<Tab>('Overview')
  const [openFact, setOpenFact] = useState<IntelligenceFact | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [timelineFilter, setTimelineFilter] = useState<FactCategory | 'all'>('all')

  const profile = profiles.find((p) => p.id === id)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 550)
    return () => clearTimeout(t)
  }, [id])

  const profileFacts = useMemo(() => facts.filter((f) => f.profileId === id), [id])
  const profileTimeline = useMemo(() => timeline.filter((t) => t.profileId === id), [id])
  const profileNodes = useMemo(() => networkNodes.filter((n) => n.profileId === id), [id])

  if (!profile) {
    return (
      <EmptyState
        icon={<UserX size={18} />}
        title="Profile not found"
        description="This intelligence profile does not exist or is outside your organization."
        action={
          <Link to="/people">
            <Button variant="secondary">
              <ArrowLeft size={14} />
              Back to people
            </Button>
          </Link>
        }
      />
    )
  }

  const subject = subjects.find((s) => s.id === profile.subjectId)
  const subjectEvidence = evidence.filter((e) => e.subjectId === profile.subjectId)
  const profileSources = sources.filter((s) =>
    profileFacts.some((f) => f.sourceIds.includes(s.id)),
  )
  const grouped = profileFacts.reduce<Partial<Record<FactCategory, IntelligenceFact[]>>>((acc, fact) => {
    ;(acc[fact.category] ??= []).push(fact)
    return acc
  }, {})

  const refresh = async () => {
    setRefreshing(true)
    await researchService.searchPerson(profile.id)
    setRefreshing(false)
  }

  const filteredTimeline =
    timelineFilter === 'all'
      ? profileTimeline
      : profileTimeline.filter((t) => t.category === timelineFilter)
  const timelineYears = [...new Set(filteredTimeline.map((t) => t.year))].sort((a, b) => b - a)

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link to="/people" className="text-ink-muted transition-colors hover:text-ink">
              <ArrowLeft size={15} />
            </Link>
            {profile.canonicalName}
          </span>
        }
        description={`Last updated ${formatRelative(profile.updatedAt)}`}
        actions={
          <>
            <Button variant="secondary" onClick={refresh} disabled={refreshing}>
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh intelligence'}
            </Button>
            <Button variant="secondary">
              <FilePlus2 size={13} />
              Add evidence
            </Button>
            <Button variant="secondary">
              <Download size={13} />
              Export report
            </Button>
            {subject && (
              <Link to={`/investigations/${subject.investigationId}`}>
                <Button variant="primary">
                  <FolderOpen size={13} />
                  Open investigation
                </Button>
              </Link>
            )}
          </>
        }
      />

      <div className="space-y-5 p-6">
        {/* Profile header */}
        <Panel className="p-5">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar initials={profile.initials} color={profile.avatarColor} size="xl" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">{profile.canonicalName}</h2>
                <IdentityStateBadge state={profile.identityState} />
              </div>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-secondary">
                {profile.summary}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="font-mono text-2xl font-medium text-ink">
                {pct(profile.confidenceScore)}
              </span>
              <ConfidenceBadge score={profile.confidenceScore} showPct={false} />
              <span className="text-[11px] text-ink-muted">
                Resolved {formatRelative(profile.lastResolvedAt)}
              </span>
            </div>
          </div>
        </Panel>

        <nav className="flex gap-1 overflow-x-auto border-b border-edge">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'shrink-0 border-b-2 px-3 py-2 text-[13px] transition-colors',
                tab === t
                  ? 'border-accent font-medium text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink-secondary',
              )}
            >
              {t}
            </button>
          ))}
        </nav>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Panel key={i} className="space-y-3 p-4">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-24" />
              </Panel>
            ))}
          </div>
        ) : (
          <>
            {tab === 'Overview' && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Panel className="lg:col-span-2">
                  <PanelHeader title="Identity summary" />
                  <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.08em] text-ink-muted">Identity state</p>
                      <div className="mt-1">
                        <IdentityStateBadge state={profile.identityState} />
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.08em] text-ink-muted">Confidence</p>
                      <p className="mt-1 font-mono text-sm text-ink">{pct(profile.confidenceScore)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.08em] text-ink-muted">Facts on record</p>
                      <p className="mt-1 font-mono text-sm text-ink">{profileFacts.length}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.08em] text-ink-muted">Independent sources</p>
                      <p className="mt-1 font-mono text-sm text-ink">{profileSources.length}</p>
                    </div>
                  </div>
                </Panel>

                {(Object.keys(grouped) as FactCategory[]).map((category) => (
                  <Panel key={category}>
                    <PanelHeader title={categoryLabels[category]} />
                    <div className="divide-y divide-edge">
                      {grouped[category]?.map((fact) => (
                        <FactRow key={fact.id} fact={fact} onOpen={setOpenFact} />
                      ))}
                    </div>
                  </Panel>
                ))}

                <Panel className="lg:col-span-2">
                  <PanelHeader title="Confidence assessment" />
                  <div className="space-y-2.5 p-4">
                    {profileFacts.map((fact) => (
                      <div key={fact.id} className="flex items-center gap-3">
                        <span className="w-56 shrink-0 truncate text-xs text-ink-secondary">
                          {fact.value}
                        </span>
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                          <div
                            className="h-full rounded-full bg-accent/70"
                            style={{ width: pct(fact.confidence) }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right font-mono text-[11px] text-ink-muted">
                          {pct(fact.confidence)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            )}

            {tab === 'Timeline' && (
              <Panel>
                <PanelHeader
                  title="Intelligence timeline"
                  action={
                    <select
                      value={timelineFilter}
                      onChange={(e) => setTimelineFilter(e.target.value as FactCategory | 'all')}
                      className="rounded-md border border-edge bg-surface-2 px-2 py-1 text-xs text-ink-secondary outline-none"
                    >
                      <option value="all">All categories</option>
                      {(Object.keys(categoryLabels) as FactCategory[]).map((c) => (
                        <option key={c} value={c}>
                          {categoryLabels[c]}
                        </option>
                      ))}
                    </select>
                  }
                />
                {filteredTimeline.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-ink-muted">
                    No timeline events match the current filter.
                  </p>
                ) : (
                  <div className="p-4">
                    {timelineYears.map((year) => (
                      <div key={year} className="relative pb-2 pl-6 last:pb-0">
                        <span className="absolute left-0 top-0.5 font-mono text-xs font-semibold text-accent">
                          {year}
                        </span>
                        <div className="ml-10 space-y-3 border-l border-edge pb-3 pl-5">
                          {filteredTimeline
                            .filter((t) => t.year === year)
                            .map((event) => (
                              <div key={event.id} className="relative">
                                <span className="absolute -left-[26px] top-1.5 h-2 w-2 rounded-full border border-accent bg-canvas" />
                                <p className="text-[13px] text-ink">{event.title}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                                  <Pill tone="neutral" className="capitalize">
                                    {categoryLabels[event.category]}
                                  </Pill>
                                  <Pill
                                    tone={
                                      event.evidenceStrength === 'strong'
                                        ? 'ok'
                                        : event.evidenceStrength === 'moderate'
                                          ? 'warn'
                                          : 'neutral'
                                    }
                                    className="capitalize"
                                  >
                                    {event.evidenceStrength} evidence
                                  </Pill>
                                  <span>
                                    {event.sourceIds.length}{' '}
                                    {event.sourceIds.length === 1 ? 'source' : 'sources'}
                                  </span>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}

            {tab === 'Sources' && (
              <Panel>
                <PanelHeader title={`Sources (${profileSources.length})`} />
                <ul className="divide-y divide-edge">
                  {profileSources.map((source) => (
                    <li key={source.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <a
                          href={source.canonicalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-[13px] font-medium text-ink transition-colors hover:text-accent"
                        >
                          {source.sourceName}
                        </a>
                        <p className="text-[11px] text-ink-muted">
                          {source.provider} · retrieved {formatDate(source.retrievedAt)}
                        </p>
                      </div>
                      <Pill tone="neutral">Credibility {pct(source.credibilityScore)}</Pill>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {tab === 'Network' && (
              <div>
                {profileNodes.length === 0 ? (
                  <EmptyState
                    icon={<UserX size={18} />}
                    title="No relationship data yet"
                    description="Relationships appear as evidence-backed connections are discovered."
                  />
                ) : (
                  <NetworkGraph nodes={profileNodes} edges={networkEdges} />
                )}
              </div>
            )}

            {tab === 'Evidence' && (
              <Panel>
                <PanelHeader title={`Evidence (${subjectEvidence.length})`} />
                <ul className="divide-y divide-edge">
                  {subjectEvidence.map((item) => {
                    const source = sources.find((s) => s.id === item.sourceId)
                    return (
                      <li key={item.id} className="flex items-start justify-between gap-4 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-[13px] text-ink">{item.claim}</p>
                          <p className="mt-0.5 text-[11px] text-ink-muted">
                            {source?.sourceName} · {formatDate(item.capturedAt)}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-xs text-ink-secondary">
                          {pct(item.confidence)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </Panel>
            )}

            {tab === 'Activity' && (
              <Panel>
                <PanelHeader title="Profile activity" />
                <ul className="divide-y divide-edge">
                  {activity.slice(0, 5).map((event) => (
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
          </>
        )}
      </div>

      <EvidenceDrawer fact={openFact} onClose={() => setOpenFact(null)} />
    </div>
  )
}
