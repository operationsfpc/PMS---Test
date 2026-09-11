// Supabase Edge Function: email-dispatch
// Dispatches queued email_deliveries via Resend API

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "re_MnXJzytd_CnW2TvKLk5Dbv6FYPnDtMLfp";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "onboarding@resend.dev";
const EMAIL_OVERRIDE_RECIPIENT = Deno.env.get("EMAIL_OVERRIDE_RECIPIENT") || "thanush@faceprep.in";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Fetch up to 100 queued email_deliveries joining notifications
  const { data: deliveries, error: fetchError } = await supabase
    .from("email_deliveries")
    .select(`
      id,
      recipient_email,
      notification:notifications(
        id,
        title,
        body,
        student:students(full_name)
      )
    `)
    .eq("status", "queued")
    .limit(100);

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!deliveries || deliveries.length === 0) {
    return new Response(JSON.stringify({ message: "No queued deliveries to process." }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = [];

  // 2. Dispatch each delivery via Resend
  for (const delivery of deliveries) {
    const notif = delivery.notification as any;
    const title = notif?.title || "Placement Notification";
    const body = notif?.body || "";
    const studentName = notif?.student?.full_name || "Student";
    const originalEmail = delivery.recipient_email;

    // Direct all emails to thanush@faceprep.in in current test/dev mode
    const finalRecipient = EMAIL_OVERRIDE_RECIPIENT || originalEmail;

    const emailPayload = {
      from: RESEND_FROM_EMAIL,
      to: [finalRecipient],
      reply_to: "placements@faceprep.in",
      subject: title,
      text: `[Dev Routing: Intended for ${originalEmail}]\n\nDear ${studentName},\n\n${body}\n\nWarm regards,\nPlacement Cell, FACE Prep Campus`,
      html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <div style="background: #FFFBEB; border: 1px solid #FCD34D; color: #92400E; padding: 8px 12px; border-radius: 4px; font-size: 13px; margin-bottom: 16px;">
          <strong>Development Routing:</strong> Intended recipient was <code>${originalEmail}</code>
        </div>
        <h2 style="color: #3D3777;">${title}</h2>
        <p>Dear ${studentName},</p>
        <p style="white-space: pre-line; line-height: 1.5; background: #f9f9f9; padding: 12px; border-left: 3px solid #3D3777;">${body}</p>
        <p style="font-size: 12px; color: #666; margin-top: 24px;">FACE Prep Campus Placement Management System</p>
      </div>`,
    };

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      const resData = await res.json().catch(() => ({}));

      if (res.ok && resData?.id) {
        await supabase
          .from("email_deliveries")
          .update({
            status: "sent",
            provider_message_id: resData.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", delivery.id);

        results.push({ id: delivery.id, status: "sent", messageId: resData.id });
      } else {
        await supabase
          .from("email_deliveries")
          .update({
            status: "failed",
            error: resData?.message || `HTTP ${res.status}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", delivery.id);

        results.push({ id: delivery.id, status: "failed", error: resData?.message });
      }
    } catch (sendErr: any) {
      await supabase
        .from("email_deliveries")
        .update({
          status: "failed",
          error: sendErr.message || String(sendErr),
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);

      results.push({ id: delivery.id, status: "failed", error: sendErr.message });
    }
  }

  return new Response(JSON.stringify({ processed: deliveries.length, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
