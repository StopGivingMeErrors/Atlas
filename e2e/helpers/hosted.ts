/**
 * Shared hosted-E2E helpers: skip logic, browser-side Supabase client
 * injection, and the runner-only admin (service-role) API.
 *
 * SECURITY INVARIANT: the service-role key NEVER crosses into the browser.
 * It is used exclusively inside this Node test-runner process against the
 * GoTrue admin API and PostgREST, for seeding and cleanup only.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { loadHostedState, type HostedState } from '../global-setup'

const here = path.dirname(fileURLToPath(import.meta.url))

let cachedState: HostedState | null = null

export function state(): HostedState {
  if (cachedState === null) cachedState = loadHostedState()
  return cachedState
}

/** Skips the current suite unless the given hosted tier is available. */
export async function requireMode(
  modes: HostedState['mode'][],
  extraCondition?: () => boolean | Promise<boolean>,
  extraReason?: string,
): Promise<HostedState> {
  const s = state()
  const skip =
    !modes.includes(s.mode) || (extraCondition !== undefined && !(await extraCondition()))
  const reason =
    s.reason ||
    (extraReason ?? `requires hosted mode ${modes.join('|')} (current: ${s.mode})`)
  test.skip(skip, reason)
  return s
}

// test is imported lazily to keep this helper usable from global setup too.
import { test } from '@playwright/test'

export const BUCKET_NAME = 'media-assets'

/** Project ref from a Supabase URL — also the localStorage session key suffix. */
export function projectRef(url: string): string {
  return new URL(url).hostname.split('.')[0]
}

/**
 * Injects the official supabase-js UMD bundle into the page and creates a
 * client with the PUBLIC anon credentials. The client picks up the signed-in
 * user's real GoTrue JWT from localStorage (same project ref), so every call
 * travels: browser -> supabase-js -> PostgREST/Storage -> RLS.
 */
export async function pageSupabase(page: Page) {
  const s = state()
  expect(s.url, 'hosted url required').toBeTruthy()
  await page.addScriptTag({
    path: path.resolve(here, '..', '..', 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'),
  })
  return {
    url: s.url as string,
    anonKey: s.anonKey as string,
    /** Runs an operation with a fresh in-page supabase-js client. */
    run<T>(operation: string, fnBody: string): Promise<T> {
      return page.evaluate<{ url: string; key: string; op: string; body: string }, T>(
        ({ url, key, op, body }) => {
          const client = window.supabase.createClient(url, key)
          // eslint-disable-next-line no-new-func
          const fn = new Function('client', `return (${body})(client)`)
          return Promise.resolve(fn(client)).catch((error) => {
            throw new Error(`[${op}] ${error instanceof Error ? error.message : String(error)}`)
          })
        },
        { url: s.url as string, key: s.anonKey as string, op: operation, body: fnBody },
      )
    },
  }
}

/* ------------------------------------------------------------------ */
/* Runner-only admin API (service role). Never expose to the browser.  */
/* ------------------------------------------------------------------ */

function requireServiceRole(): { url: string; key: string } {
  const s = state()
  if (s.url === null || s.serviceRoleKey === null) {
    throw new Error('service-role credentials required for this operation')
  }
  return { url: s.url, key: s.serviceRoleKey }
}

export interface RestError {
  message: string
  code?: string
  details?: unknown
  hint?: string
}

/** PostgREST call with elevated rights. Returns parsed JSON or throws RestError-shaped payload. */
export async function adminRest<T>(
  tablePath: string,
  options: { method?: string; body?: unknown; prefer?: string; query?: Record<string, string> } = {},
): Promise<T[]> {
  const { url, key } = requireServiceRole()
  const search = new URLSearchParams(options.query ?? {}).toString()
  const response = await fetch(`${url}/rest/v1/${tablePath}${search ? `?${search}` : ''}`, {
    method: options.method ?? 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.prefer !== undefined ? { Prefer: options.prefer } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  const json = text === '' ? [] : (JSON.parse(text) as unknown)
  if (!response.ok) {
    const err = (Array.isArray(json) ? json[0] : json) as RestError
    throw Object.assign(new Error(`admin REST ${options.method ?? 'GET'} ${tablePath} failed: HTTP ${response.status} ${err?.message ?? text}`), {
      status: response.status,
      rest: err,
    })
  }
  return json as T[]
}

/** GoTrue admin: create a confirmed user; returns the auth uid. */
export async function adminCreateUser(email: string, password: string): Promise<string> {
  const { url, key } = requireServiceRole()
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const json = (await response.json()) as { id?: string; msg?: string; error_description?: string }
  if (!response.ok || json.id === undefined) {
    throw new Error(`GoTrue admin createUser failed: HTTP ${response.status} ${json.msg ?? json.error_description ?? ''}`)
  }
  return json.id
}

export async function adminDeleteUser(userId: string): Promise<void> {
  const { url, key } = requireServiceRole()
  const response = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`GoTrue admin deleteUser failed: HTTP ${response.status}`)
  }
}

/** Storage delete via admin (service-role JWT) — storage API path. */
export async function adminDeleteObjects(prefixes: string[]): Promise<void> {
  if (prefixes.length === 0) return
  const { url, key } = requireServiceRole()
  const response = await fetch(`${url}/storage/v1/object/${BUCKET_NAME}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes }),
  })
  // 404 when bucket missing — nothing to clean.
  if (!response.ok && response.status !== 404) {
    throw new Error(`storage cleanup failed: HTTP ${response.status}`)
  }
}

/** Lists object names under a prefix via admin (for cleanup manifests). */
export async function adminListObjects(prefix: string): Promise<string[]> {
  const { url, key } = requireServiceRole()
  const response = await fetch(`${url}/storage/v1/object/list/${BUCKET_NAME}?prefix=${encodeURIComponent(prefix)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!response.ok) return []
  const rows = (await response.json()) as Array<{ name?: string }>
  return rows.map((r) => r.name).filter((n): n is string => typeof n === 'string')
}
