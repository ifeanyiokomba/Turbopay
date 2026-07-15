"use client";

import * as React from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  BarChart3, TrendingUp, Coins, Users, Activity, AlertTriangle,
} from "lucide-react";

import { useApi } from "@/lib/turbopay/client";
import { formatNaira, formatNairaCompact } from "@/lib/turbopay/money";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ---------- types ----------
interface FinanceSummary {
  period: string;
  from: string;
  to: string;
  totalVolumeKobo: number;
  totalFeesKobo: number;
  counts: { total: number; success: number; failed: number; byStatus: { status: string; count: number }[] };
  byType: { type: string; volumeKobo: number; feesKobo: number; count: number }[];
  byProvider: { provider: string; volumeKobo: number; count: number }[];
  dailySeries: { day: string; volumeKobo: number; count: number; successCount: number }[];
}
interface FloatData {
  totals: { totalCachedKobo: number; totalLedgerKobo: number; driftKobo: number; reconciled: boolean; averageBalanceKobo: number; maxBalanceKobo: number };
  wallets: { total: number; active: number; frozen: number };
  topWallets: { walletId: string; userId: string; userName: string | null; balanceKobo: number; currency: string; status: string; userStatus: string | null }[];
}
interface HealthData {
  stats: { users: { total: number; active: number }; transactions: { total: number; success: number; pending: number; failed: number } };
}

const PIE_COLORS = ["#10b981", "#f59e0b", "#0ea5e9", "#a855f7", "#ef4444", "#64748b", "#22c55e", "#eab308"];

const PERIODS: { label: string; value: string }[] = [
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "90 days", value: "90d" },
];

// ============================================================
// Main
// ============================================================
export function FinanceAnalytics() {
  const [period, setPeriod] = React.useState("30d");

  const summaryPath = `/api/admin/finance/summary?period=${period}`;
  const floatPath = `/api/admin/finance/float`;
  const healthPath = `/api/admin/system/health`;

  const { data: summary, isLoading: summaryLoading } = useApi<FinanceSummary>(summaryPath);
  const { data: float, isLoading: floatLoading } = useApi<FloatData>(floatPath);
  const { data: health } = useApi<HealthData>(healthPath);

  const isLoading = summaryLoading || floatLoading;

  const dailyData = React.useMemo(() => {
    if (!summary?.dailySeries) return [];
    return summary.dailySeries.map((d) => ({
      day: d.day.slice(5),
      volume: Math.round(d.volumeKobo / 100),
      count: d.count,
    }));
  }, [summary]);

  const typeData = React.useMemo(() => {
    if (!summary?.byType) return [];
    return summary.byType
      .map((t) => ({ name: t.type, volume: Math.round(t.volumeKobo / 100), count: t.count }))
      .sort((a, b) => b.volume - a.volume);
  }, [summary]);

  const providerData = React.useMemo(() => {
    if (!summary?.byProvider) return [];
    return summary.byProvider
      .map((p) => ({ name: p.provider, value: Math.round(p.volumeKobo / 100), count: p.count }))
      .sort((a, b) => b.value - a.value);
  }, [summary]);

  const topUsers = React.useMemo(() => (float?.topWallets ?? []).slice(0, 10), [float]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Finance Analytics"
        description="Platform volume, fees, and provider mix."
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          <div className="flex gap-1 rounded-lg border bg-muted p-1">
            {PERIODS.map((p) => (
              <Button
                key={p.value}
                size="sm"
                variant={period === p.value ? "default" : "ghost"}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        }
      />

      {/* Stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Total volume"
          value={summary ? formatNairaCompact(summary.totalVolumeKobo) : "—"}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Total fees"
          value={summary ? formatNairaCompact(summary.totalFeesKobo) : "—"}
          icon={<Coins className="h-4 w-4" />}
        />
        <StatCard
          label="Transactions"
          value={summary ? summary.counts.total : "—"}
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="Active users"
          value={health ? health.stats.users.active : "—"}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Failed txns"
          value={summary ? summary.counts.failed : "—"}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={summary && summary.counts.failed > 0 ? "danger" : "default"}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Daily volume (₦)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !summary ? (
              <Skeleton className="h-64 w-full" />
            ) : dailyData.length === 0 ? (
              <EmptyState title="No data" description="No transactions in this period." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" tickFormatter={(v) => `₦${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                  <Tooltip
                    formatter={(v: number) => [`₦${v.toLocaleString()}`, "Volume"]}
                    labelFormatter={(l) => `Day ${l}`}
                    contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="volume" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Volume by type (₦)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !summary ? (
              <Skeleton className="h-64 w-full" />
            ) : typeData.length === 0 ? (
              <EmptyState title="No data" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={typeData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" tickFormatter={(v) => `₦${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                  <Tooltip formatter={(v: number) => [`₦${v.toLocaleString()}`, "Volume"]} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="volume" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Volume by provider</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !summary ? (
              <Skeleton className="h-64 w-full" />
            ) : providerData.length === 0 ? (
              <EmptyState title="No data" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={providerData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50}>
                      {providerData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `₦${v.toLocaleString()}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col justify-center gap-2">
                  {providerData.map((p, i) => (
                    <div key={p.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs text-muted-foreground">({p.count})</span>
                      </div>
                      <span className="tabular-nums">{formatNairaCompact(p.value * 100)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top 10 users */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Top 10 wallets (anonymised)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading || !float ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : topUsers.length === 0 ? (
            <EmptyState title="No wallets" />
          ) : (
            <ScrollArea className="max-h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Wallet</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topUsers.map((w, i) => (
                    <TableRow key={w.walletId}>
                      <TableCell className="font-medium">{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {w.userName ? anonymise(w.userName) : `${w.walletId.slice(0, 8)}…`}
                      </TableCell>
                      <TableCell>
                        <span className={cn("text-xs", w.status === "FROZEN" ? "text-destructive" : "text-muted-foreground")}>
                          {w.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNaira(w.balanceKobo)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function anonymise(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "—";
  return parts.map((p) => p[0]?.toUpperCase() ?? "?").join(".") + ".";
}

function StatCard({ label, value, icon, tone = "default" }: {
  label: string; value: React.ReactNode; icon?: React.ReactNode; tone?: "default" | "success" | "danger";
}) {
  const toneCls = { default: "text-foreground", success: "text-success", danger: "text-destructive" }[tone];
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className={cn("mt-2 text-xl font-semibold tabular-nums sm:text-2xl", toneCls)}>{value}</div>
    </div>
  );
}
