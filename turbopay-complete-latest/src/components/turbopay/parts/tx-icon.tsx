"use client";

import * as React from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Phone,
  Wifi,
  Zap,
  Receipt,
  RotateCcw,
  Wallet,
  Banknote,
} from "lucide-react";
import type { TxType } from "@/lib/turbopay/types";
import { cn } from "@/lib/utils";

interface TxIconProps {
  type: TxType;
  direction: "CREDIT" | "DEBIT";
  className?: string;
}

export function TxIcon({ type, direction, className }: TxIconProps) {
  const cfg = iconFor(type, direction);
  const Icon = cfg.icon;
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
        cfg.bg,
        cfg.fg,
        className
      )}
    >
      <Icon className="h-5 w-5" />
    </div>
  );
}

function iconFor(type: TxType, direction: "CREDIT" | "DEBIT") {
  switch (type) {
    case "FUNDING":
      return { icon: Banknote, bg: "bg-success/15", fg: "text-success" };
    case "TRANSFER_IN":
      return { icon: ArrowDownLeft, bg: "bg-success/15", fg: "text-success" };
    case "TRANSFER_OUT":
      return { icon: ArrowUpRight, bg: "bg-accent", fg: "text-accent-foreground" };
    case "AIRTIME":
      return { icon: Phone, bg: "bg-primary/10", fg: "text-primary" };
    case "DATA":
      return { icon: Wifi, bg: "bg-primary/10", fg: "text-primary" };
    case "BILL_ELECTRICITY":
      return { icon: Zap, bg: "bg-warning/15", fg: "text-warning-foreground" };
    case "BILL_UTILITY":
      return { icon: Receipt, bg: "bg-warning/15", fg: "text-warning-foreground" };
    case "REVERSAL":
      return { icon: RotateCcw, bg: "bg-muted", fg: "text-muted-foreground" };
    case "FEE":
      return { icon: Wallet, bg: "bg-muted", fg: "text-muted-foreground" };
    default:
      return direction === "CREDIT"
        ? { icon: ArrowDownLeft, bg: "bg-success/15", fg: "text-success" }
        : { icon: ArrowUpRight, bg: "bg-muted", fg: "text-muted-foreground" };
  }
}
