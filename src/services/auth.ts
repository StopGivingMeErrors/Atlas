import { z } from 'zod'
import type { Organization, UserProfile } from '../types'
import { ProviderNotConfiguredError } from './errors'

/**
 * Auth service boundary. The UI consumes only this interface; concrete
 * implementations are provided by the application API (Supabase Auth) or,
 * in development with fixtures explicitly enabled, by a demo provider.
 */
export interface SessionInfo {
  user: UserProfile
  organizations: Organization[]
}

export const signInInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const signUpInputSchema = z.object({
  fullName: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
})

export type SignInInput = z.infer<typeof signInInputSchema>
export type SignUpInput = z.infer<typeof signUpInputSchema>

export interface AuthService {
  getSession(): Promise<SessionInfo | null>
  signIn(input: SignInInput): Promise<SessionInfo>
  /** Returns null when registration succeeded but requires email confirmation. */
  signUp(input: SignUpInput): Promise<SessionInfo | null>
  signOut(): Promise<void>
}

export class UnconfiguredAuthService implements AuthService {
  async getSession(): Promise<SessionInfo | null> {
    throw new ProviderNotConfiguredError('Auth')
  }

  async signIn(): Promise<SessionInfo> {
    throw new ProviderNotConfiguredError('Auth')
  }

  async signUp(): Promise<SessionInfo | null> {
    throw new ProviderNotConfiguredError('Auth')
  }

  async signOut(): Promise<void> {
    throw new ProviderNotConfiguredError('Auth')
  }
}
