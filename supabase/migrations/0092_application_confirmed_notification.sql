-- Migration 0092: Notify student when they apply for a drive
--
-- Students never received an application_confirmed notification. This trigger
-- fires AFTER INSERT on applications and inserts a notification with the drive
-- details so the student knows their application was received.

create or replace function notify_student_of_application()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_company text;
  v_role text;
  v_mode text;
begin
  select d.company_name, d.role_title, d.drive_mode
    into v_company, v_role, v_mode
    from drives d
   where d.id = new.drive_id;

  insert into notifications (student_id, kind, title, body)
  values (
    new.student_id,
    'application_confirmed',
    'Application Received: ' || coalesce(v_company, 'Unknown Company'),
    'Your application for **' || coalesce(v_company, 'Unknown Company') || '** has been received.' || E'\n\n' ||
    '• **Role:** ' || coalesce(v_role, 'Not specified') || E'\n' ||
    '• **Mode:** ' || coalesce(v_mode, 'Not specified') || E'\n\n' ||
    'You will be notified when the shortlist is published. Check the drive status under "My drives".'
  );

  return new;
end;
$$;

drop trigger if exists notify_student_of_application on applications;
create trigger notify_student_of_application
  after insert on applications
  for each row execute function notify_student_of_application();
