import { useMemo, useState } from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'
import { useAuditEvents } from '../api/hooks'
import { useAuth } from '../context/AuthContext'
import type { AuditEvent } from '../types'
import { cn, formatDate, formatTime } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import {
  EmptyState,
  ErrorPanel,
  Panel,
  PanelHeader,
  Pill,
} from '../components/ui/primitives'

const sensitiveActions = [
  'identity_resolution',
  'authorization_granted',
  'authorization_revoked',
  'research_run',
]

function isSensitive(event: AuditEvent): boolean {
  return sensitiveActions.includes(event.action)
}

export function ActivityPage() {
  const { user } = useAuth()
  const [view, setView] = useState<'all' | 'sensitive'>('all')
  const isAdmin = user?.role === 'administrator'
  const audit = useAuditEvents()

  const byDay = useMemo(() => {
    const events = (audit.data ?? []).filter(
      (event) => view === 'all' || isSensitive(event),
    )
    return events.reduce<Record<string, AuditEvent[]>>((acc, event) => {
      const day = formatDate(event.timestamp)
      ;(acc[day] ??= []).push(event)
      return acc
    }, {})
  }, [audit.data, view])

  return (
    <div>
      <PageHeader
        title="Activity"
        description="Organization-wide activity and audit history"
        actions={
          <div className="flex rounded-md border border-edge bg-surface-1 p-0.5">
            {(['all', 'sensitive'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs capitalize transition-colors',
                  view === v ? 'bg-surface-3 font-medium text-ink' : 'text-ink-muted hover:text-ink-secondary',
                )}
              >
                {v === 'all' ? 'All activity' : 'Sensitive audit'}
              </button>
            ))}
          </div>
        }
      />

      <div className="mx-auto max-w-3xl space-y-5 p-6">
        {audit.error !== null && <ErrorPanel error={audit.error} />}
        {audit.loading && (
          <div className="flex items-center gap-2 p-8 text-xs text-ink-muted">
            <Loader2 size={14} className="animate-spin" /> Loading audit trail…
          </div>
        )}

        {view === 'sensitive' && !isAdmin && (
          <Panel className="flex items-start gap-3 border-warn/30 bg-warn-muted p-4">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" />
            <div>
              <p className="text-[13px] font-medium text-ink">Administrator audit view</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">
                You are viewing the sensitive audit trail with analyst permissions. Full audit
                exports and retention controls require an administrator role.
              </p>
            </div>
          </Panel>
        )}

        {!audit.loading &&
          audit.error === null &&
          Object.entries(byDay).length === 0 && (
            <EmptyState
              icon={<ShieldAlert size={18} />}
              title="No recorded activity"
              description={
                view === 'sensitive'
                  ? 'Sensitive actions (resolution runs, authorization changes) will appear here.'
                  : 'Activity recorded by your organization will appear here.'
              }
            />
          )}

        {!audit.loading &&
          Object.entries(byDay).map(([day, dayEvents]) => (
            <Panel key={day}>
              <PanelHeader title={day} />
              <ul className="divide-y divide-edge">
                {dayEvents.map((event) => (
                  <li key={event.id} className="flex gap-4 px-4 py-3">
                    <span className="w-12 shrink-0 pt-0.5 font-mono text-[11px] text-ink-muted">
                      {formatTime(event.timestamp)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-ink">{event.action}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">{event.detail}</p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Pill tone="neutral">{event.actor}</Pill>
                        <Pill tone="neutral" className="capitalize">
                          {event.resourceType.replace('_', ' ')}
                        </Pill>
                        {isSensitive(event) && <Pill tone="warn">Audited</Pill>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
      </div>
    </div>
  )
}
