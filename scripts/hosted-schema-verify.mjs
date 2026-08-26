/**
 * Read-only verification that a HOSTED Supabase project's schema matches the
 * Atlas migration pack. Uses the PostgREST OpenAPI introspection endpoint -
 * no writes are ever performed.
 *
 * Usage:
 *   ATLAS_E2E_SUPABASE_URL=https://<ref>.supabase.co \
 *   ATLAS_E2E_SUPABASE_ANON_KEY=<anon-key> \
 *   node scripts/hosted-schema-verify.mjs
 *
 * Exit code 0 = every expected table exists; 1 = missing tables (the script
 * prints exactly which). Applying migrations remains an OPERATOR action
 * (Supabase CLI / SQL editor) - this runner never mutates hosted schema
 * unless ATLAS_E2E_ALLOW_MIGRATIONS=true and an access token are provided
 * (see scripts/hosted-migrations.mjs).
 */
const url = process.env.ATLAS_E2E_SUPABASE_URL
const anonKey = process.env.ATLAS_E2E_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.error('HOSTED_SUPABASE_NOT_CONFIGURED — set ATLAS_E2E_SUPABASE_URL and ATLAS_E2E_SUPABASE_ANON_KEY')
  process.exit(1)
}

// Tables the full Atlas surface depends on (migrations 0001..0004).
const EXPECTED = [
  'organizations',
  'users',
  'organization_members',
  'investigations',
  'subjects',
  'media_assets',
  'detected_faces',
  'identity_candidates',
  'identity_confirmations',
  'intelligence_profiles',
  'intelligence_facts',
  'sources',
  'connectors',
  'evidence_items',
  'search_runs',
  'audit_events',
  'source_retrievals',
]

try {
  const response = await fetch(`${url}/rest/v1/`, { headers: { apikey: anonKey } })
  if (!response.ok) {
    console.error(`introspection failed: HTTP ${response.status}`)
    process.exit(1)
  }
  const spec = await response.json()
  const defined = new Set(Object.keys(spec.definitions ?? spec.paths ?? {}))
  const present = EXPECTED.filter((t) => defined.has(t))
  const missing = EXPECTED.filter((t) => !defined.has(t))

  console.log(`hosted project: ${url}`)
  console.log(`tables present (${present.length}/${EXPECTED.length}):`)
  for (const t of present) console.log(`  [ok] ${t}`)
  if (missing.length > 0) {
    console.log('MISSING (operator must apply migrations):')
    for (const t of missing) console.log(`  [missing] ${t}`)
    process.exit(1)
  }
  console.log('schema complete.')
} catch (error) {
  const cause = error?.cause?.code ? ` (${error.cause.code})` : ''
  console.error(`HOSTED_SUPABASE_UNREACHABLE — ${url}: ${error.message}${cause}`)
  process.exit(1)
}
