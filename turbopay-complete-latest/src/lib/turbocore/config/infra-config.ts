/**
 * Infrastructure Services Config
 * =================================
 *
 * Provides a single source of truth for infrastructure service credentials
 * (Google OAuth, Sentry, SMTP, etc.) that can be configured via the admin
 * Credentials Center. Values are stored encrypted in the DB, with env-var
 * fallback for services that must be available before the DB connection.
 *
 * Chicken-and-egg services (DATABASE_URL, REDIS_URL, TURBOPAY_PII_KEY,
 * CRON_SECRET) MUST remain env-only — they're needed before the DB is
 * reachable. This module handles everything else.
 *
 * Usage:
 *   const googleClientId = await infraConfig.get("google", "clientId");
 */

import { db } from "@/lib/db";
import { decryptPii, encryptPii } from "@/lib/turbopay/crypto";

/** Service name → list of field names that can be stored in DB. */
export const INFRA_SERVICES: Record<string, {
  label: string;
  fields: string[];
  envFallback: Record<string, string>; // field → env var name
  description: string;
}> = {
  google: {
    label: "Google OAuth",
    fields: ["clientId", "clientSecret"],
    envFallback: {
      clientId: "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
      clientSecret: "GOOGLE_CLIENT_SECRET",
    },
    description: "Google Sign-In for user authentication",
  },
  sentry: {
    label: "Sentry Error Tracking",
    fields: ["dsn", "org", "project"],
    envFallback: {
      dsn: "SENTRY_DSN",
      org: "SENTRY_ORG",
      project: "SENTRY_PROJECT",
    },
    description: "Error monitoring and performance tracking",
  },
  smtp: {
    label: "SMTP / Transactional Email",
    fields: ["host", "port", "user", "pass", "from"],
    envFallback: {
      host: "SMTP_HOST",
      port: "SMTP_PORT",
      user: "SMTP_USER",
      pass: "SMTP_PASS",
      from: "SMTP_FROM",
    },
    description: "Transactional email (password reset, verification, etc.)",
  },
};

const INFRA_CACHE_TTL_MS = 60_000;
const infraCache = new Map<string, { value: Record<string, string>; expiresAt: number }>();

/**
 * Get a single config value for an infrastructure service.
 * Reads from DB first (encrypted), falls back to env var.
 */
export async function getInfraValue(service: string, field: string): Promise<string | undefined> {
  const svc = INFRA_SERVICES[service];
  if (!svc) return undefined;

  // Check cache.
  const cached = infraCache.get(service);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value[field] ?? process.env[svc.envFallback[field] ?? ""];
  }

  // Read from DB.
  const row = await db.providerConfig.findFirst({
    where: { providerName: `infra:${service}`, contract: "infrastructure" },
    select: { credentialsEnc: true },
  });

  if (row?.credentialsEnc) {
    try {
      const creds = JSON.parse(decryptPii(row.credentialsEnc));
      infraCache.set(service, { value: creds, expiresAt: Date.now() + INFRA_CACHE_TTL_MS });
      return creds[field] ?? process.env[svc.envFallback[field] ?? ""];
    } catch { /* fall through to env */ }
  }

  // Env fallback.
  const envKey = svc.envFallback[field];
  return envKey ? process.env[envKey] : undefined;
}

/**
 * Get all config values for an infrastructure service.
 * Returns a merged object: DB values override env vars.
 */
export async function getInfraService(service: string): Promise<Record<string, string | undefined>> {
  const svc = INFRA_SERVICES[service];
  if (!svc) return {};

  const result: Record<string, string | undefined> = {};
  for (const field of svc.fields) {
    result[field] = await getInfraValue(service, field);
  }
  return result;
}

/**
 * Save infrastructure service credentials to DB (encrypted).
 */
export async function saveInfraService(
  service: string,
  credentials: Record<string, string>,
  actor?: { id: string; name: string },
): Promise<{ id: string }> {
  const svc = INFRA_SERVICES[service];
  if (!svc) throw new Error(`Unknown service: ${service}`);

  const existing = await db.providerConfig.findFirst({
    where: { providerName: `infra:${service}`, contract: "infrastructure" },
  });

  const data = {
    contract: "infrastructure",
    providerName: `infra:${service}`,
    displayName: svc.label,
    mode: "production",
    credentialsEnc: encryptPii(JSON.stringify(credentials)),
    credentialKeys: JSON.stringify(Object.keys(credentials)),
    enabled: true,
  };

  if (existing) {
    await db.providerConfig.update({ where: { id: existing.id }, data });
    infraCache.delete(service);
    return { id: existing.id };
  } else {
    const created = await db.providerConfig.create({ data });
    infraCache.delete(service);
    return { id: created.id };
  }
}
