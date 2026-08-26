import { atlasConfig, hasRealBackend } from '../config/env'
import {
  ProviderBackedFaceDetectionService,
  UnconfiguredFaceDetectionService,
  type FaceDetectionService,
} from './faceDetection'
import { EngineBackedFaceTrackingService, IoUTrackingEngine, type FaceTrackingService } from './faceTracking'
import {
  UnconfiguredIdentityResolutionService,
  type IdentityResolutionService,
} from './identityResolution'
import {
  UnconfiguredPublicInformationService,
  type PublicInformationService,
} from './publicInformation'
import { UnconfiguredSourceService, type SourceService } from './sources'
import { UnconfiguredEvidenceService, type EvidenceService } from './evidence'
import {
  UnconfiguredInvestigationService,
  type InvestigationService,
} from './investigations'
import { UnconfiguredAuditService, type AuditService } from './audit'
import { UnconfiguredAuthService, type AuthService } from './auth'
import { SupabaseAuthService } from './supabase/auth'
import { SupabaseIdentityResolutionService } from './supabase/identityResolution'
import { SupabasePublicInformationService } from './supabase/publicInformation'
import { SupabaseSourceService } from './supabase/sources'
import { SupabaseEvidenceService } from './supabase/evidence'
import { SupabaseInvestigationService } from './supabase/investigations'
import { SupabaseAuditService } from './supabase/audit'
import { HttpFaceDetectionProvider } from './providers/httpFaceDetection'
import {
  BrowserMediaCaptureService,
  UnconfiguredMediaCaptureService,
  type MediaCaptureService,
} from './mediaCapture'
import {
  SupabaseMediaStorageService,
  UnconfiguredMediaStorageService,
  type MediaStorageService,
} from './mediaStorage'

/**
 * Composition root. Decides — exactly once per session — which provider
 * set the application runs on:
 *
 *  - `api`           real application API configured (Supabase + optional
 *                    remote vision endpoint)
 *  - `demo`          development build with VITE_ATLAS_DEMO_FIXTURES=true;
 *                    providers run against /dev fixtures (never bundled in
 *                    production builds)
 *  - `unconfigured`  production without required providers: every service
 *                    call fails with ProviderNotConfiguredError and the UI
 *                    shows "Provider not configured." — no silent fallback.
 */
export type ProviderMode = 'api' | 'demo' | 'unconfigured'

export interface AtlasServices {
  readonly providerMode: ProviderMode
  readonly auth: AuthService
  readonly faceDetection: FaceDetectionService
  readonly faceTracking: FaceTrackingService
  readonly identityResolution: IdentityResolutionService
  readonly publicInformation: PublicInformationService
  readonly sources: SourceService
  readonly evidence: EvidenceService
  readonly investigations: InvestigationService
  readonly audit: AuditService
  readonly mediaCapture: MediaCaptureService
  readonly mediaStorage: MediaStorageService
}

async function buildServices(): Promise<AtlasServices> {
  const faceTracking = new EngineBackedFaceTrackingService(new IoUTrackingEngine())

  if (hasRealBackend(atlasConfig)) {
    const faceDetection =
      atlasConfig.faceDetectionEndpoint !== null
        ? new ProviderBackedFaceDetectionService(
            new HttpFaceDetectionProvider(atlasConfig.faceDetectionEndpoint),
          )
        : new UnconfiguredFaceDetectionService()

    const publicInformation = new SupabasePublicInformationService({
      deploymentProviderUrl: atlasConfig.publicInformationEndpoint,
      proxyEndpoint: atlasConfig.publicInformationProxyEndpoint,
    })

    return {
      providerMode: 'api',
      auth: new SupabaseAuthService(),
      faceDetection,
      faceTracking,
      identityResolution: new SupabaseIdentityResolutionService({
        deploymentProviderUrl: atlasConfig.identityMatchingEndpoint,
        proxyEndpoint: atlasConfig.identityMatchingProxyEndpoint,
      }),
      publicInformation,
      sources: new SupabaseSourceService(),
      evidence: new SupabaseEvidenceService(),
      investigations: new SupabaseInvestigationService(),
      audit: new SupabaseAuditService(),
      mediaCapture: new BrowserMediaCaptureService(),
      mediaStorage: new SupabaseMediaStorageService(),
    }
  }

  // Development-only fixture mode. The dynamic import is dead-code
  // eliminated from production builds because atlasConfig.demoFixturesAllowed
  // is statically false when DEV is false.
  if (atlasConfig.demoFixturesAllowed) {
    const { createDemoServices } = await import('../../dev/providers')
    const demo = createDemoServices()
    return {
      providerMode: 'demo',
      faceTracking,
      mediaCapture: new BrowserMediaCaptureService(),
      mediaStorage: new UnconfiguredMediaStorageService(),
      ...demo,
    }
  }

  return {
    providerMode: 'unconfigured',
    auth: new UnconfiguredAuthService(),
    faceDetection: new UnconfiguredFaceDetectionService(),
    faceTracking,
    identityResolution: new UnconfiguredIdentityResolutionService(),
    publicInformation: new UnconfiguredPublicInformationService(),
    sources: new UnconfiguredSourceService(),
    evidence: new UnconfiguredEvidenceService(),
    investigations: new UnconfiguredInvestigationService(),
    audit: new UnconfiguredAuditService(),
    mediaCapture: new UnconfiguredMediaCaptureService(),
    mediaStorage: new UnconfiguredMediaStorageService(),
  }
}

let cached: Promise<AtlasServices> | null = null

/** Resolve the service set for this session (memoized). */
export function getAtlasServices(): Promise<AtlasServices> {
  cached ??= buildServices().catch((error) => {
    cached = null
    throw error
  })
  return cached
}

/** Test hook: discard memoized services so the next call rebuilds. */
export function resetAtlasServicesForTests(): void {
  cached = null
}