import { useAuth } from '../context/AuthContext'
import { PageHeader } from '../components/PageHeader'
import { Avatar, Button, Panel, PanelHeader, Pill } from '../components/ui/primitives'

export function Settings() {
  const { user, organization } = useAuth()

  return (
    <div>
      <PageHeader title="Settings" description="Account, organization, and data controls" />
      <div className="mx-auto max-w-3xl space-y-5 p-6">
        <Panel>
          <PanelHeader title="Account" />
          <div className="flex items-center gap-4 p-4">
            <Avatar
              initials={user?.fullName.split(' ').map((n) => n[0]).join('') ?? '?'}
              color="#3b4a5c"
              size="lg"
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">{user?.fullName}</p>
              <p className="text-xs text-ink-muted">{user?.email}</p>
            </div>
            <Pill tone="accent" className="capitalize">
              {user?.role}
            </Pill>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Organization" />
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-ink">{organization?.name}</p>
                <p className="text-xs text-ink-muted">Workspace slug: {organization?.slug}</p>
              </div>
              <Button variant="secondary" size="sm">
                Manage members
              </Button>
            </div>
            <div className="rounded-md border border-edge bg-surface-2 p-3 text-xs leading-relaxed text-ink-secondary">
              Roles: <span className="text-ink">Administrator</span> (full access, audit exports,
              retention controls), <span className="text-ink">Analyst</span> (run investigations
              and research), <span className="text-ink">Viewer</span> (read-only review).
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Privacy & data controls" />
          <ul className="divide-y divide-edge">
            {[
              {
                title: 'Biometric data retention',
                detail: 'Face embeddings are stored server-side only and purged 30 days after case closure.',
                action: 'Configure',
              },
              {
                title: 'Subject authorization requirements',
                detail: 'Every investigation subject requires a recorded consent status and authorization basis.',
                action: 'Review policy',
              },
              {
                title: 'Export controls',
                detail: 'Report exports are watermarked, audited, and restricted to administrator approval.',
                action: 'Configure',
              },
              {
                title: 'Delete workflows',
                detail: 'Subject deletion removes media, embeddings, facts, and evidence with a signed audit record.',
                action: 'Open',
              },
            ].map((item) => (
              <li key={item.title} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink">{item.title}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{item.detail}</p>
                </div>
                <Button variant="secondary" size="sm" className="shrink-0">
                  {item.action}
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
