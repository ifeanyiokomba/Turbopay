"use client";

import * as React from "react";
import {
  Send, Eye, RefreshCw, CheckCircle2, XCircle, Clock, AlertCircle,
  ArrowLeftRight, Smartphone, Zap, Tv, Globe, CreditCard, Building2, FileText,
} from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi } from "@/lib/turbopay/client";
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
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// ─── Types ──────────────────────────────────────────────────

type BulkCategory =
  | "wallet_credit" | "bank_transfer" | "airtime" | "data"
  | "electricity" | "utility" | "remita" | "quickteller" | "international";

interface BulkJob {
  id: string;
  userId: string;
  reference: string;
  totalItems: number;
  processedItems: number;
  successCount: number;
  failedCount: number;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  items: BulkItemResult[];
  createdAt: string;
  completedAt?: string;
}

interface BulkItemResult {
  index: number;
  recipient: string;
  amountKobo: number;
  category: BulkCategory;
  status: "PENDING" | "SUCCESS" | "FAILED";
  transactionId?: string;
  reference?: string;
  error?: string;
}

interface BulkJobList {
  items: BulkJob[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ─── Category config ────────────────────────────────────────

const CATEGORIES: Record<BulkCategory, {
  label: string; icon: React.ReactNode; color: string;
  description: string;
  csvTemplate: string;
  csvHint: string;
  fields: string[];
}> = {
  wallet_credit: {
    label: "Wallet Credit", icon: <CreditCard className="h-4 w-4" />, color: "bg-success/15 text-success",
    description: "Transfer funds to Turbopay wallet users",
    csvTemplate: "recipient_user_id,1500.00,,Salary payment",
    csvHint: "recipient, amount (NGN), recipientName (optional), narration (optional)",
    fields: ["recipient", "amountKobo", "recipientName", "narration"],
  },
  bank_transfer: {
    label: "Bank Transfer", icon: <Building2 className="h-4 w-4" />, color: "bg-primary/10 text-primary",
    description: "Send money to any Nigerian bank account (NIP)",
    csvTemplate: "1234567890,5000.00,044,John Doe,Vendor payment",
    csvHint: "accountNumber, amount (NGN), bankCode, recipientName, narration",
    fields: ["recipient", "amountKobo", "bankCode", "recipientName", "narration"],
  },
  airtime: {
    label: "Airtime", icon: <Smartphone className="h-4 w-4" />, color: "bg-accent text-accent-foreground",
    description: "Purchase airtime in bulk (MTN, Glo, Airtel, 9mobile)",
    csvTemplate: "08012345678,500.00,MTN",
    csvHint: "phoneNumber, amount (NGN), network (MTN/GLO/AIRTEL/9MOBILE)",
    fields: ["recipient", "amountKobo", "network"],
  },
  data: {
    label: "Data Plan", icon: <Smartphone className="h-4 w-4" />, color: "bg-accent text-accent-foreground",
    description: "Purchase data plans in bulk",
    csvTemplate: "08012345678,MTN,MTN1024",
    csvHint: "phoneNumber, network, planCode",
    fields: ["recipient", "network", "billerCode"],
  },
  electricity: {
    label: "Electricity", icon: <Zap className="h-4 w-4" />, color: "bg-warning/15 text-warning-foreground",
    description: "Pay electricity bills in bulk (prepaid/postpaid)",
    csvTemplate: "12345678901,prepaid,IKEDC,4500.00",
    csvHint: "meterNumber, meterType (prepaid/postpaid), discoCode, amount (NGN)",
    fields: ["meterNumber", "meterType", "discoCode", "amountKobo"],
  },
  utility: {
    label: "Utility Bills", icon: <Tv className="h-4 h-4" />, color: "bg-warning/15 text-warning-foreground",
    description: "Pay DStv, GOtv, water, internet and other utility bills",
    csvTemplate: "DSTV,1234567890,4500.00",
    csvHint: "billerCode, customerReference, amount (NGN)",
    fields: ["billerCode", "customerReference", "amountKobo"],
  },
  remita: {
    label: "Remita", icon: <FileText className="h-4 w-4" />, color: "bg-info/15 text-info",
    description: "Process Remita payments (IPPIS, schools, govt agencies)",
    csvTemplate: "REMITA_BILLER_ID,1234567890,4500.00,School fees",
    csvHint: "billerId, customerReference, amount (NGN), narration",
    fields: ["billerId", "customerReference", "amountKobo", "narration"],
  },
  quickteller: {
    label: "Quickteller", icon: <FileText className="h-4 w-4" />, color: "bg-info/15 text-info",
    description: "Process Quickteller bill payments",
    csvTemplate: "QT_BILLER_ID,1234567890,4500.00,Cable subscription",
    csvHint: "billerId, customerReference, amount (NGN), narration",
    fields: ["billerId", "customerReference", "amountKobo", "narration"],
  },
  international: {
    label: "International", icon: <Globe className="h-4 w-4" />, color: "bg-primary/10 text-primary",
    description: "Send international transfers via Wise/Flutterwave",
    csvTemplate: "John Smith,50000,GBP,GB29NWBK60161331926819,Barclays,Payment for services",
    csvHint: "beneficiaryName, amount, currency, beneficiaryAccount, beneficiaryBank, narration",
    fields: ["beneficiaryName", "amountKobo", "countryCode", "beneficiaryAccount", "beneficiaryBank", "narration"],
  },
};

// ─── Status helpers ─────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  PENDING: { label: "Pending", icon: <Clock className="h-3.5 w-3.5" />, className: "bg-warning/15 text-warning-foreground" },
  PROCESSING: { label: "Processing", icon: <RefreshCw className="h-3.5 w-3.5 animate-spin" />, className: "bg-primary/10 text-primary" },
  COMPLETED: { label: "Completed", icon: <CheckCircle2 className="h-3.5 w-3.5" />, className: "bg-success/15 text-success" },
  FAILED: { label: "Failed", icon: <XCircle className="h-3.5 w-3.5" />, className: "bg-destructive/15 text-destructive" },
};

const ITEM_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-warning/15 text-warning-foreground" },
  SUCCESS: { label: "Success", className: "bg-success/15 text-success" },
  FAILED: { label: "Failed", className: "bg-destructive/15 text-destructive" },
};

// ─── Component ──────────────────────────────────────────────

export function BulkPaymentsAdmin() {
  const [page, setPage] = React.useState(1);
  const [statusFilter, setStatusFilter] = React.useState("ALL");
  const [showCreate, setShowCreate] = React.useState(false);
  const [selectedJob, setSelectedJob] = React.useState<BulkJob | null>(null);

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (statusFilter !== "ALL") params.set("status", statusFilter);

  const { data, isLoading, error, refetch } = useApi<BulkJobList>(`/api/admin/bulk-payments?${params}`);

  const jobs = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bulk Payments"
        description="Create and manage batch payment disbursements across all channels."
        icon={<Send className="h-5 w-5" />}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Send className="mr-1 h-3.5 w-3.5" /> New Batch
            </Button>
          </div>
        }
      />

      {/* Error */}
      {error && !isLoading && (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="font-medium text-destructive">Failed to load bulk payments</p>
            <p className="text-sm text-muted-foreground">{error.message}</p>
            <Button size="sm" onClick={() => refetch()}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      {!isLoading && data && (
        <div className="grid gap-3 sm:grid-cols-4">
          <StatCard label="Total Batches" value={total} />
          <StatCard label="Completed" value={jobs.filter(j => j.status === "COMPLETED").length} icon={<CheckCircle2 className="h-4 w-4 text-success" />} />
          <StatCard label="Processing" value={jobs.filter(j => j.status === "PROCESSING").length} icon={<RefreshCw className="h-4 w-4 text-primary animate-spin" />} />
          <StatCard label="Failed" value={jobs.filter(j => j.status === "FAILED").length} icon={<XCircle className="h-4 w-4 text-destructive" />} />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="PROCESSING">Processing</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      )}

      {/* Table */}
      {!isLoading && !error && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <EmptyState icon={<Send className="h-10 w-10" />} title="No bulk payments" description="Create a batch to get started." />
                    </TableCell>
                  </TableRow>
                )}
                {jobs.map((job) => {
                  const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.PENDING;
                  // Determine dominant category from items
                  const categories = [...new Set(job.items.map(i => i.category))];
                  const dominantCat = categories.length === 1 ? categories[0] : `${categories.length} types`;
                  return (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-xs">{job.reference}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={cn("gap-1", cfg.className)}>
                          {cfg.icon} {cfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{dominantCat}</TableCell>
                      <TableCell className="text-right text-sm">{job.processedItems}/{job.totalItems}</TableCell>
                      <TableCell className="text-right text-sm text-success">{job.successCount}</TableCell>
                      <TableCell className="text-right text-sm text-destructive">{job.failedCount}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedJob(job)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {!isLoading && data && data.hasMore && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="flex items-center px-3 text-sm text-muted-foreground">Page {page} of {Math.ceil(total / 20)}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      {/* Create Dialog */}
      <CreateBatchDialog open={showCreate} onOpenChange={setShowCreate} onCreated={() => { setShowCreate(false); refetch(); }} />

      {/* Detail Sheet */}
      {selectedJob && (
        <JobDetailSheet job={selectedJob} open={!!selectedJob} onOpenChange={(o) => { if (!o) setSelectedJob(null); }} />
      )}
    </div>
  );
}

// ─── Stat Card ──────────────────────────────────────────────

function StatCard({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-3">
        {icon && <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">{icon}</div>}
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Create Batch Dialog ────────────────────────────────────

function CreateBatchDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [category, setCategory] = React.useState<BulkCategory>("wallet_credit");
  const [csvText, setCsvText] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const catConfig = CATEGORIES[category];

  const parsed = React.useMemo(() => {
    if (!csvText.trim()) return [];
    const lines = csvText.trim().split("\n");
    const header = lines[0].toLowerCase();
    const dataLines = header.includes("recipient") || header.includes("account") || header.includes("meter") ? lines.slice(1) : lines;

    return dataLines
      .filter(l => l.trim())
      .map((line, i) => {
        const cols = line.split(",").map(c => c.trim());
        const base: Record<string, any> = { index: i, category };

        switch (category) {
          case "wallet_credit":
            base.recipient = cols[0] ?? "";
            base.amountKobo = Math.round(parseFloat(cols[1] ?? "0") * 100);
            base.recipientName = cols[2] || undefined;
            base.narration = cols[3] || undefined;
            break;
          case "bank_transfer":
            base.recipient = cols[0] ?? "";
            base.amountKobo = Math.round(parseFloat(cols[1] ?? "0") * 100);
            base.bankCode = cols[2] || undefined;
            base.recipientName = cols[3] || undefined;
            base.narration = cols[4] || undefined;
            break;
          case "airtime":
            base.recipient = cols[0] ?? "";
            base.amountKobo = Math.round(parseFloat(cols[1] ?? "0") * 100);
            base.network = cols[2] ?? "MTN";
            break;
          case "data":
            base.recipient = cols[0] ?? "";
            base.network = cols[1] ?? "MTN";
            base.billerCode = cols[2] ?? "";
            base.amountKobo = 0;
            break;
          case "electricity":
            base.meterNumber = cols[0] ?? "";
            base.meterType = cols[1] ?? "prepaid";
            base.discoCode = cols[2] ?? "";
            base.amountKobo = Math.round(parseFloat(cols[3] ?? "0") * 100);
            base.recipient = base.meterNumber;
            break;
          case "utility":
            base.billerCode = cols[0] ?? "";
            base.customerReference = cols[1] ?? "";
            base.amountKobo = Math.round(parseFloat(cols[2] ?? "0") * 100);
            base.recipient = base.customerReference;
            break;
          case "remita":
          case "quickteller":
            base.billerId = cols[0] ?? "";
            base.customerReference = cols[1] ?? "";
            base.amountKobo = Math.round(parseFloat(cols[2] ?? "0") * 100);
            base.narration = cols[3] || undefined;
            base.recipient = base.customerReference;
            break;
          case "international":
            base.beneficiaryName = cols[0] ?? "";
            base.amountKobo = Math.round(parseFloat(cols[1] ?? "0") * 100);
            base.countryCode = cols[2] ?? "";
            base.beneficiaryAccount = cols[3] ?? "";
            base.beneficiaryBank = cols[4] ?? "";
            base.narration = cols[5] || undefined;
            base.recipient = base.beneficiaryAccount;
            break;
        }
        return base;
      })
      .filter(item => item.recipient && (item.amountKobo > 0 || category === "data"));
  }, [csvText, category]);

  const totalKobo = parsed.reduce((s: number, i: any) => s + (i.amountKobo ?? 0), 0);

  const handleSubmit = async () => {
    if (parsed.length === 0) { setError("No valid items found"); return; }
    if (parsed.length > 500) { setError("Maximum 500 items per batch"); return; }

    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/bulk-payments", {
        method: "POST",
        body: JSON.stringify({ items: parsed.map(({ index: _, ...rest }) => rest) }),
      });
      toast.success(`Batch created: ${parsed.length} ${catConfig.label} items`);
      setCsvText("");
      onCreated();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Bulk Payment Batch</DialogTitle>
          <DialogDescription>Select a payment category and paste CSV data.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Category selector */}
          <div>
            <Label>Payment Category</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(Object.entries(CATEGORIES) as [BulkCategory, typeof catConfig][]).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => { setCategory(key); setCsvText(""); setError(null); }}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors",
                    category === key ? "border-primary bg-primary/5" : "hover:bg-muted"
                  )}
                >
                  {cfg.icon}
                  <span className="font-medium">{cfg.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Description + template */}
          <Card className="bg-muted/50">
            <CardContent className="py-3">
              <p className="text-sm font-medium">{catConfig.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                <strong>CSV format:</strong> {catConfig.csvHint}
              </p>
              <button
                onClick={() => setCsvText(catConfig.csvTemplate)}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Load template →
              </button>
            </CardContent>
          </Card>

          {/* CSV input */}
          <div>
            <Label>CSV Data</Label>
            <Textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={catConfig.csvTemplate}
              rows={8}
              className="mt-1 font-mono text-xs"
            />
          </div>

          {/* Preview */}
          {parsed.length > 0 && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <div className="flex items-center justify-between">
                <p><strong>{parsed.length}</strong> items parsed</p>
                {totalKobo > 0 && <p>Total: <strong>{formatNaira(totalKobo)}</strong></p>}
              </div>
              <div className="mt-2 max-h-32 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">#</TableHead>
                      <TableHead className="text-xs">Recipient</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.slice(0, 10).map((item: any) => (
                      <TableRow key={item.index}>
                        <TableCell className="text-xs">{item.index + 1}</TableCell>
                        <TableCell className="font-mono text-xs">{item.recipient}</TableCell>
                        <TableCell className="text-right text-xs">{item.amountKobo > 0 ? formatNaira(item.amountKobo) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {parsed.length > 10 && <p className="mt-1 text-xs text-muted-foreground">...and {parsed.length - 10} more</p>}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading || parsed.length === 0}>
            {loading ? "Creating..." : `Create ${catConfig.label} Batch (${parsed.length} items)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Job Detail Sheet ───────────────────────────────────────

function JobDetailSheet({ job, open, onOpenChange }: {
  job: BulkJob;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.PENDING;
  const progress = job.totalItems > 0 ? Math.round((job.processedItems / job.totalItems) * 100) : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-lg overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-mono">{job.reference}</SheetTitle>
          <SheetDescription>Batch payment job details</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Summary */}
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 py-4 text-sm">
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge variant="secondary" className={cn("gap-1 mt-1", cfg.className)}>{cfg.icon} {cfg.label}</Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Progress</p>
                <p className="font-medium">{job.processedItems}/{job.totalItems} ({progress}%)</p>
              </div>
              <div>
                <p className="text-muted-foreground">Success</p>
                <p className="font-medium text-success">{job.successCount}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Failed</p>
                <p className="font-medium text-destructive">{job.failedCount}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Created</p>
                <p>{new Date(job.createdAt).toLocaleString()}</p>
              </div>
              {job.completedAt && (
                <div>
                  <p className="text-muted-foreground">Completed</p>
                  <p>{new Date(job.completedAt).toLocaleString()}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Items */}
          {job.items.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-medium">Items ({job.items.length})</h4>
              <div className="max-h-80 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {job.items.map((item) => {
                      const itemCfg = ITEM_STATUS_CONFIG[item.status] ?? ITEM_STATUS_CONFIG.PENDING;
                      const catCfg = CATEGORIES[item.category];
                      return (
                        <TableRow key={item.index}>
                          <TableCell className="text-xs text-muted-foreground">{item.index + 1}</TableCell>
                          <TableCell className="font-mono text-xs">{item.recipient}</TableCell>
                          <TableCell>
                            {catCfg && (
                              <Badge variant="secondary" className={cn("text-xs gap-1", catCfg.color)}>
                                {catCfg.icon} {catCfg.label}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatNaira(item.amountKobo)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={cn("text-xs", itemCfg.className)}>{itemCfg.label}</Badge>
                            {item.error && <p className="mt-0.5 text-xs text-destructive">{item.error}</p>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
