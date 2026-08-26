export type Role = 'administrator' | 'analyst' | 'viewer'

export interface Organization {
  id: string
  name: string
  slug: string
  createdAt: string
}

export interface UserProfile {
  id: string
  userId: string
  fullName: string
  email: string
  avatarUrl: string | null
  role: Role
  organizationId: string
}

export type InvestigationStatus = 'active' | 'in_review' | 'closed' | 'archived'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface Investigation {
  id: string
  organizationId: string
  createdBy: string
  title: string
  description: string
  status: InvestigationStatus
  riskLevel: RiskLevel
  subjectIds: string[]
  createdAt: string
  updatedAt: string
}

/**
 * CRITICAL PRIVACY MODEL — every subject carries an explicit authorization
 * state. Identity resolution may only run when the state is `authorized`;
 * the service layer, database RLS, and triggers all enforce this.
 */
export type SubjectAuthorization = 'undeclared' | 'authorized' | 'restricted' | 'revoked'

export type IdentityState = 'confirmed' | 'probable' | 'candidate' | 'unresolved'

export interface InvestigationSubject {
  id: string
  investigationId: string
  label: string
  authorizationState: SubjectAuthorization
  authorizationBasis: string
  identityState: IdentityState
  profileId: string | null
  evidenceCount: number
  lastActivityAt: string
  createdAt: string
}

export interface IdentityConfirmation {
  id: string
  candidateId: string
  decision: 'confirmed' | 'rejected'
  decidedBy: string
  decidedAt: string
  notes: string | null
}

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface DetectedFace {
  id: string
  trackingId: number
  boundingBox: BoundingBox
  confidence: number
  orientation: 'frontal' | 'left' | 'right'
  frameTimestamp: number
}

/** A detected face with tracking metadata and lifecycle state. */
export interface TrackedFace extends DetectedFace {
  trackId: number
  state: 'ACTIVE' | 'TEMPORARILY_LOST' | 'EXPIRED'
  firstSeenAt: number
  lastSeenAt: number
  framesSinceDetection: number
  consecutiveFramesDetected: number
}

export type MatchStatus = 'pending' | 'confirmed' | 'rejected'

export interface IdentityCandidate {
  id: string
  subjectId: string
  provider: string
  externalReference: string
  displayName: string
  matchConfidence: number
  /** Provider assertion only — never a confirmed identity on its own. */
  matchStatus: MatchStatus
  signals: string[]
  /** Matching provenance: what produced the query this candidate came from. */
  mediaAssetId?: string | null
  detectedFaceId?: string | null
  trackRef?: string | null
  matchedAt?: string | null
  /** The upstream provider's own identifier for this candidate. */
  providerCandidateId?: string | null
  /** Durable search_runs correlation for the matching attempt. */
  searchRunId?: string | null
  /** SHA-256 over the canonical JSON of the raw provider candidate. */
  rawFingerprint?: string | null
  createdAt: string
}

/** Search-run lifecycle. Terminal states are terminal. */
export type SearchRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'no_results'

export type SearchFailureReason =
  | 'timeout'
  | 'rate_limited'
  | 'auth_failed'
  | 'provider_error'
  | 'invalid_response'
  | 'network'

export type FactCategory =
  | 'employment'
  | 'education'
  | 'organization'
  | 'public_profile'
  | 'website'
  | 'publication'
  | 'social_presence'
  | 'location'
  | 'news_mention'

export type VerificationStatus = 'verified' | 'corroborated' | 'unverified' | 'disputed'
export type FactOrigin = 'source_fact' | 'ai_summary' | 'analyst_annotation' | 'inference'

export interface IntelligenceFact {
  id: string
  profileId: string
  category: FactCategory
  label: string
  value: string
  confidence: number
  sourceCount: number
  verificationStatus: VerificationStatus
  origin: FactOrigin
  sourceIds: string[]
  firstObservedAt: string
  lastVerifiedAt: string
  /** Provider-native result identifier — provenance pointer, not an FK. */
  providerResultId?: string | null
  /** The provider's claimed score, verbatim, or null when it gave none. */
  providerConfidence?: number | null
  /** Durable search_runs correlation for the ingestion run. */
  searchRunId?: string | null
}

export interface IntelligenceProfile {
  id: string
  subjectId: string
  canonicalName: string
  summary: string
  identityState: IdentityState
  confidenceScore: number
  avatarColor: string
  initials: string
  lastResolvedAt: string
  updatedAt: string
}

export type SourceType =
  | 'web_search'
  | 'professional_profile'
  | 'news'
  | 'org_registry'
  | 'public_website'
  | 'org_dataset'

export interface Source {
  id: string
  organizationId: string
  provider: string
  sourceName: string
  canonicalUrl: string
  sourceType: SourceType
  credibilityScore: number
  retrievedAt: string
  /** Provenance fields */
  searchRunId?: string | null
  contentHash?: string | null
  publishedAt?: string | null
  originalUrl?: string | null
  status: 'active' | 'invalidated' | 'revoked'
}

export interface EvidenceItem {
  id: string
  investigationId: string
  subjectId: string | null
  sourceId: string
  factId: string | null
  claim: string
  confidence: number
  evidenceType: 'document' | 'web_page' | 'registry_record' | 'media' | 'analyst_note'
  capturedAt: string
}

export interface TimelineEvent {
  id: string
  profileId: string
  year: number
  date: string
  title: string
  category: FactCategory
  sourceIds: string[]
  evidenceStrength: 'strong' | 'moderate' | 'weak'
}

export type NetworkNodeType = 'person' | 'organization' | 'website' | 'publication' | 'event'

export interface NetworkNode {
  id: string
  profileId: string
  type: NetworkNodeType
  label: string
  sublabel: string
}

export interface NetworkEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  relationship: string
  strength: number
  evidenceIds: string[]
}

/** Durable audit event as stored in audit_events (server-side). */
export interface AuditEvent {
  id: string
  organizationId: string
  actor: string
  action: string
  detail: string
  resourceType: string
  resourceId: string | null
  sensitive: boolean
  timestamp: string
}

export type ConnectorStatus = 'connected' | 'degraded' | 'not_configured' | 'paused'

export interface Connector {
  id: string
  provider: string
  category: string
  status: ConnectorStatus
  lastSync: string | null
  rateLimit: string
  authorizationStatus: 'authorized' | 'pending' | 'expired'
  description: string
}
