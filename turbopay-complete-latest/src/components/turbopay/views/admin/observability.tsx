"use client";

import * as React from "react";
import {
  Eye, Bell, Activity, AlertTriangle, Clock, CheckCircle2,
  XCircle, RefreshCw, Search, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

import { useApi } from "@/lib/turbopay/client";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

// ---------- types ----------
interface AlertSummary {
  active: number;
  acknowledged: number;
  critical: number;
  warning: number;
  info: number;
  last24h: number;
}

interface Alert {
  id: string;
  alertType: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  description: string;
  providerName: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface ProviderMetricsSummary {
  providerName: string;
  window: string;
  totalRequests: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  timeoutCount: number;
  totalVolumeKobo: number;
  errorDistribution: Record<string, number>;
}

interface GlobalMetricsSummary {
  totalProviders: number;
  totalRequests: number;
  overallSuccessRate: number;
  overallAvgLatencyMs: number;
  providerSummaries: ProviderMetricsSummary[];
}

interface StuckHealth {
  totalPending: number;
  totalStuck: number;
  oldestStuckMinutes: number | null;
  stuckByProvider: Record<string, number>;
  thresholdBreaches: number;
}

const SEVERITY_META: Record<string, { icon: React.ReactNode; tone: string }> = {
  CRITICAL: { icon: <XCircle className="h-4 w-4" />, tone: "bg-destructive text-destructive-foreground" },
  WARNING: { icon: <AlertTriangle className="h-4 w-4" />, tone: "bg-warning text-warning-foreground" },
  INFO: { icon: <Activity className="h-4 w-4" />, tone: "bg-muted text-muted-foreground" },
};

// ============================================================
// Main
// ============================================================
export function ObservabilityDashboard() {
  const [investigateRef, setInvestigateRef] = React.useState("");
  const [investigateResult, setInvestigateResult] = React.useState<any>(null);
  const [investigating, setInvestigating] = React.useState(false);

  // Data fetching
  const { data: alertSummary, isLoading: summaryLoading } = useApi<AlertSummary>("/api/admin/alerts/summary", { refreshMs: 30_000 });
  const { data: alerts, isLoading: alertsLoading } = useApi<Alert[]>("/api/admin/alerts", { refreshMs: 15_000 });
  const { data: metrics, isLoading: metricsLoading } = useApi<GlobalMetricsSummary>("/api/admin/provider-metrics?window=1h", { refreshMs: 30_000 });

  // Investigate transaction
  const investigate = async () => {
    if (!investigateRef.trim()) return;
    setInvestigating(true);
    setInvestigateResult(null);
    try {
      const res = await fetch(`/api/admin/transactions/${encodeURIComponent(investigateRef.trim())}/investigate`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Investigation failed");
      setInvestigateResult(json.data);
    } catch (err: any) {
      toast.error(err.message ?? "Investigation failed");
    } finally {
      setInvestigating(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Observability"
        description="Alerts, provider metrics, stuck transactions, and transaction investigation."
        icon={<Eye className="h-5 w-5" />}
      />

      {/* Alert Summary */}
      {summaryLoading ? (
        <div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : alertSummary ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <StatTile label="Active alerts" value={alertSummary.active} icon={<Bell className="h-4 w-4" />} danger={alertSummary.critical > 0} />
          <StatTile label="Critical" value={alertSummary.critical} icon={<XCircle className="h-4 w-4" />} danger={alertSummary.critical > 0} />
          <StatTile label="Warnings" value={alertSummary.warning} icon={<AlertTriangle className="h-4 w-4" />} />
          <StatTile label="Last 24h" value={alertSummary.last24h} icon={<Clock className="h-4 w-4" />} />
        </div>
      ) : null}

      {/* Active Alerts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" /> Active Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alertsLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : !alerts || alerts.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="No active alerts" description="All systems are operating normally." />
          ) : (
            <ScrollArea className="max-h-80">
              <div className="space-y-2 pr-2">
                {alerts.map((alert) => (
                  <div key={alert.id} className="flex items-start gap-3 rounded-lg border p-3">
                    <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", SEVERITY_META[alert.severity]?.tone ?? "bg-muted")}>
                      {SEVERITY_META[alert.severity]?.icon ?? <Activity className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{alert.title}</p>
                        <Badge variant="secondary" className="text-[10px]">{alert.severity}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{alert.description}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {alert.providerName && <span className="font-medium">{alert.providerName}</span>}
                        {" · "}
                        {new Date(alert.createdAt).toLocaleString("en-NG")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Provider Metrics */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Provider Metrics (1h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {metricsLoading ? (
            <Skeleton className="h-40" />
          ) : !metrics || metrics.providerSummaries.length === 0 ? (
            <EmptyState title="No metrics yet" description="Metrics will appear after provider requests are processed." />
          ) : (
            <div className="space-y-3">
              {/* Global summary */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-muted-foreground">Total requests</p>
                  <p className="text-2xl font-semibold">{metrics.totalRequests.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-muted-foreground">Success rate</p>
                  <p className={cn("text-2xl font-semibold", metrics.overallSuccessRate < 0.9 ? "text-destructive" : "text-success")}>
                    {Math.round(metrics.overallSuccessRate * 100)}%
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-muted-foreground">Avg latency</p>
                  <p className="text-2xl font-semibold">{metrics.overallAvgLatencyMs}ms</p>
                </div>
              </div>

              {/* Per-provider table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="pb-2 pr-4">Provider</th>
                      <th className="pb-2 pr-4 text-right">Requests</th>
                      <th className="pb-2 pr-4 text-right">Success rate</th>
                      <th className="pb-2 pr-4 text-right">Avg latency</th>
                      <th className="pb-2 pr-4 text-right">P95 latency</th>
                      <th className="pb-2 text-right">Timeouts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.providerSummaries.map((p) => (
                      <tr key={p.providerName} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium">{p.providerName}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{p.totalRequests.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right">
                          <span className={cn("tabular-nums", p.successRate < 0.9 ? "text-destructive font-medium" : "")}>
                            {Math.round(p.successRate * 100)}%
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">{p.avgLatencyMs}ms</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{p.p95LatencyMs}ms</td>
                        <td className="py-2 text-right tabular-nums">{p.timeoutCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction Investigation */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" /> Transaction Investigation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Enter transaction ID or reference (e.g. TP-XXXXXXXX)"
              value={investigateRef}
              onChange={(e) => setInvestigateRef(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && investigate()}
              className="flex-1"
            />
            <Button onClick={investigate} disabled={investigating || !investigateRef.trim()}>
              {investigating ? "Investigating..." : "Investigate"}
            </Button>
          </div>

          {investigateResult && (
            <div className="mt-4 space-y-4">
              {/* Transaction info */}
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{investigateResult.transaction.reference}</p>
                    <p className="text-xs text-muted-foreground">
                      {investigateResult.transaction.type} · {investigateResult.transaction.direction} · {(investigateResult.transaction.amountKobo / 100).toFixed(2)} NGN
                    </p>
                  </div>
                  <Badge variant={investigateResult.transaction.status === "SUCCESS" ? "default" : investigateResult.transaction.status === "FAILED" ? "destructive" : "secondary"}>
                    {investigateResult.transaction.status}
                  </Badge>
                </div>
                {investigateResult.summary.issuesDetected.length > 0 && (
                  <div className="mt-3 rounded-md bg-destructive/10 p-3">
                    {investigateResult.summary.issuesDetected.map((issue: string, i: number) => (
                      <p key={i} className="text-xs text-destructive">⚠ {issue}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* Timeline */}
              <div>
                <h4 className="mb-2 text-sm font-medium">Timeline ({investigateResult.summary.totalEvents} events)</h4>
                <ScrollArea className="max-h-96">
                  <div className="space-y-1 pr-2">
                    {investigateResult.timeline.map((event: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent/50">
                        <span className="mt-0.5 text-xs text-muted-foreground tabular-nums shrink-0">
                          {new Date(event.timestamp).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                        <div className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full", {
                          "bg-success": event.severity === "success",
                          "bg-destructive": event.severity === "error",
                          "bg-warning": event.severity === "warning",
                          "bg-muted-foreground": event.severity === "info",
                        })} />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{event.title}</p>
                          <p className="text-xs text-muted-foreground">{event.description}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">{event.source}</Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
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
