import { webhookRegistry } from "@/lib/turbocore/webhooks/registry";
import "@/lib/turbocore/webhooks/dispatcher"; // registers the event dispatcher
import { json } from "@/lib/turbopay/api";

/**
 * Monnify webhook receiver (legacy path).
 *
 * This route is kept for backward compatibility with Monnify dashboard configs
 * that point to /api/webhooks/monnify. It delegates to the SAME registry-based
 * pipeline as /api/turbocore/webhooks/monnify — signature verification (DB-first
 * via hmacVerifierFromDb), WebhookEvent persistence, replay protection, and
 * business-layer dispatch.
 *
 * New provider dashboard configs should use /api/turbocore/webhooks/monnify
 * (the generic registry route) — both paths are functionally identical.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawBody);
  } catch {
    return json({ status: "ignored", reason: "invalid_json" }, 200);
  }
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });

  const result = await webhookRegistry.process("monnify", { rawBody, headers, parsedPayload });
  return json(result.body, result.status);
}
