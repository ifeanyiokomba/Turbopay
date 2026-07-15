"use client";

import * as React from "react";
import { Ticket, Plus, Power } from "lucide-react";
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

interface VoucherRow {
  id: string;
  code: string;
  campaignName: string;
  type: string;
  valueKobo: number;
  valueBps: number;
  maxDiscountKobo: number | null;
  minSpendKobo: number;
  campaignBudgetKobo: number | null;
  totalUsed: number;
  totalDiscountKobo: number;
  usageLimit: number;
  perUserLimit: number;
  active: boolean;
  endDate: string | null;
  createdAt: string;
}

const VOUCHER_TYPES = ["FLAT_OFF", "PERCENT_OFF", "FEE_WAIVER", "DISCOUNT", "CASHBACK"] as const;

const TYPE_TONE: Record<string, string> = {
  FLAT_OFF: "bg-primary/15 text-primary",
  PERCENT_OFF: "bg-accent/15 text-accent-foreground",
  FEE_WAIVER: "bg-warning/15 text-warning-foreground",
  DISCOUNT: "bg-primary/15 text-primary",
  CASHBACK: "bg-success/15 text-success",
};

export function VouchersAdminView() {
  const { data, isLoading, error } = useApi<VoucherRow[]>("/api/admin/vouchers");
  const [showCreate, setShowCreate] = React.useState(false);

  async function toggleActive(v: VoucherRow) {
    // The admin list route is GET-only; the lib has vouchers.update(id, { active }).
    // There is no per-id PATCH route yet, so we POST back to the collection with
    // a re-create payload only when re-activating (deactivation requires a per-id
    // route). For now we surface a friendly notice on disable attempts.
    if (v.active) {
      toast.error("Deactivation requires a per-id PATCH route (not yet implemented). Use the API directly.");
      return;
    }
    toast.error("Re-activation requires editing the voucher via API.");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vouchers"
        description="Create and monitor promotional voucher campaigns. Redemption counts and budgets are tracked live."
        icon={<Ticket className="h-5 w-5" />}
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-1 h-4 w-4" /> New voucher
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
          ) : isLoading || !data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : data.length === 0 ? (
            <EmptyState icon={<Ticket className="h-6 w-6" />} title="No vouchers yet" description="Create your first voucher campaign." />
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Code</TableHead><TableHead>Campaign</TableHead><TableHead>Type</TableHead>
                  <TableHead className="text-right">Value</TableHead><TableHead className="text-right">Used</TableHead>
                  <TableHead className="text-right">Budget</TableHead><TableHead>Expiry</TableHead><TableHead className="text-right">Active</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {data.map((v) => {
                    const budgetUsed = v.campaignBudgetKobo ? (v.totalDiscountKobo / v.campaignBudgetKobo) * 100 : 0;
                    return (
                      <TableRow key={v.id} className={!v.active ? "opacity-60" : ""}>
                        <TableCell><code className="font-mono text-xs font-semibold">{v.code}</code></TableCell>
                        <TableCell className="max-w-[200px] truncate">{v.campaignName}</TableCell>
                        <TableCell><Badge className={cn("text-[10px]", TYPE_TONE[v.type] ?? "")}>{v.type}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{v.type === "PERCENT_OFF" ? `${(v.valueBps / 100).toFixed(2)}%` : `₦${(v.valueKobo / 100).toLocaleString()}`}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{v.totalUsed}{v.usageLimit > 0 && <span className="text-muted-foreground"> / {v.usageLimit}</span>}</TableCell>
                        <TableCell className="text-right text-xs">{v.campaignBudgetKobo ? <span className={cn(budgetUsed >= 100 ? "text-destructive" : budgetUsed >= 80 ? "text-warning-foreground" : "text-muted-foreground")}>{budgetUsed.toFixed(0)}%</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{v.endDate ? new Date(v.endDate).toLocaleDateString("en-NG") : "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Power className={cn("h-3.5 w-3.5", v.active ? "text-success" : "text-muted-foreground")} />
                            <Switch checked={v.active} onCheckedChange={() => toggleActive(v)} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <CreateVoucherDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}

function CreateVoucherDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [code, setCode] = React.useState("");
  const [campaignName, setCampaignName] = React.useState("");
  const [type, setType] = React.useState<typeof VOUCHER_TYPES[number]>("FLAT_OFF");
  const [valueKobo, setValueKobo] = React.useState("0");
  const [valueBps, setValueBps] = React.useState("0");
  const [minSpendKobo, setMinSpend] = React.useState("0");
  const [maxDiscountKobo, setMaxDiscount] = React.useState("");
  const [campaignBudgetKobo, setBudget] = React.useState("");
  const [usageLimit, setUsageLimit] = React.useState("0");
  const [perUserLimit, setPerUserLimit] = React.useState("1");
  const [endDate, setEndDate] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setCode(""); setCampaignName(""); setType("FLAT_OFF"); setValueKobo("0"); setValueBps("0");
      setMinSpend("0"); setMaxDiscount(""); setBudget(""); setUsageLimit("0"); setPerUserLimit("1"); setEndDate("");
    }
  }, [open]);

  async function submit() {
    if (code.trim().length < 3) { toast.error("Code must be at least 3 chars"); return; }
    if (campaignName.trim().length < 2) { toast.error("Campaign name required"); return; }
    const payload: Record<string, unknown> = {
      code: code.trim(), campaignName: campaignName.trim(), type,
      valueKobo: type === "FLAT_OFF" || type === "FEE_WAIVER" ? Number(valueKobo) || 0 : 0,
      valueBps: type === "PERCENT_OFF" ? Number(valueBps) || 0 : 0,
      minSpendKobo: Number(minSpendKobo) || 0,
      usageLimit: Number(usageLimit) || 0,
      perUserLimit: Number(perUserLimit) || 1,
    };
    if (maxDiscountKobo) payload.maxDiscountKobo = Number(maxDiscountKobo);
    if (campaignBudgetKobo) payload.campaignBudgetKobo = Number(campaignBudgetKobo);
    if (endDate) payload.endDate = new Date(endDate).toISOString();

    setBusy(true);
    try {
      await apiFetch("/api/admin/vouchers", { method: "POST", body: JSON.stringify(payload) });
      toast.success("Voucher created");
      mutateApi("/api/admin/vouchers");
      onOpenChange(false);
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not create voucher");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New voucher campaign</DialogTitle>
          <DialogDescription>Codes are uppercased on save. PERCENT values are basis points (100 = 1%).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SUMMER25" /></Field>
          <Field label="Campaign name"><Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Summer Promo 2026" /></Field>
          <Field label="Type"><Select value={type} onValueChange={(v) => setType(v as typeof VOUCHER_TYPES[number])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{VOUCHER_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></Field>
          {type === "PERCENT_OFF" ? (
            <Field label="Discount (bps — 100 = 1%)"><Input type="number" min="0" value={valueBps} onChange={(e) => setValueBps(e.target.value)} /></Field>
          ) : (
            <Field label="Discount value (kobo)"><Input type="number" min="0" value={valueKobo} onChange={(e) => setValueKobo(e.target.value)} /></Field>
          )}
          <Field label="Min spend (kobo)"><Input type="number" min="0" value={minSpendKobo} onChange={(e) => setMinSpend(e.target.value)} /></Field>
          <Field label="Max discount (kobo)"><Input type="number" min="0" value={maxDiscountKobo} onChange={(e) => setMaxDiscount(e.target.value)} placeholder="No cap" /></Field>
          <Field label="Campaign budget (kobo)"><Input type="number" min="0" value={campaignBudgetKobo} onChange={(e) => setBudget(e.target.value)} placeholder="No budget" /></Field>
          <Field label="Expiry date"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          <Field label="Total usage limit (0 = unlimited)"><Input type="number" min="0" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} /></Field>
          <Field label="Per-user limit"><Input type="number" min="1" value={perUserLimit} onChange={(e) => setPerUserLimit(e.target.value)} /></Field>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create voucher"}</Button>
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
