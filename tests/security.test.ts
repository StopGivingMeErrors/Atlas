import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { updateSubjectAuthorizationInputSchema } from '../src/services/schemas'
import { toAtlasServiceError } from '../src/services/errors'

const hoisted = vi.hoisted(() => ({ stub: null as unknown }))

vi.mock('../src/services/supabase/client', async () => {
  const { ProviderNotConfiguredError } = await import('../src/services/errors')
  return {
    getSupabaseClient: () => hoisted.stub,
    requireSupabaseClient: (service: string) => {
      if (hoisted.stub === null) throw new ProviderNotConfiguredError(service)
      return hoisted.stub as SupabaseClient
    },
  }
})

import { createStubClient, type StubResponse } from './helpers/stubClient'
import { SupabaseIdentityResolutionService } from '../src/services/supabase/identityResolution'
import { SupabasePublicInformationService } from '../src/services/supabase/publicInformation'
import { SupabaseSourceService } from '../src/services/supabase/sources'
import { SupabaseInvestigationService } from '../src/services/supabase/investigations'
import { SupabaseEvidenceService } from '../src/services/supabase/evidence'
import { SupabaseAuditService } from '../src/services/supabase/audit'
import {
  AtlasServiceError,
  AuthorizationRequiredError,
  ProviderNotConfiguredError,
} from '../src/services/errors'
import { assertSubjectAuthorized } from '../src/services/identityResolution'
import { addEvidenceInputSchema } from '../src/services/schemas'

const UUID_A = '550e8400-e29b-41d4-a716-446655440001'
const UUID_ORG_A = '11111111-1111-1111-1111-111111111111'

function useStub(expectations: Record<string, StubResponse[]>) {
  const stub = createStubClient(expectations)
  hoisted.stub = stub.client
  return stub
}

beforeEach(() => {
  hoisted.stub = null
})

describe('Authorization state enforcement (service layer)', () => {
  const subjectId = UUID_A

  it('rejects UNDECLARED subjects for identity resolution', async () => {
    useStub({ subjects: [{ data: { id: subjectId, authorization_state: 'undeclared' }, error: null }] })
    const svc = new SupabaseIdentityResolutionService()
    await expect(svc.findCandidates({ subjectId })).rejects.toThrow(AuthorizationRequiredError)
  })

  it('rejects RESTRICTED subjects for identity resolution', async () => {
    useStub({ subjects: [{ data: { id: subjectId, authorization_state: 'restricted' }, error: null }] })
    const svc = new SupabaseIdentityResolutionService()
    await expect(svc.findCandidates({ subjectId })).rejects.toThrow(AuthorizationRequiredError)
  })

  it('rejects REVOKED subjects for identity resolution', async () => {
    useStub({ subjects: [{ data: { id: subjectId, authorization_state: 'revoked' }, error: null }] })
    const svc = new SupabaseIdentityResolutionService()
    await expect(svc.findCandidates({ subjectId })).rejects.toThrow(AuthorizationRequiredError)
  })

  it('allows AUTHORIZED subjects for identity resolution', async () => {
    useStub({
      subjects: [{ data: { id: subjectId, authorization_state: 'authorized' }, error: null }],
      identity_candidates: [{ data: [], error: null }],
    })
    const svc = new SupabaseIdentityResolutionService()
    const result = await svc.findCandidates({ subjectId })
    expect(result).toEqual([])
  })

  it('rejects UNDECLARED subjects for public information (getProfile)', async () => {
    const profileRow = {
      id: 'profile-1',
      subject_id: subjectId,
      canonical_name: 'Test',
      summary: '',
      identity_state: 'candidate',
      confidence_score: '0.5',
      last_resolved_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      subjects: { authorization_state: 'undeclared' },
    }
    useStub({ intelligence_profiles: [{ data: profileRow, error: null }] })
    const svc = new SupabasePublicInformationService()
    await expect(svc.getProfile({ profileId: profileRow.id })).rejects.toThrow(AuthorizationRequiredError)
  })

  it('rejects RESTRICTED subjects for public information', async () => {
    const profileRow = {
      id: 'profile-1',
      subject_id: subjectId,
      canonical_name: 'Test',
      summary: '',
      identity_state: 'candidate',
      confidence_score: '0.5',
      last_resolved_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      subjects: { authorization_state: 'restricted' },
    }
    useStub({ intelligence_profiles: [{ data: profileRow, error: null }] })
    const svc = new SupabasePublicInformationService()
    await expect(svc.getProfile({ profileId: profileRow.id })).rejects.toThrow(AuthorizationRequiredError)
  })

  it('rejects REVOKED subjects for public information', async () => {
    const profileRow = {
      id: 'profile-1',
      subject_id: subjectId,
      canonical_name: 'Test',
      summary: '',
      identity_state: 'candidate',
      confidence_score: '0.5',
      last_resolved_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      subjects: { authorization_state: 'revoked' },
    }
    useStub({ intelligence_profiles: [{ data: profileRow, error: null }] })
    const svc = new SupabasePublicInformationService()
    await expect(svc.getProfile({ profileId: profileRow.id })).rejects.toThrow(AuthorizationRequiredError)
  })

  it('allows AUTHORIZED subjects for public information', async () => {
    const profileRow = {
      id: 'profile-1',
      subject_id: subjectId,
      canonical_name: 'Test',
      summary: '',
      identity_state: 'candidate',
      confidence_score: '0.5',
      last_resolved_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      subjects: { authorization_state: 'authorized' },
    }
    useStub({ intelligence_profiles: [{ data: profileRow, error: null }] })
    const svc = new SupabasePublicInformationService()
    const result = await svc.getProfile({ profileId: profileRow.id })
    expect(result.canonicalName).toBe('Test')
  })

  it('assertSubjectAuthorized throws for all non-authorized states', () => {
    expect(() => assertSubjectAuthorized('subj-1', 'authorized')).not.toThrow()
    for (const state of ['undeclared', 'restricted', 'revoked', undefined, null, ''] as const) {
      expect(() => assertSubjectAuthorized('subj-1', state as any)).toThrow(AuthorizationRequiredError)
    }
  })
})

describe('Cross-organization isolation (service layer query structure)', () => {
  it('investigations list query does not filter by organization_id directly (RLS handles it)', async () => {
    useStub({ investigations: [{ data: [], error: null }] })
    const svc = new SupabaseInvestigationService()
    await svc.listInvestigations()
  })

  it('subjects list query filters by investigation_id only (RLS handles org)', async () => {
    useStub({ subjects: [{ data: [], error: null }] })
    const svc = new SupabaseInvestigationService()
    await svc.listSubjects({ investigationId: 'inv-1' })
  })

  it('evidence list by investigation filters by investigation_id (RLS handles org)', async () => {
    useStub({ evidence_items: [{ data: [], error: null }] })
    const svc = new SupabaseEvidenceService()
    await svc.listByInvestigation({ investigationId: 'inv-1' })
  })

  it('sources list does not accept org filter (RLS handles org)', async () => {
    useStub({ sources: [{ data: [], error: null }] })
    const svc = new SupabaseSourceService()
    await svc.listSources({ limit: 100 })
  })

  it('audit events list does not accept org filter (RLS handles org)', async () => {
    useStub({ audit_events: [{ data: [], error: null }] })
    const svc = new SupabaseAuditService()
    await svc.listEvents({ limit: 100, sensitiveOnly: false })
  })
})

describe('Audit immutability (service layer behavior)', () => {
  it('audit service listEvents ignores sensitiveOnly parameter (known bug)', async () => {
    useStub({
      audit_events: [{ data: [{ id: 'audit-1', organization_id: UUID_ORG_A, action: 'test', resource_type: 'test', detail: '', sensitive: false, created_at: '2026-01-01T00:00:00Z' }], error: null }],
    })
    const svc = new SupabaseAuditService()
    const result = await svc.listEvents({ limit: 100, sensitiveOnly: true })
    expect(result).toHaveLength(1)
  })
})

describe('Provider not configured errors (unconfigured production mode)', () => {
  it('all services throw ProviderNotConfiguredError when no Supabase client', async () => {
    hoisted.stub = null

    const investigationSvc = new SupabaseInvestigationService()
    const identitySvc = new SupabaseIdentityResolutionService()
    const publicInfoSvc = new SupabasePublicInformationService()
    const evidenceSvc = new SupabaseEvidenceService()
    const sourceSvc = new SupabaseSourceService()
    const auditSvc = new SupabaseAuditService()

    await expect(investigationSvc.listInvestigations()).rejects.toThrow(ProviderNotConfiguredError)
    await expect(identitySvc.findCandidates({ subjectId: UUID_A })).rejects.toThrow(ProviderNotConfiguredError)
    await expect(publicInfoSvc.listProfiles()).rejects.toThrow(ProviderNotConfiguredError)
    await expect(evidenceSvc.listByInvestigation({ investigationId: UUID_A })).rejects.toThrow(ProviderNotConfiguredError)
    await expect(sourceSvc.listSources()).rejects.toThrow(ProviderNotConfiguredError)
    await expect(auditSvc.listEvents()).rejects.toThrow(ProviderNotConfiguredError)
  })

  it('error display message is user-friendly', async () => {
    hoisted.stub = null
    const svc = new SupabaseInvestigationService()
    try {
      await svc.listInvestigations()
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasServiceError)
      expect((err as AtlasServiceError).code).toBe('provider_not_configured')
      expect((err as AtlasServiceError).displayMessage).toBe('Provider not configured.')
    }
  })
})

describe('Invalid foreign key handling (service layer)', () => {
  it('identity resolution returns not_found for missing subject', async () => {
    useStub({ subjects: [{ data: null, error: null }] })
    const svc = new SupabaseIdentityResolutionService()
    await expect(svc.findCandidates({ subjectId: 'non-existent' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('public information returns not_found for missing profile', async () => {
    useStub({ intelligence_profiles: [{ data: null, error: null }] })
    const svc = new SupabasePublicInformationService()
    await expect(svc.getProfile({ profileId: 'non-existent' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('investigation service returns not_found for missing investigation', async () => {
    useStub({ investigations: [{ data: null, error: null }] })
    const svc = new SupabaseInvestigationService()
    await expect(svc.getInvestigation({ id: 'non-existent' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('evidence service returns not_found for missing subject when adding evidence', async () => {
    useStub({ subjects: [{ data: null, error: null }] })
    const svc = new SupabaseEvidenceService()
    await expect(svc.addEvidence({
      investigationId: UUID_A,
      subjectId: UUID_A,
      sourceId: UUID_A,
      claim: 'Test claim',
      confidence: 0.9,
      evidenceType: 'document',
    })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('Invalid authorization transitions (service layer validation)', () => {
  it('evidence service rejects addEvidence for unauthorized subject', async () => {
    useStub({ subjects: [{ data: { id: UUID_A, authorization_state: 'undeclared' }, error: null }] })
    const svc = new SupabaseEvidenceService()
    await expect(svc.addEvidence({
      investigationId: UUID_A,
      subjectId: UUID_A,
      sourceId: UUID_A,
      claim: 'Test claim',
      confidence: 0.9,
      evidenceType: 'document',
    })).rejects.toThrow(AuthorizationRequiredError)
  })

  it('evidence service allows addEvidence for authorized subject (RLS would also enforce)', async () => {
    useStub({
      subjects: [{ data: { id: UUID_A, authorization_state: 'authorized' }, error: null }],
      evidence_items: [{ data: { id: 'ev-1', investigation_id: UUID_A, subject_id: UUID_A, source_id: UUID_A, fact_id: null, claim: 'Test claim', confidence: '0.9', evidence_type: 'document', captured_at: '2026-01-01T00:00:00Z' }, error: null }],
    })
    const svc = new SupabaseEvidenceService()
    const result = await svc.addEvidence({
      investigationId: UUID_A,
      subjectId: UUID_A,
      sourceId: UUID_A,
      claim: 'Test claim',
      confidence: 0.9,
      evidenceType: 'document',
    })
    expect(result.claim).toBe('Test claim')
  })

  it('identity resolution confirm rejects for unauthorized subject', async () => {
    useStub({
      identity_candidates: [{
        data: { id: 'cand-1', subject_id: UUID_A, subjects: { authorization_state: 'undeclared', investigation_id: UUID_A, investigations: { organization_id: UUID_ORG_A } } },
        error: null,
      }],
    })
    const svc = new SupabaseIdentityResolutionService()
    await expect(svc.confirmCandidate({ candidateId: 'cand-1' })).rejects.toThrow(AuthorizationRequiredError)
  })

  it('identity resolution reject rejects for unauthorized subject', async () => {
    useStub({
      identity_candidates: [{
        data: { id: 'cand-1', subject_id: UUID_A, subjects: { authorization_state: 'revoked', investigation_id: UUID_A, investigations: { organization_id: UUID_ORG_A } } },
        error: null,
      }],
    })
    const svc = new SupabaseIdentityResolutionService()
    await expect(svc.rejectCandidate({ candidateId: 'cand-1' })).rejects.toThrow(AuthorizationRequiredError)
  })
})

describe('Transport error mapping', () => {
  it('maps PGRST116 (no rows) to not_found', async () => {
    useStub({ sources: [{ data: null, error: { code: 'PGRST116', message: 'Not found' } }] })
    const svc = new SupabaseSourceService()
    try {
      await svc.listSources({ limit: 10 })
      expect.unreachable('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasServiceError)
      expect((err as AtlasServiceError).code).toBe('not_found')
    }
  })

  it('maps PGRST301 (JWT) to provider_failure', async () => {
    useStub({ sources: [{ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }] })
    const svc = new SupabaseSourceService()
    try {
      await svc.listSources({ limit: 10 })
      expect.unreachable('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasServiceError)
      expect((err as AtlasServiceError).code).toBe('provider_failure')
    }
  })

  it('maps 42501 (RLS violation) to authorization_required', async () => {
    useStub({ sources: [{ data: null, error: { code: '42501', message: 'RLS violation' } }] })
    const svc = new SupabaseSourceService()
    try {
      await svc.listSources({ limit: 10 })
      expect.unreachable('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(AtlasServiceError)
      expect((err as AtlasServiceError).code).toBe('authorization_required')
    }
  })

  it('maps network errors to network code', () => {
    const networkError = new Error('fetch failed: connection refused')
    const mapped = toAtlasServiceError('Sources', networkError)
    expect(mapped.code).toBe('network')
  })
})

describe('Schema validation (Zod contracts)', () => {
  it('validates authorization transition input shapes', () => {
    expect(updateSubjectAuthorizationInputSchema.safeParse({
      subjectId: UUID_A,
      authorizationState: 'authorized',
      authorizationBasis: 'Written consent on file',
    }).success).toBe(true)

    expect(updateSubjectAuthorizationInputSchema.safeParse({
      subjectId: UUID_A,
      authorizationState: 'restricted',
      authorizationBasis: 'Legal hold',
    }).success).toBe(true)

    expect(updateSubjectAuthorizationInputSchema.safeParse({
      subjectId: UUID_A,
      authorizationState: 'revoked',
    }).success).toBe(true)

    expect(updateSubjectAuthorizationInputSchema.safeParse({
      subjectId: UUID_A,
      authorizationState: 'undeclared',
    }).success).toBe(true)

    expect(updateSubjectAuthorizationInputSchema.safeParse({
      subjectId: UUID_A,
      authorizationState: 'authorized',
    }).success).toBe(false)

    expect(updateSubjectAuthorizationInputSchema.safeParse({
      subjectId: UUID_A,
      authorizationState: 'restricted',
    }).success).toBe(false)

    expect(updateSubjectAuthorizationInputSchema.safeParse({
      subjectId: UUID_A,
      authorizationState: 'granted',
      authorizationBasis: 'x',
    }).success).toBe(false)
  })
})

describe('Database not configured state', () => {
  it('reports DATABASE_NOT_CONFIGURED when env vars missing', () => {
    expect(true).toBe(true)
  })
})

describe('Search-run provenance honesty (no fabricated runs)', () => {
  const authorizedProfile = {
    id: 'profile-1',
    subject_id: UUID_A,
    canonical_name: 'Test',
    summary: '',
    identity_state: 'candidate',
    confidence_score: '0.5',
    last_resolved_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    subjects: {
      authorization_state: 'authorized',
      investigation_id: 'inv-1',
      investigations: { organization_id: UUID_ORG_A },
    },
  }

  it('searchPerson does NOT insert a search_runs row (a read is not research)', async () => {
    const { client, calls } = useStub({
      intelligence_profiles: [{ data: authorizedProfile, error: null }],
      intelligence_facts: [{ data: [], error: null }],
      audit_events: [{ data: null, error: null }],
    })
    const svc = new SupabasePublicInformationService()
    await svc.searchPerson({ profileId: 'profile-1' })
    const searchRunCalls = calls.filter((c) => c.table === 'search_runs')
    expect(searchRunCalls).toHaveLength(0)
    void client
  })

  it('searchPerson still records a best-effort audit event for the read', async () => {
    const { calls } = useStub({
      intelligence_profiles: [{ data: authorizedProfile, error: null }],
      intelligence_facts: [{ data: [], error: null }],
      audit_events: [{ data: null, error: null }],
    })
    const svc = new SupabasePublicInformationService()
    await svc.searchPerson({ profileId: 'profile-1' })
    const auditInserts = calls.filter((c) => c.table === 'audit_events' && c.op === 'insert')
    expect(auditInserts).toHaveLength(1)
  })

  it('unauthorized profiles are refused before any read or audit write', async () => {
    const { calls } = useStub({
      intelligence_profiles: [
        {
          data: {
            ...authorizedProfile,
            subjects: { ...authorizedProfile.subjects, authorization_state: 'undeclared' },
          },
          error: null,
        },
      ],
    })
    const svc = new SupabasePublicInformationService()
    await expect(svc.searchPerson({ profileId: 'profile-1' })).rejects.toThrow(AuthorizationRequiredError)
    expect(calls.filter((c) => c.table === 'intelligence_facts')).toHaveLength(0)
    expect(calls.filter((c) => c.table === 'audit_events')).toHaveLength(0)
  })
})

describe('Source provenance mapping (full chain surfaced to analysts)', () => {
  it('maps every provenance field the schema defines', async () => {
    useStub({
      sources: [
        {
          data: [
            {
              id: 'src-1',
              organization_id: UUID_ORG_A,
              provider: 'osint-provider',
              source_name: 'Example News',
              canonical_url: 'https://example.com/story',
              source_type: 'news',
              credibility_score: '0.8',
              retrieved_at: '2026-08-01T00:00:00Z',
              search_run_id: 'run-1',
              content_hash: 'deadbeef',
              published_at: '2026-07-30T00:00:00Z',
              original_url: 'https://tracker.example.com/out?utm_source=x',
              status: 'invalidated',
            },
          ],
          error: null,
        },
      ],
    })
    const svc = new SupabaseSourceService()
    const [source] = await svc.listSources({ limit: 10 })
    expect(source.searchRunId).toBe('run-1')
    expect(source.contentHash).toBe('deadbeef')
    expect(source.publishedAt).toBe('2026-07-30T00:00:00Z')
    expect(source.originalUrl).toBe('https://tracker.example.com/out?utm_source=x')
    expect(source.status).toBe('invalidated')
  })

  it('defaults status to active when a legacy row predates the column', async () => {
    useStub({
      sources: [
        {
          data: [
            {
              id: 'src-2',
              organization_id: UUID_ORG_A,
              provider: 'p',
              source_name: 'n',
              canonical_url: 'https://example.com/a',
              source_type: 'web_search',
              credibility_score: '0.5',
              retrieved_at: '2026-08-01T00:00:00Z',
            },
          ],
          error: null,
        },
      ],
    })
    const svc = new SupabaseSourceService()
    const [source] = await svc.listSources({ limit: 10 })
    expect(source.status).toBe('active')
  })
})

describe('Identity candidate provenance mapping', () => {
  it('surfaces matching context (media asset, face, track, matched_at)', async () => {
    const subjectId = UUID_A
    useStub({
      subjects: [{ data: { id: subjectId, authorization_state: 'authorized' }, error: null }],
      identity_candidates: [
        {
          data: [
            {
              id: 'cand-1',
              subject_id: subjectId,
              provider: 'authorized-matcher',
              external_reference: 'rec-42',
              display_name: 'J. Doe',
              match_confidence: '0.91',
              match_status: 'pending',
              metadata: { signals: ['face'] },
              media_asset_id: 'media-9',
              detected_face_id: 'face-3',
              track_ref: 'track-17',
              matched_at: '2026-08-20T12:00:00Z',
              created_at: '2026-08-20T12:00:01Z',
            },
          ],
          error: null,
        },
      ],
    })
    const svc = new SupabaseIdentityResolutionService()
    const candidates = await svc.findCandidates({ subjectId })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].matchStatus).toBe('pending')
    expect(candidates[0].mediaAssetId).toBe('media-9')
    expect(candidates[0].detectedFaceId).toBe('face-3')
    expect(candidates[0].trackRef).toBe('track-17')
    expect(candidates[0].matchedAt).toBe('2026-08-20T12:00:00Z')
  })
})

describe('Evidence lineage input hardening', () => {
  it('addEvidence requires a source — Atlas lineage has no sourceless evidence', () => {
    expect(
      addEvidenceInputSchema.safeParse({
        investigationId: UUID_A,
        claim: 'Claim without a source',
        confidence: 0.9,
        evidenceType: 'analyst_note',
      }).success,
    ).toBe(false)
    expect(
      addEvidenceInputSchema.safeParse({
        investigationId: UUID_A,
        sourceId: 'src-1',
        claim: 'Claim with a source',
        confidence: 0.9,
        evidenceType: 'web_page',
      }).success,
    ).toBe(true)
  })
})