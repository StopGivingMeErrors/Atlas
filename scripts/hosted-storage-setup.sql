-- =====================================================================
-- Atlas Identity Intelligence - OPERATOR RUNBOOK (hosted Supabase)
-- Storage provisioning for the 'media-assets' bucket.
--
-- WHY THIS FILE EXISTS
--   No migration creates Storage buckets or storage.objects policies:
--   migrations own the SQL schema; buckets are project infrastructure and
--   stay an explicit operator decision. Until this script is applied, the
--   hosted E2E storage suite reports STORAGE_BUCKET_NOT_PROVISIONED and the
--   Capture upload path surfaces its honest STORAGE_NOT_CONFIGURED error.
--
-- WHERE TO RUN
--   Supabase Dashboard -> SQL Editor (or `supabase db execute`), as the
--   project owner. Idempotent: safe to re-run.
--
-- SECURITY MODEL
--   - Private bucket: no public reads, ever.
--   - Path convention (mirrors src/services/mediaStorage.ts):
--       investigations/<investigation-id>/<timestamp>-<random>.<ext>
--   - Access requires BOTH: authenticated GoTrue identity AND membership of
--     the organization that owns the investigation encoded in the path.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('media-assets', 'media-assets', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Least-privilege object policies, org-scoped through the investigation
-- id embedded in the object path. foldername(name) = ['investigations',
-- '<inv-id>', ...]; the join enforces that the caller's org actually owns
-- that investigation - path forgery grants nothing.
-- ---------------------------------------------------------------------

create policy "org members read media objects"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media-assets'
    and exists (
      select 1
      from investigations i
      join organization_members m on m.organization_id = i.organization_id
      where i.id::text = (storage.foldername(name))[2]
        and m.user_id = auth.uid()
    )
  );

create policy "org analysts upload media objects"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'media-assets'
    and exists (
      select 1
      from investigations i
      join organization_members m
        on m.organization_id = i.organization_id
       and m.role in ('administrator', 'analyst')
      where i.id::text = (storage.foldername(name))[2]
        and m.user_id = auth.uid()
    )
  );

create policy "org analysts update media objects"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'media-assets'
    and exists (
      select 1
      from investigations i
      join organization_members m
        on m.organization_id = i.organization_id
       and m.role in ('administrator', 'analyst')
      where i.id::text = (storage.foldername(name))[2]
        and m.user_id = auth.uid()
    )
  );

create policy "org analysts delete media objects"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'media-assets'
    and exists (
      select 1
      from investigations i
      join organization_members m
        on m.organization_id = i.organization_id
       and m.role in ('administrator', 'analyst')
      where i.id::text = (storage.foldername(name))[2]
        and m.user_id = auth.uid()
    )
  );
