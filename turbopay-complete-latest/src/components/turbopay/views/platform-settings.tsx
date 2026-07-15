"use client";

import * as React from "react";
import { toast } from "sonner";
import { Settings, Server, Shield, Key, Activity, Globe, Webhook, History, Zap } from "lucide-react";
import { PageHeader } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiFetch } from "@/lib/turbopay/client";

export function PlatformSettingsView() {
  return (
    <div className="space-y-5">
      <PageHeader title="Platform Settings" description="Manage providers, routing, health, secrets, and compliance." icon={<Settings className="h-5 w-5" />} />
      <Tabs defaultValue="providers" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="providers"><Server className="mr-1 h-3.5 w-3.5" />Providers</TabsTrigger>
          <TabsTrigger value="routing"><Zap className="mr-1 h-3.5 w-3.5" />Routing</TabsTrigger>
          <TabsTrigger value="health"><Activity className="mr-1 h-3.5 w-3.5" />Health</TabsTrigger>
          <TabsTrigger value="secrets"><Key className="mr-1 h-3.5 w-3.5" />Secrets</TabsTrigger>
          <TabsTrigger value="limits"><Shield className="mr-1 h-3.5 w-3.5" />KYC Limits</TabsTrigger>
          <TabsTrigger value="aml"><Shield className="mr-1 h-3.5 w-3.5" />AML Policy</TabsTrigger>
          <TabsTrigger value="webhooks"><Webhook className="mr-1 h-3.5 w-3.5" />Webhooks</TabsTrigger>
          <TabsTrigger value="history"><History className="mr-1 h-3.5 w-3.5" />Config History</TabsTrigger>
        </TabsList>

        <TabsContent value="providers" className="mt-4"><ProvidersTab /></TabsContent>
        <TabsContent value="routing" className="mt-4"><RoutingTab /></TabsContent>
        <TabsContent value="health" className="mt-4"><HealthTab /></TabsContent>
        <TabsContent value="secrets" className="mt-4"><SecretsTab /></TabsContent>
        <TabsContent value="limits" className="mt-4"><KycLimitsTab /></TabsContent>
        <TabsContent value="aml" className="mt-4"><AmlPolicyTab /></TabsContent>
        <TabsContent value="webhooks" className="mt-4"><WebhooksTab /></TabsContent>
        <TabsContent value="history" className="mt-4"><ConfigHistoryTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Providers Tab ────────────────────────────────────────────

function ProvidersTab() {
  const [data, setData] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try { const res = await apiFetch<any[]>("/api/admin/providers"); setData(res ?? []); } catch (e: any) { if (e?.status === 401) return; toast.error(e.message); }
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Provider Configurations</CardTitle><Button size="sm" onClick={load}>Refresh</Button></CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-48 w-full" /> : data.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No providers configured. Use the API to add providers.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="pb-2 pr-3">Contract</th><th className="pb-2 pr-3">Provider</th><th className="pb-2 pr-3">Mode</th><th className="pb-2 pr-3">Enabled</th><th className="pb-2 pr-3">Credentials</th><th className="pb-2 pr-3">Health</th><th className="pb-2 pr-3">Priority</th></tr></thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2 pr-3 font-medium">{p.contract}</td>
                    <td className="py-2 pr-3">{p.displayName}</td>
                    <td className="py-2 pr-3"><Badge variant={p.mode === "production" ? "default" : p.mode === "sandbox" ? "secondary" : "outline"}>{p.mode}</Badge></td>
                    <td className="py-2 pr-3"><Badge variant={p.enabled ? "default" : "destructive"}>{p.enabled ? "On" : "Off"}</Badge></td>
                    <td className="py-2 pr-3 text-xs">{p.credentialsConfigured ? `● ${p.credentialKeys.join(", ")}` : "—"}</td>
                    <td className="py-2 pr-3"><HealthDot status={p.lastHealthStatus} /></td>
                    <td className="py-2 pr-3 tabular-nums">{p.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Routing Tab ──────────────────────────────────────────────

function RoutingTab() {
  const [contracts] = React.useState(["virtualAccount", "walletFunding", "billPayment", "kyc", "notification", "localTransfer", "internationalTransfer", "internationalReceiving", "crossBorderSettlement", "exchangeRate"]);
  const [selected, setSelected] = React.useState("billPayment");
  const [route, setRoute] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    apiFetch<any>(`/api/admin/provider-routing?contract=${selected}`)
      .then((r) => setRoute(r)).catch(() => setRoute(null)).finally(() => setLoading(false));
  }, [selected]);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Provider Routing</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {contracts.map((c) => (
            <button key={c} onClick={() => setSelected(c)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${selected === c ? "border-primary bg-primary/5 text-primary" : "hover:bg-accent"}`}>{c}</button>
          ))}
        </div>
        {loading ? <Skeleton className="h-32 w-full" /> : route ? (
          <div className="space-y-3">
            {route.manualOverride && <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"><strong>Manual Override:</strong> {route.manualOverride}</div>}
            {route.tiers?.map((t: any) => (
              <div key={t.tier} className="flex items-center justify-between rounded-lg border p-3">
                <div><span className="font-medium">{t.tier}</span> — {t.providerName}</div>
                <div className="flex items-center gap-2"><Badge variant={t.enabled ? "default" : "outline"}>{t.enabled ? "Active" : "Disabled"}</Badge>{t.canaryPercent > 0 && <Badge variant="secondary">{t.canaryPercent}% canary</Badge>}</div>
              </div>
            ))}
            {route.tiers?.length === 0 && <p className="text-sm text-muted-foreground">No routes configured for {selected}.</p>}
          </div>
        ) : <p className="text-sm text-muted-foreground">No route data available.</p>}
      </CardContent>
    </Card>
  );
}

// ─── Health Tab ───────────────────────────────────────────────

function HealthTab() {
  const [data, setData] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try { const res = await apiFetch<any[]>("/api/admin/provider-health"); setData(res ?? []); } catch { setData([]); }
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]);

  const runCheck = async (id: string) => {
    try { await apiFetch<any>(`/api/admin/provider-health/${id}`, { method: "POST" }); toast.success("Health check completed"); load(); } catch (e: any) { if (e?.status === 401) return; toast.error(e.message); }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Provider Health</CardTitle><Button size="sm" variant="outline" onClick={load}>Refresh</Button></CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-48 w-full" /> : data.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No providers configured.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="pb-2 pr-3">Provider</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3">Latency</th><th className="pb-2 pr-3">Failures (24h)</th><th className="pb-2 pr-3">Last Check</th><th className="pb-2 pr-3">Action</th></tr></thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.providerConfigId} className="border-b">
                    <td className="py-2 pr-3 font-medium">{p.displayName}</td>
                    <td className="py-2 pr-3"><HealthDot status={p.status} /></td>
                    <td className="py-2 pr-3 tabular-nums">{p.latencyMs ? `${p.latencyMs}ms` : "—"}</td>
                    <td className="py-2 pr-3 tabular-nums">{p.recentFailures}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{p.lastCheckAt ? new Date(p.lastCheckAt).toLocaleTimeString("en-NG") : "—"}</td>
                    <td className="py-2 pr-3"><Button size="sm" variant="ghost" onClick={() => runCheck(p.providerConfigId)}>Check</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Secrets Tab ──────────────────────────────────────────────

function SecretsTab() {
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => { apiFetch<any>("/api/admin/secrets-status").then(setData).catch(() => {}).finally(() => setLoading(false)); }, []);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <p className="text-sm text-muted-foreground">Unable to load secrets status.</p>;

  return (
    <div className="space-y-4">
      {!data.ready && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠ Critical secrets are missing. The application cannot start in production without DATABASE_URL and TURBOPAY_PII_KEY.</div>}
      <Card>
        <CardHeader><CardTitle className="text-base">Environment Secrets</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data.envSecrets.map((s: any) => (
              <div key={s.key} className="flex items-center justify-between border-b py-2 text-sm">
                <div><span className="font-medium">{s.label}</span>{s.hint && <span className="ml-2 text-xs text-muted-foreground">{s.hint}</span>}</div>
                <div className="flex items-center gap-2">{s.configured ? <Badge variant="default">✅ Configured</Badge> : <Badge variant="destructive">❌ Missing</Badge>}<span className="text-xs text-muted-foreground">{s.source}</span></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      {data.providerConfigs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Provider Credentials (DB-stored)</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.providerConfigs.map((s: any) => (
                <div key={s.key} className="flex items-center justify-between border-b py-2 text-sm">
                  <span className="font-medium">{s.label}</span>
                  <Badge variant={s.configured ? "default" : "destructive"}>{s.configured ? "✅ Configured" : "❌ Missing"}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── KYC Limits Tab ───────────────────────────────────────────

function KycLimitsTab() {
  const [data, setData] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => { apiFetch<any[]>("/api/admin/kyc-limits").then(setData).catch(() => {}).finally(() => setLoading(false)); }, []);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">KYC Tier Limits</CardTitle></CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-32 w-full" /> : data.length === 0 ? <p className="text-sm text-muted-foreground">No DB-configured limits. Using hardcoded defaults from types.ts.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="pb-2 pr-3">Tier</th><th className="pb-2 pr-3">Product</th><th className="pb-2 pr-3">Single Tx (₦)</th><th className="pb-2 pr-3">Daily (₦)</th><th className="pb-2 pr-3">Max Balance (₦)</th><th className="pb-2 pr-3">Label</th></tr></thead>
              <tbody>
                {data.map((l) => (
                  <tr key={l.id} className="border-b">
                    <td className="py-2 pr-3 font-medium">Tier {l.tier}</td><td className="py-2 pr-3">{l.product}</td>
                    <td className="py-2 pr-3 tabular-nums">{(l.singleTxMinor / 100).toLocaleString()}</td>
                    <td className="py-2 pr-3 tabular-nums">{(l.dailyTxMinor / 100).toLocaleString()}</td>
                    <td className="py-2 pr-3 tabular-nums">{(l.balanceMinor / 100).toLocaleString()}</td>
                    <td className="py-2 pr-3 text-xs">{l.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Limits without a DB row fall back to the hardcoded defaults in types.ts (Tier 1: ₦50k/₦150k/₦300k, Tier 2: ₦500k/₦2M/₦5M, Tier 3: ₦5M/₦20M/unlimited).</p>
      </CardContent>
    </Card>
  );
}

// ─── AML Policy Tab ───────────────────────────────────────────

function AmlPolicyTab() {
  const [data, setData] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try { const res = await apiFetch<any[]>("/api/admin/aml-policy"); setData(res ?? []); } catch { setData([]); }
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const activate = async (id: string) => {
    try { await apiFetch<any>(`/api/admin/aml-policy?action=activate&id=${id}`, { method: "PATCH" }); toast.success("AML policy activated"); load(); } catch (e: any) { if (e?.status === 401) return; toast.error(e.message); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">AML Policies</CardTitle></CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-32 w-full" /> : data.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No AML policies configured. Using hardcoded defaults.</p> : (
          <div className="space-y-3">
            {data.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border p-3">
                <div><span className="font-medium">{p.name}</span>{p.description && <span className="ml-2 text-xs text-muted-foreground">{p.description}</span>}</div>
                <div className="flex items-center gap-2">
                  <Badge variant={p.active ? "default" : "outline"}>{p.active ? "Active" : "Inactive"}</Badge>
                  {!p.active && <Button size="sm" variant="outline" onClick={() => activate(p.id)}>Activate</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">The active policy (or hardcoded default) controls velocity thresholds, large-amount flags, rapid-transfer detection, and auto-freeze behaviour.</p>
      </CardContent>
    </Card>
  );
}

// ─── Webhooks Tab ─────────────────────────────────────────────

function WebhooksTab() {
  const [data, setData] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try { const res = await apiFetch<any[]>("/api/admin/webhooks/manage"); setData(res ?? []); } catch { setData([]); }
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const verify = async (id: string) => {
    try { await apiFetch<any>(`/api/admin/webhooks/manage/${id}`, { method: "PATCH", body: JSON.stringify({ action: "verify" }) }); toast.success("Webhook marked verified"); load(); } catch (e: any) { if (e?.status === 401) return; toast.error(e.message); }
  };

  const toggle = async (id: string, enabled: boolean) => {
    try { await apiFetch<any>(`/api/admin/webhooks/manage/${id}`, { method: "PATCH", body: JSON.stringify({ action: enabled ? "disable" : "enable" }) }); toast.success(`Webhook ${enabled ? "disabled" : "enabled"}`); load(); } catch (e: any) { if (e?.status === 401) return; toast.error(e.message); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Webhook Endpoints</CardTitle></CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-32 w-full" /> : data.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No webhook endpoints registered.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="pb-2 pr-3">Provider</th><th className="pb-2 pr-3">Contract</th><th className="pb-2 pr-3">URL</th><th className="pb-2 pr-3">Secret</th><th className="pb-2 pr-3">Verified</th><th className="pb-2 pr-3">Actions</th></tr></thead>
              <tbody>
                {data.map((w) => (
                  <tr key={w.id} className="border-b">
                    <td className="py-2 pr-3 font-medium">{w.providerName}</td>
                    <td className="py-2 pr-3">{w.contract}</td>
                    <td className="py-2 pr-3 text-xs max-w-xs truncate">{w.url}</td>
                    <td className="py-2 pr-3">{w.secretConfigured ? "✅" : "—"}</td>
                    <td className="py-2 pr-3"><Badge variant={w.verified ? "default" : "outline"}>{w.verified ? "✅" : "❌"}</Badge></td>
                    <td className="py-2 pr-3"><div className="flex gap-1">{!w.verified && <Button size="sm" variant="ghost" onClick={() => verify(w.id)}>Verify</Button>}<Button size="sm" variant="ghost" onClick={() => toggle(w.id, w.enabled)}>{w.enabled ? "Disable" : "Enable"}</Button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Config History Tab ───────────────────────────────────────

function ConfigHistoryTab() {
  const [data, setData] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => { apiFetch<any[]>("/api/admin/config-history").then(setData).catch(() => {}).finally(() => setLoading(false)); }, []);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Configuration Change History</CardTitle></CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-48 w-full" /> : data.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No configuration changes recorded.</p> : (
          <ScrollArea className="max-h-96">
            <div className="space-y-2">
              {data.map((c) => (
                <div key={c.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                  <Badge variant={c.action === "CREATE" ? "default" : c.action === "DELETE" ? "destructive" : "secondary"}>{c.action}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{c.entityType} <span className="text-xs text-muted-foreground">#{c.version}</span></p>
                    <p className="text-xs text-muted-foreground">{c.changedByName ?? "system"} · {new Date(c.createdAt).toLocaleString("en-NG")}</p>
                    {c.reason && <p className="text-xs text-muted-foreground italic">"{c.reason}"</p>}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function HealthDot({ status }: { status: string }) {
  const color = status === "healthy" ? "bg-emerald-500" : status === "degraded" ? "bg-amber-500" : status === "down" ? "bg-red-500" : "bg-gray-400";
  return <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${color}`} />{status}</span>;
}
