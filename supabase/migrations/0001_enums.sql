-- Domain vocabularies. These mirror src/domain/types.ts one-for-one.
-- src/domain/types.test.ts pins the TypeScript side; changing either without
-- the other is a breaking change requiring a migration.

create type role_category as enum (
  'software_technical', 'technical_support_it_ops', 'digital_marketing',
  'sales', 'operations_business'
);

create type drive_type as enum ('placement', 'internship_convertible', 'internship');

-- 'off_campus' is deliberately absent: it means SELF-PLACED (PRD 16.2).
create type drive_mode as enum ('on_campus', 'physical_outside_campus', 'virtual', 'pooled');

create type arrear_policy as enum ('no_standing', 'no_history', 'flexible');

create type offer_category as enum ('regular', 'dream', 'super_dream');

create type srf_status as enum (
  'invited', 'registered', 'srf_submitted', 'srf_approved', 'srf_rejected'
);

create type participation_status as enum ('active', 'opted_out', 'disbarred');

create type drive_status as enum (
  'draft', 'submitted', 'approved', 'live',
  'applications_closed', 'in_rounds', 'completed', 'rejected'
);

create type round_result as enum ('selected', 'rejected', 'waitlisted', 'on_hold');

create type attendance_status as enum ('scheduled', 'present', 'absent', 'provisional');

create type offer_source as enum ('on_campus', 'self_placed');

create type verification_status as enum ('pending', 'verified', 'rejected');

create type app_role as enum (
  'admin', 'student', 'campus_placement_coordinator', 'campus_manager',
  'account_executive', 'delivery_head', 'central_placement_coordinator',
  'key_account_manager', 'enterprise_relations', 'er_head', 'ceo'
);
