"use client";

import * as React from "react";
import {
  Webhook, Copy, Check, ShieldCheck, ShieldAlert, Power, RefreshCw, Save, Plus,
} from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";

// ---------- types ----------
interface WebhookEndpoint {
  id: string;
  providerName: string;
  contract: string;
  url: string;
  secretConfigured: boolean;
  enabled: boolean;
  maxRetries: number;
  retryDelaySec: number;
  verified: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface WebhookEventRow {
  id: string;
  provider: string;
  providerRef: string;
  payload: string;
  signature: string | null;
  status: string;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
}

// ─── All 10 registered webhook providers ───────────────────────
// Each maps to a handler registered in the webhook registry
// (src/lib/turbocore/webhooks/handlers/*). The URL is the inbound
// endpoint external providers POST to. The signatureHeader is the
// HTTP header the provider sends the HMAC signature in. The envVar
// is the fallback env variable if no DB secret is set.
const KNOWN_PROVIDERS = [
  {
    name: "monnify",
    contract: "WALLET_FUNDING",
    url: "/api/turbocore/webhooks/monnify",
    signatureHeader: "x-monnify-signature",
    envVar: "TURBOPAY_MONNIFY_WEBHOOK_SECRET",
    description: "Virtual account funding — credits wallet when a deposit hits a reserved Wema/Access account.",
  },
  {
    name: "paystack",
    contract: "TRANSFER_STATUS",
    url: "/api/turbocore/webhooks/paystack",
    signatureHeader: "x-paystack-signature",
    envVar: "PAYSTACK_SECRET_KEY",
    description: "Outbound transfer status (success/failed) + card funding callbacks.",
  },
  {
    name: "baxi",
    contract: "BILL_PAYMENT",
    url: "/api/turbocore/webhooks/baxi",
    signatureHeader: "x-baxi-signature",
    envVar: "BAXI_API_KEY",
    description: "Bill payment callbacks — airtime, data, electricity token delivery, TV.",
  },
  {
    name: "intl-receiving",
    contract: "INBOUND_TRANSFER",
    url: "/api/turbocore/webhooks/intl-receiving",
    signatureHeader: "x-intl-signature",
    envVar: "TURBOCORE_INTL_WEBHOOK_SECRET",
    description: "Inbound international payment — FX conversion + wallet credit (Wise/Payoneer).",
  },
  {
    name: "flutterwave",
    contract: "INTERNATIONAL",
    url: "/api/turbocore/webhooks/flutterwave",
    signatureHeader: "verif-hash",
    envVar: "FLW_SECRET_KEY",
    description: "Flutterwave transfer + card funding callbacks (cross-border).",
  },
  {
    name: "wise",
    contract: "CROSS_BORDER",
    url: "/api/turbocore/webhooks/wise",
    signatureHeader: "x-signature",
    envVar: "WISE_WEBHOOK_SECRET",
    description: "Wise transfer state changes — processing → sent → settled.",
  },
  {
    name: "stripe-issuing",
    contract: "CARD_AUTHORIZATION",
    url: "/api/turbocore/webhooks/stripe-issuing",
    signatureHeader: "stripe-signature",
    envVar: "STRIPE_ISSUING_WEBHOOK_SECRET",
    description: "Virtual card authorizations — approve/decline purchases in real-time.",
  },
  {
    name: "dojah",
    contract: "KYC",
    url: "/api/turbocore/webhooks/dojah",
    signatureHeader: "x-dojah-signature",
    envVar: "DOJAH_PRIVATE_KEY",
    description: "Async KYC verification results — NIN/BVN identity lookups.",
  },
  {
    name: "termii",
    contract: "SMS_DELIVERY",
    url: "/api/turbocore/webhooks/termii",
    signatureHeader: "x-termii-signature",
    envVar: "TERMII_API_KEY",
    description: "SMS delivery receipts — OTP + transactional alert status.",
  },
  {
    name: "resend",
    contract: "EMAIL_DELIVERY",
    url: "/api/turbocore/webhooks/resend",
    signatureHeader: "svix-signature",
    envVar: "RESEND_WEBHOOK_SECRET",
    description: "Email delivery callbacks — receipts, statements, security alerts.",
  },
];

const EVENT_STATUS_TONE: Record<string, string> = {
  PROCESSED: "bg-success/15 text-success",
  PENDING: "bg-warning/15 text-warning-foreground",
  FAILED: "bg-destructive/15 text-destructive",
  IGNORED: "bg-muted text-muted-foreground",
};

// ============================================================
// Main
// ============================================================
export function WebhookManagement() {
  const endpointsPath = "/api/admin/webhooks/manage";
  const eventsPath = "/api/admin/webhooks";

  const { data: endpoints, isLoading: epLoading } = useApi<WebhookEndpoint[]>(endpointsPath);
  const { data: events, isLoading: evLoading } = useApi<WebhookEventRow[]>(eventsPath);

  const knownCards = KNOWN_PROVIDERS.map((k) => ({
    known: k,
    endpoint: endpoints?.find((e) => e.providerName === k.name) ?? null,
  }));
  const extras = (endpoints ?? []).filter((e) => !KNOWN_PROVIDERS.some((k) => k.name === e.providerName));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Webhook Management"
        description="Configure inbound webhook endpoints and review delivery history."
        icon={<Webhook className="h-5 w-5" />}
      />

      {epLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {knownCards.map(({ known, endpoint }) => (
            <ProviderCard
              key={known.name}
              known={known}
              endpoint={endpoint}
              events={(events ?? []).filter((e) => e.provider === known.name).slice(0, 5)}
              eventsLoading={evLoading}
            />
          ))}
          {extras.map((endpoint) => (
            <ProviderCard
              key={endpoint.id}
              known={{ name: endpoint.providerName, contract: endpoint.contract, url: endpoint.url, signatureHeader: "—", envVar: "—", description: "Custom webhook endpoint." }}
              endpoint={endpoint}
              events={(events ?? []).filter((e) => e.provider === endpoint.providerName).slice(0, 5)}
              eventsLoading={evLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Provider card
// ============================================================
function ProviderCard({
  known, endpoint, events, eventsLoading,
}: {
  known: { name: string; contract: string; url: string; signatureHeader?: string; envVar?: string; description?: string };
  endpoint: WebhookEndpoint | null;
  events: WebhookEventRow[];
  eventsLoading: boolean;
}) {
  const endpointsPath = "/api/admin/webhooks/manage";
  const [secretOpen, setSecretOpen] = React.useState(false);
  const [secret, setSecret] = React.useState("");
  const [savingSecret, setSavingSecret] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  // Step-up OTP flow for secret writes (required by the backend).
  const [otpPhase, setOtpPhase] = React.useState<"idle" | "initiating" | "awaiting-otp">("idle");
  const [otp, setOtp] = React.useState("");
  const [devOtp, setDevOtp] = React.useState<string | null>(null);

  const fullUrl = endpoint?.url ?? known.url;

  function copyUrl() {
    const absolute = `${window.location.origin}${fullUrl}`;
    navigator.clipboard?.writeText(absolute);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success("Webhook URL copied");
  }

  /** Phase 1 — validate the secret, then initiate a step-up OTP. */
  async function initiateStepUp() {
    if (!endpoint) return;
    if (secret.length < 16) {
      toast.error("Secret must be at least 16 characters");
      return;
    }
    setOtpPhase("initiating");
    try {
      const res = await apiFetch<{ otp?: string; sent?: boolean; expiresAt?: string }>(
        "/api/security/step-up",
        { method: "POST", body: JSON.stringify({ action: "initiate", reason: "webhook_secret_change" }) },
      );
      // Dev/sandbox returns the OTP for convenience; production returns { sent: true }.
      if (res.otp) {
        setDevOtp(res.otp);
        toast.info(`Step-up OTP generated: ${res.otp} (dev/sandbox)`);
      } else {
        setDevOtp(null);
        toast.success("A 6-digit verification code was sent to your phone/email.");
      }
      setOtpPhase("awaiting-otp");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not send verification code");
      setOtpPhase("idle");
    }
  }

  /** Phase 2 — verify the OTP + save the secret in one atomic request. */
  async function confirmSave() {
    if (!endpoint) return;
    if (!/^\d{6}$/.test(otp)) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setSavingSecret(true);
    try {
      await apiFetch(`/api/admin/webhooks/manage/${endpoint.id}/secret`, {
        method: "POST",
        body: JSON.stringify({ secret, otp }),
      });
      toast.success("Secret updated (signature verification now active)");
      resetSecretForm();
      mutateApi(endpointsPath);
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Failed — re-initiate the verification");
      // OTP was consumed (single-use) — go back to phase 1 so the admin can re-initiate.
      setOtpPhase("idle");
      setOtp("");
      setDevOtp(null);
    } finally {
      setSavingSecret(false);
    }
  }

  function resetSecretForm() {
    setSecret("");
    setOtp("");
    setDevOtp(null);
    setOtpPhase("idle");
    setSecretOpen(false);
  }

  async function toggleEnabled(next: boolean) {
    if (!endpoint) return;
    setToggling(true);
    try {
      await apiFetch(`/api/admin/webhooks/manage/${endpoint.id}`, {
        method: "PATCH", body: JSON.stringify({ action: next ? "enable" : "disable" }),
      });
      toast.success(`Webhook ${next ? "enabled" : "disabled"}`);
      mutateApi(endpointsPath);
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Failed");
    } finally {
      setToggling(false);
    }
  }

  async function verify() {
    if (!endpoint) return;
    setVerifying(true);
    try {
      await apiFetch(`/api/admin/webhooks/manage/${endpoint.id}`, { method: "PATCH", body: JSON.stringify({ action: "verify" }) });
      toast.success("Webhook marked verified");
      mutateApi(endpointsPath);
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Failed");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Webhook className="h-4 w-4 shrink-0" /> {known.name}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{known.contract}</p>
            {known.description && (
              <p className="mt-1 text-[11px] text-muted-foreground">{known.description}</p>
            )}
          </div>
          {endpoint ? (
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="outline" className={cn("text-[10px]", endpoint.enabled ? "text-success" : "text-muted-foreground")}>
                {endpoint.enabled ? "Enabled" : "Disabled"}
              </Badge>
              {endpoint.verified ? (
                <Badge variant="outline" className="text-[10px] text-success"><ShieldCheck className="mr-1 h-3 w-3" /> Verified</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-warning-foreground"><ShieldAlert className="mr-1 h-3 w-3" /> Unverified</Badge>
              )}
            </div>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">Not configured</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Webhook URL */}
        <div className="space-y-1.5">
          <Label className="text-xs">Webhook URL</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border bg-muted px-2 py-1.5 text-xs">{fullUrl}</code>
            <Button size="icon" variant="outline" onClick={copyUrl} title="Copy URL">
              {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Signature header + env fallback info */}
        {known.signatureHeader && (
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-md border bg-muted/40 px-2 py-1.5">
              <span className="text-muted-foreground">Signature header</span>
              <p className="font-mono font-medium">{known.signatureHeader}</p>
            </div>
            <div className="rounded-md border bg-muted/40 px-2 py-1.5">
              <span className="text-muted-foreground">Env fallback</span>
              <p className="font-mono font-medium truncate">{known.envVar ?? "—"}</p>
            </div>
          </div>
        )}

        {/* Secret status + set/update form */}
        {endpoint && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">HMAC secret</Label>
              <Badge variant="outline" className={cn("text-[10px]", endpoint.secretConfigured ? "text-success" : "text-destructive")}>
                {endpoint.secretConfigured ? "✅ Configured" : "❌ Not set"}
              </Badge>
            </div>
            {secretOpen ? (
              <div className="space-y-2">
                {/* Phase 1: enter the new secret */}
                <Input
                  type="password"
                  placeholder="New secret (min 16 chars)"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  disabled={otpPhase === "awaiting-otp"}
                />

                {otpPhase === "awaiting-otp" ? (
                  <>
                    <p className="text-[11px] text-muted-foreground">
                      For security, enter the 6-digit verification code sent to you to confirm this change.
                      {devOtp && (
                        <> <span className="font-medium text-foreground">(Dev code: {devOtp})</span></>
                      )}
                    </p>
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6-digit code"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="font-mono tracking-widest"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={confirmSave} disabled={savingSecret || otp.length !== 6}>
                        <Save className="mr-1 h-3.5 w-3.5" /> {savingSecret ? "Saving…" : "Confirm & save"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setOtpPhase("idle"); setOtp(""); setDevOtp(null); }}>
                        Back
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={initiateStepUp} disabled={otpPhase === "initiating" || secret.length < 16}>
                      <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                      {otpPhase === "initiating" ? "Sending code…" : "Continue (verify)"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={resetSecretForm}>Cancel</Button>
                  </div>
                )}
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setSecretOpen(true)}>
                {endpoint.secretConfigured ? "Update secret" : "Set secret"}
              </Button>
            )}
          </div>
        )}

        {/* Enable/disable + Verify */}
        {endpoint && (
          <div className="flex items-center justify-between rounded-md border p-2">
            <div className="flex items-center gap-2">
              <Power className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Endpoint active</span>
            </div>
            <Switch checked={endpoint.enabled} disabled={toggling} onCheckedChange={toggleEnabled} />
          </div>
        )}

        {endpoint && !endpoint.verified && (
          <Button size="sm" variant="outline" className="w-full" onClick={verify} disabled={verifying}>
            <ShieldCheck className="mr-1 h-3.5 w-3.5" /> {verifying ? "Verifying…" : "Mark as verified"}
          </Button>
        )}

        {/* Last 5 events */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Recent events</Label>
            <Button size="sm" variant="ghost" onClick={() => { mutateApi("/api/admin/webhooks"); }}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
          {eventsLoading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : events.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">No events received.</p>
          ) : (
            <ScrollArea className="max-h-44">
              <div className="space-y-1.5">
                {events.map((e) => (
                  <div key={e.id} className="flex items-center justify-between rounded-md border p-2 text-xs">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px]">{e.providerRef}</p>
                      <p className="text-muted-foreground">{new Date(e.receivedAt).toLocaleString("en-NG")}</p>
                    </div>
                    <Badge variant="outline" className={cn("text-[10px]", EVENT_STATUS_TONE[e.status] ?? "")}>{e.status}</Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {!endpoint && (
          <RegisterButton known={known} onDone={() => mutateApi(endpointsPath)} />
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Register button — creates a WebhookEndpoint row for a provider
// ============================================================
function RegisterButton({
  known,
  onDone,
}: {
  known: { name: string; contract: string; url: string };
  onDone: () => void;
}) {
  const [loading, setLoading] = React.useState(false);

  async function register() {
    setLoading(true);
    try {
      await apiFetch("/api/admin/webhooks/manage", {
        method: "POST",
        body: JSON.stringify({
          providerName: known.name,
          contract: known.contract,
          url: `${window.location.origin}${known.url}`,
          enabled: true,
        }),
      });
      toast.success(`${known.name} endpoint registered — now set the HMAC secret`);
      onDone();
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not register endpoint");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button size="sm" className="w-full" onClick={register} disabled={loading}>
      <Plus className="mr-1.5 h-3.5 w-3.5" />
      {loading ? "Registering…" : "Register endpoint"}
    </Button>
  );
}
