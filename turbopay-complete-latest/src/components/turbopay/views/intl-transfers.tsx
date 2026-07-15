"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Globe,
  Send,
  ArrowRightLeft,
  Users,
  Search,
  Star,
  Trash2,
  Plus,
  Check,
  Clock,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  Landmark,
  Smartphone,
  Wallet,
  Building2,
  Filter,
  X,
} from "lucide-react";
import { useApi, apiPost, apiFetch, mutateApi } from "@/lib/turbopay/client";
import { formatNaira } from "@/lib/turbopay/money";
import { useApp } from "@/components/turbopay/store";
import { usePinDialog } from "@/components/turbopay/parts/pin-dialog";
import { PageHeader, StatCard, EmptyState } from "@/components/turbopay/parts/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { FeeBreakdown } from "@/components/turbopay/parts/intl-fee-breakdown";
import { TransferTracking } from "@/components/turbopay/parts/transfer-tracking";

// ─── Types ────────────────────────────────────────────────────

interface CurrencyWallet {
  id: string;
  currency: string;
  balanceMinor: number;
  lockedMinor: number;
  status: string;
}

interface IntlBeneficiary {
  id: string;
  name: string;
  country: string;
  bankName?: string;
  accountNumber?: string;
  swiftCode?: string;
  routingNumber?: string;
  mobileWallet?: string;
  nickname?: string;
  currency?: string;
  isFavourite: boolean;
  verificationStatus: string;
}

interface IntlTransfer {
  id: string;
  reference: string;
  status: string;
  amountKobo: number;
  feeKobo: number;
  counterpartyName: string;
  counterpartyBank?: string;
  description?: string;
  metadata?: string;
  createdAt: string;
}

interface Country {
  code: string;
  name: string;
  currency: string;
  flag: string;
}

interface FxQuote {
  rate: number;
  destinationAmountMinor: number;
  platformFeeMinor: number;
  sourceAmount: number;
  destinationAmount: number;
  rawRate?: number;
  spreadBps?: number;
  providerFeeMinor?: number;
  expiresAt?: string;
}

// ─── Constants ────────────────────────────────────────────────

const CURRENCY_FLAGS: Record<string, string> = {
  NGN: "🇳🇬", USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", CAD: "🇨🇦",
  AUD: "🇦🇺", KES: "🇰🇪", GHS: "🇬🇭", ZAR: "🇿🇦",
};

const CURRENCY_NAMES: Record<string, string> = {
  NGN: "Nigerian Naira", USD: "US Dollar", EUR: "Euro", GBP: "British Pound",
  CAD: "Canadian Dollar", AUD: "Australian Dollar", KES: "Kenyan Shilling",
  GHS: "Ghanaian Cedi", ZAR: "South African Rand",
};

const TRANSFER_TYPES = [
  { key: "bank", label: "Bank Transfer", icon: Building2, description: "Send to any bank account worldwide" },
  { key: "mobile", label: "Mobile Money", icon: Smartphone, description: "Send to mobile wallets in Africa & Asia" },
  { key: "wallet", label: "Wallet Transfer", icon: Wallet, description: "Send to another Turbopay user internationally" },
  { key: "cash", label: "Cash Pickup", icon: Landmark, description: "Recipient picks up cash at a partner location" },
];

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  PENDING: { color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", icon: <Clock className="h-3 w-3" /> },
  PROCESSING: { color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400", icon: <RefreshCw className="h-3 w-3 animate-spin" /> },
  SUCCESS: { color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", icon: <Check className="h-3 w-3" /> },
  COMPLETED: { color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", icon: <Check className="h-3 w-3" /> },
  FAILED: { color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", icon: <AlertTriangle className="h-3 w-3" /> },
  REVERSED: { color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400", icon: <ArrowRightLeft className="h-3 w-3" /> },
};

// ─── Main Component ───────────────────────────────────────────

export function IntlTransfersView() {
  const user = useApp((s) => s.user);
  const pinDialog = usePinDialog();
  const [activeTab, setActiveTab] = React.useState("send");

  return (
    <div className="space-y-6">
      <PageHeader
        title="International Transfers"
        description="Send and receive money globally with competitive exchange rates"
        icon={<Globe className="h-5 w-5" />}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="send" className="gap-1.5">
            <Send className="h-3.5 w-3.5" /> Send
          </TabsTrigger>
          <TabsTrigger value="wallets" className="gap-1.5">
            <Wallet className="h-3.5 w-3.5" /> Wallets
          </TabsTrigger>
          <TabsTrigger value="beneficiaries" className="gap-1.5">
            <Users className="h-3.5 w-3.5" /> Beneficiaries
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" /> History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="send"><SendMoneyTab /></TabsContent>
        <TabsContent value="wallets"><CurrencyWalletsTab /></TabsContent>
        <TabsContent value="beneficiaries"><BeneficiariesTab /></TabsContent>
        <TabsContent value="history"><TransferHistoryTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Send Money Tab ───────────────────────────────────────────

function SendMoneyTab() {
  const pinDialog = usePinDialog();
  const { data: wallets, isLoading: walletsLoading } = useApi<CurrencyWallet[]>("/api/intl/currency-wallets");
  const { data: beneficiaries, isLoading: bensLoading } = useApi<IntlBeneficiary[]>("/api/intl/beneficiaries");
  const { data: countries } = useApi<Country[]>("/api/intl/countries");

  const [step, setStep] = React.useState<"form" | "quote" | "confirm" | "done">("form");
  const [transferType, setTransferType] = React.useState("bank");
  const [sourceCurrency, setSourceCurrency] = React.useState("NGN");
  const [destCurrency, setDestCurrency] = React.useState("USD");
  const [amount, setAmount] = React.useState("");
  const [selectedCountry, setSelectedCountry] = React.useState<Country | null>(null);
  const [selectedBeneficiary, setSelectedBeneficiary] = React.useState<IntlBeneficiary | null>(null);
  const [beneficiaryName, setBeneficiaryName] = React.useState("");
  const [beneficiaryAccount, setBeneficiaryAccount] = React.useState("");
  const [beneficiaryBank, setBeneficiaryBank] = React.useState("");
  const [beneficiarySwift, setBeneficiarySwift] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [quote, setQuote] = React.useState<FxQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);
  const [rateTimer, setRateTimer] = React.useState(60);

  // Rate refresh timer
  React.useEffect(() => {
    if (step !== "quote" || rateTimer <= 0) return;
    const interval = setInterval(() => setRateTimer((t) => t - 1), 1000);
    return () => clearInterval(interval);
  }, [step, rateTimer]);

  const amountMinor = Math.round(parseFloat(amount || "0") * 100);
  const sourceWallet = wallets?.find((w) => w.currency === sourceCurrency);
  const insufficientFunds = sourceWallet ? amountMinor > sourceWallet.balanceMinor : false;

  const fetchQuote = async () => {
    if (!amountMinor || amountMinor <= 0) return;
    setQuoteLoading(true);
    setRateTimer(60);
    try {
      const q = await apiPost<FxQuote>("/api/intl/quote", {
        from: sourceCurrency,
        to: destCurrency,
        amountMinor,
      });
      setQuote(q);
      setStep("quote");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to get quote");
    } finally {
      setQuoteLoading(false);
    }
  };

  const submitTransfer = async () => {
    const pin = await pinDialog.request();
    if (!pin) return;
    setSubmitting(true);
    try {
      const res = await apiPost("/api/intl/send", {
        sourceCurrency,
        destinationCurrency: destCurrency,
        amountMinor,
        beneficiary: {
          name: selectedBeneficiary?.name || beneficiaryName,
          account: selectedBeneficiary?.accountNumber || beneficiaryAccount || undefined,
          bank: selectedBeneficiary?.bankName || beneficiaryBank || undefined,
          country: selectedCountry?.code || "US",
          routingCode: beneficiarySwift || undefined,
        },
        purpose: purpose || "International transfer",
        pin,
      });
      setResult(res);
      setStep("done");
      mutateApi("/api/intl/history");
      mutateApi("/api/intl/currency-wallets");
      toast.success("Transfer submitted successfully");
    } catch (e: any) {
      toast.error(e.message ?? "Transfer failed");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStep("form");
    setAmount("");
    setBeneficiaryName("");
    setBeneficiaryAccount("");
    setBeneficiaryBank("");
    setBeneficiarySwift("");
    setPurpose("");
    setQuote(null);
    setResult(null);
    setSelectedBeneficiary(null);
  };

  if (step === "done" && result) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <Card className="overflow-hidden">
          <div className="flex flex-col items-center bg-success/10 px-6 py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/20">
              <Check className="h-8 w-8 text-success" />
            </div>
            <h2 className="mt-4 text-xl font-bold">Transfer Submitted</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your international transfer is being processed
            </p>
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              Reference: {result.reference}
            </p>
          </div>
          <CardContent className="space-y-3 pt-5">
            <Row label="Amount Sent" value={`${CURRENCY_FLAGS[sourceCurrency]} ${parseFloat(amount).toLocaleString()} ${sourceCurrency}`} />
            <Row label="Recipient Gets" value={`${CURRENCY_FLAGS[destCurrency]} ${(quote?.destinationAmount ?? 0).toLocaleString()} ${destCurrency}`} />
            <Row label="Exchange Rate" value={`1 ${sourceCurrency} = ${quote?.rate?.toFixed(4)} ${destCurrency}`} />
            <Row label="Fee" value={`${CURRENCY_FLAGS[sourceCurrency]} ${((quote?.platformFeeMinor ?? 0) / 100).toLocaleString()}`} />
            <Row label="Total Debit" value={`${CURRENCY_FLAGS[sourceCurrency]} ${((amountMinor + (quote?.platformFeeMinor ?? 0)) / 100).toLocaleString()}`} />
            <Separator className="my-3" />
            <Button onClick={resetForm} className="w-full">Send Another Transfer</Button>
          </CardContent>
        </Card>

        {/* Transfer Tracking Timeline */}
        <TransferTracking
          reference={result.reference}
          status="PENDING"
          state="PROVIDER_CALLED"
          timeline={[
            { state: "CREATED", timestamp: new Date().toISOString(), label: "Transfer Created" },
            { state: "INITIATED", timestamp: new Date().toISOString(), label: "Initiated" },
            { state: "PIN_VERIFIED", timestamp: new Date().toISOString(), label: "PIN Verified" },
            { state: "HOLD_POSTED", timestamp: new Date().toISOString(), label: "Funds Secured" },
            { state: "PROVIDER_CALLED", timestamp: new Date().toISOString(), label: "Sent to Provider" },
          ]}
          createdAt={new Date().toISOString()}
        />
      </div>
    );
  }

  if (step === "quote" && quote) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" /> Review Your Transfer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl bg-muted/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">You Send</span>
              <span className="text-lg font-semibold">{CURRENCY_FLAGS[sourceCurrency]} {parseFloat(amount).toLocaleString()} {sourceCurrency}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Recipient Gets</span>
              <span className="text-lg font-semibold text-success">{CURRENCY_FLAGS[destCurrency]} {quote.destinationAmount?.toLocaleString()} {destCurrency}</span>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <Row label="Exchange Rate" value={`1 ${sourceCurrency} = ${quote.rate?.toFixed(4)} ${destCurrency}`} />
            <Row label="Total Debit" value={`${CURRENCY_FLAGS[sourceCurrency]} ${((amountMinor + (quote.platformFeeMinor ?? 0)) / 100).toLocaleString()}`} />
            <Row label="Recipient" value={selectedBeneficiary?.name || beneficiaryName || "—"} />
            <Row label="Estimated Arrival" value="1-3 business days" />
          </div>

          {/* Transparent Fee Breakdown */}
          <FeeBreakdown
            sourceCurrency={sourceCurrency}
            destCurrency={destCurrency}
            amountMinor={amountMinor}
            rawRate={quote.rawRate ?? quote.rate * 1.02}
            quotedRate={quote.rate}
            spreadBps={quote.spreadBps ?? 200}
            platformFeeMinor={quote.platformFeeMinor}
            providerFeeMinor={quote.providerFeeMinor ?? 0}
            destinationAmountMinor={quote.destinationAmountMinor}
          />

          {rateTimer > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              Rate valid for {Math.floor(rateTimer / 60)}:{(rateTimer % 60).toString().padStart(2, "0")}
              <Button variant="link" size="sm" className="ml-2 h-auto p-0" onClick={fetchQuote}>
                <RefreshCw className="mr-1 h-3 w-3" /> Refresh
              </Button>
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("form")} className="flex-1">Back</Button>
            <Button onClick={submitTransfer} disabled={submitting} className="flex-1">
              {submitting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Confirm & Send
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Main form */}
      <div className="lg:col-span-2 space-y-5">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Send Money Internationally</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Transfer type */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TRANSFER_TYPES.map((tt) => (
                <button
                  key={tt.key}
                  onClick={() => setTransferType(tt.key)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all",
                    transferType === tt.key
                      ? "border-primary bg-primary/5 text-primary ring-1 ring-primary"
                      : "hover:bg-muted/50"
                  )}
                >
                  <tt.icon className="h-5 w-5" />
                  <span className="text-xs font-medium">{tt.label}</span>
                </button>
              ))}
            </div>

            {/* Currency pair */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">You Send</Label>
                <Select value={sourceCurrency} onValueChange={setSourceCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NGN">🇳🇬 NGN</SelectItem>
                    <SelectItem value="USD">🇺🇸 USD</SelectItem>
                    <SelectItem value="EUR">🇪🇺 EUR</SelectItem>
                    <SelectItem value="GBP">🇬🇧 GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Recipient Gets</Label>
                <Select value={destCurrency} onValueChange={setDestCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">🇺🇸 USD</SelectItem>
                    <SelectItem value="EUR">🇪🇺 EUR</SelectItem>
                    <SelectItem value="GBP">🇬🇧 GBP</SelectItem>
                    <SelectItem value="CAD">🇨🇦 CAD</SelectItem>
                    <SelectItem value="AUD">🇦🇺 AUD</SelectItem>
                    <SelectItem value="KES">🇰🇪 KES</SelectItem>
                    <SelectItem value="GHS">🇬🇭 GHS</SelectItem>
                    <SelectItem value="ZAR">🇿🇦 ZAR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <Label className="text-xs">Amount ({sourceCurrency})</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-lg font-semibold"
                min="0"
              />
              {sourceWallet && (
                <p className="text-xs text-muted-foreground">
                  Available: {CURRENCY_FLAGS[sourceCurrency]} {(sourceWallet.balanceMinor / 100).toLocaleString()} {sourceCurrency}
                </p>
              )}
            </div>

            {/* Beneficiary */}
            <div className="space-y-1.5">
              <Label className="text-xs">Recipient Name</Label>
              <Input
                placeholder="Full name of recipient"
                value={beneficiaryName}
                onChange={(e) => setBeneficiaryName(e.target.value)}
              />
            </div>

            {transferType === "bank" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Account / IBAN</Label>
                  <Input placeholder="Account number" value={beneficiaryAccount} onChange={(e) => setBeneficiaryAccount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Bank Name</Label>
                  <Input placeholder="Bank name" value={beneficiaryBank} onChange={(e) => setBeneficiaryBank(e.target.value)} />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Purpose of Transfer</Label>
              <Textarea placeholder="e.g. Family support, Business payment, Education" value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} />
            </div>

            <Button
              onClick={fetchQuote}
              disabled={!amount || parseFloat(amount) <= 0 || quoteLoading || insufficientFunds}
              className="w-full"
              size="lg"
            >
              {quoteLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
              Get Exchange Rate
            </Button>

            {insufficientFunds && (
              <p className="text-center text-sm text-destructive">Insufficient funds in {sourceCurrency} wallet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sidebar — saved beneficiaries */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Saved Recipients</CardTitle>
          </CardHeader>
          <CardContent>
            {bensLoading ? (
              <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : beneficiaries && beneficiaries.length > 0 ? (
              <div className="space-y-2">
                {beneficiaries.slice(0, 5).map((ben) => (
                  <button
                    key={ben.id}
                    onClick={() => {
                      setSelectedBeneficiary(ben);
                      setBeneficiaryName(ben.name);
                      setBeneficiaryAccount(ben.accountNumber || "");
                      setBeneficiaryBank(ben.bankName || "");
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-all hover:bg-muted/50",
                      selectedBeneficiary?.id === ben.id && "border-primary bg-primary/5"
                    )}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {ben.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ben.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {ben.bankName || ben.country} {ben.accountNumber ? `• ${ben.accountNumber}` : ""}
                      </p>
                    </div>
                    {ben.isFavourite && <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-center text-sm text-muted-foreground py-4">No saved recipients yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Supported Countries</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {["🇺🇸 US", "🇬🇧 UK", "🇪🇺 EU", "🇨🇦 CA", "🇦🇺 AU", "🇰🇪 KE", "🇬🇭 GH", "🇿🇦 ZA"].map((c) => (
                <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Currency Wallets Tab ─────────────────────────────────────

function CurrencyWalletsTab() {
  const { data: wallets, isLoading } = useApi<CurrencyWallet[]>("/api/intl/currency-wallets");
  const { data: primaryWallet } = useApi<{ wallet: { balanceKobo: number; currency: string } }>("/api/wallet");

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Primary NGN wallet */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Primary Wallet</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">
                {CURRENCY_FLAGS.NGN} ₦{((primaryWallet?.wallet?.balanceKobo ?? 0) / 100).toLocaleString()}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Nigerian Naira</p>
            </div>
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Active</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Multi-currency wallets */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {wallets?.map((w) => (
          <Card key={w.id} className={cn("transition-all hover:shadow-md", w.status !== "ACTIVE" && "opacity-60")}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-2xl">{CURRENCY_FLAGS[w.currency] || "💱"}</p>
                  <p className="mt-2 text-xl font-bold tabular-nums">
                    {(w.balanceMinor / 100).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">{w.currency} — {CURRENCY_NAMES[w.currency] || w.currency}</p>
                </div>
                <Badge variant={w.status === "ACTIVE" ? "secondary" : "destructive"} className="text-[10px]">
                  {w.status}
                </Badge>
              </div>
              {w.lockedMinor > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Locked: {(w.lockedMinor / 100).toLocaleString()} {w.currency}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Beneficiaries Tab ────────────────────────────────────────

function BeneficiariesTab() {
  const { data: beneficiaries, isLoading, refetch } = useApi<IntlBeneficiary[]>("/api/intl/beneficiaries");
  const [addOpen, setAddOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [form, setForm] = React.useState({ name: "", country: "", bankName: "", accountNumber: "", swiftCode: "", nickname: "", currency: "USD" });
  const [saving, setSaving] = React.useState(false);

  const filtered = beneficiaries?.filter((b) =>
    !search || b.name.toLowerCase().includes(search.toLowerCase()) || b.country.toLowerCase().includes(search.toLowerCase())
  );

  const addBeneficiary = async () => {
    if (!form.name || !form.country) return toast.error("Name and country are required");
    setSaving(true);
    try {
      await apiPost("/api/intl/beneficiaries", form);
      toast.success("Beneficiary added");
      setAddOpen(false);
      setForm({ name: "", country: "", bankName: "", accountNumber: "", swiftCode: "", nickname: "", currency: "USD" });
      refetch();
    } catch (e: any) {
      toast.error(e.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const toggleFavourite = async (id: string, current: boolean) => {
    try {
      await apiFetch("/api/intl/beneficiaries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isFavourite: !current }),
      });
      refetch();
    } catch (e: any) {
      toast.error(e.message ?? "Update failed");
    }
  };

  const deleteBeneficiary = async (id: string) => {
    try {
      await apiFetch(`/api/intl/beneficiaries?id=${id}`, { method: "DELETE" });
      toast.success("Beneficiary removed");
      refetch();
    } catch (e: any) {
      toast.error(e.message ?? "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search beneficiaries..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Add
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>
      ) : filtered && filtered.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((ben) => (
            <Card key={ben.id} className="transition-all hover:shadow-md">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {ben.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{ben.nickname || ben.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {ben.country} {ben.bankName ? `• ${ben.bankName}` : ""} {ben.accountNumber ? `• ${ben.accountNumber}` : ""}
                  </p>
                  <div className="mt-1 flex gap-1">
                    {ben.swiftCode && <Badge variant="outline" className="text-[10px] px-1.5 py-0">SWIFT</Badge>}
                    {ben.mobileWallet && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Mobile</Badge>}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => toggleFavourite(ben.id, ben.isFavourite)} className="p-1 hover:bg-muted rounded">
                    <Star className={cn("h-4 w-4", ben.isFavourite ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground")} />
                  </button>
                  <button onClick={() => deleteBeneficiary(ben.id)} className="p-1 hover:bg-muted rounded">
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No beneficiaries yet"
          description="Add international recipients to send money faster"
          action={<Button onClick={() => setAddOpen(true)} size="sm"><Plus className="mr-1 h-4 w-4" /> Add Beneficiary</Button>}
        />
      )}

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add International Beneficiary</DialogTitle>
            <DialogDescription>Save a recipient for future transfers</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Full Name *</Label>
              <Input placeholder="Recipient's full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Country *</Label>
                <Select value={form.country} onValueChange={(v) => setForm({ ...form, country: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="US">🇺🇸 United States</SelectItem>
                    <SelectItem value="GB">🇬🇧 United Kingdom</SelectItem>
                    <SelectItem value="EU">🇪🇺 European Union</SelectItem>
                    <SelectItem value="CA">🇨🇦 Canada</SelectItem>
                    <SelectItem value="AU">🇦🇺 Australia</SelectItem>
                    <SelectItem value="KE">🇰🇪 Kenya</SelectItem>
                    <SelectItem value="GH">🇬🇭 Ghana</SelectItem>
                    <SelectItem value="ZA">🇿🇦 South Africa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Preferred Currency</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">🇺🇸 USD</SelectItem>
                    <SelectItem value="EUR">🇪🇺 EUR</SelectItem>
                    <SelectItem value="GBP">🇬🇧 GBP</SelectItem>
                    <SelectItem value="KES">🇰🇪 KES</SelectItem>
                    <SelectItem value="GHS">🇬🇭 GHS</SelectItem>
                    <SelectItem value="ZAR">🇿🇦 ZAR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Bank Name</Label>
              <Input placeholder="Bank name" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Account / IBAN</Label>
                <Input placeholder="Account number" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>SWIFT/BIC</Label>
                <Input placeholder="SWIFT code" value={form.swiftCode} onChange={(e) => setForm({ ...form, swiftCode: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Nickname (optional)</Label>
              <Input placeholder="e.g. My US account" value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={addBeneficiary} disabled={saving}>
              {saving && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />} Save Beneficiary
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Transfer History Tab ─────────────────────────────────────

function TransferHistoryTab() {
  const { data: transfers, isLoading } = useApi<IntlTransfer[]>("/api/intl/history");
  const [statusFilter, setStatusFilter] = React.useState<string>("ALL");

  const filtered = transfers?.filter((t) => statusFilter === "ALL" || t.status === statusFilter);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {["ALL", "PENDING", "SUCCESS", "FAILED"].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(s)}
            className="text-xs"
          >
            {s}
          </Button>
        ))}
      </div>

      {filtered && filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((t) => {
            const meta = t.metadata ? JSON.parse(t.metadata) : {};
            const st = STATUS_CONFIG[t.status] || STATUS_CONFIG.PENDING;
            return (
              <Card key={t.id} className="transition-all hover:shadow-sm">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-full", st.color)}>
                    <ArrowUpRight className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{t.counterpartyName}</p>
                      <Badge className={cn("text-[10px]", st.color)}>
                        {st.icon} <span className="ml-1">{t.status}</span>
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {t.counterpartyBank || ""} {meta.destinationCurrency ? `• ${meta.destinationCurrency}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{formatNaira(t.amountKobo)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Clock className="h-6 w-6" />}
          title="No transfers yet"
          description="Your international transfer history will appear here"
        />
      )}
    </div>
  );
}

// ─── Shared Helpers ───────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
