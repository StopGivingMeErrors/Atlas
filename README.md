# Atlas Identity Intelligence

An authorized people intelligence and identity research platform. Analysts capture or upload media, detect and select subjects, resolve identities against **consented and organization-authorized records only**, research publicly available information through approved connectors, and review evidence-backed intelligence profiles where every claim is traced to its source.

## Product principles

- **Provenance first** — no claim is shown without its supporting sources, retrieval timestamps, and confidence.
- **Authorization first** — every investigation subject carries an explicit consent status and authorization basis.
- **Accountability** — sensitive actions (searches, profile access, exports) generate audit events.
- **Clear epistemic states** — the UI always distinguishes *detected face*, *candidate identity*, *probable*, and *confirmed identity*. Low-confidence candidates are never presented as confirmed.

## Stack

- React 19 + TypeScript (strict) + Vite
- Tailwind CSS v4 (design tokens in `src/index.css`)
- React Router
- Supabase-ready schema in `supabase/migrations/0001_init.sql` (Postgres, RLS, audit logging)

## Getting started

```sh
npm install
npm run dev
```

Sign in with any credentials — the demo auth provider signs you in as the seeded analyst. The app ships with realistic fictional demo data (organizations, investigations, subjects, sources, evidence, timelines).

## Scripts

| Command           | Purpose                       |
| ----------------- | ----------------------------- |
| `npm run dev`     | Start the dev server          |
| `npm run build`   | Typecheck + production build  |
| `npm run lint`    | Lint with oxlint              |
| `npm run preview` | Preview the production build  |

## Architecture

```
src/
  components/       Reusable UI (AppShell, CommandPalette, EvidenceDrawer, NetworkGraph, primitives)
  context/          AuthContext (demo provider; swap for Supabase Auth behind the same interface)
  data/             Seeded fictional demo data
  lib/              Formatting and class utilities
  pages/            Route-level screens (Investigations, Capture, People, Profile, Sources, …)
  services/         Service boundaries:
                      faceDetection.ts       FaceDetectionProvider + tracking engine
                      identityResolution.ts  IdentityResolutionService
                      research.ts            Public-information connectors (searchPerson, …)
                      audit.ts               Client audit mirror
supabase/
  migrations/       Relational schema with foreign keys, indexes, RLS policies, audit_logs
```

### Service boundaries

The UI consumes interfaces, not implementations:

- `FaceDetectionProvider` — the demo provider produces stable synthetic detections; swap in MediaPipe, TensorFlow.js, or an authorized backend vision service without UI changes. Biometric embeddings are referenced by opaque server-side IDs and never exposed to the frontend.
- `IdentityResolutionService` — candidate search runs only against authorized identity providers; analysts must explicitly confirm candidates.
- `ResearchService` — `searchPerson`, `searchProfessionalProfiles`, `searchNewsMentions`, `searchWebPresence`; every result preserves source, URL, retrieval timestamp, and confidence.

## Scope and safety

This platform is designed exclusively for authorized identity verification: consented/enrolled identities, organization-owned datasets, and legally accessible providers. It does not perform covert identification of arbitrary strangers, unauthorized biometric surveillance, scraping of private or restricted profiles, or circumvention of platform protections.
