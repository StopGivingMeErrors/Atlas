-- Atlas Identity Intelligence — production hardening
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
