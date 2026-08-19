-- ============================================================================
-- TEST DATA ONLY.  NOT A MIGRATION.  DO NOT MOVE INTO supabase/migrations/.
-- ============================================================================
-- Creates 10 dummy drives and injects applications from the 80 approved test
-- students so the Central PC shortlisting workflow can be exercised end-to-end.
--
-- Drives are in  applications_closed  status so they appear in the shortlisting
-- queue immediately. The Central PC can open any drive and begin shortlisting.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--   OR via Management API:
--     TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
--     curl -s -X POST "https://api.supabase.com/v1/projects/poscikalmgfpvbjfytgw/database/query" \
--          -H "Authorization: Bearer $TOKEN" \
--          -H "Content-Type: application/json" \
--          -d "{\"query\": $(jq -Rs . < scripts/seed-dummy-drives.sql)}"
--
-- REMOVE with: scripts/remove-test-drives.sql
-- Marker: drives.company_name LIKE 'Dummy Drive%'
-- ============================================================================

begin;

do $check$ begin
  if not exists (select 1 from profiles where role = 'account_executive') then
    raise exception 'No AE profile found.'; end if;
  if not exists (select 1 from profiles where role = 'delivery_head') then
    raise exception 'No delivery_head profile found.'; end if;
  if not exists (select 1 from profiles where role in ('central_placement_coordinator','admin')) then
    raise exception 'No Central CPC / admin profile found.'; end if;
end $check$;

-- ---------------------------------------------------------------------------
-- 1. Ten dummy drives
-- ---------------------------------------------------------------------------
-- Eligibility bars are set LOW so all 80 approved test students qualify:
--   min_overall_cgpa    = 6.0   (system CGPA_BAR)
--   arrears_policy      = flexible
--   eligible_passing_years = {2027}
--   no 10th / 12th bars
--
-- Status: applications_closed  -> appears in the Central PC shortlisting queue.
-- Window: opened 14 days ago, closed 2 days ago.
-- Drives 1-7, 9-10 -> regular (CTC <= 5 LPA).
-- Drive 8 -> dream (CTC 5.5 LPA) with a slightly higher CGPA bar (6.5).

with
  ae  as (select id from profiles where role = 'account_executive'                       limit 1),
  dh  as (select id from profiles where role = 'delivery_head'                           limit 1),
  cpc as (select id from profiles where role in ('central_placement_coordinator','admin')
                                    order by role desc                                    limit 1)
insert into drives (
  company_name,   role_title,        role_category,
  drive_type,     offer_category,
  job_description, work_locations,   openings,
  ctc_min_lpa,    ctc_max_lpa,       ctc_breakup,
  drive_mode,     shift_type,
  arrears_policy, min_overall_cgpa,  eligible_passing_years,
  application_start, application_end,
  status,
  created_by, approved_by, approved_at,
  published_by,   published_at,
  open_to_all_override,
  round_count
)
values
  (
    'Dummy Drive 1', 'Software Developer', 'software_technical'::role_category,
    'placement'::drive_type, 'regular'::offer_category,
    'Test drive. Develop and maintain web applications using modern frameworks. Collaborate with cross-functional teams.',
    'Chennai, Bengaluru', 30,
    3.00, 3.50, 'Fixed: 3.0 LPA | Variable: 0.5 LPA',
    'virtual'::drive_mode, 'day',
    'flexible'::arrear_policy, 6.0, '{2027}',
    now()-'14 days'::interval, now()-'2 days'::interval,
    'applications_closed'::drive_status,
    (select id from ae), (select id from dh), now()-'13 days'::interval,
    (select id from cpc), now()-'10 days'::interval,
    false, 3
  ),
  (
    'Dummy Drive 2', 'IT Support Analyst', 'technical_support_it_ops'::role_category,
    'placement'::drive_type, 'regular'::offer_category,
    'Test drive. Provide L1/L2 technical support, manage tickets and coordinate with engineering teams.',
    'Chennai', 25,
    3.00, 3.20, 'Fixed: 3.0 LPA | Variable: 0.2 LPA',
    'on_campus'::drive_mode, 'day',
    'flexible'::arrear_policy, 6.0, '{2027}',
    now()-'14 days'::interval, now()-'2 days'::interval,
    'applications_closed'::drive_status,
    (select id from ae), (select id from dh), now()-'13 days'::interval,
    (select id from cpc), now()-'10 days'::interval,
    false, 2
  ),
  (
    'Dummy Drive 3', 'Systems Engineer', 'software_technical'::role_category,
    'placement'::drive_type, 'regular'::offer_category,
    'Test drive. Design, build and maintain scalable systems. Work on cloud infrastructure and DevOps pipelines.',
    'Hyderabad, Pune', 20,
    3.40, 3.60, 'Fixed: 3.4 LPA | Variable: 0.2 LPA',
    'virtual'::drive_mode, 'day',
    'flexible'::arrear_policy, 6.0, '{2027}',
    now()-'14 days'::interval, now()-'2 days'::interval,
    'applications_closed'::drive_status,
    (select id from ae), (select id from dh), now()-'13 days'::interval,
    (select id from cpc), now()-'10 days'::interval,
    false, 3
  ),
  (
    'Dummy Drive 4', 'Programmer Analyst', 'software_technical'::role_category,
    'placement'::drive_type, 'regular'::offer_category,
    'Test drive. Write, test and debug code across multiple applications. Participate in Agile sprints.',
    'Chennai, Mumbai', 40,
    3.80, 4.00, 'Fixed: 3.8 LPA | Variable: 0.2 LPA',
    'on_campus'::drive_mode, 'day',
    'flexible'::arrear_policy, 6.0, '{2027}',
    now()-'14 days'::interval, now()-'2 days'::interval,
    'applications_closed'::drive_status,
    (select id from ae), (select id from dh), now()-'13 days'::interval,
    (select id from cpc), now()-'10 days'::interval,
    false, 3
  ),
  (
    'Dummy Drive 5', 'Digital Marketing Analyst', 'digital_marketing'::role_category,
    'placement'::drive_type, 'regular'::offer_category,
    'Test drive. Plan and execute digital marketing campaigns. Manage SEO, SEM and social media analytics.',
    'Chennai, Bengaluru', 15,
    4.00, 4.50, 'Fixed: 4.0 LPA | Variable: 0.5 LPA',
    'virtual'::drive_mode, 'day',
    'flexible'::arrear_policy, 6.0, '{2027}',
    now()-'14 days'::interval, now()-'2 days'::interval,
    'applications_closed'::drive_status,
    (select id from ae), (select id from dh), now()-'13 days'::interval,
    (select id from cpc), now()-'10 days'::interval,
    false, 2
  ),
  (
    'Dummy Drive 6', 'Associate IT Engineer', 'technical_support_it_ops'::role_category,
    'placement'::drive_type, 'regular'::offer_category,
    'Test drive. Assist in deploying and maintaining IT infrastructure. Monitor systems and respond to incidents.',
    'Coimbatore, Chennai', 35,
    3.60, 3.80, 'Fixed: 3.6 LPA | Variable: 0.2 LPA',
    'pooled'::drive_mode, 'day',
    'flexible'::arrear_policy, 6.0, '{2027}',
    now()-'14 days'::interval, now()-'2 days'::interval,
    'applications_closed'::drive_status,
    (select id from ae), (select id from dh), now()-'13 days'::interval,
    (select id from cpc), now()-'10 days'::interval,
    false, 2
  ),
  (
    'Dummy Drive 7', 'Business Analyst', 'operations_business'::role_category,
    'placement'::drive_type, 'regular'::offer_category,
    'Test drive. Analyse business processes, gather requirements and produce functional specifications.',
    'Chennai, Bengaluru', 20,
    4.50, 4.80, 'Fixed: 4.5 LPA | Variable: 0.3 LPA',
    'virtual'::drive_mode, 'day',
    'flexible'::arrear_policy, 6.0, '{2027}',
    now()-'14 days'::interval, now()-'2 days'::interval,
    'applications_closed'::drive_status,
    (select id from ae), (select id from dh), now()-'13 days'::interval,
    (select id from cpc), now()-'10 days'::interval,
    false, 3
  ),
  (
    -- DREAM drive: CTC 5.5 LPA, slightly higher CGPA bar (6.5)
    'Dummy Drive 8', 'Software Engineer', 'software_technical'::role_category,
    'placement'::drive_type, 'dream'::offer_category,
    'Test drive (Dream). Build high-performance backend services and APIs. Strong data structures knowledge required.',
    'Bengaluru, Hyderabad', 10,
    5.00, 5.50, 'Fixed: 5.0 LPA | Variable: 0.5 LPA',
    'virtual'::drive_mode, 'day',
    'flexible'::arrear_policy, 6.5, '{2027}',
    now()-'14 days'::interval, now()-'2 days'::interval,
    'applications_closed'::drive_status,
    (select id from ae), (select id from dh), now()-'13 days'::interval,
    (select id from cpc), now()-'10 days'::interval,
    false, 4
  ),
  (
    'Dummy Drive 9', 'Sales Development Associate', 'sales'::role_category,
    'placement'::drive_type, 'regular'::offer_category,
    'Test drive. Generate leads, qualify prospects and hand off to account executives. Target-driven role.',
    'Pan India', 50,
    4.00, 4.20, 'Fixed: 4.0 LPA | Variable: 0.2 LPA',
    'on_campus'::drive_mode, 'day',
    'flexible'::arrear_policy, 6.0, '{2027}',
    now()-'14 days'::interval, now()-'2 days'::interval,
    'applications_closed'::drive_status,
    (select id from ae), (select id from dh), now()-'13 days'::interval,
    (select id from cpc), now()-'10 days'::interval,
    false, 2
  ),
  (
    'Dummy Drive 10', 'Technical Support Engineer', 'technical_support_it_ops'::role_category,
    'placement'::drive_type, 'regular'::offer_category,
    'Test drive. Resolve customer-reported technical issues, own escalation paths and document known solutions.',
    'Chennai, Coimbatore', 30,
    4.20, 4.60, 'Fixed: 4.2 LPA | Variable: 0.4 LPA',
    'pooled'::drive_mode, 'day',
    'flexible'::arrear_policy, 6.0, '{2027}',
    now()-'14 days'::interval, now()-'2 days'::interval,
    'applications_closed'::drive_status,
    (select id from ae), (select id from dh), now()-'13 days'::interval,
    (select id from cpc), now()-'10 days'::interval,
    false, 2
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Target all 5 test campuses for every dummy drive
-- ---------------------------------------------------------------------------

insert into drive_target_campuses (drive_id, campus_id)
select d.id, c.id
from   drives d
cross  join campuses c
where  d.company_name like 'Dummy Drive%'
  and  c.name in (
         'SDNB Vaishnav College for Women', 'S-VYASA University',
         'Takshashila University', 'Kamaraj College', 'AMET University'
       )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Round definitions
-- ---------------------------------------------------------------------------
-- Each drive gets rounds up to its round_count.
-- These are the named rounds the UI uses to advance shortlisted students.

insert into drive_rounds (drive_id, sequence, name)
select d.id, r.seq, r.rname
from   drives d
cross  join (values
  (1, 'Round 1 - Aptitude Test'),
  (2, 'Round 2 - Technical Interview'),
  (3, 'Round 3 - HR Interview'),
  (4, 'Round 4 - Final Discussion')
) as r(seq, rname)
where  d.company_name like 'Dummy Drive%'
  and  r.seq <= d.round_count
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Applications  (all 80 approved test students x 10 drives = 800 rows)
-- ---------------------------------------------------------------------------
-- profile_snapshot mirrors the format the app writes (verified against the
-- live snapshot for Shashwathi Test in the applications table).
-- applied_at is spread across the application window per student position.

insert into applications (drive_id, student_id, applied_at, profile_snapshot, resume_id)
select
  d.id,
  s.id,
  d.application_start
    + (d.application_end - d.application_start)
      * ((right(s.roll_number, 3))::numeric / 20.0),
  jsonb_build_object(
    'profile', jsonb_build_object(
      'id',                  s.id,
      'email',               s.email,
      'branch',              coalesce(br.name, ''),
      'degree',              deg.name,
      'offers',              '[]'::jsonb,
      'fullName',            s.full_name,
      'academics',           jsonb_build_object(
        'city',              ci.name,
        'branch',            coalesce(br.name, ''),
        'campus',            c.name,
        'degree',            deg.name,
        'overallCgpa',       coalesce(s.overall_cgpa, 0),
        'passingYear',       s.passing_year,
        'currentArrears',    s.current_arrears,
        'tenthPercentage',   coalesce(s.tenth_percentage, 0),
        'historyOfArrears',  s.history_of_arrears,
        'twelfthPercentage', coalesce(s.twelfth_percentage, 0)
      ),
      'srfStatus',           s.srf_status::text,
      'rollNumber',          s.roll_number,
      'overallCgpa',         coalesce(s.overall_cgpa, 0),
      'passingYear',         s.passing_year,
      'currentArrears',      s.current_arrears,
      'technicalSkills',     s.technical_skills,
      'tenthPercentage',     coalesce(s.tenth_percentage, 0),
      'historyOfArrears',    s.history_of_arrears,
      'twelfthPercentage',   coalesce(s.twelfth_percentage, 0),
      'participationStatus', s.participation_status::text
    ),
    'resumeId', null
  ),
  null
from   drives   d
cross  join students s
join   campuses c   on c.id  = s.campus_id
join   cities   ci  on ci.id = c.city_id
join   degrees  deg on deg.id = s.degree_id
left   join branches br on br.id = s.branch_id
where  d.company_name like 'Dummy Drive%'
  and  s.email like 'fpc.test.%@example.com'
  and  s.srf_status = 'srf_approved'
on conflict (drive_id, student_id) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------

select
  d.company_name                                    as drive,
  d.role_title                                      as role,
  d.offer_category,
  d.ctc_min_lpa || '-' || d.ctc_max_lpa || ' LPA'  as ctc,
  d.min_overall_cgpa                                as min_cgpa,
  d.status,
  d.round_count,
  (select count(*) from applications   a  where a.drive_id  = d.id) as applicants,
  (select count(*) from drive_rounds   dr where dr.drive_id = d.id) as rounds,
  (select count(*) from drive_target_campuses dtc where dtc.drive_id = d.id) as campuses
from   drives d
where  d.company_name like 'Dummy Drive%'
order  by d.company_name;
