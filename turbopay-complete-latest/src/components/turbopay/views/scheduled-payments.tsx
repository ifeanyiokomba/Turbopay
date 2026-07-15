"use client";

import * as React from "react";
import { toast } from "sonner";
import { CalendarClock, Plus, Ban, Play, Pause, Repeat } from "lucide-react";
import { useApi, apiPost, apiFetch, mutateApi } from "@/lib/turbopay/client";
import { formatNaira, parseNairaToKobo } from "@/lib/turbopay/money";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ScheduledPayment {
  id: string; type: string; frequency: string;
  nextExecutionAt: string; endDate: string | null;
  recipient: string; recipientName: string | null; bankName: string | null;
  amountKobo: number; description: string | null;
  status: string; lastExecutedAt: string | null; createdAt: string;
}

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-success/15 text-success", PAUSED: "bg-warning/15 text-warning-foreground",
  CANCELLED: "bg-muted text-muted-foreground", COMPLETED: "bg-primary/10 text-primary",
};

const FREQ_LABELS: Record<string, string> = {
  ONCE: "One-time", DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", CUSTOM: "Custom",
};

export function ScheduledPaymentsView() {
  const { data, isLoading, refetch } = useApi<ScheduledPayment[]>("/api/scheduled-payments");
  const [createOpen, setCreateOpen] = React.useState(false);
  const items = data ?? [];

  const cancel = async (id: string) => {
    try {
      await apiFetch(`/api/scheduled-payments/${id}`, { method: "DELETE" });
      toast.success("Scheduled payment cancelled");
      refetch();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not cancel"); }
  };

  const toggle = async (id: string, action: "pause" | "resume") => {
    try {
      await apiFetch(`/api/scheduled-payments/${id}?action=${action}`, { method: "DELETE" });
      toast.success(action === "pause" ? "Paused" : "Resumed");
      refetch();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not update"); }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Scheduled Payments"
        description="Automate recurring transfers, airtime, and bill payments."
        icon={<CalendarClock className="h-5 w-5" />}
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New schedule</Button>}
      />

      {isLoading ? (
        <Card><CardContent className="space-y-2 py-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</CardContent></Card>
      ) : items.length === 0 ? (
        <Card><CardContent><EmptyState icon={<CalendarClock className="h-6 w-6" />} title="No scheduled payments" description="Set up a recurring payment — we'll execute it on schedule, automatically." action={<Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New schedule</Button>} /></CardContent></Card>
      ) : (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Your schedules</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y">
              {items.map((s) => (
                <div key={s.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{s.recipientName || s.recipient}</p>
                        <Badge variant="outline" className="text-[10px]">{FREQ_LABELS[s.frequency] ?? s.frequency}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{formatNaira(s.amountKobo)} · next: {new Date(s.nextExecutionAt).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                      {s.description && <p className="truncate text-xs text-muted-foreground">{s.description}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline" className={STATUS_TONE[s.status] ?? "text-[10px]"}>{s.status}</Badge>
                      {s.status === "ACTIVE" && (
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggle(s.id, "pause")} aria-label="Pause"><Pause className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => cancel(s.id)} aria-label="Cancel"><Ban className="h-3.5 w-3.5" /></Button>
                        </div>
                      )}
                      {s.status === "PAUSED" && (
                        <Button size="sm" variant="outline" onClick={() => toggle(s.id, "resume")}><Play className="mr-1 h-3 w-3" /> Resume</Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} onDone={() => refetch()} />
    </div>
  );
}

function CreateScheduleDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [type, setType] = React.useState("TRANSFER");
  const [frequency, setFrequency] = React.useState("MONTHLY");
  const [recipient, setRecipient] = React.useState("");
  const [recipientName, setRecipientName] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const submit = async () => {
    if (!recipient) return toast.error("Enter a recipient (phone/email/account)");
    const kobo = parseNairaToKobo(amount);
    if (kobo < 5000) return toast.error("Minimum amount is ₦50");
    if (!startDate) return toast.error("Pick a start date");
    setLoading(true);
    try {
      const nextExecutionAt = new Date(startDate).toISOString();
      await apiPost("/api/scheduled-payments", {
        type, frequency,
        nextExecutionAt,
        recipient, recipientName: recipientName || undefined,
        amountKobo: kobo, description: description || undefined,
      });
      toast.success("Scheduled payment created");
      setType("TRANSFER"); setFrequency("MONTHLY"); setRecipient(""); setRecipientName("");
      setAmount(""); setStartDate(""); setDescription("");
      onOpenChange(false);
      onDone();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not create schedule"); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle><Repeat className="mr-2 inline h-5 w-5 text-primary" /> New scheduled payment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TRANSFER">Transfer</SelectItem>
                  <SelectItem value="AIRTIME">Airtime</SelectItem>
                  <SelectItem value="DATA">Data</SelectItem>
                  <SelectItem value="BILL_PAYMENT">Bill payment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ONCE">One-time</SelectItem>
                  <SelectItem value="DAILY">Daily</SelectItem>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Recipient (phone, email, or account)</Label><Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="08012345678" /></div>
          <div className="space-y-1.5"><Label>Recipient name (optional)</Label><Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Chidi Nwosu" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>Amount (₦)</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₦5,000" inputMode="decimal" /></div>
            <div className="space-y-1.5"><Label>Start date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Note (optional)</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Monthly rent" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Creating…" : "Create schedule"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
