import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { activity } from '../data/seed'
import { useAuth } from '../context/AuthContext'
import { cn, formatDate, formatTime } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import { Panel, PanelHeader, Pill } from '../components/ui/primitives'

export function ActivityPage() {
  const { user } = useAuth()
  const [view, setView] = useState<'all' | 'sensitive'>('all')
  const isAdmin = user?.role === 'administrator'

  const events = view === 'sensitive' ? activity.filter((a) => a.sensitive) : activity
  const byDay = events.reduce<Record<string, typeof activity>>((acc, event) => {
    const day = formatDate(event.timestamp)
    ;(acc[day] ??= []).push(event)
    return acc
  }, {})

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

        {Object.entries(byDay).map(([day, dayEvents]) => (
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
                      {event.sensitive && <Pill tone="warn">Audited</Pill>}
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
