import { errorJson, json } from "@/lib/turbopay/api";
import { webhookRegistry } from "@/lib/turbocore/webhooks/registry";
import "@/lib/turbocore/webhooks/dispatcher"; // registers the event dispatcher

/**
 * POST /api/intl/receive — inbound international receiving webhook.
 * Routes through the generic TurboCore webhook framework to the
 * intl-receiving handler, which normalises the payload and dispatches the
 * INTL_TRANSFER_RECEIVED event to the settlement engine.
 *
 * INACTIVE until a licensed partner is configured. The mock adapter returns
 * deterministic test data.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  let parsedPayload: unknown;
  try { parsedPayload = JSON.parse(rawBody); } catch { return json({ status: "ignored", reason: "invalid_json" }, 200); }
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });
  const result = await webhookRegistry.process("intl-receiving", { rawBody, headers, parsedPayload });
  return json(result.body, result.status);
}
