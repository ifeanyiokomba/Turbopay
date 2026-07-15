"use client";

import * as React from "react";
import { ShieldAlert, Users, Activity, AlertTriangle, Snowflake, TrendingUp, ScrollText, RefreshCw, AlertCircle } from "lucide-react";
import { useApi } from "@/lib/turbopay/client";
import { formatNaira, formatNairaCompact } from "@/lib/turbopay/money";
import { PageHeader, StatCard, EmptyState } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface AdminData {
  metrics: { userCount: number; txCount: number; totalVolumeKobo: number; frozenWallets: number; unresolvedFlags: number };
  logs: { items: Array<{ id: string; userId: string | null; userName: string | null; action: string; category: string; severity: string; metadata: any; createdAt: string }>; total: number };
  flags: { items: Array<{ id: string; userId: string; userName: string | null; rule: string; severity: string; description: string; createdAt: string }>; total: number };
}

const SEVERITY_TONE: Record<string, string> = {
  INFO: "bg-muted text-muted-foreground",
  WARN: "bg-warning/15 text-warning-foreground",
  ERROR: "bg-destructive/15 text-destructive",
  CRITICAL: "bg-destructive text-destructive-foreground",
};

const CATEGORY_TONE: Record<string, string> = {
  AUTH: "bg-primary/10 text-primary",
  WALLET: "bg-success/15 text-success",
  TRANSFER: "bg-accent text-accent-foreground",
  BILL: "bg-warning/15 text-warning-foreground",
  KYC: "bg-primary/10 text-primary",
  AML: "bg-destructive/15 text-destructive",
  ADMIN: "bg-muted text-muted-foreground",
  WEBHOOK: "bg-muted text-muted-foreground",
};

export function AdminView() {
  const { data, isLoading, error, refetch } = useApi<AdminData>("/api/admin/audit");

  const logs = data?.logs?.items ?? [];
  const flags = data?.flags?.items ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Admin Overview"
        description="Platform metrics, audit trail, and risk monitoring."
        icon={<ShieldAlert className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh</Button>}
      />

      {/* Error state */}
      {error && !isLoading && (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Failed to load admin data</p>
              <p className="text-sm text-muted-foreground">{error.message}</p>
            </div>
            <Button size="sm" onClick={() => refetch()}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {isLoading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
          <div className="grid gap-5 lg:grid-cols-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-80" />)}</div>
        </>
      )}

      {/* Success state */}
      {!isLoading && !error && data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Users" value={data.metrics.userCount} icon={<Users className="h-4 w-4" />} />
            <StatCard label="Transactions" value={data.metrics.txCount} icon={<Activity className="h-4 w-4" />} />
            <StatCard label="Volume" value={formatNairaCompact(data.metrics.totalVolumeKobo)} icon={<TrendingUp className="h-4 w-4" />} tone="success" />
            <StatCard label="Frozen wallets" value={data.metrics.frozenWallets} icon={<Snowflake className="h-4 w-4" />} tone={data.metrics.frozenWallets ? "danger" : "default"} />
            <StatCard label="Open AML flags" value={data.metrics.unresolvedFlags} icon={<AlertTriangle className="h-4 w-4" />} tone={data.metrics.unresolvedFlags ? "danger" : "default"} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* AML flags */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" /> Risk flags</CardTitle>
              </CardHeader>
              <CardContent>
                {flags.length === 0 ? (
                  <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No open flags" description="All clear — no suspicious activity detected." />
                ) : (
                  <ScrollArea className="max-h-80">
                    <div className="space-y-2 pr-2">
                      {flags.map((f) => (
                        <div key={f.id} className="flex items-start gap-3 rounded-lg border p-3">
                          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", SEVERITY_TONE[f.severity] ?? SEVERITY_TONE.WARN)}>
                            <AlertTriangle className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium">{f.rule.replace(/_/g, " ")}</p>
                              <Badge variant="secondary" className="text-[10px]">{f.severity}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{f.description}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{f.userName ?? f.userId} · {new Date(f.createdAt).toLocaleString("en-NG")}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            {/* Audit log */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><ScrollText className="h-4 w-4" /> Audit trail</CardTitle>
              </CardHeader>
              <CardContent>
                {logs.length === 0 ? (
                  <EmptyState icon={<ScrollText className="h-6 w-6" />} title="No audit entries" description="Audit log entries will appear here." />
                ) : (
                  <ScrollArea className="max-h-80">
                    <div className="space-y-1.5 pr-2">
                      {logs.map((l) => (
                        <div key={l.id} className="flex items-start gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-accent/50">
                          <span className={cn("mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium", CATEGORY_TONE[l.category] ?? "bg-muted")}>
                            {l.category}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{l.action}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {l.userName ?? "system"} · {new Date(l.createdAt).toLocaleString("en-NG")}
                            </p>
                          </div>
                          {l.severity !== "INFO" && (
                            <Badge variant="secondary" className={cn("text-[10px]", SEVERITY_TONE[l.severity])}>{l.severity}</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-muted/30">
            <CardContent className="py-4 text-sm">
              <p className="font-medium">Compliance posture</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3 text-xs text-muted-foreground">
                <p>✓ Double-entry ledger with immutable records</p>
                <p>✓ Idempotent webhook & payment processing</p>
                <p>✓ Velocity & large-amount monitoring</p>
                <p>✓ AES-256-GCM PII encryption at rest</p>
                <p>✓ Full audit trail (NDPR-aware)</p>
                <p>✓ KYC tiered limits (T1/T2/T3)</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
