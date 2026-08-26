// @vitest-environment node
/**
 * External identity matching WIRE CONTRACT tests.
 *
 * These run the real HTTP transport (matchViaHttp) against a REAL local
 * HTTP server (node:http) — no fetch mocks. Every deterministic provider
 * behavior has a scripted counterpart: valid payloads, malformed JSON,
 * schema violations, wrong contract version, correlation mismatch, auth
 * failures, rate limits, server errors, timeouts, and unreachable hosts.
 *
 * This is NOT a claim that a real external provider was verified — it
 * proves the boundary behaves correctly for each observable provider class.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { matchViaHttp } from '../src/services/providers/httpIdentityMatching'

const IMAGE = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })

function startProvider(handler: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void) {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => handler(req, res, Buffer.concat(chunks)))
  })
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: 1,
    correlation_id: 'corr-42',
    candidates: [
      {
        provider_candidate_id: 'pc-77',
        external_reference: 'ext-abc',
        display_name: 'Jordan Ellis',
        score: 0.87,
        signals: ['face_embedding', 'name_exact'],
      },
    ],
    ...overrides,
  }
}

let closeFns: Array<() => Promise<void>> = []
afterAll(async () => {
  for (const close of closeFns) await close()
  closeFns = []
})

async function withProvider(
  handler: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void,
  run: (url: string) => Promise<void>,
) {
  const provider = await startProvider(handler)
  closeFns.push(provider.close)
  await run(provider.url)
}

function baseRequest() {
  return {
    imageBlob: IMAGE,
    frameWidth: 640,
    frameHeight: 480,
    correlationId: 'corr-42',
  }
}

describe('identity matching wire contract v1 (real local HTTP)', () => {
  it('parses a schema-valid response into normalized candidates + fingerprint input', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(validPayload()))
      },
      async (url) => {
        const outcome = await matchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('ok')
        if (outcome.status !== 'ok') return
        expect(outcome.correlationId).toBe('corr-42')
        expect(outcome.candidates).toHaveLength(1)
        const candidate = outcome.candidates[0]
        if (candidate === undefined) return
        expect(candidate.providerCandidateId).toBe('pc-77')
        expect(candidate.externalReference).toBe('ext-abc')
        expect(candidate.displayName).toBe('Jordan Ellis')
        expect(candidate.score).toBe(0.87)
        expect(candidate.signals).toEqual(['face_embedding', 'name_exact'])
        // Canonical JSON is deterministic regardless of upstream key order.
        expect(candidate.rawJson).toBe(
          '{"display_name":"Jordan Ellis","external_reference":"ext-abc","provider_candidate_id":"pc-77","score":0.87,"signals":["face_embedding","name_exact"]}',
        )
      },
    )
  })

  it('treats an empty candidate list as ok', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ contract_version: 1, correlation_id: 'corr-42', candidates: [] }))
      },
      async (url) => {
        const outcome = await matchViaHttp(url, baseRequest())
        expect(outcome).toMatchObject({ status: 'ok', candidates: [] })
      },
    )
  })

  it('sends ONLY the allowed multipart fields and nothing about user/org/subject', async () => {
    let seenBody = ''
    await withProvider(
      (req, res, body) => {
        seenBody = body.toString('latin1')
        void req
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ contract_version: 1, correlation_id: 'corr-42', candidates: [] }))
      },
      async (url) => {
        await matchViaHttp(url, {
          ...baseRequest(),
          faceBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
          trackRef: '12',
        }).catch(() => undefined)
        for (const forbidden of ['subject', 'organization', 'user_id', 'media_asset']) {
          expect(seenBody.toLowerCase()).not.toContain(forbidden)
        }
        for (const required of [
          'contract_version',
          'correlation_id',
          'frame_width',
          'frame_height',
          'face_box',
          'track_ref',
        ]) {
          expect(seenBody).toContain(required)
        }
      },
    )
  })

  it('classifies non-JSON bodies as invalid_response', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('<html>not json</html>')
      },
      async (url) => {
        const outcome = await matchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('invalid_response')
        if (outcome.status !== 'invalid_response') return
        expect(outcome.message).toContain('JSON')
      },
    )
  })

  it('rejects schema-invalid candidates (strict contract enforcement)', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            contract_version: 1,
            correlation_id: 'corr-42',
            candidates: [{ provider_candidate_id: 'pc-1' }],
          }),
        )
      },
      async (url) => {
        const outcome = await matchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('invalid_response')
      },
    )
  })

  it('rejects unknown top-level fields and unknown candidate fields', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ...validPayload(), surprise: true }))
      },
      async (url) => {
        const a = await matchViaHttp(url, baseRequest())
        expect(a.status).toBe('invalid_response')
      },
    )
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            contract_version: 1,
            correlation_id: 'corr-42',
            candidates: [{ ...validPayload().candidates[0], internal_db_row: 'nope' }],
          }),
        )
      },
      async (url) => {
        const b = await matchViaHttp(url, baseRequest())
        expect(b.status).toBe('invalid_response')
      },
    )
  })

  it('rejects an unsupported contract version', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(validPayload({ contract_version: 2 })))
      },
      async (url) => {
        const outcome = await matchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('invalid_response')
      },
    )
  })

  it('rejects a response whose correlation id does not echo the request', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(validPayload({ correlation_id: 'different' })))
      },
      async (url) => {
        const outcome = await matchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('invalid_response')
        if (outcome.status !== 'invalid_response') return
        expect(outcome.message).toContain('correlation')
      },
    )
  })

  it('maps 401 and 403 to auth_failed', async () => {
    for (const status of [401, 403]) {
      await withProvider(
        (_req, res) => {
          res.writeHead(status, { 'content-type': 'text/plain' })
          res.end('denied')
        },
        async (url) => {
          const outcome = await matchViaHttp(url, baseRequest())
          expect(outcome.status).toBe('auth_failed')
        },
      )
    }
  })

  it('maps 429 to rate_limited', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(429, { 'content-type': 'text/plain' })
        res.end('slow down')
      },
      async (url) => {
        const outcome = await matchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('rate_limited')
      },
    )
  })

  it('maps other error statuses to provider_error', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(503, { 'content-type': 'text/plain' })
        res.end('unavailable')
      },
      async (url) => {
        const outcome = await matchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('provider_error')
      },
    )
  })

  it('classifies a stalled server as timeout', async () => {
    await withProvider(
      (_req, res) => {
        // Never respond; the client aborts.
      },
      async (url) => {
        const started = Date.now()
        const outcome = await matchViaHttp(url, baseRequest(), { timeoutMs: 250 })
        expect(outcome.status).toBe('timeout')
        expect(Date.now() - started).toBeLessThan(5000)
      },
    )
  })

  it('classifies connection refusal as network', async () => {
    // Port 9 on 127.0.0.1 (discard protocol) is refused by the OS stack.
    const outcome = await matchViaHttp('http://127.0.0.1:9/match', baseRequest(), { timeoutMs: 2000 })
    expect(outcome.status).toBe('network')
  })
})
