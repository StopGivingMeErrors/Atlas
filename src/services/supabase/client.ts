import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { atlasConfig, hasRealBackend } from '../../config/env'
import { ProviderNotConfiguredError } from '../errors'

/**
 * Shared Supabase client for the real application API. Created lazily on
 * first use; returns null when the application API is not configured.
 */
let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient | null {
  if (!hasRealBackend(atlasConfig)) {
    return null
  }
  if (client === null) {
    // Non-null assertions are guarded by hasRealBackend above.
    client = createClient(
      atlasConfig.supabaseUrl as string,
      atlasConfig.supabaseAnonKey as string,
      { auth: { persistSession: true, autoRefreshToken: true } },
    )
  }
  return client
}

export function requireSupabaseClient(service: string): SupabaseClient {
  const existing = getSupabaseClient()
  if (existing === null) {
    throw new ProviderNotConfiguredError(service)
  }
  return existing
}
