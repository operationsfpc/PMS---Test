-- Migration 0096: Atomic opt-out approval
--
-- The frontend currently does two separate DB calls for opt-out approval:
-- 1) Update opt_out_requests to status='verified'
-- 2) Update students to participation_status='opted_out'
--
-- If the second fails, data is inconsistent. This function wraps both in a
-- single transaction so they either both succeed or both fail.

create or replace function approve_opt_out_atomic(request_id uuid, actor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_student_id uuid;
begin
  -- Update the opt-out request and get the student_id
  update opt_out_requests
     set status = 'verified',
         decided_by = actor_id,
         decided_at = now()
   where id = request_id
  returning student_id into v_student_id;

  if v_student_id is null then
    raise exception 'Opt-out request not found or already decided';
  end if;

  -- Irreversible from here: 0009 refuses any move away from opted_out
  update students
     set participation_status = 'opted_out'
   where id = v_student_id;

  return v_student_id;
end;
$$;

grant execute on function approve_opt_out_atomic to authenticated;
