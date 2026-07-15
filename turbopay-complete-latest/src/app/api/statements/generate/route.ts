import { requireUser } from "@/lib/turbopay/auth";
import { statements } from "@/lib/turbocore/statements";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

const schema = z.object({
  fromDate: z.string().datetime(), toDate: z.string().datetime(), format: z.enum(["PDF", "CSV", "EXCEL"]),
  filters: z.record(z.string(), z.unknown()).optional(), emailTo: z.string().email().optional(),
});

export async function POST(req: Request) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  try { return json({ data: await statements.generate(user.id, { fromDate: new Date(parsed.data.fromDate), toDate: new Date(parsed.data.toDate), format: parsed.data.format, filters: parsed.data.filters, emailTo: parsed.data.emailTo }) }); }
  catch (e: any) { return errorJson(e.message, 400); }
}
