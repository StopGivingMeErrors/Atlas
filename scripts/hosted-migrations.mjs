/**
 * Optional managed migration application against a HOSTED Supabase project
 * via the management API. Heavily guarded by design:
 *
 *   1. requires ATLAS_E2E_SUPABASE_URL + ATLAS_E2E_ACCESS_TOKEN
 *   2. refuses to run unless ATLAS_E2E_ALLOW_MIGRATIONS === "true"
 *   3. refuses to run when the schema already matches (idempotent)
 *
 * Without all three, it exits with instructions - schema changes remain an
 * operator action by default.
 */
import fs from 'node:fs'
import path from 'node:path'

const url = process.env.ATLAS_E2E_SUPABASE_URL
const token = process.env.ATLAS_E2E_ACCESS_TOKEN

if (!url || !token) {
  console.error(
    'MIGRATIONS_NOT_MANAGED — set ATLAS_E2E_SUPABASE_URL and ATLAS_E2E_ACCESS_TOKEN, or apply supabase/migrations/*.sql manually (Dashboard SQL editor / supabase CLI).',
  )
  process.exit(1)
}
if (process.env.ATLAS_E2E_ALLOW_MIGRATIONS !== 'true') {
  console.error('REFUSED — set ATLAS_E2E_ALLOW_MIGRATIONS=true to allow managed migration application.')
  process.exit(1)
}

const ref = new URL(url).hostname.split('.')[0]
const api = `https://api.supabase.com/v1/projects/${ref}/database/query`

async function execSql(query) {
  const response = await fetch(api, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`)
  return text
}

async function main() {
  // Which migrations has the hosted DB already applied?
  const applied = new Set()
  try {
    const rows = JSON.parse(await execSql('select version from supabase_migrations.schema_migrations'))
    for (const r of rows) applied.add(String(r.version))
  } catch {
    console.log('no supabase_migrations table visible; treating hosted schema as empty')
  }

  const migrationsDir = path.resolve(process.cwd(), 'supabase', 'migrations')
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

  let pending = files.filter((f) => !applied.has(f.replace(/_.*$/, '')))
  if (pending.length === 0) {
    console.log(`schema up to date (${files.length} migrations accounted for). nothing to do.`)
    return
  }

  console.log(`applying ${pending.length} migration(s):`)
  for (const file of pending) {
    console.log(`  -> ${file}`)
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    await execSql(sql)
  }
  console.log('done. re-run scripts/hosted-schema-verify.mjs to confirm.')
}

main().catch((error) => {
  console.error(`migration failed: ${error.message}`)
  process.exit(1)
})
