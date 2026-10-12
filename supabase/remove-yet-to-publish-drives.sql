-- =============================================================================
-- Remove "Yet to Publish" Drives (Submitted, Draft, and Approved)
-- Run this in the Supabase SQL Editor
-- =============================================================================

begin;

-- 1. Inspect drives about to be removed
select id, company_name, role_title, status, created_at
from public.drives
where status in ('draft', 'submitted', 'approved')
order by created_at desc;

-- 2. Delete all yet-to-publish drives (cascades to degrees, campuses, rounds)
delete from public.drives
where status in ('draft', 'submitted', 'approved');

commit;

-- 3. Verification: confirm only completed/live drives remain
select status, count(*) 
from public.drives 
group by status;
