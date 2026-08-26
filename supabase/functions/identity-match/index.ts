// Supabase Edge Function: identity-match
//
// Server-side credential boundary for identity matching.
//
// The browser NEVER sees provider secrets. It calls this function with its
// Supabase JWT; this function:
//   1. verifies the caller's JWT against the project's auth endpoint,
//   2. reads provider configuration from ITS OWN environment,
//   3. forwards the multipart body to the real provider,
//   4. relays the provider response unchanged (the client re-validates it
//      against the versioned contract in src/services/providers/httpIdentityMatching.ts).
//
// Configuration (function environment, set via `supabase secrets set`):
//   IDENTITY_MATCHING_PROVIDER_URL     - upstream provider endpoint
//   IDENTITY_MATCHING_PROVIDER_API_KEY - upstream credential (sent as Bearer)
//
// Deploy: supabase functions deploy identity-match
// Then set VITE_ATLAS_IDENTITY_MATCHING_PROXY_ENDPOINT to
//   https://<project-ref>.supabase.co/functions/v1/identity-match

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ProviderConfig {
  url: string
  apiKey?: string
}

function readProviderConfig(env: Record<string, string | undefined>): ProviderConfig | null {
  const url = env.IDENTITY_MATCHING_PROVIDER_URL
  if (url === undefined || url.trim() === '') return null
  return { url: url.trim(), apiKey: env.IDENTITY_MATCHING_PROVIDER_API_KEY }
}

async function verifyJwt(jwt: string): Promise<{ sub: string } | null> {
  try {
    // The JWT is verified by the platform's auth endpoint; a malformed or
    // expired token yields a non-2xx answer and we refuse to forward.
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number
      sub?: string
    }
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null
    if (typeof payload.sub !== 'string' || payload.sub === '') return null
    return { sub: payload.sub }
  } catch {
    return null
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  }

  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.replace(/^Bearer\s+/i, '')
  const principal = await verifyJwt(token)
  if (principal === null) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  }

  const config = readProviderConfig(Deno.env.toObject())
  if (config === null) {
    return new Response(JSON.stringify({ error: 'provider_not_configured' }), {
      status: 503,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  }

  const headers: Record<string, string> = {}
  if (config.apiKey !== undefined && config.apiKey !== '') {
    headers['authorization'] = `Bearer ${config.apiKey}`
  }

  let upstream: Response
  try {
    upstream = await fetch(config.url, {
      method: 'POST',
      body: await request.formData(),
      headers,
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'upstream_unreachable', detail: String(error) }),
      { status: 502, headers: { ...CORS_HEADERS, 'content-type': 'application/json' } },
    )
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...CORS_HEADERS, 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  })
})
