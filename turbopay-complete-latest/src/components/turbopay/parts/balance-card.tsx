"use client";

import * as React from "react";
import { Eye, EyeOff, ShieldCheck, Copy, Check } from "lucide-react";
import { formatNaira } from "@/lib/turbopay/money";
import type { WalletView } from "@/lib/turbopay/types";
import { Logo } from "@/components/turbopay/logo";
import { cn } from "@/lib/utils";

export function BalanceCard({
  wallet,
  accountName,
  accountNumber,
  bankName,
  kycTier,
  className,
}: {
  wallet: WalletView;
  accountName?: string;
  accountNumber?: string;
  bankName?: string;
  kycTier?: number;
  className?: string;
}) {
  const [hidden, setHidden] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    if (!accountNumber) return;
    try {
      await navigator.clipboard.writeText(accountNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const matched = wallet.balanceKobo === wallet.ledgerBalanceKobo;

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
        {kycTier ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium backdrop-blur">
            <ShieldCheck className="h-3 w-3" /> Tier {kycTier}
          </span>
        ) : null}
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
