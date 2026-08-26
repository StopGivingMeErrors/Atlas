/**
 * Presentation derivations computed from API-loaded entities.
 *
 * These functions contain NO data of their own — they project facts,
 * sources, and profiles that were loaded through service boundaries into
 * timeline/network view models. If the underlying arrays are empty the
 * output is empty; nothing here can fabricate intelligence.
 */
import type {
  FactCategory,
  IntelligenceFact,
  IntelligenceProfile,
  NetworkEdge,
  NetworkNode,
  NetworkNodeType,
  Source,
  TimelineEvent,
} from '../types'

const categoryToNodeType: Record<FactCategory, NetworkNodeType> = {
  employment: 'organization',
  education: 'organization',
  organization: 'organization',
  public_profile: 'website',
  website: 'website',
  publication: 'publication',
  social_presence: 'website',
  location: 'event',
  news_mention: 'publication',
}

export function evidenceStrength(fact: IntelligenceFact): TimelineEvent['evidenceStrength'] {
  if (fact.sourceCount >= 2 && fact.confidence >= 0.75) return 'strong'
  if (fact.sourceCount >= 1) return 'moderate'
  return 'weak'
}

/** Derives the profile timeline from verified fact records. */
export function deriveTimeline(facts: IntelligenceFact[]): TimelineEvent[] {
  return facts
    .map((fact) => ({
      id: `tl-${fact.id}`,
      profileId: fact.profileId,
      year: new Date(fact.lastVerifiedAt).getFullYear(),
      date: fact.lastVerifiedAt,
      title: `${fact.label}: ${fact.value}`,
      category: fact.category,
      sourceIds: fact.sourceIds,
      evidenceStrength: evidenceStrength(fact),
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** Derives the subject-centred network graph from fact records. */
export function deriveNetwork(
  profile: IntelligenceProfile,
  facts: IntelligenceFact[],
): { nodes: NetworkNode[]; edges: NetworkEdge[] } {
  const centerId = `nn-center-${profile.id}`
  const nodes: NetworkNode[] = [
    {
      id: centerId,
      profileId: profile.id,
      type: 'person',
      label: profile.canonicalName,
      sublabel: 'Subject of record',
    },
    ...facts.map((fact) => ({
      id: `nn-${fact.id}`,
      profileId: profile.id,
      type: categoryToNodeType[fact.category],
      label: fact.value.length > 60 ? `${fact.value.slice(0, 57)}…` : fact.value,
      sublabel: fact.label,
    })),
  ]
  const edges: NetworkEdge[] = facts.map((fact) => ({
    id: `ne-${fact.id}`,
    sourceNodeId: centerId,
    targetNodeId: `nn-${fact.id}`,
    relationship: fact.label.toLowerCase(),
    strength: fact.confidence,
    evidenceIds: fact.sourceIds,
  }))
  return { nodes, edges }
}

/** Sources referenced by any of the given facts (provenance closure). */
export function sourcesForFacts(allSources: Source[], facts: IntelligenceFact[]): Source[] {
  const wanted = new Set(facts.flatMap((fact) => fact.sourceIds))
  return allSources.filter((source) => wanted.has(source.id))
}
