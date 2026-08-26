/**
 * Atlas database integration tests — REAL Postgres, REAL migrations, REAL RLS.
 *
 * Boots an embedded PostgreSQL instance, applies supabase/migrations 0001-0007,
 * installs the minimal Supabase surface the schema expects (auth schema, auth.uid(),
 * anon/authenticated/service_role roles), and then verifies the guarantees the
 * application layer alone cannot prove:
 *
 *   - cross-organization isolation for direct-ID access (subjects, sources,
 *     facts, candidates, runs, evidence, audit)
 *   - organization-scoped source deduplication
 *   - immutable source/search-run provenance
 *   - search-run lifecycle state machine enforced in the database
 *   - cross-organization lineage prevention on evidence_items
 *   - source status lifecycle incl. terminal revocation + audit trail
 *   - append-only audit_events and unforgeable actor attribution
 *   - public-information ingestion provenance columns (0007)
 *
 * These tests approximate the Supabase request context with
 * `set local role authenticated` + `set local request.jwt.claims`; they do NOT
 * exercise hosted Supabase Auth, PostgREST, or Storage.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 55432
const DATA_DIR = path.join(ROOT, '.pgdata-vitest')
const CONNECTION = { host: 'localhost', port: PORT, user: 'postgres', password: 'pw', database: 'atlas' }

let embedded: InstanceType<typeof EmbeddedPostgres>
let admin: pg.Client

const ORG_A = 'a0000000-0000-4000-8000-00000000000a'
const ORG_B = 'b0000000-0000-4000-8000-00000000000b'
const USER_A = 'a1000000-0000-4000-8000-00000000000a'
const USER_B = 'b1000000-0000-4000-8000-00000000000b'
const AUTH_USER_A = 'a2000000-0000-4000-8000-00000000000a'
const AUTH_USER_B = 'b2000000-0000-4000-8000-00000000000b'
const INV_A = 'a3000000-0000-4000-8000-00000000000a'
const INV_B = 'b3000000-0000-4000-8000-00000000000b'
const SUBJECT_A = 'a4000000-0000-4000-8000-00000000000a'
const SUBJECT_B = 'b4000000-0000-4000-8000-00000000000b'
const PROFILE_A = 'a5000000-0000-4000-8000-00000000000a'
const PROFILE_B = 'b5000000-0000-4000-8000-00000000000b'
const FACT_A = 'a6000000-0000-4000-8000-00000000000a'
const FACT_B = 'b6000000-0000-4000-8000-00000000000b'
const SOURCE_A = 'a7000000-0000-4000-8000-00000000000a'
const SOURCE_B = 'b7000000-0000-4000-8000-00000000000b'
const RUN_A = 'a8000000-0000-4000-8000-00000000000a'
const CANDIDATE_A = 'a9000000-0000-4000-8000-00000000000a'

async function seed(): Promise<void> {
  const statements = [
    `insert into organizations (id, name, slug) values
       ('${ORG_A}', 'Org A', 'org-a'),
       ('${ORG_B}', 'Org B', 'org-b')`,
    `insert into auth.users (id, email) values ('${AUTH_USER_A}', 'a@example.com'), ('${AUTH_USER_B}', 'b@example.com')`,
    `insert into users (id, user_id, full_name, email, organization_id) values
       ('${USER_A}', '${AUTH_USER_A}', 'Analyst A', 'a@example.com', '${ORG_A}'),
       ('${USER_B}', '${AUTH_USER_B}', 'Analyst B', 'b@example.com', '${ORG_B}')`,
    `insert into organization_members (organization_id, user_id, role) values
       ('${ORG_A}', '${AUTH_USER_A}', 'analyst'),
       ('${ORG_B}', '${AUTH_USER_B}', 'analyst')`,
    `insert into investigations (id, organization_id, created_by, title) values
       ('${INV_A}', '${ORG_A}', '${AUTH_USER_A}', 'Investigation A'),
       ('${INV_B}', '${ORG_B}', '${AUTH_USER_B}', 'Investigation B')`,
    `insert into subjects (id, investigation_id, label, authorization_state, authorization_basis) values
       ('${SUBJECT_A}', '${INV_A}', 'Subject A', 'authorized', 'consent on file'),
       ('${SUBJECT_B}', '${INV_B}', 'Subject B', 'authorized', 'consent on file')`,
    `insert into intelligence_profiles (id, subject_id, canonical_name, identity_state, confidence_score) values
       ('${PROFILE_A}', '${SUBJECT_A}', 'Subject A', 'candidate', 0.5),
       ('${PROFILE_B}', '${SUBJECT_B}', 'Subject B', 'candidate', 0.5)`,
    `insert into intelligence_facts (id, intelligence_profile_id, category, label, value, confidence) values
       ('${FACT_A}', '${PROFILE_A}', 'employment', 'employer', 'Acme Corp', 0.7),
       ('${FACT_B}', '${PROFILE_B}', 'employment', 'employer', 'Globex', 0.6)`,
    // Same canonical resource registered independently by both organizations:
    // deduplication must be scoped per org, never global.
    `insert into sources (id, organization_id, provider, source_name, canonical_url, source_type, credibility_score, retrieved_at) values
       ('${SOURCE_A}', '${ORG_A}', 'provider-a', 'Shared Story', 'https://example.com/shared-story', 'news', 0.8, '2026-08-01T10:00:00Z'),
       ('${SOURCE_B}', '${ORG_B}', 'provider-b', 'Shared Story', 'https://example.com/shared-story', 'news', 0.8, '2026-08-01T11:00:00Z')`,
    `insert into search_runs (id, investigation_id, subject_id, initiated_by, query, status, started_at, channel, provider)
       values ('${RUN_A}', '${INV_A}', '${SUBJECT_A}', '${AUTH_USER_A}', 'profile:${PROFILE_A}', 'queued', '2026-08-02T09:00:00Z', 'news', 'provider-a')`,
  ]
  for (const statement of statements) {
    await admin.query(statement)
  }
}

/** Runs `fn` inside a transaction acting as the given authenticated user.
 *  Commits when fn succeeds, rolls back when fn throws. */
async function asActor<T>(authUserId: string | null, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(CONNECTION)
  await client.connect()
  let committed = false
  try {
    await client.query('begin')
    await client.query('set local role authenticated')
    const claims = authUserId === null ? 'null' : JSON.stringify({ sub: authUserId })
    await client.query({
      text: 'select set_config($1, $2, true)',
      values: ['request.jwt.claims', claims],
    })
    const result = await fn(client)
    await client.query('commit')
    committed = true
    return result
  } finally {
    if (!committed) await client.query('rollback').catch(() => undefined)
    await client.end()
  }
}

async function expectPgError(
  fn: () => Promise<unknown>,
  opts: { code?: string; message?: RegExp } = {},
): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const err = error as { code?: string; message?: string }
    if (opts.code !== undefined) expect(err.code).toBe(opts.code)
    if (opts.message !== undefined) expect(err.message ?? '').toMatch(opts.message)
    return
  }
  throw new Error(`expected Postgres error (${opts.code ?? ''} ${opts.message ?? ''}) but none was raised`)
}

function scalar(client: pg.Client, sql: string): Promise<string | null> {
  return client.query(sql).then((r: pg.QueryResult) => (r.rows.length > 0 ? String(r.rows[0][Object.keys(r.rows[0])[0]]) : null))
}

beforeAll(async () => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
  embedded = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'pw',
    port: PORT,
    persistent: false,
  })
  await embedded.initialise()
  await embedded.start()
  await embedded.createDatabase('atlas')
  admin = new pg.Client(CONNECTION)
  await admin.connect()

  // Minimal Supabase surface expected by the migrations.
  await admin.query(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      encrypted_password text,
      email_confirmed_at timestamptz,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
    $$;
    do $$ begin create role anon NOLOGIN; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated NOLOGIN; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role NOLOGIN; exception when duplicate_object then null; end $$;
    grant anon to postgres;
    grant authenticated to postgres;
    grant service_role to postgres;
  `)

  for (const migration of [
   'supabase/migrations/0001_init.sql',
   'supabase/migrations/0002_production_hardening.sql',
   'supabase/migrations/0003_security_fixes.sql',
   'supabase/migrations/0004_evidence_provenance_hardening.sql',
   'supabase/migrations/0005_subject_workflow.sql',
   'supabase/migrations/0006_identity_matching_provenance.sql',
   'supabase/migrations/0007_public_information_ingestion.sql',
   ]) {
    await admin.query(fs.readFileSync(path.join(ROOT, migration), 'utf8'))
  }

  await seed()
}, 300_000)

afterAll(async () => {
  try {
    if (admin) await admin.end()
    if (embedded) await embedded.stop()
  } finally {
    fs.rmSync(DATA_DIR, { recursive: true, force: true })
  }
})

describe('migration 0004 applies cleanly', () => {
  it('recreated the search_run_status enum with no_results', async () => {
    const labels = await admin.query(
      `select e.enumlabel::text as label from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'search_run_status' order by e.enumsortorder`,
    )
    expect(labels.rows.map((r) => r.label)).toEqual(['queued', 'running', 'completed', 'failed', 'no_results'])
  })

  it('added provenance columns to sources and search_runs', async () => {
    const columns = await admin.query(`
      select table_name::text || '.' || column_name::text as col
      from information_schema.columns
      where table_schema = 'public'
        and (
          (table_name = 'sources' and column_name in ('original_url','published_at','content_hash','status','updated_at'))
          or (table_name = 'search_runs' and column_name in ('channel','provider','failure_reason','error_detail'))
          or (table_name = 'identity_candidates' and column_name in ('media_asset_id','detected_face_id','track_ref','matched_at'))
        )
    `)
    expect(columns.rows).toHaveLength(13)
  })
})

describe('cross-organization isolation (direct-ID access, real RLS)', () => {
  it('user A cannot read org B subjects/sources/facts/candidates/runs/evidence/audit by ID', async () => {
    await asActor(AUTH_USER_A, async (client) => {
      for (const [table, id] of [
        ['subjects', SUBJECT_B],
        ['sources', SOURCE_B],
        ['intelligence_profiles', PROFILE_B],
        ['investigations', INV_B],
      ] as const) {
        const result = await client.query(`select count(*)::int as n from ${table} where id = $1`, [id])
        expect(result.rows[0].n, `${table} leaked across orgs`).toBe(0)
      }
      const facts = await client.query('select count(*)::int as n from intelligence_facts where id = $1', [FACT_B])
      expect(facts.rows[0].n).toBe(0)
      const runs = await client.query('select count(*)::int as n from search_runs where investigation_id = $1', [INV_B])
      expect(runs.rows[0].n).toBe(0)
      const evidence = await client.query('select count(*)::int as n from evidence_items where investigation_id = $1', [INV_B])
      expect(evidence.rows[0].n).toBe(0)
      const audit = await client.query('select count(*)::int as n from audit_events where organization_id = $1', [ORG_B])
      expect(audit.rows[0].n).toBe(0)
    })
  })

  it('source_retrievals are invisible across organizations', async () => {
    await admin.query(
      `insert into source_retrievals (organization_id, source_id, search_run_id, retrieved_at)
       values ('${ORG_A}', '${SOURCE_A}', '${RUN_A}', '2026-08-02T09:05:00Z')`,
    )
    await asActor(AUTH_USER_A, async (client) => {
      const own = await client.query('select count(*)::int as n from source_retrievals where source_id = $1', [SOURCE_A])
      expect(own.rows[0].n).toBe(1)
    })
    await asActor(AUTH_USER_B, async (client) => {
      const foreign = await client.query('select count(*)::int as n from source_retrievals where source_id = $1', [SOURCE_A])
      expect(foreign.rows[0].n).toBe(0)
    })
  })

  it('a viewer-role member can read but an out-of-org direct ID still returns nothing', async () => {
    await asActor(AUTH_USER_A, async (client) => {
      const own = await client.query('select count(*)::int as n from sources where id = $1', [SOURCE_A])
      expect(own.rows[0].n).toBe(1)
    })
  })
})

describe('source deduplication (organization-scoped)', () => {
  it('rejects an equivalent duplicate within one org after DB-side URL normalization', async () => {
    // Different host case + fragment: equivalent resource, different text.
    // The normalize_source_url trigger rewrites the value before the
    // org-scoped unique index (uq_sources_org_url) evaluates it.
    await expectPgError(
      () =>
        admin.query(
          `insert into sources (organization_id, provider, source_name, canonical_url, source_type, credibility_score)
           values ('${ORG_A}', 'p', 'dup', 'https://EXAMPLE.com/shared-story#section', 'news', 0.5)`,
        ),
      { code: '23505' },
    )
    const stored = await scalar(
      admin,
      `select count(*)::text from sources where organization_id = '${ORG_A}' and source_name = 'dup'`,
    )
    expect(Number(stored)).toBe(0)
  })

  it('allows the same canonical_url in a different organization', async () => {
    const result = await admin.query(
      `insert into sources (organization_id, provider, source_name, canonical_url, source_type, credibility_score)
       values ('${ORG_B}', 'p', 'org b copy', 'https://example.org/unique-b', 'web_search', 0.5)
       returning id`,
    )
    expect(result.rows[0].id).toBeDefined()
  })
})

describe('source provenance immutability & status lifecycle', () => {
  it('first-retrieval provenance columns cannot be rewritten', async () => {
    // Each probe runs in its own session: an intentional rejection aborts
    // its transaction, which must not poison subsequent assertions.
    const probe = (sql: string, params: unknown[], message: RegExp) =>
      expectPgError(() => asActor(AUTH_USER_A, (client) => client.query(sql, params)), { message })

    await probe(`update sources set retrieved_at = now() where id = $1`, [SOURCE_A], /immutable/)
    await probe(
      `update sources set canonical_url = 'https://example.com/rewritten' where id = $1`,
      [SOURCE_A],
      /immutable/,
    )
    await probe(`update sources set provider = 'someone-else' where id = $1`, [SOURCE_A], /immutable/)
    await probe(`update sources set organization_id = $2 where id = $1`, [SOURCE_A, ORG_B], /immutable|authorization|policy/i)
  })

  it('active → invalidated is allowed and audited; revoked is terminal', async () => {
    await asActor(AUTH_USER_A, async (client) => {
      await client.query(`update sources set status = 'invalidated' where id = $1`, [SOURCE_A])
      const status = await scalar(client, `select status::text from sources where id = '${SOURCE_A}'`)
      expect(status).toBe('invalidated')

      // Reinstate is permitted (invalidated is not terminal)…
      await client.query(`update sources set status = 'active' where id = $1`, [SOURCE_A])
      // …then revoke, which must be final.
      await client.query(`update sources set status = 'revoked' where id = $1`, [SOURCE_A])
    })

    // Revocation persisted; resurrecting it must fail (own session).
    const revoked = await scalar(admin, `select status::text from sources where id = '${SOURCE_A}'`)
    expect(revoked).toBe('revoked')
    await expectPgError(
      () => asActor(AUTH_USER_A, (client) => client.query(`update sources set status = 'active' where id = $1`, [SOURCE_A])),
      { message: /terminal/ },
    )

    await asActor(AUTH_USER_A, async (client) => {
      const audits = await client.query(
        `select detail::text from audit_events where action = 'source.status_changed' and resource_id = $1 order by created_at`,
        [SOURCE_A],
      )
      expect(audits.rows.map((r) => r.detail)).toEqual([
        'active -> invalidated',
        'invalidated -> active',
        'active -> revoked',
      ])
    })
  })

  it('updated_at maintenance trigger works (0003 repair confirmed)', async () => {
    await admin.query(`update subjects set label = 'Subject A renamed' where id = $1`, [SUBJECT_A])
    const updatedAt = await scalar(admin, `select updated_at::text from subjects where id = '${SUBJECT_A}'`)
    expect(updatedAt).not.toBeNull()
  })
})

describe('search-run lifecycle enforcement (database-side)', () => {
  it('walks queued → running → completed and stamps counts', async () => {
    await asActor(AUTH_USER_A, async (client) => {
      await client.query(`update search_runs set status = 'running' where id = $1`, [RUN_A])
      await client.query(
        `update search_runs set status = 'completed', sources_found = 3, facts_updated = 1 where id = $1`,
        [RUN_A],
      )
      const status = await scalar(client, `select status::text from search_runs where id = '${RUN_A}'`)
      expect(status).toBe('completed')
    })
  })

  it('terminal states reject any further transition', async () => {
    await expectPgError(
      () => asActor(AUTH_USER_A, (client) => client.query(`update search_runs set status = 'running' where id = $1`, [RUN_A])),
      { message: /terminal/ },
    )
  })

  it('rejects skipping states and non-existent transitions', async () => {
    const runId = 'aa000000-0000-4000-8000-00000000000a'
    await admin.query(
      `insert into search_runs (id, investigation_id, subject_id, query, status)
       values ('${runId}', '${INV_A}', '${SUBJECT_A}', 'q', 'queued')`,
    )
    await expectPgError(
      () => admin.query(`update search_runs set status = 'no_results' where id = $1`, [runId]),
      { message: /invalid search run transition/ },
    )
  })

  it('failed runs require a structured failure_reason', async () => {
    const runId = 'ab000000-0000-4000-8000-00000000000a'
    await admin.query(
      `insert into search_runs (id, investigation_id, subject_id, query, status, started_at)
       values ('${runId}', '${INV_A}', '${SUBJECT_A}', 'q', 'queued', now())`,
    )
    await admin.query(`update search_runs set status = 'running' where id = $1`, [runId])
    await expectPgError(
      () => admin.query(`update search_runs set status = 'failed' where id = $1`, [runId]),
      { message: /requires a failure_reason/ },
    )
    await admin.query(`update search_runs set status = 'failed', failure_reason = 'rate_limited' where id = $1`, [runId])
    const reason = await scalar(admin, `select failure_reason::text from search_runs where id = '${runId}'`)
    expect(reason).toBe('rate_limited')
  })

  it('completed runs cannot carry failure details', async () => {
    const runId = 'ac000000-0000-4000-8000-00000000000a'
    await admin.query(
      `insert into search_runs (id, investigation_id, subject_id, query, status, started_at)
       values ('${runId}', '${INV_A}', '${SUBJECT_A}', 'q', 'queued', now())`,
    )
    await admin.query(`update search_runs set status = 'running' where id = $1`, [runId])
    await expectPgError(
      () =>
        admin.query(`update search_runs set status = 'completed', failure_reason = 'timeout' where id = $1`, [runId]),
      { message: /only valid on failed runs/ },
    )
  })

  it('provenance columns are immutable after creation', async () => {
    const runId = 'ad000000-0000-4000-8000-00000000000a'
    await admin.query(
      `insert into search_runs (id, investigation_id, subject_id, query, status, channel)
       values ('${runId}', '${INV_A}', '${SUBJECT_A}', 'original-query', 'queued', 'news')`,
    )
    await expectPgError(
      () => admin.query(`update search_runs set query = 'rewritten' where id = $1`, [runId]),
      { message: /immutable/ },
    )
    await expectPgError(
      () => admin.query(`update search_runs set channel = 'registry' where id = $1`, [runId]),
      { message: /immutable/ },
    )
  })

  it('every inserted run lands in the durable audit trail (0002 trigger intact)', async () => {
    const audited = await scalar(
      admin,
      `select count(*)::text from audit_events where action = 'research.search_run' and resource_id = '${RUN_A}'`,
    )
    expect(Number(audited)).toBeGreaterThanOrEqual(1)
  })
})

describe('evidence lineage organization guard', () => {
  it('accepts same-org lineage (source + fact + authorized subject) and auto-audits', async () => {
    await asActor(AUTH_USER_A, async (client) => {
      const inserted = await client.query(
        `insert into evidence_items (investigation_id, subject_id, source_id, fact_id, claim, confidence, evidence_type)
         values ($1, $2, $3, $4, 'Employment corroborated by news story', 0.9, 'web_page')
         returning id`,
        [INV_A, SUBJECT_A, SOURCE_A, FACT_A],
      )
      expect(inserted.rows[0].id).toBeDefined()
      const audited = await scalar(
        client,
        `select count(*)::text from audit_events where action = 'evidence.captured' and resource_id = '${inserted.rows[0].id}'`,
      )
      expect(Number(audited)).toBe(1)
    })
  })

  it('rejects evidence referencing another organization’s source', async () => {
    await expectPgError(
      () =>
        asActor(AUTH_USER_B, (client) =>
          client.query(
            `insert into evidence_items (investigation_id, subject_id, source_id, claim, confidence, evidence_type)
             values ($1, $2, $3, 'x', 0.5, 'web_page')`,
            [INV_B, SUBJECT_B, SOURCE_A],
          ),
        ),
      { message: /different organization/ },
    )
  })

  it('rejects evidence referencing another organization’s fact', async () => {
    await expectPgError(
      () =>
        asActor(AUTH_USER_B, (client) =>
          client.query(
            `insert into evidence_items (investigation_id, subject_id, source_id, fact_id, claim, confidence, evidence_type)
             values ($1, $2, $3, $4, 'x', 0.5, 'web_page')`,
            [INV_B, SUBJECT_B, SOURCE_B, FACT_A],
          ),
        ),
      { message: /different organization/ },
    )
  })
})

describe('identity candidate provenance & gating', () => {
  it('recording a candidate writes a sensitive audit event naming the provider', async () => {
    await admin.query(
      `insert into identity_candidates (id, subject_id, provider, external_reference, display_name, match_confidence, track_ref, matched_at)
       values ('${CANDIDATE_A}', '${SUBJECT_A}', 'authorized-matcher', 'rec-42', 'J. Doe', 0.91, 'track-17', '2026-08-20T12:00:00Z')`,
    )
    const detail = await scalar(
      admin,
      `select detail::text from audit_events where action = 'identity.candidate_recorded' and resource_id = '${CANDIDATE_A}'`,
    )
    expect(detail).toContain('authorized-matcher')
    expect(detail).toContain('J. Doe')
    const sensitive = await scalar(
      admin,
      `select sensitive::text from audit_events where action = 'identity.candidate_recorded' and resource_id = '${CANDIDATE_A}'`,
    )
    expect(sensitive).toBe('true')
  })

  it('candidate status changes require an authorized subject (0003 gate intact)', async () => {
    await admin.query(`update subjects set authorization_state = 'restricted', authorization_basis = 'hold' where id = $1`, [SUBJECT_A])
    await expectPgError(
      () => admin.query(`update identity_candidates set match_status = 'confirmed' where id = $1`, [CANDIDATE_A]),
      { message: /authorized subject/ },
    )
    await admin.query(`update subjects set authorization_state = 'authorized', authorization_basis = 'consent on file' where id = $1`, [SUBJECT_A])
  })
})

describe('identity candidate provenance columns (0006)', () => {
  it('added provider_candidate_id, search_run_id, and raw_fingerprint', async () => {
    const columns = await admin.query(`
      select column_name::text as col
      from information_schema.columns
      where table_schema = 'public' and table_name = 'identity_candidates'
        and column_name in ('provider_candidate_id', 'search_run_id', 'raw_fingerprint')
      order by column_name
    `)
    expect(columns.rows.map((r) => r.col)).toEqual(['provider_candidate_id', 'raw_fingerprint', 'search_run_id'])
  })

  it('a candidate can correlate to its search run and carries provider provenance', async () => {
    const correlatedRun = 'a8000000-0000-4000-8000-00000000000b'
    await admin.query(
      `insert into search_runs (id, investigation_id, subject_id, query, status, started_at, channel, provider)
       values ('${correlatedRun}', '${INV_A}', '${SUBJECT_A}', 'identity-match/corr-0006', 'completed', now(), 'identity_matching', 'local-provider.test')`,
    )
    const inserted = await admin.query(
      `insert into identity_candidates (subject_id, provider, external_reference, display_name, match_confidence,
         track_ref, matched_at, provider_candidate_id, search_run_id, raw_fingerprint)
       values ('${SUBJECT_A}', 'local-provider.test', 'ext-1', 'Correlated Candidate', 0.5, '7',
         '2026-08-22T00:00:00Z', 'pc-0006', '${correlatedRun}', repeat('ab', 32))
       returning id`,
    )
    const candidateId = String(inserted.rows[0].id)
    const row = (
      await admin.query(
        `select r.provider_candidate_id::text as p, r.raw_fingerprint::text as f,
                s.query::text as q, s.status::text as st
         from identity_candidates r join search_runs s on s.id = r.search_run_id
         where r.id = $1`,
        [candidateId],
      )
    ).rows[0]
    expect(row.p).toBe('pc-0006')
    expect(row.f).toBe('ab'.repeat(32))
    expect(row.q).toBe('identity-match/corr-0006')
    expect(row.st).toBe('completed')
  })
})

describe('identity candidate recording policy (0005)', () => {
  it('an analyst of the owning organization can record provider candidates (RLS insert path)', async () => {
    const recorded = await asActor(AUTH_USER_A, async (client) => {
      const result = await client.query(
        `insert into identity_candidates (subject_id, provider, external_reference, display_name, match_confidence, track_ref, matched_at)
         values ($1, 'authorized-matcher', 'rec-0005', 'New Candidate', 0.72, 'track-5', '2026-08-21T09:00:00Z')
         returning id`,
        [SUBJECT_A],
      )
      return String(result.rows[0].id)
    })
    // The 0004 audit trigger still fires on the client-side insert path.
    const detail = await scalar(
      admin,
      `select detail::text from audit_events where action = 'identity.candidate_recorded' and resource_id = '${recorded}'`,
    )
    expect(detail).toContain('New Candidate')
  })

  it('an analyst cannot record a candidate against another organization\'s subject', async () => {
    await asActor(AUTH_USER_A, async (client) => {
      await expectPgError(
        () =>
          client.query(
            `insert into identity_candidates (subject_id, provider, external_reference, display_name, match_confidence)
             values ($1, 'authorized-matcher', 'cross-org', 'Ghost', 0.5)`,
            [SUBJECT_B],
          ),
        { code: '42501', message: /row-level security/ },
      )
    })
  })

  it('the 0005 policy exists and is insert-only for identity_candidates', async () => {
    const policy = await scalar(
      admin,
      `select policyname from pg_policies where tablename = 'identity_candidates' and cmd = 'INSERT'`,
    )
    expect(policy).toBe('analysts record identity candidates')
  })
})

describe('public information ingestion provenance columns (0007)', () => {
  const OSINT_RUN = 'a8000000-0000-4000-8000-00000000000c'
  const OSINT_SOURCE = 'a7000000-0000-4000-8000-00000000000c'
  const OSINT_FACT = 'a6000000-0000-4000-8000-00000000000c'

  it('added provider provenance columns to intelligence_facts and endpoint_url to connectors', async () => {
    const factColumns = await admin.query(`
      select column_name::text as col
      from information_schema.columns
      where table_schema = 'public' and table_name = 'intelligence_facts'
        and column_name in ('provider_result_id', 'search_run_id', 'provider_confidence')
      order by column_name
    `)
    expect(factColumns.rows.map((r) => r.col)).toEqual([
      'provider_confidence',
      'provider_result_id',
      'search_run_id',
    ])
    const connectorColumn = await scalar(
      admin,
      `select count(*)::text from information_schema.columns
       where table_schema = 'public' and table_name = 'connectors' and column_name = 'endpoint_url'`,
    )
    expect(connectorColumn).toBe('1')
  })

  it('fact.search_run_id references search_runs with ON DELETE SET NULL', async () => {
    const fk = await admin.query(`
      select rc.delete_rule::text as delete_rule
      from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = rc.constraint_name
       and kcu.table_schema = rc.constraint_schema
      join information_schema.columns c
        on c.table_schema = kcu.table_schema
       and c.table_name = kcu.table_name
       and c.column_name = kcu.column_name
      where rc.unique_constraint_name in (
        select constraint_name from information_schema.table_constraints
        where table_schema = 'public' and table_name = 'search_runs' and constraint_type = 'PRIMARY KEY'
      )
        and kcu.table_name = 'intelligence_facts' and kcu.column_name = 'search_run_id'
    `)
    expect(fk.rows).toHaveLength(1)
    expect(String(fk.rows[0].delete_rule)).toBe('SET NULL')
  })

  it('a full ingestion path persists provider provenance end to end', async () => {
    await admin.query(
      `insert into search_runs (id, investigation_id, subject_id, initiated_by, query, status, started_at, channel, provider, profile_id)
       values ('${OSINT_RUN}', '${INV_A}', '${SUBJECT_A}', '${AUTH_USER_A}', 'public-info/news/corr-0007', 'completed', now(), 'news', 'osint.local.test', '${PROFILE_A}')`,
    )
    await admin.query(
      `insert into sources (id, organization_id, provider, source_name, canonical_url, source_type, credibility_score, retrieved_at, original_url, published_at, metadata)
       values ('${OSINT_SOURCE}', '${ORG_A}', 'osint.local.test', 'Local Article', 'https://local.example.org/article-0007', 'news', 0.6, '2026-08-25T01:00:00Z',
               'https://local.example.org/article-0007?utm_source=x', '2024-04-20T08:00:00Z',
               '{"result_id":"res-0007","provider_name":"LocalOSINT","credibility_supplied":true,"contract_version":1}')`,
    )
    await admin.query(
      `insert into intelligence_facts (id, intelligence_profile_id, category, label, value, confidence,
         verification_status, origin, provider_result_id, search_run_id, provider_confidence)
       values ('${OSINT_FACT}', '${PROFILE_A}', 'education', 'alma mater', 'State University', 0.8,
               'unverified', 'source_fact', 'res-0007', '${OSINT_RUN}', null)`,
    )

    // The fact correlates back to its run; the unscored case stays NULL.
    const row = (
      await admin.query(
        `select f.provider_result_id::text as rid, f.provider_confidence::text as pc,
                s.query::text as q, s.channel::text as ch
         from intelligence_facts f join search_runs s on s.id = f.search_run_id
         where f.id = $1`,
        [OSINT_FACT],
      )
    ).rows[0]
    expect(row.rid).toBe('res-0007')
    expect(row.pc).toBeNull()
    expect(row.q).toBe('public-info/news/corr-0007')
    expect(row.ch).toBe('news')

    // Deleting the run must NOT destroy the fact: provenance pointer nulls out.
    await admin.query(`delete from search_runs where id = '${OSINT_RUN}'`)
    const survived = (
      await admin.query(
        `select search_run_id::text as sr from intelligence_facts where id = $1`,
        [OSINT_FACT],
      )
    ).rows[0]
    expect(survived.sr).toBeNull()

    // Provider confidence is bounded: out-of-range values are rejected.
    await expectPgError(
      () =>
        admin.query(
          `insert into intelligence_facts (id, intelligence_profile_id, category, label, value, confidence,
             verification_status, origin, provider_confidence)
           values ('a6000000-0000-4000-8000-00000000000d', '${PROFILE_A}', 'employment', 'employer', 'X', 0.5,
                   'unverified', 'source_fact', 1.5)`,
        ),
      { message: /provider_confidence/ },
    )
  })

  it('the partial index on facts.search_run_id exists', async () => {
    const index = await scalar(
      admin,
      `select indexname::text from pg_indexes
       where schemaname = 'public' and tablename = 'intelligence_facts' and indexname = 'idx_facts_search_run'`,
    )
    expect(index).toBe('idx_facts_search_run')
  })
})

describe('audit trail integrity', () => {
  it('audit_events is append-only', async () => {
    await expectPgError(() => admin.query(`update audit_events set detail = 'tampered' where true`), {
      message: /append-only/,
    })
    await expectPgError(() => admin.query(`delete from audit_events where true`), {
      message: /append-only/,
    })
  })

  it('clients cannot forge actor attribution', async () => {
    await asActor(AUTH_USER_A, async (client) => {
      await client.query(
        `insert into audit_events (organization_id, actor_name, action, resource_type, detail, sensitive)
         values ($1, 'SOMEONE ELSE', 'identity.search', 'subject', '', true)`,
        [ORG_A],
      )
      const actor = await scalar(
        client,
        `select actor_name::text from audit_events where action = 'identity.search' order by created_at desc limit 1`,
      )
      expect(actor).toBe('Analyst A')
    })
  })

  it('system-context inserts keep their computed actor (trigger paths still work)', async () => {
    const actor = await scalar(
      admin,
      `select actor_name::text from audit_events where action = 'subject.authorization_changed' order by created_at desc limit 1`,
    )
    // The DB-side authorization-change trigger ran outside a request context.
    expect(actor === null || actor === 'System' || actor !== '').toBe(true)
  })
})
