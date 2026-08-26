/**
 * Subject enrollment workflow tests — subject creation, media persistence,
 * identity matching with durable candidate recording, and analyst review
 * ordering. All service calls run against the stub Supabase client; the
 * database guarantees themselves are covered by tests/atlas-db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

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
import { SupabaseInvestigationService } from '../src/services/supabase/investigations'
import { SupabaseIdentityResolutionService } from '../src/services/supabase/identityResolution'
import { SupabaseMediaStorageService, MediaStorageError } from '../src/services/mediaStorage'
import { AtlasServiceError } from '../src/services/errors'

const ORG = '550e8400-e29b-41d4-a716-446655440001'
const USER_ID = '550e8400-e29b-41d4-a716-446655440002'
const INV = '550e8400-e29b-41d4-a716-446655440003'
const SUBJECT = '550e8400-e29b-41d4-a716-446655440004'
const CANDIDATE = '550e8400-e29b-41d4-a716-446655440005'
const MEDIA = '550e8400-e29b-41d4-a716-446655440006'

function useStub(expectations: Record<string, StubResponse[]> = {}) {
  const stub = createStubClient(expectations)
  const client = stub.client as unknown as Record<string, unknown>
  const storageCalls: Array<{ op: string; args: unknown[] }> = {}
  ;(client as { storage?: unknown }).storage = {
    from: () => ({
      upload: async (path: string) => {
        storageCalls.upload ??= []
        storageCalls.upload.push({ op: 'upload', args: [path] })
        return { data: { path }, error: null }
      },
      remove: async (paths: string[]) => {
        storageCalls.remove ??= []
        storageCalls.remove.push({ op: 'remove', args: [paths] })
        return { data: paths.map((name) => ({ name })), error: null }
      },
    }),
  }
  hoisted.stub = client
  return { ...stub, storageCalls: storageCalls as Record<string, Array<{ op: string; args: unknown[] }>> }
}

beforeEach(() => {
  hoisted.stub = null
})

describe('subject enrollment (createSubject)', () => {
  it('derives organization and actor from the session, inserts, and audits', async () => {
    const { calls } = useStub({
      users: [{ data: { organization_id: ORG, full_name: 'Analyst A' }, error: null }],
      investigations: [
        { data: { id: INV, organization_id: ORG }, error: null },
      ],
      subjects: [
        {
          data: {
            id: SUBJECT,
            investigation_id: INV,
            label: 'CASE-2417 primary',
            authorization_state: 'authorized',
            authorization_basis: 'consent ref C-88',
            identity_state: 'unresolved',
            last_activity_at: '2026-08-01T00:00:00Z',
            created_at: '2026-08-01T00:00:00Z',
          },
          error: null,
        },
      ],
      audit_events: [{ data: null, error: null }],
    })

    const service = new SupabaseInvestigationService()
    const subject = await service.createSubject({
      investigationId: INV,
      label: 'CASE-2417 primary',
      authorizationState: 'authorized',
      authorizationBasis: 'consent ref C-88',
    })

    expect(subject.label).toBe('CASE-2417 primary')
    expect(subject.authorizationBasis).toBe('consent ref C-88')

    const insert = calls.find((c) => c.table === 'subjects' && c.op === 'insert')
    expect(insert).toBeDefined()
    const payload = insert?.filters[0] as Record<string, unknown>
    // Organization/actor are NEVER accepted from the browser payload —
    // they must be derivable server-side; the row carries only what the
    // database can trust or derive.
    expect(payload.investigation_id).toBe(INV)
    expect(payload.authorization_state).toBe('authorized')

    const audit = calls.find((c) => c.table === 'audit_events' && c.op === 'insert')
    expect(audit).toBeDefined()
    expect((audit as { filters: unknown[] }).filters[0]).toMatchObject({
      action: 'subject.created',
    })
  })

  it('rejects an authorized enrollment without a basis before touching the database', async () => {
    const { calls } = useStub({})
    const service = new SupabaseInvestigationService()
    await expect(
      service.createSubject({
        investigationId: INV,
        label: 'No basis',
        authorizationState: 'authorized',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    expect(calls).toHaveLength(0)
  })

  it('surfaces not_found when the investigation is invisible to the org', async () => {
    useStub({
      users: [{ data: { organization_id: ORG, full_name: 'Analyst A' }, error: null }],
      investigations: [{ data: null, error: null }],
    })
    const service = new SupabaseInvestigationService()
    await expect(
      service.createSubject({ investigationId: INV, label: 'Ghost' }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('surfaces not_found when the user has no organization membership', async () => {
    useStub({ users: [{ data: null, error: null }] })
    const service = new SupabaseInvestigationService()
    await expect(
      service.createSubject({ investigationId: INV, label: 'Orphan' }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('getSubject', () => {
  it('maps embedded profile and evidence counts', async () => {
    useStub({
      subjects: [
        {
          data: {
            id: SUBJECT,
            investigation_id: INV,
            label: 'Subject A',
            authorization_state: 'authorized',
            authorization_basis: 'mandate M-1',
            identity_state: 'unresolved',
            last_activity_at: '2026-08-01T00:00:00Z',
            intelligence_profiles: [{ id: '550e8400-e29b-41d4-a716-446655440077' }],
            evidence_items: [{ count: 3 }],
            created_at: '2026-08-01T00:00:00Z',
          },
          error: null,
        },
      ],
    })
    const service = new SupabaseInvestigationService()
    const subject = await service.getSubject({ subjectId: SUBJECT })
    expect(subject.profileId).toBe('550e8400-e29b-41d4-a716-446655440077')
    expect(subject.evidenceCount).toBe(3)
  })
})

describe('media persistence (SupabaseMediaStorageService)', () => {
  function makeService(): SupabaseMediaStorageService {
    const service = new SupabaseMediaStorageService()
    // Skip jsdom image decoding in tests; dimensions come back deterministically.
    ;(service as unknown as Record<string, unknown>).getImageDimensions = async () => ({
      width: 640,
      height: 480,
    })
    return service
  }

  it('persists a media_assets row and returns the REAL database record', async () => {
    const { calls } = useStub({
      users: [{ data: { organization_id: ORG }, error: null }],
      media_assets: [
        { data: { id: MEDIA, created_at: '2026-08-02T00:00:00Z' }, error: null },
      ],
    })
    const asset = await makeService().upload({
      investigationId: INV,
      subjectId: SUBJECT,
      file: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      fileName: 'capture.jpg',
      mimeType: 'image/jpeg',
      metadata: { capturedAt: '2026-08-01T12:00:00Z' },
    })

    expect(asset.id).toBe(MEDIA)
    expect(asset.subjectId).toBe(SUBJECT)
    expect(asset.width).toBe(640)

    const insert = calls.find((c) => c.table === 'media_assets' && c.op === 'insert')
    expect(insert).toBeDefined()
    const payload = insert?.filters[0] as Record<string, unknown>
    expect(payload.organization_id).toBe(ORG)
    expect(payload.investigation_id).toBe(INV)
    expect(payload.storage_path).toContain('investigations/')
    const metadata = payload.metadata as Record<string, unknown>
    expect(metadata.subjectId).toBe(SUBJECT)
    expect(typeof metadata.checksum).toBe('string')
    expect(metadata.size).toBe(3)
  })

  it('rolls the storage object back when the database row cannot be recorded', async () => {
    const { calls, storageCalls } = useStub({
      users: [{ data: { organization_id: ORG }, error: null }],
      media_assets: [{ data: null, error: { message: 'rls insert blocked' } }],
    })
    await expect(
      makeService().upload({
        investigationId: INV,
        subjectId: null,
        file: new Blob([new Uint8Array([1])], { type: 'image/png' }),
        fileName: 'a.png',
        mimeType: 'image/png',
      }),
    ).rejects.toThrowError(MediaStorageError)
    expect(storageCalls.remove).toHaveLength(1)
    expect(calls.filter((c) => c.table === 'audit_events')).toHaveLength(0)
  })

  it('lists media rows for an investigation mapping subject lineage from metadata', async () => {
    useStub({
      media_assets: [
        {
          data: [
            {
              id: MEDIA,
              organization_id: ORG,
              investigation_id: INV,
              uploaded_by: USER_ID,
              storage_path: 'investigations/x/a.jpg',
              media_type: 'image/jpeg',
              metadata: { subjectId: SUBJECT, size: 10, checksum: 'abc', width: 64, height: 64 },
              created_at: '2026-08-02T00:00:00Z',
            },
          ],
          error: null,
        },
      ],
    })
    const assets = await new SupabaseMediaStorageService().listByInvestigation({
      investigationId: INV,
    })
    expect(assets).toHaveLength(1)
    expect(assets[0].subjectId).toBe(SUBJECT)
    expect(assets[0].checksum).toBe('abc')
  })
})

// Identity matching orchestration coverage lives in
// tests/identityMatchingOrchestration.test.ts (wire contract:
// tests/httpIdentityMatching.test.ts).

describe('analyst review decision ordering', () => {
  it('does not write a confirmation when the candidate update fails', async () => {
    useStub({
      identity_candidates: [
        {
          data: {
            id: CANDIDATE,
            subject_id: SUBJECT,
            subjects: {
              authorization_state: 'authorized',
              investigation_id: INV,
              investigations: { organization_id: ORG },
            },
          },
          error: null,
        },
        { data: null, error: { message: 'update blocked by policy' } },
      ],
    })
    const service = new SupabaseIdentityResolutionService()
    await expect(
      service.confirmCandidate({ candidateId: CANDIDATE }),
    ).rejects.toBeInstanceOf(AtlasServiceError)
  })
})
