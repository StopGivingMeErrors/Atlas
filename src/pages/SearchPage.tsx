import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useSearchIndex } from '../api/hooks'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, ErrorPanel, Panel, PanelHeader, Pill } from '../components/ui/primitives'

export function SearchPage() {
  const [query, setQuery] = useState('')
  const indexQuery = useSearchIndex(true)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return (indexQuery.data ?? [])
      .filter((item) => `${item.title} ${item.detail} ${item.type}`.toLowerCase().includes(q))
      .slice(0, 25)
  }, [query, indexQuery.data])

  return (
    <div>
      <PageHeader title="Search" description="Search across your organization's intelligence data" />
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="flex items-center gap-2.5 rounded-lg border border-edge bg-surface-1 px-4 shadow-panel focus-within:border-accent-dim">
          <Search size={15} className="text-ink-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search investigations, people, sources, evidence…"
            className="h-11 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
          />
          <kbd className="rounded border border-edge bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
            ⌘K
          </kbd>
        </div>

        {indexQuery.error !== null && <ErrorPanel error={indexQuery.error} />}

        {query.trim() === '' ? (
          <EmptyState
            icon={<Search size={18} />}
            title="Search your workspace"
            description="Find investigations, people, sources, and evidence. Tip: press ⌘K anywhere for the command palette."
          />
        ) : results.length === 0 ? (
          !indexQuery.loading && (
            <EmptyState
              icon={<Search size={18} />}
              title={`No results for “${query}”`}
              description="Try different keywords, or check the spelling."
            />
          )
        ) : (
          <Panel>
            <PanelHeader title={`${results.length} results`} />
            <ul className="divide-y divide-edge">
              {results.map((result) => (
                <li key={`${result.type}-${result.id}`}>
                  <Link
                    to={result.to}
                    className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-surface-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">{result.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">{result.detail}</p>
                    </div>
                    <Pill tone="neutral" className="shrink-0">
                      {result.type}
                    </Pill>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  )
}
