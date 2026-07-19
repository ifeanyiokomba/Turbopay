"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ReceiptText, Zap, Tv, Droplet, Wifi, Building2, Check, ArrowRight,
  Search, Smartphone, Shield, ChevronRight, AlertCircle, CreditCard,
  GraduationCap, Globe, Flame, Droplets
} from "lucide-react";
import { useApi, apiPost, mutateApi } from "@/lib/turbopay/client";
import { formatNaira, parseNairaToKobo } from "@/lib/turbopay/money";
import { PageHeader } from "@/components/turbopay/parts/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────

interface WalletData { wallet: { balanceKobo: number } }

interface UnifiedBiller {
  id: string;
  name: string;
  category: string;
  description: string;
  provider: "baxi" | "remita" | "quickteller" | "billswift";
  paymentCode?: string;
  fixedAmount?: number;
  customerRefType?: "meter" | "smartcard" | "iac" | "account" | "rrr" | "phone" | "id";
}

interface BillerCategory {
  category: string;
  label: string;
  billerCount: number;
  providers: string[];
}

// ─── Category Config ────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  electricity: { icon: <Zap className="h-5 w-5" />, color: "text-yellow-500" },
  internet: { icon: <Wifi className="h-5 w-5" />, color: "text-blue-500" },
  cable_tv: { icon: <Tv className="h-5 w-5" />, color: "text-purple-500" },
  airtime: { icon: <Smartphone className="h-5 w-5" />, color: "text-green-500" },
  data: { icon: <Globe className="h-5 w-5" />, color: "text-cyan-500" },
  education: { icon: <GraduationCap className="h-5 w-5" />, color: "text-orange-500" },
  insurance: { icon: <Shield className="h-5 w-5" />, color: "text-indigo-500" },
  government: { icon: <Building2 className="h-5 w-5" />, color: "text-gray-500" },
  betting: { icon: <Flame className="h-5 w-5" />, color: "text-red-500" },
  water: { icon: <Droplets className="h-5 w-5" />, color: "text-blue-400" },
  others: { icon: <ReceiptText className="h-5 w-5" />, color: "text-gray-400" },
};

// ─── Ref Type Labels ────────────────────────────────────────

const REF_TYPE_LABELS: Record<string, string> = {
  meter: "Meter Number",
  smartcard: "Smartcard Number",
  iac: "IUC / IAC Number",
  account: "Account Number",
  rrr: "Remita Reference (RRR)",
  phone: "Phone Number",
  id: "Customer ID",
};

const REF_TYPE_PLACEHOLDERS: Record<string, string> = {
  meter: "e.g. 04172219014",
  smartcard: "e.g. 1234567890",
  iac: "e.g. 7012345678",
  account: "e.g. 1234567890",
  rrr: "e.g. 123456789012",
  phone: "e.g. 08012345678",
  id: "e.g. 1234567890",
};

// ─── Main Bills View ────────────────────────────────────────

export function BillsView() {
  const { data: walletData } = useApi<WalletData>("/api/wallet");
  const { data: categoriesData } = useApi<{ categories: BillerCategory[] }>("/api/bills/unified");

  const categories = categoriesData?.categories ?? [];
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(null);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pay Bills"
        description="Electricity, internet, cable TV, airtime & more — all in one place."
        icon={<ReceiptText className="h-5 w-5" />}
      />

      {walletData && (
        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">Wallet balance</span>
          <span className="font-semibold tabular-nums">{formatNaira(walletData.wallet.balanceKobo)}</span>
        </div>
      )}

      {!selectedCategory ? (
        /* Category Grid */
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.length === 0
            ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
            : categories.map((cat) => {
                const config = CATEGORY_CONFIG[cat.category] ?? CATEGORY_CONFIG.others;
                return (
                  <button
                    key={cat.category}
                    onClick={() => setSelectedCategory(cat.category)}
                    className="group flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all hover:border-primary hover:bg-primary/5 hover:shadow-sm"
                  >
                    <div className={cn("flex h-12 w-12 items-center justify-center rounded-full bg-muted transition-colors group-hover:bg-primary/10", config.color)}>
                      {config.icon}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{cat.label}</p>
                      <p className="text-xs text-muted-foreground">{cat.billerCount} billers</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                );
              })}
        </div>
      ) : (
        /* Biller List for Selected Category */
        <BillerList
          category={selectedCategory}
          balance={walletData?.wallet.balanceKobo}
          onBack={() => setSelectedCategory(null)}
        />
      )}
    </div>
  );
}

// ─── Biller List ────────────────────────────────────────────

function BillerList({ category, balance, onBack }: { category: string; balance?: number; onBack: () => void }) {
  const { data: billersData } = useApi<{ billers: UnifiedBiller[] }>(`/api/bills/unified?category=${category}`);
  const config = CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.others;
  const billers = billersData?.billers ?? [];
  const [selectedBiller, setSelectedBiller] = React.useState<UnifiedBiller | null>(null);

  if (selectedBiller) {
    return (
      <BillPaymentForm
        biller={selectedBiller}
        balance={balance}
        onBack={() => setSelectedBiller(null)}
        onDone={() => { setSelectedBiller(null); onBack(); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
        ← Back to categories
      </Button>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className={config.color}>{config.icon}</span>
            {category.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {billers.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No billers available in this category yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {billerMap(billers, (biller) => (
                <button
                  key={biller.id}
                  onClick={() => setSelectedBiller(biller)}
                  className="flex items-center justify-between rounded-lg border p-3 text-left transition-all hover:border-primary hover:bg-primary/5"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{biller.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{biller.description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function billerMap(billers: UnifiedBiller[], render: (b: UnifiedBiller) => React.ReactNode) {
  return billers.map(render);
}

// ─── Bill Payment Form ──────────────────────────────────────

function BillPaymentForm({ biller, balance, onBack, onDone }: {
  biller: UnifiedBiller;
  balance?: number;
  onBack: () => void;
  onDone: () => void;
}) {
  const [customerRef, setCustomerRef] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [validating, setValidating] = React.useState(false);
  const [validated, setValidated] = React.useState<null | { customerName: string }>(null);
  const [paying, setPaying] = React.useState(false);
  const [done, setDone] = React.useState<null | {
    reference: string;
    amountKobo: number;
    newBalanceKobo: number;
    customerName: string;
  }>(null);

  const refType = biller.customerRefType ?? "account";
  const amountKobo = biller.fixedAmount ?? parseNairaToKobo(amount);
  const insufficient = balance !== undefined && amountKobo > balance;

  const validate = async () => {
    if (customerRef.length < 4) return toast.error(`Enter a valid ${REF_TYPE_LABELS[refType]}`);
    setValidating(true);
    try {
      const res = await apiPost<{ valid: boolean; customerName: string; message: string }>(
        "/api/bills/pay",
        { action: "validate", billerId: biller.id, provider: biller.provider, customerRef }
      );
      if (!res.valid) {
        toast.error(res.message || "Validation failed");
        setValidated(null);
      } else {
        setValidated({ customerName: res.customerName });
        toast.success("Customer validated");
      }
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message);
    } finally {
      setValidating(false);
    }
  };

  const pay = async () => {
    if (!validated) return toast.error("Validate first");
    if (amountKobo < 10000) return toast.error("Minimum is ₦100");
    if (insufficient) return toast.error("Insufficient funds");
    setPaying(true);
    try {
      const res = await apiPost<{
        reference: string;
        amountKobo: number;
        newBalanceKobo: number;
        customerName: string;
      }>("/api/bills/pay", {
        billerId: biller.id,
        billerName: biller.name,
        provider: biller.provider,
        customerRef,
        amountKobo,
        category: biller.category,
        fixedAmount: biller.fixedAmount,
      });
      setDone({ ...res, customerName: validated.customerName });
      mutateApi("/api/wallet");
      mutateApi("/api/dashboard");
      mutateApi("/api/transactions");
      toast.success("Payment successful!");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message);
    } finally {
      setPaying(false);
    }
  };

  if (done) {
    return (
      <Card className="mx-auto max-w-md">
        <div className="flex flex-col items-center bg-success/10 px-6 py-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/20">
            <Check className="h-8 w-8 text-success" />
          </div>
          <h2 className="mt-4 text-xl font-bold">Payment Successful</h2>
          <p className="mt-3 text-3xl font-bold tabular-nums">{formatNaira(done.amountKobo)}</p>
        </div>
        <CardContent className="space-y-2.5 pt-5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Biller</span>
            <span className="font-medium">{biller.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Customer</span>
            <span className="font-medium">{done.customerName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Reference</span>
            <span className="font-mono text-xs">{done.reference}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">New balance</span>
            <span className="font-medium">{formatNaira(done.newBalanceKobo)}</span>
          </div>
          <Button className="mt-2 w-full" variant="outline" onClick={onDone}>Done</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">{biller.name}</CardTitle>
          <p className="text-sm text-muted-foreground">{biller.description}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Customer Reference */}
          <div className="flex gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="cust">{REF_TYPE_LABELS[refType]}</Label>
              <Input
                id="cust"
                value={customerRef}
                onChange={(e) => { setCustomerRef(e.target.value); setValidated(null); }}
                placeholder={REF_TYPE_PLACEHOLDERS[refType]}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-auto"
              onClick={validate}
              disabled={validating || customerRef.length < 4}
            >
              {validating ? "Validating..." : <><Search className="mr-1 h-4 w-4" /> Validate</>}
            </Button>
          </div>

          {validated && (
            <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-sm">
              <Check className="h-4 w-4 text-success" />
              <span className="font-medium">{validated.customerName}</span>
              <Badge variant="secondary" className="ml-auto">Verified</Badge>
            </div>
          )}

          {/* Amount (only if not fixed) */}
          {validated && !biller.fixedAmount && (
            <div className="space-y-1.5">
              <Label htmlFor="amt">Amount</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">₦</span>
                <Input
                  id="amt"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="2000"
                  className="pl-8 text-lg font-medium tabular-nums"
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[200, 500, 1000, 2000].map((a) => (
                  <Button key={a} type="button" variant="outline" size="sm" onClick={() => setAmount(String(a))}>
                    ₦{a.toLocaleString()}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {validated && biller.fixedAmount && (
            <p className="text-sm text-muted-foreground">
              Fixed amount: <span className="font-medium text-foreground">{formatNaira(biller.fixedAmount)}</span>
            </p>
          )}

          {insufficient && <p className="text-xs text-destructive">Insufficient funds</p>}

          <Button
            className="w-full"
            size="lg"
            onClick={pay}
            disabled={paying || !validated || (!biller.fixedAmount && !amount)}
          >
            {paying
              ? "Processing..."
              : <>Pay {formatNaira(amountKobo)} <ArrowRight className="ml-1.5 h-4 w-4" /></>}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-muted/30">
        <CardContent className="py-4 text-sm">
          <p className="font-medium">About this service</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {biller.description}. All payments are processed securely through TurboPay.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
