import { describe, expect, it } from 'vitest'
import {
  createInvestigationInputSchema,
  decideCandidateInputSchema,
  detectFacesInputSchema,
  evidenceItemSchema,
  findCandidatesInputSchema,
  intelligenceProfileSchema,
  updateSubjectAuthorizationInputSchema,
} from '../src/services/schemas'
import { signInInputSchema, signUpInputSchema } from '../src/services/auth'
import { assertSubjectAuthorized } from '../src/services/identityResolution'
import { AuthorizationRequiredError } from '../src/services/errors'

describe('credential schemas', () => {
  it('rejects malformed sign-in payloads', () => {
    expect(signInInputSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(
      false,
    )
    expect(
      signInInputSchema.safeParse({ email: 'analyst@example.com', password: 'whatever' }).success,
    ).toBe(true)
  })

  it('enforces a minimum password length on registration', () => {
    expect(
      signUpInputSchema.safeParse({
        fullName: 'Jordan Ellis',
        email: 'jordan@example.com',
        password: 'short',
      }).success,
    ).toBe(false)
    expect(
      signUpInputSchema.safeParse({
        fullName: 'Jordan Ellis',
        email: 'jordan@example.com',
        password: 'long-enough-password',
      }).success,
    ).toBe(true)
  })
})

describe('input schemas', () => {
  it('requires investigation titles to have content', () => {
    expect(createInvestigationInputSchema.safeParse({ title: '' }).success).toBe(false)
    expect(createInvestigationInputSchema.safeParse({ title: 'ab' }).success).toBe(false)
    expect(createInvestigationInputSchema.safeParse({ title: 'Vendor due diligence' }).success).toBe(
      true,
    )
  })

  it('validates face-detection frames', () => {
    // Minimal 1x1 JPEG base64
    const minimalJpegBase64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='
    const frame = { width: 1280, height: 720, timestamp: 1234, imageBase64: minimalJpegBase64 }
    expect(detectFacesInputSchema.safeParse(frame).success).toBe(true)
    expect(detectFacesInputSchema.safeParse({ ...frame, width: -5 }).success).toBe(false)
  })

  it('identifiers are opaque but never empty', () => {
    // Database rows use uuids; fixtures may use slugs — both are valid.
    expect(findCandidatesInputSchema.safeParse({ subjectId: 'subj-3' }).success).toBe(true)
    expect(findCandidatesInputSchema.safeParse({ subjectId: '' }).success).toBe(false)
    expect(findCandidatesInputSchema.safeParse({}).success).toBe(false)
  })

  it('candidate decisions require a candidate id', () => {
    expect(decideCandidateInputSchema.safeParse({ candidateId: 'cand-1' }).success).toBe(true)
    expect(decideCandidateInputSchema.safeParse({}).success).toBe(false)
  })
})

describe('authorization transition schema', () => {
  const subjectId = 'subj-1'

  it('grants and restrictions require a recorded basis', () => {
    expect(
      updateSubjectAuthorizationInputSchema.safeParse({
        subjectId,
        authorizationState: 'authorized',
      }).success,
    ).toBe(false)
    expect(
      updateSubjectAuthorizationInputSchema.safeParse({
        subjectId,
        authorizationState: 'restricted',
      }).success,
    ).toBe(false)
    expect(
      updateSubjectAuthorizationInputSchema.safeParse({
        subjectId,
        authorizationState: 'authorized',
        authorizationBasis: 'Written consent on file',
      }).success,
    ).toBe(true)
  })

  it('revocation and undeclared transitions need no justification', () => {
    for (const state of ['revoked', 'undeclared'] as const) {
      expect(
        updateSubjectAuthorizationInputSchema.safeParse({ subjectId, authorizationState: state })
          .success,
      ).toBe(true)
    }
  })

  it('rejects states outside the lifecycle enum', () => {
    expect(
      updateSubjectAuthorizationInputSchema.safeParse({
        subjectId,
        authorizationState: 'granted',
        authorizationBasis: 'x',
      }).success,
    ).toBe(false)
  })
})

describe('output schemas', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000'

  it('profiles require derived presentation fields and bounded confidence', () => {
    const base = {
      id: uuid,
      subjectId: uuid,
      canonicalName: 'Jordan Ellis',
      summary: '',
      identityState: 'candidate',
      confidenceScore: 0.8,
      avatarColor: '#334455',
      initials: 'JE',
      lastResolvedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }
    expect(intelligenceProfileSchema.safeParse(base).success).toBe(true)
    expect(
      intelligenceProfileSchema.safeParse({ ...base, confidenceScore: 1.5 }).success,
    ).toBe(false)
    expect(intelligenceProfileSchema.safeParse({ ...base, avatarColor: 'red' }).success).toBe(
      false,
    )
  })

  it('evidence confidence is bounded [0,1]', () => {
    const base = {
      id: uuid,
      investigationId: uuid,
      subjectId: null,
      sourceId: uuid,
      factId: null,
      claim: 'Employment confirmed via registry',
      confidence: 0.9,
      evidenceType: 'registry_record',
      capturedAt: '2026-01-01T00:00:00Z',
    }
    expect(evidenceItemSchema.safeParse(base).success).toBe(true)
    expect(evidenceItemSchema.safeParse({ ...base, confidence: 2 }).success).toBe(false)
    expect(evidenceItemSchema.safeParse({ ...base, evidenceType: 'public_record' }).success).toBe(
      false,
    )
  })
})

describe('assertSubjectAuthorized gate', () => {
  it('allows only explicitly authorized subjects', () => {
    expect(() => assertSubjectAuthorized('subj-1', 'authorized')).not.toThrow()
    for (const state of ['undeclared', 'restricted', 'revoked', undefined]) {
      expect(() => assertSubjectAuthorized('subj-1', state)).toThrow(AuthorizationRequiredError)
    }
  })
})
