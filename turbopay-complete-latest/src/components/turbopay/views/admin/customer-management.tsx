"use client";

import * as React from "react";
import {
  Users, Search, Eye, Snowflake, Sun, Ban, CheckCircle2, Pin, StickyNote,
} from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
import { formatNaira } from "@/lib/turbopay/money";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// ---------- types ----------
interface CustomerRow {
  id: string;
  fullName: string;
  email: string;
  emailMasked: string;
  phone: string;
  phoneMasked: string;
  kycTier: number;
  kycStatus: string;
  status: string;
  role: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
  wallet: { id: string; balanceKobo: number; currency: string; status: string } | null;
}
interface CustomerList {
  items: CustomerRow[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

interface CustomerProfile {
  user: {
    id: string; fullName: string; email: string; emailMasked: string;
    phone: string; phoneMasked: string; kycTier: number; kycStatus: string;
    status: string; role: string; emailVerified: boolean; phoneVerified: boolean;
    bvnMasked: string | null; ninMasked: string | null; pinSetAt: string | null;
    createdAt: string; updatedAt: string;
  };
  wallet: {
    id: string; balanceKobo: number; currency: string; status: string;
    version: number; createdAt: string; updatedAt: string;
  } | null;
  virtualAccounts: {
    id: string; accountNumber: string; accountName: string; bankName: string;
    bankCode: string; provider: string; status: string; createdAt: string;
  }[];
  recentTransactions: {
    id: string; reference: string; type: string; direction: string;
    amountKobo: number; feeKobo: number; status: string;
    counterpartyName: string | null; description: string | null;
    provider: string | null; createdAt: string;
  }[];
  kycRecords: {
    id: string; tier: number; status: string; provider: string | null;
    ninMasked: string | null; bvnMasked: string | null;
    firstName: string | null; lastName: string | null;
    verifiedAt: string | null; createdAt: string;
  }[];
  amlFlags: {
    id: string; rule: string; severity: string; description: string;
    resolved: boolean; resolvedAt: string | null;
    metadata: Record<string, unknown> | null; createdAt: string;
  }[];
  complianceCases: {
    id: string; type: string; status: string; severity: string;
    description: string; notes: string | null; assignedTo: string | null;
    resolvedAt: string | null; createdAt: string; updatedAt: string;
  }[];
  supportNotes: {
    id: string; authorId: string | null; authorName: string | null;
    note: string; pinned: boolean; createdAt: string; updatedAt: string;
  }[];
}

// ---------- status helpers ----------
const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-success/15 text-success border-success/30",
  FROZEN: "bg-destructive/15 text-destructive border-destructive/30",
  SUSPENDED: "bg-warning/15 text-warning-foreground border-warning/30",
  CLOSED: "bg-muted text-muted-foreground border-border",
};
const KYC_STATUS_TONE: Record<string, string> = {
  VERIFIED: "bg-success/15 text-success",
  PENDING: "bg-warning/15 text-warning-foreground",
  REJECTED: "bg-destructive/15 text-destructive",
  UNVERIFIED: "bg-muted text-muted-foreground",
};
const SEV_TONE: Record<string, string> = {
  HIGH: "bg-destructive text-white",
  MEDIUM: "bg-warning text-warning-foreground",
  LOW: "bg-primary text-primary-foreground",
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
// Main component
// ============================================================
export function CustomerManagement() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<string>("");
  const [kycTier, setKycTier] = React.useState<string>("");
  const [kycStatus, setKycStatus] = React.useState<string>("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const debouncedQ = useDebounced(q);
  const params = new URLSearchParams();
  if (debouncedQ) params.set("q", debouncedQ);
  if (status) params.set("status", status);
  if (kycTier) params.set("kycTier", kycTier);
  if (kycStatus) params.set("kycStatus", kycStatus);
  params.set("limit", "50");
  const path = `/api/admin/customers?${params.toString()}`;

  const { data, isLoading, error } = useApi<CustomerList>(path);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customer Management"
        description="Search, review, and manage customer accounts."
        icon={<Users className="h-5 w-5" />}
      />

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="q" className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="q"
                  placeholder="Name, email, phone…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status || "ALL"} onValueChange={(v) => setStatus(v === "ALL" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="FROZEN">Frozen</SelectItem>
                  <SelectItem value="SUSPENDED">Suspended</SelectItem>
                  <SelectItem value="CLOSED">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">KYC Tier</Label>
              <Select value={kycTier || "ALL"} onValueChange={(v) => setKycTier(v === "ALL" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All tiers</SelectItem>
                  <SelectItem value="1">Tier 1</SelectItem>
                  <SelectItem value="2">Tier 2</SelectItem>
                  <SelectItem value="3">Tier 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">KYC Status</Label>
              <Select value={kycStatus || "ALL"} onValueChange={(v) => setKycStatus(v === "ALL" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="UNVERIFIED">Unverified</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="VERIFIED">Verified</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                </SelectContent>
              </Select>
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
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : data.items.length === 0 ? (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="No customers found"
              description="Try adjusting your search or filters."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>KYC</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.fullName}</TableCell>
                      <TableCell className="text-muted-foreground">{c.emailMasked}</TableCell>
                      <TableCell className="text-muted-foreground">{c.phoneMasked}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant="secondary" className="w-fit text-[10px]">T{c.kycTier}</Badge>
                          <Badge variant="outline" className={cn("w-fit text-[10px]", KYC_STATUS_TONE[c.kycStatus] ?? "")}>
                            {c.kycStatus}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[c.status] ?? "")}>
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.wallet ? formatNaira(c.wallet.balanceKobo) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(c.createdAt).toLocaleDateString("en-NG")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setSelectedId(c.id)}>
                          <Eye className="mr-1 h-3.5 w-3.5" /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground">
                <span>{data.total} customers</span>
                <span>Page {data.page}{data.hasMore ? " (more available)" : ""}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <CustomerDetailSheet customerId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

// ============================================================
// Detail Sheet with tabs
// ============================================================
function CustomerDetailSheet({ customerId, onClose }: { customerId: string | null; onClose: () => void }) {
  const path = customerId ? `/api/admin/customers/${customerId}` : null;
  const { data, isLoading, error, refetch } = useApi<CustomerProfile>(path);

  return (
    <Sheet open={!!customerId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{data?.user.fullName ?? "Customer"}</SheetTitle>
          <SheetDescription>
            {data?.user.emailMasked} · {data?.user.phoneMasked}
          </SheetDescription>
        </SheetHeader>

        {isLoading || !data ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-destructive">{(error as Error).message}</div>
        ) : (
          <div className="px-4 pb-6">
            <Tabs defaultValue="profile" className="w-full">
              <ScrollArea className="w-full">
                <TabsList className="flex w-max">
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                  <TabsTrigger value="wallet">Wallet</TabsTrigger>
                  <TabsTrigger value="txs">Transactions</TabsTrigger>
                  <TabsTrigger value="kyc">KYC</TabsTrigger>
                  <TabsTrigger value="aml">AML</TabsTrigger>
                  <TabsTrigger value="compliance">Compliance</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                </TabsList>
              </ScrollArea>

              <TabsContent value="profile" className="mt-4">
                <ProfileTab data={data} onChanged={refetch} />
              </TabsContent>
              <TabsContent value="wallet" className="mt-4">
                <WalletTab data={data} />
              </TabsContent>
              <TabsContent value="txs" className="mt-4">
                <TransactionsTab data={data} />
              </TabsContent>
              <TabsContent value="kyc" className="mt-4">
                <KycTab data={data} onChanged={refetch} />
              </TabsContent>
              <TabsContent value="aml" className="mt-4">
                <AmlTab data={data} />
              </TabsContent>
              <TabsContent value="compliance" className="mt-4">
                <ComplianceTab data={data} />
              </TabsContent>
              <TabsContent value="notes" className="mt-4">
                <NotesTab customerId={data.user.id} notes={data.supportNotes} onChanged={refetch} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------- Profile tab ----------
function ProfileTab({ data, onChanged }: { data: CustomerProfile; onChanged: () => void }) {
  const u = data.user;
  const [action, setAction] = React.useState<
    { type: "freeze-wallet" | "unfreeze-wallet" | "suspend" | "reactivate"; title: string; submitLabel: string } | null
  >(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!action || !reason.trim()) return;
    setBusy(true);
    try {
      if (action.type === "freeze-wallet") {
        await apiFetch(`/api/admin/customers/${u.id}/wallet/freeze`, { method: "POST", body: JSON.stringify({ reason }) });
      } else if (action.type === "unfreeze-wallet") {
        await apiFetch(`/api/admin/customers/${u.id}/wallet/unfreeze`, { method: "POST", body: JSON.stringify({ reason }) });
      } else if (action.type === "suspend" || action.type === "reactivate") {
        const status = action.type === "suspend" ? "SUSPENDED" : "ACTIVE";
        await apiFetch(`/api/admin/customers/${u.id}/status`, { method: "PATCH", body: JSON.stringify({ status, reason }) });
      }
      toast.success(`${action.title} completed`);
      mutateApi(`/api/admin/customers/${u.id}`);
      mutateApi(`/api/admin/customers`);
      setAction(null);
      setReason("");
      onChanged();
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const isFrozen = u.status === "FROZEN" || u.status === "SUSPENDED";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-2 text-sm">
          <Row label="Full name" value={u.fullName} />
          <Row label="Email" value={`${u.emailMasked}${u.emailVerified ? " ✓" : " ✗"}`} />
          <Row label="Phone" value={`${u.phoneMasked}${u.phoneVerified ? " ✓" : " ✗"}`} />
          <Row label="Role" value={u.role} />
          <Row label="KYC" value={`Tier ${u.kycTier} · ${u.kycStatus}`} />
          <Row label="BVN" value={u.bvnMasked ?? "—"} />
          <Row label="NIN" value={u.ninMasked ?? "—"} />
          <Row label="PIN set" value={u.pinSetAt ? new Date(u.pinSetAt).toLocaleString("en-NG") : "Not set"} />
          <Row label="Joined" value={new Date(u.createdAt).toLocaleString("en-NG")} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={isFrozen} onClick={() => setAction({ type: "freeze-wallet", title: "Freeze wallet", submitLabel: "Freeze wallet" })}>
          <Snowflake className="mr-1 h-4 w-4" /> Freeze Wallet
        </Button>
        <Button variant="outline" disabled={!isFrozen} onClick={() => setAction({ type: "unfreeze-wallet", title: "Unfreeze wallet", submitLabel: "Unfreeze wallet" })}>
          <Sun className="mr-1 h-4 w-4" /> Unfreeze Wallet
        </Button>
        <Button variant="outline" disabled={u.status === "SUSPENDED" || u.status === "CLOSED"} onClick={() => setAction({ type: "suspend", title: "Suspend account", submitLabel: "Suspend account" })}>
          <Ban className="mr-1 h-4 w-4" /> Suspend Account
        </Button>
        <Button variant="outline" disabled={u.status === "ACTIVE"} onClick={() => setAction({ type: "reactivate", title: "Reactivate account", submitLabel: "Reactivate" })}>
          <CheckCircle2 className="mr-1 h-4 w-4" /> Reactivate
        </Button>
      </div>

      <Dialog open={!!action} onOpenChange={(o) => { if (!o) { setAction(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action?.title}</DialogTitle>
            <DialogDescription>Provide a reason. This is recorded in the audit trail.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Suspected fraud — flagged by AML rule" />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={submit} disabled={busy || !reason.trim()}>
              {busy ? "Working…" : action?.submitLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Wallet tab ----------
function WalletTab({ data }: { data: CustomerProfile }) {
  const w = data.wallet;
  if (!w) return <EmptyState title="No wallet" description="This customer does not have a wallet." />;
  return (
    <Card>
      <CardContent className="p-6 space-y-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Balance</p>
          <p className="text-4xl font-semibold tabular-nums">{formatNaira(w.balanceKobo)}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Row label="Status" value={<Badge variant="outline" className={STATUS_TONE[w.status] ?? ""}>{w.status}</Badge>} />
          <Row label="Currency" value={w.currency} />
          <Row label="Wallet ID" value={<span className="font-mono text-xs">{w.id}</span>} />
          <Row label="Version" value={String(w.version)} />
          <Row label="Created" value={new Date(w.createdAt).toLocaleString("en-NG")} />
          <Row label="Updated" value={new Date(w.updatedAt).toLocaleString("en-NG")} />
        </div>
        {data.virtualAccounts.length > 0 && (
          <div className="pt-2">
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Virtual accounts</p>
            <div className="space-y-1.5">
              {data.virtualAccounts.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <div>
                    <p className="font-mono">{v.accountNumber}</p>
                    <p className="text-xs text-muted-foreground">{v.bankName} · {v.provider}</p>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{v.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Transactions tab ----------
function TransactionsTab({ data }: { data: CustomerProfile }) {
  const txs = data.recentTransactions.slice(0, 10);
  if (txs.length === 0) return <EmptyState title="No transactions" />;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {txs.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                <TableCell className="text-xs">{t.type}</TableCell>
                <TableCell className={cn("text-right tabular-nums", t.direction === "CREDIT" ? "text-success" : "text-warning-foreground")}>
                  {t.direction === "CREDIT" ? "+" : "-"}{formatNaira(t.amountKobo)}
                </TableCell>
                <TableCell><Badge variant="secondary" className="text-[10px]">{t.status}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString("en-NG")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------- KYC tab ----------
function KycTab({ data, onChanged }: { data: CustomerProfile; onChanged: () => void }) {
  const [busyId, setBusyId] = React.useState<string | null>(null);
  if (data.kycRecords.length === 0) return <EmptyState title="No KYC records" />;

  async function review(id: string, decision: "VERIFIED" | "REJECTED", reason: string) {
    setBusyId(id);
    try {
      await apiFetch(`/api/admin/kyc/${id}/review`, { method: "PATCH", body: JSON.stringify({ decision, reason }) });
      toast.success(`KYC ${decision.toLowerCase()}`);
      mutateApi("/api/admin/kyc/queue");
      mutateApi(`/api/admin/customers/${data.user.id}`);
      onChanged();
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      {data.kycRecords.map((k) => (
        <Card key={k.id}>
          <CardContent className="p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium">Tier {k.tier} · {k.provider ?? "—"}</p>
              <Badge variant="outline" className={KYC_STATUS_TONE[k.status] ?? ""}>{k.status}</Badge>
            </div>
            <Row label="Name on ID" value={[k.firstName, k.lastName].filter(Boolean).join(" ") || "—"} />
            <Row label="NIN" value={k.ninMasked ?? "—"} />
            <Row label="BVN" value={k.bvnMasked ?? "—"} />
            <Row label="Submitted" value={new Date(k.createdAt).toLocaleString("en-NG")} />
            {k.verifiedAt && <Row label="Verified" value={new Date(k.verifiedAt).toLocaleString("en-NG")} />}
            {k.status === "PENDING" && (
              <div className="flex gap-2 pt-2">
                <Button size="sm" disabled={busyId === k.id} onClick={() => review(k.id, "VERIFIED", "Approved by admin reviewer")}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" disabled={busyId === k.id} onClick={() => review(k.id, "REJECTED", "Rejected by admin reviewer")}>
                  Reject
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------- AML tab ----------
function AmlTab({ data }: { data: CustomerProfile }) {
  if (data.amlFlags.length === 0) return <EmptyState title="No AML flags" description="No risk flags raised for this customer." />;
  return (
    <div className="space-y-2">
      {data.amlFlags.map((f) => (
        <Card key={f.id}>
          <CardContent className="p-4 space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium">{f.rule.replace(/_/g, " ")}</p>
              <Badge className={cn("text-[10px]", SEV_TONE[f.severity] ?? "")}>{f.severity}</Badge>
            </div>
            <p className="text-muted-foreground">{f.description}</p>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{new Date(f.createdAt).toLocaleString("en-NG")}</span>
              <Badge variant={f.resolved ? "secondary" : "outline"} className="text-[10px]">
                {f.resolved ? "Resolved" : "Open"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------- Compliance tab ----------
function ComplianceTab({ data }: { data: CustomerProfile }) {
  if (data.complianceCases.length === 0) return <EmptyState title="No compliance cases" />;
  return (
    <div className="space-y-2">
      {data.complianceCases.map((c) => (
        <Card key={c.id}>
          <CardContent className="p-4 space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium">{c.type} · <span className="font-mono text-xs">{c.id.slice(0, 8)}</span></p>
              <Badge className={cn("text-[10px]", SEV_TONE[c.severity] ?? "")}>{c.severity}</Badge>
            </div>
            <p className="text-muted-foreground">{c.description}</p>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{c.status}</span>
              <span>{new Date(c.createdAt).toLocaleString("en-NG")}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------- Notes tab ----------
function NotesTab({ customerId, notes, onChanged }: { customerId: string; notes: CustomerProfile["supportNotes"]; onChanged: () => void }) {
  const [note, setNote] = React.useState("");
  const [pinned, setPinned] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function add() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/customers/${customerId}/notes`, { method: "POST", body: JSON.stringify({ note, pinned }) });
      toast.success("Note added");
      setNote("");
      setPinned(false);
      mutateApi(`/api/admin/customers/${customerId}`);
      mutateApi(`/api/admin/customers/${customerId}/notes`);
      onChanged();
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 space-y-2">
          <Label htmlFor="note">Add a support note</Label>
          <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Document context, customer contact, decisions…" />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              Pin to top
            </label>
            <Button size="sm" onClick={add} disabled={busy || !note.trim()}>
              <StickyNote className="mr-1 h-3.5 w-3.5" /> {busy ? "Saving…" : "Add note"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {notes.length === 0 ? (
        <EmptyState title="No notes yet" />
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <Card key={n.id}>
              <CardContent className="p-3 text-sm">
                <div className="flex items-start gap-2">
                  {n.pinned && <Pin className="mt-0.5 h-3.5 w-3.5 text-warning-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words">{n.note}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {n.authorName ?? "—"} · {new Date(n.createdAt).toLocaleString("en-NG")}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- small row helper ----------
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
