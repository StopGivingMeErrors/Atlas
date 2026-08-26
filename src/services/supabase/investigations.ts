import type { Investigation, InvestigationSubject } from '../../types'
import type {
  CreateInvestigationInput,
  CreateSubjectInput,
  GetInvestigationInput,
  GetSubjectInput,
  InvestigationService,
  ListSubjectsInput,
  UpdateSubjectAuthorizationInput,
} from '../investigations'
import {
  createInvestigationInputSchema,
  createSubjectInputSchema,
  getInvestigationInputSchema,
  getSubjectInputSchema,
  investigationSchema,
  investigationSubjectSchema,
  listSubjectsInputSchema,
  updateSubjectAuthorizationInputSchema,
} from '../schemas'
import { AtlasServiceError } from '../errors'
import { requireSupabaseClient } from './client'
import { mapProviderError, parseOrThrow } from './rows'

interface InvestigationRow {
  id: string
  organization_id: string
  created_by: string
  title: string
  description: string
  status: string
  risk_level: string
  created_at: string
  updated_at: string
}

interface SubjectRow {
  id: string
  investigation_id: string
  label: string
  authorization_state: string
  authorization_basis: string
  identity_state: string
  last_activity_at: string
  created_at: string
  intelligence_profiles?: { id?: string } | { id?: string }[] | null
  evidence_items?: { count?: number }[] | null
  investigations?: { organization_id?: string } | null
}

function mapInvestigation(row: InvestigationRow, subjectIds: string[]): Investigation {
  return parseOrThrow('Investigations', investigationSchema, {
    id: row.id,
    organizationId: row.organization_id,
    createdBy: row.created_by,
    title: row.title,
    description: row.description,
    status: row.status,
    riskLevel: row.risk_level,
    subjectIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function embeddedProfileId(row: SubjectRow): string | null {
  const embed = row.intelligence_profiles
  if (embed === null || embed === undefined) return null
  const node = Array.isArray(embed) ? (embed[0] ?? null) : embed
  return typeof node?.id === 'string' && node.id !== '' ? node.id : null
}

function embeddedEvidenceCount(row: SubjectRow): number {
  const counts = row.evidence_items
  if (!Array.isArray(counts) || counts.length === 0) return 0
  return Number(counts[0]?.count ?? 0)
}

function mapSubject(row: SubjectRow): InvestigationSubject {
  return parseOrThrow('Investigations', investigationSubjectSchema, {
    id: row.id,
    investigationId: row.investigation_id,
    label: row.label,
    authorizationState: row.authorization_state,
    authorizationBasis: row.authorization_basis,
    identityState: row.identity_state,
    profileId: embeddedProfileId(row),
    evidenceCount: embeddedEvidenceCount(row),
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
  })
}

export class SupabaseInvestigationService implements InvestigationService {
  async listInvestigations(): Promise<Investigation[]> {
    const client = requireSupabaseClient('Investigations')
    try {
      const [{ data: investigations, error }, subjectMap] = await Promise.all([
        client.from('investigations').select('*').order('created_at', { ascending: false }),
        this.loadSubjectIndex(client),
      ])
      if (error !== null) throw error
      return (investigations ?? []).map((raw) => {
        const row = raw as InvestigationRow
        return mapInvestigation(row, subjectMap.get(row.id) ?? [])
      })
    } catch (error) {
      throw mapProviderError('Investigations', error)
    }
  }

  async getInvestigation(input: GetInvestigationInput): Promise<Investigation> {
    const parsed = parseOrThrow('Investigations', getInvestigationInputSchema, input)
    const client = requireSupabaseClient('Investigations')
    try {
      const { data: row, error } = await client
        .from('investigations')
        .select('*')
        .eq('id', parsed.id)
        .maybeSingle<InvestigationRow>()
      if (error !== null) throw error
      if (row === null) throw new AtlasServiceError('Investigations', 'not_found')
      const subjectMap = await this.loadSubjectIndex(client)
      return mapInvestigation(row, subjectMap.get(row.id) ?? [])
    } catch (error) {
      throw mapProviderError('Investigations', error)
    }
  }

  async listSubjects(input: ListSubjectsInput): Promise<InvestigationSubject[]> {
    const parsed = parseOrThrow('Investigations', listSubjectsInputSchema, input)
    const client = requireSupabaseClient('Investigations')
    try {
      const { data, error } = await client
        .from('subjects')
        .select(
          '*, intelligence_profiles(id), evidence_items(count)',
        )
        .eq('investigation_id', parsed.investigationId)
        .order('created_at', { ascending: true })
      if (error !== null) throw error
      return (data ?? []).map((raw) => mapSubject(raw as SubjectRow))
    } catch (error) {
      throw mapProviderError('Investigations', error)
    }
  }

  async createInvestigation(input: CreateInvestigationInput): Promise<Investigation> {
    const parsed = parseOrThrow('Investigations', createInvestigationInputSchema, input)
    const client = requireSupabaseClient('Investigations')
    try {
      const { data: userData } = await client.auth.getUser()
      const userId = userData.user?.id
      if (userId === undefined) {
        throw new AtlasServiceError('Investigations', 'provider_failure', undefined, 'No active session')
      }
      const { data: user, error: userError } = await client
        .from('users')
        .select('organization_id, full_name')
        .eq('user_id', userId)
        .maybeSingle<{ organization_id: string; full_name: string }>()
      if (userError !== null) throw userError
      if (user === null || user.organization_id === '') {
        throw new AtlasServiceError(
          'Investigations',
          'conflict',
          undefined,
          'User has no organization membership',
        )
      }

      const { data: row, error } = await client
        .from('investigations')
        .insert({
          organization_id: user.organization_id,
          created_by: userId,
          title: parsed.title,
          description: parsed.description,
          risk_level: parsed.riskLevel,
        })
        .select('*')
        .single<InvestigationRow>()
      if (error !== null) throw error

      try {
        await client.from('audit_events').insert({
          organization_id: user.organization_id,
          action: 'investigation.created',
          resource_type: 'investigation',
          resource_id: row.id,
          detail: parsed.title,
          sensitive: false,
          actor_name: user.full_name,
        })
      } catch {
        // Audit bookkeeping must not fail the primary operation.
      }
      return mapInvestigation(row, [])
    } catch (error) {
      throw mapProviderError('Investigations', error)
    }
  }

  async getSubject(input: GetSubjectInput): Promise<InvestigationSubject> {
    const parsed = parseOrThrow('Investigations', getSubjectInputSchema, input)
    const client = requireSupabaseClient('Investigations')
    try {
      // RLS scopes this read to the caller's organization; a foreign subject
      // id is indistinguishable from a missing one.
      const { data: row, error } = await client
        .from('subjects')
        .select('*, intelligence_profiles(id), evidence_items(count)')
        .eq('id', parsed.subjectId)
        .maybeSingle<SubjectRow>()
      if (error !== null) throw error
      if (row === null) throw new AtlasServiceError('Investigations', 'not_found')
      return mapSubject(row)
    } catch (error) {
      throw mapProviderError('Investigations', error)
    }
  }

  async createSubject(input: CreateSubjectInput): Promise<InvestigationSubject> {
    const parsed = parseOrThrow('Investigations', createSubjectInputSchema, input)
    const client = requireSupabaseClient('Investigations')
    try {
      // Organization and actor are derived from the authenticated session —
      // never accepted from the browser payload.
      const { data: userData } = await client.auth.getUser()
      const userId = userData.user?.id
      if (userId === undefined) {
        throw new AtlasServiceError('Investigations', 'provider_failure', undefined, 'No active session')
      }
      const { data: user, error: userError } = await client
        .from('users')
        .select('organization_id, full_name')
        .eq('user_id', userId)
        .maybeSingle<{ organization_id: string; full_name: string }>()
      if (userError !== null) throw userError
      if (user === null || user.organization_id === '') {
        throw new AtlasServiceError(
          'Investigations',
          'conflict',
          undefined,
          'User has no organization membership',
        )
      }

      // The investigation must exist AND be visible to this org (RLS);
      // cross-org enrollment attempts surface as not_found here.
      const { data: investigation, error: invError } = await client
        .from('investigations')
        .select('id, organization_id')
        .eq('id', parsed.investigationId)
        .maybeSingle<{ id: string; organization_id: string }>()
      if (invError !== null) throw invError
      if (investigation === null || investigation.organization_id !== user.organization_id) {
        throw new AtlasServiceError('Investigations', 'not_found')
      }

      const basis =
        parsed.authorizationBasis !== undefined && parsed.authorizationBasis.trim() !== ''
          ? parsed.authorizationBasis.trim()
          : ''

      const { data: row, error } = await client
        .from('subjects')
        .insert({
          investigation_id: parsed.investigationId,
          label: parsed.label,
          authorization_state: parsed.authorizationState,
          authorization_basis: basis,
        })
        .select('*')
        .single<SubjectRow>()
      if (error !== null) throw error

      try {
        await client.from('audit_events').insert({
          organization_id: user.organization_id,
          action: 'subject.created',
          resource_type: 'subject',
          resource_id: row.id,
          detail: `${parsed.label} enrolled (${parsed.authorizationState})`,
          sensitive: parsed.authorizationState === 'authorized' || parsed.authorizationState === 'restricted',
          actor_name: user.full_name,
        })
      } catch {
        // Audit bookkeeping must not fail the primary operation.
      }
      return mapSubject(row)
    } catch (error) {
      throw mapProviderError('Investigations', error)
    }
  }

  async updateSubjectAuthorization(
    input: UpdateSubjectAuthorizationInput,
  ): Promise<InvestigationSubject> {
    const parsed = parseOrThrow('Investigations', updateSubjectAuthorizationInputSchema, input)
    const client = requireSupabaseClient('Investigations')
    try {
      // Fetch current basis so UNDECLARED/REVOKED transitions can keep the
      // historical record while clearing active authorization.
      const { data: existing, error: fetchError } = await client
        .from('subjects')
        .select('*, investigations(organization_id)')
        .eq('id', parsed.subjectId)
        .maybeSingle<SubjectRow>()
      if (fetchError !== null) throw fetchError
      if (existing === null) throw new AtlasServiceError('Investigations', 'not_found')

      const basis =
        parsed.authorizationBasis !== undefined && parsed.authorizationBasis.trim() !== ''
          ? parsed.authorizationBasis.trim()
          : existing.authorization_basis

      const { error: updateError } = await client
        .from('subjects')
        .update({ authorization_state: parsed.authorizationState, authorization_basis: basis })
        .eq('id', parsed.subjectId)
      if (updateError !== null) throw updateError

      try {
        await client.from('audit_events').insert({
          organization_id: existing.investigations?.organization_id ?? existing.investigation_id,
          action: 'subject.authorization_changed',
          resource_type: 'subject',
          resource_id: parsed.subjectId,
          detail: `authorization state set to ${parsed.authorizationState}`,
          sensitive: true,
        })
      } catch {
        // Audit bookkeeping must not fail the primary operation.
      }

      return mapSubject({ ...existing, authorization_state: parsed.authorizationState, authorization_basis: basis })
    } catch (error) {
      throw mapProviderError('Investigations', error)
    }
  }

  private async loadSubjectIndex(
    client: ReturnType<typeof requireSupabaseClient>,
  ): Promise<Map<string, string[]>> {
    const index = new Map<string, string[]>()
    const { data, error } = await client.from('subjects').select('id, investigation_id')
    if (error !== null) throw error
    for (const row of (data ?? []) as Array<{ id: string; investigation_id: string }>) {
      const list = index.get(row.investigation_id) ?? []
      list.push(row.id)
      index.set(row.investigation_id, list)
    }
    return index
  }
}
