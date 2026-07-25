/**
 * Test Email Endpoint
 * ===================
 *
 * GET /api/cron/test-email?secret=xxx&to=email@example.com
 *
 * Sends a test email via Resend to verify the integration is working.
 * Requires CRON_SECRET for authentication.
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = req.nextUrl.searchParams.get("to");
  if (!to) {
    return NextResponse.json({ error: "Missing 'to' parameter" }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || "TurboPay <noreply@turbopay.okomba.com>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: "TurboPay Test Email",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h1 style="color:#1a1a2e;font-size:24px">TurboPay</h1>
            <p>This is a test email to verify Resend integration is working.</p>
            <p style="color:#888;font-size:12px;margin-top:24px">Sent at: ${new Date().toISOString()}</p>
          </div>
        `,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `Resend API error: ${res.status}`,
        details: data,
        from: fromEmail,
        to,
      });
    }

    return NextResponse.json({
      success: true,
      messageId: data.id,
      from: fromEmail,
      to,
      message: "Test email sent successfully",
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
      from: fromEmail,
      to,
    });
  }
}
