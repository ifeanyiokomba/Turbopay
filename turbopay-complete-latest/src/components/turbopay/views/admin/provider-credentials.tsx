"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  KeyRound, ShieldAlert, Power, Save, AlertCircle, CheckCircle2, XCircle,
  Eye, EyeOff, Building2, Banknote, Receipt, IdCard, MessageSquare, Mail, Plus, Globe, Smartphone,
} from "lucide-react";
import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
import { PageHeader } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

// ---------- types ----------
interface ProviderCred {
  id: string;
  contract: string;
  providerName: string;
  displayName: string;
  mode: string;
  enabled: boolean;
  credentialsConfigured: boolean;
  configuredKeys: string[];
  requiredFields: string[];
  missingFields: string[];
  isComplete: boolean;
  costBasisPoints: number;
  updatedAt: string;
}

// ---------- static manifest (mirrors the backend PROVIDER_MANIFEST) ----------
// This is static metadata — which fields each provider requires. It lives in
// the frontend so we can render cards for providers that don't yet have a DB
// row (the admin needs a place to enter the FIRST set of credentials). The
// backend GET route returns the DB-backed ProviderCred rows (with computed
// requiredFields / missingFields) for providers that DO have a row.
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
  flutterwave: { contract: "localTransfer", fields: ["secretKey", "publicKey", "webhookHash", "baseUrl"] },
  otpdev: { contract: "notification", fields: ["apiKey", "senderId", "templateId"] },
};

// ---------- static field labels ----------
const FIELD_LABELS: Record<string, string> = {
  apiKey: "API Key",
  secretKey: "Secret Key",
  contractCode: "Contract Code",
  baseUrl: "Base URL",
  appId: "App ID",
  publicKey: "Public Key",
  privateKey: "Private Key",
  senderId: "Sender ID",
  fromEmail: "From Email",
  publishableKey: "Publishable Key",
  webhookSecret: "Webhook Secret",
  restrictedKey: "Restricted Key",
  merchantId: "Merchant ID",
  serviceTypeId: "Service Type ID",
  clientSecret: "Client Secret",
  merchantCode: "Merchant Code",
  authBaseUrl: "Auth Base URL",
  user: "Gmail Address",
  pass: "App Password",
  fromName: "From Name",
  apiUrl: "API URL",
  token: "API Token",
  webhookHash: "Webhook Hash",
  templateId: "Template ID",
};

// ---------- static provider metadata (display only) ----------
const PROVIDER_META: Record<string, { display: string; desc: string; icon: React.ReactNode }> = {
  monnify: {
    display: "Monnify",
    desc: "Virtual account issuance & wallet funding via Wema / Access bank accounts.",
    icon: <Building2 className="h-4 w-4" />,
  },
  paystack: {
    display: "Paystack",
    desc: "Outbound NIP bank transfers to any Nigerian bank account.",
    icon: <Banknote className="h-4 w-4" />,
  },
  stripe: {
    display: "Stripe",
    desc: "Payment processing — card payments, payment intents, refunds, and webhooks.",
    icon: <Banknote className="h-4 w-4" />,
  },
  remita: {
    display: "Remita",
    desc: "Bill payments — utilities, government payments, and RRR-based collections.",
    icon: <Receipt className="h-4 w-4" />,
  },
  quickteller: {
    display: "Quickteller",
    desc: "Bill payments — airtime, data, electricity, TV, and utilities via Interswitch.",
    icon: <Receipt className="h-4 w-4" />,
  },
  baxi: {
    display: "Baxi",
    desc: "Bill payments — airtime, data, electricity, TV, and utilities.",
    icon: <Receipt className="h-4 w-4" />,
  },
  dojah: {
    display: "Dojah",
    desc: "KYC verification — NIN, BVN, and identity lookups.",
    icon: <IdCard className="h-4 w-4" />,
  },
  termii: {
    display: "Termii",
    desc: "SMS notifications — OTP delivery and transactional alerts.",
    icon: <MessageSquare className="h-4 w-4" />,
  },
  resend: {
    display: "Resend",
    desc: "Email notifications — receipts, statements, and security alerts.",
    icon: <Mail className="h-4 w-4" />,
  },
  "gmail-smtp": {
    display: "Gmail SMTP",
    desc: "Free email delivery via Gmail — temporary provider for OTPs and verification emails.",
    icon: <Mail className="h-4 w-4" />,
  },
  wise: {
    display: "Wise",
    desc: "International transfers — send money abroad via Wise API.",
    icon: <Globe className="h-4 w-4" />,
  },
  flutterwave: {
    display: "Flutterwave",
    desc: "Payments — card payments, bank transfers, and wallet funding.",
    icon: <Banknote className="h-4 w-4" />,
  },
  otpdev: {
    display: "GetOTP (otp.dev)",
    desc: "Temporary SMS OTP provider — generates and sends verification codes.",
    icon: <Smartphone className="h-4 w-4" />,
  },
};

// ---------- component ----------
export function ProviderCredentialsView() {
  // NOTE: apiFetch unwraps `json.data` from the { data, manifest } envelope,
  // so `data` here is directly the ProviderCred[] array (not an object). The
  // manifest is static (defined above) so the frontend can render cards for
  // providers that have no DB row yet.
  const { data, isLoading } = useApi<ProviderCred[] | null>("/api/admin/provider-credentials");

  const dbProviders = data ?? [];

  // Merge the static manifest with whatever ProviderConfig rows exist in the DB.
  // Every provider in the manifest gets a card — even if no DB row exists yet —
  // so the admin always has a place to enter credentials.
  const providers: ProviderCred[] = Object.keys(PROVIDER_MANIFEST).map((name) => {
    const existing = dbProviders.find((p) => p.providerName === name);
    if (existing) return existing;
    const meta = PROVIDER_META[name];
    const fields = PROVIDER_MANIFEST[name].fields;
    return {
      id: "",
      contract: PROVIDER_MANIFEST[name].contract,
      providerName: name,
      displayName: meta?.display ?? name,
      mode: "—",
      enabled: false,
      credentialsConfigured: false,
      configuredKeys: [],
      requiredFields: fields,
      missingFields: fields,
      isComplete: false,
      costBasisPoints: 0,
      updatedAt: "",
    };
  });

  const configuredCount = providers.filter((p) => p.credentialsConfigured).length;
  const enabledCount = providers.filter((p) => p.enabled).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Provider Credentials"
        description="Manage outbound API credentials for payment, KYC, and notification providers. Secrets are AES-256-GCM encrypted at rest and never displayed after saving."
        icon={<KeyRound className="h-5 w-5" />}
      />

      {/* Security notice */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Security notice</p>
            <p className="mt-0.5">
              Credentials are encrypted with AES-256-GCM and stored in the database. Saved values are{" "}
              <strong>never returned to the browser</strong> — only field names and a boolean "configured"
              status. Enabling a provider with incomplete credentials is blocked. CRON_SECRET and
              TURBOPAY_PII_KEY are not managed here — they remain environment variables.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Summary strip */}
      {!isLoading && providers.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="py-3">
            <CardContent className="px-4">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Providers</p>
              <p className="text-xl font-semibold">{providers.length}</p>
            </CardContent>
          </Card>
          <Card className="py-3">
            <CardContent className="px-4">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Configured</p>
              <p className="text-xl font-semibold text-emerald-600">{configuredCount}</p>
            </CardContent>
          </Card>
          <Card className="py-3">
            <CardContent className="px-4">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Enabled</p>
              <p className="text-xl font-semibold">{enabledCount}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {providers.map((p) => (
            <ProviderCard key={p.providerName} provider={p} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- single provider card ----------
function ProviderCard({ provider }: { provider: ProviderCred }) {
  const [showForm, setShowForm] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);

  const meta = PROVIDER_META[provider.providerName];
  const isUnconfigured = !provider.id; // no DB row yet
  const hasWarning = provider.enabled && !provider.isComplete;

  const handleToggle = async (enabled: boolean) => {
    if (isUnconfigured) {
      toast.error("Save credentials first, then enable the provider.");
      return;
    }
    setToggling(true);
    try {
      await apiFetch(`/api/admin/provider-credentials/${provider.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      toast.success(`${provider.displayName} ${enabled ? "enabled" : "disabled"}`);
      mutateApi("/api/admin/provider-credentials");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? `Could not ${enabled ? "enable" : "disable"} provider`);
    } finally {
      setToggling(false);
    }
  };

  return (
    <Card className={cn(hasWarning && "border-destructive/40", isUnconfigured && "border-dashed")}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
              {meta?.icon ?? <KeyRound className="h-4 w-4" />}
            </div>
            <div>
              <CardTitle className="text-base">{provider.displayName}</CardTitle>
              <p className="text-[11px] text-muted-foreground">{meta?.desc}</p>
            </div>
          </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">{provider.contract}</Badge>
              {isUnconfigured ? (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">Not configured</Badge>
              ) : provider.enabled ? (
                <Badge className="bg-emerald-500/10 text-emerald-600">
                  <Power className="mr-1 h-3 w-3" /> Enabled
                </Badge>
              ) : (
                <Badge variant="outline">
                  <Power className="mr-1 h-3 w-3" /> Disabled
                </Badge>
              )}
              {!isUnconfigured && (
                <Switch
                  checked={provider.enabled}
                  onCheckedChange={handleToggle}
                  disabled={toggling}
                />
              )}
            </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Credential status — show every required field with its set/unset state */}
        <div className="space-y-1.5">
          {provider.requiredFields.map((field) => {
            const isConfigured = provider.configuredKeys.includes(field);
            return (
              <div key={field} className="flex items-center gap-2 text-xs">
                {isConfigured ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
                )}
                <span className={cn("font-medium", isConfigured ? "text-foreground" : "text-muted-foreground")}>
                  {FIELD_LABELS[field] ?? field}
                </span>
                <span className="text-muted-foreground">
                  {isConfigured ? "✓ Configured" : "Not set"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Warning for enabled-but-incomplete */}
        {hasWarning && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">
              {provider.displayName} is enabled but {provider.missingFields.length} field(s) missing:{" "}
              <strong>{provider.missingFields.join(", ")}</strong>. Outbound calls will fail or fall back to
              insecure defaults.
            </p>
          </div>
        )}

        {/* Mode + cost + last updated */}
        {!isUnconfigured && (
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>Mode: <strong className="text-foreground">{provider.mode}</strong></span>
            <span>Cost: <strong className="text-foreground">{provider.costBasisPoints > 0 ? `${(provider.costBasisPoints / 100).toFixed(2)}%` : "—"}</strong></span>
            {provider.updatedAt && (
              <span>Last updated: {new Date(provider.updatedAt).toLocaleString("en-NG")}</span>
            )}
          </div>
        )}

        <Separator />

        {/* Toggle form */}
        {showForm ? (
          <CredentialForm provider={provider} onClose={() => setShowForm(false)} />
        ) : (
          <Button
            variant={isUnconfigured ? "default" : "outline"}
            size="sm"
            onClick={() => setShowForm(true)}
          >
            {isUnconfigured ? (
              <>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add credentials
              </>
            ) : (
              <>
                <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Update credentials
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- credential form ----------
function CredentialForm({ provider, onClose }: { provider: ProviderCred; onClose: () => void }) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [showValues, setShowValues] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [costBps, setCostBps] = React.useState(String(provider.costBasisPoints ?? 0));

  const handleSave = async () => {
    // Filter out empty values — only fields the admin actually filled in get sent.
    const credentials = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v.trim().length > 0),
    );
    if (Object.keys(credentials).length === 0 && costBps === String(provider.costBasisPoints ?? 0)) {
      toast.error("Fill in at least one field or change the cost");
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        providerName: provider.providerName,
        displayName: provider.displayName,
      };
      if (Object.keys(credentials).length > 0) body.credentials = credentials;
      const bps = parseInt(costBps, 10);
      if (!isNaN(bps) && bps >= 0) body.costBasisPoints = bps;

      await apiFetch("/api/admin/provider-credentials", {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast.success("Credentials saved (encrypted)");
      mutateApi("/api/admin/provider-credentials");
      onClose();
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not save credentials");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">
          {provider.credentialsConfigured ? "Update credentials" : "Add credentials"} — {provider.displayName}
        </p>
        <button
          onClick={() => setShowValues((s) => !s)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {showValues ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {showValues ? "Hide" : "Show"} values
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Only fill in the fields you want to save. Empty fields are ignored. Previously saved values are not
        shown — enter a new value to overwrite.
      </p>

      {provider.requiredFields.map((field) => (
        <div key={field} className="space-y-1">
          <Label className="text-xs">
            {FIELD_LABELS[field] ?? field}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Input
            type={showValues ? "text" : "password"}
            value={values[field] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [field]: e.target.value }))}
            placeholder={
              provider.configuredKeys.includes(field)
                ? "•••••••• (configured — enter new to overwrite)"
                : "Enter value"
            }
            className="text-xs"
            autoComplete="off"
          />
        </div>
      ))}

      {/* Cost basis points — used by the cost-aware router to pick the cheapest healthy provider. */}
      <div className="space-y-1">
        <Label className="text-xs">Cost (basis points)</Label>
        <Input
          type="number"
          min={0}
          max={10000}
          value={costBps}
          onChange={(e) => setCostBps(e.target.value)}
          placeholder="0"
          className="text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          Commission rate for this provider on this contract. 150 = 1.5%. The router picks the cheapest healthy
          provider when no manual override is set.
        </p>
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button size="sm" className="flex-1" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : (
            <>
              <Save className="mr-1.5 h-3.5 w-3.5" /> Save (encrypt)
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
