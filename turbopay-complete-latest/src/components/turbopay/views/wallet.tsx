"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Plus,
  Copy,
  Check,
  Building2,
  Info,
  RefreshCw,
  ShieldCheck,
  ArrowDownLeft,
  Loader2,
  CreditCard,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { useApi, apiPost, apiFetch, mutateApi } from "@/lib/turbopay/client";
import { formatNaira } from "@/lib/turbopay/money";
import { useApp } from "@/components/turbopay/store";
import { BalanceCard } from "@/components/turbopay/parts/balance-card";
import { PageHeader, StatCard } from "@/components/turbopay/parts/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

interface WalletData {
  wallet: {
    id: string;
    balanceKobo: number;
    ledgerBalanceKobo: number;
    currency: string;
    status: "ACTIVE" | "FROZEN";
  };
  virtualAccount: {
    id: string;
    accountNumber: string;
    accountName: string;
    bankName: string;
    bankCode: string;
    provider: string;
    status: string;
  } | null;
  provisioningError: string | null;
  beneficiaries: any[];
}

const QUICK_AMOUNTS = [1000, 5000, 10000, 25000, 50000, 100000];

export function WalletView() {
  const user = useApp((s) => s.user);
  const setView = useApp((s) => s.setView);
  const { data, isLoading, refetch } = useApi<WalletData>("/api/wallet");
  const [fundOpen, setFundOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // Handle Stripe checkout redirect feedback.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    if (payment === "success") {
      toast.success("Payment successful! Your wallet will be credited shortly.");
      refetch();
      // Clean up the URL params.
      window.history.replaceState({}, "", window.location.pathname);
    } else if (payment === "cancelled") {
      toast.info("Payment was cancelled.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refetch]);

  const copyAcct = async () => {
    if (!data?.virtualAccount) return;
    try {
      await navigator.clipboard.writeText(data.virtualAccount.accountNumber);
      setCopied(true);
      toast.success("Account number copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Wallet"
        description="Your balance, virtual account, and funding."
        icon={<Building2 className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setFundOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Fund wallet
            </Button>
          </>
        }
      />

      {isLoading || !data ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-56 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <BalanceCard
              wallet={data.wallet}
              accountName={data.virtualAccount?.accountName ?? user?.fullName}
              accountNumber={data.virtualAccount?.accountNumber}
              bankName={data.virtualAccount?.bankName}
              kycTier={user?.kycTier}
            />

            {/* Currency Wallets */}
            <CurrencyWalletsSection />

            {/* Virtual account detail */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Your dedicated virtual account</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.virtualAccount ? (
                  <>
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertTitle>How funding works</AlertTitle>
                      <AlertDescription>
                        Fund your wallet instantly with a card (Stripe) or transfer money from any
                        Nigerian bank to the account below. Card payments are instant; bank transfers
                        are received by Monnify and credited via a verified webhook.
                      </AlertDescription>
                    </Alert>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <DetailRow label="Account number" value={data.virtualAccount.accountNumber} mono />
                      <DetailRow label="Account name" value={data.virtualAccount.accountName} />
                      <DetailRow label="Bank" value={data.virtualAccount.bankName} />
                      <DetailRow label="Provider" value={`${data.virtualAccount.provider.charAt(0).toUpperCase() + data.virtualAccount.provider.slice(1)} (Reserved Account)`} />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={copyAcct}>
                        {copied ? <Check className="mr-1.5 h-4 w-4 text-success" /> : <Copy className="mr-1.5 h-4 w-4" />}
                        {copied ? "Copied" : "Copy account number"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setFundOpen(true)}>
                        <Plus className="mr-1.5 h-4 w-4" /> Fund wallet
                      </Button>
                    </div>
                  </>
                ) : (
                  <VirtualAccountProvisioning
                    provisioningError={data.provisioningError}
                    onRetry={() => refetch()}
                  />
                )}
              </CardContent>
            </Card>

            {/* Saved Payment Methods */}
            <SavedPaymentMethods />
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <StatCard
                label="Available balance"
                value={formatNaira(data.wallet.balanceKobo)}
                icon={<ArrowDownLeft className="h-4 w-4 text-success" />}
                tone="success"
              />
              <StatCard
                label="Ledger balance"
                value={formatNaira(data.wallet.ledgerBalanceKobo)}
                icon={<ShieldCheck className="h-4 w-4" />}
                hint={data.wallet.balanceKobo === data.wallet.ledgerBalanceKobo ? "Reconciled ✓" : "Reconciling…"}
              />
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Quick fund</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2">
                  {QUICK_AMOUNTS.map((amt) => (
                    <Button key={amt} variant="outline" size="sm" onClick={() => setFundOpen(true)}>
                      ₦{amt.toLocaleString()}
                    </Button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Fund your wallet with a card (Stripe) or bank transfer. Card payments are instant; bank transfers update automatically via webhook.
                </p>
              </CardContent>
            </Card>

            <Card className="bg-primary/5">
              <CardContent className="py-4">
                <p className="text-sm font-medium">Need higher limits?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your current limit is Tier {user?.kycTier}. Upgrade your KYC to send and hold more.
                </p>
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setView("kyc")}>
                  <ShieldCheck className="mr-1.5 h-4 w-4" /> Upgrade KYC
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <FundDialog open={fundOpen} onOpenChange={setFundOpen} onDone={() => { refetch(); mutateApi("/api/dashboard"); mutateApi("/api/transactions"); }} />
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-medium ${mono ? "tabular-nums tracking-wider" : ""}`}>{value}</p>
    </div>
  );
}

function FundDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const user = useApp((s) => s.user);
  const [amount, setAmount] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [mode, setMode] = React.useState<"card" | "bank_transfer" | "ussd" | "demo">("card");

  // Dynamic funding methods based on user's country
  const fundingMethods = React.useMemo(() => {
    const country = user?.country ?? "NG";
    const methods: Array<{ id: string; label: string; description: string; providers: string[] }> = [];

    // Card payments — available in most countries
    methods.push({ id: "card", label: "Debit Card", description: "Pay with your debit or credit card", providers: ["Stripe", "Paystack"] });

    // Bank transfer — available in NG and other African countries
    if (["NG", "GH", "KE", "ZA"].includes(country)) {
      methods.push({ id: "bank_transfer", label: "Bank Transfer", description: "Transfer from any bank account", providers: ["Monnify", "Paystack"] });
    }

    // USSD — Nigeria specific
    if (country === "NG") {
      methods.push({ id: "ussd", label: "USSD", description: "Pay via USSD from your phone", providers: ["Paystack", "Flutterwave"] });
    }

    // Mobile money — for non-NG African countries
    if (["GH", "KE", "ZA"].includes(country)) {
      methods.push({ id: "mobile_money", label: "Mobile Money", description: "Pay with MoMo or M-Pesa", providers: ["Onafriq"] });
    }

    // Demo mode — always available for testing
    methods.push({ id: "demo", label: "Demo", description: "Simulate funding (sandbox)", providers: ["Demo"] });

    return methods;
  }, [user?.country]);

  // Auto-select first method
  React.useEffect(() => {
    if (fundingMethods.length > 0 && !fundingMethods.find((m) => m.id === mode)) {
      setMode(fundingMethods[0].id as any);
    }
  }, [fundingMethods, mode]);

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt < 100) {
      toast.error("Minimum funding is ₦100");
      return;
    }
    setLoading(true);
    try {
      if (mode === "card") {
        const res = await apiFetch<{ url: string }>("/api/stripe/create-checkout-session", {
          method: "POST",
          body: JSON.stringify({ amountNaira: amt }),
        });
        if (res?.url) {
          window.location.href = res.url;
          return;
        }
        throw new Error("Failed to create checkout session");
      } else if (mode === "bank_transfer" || mode === "ussd") {
        const res = await apiFetch<{ authorizationUrl: string; reference: string }>("/api/paystack/fund-session", {
          method: "POST",
          body: JSON.stringify({ amountNaira: amt }),
        });
        if (res?.authorizationUrl) {
          window.location.href = res.authorizationUrl;
          return;
        }
        throw new Error("Failed to initialize payment");
      } else {
        await apiPost("/api/wallet/fund", { amountNaira: amt });
        toast.success(`₦${amt.toLocaleString()} added to your wallet`);
        setAmount("");
        onOpenChange(false);
        onDone();
      }
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Funding failed");
    } finally {
      setLoading(false);
    }
  };

  const selectedMethod = fundingMethods.find((m) => m.id === mode);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fund your wallet</DialogTitle>
          <DialogDescription>
            {selectedMethod?.description ?? "Choose a funding method to add money to your wallet."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {/* Dynamic payment method selector */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {fundingMethods.map((method) => (
              <button
                key={method.id}
                type="button"
                onClick={() => setMode(method.id as any)}
                className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                  mode === method.id
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                <p className="font-medium">{method.label}</p>
                <p className="mt-0.5 text-[11px]">{method.providers[0]}</p>
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount (₦)</Label>
            <Input
              id="amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="5000"
              className="text-lg font-medium"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[1000, 5000, 10000, 25000].map((a) => (
              <Button key={a} type="button" variant="outline" size="sm" onClick={() => setAmount(String(a))}>
                ₦{a >= 1000 ? `${a / 1000}k` : a}
              </Button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading || !amount}>
            {loading ? "Processing…" : mode === "demo" ? "Fund wallet" : `Pay ₦${amount ? Number(amount).toLocaleString() : "0"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PROVISIONING_STEPS = [
  "Contacting provider\u2026",
  "Creating reserved account\u2026",
  "Verifying account details\u2026",
];

function VirtualAccountProvisioning({
  provisioningError,
  onRetry,
}: {
  provisioningError: string | null;
  onRetry: () => void;
}) {
  const [attempts, setAttempts] = React.useState(0);
  const [manualRetries, setManualRetries] = React.useState(0);
  const maxAutoAttempts = 8;
  const maxManualRetries = 3;
  const isFailed = !!provisioningError;
  const isExhausted = attempts >= maxAutoAttempts && !isFailed;

  // Auto-poll with exponential backoff: 2s → 3s → 5s → 8s → 13s (capped)
  React.useEffect(() => {
    if (isFailed || isExhausted) return;
    const baseDelay = 2000;
    const delay = Math.min(baseDelay * Math.pow(1.5, attempts), 13000);
    const timer = setTimeout(() => {
      setAttempts((a) => a + 1);
      onRetry();
    }, delay);
    return () => clearTimeout(timer);
  }, [attempts, isFailed, isExhausted, onRetry]);

  const handleManualRetry = () => {
    if (manualRetries >= maxManualRetries) return;
    setManualRetries((r) => r + 1);
    setAttempts(0);
    onRetry();
  };

  // Determine current step for progress display
  const stepIndex = Math.min(attempts, PROVISIONING_STEPS.length - 1);

  return (
    <Alert variant={isFailed ? "destructive" : "default"}>
      {isFailed ? (
        <AlertCircle className="h-4 w-4" />
      ) : isExhausted ? (
        <Info className="h-4 w-4" />
      ) : (
        <Loader2 className="h-4 w-4 animate-spin" />
      )}
      <AlertTitle>
        {isFailed
          ? "Virtual account setup failed"
          : isExhausted
            ? "Taking longer than expected"
            : "Setting up your virtual account"}
      </AlertTitle>
      <AlertDescription>
        {isFailed ? (
          <div className="space-y-2">
            <p className="text-sm">{provisioningError}</p>
            {manualRetries < maxManualRetries ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleManualRetry}>
                  <RefreshCw className="mr-1.5 h-3 w-3" /> Try again
                </Button>
                <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
                  Refresh page
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Maximum retries reached. Please contact support if this persists.
              </p>
            )}
          </div>
        ) : isExhausted ? (
          <div className="space-y-2">
            <p>Provisioning is taking longer than usual. This can happen during high traffic.</p>
            {manualRetries < maxManualRetries ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleManualRetry}>
                  <RefreshCw className="mr-1.5 h-3 w-3" /> Try again
                </Button>
                <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
                  Refresh page
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Maximum retries reached. Please contact support if this persists.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {/* Progress steps */}
            <div className="space-y-1">
              {PROVISIONING_STEPS.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {i < stepIndex ? (
                    <Check className="h-3 w-3 text-emerald-500" />
                  ) : i === stepIndex ? (
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  ) : (
                    <div className="h-3 w-3 rounded-full border border-muted-foreground/30" />
                  )}
                  <span className={i <= stepIndex ? "text-foreground" : "text-muted-foreground"}>
                    {step}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Usually takes a few seconds. Auto-retrying with backoff.
            </p>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

interface SavedCard {
  id: string;
  card?: { brand: string; last4: string; exp_month: number; exp_year: number };
}

function SavedPaymentMethods() {
  const { data: cards, isLoading, refetch } = useApi<SavedCard[]>("/api/stripe/payment-methods");
  const [removing, setRemoving] = React.useState<string | null>(null);

  const handleRemove = async (pmId: string) => {
    setRemoving(pmId);
    try {
      await apiFetch(`/api/stripe/payment-methods/${pmId}`, { method: "DELETE" });
      toast.success("Card removed");
      refetch();
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Failed to remove card");
    } finally {
      setRemoving(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Saved cards</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!cards || cards.length === 0) return null;

  const brandIcon = (brand: string) => {
    const b = brand.toLowerCase();
    if (b === "visa") return "VISA";
    if (b === "mastercard") return "MC";
    if (b === "amex") return "AMEX";
    return brand.toUpperCase().slice(0, 4);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Saved cards</CardTitle>
          <Badge variant="outline" className="text-[10px]">{cards.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {cards.map((pm) => (
          <div key={pm.id} className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-14 items-center justify-center rounded-md bg-muted text-[10px] font-bold text-muted-foreground">
                {pm.card ? brandIcon(pm.card.brand) : "CARD"}
              </div>
              <div>
                <p className="text-sm font-medium">
                  {pm.card ? `${pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1)} •••• ${pm.card.last4}` : "Card"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Expires {pm.card ? `${String(pm.card.exp_month).padStart(2, "0")}/${pm.card.exp_year}` : "—"}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRemove(pm.id)}
              disabled={removing === pm.id}
              className="text-muted-foreground hover:text-destructive"
            >
              {removing === pm.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">
          Saved cards are stored securely on Stripe. You can remove them at any time.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Currency Wallets Section ──────────────────────────────────

const CURRENCY_META: Record<string, { symbol: string; name: string; flag: string }> = {
  NGN: { symbol: "₦", name: "Nigerian Naira", flag: "🇳🇬" },
  USD: { symbol: "$", name: "US Dollar", flag: "🇺🇸" },
  EUR: { symbol: "€", name: "Euro", flag: "🇪🇺" },
  GBP: { symbol: "£", name: "British Pound", flag: "🇬🇧" },
  CAD: { symbol: "C$", name: "Canadian Dollar", flag: "🇨🇦" },
  AUD: { symbol: "A$", name: "Australian Dollar", flag: "🇦🇺" },
  KES: { symbol: "KSh", name: "Kenyan Shilling", flag: "🇰🇪" },
  GHS: { symbol: "GH₵", name: "Ghanaian Cedi", flag: "🇬🇭" },
  ZAR: { symbol: "R", name: "South African Rand", flag: "🇿🇦" },
};

interface CurrencyWalletItem {
  id: string;
  currency: string;
  balanceMinor: number;
  lockedMinor: number;
  status: string;
}

function CurrencyWalletsSection() {
  const [wallets, setWallets] = React.useState<CurrencyWalletItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState<string | null>(null);

  const fetchWallets = React.useCallback(async () => {
    try {
      const res = await fetch("/api/intl/currency-wallets").then((r) => r.json());
      setWallets(res.data ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  React.useEffect(() => { fetchWallets(); }, [fetchWallets]);

  const handleCreate = async (currency: string) => {
    setCreating(currency);
    try {
      await apiPost("/api/intl/currency-wallets", { currency });
      toast.success(`${CURRENCY_META[currency]?.name ?? currency} wallet created`);
      fetchWallets();
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not create wallet");
    } finally {
      setCreating(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Currency Wallets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show wallets that exist (excluding NGN which is the main wallet)
  const nonNgWallets = wallets.filter((w) => w.currency !== "NGN");
  // Currencies that don't have wallets yet
  const allCurrencies = Object.keys(CURRENCY_META).filter((c) => c !== "NGN");
  const missingCurrencies = allCurrencies.filter((c) => !nonNgWallets.find((w) => w.currency === c));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Currency Wallets</CardTitle>
          <Badge variant="outline" className="text-[10px]">{nonNgWallets.length + 1}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Manage your multi-currency wallets. Create wallets to hold and transact in different currencies.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {/* Existing wallets */}
          {nonNgWallets.map((w) => {
            const meta = CURRENCY_META[w.currency] ?? { symbol: w.currency, name: w.currency, flag: "💱" };
            return (
              <div
                key={w.id}
                className="rounded-xl border p-3 transition-colors hover:bg-accent/50"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{meta.flag}</span>
                  <div>
                    <p className="text-sm font-medium">{w.currency}</p>
                    <p className="text-[11px] text-muted-foreground">{meta.name}</p>
                  </div>
                </div>
                <p className="mt-2 text-lg font-bold tabular-nums">
                  {meta.symbol}{(w.balanceMinor / 100).toFixed(2)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {w.status === "ACTIVE" ? "Active" : w.status}
                </p>
              </div>
            );
          })}
          {/* Create new wallet buttons */}
          {missingCurrencies.slice(0, 3).map((currency) => {
            const meta = CURRENCY_META[currency];
            return (
              <button
                key={currency}
                onClick={() => handleCreate(currency)}
                disabled={creating === currency}
                className="flex flex-col items-center justify-center rounded-xl border border-dashed p-3 transition-colors hover:border-primary/50 hover:bg-accent/50"
              >
                {creating === currency ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : (
                  <>
                    <span className="text-lg">{meta.flag}</span>
                    <p className="mt-1 text-xs font-medium">Create {currency}</p>
                    <p className="text-[10px] text-muted-foreground">{meta.name}</p>
                  </>
                )}
              </button>
            );
          })}
        </div>
        {missingCurrencies.length > 3 && (
          <p className="text-[11px] text-muted-foreground">
            +{missingCurrencies.length - 3} more currencies available.{" "}
            <button
              onClick={() => {
                // Create all remaining currencies
                missingCurrencies.slice(3).forEach((c) => handleCreate(c));
              }}
              className="text-primary underline underline-offset-2"
            >
              Create all
            </button>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
