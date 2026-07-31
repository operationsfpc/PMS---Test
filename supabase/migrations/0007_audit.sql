-- Immutable audit trail (PRD 19).
-- Written by triggers, never by application code. Append-only at the DB level.

create table audit_log (
  id            bigserial primary key,
  actor_id      uuid,
  entity_table  text not null,
  entity_id     text not null,
  action        text not null,
  before_data   jsonb,
  after_data    jsonb,
  reason        text,
  created_at    timestamptz not null default now()
);

create index audit_entity_idx on audit_log (entity_table, entity_id);

create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_id    text;
  v_new   jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_old   jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
begin
  begin
    v_actor := auth.uid();
  exception when others then
    v_actor := null;
  end;

  v_id := coalesce(
    coalesce(v_new, v_old) ->> 'id',
    coalesce(v_new, v_old) ->> 'student_id'
  );

  insert into audit_log (actor_id, entity_table, entity_id, action, before_data, after_data, reason)
  values (
    v_actor,
    tg_table_name,
    v_id,
    lower(tg_op),
    v_old,
    v_new,
    -- Read generically: this one trigger serves every audited table, so it
    -- must not reference a column that only some of them have.
    coalesce(
      v_new ->> 'rejection_reason',
      v_new ->> 'on_hold_reason',
      v_new ->> 'open_to_all_reason',
      v_new ->> 'reason',
      v_new ->> 'srf_rejection_reason'
    )
  );
  return coalesce(new, old);
end;
$$;

-- Every table whose changes PRD 19 requires us to record.
create trigger audit_students   after insert or update or delete on students
  for each row execute function audit_row();
create trigger audit_drives     after insert or update or delete on drives
  for each row execute function audit_row();
create trigger audit_offers     after insert or update or delete on offers
  for each row execute function audit_row();
create trigger audit_results    after insert or update or delete on round_results
  for each row execute function audit_row();
create trigger audit_attendance after insert or update or delete on attendance
  for each row execute function audit_row();
create trigger audit_shortlist  after insert or update or delete on shortlist_entries
  for each row execute function audit_row();
create trigger audit_exports    after insert on recruiter_exports
  for each row execute function audit_row();
create trigger audit_optout     after insert or update or delete on opt_out_requests
  for each row execute function audit_row();
create trigger audit_disbar     after insert or update or delete on disbarment_decisions
  for each row execute function audit_row();
create trigger audit_semesters  after insert or update or delete on student_semesters
  for each row execute function audit_row();

-- The log is append-only. Nobody, including the service role, may rewrite history.
create rule audit_log_no_update as on update to audit_log do instead nothing;
create rule audit_log_no_delete as on delete to audit_log do instead nothing;
