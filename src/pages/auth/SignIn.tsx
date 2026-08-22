import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { AuthLayout } from './AuthLayout'
import { Button } from '../../components/ui/primitives'

const inputClass =
  'h-9 w-full rounded-md border border-edge bg-surface-2 px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent-dim'

export function SignIn() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      setError('Enter your email and password to continue.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await signIn(email, password)
      navigate('/investigations')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <h2 className="text-lg font-semibold tracking-tight">Sign in</h2>
      <p className="mt-1 text-[13px] text-ink-muted">Access your organization's workspace.</p>

      <form onSubmit={onSubmit} className="mt-7 space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Work email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@organization.com"
            className={inputClass}
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-xs font-medium text-ink-secondary">
              Password
            </label>
            <button
              type="button"
              className="text-[11px] text-ink-muted transition-colors hover:text-accent"
            >
              Forgot password?
            </button>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••"
            className={inputClass}
          />
        </div>

        {error && (
          <p className="rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" className="w-full justify-center" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-ink-muted">
        No account?{' '}
        <Link to="/signup" className="text-accent transition-colors hover:text-ink">
          Request workspace access
        </Link>
      </p>
      <p className="mt-8 border-t border-edge pt-4 text-center text-[11px] leading-relaxed text-ink-faint">
        Demo environment — any credentials sign you in as the seeded analyst.
      </p>
    </AuthLayout>
  )
}
