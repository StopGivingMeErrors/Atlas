/**
 * Hosted Supabase E2E state resolution.
 *
 * Runs once before all tests. Determines whether hosted verification can
 * execute at all, and at which tier:
 *
 *   unconfigured  — no credentials provided        -> everything skips (HOSTED_SUPABASE_NOT_CONFIGURED)
 *   unreachable   — URL given but project dead     -> skips with the exact network failure
 *   anon-signup   — public creds only              -> auth + workflow suites; seeding-dependent suites skip
 *   seeded        — service-role also available    -> full RLS / cross-org / storage / cleanup coverage
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupStaleManifest } from './helpers/seed'

const here = path.dirname(fileURLToPath(import.meta.url))

export type HostedMode = 'unconfigured' | 'unreachable' | 'anon-signup' | 'seeded'

export interface HostedState {
  mode: HostedMode
  /** Human-readable reason when a suite has to skip. */
  reason: string
  url: string | null
  anonKey: string | null
  password: string | null
  serviceRoleKey: string | null
}

const STATE_FILE = path.resolve(here, '.hosted-state.json')

export function loadHostedState(): HostedState {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as HostedState
}

async function probeReachable(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${url}/auth/v1/health`, { signal: controller.signal })
    if (!response.ok) return `GoTrue health returned HTTP ${response.status}`
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const cause = (error as { cause?: { code?: string } }).cause?.code
    return cause !== undefined ? `${message} (${cause})` : message
  } finally {
    clearTimeout(timer)
  }
}

export async function runGlobalSetup(): Promise<void> {
  const url = process.env.ATLAS_E2E_SUPABASE_URL?.trim() || null
  const anonKey = process.env.ATLAS_E2E_SUPABASE_ANON_KEY?.trim() || null
  const password = process.env.ATLAS_E2E_PASSWORD?.trim() || null
  const serviceRoleKey = process.env.ATLAS_E2E_SERVICE_ROLE_KEY?.trim() || null

  let state: HostedState

  if (url === null || anonKey === null) {
    state = {
      mode: 'unconfigured',
      reason:
        'HOSTED_SUPABASE_NOT_CONFIGURED — set ATLAS_E2E_SUPABASE_URL and ATLAS_E2E_SUPABASE_ANON_KEY to run hosted verification.',
      url: null,
      anonKey: null,
      password,
      serviceRoleKey: null,
    }
  } else {
    const failure = await probeReachable(url)
    if (failure !== null) {
      state = {
        mode: 'unreachable',
        reason: `HOSTED_SUPABASE_UNREACHABLE — ${url}: ${failure}`,
        url,
        anonKey,
        password,
        serviceRoleKey,
      }
    } else if (password === null) {
      state = {
        mode: 'anon-signup',
        reason: 'ATLAS_E2E_PASSWORD not set — seeded-identity suites skipped.',
        url,
        anonKey,
        password: null,
        serviceRoleKey,
      }
    } else {
      state = { mode: serviceRoleKey === null ? 'anon-signup' : 'seeded', reason: '', url, anonKey, password, serviceRoleKey }
      if (serviceRoleKey === null) {
        state.reason = 'ATLAS_E2E_SERVICE_ROLE_KEY not set — seeding/cleanup suites skipped (auth-only coverage).'
      }
    }
  }

  // Never persist secrets beyond this runner's own directory; the state file
  // is gitignored and contains exactly what the specs need.
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

  if (state.mode === 'seeded') await cleanupStaleManifest()

  const label =
    state.mode === 'seeded'
      ? `seeded (${state.url})`
      : state.mode === 'anon-signup'
        ? `anon-signup (${state.url})`
        : state.mode === 'unreachable'
          ? `unreachable — ${state.reason}`
          : 'unconfigured'
  console.log(`\n[atlas-e2e] hosted mode: ${label}\n`)
}

export default runGlobalSetup
