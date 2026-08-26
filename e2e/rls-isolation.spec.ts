/**
 * Hosted RLS + cross-organization isolation E2E (seeded mode only).
 *
 * Two real organizations, two real GoTrue identities, two browser contexts
 * each signed in through the REAL UI. All probes run in-browser via the
 * official supabase-js client with the PUBLIC anon key and the signed-in
 * user's own JWT:  browser -> supabase-js -> PostgREST -> RLS.
 * The service role never touches these code paths.
 */
import type { Browser, Page } from '@playwright/test'
import { expect, test, requireWorld } from './fixtures'
import { pageSupabase } from './helpers/hosted'
import type { SeededWorld } from './helpers/seed'
import { signInViaUi } from './helpers/ui'

test.describe('hosted RLS isolation', () => {
  // Contexts A and B are created lazily per test file run and reused across
  // tests; each signs in through the REAL UI once.
  const sessions = new Map<'a' | 'b', { page: Page; close: () => Promise<void> }>()

  async function sessionFor(
    which: 'a' | 'b',
    w: SeededWorld,
    browser: Browser,
  ): Promise<Page> {
    const existing = sessions.get(which)
    if (existing !== undefined) return existing.page
    const context = await browser.newContext()
    const page = await context.newPage()
    const g = which === 'a' ? w.a : w.b
    await signInViaUi(page, g.userEmail, w.password)
    sessions.set(which, { page, close: () => context.close() })
    return page
  }

  test.afterAll(async () => {
    for (const s of sessions.values()) await s.close()
    sessions.clear()
  })

  /** Zero-row visibility of a direct-ID read for a foreign org's row. */
  function expectForeignInvisible(table: string, id: string) {
    return `(client) => client.from(${JSON.stringify(table)}).select('*').eq('id', ${JSON.stringify(id)})`
  }

  test('two seeded orgs exist with disjoint identities', async ({ world, browser }) => {
    const w = await requireWorld(world)
    world = w

    const a = await sessionFor('a', w, browser)
    const b = await sessionFor('b', w, browser)

    const sbA = await pageSupabase(a)
    const sbB = await pageSupabase(b)

    const orgsA = await sbA.run<Array<{ id: string }>>('orgA lists own org', `(client) => client.from('organizations').select('id')`)
    const orgsB = await sbB.run<Array<{ id: string }>>('orgB lists own org', `(client) => client.from('organizations').select('id')`)

    expect(orgsA.map((o) => o.id)).toContain(w.a.orgId)
    expect(orgsA.map((o) => o.id)).not.toContain(w.b.orgId)
    expect(orgsB.map((o) => o.id)).toEqual([w.b.orgId])
  })

  test('own-org reads return every seeded row class', async ({ world, browser }) => {
    const w = await requireWorld(world)
    const a = await sessionFor('a', w, browser)
    const sb = await pageSupabase(a)

    const visible = await sb.run<Record<string, string[]>>(
      'own-org visibility sweep',
      `(client) => Promise.all([
        'investigations','subjects','intelligence_profiles','intelligence_facts',
        'sources','search_runs','evidence_items','source_retrievals',
        'identity_candidates','media_assets'
      ].map(t => client.from(t).select('id'))).then(rs =>
        Object.fromEntries(['investigations','subjects','intelligence_profiles','intelligence_facts',
        'sources','search_runs','evidence_items','source_retrievals',
        'identity_candidates','media_assets'].map((t,i)=>[t, rs[i].data?.map(r=>r.id) ?? []])))`,
    )

    expect(visible['investigations']).toContain(w.a.investigationId)
    expect(visible['subjects']).toContain(w.a.subjectAuthorizedId)
    expect(visible['intelligence_profiles']).toContain(w.a.profileId)
    expect(visible['intelligence_facts']).toContain(w.a.factId)
    expect(visible['sources']).toContain(w.a.sourceId)
    expect(visible['search_runs']).toContain(w.a.searchRunQueuedId)
    expect(visible['evidence_items']).toContain(w.a.evidenceId)
    expect(visible['source_retrievals']).toContain(w.a.retrievalId)
    expect(visible['identity_candidates']).toContain(w.a.candidateRestrictedSubjectId)
    expect(visible['media_assets']).toContain(w.a.mediaAssetId)
  })

  test('cross-org direct-ID reads are invisible for every row class (org B -> org A)', async ({ world, browser }) => {
    const w = await requireWorld(world)
    const b = await sessionFor('b', w, browser)
    const sb = await pageSupabase(b)

    const matrix: Array<[string, string]> = [
      ['investigations', w.a.investigationId],
      ['subjects', w.a.subjectAuthorizedId],
      ['subjects', w.a.subjectRestrictedId],
      ['intelligence_profiles', w.a.profileId],
      ['intelligence_facts', w.a.factId],
      ['sources', w.a.sourceId],
      ['search_runs', w.a.searchRunQueuedId],
      ['evidence_items', w.a.evidenceId],
      ['source_retrievals', w.a.retrievalId],
      ['identity_candidates', w.a.candidateRestrictedSubjectId],
      ['media_assets', w.a.mediaAssetId],
      ['organizations', w.a.orgId],
    ]

    for (const [table, id] of matrix) {
      const rows = await sb.run<Array<{ id: string }>>(
        `cross-org probe ${table}`,
        expectForeignInvisible(table, id),
      )
      expect(rows, `${table} ${id} must be invisible cross-org`).toEqual([])
    }
  })

  test('restricted-subject gates: candidate status updates and confirmations denied while unauthorized', async ({ world, browser }) => {
    const w = await requireWorld(world)
    const a = await sessionFor('a', w, browser)
    const sb = await pageSupabase(a)

    // Candidate sits on the RESTRICTED subject of org A. Updating its match
    // status must fail (policy requires an authorized subject).
    const candidateUpdate = await sb.run<{ error: string | null }>(
      'candidate update on restricted subject',
      `(client) => client.from('identity_candidates')
        .update({ match_status: 'confirmed' })
        .eq('id', ${JSON.stringify(w.a.candidateRestrictedSubjectId)})
        .then(r => ({ error: r.error ? r.error.message : null }))`,
    )
    expect(candidateUpdate.error).not.toBeNull()

    // Recording a confirmation against that candidate must also be denied.
    const confirmationInsert = await sb.run<{ error: string | null }>(
      'confirmation insert on restricted subject',
      `(client) => client.from('identity_confirmations')
        .insert({ candidate_id: ${JSON.stringify(w.a.candidateRestrictedSubjectId)}, decision: 'rejected' })
        .then(r => ({ error: r.error ? r.error.message : null }))`,
    )
    expect(confirmationInsert.error).not.toBeNull()
  })

  test('cross-org lineage writes rejected by the evidence guard', async ({ world, browser }) => {
    const w = await requireWorld(world)
    const a = await sessionFor('a', w, browser)
    const sb = await pageSupabase(a)

    const result = await sb.run<{ error: string | null }>(
      'evidence insert referencing foreign source',
      `(client) => client.from('evidence_items')
        .insert({
          investigation_id: ${JSON.stringify(w.a.investigationId)},
          subject_id: ${JSON.stringify(w.a.subjectAuthorizedId)},
          source_id: ${JSON.stringify(w.b.sourceId)},
          claim: 'cross-org lineage attempt',
          confidence: 0.5,
          evidence_type: 'web_page'
        })
        .then(r => ({ error: r.error ? r.error.message : null }))`,
    )
    expect(result.error).not.toBeNull()
    expect(result.error).toMatch(/different organization/i)
  })

  test('audit attribution cannot be forged by the client', async ({ world, browser }) => {
    const w = await requireWorld(world)
    const a = await sessionFor('a', w, browser)
    const sb = await pageSupabase(a)

    const inserted = await sb.run<Array<{ id: string; actor_name: string }>>(
      'audit insert with forged actor',
      `(client) => client.from('audit_events')
        .insert({
          organization_id: ${JSON.stringify(w.a.orgId)},
          actor_name: 'Forged Actor',
          action: 'e2e.attribution_probe',
          resource_type: 'probe'
        })
        .select('id,actor_name')`,
    )
    expect(inserted).toHaveLength(1)
    expect(inserted[0].actor_name).toBe(w.a.fullName)

    // Cross-org audit rows stay invisible to the other org.
    const b = await sessionFor('b', w, browser)
    const sbB = await pageSupabase(b)
    const foreignAudit = await sbB.run<Array<{ id: string }>>(
      'foreign audit invisibility',
      expectForeignInvisible('audit_events', inserted[0].id),
    )
    expect(foreignAudit).toEqual([])

    // Cleanup of the probe row happens via the org-wide purge in seed cleanup.
  })

  test('hosted search-run lifecycle state machine is enforced live', async ({ world, browser }) => {
    const w = await requireWorld(world)
    const a = await sessionFor('a', w, browser)
    const sb = await pageSupabase(a)

    // Analyst creates a queued run (write path opened by migration 0004).
    const created = await sb.run<Array<{ id: string }>>(
      'create queued run',
      `(client) => client.from('search_runs')
        .insert({
          investigation_id: ${JSON.stringify(w.a.investigationId)},
          subject_id: ${JSON.stringify(w.a.subjectAuthorizedId)},
          initiated_by: ${JSON.stringify(w.a.userId)},
          query: 'e2e lifecycle probe',
          channel: 'web',
          provider: 'public_web_search'
        })
        .select('id')`,
    )
    const runId = created[0].id

    // Invalid transition queued -> completed must be rejected by the trigger.
    const invalid = await sb.run<{ error: string | null }>(
      'invalid transition probe',
      `(client) => client.from('search_runs')
        .update({ status: 'completed' })
        .eq('id', ${JSON.stringify(runId)})
        .then(r => ({ error: r.error ? r.error.message : null }))`,
    )
    expect(invalid.error).not.toBeNull()

    // Provenance immutability: rewriting the query must be rejected.
    const immutable = await sb.run<{ error: string | null }>(
      'provenance immutability probe',
      `(client) => client.from('search_runs')
        .update({ query: 'rewritten by client' })
        .eq('id', ${JSON.stringify(runId)})
        .then(r => ({ error: r.error ? r.error.message : null }))`,
    )
    expect(immutable.error).not.toBeNull()

    // Valid progression queued -> running -> no_results completes cleanly.
    const running = await sb.run<{ error: string | null }>(
      'queued->running',
      `(client) => client.from('search_runs').update({ status: 'running' }).eq('id', ${JSON.stringify(runId)})
        .then(r => ({ error: r.error ? r.error.message : null }))`,
    )
    expect(running.error).toBeNull()
    const done = await sb.run<{ error: string | null }>(
      'running->no_results',
      `(client) => client.from('search_runs').update({ status: 'no_results' }).eq('id', ${JSON.stringify(runId)})
        .then(r => ({ error: r.error ? r.error.message : null }))`,
    )
    expect(done.error).toBeNull()
  })

  test('hosted source provenance: immutability, dedup, status lifecycle + audit chain', async ({ world, browser }) => {
    const w = await requireWorld(world)
    const a = await sessionFor('a', w, browser)
    const sb = await pageSupabase(a)

    // Rewriting canonical_url is rejected (first-retrieval provenance).
    const rewrite = await sb.run<{ error: string | null }>(
      'canonical_url immutability probe',
      `(client) => client.from('sources')
        .update({ canonical_url: 'https://rewritten.example.org/x' })
        .eq('id', ${JSON.stringify(w.a.sourceId)})
        .then(r => ({ error: r.error ? r.error.message : null }))`,
    )
    expect(rewrite.error).not.toBeNull()

    // Duplicate canonical URL within the same org hits the unique index.
    const dup = await sb.run<{ error: string | null; code: string | null }>(
      'dedup probe',
      `(client) => client.from('sources')
        .insert({
          organization_id: ${JSON.stringify(w.a.orgId)},
          provider: 'public_web_search',
          source_name: 'duplicate probe',
          canonical_url: ${JSON.stringify(w.a.sourceUrl)},
          source_type: 'web_search',
          credibility_score: 0.5
        })
        .then(r => ({ error: r.error ? r.error.message : null, code: r.error?.code ?? null }))`,
    )
    expect(dup.code).toBe('23505')

    // Status lifecycle active -> invalidated succeeds and emits an audit event.
    const invalidate = await sb.run<{ error: string | null }>(
      'invalidate probe',
      `(client) => client.from('sources')
        .update({ status: 'invalidated' })
        .eq('id', ${JSON.stringify(w.a.sourceId)})
        .then(r => ({ error: r.error ? r.error.message : null }))`,
    )
    expect(invalidate.error).toBeNull()

    const auditRows = await sb.run<Array<{ action: string }>>(
      'status-change audit visible',
      `(client) => client.from('audit_events')
        .select('action')
        .eq('organization_id', ${JSON.stringify(w.a.orgId)})
        .eq('action', 'source.status_changed')`,
    )
    expect(auditRows.length).toBeGreaterThanOrEqual(1)
  })
})
