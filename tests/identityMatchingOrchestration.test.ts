/**
 * External identity matching ORCHESTRATION tests.
 *
 * The wire contract itself is covered by tests/httpIdentityMatching.test.ts
 * against a real local HTTP server. Here the transport is injected and
 * scripted, so every deterministic branch — lifecycle transitions,
 * provenance columns, failure taxonomy, dedup, audit correlation — is
 * asserted against the exact payloads written to the stub client.
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
import {
  SupabaseIdentityResolutionService,
} from '../src/services/supabase/identityResolution'
import type { IdentityMatchOutcome, ProviderCandidate } from '../src/services/providers/httpIdentityMatching'
import { AuthorizationRequiredError, AtlasServiceError } from '../src/services/errors'

const ORG = '550e8400-e29b-41d4-a716-446655440001'
const INV = '550e8400-e29b-41d4-a716-446655440003'
const SUBJECT = '550e8400-e29b-41d4-a716-446655440004'
const CANDIDATE = '550e8400-e29b-41d4-a716-446655440005'
const RUN = '550e8400-e29b-41d4-a716-446655441000'

function useStub(expectations: Record<string, StubResponse[]> = {}) {
  const stub = createStubClient(expectations)
  hoisted.stub = stub.client as unknown
  return stub
}

beforeEach(() => {
  hoisted.stub = null
  vi.unstubAllGlobals()
})

function authorizedSubjectRow() {
  return {
    id: SUBJECT,
    authorization_state: 'authorized',
    investigation_id: INV,
    investigations: { organization_id: ORG },
  }
}

interface TransportCall {
  endpoint: string
  request: {
    imageBlob: Blob
    frameWidth: number
    frameHeight: number
    correlationId: string
    faceBox?: { x: number; y: number; width: number; height: number }
    trackRef?: string
  }
}

function scriptedTransport(script: Array<IdentityMatchOutcome | Error>) {
  const calls: TransportCall[] = []
  const queue = [...script]
  const transport = async (
    endpoint: string,
    request: TransportCall['request'],
  ): Promise<IdentityMatchOutcome> => {
    calls.push({ endpoint, request })
    const next = queue.shift()
    if (next instanceof Error) throw next
    if (next === undefined) throw new Error('transport script exhausted')
    return next
  }
  return { calls, transport }
}

function providerCandidate(overrides: Partial<ProviderCandidate> = {}): ProviderCandidate {
  return {
    providerCandidateId: 'pc-1',
    externalReference: 'ref-9',
    displayName: 'Jordan Ellis',
    score: 0.91,
    signals: ['face_embedding'],
    rawJson: '{"external_reference":"ref-9"}',
    ...overrides,
  }
}

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CANDIDATE,
    subject_id: SUBJECT,
    provider: 'matcher.example.com',
    external_reference: 'ref-9',
    display_name: 'Jordan Ellis',
    match_confidence: 0.91,
    match_status: 'pending',
    metadata: { signals: ['face_embedding'], score_supplied: true },
    track_ref: '7',
    matched_at: '2026-08-03T00:00:00Z',
    created_at: '2026-08-03T00:00:00Z',
    provider_candidate_id: 'pc-1',
    search_run_id: RUN,
    raw_fingerprint: 'a'.repeat(64),
    media_asset_id: null,
    detected_face_id: null,
    ...overrides,
  }
}

function baseExpectations(searchRuns: StubResponse[], identityCandidates?: StubResponse[]) {
  return {
    subjects: [{ data: authorizedSubjectRow(), error: null }],
    organizations: [{ data: { matching_provider_url: 'https://org-matcher.example.com/match' }, error: null }],
    search_runs: searchRuns,
    ...(identityCandidates !== undefined ? { identity_candidates: identityCandidates } : {}),
    audit_events: [{ data: null, error: null }],
  }
}

describe('identity matching orchestration (search-run lifecycle)', () => {
  it('walks queued -> running -> completed and records full provenance', async () => {
    const { calls } = useStub(
      baseExpectations([
        { data: { id: RUN }, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ], [{ data: [candidateRow()], error: null }]),
    )
    // Two distinct candidates plus one duplicate that must be collapsed.
    const { transport, calls: wireCalls } = scriptedTransport([
      {
        status: 'ok',
        correlationId: 'corr-1',
        candidates: [
          providerCandidate(),
          providerCandidate({ providerCandidateId: 'pc-2', externalReference: 'ref-10', score: null }),
          providerCandidate(),
        ],
      },
    ])
    const service = new SupabaseIdentityResolutionService({ transport })

    const result = await service.matchIdentity({
      subjectId: SUBJECT,
      trackId: 7,
      imageBase64: btoa('frame'),
      frameWidth: 1280,
      frameHeight: 720,
      faceBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.3 },
      mediaAssetId: '550e8400-e29b-41d4-a716-446655440006',
      detectedFaceId: '550e8400-e29b-41d4-a716-446655440007',
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.candidates).toHaveLength(1)
    expect(result.runId).toBe(RUN)

    // Run creation payload: durable correlation BEFORE the wire is touched.
    const runInsert = calls.find((c) => c.table === 'search_runs' && c.op === 'insert')
    expect(runInsert).toBeDefined()
    const runPayload = runInsert?.filters[0] as Record<string, unknown>
    expect(runPayload.status).toBe('queued')
    expect(runPayload.investigation_id).toBe(INV)
    expect(runPayload.subject_id).toBe(SUBJECT)
    expect(runPayload.initiated_by).toBe('user-1')
    expect(runPayload.channel).toBe('identity_matching')
    expect(runPayload.provider).toBe('org-matcher.example.com')
    expect(String(runPayload.query)).toMatch(/^identity-match\/[0-9a-f-]{36}$/)
    expect(result.correlationId).toBe(String(runPayload.query).split('/')[1])

    const updates = calls.filter(
      (c) => c.table === 'search_runs' && c.op === 'update' && typeof c.filters[0] === 'object',
    )
    expect(updates).toHaveLength(2)
    expect(updates[0]?.filters[0]).toMatchObject({ status: 'running' })
    expect(updates[1]?.filters[0]).toMatchObject({ status: 'completed', sources_found: 1 })

    // Candidate insert: provenance + honest unscored handling.
    const candidateInsert = calls.find((c) => c.table === 'identity_candidates' && c.op === 'insert')
    expect(candidateInsert).toBeDefined()
    const rows = candidateInsert?.filters[0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0].provider_candidate_id).toBe('pc-1')
    expect(rows[0].search_run_id).toBe(RUN)
    expect(rows[0].raw_fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0].media_asset_id).toBe('550e8400-e29b-41d4-a716-446655440006')
    expect(rows[0].detected_face_id).toBe('550e8400-e29b-41d4-a716-446655440007')
    expect(rows[0].match_confidence).toBe(0.91)
    expect((rows[0].metadata as Record<string, unknown>).score_supplied).toBe(true)
    expect(rows[1].match_confidence).toBe(0)
    expect((rows[1].metadata as Record<string, unknown>).score_supplied).toBe(false)

    // Wire request carries ONLY allowed fields — no user/org/subject ids.
    expect(wireCalls).toHaveLength(1)
    expect(wireCalls[0]?.endpoint).toBe('https://org-matcher.example.com/match')
    const sent = wireCalls[0]?.request
    expect(sent?.correlationId).toBe(result.correlationId)
    expect(sent?.trackRef).toBe('7')
    expect(sent?.faceBox).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.3 })

    // Audit records the run correlation and count.
    const audit = calls.find((c) => c.table === 'audit_events' && c.op === 'insert')
    const auditDetail = String((audit?.filters[0] as Record<string, unknown>).detail)
    expect(auditDetail).toContain(`run ${RUN}`)
    expect(auditDetail).toContain(result.correlationId)
    // The audit reports the number actually PERSISTED (stub returned one row).
    expect(auditDetail).toContain('1 candidates recorded')
  })

  it('records no_results when the provider returns zero candidates', async () => {
    const { calls } = useStub(
      baseExpectations([
        { data: { id: RUN }, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ]),
    )
    const { transport } = scriptedTransport([{ status: 'ok', correlationId: 'corr-2', candidates: [] }])
    const service = new SupabaseIdentityResolutionService({ transport })

    const result = await service.matchIdentity({
      subjectId: SUBJECT,
      trackId: 1,
      imageBase64: btoa('frame'),
      frameWidth: 640,
      frameHeight: 480,
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.candidates).toHaveLength(0)
    expect(calls.find((c) => c.table === 'identity_candidates' && c.op === 'insert')).toBeUndefined()
    const finalUpdate = calls.filter(
      (c) => c.table === 'search_runs' && c.op === 'update' && typeof c.filters[0] === 'object',
    )[1]
    expect(finalUpdate?.filters[0]).toMatchObject({ status: 'no_results' })
  })

  it('resolves configuration with precedence org -> proxy -> deployment -> none', async () => {
    // Org URL wins even when proxy/deployment exist.
    const a = useStub(baseExpectations([
      { data: { id: RUN }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ], [{ data: [], error: null }]))
    const ta = scriptedTransport([{ status: 'ok', correlationId: 'c', candidates: [] }])
    await new SupabaseIdentityResolutionService({
      transport: ta.transport,
      proxyEndpoint: 'https://proxy.example.com',
      deploymentProviderUrl: 'https://direct.example.com',
    }).matchIdentity({ subjectId: SUBJECT, trackId: 1, imageBase64: btoa('f'), frameWidth: 1, frameHeight: 1 })
    expect(ta.calls[0]?.endpoint).toBe('https://org-matcher.example.com/match')
    void a

    // No org URL -> deployment proxy is used.
    useStub({
      subjects: [{ data: authorizedSubjectRow(), error: null }],
      organizations: [{ data: { matching_provider_url: null }, error: null }],
      search_runs: [
        { data: { id: RUN }, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
      identity_candidates: [{ data: [], error: null }],
      audit_events: [{ data: null, error: null }],
    })
    const tb = scriptedTransport([{ status: 'ok', correlationId: 'c', candidates: [] }])
    await new SupabaseIdentityResolutionService({
      transport: tb.transport,
      proxyEndpoint: 'https://proxy.example.com/functions/v1/identity-match',
      deploymentProviderUrl: 'https://direct.example.com',
    }).matchIdentity({ subjectId: SUBJECT, trackId: 1, imageBase64: btoa('f'), frameWidth: 1, frameHeight: 1 })
    expect(tb.calls[0]?.endpoint).toBe('https://proxy.example.com/functions/v1/identity-match')

    // Neither -> not_configured without any writes or wire traffic.
    const tc = useStub({
      subjects: [{ data: authorizedSubjectRow(), error: null }],
      organizations: [{ data: { matching_provider_url: null }, error: null }],
    })
    const tt = scriptedTransport([])
    const service = new SupabaseIdentityResolutionService({ transport: tt.transport })
    const result = await service.matchIdentity({
      subjectId: SUBJECT,
      trackId: 1,
      imageBase64: btoa('f'),
      frameWidth: 1,
      frameHeight: 1,
    })
    expect(tt.calls).toHaveLength(0)
    expect(tc.calls.filter((c) => c.table === 'search_runs')).toHaveLength(0)
    expect(tc.calls.filter((c) => c.table === 'audit_events')).toHaveLength(0)
    expect(result).toEqual({ status: 'not_configured' })
  })

  it('never contacts anything or writes anything for a restricted subject', async () => {
    const { calls } = useStub({
      subjects: [
        { data: { ...authorizedSubjectRow(), authorization_state: 'restricted' }, error: null },
      ],
      organizations: [{ data: { matching_provider_url: 'https://x.example.com' }, error: null }],
    })
    const { transport, calls: wireCalls } = scriptedTransport([])
    const service = new SupabaseIdentityResolutionService({ transport })
    await expect(
      service.matchIdentity({
        subjectId: SUBJECT,
        trackId: 1,
        imageBase64: btoa('f'),
        frameWidth: 1,
        frameHeight: 1,
      }),
    ).rejects.toThrowError(AuthorizationRequiredError)
    expect(wireCalls).toHaveLength(0)
    expect(calls.filter((c) => c.op === 'insert' || c.op === 'update')).toHaveLength(0)
  })
})

describe('identity matching orchestration (failure taxonomy)', () => {
  const reasons = [
    'timeout',
    'rate_limited',
    'auth_failed',
    'provider_error',
    'invalid_response',
    'network',
  ] as const

  for (const reason of reasons) {
    it(`records a failed run with reason "${reason}" and throws an honest error`, async () => {
      const { calls } = useStub(
        baseExpectations([
          { data: { id: RUN }, error: null },
          { data: null, error: null },
          { data: null, error: null },
        ]),
      )
      const { transport } = scriptedTransport([
        { status: reason, message: `${reason} detail`, correlationId: 'corr-x' },
      ])
      const service = new SupabaseIdentityResolutionService({ transport })

      const error = await service
        .matchIdentity({
          subjectId: SUBJECT,
          trackId: 1,
          imageBase64: btoa('f'),
          frameWidth: 1,
          frameHeight: 1,
        })
        .then(
          () => null,
          (caught: unknown) => caught,
        )
      expect(error).toBeInstanceOf(AtlasServiceError)
      expect(error).toMatchObject({ code: 'provider_failure' })
      const details = (error as AtlasServiceError).details as {
        reason: string
        correlationId: string
      }
      expect(details.reason).toBe(reason)
      // Correlation id is minted by the orchestrator and echoed by the wire.
      expect(details.correlationId).toMatch(/^[0-9a-f-]{36}$/)
      expect((error as AtlasServiceError).displayMessage.length).toBeGreaterThan(10)

      const updates = calls.filter(
        (c) => c.table === 'search_runs' && c.op === 'update' && typeof c.filters[0] === 'object',
      )
      expect(updates).toHaveLength(2)
      expect(updates[1]?.filters[0]).toMatchObject({
        status: 'failed',
        failure_reason: reason,
      })
      expect(calls.filter((c) => c.table === 'identity_candidates' && c.op === 'insert')).toHaveLength(0)

      // Failed attempts are audited as failures, never as successes.
      const audits = calls.filter((c) => c.table === 'audit_events' && c.op === 'insert')
      for (const audit of audits) {
        expect(String((audit.filters[0] as Record<string, unknown>).detail)).toContain(`(${reason})`)
      }
    })
  }

  it('fails the run when persistence of candidates fails and throws honestly', async () => {
    const { calls } = useStub(
      baseExpectations([
        { data: { id: RUN }, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ], [{ data: null, error: { message: 'insert blocked by RLS' } }]),
    )
    const { transport } = scriptedTransport([
      { status: 'ok', correlationId: 'corr-p', candidates: [providerCandidate()] },
    ])
    const service = new SupabaseIdentityResolutionService({ transport })

    await expect(
      service.matchIdentity({
        subjectId: SUBJECT,
        trackId: 1,
        imageBase64: btoa('f'),
        frameWidth: 1,
        frameHeight: 1,
      }),
    ).rejects.toMatchObject({ code: 'provider_failure' })

    const updates = calls.filter(
      (c) => c.table === 'search_runs' && c.op === 'update' && typeof c.filters[0] === 'object',
    )
    expect(updates[1]?.filters[0]).toMatchObject({
      status: 'failed',
      failure_reason: 'provider_error',
    })
    expect(String((updates[1]?.filters[0] as Record<string, unknown>).error_detail)).toContain(
      'candidate_persistence_failed',
    )
  })

  it('fails loudly when the search run cannot be created (no wire call)', async () => {
    const { calls } = useStub({
      subjects: [{ data: authorizedSubjectRow(), error: null }],
      organizations: [{ data: { matching_provider_url: 'https://m.example.com' }, error: null }],
      search_runs: [{ data: null, error: { message: 'rls denied' } }],
    })
    const { transport, calls: wireCalls } = scriptedTransport([])
    const service = new SupabaseIdentityResolutionService({ transport })
    await expect(
      service.matchIdentity({
        subjectId: SUBJECT,
        trackId: 1,
        imageBase64: btoa('f'),
        frameWidth: 1,
        frameHeight: 1,
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(wireCalls).toHaveLength(0)
    expect(calls.filter((c) => c.table === 'identity_candidates')).toHaveLength(0)
  })
})
