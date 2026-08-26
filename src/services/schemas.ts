/**
 * Explicit input/output schemas for every Atlas service boundary.
 *
 * All provider implementations MUST validate data crossing the boundary
 * with these schemas: inputs before dispatch, outputs before returning
 * to the UI. This is the contract that keeps demo fixtures, the database,
 * and future external providers interchangeable.
 */
import { z } from 'zod'

/* ---------- primitives ---------- */

/** Opaque identifier. Database rows use uuids; test/dev fixtures may use slugs. */
export const idSchema = z.string().min(1, 'identifier must not be empty')

export const confidenceSchema = z.number().min(0).max(1)

export const timestampSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be a parseable ISO datetime')

/* ---------- enumerated domains ---------- */

export const roleSchema = z.enum(['administrator', 'analyst', 'viewer'])
export const investigationStatusSchema = z.enum(['active', 'in_review', 'closed', 'archived'])
export const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical'])

/** CRITICAL PRIVACY MODEL — explicit authorization lifecycle. */
export const subjectAuthorizationSchema = z.enum([
  'undeclared',
  'authorized',
  'restricted',
  'revoked',
])

export const identityStateSchema = z.enum(['confirmed', 'probable', 'candidate', 'unresolved'])
export const matchStatusSchema = z.enum(['pending', 'confirmed', 'rejected'])
export const decisionSchema = z.enum(['confirmed', 'rejected'])
export const orientationSchema = z.enum(['frontal', 'left', 'right'])
export const verificationStatusSchema = z.enum(['verified', 'corroborated', 'unverified', 'disputed'])
export const factOriginSchema = z.enum(['source_fact', 'ai_summary', 'analyst_annotation', 'inference'])
export const factCategorySchema = z.enum([
  'employment',
  'education',
  'organization',
  'public_profile',
  'website',
  'publication',
  'social_presence',
  'location',
  'news_mention',
])
export const sourceTypeSchema = z.enum([
  'web_search',
  'professional_profile',
  'news',
  'org_registry',
  'public_website',
  'org_dataset',
])
export const evidenceTypeSchema = z.enum([
  'document',
  'web_page',
  'registry_record',
  'media',
  'analyst_note',
])
export const connectorStatusSchema = z.enum(['connected', 'degraded', 'not_configured', 'paused'])
export const connectorAuthorizationSchema = z.enum(['authorized', 'pending', 'expired'])

export const searchRunStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'no_results',
])

/**
 * Structured failure classification for FAILED search runs. A failed run is
 * never conflated with no_results, and provider-not-configured never becomes
 * a run at all.
 */
export const searchFailureReasonSchema = z.enum([
  'timeout',
  'rate_limited',
  'auth_failed',
  'provider_error',
  'invalid_response',
  'network',
])

export const sourceStatusSchema = z.enum(['active', 'invalidated', 'revoked'])

/* ---------- entity schemas ---------- */

export const organizationSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  createdAt: timestampSchema,
})

export const userProfileSchema = z.object({
  id: idSchema,
  userId: idSchema,
  fullName: z.string().min(1),
  email: z.string().email(),
  avatarUrl: z.string().nullable(),
  role: roleSchema,
  organizationId: idSchema,
})

export const investigationSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  createdBy: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  status: investigationStatusSchema,
  riskLevel: riskLevelSchema,
  subjectIds: z.array(idSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const investigationSubjectSchema = z.object({
  id: idSchema,
  investigationId: idSchema,
  label: z.string().min(1),
  authorizationState: subjectAuthorizationSchema,
  authorizationBasis: z.string(),
  identityState: identityStateSchema,
  profileId: idSchema.nullable(),
  evidenceCount: z.number().int().min(0),
  lastActivityAt: timestampSchema,
  createdAt: timestampSchema,
})

export const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
})

export const detectedFaceSchema = z.object({
  id: idSchema,
  trackingId: z.number().int(),
  boundingBox: boundingBoxSchema,
  confidence: confidenceSchema,
  orientation: orientationSchema,
  frameTimestamp: z.number(),
})

export const identityCandidateSchema = z.object({
  id: idSchema,
  subjectId: idSchema,
  provider: z.string().min(1),
  externalReference: z.string().min(1),
  displayName: z.string().min(1),
  matchConfidence: confidenceSchema,
  /** Provider assertion only — confirmation is a separate analyst decision. */
  matchStatus: matchStatusSchema,
  signals: z.array(z.string()),
  /** Matching provenance — present when the candidate's origin was captured. */
  mediaAssetId: idSchema.nullable().optional(),
  detectedFaceId: idSchema.nullable().optional(),
  trackRef: z.string().nullable().optional(),
  matchedAt: timestampSchema.nullable().optional(),
  /** The upstream provider's own identifier for this candidate. */
  providerCandidateId: z.string().nullable().optional(),
  /** Durable search_runs correlation for the matching attempt. */
  searchRunId: idSchema.nullable().optional(),
  /** SHA-256 over the canonical JSON of what the provider returned. */
  rawFingerprint: z.string().nullable().optional(),
  createdAt: timestampSchema,
})

export const identityConfirmationSchema = z.object({
  id: idSchema,
  candidateId: idSchema,
  decision: decisionSchema,
  decidedBy: z.string().min(1),
  decidedAt: timestampSchema,
  notes: z.string().nullable(),
})

export const intelligenceFactSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  category: factCategorySchema,
  label: z.string().min(1),
  value: z.string().min(1),
  confidence: confidenceSchema,
  sourceCount: z.number().int().min(0),
  verificationStatus: verificationStatusSchema,
  origin: factOriginSchema,
  sourceIds: z.array(idSchema),
  firstObservedAt: timestampSchema,
  lastVerifiedAt: timestampSchema,
  /** Provider-native result identifier — provenance pointer, not an FK. */
  providerResultId: z.string().nullable().optional(),
  /** The provider's claimed score, verbatim, or null when it gave none. */
  providerConfidence: confidenceSchema.nullable().optional(),
  /** Durable search_runs correlation for the ingestion run. */
  searchRunId: idSchema.nullable().optional(),
})

export const intelligenceProfileSchema = z.object({
  id: idSchema,
  subjectId: idSchema,
  canonicalName: z.string().min(1),
  summary: z.string(),
  identityState: identityStateSchema,
  confidenceScore: confidenceSchema,
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/),
  initials: z.string().min(1).max(4),
  lastResolvedAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const sourceSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  provider: z.string().min(1),
  sourceName: z.string().min(1),
  canonicalUrl: z.string().url(),
  sourceType: sourceTypeSchema,
  credibilityScore: confidenceSchema,
  /** First retrieval — immutable provenance. */
  retrievedAt: timestampSchema,
  searchRunId: idSchema.nullable().optional(),
  contentHash: z.string().nullable().optional(),
  /** Stored only when the provider supplied it; never fabricated. */
  publishedAt: timestampSchema.nullable().optional(),
  originalUrl: z.string().nullable().optional(),
  status: sourceStatusSchema.optional().default('active'),
})

export const evidenceItemSchema = z.object({
  id: idSchema,
  investigationId: idSchema,
  subjectId: idSchema.nullable(),
  sourceId: idSchema,
  factId: idSchema.nullable(),
  claim: z.string().min(1),
  confidence: confidenceSchema,
  evidenceType: evidenceTypeSchema,
  capturedAt: timestampSchema,
})

export const auditEventSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  actor: z.string().min(1),
  action: z.string().min(1),
  detail: z.string(),
  resourceType: z.string().min(1),
  resourceId: idSchema.nullable(),
  sensitive: z.boolean(),
  timestamp: timestampSchema,
})

export const connectorSchema = z.object({
  id: idSchema,
  provider: z.string().min(1),
  category: z.string().min(1),
  status: connectorStatusSchema,
  lastSync: timestampSchema.nullable(),
  rateLimit: z.string(),
  authorizationStatus: connectorAuthorizationSchema,
  description: z.string(),
})

/* ---------- input schemas ---------- */

export const detectFacesInputSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  timestamp: z.number().nonnegative(),
  /** Base64-encoded image data (JPEG/PNG/WebP) */
  imageBase64: z.string().min(1),
})

export const trackFacesInputSchema = z.object({
  faces: z.array(detectedFaceSchema),
})

export const findCandidatesInputSchema = z.object({
  subjectId: idSchema,
})

export const decideCandidateInputSchema = z.object({
  candidateId: idSchema,
  notes: z.string().max(2000).optional(),
})

export const matchIdentityInputSchema = z.object({
  subjectId: idSchema,
  trackId: z.number().int().positive(),
  imageBase64: z.string().min(1),
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
  faceBox: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
    })
    .optional(),
  mediaAssetId: idSchema.optional(),
  detectedFaceId: idSchema.optional(),
})

export type MatchIdentityInput = z.infer<typeof matchIdentityInputSchema>

export const searchPersonInputSchema = z.object({
  profileId: idSchema,
})

export const getProfileInputSchema = z.object({
  profileId: idSchema,
})

export const profileChannelInputSchema = z.object({
  profileId: idSchema,
  channel: z.enum([
    'professional_profile',
    'news',
    'public_website',
    'org_registry',
    'org_dataset',
  ]),
})

/** Input for an orchestrated external public-information research run. */
export const publicInformationSearchInputSchema = profileChannelInputSchema

export const listSourcesInputSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
})

export const searchRunInputSchema = z.object({
  profileId: idSchema,
  channel: z.string(),
})

/**
 * Input for updating search run status. Terminal states are terminal;
 * failed runs require a structured failure reason.
 */
export const updateSearchRunStatusInputSchema = z
  .object({
    searchRunId: idSchema,
    status: searchRunStatusSchema,
    failureReason: searchFailureReasonSchema.optional(),
    errorMessage: z.string().max(2000).optional(),
    sourcesFound: z.number().int().min(0).optional(),
    factsUpdated: z.number().int().min(0).optional(),
  })
  .refine((input) => input.status !== 'failed' || input.failureReason !== undefined, {
    message: 'a failed search run requires a failureReason',
  })

export const listEvidenceByInvestigationInputSchema = z.object({
  investigationId: idSchema,
})

export const listEvidenceBySubjectInputSchema = z.object({
  subjectId: idSchema,
})

export const listEvidenceForFactInputSchema = z.object({
  factId: idSchema,
})

export const addEvidenceInputSchema = z.object({
  investigationId: idSchema,
  subjectId: idSchema.nullable().optional(),
  /** Atlas lineage requires every evidence item to name its source. */
  sourceId: idSchema,
  factId: idSchema.nullable().optional(),
  claim: z.string().min(3).max(2000),
  confidence: confidenceSchema,
  evidenceType: evidenceTypeSchema,
})

export const getInvestigationInputSchema = z.object({
  id: idSchema,
})

export const listSubjectsInputSchema = z.object({
  investigationId: idSchema,
})

export const getSubjectInputSchema = z.object({
  subjectId: idSchema,
})

export const createSubjectInputSchema = z
  .object({
    investigationId: idSchema,
    label: z.string().min(1).max(120),
    authorizationState: subjectAuthorizationSchema.default('undeclared'),
    authorizationBasis: z.string().max(2000).optional(),
  })
  .refine(
    (input) =>
      input.authorizationState === 'undeclared' ||
      input.authorizationState === 'revoked' ||
      (input.authorizationBasis !== undefined && input.authorizationBasis.trim().length > 0),
    { message: 'authorizationBasis is required when granting or restricting access' },
  )

export const createInvestigationInputSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(4000).default(''),
  riskLevel: riskLevelSchema.default('low'),
})

/**
 * Authorization transitions require a recorded basis whenever access is
 * granted or restricted — UNDECLARED and REVOKED need no justification.
 */
export const updateSubjectAuthorizationInputSchema = z
  .object({
    subjectId: idSchema,
    authorizationState: subjectAuthorizationSchema,
    authorizationBasis: z.string().max(2000).optional(),
  })
  .refine(
    (input) =>
      input.authorizationState === 'undeclared' ||
      input.authorizationState === 'revoked' ||
      (input.authorizationBasis !== undefined && input.authorizationBasis.trim().length > 0),
    { message: 'authorizationBasis is required when granting or restricting access' },
  )

export const recordAuditInputSchema = z.object({
  action: z.string().min(1).max(120),
  resourceType: z.string().min(1).max(80),
  resourceId: idSchema.nullable().optional(),
  detail: z.string().max(2000).default(''),
  sensitive: z.boolean().default(false),
})

export const listAuditEventsInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(100),
  sensitiveOnly: z.boolean().default(false),
})
