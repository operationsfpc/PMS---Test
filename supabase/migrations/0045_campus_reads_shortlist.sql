-- 0045 — campus staff read their students' shortlist standing (D10).
--
-- Found while PROVING 0044 live, not by a test: the campus CPC read 6 drives
-- and 6 applications but 0 shortlist entries — shortlist_staff_only is
-- is_org_reader(), which excludes campus roles. /cpc/drives would have shown
-- every student as "not shortlisted", which is a wrong screen, not an empty
-- one. Same silent-RLS-filter class as the invisible-drives bug (0030).
--
-- PRD §13.1 is unaffected: it forbids showing rank, rationale or inclusion to
-- STUDENTS. A campus coordinator is staff, scoped to their own students.
-- Select-only: shortlisting stays the Central CPC's decision.

create policy shortlist_campus_read on shortlist_entries for select
  using (
    is_campus_reader()
    and application_id in (
      select id from applications where student_id in (select my_student_ids())
    )
  );
