import type { z } from 'zod'
import type { IdentityCandidate } from '../types'
import {
  decideCandidateInputSchema,
  findCandidatesInputSchema,
} from './schemas'
import { AuthorizationRequiredError, ProviderNotConfiguredError } from './errors'

/**
 * Identity resolution service boundary.
 *
 * Candidate search runs ONLY against authorized identity providers for
 * subjects whose authorization state is `authorized`. Any other state
 * (`undeclared`, `restricted`, `revoked`) raises AuthorizationRequiredError
 * before any provider is contacted. Analysts must explicitly confirm or
 * reject candidates; a confirmation is durably recorded.
 *
 * In production this is backed by the application API (Supabase), which
 * enforces the same rules with RLS policies and triggers.
 */
export type FindCandidatesInput = z.infer<typeof findCandidatesInputSchema>
export type DecideCandidateInput = z.infer<typeof decideCandidateInputSchema>

/**
 * Input for authorized identity matching.
 *
 * `mediaAssetId` / `detectedFaceId` are internal provenance pointers — they
 * are recorded on persisted candidates but NEVER sent to the external
 * provider. Only frame bytes, dimensions, the face box, the track reference,
 * and a correlation id cross the wire.
 */
export interface MatchIdentityInput {
  subjectId: string
  /** The face track ID from FaceTrackingService to match */
  trackId: number
  /** Base64-encoded image data (JPEG) for matching */
  imageBase64: string
  /** Frame dimensions for coordinate normalization */
  frameWidth: number
  frameHeight: number
  /** Normalized bounding box of the selected face, when available. */
  faceBox?: { x: number; y: number; width: number; height: number }
  /** Durable media asset this frame was stored under, when available. */
  mediaAssetId?: string
  /** Detected face row id, when available. */
  detectedFaceId?: string
}

/**
 * Result of an authorized identity match.
 *
 * `ok`        - provider answered within contract; candidates below are the
 *               PERSISTED rows (provider output recorded server-side).
 * `not_configured` - no matching endpoint exists for this deployment or
 *               organization. No search run is created, no candidate is
 *               written, no success audit event is emitted.
 *
 * Every failure mode (timeout / rate limit / auth / provider error /
 * malformed response / network / persistence failure) THROWS a typed
 * AtlasServiceError after recording a failed search run — silence is never
 * an outcome.
 */
export type MatchIdentityResult =
  | { status: 'ok'; candidates: IdentityCandidate[]; runId: string; correlationId: string }
  | { status: 'not_configured' }

/** Authorized identity matching transport boundary (wire-level). */
export interface IdentityMatchingTransport {
  readonly name: string
}

export interface IdentityResolutionService {
  /** Find existing candidates for an authorized subject. */
  findCandidates(input: FindCandidatesInput): Promise<IdentityCandidate[]>
  /** Match a face against enrolled/authorized records. */
  matchIdentity(input: MatchIdentityInput): Promise<MatchIdentityResult>
  /** Records an analyst confirmation and marks the candidate confirmed. */
  confirmCandidate(input: DecideCandidateInput): Promise<void>
  /** Records an analyst rejection and marks the candidate rejected. */
  rejectCandidate(input: DecideCandidateInput): Promise<void>
}

export class UnconfiguredIdentityResolutionService implements IdentityResolutionService {
  async findCandidates(): Promise<IdentityCandidate[]> {
    throw new ProviderNotConfiguredError('IdentityResolution')
  }

  async matchIdentity(): Promise<MatchIdentityResult> {
    throw new ProviderNotConfiguredError('IdentityResolution')
  }

  async confirmCandidate(): Promise<void> {
    throw new ProviderNotConfiguredError('IdentityResolution')
  }

  async rejectCandidate(): Promise<void> {
    throw new ProviderNotConfiguredError('IdentityResolution')
  }
}

/** Shared guard used by every provider implementation. */
export function assertSubjectAuthorized(
  subjectId: string,
  authorizationState: string | null | undefined,
): void {
  if (authorizationState !== 'authorized') {
    throw new AuthorizationRequiredError(
      'IdentityResolution',
      subjectId,
      authorizationState ?? 'unknown',
    )
  }
}

/** Valid candidate lifecycle states. */
export type CandidateState = 'pending' | 'confirmed' | 'rejected'

/** Valid state transitions for candidates. */
export const VALID_CANDIDATE_TRANSITIONS: Record<CandidateState, CandidateState[]> = {
  pending: ['confirmed', 'rejected'],
  confirmed: [],
  rejected: [],
}

/** Check if a candidate state transition is valid. */
export function isValidCandidateTransition(
  from: CandidateState,
  to: CandidateState,
): boolean {
  return VALID_CANDIDATE_TRANSITIONS[from]?.includes(to) ?? false
}
