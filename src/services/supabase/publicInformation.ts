import type { IntelligenceFact, IntelligenceProfile, Source } from '../../types'
import { assertSubjectAuthorized } from '../identityResolution'
import {
  getProfileInputSchema,
  intelligenceFactSchema,
  intelligenceProfileSchema,
  publicInformationSearchInputSchema,
  searchPersonInputSchema,
} from '../schemas'
import { AtlasServiceError } from '../errors'
import { requireSupabaseClient } from './client'
import { mapProviderError, parseOrThrow } from './rows'
import { deriveAvatarColor, deriveInitials } from '../../lib/profileDisplay'
import { canonicalizeSourceUrl } from '../provenance'
import { mapSourceRow } from './sources'
import {
  searchViaHttp,
  type PublicInformationOutcome,
  type PublicInformationChannel,
} from '../providers/httpPublicInformation'
import type {
  PublicInformationSearchInput,
  PublicInformationSearchResult,
  PublicInformationService,
} from '../publicInformation'

interface ProfileContextRow {
  id: string
  subject_id: string
  canonical_name?: string
  subjects?:
    | {
        authorization_state: string
        investigation_id: string
        investigations?: { organization_id?: string } | null
      }
    | null
}

interface ProfileRow extends ProfileContextRow {
  canonical_name: string
  summary: string | null
  identity_state: string | null
  confidence_score: number | string
  last_resolved_at: string | null
  updated_at: string
}

function mapProfile(row: ProfileRow): IntelligenceProfile {
  return parseOrThrow('PublicInformation', intelligenceProfileSchema, {
    id: row.id,
    subjectId: row.subject_id,
    canonicalName: row.canonical_name,
    summary: row.summary ?? '',
    identityState: row.identity_state ?? 'candidate',
    confidenceScore: Number(row.confidence_score),
    avatarColor: deriveAvatarColor(row.id),
    initials: deriveInitials(row.canonical_name),
    lastResolvedAt: row.last_resolved_at ?? row.updated_at,
    updatedAt: row.updated_at,
  })
}

interface FactRow {
  id: string
  intelligence_profile_id: string
  category: string
  label: string
  value: string
  confidence: number | string
  source_count: number | null
  verification_status: string
  origin: string | null
  first_observed_at: string | null
  last_verified_at: string | null
  provider_result_id?: string | null
  provider_confidence?: number | string | null
  search_run_id?: string | null
}

function mapFact(row: FactRow, sourceIds: string[]): IntelligenceFact {
  return parseOrThrow('PublicInformation', intelligenceFactSchema, {
    id: row.id,
    profileId: row.intelligence_profile_id,
    category: row.category,
    label: row.label,
    value: row.value,
    confidence: Number(row.confidence),
    sourceCount: sourceIds.length > 0 ? sourceIds.length : (row.source_count ?? 0),
    verificationStatus: row.verification_status,
    origin: row.origin ?? 'source_fact',
    sourceIds,
    firstObservedAt: row.first_observed_at ?? new Date().toISOString(),
    lastVerifiedAt: row.last_verified_at ?? new Date().toISOString(),
    providerResultId: row.provider_result_id ?? null,
    providerConfidence:
      row.provider_confidence === null || row.provider_confidence === undefined
        ? null
        : Number(row.provider_confidence),
    searchRunId: row.search_run_id ?? null,
  })
}

const channelDefaultSourceType: Record<PublicInformationChannel, Source['sourceType']> = {
  professional_profile: 'professional_profile',
  news: 'news',
  public_website: 'public_website',
  org_registry: 'org_registry',
  org_dataset: 'org_dataset',
}

const SOURCE_TYPES: readonly Source['sourceType'][] = [
  'web_search',
  'professional_profile',
  'news',
  'org_registry',
  'public_website',
  'org_dataset',
]

/** Honest, analyst-facing copy for every deterministic provider failure. */
const FAILURE_COPY: Record<
  Exclude<PublicInformationOutcome['status'], 'ok'>,
  string
> = {
  timeout: 'The public information provider did not respond in time.',
  rate_limited: 'The public information provider is rate limiting requests.',
  auth_failed: 'The research endpoint rejected our credentials.',
  invalid_response: 'The research endpoint returned an unreadable result.',
  network: 'Could not reach the public information provider.',
  provider_error: 'The public information endpoint reported an error.',
}

export interface SupabasePublicInformationOptions {
  /**
   * Credentialless DIRECT research endpoint (lowest priority). The URL is
   * readable by org members, so it must never embed credentials.
   */
  deploymentProviderUrl?: string | null
  /**
   * Server-side proxy / Edge Function URL (deployment tier). Holds provider
   * secrets server-side; the browser authenticates with its Supabase JWT.
   */
  proxyEndpoint?: string | null
  /** Transport timeout in milliseconds. */
  timeoutMs?: number
  /** Injectable wire transport (tests script outcomes; production uses HTTP). */
  transport?: (
    endpoint: string,
    request: { fullName: string; correlationId: string },
  ) => Promise<PublicInformationOutcome>
}

/**
 * Application-API backed public information service. Authorization is
 * enforced here AND again by database RLS/triggers — defense in depth.
 *
 * External research walks the real search-run lifecycle:
 *   queued -> running -> completed | no_results | failed(reason)
 * so every attempt — successful or not — leaves a durable, auditable trace.
 */
export class SupabasePublicInformationService implements PublicInformationService {
  private readonly deploymentProviderUrl: string | null
  private readonly proxyEndpoint: string | null
  private readonly timeoutMs: number
  private readonly transport: NonNullable<SupabasePublicInformationOptions['transport']>

  constructor(options: SupabasePublicInformationOptions = {}) {
    this.deploymentProviderUrl = options.deploymentProviderUrl ?? null
    this.proxyEndpoint = options.proxyEndpoint ?? null
    this.timeoutMs = options.timeoutMs ?? 15000
    // Default transport: the real HTTP wire contract.
    this.transport =
      options.transport ??
      ((endpoint, request) => searchViaHttp(endpoint, request, { timeoutMs: this.timeoutMs }))
  }

  async listProfiles(): Promise<IntelligenceProfile[]> {
    const client = requireSupabaseClient('PublicInformation')
    try {
      const { data, error } = await client
        .from('intelligence_profiles')
        .select('*, subjects!inner(authorization_state)')
        .eq('subjects.authorization_state', 'authorized')
        .order('updated_at', { ascending: false })
      if (error !== null) throw error
      return (data ?? []).map((raw) => mapProfile(raw as ProfileRow))
    } catch (error) {
      throw mapProviderError('PublicInformation', error)
    }
  }

  async getProfile(input: { profileId: string }): Promise<IntelligenceProfile> {
    const parsed = parseOrThrow('PublicInformation', getProfileInputSchema, input)
    const client = requireSupabaseClient('PublicInformation')
    try {
      const { data: row, error } = await client
        .from('intelligence_profiles')
        .select('*, subjects(authorization_state)')
        .eq('id', parsed.profileId)
        .maybeSingle<ProfileRow>()
      if (error !== null) throw error
      if (row === null) throw new AtlasServiceError('PublicInformation', 'not_found')

      // Hard gate — mirrors database RLS policies.
      assertSubjectAuthorized(row.subject_id, row.subjects?.authorization_state)
      return mapProfile(row)
    } catch (error) {
      throw mapProviderError('PublicInformation', error)
    }
  }

  async searchPerson(input: { profileId: string }): Promise<IntelligenceFact[]> {
    const { profileId } = parseOrThrow('PublicInformation', searchPersonInputSchema, input)
    const client = requireSupabaseClient('PublicInformation')
    try {
      const { factIds, factRows } = await this.authorizeAndRecord(profileId, `profile:${profileId}`)

      // Derive per-fact source provenance from evidence links.
      const sourcesByFact = new Map<string, string[]>()
      if (factIds.length > 0) {
        const { data: links, error: linkError } = await client
          .from('evidence_items')
          .select('fact_id, source_id')
          .in('fact_id', factIds)
        if (linkError !== null) throw linkError
        for (const link of (links ?? []) as Array<{ fact_id: string | null; source_id: string }>) {
          if (link.fact_id === null) continue
          const list = sourcesByFact.get(link.fact_id) ?? []
          if (!list.includes(link.source_id)) list.push(link.source_id)
          sourcesByFact.set(link.fact_id, list)
        }
      }

      return factRows.map((row) => mapFact(row, sourcesByFact.get(row.id) ?? []))
    } catch (error) {
      throw mapProviderError('PublicInformation', error)
    }
  }

  async searchExternal(input: PublicInformationSearchInput): Promise<PublicInformationSearchResult> {
    const parsed = parseOrThrow('PublicInformation', publicInformationSearchInputSchema, input)
    const { profileId, channel } = parsed
    const client = requireSupabaseClient('PublicInformation')
    try {
      // ---- 1. Authorization / configuration validation (before ANY write
      //         or wire call). Cross-org or missing profiles surface as
      //         not_found; restricted/revoked/undeclared subjects are
      //         refused with zero side effects.
      const { data: profile, error } = await client
        .from('intelligence_profiles')
        .select(
          'id, subject_id, canonical_name, subjects(authorization_state, investigation_id, investigations(organization_id))',
        )
        .eq('id', profileId)
        .maybeSingle<ProfileContextRow & { canonical_name: string }>()
      if (error !== null) throw error
      if (profile === null) throw new AtlasServiceError('PublicInformation', 'not_found')

      assertSubjectAuthorized(profile.subject_id, profile.subjects?.authorization_state)

      // Org is resolved SERVER-SIDE from the subject's investigation —
      // never from client input. Every durable write below needs it.
      const organizationId = profile.subjects?.investigations?.organization_id ?? null
      if (organizationId === null || organizationId === '') {
        throw new AtlasServiceError(
          'PublicInformation',
          'conflict',
          { stage: 'resolve_organization' },
          'Research could not start: the organization could not be resolved',
        )
      }

      const endpoint = await this.resolveEndpoint(client, organizationId)
      if (endpoint === null) {
        // Honest no-op: NO search run, NO wire call, NO success audit.
        return { status: 'not_configured' }
      }

      const correlationId = crypto.randomUUID()
      const providerHost = hostOf(endpoint)
      const { data: userData } = await client.auth.getUser()
      const userId = userData.user?.id ?? null

      // ---- 2. Durable run record BEFORE the wire is touched. The DB
      //         authorization trigger re-checks the subject state and the
      //         lifecycle trigger audits the creation.
      const runId = await this.createRun(client, {
        investigationId: profile.subjects!.investigation_id,
        subjectId: profile.subject_id,
        profileId,
        userId,
        channel,
        correlationId,
        endpoint,
      })

      try {
        await this.progressRun(client, runId, { status: 'running' })
      } catch (error) {
        await this.failRun(client, runId, 'provider_error', `run_running_failed: ${String(error)}`)
        throw new AtlasServiceError(
          'PublicInformation',
          'provider_failure',
          { stage: 'run_running', detail: String(error) },
          'Research could not be started (search run transition failed)',
        )
      }

      await this.recordAudit(
        client,
        'public_information.search_started',
        'intelligence_profile',
        profileId,
        organizationId,
        true,
        `run ${runId} correlation ${correlationId}: channel ${channel}, provider ${providerHost}`,
      )

      // ---- 3. Wire call through the versioned contract.
      const outcome = await this.transport(endpoint, {
        fullName: profile.canonical_name,
        correlationId,
      })

      if (outcome.status !== 'ok') {
        await this.failRun(client, runId, outcome.status, outcome.message)
        await this.recordAudit(
          client,
          'public_information.search_failed',
          'intelligence_profile',
          profileId,
          organizationId,
          true,
          `run ${runId} correlation ${correlationId}: failed (${outcome.status}) ${outcome.message}`,
        )
        return {
          status: 'failed',
          reason: outcome.status,
          message: FAILURE_COPY[outcome.status],
          runId,
          correlationId,
        }
      }

      // ---- 4. Normalize + persist provenance.
      try {
        const ingestion = await this.ingest(
          client,
          {
            organizationId,
            investigationId: profile.subjects!.investigation_id,
            subjectId: profile.subject_id,
            profileId,
            runId,
            channel,
            providerHost,
            providerName: outcome.providerName,
            results: outcome.results,
          },
        )

        await this.completeRun(client, runId, ingestion.sourcesFound, ingestion.factsUpdated)

        await this.recordAudit(
          client,
          'public_information.search_completed',
          'intelligence_profile',
          profileId,
          organizationId,
          true,
          `run ${runId} correlation ${correlationId}: ${ingestion.sourcesFound} source(s), ${ingestion.factsUpdated} fact(s) recorded`,
        )

        if (ingestion.sourcesFound === 0 && ingestion.factsUpdated === 0) {
          return { status: 'no_results', runId, correlationId }
        }
        return {
          status: 'ok',
          runId,
          correlationId,
          sources: ingestion.sources,
          factCount: ingestion.factsUpdated,
        }
      } catch (error) {
        // Provider succeeded but persistence failed: fail loudly. Whatever
        // was already written stays — it is a true record of what this run
        // retrieved up to that point — but the run is FAILED, never a fake
        // completion.
        const detail = error instanceof Error ? error.message : String(error)
        await this.failRun(client, runId, 'provider_error', `ingestion_persistence_failed: ${detail}`)
        await this.recordAudit(
          client,
          'public_information.search_failed',
          'intelligence_profile',
          profileId,
          organizationId,
          true,
          `run ${runId} correlation ${correlationId}: persistence failed`,
        )
        return {
          status: 'failed',
          reason: 'provider_error',
          message: 'Research succeeded but recording the results failed.',
          runId,
          correlationId,
        }
      }
    } catch (error) {
      throw mapProviderError('PublicInformation', error)
    }
  }

  /**
   * Configuration precedence: organization connector configuration →
   * deployment proxy (secrets server-side) → deployment direct endpoint →
   * unconfigured (null).
   */
  private async resolveEndpoint(
    client: ReturnType<typeof requireSupabaseClient>,
    organizationId: string | null,
  ): Promise<string | null> {
    if (organizationId !== null && organizationId !== '') {
      try {
        const { data, error } = await client
          .from('connectors')
          .select('endpoint_url')
          .eq('organization_id', organizationId)
          .eq('category', 'public_information')
          .in('status', ['connected', 'degraded'])
        if (!error) {
          const url = (data ?? [])
            .map((row) => (row as { endpoint_url?: string | null }).endpoint_url ?? '')
            .find((url) => url.trim() !== '')
          if (url !== undefined) return url.trim()
        }
      } catch {
        // fall through to deployment configuration
      }
    }
    if (this.proxyEndpoint !== null && this.proxyEndpoint !== '') return this.proxyEndpoint
    if (this.deploymentProviderUrl !== null && this.deploymentProviderUrl !== '') {
      return this.deploymentProviderUrl
    }
    return null
  }

  private async createRun(
    client: ReturnType<typeof requireSupabaseClient>,
    args: {
      investigationId: string
      subjectId: string
      profileId: string
      userId: string | null
      channel: PublicInformationChannel
      correlationId: string
      endpoint: string
    },
  ): Promise<string> {
    const { data, error } = await client
      .from('search_runs')
      .insert({
        investigation_id: args.investigationId,
        subject_id: args.subjectId,
        initiated_by: args.userId,
        query: `public-info/${args.channel}/${args.correlationId}`,
        status: 'queued',
        channel: args.channel,
        provider: hostOf(args.endpoint),
        profile_id: args.profileId,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single<{ id: string }>()
    if (error !== null || data === null) {
      throw new AtlasServiceError(
        'PublicInformation',
        'conflict',
        { stage: 'run_create', detail: error?.message },
        'Research could not start: the search run could not be recorded',
      )
    }
    return data.id
  }

  private async progressRun(
    client: ReturnType<typeof requireSupabaseClient>,
    runId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await client.from('search_runs').update(patch).eq('id', runId)
    if (error !== null) throw error
  }

  private async completeRun(
    client: ReturnType<typeof requireSupabaseClient>,
    runId: string,
    sourcesFound: number,
    factsUpdated: number,
  ): Promise<void> {
    await this.progressRun(
      client,
      runId,
      sourcesFound > 0 || factsUpdated > 0
        ? {
            status: 'completed',
            sources_found: sourcesFound,
            facts_updated: factsUpdated,
            completed_at: new Date().toISOString(),
          }
        : { status: 'no_results', completed_at: new Date().toISOString() },
    )
  }

  /** Best-effort terminal failure write; the reported outcome still stands. */
  private async failRun(
    client: ReturnType<typeof requireSupabaseClient>,
    runId: string,
    reason: 'timeout' | 'rate_limited' | 'auth_failed' | 'provider_error' | 'invalid_response' | 'network',
    detail: string,
  ): Promise<void> {
    try {
      await this.progressRun(client, runId, {
        status: 'failed',
        failure_reason: reason,
        error_detail: detail.slice(0, 500),
        completed_at: new Date().toISOString(),
      })
    } catch {
      // The returned/raised primary outcome always wins over bookkeeping.
    }
  }

  /* ------------------------------------------------------------------
   * Ingestion: sources (+ retrieval history), facts, evidence lineage.
   *
   * Honesty rules implemented here:
   *   - content_hash is NEVER written: this contract returns references,
   *     not retrieved bytes. No hash means no claim of content integrity.
   *   - published_at is stored ONLY when the provider supplied it.
   *   - an existing org source is REUSED, never rewritten: first-retrieval
   *     provenance is immutable; each new run adds a retrieval row.
   *   - existing facts are matched deterministically and NEVER overwritten
   *     or deleted; only additive evidence links may be added.
   * ------------------------------------------------------------------ */
  private async ingest(
    client: ReturnType<typeof requireSupabaseClient>,
    ctx: {
      organizationId: string
      investigationId: string
      subjectId: string
      profileId: string
      runId: string
      channel: PublicInformationChannel
      providerHost: string
      providerName: string
      results: Array<{
        resultId: string
        displayName: string
        summary: string | null
        publishedAt: string | null
        retrievedAt: string | null
        confidence: number | null
        facts: Array<{ category: string; label: string; value: string; confidence: number | null }>
        sources: Array<{
          url: string
          title: string
          sourceType: string | null
          publishedAt: string | null
          credibility: number | null
        }>
        rawJson: string
      }>
    },
  ): Promise<{ sourcesFound: number; factsUpdated: number; sources: Source[] }> {
    // ---- Sources: batch-dedupe within the response by canonical URL.
    interface PlannedSource {
      rawUrl: string
      canonicalUrl: string
      title: string
      sourceType: Source['sourceType']
      publishedAt: string | null
      credibility: number | null
      resultId: string
    }
    const planned = new Map<string, PlannedSource>()
    for (const result of ctx.results) {
      for (const source of result.sources) {
        const canonicalUrl = canonicalizeSourceUrl(source.url)
        if (planned.has(canonicalUrl)) continue
        const sourceType =
          source.sourceType !== null && SOURCE_TYPES.includes(source.sourceType as Source['sourceType'])
            ? (source.sourceType as Source['sourceType'])
            : channelDefaultSourceType[ctx.channel]
        planned.set(canonicalUrl, {
          rawUrl: source.url,
          canonicalUrl,
          title: source.title,
          sourceType,
          // Result-level publication date is a fallback ONLY when the
          // source itself carries none; both are provider-supplied values.
          publishedAt: source.publishedAt ?? result.publishedAt ?? null,
          credibility: source.credibility,
          resultId: result.resultId,
        })
      }
    }

    const sourceIdByUrl = new Map<string, string>()
    if (planned.size > 0) {
      const { data: existingRows, error: existingError } = await client
        .from('sources')
        .select('id, canonical_url')
        .eq('organization_id', ctx.organizationId)
      if (existingError !== null) throw existingError
      for (const row of (existingRows ?? []) as Array<{ id: string; canonical_url: string }>) {
        sourceIdByUrl.set(row.canonical_url, row.id)
      }

      const toInsert = [...planned.values()].filter((p) => !sourceIdByUrl.has(p.canonicalUrl))
      if (toInsert.length > 0) {
        const { data: insertedRows, error: insertError } = await client
          .from('sources')
          .insert(
            toInsert.map((p) => ({
              organization_id: ctx.organizationId,
              provider: ctx.providerHost,
              source_name: p.title,
              canonical_url: p.canonicalUrl,
              original_url: p.rawUrl,
              source_type: p.sourceType,
              // Unscored providers stay honest: 0 + metadata flag, never a
              // fabricated credibility value.
              credibility_score: p.credibility ?? 0,
              published_at: p.publishedAt,
              metadata: {
                result_id: p.resultId,
                provider_name: ctx.providerName,
                credibility_supplied: p.credibility !== null,
                contract_version: 1,
              },
            })),
          )
          .select('id, canonical_url')
        if (insertError !== null || insertedRows === null) {
          throw new Error(insertError?.message ?? 'unknown source persistence error')
        }
        for (const row of insertedRows as Array<{ id: string; canonical_url: string }>) {
          sourceIdByUrl.set(row.canonical_url, row.id)
        }
      }

      // Retrieval history: EVERY touched source (new or reused) gets one
      // retrieval row for THIS run. Repeated searches create history;
      // they never mutate first-retrieval provenance on the source row.
      const retrievalTargets = new Set([...planned.values()].map((p) => p.canonicalUrl))
      const retrievalPayload = [...retrievalTargets]
        .map((url) => sourceIdByUrl.get(url))
        .filter((id): id is string => id !== undefined)
        .map((sourceId) => ({
          organization_id: ctx.organizationId,
          source_id: sourceId,
          search_run_id: ctx.runId,
        }))
      if (retrievalPayload.length > 0) {
        const { error: retrievalError } = await client
          .from('source_retrievals')
          .insert(retrievalPayload)
        if (retrievalError !== null) throw retrievalError
      }
    }

    // ---- Facts: deterministic match, additive-only upsert.
    const norm = (value: string): string => value.trim().toLowerCase()
    const factKey = (category: string, label: string, value: string): string =>
      `${category}::${norm(label)}::${norm(value)}`

    interface ExistingFact {
      id: string
      category: string
      label: string
      value: string
      verification_status: string
      origin: string | null
    }
    const { data: existingFacts, error: factsError } = await client
      .from('intelligence_facts')
      .select('id, category, label, value, verification_status, origin')
      .eq('intelligence_profile_id', ctx.profileId)
    if (factsError !== null) throw factsError
    const existingByKey = new Map<string, ExistingFact>()
    for (const row of (existingFacts ?? []) as ExistingFact[]) {
      existingByKey.set(factKey(row.category, row.label, row.value), row)
    }

    interface NewFactPlan {
      key: string
      payload: Record<string, unknown>
    }
    const newFacts = new Map<string, NewFactPlan>()
    // fact/source pairs this run wants linked, per fact key (facts not yet inserted).
    interface LinkRequest {
      factKey: string
      sourceUrls: string[]
      claim: string
      confidence: number
    }
    const linkRequests: LinkRequest[] = []

    for (const result of ctx.results) {
      const resultSourceUrls = result.sources
        .map((s) => sourceIdByUrl.get(canonicalizeSourceUrl(s.url)))
        .filter((id): id is string => id !== undefined)

      for (const fact of result.facts) {
        const key = factKey(fact.category, fact.label, fact.value)
        const existing = existingByKey.get(key)
        if (existing === undefined && !newFacts.has(key)) {
          newFacts.set(key, {
            key,
            payload: {
              intelligence_profile_id: ctx.profileId,
              category: fact.category,
              label: fact.label.trim(),
              value: fact.value.trim(),
              // Provider-supplied confidence verbatim; otherwise 0 with the
              // real value kept in provider_confidence = NULL (unscored).
              confidence: fact.confidence ?? 0,
              source_count: 0,
              verification_status: 'unverified',
              origin: 'source_fact',
              provider_result_id: result.resultId,
              search_run_id: ctx.runId,
              provider_confidence: fact.confidence,
            },
          })
        }
        if (resultSourceUrls.length > 0) {
          linkRequests.push({
            factKey: key,
            sourceUrls: resultSourceUrls,
            claim: `${fact.label.trim()}: ${fact.value.trim()}`,
            confidence: fact.confidence ?? 0,
          })
        }
      }
    }

    const factIdByKey = new Map<string, string>()
    for (const [key, row] of existingByKey) factIdByKey.set(key, row.id)

    let insertedFactCount = 0
    if (newFacts.size > 0) {
      const { data: insertedFactRows, error: factInsertError } = await client
        .from('intelligence_facts')
        .insert([...newFacts.values()].map((plan) => plan.payload))
        .select('id')
      if (factInsertError !== null || insertedFactRows === null) {
        throw new Error(factInsertError?.message ?? 'unknown fact persistence error')
      }
      insertedFactCount = insertedFactRows.length
      const plans = [...newFacts.values()]
      insertedFactRows.forEach((row, index) => {
        const plan = plans[index]
        if (plan !== undefined) factIdByKey.set(plan.key, (row as { id: string }).id)
      })
    }

    // ---- Evidence lineage: deduplicated fact<->source links.
    const existingLinks = new Set<string>()
    const allKnownFactIds = [...new Set(factIdByKey.values())]
    if (allKnownFactIds.length > 0) {
      const { data: linkRows, error: linkError } = await client
        .from('evidence_items')
        .select('fact_id, source_id')
        .in('fact_id', allKnownFactIds)
      if (linkError !== null) throw linkError
      for (const row of (linkRows ?? []) as Array<{ fact_id: string | null; source_id: string }>) {
        if (row.fact_id !== null) existingLinks.add(`${row.fact_id}::${row.source_id}`)
      }
    }

    const evidenceToInsert: Array<Record<string, unknown>> = []
    const newLinksByFact = new Map<string, number>()
    for (const request of linkRequests) {
      const factId = factIdByKey.get(request.factKey)
      if (factId === undefined) continue
      for (const sourceId of request.sourceUrls) {
        const linkKey = `${factId}::${sourceId}`
        if (existingLinks.has(linkKey)) continue
        existingLinks.add(linkKey)
        evidenceToInsert.push({
          investigation_id: ctx.investigationId,
          subject_id: ctx.subjectId,
          source_id: sourceId,
          fact_id: factId,
          claim: request.claim.slice(0, 500),
          confidence: request.confidence,
          evidence_type: 'web_page',
        })
        newLinksByFact.set(factId, (newLinksByFact.get(factId) ?? 0) + 1)
      }
    }
    if (evidenceToInsert.length > 0) {
      const { error: evidenceError } = await client.from('evidence_items').insert(evidenceToInsert)
      if (evidenceError !== null) throw evidenceError
    }

    // source_count reflects the total distinct linked sources for every
    // fact whose link set changed during this run.
    const linksPerFact = new Map<string, number>()
    for (const linkKey of existingLinks) {
      const [factId] = linkKey.split('::')
      if (factId !== undefined) linksPerFact.set(factId, (linksPerFact.get(factId) ?? 0) + 1)
    }
    for (const [factId] of newLinksByFact) {
      const count = linksPerFact.get(factId)
      if (count === undefined) continue
      const { error: updateError } = await client
        .from('intelligence_facts')
        .update({ source_count: count })
        .eq('id', factId)
      if (updateError !== null) throw updateError
    }

    // facts_updated = new facts + pre-existing facts that gained a link.
    const preExistingIds = new Set([...existingByKey.values()].map((row) => row.id))
    const preExistingGainedLinks = [...newLinksByFact.keys()].filter((id) =>
      preExistingIds.has(id),
    ).length
    const factsUpdated = insertedFactCount + preExistingGainedLinks

    // ---- Return full typed source rows for the UI.
    const touchedIds = [
      ...new Set(
        [...planned.values()]
          .map((p) => sourceIdByUrl.get(p.canonicalUrl))
          .filter((id): id is string => id !== undefined),
      ),
    ]
    let sources: Source[] = []
    if (touchedIds.length > 0) {
      const { data: rows, error: readError } = await client
        .from('sources')
        .select('*')
        .in('id', touchedIds)
      if (readError !== null) throw readError
      sources = ((rows ?? []) as Array<Record<string, unknown>>).map((row) => mapSourceRow(row))
    }

    return {
      sourcesFound: touchedIds.length,
      factsUpdated,
      sources,
    }
  }

  private async recordAudit(
    client: ReturnType<typeof requireSupabaseClient>,
    action: string,
    resourceType: string,
    resourceId: string,
    organizationId: string,
    sensitive: boolean,
    detail = '',
  ): Promise<void> {
    // Audit writes must never break the primary operation; failures are
    // surfaced through the durable audit trail gap instead.
    try {
      await client.from('audit_events').insert({
        organization_id: organizationId,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        detail,
        sensitive,
      })
    } catch {
      // Intentional no-op: see services/audit.ts for the durable trail.
    }
  }

  private async authorizeAndRecord(
    profileId: string,
    query: string,
  ): Promise<{ factIds: string[]; factRows: FactRow[] }> {
    const client = requireSupabaseClient('PublicInformation')

    const { data: profile, error } = await client
      .from('intelligence_profiles')
      .select(
        'id, subject_id, subjects(authorization_state, investigation_id, investigations(organization_id))',
      )
      .eq('id', profileId)
      .maybeSingle<ProfileContextRow>()
    if (error !== null) throw error
    if (profile === null) {
      throw new AtlasServiceError('PublicInformation', 'not_found')
    }

    // Hard gate — mirrors the database trigger and RLS policies.
    assertSubjectAuthorized(profile.subject_id, profile.subjects?.authorization_state)

    const { data: facts, error: factsError } = await client
      .from('intelligence_facts')
      .select('*')
      .eq('intelligence_profile_id', profileId)
    if (factsError !== null) throw factsError
    const factRows = (facts ?? []) as FactRow[]
    const factIds = factRows.map((f) => f.id)

    // This service performs a READ of stored facts — it is not a research
    // run. No external provider is queried here, so NO search_runs row is
    // written: fabricating a "completed" run would manufacture provenance.
    // The read itself is still audited; the durable audit_search_run trigger
    // covers real runs when actual providers execute them.
    try {
      await client.from('audit_events').insert({
        organization_id: profile.subjects?.investigations?.organization_id,
        action: 'research.search_person',
        resource_type: 'intelligence_profile',
        resource_id: profile.id,
        detail: query,
        sensitive: true,
      })
    } catch {
      // Audit bookkeeping must not fail the research itself.
    }

    return { factIds, factRows }
  }
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint.slice(0, 100)
  }
}
