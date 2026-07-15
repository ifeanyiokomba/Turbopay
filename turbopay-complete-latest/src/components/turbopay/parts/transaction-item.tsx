"use client";

import { TxIcon } from "./tx-icon";
import { Amount } from "./amount";
import { TX_TYPE_LABELS, type TransactionView } from "@/lib/turbopay/types";
import { cn } from "@/lib/utils";

export function TransactionItem({
  tx,
  onClick,
  showDate = true,
}: {
  tx: TransactionView;
  onClick?: (tx: TransactionView) => void;
  showDate?: boolean;
}) {
  const label = labelFor(tx);
  return (
    <button
      type="button"
      onClick={() => onClick?.(tx)}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors",
        "hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      <TxIcon type={tx.type} direction={tx.direction} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{label}</p>
          <Amount
            kobo={tx.amountKobo}
            direction={tx.direction}
            className="text-sm font-semibold"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {tx.counterpartyName ? `${tx.counterpartyName} · ` : ""}
            {tx.reference}
          </p>
          {showDate && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {timeAgo(tx.createdAt)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function labelFor(tx: TransactionView): string {
  if (tx.description) return tx.description;
  return TX_TYPE_LABELS[tx.type] ?? "Transaction";
}

export function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const min = 60_000, hr = 3_600_000, day = 86_400_000;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString("en-NG", { month: "short", day: "numeric" });
}
