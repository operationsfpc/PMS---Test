-- =============================================================================
-- SQL SCRIPT: a submitted visit flips its status LAST (PIF save 403)
-- Run in Supabase Dashboard -> SQL Editor, or paste as one query.
--
-- Why: save_company_drive_with_roles wrote company_drives.status = submitted
-- BEFORE it inserted company_drive_contacts. That table has one FOR ALL policy
-- with only a USING clause, and Postgres uses USING as the INSERT check, so the
-- AE branch (cd.status = 'draft') refused the contact row. Draft saves
-- worked; every submit with at least one contact 403'd.
--
-- Same fix, same file: supabase/migrations/0135_a_submitted_visit_flips_its_status_last.sql
-- This script is the hand-run copy for a project you apply manually.
-- =============================================================================

-- STEP 1: confirm WHICH definition this project is running, before you change it.
--   has_flip_guard = false  -> 0116 (the bug: status written first)
--   has_flip_guard = true   -> 0135 already applied; re-running is harmless.
select
  current_database() as which_database,
  proname,
  position('v_final_status' in prosrc) > 0 as has_flip_guard,
  pg_get_functiondef(oid) is not null as readable
from pg_proc
where proname = 'save_company_drive_with_roles';

-- STEP 2: apply. The visit now stays a draft for the whole of the child writes
-- and leaves draft as the last statement of the same transaction.
create or replace function save_company_drive_with_roles(
  p_event      jsonb,
  p_contacts   jsonb,
  p_roles      jsonb,
  p_status     drive_status default 'draft'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor_id           uuid := auth.uid();
  v_event_id           uuid;
  v_company_id         uuid;
  v_company_name       text;
  v_industry           text;
  v_website            text;
  v_role_entry         jsonb;
  v_role_id            uuid;
  v_role_ids           uuid[] := '{}';
  v_rounds             jsonb;
  v_round              jsonb;
  v_contact            jsonb;
  v_contact_seq        integer;
  v_existing_event     company_drives%rowtype;
  v_final_status       drive_status;
begin
  -- 1. Authorization: AE only
  if current_app_role() <> 'account_executive' then
    raise exception 'Only Account Executives may create or edit drives.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 2. Extract Event / Company Details
  v_company_name := trim(p_event->>'companyName');
  if v_company_name is null or v_company_name = '' then
    raise exception 'Company name is required.' using errcode = 'check_violation';
  end if;

  v_industry := nullif(trim(p_event->>'industry'), '');
  v_website := nullif(trim(p_event->>'companyWebsite'), '');

  -- 3. Resolve or insert company record
  if (p_event->>'companyId') is not null and (p_event->>'companyId') <> '' then
    v_company_id := (p_event->>'companyId')::uuid;
  else
    -- Match by exact name or insert
    select id into v_company_id from companies where lower(name) = lower(v_company_name) limit 1;
    if v_company_id is null then
      insert into companies (name, industry, website)
      values (v_company_name, v_industry, v_website)
      returning id into v_company_id;
    end if;
  end if;

  -- 4. Event ID resolution — the visit's STATUS is not written here.
  if (p_event->>'id') is not null and (p_event->>'id') <> '' then
    v_event_id := (p_event->>'id')::uuid;
    select * into v_existing_event from company_drives where id = v_event_id;
    if not found then
      raise exception 'Company drive event not found.' using errcode = 'check_violation';
    end if;
    if v_existing_event.created_by <> v_actor_id and not is_operator() then
      raise exception 'You do not have permission to edit this company drive.'
        using errcode = 'insufficient_privilege';
    end if;
    if v_existing_event.status <> 'draft' then
      -- Replaces 0116's narrower guard, which only refused a DRAFT over a
      -- submitted visit and let a re-submit through to fail three writes later.
      raise exception 'This visit has already left the draft stage (%), so it can no longer be edited from the PIF. Raise a new visit instead.', v_existing_event.status
        using errcode = 'check_violation';
    end if;

    update company_drives
    set company_id       = v_company_id,
        company_name     = v_company_name,
        drive_mode       = nullif(p_event->>'driveMode', '')::drive_mode,
        venue            = nullif(trim(p_event->>'venue'), ''),
        tentative_date   = nullif(p_event->>'tentativeDate', '')::date,
        timeline_notes   = nullif(trim(p_event->>'timelineNotes'), ''),
        joining_timeline = nullif(trim(p_event->>'joiningTimeline'), ''),
        updated_at       = now()
    where id = v_event_id;
  else
    v_event_id := gen_random_uuid();
    -- 'draft', even for a submission: the contacts and roles below are only
    -- writable while the visit is a draft, and step 7 flips it in this same
    -- transaction.
    insert into company_drives (
      id, company_id, company_name, drive_mode, venue, tentative_date,
      timeline_notes, joining_timeline, status, created_by
    )
    values (
      v_event_id,
      v_company_id,
      v_company_name,
      nullif(p_event->>'driveMode', '')::drive_mode,
      nullif(trim(p_event->>'venue'), ''),
      nullif(p_event->>'tentativeDate', '')::date,
      nullif(trim(p_event->>'timelineNotes'), ''),
      nullif(trim(p_event->>'joiningTimeline'), ''),
      'draft',
      v_actor_id
    );
  end if;

  -- 5. Contacts at Event Level — allowed because the visit is still a draft.
  delete from company_drive_contacts where company_drive_id = v_event_id;
  v_contact_seq := 1;
  for v_contact in select * from jsonb_array_elements(coalesce(p_contacts, '[]'::jsonb))
  loop
    if nullif(trim(v_contact->>'name'), '') is not null
       or nullif(trim(v_contact->>'email'), '') is not null
       or nullif(trim(v_contact->>'phone'), '') is not null then
      insert into company_drive_contacts (company_drive_id, sequence, name, designation, email, phone)
      values (
        v_event_id,
        v_contact_seq,
        nullif(trim(v_contact->>'name'), ''),
        nullif(trim(v_contact->>'designation'), ''),
        nullif(trim(v_contact->>'email'), ''),
        nullif(trim(v_contact->>'phone'), '')
      );
      v_contact_seq := v_contact_seq + 1;
    end if;
  end loop;

  -- 6. Insert / Update Each Role
  for v_role_entry in select * from jsonb_array_elements(coalesce(p_roles, '[]'::jsonb))
  loop
    if (v_role_entry->>'id') is not null and (v_role_entry->>'id') <> '' then
      v_role_id := (v_role_entry->>'id')::uuid;
    else
      v_role_id := gen_random_uuid();
    end if;

    insert into drives (
      id,
      company_drive_id,
      company_name,
      industry,
      company_website,
      drive_mode,
      venue,
      tentative_date,
      role_title,
      role_category,
      drive_type,
      openings,
      work_locations,
      ctc_min_lpa,
      ctc_max_lpa,
      ctc_breakup,
      stipend_min_monthly,
      stipend_max_monthly,
      shift_type,
      shift_night_timing,
      bond_details,
      jd_storage_path,
      jd_file_name,
      jd_size_bytes,
      job_description,
      min_overall_marks,
      min_overall_cgpa_scale,
      min_overall_cgpa,
      min_tenth_percentage,
      min_twelfth_percentage,
      arrears_policy,
      eligible_passing_years,
      mandatory_skills,
      joining_timeline,
      joining_immediate_notes,
      joining_later_notes,
      timeline_notes,
      round_count,
      status,
      created_by
    )
    values (
      v_role_id,
      v_event_id,
      v_company_name,
      v_industry,
      v_website,
      nullif(p_event->>'driveMode', '')::drive_mode,
      nullif(trim(p_event->>'venue'), ''),
      nullif(p_event->>'tentativeDate', '')::date,
      nullif(trim(v_role_entry->>'roleTitle'), ''),
      nullif(v_role_entry->>'roleCategory', '')::role_category,
      nullif(v_role_entry->>'driveType', '')::drive_type,
      (v_role_entry->>'openings')::integer,
      nullif(trim(v_role_entry->>'workLocations'), ''),
      (v_role_entry->>'ctcMinLpa')::numeric,
      (v_role_entry->>'ctcMaxLpa')::numeric,
      nullif(trim(v_role_entry->>'ctcBreakup'), ''),
      (v_role_entry->>'stipendMinMonthly')::integer,
      (v_role_entry->>'stipendMaxMonthly')::integer,
      nullif(trim(v_role_entry->>'shiftType'), ''),
      nullif(trim(v_role_entry->>'shiftNightTiming'), ''),
      nullif(trim(v_role_entry->>'bondDetails'), ''),
      nullif(trim(v_role_entry->>'jdStoragePath'), ''),
      nullif(trim(v_role_entry->>'jdFileName'), ''),
      (v_role_entry->>'jdSizeBytes')::integer,
      nullif(trim(v_role_entry->>'jobDescription'), ''),
      (v_role_entry->>'minOverallMarks')::numeric,
      coalesce(v_role_entry->>'minOverallCgpaScale', 'cgpa')::marks_scale,
      (v_role_entry->>'minOverallCgpa')::numeric,
      (v_role_entry->>'minTenthPercentage')::numeric,
      (v_role_entry->>'minTwelfthPercentage')::numeric,
      coalesce(v_role_entry->>'arrearsPolicy', 'flexible')::arrear_policy,
      coalesce(
        (select array_agg(elem::integer) from jsonb_array_elements_text(v_role_entry->'eligiblePassingYears') elem),
        '{}'::integer[]
      ),
      nullif(trim(v_role_entry->>'mandatorySkills'), ''),
      nullif(trim(p_event->>'joiningTimeline'), '')::joining_timeline,
      nullif(trim(v_role_entry->>'joiningImmediateNotes'), ''),
      nullif(trim(v_role_entry->>'joiningLaterNotes'), ''),
      nullif(trim(p_event->>'timelineNotes'), ''),
      coalesce(jsonb_array_length(v_role_entry->'rounds'), 0),
      p_status,
      v_actor_id
    )
    on conflict (id) do update set
      company_drive_id        = v_event_id,
      company_name            = v_company_name,
      industry                = v_industry,
      company_website         = v_website,
      drive_mode              = nullif(p_event->>'driveMode', '')::drive_mode,
      venue                   = nullif(trim(p_event->>'venue'), ''),
      tentative_date          = nullif(p_event->>'tentativeDate', '')::date,
      role_title              = nullif(trim(v_role_entry->>'roleTitle'), ''),
      role_category           = nullif(v_role_entry->>'roleCategory', '')::role_category,
      drive_type              = nullif(v_role_entry->>'driveType', '')::drive_type,
      openings                = (v_role_entry->>'openings')::integer,
      work_locations          = nullif(trim(v_role_entry->>'workLocations'), ''),
      ctc_min_lpa             = (v_role_entry->>'ctcMinLpa')::numeric,
      ctc_max_lpa             = (v_role_entry->>'ctcMaxLpa')::numeric,
      ctc_breakup             = nullif(trim(v_role_entry->>'ctcBreakup'), ''),
      stipend_min_monthly     = (v_role_entry->>'stipendMinMonthly')::integer,
      stipend_max_monthly     = (v_role_entry->>'stipendMaxMonthly')::integer,
      shift_type              = nullif(trim(v_role_entry->>'shiftType'), ''),
      shift_night_timing      = nullif(trim(v_role_entry->>'shiftNightTiming'), ''),
      bond_details            = nullif(trim(v_role_entry->>'bondDetails'), ''),
      jd_storage_path         = coalesce(nullif(trim(v_role_entry->>'jdStoragePath'), ''), drives.jd_storage_path),
      jd_file_name            = coalesce(nullif(trim(v_role_entry->>'jdFileName'), ''), drives.jd_file_name),
      jd_size_bytes           = coalesce((v_role_entry->>'jdSizeBytes')::integer, drives.jd_size_bytes),
      job_description         = nullif(trim(v_role_entry->>'jobDescription'), ''),
      min_overall_marks       = (v_role_entry->>'minOverallMarks')::numeric,
      min_overall_cgpa_scale  = coalesce(v_role_entry->>'minOverallCgpaScale', 'cgpa')::marks_scale,
      min_overall_cgpa        = (v_role_entry->>'minOverallCgpa')::numeric,
      min_tenth_percentage    = (v_role_entry->>'minTenthPercentage')::numeric,
      min_twelfth_percentage  = (v_role_entry->>'minTwelfthPercentage')::numeric,
      arrears_policy          = coalesce(v_role_entry->>'arrearsPolicy', 'flexible')::arrear_policy,
      eligible_passing_years  = coalesce(
        (select array_agg(elem::integer) from jsonb_array_elements_text(v_role_entry->'eligiblePassingYears') elem),
        '{}'::integer[]
      ),
      mandatory_skills        = nullif(trim(v_role_entry->>'mandatorySkills'), ''),
      joining_timeline        = nullif(trim(p_event->>'joiningTimeline'), '')::joining_timeline,
      joining_immediate_notes = nullif(trim(v_role_entry->>'joiningImmediateNotes'), ''),
      joining_later_notes     = nullif(trim(v_role_entry->>'joiningLaterNotes'), ''),
      timeline_notes          = nullif(trim(p_event->>'timelineNotes'), ''),
      round_count             = coalesce(jsonb_array_length(v_role_entry->'rounds'), 0),
      status                  = p_status;

    -- Replace rounds for this role
    delete from drive_rounds where drive_id = v_role_id;
    v_rounds := coalesce(v_role_entry->'rounds', '[]'::jsonb);
    for v_round in select * from jsonb_array_elements(v_rounds)
    loop
      insert into drive_rounds (drive_id, sequence, name)
      values (v_role_id, (v_round->>'sequence')::integer, trim(v_round->>'name'));
    end loop;

    -- Mirror event contacts to role drive_contacts for backward compatibility
    delete from drive_contacts where drive_id = v_role_id;
    insert into drive_contacts (drive_id, sequence, name, designation, email, phone)
    select v_role_id, sequence, name, designation, email, phone
    from company_drive_contacts
    where company_drive_id = v_event_id;

    v_role_ids := array_append(v_role_ids, v_role_id);
  end loop;

  -- 7. LAST: the visit leaves draft. Kept after every child write because the
  -- AE's write policies on those children are all conditioned on 'draft'.
  update company_drives
     set status     = p_status,
         updated_at = now()
   where id = v_event_id
  returning status into v_final_status;

  if v_final_status is null then
    -- The visit is there — its contacts and roles were just written — so an
    -- UPDATE that matched nothing can only be a policy that stopped this role
    -- moving it out of draft. Refusing is the honest answer: returning a PIF
    -- that silently stayed a draft would tell the AE it was submitted.
    raise exception 'The visit could not be moved out of its draft stage — the database would not let this role change it.'
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'eventId', v_event_id,
    'roleIds', v_role_ids,
    'status', p_status
  );
end;
$$;

-- STEP 3: confirm it landed. Expect has_flip_guard = true.
select
  proname,
  position('v_final_status' in prosrc) > 0 as has_flip_guard,
  position('status           = p_status,' in prosrc) > 0 as still_writes_status_first
from pg_proc
where proname = 'save_company_drive_with_roles';

-- =============================================================================
-- UNDO — restores the 0116 definition exactly (status written in step 4, no
-- flip guard). Paste ONLY this block to roll the project back.
-- =============================================================================

/*
create or replace function save_company_drive_with_roles(
  p_event      jsonb,
  p_contacts   jsonb,
  p_roles      jsonb,
  p_status     drive_status default 'draft'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor_id           uuid := auth.uid();
  v_event_id           uuid;
  v_company_id         uuid;
  v_company_name       text;
  v_industry           text;
  v_website            text;
  v_role_entry         jsonb;
  v_role_id            uuid;
  v_role_ids           uuid[] := '{}';
  v_rounds             jsonb;
  v_round              jsonb;
  v_contact            jsonb;
  v_contact_seq        integer;
  v_existing_event     company_drives%rowtype;
begin
  -- 1. Authorization: AE only
  if current_app_role() <> 'account_executive' then
    raise exception 'Only Account Executives may create or edit drives.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 2. Extract Event / Company Details
  v_company_name := trim(p_event->>'companyName');
  if v_company_name is null or v_company_name = '' then
    raise exception 'Company name is required.' using errcode = 'check_violation';
  end if;

  v_industry := nullif(trim(p_event->>'industry'), '');
  v_website := nullif(trim(p_event->>'companyWebsite'), '');

  -- 3. Resolve or insert company record
  if (p_event->>'companyId') is not null and (p_event->>'companyId') <> '' then
    v_company_id := (p_event->>'companyId')::uuid;
  else
    -- Match by exact name or insert
    select id into v_company_id from companies where lower(name) = lower(v_company_name) limit 1;
    if v_company_id is null then
      insert into companies (name, industry, website)
      values (v_company_name, v_industry, v_website)
      returning id into v_company_id;
    end if;
  end if;

  -- 4. Event ID resolution
  if (p_event->>'id') is not null and (p_event->>'id') <> '' then
    v_event_id := (p_event->>'id')::uuid;
    select * into v_existing_event from company_drives where id = v_event_id;
    if not found then
      raise exception 'Company drive event not found.' using errcode = 'check_violation';
    end if;
    if v_existing_event.created_by <> v_actor_id and not is_operator() then
      raise exception 'You do not have permission to edit this company drive.'
        using errcode = 'insufficient_privilege';
    end if;
    if v_existing_event.status <> 'draft' and p_status = 'draft' then
      raise exception 'A submitted company drive cannot be saved as a draft.'
        using errcode = 'check_violation';
    end if;

    update company_drives
    set company_id       = v_company_id,
        company_name     = v_company_name,
        drive_mode       = nullif(p_event->>'driveMode', '')::drive_mode,
        venue            = nullif(trim(p_event->>'venue'), ''),
        tentative_date   = nullif(p_event->>'tentativeDate', '')::date,
        timeline_notes   = nullif(trim(p_event->>'timelineNotes'), ''),
        joining_timeline = nullif(trim(p_event->>'joiningTimeline'), ''),
        status           = p_status,
        updated_at       = now()
    where id = v_event_id;
  else
    v_event_id := gen_random_uuid();
    insert into company_drives (
      id, company_id, company_name, drive_mode, venue, tentative_date,
      timeline_notes, joining_timeline, status, created_by
    )
    values (
      v_event_id,
      v_company_id,
      v_company_name,
      nullif(p_event->>'driveMode', '')::drive_mode,
      nullif(trim(p_event->>'venue'), ''),
      nullif(p_event->>'tentativeDate', '')::date,
      nullif(trim(p_event->>'timelineNotes'), ''),
      nullif(trim(p_event->>'joiningTimeline'), ''),
      p_status,
      v_actor_id
    );
  end if;

  -- 5. Contacts at Event Level
  delete from company_drive_contacts where company_drive_id = v_event_id;
  v_contact_seq := 1;
  for v_contact in select * from jsonb_array_elements(coalesce(p_contacts, '[]'::jsonb))
  loop
    if nullif(trim(v_contact->>'name'), '') is not null
       or nullif(trim(v_contact->>'email'), '') is not null
       or nullif(trim(v_contact->>'phone'), '') is not null then
      insert into company_drive_contacts (company_drive_id, sequence, name, designation, email, phone)
      values (
        v_event_id,
        v_contact_seq,
        nullif(trim(v_contact->>'name'), ''),
        nullif(trim(v_contact->>'designation'), ''),
        nullif(trim(v_contact->>'email'), ''),
        nullif(trim(v_contact->>'phone'), '')
      );
      v_contact_seq := v_contact_seq + 1;
    end if;
  end loop;

  -- 6. Insert / Update Each Role
  for v_role_entry in select * from jsonb_array_elements(coalesce(p_roles, '[]'::jsonb))
  loop
    if (v_role_entry->>'id') is not null and (v_role_entry->>'id') <> '' then
      v_role_id := (v_role_entry->>'id')::uuid;
    else
      v_role_id := gen_random_uuid();
    end if;

    insert into drives (
      id,
      company_drive_id,
      company_name,
      industry,
      company_website,
      drive_mode,
      venue,
      tentative_date,
      role_title,
      role_category,
      drive_type,
      openings,
      work_locations,
      ctc_min_lpa,
      ctc_max_lpa,
      ctc_breakup,
      stipend_min_monthly,
      stipend_max_monthly,
      shift_type,
      shift_night_timing,
      bond_details,
      jd_storage_path,
      jd_file_name,
      jd_size_bytes,
      job_description,
      min_overall_marks,
      min_overall_cgpa_scale,
      min_overall_cgpa,
      min_tenth_percentage,
      min_twelfth_percentage,
      arrears_policy,
      eligible_passing_years,
      mandatory_skills,
      joining_timeline,
      joining_immediate_notes,
      joining_later_notes,
      timeline_notes,
      round_count,
      status,
      created_by
    )
    values (
      v_role_id,
      v_event_id,
      v_company_name,
      v_industry,
      v_website,
      nullif(p_event->>'driveMode', '')::drive_mode,
      nullif(trim(p_event->>'venue'), ''),
      nullif(p_event->>'tentativeDate', '')::date,
      nullif(trim(v_role_entry->>'roleTitle'), ''),
      nullif(v_role_entry->>'roleCategory', '')::role_category,
      nullif(v_role_entry->>'driveType', '')::drive_type,
      (v_role_entry->>'openings')::integer,
      nullif(trim(v_role_entry->>'workLocations'), ''),
      (v_role_entry->>'ctcMinLpa')::numeric,
      (v_role_entry->>'ctcMaxLpa')::numeric,
      nullif(trim(v_role_entry->>'ctcBreakup'), ''),
      (v_role_entry->>'stipendMinMonthly')::integer,
      (v_role_entry->>'stipendMaxMonthly')::integer,
      nullif(trim(v_role_entry->>'shiftType'), ''),
      nullif(trim(v_role_entry->>'shiftNightTiming'), ''),
      nullif(trim(v_role_entry->>'bondDetails'), ''),
      nullif(trim(v_role_entry->>'jdStoragePath'), ''),
      nullif(trim(v_role_entry->>'jdFileName'), ''),
      (v_role_entry->>'jdSizeBytes')::integer,
      nullif(trim(v_role_entry->>'jobDescription'), ''),
      (v_role_entry->>'minOverallMarks')::numeric,
      coalesce(v_role_entry->>'minOverallCgpaScale', 'cgpa')::marks_scale,
      (v_role_entry->>'minOverallCgpa')::numeric,
      (v_role_entry->>'minTenthPercentage')::numeric,
      (v_role_entry->>'minTwelfthPercentage')::numeric,
      coalesce(v_role_entry->>'arrearsPolicy', 'flexible')::arrear_policy,
      coalesce(
        (select array_agg(elem::integer) from jsonb_array_elements_text(v_role_entry->'eligiblePassingYears') elem),
        '{}'::integer[]
      ),
      nullif(trim(v_role_entry->>'mandatorySkills'), ''),
      nullif(trim(p_event->>'joiningTimeline'), '')::joining_timeline,
      nullif(trim(v_role_entry->>'joiningImmediateNotes'), ''),
      nullif(trim(v_role_entry->>'joiningLaterNotes'), ''),
      nullif(trim(p_event->>'timelineNotes'), ''),
      coalesce(jsonb_array_length(v_role_entry->'rounds'), 0),
      p_status,
      v_actor_id
    )
    on conflict (id) do update set
      company_drive_id        = v_event_id,
      company_name            = v_company_name,
      industry                = v_industry,
      company_website         = v_website,
      drive_mode              = nullif(p_event->>'driveMode', '')::drive_mode,
      venue                   = nullif(trim(p_event->>'venue'), ''),
      tentative_date          = nullif(p_event->>'tentativeDate', '')::date,
      role_title              = nullif(trim(v_role_entry->>'roleTitle'), ''),
      role_category           = nullif(v_role_entry->>'roleCategory', '')::role_category,
      drive_type              = nullif(v_role_entry->>'driveType', '')::drive_type,
      openings                = (v_role_entry->>'openings')::integer,
      work_locations          = nullif(trim(v_role_entry->>'workLocations'), ''),
      ctc_min_lpa             = (v_role_entry->>'ctcMinLpa')::numeric,
      ctc_max_lpa             = (v_role_entry->>'ctcMaxLpa')::numeric,
      ctc_breakup             = nullif(trim(v_role_entry->>'ctcBreakup'), ''),
      stipend_min_monthly     = (v_role_entry->>'stipendMinMonthly')::integer,
      stipend_max_monthly     = (v_role_entry->>'stipendMaxMonthly')::integer,
      shift_type              = nullif(trim(v_role_entry->>'shiftType'), ''),
      shift_night_timing      = nullif(trim(v_role_entry->>'shiftNightTiming'), ''),
      bond_details            = nullif(trim(v_role_entry->>'bondDetails'), ''),
      jd_storage_path         = coalesce(nullif(trim(v_role_entry->>'jdStoragePath'), ''), drives.jd_storage_path),
      jd_file_name            = coalesce(nullif(trim(v_role_entry->>'jdFileName'), ''), drives.jd_file_name),
      jd_size_bytes           = coalesce((v_role_entry->>'jdSizeBytes')::integer, drives.jd_size_bytes),
      job_description         = nullif(trim(v_role_entry->>'jobDescription'), ''),
      min_overall_marks       = (v_role_entry->>'minOverallMarks')::numeric,
      min_overall_cgpa_scale  = coalesce(v_role_entry->>'minOverallCgpaScale', 'cgpa')::marks_scale,
      min_overall_cgpa        = (v_role_entry->>'minOverallCgpa')::numeric,
      min_tenth_percentage    = (v_role_entry->>'minTenthPercentage')::numeric,
      min_twelfth_percentage  = (v_role_entry->>'minTwelfthPercentage')::numeric,
      arrears_policy          = coalesce(v_role_entry->>'arrearsPolicy', 'flexible')::arrear_policy,
      eligible_passing_years  = coalesce(
        (select array_agg(elem::integer) from jsonb_array_elements_text(v_role_entry->'eligiblePassingYears') elem),
        '{}'::integer[]
      ),
      mandatory_skills        = nullif(trim(v_role_entry->>'mandatorySkills'), ''),
      joining_timeline        = nullif(trim(p_event->>'joiningTimeline'), '')::joining_timeline,
      joining_immediate_notes = nullif(trim(v_role_entry->>'joiningImmediateNotes'), ''),
      joining_later_notes     = nullif(trim(v_role_entry->>'joiningLaterNotes'), ''),
      timeline_notes          = nullif(trim(p_event->>'timelineNotes'), ''),
      round_count             = coalesce(jsonb_array_length(v_role_entry->'rounds'), 0),
      status                  = p_status;

    -- Replace rounds for this role
    delete from drive_rounds where drive_id = v_role_id;
    v_rounds := coalesce(v_role_entry->'rounds', '[]'::jsonb);
    for v_round in select * from jsonb_array_elements(v_rounds)
    loop
      insert into drive_rounds (drive_id, sequence, name)
      values (v_role_id, (v_round->>'sequence')::integer, trim(v_round->>'name'));
    end loop;

    -- Mirror event contacts to role drive_contacts for backward compatibility
    delete from drive_contacts where drive_id = v_role_id;
    insert into drive_contacts (drive_id, sequence, name, designation, email, phone)
    select v_role_id, sequence, name, designation, email, phone
    from company_drive_contacts
    where company_drive_id = v_event_id;

    v_role_ids := array_append(v_role_ids, v_role_id);
  end loop;

  return jsonb_build_object(
    'eventId', v_event_id,
    'roleIds', v_role_ids,
    'status', p_status
  );
end;
$$;
*/
