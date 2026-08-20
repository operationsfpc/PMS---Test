-- 0055 — UAT 2026-08-20, G6c (Q5 answer a): a round's details freeze once
-- students begin participating.
--
-- "Round details remain editable even after a drive is completed and a
-- student has been selected. Round details should freeze once students begin
-- participating in interview rounds, to prevent retroactive changes to a
-- closed process."
--
-- The boundary is the first RECORDED fact — attendance marked present or
-- absent, or a result declared. A provisional QR self check-in does not
-- freeze: nobody has confirmed it, and a student's own tap must not lock the
-- coordinator out of correcting a wrong link before the round runs.
--
-- The UI refuses first (src/domain/rounds.ts, roundDetailsFrozen). This
-- trigger is the far side of that pair: a rule enforced only in the browser
-- is a suggestion.
--
-- `advance_proof_path` is deliberately NOT frozen — the advance happens
-- exactly when results exist, and its proof arrives with it.

create or replace function round_details_freeze_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only the four detail columns are guarded. Anything else (name, proof,
  -- sequence) keeps its existing rules.
  if new.round_mode is not distinct from old.round_mode
     and new.round_scheduled_at is not distinct from old.round_scheduled_at
     and new.round_interview_link is not distinct from old.round_interview_link
     and new.venue is not distinct from old.venue then
    return new;
  end if;

  if exists (select 1 from round_results r where r.round_id = old.id)
     or exists (
       select 1 from attendance a
       where a.round_id = old.id and a.status in ('present', 'absent')
     ) then
    raise exception
      'Round details are locked - students have begun participating in this round.';
  end if;

  return new;
end;
$$;

drop trigger if exists round_details_freeze on drive_rounds;
create trigger round_details_freeze
  before update on drive_rounds
  for each row
  execute function round_details_freeze_guard();
