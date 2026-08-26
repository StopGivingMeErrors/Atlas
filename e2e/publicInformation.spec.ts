/**
 * LOCAL PROVIDER E2E — the external public-information (OSINT) ingestion seam.
 *
 * Everything here is REAL except the responder behind one wire endpoint: the
 * organization-configured public-information connector, a deterministic HTTP
 * server implemented with Playwright's page.route (the browser performs
 * genuine fetches; responses are validated by the production contract code).
 *
 * Real end to end: signed-in analyst -> authorized subject profile ->
 * research panel -> connector configuration resolution -> versioned provider
 * contract -> REAL Postgres persistence under RLS -> search-run lifecycle ->
 * source/fact/evidence provenance -> audit trail -> honest UI states.
 *
 * Requires seeded mode. The OSINT URL comes from the SEEDED connector row
 * (connectors.endpoint_url) — configuration precedence is exercised for real,
 * not stubbed. This is NOT a claim that a real external provider was tested.
 */
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { state } from './helpers/hosted'
import { adminRest } from './helpers/hosted'
import { signInViaUi } from './helpers/ui'

interface OsintSentRequest {
  body: Record<string, unknown>
  hasAuthorizationHeader: boolean
}

function validOsintResponse(correlationId: string) {
  return {
    contract_version: 1,
    correlation_id: correlationId,
    provider_name: 'E2E-OSINT',
    results: [
      {
        result_id: 'res-e2e-osint-1',
        display_name: 'Authorized Subject',
        summary: 'Provider-reported summary from the local E2E fixture.',
        published_at: '2024-05-01T00:00:00Z',
        confidence: 0.9,
        facts: [
          {
            category: 'employment',
            label: 'Employer',
            value: 'E2E Provider Corp',
            confidence: 0.82,
          },
        ],
        sources: [
          {
            url: `https://e2e-osint-fixture.example.org/profile?utm_campaign=e2e`,
            title: 'Fixture profile page',
            source_type: 'professional_profile',
            published_at: '2024-04-20T08:00:00Z',
            credibility: 0.7,
          },
        ],
      },
    ],
  }
}

/** Installs the fake OSINT provider speaking contract v1. */
async function interceptOsint(
  page: Page,
  options: {
    respondWith?: (correlationId: string) => { status: number; body: string; delayMs?: number }
  } = {},
): Promise<{ requests: OsintSentRequest[]; hits: () => number }> {
  const requests: OsintSentRequest[] = []
  await page.route(/^https:\/\/atlas-e2e-osint-[a-f0-9]+\.invalid\/v1\/search/, async (route: Route) => {
    const raw = route.request().postData() ?? ''
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(raw) as Record<string, unknown>
    } catch {
      body = { _unparseable: raw }
    }
    requests.push({
      body,
      hasAuthorizationHeader:
        route.request().headers()['authorization'] !== undefined,
    })
    const correlationId = typeof body.correlation_id === 'string' ? body.correlation_id : ''
    const respond =
      options.respondWith ?? ((cid: string) => ({
        status: 200,
        body: JSON.stringify(validOsintResponse(cid)),
      }))
    const response = respond(correlationId)
    if (response.delayMs !== undefined && response.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, response.delayMs))
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: response.body,
    })
  })
  return { requests, hits: () => requests.length }
}

test.describe('local provider E2E - external public information seam', () => {
  test.beforeEach(({ world }) => {
    const s = state()
    test.skip(world === null, s.reason || 'requires seeded mode (service-role credentials)')
  })

  test('browser -> adapter -> local provider -> validation -> database -> provenance -> audit', async ({
    world,
    page,
  }) => {
    test.setTimeout(90_000)
    const w = world!
    const osint = await interceptOsint(page)

    await signInViaUi(page, w.a.userEmail, w.password)
    await page.goto(`/people/${w.a.profileId}`)

    // Run research through the seeded organization connector.
    await page.getByLabel('Research channel').selectOption('news')
    await page.getByRole('button', { name: 'Run research' }).click()

    // Honest completed state with counts.
    await expect(
      page.getByText(/Completed — \d+ source\(s\) and \d+ fact\(s\) recorded/),
    ).toBeVisible({ timeout: 30_000 })

    // The provider-reported fact is rendered with its provenance pill.
    await expect(page.getByText('Employer').first()).toBeVisible()
    await expect(page.getByText('Provider-reported').first()).toBeVisible()
    await expect(page.getByText('E2E Provider Corp')).toBeVisible()

    // ---- Wire request carried ONLY the authorized minimum ----
    expect(osint.requests).toHaveLength(1)
    const sent = osint.requests[0]!
    expect(sent.body.contract_version).toBe(1)
    expect(sent.body.full_name).toBe(`Authorized subject ${w.a.label}`)
    const correlationId = String(sent.body.correlation_id)
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(Object.keys(sent.body).sort()).toEqual([
      'contract_version',
      'correlation_id',
      'full_name',
    ])
    // No credentials ride along on credentialless connector calls.
    expect(sent.hasAuthorizationHeader).toBe(false)

    // ---- REAL DATABASE assertions (runner-side service-role reads) ----
    const runs = await adminRest<{
      id: string
      status: string
      channel: string
      query: string
      provider: string
      sources_found: number | null
      facts_updated: number | null
    }>(
      `search_runs?investigation_id=eq.${w.a.investigationId}&channel=eq.news&order=created_at.desc&limit=1&select=id,status,channel,query,provider,sources_found,facts_updated`,
    )
    expect(runs).toHaveLength(1)
    const run = runs[0]!
    expect(run.status).toBe('completed')
    expect(run.query).toBe(`public-info/news/${correlationId}`)
    expect(run.provider).toBe(new URL(w.a.osintProviderUrl).host)
    expect(run.sources_found).toBeGreaterThanOrEqual(1)
    expect(run.facts_updated).toBeGreaterThanOrEqual(1)

    // Source provenance: configured authority as provider, raw URL kept,
    // tracking parameter canonicalized away, provider date stored verbatim,
    // self-reported provider name confined to metadata.
    const sources = await adminRest<{
      id: string
      provider: string
      canonical_url: string
      original_url: string
      published_at: string | null
      content_hash: string | null
      metadata: Record<string, unknown>
    }>(
      `sources?organization_id=eq.${w.a.orgId}&canonical_url=eq.${encodeURIComponent('https://e2e-osint-fixture.example.org/profile')}&select=id,provider,canonical_url,original_url,published_at,content_hash,metadata`,
    )
    expect(sources).toHaveLength(1)
    const source = sources[0]!
    expect(source.provider).toBe(new URL(w.a.osintProviderUrl).host)
    expect(source.original_url).toContain('utm_campaign=e2e')
    expect(source.published_at).toBe('2024-04-20T08:00:00Z')
    expect(source.content_hash).toBeNull()
    expect(source.metadata.contract_version).toBe(1)
    expect(source.metadata.provider_name).toBe('E2E-OSINT')

    // Fact provenance columns correlate fact -> run + native result id.
    const facts = await adminRest<{
      id: string
      provider_result_id: string | null
      search_run_id: string | null
      provider_confidence: number | null
      confidence: number
    }>(
      `intelligence_facts?intelligence_profile_id=eq.${w.a.profileId}&value=eq.E2E Provider Corp&select=id,provider_result_id,search_run_id,provider_confidence,confidence`,
    )
    expect(facts).toHaveLength(1)
    const fact = facts[0]!
    expect(fact.provider_result_id).toBe('res-e2e-osint-1')
    expect(fact.search_run_id).toBe(run.id)
    expect(fact.provider_confidence).toBeCloseTo(0.82)

    // Evidence lineage links the new fact to the new source.
    const evidence = await adminRest<unknown[]>(
      `evidence_items?fact_id=eq.${fact.id}&source_id=eq.${source.id}&select=id`,
    )
    expect(evidence).toHaveLength(1)

    // Retrieval history recorded for this run.
    const retrievals = await adminRest<unknown[]>(
      `source_retrievals?search_run_id=eq.${run.id}&select=id`,
    )
    expect(retrievals.length).toBeGreaterThanOrEqual(1)

    // Audit trail: started + completed events correlate the run.
    const audits = await adminRest<{ action: string; detail: string }>(
      `audit_events?organization_id=eq.${w.a.orgId}&action=in.(public_information.search_started,public_information.search_completed)&order=created_at.desc&limit=5&select=action,detail`,
    )
    const actions = audits.map((a) => a.action)
    expect(actions).toContain('public_information.search_started')
    expect(actions).toContain('public_information.search_completed')
    for (const audit of audits) {
      expect(audit.detail).toContain(run.id)
      expect(audit.detail).toContain(correlationId)
    }
  })

  test('repeated runs reuse the same source and append retrieval history', async ({
    world,
    page,
  }) => {
    test.setTimeout(90_000)
    const w = world!
    const osint = await interceptOsint(page)

    await signInViaUi(page, w.a.userEmail, w.password)
    await page.goto(`/people/${w.a.profileId}`)
    await page.getByLabel('Research channel').selectOption('news')
    await page.getByRole('button', { name: 'Run research' }).click()
    await expect(
      page.getByText(/Completed|no results/i).first(),
    ).toBeVisible({ timeout: 30_000 })

    // Second run through the SAME channel: dedup + history, not duplication.
    await page.getByRole('button', { name: 'Run research' }).click()
    await expect(
      page.getByText(/Completed|no results/i).first(),
    ).toBeVisible({ timeout: 30_000 })
    expect(osint.hits()).toBe(2)

    const sources = await adminRest<{ id: string }>(
      `sources?organization_id=eq.${w.a.orgId}&canonical_url=eq.${encodeURIComponent('https://e2e-osint-fixture.example.org/profile')}&select=id`,
    )
    expect(sources).toHaveLength(1)

    const retrievals = await adminRest<{ search_run_id: string }>(
      `source_retrievals?source_id=eq.${sources[0]!.id}&select=search_run_id`,
    )
    const distinctRuns = new Set(retrievals.map((r) => r.search_run_id))
    expect(distinctRuns.size).toBe(2)
  })

  test('provider returns nothing: no_results run and honest UI', async ({
    world,
    page,
  }) => {
    const w = world!
    await interceptOsint(page, {
      respondWith: (cid) => ({
        status: 200,
        body: JSON.stringify({
          contract_version: 1,
          correlation_id: cid,
          provider_name: 'E2E-OSINT',
          results: [],
        }),
      }),
    })

    await signInViaUi(page, w.a.userEmail, w.password)
    await page.goto(`/people/${w.a.profileId}`)
    await page.getByLabel('Research channel').selectOption('org_registry')
    await page.getByRole('button', { name: 'Run research' }).click()

    await expect(
      page.getByText(/Completed with no results/),
    ).toBeVisible({ timeout: 30_000 })

    const runs = await adminRest<{ status: string; channel: string }>(
      `search_runs?investigation_id=eq.${w.a.investigationId}&channel=eq.org_registry&order=created_at.desc&limit=1&select=status,channel`,
    )
    expect(runs[0]!.status).toBe('no_results')
  })

  test('stalled provider times out: failed run with reason timeout', async ({
    world,
    page,
  }) => {
    test.setTimeout(90_000)
    const w = world!
    // Delay beyond the adapter's 15s AbortController budget.
    await interceptOsint(page, {
      respondWith: (cid) => ({
        status: 200,
        body: JSON.stringify(validOsintResponse(cid)),
        delayMs: 16_500,
      }),
    })

    await signInViaUi(page, w.a.userEmail, w.password)
    await page.goto(`/people/${w.a.profileId}`)
    await page.getByLabel('Research channel').selectOption('news')
    await page.getByRole('button', { name: 'Run research' }).click()

    await expect(page.getByText(/Timed out/)).toBeVisible({ timeout: 40_000 })

    const runs = await adminRest<{ status: string; failure_reason: string | null }>(
      `search_runs?investigation_id=eq.${w.a.investigationId}&channel=eq.news&status=eq.failed&order=created_at.desc&limit=1&select=status,failure_reason`,
    )
    expect(runs[0]!.failure_reason).toBe('timeout')

    // Nothing was ingested from the timed-out attempt.
    const facts = await adminRest<unknown[]>(
      `intelligence_facts?intelligence_profile_id=eq.${w.a.profileId}&value=eq.E2E Provider Corp&select=id`,
    )
    expect(facts).toHaveLength(0)
  })

  test('malformed provider output fails loudly: invalid_response run, honest UI', async ({
    world,
    page,
  }) => {
    const w = world!
    await interceptOsint(page, {
      respondWith: () => ({ status: 200, body: '<html>waf block page</html>' }),
    })

    await signInViaUi(page, w.a.userEmail, w.password)
    await page.goto(`/people/${w.a.profileId}`)
    await page.getByLabel('Research channel').selectOption('professional_profile')
    await page.getByRole('button', { name: 'Run research' }).click()

    await expect(
      page.getByText(/Invalid provider response/),
    ).toBeVisible({ timeout: 30_000 })

    const runs = await adminRest<{ failure_reason: string | null }>(
      `search_runs?investigation_id=eq.${w.a.investigationId}&channel=eq.professional_profile&order=created_at.desc&limit=1&select=failure_reason`,
    )
    expect(runs[0]!.failure_reason).toBe('invalid_response')
  })

  test('rate limited provider surfaces an honest rate_limited failure', async ({
    world,
    page,
  }) => {
    const w = world!
    await interceptOsint(page, {
      respondWith: () => ({ status: 429, body: 'quota exhausted' }),
    })

    await signInViaUi(page, w.a.userEmail, w.password)
    await page.goto(`/people/${w.a.profileId}`)
    await page.getByLabel('Research channel').selectOption('news')
    await page.getByRole('button', { name: 'Run research' }).click()

    await expect(page.getByText(/Rate limited/)).toBeVisible({ timeout: 30_000 })

    const runs = await adminRest<{ failure_reason: string | null }>(
      `search_runs?investigation_id=eq.${w.a.investigationId}&channel=eq.news&status=eq.failed&order=created_at.desc&limit=1&select=failure_reason`,
    )
    expect(runs[0]!.failure_reason).toBe('rate_limited')
  })

  test('credential rejection surfaces auth_failed without ingestion', async ({
    world,
    page,
  }) => {
    const w = world!
    await interceptOsint(page, {
      respondWith: () => ({ status: 401, body: 'denied' }),
    })

    await signInViaUi(page, w.a.userEmail, w.password)
    await page.goto(`/people/${w.a.profileId}`)
    await page.getByLabel('Research channel').selectOption('news')
    await page.getByRole('button', { name: 'Run research' }).click()

    await expect(
      page.getByText(/Provider authentication failed/),
    ).toBeVisible({ timeout: 30_000 })

    const facts = await adminRest<unknown[]>(
      `intelligence_facts?intelligence_profile_id=eq.${w.a.profileId}&value=eq.E2E Provider Corp&select=id`,
    )
    expect(facts).toHaveLength(0)
  })

  test('cross-org profile access is refused before any wire traffic', async ({
    world,
    page,
  }) => {
    const w = world!
    // Org B's analyst goes straight at org A's profile URL.
    const osintB = await interceptOsint(page)
    await signInViaUi(page, w.b.userEmail, w.password)
    await page.goto(`/people/${w.a.profileId}`)

    // Honest not-found treatment, not a data leak.
    await expect(
      page.getByText(/could not be found|not found/i).first(),
    ).toBeVisible({ timeout: 20_000 })
    expect(osintB.hits()).toBe(0)
  })
})
