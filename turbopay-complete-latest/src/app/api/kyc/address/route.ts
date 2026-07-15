import { requireUser } from "@/lib/turbopay/auth";
import { enhancedKyc, ADDRESS_DOCUMENT_TYPES } from "@/lib/turbocore/kyc-enhanced";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET() {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await enhancedKyc.getUserAddressStatus(user.id) });
}

const schema = z.object({
  residentialAddress: z.string().min(5), state: z.string().min(2), lga: z.string().optional(),
  city: z.string().min(2), postalCode: z.string().optional(),
  documentType: z.enum(ADDRESS_DOCUMENT_TYPES as any), documentBase64: z.string().min(100),
});

export async function POST(req: Request) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  try { return json({ data: await enhancedKyc.submitAddress(user.id, parsed.data) }, 201); }
  catch (e: any) { return errorJson(e.message, 400); }
}
