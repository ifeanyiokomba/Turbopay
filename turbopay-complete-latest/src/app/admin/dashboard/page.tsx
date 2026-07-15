"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  CreditCard,
  Activity,
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  TrendingUp,
  Server,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatCard, StatusBadge, statusVariant, PageHeader } from "@/components/admin";

interface DashboardStats {
  totalUsers: number;
  totalTransactions: number;
  totalVolume: number;
  activeProviders: number;
  recentTransactions: Array<{
    id: string;
    reference: string;
    type: string;
    amountKobo: number;
    status: string;
    provider?: string;
    createdAt: string;
  }>;
  providers: Array<{
    name: string;
    isHealthy: boolean;
    successRate: number;
    latency: number;
  }>;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/analytics").then((r) => r.json()).catch(() => ({})),
      fetch("/api/admin/provider-health/dashboard").then((r) => r.json()).catch(() => ({ providers: [] })),
      fetch("/api/admin/transactions").then((r) => r.json()).catch(() => ({ transactions: [] })),
    ]).then(([analytics, health, txData]) => {
      setStats({
        totalUsers: analytics.totalUsers || 0,
        totalTransactions: analytics.totalTransactions || 0,
        totalVolume: analytics.totalVolume || 0,
        activeProviders: (health.providers || []).filter((p: any) => p.isHealthy).length,
        recentTransactions: (txData.transactions || []).slice(0, 5),
        providers: health.providers || [],
      });
      setLoading(false);
    });
  }, []);

  if (loading || !stats) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-4 w-72 animate-pulse rounded bg-muted" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Overview of your payment infrastructure"
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Users"
          value={stats.totalUsers.toLocaleString()}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title="Transactions"
          value={stats.totalTransactions.toLocaleString()}
          icon={<CreditCard className="h-5 w-5" />}
        />
        <StatCard
          title="Volume"
          value={`₦${(stats.totalVolume / 100).toLocaleString()}`}
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          title="Active Providers"
          value={stats.activeProviders}
          description={`of ${stats.providers.length} total`}
          icon={<Activity className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Provider Health */}
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Provider Health</CardTitle>
            <Link href="/admin/health">
              <Button variant="ghost" size="sm" className="h-8 text-xs">
                View all
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {stats.providers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No providers configured
              </p>
            ) : (
              <div className="space-y-3">
                {stats.providers.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-2 w-2 rounded-full ${p.isHealthy ? "bg-success" : "bg-destructive"}`}
                      />
                      <div>
                        <p className="text-sm font-medium capitalize">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.latency ? `${p.latency}ms` : "N/A"}
                        </p>
                      </div>
                    </div>
                    <StatusBadge variant={statusVariant(p.isHealthy ? "active" : "failed")}>
                      {p.successRate ? `${(p.successRate * 100).toFixed(0)}%` : "N/A"}
                    </StatusBadge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Transactions */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Recent Transactions</CardTitle>
            <Link href="/admin/transactions">
              <Button variant="ghost" size="sm" className="h-8 text-xs">
                View all
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {stats.recentTransactions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No transactions yet
              </p>
            ) : (
              <div className="space-y-3">
                {stats.recentTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full ${
                          tx.type === "CREDIT"
                            ? "bg-success/10 text-success"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {tx.type === "CREDIT" ? (
                          <ArrowDownLeft className="h-4 w-4" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium font-mono">{tx.reference}</p>
                        <p className="text-xs text-muted-foreground">
                          {tx.type} · {tx.provider || "N/A"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {tx.type === "CREDIT" ? "+" : "-"}₦
                        {(tx.amountKobo / 100).toLocaleString()}
                      </p>
                      <StatusBadge variant={statusVariant(tx.status)} dot={false}>
                        {tx.status}
                      </StatusBadge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { href: "/admin/transactions", label: "Transactions", icon: CreditCard },
              { href: "/admin/customers", label: "Customers", icon: Users },
              { href: "/admin/providers", label: "Providers", icon: Server },
              { href: "/admin/audit-log", label: "Audit Log", icon: TrendingUp },
            ].map((action) => (
              <Link key={action.href} href={action.href}>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 h-auto py-3"
                >
                  <action.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{action.label}</span>
                </Button>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
