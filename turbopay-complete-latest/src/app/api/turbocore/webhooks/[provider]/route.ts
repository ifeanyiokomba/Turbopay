import { webhookRegistry } from "@/lib/turbocore/webhooks/registry";
import "@/lib/turbocore/webhooks/dispatcher"; // registers the event dispatcher
import { json } from "@/lib/turbopay/api";

/**
 * Generic TurboCore webhook receiver. Routes to the registered handler by
 * the `provider` path segment: /api/turbocore/webhooks/:provider
 *
 * This is the canonical entry point for ALL provider webhooks. Each provider
 * handler normalises the raw payload into internal domain events — the
 * business layer never consumes raw provider payloads.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const rawBody = await req.text();
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawBody);
  } catch {
    return json({ status: "ignored", reason: "invalid_json" }, 200);
  }
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });

  const result = await webhookRegistry.process(provider, { rawBody, headers, parsedPayload });
  return json(result.body, result.status);
}
