-- 0123 - Stop the staff-notification triggers from refusing the student's own write.
--
-- Three triggers (0093 opt-outs, 0094 self-placements, 0095 SRF submissions, re-created unchanged by
-- 0097) all notify the campus coordinator the same way:
--
--   insert into notifications (student_id, kind, title, body)
--   select p.id, ... from profiles p where p.role = 'campus_placement_coordinator' ...
--
-- `p.id` is a PROFILE id, and `notifications.student_id` is `uuid not null references students(id)`
-- (0006). The two id spaces do not overlap - a coordinator is never also a student row - so the
-- insert raises a foreign-key violation, and because it runs inside the student's own statement the
-- student's write is rolled back with it.
--
-- 0097 was written to "fix notification trigger bugs" and left this untouched.
--
-- On production it cost eighteen days of SRF submissions: the last form that committed was
-- 2026-10-10T09:25:37, the `application_confirmed` rows introduced by 0092 begin at
-- 2026-10-10T10:00:20, and `notifications` holds 18,891 rows of which ZERO are of kind
-- `srf_submitted`. Students were told "Could not submit your form. Please try again." and retried -
-- one of them left 232 uploaded files behind, because uploads happen before the transaction and
-- nothing writes document rows until `submit_srf` commits.
--
-- Dropping the triggers, not repairing them: the notification could never have been read. The only
-- SELECT policy on `notifications` is `student_id = current_student_id()` (0008), which is NULL for
-- a coordinator - even the row they were trying to insert was invisible to the person it was for.
-- The queue at /cpc/verification is how coordinators already find submissions, and it is how the 30
-- approved S-VYASA forms were approved.
--
-- The functions stay in place, unused, so restoring a correctly addressed staff notice later is a
-- `create trigger` away.

drop trigger if exists notify_cpc_of_srf_submission on students;
drop trigger if exists notify_cpc_of_opt_out_submission on opt_out_requests;
drop trigger if exists notify_cpc_of_self_placement_submission on self_placement_requests;
