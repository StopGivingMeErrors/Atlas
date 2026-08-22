export interface AuditEntry {
  action: string
  resourceType: string
  resourceId: string
  timestamp: string
}

const listeners = new Set<(entry: AuditEntry) => void>()
const entries: AuditEntry[] = []

/**
 * Client-side audit hook. In production every sensitive action is also
 * recorded server-side in audit_logs; this mirror powers the live
 * activity feed without waiting on the server round-trip.
 */
export function recordAudit(action: string, resourceType: string, resourceId: string): void {
  const entry: AuditEntry = {
    action,
    resourceType,
    resourceId,
    timestamp: new Date().toISOString(),
  }
  entries.push(entry)
  listeners.forEach((fn) => fn(entry))
}

export function getAuditEntries(): readonly AuditEntry[] {
  return entries
}

export function onAudit(fn: (entry: AuditEntry) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
