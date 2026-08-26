/**
 * Real-UI helpers: everything below drives the actual app (Vite build,
 * AuthContext, React Router) exactly as a user would - no state injection.
 */
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function signInViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/investigations', { timeout: 20_000 })
}

/** Asserts the protected route redirected the unauthenticated visitor. */
export async function expectRedirectedToSignIn(page: Page): Promise<void> {
  await page.goto('/investigations')
  await expect(page).toHaveURL(/\/signin$/)
}

export async function signOutViaUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL(/\/signin$/, { timeout: 15_000 })
}
