import { Link } from 'react-router-dom'
import { Plus, ShieldCheck } from 'lucide-react'
import { investigations, subjects } from '../data/seed'
import { formatRelative } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import { Button, EmptyState, Pill } from '../components/ui/primitives'
import type { InvestigationStatus, RiskLevel } from '../types'

const statusTone: Record<InvestigationStatus, 'accent' | 'warn' | 'neutral' | 'ok'> = {
  active: 'accent',
  in_review: 'warn',
  closed: 'neutral',
  archived: 'neutral',
}

const riskTone: Record<RiskLevel, 'neutral' | 'warn' | 'danger'> = {
  low: 'neutral',
  medium: 'warn',
  high: 'danger',
  critical: 'danger',
}

export function Investigations() {
  return (
    <div>
      <PageHeader
        title="Investigations"
        description={`${investigations.length} cases in your organization`}
        actions={
          <Button variant="primary">
            <Plus size={14} />
            New investigation
          </Button>
        }
      />

      <div className="p-6">
        {investigations.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={18} />}
            title="No investigations yet"
            description="Create an investigation to begin an authorized identity verification workflow."
            action={
              <Button variant="primary">
                <Plus size={14} />
                New investigation
              </Button>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-edge">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-edge bg-surface-1 text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                  <th className="px-4 py-2.5 font-semibold">Investigation</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Risk</th>
                  <th className="px-4 py-2.5 font-semibold">Subjects</th>
                  <th className="px-4 py-2.5 font-semibold">Created by</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {investigations.map((inv) => {
                  const subjectCount = subjects.filter((s) => s.investigationId === inv.id).length
                  return (
                    <tr
                      key={inv.id}
                      className="group border-b border-edge bg-surface-1/50 transition-colors last:border-0 hover:bg-surface-2"
                    >
                      <td className="px-4 py-3">
                        <Link to={`/investigations/${inv.id}`} className="block">
                          <p className="font-medium text-ink transition-colors group-hover:text-accent">
                            {inv.title}
                          </p>
                          <p className="mt-0.5 max-w-md truncate text-xs text-ink-muted">{inv.description}</p>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={statusTone[inv.status]} className="capitalize">
                          {inv.status.replace('_', ' ')}
                        </Pill>
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={riskTone[inv.riskLevel]} className="capitalize">
                          {inv.riskLevel}
                        </Pill>
                      </td>
                      <td className="px-4 py-3 font-mono text-ink-secondary">{subjectCount}</td>
                      <td className="px-4 py-3 text-ink-secondary">{inv.createdBy}</td>
                      <td className="px-4 py-3 text-right text-xs text-ink-muted">
                        {formatRelative(inv.updatedAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
