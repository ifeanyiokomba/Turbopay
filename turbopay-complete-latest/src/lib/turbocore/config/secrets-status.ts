/** Secrets Status — shows configured/missing without exposing values. */
import { db } from "@/lib/db";

export interface SecretStatus { key: string; label: string; configured: boolean; source: "env" | "database" | "missing"; hint?: string; }

const ENV_SECRETS: Array<{ key: string; label: string; hint?: string }> = [
  { key: "DATABASE_URL", label: "Database URL", hint: "PostgreSQL connection string" },
  { key: "TURBOPAY_PII_KEY", label: "PII Encryption Key", hint: "AES-256-GCM key for BVN/NIN encryption" },
  { key: "TURBOPAY_MONNIFY_WEBHOOK_SECRET", label: "Monnify Webhook Secret", hint: "HMAC secret for Monnify webhooks" },
  { key: "TURBOCORE_INTL_WEBHOOK_SECRET", label: "International Webhook Secret", hint: "HMAC secret for cross-border webhooks" },
  { key: "REDIS_URL", label: "Redis URL", hint: "For distributed rate limiting (optional)" },
  { key: "TERMII_API_KEY", label: "Termii API Key", hint: "For SMS notifications" },
  { key: "RESEND_API_KEY", label: "Resend API Key", hint: "For email notifications" },
  { key: "MONNIFY_API_KEY", label: "Monnify API Key", hint: "For wallet funding" },
  { key: "MONNIFY_SECRET_KEY", label: "Monnify Secret Key" },
  { key: "MONNIFY_CONTRACT_CODE", label: "Monnify Contract Code" },
  { key: "BAXI_API_KEY", label: "Baxi API Key", hint: "For airtime/data/bills" },
  { key: "DOJAH_APP_ID", label: "Dojah App ID", hint: "For KYC verification" },
  { key: "DOJAH_PUBLIC_KEY", label: "Dojah Public Key" },
  { key: "DOJAH_PRIVATE_KEY", label: "Dojah Private Key" },
];

class SecretsStatusService {
  async getStatus(): Promise<{ envSecrets: SecretStatus[]; providerConfigs: SecretStatus[]; ready: boolean }> {
    const envSecrets: SecretStatus[] = ENV_SECRETS.map((s) => {
      const value = process.env[s.key];
      return { key: s.key, label: s.label, configured: !!value && value.length > 0, source: value ? "env" : "missing", hint: s.hint };
    });
    const providerConfigs = await db.providerConfig.findMany({ where: { credentialsEnc: { not: null } }, select: { contract: true, providerName: true, credentialsEnc: true } });
    const dbSecrets: SecretStatus[] = providerConfigs.map((c) => ({ key: `provider:${c.contract}:${c.providerName}`, label: `${c.providerName} (${c.contract})`, configured: !!c.credentialsEnc, source: "database" }));
    const critical = ["DATABASE_URL", "TURBOPAY_PII_KEY"];
    const ready = critical.every((k) => process.env[k]);
    return { envSecrets, providerConfigs: dbSecrets, ready };
  }
}
export const secretsStatus = new SecretsStatusService();
