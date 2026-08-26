-- The organisation's placement figures, as AGGREGATES.
--
-- 2026-08-26, option A, approved by Karthik: "AE gets a landing page … give
-- them wider access of all placement overall numbers".
--
-- An Account Executive is neither is_org_reader() nor is_campus_reader(), so
-- `select from students` returns them nothing — deliberately, since 2026-08-17:
-- "the AE should only be able to view the students shortlisted or selected on
-- their drives". They asked for the NUMBERS, so they get exactly the numbers:
-- one row of counts from a security definer function, and never a student
-- record. Making them an org reader instead would have been one line and would
-- also have handed them every student's CGPA, email and phone.
--
-- ⚠️ This is a second statement of rules that live in src/domain/statistics.ts
-- and src/domain/ctc-statistics.ts. That is the Layer 2 bargain (CLAUDE.md:
-- the database enforces the same rules independently) and it is the same
-- bargain RLS already makes. src/db/placement-totals.test.ts pins the SQL to
-- both domain functions on a shared cohort, so the two cannot drift in silence.
--
-- The rules, restated:
--   * an OPTED-OUT student leaves the denominator entirely (PRD §16.2);
--   * a DISBARRED student stays in — a sanction is not a withdrawal;
--   * a SELF-PLACED offer is its own line and never an on-campus placement,
--     and it is counted across the whole roster, opt-outs included, exactly as
--     computePlacementStats counts it;
--   * ONE package figure per placed student (R9). The reported record is the
--     highest-CTC on-campus offer, ties to the earliest declared — for a CTC
--     the tie-break cannot change the value, so `max(ctc_lpa)` per student is
--     R9's figure.
--
-- The rate itself is NOT computed here. It is published by
-- src/domain/placement-totals.ts, so one rounding rule serves every screen.

create or replace function placement_totals()
returns table (
  eligible bigint,
  placed bigint,
  self_placed bigint,
  opted_out bigint,
  completed_drives bigint,
  highest_lpa numeric,
  lowest_lpa numeric,
  average_lpa numeric,
  median_lpa numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Aggregates are not public. Any member of staff may quote the
  -- organisation's placement figures; a student may not, and neither may a
  -- caller with no session at all.
  --
  -- `coalesce(..., false)` is not decoration. `current_app_role()` is NULL for
  -- anyone with no profile row - every student, and any caller with no session
  -- - so the expression is NULL, `not NULL` is NULL, and `if NULL then` does
  -- not fire. The guard would have let exactly the people it names through.
  -- Caught by src/db/placement-totals.test.ts before this ever ran anywhere.
  if not coalesce(
    is_org_reader()
    or is_campus_reader()
    or current_app_role() = 'account_executive',
    false
  ) then
    raise exception 'not permitted';
  end if;

  return query
  with counted as (
    select s.id, s.participation_status
      from students s
  ),
  on_campus as (
    select distinct o.student_id
      from offers o
     where o.source = 'on_campus'
       and o.drive_type in ('placement', 'internship_convertible')
  ),
  self_placed_students as (
    select distinct o.student_id
      from offers o
     where o.source = 'self_placed'
  ),
  -- R9: one figure per placed student, and only for students who count.
  records as (
    select o.student_id, max(o.ctc_lpa) as ctc_lpa
      from offers o
      join counted c on c.id = o.student_id
     where o.source = 'on_campus'
       and o.drive_type in ('placement', 'internship_convertible')
       and c.participation_status <> 'opted_out'
     group by o.student_id
  )
  select
    (select count(*) from counted where participation_status <> 'opted_out'),
    (select count(*) from counted c
      where c.participation_status <> 'opted_out'
        and c.id in (select student_id from on_campus)),
    (select count(*) from counted c
      where c.id in (select student_id from self_placed_students)),
    (select count(*) from counted where participation_status = 'opted_out'),
    (select count(*) from drives where status = 'completed'),
    -- Null rather than 0 when nobody is placed: zero is a real CTC.
    (select round(max(ctc_lpa), 2) from records),
    (select round(min(ctc_lpa), 2) from records),
    (select round(avg(ctc_lpa), 2) from records),
    -- percentile_cont is summariseCtc's median exactly: the midpoint of the
    -- two middle figures when the count is even.
    (select round(percentile_cont(0.5) within group (order by ctc_lpa)::numeric, 2) from records);
end;
$$;

revoke all on function placement_totals() from public;
grant execute on function placement_totals() to authenticated;
