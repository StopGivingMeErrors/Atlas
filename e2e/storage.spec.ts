/**
 * Hosted Storage E2E (seeded mode): exercises the REAL Supabase Storage
 * service through the official browser client with the signed-in user's JWT,
 * following MediaStorageService's bucket and path conventions
 * ('media-assets' / investigations/<id>/...).
 *
 * If the operator has not provisioned the bucket, tests report
 * STORAGE_BUCKET_NOT_PROVISIONED as their skip reason and only the honest
 * negative probe runs - no fabricated coverage.
 */
import type { Page } from '@playwright/test'
import { expect, test, requireWorld } from './fixtures'
import { BUCKET_NAME, pageSupabase } from './helpers/hosted'
import { signInViaUi } from './helpers/ui'

/** Tri-state: true (usable), false (present but denied), null (absent/unreachable). */
async function probeBucket(page: Page): Promise<boolean | null> {
  const sb = await pageSupabase(page)
  try {
    const listed = await sb.run<unknown[]>(
      'bucket list probe',
      `(client) => client.storage.from(${JSON.stringify(BUCKET_NAME)}).list('', { limit: 1 })`,
    )
    return Array.isArray(listed)
  } catch {
    return null
  }
}

test.describe('hosted storage', () => {
  test('missing bucket produces a clean, honest failure (never silent success)', async ({ world, page }) => {
    const w = await requireWorld(world)
    await signInViaUi(page, w.a.userEmail, w.password)

    const status = await probeBucket(page)
    if (status !== null) {
      // Bucket IS provisioned: this test then only asserts the probe itself works.
      expect(status).toBe(true)
      return
    }

    // Unprovisioned: an attempted upload must surface a real Storage error.
    const sb = await pageSupabase(page)
    const result = await sb.run<{ error: string | null }>(
      'unprovisioned upload probe',
      `(client) => client.storage.from(${JSON.stringify(BUCKET_NAME)})
        .upload('investigations/probe.png', new Uint8Array([1]), { contentType: 'image/png' })
        .then(r => ({ error: r.error ? r.error.message : null }))`,
    )
    expect(result.error).not.toBeNull()
    test.info().annotations.push({ type: 'note', description: 'STORAGE_BUCKET_NOT_PROVISIONED — negative path verified only' })
  })

  test('upload -> media_assets lineage -> signed retrieval (own org)', async ({ world, page }) => {
    const w = await requireWorld(world)
    await signInViaUi(page, w.a.userEmail, w.password)

    if ((await probeBucket(page)) !== true) {
      test.skip(true, 'STORAGE_BUCKET_NOT_PROVISIONED — apply scripts/hosted-storage-setup.sql on the hosted project')
    }

    const path = `${w.a.storagePrefix}probe-${Date.now()}.png`
    const sb = await pageSupabase(page)
    try {
      const uploaded = await sb.run<{ error: string | null }>(
        'storage upload',
        `(client) => client.storage.from(${JSON.stringify(BUCKET_NAME)})
          .upload(${JSON.stringify(path)}, new Uint8Array([137,80,78,71,13,10,26,10]), { contentType: 'image/png' })
          .then(r => ({ error: r.error ? r.error.message : null }))`,
      )
      expect(uploaded.error).toBeNull()

      // media_assets row records lineage (RLS-scoped to own org).
      const row = await sb.run<Array<{ id: string }>>(
        'media asset row insert',
        `(client) => client.from('media_assets')
          .insert({
            organization_id: ${JSON.stringify(w.a.orgId)},
            investigation_id: ${JSON.stringify(w.a.investigationId)},
            uploaded_by: ${JSON.stringify(w.a.userId)},
            storage_path: ${JSON.stringify(path)},
            media_type: 'image/png'
          })
          .select('id')`,
      )
      expect(row).toHaveLength(1)

      // Signed retrieval round-trips through the real Storage service.
      const fetched = await sb.run<{ ok: boolean; bytes: number }>(
        'signed url fetch',
        `(client) => client.storage.from(${JSON.stringify(BUCKET_NAME)})
          .createSignedUrl(${JSON.stringify(path)}, 60)
          .then(async r => {
            if (r.error) return { ok: false, bytes: 0 }
            const res = await fetch(r.data.signedUrl)
            return { ok: res.ok, bytes: res.ok ? (await res.arrayBuffer()).byteLength : 0 }
          })`,
      )
      expect(fetched.ok).toBe(true)
      expect(fetched.bytes).toBe(8)
    } finally {
      await sb.run('object cleanup', `(client) =>
        client.storage.from(${JSON.stringify(BUCKET_NAME)}).remove([${JSON.stringify(path)}])`)
    }
  })

  test('cross-org object access denied; anonymous access denied', async ({ world, page, browser }) => {
    const w = await requireWorld(world)
    await signInViaUi(page, w.a.userEmail, w.password)

    if ((await probeBucket(page)) !== true) {
      test.skip(true, 'STORAGE_BUCKET_NOT_PROVISIONED — apply scripts/hosted-storage-setup.sql on the hosted project')
    }

    const markerPath = `${w.a.storagePrefix}seed-isolation.bin`
    const sbA = await pageSupabase(page)
    await sbA.run('orgA marker upload', `(client) =>
      client.storage.from(${JSON.stringify(BUCKET_NAME)})
        .upload(${JSON.stringify(markerPath)}, new TextEncoder().encode('org-a-secret'), { contentType: 'text/plain', upsert: true })`)

    try {
      const contextB = await browser.newContext()
      const pageB = await contextB.newPage()
      try {
        await signInViaUi(pageB, w.b.userEmail, w.password)
        const sbB = await pageSupabase(pageB)
        const foreignList = await sbB.run<Array<{ name?: string }> | { error: string }>(
          'orgB foreign list attempt',
          `(client) => client.storage.from(${JSON.stringify(BUCKET_NAME)}).list(${JSON.stringify(`investigations/${w.a.investigationId}`)}).then(r => r.error ? { error: r.error.message } : r.data)`,
        )
        const fileName = markerPath.split('/').pop() as string
        if (Array.isArray(foreignList)) {
          expect(foreignList.map((o) => o.name)).not.toContain(fileName)
        } else {
          expect(foreignList.error).toBeTruthy()
        }
      } finally {
        await contextB.close()
      }

      const anonContext = await browser.newContext()
      const anonPage = await anonContext.newPage()
      try {
        const sbAnon = await pageSupabase(anonPage)
        const result = await sbAnon.run<{ ok: boolean; status: number }>(
          'anon signed-url attempt',
          `(client) => client.storage.from(${JSON.stringify(BUCKET_NAME)})
            .createSignedUrl(${JSON.stringify(markerPath)}, 30)
            .then(async r => {
              if (r.error) return { ok: false, status: 403 }
              const res = await fetch(r.data.signedUrl)
              return { ok: res.ok, status: res.status }
            })`,
        )
        expect(result.ok, `anonymous access returned ${result.status}`).toBe(false)
      } finally {
        await anonContext.close()
      }
    } finally {
      await sbA.run('marker cleanup', `(client) =>
        client.storage.from(${JSON.stringify(BUCKET_NAME)}).remove([${JSON.stringify(markerPath)}])`)
    }
  })
})
