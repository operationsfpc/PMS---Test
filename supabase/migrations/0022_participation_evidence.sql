-- Evidence for the two decisions a student makes about their own placement.
--
-- UAT 2026-08-05, two items:
--   * an off-campus placement "should be mandatory for students to upload
--     their Offer Letter for verification"
--   * opting out "should mandate the upload of a handwritten and signed
--     declaration letter confirming their decision"
--
-- Both decisions are irreversible in practice. An approved opt-out can never
-- be undone (0009's enforce_opt_out_irreversible), and a self-placement
-- becomes a number the college reports. Neither may rest on a student's word
-- alone, and neither may rest on a screen remembering to ask - so the
-- requirement lives here, where no client can forget it.
--
-- A18 already said a self-placement "requires an offer letter upload, because
-- there is no drive to corroborate it". It was written down and never
-- enforced.

alter type document_kind add value if not exists 'opt_out_declaration';

alter table self_placement_requests
  add column if not exists offer_letter_id uuid references student_documents(id);

alter table opt_out_requests
  add column if not exists declaration_id uuid references student_documents(id);

-- NOT VALID deliberately: one self-placement request already exists on the
-- live project, raised before this was required. The constraint governs every
-- new and updated row from now on, and leaves that one alone rather than
-- refusing to deploy. It is listed in HANDOVER for a coordinator to chase.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'self_placement_needs_offer_letter'
  ) then
    alter table self_placement_requests
      add constraint self_placement_needs_offer_letter
      check (offer_letter_id is not null) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'opt_out_needs_declaration'
  ) then
    alter table opt_out_requests
      add constraint opt_out_needs_declaration
      check (declaration_id is not null) not valid;
  end if;
end $$;

-- Storage. A student could not upload an offer letter at all: the insert
-- policy in 0010 covered 'marksheets' and 'resumes' only, so the bucket their
-- own evidence belongs in was readable by them and writable by nobody.
--
-- Declarations get their own bucket rather than sharing offer-letters: they
-- are a different document with a different retention story, and a handwritten
-- signed sheet arrives as a PHOTOGRAPH from a phone, so images are allowed.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('declarations', 'declarations', false, 5242880,
          array['application/pdf','image/jpeg','image/png','image/heic'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types,
        public = false;

  update storage.buckets
     set allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/heic']
   where id = 'offer-letters';

  execute $p$ drop policy if exists "students upload own documents" on storage.objects $p$;
  execute $p$
    create policy "students upload own documents" on storage.objects for insert
      with check (
        bucket_id in ('marksheets','resumes','offer-letters','declarations')
        and (storage.foldername(name))[1] = (
          select id::text from public.students where auth_user_id = auth.uid()
        )
      )
  $p$;

  execute $p$ drop policy if exists "students read own documents" on storage.objects $p$;
  execute $p$
    create policy "students read own documents" on storage.objects for select
      using (
        bucket_id in ('marksheets','resumes','offer-letters','declarations')
        and (storage.foldername(name))[1] = (
          select id::text from public.students where auth_user_id = auth.uid()
        )
      )
  $p$;

  execute $p$ drop policy if exists "staff read all documents" on storage.objects $p$;
  execute $p$
    create policy "staff read all documents" on storage.objects for select
      using (
        bucket_id in ('marksheets','resumes','offer-letters','declarations')
        and public.current_app_role() is not null
      )
  $p$;
end $$;
