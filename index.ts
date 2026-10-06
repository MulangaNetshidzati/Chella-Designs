import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Generates a cryptographically secure 6-digit OTP
function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const code = (array[0] % 900000) + 100000;
  return code.toString();
}

// Professional HTML email template with OTP, website link, and business info
function getOtpEmailTemplate(otpCode: string, siteUrl: string, businessName: string, supportEmail: string): string {
  const currentYear = new Date().getFullYear();
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email - ${businessName}</title>
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f9f9f9; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); overflow: hidden; }
    .header { background: linear-gradient(135deg, #ec4899, #a855f7); padding: 30px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 24px; margin: 0; font-weight: 600; }
    .content { padding: 40px; text-align: center; }
    .otp-code { background-color: #f3f4f6; border-radius: 8px; padding: 20px; margin: 24px 0; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #ec4899; font-family: 'Courier New', monospace; }
    .button { display: inline-block; background: linear-gradient(135deg, #ec4899, #a855f7); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 50px; font-weight: 600; margin: 20px 0; }
    .info-box { background-color: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; margin: 24px 0; text-align: left; border-radius: 8px; }
    .info-box p { margin: 4px 0; color: #374151; font-size: 14px; }
    .footer { background-color: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer p { color: #6b7280; font-size: 12px; margin: 4px 0; }
    .expiry-warning { color: #dc2626; font-size: 13px; font-weight: 500; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>✨ ${businessName}</h1></div>
    <div class="content">
      <h2 style="color: #1f2937; font-size: 22px; margin-bottom: 8px;">Verify Your Email Address</h2>
      <p style="color: #6b7280; font-size: 15px; margin-bottom: 20px;">Thank you for choosing ${businessName}. Use the code below to complete your verification.</p>
      <div class="otp-code">${otpCode}</div>
      <p class="expiry-warning">⏰ This code expires in 5 minutes</p>
      <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">Or click the button below to visit our website:</p>
      <a href="${siteUrl}" class="button">Visit ${businessName}</a>
      <div class="info-box">
        <p><strong>📞 Phone:</strong> 083 413 5617</p>
        <p><strong>✉️ Email:</strong> ${supportEmail}</p>
        <p><strong>🕘 Hours:</strong> Mon - Fri, 09:00 - 17:00</p>
        <p><strong>📍 Location:</strong> Cape Town, South Africa</p>
      </div>
      <p style="color: #9ca3af; font-size: 13px; margin-top: 20px;">If you didn't request this code, you can safely ignore this email.</p>
    </div>
    <div class="footer">
      <p>&copy; ${currentYear} ${businessName}. All rights reserved.</p>
      <p>Create • Customise • Inspire</p>
    </div>
  </div>
</body>
</html>
  `;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Environment variables (set these in Supabase Edge Function Secrets)
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SITE_URL = Deno.env.get("SITE_URL") || "https://chelladesigns.co.za";
    const BUSINESS_NAME = "Chella Designs";
    const SUPPORT_EMAIL = "info@chelladesigns.co.za";

    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase credentials are not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request body to determine action (send or verify)
    const body = await req.json();
    const { action, email, code } = body;

    if (!action || !email) {
      return new Response(JSON.stringify({ error: "Action and email are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============================================================
    // ACTION: SEND OTP
    // ============================================================
    if (action === "send") {
      if (!email.includes("@")) {
        return new Response(JSON.stringify({ error: "Valid email address is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const otpCode = generateOtp();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

      // Invalidate any existing unused OTPs for this email
      await supabase
        .from("otp_codes")
        .update({ used: true })
        .eq("email", email.toLowerCase())
        .eq("used", false);

      // Store new OTP in database
      const { error: insertError } = await supabase.from("otp_codes").insert({
        email: email.toLowerCase(),
        code: otpCode,
        expires_at: expiresAt,
        used: false,
      });

      if (insertError) {
        console.error("Database error:", insertError);
        throw new Error("Failed to store OTP code");
      }

      // Generate email HTML
      const emailHtml = getOtpEmailTemplate(otpCode, SITE_URL, BUSINESS_NAME, SUPPORT_EMAIL);

      // Send email via Resend
      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: `${BUSINESS_NAME} <noreply@chelladesigns.co.za>`,
          to: [email],
          subject: "Your Verification Code - Chella Designs",
          html: emailHtml,
        }),
      });

      const resendData = await resendResponse.json();
      if (!resendResponse.ok) {
        console.error("Resend error:", resendData);
        throw new Error(resendData.message || "Failed to send email");
      }

      return new Response(JSON.stringify({ success: true, message: "Verification code sent to your email", expires_in: 300 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============================================================
    // ACTION: VERIFY OTP
    // ============================================================
    if (action === "verify") {
      if (!code) {
        return new Response(JSON.stringify({ error: "Verification code is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: otpRecord, error } = await supabase
        .from("otp_codes")
        .select("id, code, expires_at")
        .eq("email", email.toLowerCase())
        .eq("code", code)
        .eq("used", false)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (error || !otpRecord) {
        return new Response(JSON.stringify({ error: "Invalid or expired verification code" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Mark OTP as used
      await supabase.from("otp_codes").update({ used: true }).eq("id", otpRecord.id);

      return new Response(JSON.stringify({ success: true, message: "Email verified successfully" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use 'send' or 'verify'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
