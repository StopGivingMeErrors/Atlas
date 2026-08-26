import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Organization, UserProfile } from '../types'
import type { SessionInfo } from '../services/auth'
import { useAtlas } from '../api/hooks'

/**
 * Session context backed exclusively by the AuthService boundary.
 * There is no local credential handling here — all authentication runs
 * through the configured provider (Supabase Auth in production).
 */
interface AuthState {
  user: UserProfile | null
  organizations: Organization[]
  organization: Organization | null
  status: 'loading' | 'authenticated' | 'unauthenticated'
  signIn: (email: string, password: string) => Promise<void>
  /** Resolves null when registration succeeded but email confirmation is pending. */
  signUp: (fullName: string, email: string, password: string) => Promise<SessionInfo | null>
  signOut: () => Promise<void>
  switchOrganization: (orgId: string) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth } = useAtlas()
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [status, setStatus] = useState<AuthState['status']>('loading')
  const [orgId, setOrgId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    auth
      .getSession()
      .then((loaded) => {
        if (cancelled) return
        if (loaded === null) {
          setStatus('unauthenticated')
        } else {
          setSession(loaded)
          setOrgId(loaded.user.organizationId)
          setStatus('authenticated')
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated')
      })
    return () => {
      cancelled = true
    }
  }, [auth])

  const adoptSession = useCallback((loaded: SessionInfo) => {
    setSession(loaded)
    setOrgId(loaded.user.organizationId)
    setStatus('authenticated')
  }, [])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const loaded = await auth.signIn({ email, password })
      adoptSession(loaded)
    },
    [auth, adoptSession],
  )

  const signUp = useCallback(
    async (fullName: string, email: string, password: string) => {
      const loaded = await auth.signUp({ fullName, email, password })
      if (loaded !== null) adoptSession(loaded)
      return loaded
    },
    [auth, adoptSession],
  )

  const signOut = useCallback(async () => {
    await auth.signOut()
    setSession(null)
    setStatus('unauthenticated')
  }, [auth])

  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      organizations: session?.organizations ?? [],
      organization:
        session?.organizations.find((org) => org.id === orgId) ??
        session?.organizations[0] ??
        null,
      status,
      signIn,
      signUp,
      signOut,
      switchOrganization: setOrgId,
    }),
    [session, orgId, status, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
