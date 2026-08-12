-- 0044 — campus staff read drives (D10, confirmed 2026-08-12).
--
-- "Campus Placement Coordinator: should retain visibility through the entire
-- cycle — not just till shortlist, but through to offer sent/offer made."
--
-- Their students' applications, rounds and offers were already campus-scoped
-- readable (0018, 0043). The DRIVE those rows belong to was not:
-- is_org_reader() excludes campus roles, so the drive-progress screen would
-- name every student and no company. Read-only: publishing and editing stay
-- exactly where they were (is_operator / the drive's owners).

create policy drives_campus_read on drives for select
  using (is_campus_reader());
