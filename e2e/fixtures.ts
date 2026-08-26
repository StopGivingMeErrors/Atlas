/**
 * Worker-scoped fixtures: seed the two-organization graph once per worker in
 * seeded mode and guarantee cleanup even when assertions fail.
 * In lower modes the world fixture yields null and suites skip explicitly.
 */
import { test as base, expect } from '@playwright/test'
import { state } from './helpers/hosted'
import { seedTwoOrgs, type SeededWorld } from './helpers/seed'

interface WorldFixtures {
  /** null unless the runner operates in seeded mode. */
  world: SeededWorld | null
}

export const test = base.extend<WorldFixtures>({
  world: [
    // Playwright validates that this callback destructures its fixtures
    // argument, so an empty pattern is required here.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type, no-empty-pattern
    async ({}, run) => {
      const s = state()
      if (s.mode !== 'seeded' || s.password === null || s.serviceRoleKey === null) {
        await run(null)
        return
      }
      const { world, cleanup } = await seedTwoOrgs(s.password)
      try {
        await run(world)
      } finally {
        await cleanup()
      }
    },
    { scope: 'worker' },
  ],
})

export { expect }

/** Standard skip guard for suites that need a seeded world. */
export async function requireWorld(world: SeededWorld | null): Promise<SeededWorld> {
  const s = state()
  test.skip(
    world === null,
    s.reason ||
      'requires seeded mode (ATLAS_E2E_SUPABASE_URL + ATLAS_E2E_SUPABASE_ANON_KEY + ATLAS_E2E_PASSWORD + ATLAS_E2E_SERVICE_ROLE_KEY)',
  )
  return world as SeededWorld
}
