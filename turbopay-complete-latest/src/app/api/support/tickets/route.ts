import { requireUser } from "@/lib/turbopay/auth";
import { support, TICKET_CATEGORIES } from "@/lib/turbocore/support";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { sanitizeString } from "@/lib/turbopay/sanitize";
import { z } from "zod";

export async function GET() {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await support.getUserTickets(user.id) });
}

const schema = z.object({
  fullName: z.string().min(2), email: z.string().email(), phone: z.string().optional(), username: z.string().optional(),
  category: z.enum(TICKET_CATEGORIES as any), subcategory: z.string().optional(),
  subject: z.string().min(3).max(200), description: z.string().min(10).max(5000),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
});

export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "support-ticket", limit: 10, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;
  let userId: string | undefined;
  try { const u = await requireUser(); userId = u.id; } catch { /* anonymous submission OK */ }
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  // Sanitize free-form fields after schema validation.
  const ticketData = {
    ...parsed.data,
    fullName: sanitizeString(parsed.data.fullName),
    subject: sanitizeString(parsed.data.subject),
    description: sanitizeString(parsed.data.description),
    ...(parsed.data.subcategory ? { subcategory: sanitizeString(parsed.data.subcategory) } : {}),
  };

  const ticket = await support.createTicket({ ...ticketData, userId });
  return json({ data: { ticketNumber: ticket.ticketNumber, id: ticket.id, createdAt: ticket.createdAt.toISOString(), estimatedResponseTime: "24 hours" } }, 201);
}
