import type { ReactNode } from 'react'
import { Hexagon } from 'lucide-react'

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full">
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden border-r border-edge bg-surface-1 p-10 lg:flex">
        <div className="scanline absolute inset-0" />
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.35]"
          aria-hidden="true"
        >
          <defs>
            <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#1c232c" strokeWidth="1" />
            </pattern>
            <radialGradient id="glow" cx="30%" cy="30%" r="60%">
              <stop offset="0%" stopColor="rgba(76,194,255,0.10)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          <rect width="100%" height="100%" fill="url(#glow)" />
        </svg>

        <div className="relative flex items-center gap-2.5">
          <Hexagon size={22} className="text-accent" strokeWidth={1.75} />
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">Atlas</p>
            <p className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">Identity Intelligence</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
            Authorized people intelligence
          </p>
          <h1 className="mt-3 text-2xl font-semibold leading-snug tracking-tight text-ink">
            Every claim traced to a source. Every action on the record.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
            Atlas resolves identities against consented and organization-authorized records,
            aggregates public information through approved connectors, and keeps provenance,
            confidence, and audit history first-class.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4 border-t border-edge pt-6">
            {[
              ['Provenance', 'Source-linked facts'],
              ['Authorization', 'Consent on record'],
              ['Audit', 'Every action logged'],
            ].map(([title, sub]) => (
              <div key={title}>
                <p className="text-xs font-medium text-ink">{title}</p>
                <p className="text-[11px] text-ink-muted">{sub}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-[11px] text-ink-faint">
          For authorized investigative use only. All access is monitored and audited.
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  )
}
