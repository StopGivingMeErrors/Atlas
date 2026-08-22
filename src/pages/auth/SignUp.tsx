import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { AuthLayout } from './AuthLayout'
import { Button } from '../../components/ui/primitives'

const inputClass =
  'h-9 w-full rounded-md border border-edge bg-surface-2 px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent-dim'

export function SignUp() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!fullName || !email || password.length < 8) {
      setError('Provide your name, email, and a password of at least 8 characters.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await signUp(fullName, email, password)
      navigate('/investigations')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <h2 className="text-lg font-semibold tracking-tight">Request access</h2>
      <p className="mt-1 text-[13px] text-ink-muted">
        Create an account within your organization's workspace.
      </p>

      <form onSubmit={onSubmit} className="mt-7 space-y-4">
        <div>
          <label htmlFor="fullName" className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Full name
          </label>
          <input
            id="fullName"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Dana Whitfield"
            className={inputClass}
          />
        </div>
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
          <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            className={inputClass}
          />
        </div>

        {error && (
          <p className="rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" className="w-full justify-center" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-ink-muted">
        Already have access?{' '}
        <Link to="/signin" className="text-accent transition-colors hover:text-ink">
          Sign in
        </Link>
      </p>
      <p className="mt-8 border-t border-edge pt-4 text-center text-[11px] leading-relaxed text-ink-faint">
        New accounts require email verification and administrator approval before gaining
        access to investigation data.
      </p>
    </AuthLayout>
  )
}
