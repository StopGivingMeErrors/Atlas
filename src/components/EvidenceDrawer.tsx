import { ExternalLink, X } from 'lucide-react'
import type { IntelligenceFact } from '../types'
import { sources } from '../data/seed'
import { formatDate, pct, confidenceLabel } from '../lib/utils'
import { ConfidenceBadge, OriginBadge, Pill, VerificationBadge } from './ui/primitives'

export function EvidenceDrawer({ fact, onClose }: { fact: IntelligenceFact | null; onClose: () => void }) {
  if (!fact) return null

  const supporting = sources.filter((s) => fact.sourceIds.includes(s.id))

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <aside
        className="animate-slide-in-right absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-edge bg-surface-1 shadow-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-edge px-5 py-3.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Evidence</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
            aria-label="Close evidence drawer"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <section>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">Claim</p>
            <p className="text-sm font-medium leading-relaxed text-ink">{fact.value}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <OriginBadge origin={fact.origin} />
              <VerificationBadge status={fact.verificationStatus} />
            </div>
          </section>

          <section>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">Confidence</p>
            <div className="flex items-center gap-3">
              <span className="font-mono text-lg font-medium text-ink">{pct(fact.confidence)}</span>
              <ConfidenceBadge score={fact.confidence} showPct={false} />
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: pct(fact.confidence) }}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">
              {confidenceLabel(fact.confidence)} — supported by {fact.sourceCount} independent{' '}
              {fact.sourceCount === 1 ? 'source' : 'sources'}
            </p>
          </section>

          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
              Supporting sources
            </p>
            <div className="space-y-1.5">
              {supporting.map((source) => (
                <div key={source.id} className="rounded-md border border-edge bg-surface-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">{source.sourceName}</p>
                      <p className="text-[11px] text-ink-muted">{source.provider}</p>
                    </div>
                    <a
                      href={source.canonicalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded p-1 text-ink-muted transition-colors hover:bg-surface-3 hover:text-accent"
                      aria-label={`Open ${source.sourceName}`}
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-ink-muted">
                    <Pill tone="neutral">Credibility {pct(source.credibilityScore)}</Pill>
                    <span>Retrieved {formatDate(source.retrievedAt)}</span>
                  </div>
                </div>
              ))}
              {supporting.length === 0 && (
                <p className="rounded-md border border-edge bg-surface-2 p-3 text-xs text-ink-muted">
                  No source records attached to this claim.
                </p>
              )}
            </div>
          </section>

          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">Timeline</p>
            <dl className="space-y-1.5 rounded-md border border-edge bg-surface-2 p-3 text-xs">
              <div className="flex justify-between">
                <dt className="text-ink-muted">First observed</dt>
                <dd className="font-mono text-ink-secondary">{formatDate(fact.firstObservedAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Last verified</dt>
                <dd className="font-mono text-ink-secondary">{formatDate(fact.lastVerifiedAt)}</dd>
              </div>
            </dl>
          </section>
        </div>
      </aside>
    </div>
  )
}
