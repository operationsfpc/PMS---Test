import { composeNotificationEmail, composeStaffInviteEmail } from "../src/domain/email-delivery.ts";
import { ResendEmailProvider } from "../src/lib/email-service.ts";

const apiKey = "re_MnXJzytd_CnW2TvKLk5Dbv6FYPnDtMLfp";

async function runTest() {
  console.log("--- 1. Testing Domain Template Composition ---");
  const offerEmail = composeNotificationEmail({
    title: "Congratulations — Offer from Zoho (Super Dream)",
    body: "Zoho Corporation has extended you an offer for Software Development Engineer with a compensation package of 8.50 LPA.",
    recipientName: "Asha Devi",
    actionUrl: "https://faceprepcampus.com/student/notifications",
  });
  console.log("Offer Email Subject:", offerEmail.subject);
  console.log("Offer Email Text Snippet:\n", offerEmail.text.slice(0, 180) + "...\n");

  const staffInvite = composeStaffInviteEmail({
    email: "thanush@faceprep.in",
    fullName: "Thanush Krishna",
    roleName: "Central Placement Coordinator",
    campuses: ["All Campuses"],
    loginUrl: "https://faceprepcampus.com/login",
  });
  console.log("Staff Invite Subject:", staffInvite.subject);
  console.log("Staff Invite Text Snippet:\n", staffInvite.text.slice(0, 180) + "...\n");

  console.log("--- 2. Testing Provider Dispatch with Routing Override ---");
  // Test sending to operationsfpc@faceprep.in (the active verified sandbox owner)
  const provider = new ResendEmailProvider({
    apiKey,
    from: "onboarding@resend.dev",
    overrideRecipient: "operationsfpc@faceprep.in",
  });

  const sendResult = await provider.send({
    to: "student@example.edu", // Intended recipient
    subject: offerEmail.subject,
    text: offerEmail.text,
    html: offerEmail.html,
  });

  console.log("Provider Dispatch Result:", JSON.stringify(sendResult, null, 2));

  if (sendResult.success) {
    console.log("\n SUCCESS: Email was successfully accepted by Resend!");
    console.log(` Message ID: ${sendResult.id}`);
    console.log(` Routed To: ${sendResult.recipient}`);
  } else {
    console.log("\n FAILED:", sendResult.error);
  }
}

runTest().catch(console.error);
