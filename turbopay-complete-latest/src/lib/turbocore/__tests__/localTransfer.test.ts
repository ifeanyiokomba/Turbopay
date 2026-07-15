import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PaystackLocalTransferProvider } from "@/lib/turbocore/providers/adapters/paystack";
import { providers } from "@/lib/turbocore/providers/registry";

/**
 * Paystack localTransfer adapter tests.
 *
 * These tests stub the global `fetch` (used by the shared `_http` helper) to
 * assert the adapter constructs the correct request shape against the
 * Paystack transfer API, normalises the response into the ProviderResult
 * contract, and maps HTTP / network failures into `ProviderResult.error`.
 *
 * They also verify the registry resolves to the mock adapter when no DB
 * route is configured (test env).
 */

const BASE = "https://api.paystack.co";
const SECRET = "sk_test_secret_xxx";

/** Build a minimal JSON Response-like object the _http helper accepts. */
function jsonRes(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

describe("PaystackLocalTransferProvider", () => {
  let calls: FetchCall[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    calls = [];
    fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url.toString(), init });
      // Dispatch on URL suffix to return the right canned response.
      const u = url.toString();
      if (u.endsWith("/transferrecipient")) {
        return jsonRes({ status: true, message: "Recipient created", data: { recipient_code: "RCP_x1y2z3" } });
      }
      if (u.includes("/transfer/") && init?.method !== "POST") {
        return jsonRes({ status: true, data: { transfer_code: "TRF_abc123", status: "success" } });
      }
      // Default: POST /transfer
      return jsonRes({
        status: true,
        message: "Transfer created",
        data: { reference: "NIP-test-1", transfer_code: "TRF_abc123", status: "pending" },
      });
    });
    // The _http helper calls the global `fetch`.
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transfer() creates a recipient then initiates the transfer with the correct shape", async () => {
    const adapter = new PaystackLocalTransferProvider({ secretKey: SECRET, publicKey: "pk_test_x", baseUrl: BASE });
    const r = await adapter.transfer(
      {
        fromAccount: "8012345678",
        toAccount: "0123456789",
        toBankCode: "058",
        amountMinor: 50_000, // ₦500 → Paystack takes naira → 500
        currency: "NGN",
        reference: "NIP-test-1",
        narration: "Rent",
      },
      { product: "turbopay", idempotencyKey: "idem-1" },
    );

    expect(r.ok).toBe(true);
    expect(r.data!.providerRef).toBe("TRF_abc123");
    expect(r.data!.status).toBe("PENDING");

    // Two HTTP calls: create recipient + initiate transfer.
    expect(calls).toHaveLength(2);

    // 1. Recipient creation.
    const rcp = calls[0]!;
    expect(rcp.url).toBe(`${BASE}/transferrecipient`);
    expect(rcp.init?.method).toBe("POST");
    const rcpBody = JSON.parse(rcp.init!.body as string);
    expect(rcpBody).toEqual({
      type: "nuban",
      name: "Rent", // narration is used as the recipient name
      account_number: "0123456789",
      bank_code: "058",
      currency: "NGN",
    });
    expect(rcp.init?.headers).toMatchObject({ Authorization: `Bearer ${SECRET}` });
    expect(rcp.init?.headers).toMatchObject({ "Idempotency-Key": "idem-1-rcp" });

    // 2. Transfer initiation.
    const trf = calls[1]!;
    expect(trf.url).toBe(`${BASE}/transfer`);
    expect(trf.init?.method).toBe("POST");
    const trfBody = JSON.parse(trf.init!.body as string);
    expect(trfBody).toEqual({
      source: "balance",
      amount: 500, // kobo → naira
      recipient: "RCP_x1y2z3",
      reference: "NIP-test-1",
      reason: "Rent",
    });
    expect(trf.init?.headers).toMatchObject({ Authorization: `Bearer ${SECRET}` });
    expect(trf.init?.headers).toMatchObject({ "Idempotency-Key": "idem-1" });
  });

  it("caches the recipient_code so a second transfer to the same NUBAN makes only one HTTP call", async () => {
    const adapter = new PaystackLocalTransferProvider({ secretKey: SECRET, publicKey: "pk", baseUrl: BASE });
    await adapter.transfer({
      fromAccount: "8012345678", toAccount: "0123456789", toBankCode: "058",
      amountMinor: 10_000, currency: "NGN", reference: "NIP-1", narration: "Test",
    });
    expect(calls).toHaveLength(2);

    await adapter.transfer({
      fromAccount: "8012345678", toAccount: "0123456789", toBankCode: "058",
      amountMinor: 10_000, currency: "NGN", reference: "NIP-2", narration: "Test 2",
    });
    // Second transfer reuses the cached recipient → only the /transfer POST fires.
    expect(calls).toHaveLength(3);
    expect(calls[2]!.url).toBe(`${BASE}/transfer`);
  });

  it("maps Paystack status strings to the domain union", async () => {
    const adapter = new PaystackLocalTransferProvider({ secretKey: SECRET, publicKey: "pk", baseUrl: BASE });

    // Override the mock to return "success" on the /transfer POST.
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.endsWith("/transferrecipient")) {
        return jsonRes({ status: true, data: { recipient_code: "RCP_ok" } });
      }
      return jsonRes({ status: true, data: { transfer_code: "TRF_ok", status: "success" } });
    }) as unknown as typeof fetch;

    const r = await adapter.transfer({
      fromAccount: "x", toAccount: "0123456789", toBankCode: "058",
      amountMinor: 10_000, currency: "NGN", reference: "NIP-ok",
    });
    expect(r.ok).toBe(true);
    expect(r.data!.status).toBe("SUCCESS");
  });

  it("returns ProviderResult.error (never throws) on a non-2xx Paystack response", async () => {
    const adapter = new PaystackLocalTransferProvider({ secretKey: SECRET, publicKey: "pk", baseUrl: BASE });
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.endsWith("/transferrecipient")) {
        return jsonRes({ status: false, message: "Invalid account number" }, 400);
      }
      return jsonRes({});
    }) as unknown as typeof fetch;

    const r = await adapter.transfer({
      fromAccount: "x", toAccount: "bad", toBankCode: "058",
      amountMinor: 10_000, currency: "NGN", reference: "NIP-err",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe("HTTP_400");
    expect(r.error!.message).toContain("Invalid account number");
  });

  it("getTransferStatus() GETs /transfer/{providerRef} and returns the mapped status", async () => {
    const adapter = new PaystackLocalTransferProvider({ secretKey: SECRET, publicKey: "pk", baseUrl: BASE });
    // The beforeEach fetchMock returns a "success" status for any GET to
    // /transfer/{code} — no override needed here, and `calls` stays populated.
    const r = await adapter.getTransferStatus("TRF_abc", { product: "turbopay" });
    expect(r.ok).toBe(true);
    expect(r.data!.status).toBe("SUCCESS");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/transfer/TRF_abc`);
    expect(calls[0]!.init?.method).toBe("GET");
    expect(calls[0]!.init?.headers).toMatchObject({ Authorization: `Bearer ${SECRET}` });
  });

  it("normalises a network failure into ProviderResult.error (never throws)", async () => {
    const adapter = new PaystackLocalTransferProvider({ secretKey: SECRET, publicKey: "pk", baseUrl: BASE });
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    }) as unknown as typeof fetch;

    const r = await adapter.transfer({
      fromAccount: "x", toAccount: "0123456789", toBankCode: "058",
      amountMinor: 10_000, currency: "NGN", reference: "NIP-net",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe("NETWORK_ERROR");
    expect(r.error!.message).toContain("fetch failed");
  });

  it("constructor takes credentials only from the factory — no env-var reads inside the adapter", async () => {
    // Source-level invariant: there are no `process.env` references in
    // paystack.ts. We assert this statically so a future edit cannot
    // silently introduce a direct env-var read.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/turbocore/providers/adapters/paystack.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/process\.env/);
  });
});

describe("Registry → localTransfer contract", () => {
  it("providers.localTransfer() resolves to the mock adapter when no DB route is configured", async () => {
    const lt = await providers.localTransfer();
    expect(lt.name).toBe("mock-local-transfer");
    const r = await lt.transfer({
      fromAccount: "x", toAccount: "0123456789", toBankCode: "058",
      amountMinor: 10_000, currency: "NGN", reference: "NIP-mock",
    });
    expect(r.ok).toBe(true);
    expect(r.data!.providerRef).toMatch(/^NIP-/);
    expect(r.data!.status).toBe("SUCCESS");
  });

  it("providers.localTransfer() accepts a ProviderContext for routing (backward compatible)", async () => {
    const lt = await providers.localTransfer({ product: "turbopay", correlationId: "test-corr" });
    expect(lt.name).toBe("mock-local-transfer");
  });
});
