"use client";

import * as React from "react";
import { ShieldAlert, Eye } from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// ---------- types ----------
interface AmlFlagRow {
  id: string;
  userId: string;
  user: { id: string; fullName: string; emailMasked: string; phoneMasked: string } | null;
  rule: string;
  severity: string;
  description: string;
  resolved: boolean;
  resolvedAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
interface AmlList {
  items: AmlFlagRow[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

const SEV_TONE: Record<string, string> = {
  HIGH: "bg-destructive text-white",
  MEDIUM: "bg-warning text-warning-foreground",
  LOW: "bg-primary text-primary-foreground",
};

// ============================================================
// Main
// ============================================================
export function AmlFlags() {
  const [tab, setTab] = React.useState<"unresolved" | "resolved" | "all">("unresolved");
  const [reviewId, setReviewId] = React.useState<string | null>(null);

  const resolvedParam =
    tab === "unresolved" ? "false" : tab === "resolved" ? "true" : "";
  const qs = new URLSearchParams();
  if (resolvedParam) qs.set("resolved", resolvedParam);
  qs.set("limit", "100");
  const path = `/api/admin/compliance/flags?${qs.toString()}`;

  const { data, isLoading, error } = useApi<AmlList>(path);

  return (
    <div className="space-y-5">
      <PageHeader
        title="AML Flags"
        description="Anti-money-laundering alerts raised by the risk engine."
        icon={<ShieldAlert className="h-5 w-5" />}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="unresolved">Unresolved</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardContent className="p-0">
              {error ? (
                <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
              ) : isLoading || !data ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : data.items.length === 0 ? (
                <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No AML flags" description="Nothing to review in this view." />
              ) : (
                <ScrollArea className="max-h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Rule</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell>
                            <div className="font-medium">{f.user?.fullName ?? f.userId}</div>
                            <div className="text-xs text-muted-foreground">{f.user?.emailMasked ?? "—"}</div>
                          </TableCell>
                          <TableCell>
                            <Badge className={cn("text-[10px]", SEV_TONE[f.severity] ?? "")}>{f.severity}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm font-medium">{f.rule.replace(/_/g, " ")}</div>
                            <div className="max-w-[260px] truncate text-xs text-muted-foreground">{f.description}</div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(f.createdAt).toLocaleString("en-NG")}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" onClick={() => setReviewId(f.id)}>
                              <Eye className="mr-1 h-3.5 w-3.5" /> Review
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ReviewDialog flagId={reviewId} onClose={() => setReviewId(null)} />
    </div>
  );
}

// ============================================================
// Review Dialog
// ============================================================
function ReviewDialog({ flagId, onClose }: { flagId: string | null; onClose: () => void }) {
  const path = flagId ? `/api/admin/compliance/flags?userId=&resolved=&limit=500` : null; // we already have list; re-fetch by id via flags list
  // Simpler: just fetch the full list and find by id (the API doesn't expose a single-flag GET).
  const { data } = useApi<AmlList>(path);
  const flag = React.useMemo(() => data?.items.find((f) => f.id === flagId) ?? null, [data, flagId]);

  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { setNotes(""); }, [flagId]);

  async function act(action: "resolve" | "escalate" | "false_positive") {
    if (!flagId) return;
    if (!notes.trim()) {
      toast.error("Notes are required");
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/admin/compliance/flags/${flagId}`, { method: "PATCH", body: JSON.stringify({ action, notes }) });
      toast.success(`Flag ${action.replace("_", " ")}`);
      mutateApi(`/api/admin/compliance/flags`);
      onClose();
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!flagId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AML flag review</DialogTitle>
          <DialogDescription>
            {flag ? `${flag.rule.replace(/_/g, " ")} · ${flag.severity}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {flag ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{flag.user?.fullName ?? flag.userId}</span>
                <Badge className={cn("text-[10px]", SEV_TONE[flag.severity] ?? "")}>{flag.severity}</Badge>
              </div>
              <p className="text-muted-foreground">{flag.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">{new Date(flag.createdAt).toLocaleString("en-NG")}</p>
              {flag.metadata && (
                <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-[10px]">{JSON.stringify(flag.metadata, null, 2)}</pre>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Resolution notes</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Document your review decision…" />
            </div>
          </div>
        ) : (
          <Skeleton className="h-32 w-full" />
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button variant="outline" disabled={busy || !flag} onClick={() => act("false_positive")}>False positive</Button>
          <Button variant="outline" disabled={busy || !flag} onClick={() => act("escalate")}>Escalate</Button>
          <Button disabled={busy || !flag} onClick={() => act("resolve")}>Resolve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
