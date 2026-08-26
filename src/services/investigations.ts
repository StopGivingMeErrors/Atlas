import type { z } from 'zod'
import type { Investigation, InvestigationSubject, SubjectAuthorization } from '../types'
import {
  createInvestigationInputSchema,
  createSubjectInputSchema,
  getInvestigationInputSchema,
  getSubjectInputSchema,
  listSubjectsInputSchema,
  updateSubjectAuthorizationInputSchema,
} from './schemas'
import { ProviderNotConfiguredError } from './errors'

/**
 * Investigation service boundary.
 *
 * Investigations group subjects, evidence, and research under an explicit
 * authorization mandate. Authorization state changes are first-class
 * operations: granting or restricting access requires a recorded basis.
 */
export type GetInvestigationInput = z.infer<typeof getInvestigationInputSchema>
export type ListSubjectsInput = z.infer<typeof listSubjectsInputSchema>
export type CreateInvestigationInput = z.infer<typeof createInvestigationInputSchema>
export type UpdateSubjectAuthorizationInput = z.infer<
  typeof updateSubjectAuthorizationInputSchema
>
export type GetSubjectInput = z.infer<typeof getSubjectInputSchema>
export type CreateSubjectInput = z.infer<typeof createSubjectInputSchema>

export interface InvestigationService {
  listInvestigations(): Promise<Investigation[]>
  getInvestigation(input: GetInvestigationInput): Promise<Investigation>
  listSubjects(input: ListSubjectsInput): Promise<InvestigationSubject[]>
  createInvestigation(input: CreateInvestigationInput): Promise<Investigation>
  /** Explicit authorization lifecycle transition for a subject. */
  updateSubjectAuthorization(input: UpdateSubjectAuthorizationInput): Promise<InvestigationSubject>
  /** Loads a single subject (organization-scoped by RLS). */
  getSubject(input: GetSubjectInput): Promise<InvestigationSubject>
  /**
   * Enrolls a subject into an investigation. Organization and actor are
   * derived server-side from the authenticated session; the browser can
   * never submit another organization or identity.
   */
  createSubject(input: CreateSubjectInput): Promise<InvestigationSubject>
}

/** All valid authorization states, exported for UI controls. */
export const subjectAuthorizationStates: readonly SubjectAuthorization[] = [
  'undeclared',
  'authorized',
  'restricted',
  'revoked',
]

export class UnconfiguredInvestigationService implements InvestigationService {
  async listInvestigations(): Promise<Investigation[]> {
    throw new ProviderNotConfiguredError('Investigations')
  }

  async getInvestigation(): Promise<Investigation> {
    throw new ProviderNotConfiguredError('Investigations')
  }

  async listSubjects(): Promise<InvestigationSubject[]> {
    throw new ProviderNotConfiguredError('Investigations')
  }

  async createInvestigation(): Promise<Investigation> {
    throw new ProviderNotConfiguredError('Investigations')
  }

  async updateSubjectAuthorization(): Promise<InvestigationSubject> {
    throw new ProviderNotConfiguredError('Investigations')
  }

  async getSubject(): Promise<InvestigationSubject> {
    throw new ProviderNotConfiguredError('Investigations')
  }

  async createSubject(): Promise<InvestigationSubject> {
    throw new ProviderNotConfiguredError('Investigations')
  }
}
