-- A resume's storage_path is the OBJECT KEY, not the bucket-qualified path.
--
-- 2026-08-26. Karthik: "Export shortlist (CSV)" answered with
--   "A resume could not be downloaded (…-images (6).pdf). Try the export again."
--
-- `apply-repository` uploaded the object to `<student>/<file>` inside the
-- `resumes` bucket and then recorded `resumes/<student>/<file>` in this
-- column. The recruiter export downloads with
-- `storage.from('resumes').download(storage_path)`, so it asked for
-- `resumes/resumes/<student>/<file>` — an object that has never existed.
--
-- Confirmed against production before writing this: all 14 resume rows failed
-- to join `storage.objects`, so the pack had never once been built. Every
-- other uploader on this table (marksheets, certificates, offer letters, the
-- SRF's profile resumes) writes the bare key, and every other reader expects
-- it.
--
-- Participation evidence is deliberately NOT touched: `opt_out_declaration`
-- and `off_campus_offer` carry their bucket because one column there serves
-- two buckets, and `signedUrlFor` splits the bucket back off. Repairing those
-- would break the screens that read them.
--
-- Idempotent, and narrow on purpose:
--   * only `kind = 'resume'`;
--   * only a LEADING `resumes/`, so `<student>/resumes/cv.pdf` is untouched —
--     a folder may legitimately be named for its bucket, and rewriting it
--     would swap one file for another;
--   * never to the empty string: a row holding only `resumes/` names no
--     object, and blanking it would hide a malformed row instead of leaving
--     it visible.

update student_documents
   set storage_path = substring(storage_path from length('resumes/') + 1)
 where kind = 'resume'
   and storage_path like 'resumes/%'
   and length(storage_path) > length('resumes/');
