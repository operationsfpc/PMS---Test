-- UAT 2026-08-27 — what a notification says, and what it points at.
--
-- `docs/inbox/WhatsApp Image 2026-08-27 at 17.54.15.jpeg` and
-- `docs/inbox/WhatsApp Image 2026-08-27 at 18.18.49 (1).jpeg`.
--
-- 1. THE DATABASE WAS SPELLING A DOMAIN VALUE. The offer notification read
--    "has made you an offer (super dream)" because 0043 — and 0067 after it —
--    built the words with `replace(offer_category::text, '_', ' ')`. Commits
--    12befe2 and 3531b0c gave every screen one spelling through
--    `offerCategoryLabel`; the triggers kept a second one. A student read
--    "super dream" in their notifications and "Super Dream" everywhere else.
--    The label now lives in one SQL function, mirroring `CATEGORY_LABEL` in
--    `src/domain/offer-category.ts`. Change both or neither.
--
-- 2. A NOTIFICATION COULD NOT BE LINKED BACK TO ITS DRIVE. "XYZ has made you
--    an internship offer." and nowhere to open the offer letter the CPC had
--    attached — because the row held no reference to anything. `drive_id` is
--    that reference: nullable (most notifications have no drive), and
--    `on delete set null` because a notification is a RECORD of what a
--    student was told and must outlive the drive it mentions.

-- ============================================ 1. one spelling, in Postgres too

comment on table notifications is
  'What the process has told a student. Append-in-practice: rows are never '
  'rewritten to change what was said. `drive_id` is a pointer for the UI, not '
  'part of the message.';

-- Mirrors CATEGORY_LABEL in src/domain/offer-category.ts. Immutable and
-- strict: an unrecognised value comes back as itself rather than as nothing,
-- because a category nobody knows is a data problem and an empty bracket is
-- how a data problem goes unnoticed.
create or replace function offer_category_label(category text)
  returns text language sql immutable set search_path = public as $$
  select case category
           when 'regular'     then 'Regular'
           when 'dream'       then 'Dream'
           when 'super_dream' then 'Super Dream'
           when 'internship'  then 'Internship'
           else category
         end;
$$;

-- ============================================ 2. the drive a notification names

alter table notifications
  add column if not exists drive_id uuid references drives(id) on delete set null;

comment on column notifications.drive_id is
  'The drive this notification is about, when there is one. Nullable, and '
  'cleared rather than cascaded: the notification is the record, the drive is '
  'only what it referred to.';

-- The student''s notification list is read whole and small; the index that
-- earns its keep is the unread one from 0006. No index added here on purpose.

-- ============================================ 3. the offer notification, rebuilt
--
-- Rebuilt from 0067 in full. CREATE OR REPLACE cannot patch a body, so every
-- line of the original is carried across deliberately:
--   * the self-placed early return (a self-placed offer is the student's own
--     news, not ours to announce),
--   * the opted-out guard from 0043 — dropping it would write to people who
--     asked not to be written to,
--   * PB4's internship wording, which names the offer instead of bracketing
--     a category that only restates the drive type.
-- What is new: `offer_category_label` instead of `replace()`, and `drive_id`.

create or replace function offer_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_opted boolean;
begin
  if new.source <> 'on_campus' then
    return new;  -- a self-placed offer is the student's own news
  end if;

  select participation_status = 'opted_out' into v_opted
    from students where id = new.student_id;
  if v_opted then
    return new;
  end if;

  insert into notifications (student_id, kind, title, body, drive_id)
  values (
    new.student_id,
    'offer',
    'Offer from ' || new.company_name,
    case
      when new.offer_category = 'internship'
        then 'Congratulations — ' || new.company_name || ' has made you an internship offer.'
      when new.offer_category is not null
        then 'Congratulations — ' || new.company_name || ' has made you an offer ('
             || offer_category_label(new.offer_category::text) || ').'
      else 'Congratulations — ' || new.company_name || ' has made you an offer.'
    end,
    new.drive_id
  );

  return new;
end;
$$;
