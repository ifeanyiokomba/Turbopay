import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { INFRA_SERVICES, saveInfraService, getInfraService } from "@/lib/turbocore/config/infra-config";
import { z } from "zod";

/**
 * Infrastructure Credentials — Admin API
 * ========================================
 *
 * GET  /api/admin/infra-credentials            — list all infra services + config status
 * POST /api/admin/infra-credentials            — save credentials for an infra service
 *
 * Services managed: Google OAuth, Sentry, SMTP.
 * DATABASE_URL, REDIS_URL, TURBOPAY_PII_KEY, CRON_SECRET are env-only
 * (chicken-and-egg — needed before DB is reachable).
 */

/** GET — list all infrastructure services with config status. */
export async function GET() {
  try { await requirePermission(Permissions.ADMIN_MANAGE_PROVIDER_CREDENTIALS); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const services = await Promise.all(
    Object.entries(INFRA_SERVICES).map(async ([key, svc]) => {
      // Check if DB-stored credentials exist.
      const row = await db.providerConfig.findFirst({
        where: { providerName: `infra:${key}`, contract: "infrastructure" },
        select: { credentialsEnc: true, updatedAt: true },
      });

      // Check which fields have env var fallback set.
      const envStatus: Record<string, { envSet: boolean; dbSet: boolean }> = {};
      for (const field of svc.fields) {
        const envKey = svc.envFallback[field];
        envStatus[field] = {
          envSet: !!(envKey && process.env[envKey]),
          dbSet: false,
        };
      }

      // Check DB values.
      if (row?.credentialsEnc) {
        try {
          const { decryptPii } = await import("@/lib/turbopay/crypto");
          const creds = JSON.parse(decryptPii(row.credentialsEnc));
          for (const field of svc.fields) {
            envStatus[field].dbSet = !!creds[field];
          }
        } catch { /* ignore */ }
      }

      const allConfigured = svc.fields.every(
        (f) => envStatus[f].envSet || envStatus[f].dbSet,
      );

      return {
        key,
        label: svc.label,
        description: svc.description,
        fields: svc.fields,
        envFallback: svc.envFallback,
        fieldStatus: envStatus,
        configured: allConfigured,
        updatedAt: row?.updatedAt?.toISOString() ?? null,
      };
    }),
  );

  // Also list env-only services that can't be DB-stored.
  const envOnlyServices = [
    { key: "database", label: "PostgreSQL", description: "Primary database connection", envVars: ["DATABASE_URL", "DIRECT_URL"], reason: "Required before DB is reachable" },
    { key: "redis", label: "Redis", description: "Cache, rate limiting, circuit breaker state", envVars: ["REDIS_URL"], reason: "Required before DB is reachable" },
    { key: "encryption", label: "PII Encryption Key", description: "AES-256-GCM key for encrypting sensitive data", envVars: ["TURBOPAY_PII_KEY"], reason: "Needed to decrypt DB credentials" },
    { key: "cron", label: "Cron Secret", description: "Authentication for cron job endpoints", envVars: ["CRON_SECRET"], reason: "Needed before DB is reachable" },
  ];

  return json({
    data: {
      services,
      envOnlyServices,
      envOnlyStatus: envOnlyServices.map((s) => ({
        key: s.key,
        label: s.label,
        configured: s.envVars.some((v) => !!process.env[v]),
        envVars: s.envVars.map((v) => ({ name: v, set: !!process.env[v] })),
      })),
    },
  });
}

const saveSchema = z.object({
  service: z.string().min(1),
  credentials: z.record(z.string(), z.string()),
});

/** POST — save credentials for an infrastructure service. */
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

  const { service, credentials } = parsed.data;
  if (!INFRA_SERVICES[service]) {
    return errorJson(`Unknown service: ${service}. Supported: ${Object.keys(INFRA_SERVICES).join(", ")}`, 400);
  }

  const actorInfo = user ? { id: user.id, name: user.fullName } : undefined;
  const result = await saveInfraService(service, credentials, actorInfo);

  return json({ data: { id: result.id, saved: true } });
}
