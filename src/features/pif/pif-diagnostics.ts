import type { FieldErrors } from "react-hook-form";
import type { MultiRolePifValues } from "./pif-schema";

function formatIssue(prefix: string, message: string): string {
  let clean = message;

  if (/type the venue/i.test(message)) {
    clean = "Location details must be entered when venue is confirmed";
  } else if (/hours of the night shift/i.test(message)) {
    clean = "Shift timing details are missing for night shift";
  } else if (/name every (interview )?round/i.test(message)) {
    clean = "Every interview round must be given a title";
  } else if (/pdf/i.test(message)) {
    clean = "Attachment file type is invalid (PDF format required)";
  } else if (/joining/i.test(message) || /select a joining timeline/i.test(message)) {
    clean = "Select onboarding schedule (immediate or later)";
  } else if (/company name is required/i.test(message)) {
    clean = "Recruiter organization must be specified";
  } else if (/role title is required/i.test(message)) {
    clean = "Designation title must be specified";
  } else {
    clean = message
      .replace(/\s*is required\.?$/i, " must be specified")
      .replace(/\s*are required\.?$/i, " must be specified");
  }

  return `${prefix}: ${clean}`;
}

export function extractPifValidationIssues(
  errors: FieldErrors<MultiRolePifValues>,
): readonly string[] {
  const issues: string[] = [];

  if (errors.companyName?.message) {
    issues.push(formatIssue("Company", errors.companyName.message));
  }
  if (errors.companyWebsite?.message) {
    issues.push(formatIssue("Company website", errors.companyWebsite.message));
  }
  if (errors.driveMode?.message) {
    issues.push(formatIssue("Drive mode", errors.driveMode.message));
  }
  if (errors.tentativeDate?.message) {
    issues.push(formatIssue("Tentative drive date", errors.tentativeDate.message));
  }
  if (errors.joiningTimeline?.message) {
    issues.push(formatIssue("Joining timeline", errors.joiningTimeline.message));
  }
  if (errors.venue?.message) {
    issues.push(formatIssue("Venue", errors.venue.message));
  }

  // Check roles array
  const rawRoles = errors.roles as unknown;
  if (rawRoles && typeof rawRoles === "object") {
    const rolesObj = rawRoles as { root?: { message?: string }; message?: string };
    if (rolesObj.root?.message) {
      issues.push(rolesObj.root.message);
    } else if (rolesObj.message) {
      issues.push(rolesObj.message);
    }
  }

  if (Array.isArray(errors.roles)) {
    errors.roles.forEach((roleErr, index) => {
      if (!roleErr) return;
      const prefix = `Role ${index + 1}`;

      if (roleErr.roleTitle?.message) {
        issues.push(formatIssue(prefix, roleErr.roleTitle.message));
      }
      if (roleErr.driveType?.message) {
        issues.push(formatIssue(prefix, roleErr.driveType.message));
      }
      if (roleErr.roleCategory?.message) {
        issues.push(formatIssue(prefix, roleErr.roleCategory.message));
      }
      if (roleErr.openings?.message) {
        issues.push(formatIssue(prefix, roleErr.openings.message));
      }
      if (roleErr.workLocations?.message) {
        issues.push(formatIssue(prefix, roleErr.workLocations.message));
      }
      if (roleErr.ctcMinLpa?.message) {
        issues.push(formatIssue(prefix, roleErr.ctcMinLpa.message));
      }
      if (roleErr.ctcMaxLpa?.message) {
        issues.push(formatIssue(prefix, roleErr.ctcMaxLpa.message));
      }
      if (roleErr.stipendMinMonthly?.message) {
        issues.push(formatIssue(prefix, roleErr.stipendMinMonthly.message));
      }
      if (roleErr.stipendMaxMonthly?.message) {
        issues.push(formatIssue(prefix, roleErr.stipendMaxMonthly.message));
      }
      if (roleErr.eligiblePassingYears?.message) {
        issues.push(formatIssue(prefix, roleErr.eligiblePassingYears.message));
      }
      if (roleErr.rounds) {
        const roundsMsg = (roleErr.rounds as unknown as { message?: string }).message;
        if (roundsMsg) {
          issues.push(formatIssue(prefix, roundsMsg));
        } else if (Array.isArray(roleErr.rounds)) {
          issues.push(`${prefix}: Every interview round must be given a title.`);
        }
      }
      if (roleErr.shiftNightTiming?.message) {
        issues.push(formatIssue(prefix, roleErr.shiftNightTiming.message));
      }
      if (roleErr.additionalDesignations?.message) {
        issues.push(formatIssue(prefix, roleErr.additionalDesignations.message));
      }
      if (roleErr.jobDescriptionFile?.message) {
        issues.push(formatIssue(prefix, roleErr.jobDescriptionFile.message));
      }
    });
  }

  // Fallback if no specific messages were parsed
  if (issues.length === 0 && Object.keys(errors).length > 0) {
    issues.push(
      "Some required fields are missing or have invalid values. Please check all highlighted sections.",
    );
  }

  return issues;
}
