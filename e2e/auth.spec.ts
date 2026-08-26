/**
 * Hosted authentication E2E: real GoTrue through the real UI.
 *
 * Route protection and form rendering run in ANY hosted mode (no identity
 * required). Credential-dependent tests run whenever public credentials
 * exist. The full seeded-identity lifecycle runs only in seeded mode, where
 * the service role guarantees complete cleanup of created identities.
 */
import { expect, test, requireWorld } from './fixtures'
import { pageSupabase, state } from './helpers/hosted'
import { adminDeleteUser } from './helpers/hosted'
import { expectRedirectedToSignIn, signInViaUi, signOutViaUi } from './helpers/ui'

test.describe('hosted auth', () => {
  test('unauthenticated visit to a protected route redirects to /signin', async ({ page }) => {
    await expectRedirectedToSignIn(page)
    await expect(page.locator('#password')).toBeVisible()
  })

  test('sign-in form renders email/password fields and submit control', async ({ page }) => {
    await page.goto('/signin')
    await expect(page.locator('#email')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test.describe('with credentials', () => {
    test.beforeEach(async () => {
      const s = state()
      test.skip(
        s.mode === 'unconfigured',
        s.reason || 'HOSTED_SUPABASE_NOT_CONFIGURED',
      )
      test.skip(
        s.mode === 'unreachable',
        s.reason || 'hosted project unreachable',
      )
      if (s.mode !== 'unconfigured') {
        // The app must have been served with the public creds baked in.
        expect(s.url, 'ATLAS_E2E_SUPABASE_URL').toBeTruthy()
        expect(s.anonKey, 'ATLAS_E2E_SUPABASE_ANON_KEY').toBeTruthy()
      }
    })

    test('wrong password is rejected and leaves the visitor on /signin', async ({ page }) => {
      const s = state()
      await page.goto('/signin')
      await page.locator('#email').fill(`e2e-probe-${Date.now()}@atlas-e2e.invalid`)
      await page.locator('#password').fill(s.password ?? 'irrelevant')
      await page.getByRole('button', { name: 'Sign in' }).click()
      // GoTrue rejects unknown credentials; the app must stay on /signin.
      await expect(page).toHaveURL(/\/signin$/, { timeout: 15_000 })
      await expect(page.locator('#password')).toBeVisible()
    })

    test('sign-up creates a real GoTrue identity and reports honestly when confirmation gates access', async ({ page }) => {
      const s = state()
      // Without the service role a created identity could not be removed;
      // anon runners must not leak identities into the hosted project.
      test.skip(s.serviceRoleKey === null, 'signup probe requires ATLAS_E2E_SERVICE_ROLE_KEY for cleanup')
      const email = `e2e-signup-${Date.now()}@atlas-e2e.invalid`
      try {
        await page.goto('/signup')
        await page.locator('#fullName').fill('E2E Signup Probe')
        await page.locator('#email').fill(email)
        await page.locator('#password').fill(s.password ?? 'irrelevant-password')
        await page.getByRole('button', { name: /request access|sign up|create/i }).click()

        const confirmedImmediately = await page
          .waitForURL('**/investigations', { timeout: 20_000 })
          .then(() => true)
          .catch(() => false)

        if (!confirmedImmediately) {
          // Honest path: project enforces email confirmation/admin approval.
          await expect(
            page.getByText(/confirm your email/i),
          ).toBeVisible({ timeout: 10_000 })
          await expect(page).toHaveURL(/\/signup$/)
        }
      } finally {
        await adminDeleteUser(await adminLookupId(s.url as string, email))
      }
    })

    test('seeded analyst: UI login -> session survives reload -> JWT reaches PostgREST -> sign-out revokes', async ({ world, page }) => {
      const w = await requireWorld(world)
      await signInViaUi(page, w.a.userEmail, w.password)
      await expect(page).toHaveURL(/\/investigations$/)

      // Session persistence across a full reload (persisted GoTrue session).
      await page.reload()
      await expect(page).toHaveURL(/\/investigations$/)

      // The signed-in user's real GoTrue JWT authorizes reading their own
      // public.users row through supabase-js -> PostgREST -> RLS.
      const sb = await pageSupabase(page)
      const own = await sb.run<Array<{ full_name: string; email: string }>>(
        'read own users row',
        `(client) => client.from('users').select('full_name,email').eq('email', ${JSON.stringify(w.a.userEmail)})`,
      )
      expect(own).toHaveLength(1)
      expect(own[0].full_name).toBe(w.a.fullName)

      await signOutViaUi(page)
      await expectRedirectedToSignIn(page)
    })
  })
})

/** Resolves an auth uid by email via GoTrue admin (service-role only). */
async function adminLookupId(url: string, email: string): Promise<string> {
  const key = process.env.ATLAS_E2E_SERVICE_ROLE_KEY as string
  const response = await fetch(`${url}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const json = (await response.json()) as { users?: Array<{ id: string; email?: string }> }
  const found = json.users?.find((u) => u.email === email)
  if (found === undefined) throw new Error(`signup probe ${email} not found for cleanup`)
  return found.id
}
