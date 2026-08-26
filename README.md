# Atlas Identity Intelligence

An authorized people intelligence and identity research platform. Analysts capture or upload media, detect and select subjects, resolve identities against **consented and organization-authorized records only**, research publicly available information through approved connectors, and review evidence-backed intelligence profiles where every claim is traced to its source.

## Product principles

- **Provenance first** — no claim is shown without its supporting sources, retrieval timestamps, and confidence.
- **Authorization first** — every investigation subject carries an explicit authorization state (`undeclared → authorized → restricted → revoked`) and a recorded basis whenever access is granted.
- **Accountability** — sensitive actions (identity confirmations, profile access) generate append-only audit events enforced at the database level.
- **Clear epistemic states** — the UI always distinguishes *detected face*, *candidate identity*, *probable*, and *confirmed identity*. Low-confidence candidates are never presented as confirmed.
- **Honest failure** — unconfigured providers surface explicit "not configured" states instead of silently degrading to fake data.

## Stack

- React 19 + TypeScript (strict, `erasableSyntaxOnly`) + Vite
- Tailwind CSS v4 (design tokens in `src/index.css`)
- React Router
- Zod-validated service boundaries (`src/services/schemas.ts`)
- Supabase backend: auth, Postgres schema, row-level security (`supabase/migrations/`)
- Vitest + jsdom test suite

## Getting started

```sh
npm install
cp .env.example .env   # then fill in your project values
npm run dev
```

Required environment variables:

| Variable                            | Purpose                                        |
| ----------------------------------- | ---------------------------------------------- |
| `VITE_SUPABASE_URL`                 | Supabase project URL (https or localhost only) |
| `VITE_SUPABASE_ANON_KEY`            | Supabase anon key                              |
| `VITE_ATLAS_FACE_DETECTION_ENDPOINT` | Optional HTTP face-detection provider          |
| `VITE_ATLAS_DEMO_FIXTURES=true`     | Dev-only opt-in to quarantined demo fixtures   |

Without configuration the app runs in an explicit **unconfigured mode**: sign-in is disabled with a clear message and data pages show honest empty/error states rather than fake content. Demo fixtures are quarantined under `dev/fixtures` and can never be imported from application code — a test enforces this.

Apply the database schema before first use:

```sh
supabase db push   # or apply supabase/migrations/*.sql in order
```

## Scripts

| Command              | Purpose                       |
| -------------------- | ----------------------------- |
| `npm run dev`        | Start the dev server          |
| `npm run build`      | Typecheck + production build  |
| `npm run lint`       | Lint with oxlint              |
| `npm test`           | Run the Vitest suite once     |
| `npm run test:watch` | Watch mode                    |
| `npm run preview`    | Preview the production build  |

## Architecture

```
src/
  api/            AsyncData hooks over the service container (useAtlas)
  components/     Reusable UI (AppShell, CommandPalette, EvidenceDrawer, NetworkGraph, primitives)
  config/         Typed environment loading (loadConfig / hasRealBackend / providerMode)
  context/        AuthContext + RequireAuth route guard
  lib/            Formatting, class utilities, intelligence derivations
  pages/          Route-level screens (Investigations, Capture, People, Profile, Sources, …)
  services/
    schemas.ts            Zod input/output schemas for every service boundary
    errors.ts             AtlasServiceError hierarchy (provider_failure, not_configured, …)
    auth.ts               AuthService interface
    investigations.ts     InvestigationService (subjects + authorization lifecycle)
    evidence.ts           EvidenceService
    identityResolution.ts IdentityResolutionService + authorization gate
    publicInformation.ts  PublicInformationService (profiles, facts, search)
    audit.ts              AuditService (append-only events)
    sources.ts            SourceService (connectors + retrieved sources)
    faceDetection.ts      FaceDetectionProvider interface
    faceTracking.ts       Exponential smoothing tracker (client-side identity stability)
    httpFaceDetection.ts  HTTP provider for VITE_ATLAS_FACE_DETECTION_ENDPOINT
    providers/            atlasServices() composition root
      supabase/           Production providers (auth, investigations, evidence,
                          identityResolution, publicInformation, audit, sources)
dev/
  fixtures/         Quarantined in-memory demo data + demo providers (dev builds only)
supabase/
  migrations/
    0001_init.sql             Canonical schema: orgs, subjects, authorization lifecycle,
                              identity confirmations, RLS policies, triggers
    0002_production_hardening.sql  Validation triggers, audit immutability,
                                   permission tightening, extra indexes
```

### Service boundaries

The UI consumes interfaces, not implementations:

- `AuthService` — Supabase Auth backed; registration may return `null` pending email confirmation.
- `InvestigationService` — investigations and subjects; authorization transitions are validated by schema and by database triggers (basis required for grant/restrict).
- `EvidenceService` — evidence items always reference investigation, subject, source, and fact ids.
- `IdentityResolutionService` — candidate search runs only against authorized records; confirmation writes an immutable `identity_confirmations` row and updates subject/profile epistemic state. `assertSubjectAuthorized` gates every resolution call.
- `PublicInformationService` — profiles, per-channel fact retrieval; every fact preserves origin, observation windows, and source references.
- `AuditService` — append-only event log; mutation attempts are rejected by trigger.
- `FaceDetectionProvider` — demo provider produces stable synthetic detections; the HTTP provider calls a configured endpoint. Biometric embeddings are referenced by opaque server-side IDs and never exposed to the frontend.

All provider outputs are parsed through Zod schemas before reaching the UI, so demo fixtures, the database, and future external providers are interchangeable by contract.

## Scope and safety

This platform is designed exclusively for authorized identity verification: consented/enrolled identities, organization-owned datasets, and legally accessible providers. It does not perform covert identification of arbitrary strangers, unauthorized biometric surveillance, scraping of private or restricted profiles, or circumvention of platform protections.
