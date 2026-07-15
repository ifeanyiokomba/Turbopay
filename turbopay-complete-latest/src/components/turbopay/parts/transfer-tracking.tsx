"use client";

import * as React from "react";
import {
  Check,
  Clock,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  X,
  Undo2,
  Hourglass,
  ShieldCheck,
  Wallet,
  Send,
  Globe,
  Flag,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TimelineEvent {
  state: string;
  timestamp: string;
  label: string;
}

interface TransferTrackingProps {
  reference: string;
  status: string;
  state: string | null;
  timeline: TimelineEvent[];
  createdAt: string;
  className?: string;
}

const STATE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bgColor: string; description: string }> = {
  CREATED: { icon: <Globe className="h-3.5 w-3.5" />, color: "text-blue-600", bgColor: "bg-blue-100 dark:bg-blue-900/30", description: "Transfer initiated" },
  INITIATED: { icon: <Clock className="h-3.5 w-3.5" />, color: "text-blue-600", bgColor: "bg-blue-100 dark:bg-blue-900/30", description: "Processing request" },
  PIN_VERIFIED: { icon: <ShieldCheck className="h-3.5 w-3.5" />, color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-900/30", description: "Identity verified" },
  AML_CHECKED: { icon: <Flag className="h-3.5 w-3.5" />, color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-900/30", description: "Compliance cleared" },
  HOLD_POSTED: { icon: <Wallet className="h-3.5 w-3.5" />, color: "text-amber-600", bgColor: "bg-amber-100 dark:bg-amber-900/30", description: "Funds secured" },
  PROVIDER_CALLED: { icon: <Send className="h-3.5 w-3.5" />, color: "text-purple-600", bgColor: "bg-purple-100 dark:bg-purple-900/30", description: "Sent to payment provider" },
  SETTLED: { icon: <Check className="h-3.5 w-3.5" />, color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-900/30", description: "Transfer completed" },
  REVERSED: { icon: <Undo2 className="h-3.5 w-3.5" />, color: "text-red-600", bgColor: "bg-red-100 dark:bg-red-900/30", description: "Funds returned" },
  TIMEOUT: { icon: <Hourglass className="h-3.5 w-3.5" />, color: "text-orange-600", bgColor: "bg-orange-100 dark:bg-orange-900/30", description: "Transfer timed out" },
  INTL_TRANSFER_SENT: { icon: <Send className="h-3.5 w-3.5" />, color: "text-purple-600", bgColor: "bg-purple-100 dark:bg-purple-900/30", description: "Provider processing" },
  INTL_TRANSFER_FAILED: { icon: <X className="h-3.5 w-3.5" />, color: "text-red-600", bgColor: "bg-red-100 dark:bg-red-900/30", description: "Provider rejected" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING: { label: "Processing", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", icon: <RefreshCw className="h-3 w-3 animate-spin" /> },
  SUCCESS: { label: "Completed", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", icon: <Check className="h-3 w-3" /> },
  FAILED: { label: "Failed", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", icon: <AlertTriangle className="h-3 w-3" /> },
  REVERSED: { label: "Reversed", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400", icon: <Undo2 className="h-3 w-3" /> },
};

export function TransferTracking({
  reference,
  status,
  state,
  timeline,
  createdAt,
  className,
}: TransferTrackingProps) {
  const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;

  // Build unique ordered steps from timeline
  const steps = React.useMemo(() => {
    const seen = new Set<string>();
    const ordered: TimelineEvent[] = [];
    for (const event of timeline) {
      if (!seen.has(event.state)) {
        seen.add(event.state);
        ordered.push(event);
      }
    }
    // If timeline is empty, create a minimal one
    if (ordered.length === 0) {
      ordered.push({ state: "CREATED", timestamp: createdAt, label: "Transfer Created" });
    }
    return ordered;
  }, [timeline, createdAt]);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Transfer Status</CardTitle>
          <Badge className={cn("text-[10px]", statusCfg.color)}>
            {statusCfg.icon} <span className="ml-1">{statusCfg.label}</span>
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground font-mono">{reference}</p>
      </CardHeader>
      <CardContent>
        {/* Timeline */}
        <div className="relative">
          {steps.map((step, i) => {
            const cfg = STATE_CONFIG[step.state] || STATE_CONFIG.INITIATED;
            const isLast = i === steps.length - 1;
            const isCurrent = step.state === state || (i === steps.length - 1 && status === "PENDING");
            const isTerminal = step.state === "SETTLED" || step.state === "REVERSED" || step.state === "TIMEOUT";

            return (
              <div key={`${step.state}-${i}`} className="flex gap-3 pb-4 last:pb-0">
                {/* Vertical line + dot */}
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full",
                      isCurrent ? cfg.bgColor : isTerminal ? cfg.bgColor : "bg-muted",
                      isCurrent ? cfg.color : isTerminal ? cfg.color : "text-muted-foreground"
                    )}
                  >
                    {cfg.icon}
                  </div>
                  {!isLast && (
                    <div className={cn(
                      "w-px flex-1 my-1",
                      i < steps.length - 1 ? "bg-border" : "bg-transparent"
                    )} />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-sm font-medium", isCurrent && "text-foreground")}>
                      {step.label}
                    </span>
                    {isCurrent && status === "PENDING" && (
                      <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {cfg.description}
                  </p>
                  <time className="text-[10px] text-muted-foreground/70">
                    {new Date(step.timestamp).toLocaleString()}
                  </time>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
