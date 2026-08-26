import type { EvidenceItem } from '../../types'
import { assertSubjectAuthorized } from '../identityResolution'
import type {
  AddEvidenceInput,
  EvidenceService,
  ListEvidenceByInvestigationInput,
  ListEvidenceBySubjectInput,
  ListEvidenceForFactInput,
} from '../evidence'
import {
  addEvidenceInputSchema,
  evidenceItemSchema,
  listEvidenceByInvestigationInputSchema,
  listEvidenceBySubjectInputSchema,
  listEvidenceForFactInputSchema,
} from '../schemas'
import { AtlasServiceError } from '../errors'
import { requireSupabaseClient } from './client'
import { mapProviderError, parseOrThrow } from './rows'

interface EvidenceRow {
  id: string
  investigation_id: string
  subject_id: string | null
  source_id: string
  fact_id: string | null
  claim: string
  confidence: number | string
  evidence_type: string
  captured_at: string
}

function mapEvidence(row: EvidenceRow): EvidenceItem {
  return parseOrThrow('Evidence', evidenceItemSchema, {
    id: row.id,
    investigationId: row.investigation_id,
    subjectId: row.subject_id,
    sourceId: row.source_id,
    factId: row.fact_id,
    claim: row.claim,
    confidence: Number(row.confidence),
    evidenceType: row.evidence_type,
    capturedAt: row.captured_at,
  })
}

export class SupabaseEvidenceService implements EvidenceService {
  async listByInvestigation(input: ListEvidenceByInvestigationInput): Promise<EvidenceItem[]> {
    const parsed = parseOrThrow(
      'Evidence',
      listEvidenceByInvestigationInputSchema,
      input,
    )
    const client = requireSupabaseClient('Evidence')
    try {
      const { data, error } = await client
        .from('evidence_items')
        .select('*')
        .eq('investigation_id', parsed.investigationId)
        .order('captured_at', { ascending: false })
      if (error !== null) throw error
      return (data ?? []).map((row) => mapEvidence(row as EvidenceRow))
    } catch (error) {
      throw mapProviderError('Evidence', error)
    }
  }

  async listBySubject(input: ListEvidenceBySubjectInput): Promise<EvidenceItem[]> {
    const parsed = parseOrThrow('Evidence', listEvidenceBySubjectInputSchema, input)
    const client = requireSupabaseClient('Evidence')
    try {
      const { data, error } = await client
        .from('evidence_items')
        .select('*')
        .eq('subject_id', parsed.subjectId)
        .order('captured_at', { ascending: false })
      if (error !== null) throw error
      return (data ?? []).map((row) => mapEvidence(row as EvidenceRow))
    } catch (error) {
      throw mapProviderError('Evidence', error)
    }
  }

  async listForFact(input: ListEvidenceForFactInput): Promise<EvidenceItem[]> {
    const parsed = parseOrThrow('Evidence', listEvidenceForFactInputSchema, input)
    const client = requireSupabaseClient('Evidence')
    try {
      const { data, error } = await client
        .from('evidence_items')
        .select('*')
        .eq('fact_id', parsed.factId)
        .order('captured_at', { ascending: false })
      if (error !== null) throw error
      return (data ?? []).map((row) => mapEvidence(row as EvidenceRow))
    } catch (error) {
      throw mapProviderError('Evidence', error)
    }
  }

  async addEvidence(input: AddEvidenceInput): Promise<EvidenceItem> {
    const parsed = parseOrThrow('Evidence', addEvidenceInputSchema, input)
    const client = requireSupabaseClient('Evidence')
    try {
      if (parsed.subjectId !== undefined && parsed.subjectId !== null) {
        const { data: subject, error } = await client
          .from('subjects')
          .select('authorization_state')
          .eq('id', parsed.subjectId)
          .maybeSingle<{ authorization_state: string }>()
        if (error !== null) throw error
        if (subject === null) {
          throw new AtlasServiceError('Evidence', 'not_found')
        }
        assertSubjectAuthorized(parsed.subjectId, subject.authorization_state)
      }

      const { data, error } = await client
        .from('evidence_items')
        .insert({
          investigation_id: parsed.investigationId,
          subject_id: parsed.subjectId ?? null,
          source_id: parsed.sourceId,
          fact_id: parsed.factId ?? null,
          claim: parsed.claim,
          confidence: parsed.confidence,
          evidence_type: parsed.evidenceType,
        })
        .select('*')
        .single<EvidenceRow>()
      if (error !== null) throw error
      return mapEvidence(data)
    } catch (error) {
      throw mapProviderError('Evidence', error)
    }
  }
}
