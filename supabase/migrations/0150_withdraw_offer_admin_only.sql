-- 0150_withdraw_offer_admin_only.sql
-- Restrict withdraw_offer to admin role only.

create or replace function public.withdraw_offer(p_offer_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor        uuid;
  v_offer      offers%ROWTYPE;
  v_override   jsonb;
  v_withdrawal uuid;
begin
  select id into actor from profiles where id = auth.uid() and is_active;
  if actor is null then
    raise exception 'An offer is withdrawn by a signed-in staff member.'
      using errcode = '42501';
  end if;

  if current_app_role() <> 'admin' then
    raise exception 'Only an administrator may withdraw an offer.'
      using errcode = '42501';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Say why the offer is being withdrawn. The student is shown this.';
  end if;
  if char_length(trim(p_reason)) > 1000 then
    raise exception 'The reason must fit in 1000 characters.';
  end if;

  select * into v_offer from offers where id = p_offer_id;
  if v_offer.id is null then
    raise exception 'No such offer.';
  end if;

  select to_jsonb(o) into v_override
    from placement_record_overrides o where o.offer_id = v_offer.id;

  insert into offer_withdrawals (
    offer_id, student_id, drive_id, source, company_name, role_title, ctc_lpa,
    reason, withdrawn_by, offer, record_override
  )
  values (
    v_offer.id, v_offer.student_id, v_offer.drive_id, v_offer.source,
    v_offer.company_name, v_offer.role_title, v_offer.ctc_lpa,
    trim(p_reason), actor, to_jsonb(v_offer), v_override
  )
  returning id into v_withdrawal;

  delete from offers where id = p_offer_id;

  return v_withdrawal;
end;
$$;

grant execute on function public.withdraw_offer(uuid, text) to authenticated;
