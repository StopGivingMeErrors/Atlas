/**
 * React data-access layer. Components NEVER call providers or Supabase
 * directly — they consume services through this context and the hooks
 * below, which own loading/error state and map failures to typed errors.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getAtlasServices, type AtlasServices } from '../services/container'
import { AtlasServiceError, toAtlasServiceError } from '../services/errors'
import type {
  AuditEvent,
  Connector,
  EvidenceItem,
  IntelligenceFact,
  IntelligenceProfile,
  Investigation,
  InvestigationSubject,
  Source,
} from '../types'

/* ---------- services context ---------- */

const AtlasContext = createContext<AtlasServices | null>(null)

export function AtlasProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<AtlasServices | null>(null)
  const [bootError, setBootError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false
    getAtlasServices()
      .then((resolved) => {
        if (!cancelled) setServices(resolved)
      })
      .catch((error) => {
        if (!cancelled) setBootError(error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (bootError !== null) throw bootError
  if (services === null) return null
  return <AtlasContext.Provider value={services}>{children}</AtlasContext.Provider>
}

/** Resolves the service set for the current session. */
export function useAtlas(): AtlasServices {
  const services = useContext(AtlasContext)
  if (services === null) throw new Error('useAtlas must be used within AtlasProvider')
  return services
}

/* ---------- generic async hook ---------- */

export interface AsyncData<T> {
  data: T | null
  loading: boolean
  error: AtlasServiceError | null
  reload: () => void
}

class NotReadySignal extends Error {}

/** Thrown by hooks when a required id is not yet available. */
export const notReady = (): Promise<never> => Promise.reject(new NotReadySignal())

function useAsyncInternal<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
): AsyncData<T> & { dataOrNull: T | null } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AtlasServiceError | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loader()
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setLoading(false)
        }
      })
      .catch((err) => {
        // A pending NotReady signal (e.g. route param not yet parsed) keeps
        // the skeleton visible without surfacing an error.
        if (err instanceof NotReadySignal) return
        if (!cancelled) {
          setData(null)
          setError(toAtlasServiceError('UI', err))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, loading, error, reload, dataOrNull: data }
}

export function useAsyncData<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncData<T> {
  const internal = useAsyncInternal(loader, deps)
  return useMemo(
    () => ({ data: internal.data, loading: internal.loading, error: internal.error, reload: internal.reload }),
    [internal.data, internal.loading, internal.error, internal.reload],
  )
}

/* ---------- domain hooks ---------- */

export function useInvestigations(): AsyncData<Investigation[]> {
  const { investigations } = useAtlas()
  return useAsyncData(() => investigations.listInvestigations(), [])
}

export function useInvestigation(id: string | undefined): AsyncData<Investigation> {
  const { investigations } = useAtlas()
  return useAsyncData(
    () => (id ? investigations.getInvestigation({ id }) : notReady()),
    [id],
  )
}

export function useSubjects(investigationId: string | undefined): AsyncData<InvestigationSubject[]> {
  const { investigations } = useAtlas()
  return useAsyncData(
    () => (investigationId ? investigations.listSubjects({ investigationId }) : notReady()),
    [investigationId],
  )
}

export function useEvidence(investigationId: string | undefined): AsyncData<EvidenceItem[]> {
  const { evidence } = useAtlas()
  return useAsyncData(
    () => (investigationId ? evidence.listByInvestigation({ investigationId }) : notReady()),
    [investigationId],
  )
}

export function useEvidenceBySubject(subjectId: string | undefined): AsyncData<EvidenceItem[]> {
  const { evidence } = useAtlas()
  return useAsyncData(
    () => (subjectId ? evidence.listBySubject({ subjectId }) : notReady()),
    [subjectId],
  )
}

export function useSources(): AsyncData<Source[]> {
  const { sources } = useAtlas()
  return useAsyncData(() => sources.listSources({ limit: 500 }), [])
}

export function useConnectors(): AsyncData<Connector[]> {
  const { sources } = useAtlas()
  return useAsyncData(() => sources.listConnectors(), [])
}

export function useProfiles(): AsyncData<IntelligenceProfile[]> {
  const { publicInformation } = useAtlas()
  return useAsyncData(() => publicInformation.listProfiles(), [])
}

export interface ProfileBundle {
  profile: IntelligenceProfile
  facts: IntelligenceFact[]
}

/** Profile + its fact set; both reads are authorization-gated server-side. */
export function useProfileBundle(profileId: string | undefined): AsyncData<ProfileBundle> {
  const { publicInformation } = useAtlas()
  return useAsyncData(async () => {
    if (!profileId) throw new NotReadySignal()
    const profile = await publicInformation.getProfile({ profileId })
    const facts = await publicInformation.searchPerson({ profileId })
    return { profile, facts }
  }, [profileId])
}

export function useAuditEvents(
  input: { limit?: number; sensitiveOnly?: boolean } = {},
): AsyncData<AuditEvent[]> {
  const { audit } = useAtlas()
  const key = `${input.limit ?? 100}:${String(input.sensitiveOnly ?? false)}`
  return useAsyncData(() => audit.listEvents({ limit: 100, sensitiveOnly: false }), [key])
}

/* ---------- workspace search index ---------- */

export interface SearchEntry {
  id: string
  type: 'Investigation' | 'Person' | 'Source' | 'Evidence'
  title: string
  detail: string
  to: string
}

/**
 * Builds a client-side search index from service data only. There is no
 * grouping entity in the production schema — every entry maps to a real
 * investigation, profile, source, or evidence record.
 */
export function useSearchIndex(enabled: boolean): AsyncData<SearchEntry[]> {
  const atlas = useAtlas()
  return useAsyncData(async (): Promise<SearchEntry[]> => {
    if (!enabled) return []
    const [invs, profiles, srcs] = await Promise.all([
      atlas.investigations.listInvestigations(),
      atlas.publicInformation.listProfiles(),
      atlas.sources.listSources({ limit: 500 }),
    ])
    const evidenceLists = await Promise.all(
      invs.map((inv) =>
        atlas.evidence
          .listByInvestigation({ investigationId: inv.id })
          .catch(() => [] as EvidenceItem[]),
      ),
    )
    const evidence = evidenceLists.flat()
    return [
      ...invs.map((inv) => ({
        id: inv.id,
        type: 'Investigation' as const,
        title: inv.title,
        detail: inv.description,
        to: `/investigations/${inv.id}`,
      })),
      ...profiles.map((p) => ({
        id: p.id,
        type: 'Person' as const,
        title: p.canonicalName,
        detail: p.summary,
        to: `/people/${p.id}`,
      })),
      ...srcs.map((s) => ({
        id: s.id,
        type: 'Source' as const,
        title: s.sourceName,
        detail: s.provider,
        to: '/sources',
      })),
      ...evidence.map((e) => ({
        id: e.id,
        type: 'Evidence' as const,
        title: e.claim,
        detail: e.evidenceType.replace('_', ' '),
        to: `/investigations/${e.investigationId}`,
      })),
    ]
  }, [enabled])
}
