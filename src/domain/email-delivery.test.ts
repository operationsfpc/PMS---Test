import { describe, expect, it } from "vitest";
import {
  type EmailDeliveryStatus,
  applyDeliveryEvent,
  composeNotificationEmail,
  composeStaffInviteEmail,
  composeStudentNotificationEmail,
  formatRoleName,
  isRecipientAllowed,
  resolveDisplayName,
  resolveRecipient,
  resolveTemplateRouting,
  toEmailBatches,
} from "./email-delivery";

describe("email delivery state machine (applyDeliveryEvent)", () => {
  it("progresses queued -> sent -> delivered", () => {
    expect(applyDeliveryEvent("queued", "sent")).toBe("sent");
    expect(applyDeliveryEvent("sent", "delivered")).toBe("delivered");
  });

  it("progresses sent -> bounced, complained, or failed", () => {
    expect(applyDeliveryEvent("sent", "bounced")).toBe("bounced");
    expect(applyDeliveryEvent("sent", "complained")).toBe("complained");
    expect(applyDeliveryEvent("sent", "failed")).toBe("failed");
  });

  it("handles delayed state without losing progression to delivered", () => {
    expect(applyDeliveryEvent("sent", "delayed")).toBe("delayed");
    expect(applyDeliveryEvent("delayed", "delivered")).toBe("delivered");
    expect(applyDeliveryEvent("delayed", "bounced")).toBe("bounced");
  });

  it("never regresses a terminal delivered state", () => {
    expect(applyDeliveryEvent("delivered", "delayed")).toBe("delivered");
    expect(applyDeliveryEvent("delivered", "sent")).toBe("delivered");
    expect(applyDeliveryEvent("delivered", "failed")).toBe("delivered");
  });

  it("never regresses bounced or complained", () => {
    expect(applyDeliveryEvent("bounced", "delivered")).toBe("bounced");
    expect(applyDeliveryEvent("bounced", "sent")).toBe("bounced");
    expect(applyDeliveryEvent("complained", "delivered")).toBe("complained");
  });

  it("is idempotent on receiving the same event", () => {
    const states: EmailDeliveryStatus[] = [
      "queued",
      "sent",
      "delivered",
      "delayed",
      "bounced",
      "complained",
      "failed",
    ];
    for (const s of states) {
      if (s !== "queued") {
        expect(applyDeliveryEvent(s, s as any)).toBe(s);
      }
    }
  });
});

describe("batching deliveries (toEmailBatches)", () => {
  it("splits items into chunks of specified batch size (default 100)", () => {
    const items = Array.from({ length: 250 }, (_, i) => `item-${i}`);
    const batches = toEmailBatches(items, 100);

    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(100);
    expect(batches[1]).toHaveLength(100);
    expect(batches[2]).toHaveLength(50);
  });

  it("returns empty array for empty input", () => {
    expect(toEmailBatches([], 100)).toEqual([]);
  });

  it("handles inputs smaller than batch size in a single chunk", () => {
    const items = [1, 2, 3];
    expect(toEmailBatches(items, 10)).toEqual([[1, 2, 3]]);
  });

  it("falls back to batchSize 100 if invalid size provided", () => {
    const items = [1, 2, 3];
    expect(toEmailBatches(items, 0)).toEqual([[1, 2, 3]]);
    expect(toEmailBatches(items, -5)).toEqual([[1, 2, 3]]);
  });
});

describe("recipient allowlist and override guards", () => {
  it("allows all emails when allowlist is undefined, null, or empty", () => {
    expect(isRecipientAllowed("student@example.com")).toBe(true);
    expect(isRecipientAllowed("student@example.com", null)).toBe(true);
    expect(isRecipientAllowed("student@example.com", [])).toBe(true);
  });

  it("matches case-insensitively and trims whitespace", () => {
    const allowlist = ["tester@faceprep.in", "admin@faceprep.in"];
    expect(isRecipientAllowed("Tester@faceprep.in", allowlist)).toBe(true);
    expect(isRecipientAllowed("  admin@faceprep.in  ", allowlist)).toBe(true);
    expect(isRecipientAllowed("random@other.com", allowlist)).toBe(false);
  });

  it("overrides recipient when overrideEmail is set", () => {
    const res = resolveRecipient("student@college.edu", "thanush@faceprep.in");
    expect(res.to).toBe("thanush@faceprep.in");
    expect(res.originalRecipient).toBe("student@college.edu");
    expect(res.isOverridden).toBe(true);
  });

  it("keeps original recipient when overrideEmail is not set or empty", () => {
    const res = resolveRecipient("student@college.edu");
    expect(res.to).toBe("student@college.edu");
    expect(res.originalRecipient).toBe("student@college.edu");
    expect(res.isOverridden).toBe(false);
  });
});


describe("composing notification email (composeNotificationEmail)", () => {
  it("formats subject, plain text, and HTML exactly according to the canonical HTML template in docs/email-templates-preview.html", () => {
    const email = composeNotificationEmail({
      subject: "Welcome to FACE Prep Campus Placements — Complete Your Profile",
      title: "Complete Your Placement Profile",
      subtitle: "Please fill in all the required details to complete your placement profile.",
      body: "Your placement account for **Kamaraj College** is now active.\n\n• **Roll Number:** 2026CS101",
      recipientName: "Asha Devi",
      actionUrl: "https://fpc-pms.faceprep.workers.dev/srf",
      actionButtonText: "Complete Registration",
    });

    expect(email.subject).toBe("Welcome to FACE Prep Campus Placements — Complete Your Profile");
    expect(email.text).toContain("Dear Asha Devi,");
    expect(email.text).toContain("Your placement account for Kamaraj College is now active.");
    expect(email.text).toContain("Complete Registration: https://fpc-pms.faceprep.workers.dev/srf");

    // Canonical HTML tokens from docs/email-templates-preview.html
    expect(email.html).toContain('style="height:4px;background:#ffb800;font-size:4px;line-height:4px;"');
    expect(email.html).toContain('background:#3d3777;');
    expect(email.html).toContain("https://pms.faceprepcampus.com/brand/faceprep-campus-light.png");
    expect(email.html).toContain("Placement Management System");
    expect(email.html).toContain('<h1 style="margin:0 0 6px;color:#151228;font-size:22px;font-weight:700;line-height:1.3;">Complete Your Placement Profile</h1>');
    expect(email.html).toContain('<p style="margin:0 0 18px;color:#64748b;font-size:14.5px;line-height:1.5;">Please fill in all the required details to complete your placement profile.</p>');
    expect(email.html).toContain('Dear <strong style="color:#151228;">Asha Devi</strong>,');
    expect(email.html).toContain('<strong style="color: #151228;">Kamaraj College</strong>');
    expect(email.html).toContain('<strong style="color: #151228;">Roll Number:</strong>');
    expect(email.html).toContain("Complete Registration &rarr;");
    expect(email.html).toContain('href="https://fpc-pms.faceprep.workers.dev/srf"');
    expect(email.html).toContain("Placement Cell,");
    expect(email.html).toContain("FACE Prep Campus &bull; Focus 4D Career Education Pvt Ltd");
    expect(email.html).toContain("hello@faceprep.in");
  });

  it("handles missing recipientName, missing subtitle, and missing actionUrl cleanly", () => {
    const email = composeNotificationEmail({
      title: "Round Schedule",
      body: "Venue is Auditorium A.",
    });

    expect(email.subject).toBe("Round Schedule");
    expect(email.text).toContain("Dear Candidate,");
    expect(email.text).toContain("Venue is Auditorium A.");
    expect(email.html).toContain("Venue is Auditorium A.");
    expect(email.html).not.toContain("&rarr;");
    expect(email.html).not.toContain("<p style=\"margin:0 0 18px;color:#64748b;");
  });
});

describe("composing student notification email (composeStudentNotificationEmail)", () => {
  const portal = "https://fpc-pms.faceprep.workers.dev";

  it("maps S3 shortlisted notifications correctly", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "shortlisted",
        title: "You are shortlisted for Zoho",
        body: "You are on the shortlist for Zoho. Round 1 is next.",
        recipientName: "Asha Devi",
      },
      portal,
    );

    expect(email.subject).toBe("You are shortlisted for Zoho");
    expect(email.html).toContain("You Are Shortlisted");
    expect(email.html).toContain("View Application Status &rarr;");
    expect(email.html).toContain(`${portal}/student/drives`);
  });

  it("maps S4 round_scheduled notifications correctly", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "round_scheduled",
        title: "Zoho — Round 1 schedule",
        body: "Round 1 (Technical Assessment) is scheduled for 12 Sep 2026, 10:00 AM IST.",
        recipientName: "Asha Devi",
      },
      portal,
    );

    expect(email.subject).toBe("Zoho — Round 1 schedule");
    expect(email.html).toContain("Round Schedule Released");
    expect(email.html).toContain("View Drive Dashboard &rarr;");
    expect(email.html).toContain(`${portal}/student/drives`);
  });

  it("maps S5 meeting_link notifications correctly and extracts the meeting link", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "meeting_link",
        title: "Zoho — your Round 2 slot",
        body: "Your Round 2 is at 12 Sep 2026, 02:30 PM IST. Your meeting link: https://meet.google.com/xyz-face-prep. Please report on time.",
        recipientName: "Asha Devi",
      },
      portal,
    );

    expect(email.subject).toBe("Zoho — your Round 2 slot");
    expect(email.html).toContain("Interview Slot Scheduled");
    expect(email.html).toContain("Join Interview Room &rarr;");
    expect(email.html).toContain('href="https://meet.google.com/xyz-face-prep"');
  });

  it("maps S6 round_cleared and S7 round_not_selected correctly", () => {
    const cleared = composeStudentNotificationEmail(
      {
        kind: "round_cleared",
        title: "You cleared Round 1 of Zoho",
        body: "Well done — you advance from Round 1 of Zoho.",
        recipientName: "Asha Devi",
      },
      portal,
    );
    expect(cleared.html).toContain("Round Cleared");
    expect(cleared.html).toContain("View Drive Progress &rarr;");
    expect(cleared.html).toContain(`${portal}/student/drives`);

    const rejected = composeStudentNotificationEmail(
      {
        kind: "round_not_selected",
        title: "Round 1 of Zoho: not selected",
        body: "You were not selected in Round 1 of Zoho.",
        recipientName: "Asha Devi",
      },
      portal,
    );
    expect(rejected.html).toContain("Application Status Update");
    expect(rejected.html).toContain("Explore Open Drives &rarr;");
    expect(rejected.html).toContain(`${portal}/student/drives`);
  });

  it("maps S8 offer notifications correctly", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "offer",
        title: "Offer from Zoho Corporation",
        body: "Congratulations — Zoho Corporation has made you an offer (Super Dream).",
        recipientName: "Asha Devi",
      },
      portal,
    );

    expect(email.subject).toBe("Offer from Zoho Corporation");
    expect(email.html).toContain("Placement Offer Extended");
    expect(email.html).toContain("View Offer &amp; Letter &rarr;");
    expect(email.html).toContain(`${portal}/student/notifications`);
  });

  it("maps S9 absent and S10 srf_rejected notifications correctly", () => {
    const absent = composeStudentNotificationEmail(
      {
        kind: "absent",
        title: "Marked absent: Zoho — Technical Assessment",
        body: "You were marked absent for Technical Assessment of Zoho.",
        recipientName: "Asha Devi",
      },
      portal,
    );
    expect(absent.html).toContain("Absence Recorded");
    expect(absent.html).toContain("View Attendance Record &rarr;");
    expect(absent.html).toContain(`${portal}/student`);

    const srfRejected = composeStudentNotificationEmail(
      {
        kind: "srf_rejected",
        title: "Your registration form was sent back for changes",
        body: "Arrear history is incorrect. Open your registration form to correct it and submit it again.",
        recipientName: "Asha Devi",
      },
      portal,
    );
    expect(srfRejected.html).toContain("Registration Form Requires Changes");
    expect(srfRejected.html).toContain("Open Registration Form &rarr;");
    expect(srfRejected.html).toContain(`${portal}/srf`);
  });

  it("maps S1 welcome, S2 drive_published, and S14 srf_approved notifications correctly", () => {
    const welcome = composeStudentNotificationEmail(
      {
        kind: "welcome",
        title: "Welcome to FACE Prep Campus Placements — Complete Your Profile",
        body: "Your placement account for Kamaraj College is active.",
        recipientName: "Asha Devi",
      },
      portal,
    );
    expect(welcome.html).toContain("Complete Your Placement Profile");
    expect(welcome.html).toContain("Complete Registration &rarr;");
    expect(welcome.html).toContain(`${portal}/srf`);

    const drive = composeStudentNotificationEmail(
      {
        kind: "drive_published",
        title: "New Drive: Zoho Corporation is Hiring for Software Development Engineer",
        body: "Zoho Corporation is hiring for Software Development Engineer.",
        recipientName: "Asha Devi",
      },
      portal,
    );
    expect(drive.html).toContain("New Placement Drive Announced");
    expect(drive.html).toContain("View Drive &amp; Apply &rarr;");
    expect(drive.html).toContain(`${portal}/student/drives`);

    const approved = composeStudentNotificationEmail(
      {
        kind: "srf_approved",
        title: "Profile Verified: You Are Now Eligible for Placement Drives",
        body: "Your SRF and marksheets have been verified and approved.",
        recipientName: "Asha Devi",
      },
      portal,
    );
    expect(approved.html).toContain("Placement Profile Approved");
    expect(approved.html).toContain("Explore Open Drives &rarr;");
    expect(approved.html).toContain(`${portal}/student/drives`);

    const digest = composeStudentNotificationEmail(
      {
        kind: "verification_digest",
        title: "Verification Queue: 22 Student Profiles Awaiting Approval",
        body: "Prompt verification ensures these students become eligible for recruitment drives.",
        recipientName: "Dr. K. Ramanathan",
      },
      portal,
    );
    expect(digest.html).toContain("Student Profiles Pending Verification");
    expect(digest.html).toContain("Open Verification Queue &rarr;");
    expect(digest.html).toContain(`${portal}/cpc/verification`);
  });

  it("handles unknown or arbitrary notification kinds with safe fallback", () => {
    const custom = composeStudentNotificationEmail(
      {
        kind: "custom_announcement",
        title: "Campus Placement Update",
        body: "Please attend the pre-placement talk.",
        recipientName: "Asha Devi",
      },
      portal,
    );
    expect(custom.subject).toBe("Campus Placement Update");
    expect(custom.html).toContain("Campus Placement Update");
    expect(custom.html).toContain("View on PMS Portal &rarr;");
    expect(custom.html).toContain(`${portal}/student`);
  });

  it("handles meeting_link without embedded URL and uses fallback drives URL", () => {
    const meetingWithoutLink = composeStudentNotificationEmail(
      {
        kind: "meeting_link",
        title: "Interview Slot",
        body: "Your interview is at 10 AM in Lab 1.",
      },
      portal,
    );
    expect(meetingWithoutLink.html).toContain(`${portal}/student/drives`);
    expect(meetingWithoutLink.html).toContain("Join Interview Room &rarr;");
  });

  it("uses default portal URL when portal argument is omitted", () => {
    const welcome = composeStudentNotificationEmail({
      kind: "welcome",
      title: "",
      body: "Welcome student.",
    });
    expect(welcome.subject).toBe("Welcome to FACE Prep Campus Placements — Complete Your Profile");
    expect(welcome.html).toContain("https://pms.faceprepcampus.com/srf");
  });

  it("uses default title for srf_approved when title is empty", () => {
    const approved = composeStudentNotificationEmail({
      kind: "srf_approved",
      title: "",
      body: "Your profile is approved.",
    });
    expect(approved.subject).toBe("Profile Verified: You Are Now Eligible for Placement Drives");
  });

  it("uses default View on PMS Portal button text when actionButtonText is omitted with actionUrl", () => {
    const email = composeNotificationEmail({
      title: "Notice",
      body: "Check portal",
      actionUrl: "https://example.com/check",
    });
    expect(email.html).toContain("View on PMS Portal &rarr;");
  });
});

describe("composing staff invite email (composeStaffInviteEmail)", () => {
  it("formats staff invite with role and assigned campuses", () => {
    const email = composeStaffInviteEmail({
      email: "karthik@faceprep.in",
      fullName: "R Karthik",
      roleName: "Campus Placement Coordinator",
      campuses: ["Kamaraj College", "SDNB Vaishnav"],
      loginUrl: "https://faceprepcampus.com/login",
    });

    expect(email.subject).toContain("Invitation to FACE Prep Campus PMS");
    expect(email.text).toContain("Hello R Karthik,");
    expect(email.text).toContain("Campus Placement Coordinator");
    expect(email.text).toContain("Kamaraj College, SDNB Vaishnav");
    expect(email.text).toContain("https://faceprepcampus.com/login");
    expect(email.html).toContain("Campus Placement Coordinator");
    expect(email.html).toContain("https://faceprepcampus.com/login");
  });

  it("handles staff without assigned campuses cleanly", () => {
    const email = composeStaffInviteEmail({
      email: "admin@faceprep.in",
      fullName: "System Admin",
      roleName: "Administrator",
    });

    expect(email.text).toContain("Administrator");
    expect(email.text).toContain("All Campuses (Organisation-wide)");
    expect(email.html).toContain("https://pms.faceprepcampus.com/login");
  });
});

describe("role and display name resolution", () => {
  it("formats role names nicely", () => {
    expect(formatRoleName("campus_placement_coordinator")).toBe("Campus Placement Coordinator");
    expect(formatRoleName("central_placement_coordinator")).toBe("Central Placement Coordinator");
    expect(formatRoleName("admin")).toBe("System Administrator");
    expect(formatRoleName("student")).toBe("Student");
    expect(formatRoleName("unknown_custom_role")).toBe("Unknown Custom Role");
    expect(formatRoleName("")).toBe("");
    expect(formatRoleName(undefined)).toBe("");
  });

  it("resolves display names with role for staff and clean name for students", () => {
    expect(resolveDisplayName("Dr. K. Ramanathan", "campus_placement_coordinator")).toBe(
      "Dr. K. Ramanathan (Campus Placement Coordinator)",
    );
    expect(resolveDisplayName("Radhika", "student")).toBe("Radhika");
    expect(resolveDisplayName("Radhika")).toBe("Radhika");
    expect(resolveDisplayName("", "campus_placement_coordinator")).toBe("Campus Placement Coordinator");
    expect(resolveDisplayName("", "")).toBe("Candidate");
  });
});

describe("coordinator notification emails (C1 through C7)", () => {
  const portal = "https://pms.faceprepcampus.com";

  it("composes C1 campus drive alert correctly", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "campus_drive_alert",
        title: "New Drive Live for Kamaraj College: Zoho Corporation",
        body: "A new placement drive has been published.",
        recipientName: "Dr. K. Ramanathan",
        roleName: "campus_placement_coordinator",
      },
      portal,
    );
    expect(email.html).toContain("New Campus Placement Drive Active");
    expect(email.html).toContain("View Drive Cohort &rarr;");
    expect(email.html).toContain(`${portal}/cpc/drives`);
    expect(email.html).toContain("Dear <strong style=\"color:#151228;\">Dr. K. Ramanathan (Campus Placement Coordinator)</strong>");
  });

  it("composes C2 campus shortlist ready correctly", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "campus_shortlist_ready",
        title: "Shortlist Published: Zoho Corporation",
        body: "The candidate shortlist has been finalized.",
        recipientName: "Dr. K. Ramanathan",
        roleName: "campus_placement_coordinator",
      },
      portal,
    );
    expect(email.html).toContain("Campus Candidate Shortlist Released");
    expect(email.html).toContain("View Shortlisted Roster &rarr;");
    expect(email.html).toContain(`${portal}/cpc/drives`);
  });

  it("composes C3 verification queue digest with verified wording", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "verification_queue_digest",
        title: "Verification Queue: 22 Student Profiles Awaiting Approval",
        body: "Prompt verification ensures these students become eligible for recruitment drives.",
        recipientName: "Dr. K. Ramanathan",
        roleName: "campus_placement_coordinator",
      },
      portal,
    );
    expect(email.html).toContain("Student Profiles Pending Verification");
    expect(email.html).toContain("Open Verification Queue &rarr;");
    expect(email.html).toContain(`${portal}/cpc/verification`);
    expect(email.html).toContain("Prompt verification ensures these students become eligible for recruitment drives.");
  });

  it("composes C4 semester pending verification with verified wording", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "semester_pending_verification",
        title: "New Semester Added: Keerthana S (E24AI020) Pending Verification",
        body: "Please verify the declared score against the uploaded marksheet document.",
        recipientName: "Dr. K. Ramanathan",
        roleName: "campus_placement_coordinator",
      },
      portal,
    );
    expect(email.html).toContain("Semester Record Pending Verification");
    expect(email.html).toContain("Verify Semester Record &rarr;");
    expect(email.html).toContain(`${portal}/cpc/semesters`);
    expect(email.html).toContain("Please verify the declared score against the uploaded marksheet document.");
  });

  it("composes C5 attendance pending submission", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "attendance_pending",
        title: "Action Required: Mark Attendance for Zoho Corporation",
        body: "Please mark attendance.",
        recipientName: "Dr. K. Ramanathan",
      },
      portal,
    );
    expect(email.html).toContain("Round Attendance Pending Submission");
    expect(email.html).toContain("Mark Round Attendance &rarr;");
    expect(email.html).toContain(`${portal}/cpc/attendance`);
  });

  it("composes C6 campus student placed", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "campus_student_placed",
        title: "Placement Success: Keerthana S Placed at Zoho Corporation (₹8.50 LPA)",
        body: "Congratulations! A candidate from your campus has secured a placement offer.\n\n**Placement Summary**\n• **Student:** Keerthana S (E24AI020)\n• **Degree & Branch:** B.Sc Computer Science with AI\n• **Company:** Zoho Corporation\n• **Role:** Software Development Engineer\n• **Offer Category:** Super Dream (₹8.50 LPA)",
        recipientName: "Dr. K. Ramanathan",
      },
      portal,
    );
    expect(email.html).toContain("Campus Student Placement");
    expect(email.html).not.toContain("Campus Student Placement Confirmed");
    expect(email.html).not.toContain("confirmed placement offer");
    expect(email.html).not.toContain("The offer letter has been archived");
    expect(email.html).toContain("View Drive Progress &rarr;");
    expect(email.html).toContain(`${portal}/cpc/drives`);
  });

  it("composes C7 off-campus offer proof with complete submission", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "off_campus_offer_proof",
        title: "Action Required: Off-Campus Placement Proof Submitted by Asha Devi",
        body: "A student has submitted an external off-campus placement offer letter for institutional verification.\n\n• **Student:** Asha Devi (2026CS101)\n• **Company:** Freshworks Inc\n• **Declared Role:** Product Operations Associate\n• **Declared CTC:** ₹6.50 LPA\n\nPlease inspect the uploaded offer letter and complete submission.",
        recipientName: "Dr. K. Ramanathan",
      },
      portal,
    );
    expect(email.html).toContain("Off-Campus Offer Verification Required");
    expect(email.html).toContain("Review Off-Campus Queue &rarr;");
    expect(email.html).toContain(`${portal}/cpc/off-campus`);
    expect(email.html).toContain("Please inspect the uploaded offer letter and complete submission.");
    expect(email.html).not.toContain("verify or reject");
  });
});

describe("central coordinator notification emails (CP1 through CP4)", () => {
  const portal = "https://pms.faceprepcampus.com";

  it("composes CP1 drive approved", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "drive_approved",
        title: "Placement Drive Approved",
        body: "The PIF has been approved.",
        recipientName: "Central Placement Coordinator",
      },
      portal,
    );
    expect(email.html).toContain("Placement Drive Approved");
    expect(email.html).toContain("Configure &amp; Publish &rarr;");
    expect(email.html).toContain(`${portal}/central/drives/yet-to-publish`);
  });

  it("composes CP2 applications closed with per-campus breakdown", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "applications_closed",
        title: "Drive Applications Closed",
        body: "The student application deadline for **Zoho Corporation** (**Software Development Engineer**) has passed.\n\n**Application Summary**\n• **Total Applicants:** 148 candidates\n• **Campus Breakdown:**\n  – Kamaraj College: 84 applicants\n  – SDNB Vaishnav College: 64 applicants\n• **Drive Category:** Super Dream (₹8.50 LPA)\n• **Next Step:** Review criteria, filter candidates, and lock shortlist\n\nPlease proceed to candidate screening to generate the verified shortlist.",
        recipientName: "Central Placement Coordinator",
      },
      portal,
    );
    expect(email.html).toContain("Drive Applications Closed");
    expect(email.html).toContain("Open Shortlisting Console &rarr;");
    expect(email.html).toContain(`${portal}/central/shortlisting`);
    expect(email.html).toContain("Kamaraj College: 84 applicants");
    expect(email.html).toContain("SDNB Vaishnav College: 64 applicants");
  });

  it("composes CP3 round attendance finalized", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "round_attendance_finalized",
        title: "Round Attendance Finalized",
        body: "Attendance marked.",
        recipientName: "Central Placement Coordinator",
      },
      portal,
    );
    expect(email.html).toContain("Round Attendance Finalized");
    expect(email.html).toContain("Enter Round Results &rarr;");
    expect(email.html).toContain(`${portal}/central/results`);
  });

  it("composes CP4 all rounds completed", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "all_rounds_completed",
        title: "Placement Drive Completed",
        body: "All scheduled interview rounds for **Zoho Corporation** (**Software Development Engineer**) have concluded.\n\n**Selection Summary**\n• **Total Rounds Completed:** 3 rounds\n• **Selected Candidates:** 6 candidates\n• **Next Step:** Upload formal offer letters and release offers to students\n\nPlease review the final select list and issue offers.",
        recipientName: "Central Placement Coordinator",
      },
      portal,
    );
    expect(email.html).toContain("Placement Drive Completed");
    expect(email.html).toContain("Issue Placement Offers &rarr;");
    expect(email.html).toContain(`${portal}/central/offers`);
    expect(email.html).toContain("Please review the final select list and issue offers.");
    expect(email.html).not.toContain("on the offers console");
  });
});

describe("account executive notification emails (A1 through A3)", () => {
  const portal = "https://pms.faceprepcampus.com";

  it("composes A1 PIF approved", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "pif_approved",
        title: "Placement Initiation Form Approved",
        body: "The Placement Initiation Form (PIF) you drafted for **Zoho Corporation** has been reviewed and approved by the Delivery Head.\n\n**Approved Details**\n• **Company:** Zoho Corporation\n• **Role:** Software Development Engineer\n• **Category Assigned:** Super Dream (₹8.50 LPA)\n• **Next Stage:** Central CPC is configuring rounds and targeting\n\nThe account is progressing to live candidate sourcing.",
        recipientName: "Anil Kumar",
      },
      portal,
    );
    expect(email.html).toContain("Placement Initiation Form Approved");
    expect(email.html).toContain("View Sourced Drives &rarr;");
    expect(email.html).toContain(`${portal}/my-drives`);
  });

  it("composes A2 PIF revision requested", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "pif_revision_requested",
        title: "PIF Requires Changes",
        body: "The Delivery Head has reviewed the Placement Initiation Form (PIF) for **Zoho Corporation** and requested clarifications before approval.",
        recipientName: "Anil Kumar",
      },
      portal,
    );
    expect(email.html).toContain("PIF Requires Changes");
    expect(email.html).toContain("Revise PIF Details &rarr;");
    expect(email.html).toContain(`${portal}/ae/pif`);
  });

  it("composes A3 drive live to students without the word partner", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "drive_live_ae",
        title: "Placement Drive Published",
        body: "The recruitment drive for **Zoho Corporation** (**Software Development Engineer**) is now live across campuses.\n\n• **Eligible Cohort:** 320 candidates across 2 institutions\n• **Application Window:** Closes 10 Sep 2026, 6:00 PM IST\n\nYou can track applicant inflow and corporate milestones from your AE Overview.",
        recipientName: "Anil Kumar",
      },
      portal,
    );
    expect(email.html).toContain("Placement Drive Published");
    expect(email.html).toContain("View Account Overview &rarr;");
    expect(email.html).toContain(`${portal}/ae/overview`);
    expect(email.html).toContain("live across campuses");
    expect(email.html).not.toContain("partner campuses");
  });
});

describe("delivery head notification emails (DH1 through DH3)", () => {
  const portal = "https://pms.faceprepcampus.com";

  it("composes DH1 PIF submitted for review", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "pif_submitted",
        title: "Placement Initiation Form Under Review",
        body: "A new Placement Initiation Form (PIF) has been submitted and is ready for governance review.",
        recipientName: "Delivery Head",
      },
      portal,
    );
    expect(email.html).toContain("Placement Initiation Form Under Review");
    expect(email.html).toContain("Open PIF Approvals &rarr;");
    expect(email.html).toContain(`${portal}/delivery-head/pif-approvals`);
  });

  it("composes DH2 policy override alert", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "policy_override_requested",
        title: "Placement Policy Override Request",
        body: "A placement policy override has been requested for candidate eligibility.",
        recipientName: "Delivery Head",
      },
      portal,
    );
    expect(email.html).toContain("Placement Policy Override Request");
    expect(email.html).toContain("Review Policy Override &rarr;");
    expect(email.html).toContain(`${portal}/delivery-head/pif-approvals`);
  });

  it("composes DH3 weekly operations digest", () => {
    const email = composeStudentNotificationEmail(
      {
        kind: "weekly_operations_digest",
        title: "Weekly Placement Operations Summary",
        body: "Here is the weekly executive operations summary across all institutions.",
        recipientName: "Delivery Head",
      },
      portal,
    );
    expect(email.html).toContain("Weekly Placement Operations Summary");
    expect(email.html).toContain("Open Operations Cockpit &rarr;");
    expect(email.html).toContain(`${portal}/dashboard`);
  });
});

describe("recipient and CC routing verification (resolveTemplateRouting)", () => {
  it("routes S5 (meeting_link) to student with campus_placement_coordinator in CC (no interview host)", () => {
    const routing = resolveTemplateRouting("meeting_link");
    expect(routing.templateCode).toBe("S5");
    expect(routing.targetRole).toBe("student");
    expect(routing.ccRoles).toEqual(["campus_placement_coordinator"]);
  });

  it("routes S7 (round_not_selected) to student with campus_placement_coordinator in CC (not private)", () => {
    const routing = resolveTemplateRouting("round_not_selected");
    expect(routing.templateCode).toBe("S7");
    expect(routing.targetRole).toBe("student");
    expect(routing.ccRoles).toEqual(["campus_placement_coordinator"]);
  });

  it("routes CP4 (all_rounds_completed) to central_placement_coordinator with DH, AE, and CPC in CC", () => {
    const routing = resolveTemplateRouting("all_rounds_completed");
    expect(routing.templateCode).toBe("CP4");
    expect(routing.targetRole).toBe("central_placement_coordinator");
    expect(routing.ccRoles).toEqual([
      "delivery_head",
      "account_executive",
      "campus_placement_coordinator",
    ]);
  });

  it("attaches routing metadata directly to composeStudentNotificationEmail output", () => {
    const email = composeStudentNotificationEmail({
      kind: "all_rounds_completed",
      title: "Placement Drive Completed",
      body: "All scheduled rounds completed.",
    });
    expect(email.templateCode).toBe("CP4");
    expect(email.targetRole).toBe("central_placement_coordinator");
    expect(email.ccRoles).toEqual([
      "delivery_head",
      "account_executive",
      "campus_placement_coordinator",
    ]);
  });

  it("attaches AD1 metadata to composeStaffInviteEmail output", () => {
    const invite = composeStaffInviteEmail({
      email: "cpc@college.edu",
      fullName: "Dr. Ramanathan",
      roleName: "Campus Placement Coordinator",
    });
    expect(invite.templateCode).toBe("AD1");
    expect(invite.targetRole).toBe("Campus Placement Coordinator");
    expect(invite.ccRoles).toEqual(["admin"]);
  });
});




