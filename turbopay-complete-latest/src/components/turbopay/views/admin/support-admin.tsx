"use client";

import * as React from "react";
import { LifeBuoy, ArrowLeft, Send } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";

interface TicketMessage { id: string; authorId: string | null; authorName: string; authorRole: string; message: string; isInternal: boolean; createdAt: string; }
interface TicketRow {
  id: string; ticketNumber: string; userId: string | null; fullName: string; email: string;
  category: string; priority: string; status: string; subject: string; description: string;
  assignedTo: string | null; createdAt: string; updatedAt: string;
}
interface TicketDetail extends TicketRow { messages: TicketMessage[]; }
interface TicketList { items: TicketRow[]; total: number; page: number; limit: number; }

const STATUSES = ["NEW", "OPEN", "PENDING_CUSTOMER", "PENDING_INTERNAL", "IN_PROGRESS", "ESCALATED", "RESOLVED", "CLOSED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const STATUS_TONE: Record<string, string> = {
  NEW: "bg-primary/15 text-primary", OPEN: "bg-accent/15 text-accent-foreground",
  IN_PROGRESS: "bg-warning/15 text-warning-foreground", PENDING_CUSTOMER: "bg-muted text-muted-foreground",
  PENDING_INTERNAL: "bg-muted text-muted-foreground", ESCALATED: "bg-destructive/15 text-destructive",
  RESOLVED: "bg-success/15 text-success", CLOSED: "bg-muted text-muted-foreground",
};
const PRIORITY_TONE: Record<string, string> = {
  LOW: "bg-muted text-muted-foreground", MEDIUM: "bg-primary/15 text-primary",
  HIGH: "bg-warning/15 text-warning-foreground", URGENT: "bg-destructive/15 text-destructive",
};

export function SupportAdminView() {
  const [statusFilter, setStatusFilter] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const qs = new URLSearchParams();
  if (statusFilter) qs.set("status", statusFilter);
  qs.set("limit", "100");
  const { data, isLoading, error } = useApi<TicketList>(`/api/admin/support/tickets?${qs.toString()}`);

  if (selectedId) return <TicketDetailPanel ticketId={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <div className="space-y-5">
      <PageHeader title="Support Tickets" description="Triage, assign, and resolve customer support tickets." icon={<LifeBuoy className="h-5 w-5" />} />
      <div className="space-y-1.5">
        <Label className="text-xs">Status filter</Label>
        <Select value={statusFilter || "ALL"} onValueChange={(v) => setStatusFilter(v === "ALL" ? "" : v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="p-0">
          {error ? <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
          : isLoading || !data ? (
            <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : data.items.length === 0 ? (
            <EmptyState icon={<LifeBuoy className="h-6 w-6" />} title="No tickets" description="Nothing in this view right now." />
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Ticket</TableHead><TableHead>Subject</TableHead>
                  <TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {data.items.map((t) => (
                    <TableRow key={t.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelectedId(t.id)}>
                      <TableCell>
                        <div className="font-mono text-xs font-semibold">{t.ticketNumber}</div>
                        <div className="text-xs text-muted-foreground">{t.fullName}</div>
                      </TableCell>
                      <TableCell className="max-w-[280px]">
                        <div className="truncate text-sm font-medium">{t.subject}</div>
                        <div className="text-xs text-muted-foreground">{t.category.replace(/_/g, " ")}</div>
                      </TableCell>
                      <TableCell><Badge className={cn("text-[10px]", PRIORITY_TONE[t.priority] ?? "")}>{t.priority}</Badge></TableCell>
                      <TableCell><Badge className={cn("text-[10px]", STATUS_TONE[t.status] ?? "")}>{t.status.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(t.updatedAt).toLocaleString("en-NG")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TicketDetailPanel({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const { data: ticket, isLoading, error } = useApi<TicketDetail>(`/api/admin/support/tickets/${ticketId}`);
  const [reply, setReply] = React.useState("");
  const [statusDraft, setStatusDraft] = React.useState("");
  const [priorityDraft, setPriorityDraft] = React.useState("");
  const [assignDraft, setAssignDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (ticket) { setStatusDraft(ticket.status); setPriorityDraft(ticket.priority); setAssignDraft(ticket.assignedTo ?? ""); }
  }, [ticket?.id, ticket?.status, ticket?.priority, ticket?.assignedTo]);

  async function patch(fields: Record<string, unknown>, label: string) {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/support/tickets/${ticketId}`, { method: "PATCH", body: JSON.stringify(fields) });
      toast.success(label);
      mutateApi(`/api/admin/support/tickets/${ticketId}`);
      mutateApi("/api/admin/support/tickets");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Update failed");
    } finally { setBusy(false); }
  }

  async function sendReply() {
    if (!reply.trim()) { toast.error("Message is empty"); return; }
    setBusy(true);
    try {
      // Reuse the user-facing message route: authorRole=AGENT is set
      // server-side when the caller's role is not USER.
      await apiFetch(`/api/support/tickets/${ticketId}/messages`, {
        method: "POST", body: JSON.stringify({ message: reply.trim() }),
      });
      toast.success("Reply sent");
      setReply("");
      mutateApi(`/api/admin/support/tickets/${ticketId}`);
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not send reply");
    } finally { setBusy(false); }
  }

  if (error) return <Card><CardContent className="p-6 text-sm text-destructive">{(error as Error).message}</CardContent></Card>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" /> Back to list</Button>
        {ticket && <Badge className={cn("text-[10px]", STATUS_TONE[ticket.status] ?? "")}>{ticket.status.replace(/_/g, " ")}</Badge>}
      </div>
      {isLoading || !ticket ? (
        <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <>
          <PageHeader title={ticket.subject} description={`${ticket.ticketNumber} · ${ticket.category.replace(/_/g, " ")} · ${ticket.fullName} <${ticket.email}>`} icon={<LifeBuoy className="h-5 w-5" />} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardContent className="space-y-3 p-4">
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={statusDraft} onValueChange={setStatusDraft}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Priority</Label>
                  <Select value={priorityDraft} onValueChange={setPriorityDraft}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Assignee (user ID)</Label>
                  <Input className="mt-1" value={assignDraft} onChange={(e) => setAssignDraft(e.target.value)} placeholder="Unassigned" />
                </div>
                <Button className="w-full" disabled={busy}
                  onClick={() => patch({ status: statusDraft, priority: priorityDraft, assignedTo: assignDraft || undefined }, "Ticket updated")}>
                  Save changes
                </Button>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => patch({ status: "RESOLVED" }, "Marked resolved")}>Resolve</Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => patch({ status: "CLOSED" }, "Ticket closed")}>Close</Button>
                </div>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardContent className="space-y-3 p-4">
                <Label className="text-xs">Conversation</Label>
                <ScrollArea className="max-h-[400px] rounded-md border">
                  <div className="space-y-3 p-3">
                    {ticket.messages.length === 0 && <p className="text-center text-xs text-muted-foreground">No messages yet.</p>}
                    {ticket.messages.map((m) => (
                      <div key={m.id} className={cn("rounded-md border p-3", m.authorRole === "AGENT" ? "bg-primary/5" : m.isInternal ? "bg-muted" : "bg-background")}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="font-medium">
                            {m.authorName}<span className="ml-1 text-muted-foreground">· {m.authorRole.toLowerCase()}</span>
                            {m.isInternal && <Badge variant="outline" className="ml-1 text-[10px]">internal</Badge>}
                          </span>
                          <span className="text-muted-foreground">{new Date(m.createdAt).toLocaleString("en-NG")}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm">{m.message}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                <div className="space-y-1.5">
                  <Label className="text-xs">Reply</Label>
                  <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type a reply to the customer…" />
                  <div className="flex justify-end">
                    <Button onClick={sendReply} disabled={busy || !reply.trim()}>
                      <Send className="mr-1 h-3.5 w-3.5" /> {busy ? "Sending…" : "Send reply"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
