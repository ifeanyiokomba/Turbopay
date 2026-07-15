"use client";

import * as React from "react";
import { IdCard, Eye } from "lucide-react";
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
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// ---------- types ----------
interface KycRow {
  id: string;
  userId: string;
  user: { id: string; fullName: string; emailMasked: string; phoneMasked: string; status: string; country: string | null } | null;
  tier: number;
  status: string;
  provider: string | null;
  ninMasked: string | null;
  bvnMasked: string | null;
  phoneMasked: string | null;
  emailMasked: string | null;
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  verifiedAt: string | null;
  createdAt: string;
}
interface KycList {
  items: KycRow[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

const STATUS_TONE: Record<string, string> = {
  VERIFIED: "bg-success/15 text-success",
  PENDING: "bg-warning/15 text-warning-foreground",
  REJECTED: "bg-destructive/15 text-destructive",
};

const REJECT_REASONS = [
  "Name does not match ID",
  "Invalid or unrecognised NIN",
  "Invalid or unrecognised BVN",
  "ID photo unclear",
  "Underage — cannot verify",
  "Other (specify in notes)",
];

// ============================================================
// Main
// ============================================================
export function KycQueue() {
  const [tab, setTab] = React.useState<"PENDING" | "VERIFIED" | "REJECTED">("PENDING");
  const [reviewId, setReviewId] = React.useState<string | null>(null);

  const qs = new URLSearchParams();
  qs.set("status", tab);
  qs.set("limit", "100");
  const path = `/api/admin/kyc/queue?${qs.toString()}`;

  const { data, isLoading, error } = useApi<KycList>(path);

  return (
    <div className="space-y-5">
      <PageHeader
        title="KYC Queue"
        description="Review identity verifications submitted by customers."
        icon={<IdCard className="h-5 w-5" />}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="PENDING">Pending</TabsTrigger>
          <TabsTrigger value="VERIFIED">Verified</TabsTrigger>
          <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
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
                <EmptyState icon={<IdCard className="h-6 w-6" />} title="Nothing here" description="No KYC records in this view." />
              ) : (
                <ScrollArea className="max-h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Country</TableHead>
                        <TableHead>Tier</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Name on ID</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((k) => (
                        <TableRow key={k.id}>
                          <TableCell>
                            <div className="font-medium">{k.user?.fullName ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{k.user?.phoneMasked ?? "—"}</div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{k.user?.emailMasked ?? k.emailMasked ?? "—"}</TableCell>
                          <TableCell className="text-xs">{k.user?.country ?? "—"}</TableCell>
                          <TableCell><Badge variant="secondary" className="text-[10px]">T{k.tier}</Badge></TableCell>
                          <TableCell className="text-xs">{k.provider ?? "—"}</TableCell>
                          <TableCell>{[k.firstName, k.lastName].filter(Boolean).join(" ") || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(k.createdAt).toLocaleString("en-NG")}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" onClick={() => setReviewId(k.id)}>
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

      <ReviewSheet kycId={reviewId} onClose={() => setReviewId(null)} />
    </div>
  );
}

// ============================================================
// Review Sheet
// ============================================================
function ReviewSheet({ kycId, onClose }: { kycId: string | null; onClose: () => void }) {
  // Re-use the queue list and find by id.
  const { data, isLoading } = useApi<KycList>(`/api/admin/kyc/queue?limit=500`);
  const kyc = React.useMemo(() => data?.items.find((k) => k.id === kycId) ?? null, [data, kycId]);

  const [decision, setDecision] = React.useState<"VERIFIED" | "REJECTED" | null>(null);
  const [rejectReason, setRejectReason] = React.useState(REJECT_REASONS[0]);
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { setDecision(null); setNotes(""); setRejectReason(REJECT_REASONS[0]); }, [kycId]);

  async function submit() {
    if (!kycId || !decision) return;
    const reason = decision === "REJECTED" ? (rejectReason === "Other (specify in notes)" ? (notes || rejectReason) : rejectReason) : (notes || "Approved by reviewer");
    setBusy(true);
    try {
      await apiFetch(`/api/admin/kyc/${kycId}/review`, { method: "PATCH", body: JSON.stringify({ decision, reason }) });
      toast.success(`KYC ${decision.toLowerCase()}`);
      mutateApi("/api/admin/kyc/queue");
      onClose();
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!kycId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>KYC review</SheetTitle>
          <SheetDescription>
            {kyc ? `Tier ${kyc.tier} · ${kyc.provider ?? "—"}` : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        {isLoading || !data ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !kyc ? (
          <div className="p-4 text-sm text-muted-foreground">Record not found.</div>
        ) : (
          <div className="space-y-4 px-4 pb-6">
            <Card>
              <CardContent className="p-4 space-y-2 text-sm">
                <Row label="Customer" value={kyc.user?.fullName ?? "—"} />
                <Row label="Email" value={kyc.user?.emailMasked ?? kyc.emailMasked ?? "—"} />
                <Row label="Phone" value={kyc.user?.phoneMasked ?? kyc.phoneMasked ?? "—"} />
                <Row label="Tier" value={`Tier ${kyc.tier}`} />
                <Row label="Status" value={<Badge variant="outline" className={cn(STATUS_TONE[kyc.status] ?? "")}>{kyc.status}</Badge>} />
                <Row label="Provider" value={kyc.provider ?? "—"} />
                <Row label="Name on ID" value={[kyc.firstName, kyc.middleName, kyc.lastName].filter(Boolean).join(" ") || "—"} />
                <Row label="NIN" value={kyc.ninMasked ?? "—"} />
                <Row label="BVN" value={kyc.bvnMasked ?? "—"} />
                <Row label="Submitted" value={new Date(kyc.createdAt).toLocaleString("en-NG")} />
                {kyc.verifiedAt && <Row label="Verified" value={new Date(kyc.verifiedAt).toLocaleString("en-NG")} />}
              </CardContent>
            </Card>

            {kyc.status === "PENDING" ? (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex gap-2">
                    <Button variant={decision === "VERIFIED" ? "default" : "outline"} className="flex-1" onClick={() => setDecision("VERIFIED")}>
                      Approve
                    </Button>
                    <Button variant={decision === "REJECTED" ? "destructive" : "outline"} className="flex-1" onClick={() => setDecision("REJECTED")}>
                      Reject
                    </Button>
                  </div>

                  {decision === "REJECTED" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Reason for rejection</Label>
                      <Select value={rejectReason} onValueChange={setRejectReason}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {REJECT_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {decision && (
                    <div className="space-y-1.5">
                      <Label htmlFor="knotes" className="text-xs">Reviewer notes</Label>
                      <Textarea id="knotes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional context for the audit trail…" />
                    </div>
                  )}

                  <Button className="w-full" disabled={busy || !decision} onClick={submit}>
                    {busy ? "Submitting…" : `Confirm ${decision === "VERIFIED" ? "approval" : "rejection"}`}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                This record is already {kyc.status}.
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
