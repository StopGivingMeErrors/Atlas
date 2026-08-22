import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Organization, UserProfile } from '../types'
import { currentUser, organizations } from '../data/seed'

/**
 * Auth service boundary. The demo implementation persists a session in
 * localStorage; a production build swaps this for Supabase Auth (or another
 * backend) behind the same context shape — components are unaffected.
 */
interface AuthState {
  user: UserProfile | null
  organization: Organization | null
  organizations: Organization[]
  signIn: (email: string, password: string) => Promise<void>
  signUp: (fullName: string, email: string, password: string) => Promise<void>
  signOut: () => void
  switchOrganization: (orgId: string) => void
}

const AuthContext = createContext<AuthState | null>(null)
const SESSION_KEY = 'atlas.session'

function loadSession(): UserProfile | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as UserProfile
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(loadSession)
  const [orgId, setOrgId] = useState<string>(currentUser.organizationId)

  const signIn = useCallback(async (email: string, _password: string) => {
    await new Promise((r) => setTimeout(r, 650))
    const session: UserProfile = { ...currentUser, email: email || currentUser.email }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    setUser(session)
  }, [])

  const signUp = useCallback(async (fullName: string, email: string, _password: string) => {
    await new Promise((r) => setTimeout(r, 800))
    const session: UserProfile = { ...currentUser, fullName, email }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    setUser(session)
  }, [])

  const signOut = useCallback(() => {
    localStorage.removeItem(SESSION_KEY)
    setUser(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      organization: organizations.find((o) => o.id === orgId) ?? null,
      organizations,
      signIn,
      signUp,
      signOut,
      switchOrganization: setOrgId,
    }),
    [user, orgId, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
