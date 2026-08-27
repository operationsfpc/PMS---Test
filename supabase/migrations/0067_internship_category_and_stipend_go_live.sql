-- 0067 — the three consequences of 0066's new enum value.
--
-- Karthik, 2026-08-27, answering the pushback:
--   PB2 "Change all these to just Internship. all data is test so far."
--       → the internship category is MANDATORY, not merely allowed. One fact,
--         one spelling, for ever. Verified before writing: 13 offers exist and
--         none is an internship, so nothing has to be migrated.
--   Q8  "yes, relax it" → a drive must record a CTC **or** a stipend.
--   PB4 → the offer notification names an internship offer as one.

-- ============================================================ 1. drives
--
-- REPLACES `internship_has_no_category` from 0004, whose rule was:
--
--     check (drive_type is distinct from 'internship' or offer_category is null)
--     -- "Plain internships are not on the category ladder (PRD 11)."
--
-- That statement is still TRUE and is what `offerCategoryRank` enforces by
-- throwing. What changed is how the absence is written down: a null that had
-- to be interpreted becomes a value that says what it means.

alter table drives drop constraint if exists internship_has_no_category;

alter table drives
  add constraint internship_carries_internship_category check (
    case drive_type
      when 'internship' then offer_category is null or offer_category = 'internship'
      else offer_category is distinct from 'internship'
    end
  );

comment on constraint internship_carries_internship_category on drives is
  'The type and the category are a pair. An internship drive is classified '
  '''internship'' and nothing else; no other drive type may borrow that value. '
  'NULL is still admitted here because a drive is raised before it is '
  'classified — the Delivery Head sets the category at approval, and '
  'live_requires_complete_record is what refuses to publish an unclassified one. '
  'Mirrored by offerCategoryAllowedFor in src/domain/offer-category.ts.';

-- ============================================================ 2. offers
--
-- The same pairing, but MANDATORY: an offer is only ever written once the
-- drive is classified, so there is no "not yet" state to allow for. Without
-- the NOT NULL half, an internship offer could be written either way and
-- every future query would have to know both spellings.

-- Named differently from the drives one (0006 called it
-- `internship_offer_has_no_category`), which is exactly why both names are
-- dropped explicitly rather than by guesswork.
alter table offers drop constraint if exists internship_offer_has_no_category;
alter table offers drop constraint if exists internship_has_no_category;

alter table offers
  add constraint internship_carries_internship_category check (
    case drive_type
      when 'internship' then offer_category = 'internship'
      else offer_category is distinct from 'internship'
    end
  );

comment on constraint internship_carries_internship_category on offers is
  'An internship offer carries the internship category — required, not '
  'optional, so that "is this an internship?" has exactly one answer in the '
  'data. It remains off the R3/R5 ladder: every ladder query filters on '
  'drive_type in (''placement'',''internship_convertible'') before it looks at '
  'a category, so this value is never ranked.';

-- ============================================== 3. the go-live gate (P10)
--
-- Rebuilt from 0060 with ONE changed line. A plain internship pays a monthly
-- stipend and has no CTC, so demanding ctc_min_lpa meant both internship
-- drives in production could be approved and then never published.
--
-- Only an internship may lean on the stipend. A full-time role advertised
-- with a monthly figure and no salary is a mistake worth catching.
--
-- Mirrors missingBeforeGoLive in src/domain/drive-lifecycle.ts; change both
-- or neither.

alter table drives
  drop constraint live_requires_complete_record,
  add constraint live_requires_complete_record check (
    status in ('draft', 'submitted', 'approved', 'rejected')
    or (
      not on_hold
      and role_title is not null
      and (job_description is not null or jd_storage_path is not null)
      and work_locations is not null
      and (
        ctc_min_lpa is not null
        or (
          drive_type = 'internship'
          and (coalesce(stipend_min_monthly, 0) > 0 or coalesce(stipend_max_monthly, 0) > 0)
        )
      )
      and role_category is not null and drive_type is not null
      and offer_category is not null
      and application_start is not null and application_end is not null
    )
  );

comment on constraint live_requires_complete_record on drives is
  'PRD 6.2 — everything a drive needs before it may go live, plus the '
  'invariant that an on-hold drive can never be published. 2026-08-27: a drive '
  'must record what it PAYS — a CTC, or a monthly stipend when it is an '
  'internship. Every live drive now carries a category, because an internship '
  'has one of its own.';

-- ================================================ 4. the offer notification
--
-- Rebuilt from 0043. Internship offers used to skip the category clause
-- entirely (they had no category); with one, the generic wording would read
-- "has made you an offer (internship)". Named properly instead.

create or replace function offer_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_opted boolean;
begin
  if new.source <> 'on_campus' then
    return new;  -- a self-placed offer is the student's own news
  end if;

  -- 0043's guard, restated in full: an opted-out student is not notified.
  -- CREATE OR REPLACE cannot patch a body, so every line of the original has
  -- to be carried across, and dropping this one would have written to people
  -- who asked not to be written to.
  select participation_status = 'opted_out' into v_opted
    from students where id = new.student_id;
  if v_opted then
    return new;
  end if;

  insert into notifications (student_id, kind, title, body)
  values (
    new.student_id,
    'offer',
    'Offer from ' || new.company_name,
    case
      when new.offer_category = 'internship'
        then 'Congratulations — ' || new.company_name || ' has made you an internship offer.'
      when new.offer_category is not null
        then 'Congratulations — ' || new.company_name || ' has made you an offer ('
             || replace(new.offer_category::text, '_', ' ') || ').'
      else 'Congratulations — ' || new.company_name || ' has made you an offer.'
    end
  );

  return new;
end;
$$;
