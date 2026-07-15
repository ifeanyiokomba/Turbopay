"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  LifeBuoy, Ticket, MessageSquare, Send, Plus, CheckCircle2, Clock, ChevronRight, Bot, User as UserIcon, Paperclip, Image as ImageIcon, FileText, AlertTriangle,
} from "lucide-react";
import { useApi, apiPost, apiFetch } from "@/lib/turbopay/client";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const TICKET_CATEGORIES = [
  "LOGIN", "WALLET", "TRANSFER", "BILLS", "KYC", "SAVINGS", "INVESTMENTS",
  "CARDS", "INTERNATIONAL", "REFERRAL", "TECHNICAL", "OTHER",
];

const STATUS_TONE: Record<string, string> = {
  NEW: "bg-success/15 text-success",
  OPEN: "bg-success/15 text-success",
  PENDING_CUSTOMER: "bg-warning/15 text-warning-foreground",
  PENDING_INTERNAL: "bg-warning/15 text-warning-foreground",
  IN_PROGRESS: "bg-primary/10 text-primary",
  ESCALATED: "bg-destructive/15 text-destructive",
  RESOLVED: "bg-muted text-muted-foreground",
  CLOSED: "bg-muted text-muted-foreground",
};

export function SupportView() {
  const [tab, setTab] = React.useState("chat");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Support Center"
        description="Chat with our assistant, create a ticket, or browse FAQs."
        icon={<LifeBuoy className="h-5 w-5" />}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="chat"><MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Live Chat</TabsTrigger>
          <TabsTrigger value="tickets"><Ticket className="mr-1.5 h-3.5 w-3.5" /> Tickets</TabsTrigger>
          <TabsTrigger value="faq">FAQ</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="mt-4"><ChatTab /></TabsContent>
        <TabsContent value="tickets" className="mt-4"><TicketsTab /></TabsContent>
        <TabsContent value="faq" className="mt-4"><FaqTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Chat ────────────────────────────────────────────────────
function ChatTab() {
  const { data, isLoading, refetch } = useApi<any>(`/api/support/chat`);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [pendingAttachments, setPendingAttachments] = React.useState<Array<{ url: string; fileName: string; fileType: string; fileSize: number }>>([]);
  const [uploading, setUploading] = React.useState(false);
  const [escalationMsg, setEscalationMsg] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const messages = data?.messages ?? [];
  React.useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const uploadFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error("File too large. Max 5MB."); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/support/chat/upload", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setPendingAttachments((prev) => [...prev, data.data]);
      toast.success("Attachment added");
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Could not upload file");
    } finally { setUploading(false); }
  };

  const send = async () => {
    if (!input.trim() && pendingAttachments.length === 0) return;
    setSending(true);
    setEscalationMsg(null);
    try {
      const res = await apiPost<{ reply: string; escalated: boolean; escalationType?: string; message?: string }>("/api/support/chat", {
        message: input.trim(),
        attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
      });
      setInput("");
      setPendingAttachments([]);
      if (res.escalated) {
        setEscalationMsg(res.message ?? "Your issue has been escalated.");
      }
      refetch();
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Could not send");
    } finally { setSending(false); }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4 text-primary" /> Turbopay Assistant
          {data?.conversation?.status === "WAITING_AGENT" && <Badge variant="outline" className="bg-warning/15 text-warning-foreground text-[10px]">Agent connecting…</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div ref={scrollRef} className="h-80 overflow-y-auto p-4">
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Bot className="mb-2 h-10 w-10 text-primary/60" />
              <p className="font-medium">Hi! I'm your Turbopay assistant.</p>
              <p className="mt-1 text-xs">Ask me about funding, transfers, KYC, bills, or PIN issues. You can also attach screenshots or documents.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m: any) => (
                <div key={m.id} className={cn("flex gap-2", m.authorRole === "CUSTOMER" ? "justify-end" : "justify-start")}>
                  {m.authorRole !== "CUSTOMER" && <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent"><Bot className="h-3.5 w-3.5" /></div>}
                  <div className={cn("max-w-[75%] rounded-lg p-2.5 text-sm", m.authorRole === "CUSTOMER" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    {/* Render attachments */}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {m.attachments.map((att: any, i: number) => (
                          <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20 transition-colors">
                            {att.fileType === "IMAGE" ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                            <span className="truncate">{att.fileName}</span>
                          </a>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-[10px] opacity-60">{new Date(m.createdAt).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  {m.authorRole === "CUSTOMER" && <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10"><UserIcon className="h-3.5 w-3.5 text-primary" /></div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Escalation banner */}
        {escalationMsg && (
          <div className="flex items-center gap-2 border-t bg-warning/10 px-4 py-2 text-xs text-warning-foreground">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{escalationMsg}</span>
          </div>
        )}

        {/* Pending attachments preview */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t p-2">
            {pendingAttachments.map((att, i) => (
              <div key={i} className="flex items-center gap-1 rounded border bg-muted px-2 py-1 text-[11px]">
                {att.fileType === "IMAGE" ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                <span className="max-w-[100px] truncate">{att.fileName}</span>
                <button onClick={() => setPendingAttachments((prev) => prev.filter((_, j) => j !== i))} className="ml-1 text-destructive">×</button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 border-t p-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
          />
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => fileInputRef.current?.click()} disabled={uploading || sending} aria-label="Attach file">
            {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" /> : <Paperclip className="h-4 w-4" />}
          </Button>
          <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Type a message…" disabled={sending} />
          <Button onClick={send} disabled={sending || (!input.trim() && pendingAttachments.length === 0)} size="icon"><Send className="h-4 w-4" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tickets ─────────────────────────────────────────────────
function TicketsTab() {
  const { data, isLoading, refetch } = useApi<{ items: any[] }>("/api/support/tickets");
  const [createOpen, setCreateOpen] = React.useState(false);
  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New ticket</Button>
      </div>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Your tickets</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : items.length === 0 ? (
            <EmptyState icon={<Ticket className="h-6 w-6" />} title="No support tickets" description="Need help? Create a ticket and our team will respond within 60 minutes." />
          ) : (
            <div className="space-y-2">
              {items.map((t: any) => (
                <div key={t.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", STATUS_TONE[t.status] ?? "bg-muted")}>
                    <Ticket className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.subject}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      <code className="font-mono">{t.ticketNumber}</code> · {t.category} · {new Date(t.createdAt).toLocaleDateString("en-NG")}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[t.status] ?? "bg-muted")}>{t.status.replace(/_/g, " ")}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <CreateTicketDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => refetch()} />
    </div>
  );
}

function CreateTicketDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [category, setCategory] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState("MEDIUM");
  const [loading, setLoading] = React.useState(false);

  const submit = async () => {
    if (!category || !subject || description.length < 10) { toast.error("Fill all fields — description must be at least 10 characters."); return; }
    setLoading(true);
    try {
      await apiPost("/api/support/tickets", { category, subject, description, priority });
      toast.success("Ticket created — we'll respond within 60 minutes");
      setCategory(""); setSubject(""); setDescription(""); setPriority("MEDIUM");
      onOpenChange(false);
      onCreated();
    } catch (e: any) { if (e?.status === 401) return; toast.error(e.message ?? "Could not create ticket"); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create support ticket</DialogTitle>
          <DialogDescription>Tell us what's going on. Our team responds within 60 minutes during business hours.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {TICKET_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-subject">Subject</Label>
            <Input id="t-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-desc">Description</Label>
            <Textarea id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the issue in detail" rows={4} maxLength={2000} />
            <p className="text-[11px] text-muted-foreground">{description.length}/2000</p>
          </div>
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
          <Button onClick={submit} disabled={loading}>{loading ? "Creating…" : "Create ticket"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────
function FaqTab() {
  const faqs = [
    { q: "How do I fund my wallet?", a: "Transfer money from any Nigerian bank to your dedicated virtual account number. Funds appear in your wallet instantly. You can also use the 'Fund Wallet' button in the app." },
    { q: "Are transfers really free?", a: "Yes! Internal transfers between Turbopay users are completely free — no fees, no hidden charges." },
    { q: "Is my money safe with Turbopay?", a: "Yes. Your funds are held securely by our CBN-licensed banking partners. Every transaction requires your personal PIN, our system monitors for fraud 24/7, and you receive instant alerts for every activity." },
    { q: "What are KYC tiers?", a: "Tier 1 (phone + email) gives you ₦50K per transaction. Tier 2 (NIN) unlocks ₦500K. Tier 3 (BVN) gives you ₦5M per transaction." },
    { q: "Can I pay electricity bills?", a: "Yes! We support all major electricity DISCOs with instant prepaid token generation. We also support DStv, GOtv, water, internet, and Remita payments." },
    { q: "What if I forget my password?", a: "Click 'Forgot password?' on the login screen. We'll send a 6-digit OTP to your registered email or phone. Enter the OTP and set a new password." },
    { q: "How do I contact support?", a: "You can chat with our assistant right here, create a support ticket, or email support@turbopay.com." },
  ];
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Frequently asked questions</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {faqs.map((f, i) => <FaqItem key={i} q={f.q} a={f.a} />)}
      </CardContent>
    </Card>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-lg border">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between p-3 text-left">
        <span className="text-sm font-medium">{q}</span>
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && <p className="px-3 pb-3 text-sm text-muted-foreground">{a}</p>}
    </div>
  );
}
