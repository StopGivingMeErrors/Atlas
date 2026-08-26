import type { z } from 'zod'
import type { Connector, Source } from '../types'
import { listSourcesInputSchema } from './schemas'
import { ProviderNotConfiguredError } from './errors'

/**
 * Source service boundary.
 *
 * Sources are retrieved records with provenance (provider, canonical URL,
 * retrieval time, credibility). Connectors describe the configured external
 * providers and their authorization state — an empty or `not_configured`
 * connector list is a truthful production state, never back-filled with
 * demo providers.
 */
export type ListSourcesInput = z.infer<typeof listSourcesInputSchema>

export interface SourceService {
  listSources(input?: ListSourcesInput): Promise<Source[]>
  listConnectors(): Promise<Connector[]>
}

export class UnconfiguredSourceService implements SourceService {
  async listSources(): Promise<Source[]> {
    throw new ProviderNotConfiguredError('Sources')
  }

  async listConnectors(): Promise<Connector[]> {
    throw new ProviderNotConfiguredError('Sources')
  }
}
