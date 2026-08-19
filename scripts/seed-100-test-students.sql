-- ============================================================================
-- TEST DATA ONLY.  NOT A MIGRATION.  DO NOT MOVE INTO supabase/migrations/.
-- ============================================================================
-- Injects 100 test students across 5 real FPC partner campuses for trial
-- shortlisting. Campus, degree, branch and city rows are real infrastructure
-- and will NOT be removed by the cleanup script.
--
-- Source: ~/FPC-Data/fpc-students-2026.csv  (2026-08 snapshot)
-- Campuses: top-5 by 2027 YOP student count (the graduating / placement batch)
--
--   Campus                           City          Programme            2027 actual
--   SDNB Vaishnav College for Women  Chennai       B.Sc CS / CT        54
--   S-VYASA University               Bengaluru     BCA                 93
--   Takshashila University           Chennai       B.Sc CS / CT        54
--   Kamaraj College                  Virudhunagar  BCA                 46
--   AMET University                  Chennai       B.Sc CS / CT        41
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--   OR via Management API:
--     TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
--     curl -s -X POST "https://api.supabase.com/v1/projects/poscikalmgfpvbjfytgw/database/query" \
--          -H "Authorization: Bearer $TOKEN" \
--          -H "Content-Type: application/json" \
--          -d "{\"query\": $(jq -Rs . < scripts/seed-100-test-students.sql)}"
--
-- REMOVE BEFORE GO-LIVE: run scripts/remove-test-students.sql
--
-- Test-data markers used by the removal script:
--   students.email  LIKE 'fpc.test.%@example.com'   (RFC 2606 domain)
--   roll_number     SDN27NNN / SVY27NNN / TAK27NNN / KAM27NNN / AMT27NNN
--   student_documents.storage_path LIKE 'test-seed/%'
--
-- Re-running is safe: every insert uses ON CONFLICT DO NOTHING.
-- ============================================================================

begin;

-- Guard: need at least one admin profile for verified_by / srf_decided_by.
do $guard$ begin
  if not exists (select 1 from profiles where role = 'admin') then
    raise exception
      'Seed requires at least one admin profile -- create one first.';
  end if;
end $guard$;

-- ---------------------------------------------------------------------------
-- 1. Cities
-- ---------------------------------------------------------------------------
-- Chennai already exists. Add Bengaluru and Virudhunagar.

insert into cities (name, state)
values
  ('Bengaluru',    'Karnataka'),
  ('Virudhunagar', 'Tamil Nadu')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Campuses
-- ---------------------------------------------------------------------------
-- SDNB already exists (code 600044).
-- code = institution PIN code (campuses.code is UNIQUE in live schema).
-- Contact fields use placeholder values -- update with real data at onboarding.

insert into campuses (
  name, city_id, code, address,
  primary_contact_name, primary_contact_email, primary_contact_phone
)
values
  (
    'S-VYASA University',
    (select id from cities where name = 'Bengaluru'),
    '560105',
    'Prashanti Kutiram, Vivekananda Nagar, Jigani, Bengaluru, Karnataka 560105',
    'Placement Cell',
    'placement.svyasa@example.com',
    '08028428885'
  ),
  (
    'Takshashila University',
    (select id from cities where name = 'Chennai'),
    '600097',
    'Poonamallee High Road, Vanagaram, Chennai, Tamil Nadu 600095',
    'Placement Cell',
    'placement.takshashila@example.com',
    '04448001001'
  ),
  (
    'Kamaraj College',
    (select id from cities where name = 'Virudhunagar'),
    '626001',
    'Thoothukudi Road, Virudhunagar, Tamil Nadu 626001',
    'Placement Cell',
    'placement.kamaraj@example.com',
    '04562222001'
  ),
  (
    'AMET University',
    (select id from cities where name = 'Chennai'),
    '603112',
    '135 East Coast Road, Kanathur, Chennai, Tamil Nadu 603112',
    'Placement Cell',
    'placement.amet@example.com',
    '04424534180'
  )
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Branches under B.Sc CS / CT
-- ---------------------------------------------------------------------------
-- "AI and DS" under BCA already exists.
-- Add the two specialisations used by SDNB / Takshashila / AMET.

insert into branches (degree_id, name)
select d.id, b.name
from   degrees d
cross  join (values
  ('Computer Science with AI'),
  ('AI and Machine Learning')
) as b(name)
where  d.name = 'B.Sc CS / CT'
on conflict (degree_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- 4. campus_degrees
-- ---------------------------------------------------------------------------

insert into campus_degrees (campus_id, degree_id)
select c.id, d.id
from   campuses c
cross  join degrees d
where  c.name in (
         'SDNB Vaishnav College for Women',
         'S-VYASA University', 'Takshashila University',
         'Kamaraj College',    'AMET University'
       )
  and  d.name in ('B.Sc CS / CT', 'BCA')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5. campus_programmes (passing year 2027)
-- ---------------------------------------------------------------------------

-- SDNB -> B.Sc CS / CT + Computer Science with AI
insert into campus_programmes (campus_id, degree_id, branch_id, passing_year)
select c.id, d.id, br.id, 2027
from   campuses c, degrees d, branches br
where  c.name  = 'SDNB Vaishnav College for Women'
  and  d.name  = 'B.Sc CS / CT'
  and  br.name = 'Computer Science with AI' and br.degree_id = d.id
on conflict do nothing;

-- S-VYASA + Kamaraj -> BCA + AI and DS
insert into campus_programmes (campus_id, degree_id, branch_id, passing_year)
select c.id, d.id, br.id, 2027
from   campuses c, degrees d, branches br
where  c.name  in ('S-VYASA University', 'Kamaraj College')
  and  d.name  = 'BCA'
  and  br.name = 'AI and DS' and br.degree_id = d.id
on conflict do nothing;

-- Takshashila + AMET -> B.Sc CS / CT + AI and Machine Learning
insert into campus_programmes (campus_id, degree_id, branch_id, passing_year)
select c.id, d.id, br.id, 2027
from   campuses c, degrees d, branches br
where  c.name  in ('Takshashila University', 'AMET University')
  and  d.name  = 'B.Sc CS / CT'
  and  br.name = 'AI and Machine Learning' and br.degree_id = d.id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. 100 test students
-- ---------------------------------------------------------------------------
-- 20 per campus.  Distribution per campus:
--   j = 1..16  ->  srf_approved   (80 total -- main shortlisting cohort)
--   j = 17, 18 ->  srf_submitted  (10 total -- pending in CPC queue)
--   j = 19     ->  srf_rejected   ( 5 total -- form sent back)
--   j = 20     ->  invited        ( 5 total -- not yet started)
--
-- CGPA (approved only, j=1..16): varied 6.0-9.2.
-- 10th board: j % 3 = 0 -> CBSE; else -> State Board (campus-appropriate state).
-- Arrears: j % 7 = 0 -> 1 standing arrear; j % 11 = 0 -> 1 historical only.

with
  campus_cfg(cname, prefix, dname, brname, board_state) as (
    values
      ('SDNB Vaishnav College for Women','SDN','B.Sc CS / CT','Computer Science with AI',  'Tamil Nadu'),
      ('S-VYASA University',             'SVY','BCA',          'AI and DS',                 'Karnataka'),
      ('Takshashila University',         'TAK','B.Sc CS / CT','AI and Machine Learning',    'Tamil Nadu'),
      ('Kamaraj College',                'KAM','BCA',          'AI and DS',                 'Tamil Nadu'),
      ('AMET University',                'AMT','B.Sc CS / CT','AI and Machine Learning',    'Tamil Nadu')
  ),
  cgpa_tbl(pos, cgpa) as (
    values
      ( 1, 9.20::numeric), ( 2, 8.80), ( 3, 8.50), ( 4, 8.10), ( 5, 7.80),
      ( 6, 7.50),          ( 7, 7.30), ( 8, 7.00), ( 9, 6.80), (10, 6.50),
      (11, 6.20),          (12, 6.00), (13, 8.90), (14, 7.60), (15, 7.10),
      (16, 8.30)
  ),
  fname_women(pos, n) as (
    values
      ( 1,'Aadhira'),( 2,'Bhavana'),( 3,'Chandana'),( 4,'Deepika'),( 5,'Divya'),
      ( 6,'Gayathri'),( 7,'Haritha'),( 8,'Ishwarya'),( 9,'Janani'),(10,'Kavitha'),
      (11,'Lakshmi'),(12,'Megha'),(13,'Nithya'),(14,'Pavithra'),(15,'Preethi'),
      (16,'Ranjani'),(17,'Saranya'),(18,'Shalini'),(19,'Uma'),(20,'Vaishnavi')
  ),
  fname_mixed(pos, n) as (
    values
      ( 1,'Aarav'),  ( 2,'Aditya'), ( 3,'Akash'),  ( 4,'Arjun'),  ( 5,'Dhruv'),
      ( 6,'Ganesh'), ( 7,'Harish'), ( 8,'Karthik'), ( 9,'Lokesh'),(10,'Manoj'),
      (11,'Naveen'),(12,'Prabhu'),(13,'Rajesh'),(14,'Sathish'),(15,'Selva'),
      (16,'Siva'),  (17,'Suresh'),(18,'Tamil'), (19,'Udhay'),  (20,'Vijay')
  ),
  lname_by_prefix(prefix, n) as (
    values
      ('SDN','Krishnamurthy'),
      ('SVY','Subramaniam'),
      ('TAK','Rajagopal'),
      ('KAM','Muthuswamy'),
      ('AMT','Venkataraman')
  ),
  expanded as (
    select
      cfg.*,
      j,
      cfg.prefix || '27' || lpad(j::text, 3, '0')                           as roll_no,
      'fpc.test.' || lower(cfg.prefix) || '27' || lpad(j::text, 3, '0')
        || '@example.com'                                                     as email,
      (case when cfg.prefix = 'SDN'
            then (select n from fname_women where pos = j)
            else (select n from fname_mixed where pos = j)
       end
       || ' '
       || (select n from lname_by_prefix where prefix = cfg.prefix))        as full_name,
      (select id from campuses where name = cfg.cname)                       as campus_id,
      (select id from degrees  where name = cfg.dname)                       as degree_id,
      (select id from branches where name = cfg.brname
         and degree_id = (select id from degrees where name = cfg.dname))    as branch_id,
      (select cgpa from cgpa_tbl where pos = j)                              as target_cgpa,
      (68 + ((j * 7) % 27))::numeric(5,2)                                   as tenth_pct,
      (62 + ((j * 9) % 28))::numeric(5,2)                                   as twelfth_pct,
      case when j <= 16 then 'srf_approved'
           when j <= 18 then 'srf_submitted'
           when j  = 19 then 'srf_rejected'
           else               'invited'
      end                                                                     as srf_st,
      case when j % 7 = 0 then 1 else 0 end                                 as cur_arr,
      case when j % 7 = 0 then 1 when j % 11 = 0 then 1 else 0 end         as hist_arr,
      case when j % 3 = 0 then 'cbse'::school_board
                           else 'state_board'::school_board
      end                                                                     as board,
      case when j % 3 = 0 then null else cfg.board_state end                as bstate
    from campus_cfg cfg
    cross join generate_series(1, 20) j
  )
insert into students (
  campus_id, degree_id, branch_id,
  roll_number, full_name, email, passing_year,
  tenth_percentage, twelfth_percentage, overall_cgpa,
  current_arrears, history_of_arrears,
  tenth_board, tenth_board_state,
  twelfth_board, twelfth_board_state,
  srf_status, participation_status,
  consent_given_at, srf_submitted_at, srf_decided_at, srf_decided_by,
  srf_rejection_reason
)
select
  e.campus_id, e.degree_id, e.branch_id,
  e.roll_no,   e.full_name, e.email,   2027,
  e.tenth_pct, e.twelfth_pct,
  case when e.srf_st = 'srf_approved' then e.target_cgpa end,
  e.cur_arr, e.hist_arr,
  e.board, e.bstate,
  e.board, e.bstate,
  e.srf_st::srf_status,
  'active'::participation_status,
  case when e.srf_st in ('srf_approved','srf_submitted','srf_rejected')
       then now() - interval '30 days' end,
  case when e.srf_st in ('srf_approved','srf_submitted','srf_rejected')
       then now() - interval '25 days' end,
  case when e.srf_st in ('srf_approved','srf_rejected')
       then now() - interval '20 days' end,
  case when e.srf_st in ('srf_approved','srf_rejected')
       then (select id from profiles where role = 'admin' limit 1) end,
  case when e.srf_st = 'srf_rejected'
       then 'Test: semester ' || (2 + e.j % 4)
            || ' marksheet is unclear -- please resubmit with a clearer scan.'
  end
from expanded e
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- 7a. Placeholder marksheet documents
-- ---------------------------------------------------------------------------
-- The live schema requires marksheet_id NOT NULL on every semester row.
-- One placeholder document per student satisfies the FK; all 6 semesters
-- share it. Path is clearly a test artefact (test-seed/ prefix, not real storage).

insert into student_documents (student_id, kind, storage_path, size_bytes)
select
  s.id,
  'semester_marksheet'::document_kind,
  'test-seed/' || s.id || '/marksheet-placeholder.pdf',
  1
from   students s
where  s.email like 'fpc.test.%@example.com'
  and  s.srf_status = 'srf_approved'
on conflict (storage_path) do nothing;

-- ---------------------------------------------------------------------------
-- 7b. Verified semesters
-- ---------------------------------------------------------------------------
-- 6 semesters per approved student, all verified.
-- CGPA arc: starts 0.40 below overall, ends at overall (semester 6 = overall).
-- The LATEST verified semester is what eligibility checks read (see HANDOVER).

insert into student_semesters (
  student_id, semester_number, cgpa,
  current_arrears, history_of_arrears,
  marksheet_id,
  status, verified_by, verified_at
)
select
  s.id,
  sem,
  greatest(5.00, least(10.00,
    s.overall_cgpa
    + (array[-0.40, -0.25, -0.10, 0.05, 0.15, 0.00])[sem]
  )),
  case when sem < 6 then 0 else s.current_arrears end,
  case when sem < 5 then 0 else s.history_of_arrears end,
  (select id from student_documents
   where  student_id = s.id and kind = 'semester_marksheet' limit 1),
  'verified'::verification_status,
  (select id from profiles where role = 'admin' limit 1),
  now() - interval '15 days'
from   students s
cross  join generate_series(1, 6) as sem
where  s.email like 'fpc.test.%@example.com'
  and  s.srf_status = 'srf_approved'
on conflict (student_id, semester_number) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Role preferences
-- ---------------------------------------------------------------------------
-- Primary: j % 5 -> spreads evenly across all 5 categories.
-- Secondary: added for every 3rd student (~27 students get two prefs).

with
  prefs as (
    select s.id, (right(s.roll_number, 3))::int as j
    from   students s
    where  s.email like 'fpc.test.%@example.com'
      and  s.srf_status = 'srf_approved'
  ),
  role_map(pos, cat) as (
    values
      (0,'software_technical'::role_category),
      (1,'technical_support_it_ops'::role_category),
      (2,'digital_marketing'::role_category),
      (3,'sales'::role_category),
      (4,'operations_business'::role_category)
  ),
  to_insert as (
    select p.id as student_id, r.cat as category
    from   prefs p join role_map r on r.pos = (p.j % 5)
    union
    select p.id, r.cat
    from   prefs p join role_map r on r.pos = ((p.j + 2) % 5)
    where  p.j % 3 = 0
  )
insert into student_role_preferences (student_id, category)
select student_id, category from to_insert
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 9. Skill repository scores
-- ---------------------------------------------------------------------------
-- Table: student_skill_scores (0037), scale 1-5 whole numbers (0052).
-- All 8 DEFAULT_SKILL_AREAS x 80 approved students = 640 score rows.
--
-- Score formula:
--   base      = round(1 + (overall_cgpa - 6.0) x 4 / 3.5)
--               -> CGPA 6.0->1, 7.75->3, 9.5->5  (linear, CGPA-correlated)
--   variation = ((student_seq + area_offset) % 3) - 1
--               -> -1, 0, or +1  (each area shifts students differently)
--   outliers  : j=5  scores -1 on tech areas -> underperformer vs CGPA
--               j=12 scores +1 on tech areas -> overperformer vs CGPA
--   score     = clamp(base + variation + outlier, 1, 5)
--
-- area_offset ensures no two areas produce identical patterns so shortlisting
-- rank is never a pure CGPA sort -- which is the point of a skill repository.

with
  area_cfg(area_name, aoff) as (
    values
      ('Aptitude',                           0),
      ('Communication skills',               1),
      ('Fundamentals of Programming',        2),
      ('Data Structures and Algorithms',     3),
      ('GitHub strength',                    4),
      ('Programming skills',                 5),
      ('AI skills',                          6),
      ('AI-assisted Full Stack Development', 7)
  )
insert into student_skill_scores (
  student_id, skill_area_id, score, recorded_by, recorded_at
)
select
  s.id,
  sa.id,
  greatest(1::numeric, least(5::numeric,
    round(
      1.0 + (s.overall_cgpa - 6.0) * 4.0 / 3.5
      + ((right(s.roll_number, 3))::int + ac.aoff) % 3 - 1
      + case
          when (right(s.roll_number, 3))::int = 5  and ac.aoff >= 2 then -1
          when (right(s.roll_number, 3))::int = 12 and ac.aoff >= 2 then  1
          else 0
        end
    )
  )),
  (select id from profiles where role = 'admin' limit 1),
  now() - interval '10 days'
from   students    s
join   area_cfg    ac on true
join   skill_areas sa on sa.name = ac.area_name
where  s.email like 'fpc.test.%@example.com'
  and  s.srf_status = 'srf_approved'
on conflict (student_id, skill_area_id) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expected: 5 rows, 20 students each, 16 approved, CGPA spread 6.0-9.2.

select
  c.name                                                              as campus,
  ci.name                                                             as city,
  d.name || ' / ' || coalesce(br.name, '--')                        as programme,
  count(*)                                                            as total,
  count(*) filter (where s.srf_status = 'srf_approved')              as approved,
  count(*) filter (where s.srf_status = 'srf_submitted')             as submitted,
  count(*) filter (where s.srf_status = 'srf_rejected')              as rejected,
  count(*) filter (where s.srf_status = 'invited')                   as invited,
  round(min(s.overall_cgpa) filter (where s.srf_status = 'srf_approved'), 2) as min_cgpa,
  round(max(s.overall_cgpa) filter (where s.srf_status = 'srf_approved'), 2) as max_cgpa
from   students   s
join   campuses   c  on c.id  = s.campus_id
join   cities     ci on ci.id = c.city_id
join   degrees    d  on d.id  = s.degree_id
left   join branches br on br.id = s.branch_id
where  s.email like 'fpc.test.%@example.com'
group  by c.name, ci.name, d.name, br.name
order  by c.name;
