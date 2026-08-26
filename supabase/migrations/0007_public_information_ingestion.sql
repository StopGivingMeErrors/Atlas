-- Atlas Identity Intelligence - public information ingestion provenance
-- Layered on 0001..0006. Enables the REAL external public-information /
-- OSINT ingestion pipeline without changing any existing behavior:
--
--   analyst -> authorization gate -> search_runs lifecycle ->
--   versioned provider contract -> source (+ retrieval history) ->
--   fact upsert with provider provenance -> audit trail
--
-- Scope (smallest robust mechanism):
--   1. connectors.endpoint_url: the organization-scoped connector model
--      becomes the FIRST tier of provider configuration. The URL must be
--      credentialless (every org member can read connector rows through
--      normal client access); secrets belong ONLY behind the deployment
--      proxy / Edge Function environment.
--   2. intelligence_facts provider-provenance columns: a provider-supplied
--      fact can always answer "which upstream result produced this, in
--      which run, and did the provider claim a confidence?" without ever
--      conflating provider output with analyst-verified knowledge.
--
-- Honesty rules encoded here (mirroring the application contract):
--   - provider_confidence NULL means the provider supplied NO confidence;
--     it is stored ONLY when explicitly supplied by the provider.
--   - search_run_id ties an ingested fact to the exact run that produced
--     it; deleting a run never destroys the fact (ON DELETE SET NULL),
--     because facts outlive the infrastructure that found them.
--
-- Backward compatible: nullable column additions only; no data rewritten;
-- no existing policy, trigger, or type modified.

-- =====================================================================
-- 1. CONNECTOR ENDPOINT CONFIGURATION
-- =====================================================================
-- Resolution order implemented by the application:
--   organization connector (category 'public_information', endpoint_url)
--     -> deployment proxy (Edge Function, secrets server-side)
--     -> deployment direct endpoint (credentialless fallback)
--     -> honest NOT_CONFIGURED (no run, no wire call, no audit success).
--
-- SECURITY: this URL is readable by all organization members, therefore it
-- MUST NOT embed credentials. Authenticated proxies attach credentials
-- server-side, exactly like supabase/functions/identity-match.

alter table connectors add column if not exists endpoint_url text;

-- Connector resolution runs per research request; keep it indexed.
create index if not exists idx_connectors_org_category
  on connectors (organization_id, category);

-- =====================================================================
-- 2. FACT PROVIDER PROVENANCE
-- =====================================================================
-- A fact row remains an Atlas record; these columns preserve exactly what
-- the external contract delivered:
--   provider_result_id  - the provider-native result identifier
--                         (provenance pointer, NEVER an Atlas foreign key)
--   search_run_id       - the durable search_runs correlation (real FK)
--   provider_confidence - the provider's claimed score, verbatim, or NULL
--                         when it supplied none. The internal confidence
--                         column keeps its own semantics; Atlas never
--                         fabricates a confidence value from absence.

alter table intelligence_facts
  add column if not exists provider_result_id text,
  add column if not exists search_run_id uuid references search_runs (id) on delete set null,
  add column if not exists provider_confidence numeric(4, 3)
    check (provider_confidence between 0 and 1);

-- Run-centric lineage queries ("what did this run change?").
create index if not exists idx_facts_search_run
  on intelligence_facts (search_run_id) where search_run_id is not null;
