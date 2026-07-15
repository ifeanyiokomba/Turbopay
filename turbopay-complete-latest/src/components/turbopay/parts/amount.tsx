"use client";

import { formatNaira, formatNairaCompact } from "@/lib/turbopay/money";
import { cn } from "@/lib/utils";

export function Amount({
  kobo,
  direction,
  showSign = true,
  className,
  compact = false,
}: {
  kobo: number;
  direction?: "CREDIT" | "DEBIT";
  showSign?: boolean;
  className?: string;
  compact?: boolean;
}) {
  const isCredit = direction === "CREDIT";
  const sign = showSign ? (isCredit ? "+" : kobo > 0 ? "-" : "") : "";
  return (
    <span
      className={cn(
        "tabular-nums font-medium",
        direction === "CREDIT" ? "text-success" : direction === "DEBIT" ? "text-foreground" : "",
        className
      )}
    >
      {sign}
      {compact ? formatNairaCompact(kobo) : formatNaira(kobo, { sign: false })}
    </span>
  );
}
