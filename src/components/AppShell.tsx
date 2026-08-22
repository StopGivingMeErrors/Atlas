import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Activity,
  Camera,
  ChevronsUpDown,
  Command,
  FolderOpen,
  Hexagon,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { cn } from '../lib/utils'
import { Avatar } from './ui/primitives'
import { CommandPalette } from './CommandPalette'

const navItems = [
  { to: '/investigations', label: 'Investigations', icon: ShieldCheck },
  { to: '/capture', label: 'Capture', icon: Camera },
  { to: '/people', label: 'People', icon: Users },
  { to: '/sources', label: 'Sources', icon: Plug },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/collections', label: 'Collections', icon: FolderOpen },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AppShell() {
  const { user, organization, organizations, switchOrganization, signOut } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [orgMenuOpen, setOrgMenuOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full">
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-edge bg-surface-1 transition-[width] duration-200',
          collapsed ? 'w-14' : 'w-56',
        )}
      >
        <div className={cn('flex h-14 items-center border-b border-edge', collapsed ? 'justify-center' : 'gap-2.5 px-4')}>
          <Hexagon size={20} className="shrink-0 text-accent" strokeWidth={1.75} />
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[13px] font-semibold tracking-tight">Atlas</p>
              <p className="truncate text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                Identity Intelligence
              </p>
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="relative border-b border-edge px-2 py-2">
            <button
              onClick={() => setOrgMenuOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-surface-3"
            >
              <span className="truncate font-medium text-ink">{organization?.name}</span>
              <ChevronsUpDown size={13} className="shrink-0 text-ink-muted" />
            </button>
            {orgMenuOpen && (
              <div className="animate-fade-up absolute inset-x-2 top-full z-30 mt-1 rounded-md border border-edge bg-surface-3 p-1 shadow-panel">
                {organizations.map((org) => (
                  <button
                    key={org.id}
                    onClick={() => {
                      switchOrganization(org.id)
                      setOrgMenuOpen(false)
                    }}
                    className={cn(
                      'block w-full rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover',
                      org.id === organization?.id ? 'text-accent' : 'text-ink-secondary',
                    )}
                  >
                    {org.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md py-1.5 text-[13px] transition-colors',
                  collapsed ? 'justify-center px-0' : 'px-2.5',
                  isActive
                    ? 'bg-accent-muted font-medium text-accent'
                    : 'text-ink-secondary hover:bg-surface-3 hover:text-ink',
                )
              }
            >
              <Icon size={15} strokeWidth={1.75} className="shrink-0" />
              {!collapsed && label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-edge p-2">
          <button
            onClick={() => setPaletteOpen(true)}
            className={cn(
              'mb-1 flex w-full items-center gap-2 rounded-md border border-edge bg-surface-2 py-1.5 text-xs text-ink-muted transition-colors hover:border-edge-strong hover:text-ink-secondary',
              collapsed ? 'justify-center px-0' : 'px-2.5',
            )}
          >
            <Command size={13} />
            {!collapsed && (
              <>
                <span>Search</span>
                <kbd className="ml-auto rounded border border-edge bg-surface-1 px-1 font-mono text-[10px]">⌘K</kbd>
              </>
            )}
          </button>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink-secondary',
              collapsed ? 'justify-center px-0' : 'px-2.5',
            )}
          >
            {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            {!collapsed && 'Collapse'}
          </button>

          <div className="relative mt-1 border-t border-edge pt-2">
            <button
              onClick={() => setAccountMenuOpen((v) => !v)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md py-1.5 transition-colors hover:bg-surface-3',
                collapsed ? 'justify-center px-0' : 'px-2',
              )}
            >
              <Avatar initials={user?.fullName.split(' ').map((n) => n[0]).join('') ?? '?'} color="#3b4a5c" size="sm" />
              {!collapsed && (
                <div className="min-w-0 text-left leading-tight">
                  <p className="truncate text-xs font-medium text-ink">{user?.fullName}</p>
                  <p className="truncate text-[10px] capitalize text-ink-muted">
                    {user?.role} · {organization?.name}
                  </p>
                </div>
              )}
            </button>
            {accountMenuOpen && (
              <div className="animate-fade-up absolute bottom-full left-2 right-2 z-30 mb-1 rounded-md border border-edge bg-surface-3 p-1 shadow-panel">
                <button
                  onClick={() => {
                    signOut()
                    navigate('/signin')
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  <LogOut size={13} />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto bg-canvas">
        <Outlet />
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
