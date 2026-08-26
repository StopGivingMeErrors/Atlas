/**
 * Runtime configuration for Atlas.
 *
 * Real providers require a Supabase project (the application API).
 * Demo fixtures are a development-only affordance and are refused
 * outright in production builds, regardless of flags.
 */

export interface AtlasConfig {
  supabaseUrl: string | null
  supabaseAnonKey: string | null
  /** Optional backend vision endpoint for real face detection. */
  faceDetectionEndpoint: string | null
  /**
   * Optional credentialless DIRECT identity matching endpoint. Must never
   * embed credentials: org members can read this value from the bundle.
   */
  identityMatchingEndpoint: string | null
  /**
   * Optional server-side proxy (Edge Function) for identity matching.
   * Provider secrets live ONLY in the function's environment; the browser
   * authenticates with the user's Supabase JWT.
   */
  identityMatchingProxyEndpoint: string | null
  /**
   * Optional credentialless DIRECT public-information endpoint. Must never
   * embed credentials: org members can read connector configuration.
   */
  publicInformationEndpoint: string | null
  /**
   * Optional server-side proxy (Edge Function) for public-information
   * research. Provider secrets live ONLY in the function's environment.
   */
  publicInformationProxyEndpoint: string | null
  /** True only in development builds when VITE_ATLAS_DEMO_FIXTURES=true. */
  demoFixturesAllowed: boolean
  isProductionBuild: boolean
}

const raw = import.meta.env

function readString(env: ImportMetaEnv, key: string): string | null {
  const value = env[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function readUrl(env: ImportMetaEnv, key: string): string | null {
  const value = readString(env, key)
  if (value === null) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost'
      ? value
      : null
  } catch {
    return null
  }
}

export function loadConfig(env: ImportMetaEnv = raw): AtlasConfig {
  const isProductionBuild = env.PROD === true || env.DEV !== true
  return {
    supabaseUrl: readUrl(env, 'VITE_SUPABASE_URL'),
    supabaseAnonKey: readString(env, 'VITE_SUPABASE_ANON_KEY'),
    faceDetectionEndpoint: readUrl(env, 'VITE_ATLAS_FACE_DETECTION_ENDPOINT'),
    identityMatchingEndpoint: readUrl(env, 'VITE_ATLAS_IDENTITY_MATCHING_ENDPOINT'),
    identityMatchingProxyEndpoint: readUrl(env, 'VITE_ATLAS_IDENTITY_MATCHING_PROXY_ENDPOINT'),
    publicInformationEndpoint: readUrl(env, 'VITE_ATLAS_PUBLIC_INFORMATION_ENDPOINT'),
    publicInformationProxyEndpoint: readUrl(env, 'VITE_ATLAS_PUBLIC_INFORMATION_PROXY_ENDPOINT'),
    demoFixturesAllowed:
      !isProductionBuild && readString(env, 'VITE_ATLAS_DEMO_FIXTURES') === 'true',
    isProductionBuild,
  }
}

/** True when the real application API is configured. */
export function hasRealBackend(config: AtlasConfig): boolean {
  return config.supabaseUrl !== null && config.supabaseAnonKey !== null
}

export const atlasConfig = loadConfig()
