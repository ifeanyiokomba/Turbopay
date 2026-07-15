"use client";

import * as React from "react";
import {
  Activity, Database, Server, Plug, Snowflake, IdCard,
  ShieldAlert, Briefcase, BellRing, Webhook, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { useApi, mutateApi } from "@/lib/turbopay/client";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// ---------- types ----------
interface HealthData {
  overall: "healthy" | "degraded" | "down";
  timestamp: string;
  database: { status: string; latencyMs: number | null };
  redis: { status: string; note: string };
  providers: { contract: string; name: string; mode: string }[];
  stats: {
    users: { total: number; active: number };
    wallets: { total: number; frozen: number };
    transactions: { total: number; success: number; pending: number; failed: number };
    risk: { unresolvedAmlFlags: number; openComplianceCases: number; pendingKyc: number };
    operations: { pendingWebhooks: number; recentAuditEvents24h: number; criticalAuditEvents24h: number };
    reconciliation: {
      id: string; type: string; status: string; walletsChecked: number;
      driftDetected: number; driftCorrected: number;
      startedAt: string; completedAt: string | null;
    } | null;
  };
}
interface NotificationsList {
  items: unknown[];
  stats: {
    byStatus: { status: string; count: number }[];
    byChannel: { channel: string; count: number }[];
  };
}
interface WebhookEventRow {
  id: string;
  provider: string;
  status: string;
}

const OVERALL_META: Record<string, { label: string; tone: string; icon: React.ReactNode }> = {
  healthy: { label: "All Systems Operational", tone: "bg-success text-success-foreground", icon: <Activity className="h-5 w-5" /> },
  degraded: { label: "Degraded Performance", tone: "bg-warning text-warning-foreground", icon: <ShieldAlert className="h-5 w-5" /> },
  down: { label: "Service Outage", tone: "bg-destructive text-white", icon: <ShieldAlert className="h-5 w-5" /> },
};

const HEALTH_TONE: Record<string, string> = {
  healthy: "text-success",
  degraded: "text-warning-foreground",
  down: "text-destructive",
  not_configured: "text-muted-foreground",
};

// ============================================================
// Main
// ============================================================
export function SystemHealth() {
  const healthPath = "/api/admin/system/health";
  const { data, isLoading, error } = useApi<HealthData>(healthPath, { refreshMs: 30_000 });

  // Failed notifications: read from /api/admin/notifications stats.
  const { data: notifs } = useApi<NotificationsList>("/api/admin/notifications?limit=1", { refreshMs: 30_000 });
  // Failed webhooks: read recent webhook events and count FAILED.
  const { data: events } = useApi<WebhookEventRow[]>("/api/admin/webhooks", { refreshMs: 30_000 });

  const failedNotifications = React.useMemo(
    () => notifs?.stats.byStatus.find((s) => s.status === "FAILED")?.count ?? 0,
    [notifs]
  );
  const failedWebhooks = React.useMemo(
    () => (events ?? []).filter((e) => e.status === "FAILED").length,
    [events]
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="System Health"
        description="Live status of platform subsystems. Auto-refreshes every 30s."
        icon={<Activity className="h-5 w-5" />}
        actions={
          <Button variant="outline" size="sm" onClick={() => { mutateApi(healthPath); mutateApi("/api/admin/notifications"); mutateApi("/api/admin/webhooks"); toast.success("Refreshed"); }}>
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh
          </Button>
        }
      />

      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive p-4 text-sm text-destructive">{(error as Error).message}</div>
      ) : (
        <>
          {/* Status banner */}
          <div className={cn("flex items-center gap-3 rounded-xl p-4 text-white", OVERALL_META[data.overall].tone)}>
            {OVERALL_META[data.overall].icon}
            <div>
              <p className="font-semibold">{OVERALL_META[data.overall].label}</p>
              <p className="text-xs opacity-90">Last checked: {new Date(data.timestamp).toLocaleString("en-NG")}</p>
            </div>
          </div>

          {/* Subsystem grid */}
          <div className="grid gap-3 sm:grid-cols-3">
            {/* Database */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="h-4 w-4" /> Database
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className={cn("text-xs uppercase", HEALTH_TONE[data.database.status])}>
                    {data.database.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {data.database.latencyMs !== null ? `${data.database.latencyMs}ms` : "—"}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Redis */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Server className="h-4 w-4" /> Redis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="outline" className={cn("text-xs uppercase", HEALTH_TONE[data.redis.status])}>
                  {data.redis.status.replace(/_/g, " ")}
                </Badge>
                <p className="mt-2 text-xs text-muted-foreground">{data.redis.note}</p>
              </CardContent>
            </Card>

            {/* Providers */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Plug className="h-4 w-4" /> Providers
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.providers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No providers registered.</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.providers.map((p, i) => (
                      <div key={`${p.name}-${i}`} className="flex items-center justify-between text-xs">
                        <span className="truncate">{p.name}</span>
                        <Badge variant="secondary" className="text-[10px]">{p.mode}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Stats grid */}
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Frozen wallets" value={data.stats.wallets.frozen} icon={<Snowflake className="h-4 w-4" />} danger={data.stats.wallets.frozen > 0} />
            <StatTile label="Pending KYC" value={data.stats.risk.pendingKyc} icon={<IdCard className="h-4 w-4" />} />
            <StatTile label="Unresolved AML" value={data.stats.risk.unresolvedAmlFlags} icon={<ShieldAlert className="h-4 w-4" />} danger={data.stats.risk.unresolvedAmlFlags > 0} />
            <StatTile label="Open cases" value={data.stats.risk.openComplianceCases} icon={<Briefcase className="h-4 w-4" />} />
            <StatTile label="Failed notifications" value={failedNotifications} icon={<BellRing className="h-4 w-4" />} danger={failedNotifications > 0} />
            <StatTile label="Failed webhooks" value={failedWebhooks} icon={<Webhook className="h-4 w-4" />} danger={failedWebhooks > 0} />
          </div>

          {/* Additional context */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Users (total)" value={data.stats.users.total} />
            <StatTile label="Active users" value={data.stats.users.active} />
            <StatTile label="Transactions (total)" value={data.stats.transactions.total} />
            <StatTile label="Failed txns" value={data.stats.transactions.failed} danger={data.stats.transactions.failed > 0} />
            <StatTile label="Pending txns" value={data.stats.transactions.pending} />
            <StatTile label="Pending webhooks" value={data.stats.operations.pendingWebhooks} />
            <StatTile label="Audit events (24h)" value={data.stats.operations.recentAuditEvents24h} />
            <StatTile label="Critical events (24h)" value={data.stats.operations.criticalAuditEvents24h} danger={data.stats.operations.criticalAuditEvents24h > 0} />
          </div>

          {/* Last reconciliation */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Last reconciliation</CardTitle>
            </CardHeader>
            <CardContent>
              {data.stats.reconciliation ? (
                <div className="grid gap-3 sm:grid-cols-4 text-sm">
                  <Field label="Status" value={<Badge variant="outline" className="text-[10px]">{data.stats.reconciliation.status}</Badge>} />
                  <Field label="Wallets checked" value={data.stats.reconciliation.walletsChecked} />
                  <Field label="Drift detected" value={data.stats.reconciliation.driftDetected} />
                  <Field label="Drift corrected" value={data.stats.reconciliation.driftCorrected} />
                  <Field label="Started" value={new Date(data.stats.reconciliation.startedAt).toLocaleString("en-NG")} />
                  <Field label="Completed" value={data.stats.reconciliation.completedAt ? new Date(data.stats.reconciliation.completedAt).toLocaleString("en-NG") : "—"} />
                </div>
              ) : (
                <EmptyState title="No reconciliation run" description="Run a reconciliation to populate this." />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, icon, danger = false }: {
  label: string; value: React.ReactNode; icon?: React.ReactNode; danger?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums", danger ? "text-destructive" : "text-foreground")}>
        {value}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}
