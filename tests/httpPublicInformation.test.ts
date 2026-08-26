// @vitest-environment node
/**
 * Public information / OSINT WIRE CONTRACT tests.
 *
 * These run the real HTTP transport (searchViaHttp) against a REAL local
 * HTTP server (node:http) — no fetch mocks. Every deterministic provider
 * behavior has a scripted counterpart: valid payloads, malformed JSON,
 * schema violations (unknown fields, oversized values, unknown fact
 * categories), wrong contract version, correlation mismatch, auth
 * failures, rate limits, server errors, timeouts, and unreachable hosts.
 *
 * This is NOT a claim that a real external provider was verified — it
 * proves the boundary behaves correctly for each observable provider class.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { searchViaHttp } from '../src/services/providers/httpPublicInformation'

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
    correlation_id: 'corr-osint-7',
    provider_name: 'TestOSINT',
    results: [
      {
        result_id: 'res-1',
        display_name: 'Jordan Ellis',
        summary: 'Public records summary',
        confidence: 0.9,
        facts: [
          { category: 'employment', label: 'Employer', value: 'Acme Corp', confidence: 0.8 },
        ],
        sources: [
          {
            url: 'https://example.com/jordan-ellis',
            title: 'Jordan Ellis - Profile',
            source_type: 'professional_profile',
            published_at: '2024-03-01T00:00:00Z',
            credibility: 0.7,
          },
        ],
      },
    ],
    ...overrides,
  }
}

const closeFns: Array<() => Promise<void>> = []
afterAll(async () => {
  for (const close of closeFns) await close()
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
  return { fullName: 'Jordan Ellis', correlationId: 'corr-osint-7' }
}

describe('public information wire contract v1 (real local HTTP)', () => {
  it('parses a schema-valid response into normalized provider results', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(validPayload()))
      },
      async (url) => {
        const outcome = await searchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('ok')
        if (outcome.status !== 'ok') return
        expect(outcome.correlationId).toBe('corr-osint-7')
        expect(outcome.providerName).toBe('TestOSINT')
        expect(outcome.results).toHaveLength(1)
        const result = outcome.results[0]
        if (result === undefined) return
        expect(result.resultId).toBe('res-1')
        expect(result.displayName).toBe('Jordan Ellis')
        expect(result.confidence).toBe(0.9)
        expect(result.facts).toEqual([
          { category: 'employment', label: 'Employer', value: 'Acme Corp', confidence: 0.8 },
        ])
        expect(result.sources).toHaveLength(1)
        expect(result.sources[0]).toMatchObject({
          url: 'https://example.com/jordan-ellis',
          title: 'Jordan Ellis - Profile',
          sourceType: 'professional_profile',
          publishedAt: '2024-03-01T00:00:00Z',
          credibility: 0.7,
        })
      },
    )
  })

  it('preserves absence of optional scores as null (no fabricated confidence)', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify(
            validPayload({
              results: [
                {
                  result_id: 'res-2',
                  display_name: 'Jordan Ellis',
                  facts: [{ category: 'education', label: 'Alma mater', value: 'State U' }],
                  sources: [
                    { url: 'https://news.example.org/story', title: 'Story' },
                  ],
                },
              ],
            }),
          ),
        )
      },
      async (url) => {
        const outcome = await searchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('ok')
        if (outcome.status !== 'ok') return
        const result = outcome.results[0]
        if (result === undefined) return
        expect(result.confidence).toBeNull()
        expect(result.summary).toBeNull()
        expect(result.facts[0]?.confidence).toBeNull()
        expect(result.sources[0]?.credibility).toBeNull()
        expect(result.sources[0]?.sourceType).toBeNull()
        expect(result.sources[0]?.publishedAt).toBeNull()
      },
    )
  })

  it('treats an empty result list as ok (provider found nothing is not an error)', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(validPayload({ results: [] })))
      },
      async (url) => {
        const outcome = await searchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('ok')
        if (outcome.status !== 'ok') return
        expect(outcome.results).toEqual([])
      },
    )
  })

  it('sends ONLY contract_version, correlation_id and full_name across the wire', async () => {
    let seenBody = ''
    await withProvider(
      (req, res, body) => {
        seenBody = body.toString('utf8')
        void req
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(validPayload()))
      },
      async (url) => {
        await searchViaHttp(url, baseRequest())
        const parsedBody: unknown = JSON.parse(seenBody)
        expect(parsedBody).toEqual({
          contract_version: 1,
          correlation_id: 'corr-osint-7',
          full_name: 'Jordan Ellis',
        })
        for (const forbidden of ['profile_id', 'subject_id', 'organization', 'user', 'authorization']) {
          expect(seenBody.toLowerCase()).not.toContain(forbidden)
        }
      },
    )
  })

  it('classifies non-JSON bodies as invalid_response', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('<html>blocked by waf</html>')
      },
      async (url) => {
        const outcome = await searchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('invalid_response')
        if (outcome.status !== 'invalid_response') return
        expect(outcome.message).toContain('JSON')
      },
    )
  })

  it('rejects unknown top-level fields (strict contract enforcement)', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ...validPayload(), internal_notes: 'leak attempt' }))
      },
      async (url) => {
        const outcome = await searchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('invalid_response')
      },
    )
  })

  it('rejects unknown fields inside facts, sources and results', async () => {
    for (const mutation of [
      (): unknown =>
        validPayload({
          results: [
            {
              ...validPayload().results[0],
              facts: [
                ...(validPayload().results[0] as { facts: unknown[] }).facts,
                { category: 'employment', label: 'X', value: 'Y', raw_row: 'nope' },
              ],
            },
          ],
        }),
      (): unknown =>
        validPayload({
          results: [
            {
              ...validPayload().results[0],
              sources: [
                { ...(validPayload().results[0] as { sources: Array<Record<string, unknown>> }).sources[0], internal_rank: 5 },
              ],
            },
          ],
        }),
      (): unknown =>
        validPayload({
          results: [
            { ...validPayload().results[0], debug_trace: ['step'] },
          ],
        }),
    ]) {
      await withProvider(
        (_req, res) => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(mutation()))
        },
        async (url) => {
          const outcome = await searchViaHttp(url, baseRequest())
          expect(outcome.status).toBe('invalid_response')
        },
      )
    }
  })

  it('rejects fact categories outside the database-aligned enum', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify(
            validPayload({
              results: [
                {
                  result_id: 'r',
                  display_name: 'J',
                  facts: [{ category: 'criminal_record', label: 'Offense', value: 'x' }],
                },
              ],
            }),
          ),
        )
      },
      async (url) => {
        const outcome = await searchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('invalid_response')
      },
    )
  })

  it('rejects malformed dates rather than coercing them', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify(
            validPayload({
              results: [
                {
                  result_id: 'r',
                  display_name: 'J',
                  published_at: 'sometime last spring',
                },
              ],
            }),
          ),
        )
      },
      async (url) => {
        const outcome = await searchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('invalid_response')
      },
    )
  })

  it('rejects oversized payloads (bounded arrays and strings)', async () => {
    // >25 results exceeds the array bound.
    const manyResults = Array.from({ length: 26 }, (_, i) => ({
      result_id: `r${i}`,
      display_name: 'J',
    }))
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(validPayload({ results: manyResults })))
      },
      async (url) => {
        const outcome = await searchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('invalid_response')
      },
    )
    // A source URL beyond 2048 characters is rejected.
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify(
            validPayload({
              results: [
                {
                  result_id: 'r',
                  display_name: 'J',
                  sources: [{ url: `https://example.com/${'a'.repeat(2100)}`, title: 'Big' }],
                },
              ],
            }),
          ),
        )
      },
      async (url) => {
        const outcome = await searchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('invalid_response')
      },
    )
  })

  it('rejects an unsupported contract version', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(validPayload({ contract_version: 999 })))
      },
      async (url) => {
        const outcome = await searchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('invalid_response')
      },
    )
  })

  it('rejects a response whose correlation id does not echo the request', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(validPayload({ correlation_id: 'someone-else' })))
      },
      async (url) => {
        const outcome = await searchViaHttp(url, baseRequest())
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
          const outcome = await searchViaHttp(url, baseRequest())
          expect(outcome.status).toBe('auth_failed')
        },
      )
    }
  })

  it('maps 429 to rate_limited', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(429, { 'content-type': 'text/plain' })
        res.end('quota exhausted')
      },
      async (url) => {
        const outcome = await searchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('rate_limited')
      },
    )
  })

  it('maps other error statuses to provider_error', async () => {
    await withProvider(
      (_req, res) => {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('upstream exploded')
      },
      async (url) => {
        const outcome = await searchViaHttp(url, baseRequest())
        expect(outcome.status).toBe('provider_error')
      },
    )
  })

  it('classifies a stalled server as timeout', async () => {
    await withProvider(
      (_req, res) => {
        void res // never respond; the client aborts
      },
      async (url) => {
        const started = Date.now()
        const outcome = await searchViaHttp(url, baseRequest(), { timeoutMs: 250 })
        expect(outcome.status).toBe('timeout')
        expect(Date.now() - started).toBeLessThan(5000)
      },
    )
  })

  it('classifies connection refusal as network', async () => {
    const outcome = await searchViaHttp('http://127.0.0.1:9/v1/search', baseRequest(), {
      timeoutMs: 2000,
    })
    expect(outcome.status).toBe('network')
  })
})
