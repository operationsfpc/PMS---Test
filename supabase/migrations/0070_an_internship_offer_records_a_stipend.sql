-- An internship offer records a stipend, not a CTC.
--
-- Karthik, 2026-08-27: "go with option 1".
--
-- P10, resolved earlier the same day, let a DRIVE go live on a stipend alone
-- (0067's `live_requires_complete_record`). The OFFER at the end of that drive
-- was never changed to match: `offers.ctc_lpa` is NOT NULL and the declare
-- screen refuses anything ≤ 0. So the two offers already declared on the XYZ
-- internship — a drive paying **₹15,000 a month** — are recorded at
-- **₹10.00 and ₹12.00 LPA**. Nobody mistyped them. The box would not accept
-- anything else, and a coordinator with a student in front of them types
-- something.
--
-- This is P10's other half. The rule is the same shape and deliberately so:
-- an offer records what it PAYS, and only a plain internship may lean on the
-- stipend. `internship_convertible` becomes a salary and is quoted as one,
-- exactly as 0067 drew the line for drives.
--
-- Mirrors `offerPayProblem` in `src/domain/offer-pay.ts`. Change both or
-- neither.
--
-- ⚠️ The order below is load-bearing and was got wrong on the first attempt:
-- the repair sets `ctc_lpa` to NULL, so the NOT NULL must go FIRST. The push
-- failed on the real database with 23502 and rolled back whole — and the
-- PGlite suite had not caught it, because a fresh test database has no legacy
-- rows for the UPDATE to touch. Hence the repair is a FUNCTION: something a
-- test can call against data it creates itself.

-- ========================================================== 1. the column

alter table offers
  add column if not exists stipend_monthly integer check (stipend_monthly > 0);

comment on column offers.stipend_monthly is
  'What a plain internship offer pays, per month in rupees. Mutually '
  'exclusive with ctc_lpa: one fact, one spelling.';

-- ================================ 2. a CTC is no longer required of everyone

alter table offers alter column ctc_lpa drop not null;

-- ========================================================== 3. the repair
--
-- The stipend is read from the DRIVE rather than assumed, so this repairs
-- whatever the drive actually records rather than the ₹15,000 that happens to
-- be true today. Only rows that are demonstrably the defect are touched: a
-- plain internship offer, whose drive records a stipend, that has not already
-- been repaired. An internship offer whose drive records no stipend either
-- cannot be repaired from the data and is deliberately left alone for a
-- person to look at.

create or replace function repair_internship_offer_pay()
  returns integer language plpgsql security definer set search_path = public as $$
declare
  v_repaired integer;
begin
  update offers o
     set stipend_monthly = d.stipend_min_monthly,
         ctc_lpa         = null
    from drives d
   where d.id = o.drive_id
     and o.drive_type = 'internship'
     and d.stipend_min_monthly is not null
     and o.stipend_monthly is null;

  get diagnostics v_repaired = row_count;
  return v_repaired;
end;
$$;

comment on function repair_internship_offer_pay() is
  'Moves a plain internship offer''s invented CTC onto the stipend its drive '
  'records. Idempotent: an offer already carrying a stipend is not touched.';

select repair_internship_offer_pay();

-- ======================================================= 4. the rule itself
--
-- Checked against production before choosing the constraint's strength:
--   internship offers whose drive records no stipend .... 0
--   salaried offers with no CTC .......................... 0
-- Every existing row is therefore repairable, so this is VALIDATED rather
-- than NOT VALID. If the repair above ever fails to do its job, this
-- migration refuses to apply — the loud failure worth having, and strictly
-- better than a rule that quietly does not police the rows that provoked it.

alter table offers
  add constraint offer_records_what_it_pays check (
    case
      when drive_type = 'internship'
        then stipend_monthly is not null and ctc_lpa is null
      else ctc_lpa is not null and stipend_monthly is null
    end
  );

comment on constraint offer_records_what_it_pays on offers is
  'An offer records what it pays: a plain internship a monthly stipend, '
  'everything else an annual CTC — and never both. P10''s other half '
  '(2026-08-27). Mirrors offerPayProblem in src/domain/offer-pay.ts.';
