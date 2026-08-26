import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface StubResponse {
  data?: unknown
  error?: { code?: string; message: string } | null
}

export interface TableExpectation {
  /** Responses are consumed in order per terminal call; last one repeats. */
  responses: StubResponse[]
}

type Terminal = PromiseLike<StubResponse>

/**
 * Minimal chainable Supabase query stub. Records calls so tests can assert
 * which tables/filters were touched without a network transport.
 */
export function createStubClient(expectations: Record<string, StubResponse[]> = {}) {
  const calls: Array<{ table: string; op: string; filters: unknown[] }> = []

  const makeBuilder = (table: string, op: string): any => {
    const builder: any = {
      select: (...args: unknown[]) => {
        calls.push({ table, op, filters: ['select', ...args] })
        return makeBuilder(table, op)
      },
      eq: (...args: unknown[]) => {
        calls.push({ table, op, filters: ['eq', ...args] })
        return builder
      },
      in: (...args: unknown[]) => {
        calls.push({ table, op, filters: ['in', ...args] })
        return builder
      },
      order: () => builder,
      limit: () => builder,
      update: (payload: unknown) => {
        calls.push({ table, op: 'update', filters: [payload] })
        return makeBuilder(table, 'update')
      },
      insert: (payload: unknown) => {
        calls.push({ table, op: 'insert', filters: [payload] })
        return makeBuilder(table, 'insert')
      },
      delete: () => makeBuilder(table, 'delete'),
    }
    const respond = (): StubResponse => {
      const queue = expectations[table] ?? []
      return queue.length > 1 ? (queue.shift() as StubResponse) : (queue[0] ?? { data: null, error: null })
    }
    builder.maybeSingle = () => ({ then: (res: (v: StubResponse) => unknown) => res(respond()) }) as Terminal
    builder.single = () => ({ then: (res: (v: StubResponse) => unknown) => res(respond()) }) as Terminal
    builder.then = (res: (v: StubResponse) => unknown) => res(respond())
    return builder
  }

  const client = {
    from: (table: string) => makeBuilder(table, 'select'),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1', email: 'analyst@example.com' } },
        error: null,
      })),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  }

  return { client: client as unknown as SupabaseClient, calls }
}
