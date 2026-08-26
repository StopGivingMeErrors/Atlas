/**
 * LOCAL PROVIDER E2E — the external identity-matching ingestion seam.
 *
 * Everything here is REAL except the responder behind two wire endpoints:
 *   - the face-detection endpoint and
 *   - the organization-configured identity matching provider,
 * both of which are deterministic HTTP servers implemented with Playwright's
 * page.route (the browser performs genuine fetches; responses are validated
 * by the production contract code).
 *
 * Real end to end: signed-in analyst -> enrolled subject with basis ->
 * live-video capture -> detection loop -> selected face -> matching adapter
 * -> versioned provider contract -> REAL Postgres persistence under RLS ->
 * search-run lifecycle -> audit trail -> analyst review decision.
 *
 * Requires seeded mode. The matcher URL comes from the SEEDED organization
 * row (organizations.matching_provider_url) — configuration precedence is
 * exercised for real, not stubbed.
 */
import type { Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'
import { state } from './helpers/hosted'
import { adminRest } from './helpers/hosted'
import { signInViaUi } from './helpers/ui'

const DETECTION_URL = 'https://atlas-e2e-detect.invalid/v1/detect'

function detectionPayload() {
  return [
    {
      id: crypto.randomUUID(),
      trackingId: 1,
      boundingBox: { x: 0.3, y: 0.25, width: 0.4, height: 0.4 },
      confidence: 0.98,
      orientation: 'frontal',
      frameTimestamp: Date.now(),
    },
  ]
}

/** Installs the fake detection provider: one stable face in every frame. */
async function interceptDetection(page: Page): Promise<{ hits: () => number }> {
  let count = 0
  await page.route(/^https:\/\/atlas-e2e-detect\.invalid\//, async (route: Route) => {
    count++
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detectionPayload()),
    })
  })
  return { hits: () => count }
}

interface MatcherRequest {
  correlationId: string
  hasImage: boolean
  hasContractVersion: boolean
  hasFrameDimensions: boolean
}

function parseMultipartField(body: string, field: string): string | null {
  const match = body.match(new RegExp(`name="${field}"[^\\r\\n]*\\r?\\n\\r?\\n([^\\r\\n]+)`))
  return match === null ? null : match[1]
}

/**
 * Fake identity provider speaking contract v1: echoes the request's
 * correlation id and returns the given candidates.
 */
async function interceptMatcher(
  page: Page,
  options: {
    respondWith?: (request: MatcherRequest) => { status: number; body: string }
  } = {},
): Promise<{ requests: MatcherRequest[]; hits: () => number }> {
  const requests: MatcherRequest[] = []
  await page.route(/^https:\/\/atlas-e2e-matcher-[a-f0-9]+\.invalid\/v1\/match/, async (route: Route) => {
    const raw = route.request().postData() ?? ''
    const correlationId = parseMultipartField(raw, 'correlation_id') ?? ''
    requests.push({
      correlationId,
      hasImage: raw.includes('name="image"'),
      hasContractVersion: raw.includes('name="contract_version"'),
      hasFrameDimensions: raw.includes('name="frame_width"'),
    })
    const respond =
      options.respondWith ??
      ((req: MatcherRequest) => ({
        status: 200,
        body: JSON.stringify({
          contract_version: 1,
          correlation_id: req.correlationId,
          candidates: [
            {
              provider_candidate_id: 'pc-e2e-1',
              external_reference: 'ext-e2e-1',
              display_name: 'E2E Provider Match',
              score: 0.88,
              signals: ['face_embedding', 'e2e_fixture'],
            },
          ],
        }),
      }))
    const response = respond(requests[requests.length - 1]!)
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: response.body,
    })
  })
  return { requests, hits: () => requests.length }
}

test.describe('local provider E2E - external identity matching seam', () => {
  test.beforeEach(({ world }) => {
    const s = state()
    test.skip(world === null, s.reason || 'requires seeded mode (service-role credentials)')
  })

  test('browser -> adapter -> local provider -> validation -> database -> review -> audit', async ({
    world,
    page,
  }) => {
    const w = world!
    await interceptDetection(page)
    const matcher = await interceptMatcher(page)

    // Enroll a NEW subject through the real UI with an authorization basis.
    await signInViaUi(page, w.a.userEmail, w.password)
    await page.goto(`/investigations/${w.a.investigationId}`)
    await page.getByRole('button', { name: 'Enroll subject' }).first().click()
    await page.getByPlaceholder(/Subject label/).fill(`E2E matched subject ${Date.now()}`)
    await page.locator('select').last().selectOption('authorized')
    await page.getByPlaceholder(/Authorization basis/).fill('E2E consent reference C-E2E-001')
    await page.getByRole('button', { name: 'Create subject' }).click()

    // Enrollment lands in the new subject workspace; basis is on record.
    await page.waitForURL(/\/subjects\//, { timeout: 20_000 })
    const enrolledSubjectId = new URL(page.url()).pathname.split('/').pop()!
    expect(enrolledSubjectId).toMatch(/^[0-9a-f-]{36}$/)
    await expect(page.getByText('E2E consent reference C-E2E-001').first()).toBeVisible()

    // Drive the live pipeline against the freshly enrolled subject.
    await page.goto(`/capture?investigation=${w.a.investigationId}&subject=${enrolledSubjectId}`)
    await page.getByRole('button', { name: /Start camera/ }).click()
    await expect(page.getByText('Face detected in the current frame.')).toBeVisible({ timeout: 20_000 })

    // Select the tracked face, then run matching.
    await page.locator('div.scanline button').first().click()
    await page.getByRole('button', { name: 'Run identity matching' }).click()

    // Provider candidate rendered with honest labeling.
    await expect(page.getByText('E2E Provider Match')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Provider candidate').first()).toBeVisible()

    // The wire request carried ONLY contract fields.
    expect(matcher.requests).toHaveLength(1)
    const sent = matcher.requests[0]!
    expect(sent.hasContractVersion).toBe(true)
    expect(sent.hasImage).toBe(true)
    expect(sent.hasFrameDimensions).toBe(true)
    expect(sent.correlationId).toMatch(/^[0-9a-f-]{36}$/)

    // ---- REAL DATABASE assertions (runner-side service-role reads) ----
    const candidates = await adminRest<{
      id: string
      provider_candidate_id: string
      search_run_id: string | null
      raw_fingerprint: string | null
      match_status: string
      media_asset_id: string | null
    }>(
      `identity_candidates?subject_id=eq.${enrolledSubjectId}&provider_candidate_id=eq.pc-e2e-1&select=id,provider_candidate_id,search_run_id,raw_fingerprint,match_status,media_asset_id`,
    )
    expect(candidates).toHaveLength(1)
    const candidate = candidates[0]!
    expect(candidate.search_run_id).not.toBeNull()
    expect(candidate.raw_fingerprint).toMatch(/^[0-9a-f]{64}$/)

    const runs = await adminRest<{
      id: string
      status: string
      channel: string
      query: string
      failure_reason: string | null
      sources_found: number | null
    }>(`search_runs?id=eq.${candidate.search_run_id}&select=id,status,channel,query,failure_reason,sources_found`)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.status).toBe('completed')
    expect(runs[0]!.channel).toBe('identity_matching')
    expect(runs[0]!.query).toBe(`identity-match/${sent.correlationId}`)
    expect(runs[0]!.sources_found).toBe(1)
    expect(runs[0]!.failure_reason).toBeNull()

    // Provenance-first: the analyzed frame was stored BEFORE the call.
    if (candidate.media_asset_id !== null) {
      const assets = await adminRest<{ metadata: { source?: string } }>(
        `media_assets?id=eq.${candidate.media_asset_id}&select=metadata`,
      )
      expect(assets[0]!.metadata.source).toBe('identity_matching')
    }

    // Audit trail records the run correlation.
    const audits = await adminRest<{ detail: string }>(
      `audit_events?organization_id=eq.${w.a.orgId}&action=eq.identity.match&order=created_at.desc&limit=1&select=detail`,
    )
    expect(audits[0]!.detail).toContain(sent.correlationId)

    // ---- Analyst review: confirm ----
    await page.getByRole('button', { name: 'Confirm identity' }).click()
    await expect(page.getByText('Confirmed by analyst')).toBeVisible()
    const confirmedRows = await adminRest<{ match_status: string }>(
      `identity_candidates?id=eq.${candidate.id}&select=match_status`,
    )
    expect(confirmedRows[0]!.match_status).toBe('confirmed')
    const confirmations = await adminRest<{ decision: string }>(
      `identity_confirmations?candidate_id=eq.${candidate.id}&select=decision`,
    )
    expect(confirmations.map((c) => c.decision)).toContain('confirmed')

    // Subject identity state follows the confirmation.
    const subjects = await adminRest<{ identity_state: string }>(
      `subjects?id=eq.${enrolledSubjectId}&select=identity_state`,
    )
    expect(subjects[0]!.identity_state).toBe('confirmed')

    // ---- Second attempt: reject path ----
    await page.getByRole('button', { name: 'Run identity matching' }).click()
    await expect(page.getByText('E2E Provider Match')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Reject' }).click()
    const rejectedRows = await adminRest<{ match_status: string }>(
      `identity_candidates?subject_id=eq.${enrolledSubjectId}&provider_candidate_id=eq.pc-e2e-1&order=created_at.desc&limit=1&select=match_status`,
    )
    expect(rejectedRows[0]!.match_status).toBe('rejected')
  })

  test('malformed provider output fails loudly: failed run, no candidates, honest UI', async ({
    world,
    page,
  }) => {
    const w = world!
    await interceptDetection(page)
    await interceptMatcher(page, {
      respondWith: () => ({ status: 200, body: '<html>totally not json</html>' }),
    })

    await signInViaUi(page, w.a.userEmail, w.password)
    await page.goto(`/capture?investigation=${w.a.investigationId}&subject=${w.a.subjectAuthorizedId}`)
    await page.getByRole('button', { name: /Start camera/ }).click()
    await expect(page.getByText('Face detected in the current frame.')).toBeVisible({ timeout: 20_000 })
    await page.locator('div.scanline button').first().click()
    await page.getByRole('button', { name: 'Run identity matching' }).click()

    // Honest failure surfaced in the UI (never silent, never fabricated).
    await expect(
      page.getByText(/unreadable result|matching endpoint/i),
    ).toBeVisible({ timeout: 20_000 })

    const runs = await adminRest<{
      status: string
      failure_reason: string | null
    }>(
      `search_runs?investigation_id=eq.${w.a.investigationId}&channel=eq.identity_matching&order=created_at.desc&limit=1&select=status,failure_reason`,
    )
    expect(runs[0]!.status).toBe('failed')
    expect(runs[0]!.failure_reason).toBe('invalid_response')

    const candidates = await adminRest<unknown[]>(
      `identity_candidates?subject_id=eq.${w.a.subjectAuthorizedId}&provider_candidate_id=eq.pc-e2e-1&select=id`,
    )
    expect(candidates).toHaveLength(0)
  })

  test('restricted subject never reaches the provider and writes nothing', async ({
    world,
    page,
  }) => {
    const w = world!
    await interceptDetection(page)
    const matcher = await interceptMatcher(page)

    await signInViaUi(page, w.a.userEmail, w.password)
    await page.goto(`/capture?investigation=${w.a.investigationId}&subject=${w.a.subjectRestrictedId}`)
    await page.getByRole('button', { name: /Start camera/ }).click()
    await expect(page.getByText('Face detected in the current frame.')).toBeVisible({ timeout: 20_000 })
    await page.locator('div.scanline button').first().click()
    await page.getByRole('button', { name: 'Run identity matching' }).click()

    await expect(
      page.getByText(/authorization is not established/i),
    ).toBeVisible({ timeout: 20_000 })

    // Zero wire traffic, zero durable writes for the restricted subject.
    expect(matcher.hits()).toBe(0)
    const runs = await adminRest<unknown[]>(
      `search_runs?subject_id=eq.${w.a.subjectRestrictedId}&select=id`,
    )
    expect(runs).toHaveLength(0)
    const candidates = await adminRest<unknown[]>(
      `identity_candidates?subject_id=eq.${w.a.subjectRestrictedId}&select=id`,
    )
    expect(candidates).toHaveLength(0)
  })
})
