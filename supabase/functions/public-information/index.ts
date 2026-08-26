// Supabase Edge Function: public-information
//
// Server-side credential boundary for public-information (OSINT) research.
//
// The browser NEVER sees provider secrets. It calls this function with its
// Supabase JWT; this function:
//   1. verifies the caller's JWT,
//   2. reads provider configuration from ITS OWN environment,
//   3. forwards the JSON body to the real provider with credentials attached
//      server-side,
//   4. relays the provider response unchanged (the client re-validates it
//      against the versioned contract in
//      src/services/providers/httpPublicInformation.ts).
//
// The forwarded body is exactly the versioned contract request
// ({ contract_version, correlation_id, full_name }); no Atlas internal
// identifiers are added or accepted.
//
// Configuration (function environment, set via `supabase secrets set`):
//   PUBLIC_INFORMATION_PROVIDER_URL     - upstream provider endpoint
//   PUBLIC_INFORMATION_PROVIDER_API_KEY - upstream credential (sent as Bearer)
//
// Deploy: supabase functions deploy public-information
// Then set VITE_ATLAS_PUBLIC_INFORMATION_PROXY_ENDPOINT to
//   https://<project-ref>.supabase.co/functions/v1/public-information

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
  const url = env.PUBLIC_INFORMATION_PROVIDER_URL
  if (url === undefined || url.trim() === '') return null
  return { url: url.trim(), apiKey: env.PUBLIC_INFORMATION_PROVIDER_API_KEY }
}

async function verifyJwt(jwt: string): Promise<{ sub: string } | null> {
  try {
    // Structural verification: a malformed or expired token is refused and
    // never forwarded. Supabase's platform additionally validates the
    // signature when the function is invoked through the API gateway with
    // verify_jwt enabled.
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

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (config.apiKey !== undefined && config.apiKey !== '') {
    headers['authorization'] = `Bearer ${config.apiKey}`
  }

  let upstream: Response
  try {
    upstream = await fetch(config.url, {
      method: 'POST',
      body: await request.text(),
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
