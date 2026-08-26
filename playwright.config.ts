/**
 * Hosted Supabase E2E configuration.
 *
 * Credentials are read EXCLUSIVELY from environment variables and are never
 * hard-coded. Only the PUBLIC anon credentials are ever handed to the browser
 * (via the Vite dev server env); the optional service-role key is used solely
 * inside the test runner process for seeding/cleanup.
 *
 *   ATLAS_E2E_SUPABASE_URL          public project URL (browser-visible)
 *   ATLAS_E2E_SUPABASE_ANON_KEY     public anon key      (browser-visible)
 *   ATLAS_E2E_PASSWORD              shared password for seeded test identities (runner-only)
 *   ATLAS_E2E_SERVICE_ROLE_KEY      service-role JWT     (runner-only, NEVER in the browser)
 *   ATLAS_E2E_ACCESS_TOKEN          Supabase management API token (runner-only, migrations)
 *   ATLAS_E2E_ALLOW_MIGRATIONS      must be "true" to let the runner apply migrations
 *
 * Without URL+ANON_KEY every suite skips with HOSTED_SUPABASE_NOT_CONFIGURED.
 */
import { defineConfig } from '@playwright/test'

const PORT = 4173

function publicBrowserEnv(): Record<string, string> {
  const url = process.env.ATLAS_E2E_SUPABASE_URL ?? ''
  const anonKey = process.env.ATLAS_E2E_SUPABASE_ANON_KEY ?? ''
  // ONLY public credentials may flow into the browser process. The
  // service-role key is deliberately absent here — its presence in this
  // object would be a security bug.
  const env: Record<string, string> = {}
  if (url !== '') env.VITE_SUPABASE_URL = url
  if (anonKey !== '') env.VITE_SUPABASE_ANON_KEY = anonKey
  // Optional deterministic face-detection endpoint for the local-provider
  // E2E suite; the test intercepts it with page.route, so no real network
  // call ever leaves the machine.
  const detectionUrl =
    process.env.ATLAS_E2E_FACE_DETECTION_URL || 'https://atlas-e2e-detect.invalid/v1/detect'
  if (detectionUrl !== '') env.VITE_ATLAS_FACE_DETECTION_ENDPOINT = detectionUrl
  return env
}

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
    // Fake webcam: the Capture page's live-video pipeline (canvas frames ->
    // detection loop -> matching) runs against a deterministic stream.
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: publicBrowserEnv(),
  },
})
