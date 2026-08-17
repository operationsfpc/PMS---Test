-- 0047 — Raising a drive is the Account Executive's, and only theirs.
--
-- 2026-08-17 (Karthik): "To keep drives simple, AE can only raise drives (no
-- one else can raise a drive). Delivery head can only approve (delivery head
-- cannot raise a drive). ... Central PC cannot raise or approve a drive."
--
-- 0008 handed out `for all` twice:
--
--   drives_dh_write        current_app_role() = 'delivery_head'
--   drives_operator_write  is_operator()   -- admin + central_placement_coordinator
--
-- `for all` includes INSERT. So both of the people whose job is to CHECK the
-- Account Executive's work could raise a drive of their own and then approve
-- or publish it themselves. The screens never offered it; the database allowed
-- it, and the database is the part that decides.
--
-- The lifecycle is three verbs held by three roles, and the separation is the
-- control:
--
--     raise -> account_executive
--     approve -> delivery_head
--     publish -> central_placement_coordinator
--
-- Admin gets none of them. Being able to fix anything is not a reason to be
-- able to do everything, and an Admin who could raise and approve their own
-- drive is the whole separation defeated by one account.

-- ------------------------------------------------------- raising: AE only
-- Unchanged in spirit, restated so the INSERT rule lives in one obvious place.
-- `created_by = auth.uid()` matters as much as the role: raising a drive in
-- another AE's name would forge the ownership column that scopes every later
-- read of it.
drop policy if exists drives_ae_write on drives;

-- Status is constrained to the two an AE legitimately starts from: 'draft'
-- (save and come back) and 'submitted' (send it to the Delivery Head). 0008
-- checked no status at all on INSERT, and 0009's transition guard only fires
-- on UPDATE - so an AE could have inserted a drive already 'approved' or
-- 'live' and walked past both of the other two roles in one statement.
create policy drives_ae_insert on drives for insert
  with check (
    current_app_role() = 'account_executive'
    and created_by = auth.uid()
    and status in ('draft', 'submitted')
  );

-- An AE may still edit their own drive, but only while it is a draft. Once it
-- is submitted it belongs to the process, not to them.
create policy drives_ae_update on drives for update
  using (
    current_app_role() = 'account_executive'
    and created_by = auth.uid()
    and status = 'draft'
  )
  with check (
    current_app_role() = 'account_executive'
    and created_by = auth.uid()
  );

-- --------------------------------------------- approving and publishing
-- Both roles keep every power they actually use - they read, they update, they
-- delete. What they lose is INSERT, which neither has any business having.
-- Splitting `for all` into the three verbs is the entire change.
drop policy if exists drives_dh_write on drives;

create policy drives_dh_update on drives for update
  using (current_app_role() = 'delivery_head')
  with check (current_app_role() = 'delivery_head');

create policy drives_dh_delete on drives for delete
  using (current_app_role() = 'delivery_head');

drop policy if exists drives_operator_write on drives;

create policy drives_operator_update on drives for update
  using (is_operator()) with check (is_operator());

create policy drives_operator_delete on drives for delete
  using (is_operator());

-- Reads are untouched: drives_staff_read, drives_ae_read (own drives only),
-- drives_campus_read and drives_student_read all still apply. An AE seeing
-- only the drives they raised is 0008's rule and remains correct - Karthik,
-- same day: "An AE cannot see drives raised by other AEs."
