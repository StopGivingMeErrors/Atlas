import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Plus, ShieldCheck, X } from 'lucide-react'
import { useAtlas, useInvestigations } from '../api/hooks'
import { formatRelative } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import {
  Button,
  EmptyState,
  ErrorPanel,
  Panel,
  PanelHeader,
  Pill,
} from '../components/ui/primitives'
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

const riskLevels: RiskLevel[] = ['low', 'medium', 'high', 'critical']

function NewInvestigationDialog({ onClose }: { onClose: () => void }) {
  const { investigations } = useAtlas()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('low')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await investigations.createInvestigation({
        title: title.trim(),
        description: description.trim(),
        riskLevel,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the investigation.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Panel className="animate-fade-up w-full max-w-lg">
        <div onClick={(e) => e.stopPropagation()}>
          <PanelHeader
            title="New investigation"
            action={
              <button onClick={onClose} aria-label="Close" className="rounded p-1 text-ink-muted hover:bg-surface-3 hover:text-ink">
                <X size={14} />
              </button>
            }
          />
          <form onSubmit={onSubmit} className="space-y-3 p-4">
            <div>
              <label htmlFor="inv-title" className="mb-1 block text-xs font-medium text-ink-secondary">
                Title
              </label>
              <input
                id="inv-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Vendor due diligence — …"
                minLength={3}
                required
                className="h-9 w-full rounded-md border border-edge bg-surface-2 px-3 text-[13px] text-ink outline-none focus:border-accent-dim"
              />
            </div>
            <div>
              <label htmlFor="inv-desc" className="mb-1 block text-xs font-medium text-ink-secondary">
                Description / authorization mandate
              </label>
              <textarea
                id="inv-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-edge bg-surface-2 px-3 py-2 text-[13px] text-ink outline-none focus:border-accent-dim"
              />
            </div>
            <div>
              <label htmlFor="inv-risk" className="mb-1 block text-xs font-medium text-ink-secondary">
                Risk level
              </label>
              <select
                id="inv-risk"
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value as RiskLevel)}
                className="h-9 w-full rounded-md border border-edge bg-surface-2 px-2 text-[13px] text-ink outline-none focus:border-accent-dim"
              >
                {riskLevels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </div>
            {error && (
              <p className="rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving || title.trim().length < 3}>
                {saving ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Plus size={13} />
                    Create investigation
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </Panel>
    </div>
  )
}

export function Investigations() {
  const { data, loading, error } = useInvestigations()
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div>
      <PageHeader
        title="Investigations"
        description={data ? `${data.length} cases in your organization` : 'Loading investigations…'}
        actions={
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            <Plus size={14} />
            New investigation
          </Button>
        }
      />

      <div className="p-6">
        {loading && (
          <div className="flex items-center gap-2 p-8 text-xs text-ink-muted">
            <Loader2 size={14} className="animate-spin" /> Loading investigations…
          </div>
        )}
        {!loading && error !== null && <ErrorPanel error={error} />}
        {!loading && error === null && data !== null && data.length === 0 && (
          <EmptyState
            icon={<ShieldCheck size={18} />}
            title="No investigations yet"
            description="Create an investigation to begin an authorized identity verification workflow."
            action={
              <Button variant="primary" onClick={() => setDialogOpen(true)}>
                <Plus size={14} />
                New investigation
              </Button>
            }
          />
        )}
        {!loading && error === null && data !== null && data.length > 0 && (
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
                {data.map((inv) => (
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
                    <td className="px-4 py-3 font-mono text-ink-secondary">{inv.subjectIds.length}</td>
                    <td className="px-4 py-3 text-ink-secondary">{inv.createdBy}</td>
                    <td className="px-4 py-3 text-right text-xs text-ink-muted">
                      {formatRelative(inv.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialogOpen && <NewInvestigationDialog onClose={() => setDialogOpen(false)} />}
    </div>
  )
}
