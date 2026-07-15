/** Webhook Management — register, enable/disable, verify, retry, set secret. */
import { db } from "@/lib/db";
import { encryptPii, decryptPii } from "@/lib/turbopay/crypto";
import { audit } from "@/lib/turbopay/audit";
import { recordConfigVersion } from "@/lib/turbocore/config/versioning";

export interface WebhookEndpointInput {
  providerName: string; contract: string; url: string; secret?: string;
  enabled?: boolean; maxRetries?: number; retryDelaySec?: number;
}

class WebhookManagementService {
  async register(input: WebhookEndpointInput, actor?: { id: string; name: string }) {
    const secretEnc = input.secret ? encryptPii(input.secret) : null;
    const created = await db.webhookEndpoint.create({ data: { providerName: input.providerName, contract: input.contract, url: input.url, secretEnc, enabled: input.enabled ?? true, maxRetries: input.maxRetries ?? 5, retryDelaySec: input.retryDelaySec ?? 60 } });
    await recordConfigVersion("webhookEndpoint", created.id, "CREATE", null, { ...created, secretEnc: "[REDACTED]" }, undefined, actor);
    await audit({ userId: actor?.id, action: "WEBHOOK_REGISTERED", category: "ADMIN", severity: "INFO", metadata: { providerName: input.providerName, contract: input.contract, url: input.url } });
    return this.toView(created);
  }
  async update(id: string, input: Partial<WebhookEndpointInput>, actor?: { id: string; name: string }) {
    const existing = await db.webhookEndpoint.findUnique({ where: { id } });
    if (!existing) throw new Error("Webhook endpoint not found");
    const data: Record<string, unknown> = {};
    if (input.url !== undefined) data.url = input.url;
    if (input.secret !== undefined) data.secretEnc = encryptPii(input.secret);
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.maxRetries !== undefined) data.maxRetries = input.maxRetries;
    if (input.retryDelaySec !== undefined) data.retryDelaySec = input.retryDelaySec;
    const updated = await db.webhookEndpoint.update({ where: { id }, data });
    await recordConfigVersion("webhookEndpoint", id, "UPDATE", { ...existing, secretEnc: "[REDACTED]" }, { ...updated, secretEnc: "[REDACTED]" }, undefined, actor);
    return this.toView(updated);
  }
  async enable(id: string, actor?: { id: string; name: string }) { return this.update(id, { enabled: true }, actor); }
  async disable(id: string, actor?: { id: string; name: string }) { return this.update(id, { enabled: false }, actor); }
  async markVerified(id: string, actor?: { id: string; name: string }) {
    const updated = await db.webhookEndpoint.update({ where: { id }, data: { verified: true, verifiedAt: new Date() } });
    await audit({ userId: actor?.id, action: "WEBHOOK_VERIFIED", category: "ADMIN", severity: "INFO", metadata: { id } });
    return this.toView(updated);
  }
  async retryEvent(webhookEventId: string, actor?: { id: string; name: string }) {
    const event = await db.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event) throw new Error("Webhook event not found");

    // Actually re-process the event through the registry: re-normalize the
    // stored payload and re-dispatch to the business layer. The previous
    // version just flipped status to PENDING and left it for a cron that
    // never properly dispatched either — this version does the real work.
    const { webhookRegistry } = await import("@/lib/turbocore/webhooks/registry");
    await import("@/lib/turbocore/webhooks/dispatcher"); // ensures dispatcher is registered

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(event.payload);
    } catch {
      await db.webhookEvent.update({ where: { id: webhookEventId }, data: { error: "Invalid JSON payload" } });
      throw new Error("Webhook event payload is not valid JSON");
    }

    const result = await webhookRegistry.reprocess(event.provider, parsedPayload, {});

    if (result.error) {
      await db.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: "FAILED", error: result.error.slice(0, 1000) },
      });
      throw new Error(result.error);
    }

    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: "PROCESSED", error: null, processedAt: new Date() },
    });
    await audit({ userId: actor?.id, action: "WEBHOOK_RETRY", category: "ADMIN", severity: "INFO", metadata: { webhookEventId, provider: event.provider, providerRef: event.providerRef } });
    return { ok: true, events: result.events.length };
  }
  async list() { const endpoints = await db.webhookEndpoint.findMany({ orderBy: [{ providerName: "asc" }, { contract: "asc" }] }); return endpoints.map((e) => this.toView(e)); }
  async listForAdmin() { return this.list(); }

  /** Get the decrypted secret for a provider (server-side only — used by hmacVerifierFromDb). */
  async getDecryptedSecret(providerName: string): Promise<string | null> {
    const endpoint = await db.webhookEndpoint.findFirst({ where: { providerName, enabled: true }, select: { secretEnc: true } });
    if (!endpoint?.secretEnc) return null;
    try { return decryptPii(endpoint.secretEnc); } catch { return null; }
  }

  /** Set/update the encrypted HMAC secret for a webhook endpoint. */
  async setSecret(id: string, secret: string, actor?: { id: string; name: string }): Promise<{ ok: boolean; secretConfigured: boolean }> {
    if (!secret || secret.length < 16) throw new Error("Secret must be at least 16 characters");
    const existing = await db.webhookEndpoint.findUnique({ where: { id } });
    if (!existing) throw new Error("Webhook endpoint not found");
    await db.webhookEndpoint.update({ where: { id }, data: { secretEnc: encryptPii(secret) } });
    await audit({ userId: actor?.id, action: "WEBHOOK_SECRET_UPDATED", category: "ADMIN", severity: "INFO", metadata: { endpointId: id, providerName: existing.providerName } });
    return { ok: true, secretConfigured: true };
  }
  private toView(e: any) {
    return { id: e.id, providerName: e.providerName, contract: e.contract, url: e.url, secretConfigured: !!e.secretEnc, enabled: e.enabled, maxRetries: e.maxRetries, retryDelaySec: e.retryDelaySec, verified: e.verified, verifiedAt: e.verifiedAt?.toISOString() ?? null, createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString() };
  }
}
export const webhookManagement = new WebhookManagementService();
