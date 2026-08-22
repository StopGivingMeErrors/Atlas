import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { profiles, subjects } from '../data/seed'
import { formatRelative } from '../lib/utils'
import { PageHeader } from '../components/PageHeader'
import {
  Avatar,
  ConfidenceBadge,
  EmptyState,
  IdentityStateBadge,
  Panel,
} from '../components/ui/primitives'

export function People() {
  return (
    <div>
      <PageHeader title="People" description={`${profiles.length} intelligence profiles`} />
      <div className="p-6">
        {profiles.length === 0 ? (
          <EmptyState
            icon={<Users size={18} />}
            title="No intelligence profiles yet"
            description="Profiles are created when subjects are resolved against authorized identity records."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {profiles.map((profile) => {
              const subject = subjects.find((s) => s.id === profile.subjectId)
              return (
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
                      <span className="text-[11px] text-ink-muted">
                        {subject?.evidenceCount ?? 0} evidence items
                      </span>
                    </div>
                  </Panel>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
