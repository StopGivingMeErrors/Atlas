import type { z } from 'zod'
import type { AuditEvent } from '../types'
import { listAuditEventsInputSchema, recordAuditInputSchema } from './schemas'
import { ProviderNotConfiguredError } from './errors'

/**
 * Audit service boundary.
 *
 * `record` persists a durable audit event server-side (audit_events) and
 * additionally mirrors it into an in-process feed used for optimistic UI.
 * `listEvents` reads the durable trail. Persistence failures are reported
 * through the returned flag rather than thrown — a failed audit write must
 * be visible to operators but must not corrupt the primary workflow.
 */
export type RecordAuditInput = z.infer<typeof recordAuditInputSchema>
export type ListAuditEventsInput = z.infer<typeof listAuditEventsInputSchema>

export interface AuditService {
  record(input: RecordAuditInput): Promise<{ persisted: boolean }>
  listEvents(input?: ListAuditEventsInput): Promise<AuditEvent[]>
}

/* ---------- ephemeral in-process mirror (optimistic UI only) ---------- */

type MirrorListener = (event: AuditEvent) => void

const mirrorListeners = new Set<MirrorListener>()
let mirrorSequence = 0

/**
 * Ephemeral, session-local mirror of audit activity. This is NOT the
 * durable trail — durable events live in `audit_events` and are readable
 * via `AuditService.listEvents`.
 */
export const ephemeralAuditMirror = {
  append(input: RecordAuditInput, actor: string): AuditEvent {
    mirrorSequence += 1
    const event: AuditEvent = {
      id: `mirror-${mirrorSequence}`,
      organizationId: 'local',
      actor,
      action: input.action,
      detail: input.detail,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      sensitive: input.sensitive,
      timestamp: new Date().toISOString(),
    }
    mirrorListeners.forEach((fn) => fn(event))
    return event
  },
  subscribe(fn: MirrorListener): () => void {
    mirrorListeners.add(fn)
    return () => {
      mirrorListeners.delete(fn)
    }
  },
}

export class UnconfiguredAuditService implements AuditService {
  async record(): Promise<{ persisted: boolean }> {
    throw new ProviderNotConfiguredError('Audit')
  }

  async listEvents(): Promise<AuditEvent[]> {
    throw new ProviderNotConfiguredError('Audit')
  }
}
