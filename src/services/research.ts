import type { IntelligenceFact, Source } from '../types'
import { facts, sources } from '../data/seed'
import { recordAudit } from './audit'

/**
 * Public-information research service boundary.
 *
 * Production implementations call backend connector services (web search,
 * professional profiles, news, registries). Every result preserves source,
 * URL, retrieval timestamp, and confidence — provenance is mandatory.
 */
export interface ResearchService {
  searchPerson(profileId: string): Promise<IntelligenceFact[]>
  searchProfessionalProfiles(profileId: string): Promise<Source[]>
  searchNewsMentions(profileId: string): Promise<Source[]>
  searchWebPresence(profileId: string): Promise<Source[]>
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

class DemoResearchService implements ResearchService {
  async searchPerson(profileId: string): Promise<IntelligenceFact[]> {
    recordAudit('research.search_person', 'intelligence_profile', profileId)
    await delay(1100)
    return facts.filter((f) => f.profileId === profileId)
  }

  async searchProfessionalProfiles(profileId: string): Promise<Source[]> {
    recordAudit('research.professional_profiles', 'intelligence_profile', profileId)
    await delay(700)
    return sources.filter((s) => s.sourceType === 'professional_profile')
  }

  async searchNewsMentions(profileId: string): Promise<Source[]> {
    recordAudit('research.news_mentions', 'intelligence_profile', profileId)
    await delay(700)
    return sources.filter((s) => s.sourceType === 'news')
  }

  async searchWebPresence(profileId: string): Promise<Source[]> {
    recordAudit('research.web_presence', 'intelligence_profile', profileId)
    await delay(700)
    return sources.filter((s) => s.sourceType === 'public_website')
  }
}

export const researchService: ResearchService = new DemoResearchService()
