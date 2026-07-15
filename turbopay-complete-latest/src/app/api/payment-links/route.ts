import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/turbopay/auth";
import { paymentLinks } from "@/lib/turbocore/payment-links";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  amountNaira: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  allowCustomAmount: z.boolean().optional(),
  minAmountNaira: z.number().min(0).optional(),
  maxAmountNaira: z.number().min(0).optional(),
  maxUses: z.number().int().min(1).optional(),
  expiresInHours: z.number().int().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * GET /api/payment-links — list user's payment links
 */
export async function GET() {
  try {
    const user = await requireUser();
    const links = await paymentLinks.getUserLinks(user.id);
    return NextResponse.json({ data: links });
  } catch (e: any) {
    if (e?.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/payment-links — create a payment link
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const link = await paymentLinks.create({ ...parsed.data, userId: user.id });
    return NextResponse.json({ data: link }, { status: 201 });
  } catch (e: any) {
    if (e?.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
