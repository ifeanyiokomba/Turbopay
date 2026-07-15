"use client";

import * as React from "react";
import { Eye, EyeOff, ShieldCheck, Copy, Check, Plus, ChevronDown, Wallet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatNaira, koboToNaira } from "@/lib/turbopay/money";
import { apiPost, mutateApi } from "@/lib/turbopay/client";
import type { WalletView } from "@/lib/turbopay/types";
import { Logo } from "@/components/turbopay/logo";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Currency metadata for display
const CURRENCY_META: Record<string, { symbol: string; name: string; decimals: number; flag: string }> = {
  NGN: { symbol: "₦", name: "Nigerian Naira", decimals: 2, flag: "🇳🇬" },
  USD: { symbol: "$", name: "US Dollar", decimals: 2, flag: "🇺🇸" },
  EUR: { symbol: "€", name: "Euro", decimals: 2, flag: "🇪🇺" },
  GBP: { symbol: "£", name: "British Pound", decimals: 2, flag: "🇬🇧" },
  CAD: { symbol: "C$", name: "Canadian Dollar", decimals: 2, flag: "🇨🇦" },
  AUD: { symbol: "A$", name: "Australian Dollar", decimals: 2, flag: "🇦🇺" },
  KES: { symbol: "KSh", name: "Kenyan Shilling", decimals: 2, flag: "🇰🇪" },
  GHS: { symbol: "GH₵", name: "Ghanaian Cedi", decimals: 2, flag: "🇬🇭" },
  ZAR: { symbol: "R", name: "South African Rand", decimals: 2, flag: "🇿🇦" },
};

const USER_COUNTRY_CURRENCY: Record<string, string> = {
  NG: "NGN", US: "USD", GB: "GBP", EU: "EUR", CA: "CAD", AU: "AUD",
  KE: "KES", GH: "GHS", ZA: "ZAR",
};

/** Format a currency wallet balance using its minor unit */
function formatCurrencyBalance(currency: string, balanceMinor: number): string {
  const meta = CURRENCY_META[currency] ?? { symbol: currency, decimals: 2 };
  const amount = balanceMinor / Math.pow(10, meta.decimals);
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  });
  return `${meta.symbol}${formatted}`;
}

export interface CurrencyWalletInfo {
  currency: string;
  balanceMinor: number;
  lockedMinor: number;
  status: string;
}

export function MultiCurrencyBalanceCard({
  wallet,
  currencyWallets = [],
  accountName,
  accountNumber,
  bankName,
  kycTier,
  userCountry,
  className,
}: {
  wallet: WalletView;
  currencyWallets?: CurrencyWalletInfo[];
  accountName?: string;
  accountNumber?: string;
  bankName?: string;
  kycTier?: number;
  userCountry?: string;
  className?: string;
}) {
  const [hidden, setHidden] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [creating, setCreating] = React.useState<string | null>(null);
  const [currencyOpen, setCurrencyOpen] = React.useState(false);

  const defaultCurrency = USER_COUNTRY_CURRENCY[userCountry ?? "NG"] ?? "NGN";

  const copy = async () => {
    if (!accountNumber) return;
    try {
      await navigator.clipboard.writeText(accountNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const matched = wallet.balanceKobo === wallet.ledgerBalanceKobo;

  const handleCreateWallet = async (currency: string) => {
    setCreating(currency);
    try {
      await apiPost("/api/intl/currency-wallets", { currency });
      toast.success(`${CURRENCY_META[currency]?.name ?? currency} wallet created`);
      mutateApi("/api/dashboard");
      mutateApi("/api/intl/currency-wallets");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not create wallet");
    } finally {
      setCreating(null);
    }
  };

  return (
    <div
      className={cn(
        "tp-wallet-card relative overflow-hidden rounded-2xl p-5 shadow-lg sm:p-6",
        className
      )}
    >
      <div className="tp-grain pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Logo size={28} />
          <span className="text-sm font-semibold tracking-wide opacity-90">Turbopay Wallet</span>
        </div>
        <div className="flex items-center gap-2">
          {kycTier ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium backdrop-blur">
              <ShieldCheck className="h-3 w-3" /> Tier {kycTier}
            </span>
          ) : null}
          {/* Currency switcher badge */}
          <Popover open={currencyOpen} onOpenChange={setCurrencyOpen}>
            <PopoverTrigger asChild>
              <button
                className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium backdrop-blur transition hover:bg-white/25"
                aria-label="Switch currency wallet"
              >
                <Wallet className="h-3 w-3" />
                {CURRENCY_META[defaultCurrency]?.flag} {defaultCurrency}
                <ChevronDown className="h-3 w-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
              <CurrencyWalletList
                currencyWallets={currencyWallets}
                ngnBalanceKobo={wallet.balanceKobo}
                hidden={hidden}
                creating={creating}
                onCreateWallet={handleCreateWallet}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="relative mt-5">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide opacity-80">
          Available balance
          <button
            onClick={() => setHidden((h) => !h)}
            className="rounded p-0.5 hover:bg-white/10"
            aria-label={hidden ? "Show balance" : "Hide balance"}
          >
            {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="mt-1 text-3xl font-bold tabular-nums sm:text-4xl">
          {hidden ? "₦ ••••••" : formatNaira(wallet.balanceKobo)}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] opacity-80">
          <span className={cn("h-1.5 w-1.5 rounded-full", matched ? "bg-emerald-300" : "bg-amber-300")} />
          Ledger reconciled · {formatNaira(wallet.ledgerBalanceKobo)}
        </div>
        {/* Multi-currency total hint */}
        {currencyWallets.length > 0 && (
          <div className="mt-2 flex items-center gap-1 text-[11px] opacity-70">
            <Wallet className="h-3 w-3" />
            {currencyWallets.length} other wallet{currencyWallets.length !== 1 ? "s" : ""} active
            <button
              onClick={() => setCurrencyOpen(true)}
              className="ml-1 underline underline-offset-2 hover:opacity-100"
            >
              View all
            </button>
          </div>
        )}
      </div>

      {accountNumber && (
        <div className="relative mt-6 flex items-end justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide opacity-70">Virtual account</p>
            <p className="text-lg font-semibold tracking-wider tabular-nums">{accountNumber}</p>
            <p className="text-xs opacity-80">{bankName ?? "Monnify MFB"}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide opacity-70">Account name</p>
            <p className="max-w-[10rem] truncate text-sm font-medium">{accountName}</p>
            <button
              onClick={copy}
              className="mt-1 inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-1 text-[11px] backdrop-blur transition hover:bg-white/25"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Currency wallet list shown in the popover */
function CurrencyWalletList({
  currencyWallets,
  ngnBalanceKobo,
  hidden,
  creating,
  onCreateWallet,
}: {
  currencyWallets: CurrencyWalletInfo[];
  ngnBalanceKobo: number;
  hidden: boolean;
  creating: string | null;
  onCreateWallet: (currency: string) => void;
}) {
  // NGN is always first (shown in main card)
  const allCurrencies = ["NGN", ...Object.keys(CURRENCY_META).filter((c) => c !== "NGN")];
  const walletMap = new Map(currencyWallets.map((w) => [w.currency, w]));

  return (
    <div className="space-y-1">
      <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Your wallets</p>
      {allCurrencies.map((currency) => {
        const meta = CURRENCY_META[currency];
        const walletData = walletMap.get(currency);
        const isNGN = currency === "NGN";
        const balance = isNGN ? ngnBalanceKobo : (walletData?.balanceMinor ?? 0);
        const exists = !!walletData || isNGN;

        return (
          <div
            key={currency}
            className="flex items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent/50"
          >
            <div className="flex items-center gap-2.5">
              <span className="text-base">{meta?.flag}</span>
              <div>
                <p className="font-medium">{currency}</p>
                <p className="text-[11px] text-muted-foreground">{meta?.name}</p>
              </div>
            </div>
            <div className="text-right">
              {exists ? (
                <p className="font-medium tabular-nums">
                  {hidden ? "•••" : formatCurrencyBalance(currency, balance)}
                </p>
              ) : creating === currency ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] text-primary"
                  onClick={() => onCreateWallet(currency)}
                >
                  <Plus className="mr-1 h-3 w-3" /> Create
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
