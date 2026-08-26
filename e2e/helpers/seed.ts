/**
 * Runner-side seeding of a complete two-organization Atlas graph against the
 * HOSTED Supabase project, using the service-role key (this Node process
 * only - never the browser). Every inserted id is tracked for deterministic
 * cleanup; a manifest file makes cleanup self-healing across crashed runs.
 *
 * Column sets mirror supabase/migrations/0001..0004 exactly.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  adminCreateUser,
  adminDeleteObjects,
  adminDeleteUser,
  adminListObjects,
  adminRest,
} from './hosted'

const here = path.dirname(fileURLToPath(import.meta.url))
const MANIFEST = path.resolve(here, '.e2e-manifest.json')

export interface OrgGraph {
  label: string
  userId: string // auth uid
  userEmail: string
  fullName: string
  orgId: string
  matchingProviderUrl: string
  osintProviderUrl: string
  connectorId: string
  investigationId: string
  subjectAuthorizedId: string
  subjectRestrictedId: string
  profileId: string
  factId: string
  sourceId: string
  sourceUrl: string
  searchRunQueuedId: string
  evidenceId: string
  retrievalId: string
  candidateRestrictedSubjectId: string
  mediaAssetId: string
  storagePrefix: string
}

export interface SeededWorld {
  ranAt: string
  password: string
  a: OrgGraph
  b: OrgGraph
}

interface Manifest {
  world: SeededWorld
}

function randSuffix(): string {
  return crypto.randomUUID().slice(0, 8)
}

function slug(label: string, suffix: string): string {
  return `atlas-e2e-${label}-${suffix}`.toLowerCase()
}

async function purge(world: SeededWorld): Promise<void> {
  const graphs = [world.a, world.b]
  const orgIds = graphs.map((g) => g.orgId)

  // Storage objects first (paths recorded per org prefix).
  for (const g of graphs) {
    const names = await adminListObjects(g.storagePrefix)
    await adminDeleteObjects(names.map((n) => `${g.storagePrefix}${n}`))
  }

  // Children -> parents. Service role bypasses RLS; FKs still constrain order.
  await adminRest(`source_retrievals?id=in.(${graphs.map((g) => g.retrievalId).join(',')})`, { method: 'DELETE' })
  await adminRest(`audit_events?organization_id=in.(${orgIds.join(',')})`, { method: 'DELETE' })
  await adminRest(`identity_confirmations?candidate_id=in.(${graphs.map((g) => g.candidateRestrictedSubjectId).join(',')})`, { method: 'DELETE' })
  await adminRest(`identity_candidates?id=in.(${graphs.map((g) => g.candidateRestrictedSubjectId).join(',')})`, { method: 'DELETE' })
  await adminRest(`connectors?organization_id=in.(${orgIds.join(',')})`, { method: 'DELETE' })
  await adminRest(`evidence_items?id=in.(${graphs.map((g) => g.evidenceId).join(',')})`, { method: 'DELETE' })
  await adminRest(`search_runs?investigation_id=in.(${orgIds.join(',')})`, { method: 'DELETE' })
  await adminRest(`intelligence_facts?id=in.(${graphs.map((g) => g.factId).join(',')})`, { method: 'DELETE' })
  await adminRest(`intelligence_profiles?id=in.(${graphs.map((g) => g.profileId).join(',')})`, { method: 'DELETE' })
  await adminRest(`sources?organization_id=in.(${orgIds.join(',')})`, { method: 'DELETE' })
  await adminRest(`subjects?investigation_id=in.(${orgIds.join(',')})`, { method: 'DELETE' })
  await adminRest(`media_assets?organization_id=in.(${orgIds.join(',')})`, { method: 'DELETE' })
  await adminRest(`investigations?organization_id=in.(${orgIds.join(',')})`, { method: 'DELETE' })
  await adminRest(`organization_members?organization_id=in.(${orgIds.join(',')})`, { method: 'DELETE' })
  await adminRest(`users?user_id=in.(${graphs.map((g) => g.userId).join(',')})`, { method: 'DELETE' })
  await adminRest(`organizations?id=in.(${orgIds.join(',')})`, { method: 'DELETE' })
  for (const g of graphs) await adminDeleteUser(g.userId)
}

/** Cleans leftovers from a previously crashed run (called from global setup). */
export async function cleanupStaleManifest(): Promise<void> {
  if (!fs.existsSync(MANIFEST)) return
  try {
    const { world } = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as Manifest
    await purge(world)
    console.log('[atlas-e2e] purged leftovers from a previous interrupted run')
  } catch (error) {
    console.warn(`[atlas-e2e] stale manifest cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    fs.rmSync(MANIFEST, { force: true })
  }
}

async function seedOrg(
  label: string,
  suffix: string,
  password: string,
): Promise<OrgGraph> {
  const email = `e2e-${label}-${suffix}@atlas-e2e.invalid`
  const fullName = `E2E Analyst ${label.toUpperCase()}`
  const userId = await adminCreateUser(email, password)

  const [org] = await adminRest<{ id: string }>('organizations', {
    method: 'POST',
    body: {
      name: `Atlas E2E Org ${label.toUpperCase()}`,
      slug: slug(label, suffix),
      // Organization-tier matching configuration. The URL points at a
      // non-routable host that the local-provider E2E intercepts with
      // page.route — the app performs a REAL fetch against it.
      matching_provider_url: `https://atlas-e2e-matcher-${suffix}.invalid/v1/match`,
    },
    prefer: 'return=representation',
  })

  await adminRest('users', {
    method: 'POST',
    body: { user_id: userId, full_name: fullName, email, organization_id: org.id },
  })
  await adminRest('organization_members', {
    method: 'POST',
    body: { organization_id: org.id, user_id: userId, role: 'analyst' },
  })

  const [investigation] = await adminRest<{ id: string }>('investigations', {
    method: 'POST',
    body: {
      organization_id: org.id,
      created_by: userId,
      title: `Atlas E2E investigation ${label} ${suffix}`,
      description: 'Seeded by the hosted E2E harness; deleted afterwards.',
      status: 'active',
      risk_level: 'low',
    },
    prefer: 'return=representation',
  })

  const subjects = await adminRest<{ id: string; authorization_state: string }>('subjects', {
    method: 'POST',
    body: [
      {
        investigation_id: investigation.id,
        label: `Authorized subject ${label}`,
        authorization_state: 'authorized',
        authorization_basis: 'E2E seed: written consent on file',
        identity_state: 'unresolved',
      },
      {
        investigation_id: investigation.id,
        label: `Restricted subject ${label}`,
        authorization_state: 'restricted',
        authorization_basis: 'E2E seed: legal hold',
        identity_state: 'candidate',
      },
    ],
    prefer: 'return=representation',
  })
  const subjectAuthorizedId = subjects.find((s) => s.authorization_state === 'authorized')!.id
  const subjectRestrictedId = subjects.find((s) => s.authorization_state === 'restricted')!.id

  const [profile] = await adminRest<{ id: string }>('intelligence_profiles', {
    method: 'POST',
    body: {
      subject_id: subjectAuthorizedId,
      canonical_name: `Authorized subject ${label}`,
      summary: 'Hosted E2E seed profile',
      identity_state: 'candidate',
      confidence_score: 0.5,
    },
    prefer: 'return=representation',
  })

  const [fact] = await adminRest<{ id: string }>('intelligence_facts', {
    method: 'POST',
    body: {
      intelligence_profile_id: profile.id,
      category: 'public_profile',
      label: 'Public profile',
      value: 'example.org/e2e-seed',
      confidence: 0.8,
      source_count: 1,
      verification_status: 'corroborated',
      origin: 'source_fact',
    },
    prefer: 'return=representation',
  })

  const sourceUrl = `https://e2e-${label}-${suffix}.example.org/article`
  const [source] = await adminRest<{ id: string }>('sources', {
    method: 'POST',
    body: {
      organization_id: org.id,
      provider: 'public_web_search',
      source_name: `E2E source ${label}`,
      canonical_url: sourceUrl,
      original_url: `${sourceUrl}?utm_source=e2e`,
      source_type: 'web_search',
      credibility_score: 0.7,
      content_hash: crypto.randomUUID().replaceAll('-', '').repeat(2),
    },
    prefer: 'return=representation',
  })

  const [run] = await adminRest<{ id: string }>('search_runs', {
    method: 'POST',
    body: {
      investigation_id: investigation.id,
      subject_id: subjectAuthorizedId,
      initiated_by: userId,
      query: `E2E query ${label} ${suffix}`,
      channel: 'web',
      provider: 'public_web_search',
    },
    prefer: 'return=representation',
  })

  const [evidence] = await adminRest<{ id: string }>('evidence_items', {
    method: 'POST',
    body: {
      investigation_id: investigation.id,
      subject_id: subjectAuthorizedId,
      source_id: source.id,
      fact_id: fact.id,
      claim: `Seeded evidence claim for ${label}`,
      confidence: 0.6,
      evidence_type: 'web_page',
    },
    prefer: 'return=representation',
  })

  const [retrieval] = await adminRest<{ id: string }>('source_retrievals', {
    method: 'POST',
    body: {
      organization_id: org.id,
      source_id: source.id,
      search_run_id: run.id,
    },
    prefer: 'return=representation',
  })

  // Organization-tier OSINT configuration: a credentialless connector
  // endpoint the local-provider E2E intercepts with page.route. The app
  // performs a REAL fetch against it through the public-information seam.
  const osintProviderUrl = `https://atlas-e2e-osint-${suffix}.invalid/v1/search`
  const [connector] = await adminRest<{ id: string }>('connectors', {
    method: 'POST',
    body: {
      organization_id: org.id,
      provider: `e2e-osint-${label}`,
      category: 'public_information',
      status: 'connected',
      endpoint_url: osintProviderUrl,
      description: 'Seeded public-information connector for hosted E2E',
      authorization_status: 'authorized',
    },
    prefer: 'return=representation',
  })

  const [candidate] = await adminRest<{ id: string }>('identity_candidates', {
    method: 'POST',
    body: {
      subject_id: subjectRestrictedId,
      provider: 'public_web_search',
      external_reference: `e2e-${label}-${suffix}`,
      display_name: `Candidate on restricted subject ${label}`,
      match_confidence: 0.42,
    },
    prefer: 'return=representation',
  })

  const storagePrefix = `investigations/${investigation.id}/`
  const [mediaAsset] = await adminRest<{ id: string }>('media_assets', {
    method: 'POST',
    body: {
      organization_id: org.id,
      investigation_id: investigation.id,
      uploaded_by: userId,
      storage_path: `${storagePrefix}seed-${suffix}.bin`,
      media_type: 'application/octet-stream',
      metadata: { seededBy: 'atlas-e2e' },
    },
    prefer: 'return=representation',
  })

  return {
    label,
    userId,
    userEmail: email,
    fullName,
    orgId: org.id,
    matchingProviderUrl: `https://atlas-e2e-matcher-${suffix}.invalid/v1/match`,
    osintProviderUrl,
    connectorId: connector.id,
    investigationId: investigation.id,
    subjectAuthorizedId,
    subjectRestrictedId,
    profileId: profile.id,
    factId: fact.id,
    sourceId: source.id,
    sourceUrl,
    searchRunQueuedId: run.id,
    evidenceId: evidence.id,
    retrievalId: retrieval.id,
    candidateRestrictedSubjectId: candidate.id,
    mediaAssetId: mediaAsset.id,
    storagePrefix,
  }
}

/**
 * Seeds both organizations. Returns the world plus an idempotent cleanup().
 * The manifest is written BEFORE tests run so even a hard crash leaves
 * enough state for the next run to purge leftovers.
 */
export async function seedTwoOrgs(password: string): Promise<{
  world: SeededWorld
  cleanup: () => Promise<void>
}> {
  const suffix = randSuffix()
  const world: SeededWorld = {
    ranAt: new Date().toISOString(),
    password,
    a: await seedOrg('a', suffix, password),
    b: await seedOrg('b', suffix, password),
  }

  fs.writeFileSync(MANIFEST, JSON.stringify({ world } satisfies Manifest))

  let cleaned = false
  const cleanup = async (): Promise<void> => {
    if (cleaned) return
    cleaned = true
    try {
      await purge(world)
    } finally {
      fs.rmSync(MANIFEST, { force: true })
    }
  }
  return { world, cleanup }
}
