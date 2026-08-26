import type { AuditEvent } from '../../types'
import { ephemeralAuditMirror, type AuditService, type ListAuditEventsInput, type RecordAuditInput } from '../audit'
import { listAuditEventsInputSchema, recordAuditInputSchema } from '../schemas'
import { requireSupabaseClient } from './client'
import { mapProviderError, parseOrThrow } from './rows'

interface AuditEventRow {
  id: string
  organization_id: string
  actor_name: string | null
  action: string
  detail: string | null
  resource_type: string
  resource_id: string | null
  sensitive: boolean | null
  created_at: string
}

function mapEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    actor: row.actor_name ?? 'System',
    action: row.action,
    detail: row.detail ?? '',
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    sensitive: row.sensitive ?? false,
    timestamp: row.created_at,
  }
}

export class SupabaseAuditService implements AuditService {
  async record(input: RecordAuditInput): Promise<{ persisted: boolean }> {
    const parsed = parseOrThrow('Audit', recordAuditInputSchema, input)
    const client = requireSupabaseClient('Audit')
    try {
      const { data: userData } = await client.auth.getUser()
      const userId = userData.user?.id
      let organizationId: string | null = null
      let actorName = 'System'
      if (userId !== undefined) {
        const { data: user, error: userError } = await client
          .from('users')
          .select('organization_id, full_name')
          .eq('user_id', userId)
          .maybeSingle<{ organization_id: string; full_name: string }>()
        if (userError === null && user !== null) {
          organizationId = user.organization_id
          actorName = user.full_name
        }
      }

      // Optimistic mirror regardless of persistence outcome.
      ephemeralAuditMirror.append(parsed, actorName)

      if (organizationId === null) return { persisted: false }
      const { error } = await client.from('audit_events').insert({
        organization_id: organizationId,
        action: parsed.action,
        resource_type: parsed.resourceType,
        resource_id: parsed.resourceId ?? null,
        detail: parsed.detail,
        sensitive: parsed.sensitive,
        actor_name: actorName,
      })
      return { persisted: error === null }
    } catch (error) {
      throw mapProviderError('Audit', error)
    }
  }

  async listEvents(input?: ListAuditEventsInput): Promise<AuditEvent[]> {
    const parsed = parseOrThrow('Audit', listAuditEventsInputSchema, input ?? {})
    const client = requireSupabaseClient('Audit')
    try {
      let query = client
        .from('audit_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(parsed.limit)
      if (parsed.sensitiveOnly) query = query.eq('sensitive', true)
      const { data, error } = await query
      if (error !== null) throw error
      return (data ?? []).map((row) => mapEvent(row as AuditEventRow))
    } catch (error) {
      throw mapProviderError('Audit', error)
    }
  }
}
