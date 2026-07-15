"use client";

import * as React from "react";
import { toast } from "sonner";
import { Smartphone, Wifi, Check, ArrowRight } from "lucide-react";
import { useApi, apiPost, mutateApi } from "@/lib/turbopay/client";
import { formatNaira, parseNairaToKobo } from "@/lib/turbopay/money";
import { NETWORKS } from "@/lib/turbopay/types";
import type { DataPlan } from "@/lib/turbopay/providers";
import { PageHeader } from "@/components/turbopay/parts/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface WalletData {
  wallet: { id: string; balanceKobo: number; ledgerBalanceKobo: number; currency: string; status: string };
  virtualAccount: any;
  beneficiaries: any[];
}
interface PlansResponse { plans: DataPlan[] }

export function AirtimeDataView() {
  const [tab, setTab] = React.useState<"airtime" | "data">("airtime");
  const { data: walletData } = useApi<WalletData>("/api/wallet");
  // Fetch available airtime/data categories from the capability-driven service API
  const { data: servicesData } = useApi<{ category: string; services: Array<{ id: string; name: string; providers: string[] }> }[]>("/api/services?category=airtime");

  // Build dynamic tabs from capabilities
  const availableTabs = React.useMemo(() => {
    const tabs: Array<{ value: string; label: string; icon: React.ReactNode }> = [
      { value: "airtime", label: "Airtime", icon: <Smartphone className="mr-1.5 h-4 w-4" /> },
      { value: "data", label: "Data", icon: <Wifi className="mr-1.5 h-4 w-4" /> },
    ];
    // Additional tabs could be added dynamically based on capabilities
    // e.g., if a provider supports "betting" or "education"
    return tabs;
  }, [servicesData]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Airtime & Data"
        description="Top up any Nigerian line instantly."
        icon={<Smartphone className="h-5 w-5" />}
      />

      {walletData && (
        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">Wallet balance</span>
          <span className="font-semibold tabular-nums">{formatNaira(walletData.wallet.balanceKobo)}</span>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="grid w-full max-w-xs grid-cols-2">
          {availableTabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.icon} {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="airtime" className="mt-4">
          <AirtimeForm balance={walletData?.wallet.balanceKobo} />
        </TabsContent>
        <TabsContent value="data" className="mt-4">
          <DataForm balance={walletData?.wallet.balanceKobo} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const QUICK = [100, 200, 500, 1000, 2000, 5000];

function AirtimeForm({ balance }: { balance?: number }) {
  const [network, setNetwork] = React.useState("MTN");
  const [phone, setPhone] = React.useState("+234");
  const [amount, setAmount] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState<null | { reference: string; newBalanceKobo: number }>(null);

  const amountKobo = parseNairaToKobo(amount);
  const insufficient = balance !== undefined && amountKobo > balance;

  const submit = async () => {
    if (!/^\+234[0-9]{10}$/.test(phone)) return toast.error("Enter a valid phone (+234…)");
    if (amountKobo < 5000) return toast.error("Minimum is ₦50");
    if (insufficient) return toast.error("Insufficient funds");
    setLoading(true);
    try {
      const res = await apiPost<{ reference: string; newBalanceKobo: number }>("/api/airtime", {
        phoneNumber: phone, network, amountNaira: amountKobo / 100,
      });
      setDone(res);
      mutateApi("/api/wallet"); mutateApi("/api/dashboard"); mutateApi("/api/transactions");
      toast.success(`${network} airtime purchased`);
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Purchase failed");
    } finally {
      setLoading(false);
    }
  };

  if (done) return <SuccessCard title="Airtime purchased" amount={amountKobo} reference={done.reference} newBalanceKobo={done.newBalanceKobo} onReset={() => { setDone(null); setAmount(""); }} />;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Buy airtime</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Network</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {NETWORKS.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setNetwork(n.id)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all",
                    network === n.id ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "hover:bg-accent"
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: n.color }} />
                  {n.name}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone number</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2348012345678" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amt">Amount</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">₦</span>
              <Input id="amt" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="500" className="pl-8 text-lg font-medium tabular-nums" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {QUICK.map((a) => (
              <Button key={a} type="button" variant="outline" size="sm" onClick={() => setAmount(String(a))}>₦{a}</Button>
            ))}
          </div>
          {insufficient && <p className="text-xs text-destructive">Insufficient funds</p>}
          <Button className="w-full" size="lg" onClick={submit} disabled={loading || !amount}>
            {loading ? "Processing…" : <>Buy airtime <ArrowRight className="ml-1.5 h-4 w-4" /></>}
          </Button>
        </CardContent>
      </Card>
      <Card className="bg-muted/30">
        <CardContent className="py-4 text-sm">
          <p className="font-medium">Instant top-ups</p>
          <p className="mt-1 text-xs text-muted-foreground">Airtime is delivered in seconds via Baxi. All networks supported — MTN, Glo, Airtel & 9mobile.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function DataForm({ balance }: { balance?: number }) {
  const [network, setNetwork] = React.useState("MTN");
  const [phone, setPhone] = React.useState("+234");
  const [planId, setPlanId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState<null | { reference: string; newBalanceKobo: number; amountKobo: number }>(null);

  const { data, isLoading } = useApi<PlansResponse>(`/api/data?network=${network}`);

  React.useEffect(() => { setPlanId(null); }, [network]);

  const plan = data?.plans.find((p) => p.id === planId);
  const insufficient = balance !== undefined && plan && plan.amountKobo > balance;

  const submit = async () => {
    if (!/^\+234[0-9]{10}$/.test(phone)) return toast.error("Enter a valid phone (+234…)");
    if (!plan) return toast.error("Select a data plan");
    if (insufficient) return toast.error("Insufficient funds");
    setLoading(true);
    try {
      const res = await apiPost<{ reference: string; newBalanceKobo: number }>("/api/data", { phoneNumber: phone, planId: plan.id });
      setDone({ ...res, amountKobo: plan.amountKobo });
      mutateApi("/api/wallet"); mutateApi("/api/dashboard"); mutateApi("/api/transactions");
      toast.success(`${plan.name} purchased`);
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Purchase failed");
    } finally {
      setLoading(false);
    }
  };

  if (done) return <SuccessCard title="Data purchased" amount={done.amountKobo} reference={done.reference} newBalanceKobo={done.newBalanceKobo} onReset={() => { setDone(null); setPlanId(null); }} />;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Buy data</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Network</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {NETWORKS.map((n) => (
                <button key={n.id} onClick={() => setNetwork(n.id)} className={cn("flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all", network === n.id ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "hover:bg-accent")}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: n.color }} />{n.name}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dphone">Phone number</Label>
            <Input id="dphone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2348012345678" />
          </div>
          <div className="space-y-2">
            <Label>Select plan</Label>
            {isLoading ? (
              <div className="grid gap-2 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : (data?.plans?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No plans available for {network}.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {data?.plans.map((p) => (
                  <button key={p.id} onClick={() => setPlanId(p.id)} className={cn("flex items-center justify-between rounded-lg border p-3 text-left transition-all", planId === p.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent")}>
                    <div>
                      <p className="text-sm font-medium">{p.size}</p>
                      <p className="text-xs text-muted-foreground">{p.name} · {p.duration}</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{formatNaira(p.amountKobo)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {insufficient && <p className="text-xs text-destructive">Insufficient funds for this plan</p>}
          <Button className="w-full" size="lg" onClick={submit} disabled={loading || !plan}>
            {loading ? "Processing…" : plan ? <>Buy {plan.name} · {formatNaira(plan.amountKobo)} <ArrowRight className="ml-1.5 h-4 w-4" /></> : "Select a plan"}
          </Button>
        </CardContent>
      </Card>
      <Card className="bg-muted/30">
        <CardContent className="py-4 text-sm">
          <p className="font-medium">Data bundles</p>
          <p className="mt-1 text-xs text-muted-foreground">Genuine network data plans delivered via Baxi. Validity matches the carrier's standard plan.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SuccessCard({ title, amount, reference, newBalanceKobo, onReset }: { title: string; amount: number; reference: string; newBalanceKobo: number; onReset: () => void }) {
  return (
    <Card className="mx-auto max-w-md">
      <div className="flex flex-col items-center bg-success/10 px-6 py-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/20">
          <Check className="h-8 w-8 text-success" />
        </div>
        <h2 className="mt-4 text-xl font-bold">{title}</h2>
        <p className="mt-3 text-3xl font-bold tabular-nums">{formatNaira(amount)}</p>
      </div>
      <CardContent className="space-y-2.5 pt-5 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Reference</span><span className="font-mono text-xs">{reference}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">New balance</span><span className="font-medium">{formatNaira(newBalanceKobo)}</span></div>
        <Button className="mt-2 w-full" variant="outline" onClick={onReset}>Done</Button>
      </CardContent>
    </Card>
  );
}
