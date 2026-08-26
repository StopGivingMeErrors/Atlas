import { z } from 'zod'

/**
 * External identity matching provider contract — VERSION 1.
 *
 * This is the ONLY module that knows the wire format. Everything upstream
 * (orchestration, persistence, UI) works with typed outcomes; nothing
 * unvalidated ever becomes an identity_candidate.
 *
 * SECURITY MODEL
 * --------------
 * The browser talks to exactly one of two endpoint kinds:
 *
 *  1. organization endpoint (organizations.matching_provider_url):
 *     a CREDENTIALLESS public HTTPS endpoint. It MUST NOT require an API
 *     key, because the URL is readable by every member of the organization
 *     through normal client data. Nothing is sent except what is listed
 *     below — never user or organization metadata.
 *
 *  2. deployment proxy (VITE_ATLAS_IDENTITY_MATCHING_PROXY_ENDPOINT):
 *     a server-side boundary (e.g. a Supabase Edge Function) that holds the
 *     real provider secret in ITS OWN environment. The browser authenticates
 *     to the proxy with the user's Supabase JWT; the proxy attaches
 *     credentials to the upstream call server-side.
 *
 * API keys must NEVER be placed in VITE_* variables: everything prefixed
 * VITE_ is compiled into the public browser bundle.
 */

export const IDENTITY_MATCHING_CONTRACT_VERSION = 1

/** Normalized face box within the frame (fractions of width/height). */
export const faceBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
})

export interface IdentityMatchRequest {
  /** JPEG bytes of the analyzed frame. */
  imageBlob: Blob
  frameWidth: number
  frameHeight: number
  correlationId: string
  faceBox?: z.infer<typeof faceBoxSchema>
  trackRef?: string
}

/**
 * One candidate EXACTLY as the provider supplied it (after schema
 * validation). This is deliberately NOT the internal IdentityCandidate:
 * no database ids, no subject binding, no status — those are ours.
 */
export interface ProviderCandidate {
  providerCandidateId: string
  externalReference: string
  displayName: string
  /** Present only when the provider supplied a score. */
  score: number | null
  signals: string[]
  /** Canonical JSON of the validated raw object — fingerprint input. */
  rawJson: string
}

const externalCandidateSchema = z
  .object({
    provider_candidate_id: z.string().min(1),
    external_reference: z.string().min(1),
    display_name: z.string().min(1),
    score: z.number().min(0).max(1),
    signals: z.array(z.string()).default([]),
  })
  .strict()

const externalResponseSchema = z
  .object({
    contract_version: z.literal(IDENTITY_MATCHING_CONTRACT_VERSION),
    correlation_id: z.string().min(1),
    candidates: z.array(externalCandidateSchema).max(50),
  })
  .strict()

export type IdentityMatchOutcome =
  | { status: 'ok'; correlationId: string; candidates: ProviderCandidate[] }
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

/**
 * Real HTTP transport for the identity matching contract. Deterministic
 * failure behavior:
 *
 *   timeout            - no response within `timeoutMs` (AbortController)
 *   network            - request could not be delivered / connection failed
 *   auth_failed        - upstream answered 401 or 403
 *   rate_limited       - upstream answered 429
 *   provider_error     - any other non-2xx status
 *   invalid_response   - non-JSON body, wrong contract version, unknown
 *                        fields, or a candidate failing validation
 *   ok                 - schema-valid response (candidates may be empty)
 */
export async function matchViaHttp(
  endpoint: string,
  request: IdentityMatchRequest,
  options: { timeoutMs?: number } = {},
): Promise<IdentityMatchOutcome> {
  const timeoutMs = options.timeoutMs ?? 15000

  const formData = new FormData()
  // Exactly these fields cross the wire. No user ids, no org ids, no
  // internal media/subject identifiers.
  formData.append('contract_version', String(IDENTITY_MATCHING_CONTRACT_VERSION))
  formData.append('correlation_id', request.correlationId)
  formData.append('image', request.imageBlob, 'frame.jpg')
  formData.append('frame_width', String(request.frameWidth))
  formData.append('frame_height', String(request.frameHeight))
  if (request.faceBox !== undefined) {
    formData.append('face_box', JSON.stringify(request.faceBox))
  }
  if (request.trackRef !== undefined) {
    formData.append('track_ref', request.trackRef)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(endpoint, { method: 'POST', body: formData, signal: controller.signal })
  } catch (error) {
    clearTimeout(timer)
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { status: 'timeout', message: 'No response within the time limit.', correlationId: request.correlationId }
    }
    return {
      status: 'network',
      message: error instanceof Error ? error.message : String(error),
      correlationId: request.correlationId,
    }
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
      return { status: 'auth_failed', message: `HTTP ${response.status}: ${detail}`, correlationId: request.correlationId }
    }
    if (response.status === 429) {
      return { status: 'rate_limited', message: `HTTP 429: ${detail}`, correlationId: request.correlationId }
    }
    return { status: 'provider_error', message: `HTTP ${response.status}: ${detail}`, correlationId: request.correlationId }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    return {
      status: 'invalid_response',
      message: `Body was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      correlationId: request.correlationId,
    }
  }

  const parsed = externalResponseSchema.safeParse(payload)
  if (!parsed.success) {
    return {
      status: 'invalid_response',
      message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500),
      correlationId: request.correlationId,
    }
  }

  if (parsed.data.correlation_id !== request.correlationId) {
    return {
      status: 'invalid_response',
      message: 'Response correlation id does not match the request.',
      correlationId: request.correlationId,
    }
  }

  return {
    status: 'ok',
    correlationId: parsed.data.correlation_id,
    candidates: parsed.data.candidates.map((candidate) => ({
      providerCandidateId: candidate.provider_candidate_id,
      externalReference: candidate.external_reference,
      displayName: candidate.display_name,
      score: candidate.score,
      signals: candidate.signals,
      rawJson: canonicalJson(candidate),
    })),
  }
}
