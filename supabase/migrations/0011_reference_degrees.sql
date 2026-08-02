-- Eligible degrees, PIF Q13. Confirmed 2026-08-02.
--
-- Seeded as rows rather than hardcoded in the AE's form: adding a seventh
-- degree should be a row, not a release. The list starts as exactly the six
-- from the PIF.
--
-- "Any degree" is deliberately absent. It is not a degree - it is the ABSENCE
-- of a degree restriction, expressed as an empty eligible-degrees list on the
-- drive. evaluateEligibility (R2) treats an empty list as "no filter". Storing
-- it as a row would silently break eligibility, because no student's degree is
-- ever literally "Any degree".

insert into degrees (name) values
  ('B.E / B.Tech (CSE / IT / allied)'),
  ('BCA'),
  ('B.Sc CS / CT'),
  ('MCA'),
  ('M.Sc CS')
on conflict (name) do nothing;
