"use client";

import * as React from "react";
import { toast } from "sonner";
import { Ticket, Tag, Gift, Sparkles } from "lucide-react";
import { useApi, apiPost, mutateApi } from "@/lib/turbopay/client";
import { formatNaira, parseNairaToKobo } from "@/lib/turbopay/money";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Voucher {
  id: string; code: string; campaignName: string; type: string;
  valueKobo: number; valueBps: number; minSpendKobo: number;
  endDate: string | null; active: boolean;
}

interface Redemption {
  id: string; voucherId: string; discountAppliedKobo: number;
  status: string; createdAt: string;
  voucher: { code: string; campaignName: string; type: string; valueKobo: number } | null;
}

interface VouchersResponse {
  rewards: Array<{ id: string; status: string; voucher: Voucher | null }>;
  activeVouchers: Voucher[];
  history: Redemption[];
}

const PRODUCT_OPTIONS = [
  "AIRTIME", "DATA", "BILL_ELECTRICITY", "BILL_UTILITY", "INTERNET", "CABLE_TV",
];

const TYPE_LABELS: Record<string, string> = {
  FLAT_OFF: "₦ Off", PERCENT_OFF: "% Off", FEE_WAIVER: "Fee waiver", DISCOUNT: "Discount", CASHBACK: "Cashback",
};

export function VouchersView() {
  const { data, isLoading, refetch } = useApi<VouchersResponse>("/api/vouchers");
  const [code, setCode] = React.useState("");
  const [product, setProduct] = React.useState("AIRTIME");
  const [amount, setAmount] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const rewards = data?.rewards ?? [];
  const activeVouchers = data?.activeVouchers ?? [];
  const history = data?.history ?? [];

  const redeem = async () => {
    if (!code || code.length < 3) return toast.error("Enter a voucher code");
    const amountKobo = amount ? parseNairaToKobo(amount) : 0;
    setLoading(true);
    try {
      // The /api/vouchers/redeem endpoint requires a transaction context — we
      // generate a synthetic transactionId since this standalone redemption
      // flow is not tied to a specific checkout. The lib records the
      // redemption with this id for audit-trail purposes.
      const transactionId = `voucher-redeem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await apiPost("/api/vouchers/redeem", { code, product, amountKobo, transactionId });
      toast.success("Voucher redeemed successfully");
      setCode(""); setAmount("");
      refetch();
      mutateApi("/api/wallet");
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not redeem voucher"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vouchers"
        description="Redeem codes and browse your reward vouchers."
        icon={<Ticket className="h-5 w-5" />}
      />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" /> Redeem a code</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Voucher code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WELCOME100" className="font-mono uppercase" />
            </div>
            <div className="space-y-1.5">
              <Label>Product context</Label>
              <Select value={product} onValueChange={setProduct}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRODUCT_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Transaction amount (₦)</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₦1,000" inputMode="decimal" />
            </div>
          </div>
          <Button onClick={redeem} disabled={loading} className="w-full sm:w-auto">
            {loading ? "Redeeming…" : "Redeem voucher"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Gift className="h-4 w-4" /> Your reward vouchers</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : rewards.length === 0 && activeVouchers.length === 0 ? (
            <EmptyState icon={<Gift className="h-6 w-6" />} title="No vouchers available" description="Active campaigns and earned rewards will appear here." />
          ) : (
            <div className="space-y-2">
              {rewards.filter((r) => r.voucher).map((r) => (
                <VoucherRow key={r.id} code={r.voucher!.code} campaign={r.voucher!.campaignName} type={r.voucher!.type} value={r.voucher!.valueKobo} valueBps={r.voucher!.valueBps} expiry={r.voucher!.endDate} status={r.status} />
              ))}
              {activeVouchers.map((v) => (
                <VoucherRow key={v.id} code={v.code} campaign={v.campaignName} type={v.type} value={v.valueKobo} valueBps={v.valueBps} expiry={v.endDate} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Tag className="h-4 w-4" /> Redemption history</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No redemptions yet.</p>
          ) : (
            <div className="divide-y">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium">{h.voucher?.code ?? "—"}</p>
                    <p className="truncate text-xs text-muted-foreground">{h.voucher?.campaignName ?? "Voucher"} · {new Date(h.createdAt).toLocaleDateString("en-NG")}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-success">{formatNaira(h.discountAppliedKobo)} off</p>
                    <Badge variant="outline" className="text-[10px]">{h.status}</Badge>
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

function VoucherRow({ code, campaign, type, value, valueBps, expiry, status }: { code: string; campaign: string; type: string; value: number; valueBps: number; expiry: string | null; status?: string }) {
  const expired = expiry ? new Date(expiry) < new Date() : false;
  const display = type === "PERCENT_OFF" ? `${valueBps / 100}% off` : type === "FLAT_OFF" ? `${formatNaira(value)} off` : TYPE_LABELS[type] ?? type;
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-mono text-sm font-semibold">{code}</p>
          {status && <Badge variant="outline" className="text-[10px]">{status}</Badge>}
        </div>
        <p className="truncate text-xs text-muted-foreground">{campaign}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-primary">{display}</p>
        {expiry && <p className={`text-[11px] ${expired ? "text-destructive" : "text-muted-foreground"}`}>{expired ? "Expired" : "Exp"} {new Date(expiry).toLocaleDateString("en-NG")}</p>}
      </div>
    </div>
  );
}
