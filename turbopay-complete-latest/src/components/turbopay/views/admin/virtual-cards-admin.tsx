"use client";

import * as React from "react";
import {
  CreditCard, Snowflake, Flame, Ban, RefreshCw, ChevronLeft, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
import { formatNaira } from "@/lib/turbopay/money";
import { PageHeader, EmptyState, StatCard } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";

// ---------- types ----------
interface CardUser {
  id: string;
  fullName: string;
  email: string;
}
interface CardView {
  id: string;
  userId: string;
  last4: string | null;
  brand: string | null;
  type: string;
  status: string;
  balanceKobo: number;
  currency: string;
  spendingLimitKobo: number | null;
  cardholderName: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
  user: CardUser;
}
interface CardList {
  items: CardView[];
  total: number;
  page: number;
  limit: number;
}

type AdminAction = "freeze" | "unfreeze" | "terminate";

// ---------- status helpers ----------
const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-success/15 text-success border-success/30",
  FROZEN: "bg-warning/15 text-warning-foreground border-warning/30",
  TERMINATED: "bg-destructive/15 text-destructive border-destructive/30",
  PENDING: "bg-muted text-muted-foreground border-border",
};

const PAGE_SIZE = 10;

// ============================================================
// Main component
// ============================================================
export function VirtualCardsAdmin() {
  const [statusFilter, setStatusFilter] = React.useState<string>("ALL");
  const [page, setPage] = React.useState<number>(1);
  const [terminateTarget, setTerminateTarget] = React.useState<CardView | null>(null);

  // Reset to page 1 whenever the status filter changes.
  React.useEffect(() => { setPage(1); }, [statusFilter]);

  // Main paginated table fetch.
  const params = new URLSearchParams();
  if (statusFilter !== "ALL") params.set("status", statusFilter);
  params.set("page", String(page));
  params.set("limit", String(PAGE_SIZE));
  const mainPath = `/api/admin/virtual-cards?${params.toString()}`;
  const { data, isLoading, error } = useApi<CardList>(mainPath);

  // Count fetches — independent of the main view, used for the summary strip.
  // Each just reads the `total` field from a status-filtered response.
  const { data: activeResp } = useApi<CardList>("/api/admin/virtual-cards?status=ACTIVE&page=1&limit=1");
  const { data: frozenResp } = useApi<CardList>("/api/admin/virtual-cards?status=FROZEN&page=1&limit=1");
  const { data: terminatedResp } = useApi<CardList>("/api/admin/virtual-cards?status=TERMINATED&page=1&limit=1");

  const activeCount = activeResp?.total ?? 0;
  const frozenCount = frozenResp?.total ?? 0;
  const terminatedCount = terminatedResp?.total ?? 0;
  const totalCount = activeCount + frozenCount + terminatedCount;

  // Invalidate every related cache key after a status-changing action so the
  // table, the summary counts, and any other open admin views stay in sync.
  const invalidateAll = React.useCallback(() => {
    mutateApi(mainPath);
    mutateApi("/api/admin/virtual-cards?status=ACTIVE&page=1&limit=1");
    mutateApi("/api/admin/virtual-cards?status=FROZEN&page=1&limit=1");
    mutateApi("/api/admin/virtual-cards?status=TERMINATED&page=1&limit=1");
    // Also invalidate the unfiltered variant in case other views use it.
    mutateApi("/api/admin/virtual-cards?page=1&limit=1");
  }, [mainPath]);

  async function runAction(card: CardView, action: AdminAction, label: string) {
    try {
      await apiFetch(`/api/admin/virtual-cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      toast.success(`${label}: ${card.brand ?? "Card"} •••• ${card.last4 ?? "----"}`);
      invalidateAll();
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Action failed");
    }
  }

  // ---- pagination math ----
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? PAGE_SIZE;
  const currentPage = data?.page ?? page;
  const showingFrom = total === 0 ? 0 : (currentPage - 1) * limit + 1;
  const showingTo = Math.min(currentPage * limit, total);
  const hasPrev = currentPage > 1;
  const hasNext = currentPage * limit < total;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Virtual Card Management"
        description="Review and administer every virtual card across all customers."
        icon={<CreditCard className="h-5 w-5" />}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => invalidateAll()}
            aria-label="Refresh"
          >
            <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
          </Button>
        }
      />

      {/* Summary strip — Total / Active / Frozen / Terminated */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total Cards"
          value={totalCount.toLocaleString("en-NG")}
          icon={<CreditCard className="h-4 w-4" />}
          hint="Across all customers"
        />
        <StatCard
          label="Active"
          value={activeCount.toLocaleString("en-NG")}
          icon={<CreditCard className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Frozen"
          value={frozenCount.toLocaleString("en-NG")}
          icon={<Snowflake className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Terminated"
          value={terminatedCount.toLocaleString("en-NG")}
          icon={<Ban className="h-4 w-4" />}
          tone="danger"
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-1.5 sm:w-56">
              <Label className="text-xs">Status filter</Label>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="FROZEN">Frozen</SelectItem>
                  <SelectItem value="TERMINATED">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              {total.toLocaleString("en-NG")} card{total === 1 ? "" : "s"}
              {statusFilter !== "ALL" && ` · ${statusFilter.toLowerCase()}`}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
          ) : isLoading || !data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<CreditCard className="h-6 w-6" />}
              title="No cards found"
              description="No virtual cards match the current filter."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cardholder</TableHead>
                      <TableHead>Card</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {c.cardholderName || c.user.fullName || "—"}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {c.user.email}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-10 items-center justify-center rounded bg-gradient-to-br from-primary/15 to-accent/15 text-primary">
                              <CreditCard className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{c.brand ?? "VISA"}</p>
                              <p className="font-mono text-xs text-muted-foreground">
                                •••• {c.last4 ?? "----"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn("text-[10px]", STATUS_TONE[c.status] ?? "")}
                          >
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div>
                            <p className="font-medium">{formatNaira(c.balanceKobo)}</p>
                            {c.spendingLimitKobo != null && (
                              <p className="text-[11px] text-muted-foreground">
                                Limit {formatNaira(c.spendingLimitKobo)}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px]">
                            {c.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(c.createdAt).toLocaleDateString("en-NG", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {c.status === "ACTIVE" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => runAction(c, "freeze", "Card frozen")}
                              >
                                <Snowflake className="mr-1 h-3.5 w-3.5" /> Freeze
                              </Button>
                            )}
                            {c.status === "FROZEN" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => runAction(c, "unfreeze", "Card unfrozen")}
                              >
                                <Flame className="mr-1 h-3.5 w-3.5" /> Unfreeze
                              </Button>
                            )}
                            {c.status !== "TERMINATED" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setTerminateTarget(c)}
                              >
                                <Ban className="mr-1 h-3.5 w-3.5" /> Terminate
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row">
                <span>
                  Showing {showingFrom.toLocaleString("en-NG")}–{showingTo.toLocaleString("en-NG")} of {total.toLocaleString("en-NG")}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!hasPrev}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Prev
                  </Button>
                  <span className="px-1">Page {currentPage}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!hasNext}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Terminate confirmation dialog */}
      <TerminateDialog
        card={terminateTarget}
        busy={false}
        onCancel={() => setTerminateTarget(null)}
        onConfirm={async (card) => {
          await runAction(card, "terminate", "Card terminated");
          setTerminateTarget(null);
        }}
      />
    </div>
  );
}

// ============================================================
// Terminate confirmation dialog
// ============================================================
function TerminateDialog({
  card,
  busy,
  onCancel,
  onConfirm,
}: {
  card: CardView | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (card: CardView) => Promise<void>;
}) {
  const [working, setWorking] = React.useState(false);
  const open = !!card;

  async function handleConfirm() {
    if (!card) return;
    setWorking(true);
    try {
      await onConfirm(card);
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Terminate this virtual card?</DialogTitle>
          <DialogDescription>
            This permanently disables the card. The cardholder will no longer be
            able to make payments with it. This action is recorded in the audit trail.
          </DialogDescription>
        </DialogHeader>
        {card && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Cardholder</span>
              <span className="font-medium">
                {card.cardholderName || card.user.fullName}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-muted-foreground">Card</span>
              <span className="font-mono">
                {card.brand ?? "VISA"} •••• {card.last4 ?? "----"}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-muted-foreground">Balance</span>
              <span className="font-medium tabular-nums">
                {formatNaira(card.balanceKobo)}
              </span>
            </div>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={working || busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={working || busy}
            onClick={handleConfirm}
          >
            <Ban className="mr-1 h-4 w-4" />
            {working ? "Terminating…" : "Terminate card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
