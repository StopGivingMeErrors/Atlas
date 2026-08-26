import { describe, expect, it } from 'vitest'
import {
  AtlasServiceError,
  AuthorizationRequiredError,
  ProviderNotConfiguredError,
  toAtlasServiceError,
} from '../src/services/errors'

describe('AtlasServiceError taxonomy', () => {
  it('exposes stable user-facing display messages', () => {
    expect(new AtlasServiceError('X', 'provider_not_configured').displayMessage).toBe(
      'Provider not configured.',
    )
    expect(new AtlasServiceError('X', 'authorization_required').displayMessage).toContain(
      'authorization',
    )
  })

  it('preserves service and code for programmatic handling', () => {
    const error = new AtlasServiceError('IdentityResolution', 'not_found')
    expect(error.service).toBe('IdentityResolution')
    expect(error.code).toBe('not_found')
    expect(error.name).toBe('AtlasServiceError')
  })

  it('ProviderNotConfiguredError is an AtlasServiceError with the right code', () => {
    const error = new ProviderNotConfiguredError('FaceDetection')
    expect(error).toBeInstanceOf(AtlasServiceError)
    expect(error.code).toBe('provider_not_configured')
    expect(error.displayMessage).toBe('Provider not configured.')
  })

  it('AuthorizationRequiredError carries subject context', () => {
    const error = new AuthorizationRequiredError('IdentityResolution', 'subj-1', 'undeclared')
    expect(error.code).toBe('authorization_required')
    expect(error.details).toEqual({ subjectId: 'subj-1', state: 'undeclared' })
  })

  it('toAtlasServiceError wraps unknown failures as provider_failure', () => {
    const wrapped = toAtlasServiceError('Sources', new Error('boom'))
    expect(wrapped.code).toBe('provider_failure')

    const network = toAtlasServiceError('Sources', new Error('fetch failed: network down'))
    expect(network.code).toBe('network')

    const passthrough = toAtlasServiceError(
      'Sources',
      new AtlasServiceError('Sources', 'conflict'),
    )
    expect(passthrough.code).toBe('conflict')
  })

  it('distinguishes unreachable Supabase from generic network errors', () => {
    const unreachable = toAtlasServiceError(
      'Auth',
      new Error('request to https://dead.supabase.co failed, getaddrinfo ENOTFOUND dead.supabase.co'),
    )
    expect(unreachable.code).toBe('supabase_unreachable')
    expect(unreachable.displayMessage).toContain('reach the Supabase project')

    const connectionRefused = toAtlasServiceError(
      'Auth',
      new Error('connect ECONNREFUSED 127.0.0.1:54321'),
    )
    expect(connectionRefused.code).toBe('supabase_unreachable')

    const genericNetwork = toAtlasServiceError(
      'Auth',
      new Error('fetch failed: network down'),
    )
    expect(genericNetwork.code).toBe('network')
  })

  it('auth-specific error codes have distinct display messages', () => {
    expect(new AtlasServiceError('Auth', 'supabase_unreachable').displayMessage).toContain(
      'reach the Supabase project',
    )
    expect(new AtlasServiceError('Auth', 'schema_not_ready').displayMessage).toContain('schema')
    expect(new AtlasServiceError('Auth', 'auth_provider_disabled').displayMessage).toContain(
      'not enabled',
    )
    expect(new AtlasServiceError('Auth', 'email_already_registered').displayMessage).toContain(
      'already exists',
    )
    expect(new AtlasServiceError('Auth', 'email_confirmation_required').displayMessage).toContain(
      'confirm your email',
    )
    expect(new AtlasServiceError('Auth', 'invalid_credentials').displayMessage).toContain(
      'Invalid email or password',
    )
    expect(new AtlasServiceError('Auth', 'weak_password').displayMessage).toContain(
      'Password does not meet',
    )
  })
})
