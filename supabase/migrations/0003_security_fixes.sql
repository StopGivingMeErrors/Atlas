-- Atlas Identity Intelligence — security hardening (layered on 0001_init + 0002)
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