"use client";

import * as React from "react";
import {
  ArrowLeftRight, Search, Eye, Download, Undo2, Coins,
} from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
import { formatNaira } from "@/lib/turbopay/money";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";

// ---------- types ----------
interface TxRow {
  id: string;
  reference: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  type: string;
  direction: string;
  amountKobo: number;
  feeKobo: number;
  status: string;
  counterpartyName: string | null;
  counterpartyAccount: string | null;
  counterpartyBank: string | null;
  description: string | null;
  provider: string | null;
  providerRef: string | null;
  reversalOfId: string | null;
  createdAt: string;
}
interface TxList {
  items: TxRow[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  stats: {
    totalVolumeKobo: number;
    totalFeesKobo: number;
    count: number;
    byType: { type: string; volumeKobo: number; count: number }[];
    byProvider: { provider: string; volumeKobo: number; count: number }[];
  };
}

interface TxDetail {
  transaction: {
    id: string; reference: string; type: string; direction: string;
    amountKobo: number; feeKobo: number; status: string;
    counterpartyName: string | null; counterpartyAccount: string | null;
    counterpartyBank: string | null; description: string | null;
    provider: string | null; providerRef: string | null;
    reversalOfId: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string; updatedAt: string;
  };
  user: {
    id: string; fullName: string; emailMasked: string; phoneMasked: string;
    kycTier: number; kycStatus: string; status: string;
  } | null;
  ledgerEntries: {
    id: string; walletId: string; entryType: string; amountKobo: number;
    currency: string; refType: string | null; refId: string | null;
    pairId: string | null; balanceAfterKobo: number;
    description: string | null; immutable: boolean; createdAt: string;
  }[];
  reversalOf: { id: string; reference: string; type: string; amountKobo: number; status: string; createdAt: string } | null;
  reversals: { id: string; reference: string; amountKobo: number; status: string; createdAt: string }[];
}

// ---------- type chips ----------
const TYPE_CHIPS: { label: string; value: string; types: string }[] = [
  { label: "All", value: "ALL", types: "ALL" },
  { label: "Funding", value: "FUNDING", types: "FUNDING,FUND" },
  { label: "Transfer", value: "TRANSFER", types: "TRANSFER" },
  { label: "Airtime", value: "AIRTIME", types: "AIRTIME" },
  { label: "Data", value: "DATA", types: "DATA" },
  { label: "Bills", value: "BILLS", types: "BILL,BILLS,ELECTRICITY,UTILITY" },
  { label: "Reversals", value: "REVERSAL", types: "REVERSAL" },
];

const STATUS_TONE: Record<string, string> = {
  SUCCESS: "bg-success/15 text-success",
  PENDING: "bg-warning/15 text-warning-foreground",
  FAILED: "bg-destructive/15 text-destructive",
  REVERSED: "bg-muted text-muted-foreground",
};

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ============================================================
// Main
// ============================================================
export function TransactionManagement() {
  const [q, setQ] = React.useState("");
  const [typeChip, setTypeChip] = React.useState("ALL");
  const [status, setStatus] = React.useState("");
  const [direction, setDirection] = React.useState("");
  const [provider, setProvider] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [amountMin, setAmountMin] = React.useState("");
  const [amountMax, setAmountMax] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const debouncedQ = useDebounced(q);
  const params = new URLSearchParams();
  if (debouncedQ) params.set("q", debouncedQ);
  const chip = TYPE_CHIPS.find((c) => c.value === typeChip);
  if (chip && chip.value !== "ALL") params.set("type", chip.types);
  if (status) params.set("status", status);
  if (direction) params.set("direction", direction);
  if (provider) params.set("provider", provider);
  if (from) params.set("from", new Date(from).toISOString());
  if (to) params.set("to", new Date(`${to}T23:59:59`).toISOString());
  if (amountMin) params.set("amountMin", String(Math.round(parseFloat(amountMin) * 100)));
  if (amountMax) params.set("amountMax", String(Math.round(parseFloat(amountMax) * 100)));
  params.set("limit", "50");
  const path = `/api/admin/transactions?${params.toString()}`;

  const { data, isLoading, error } = useApi<TxList>(path);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transaction Management"
        description="Search and review every transaction across the platform."
        icon={<ArrowLeftRight className="h-5 w-5" />}
      />

      {/* Type chips */}
      <div className="flex flex-wrap gap-2">
        {TYPE_CHIPS.map((c) => (
          <Button
            key={c.value}
            size="sm"
            variant={typeChip === c.value ? "default" : "outline"}
            onClick={() => setTypeChip(c.value)}
          >
            {c.label}
          </Button>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="q" className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="q" placeholder="Reference, description, counterparty…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status || "ALL"} onValueChange={(v) => setStatus(v === "ALL" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="SUCCESS">Success</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="REVERSED">Reversed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Direction</Label>
              <Select value={direction || "ALL"} onValueChange={(v) => setDirection(v === "ALL" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="CREDIT">Credit</SelectItem>
                  <SelectItem value="DEBIT">Debit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Provider</Label>
              <Input placeholder="monnify, baxi…" value={provider} onChange={(e) => setProvider(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Amount min (₦)</Label>
              <Input type="number" inputMode="decimal" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Amount max (₦)</Label>
              <Input type="number" inputMode="decimal" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatBox label="Total volume" value={formatNaira(data.stats.totalVolumeKobo)} />
          <StatBox label="Total fees" value={formatNaira(data.stats.totalFeesKobo)} />
          <StatBox label="Transactions" value={data.stats.count} />
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
          ) : isLoading || !data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : data.items.length === 0 ? (
            <EmptyState icon={<Coins className="h-6 w-6" />} title="No transactions" description="Adjust filters to see results." />
          ) : (
            <>
              <ScrollArea className="max-h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Fee</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                        <TableCell className="max-w-[160px] truncate">{t.userName ?? "—"}</TableCell>
                        <TableCell className="text-xs">{t.type}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-[10px]", t.direction === "CREDIT" ? "text-success" : "text-warning-foreground")}>
                            {t.direction}
                          </Badge>
                        </TableCell>
                        <TableCell className={cn("text-right tabular-nums", t.direction === "CREDIT" ? "text-success" : "text-warning-foreground")}>
                          {t.direction === "CREDIT" ? "+" : "-"}{formatNaira(t.amountKobo)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{formatNaira(t.feeKobo)}</TableCell>
                        <TableCell><Badge variant="secondary" className={cn("text-[10px]", STATUS_TONE[t.status] ?? "")}>{t.status}</Badge></TableCell>
                        <TableCell className="text-xs">{t.provider ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString("en-NG")}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setSelectedId(t.id)}>
                            <Eye className="mr-1 h-3.5 w-3.5" /> View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
              <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground">
                <span>{data.total} transactions</span>
                <span>Page {data.page}{data.hasMore ? " (more available)" : ""}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <TxDetailSheet txId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// ============================================================
// Detail Sheet
// ============================================================
function TxDetailSheet({ txId, onClose }: { txId: string | null; onClose: () => void }) {
  const path = txId ? `/api/admin/transactions/${txId}` : null;
  const { data, isLoading, error, refetch } = useApi<TxDetail>(path);
  const [reverseOpen, setReverseOpen] = React.useState(false);

  return (
    <Sheet open={!!txId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{data?.transaction.reference ?? "Transaction"}</SheetTitle>
          <SheetDescription>
            {data?.transaction.type} · {data?.transaction.direction} · {data?.transaction.status}
          </SheetDescription>
        </SheetHeader>

        {isLoading || !data ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-destructive">{(error as Error).message}</div>
        ) : (
          <div className="space-y-4 px-4 pb-6">
            <Card>
              <CardContent className="p-4 space-y-2 text-sm">
                <Row label="Amount" value={<span className="tabular-nums">{formatNaira(data.transaction.amountKobo)}</span>} />
                <Row label="Fee" value={<span className="tabular-nums">{formatNaira(data.transaction.feeKobo)}</span>} />
                <Row label="Total" value={<span className="tabular-nums font-medium">{formatNaira(data.transaction.amountKobo + data.transaction.feeKobo)}</span>} />
                <Row label="Status" value={<Badge variant="secondary" className={STATUS_TONE[data.transaction.status] ?? ""}>{data.transaction.status}</Badge>} />
                <Row label="Provider" value={`${data.transaction.provider ?? "—"}${data.transaction.providerRef ? ` · ${data.transaction.providerRef}` : ""}`} />
                <Row label="Description" value={data.transaction.description ?? "—"} />
                <Row label="Counterparty" value={data.transaction.counterpartyName ?? "—"} />
                {data.transaction.counterpartyAccount && <Row label="Account" value={`${data.transaction.counterpartyAccount} ${data.transaction.counterpartyBank ?? ""}`} />}
                <Row label="Created" value={new Date(data.transaction.createdAt).toLocaleString("en-NG")} />
                <Row label="Updated" value={new Date(data.transaction.updatedAt).toLocaleString("en-NG")} />
                {data.user && (
                  <Row label="Customer" value={`${data.user.fullName} · ${data.user.emailMasked}`} />
                )}
                {data.reversalOf && (
                  <Row label="Reversal of" value={<span className="font-mono text-xs">{data.reversalOf.reference}</span>} />
                )}
                {data.reversals.length > 0 && (
                  <Row label="Reversed by" value={<span className="font-mono text-xs">{data.reversals.map((r) => r.reference).join(", ")}</span>} />
                )}
              </CardContent>
            </Card>

            <div>
              <p className="mb-2 text-sm font-medium">Ledger entries ({data.ledgerEntries.length})</p>
              <Card>
                <CardContent className="p-0">
                  <ScrollArea className="max-h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Balance after</TableHead>
                          <TableHead>Description</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.ledgerEntries.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell>
                              <Badge variant="outline" className={cn("text-[10px]", e.entryType === "CREDIT" ? "text-success" : "text-warning-foreground")}>
                                {e.entryType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatNaira(e.amountKobo)}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{formatNaira(e.balanceAfterKobo)}</TableCell>
                            <TableCell className="max-w-[200px] truncate text-xs">{e.description ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => downloadReceipt(data.transaction.id, data.transaction.reference)}>
                <Download className="mr-1 h-4 w-4" /> Download receipt
              </Button>
              <Button
                variant="outline"
                disabled={data.transaction.type === "REVERSAL" || data.transaction.status === "REVERSED" || data.transaction.status === "FAILED"}
                onClick={() => setReverseOpen(true)}
              >
                <Undo2 className="mr-1 h-4 w-4" /> Reverse transaction
              </Button>
            </div>

            <ReverseDialog
              open={reverseOpen}
              onOpenChange={setReverseOpen}
              txId={data.transaction.id}
              reference={data.transaction.reference}
              onDone={() => { setReverseOpen(false); refetch(); mutateApi("/api/admin/transactions"); }}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReverseDialog({ open, onOpenChange, txId, reference, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; txId: string; reference: string; onDone: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/transactions/${txId}/reverse`, { method: "POST", body: JSON.stringify({ reason }) });
      toast.success("Transaction reversed");
      setReason("");
      onDone();
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Reversal failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setReason(""); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse transaction</DialogTitle>
          <DialogDescription>
            This posts an opposing ledger leg for every original entry and creates a reversal record.
            Reference: <span className="font-mono text-xs">{reference}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rev-reason">Reason</Label>
          <Textarea id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Customer dispute — duplicate funding" />
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button variant="destructive" onClick={submit} disabled={busy || !reason.trim()}>
            {busy ? "Reversing…" : "Confirm reversal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function downloadReceipt(txId: string, reference: string) {
  try {
    const receipt = await apiFetch<{ receiptId: string; reference: string }>(`/api/admin/transactions/${txId}/receipt`);
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt-${reference}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Receipt downloaded");
  } catch (e: any) {
    if (e?.status === 401) return; // global auth-expired handler takes over
    toast.error(e.message ?? "Failed to download receipt");
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
