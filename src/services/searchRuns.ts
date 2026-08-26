import { z } from 'zod'
import { AtlasServiceError } from './errors'
import { searchFailureReasonSchema, searchRunStatusSchema } from './schemas'

export type SearchRunStatus = z.infer<typeof searchRunStatusSchema>
export type SearchFailureReason = z.infer<typeof searchFailureReasonSchema>

/**
 * Search-run lifecycle state machine.
 *
 *   queued → running → completed | failed | no_results
 *   queued → failed            (never started; e.g. authorization refused)
 *
 * Terminal states are terminal: completed / failed / no_results can never
 * transition anywhere. NO_RESULTS is a successful run that found nothing —
 * it is never conflated with FAILED, and failures carry a structured
 * reason (timeout, rate_limited, auth_failed, provider_error,
 * invalid_response, network). PROVIDER_NOT_CONFIGURED is not a run state:
 * no run is recorded when no provider exists.
 */

export const TERMINAL_SEARCH_RUN_STATUSES: readonly SearchRunStatus[] = [
  'completed',
  'failed',
  'no_results',
]

export function isTerminalSearchRunStatus(status: SearchRunStatus): boolean {
  return TERMINAL_SEARCH_RUN_STATUSES.includes(status)
}

export const VALID_SEARCH_RUN_TRANSITIONS: Record<SearchRunStatus, SearchRunStatus[]> = {
  queued: ['running', 'failed'],
  running: ['completed', 'failed', 'no_results'],
  completed: [],
  failed: [],
  no_results: [],
}

export function isValidSearchRunTransition(from: SearchRunStatus, to: SearchRunStatus): boolean {
  return VALID_SEARCH_RUN_TRANSITIONS[from]?.includes(to) ?? false
}

/** Throws a typed conflict error for an invalid lifecycle transition. */
export function assertSearchRunTransition(from: SearchRunStatus, to: SearchRunStatus): void {
  if (!isValidSearchRunTransition(from, to)) {
    throw new AtlasServiceError(
      'SearchRuns',
      'conflict',
      { from, to },
      `Invalid search run transition: ${from} → ${to}`,
    )
  }
}
