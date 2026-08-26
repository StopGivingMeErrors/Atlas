import type { Connector, Source } from '../../types'
import type { ListSourcesInput, SourceService } from '../sources'
import { connectorSchema, listSourcesInputSchema, sourceSchema } from '../schemas'
import { requireSupabaseClient } from './client'
import { mapProviderError, parseOrThrow } from './rows'

/**
 * Single source-row mapper shared by every service that surfaces sources,
 * so provenance fields (first retrieval, integrity hash, publication date
 * when the provider supplied one, lifecycle status) never get dropped on
 * the way to the UI.
 */
export function mapSourceRow(row: Record<string, unknown>): Source {
  return parseOrThrow('Sources', sourceSchema, {
    id: row.id,
    organizationId: row.organization_id,
    provider: row.provider,
    sourceName: row.source_name,
    canonicalUrl: row.canonical_url,
    sourceType: row.source_type,
    credibilityScore: Number(row.credibility_score),
    retrievedAt: row.retrieved_at,
    searchRunId: row.search_run_id ?? null,
    contentHash: row.content_hash ?? null,
    publishedAt: row.published_at ?? null,
    originalUrl: row.original_url ?? null,
    status: row.status ?? 'active',
  })
}

function mapConnector(row: Record<string, unknown>): Connector {
  return parseOrThrow('Sources', connectorSchema, {
    id: row.id,
    provider: row.provider,
    category: row.category,
    status: row.status,
    lastSync: row.last_sync ?? null,
    rateLimit: row.rate_limit ?? '—',
    authorizationStatus: row.authorization_status ?? 'pending',
    description: row.description ?? '',
  })
}

export class SupabaseSourceService implements SourceService {
  async listSources(input?: ListSourcesInput): Promise<Source[]> {
    const { limit } = parseOrThrow('Sources', listSourcesInputSchema, input ?? {})
    const client = requireSupabaseClient('Sources')
    try {
      const query = client
        .from('sources')
        .select('*, search_run_id, content_hash, published_at, original_url, status')
        .order('retrieved_at', { ascending: false })
        .limit(limit ?? 200)
      const { data, error } = await query
      if (error !== null) throw error
      return (data ?? []).map((row) => mapSourceRow(row as Record<string, unknown>))
    } catch (error) {
      throw mapProviderError('Sources', error)
    }
  }

  async listConnectors(): Promise<Connector[]> {
    const client = requireSupabaseClient('Sources')
    try {
      const { data, error } = await client
        .from('connectors')
        .select('*')
        .order('created_at', { ascending: true })
      if (error !== null) throw error
      return (data ?? []).map((row) => mapConnector(row as Record<string, unknown>))
    } catch (error) {
      // An unpopulated connector registry is a legitimate production state;
      // only real transport failures surface as errors.
      if (error !== null && typeof error === 'object' && 'code' in error) {
        const code = (error as { code?: string }).code
        if (code === '42P01' || code === 'PGRST205') return []
      }
      throw mapProviderError('Sources', error)
    }
  }
}
