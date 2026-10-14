-- 0116 — Multi-Role Company Drives
--
-- Architecture: Parent-Child Company Drive Model (Option A)
-- Introduces companies and company_drives (recruitment event) while preserving
-- drives as the authoritative execution record for individual roles, applications,
-- interview rounds, and offers.

-- ----------------------------------------------------------------- companies
create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  industry    text,
  website     text,
  created_at  timestamptz not null default now()
);

create index if not exists companies_name_lower_idx on companies (lower(name));

-- ------------------------------------------------------------ company_drives
-- Represents a single recruitment event or campus visit by a company.
create table if not exists company_drives (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid references companies(id) on delete set null,
  company_name       text not null,
  drive_mode         drive_mode,
  venue              text,
  tentative_date     date,
  timeline_notes     text,
  joining_timeline   text,
  status             drive_status not null default 'draft',
  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists company_drives_company_id_idx on company_drives (company_id);
create index if not exists company_drives_status_idx on company_drives (status);
create index if not exists company_drives_created_by_idx on company_drives (created_by);

-- ---------------------------------------------------- company_drive_contacts
create table if not exists company_drive_contacts (
  id                uuid primary key default gen_random_uuid(),
  company_drive_id  uuid not null references company_drives(id) on delete cascade,
  sequence          integer not null check (sequence > 0),
  name              text,
  designation       text,
  email             text,
  phone             text,
  unique (company_drive_id, sequence)
);

create index if not exists company_drive_contacts_drive_idx on company_drive_contacts (company_drive_id);

-- --------------------------------------------- company_drive_target_campuses
-- Shared default campus targeting configured by Central CPC at event level.
create table if not exists company_drive_target_campuses (
  company_drive_id  uuid not null references company_drives(id) on delete cascade,
  campus_id         uuid not null references campuses(id) on delete cascade,
  primary key (company_drive_id, campus_id)
);

create index if not exists company_drive_target_campuses_campus_idx on company_drive_target_campuses (campus_id);

-- ------------------------------------------------------- link drives to event
alter table drives
  add column if not exists company_drive_id uuid references company_drives(id) on delete restrict,
  add column if not exists has_custom_targeting boolean not null default false;

create index if not exists drives_company_drive_id_idx on drives (company_drive_id);

-- ------------------------------------------------- row level security & grants
alter table companies enable row level security;
alter table company_drives enable row level security;
alter table company_drive_contacts enable row level security;
alter table company_drive_target_campuses enable row level security;

grant select, insert, update on companies to authenticated;
grant select, insert, update, delete on company_drives to authenticated;
grant select, insert, update, delete on company_drive_contacts to authenticated;
grant select, insert, update, delete on company_drive_target_campuses to authenticated;

-- companies policies
create policy companies_read on companies for select
  using ((select current_app_role()) is not null);

create policy companies_insert on companies for insert
  with check ((select current_app_role()) in ('account_executive', 'central_placement_coordinator', 'admin'));

create policy companies_update on companies for update
  using ((select current_app_role()) in ('account_executive', 'central_placement_coordinator', 'admin'));

-- company_drives policies
create policy company_drives_read on company_drives for select
  using ((select current_app_role()) is not null);

create policy company_drives_ae_insert on company_drives for insert
  with check (
    (select current_app_role()) = 'account_executive'
    and created_by = (select auth.uid())
    and status in ('draft', 'submitted')
  );

create policy company_drives_ae_update on company_drives for update
  using (
    (select current_app_role()) = 'account_executive'
    and created_by = (select auth.uid())
    and status = 'draft'
  )
  with check (
    (select current_app_role()) = 'account_executive'
    and created_by = (select auth.uid())
  );

create policy company_drives_dh_update on company_drives for update
  using ((select current_app_role()) = 'delivery_head')
  with check ((select current_app_role()) = 'delivery_head');

create policy company_drives_operator_update on company_drives for update
  using (is_operator())
  with check (is_operator());

-- company_drive_contacts policies
create policy company_drive_contacts_read on company_drive_contacts for select
  using ((select current_app_role()) is not null);

create policy company_drive_contacts_write on company_drive_contacts for all
  using (
    is_operator()
    or (select current_app_role()) = 'delivery_head'
    or exists (
      select 1 from company_drives cd
      where cd.id = company_drive_id
        and cd.created_by = (select auth.uid())
        and cd.status = 'draft'
    )
  );

-- company_drive_target_campuses policies
create policy company_drive_target_campuses_read on company_drive_target_campuses for select
  using ((select current_app_role()) is not null);

create policy company_drive_target_campuses_write on company_drive_target_campuses for all
  using (is_operator());

-- ------------------------------------------------ save_company_drive_with_roles
-- Atomic transaction boundary for creating or updating a company drive with all
-- its roles, contacts, and round sequences.
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
      nullif(trim(p_event->>'joiningTimeline'), ''),
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
      joining_timeline        = nullif(trim(p_event->>'joiningTimeline'), ''),
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
