import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/turbopay/auth";
import { z } from "zod";

const consentSchema = z.object({
  marketingConsent: z.boolean().optional(),
});

/**
 * GET /api/profile/consent — get current consent status
 */
export async function GET() {
  try {
    const sessionUser = await requireUser();
    const user = await db.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        privacyPolicyAccepted: true,
        privacyPolicyAcceptedAt: true,
        marketingConsent: true,
        marketingConsentAt: true,
      },
    });
    return NextResponse.json(user);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

/**
 * PATCH /api/profile/consent — update consent preferences
 */
export async function PATCH(req: NextRequest) {
  try {
    const sessionUser = await requireUser();
    const body = await req.json();
    const parsed = consentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};

    if (parsed.data.marketingConsent !== undefined) {
      updates.marketingConsent = parsed.data.marketingConsent;
      updates.marketingConsentAt = new Date();
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const updated = await db.user.update({
      where: { id: sessionUser.id },
      data: updates,
      select: {
        marketingConsent: true,
        marketingConsentAt: true,
      },
    });

    return NextResponse.json(updated);
  } catch (e: any) {
    if (e?.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[Consent Update Error]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
