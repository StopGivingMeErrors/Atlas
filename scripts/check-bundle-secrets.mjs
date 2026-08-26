// Fails the build when forbidden secret-shaped tokens appear in the
// compiled browser bundle. VITE_* variables are PUBLIC by definition; this
// is a tripwire against someone "conveniently" adding an API key that way.
//
// Usage: node scripts/check-bundle-secrets.mjs [distDir]

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const distDir = process.argv[2] ?? 'dist/assets'

const FORBIDDEN = [
  /supabase_service_role_key/i,
  /service_role/i,
  /IDENTITY_MATCHING_PROVIDER_API_KEY/,
  /IDENTITY_MATCHING_PROVIDER_URL/,
  /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i,
  /authorization['"]?\s*:\s*['"]Bearer\s+[A-Za-z0-9_\-\.]{20,}/i,
]

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) yield* walk(full)
    else yield full
  }
}

let scanned = 0
const violations = []
try {
  for (const file of walk(distDir)) {
    if (!/\.(js|css|html|mjs)$/.test(file)) continue
    scanned++
    const contents = readFileSync(file, 'utf8')
    for (const pattern of FORBIDDEN) {
      if (pattern.test(contents)) {
        violations.push(`${file}: matches ${String(pattern)}`)
      }
    }
  }
} catch (error) {
  console.error(`[check-bundle-secrets] cannot scan ${distDir}: ${error.message}`)
  process.exit(1)
}

if (violations.length > 0) {
  console.error('[check-bundle-secrets] SECRET-SHAPED TOKENS FOUND IN BUNDLE:')
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}
console.log(`[check-bundle-secrets] clean (${scanned} files scanned)`)
