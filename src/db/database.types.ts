/**
 * GENERATED FILE — do not edit.
 * Run `pnpm db:types` after changing anything in supabase/migrations.
 */

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export interface Enums {
  app_role:
    | "admin"
    | "student"
    | "campus_placement_coordinator"
    | "campus_manager"
    | "account_executive"
    | "delivery_head"
    | "central_placement_coordinator"
    | "key_account_manager"
    | "enterprise_relations"
    | "er_head"
    | "ceo";
  arrear_policy: "no_standing" | "no_history" | "flexible";
  attendance_status: "scheduled" | "present" | "absent" | "provisional";
  document_kind:
    | "tenth_marksheet"
    | "twelfth_marksheet"
    | "semester_marksheet"
    | "resume"
    | "offer_letter"
    | "opt_out_declaration"
    | "ug_consolidated_marksheet"
    | "diploma_marksheet"
    | "certificate";
  drive_mode: "on_campus" | "physical_outside_campus" | "virtual" | "pooled";
  drive_status:
    | "draft"
    | "submitted"
    | "approved"
    | "live"
    | "applications_closed"
    | "in_rounds"
    | "completed"
    | "rejected";
  drive_type: "placement" | "internship_convertible" | "internship";
  marks_scale: "cgpa" | "percentage";
  offer_category: "regular" | "dream" | "super_dream";
  offer_source: "on_campus" | "self_placed";
  participation_status: "active" | "opted_out" | "disbarred";
  programme_level: "ug" | "pg";
  role_category:
    | "software_technical"
    | "technical_support_it_ops"
    | "digital_marketing"
    | "sales"
    | "operations_business";
  round_result: "selected" | "rejected" | "waitlisted" | "on_hold";
  srf_status: "invited" | "registered" | "srf_submitted" | "srf_approved" | "srf_rejected";
  verification_status: "pending" | "verified" | "rejected";
}

export interface ApplicationsRow {
  id: string;
  drive_id: string;
  student_id: string;
  applied_at: string;
  profile_snapshot: Json;
  resume_id: string | null;
}

export type ApplicationsInsert = Pick<
  ApplicationsRow,
  "drive_id" | "student_id" | "profile_snapshot"
> &
  Partial<Pick<ApplicationsRow, "id" | "applied_at" | "resume_id">>;

export interface AttendanceRow {
  id: string;
  round_id: string;
  application_id: string;
  status: Enums["attendance_status"];
  marked_by: string | null;
  marked_at: string | null;
  confirmed_by: string | null;
}

export type AttendanceInsert = Pick<AttendanceRow, "round_id" | "application_id"> &
  Partial<Pick<AttendanceRow, "id" | "status" | "marked_by" | "marked_at" | "confirmed_by">>;

export interface AuditLogRow {
  id: number;
  actor_id: string | null;
  entity_table: string;
  entity_id: string;
  action: string;
  before_data: Json | null;
  after_data: Json | null;
  reason: string | null;
  created_at: string;
}

export type AuditLogInsert = Pick<AuditLogRow, "entity_table" | "entity_id" | "action"> &
  Partial<
    Pick<AuditLogRow, "id" | "actor_id" | "before_data" | "after_data" | "reason" | "created_at">
  >;

export interface BranchesRow {
  id: string;
  degree_id: string;
  name: string;
  is_active: boolean;
}

export type BranchesInsert = Pick<BranchesRow, "degree_id" | "name"> &
  Partial<Pick<BranchesRow, "id" | "is_active">>;

export interface CampusDegreesRow {
  campus_id: string;
  degree_id: string;
}

export type CampusDegreesInsert = Pick<CampusDegreesRow, "campus_id" | "degree_id">;

export interface CampusProgrammesRow {
  id: string;
  campus_id: string;
  degree_id: string;
  branch_id: string | null;
  passing_year: number;
  created_at: string;
}

export type CampusProgrammesInsert = Pick<
  CampusProgrammesRow,
  "campus_id" | "degree_id" | "passing_year"
> &
  Partial<Pick<CampusProgrammesRow, "id" | "branch_id" | "created_at">>;

export interface CampusesRow {
  id: string;
  name: string;
  created_at: string;
  city_id: string;
  code: string;
  address: string;
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  is_active: boolean;
}

export type CampusesInsert = Pick<
  CampusesRow,
  | "name"
  | "city_id"
  | "code"
  | "address"
  | "primary_contact_name"
  | "primary_contact_email"
  | "primary_contact_phone"
> &
  Partial<Pick<CampusesRow, "id" | "created_at" | "is_active">>;

export interface CitiesRow {
  id: string;
  name: string;
  state: string;
}

export type CitiesInsert = Pick<CitiesRow, "name" | "state"> & Partial<Pick<CitiesRow, "id">>;

export interface DegreesRow {
  id: string;
  name: string;
}

export type DegreesInsert = Pick<DegreesRow, "name"> & Partial<Pick<DegreesRow, "id">>;

export interface DisbarmentDecisionsRow {
  id: string;
  student_id: string;
  disbarred: boolean;
  reason: string;
  absence_count: number;
  decided_by: string;
  decided_at: string;
}

export type DisbarmentDecisionsInsert = Pick<
  DisbarmentDecisionsRow,
  "student_id" | "disbarred" | "reason" | "absence_count" | "decided_by"
> &
  Partial<Pick<DisbarmentDecisionsRow, "id" | "decided_at">>;

export interface DriveEligibleBranchesRow {
  drive_id: string;
  branch_id: string;
}

export type DriveEligibleBranchesInsert = Pick<DriveEligibleBranchesRow, "drive_id" | "branch_id">;

export interface DriveEligibleDegreesRow {
  drive_id: string;
  degree_id: string;
}

export type DriveEligibleDegreesInsert = Pick<DriveEligibleDegreesRow, "drive_id" | "degree_id">;

export interface DriveRoundsRow {
  id: string;
  drive_id: string;
  sequence: number;
  name: string;
  scheduled_at: string | null;
  venue: string | null;
  online_link: string | null;
  instructions: string | null;
  created_at: string;
}

export type DriveRoundsInsert = Pick<DriveRoundsRow, "drive_id" | "sequence" | "name"> &
  Partial<
    Pick<
      DriveRoundsRow,
      "id" | "scheduled_at" | "venue" | "online_link" | "instructions" | "created_at"
    >
  >;

export interface DriveTargetCampusesRow {
  drive_id: string;
  campus_id: string;
}

export type DriveTargetCampusesInsert = Pick<DriveTargetCampusesRow, "drive_id" | "campus_id">;

export interface DrivesRow {
  id: string;
  company_name: string;
  industry: string | null;
  company_website: string | null;
  spoc_name: string | null;
  spoc_designation: string | null;
  spoc_email: string | null;
  spoc_phone: string | null;
  role_title: string | null;
  role_category: Enums["role_category"] | null;
  job_description: string | null;
  openings: number | null;
  work_locations: string | null;
  ctc_min_lpa: number | null;
  ctc_max_lpa: number | null;
  ctc_breakup: string | null;
  shift_type: string | null;
  bond_details: string | null;
  min_overall_cgpa: number | null;
  min_tenth_percentage: number | null;
  min_twelfth_percentage: number | null;
  arrears_policy: Enums["arrear_policy"];
  eligible_passing_years: number[];
  mandatory_skills: string | null;
  drive_mode: Enums["drive_mode"] | null;
  tentative_date: string | null;
  timeline_notes: string | null;
  drive_type: Enums["drive_type"] | null;
  offer_category: Enums["offer_category"] | null;
  status: Enums["drive_status"];
  on_hold: boolean;
  on_hold_reason: string | null;
  open_to_all_override: boolean;
  open_to_all_reason: string | null;
  application_start: string | null;
  application_end: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  published_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  additional_designations: string[];
  round_count: number | null;
  min_overall_marks: number | null;
  min_overall_cgpa_scale: Enums["marks_scale"];
}

export type DrivesInsert = Pick<DrivesRow, "company_name"> &
  Partial<
    Pick<
      DrivesRow,
      | "id"
      | "industry"
      | "company_website"
      | "spoc_name"
      | "spoc_designation"
      | "spoc_email"
      | "spoc_phone"
      | "role_title"
      | "role_category"
      | "job_description"
      | "openings"
      | "work_locations"
      | "ctc_min_lpa"
      | "ctc_max_lpa"
      | "ctc_breakup"
      | "shift_type"
      | "bond_details"
      | "min_overall_cgpa"
      | "min_tenth_percentage"
      | "min_twelfth_percentage"
      | "arrears_policy"
      | "eligible_passing_years"
      | "mandatory_skills"
      | "drive_mode"
      | "tentative_date"
      | "timeline_notes"
      | "drive_type"
      | "offer_category"
      | "status"
      | "on_hold"
      | "on_hold_reason"
      | "open_to_all_override"
      | "open_to_all_reason"
      | "application_start"
      | "application_end"
      | "created_by"
      | "approved_by"
      | "approved_at"
      | "rejection_reason"
      | "published_by"
      | "published_at"
      | "created_at"
      | "updated_at"
      | "additional_designations"
      | "round_count"
      | "min_overall_marks"
      | "min_overall_cgpa_scale"
    >
  >;

export interface EmailDeliveriesRow {
  id: string;
  notification_id: string;
  recipient_email: string;
  provider_message_id: string | null;
  status: string;
  error: string | null;
  updated_at: string;
}

export type EmailDeliveriesInsert = Pick<
  EmailDeliveriesRow,
  "notification_id" | "recipient_email"
> &
  Partial<
    Pick<EmailDeliveriesRow, "id" | "provider_message_id" | "status" | "error" | "updated_at">
  >;

export interface NotificationsRow {
  id: string;
  student_id: string;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export type NotificationsInsert = Pick<NotificationsRow, "student_id" | "kind" | "title" | "body"> &
  Partial<Pick<NotificationsRow, "id" | "read_at" | "created_at">>;

export interface OffersRow {
  id: string;
  student_id: string;
  drive_id: string | null;
  source: Enums["offer_source"];
  company_name: string;
  role_title: string | null;
  drive_type: Enums["drive_type"];
  offer_category: Enums["offer_category"] | null;
  ctc_lpa: number;
  declared_at: string;
  declared_by: string | null;
  offer_letter_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

export type OffersInsert = Pick<
  OffersRow,
  "student_id" | "company_name" | "drive_type" | "ctc_lpa"
> &
  Partial<
    Pick<
      OffersRow,
      | "id"
      | "drive_id"
      | "source"
      | "role_title"
      | "offer_category"
      | "declared_at"
      | "declared_by"
      | "offer_letter_id"
      | "approved_by"
      | "approved_at"
    >
  >;

export interface OptOutRequestsRow {
  id: string;
  student_id: string;
  reason: string;
  status: Enums["verification_status"];
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  declaration_id: string | null;
  decision_reason: string | null;
}

export type OptOutRequestsInsert = Pick<OptOutRequestsRow, "student_id" | "reason"> &
  Partial<
    Pick<
      OptOutRequestsRow,
      | "id"
      | "status"
      | "decided_by"
      | "decided_at"
      | "created_at"
      | "declaration_id"
      | "decision_reason"
    >
  >;

export interface PlacementRecordOverridesRow {
  student_id: string;
  offer_id: string;
  reason: string;
  set_by: string;
  set_at: string;
}

export type PlacementRecordOverridesInsert = Pick<
  PlacementRecordOverridesRow,
  "student_id" | "offer_id" | "reason" | "set_by"
> &
  Partial<Pick<PlacementRecordOverridesRow, "set_at">>;

export interface ProfilesRow {
  id: string;
  email: string;
  full_name: string;
  role: Enums["app_role"];
  is_active: boolean;
  created_at: string;
}

export type ProfilesInsert = Pick<ProfilesRow, "id" | "email" | "full_name" | "role"> &
  Partial<Pick<ProfilesRow, "is_active" | "created_at">>;

export interface RecruiterExportsRow {
  id: string;
  drive_id: string;
  exported_by: string;
  exported_at: string;
  columns: string[];
  student_count: number;
}

export type RecruiterExportsInsert = Pick<
  RecruiterExportsRow,
  "drive_id" | "exported_by" | "columns" | "student_count"
> &
  Partial<Pick<RecruiterExportsRow, "id" | "exported_at">>;

export interface RoundParticipantsRow {
  id: string;
  round_id: string;
  application_id: string;
  added_by: string | null;
  added_at: string;
}

export type RoundParticipantsInsert = Pick<RoundParticipantsRow, "round_id" | "application_id"> &
  Partial<Pick<RoundParticipantsRow, "id" | "added_by" | "added_at">>;

export interface RoundResultsRow {
  id: string;
  round_id: string;
  application_id: string;
  result: Enums["round_result"];
  declared_by: string | null;
  declared_at: string;
}

export type RoundResultsInsert = Pick<RoundResultsRow, "round_id" | "application_id" | "result"> &
  Partial<Pick<RoundResultsRow, "id" | "declared_by" | "declared_at">>;

export interface SelfPlacementRequestsRow {
  id: string;
  student_id: string;
  company_name: string;
  role_title: string | null;
  ctc_lpa: number;
  offer_letter_id: string | null;
  status: Enums["verification_status"];
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  decision_reason: string | null;
}

export type SelfPlacementRequestsInsert = Pick<
  SelfPlacementRequestsRow,
  "student_id" | "company_name" | "ctc_lpa"
> &
  Partial<
    Pick<
      SelfPlacementRequestsRow,
      | "id"
      | "role_title"
      | "offer_letter_id"
      | "status"
      | "decided_by"
      | "decided_at"
      | "created_at"
      | "decision_reason"
    >
  >;

export interface SettingsRow {
  key: string;
  value: Json;
  updated_at: string;
}

export type SettingsInsert = Pick<SettingsRow, "key" | "value"> &
  Partial<Pick<SettingsRow, "updated_at">>;

export interface ShortlistEntriesRow {
  id: string;
  application_id: string;
  included: boolean;
  rank: number | null;
  score: number | null;
  rationale: string | null;
  decided_by: string | null;
  decided_at: string;
}

export type ShortlistEntriesInsert = Pick<ShortlistEntriesRow, "application_id"> &
  Partial<
    Pick<
      ShortlistEntriesRow,
      "id" | "included" | "rank" | "score" | "rationale" | "decided_by" | "decided_at"
    >
  >;

export interface SkillAreasRow {
  id: string;
  name: string;
  created_at: string;
}

export type SkillAreasInsert = Pick<SkillAreasRow, "name"> &
  Partial<Pick<SkillAreasRow, "id" | "created_at">>;

export interface StaffCampusAssignmentsRow {
  profile_id: string;
  campus_id: string;
}

export type StaffCampusAssignmentsInsert = Pick<
  StaffCampusAssignmentsRow,
  "profile_id" | "campus_id"
>;

export interface StaffCampusInvitationsRow {
  email: string;
  campus_id: string;
}

export type StaffCampusInvitationsInsert = Pick<StaffCampusInvitationsRow, "email" | "campus_id">;

export interface StaffInvitationsRow {
  email: string;
  full_name: string;
  role: Enums["app_role"];
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
}

export type StaffInvitationsInsert = Pick<StaffInvitationsRow, "email" | "full_name" | "role"> &
  Partial<Pick<StaffInvitationsRow, "invited_by" | "created_at" | "accepted_at">>;

export interface StudentCertificatesRow {
  id: string;
  student_id: string;
  name: string;
  document_id: string;
  created_at: string;
}

export type StudentCertificatesInsert = Pick<
  StudentCertificatesRow,
  "student_id" | "name" | "document_id"
> &
  Partial<Pick<StudentCertificatesRow, "id" | "created_at">>;

export interface StudentDocumentsRow {
  id: string;
  student_id: string;
  kind: Enums["document_kind"];
  role_category: Enums["role_category"] | null;
  storage_path: string;
  size_bytes: number;
  uploaded_at: string;
  drive_id: string | null;
}

export type StudentDocumentsInsert = Pick<
  StudentDocumentsRow,
  "student_id" | "kind" | "storage_path" | "size_bytes"
> &
  Partial<Pick<StudentDocumentsRow, "id" | "role_category" | "uploaded_at" | "drive_id">>;

export interface StudentRolePreferencesRow {
  student_id: string;
  category: Enums["role_category"];
}

export type StudentRolePreferencesInsert = Pick<
  StudentRolePreferencesRow,
  "student_id" | "category"
>;

export interface StudentSemestersRow {
  id: string;
  student_id: string;
  semester_number: number;
  cgpa: number;
  current_arrears: number;
  history_of_arrears: number;
  marksheet_id: string;
  status: Enums["verification_status"];
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  declared_marks: number | null;
  marks_scale: Enums["marks_scale"];
}

export type StudentSemestersInsert = Pick<
  StudentSemestersRow,
  "student_id" | "semester_number" | "cgpa" | "marksheet_id"
> &
  Partial<
    Pick<
      StudentSemestersRow,
      | "id"
      | "current_arrears"
      | "history_of_arrears"
      | "status"
      | "verified_by"
      | "verified_at"
      | "created_at"
      | "declared_marks"
      | "marks_scale"
    >
  >;

export interface StudentSkillScoresRow {
  id: string;
  student_id: string;
  skill_area_id: string;
  score: number;
  recorded_by: string | null;
  recorded_at: string;
}

export type StudentSkillScoresInsert = Pick<
  StudentSkillScoresRow,
  "student_id" | "skill_area_id" | "score"
> &
  Partial<Pick<StudentSkillScoresRow, "id" | "recorded_by" | "recorded_at">>;

export interface StudentsRow {
  id: string;
  auth_user_id: string | null;
  campus_id: string;
  degree_id: string;
  branch_id: string | null;
  roll_number: string;
  full_name: string;
  email: string;
  passing_year: number;
  mobile: string | null;
  whatsapp: string | null;
  alternate_contact: string | null;
  srf_status: Enums["srf_status"];
  participation_status: Enums["participation_status"];
  tenth_percentage: number | null;
  twelfth_percentage: number | null;
  overall_cgpa: number | null;
  current_arrears: number;
  history_of_arrears: number;
  technical_skills: string | null;
  areas_of_interest: string | null;
  areas_of_expertise: string | null;
  projects: string | null;
  certifications: string | null;
  achievements: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  leetcode_url: string | null;
  hackerrank_url: string | null;
  consent_given_at: string | null;
  srf_submitted_at: string | null;
  srf_decided_at: string | null;
  srf_decided_by: string | null;
  srf_rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  programme_level: Enums["programme_level"];
  ug_aggregate_cgpa: number | null;
  srf_draft: Json | null;
  srf_draft_saved_at: string | null;
  ug_marksheet_id: string | null;
  tenth_institution: string | null;
  twelfth_institution: string | null;
  diploma_institution: string | null;
  diploma_marks: number | null;
  diploma_marks_scale: Enums["marks_scale"] | null;
  diploma_marksheet_id: string | null;
  ug_degree: string | null;
  ug_college: string | null;
  ug_branch: string | null;
  ug_aggregate_declared: number | null;
  ug_aggregate_scale: Enums["marks_scale"] | null;
  other_profiles: Json;
}

export type StudentsInsert = Pick<
  StudentsRow,
  "campus_id" | "degree_id" | "roll_number" | "full_name" | "email" | "passing_year"
> &
  Partial<
    Pick<
      StudentsRow,
      | "id"
      | "auth_user_id"
      | "branch_id"
      | "mobile"
      | "whatsapp"
      | "alternate_contact"
      | "srf_status"
      | "participation_status"
      | "tenth_percentage"
      | "twelfth_percentage"
      | "overall_cgpa"
      | "current_arrears"
      | "history_of_arrears"
      | "technical_skills"
      | "areas_of_interest"
      | "areas_of_expertise"
      | "projects"
      | "certifications"
      | "achievements"
      | "linkedin_url"
      | "github_url"
      | "leetcode_url"
      | "hackerrank_url"
      | "consent_given_at"
      | "srf_submitted_at"
      | "srf_decided_at"
      | "srf_decided_by"
      | "srf_rejection_reason"
      | "created_at"
      | "updated_at"
      | "programme_level"
      | "ug_aggregate_cgpa"
      | "srf_draft"
      | "srf_draft_saved_at"
      | "ug_marksheet_id"
      | "tenth_institution"
      | "twelfth_institution"
      | "diploma_institution"
      | "diploma_marks"
      | "diploma_marks_scale"
      | "diploma_marksheet_id"
      | "ug_degree"
      | "ug_college"
      | "ug_branch"
      | "ug_aggregate_declared"
      | "ug_aggregate_scale"
      | "other_profiles"
    >
  >;
