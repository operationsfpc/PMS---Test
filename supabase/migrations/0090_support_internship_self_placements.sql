-- Migration 0090: Support internship self-placements
-- The self_placement_requests table was created before internship support (0014).
-- Internship offers require stipend_monthly (not ctc_lpa) and offer_category = 'internship'.

-- 1. Add stipend_monthly column
alter table self_placement_requests
  add column if not exists stipend_monthly numeric(10,2);

-- 2. Make ctc_lpa nullable (was NOT NULL)
alter table self_placement_requests
  alter column ctc_lpa drop not null;

-- 3. Add check: exactly one of ctc_lpa or stipend_monthly must be set
alter table self_placement_requests
  drop constraint if exists self_placement_has_pay;

alter table self_placement_requests
  add constraint self_placement_has_pay
  check (
    (ctc_lpa is not null and stipend_monthly is null)
    or (ctc_lpa is null and stipend_monthly is not null)
  );

-- 4. Fix the offer insert in approveSelfPlacement (frontend code fix in participation-view.ts)
-- This migration only handles the schema; the frontend must branch on drive_type:
--   internship: offer_category='internship', ctc_lpa=null, stipend_monthly=<value>
--   placement:  offer_category=<category>, ctc_lpa=<value>, stipend_monthly=null
