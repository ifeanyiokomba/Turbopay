"use client";

import * as React from "react";
import { Briefcase, Eye } from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
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

// ---------- types ----------
interface CaseRow {
  id: string;
  userId: string;
  type: string;
  severity: string;
  description: string;
  status: string;
  amlFlagId: string | null;
  notes: string | null;
  assignedTo: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface CaseList {
  items: CaseRow[];
  total: number;
  page: number;
  limit: number;
}

const SEV_TONE: Record<string, string> = {
  HIGH: "bg-destructive text-white",
  MEDIUM: "bg-warning text-warning-foreground",
  LOW: "bg-primary text-primary-foreground",
};

const STATUS_TONE: Record<string, string> = {
  OPEN: "bg-warning/15 text-warning-foreground",
  UNDER_REVIEW: "bg-primary/15 text-primary",
  CLOSED: "bg-muted text-muted-foreground",
  RESOLVED: "bg-success/15 text-success",
};

const CASE_STATUSES = ["OPEN", "UNDER_REVIEW", "CLOSED", "RESOLVED"];
const CASE_TYPES = ["STR", "REVIEW", "FREEZE", "OTHER"];

// ============================================================
// Main
// ============================================================
export function ComplianceCases() {
  const [status, setStatus] = React.useState("");
  const [type, setType] = React.useState("");
  const [severity, setSeverity] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (type) qs.set("type", type);
  qs.set("limit", "100");
  const path = `/api/admin/compliance/cases?${qs.toString()}`;

  const { data, isLoading, error } = useApi<CaseList>(path);

  const filtered = React.useMemo(() => {
    if (!data?.items) return [];
    if (!severity) return data.items;
    return data.items.filter((c) => c.severity === severity);
  }, [data, severity]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Compliance Cases"
        description="Track STRs, reviews, and risk-driven investigations."
        icon={<Briefcase className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status || "ALL"} onValueChange={(v) => setStatus(v === "ALL" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  {CASE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={type || "ALL"} onValueChange={(v) => setType(v === "ALL" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  {CASE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Severity</Label>
              <Select value={severity || "ALL"} onValueChange={(v) => setSeverity(v === "ALL" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
          ) : isLoading || !data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={<Briefcase className="h-6 w-6" />} title="No cases" description="No compliance cases match these filters." />
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Case ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.id.slice(0, 8)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{c.userId.slice(0, 8)}</TableCell>
                      <TableCell className="text-xs">{c.type}</TableCell>
                      <TableCell><Badge className={cn("text-[10px]", SEV_TONE[c.severity] ?? "")}>{c.severity}</Badge></TableCell>
                      <TableCell><Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[c.status] ?? "")}>{c.status.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString("en-NG")}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setSelectedId(c.id)}>
                          <Eye className="mr-1 h-3.5 w-3.5" /> View
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

      <CaseDetailSheet caseId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

// ============================================================
// Detail Sheet
// ============================================================
function CaseDetailSheet({ caseId, onClose }: { caseId: string | null; onClose: () => void }) {
  const path = caseId ? `/api/admin/compliance/cases/${caseId}` : null;
  const { data, isLoading, error, refetch } = useApi<CaseRow>(path);

  const [status, setStatus] = React.useState("");
  const [assignedTo, setAssignedTo] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setStatus(data?.status ?? "");
    setAssignedTo(data?.assignedTo ?? "");
    setNotes(data?.notes ?? "");
  }, [data]);

  async function save(closeCase = false) {
    if (!caseId) return;
    setBusy(true);
    try {
      const body: Record<string, string> = {
        notes,
        assignedTo,
        status: closeCase ? "CLOSED" : status,
      };
      await apiFetch(`/api/admin/compliance/cases/${caseId}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(closeCase ? "Case closed" : "Case updated");
      mutateApi("/api/admin/compliance/cases");
      if (closeCase) onClose();
      else refetch();
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!caseId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Case {data ? data.id.slice(0, 8) : ""}</SheetTitle>
          <SheetDescription>{data ? `${data.type} · ${data.severity}` : "Loading…"}</SheetDescription>
        </SheetHeader>

        {isLoading || !data ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-destructive">{(error as Error).message}</div>
        ) : (
          <div className="space-y-4 px-4 pb-6">
            <Card>
              <CardContent className="p-4 space-y-2 text-sm">
                <Row label="Type" value={data.type} />
                <Row label="Severity" value={<Badge className={cn("text-[10px]", SEV_TONE[data.severity] ?? "")}>{data.severity}</Badge>} />
                <Row label="Status" value={<Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[data.status] ?? "")}>{data.status.replace(/_/g, " ")}</Badge>} />
                <Row label="Customer" value={<span className="font-mono text-xs">{data.userId}</span>} />
                <Row label="AML flag" value={data.amlFlagId ? <span className="font-mono text-xs">{data.amlFlagId.slice(0, 8)}</span> : "—"} />
                <Row label="Created" value={new Date(data.createdAt).toLocaleString("en-NG")} />
                <Row label="Updated" value={new Date(data.updatedAt).toLocaleString("en-NG")} />
                {data.resolvedAt && <Row label="Resolved" value={new Date(data.resolvedAt).toLocaleString("en-NG")} />}
                <div className="pt-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Description</p>
                  <p className="mt-1">{data.description}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CASE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Assign to</Label>
                    <Input placeholder="username / id" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cnotes" className="text-xs">Notes</Label>
                  <Textarea id="cnotes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Investigation notes, decisions, context…" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => save(false)} disabled={busy}>{busy ? "Saving…" : "Update case"}</Button>
                  <Button variant="outline" onClick={() => save(true)} disabled={busy}>Close case</Button>
                </div>
              </CardContent>
            </Card>
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
