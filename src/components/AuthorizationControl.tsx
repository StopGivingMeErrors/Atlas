import { useState } from 'react'
import { useAtlas } from '../api/hooks'
import type { SubjectAuthorization } from '../types'
import { subjectAuthorizationStates } from '../services/investigations'

/**
 * Shared subject authorization lifecycle control. Used on the
 * investigation detail page and the per-subject workspace. Server-side
 * validation (basis required to grant/restrict) remains authoritative —
 * this control only mirrors it for immediate feedback.
 */
export function AuthorizationControl({
  subjectId,
  state,
}: {
  subjectId: string
  state: SubjectAuthorization
}) {
  const { investigations } = useAtlas()
  const [basis, setBasis] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = async (next: SubjectAuthorization) => {
    setError(null)
    setSaving(true)
    try {
      await investigations.updateSubjectAuthorization({
        subjectId,
        authorizationState: next,
        authorizationBasis: basis.trim() === '' ? undefined : basis.trim(),
      })
      setBasis('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.')
    } finally {
      setSaving(false)
    }
  }

  const needsBasis = state === 'authorized' || state === 'restricted'

  return (
    <div className="mt-3 rounded-md border border-edge bg-surface-2 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
        Authorization lifecycle
      </p>
      <select
        value={state}
        disabled={saving}
        onChange={(e) => void update(e.target.value as SubjectAuthorization)}
        className="mt-1.5 h-8 w-full rounded-md border border-edge bg-surface-1 px-2 text-xs text-ink outline-none focus:border-accent-dim"
      >
        {subjectAuthorizationStates.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {(needsBasis || basis !== '') && (
        <input
          value={basis}
          onChange={(e) => setBasis(e.target.value)}
          placeholder="Record the authorization basis (required to grant or restrict)"
          className="mt-1.5 h-8 w-full rounded-md border border-edge bg-surface-1 px-2 text-xs text-ink outline-none focus:border-accent-dim"
        />
      )}
      {error && <p className="mt-1.5 text-[11px] text-danger">{error}</p>}
      <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
        Granting or restricting access requires a recorded basis. Revoking removes
        resolution outputs immediately.
      </p>
    </div>
  )
}
