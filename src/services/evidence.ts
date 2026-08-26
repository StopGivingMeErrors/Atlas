import type { z } from 'zod'
import type { EvidenceItem } from '../types'
import {
  addEvidenceInputSchema,
  listEvidenceByInvestigationInputSchema,
  listEvidenceBySubjectInputSchema,
  listEvidenceForFactInputSchema,
} from './schemas'
import { ProviderNotConfiguredError } from './errors'

/**
 * Evidence service boundary.
 *
 * Evidence items are captured claims tied to a source and optionally to a
 * fact and subject. Writes that attach evidence to a subject require the
 * subject's authorization state to be `authorized` (enforced here and in
 * the database).
 */
export type ListEvidenceByInvestigationInput = z.infer<
  typeof listEvidenceByInvestigationInputSchema
>
export type ListEvidenceBySubjectInput = z.infer<typeof listEvidenceBySubjectInputSchema>
export type ListEvidenceForFactInput = z.infer<typeof listEvidenceForFactInputSchema>
export type AddEvidenceInput = z.infer<typeof addEvidenceInputSchema>

export interface EvidenceService {
  listByInvestigation(input: ListEvidenceByInvestigationInput): Promise<EvidenceItem[]>
  listBySubject(input: ListEvidenceBySubjectInput): Promise<EvidenceItem[]>
  listForFact(input: ListEvidenceForFactInput): Promise<EvidenceItem[]>
  addEvidence(input: AddEvidenceInput): Promise<EvidenceItem>
}

export class UnconfiguredEvidenceService implements EvidenceService {
  async listByInvestigation(): Promise<EvidenceItem[]> {
    throw new ProviderNotConfiguredError('Evidence')
  }

  async listBySubject(): Promise<EvidenceItem[]> {
    throw new ProviderNotConfiguredError('Evidence')
  }

  async listForFact(): Promise<EvidenceItem[]> {
    throw new ProviderNotConfiguredError('Evidence')
  }

  async addEvidence(): Promise<EvidenceItem> {
    throw new ProviderNotConfiguredError('Evidence')
  }
}
