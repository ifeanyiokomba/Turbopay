"use client";

import * as React from "react";
import { toast } from "sonner";
import { Users, Copy, Check, Share2, Gift, UserCheck, Award } from "lucide-react";
import { useApi } from "@/lib/turbopay/client";
import { formatNaira } from "@/lib/turbopay/money";
import { PageHeader, EmptyState, StatCard } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface ReferralStats {
  total: number;
  completed: number;
  rewarded: number;
  totalEarningsKobo: number;
  referrals: Array<{
    id: string; referralCode: string; status: string;
    rewardKobo: number; rewardType: string | null;
    createdAt: string; completedAt: string | null;
  }>;
}

const STATUS_TONE: Record<string, string> = {
  PENDING: "bg-muted text-muted-foreground",
  COMPLETED: "bg-success/15 text-success",
  REWARDED: "bg-primary/10 text-primary",
};

export function ReferralsView() {
  const { data: codeData } = useApi<{ code: string; link: string }>("/api/referrals");
  const { data: stats, isLoading } = useApi<ReferralStats>("/api/referrals/stats");
  const [copied, setCopied] = React.useState(false);

  const copyCode = async () => {
    if (!codeData?.code) return;
    try {
      await navigator.clipboard.writeText(codeData.code);
      setCopied(true);
      toast.success("Referral code copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  const share = async () => {
    if (!codeData?.link) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join me on Turbopay", text: "Send and receive money instantly with Turbopay.", url: codeData.link });
      } catch { /* user dismissed */ }
    } else {
      copyCode();
    }
  };

  const referrals = stats?.referrals ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Referrals"
        description="Invite friends — earn bonuses when they sign up."
        icon={<Users className="h-5 w-5" />}
      />

      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
        <CardContent className="space-y-3 py-5">
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            <p className="text-sm font-medium">Your referral code</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Share this code</Label>
              <Input readOnly value={codeData?.code ?? ""} placeholder="Loading…" className="font-mono text-lg font-semibold" />
            </div>
            <div className="flex gap-2">
              <Button onClick={copyCode} variant="outline">{copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />} {copied ? "Copied" : "Copy"}</Button>
              <Button onClick={share}><Share2 className="mr-1.5 h-4 w-4" /> Share</Button>
            </div>
          </div>
          {codeData?.link && <p className="text-xs text-muted-foreground">Shareable link: <span className="font-mono">{codeData.link}</span></p>}
        </CardContent>
      </Card>

      {stats ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Total referred" value={stats.total} icon={<Users className="h-4 w-4" />} />
          <StatCard label="Completed signups" value={stats.completed} icon={<UserCheck className="h-4 w-4" />} tone="success" />
          <StatCard label="Total earned" value={formatNaira(stats.totalEarningsKobo)} icon={<Award className="h-4 w-4" />} tone="success" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Your referrals</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : referrals.length === 0 ? (
            <EmptyState icon={<Users className="h-6 w-6" />} title="No referrals yet" description="Share your code above — when friends sign up with it, they'll appear here." />
          ) : (
            <div className="divide-y">
              {referrals.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium">{r.referralCode}</p>
                    <p className="text-xs text-muted-foreground">Invited {new Date(r.createdAt).toLocaleDateString("en-NG")}{r.completedAt ? ` · Joined ${new Date(r.completedAt).toLocaleDateString("en-NG")}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.rewardKobo > 0 && r.status === "REWARDED" && <span className="text-sm font-semibold text-success">+{formatNaira(r.rewardKobo)}</span>}
                    <Badge variant="outline" className={STATUS_TONE[r.status] ?? "text-[10px]"}>{r.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
