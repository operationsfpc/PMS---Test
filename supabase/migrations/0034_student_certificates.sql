-- A certificate is a NAME and a DOCUMENT. F9 and F17 (UAT 2026-08-06).
--
-- F17: "The student registration form should also contain an upload button for
-- students to upload the certificates. Name of certificate + upload
-- certificate."
--
-- F9: "Currently, students can upload certificates multiple times, which
-- should be restricted to a single upload."
--
-- The SRF collected `students.certifications`, a free-text box. It is both
-- failures at once: nothing in it can be verified, and nothing in it is
-- unique. A coordinator reading "AWS Cloud Practitioner, AWS Cloud
-- Practitioner, aws cert" has no way to tell whether that is one certificate
-- or three, and no document to check any of them against.
--
-- The uniqueness lives HERE rather than on a screen, because it was a screen
-- that let the duplicates in.

alter type document_kind add value if not exists 'certificate';

create table if not exists student_certificates (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  name        text not null,
  -- NOT NULL: a name with no document is the unverifiable claim this replaces.
  document_id uuid not null references student_documents(id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint certificate_has_a_name check (btrim(name) <> '')
);

create index if not exists student_certificates_student_idx
  on student_certificates (student_id);

-- One upload per certificate, compared the way a human would compare two
-- names: case and spacing are not the difference between two certificates.
create unique index if not exists one_certificate_per_name
  on student_certificates (student_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

alter table student_certificates enable row level security;
alter table student_certificates force  row level security;

-- The student owns them; the coordinators who verify a registration form read
-- them. Mirrors the policies on student_documents, which is where the file is.
create policy student_reads_own_certificates
  on student_certificates for select
  using (student_id = current_student_id() or is_org_reader() or is_campus_staff());

create policy student_adds_own_certificates
  on student_certificates for insert
  with check (student_id = current_student_id());

-- Removing one is how a student replaces it (there is no update path: a
-- certificate whose name and document can both change is a different
-- certificate, and the audit trail should say so).
create policy student_removes_own_certificates
  on student_certificates for delete
  using (student_id = current_student_id());

grant select, insert, delete on student_certificates to authenticated;

comment on table student_certificates is
  'F17: name + document. F9: one_certificate_per_name is what stops repeat uploads.';
