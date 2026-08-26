import type { z } from 'zod'
import { AtlasServiceError, toAtlasServiceError } from '../errors'

/** Validate data crossing a service boundary; throw `validation_failed` otherwise. */
export function parseOrThrow<S extends z.ZodTypeAny>(
  service: string,
  schema: S,
  data: unknown,
): z.infer<S> {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new AtlasServiceError(service, 'validation_failed', result.error.issues)
  }
  return result.data
}

/** Map provider/database errors into the Atlas taxonomy. */
export function mapProviderError(service: string, error: unknown): AtlasServiceError {
  if (error !== null && typeof error === 'object') {
    const e = error as { code?: string; message?: string; status?: number }

    // PostgREST / database errors
    if (e.code === 'PGRST116') {
      return new AtlasServiceError(service, 'not_found')
    }
    if (e.code === 'PGRST205') {
      return new AtlasServiceError(service, 'schema_not_ready', e.message)
    }
    if (e.code === '42501') {
      return new AtlasServiceError(service, 'authorization_required', e.message)
    }

    // GoTrue / Supabase Auth error codes
    // Real @supabase/auth-js ErrorCode values: 'email_exists', 'user_already_exists',
    // 'signup_disabled', 'email_provider_disabled', 'provider_disabled',
    // 'email_not_confirmed', 'invalid_credentials', 'weak_password', 'email_address_invalid'
    if (e.code === 'email_exists' || e.code === 'user_already_exists') {
      return new AtlasServiceError(service, 'email_already_registered', e.message)
    }
    if (e.code === 'signup_disabled' || e.code === 'email_provider_disabled' || e.code === 'provider_disabled') {
      return new AtlasServiceError(service, 'auth_provider_disabled', e.message)
    }
    if (e.code === 'email_not_confirmed') {
      return new AtlasServiceError(service, 'email_confirmation_required', e.message)
    }
    if (e.code === 'invalid_credentials' || e.code === 'invalid_grant') {
      return new AtlasServiceError(service, 'invalid_credentials', e.message)
    }
    if (e.code === 'weak_password') {
      return new AtlasServiceError(service, 'weak_password', e.message)
    }
    if (e.code === 'email_address_invalid') {
      return new AtlasServiceError(service, 'validation_failed', e.message)
    }

    // GoTrue HTTP status codes (some errors have no code, only status)
    if (e.status === 401) {
      return new AtlasServiceError(service, 'invalid_credentials', e.message)
    }
  }

  return toAtlasServiceError(service, error)
}
