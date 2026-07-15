"use client";

import * as React from "react";
import { BarChart3, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownLeft, Calendar } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell,
} from "recharts";
import { useApi } from "@/lib/turbopay/client";
import { formatNaira, formatNairaCompact } from "@/lib/turbopay/money";
import { PageHeader } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const COLORS = ["var(--primary)", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#6b7280", "#06b6d4", "#ec4899"];

interface InsightsData {
  monthly: { month: string; inKobo: number; outKobo: number }[];
  categories: { name: string; kobo: number; count: number }[];
  topRecipients: { name: string; count: number; totalKobo: number }[];
  summary: {
    totalInKobo: number;
    totalOutKobo: number;
    avgTxKobo: number;
    txCount: number;
    topCategory: string;
  };
}

export function InsightsView() {
  const { data, isLoading } = useApi<InsightsData>("/api/analytics/insights");

  if (isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Spending Insights" description="Understand your financial patterns." icon={<BarChart3 className="h-5 w-5" />} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const d = data ?? { monthly: [], categories: [], topRecipients: [], summary: { totalInKobo: 0, totalOutKobo: 0, avgTxKobo: 0, txCount: 0, topCategory: "" } };

  return (
    <div className="space-y-5">
      <PageHeader title="Spending Insights" description="Understand your financial patterns." icon={<BarChart3 className="h-5 w-5" />} />

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowDownLeft className="h-4 w-4 text-success" /> Money In
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatNairaCompact(d.summary.totalInKobo)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowUpRight className="h-4 w-4 text-destructive" /> Money Out
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatNairaCompact(d.summary.totalOutKobo)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" /> Transactions
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums">{d.summary.txCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingUp className="h-4 w-4" /> Avg. Transaction
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatNairaCompact(d.summary.avgTxKobo)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={d.monthly} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="inG2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="outG2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatNairaCompact(Number(v))} width={50} />
              <Tooltip formatter={(v: number) => formatNaira(v)} />
              <Area type="monotone" dataKey="inKobo" name="In" stroke="var(--color-success)" strokeWidth={2} fill="url(#inG2)" />
              <Area type="monotone" dataKey="outKobo" name="Out" stroke="var(--color-primary)" strokeWidth={2} fill="url(#outG2)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Spending by category */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Spending by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {d.categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">No spending data yet.</p>
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="45%" height={160}>
                  <PieChart>
                    <Pie data={d.categories} dataKey="kobo" nameKey="name" innerRadius={40} outerRadius={65} paddingAngle={2} stroke="none">
                      {d.categories.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatNaira(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {d.categories.slice(0, 6).map((c, i) => (
                    <div key={c.name} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
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

        {/* Top recipients */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Recipients</CardTitle>
          </CardHeader>
          <CardContent>
            {d.topRecipients.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transfer data yet.</p>
            ) : (
              <div className="space-y-3">
                {d.topRecipients.slice(0, 5).map((r, i) => (
                  <div key={r.name} className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.count} transfers</p>
                    </div>
                    <span className="text-sm font-medium tabular-nums">{formatNairaCompact(r.totalKobo)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
