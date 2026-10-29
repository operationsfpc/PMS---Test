-- 0127_campus_managers_file_hold_orders.sql
--
-- The last thing 0125 could not do: file the attachment.
--
-- A hold has an optional document (the request was "reason as text box with
-- attachment non manditory"). 0125 gave `student_holds` a `document_id` and made
-- the `hold-orders` bucket insertable by a Campus Manager, but the row naming
-- that object lives in `student_documents`, and the only insert policy there is
-- the student's own (0049:203). So the dialog could upload the fee demand and
-- then be refused the row: the hold would place with no attachment and the
-- manager would believe the evidence was filed with it.
--
-- One narrow policy closes it. A Campus Manager, a hold order, a student at a
-- college they sit on — `my_campus_ids()`, the same scoping 0125's own bucket
-- policy and `place_student_hold` use. Nothing else may be filed this way: a
-- manager still cannot insert a marksheet, a resume or an offer letter.
--
-- What is deliberately NOT here is update and delete. A hold order is filed once,
-- with the hold, and 0007's audit trigger has already recorded that decision;
-- rewriting the document behind it would leave the log describing evidence that
-- no longer exists. `on delete set null` (0125) is the only way it leaves the row.

drop policy if exists documents_insert_hold_order on student_documents;
create policy documents_insert_hold_order on student_documents for insert
  with check (
    current_app_role() = 'campus_manager'
    and kind = 'hold_order'
    and student_id in (
      select s.id from students s where s.campus_id in (select my_campus_ids())
    )
  );
