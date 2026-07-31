-- Private storage buckets. Documents are only ever served through short-lived
-- signed URLs (PRD 21.2); nothing here is publicly readable.
--
-- storage.* is provided by Supabase. Guarded so the local PGlite harness,
-- which has no storage schema, can still run every other migration.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('marksheets',    'marksheets',    false, 5242880, array['application/pdf','image/jpeg','image/png']),
    ('resumes',       'resumes',       false, 5242880, array['application/pdf']),
    ('offer-letters', 'offer-letters', false, 5242880, array['application/pdf'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types,
        public = false;

  -- Objects are namespaced by student id: <student_uuid>/<filename>.
  -- A student may only ever touch their own folder.
  execute $p$
    create policy "students read own documents" on storage.objects for select
      using (
        bucket_id in ('marksheets','resumes','offer-letters')
        and (storage.foldername(name))[1] = (
          select id::text from public.students where auth_user_id = auth.uid()
        )
      )
  $p$;

  execute $p$
    create policy "students upload own documents" on storage.objects for insert
      with check (
        bucket_id in ('marksheets','resumes')
        and (storage.foldername(name))[1] = (
          select id::text from public.students where auth_user_id = auth.uid()
        )
      )
  $p$;

  execute $p$
    create policy "staff read all documents" on storage.objects for select
      using (
        bucket_id in ('marksheets','resumes','offer-letters')
        and public.current_app_role() is not null
      )
  $p$;

  execute $p$
    create policy "operators manage documents" on storage.objects for all
      using (public.is_operator()) with check (public.is_operator())
  $p$;
end $$;
