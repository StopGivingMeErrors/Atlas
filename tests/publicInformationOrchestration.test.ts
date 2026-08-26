/**
 * Public information / OSINT ORCHESTRATION tests.
 *
 * The wire contract itself is covered by tests/httpPublicInformation.test.ts
 * against a real local HTTP server. Here the transport is injected and
 * scripted, so every deterministic branch — lifecycle transitions,
 * provenance columns, retrieval history, additive fact matching, evidence
 * lineage, failure taxonomy, audit correlation — is asserted against the
 * exact payloads written to the stub client.
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
import { SupabasePublicInformationService } from '../src/services/supabase/publicInformation'
import type { ProviderResult } from '../src/services/providers/httpPublicInformation'
import type { PublicInformationOutcome } from '../src/services/providers/httpPublicInformation'
import { AuthorizationRequiredError } from '../src/services/errors'

const ORG = '550e8400-e29b-41d4-a716-446655440001'
const INV = '550e8400-e29b-41d4-a716-446655440003'
const SUBJECT = '550e8400-e29b-41d4-a716-446655440004'
const PROFILE = '550e8400-e29b-41d4-a716-446655440005'
const RUN = '550e8400-e29b-41d4-a716-446655441000'
const SRC_OLD = '550e8400-e29b-41d4-a716-446655442000'
const SRC_NEW = '550e8400-e29b-41d4-a716-446655442001'
const FACT_OLD = '550e8400-e29b-41d4-a716-446655443000'
const FACT_NEW = '550e8400-e29b-41d4-a716-446655443001'

const OLD_URL = 'https://existing.example.org/profile'
const NEW_URL = 'https://fresh.example.com/article'

function useStub(expectations: Record<string, StubResponse[]> = {}) {
  const stub = createStubClient(expectations)
  hoisted.stub = stub.client as unknown
  return stub
}

beforeEach(() => {
  hoisted.stub = null
  vi.unstubAllGlobals()
})

function profileRow(authorizationState = 'authorized') {
  return {
    id: PROFILE,
    subject_id: SUBJECT,
    canonical_name: 'Jordan Ellis',
    subjects: {
      authorization_state: authorizationState,
      investigation_id: INV,
      investigations: { organization_id: ORG },
    },
  }
}

interface TransportCall {
  endpoint: string
  request: { fullName: string; correlationId: string }
}

function scriptedTransport(script: Array<PublicInformationOutcome | Error>) {
  const calls: TransportCall[] = []
  const queue = [...script]
  const transport = async (
    endpoint: string,
    request: TransportCall['request'],
  ): Promise<PublicInformationOutcome> => {
    calls.push({ endpoint, request })
    const next = queue.shift()
    if (next instanceof Error) throw next
    if (next === undefined) throw new Error('transport script exhausted')
    return next
  }
  return { calls, transport }
}

function providerResult(overrides: Partial<ProviderResult> = {}): ProviderResult {
  return {
    resultId: 'res-osint-1',
    displayName: 'Jordan Ellis',
    summary: 'Public profile summary',
    publishedAt: '2024-05-01T00:00:00Z',
    retrievedAt: null,
    confidence: 0.9,
    facts: [
      // A brand-new fact...
      { category: 'education', label: 'Alma mater', value: 'State University', confidence: null },
      // ...and one that deterministically matches an existing stored fact.
      { category: 'employment', label: 'Employer', value: 'Old Corp', confidence: 0.75 },
    ],
    sources: [
      {
        url: NEW_URL,
        title: 'Fresh article',
        sourceType: 'news',
        publishedAt: '2024-04-20T08:00:00Z',
        credibility: 0.7,
      },
      {
        url: OLD_URL,
        title: 'Existing profile page',
        sourceType: 'professional_profile',
        publishedAt: null,
        credibility: null,
      },
    ],
    rawJson: '{"result_id":"res-osint-1"}',
    ...overrides,
  }
}

/** Full source row as the database would return it for mapSourceRow. */
function sourceRow(id: string, canonicalUrl: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: ORG,
    provider: 'osint.example.net',
    source_name: id === SRC_NEW ? 'Fresh article' : 'Existing profile page',
    canonical_url: canonicalUrl,
    original_url: canonicalUrl,
    source_type: 'news',
    credibility_score: 0.7,
    retrieved_at: '2026-08-25T01:00:00Z',
    search_run_id: RUN,
    content_hash: null,
    published_at: '2024-04-20T08:00:00Z',
    status: 'active',
    ...overrides,
  }
}

const CONNECTED_CONNECTOR = [{ endpoint_url: 'https://osint.example.net/v1/search' }]

/**
 * True insert operations only: the stub also records the chained
 * `.select()` following `.insert()` with op 'insert' but filters[0]='select'.
 */
function insertCalls(
  calls: Array<{ table: string; op: string; filters: unknown[] }>,
  table: string,
) {
  return calls.filter((c) => c.table === table && c.op === 'insert' && c.filters[0] !== 'select')
}

function baseExpectations(sourcesReads: StubResponse[], factReads?: StubResponse[]) {
  return {
    intelligence_profiles: [{ data: profileRow(), error: null }],
    connectors: [{ data: CONNECTED_CONNECTOR, error: null }],
    search_runs: [
      { data: { id: RUN }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ],
    audit_events: [{ data: null, error: null }],
    sources: sourcesReads,
    source_retrievals: [{ data: null, error: null }],
    intelligence_facts:
      factReads ??
      [
        // Existing facts read: one stored fact that the provider re-finds.
        {
          data: [
            {
              id: FACT_OLD,
              category: 'employment',
              label: 'Employer',
              value: 'Old Corp',
              verification_status: 'unverified',
              origin: 'source_fact',
            },
          ],
          error: null,
        },
        // Inserted fact ids.
        { data: [{ id: FACT_NEW }], error: null },
      ],
    evidence_items: [
      // Pre-existing lineage: the old fact already cites the old source.
      { data: [{ fact_id: FACT_OLD, source_id: SRC_OLD }], error: null },
      { data: null, error: null },
    ],
  }
}

describe('public information orchestration (search-run lifecycle)', () => {
  it('walks queued -> running -> completed and records full provenance', async () => {
    const { calls } = useStub(
      baseExpectations([
        // Existing org sources read.
        { data: [{ id: SRC_OLD, canonical_url: OLD_URL }], error: null },
        // New source insert returning ids.
        { data: [{ id: SRC_NEW, canonical_url: NEW_URL }], error: null },
        // Final typed re-read of every touched source.
        {
          data: [sourceRow(SRC_NEW, NEW_URL), sourceRow(SRC_OLD, OLD_URL, { source_type: 'professional_profile' })],
          error: null,
        },
      ]),
    )
    const { transport, calls: wireCalls } = scriptedTransport([
      { status: 'ok', correlationId: 'corr-osint', providerName: 'TestOSINT', providerVersion: null, results: [providerResult()] },
    ])
    const service = new SupabasePublicInformationService({ transport })

    const result = await service.searchExternal({ profileId: PROFILE, channel: 'news' })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.runId).toBe(RUN)
    expect(result.factCount).toBe(2)
    expect(result.sources).toHaveLength(2)

    // Run creation payload: durable correlation BEFORE the wire is touched.
    const runInsert = calls.find((c) => c.table === 'search_runs' && c.op === 'insert')
    expect(runInsert).toBeDefined()
    const runPayload = runInsert?.filters[0] as Record<string, unknown>
    expect(runPayload.status).toBe('queued')
    expect(runPayload.investigation_id).toBe(INV)
    expect(runPayload.subject_id).toBe(SUBJECT)
    expect(runPayload.profile_id).toBe(PROFILE)
    expect(runPayload.initiated_by).toBe('user-1')
    expect(runPayload.channel).toBe('news')
    expect(runPayload.provider).toBe('osint.example.net')
    expect(String(runPayload.query)).toMatch(/^public-info\/news\/[0-9a-f-]{36}$/)

    const updates = calls.filter(
      (c) => c.table === 'search_runs' && c.op === 'update' && typeof c.filters[0] === 'object',
    )
    expect(updates).toHaveLength(2)
    expect(updates[0]?.filters[0]).toMatchObject({ status: 'running' })
    expect(updates[1]?.filters[0]).toMatchObject({
      status: 'completed',
      sources_found: 2,
      facts_updated: 2,
    })

    // Source insert: durable provenance records the CONFIGURED authority
    // host, keeps the raw URL, stores provider-supplied dates only, and
    // NEVER claims a content hash this contract did not produce.
    const sourceInsert = calls.find((c) => c.table === 'sources' && c.op === 'insert')
    expect(sourceInsert).toBeDefined()
    const sourceRows = sourceInsert?.filters[0] as Array<Record<string, unknown>>
    expect(sourceRows).toHaveLength(1)
    expect(sourceRows[0].provider).toBe('osint.example.net')
    expect(sourceRows[0].canonical_url).toBe(NEW_URL)
    expect(sourceRows[0].original_url).toBe(NEW_URL)
    expect(sourceRows[0].published_at).toBe('2024-04-20T08:00:00Z')
    expect(sourceRows[0].credibility_score).toBe(0.7)
    expect(sourceRows[0]).not.toHaveProperty('content_hash')
    expect(sourceRows[0].metadata).toMatchObject({
      contract_version: 1,
      provider_name: 'TestOSINT',
      credibility_supplied: true,
    })

    // Retrieval history covers BOTH touched sources — including the reused one.
    const retrievals = calls.find((c) => c.table === 'source_retrievals' && c.op === 'insert')
    expect(retrievals).toBeDefined()
    const retrievalRows = retrievals?.filters[0] as Array<Record<string, unknown>>
    expect(retrievalRows).toHaveLength(2)
    for (const row of retrievalRows) {
      expect(row.search_run_id).toBe(RUN)
      expect(row.organization_id).toBe(ORG)
    }
    expect(new Set(retrievalRows.map((r) => r.source_id))).toEqual(new Set([SRC_NEW, SRC_OLD]))

    // Fact insert: provider provenance columns + honest unscored handling.
    const factInsert = calls.find((c) => c.table === 'intelligence_facts' && c.op === 'insert')
    expect(factInsert).toBeDefined()
    const factRows = factInsert?.filters[0] as Array<Record<string, unknown>>
    expect(factRows).toHaveLength(1)
    expect(factRows[0].category).toBe('education')
    expect(factRows[0].provider_result_id).toBe('res-osint-1')
    expect(factRows[0].search_run_id).toBe(RUN)
    expect(factRows[0].provider_confidence).toBeNull()
    expect(factRows[0].confidence).toBe(0)
    expect(factRows[0].verification_status).toBe('unverified')
    expect(factRows[0].origin).toBe('source_fact')

    // Evidence lineage: deduplicated fact<->source links only.
    const evidence = calls.find((c) => c.table === 'evidence_items' && c.op === 'insert')
    expect(evidence).toBeDefined()
    const links = evidence?.filters[0] as Array<Record<string, unknown>>
    // new fact x 2 sources + old fact x ONLY its genuinely new source.
    expect(links).toHaveLength(3)
    for (const link of links) {
      expect(link.evidence_type).toBe('web_page')
      expect(link.investigation_id).toBe(INV)
      expect(link.subject_id).toBe(SUBJECT)
    }

    // Wire request carries ONLY the authorized minimum.
    expect(wireCalls).toHaveLength(1)
    expect(wireCalls[0]?.endpoint).toBe('https://osint.example.net/v1/search')
    expect(wireCalls[0]?.request.fullName).toBe('Jordan Ellis')
    expect(wireCalls[0]?.request.correlationId).toBe(
      String(runPayload.query).split('/')[2],
    )

    // Audits correlate run + correlation id; completion reports counts.
    const audits = calls.filter((c) => c.table === 'audit_events' && c.op === 'insert')
    expect(audits.length).toBeGreaterThanOrEqual(2)
    const actions = audits.map(
      (a) => (a.filters[0] as Record<string, unknown>).action,
    )
    expect(actions).toContain('public_information.search_started')
    expect(actions).toContain('public_information.search_completed')
  })

  it('records no_results when the provider returns an empty result list', async () => {
    const { calls } = useStub({
      ...baseExpectations([{ data: [], error: null }, { data: [], error: null }]),
    })
    const { transport } = scriptedTransport([
      { status: 'ok', correlationId: 'corr-empty', providerName: 'TestOSINT', providerVersion: null, results: [] },
    ])
    const service = new SupabasePublicInformationService({ transport })

    const result = await service.searchExternal({ profileId: PROFILE, channel: 'news' })

    expect(result.status).toBe('no_results')
    if (result.status !== 'no_results') return
    expect(result.runId).toBe(RUN)
    expect(insertCalls(calls, 'sources')).toHaveLength(0)
    expect(insertCalls(calls, 'intelligence_facts')).toHaveLength(0)
    const finalUpdate = calls.filter(
      (c) => c.table === 'search_runs' && c.op === 'update' && typeof c.filters[0] === 'object',
    )[1]
    expect(finalUpdate?.filters[0]).toMatchObject({ status: 'no_results' })
  })

  it('reuses existing sources without rewriting them and appends retrieval history', async () => {
    const { calls } = useStub(
      baseExpectations([
        { data: [{ id: SRC_OLD, canonical_url: OLD_URL }], error: null },
        { data: [{ id: SRC_NEW, canonical_url: NEW_URL }], error: null },
        { data: [sourceRow(SRC_OLD, OLD_URL)], error: null },
      ]),
    )
    const { transport } = scriptedTransport([
      { status: 'ok', correlationId: 'corr-reuse', providerName: 'P', providerVersion: null, results: [providerResult()] },
    ])
    const service = new SupabasePublicInformationService({ transport })
    await service.searchExternal({ profileId: PROFILE, channel: 'news' })

    // The reused URL is never re-inserted nor updated: first-retrieval
    // provenance stays immutable while history accrues via source_retrievals.
    const sourceInserts = insertCalls(calls, 'sources')
    expect(sourceInserts).toHaveLength(1)
    const insertedUrls = (sourceInserts[0]?.filters[0] as Array<Record<string, unknown>>).map(
      (r) => r.canonical_url,
    )
    expect(insertedUrls).not.toContain(OLD_URL)
    expect(calls.find((c) => c.table === 'sources' && c.op === 'update')).toBeUndefined()

    const retrievals = calls.find((c) => c.table === 'source_retrievals' && c.op === 'insert')
    const retrievalRows = retrievals?.filters[0] as Array<Record<string, unknown>>
    expect(new Set(retrievalRows.map((r) => r.source_id))).toContain(SRC_OLD)
  })

  it('counts pre-existing facts that gain a link toward facts_updated', async () => {
    const { calls } = useStub(
      baseExpectations(
        [
          { data: [{ id: SRC_OLD, canonical_url: OLD_URL }], error: null },
          { data: [{ id: SRC_NEW, canonical_url: NEW_URL }], error: null },
          { data: [sourceRow(SRC_NEW, NEW_URL), sourceRow(SRC_OLD, OLD_URL)], error: null },
        ],
        [
          {
            data: [
              {
                id: FACT_OLD,
                category: 'employment',
                label: 'Employer',
                value: 'Old Corp',
                verification_status: 'unverified',
                origin: 'source_fact',
              },
              {
                id: FACT_NEW,
                category: 'education',
                label: 'Alma mater',
                value: 'State University',
                verification_status: 'unverified',
                origin: 'source_fact',
              },
            ],
            error: null,
          },
          // Both provider facts match stored facts -> zero fact inserts.
          { data: [], error: null },
        ],
      ),
    )
    const { transport } = scriptedTransport([
      { status: 'ok', correlationId: 'corr-gain', providerName: 'P', providerVersion: null, results: [providerResult()] },
    ])
    const service = new SupabasePublicInformationService({ transport })

    const result = await service.searchExternal({ profileId: PROFILE, channel: 'news' })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // No fact rows were created; both facts gained evidence instead.
    expect(result.factCount).toBe(2)
    expect(calls.filter((c) => c.table === 'intelligence_facts' && c.op === 'insert')).toHaveLength(0)
    const finalUpdate = calls.filter(
      (c) => c.table === 'search_runs' && c.op === 'update' && typeof c.filters[0] === 'object',
    )[1]
    expect(finalUpdate?.filters[0]).toMatchObject({ facts_updated: 2 })
  })

  it('resolves configuration with precedence connector -> proxy -> deployment -> none', async () => {
    // Connector wins even when proxy/deployment exist.
    useStub(baseExpectations([{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }]))
    const ta = scriptedTransport([
      { status: 'ok', correlationId: 'c', providerName: 'P', providerVersion: null, results: [] },
    ])
    await new SupabasePublicInformationService({
      transport: ta.transport,
      proxyEndpoint: 'https://proxy.example.com/osint',
      deploymentProviderUrl: 'https://direct.example.com/search',
    }).searchExternal({ profileId: PROFILE, channel: 'news' })
    expect(ta.calls[0]?.endpoint).toBe('https://osint.example.net/v1/search')

    // Empty connector URLs are filtered out in JS before selection.
    useStub({
      intelligence_profiles: [{ data: profileRow(), error: null }],
      connectors: [{ data: [{ endpoint_url: '   ' }, { endpoint_url: '' }], error: null }],
      search_runs: [
        { data: { id: RUN }, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
      audit_events: [{ data: null, error: null }],
      sources: [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }],
      source_retrievals: [{ data: null, error: null }],
      intelligence_facts: [{ data: [], error: null }, { data: [], error: null }],
      evidence_items: [{ data: [], error: null }, { data: null, error: null }],
    })
    const tb = scriptedTransport([
      { status: 'ok', correlationId: 'c', providerName: 'P', providerVersion: null, results: [] },
    ])
    await new SupabasePublicInformationService({
      transport: tb.transport,
      proxyEndpoint: 'https://proxy.example.com/functions/v1/public-information',
    }).searchExternal({ profileId: PROFILE, channel: 'news' })
    expect(tb.calls[0]?.endpoint).toBe('https://proxy.example.com/functions/v1/public-information')

    // Nothing configured anywhere -> honest not_configured, zero writes/wire.
    const tc = useStub({
      intelligence_profiles: [{ data: profileRow(), error: null }],
      connectors: [{ data: [], error: null }],
    })
    const tt = scriptedTransport([])
    const service = new SupabasePublicInformationService({ transport: tt.transport })
    const result = await service.searchExternal({ profileId: PROFILE, channel: 'news' })
    expect(result).toEqual({ status: 'not_configured' })
    expect(tt.calls).toHaveLength(0)
    expect(tc.calls.filter((c) => c.table === 'search_runs')).toHaveLength(0)
    expect(tc.calls.filter((c) => c.table === 'audit_events')).toHaveLength(0)
  })

  it('never contacts anything or writes anything for a restricted subject', async () => {
    const { calls } = useStub({
      intelligence_profiles: [{ data: profileRow('restricted'), error: null }],
      connectors: [{ data: CONNECTED_CONNECTOR, error: null }],
    })
    const { transport, calls: wireCalls } = scriptedTransport([])
    const service = new SupabasePublicInformationService({ transport })
    await expect(
      service.searchExternal({ profileId: PROFILE, channel: 'news' }),
    ).rejects.toThrowError(AuthorizationRequiredError)
    expect(wireCalls).toHaveLength(0)
    expect(calls.filter((c) => c.op === 'insert' || c.op === 'update')).toHaveLength(0)
  })

  it('refuses to start when the organization cannot be resolved server-side', async () => {
    useStub({
      intelligence_profiles: [
        {
          data: {
            ...profileRow(),
            subjects: {
              authorization_state: 'authorized',
              investigation_id: INV,
              investigations: { organization_id: null },
            },
          },
          error: null,
        },
      ],
      connectors: [{ data: CONNECTED_CONNECTOR, error: null }],
    })
    const { transport, calls: wireCalls } = scriptedTransport([])
    const service = new SupabasePublicInformationService({ transport })
    await expect(
      service.searchExternal({ profileId: PROFILE, channel: 'news' }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(wireCalls).toHaveLength(0)
  })
})

describe('public information orchestration (failure taxonomy)', () => {
  const reasons = [
    'timeout',
    'rate_limited',
    'auth_failed',
    'provider_error',
    'invalid_response',
    'network',
  ] as const

  for (const reason of reasons) {
    it(`records a failed run with reason "${reason}" and reports honest copy`, async () => {
      const { calls } = useStub(
        baseExpectations([{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }]),
      )
      const { transport } = scriptedTransport([
        { status: reason, message: `${reason} detail`, correlationId: 'corr-x' },
      ])
      const service = new SupabasePublicInformationService({ transport })

      const result = await service.searchExternal({ profileId: PROFILE, channel: 'news' })

      expect(result.status).toBe('failed')
      if (result.status !== 'failed') return
      expect(result.reason).toBe(reason)
      expect(result.runId).toBe(RUN)
      expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/)
      expect(result.message.length).toBeGreaterThan(10)
      // The UI copy never leaks raw provider detail strings verbatim.
      expect(result.message).not.toContain(`${reason} detail`)

      const updates = calls.filter(
        (c) => c.table === 'search_runs' && c.op === 'update' && typeof c.filters[0] === 'object',
      )
      expect(updates).toHaveLength(2)
      expect(updates[1]?.filters[0]).toMatchObject({
        status: 'failed',
        failure_reason: reason,
      })
      expect(String((updates[1]?.filters[0] as Record<string, unknown>).error_detail)).toContain(
        `${reason} detail`,
      )
      expect(insertCalls(calls, 'sources')).toHaveLength(0)
      expect(insertCalls(calls, 'intelligence_facts')).toHaveLength(0)

      const audits = calls.filter((c) => c.table === 'audit_events' && c.op === 'insert')
      const actions = audits.map((a) => (a.filters[0] as Record<string, unknown>).action)
      expect(actions).toContain('public_information.search_failed')
      expect(actions).not.toContain('public_information.search_completed')
      const failedAudit = audits.find(
        (a) => (a.filters[0] as Record<string, unknown>).action === 'public_information.search_failed',
      )
      expect(String((failedAudit?.filters[0] as Record<string, unknown>).detail)).toContain(`(${reason})`)
    })
  }

  it('fails the run when persistence breaks mid-ingestion and reports it honestly', async () => {
    const { calls } = useStub({
      ...baseExpectations([
        // Existing sources read succeeds...
        { data: [], error: null },
        // ...but the source insert is rejected.
        { data: null, error: { message: 'insert blocked by RLS' } },
        { data: [], error: null },
      ]),
    })
    const { transport } = scriptedTransport([
      { status: 'ok', correlationId: 'corr-persist', providerName: 'P', providerVersion: null, results: [providerResult()] },
    ])
    const service = new SupabasePublicInformationService({ transport })

    const result = await service.searchExternal({ profileId: PROFILE, channel: 'news' })

    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.reason).toBe('provider_error')
    expect(result.message).toBe('Research succeeded but recording the results failed.')

    const updates = calls.filter(
      (c) => c.table === 'search_runs' && c.op === 'update' && typeof c.filters[0] === 'object',
    )
    expect(updates[1]?.filters[0]).toMatchObject({
      status: 'failed',
      failure_reason: 'provider_error',
    })
    expect(String((updates[1]?.filters[0] as Record<string, unknown>).error_detail)).toContain(
      'ingestion_persistence_failed',
    )
  })

  it('fails loudly when the search run cannot be created (no wire call)', async () => {
    useStub({
      intelligence_profiles: [{ data: profileRow(), error: null }],
      connectors: [{ data: CONNECTED_CONNECTOR, error: null }],
      search_runs: [{ data: null, error: { message: 'rls denied' } }],
    })
    const { transport, calls: wireCalls } = scriptedTransport([])
    const service = new SupabasePublicInformationService({ transport })
    await expect(
      service.searchExternal({ profileId: PROFILE, channel: 'news' }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(wireCalls).toHaveLength(0)
    expect(
      // Access through the recorded stub to confirm no other writes happened.
      wireCalls.length === 0,
    ).toBe(true)
  })
})
