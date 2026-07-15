"use client";

import * as React from "react";
import { toast } from "sonner";
import { Clock, Search, Filter, Download, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useApi, apiPost } from "@/lib/turbopay/client";
import { formatNaira } from "@/lib/turbopay/money";
import { TX_TYPE_LABELS, type TransactionView, type TxType } from "@/lib/turbopay/types";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { TransactionItem, timeAgo } from "@/components/turbopay/parts/transaction-item";
import { TxIcon } from "@/components/turbopay/parts/tx-icon";
import { Amount } from "@/components/turbopay/parts/amount";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface TxResponse { items: TransactionView[]; total: number }

const FILTERS: { key: string; label: string; types?: TxType[] }[] = [
  { key: "ALL", label: "All" },
  { key: "FUNDING", label: "Funding", types: ["FUNDING"] },
  { key: "TRANSFER", label: "Transfers", types: ["TRANSFER_IN", "TRANSFER_OUT"] },
  { key: "AIRTIME", label: "Airtime", types: ["AIRTIME"] },
  { key: "DATA", label: "Data", types: ["DATA"] },
  { key: "BILLS", label: "Bills", types: ["BILL_ELECTRICITY", "BILL_UTILITY"] },
];

export function HistoryView() {
  const [filter, setFilter] = React.useState("ALL");
  const [q, setQ] = React.useState("");
  const [selected, setSelected] = React.useState<TransactionView | null>(null);
  const [exporting, setExporting] = React.useState(false);

  const filterCfg = FILTERS.find((f) => f.key === filter);
  const typeParam = filterCfg?.types?.join(",") ?? "";
  const query = `/api/transactions?limit=100${typeParam ? `&type=${typeParam}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const { data, isLoading } = useApi<TxResponse>(query);

  const items = data?.items ?? [];

  // Group by day
  const groups = React.useMemo(() => {
    const map = new Map<string, TransactionView[]>();
    for (const t of items) {
      const day = new Date(t.createdAt).toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "short", day: "numeric" });
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(t);
    }
    return Array.from(map.entries());
  }, [items]);

  // Export — POST /api/statements/generate with format="CSV" and the last 90
  // days as the period. The API returns a structured statement object; we
  // serialize its transactions array to CSV and trigger a download.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const toDate = new Date();
      const fromDate = new Date(toDate.getTime() - 90 * 24 * 60 * 60 * 1000);
      const res = await apiPost<{ requestId: string; statement: any }>("/api/statements/generate", {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        format: "CSV",
      });
      const txs = res?.statement?.transactions ?? [];
      const header = ["Reference", "Type", "Direction", "Amount (NGN)", "Fee (NGN)", "Status", "Description", "Counterparty", "Provider", "Date"];
      const rows = txs.map((t: any) => [
        t.reference ?? "",
        t.type ?? "",
        t.direction ?? "",
        (t.amountKobo / 100).toFixed(2),
        (t.feeKobo / 100).toFixed(2),
        t.status ?? "",
        (t.description ?? "").replace(/"/g, '""'),
        (t.counterpartyName ?? "").replace(/"/g, '""'),
        t.provider ?? "",
        t.createdAt ? new Date(t.createdAt).toISOString() : "",
      ]);
      const csv = [header, ...rows].map((r) => r.map((c: string) => `"${c}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `turbopay-statement-${fromDate.toISOString().slice(0, 10)}-to-${toDate.toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${txs.length} transaction${txs.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not export statement");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transaction History"
        description="Every credit, debit, and reversal — fully auditable."
        icon={<Clock className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}><Download className="mr-1.5 h-4 w-4" /> {exporting ? "Exporting…" : "Export"}</Button>}
      />

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by reference, name, description…" className="pl-9" />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
              <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    filter === f.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card><CardContent className="space-y-2 py-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </CardContent></Card>
      ) : items.length === 0 ? (
        <Card><CardContent><EmptyState icon={<Clock className="h-6 w-6" />} title="No transactions found" description="Try adjusting your filters or search." /></CardContent></Card>
      ) : (
        <div className="space-y-4">
          {groups.map(([day, txs]) => (
            <Card key={day}>
              <CardContent className="py-3">
                <div className="mb-1 flex items-center justify-between px-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day}</p>
                  <span className="text-xs text-muted-foreground">{txs.length} transaction{txs.length > 1 ? "s" : ""}</span>
                </div>
                <div className="divide-y">
                  {txs.map((tx) => <TransactionItem key={tx.id} tx={tx} onClick={setSelected} />)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TxDetailDialog tx={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function TxDetailDialog({ tx, onClose }: { tx: TransactionView | null; onClose: () => void }) {
  return (
    <Dialog open={!!tx} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transaction details</DialogTitle>
        </DialogHeader>
        {tx && (
          <div className="space-y-4">
            <div className="flex flex-col items-center py-2">
              <TxIcon type={tx.type} direction={tx.direction} className="h-14 w-14" />
              <p className="mt-3 text-sm text-muted-foreground">{TX_TYPE_LABELS[tx.type]}</p>
              <Amount kobo={tx.amountKobo} direction={tx.direction} className="mt-1 text-2xl font-bold" />
              <Badge variant={tx.status === "SUCCESS" ? "default" : "secondary"} className="mt-2">{tx.status}</Badge>
            </div>
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <DetailRow label="Reference" value={tx.reference} mono />
              <DetailRow label="Description" value={tx.description ?? "—"} />
              {tx.counterpartyName && <DetailRow label="Counterparty" value={tx.counterpartyName} />}
              {tx.counterpartyAccount && <DetailRow label="Account" value={tx.counterpartyAccount} mono />}
              {tx.counterpartyBank && <DetailRow label="Bank" value={tx.counterpartyBank} />}
              <DetailRow label="Provider" value={tx.provider ?? "turbopay"} />
              <DetailRow label="Fee" value={formatNaira(tx.feeKobo)} />
              <DetailRow label="Date" value={new Date(tx.createdAt).toLocaleString("en-NG")} />
              <DetailRow label="Status" value={tx.status} />
            </div>
            <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("text-right font-medium", mono && "font-mono text-xs")}>{value}</span>
    </div>
  );
}
