"use client";

import * as React from "react";
import { toast } from "sonner";
import { ReceiptText, Zap, Tv, Droplet, Wifi, Building2, Check, ArrowRight, Search, Smartphone } from "lucide-react";
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

interface WalletData { wallet: { balanceKobo: number } }
interface Disco { id: string; name: string; code: string; short: string }
interface BillProduct { id: string; category: string; name: string; code: string; fields: string[]; fixedAmountKobo?: number }

/** Icon mapping for bill categories — drives the dynamic tabs */
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  electricity: <Zap className="mr-1.5 h-4 w-4" />,
  tv: <Tv className="mr-1.5 h-4 w-4" />,
  airtime: <Smartphone className="mr-1.5 h-4 w-4" />,
  data: <Wifi className="mr-1.5 h-4 w-4" />,
  betting: <ReceiptText className="mr-1.5 h-4 w-4" />,
  education: <Building2 className="mr-1.5 h-4 w-4" />,
  remita: <Building2 className="mr-1.5 h-4 w-4" />,
  quickteller: <Smartphone className="mr-1.5 h-4 w-4" />,
};

/** Display names for categories */
const CATEGORY_LABELS: Record<string, string> = {
  electricity: "Electricity",
  tv: "Utilities",
  airtime: "Airtime",
  data: "Data",
  betting: "Betting",
  education: "Education",
  remita: "Remita",
  quickteller: "Quickteller",
};

export function BillsView() {
  const { data: walletData } = useApi<WalletData>("/api/wallet");
  // Fetch available bill categories from the capability-driven service API
  const { data: servicesData } = useApi<{ category: string; services: Array<{ id: string; name: string; providers: string[] }> }[]>("/api/services?category=bill_payment");

  // Build dynamic tabs from capabilities
  const billCategories = React.useMemo(() => {
    if (!servicesData) return ["electricity", "tv", "remita", "quickteller"]; // Fallback while loading
    const categories = new Set<string>();
    for (const svc of servicesData) {
      if (svc.category === "bill_payment" || svc.category === "electricity" || svc.category === "tv") {
        categories.add(svc.category);
      }
    }
    // Always include core categories even if no providers yet
    categories.add("electricity");
    categories.add("tv");
    categories.add("remita");
    categories.add("quickteller");
    return Array.from(categories);
  }, [servicesData]);

  return (
    <div className="space-y-5">
      <PageHeader title="Pay Bills" description="Electricity, cable, water, internet & more." icon={<ReceiptText className="h-5 w-5" />} />
      {walletData && (
        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">Wallet balance</span>
          <span className="font-semibold tabular-nums">{formatNaira(walletData.wallet.balanceKobo)}</span>
        </div>
      )}
      <Tabs defaultValue={billCategories[0] ?? "electricity"}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          {billCategories.slice(0, 6).map((cat) => (
            <TabsTrigger key={cat} value={cat}>
              {CATEGORY_ICONS[cat] ?? <ReceiptText className="mr-1.5 h-4 w-4" />}
              {CATEGORY_LABELS[cat] ?? cat}
            </TabsTrigger>
          ))}
        </TabsList>
        {billCategories.includes("electricity") && (
          <TabsContent value="electricity" className="mt-4"><ElectricityForm balance={walletData?.wallet.balanceKobo} /></TabsContent>
        )}
        {billCategories.includes("tv") && (
          <TabsContent value="tv" className="mt-4"><UtilitiesForm balance={walletData?.wallet.balanceKobo} /></TabsContent>
        )}
        {billCategories.includes("remita") && (
          <TabsContent value="remita" className="mt-4"><RemitaForm balance={walletData?.wallet.balanceKobo} /></TabsContent>
        )}
        {billCategories.includes("quickteller") && (
          <TabsContent value="quickteller" className="mt-4"><QuicktellerForm balance={walletData?.wallet.balanceKobo} /></TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function ElectricityForm({ balance }: { balance?: number }) {
  const { data } = useApi<{ discos: Disco[] }>("/api/bills/electricity");
  const [discoCode, setDiscoCode] = React.useState("");
  const [meter, setMeter] = React.useState("");
  const [meterType, setMeterType] = React.useState<"PREPAID" | "POSTPAID">("PREPAID");
  const [amount, setAmount] = React.useState("");
  const [validating, setValidating] = React.useState(false);
  const [validated, setValidated] = React.useState<null | { customerName: string }>(null);
  const [paying, setPaying] = React.useState(false);
  const [done, setDone] = React.useState<null | { reference: string; token?: string; newBalanceKobo: number; amountKobo: number }>(null);

  const discos = data?.discos ?? [];
  const disco = discos.find((d) => d.code === discoCode);
  const amountKobo = parseNairaToKobo(amount);
  const insufficient = balance !== undefined && amountKobo > balance;

  const validate = async () => {
    if (!discoCode) return toast.error("Select a disco");
    if (meter.length < 8) return toast.error("Enter a valid meter number");
    setValidating(true);
    try {
      const res = await apiPost<{ valid: boolean; customerName: string; message: string }>("/api/bills/electricity", { action: "validate", discoCode, meterNumber: meter, meterType });
      if (!res.valid) { toast.error(res.message); setValidated(null); }
      else { setValidated({ customerName: res.customerName }); toast.success("Meter validated"); }
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message); } finally { setValidating(false); }
  };

  const pay = async () => {
    if (!validated) return toast.error("Validate your meter first");
    if (amountKobo < 50000) return toast.error("Minimum is ₦500");
    if (insufficient) return toast.error("Insufficient funds");
    setPaying(true);
    try {
      const res = await apiPost<{ reference: string; token?: string; newBalanceKobo: number }>("/api/bills/electricity", {
        action: "pay", discoCode, meterNumber: meter, meterType, amountNaira: amountKobo / 100, customerName: validated.customerName, discoName: disco?.name ?? "",
      });
      setDone({ ...res, amountKobo });
      mutateApi("/api/wallet"); mutateApi("/api/dashboard"); mutateApi("/api/transactions");
      toast.success("Electricity payment successful");
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message); } finally { setPaying(false); }
  };

  if (done) return <BillSuccess title="Electricity paid" amount={done.amountKobo} reference={done.reference} newBalanceKobo={done.newBalanceKobo} extra={done.token ? [{ label: "Token", value: done.token }] : []} onReset={() => { setDone(null); setMeter(""); setAmount(""); setValidated(null); }} />;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Electricity</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Distribution company</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(discos.length ? discos : []).map((d) => (
                <button key={d.id} onClick={() => { setDiscoCode(d.code); setValidated(null); }} className={cn("rounded-lg border px-2.5 py-2 text-xs font-medium transition-all", discoCode === d.code ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "hover:bg-accent")}>
                  {d.short}
                </button>
              ))}
              {!discos.length && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["PREPAID", "POSTPAID"] as const).map((t) => (
              <button key={t} onClick={() => { setMeterType(t); setValidated(null); }} className={cn("rounded-lg border py-2 text-sm font-medium transition-all", meterType === t ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "hover:bg-accent")}>{t}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="meter">Meter number</Label>
              <Input id="meter" value={meter} onChange={(e) => { setMeter(e.target.value.replace(/[^0-9]/g, "")); setValidated(null); }} placeholder="04172219014" />
            </div>
            <Button type="button" variant="outline" className="mt-auto" onClick={validate} disabled={validating || !discoCode || meter.length < 8}>
              {validating ? "Validating…" : <><Search className="mr-1 h-4 w-4" /> Validate</>}
            </Button>
          </div>
          {validated && (
            <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-sm">
              <Check className="h-4 w-4 text-success" />
              <span className="font-medium">{validated.customerName}</span>
              <Badge variant="secondary" className="ml-auto">Verified</Badge>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="amt">Amount</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">₦</span>
              <Input id="amt" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="5000" className="pl-8 text-lg font-medium tabular-nums" />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[2000, 5000, 10000, 20000].map((a) => <Button key={a} type="button" variant="outline" size="sm" onClick={() => setAmount(String(a))}>₦{a.toLocaleString()}</Button>)}
            </div>
          </div>
          {insufficient && <p className="text-xs text-destructive">Insufficient funds</p>}
          <Button className="w-full" size="lg" onClick={pay} disabled={paying || !validated || !amount}>
            {paying ? "Processing…" : <>Pay {amount && formatNaira(amountKobo)} <ArrowRight className="ml-1.5 h-4 w-4" /></>}
          </Button>
        </CardContent>
      </Card>
      <Card className="bg-muted/30"><CardContent className="py-4 text-sm"><p className="font-medium">Prepaid tokens</p><p className="mt-1 text-xs text-muted-foreground">Prepaid meters receive an instant token after payment. Postpaid meters are credited directly to the account.</p></CardContent></Card>
    </div>
  );
}

function UtilitiesForm({ balance }: { balance?: number }) {
  const { data } = useApi<{ products: BillProduct[] }>("/api/bills/utilities");
  const [product, setProduct] = React.useState<BillProduct | null>(null);
  const [customer, setCustomer] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [validating, setValidating] = React.useState(false);
  const [validated, setValidated] = React.useState<null | { customerName: string }>(null);
  const [paying, setPaying] = React.useState(false);
  const [done, setDone] = React.useState<null | { reference: string; newBalanceKobo: number; amountKobo: number }>(null);

  const products = data?.products ?? [];
  const amountKobo = product?.fixedAmountKobo ?? parseNairaToKobo(amount);
  const insufficient = balance !== undefined && amountKobo > balance;

  React.useEffect(() => { if (product?.fixedAmountKobo) setAmount(String(product.fixedAmountKobo / 100)); }, [product]);

  const validate = async () => {
    if (!product) return toast.error("Select a product");
    if (customer.length < 4) return toast.error("Enter the customer reference");
    setValidating(true);
    try {
      const res = await apiPost<{ valid: boolean; customerName: string; message: string }>("/api/bills/utilities", { action: "validate", code: product.code, customer });
      if (!res.valid) { toast.error(res.message); setValidated(null); }
      else { setValidated({ customerName: res.customerName }); toast.success("Customer validated"); }
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message); } finally { setValidating(false); }
  };

  const pay = async () => {
    if (!validated || !product) return toast.error("Validate the customer first");
    if (amountKobo < 10000) return toast.error("Minimum is ₦100");
    if (insufficient) return toast.error("Insufficient funds");
    setPaying(true);
    try {
      const res = await apiPost<{ reference: string; newBalanceKobo: number }>("/api/bills/utilities", {
        action: "pay", code: product.code, customer, customerName: validated.customerName, productName: product.name, category: product.category, amountNaira: amountKobo / 100,
      });
      setDone({ ...res, amountKobo });
      mutateApi("/api/wallet"); mutateApi("/api/dashboard"); mutateApi("/api/transactions");
      toast.success("Payment successful");
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message); } finally { setPaying(false); }
  };

  if (done) return <BillSuccess title="Bill paid" amount={done.amountKobo} reference={done.reference} newBalanceKobo={done.newBalanceKobo} onReset={() => { setDone(null); setCustomer(""); setValidated(null); }} />;

  const catIcon = (cat: string) => cat === "CABLE_TV" ? Tv : cat === "WATER" ? Droplet : cat === "INTERNET" ? Wifi : Building2;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Utilities & subscriptions</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Service</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {products.length === 0 ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />) : products.map((p) => {
                const Icon = catIcon(p.category);
                return (
                  <button key={p.id} onClick={() => { setProduct(p); setValidated(null); setCustomer(""); }} className={cn("flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center text-xs font-medium transition-all", product?.id === p.id ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "hover:bg-accent")}>
                    <Icon className="h-5 w-5" />
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
          {product && (
            <>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="cust">{fieldLabel(product.fields[0])}</Label>
                  <Input id="cust" value={customer} onChange={(e) => { setCustomer(e.target.value); setValidated(null); }} placeholder={fieldPlaceholder(product.fields[0])} />
                </div>
                <Button type="button" variant="outline" className="mt-auto" onClick={validate} disabled={validating || customer.length < 4}>
                  {validating ? "…" : <><Search className="mr-1 h-4 w-4" /> Validate</>}
                </Button>
              </div>
              {validated && (
                <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-sm">
                  <Check className="h-4 w-4 text-success" /><span className="font-medium">{validated.customerName}</span><Badge variant="secondary" className="ml-auto">Verified</Badge>
                </div>
              )}
              {!product.fixedAmountKobo && (
                <div className="space-y-1.5">
                  <Label htmlFor="uamt">Amount</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">₦</span>
                    <Input id="uamt" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="2000" className="pl-8 text-lg font-medium tabular-nums" />
                  </div>
                </div>
              )}
              {product.fixedAmountKobo && (
                <p className="text-sm text-muted-foreground">Fixed amount: <span className="font-medium text-foreground">{formatNaira(product.fixedAmountKobo)}</span></p>
              )}
              {insufficient && <p className="text-xs text-destructive">Insufficient funds</p>}
              <Button className="w-full" size="lg" onClick={pay} disabled={paying || !validated || (!amount && !product.fixedAmountKobo)}>
                {paying ? "Processing…" : <>Pay {formatNaira(amountKobo)} <ArrowRight className="ml-1.5 h-4 w-4" /></>}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
      <Card className="bg-muted/30"><CardContent className="py-4 text-sm"><p className="font-medium">Reliable bill payments</p><p className="mt-1 text-xs text-muted-foreground">Pay DStv, GOtv, StarTimes, Showmax, water, internet, Remita (government) and Quickteller bills — all via Baxi.</p></CardContent></Card>
    </div>
  );
}

function fieldLabel(f: string) {
  const map: Record<string, string> = { smartcard: "Smartcard number", iac: "IUC / IAC number", mobile: "Mobile number", customer: "Customer reference", account: "Account number", rrr: "Remita Reference (RRR)", reference: "Payment reference" };
  return map[f] ?? "Customer reference";
}
function fieldPlaceholder(f: string) {
  const map: Record<string, string> = { smartcard: "1234567890", iac: "7012345678", mobile: "+2348012345678", customer: "Customer ID", account: "Account number", rrr: "123456789012", reference: "Reference" };
  return map[f] ?? "Reference";
}

function BillSuccess({ title, amount, reference, newBalanceKobo, extra, onReset }: { title: string; amount: number; reference: string; newBalanceKobo: number; extra?: { label: string; value: string }[]; onReset: () => void }) {
  return (
    <Card className="mx-auto max-w-md">
      <div className="flex flex-col items-center bg-success/10 px-6 py-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/20"><Check className="h-8 w-8 text-success" /></div>
        <h2 className="mt-4 text-xl font-bold">{title}</h2>
        <p className="mt-3 text-3xl font-bold tabular-nums">{formatNaira(amount)}</p>
      </div>
      <CardContent className="space-y-2.5 pt-5 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Reference</span><span className="font-mono text-xs">{reference}</span></div>
        {extra?.map((e) => <div key={e.label} className="flex justify-between gap-2"><span className="text-muted-foreground">{e.label}</span><span className="text-right font-mono text-xs">{e.value}</span></div>)}
        <div className="flex justify-between"><span className="text-muted-foreground">New balance</span><span className="font-medium">{formatNaira(newBalanceKobo)}</span></div>
        <Button className="mt-2 w-full" variant="outline" onClick={onReset}>Done</Button>
      </CardContent>
    </Card>
  );
}

// ─── Remita Form ────────────────────────────────────────────────

interface RemitaBiller {
  id: string;
  name: string;
  category: string;
  description: string;
}

function RemitaForm({ balance }: { balance?: number }) {
  const { data } = useApi<{ billers: RemitaBiller[] }>("/api/bills/remita");
  const [billerId, setBillerId] = React.useState("");
  const [rrr, setRrr] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [validated, setValidated] = React.useState<null | { customerName: string; amount: number }>(null);
  const [done, setDone] = React.useState<null | { reference: string; amountKobo: number; newBalanceKobo: number }>(null);

  const billers = data?.billers ?? [];
  const selectedBiller = billers.find((b) => b.id === billerId);
  const amountKobo = parseNairaToKobo(amount);
  const insufficient = balance !== undefined && amountKobo > balance;

  const validate = async () => {
    if (!rrr) return toast.error("Enter your Remita Reference Number (RRR)");
    setLoading(true);
    try {
      const res = await apiPost<{ valid: boolean; customerName: string; amount: number; message: string }>("/api/bills/remita", {
        action: "validate", rrr,
      });
      if (!res.valid) { toast.error(res.message); setValidated(null); }
      else { setValidated({ customerName: res.customerName, amount: res.amount }); toast.success("RRR validated"); }
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message); } finally { setLoading(false); }
  };

  const pay = async () => {
    if (!validated) return toast.error("Validate your RRR first");
    if (insufficient) return toast.error("Insufficient funds");
    setLoading(true);
    try {
      const res = await apiPost<{ reference: string; amountKobo: number; newBalanceKobo: number }>("/api/bills/remita", {
        action: "pay", rrr, amountNaira: validated.amount, billerName: selectedBiller?.name ?? "Remita",
      });
      setDone({ ...res, amountKobo: res.amountKobo });
      mutateApi("/api/wallet"); mutateApi("/api/dashboard"); mutateApi("/api/transactions");
      toast.success("Remita payment successful");
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message); } finally { setLoading(false); }
  };

  if (done) return <BillSuccess title="Remita payment successful" amount={done.amountKobo} reference={done.reference} newBalanceKobo={done.newBalanceKobo} onReset={() => { setDone(null); setRrr(""); setAmount(""); setValidated(null); setBillerId(""); }} />;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Remita Payment</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Pay government bills, JAMB, WAEC, NIMC, and other Remita-enabled services using your RRR.
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rrr">Remita Reference Number (RRR)</Label>
            <Input id="rrr" value={rrr} onChange={(e) => setRrr(e.target.value.replace(/\D/g, ""))} placeholder="123456789012" className="font-mono" />
          </div>
          {rrr && !validated && (
            <Button onClick={validate} disabled={loading} className="w-full">
              {loading ? "Validating…" : "Validate RRR"}
            </Button>
          )}
          {validated && (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-sm">
                <Check className="h-4 w-4 text-success" /><span className="font-medium">{validated.customerName}</span><Badge variant="secondary" className="ml-auto">Verified</Badge>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ramt">Amount</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">₦</span>
                  <Input id="ramt" inputMode="numeric" value={String(validated.amount)} readOnly className="pl-8 text-lg font-medium tabular-nums bg-muted/50" />
                </div>
              </div>
              {insufficient && <p className="text-xs text-destructive">Insufficient funds</p>}
              <Button className="w-full" size="lg" onClick={pay} disabled={loading || insufficient}>
                {loading ? "Processing…" : <>Pay {formatNaira(validated.amount * 100)} <ArrowRight className="ml-1.5 h-4 w-4" /></>}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
      <Card className="bg-muted/30">
        <CardContent className="py-4 text-sm">
          <p className="font-medium">About Remita</p>
          <p className="mt-1 text-xs text-muted-foreground">Remita is Nigeria's leading payment platform for government collections. Use it to pay JAMB, WAEC, NIMC, tax, and other government bills.</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Quickteller Form ───────────────────────────────────────────

interface QuicktellerBiller {
  id: string;
  name: string;
  category: string;
  description: string;
  paymentCode: string;
}

function QuicktellerForm({ balance }: { balance?: number }) {
  const { data } = useApi<{ billers: QuicktellerBiller[] }>("/api/bills/quickteller");
  const [billerId, setBillerId] = React.useState("");
  const [customerRef, setCustomerRef] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [validated, setValidated] = React.useState<null | { customerName: string }>(null);
  const [done, setDone] = React.useState<null | { reference: string; amountKobo: number; newBalanceKobo: number }>(null);

  const billers = data?.billers ?? [];
  const selectedBiller = billers.find((b) => b.id === billerId);
  const amountKobo = parseNairaToKobo(amount);
  const insufficient = balance !== undefined && amountKobo > balance;

  const validate = async () => {
    if (!billerId) return toast.error("Select a biller");
    if (!customerRef) return toast.error("Enter customer reference");
    setLoading(true);
    try {
      const res = await apiPost<{ valid: boolean; customerName: string; message: string }>("/api/bills/quickteller", {
        action: "validate", billerId, customerRef,
      });
      if (!res.valid) { toast.error(res.message); setValidated(null); }
      else { setValidated({ customerName: res.customerName }); toast.success("Customer validated"); }
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message); } finally { setLoading(false); }
  };

  const pay = async () => {
    if (!validated) return toast.error("Validate customer first");
    if (amountKobo < 10000) return toast.error("Minimum is ₦100");
    if (insufficient) return toast.error("Insufficient funds");
    setLoading(true);
    try {
      const res = await apiPost<{ reference: string; amountKobo: number; newBalanceKobo: number }>("/api/bills/quickteller", {
        action: "pay", billerId, customerRef, amountNaira: amountKobo / 100, customerName: validated.customerName, billerName: selectedBiller?.name ?? "",
      });
      setDone({ ...res, amountKobo: res.amountKobo });
      mutateApi("/api/wallet"); mutateApi("/api/dashboard"); mutateApi("/api/transactions");
      toast.success("Quickteller payment successful");
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message); } finally { setLoading(false); }
  };

  if (done) return <BillSuccess title="Quickteller payment successful" amount={done.amountKobo} reference={done.reference} newBalanceKobo={done.newBalanceKobo} onReset={() => { setDone(null); setCustomerRef(""); setAmount(""); setValidated(null); setBillerId(""); }} />;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Quickteller Payment</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Pay for airtime, data, cable TV, betting, education, and 7,000+ billers via Interswitch Quickteller.
          </div>
          <div className="space-y-1.5">
            <Label>Select biller</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {billers.slice(0, 9).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => { setBillerId(b.id); setValidated(null); setCustomerRef(""); }}
                  className={`rounded-lg border p-2.5 text-left text-xs transition-colors ${
                    billerId === b.id
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <p className="font-medium truncate">{b.name}</p>
                  <p className="mt-0.5 text-[10px] truncate">{b.category}</p>
                </button>
              ))}
            </div>
          </div>
          {billerId && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="qref">Customer reference</Label>
                <Input id="qref" value={customerRef} onChange={(e) => setCustomerRef(e.target.value)} placeholder={selectedBiller?.category === "airtime" ? "Phone number" : "Account / ID number"} />
              </div>
              {customerRef && !validated && (
                <Button onClick={validate} disabled={loading} className="w-full">
                  {loading ? "Validating…" : "Validate customer"}
                </Button>
              )}
              {validated && (
                <>
                  <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-sm">
                    <Check className="h-4 w-4 text-success" /><span className="font-medium">{validated.customerName}</span><Badge variant="secondary" className="ml-auto">Verified</Badge>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="qamt">Amount</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">₦</span>
                      <Input id="qamt" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="2000" className="pl-8 text-lg font-medium tabular-nums" />
                    </div>
                  </div>
                  {insufficient && <p className="text-xs text-destructive">Insufficient funds</p>}
                  <Button className="w-full" size="lg" onClick={pay} disabled={loading || !amount || insufficient}>
                    {loading ? "Processing…" : <>Pay {formatNaira(amountKobo)} <ArrowRight className="ml-1.5 h-4 w-4" /></>}
                  </Button>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
      <Card className="bg-muted/30">
        <CardContent className="py-4 text-sm">
          <p className="font-medium">About Quickteller</p>
          <p className="mt-1 text-xs text-muted-foreground">Quickteller is Interswitch's bill payment platform with 7,000+ billers across Nigeria. Pay for airtime, data, cable TV, betting, and more.</p>
        </CardContent>
      </Card>
    </div>
  );
}
