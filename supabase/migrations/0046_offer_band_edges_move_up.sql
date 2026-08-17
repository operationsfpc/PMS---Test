-- 0046 — A band edge now belongs to the band ABOVE it.
--
-- SPEC CHANGE 2026-08-17 (Karthik, verbatim): "5.00 is dream and 10.00 is
-- super dream."
--
-- It surfaced from the campus overview: a placed student on exactly Rs 5.00
-- LPA was reported under "Regular", because every layer treated a band edge as
-- the CEILING of the band below it (`ctc <= 5 then regular`). The edge is now
-- the FLOOR of the band above it.
--
-- Three places carried the old rule and all three are corrected here, because
-- correcting only the TypeScript would leave the database quietly disagreeing
-- with the screen:
--   1. src/domain/offer-category.ts  (this commit, with tests)
--   2. settings.offer_category_bands (seeded by 0002)
--   3. the ad-hoc CASE in 0041's backfill  -> replaced by a real function
--
-- WHY THIS IS NOT COSMETIC. offer_category is a rung on the ladder (R1/D5):
-- it decides which further drives a student holding an offer may still apply
-- to. An offer banded one rung too low understates what they hold and lets
-- them apply to drives they should already be blocked from. Rows sitting
-- exactly on an edge are therefore re-banded below, not left alone.

-- ------------------------------------------------------- the rule, once
-- 0041 inlined the bands as a CASE expression and said "change both or
-- neither", which is a comment where a function should have been. Now there
-- is one definition, and `src/db/offer-category-bands.test.ts` asserts it
-- against the TypeScript for every boundary.
create or replace function classify_offer_category(ctc_lpa numeric)
  returns offer_category
  language sql
  immutable
  set search_path = public
as $$
  select case
           when ctc_lpa is null then null
           when ctc_lpa < 5  then 'regular'
           when ctc_lpa < 10 then 'dream'
           else 'super_dream'
         end::offer_category;
$$;

comment on function classify_offer_category(numeric) is
  'R1 band edges belong to the band above: <5 regular, 5..<10 dream, >=10 super_dream. '
  'Mirrors classifyOfferCategory in src/domain/offer-category.ts; change both or neither.';

-- --------------------------------------------------- the configured bands
-- Renamed, not just revalued. `regularMaxLpa` is now a false description of
-- the number it holds, and a key that lies is worse than a key that is absent.
update settings
   set value = '{"dreamMinLpa": 5, "superDreamMinLpa": 10}'::jsonb
 where key = 'offer_category_bands';

-- ------------------------------------------------ re-band what sat on an edge
-- Only rows EXACTLY on an edge can change band, so this touches the minimum
-- possible: Rs 5.00 regular -> dream, Rs 10.00 dream -> super_dream. Every
-- other row already agrees with the new rule.
--
-- Deliberately NOT a blanket reclassification. offer_category is the Delivery
-- Head's decision and a legitimate override away from the suggested band must
-- survive a change to the suggestion.
update offers
   set offer_category = classify_offer_category(ctc_lpa)
 where drive_type <> 'internship'
   and ctc_lpa in (5, 10)
   and offer_category is distinct from classify_offer_category(ctc_lpa);

-- drives.offer_category is guarded as immutable by 0009's
-- enforce_drive_transitions, which is correct and stays. This migration is the
-- one legitimate exception - the rule itself moved under the data - so the
-- trigger is lifted for exactly this statement and restored immediately.
-- Anything that reaches for this pattern again should be treated as a bug.
alter table drives disable trigger enforce_drive_transitions;

update drives
   set offer_category = classify_offer_category(coalesce(ctc_max_lpa, ctc_min_lpa))
 where offer_category is not null
   and coalesce(ctc_max_lpa, ctc_min_lpa) in (5, 10)
   and offer_category is distinct
       from classify_offer_category(coalesce(ctc_max_lpa, ctc_min_lpa));

alter table drives enable trigger enforce_drive_transitions;
