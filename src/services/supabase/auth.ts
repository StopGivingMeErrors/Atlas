import type { Organization, UserProfile } from '../../types'
import type { AuthService, SessionInfo, SignInInput, SignUpInput } from '../auth'
import { roleSchema } from '../schemas'
import { signInInputSchema, signUpInputSchema } from '../auth'
import { AtlasServiceError } from '../errors'
import { requireSupabaseClient } from './client'
import { mapProviderError, parseOrThrow } from './rows'

interface UsersRow {
  id: string
  user_id: string
  full_name: string
  avatar_url: string | null
  organization_id: string | null
}

interface MembershipRow {
  role: string
  organizations?: {
    id: string
    name: string
    slug: string
    created_at: string
  } | null
}

export class SupabaseAuthService implements AuthService {
  async getSession(): Promise<SessionInfo | null> {
    const client = requireSupabaseClient('Auth')
    try {
      const { data, error } = await client.auth.getSession()
      if (error !== null) throw error
      const sessionUser = data.session?.user
      if (sessionUser === undefined || sessionUser === null) return null
      return await this.loadSession(client, sessionUser.id, sessionUser.email ?? '')
    } catch (error) {
      throw mapProviderError('Auth', error)
    }
  }

  async signIn(input: SignInInput): Promise<SessionInfo> {
    const parsed = parseOrThrow('Auth', signInInputSchema, input)
    const client = requireSupabaseClient('Auth')
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: parsed.email,
        password: parsed.password,
      })
      if (error !== null) throw error
      const authUser = data.user
      if (authUser === null) {
        throw new AtlasServiceError('Auth', 'provider_failure', undefined, 'No user returned')
      }
      let session = await this.loadSession(client, authUser.id, authUser.email ?? '')
      if (session === null) {
        // User confirmed via email but the public.users row was never created
        // during signup (email-confirmation path skips provisioning). Create it now.
        await this.provisionUserRow(client, authUser.id, authUser.email ?? '', authUser)
        session = await this.loadSession(client, authUser.id, authUser.email ?? '')
      }
      if (session === null) {
        await client.auth.signOut()
        throw new AtlasServiceError(
          'Auth',
          'conflict',
          undefined,
          'This account has no workspace profile.',
        )
      }
      return session
    } catch (error) {
      throw mapProviderError('Auth', error)
    }
  }

  async signUp(input: SignUpInput): Promise<SessionInfo | null> {
    const parsed = parseOrThrow('Auth', signUpInputSchema, input)
    const client = requireSupabaseClient('Auth')
    try {
      const { data, error } = await client.auth.signUp({
        email: parsed.email,
        password: parsed.password,
        options: { data: { full_name: parsed.fullName } },
      })
      if (error !== null) throw error
      const authUser = data.user
      // Email confirmation pending — no session yet.
      if (data.session === null || authUser === null) return null

      // Provision the public.users profile row when missing.
      const { data: existing, error: queryError } = await client
        .from('users')
        .select('id')
        .eq('user_id', authUser.id)
        .maybeSingle<{ id: string }>()
      if (queryError !== null) throw queryError
      if (existing === null) {
        const { error: insertError } = await client.from('users').insert({
          user_id: authUser.id,
          full_name: parsed.fullName,
          email: parsed.email,
          organization_id: null,
        })
        if (insertError !== null) throw insertError
      }
      return await this.loadSession(client, authUser.id, authUser.email ?? parsed.email)
    } catch (error) {
      throw mapProviderError('Auth', error)
    }
  }

  async signOut(): Promise<void> {
    const client = requireSupabaseClient('Auth')
    try {
      const { error } = await client.auth.signOut()
      if (error !== null) throw error
    } catch (error) {
      throw mapProviderError('Auth', error)
    }
  }

  private async provisionUserRow(
    client: ReturnType<typeof requireSupabaseClient>,
    userId: string,
    email: string,
    authUser: { user_metadata?: Record<string, unknown> },
  ): Promise<void> {
    const fullName =
      (typeof authUser.user_metadata?.full_name === 'string'
        ? authUser.user_metadata.full_name
        : '') || email.split('@')[0]
    const { error } = await client.from('users').insert({
      user_id: userId,
      full_name: fullName,
      email,
      organization_id: null,
    })
    if (error !== null) throw error
  }

  private async loadSession(
    client: ReturnType<typeof requireSupabaseClient>,
    userId: string,
    email: string,
  ): Promise<SessionInfo | null> {
    const { data: row, error } = await client
      .from('users')
      .select('id, user_id, full_name, avatar_url, organization_id')
      .eq('user_id', userId)
      .maybeSingle<UsersRow>()
    if (error !== null) throw error
    if (row === null) return null

    const { data: memberships, error: memberError } = await client
      .from('organization_members')
      .select('role, organizations(id, name, slug, created_at)')
      .eq('user_id', userId)
    if (memberError !== null) throw memberError

    const rows = (memberships ?? []) as unknown as MembershipRow[]
    const organizations: Organization[] = rows
      .filter((m) => m.organizations !== null)
      .map((m) => ({
        id: m.organizations?.id ?? '',
        name: m.organizations?.name ?? '',
        slug: m.organizations?.slug ?? '',
        createdAt: m.organizations?.created_at ?? new Date().toISOString(),
      }))
      .filter((o) => o.id !== '')

    const primaryRole =
      rows.find((m) => m.organizations?.id === row.organization_id)?.role ??
      rows[0]?.role ??
      'viewer'

    const user: UserProfile = {
      id: row.id,
      userId: row.user_id,
      fullName: row.full_name,
      email,
      avatarUrl: row.avatar_url,
      role: parseOrThrow('Auth', roleSchema, primaryRole),
      organizationId: row.organization_id ?? organizations[0]?.id ?? '',
    }
    return { user, organizations }
  }
}
