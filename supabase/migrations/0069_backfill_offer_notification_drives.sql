-- The notifications that were written before 0068 existed.
--
-- 0068 gave `notifications` a `drive_id` and taught `offer_reaches_student` to
-- set it. Production, checked immediately after the push: **14 offer
-- notifications, every one of them with a null drive** — and 4 offers already
-- carrying a letter the CPC had attached. Without this, exactly the students
-- Karthik was looking at would go on seeing nothing under the message that
-- told them they had an offer.
--
-- Written as a FUNCTION rather than a bare UPDATE so that it can be tested at
-- all: a statement that runs once inside a migration runs before any test
-- data exists, and can only ever be proved by reading it.
-- `src/db/uat-0069-backfill-offer-notification-drives.test.ts` calls it
-- against data it sets up itself.

create or replace function link_offer_notifications_to_drives()
  returns integer language plpgsql security definer set search_path = public as $$
declare
  v_linked integer;
begin
  -- Matched on the title the trigger itself writes ('Offer from ' || company)
  -- together with the student, and ONLY where that pair identifies exactly
  -- one drive. A student can be offered by the same company twice; guessing
  -- between them would put the wrong letter under the right words, and a
  -- wrong offer letter is worse than none.
  with candidate as (
    select n.id as notification_id,
           min(o.drive_id::text)::uuid as drive_id,
           count(distinct o.drive_id) as drives
      from notifications n
      join offers o
        on o.student_id = n.student_id
       and o.drive_id is not null
       and n.title = 'Offer from ' || o.company_name
     where n.kind = 'offer'
       and n.drive_id is null
     group by n.id
  )
  update notifications n
     set drive_id = c.drive_id
    from candidate c
   where n.id = c.notification_id
     and c.drives = 1;

  get diagnostics v_linked = row_count;
  return v_linked;
end;
$$;

comment on function link_offer_notifications_to_drives() is
  'Backfills notifications.drive_id for offer notifications written before '
  '0068. Idempotent: it only ever touches rows whose drive_id is null, and '
  'only when the student + company pair names exactly one drive.';

select link_offer_notifications_to_drives();
