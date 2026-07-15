import { json, errorJson } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { isPasswordBreached } from "@/lib/turbopay/breach-check";
import { z } from "zod";

/**
 * Public breach-check endpoint for the registration form's password
 * checklist. The frontend calls this on each keystroke (debounced) to show
 * the user a ✓ (safe) / ✗ (breached) / spinner (checking) indicator
 * BEFORE they submit the form.
 *
 * The route is PUBLIC (no auth) — the user is not yet registered when they
 * see the checklist. Rate-limited to 20/minute per IP to prevent scripted
 * abuse (e.g. an attacker using this endpoint as a free HIBP oracle for
 * their own breach database).
 *
 * The breach check is SOFT (fail-open): if the HIBP API is unreachable, we
 * return `{ breached: false }` so the form doesn't show a false "breached"
 * state to the user. The final authoritative check happens on the server
 * in `/api/auth/register` (which also fails open).
 */

const schema = z.object({
  password: z.string().min(1, "Password is required").max(10_000),
});

export async function POST(req: Request) {
  // 20 checks / minute per IP — generous for a human typing in a form
  // (debounced at ~500ms, so even fast typists hit it < 30 times in a
  // minute) but blocks scripted enumeration.
  const limited = await rateLimit(req, { key: "check-breach", limit: 20, windowMs: 60 * 1000 });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");
  }

  const breached = await isPasswordBreached(parsed.data.password);
  return json({ data: { breached } });
}
