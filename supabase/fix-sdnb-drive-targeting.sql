-- ============================================================================
-- Fix: Add SDNB Vaishnav College to all drives that have campus targeting
-- but were published without including SDNB.
--
-- Root cause: SDNB (id 6ea3bf8c-deed-4e71-ae58-fad4d0a9c051) is active in the
-- campuses table and shows in the publish screen's campus selector, but the
-- 4 live drives (TeamTech, Mayura, Wippi, App Innovation) were published with
-- explicit campus lists that omitted SDNB. Since the RLS policy treats
-- "has targets but SDNB not in them" as "not visible to SDNB", students at
-- SDNB see zero drives.
--
-- Safe to run multiple times — ON CONFLICT DO NOTHING makes it idempotent.
-- Run this in Supabase Dashboard > SQL Editor.
-- ============================================================================

-- 1. Add SDNB to every drive that has campus targeting but doesn't include it
insert into drive_target_campuses (drive_id, campus_id)
select d.id, '6ea3bf8c-deed-4e71-ae58-fad4d0a9c051'::uuid
  from drives d
 where exists (
         select 1 from drive_target_campuses t where t.drive_id = d.id
       )
   and not exists (
         select 1 from drive_target_campuses t
          where t.drive_id = d.id
            and t.campus_id = '6ea3bf8c-deed-4e71-ae58-fad4d0a9c051'
       )
on conflict do nothing;

-- 2. Verify: show which drives now target SDNB
select d.id as drive_id,
       d.company_name,
       d.status,
       case
         when exists (
           select 1 from drive_target_campuses t
            where t.drive_id = d.id
              and t.campus_id = '6ea3bf8c-deed-4e71-ae58-fad4d0a9c051'
         ) then 'YES'
         when not exists (
           select 1 from drive_target_campuses t where t.drive_id = d.id
         ) then 'ALL (no targeting)'
         else 'NO'
       end as sdnb_visible
  from drives d
 where d.status in ('live', 'approved', 'applications_closed', 'in_rounds')
 order by d.created_at desc;
