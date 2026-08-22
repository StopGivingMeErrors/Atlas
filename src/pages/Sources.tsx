import { ExternalLink, Plug } from 'lucide-react'
import { connectors, sources } from '../data/seed'
import { formatRelative, pct } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import { Button, Panel, PanelHeader, Pill } from '../components/ui/primitives'
import type { ConnectorStatus } from '../types'

const statusConfig: Record<ConnectorStatus, { label: string; tone: 'ok' | 'warn' | 'neutral' | 'danger' }> = {
  connected: { label: 'Connected', tone: 'ok' },
  degraded: { label: 'Degraded', tone: 'warn' },
  paused: { label: 'Paused', tone: 'neutral' },
  not_configured: { label: 'Not configured', tone: 'neutral' },
}

export function Sources() {
  return (
    <div>
      <PageHeader
        title="Sources"
        description="Data connectors and retrieved source records"
        actions={
          <Button variant="primary">
            <Plug size={14} />
            Add connector
          </Button>
        }
      />

      <div className="space-y-6 p-6">
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
            Connectors
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {connectors.map((connector) => {
              const status = statusConfig[connector.status]
              return (
                <Panel key={connector.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[13px] font-medium text-ink">{connector.provider}</p>
                      <p className="text-[11px] text-ink-muted">{connector.category}</p>
                    </div>
                    <Pill tone={status.tone}>{status.label}</Pill>
                  </div>
                  <p className="mt-2.5 text-xs leading-relaxed text-ink-secondary">
                    {connector.description}
                  </p>
                  <dl className="mt-3 space-y-1 border-t border-edge pt-3 text-[11px]">
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Last sync</dt>
                      <dd className="font-mono text-ink-secondary">
                        {connector.lastSync ? formatRelative(connector.lastSync) : '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Rate limit</dt>
                      <dd className="font-mono text-ink-secondary">{connector.rateLimit}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Authorization</dt>
                      <dd className="capitalize text-ink-secondary">{connector.authorizationStatus}</dd>
                    </div>
                  </dl>
                </Panel>
              )
            })}
          </div>
        </section>

        <section>
          <Panel>
            <PanelHeader title={`Retrieved sources (${sources.length})`} />
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-edge text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                  <th className="px-4 py-2 font-semibold">Source</th>
                  <th className="px-4 py-2 font-semibold">Provider</th>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 font-semibold">Credibility</th>
                  <th className="px-4 py-2 text-right font-semibold">Retrieved</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id} className="border-b border-edge transition-colors last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <a
                        href={source.canonicalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="group inline-flex items-center gap-1.5 text-ink transition-colors hover:text-accent"
                      >
                        <span className="max-w-xs truncate">{source.sourceName}</span>
                        <ExternalLink size={11} className="text-ink-faint group-hover:text-accent" />
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-ink-secondary">{source.provider}</td>
                    <td className="px-4 py-2.5">
                      <Pill tone="neutral" className="capitalize">
                        {source.sourceType.replace('_', ' ')}
                      </Pill>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-ink-secondary">{pct(source.credibilityScore)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-ink-muted">
                      {formatRelative(source.retrievedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </section>
      </div>
    </div>
  )
}
