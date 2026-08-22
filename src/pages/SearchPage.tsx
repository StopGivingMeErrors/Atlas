import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { collections, evidence, investigations, profiles, sources } from '../data/seed'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, Panel, PanelHeader, Pill } from '../components/ui/primitives'

interface SearchResult {
  id: string
  type: string
  title: string
  detail: string
  to: string
}

export function SearchPage() {
  const [query, setQuery] = useState('')

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const all: SearchResult[] = [
      ...investigations.map((inv) => ({
        id: inv.id,
        type: 'Investigation',
        title: inv.title,
        detail: inv.description,
        to: `/investigations/${inv.id}`,
      })),
      ...profiles.map((p) => ({
        id: p.id,
        type: 'Person',
        title: p.canonicalName,
        detail: p.summary,
        to: `/people/${p.id}`,
      })),
      ...sources.map((s) => ({
        id: s.id,
        type: 'Source',
        title: s.sourceName,
        detail: s.provider,
        to: '/sources',
      })),
      ...evidence.map((e) => ({
        id: e.id,
        type: 'Evidence',
        title: e.claim,
        detail: e.evidenceType.replace('_', ' '),
        to: `/investigations/${e.investigationId}`,
      })),
      ...collections.map((c) => ({
        id: c.id,
        type: 'Collection',
        title: c.name,
        detail: c.description,
        to: '/collections',
      })),
    ]
    return all.filter((r) => `${r.title} ${r.detail} ${r.type}`.toLowerCase().includes(q))
  }, [query])

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
            placeholder="Search investigations, people, sources, evidence, collections…"
            className="h-11 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
          />
          <kbd className="rounded border border-edge bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
            ⌘K
          </kbd>
        </div>

        {query.trim() === '' ? (
          <EmptyState
            icon={<Search size={18} />}
            title="Search your workspace"
            description="Find investigations, people, sources, evidence, and collections. Tip: press ⌘K anywhere for the command palette."
          />
        ) : results.length === 0 ? (
          <EmptyState
            icon={<Search size={18} />}
            title={`No results for “${query}”`}
            description="Try different keywords, or check the spelling."
          />
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
