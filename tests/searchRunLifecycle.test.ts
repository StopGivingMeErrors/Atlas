import { describe, expect, it } from 'vitest'
import {
  TERMINAL_SEARCH_RUN_STATUSES,
  assertSearchRunTransition,
  isTerminalSearchRunStatus,
  isValidSearchRunTransition,
} from '../src/services/searchRuns'
import { updateSearchRunStatusInputSchema } from '../src/services/schemas'
import { AtlasServiceError } from '../src/services/errors'

const ALL: Array<'queued' | 'running' | 'completed' | 'failed' | 'no_results'> = [
  'queued',
  'running',
  'completed',
  'failed',
  'no_results',
]

const RUN_ID = '550e8400-e29b-41d4-a716-446655440001'

describe('search-run lifecycle state machine', () => {
  it('allows the happy path queued → running → completed', () => {
    expect(isValidSearchRunTransition('queued', 'running')).toBe(true)
    expect(isValidSearchRunTransition('running', 'completed')).toBe(true)
  })

  it('allows a run that found nothing to land on no_results', () => {
    expect(isValidSearchRunTransition('running', 'no_results')).toBe(true)
    // NO_RESULTS is its own successful outcome, distinct from FAILED.
    expect(isTerminalSearchRunStatus('no_results')).toBe(true)
    expect(isTerminalSearchRunStatus('completed')).toBe(true)
  })

  it('allows failure from queued (never started) and running', () => {
    expect(isValidSearchRunTransition('queued', 'failed')).toBe(true)
    expect(isValidSearchRunTransition('running', 'failed')).toBe(true)
  })

  it('forbids skipping the running state on success paths', () => {
    expect(isValidSearchRunTransition('queued', 'completed')).toBe(false)
    expect(isValidSearchRunTransition('queued', 'no_results')).toBe(false)
  })

  it('terminal states are terminal', () => {
    for (const terminal of TERMINAL_SEARCH_RUN_STATUSES) {
      for (const next of ALL) {
        expect(isValidSearchRunTransition(terminal, next)).toBe(false)
      }
    }
  })

  it('rejects self-transitions and backwards transitions', () => {
    expect(isValidSearchRunTransition('running', 'running')).toBe(false)
    expect(isValidSearchRunTransition('running', 'queued')).toBe(false)
    expect(isValidSearchRunTransition('completed', 'no_results')).toBe(false)
  })

  it('assertSearchRunTransition throws a typed conflict error with details', () => {
    try {
      assertSearchRunTransition('completed', 'running')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(AtlasServiceError)
      const atlasError = error as AtlasServiceError
      expect(atlasError.code).toBe('conflict')
      expect(atlasError.details).toMatchObject({ from: 'completed', to: 'running' })
    }
  })
})

describe('update search-run status input schema', () => {
  const base = { searchRunId: RUN_ID }

  it('a failed run requires a structured failureReason', () => {
    expect(
      updateSearchRunStatusInputSchema.safeParse({ ...base, status: 'failed' }).success,
    ).toBe(false)
    expect(
      updateSearchRunStatusInputSchema.safeParse({
        ...base,
        status: 'failed',
        failureReason: 'timeout',
      }).success,
    ).toBe(true)
    expect(
      updateSearchRunStatusInputSchema.safeParse({
        ...base,
        status: 'failed',
        failureReason: 'not_a_reason',
      }).success,
    ).toBe(false)
  })

  it('accepts every structured failure reason', () => {
    for (const reason of [
      'timeout',
      'rate_limited',
      'auth_failed',
      'provider_error',
      'invalid_response',
      'network',
    ] as const) {
      expect(
        updateSearchRunStatusInputSchema.safeParse({
          ...base,
          status: 'failed',
          failureReason: reason,
        }).success,
      ).toBe(true)
    }
  })

  it('accepts non-failed outcomes without failure details', () => {
    expect(updateSearchRunStatusInputSchema.safeParse({ ...base, status: 'no_results' }).success).toBe(
      true,
    )
    expect(updateSearchRunStatusInputSchema.safeParse({ ...base, status: 'completed' }).success).toBe(
      true,
    )
    expect(updateSearchRunStatusInputSchema.safeParse({ ...base, status: 'running' }).success).toBe(
      true,
    )
  })

  it('rejects statuses outside the lifecycle enum', () => {
    // PROVIDER_NOT_CONFIGURED is never a run state; neither is 'pending'.
    expect(
      updateSearchRunStatusInputSchema.safeParse({ ...base, status: 'pending' }).success,
    ).toBe(false)
    expect(
      updateSearchRunStatusInputSchema.safeParse({
        ...base,
        status: 'provider_not_configured',
      }).success,
    ).toBe(false)
  })
})
