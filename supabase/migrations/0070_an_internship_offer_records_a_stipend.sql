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

-- ============================================================ 1. the column

alter table offers
  add column if not exists stipend_monthly integer check (stipend_monthly > 0);

comment on column offers.stipend_monthly is
  'What a plain internship offer pays, per month in rupees. Mutually '
  'exclusive with ctc_lpa: one fact, one spelling.';

-- ====================================== 2. correct the two rows already live
--
-- Done BEFORE the constraint, and deliberately not left to a human: the rows
-- would otherwise be refused by the very rule that describes them correctly.
--
-- The stipend is read from the drive rather than assumed, so this repairs
-- whatever the drive actually says rather than the ₹15,000 that is true today.
-- Only rows that are demonstrably the defect are touched: a plain internship
-- offer whose drive records a stipend. Their invented CTC goes.

update offers o
   set stipend_monthly = d.stipend_min_monthly,
       ctc_lpa         = null
  from drives d
 where d.id = o.drive_id
   and o.drive_type = 'internship'
   and d.stipend_min_monthly is not null
   and o.stipend_monthly is null;

-- Checked against production before choosing the constraint's strength:
--   internship offers whose drive records no stipend .... 0
--   salaried offers with no CTC .......................... 0
-- Every existing row is therefore repairable, so the constraint below is
-- VALIDATED rather than NOT VALID. If the repair above ever fails to do its
-- job, this migration refuses to apply — which is the loud failure worth
-- having, and strictly better than a rule that quietly does not police the
-- rows that provoked it.

-- ======================================================= 3. the rule itself

alter table offers alter column ctc_lpa drop not null;

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
