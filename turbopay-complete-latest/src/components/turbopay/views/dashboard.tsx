"use client";

import * as React from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Send,
  Smartphone,
  ReceiptText,
  Plus,
  TrendingUp,
  TrendingDown,
  Activity,
  ShieldCheck,
  ChevronRight,
  Globe,
  Link2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useApi, mutateApi } from "@/lib/turbopay/client";
import { formatNaira, formatNairaCompact, koboToNaira } from "@/lib/turbopay/money";
import type { SessionUser } from "@/lib/turbopay/types";
import { useApp } from "@/components/turbopay/store";
import { MultiCurrencyBalanceCard, type CurrencyWalletInfo } from "@/components/turbopay/parts/multi-currency-balance-card";
import { TransactionItem } from "@/components/turbopay/parts/transaction-item";
import { StatCard, EmptyState } from "@/components/turbopay/parts/layout";
import { DynamicQuickActions } from "@/components/turbopay/parts/dynamic-quick-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface DashboardData {
  wallet: {
    id: string;
    balanceKobo: number;
    ledgerBalanceKobo: number;
    currency: string;
    status: "ACTIVE" | "FROZEN";
  };
  stats: { totalInKobo: number; totalOutKobo: number; txCount: number; netKobo: number };
  series: { date: string; label: string; inKobo: number; outKobo: number }[];
  categories: { name: string; kobo: number; naira: number }[];
  recent: any[];
  kyc: { tier: number; status: string; provider: string } | null;
  currencyWallets: CurrencyWalletInfo[];
  totalCurrencyBalanceMinor: number;
}

interface WalletData {
  wallet: DashboardData["wallet"];
  virtualAccount: {
    id: string;
    accountNumber: string;
    accountName: string;
    bankName: string;
    bankCode: string;
    provider: string;
    status: string;
  } | null;
  beneficiaries: any[];
}

const PIE_COLORS = ["var(--primary)", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#6b7280"];

export function DashboardView() {
  const user = useApp((s) => s.user) as SessionUser | null;
  const setView = useApp((s) => s.setView);
  const { data: dash, isLoading: dashLoading, error: dashError, refetch: refetchDash } = useApi<DashboardData>("/api/dashboard");
  const { data: walletData, error: walletError, refetch: refetchWallet } = useApi<WalletData>("/api/wallet");

  // Pull-to-refresh state
  const [refreshing, setRefreshing] = React.useState(false);
  const [pullDistance, setPullDistance] = React.useState(0);
  const touchStartY = React.useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (window.scrollY === 0 && touchStartY.current > 0) {
      const diff = e.touches[0].clientY - touchStartY.current;
      if (diff > 0) setPullDistance(Math.min(diff, 120));
    }
  };

  const handleTouchEnd = async () => {
    if (pullDistance > 60 && !refreshing) {
      setRefreshing(true);
      try {
        await Promise.all([refetchDash(), refetchWallet()]);
      } catch { /* ignore */ }
    }
    setPullDistance(0);
    setRefreshing(false);
  };

  const wallet = dash?.wallet ?? walletData?.wallet;
  const va = walletData?.virtualAccount;

  return (
    <div
      className="space-y-5"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {pullDistance > 0 && (
        <div
          className="flex items-center justify-center overflow-hidden transition-all"
          style={{ height: Math.min(pullDistance, 60) }}
        >
          <div className={cn("text-xs text-muted-foreground", refreshing && "animate-pulse")}>
            {refreshing ? "Refreshing…" : pullDistance > 60 ? "Release to refresh" : "Pull to refresh"}
          </div>
        </div>
      )}
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">
            {greeting()}, {user?.fullName.split(" ")[0]} 👋
          </p>
          <h2 className="text-2xl font-bold tracking-tight">Your money at a glance</h2>
        </div>
        {user && user.kycTier < 3 && (
          <Button variant="outline" size="sm" onClick={() => setView("kyc")}>
            <ShieldCheck className="mr-1.5 h-4 w-4" /> Upgrade KYC
          </Button>
        )}
      </div>

      {/* KYC banner */}
      {dash?.kyc && dash.kyc.status !== "VERIFIED" && (
        <Card className="border-warning/40 bg-warning/10">
          <CardContent className="flex items-center justify-between gap-3 py-3.5">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-5 w-5 text-warning-foreground" />
              <div>
                <p className="text-sm font-medium">Complete KYC to raise your limits</p>
                <p className="text-xs text-muted-foreground">Verify your NIN or BVN to unlock higher transaction limits.</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setView("kyc")}>Verify now</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Balance + actions */}
        <div className="space-y-4 lg:col-span-2">
          {walletLoading(wallet, dashLoading) ? (
            <Skeleton className="h-56 rounded-2xl" />
          ) : wallet ? (
            <MultiCurrencyBalanceCard
              wallet={wallet}
              currencyWallets={dash?.currencyWallets ?? []}
              accountName={va?.accountName ?? user?.fullName}
              accountNumber={va?.accountNumber}
              bankName={va?.bankName}
              kycTier={user?.kycTier}
              userCountry={user?.country ?? undefined}
            />
          ) : dashError || walletError ? (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-5 w-5 text-destructive" />
                  <div>
                    <p className="text-sm font-medium">Unable to load wallet</p>
                    <p className="text-xs text-muted-foreground">
                      {dashError?.message || walletError?.message || "Something went wrong. Please try again."}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => { refetchDash(); refetchWallet(); }}>
                  <RefreshCw className="mr-1.5 h-4 w-4" /> Retry
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {/* Quick actions - dynamically generated from capabilities */}
          <DynamicQuickActions onSelect={(view) => setView(view as any)} maxItems={4} />

          {/* Explicit action buttons */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <button
              onClick={() => setView("wallet")}
              className="flex items-center gap-2 rounded-xl border bg-card p-3 text-left text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Plus className="h-4 w-4" />
              </div>
              Fund
            </button>
            <button
              onClick={() => setView("transfer")}
              className="flex items-center gap-2 rounded-xl border bg-card p-3 text-left text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Send className="h-4 w-4" />
              </div>
              Transfer
            </button>
            <button
              onClick={() => setView("intl-transfers")}
              className="flex items-center gap-2 rounded-xl border bg-card p-3 text-left text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600">
                <Globe className="h-4 w-4" />
              </div>
              International
            </button>
            <button
              onClick={() => setView("payment-links")}
              className="flex items-center gap-2 rounded-xl border bg-card p-3 text-left text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600">
                <Link2 className="h-4 w-4" />
              </div>
              Payment Links
            </button>
          </div>

          {/* Chart */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">Cash flow · 14 days</CardTitle>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" /> In</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> Out</span>
              </div>
            </CardHeader>
            <CardContent>
              {dashLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={dash?.series ?? []} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="inG" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="outG" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval={1} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => formatNairaCompact(Number(v))}
                      width={50}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="inKobo" name="Money in" stroke="var(--color-success)" strokeWidth={2} fill="url(#inG)" />
                    <Area type="monotone" dataKey="outKobo" name="Money out" stroke="var(--color-primary)" strokeWidth={2} fill="url(#outG)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: stats + categories */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Money in"
              value={dashLoading ? "…" : formatNairaCompact(dash?.stats.totalInKobo ?? 0)}
              icon={<ArrowDownLeft className="h-4 w-4 text-success" />}
              tone="success"
              hint="Last 30 days"
            />
            <StatCard
              label="Money out"
              value={dashLoading ? "…" : formatNairaCompact(dash?.stats.totalOutKobo ?? 0)}
              icon={<ArrowUpRight className="h-4 w-4 text-destructive" />}
              tone="danger"
              hint="Last 30 days"
            />
            <StatCard
              label="Transactions"
              value={dashLoading ? "…" : (dash?.stats.txCount ?? 0).toString()}
              icon={<Activity className="h-4 w-4" />}
              hint="All time"
            />
            <StatCard
              label="Net flow"
              value={dashLoading ? "…" : formatNairaCompact(dash?.stats.netKobo ?? 0)}
              icon={(dash?.stats.netKobo ?? 0) >= 0 ? <TrendingUp className="h-4 w-4 text-success" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
              tone={(dash?.stats.netKobo ?? 0) >= 0 ? "success" : "danger"}
              hint="Last 30 days"
            />
          </div>

          {/* Spending by category */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Spending breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {dashLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (dash?.categories?.length ?? 0) === 0 ? (
                <EmptyState title="No spending yet" description="Your bill & transfer spending will appear here." />
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="50%" height={140}>
                    <PieChart>
                      <Pie
                        data={dash?.categories ?? []}
                        dataKey="kobo"
                        nameKey="name"
                        innerRadius={38}
                        outerRadius={60}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {(dash?.categories ?? []).map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5">
                    {(dash?.categories ?? []).slice(0, 5).map((c, i) => (
                      <div key={c.name} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          {c.name}
                        </span>
                        <span className="tabular-nums text-muted-foreground">{formatNairaCompact(c.kobo)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent transactions */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Recent transactions</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setView("history")} className="text-muted-foreground">
            View all <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {dashLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : (dash?.recent?.length ?? 0) === 0 ? (
            <EmptyState title="No transactions yet" description="Fund your wallet to get started." action={<Button size="sm" onClick={() => setView("wallet")}><Plus className="mr-1 h-4 w-4" /> Fund wallet</Button>} />
          ) : (
            <div className="divide-y">
              {dash?.recent.map((tx) => (
                <TransactionItem key={tx.id} tx={tx} onClick={() => setView("history")} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium">{label}</p>}
      {payload.map((p: any) => (
        <p key={p.name} className="flex items-center gap-2 tabular-nums">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: {formatNaira(Number(p.value))}
        </p>
      ))}
    </div>
  );
}

function walletLoading(wallet: any, dashLoading: boolean) {
  return !wallet && dashLoading;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
