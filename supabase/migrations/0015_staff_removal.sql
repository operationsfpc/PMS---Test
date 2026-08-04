-- Removing a staff member, and moving one to a different role.
--
-- 0012 already restricts both to Admins: `write_profiles`, `write_invitations`
-- and `write_staff_campus_invitations` are FOR ALL, which includes DELETE. But
-- 0008 granted `authenticated` only SELECT, INSERT and UPDATE, so a DELETE
-- never reached the policy at all - it failed at the grant with a bare
-- "permission denied for table profiles" and no way for an Admin to act on it.
--
-- WHY DELETE AT ALL, given the audit trail is append-only:
--   An invitation is the login allowlist. Getting one wrong - a typo'd address,
--   a test account, someone who left before they ever signed in - leaves an
--   account that can sign in and must be revocable. Deactivation does not
--   remove an unaccepted invitation, because there is no profile to deactivate.
--
-- WHAT DELETE CANNOT DO:
--   profiles.id is referenced by drives.created_by, approved_by, published_by
--   and by the offer and result tables, none of them ON DELETE anything. So
--   Postgres refuses to remove anyone whose work is still on record, and the
--   attribution PRD 19 depends on survives. The application turns that refusal
--   into "deactivate them instead".
--
--   The audit_log itself keeps actor_id as a plain uuid with no foreign key,
--   so history is never touched by any of this.

grant delete on profiles                  to authenticated;
grant delete on staff_invitations         to authenticated;
grant delete on staff_campus_invitations  to authenticated;
grant delete on staff_campus_assignments  to authenticated;
