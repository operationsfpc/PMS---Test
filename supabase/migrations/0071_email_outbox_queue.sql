-- Migration 0071: Outbox trigger enqueuing notifications into email_deliveries
-- PRD §21.2: Every student notification creates a queued delivery record.
-- The dispatcher reads queued deliveries and sends them via Resend.

create or replace function enqueue_notification_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_opted boolean;
begin
  select email, (participation_status = 'opted_out')
    into v_email, v_opted
    from students
   where id = new.student_id;

  -- Opted-out students or missing emails do not receive email
  if v_opted or v_email is null or trim(v_email) = '' then
    return new;
  end if;

  insert into email_deliveries (notification_id, recipient_email, status)
  values (new.id, lower(trim(v_email)), 'queued');

  return new;
end;
$$;

drop trigger if exists notification_enqueues_email on notifications;
create trigger notification_enqueues_email
  after insert on notifications
  for each row execute function enqueue_notification_email();

create index if not exists email_deliveries_queued_idx
  on email_deliveries (status, updated_at) where status = 'queued';

comment on trigger notification_enqueues_email on notifications is
  'Automatically stages an email_deliveries row for each student notification.';
