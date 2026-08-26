-- Atlas Identity Intelligence - evidence & provenance hardening
-- Layered on 0001_init + 0002 + 0003. Hardens the EXISTING Atlas chain:
--
--   subject -> media/face -> identity matching -> identity candidate ->
--   authorized record -> search run -> provider -> source -> fact ->
--   evidence_items lineage -> analyst review
--
-- Scope (smallest robust mechanism for this schema):
--   1. search_runs: full lifecycle enum incl. no_results, structured failure
--      reason, channel/provider/profile context, immutable provenance columns,
--      terminal-state enforcement trigger.
--   2. sources: original_url, published_at, content_hash, status lifecycle,
--      first-retrieval immutability; per-run retrieval history in a junction
--      table so a source is traceable to EVERY search run that retrieved it.
--   3. identity_candidates: media/face/track context columns so a candidate
--      can always be traced back to what produced it (provider output is
--      never silently detached from its origin).
--   4. evidence_items: cross-organization lineage guard (a source or fact
--      from another org can never be referenced).
--   5. audit_events: actor attribution cannot be forged by clients.
--   6. Audit triggers for source status changes and candidate recording.
--   7. RLS write paths so lifecycle management is actually possible:
--      without an UPDATE policy every lifecycle UPDATE silently matched
--      zero rows under row level security.
--
-- Integrity note: sources.content_hash is a SHA-256 hex digest over the
-- EXACT bytes of the content retrieved from the provider at retrieval time,
-- computed by the application before insert. It provides tamper DETECTION,
-- not authenticity. published_at is stored ONLY when the provider supplies
-- it - Atlas never fabricates publication or observation dates.

-- =====================================================================
-- 0. REPAIR: missing updated_at columns
-- =====================================================================
-- 0003 attached set_updated_at() triggers to subjects / evidence_items /
-- sources / connectors, but none of those tables had an updated_at column,
-- so ANY update would fail at runtime ("record new has no field
-- updated_at"). Add the columns so those triggers behave as intended.

alter table subjects       add column if not exists updated_at timestamptz not null default now();
alter table evidence_items add column if not exists updated_at timestamptz not null default now();
alter table sources        add column if not exists updated_at timestamptz not null default now();
alter table connectors     add column if not exists updated_at timestamptz not null default now();

-- =====================================================================
-- 1. SEARCH RUN LIFECYCLE
-- =====================================================================

-- The 0001 enum lacks a distinct NO_RESULTS outcome. Recreate it with the
-- complete label set inside this transaction (safe: type is replaced
-- atomically and no value outside it is ever used).
create type search_run_status_v2 as enum
  ('queued', 'running', 'completed', 'failed', 'no_results');

alter table search_runs alter column status drop default;
alter table search_runs
  alter column status type search_run_status_v2
  using (status::text::search_run_status_v2);
drop type search_run_status;
alter type search_run_status_v2 rename to search_run_status;
alter table search_runs alter column status set default 'queued';

-- Structured failure information: a FAILED run must be distinguishable
-- into timeout / rate_limited / auth_failed / provider_error /
-- invalid_response / network. PROVIDER_NOT_CONFIGURED is intentionally NOT
-- a run state: no run is recorded when no provider exists.
create type search_failure_reason as enum (
  'timeout', 'rate_limited', 'auth_failed',
  'provider_error', 'invalid_response', 'network'
);

-- Provenance context for every run: which profile/subject/investigation it
-- belongs to (org via investigation), which channel and provider served it,
-- what was queried, result counts, and how it failed.
alter table search_runs
  add column if not exists profile_id uuid references intelligence_profiles (id) on delete set null,
  add column if not exists channel text,
  add column if not exists provider text,
  add column if not exists sources_found integer not null default 0 check (sources_found >= 0),
  add column if not exists facts_updated integer not null default 0 check (facts_updated >= 0),
  add column if not exists failure_reason search_failure_reason,
  add column if not exists error_detail text;

create index if not exists idx_search_runs_profile
  on search_runs (profile_id) where profile_id is not null;

-- Lifecycle state machine + immutable provenance.
--   queued -> running | failed
--   running -> completed | failed | no_results
--   completed / failed / no_results are terminal.
create or replace function enforce_search_run_lifecycle()
returns trigger
language plpgsql
as $$
begin
  -- Provenance columns are written once at creation and never rewritten.
  if new.investigation_id is distinct from old.investigation_id
     or new.subject_id is distinct from old.subject_id
     or new.profile_id is distinct from old.profile_id
     or new.initiated_by is distinct from old.initiated_by
     or new.query is distinct from old.query
     or new.channel is distinct from old.channel
     or new.provider is distinct from old.provider
     or new.started_at is distinct from old.started_at then
    raise exception 'search_runs provenance columns are immutable after creation';
  end if;

  -- Terminal states are terminal.
  if old.status in ('completed', 'failed', 'no_results') then
    raise exception 'search run % is already terminal (%)', old.id, old.status;
  end if;

  if not (
    (old.status = 'queued' and new.status in ('running', 'failed'))
    or (old.status = 'running' and new.status in ('completed', 'failed', 'no_results'))
  ) then
    raise exception 'invalid search run transition % -> %', old.status, new.status;
  end if;

  -- Structured failure data only exists on failed runs.
  if new.status = 'failed' then
    if new.failure_reason is null then
      raise exception 'a failed search run requires a failure_reason';
    end if;
  else
    if new.failure_reason is not null or new.error_detail is not null then
      raise exception 'failure details are only valid on failed runs';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_search_run_lifecycle
  before update on search_runs
  for each row execute function enforce_search_run_lifecycle();

-- =====================================================================
-- 2. SOURCE PROVENANCE & INTEGRITY
-- =====================================================================

create type source_status as enum ('active', 'invalidated', 'revoked');

alter table sources
  add column if not exists original_url text,
  add column if not exists published_at timestamptz,
  add column if not exists content_hash text,
  add column if not exists status source_status not null default 'active';

create index if not exists idx_sources_nonactive
  on sources (organization_id, status) where status <> 'active';

-- Historical provenance on a source row is never silently overwritten.
-- organization_id, provider, canonical_url and retrieved_at (the FIRST
-- retrieval) are written once. Later encounters with the same resource are
-- recorded in source_retrievals below, not by mutating this row.
create or replace function enforce_source_provenance_immutability()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.provider is distinct from old.provider
     or new.canonical_url is distinct from old.canonical_url
     or new.retrieved_at is distinct from old.retrieved_at then
    raise exception
      'source provenance (org, provider, canonical_url, first retrieval) is immutable';
  end if;
  return new;
end;
$$;

create trigger trg_enforce_source_provenance_immutable
  before update on sources
  for each row execute function enforce_source_provenance_immutability();

-- Sources have no application write path today: rows arrive via connectors
-- and external ingestion. Deduplication therefore lives HERE, not in the
-- service layer. Before the org-scoped unique index (uq_sources_org_url)
-- sees a row, apply the same conservative normalization the application's
-- canonicalizer uses: lowercase scheme+host, strip userinfo, default ports
-- and fragments. Path and query strings are preserved VERBATIM - hosts,
-- paths and parameters that may genuinely differ are never merged.
create or replace function normalize_source_url()
returns trigger
language plpgsql
as $$
declare
  authority text;
  tail text;
  v_lower text;
begin
  v_lower := lower(new.canonical_url);
  if v_lower like 'http://%' or v_lower like 'https://%' then
    authority := split_part(substr(new.canonical_url, position('//' in new.canonical_url) + 2), '/', 1);
    tail := substr(new.canonical_url, position('//' in new.canonical_url) + 2 + length(authority));

    -- Strip userinfo credentials if present.
    if position('@' in authority) > 0 then
      authority := reverse(split_part(reverse(authority), '@', 1));
    end if;

    -- Strip the scheme's default port only.
    if v_lower like 'https://%' then
      authority := regexp_replace(authority, ':443$', '');
    else
      authority := regexp_replace(authority, ':80$', '');
    end if;

    -- Drop the fragment; keep path and query exactly as provided.
    tail := split_part(tail, '#', 1);

    new.canonical_url := lower(left(new.canonical_url, position('//' in new.canonical_url) + 2))
      || lower(authority)
      || tail;
  end if;
  return new;
end;
$$;

create trigger trg_normalize_source_url
  before insert or update of canonical_url on sources
  for each row execute function normalize_source_url();

-- Status lifecycle: active <-> invalidated, revoked is terminal. Invalidation
-- never deletes anything - dependent facts/evidence remain auditable and
-- readers can see the source is no longer trustworthy.
create or replace function enforce_source_status_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'revoked' then
    raise exception 'a revoked source is terminal';
  end if;
  return new;
end;
$$;

create trigger trg_enforce_source_status_transition
  before update of status on sources
  for each row execute function enforce_source_status_transition();

create or replace function audit_source_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
begin
  select coalesce(
    (select u.full_name from users u where u.user_id = auth.uid()),
    auth.uid()::text,
    'System'
  ) into actor;

  insert into audit_events (organization_id, action, resource_type, resource_id, detail, sensitive, actor_name)
  values (
    new.organization_id,
    'source.status_changed',
    'source',
    new.id,
    format('%s -> %s', old.status, new.status),
    true,
    actor
  );
  return new;
end;
$$;

create trigger trg_audit_source_status_change
  after update of status on sources
  for each row execute function audit_source_status_change();

-- =====================================================================
-- 3. SOURCE RETRIEVAL HISTORY (multi-run traceability)
-- =====================================================================
-- A single source row deduplicates one canonical resource per organization;
-- this junction records EVERY search run that encountered it, so an analyst
-- can answer "which runs retrieved this?" without destroying history.

create table source_retrievals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  source_id uuid not null references sources (id) on delete cascade,
  search_run_id uuid references search_runs (id) on delete set null,
  retrieved_at timestamptz not null default now(),
  unique (source_id, search_run_id)
);

create index idx_source_retrievals_source on source_retrievals (source_id);
create index idx_source_retrievals_run on source_retrievals (search_run_id)
  where search_run_id is not null;

alter table source_retrievals enable row level security;

create policy "org members read source retrievals"
  on source_retrievals for select
  using (is_org_member(organization_id));

-- A retrieval may only be recorded against a source in the SAME org.
create policy "analysts record source retrievals"
  on source_retrievals for insert
  with check (
    can_write(organization_id)
    and organization_id = (select s.organization_id from sources s where s.id = source_id)
  );

revoke all on source_retrievals from anon;
grant select, insert on source_retrievals to authenticated;

-- =====================================================================
-- 4. IDENTITY CANDIDATE PROVENANCE
-- =====================================================================
-- A candidate is PROVIDER OUTPUT, never a confirmed identity. These columns
-- keep the matching context attached: which media asset / detected face /
-- track produced the query, and when the match happened. Confirmation
-- remains a separate, durable analyst decision (identity_confirmations).

alter table identity_candidates
  add column if not exists media_asset_id uuid references media_assets (id) on delete set null,
  add column if not exists detected_face_id uuid references detected_faces (id) on delete set null,
  add column if not exists track_ref text,
  add column if not exists matched_at timestamptz;

create index if not exists idx_candidates_media
  on identity_candidates (media_asset_id) where media_asset_id is not null;

-- Recording a provider candidate is itself an auditable, sensitive event.
create or replace function audit_candidate_recorded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
begin
  select i.organization_id into org
  from subjects s
  join investigations i on i.id = s.investigation_id
  where s.id = new.subject_id;

  insert into audit_events (organization_id, action, resource_type, resource_id, detail, sensitive)
  values (
    org,
    'identity.candidate_recorded',
    'identity_candidate',
    new.id,
    format('provider %s reported %s (confidence %s)', new.provider, new.display_name, new.match_confidence),
    true
  );
  return new;
end;
$$;

create trigger trg_audit_candidate_recorded
  after insert on identity_candidates
  for each row execute function audit_candidate_recorded();

-- =====================================================================
-- 5. EVIDENCE LINEAGE ORGANIZATION GUARD
-- =====================================================================
-- evidence_items IS the Atlas lineage edge (source -> fact -> subject). This
-- guard makes cross-organization lineage impossible even through direct-ID
-- writes: the referenced source and fact must live in the same organization
-- as the evidence item's investigation.

create or replace function enforce_evidence_lineage_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  investigation_org uuid;
  source_org uuid;
  fact_org uuid;
begin
  select i.organization_id into investigation_org
  from investigations i where i.id = new.investigation_id;

  if investigation_org is null then
    raise exception 'evidence requires an existing investigation';
  end if;

  if new.source_id is not null then
    select s.organization_id into source_org
    from sources s where s.id = new.source_id;
    if source_org is distinct from investigation_org then
      raise exception 'evidence source belongs to a different organization';
    end if;
  end if;

  if new.fact_id is not null then
    select i.organization_id into fact_org
    from intelligence_facts f
    join intelligence_profiles p on p.id = f.intelligence_profile_id
    join subjects s on s.id = p.subject_id
    join investigations i on i.id = s.investigation_id
    where f.id = new.fact_id;
    if fact_org is distinct from investigation_org then
      raise exception 'evidence fact belongs to a different organization';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_evidence_lineage_scope
  before insert or update of source_id, fact_id, investigation_id on evidence_items
  for each row execute function enforce_evidence_lineage_scope();

-- =====================================================================
-- 6. AUDIT ACTOR ATTRIBUTION HARDENING
-- =====================================================================
-- Clients may insert audit rows (best-effort app paths), but they must never
-- be able to FORGE who performed an action. When the request carries an
-- authenticated identity, actor_name is forced to that identity's recorded
-- name. System-generated rows (auth.uid() unresolved, e.g. DB triggers or
-- service-role jobs) keep their computed actor.

create or replace function enforce_audit_actor_attribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  verified_actor text;
begin
  if auth.uid() is not null then
    select coalesce(
      (select u.full_name from users u where u.user_id = auth.uid()),
      auth.uid()::text
    ) into verified_actor;
    new.actor_name := verified_actor;
  end if;
  return new;
end;
$$;

create trigger trg_audit_actor_attribution
  before insert on audit_events
  for each row execute function enforce_audit_actor_attribution();

-- =====================================================================
-- 7. WRITE PATHS FOR LIFECYCLE MANAGEMENT (RLS)
-- =====================================================================
-- 0003 left sources/search_runs without ANY update policy, so under RLS no
-- authenticated role could ever progress a run or revise a source record
-- (updates silently matched zero rows). These policies open the minimum
-- viable write path; what may never change (provenance columns) is still
-- enforced by the triggers above, not by policy.

drop policy if exists "writers manage source records" on sources;
create policy "writers manage source records"
  on sources for update
  using (can_write(organization_id))
  with check (can_write(organization_id));

drop policy if exists "writers progress search runs" on search_runs;
create policy "writers progress search runs"
  on search_runs for update
  using (
    can_write((select i.organization_id from investigations i where i.id = investigation_id))
  )
  with check (
    can_write((select i.organization_id from investigations i where i.id = investigation_id))
  );

-- =====================================================================
-- 8. INDEXES FOR LINEAGE NAVIGATION
-- =====================================================================

create index if not exists idx_evidence_source_lookup
  on evidence_items (source_id);

create index if not exists idx_sources_org_retrieved
  on sources (organization_id, retrieved_at desc);
