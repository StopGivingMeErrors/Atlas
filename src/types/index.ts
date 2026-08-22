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

export type ConsentStatus = 'consented' | 'org_authorized' | 'legal_basis' | 'pending_review'
export type IdentityState = 'confirmed' | 'probable' | 'candidate' | 'unresolved'

export interface InvestigationSubject {
  id: string
  investigationId: string
  label: string
  consentStatus: ConsentStatus
  authorizationBasis: string
  identityState: IdentityState
  profileId: string | null
  evidenceCount: number
  lastActivityAt: string
  createdAt: string
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

export type MatchStatus = 'pending' | 'confirmed' | 'rejected'

export interface IdentityCandidate {
  id: string
  subjectId: string
  provider: string
  externalReference: string
  displayName: string
  matchConfidence: number
  matchStatus: MatchStatus
  signals: string[]
  createdAt: string
}

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

export type SourceType = 'web_search' | 'professional_profile' | 'news' | 'org_registry' | 'public_website' | 'org_dataset'

export interface Source {
  id: string
  organizationId: string
  provider: string
  sourceName: string
  canonicalUrl: string
  sourceType: SourceType
  credibilityScore: number
  retrievedAt: string
}

export interface EvidenceItem {
  id: string
  investigationId: string
  subjectId: string
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

export interface ActivityEvent {
  id: string
  organizationId: string
  actor: string
  action: string
  detail: string
  resourceType: string
  timestamp: string
  sensitive: boolean
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

export interface Collection {
  id: string
  name: string
  description: string
  itemCount: number
  updatedAt: string
}
