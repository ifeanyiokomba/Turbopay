"use client";

import { cn } from "@/lib/utils";

type BadgeVariant = "success" | "warning" | "error" | "info" | "muted";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: "bg-success/15 text-success border-success/20",
  warning: "bg-warning/15 text-warning-foreground border-warning/20",
  error: "bg-destructive/15 text-destructive border-destructive/20",
  info: "bg-blue-500/15 text-blue-500 border-blue-500/20",
  muted: "bg-muted text-muted-foreground border-border",
};

interface StatusBadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

export function StatusBadge({ variant, children, className, dot = true }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            variant === "success" && "bg-success",
            variant === "warning" && "bg-warning",
            variant === "error" && "bg-destructive",
            variant === "info" && "bg-blue-500",
            variant === "muted" && "bg-muted-foreground/50",
          )}
        />
      )}
      {children}
    </span>
  );
}

export function statusVariant(status: string): BadgeVariant {
  const s = status?.toUpperCase();
  if (s === "SUCCESS" || s === "ACTIVE" || s === "COMPLETED" || s === "VERIFIED" || s === "ENABLED") return "success";
  if (s === "PENDING" || s === "PROCESSING" || s === "REVIEW" || s === "KYC_PENDING") return "warning";
  if (s === "FAILED" || s === "ERROR" || s === "BLOCKED" || s === "SUSPENDED" || s === "DISABLED") return "error";
  if (s === "CANCELLED" || s === "EXPIRED" || s === "CLOSED") return "muted";
  return "info";
}
