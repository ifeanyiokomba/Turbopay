import { db } from "@/lib/db";
import { providerConfig } from "@/lib/turbocore/config/provider-config";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { INFRA_SERVICES } from "@/lib/turbocore/config/infra-config";
import { z } from "zod";

/**
 * Provider Credentials Center — Admin API
 * ========================================
 *
 * GET  /api/admin/provider-credentials          — list all provider configs + infra services + credential status
 * POST /api/admin/provider-credentials          — save credentials for a provider (encrypted)
 * PATCH /api/admin/provider-credentials/[id]    — toggle enabled/disabled (with validation)
 *
 * Security:
 *  - Uses ADMIN_MANAGE_PROVIDER_CREDENTIALS (separate from general admin)
 *  - NEVER returns credential values — only credentialKeys (field names) + boolean
 *  - Every write goes through providerConfig.update() which encrypts + audit-logs
 *  - Enabling a provider with incomplete credentials is BLOCKED
 *  - CRON_SECRET and TURBOPAY_PII_KEY are NOT managed here (env-only)
 */

/** Static manifest: which fields each provider requires. */
const PROVIDER_MANIFEST: Record<string, { contract: string; fields: string[] }> = {
  monnify: { contract: "virtualAccount", fields: ["apiKey", "secretKey", "contractCode", "baseUrl"] },
  paystack: { contract: "localTransfer", fields: ["secretKey", "baseUrl"] },
  stripe: { contract: "walletFunding", fields: ["secretKey", "publishableKey", "webhookSecret", "baseUrl"] },
  remita: { contract: "billPayment", fields: ["apiKey", "merchantId", "serviceTypeId", "secretKey", "baseUrl"] },
  quickteller: { contract: "billPayment", fields: ["apiKey", "clientSecret", "merchantCode", "baseUrl", "authBaseUrl"] },
  baxi: { contract: "billPayment", fields: ["apiKey", "baseUrl"] },
  "gmail-smtp": { contract: "notification", fields: ["user", "pass", "fromName", "fromEmail"] },
  termii: { contract: "notification", fields: ["apiKey", "senderId", "baseUrl"] },
  resend: { contract: "notification", fields: ["apiKey", "baseUrl", "fromEmail"] },
  dojah: { contract: "kyc", fields: ["appId", "publicKey", "privateKey", "baseUrl"] },
  wise: { contract: "internationalTransfer", fields: ["apiUrl", "token", "webhookSecret"] },
  flutterwave: { contract: "localTransfer", fields: ["clientId", "clientSecret", "webhookHash", "baseUrl"] },
  onafriq: { contract: "walletFunding", fields: ["apiKey", "baseUrl"] },
  otpdev: { contract: "notification", fields: ["apiKey", "senderId", "templateId"] },
};

/** GET — list all provider configs + infrastructure services with credential status. */
export async function GET() {
  try { await requirePermission(Permissions.ADMIN_MANAGE_PROVIDER_CREDENTIALS); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const configs = await db.providerConfig.findMany({
    orderBy: [{ contract: "asc" }, { providerName: "asc" }],
    where: { contract: { not: "infrastructure" } },
    select: {
      id: true, contract: true, providerName: true, displayName: true,
      mode: true, enabled: true, credentialKeys: true, credentialsEnc: true,
      costBasisPoints: true, expiresAt: true,
      updatedAt: true,
    },
  });

  // Decrypt credentials to produce masked display (last 4 chars only).
  // Never returns full plaintext — only masked fragments for admin verification.
  let decryptPii: ((payload: string) => string) | null = null;
  try {
    decryptPii = (await import("@/lib/turbopay/crypto")).decryptPii;
  } catch { /* decryption unavailable — skip masked display */ }

  const result = configs.map((c) => {
    const keys: string[] = c.credentialKeys ? JSON.parse(c.credentialKeys) : [];
    const manifest = PROVIDER_MANIFEST[c.providerName];
    const requiredFields = manifest?.fields ?? [];
    const missingFields = requiredFields.filter((f) => !keys.includes(f));

    // Build masked credential map: each key shows last 4 chars or "****" if not set.
    const maskedCredentials: Record<string, string> = {};
    if (decryptPii && c.credentialsEnc) {
      try {
        const creds = JSON.parse(decryptPii(c.credentialsEnc)) as Record<string, string>;
        for (const key of Object.keys(creds)) {
          const val = creds[key] ?? "";
          maskedCredentials[key] = val.length > 4 ? `••••${val.slice(-4)}` : "••••";
        }
      } catch { /* decryption failed — leave maskedCredentials empty */ }
    }

    // Expiry status
    const now = new Date();
    const expiresAt = c.expiresAt ?? null;
    const daysUntilExpiry = expiresAt ? Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
    const expiryStatus = !expiresAt ? "none" : daysUntilExpiry! < 0 ? "expired" : daysUntilExpiry! <= 30 ? "expiring" : "valid";

    return {
      id: c.id,
      contract: c.contract,
      providerName: c.providerName,
      displayName: c.displayName,
      mode: c.mode,
      enabled: c.enabled,
      credentialsConfigured: !!c.credentialsEnc,
      maskedCredentials,
      configuredKeys: keys,
      requiredFields,
      missingFields,
      isComplete: missingFields.length === 0,
      costBasisPoints: c.costBasisPoints ?? 0,
      expiresAt: expiresAt?.toISOString() ?? null,
      expiryStatus,
      updatedAt: c.updatedAt.toISOString(),
      type: "provider" as const,
    };
  });

  // Append infrastructure services.
  const infraEntries = Object.entries(INFRA_SERVICES).map(([key, svc]) => ({
    id: `infra:${key}`,
    contract: "infrastructure",
    providerName: `infra:${key}`,
    displayName: svc.label,
    mode: "production",
    enabled: true,
    credentialsConfigured: false, // placeholder, filled below
    configuredKeys: [] as string[],
    requiredFields: svc.fields,
    missingFields: [] as string[],
    isComplete: false,
    costBasisPoints: 0,
    updatedAt: null as string | null,
    type: "infrastructure" as const,
    description: svc.description,
    envFallback: svc.envFallback,
  }));

  // Check DB + env status for infra services.
  for (const entry of infraEntries) {
    const row = await db.providerConfig.findFirst({
      where: { providerName: entry.providerName, contract: "infrastructure" },
      select: { credentialsEnc: true, updatedAt: true },
    });
    if (row?.credentialsEnc) {
      try {
        const { decryptPii } = await import("@/lib/turbopay/crypto");
        const creds = JSON.parse(decryptPii(row.credentialsEnc));
        entry.configuredKeys = Object.keys(creds).filter((k) => !!creds[k]);
        entry.credentialsConfigured = true;
        entry.updatedAt = row.updatedAt?.toISOString() ?? null;
      } catch { /* ignore */ }
    }
    // Merge env-set fields.
    const svc = INFRA_SERVICES[entry.providerName.replace("infra:", "")];
    if (svc) {
      for (const field of svc.fields) {
        const envKey = svc.envFallback[field];
        if (envKey && process.env[envKey] && !entry.configuredKeys.includes(field)) {
          entry.configuredKeys.push(field);
        }
      }
      entry.missingFields = svc.fields.filter((f) => !entry.configuredKeys.includes(f));
      entry.isComplete = entry.missingFields.length === 0;
    }
  }

  return json({ data: [...result, ...infraEntries], manifest: PROVIDER_MANIFEST, infraManifest: INFRA_SERVICES });
}

const saveSchema = z.object({
  providerName: z.string().min(2),
  displayName: z.string().min(2).optional(),
  credentials: z.record(z.string(), z.string()).optional(),
  mode: z.enum(["mock", "sandbox", "production"]).optional(),
  costBasisPoints: z.number().int().min(0).max(10000).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

/** POST — save credentials for a provider (creates or updates). */
export async function POST(req: Request) {
  let actor;
  try { actor = await requirePermission(Permissions.ADMIN_MANAGE_PROVIDER_CREDENTIALS); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const user = await getSessionUser();

  let body;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const { providerName, displayName, credentials, mode, costBasisPoints, expiresAt } = parsed.data;
  const manifest = PROVIDER_MANIFEST[providerName];
  if (!manifest) return errorJson(`Unknown provider: ${providerName}. Supported: ${Object.keys(PROVIDER_MANIFEST).join(", ")}`, 400, "UNKNOWN_PROVIDER");

  // Check if a ProviderConfig already exists for this provider+contract
  const existing = await db.providerConfig.findFirst({
    where: { providerName, contract: manifest.contract },
  });

  const actorInfo = user ? { id: user.id, name: user.fullName } : undefined;

  if (existing) {
    // Update existing — merge credentials (don't blank out fields not provided)
    const updated = await providerConfig.update(
      existing.id,
      {
        ...(credentials ? { credentials } : {}),
        ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
        ...(mode ? { mode } : {}),
        ...(displayName ? { displayName } : {}),
        ...(costBasisPoints !== undefined ? { costBasisPoints } : {}),
      },
      actorInfo,
    );
    return json({ data: { id: updated.id, saved: true } });
  } else {
    // Create new
    const created = await providerConfig.create(
      {
        contract: manifest.contract,
        providerName,
        displayName: displayName ?? providerName.charAt(0).toUpperCase() + providerName.slice(1),
        mode: mode ?? "production",
        credentials: credentials ?? {},
        enabled: false,
        ...(costBasisPoints !== undefined ? { costBasisPoints } : {}),
        ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
      },
      actorInfo,
    );
    return json({ data: { id: created.id, saved: true } }, 201);
  }
}
