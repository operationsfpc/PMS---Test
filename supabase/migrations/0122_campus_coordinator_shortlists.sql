-- 0122 — The campus placement coordinator shortlists their own students.
--
-- Until now three layers disagreed about who may shortlist. The domain and the
-- route guard let a campus placement coordinator onto /central/shortlisting and
-- the portfolio offered them the button (F15, and `canShortlistFromPortfolio`),
-- while `shortlist_staff_only` (0008) gated writes on `is_operator()` — admin and
-- central_placement_coordinator only. The coordinator ticked students, pressed
-- Save and was refused by code and then, had the code moved, by RLS.
--
-- This gives the campus coordinator the write the interface already promised,
-- bounded the same way every other campus staff policy is bounded: `my_student_ids()`.
-- `applications_read_staff` (0018) already hides another campus's applicants, so a
-- coordinator who cannot read the application cannot produce its row here either.
--
-- Deliberately narrower than `is_campus_staff()`, which also covers campus_manager:
-- a campus manager reads and follows drives, they do not choose candidates.
--
-- Supersedes 0045's closing note ("shortlisting stays the Central CPC's decision")
-- for THIS role only. 0045's read policy is untouched and still needed: rank,
-- score and rationale remain invisible to students under PRD 13.1, and this
-- migration says nothing about them.
--
-- Upsert note: the screen writes with `upsert(..., { onConflict: "application_id" })`,
-- which Postgres runs as INSERT plus UPDATE-on-conflict. Both commands need both
-- clauses, so `using` and `with check` carry the identical predicate — as 0043 does
-- for attendance, the other campus-marked-at-the-venue table.
--
-- Two consequences, accepted rather than fixed (2026-10-23):
--
--   * `rank` is now per-reader. The screen writes the rank of the list the
--     person can see, and a campus coordinator sees only their own students —
--     so their save renumbers the same rows from 1 over their campus, while the
--     Central CPC's save numbers them over the whole drive. Whichever of the
--     two saved last owns the ordering, and the recruiter's pack sorts by it.
--     The same holds for the advisory target count: a coordinator whose tab
--     holds 8 of the 40 applicants is warned about a shortfall against a
--     recruiter's ask it cannot see the whole of. Both are left as they are —
--     rank and target are advisory, the decision itself is what is recorded.
--   * The export stays Central. `exports_operator_insert` (0043) still requires
--     `is_operator()`, so a campus coordinator who pressed "Export shortlist
--     (CSV)" got the file and then failed to write the `recruiter_exports` row
--     that says it left. The screen now hides both export buttons from that
--     role (`canExportShortlist`) instead of walking them into that dead end.
--     Widening it means widening the policy — a new data-sharing right, which
--     is the client's call and not this file's.

drop policy if exists shortlist_campus_write on public.shortlist_entries;

create policy shortlist_campus_write on public.shortlist_entries
  for insert to authenticated
  with check (
    current_app_role() = 'campus_placement_coordinator'
    and application_id in (
      select id from applications where student_id in (select my_student_ids())
    )
  );

create policy shortlist_campus_revise on public.shortlist_entries
  for update to authenticated
  using (
    current_app_role() = 'campus_placement_coordinator'
    and application_id in (
      select id from applications where student_id in (select my_student_ids())
    )
  )
  with check (
    current_app_role() = 'campus_placement_coordinator'
    and application_id in (
      select id from applications where student_id in (select my_student_ids())
    )
  );

comment on policy shortlist_campus_write on public.shortlist_entries is
  'Campus placement coordinator may shortlist applicants who are their own students (0122)';

comment on policy shortlist_campus_revise on public.shortlist_entries is
  'Campus placement coordinator may revise a shortlist decision for their own students (0122)';
