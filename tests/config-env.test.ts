import { describe, expect, it } from 'vitest'
import { loadConfig, hasRealBackend } from '../src/config/env'

function env(overrides: Record<string, unknown> = {}) {
  return {
    DEV: true,
    PROD: false,
    ...overrides,
  } as unknown as ImportMetaEnv
}

describe('loadConfig / hasRealBackend', () => {
  it('is unconfigured without backend credentials', () => {
    const config = loadConfig(env())
    expect(hasRealBackend(config)).toBe(false)
    expect(config.demoFixturesAllowed).toBe(false)
  })

  it('recognizes a real backend when URL and key are present', () => {
    const config = loadConfig(
      env({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'key' }),
    )
    expect(hasRealBackend(config)).toBe(true)
    expect(config.demoFixturesAllowed).toBe(false)
  })

  it('rejects non-https remote URLs for the backend', () => {
    const config = loadConfig(
      env({ VITE_SUPABASE_URL: 'http://insecure.example.com', VITE_SUPABASE_ANON_KEY: 'key' }),
    )
    // localhost is the only permitted plain-http origin.
    expect(hasRealBackend(config)).toBe(false)
  })

  it('allows demo fixtures only in development builds', () => {
    const dev = loadConfig(env({ VITE_ATLAS_DEMO_FIXTURES: 'true' }))
    expect(dev.demoFixturesAllowed).toBe(true)

    // A production build refuses demo fixtures even when the flag is set —
    // there is no demo mode in production.
    const prod = loadConfig(env({ VITE_ATLAS_DEMO_FIXTURES: 'true', PROD: true, DEV: false }))
    expect(prod.demoFixturesAllowed).toBe(false)
  })
})

describe('live environment resolution', () => {
  it('hasRealBackend returns true when .env is loaded by Vite', () => {
    const config = loadConfig()
    if (config.supabaseUrl === null || config.supabaseAnonKey === null) {
      // .env file missing or empty — this is a configuration issue, not a code bug.
      // The test documents the expected state: if .env exists and contains valid
      // VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY, hasRealBackend must be true.
      expect(config.supabaseUrl).not.toBeNull()
      expect(config.supabaseAnonKey).not.toBeNull()
    }
    expect(hasRealBackend(config)).toBe(true)
  })

  it('live Supabase URL resolves to an HTTPS endpoint', () => {
    const config = loadConfig()
    expect(config.supabaseUrl).not.toBeNull()
    expect(config.supabaseUrl).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/)
  })

  it('live anon key is a valid JWT shape', () => {
    const config = loadConfig()
    expect(config.supabaseAnonKey).not.toBeNull()
    // Anon keys are JWTs: header.payload.signature (base64url segments)
    const parts = config.supabaseAnonKey!.split('.')
    expect(parts).toHaveLength(3)
  })
})
