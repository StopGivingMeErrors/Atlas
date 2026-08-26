import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn, confidenceLabel, pct } from '../../lib/utils'
import type {
  IdentityState,
  SubjectAuthorization,
  VerificationStatus,
  FactOrigin,
} from '../../types'
import { AtlasServiceError } from '../../services/errors'

/* ---------- Button ---------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent-muted text-accent border border-accent-dim/50 hover:bg-accent/20 hover:border-accent-dim',
  secondary:
    'bg-surface-3 text-ink border border-edge hover:bg-surface-hover hover:border-edge-strong',
  ghost: 'text-ink-secondary hover:text-ink hover:bg-surface-3 border border-transparent',
  danger: 'bg-danger-muted text-danger border border-danger/30 hover:bg-danger/20',
}

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none cursor-pointer whitespace-nowrap',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  )
}

/* ---------- Panels ---------- */

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-lg border border-edge bg-surface-1 shadow-panel', className)}>
      {children}
    </div>
  )
}

export function PanelHeader({
  title,
  action,
  className,
}: {
  title: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between border-b border-edge px-4 py-2.5', className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{title}</h3>
      {action}
    </div>
  )
}

/* ---------- Badges ---------- */

export function Pill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'
  children: ReactNode
  className?: string
}) {
  const tones = {
    neutral: 'bg-neutral-pill text-ink-secondary',
    ok: 'bg-ok-muted text-ok',
    warn: 'bg-warn-muted text-warn',
    danger: 'bg-danger-muted text-danger',
    accent: 'bg-accent-muted text-accent',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function IdentityStateBadge({ state }: { state: IdentityState }) {
  const config: Record<IdentityState, { label: string; tone: 'ok' | 'accent' | 'warn' | 'neutral' }> = {
    confirmed: { label: 'Confirmed', tone: 'ok' },
    probable: { label: 'Probable', tone: 'accent' },
    candidate: { label: 'Candidate', tone: 'warn' },
    unresolved: { label: 'Unresolved', tone: 'neutral' },
  }
  const { label, tone } = config[state]
  return <Pill tone={tone}>{label}</Pill>
}

export function ConfidenceBadge({ score, showPct = true }: { score: number; showPct?: boolean }) {
  const label = confidenceLabel(score)
  const tone = label === 'High' ? 'ok' : label === 'Medium' ? 'warn' : 'danger'
  return (
    <Pill tone={tone}>
      {label}
      {showPct && <span className="font-mono opacity-80">{pct(score)}</span>}
    </Pill>
  )
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const config: Record<VerificationStatus, { label: string; tone: 'ok' | 'accent' | 'neutral' | 'danger' }> = {
    verified: { label: 'Verified', tone: 'ok' },
    corroborated: { label: 'Corroborated', tone: 'accent' },
    unverified: { label: 'Unverified', tone: 'neutral' },
    disputed: { label: 'Disputed', tone: 'danger' },
  }
  const { label, tone } = config[status]
  return <Pill tone={tone}>{label}</Pill>
}

export function OriginBadge({ origin }: { origin: FactOrigin }) {
  const config: Record<FactOrigin, { label: string; tone: 'neutral' | 'accent' | 'warn' | 'ok' }> = {
    source_fact: { label: 'Source fact', tone: 'ok' },
    ai_summary: { label: 'AI summary', tone: 'accent' },
    analyst_annotation: { label: 'Analyst note', tone: 'neutral' },
    inference: { label: 'Inference', tone: 'warn' },
  }
  const { label, tone } = config[origin]
  return <Pill tone={tone}>{label}</Pill>
}

/* ---------- Avatar ---------- */

export function Avatar({
  initials,
  color,
  size = 'md',
  className,
}: {
  initials: string
  color: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const sizes = {
    sm: 'h-6 w-6 text-[10px]',
    md: 'h-8 w-8 text-xs',
    lg: 'h-11 w-11 text-sm',
    xl: 'h-16 w-16 text-lg',
  }
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white/90 ring-1 ring-white/10',
        sizes[size],
        className,
      )}
      style={{ backgroundColor: color }}
    >
      {initials}
    </div>
  )
}

/* ---------- Skeleton ---------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-shimmer rounded bg-surface-3', className)} />
}

/* ---------- Empty state ---------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg border border-edge bg-surface-2 text-ink-muted">
        {icon}
      </div>
      <p className="text-sm font-medium text-ink-secondary">{title}</p>
      {description && <p className="max-w-sm text-xs text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/* ---------- Stat ---------- */

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-[0.08em] text-ink-muted">{label}</span>
      <span className="text-sm font-medium text-ink">{value}</span>
      {sub && <span className="text-xs text-ink-muted">{sub}</span>}
    </div>
  )
}

/* ---------- Authorization state badge ---------- */

export function AuthorizationBadge({
  state,
  className,
}: {
  state: SubjectAuthorization
  className?: string
}) {
  const config: Record<
    SubjectAuthorization,
    { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' }
  > = {
    authorized: { label: 'Authorized', tone: 'ok' },
    restricted: { label: 'Restricted', tone: 'warn' },
    revoked: { label: 'Revoked', tone: 'danger' },
    undeclared: { label: 'Undeclared', tone: 'neutral' },
  }
  const { label, tone } = config[state]
  return (
    <Pill tone={tone} className={className}>
      {label}
    </Pill>
  )
}

/* ---------- Typed error panel ---------- */

/**
 * Renders service failures honestly. `provider_not_configured` always
 * surfaces as "Provider not configured." — the system never falls back to
 * demo content when a real provider is missing.
 */
export function ErrorPanel({ error }: { error: AtlasServiceError }) {
  const isAuthz = error.code === 'authorization_required'
  return (
    <Panel className={cn('p-4', isAuthz ? 'border-warn/30 bg-warn-muted' : 'border-danger/30 bg-danger-muted')}>
      <p className={cn('text-[13px] font-medium', isAuthz ? 'text-warn' : 'text-danger')}>
        {error.displayMessage}
      </p>
      {isAuthz && (
        <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
          Identity resolution and research are blocked until this subject has an
          explicit authorization record.
        </p>
      )}
      {error.code === 'provider_failure' && (
        <p className="mt-1 text-xs text-ink-muted">The provider did not return a valid response.</p>
      )}
    </Panel>
  )
}

