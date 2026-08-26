# Hosted Supabase E2E verification

Real-browser end-to-end tests that drive the production Atlas stack — GoTrue
authentication, PostgREST + Row Level Security, and Supabase Storage — through
the actual application UI and the official `supabase-js` client. Nothing is
mocked; when hosted infrastructure is unavailable the suite says so explicitly
instead of pretending.

## What runs where

| Suite                  | unconfigured | unreachable | anon-signup | seeded |
| ---------------------- | ------------ | ----------- | ----------- | ------ |
| auth: route protection | run          | run         | run         | run    |
| auth: wrong password   | skip         | skip        | run         | run    |
| auth: sign-up flow     | skip         | skip        | skip¹       | run    |
| auth: seeded login lifecycle / JWT->PostgREST | skip | skip | skip¹ | run |
| workflow: primary views | skip        | skip        | run²        | run    |
| rls-isolation (cross-org matrix, gates, lineage, attribution, run/source lifecycle) | skip | skip | skip | run |
| storage                | skip         | skip        | skip        | run³   |

1. Requires `ATLAS_E2E_PASSWORD`; signup additionally requires the service
   role so the created identity can be removed afterwards.
2. Data assertions require seeding; shell rendering works with any session.
3. Positive paths require the operator to provision the `media-assets` bucket
   (`scripts/hosted-storage-setup.sql`). Without it the suite reports
   `STORAGE_BUCKET_NOT_PROVISIONED` and verifies only the honest negative path.

Skip reasons are printed verbatim by the runner, e.g.:

```
HOSTED_SUPABASE_NOT_CONFIGURED — set ATLAS_E2E_SUPABASE_URL and
ATLAS_E2E_SUPABASE_ANON_KEY to run hosted verification.
```

## Configuration

Copy `.env.e2e.example` values into your shell or CI secret store.

| Variable | Scope | Purpose |
| --- | --- | --- |
| `ATLAS_E2E_SUPABASE_URL` | public | project URL; injected into the browser via Vite |
| `ATLAS_E2E_SUPABASE_ANON_KEY` | public | anon key; injected into the browser via Vite |
| `ATLAS_E2E_PASSWORD` | runner-only | shared password for harness identities |
| `ATLAS_E2E_SERVICE_ROLE_KEY` | runner-only | seeding/cleanup only. **Never** enters the browser process — enforced by `playwright.config.ts` |
| `ATLAS_E2E_ACCESS_TOKEN` | runner-only | management API token for managed migrations |
| `ATLAS_E2E_ALLOW_MIGRATIONS` | runner-only | must be `"true"` before `e2e:migrations` will act |

## Commands

```bash
npm run test:e2e            # full run; skips cleanly without credentials
npm run e2e:schema-verify   # read-only check of hosted tables vs 0001..0004
npm run e2e:migrations      # guarded managed migration apply (opt-in)
```

## Operator responsibilities (deliberately not automated)

- **Schema**: applying `supabase/migrations/*.sql` stays an explicit operator
  action unless you opt in via access token + guard flag. Verify with
  `npm run e2e:schema-verify` (read-only introspection).
- **Storage bucket**: no migration creates buckets. Run
  `scripts/hosted-storage-setup.sql` once per project (idempotent) to create
  the private `media-assets` bucket with org-scoped policies.
- **Email confirmation**: if the project enforces confirmed e-mails, the
  sign-up test reports honestly that confirmation gates first sign-in rather
  than weakening project auth settings.

## Seeding & cleanup

In seeded mode the runner creates two complete organizations (identities,
memberships, investigations, authorized/restricted subjects, profiles, facts,
sources, queued search runs, evidence, retrievals, candidates, media rows)
using the service role, then drives both analyst identities through real UI
sign-ins in separate browser contexts. Cleanup deletes every row, object and
auth user in FK-safe order after each worker finishes; a manifest file makes
cleanup self-healing if a previous run crashed mid-flight.

## Known boundaries

- The service-role key never crosses into the browser; isolation probes use
  exactly the credentials a real attacker would have (anon key + own JWT).
- Anonymous runners cannot delete identities created via sign-up; those tests
  therefore require the service role instead of leaving residue behind.
- Storage signed-URL semantics depend on the operator SQL above; until applied,
  positive storage coverage is reported as skipped, not passing.
