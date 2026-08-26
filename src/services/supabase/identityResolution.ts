import type { IdentityCandidate } from '../../types'
import {
  assertSubjectAuthorized,
  type DecideCandidateInput,
  type FindCandidatesInput,
  type IdentityResolutionService,
  type MatchIdentityInput,
  type MatchIdentityResult,
} from '../identityResolution'
import {
  decideCandidateInputSchema,
  findCandidatesInputSchema,
  identityCandidateSchema,
  matchIdentityInputSchema,
} from '../schemas'
import { AtlasServiceError } from '../errors'
import { requireSupabaseClient } from './client'
import { mapProviderError, parseOrThrow } from './rows'
import {
  matchViaHttp,
  type IdentityMatchOutcome,
  type ProviderCandidate,
} from '../providers/httpIdentityMatching'

type ProviderFailureReason = Exclude<IdentityMatchOutcome['status'], 'ok'>

interface SubjectRow {
  id: string
  authorization_state: string
  investigation_id: string
  investigations?: { organization_id?: string } | null
}

interface CandidateRow {
  id: string
  subject_id: string
  provider: string
  external_reference: string
  display_name: string
  match_confidence: number | string
  match_status: string
  metadata?: {
    signals?: unknown
    score_supplied?: boolean
  } | null
  media_asset_id?: string | null
  detected_face_id?: string | null
  track_ref?: string | null
  matched_at?: string | null
  provider_candidate_id?: string | null
  search_run_id?: string | null
  raw_fingerprint?: string | null
  created_at: string
}

function mapCandidate(row: CandidateRow): IdentityCandidate {
  return parseOrThrow('IdentityResolution', identityCandidateSchema, {
    id: row.id,
    subjectId: row.subject_id,
    provider: row.provider,
    externalReference: row.external_reference,
    displayName: row.display_name,
    matchConfidence: Number(row.match_confidence),
    matchStatus: row.match_status,
    signals: Array.isArray(row.metadata?.signals) ? (row.metadata?.signals as string[]) : [],
    mediaAssetId: row.media_asset_id ?? null,
    detectedFaceId: row.detected_face_id ?? null,
    trackRef: row.track_ref ?? null,
    matchedAt: row.matched_at ?? null,
    providerCandidateId: row.provider_candidate_id ?? null,
    searchRunId: row.search_run_id ?? null,
    rawFingerprint: row.raw_fingerprint ?? null,
    createdAt: row.created_at,
  })
}

/** Honest, analyst-facing copy for every deterministic provider failure. */
const FAILURE_COPY: Record<ProviderFailureReason, string> = {
  timeout: 'The identity matching provider did not respond in time.',
  rate_limited: 'The identity matching provider is rate limiting requests.',
  auth_failed: 'The matching endpoint rejected our credentials.',
  invalid_response: 'The matching endpoint returned an unreadable result.',
  network: 'Could not reach the identity matching provider.',
  provider_error: 'The identity matching endpoint reported an error.',
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface SupabaseIdentityResolutionOptions {
  /**
   * Credentialless DIRECT matching endpoint (lowest priority). The URL is
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
    request: {
      imageBlob: Blob
      frameWidth: number
      frameHeight: number
      correlationId: string
      faceBox?: { x: number; y: number; width: number; height: number }
      trackRef?: string
    },
  ) => Promise<IdentityMatchOutcome>
}

/**
 * Application-API backed identity resolution. Authorization is enforced
 * here AND again by database RLS/triggers — defense in depth.
 *
 * Matching walks the real search-run lifecycle:
 *   queued -> running -> completed | no_results | failed(reason)
 * so every attempt — successful or not — leaves a durable, auditable trace.
 */
export class SupabaseIdentityResolutionService implements IdentityResolutionService {
  private readonly deploymentProviderUrl: string | null
  private readonly proxyEndpoint: string | null
  private readonly timeoutMs: number
  private readonly transport: NonNullable<SupabaseIdentityResolutionOptions['transport']>

  constructor(options: SupabaseIdentityResolutionOptions = {}) {
    this.deploymentProviderUrl = options.deploymentProviderUrl ?? null
    this.proxyEndpoint = options.proxyEndpoint ?? null
    this.timeoutMs = options.timeoutMs ?? 15000
    // Default transport: the real HTTP wire contract.
    this.transport = options.transport ?? ((endpoint, request) => matchViaHttp(endpoint, request, { timeoutMs: this.timeoutMs }))
  }

  async findCandidates(input: FindCandidatesInput): Promise<IdentityCandidate[]> {
    const { subjectId } = parseOrThrow('IdentityResolution', findCandidatesInputSchema, input)
    const client = requireSupabaseClient('IdentityResolution')
    try {
      const { data: subject, error } = await client
        .from('subjects')
        .select('id, authorization_state, investigations(organization_id)')
        .eq('id', subjectId)
        .maybeSingle<SubjectRow>()
      if (error !== null) throw error
      if (subject === null) throw new AtlasServiceError('IdentityResolution', 'not_found')

      // Hard gate: resolution requires an explicitly authorized subject.
      assertSubjectAuthorized(subjectId, subject.authorization_state)

      const { data: rows, error: candidateError } = await client
        .from('identity_candidates')
        .select('*')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false })
      if (candidateError !== null) throw candidateError

      const mapped = (rows ?? []).map((row) => mapCandidate(row as CandidateRow))
      await this.recordAudit(client, 'identity.search', 'subject', subjectId, subjectId, true)
      return mapped
    } catch (error) {
      throw mapProviderError('IdentityResolution', error)
    }
  }

  async matchIdentity(input: MatchIdentityInput): Promise<MatchIdentityResult> {
    const parsed = parseOrThrow('IdentityResolution', matchIdentityInputSchema, input)
    const { subjectId, trackId } = parsed
    const client = requireSupabaseClient('IdentityResolution')
    try {
      const { data: subject, error } = await client
        .from('subjects')
        .select('id, authorization_state, investigation_id, investigations(organization_id)')
        .eq('id', subjectId)
        .maybeSingle<SubjectRow>()
      if (error !== null) throw error
      if (subject === null) throw new AtlasServiceError('IdentityResolution', 'not_found')

      // Hard gate: matching requires an explicitly authorized subject.
      // Nothing — no run, no candidate, no audit — happens before this.
      assertSubjectAuthorized(subjectId, subject.authorization_state)

      // Configuration precedence: organization setting -> deployment proxy
      // (secrets server-side) -> deployment direct endpoint -> unconfigured.
      const endpoint = await this.resolveEndpoint(client)
      if (endpoint === null) {
        // Honest no-op: NO search run, NO candidate row, NO success audit.
        return { status: 'not_configured' }
      }

      const correlationId = crypto.randomUUID()
      const organizationId = subject.investigations?.organization_id ?? subject.investigation_id
      const { data: userData } = await client.auth.getUser()
      const userId = userData.user?.id ?? null

      // Durable correlation: the run records the attempt BEFORE the wire is
      // touched. The lifecycle trigger enqueues an audit event on creation.
      const runId = await this.createRun(client, {
        investigationId: subject.investigation_id,
        subjectId,
        userId,
        correlationId,
        endpoint,
      })

      try {
        await this.progressRun(client, runId, { status: 'running' })
      } catch (error) {
        await this.failRun(client, runId, 'provider_error', `run_running_failed: ${String(error)}`)
        throw new AtlasServiceError(
          'IdentityResolution',
          'provider_failure',
          { stage: 'run_running', detail: String(error) },
          'Matching could not be started (search run transition failed)',
        )
      }

      const binary = atob(parsed.imageBase64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      const outcome = await this.transport(endpoint, {
        imageBlob: new Blob([bytes], { type: 'image/jpeg' }),
        frameWidth: parsed.frameWidth,
        frameHeight: parsed.frameHeight,
        correlationId,
        faceBox: parsed.faceBox,
        trackRef: String(trackId),
      })

      if (outcome.status !== 'ok') {
        await this.failRun(client, runId, outcome.status, outcome.message)
        await this.recordAudit(
          client,
          'identity.match',
          'subject',
          subjectId,
          organizationId,
          true,
          `run ${runId} correlation ${correlationId}: failed (${outcome.status})`,
        )
        throw new AtlasServiceError('IdentityResolution', 'provider_failure', {
          reason: outcome.status,
          correlationId,
          detail: outcome.message,
        }, FAILURE_COPY[outcome.status])
      }

      const matchedAt = new Date().toISOString()
      const fingerprints = await Promise.all(
        outcome.candidates.map((candidate) => sha256Hex(candidate.rawJson)),
      )

      // Batch-level dedup: identical provider candidates within one response
      // are collapsed deterministically; cross-run repeats stay distinct
      // because each carries its own run/timestamp provenance.
      const seen = new Set<string>()
      const unique: Array<{ candidate: ProviderCandidate; fingerprint: string }> = []
      for (let i = 0; i < outcome.candidates.length; i++) {
        const candidate = outcome.candidates[i]
        const key = `${candidate.providerCandidateId}::${candidate.externalReference}`
        if (!seen.has(key)) {
          seen.add(key)
          unique.push({ candidate, fingerprint: fingerprints[i] })
        }
      }

      let persisted: IdentityCandidate[]
      if (unique.length === 0) {
        persisted = []
      } else {
        const { data: rows, error: insertError } = await client
          .from('identity_candidates')
          .insert(
            unique.map(({ candidate, fingerprint }) => ({
              subject_id: subjectId,
              provider: hostOf(endpoint),
              external_reference: candidate.externalReference,
              display_name: candidate.displayName,
              // Providers may omit a score; 0 + score_supplied=false stays
              // honest (never a fabricated confidence value).
              match_confidence: candidate.score ?? 0,
              metadata: {
                signals: candidate.signals,
                score_supplied: candidate.score !== null,
              },
              media_asset_id: parsed.mediaAssetId ?? null,
              detected_face_id: parsed.detectedFaceId ?? null,
              track_ref: String(trackId),
              matched_at: matchedAt,
              provider_candidate_id: candidate.providerCandidateId,
              search_run_id: runId,
              raw_fingerprint: fingerprint,
            })),
          )
          .select('*')

        if (insertError !== null || rows === null) {
          // Provider succeeded but we cannot prove what it returned — fail
          // loudly and leave the run failed with a precise detail. No
          // candidate is created, no success is reported.
          const detail = insertError?.message ?? 'unknown persistence error'
          await this.failRun(client, runId, 'provider_error', `candidate_persistence_failed: ${detail}`)
          await this.recordAudit(
            client,
            'identity.match',
            'subject',
            subjectId,
            organizationId,
            true,
            `run ${runId} correlation ${correlationId}: persistence failed`,
          )
          throw new AtlasServiceError(
            'IdentityResolution',
            'provider_failure',
            { stage: 'persist_candidates', correlationId, detail },
            'Matching succeeded but recording the candidates failed — nothing was saved',
          )
        }

        persisted = (rows as CandidateRow[]).map((row) => mapCandidate(row))
      }

      await this.completeRun(client, runId, persisted.length)

      await this.recordAudit(
        client,
        'identity.match',
        'subject',
        subjectId,
        organizationId,
        true,
        `run ${runId} correlation ${correlationId}: ${persisted.length} candidates recorded`,
      )

      return { status: 'ok', candidates: persisted, runId, correlationId }
    } catch (error) {
      throw mapProviderError('IdentityResolution', error)
    }
  }

  /** Organization URL first, then deployment proxy, then direct endpoint. */
  private async resolveEndpoint(
    client: ReturnType<typeof requireSupabaseClient>,
  ): Promise<string | null> {
    try {
      const { data, error } = await client
        .from('organizations')
        .select('matching_provider_url')
        .single<{ matching_provider_url: string | null }>()
      if (!error && data?.matching_provider_url != null && data.matching_provider_url !== '') {
        return data.matching_provider_url
      }
    } catch {
      // fall through to deployment configuration
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
      userId: string | null
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
        query: `identity-match/${args.correlationId}`,
        status: 'queued',
        channel: 'identity_matching',
        provider: hostOf(args.endpoint),
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single<{ id: string }>()
    if (error !== null || data === null) {
      throw new AtlasServiceError(
        'IdentityResolution',
        'conflict',
        { stage: 'run_create', detail: error?.message },
        'Matching could not start: the search run could not be recorded',
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

  private async completeRun(client: ReturnType<typeof requireSupabaseClient>, runId: string, count: number): Promise<void> {
    await this.progressRun(
      client,
      runId,
      count > 0
        ? { status: 'completed', sources_found: count, facts_updated: 0, completed_at: new Date().toISOString() }
        : { status: 'no_results', completed_at: new Date().toISOString() },
    )
  }

  /** Best-effort terminal failure write; the ORIGINAL error always wins. */
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
      // The caller throws the primary failure regardless.
    }
  }

  async confirmCandidate(input: DecideCandidateInput): Promise<void> {
    await this.decide(input, 'confirmed')
  }

  async rejectCandidate(input: DecideCandidateInput): Promise<void> {
    await this.decide(input, 'rejected')
  }

  private async decide(input: DecideCandidateInput, decision: 'confirmed' | 'rejected'): Promise<void> {
    const parsed = parseOrThrow('IdentityResolution', decideCandidateInputSchema, input)
    const client = requireSupabaseClient('IdentityResolution')
    try {
      const { data: candidate, error } = await client
        .from('identity_candidates')
        .select(
          'id, subject_id, subjects!inner(authorization_state, investigation_id, investigations(organization_id))',
        )
        .eq('id', parsed.candidateId)
        .maybeSingle<{
          id: string
          subject_id: string
          subjects: {
            authorization_state: string
            investigation_id: string
            investigations?: { organization_id?: string } | null
          }
        }>()
      if (error !== null) throw error
      if (candidate === null) throw new AtlasServiceError('IdentityResolution', 'not_found')

      assertSubjectAuthorized(candidate.subject_id, candidate.subjects.authorization_state)

      const { data: userData } = await client.auth.getUser()
      const userId = userData.user?.id ?? null

      const { error: updateError } = await client
        .from('identity_candidates')
        .update({ match_status: decision })
        .eq('id', parsed.candidateId)
      if (updateError !== null) throw updateError

      const { error: confirmationError } = await client.from('identity_confirmations').insert({
        candidate_id: parsed.candidateId,
        decision,
        decided_by: userId,
        notes: parsed.notes ?? null,
      })
      if (confirmationError !== null) throw confirmationError

      if (decision === 'confirmed') {
        const { error: subjectError } = await client
          .from('subjects')
          .update({ identity_state: 'confirmed' })
          .eq('id', candidate.subject_id)
        if (subjectError !== null) throw subjectError
      }

      await this.recordAudit(
        client,
        decision === 'confirmed' ? 'identity.confirm' : 'identity.reject',
        'identity_candidate',
        parsed.candidateId,
        candidate.subjects.investigations?.organization_id ?? candidate.subjects.investigation_id,
        true,
      )
    } catch (error) {
      throw mapProviderError('IdentityResolution', error)
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
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint.slice(0, 100)
  }
}
