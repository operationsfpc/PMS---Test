/**
 * R10 — Who may edit which profile field. PRD §4.3, §4.4; decision Q4.
 *
 * There is deliberately NO Admin-unlock request workflow. Coordinators edit
 * verified academic data directly and it saves instantly (audit-logged).
 * Students may never edit verified academic data — §7.2 requires eligibility to
 * be evaluated against verified data, so student-editable CGPA would make every
 * shortlist untrustworthy.
 */

export const EDITABLE_FIELDS = [
  // Free-form profile content
  "areas_of_interest",
  "areas_of_expertise",
  "certifications",
  "projects",
  "technical_skills",
  "achievements",
  "resumes",
  "professional_links",
  // Academic data, verified against marksheets
  "tenth_marks",
  "twelfth_marks",
  "degree",
  "branch",
  "verified_semester_data",
  "new_semester_data",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export type EditorRole =
  | "admin"
  | "student"
  | "campus_placement_coordinator"
  | "campus_manager"
  | "central_placement_coordinator"
  | "account_executive"
  | "delivery_head"
  | "key_account_manager"
  | "enterprise_relations"
  | "er_head"
  | "ceo";

export type Editability = "free" | "requires_cpc_verification" | "denied";

const STUDENT_FREE_FIELDS: readonly EditableField[] = [
  "areas_of_interest",
  "areas_of_expertise",
  "certifications",
  "projects",
  "technical_skills",
  "achievements",
  "resumes",
  "professional_links",
];

/** Roles that may verify marksheets and correct academic data. */
const VERIFYING_ROLES: readonly EditorRole[] = [
  "campus_placement_coordinator",
  "campus_manager",
  "central_placement_coordinator",
];

export function fieldEditability(field: EditableField, role: EditorRole): Editability {
  if (role === "admin") return "free";

  if (VERIFYING_ROLES.includes(role)) return "free";

  if (role === "student") {
    if (STUDENT_FREE_FIELDS.includes(field)) return "free";
    // New semester data is held pending until a coordinator checks it against
    // the uploaded marksheet (PRD §4.3).
    if (field === "new_semester_data") return "requires_cpc_verification";
    return "denied";
  }

  // Every other role is read-only with respect to student profiles.
  return "denied";
}
