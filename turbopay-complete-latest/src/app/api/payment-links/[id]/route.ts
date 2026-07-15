import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/turbopay/auth";
import { paymentLinks } from "@/lib/turbocore/payment-links";

/**
 * GET /api/payment-links/[id] — get payment link details + analytics
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const analytics = await paymentLinks.getAnalytics(user.id, id);
    return NextResponse.json({ data: analytics });
  } catch (e: any) {
    if (e?.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (e?.message === "Payment link not found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/payment-links/[id] — toggle active/paused
 */
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const link = await paymentLinks.toggleStatus(user.id, id);
    return NextResponse.json({ data: link });
  } catch (e: any) {
    if (e?.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (e?.message === "Payment link not found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
