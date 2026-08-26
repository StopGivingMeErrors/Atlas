/**
 * DEV-ONLY demo service providers.
 *
 * Loaded exclusively by the composition root when a development build runs
 * with VITE_ATLAS_DEMO_FIXTURES=true. Never reachable in production bundles:
 * the dynamic import lives behind `atlasConfig.demoFixturesAllowed`, which is
 * statically false outside development.
 *
 * Demo providers implement exactly the same service contracts as the
 * production Supabase providers — identical input validation, identical
 * output schemas, identical authorization gates — but run against fictional
 * fixtures from /dev/fixtures in in-memory state.
 */
import type {
  AuditEvent,
  Connector,
  DetectedFace,
  EvidenceItem,
  IdentityCandidate,
  IdentityConfirmation,
  IntelligenceFact,
  IntelligenceProfile,
  Investigation,
  InvestigationSubject,
  Organization,
  Source,
  UserProfile,
} from '../../src/types'
import { AtlasServiceError } from '../../src/services/errors'
import {
  assertSubjectAuthorized,
  type DecideCandidateInput,
  type FindCandidatesInput,
  type IdentityResolutionService,
  type MatchIdentityInput,
  type MatchIdentityResult,
} from '../../src/services/identityResolution'
import {
  decideCandidateInputSchema,
  identityConfirmationSchema,
  matchIdentityInputSchema,
} from '../../src/services/schemas'
import {
type GetProfileInput,
type PublicInformationSearchResult,
type PublicInformationService,
type SearchPersonInput,
} from '../../src/services/publicInformation'
import type { ListSourcesInput, SourceService } from '../../src/services/sources'
import {
  type AddEvidenceInput,
  type EvidenceService,
  type ListEvidenceByInvestigationInput,
  type ListEvidenceBySubjectInput,
  type ListEvidenceForFactInput,
} from '../../src/services/evidence'
import {
  type CreateInvestigationInput,
  type CreateSubjectInput,
  type GetInvestigationInput,
  type GetSubjectInput,
  type InvestigationService,
  type ListSubjectsInput,
  type UpdateSubjectAuthorizationInput,
} from '../../src/services/investigations'
import {
  type AuditService,
  type ListAuditEventsInput,
  type RecordAuditInput,
} from '../../src/services/audit'
import {
  signInInputSchema,
  signUpInputSchema,
  type AuthService,
  type SessionInfo,
  type SignInInput,
  type SignUpInput,
} from '../../src/services/auth'
import {
  ProviderBackedFaceDetectionService,
  type DetectFacesInput,
  type FaceDetectionProvider,
} from '../../src/services/faceDetection'
import {
  addEvidenceInputSchema,
  auditEventSchema,
  createInvestigationInputSchema,
  createSubjectInputSchema,
  detectedFaceSchema,
  evidenceItemSchema,
  findCandidatesInputSchema,
  getInvestigationInputSchema,
  getProfileInputSchema,
  getSubjectInputSchema,
  investigationSchema,
  investigationSubjectSchema,
  listAuditEventsInputSchema,
  listEvidenceByInvestigationInputSchema,
  listEvidenceBySubjectInputSchema,
  listEvidenceForFactInputSchema,
  listSourcesInputSchema,
  listSubjectsInputSchema,
  recordAuditInputSchema,
  searchPersonInputSchema,
  updateSubjectAuthorizationInputSchema,
} from '../../src/services/schemas'
import { parseOrThrow } from '../../src/services/supabase/rows'
import * as fixtureData from '../fixtures/demo-data'

/* ---------- shared in-memory backend ---------- */

interface DemoState {
  organizations: Organization[]
  currentUser: UserProfile
  investigations: Investigation[]
  subjects: InvestigationSubject[]
  profiles: IntelligenceProfile[]
  sources: Source[]
  facts: IntelligenceFact[]
  candidates: IdentityCandidate[]
  confirmations: IdentityConfirmation[]
  evidence: EvidenceItem[]
  connectors: Connector[]
  auditEvents: AuditEvent[]
}

function cloneState(): DemoState {
  return structuredClone({
    organizations: fixtureData.organizations,
    currentUser: fixtureData.currentUser,
    investigations: fixtureData.investigations,
    subjects: fixtureData.subjects,
    profiles: fixtureData.profiles,
    sources: fixtureData.sources,
    facts: fixtureData.facts,
    candidates: fixtureData.candidates,
    confirmations: [] as IdentityConfirmation[],
    evidence: fixtureData.evidence,
    connectors: fixtureData.connectors,
    auditEvents: fixtureData.auditEvents,
  })
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** Deterministic PRNG so repeated identical frames yield stable results. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class DemoBackend {
  readonly state = cloneState()
  readonly session: { user: UserProfile | null } = { user: null }
  private seq = 100

  nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${this.seq}`
  }

  get actor(): string {
    return this.session.user?.fullName ?? this.state.currentUser.fullName
  }

  get organizationId(): string {
    return this.session.user?.organizationId ?? this.state.currentUser.organizationId
  }

  subjectById(id: string): InvestigationSubject | undefined {
    return this.state.subjects.find((subject) => subject.id === id)
  }

  profileById(id: string): IntelligenceProfile | undefined {
    return this.state.profiles.find((profile) => profile.id === id)
  }

  pushAudit(input: RecordAuditInput): AuditEvent {
    const event = parseOrThrow('Audit', auditEventSchema, {
      id: this.nextId('act'),
      organizationId: this.organizationId,
      actor: this.actor,
      action: input.action,
      detail: input.detail,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      sensitive: input.sensitive,
      timestamp: new Date().toISOString(),
    })
    this.state.auditEvents.unshift(event)
    return event
  }
}

/* ---------- face detection (demo provider, dev only) ---------- */

class DemoFaceDetectionProvider implements FaceDetectionProvider {
  readonly name = 'Demo Detection Provider'
  private seq = 0

  async detect(input: DetectFacesInput): Promise<DetectedFace[]> {
    const rand = mulberry32(
      Math.floor(input.width * 7 + input.height * 13 + input.timestamp),
    )
    const orientations = ['frontal', 'left', 'right'] as const
    const count = 1 + Math.round(rand())
    const faces: DetectedFace[] = []
    for (let i = 0; i < count; i += 1) {
      this.seq += 1
      faces.push(
        parseOrThrow('FaceDetection', detectedFaceSchema, {
          id: `demo-face-${this.seq}`,
          trackingId: i + 1,
          boundingBox: {
            x: Math.round(input.width * rand() * 0.72),
            y: Math.round(input.height * rand() * 0.55),
            width: Math.round(input.width * (0.16 + rand() * 0.08)),
            height: Math.round(input.height * (0.22 + rand() * 0.12)),
          },
          confidence: Number((0.62 + rand() * 0.33).toFixed(3)),
          orientation: orientations[Math.floor(rand() * orientations.length)],
          frameTimestamp: input.timestamp,
        }),
      )
    }
    await delay(450)
    return faces
  }
}

/* ---------- auth ---------- */

const SESSION_STORAGE_KEY = 'atlas.demo.session'

class DemoAuthService implements AuthService {
  private readonly backend: DemoBackend

  constructor(backend: DemoBackend) {
    this.backend = backend
  }

  private sessionForEmail(email: string): SessionInfo {
    return structuredClone({
      user: { ...this.backend.state.currentUser, email },
      organizations: this.backend.state.organizations,
    })
  }

  private persist(email: string | null): void {
    if (typeof window === 'undefined') return
    if (email === null) window.localStorage.removeItem(SESSION_STORAGE_KEY)
    else window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(email))
  }

  async getSession(): Promise<SessionInfo | null> {
    const stored =
      typeof window === 'undefined' ? null : window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (stored === null) return null
    try {
      const email: unknown = JSON.parse(stored)
      if (typeof email !== 'string') throw new Error('malformed demo session')
      await delay(120)
      const info = this.sessionForEmail(email)
      this.backend.session.user = structuredClone(info.user)
      return info
    } catch {
      this.persist(null)
      return null
    }
  }

  /** Demo mode accepts any well-formed credentials. */
  async signIn(input: SignInInput): Promise<SessionInfo> {
    parseOrThrow('Auth', signInInputSchema, input)
    await delay(450)
    const email = input.email.toLowerCase()
    this.persist(email)
    const info = this.sessionForEmail(email)
    this.backend.session.user = structuredClone(info.user)
    return info
  }

  async signUp(input: SignUpInput): Promise<SessionInfo | null> {
    parseOrThrow('Auth', signUpInputSchema, input)
    await delay(650)
    const email = input.email.toLowerCase()
    this.persist(email)
    const info = structuredClone({
      user: { ...this.backend.state.currentUser, fullName: input.fullName, email },
      organizations: this.backend.state.organizations,
    })
    this.backend.session.user = structuredClone(info.user)
    return info
  }

  async signOut(): Promise<void> {
    await delay(150)
    this.persist(null)
    this.backend.session.user = null
  }
}

/* ---------- identity resolution ---------- */

class DemoIdentityResolutionService implements IdentityResolutionService {
  private readonly backend: DemoBackend

  constructor(backend: DemoBackend) {
    this.backend = backend
  }

  async findCandidates(input: FindCandidatesInput): Promise<IdentityCandidate[]> {
    const parsed = parseOrThrow('IdentityResolution', findCandidatesInputSchema, input)
    const subject = this.backend.subjectById(parsed.subjectId)
    if (subject === undefined) throw new AtlasServiceError('IdentityResolution', 'not_found')
    assertSubjectAuthorized(subject.id, subject.authorizationState)
    await delay(500)
    return structuredClone(
      this.backend.state.candidates.filter((candidate) => candidate.subjectId === subject.id),
    )
  }

  async matchIdentity(input: MatchIdentityInput): Promise<MatchIdentityResult> {
    const parsed = parseOrThrow('IdentityResolution', matchIdentityInputSchema, input)
    const subject = this.backend.subjectById(parsed.subjectId)
    if (subject === undefined) throw new AtlasServiceError('IdentityResolution', 'not_found')
    assertSubjectAuthorized(subject.id, subject.authorizationState)
    await delay(500)
    // In demo mode, return the pre-seeded candidates for this subject
    const candidates = this.backend.state.candidates.filter((candidate) => candidate.subjectId === subject.id)
    await delay(350)
    return {
      status: 'ok',
      candidates: structuredClone(candidates),
      runId: `demo-run-${crypto.randomUUID()}`,
      correlationId: crypto.randomUUID(),
    }
  }

  async confirmCandidate(input: DecideCandidateInput): Promise<void> {
    await this.decide(input, 'confirmed')
  }

  async rejectCandidate(input: DecideCandidateInput): Promise<void> {
    await this.decide(input, 'rejected')
  }

  private async decide(
    input: DecideCandidateInput,
    decision: IdentityConfirmation['decision'],
  ): Promise<void> {
    const parsed = parseOrThrow('IdentityResolution', decideCandidateInputSchema, input)
    const candidate = this.backend.state.candidates.find(
      (item) => item.id === parsed.candidateId,
    )
    if (candidate === undefined) throw new AtlasServiceError('IdentityResolution', 'not_found')
    const subject = this.backend.subjectById(candidate.subjectId)
    if (subject === undefined) throw new AtlasServiceError('IdentityResolution', 'not_found')

    // Same hard gate as production: decisions require an authorized subject.
    assertSubjectAuthorized(subject.id, subject.authorizationState)

    await delay(350)
    candidate.matchStatus = decision

    this.backend.state.confirmations.push(
      parseOrThrow('IdentityResolution', identityConfirmationSchema, {
        id: this.backend.nextId('conf'),
        candidateId: candidate.id,
        decision,
        decidedBy: this.backend.actor,
        decidedAt: new Date().toISOString(),
        notes: parsed.notes ?? null,
      }),
    )

    const nowIso = new Date().toISOString()
    subject.lastActivityAt = nowIso
    if (decision === 'confirmed') {
      subject.identityState = 'confirmed'
      const profile =
        subject.profileId === null ? undefined : this.backend.profileById(subject.profileId)
      if (profile !== undefined && profile.subjectId === subject.id) {
        profile.identityState = 'confirmed'
        profile.confidenceScore = Math.min(0.99, profile.confidenceScore + 0.05)
        profile.lastResolvedAt = nowIso
        profile.updatedAt = nowIso
      }
    }

    this.backend.pushAudit({
      action: decision === 'confirmed' ? 'identity.confirmed' : 'identity.rejected',
      resourceType: 'identity_candidate',
      resourceId: candidate.id,
      detail: `${candidate.displayName} ${decision} for ${subject.label}`,
      sensitive: true,
    })
  }
}

/* ---------- public information ---------- */

class DemoPublicInformationService implements PublicInformationService {
  private readonly backend: DemoBackend

  constructor(backend: DemoBackend) {
    this.backend = backend
  }

  private resolveAuthorizedProfile(profileId: string): IntelligenceProfile {
    const profile = this.backend.profileById(profileId)
    if (profile === undefined) throw new AtlasServiceError('PublicInformation', 'not_found')
    const subject = this.backend.subjectById(profile.subjectId)
    if (subject === undefined || subject.profileId !== profile.id) {
      throw new AtlasServiceError('PublicInformation', 'not_found')
    }
    // Hard gate — mirrors production policy and database RLS.
    assertSubjectAuthorized(subject.id, subject.authorizationState)
    return profile
  }

  async listProfiles(): Promise<IntelligenceProfile[]> {
    await delay(300)
    const authorizedSubjects = new Set(
      this.backend.state.subjects
        .filter((subject) => subject.authorizationState === 'authorized')
        .map((subject) => subject.id),
    )
    return this.backend.state.profiles
      .filter((profile) => authorizedSubjects.has(profile.subjectId))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map((profile) => structuredClone(profile))
  }

  async getProfile(input: GetProfileInput): Promise<IntelligenceProfile> {
    const parsed = parseOrThrow('PublicInformation', getProfileInputSchema, input)
    await delay(250)
    return structuredClone(this.resolveAuthorizedProfile(parsed.profileId))
  }

  async searchPerson(input: SearchPersonInput): Promise<IntelligenceFact[]> {
    const parsed = parseOrThrow('PublicInformation', searchPersonInputSchema, input)
    await delay(400)
    this.resolveAuthorizedProfile(parsed.profileId)
    return structuredClone(
      this.backend.state.facts.filter((fact) => fact.profileId === parsed.profileId),
    )
  }

  async searchExternal(): Promise<PublicInformationSearchResult> {
    // Demo mode performs NO external research: fabricating OSINT results
    // would violate the provenance contract this service exists to uphold.
    await delay(350)
    return { status: 'not_configured' }
  }
}

/* ---------- sources ---------- */

class DemoSourceService implements SourceService {
  private readonly backend: DemoBackend

  constructor(backend: DemoBackend) {
    this.backend = backend
  }

  async listSources(input?: ListSourcesInput): Promise<Source[]> {
    const parsed = parseOrThrow('Sources', listSourcesInputSchema, input ?? {})
    await delay(250)
    const sorted = [...this.backend.state.sources].sort(
      (a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt),
    )
    return structuredClone(sorted.slice(0, parsed.limit ?? 100))
  }

  async listConnectors(): Promise<Connector[]> {
    await delay(200)
    return structuredClone(this.backend.state.connectors)
  }
}

/* ---------- evidence ---------- */

class DemoEvidenceService implements EvidenceService {
  private readonly backend: DemoBackend

  constructor(backend: DemoBackend) {
    this.backend = backend
  }

  async listByInvestigation(input: ListEvidenceByInvestigationInput): Promise<EvidenceItem[]> {
    const parsed = parseOrThrow('Evidence', listEvidenceByInvestigationInputSchema, input)
    await delay(250)
    return structuredClone(
      this.backend.state.evidence.filter(
        (item) => item.investigationId === parsed.investigationId,
      ),
    )
  }

  async listBySubject(input: ListEvidenceBySubjectInput): Promise<EvidenceItem[]> {
    const parsed = parseOrThrow('Evidence', listEvidenceBySubjectInputSchema, input)
    await delay(200)
    return structuredClone(
      this.backend.state.evidence.filter((item) => item.subjectId === parsed.subjectId),
    )
  }

  async listForFact(input: ListEvidenceForFactInput): Promise<EvidenceItem[]> {
    const parsed = parseOrThrow('Evidence', listEvidenceForFactInputSchema, input)
    await delay(150)
    return structuredClone(
      this.backend.state.evidence.filter((item) => item.factId === parsed.factId),
    )
  }

  async addEvidence(input: AddEvidenceInput): Promise<EvidenceItem> {
    const parsed = parseOrThrow('Evidence', addEvidenceInputSchema, input)
    if (parsed.sourceId == null) {
      // Mirrors the NOT NULL constraint on evidence_items.source_id.
      throw new AtlasServiceError(
        'Evidence',
        'validation_failed',
        undefined,
        'sourceId is required to capture evidence',
      )
    }
    let subject: InvestigationSubject | undefined
    if (parsed.subjectId != null) {
      subject = this.backend.subjectById(parsed.subjectId)
      if (subject === undefined) throw new AtlasServiceError('Evidence', 'not_found')
      // Capturing evidence against a subject requires authorization.
      assertSubjectAuthorized(subject.id, subject.authorizationState)
    }

    await delay(300)
    const created = parseOrThrow('Evidence', evidenceItemSchema, {
      id: this.backend.nextId('ev'),
      investigationId: parsed.investigationId,
      subjectId: parsed.subjectId ?? null,
      sourceId: parsed.sourceId,
      factId: parsed.factId ?? null,
      claim: parsed.claim,
      confidence: parsed.confidence,
      evidenceType: parsed.evidenceType,
      capturedAt: new Date().toISOString(),
    })
    this.backend.state.evidence.unshift(created)
    if (subject !== undefined) subject.lastActivityAt = created.capturedAt
    return structuredClone(created)
  }
}

/* ---------- investigations ---------- */

class DemoInvestigationService implements InvestigationService {
  private readonly backend: DemoBackend

  constructor(backend: DemoBackend) {
    this.backend = backend
  }

  /** subjectIds are derived from the subjects table — the source of truth. */
  private derive(investigation: Investigation): Investigation {
    return {
      ...structuredClone(investigation),
      subjectIds: this.backend.state.subjects
        .filter((subject) => subject.investigationId === investigation.id)
        .map((subject) => subject.id),
    }
  }

  private withLiveCounts(subject: InvestigationSubject): InvestigationSubject {
    return {
      ...structuredClone(subject),
      evidenceCount: this.backend.state.evidence.filter(
        (item) => item.subjectId === subject.id,
      ).length,
    }
  }

  async listInvestigations(): Promise<Investigation[]> {
    await delay(300)
    return [...this.backend.state.investigations]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map((investigation) => this.derive(investigation))
  }

  async getInvestigation(input: GetInvestigationInput): Promise<Investigation> {
    const parsed = parseOrThrow('Investigations', getInvestigationInputSchema, input)
    await delay(180)
    const found = this.backend.state.investigations.find((inv) => inv.id === parsed.id)
    if (found === undefined) throw new AtlasServiceError('Investigations', 'not_found')
    return this.derive(found)
  }

  async listSubjects(input: ListSubjectsInput): Promise<InvestigationSubject[]> {
    const parsed = parseOrThrow('Investigations', listSubjectsInputSchema, input)
    await delay(250)
    return this.backend.state.subjects
      .filter((subject) => subject.investigationId === parsed.investigationId)
      .map((subject) => this.withLiveCounts(subject))
  }

  async createInvestigation(input: CreateInvestigationInput): Promise<Investigation> {
    const parsed = parseOrThrow('Investigations', createInvestigationInputSchema, input)
    await delay(400)
    const nowIso = new Date().toISOString()
    const created = parseOrThrow('Investigations', investigationSchema, {
      id: this.backend.nextId('inv'),
      organizationId: this.backend.organizationId,
      createdBy: this.backend.actor,
      title: parsed.title,
      description: parsed.description,
      status: 'active' as const,
      riskLevel: parsed.riskLevel,
      subjectIds: [] as string[],
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    this.backend.state.investigations.unshift(created)
    this.backend.pushAudit({
      action: 'investigation.created',
      resourceType: 'investigation',
      resourceId: created.id,
      detail: `"${created.title}" opened`,
      sensitive: false,
    })
    return this.derive(created)
  }

  async getSubject(input: GetSubjectInput): Promise<InvestigationSubject> {
    const parsed = parseOrThrow('Investigations', getSubjectInputSchema, input)
    await delay(180)
    const subject = this.backend.subjectById(parsed.subjectId)
    if (subject === undefined) throw new AtlasServiceError('Investigations', 'not_found')
    return this.withLiveCounts(subject)
  }

  async createSubject(input: CreateSubjectInput): Promise<InvestigationSubject> {
    const parsed = parseOrThrow('Investigations', createSubjectInputSchema, input)
    await delay(350)
    const investigation = this.backend.state.investigations.find(
      (inv) => inv.id === parsed.investigationId,
    )
    if (investigation === undefined) throw new AtlasServiceError('Investigations', 'not_found')
    const nowIso = new Date().toISOString()
    const created = parseOrThrow('Investigations', investigationSubjectSchema, {
      id: this.backend.nextId('sub'),
      investigationId: parsed.investigationId,
      label: parsed.label,
      authorizationState: parsed.authorizationState,
      authorizationBasis:
        parsed.authorizationBasis !== undefined && parsed.authorizationBasis.trim() !== ''
          ? parsed.authorizationBasis.trim()
          : '',
      identityState: 'unresolved' as const,
      profileId: null,
      evidenceCount: 0,
      lastActivityAt: nowIso,
      createdAt: nowIso,
    })
    this.backend.state.subjects.push(created)
    this.backend.pushAudit({
      action: 'subject.created',
      resourceType: 'investigation_subject',
      resourceId: created.id,
      detail: `${created.label} enrolled (${created.authorizationState})`,
      sensitive:
        created.authorizationState === 'authorized' || created.authorizationState === 'restricted',
    })
    return this.withLiveCounts(created)
  }

  async updateSubjectAuthorization(
    input: UpdateSubjectAuthorizationInput,
  ): Promise<InvestigationSubject> {
    const parsed = parseOrThrow('Investigations', updateSubjectAuthorizationInputSchema, input)
    const subject = this.backend.subjectById(parsed.subjectId)
    if (subject === undefined) throw new AtlasServiceError('Investigations', 'not_found')
    await delay(300)

    const previous = subject.authorizationState
    subject.authorizationState = parsed.authorizationState
    if (
      parsed.authorizationBasis !== undefined &&
      parsed.authorizationBasis.trim().length > 0
    ) {
      subject.authorizationBasis = parsed.authorizationBasis.trim()
    } else if (parsed.authorizationState === 'undeclared') {
      subject.authorizationBasis = ''
    }
    subject.lastActivityAt = new Date().toISOString()

    this.backend.pushAudit({
      action: 'subject.authorization_updated',
      resourceType: 'investigation_subject',
      resourceId: subject.id,
      detail: `${subject.label}: ${previous} → ${subject.authorizationState}`,
      sensitive: true,
    })
    return this.withLiveCounts(subject)
  }
}

/* ---------- audit ---------- */

class DemoAuditService implements AuditService {
  private readonly backend: DemoBackend

  constructor(backend: DemoBackend) {
    this.backend = backend
  }

  async record(input: RecordAuditInput): Promise<{ persisted: boolean }> {
    const parsed = parseOrThrow('Audit', recordAuditInputSchema, input)
    await delay(100)
    this.backend.pushAudit(parsed)
    return { persisted: true }
  }

  async listEvents(input?: ListAuditEventsInput): Promise<AuditEvent[]> {
    const parsed = parseOrThrow('Audit', listAuditEventsInputSchema, input ?? {})
    await delay(250)
    return structuredClone(
      this.backend.state.auditEvents
        .filter((event) => (parsed.sensitiveOnly ? event.sensitive : true))
        .slice(0, parsed.limit),
    )
  }
}

/* ---------- factory ---------- */

export function createDemoServices() {
  const backend = new DemoBackend()

  return {
    auth: new DemoAuthService(backend),
    faceDetection: new ProviderBackedFaceDetectionService(new DemoFaceDetectionProvider()),
    identityResolution: new DemoIdentityResolutionService(backend),
    publicInformation: new DemoPublicInformationService(backend),
    sources: new DemoSourceService(backend),
    evidence: new DemoEvidenceService(backend),
    investigations: new DemoInvestigationService(backend),
    audit: new DemoAuditService(backend),
  }
}

export type DemoServices = ReturnType<typeof createDemoServices>
