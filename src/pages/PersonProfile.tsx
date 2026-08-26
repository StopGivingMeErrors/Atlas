import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Download,
  FilePlus2,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  UserX,
} from 'lucide-react'
import type { FactCategory, IntelligenceFact } from '../types'
import {
  useAtlas,
  useAuditEvents,
  useEvidenceBySubject,
  useProfileBundle,
  useSources,
} from '../api/hooks'
import { AtlasServiceError } from '../services/errors'
import type { PublicInformationSearchResult } from '../services/publicInformation'
import type { SearchFailureReason } from '../services/searchRuns'
import { deriveNetwork, deriveTimeline, sourcesForFacts } from '../lib/intelligence'
import { cn, formatDate, formatRelative, formatTime, pct } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import { EvidenceDrawer } from '../components/EvidenceDrawer'
import { NetworkGraph } from '../components/NetworkGraph'
import {
  Avatar,
  Button,
  ConfidenceBadge,
  EmptyState,
  ErrorPanel,
  IdentityStateBadge,
  OriginBadge,
  Panel,
  PanelHeader,
  Pill,
  Skeleton,
} from '../components/ui/primitives'

const tabs = ['Overview', 'Timeline', 'Sources', 'Network', 'Evidence', 'Activity'] as const
type Tab = (typeof tabs)[number]

/** Research channels routed through the public-information connector. */
const researchChannels = [
  { value: 'news', label: 'News mentions' },
  { value: 'professional_profile', label: 'Professional profiles' },
  { value: 'public_website', label: 'Web presence' },
  { value: 'org_registry', label: 'Organization registries' },
  { value: 'org_dataset', label: 'Organization datasets' },
] as const

type ResearchChannel = (typeof researchChannels)[number]['value']

/** Honest terminal states for an external research run. */
interface ResearchState {
  phase: 'idle' | 'running' | 'not_configured' | 'completed' | 'no_results' | 'failed'
  reason?: SearchFailureReason
  message?: string
  runId?: string
  sourceCount?: number
  factCount?: number
}

const failureLabels: Record<SearchFailureReason, string> = {
  timeout: 'Timed out',
  rate_limited: 'Rate limited',
  auth_failed: 'Provider authentication failed',
  provider_error: 'Provider error',
  invalid_response: 'Invalid provider response',
  network: 'Network error',
}

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
          {fact.providerResultId != null && (
            <Pill tone="neutral">Provider-reported</Pill>
          )}
          <ConfidenceBadge score={fact.confidence} showPct={false} />
          {fact.providerConfidence != null && (
            <span className="text-[10px] text-ink-faint" title="Score claimed by the provider, verbatim">
              provider confidence {pct(fact.providerConfidence)}
            </span>
          )}
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
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<AtlasServiceError | null>(null)
  const [timelineFilter, setTimelineFilter] = useState<FactCategory | 'all'>('all')
  const [researchChannel, setResearchChannel] = useState<ResearchChannel>('news')
  const [research, setResearch] = useState<ResearchState>({ phase: 'idle' })

  const { publicInformation } = useAtlas()
  const bundle = useProfileBundle(id)
  const sourcesQuery = useSources()
  const profileId = bundle.data?.profile.id
  const subjectId = bundle.data?.profile.subjectId
  // Hooks stay unconditional; undefined ids park them in a pending state.
  const subjectEvidence = useEvidenceBySubject(subjectId)
  const audit = useAuditEvents()

  // Presentation derivations — no fabricated data, pure projections of facts.
  const timeline = useMemo(() => deriveTimeline(bundle.data?.facts ?? []), [bundle.data])
  const network = useMemo(
    () =>
      bundle.data !== null ? deriveNetwork(bundle.data.profile, bundle.data.facts) : { nodes: [], edges: [] },
    [bundle.data],
  )
  const scopedSources = useMemo(
    () => sourcesForFacts(sourcesQuery.data ?? [], bundle.data?.facts ?? []),
    [sourcesQuery.data, bundle.data],
  )

  const relevantActivity = useMemo(() => {
    const name = bundle.data?.profile.canonicalName
    if (name === undefined) return []
    return (audit.data ?? [])
      .filter((event) => event.detail.includes(name))
      .slice(0, 8)
  }, [audit.data, bundle.data])

  const investigationLink =
    subjectEvidence.data !== null && subjectEvidence.data.length > 0
      ? subjectEvidence.data[0].investigationId
      : null

  if (!bundle.loading && bundle.data === null && bundle.error === null) {
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

  if (bundle.data === null) {
    return (
      <div className="flex items-center gap-2 p-8 text-xs text-ink-muted">
        <Loader2 size={14} className="animate-spin" /> Loading profile…
      </div>
    )
  }

  const { profile, facts } = bundle.data

  const grouped = facts.reduce<Partial<Record<FactCategory, IntelligenceFact[]>>>((acc, fact) => {
    ;(acc[fact.category] ??= []).push(fact)
    return acc
  }, {})

  const sourceById = new Map(scopedSources.map((s) => [s.id, s]))
  const filteredTimeline =
    timelineFilter === 'all' ? timeline : timeline.filter((t) => t.category === timelineFilter)
  const timelineYears = [...new Set(filteredTimeline.map((t) => t.year))].sort((a, b) => b - a)

  const refresh = async () => {
    setRefreshing(true)
    setRefreshNotice(null)
    setRefreshError(null)
    try {
      const results = await publicInformation.searchPerson({ profileId: profile.id })
      bundle.reload()
      // Honest copy: this re-reads stored fact records. No external provider
      // is queried by this action, so no new research run has happened.
      setRefreshNotice(
        `Displayed ${results.length} stored fact record(s). No external provider is configured, so no new research was performed.`,
      )
    } catch (err) {
      setRefreshError(
        err instanceof AtlasServiceError ? err : new AtlasServiceError('Research', 'provider_failure'),
      )
    } finally {
      setRefreshing(false)
    }
  }

  const runResearch = async () => {
    setResearch({ phase: 'running' })
    let result: PublicInformationSearchResult
    try {
      result = await publicInformation.searchExternal({
        profileId: profile.id,
        channel: researchChannel,
      })
    } catch (err) {
      // Authorization / validation refusals surface as typed errors.
      setResearch({
        phase: 'failed',
        reason: 'provider_error',
        message:
          err instanceof AtlasServiceError
            ? err.displayMessage
            : 'Research could not be started.',
      })
      return
    }
    switch (result.status) {
      case 'ok':
        setResearch({
          phase: 'completed',
          runId: result.runId,
          sourceCount: result.sources.length,
          factCount: result.factCount,
        })
        bundle.reload()
        sourcesQuery.reload()
        break
      case 'no_results':
        setResearch({ phase: 'no_results', runId: result.runId })
        bundle.reload()
        break
      case 'not_configured':
        setResearch({ phase: 'not_configured' })
        break
      case 'failed':
        setResearch({
          phase: 'failed',
          reason: result.reason,
          message: result.message,
          runId: result.runId,
        })
        break
    }
  }

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
            <Button variant="secondary" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Reloading…' : 'Reload facts'}
            </Button>
            <Button variant="secondary">
              <FilePlus2 size={13} />
              Add evidence
            </Button>
            <Button variant="secondary">
              <Download size={13} />
              Export report
            </Button>
            {investigationLink !== null && (
              <Link to={`/investigations/${investigationLink}`}>
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
        {(bundle.error !== null || refreshError !== null || subjectEvidence.error !== null) && (
          <ErrorPanel
            error={
              refreshError ??
              subjectEvidence.error ??
              (bundle.error as AtlasServiceError)
            }
          />
        )}
        {refreshNotice !== null && (
          <Panel className="border-ok/30 bg-ok-muted p-3">
            <p className="text-xs text-ok">{refreshNotice}</p>
          </Panel>
        )}

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

        {bundle.loading ? (
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
                      <p className="mt-1 font-mono text-sm text-ink">{facts.length}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.08em] text-ink-muted">Independent sources</p>
                      <p className="mt-1 font-mono text-sm text-ink">{scopedSources.length}</p>
                    </div>
                  </div>
                </Panel>

                {/* Public information research — real connector runs through
                    the search_runs lifecycle; every state below is honest. */}
                <Panel className="lg:col-span-2">
                  <PanelHeader title="Public information research" />
                  <div className="flex flex-wrap items-center gap-2 p-4">
                    <select
                      value={researchChannel}
                      onChange={(e) => setResearchChannel(e.target.value as ResearchChannel)}
                      disabled={research.phase === 'running'}
                      aria-label="Research channel"
                      className="rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-xs text-ink-secondary outline-none"
                    >
                      {researchChannels.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="secondary"
                      onClick={() => void runResearch()}
                      disabled={research.phase === 'running'}
                    >
                      {research.phase === 'running' ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Search size={13} />
                      )}
                      {research.phase === 'running' ? 'Searching…' : 'Run research'}
                    </Button>
                    <span className="text-[11px] leading-snug text-ink-faint">
                      Queries the configured public-information provider for this authorized subject.
                      Results are provider-reported, never analyst-confirmed.
                    </span>
                  </div>
                  {research.phase !== 'idle' && research.phase !== 'running' && (
                    <div className="border-t border-edge px-4 py-3">
                      {research.phase === 'not_configured' && (
                        <p className="text-xs text-ink-muted" role="status">
                          Not configured: no public-information provider is connected to this
                          organization, so nothing was queried or recorded.
                        </p>
                      )}
                      {research.phase === 'completed' && (
                        <p className="text-xs text-ok" role="status">
                          Completed — {research.sourceCount ?? 0} source(s) and{' '}
                          {research.factCount ?? 0} fact(s) recorded from provider-reported results.
                          {research.runId !== undefined && <> Run {research.runId.slice(0, 8)}.</>}
                        </p>
                      )}
                      {research.phase === 'no_results' && (
                        <p className="text-xs text-ink-secondary" role="status">
                          Completed with no results: the provider returned nothing for this query.
                          {research.runId !== undefined && <> Run {research.runId.slice(0, 8)}.</>}
                        </p>
                      )}
                      {research.phase === 'failed' && (
                        <p className="text-xs text-danger" role="status">
                          {research.reason !== undefined ? failureLabels[research.reason] : 'Failed'}
                          {research.message !== undefined && ` — ${research.message}`}
                          {research.runId !== undefined && <> Run {research.runId.slice(0, 8)} recorded as failed.</>}
                        </p>
                      )}
                    </div>
                  )}
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
                    {facts.map((fact) => (
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
                    {facts.length === 0 && (
                      <p className="py-4 text-center text-xs text-ink-muted">
                        No corroborated facts recorded yet.
                      </p>
                    )}
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
                <PanelHeader title={`Sources (${scopedSources.length})`} />
                <ul className="divide-y divide-edge">
                  {scopedSources.map((source) => (
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
                          {source.publishedAt != null && <> · published {formatDate(source.publishedAt)}</>}
                        </p>
                      </div>
                      <Pill tone="neutral">Credibility {pct(source.credibilityScore)}</Pill>
                    </li>
                  ))}
                  {scopedSources.length === 0 && (
                    <li className="px-4 py-6 text-center text-xs text-ink-muted">
                      No source records are attached to this profile's facts.
                    </li>
                  )}
                </ul>
              </Panel>
            )}

            {tab === 'Network' && (
              <div>
                {network.nodes.length <= 1 ? (
                  <EmptyState
                    icon={<UserX size={18} />}
                    title="No relationship data yet"
                    description="Relationships appear as evidence-backed facts are recorded."
                  />
                ) : (
                  <NetworkGraph nodes={network.nodes} edges={network.edges} />
                )}
              </div>
            )}

            {tab === 'Evidence' && (
              <Panel>
                <PanelHeader
                  title={`Evidence (${(subjectEvidence.data ?? []).length})`}
                />
                {subjectEvidence.loading && profileId !== undefined && (
                  <div className="flex items-center gap-2 px-4 py-6 text-xs text-ink-muted">
                    <Loader2 size={14} className="animate-spin" /> Loading evidence…
                  </div>
                )}
                {!subjectEvidence.loading && (subjectEvidence.data ?? []).length === 0 && (
                  <EmptyState
                    icon={<UserX size={18} />}
                    title="No evidence captured"
                    description="Evidence items tied to this subject will appear here with full provenance."
                  />
                )}
                <ul className="divide-y divide-edge">
                  {(subjectEvidence.data ?? []).map((item) => {
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
                <PanelHeader title="Profile activity (audited)" />
                {relevantActivity.length === 0 ? (
                  <EmptyState
                    icon={<UserX size={18} />}
                    title="No audited activity"
                    description="Resolution runs and research touching this profile are recorded here."
                  />
                ) : (
                  <ul className="divide-y divide-edge">
                    {relevantActivity.map((event) => (
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
          </>
        )}
      </div>

      <EvidenceDrawer
        fact={openFact}
        sources={scopedSources}
        onClose={() => setOpenFact(null)}
      />
    </div>
  )
}
