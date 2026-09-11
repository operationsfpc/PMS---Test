import { describe, expect, it } from "vitest";
import {
  type EmailDeliveryStatus,
  applyDeliveryEvent,
  composeNotificationEmail,
  composeStaffInviteEmail,
  isRecipientAllowed,
  resolveRecipient,
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
  it("formats subject, plain text, and HTML with brand tokens", () => {
    const email = composeNotificationEmail({
      title: "You are shortlisted for Zoho",
      body: "Round 1 is scheduled for 10:00 AM IST.",
      recipientName: "Asha Devi",
      actionUrl: "https://faceprepcampus.com/student/drives/d1",
    });

    expect(email.subject).toBe("You are shortlisted for Zoho");
    expect(email.text).toContain("Dear Asha Devi,");
    expect(email.text).toContain("Round 1 is scheduled for 10:00 AM IST.");
    expect(email.text).toContain("https://faceprepcampus.com/student/drives/d1");
    expect(email.html).toContain("FACE Prep Campus");
    expect(email.html).toContain("#3D3777");
    expect(email.html).toContain("https://faceprepcampus.com/student/drives/d1");
  });

  it("handles missing recipientName and missing actionUrl cleanly", () => {
    const email = composeNotificationEmail({
      title: "Round Schedule",
      body: "Venue is Auditorium A.",
    });

    expect(email.subject).toBe("Round Schedule");
    expect(email.text).toContain("Dear Candidate,");
    expect(email.text).toContain("Venue is Auditorium A.");
    expect(email.html).toContain("Venue is Auditorium A.");
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
  });
});
