-- ============================================================
-- MIGRATION: 0001_init.sql
-- ============================================================

-- Atlas Identity Intelligence β€” core schema (canonical, service-contract aligned)
-- Designed for Supabase (Postgres + RLS). Biometric embeddings live in
-- detected_faces.embedding_reference (opaque server-side pointer); raw
-- embeddings are never exposed to the frontend.
--
-- Table names mirror src/services/supabase/* exactly:
--   users, subjects, identity_confirmations, connectors, audit_events.
-- Subject authorization is a first-class lifecycle column
-- (undeclared | authorized | restricted | revoked) and gates resolution.

create extension if not exists "pgcrypto";

-- ---------- organizations & membership ----------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  matching_provider_url text,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null default '',
  avatar_url text,
  organization_id uuid references organizations (id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_users_org on users (organization_id);

create type member_role as enum ('administrator', 'analyst', 'viewer');

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index idx_org_members_user on organization_members (user_id);

-- ---------- investigations & subjects ----------

create type investigation_status as enum ('active', 'in_review', 'closed', 'archived');
create type risk_level as enum ('low', 'medium', 'high', 'critical');

create table investigations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  title text not null check (char_length(title) between 3 and 200),
  description text not null default '',
  status investigation_status not null default 'active',
  risk_level risk_level not null default 'low',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_investigations_org on investigations (organization_id);

-- Authorization lifecycle for every person of interest. Resolution and
-- research are denied unless authorization_state = 'authorized'.
create type subject_authorization as enum ('undeclared', 'authorized', 'restricted', 'revoked');
create type identity_state as enum ('unresolved', 'candidate', 'probable', 'confirmed');

create table subjects (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  authorization_state subject_authorization not null default 'undeclared',
  authorization_basis text not null default '',
  identity_state identity_state not null default 'unresolved',
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_subjects_investigation on subjects (investigation_id);
create index idx_subjects_authorization on subjects (authorization_state);

-- ---------- media & detection ----------

create table media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  investigation_id uuid references investigations (id) on delete set null,
  uploaded_by uuid not null references auth.users (id),
  storage_path text not null,
  media_type text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_media_org on media_assets (organization_id);
create index idx_media_investigation on media_assets (investigation_id);

create table detected_faces (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references media_assets (id) on delete cascade,
  subject_id uuid references subjects (id) on delete set null,
  bounding_box jsonb not null,
  landmarks jsonb,
  detection_confidence numeric(4, 3) not null check (detection_confidence between 0 and 1),
  -- Opaque reference to a server-side embedding store; never the vector itself.
  embedding_reference text,
  created_at timestamptz not null default now()
);

create index idx_faces_media on detected_faces (media_asset_id);
create index idx_faces_subject on detected_faces (subject_id);

-- ---------- identity resolution ----------

create type match_status as enum ('pending', 'confirmed', 'rejected');

create table identity_candidates (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects (id) on delete cascade,
  provider text not null,
  external_reference text not null,
  display_name text not null,
  match_confidence numeric(4, 3) not null check (match_confidence between 0 and 1),
  match_status match_status not null default 'pending',
  -- Free-form provider payload; candidate `signals` are read from here.
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index idx_candidates_subject on identity_candidates (subject_id);
create index idx_candidates_status on identity_candidates (subject_id, match_status);

-- Durable analyst decision log β€” candidates are never mutated destructively.
create table identity_confirmations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references identity_candidates (id) on delete cascade,
  decision match_status not null check (decision in ('confirmed', 'rejected')),
  decided_by uuid references auth.users (id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index idx_confirmations_candidate on identity_confirmations (candidate_id);

create table intelligence_profiles (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null unique references subjects (id) on delete cascade,
  canonical_name text not null,
  summary text not null default '',
  identity_state identity_state not null default 'candidate',
  confidence_score numeric(4, 3) not null check (confidence_score between 0 and 1),
  last_resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type fact_category as enum (
  'employment', 'education', 'organization', 'public_profile', 'website',
  'publication', 'social_presence', 'location', 'news_mention'
);

create type verification_status as enum ('verified', 'corroborated', 'unverified', 'disputed');
create type fact_origin as enum ('source_fact', 'ai_summary', 'analyst_annotation', 'inference');

create table intelligence_facts (
  id uuid primary key default gen_random_uuid(),
  intelligence_profile_id uuid not null references intelligence_profiles (id) on delete cascade,
  category fact_category not null,
  label text not null,
  value text not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  source_count integer not null default 0 check (source_count >= 0),
  verification_status verification_status not null default 'unverified',
  origin fact_origin not null default 'source_fact',
  first_observed_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_facts_profile on intelligence_facts (intelligence_profile_id);

-- ---------- sources, connectors & evidence ----------

create type source_type as enum (
  'web_search', 'professional_profile', 'news', 'org_registry', 'public_website', 'org_dataset'
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  provider text not null,
  source_name text not null,
  canonical_url text not null,
  source_type source_type not null,
  credibility_score numeric(4, 3) not null check (credibility_score between 0 and 1),
  retrieved_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);

create index idx_sources_org on sources (organization_id);

create type connector_status as enum ('connected', 'degraded', 'paused', 'not_configured');
create type connector_authorization as enum ('authorized', 'pending', 'expired');

create table connectors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  provider text not null,
  category text not null,
  description text not null default '',
  status connector_status not null default 'not_configured',
  last_sync timestamptz,
  rate_limit text not null default '',
  authorization_status connector_authorization not null default 'pending',
  created_at timestamptz not null default now()
);

create index idx_connectors_org on connectors (organization_id);

create table evidence_items (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations (id) on delete cascade,
  subject_id uuid references subjects (id) on delete set null,
  source_id uuid not null references sources (id),
  fact_id uuid references intelligence_facts (id) on delete set null,
  claim text not null check (char_length(claim) > 0),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  evidence_type text not null,
  captured_at timestamptz not null default now()
);

create index idx_evidence_investigation on evidence_items (investigation_id);
create index idx_evidence_subject on evidence_items (subject_id);
create index idx_evidence_fact on evidence_items (fact_id) where fact_id is not null;

-- ---------- research runs & audit ----------

create type search_run_status as enum ('queued', 'running', 'completed', 'failed');

create table search_runs (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations (id) on delete cascade,
  subject_id uuid references subjects (id) on delete set null,
  initiated_by uuid references auth.users (id) on delete set null,
  query text not null,
  status search_run_status not null default 'queued',
  started_at timestamptz,
  completed_at timestamptz
);

create index idx_search_runs_investigation on search_runs (investigation_id);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  actor_name text,
  action text not null,
  detail text not null default '',
  resource_type text not null,
  resource_id uuid,
  sensitive boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_audit_events_org_time on audit_events (organization_id, created_at desc);
create index idx_audit_events_sensitive on audit_events (organization_id, sensitive, created_at desc)
  where sensitive;

-- ---------- row-level security ----------

alter table organizations enable row level security;
alter table users enable row level security;
alter table organization_members enable row level security;
alter table investigations enable row level security;
alter table subjects enable row level security;
alter table media_assets enable row level security;
alter table detected_faces enable row level security;
alter table identity_candidates enable row level security;
alter table identity_confirmations enable row level security;
alter table intelligence_profiles enable row level security;
alter table intelligence_facts enable row level security;
alter table sources enable row level security;
alter table connectors enable row level security;
alter table evidence_items enable row level security;
alter table search_runs enable row level security;
alter table audit_events enable row level security;

create or replace function is_org_member(org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from organization_members
    where organization_id = org and user_id = auth.uid()
  );
$$;

create or replace function org_role(org uuid)
returns member_role
language sql
security definer
stable
set search_path = public
as $$
  select role from organization_members
  where organization_id = org and user_id = auth.uid();
$$;

create or replace function can_write(org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select org_role(org) in ('administrator', 'analyst');
$$;

create policy "members read their organizations"
  on organizations for select
  using (is_org_member(id));

create policy "users manage own record"
  on users for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "members read membership of their orgs"
  on organization_members for select
  using (is_org_member(organization_id));

create policy "org members read investigations"
  on investigations for select
  using (is_org_member(organization_id));

create policy "analysts create investigations"
  on investigations for insert
  with check (can_write(organization_id));

create policy "analysts update investigations"
  on investigations for update
  using (can_write(organization_id));

create policy "org members read subjects"
  on subjects for select
  using (is_org_member((select i.organization_id from investigations i where i.id = investigation_id)));

create policy "analysts update subjects"
  on subjects for update
  using (can_write((select i.organization_id from investigations i where i.id = investigation_id)));

create policy "org members read media"
  on media_assets for select
  using (is_org_member(organization_id));

create policy "org members read faces"
  on detected_faces for select
  using (is_org_member((
    select m.organization_id from media_assets m where m.id = media_asset_id
  )));

create policy "org members read candidates"
  on identity_candidates for select
  using (is_org_member((
    select i.organization_id
    from subjects s
    join investigations i on i.id = s.investigation_id
    where s.id = subject_id
  )));

create policy "org members read confirmations"
  on identity_confirmations for select
  using (is_org_member((
    select i.organization_id
    from identity_candidates c
    join subjects s on s.id = c.subject_id
    join investigations i on i.id = s.investigation_id
    where c.id = candidate_id
  )));

create policy "analysts record confirmations"
  on identity_confirmations for insert
  with check (
    can_write((
      select i.organization_id
      from identity_candidates c
      join subjects s on s.id = c.subject_id
      join investigations i on i.id = s.investigation_id
      where c.id = candidate_id
    ))
  );

create policy "org members read intelligence profiles"
  on intelligence_profiles for select
  using (is_org_member((
    select i.organization_id
    from subjects s
    join investigations i on i.id = s.investigation_id
    where s.id = subject_id
  )));

create policy "org members read facts"
  on intelligence_facts for select
  using (is_org_member((
    select i.organization_id
    from intelligence_profiles p
    join subjects s on s.id = p.subject_id
    join investigations i on i.id = s.investigation_id
    where p.id = intelligence_profile_id
  )));

create policy "org members read sources"
  on sources for select
  using (is_org_member(organization_id));

create policy "org members read connectors"
  on connectors for select
  using (is_org_member(organization_id));

create policy "org members read evidence"
  on evidence_items for select
  using (is_org_member((select i.organization_id from investigations i where i.id = investigation_id)));

create policy "org members read search runs"
  on search_runs for select
  using (is_org_member((select i.organization_id from investigations i where i.id = investigation_id)));

create policy "org members read audit events"
  on audit_events for select
  using (is_org_member(organization_id));

create policy "members write audit events"
  on audit_events for insert
  with check (is_org_member(organization_id));

-- ---------- updated_at maintenance ----------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_investigations_updated before update on investigations
  for each row execute function set_updated_at();
create trigger trg_intel_profiles_updated before update on intelligence_profiles
  for each row execute function set_updated_at();

-- Touch parent investigation whenever its subjects change.
create or replace function touch_parent_investigation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update investigations set updated_at = now() where id = coalesce(new.investigation_id, old.investigation_id);
  return coalesce(new, old);
end;
$$;

create trigger trg_subjects_touch_investigation
  after insert or update or delete on subjects
  for each row execute function touch_parent_investigation();



-- ============================================================
-- MIGRATION: 0002_production_hardening.sql
-- ============================================================

-- Atlas Identity Intelligence β€” production hardening
-- Layered on 0001_init.sql. Adds defense-in-depth for the authorization
-- lifecycle, audit immutability, and operational indexes.

-- ---------- authorization lifecycle integrity ----------

-- Granting or restricting access requires a recorded basis; undeclared and
-- revoked subjects must never carry an "authorized" state forward silently.
create or replace function validate_subject_authorization()
returns trigger
language plpgsql
as $$
begin
  if new.authorization_state in ('authorized', 'restricted')
     and btrim(new.authorization_basis) = '' then
    raise exception
      'authorization_state % requires a non-empty authorization_basis',
      new.authorization_state;
  end if;
  if new.authorization_state = 'revoked' then
    -- Preserve history in authorization_basis; mark revocation explicitly.
    new.authorization_basis := case
      when new.authorization_basis like 'REVOKED:%' then new.authorization_basis
      else 'REVOKED:' || coalesce(nullif(btrim(new.authorization_basis), ''), 'no basis recorded')
    end;
  end if;
  return new;
end;
$$;

create constraint trigger trg_validate_subject_authorization
  after insert or update on subjects
  deferrable initially deferred
  for each row execute function validate_subject_authorization();

-- ---------- resolution gating (database-side mirror of app gate) ----------

-- Identity candidate decisions are only permitted while the parent subject is
-- authorized. The application enforces this first; the database enforces it
-- again even if a service bug or direct API call attempts to bypass it.
create or replace function gate_candidate_decisions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  subject_auth subject_authorization;
begin
  select s.authorization_state into subject_auth
  from subjects s
  where s.id = (
    select c.subject_id from identity_candidates c where c.id = new.candidate_id
  );

  if subject_auth is distinct from 'authorized' then
    raise exception
      'identity decisions require an authorized subject (current state: %)',
      coalesce(subject_auth::text, 'missing');
  end if;
  return new;
end;
$$;

create trigger trg_gate_candidate_decisions
  before insert on identity_confirmations
  for each row execute function gate_candidate_decisions();

-- ---------- audit immutability ----------

-- Append-only audit: updates and deletes are rejected at the database layer.
create or replace function forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;

create trigger trg_audit_no_update
  before update on audit_events
  for each row execute function forbid_mutation();

create trigger trg_audit_no_delete
  before delete on audit_events
  for each row execute function forbid_mutation();

-- Every sensitive research/resolution action must land in the audit trail.
-- The application writes best-effort audit rows; this trigger guarantees a
-- durable record exists for search_runs regardless.
create or replace function audit_search_run_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
begin
  select i.organization_id into org
  from investigations i where i.id = new.investigation_id;
  insert into audit_events (organization_id, action, resource_type, resource_id, detail, sensitive)
  values (
    org,
    'research.search_run',
    'search_run',
    new.id,
    new.query,
    true
  );
  return new;
end;
$$;

create trigger trg_audit_search_run
  after insert on search_runs
  for each row execute function audit_search_run_insert();

-- ---------- operational hardening ----------

-- Least privilege: the anon role has no direct table access; all reads flow
-- through authenticated, RLS-gated requests.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Sequences are not used (uuid primary keys), but keep defaults tidy.
alter table subjects enable row level security;

-- Partial index: hot path for the authorization gate lookups.
create index if not exists idx_subjects_authorized
  on subjects (id) where authorization_state = 'authorized';

create index if not exists idx_candidates_pending
  on identity_candidates (subject_id) where match_status = 'pending';

create index if not exists idx_evidence_captured
  on evidence_items (investigation_id, captured_at desc);

create index if not exists idx_search_runs_subject
  on search_runs (subject_id) where subject_id is not null;

-- Statement-level guard: subjects cannot be deleted while confirmed identity
-- state exists without an explicit revoke first (soft lifecycle enforcement).
create or replace function prevent_confirmed_subject_deletion()
returns trigger
language plpgsql
as $$
begin
  if old.identity_state = 'confirmed'
     and old.authorization_state <> 'revoked' then
    raise exception
      'revoke authorization before deleting a confirmed subject';
  end if;
  return old;
end;
$$;

create trigger trg_prevent_confirmed_deletion
  before delete on subjects
  for each row execute function prevent_confirmed_subject_deletion();



-- ============================================================
-- MIGRATION: 0003_security_fixes.sql
-- ============================================================

-- Atlas Identity Intelligence β€” security hardening (layered on 0001_init + 0002)
-- Fixes: missing RLS write policies, authorization enforcement triggers,
-- audit completeness, foreign key integrity, cross-org isolation indexes.

-- =====================================================================
-- MISSING RLS INSERT/UPDATE POLICIES
-- =====================================================================

-- subjects: analysts can create subjects in investigations they can write to
create policy "analysts create subjects"
  on subjects for insert
  with check (
    can_write((
      select i.organization_id from investigations i where i.id = investigation_id
    ))
  );

-- subjects: analysts can update (already have update policy, but need to ensure it covers all columns)
-- The existing "analysts update subjects" policy is sufficient for authorization_state/basis

-- identity_candidates: analysts can update match_status (confirm/reject)
create policy "analysts update candidate status"
  on identity_candidates for update
  using (
    can_write((
      select i.organization_id
      from subjects s
      join investigations i on i.id = s.investigation_id
      where s.id = subject_id
    ))
  )
  with check (
    can_write((
      select i.organization_id
      from subjects s
      join investigations i on i.id = s.investigation_id
      where s.id = subject_id
    ))
  );

-- evidence_items: analysts can insert evidence for authorized subjects
create policy "analysts insert evidence"
  on evidence_items for insert
  with check (
    can_write((
      select i.organization_id from investigations i where i.id = investigation_id
    ))
    -- Enforce authorization gate at database level
    and (
      subject_id is null
      or (
        select authorization_state from subjects where id = subject_id
      ) = 'authorized'
    )
  );

-- search_runs: analysts can insert search runs for authorized subjects
create policy "analysts insert search runs"
  on search_runs for insert
  with check (
    can_write((
      select i.organization_id from investigations i where i.id = investigation_id
    ))
    and (
      subject_id is null
      or (
        select authorization_state from subjects where id = subject_id
      ) = 'authorized'
    )
  );

-- intelligence_profiles: created automatically when subject is confirmed
-- Analysts can update profile fields (confidence, summary, etc.)
create policy "analysts update intelligence profiles"
  on intelligence_profiles for update
  using (
    can_write((
      select i.organization_id
      from subjects s
      join investigations i on i.id = s.investigation_id
      where s.id = subject_id
    ))
  )
  with check (
    can_write((
      select i.organization_id
      from subjects s
      join investigations i on i.id = s.investigation_id
      where s.id = subject_id
    ))
  );

-- intelligence_facts: analysts can insert/update facts for authorized subjects
create policy "analysts insert facts"
  on intelligence_facts for insert
  with check (
    can_write((
      select i.organization_id
      from intelligence_profiles p
      join subjects s on s.id = p.subject_id
      join investigations i on i.id = s.investigation_id
      where p.id = intelligence_profile_id
    ))
    and (
      select s.authorization_state
      from intelligence_profiles p
      join subjects s on s.id = p.subject_id
      where p.id = intelligence_profile_id
    ) = 'authorized'
  );

create policy "analysts update facts"
  on intelligence_facts for update
  using (
    can_write((
      select i.organization_id
      from intelligence_profiles p
      join subjects s on s.id = p.subject_id
      join investigations i on i.id = s.investigation_id
      where p.id = intelligence_profile_id
    ))
  )
  with check (
    can_write((
      select i.organization_id
      from intelligence_profiles p
      join subjects s on s.id = p.subject_id
      join investigations i on i.id = s.investigation_id
      where p.id = intelligence_profile_id
    ))
  );

-- connectors: administrators can provision connectors
create policy "administrators manage connectors"
  on connectors for all
  using (
    org_role(organization_id) = 'administrator'
  )
  with check (
    org_role(organization_id) = 'administrator'
  );

-- sources: administrators can insert sources (typically via connectors)
create policy "administrators insert sources"
  on sources for insert
  with check (
    org_role(organization_id) = 'administrator'
  );

-- =====================================================================
-- AUTHORIZATION ENFORCEMENT TRIGGERS (DATABASE-SIDE)
-- =====================================================================

-- Prevent identity candidate decisions (UPDATE match_status) when subject not authorized
create or replace function gate_candidate_status_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  subject_auth subject_authorization;
begin
  -- Only enforce on match_status changes
  IF OLD.match_status IS NOT DISTINCT FROM NEW.match_status THEN
    RETURN NEW;
  END IF;

  SELECT s.authorization_state INTO subject_auth
  FROM subjects s
  WHERE s.id = NEW.subject_id;

  IF subject_auth IS DISTINCT FROM 'authorized' THEN
    RAISE EXCEPTION
      'identity candidate status change requires an authorized subject (current state: %)',
      COALESCE(subject_auth::text, 'missing');
  END IF;
  RETURN NEW;
end;
$$;

create trigger trg_gate_candidate_status_update
  before update of match_status on identity_candidates
  for each row execute function gate_candidate_status_update();

-- Enforce authorization gate for evidence_items insert (defense in depth)
create or replace function enforce_evidence_authorization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  IF NEW.subject_id IS NOT NULL THEN
    IF (
      SELECT authorization_state FROM subjects WHERE id = NEW.subject_id
    ) IS DISTINCT FROM 'authorized' THEN
      RAISE EXCEPTION
        'evidence requires an authorized subject (current state: %)',
        (SELECT authorization_state::text FROM subjects WHERE id = NEW.subject_id);
    END IF;
  END IF;
  RETURN NEW;
end;
$$;

create trigger trg_enforce_evidence_authorization
  before insert on evidence_items
  for each row execute function enforce_evidence_authorization();

-- Enforce authorization gate for search_runs insert
create or replace function enforce_search_run_authorization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  IF NEW.subject_id IS NOT NULL THEN
    IF (
      SELECT authorization_state FROM subjects WHERE id = NEW.subject_id
    ) IS DISTINCT FROM 'authorized' THEN
      RAISE EXCEPTION
        'search run requires an authorized subject (current state: %)',
        (SELECT authorization_state::text FROM subjects WHERE id = NEW.subject_id);
    END IF;
  END IF;
  RETURN NEW;
end;
$$;

create trigger trg_enforce_search_run_authorization
  before insert on search_runs
  for each row execute function enforce_search_run_authorization();

-- Enforce authorization gate for intelligence_facts insert
create or replace function enforce_facts_authorization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_state subject_authorization;
begin
  SELECT s.authorization_state INTO auth_state
  FROM intelligence_profiles p
  JOIN subjects s ON s.id = p.subject_id
  WHERE p.id = NEW.intelligence_profile_id;

  IF auth_state IS DISTINCT FROM 'authorized' THEN
    RAISE EXCEPTION
      'facts require an authorized subject (current state: %)',
      COALESCE(auth_state::text, 'missing');
  END IF;
  RETURN NEW;
end;
$$;

create trigger trg_enforce_facts_authorization
  before insert on intelligence_facts
  for each row execute function enforce_facts_authorization();

-- Prevent revoking authorization on subject with confirmed identity without explicit action
-- (Already handled by validate_subject_authorization trigger in 0002)

-- =====================================================================
-- AUDIT COMPLETENESS TRIGGERS
-- =====================================================================

-- Audit trigger for subject authorization changes
create or replace function audit_subject_authorization_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
  actor text;
begin
  IF OLD.authorization_state IS NOT DISTINCT FROM NEW.authorization_state THEN
    RETURN NEW;
  END IF;

  SELECT i.organization_id INTO org
  FROM investigations i WHERE i.id = NEW.investigation_id;

  -- Try to get actor name from auth context
  SELECT COALESCE(
    (SELECT full_name FROM users WHERE user_id = auth.uid()),
    auth.uid()::text,
    'System'
  ) INTO actor;

  INSERT INTO audit_events (organization_id, action, resource_type, resource_id, detail, sensitive, actor_name)
  VALUES (
    org,
    'subject.authorization_changed',
    'subject',
    NEW.id,
    FORMAT('authorization state changed from %s to %s', OLD.authorization_state, NEW.authorization_state),
    true,
    actor
  );
  RETURN NEW;
end;
$$;

create trigger trg_audit_subject_authorization
  after update of authorization_state on subjects
  for each row execute function audit_subject_authorization_change();

-- Audit trigger for identity confirmation (already handled in app, but defense in depth)
create or replace function audit_identity_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
  subject_id uuid;
  actor text;
begin
  SELECT i.organization_id, c.subject_id INTO org, subject_id
  FROM identity_candidates c
  JOIN subjects s ON s.id = c.subject_id
  JOIN investigations i ON i.id = s.investigation_id
  WHERE c.id = NEW.candidate_id;

  SELECT COALESCE(
    (SELECT full_name FROM users WHERE user_id = auth.uid()),
    auth.uid()::text,
    'System'
  ) INTO actor;

  INSERT INTO audit_events (organization_id, action, resource_type, resource_id, detail, sensitive, actor_name)
  VALUES (
    org,
    CASE NEW.decision WHEN 'confirmed' THEN 'identity.confirmed' ELSE 'identity.rejected' END,
    'identity_candidate',
    NEW.candidate_id,
    FORMAT('Candidate %s for subject %s', NEW.decision, subject_id),
    true,
    actor
  );
  RETURN NEW;
end;
$$;

create trigger trg_audit_identity_confirmation
  after insert on identity_confirmations
  for each row execute function audit_identity_confirmation();

-- Audit trigger for evidence capture
create or replace function audit_evidence_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
  actor text;
begin
  SELECT i.organization_id INTO org
  FROM investigations i WHERE i.id = NEW.investigation_id;

  SELECT COALESCE(
    (SELECT full_name FROM users WHERE user_id = auth.uid()),
    auth.uid()::text,
    'System'
  ) INTO actor;

  INSERT INTO audit_events (organization_id, action, resource_type, resource_id, detail, sensitive, actor_name)
  VALUES (
    org,
    'evidence.captured',
    'evidence_item',
    NEW.id,
    NEW.claim,
    true,
    actor
  );
  RETURN NEW;
end;
$$;

create trigger trg_audit_evidence_capture
  after insert on evidence_items
  for each row execute function audit_evidence_capture();

-- Audit trigger for investigation creation (app does this, but ensure it happens)
create or replace function audit_investigation_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
begin
  SELECT COALESCE(
    (SELECT full_name FROM users WHERE user_id = auth.uid()),
    auth.uid()::text,
    'System'
  ) INTO actor;

  INSERT INTO audit_events (organization_id, action, resource_type, resource_id, detail, sensitive, actor_name)
  VALUES (
    NEW.organization_id,
    'investigation.created',
    'investigation',
    NEW.id,
    NEW.title,
    false,
    actor
  );
  RETURN NEW;
end;
$$;

create trigger trg_audit_investigation_created
  after insert on investigations
  for each row execute function audit_investigation_created();

-- =====================================================================
-- FOREIGN KEY INTEGRITY & CONSTRAINTS
-- =====================================================================

-- subjects already has FK to investigations
-- Add NOT NULL constraint to evidence_items.claim (already has CHECK)
-- evidence_items.source_id is NOT NULL (required) - already enforced

-- Add FK from intelligence_profiles.subject_id to subjects (already unique + FK)
-- The unique constraint on intelligence_profiles.subject_id + FK to subjects covers this

-- Ensure subjects.identity_state only transitions logically
create or replace function validate_identity_state_transition()
returns trigger
language plpgsql
as $$
begin
  -- Valid transitions:
  -- unresolved -> candidate, probable, confirmed
  -- candidate -> probable, confirmed, unresolved
  -- probable -> confirmed, unresolved
  -- confirmed -> (only via revoke, which sets authorization_state=revoked)
  IF OLD.identity_state = 'confirmed' AND NEW.identity_state <> 'confirmed' THEN
    IF NEW.authorization_state <> 'revoked' THEN
      RAISE EXCEPTION
        'confirmed identity cannot be downgraded unless subject is revoked';
    END IF;
  END IF;
  RETURN NEW;
end;
$$;

create trigger trg_validate_identity_state
  before update of identity_state on subjects
  for each row execute function validate_identity_state_transition();

-- Ensure intelligence_profiles.identity_state mirrors subjects for consistency
create or replace function sync_profile_identity_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  IF OLD.identity_state IS DISTINCT FROM NEW.identity_state THEN
    UPDATE intelligence_profiles
    SET identity_state = NEW.identity_state,
        updated_at = now()
    WHERE subject_id = NEW.id;
  END IF;
  RETURN NEW;
end;
$$;

create trigger trg_sync_profile_identity_state
  after update of identity_state on subjects
  for each row execute function sync_profile_identity_state();

-- =====================================================================
-- CROSS-ORG ISOLATION INDEXES (PERFORMANCE + SECURITY)
-- =====================================================================

-- Composite index for subjects authorization lookups (hot path)
create index if not exists idx_subjects_inv_auth
  on subjects (investigation_id, authorization_state)
  where authorization_state in ('authorized', 'restricted');

-- Composite index for evidence per investigation ordered by time
create index if not exists idx_evidence_inv_captured
  on evidence_items (investigation_id, captured_at desc);

-- Composite index for audit events per org + time (sensitive filtered)
create index if not exists idx_audit_org_sensitive_time
  on audit_events (organization_id, sensitive, created_at desc)
  where sensitive;

-- Index for search_runs by subject
create index if not exists idx_search_runs_subject_time
  on search_runs (subject_id, started_at desc)
  where subject_id is not null;

-- Index for identity_candidates by subject + status (hot path)
create index if not exists idx_candidates_subject_status
  on identity_candidates (subject_id, match_status);

-- Index for intelligence_facts by profile + category
create index if not exists idx_facts_profile_category
  on intelligence_facts (intelligence_profile_id, category);

-- Index for organization_members by user (for org switching)
create index if not exists idx_org_members_user_role
  on organization_members (user_id, role);

-- =====================================================================
-- TIMESTAMP CONSISTENCY
-- =====================================================================

-- Ensure all tables have updated_at trigger where appropriate
-- (investigations, intelligence_profiles already have it)

-- Add updated_at to subjects
create trigger trg_subjects_updated
  before update on subjects
  for each row execute function set_updated_at();

-- Add updated_at to evidence_items (for potential future soft updates)
create trigger trg_evidence_updated
  before update on evidence_items
  for each row execute function set_updated_at();

-- Add updated_at to sources
create trigger trg_sources_updated
  before update on sources
  for each row execute function set_updated_at();

-- Add updated_at to connectors
create trigger trg_connectors_updated
  before update on connectors
  for each row execute function set_updated_at();

-- =====================================================================
-- ADDITIONAL CONSTRAINTS
-- =====================================================================

-- Ensure media_assets.storage_path is unique per organization (prevent duplicate uploads)
create unique index if not exists uq_media_assets_org_path
  on media_assets (organization_id, storage_path);

-- Ensure connectors.provider is unique per organization
create unique index if not exists uq_connectors_org_provider
  on connectors (organization_id, provider);

-- Ensure sources.canonical_url is unique per organization (deduplication)
create unique index if not exists uq_sources_org_url
  on sources (organization_id, canonical_url);

-- =====================================================================
-- REVOKE EXCESSIVE GRANTS (0002 granted too much)
-- =====================================================================

-- The 0002 migration granted all privileges to authenticated.
-- Restrict to only what RLS policies allow (default deny for writes).
-- RLS policies are the authorization layer; table grants should be minimal.
revoke all on all tables in schema public from authenticated;

-- Grant only SELECT by default; RLS policies with WITH CHECK handle writes
grant select on all tables in schema public to authenticated;

-- Explicitly grant INSERT/UPDATE/DELETE where RLS policies exist
-- (RLS WITH CHECK clauses enforce the actual authorization)
grant insert, update, delete on
  investigations,
  subjects,
  identity_candidates,
  identity_confirmations,
  evidence_items,
  search_runs,
  audit_events,
  intelligence_profiles,
  intelligence_facts,
  sources,
  connectors,
  media_assets,
  detected_faces
to authenticated;

-- Users table: only own row
grant select, update on users to authenticated;

-- Organization members: SELECT only (no client-side invite)
grant select on organization_members to authenticated;

-- =====================================================================
-- HELPER FUNCTIONS FOR TESTING / DEBUGGING
-- =====================================================================

-- Function to verify cross-org isolation (for testing)
create or replace function test_cross_org_isolation(
  actor_user_id uuid,
  target_org_id uuid,
  target_table text,
  target_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  result boolean;
  query text;
begin
  -- This function simulates an RLS check for a specific user/table/row
  -- Returns true if the user CAN access the row, false if denied
  query := format(
    'select exists (select 1 from %I where id = $1 and is_org_member(organization_id))',
    target_table
  );
  -- Note: In real testing, you'd SET ROLE and test. This is a helper for SQL-level checks.
  -- For actual testing, use SET LOCAL ROLE authenticated; SET request.jwt.claims...
  execute query into result using target_id;
  return result;
end;
$$;

-- Function to get current user's org memberships (for testing)
create or replace function current_user_orgs()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select organization_id from organization_members where user_id = auth.uid();
$$;


-- ============================================================
-- MIGRATION: 0004_evidence_provenance_hardening.sql
-- ============================================================

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



-- ============================================================
-- MIGRATION: 0005_subject_workflow.sql
-- ============================================================

-- Atlas Identity Intelligence - subject enrollment workflow support
-- Layered on 0001..0004.
--
-- The analyst enrollment flow records PROVIDER OUTPUT as identity
-- candidates through the application API. Migration 0003 opened the UPDATE
-- path for candidate decisions but left identity_candidates without any
-- INSERT policy, so a client recording new provider candidates under row
-- level security would silently match zero rows. This policy opens the
-- minimum viable write path: analysts of the subject's organization may
-- record candidates. Authorization gating stays layered elsewhere:
--
--   - the application service refuses to contact matching providers for
--     any subject whose authorization_state is not 'authorized'
--   - gate_candidate_decisions (0002) blocks confirm/reject decisions
--     unless the parent subject is authorized
--   - trg_audit_candidate_recorded (0004) writes a sensitive audit event
--     for every recorded candidate

create policy "analysts record identity candidates"
  on identity_candidates for insert
  with check (
    can_write((
      select i.organization_id
      from subjects s
      join investigations i on i.id = s.investigation_id
      where s.id = subject_id
    ))
  );



-- ============================================================
-- MIGRATION: 0006_identity_matching_provenance.sql
-- ============================================================

-- Atlas Identity Intelligence - identity matching provenance completion
-- Layered on 0001..0005.
--
-- Every recorded candidate must answer "where did this come from?" without
-- ambiguity. 0004 added media/face/track/matched-at context; this migration
-- completes the chain for the real external-provider flow:
--
--   provider_candidate_id - the upstream provider's own identifier for the
--                           candidate (distinct from our row id and from
--                           external_reference)
--   search_run_id         - the durable search_runs correlation: matching now
--                           walks the queued -> running -> completed |
--                           no_results | failed lifecycle, so every match
--                           attempt (including failures) leaves a trace
--   raw_fingerprint       - SHA-256 hex over the canonical JSON of the raw
--                           provider candidate object; tamper DETECTION for
--                           what the provider actually returned (never a
--                           claim of authenticity)

alter table identity_candidates
  add column if not exists provider_candidate_id text,
  add column if not exists search_run_id uuid references search_runs (id) on delete set null,
  add column if not exists raw_fingerprint text;

create index if not exists idx_identity_candidates_search_run
  on identity_candidates (search_run_id);



-- ============================================================
-- MIGRATION: 0007_public_information_ingestion.sql
-- ============================================================

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



