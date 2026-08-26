import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Plug, Search, ShieldCheck, User, type LucideIcon } from 'lucide-react'
import { useSearchIndex } from '../api/hooks'
import type { SearchEntry } from '../api/hooks'
import { cn } from '../lib/utils'

interface PaletteItem {
  id: string
  group: string
  label: string
  sublabel: string
  icon: LucideIcon
  to: string
}

const typeIcon: Record<SearchEntry['type'], LucideIcon> = {
  Investigation: ShieldCheck,
  Person: User,
  Source: Plug,
  Evidence: FileText,
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const indexQuery = useSearchIndex(open)

  const index = useMemo<PaletteItem[]>(
    () =>
      (indexQuery.data ?? []).map((entry) => ({
        id: entry.id,
        group: entry.type,
        label: entry.title,
        sublabel: entry.detail,
        icon: typeIcon[entry.type],
        to: entry.to,
      })),
    [indexQuery.data],
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return index.slice(0, 8)
    return index
      .filter((item) => `${item.label} ${item.sublabel} ${item.group}`.toLowerCase().includes(q))
      .slice(0, 10)
  }, [query, index])

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        setQuery('')
        setActive(0)
        inputRef.current?.focus()
      })
    }
  }, [open])

  const clampedActive = Math.min(active, Math.max(results.length - 1, 0))

  if (!open) return null

  const select = (item: PaletteItem) => {
    onClose()
    navigate(item.to)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(Math.min(clampedActive + 1, results.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(clampedActive - 1, 0))
    }
    if (e.key === 'Enter' && results[clampedActive]) select(results[clampedActive])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[14vh]" onClick={onClose}>
      <div
        className="animate-fade-up w-full max-w-xl rounded-lg border border-edge-strong bg-surface-2 shadow-panel"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-edge px-4">
          <Search size={15} className="text-ink-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search investigations, people, sources, evidence…"
            className="h-11 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
          />
          <kbd className="rounded border border-edge bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
            ESC
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {indexQuery.error !== null && (
            <p className="px-3 py-6 text-center text-xs text-warn">
              {indexQuery.error.displayMessage}
            </p>
          )}
          {indexQuery.error === null && indexQuery.loading && (
            <p className="px-3 py-6 text-center text-xs text-ink-muted">Building search index…</p>
          )}
          {indexQuery.error === null && !indexQuery.loading && results.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-ink-muted">
              No results for “{query}”.
            </p>
          )}
          {results.map((item, i) => {
            const showGroup = i === 0 || item.group !== results[i - 1].group
            const Icon = item.icon
            return (
              <div key={`${item.group}-${item.id}`}>
                {showGroup && (
                  <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                    {item.group}
                  </p>
                )}
                <button
                  onClick={() => select(item)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                    i === clampedActive ? 'bg-accent-muted' : 'hover:bg-surface-3',
                  )}
                >
                  <Icon size={14} className={i === clampedActive ? 'text-accent' : 'text-ink-muted'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{item.label}</span>
                    <span className="block truncate text-[11px] capitalize text-ink-muted">{item.sublabel}</span>
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
