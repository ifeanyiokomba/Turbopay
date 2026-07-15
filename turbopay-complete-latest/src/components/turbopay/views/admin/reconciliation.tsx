"use client";

import * as React from "react";
import { Scale, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
import { formatNaira } from "@/lib/turbopay/money";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";

// ---------- types ----------
interface ReconRun {
  id: string;
  type: string;
  status: string;
  walletsChecked: number;
  driftDetected: number;
  driftCorrected: number;
  metadata: unknown;
  startedAt: string;
  completedAt: string | null;
}
interface ReconReport {
  run: ReconRun | null;
  message?: string;
}
interface FloatData {
  totals: {
    totalCachedKobo: number;
    totalLedgerKobo: number;
    driftKobo: number;
    reconciled: boolean;
    averageBalanceKobo: number;
    maxBalanceKobo: number;
  };
  wallets: { total: number; active: number; frozen: number };
  topWallets: unknown[];
}

const STATUS_TONE: Record<string, string> = {
  COMPLETED: "bg-success/15 text-success",
  PROCESSING: "bg-warning/15 text-warning-foreground",
  FAILED: "bg-destructive/15 text-destructive",
};

// ============================================================
// Main
// ============================================================
export function Reconciliation() {
  const reportPath = "/api/admin/finance/reconciliation/report";
  const floatPath = "/api/admin/finance/float";
  const historyPath = "/api/admin/reconciliation";

  const { data: report, isLoading: reportLoading } = useApi<ReconReport>(reportPath);
  const { data: float, isLoading: floatLoading } = useApi<FloatData>(floatPath);
  const { data: history, isLoading: historyLoading } = useApi<ReconRun[]>(historyPath);

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);

  async function runNow() {
    setRunning(true);
    try {
      const result = await apiFetch<{ runId: string; walletsChecked: number; driftDetected: number; driftCorrected: number }>(
        "/api/admin/finance/reconciliation/run",
        { method: "POST" }
      );
      toast.success(`Reconciliation complete — ${result.walletsChecked} wallets checked, ${result.driftCorrected} drift corrected`);
      mutateApi(reportPath);
      mutateApi(historyPath);
      mutateApi(floatPath);
      setConfirmOpen(false);
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Reconciliation failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reconciliation"
        description="Compare wallet cache against the ledger source of truth."
        icon={<Scale className="h-5 w-5" />}
        actions={
          <Button onClick={() => setConfirmOpen(true)}>
            <RefreshCw className="mr-1 h-4 w-4" /> Run reconciliation now
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Last run summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Last run</CardTitle>
          </CardHeader>
          <CardContent>
            {reportLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !report?.run ? (
              <EmptyState icon={<Scale className="h-6 w-6" />} title="No runs yet" description={report?.message ?? "Run reconciliation to see results."} />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {report.run.driftDetected > 0 ? (
                      <AlertTriangle className="h-5 w-5 text-warning-foreground" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    )}
                    <span className="font-medium">{report.run.type}</span>
                  </div>
                  <Badge variant="outline" className={cn(STATUS_TONE[report.run.status] ?? "")}>{report.run.status}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Metric label="Wallets" value={report.run.walletsChecked} />
                  <Metric label="Drift" value={report.run.driftDetected} tone={report.run.driftDetected > 0 ? "danger" : "success"} />
                  <Metric label="Corrected" value={report.run.driftCorrected} tone={report.run.driftCorrected > 0 ? "warning" : "default"} />
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between"><span>Started</span><span>{new Date(report.run.startedAt).toLocaleString("en-NG")}</span></div>
                  {report.run.completedAt && (
                    <div className="flex justify-between"><span>Completed</span><span>{new Date(report.run.completedAt).toLocaleString("en-NG")}</span></div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Float summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Float summary</CardTitle>
          </CardHeader>
          <CardContent>
            {floatLoading || !float ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Total float (cached)</p>
                  <p className="text-2xl font-semibold tabular-nums">{formatNaira(float.totals.totalCachedKobo)}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Row label="Ledger total" value={formatNaira(float.totals.totalLedgerKobo)} />
                  <Row label="Drift" value={
                    <span className={float.totals.driftKobo === 0 ? "text-success" : "text-destructive"}>
                      {float.totals.driftKobo === 0 ? "✓ Reconciled" : formatNaira(float.totals.driftKobo)}
                    </span>
                  } />
                  <Row label="Average balance" value={formatNaira(float.totals.averageBalanceKobo)} />
                  <Row label="Max balance" value={formatNaira(float.totals.maxBalanceKobo)} />
                  <Row label="Active wallets" value={String(float.wallets.active)} />
                  <Row label="Frozen wallets" value={String(float.wallets.frozen)} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Run history (last 10)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {historyLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !history || history.length === 0 ? (
            <EmptyState title="No runs" />
          ) : (
            <ScrollArea className="max-h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Wallets</TableHead>
                    <TableHead className="text-right">Drift</TableHead>
                    <TableHead className="text-right">Corrected</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.slice(0, 10).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}</TableCell>
                      <TableCell className="text-xs">{r.type}</TableCell>
                      <TableCell><Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[r.status] ?? "")}>{r.status}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{r.walletsChecked}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.driftDetected}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.driftCorrected}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(r.startedAt).toLocaleString("en-NG")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run reconciliation now?</DialogTitle>
            <DialogDescription>
              This will re-check every wallet cache against the ledger and correct any drift.
              The run executes synchronously and may take a few seconds on large datasets.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={running}>Cancel</Button></DialogClose>
            <Button onClick={runNow} disabled={running}>
              {running ? (<><RefreshCw className="mr-1 h-4 w-4 animate-spin" /> Running…</>) : "Confirm run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: React.ReactNode; tone?: "default" | "success" | "danger" | "warning" }) {
  const toneCls = {
    default: "text-foreground",
    success: "text-success",
    danger: "text-destructive",
    warning: "text-warning-foreground",
  }[tone];
  return (
    <div className="rounded-lg border p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", toneCls)}>{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
