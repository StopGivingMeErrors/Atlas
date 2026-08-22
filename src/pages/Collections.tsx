import { FolderOpen, Plus } from 'lucide-react'
import { collections } from '../data/seed'
import { formatRelative } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import { Button, EmptyState, Panel } from '../components/ui/primitives'

export function Collections() {
  return (
    <div>
      <PageHeader
        title="Collections"
        description="Curated groups of investigations and profiles"
        actions={
          <Button variant="primary">
            <Plus size={14} />
            New collection
          </Button>
        }
      />
      <div className="p-6">
        {collections.length === 0 ? (
          <EmptyState
            icon={<FolderOpen size={18} />}
            title="No collections yet"
            description="Group related investigations and profiles into collections for easier review."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {collections.map((collection) => (
              <Panel
                key={collection.id}
                className="cursor-pointer p-4 transition-colors hover:border-edge-strong hover:bg-surface-2"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-muted text-accent">
                    <FolderOpen size={15} />
                  </span>
                  <p className="text-sm font-medium text-ink">{collection.name}</p>
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-ink-secondary">
                  {collection.description}
                </p>
                <div className="mt-3 flex items-center justify-between border-t border-edge pt-3 text-[11px] text-ink-muted">
                  <span className="font-mono">{collection.itemCount} items</span>
                  <span>Updated {formatRelative(collection.updatedAt)}</span>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
