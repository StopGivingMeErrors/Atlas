-- Atlas Identity Intelligence — core schema
-- Designed for Supabase (Postgres + RLS). Biometric embeddings live in
-- detected_faces.embedding_reference (opaque server-side pointer); raw
-- embeddings are never exposed to the frontend.

create extension if not exists "pgcrypto";

-- ---------- organizations & membership ----------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  full_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

-- ---------- investigations ----------

create type investigation_status as enum ('active', 'in_review', 'closed', 'archived');
create type risk_level as enum ('low', 'medium', 'high', 'critical');

create table investigations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  title text not null,
  description text not null default '',
  status investigation_status not null default 'active',
  risk_level risk_level not null default 'low',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_investigations_org on investigations (organization_id);

create type consent_status as enum ('consented', 'org_authorized', 'legal_basis', 'pending_review');

create table investigation_subjects (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations (id) on delete cascade,
  label text not null,
  consent_status consent_status not null default 'pending_review',
  authorization_basis text not null,
  created_at timestamptz not null default now()
);

create index idx_subjects_investigation on investigation_subjects (investigation_id);

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
  subject_id uuid references investigation_subjects (id) on delete set null,
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
  subject_id uuid not null references investigation_subjects (id) on delete cascade,
  provider text not null,
  external_reference text not null,
  display_name text not null,
  match_confidence numeric(4, 3) not null check (match_confidence between 0 and 1),
  match_status match_status not null default 'pending',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_candidates_subject on identity_candidates (subject_id);

create table intelligence_profiles (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null unique references investigation_subjects (id) on delete cascade,
  canonical_name text not null,
  summary text not null default '',
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

create table intelligence_facts (
  id uuid primary key default gen_random_uuid(),
  intelligence_profile_id uuid not null references intelligence_profiles (id) on delete cascade,
  category fact_category not null,
  label text not null,
  value text not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  source_count integer not null default 0,
  verification_status verification_status not null default 'unverified',
  created_at timestamptz not null default now()
);

create index idx_facts_profile on intelligence_facts (intelligence_profile_id);

-- ---------- sources & evidence ----------

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

create table evidence_items (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations (id) on delete cascade,
  subject_id uuid references investigation_subjects (id) on delete set null,
  source_id uuid not null references sources (id),
  fact_id uuid references intelligence_facts (id) on delete set null,
  claim text not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  evidence_type text not null,
  captured_at timestamptz not null default now()
);

create index idx_evidence_investigation on evidence_items (investigation_id);
create index idx_evidence_subject on evidence_items (subject_id);

-- ---------- research runs & audit ----------

create type search_run_status as enum ('queued', 'running', 'completed', 'failed');

create table search_runs (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations (id) on delete cascade,
  subject_id uuid references investigation_subjects (id) on delete set null,
  initiated_by uuid not null references auth.users (id),
  query text not null,
  status search_run_status not null default 'queued',
  started_at timestamptz,
  completed_at timestamptz
);

create index idx_search_runs_investigation on search_runs (investigation_id);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid references auth.users (id),
  action text not null,
  resource_type text not null,
  resource_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_audit_org_time on audit_logs (organization_id, created_at desc);

-- ---------- row-level security ----------

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table organization_members enable row level security;
alter table investigations enable row level security;
alter table investigation_subjects enable row level security;
alter table media_assets enable row level security;
alter table detected_faces enable row level security;
alter table identity_candidates enable row level security;
alter table intelligence_profiles enable row level security;
alter table intelligence_facts enable row level security;
alter table sources enable row level security;
alter table evidence_items enable row level security;
alter table search_runs enable row level security;
alter table audit_logs enable row level security;

create or replace function is_org_member(org uuid)
returns boolean
language sql
security definer
stable
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
as $$
  select role from organization_members
  where organization_id = org and user_id = auth.uid();
$$;

create policy "members read their organizations"
  on organizations for select
  using (is_org_member(id));

create policy "users manage own profile"
  on profiles for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "members read membership of their orgs"
  on organization_members for select
  using (is_org_member(organization_id));

create policy "org members read investigations"
  on investigations for select
  using (is_org_member(organization_id));

create policy "analysts and admins write investigations"
  on investigations for insert
  with check (org_role(organization_id) in ('administrator', 'analyst'));

create policy "analysts and admins update investigations"
  on investigations for update
  using (org_role(organization_id) in ('administrator', 'analyst'));

create policy "org members read subjects"
  on investigation_subjects for select
  using (is_org_member((select organization_id from investigations i where i.id = investigation_id)));

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
    from investigation_subjects s
    join investigations i on i.id = s.investigation_id
    where s.id = subject_id
  )));

create policy "org members read intelligence profiles"
  on intelligence_profiles for select
  using (is_org_member((
    select i.organization_id
    from investigation_subjects s
    join investigations i on i.id = s.investigation_id
    where s.id = subject_id
  )));

create policy "org members read facts"
  on intelligence_facts for select
  using (is_org_member((
    select i.organization_id
    from intelligence_profiles p
    join investigation_subjects s on s.id = p.subject_id
    join investigations i on i.id = s.investigation_id
    where p.id = intelligence_profile_id
  )));

create policy "org members read sources"
  on sources for select
  using (is_org_member(organization_id));

create policy "org members read evidence"
  on evidence_items for select
  using (is_org_member((select organization_id from investigations i where i.id = investigation_id)));

create policy "org members read search runs"
  on search_runs for select
  using (is_org_member((select organization_id from investigations i where i.id = investigation_id)));

create policy "admins read audit logs"
  on audit_logs for select
  using (org_role(organization_id) = 'administrator');

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

create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();
create trigger trg_investigations_updated before update on investigations
  for each row execute function set_updated_at();
create trigger trg_intel_profiles_updated before update on intelligence_profiles
  for each row execute function set_updated_at();
