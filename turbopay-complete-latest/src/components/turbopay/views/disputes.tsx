"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, Plus, Send, MessageSquare } from "lucide-react";
import { useApi, apiPost, apiFetch, mutateApi } from "@/lib/turbopay/client";
import { formatNaira } from "@/lib/turbopay/money";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Dispute {
  id: string; disputeNumber: string; type: string; subject: string;
  description: string; status: string; priority: string;
  amountDisputedKobo: number | null; createdAt: string; slaDueAt: string;
  transactionId: string | null;
}

interface DisputeDetail extends Dispute {
  messages: Array<{
    id: string; authorId: string | null; authorName: string;
    authorRole: string; message: string; isInternal: boolean; createdAt: string;
  }>;
}

interface TxResponse { items: Array<{ id: string; reference: string; type: string; direction: string; amountKobo: number; description: string | null; createdAt: string }>; total: number }

const DISPUTE_TYPES = [
  "FAILED_TRANSFER", "INCORRECT_DEBIT", "CARD_DISPUTE", "BILL_PAYMENT_ISSUE",
  "UNAUTHORIZED_TRANSACTION", "DUPLICATE_CHARGE", "OTHER",
];

const STATUS_TONE: Record<string, string> = {
  OPEN: "bg-warning/15 text-warning-foreground",
  UNDER_REVIEW: "bg-primary/10 text-primary",
  EVIDENCE_REQUIRED: "bg-warning/15 text-warning-foreground",
  RESOLVED_FAVOUR_USER: "bg-success/15 text-success",
  RESOLVED_FAVOUR_PLATFORM: "bg-muted text-muted-foreground",
  CLOSED: "bg-muted text-muted-foreground",
};

export function DisputesView() {
  const { data, isLoading, refetch } = useApi<Dispute[]>("/api/disputes");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const items = data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Disputes"
        description="File a dispute for a transaction and track resolution."
        icon={<AlertTriangle className="h-5 w-5" />}
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> File dispute</Button>}
      />

      {isLoading ? (
        <Card><CardContent className="space-y-2 py-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</CardContent></Card>
      ) : items.length === 0 ? (
        <Card><CardContent><EmptyState icon={<AlertTriangle className="h-6 w-6" />} title="No disputes filed" description="If a transaction looks wrong, file a dispute and our team will investigate." action={<Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> File dispute</Button>} /></CardContent></Card>
      ) : (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Open & closed disputes</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y">
              {items.map((d) => (
                <button key={d.id} onClick={() => setSelectedId(d.id)} className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-accent/30 -mx-2 px-2 rounded-md">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.subject}</p>
                    <p className="truncate text-xs text-muted-foreground"><code className="font-mono">{d.disputeNumber}</code> · {d.type.replace(/_/g, " ").toLowerCase()} · {new Date(d.createdAt).toLocaleDateString("en-NG")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.amountDisputedKobo && <span className="text-xs text-muted-foreground">{formatNaira(d.amountDisputedKobo)}</span>}
                    <Badge variant="outline" className={STATUS_TONE[d.status] ?? "text-[10px]"}>{d.status.replace(/_/g, " ").toLowerCase()}</Badge>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <CreateDisputeDialog open={createOpen} onOpenChange={setCreateOpen} onDone={() => refetch()} />
      <DisputeDetailDialog id={selectedId} onClose={() => setSelectedId(null)} onUpdated={() => refetch()} />
    </div>
  );
}

function CreateDisputeDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { data: txData } = useApi<TxResponse>("/api/transactions?limit=50");
  const [type, setType] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [transactionId, setTransactionId] = React.useState("");
  const [priority, setPriority] = React.useState("MEDIUM");
  const [loading, setLoading] = React.useState(false);

  const txs = txData?.items ?? [];

  const submit = async () => {
    if (!type) return toast.error("Select a dispute type");
    if (!subject || subject.length < 3) return toast.error("Enter a subject (min 3 chars)");
    if (description.length < 10) return toast.error("Description must be at least 10 characters");
    setLoading(true);
    try {
      await apiPost("/api/disputes", { type, subject, description, transactionId: transactionId || undefined, priority });
      toast.success("Dispute filed — we'll investigate within SLA");
      setType(""); setSubject(""); setDescription(""); setTransactionId(""); setPriority("MEDIUM");
      onOpenChange(false);
      onDone();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not file dispute"); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle><AlertTriangle className="mr-2 inline h-5 w-5 text-primary" /> File a dispute</DialogTitle><DialogDescription>Tell us what went wrong. We'll respond within the SLA window based on priority.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Related transaction (optional)</Label>
            <Select value={transactionId} onValueChange={setTransactionId}>
              <SelectTrigger><SelectValue placeholder="Select a transaction" /></SelectTrigger>
              <SelectContent>
                {txs.map((t) => <SelectItem key={t.id} value={t.id}>{t.reference} · {formatNaira(t.amountKobo)} · {new Date(t.createdAt).toLocaleDateString("en-NG")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Dispute type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {DISPUTE_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ").toLowerCase()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary" /></div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Describe what happened in detail" maxLength={5000} /></div>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="URGENT">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Filing…" : "File dispute"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisputeDetailDialog({ id, onClose, onUpdated }: { id: string | null; onClose: () => void; onUpdated: () => void }) {
  const { data, isLoading, refetch } = useApi<DisputeDetail | null>(id ? `/api/disputes/${id}` : null);
  const [reply, setReply] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (data?.messages) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [data?.messages?.length]);

  const send = async () => {
    if (!id || !reply.trim()) return;
    setSending(true);
    try {
      await apiPost(`/api/disputes/${id}/messages`, { message: reply.trim() });
      setReply("");
      refetch();
      onUpdated();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not send message"); }
    finally { setSending(false); }
  };

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            {data ? data.subject : "Dispute"}
          </DialogTitle>
          {data && (
            <DialogDescription>
              <code className="font-mono">{data.disputeNumber}</code> · {data.type.replace(/_/g, " ").toLowerCase()}
              <Badge variant="outline" className={`ml-2 text-[10px] ${STATUS_TONE[data.status] ?? ""}`}>{data.status.replace(/_/g, " ").toLowerCase()}</Badge>
            </DialogDescription>
          )}
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : data ? (
          <div className="space-y-3">
            <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">{data.description}</p>
            <div ref={scrollRef} className="max-h-64 space-y-2 overflow-y-auto scrollbar-thin">
              {data.messages.map((m) => (
                <div key={m.id} className={`flex flex-col gap-0.5 ${m.authorRole === "CUSTOMER" ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[80%] rounded-lg p-2.5 text-xs ${m.authorRole === "CUSTOMER" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}>
                    <p className="whitespace-pre-wrap">{m.message}</p>
                    <p className="mt-1 text-[10px] opacity-70">{m.authorName} · {new Date(m.createdAt).toLocaleString("en-NG", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 border-t pt-2">
              <Input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Type a reply…" disabled={sending} />
              <Button size="icon" onClick={send} disabled={sending || !reply.trim()}><Send className="h-4 w-4" /></Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
