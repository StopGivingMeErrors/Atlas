/**
 * Hosted workflow E2E: signed-in analyst navigates the real app against the
 * real backend (GoTrue session -> Atlas services -> PostgREST).
 * Runs in anon-signup | seeded modes; page shells render regardless of data.
 */
import { expect, test } from './fixtures'
import { state } from './helpers/hosted'
import { signInViaUi } from './helpers/ui'

const NAV_ROUTES: Array<{ label: string; path: RegExp }> = [
  { label: 'Capture', path: /\/capture$/ },
  { label: 'People', path: /\/people$/ },
  { label: 'Sources', path: /\/sources$/ },
  { label: 'Search', path: /\/search$/ },
  { label: 'Activity', path: /\/activity$/ },
  { label: 'Settings', path: /\/settings$/ },
]

test.describe('hosted workflow', () => {
  test.beforeEach(async () => {
    const s = state()
    test.skip(
      s.mode !== 'anon-signup' && s.mode !== 'seeded',
      s.reason || 'requires a reachable hosted project with credentials',
    )
  })

  test('login lands on Investigations and every primary view renders against the live backend', async ({ world, page }) => {
    // In seeded mode use the real analyst identity; otherwise the suite is
    // limited to route rendering with whatever local session exists.
    if (world !== null) {
      await signInViaUi(page, world.a.userEmail, world.password)
    }
    await expect(page).toHaveURL(/\/investigations$/)
    await expect(page.getByRole('heading')).toBeVisible()

    for (const { label, path } of NAV_ROUTES) {
      await page.getByRole('link', { name: label }).first().click()
      await expect(page).toHaveURL(path)
      // The view must render its shell without crashing the app boundary.
      await expect(page.locator('body')).not.toContainText('Application error')
    }

    // Settings shows the authenticated account when an identity exists.
    if (world !== null) {
      await expect(page.getByText(world.a.userEmail).first()).toBeVisible()
    }
  })

  test('investigations view reflects seeded org data in seeded mode', async ({ world, page }) => {
    test.skip(world === null, 'requires seeded mode')
    const w = world!
    await signInViaUi(page, w.a.userEmail, w.password)

    // Org A's investigation title is visible to org A's analyst.
    await expect(
      page.getByText(`Atlas E2E investigation a`, { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 })

    // And nothing from org B leaks into the list view.
    const body = await page.locator('body').innerText()
    expect(body).not.toContain('Org B')
    expect(body).not.toContain(w.b.investigationId)
  })
})
