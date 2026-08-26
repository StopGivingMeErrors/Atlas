import { z } from 'zod'

/**
 * External public-information provider contract - VERSION 1.
 *
 * This is the ONLY module that knows the OSINT wire format. Everything
 * upstream (orchestration, persistence, UI) works with typed outcomes;
 * nothing unvalidated ever becomes a source or an intelligence fact.
 *
 * SECURITY MODEL (mirrors httpIdentityMatching.ts)
 * ------------------------------------------------
 * The browser talks to exactly one of two endpoint kinds:
 *
 *  1. organization connector endpoint (connectors.endpoint_url):
 *     a CREDENTIALLESS public HTTPS endpoint. It MUST NOT require an API
 *     key, because connector rows are readable by every member of the
 *     organization through normal client data access.
 *
 *  2. deployment proxy (VITE_ATLAS_PUBLIC_INFORMATION_PROXY_ENDPOINT):
 *     a server-side boundary (e.g. a Supabase Edge Function) that holds
 *     the real provider secret in ITS OWN environment. The browser
 *     authenticates to the proxy with the user's Supabase JWT; the proxy
 *     attaches credentials to the upstream call server-side.
 *
 * API keys must NEVER be placed in VITE_* variables: everything prefixed
 * VITE_ is compiled into the public browser bundle.
 *
 * MINIMUM AUTHORIZED INPUT
 * ------------------------
 * Exactly these fields cross the wire, never more:
 *   contract_version, correlation_id, full_name
 * No user ids, no org ids, no investigation/subject/profile identifiers,
 * no authorization metadata. The provider performs PUBLIC lookups against
 * a person's name; internal Atlas identity is none of its business.
 */

export const PUBLIC_INFORMATION_CONTRACT_VERSION = 1

/** Research channels Atlas routes to a public-information provider. */
export const PUBLIC_INFORMATION_CHANNELS = [
  'professional_profile',
  'news',
  'public_website',
  'org_registry',
  'org_dataset',
] as const

export type PublicInformationChannel = (typeof PUBLIC_INFORMATION_CHANNELS)[number]

export interface PublicInformationRequest {
  /** Canonical name of the AUTHORIZED subject under research. */
  fullName: string
  correlationId: string
}

/**
 * One provider-supplied fact/attribute. `confidence` survives ONLY when
 * the provider explicitly supplied it - absence stays absence.
 */
export interface ProviderFact {
  category: string
  label: string
  value: string
  confidence: number | null
}

/** One provider-supplied source/reference (URL + metadata, no content). */
export interface ProviderSource {
  url: string
  title: string
  sourceType: string | null
  publishedAt: string | null
  credibility: number | null
}

/**
 * One result EXACTLY as the provider supplied it (after schema
 * validation). Deliberately NOT any internal Atlas type: no database
 * ids, no subject/profile binding, no authorization state.
 */
export interface ProviderResult {
  resultId: string
  displayName: string
  summary: string | null
  /** Provider-supplied publication date for the result itself. */
  publishedAt: string | null
  /** Provider-supplied retrieval timestamp (we still record our own). */
  retrievedAt: string | null
  /** Present only when the provider explicitly supplied a score. */
  confidence: number | null
  facts: ProviderFact[]
  sources: ProviderSource[]
  /** Canonical JSON of the validated raw object - fingerprint input. */
  rawJson: string
}

const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be an ISO-8601 date/time')
  .refine((value) => /^\d{4}-\d{2}-\d{2}/.test(value), 'must be calendar-date formatted')

const externalFactSchema = z
  .object({
    // Aligned with the database fact_category enum so valid provider output
    // maps 1:1; anything else is a rejection, not a silent remap.
    category: z.enum([
      'employment',
      'education',
      'organization',
      'public_profile',
      'website',
      'publication',
      'social_presence',
      'location',
      'news_mention',
    ]),
    label: z.string().min(1).max(120),
    value: z.string().min(1).max(500),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict()

const externalSourceSchema = z
  .object({
    url: z.string().url().max(2048),
    title: z.string().min(1).max(300),
    source_type: z
      .enum(['web_search', 'professional_profile', 'news', 'org_registry', 'public_website', 'org_dataset'])
      .optional(),
    published_at: isoDateTime.optional(),
    credibility: z.number().min(0).max(1).optional(),
  })
  .strict()

const externalResultSchema = z
  .object({
    result_id: z.string().min(1).max(200),
    display_name: z.string().min(1).max(300),
    summary: z.string().max(2000).optional(),
    published_at: isoDateTime.optional(),
    retrieved_at: isoDateTime.optional(),
    confidence: z.number().min(0).max(1).optional(),
    facts: z.array(externalFactSchema).max(20).default([]),
    sources: z.array(externalSourceSchema).max(10).default([]),
  })
  .strict()

const externalResponseSchema = z
  .object({
    contract_version: z.literal(PUBLIC_INFORMATION_CONTRACT_VERSION),
    correlation_id: z.string().min(1),
    // Provider self-identification. Stored as METADATA only: durable DB
    // provenance records the configured endpoint host, which the
    // organization actually chose - never a self-reported label.
    provider_name: z.string().min(1).max(100),
    provider_version: z.string().max(50).optional(),
    results: z.array(externalResultSchema).max(25),
  })
  .strict()

export type PublicInformationOutcome =
  | {
      status: 'ok'
      correlationId: string
      providerName: string
      providerVersion: string | null
      results: ProviderResult[]
    }
  | {
      status: 'timeout' | 'rate_limited' | 'auth_failed' | 'provider_error' | 'invalid_response' | 'network'
      message: string
      correlationId: string
    }

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
  return `{${entries.join(',')}}`
}

function failure(
  status: Exclude<PublicInformationOutcome['status'], 'ok'>,
  message: string,
  correlationId: string,
): PublicInformationOutcome {
  return { status, message, correlationId }
}

/**
 * Real HTTP transport for the public-information contract. Deterministic
 * failure behavior:
 *
 *   timeout            - no response within `timeoutMs` (AbortController)
 *   network            - request could not be delivered / connection failed
 *   auth_failed        - upstream answered 401 or 403
 *   rate_limited       - upstream answered 429
 *   provider_error     - any other non-2xx status
 *   invalid_response   - non-JSON body, wrong contract version, unknown
 *                        fields, oversized payloads, or any result/fact/
 *                        source failing validation
 *   ok                 - schema-valid response (results may be empty)
 */
export async function searchViaHttp(
  endpoint: string,
  request: PublicInformationRequest,
  options: { timeoutMs?: number } = {},
): Promise<PublicInformationOutcome> {
  const timeoutMs = options.timeoutMs ?? 15000

  // Exactly these fields cross the wire.
  const body = JSON.stringify({
    contract_version: PUBLIC_INFORMATION_CONTRACT_VERSION,
    correlation_id: request.correlationId,
    full_name: request.fullName,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    if (error instanceof DOMException && error.name === 'AbortError') {
      return failure('timeout', 'No response within the time limit.', request.correlationId)
    }
    return failure('network', error instanceof Error ? error.message : String(error), request.correlationId)
  }
  clearTimeout(timer)

  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 500)
    } catch {
      detail = ''
    }
    if (response.status === 401 || response.status === 403) {
      return failure('auth_failed', `HTTP ${response.status}: ${detail}`, request.correlationId)
    }
    if (response.status === 429) {
      return failure('rate_limited', `HTTP 429: ${detail}`, request.correlationId)
    }
    return failure('provider_error', `HTTP ${response.status}: ${detail}`, request.correlationId)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    return failure(
      'invalid_response',
      `Body was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      request.correlationId,
    )
  }

  const parsed = externalResponseSchema.safeParse(payload)
  if (!parsed.success) {
    return failure(
      'invalid_response',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500),
      request.correlationId,
    )
  }

  if (parsed.data.correlation_id !== request.correlationId) {
    return failure('invalid_response', 'Response correlation id does not match the request.', request.correlationId)
  }

  return {
    status: 'ok',
    correlationId: parsed.data.correlation_id,
    providerName: parsed.data.provider_name,
    providerVersion: parsed.data.provider_version ?? null,
    results: parsed.data.results.map((result) => ({
      resultId: result.result_id,
      displayName: result.display_name,
      summary: result.summary ?? null,
      publishedAt: result.published_at ?? null,
      retrievedAt: result.retrieved_at ?? null,
      confidence: result.confidence ?? null,
      facts: result.facts.map((fact) => ({
        category: fact.category,
        label: fact.label,
        value: fact.value,
        confidence: fact.confidence ?? null,
      })),
      sources: result.sources.map((source) => ({
        url: source.url,
        title: source.title,
        sourceType: source.source_type ?? null,
        publishedAt: source.published_at ?? null,
        credibility: source.credibility ?? null,
      })),
      rawJson: canonicalJson(result),
    })),
  }
}
