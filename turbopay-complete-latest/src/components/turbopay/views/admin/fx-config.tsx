"use client";

import * as React from "react";
import { DollarSign, Power, Save } from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

interface FxConfigRow {
  id: string;
  pair: string; // e.g. "USD→NGN"
  fromCurrency: string;
  toCurrency: string;
  spreadBps: number;
  platformFeeBps: number;
  minAmountMinor: number;
  maxAmountMinor: number | null;
  enabled: boolean;
}

export function FxConfigurationView() {
  const { data, isLoading, error } = useApi<FxConfigRow[]>("/api/admin/fx");

  return (
    <div className="space-y-5">
      <PageHeader
        title="FX Rates"
        description="Per-pair spreads, platform fees, and limits for currency conversion."
        icon={<DollarSign className="h-5 w-5" />}
      />

      {error ? (
        <Card><CardContent className="p-6 text-sm text-destructive">{(error as Error).message}</CardContent></Card>
      ) : isLoading || !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState icon={<DollarSign className="h-6 w-6" />} title="No FX pairs configured" description="Defaults will be seeded on next list call." />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((row) => <PairCard key={row.id} row={row} />)}
        </div>
      )}
    </div>
  );
}

function PairCard({ row }: { row: FxConfigRow }) {
  const [spread, setSpread] = React.useState(String(row.spreadBps));
  const [fee, setFee] = React.useState(String(row.platformFeeBps));
  const [minAmt, setMinAmt] = React.useState(String(row.minAmountMinor));
  const [maxAmt, setMaxAmt] = React.useState(row.maxAmountMinor === null ? "" : String(row.maxAmountMinor));
  const [busy, setBusy] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);

  // Re-sync local form state when the row data refreshes after a save.
  React.useEffect(() => {
    setSpread(String(row.spreadBps));
    setFee(String(row.platformFeeBps));
    setMinAmt(String(row.minAmountMinor));
    setMaxAmt(row.maxAmountMinor === null ? "" : String(row.maxAmountMinor));
  }, [row.spreadBps, row.platformFeeBps, row.minAmountMinor, row.maxAmountMinor]);

  async function save() {
    const s = Number(spread), f = Number(fee), mn = Number(minAmt);
    const mx = maxAmt === "" ? null : Number(maxAmt);
    if (Number.isNaN(s) || s < 0 || s > 10_000) { toast.error("Spread must be 0–10,000 bps"); return; }
    if (Number.isNaN(f) || f < 0 || f > 10_000) { toast.error("Platform fee must be 0–10,000 bps"); return; }
    if (Number.isNaN(mn) || mn < 0) { toast.error("Min amount must be ≥ 0"); return; }
    if (mx !== null && (Number.isNaN(mx) || mx < 0)) { toast.error("Max amount must be ≥ 0"); return; }

    setBusy(true);
    try {
      await apiFetch(`/api/admin/fx/${encodeURIComponent(row.pair)}`, {
        method: "PATCH",
        body: JSON.stringify({
          spreadBps: Math.round(s),
          platformFeeBps: Math.round(f),
          minAmountMinor: Math.round(mn),
          maxAmountMinor: mx === null ? null : Math.round(mx),
        }),
      });
      toast.success(`${row.pair} updated`);
      mutateApi("/api/admin/fx");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not update pair");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(next: boolean) {
    setToggling(true);
    try {
      await apiFetch(`/api/admin/fx/${encodeURIComponent(row.pair)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: next }),
      });
      toast.success(`${row.pair} ${next ? "enabled" : "disabled"}`);
      mutateApi("/api/admin/fx");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not toggle pair");
    } finally {
      setToggling(false);
    }
  }

  return (
    <Card className={!row.enabled ? "opacity-70" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4" /> {row.pair}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{row.fromCurrency} → {row.toCurrency}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-[10px]", row.enabled ? "text-success" : "text-muted-foreground")}>
              {row.enabled ? "Enabled" : "Disabled"}
            </Badge>
            <Switch checked={row.enabled} disabled={toggling} onCheckedChange={toggle} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <Field label="Spread (bps)" hint="100 bps = 1% off mid-market">
          <Input type="number" min="0" max="10000" value={spread} onChange={(e) => setSpread(e.target.value)} />
        </Field>
        <Field label="Platform fee (bps)" hint="Charged on source amount">
          <Input type="number" min="0" max="10000" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
        <Field label="Min amount (minor)" hint="Smallest conversion">
          <Input type="number" min="0" value={minAmt} onChange={(e) => setMinAmt(e.target.value)} />
        </Field>
        <Field label="Max amount (minor)" hint="Blank = no cap">
          <Input type="number" min="0" value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} placeholder="No cap" />
        </Field>
        <div className="col-span-2 mt-1 flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Power className="h-3 w-3" /> Toggle pair availability
          </div>
          <Button onClick={save} disabled={busy}>
            <Save className="mr-1 h-3.5 w-3.5" /> {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
