"use client";

import * as React from "react";
import { Percent, Plus, Power } from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";

interface FeeConfigRow {
  id: string;
  product: string;
  category: string;
  type: string; // PERCENT | FLAT | TIERED
  value: number;
  markupBps: number;
  minFeeMinor: number;
  maxFeeMinor: number | null;
  currency: string;
  active: boolean;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

const PRODUCTS = ["turbopay", "billswift"] as const;
const CATEGORIES = [
  "TRANSFER", "AIRTIME", "DATA", "BILL_ELECTRICITY", "BILL_UTILITY",
  "WALLET_FUNDING", "WITHDRAWAL", "INTL_TRANSFER", "INTL_RECEIVING",
  "REMITA", "QUICKTELLER", "VIRTUAL_CARD", "SAVINGS", "INVESTMENT",
] as const;

const TYPE_TONE: Record<string, string> = {
  PERCENT: "bg-primary/15 text-primary",
  FLAT: "bg-accent/15 text-accent-foreground",
  TIERED: "bg-warning/15 text-warning-foreground",
};

export function FeeConfigurationView() {
  const { data, isLoading, error } = useApi<FeeConfigRow[]>("/api/admin/fees");
  const [showCreate, setShowCreate] = React.useState(false);

  async function toggleActive(fee: FeeConfigRow) {
    // The POST endpoint upserts; on update it always re-activates the row.
    // To disable, we POST the same values back with `active: false` (the
    // route schema doesn't currently include `active`, so we DELETE instead
    // via the per-id route which sets active=false).
    try {
      if (fee.active) {
        await apiFetch(`/api/admin/fees/${fee.id}`, { method: "DELETE" });
      } else {
        // Re-activate by re-POSTing the existing values.
        await apiFetch("/api/admin/fees", {
          method: "POST",
          body: JSON.stringify({
            product: fee.product,
            category: fee.category,
            type: fee.type,
            value: fee.value,
            markupBps: fee.markupBps,
            minFeeMinor: fee.minFeeMinor,
            maxFeeMinor: fee.maxFeeMinor,
          }),
        });
      }
      toast.success(fee.active ? "Fee disabled" : "Fee enabled");
      mutateApi("/api/admin/fees");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not update fee");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fee Configuration"
        description="Per-product fee schedules (flat, percent, or tiered) applied at checkout."
        icon={<Percent className="h-5 w-5" />}
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-1 h-4 w-4" /> New fee
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
          ) : isLoading || !data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : data.length === 0 ? (
            <EmptyState icon={<Percent className="h-6 w-6" />} title="No fee configs" description="Add a fee to start charging for transactions." />
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Market %</TableHead>
                    <TableHead className="text-right">Min / Max</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((f) => (
                    <TableRow key={f.id} className={!f.active ? "opacity-60" : ""}>
                      <TableCell className="font-medium">{f.product}</TableCell>
                      <TableCell>{f.category.replace(/_/g, " ")}</TableCell>
                      <TableCell>
                        <Badge className={cn("text-[10px]", TYPE_TONE[f.type] ?? "")}>{f.type}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.type === "PERCENT" ? `${(f.value / 100).toFixed(2)}%` : `₦${(f.value / 100).toLocaleString()}`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {f.markupBps > 0 ? `${(f.markupBps / 100).toFixed(2)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        ₦{(f.minFeeMinor / 100).toLocaleString()}
                        {f.maxFeeMinor !== null ? ` / ₦${(f.maxFeeMinor / 100).toLocaleString()}` : " / —"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Power className={cn("h-3.5 w-3.5", f.active ? "text-success" : "text-muted-foreground")} />
                          <Switch checked={f.active} onCheckedChange={() => toggleActive(f)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <CreateFeeDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}

function CreateFeeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [product, setProduct] = React.useState<string>(PRODUCTS[0]);
  const [category, setCategory] = React.useState<string>(CATEGORIES[0]);
  const [type, setType] = React.useState<"PERCENT" | "FLAT">("PERCENT");
  const [value, setValue] = React.useState<string>("0");
  const [markupBps, setMarkupBps] = React.useState<string>("0");
  const [minFeeMinor, setMinFee] = React.useState<string>("0");
  const [maxFeeMinor, setMaxFee] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setProduct(PRODUCTS[0]); setCategory(CATEGORIES[0]); setType("PERCENT");
      setValue("0"); setMarkupBps("0"); setMinFee("0"); setMaxFee("");
    }
  }, [open]);

  async function submit() {
    const valueNum = Number(value);
    const minNum = Number(minFeeMinor || "0");
    const maxNum = maxFeeMinor === "" ? null : Number(maxFeeMinor);
    if (Number.isNaN(valueNum) || valueNum < 0) { toast.error("Value must be a non-negative number"); return; }
    if (Number.isNaN(minNum) || minNum < 0) { toast.error("Min fee must be non-negative"); return; }
    if (maxNum !== null && (Number.isNaN(maxNum) || maxNum < 0)) { toast.error("Max fee must be non-negative"); return; }

    setBusy(true);
    try {
      // PERCENT value is in bps (100 = 1%); FLAT value is in kobo.
      await apiFetch("/api/admin/fees", {
        method: "POST",
        body: JSON.stringify({ product, category, type, value: valueNum, markupBps: Number(markupBps || "0"), minFeeMinor: minNum, maxFeeMinor: maxNum }),
      });
      toast.success("Fee saved");
      mutateApi("/api/admin/fees");
      onOpenChange(false);
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not save fee");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New fee configuration</DialogTitle>
          <DialogDescription>
            Upserts by (product, category). PERCENT values are basis points (100 = 1%); FLAT values are in kobo.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Product"><Select value={product} onValueChange={setProduct}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRODUCTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Category"><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Type"><Select value={type} onValueChange={(v) => setType(v as "PERCENT" | "FLAT")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PERCENT">Percent (bps)</SelectItem><SelectItem value="FLAT">Flat (kobo)</SelectItem></SelectContent></Select></Field>
          <Field label="Value"><Input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          <Field label="Market % (bps, 100 = 1%)"><Input type="number" min="0" max="10000" value={markupBps} onChange={(e) => setMarkupBps(e.target.value)} placeholder="0" /></Field>
          <Field label="Min fee (kobo)"><Input type="number" min="0" value={minFeeMinor} onChange={(e) => setMinFee(e.target.value)} /></Field>
          <Field label="Max fee (kobo, blank = none)"><Input type="number" min="0" value={maxFeeMinor} onChange={(e) => setMaxFee(e.target.value)} /></Field>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save fee"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
