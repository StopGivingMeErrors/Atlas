import type { z } from 'zod'
import type { IntelligenceFact, IntelligenceProfile, Source } from '../types'
import {
  getProfileInputSchema,
  publicInformationSearchInputSchema,
  searchPersonInputSchema,
} from './schemas'
import type { SearchFailureReason } from './searchRuns'
import { ProviderNotConfiguredError } from './errors'

/**
 * Public-information research service boundary.
 *
 * Production implementations call backend connector services through a
 * versioned external contract. Every ingested source and fact preserves
 * full provenance: provider, search run, retrieval timestamp, provider-
 * native identifiers, and confidence ONLY when the provider supplied it.
 *
 * Profiles are resolution outputs: reads and research against a profile
 * whose subject is not `authorized` fail with AuthorizationRequiredError
 * before any connector or query runs.
 */
export type SearchPersonInput = z.infer<typeof searchPersonInputSchema>
export type GetProfileInput = z.infer<typeof getProfileInputSchema>
export type PublicInformationSearchInput = z.infer<typeof publicInformationSearchInputSchema>

export type ResearchChannel =
  | 'professional_profile'
  | 'news'
  | 'public_website'
  | 'org_registry'
  | 'org_dataset'

/**
 * Outcome of one orchestrated external research run.
 *
 * - `not_configured` is an application configuration state, NEVER a
 *   search_run status: nothing ran, nothing was recorded.
 * - Every other terminal state corresponds to a durable search_runs row
 *   (completed / no_results / failed with a structured reason).
 */
export type PublicInformationSearchResult =
  | {
      status: 'ok'
      runId: string
      correlationId: string
      sources: Source[]
      factCount: number
    }
  | { status: 'no_results'; runId: string; correlationId: string }
  | { status: 'not_configured' }
  | {
      status: 'failed'
      reason: SearchFailureReason
      message: string
      runId: string
      correlationId: string
    }

export interface PublicInformationService {
  /** Workspace people — only profiles whose subject is authorized. */
  listProfiles(): Promise<IntelligenceProfile[]>
  /** Single profile; gated on the subject's authorization state. */
  getProfile(input: GetProfileInput): Promise<IntelligenceProfile>
  /** Full fact set for a profile, each fact carrying its supporting source IDs. */
  searchPerson(input: SearchPersonInput): Promise<IntelligenceFact[]>
  /**
   * Orchestrated external research run through the real search_runs
   * lifecycle. Authorization is enforced BEFORE anything is written or
   * sent; an unconfigured deployment returns `not_configured` without
   * recording anything at all.
   */
  searchExternal(input: PublicInformationSearchInput): Promise<PublicInformationSearchResult>
}

export class UnconfiguredPublicInformationService implements PublicInformationService {
  async listProfiles(): Promise<IntelligenceProfile[]> {
    throw new ProviderNotConfiguredError('PublicInformation')
  }

  async getProfile(): Promise<IntelligenceProfile> {
    throw new ProviderNotConfiguredError('PublicInformation')
  }

  async searchPerson(): Promise<IntelligenceFact[]> {
    throw new ProviderNotConfiguredError('PublicInformation')
  }

  async searchExternal(): Promise<PublicInformationSearchResult> {
    // Honest no-op: no run row, no wire call, no audit success — matching
    // the identity resolution boundary behavior exactly.
    return { status: 'not_configured' }
  }
}
