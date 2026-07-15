"use client";

import * as React from "react";
import { Gift, Sparkles, Award, TrendingUp, Users } from "lucide-react";
import { useApi } from "@/lib/turbopay/client";
import { formatNaira } from "@/lib/turbopay/money";
import { PageHeader, EmptyState, StatCard } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface RewardRow {
  id: string; type: string; title: string; description: string | null;
  valueKobo: number; status: string; tier: number | null;
  sourceTransactionId: string | null; createdAt: string;
  voucher: { code: string; campaignName: string } | null;
}

interface Summary {
  totalCashbackKobo: number;
  totalTierBonusKobo: number;
  totalCampaignRewardKobo: number;
  totalReferralBonusKobo: number;
  totalVoucherKobo: number;
  count: number;
}

interface RewardsResponse {
  rewards: RewardRow[];
  voucherHistory: any[];
  summary: Summary;
}

const TYPE_META: Record<string, { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }> = {
  CASHBACK: { label: "Cashback", tone: "bg-success/15 text-success", icon: TrendingUp },
  TIER_BONUS: { label: "Tier bonus", tone: "bg-primary/10 text-primary", icon: Award },
  CAMPAIGN_REWARD: { label: "Campaign", tone: "bg-warning/15 text-warning-foreground", icon: Sparkles },
  REFERRAL_BONUS: { label: "Referral", tone: "bg-accent text-accent-foreground", icon: Users },
  VOUCHER: { label: "Voucher", tone: "bg-muted text-muted-foreground", icon: Gift },
};

export function RewardsView() {
  const { data, isLoading } = useApi<RewardsResponse>("/api/rewards");
  const rewards = data?.rewards ?? [];
  const summary = data?.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Rewards"
        description="Cashback, bonuses, and perks you've earned."
        icon={<Gift className="h-5 w-5" />}
      />

      {summary ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total cashback" value={formatNaira(summary.totalCashbackKobo)} icon={<TrendingUp className="h-4 w-4" />} tone="success" />
          <StatCard label="Tier bonuses" value={formatNaira(summary.totalTierBonusKobo)} icon={<Award className="h-4 w-4" />} />
          <StatCard label="Referral bonuses" value={formatNaira(summary.totalReferralBonusKobo)} icon={<Users className="h-4 w-4" />} />
          <StatCard label="Voucher value" value={formatNaira(summary.totalVoucherKobo)} icon={<Gift className="h-4 w-4" />} hint={`${summary.count} reward${summary.count === 1 ? "" : "s"}`} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Reward history</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : rewards.length === 0 ? (
            <EmptyState icon={<Gift className="h-6 w-6" />} title="No rewards yet" description="Earn cashback on airtime, data, and bill payments — your rewards will appear here." />
          ) : (
            <div className="divide-y">
              {rewards.map((r) => {
                const meta = TYPE_META[r.type] ?? TYPE_META.VOUCHER;
                const Icon = meta.icon;
                return (
                  <div key={r.id} className="flex items-center gap-3 py-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}><Icon className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("en-NG")}{r.tier ? ` · Tier ${r.tier}` : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{formatNaira(r.valueKobo)}</p>
                      <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
