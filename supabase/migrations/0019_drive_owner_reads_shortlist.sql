-- The AE who raised a drive may see its shortlist.
--
-- The shortlist IS the list the recruiter is sent (PRD §13.2), and the Account
-- Executive owns that client relationship: their drive portfolio counts how
-- many applicants were included. Without this the count is not merely missing,
-- it reads a confident zero, which is worse.
--
-- PRD §13.1 is unaffected: it forbids showing rank, rationale or inclusion to
-- STUDENTS, and shortlist_entries still has no student policy of any kind.
-- Scoped to drives the AE raised, and select-only - shortlisting stays the
-- Central CPC's decision.

create policy shortlist_read_drive_owner on shortlist_entries for select
  using (
    current_app_role() = 'account_executive'
    and application_id in (
      select a.id from applications a
       where a.drive_id in (select d.id from drives d where d.created_by = auth.uid())
    )
  );

-- Same argument for the outcome. An offer is the most important thing that can
-- happen to a drive, and the AE who raised it is asked by the client how many
-- were made. Their own drive only, select-only: declaring an offer stays with
-- the Central CPC (is_operator).
create policy offers_read_drive_owner on offers for select
  using (
    current_app_role() = 'account_executive'
    and drive_id in (select id from drives where created_by = auth.uid())
  );
