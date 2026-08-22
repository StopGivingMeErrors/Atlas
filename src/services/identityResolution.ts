import type { IdentityCandidate } from '../types'
import { candidates } from '../data/seed'
import { recordAudit } from './audit'

/**
 * Identity resolution service boundary.
 *
 * In production this calls a protected backend endpoint that queries only
 * authorized identity providers. Credentials never reach the frontend.
 */
export interface IdentityResolutionService {
  findCandidates(subjectId: string): Promise<IdentityCandidate[]>
  confirmCandidate(candidateId: string): Promise<void>
  rejectCandidate(candidateId: string): Promise<void>
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

class DemoIdentityResolutionService implements IdentityResolutionService {
  async findCandidates(subjectId: string): Promise<IdentityCandidate[]> {
    recordAudit('identity.search', 'subject', subjectId)
    await delay(900)
    return candidates.filter((c) => c.subjectId === subjectId)
  }

  async confirmCandidate(candidateId: string): Promise<void> {
    recordAudit('identity.confirm', 'identity_candidate', candidateId)
    await delay(400)
  }

  async rejectCandidate(candidateId: string): Promise<void> {
    recordAudit('identity.reject', 'identity_candidate', candidateId)
    await delay(300)
  }
}

export const identityResolutionService: IdentityResolutionService =
  new DemoIdentityResolutionService()
