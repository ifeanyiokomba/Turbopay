import { db } from "@/lib/db";
import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET() {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let pref = await db.communicationPreference.findUnique({ where: { userId: user.id } });
  if (!pref) {
    pref = await db.communicationPreference.create({ data: { userId: user.id } });
  }
  return json({ data: pref });
}

const schema = z.object({
  emailEnabled: z.boolean().optional(), smsEnabled: z.boolean().optional(), inAppEnabled: z.boolean().optional(),
  ticketUpdates: z.boolean().optional(), transactionAlerts: z.boolean().optional(), securityAlerts: z.boolean().optional(), promotional: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson("Invalid input", 422, "VALIDATION");
  const pref = await db.communicationPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...parsed.data },
    update: parsed.data,
  });
  return json({ data: pref });
}
