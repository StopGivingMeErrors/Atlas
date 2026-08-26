# Production Reality Matrix

**Audit date:** 2026-08-23  
**Evidence & provenance hardening:** 2026-08-24 (migration `0004_evidence_provenance_hardening.sql` applied and exercised against a live embedded PostgreSQL 18 instance — see `tests/atlas-db.test.ts`)  
**Public-information ingestion seam:** 2026-08-25 (migration `0007_public_information_ingestion.sql` applied and exercised against a live embedded PostgreSQL instance; versioned wire contract v1, orchestrator, UI panel, and local-provider E2E suite added — see below)  
**Scope:** `petdating/` application code, `supabase/migrations/`, `tests/`, `dev/` fixtures.  
**Rule:** code existing is not evidence that a capability works. A capability is production-real only if a user-facing path, a service implementation, a real provider, durable storage, and a test against that stack all exist.

## How to read this document

| Column | Meaning |
| --- | --- |
| **UI** | A screen or control exists that a user can reach. `Placeholder` means the control is visible but has no handler, is disabled, or cannot complete the job. |
| **Service** | A typed service boundary and a production (Supabase/HTTP) implementation exist in `src/services`. `Unconfigured stub` means the only production-safe path throws `ProviderNotConfiguredError`. |
| **Real Provider** | An actual external system is called (Supabase Auth, a vision API, a search/news connector, etc.). Reading rows that some other process would have to insert is **not** a provider. |
| **Real DB** | The production path reads/writes Postgres tables defined in migrations. `Schema only` means tables exist in SQL but the app never uses them, or writes would be denied by RLS. `Unproven` means the SQL exists but has not been applied or exercised against a live database in this repo. |
| **E2E Tested** | An automated test drives the real UI + real provider + real database. Unit tests against in-memory stubs do not count. |
| **Status** | Honest verdict for production. |

**Repo configuration at audit time**

- `.env.example` leaves `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_ATLAS_FACE_DETECTION_ENDPOINT` empty.
- There is no `supabase/config.toml`, no seed, no linked hosted project. However, migrations 0001–0007 **have been applied in order against a real embedded PostgreSQL instance** by the integration suite (`tests/atlas-db.test.ts`), which installs the minimal Supabase surface the schema expects (`auth` schema, `auth.uid()` reading `request.jwt.claims`, `anon`/`authenticated` roles) and proves RLS, triggers, and lifecycle constraints live. This is NOT a hosted Supabase verification: GoTrue, PostgREST, and Storage are not exercised.
- Tests are Vitest + jsdom for units; **`tests/atlas-db.test.ts` boots real Postgres**; a **credential-gated Playwright harness** exists (`e2e/`) that drives the hosted stack when seeded credentials are present and skips honestly otherwise.
- Demo fixtures under `dev/` are quarantined from `src/` (enforced by `tests/fixture-quarantine.test.ts`) and load only when `DEV && VITE_ATLAS_DEMO_FIXTURES=true`. They are **not** a production path.

Without env credentials the composition root (`src/services/container.ts`) runs `unconfigured` mode: every data service throws `ProviderNotConfiguredError`. That is honest failure, not a working product.

---

## Matrix

| Capability | UI | Service | Real Provider | Real DB | E2E Tested | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Authentication | Yes (sign-in, sign-up, sign-out) | Yes (`SupabaseAuthService`) | Yes, **if** Supabase Auth is configured | Partial (`public.users` + `organization_members`; no provisioning trigger) | No | **Wired, unconfigured, unproven.** Sign-up cannot join an org. Forgot-password is dead. |
| Database | N/A | Supabase client factory | Unconfigured (empty env, no project config) | **Migrations 0001–0005 applied in order against real embedded Postgres; RLS/triggers/constraints live-tested** | Integration (real PG, simulated Supabase roles) | **Schema verified on a real database engine. Hosted Supabase still absent.** |
| Investigations | Yes (list, detail, create dialog, **subject enrollment**) | Yes (`SupabaseInvestigationService` incl. `createSubject`/`getSubject`) | None beyond Supabase Postgres | Tables + SELECT/INSERT/UPDATE policies for investigations | No | **CRUD plus subject enrollment.** Cases are now populated in-app; enrollment navigates into the per-subject workspace. |
| Subjects | Yes (list, auth control, **enrollment form, per-subject workspace at `/subjects/:id`**) | Yes (`createSubject`, `getSubject`, `updateSubjectAuthorization`; org/actor derived server-side) | None | Table exists; INSERT policy (0003); enrollment audited as `subject.created` (sensitive when authorized); **basis-required trigger live-tested** | Unit tests (stub client) + Integration (real PG) | **IMPLEMENTED + NOT LIVE VERIFIED.** The full analyst path works in-app: enroll subject → grant authorization with basis → capture/link media → run matching → review candidates → confirm/reject. Hosted verification still blocked (no project). |
| Authorization | Yes (per-subject lifecycle control) | Yes (Zod + `assertSubjectAuthorized` + DB trigger for confirmations) | None (policy is in-app + SQL, not an external IAM product) | `subjects.authorization_state/basis`; grant/restrict require basis via trigger; **DB-side gates for evidence, facts, search_runs, candidate status (0003); candidate-status gate and audit attribution LIVE-TESTED (0004 suite)** | Integration (real PG) | **Lifecycle is real in SQL, the client gate, and now against a live database. Org switcher still does not change data scope.** |
| Camera | Yes (`getUserMedia` live video) | Yes (`MediaCaptureService`) | Browser camera | No | No | **Real camera preview + frame capture.** MediaStream lifecycle managed; frames captured to Blob via canvas; explicit error states for permission denied, not available, in use. |
| Image capture | Yes (file input + camera frame) | Yes (`MediaCaptureService.validateMedia`) | Browser File API | **`media_assets` row persisted on every upload** (org/actor derived from session; checksum + subject lineage in metadata; storage object rolled back if the DB insert fails); Supabase Storage (if configured) | No | **Real frame capture + durable persistence.** Uploads now produce a queryable media record (`listByInvestigation`), not an orphaned storage blob. Hosted verification still blocked. |
| Face detection | Yes (overlay, pipeline states, honest unconfigured banner) | Yes (`FaceDetectionService` + `HttpFaceDetectionProvider`) | **Configured via `VITE_ATLAS_FACE_DETECTION_ENDPOINT`** — sends actual image bytes as multipart/form-data | `detected_faces` table exists | No | **IMPLEMENTED + NOT CONFIGURED.** Real image bytes sent as multipart/form-data; Zod-validated response; explicit error states (`PROVIDER_NOT_CONFIGURED`, `NO_FACE`, `FACE_DETECTED`, `FACE_DETECTION_PROVIDER_ERROR`, `FACE_DETECTION_INVALID_RESPONSE`, `FACE_DETECTION_TIMEOUT`, `FACE_DETECTION_INVALID_IMAGE`). Demo provider removed from production bundle. |
| Face tracking | Yes (overlay follows `trackId` with lifecycle badges) | Yes (`FaceTrackingService` + `IoUTrackingEngine` + `ExponentialSmoothingTracker`) | Browser client math (IoU-based association) | No | Unit tests (IoU, lifecycle, multi-face, loss, expiration, crossing, staleness, reset) | **IMPLEMENTED + NOT LIVE VERIFIED.** Real IoU-based temporal association with full track lifecycle (ACTIVE/TEMPORARILY_LOST/EXPIRED). Requires configured face detection endpoint for live verification. |
| Authorized identity matching | Yes (Capture "Run identity matching" for the selected face/track + workspace candidate review; "Provider candidate" honesty pills) | Yes (`IdentityResolutionService` + `SupabaseIdentityResolutionService` orchestrating a **versioned external contract v1** (`httpIdentityMatching.ts`); `matchIdentity` walks the REAL search-run lifecycle (`queued → running → completed | no_results | failed(reason)`), persists provider output with **provider_candidate_id + search_run_id + SHA-256 raw fingerprint** (0006), and returns the recorded rows) | **Config precedence: organization `matching_provider_url` (credentialless direct) → deployment proxy `VITE_ATLAS_IDENTITY_MATCHING_PROXY_ENDPOINT` (secrets server-side in `supabase/functions/identity-match`) → legacy direct endpoint.** Only contract fields cross the wire — never user/org/subject metadata. Deterministic failure taxonomy: timeout / rate_limited / auth_failed / provider_error / invalid_response / network, each recorded as a failed run + audited + thrown honestly. Post-build guard scans the bundle for secret-shaped tokens. | `identity_candidates` (+0006 correlation columns) + `search_runs` + `audit_events`: every attempt — success OR failure — leaves durable provenance; recording is DB-audited as a sensitive event; confirmation remains a separate durable analyst decision | Unit tests: wire contract against a REAL local HTTP server (`httpIdentityMatching.test.ts`, 13 cases) + orchestration lifecycle/taxonomy/dedup/provenance (`identityMatchingOrchestration.test.ts`) + integration (real PG: 0006 columns + run correlation) + **LOCAL PROVIDER E2E (`identityMatching.spec.ts`): real UI → real adapter → intercepted local provider → real DB → review → audit** | **Truth state per tier — IMPLEMENTATION: verified. LOCAL PROVIDER E2E: written (seeded mode). HOSTED SUPABASE E2E: same suite, runs when seeded credentials exist. REAL EXTERNAL PROVIDER: NOT VERIFIED — no third-party matcher has ever been contacted; the local HTTP server proves the boundary classes only, never the real service.** Unconfigured = honest no-op with zero writes and zero audit events. |
| Public information / OSINT | Yes (profile "Public information research" panel: channel select + "Run research"; honest state banners for not-configured/completed/no-results/timeout/rate-limited/auth-failed/provider-error/invalid-response/network; "Provider-reported" provenance pills + provider-confidence labels on facts; published dates on sources) | Yes (`PublicInformationService` + `SupabasePublicInformationService` orchestrating a **versioned external contract v1** (`httpPublicInformation.ts`); `searchExternal` walks the REAL search-run lifecycle (`queued → running → completed | no_results | failed(reason)`), ingests provider output as sources (+retrieval history), additive-only facts with **provider_result_id + search_run_id + provider_confidence** (0007), deduplicated evidence lineage links, and returns the recorded sources. `searchPerson` remains an audited READ — it never fabricates runs) | **Config precedence: organization connector `endpoint_url` (category `public_information`, credentialless direct) → deployment proxy `VITE_ATLAS_PUBLIC_INFORMATION_PROXY_ENDPOINT` (secrets server-side in `supabase/functions/public-information`) → legacy direct endpoint.** Only contract fields cross the wire — exactly `{contract_version, correlation_id, full_name}`; never user/org/subject metadata (asserted by test). Deterministic failure taxonomy mapped 1:1 onto `search_failure_reason`. Post-build guard scans the bundle for secret-shaped tokens | `sources` (immutable first-retrieval provenance; NO content_hash ever written by this contract) + `source_retrievals` (per-run history) + `intelligence_facts` (+0007 correlation columns) + `evidence_items` (lineage) + `search_runs` + `audit_events`: every attempt — success OR failure — leaves durable provenance | Unit tests: wire contract against a REAL local HTTP server (`httpPublicInformation.test.ts`, 17 cases) + orchestration lifecycle/taxonomy/dedup/history/audit (`publicInformationOrchestration.test.ts`) + integration (real PG: 0007 columns, FK ON DELETE SET NULL, bounded confidence) + **LOCAL PROVIDER E2E (`publicInformation.spec.ts`): real UI → real adapter → intercepted local connector → real DB → provenance → audit** | **Truth state per tier — IMPLEMENTATION: verified. LOCAL PROVIDER E2E: written (seeded mode). HOSTED SUPABASE E2E: same suite, runs when seeded credentials exist. REAL EXTERNAL PROVIDER: NOT VERIFIED — no third-party OSINT service has ever been contacted; the local fixture proves boundary classes only.** |
| Sources | Yes (connector cards + retrieved-source list with status pills and content fingerprints) | Yes (`SourceService` + `SupabaseSourceService`, shared provenance row mapper) | None — sources arrive via connectors/external ingestion | `sources`: original_url/published_at/content_hash/status columns, immutability trigger, status lifecycle (revoked terminal), per-run retrieval junction, org-scoped URL-normalized dedup — **all live-tested** | Integration (real PG) | **IMPLEMENTED + NOT CONFIGURED.** Provenance is enforced immutable at the database level; dedup collapses equivalent URLs (scheme/host case, default ports, userinfo, fragments) before the org-scoped unique index. Requires external ingestion to populate. |
| Evidence | Partial (list + drawer showing source status, fingerprint, run reference; add-evidence requires a source) | Yes (`list*` + `addEvidence`, sourceId required by schema) | None | Table exists; INSERT policy with authorization gate (0003); **cross-organization lineage guard trigger (0004, live-tested)** | Integration (real PG) | **Lineage integrity enforced in the database**: evidence can never reference another org's source or fact, even through direct-ID writes. UI write path still absent. |
| Audit events | Yes (Activity page, investigation activity tab) | Yes (`SupabaseAuditService` + best-effort inserts) | None | Append-only trigger real SQL **and live-tested (UPDATE/DELETE raise)**; **actor attribution cannot be forged by clients (trigger override, live-tested)**; source-status-change and candidate-recording audit triggers live-tested | Integration (real PG) | **Append-only log verified against a live database.** Sensitive filter in the UI still does not match recorded action names; hook ignores `sensitiveOnly`. |
| RLS isolation | Org switcher UI (client-only) | `is_org_member` / `can_write` SQL helpers | Postgres RLS | Policies on every table; write coverage complete (0003) plus scoped UPDATE paths for sources/search-run lifecycle (0004) | **Integration: two-org direct-ID isolation proven live across subjects, sources, facts, candidates, runs, evidence, retrievals, audit** | **SELECT isolation now verified against real Postgres.** Switcher still does not filter queries; isolation remains org-membership based, not need-to-know. |

---

## Per-capability evidence

### Authentication

**What is real**

- Sign-in / sign-up pages call `AuthService`. Production implementation is `SupabaseAuthService` using `signInWithPassword`, `signUp`, `getSession`, `signOut`.
- `RequireAuth` blocks the shell until a session exists.
- Unconfigured mode throws; `AuthContext` treats that as unauthenticated, so the user sees sign-in rather than fake data.

**What is not**

- No configured Supabase project in this repo.
- Sign-up inserts `public.users` with `organization_id: null` and does **not** insert `organization_members`. There is no `on_auth.users` trigger. `organization_members` has SELECT-only RLS, so the client cannot grant membership.
- After sign-up, `createInvestigation` refuses users with no organization.
- “Forgot password?” has no `onClick` and no `resetPassword` call.
- Settings “Manage members” has no handler.
- `switchOrganization` only sets React state. Queries are not scoped to the selected org.
- Tests never call Supabase Auth.

**Verdict:** the Auth adapter is a real client for a backend that is not present, and workspace provisioning is missing.

### Database

**What is real**

- `supabase/migrations/0001_init.sql`, `0002_production_hardening.sql`, and **`0003_security_fixes.sql`** define a coherent Postgres schema: orgs, users, investigations, subjects, media, faces, candidates, confirmations, profiles, facts, sources, connectors, evidence, search runs, audit, enums, indexes, RLS, triggers.

**What is not**

- No `config.toml`, no seed, empty env, no hosted `db push` / apply evidence.
- Application unit tests never open Postgres; **`tests/atlas-db.test.ts` does** (embedded PG, all four migrations in order).

**Verdict:** a migration pack, verified on a real database engine in-repo, but not yet a hosted production database.

### Investigations

**What is real**

- UI lists investigations, opens detail, and can submit `createInvestigation`.
- Supabase service inserts into `investigations` with the caller's `users.organization_id`.
- RLS: members SELECT; analysts INSERT/UPDATE.

**What is not**

- No subject-create API or UI. Detail empty-state says "Add subjects from the Capture workflow"; Capture only **selects** existing subjects.
- `created_by` is stored as `auth.users` UUID and shown as if it were a display name.
- Create does not reload the list (dialog closes; list hook is not invalidated unless remounted).
- No E2E or live-DB test.

**Verdict:** you can open an empty investigation record if Auth + org membership + applied schema exist. That stack is not present here.

### Subjects

**What is real**

- List subjects for an investigation; show authorization/identity badges; update authorization state.
- **RLS INSERT policy for analysts added in 0003** (service has no `createSubject` yet).

**What is not**

- `InvestigationService` has no `createSubject`.
- No application `insert` into `subjects`.
- Capture never writes a subject, media row, or face row.

**Verdict:** subjects are a read model for rows that must be inserted out-of-band (SQL/service role). The product cannot enroll a person of interest.

### Authorization

**What is real**

- Explicit states: `undeclared | authorized | restricted | revoked`.
- Client gate `assertSubjectAuthorized` used by identity resolution, public information, and evidence writes.
- DB trigger `validate_subject_authorization` requires a non-empty basis for `authorized`/`restricted`.
- DB trigger `gate_candidate_decisions` blocks `identity_confirmations` unless the subject is `authorized`.
- **DB triggers enforce authorization gates for `evidence_items`, `search_runs`, `intelligence_facts`, and `identity_candidates.match_status` updates (0003)**.
- UI control on the investigation subject card.
- **Schema validation (Zod) requires `authorizationBasis` for `authorized`/`restricted` transitions**.

**What is not**

- Basis input is optional in the UI at the moment of the select change; if the user changes state before typing a basis, the request goes out without one and the trigger should reject. That interaction is untested.
- Revoke does **not** "remove resolution outputs immediately" as the UI copy claims. Confirmations and profiles are not deleted or hidden by the update itself (profiles are filtered on list by `authorized`, which is a read filter, not a purge).
- No test against the trigger on a live database.
- Role (`administrator` / `analyst` / `viewer`) is displayed but not enforced in the UI; RLS `can_write` would enforce some writes **if** policies existed for those writes.

**Verdict:** the authorization *model* is implemented in two layers (app + DB). The *product behavior* (grant → resolve → revoke → outputs disappear) is not end-to-end real.

### Camera

**What is real**

- `MediaCaptureService` — typed service boundary with `BrowserMediaCaptureService` implementation.
- `navigator.mediaDevices.getUserMedia()` with configurable constraints (width, height, facingMode).
- Live `<video>` preview via `HTMLVideoElement`, permission states (idle/requesting/live/denied).
- Frame capture via `canvas.drawImage()` → `Blob` (JPEG, 0.92 quality).
- Explicit error states: `CAMERA_PERMISSION_DENIED`, `CAMERA_NOT_AVAILABLE`, `CAMERA_IN_USE`, `STREAM_FAILED`, `CAPTURE_FAILED`, `MEDIA_API_UNAVAILABLE`.
- Proper MediaStream lifecycle: tracks stopped on capture session end, component unmount, error recovery.
- No auto-start; permission requested only on explicit user action.

**What is not**

- Face detection still uses separate HTTP endpoint (no pixels sent in detection payload).
- Stream not auto-recorded to Storage unless capture workflow invoked.
- No hardware tests in CI (browser APIs mocked in unit tests).

**Verdict:** Real camera pipeline with frame capture, validation, and honest error states. MediaStream lifecycle correctly managed.

### Image capture

**What is real**

- `MediaCaptureService.validateMedia()` — validates Blob for MIME type (`image/jpeg`, `image/png`, `image/webp`), dimensions (10–8000px), size (max 10 MB).
- Camera frame capture: `canvas.drawImage(video)` → `canvas.toBlob('image/jpeg', 0.92)` → validated `CapturedMedia`.
- File upload: `<input type="file" accept="image/*">` → `Blob` → validated via same boundary.
- `MediaStorageService` — typed boundary with `SupabaseMediaStorageService` implementation.
- Supabase Storage upload to `media-assets` bucket with structured path `investigations/{id}/{timestamp}-{random}.{ext}`.
- SHA-256 checksum computed on upload.
- Download via signed URL or public URL.
- Capture workflow UI: capture → validate → store/download with explicit states (idle/capturing/captured/validating/uploading/success/error).

**What is not**

- No Supabase Storage configured in repo (env vars empty) — capture validates but reports `STORAGE_NOT_CONFIGURED`.
- No automatic face detection on captured frame (separate HTTP endpoint required).
- No CI hardware tests.

**Verdict:** Real capture + validation pipeline with Supabase Storage integration. Honest `STORAGE_NOT_CONFIGURED` state when not configured.

### Face detection

**What is real**

- `FaceDetectionService` — typed service boundary with `ProviderBackedFaceDetectionService` implementation.
- `HttpFaceDetectionProvider` — sends actual image bytes as `multipart/form-data` (image + width/height/timestamp metadata) to `VITE_ATLAS_FACE_DETECTION_ENDPOINT`.
- Input schema includes `imageBase64` (base64-encoded JPEG/PNG/WebP) alongside width, height, timestamp.
- Response validated with Zod schema (`detectedFaceSchema`) — each face has `id`, `trackingId`, `boundingBox` (x, y, width, height), `confidence`, `orientation`, `frameTimestamp`.
- Explicit error types: `FACE_DETECTION_PROVIDER_NOT_CONFIGURED`, `FACE_DETECTION_PROVIDER_ERROR`, `FACE_DETECTION_INVALID_RESPONSE`, `FACE_DETECTION_INVALID_IMAGE`, `FACE_DETECTION_TIMEOUT`.
- Provider sends actual image bytes as `multipart/form-data` (field `image` + metadata fields).
- Request timeout configurable (default 30s); aborts via `AbortController`.
- Response validated with Zod before returning to UI; invalid responses raise `FACE_DETECTION_INVALID_RESPONSE`.
- Explicit pipeline states in UI: `PROVIDER_NOT_CONFIGURED`, `NO_FACE`, `FACE_DETECTED`, `TRACKING`.
- Demo provider removed from production builds (was in `dev/providers`, never bundled in production).

**What is not**

- No vision model in repo (no MediaPipe, no TF.js, no ONNX) — requires external endpoint.
- Endpoint unset by default (`VITE_ATLAS_FACE_DETECTION_ENDPOINT` empty in `.env.example`).
- No in-repo vision model; requires deploying a compatible vision service (accepts multipart/form-data, returns `DetectedFace[]`).
- `detected_faces` table exists but unused by detection pipeline (persistence not wired).
- No CI hardware tests (browser APIs mocked in unit tests).

**Verdict:** **IMPLEMENTED + NOT CONFIGURED.** Real image bytes sent as multipart/form-data; Zod-validated response; explicit error states. Requires configuring `VITE_ATLAS_FACE_DETECTION_ENDPOINT` with a compatible vision endpoint.

### Face tracking

**What is real**

- `FaceTrackingService` — typed service boundary with `IoUTrackingEngine` implementation (IoU-based temporal association with track lifecycle).
- `ExponentialSmoothingTracker` — legacy smoothing tracker retained for backward compatibility; used in unit tests.
- Real temporal association: IoU-based matching (threshold 0.3) with center-point distance fallback (0.15 normalized).
- Track lifecycle: ACTIVE → TEMPORARILY_LOST (3 frames) → EXPIRED (10 frames).
- Stable tracking IDs assigned by tracker; detector does not need to provide tracking IDs.
- Multiple face support: multiple simultaneous faces maintain distinct track IDs.
- Temporary loss handling: faces can disappear for up to 3 frames and recover same track ID.
- Expiration: tracks expire after 10 frames of absence; new detections get new track IDs.
- Stability threshold: tracks only reported after 2 consecutive frames of detection.
- Crossing paths: spatial association attempts to preserve track continuity; documented limitation when paths cross.
- Frame order protection: stale/out-of-order detection results are ignored; tracker uses frame timestamps.
- Reset behavior: tracker resets on session end, camera stop, or explicit reset.
- Capture page uses container's `faceTracking` service (not local tracker).
- Unit tests in `tests/faceTracking.test.ts` cover IoU association, lifecycle, multiple faces, temporary loss, expiration, crossing paths, stale frame handling, and reset.

**What is not**

- No biometric/appearance-based re-identification (pure spatial tracking).
- No identity inference — tracking IDs are NOT person identities.
- Face detection provider still NOT CONFIGURED (requires `VITE_ATLAS_FACE_DETECTION_ENDPOINT`).
- No CI hardware tests (browser APIs mocked in unit tests).
- Crossing-path ambiguity documented: spatial-only tracking cannot perfectly resolve identity when faces cross.

**Verdict:** **IMPLEMENTED + NOT LIVE VERIFIED.** Real IoU-based temporal association with full track lifecycle. Requires configured face detection endpoint for live verification. Tracking IDs are temporary/system identifiers only — NOT person identities.

### Authorized identity matching

**What is real**

- `IdentityResolutionService` — typed service boundary with `SupabaseIdentityResolutionService` orchestrator.
- **Versioned external contract v1** (`src/services/providers/httpIdentityMatching.ts`) — the ONLY module that knows the wire format. Strict Zod response schema (`.strict()` on every object: unknown fields are rejections, not noise).
- Request fields (exactly these, never more): `contract_version`, `correlation_id`, `image` (multipart bytes), `frame_width`, `frame_height`, optional `face_box`, optional `track_ref`. NO user ids, org ids, or internal media/subject identifiers ever cross the wire — asserted by test.
- Response must echo the request's `correlation_id`; mismatch is `invalid_response`.
- Deterministic failure taxonomy mapped 1:1 onto the database's `search_failure_reason` enum: `timeout` / `rate_limited` / `auth_failed` / `provider_error` (other non-2xx) / `invalid_response` (non-JSON body, wrong contract version, unknown fields, schema-invalid candidate, correlation mismatch) / `network`.
- Timeout via `AbortController` (default 15s) — a stalled provider becomes a typed outcome, never a hang.
- Configuration precedence: organization `matching_provider_url` → deployment proxy (`VITE_ATLAS_IDENTITY_MATCHING_PROXY_ENDPOINT`) → legacy direct endpoint (`VITE_ATLAS_IDENTITY_MATCHING_ENDPOINT`) → unconfigured. Direct endpoints MUST be credentialless; secrets belong only in the proxy function environment (`supabase/functions/identity-match`: verifies the caller's Supabase JWT, attaches upstream credentials server-side).
- **Search-run integration**: every attempt creates a durable `search_runs` row (`channel=identity_matching`, `provider=<endpoint host>`, `query=identity-match/<correlationId>`) BEFORE the wire is touched, then walks queued → running → completed | no_results | failed(failure_reason, error_detail). Failures are recorded, audited as failures, and thrown with honest display copy — silence is never an outcome.
- **Provenance completion (0006)**: persisted candidates carry `provider_candidate_id` (upstream identifier), `search_run_id` (correlation), and `raw_fingerprint` (SHA-256 over canonical JSON of exactly what the provider returned — tamper DETECTION for provider output).
- Unscored providers stay honest: missing score → `match_confidence = 0` + `score_supplied: false`, never a fabricated confidence.
- Batch-level dedup of identical `(provider_candidate_id, external_reference)` within one response.
- Persistence failure after a successful provider call fails the run loudly (`candidate_persistence_failed`) — nothing is saved, nothing is reported as success.
- Authorization enforced at service boundary (`assertSubjectAuthorized`, before ANY write or wire call) AND database triggers/policies; restricted subjects produce zero runs, zero candidates, zero audit events.
- Candidate lifecycle: `pending` → `confirmed` | `rejected` (explicit human action required); confirmation writes `identity_confirmations` and updates `subjects.identity_state`.
- UI honesty: "Provider candidate" pill on every candidate card distinguishes provider assertion from "Confirmed by analyst"; unconfigured state explains that NOTHING was performed or recorded.
- Post-build guard (`scripts/check-bundle-secrets.mjs`) scans compiled assets for secret-shaped tokens.

**What is not**

- No biometric/appearance-based matching algorithm in repo (requires external provider).
- No REAL external provider has been verified end-to-end — the LOCAL PROVIDER E2E proves boundary behavior against a deterministic local responder, which is NOT a claim about any third-party service.
- Edge Function is a deployable artifact only (Deno not installed locally); its runtime behavior on Supabase is unverified.
- No automatic confirmation based on confidence threshold — human confirmation always required.
- No profile creation on confirm (identity_state updated only).

**Verdict:** **IMPLEMENTATION VERIFIED at four truth tiers — code+unit+integration: yes; local-provider E2E: suite written (seeded mode); hosted E2E: same suite gated on seeded credentials; real external provider: NEVER CONTACTED.** Configure via organization setting or deployment proxy to move past tier two.

### Public information / OSINT ingestion seam

**What is real**

- **Versioned external contract v1** (`src/services/providers/httpPublicInformation.ts`) — the ONLY module that knows the OSINT wire format. Strict Zod schemas (`.strict()` everywhere: unknown fields are rejections, not noise); bounded payloads (≤25 results, ≤20 facts/result, ≤10 sources/result, URL ≤2048 chars); database-aligned fact-category enum (anything else is a rejection, never a silent remap); ISO-8601 date validation.
- Request fields (exactly these, never more): `contract_version`, `correlation_id`, `full_name`. NO user ids, org ids, investigation/subject/profile identifiers, or authorization metadata ever cross the wire — asserted by test against the raw request body.
- Response must echo the request's `correlation_id`; mismatch is `invalid_response`.
- Deterministic failure taxonomy mapped 1:1 onto the database's `search_failure_reason` enum: `timeout` (AbortController, default 15s) / `rate_limited` (429) / `auth_failed` (401/403) / `provider_error` (other non-2xx) / `invalid_response` (non-JSON body, wrong version, unknown fields, schema violations) / `network`.
- Configuration precedence: organization connector row (`connectors.endpoint_url`, category `public_information`, status connected|degraded; empty URLs filtered in JS — no `.not` queries) → deployment proxy (`VITE_ATLAS_PUBLIC_INFORMATION_PROXY_ENDPOINT`; `supabase/functions/public-information` verifies the caller's Supabase JWT and attaches upstream credentials server-side) → legacy direct endpoint (`VITE_ATLAS_PUBLIC_INFORMATION_ENDPOINT`) → honest `not_configured` with ZERO runs, writes, audits, or wire traffic. Direct endpoints MUST be credentialless: everything prefixed `VITE_` ships in the public bundle.
- **Search-run integration**: every attempt creates a durable `search_runs` row (`channel=<research channel>`, `provider=<endpoint host>` — the CONFIGURED authority, not a self-reported label, `query=public-info/<channel>/<correlationId>`, `profile_id`) BEFORE the wire is touched, then walks queued → running → completed(sources_found, facts_updated) | no_results | failed(failure_reason, error_detail). Failures are audited as failures with analyst-facing copy that never leaks raw provider detail strings verbatim.
- **Ingestion honesty rules** (enforced in code + asserted by tests):
  - `sources.content_hash` is NEVER written by this contract: it returns references, not retrieved bytes — no hash means no fabricated integrity claim.
  - `published_at` stored only when the provider supplied it (source-level falls back to result-level date).
  - Existing org sources are REUSED, never rewritten: first-retrieval provenance stays immutable while every run appends a `source_retrievals` history row (new AND reused sources).
  - Facts match deterministically (`category::label::value`, trimmed+lowercased) and are ADDITIVE ONLY: existing facts are never overwritten or deleted even when new evidence claims otherwise — conflicting values coexist for analyst adjudication.
  - New facts carry `provider_result_id`, `search_run_id`, and `provider_confidence` (NULL when the provider gave no score; internal confidence then honestly 0).
  - Evidence lineage links (fact↔source) are deduplicated per run; `source_count` reflects total distinct linked sources.
  - Persistence failure mid-ingestion fails the run loudly (`ingestion_persistence_failed`) — partial writes remain as a true record, but the outcome is FAILED, never a fake completion.
- Authorization enforced at the service boundary BEFORE any write or wire call (`assertSubjectAuthorized`; org resolved SERVER-SIDE from subject → investigation, never from client input) AND by DB triggers/policies. Cross-org profile access surfaces as not_found with zero side effects.
- Audit events `public_information.search_started` / `.search_completed` / `.search_failed` correlate run id + correlation id; the DB trigger separately audits run creation.
- UI: research panel on the profile page (channel select + "Run research") with honest state banners for every terminal outcome; "Provider-reported" pill on provider-sourced facts; explicit "provider confidence" label kept visually separate from internal scores; published dates surfaced in Sources tab; demo mode returns `not_configured` (fixtures never fabricate OSINT).

**What is not**

- No REAL external OSINT/data-provider integration exists — the LOCAL PROVIDER E2E proves boundary behavior against a deterministic local responder, which is NOT a claim about any third-party service.
- Edge Function is a deployable artifact only (Deno not installed locally); its runtime behavior on Supabase is unverified.
- No content retrieval: the contract carries metadata references, so full-text snapshots and content hashing remain future work requiring a richer contract version.
- Fact matching is exact-string based; no fuzzy/entity resolution across fact variants yet (deliberate: conservative matching can't silently merge distinct claims).
- Hosted Supabase E2E runs of the suite await seeded credentials (same gate as identity matching).

**Verdict:** **IMPLEMENTATION VERIFIED at four truth tiers — code+unit+integration (real PG): yes; local-provider E2E: suite written (seeded mode); hosted E2E: same suite gated on seeded credentials; real external provider: NEVER CONTACTED.** Configure via organization connector or deployment proxy to move past tier two.

### Public information (legacy reader notes)

- People page lists `intelligence_profiles` whose subject is `authorized`.
- Profile page shows facts, a derived timeline, a derived SVG network, and an evidence drawer of **already linked** sources.
- **Fixed (0004):** "Reload facts" re-reads stored facts and writes only an audit event (`research.search_person`). A read is never reported as research — regression-tested.
- Network graph remains a radial layout of fact strings, not an entity-resolution graph.

### Sources

**What is real**

- Sources page lists `connectors` and `sources`.
- Empty connector list is treated as legitimate (`PGRST205` / missing table → `[]`).
- "Add connector" is disabled with an honest title.
- **RLS INSERT policies for `connectors` (admin) and `sources` (admin) added (0003)**.

**What is not**

- No connector implementation, credentials, sync job, or fetch.
- Demo fixtures are the only populated connector list in-repo.
- **Fixed (0004):** source rows now carry enforced provenance — immutable first retrieval, optional provider-supplied publication date, SHA-256 content fingerprint, lifecycle status with terminal revocation, per-run retrieval history, and equivalence-aware org-scoped dedup. All live-tested.

**Verdict:** still a status board for a connector platform that does not exist, but every row it will ever display is now provably tamper-evident and traceable to the run that retrieved it.

### Evidence

**What is real**

- Investigation and profile pages list `evidence_items`.
- `EvidenceDrawer` shows claim + supporting sources already on the fact.
- `SupabaseEvidenceService.addEvidence` maps to an insert and gates on subject authorization.
- **RLS INSERT policy with authorization gate added (0003)**.
- **DB trigger `enforce_evidence_authorization` blocks inserts for non-authorized subjects (0003)**.
- **DB trigger `audit_evidence_capture` auto-logs evidence creation (0003)**.

**What is not**

- Profile "Add evidence" has no `onClick`. No other UI calls `addEvidence`.
- Capture does not create media evidence.
- **Fixed (0004):** evidence input now REQUIRES a source (`addEvidenceInputSchema`), and a database trigger makes cross-organization lineage impossible even through direct-ID writes — live-tested.

**Verdict:** evidence display, not evidence capture. Lineage integrity is enforced in the database; the UI write path is still absent.

### Audit events

**What is real**

- Activity page lists `audit_events`.
- SQL: append-only (`forbid_mutation` on UPDATE/DELETE); `audit_search_run_insert` trigger.
- Several services best-effort insert audit rows.
- `ephemeralAuditMirror` is explicitly session-local and not the durable trail.
- **DB triggers auto-log: subject auth changes, identity confirm/reject, evidence capture, investigation created (0003)**.

**What is not**

- Insert failures are swallowed (`catch { }`) on investigation create, authorization change, identity search/confirm, and research.
- `useAuditEvents` always calls `listEvents({ limit: 100, sensitiveOnly: false })` regardless of arguments.
- Activity "sensitive" filter looks for action names `identity_resolution`, `authorization_granted`, `authorization_revoked`, `research_run`. Production writes `identity.search`, `identity.confirm`, `identity.reject`, `subject.authorization_changed`, `research.search_person`, `research.search_run`, `investigation.created`. The sensitive view will usually be empty even when sensitive rows exist (`sensitive: true` on the row is ignored).
- Non-admins are not blocked from the sensitive toggle; they only see a warning.
- **Fixed (0004):** immutability and attribution are now live-tested — UPDATE/DELETE on audit_events raise; a client-supplied actor name is overwritten by the verified identity.
- New DB-side audit triggers (0004): `source.status_changed` (exact transition detail) and `identity.candidate_recorded` (sensitive, names provider + display name).

**Verdict:** an append-only, tamper-evident trail with unforgeable attribution, verified against a real database. The UI's sensitive filter still does not match recorded action names.

### RLS isolation

**What is real**

- RLS enabled on all public tables.
- `is_org_member` / `org_role` / `can_write` are `SECURITY DEFINER`.
- `0002` revokes table rights from `anon` and grants them to `authenticated` (RLS still applies).
- **`0003` restricts default grants to SELECT only; explicit INSERT/UPDATE/DELETE grants only where RLS WITH CHECK policies exist**.
- SELECT policies generally require org membership via investigation/subject joins.
- **Composite indexes for cross-org isolation performance added (0003)**.
- **Unique constraints for deduplication: `media_assets(org, path)`, `connectors(org, provider)`, `sources(org, canonical_url)` (0003)**.

**What is not — write holes (authenticated role, default deny)**

| Table | Policies present (after 0005) | App expects |
| --- | --- | --- |
| `subjects` | SELECT, UPDATE, **INSERT** | INSERT to enroll a subject — **present** |
| `identity_candidates` | SELECT, **UPDATE (match_status)**, **INSERT (org-writer scoped, 0005, live-tested)** | UPDATE `match_status` on confirm — **present**; INSERT to record provider candidates — **present** |
| `identity_confirmations` | SELECT, INSERT | INSERT — present |
| `evidence_items` | SELECT, **INSERT (auth gate)** | INSERT — **present** |
| `search_runs` | SELECT, **INSERT (auth gate)** | INSERT — **present** |
| `intelligence_profiles` | SELECT, **UPDATE** | no writer in app — **present for future** |
| `intelligence_facts` | SELECT, **INSERT, UPDATE (auth gate)** | no writer in app — **present for future** |
| `sources` | SELECT, **INSERT (admin)**, **UPDATE (0004: writers manage records; provenance columns trigger-immutable)** | status lifecycle management — **present** |
| `search_runs` | SELECT, INSERT (auth gate), **UPDATE (0004: lifecycle transitions)** | UPDATE to progress runs — **present (was a silent zero-row hole)** |
| `connectors` | SELECT, **ALL (admin)** | no writer in app — **present for admin** |
| `media_assets` / `detected_faces` | SELECT | unused |
| `organization_members` | SELECT | no client-side invite/join |
| `audit_events` | SELECT, INSERT | INSERT — present |
| `investigations` | SELECT, INSERT, UPDATE | present |
| `users` | ALL on own row | present |

**What is not — isolation semantics**

- **Fixed (0004):** a live two-org test now exists (`tests/atlas-db.test.ts`) — direct-ID reads across org boundaries return zero rows for subjects, sources, profiles, investigations, facts, candidates, runs, evidence, retrievals, and audit events.
- Org switcher still does not add `.eq('organization_id', currentOrg)`. A user in two orgs sees a union of both.
- Isolation is org-membership, not investigation-need-to-know.
- `grant ... delete on all tables to authenticated` is broad; lack of DELETE policies is what currently blocks deletes (except `users`).

**Verdict:** RLS write policies complete; SELECT isolation and lineage guards verified against a live two-org database.

---

## Test coverage vs production claims

| Test file | What it actually proves |
| --- | --- |
| `config-env.test.ts` | Env parsing and "demo flag ignored in PROD". |
| `errors.test.ts` | Error class taxonomy. |
| `schemas.test.ts` | Zod contracts, including authorization input shapes. |
| `faceTracking.test.ts` | IoU-based temporal association, track lifecycle, multi-face, loss, expiration, crossing paths, stale frames, reset. |
| `fixture-quarantine.test.ts` | `src/` does not import `dev/` except the container seam. |
| `services-supabase.test.ts` | Authorization gate and mapping **against a fake query builder**. |
| **`security.test.ts` (UPDATED)** | **Authorization states (UNDECLARED/RESTRICTED/REVOKED blocked), cross-org query structure, audit behavior, provider-not-configured errors, invalid FK handling, invalid auth transitions, transport error mapping, schema validation, identity matching auth enforcement, candidate lifecycle + provenance mapping, confirm/reject validation, cross-org isolation for matching; a profile read performs NO search-run insert (only an audit event); evidence input requires sourceId; source rows map every provenance field with `active` default for legacy rows.** |
| **`media.test.ts`** | **MediaCaptureError/StorageError codes and messages, mediaConstraintsSchema, capturedMediaSchema, UploadMediaInput schema validation.** |
| **`faceDetection.test.ts`** | **FaceDetectionError codes/messages, detectFacesInputSchema/detectedFaceSchema validation, UnconfiguredFaceDetectionService error, HttpFaceDetectionProvider success/error/timeout/invalid response handling, schema validation, stale request handling.** |
| **`provenance.test.ts` (NEW)** | **Conservative URL canonicalization (fragments, tracking params dropped; query strings, path case and trailing slashes preserved verbatim; distinct subdomains never merged; credentials stripped; unparseable input returned as-is) and pure-TS SHA-256 against FIPS vectors incl. tamper detection of single-byte changes.** |
| **`searchRunLifecycle.test.ts`** | **Lifecycle state machine (queued→running→completed/failed/no_results; terminal states terminal; no_results ≠ failed), typed conflict errors with from/to details, failed runs require structured failureReason, PROVIDER_NOT_CONFIGURED is never a run state.** |
| **`httpIdentityMatching.test.ts`** | **Identity wire contract v1 against a REAL local HTTP server: schema-valid parsing, empty candidates, exact multipart field set, non-JSON bodies, strict unknown-field rejection, wrong version, correlation mismatch, 401/403/429/500 mapping, abort timeout, connection refusal.** |
| **`identityMatchingOrchestration.test.ts`** | **Matching orchestration against scripted transports + stub client: queued→running→completed lifecycle, run correlation before wire, candidate provenance columns, unscored honesty, batch dedup, config precedence (org→proxy→deployment→none), restricted-subject zero-writes, six-reason failure taxonomy with failed-run records and honest errors, persistence failure loudness, run-create failure.** |
| **`httpPublicInformation.test.ts` (NEW)** | **OSINT wire contract v1 against a REAL local HTTP server: schema-valid result/fact/source normalization; absence of optional scores preserved as NULL; empty result list is OK; request carries ONLY contract fields; non-JSON bodies; strict unknown-field rejection at every nesting level; enum/date/bounds violations rejected; wrong version; correlation mismatch; 401/403/429/500 mapping; abort timeout; connection refusal.** |
| **`publicInformationOrchestration.test.ts` (NEW)** | **OSINT orchestration against scripted transports + stub client: full lifecycle with durable correlation before wire; source provenance (configured host as provider, original_url kept, provider dates only, NO content_hash); retrieval history for new AND reused sources without provenance mutation; additive-only fact upserts with provider_result_id/search_run_id/provider_confidence; deduplicated evidence lineage; facts_updated counting pre-existing facts that gain links; config precedence incl. blank-URL filtering; not_configured zero-writes; restricted-subject zero-writes; unresolvable-org refusal; six-reason failure taxonomy with honest UI copy; persistence failure loudness.** |
| **`atlas-db.test.ts` (REAL DATABASE)** | **Boots embedded PostgreSQL, applies migrations 0001–0007 in order with a minimal Supabase shim (`auth.uid()` via `request.jwt.claims`, anon/authenticated roles), then proves live: two-org direct-ID RLS isolation across subjects/sources/profiles/investigations/facts/candidates/runs/evidence/retrievals/audit; org-scoped URL-normalized source dedup; immutable source & run provenance columns; full search-run lifecycle enforcement incl. failure_reason requirement and terminal states; source status lifecycle with terminal revocation and exact audit trail; cross-org evidence lineage rejection; append-only audit_events; unforgeable actor attribution; sensitive candidate-recording audit events; the candidate-status authorization gate; the repaired updated_at triggers; 0006 identity-candidate correlation columns; 0007 fact provider-provenance columns (FK ON DELETE SET NULL to search_runs, bounded provider_confidence check, partial index) with an end-to-end ingestion insert path.** |

There is still no test that signs into **hosted Supabase** and drives the UI end-to-end: GoTrue, PostgREST, and Storage are outside the integration harness's scope. The real-database suite covers schema, RLS, triggers, and constraints at the SQL boundary only.

---

## Hosted Supabase E2E harness (built; awaiting infrastructure)

A real-browser Playwright harness now exists (`playwright.config.ts`, `e2e/`) that drives
GoTrue → PostgREST → RLS → Storage through the actual UI and the official `supabase-js`
client. It is credential-gated: without valid hosted credentials it reports skips with an
exact reason and NEVER fabricates a pass.

| Verification tier | Status | Evidence |
| --- | --- | --- |
| Harness executes end-of-rungate honestly (unconfigured) | **VERIFIED 2026-08-24** | `npm run test:e2e`: 2 passed (route protection, form rendering), 16 skipped — no failures |
| Dead-project detection with precise cause | **VERIFIED 2026-08-24** | Stale project ref reported verbatim: `HOSTED_SUPABASE_UNREACHABLE — ***REMOVED***: fetch failed (ENOTFOUND)` |
| Auth E2E vs hosted GoTrue (login lifecycle, JWT→PostgREST, sign-out, signup gating) | NOT VERIFIED — no reachable hosted project | suites skip with reason |
| Cross-org RLS isolation via browser (12-table direct-ID matrix, restricted-subject gates, evidence lineage guard, audit attribution forgery, run/source lifecycle + dedup) | NOT VERIFIED — requires seeded mode (`ATLAS_E2E_SERVICE_ROLE_KEY`) | suites skip with reason |
| Local provider E2E — identity matching seam (`identityMatching.spec.ts`) | **WRITTEN, seeded-mode gated** (same gate as above) | real UI → real adapter → intercepted local matcher → real DB → review → audit |
| Local provider E2E — public information seam (`publicInformation.spec.ts`, NEW 2026-08-25) | **WRITTEN, seeded-mode gated** — 8 tests: happy path (wire minimality + source/fact/evidence/retrieval provenance + audits), repeated-run dedup + retrieval history, no_results, stalled-provider timeout, malformed output, rate limit, credential rejection, cross-org refusal with zero wire traffic | real UI → connector config resolution → intercepted local OSINT endpoint → real DB → provenance → audit |
| Storage E2E (upload → media_assets lineage → signed retrieval, cross-org/anon denial) | NOT VERIFIED — bucket not provisioned by any migration | operator must run `scripts/hosted-storage-setup.sql`; until then `STORAGE_BUCKET_NOT_PROVISIONED` |
| Hosted workflow rendering against live backend | NOT VERIFIED | requires credentials |
| Managed migration apply | NOT PERFORMED | guarded by `ATLAS_E2E_ALLOW_MIGRATIONS` + access token; default is operator-applied |

Why hosted verification cannot run today: the only available credentials point to a deleted
project (`***REMOVED***.supabase.co`, DNS NXDOMAIN confirmed via public resolver) and no
service-role key exists in this environment. Provisioning a fresh Supabase project, applying
migrations 0001–0004, and running `scripts/hosted-storage-setup.sql` are operator actions;
`docs/HOSTED_E2E.md` documents every variable and command. The harness itself was verified to
the maximum extent possible without infrastructure (rows 1–2 above).

---

## Dead or misleading UI (not in the matrix rows above)

These controls exist and do not perform the labeled job:

- Sign-in "Forgot password?"
- Capture: Add known identifier / Link existing person / Mark as unresolved
- Profile: Add evidence, Export report
- Sources: Add connector (disabled)
- Settings: Manage members; Biometric retention Configure; Authorization policy Review; Export controls Configure; Delete workflows Open
- Settings privacy copy (embedding retention, watermarked exports, signed deletion) has no backend

---

## Security fixes applied (migration 0003)

### Missing RLS INSERT/UPDATE policies added:
- `subjects`: analysts can INSERT (enroll subjects)
- `identity_candidates`: analysts can UPDATE `match_status` only (confirm/reject)
- `evidence_items`: analysts can INSERT (with DB authorization gate)
- `search_runs`: analysts can INSERT (with DB authorization gate)
- `intelligence_profiles`: analysts can UPDATE
- `intelligence_facts`: analysts can INSERT/UPDATE (with DB authorization gate)
- `connectors`: administrators can manage (ALL)
- `sources`: administrators can INSERT

### Database-side authorization enforcement triggers:
- `gate_candidate_status_update`: blocks `identity_candidates.match_status` changes when subject not `authorized`
- `enforce_evidence_authorization`: blocks `evidence_items` INSERT when subject not `authorized`
- `enforce_search_run_authorization`: blocks `search_runs` INSERT when subject not `authorized`
- `enforce_facts_authorization`: blocks `intelligence_facts` INSERT when subject not `authorized`

### Audit completeness triggers (defense in depth):
- `audit_subject_authorization_change`: logs auth state transitions
- `audit_identity_confirmation`: logs confirm/reject decisions
- `audit_evidence_capture`: logs evidence creation
- `audit_investigation_created`: logs investigation creation

### Identity state integrity:
- `validate_identity_state_transition`: prevents downgrading `confirmed` identity unless subject is `revoked`
- `sync_profile_identity_state`: mirrors subject `identity_state` to `intelligence_profiles`

### Cross-org isolation performance indexes:
- `idx_subjects_inv_auth`, `idx_evidence_inv_captured`, `idx_audit_org_sensitive_time`, `idx_search_runs_subject_time`, `idx_candidates_subject_status`, `idx_facts_profile_category`, `idx_org_members_user_role`

### Timestamp consistency:
- `updated_at` triggers added to `subjects`, `evidence_items`, `sources`, `connectors`

### Unique constraints for deduplication:
- `uq_media_assets_org_path`, `uq_connectors_org_provider`, `uq_sources_org_url`

### Least-privilege grants:
- Default grant to `authenticated` restricted to SELECT only
- Explicit INSERT/UPDATE/DELETE grants only where RLS WITH CHECK policies exist

---

## Security fixes applied (migration 0004 — evidence & provenance hardening)

All items below are enforced in SQL and exercised by `tests/atlas-db.test.ts` against a live embedded PostgreSQL instance.

### Search-run lifecycle integrity
- `search_run_status` recreated with a distinct `no_results` outcome (atomic type replacement).
- Structured failure taxonomy enum: `timeout | rate_limited | auth_failed | provider_error | invalid_response | network`.
- New provenance columns on `search_runs`: `profile_id`, `channel`, `provider`, `sources_found`, `facts_updated`, `failure_reason`, `error_detail`.
- `enforce_search_run_lifecycle()` trigger: provenance columns immutable after creation; valid transitions only (`queued→running|failed`, `running→completed|failed|no_results`); terminal states reject any further change; failed runs require a failure reason; failure details forbidden on non-failed runs. PROVIDER_NOT_CONFIGURED is deliberately NOT a run state.
- Scoped RLS UPDATE policy so analysts can actually progress runs (0003 left no update path; every lifecycle UPDATE silently matched zero rows).

### Source provenance & integrity
- New columns: `original_url`, `published_at` (only when the provider supplied it), `content_hash` (SHA-256 of exact retrieved bytes — tamper DETECTION, not authenticity), `status` (`active | invalidated | revoked`).
- Immutability trigger: organization, provider, canonical_url, and first-retrieved timestamp can never be rewritten; later encounters go to the new `source_retrievals` junction (one row per run, org-scoped RLS) instead of mutating history.
- Status lifecycle trigger: revoked is terminal; invalidation is reversible and audited (`source.status_changed` audit events with exact transition detail).
- URL normalization trigger before the org-scoped unique index: lowercase scheme+host, strip userinfo/default ports/fragments — paths and query strings preserved verbatim; genuinely different hosts never merge.
- Repaired a latent 0003 bug: `set_updated_at()` triggers referenced tables without an `updated_at` column (any UPDATE would have failed at runtime).

### Identity candidate provenance
- Matching context columns: `media_asset_id`, `detected_face_id`, `track_ref`, `matched_at`; surfaced through the shared row mapper to schemas/UI.
- **Correlation completion (0006)**: `provider_candidate_id` (upstream id), `search_run_id` (durable run correlation), `raw_fingerprint` (SHA-256 over canonical JSON of the raw provider candidate) — every recorded candidate answers "where did this come from?" without ambiguity.
- Recording a candidate writes a sensitive audit event naming provider + display name.

### Evidence lineage
- `enforce_evidence_lineage_scope()` trigger: evidence_items can never reference a source or fact from another organization, even via direct-ID writes (RLS alone could not express this cross-table rule for INSERT ... VALUES with foreign IDs).
- Application contract aligned: `addEvidenceInputSchema.sourceId` is required — Atlas has no sourceless evidence.

### Audit integrity
- `enforce_audit_actor_attribution()` trigger: when a request identity exists, `actor_name` is forced to that identity's recorded name — clients cannot forge attribution; system-context inserts keep their computed actor.

---

## Subject workflow enablement (migration 0005 + application wiring)

Migration 0005 is deliberately policy-only (no triggers), so service-role seeding in the E2E harness bypasses it while browser clients are scoped:

- `identity_candidates` INSERT policy "analysts record identity candidates": writers of the subject's organization (via subjects → investigations join + `can_write`) may record provider candidates. Before 0005 the app-side recording path would have silently matched zero rows under RLS.
- Authorization layering unchanged and live-tested: matching refuses non-authorized subjects at the service boundary (`assertSubjectAuthorized`), `gate_candidate_decisions` (0002/0003) blocks confirm/reject unless the subject is authorized, and every recorded candidate still fires the sensitive `audit_candidate_recorded` event (0004).

Application changes (all unit-tested against stub clients; DB behavior integration-tested):
- `createSubject` / `getSubject` on the investigation service — org and actor derived from the session's user record, never from the payload; enrollment audited as `subject.created` (sensitive when authorized); cross-org attempts surface as `not_found`.
- `SupabaseMediaStorageService.upload` persists a real `media_assets` row (org from session, checksum/dimensions/subject lineage in metadata) and rolls back the storage object if the insert fails; new `listByInvestigation` read path.
- `matchIdentity` now resolves the provider endpoint as organization setting → `VITE_ATLAS_IDENTITY_MATCHING_ENDPOINT`, persists returned candidates server-side with track/matched-at provenance, returns the recorded rows, and fails loudly when candidates cannot be recorded or the payload is malformed. Unconfigured providers return an honest empty result.
- UI: enrollment form on the investigation page (navigates to the workspace), per-subject workspace `/subjects/:id` (authorization control, candidate review with confirm/reject, media list, evidence, activity), Capture "Run identity matching" action for the selected face/track, deep-link preselect via query params.

---

## Public-information ingestion enablement (migration 0007 + application wiring)

Migration 0007 is additive-only (nullable columns + one text column + indexes), so existing rows and deployments stay valid:

- `connectors.endpoint_url` (text) — the organization-tier, credentialless OSINT endpoint; indexed with `idx_connectors_org_category` for precedence lookups.
- `intelligence_facts.provider_result_id` (text) — provider-native result identifier; provenance pointer, deliberately NOT a foreign key.
- `intelligence_facts.search_run_id` (uuid → search_runs ON DELETE SET NULL) — durable run correlation that survives run deletion as a nulled pointer rather than destroying the fact.
- `intelligence_facts.provider_confidence` (numeric(4,3), CHECK 0..1) — the provider's claimed score verbatim, or NULL when it supplied none; internal `confidence` stays the analyst-side value.
- Partial index `idx_facts_search_run` for run-scoped fact queries.

Application changes (all unit-tested against real local HTTP + stub clients; DB behavior integration-tested):

- `httpPublicInformation.ts`: versioned wire contract v1 with strict Zod schemas, bounded payloads, DB-aligned fact categories, correlation echo check, deterministic failure taxonomy, AbortController timeout.
- `SupabasePublicInformationService.searchExternal`: authorization gate before ANY write/wire; server-side org resolution; connector → proxy → direct endpoint precedence; full search-run lifecycle; ingestion with immutable source reuse + retrieval history + additive fact upserts + deduplicated evidence lineage; started/completed/failed audits.
- `supabase/functions/public-information`: secret-holding proxy (JWT-verified caller, upstream credentials server-side only).
- UI research panel on PersonProfile with honest terminal-state banners and Provider-reported provenance pills; `.env.example` documents all four variables and why API keys never belong in them.

---

## Database configuration required

**DATABASE_NOT_CONFIGURED**

To run against a live database, the following must be configured:

1. **Supabase project** — Create a Supabase project and note the URL and anon key
2. **Environment variables** — Set in `.env`:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   VITE_ATLAS_FACE_DETECTION_ENDPOINT=https://your-vision-endpoint.example.com  # optional
   ```
3. **Apply migrations** — Run in order:
   ```bash
   supabase db push  # or apply via Supabase dashboard SQL editor
   # 0001_init.sql
   # 0002_production_hardening.sql
   # 0003_security_fixes.sql
   # 0004_evidence_provenance_hardening.sql   <- verified against embedded PG 18 in-repo
   ```
   Note: migration files are pure ASCII by design; applying them to a cluster whose database encoding cannot represent UTF-8 will otherwise fail mid-statement.
4. **Configure auth** — Enable email/password provider in Supabase Auth; configure SMTP for password reset
5. **Create first organization** — Use service role or dashboard to insert into `organizations` and `organization_members` for the first admin user
6. **Optional: Face detection endpoint** — Deploy a vision service accepting `{width, height, timestamp}` and returning `DetectedFace[]`; set `VITE_ATLAS_FACE_DETECTION_ENDPOINT`

---

## Bottom line

This repository is a **production-shaped client** with:

1. Honest unconfigured/demo seams (good).
2. A real-looking Supabase schema and service adapters (good as a design).
3. **Complete RLS write policies for all service operations** (via migrations 0003 + 0004, including the lifecycle UPDATE paths 0003 lacked).
4. **Database-side authorization gates for all sensitive operations** (0003) plus evidence lineage org guards (0004).
5. **Audit triggers covering all sensitive operations** (0003/0004), with append-only storage and unforgeable actor attribution **proven against a live database**.
6. **Real camera pipeline** (`MediaCaptureService`): permission, MediaStream lifecycle, frame capture, validation.
7. **Real media storage pipeline** (`MediaStorageService`): Supabase Storage upload with checksum, signed URLs, honest `STORAGE_NOT_CONFIGURED` state.
8. **Evidence-chain provenance enforced at the database boundary** (0004): immutable first-retrieval source records with content fingerprints and lifecycle status, per-run retrieval history, full search-run lifecycle with structured failures and terminal states, candidate matching context preserved, cross-org lineage impossible. The fake "refresh = research run" behavior is gone.
9. A vision/identity/OSINT story where **face detection, identity matching, and connectors remain external and unconfigured** — but the analyst workflow that consumes them is now real end-to-end: subject enrollment (audited), media persistence (`media_assets` rows with checksum + lineage), provider matching recorded server-side as auditable candidates (0005 insert policy), and durable analyst confirm/reject decisions. Provider output is never presented as confirmed truth, missing provenance is never fabricated, and candidates that cannot be recorded fail loudly.
10. **Test coverage**: unit tests against in-memory stubs PLUS a real-database integration suite (embedded PostgreSQL 18) proving RLS isolation, triggers, lifecycle constraints, dedup, and audit integrity at the SQL boundary — including the 0005 candidate-recording policy.
11. **A hosted Supabase E2E harness** (Playwright) that will drive GoTrue → PostgREST → RLS → Storage through the real UI and `supabase-js` with two live organizations — currently executing in honest skip mode because no reachable hosted project exists (see "Hosted Supabase E2E harness" above). It reports `HOSTED_SUPABASE_NOT_CONFIGURED` / `HOSTED_SUPABASE_UNREACHABLE` instead of inventing results.

What would make the next honesty claim stronger: hosted-Supabase E2E (GoTrue/PostgREST/Storage) against a live project, an actual identity matching endpoint configured via org setting or env, an OSINT connector writing through the new provenance columns, and wiring `canonicalizeSourceUrl`/`contentFingerprint` into that future ingestion path (the DB trigger currently performs the conservative normalization on its own).