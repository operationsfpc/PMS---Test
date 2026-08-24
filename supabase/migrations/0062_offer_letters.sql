-- Offer letters attached to a final selection.
--
-- Spec 2026-08-21 part B, approved 2026-08-24 (answers: 1a yes · 1b PDF +
-- JPG/PNG ≤ 5 MB · 1c staff-who-can-read-the-offer + the student · 1d
-- attach-later allowed).
--
-- The letter is the recruiter's document; the offer row is our claim. Both
-- halves of the attachment travel together (the 0051 rule): a path with no
-- name, or a name with no path, is a link that opens nothing.

alter table offers
  add column attachment_path text,
  add column attachment_name text;

alter table offers
  add constraint offer_attachment_is_whole check (
    (attachment_path is null and attachment_name is null)
    or (attachment_path is not null and attachment_name is not null)
  );

-- The bucket, namespaced `<student_uuid>/<drive_uuid>/<file>`.
--
-- READ is delegated to the offers table's own RLS (the 0051 pattern): you may
-- open a letter if you may read an offer for that student and drive. The
-- subquery runs as the caller, so `offers_read_self` admits the student the
-- letter belongs to, `offers_read_staff` admits org readers and campus
-- readers for their own students — exactly answer 1c, and it cannot drift
-- from who can see the offer.
--
-- WRITE is the operator's (Central CPC declares final selections; admin is
-- the operator pair). Guarded like 0051 so the PGlite harness, which has no
-- storage schema, still runs every other statement.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('offer-letters', 'offer-letters', false, 5242880,
          array['application/pdf', 'image/jpeg', 'image/png'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types,
        public = false;

  execute $p$ drop policy if exists "read an offer letter with its offer" on storage.objects $p$;
  execute $p$
    create policy "read an offer letter with its offer" on storage.objects for select
      using (
        bucket_id = 'offer-letters'
        and exists (
          select 1 from public.offers o
          where o.student_id::text = (storage.foldername(name))[1]
            and o.drive_id::text = (storage.foldername(name))[2]
        )
      )
  $p$;

  execute $p$ drop policy if exists "operator attaches an offer letter" on storage.objects $p$;
  execute $p$
    create policy "operator attaches an offer letter" on storage.objects for insert
      with check (
        bucket_id = 'offer-letters'
        and public.is_operator()
      )
  $p$;
end $$;
