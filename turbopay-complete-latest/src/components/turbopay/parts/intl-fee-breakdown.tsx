"use client";

import * as React from "react";
import { Info, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface FeeBreakdownProps {
  sourceCurrency: string;
  destCurrency: string;
  amountMinor: number;
  rawRate: number;
  quotedRate: number;
  spreadBps: number;
  platformFeeMinor: number;
  providerFeeMinor?: number;
  destinationAmountMinor: number;
  className?: string;
}

export function FeeBreakdown({
  sourceCurrency,
  destCurrency,
  amountMinor,
  rawRate,
  quotedRate,
  spreadBps,
  platformFeeMinor,
  providerFeeMinor = 0,
  destinationAmountMinor,
  className,
}: FeeBreakdownProps) {
  const [expanded, setExpanded] = React.useState(false);

  // Calculate FX margin in source currency units
  const fxMarginMinor = Math.round(amountMinor - (destinationAmountMinor / quotedRate));
  const totalFeeMinor = platformFeeMinor + providerFeeMinor + fxMarginMinor;

  return (
    <Card className={cn("border-dashed", className)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Fee Breakdown</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums">
            {sourceCurrency} {((totalFeeMinor) / 100).toFixed(2)}
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <CardContent className="border-t px-4 pb-4 pt-3 space-y-2.5">
          {/* Mid-market rate vs quoted rate */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Mid-market rate</span>
            <span className="tabular-nums">1 {sourceCurrency} = {rawRate.toFixed(6)} {destCurrency}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Your rate</span>
            <span className="tabular-nums">1 {sourceCurrency} = {quotedRate.toFixed(6)} {destCurrency}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">FX margin</span>
            <span className="tabular-nums">{spreadBps} bps ({(spreadBps / 100).toFixed(2)}%)</span>
          </div>

          <Separator className="my-2" />

          {/* Fee items */}
          {fxMarginMinor > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">FX margin cost</span>
              <span className="tabular-nums">{sourceCurrency} {(fxMarginMinor / 100).toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Platform fee</span>
            <span className="tabular-nums">{sourceCurrency} {(platformFeeMinor / 100).toFixed(2)}</span>
          </div>
          {providerFeeMinor > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Provider fee</span>
              <span className="tabular-nums">{sourceCurrency} {(providerFeeMinor / 100).toFixed(2)}</span>
            </div>
          )}

          <Separator className="my-2" />

          {/* Totals */}
          <div className="flex items-center justify-between text-xs font-medium">
            <span>Total fees</span>
            <span className="tabular-nums">{sourceCurrency} {(totalFeeMinor / 100).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">You send</span>
            <span className="tabular-nums">{sourceCurrency} {(amountMinor / 100).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-xs font-medium">
            <span>Recipient gets</span>
            <span className="tabular-nums text-success">{destCurrency} {(destinationAmountMinor / 100).toFixed(2)}</span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
