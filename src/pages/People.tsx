import { Link } from 'react-router-dom'
import { Loader2, Users } from 'lucide-react'
import { useProfiles } from '../api/hooks'
import { formatRelative } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import {
  Avatar,
  ConfidenceBadge,
  EmptyState,
  ErrorPanel,
  IdentityStateBadge,
  Panel,
} from '../components/ui/primitives'

export function People() {
  const { data: profiles, loading, error } = useProfiles()

  return (
    <div>
      <PageHeader
        title="People"
        description={
          profiles
            ? `${profiles.length} intelligence profile${profiles.length === 1 ? '' : 's'}`
            : 'Loading people…'
        }
      />
      <div className="p-6">
        {loading && (
          <div className="flex items-center gap-2 p-8 text-xs text-ink-muted">
            <Loader2 size={14} className="animate-spin" /> Loading profiles…
          </div>
        )}
        {!loading && error !== null && <ErrorPanel error={error} />}
        {!loading && error === null && (profiles ?? []).length === 0 && (
          <EmptyState
            icon={<Users size={18} />}
            title="No intelligence profiles yet"
            description="Profiles are created when authorized subjects are resolved against authorized identity records."
          />
        )}
        {!loading && error === null && (profiles ?? []).length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {(profiles ?? []).map((profile) => (
              <Link key={profile.id} to={`/people/${profile.id}`}>
                <Panel className="animate-fade-up h-full p-4 transition-colors hover:border-edge-strong hover:bg-surface-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar initials={profile.initials} color={profile.avatarColor} size="lg" />
                      <div>
                        <p className="text-sm font-medium text-ink">{profile.canonicalName}</p>
                        <p className="text-[11px] text-ink-muted">
                          Updated {formatRelative(profile.updatedAt)}
                        </p>
                      </div>
                    </div>
                    <IdentityStateBadge state={profile.identityState} />
                  </div>
                  <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-ink-secondary">
                    {profile.summary}
                  </p>
                  <div className="mt-3 flex items-center justify-between border-t border-edge pt-3">
                    <ConfidenceBadge score={profile.confidenceScore} />
                    <span className="text-[11px] text-ink-muted">Resolution confidence</span>
                  </div>
                </Panel>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
