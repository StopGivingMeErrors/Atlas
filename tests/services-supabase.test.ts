import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const hoisted = vi.hoisted(() => ({ stub: null as unknown }))

vi.mock('../src/services/supabase/client', async () => {
  const { ProviderNotConfiguredError } = await import('../src/services/errors')
  return {
    getSupabaseClient: () => hoisted.stub,
    requireSupabaseClient: (service: string) => {
      if (hoisted.stub === null) throw new ProviderNotConfiguredError(service)
      return hoisted.stub as SupabaseClient
    },
  }
})

import { createStubClient, type StubResponse } from './helpers/stubClient'
import { SupabaseIdentityResolutionService } from '../src/services/supabase/identityResolution'
import { SupabasePublicInformationService } from '../src/services/supabase/publicInformation'
import { SupabaseSourceService } from '../src/services/supabase/sources'
import { SupabaseInvestigationService } from '../src/services/supabase/investigations'
import {
  AtlasServiceError,
  AuthorizationRequiredError,
} from '../src/services/errors'
import { mapProviderError } from '../src/services/supabase/rows'

const UUID_A = '550e8400-e29b-41d4-a716-446655440001'

function useStub(expectations: Record<string, StubResponse[]>) {
  const stub = createStubClient(expectations)
  hoisted.stub = stub.client
  return stub
}

beforeEach(() => {
  hoisted.stub = null
})

describe('SupabaseIdentityResolutionService', () => {
  it('blocks resolution for subjects that are not authorized', async () => {
    const { calls } = useStub({
      // First response feeds the subject lookup; the candidates query would be second.
      subjects: [
        { data: { id: UUID_A, authorization_state: 'undeclared' }, error: null },
      ],
    })

    const service = new SupabaseIdentityResolutionService()
    await expect(service.findCandidates({ subjectId: UUID_A })).rejects.toThrowError(
      AuthorizationRequiredError,
    )
    // Only the subject gate was consulted — no candidate rows were read.
    expect(calls.filter((c) => c.table === 'identity_candidates')).toHaveLength(0)
  })

  it('blocks revoked subjects too', async () => {
    useStub({
      subjects: [{ data: { id: UUID_A, authorization_state: 'revoked' }, error: null }],
    })
    const service = new SupabaseIdentityResolutionService()
    await expect(service.findCandidates({ subjectId: UUID_A })).rejects.toMatchObject({
      code: 'authorization_required',
    })
  })

  it('returns validated candidates for authorized subjects', async () => {
    useStub({
      subjects: [{ data: { id: UUID_A, authorization_state: 'authorized' }, error: null }],
      identity_candidates: [
        {
          data: [
            {
              id: '550e8400-e29b-41d4-a716-446655440010',
              subject_id: UUID_A,
              provider: 'authorized_directory',
              external_reference: 'ref-1',
              display_name: 'Jordan Ellis',
              match_confidence: '0.87',
              match_status: 'pending',
              metadata: { signals: ['name_exact'] },
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          error: null,
        },
      ],
    })
    const service = new SupabaseIdentityResolutionService()
    const candidates = await service.findCandidates({ subjectId: UUID_A })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].displayName).toBe('Jordan Ellis')
    expect(candidates[0].matchConfidence).toBeCloseTo(0.87)
    expect(candidates[0].signals).toEqual(['name_exact'])
  })
})

describe('SupabasePublicInformationService', () => {
  const profileRow = {
    id: '550e8400-e29b-41d4-a716-446655440020',
    subject_id: UUID_A,
    canonical_name: 'Jordan Ellis',
    summary: 'Analyst of record',
    identity_state: 'confirmed',
    confidence_score: '0.82',
    last_resolved_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    subjects: { authorization_state: 'authorized' },
  }

  it('surfaces not_found for missing profiles', async () => {
    useStub({ intelligence_profiles: [{ data: null, error: null }] })
    const service = new SupabasePublicInformationService()
    await expect(
      service.getProfile({ profileId: '550e8400-e29b-41d4-a716-446655440099' }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('enforces the authorization gate on restricted subjects', async () => {
    useStub({
      intelligence_profiles: [
        { data: { ...profileRow, subjects: { authorization_state: 'restricted' } }, error: null },
      ],
    })
    const service = new SupabasePublicInformationService()
    await expect(service.getProfile({ profileId: profileRow.id })).rejects.toThrowError(
      AuthorizationRequiredError,
    )
  })

  it('maps profiles with derived presentation fields for authorized subjects', async () => {
    useStub({ intelligence_profiles: [{ data: profileRow, error: null }] })
    const service = new SupabasePublicInformationService()
    const profile = await service.getProfile({ profileId: profileRow.id })
    expect(profile.canonicalName).toBe('Jordan Ellis')
    expect(profile.initials.length).toBeGreaterThan(0)
    expect(profile.avatarColor).toMatch(/^#/)
  })
})

describe('transport failure mapping', () => {
  it('maps provider errors to provider_failure AtlasServiceErrors', async () => {
    useStub({
      sources: [{ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }],
    })
    const service = new SupabaseSourceService()
    try {
      await service.listSources({ limit: 10 })
      expect.unreachable('expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(AtlasServiceError)
      expect((error as AtlasServiceError).code).toBe('provider_failure')
    }
  })

  it('fails with provider_not_configured when no client exists (production without backend)', async () => {
    hoisted.stub = null
    const service = new SupabaseInvestigationService()
    try {
      await service.listInvestigations()
      expect.unreachable('expected rejection')
    } catch (error) {
      expect((error as AtlasServiceError).code).toBe('provider_not_configured')
      expect((error as AtlasServiceError).displayMessage).toBe('Provider not configured.')
    }
  })
})

describe('mapProviderError', () => {
  it('maps PostgREST not-found to not_found', () => {
    const err = mapProviderError('Auth', { code: 'PGRST116', message: 'Row not found' })
    expect(err.code).toBe('not_found')
  })

  it('maps PostgREST unauthorized to authorization_required', () => {
    const err = mapProviderError('Auth', { code: '42501', message: 'insufficient privilege' })
    expect(err.code).toBe('authorization_required')
  })

  it('maps PostgREST PGRST205 (schema not cached) to schema_not_ready', () => {
    const err = mapProviderError('Auth', {
      code: 'PGRST205',
      message: "Could not find the table 'public.users' in the schema cache",
    })
    expect(err.code).toBe('schema_not_ready')
    expect(err.displayMessage).toContain('schema')
  })

  it('maps GoTrue email_exists to email_already_registered', () => {
    const err = mapProviderError('Auth', { code: 'email_exists', message: 'already registered' })
    expect(err.code).toBe('email_already_registered')
    expect(err.displayMessage).toContain('already exists')
  })

  it('maps GoTrue user_already_exists to email_already_registered', () => {
    const err = mapProviderError('Auth', { code: 'user_already_exists', message: 'user exists' })
    expect(err.code).toBe('email_already_registered')
  })

  it('maps GoTrue signup_disabled to auth_provider_disabled', () => {
    const err = mapProviderError('Auth', { code: 'signup_disabled', message: 'signup disabled' })
    expect(err.code).toBe('auth_provider_disabled')
    expect(err.displayMessage).toContain('not enabled')
  })

  it('maps GoTrue email_provider_disabled to auth_provider_disabled', () => {
    const err = mapProviderError('Auth', { code: 'email_provider_disabled', message: 'email provider disabled' })
    expect(err.code).toBe('auth_provider_disabled')
  })

  it('maps GoTrue provider_disabled to auth_provider_disabled', () => {
    const err = mapProviderError('Auth', { code: 'provider_disabled', message: 'provider disabled' })
    expect(err.code).toBe('auth_provider_disabled')
  })

  it('maps GoTrue email_not_confirmed to email_confirmation_required', () => {
    const err = mapProviderError('Auth', { code: 'email_not_confirmed', message: 'confirm email' })
    expect(err.code).toBe('email_confirmation_required')
    expect(err.displayMessage).toContain('confirm your email')
  })

  it('maps GoTrue invalid_credentials to invalid_credentials', () => {
    const err = mapProviderError('Auth', { code: 'invalid_credentials', message: 'bad login' })
    expect(err.code).toBe('invalid_credentials')
    expect(err.displayMessage).toContain('Invalid email or password')
  })

  it('maps GoTrue weak_password to weak_password', () => {
    const err = mapProviderError('Auth', { code: 'weak_password', message: 'too short' })
    expect(err.code).toBe('weak_password')
  })

  it('falls through to provider_failure for unknown error shapes', () => {
    const err = mapProviderError('Auth', new Error('something broke'))
    expect(err.code).toBe('provider_failure')
  })

  it('maps GoTrue 401 status (no code) to invalid_credentials', () => {
    // GoTrue returns {message, status: 401, code: undefined} for Invalid API key
    const err = mapProviderError('Auth', { message: 'Invalid API key', status: 401 })
    expect(err.code).toBe('invalid_credentials')
    expect(err.displayMessage).toContain('Invalid email or password')
  })
})
